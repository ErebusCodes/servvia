import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrinterJobsService } from './printer-jobs.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService } from '../audit/audit.service';
import { PrintJobStatus, StaffRole } from '@prisma/client';

const mockPrisma: any = {
  printer: { findFirst: jest.fn() },
  order: { findFirst: jest.fn() },
  printerJob: {
    findFirst: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    updateMany: jest.fn(),
    findUniqueOrThrow: jest.fn(),
  },
  $executeRaw: jest.fn(),
  $transaction: jest.fn((cb: any) => cb(mockPrisma)),
};

const mockAuditLog = { logAuthEvent: jest.fn() };

const orgId = 'org-1';
const venueId = 'venue-1';
const actor = { id: 'staff-1', email: 'staff@verdura.co.nz', role: StaffRole.manager };

describe('PrinterJobsService', () => {
  let service: PrinterJobsService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PrinterJobsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AuditLogService, useValue: mockAuditLog },
      ],
    }).compile();
    service = module.get<PrinterJobsService>(PrinterJobsService);
  });

  describe('listForPrinter', () => {
    it('rejects a printer outside the caller org/venue scope with 404, disclosing nothing', async () => {
      mockPrisma.printer.findFirst.mockResolvedValue(null);
      await expect(service.listForPrinter('printer-1', orgId, venueId)).rejects.toThrow(
        NotFoundException,
      );
      expect(mockPrisma.printerJob.findMany).not.toHaveBeenCalled();
    });

    it('rejects an invalid status filter', async () => {
      mockPrisma.printer.findFirst.mockResolvedValue({ id: 'printer-1' });
      await expect(
        service.listForPrinter('printer-1', orgId, venueId, 'not-a-real-status'),
      ).rejects.toThrow(BadRequestException);
    });

    it('lists jobs scoped to the printer once ownership is confirmed', async () => {
      mockPrisma.printer.findFirst.mockResolvedValue({ id: 'printer-1' });
      mockPrisma.printerJob.findMany.mockResolvedValue([{ id: 'job-1' }]);
      const result = await service.listForPrinter('printer-1', orgId, venueId, 'delivered');
      expect(result).toEqual([{ id: 'job-1' }]);
      expect(mockPrisma.printerJob.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { printerId: 'printer-1', status: PrintJobStatus.delivered },
        }),
      );
    });
  });

  describe('listForOrder', () => {
    it('rejects an order outside the caller org/venue scope with 404', async () => {
      mockPrisma.order.findFirst.mockResolvedValue(null);
      await expect(service.listForOrder('order-1', orgId, venueId)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('requestReprint', () => {
    it('rejects an unknown/out-of-scope job with 404', async () => {
      mockPrisma.printerJob.findFirst.mockResolvedValue(null);
      await expect(
        service.requestReprint('printer-1', 'job-1', orgId, venueId, actor),
      ).rejects.toThrow(NotFoundException);
      expect(mockPrisma.printerJob.create).not.toHaveBeenCalled();
    });

    it.each([PrintJobStatus.queued, PrintJobStatus.accepted, PrintJobStatus.dispatching])(
      'rejects reprinting a job still in flight (%s)',
      async (status) => {
        mockPrisma.printerJob.findFirst.mockResolvedValue({
          id: 'job-1',
          printerId: 'printer-1',
          venueId,
          status,
        });
        await expect(
          service.requestReprint('printer-1', 'job-1', orgId, venueId, actor),
        ).rejects.toThrow(ConflictException);
        expect(mockPrisma.printerJob.create).not.toHaveBeenCalled();
      },
    );

    it.each([
      PrintJobStatus.delivered,
      PrintJobStatus.printed,
      PrintJobStatus.manual,
      PrintJobStatus.failed,
      PrintJobStatus.uncertain,
      PrintJobStatus.cancelled,
    ])('creates a new linked, audited reprint job for a terminal job (%s)', async (status) => {
      const original = {
        id: 'job-1',
        printerId: 'printer-1',
        orderId: 'order-1',
        venueId,
        status,
        payload: 'ORIGINAL PAYLOAD',
        payloadFormat: 'raw_text',
      };
      // First call: the outer "does this job exist / is it terminal" fetch.
      // Second call: the in-flight-reprint check inside the transaction —
      // null means no reprint is currently in progress for this original.
      mockPrisma.printerJob.findFirst.mockResolvedValueOnce(original).mockResolvedValueOnce(null);
      // Re-validation read inside the transaction, after the row lock — see
      // requestReprint's own doc comment on why this re-read exists.
      mockPrisma.printerJob.findUniqueOrThrow.mockResolvedValueOnce(original);
      mockPrisma.printerJob.create.mockResolvedValue({ ...original, id: 'job-2' });

      const result = await service.requestReprint('printer-1', 'job-1', orgId, venueId, actor);

      expect(mockPrisma.printerJob.create).toHaveBeenCalledWith({
        data: {
          printerId: 'printer-1',
          orderId: 'order-1',
          venueId,
          status: PrintJobStatus.queued,
          payload: 'ORIGINAL PAYLOAD',
          payloadFormat: 'raw_text',
          reprintOfId: 'job-1',
          reprintRequestedById: 'staff-1',
        },
      });
      expect(mockAuditLog.logAuthEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'PRINTER_JOB_REPRINT_REQUESTED',
          actorId: 'staff-1',
          resourceId: 'job-2',
        }),
      );
      expect(result.id).toBe('job-2');
    });

    it('a transient audit-log failure does not fail the reprint request itself', async () => {
      const original = {
        id: 'job-1',
        printerId: 'printer-1',
        orderId: 'order-1',
        venueId,
        status: PrintJobStatus.failed,
        payload: 'x',
        payloadFormat: 'raw_text',
      };
      mockPrisma.printerJob.findFirst.mockResolvedValueOnce(original).mockResolvedValueOnce(null);
      mockPrisma.printerJob.findUniqueOrThrow.mockResolvedValueOnce(original);
      mockPrisma.printerJob.create.mockResolvedValue({ id: 'job-2' });
      mockAuditLog.logAuthEvent.mockRejectedValue(new Error('audit db down'));

      const result = await service.requestReprint('printer-1', 'job-1', orgId, venueId, actor);
      expect(result.id).toBe('job-2');
    });

    it('locks the original row and rejects when a reprint is already in flight (concurrent-duplicate guard)', async () => {
      // Regression test for the independent-review finding: the original
      // implementation was a plain check-then-create with a TOCTOU gap.
      // The lock (`$executeRaw ... FOR UPDATE`) plus a re-check inside the
      // same transaction is what makes this database-enforced rather than
      // an app-level pre-check.
      const original = {
        id: 'job-1',
        printerId: 'printer-1',
        orderId: 'order-1',
        venueId,
        status: PrintJobStatus.failed,
        payload: 'x',
        payloadFormat: 'raw_text',
      };
      mockPrisma.printerJob.findFirst
        .mockResolvedValueOnce(original)
        .mockResolvedValueOnce({ id: 'existing-reprint', status: PrintJobStatus.queued });
      mockPrisma.printerJob.findUniqueOrThrow.mockResolvedValueOnce(original);

      await expect(
        service.requestReprint('printer-1', 'job-1', orgId, venueId, actor),
      ).rejects.toThrow(ConflictException);

      expect(mockPrisma.$executeRaw).toHaveBeenCalled();
      expect(mockPrisma.printerJob.create).not.toHaveBeenCalled();
    });

    it('a concurrent status change between the outer read and the lock is caught by the in-transaction re-check — independent-review P1 regression (reprint-vs-retryDispatch duplicate-ticket race)', async () => {
      // Simulates: the outer findFirst reads `manual` (reprintable), then a
      // concurrent retryDispatch() call moves the SAME row to `queued`
      // before this transaction acquires its row lock. The re-read inside
      // the transaction (after the lock) must see the CURRENT status and
      // reject — the stale outer read alone is not a safe guard.
      const staleRead = {
        id: 'job-1',
        printerId: 'printer-1',
        orderId: 'order-1',
        venueId,
        status: PrintJobStatus.manual,
        payload: 'x',
        payloadFormat: 'raw_text',
      };
      const currentRowAfterLock = { ...staleRead, status: PrintJobStatus.queued };
      mockPrisma.printerJob.findFirst.mockResolvedValueOnce(staleRead);
      mockPrisma.printerJob.findUniqueOrThrow.mockResolvedValueOnce(currentRowAfterLock);

      await expect(
        service.requestReprint('printer-1', 'job-1', orgId, venueId, actor),
      ).rejects.toThrow(ConflictException);

      expect(mockPrisma.printerJob.create).not.toHaveBeenCalled();
    });
  });

  describe('retryDispatch', () => {
    it('rejects a job outside the caller org/venue scope with 404', async () => {
      mockPrisma.printerJob.findFirst.mockResolvedValue(null);
      await expect(
        service.retryDispatch('printer-1', 'job-1', orgId, venueId, actor),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejects a job that is not `manual` — must use reprint instead', async () => {
      mockPrisma.printerJob.findFirst.mockResolvedValue({
        id: 'job-1',
        venueId,
        status: PrintJobStatus.delivered,
      });
      await expect(
        service.retryDispatch('printer-1', 'job-1', orgId, venueId, actor),
      ).rejects.toThrow(ConflictException);
      expect(mockPrisma.printerJob.updateMany).not.toHaveBeenCalled();
    });

    it('resets a manual job to queued in place (no new row) via a CAS-guarded update, and audits it', async () => {
      // First findFirst call: outer read. Second findFirst call: the
      // in-flight-reprint check inside the transaction — null means no
      // reprint is currently in progress for this job.
      mockPrisma.printerJob.findFirst
        .mockResolvedValueOnce({ id: 'job-1', venueId, status: PrintJobStatus.manual })
        .mockResolvedValueOnce(null);
      mockPrisma.printerJob.updateMany.mockResolvedValue({ count: 1 });
      // Re-check inside the transaction, after the lock: findUniqueOrThrow
      // called once, then the final return-value read after the transaction
      // commits: called twice total.
      mockPrisma.printerJob.findUniqueOrThrow
        .mockResolvedValueOnce({ id: 'job-1', status: PrintJobStatus.manual })
        .mockResolvedValueOnce({ id: 'job-1', status: PrintJobStatus.queued });

      const result = await service.retryDispatch('printer-1', 'job-1', orgId, venueId, actor);

      expect(mockPrisma.printerJob.create).not.toHaveBeenCalled();
      const call = mockPrisma.printerJob.updateMany.mock.calls[0][0];
      expect(call.where).toEqual({ id: 'job-1', status: PrintJobStatus.manual });
      expect(call.data.status).toBe(PrintJobStatus.queued);
      expect(call.data.dispatchExhaustedAt).toBeNull();
      expect(mockAuditLog.logAuthEvent).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'PRINTER_JOB_MANUAL_RETRY_REQUESTED' }),
      );
      expect(result.status).toBe(PrintJobStatus.queued);
    });

    it('a lost CAS race (job moved on concurrently) is rejected, not silently reopened', async () => {
      mockPrisma.printerJob.findFirst
        .mockResolvedValueOnce({ id: 'job-1', venueId, status: PrintJobStatus.manual })
        .mockResolvedValueOnce(null);
      mockPrisma.printerJob.findUniqueOrThrow.mockResolvedValueOnce({
        id: 'job-1',
        status: PrintJobStatus.manual,
      });
      mockPrisma.printerJob.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.retryDispatch('printer-1', 'job-1', orgId, venueId, actor),
      ).rejects.toThrow(ConflictException);
    });

    it('rejects retrying in place when a reprint of this job is already in flight', async () => {
      mockPrisma.printerJob.findFirst
        .mockResolvedValueOnce({ id: 'job-1', venueId, status: PrintJobStatus.manual })
        .mockResolvedValueOnce({ id: 'reprint-1', status: PrintJobStatus.queued });
      mockPrisma.printerJob.findUniqueOrThrow.mockResolvedValueOnce({
        id: 'job-1',
        status: PrintJobStatus.manual,
      });

      await expect(
        service.retryDispatch('printer-1', 'job-1', orgId, venueId, actor),
      ).rejects.toThrow(ConflictException);
      expect(mockPrisma.printerJob.updateMany).not.toHaveBeenCalled();
    });
  });
});
