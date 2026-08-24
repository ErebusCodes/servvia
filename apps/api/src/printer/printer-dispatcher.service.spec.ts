import * as fs from 'fs';
import * as path from 'path';
import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ConnectorCommandStatus, PrintJobStatus } from '@prisma/client';
import { PrinterDispatcherService } from './printer-dispatcher.service';
import { PrismaService } from '../prisma/prisma.service';
import { ConnectorCommandService } from '../connector/connector-command.service';
import { KOT_RESULT_TYPE } from './printer-connector-command.constants';

const mockPrisma: any = {
  printerJob: {
    findMany: jest.fn(),
    updateMany: jest.fn(),
    findUniqueOrThrow: jest.fn(),
  },
};

const mockConnectorCommandService: any = {
  createCommand: jest.fn(),
};

interface UpdateManyErrorCallArgs {
  data: { lastDispatchError?: string | null };
}

// mockPrisma.printerJob.updateMany.mock.calls is `any` (mockPrisma itself is
// `any` — see above), so `.find()`'s callback must be given a real
// parameter type here to avoid returning `any` from the predicate; this
// narrows only the shape this spec file actually reads, nothing more.
function findUpdateManyCallWithError(calls: unknown): UpdateManyErrorCallArgs | undefined {
  return (calls as UpdateManyErrorCallArgs[][]).find((c) => c[0].data.lastDispatchError)?.[0];
}

function dispatchCandidate(overrides: Record<string, unknown> = {}) {
  return {
    id: 'job-1',
    venueId: 'venue-1',
    orderId: 'order-1',
    dispatchAttemptCount: 0,
    printer: { id: 'printer-1', isActive: true, name: 'Kitchen', type: 'kitchen', charPerLine: 42 },
    order: { id: 'order-1', status: 'confirmed', tableNumber: '12', notes: null },
    venue: { organizationId: 'org-1' },
    ...overrides,
  };
}

function renderJob(overrides: Record<string, unknown> = {}) {
  return {
    id: 'job-1',
    orderId: 'order-1',
    printerId: 'printer-1',
    printer: {
      id: 'printer-1',
      name: 'Kitchen',
      type: 'kitchen',
      charPerLine: 42,
      venueId: 'venue-1',
    },
    order: {
      id: 'order-1',
      tableNumber: '12',
      notes: null,
      items: [{ menuItemTitle: 'Burger', quantity: 1, notes: null, selectedModifiers: [] }],
    },
    ...overrides,
  };
}

