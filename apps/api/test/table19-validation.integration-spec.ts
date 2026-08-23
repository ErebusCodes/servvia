// Integration test against a REAL local Postgres (see
// local-postgres/README.md) — no mocking. Exercises the Table 19
// controlled-validation guard end to end: OrdersService.createStaffOrder's
// gate, the one-open-run-only enforcement, the authorised-operator reset
// endpoint, and non-production hard-disable — all through the real HTTP
// surface, the same way a browser/device would.
//
// This suite mutates process.env.TABLE19_LIVE_TEST_ENABLED/
// TABLE19_LIVE_TEST_VENUE_ID/NODE_ENV for the duration of its own tests and
// restores every original value in afterAll (these are read live via
// process.env at call time by OrdersService, not snapshotted at module
// bootstrap — see orders.service.ts's own comments) — this is essential
// because `npm run test:integration --runInBand` runs every *.integration-
// spec.ts file in the same OS process, so a leaked value here would affect
// unrelated order-creation tests in other files.
//
// Run with: npm run test:integration --workspace=apps/api
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Table 19 controlled-validation guard (integration, real local Postgres)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let accessToken: string;
  let venueId: string;
  let organizationId: string;
  let menuItemId: string;
  let table19Id: string;
  let otherTableId: string;

  const TAG = 'table19-validation-integration-test';
  let originalEnabled: string | undefined;
  let originalVenueId: string | undefined;
  let originalNodeEnv: string | undefined;

  beforeAll(async () => {
    originalEnabled = process.env.TABLE19_LIVE_TEST_ENABLED;
    originalVenueId = process.env.TABLE19_LIVE_TEST_VENUE_ID;
    originalNodeEnv = process.env.NODE_ENV;

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    prisma = app.get(PrismaService);

    const venue = await prisma.venue.findFirstOrThrow({ where: { slug: 'auckland' } });
    venueId = venue.id;
    organizationId = venue.organizationId;

    const menuItem = await prisma.menuItem.findFirstOrThrow({
      where: { organizationId, deletedAt: null, isAvailable: true },
    });
    menuItemId = menuItem.id;

    // Neither the persistent local dev DB nor the disposable verify DB seeds
    // a real Table 19 row (both stop at 18) -- the seed's own venue only
    // ever needed 18 tables before this feature. Real Table 19 is expected
    // to already exist at the actual venue for the eventual live validation
    // (task's own checklist item 1: "Table 19 is free and approved for
    // testing"); this idempotent upsert ensures Verdura's own Table model
    // mirrors that for local/CI runs, without disturbing any other seeded
    // table. Deliberately not deleted in afterAll -- it is a legitimate,
    // permanent venue table, not disposable test data.
    const table19 = await prisma.table.upsert({
      where: { venueId_tableNumber: { venueId, tableNumber: '19' } },
      update: { isActive: true },
      create: { venueId, tableNumber: '19', capacity: 2, isActive: true },
    });
    table19Id = table19.id;
    // Any table that is NOT 19 and currently has no active order -- a plain
    // "first non-19 table" can collide with a leftover active order from
    // another integration-spec file sharing this same local dev database.
    const candidates = await prisma.table.findMany({
      where: { venueId, tableNumber: { not: '19' }, isActive: true },
      orderBy: { sortOrder: 'asc' },
    });
    let resolvedOtherTableId: string | undefined;
    for (const candidate of candidates) {
      const active = await prisma.order.findFirst({
        where: {
          tableId: candidate.id,
          status: { in: ['pending', 'confirmed', 'preparing', 'ready'] },
        },
      });
      if (!active) {
        resolvedOtherTableId = candidate.id;
        break;
      }
    }
    if (!resolvedOtherTableId)
      throw new Error('No free non-Table-19 table available for this integration test');
    otherTableId = resolvedOtherTableId;

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
    if (originalEnabled === undefined) delete process.env.TABLE19_LIVE_TEST_ENABLED;
    else process.env.TABLE19_LIVE_TEST_ENABLED = originalEnabled;
    if (originalVenueId === undefined) delete process.env.TABLE19_LIVE_TEST_VENUE_ID;
    else process.env.TABLE19_LIVE_TEST_VENUE_ID = originalVenueId;
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;

    const taggedOrders = await prisma.order.findMany({
      where: { notes: { contains: TAG } },
      select: { id: true },
    });
    const orderIds = taggedOrders.map((o) => o.id);
    await prisma.table19ValidationRun.deleteMany({ where: { orderId: { in: orderIds } } });
    await prisma.orderItem.deleteMany({ where: { orderId: { in: orderIds } } });
    await prisma.order.deleteMany({ where: { id: { in: orderIds } } });

    await app.close();
    await prisma.$disconnect();
  });

  function submitOrder(tableId: string, idempotencyKey: string) {
    return request(app.getHttpServer())
      .post('/api/admin/orders')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        venueId,
        tableId,
        serviceMode: 'dine_in',
        notes: TAG,
        idempotencyKey,
        items: [{ menuItemId, quantity: 1 }],
      });
  }

  it('is fully inert when unset -- a non-Table-19 order succeeds normally', async () => {
    delete process.env.TABLE19_LIVE_TEST_ENABLED;
    delete process.env.TABLE19_LIVE_TEST_VENUE_ID;

    const res = await submitOrder(otherTableId, `${TAG}-inert-${Date.now()}`).expect(201);
    await prisma.orderItem.deleteMany({ where: { orderId: res.body.id } });
    await prisma.order.deleteMany({ where: { id: res.body.id } });
  });

  it('rejects a non-Table-19 order once active, before any order is created', async () => {
    process.env.TABLE19_LIVE_TEST_ENABLED = 'true';
    process.env.TABLE19_LIVE_TEST_VENUE_ID = venueId;

    const before = await prisma.order.count();
    await submitOrder(otherTableId, `${TAG}-reject-${Date.now()}`).expect(403);
    const after = await prisma.order.count();
    expect(after).toBe(before);
  });

  it('is inert in NODE_ENV=production even with both env vars set', async () => {
    process.env.TABLE19_LIVE_TEST_ENABLED = 'true';
    process.env.TABLE19_LIVE_TEST_VENUE_ID = venueId;
    process.env.NODE_ENV = 'production';
    try {
      const res = await submitOrder(otherTableId, `${TAG}-prod-inert-${Date.now()}`).expect(201);
      await prisma.orderItem.deleteMany({ where: { orderId: res.body.id } });
      await prisma.order.deleteMany({ where: { id: res.body.id } });
    } finally {
      process.env.NODE_ENV = 'test';
    }
  });

  it('allows exactly one Table 19 order, then rejects a second until reset', async () => {
    process.env.TABLE19_LIVE_TEST_ENABLED = 'true';
    process.env.TABLE19_LIVE_TEST_VENUE_ID = venueId;

    const first = await submitOrder(table19Id, `${TAG}-t19-first-${Date.now()}`).expect(201);
    expect(first.body.notes).toMatch(/^TABLE19-VALIDATION-/);

    const run = await prisma.table19ValidationRun.findFirstOrThrow({
      where: { orderId: first.body.id },
    });
    expect(run.resetAt).toBeNull();

    // Free Table 19 again (as an operator closing out the first controlled
    // order would) so the SECOND attempt reaches the Table19ValidationRun
    // gate itself, not merely validateTableForOrder's unrelated
    // one-active-order-per-table guard -- proves the DB-enforced
    // one-run-only gate specifically, not just an in-memory check.
    await prisma.order.update({ where: { id: first.body.id }, data: { status: 'completed' } });
    await submitOrder(table19Id, `${TAG}-t19-second-${Date.now()}`).expect(403);

    // Authorised-operator reset clears the gate.
    await request(app.getHttpServer())
      .post('/api/admin/table19-validation/reset')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(201);

    const resetRun = await prisma.table19ValidationRun.findUniqueOrThrow({
      where: { id: run.id },
    });
    expect(resetRun.resetAt).not.toBeNull();

    // Now a new Table 19 order succeeds again.
    const second = await submitOrder(table19Id, `${TAG}-t19-after-reset-${Date.now()}`).expect(201);

    await prisma.table19ValidationRun.deleteMany({
      where: { orderId: { in: [first.body.id, second.body.id] } },
    });
    await prisma.orderItem.deleteMany({
      where: { orderId: { in: [first.body.id, second.body.id] } },
    });
    await prisma.order.deleteMany({ where: { id: { in: [first.body.id, second.body.id] } } });
  });

  it('reset returns 404 when no venue is configured', async () => {
    delete process.env.TABLE19_LIVE_TEST_VENUE_ID;
    await request(app.getHttpServer())
      .post('/api/admin/table19-validation/reset')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(404);
  });
});
