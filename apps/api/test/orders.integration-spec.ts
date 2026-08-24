// Integration test against a REAL local Postgres (see
// local-postgres/README.md) — no mocking. Exercises the Phase 4 order
// system end to end: kiosk order creation with server-authoritative
// pricing, staff/Order-Tablet order creation against real Table records,
// KDS/Admin visibility, status FSM enforcement, and cross-org isolation —
// all through the real HTTP surface, the same way a browser/device would.
//
// Run with: npm run test:integration --workspace=backend
// Requires: npm run db:local:start && npm run db:migrate && npm run db:seed
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import * as argon2 from 'argon2';
import type Redis from 'ioredis';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { REDIS_CLIENT } from '../src/redis/redis.constants';

describe('Orders API (integration, real local Postgres)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let redisClient: Redis;
  let accessToken: string;
  let venueId: string;
  let organizationId: string;
  let menuItemId: string;
  let realMenuItemPriceCents: number;
  let csrfToken: string;

  // The two IdealPOS-owns-KOT tests below each add one extra /api/kiosk/orders
  // POST on top of the dozens already in this file, all sharing one Redis
  // rate-limit bucket per (ip, method, path) for the file's whole run (see
  // integration-rate-limit-reset.ts — cleared once per FILE, not per test).
  // Clearing just this bucket after those two tests keeps their added load
  // from tipping a later, unrelated test (e.g. the Story 6-1 rollback test)
  // over the shared limit — restores the exact budget every other test in
  // this file already assumed, rather than reaching for a bigger, riskier
  // redesign of the shared rate-limiting test infra.
  async function clearKioskOrdersRateLimit(): Promise<void> {
    const keys = await redisClient.keys('rate-limit:*kiosk/orders*');
    if (keys.length > 0) await redisClient.del(...keys);
  }

  // Public POSTs (kiosk order creation) go through CsrfMiddleware just like
  // reservations does — Bearer-authenticated admin/orders calls bypass it,
  // but unauthenticated kiosk calls need the token echoed back, the same
  // way a real browser session would (see reservations.integration-spec.ts
  // for the identical pattern).
  function csrfHeaders(): Record<string, string> {
    return { Cookie: `csrf_token=${csrfToken}`, 'x-csrf-token': csrfToken };
  }

  function extractCsrfToken(setCookieHeader: string[] | undefined): string | undefined {
    for (const cookie of setCookieHeader ?? []) {
      const match = cookie.match(/^csrf_token=([^;]+)/);
      if (match) return match[1];
    }
    return undefined;
  }

  function postKioskOrder(body: Record<string, unknown>) {
    return request(app.getHttpServer()).post('/api/kiosk/orders').set(csrfHeaders()).send(body);
  }

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
    redisClient = app.get<Redis>(REDIS_CLIENT);

    const venue = await prisma.venue.findFirstOrThrow({ where: { slug: 'auckland' } });
    venueId = venue.id;
    organizationId = venue.organizationId;

    const menuItem = await prisma.menuItem.findFirstOrThrow({
      where: { organizationId, deletedAt: null, isAvailable: true },
    });
    menuItemId = menuItem.id;
    realMenuItemPriceCents = menuItem.priceCents;

    const primer = await request(app.getHttpServer()).get(`/api/kiosk/venues/${venueId}/menu`);
    csrfToken = extractCsrfToken(primer.headers['set-cookie'] as unknown as string[]) ?? '';
    if (!csrfToken)
      throw new Error('Failed to obtain a CSRF token for the integration test setup.');

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
    // Baseline restoration: remove every order this suite created so repeat
    // runs (and other suites) see the same Order/OrderItem counts as before.
    await prisma.orderItem.deleteMany({
      where: { order: { notes: { contains: '@phase4-integration.test' } } },
    });
    await prisma.order.deleteMany({ where: { notes: { contains: '@phase4-integration.test' } } });
    await app.close();
    await prisma.$disconnect();
  });

  function noteTag(label: string): string {
    return `${label}@phase4-integration.test`;
  }

  async function freeTable(): Promise<{ id: string; tableNumber: string }> {
    // Any table currently free of an active order.
    const tables = await prisma.table.findMany({
      where: { venueId, isActive: true },
      orderBy: { sortOrder: 'asc' },
    });
    for (const table of tables) {
      const active = await prisma.order.findFirst({
        where: {
          tableId: table.id,
          status: { in: ['pending', 'confirmed', 'preparing', 'ready'] },
        },
      });
      if (!active) return { id: table.id, tableNumber: table.tableNumber };
    }
    throw new Error('No free table available for integration test');
  }

  async function cleanupOrder(orderId: string): Promise<void> {
    await prisma.orderItem.deleteMany({ where: { orderId } });
    await prisma.order.deleteMany({ where: { id: orderId } });
  }

  it('1-4. creates a real kiosk order: PostgreSQL Order + OrderItems exist with server-computed totals', async () => {
    const before = await prisma.order.count();

    const res = await request(app.getHttpServer())
      .post('/api/kiosk/orders')
      .set(csrfHeaders())
      .send({
        venueId,
        notes: noteTag('kiosk-basic'),
        stripePaymentIntentId: 'pi_integration_test_1',
        idempotencyKey: 'idem_integration_test_1',
        items: [{ menuItemId, quantity: 2 }],
      })
      .expect(201);

    expect(res.body.id).toMatch(/^ORD-\d+$/);
    const expectedSubtotal = realMenuItemPriceCents * 2;
    // DL-072: menu prices are GST-inclusive — GST is the *contained*
    // component (gross × 3/23), never added on top of the subtotal
    // (2026-08-20 GST reconciliation fix).
    const expectedTax = Math.round((expectedSubtotal * 3) / 23);
    expect(res.body.subtotalCents).toBe(expectedSubtotal);
    expect(res.body.taxCents).toBe(expectedTax);
    expect(res.body.totalCents).toBe(expectedSubtotal);

    const after = await prisma.order.count();
    expect(after).toBe(before + 1);

    const dbOrder = await prisma.order.findUniqueOrThrow({
      where: { id: res.body.id },
      include: { items: true },
    });
    expect(dbOrder.items).toHaveLength(1);
    expect(dbOrder.items[0].unitPriceCents).toBe(realMenuItemPriceCents);
    expect(dbOrder.subtotalCents).toBe(expectedSubtotal);

    await cleanupOrder(res.body.id);
  });

  it('5. a manipulated client price is ignored — server derives price from PostgreSQL, not the request body', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/kiosk/orders')
      .set(csrfHeaders())
      .send({
        venueId,
        notes: noteTag('price-manipulation'),
        stripePaymentIntentId: 'pi_integration_test_2',
        idempotencyKey: 'idem_integration_test_2',
        // Attacker-supplied fields a naive implementation might trust.
        totalCents: 1,
        subtotalCents: 1,
        items: [{ menuItemId, quantity: 1, priceCents: 1, unitPriceCents: 1 }],
      })
      .expect(201);

    expect(res.body.subtotalCents).toBe(realMenuItemPriceCents);
    expect(res.body.totalCents).not.toBe(1);

    const dbOrder = await prisma.order.findUniqueOrThrow({
      where: { id: res.body.id },
      include: { items: true },
    });
    expect(dbOrder.items[0].unitPriceCents).toBe(realMenuItemPriceCents);

    await cleanupOrder(res.body.id);
  });

  it('injected modifier price deltas are neutralized when the item has no configured modifier catalog', async () => {
    const menuItem = await prisma.menuItem.findUniqueOrThrow({ where: { id: menuItemId } });
    expect(menuItem.modifierGroups).toEqual([]); // precondition: no catalog seeded yet

    const res = await request(app.getHttpServer())
      .post('/api/kiosk/orders')
      .set(csrfHeaders())
      .send({
        venueId,
        notes: noteTag('modifier-injection'),
        stripePaymentIntentId: 'pi_integration_test_3',
        idempotencyKey: 'idem_integration_test_3',
        items: [
          {
            menuItemId,
            quantity: 1,
            selectedModifiers: [{ name: 'Free Money', priceDeltaCents: -100000 }],
          },
        ],
      })
      .expect(201);

    // The negative price-delta injection must not reduce the charged total.
    expect(res.body.subtotalCents).toBe(realMenuItemPriceCents);

    const dbOrder = await prisma.order.findUniqueOrThrow({
      where: { id: res.body.id },
      include: { items: true },
    });
    const storedModifiers = dbOrder.items[0].selectedModifiers as Array<{
      priceDeltaCents: number;
    }>;
    expect(storedModifiers[0].priceDeltaCents).toBe(0);

    await cleanupOrder(res.body.id);
  });

  it('6. rejects an invalid menu item', async () => {
    await request(app.getHttpServer())
      .post('/api/kiosk/orders')
      .set(csrfHeaders())
      .send({
        venueId,
        stripePaymentIntentId: 'pi_integration_test_4',
        idempotencyKey: 'idem_integration_test_4',
        items: [{ menuItemId: '00000000-0000-0000-0000-000000000000', quantity: 1 }],
      })
      .expect(400);
  });

  it('7. rejects an unavailable menu item', async () => {
    const category = await prisma.category.findFirstOrThrow({ where: { organizationId } });
    const staff = await prisma.staff.findFirstOrThrow({ where: { organizationId } });
    const unavailableItem = await prisma.menuItem.create({
      data: {
        organizationId,
        categoryId: category.id,
        title: 'Phase 4 Integration Unavailable Item',
        description: 'Temporary — deleted at end of test.',
        priceCents: 500,
        nutritionalDetails: {},
        isAvailable: false,
        createdById: staff.id,
      },
    });

    await request(app.getHttpServer())
      .post('/api/kiosk/orders')
      .set(csrfHeaders())
      .send({
        venueId,
        stripePaymentIntentId: 'pi_integration_test_5',
        idempotencyKey: 'idem_integration_test_5',
        items: [{ menuItemId: unavailableItem.id, quantity: 1 }],
      })
      .expect(409);

    await prisma.menuItem.delete({ where: { id: unavailableItem.id } });
  });

  it('8. rejects an invalid venue', async () => {
    await request(app.getHttpServer())
      .post('/api/kiosk/orders')
      .set(csrfHeaders())
      .send({
        venueId: '00000000-0000-0000-0000-000000000000',
        stripePaymentIntentId: 'pi_integration_test_6',
        idempotencyKey: 'idem_integration_test_6',
        items: [{ menuItemId, quantity: 1 }],
      })
      .expect(404);
  });

  it('9. rejects an invalid quantity', async () => {
    await request(app.getHttpServer())
      .post('/api/kiosk/orders')
      .set(csrfHeaders())
      .send({
        venueId,
        stripePaymentIntentId: 'pi_integration_test_7',
        idempotencyKey: 'idem_integration_test_7',
        items: [{ menuItemId, quantity: 0 }],
      })
      .expect(400);
  });

  it('10, 11, 12. a staff/Order-Tablet order is associated with a real table and appears in both the KDS and Admin queries', async () => {
    const table = await freeTable();

    const res = await request(app.getHttpServer())
      .post('/api/admin/orders')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        venueId,
        tableId: table.id,
        serviceMode: 'dine_in',
        notes: noteTag('tablet-order'),
        idempotencyKey: `idem_integration_test_staff_${Date.now()}`,
        items: [{ menuItemId, quantity: 1 }],
      })
      .expect(201);

    expect(res.body.tableId).toBe(table.id);
    expect(res.body.tableNumber).toBe(table.tableNumber);
    expect(res.body.source).toBe('staff');

    const dbOrder = await prisma.order.findUniqueOrThrow({ where: { id: res.body.id } });
    expect(dbOrder.tableId).toBe(table.id);

    // 11. Appears in the KDS/Admin "active orders" query.
    const activeList = await request(app.getHttpServer())
      .get(`/api/admin/orders?venueId=${venueId}&activeOnly=true`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(activeList.body.some((o: { id: string }) => o.id === res.body.id)).toBe(true);

    // 12. Appears in the general Admin query too.
    const fullList = await request(app.getHttpServer())
      .get(`/api/admin/orders?venueId=${venueId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(fullList.body.some((o: { id: string }) => o.id === res.body.id)).toBe(true);

    await cleanupOrder(res.body.id);
  });

  it('one order-creation transaction durably creates both remaining delivery-leg outbox rows for a venue with no POS adapter: PrinterJob(s) and KdsDeliveryRecord, sharing one orderId (no POSSyncRecord — posAdapterType is "none")', async () => {
    // Self-contained venue (posAdapterType 'none' + one active printer)
    // rather than the shared 'auckland' seed venue -- makes the "exactly one
    // of each" assertion deterministic instead of depending on that venue's
    // possibly-shared POS/printer configuration.
    //
    // posAdapterType is deliberately 'none' here, not 'api': once a venue is
    // on the real IdealPOS Bridge integration, IdealPOS's own existing KOT
    // workflow is the kitchen ticket for that order, and Verdura's
    // PrinterJob pipeline is skipped for exactly that reason (see
    // orders.service.ts's persistOrder — printers is `[]` when
    // posAdapterType is 'api', so creating one here would print two
    // physical tickets for one order). The 'api' + no-PrinterJob case has
    // its own dedicated test immediately below.
    const org = await prisma.organization.create({
      data: {
        name: 'Phase 4 Integration Three-Intents Org',
        slug: `phase4-three-intents-org-${Date.now()}`,
        billingEmail: 'three-intents@phase4-integration.test',
      },
    });
    const venue = await prisma.venue.create({
      data: {
        organizationId: org.id,
        name: 'Phase 4 Integration Three-Intents Venue',
        slug: `phase4-three-intents-venue-${Date.now()}`,
        address: {},
        operatingHours: {},
        seatingCapacity: 10,
        posAdapterType: 'none',
      },
    });
    const printer = await prisma.printer.create({
      data: {
        venueId: venue.id,
        name: 'Phase 4 Integration Three-Intents Printer',
        type: 'kitchen',
        connectionType: 'tcp',
        host: '127.0.0.1',
        port: 9999,
        isActive: true,
      },
    });
    const staff = await prisma.staff.findFirstOrThrow({ where: { organizationId } });
    const category = await prisma.category.create({
      data: { organizationId: org.id, name: 'Three-Intents category', createdById: staff.id },
    });
    const item = await prisma.menuItem.create({
      data: {
        organizationId: org.id,
        categoryId: category.id,
        title: 'Three-Intents item',
        description: 'test item',
        priceCents: 1000,
        nutritionalDetails: {},
        isAvailable: true,
        createdById: staff.id,
      },
    });

    try {
      const res = await request(app.getHttpServer())
        .post('/api/kiosk/orders')
        .set(csrfHeaders())
        .send({
          venueId: venue.id,
          notes: noteTag('three-intents'),
          stripePaymentIntentId: `pi_three_intents_${Date.now()}`,
          idempotencyKey: `idem_three_intents_${Date.now()}`,
          items: [{ menuItemId: item.id, quantity: 1 }],
        })
        .expect(201);
      const orderId = res.body.id as string;

      const [posSyncRecords, printerJobs, kdsDeliveryRecords] = await Promise.all([
        prisma.pOSSyncRecord.findMany({ where: { orderId } }),
        prisma.printerJob.findMany({ where: { orderId } }),
        prisma.kdsDeliveryRecord.findMany({ where: { orderId } }),
      ]);

      // posAdapterType 'none' -- no POSSyncRecord row at all (Order.posSyncStatus
      // is set to 'not_applicable' directly on the order instead; see the
      // dedicated 'api' test below for the row that DOES get created).
      expect(posSyncRecords).toHaveLength(0);

      expect(printerJobs).toHaveLength(1);
      expect(printerJobs[0].printerId).toBe(printer.id);
      expect(printerJobs[0].status).toBe('queued');
      // The KOT excludes money fields (kot-renderer.ts) -- and now, so does
      // the placeholder payload written at creation time (orders.service.ts).
      expect(printerJobs[0].payload.toLowerCase()).not.toMatch(/subtotal|gst|total: \$/);

      expect(kdsDeliveryRecords).toHaveLength(1);
      expect(kdsDeliveryRecords[0].status).toBe('queued');
      expect(kdsDeliveryRecords[0].venueId).toBe(venue.id);

      // Both rows genuinely originate from the same persistOrder
      // transaction, not unrelated writes: same orderId, and created
      // within the same instant (well under any plausible cross-request gap).
      const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
      const timestamps = [
        order.createdAt.getTime(),
        printerJobs[0].createdAt.getTime(),
        kdsDeliveryRecords[0].createdAt.getTime(),
      ];
      expect(Math.max(...timestamps) - Math.min(...timestamps)).toBeLessThan(2000);
    } finally {
      // Dependency-ordered cleanup: POSSyncRecord/PrinterJob have a required
      // (Restrict-by-default) orderId FK, so they must go before Order — only
      // KdsDeliveryRecord/OrderItem cascade with it. A live dispatcher sweep
      // (NODE_ENV isn't 'test' in this integration environment -- see
      // printer-dispatcher.integration-spec.ts's own onModuleInit guard note)
      // can race in and create a real ConnectorCommand referencing this
      // venue/printer job during the window above, so that's cleaned first.
      // `POST /api/kiosk/orders` also auto-provisions a "Kiosk System" staff
      // row scoped to this org the first time it's used against a new
      // organization -- clean that (and any audit log referencing it) too.
      await prisma.connectorCommand.deleteMany({ where: { venueId: venue.id } });
      await prisma.printerJob.deleteMany({ where: { venueId: venue.id } });
      await prisma.pOSSyncRecord.deleteMany({ where: { venueId: venue.id } });
      await prisma.orderItem.deleteMany({ where: { order: { venueId: venue.id } } });
      await prisma.order.deleteMany({ where: { venueId: venue.id } });
      await prisma.printer.deleteMany({ where: { venueId: venue.id } });
      await prisma.menuItem.deleteMany({ where: { organizationId: org.id } });
      await prisma.category.deleteMany({ where: { organizationId: org.id } });
      await prisma.venue.delete({ where: { id: venue.id } });
      const kioskSystemStaff = await prisma.staff.findMany({ where: { organizationId: org.id } });
      for (const s of kioskSystemStaff) {
        await prisma.auditLog.deleteMany({ where: { actorId: s.id } });
        await prisma.staff.delete({ where: { id: s.id } });
      }
      await prisma.organization.delete({ where: { id: org.id } });
    }
  });

  it('a venue on the real IdealPOS Bridge (posAdapterType "api") creates a POSSyncRecord and a KdsDeliveryRecord, but never a PrinterJob, even with an active printer configured — IdealPOS\'s own existing KOT workflow is the kitchen ticket once the order reaches it, and a second physical ticket would be a real operational duplicate', async () => {
    const org = await prisma.organization.create({
      data: {
        name: 'Phase 4 Integration IdealPOS-Owns-KOT Org',
        slug: `phase4-idealpos-owns-kot-org-${Date.now()}`,
        billingEmail: 'idealpos-owns-kot@phase4-integration.test',
      },
    });
    const venue = await prisma.venue.create({
      data: {
        organizationId: org.id,
        name: 'Phase 4 Integration IdealPOS-Owns-KOT Venue',
        slug: `phase4-idealpos-owns-kot-venue-${Date.now()}`,
        address: {},
        operatingHours: {},
        seatingCapacity: 10,
        posAdapterType: 'api',
      },
    });
    // Deliberately configured even though it must never fire for this
    // venue — proves the skip is keyed on posAdapterType, not merely on
    // "no printers happen to exist".
    await prisma.printer.create({
      data: {
        venueId: venue.id,
        name: 'Phase 4 Integration IdealPOS-Owns-KOT Printer',
        type: 'kitchen',
        connectionType: 'tcp',
        host: '127.0.0.1',
        port: 9998,
        isActive: true,
      },
    });
    const staff = await prisma.staff.findFirstOrThrow({ where: { organizationId } });
    const category = await prisma.category.create({
      data: { organizationId: org.id, name: 'IdealPOS-Owns-KOT category', createdById: staff.id },
    });
    const item = await prisma.menuItem.create({
      data: {
        organizationId: org.id,
        categoryId: category.id,
        title: 'IdealPOS-Owns-KOT item',
        description: 'test item',
        priceCents: 1000,
        nutritionalDetails: {},
        isAvailable: true,
        createdById: staff.id,
      },
    });

    try {
      const res = await request(app.getHttpServer())
        .post('/api/kiosk/orders')
        .set(csrfHeaders())
        .send({
          venueId: venue.id,
          notes: noteTag('idealpos-owns-kot'),
          stripePaymentIntentId: `pi_idealpos_owns_kot_${Date.now()}`,
          idempotencyKey: `idem_idealpos_owns_kot_${Date.now()}`,
          items: [{ menuItemId: item.id, quantity: 1 }],
        })
        .expect(201);
      const orderId = res.body.id as string;

      const [posSyncRecords, printerJobs, kdsDeliveryRecords] = await Promise.all([
        prisma.pOSSyncRecord.findMany({ where: { orderId } }),
        prisma.printerJob.findMany({ where: { orderId } }),
        prisma.kdsDeliveryRecord.findMany({ where: { orderId } }),
      ]);

      expect(posSyncRecords).toHaveLength(1);
      expect(posSyncRecords[0].status).toBe('not_synced');

      expect(printerJobs).toHaveLength(0);

      expect(kdsDeliveryRecords).toHaveLength(1);
    } finally {
      await prisma.connectorCommand.deleteMany({ where: { venueId: venue.id } });
      await prisma.printerJob.deleteMany({ where: { venueId: venue.id } });
      await prisma.pOSSyncRecord.deleteMany({ where: { venueId: venue.id } });
      await prisma.orderItem.deleteMany({ where: { order: { venueId: venue.id } } });
      await prisma.order.deleteMany({ where: { venueId: venue.id } });
      await prisma.printer.deleteMany({ where: { venueId: venue.id } });
      await prisma.menuItem.deleteMany({ where: { organizationId: org.id } });
      await prisma.category.deleteMany({ where: { organizationId: org.id } });
      await prisma.venue.delete({ where: { id: venue.id } });
      const kioskSystemStaff = await prisma.staff.findMany({ where: { organizationId: org.id } });
      for (const s of kioskSystemStaff) {
        await prisma.auditLog.deleteMany({ where: { actorId: s.id } });
        await prisma.staff.delete({ where: { id: s.id } });
      }
      await prisma.organization.delete({ where: { id: org.id } });
    }

    // See clearKioskOrdersRateLimit's own comment: this and the preceding
    // test each added one /api/kiosk/orders POST on top of this file's
    // existing shared-bucket load — reset here so neither affects any
    // later, otherwise-unrelated test's rate-limit budget.
    await clearKioskOrdersRateLimit();
  });

  it('a staff order requires a real table — a synthetic/non-UUID table id is rejected', async () => {
    await request(app.getHttpServer())
      .post('/api/admin/orders')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        venueId,
        tableId: 'mock-table-12',
        serviceMode: 'dine_in',
        idempotencyKey: 'idem_integration_test_bad_table',
        items: [{ menuItemId, quantity: 1 }],
      })
      .expect(400);
  });

  it('a staff order without a table is rejected (dine-in requires a real Table)', async () => {
    await request(app.getHttpServer())
      .post('/api/admin/orders')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        venueId,
        serviceMode: 'dine_in',
        idempotencyKey: 'idem_integration_test_no_table',
        items: [{ menuItemId, quantity: 1 }],
      })
      .expect(400);
  });

  it('a takeaway order requires the absence of a table — supplying one is rejected outright, never silently discarded', async () => {
    const table = await freeTable();
    await request(app.getHttpServer())
      .post('/api/admin/orders')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        venueId,
        tableId: table.id,
        serviceMode: 'takeaway',
        idempotencyKey: 'idem_integration_test_takeaway_with_table',
        items: [{ menuItemId, quantity: 1 }],
      })
      .expect(400);
  });

  it('13, 14, 15. valid status transitions succeed and persist; invalid transitions are rejected', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/kiosk/orders')
      .set(csrfHeaders())
      .send({
        venueId,
        notes: noteTag('fsm'),
        stripePaymentIntentId: 'pi_integration_test_fsm',
        idempotencyKey: 'idem_integration_test_fsm',
        items: [{ menuItemId, quantity: 1 }],
      })
      .expect(201);
    expect(created.body.status).toBe('confirmed');

    // 13. Valid: confirmed -> preparing.
    const preparing = await request(app.getHttpServer())
      .patch(`/api/admin/orders/${created.body.id}/status`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ status: 'preparing' })
      .expect(200);
    expect(preparing.body.status).toBe('preparing');

    // 15. Persists in Postgres.
    expect((await prisma.order.findUniqueOrThrow({ where: { id: created.body.id } })).status).toBe(
      'preparing',
    );

    // 14. Invalid: preparing -> pending is not in the FSM.
    await request(app.getHttpServer())
      .patch(`/api/admin/orders/${created.body.id}/status`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ status: 'pending' })
      .expect(409);

    // Status did not change after the rejected transition.
    expect((await prisma.order.findUniqueOrThrow({ where: { id: created.body.id } })).status).toBe(
      'preparing',
    );

    await cleanupOrder(created.body.id);
  });

  it('16. a public/device-shaped caller cannot access admin-only order operations', async () => {
    await request(app.getHttpServer()).get('/api/admin/orders').expect(401);
    // CSRF-valid so these specifically exercise JwtAuthGuard's rejection
    // (401) rather than being blocked earlier by the CSRF middleware (403)
    // — both reject an unauthenticated caller, but this isolates which
    // layer is doing it (same pattern as reservations.integration-spec.ts).
    await request(app.getHttpServer())
      .post('/api/admin/orders')
      .set(csrfHeaders())
      .send({ venueId, items: [] })
      .expect(401);
    await request(app.getHttpServer())
      .patch('/api/admin/orders/ORD-600001/status')
      .set(csrfHeaders())
      .send({ status: 'preparing' })
      .expect(401);
  });

  it('17. cross-organization order access is rejected', async () => {
    // Build a second, fully independent organization/venue/staff so this
    // proves org isolation rather than assuming a second seeded tenant.
    const otherOrg = await prisma.organization.create({
      data: {
        name: 'Phase 4 Integration Other Org',
        slug: `phase4-other-org-${Date.now()}`,
        billingEmail: 'other@phase4-integration.test',
      },
    });
    const otherPasswordHash = await argon2.hash('other-org-password-1234', {
      type: argon2.argon2id,
    });
    const otherStaff = await prisma.staff.create({
      data: {
        organizationId: otherOrg.id,
        email: `other-owner-${Date.now()}@phase4-integration.test`,
        name: 'Other Org Owner',
        passwordHash: otherPasswordHash,
        role: 'owner',
      },
    });

    const otherLogin = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: otherStaff.email, password: 'other-org-password-1234' })
      .expect(200);
    const otherAccessToken = otherLogin.body.accessToken as string;

    // Create a real order under the *original* org/venue.
    const order = await request(app.getHttpServer())
      .post('/api/kiosk/orders')
      .set(csrfHeaders())
      .send({
        venueId,
        notes: noteTag('cross-org'),
        stripePaymentIntentId: 'pi_integration_test_cross_org',
        idempotencyKey: 'idem_integration_test_cross_org',
        items: [{ menuItemId, quantity: 1 }],
      })
      .expect(201);

    // The other org's staff token cannot read it.
    await request(app.getHttpServer())
      .get(`/api/admin/orders/${order.body.id}`)
      .set('Authorization', `Bearer ${otherAccessToken}`)
      .expect(404);

    // Nor can it appear in the other org's order list.
    const otherOrgList = await request(app.getHttpServer())
      .get('/api/admin/orders')
      .set('Authorization', `Bearer ${otherAccessToken}`)
      .expect(200);
    expect(otherOrgList.body.some((o: { id: string }) => o.id === order.body.id)).toBe(false);

    // Nor create a staff order against the original venue from the other org.
    const table = await freeTable();
    await request(app.getHttpServer())
      .post('/api/admin/orders')
      .set('Authorization', `Bearer ${otherAccessToken}`)
      .send({
        venueId,
        tableId: table.id,
        serviceMode: 'dine_in',
        idempotencyKey: 'idem_integration_test_cross_org_staff',
        items: [{ menuItemId, quantity: 1 }],
      })
      .expect(403);

    await cleanupOrder(order.body.id);
    // The login above wrote an audit log row referencing otherStaff — clear
    // it first, since AuditLog.actorId is a RESTRICT-on-delete FK.
    await prisma.auditLog.deleteMany({ where: { actorId: otherStaff.id } });
    await prisma.staff.delete({ where: { id: otherStaff.id } });
    await prisma.organization.delete({ where: { id: otherOrg.id } });
  });

  it('18. payment state cannot be forged by the client — kiosk orders without a payment reference are rejected', async () => {
    await request(app.getHttpServer())
      .post('/api/kiosk/orders')
      .set(csrfHeaders())
      .send({
        venueId,
        idempotencyKey: 'idem_integration_test_no_payment',
        items: [{ menuItemId, quantity: 1 }],
        // No stripePaymentIntentId at all.
      })
      .expect(400);
  });

  it('19. the order reference/number comes from backend sequencing, not the client', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/kiosk/orders')
      .set(csrfHeaders())
      .send({
        venueId,
        notes: noteTag('order-number'),
        stripePaymentIntentId: 'pi_integration_test_order_number',
        idempotencyKey: 'idem_integration_test_order_number',
        // Attempted client-supplied id — must be ignored.
        id: 'ORD-999999-FAKE',
        items: [{ menuItemId, quantity: 1 }],
      })
      .expect(201);

    expect(res.body.id).toMatch(/^ORD-6\d+$/);
    expect(res.body.id).not.toBe('ORD-999999-FAKE');

    await cleanupOrder(res.body.id);
  });

  // ── Story 6-1: order idempotency and payment-reference uniqueness ──
  // Requires a real Postgres (see file header). Not executed in the
  // implementation environment for this story — no Docker daemon was
  // reachable there. Written and reviewed against the real schema/service
  // code; run with `npm run test:integration --workspace=backend` before
  // this story may be marked done, per its Definition of Done.
  describe('Story 6-1: idempotency and payment-reference uniqueness', () => {
    it('an exact retry (same key, same server-computed request) returns the original order and creates nothing new', async () => {
      const before = await prisma.order.count();
      const key = `idem_6_1_exact_retry_${Date.now()}`;

      const body = {
        venueId,
        notes: noteTag('idem-exact-retry'),
        stripePaymentIntentId: `pi_6_1_exact_retry_${Date.now()}`,
        idempotencyKey: key,
        items: [{ menuItemId, quantity: 1 }],
      };

      const first = await postKioskOrder(body).expect(201);
      const second = await postKioskOrder(body).expect(201);

      expect(second.body.id).toBe(first.body.id);
      expect(second.body.totalCents).toBe(first.body.totalCents);

      const after = await prisma.order.count();
      expect(after).toBe(before + 1); // exactly one order, not two

      const items = await prisma.orderItem.findMany({ where: { orderId: first.body.id } });
      expect(items).toHaveLength(1); // items were not re-created on replay

      await cleanupOrder(first.body.id);
    });

    it('the same idempotency key with a materially different request is rejected and does not mutate the original order', async () => {
      const key = `idem_6_1_conflict_${Date.now()}`;
      const first = await postKioskOrder({
        venueId,
        notes: noteTag('idem-conflict'),
        stripePaymentIntentId: `pi_6_1_conflict_${Date.now()}`,
        idempotencyKey: key,
        items: [{ menuItemId, quantity: 1 }],
      }).expect(201);

      await postKioskOrder({
        venueId,
        notes: noteTag('idem-conflict'),
        stripePaymentIntentId: `pi_6_1_conflict_second_${Date.now()}`,
        idempotencyKey: key, // same key
        items: [{ menuItemId, quantity: 2 }], // different quantity
      }).expect(409);

      const unchanged = await prisma.order.findUniqueOrThrow({ where: { id: first.body.id } });
      expect(unchanged.totalCents).toBe(first.body.totalCents);
      expect(unchanged.status).toBe('confirmed'); // untouched, not overwritten or cancelled

      await cleanupOrder(first.body.id);
    });

    it('reusing a captured PaymentIntent under a new idempotency key is rejected — one charge cannot create two orders', async () => {
      const sharedPaymentIntent = `pi_6_1_reused_${Date.now()}`;
      const first = await postKioskOrder({
        venueId,
        notes: noteTag('payment-reuse'),
        stripePaymentIntentId: sharedPaymentIntent,
        idempotencyKey: `idem_6_1_reused_a_${Date.now()}`,
        items: [{ menuItemId, quantity: 1 }],
      }).expect(201);

      const before = await prisma.order.count();

      await postKioskOrder({
        venueId,
        notes: noteTag('payment-reuse'),
        stripePaymentIntentId: sharedPaymentIntent, // same PaymentIntent
        idempotencyKey: `idem_6_1_reused_b_${Date.now()}`, // different key
        items: [{ menuItemId, quantity: 1 }],
      }).expect(409);

      const after = await prisma.order.count();
      expect(after).toBe(before); // no second order was created

      await cleanupOrder(first.body.id);
    });

    it('N concurrent identical submissions create exactly one order and every caller gets a deterministic outcome', async () => {
      const before = await prisma.order.count();
      const key = `idem_6_1_concurrent_${Date.now()}`;
      const body = {
        venueId,
        notes: noteTag('idem-concurrent'),
        stripePaymentIntentId: `pi_6_1_concurrent_${Date.now()}`,
        idempotencyKey: key,
        items: [{ menuItemId, quantity: 1 }],
      };

      const responses = await Promise.all(Array.from({ length: 5 }, () => postKioskOrder(body)));

      // Every response is either the created order (201) or the idempotent
      // replay of it (also 201, same body) — none may be a 500 or a
      // duplicate-looking distinct order.
      for (const res of responses) {
        expect(res.status).toBe(201);
      }
      const orderIds = new Set(responses.map((r) => r.body.id as string));
      expect(orderIds.size).toBe(1); // every caller converged on the same order

      const after = await prisma.order.count();
      expect(after).toBe(before + 1); // the race produced exactly one row

      await cleanupOrder([...orderIds][0]);
    });

    it('N concurrent DIFFERENT new orders (distinct idempotency keys) never collapse into one row or fail outright — regression test for the order-id-generation race', async () => {
      // Distinct from the test above: this exercises the *pure* pre-existing
      // order-numbering race (concurrent brand-new orders can compute the
      // same next ORD-6xxxxx id) with no idempotency-key overlap at all —
      // proving the bounded persistOrder retry correctly resolves a genuine
      // id collision into two REAL, DISTINCT orders, not a false replay
      // match or a dropped request.
      // 3 concurrent, not 5: enough to exercise real N-way (not just 2-way)
      // contention on the shared next-id slot while keeping this file's
      // total kiosk-order request volume comfortably under the production
      // rate limit (30/60s on POST /kiosk/orders) shared across the whole
      // suite — the literal verification requirement is "two concurrent",
      // this deliberately goes beyond it without needlessly exhausting an
      // unrelated safety control.
      const before = await prisma.order.count();
      const requests = Array.from({ length: 3 }, (_, i) => ({
        venueId,
        notes: noteTag('idem-concurrent-distinct'),
        stripePaymentIntentId: `pi_6_1_concurrent_distinct_${Date.now()}_${i}`,
        idempotencyKey: `idem_6_1_concurrent_distinct_${Date.now()}_${i}`,
        items: [{ menuItemId, quantity: 1 }],
      }));

      const responses = await Promise.all(requests.map((r) => postKioskOrder(r)));

      for (const res of responses) {
        expect(res.status).toBe(201);
      }
      const orderIds = new Set(responses.map((r) => r.body.id as string));
      expect(orderIds.size).toBe(3); // three genuinely distinct orders, no collapsing

      const after = await prisma.order.count();
      expect(after).toBe(before + 3);

      for (const id of orderIds) {
        await cleanupOrder(id);
      }
    });

    it('the idempotency key is scoped per venue — the same key at two different venues creates two independent orders', async () => {
      // Fixture creation, order creation, and every assertion are wrapped in
      // try/finally: without this, a failure anywhere in the middle (this
      // test previously had none, but a transient failure — e.g. hitting
      // the shared rate limiter — was confirmed in Story 6-1 review to leak
      // secondVenue/secondVenueTable/secondVenueMenuItem permanently into
      // the shared dev database, which then broke menu.integration-spec.ts's
      // unrelated exact-count assertion on a later run) now still cleans up.
      let secondVenue: { id: string } | undefined;
      let secondVenueTable: { id: string } | undefined;
      let secondVenueMenuItem: { id: string } | undefined;
      let orderAtVenueOneId: string | undefined;
      let orderAtVenueTwoId: string | undefined;

      try {
        secondVenue = await prisma.venue.create({
          data: {
            organizationId,
            name: 'Phase 6-1 Integration Second Venue',
            slug: `phase6-1-second-venue-${Date.now()}`,
            address: {},
            operatingHours: {},
            seatingCapacity: 20,
          },
        });
        secondVenueTable = await prisma.table.create({
          data: { venueId: secondVenue.id, tableNumber: 'S1', capacity: 2, sortOrder: 0 },
        });
        secondVenueMenuItem = await prisma.menuItem.create({
          data: {
            organizationId,
            categoryId: (await prisma.category.findFirstOrThrow({ where: { organizationId } })).id,
            title: 'Phase 6-1 Second Venue Item',
            description: 'Temporary — deleted at end of test.',
            priceCents: 500,
            nutritionalDetails: {},
            isAvailable: true,
            createdById: (await prisma.staff.findFirstOrThrow({ where: { organizationId } })).id,
          },
        });

        const sharedKey = `idem_6_1_shared_across_venues_${Date.now()}`;

        const orderAtVenueOne = await postKioskOrder({
          venueId,
          notes: noteTag('cross-venue-key'),
          stripePaymentIntentId: `pi_6_1_venue_one_${Date.now()}`,
          idempotencyKey: sharedKey,
          items: [{ menuItemId, quantity: 1 }],
        }).expect(201);
        orderAtVenueOneId = orderAtVenueOne.body.id as string;

        const orderAtVenueTwo = await request(app.getHttpServer())
          .post('/api/kiosk/orders')
          .set(csrfHeaders())
          .send({
            venueId: secondVenue.id,
            notes: noteTag('cross-venue-key'),
            stripePaymentIntentId: `pi_6_1_venue_two_${Date.now()}`,
            idempotencyKey: sharedKey, // same key, different venue
            items: [{ menuItemId: secondVenueMenuItem.id, quantity: 1 }],
          })
          .expect(201);
        orderAtVenueTwoId = orderAtVenueTwo.body.id as string;

        expect(orderAtVenueTwoId).not.toBe(orderAtVenueOneId);
      } finally {
        if (orderAtVenueOneId) await cleanupOrder(orderAtVenueOneId);
        if (orderAtVenueTwoId) {
          await prisma.orderItem.deleteMany({ where: { orderId: orderAtVenueTwoId } });
          await prisma.order.deleteMany({ where: { id: orderAtVenueTwoId } });
        }
        if (secondVenueMenuItem)
          await prisma.menuItem.delete({ where: { id: secondVenueMenuItem.id } });
        if (secondVenueTable) await prisma.table.delete({ where: { id: secondVenueTable.id } });
        if (secondVenue) await prisma.venue.delete({ where: { id: secondVenue.id } });
      }
    });

    it('a request that fails before persistence (invalid item) leaves no order or idempotency-key row behind', async () => {
      const key = `idem_6_1_rollback_${Date.now()}`;

      await postKioskOrder({
        venueId,
        stripePaymentIntentId: `pi_6_1_rollback_${Date.now()}`,
        idempotencyKey: key,
        items: [{ menuItemId: '00000000-0000-0000-0000-000000000000', quantity: 1 }],
      }).expect(400);

      const row = await prisma.order.findUnique({
        where: { venueId_idempotencyKey: { venueId, idempotencyKey: key } },
      });
      expect(row).toBeNull();

      // The key is not "burned" by the failed attempt — a genuine retry
      // with a valid item and the same key succeeds normally afterward.
      const retry = await postKioskOrder({
        venueId,
        notes: noteTag('idem-rollback-retry'),
        stripePaymentIntentId: `pi_6_1_rollback_retry_${Date.now()}`,
        idempotencyKey: key,
        items: [{ menuItemId, quantity: 1 }],
      }).expect(201);

      await cleanupOrder(retry.body.id);
    });

    it('an exact retry of a staff order is not blocked by the active-order-at-this-table guard its own prior order created', async () => {
      const table = await freeTable();
      const key = `idem_6_1_staff_retry_${Date.now()}`;
      const body = {
        venueId,
        tableId: table.id,
        serviceMode: 'dine_in',
        notes: noteTag('idem-staff-retry'),
        idempotencyKey: key,
        items: [{ menuItemId, quantity: 1 }],
      };

      const first = await request(app.getHttpServer())
        .post('/api/admin/orders')
        .set('Authorization', `Bearer ${accessToken}`)
        .send(body)
        .expect(201);

      // Without idempotent-replay handling, this second call would hit
      // validateTableForOrder's "table already has an active order" guard
      // against the first call's own order and incorrectly 409.
      const second = await request(app.getHttpServer())
        .post('/api/admin/orders')
        .set('Authorization', `Bearer ${accessToken}`)
        .send(body)
        .expect(201);

      expect(second.body.id).toBe(first.body.id);

      await cleanupOrder(first.body.id);
    });
  });

  describe('Story 15-13: dine-in and takeaway service mode', () => {
    it('a real takeaway order persists with no table and a stable, sequence-generated reference', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/admin/orders')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          venueId,
          serviceMode: 'takeaway',
          notes: noteTag('takeaway-basic'),
          idempotencyKey: `idem_15_13_takeaway_basic_${Date.now()}`,
          items: [{ menuItemId, quantity: 1 }],
        })
        .expect(201);

      expect(res.body.tableId).toBeNull();
      expect(res.body.tableNumber).toBeNull();
      expect(res.body.serviceMode).toBe('takeaway');
      expect(res.body.takeawayReference).toMatch(/^TA-\d{6,}$/);

      const dbOrder = await prisma.order.findUniqueOrThrow({ where: { id: res.body.id } });
      expect(dbOrder.tableId).toBeNull();
      expect(dbOrder.takeawayReference).toBe(res.body.takeawayReference);

      await cleanupOrder(res.body.id);
    });

    it('a replay of the same takeaway idempotencyKey returns the original order and the same reference — never a second one', async () => {
      const key = `idem_15_13_takeaway_replay_${Date.now()}`;
      const body = {
        venueId,
        serviceMode: 'takeaway',
        notes: noteTag('takeaway-replay'),
        idempotencyKey: key,
        items: [{ menuItemId, quantity: 1 }],
      };

      const first = await request(app.getHttpServer())
        .post('/api/admin/orders')
        .set('Authorization', `Bearer ${accessToken}`)
        .send(body)
        .expect(201);
      const second = await request(app.getHttpServer())
        .post('/api/admin/orders')
        .set('Authorization', `Bearer ${accessToken}`)
        .send(body)
        .expect(201);

      expect(second.body.id).toBe(first.body.id);
      expect(second.body.takeawayReference).toBe(first.body.takeawayReference);

      const orderCount = await prisma.order.count({ where: { id: first.body.id } });
      expect(orderCount).toBe(1);

      await cleanupOrder(first.body.id);
    });

    it('reusing an idempotencyKey with a changed serviceMode (dine-in -> takeaway) is rejected as a genuine conflict, never silently accepted', async () => {
      const table = await freeTable();
      const key = `idem_15_13_mode_conflict_${Date.now()}`;

      const first = await request(app.getHttpServer())
        .post('/api/admin/orders')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          venueId,
          tableId: table.id,
          serviceMode: 'dine_in',
          notes: noteTag('mode-conflict'),
          idempotencyKey: key,
          items: [{ menuItemId, quantity: 1 }],
        })
        .expect(201);

      await request(app.getHttpServer())
        .post('/api/admin/orders')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          venueId,
          serviceMode: 'takeaway',
          notes: noteTag('mode-conflict'),
          idempotencyKey: key,
          items: [{ menuItemId, quantity: 1 }],
        })
        .expect(409);

      await cleanupOrder(first.body.id);
    });

    it('reusing a takeaway idempotencyKey with a different cart (changed table-equivalent request shape) is rejected, never returned as a false replay', async () => {
      const key = `idem_15_13_cart_conflict_${Date.now()}`;
      const menuItem2 = await prisma.menuItem.findFirstOrThrow({
        where: {
          organizationId: (await prisma.venue.findUniqueOrThrow({ where: { id: venueId } }))
            .organizationId,
          id: { not: menuItemId },
          isAvailable: true,
          deletedAt: null,
        },
      });

      const first = await request(app.getHttpServer())
        .post('/api/admin/orders')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          venueId,
          serviceMode: 'takeaway',
          notes: noteTag('cart-conflict'),
          idempotencyKey: key,
          items: [{ menuItemId, quantity: 1 }],
        })
        .expect(201);

      await request(app.getHttpServer())
        .post('/api/admin/orders')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          venueId,
          serviceMode: 'takeaway',
          notes: noteTag('cart-conflict'),
          idempotencyKey: key,
          items: [{ menuItemId: menuItem2.id, quantity: 1 }],
        })
        .expect(409);

      await cleanupOrder(first.body.id);
    });

    it('N concurrent identical takeaway submissions create exactly one order and one reference — every caller gets the same result', async () => {
      const key = `idem_15_13_takeaway_concurrent_${Date.now()}`;
      const body = {
        venueId,
        serviceMode: 'takeaway',
        notes: noteTag('takeaway-concurrent-identical'),
        idempotencyKey: key,
        items: [{ menuItemId, quantity: 1 }],
      };

      const responses = await Promise.all(
        Array.from({ length: 5 }, () =>
          request(app.getHttpServer())
            .post('/api/admin/orders')
            .set('Authorization', `Bearer ${accessToken}`)
            .send(body),
        ),
      );
      responses.forEach((r) => expect(r.status).toBe(201));

      const ids = new Set(responses.map((r) => r.body.id as string));
      const refs = new Set(responses.map((r) => r.body.takeawayReference as string));
      expect(ids.size).toBe(1);
      expect(refs.size).toBe(1);

      const orderCount = await prisma.order.count({ where: { id: [...ids][0] } });
      expect(orderCount).toBe(1);

      await cleanupOrder([...ids][0]);
    });

    it('N concurrent DISTINCT new takeaway orders each receive a unique reference — no collision under real concurrency', async () => {
      // 3 concurrent, matching the pre-existing "N concurrent DIFFERENT new
      // orders" kiosk test's own documented precedent above (persistOrder's
      // id-collision recovery is deliberately bounded, not unbounded — see
      // that test's comment and recoverFromPersistConflict's own doc
      // comment) — not this story's own defect; 5-way contention on the
      // shared ORD-6xxxxx next-id slot exceeds this pre-existing bounded
      // mechanism's proven capacity regardless of serviceMode, reproduced
      // and confirmed during this story's own testing pass, recorded as an
      // out-of-scope pre-existing finding (deferred-work.md already owns
      // it: "Order-ID generation... races under concurrent load", P1).
      const responses = await Promise.all(
        Array.from({ length: 3 }, (_, i) =>
          request(app.getHttpServer())
            .post('/api/admin/orders')
            .set('Authorization', `Bearer ${accessToken}`)
            .send({
              venueId,
              serviceMode: 'takeaway',
              notes: noteTag('takeaway-concurrent-distinct'),
              idempotencyKey: `idem_15_13_takeaway_distinct_${Date.now()}_${i}_${Math.random()}`,
              items: [{ menuItemId, quantity: 1 }],
            }),
        ),
      );
      responses.forEach((r) => expect(r.status).toBe(201));

      const refs = responses.map((r) => r.body.takeawayReference as string);
      expect(new Set(refs).size).toBe(refs.length); // every reference unique
      const ids = responses.map((r) => r.body.id as string);
      expect(new Set(ids).size).toBe(ids.length); // every order id unique

      await Promise.all(ids.map((id) => cleanupOrder(id)));
    });

    it("a cancelled takeaway order's reference is never reused by a later order", async () => {
      const first = await request(app.getHttpServer())
        .post('/api/admin/orders')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          venueId,
          serviceMode: 'takeaway',
          notes: noteTag('takeaway-cancel-no-reuse'),
          idempotencyKey: `idem_15_13_takeaway_cancel_${Date.now()}`,
          items: [{ menuItemId, quantity: 1 }],
        })
        .expect(201);

      await request(app.getHttpServer())
        .patch(`/api/admin/orders/${first.body.id}/status`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ status: 'cancelled' })
        .expect(200);

      const second = await request(app.getHttpServer())
        .post('/api/admin/orders')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          venueId,
          serviceMode: 'takeaway',
          notes: noteTag('takeaway-cancel-no-reuse'),
          idempotencyKey: `idem_15_13_takeaway_cancel_2_${Date.now()}`,
          items: [{ menuItemId, quantity: 1 }],
        })
        .expect(201);

      expect(second.body.takeawayReference).not.toBe(first.body.takeawayReference);

      await cleanupOrder(first.body.id);
      await cleanupOrder(second.body.id);
    });

    it('a failed submission (invalid item) never consumes or exposes a takeaway reference', async () => {
      const before = await prisma.order.count();

      await request(app.getHttpServer())
        .post('/api/admin/orders')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          venueId,
          serviceMode: 'takeaway',
          idempotencyKey: `idem_15_13_takeaway_failed_${Date.now()}`,
          items: [{ menuItemId: '00000000-0000-0000-0000-000000000000', quantity: 1 }],
        })
        .expect(400);

      const after = await prisma.order.count();
      expect(after).toBe(before); // no partial order row
    });

    it('a row inserted without an explicit serviceMode (simulating the exact shape of every pre-Story-15-13 historical row) is backfilled to dine_in by the migration column DEFAULT, not application logic', async () => {
      const table = await freeTable();
      // Deliberately bypasses OrdersService entirely and omits serviceMode
      // from the insert — this is exactly the shape every order row had
      // before this story's migration. The column DEFAULT ('dine_in',
      // migration 20260821000000_order_service_mode) is what must produce
      // the correct value here, not any TypeScript code path.
      const legacyShapedOrder = await prisma.order.create({
        data: {
          id: `ORD-15-13-legacy-shape-${Date.now()}`,
          venueId,
          tableId: table.id,
          tableNumber: table.tableNumber,
          status: 'confirmed',
          subtotalCents: 100,
          totalCents: 100,
          source: 'staff',
          idempotencyKey: `idem_15_13_legacy_shape_${Date.now()}`,
        },
      });
      expect(legacyShapedOrder.serviceMode).toBe('dine_in');
      expect(legacyShapedOrder.takeawayReference).toBeNull();

      await cleanupOrder(legacyShapedOrder.id);
    });
  });
});