describe('PrinterDispatcherService', () => {
  let service: PrinterDispatcherService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockPrisma.printerJob.findMany.mockResolvedValue([]);
    mockPrisma.printerJob.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.printerJob.findUniqueOrThrow.mockResolvedValue(renderJob());
    mockConnectorCommandService.createCommand.mockResolvedValue({ id: 'command-1' });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PrinterDispatcherService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ConnectorCommandService, useValue: mockConnectorCommandService },
        { provide: ConfigService, useValue: { get: (_key: string, def?: unknown) => def } },
      ],
    }).compile();

    service = module.get<PrinterDispatcherService>(PrinterDispatcherService);
  });

  afterEach(() => {
    service.onModuleDestroy();
  });

  describe('sweepDispatch', () => {
    it('does nothing when there are no eligible candidates', async () => {
      const result = await service.sweepDispatch();
      expect(result).toEqual({
        eligible: 0,
        claimed: 0,
        dispatched: 0,
        dispatchFailed: 0,
        markedManual: 0,
        markedCancelled: 0,
        exhausted: 0,
      });
      expect(mockConnectorCommandService.createCommand).not.toHaveBeenCalled();
    });

    it('claims a candidate, creates a connector command, and confirms dispatch', async () => {
      mockPrisma.printerJob.findMany.mockResolvedValueOnce([dispatchCandidate()]);

      const result = await service.sweepDispatch();

      expect(result.claimed).toBe(1);
      expect(result.dispatched).toBe(1);
      expect(mockConnectorCommandService.createCommand).toHaveBeenCalledTimes(1);
      const call = mockConnectorCommandService.createCommand.mock.calls[0][0];
      expect(call.commandType).toBe('printer.print_kot.v1');
      expect(call.sourceAggregateType).toBe('PrinterJob');
      expect(call.sourceRecordId).toBe('job-1');
      expect(call.idempotencyKey).toBe('printer_job:job-1:attempt:0');
      expect(call.payload.contentChecksum).toEqual(expect.any(String));
      expect(call.payload.renderedContent).toEqual(expect.any(String));

      // First updateMany call is the claim — a guarded CAS, not unconditional.
      const claimCall = mockPrisma.printerJob.updateMany.mock.calls[0][0];
      expect(claimCall.where.id).toBe('job-1');
      expect(claimCall.where.status).toBe(PrintJobStatus.queued);
      expect(claimCall.data.dispatchClaimId).toEqual(expect.any(String));
      // Claim never bumps dispatchAttemptCount — see the service's own note
      // on why the idempotencyKey must be computed pre-increment.
      expect(claimCall.data.dispatchAttemptCount).toBeUndefined();

      // Last updateMany call is the confirm, guarded on this exact claim id.
      const confirmCall =
        mockPrisma.printerJob.updateMany.mock.calls[
          mockPrisma.printerJob.updateMany.mock.calls.length - 1
        ][0];
      expect(confirmCall.where.id).toBe('job-1');
      expect(confirmCall.where.dispatchClaimId).toBe(claimCall.data.dispatchClaimId);
      expect(confirmCall.data.status).toBe(PrintJobStatus.connector_dispatched);
      expect(confirmCall.data.connectorCommandId).toBe('command-1');
    });

    it('a lost claim race (updateMany count 0) is a safe no-op — never creates a command', async () => {
      mockPrisma.printerJob.findMany.mockResolvedValueOnce([dispatchCandidate()]);
      mockPrisma.printerJob.updateMany.mockResolvedValueOnce({ count: 0 });

      const result = await service.sweepDispatch();

      expect(result.claimed).toBe(0);
      expect(result.dispatched).toBe(0);
      expect(mockConnectorCommandService.createCommand).not.toHaveBeenCalled();
    });

    it('a job whose order was cancelled is marked cancelled without ever being claimed', async () => {
      mockPrisma.printerJob.findMany.mockResolvedValueOnce([
        dispatchCandidate({
          order: { id: 'order-1', status: 'cancelled', tableNumber: '12', notes: null },
        }),
      ]);

      const result = await service.sweepDispatch();

      expect(result.markedCancelled).toBe(1);
      expect(mockConnectorCommandService.createCommand).not.toHaveBeenCalled();
      const call = mockPrisma.printerJob.updateMany.mock.calls[0][0];
      expect(call.data.status).toBe(PrintJobStatus.cancelled);
    });

    it('a job whose printer was deactivated after creation is marked manual, not dispatched', async () => {
      mockPrisma.printerJob.findMany.mockResolvedValueOnce([
        dispatchCandidate({
          printer: {
            id: 'printer-1',
            isActive: false,
            name: 'Kitchen',
            type: 'kitchen',
            charPerLine: 42,
          },
        }),
      ]);

      const result = await service.sweepDispatch();

      expect(result.markedManual).toBe(1);
      expect(mockConnectorCommandService.createCommand).not.toHaveBeenCalled();
      const call = mockPrisma.printerJob.updateMany.mock.calls[0][0];
      expect(call.data.status).toBe(PrintJobStatus.manual);
    });

    it('a job whose dispatch attempt budget is already exhausted is marked manual, never claimed', async () => {
      mockPrisma.printerJob.findMany.mockResolvedValueOnce([
        dispatchCandidate({ dispatchAttemptCount: 999 }),
      ]);

      const result = await service.sweepDispatch();

      expect(result.exhausted).toBe(1);
      expect(mockConnectorCommandService.createCommand).not.toHaveBeenCalled();
      const call = mockPrisma.printerJob.updateMany.mock.calls[0][0];
      expect(call.data.status).toBe(PrintJobStatus.manual);
      expect(call.data.dispatchExhaustedAt).toEqual(expect.any(Date));
    });

    it('a command-creation failure records a sanitized error and does not confirm dispatch', async () => {
      mockPrisma.printerJob.findMany.mockResolvedValueOnce([dispatchCandidate()]);
      mockConnectorCommandService.createCommand.mockRejectedValueOnce(
        new Error('connection refused to 10.0.0.5:5432 with password hunter2'),
      );

      const result = await service.sweepDispatch();

      expect(result.dispatchFailed).toBe(1);
      const errorCall = findUpdateManyCallWithError(mockPrisma.printerJob.updateMany.mock.calls);
      expect(errorCall?.data.lastDispatchError).toContain('Command creation failed');
    });

    it('never persists the raw error message into lastDispatchError — independent-review regression (host/port/password must not leak through the admin API)', async () => {
      mockPrisma.printerJob.findMany.mockResolvedValueOnce([dispatchCandidate()]);
      mockConnectorCommandService.createCommand.mockRejectedValueOnce(
        new Error('connection refused to 10.0.0.5:5432 with password hunter2'),
      );

      await service.sweepDispatch();

      const errorCall = findUpdateManyCallWithError(mockPrisma.printerJob.updateMany.mock.calls);
      const persisted = errorCall?.data.lastDispatchError as string;
      expect(persisted).not.toContain('10.0.0.5');
      expect(persisted).not.toContain('hunter2');
      expect(persisted).not.toContain('5432');
    });

    it('a BadRequestException (already app-authored/user-safe) is passed through verbatim', async () => {
      mockPrisma.printerJob.findMany.mockResolvedValueOnce([dispatchCandidate()]);
      mockConnectorCommandService.createCommand.mockRejectedValueOnce(
        new BadRequestException('Command payload exceeds the maximum allowed size'),
      );

      await service.sweepDispatch();

      const errorCall = findUpdateManyCallWithError(mockPrisma.printerJob.updateMany.mock.calls);
      expect(errorCall?.data.lastDispatchError).toContain(
        'Command payload exceeds the maximum allowed size',
      );
    });
  });

  describe('sweepReconcile', () => {
    function reconcileRow(
      command: Record<string, unknown>,
      overrides: Record<string, unknown> = {},
    ) {
      return {
        id: 'job-1',
        connectorCommandId: 'command-1',
        dispatchAttemptCount: 1,
        connectorCommand: {
          id: 'command-1',
          status: ConnectorCommandStatus.pending,
          resultType: null,
          failureReason: null,
          ...command,
        },
        ...overrides,
      };
    }

    it('maps a succeeded command to delivered', async () => {
      mockPrisma.printerJob.findMany.mockResolvedValueOnce([
        reconcileRow({
          status: ConnectorCommandStatus.succeeded,
          resultType: KOT_RESULT_TYPE.EXECUTED_ACKNOWLEDGED,
        }),
      ]);

      const result = await service.sweepReconcile();

      expect(result.delivered).toBe(1);
      const call = mockPrisma.printerJob.updateMany.mock.calls[0][0];
      expect(call.where.status).toBe(PrintJobStatus.connector_dispatched);
      expect(call.where.connectorCommandId).toBe('command-1');
      expect(call.data.status).toBe(PrintJobStatus.delivered);
    });

    it('a succeeded command with an unexpected/missing resultType fails safe to uncertain, never delivered (independent-review regression)', async () => {
      mockPrisma.printerJob.findMany.mockResolvedValueOnce([
        reconcileRow({ status: ConnectorCommandStatus.succeeded, resultType: 'something_else' }),
      ]);

      const result = await service.sweepReconcile();

      expect(result.delivered).toBe(0);
      expect(result.uncertain).toBe(1);
      const call = mockPrisma.printerJob.updateMany.mock.calls[0][0];
      expect(call.data.status).toBe(PrintJobStatus.uncertain);
    });

    it('a succeeded command with a null resultType also fails safe to uncertain, never delivered', async () => {
      mockPrisma.printerJob.findMany.mockResolvedValueOnce([
        reconcileRow({ status: ConnectorCommandStatus.succeeded, resultType: null }),
      ]);

      const result = await service.sweepReconcile();

      expect(result.delivered).toBe(0);
      expect(result.uncertain).toBe(1);
    });

    it('maps an unknown command (accepted, no terminal report) to uncertain — never auto-retried', async () => {
      mockPrisma.printerJob.findMany.mockResolvedValueOnce([
        reconcileRow({ status: ConnectorCommandStatus.unknown }),
      ]);

      const result = await service.sweepReconcile();

      expect(result.uncertain).toBe(1);
      const call = mockPrisma.printerJob.updateMany.mock.calls[0][0];
      expect(call.data.status).toBe(PrintJobStatus.uncertain);
    });

    it('maps a retryable_local_failure within budget back to queued for a fresh attempt', async () => {
      mockPrisma.printerJob.findMany.mockResolvedValueOnce([
        reconcileRow(
          {
            status: ConnectorCommandStatus.failed,
            resultType: KOT_RESULT_TYPE.RETRYABLE_LOCAL_FAILURE,
          },
          { dispatchAttemptCount: 1 },
        ),
      ]);

      const result = await service.sweepReconcile();

      expect(result.retried).toBe(1);
      const call = mockPrisma.printerJob.updateMany.mock.calls[0][0];
      expect(call.data.status).toBe(PrintJobStatus.queued);
      expect(call.data.dispatchClaimId).toBeNull();
    });

    it('maps a retryable_local_failure past budget to terminal failed, not another retry', async () => {
      mockPrisma.printerJob.findMany.mockResolvedValueOnce([
        reconcileRow(
          {
            status: ConnectorCommandStatus.failed,
            resultType: KOT_RESULT_TYPE.RETRYABLE_LOCAL_FAILURE,
          },
          { dispatchAttemptCount: 999 },
        ),
      ]);

      const result = await service.sweepReconcile();

      expect(result.failed).toBe(1);
      expect(result.retried).toBe(0);
      const call = mockPrisma.printerJob.updateMany.mock.calls[0][0];
      expect(call.data.status).toBe(PrintJobStatus.failed);
    });

    it('maps expired (never accepted) the same as a confirmed-not-executed retryable failure', async () => {
      mockPrisma.printerJob.findMany.mockResolvedValueOnce([
        reconcileRow({ status: ConnectorCommandStatus.expired }, { dispatchAttemptCount: 1 }),
      ]);

      const result = await service.sweepReconcile();

      expect(result.retried).toBe(1);
    });

    it('maps unsupported to manual, never retried', async () => {
      mockPrisma.printerJob.findMany.mockResolvedValueOnce([
        reconcileRow({
          status: ConnectorCommandStatus.failed,
          resultType: KOT_RESULT_TYPE.UNSUPPORTED,
        }),
      ]);

      const result = await service.sweepReconcile();

      expect(result.manual).toBe(1);
      expect(result.retried).toBe(0);
    });

    it('maps checksum_mismatch to terminal failed, never retried', async () => {
      mockPrisma.printerJob.findMany.mockResolvedValueOnce([
        reconcileRow({
          status: ConnectorCommandStatus.failed,
          resultType: KOT_RESULT_TYPE.CHECKSUM_MISMATCH,
        }),
      ]);

      const result = await service.sweepReconcile();

      expect(result.failed).toBe(1);
      expect(result.retried).toBe(0);
    });

    it('maps an unrecognized failed resultType to manual, failing closed rather than guessing', async () => {
      mockPrisma.printerJob.findMany.mockResolvedValueOnce([
        reconcileRow({ status: ConnectorCommandStatus.failed, resultType: 'totally_unknown_code' }),
      ]);

      const result = await service.sweepReconcile();

      expect(result.manual).toBe(1);
    });

    it('maps cancelled to cancelled', async () => {
      mockPrisma.printerJob.findMany.mockResolvedValueOnce([
        reconcileRow({ status: ConnectorCommandStatus.cancelled }),
      ]);
      const result = await service.sweepReconcile();
      expect(result.cancelled).toBe(1);
    });

    it('does nothing for a command still genuinely in flight (pending/claimed/accepted)', async () => {
      mockPrisma.printerJob.findMany.mockResolvedValueOnce([
        reconcileRow({ status: ConnectorCommandStatus.accepted }),
      ]);
      const result = await service.sweepReconcile();
      expect(
        result.delivered +
          result.retried +
          result.manual +
          result.failed +
          result.uncertain +
          result.cancelled,
      ).toBe(0);
      expect(mockPrisma.printerJob.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('DL-069 regression: this producer never opens a direct socket', () => {
    it('the service source never imports node:net or injects a BullMQ queue (doc-comment mentions of these terms are fine — only real usage syntax is checked)', () => {
      const source = fs.readFileSync(path.join(__dirname, 'printer-dispatcher.service.ts'), 'utf8');
      expect(source).not.toMatch(/import\s+\*\s+as\s+net\s+from\s+'net'|require\(['"]net['"]\)/);
      expect(source).not.toMatch(/new\s+net\.Socket\s*\(|\.createConnection\s*\(/);
      expect(source).not.toMatch(/@InjectQueue/);
    });
  });
});
