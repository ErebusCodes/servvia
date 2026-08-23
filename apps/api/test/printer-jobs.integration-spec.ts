// Integration test against a REAL local Postgres (see
// local-postgres/README.md) — no mocking of Prisma. Exercises Story 8-1's
// truthful PrinterJob state machine: the processor's real database
// compare-and-swap transitions, a real (loopback) mock TCP server standing
// in for a physical printer's transport layer, the admin API's org/venue
// scoping, and reprint lineage/audit.
//
// A mock TCP server proves socket-level behavior only — it can never prove
// paper output or a real device acknowledgement. No test here asserts
// `printed`, because no code path in this codebase can produce it yet.
//
// Run with: npm run test:integration --workspace=backend
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import * as net from 'net';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { PrintJobsProcessor } from '../src/queue/processors/print-jobs.processor';
import { AuthService } from '../src/auth/auth.service';
import { PrinterJobsService } from '../src/printer/printer-jobs.service';
import { ConfigService } from '@nestjs/config';
import { PrintJobStatus, PrinterConnectionType, PrinterType } from '@prisma/client';

describe('PrinterJobs (integration, real local Postgres)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let processor: PrintJobsProcessor;
  let authService: AuthService;
  let printerJobsService: PrinterJobsService;
  let accessToken: string;
  let venueId: string;
  let organizationId: string;

  const TAG = 'phase8-1-integration-test';

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
    processor = app.get(PrintJobsProcessor);
    authService = app.get(AuthService);
    printerJobsService = app.get(PrinterJobsService);

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
    await prisma.auditLog.deleteMany({ where: { action: 'PRINTER_JOB_REPRINT_REQUESTED' } });
    await prisma.printerJob.deleteMany({ where: { printer: { name: { contains: TAG } } } });
    await prisma.printer.deleteMany({ where: { name: { contains: TAG } } });
    await app.close();
    await prisma.$disconnect();
  });

  async function makePrinter(
    overrides: Partial<{
      connectionType: PrinterConnectionType;
      host: string | null;
      port: number | null;
    }> = {},
  ) {
    return prisma.printer.create({
      data: {
        venueId,
        name: `${TAG} printer ${Date.now()}-${Math.random()}`,
        type: PrinterType.kitchen,
        connectionType: overrides.connectionType ?? PrinterConnectionType.tcp,
        host: overrides.host === undefined ? '127.0.0.1' : overrides.host,
        port: overrides.port === undefined ? 9999 : overrides.port,
      },
    });
  }

  async function makeJob(printerId: string, overrides: Record<string, unknown> = {}) {
    return prisma.printerJob.create({
      data: {
        printerId,
        venueId,
        status: PrintJobStatus.queued,
        payload: 'TEST TICKET',
        payloadFormat: 'raw_text',
        ...overrides,
      },
    });
  }

  function startEchoServer(): Promise<{ server: net.Server; port: number; connections: number[] }> {
    return new Promise((resolve) => {
      const state = { connections: [] as number[] };
      const server = net.createServer((socket) => {
        state.connections.push(Date.now());
        socket.on('data', () => socket.end());
      });
      server.listen(0, '127.0.0.1', () => {
        resolve({
          server,
          port: (server.address() as net.AddressInfo).port,
          connections: state.connections,
        });
      });
    });
  }

  describe('behavior matrix', () => {
    it('a job created with no worker delivery remains queued', async () => {
      const printer = await makePrinter();
      try {
        const job = await makeJob(printer.id);
        const reloaded = await prisma.printerJob.findUniqueOrThrow({ where: { id: job.id } });
        expect(reloaded.status).toBe(PrintJobStatus.queued);
      } finally {
        await prisma.printerJob.deleteMany({ where: { printerId: printer.id } });
        await prisma.printer.delete({ where: { id: printer.id } });
      }
    });

    it('a successful TCP write sets delivered — never printed — with a real deliveredAt', async () => {
      const { server, port } = await startEchoServer();
      const printer = await makePrinter({ port });
      try {
        const job = await makeJob(printer.id);
        await processor.process({ data: { printerJobId: job.id } } as any);
        const reloaded = await prisma.printerJob.findUniqueOrThrow({ where: { id: job.id } });
        expect(reloaded.status).toBe(PrintJobStatus.delivered);
        expect(reloaded.deliveredAt).not.toBeNull();
        expect(reloaded.printedAt).toBeNull();
      } finally {
        await new Promise((resolve) => server.close(resolve));
        await prisma.printerJob.deleteMany({ where: { printerId: printer.id } });
        await prisma.printer.delete({ where: { id: printer.id } });
      }
    });

    it('a TCP connection failure leaves a sanitized error and a retryable state before max attempts', async () => {
      // Port 1 on loopback: nothing listens there.
      const printer = await makePrinter({ port: 1 });
      try {
        const job = await makeJob(printer.id, { maxAttempts: 3 });
        await expect(
          processor.process({ data: { printerJobId: job.id } } as any),
        ).rejects.toThrow();
        const reloaded = await prisma.printerJob.findUniqueOrThrow({ where: { id: job.id } });
        expect(reloaded.status).toBe(PrintJobStatus.queued);
        expect(reloaded.attemptCount).toBe(1);
        expect(reloaded.errorMessage).not.toMatch(/127\.0\.0\.1/);
        expect(reloaded.errorMessage).not.toMatch(/:\d+/);
      } finally {
        await prisma.printerJob.deleteMany({ where: { printerId: printer.id } });
        await prisma.printer.delete({ where: { id: printer.id } });
      }
    });

    it('USB/Windows-shared connection types never reach printed — always manual', async () => {
      const printer = await makePrinter({
        connectionType: PrinterConnectionType.usb,
        host: null,
        port: null,
      });
      try {
        const job = await makeJob(printer.id);
        await processor.process({ data: { printerJobId: job.id } } as any);
        const reloaded = await prisma.printerJob.findUniqueOrThrow({ where: { id: job.id } });
        expect(reloaded.status).toBe(PrintJobStatus.manual);
      } finally {
        await prisma.printerJob.deleteMany({ where: { printerId: printer.id } });
        await prisma.printer.delete({ where: { id: printer.id } });
      }
    });

    it('a disconnected/powered-off printer never reaches printed after exhausting retries', async () => {
      const printer = await makePrinter({ port: 1 });
      try {
        const job = await makeJob(printer.id, { maxAttempts: 1 });
        await expect(
          processor.process({ data: { printerJobId: job.id } } as any),
        ).rejects.toThrow();
        const reloaded = await prisma.printerJob.findUniqueOrThrow({ where: { id: job.id } });
        expect(reloaded.status).toBe(PrintJobStatus.failed);
        expect(reloaded.status).not.toBe(PrintJobStatus.printed);
        expect(reloaded.failedAt).not.toBeNull();
      } finally {
        await prisma.printerJob.deleteMany({ where: { printerId: printer.id } });
        await prisma.printer.delete({ where: { id: printer.id } });
      }
    });

    it('a simulated printer fails closed in production (real ConfigService NODE_ENV check)', async () => {
      const printer = await makePrinter({ connectionType: PrinterConnectionType.simulated });
      const configService = app.get(ConfigService);
      const originalGet = configService.get.bind(configService);
      const spy = jest
        .spyOn(configService, 'get')
        .mockImplementation((...args: unknown[]) =>
          args[0] === 'NODE_ENV' ? 'production' : originalGet(...(args as [string])),
        );
      try {
        const job = await makeJob(printer.id);
        await processor.process({ data: { printerJobId: job.id } } as any);
        const reloaded = await prisma.printerJob.findUniqueOrThrow({ where: { id: job.id } });
        expect(reloaded.status).toBe(PrintJobStatus.failed);
        expect(reloaded.errorMessage).toMatch(/not permitted in production/);
      } finally {
        spy.mockRestore();
        await prisma.printerJob.deleteMany({ where: { printerId: printer.id } });
        await prisma.printer.delete({ where: { id: printer.id } });
      }
    });

    it('a simulated printer reaches delivered (never printed) outside production', async () => {
      const printer = await makePrinter({ connectionType: PrinterConnectionType.simulated });
      try {
        const job = await makeJob(printer.id);
        await processor.process({ data: { printerJobId: job.id } } as any);
        const reloaded = await prisma.printerJob.findUniqueOrThrow({ where: { id: job.id } });
        expect(reloaded.status).toBe(PrintJobStatus.delivered);
      } finally {
        await prisma.printerJob.deleteMany({ where: { printerId: printer.id } });
        await prisma.printer.delete({ where: { id: printer.id } });
      }
    });

    it('a genuinely concurrent duplicate delivery of the same job produces at most one physical transmission', async () => {
      const { server, port, connections } = await startEchoServer();
      const printer = await makePrinter({ port });
      try {
        const job = await makeJob(printer.id);
        await Promise.allSettled([
          processor.process({ data: { printerJobId: job.id } } as any),
          processor.process({ data: { printerJobId: job.id } } as any),
        ]);
        expect(connections.length).toBeLessThanOrEqual(1);
        const reloaded = await prisma.printerJob.findUniqueOrThrow({ where: { id: job.id } });
        // Whichever outcome, it must be a truthful one — never printed
        // (no acknowledgement mechanism exists), and never left as if
        // nothing happened.
        expect([PrintJobStatus.delivered, PrintJobStatus.uncertain]).toContain(reloaded.status);
      } finally {
        await new Promise((resolve) => server.close(resolve));
        await prisma.printerJob.deleteMany({ where: { printerId: printer.id } });
        await prisma.printer.delete({ where: { id: printer.id } });
      }
    });

    it('a worker interrupted after starting dispatch (crash window) becomes uncertain, never silently resent', async () => {
      const { server, port, connections } = await startEchoServer();
      const printer = await makePrinter({ port });
      try {
        // Simulates a worker that crashed after marking `dispatching` but
        // before recording an outcome — there is no real interrupted
        // process to observe directly, so this reproduces the exact
        // database state such an interruption would leave behind.
        const job = await makeJob(printer.id, { status: PrintJobStatus.dispatching });
        await processor.process({ data: { printerJobId: job.id } } as any);
        const reloaded = await prisma.printerJob.findUniqueOrThrow({ where: { id: job.id } });
        expect(reloaded.status).toBe(PrintJobStatus.uncertain);
        expect(connections.length).toBe(0); // no blind resend
      } finally {
        await new Promise((resolve) => server.close(resolve));
        await prisma.printerJob.deleteMany({ where: { printerId: printer.id } });
        await prisma.printer.delete({ where: { id: printer.id } });
      }
    });

    it('a crash between claiming a job and starting dispatch (found `accepted`) becomes uncertain, not permanently stranded', async () => {
      // Regression test for an independent-review finding: a job whose
      // claiming worker crashed before ever reaching `dispatching` used to
      // be treated as a silent no-op forever — unreachable by
      // re-processing AND excluded from reprintable statuses. Real
      // Postgres proves this is now recoverable.
      const printer = await makePrinter({ port: 1 });
      try {
        const job = await makeJob(printer.id, { status: PrintJobStatus.accepted, attemptCount: 1 });
        await processor.process({ data: { printerJobId: job.id } } as any);
        const reloaded = await prisma.printerJob.findUniqueOrThrow({ where: { id: job.id } });
        expect(reloaded.status).toBe(PrintJobStatus.uncertain);

        // And it is now genuinely reprintable — the whole point of
        // surfacing it instead of leaving it silently stuck.
        const staff = await prisma.staff.findFirstOrThrow({ where: { organizationId } });
        const reprint = await printerJobsService.requestReprint(
          printer.id,
          job.id,
          organizationId,
          venueId,
          { id: staff.id, email: staff.email, role: staff.role },
        );
        expect(reprint.reprintOfId).toBe(job.id);
        await prisma.printerJob.delete({ where: { id: reprint.id } });
      } finally {
        await prisma.printerJob.deleteMany({ where: { printerId: printer.id } });
        await prisma.printer.delete({ where: { id: printer.id } });
      }
    });

    it('a write following the claim cannot overwrite an `uncertain` marker raised by a genuinely concurrent invocation', async () => {
      // Regression test for a follow-up finding from independent
      // re-verification of the previous two fixes: every write leaving the
      // just-claimed `accepted` state (not only writes leaving
      // `dispatching`) needed the same CAS guard. USB is used because its
      // path from claim to terminal write is the shortest in the processor
      // (claim -> one findUniqueOrThrow -> manual), which gives two real,
      // concurrently-executing process() calls the best chance of
      // genuinely interleaving through real Postgres round-trips rather
      // than one trivially finishing before the other starts.
      const printer = await makePrinter({
        connectionType: PrinterConnectionType.usb,
        host: null,
        port: null,
      });
      try {
        const job = await makeJob(printer.id);
        const results = await Promise.allSettled([
          processor.process({ data: { printerJobId: job.id } } as any),
          processor.process({ data: { printerJobId: job.id } } as any),
        ]);
        expect(results.every((r) => r.status === 'fulfilled')).toBe(true);

        const reloaded = await prisma.printerJob.findUniqueOrThrow({ where: { id: job.id } });
        // Whichever invocation won the claim, the outcome must be a single,
        // truthful, non-corrupted state — never `printed`, and never two
        // conflicting writes racing to "win" silently.
        expect([PrintJobStatus.manual, PrintJobStatus.uncertain]).toContain(reloaded.status);
        expect(reloaded.attemptCount).toBe(1); // only the CAS-winner claimed it
      } finally {
        await prisma.printerJob.deleteMany({ where: { printerId: printer.id } });
        await prisma.printer.delete({ where: { id: printer.id } });
      }
    });

    // NOTE: the "a late, genuinely-successful TCP write cannot overwrite an
    // `uncertain` marker raised by a concurrent observer" property is
    // proven at the unit level only (print-jobs.processor.spec.ts — "a
    // slow-but-not-crashed worker cannot overwrite an `uncertain` marker
    // raised while it was mid-flight"), not here. An earlier attempt to
    // reproduce it over a real loopback TCP connection was removed: Node's
    // `socket.write()` callback fires once the OS accepts the bytes into
    // its send buffer, not when the remote reads them, so a tiny ticket
    // payload's write callback resolves before any test-side gate can
    // reliably delay it — the attempted test was flaky/unrepresentative of
    // the real race, not a genuine proof. The CAS guard itself
    // (`resolveFromDispatching`) is still exercised against real Postgres
    // by every other test in this file that reaches `delivered`/`failed`;
    // this specific ordering just isn't independently provable over a real
    // socket without introducing a test-only hook into production code.

    it('concurrent duplicate reprint requests against the same job create exactly one new reprint row', async () => {
      const printer = await makePrinter({ port: 1 });
      try {
        const original = await makeJob(printer.id, {
          status: PrintJobStatus.failed,
          failedAt: new Date(),
        });
        const staff = await prisma.staff.findFirstOrThrow({ where: { organizationId } });
        const actorArg = { id: staff.id, email: staff.email, role: staff.role };

        const results = await Promise.allSettled([
          printerJobsService.requestReprint(
            printer.id,
            original.id,
            organizationId,
            venueId,
            actorArg,
          ),
          printerJobsService.requestReprint(
            printer.id,
            original.id,
            organizationId,
            venueId,
            actorArg,
          ),
        ]);

        const fulfilled = results.filter((r) => r.status === 'fulfilled');
        const rejected = results.filter((r) => r.status === 'rejected');
        expect(fulfilled.length).toBe(1);
        expect(rejected.length).toBe(1);

        const reprintRows = await prisma.printerJob.findMany({
          where: { reprintOfId: original.id },
        });
        expect(reprintRows.length).toBe(1);
      } finally {
        await prisma.printerJob.deleteMany({ where: { printerId: printer.id } });
        await prisma.printer.delete({ where: { id: printer.id } });
      }
    });

    it('printer failure is independent of KDS/order state: a failed print job never mutates the Order', async () => {
      const order = await prisma.order.create({
        data: {
          venueId,
          status: 'confirmed',
          posSyncStatus: 'not_applicable',
          subtotalCents: 1000,
          taxCents: 150,
          totalCents: 1150,
          source: 'staff',
          idempotencyKey: `${TAG}-order-independence-${Date.now()}`,
        },
      });
      const printer = await makePrinter({ port: 1 });
      try {
        const before = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
        const job = await makeJob(printer.id, { orderId: order.id, maxAttempts: 1 });
        await expect(
          processor.process({ data: { printerJobId: job.id } } as any),
        ).rejects.toThrow();
        const reloadedJob = await prisma.printerJob.findUniqueOrThrow({ where: { id: job.id } });
        expect(reloadedJob.status).toBe(PrintJobStatus.failed);
        const after = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
        expect(after.status).toBe(before.status);
        expect(after.updatedAt.getTime()).toBe(before.updatedAt.getTime());
      } finally {
        await prisma.printerJob.deleteMany({ where: { printerId: printer.id } });
        await prisma.printer.delete({ where: { id: printer.id } });
        await prisma.order.delete({ where: { id: order.id } });
      }
    });
  });

  describe('reprint lineage and audit (via the real HTTP surface)', () => {
    it('staff can request a reprint of a terminal job; it is linked, audited and starts fresh at queued', async () => {
      const printer = await makePrinter({ port: 1 });
      try {
        const original = await makeJob(printer.id, {
          status: PrintJobStatus.failed,
          failedAt: new Date(),
          errorMessage: 'Printer dispatch failed.',
        });

        const res = await request(app.getHttpServer())
          .post(`/api/admin/printers/${printer.id}/jobs/${original.id}/reprint`)
          .set('Authorization', `Bearer ${accessToken}`)
          .expect(201);

        expect(res.body.reprintOfId).toBe(original.id);
        expect(res.body.status).toBe(PrintJobStatus.queued);
        expect(res.body.id).not.toBe(original.id);

        const auditRow = await prisma.auditLog.findFirst({
          where: { action: 'PRINTER_JOB_REPRINT_REQUESTED', resourceId: res.body.id },
        });
        expect(auditRow).not.toBeNull();
        expect(auditRow?.organizationId).toBe(organizationId);

        await prisma.printerJob.delete({ where: { id: res.body.id as string } });
      } finally {
        await prisma.printerJob.deleteMany({ where: { printerId: printer.id } });
        await prisma.printer.delete({ where: { id: printer.id } });
      }
    });

    it('rejects reprinting a job that is still in flight, with no new row created', async () => {
      const printer = await makePrinter();
      try {
        const inFlight = await makeJob(printer.id, { status: PrintJobStatus.dispatching });
        const before = await prisma.printerJob.count({ where: { printerId: printer.id } });

        await request(app.getHttpServer())
          .post(`/api/admin/printers/${printer.id}/jobs/${inFlight.id}/reprint`)
          .set('Authorization', `Bearer ${accessToken}`)
          .expect(409);

        const after = await prisma.printerJob.count({ where: { printerId: printer.id } });
        expect(after).toBe(before);
      } finally {
        await prisma.printerJob.deleteMany({ where: { printerId: printer.id } });
        await prisma.printer.delete({ where: { id: printer.id } });
      }
    });

    it('lists jobs for a printer through the admin API, distinguishing status values', async () => {
      const printer = await makePrinter({ port: 1 });
      try {
        await makeJob(printer.id, { status: PrintJobStatus.failed, failedAt: new Date() });
        await makeJob(printer.id, { status: PrintJobStatus.queued });

        const res = await request(app.getHttpServer())
          .get(`/api/admin/printers/${printer.id}/jobs`)
          .set('Authorization', `Bearer ${accessToken}`)
          .expect(200);

        const statuses = (res.body as Array<{ status: string }>).map((j) => j.status).sort();
        expect(statuses).toEqual(['failed', 'queued']);
      } finally {
        await prisma.printerJob.deleteMany({ where: { printerId: printer.id } });
        await prisma.printer.delete({ where: { id: printer.id } });
      }
    });
  });

  describe('tenant isolation', () => {
    it('rejects listing jobs for a printer belonging to another organization, with 404 not disclosure', async () => {
      const otherOrg = await prisma.organization.create({
        data: {
          name: `${TAG} other org`,
          slug: `${TAG}-other-org-${Date.now()}`,
          billingEmail: 'other-org@verdura.internal',
        },
      });
      const otherVenue = await prisma.venue.create({
        data: {
          organizationId: otherOrg.id,
          name: `${TAG} other venue`,
          slug: `${TAG}-other-venue-${Date.now()}`,
          address: {},
          operatingHours: {},
          seatingCapacity: 10,
        },
      });
      try {
        const otherPrinter = await prisma.printer.create({
          data: {
            venueId: otherVenue.id,
            name: `${TAG} other-org printer`,
            type: PrinterType.kitchen,
            connectionType: PrinterConnectionType.tcp,
            host: '127.0.0.1',
            port: 9999,
          },
        });

        await request(app.getHttpServer())
          .get(`/api/admin/printers/${otherPrinter.id}/jobs`)
          .set('Authorization', `Bearer ${accessToken}`)
          .expect(404);
      } finally {
        await prisma.printer.deleteMany({ where: { venueId: otherVenue.id } });
        await prisma.venue.delete({ where: { id: otherVenue.id } });
        await prisma.organization.delete({ where: { id: otherOrg.id } });
      }
    });

    it('a KDS device token scoped to one venue cannot see a printer job at another venue in the same org', async () => {
      const secondVenue = await prisma.venue.create({
        data: {
          organizationId,
          name: `${TAG} second venue`,
          slug: `${TAG}-second-venue-${Date.now()}`,
          address: {},
          operatingHours: {},
          seatingCapacity: 10,
        },
      });
      try {
        const secondVenuePrinter = await prisma.printer.create({
          data: {
            venueId: secondVenue.id,
            name: `${TAG} second-venue printer`,
            type: PrinterType.kitchen,
            connectionType: PrinterConnectionType.tcp,
            host: '127.0.0.1',
            port: 9999,
          },
        });
        const kdsToken = authService.signKdsDeviceToken(venueId, organizationId);

        await request(app.getHttpServer())
          .get(`/api/admin/printers/${secondVenuePrinter.id}/jobs`)
          .set('Authorization', `Bearer ${kdsToken}`)
          .expect(404);

        await prisma.printer.delete({ where: { id: secondVenuePrinter.id } });
      } finally {
        await prisma.printer.deleteMany({ where: { venueId: secondVenue.id } });
        await prisma.venue.delete({ where: { id: secondVenue.id } });
      }
    });

    it('a KDS device token (kitchen role) may view jobs but is rejected from requesting a reprint', async () => {
      const printer = await makePrinter({ port: 1 });
      try {
        const job = await makeJob(printer.id, {
          status: PrintJobStatus.failed,
          failedAt: new Date(),
        });
        const kdsToken = authService.signKdsDeviceToken(venueId, organizationId);

        await request(app.getHttpServer())
          .get(`/api/admin/printers/${printer.id}/jobs`)
          .set('Authorization', `Bearer ${kdsToken}`)
          .expect(200);

        await request(app.getHttpServer())
          .post(`/api/admin/printers/${printer.id}/jobs/${job.id}/reprint`)
          .set('Authorization', `Bearer ${kdsToken}`)
          .expect(403);
      } finally {
        await prisma.printerJob.deleteMany({ where: { printerId: printer.id } });
        await prisma.printer.delete({ where: { id: printer.id } });
      }
    });
  });
});
