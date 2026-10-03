// Integration test against a REAL local Postgres and Redis — no mocking.
// Story 8.1 (STF-1): staff accounts, roles, venue grants and credentials,
// end to end through the real HTTP surface, including every refusal.
//
// Run with: npm run test:integration --workspace=backend
// Requires: npm run db:local:start && npm run db:migrate && npm run db:seed
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { AuthService } from '../src/auth/auth.service';
import Redis from 'ioredis';
import * as argon2 from 'argon2';
import { AuditLogService } from '../src/audit/audit.service';

const TAG = `story81-${Date.now()}`;
const PASSWORD = 'a long staff password 81';

describe('Staff administration (integration, real Postgres and Redis)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let organizationId: string;
  let venueId: string;
  let ownerToken: string;
  const createdStaff: string[] = [];
  const createdVenues: string[] = [];
  let otherOrgId: string | undefined;
  let raceOrgId: string | undefined;

  const http = () => request(app.getHttpServer());
  const as = (token: string) => ({ Authorization: `Bearer ${token}` });

  // This spec signs in and sets credentials far more often than the real
  // 10-per-15-minutes limit allows from one address; it clears the buckets
  // the way integration-rate-limit-reset.ts does between files. The limit
  // itself is proven in auth-session and Story 2.4 tests.
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

  async function login(email: string, password: string, expected = 200) {
    await resetRateLimits();
    const res = await http().post('/api/auth/login').send({ email, password }).expect(expected);
    return res.body.accessToken as string;
  }

  async function createStaff(
    token: string,
    body: { name: string; email: string; role: string; venueIds: string[] },
    expected = 201,
  ) {
    const res = await http().post('/api/admin/staff').set(as(token)).send(body).expect(expected);
    if (expected === 201) createdStaff.push(res.body.staff.id as string);
    return res.body as {
      staff: { id: string; email: string; role: string; venueIds: string[] };
      credentialSetup: { code: string; expiresAt: string };
    };
  }

  async function onboard(token: string, role: string, label: string) {
    const email = `${TAG}-${label}@example.test`;
    const created = await createStaff(token, { name: label, email, role, venueIds: [venueId] });
    await resetRateLimits();
    await http()
      .post('/api/auth/credential-setup')
      .send({ code: created.credentialSetup.code, password: PASSWORD })
      .expect(204);
    return { id: created.staff.id, email, token: await login(email, PASSWORD) };
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

    const venue = await prisma.venue.findFirstOrThrow({ where: { slug: 'auckland' } });
    organizationId = venue.organizationId;
    venueId = venue.id;
    ownerToken = await login(
      process.env.SEED_OWNER_EMAIL ?? 'owner@verdura.co.nz',
      process.env.SEED_OWNER_PASSWORD!,
    );
  });

  afterAll(async () => {
    const ids = createdStaff;
    await prisma.auditLog.deleteMany({
      where: { OR: [{ actorId: { in: ids } }, { resourceId: { in: ids } }] },
    });
    await prisma.staffCredentialToken.deleteMany({
      where: { OR: [{ staffId: { in: ids } }, { issuedById: { in: ids } }] },
    });
    await prisma.venueAccess.deleteMany({
      where: { OR: [{ staffId: { in: ids } }, { grantedById: { in: ids } }] },
    });
    await prisma.staff.deleteMany({ where: { id: { in: ids } } });
    await prisma.auditLog.deleteMany({ where: { venueId: { in: createdVenues } } });
    await prisma.venue.deleteMany({ where: { id: { in: createdVenues } } });
    if (raceOrgId) {
      const raceStaff = { organizationId: raceOrgId };
      await prisma.auditLog.deleteMany({ where: { organizationId: raceOrgId } });
      await prisma.staffSession.deleteMany({ where: { staff: raceStaff } });
      await prisma.staff.deleteMany({ where: raceStaff });
      await prisma.organization.delete({ where: { id: raceOrgId } });
    }
    if (otherOrgId) {
      await prisma.staff.deleteMany({ where: { organizationId: otherOrgId } });
      await prisma.organization.delete({ where: { id: otherOrgId } });
    }
    await app.close();
  });

  it('creates an account with no usable password and a single-use setup code', async () => {
    const email = `${TAG}-new@example.test`;
    const created = await createStaff(ownerToken, {
      name: 'New Waiter',
      email: email.toUpperCase(),
      role: 'cashier',
      venueIds: [venueId],
    });
    expect(created.staff).toMatchObject({ email, role: 'cashier', venueIds: [venueId] });
    expect(JSON.stringify(created)).not.toMatch(/passwordHash|pinHash|tokenHash|\$argon2/);
    expect(created.credentialSetup.code).toMatch(/^[0-9a-f-]{36}\..{20,}$/);

    // Nobody can sign in before the staff member sets their own password.
    await login(email, PASSWORD, 401);

    // Wrong secret, unknown code, too-short password: refused, nothing used.
    const [id] = created.credentialSetup.code.split('.');
    for (const code of [`${id}.wrong-secret-value`, `00000000-0000-4000-8000-000000000000.x`]) {
      const res = await http()
        .post('/api/auth/credential-setup')
        .send({ code, password: PASSWORD });
      expect(res.status).toBe(401);
      expect(res.body.message).toBe('Invalid or expired setup code');
    }
    await http()
      .post('/api/auth/credential-setup')
      .send({ code: created.credentialSetup.code, password: 'short' })
      .expect(400);

    await http()
      .post('/api/auth/credential-setup')
      .send({ code: created.credentialSetup.code, password: PASSWORD })
      .expect(204);
    // Single use.
    await http()
      .post('/api/auth/credential-setup')
      .send({ code: created.credentialSetup.code, password: `${PASSWORD} again` })
      .expect(401);
    await login(email, PASSWORD);

    const hash = (await prisma.staff.findUniqueOrThrow({ where: { email } })).passwordHash;
    expect(hash.startsWith('$argon2id$')).toBe(true);
  });

  it('refuses a duplicate email', async () => {
    const email = `${TAG}-dup@example.test`;
    await createStaff(ownerToken, { name: 'Dup', email, role: 'viewer', venueIds: [] });
    await createStaff(ownerToken, { name: 'Dup 2', email, role: 'viewer', venueIds: [] }, 409);
  });

  it('enforces who may administer whom', async () => {
    const admin = await onboard(ownerToken, 'admin', 'admin');
    const manager = await onboard(admin.token, 'manager', 'manager');
    const cashier = await onboard(admin.token, 'cashier', 'cashier');
    const owner = await prisma.staff.findFirstOrThrow({
      where: {
        organizationId,
        role: 'owner',
        email: process.env.SEED_OWNER_EMAIL ?? 'owner@verdura.co.nz',
      },
    });

    // An admin may not create or promote to admin or owner, nor touch an owner.
    for (const role of ['admin', 'owner']) {
      await createStaff(
        admin.token,
        { name: 'X', email: `${TAG}-x-${role}@example.test`, role, venueIds: [] },
        403,
      );
      await http()
        .patch(`/api/admin/staff/${cashier.id}`)
        .set(as(admin.token))
        .send({ role })
        .expect(403);
    }
    await http().post(`/api/admin/staff/${owner.id}/deactivate`).set(as(admin.token)).expect(403);
    await http()
      .post(`/api/admin/staff/${owner.id}/credential-reset`)
      .set(as(admin.token))
      .expect(403);

    // A manager administers nobody, and may not set a superior's tablet PIN.
    await createStaff(
      manager.token,
      { name: 'Y', email: `${TAG}-y@example.test`, role: 'viewer', venueIds: [] },
      403,
    );
    await http()
      .post(`/api/admin/staff/${cashier.id}/deactivate`)
      .set(as(manager.token))
      .expect(403);
    await http()
      .post(`/api/admin/staff/${admin.id}/tablet-pin`)
      .set(as(manager.token))
      .send({ pin: '5150' })
      .expect(403);
    await http()
      .post(`/api/admin/staff/${cashier.id}/tablet-pin`)
      .set(as(manager.token))
      .send({ pin: '5150' })
      .expect(201);

    // A cashier cannot even list staff; a KDS device token is never a staff session.
    await http().get('/api/admin/staff').set(as(cashier.token)).expect(403);
    const kds = app.get(AuthService).signKdsDeviceToken(venueId, organizationId);
    await http().get('/api/admin/staff').set(as(kds)).expect(403);

    // Nobody deactivates, removes, resets or re-roles themselves here.
    await http().post(`/api/admin/staff/${admin.id}/deactivate`).set(as(admin.token)).expect(403);
    await http().delete(`/api/admin/staff/${admin.id}`).set(as(admin.token)).expect(403);
    await http().post(`/api/admin/staff/${owner.id}/deactivate`).set(as(ownerToken)).expect(403);
    await http()
      .patch(`/api/admin/staff/${owner.id}`)
      .set(as(ownerToken))
      .send({ role: 'admin' })
      .expect(403);
  });

  it('keeps tablet PINs unique per venue', async () => {
    const first = await onboard(ownerToken, 'kitchen', 'pin-a');
    const second = await onboard(ownerToken, 'kitchen', 'pin-b');
    await http()
      .post(`/api/admin/staff/${first.id}/tablet-pin`)
      .set(as(ownerToken))
      .send({ pin: '7319' })
      .expect(201);
    await http()
      .post(`/api/admin/staff/${second.id}/tablet-pin`)
      .set(as(ownerToken))
      .send({ pin: '7319' })
      .expect(409);
    await http()
      .post(`/api/admin/staff/${second.id}/tablet-pin`)
      .set(as(ownerToken))
      .send({ pin: '7320' })
      .expect(201);
  });

  it('grants only venues the actor holds, in the actor’s organization', async () => {
    const target = await onboard(ownerToken, 'viewer', 'venues');
    const ungranted = await prisma.venue.create({
      data: {
        organizationId,
        name: `${TAG} ungranted`,
        slug: `${TAG}-ungranted`,
        address: {},
        operatingHours: {},
        seatingCapacity: 10,
      },
    });
    createdVenues.push(ungranted.id);
    await http()
      .put(`/api/admin/staff/${target.id}/venues/${ungranted.id}`)
      .set(as(ownerToken))
      .expect(403);

    const otherOrg = await prisma.organization.create({
      data: { name: `${TAG} other`, slug: `${TAG}-other`, billingEmail: `${TAG}@example.test` },
    });
    otherOrgId = otherOrg.id;
    const otherVenue = await prisma.venue.create({
      data: {
        organizationId: otherOrg.id,
        name: `${TAG} other`,
        slug: `${TAG}-other`,
        address: {},
        operatingHours: {},
        seatingCapacity: 10,
      },
    });
    createdVenues.push(otherVenue.id);
    await http()
      .put(`/api/admin/staff/${target.id}/venues/${otherVenue.id}`)
      .set(as(ownerToken))
      .expect(403);

    // Revoke and re-grant a held venue: audited, reflected in the account.
    const revoked = await http()
      .delete(`/api/admin/staff/${target.id}/venues/${venueId}`)
      .set(as(ownerToken))
      .expect(200);
    expect(revoked.body.venueIds).toEqual([]);
    const granted = await http()
      .put(`/api/admin/staff/${target.id}/venues/${venueId}`)
      .set(as(ownerToken))
      .expect(200);
    expect(granted.body.venueIds).toEqual([venueId]);

    // Staff of another organization are invisible: 404, not 403.
    const foreign = await prisma.staff.create({
      data: {
        organizationId: otherOrg.id,
        email: `${TAG}-foreign@example.test`,
        name: 'Foreign',
        passwordHash: 'x',
        role: 'cashier',
      },
    });
    await http().post(`/api/admin/staff/${foreign.id}/deactivate`).set(as(ownerToken)).expect(404);
  });

  it('a role change ends the staff member’s sessions', async () => {
    const staff = await onboard(ownerToken, 'manager', 'role');
    await http().get('/api/admin/staff').set(as(staff.token)).expect(200);
    await http()
      .patch(`/api/admin/staff/${staff.id}`)
      .set(as(ownerToken))
      .send({ role: 'cashier' })
      .expect(200);
    await http().get('/api/admin/staff').set(as(staff.token)).expect(401);
    expect(
      await prisma.staffSession.count({
        where: { staffId: staff.id, revokedReason: 'role_changed' },
      }),
    ).toBe(1);
  });

  it('deactivation ends sessions and sign-in; reactivation restores sign-in', async () => {
    const staff = await onboard(ownerToken, 'manager', 'deactivate');
    await http().post(`/api/admin/staff/${staff.id}/deactivate`).set(as(ownerToken)).expect(200);
    await http().get('/api/admin/staff').set(as(staff.token)).expect(401);
    await login(staff.email, PASSWORD, 401);
    await http().post(`/api/admin/staff/${staff.id}/activate`).set(as(ownerToken)).expect(200);
    await login(staff.email, PASSWORD);
  });

  it('a credential reset ends the old password and sessions; the new code works once', async () => {
    const staff = await onboard(ownerToken, 'manager', 'reset');
    const res = await http()
      .post(`/api/admin/staff/${staff.id}/credential-reset`)
      .set(as(ownerToken))
      .expect(200);
    await http().get('/api/admin/staff').set(as(staff.token)).expect(401);
    await login(staff.email, PASSWORD, 401);
    await http()
      .post('/api/auth/credential-setup')
      .send({ code: res.body.code, password: `${PASSWORD} new` })
      .expect(204);
    await login(staff.email, `${PASSWORD} new`);
  });

  it('removal ends sessions, sign-in and venue grants, and hides the account', async () => {
    const staff = await onboard(ownerToken, 'cashier', 'remove');
    await http().delete(`/api/admin/staff/${staff.id}`).set(as(ownerToken)).expect(204);
    await http().get('/api/admin/staff').set(as(staff.token)).expect(401);
    await login(staff.email, PASSWORD, 401);
    const list = await http().get('/api/admin/staff').set(as(ownerToken)).expect(200);
    expect((list.body as { id: string }[]).some((s) => s.id === staff.id)).toBe(false);
    expect(await prisma.venueAccess.count({ where: { staffId: staff.id } })).toBe(0);
    await http().post(`/api/admin/staff/${staff.id}/activate`).set(as(ownerToken)).expect(404);
  });

  it('keeps an active owner when two owners deactivate each other at the same moment', async () => {
    const org = await prisma.organization.create({
      data: { name: `${TAG} race`, slug: `${TAG}-race`, billingEmail: `${TAG}-race@example.test` },
    });
    raceOrgId = org.id;
    const passwordHash = await argon2.hash(PASSWORD, { type: argon2.argon2id });
    // Several rounds: without serialization, each request sees the other owner
    // still active and both deactivations commit.
    for (let round = 0; round < 5; round++) {
      const owners = await Promise.all(
        ['a', 'b'].map((side) =>
          prisma.staff.create({
            data: {
              organizationId: org.id,
              email: `${TAG}-race-${round}-${side}@example.test`,
              name: `Race ${round} ${side}`,
              role: 'owner',
              passwordHash,
            },
          }),
        ),
      );
      const [a, b] = owners;
      const tokenA = await login(a.email, PASSWORD);
      const tokenB = await login(b.email, PASSWORD);
      const results = await Promise.all([
        http().post(`/api/admin/staff/${b.id}/deactivate`).set(as(tokenA)),
        http().post(`/api/admin/staff/${a.id}/deactivate`).set(as(tokenB)),
      ]);
      // The changes are serialized on the two owners' rows (Story 8.3): the
      // second sees the first. Its owner was just deactivated, so it is
      // refused as an actor (403); it can never also succeed.
      expect(results.map((r) => r.status).sort()).toEqual([200, 403]);
      expect(
        await prisma.staff.count({
          where: { id: { in: [a.id, b.id] }, role: 'owner', isActive: true },
        }),
      ).toBe(1);
      // Retire this round's survivor so the next round again starts with two.
      await prisma.staff.updateMany({
        where: { organizationId: org.id },
        data: { isActive: false, deletedAt: new Date() },
      });
    }
  });

  it('a failed credential reset changes nothing: password, sessions and codes stay as they were', async () => {
    const staff = await onboard(ownerToken, 'manager', 'reset-atomic');
    const before = await prisma.staff.findUniqueOrThrow({ where: { id: staff.id } });
    const tokensBefore = await prisma.staffCredentialToken.count({ where: { staffId: staff.id } });
    const audit = app.get(AuditLogService);
    const spy = jest
      .spyOn(audit, 'logAuthEvent')
      .mockRejectedValueOnce(new Error('simulated audit outage'));
    try {
      await http()
        .post(`/api/admin/staff/${staff.id}/credential-reset`)
        .set(as(ownerToken))
        .expect(500);
    } finally {
      spy.mockRestore();
    }
    const after = await prisma.staff.findUniqueOrThrow({ where: { id: staff.id } });
    expect(after.passwordHash).toBe(before.passwordHash);
    expect(await prisma.staffCredentialToken.count({ where: { staffId: staff.id } })).toBe(
      tokensBefore,
    );
    expect(
      await prisma.staffSession.count({ where: { staffId: staff.id, revokedAt: { not: null } } }),
    ).toBe(0);
    await http().get('/api/admin/staff').set(as(staff.token)).expect(200);
  });

  it('a failed credential setup leaves the code unused and the password unset', async () => {
    const email = `${TAG}-setup-atomic@example.test`;
    const created = await createStaff(ownerToken, {
      name: 'Setup Atomic',
      email,
      role: 'viewer',
      venueIds: [],
    });
    const audit = app.get(AuditLogService);
    const spy = jest
      .spyOn(audit, 'logAuthEvent')
      .mockRejectedValueOnce(new Error('simulated audit outage'));
    try {
      await resetRateLimits();
      await http()
        .post('/api/auth/credential-setup')
        .send({ code: created.credentialSetup.code, password: PASSWORD })
        .expect(500);
    } finally {
      spy.mockRestore();
    }
    await login(email, PASSWORD, 401);
    // The code was not consumed, so it still works once.
    await resetRateLimits();
    await http()
      .post('/api/auth/credential-setup')
      .send({ code: created.credentialSetup.code, password: PASSWORD })
      .expect(204);
    await login(email, PASSWORD);
  });

  it('audits every change, never with a code or password', async () => {
    const rows = await prisma.auditLog.findMany({
      where: { organizationId, resource: 'staff', resourceId: { in: createdStaff } },
    });
    const actions = new Set(rows.map((r) => r.action));
    for (const action of [
      'STAFF_CREATED',
      'STAFF_CREDENTIAL_SETUP_ISSUED',
      'STAFF_CREDENTIAL_SET',
      'STAFF_UPDATED',
      'STAFF_DEACTIVATED',
      'STAFF_ACTIVATED',
      'STAFF_CREDENTIAL_RESET',
      'STAFF_REMOVED',
      'STAFF_VENUE_GRANTED',
      'STAFF_VENUE_REVOKED',
      'TABLET_STAFF_PIN_SET',
    ]) {
      expect(actions).toContain(action);
    }
    // Only what an audit row records about the change; generated ids are
    // random and could contain the PIN's digits by chance.
    const serialized = JSON.stringify(
      rows.map((r) => [r.action, r.before, r.after, r.actorEmail, r.ipAddress, r.userAgent]),
    );
    expect(serialized).not.toContain(PASSWORD);
    expect(serialized).not.toMatch(/"code"|\$argon2|7319/);
  });
});
