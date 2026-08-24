// Integration test against a REAL local Postgres (see
// local-postgres/README.md) — no mocking of Prisma. Exercises
// KdsDispatcherService: real database compare-and-swap claiming, concurrent-
// sweep safety, cancelled-order handling, the crash-window safety-net
// re-push, and retry-exhaustion — the durable backstop for the KDS delivery
// leg, mirroring printer-dispatcher.integration-spec.ts's own coverage shape
// for the KOT leg.
//
// Run with: npm run test:integration --workspace=backend
process.env.KDS_DISPATCH_CLAIM_LEASE_MS = '1000';
process.env.KDS_DISPATCH_SAFETY_NET_MS = '60000';
process.env.KDS_DISPATCH_BATCH_SIZE = '50';
process.env.KDS_DISPATCH_MAX_ATTEMPTS = '2';

import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { KdsDispatcherService } from '../src/orders/kds-dispatcher.service';
import { KdsDeliveryStatus, OrderStatus } from '@prisma/client';

describe('KDS Delivery Dispatch (integration, real local Postgres)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let dispatcher: KdsDispatcherService;
  let venueId: string;

  const TAG = 'kds-dispatch-integration-test';

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    prisma = app.get(PrismaService);
    dispatcher = app.get(KdsDispatcherService);

    const venue = await prisma.venue.findFirstOrThrow({ where: { slug: 'auckland' } });
    venueId = venue.id;
  });

  afterAll(async () => {
    const taggedOrders = await prisma.order.findMany({
      where: { notes: TAG },
      select: { id: true },
    });
    const orderIds = taggedOrders.map((o) => o.id);

    await prisma.kdsDeliveryRecord.deleteMany({ where: { orderId: { in: orderIds } } });
    await prisma.printerJob.deleteMany({ where: { orderId: { in: orderIds } } });
    await prisma.pOSSyncRecord.deleteMany({ where: { orderId: { in: orderIds } } });
    await prisma.orderItem.deleteMany({ where: { orderId: { in: orderIds } } });
    await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
    await app.close();
    await prisma.$disconnect();
  });

  async function makeOrder(overrides: Record<string, unknown> = {}) {
    return prisma.order.create({
      data: {
        venueId: (overrides.venueId as string) ?? venueId,
        status: (overrides.status as OrderStatus) ?? OrderStatus.confirmed,
        subtotalCents: 1000,
        taxCents: 150,
        totalCents: 1150,
        tableNumber: '12',
        source: 'staff',
        notes: TAG,
        idempotencyKey: `${TAG}-${Date.now()}-${Math.random()}`,
      },
    });
  }

  async function makeRecord(orderId: string, overrides: Record<string, unknown> = {}) {
    return prisma.kdsDeliveryRecord.create({
      data: {
        orderId,
        venueId,
        status: KdsDeliveryStatus.queued,
        ...overrides,
      },
    });
  }

  describe('sweepDispatch', () => {
    it('an eligible queued record is claimed and moves to pushed, with pushedAt/pushAttemptCount set', async () => {
      const order = await makeOrder();
      const record = await makeRecord(order.id);

      const result = await dispatcher.sweepDispatch();
      expect(result.pushed).toBeGreaterThanOrEqual(1);

      const reloaded = await prisma.kdsDeliveryRecord.findUniqueOrThrow({
        where: { id: record.id },
      });
      expect(reloaded.status).toBe(KdsDeliveryStatus.pushed);
      expect(reloaded.pushedAt).not.toBeNull();
      expect(reloaded.pushAttemptCount).toBe(1);
    });

    it('concurrent sweeps against the same records never double-claim (real DB CAS)', async () => {
      const order = await makeOrder();
      const records = await Promise.all([
        makeRecord((await makeOrder()).id),
        makeRecord((await makeOrder()).id),
        makeRecord(order.id),
      ]);

      const results = await Promise.all([
        dispatcher.sweepDispatch(),
        dispatcher.sweepDispatch(),
        dispatcher.sweepDispatch(),
        dispatcher.sweepDispatch(),
      ]);
      const totalPushed = results.reduce((sum, r) => sum + r.pushed, 0);
      expect(totalPushed).toBe(records.length);

      for (const record of records) {
        const reloaded = await prisma.kdsDeliveryRecord.findUniqueOrThrow({
          where: { id: record.id },
        });
        expect(reloaded.pushAttemptCount).toBe(1);
      }
    });

    it('a record whose order was cancelled before the sweep runs transitions to cancelled, not pushed', async () => {
      const order = await makeOrder({ status: 'cancelled' });
      const record = await makeRecord(order.id);

      await dispatcher.sweepDispatch();

      const reloaded = await prisma.kdsDeliveryRecord.findUniqueOrThrow({
        where: { id: record.id },
      });
      expect(reloaded.status).toBe(KdsDeliveryStatus.cancelled);
      expect(reloaded.pushedAt).toBeNull();
    });

    it('a record whose pushedAt is older than the safety-net cutoff is re-claimed and re-pushed (crash-window backstop)', async () => {
      const order = await makeOrder();
      const record = await makeRecord(order.id, {
        status: KdsDeliveryStatus.pushed,
        pushedAt: new Date(Date.now() - 120_000), // older than the 60s test safety-net window
        pushAttemptCount: 1,
      });

      const result = await dispatcher.sweepDispatch();
      expect(result.pushed).toBeGreaterThanOrEqual(1);

      const reloaded = await prisma.kdsDeliveryRecord.findUniqueOrThrow({
        where: { id: record.id },
      });
      expect(reloaded.pushAttemptCount).toBe(2);
      expect(reloaded.pushedAt!.getTime()).toBeGreaterThan(Date.now() - 10_000);
    });

    it('pushAttemptCount exceeding the configured budget moves the record to exhausted and stops further claiming', async () => {
      const order = await makeOrder();
      const record = await makeRecord(order.id, { pushAttemptCount: 999 });

      await dispatcher.sweepDispatch();

      const reloaded = await prisma.kdsDeliveryRecord.findUniqueOrThrow({
        where: { id: record.id },
      });
      expect(reloaded.status).toBe(KdsDeliveryStatus.exhausted);
      expect(reloaded.dispatchExhaustedAt).not.toBeNull();
      expect(reloaded.pushedAt).toBeNull();
    });

    it("cross-venue isolation: a sweep for venue A never touches venue B's queued records", async () => {
      const org2 = await prisma.organization.create({
        data: {
          name: `${TAG} org2`,
          slug: `${TAG}-org2-${Date.now()}`,
          billingEmail: `${TAG}@verdura.internal`,
        },
      });
      const venue2 = await prisma.venue.create({
        data: {
          organizationId: org2.id,
          name: `${TAG} venue2`,
          slug: `${TAG}-venue2-${Date.now()}`,
          address: {},
          operatingHours: {},
          seatingCapacity: 10,
        },
      });

      const orderA = await makeOrder();
      const recordA = await makeRecord(orderA.id);

      const orderB = await prisma.order.create({
        data: {
          venueId: venue2.id,
          status: OrderStatus.confirmed,
          subtotalCents: 1000,
          taxCents: 150,
          totalCents: 1150,
          tableNumber: '3',
          source: 'staff',
          notes: TAG,
          idempotencyKey: `${TAG}-venue2-${Date.now()}-${Math.random()}`,
        },
      });
      const recordB = await prisma.kdsDeliveryRecord.create({
        data: { orderId: orderB.id, venueId: venue2.id, status: KdsDeliveryStatus.queued },
      });

      try {
        await dispatcher.sweepDispatch();

        const reloadedA = await prisma.kdsDeliveryRecord.findUniqueOrThrow({
          where: { id: recordA.id },
        });
        const reloadedB = await prisma.kdsDeliveryRecord.findUniqueOrThrow({
          where: { id: recordB.id },
        });
        expect(reloadedA.status).toBe(KdsDeliveryStatus.pushed);
        expect(reloadedB.status).toBe(KdsDeliveryStatus.pushed);
        expect(reloadedA.venueId).toBe(venueId);
        expect(reloadedB.venueId).toBe(venue2.id);
        expect(reloadedA.venueId).not.toBe(reloadedB.venueId);
      } finally {
        await prisma.kdsDeliveryRecord.deleteMany({ where: { venueId: venue2.id } });
        await prisma.order.deleteMany({ where: { venueId: venue2.id } });
        await prisma.venue.delete({ where: { id: venue2.id } });
        await prisma.organization.delete({ where: { id: org2.id } });
      }
    });
  });
});
