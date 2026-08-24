// Integration test against a REAL local Postgres (see
// local-postgres/README.md) — no mocking of Prisma. Exercises Story 2-9's
// connector identity tracer end to end through the real HTTP surface
// (JwtAuthGuard/RolesGuard/RateLimitGuard/ConnectorAuthGuard all engaged,
// not bypassed): admin-initiated enrolment, single-use bootstrap-token
// exchange, durable credential authentication, heartbeat self-report,
// revocation, rotation, cross-tenant isolation, real concurrent
// enrolment/replacement, and audit-trail secrecy.
//
// This file never contacts Idealpos, EFTPOS, a printer, or a Windows
// host, and no assertion here should be read as evidence that such
// contact occurred — see connector.service.ts's class doc comment.
//
// Run with: npm run test:integration --workspace=backend
// Requires: npm run db:local:start && npm run db:migrate && npm run db:seed
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import * as argon2 from 'argon2';
import Redis from 'ioredis';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { REDIS_CLIENT } from '../src/redis/redis.constants';

describe('Connector Identity (integration, real local Postgres)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const TAG = 'story2-9-integration';
  const collectedSecrets: string[] = [];

  let orgId: string;
  let venueId: string;
  let accessToken: string;

  let otherOrgId: string;
  let otherVenueId: string;
  let otherAccessToken: string;

  let concurrencyVenueId: string;

  function splitCredential(token: string): [string, string] {
    const idx = token.indexOf('.');
    return [token.slice(0, idx), token.slice(idx + 1)];
  }

  async function createOrgVenueOwner(label: string) {
    const org = await prisma.organization.create({
      data: {
        name: `${TAG} ${label} org`,
        slug: `${TAG}-${label}-org-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        billingEmail: `${TAG}-${label}@verdura.internal`,
      },
    });
    const venue = await prisma.venue.create({
      data: {
        organizationId: org.id,
        name: `${TAG} ${label} venue`,
        slug: `${TAG}-${label}-venue-${Date.now()}`,
        address: {},
        operatingHours: {},
        seatingCapacity: 10,
      },
    });
    const password = `${TAG}-${label}-password-1234`;
    const owner = await prisma.staff.create({
      data: {
        organizationId: org.id,
        email: `${TAG}-${label}-owner-${Date.now()}@verdura.internal`,
        name: `${label} Owner`,
        passwordHash: await argon2.hash(password, { type: argon2.argon2id }),
        role: 'owner',
      },
    });
    const loginRes = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: owner.email, password })
      .expect(200);
    return {
      orgId: org.id,
      venueId: venue.id,
      accessToken: loginRes.body.accessToken as string,
    };
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

    // This suite's fixed-path connector endpoints (unlike the per-venue
    // admin routes) share ONE rate-limit key across every run within the
    // same 900s window (see rate-limit.guard.ts's ip+path keying) — clear
    // them first so re-running this file during development doesn't fail
    // on a stale 429 from a previous run rather than genuine test logic.
    // Scoped to /api/connector/* only; no other suite's keys are touched.
    const redis = app.get<Redis>(REDIS_CLIENT);
    const staleKeys = await redis.keys('rate-limit:*:*:/api/connector/*');
    if (staleKeys.length > 0) {
      await redis.del(...staleKeys);
    }

    const primary = await createOrgVenueOwner('primary');
    orgId = primary.orgId;
    venueId = primary.venueId;
    accessToken = primary.accessToken;

    const other = await createOrgVenueOwner('other');
    otherOrgId = other.orgId;
    otherVenueId = other.venueId;
    otherAccessToken = other.accessToken;

    const concurrencyVenue = await prisma.venue.create({
      data: {
        organizationId: orgId,
        name: `${TAG} concurrency venue`,
        slug: `${TAG}-concurrency-venue-${Date.now()}`,
        address: {},
        operatingHours: {},
        seatingCapacity: 10,
      },
    });
    concurrencyVenueId = concurrencyVenue.id;
  });

  afterAll(async () => {
    // Dependency order matches the DB's own FK RESTRICT constraints:
    // ConnectorInstallation/ConnectorEnrollment/AuditLog before Staff,
    // Staff before Venue, Venue before Organization.
    for (const org of [orgId, otherOrgId]) {
      await prisma.connectorInstallation.deleteMany({ where: { organizationId: org } });
      await prisma.connectorEnrollment.deleteMany({ where: { organizationId: org } });
      await prisma.auditLog.deleteMany({ where: { organizationId: org } });
      await prisma.staff.deleteMany({ where: { organizationId: org } });
      await prisma.venue.deleteMany({ where: { organizationId: org } });
      await prisma.organization.delete({ where: { id: org } });
    }
    await app.close();
    await prisma.$disconnect();
  });

  let bootstrapToken1: string;
  let enrollmentId1: string;
  let installationId1: string;
  let credential1: string;

  it('AC1: an authorised admin can create a connector enrollment for the venue', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/venues/${venueId}/connector/enrollments`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(201);

    expect(res.body.enrollmentId).toEqual(expect.any(String));
    expect(res.body.bootstrapToken).toEqual(expect.any(String));
    enrollmentId1 = res.body.enrollmentId as string;
    bootstrapToken1 = res.body.bootstrapToken as string;
    collectedSecrets.push(bootstrapToken1, bootstrapToken1.split('.')[1]);

    const row = await prisma.connectorEnrollment.findUniqueOrThrow({
      where: { id: enrollmentId1 },
    });
    expect(row.venueId).toBe(venueId);
    expect(row.usedAt).toBeNull();
    expect(row.codeHash).not.toBe(bootstrapToken1.split('.')[1]);
  });

  it('enrollment creation is rejected for a venue outside the caller organization (tenant isolation)', async () => {
    await request(app.getHttpServer())
      .post(`/api/venues/${otherVenueId}/connector/enrollments`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(404);
  });

  it('AC2/AC3: the connector exchanges the bootstrap token for durable credentials; the secret is never stored in plaintext', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/connector/enroll')
      .set('Authorization', `Bearer ${bootstrapToken1}`)
      .expect(200);

    expect(res.body.installationId).toEqual(expect.any(String));
    expect(res.body.credential).toEqual(expect.any(String));
    installationId1 = res.body.installationId as string;
    credential1 = res.body.credential as string;
    collectedSecrets.push(credential1, splitCredential(credential1)[1]);

    const row = await prisma.connectorInstallation.findUniqueOrThrow({
      where: { id: installationId1 },
    });
    expect(row.status).toBe('active');
    expect(row.organizationId).toBe(orgId);
    expect(row.venueId).toBe(venueId);
    const [, plaintextSecret] = splitCredential(credential1);
    expect(row.secretHash).not.toBe(plaintextSecret);
    expect(await argon2.verify(row.secretHash, plaintextSecret)).toBe(true);
  });

  it('AC7: reusing an already-redeemed bootstrap token is rejected', async () => {
    await request(app.getHttpServer())
      .post('/api/connector/enroll')
      .set('Authorization', `Bearer ${bootstrapToken1}`)
      .expect(401);
  });

  it('an expired bootstrap token is rejected even though it was never used', async () => {
    const createRes = await request(app.getHttpServer())
      .post(`/api/venues/${venueId}/connector/enrollments`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(201);
    const enrollmentId = createRes.body.enrollmentId as string;
    const bootstrapToken = createRes.body.bootstrapToken as string;
    collectedSecrets.push(bootstrapToken, bootstrapToken.split('.')[1]);

    await prisma.connectorEnrollment.update({
      where: { id: enrollmentId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    await request(app.getHttpServer())
      .post('/api/connector/enroll')
      .set('Authorization', `Bearer ${bootstrapToken}`)
      .expect(401);
  });

  it('AC4/AC5: the connector authenticates, the backend resolves it to the correct org/venue, and heartbeat updates self-reported health', async () => {
    await request(app.getHttpServer())
      .post('/api/connector/heartbeat')
      .set('Authorization', `Bearer ${credential1}`)
      .send({ version: '1.2.3', capabilities: { printers: 1, kds: true } })
      .expect(200);

    const statusRes = await request(app.getHttpServer())
      .get(`/api/venues/${venueId}/connector/installations`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    const installation = (statusRes.body as Array<Record<string, unknown>>).find(
      (i) => i.installationId === installationId1,
    );
    expect(installation).toBeDefined();
    expect(installation?.reportedVersion).toBe('1.2.3');
    expect(installation?.reportedCapabilities).toEqual({ printers: 1, kds: true });
    expect(installation?.lastSeenAt).toEqual(expect.any(String));
    expect(installation).not.toHaveProperty('secretHash');
    expect(JSON.stringify(statusRes.body)).not.toContain('secretHash');
  });

  it('heartbeat rejects a missing, malformed, or wrong-secret connector credential', async () => {
    // A request with no Authorization header at all never reaches
    // ConnectorAuthGuard — the app-wide CsrfMiddleware (which every
    // non-GET route passes through, see csrf.middleware.ts) rejects it
    // first with 403, since it has neither a Bearer header nor a CSRF
    // cookie/token. This is still a hard rejection, just via an earlier,
    // more generic layer than the connector-specific 401 the other two
    // sub-cases below exercise.
    await request(app.getHttpServer()).post('/api/connector/heartbeat').send({}).expect(403);

    await request(app.getHttpServer())
      .post('/api/connector/heartbeat')
      .set('Authorization', 'Bearer not-a-valid-credential')
      .send({})
      .expect(401);

    await request(app.getHttpServer())
      .post('/api/connector/heartbeat')
      .set('Authorization', `Bearer ${installationId1}.wrong-secret`)
      .send({})
      .expect(401);
  });

  it('AC6: an authorised admin can revoke the active installation, and the revoked connector is rejected immediately', async () => {
    await request(app.getHttpServer())
      .post(`/api/venues/${venueId}/connector/installations/${installationId1}/revoke`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(201);

    await request(app.getHttpServer())
      .post('/api/connector/heartbeat')
      .set('Authorization', `Bearer ${credential1}`)
      .send({})
      .expect(401);

    const row = await prisma.connectorInstallation.findUniqueOrThrow({
      where: { id: installationId1 },
    });
    expect(row.status).toBe('revoked');
    expect(row.revokedAt).not.toBeNull();
  });

  let installationId3: string;

  it('AC8: revocation is rejected for an installation outside the caller organization (tenant isolation)', async () => {
    const createRes = await request(app.getHttpServer())
      .post(`/api/venues/${venueId}/connector/enrollments`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(201);
    const bootstrapToken = createRes.body.bootstrapToken as string;
    collectedSecrets.push(bootstrapToken, bootstrapToken.split('.')[1]);

    const enrollRes = await request(app.getHttpServer())
      .post('/api/connector/enroll')
      .set('Authorization', `Bearer ${bootstrapToken}`)
      .expect(200);
    installationId3 = enrollRes.body.installationId as string;
    const credential = enrollRes.body.credential as string;
    collectedSecrets.push(credential, splitCredential(credential)[1]);

    await request(app.getHttpServer())
      .post(`/api/venues/${venueId}/connector/installations/${installationId3}/revoke`)
      .set('Authorization', `Bearer ${otherAccessToken}`)
      .expect(404);

    const row = await prisma.connectorInstallation.findUniqueOrThrow({
      where: { id: installationId3 },
    });
    expect(row.status).toBe('active');
  });

  it('AC9: rotation replaces the prior active installation and records replacement lineage, keeping exactly one active connector per venue', async () => {
    const createRes = await request(app.getHttpServer())
      .post(`/api/venues/${venueId}/connector/enrollments`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(201);
    const bootstrapToken = createRes.body.bootstrapToken as string;
    collectedSecrets.push(bootstrapToken, bootstrapToken.split('.')[1]);

    const enrollRes = await request(app.getHttpServer())
      .post('/api/connector/enroll')
      .set('Authorization', `Bearer ${bootstrapToken}`)
      .expect(200);
    const installationId4 = enrollRes.body.installationId as string;
    const credential = enrollRes.body.credential as string;
    collectedSecrets.push(credential, splitCredential(credential)[1]);

    const oldRow = await prisma.connectorInstallation.findUniqueOrThrow({
      where: { id: installationId3 },
    });
    expect(oldRow.status).toBe('replaced');
    expect(oldRow.replacedByInstallationId).toBe(installationId4);

    const activeRows = await prisma.connectorInstallation.findMany({
      where: { venueId, status: 'active' },
    });
    expect(activeRows).toHaveLength(1);
    expect(activeRows[0].id).toBe(installationId4);
  });

  it('AC9 (concurrency, real Postgres): two simultaneous enrolment redemptions for the same venue never leave more than one active installation', async () => {
    const createA = await request(app.getHttpServer())
      .post(`/api/venues/${concurrencyVenueId}/connector/enrollments`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(201);
    const createB = await request(app.getHttpServer())
      .post(`/api/venues/${concurrencyVenueId}/connector/enrollments`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(201);
    const tokenA = createA.body.bootstrapToken as string;
    const tokenB = createB.body.bootstrapToken as string;
    collectedSecrets.push(tokenA, tokenA.split('.')[1], tokenB, tokenB.split('.')[1]);

    const [resultA, resultB] = await Promise.all([
      request(app.getHttpServer())
        .post('/api/connector/enroll')
        .set('Authorization', `Bearer ${tokenA}`),
      request(app.getHttpServer())
        .post('/api/connector/enroll')
        .set('Authorization', `Bearer ${tokenB}`),
    ]);

    // Two legitimate outcomes exist for two concurrent redemptions racing
    // against an initially connector-less venue, and which one occurs
    // depends on Node/Postgres scheduling, not on a bug:
    //  (a) true overlap — both transactions' "is there a prior active row"
    //      check runs before either commits, so both attempt to insert a
    //      new active row; the second insert hits the partial unique
    //      index's real Postgres unique-violation, translated to 409.
    //  (b) near-serial execution — the second transaction's check
    //      observes the first's already-committed row and takes the
    //      graceful rotation path instead (replace-then-insert, see the
    //      'rotation' test above), so both return 200.
    // What must ALWAYS hold, regardless of interleaving, is proven below:
    // exactly one row ends up active. The instantaneous-overlap-forces-a-
    // real-409 case is proven deterministically (not left to scheduling
    // luck) by the next test, which manually controls transaction commit
    // timing.
    for (const res of [resultA, resultB]) {
      expect([200, 409]).toContain(res.status);
      if (res.status === 200) {
        const credential = res.body.credential as string;
        collectedSecrets.push(credential, splitCredential(credential)[1]);
      }
    }
    expect([resultA.status, resultB.status].filter((s) => s === 200).length).toBeGreaterThanOrEqual(
      1,
    );

    const activeRows = await prisma.connectorInstallation.findMany({
      where: { venueId: concurrencyVenueId, status: 'active' },
    });
    expect(activeRows).toHaveLength(1);
  });

  it('AC9 (concurrency, real Postgres, deterministic): a second active-row insert genuinely blocks on and then loses to an uncommitted first insert', async () => {
    // Bypasses the service/HTTP layer to control transaction commit
    // timing directly, proving the partial unique index itself — not
    // application-level luck — is what enforces "at most one active
    // installation per venue" under true concurrent overlap.
    const deterministicVenue = await prisma.venue.create({
      data: {
        organizationId: orgId,
        name: `${TAG} deterministic concurrency venue`,
        slug: `${TAG}-deterministic-concurrency-venue-${Date.now()}`,
        address: {},
        operatingHours: {},
        seatingCapacity: 10,
      },
    });

    async function makeRedeemedEnrollment(): Promise<string> {
      const codeHash = await argon2.hash('unused-in-this-test', { type: argon2.argon2id });
      const enrollment = await prisma.connectorEnrollment.create({
        data: {
          organizationId: orgId,
          venueId: deterministicVenue.id,
          codeHash,
          createdByStaffId: (
            await prisma.staff.findFirstOrThrow({ where: { organizationId: orgId } })
          ).id,
          expiresAt: new Date(Date.now() + 60_000),
          usedAt: new Date(),
        },
      });
      return enrollment.id;
    }

    const enrollmentIdA = await makeRedeemedEnrollment();
    const enrollmentIdB = await makeRedeemedEnrollment();
    const secretHash = await argon2.hash('unused-secret', { type: argon2.argon2id });

    let releaseTxA: () => void = () => undefined;
    const txAHeld = new Promise<void>((resolve) => {
      releaseTxA = resolve;
    });
    let txAInsertDone: () => void = () => undefined;
    const txAInsertSettled = new Promise<void>((resolve) => {
      txAInsertDone = resolve;
    });

    const txAPromise = prisma.$transaction(async (tx) => {
      await tx.connectorInstallation.create({
        data: {
          organizationId: orgId,
          venueId: deterministicVenue.id,
          enrollmentId: enrollmentIdA,
          secretHash,
          status: 'active',
        },
      });
      txAInsertDone();
      await txAHeld; // hold TxA open — its row stays uncommitted until released below
    });

    await txAInsertSettled;

    const txBPromise = prisma.$transaction(async (tx) => {
      await tx.connectorInstallation.create({
        data: {
          organizationId: orgId,
          venueId: deterministicVenue.id,
          enrollmentId: enrollmentIdB,
          secretHash,
          status: 'active',
        },
      });
    });

    // Give TxB's insert time to actually reach Postgres and, if the
    // partial unique index is doing its job, block there waiting on TxA's
    // uncommitted row.
    await new Promise((resolve) => setTimeout(resolve, 200));

    // Verify TxB is still genuinely pending — not just assumed to be —
    // before releasing TxA: race it against an immediately-scheduled
    // macrotask. If TxB had already settled (i.e. it was NOT blocked),
    // its .then()/.catch() would already be queued as a microtask and
    // would win this race; only a still-pending promise loses to a bare
    // setTimeout(0).
    const raceResult = await Promise.race([
      txBPromise.then(
        () => 'txB-settled-unexpectedly-early',
        () => 'txB-settled-unexpectedly-early',
      ),
      new Promise((resolve) => setTimeout(() => resolve('txB-still-pending'), 0)),
    ]);
    expect(raceResult).toBe('txB-still-pending');

    releaseTxA();
    await txAPromise;

    await expect(txBPromise).rejects.toMatchObject({ code: 'P2002' });

    const activeRows = await prisma.connectorInstallation.findMany({
      where: { venueId: deterministicVenue.id, status: 'active' },
    });
    expect(activeRows).toHaveLength(1);

    await prisma.connectorInstallation.deleteMany({ where: { venueId: deterministicVenue.id } });
    await prisma.connectorEnrollment.deleteMany({ where: { venueId: deterministicVenue.id } });
    await prisma.venue.delete({ where: { id: deterministicVenue.id } });
  });

  it('AC10: security-relevant connector lifecycle events are auditable, and audit payloads never contain any collected plaintext secret', async () => {
    const rows = await prisma.auditLog.findMany({
      where: {
        organizationId: orgId,
        action: { in: ['CONNECTOR_ENROLLMENT_CREATED', 'CONNECTOR_ENROLLED', 'CONNECTOR_REVOKED'] },
      },
    });

    expect(rows.some((r) => r.action === 'CONNECTOR_ENROLLMENT_CREATED')).toBe(true);
    expect(rows.some((r) => r.action === 'CONNECTOR_ENROLLED')).toBe(true);
    expect(rows.some((r) => r.action === 'CONNECTOR_REVOKED')).toBe(true);

    const serialized = JSON.stringify(rows);
    expect(serialized).not.toContain('secretHash');
    expect(serialized).not.toContain('codeHash');
    for (const secret of collectedSecrets) {
      expect(serialized).not.toContain(secret);
    }
  });
});
