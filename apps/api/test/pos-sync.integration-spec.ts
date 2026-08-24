// Integration test against a REAL local Postgres (see
// local-postgres/README.md) — no mocking of Prisma. Exercises Story 9-1's
// truthful POSSyncRecord state machine: the processor's real database
// compare-and-swap transitions, the historical-fabrication correction
// script, the admin visibility API's org/venue scoping, and order-creation
// wiring.
//
// No test here asserts `synced`, because no code path in this codebase can
// produce it yet — no real Idealpos adapter exists (blocked on DL-064).
//
// Run with: npm run test:integration --workspace=backend
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { getQueueToken } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { PosSyncProcessor } from '../src/queue/processors/pos-sync.processor';
import { AuthService } from '../src/auth/auth.service';
import { QUEUE_NAMES } from '../src/queue/queue.module';
import { correctFabricatedPosSyncRecords } from '../prisma/scripts/correct-fabricated-pos-sync-records';
import { OrdersService } from '../src/orders/orders.service';
import { POSAdapterType, POSSyncStatus } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

describe('POS Sync (integration, real local Postgres)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let processor: PosSyncProcessor;
  let authService: AuthService;
  let posSyncQueue: Queue;
  let accessToken: string;
  let venueId: string;
  let organizationId: string;

  const TAG = 'phase9-1-integration-test';

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
    processor = app.get(PosSyncProcessor);
    authService = app.get(AuthService);
    posSyncQueue = app.get(getQueueToken(QUEUE_NAMES.POS_SYNC));

    const venue = await prisma.venue.findFirstOrThrow({ where: { slug: 'auckland' } });
    venueId = venue.id;
    organizationId = venue.organizationId;

    const loginRes = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({
        email: process.env.SEED_OWNER_EMAIL ?? 'owner@verdura.co.nz',
        password: process.env.SEED_OWNER_PASSWORD,
      })
      .expect(200);
    accessToken = loginRes.body.accessToken as string;
  });

  afterAll(async () => {
    await prisma.pOSSyncRecord.deleteMany({ where: { order: { notes: { contains: TAG } } } });
    await prisma.order.deleteMany({ where: { notes: { contains: TAG } } });
    await app.close();
    await prisma.$disconnect();
  });

  async function makeOrder(overrides: Record<string, unknown> = {}) {
    return prisma.order.create({
      data: {
        venueId,
        status: 'confirmed',
        posSyncStatus: POSSyncStatus.not_synced,
        subtotalCents: 1000,
        taxCents: 150,
        totalCents: 1150,
        source: 'staff',
        notes: TAG,
        idempotencyKey: `${TAG}-${Date.now()}-${Math.random()}`,
        ...overrides,
      },
    });
  }

  async function makeRecord(orderId: string, overrides: Record<string, unknown> = {}) {
    return prisma.pOSSyncRecord.create({
      data: {
        orderId,
        venueId,
        adapterType: POSAdapterType.api,
        status: POSSyncStatus.not_synced,
        attemptCount: 0,
        ...overrides,
      },
    });
  }

  describe('behavior matrix', () => {
    it('a none-adapter record resolves to not_applicable, never synced, no posOrderId', async () => {
      const order = await makeOrder();
      const record = await makeRecord(order.id, { adapterType: POSAdapterType.none });
      try {
        await processor.process({ data: { posSyncRecordId: record.id } } as any);
        const reloaded = await prisma.pOSSyncRecord.findUniqueOrThrow({ where: { id: record.id } });
        expect(reloaded.status).toBe(POSSyncStatus.not_applicable);
        expect(reloaded.posOrderId).toBeNull();
        const reloadedOrder = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
        expect(reloadedOrder.posSyncStatus).toBe(POSSyncStatus.not_applicable);
      } finally {
        await prisma.pOSSyncRecord.deleteMany({ where: { orderId: order.id } });
        await prisma.order.delete({ where: { id: order.id } });
      }
    });

    it.each([
      POSAdapterType.api,
      POSAdapterType.sql,
      POSAdapterType.odbc,
      POSAdapterType.csv,
      POSAdapterType.local_agent,
    ])(
      'a %s-adapter record (no real implementation) resolves to unsupported, never synced, no posOrderId',
      async (adapterType) => {
        const order = await makeOrder();
        const record = await makeRecord(order.id, { adapterType });
        try {
          await processor.process({ data: { posSyncRecordId: record.id } } as any);
          const reloaded = await prisma.pOSSyncRecord.findUniqueOrThrow({
            where: { id: record.id },
          });
          expect(reloaded.status).toBe(POSSyncStatus.unsupported);
          expect(reloaded.posOrderId).toBeNull();
          expect(reloaded.errorMessage).toContain(adapterType);
          expect(reloaded.errorMessage).not.toBeNull();
          const reloadedOrder = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
          expect(reloadedOrder.posSyncStatus).toBe(POSSyncStatus.unsupported);
        } finally {
          await prisma.pOSSyncRecord.deleteMany({ where: { orderId: order.id } });
          await prisma.order.delete({ where: { id: order.id } });
        }
      },
    );

    it('a record already resolved (terminal) is never re-processed', async () => {
      const order = await makeOrder({ posSyncStatus: POSSyncStatus.unsupported });
      const record = await makeRecord(order.id, {
        status: POSSyncStatus.unsupported,
        errorMessage: 'original classification',
      });
      try {
        await processor.process({ data: { posSyncRecordId: record.id } } as any);
        const reloaded = await prisma.pOSSyncRecord.findUniqueOrThrow({ where: { id: record.id } });
        expect(reloaded.errorMessage).toBe('original classification');
        expect(reloaded.updatedAt.getTime()).toBe(record.updatedAt.getTime());
      } finally {
        await prisma.pOSSyncRecord.deleteMany({ where: { orderId: order.id } });
        await prisma.order.delete({ where: { id: order.id } });
      }
    });

    it('a genuinely concurrent duplicate delivery of the same record resolves to exactly one outcome, never overwritten', async () => {
      const order = await makeOrder();
      const record = await makeRecord(order.id, { adapterType: POSAdapterType.api });
      try {
        const results = await Promise.allSettled([
          processor.process({ data: { posSyncRecordId: record.id } } as any),
          processor.process({ data: { posSyncRecordId: record.id } } as any),
        ]);
        expect(results.every((r) => r.status === 'fulfilled')).toBe(true);

        const reloaded = await prisma.pOSSyncRecord.findUniqueOrThrow({ where: { id: record.id } });
        expect(reloaded.status).toBe(POSSyncStatus.unsupported);
        const reloadedOrder = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
        expect(reloadedOrder.posSyncStatus).toBe(POSSyncStatus.unsupported);
      } finally {
        await prisma.pOSSyncRecord.deleteMany({ where: { orderId: order.id } });
        await prisma.order.delete({ where: { id: order.id } });
      }
    });

    it('POS-sync resolution never mutates Order.status (independence from the kitchen/service workflow state)', async () => {
      const order = await makeOrder({ status: 'preparing' });
      const record = await makeRecord(order.id, { adapterType: POSAdapterType.api });
      try {
        await processor.process({ data: { posSyncRecordId: record.id } } as any);
        const reloadedOrder = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
        expect(reloadedOrder.status).toBe('preparing');
        expect(reloadedOrder.posSyncStatus).toBe(POSSyncStatus.unsupported);
      } finally {
        await prisma.pOSSyncRecord.deleteMany({ where: { orderId: order.id } });
        await prisma.order.delete({ where: { id: order.id } });
      }
    });
  });

  describe('order creation wiring (Story 9-1 In Scope item 4: consistent, not fabricating-if-fired)', () => {
    it('a non-none-adapter venue order, created through the real OrdersService, gets a not_synced POSSyncRecord that is never enqueued onto the pos-sync queue', async () => {
      const ordersService = app.get(OrdersService);
      const apiVenue = await prisma.venue.create({
        data: {
          organizationId,
          name: `${TAG} api-adapter venue`,
          slug: `${TAG}-api-venue-${Date.now()}`,
          address: {},
          operatingHours: {},
          seatingCapacity: 10,
          posAdapterType: POSAdapterType.api,
        },
      });
      const table = await prisma.table.create({
        data: { venueId: apiVenue.id, tableNumber: 'T1', capacity: 4 },
      });
      const menuItem = await prisma.menuItem.findFirstOrThrow({
        where: { organizationId, deletedAt: null, isAvailable: true },
      });
      const staff = await prisma.staff.findFirstOrThrow({ where: { organizationId } });
      try {
        const beforeCounts = await posSyncQueue.getJobCounts('waiting', 'active', 'delayed');

        const order = await ordersService.createStaffOrder(
          {
            venueId: apiVenue.id,
            tableId: table.id,
            serviceMode: 'dine_in' as const,
            idempotencyKey: `${TAG}-staff-${Date.now()}`,
            items: [{ menuItemId: menuItem.id, quantity: 1 }],
          },
          organizationId,
          { id: staff.id, email: staff.email, role: staff.role },
        );

        const record = await prisma.pOSSyncRecord.findUnique({ where: { orderId: order.id } });
        expect(record).not.toBeNull();
        expect(record?.status).toBe(POSSyncStatus.not_synced);
        expect(record?.adapterType).toBe(POSAdapterType.api);
        expect(record?.posOrderId).toBeNull();

        // The queue is deliberately never fed (see the comment in
        // OrdersService.persistOrder and deferred-work.md) — a real order
        // creation must not silently start enqueueing jobs onto a queue
        // whose processor has no real Idealpos adapter to run.
        const afterCounts = await posSyncQueue.getJobCounts('waiting', 'active', 'delayed');
        expect(afterCounts.waiting + afterCounts.active + afterCounts.delayed).toBe(
          beforeCounts.waiting + beforeCounts.active + beforeCounts.delayed,
        );
      } finally {
        await prisma.pOSSyncRecord.deleteMany({ where: { venueId: apiVenue.id } });
        await prisma.printerJob.deleteMany({ where: { venueId: apiVenue.id } });
        await prisma.orderItem.deleteMany({ where: { order: { venueId: apiVenue.id } } });
        await prisma.order.deleteMany({ where: { venueId: apiVenue.id } });
        await prisma.table.delete({ where: { id: table.id } });
        await prisma.venue.delete({ where: { id: apiVenue.id } });
      }
    });
  });

  describe('historical fabrication correction (AC5)', () => {
    it('corrects a synced + IDEAL-* fabricated record to unsupported and clears the fabricated evidence', async () => {
      const order = await makeOrder({ posSyncStatus: POSSyncStatus.synced });
      // Bypass the (now-removed) fabrication code path directly, to
      // reproduce exactly the historical row shape it used to produce.
      const record = await prisma.pOSSyncRecord.create({
        data: {
          orderId: order.id,
          venueId,
          adapterType: POSAdapterType.api,
          status: POSSyncStatus.synced,
          posOrderId: `IDEAL-${order.id.substring(0, 8).toUpperCase()}`,
          responsePayload: { status: 'success', importedOrderId: 'IDEAL-FAKE' },
          syncedAt: new Date(),
          attemptCount: 1,
        },
      });
      try {
        const result = await correctFabricatedPosSyncRecords(prisma);
        expect(result.recordsCorrected).toBeGreaterThanOrEqual(1);
        expect(result.ordersCorrected).toBeGreaterThanOrEqual(1);

        const reloaded = await prisma.pOSSyncRecord.findUniqueOrThrow({ where: { id: record.id } });
        expect(reloaded.status).toBe(POSSyncStatus.unsupported);
        expect(reloaded.posOrderId).toBeNull();
        expect(reloaded.responsePayload).toBeNull();
        expect(reloaded.syncedAt).toBeNull();
        expect(reloaded.errorMessage).toContain('Corrected');

        const reloadedOrder = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
        expect(reloadedOrder.posSyncStatus).toBe(POSSyncStatus.unsupported);

        // Idempotent: running it again finds nothing left to correct.
        const secondRun = await correctFabricatedPosSyncRecords(prisma);
        expect(secondRun.recordsCorrected).toBe(0);
        expect(secondRun.ordersCorrected).toBe(0);
      } finally {
        await prisma.pOSSyncRecord.deleteMany({ where: { orderId: order.id } });
        await prisma.order.delete({ where: { id: order.id } });
      }
    });

    it('a none-adapter venue fabricated record is corrected to not_applicable, not unsupported', async () => {
      const order = await makeOrder({ posSyncStatus: POSSyncStatus.synced });
      const record = await prisma.pOSSyncRecord.create({
        data: {
          orderId: order.id,
          venueId, // seeded 'auckland' venue, posAdapterType: none
          adapterType: POSAdapterType.none,
          status: POSSyncStatus.synced,
          posOrderId: `IDEAL-${order.id.substring(0, 8).toUpperCase()}`,
          syncedAt: new Date(),
        },
      });
      try {
        await correctFabricatedPosSyncRecords(prisma);
        const reloaded = await prisma.pOSSyncRecord.findUniqueOrThrow({ where: { id: record.id } });
        expect(reloaded.status).toBe(POSSyncStatus.not_applicable);
        expect(reloaded.posOrderId).toBeNull();
      } finally {
        await prisma.pOSSyncRecord.deleteMany({ where: { orderId: order.id } });
        await prisma.order.delete({ where: { id: order.id } });
      }
    });
  });

  describe('admin visibility API (AC6)', () => {
    it('lists POS-sync records for a venue through the admin API, showing unsupported/not_applicable honestly', async () => {
      const order1 = await makeOrder();
      const order2 = await makeOrder();
      const record1 = await makeRecord(order1.id, { status: POSSyncStatus.unsupported });
      const record2 = await makeRecord(order2.id, {
        status: POSSyncStatus.not_applicable,
        adapterType: POSAdapterType.none,
      });
      try {
        const res = await request(app.getHttpServer())
          .get(`/api/admin/venues/${venueId}/pos-sync-records`)
          .set('Authorization', `Bearer ${accessToken}`)
          .expect(200);

        const ids = (res.body as Array<{ id: string; status: string }>).map((r) => r.id);
        expect(ids).toEqual(expect.arrayContaining([record1.id, record2.id]));
        const byId = new Map(
          (res.body as Array<{ id: string; status: string }>).map((r) => [r.id, r.status]),
        );
        expect(byId.get(record1.id)).toBe(POSSyncStatus.unsupported);
        expect(byId.get(record2.id)).toBe(POSSyncStatus.not_applicable);
      } finally {
        await prisma.pOSSyncRecord.deleteMany({
          where: { orderId: { in: [order1.id, order2.id] } },
        });
        await prisma.order.deleteMany({ where: { id: { in: [order1.id, order2.id] } } });
      }
    });

    it('returns the truthful mirrored status for a none-adapter order with no POSSyncRecord row', async () => {
      const order = await makeOrder({ posSyncStatus: POSSyncStatus.not_applicable });
      try {
        const res = await request(app.getHttpServer())
          .get(`/api/admin/orders/${order.id}/pos-sync`)
          .set('Authorization', `Bearer ${accessToken}`)
          .expect(200);
        expect(res.body.status).toBe(POSSyncStatus.not_applicable);
      } finally {
        await prisma.order.delete({ where: { id: order.id } });
      }
    });

    it('rejects listing records for a venue belonging to another organization, 404 not disclosure', async () => {
      const otherOrg = await prisma.organization.create({
        data: {
          name: `${TAG} other org`,
          slug: `${TAG}-other-org-${Date.now()}`,
          billingEmail: 'other-org@verdura.internal',
        },
      });
      const otherVenue = await prisma.venue.create({
        data: {
          organizationId: otherOrg.id,
          name: `${TAG} other venue`,
          slug: `${TAG}-other-venue-${Date.now()}`,
          address: {},
          operatingHours: {},
          seatingCapacity: 10,
        },
      });
      try {
        await request(app.getHttpServer())
          .get(`/api/admin/venues/${otherVenue.id}/pos-sync-records`)
          .set('Authorization', `Bearer ${accessToken}`)
          .expect(404);
      } finally {
        await prisma.venue.delete({ where: { id: otherVenue.id } });
        await prisma.organization.delete({ where: { id: otherOrg.id } });
      }
    });

    it('a KDS device token scoped to one venue cannot list POS-sync records for another venue in the same org', async () => {
      const secondVenue = await prisma.venue.create({
        data: {
          organizationId,
          name: `${TAG} second venue`,
          slug: `${TAG}-second-venue-${Date.now()}`,
          address: {},
          operatingHours: {},
          seatingCapacity: 10,
        },
      });
      try {
        const kdsToken = authService.signKdsDeviceToken(venueId, organizationId);

        await request(app.getHttpServer())
          .get(`/api/admin/venues/${secondVenue.id}/pos-sync-records`)
          .set('Authorization', `Bearer ${kdsToken}`)
          .expect(403);
      } finally {
        await prisma.venue.delete({ where: { id: secondVenue.id } });
      }
    });

    it('a KDS device token may view its own venue records', async () => {
      const kdsToken = authService.signKdsDeviceToken(venueId, organizationId);
      await request(app.getHttpServer())
        .get(`/api/admin/venues/${venueId}/pos-sync-records`)
        .set('Authorization', `Bearer ${kdsToken}`)
        .expect(200);
    });

    it('rejects an unauthenticated request', async () => {
      await request(app.getHttpServer())
        .get(`/api/admin/venues/${venueId}/pos-sync-records`)
        .expect(401);
    });
  });

  describe('static fabrication-removal evidence (AC4)', () => {
    it('the processor source contains no IDEAL- fabrication literal and no synced status assignment', () => {
      const source = fs.readFileSync(
        path.join(__dirname, '../src/queue/processors/pos-sync.processor.ts'),
        'utf8',
      );
      // The word "IDEAL-" only survives in an explanatory comment about the
      // removed bug — no fabrication *construct* (a template literal that
      // would build a synthesized transaction ID) may remain.
      expect(source).not.toMatch(/`IDEAL-\$\{/);
      expect(source).not.toMatch(/posOrderId:\s*[`'"]IDEAL/);
      expect(source).not.toMatch(/status:\s*POSSyncStatus\.synced/);
    });
  });

  describe('migration/script SQL parity (independent-review finding: undetected drift risk)', () => {
    it('the migration.sql UPDATE statements and the standalone script are textually identical, not just behaviorally similar', () => {
      // The correction logic exists in two independently hand-maintained
      // places — the frozen migration file (applied once, never edited
      // after landing) and prisma/scripts/correct-fabricated-pos-sync-records.ts
      // (re-runnable on demand). Nothing previously guarded against them
      // silently drifting apart after this story landed. This test fails
      // loudly the moment either file's SQL changes without the other.
      const migrationSql = fs.readFileSync(
        path.join(
          __dirname,
          '../prisma/migrations/20260815150100_pos_sync_correct_fabricated_records/migration.sql',
        ),
        'utf8',
      );
      const scriptSource = fs.readFileSync(
        path.join(__dirname, '../prisma/scripts/correct-fabricated-pos-sync-records.ts'),
        'utf8',
      );

      const scriptRecordsSql = scriptSource.match(
        /const recordsCorrected = await prisma\.\$executeRaw`([\s\S]*?)`;/,
      )?.[1];
      const scriptOrdersSql = scriptSource.match(
        /const ordersCorrected = await prisma\.\$executeRaw`([\s\S]*?)`;/,
      )?.[1];
      expect(scriptRecordsSql).toBeDefined();
      expect(scriptOrdersSql).toBeDefined();

      const migrationRecordsSql = migrationSql.match(
        /(UPDATE "POSSyncRecord"[\s\S]*?WHERE status = 'synced';)/,
      )?.[1];
      const migrationOrdersSql = migrationSql.match(
        /(UPDATE "Order" o[\s\S]*?AND o\."posSyncStatus" = 'synced';)/,
      )?.[1];
      expect(migrationRecordsSql).toBeDefined();
      expect(migrationOrdersSql).toBeDefined();

      // Normalize whitespace only (indentation legitimately differs — the
      // script's SQL is nested inside a function body, and its
      // `$executeRaw` template literal omits the trailing semicolon that
      // Prisma doesn't require but the standalone migration.sql needs)
      // — everything else must match exactly.
      const normalize = (sql: string) => sql.replace(/\s+/g, ' ').trim().replace(/;$/, '');

      expect(normalize(scriptRecordsSql!)).toBe(normalize(migrationRecordsSql!));
      expect(normalize(scriptOrdersSql!)).toBe(normalize(migrationOrdersSql!));
    });
  });
});
