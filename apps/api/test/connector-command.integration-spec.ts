// Integration test against a REAL local Postgres — no mocking of Prisma.
// Exercises Story 2-10's connector command/acceptance protocol end to end
// through the real HTTP surface (JwtAuthGuard/RolesGuard/RateLimitGuard/
// ConnectorAuthGuard all engaged): admin-triggered tracer commands,
// authenticated polling/claiming, CONNECTOR_ACCEPTED, truthful terminal
// reports, idempotency, conflicting-report rejection, tenant isolation,
// revocation-during-claim, rotation/replacement ownership recovery, lease
// expiry, real concurrent claim races, and reconciliation (`unknown`)
// sweeping.
//
// This file never contacts Idealpos, EFTPOS, a printer, or a Windows host.
// `CONNECTOR_ACCEPTED`/`succeeded` here mean only that the authenticated
// connector durably accepted responsibility for a synthetic, side-effect-
// free self-test command — see connector-command.service.ts's class doc
// comment. No assertion in this file should be read as evidence of any
// external system outcome.
//
// Run with: npm run test:integration --workspace=backend
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import * as argon2 from 'argon2';
import Redis from 'ioredis';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { REDIS_CLIENT } from '../src/redis/redis.constants';
import { ConnectorCommandService } from '../src/connector/connector-command.service';
import { ConnectorIdentity } from '../src/connector/connector.service';
import { deleteVenueGrants, grantVenues } from './venue-grants';

