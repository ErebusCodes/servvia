// Integration test against a REAL local Postgres (see
// local-postgres/README.md) — no mocking. Verifies Table.posTableCode (the
// IdealPOS native table-code mapping field) persists via the real HTTP
// admin endpoint and that reusing it for another table in the same venue
// is rejected by the real database constraint, not merely a frontend hint.
//
// Run with: npm run test:integration --workspace=backend
// Requires: npm run db:local:start && npm run db:migrate && npm run db:seed
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Tables API — posTableCode (integration, real local Postgres)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let accessToken: string;
  let venueId: string;

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

  it('persists via PATCH to real Postgres, and reusing it for another table in the same venue is rejected — DB-enforced, not merely a frontend check', async () => {
    // Excludes tableNumber '19': table19-validation.integration-spec.ts
    // deliberately creates (and never deletes — see that file's own
    // comment) a persistent Table 19 row with sortOrder 0, specifically so
    // it always sorts first. A plain `take: 2` here would pick it up
    // whenever that spec file has already run against the same database,
    // and Table 19 is intentionally NOT one of shared/table-config.json's
    // 18 canonical tables — canonicalTable() rejects it outright, which is
    // this test's own root cause if it isn't excluded here.
    const tables = await prisma.table.findMany({
      where: { venueId, tableNumber: { not: '19' } },
      orderBy: { sortOrder: 'asc' },
      take: 2,
    });
    expect(tables.length).toBeGreaterThanOrEqual(2);
    const [tableA, tableB] = tables;
    const posTableCode = `PHASE2_CAPTION_${Date.now()}`;

    try {
      const patchA = await request(app.getHttpServer())
        .patch(`/api/venues/${venueId}/tables/${tableA.id}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ posTableCode })
        .expect(200);
      expect(patchA.body.posTableCode).toBe(posTableCode);
      expect(
        (await prisma.table.findUniqueOrThrow({ where: { id: tableA.id } })).posTableCode,
      ).toBe(posTableCode);

      // A second, genuinely different table reusing the same real Idealpos
      // table Caption would silently misroute an order at the bridge —
      // this must be a real, DB-backed 409, not merely a UI hint.
      const patchB = await request(app.getHttpServer())
        .patch(`/api/venues/${venueId}/tables/${tableB.id}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ posTableCode })
        .expect(409);
      expect(patchB.body.message).toContain(posTableCode);

      const stillNull = await prisma.table.findUniqueOrThrow({ where: { id: tableB.id } });
      expect(stillNull.posTableCode).not.toBe(posTableCode);
    } finally {
      // UpdateTableDto has no way to explicitly clear an optional string
      // field back to null (a pre-existing limitation shared by every
      // other optional string field on this DTO, not unique to this
      // story) — clean up directly via Prisma so this shared dev database
      // isn't left with test-only mapping residue on real seeded tables.
      await prisma.table.update({ where: { id: tableA.id }, data: { posTableCode: null } });
    }
  });
});
