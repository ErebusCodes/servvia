// Integration test against a REAL local Postgres (see
// local-postgres/README.md) — no mocking. Verifies the Phase 2 menu
// unification: the canonical seeded menu counts, and that admin CRUD
// actually persists to Postgres rather than any in-memory/localStorage
// state, by re-reading via a second, independent Prisma query after each
// mutation (equivalent to "a second browser session sees the same data").
//
// Run with: npm run test:integration --workspace=backend
// Requires: npm run db:local:start && npm run db:migrate && npm run db:seed
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Menu API (integration, real local Postgres)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let accessToken: string;
  let venueId: string;
  let organizationId: string;

  beforeAll(async () => {
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
    await app.close();
  });

  it('kiosk menu endpoint (public) returns the canonical 10 categories / 70 items, correctly ordered', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/kiosk/venues/${venueId}/menu`)
      .expect(200);

    expect(res.body.categories).toHaveLength(10);
    expect(res.body.menuItems).toHaveLength(70);

    const categorySortOrders = res.body.categories.map((c: { sortOrder: number }) => c.sortOrder);
    expect(categorySortOrders).toEqual([...categorySortOrders].sort((a, b) => a - b));

    const itemSortOrders = res.body.menuItems.map((i: { sortOrder: number }) => i.sortOrder);
    expect(itemSortOrders).toEqual([...itemSortOrders].sort((a, b) => a - b));
  });

  it('admin menu endpoints reject requests without a valid staff token', async () => {
    await request(app.getHttpServer()).get('/api/admin/menu/items').expect(401);
    await request(app.getHttpServer()).get('/api/admin/menu/categories').expect(401);
  });

  it('admin category create/update persists to Postgres and is visible on independent re-read', async () => {
    const createRes = await request(app.getHttpServer())
      .post('/api/admin/menu/categories')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ name: 'Phase 2 Integration Test Category', sortOrder: 999, isActive: true })
      .expect(201);
    const categoryId = createRes.body.id as string;

    // "Second session sees the same data" — re-read directly from Postgres,
    // independent of whatever request created it.
    expect((await prisma.category.findUniqueOrThrow({ where: { id: categoryId } })).name).toBe(
      'Phase 2 Integration Test Category',
    );

    await request(app.getHttpServer())
      .patch(`/api/admin/menu/categories/${categoryId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ name: 'Phase 2 Integration Test Category (renamed)' })
      .expect(200);

    expect((await prisma.category.findUniqueOrThrow({ where: { id: categoryId } })).name).toBe(
      'Phase 2 Integration Test Category (renamed)',
    );

    await request(app.getHttpServer())
      .delete(`/api/admin/menu/categories/${categoryId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    await expect(
      prisma.category.findUniqueOrThrow({ where: { id: categoryId } }),
    ).rejects.toThrow();
  });

  it('admin item create + availability toggle persists to Postgres', async () => {
    const category = await prisma.category.findFirstOrThrow({ where: { organizationId } });

    const createRes = await request(app.getHttpServer())
      .post('/api/admin/menu/items')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        title: 'Phase 2 Integration Test Item',
        description: 'Temporary integration-test item, deleted at the end of this test.',
        categoryId: category.id,
        priceCents: 1234,
        isAvailable: true,
      })
      .expect(201);
    const itemId = createRes.body.id as string;

    expect((await prisma.menuItem.findUniqueOrThrow({ where: { id: itemId } })).isAvailable).toBe(
      true,
    );

    await request(app.getHttpServer())
      .patch(`/api/admin/menu/items/${itemId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ isAvailable: false })
      .expect(200);

    expect((await prisma.menuItem.findUniqueOrThrow({ where: { id: itemId } })).isAvailable).toBe(
      false,
    );

    await request(app.getHttpServer())
      .delete(`/api/admin/menu/items/${itemId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(204);
  });

  it('accepts a site-relative imageUrl (the canonical /menu-images/ convention), not just absolute URLs', async () => {
    const category = await prisma.category.findFirstOrThrow({ where: { organizationId } });

    const createRes = await request(app.getHttpServer())
      .post('/api/admin/menu/items')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        title: 'Phase 2 Integration Test Relative Image Item',
        description: 'Temporary integration-test item.',
        categoryId: category.id,
        priceCents: 500,
        imageUrl: '/menu-images/phase2-integration-test.jpg',
      })
      .expect(201);

    expect(createRes.body.imageUrl).toBe('/menu-images/phase2-integration-test.jpg');

    await request(app.getHttpServer())
      .delete(`/api/admin/menu/items/${createRes.body.id}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(204);
  });

  it('posProductCode (the IdealPOS mapping field) persists to real Postgres, and reusing it for another item in the same org is rejected — DB-enforced, not merely a frontend check', async () => {
    const category = await prisma.category.findFirstOrThrow({ where: { organizationId } });
    const posProductCode = `PHASE2_PLU_${Date.now()}`;

    const first = await request(app.getHttpServer())
      .post('/api/admin/menu/items')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        title: 'Phase 2 PLU Mapping Test Item A',
        description: 'Temporary integration-test item, deleted at the end of this test.',
        categoryId: category.id,
        priceCents: 1000,
        posProductCode,
      })
      .expect(201);
    expect(first.body.posProductCode).toBe(posProductCode);
    expect(
      (await prisma.menuItem.findUniqueOrThrow({ where: { id: first.body.id as string } }))
        .posProductCode,
    ).toBe(posProductCode);

    // A second, genuinely different item reusing the same real Idealpos
    // product code would silently misroute an order at the bridge — this
    // must be a real, DB-backed 409, not merely a UI hint.
    const second = await request(app.getHttpServer())
      .post('/api/admin/menu/items')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        title: 'Phase 2 PLU Mapping Test Item B',
        description: 'Temporary integration-test item; should never be created.',
        categoryId: category.id,
        priceCents: 2000,
        posProductCode,
      })
      .expect(409);
    expect(second.body.message).toContain(posProductCode);

    const afterCount = await prisma.menuItem.count({ where: { posProductCode } });
    expect(afterCount).toBe(1);

    await request(app.getHttpServer())
      .delete(`/api/admin/menu/items/${first.body.id as string}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(204);
  });
});
