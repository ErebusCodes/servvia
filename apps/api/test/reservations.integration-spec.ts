// Integration test against a REAL local Postgres (see
// local-postgres/README.md) — no mocking. Exercises the Phase 3 reservation
// system end to end: public availability/creation, capacity enforcement,
// admin visibility, and status transitions, all through the real HTTP
// surface (not calling the service directly), the same way a browser would.
//
// Run with: npm run test:integration --workspace=backend
// Requires: npm run db:local:start && npm run db:migrate && npm run db:seed
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Reservations API (integration, real local Postgres)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let accessToken: string;
  let venueId: string;
  let csrfToken: string;

  // The CSRF middleware issues csrf_token via a Set-Cookie and requires the
  // same value echoed back as an x-csrf-token header on state-changing
  // requests. supertest's http.Agent-based client doesn't run a browser
  // cookie jar, so both the cookie and the header are set explicitly here
  // (a real browser does this automatically) rather than relying on
  // automatic cookie persistence.
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

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    // main.ts's bootstrap() wires cookie-parser before CsrfMiddleware runs;
    // this test builds the Nest app directly (not via bootstrap()), so it
    // must be registered the same way here for req.cookies to populate.
    app.use(cookieParser());
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

    // Prime a CSRF token the same way a browser's first page load would.
    const primer = await request(app.getHttpServer()).get(
      `/api/reservations/venues/${venueId}/availability?date=2026-09-01&time=19:00`,
    );
    csrfToken = extractCsrfToken(primer.headers['set-cookie'] as unknown as string[]) ?? '';
    if (!csrfToken) throw new Error('Failed to obtain a CSRF token for the integration test setup.');
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  afterEach(async () => {
    // Keep the shared test venue/slot clean between tests.
    await prisma.reservation.deleteMany({ where: { guestEmail: { contains: '@phase3-integration.test' } } });
  });

  const DATE = '2026-09-15';
  const TIME = '19:00';

  it('1. returns real availability for a valid, empty slot', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/reservations/venues/${venueId}/availability?date=${DATE}&time=${TIME}&partySize=4`)
      .expect(200);
    expect(res.body.available).toBe(true);
    expect(res.body.bookedCovers).toBe(0);
    expect(res.body.coversPerSlot).toBeGreaterThan(0);
  });

  it('2 & 3. creates a real reservation that actually exists in Postgres', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/reservations')
      .set(csrfHeaders())
      .send({
        venueId,
        guestName: 'Integration Test Guest',
        guestEmail: 'guest@phase3-integration.test',
        partySize: 2,
        reservationDate: DATE,
        reservationTime: TIME,
        paymentMethod: 'pay_at_restaurant',
      })
      .expect(201);

    expect(res.body.id).toBeTruthy();
    expect(res.body.bookingRef).toMatch(/^VR-\d+$/);
    expect(res.body.status).toBe('pending');

    const dbRow = await prisma.reservation.findUniqueOrThrow({ where: { id: res.body.id } });
    expect(dbRow.guestEmail).toBe('guest@phase3-integration.test');
    expect(dbRow.paymentMethod).toBe('pay_at_restaurant');
  });

  it('4. rejects an invalid party size', async () => {
    await request(app.getHttpServer())
      .post('/api/reservations')
      .set(csrfHeaders())
      .send({
        venueId,
        guestName: 'Bad Party Size',
        guestEmail: 'badpartysize@phase3-integration.test',
        partySize: 0,
        reservationDate: DATE,
        reservationTime: TIME,
      })
      .expect(400);

    await request(app.getHttpServer())
      .post('/api/reservations')
      .set(csrfHeaders())
      .send({
        venueId,
        guestName: 'Bad Party Size',
        guestEmail: 'badpartysize2@phase3-integration.test',
        partySize: 101,
        reservationDate: DATE,
        reservationTime: TIME,
      })
      .expect(400);
  });

  it('5. rejects malformed date/time', async () => {
    await request(app.getHttpServer())
      .post('/api/reservations')
      .set(csrfHeaders())
      .send({
        venueId,
        guestName: 'Bad Date',
        guestEmail: 'baddate@phase3-integration.test',
        partySize: 2,
        reservationDate: '15/09/2026',
        reservationTime: TIME,
      })
      .expect(400);

    await request(app.getHttpServer())
      .post('/api/reservations')
      .set(csrfHeaders())
      .send({
        venueId,
        guestName: 'Bad Time',
        guestEmail: 'badtime@phase3-integration.test',
        partySize: 2,
        reservationDate: DATE,
        reservationTime: '7:00 PM',
      })
      .expect(400);

    await request(app.getHttpServer())
      .get(`/api/reservations/venues/${venueId}/availability?date=15-09-2026&time=${TIME}`)
      .expect(400);
  });

  it('6 & 7. enforces capacity and rejects overbooking', async () => {
    const venue = await prisma.venue.findFirstOrThrow({ where: { id: venueId } });
    const almostFull = venue.coversPerSlot - 1;

    await request(app.getHttpServer())
      .post('/api/reservations')
      .set(csrfHeaders())
      .send({
        venueId,
        guestName: 'Almost Full',
        guestEmail: 'almostfull@phase3-integration.test',
        partySize: almostFull,
        reservationDate: DATE,
        reservationTime: '20:00',
      })
      .expect(201);

    const avail = await request(app.getHttpServer())
      .get(`/api/reservations/venues/${venueId}/availability?date=${DATE}&time=20:00&partySize=2`)
      .expect(200);
    expect(avail.body.remainingCovers).toBe(1);
    expect(avail.body.available).toBe(false);

    await request(app.getHttpServer())
      .post('/api/reservations')
      .set(csrfHeaders())
      .send({
        venueId,
        guestName: 'Overbooker',
        guestEmail: 'overbooker@phase3-integration.test',
        partySize: 2,
        reservationDate: DATE,
        reservationTime: '20:00',
      })
      .expect(409);
  });

  it('8. rejects a nonexistent venue', async () => {
    await request(app.getHttpServer())
      .get(`/api/reservations/venues/00000000-0000-0000-0000-000000000000/availability?date=${DATE}&time=${TIME}`)
      .expect(404);

    await request(app.getHttpServer())
      .post('/api/reservations')
      .set(csrfHeaders())
      .send({
        venueId: '00000000-0000-0000-0000-000000000000',
        guestName: 'No Venue',
        guestEmail: 'novenue@phase3-integration.test',
        partySize: 2,
        reservationDate: DATE,
        reservationTime: TIME,
      })
      .expect(404);
  });

  it('9, 10 & 11. admin can retrieve a customer-created reservation and transition its status; invalid transitions are rejected', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/reservations')
      .set(csrfHeaders())
      .send({
        venueId,
        guestName: 'Transition Test Guest',
        guestEmail: 'transition@phase3-integration.test',
        partySize: 2,
        reservationDate: DATE,
        reservationTime: '21:00',
      })
      .expect(201);

    // 9. Admin can retrieve it.
    const adminList = await request(app.getHttpServer())
      .get('/api/admin/reservations')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(adminList.body.some((r: { id: string }) => r.id === created.body.id)).toBe(true);

    // 10. Valid transition: pending -> confirmed.
    const confirmed = await request(app.getHttpServer())
      .patch(`/api/admin/reservations/${created.body.id}/status`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ status: 'confirmed' })
      .expect(200);
    expect(confirmed.body.status).toBe('confirmed');
    const dbRow = await prisma.reservation.findUniqueOrThrow({ where: { id: created.body.id } });
    expect(dbRow.status).toBe('confirmed');
    expect(dbRow.confirmedAt).not.toBeNull();

    // 11. Invalid transition: confirmed -> pending is not in the FSM.
    await request(app.getHttpServer())
      .patch(`/api/admin/reservations/${created.body.id}/status`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ status: 'pending' })
      .expect(409);
  });

  it('12. the public endpoint cannot perform staff-only operations', async () => {
    // No list/update/status/delete route exists under /api/reservations
    // (only /api/admin/reservations) — confirm the public prefix 404s for
    // those, rather than accidentally routing to the staff controller.
    await request(app.getHttpServer()).get('/api/reservations').expect(404);
    // CSRF-valid so this actually reaches routing (and correctly still 404s)
    // rather than being rejected earlier by the CSRF middleware, which would
    // also block it but wouldn't prove the route itself doesn't exist.
    await request(app.getHttpServer())
      .patch(`/api/reservations/${venueId}/status`)
      .set(csrfHeaders())
      .send({ status: 'confirmed' })
      .expect(404);

    // And the real staff-only endpoints reject an unauthenticated caller.
    await request(app.getHttpServer()).get('/api/admin/reservations').expect(401);
    // CSRF-valid so this specifically exercises JwtAuthGuard's rejection
    // (401) rather than being blocked earlier by the CSRF middleware (403)
    // — both reject an unauthenticated caller, but this isolates which
    // layer is doing it.
    await request(app.getHttpServer())
      .patch('/api/admin/reservations/00000000-0000-0000-0000-000000000000/status')
      .set(csrfHeaders())
      .send({ status: 'confirmed' })
      .expect(401);
  });
});