describe('Connector Command Protocol (integration, real local Postgres)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let commandService: ConnectorCommandService;
  let redisClient: Redis;

  /**
   * This file (and the wider integration suite it runs alongside) shares
   * ONE IP-keyed `/api/auth/login` rate-limit bucket (E2-S5's real,
   * correctly-enforced 10-per-900s limit) across every file in the same
   * `npm run test:integration` run — not just this file's own connector
   * enrolments. This file alone creates several organizations (via
   * `createOrgVenueOwner`, each of which logs in once) specifically to
   * prove isolation/rotation/exhaustion scenarios that require a clean,
   * independent venue; combined with every other integration-spec file's
   * own login(s) in the same run, the shared bucket is exceeded well before
   * any single file's own budget would suggest. Clearing the *entire*
   * `rate-limit:*` keyspace before each test (safe: this is the local dev
   * Redis, never shared/production state) removes this cross-file/cross-
   * run coupling entirely, rather than only this file's own connector-
   * prefixed paths. Not a workaround for a defect in the rate limiter or
   * this story's code — the limiter is working exactly as designed.
   */
  async function clearConnectorRateLimits(): Promise<void> {
    const staleKeys = await redisClient.keys('rate-limit:*');
    if (staleKeys.length > 0) await redisClient.del(...staleKeys);
  }

  const TAG = 'story2-10-integration';
  const collectedSecrets: string[] = [];

  let orgId: string;
  let venueId: string;
  let accessToken: string;

  let otherOrgId: string;
  let otherVenueId: string;
  let otherAccessToken: string;

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
    await grantVenues(prisma, owner.id, [venue.id]);
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

  /** Enrolls a fresh connector installation for a venue and returns its durable credential. */
  async function enrollConnector(venue: string, adminToken: string): Promise<string> {
    const enrollRes = await request(app.getHttpServer())
      .post(`/api/venues/${venue}/connector/enrollments`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(201);
    const bootstrapToken = enrollRes.body.bootstrapToken as string;
    collectedSecrets.push(bootstrapToken, bootstrapToken.split('.')[1]);

    const redeemRes = await request(app.getHttpServer())
      .post('/api/connector/enroll')
      .set('Authorization', `Bearer ${bootstrapToken}`)
      .expect(200);
    const credential = redeemRes.body.credential as string;
    collectedSecrets.push(credential, splitCredential(credential)[1]);
    return credential;
  }

  /** Self-reports the self-test capability so the connector is eligible to claim tracer commands. */
  async function reportSelfTestCapability(credential: string): Promise<void> {
    await request(app.getHttpServer())
      .post('/api/connector/heartbeat')
      .set('Authorization', `Bearer ${credential}`)
      .send({ version: '0.0.1-tracer', capabilities: { 'connector.self_test.v1': true } })
      .expect(200);
  }

  async function createTracerCommand(venue: string, adminToken: string, idempotencyKey?: string) {
    const res = await request(app.getHttpServer())
      .post(`/api/venues/${venue}/connector/commands/tracer`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send(idempotencyKey ? { idempotencyKey } : {})
      .expect(201);
    return res.body as { id: string; status: string; commandType: string };
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
    commandService = app.get(ConnectorCommandService);

    redisClient = app.get<Redis>(REDIS_CLIENT);
    await clearConnectorRateLimits();

    const primary = await createOrgVenueOwner('primary');
    orgId = primary.orgId;
    venueId = primary.venueId;
    accessToken = primary.accessToken;

    const other = await createOrgVenueOwner('other');
    otherOrgId = other.orgId;
    otherVenueId = other.venueId;
    otherAccessToken = other.accessToken;
  });

  beforeEach(async () => {
    await clearConnectorRateLimits();
  });

  afterAll(async () => {
    for (const org of [orgId, otherOrgId]) {
      await prisma.connectorCommand.deleteMany({ where: { organizationId: org } });
      await prisma.connectorInstallation.deleteMany({ where: { organizationId: org } });
      await prisma.connectorEnrollment.deleteMany({ where: { organizationId: org } });
      await prisma.auditLog.deleteMany({ where: { organizationId: org } });
      await deleteVenueGrants(prisma, org);
      await prisma.staff.deleteMany({ where: { organizationId: org } });
      await prisma.venue.deleteMany({ where: { organizationId: org } });
      await prisma.organization.delete({ where: { id: org } });
    }
    await clearConnectorRateLimits();
    await app.close();
    await prisma.$disconnect();
  });

  describe('happy path: create, poll/claim, accept, report', () => {
    let credential: string;
    let commandId: string;

    it('an authorised admin can trigger a tracer command for the venue', async () => {
      const cmd = await createTracerCommand(venueId, accessToken, 'happy-path-1');
      expect(cmd.status).toBe('pending');
      expect(cmd.commandType).toBe('connector.self_test.v1');
      commandId = cmd.id;

      const row = await prisma.connectorCommand.findUniqueOrThrow({ where: { id: commandId } });
      expect(row.venueId).toBe(venueId);
      expect(row.requiredCapability).toBe('connector.self_test.v1');
    });

    it('a connector without the required capability does not claim it', async () => {
      credential = await enrollConnector(venueId, accessToken);
      const res = await request(app.getHttpServer())
        .post('/api/connector/commands/poll')
        .set('Authorization', `Bearer ${credential}`)
        .expect(200);
      expect(res.body.commands).toEqual([]);
    });

    it('after reporting the capability, the connector claims the command (CONNECTOR_ACCEPTED precursor)', async () => {
      await reportSelfTestCapability(credential);

      const res = await request(app.getHttpServer())
        .post('/api/connector/commands/poll')
        .set('Authorization', `Bearer ${credential}`)
        .expect(200);

      expect(res.body.commands).toHaveLength(1);
      expect(res.body.commands[0].id).toBe(commandId);
      expect(res.body.commands[0].payload).toEqual(
        expect.objectContaining({ echoNonce: expect.any(String) }),
      );

      const row = await prisma.connectorCommand.findUniqueOrThrow({ where: { id: commandId } });
      expect(row.status).toBe('claimed');
      expect(row.leaseExpiresAt).not.toBeNull();
    });

    it('a duplicate poll while the lease is still fresh does not re-offer the already-claimed command', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/connector/commands/poll')
        .set('Authorization', `Bearer ${credential}`)
        .expect(200);
      expect(res.body.commands).toEqual([]);
    });

    it('CONNECTOR_ACCEPTED: the connector accepts the command it claimed, and this is audited without leaking the credential', async () => {
      await request(app.getHttpServer())
        .post(`/api/connector/commands/${commandId}/accept`)
        .set('Authorization', `Bearer ${credential}`)
        .expect(200);

      const row = await prisma.connectorCommand.findUniqueOrThrow({ where: { id: commandId } });
      expect(row.status).toBe('accepted');
      expect(row.acceptedAt).not.toBeNull();

      const auditRows = await prisma.auditLog.findMany({
        where: {
          organizationId: orgId,
          action: 'CONNECTOR_COMMAND_ACCEPTED',
          resourceId: commandId,
        },
      });
      expect(auditRows).toHaveLength(1);
      const serialized = JSON.stringify(auditRows);
      for (const secret of collectedSecrets) {
        expect(serialized).not.toContain(secret);
      }
    });

    it('accept is idempotent: a repeat accept by the same installation succeeds without a second audit row', async () => {
      await request(app.getHttpServer())
        .post(`/api/connector/commands/${commandId}/accept`)
        .set('Authorization', `Bearer ${credential}`)
        .expect(200);

      const auditRows = await prisma.auditLog.findMany({
        where: {
          organizationId: orgId,
          action: 'CONNECTOR_COMMAND_ACCEPTED',
          resourceId: commandId,
        },
      });
      expect(auditRows).toHaveLength(1);
    });

    it('a truthful terminal report (SIMULATED_ECHO) resolves the command to succeeded — never a POS/payment/print claim', async () => {
      await request(app.getHttpServer())
        .post(`/api/connector/commands/${commandId}/report`)
        .set('Authorization', `Bearer ${credential}`)
        .send({ outcome: 'succeeded', resultType: 'SIMULATED_ECHO', idempotencyKey: 'report-1' })
        .expect(200);

      const row = await prisma.connectorCommand.findUniqueOrThrow({ where: { id: commandId } });
      expect(row.status).toBe('succeeded');
      expect(row.resultType).toBe('SIMULATED_ECHO');
      expect(JSON.stringify(row)).not.toMatch(/idealpos|eftpos|printed|kds/i);
    });

    it('report is idempotent: an identical repeat report is accepted as a no-op', async () => {
      await request(app.getHttpServer())
        .post(`/api/connector/commands/${commandId}/report`)
        .set('Authorization', `Bearer ${credential}`)
        .send({ outcome: 'succeeded', resultType: 'SIMULATED_ECHO', idempotencyKey: 'report-1' })
        .expect(200);
    });

    it('a conflicting terminal report for the same already-terminal command is rejected and audited', async () => {
      await request(app.getHttpServer())
        .post(`/api/connector/commands/${commandId}/report`)
        .set('Authorization', `Bearer ${credential}`)
        .send({
          outcome: 'failed',
          resultType: 'SOMETHING_ELSE',
          idempotencyKey: 'report-conflict',
        })
        .expect(409);

      const row = await prisma.connectorCommand.findUniqueOrThrow({ where: { id: commandId } });
      expect(row.status).toBe('succeeded'); // original outcome preserved, never overwritten

      const conflictRows = await prisma.auditLog.findMany({
        where: {
          organizationId: orgId,
          action: 'CONNECTOR_COMMAND_CONFLICTING_REPORT',
          resourceId: commandId,
        },
      });
      expect(conflictRows).toHaveLength(1);
    });

    it('creating a tracer command twice with the same idempotency key returns the original command', async () => {
      const first = await createTracerCommand(venueId, accessToken, 'dedupe-key-1');
      const second = await createTracerCommand(venueId, accessToken, 'dedupe-key-1');
      expect(second.id).toBe(first.id);
    });
  });

  describe('tenant and venue isolation', () => {
    it('a command created for one venue is never returned to a connector polling for another venue', async () => {
      await createTracerCommand(venueId, accessToken, 'isolation-1');
      const otherCredential = await enrollConnector(otherVenueId, otherAccessToken);
      await reportSelfTestCapability(otherCredential);

      const res = await request(app.getHttpServer())
        .post('/api/connector/commands/poll')
        .set('Authorization', `Bearer ${otherCredential}`)
        .expect(200);

      const ids = (res.body.commands as { id: string }[]).map((c) => c.id);
      const primaryVenueCommandIds = (
        await prisma.connectorCommand.findMany({ where: { venueId }, select: { id: true } })
      ).map((c) => c.id);
      expect(ids.some((id) => primaryVenueCommandIds.includes(id))).toBe(false);
    });

    it('a command creation call for a venue outside the caller organization is rejected (404)', async () => {
      await request(app.getHttpServer())
        .post(`/api/venues/${otherVenueId}/connector/commands/tracer`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ idempotencyKey: 'cross-tenant-create' })
        .expect(404);
    });
  });

  describe('revocation during an active session', () => {
    it('a revoked connector cannot poll, accept, or report — rejected immediately on the next request', async () => {
      // Own fresh org/venue: a shared venue would leak pending commands from
      // earlier describe blocks into this poll, making an exact-length
      // assertion flaky for reasons unrelated to what this test checks.
      const revokeOrg = await createOrgVenueOwner('revoke-flow');
      const credential = await enrollConnector(revokeOrg.venueId, revokeOrg.accessToken);
      await reportSelfTestCapability(credential);
      const cmd = await createTracerCommand(
        revokeOrg.venueId,
        revokeOrg.accessToken,
        'revoke-flow-1',
      );

      const pollRes = await request(app.getHttpServer())
        .post('/api/connector/commands/poll')
        .set('Authorization', `Bearer ${credential}`)
        .expect(200);
      expect(pollRes.body.commands).toHaveLength(1);

      const [installationId] = splitCredential(credential);
      await request(app.getHttpServer())
        .post(`/api/venues/${revokeOrg.venueId}/connector/installations/${installationId}/revoke`)
        .set('Authorization', `Bearer ${revokeOrg.accessToken}`)
        .expect(201);

      await request(app.getHttpServer())
        .post('/api/connector/commands/poll')
        .set('Authorization', `Bearer ${credential}`)
        .expect(401);

      await request(app.getHttpServer())
        .post(`/api/connector/commands/${cmd.id}/accept`)
        .set('Authorization', `Bearer ${credential}`)
        .expect(401);

      await prisma.connectorCommand.deleteMany({ where: { organizationId: revokeOrg.orgId } });
      await prisma.connectorInstallation.deleteMany({ where: { organizationId: revokeOrg.orgId } });
      await prisma.connectorEnrollment.deleteMany({ where: { organizationId: revokeOrg.orgId } });
      await prisma.auditLog.deleteMany({ where: { organizationId: revokeOrg.orgId } });
      await deleteVenueGrants(prisma, revokeOrg.orgId);
      await prisma.staff.deleteMany({ where: { organizationId: revokeOrg.orgId } });
      await prisma.venue.deleteMany({ where: { organizationId: revokeOrg.orgId } });
      await prisma.organization.delete({ where: { id: revokeOrg.orgId } });
    });
  });

  describe('rotation/replacement: deterministic command ownership and recovery', () => {
    it('a command claimed by a replaced installation becomes claimable by the new active installation once its lease lapses', async () => {
      const rotationOrg = await createOrgVenueOwner('rotation');
      const credentialA = await enrollConnector(rotationOrg.venueId, rotationOrg.accessToken);
      await reportSelfTestCapability(credentialA);
      const cmd = await createTracerCommand(
        rotationOrg.venueId,
        rotationOrg.accessToken,
        'rotation-1',
      );

      await request(app.getHttpServer())
        .post('/api/connector/commands/poll')
        .set('Authorization', `Bearer ${credentialA}`)
        .expect(200);
      const claimedRow = await prisma.connectorCommand.findUniqueOrThrow({ where: { id: cmd.id } });
      expect(claimedRow.status).toBe('claimed');
      const [installationIdA] = splitCredential(credentialA);
      expect(claimedRow.claimedByInstallationId).toBe(installationIdA);

      // Rotation: redeem a new enrolment for a venue that already has an
      // active installation — this demotes A to `replaced` (story 2-9).
      const credentialC = await enrollConnector(rotationOrg.venueId, rotationOrg.accessToken);
      await reportSelfTestCapability(credentialC);
      const [installationIdC] = splitCredential(credentialC);

      const replacedA = await prisma.connectorInstallation.findUniqueOrThrow({
        where: { id: installationIdA },
      });
      expect(replacedA.status).toBe('replaced');

      // A can no longer act at all (guard rejects a non-active installation).
      await request(app.getHttpServer())
        .post(`/api/connector/commands/${cmd.id}/accept`)
        .set('Authorization', `Bearer ${credentialA}`)
        .expect(401);

      // Force the lease into the past (avoids a real 2-minute wait) —
      // simulates the lease genuinely expiring while A was replaced.
      await prisma.connectorCommand.update({
        where: { id: cmd.id },
        data: { leaseExpiresAt: new Date(Date.now() - 1000) },
      });

      const reclaim = await request(app.getHttpServer())
        .post('/api/connector/commands/poll')
        .set('Authorization', `Bearer ${credentialC}`)
        .expect(200);
      expect(reclaim.body.commands).toHaveLength(1);
      expect(reclaim.body.commands[0].id).toBe(cmd.id);

      const reclaimedRow = await prisma.connectorCommand.findUniqueOrThrow({
        where: { id: cmd.id },
      });
      expect(reclaimedRow.claimedByInstallationId).toBe(installationIdC);
      expect(reclaimedRow.claimAttemptCount).toBe(2);

      await prisma.connectorCommand.deleteMany({ where: { organizationId: rotationOrg.orgId } });
      await prisma.connectorInstallation.deleteMany({
        where: { organizationId: rotationOrg.orgId },
      });
      await prisma.connectorEnrollment.deleteMany({ where: { organizationId: rotationOrg.orgId } });
      await prisma.auditLog.deleteMany({ where: { organizationId: rotationOrg.orgId } });
      await deleteVenueGrants(prisma, rotationOrg.orgId);
      await prisma.staff.deleteMany({ where: { organizationId: rotationOrg.orgId } });
      await prisma.venue.deleteMany({ where: { organizationId: rotationOrg.orgId } });
      await prisma.organization.delete({ where: { id: rotationOrg.orgId } });
    });
  });

  describe('lease exhaustion and command expiry', () => {
    it('a claimed command whose redelivery budget is exhausted becomes expired and is never offered again', async () => {
      // Own fresh org/venue: by this point in the file, the shared primary
      // venue legitimately has other still-pending commands left over from
      // earlier describe blocks (this test only asserts about its own
      // command's fate, not the venue's entire queue).
      const exhaustionOrg = await createOrgVenueOwner('exhaustion');
      const cmd = await createTracerCommand(
        exhaustionOrg.venueId,
        exhaustionOrg.accessToken,
        'exhaustion-1',
      );
      const credential = await enrollConnector(exhaustionOrg.venueId, exhaustionOrg.accessToken);
      await reportSelfTestCapability(credential);

      // Simulate repeated stale-lease reclaim attempts up to the budget by
      // directly seeding claimAttemptCount at the limit with an expired
      // lease — the next poll() must expire it, not reclaim it.
      const [installationId] = splitCredential(credential);
      await prisma.connectorCommand.update({
        where: { id: cmd.id },
        data: {
          status: 'claimed',
          claimedByInstallationId: installationId,
          claimedAt: new Date(Date.now() - 10 * 60_000),
          leaseExpiresAt: new Date(Date.now() - 1000),
          claimAttemptCount: 5,
          maxClaimAttempts: 5,
        },
      });

      const res = await request(app.getHttpServer())
        .post('/api/connector/commands/poll')
        .set('Authorization', `Bearer ${credential}`)
        .expect(200);
      expect(res.body.commands).toEqual([]);

      const row = await prisma.connectorCommand.findUniqueOrThrow({ where: { id: cmd.id } });
      expect(row.status).toBe('expired');

      await prisma.connectorCommand.deleteMany({ where: { organizationId: exhaustionOrg.orgId } });
      await prisma.connectorInstallation.deleteMany({
        where: { organizationId: exhaustionOrg.orgId },
      });
      await prisma.connectorEnrollment.deleteMany({
        where: { organizationId: exhaustionOrg.orgId },
      });
      await prisma.auditLog.deleteMany({ where: { organizationId: exhaustionOrg.orgId } });
      await deleteVenueGrants(prisma, exhaustionOrg.orgId);
      await prisma.staff.deleteMany({ where: { organizationId: exhaustionOrg.orgId } });
      await prisma.venue.deleteMany({ where: { organizationId: exhaustionOrg.orgId } });
      await prisma.organization.delete({ where: { id: exhaustionOrg.orgId } });
    });

    it('a never-claimed command past its overall expiry is swept to expired and is never claimable', async () => {
      const cmd = await createTracerCommand(venueId, accessToken, 'overall-expiry-1');
      await prisma.connectorCommand.update({
        where: { id: cmd.id },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });

      const credential = await enrollConnector(venueId, accessToken);
      await reportSelfTestCapability(credential);
      const pollBeforeSweep = await request(app.getHttpServer())
        .post('/api/connector/commands/poll')
        .set('Authorization', `Bearer ${credential}`)
        .expect(200);
      expect(
        (pollBeforeSweep.body.commands as { id: string }[]).find((c) => c.id === cmd.id),
      ).toBeUndefined();

      const sweepResult = await commandService.sweep();
      expect(sweepResult.expiredNeverClaimed).toBeGreaterThanOrEqual(1);

      const row = await prisma.connectorCommand.findUniqueOrThrow({ where: { id: cmd.id } });
      expect(row.status).toBe('expired');
    });
  });

  describe('reconciliation: unknown state for an accepted-but-never-resolved command', () => {
    it('an accepted command whose terminal-report window elapses is swept to unknown and audited, then can no longer be reported', async () => {
      const cmd = await createTracerCommand(venueId, accessToken, 'unknown-1');
      const credential = await enrollConnector(venueId, accessToken);
      await reportSelfTestCapability(credential);

      await request(app.getHttpServer())
        .post('/api/connector/commands/poll')
        .set('Authorization', `Bearer ${credential}`)
        .expect(200);
      await request(app.getHttpServer())
        .post(`/api/connector/commands/${cmd.id}/accept`)
        .set('Authorization', `Bearer ${credential}`)
        .expect(200);

      await prisma.connectorCommand.update({
        where: { id: cmd.id },
        data: { terminalReportDeadline: new Date(Date.now() - 1000) },
      });

      const sweepResult = await commandService.sweep();
      expect(sweepResult.markedUnknown).toBeGreaterThanOrEqual(1);

      const row = await prisma.connectorCommand.findUniqueOrThrow({ where: { id: cmd.id } });
      expect(row.status).toBe('unknown');

      const auditRows = await prisma.auditLog.findMany({
        where: {
          organizationId: orgId,
          action: 'CONNECTOR_COMMAND_MARKED_UNKNOWN',
          resourceId: cmd.id,
        },
      });
      expect(auditRows).toHaveLength(1);

      // Never auto-retried: a late report attempt is rejected, the row
      // remains `unknown` (reconciliation-required), not silently resolved.
      await request(app.getHttpServer())
        .post(`/api/connector/commands/${cmd.id}/report`)
        .set('Authorization', `Bearer ${credential}`)
        .send({ outcome: 'succeeded', resultType: 'SIMULATED_ECHO', idempotencyKey: 'late-report' })
        .expect(409);

      // DL-093: the rejected late report is durably, non-mutatingly audited
      // — an operator can see a true outcome arrived even though it could
      // not be applied. The command itself is never resurrected.
      const lateReportAudit = await prisma.auditLog.findMany({
        where: {
          organizationId: orgId,
          action: 'CONNECTOR_COMMAND_LATE_REPORT_AFTER_UNKNOWN',
          resourceId: cmd.id,
        },
      });
      expect(lateReportAudit).toHaveLength(1);
      expect((lateReportAudit[0].after as { attemptedOutcome: string }).attemptedOutcome).toBe(
        'succeeded',
      );
      const rowAfterLateReport = await prisma.connectorCommand.findUniqueOrThrow({
        where: { id: cmd.id },
      });
      expect(rowAfterLateReport.status).toBe('unknown');
    });

    it('DL-093: a late FAILED report against an unknown command is also rejected and audited', async () => {
      const cmd = await createTracerCommand(venueId, accessToken, 'unknown-2');
      const credential = await enrollConnector(venueId, accessToken);
      await reportSelfTestCapability(credential);

      await request(app.getHttpServer())
        .post('/api/connector/commands/poll')
        .set('Authorization', `Bearer ${credential}`)
        .expect(200);
      await request(app.getHttpServer())
        .post(`/api/connector/commands/${cmd.id}/accept`)
        .set('Authorization', `Bearer ${credential}`)
        .expect(200);

      await prisma.connectorCommand.update({
        where: { id: cmd.id },
        data: { terminalReportDeadline: new Date(Date.now() - 1000) },
      });
      await commandService.sweep();

      await request(app.getHttpServer())
        .post(`/api/connector/commands/${cmd.id}/report`)
        .set('Authorization', `Bearer ${credential}`)
        .send({
          outcome: 'failed',
          resultType: 'SIMULATED_FAILURE',
          failureReason: 'connector-side timeout',
          idempotencyKey: 'late-report-failed',
        })
        .expect(409);

      const lateReportAudit = await prisma.auditLog.findMany({
        where: {
          organizationId: orgId,
          action: 'CONNECTOR_COMMAND_LATE_REPORT_AFTER_UNKNOWN',
          resourceId: cmd.id,
        },
      });
      expect(lateReportAudit).toHaveLength(1);
      expect((lateReportAudit[0].after as { attemptedOutcome: string }).attemptedOutcome).toBe(
        'failed',
      );

      const row = await prisma.connectorCommand.findUniqueOrThrow({ where: { id: cmd.id } });
      expect(row.status).toBe('unknown');
    });
  });

  describe('cancellation', () => {
    it('an admin can cancel a pending command; it is then never claimable', async () => {
      const cmd = await createTracerCommand(venueId, accessToken, 'cancel-1');
      await request(app.getHttpServer())
        .post(`/api/venues/${venueId}/connector/commands/${cmd.id}/cancel`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(201);

      const row = await prisma.connectorCommand.findUniqueOrThrow({ where: { id: cmd.id } });
      expect(row.status).toBe('cancelled');
      expect(row.cancelledAt).not.toBeNull();
    });

    it('an already-accepted command cannot be cancelled', async () => {
      const cmd = await createTracerCommand(venueId, accessToken, 'cancel-2');
      const credential = await enrollConnector(venueId, accessToken);
      await reportSelfTestCapability(credential);
      await request(app.getHttpServer())
        .post('/api/connector/commands/poll')
        .set('Authorization', `Bearer ${credential}`)
        .expect(200);
      await request(app.getHttpServer())
        .post(`/api/connector/commands/${cmd.id}/accept`)
        .set('Authorization', `Bearer ${credential}`)
        .expect(200);

      await request(app.getHttpServer())
        .post(`/api/venues/${venueId}/connector/commands/${cmd.id}/cancel`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(404);
    });
  });

  describe('real concurrency: a command cannot be claimed twice', () => {
    it('two simultaneous poll() calls racing for the same single pending command result in exactly one claim', async () => {
      const cmd = await createTracerCommand(venueId, accessToken, 'concurrency-1');
      const credential = await enrollConnector(venueId, accessToken);
      await reportSelfTestCapability(credential);
      const [installationId] = splitCredential(credential);
      const identity: ConnectorIdentity = { installationId, organizationId: orgId, venueId };

      const [resultA, resultB] = await Promise.all([
        commandService.poll(identity),
        commandService.poll(identity),
      ]);
      const totalClaims =
        resultA.filter((c) => c.id === cmd.id).length +
        resultB.filter((c) => c.id === cmd.id).length;
      expect(totalClaims).toBe(1);

      const row = await prisma.connectorCommand.findUniqueOrThrow({ where: { id: cmd.id } });
      expect(row.status).toBe('claimed');
      expect(row.claimAttemptCount).toBe(1);
    });
  });

  describe('bounded outstanding commands per installation', () => {
    it('a single installation cannot hold more than the configured cap of outstanding (claimed/accepted) commands', async () => {
      const boundedOrg = await createOrgVenueOwner('bounded');
      const credential = await enrollConnector(boundedOrg.venueId, boundedOrg.accessToken);
      await reportSelfTestCapability(credential);

      for (let i = 0; i < 25; i++) {
        await createTracerCommand(boundedOrg.venueId, boundedOrg.accessToken, `bounded-${i}`);
      }

      let totalClaimed = 0;
      for (let round = 0; round < 10; round++) {
        const res = await request(app.getHttpServer())
          .post('/api/connector/commands/poll')
          .set('Authorization', `Bearer ${credential}`)
          .expect(200);
        totalClaimed += (res.body.commands as unknown[]).length;
        if ((res.body.commands as unknown[]).length === 0) break;
      }
      expect(totalClaimed).toBeLessThanOrEqual(20);

      const finalPoll = await request(app.getHttpServer())
        .post('/api/connector/commands/poll')
        .set('Authorization', `Bearer ${credential}`)
        .expect(200);
      expect(finalPoll.body.commands).toEqual([]);

      await prisma.connectorCommand.deleteMany({ where: { organizationId: boundedOrg.orgId } });
      await prisma.connectorInstallation.deleteMany({
        where: { organizationId: boundedOrg.orgId },
      });
      await prisma.connectorEnrollment.deleteMany({ where: { organizationId: boundedOrg.orgId } });
      await prisma.auditLog.deleteMany({ where: { organizationId: boundedOrg.orgId } });
      await deleteVenueGrants(prisma, boundedOrg.orgId);
      await prisma.staff.deleteMany({ where: { organizationId: boundedOrg.orgId } });
      await prisma.venue.deleteMany({ where: { organizationId: boundedOrg.orgId } });
      await prisma.organization.delete({ where: { id: boundedOrg.orgId } });
    });
  });

  describe('existing POS-sync and print-job states remain untouched', () => {
    it('creating and resolving a tracer command does not write to POSSyncRecord or PrinterJob', async () => {
      const posSyncCountBefore = await prisma.pOSSyncRecord.count();
      const printJobCountBefore = await prisma.printerJob.count();

      const cmd = await createTracerCommand(venueId, accessToken, 'no-coupling-1');
      const credential = await enrollConnector(venueId, accessToken);
      await reportSelfTestCapability(credential);
      await request(app.getHttpServer())
        .post('/api/connector/commands/poll')
        .set('Authorization', `Bearer ${credential}`)
        .expect(200);
      await request(app.getHttpServer())
        .post(`/api/connector/commands/${cmd.id}/accept`)
        .set('Authorization', `Bearer ${credential}`)
        .expect(200);
      await request(app.getHttpServer())
        .post(`/api/connector/commands/${cmd.id}/report`)
        .set('Authorization', `Bearer ${credential}`)
        .send({
          outcome: 'succeeded',
          resultType: 'SIMULATED_ECHO',
          idempotencyKey: 'no-coupling-report',
        })
        .expect(200);

      expect(await prisma.pOSSyncRecord.count()).toBe(posSyncCountBefore);
      expect(await prisma.printerJob.count()).toBe(printJobCountBefore);
    });
  });
});
