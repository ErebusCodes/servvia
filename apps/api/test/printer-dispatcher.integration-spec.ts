// Integration test against a REAL local Postgres (see
// local-postgres/README.md) — no mocking of Prisma. Exercises E8-S1
// (expanded)'s KOT dispatch producer: real database compare-and-swap
// claiming, the real ConnectorCommand unique-constraint enforcing
// "no duplicate active command for the same print attempt," real
// concurrent-producer safety, cancelled-order/deactivated-printer/retry-
// exhaustion handling, cross-venue isolation, and the reconciler's mapping
// of a terminal ConnectorCommand outcome back onto a truthful PrinterJob
// status.
//
// This file proves the PRODUCER and RECONCILER against real Postgres. It
// does NOT re-prove the ConnectorCommand poll/accept/report protocol itself
// (stories 2-9/2-10) — that is already covered, unchanged, by
// connector-command.integration-spec.ts. Where this file needs a command to
// reach a given terminal ConnectorCommandStatus/resultType, it writes that
// state directly via Prisma (the same state a real connector's report()
// call would produce) rather than re-running the full HTTP enrollment/auth
// flow, to keep this file focused on its own new code.
//
// Run with: npm run test:integration --workspace=backend
process.env.PRINTER_DISPATCH_CLAIM_LEASE_MS = '1000';
process.env.PRINTER_DISPATCH_SAFETY_NET_MS = '60000';
process.env.PRINTER_DISPATCH_BATCH_SIZE = '50';
process.env.PRINTER_DISPATCH_MAX_ATTEMPTS = '2';

import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { PrinterDispatcherService } from '../src/printer/printer-dispatcher.service';
import { PrinterJobsService } from '../src/printer/printer-jobs.service';
import { StaffRole } from '@prisma/client';
import {
  ConnectorCommandStatus,
  OrderStatus,
  PrintJobStatus,
  PrinterConnectionType,
  PrinterType,
} from '@prisma/client';
import {
  KOT_RESULT_TYPE,
  PRINT_KOT_COMMAND_TYPE,
} from '../src/printer/printer-connector-command.constants';

