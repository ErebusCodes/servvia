// Integration test against a REAL local Postgres and Redis — no mocking.
// Story 2.4 (NFR-SEC-1, NFR-SEC-2, NFR-AUD): the Admin Console is entered only
// by named staff sign-in. The shared admin PIN endpoint is gone, sign-in is
// throttled per account without revealing which accounts exist, and the
// governed bootstrap issues an owner a setup code with a system audit actor.
//
// Run with: npm run test:integration --workspace=apps/api
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import Redis from 'ioredis';
import * as argon2 from 'argon2';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { AuditLogService } from '../src/audit/audit.service';
import { CredentialSetupService } from '../src/staff/credential-setup.service';
import {
  CREDENTIAL_BOOTSTRAP_ACTOR,
  CredentialBootstrapRefused,
  issueBootstrapCredentialSetup,
} from '../src/staff/credential-bootstrap';
import { LOGIN_ACCOUNT_ATTEMPT_LIMIT } from '../src/auth/login-throttle.service';

const TAG = `story24-${Date.now()}`;
const PASSWORD = 'a long staff password 24';

describe('Named staff sign-in (integration, real Postgres and Redis)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let redis: Redis;
  let organizationId: string;
  let venueId: string;
  const createdStaff: string[] = [];

  const http = () => request(app.getHttpServer());

  // Whether a response started a session (the CSRF cookie is set on every response).
  const setsSessionCookie = (res: request.Response) =>
    ([] as string[])
      .concat(res.headers['set-cookie'] ?? [])
      .some((cookie) => cookie.startsWith('refresh_token='));

  // Clears the per-address buckets only, so the per-account throttle is what
  // these tests observe (one test client is one address).
  async function resetAddressLimits() {
    const keys = await redis.keys('rate-limit:*');
    if (keys.length > 0) await redis.del(...keys);
  }

  async function login(email: string, password: string) {
    await resetAddressLimits();
    return http().post('/api/auth/login').send({ email, password });
  }

  async function staffMember(
    label: string,
    data: { role?: 'owner' | 'admin' | 'cashier'; isActive?: boolean; email?: string } = {},
  ) {
    const staff = await prisma.staff.create({
      data: {
        organizationId,
        email: data.email ?? `${TAG}-${label}@example.test`,
        name: label,
        role: data.role ?? 'owner',
        isActive: data.isActive ?? true,
        passwordHash: await argon2.hash(PASSWORD, { type: argon2.argon2id }),
      },
    });
    await prisma.venueAccess.create({
      data: { staffId: staff.id, venueId, grantedById: staff.id },
    });
    createdStaff.push(staff.id);
    return staff;
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
    redis = new Redis({
      host: process.env.REDIS_HOST ?? '127.0.0.1',
      port: Number(process.env.REDIS_PORT ?? 6379),
    });
    const venue = await prisma.venue.findFirstOrThrow({ where: { slug: 'auckland' } });
    organizationId = venue.organizationId;
    venueId = venue.id;
  });

  afterAll(async () => {
    const ids = createdStaff;
    await prisma.auditLog.deleteMany({
      where: { OR: [{ actorId: { in: ids } }, { resourceId: { in: ids } }] },
    });
    await prisma.staffCredentialToken.deleteMany({ where: { staffId: { in: ids } } });
    await prisma.staffSession.deleteMany({ where: { staffId: { in: ids } } });
    await prisma.venueAccess.deleteMany({ where: { staffId: { in: ids } } });
    await prisma.staff.deleteMany({ where: { id: { in: ids } } });
    const keys = await redis.keys('login-account:*');
    if (keys.length > 0) await redis.del(...keys);
    redis.disconnect();
    await app.close();
  });

  it('has no shared admin PIN endpoint', async () => {
    await resetAddressLimits();
    for (const pin of ['108', '1080', '482913']) {
      await http().post('/api/auth/admin-pin').send({ pin }).expect(404);
    }
  });

  it('signs a named owner in, audits it, and the session reaches the Admin Console API', async () => {
    const owner = await staffMember('owner');
    const res = await login(owner.email.toUpperCase(), PASSWORD);
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ id: owner.id, email: owner.email, role: 'owner' });
    expect(setsSessionCookie(res)).toBe(true);
    const payload = JSON.parse(
      Buffer.from((res.body.accessToken as string).split('.')[1], 'base64url').toString('utf8'),
    ) as { sub: string; sid?: string; kind?: string };
    expect(payload.sub).toBe(owner.id);
    expect(payload.sid).toEqual(expect.any(String));
    expect(payload.kind).toBeUndefined();

    await http()
      .get('/api/admin/staff')
      .set({ Authorization: `Bearer ${res.body.accessToken}` })
      .expect(200);
    expect(
      await prisma.auditLog.count({
        where: { actorId: owner.id, action: 'login', resource: 'auth' },
      }),
    ).toBe(1);
  });

  it('answers an unknown email, a wrong password and a deactivated account identically', async () => {
    const active = await staffMember('identical-active', { role: 'cashier' });
    const inactive = await staffMember('identical-inactive', { role: 'cashier', isActive: false });
    const responses = [
      await login(`${TAG}-nobody@example.test`, PASSWORD),
      await login(active.email, `${PASSWORD} wrong`),
      await login(inactive.email, PASSWORD),
    ];
    for (const res of responses) {
      expect(res.status).toBe(401);
      expect(res.body).toEqual(responses[0].body);
      expect(setsSessionCookie(res)).toBe(false);
    }
  });

  it('still writes the audit row of a refused known account, off the response path', async () => {
    const staff = await staffMember('audited-refusal');
    expect((await login(staff.email, 'not the password at all')).status).toBe(401);
    // The response does not wait for it (enumeration resistance); the row
    // follows within moments.
    let row = null;
    for (let i = 0; i < 50 && !row; i += 1) {
      row = await prisma.auditLog.findFirst({
        where: { actorId: staff.id, action: 'login_failed' },
      });
      if (!row) await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(row).toMatchObject({ actorType: 'staff', actorId: staff.id, resource: 'auth' });
  });

  it('throttles each account, known or not, without affecting other accounts', async () => {
    const target = await staffMember('throttled', { role: 'cashier' });
    const bystander = await staffMember('bystander', { role: 'cashier' });
    const unknown = `${TAG}-unknown@example.test`;

    for (let i = 0; i < LOGIN_ACCOUNT_ATTEMPT_LIMIT; i++) {
      expect((await login(target.email, `wrong ${i}`)).status).toBe(401);
      expect((await login(unknown, `wrong ${i}`)).status).toBe(401);
    }
    // Over the limit: refused, even with the right password, and an unknown
    // address gets exactly the same refusal.
    const known = await login(target.email, PASSWORD);
    const notKnown = await login(unknown, PASSWORD);
    expect(known.status).toBe(429);
    expect(notKnown.status).toBe(429);
    expect(known.body).toEqual(notKnown.body);
    expect(setsSessionCookie(known)).toBe(false);

    // Another account is unaffected, and its success clears only its own count.
    expect((await login(bystander.email, PASSWORD)).status).toBe(200);
    expect((await login(target.email, PASSWORD)).status).toBe(429);

    // Nothing in Redis names the account.
    const keys = await redis.keys('login-account:*');
    expect(keys.join(' ')).not.toContain(TAG);
  });

  it('a successful sign-in clears the account’s failures', async () => {
    const staff = await staffMember('clears', { role: 'cashier' });
    for (let i = 0; i < LOGIN_ACCOUNT_ATTEMPT_LIMIT - 1; i++) {
      expect((await login(staff.email, `wrong ${i}`)).status).toBe(401);
    }
    expect((await login(staff.email, PASSWORD)).status).toBe(200);
    for (let i = 0; i < LOGIN_ACCOUNT_ATTEMPT_LIMIT - 1; i++) {
      expect((await login(staff.email, `wrong again ${i}`)).status).toBe(401);
    }
    expect((await login(staff.email, PASSWORD)).status).toBe(200);
  });

  describe('governed bootstrap', () => {
    const bootstrap = (email: string) =>
      issueBootstrapCredentialSetup(
        prisma,
        app.get(CredentialSetupService),
        app.get(AuditLogService),
        email,
      );

    it('issues an owner a single-use code, audited as a system actor; the owner then signs in by name', async () => {
      const owner = await staffMember('bootstrap-owner');
      const issued = await bootstrap(` ${owner.email.toUpperCase()} `);
      expect(issued).toMatchObject({ staffId: owner.id, role: 'owner' });

      // Issuing changes nothing else: the current password still works.
      expect((await login(owner.email, PASSWORD)).status).toBe(200);

      const token = await prisma.staffCredentialToken.findFirstOrThrow({
        where: { staffId: owner.id, usedAt: null, revokedAt: null },
      });
      expect(token.issuedById).toBeNull();
      expect(token.issuedBySystem).toBe(CREDENTIAL_BOOTSTRAP_ACTOR);
      const audit = await prisma.auditLog.findFirstOrThrow({
        where: { resourceId: owner.id, action: 'STAFF_CREDENTIAL_SETUP_ISSUED' },
      });
      expect(audit).toMatchObject({
        actorType: 'system',
        systemActor: CREDENTIAL_BOOTSTRAP_ACTOR,
        actorId: null,
      });
      expect(JSON.stringify(audit)).not.toContain(issued.code.split('.')[1]);

      await resetAddressLimits();
      await http()
        .post('/api/auth/credential-setup')
        .send({ code: issued.code, password: `${PASSWORD} reset` })
        .expect(204);
      expect((await login(owner.email, PASSWORD)).status).toBe(401);
      expect((await login(owner.email, `${PASSWORD} reset`)).status).toBe(200);
    });

    it('refuses anyone who is not an active owner or admin of an active organization', async () => {
      const cashier = await staffMember('bootstrap-cashier', { role: 'cashier' });
      const inactive = await staffMember('bootstrap-inactive', { isActive: false });
      for (const email of [cashier.email, inactive.email, `${TAG}-none@example.test`]) {
        await expect(bootstrap(email)).rejects.toThrow(CredentialBootstrapRefused);
      }
      expect(
        await prisma.staffCredentialToken.count({
          where: { staffId: { in: [cashier.id, inactive.id] } },
        }),
      ).toBe(0);
    });

    it('the database requires exactly one issuer for a setup code', async () => {
      const owner = await staffMember('issuer-check');
      for (const issuer of [
        { issuedById: owner.id, issuedBySystem: CREDENTIAL_BOOTSTRAP_ACTOR },
        { issuedById: null, issuedBySystem: null },
      ]) {
        await expect(
          prisma.staffCredentialToken.create({
            data: {
              staffId: owner.id,
              tokenHash: 'x',
              expiresAt: new Date(Date.now() + 60_000),
              ...issuer,
            },
          }),
        ).rejects.toThrow(/StaffCredentialToken_issuer_check/);
      }
    });
  });
});
