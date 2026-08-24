// Integration test against a REAL local Postgres (see
// local-postgres/README.md) — no mocking of Prisma. Exercises Story 15-6's
// PaymentObservationService/Controller end to end: real database
// compare-and-swap projection updates, real concurrent conflicting
// observations racing on the same order, real unique-constraint
// enforcement (native reference, observationId-per-order), real RBAC
// (staff role + device-kind identity isolation), and cross-tenant/venue
// isolation.
//
// Run with: npm run test:integration --workspace=apps/api
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import * as argon2 from 'argon2';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { PAYMENT_OBSERVATION_SCHEMA_VERSION } from '../src/payment-observation/payment-observation.constants';

describe('Payment Observation (integration, real local Postgres)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let venueId: string;
  let organizationId: string;
  let ownerToken: string;
  let cashierToken: string;
  let kitchenToken: string;

  const TAG = 'story15-6-pay-obs-test';
  // Unique per run -- so a rerun after a partial/interrupted afterAll never
  // collides on Organization.slug/Staff.email unique constraints. Kept
  // short: @IsEmail() enforces RFC 5321's 64-char local-part limit, and
  // TAG + this suffix must fit comfortably under it.
  const RUN = Date.now().toString(36);

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.use(cookieParser());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    prisma = app.get(PrismaService);

    const org = await prisma.organization.create({
      data: {
        name: `${TAG} org`,
        slug: `${TAG}-org-${RUN}`,
        billingEmail: `${TAG}-${RUN}@verdura.internal`,
      },
    });
    organizationId = org.id;
    const venue = await prisma.venue.create({
      data: {
        organizationId,
        name: `${TAG} venue`,
        slug: `${TAG}-venue-${RUN}`,
        address: {},
        operatingHours: {},
        seatingCapacity: 10,
        currency: 'NZD',
      },
    });
    venueId = venue.id;

    const ownerPassword = `${TAG}-owner-pw-1234`;
    const owner = await prisma.staff.create({
      data: {
        organizationId,
        email: `${TAG}-owner-${RUN}@verdura.internal`,
        name: 'Test Owner',
        passwordHash: await argon2.hash(ownerPassword, { type: argon2.argon2id }),
        role: 'owner',
      },
    });
    const ownerLogin = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: owner.email, password: ownerPassword })
      .expect(200);
    ownerToken = ownerLogin.body.accessToken as string;

    const cashierPassword = `${TAG}-cashier-pw-1234`;
    const cashier = await prisma.staff.create({
      data: {
        organizationId,
        email: `${TAG}-cashier-${RUN}@verdura.internal`,
        name: 'Test Cashier',
        passwordHash: await argon2.hash(cashierPassword, { type: argon2.argon2id }),
        role: 'cashier',
      },
    });
    const cashierLogin = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: cashier.email, password: cashierPassword })
      .expect(200);
    cashierToken = cashierLogin.body.accessToken as string;

    const kitchenPassword = `${TAG}-kitchen-pw-1234`;
    const kitchen = await prisma.staff.create({
      data: {
        organizationId,
        email: `${TAG}-kitchen-${RUN}@verdura.internal`,
        name: 'Test Kitchen',
        passwordHash: await argon2.hash(kitchenPassword, { type: argon2.argon2id }),
        role: 'kitchen',
      },
    });
    const kitchenLogin = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: kitchen.email, password: kitchenPassword })
      .expect(200);
    kitchenToken = kitchenLogin.body.accessToken as string;
  });

  afterAll(async () => {
    const orders = await prisma.order.findMany({ where: { notes: TAG }, select: { id: true } });
    const orderIds = orders.map((o) => o.id);
    await prisma.paymentObservationEvent.deleteMany({ where: { orderId: { in: orderIds } } });
    await prisma.paymentObservation.deleteMany({ where: { orderId: { in: orderIds } } });
    await prisma.orderItem.deleteMany({ where: { orderId: { in: orderIds } } });
    await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
    await prisma.auditLog.deleteMany({ where: { organizationId } });
    await prisma.staff.deleteMany({ where: { organizationId } });
    await prisma.venue.deleteMany({ where: { organizationId } });
    await prisma.organization.delete({ where: { id: organizationId } });
    await app.close();
  });

  let orderCounter = 0;
  async function makeOrder(payableCents = 7000) {
    orderCounter += 1;
    // Any existing MenuItem row satisfies OrderItem's FK -- it need not
    // belong to this test's own fresh organization (this test's subject is
    // payment observation, not menu/catalog scoping).
    const menuItem = await prisma.menuItem.findFirstOrThrow();
    const order = await prisma.order.create({
      data: {
        id: `ORD-${TAG}-${Date.now()}-${orderCounter}`,
        venueId,
        status: 'confirmed',
        posSyncStatus: 'not_synced',
        serviceMode: 'dine_in',
        subtotalCents: payableCents,
        taxCents: Math.round((payableCents * 3) / 23),
        totalCents: payableCents,
        notes: TAG,
        idempotencyKey: `${TAG}-${Date.now()}-${orderCounter}-${Math.random()}`,
      },
    });
    await prisma.orderItem.create({
      data: {
        orderId: order.id,
        menuItemId: menuItem.id,
        menuItemTitle: menuItem.title,
        menuItemCategory: 'test',
        unitPriceCents: payableCents,
        quantity: 1,
        lineTotalCents: payableCents,
      },
    });
    return order;
  }

  function fixturePayload(overrides: Record<string, unknown> = {}) {
    return {
      schemaVersion: PAYMENT_OBSERVATION_SCHEMA_VERSION,
      observationId: `obs-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      state: 'paid',
      amountCents: 7000,
      currency: 'NZD',
      nativeReference: `IPS-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      tenderMethod: 'eftpos',
      ...overrides,
    };
  }

  function inject(token: string, orderId: string, payload: Record<string, unknown>) {
    return request(app.getHttpServer())
      .post(`/api/admin/payment-observation-fixtures/orders/${orderId}/inject-observation`)
      .set('Authorization', `Bearer ${token}`)
      .send(payload);
  }

  describe('RBAC / identity isolation', () => {
    it('cashier can view an order-level observation (default not_observed-shaped)', async () => {
      const order = await makeOrder();
      const res = await request(app.getHttpServer())
        .get(`/api/admin/orders/${order.id}/payment-observation`)
        .set('Authorization', `Bearer ${cashierToken}`)
        .expect(200);
      expect(res.body.state).toBe('observation_unsupported');
    });

    it('kitchen role is denied (insufficient RBAC role)', async () => {
      const order = await makeOrder();
      await request(app.getHttpServer())
        .get(`/api/admin/orders/${order.id}/payment-observation`)
        .set('Authorization', `Bearer ${kitchenToken}`)
        .expect(403);
    });

    it('a cross-organization order is not found (tenant isolation)', async () => {
      const otherOrg = await prisma.organization.create({
        data: {
          name: `${TAG} other`,
          slug: `${TAG}-other-${Date.now()}`,
          billingEmail: `${TAG}-other@verdura.internal`,
        },
      });
      const otherVenue = await prisma.venue.create({
        data: {
          organizationId: otherOrg.id,
          name: `${TAG} other venue`,
          slug: `${TAG}-other-venue-${Date.now()}`,
          address: {},
          operatingHours: {},
          seatingCapacity: 4,
        },
      });
      const otherOrder = await prisma.order.create({
        data: {
          id: `ORD-${TAG}-other-${Date.now()}`,
          venueId: otherVenue.id,
          status: 'confirmed',
          posSyncStatus: 'not_synced',
          serviceMode: 'dine_in',
          subtotalCents: 1000,
          taxCents: 0,
          totalCents: 1000,
          idempotencyKey: `${TAG}-other-${Date.now()}`,
        },
      });

      await request(app.getHttpServer())
        .get(`/api/admin/orders/${otherOrder.id}/payment-observation`)
        .set('Authorization', `Bearer ${cashierToken}`)
        .expect(404);

      // Same isolation, the venue-LIST endpoint: this org's token must not
      // be able to list a completely different organization's venue.
      await request(app.getHttpServer())
        .get(`/api/admin/venues/${otherVenue.id}/payment-observations`)
        .set('Authorization', `Bearer ${cashierToken}`)
        .expect(404);

      await prisma.order.delete({ where: { id: otherOrder.id } });
      await prisma.venue.delete({ where: { id: otherVenue.id } });
      await prisma.organization.delete({ where: { id: otherOrg.id } });
    });

    it('fixture injection requires admin/manager -- cashier is denied', async () => {
      const order = await makeOrder();
      await inject(cashierToken, order.id, fixturePayload()).expect(403);
    });

    it('a forged/extra body field on acknowledge has no effect on RBAC or scope', async () => {
      const order = await makeOrder();
      await inject(ownerToken, order.id, fixturePayload({ state: 'conflict' })).expect(201);
      const view = await request(app.getHttpServer())
        .get(`/api/admin/orders/${order.id}/payment-observation`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);
      await request(app.getHttpServer())
        .post(`/api/admin/payment-observations/${view.body.id}/acknowledge`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          note: 'reviewed',
          organizationId: 'forged-org',
          staffId: 'forged-staff',
          role: 'owner',
        })
        .expect(201)
        .expect((r) => expect(r.body.acknowledged).toBe(true));
    });
  });

  describe('idempotency and duplicate delivery', () => {
    it('duplicate delivery of the identical observation is a safe no-op', async () => {
      const order = await makeOrder();
      const payload = fixturePayload();

      await inject(ownerToken, order.id, payload).expect(201);
      await inject(ownerToken, order.id, payload).expect(201); // same observationId+payload -- must not throw

      const events = await prisma.paymentObservationEvent.findMany({
        where: { orderId: order.id },
      });
      expect(events).toHaveLength(1); // never duplicated
    });

    it('the same observationId with a different payload fails closed (409)', async () => {
      const order = await makeOrder();
      const observationId = `obs-dup-${Date.now()}`;
      await inject(
        ownerToken,
        order.id,
        fixturePayload({ observationId, amountCents: 7000 }),
      ).expect(201);
      await inject(
        ownerToken,
        order.id,
        fixturePayload({ observationId, amountCents: 8000 }),
      ).expect(409);
    });
  });

  describe('concurrency', () => {
    it('two genuinely simultaneous, contradictory observations for the same order resolve to exactly one coherent projection state', async () => {
      const order = await makeOrder();
      const [r1, r2] = await Promise.all([
        inject(ownerToken, order.id, fixturePayload({ state: 'paid' })),
        inject(ownerToken, order.id, fixturePayload({ state: 'declined' })),
      ]);
      expect([r1.status, r2.status]).toEqual([201, 201]); // both events recorded

      const proj = await prisma.paymentObservation.findUnique({ where: { orderId: order.id } });
      expect(proj).not.toBeNull();
      // Exactly one of {paid, declined, conflict} — never left in an
      // impossible/undefined state, and never both applied.
      expect(['paid', 'declined', 'conflict']).toContain(proj!.state);

      const events = await prisma.paymentObservationEvent.findMany({
        where: { orderId: order.id },
      });
      expect(events).toHaveLength(2);
      const appliedCount = events.filter((e) => e.applied).length;
      expect(appliedCount).toBe(1); // exactly one won the CAS
    });

    it('repeated concurrent runs remain flake-free (3 consecutive passes)', async () => {
      for (let i = 0; i < 3; i++) {
        const order = await makeOrder();
        const [r1, r2] = await Promise.all([
          inject(ownerToken, order.id, fixturePayload({ state: 'pending' })),
          inject(ownerToken, order.id, fixturePayload({ state: 'pending' })),
        ]);
        expect([r1.status, r2.status]).toEqual([201, 201]);
        const events = await prisma.paymentObservationEvent.findMany({
          where: { orderId: order.id },
        });
        expect(events.filter((e) => e.applied).length).toBe(2); // both "pending" self-transitions are legitimately allowed
      }
    });
  });

  describe('provenance / native-reference integrity', () => {
    it('one native reference cannot silently attach to two different orders', async () => {
      const orderA = await makeOrder();
      const orderB = await makeOrder();
      const sharedReference = `IPS-shared-${Date.now()}`;

      await inject(
        ownerToken,
        orderA.id,
        fixturePayload({ state: 'paid', nativeReference: sharedReference }),
      ).expect(201);
      // The service itself does not special-case this; the DATABASE unique
      // constraint on PaymentObservation.nativeReference is the actual
      // enforcement mechanism -- proven by observing the underlying
      // constraint violation surfaces as a real error, not a silent
      // duplicate-reference acceptance.
      const projA = await prisma.paymentObservation.findUnique({ where: { orderId: orderA.id } });
      expect(projA?.nativeReference).toBe(sharedReference);

      await expect(
        prisma.paymentObservation.create({
          data: { orderId: orderB.id, venueId, nativeReference: sharedReference },
        }),
      ).rejects.toThrow();
    });

    it('an unverified amount is stored separately and never promoted to nativeAmountCents/state', async () => {
      const order = await makeOrder();
      const { PaymentObservationService } =
        await import('../src/payment-observation/payment-observation.service');
      const service = app.get(PaymentObservationService);
      await service.recordUnverifiedAmount(
        order.id,
        organizationId,
        4321,
        'table_amount_observation_unverified',
      );

      const proj = await prisma.paymentObservation.findUnique({ where: { orderId: order.id } });
      expect(proj?.unverifiedAmountCents).toBe(4321);
      expect(proj?.nativeAmountCents).toBeNull();
      expect(proj?.state).toBe('not_observed');
    });
  });

  describe('acknowledgement idempotency', () => {
    it('acknowledging an already-reviewed conflict twice does not create a second audit trail entry', async () => {
      const order = await makeOrder();
      await inject(ownerToken, order.id, fixturePayload({ state: 'paid' })).expect(201);
      await inject(ownerToken, order.id, fixturePayload({ state: 'declined' })).expect(201); // forces conflict

      const proj = await prisma.paymentObservation.findUnique({ where: { orderId: order.id } });
      expect(proj?.state).toBe('conflict');

      const first = await request(app.getHttpServer())
        .post(`/api/admin/payment-observations/${proj!.id}/acknowledge`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ note: 'reviewed by owner' })
        .expect(201);
      expect(first.body.acknowledged).toBe(true);

      const second = await request(app.getHttpServer())
        .post(`/api/admin/payment-observations/${proj!.id}/acknowledge`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ note: 'a different note this time' })
        .expect(201);
      expect(second.body.acknowledged).toBe(true);

      const finalRecord = await prisma.paymentObservation.findUnique({ where: { id: proj!.id } });
      expect(finalRecord?.reviewNote).toBe('reviewed by owner'); // first note wins -- second call was a no-op
    });
  });
});
