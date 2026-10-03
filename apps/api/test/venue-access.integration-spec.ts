// Integration test against a REAL local Postgres and Redis — no mocking.
// Story 2.10 (SEC-16.3, PRD section 16 item 3): staff act only in venues
// they have been granted, in the Nest API as in Core (Story 2.2), owners
// included. A venue of the organization without a grant is refused with 403;
// another organization's venue keeps its 404; lists narrow to the granted
// venues; a revoked grant takes effect on the next request.
//
// Run with: npm run test:integration --workspace=apps/api
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import Redis from 'ioredis';
import { StaffRole } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { SecurityEventSink, setSecurityEventSink } from '../src/observability/security-events';

const TAG = `story210-${Date.now()}`;
const PASSWORD = 'a long staff password 210';
const DENIED = 'Staff access to this venue has not been granted';

describe('Staff venue access in the Nest API (integration, real Postgres and Redis)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let organizationId: string;
  let venueA: string; // seeded, granted to the owner and the manager
  let venueB: string; // same organization, granted to nobody
  let foreignVenue: string; // another organization
  let foreignOrgId: string;
  let ownerToken: string;
  let ownerId: string;
  let manager: { id: string; email: string; token: string };
  let orderInB: string;
  const createdVenues: string[] = [];
  let lines: string[] = [];
  let previousSink: SecurityEventSink;

  const http = () => request(app.getHttpServer());
  const as = (token: string) => ({ Authorization: `Bearer ${token}` });
  const events = () => lines.map((l) => JSON.parse(l) as Record<string, unknown>);

  async function resetRateLimits() {
    const redis = new Redis({
      host: process.env.REDIS_HOST ?? '127.0.0.1',
      port: Number(process.env.REDIS_PORT ?? 6379),
    });
    try {
      const keys = await redis.keys('rate-limit:*');
      if (keys.length > 0) await redis.del(...keys);
    } finally {
      redis.disconnect();
    }
  }

  async function login(email: string, password: string) {
    await resetRateLimits();
    const res = await http().post('/api/auth/login').send({ email, password }).expect(200);
    return res.body.accessToken as string;
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
    previousSink = setSecurityEventSink((line) => lines.push(line));

    const venue = await prisma.venue.findFirstOrThrow({ where: { slug: 'auckland' } });
    organizationId = venue.organizationId;
    venueA = venue.id;
    const ownerEmail = process.env.SEED_OWNER_EMAIL ?? 'owner@verdura.co.nz';
    ownerId = (await prisma.staff.findFirstOrThrow({ where: { email: ownerEmail } })).id;
    ownerToken = await login(ownerEmail, process.env.SEED_OWNER_PASSWORD!);

    venueB = (
      await prisma.venue.create({
        data: {
          organizationId,
          name: `${TAG} B`,
          slug: `${TAG}-b`,
          address: {},
          operatingHours: {},
          seatingCapacity: 10,
        },
      })
    ).id;
    createdVenues.push(venueB);
    const foreignOrg = await prisma.organization.create({
      data: { name: `${TAG} other`, slug: `${TAG}-other`, billingEmail: 'billing@example.test' },
    });
    foreignOrgId = foreignOrg.id;
    foreignVenue = (
      await prisma.venue.create({
        data: {
          organizationId: foreignOrgId,
          name: `${TAG} foreign`,
          slug: `${TAG}-foreign`,
          address: {},
          operatingHours: {},
          seatingCapacity: 10,
        },
      })
    ).id;
    orderInB = (
      await prisma.order.create({
        data: { venueId: venueB, subtotalCents: 0, totalCents: 0, idempotencyKey: `${TAG}-b` },
      })
    ).id;

    const email = `${TAG}-manager@example.test`;
    const created = await http()
      .post('/api/admin/staff')
      .set(as(ownerToken))
      .send({ name: 'Venue A manager', email, role: 'manager', venueIds: [venueA] })
      .expect(201);
    await resetRateLimits();
    await http()
      .post('/api/auth/credential-setup')
      .send({ code: created.body.credentialSetup.code, password: PASSWORD })
      .expect(204);
    manager = { id: created.body.staff.id, email, token: await login(email, PASSWORD) };
  });

  beforeEach(() => {
    lines = [];
  });

  afterAll(async () => {
    setSecurityEventSink(previousSink);
    const venues = [...createdVenues, foreignVenue];
    await prisma.order.deleteMany({ where: { venueId: { in: venues } } });
    await prisma.auditLog.deleteMany({
      where: {
        OR: [{ actorId: manager.id }, { resourceId: manager.id }, { venueId: { in: venues } }],
      },
    });
    await prisma.staffSession.deleteMany({ where: { staffId: manager.id } });
    await prisma.staffCredentialToken.deleteMany({ where: { staffId: manager.id } });
    await prisma.venueAccess.deleteMany({
      where: { OR: [{ staffId: manager.id }, { venueId: { in: venues } }] },
    });
    await prisma.staff.deleteMany({ where: { id: manager.id } });
    await prisma.venue.deleteMany({ where: { id: { in: venues } } });
    await prisma.organization.delete({ where: { id: foreignOrgId } });
    await app.close();
  });

  it('serves a granted venue', async () => {
    await http().get(`/api/venues/${venueA}/tax-config`).set(as(manager.token)).expect(200);
    await http().get(`/api/venues/${venueA}/tables`).set(as(manager.token)).expect(200);
    await http().get(`/api/admin/orders?venueId=${venueA}`).set(as(manager.token)).expect(200);
  });

  it('refuses a venue of the organization without a grant, owner included, with Core’s 403', async () => {
    for (const token of [manager.token, ownerToken]) {
      const attempts = [
        () => http().get(`/api/venues/${venueB}/tax-config`),
        () => http().get(`/api/venues/${venueB}/tables`),
        () => http().get(`/api/venues/${venueB}`),
        () => http().get(`/api/admin/orders?venueId=${venueB}`),
        () => http().get(`/api/admin/orders/${orderInB}`),
        () => http().get(`/api/admin/orders/${orderInB}/rounds`),
        () => http().post('/api/admin/orders').send({ venueId: venueB, items: [] }),
        () => http().get(`/api/admin/reservations?venueId=${venueB}`),
        () => http().get(`/api/venues/${venueB}/tablet-devices/devices`),
        () => http().get(`/api/venues/${venueB}/connector/installations`),
        () => http().get(`/api/admin/venues/${venueB}/payment-observations`),
        () => http().get(`/api/admin/venues/${venueB}/pos-sync-records`),
      ];
      for (const attempt of attempts) {
        const res = await attempt().set(as(token));
        expect({ status: res.status, body: res.body }).toEqual({
          status: 403,
          body: { message: DENIED, error: 'Forbidden', statusCode: 403 },
        });
      }
    }
    const denied = events().filter((e) => e.event === 'venue_access_denied');
    expect(denied.length).toBeGreaterThanOrEqual(24);
    expect(denied[0]).toMatchObject({ staff_id: manager.id, venue_id: venueB, level: 'WARN' });
    expect(lines.join('\n')).not.toContain(manager.token);
  });

  it('keeps another organization’s venue a 404, never revealing it', async () => {
    await http().get(`/api/venues/${foreignVenue}/tax-config`).set(as(ownerToken)).expect(404);
    await http().get(`/api/venues/${foreignVenue}`).set(as(ownerToken)).expect(404);
    expect(events().filter((e) => e.event === 'venue_access_denied')).toEqual([]);
  });

  it('narrows lists across venues to the granted venues', async () => {
    const venues = await http().get('/api/venues').set(as(manager.token)).expect(200);
    const ids = (venues.body as { id: string }[]).map((v) => v.id);
    expect(ids).toContain(venueA);
    expect(ids).not.toContain(venueB);

    const orders = await http().get('/api/admin/orders').set(as(ownerToken)).expect(200);
    const orderIds = (orders.body as { id: string; venueId: string }[]).map((o) => o.id);
    expect(orderIds).not.toContain(orderInB);
  });

  it('applies a revoked grant on the next request of the same session, and a new one too', async () => {
    await http()
      .delete(`/api/admin/staff/${manager.id}/venues/${venueA}`)
      .set(as(ownerToken))
      .expect(200);
    const refused = await http().get(`/api/venues/${venueA}/tax-config`).set(as(manager.token));
    expect({ status: refused.status, message: refused.body.message }).toEqual({
      status: 403,
      message: DENIED,
    });
    await http()
      .put(`/api/admin/staff/${manager.id}/venues/${venueA}`)
      .set(as(ownerToken))
      .expect(200);
    await http().get(`/api/venues/${venueA}/tax-config`).set(as(manager.token)).expect(200);
  });

  it('needs the staff member’s grant for an elevated tablet; a KDS screen stays pinned', async () => {
    const jwt = app.get(JwtService);
    const sign = (claims: Record<string, unknown>) =>
      jwt.sign(claims, { secret: process.env.JWT_ACCESS_SECRET!, expiresIn: '5m' });
    const enrollment = await prisma.tabletEnrollment.create({
      data: {
        organizationId,
        venueId: venueA,
        codeHash: 'not-a-real-code',
        createdByStaffId: ownerId,
        expiresAt: new Date(Date.now() + 60_000),
        usedAt: new Date(),
      },
    });
    const device = await prisma.tabletDevice.create({
      data: {
        organizationId,
        venueId: venueA,
        enrollmentId: enrollment.id,
        label: `${TAG} tablet`,
        secretHash: 'not-a-real-secret',
      },
    });
    try {
      const elevated = sign({
        sub: manager.id,
        email: manager.email,
        role: StaffRole.manager,
        organizationId,
        venueId: venueA,
        kind: 'tablet_staff',
        deviceId: device.id,
      });
      const kds = sign({
        sub: `kds-device:${venueA}`,
        email: 'kds@verdura.internal',
        role: StaffRole.kitchen,
        organizationId,
        venueId: venueA,
        kind: 'kds_device',
      });
      await http().get(`/api/venues/${venueA}/tax-config`).set(as(elevated)).expect(200);
      await http()
        .delete(`/api/admin/staff/${manager.id}/venues/${venueA}`)
        .set(as(ownerToken))
        .expect(200);
      const refused = await http().get(`/api/venues/${venueA}/tax-config`).set(as(elevated));
      expect({ status: refused.status, message: refused.body.message }).toEqual({
        status: 403,
        message: DENIED,
      });
      await http().get(`/api/venues/${venueA}/tax-config`).set(as(kds)).expect(200);
      await http().get(`/api/venues/${venueB}/tax-config`).set(as(kds)).expect(403);
    } finally {
      await http()
        .put(`/api/admin/staff/${manager.id}/venues/${venueA}`)
        .set(as(ownerToken))
        .expect(200);
      await prisma.tabletDevice.delete({ where: { id: device.id } });
      await prisma.tabletEnrollment.delete({ where: { id: enrollment.id } });
    }
  });

  it('grants a new venue to the staff member who creates it', async () => {
    const res = await http()
      .post('/api/venues')
      .set(as(ownerToken))
      .send({
        name: `${TAG} new`,
        slug: `${TAG}-new`,
        address: {},
        operatingHours: {},
        seatingCapacity: 10,
      })
      .expect(201);
    createdVenues.push(res.body.id as string);
    await http().get(`/api/venues/${res.body.id}`).set(as(ownerToken)).expect(200);
    const grant = await prisma.venueAccess.findUniqueOrThrow({
      where: { staffId_venueId: { staffId: ownerId, venueId: res.body.id as string } },
    });
    expect(grant.grantedById).toBe(ownerId);
  });

  it('refuses a venue ID that is not a single value rather than skipping the check', async () => {
    await http()
      .get(`/api/admin/orders?venueId=${venueA}&venueId=${venueB}`)
      .set(as(manager.token))
      .expect(400);
  });
});