describe('Printer Dispatch Producer (integration, real local Postgres)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let dispatcher: PrinterDispatcherService;
  let printerJobsService: PrinterJobsService;
  let managerActor: { id: string; email: string; role: StaffRole };
  let venueId: string;
  let organizationId: string;

  const TAG = 'e8s1-dispatch-integration-test';

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    prisma = app.get(PrismaService);
    dispatcher = app.get(PrinterDispatcherService);
    printerJobsService = app.get(PrinterJobsService);

    const venue = await prisma.venue.findFirstOrThrow({ where: { slug: 'auckland' } });
    venueId = venue.id;
    organizationId = venue.organizationId;

    const staff = await prisma.staff.findFirstOrThrow({ where: { organizationId } });
    managerActor = { id: staff.id, email: staff.email, role: StaffRole.manager };
  });

  afterAll(async () => {
    const taggedOrders = await prisma.order.findMany({
      where: { notes: TAG },
      select: { id: true },
    });
    const orderIds = taggedOrders.map((o) => o.id);
    const taggedJobs = await prisma.printerJob.findMany({
      where: { printer: { name: { contains: TAG } } },
      select: { id: true },
    });
    const jobIds = taggedJobs.map((j) => j.id);

    await prisma.connectorCommand.deleteMany({
      where: { sourceAggregateType: 'PrinterJob', sourceRecordId: { in: jobIds } },
    });
    await prisma.auditLog.deleteMany({
      where: { action: 'PRINTER_JOB_MANUAL_RETRY_REQUESTED', resourceId: { in: jobIds } },
    });
    await prisma.printerJob.deleteMany({ where: { id: { in: jobIds } } });
    await prisma.printer.deleteMany({ where: { name: { contains: TAG } } });
    await prisma.orderItem.deleteMany({ where: { orderId: { in: orderIds } } });
    await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
    await prisma.menuItem.deleteMany({ where: { title: { contains: TAG } } });
    await prisma.category.deleteMany({ where: { name: { contains: TAG } } });
    await app.close();
    await prisma.$disconnect();
  });

  async function makePrinter(overrides: Partial<{ isActive: boolean; venueId: string }> = {}) {
    return prisma.printer.create({
      data: {
        venueId: overrides.venueId ?? venueId,
        name: `${TAG} printer ${Date.now()}-${Math.random()}`,
        type: PrinterType.kitchen,
        connectionType: PrinterConnectionType.tcp,
        host: '127.0.0.1',
        port: 9999,
        isActive: overrides.isActive ?? true,
      },
    });
  }

  async function makeOrder(overrides: Record<string, unknown> = {}) {
    const order = await prisma.order.create({
      data: {
        venueId: (overrides.venueId as string) ?? venueId,
        status: (overrides.status as OrderStatus) ?? OrderStatus.confirmed,
        subtotalCents: 1000,
        taxCents: 150,
        totalCents: 1150,
        tableNumber: '12',
        source: 'staff',
        notes: TAG,
        idempotencyKey: `${TAG}-${Date.now()}-${Math.random()}`,
      },
    });
    await prisma.orderItem.create({
      data: {
        orderId: order.id,
        menuItemId: (await ensureMenuItem()).id,
        menuItemTitle: 'Test Burger',
        menuItemCategory: 'Mains',
        unitPriceCents: 1000,
        quantity: 2,
        lineTotalCents: 2000,
        selectedModifiers: [{ modifierGroupName: 'Spice', optionName: 'Hot', priceDeltaCents: 0 }],
        notes: 'no onion',
      },
    });
    return order;
  }

  let cachedMenuItemId: { id: string } | null = null;
  async function ensureMenuItem() {
    if (cachedMenuItemId) return cachedMenuItemId;
    const staff = await prisma.staff.findFirstOrThrow({ where: { organizationId } });
    const cat = await prisma.category.create({
      data: { organizationId, name: `${TAG} category`, createdById: staff.id },
    });
    const created = await prisma.menuItem.create({
      data: {
        organizationId,
        categoryId: cat.id,
        title: `${TAG} menu item`,
        description: 'test item',
        priceCents: 1000,
        nutritionalDetails: {},
        isAvailable: true,
        createdById: staff.id,
      },
    });
    cachedMenuItemId = { id: created.id };
    return cachedMenuItemId;
  }

  async function makeJob(
    printerId: string,
    orderId: string | null,
    overrides: Record<string, unknown> = {},
  ) {
    return prisma.printerJob.create({
      data: {
        printerId,
        orderId,
        venueId,
        status: PrintJobStatus.queued,
        payload: 'unused-by-new-producer',
        payloadFormat: 'raw_text',
        ...overrides,
      },
    });
  }

  async function dispatchedJob() {
    const printer = await makePrinter();
    const order = await makeOrder();
    const job = await makeJob(printer.id, order.id);
    await dispatcher.sweepDispatch();
    return prisma.printerJob.findUniqueOrThrow({ where: { id: job.id } });
  }

  describe('sweepDispatch', () => {
    it('an eligible queued job creates exactly one connector-scoped command and moves to connector_dispatched', async () => {
      const printer = await makePrinter();
      const order = await makeOrder();
      const job = await makeJob(printer.id, order.id);

      const result = await dispatcher.sweepDispatch();
      expect(result.dispatched).toBeGreaterThanOrEqual(1);

      const reloaded = await prisma.printerJob.findUniqueOrThrow({ where: { id: job.id } });
      expect(reloaded.status).toBe(PrintJobStatus.connector_dispatched);
      expect(reloaded.connectorCommandId).not.toBeNull();

      const command = await prisma.connectorCommand.findUniqueOrThrow({
        where: { id: reloaded.connectorCommandId! },
      });
      expect(command.commandType).toBe(PRINT_KOT_COMMAND_TYPE);
      expect(command.organizationId).toBe(organizationId);
      expect(command.venueId).toBe(venueId);
      expect(command.sourceAggregateType).toBe('PrinterJob');
      expect(command.sourceRecordId).toBe(job.id);
      const payload = command.payload as Record<string, unknown>;
      expect(payload.documentType).toBe('kot');
      expect(String(payload.renderedContent)).toContain('Spice: Hot');
      expect(String(payload.renderedContent)).toContain('Test Burger');
      expect(String(payload.renderedContent).toLowerCase()).not.toMatch(/gst|subtotal/);

      const commandCount = await prisma.connectorCommand.count({
        where: { sourceAggregateType: 'PrinterJob', sourceRecordId: job.id },
      });
      expect(commandCount).toBe(1);
    });

    it('a crash between command-creation and status-confirm resolves to the SAME command on retry — no duplicate (DB-enforced idempotency)', async () => {
      const printer = await makePrinter();
      const order = await makeOrder();
      const job = await makeJob(printer.id, order.id);

      await dispatcher.sweepDispatch();
      const afterFirst = await prisma.printerJob.findUniqueOrThrow({ where: { id: job.id } });
      expect(afterFirst.status).toBe(PrintJobStatus.connector_dispatched);
      const firstCommandId = afterFirst.connectorCommandId;

      // Simulate the crash-window: the command was durably created and
      // confirmed, but pretend the process crashed before this point by
      // resetting the row to `queued` with the SAME dispatchAttemptCount
      // (0) it had before the real confirm — exactly what a genuine crash
      // between command-creation and confirmation would leave behind.
      await prisma.printerJob.update({
        where: { id: job.id },
        data: { status: PrintJobStatus.queued, dispatchClaimId: null, dispatchAttemptCount: 0 },
      });

      await dispatcher.sweepDispatch();
      const afterSecond = await prisma.printerJob.findUniqueOrThrow({ where: { id: job.id } });
      expect(afterSecond.connectorCommandId).toBe(firstCommandId);

      const commandCount = await prisma.connectorCommand.count({
        where: { sourceAggregateType: 'PrinterJob', sourceRecordId: job.id },
      });
      expect(commandCount).toBe(1);
    });

    it('concurrent producer sweeps against the same jobs create exactly one command per job (real DB CAS)', async () => {
      const printer = await makePrinter();
      const order = await makeOrder();
      const jobs = await Promise.all([
        makeJob(printer.id, order.id),
        makeJob(printer.id, order.id),
        makeJob(printer.id, order.id),
      ]);

      const results = await Promise.all([
        dispatcher.sweepDispatch(),
        dispatcher.sweepDispatch(),
        dispatcher.sweepDispatch(),
        dispatcher.sweepDispatch(),
      ]);
      const totalDispatched = results.reduce((sum, r) => sum + r.dispatched, 0);
      expect(totalDispatched).toBe(jobs.length);

      for (const job of jobs) {
        const count = await prisma.connectorCommand.count({
          where: { sourceAggregateType: 'PrinterJob', sourceRecordId: job.id },
        });
        expect(count).toBe(1);
      }
    });

    it('a job whose order was cancelled before dispatch is marked cancelled, never dispatched', async () => {
      const printer = await makePrinter();
      const order = await makeOrder({ status: 'cancelled' });
      const job = await makeJob(printer.id, order.id);

      await dispatcher.sweepDispatch();

      const reloaded = await prisma.printerJob.findUniqueOrThrow({ where: { id: job.id } });
      expect(reloaded.status).toBe(PrintJobStatus.cancelled);
      expect(reloaded.connectorCommandId).toBeNull();
    });

    it('a job whose printer was deactivated after creation is marked manual, never dispatched', async () => {
      const printer = await makePrinter({ isActive: false });
      const order = await makeOrder();
      const job = await makeJob(printer.id, order.id);

      await dispatcher.sweepDispatch();

      const reloaded = await prisma.printerJob.findUniqueOrThrow({ where: { id: job.id } });
      expect(reloaded.status).toBe(PrintJobStatus.manual);
      expect(reloaded.connectorCommandId).toBeNull();
    });

    it('a job that has already exhausted its dispatch attempt budget is marked manual and never claimed', async () => {
      const printer = await makePrinter();
      const order = await makeOrder();
      const job = await makeJob(printer.id, order.id, { dispatchAttemptCount: 999 });

      await dispatcher.sweepDispatch();

      const reloaded = await prisma.printerJob.findUniqueOrThrow({ where: { id: job.id } });
      expect(reloaded.status).toBe(PrintJobStatus.manual);
      expect(reloaded.dispatchExhaustedAt).not.toBeNull();
      expect(reloaded.connectorCommandId).toBeNull();
    });

    it("cross-venue isolation: each venue's job produces a command scoped to its own org/venue only", async () => {
      const org2 = await prisma.organization.create({
        data: {
          name: `${TAG} org2`,
          slug: `${TAG}-org2-${Date.now()}`,
          billingEmail: `${TAG}@verdura.internal`,
        },
      });
      const venue2 = await prisma.venue.create({
        data: {
          organizationId: org2.id,
          name: `${TAG} venue2`,
          slug: `${TAG}-venue2-${Date.now()}`,
          address: {},
          operatingHours: {},
          seatingCapacity: 10,
        },
      });

      const printerA = await makePrinter();
      const orderA = await makeOrder();
      const jobA = await makeJob(printerA.id, orderA.id);

      const printerB = await makePrinter({ venueId: venue2.id });
      const jobB = await prisma.printerJob.create({
        data: {
          printerId: printerB.id,
          venueId: venue2.id,
          status: PrintJobStatus.queued,
          payload: 'x',
          payloadFormat: 'raw_text',
        },
      });

      try {
        await dispatcher.sweepDispatch();

        const reloadedA = await prisma.printerJob.findUniqueOrThrow({ where: { id: jobA.id } });
        const reloadedB = await prisma.printerJob.findUniqueOrThrow({ where: { id: jobB.id } });
        const commandA = await prisma.connectorCommand.findUniqueOrThrow({
          where: { id: reloadedA.connectorCommandId! },
        });
        const commandB = await prisma.connectorCommand.findUniqueOrThrow({
          where: { id: reloadedB.connectorCommandId! },
        });
        expect(commandA.organizationId).toBe(organizationId);
        expect(commandA.venueId).toBe(venueId);
        expect(commandB.organizationId).toBe(org2.id);
        expect(commandB.venueId).toBe(venue2.id);
        expect(commandA.organizationId).not.toBe(commandB.organizationId);
      } finally {
        await prisma.printerJob.deleteMany({ where: { venueId: venue2.id } });
        await prisma.connectorCommand.deleteMany({ where: { venueId: venue2.id } });
        await prisma.printer.deleteMany({ where: { venueId: venue2.id } });
        await prisma.venue.delete({ where: { id: venue2.id } });
        await prisma.organization.delete({ where: { id: org2.id } });
      }
    });
  });

  describe('sweepReconcile', () => {
    it('a succeeded command with executed_acknowledged reconciles to delivered', async () => {
      const job = await dispatchedJob();
      await prisma.connectorCommand.update({
        where: { id: job.connectorCommandId! },
        // Real DB constraint ConnectorCommand_terminal_report_requires_acceptance
        // requires acceptedAt to be set for any terminal succeeded/failed
        // report — mirrors what ConnectorCommandService#report() would only
        // ever allow after accept() ran for real.
        data: {
          status: ConnectorCommandStatus.succeeded,
          resultType: KOT_RESULT_TYPE.EXECUTED_ACKNOWLEDGED,
          acceptedAt: new Date(),
        },
      });

      await dispatcher.sweepReconcile();

      const reloaded = await prisma.printerJob.findUniqueOrThrow({ where: { id: job.id } });
      expect(reloaded.status).toBe(PrintJobStatus.delivered);
      expect(reloaded.deliveredAt).not.toBeNull();
    });

    it('a command marked unknown (accepted, no terminal report) reconciles to uncertain and stays there — never auto-retried', async () => {
      const job = await dispatchedJob();
      await prisma.connectorCommand.update({
        where: { id: job.connectorCommandId! },
        data: { status: ConnectorCommandStatus.unknown },
      });

      await dispatcher.sweepReconcile();
      const afterFirst = await prisma.printerJob.findUniqueOrThrow({ where: { id: job.id } });
      expect(afterFirst.status).toBe(PrintJobStatus.uncertain);

      // A second reconcile pass must not touch it again (CAS guarded on
      // status = connector_dispatched, which is no longer true).
      await dispatcher.sweepReconcile();
      const afterSecond = await prisma.printerJob.findUniqueOrThrow({ where: { id: job.id } });
      expect(afterSecond.status).toBe(PrintJobStatus.uncertain);
    });

    it('an expired command (never accepted) is safely retried within budget, minting a fresh attempt', async () => {
      const job = await dispatchedJob();
      const firstCommandId = job.connectorCommandId!;
      await prisma.connectorCommand.update({
        where: { id: firstCommandId },
        data: { status: ConnectorCommandStatus.expired },
      });

      await dispatcher.sweepReconcile();
      const afterReconcile = await prisma.printerJob.findUniqueOrThrow({ where: { id: job.id } });
      expect(afterReconcile.status).toBe(PrintJobStatus.queued);

      await dispatcher.sweepDispatch();
      const afterRedispatch = await prisma.printerJob.findUniqueOrThrow({ where: { id: job.id } });
      expect(afterRedispatch.status).toBe(PrintJobStatus.connector_dispatched);
      expect(afterRedispatch.connectorCommandId).not.toBe(firstCommandId);

      const totalCommands = await prisma.connectorCommand.count({
        where: { sourceAggregateType: 'PrinterJob', sourceRecordId: job.id },
      });
      expect(totalCommands).toBe(2);
    });

    it('retry exhaustion: a retryable failure past the attempt budget becomes terminal failed, not another retry', async () => {
      const printer = await makePrinter();
      const order = await makeOrder();
      const job = await makeJob(printer.id, order.id, { dispatchAttemptCount: 1 });
      await dispatcher.sweepDispatch();
      const dispatched = await prisma.printerJob.findUniqueOrThrow({ where: { id: job.id } });
      expect(dispatched.dispatchAttemptCount).toBe(2); // == PRINTER_DISPATCH_MAX_ATTEMPTS

      await prisma.connectorCommand.update({
        where: { id: dispatched.connectorCommandId! },
        data: {
          status: ConnectorCommandStatus.failed,
          resultType: KOT_RESULT_TYPE.RETRYABLE_LOCAL_FAILURE,
          acceptedAt: new Date(),
        },
      });

      await dispatcher.sweepReconcile();
      const reloaded = await prisma.printerJob.findUniqueOrThrow({ where: { id: job.id } });
      expect(reloaded.status).toBe(PrintJobStatus.failed);
      expect(reloaded.dispatchExhaustedAt).not.toBeNull();
    });

    it('an unsupported-printer report reconciles to manual, not retried', async () => {
      const job = await dispatchedJob();
      await prisma.connectorCommand.update({
        where: { id: job.connectorCommandId! },
        data: {
          status: ConnectorCommandStatus.failed,
          resultType: KOT_RESULT_TYPE.UNSUPPORTED,
          acceptedAt: new Date(),
        },
      });

      await dispatcher.sweepReconcile();
      const reloaded = await prisma.printerJob.findUniqueOrThrow({ where: { id: job.id } });
      expect(reloaded.status).toBe(PrintJobStatus.manual);
    });

    it('a cancelled command reconciles to cancelled', async () => {
      const job = await dispatchedJob();
      await prisma.connectorCommand.update({
        where: { id: job.connectorCommandId! },
        // Real DB constraint ConnectorCommand_cancelled_has_cancelledAt.
        data: { status: ConnectorCommandStatus.cancelled, cancelledAt: new Date() },
      });

      await dispatcher.sweepReconcile();
      const reloaded = await prisma.printerJob.findUniqueOrThrow({ where: { id: job.id } });
      expect(reloaded.status).toBe(PrintJobStatus.cancelled);
    });
  });

  describe('operator recovery: retryDispatch (real Postgres, audited)', () => {
    it('a manual job (unsupported printer config, confirmed never executed) is retried in place — same row, fresh dispatch', async () => {
      const job = await dispatchedJob();
      await prisma.connectorCommand.update({
        where: { id: job.connectorCommandId! },
        data: {
          status: ConnectorCommandStatus.failed,
          resultType: KOT_RESULT_TYPE.UNSUPPORTED,
          acceptedAt: new Date(),
        },
      });
      await dispatcher.sweepReconcile();
      const manualJob = await prisma.printerJob.findUniqueOrThrow({ where: { id: job.id } });
      expect(manualJob.status).toBe(PrintJobStatus.manual);

      const retried = await printerJobsService.retryDispatch(
        job.printerId,
        job.id,
        organizationId,
        venueId,
        managerActor,
      );
      expect(retried.status).toBe(PrintJobStatus.queued);
      expect(retried.dispatchExhaustedAt).toBeNull();

      const auditRow = await prisma.auditLog.findFirst({
        where: { action: 'PRINTER_JOB_MANUAL_RETRY_REQUESTED', resourceId: job.id },
      });
      expect(auditRow).not.toBeNull();

      // Genuinely re-dispatchable — proves the row is not just relabeled.
      await dispatcher.sweepDispatch();
      const reDispatched = await prisma.printerJob.findUniqueOrThrow({ where: { id: job.id } });
      expect(reDispatched.status).toBe(PrintJobStatus.connector_dispatched);
    });

    it('a delivered (already-successful) job cannot be retried in place — must use reprint', async () => {
      const job = await dispatchedJob();
      await prisma.connectorCommand.update({
        where: { id: job.connectorCommandId! },
        data: {
          status: ConnectorCommandStatus.succeeded,
          resultType: KOT_RESULT_TYPE.EXECUTED_ACKNOWLEDGED,
          acceptedAt: new Date(),
        },
      });
      await dispatcher.sweepReconcile();

      await expect(
        printerJobsService.retryDispatch(
          job.printerId,
          job.id,
          organizationId,
          venueId,
          managerActor,
        ),
      ).rejects.toThrow();
    });

    it('independent-review P1 regression: genuinely concurrent reprint + retryDispatch against the same manual job never produce two dispatchable rows', async () => {
      const printer = await makePrinter();
      const order = await makeOrder();
      const job = await makeJob(printer.id, order.id);
      await dispatcher.sweepDispatch();
      const dispatched = await prisma.printerJob.findUniqueOrThrow({ where: { id: job.id } });
      await prisma.connectorCommand.update({
        where: { id: dispatched.connectorCommandId! },
        data: {
          status: ConnectorCommandStatus.failed,
          resultType: KOT_RESULT_TYPE.UNSUPPORTED,
          acceptedAt: new Date(),
        },
      });
      await dispatcher.sweepReconcile();
      const manualJob = await prisma.printerJob.findUniqueOrThrow({ where: { id: job.id } });
      expect(manualJob.status).toBe(PrintJobStatus.manual);

      const results = await Promise.allSettled([
        printerJobsService.requestReprint(
          job.printerId,
          job.id,
          organizationId,
          venueId,
          managerActor,
        ),
        printerJobsService.retryDispatch(
          job.printerId,
          job.id,
          organizationId,
          venueId,
          managerActor,
        ),
      ]);

      const succeeded = results.filter((r) => r.status === 'fulfilled');
      // Real Postgres row-lock serialization: exactly one of the two
      // concurrent operations may succeed. Both succeeding would mean two
      // independently-dispatchable rows for one logical ticket — the exact
      // duplicate-print risk this whole design exists to prevent.
      expect(succeeded.length).toBe(1);

      const reloadedOriginal = await prisma.printerJob.findUniqueOrThrow({ where: { id: job.id } });
      const reprints = await prisma.printerJob.findMany({ where: { reprintOfId: job.id } });

      const dispatchableCount =
        (reloadedOriginal.status === PrintJobStatus.queued ? 1 : 0) +
        reprints.filter((r) => r.status === PrintJobStatus.queued).length;
      expect(dispatchableCount).toBe(1);
    });
  });

  describe('database constraint evidence', () => {
    it('ConnectorCommand uniquely constrains (organizationId, venueId, idempotencyKey) — a real P2002 on direct duplicate insert', async () => {
      const key = `${TAG}-uniqueness-${Date.now()}`;
      await prisma.connectorCommand.create({
        data: {
          organizationId,
          venueId,
          commandType: PRINT_KOT_COMMAND_TYPE,
          schemaVersion: 1,
          idempotencyKey: key,
          payload: {},
          expiresAt: new Date(Date.now() + 60_000),
        },
      });

      await expect(
        prisma.connectorCommand.create({
          data: {
            organizationId,
            venueId,
            commandType: PRINT_KOT_COMMAND_TYPE,
            schemaVersion: 1,
            idempotencyKey: key,
            payload: {},
            expiresAt: new Date(Date.now() + 60_000),
          },
        }),
      ).rejects.toThrow();

      await prisma.connectorCommand.deleteMany({ where: { idempotencyKey: key } });
    });

    it('PrinterJob.connectorCommandId is uniquely constrained — a second job cannot point at the same command', async () => {
      const printer = await makePrinter();
      const order = await makeOrder();
      const job1 = await makeJob(printer.id, order.id);
      await dispatcher.sweepDispatch();
      const reloaded = await prisma.printerJob.findUniqueOrThrow({ where: { id: job1.id } });

      const job2 = await makeJob(printer.id, order.id);
      await expect(
        prisma.printerJob.update({
          where: { id: job2.id },
          data: { connectorCommandId: reloaded.connectorCommandId },
        }),
      ).rejects.toThrow();
    });
  });
});
