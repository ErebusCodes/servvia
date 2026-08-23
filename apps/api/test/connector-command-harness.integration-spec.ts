// DURABLE_CONNECTOR_HARNESS evidence tier for Story 2-10. Spawns
// `scripts/connector-command-harness.ts` as a REAL, separate OS process
// (not an in-memory mock, not a function call within this test process)
// against a REAL running instance of the backend (listening on a real
// ephemeral TCP port) and a REAL local Postgres database, to prove
// persist-before-ack: the harness durably fsyncs a claimed command to a
// disposable local NDJSON file BEFORE reporting CONNECTOR_ACCEPTED, and
// fsyncs its terminal result BEFORE reporting it — and an unconditional
// SIGKILL of the harness process at each of those exact points is followed
// by a safe, non-duplicating resume on restart.
//
// This file never contacts Idealpos, EFTPOS, a printer, or a Windows host.
// The harness's only command type (`connector.self_test.v1`) has no real
// external side effect — see connector-command-harness.ts's own doc
// comment. No assertion here should be read as evidence of any external
// system outcome.
//
// Run with: npm run test:integration --workspace=backend
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import * as argon2 from 'argon2';
import Redis from 'ioredis';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawn } from 'child_process';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { REDIS_CLIENT } from '../src/redis/redis.constants';

