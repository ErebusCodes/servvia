// Integration test against a REAL local Postgres (see
// local-postgres/README.md) — no mocking. Exercises Story 15-3's
// authoritative modifier-group contract end to end through the real HTTP
// surface: real authoring via Menu Management's admin API, real
// server-side ID-based validation on staff/Order-Tablet order creation
// (`OrdersService.createStaffOrder`, shared by `/api/admin/orders` and
// `/api/tablet/orders`), and real idempotent-replay-after-menu-change
// behavior.
//
// Run with: npm run test:integration --workspace=backend
// Requires: npm run db:local:start && npm run db:migrate && npm run db:seed
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Menu modifier integrity (integration, real local Postgres) — Story 15-3', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let accessToken: string;
  let venueId: string;
  let organizationId: string;
  let categoryId: string;
  let itemId: string;
  let sauceGroupId: string;
  let garlicOptionId: string;
  let noneOptionId: string;
  let extrasGroupId: string;
  let pitaOptionId: string;
  let deactivatedOptionId: string;

  const TAG = 'story15-3-modifier-integration';

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

    const venue = await prisma.venue.findFirstOrThrow({ where: { slug: 'auckland' } });
    venueId = venue.id;
    organizationId = venue.organizationId;

    const category = await prisma.category.findFirstOrThrow({ where: { organizationId } });
    categoryId = category.id;

    const loginRes = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({
        email: process.env.SEED_OWNER_EMAIL ?? 'owner@verdura.co.nz',
        password: process.env.SEED_OWNER_PASSWORD,
      })
      .expect(200);
    accessToken = loginRes.body.accessToken as string;

    // Real authoring, through the real admin API — not invented via
    // migration/seed (Story 15-3's own requirement). IDs are omitted on
    // create so the server assigns stable ones.
    const createRes = await request(app.getHttpServer())
      .post('/api/admin/menu/items')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        title: `${TAG} Mezze Board`,
        description: 'Temporary integration-test item with real modifier groups.',
        categoryId,
        priceCents: 7000,
        isAvailable: true,
        modifierGroups: [
          {
            name: 'Sauce',
            required: true,
            minSelections: 1,
            maxSelections: 1,
            options: [
              { name: 'Toum Garlic Paste', priceDeltaCents: 50, isAvailable: true, sortOrder: 0 },
              { name: 'No Sauce', priceDeltaCents: 0, isAvailable: true, sortOrder: 1 },
            ],
          },
          {
            name: 'Extras',
            required: false,
            minSelections: 0,
            maxSelections: 1,
            options: [
              { name: 'Extra Pita', priceDeltaCents: 150, isAvailable: true, sortOrder: 0 },
              { name: 'Retired Extra', priceDeltaCents: 100, isAvailable: false, sortOrder: 1 },
            ],
          },
        ],
      })
      .expect(201);
    itemId = createRes.body.id as string;

    const persisted = await prisma.menuItem.findUniqueOrThrow({ where: { id: itemId } });
    const groups = persisted.modifierGroups as Array<{
      id: string;
      name: string;
      options: Array<{ id: string; name: string }>;
    }>;
    sauceGroupId = groups.find((g) => g.name === 'Sauce')!.id;
    garlicOptionId = groups
      .find((g) => g.name === 'Sauce')!
      .options.find((o) => o.name === 'Toum Garlic Paste')!.id;
    noneOptionId = groups
      .find((g) => g.name === 'Sauce')!
      .options.find((o) => o.name === 'No Sauce')!.id;
    extrasGroupId = groups.find((g) => g.name === 'Extras')!.id;
    pitaOptionId = groups
      .find((g) => g.name === 'Extras')!
      .options.find((o) => o.name === 'Extra Pita')!.id;
    deactivatedOptionId = groups
      .find((g) => g.name === 'Extras')!
      .options.find((o) => o.name === 'Retired Extra')!.id;
  });

  afterAll(async () => {
    await prisma.orderItem.deleteMany({ where: { order: { notes: { contains: TAG } } } });
    await prisma.order.deleteMany({ where: { notes: { contains: TAG } } });
    await request(app.getHttpServer())
      .delete(`/api/admin/menu/items/${itemId}`)
      .set('Authorization', `Bearer ${accessToken}`);
    await app.close();
    await prisma.$disconnect();
  });

  async function freeTable(): Promise<{ id: string; tableNumber: string }> {
    const tables = await prisma.table.findMany({
      where: { venueId, isActive: true },
      orderBy: { sortOrder: 'asc' },
    });
    for (const table of tables) {
      const active = await prisma.order.findFirst({
        where: { tableId: table.id, status: { in: ['pending', 'confirmed', 'preparing', 'ready'] } },
      });
      if (!active) return { id: table.id, tableNumber: table.tableNumber };
    }
    throw new Error('No free table available for integration test');
  }

  function postStaffOrder(items: unknown[], idempotencyKey: string, tableId: string) {
    return request(app.getHttpServer())
      .post('/api/admin/orders')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ venueId, tableId, serviceMode: 'dine_in', notes: `${TAG} order`, idempotencyKey, items });
  }

  describe('kiosk menu response shape', () => {
    it('returns the authored modifier groups with stable ids, correct ordering, and available/unavailable state', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/kiosk/venues/${venueId}/menu`)
        .expect(200);

      const item = (res.body.menuItems as Array<{ id: string; modifierGroups: unknown }>).find(
        (i) => i.id === itemId,
      );
      expect(item).toBeDefined();
      const groups = item!.modifierGroups as Array<{
        id: string;
        name: string;
        required: boolean;
        minSelections: number;
        maxSelections: number;
        options: Array<{ id: string; name: string; priceDeltaCents: number; isAvailable: boolean; sortOrder: number }>;
      }>;
      expect(groups).toHaveLength(2);

      const sauce = groups.find((g) => g.id === sauceGroupId)!;
      expect(sauce.required).toBe(true);
      expect(sauce.minSelections).toBe(1);
      expect(sauce.maxSelections).toBe(1);
      expect(sauce.options.map((o) => o.name)).toEqual(['Toum Garlic Paste', 'No Sauce']);
      expect(sauce.options.find((o) => o.id === garlicOptionId)?.priceDeltaCents).toBe(50);

      const extras = groups.find((g) => g.id === extrasGroupId)!;
      const deactivated = extras.options.find((o) => o.id === deactivatedOptionId)!;
      // Unavailable options are still returned (so the client can render
      // them disabled), never silently filtered out.
      expect(deactivated.isAvailable).toBe(false);
    });
  });

  describe('strict server-side validation on staff/Order-Tablet order creation', () => {
    it('THE $0.50 DEFECT REGRESSION: a real +$0.50 modifier persists at exactly $0.50 in Postgres, never silently at $0', async () => {
      const table = await freeTable();
      const res = await postStaffOrder(
        [{ menuItemId: itemId, quantity: 1, selectedModifiers: [{ modifierGroupId: sauceGroupId, optionId: garlicOptionId }] }],
        `${TAG}-defect-regression`,
        table.id,
      ).expect(201);

      expect(res.body.subtotalCents).toBe(7050);

      const dbOrder = await prisma.order.findUniqueOrThrow({
        where: { id: res.body.id },
        include: { items: true },
      });
      expect(dbOrder.items[0].unitPriceCents).toBe(7050);
      const mods = dbOrder.items[0].selectedModifiers as Array<{
        modifierGroupId: string;
        optionId: string;
        optionName: string;
        priceDeltaCents: number;
      }>;
      expect(mods).toEqual([
        {
          modifierGroupId: sauceGroupId,
          modifierGroupName: 'Sauce',
          optionId: garlicOptionId,
          optionName: 'Toum Garlic Paste',
          priceDeltaCents: 50,
        },
      ]);
    });

    it('rejects a missing required group', async () => {
      const table = await freeTable();
      await postStaffOrder(
        [{ menuItemId: itemId, quantity: 1, selectedModifiers: [] }],
        `${TAG}-missing-required`,
        table.id,
      ).expect(400);
    });

    it('rejects an unavailable (deactivated) option', async () => {
      const table = await freeTable();
      await postStaffOrder(
        [
          {
            menuItemId: itemId,
            quantity: 1,
            selectedModifiers: [
              { modifierGroupId: sauceGroupId, optionId: noneOptionId },
              { modifierGroupId: extrasGroupId, optionId: deactivatedOptionId },
            ],
          },
        ],
        `${TAG}-unavailable-option`,
        table.id,
      ).expect(409);
    });

    it('rejects an option id that does not belong to the submitted group', async () => {
      const table = await freeTable();
      await postStaffOrder(
        [
          {
            menuItemId: itemId,
            quantity: 1,
            selectedModifiers: [{ modifierGroupId: extrasGroupId, optionId: garlicOptionId }],
          },
        ],
        `${TAG}-cross-group`,
        table.id,
      ).expect(400);
    });

    it('rejects a duplicate option selection', async () => {
      const table = await freeTable();
      await postStaffOrder(
        [
          {
            menuItemId: itemId,
            quantity: 1,
            selectedModifiers: [
              { modifierGroupId: sauceGroupId, optionId: garlicOptionId },
              { modifierGroupId: sauceGroupId, optionId: garlicOptionId },
            ],
          },
        ],
        `${TAG}-duplicate`,
        table.id,
      ).expect(400);
    });

    it('rejects the legacy name-based shape — ids are mandatory on this path', async () => {
      const table = await freeTable();
      await postStaffOrder(
        [{ menuItemId: itemId, quantity: 1, selectedModifiers: [{ name: 'Toum Garlic Paste', priceDeltaCents: 50 }] }],
        `${TAG}-legacy-shape`,
        table.id,
      ).expect(400);
    });

    it('fails closed with a 409 when the caller-expected price is stale — no order is created', async () => {
      const table = await freeTable();
      const before = await prisma.order.count();

      await postStaffOrder(
        [
          {
            menuItemId: itemId,
            quantity: 1,
            selectedModifiers: [{ modifierGroupId: sauceGroupId, optionId: garlicOptionId }],
            expectedUnitPriceCents: 1, // deliberately stale
          },
        ],
        `${TAG}-stale-price`,
        table.id,
      ).expect(409);

      expect(await prisma.order.count()).toBe(before);
    });

    it('an item with no configured modifier catalog rejects any submitted modifier outright', async () => {
      const otherItem = await prisma.menuItem.findFirstOrThrow({
        where: { organizationId, deletedAt: null, isAvailable: true, id: { not: itemId } },
      });
      expect(otherItem.modifierGroups).toEqual([]); // precondition
      const table = await freeTable();

      await postStaffOrder(
        [
          {
            menuItemId: otherItem.id,
            quantity: 1,
            selectedModifiers: [{ modifierGroupId: sauceGroupId, optionId: garlicOptionId }],
          },
        ],
        `${TAG}-no-catalog`,
        table.id,
      ).expect(400);
    });
  });

  describe('idempotent replay after a modifier price changes', () => {
    it('returns the original accepted order unchanged, never re-priced against the new option price', async () => {
      const table = await freeTable();
      const idempotencyKey = `${TAG}-replay-after-price-change`;

      const first = await postStaffOrder(
        [{ menuItemId: itemId, quantity: 1, selectedModifiers: [{ modifierGroupId: sauceGroupId, optionId: garlicOptionId }] }],
        idempotencyKey,
        table.id,
      ).expect(201);
      expect(first.body.subtotalCents).toBe(7050);

      // Change the option's price via the real authoring API.
      const current = await prisma.menuItem.findUniqueOrThrow({ where: { id: itemId } });
      const updatedGroups = (current.modifierGroups as Array<{ id: string; options: Array<{ id: string; priceDeltaCents: number; [k: string]: unknown }>; [k: string]: unknown }>).map(
        (g) =>
          g.id === sauceGroupId
            ? { ...g, options: g.options.map((o) => (o.id === garlicOptionId ? { ...o, priceDeltaCents: 500 } : o)) }
            : g,
      );
      await request(app.getHttpServer())
        .patch(`/api/admin/menu/items/${itemId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ modifierGroups: updatedGroups })
        .expect(200);

      // Replay the exact same request (same idempotency key, same cart shape).
      const replay = await postStaffOrder(
        [{ menuItemId: itemId, quantity: 1, selectedModifiers: [{ modifierGroupId: sauceGroupId, optionId: garlicOptionId }] }],
        idempotencyKey,
        table.id,
      ).expect(201);

      expect(replay.body.id).toBe(first.body.id);
      expect(replay.body.subtotalCents).toBe(7050); // original price, NOT the new $5.00

      // Restore the option's price for any later test/run in this file.
      await request(app.getHttpServer())
        .patch(`/api/admin/menu/items/${itemId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ modifierGroups: current.modifierGroups })
        .expect(200);
    });
  });
});