describe('Connector Command Harness (integration, real process + real local Postgres)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let baseUrl: string;
  let redisClient: Redis;

  const TAG = 'story2-10-harness-integration';
  let tmpDir: string;

  let orgId: string;
  let venueId: string;
  let accessToken: string;

  async function clearAllRateLimits(): Promise<void> {
    const staleKeys = await redisClient.keys('rate-limit:*');
    if (staleKeys.length > 0) await redisClient.del(...staleKeys);
  }

  // npm workspaces hoist devDependencies to the repo-root node_modules —
  // this backend package has no node_modules/.bin of its own.
  const tsNodeBin = path.join(__dirname, '..', '..', 'node_modules', '.bin', 'ts-node');
  const harnessScript = path.join(__dirname, '..', 'scripts', 'connector-command-harness.ts');

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
    return { orgId: org.id, venueId: venue.id, accessToken: loginRes.body.accessToken as string };
  }

  async function enrollConnector(venue: string, adminToken: string): Promise<string> {
    const enrollRes = await request(app.getHttpServer())
      .post(`/api/venues/${venue}/connector/enrollments`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(201);
    const bootstrapToken = enrollRes.body.bootstrapToken as string;
    const redeemRes = await request(app.getHttpServer())
      .post('/api/connector/enroll')
      .set('Authorization', `Bearer ${bootstrapToken}`)
      .expect(200);
    return redeemRes.body.credential as string;
  }

  async function reportSelfTestCapability(credential: string): Promise<void> {
    await request(app.getHttpServer())
      .post('/api/connector/heartbeat')
      .set('Authorization', `Bearer ${credential}`)
      .send({ version: '0.0.1-tracer', capabilities: { 'connector.self_test.v1': true } })
      .expect(200);
  }

  async function createTracerCommand(venue: string, adminToken: string, idempotencyKey: string) {
    const res = await request(app.getHttpServer())
      .post(`/api/venues/${venue}/connector/commands/tracer`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ idempotencyKey })
      .expect(201);
    return res.body as { id: string };
  }

  /** Runs the harness as a real child process and waits for it to exit. */
  function runHarness(
    env: NodeJS.ProcessEnv,
  ): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
    return new Promise((resolve, reject) => {
      const child = spawn(tsNodeBin, [harnessScript], {
        env: { ...process.env, ...env },
        cwd: path.join(__dirname, '..'),
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stderr = '';
      child.stderr?.on('data', (d: Buffer) => {
        stderr += d.toString();
      });
      child.on('error', reject);
      child.on('exit', (code, signal) => {
        if (code !== 0 && signal !== 'SIGKILL' && stderr) {
          // Surface the harness's own error output for a non-crash failure,
          // to make a genuine bug easy to diagnose rather than a bare exit code.
          console.error('[harness stderr]', stderr);
        }
        resolve({ code, signal });
      });
    });
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
    // A real, separate OS process (the harness) needs a real TCP port to
    // reach — supertest's request(app.getHttpServer()) alone never listens.
    await app.listen(0);
    const server = app.getHttpServer() as import('http').Server;
    const address = server.address();
    const port = address && typeof address === 'object' ? address.port : 0;
    baseUrl = `http://127.0.0.1:${port}/api`;

    prisma = app.get(PrismaService);

    // Clears the ENTIRE rate-limit keyspace, not just this file's own
    // connector-prefixed paths — the `/api/auth/login` bucket is shared
    // across every file in the same `npm run test:integration` run (local
    // dev Redis only; see connector-command.integration-spec.ts's identical
    // rationale). Repeated in afterAll so files that happen to run after
    // this one in the same suite invocation aren't left starting from an
    // already-consumed shared bucket.
    redisClient = app.get<Redis>(REDIS_CLIENT);
    await clearAllRateLimits();

    const primary = await createOrgVenueOwner('primary');
    orgId = primary.orgId;
    venueId = primary.venueId;
    accessToken = primary.accessToken;

    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'connector-command-harness-'));
  }, 30_000);

  afterAll(async () => {
    await prisma.connectorCommand.deleteMany({ where: { organizationId: orgId } });
    await prisma.connectorInstallation.deleteMany({ where: { organizationId: orgId } });
    await prisma.connectorEnrollment.deleteMany({ where: { organizationId: orgId } });
    await prisma.auditLog.deleteMany({ where: { organizationId: orgId } });
    await prisma.staff.deleteMany({ where: { organizationId: orgId } });
    await prisma.venue.deleteMany({ where: { organizationId: orgId } });
    await prisma.organization.delete({ where: { id: orgId } });
    fs.rmSync(tmpDir, { recursive: true, force: true });
    await clearAllRateLimits();
    await app.close();
    await prisma.$disconnect();
  });

  it('happy path: the harness durably persists locally before reporting CONNECTOR_ACCEPTED, and the command resolves truthfully', async () => {
    const credential = await enrollConnector(venueId, accessToken);
    await reportSelfTestCapability(credential);
    const cmd = await createTracerCommand(venueId, accessToken, 'harness-happy-1');
    const storePath = path.join(tmpDir, 'happy.ndjson');

    const result = await runHarness({
      HARNESS_BASE_URL: baseUrl,
      HARNESS_CREDENTIAL: credential,
      HARNESS_STORE_PATH: storePath,
      HARNESS_MAX_TICKS: '1',
    });
    expect(result.code).toBe(0);

    // The local durable log genuinely exists on disk with fsync'd entries —
    // not an in-memory structure inside this test process.
    expect(fs.existsSync(storePath)).toBe(true);
    const lines = fs
      .readFileSync(storePath, 'utf8')
      .split('\n')
      .filter((l) => l.trim().length > 0)
      .map((l) => JSON.parse(l) as { type: string; commandId: string });
    expect(lines.some((l) => l.type === 'claimed' && l.commandId === cmd.id)).toBe(true);
    expect(lines.some((l) => l.type === 'terminal' && l.commandId === cmd.id)).toBe(true);

    const row = await prisma.connectorCommand.findUniqueOrThrow({ where: { id: cmd.id } });
    expect(row.status).toBe('succeeded');
    expect(row.resultType).toBe('SIMULATED_ECHO');
    expect(row.resultPayload).toEqual(expect.objectContaining({ echoHash: expect.any(String) }));
  }, 30_000);

  describe('crash-window safety: SIGKILL at each persist-before-ack boundary, then safe resume', () => {
    it.each([
      ['local_persist', 'crash-local-1'],
      ['accept_sent', 'crash-accept-1'],
      ['terminal_persist', 'crash-terminal-1'],
    ] as const)(
      'self-kill after %s is followed by exactly one successful terminal report on resume (no duplicate/conflicting report)',
      async (phase, key) => {
        const credential = await enrollConnector(venueId, accessToken);
        await reportSelfTestCapability(credential);
        const cmd = await createTracerCommand(venueId, accessToken, key);
        const storePath = path.join(tmpDir, `${key}.ndjson`);

        const crashRun = await runHarness({
          HARNESS_BASE_URL: baseUrl,
          HARNESS_CREDENTIAL: credential,
          HARNESS_STORE_PATH: storePath,
          HARNESS_MAX_TICKS: '1',
          HARNESS_SELF_KILL_AFTER: phase,
        });
        // The process genuinely died by an unconditional signal, not a
        // clean exit — proving anything not already fsync'd was lost.
        expect(crashRun.signal).toBe('SIGKILL');

        const midRow = await prisma.connectorCommand.findUniqueOrThrow({ where: { id: cmd.id } });
        if (phase === 'local_persist') {
          // Killed before the accept call was even made.
          expect(midRow.status).toBe('claimed');
        } else {
          // accept_sent or terminal_persist: the accept call already landed.
          expect(midRow.status).toBe('accepted');
        }

        // Restart: same store path, same credential, no self-kill this time.
        const resumeRun = await runHarness({
          HARNESS_BASE_URL: baseUrl,
          HARNESS_CREDENTIAL: credential,
          HARNESS_STORE_PATH: storePath,
          HARNESS_MAX_TICKS: '1',
        });
        expect(resumeRun.code).toBe(0);

        const finalRow = await prisma.connectorCommand.findUniqueOrThrow({ where: { id: cmd.id } });
        expect(finalRow.status).toBe('succeeded');
        expect(finalRow.resultType).toBe('SIMULATED_ECHO');

        // Exactly one accepted-audit and one succeeded-audit row — the
        // resume never produced a second, independent execution.
        const acceptedAudits = await prisma.auditLog.findMany({
          where: {
            organizationId: orgId,
            action: 'CONNECTOR_COMMAND_ACCEPTED',
            resourceId: cmd.id,
          },
        });
        expect(acceptedAudits).toHaveLength(1);
        const succeededAudits = await prisma.auditLog.findMany({
          where: {
            organizationId: orgId,
            action: 'CONNECTOR_COMMAND_SUCCEEDED',
            resourceId: cmd.id,
          },
        });
        expect(succeededAudits).toHaveLength(1);
        const conflictAudits = await prisma.auditLog.findMany({
          where: {
            organizationId: orgId,
            action: 'CONNECTOR_COMMAND_CONFLICTING_REPORT',
            resourceId: cmd.id,
          },
        });
        expect(conflictAudits).toHaveLength(0);
      },
      30_000,
    );
  });
});
