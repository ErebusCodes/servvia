import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import * as net from 'net';
import { PrintJobsProcessor } from './print-jobs.processor';
import { PrismaService } from '../../prisma/prisma.service';
import { PrintJobStatus, PrinterConnectionType } from '@prisma/client';

const mockPrisma: any = {
  printerJob: {
    findUnique: jest.fn(),
    findUniqueOrThrow: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
  },
};

const mockConfig = { get: jest.fn() };

function job(printerJobId: string) {
  return { data: { printerJobId } } as any;
}

function baseDbJob(overrides: Record<string, unknown> = {}) {
  return {
    id: 'job-1',
    printerId: 'printer-1',
    orderId: 'order-1',
    venueId: 'venue-1',
    status: PrintJobStatus.queued,
    payload: 'ticket text',
    payloadFormat: 'raw_text',
    attemptCount: 0,
    maxAttempts: 3,
    printer: {
      id: 'printer-1',
      connectionType: PrinterConnectionType.tcp,
      host: '10.0.0.5',
      port: 9100,
    },
    ...overrides,
  };
}

describe('PrintJobsProcessor', () => {
  let processor: PrintJobsProcessor;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockConfig.get.mockReturnValue('test');
    mockPrisma.printerJob.updateMany.mockResolvedValue({ count: 1 });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PrintJobsProcessor,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ConfigService, useValue: mockConfig },
      ],
    }).compile();

    processor = module.get<PrintJobsProcessor>(PrintJobsProcessor);
  });

  describe('unsupported connection types never fabricate success', () => {
    it.each([PrinterConnectionType.usb, PrinterConnectionType.windows_shared])(
      '%s printers become manual, never printed, with no transport attempt',
      async (connectionType) => {
        mockPrisma.printerJob.findUnique.mockResolvedValue(
          baseDbJob({ printer: { id: 'printer-1', connectionType, host: null, port: null } }),
        );
        mockPrisma.printerJob.findUniqueOrThrow.mockResolvedValue(baseDbJob({ attemptCount: 1 }));

        await processor.process(job('job-1'));

        expect(mockPrisma.printerJob.updateMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { id: 'job-1', status: PrintJobStatus.accepted },
            data: expect.objectContaining({ status: PrintJobStatus.manual }),
          }),
        );
        const calledStatuses = mockPrisma.printerJob.updateMany.mock.calls.map(
          (c: any) => c[0].data.status,
        );
        expect(calledStatuses).not.toContain(PrintJobStatus.printed);
      },
    );
  });

  describe('production mock lockout', () => {
    it('a simulated connection type fails closed in production, never delivered or printed', async () => {
      mockConfig.get.mockReturnValue('production');
      mockPrisma.printerJob.findUnique.mockResolvedValue(
        baseDbJob({
          printer: { id: 'printer-1', connectionType: PrinterConnectionType.simulated },
        }),
      );
      mockPrisma.printerJob.findUniqueOrThrow.mockResolvedValue(baseDbJob({ attemptCount: 1 }));

      await processor.process(job('job-1'));

      expect(mockPrisma.printerJob.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'job-1', status: PrintJobStatus.accepted },
          data: expect.objectContaining({ status: PrintJobStatus.failed }),
        }),
      );
      // Never reaches `dispatching` at all in production — fails closed
      // before any transport-shaped write occurs.
      expect(mockPrisma.printerJob.updateMany).not.toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: PrintJobStatus.dispatching }),
        }),
      );
    });

    it('a simulated connection type reaches delivered (never printed) outside production', async () => {
      mockConfig.get.mockReturnValue('test');
      mockPrisma.printerJob.findUnique.mockResolvedValue(
        baseDbJob({
          printer: { id: 'printer-1', connectionType: PrinterConnectionType.simulated },
        }),
      );
      mockPrisma.printerJob.findUniqueOrThrow.mockResolvedValue(baseDbJob({ attemptCount: 1 }));

      await processor.process(job('job-1'));

      expect(mockPrisma.printerJob.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'job-1', status: PrintJobStatus.accepted },
          data: expect.objectContaining({ status: PrintJobStatus.dispatching }),
        }),
      );
      expect(mockPrisma.printerJob.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'job-1', status: PrintJobStatus.dispatching },
          data: expect.objectContaining({ status: PrintJobStatus.delivered }),
        }),
      );
      const allStatuses = [
        ...mockPrisma.printerJob.update.mock.calls.map((c: any) => c[0].data.status),
        ...mockPrisma.printerJob.updateMany.mock.calls.map((c: any) => c[0].data.status),
      ];
      expect(allStatuses).not.toContain(PrintJobStatus.printed);
    });
  });

  describe('TCP transport truthfulness', () => {
    let server: net.Server;
    let port: number;

    afterEach(async () => {
      if (server) {
        await new Promise((resolve) => server.close(resolve));
      }
    });

    it('a successful socket write sets delivered, never printed', async () => {
      server = net.createServer((socket) => {
        socket.on('data', () => socket.end());
      });
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
      port = (server.address() as net.AddressInfo).port;

      mockPrisma.printerJob.findUnique.mockResolvedValue(
        baseDbJob({
          printer: {
            id: 'printer-1',
            connectionType: PrinterConnectionType.tcp,
            host: '127.0.0.1',
            port,
          },
        }),
      );
      mockPrisma.printerJob.findUniqueOrThrow.mockResolvedValue(baseDbJob({ attemptCount: 1 }));

      await processor.process(job('job-1'));

      expect(mockPrisma.printerJob.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'job-1', status: PrintJobStatus.accepted },
          data: expect.objectContaining({ status: PrintJobStatus.dispatching }),
        }),
      );
      expect(mockPrisma.printerJob.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'job-1', status: PrintJobStatus.dispatching },
          data: expect.objectContaining({ status: PrintJobStatus.delivered }),
        }),
      );
    });

    it('a connection failure yields a sanitized, non-leaking error and a retryable status', async () => {
      // Nothing listening on this port.
      mockPrisma.printerJob.findUnique.mockResolvedValue(
        baseDbJob({
          printer: {
            id: 'printer-1',
            connectionType: PrinterConnectionType.tcp,
            host: '127.0.0.1',
            port: 1,
          },
        }),
      );
      mockPrisma.printerJob.findUniqueOrThrow.mockResolvedValue(baseDbJob({ attemptCount: 1 }));

      await expect(processor.process(job('job-1'))).rejects.toThrow();

      const failureUpdate = mockPrisma.printerJob.updateMany.mock.calls.find(
        (c: any) => c[0].data.status === PrintJobStatus.queued,
      );
      expect(failureUpdate).toBeDefined();
      const message: string = failureUpdate[0].data.errorMessage;
      expect(message).not.toMatch(/127\.0\.0\.1/);
      expect(message).not.toMatch(/:\d+/);
    });

    it('exhausting max attempts marks the job failed, not left retryable forever', async () => {
      mockPrisma.printerJob.findUnique.mockResolvedValue(
        baseDbJob({
          printer: {
            id: 'printer-1',
            connectionType: PrinterConnectionType.tcp,
            host: '127.0.0.1',
            port: 1,
          },
        }),
      );
      mockPrisma.printerJob.findUniqueOrThrow.mockResolvedValue(
        baseDbJob({ attemptCount: 3, maxAttempts: 3 }),
      );

      await expect(processor.process(job('job-1'))).rejects.toThrow();

      const failureUpdate = mockPrisma.printerJob.updateMany.mock.calls.find(
        (c: any) => c[0].data.status === PrintJobStatus.failed,
      );
      expect(failureUpdate).toBeDefined();
    });

    it('a missing host configuration never leaks into the stored error message', async () => {
      mockPrisma.printerJob.findUnique.mockResolvedValue(
        baseDbJob({
          printer: { id: 'printer-1', connectionType: PrinterConnectionType.tcp, host: null },
        }),
      );
      mockPrisma.printerJob.findUniqueOrThrow.mockResolvedValue(baseDbJob({ attemptCount: 1 }));

      await expect(processor.process(job('job-1'))).rejects.toThrow();

      const failureUpdate = mockPrisma.printerJob.updateMany.mock.calls.find(
        (c: any) => c[0].data.status === PrintJobStatus.queued,
      );
      expect(failureUpdate[0].data.errorMessage).toBe(
        'Printer connection is not configured with a host address.',
      );
    });
  });

  describe('duplicate delivery and crash-window handling', () => {
    it('finding the job already `dispatching` marks it uncertain and attempts no transport', async () => {
      mockPrisma.printerJob.findUnique.mockResolvedValue(
        baseDbJob({ status: PrintJobStatus.dispatching }),
      );
      mockPrisma.printerJob.updateMany.mockResolvedValue({ count: 1 });

      await processor.process(job('job-1'));

      expect(mockPrisma.printerJob.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'job-1', status: PrintJobStatus.dispatching },
          data: expect.objectContaining({ status: PrintJobStatus.uncertain }),
        }),
      );
      // No transport-side update() calls — process() returned immediately
      // after the compare-and-swap.
      expect(mockPrisma.printerJob.update).not.toHaveBeenCalled();
    });

    it('finding the job already `accepted` on re-observation marks it uncertain rather than leaving it permanently stranded', async () => {
      // Regression test: a worker that claims a job (queued -> accepted)
      // and then crashes before ever reaching `dispatching` used to leave
      // the row silently unreachable forever (no automatic re-processing,
      // and `accepted` was also excluded from reprintable statuses).
      mockPrisma.printerJob.findUnique.mockResolvedValue(
        baseDbJob({ status: PrintJobStatus.accepted }),
      );
      mockPrisma.printerJob.updateMany.mockResolvedValue({ count: 1 });

      await processor.process(job('job-1'));

      expect(mockPrisma.printerJob.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'job-1', status: PrintJobStatus.accepted },
          data: expect.objectContaining({ status: PrintJobStatus.uncertain }),
        }),
      );
      expect(mockPrisma.printerJob.update).not.toHaveBeenCalled();
    });

    it('the write that follows the claim (accepted -> manual/dispatching/failed) cannot overwrite an `uncertain` marker raised while this worker was merely slow', async () => {
      // Regression test for a follow-up finding from independent
      // re-verification: the first fix guarded writes leaving `dispatching`,
      // but every write leaving the just-claimed `accepted` state (manual,
      // the accepted->dispatching transition, failed-for-simulated-in-prod,
      // failed-for-unrecognised-type) was still a plain update() — the same
      // bug class, one step earlier. Simulate: this worker wins the claim,
      // but by the time it tries to record its first post-claim outcome, a
      // concurrent observer has already flagged the row `uncertain` (count:
      // 0 on the guarded write).
      mockPrisma.printerJob.findUnique.mockResolvedValue(
        baseDbJob({
          printer: {
            id: 'printer-1',
            connectionType: PrinterConnectionType.usb,
            host: null,
            port: null,
          },
        }),
      );
      mockPrisma.printerJob.findUniqueOrThrow.mockResolvedValue(baseDbJob({ attemptCount: 1 }));
      mockPrisma.printerJob.updateMany
        .mockResolvedValueOnce({ count: 1 }) // queued -> accepted claim
        .mockResolvedValueOnce({ count: 0 }); // accepted -> manual: lost the race

      await processor.process(job('job-1'));

      const manualWrite = mockPrisma.printerJob.updateMany.mock.calls.find(
        (c: any) => c[0].data.status === PrintJobStatus.manual,
      );
      expect(manualWrite).toBeDefined();
      expect(manualWrite[0].where).toEqual({ id: 'job-1', status: PrintJobStatus.accepted });
      // The call happened and was correctly guarded — its count:0 result
      // means the write had no effect, leaving `uncertain` standing. There
      // is nothing further to assert about the row's final state from the
      // mock's perspective; the guard existing and being checked first is
      // the property under test (see the real-Postgres equivalent for the
      // end-to-end row-state proof).
    });

    it('a slow-but-not-crashed worker cannot overwrite an `uncertain` marker raised while it was mid-flight', async () => {
      // Regression test for the independent-review P0: resolveFromDispatching
      // must be a real CAS. Simulate the exact race — by the time this
      // worker's own transport attempt finishes and tries to record its
      // outcome, a second observer has already flipped the row to
      // `uncertain` (status is no longer `dispatching`), so the guarded
      // updateMany affects zero rows. The `uncertain` classification must
      // stand; a plain unconditional update() would have clobbered it.
      const server: net.Server = net.createServer((socket) => {
        socket.on('data', () => socket.end());
      });
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
      const port = (server.address() as net.AddressInfo).port;

      mockPrisma.printerJob.findUnique.mockResolvedValue(
        baseDbJob({
          printer: {
            id: 'printer-1',
            connectionType: PrinterConnectionType.tcp,
            host: '127.0.0.1',
            port,
          },
        }),
      );
      mockPrisma.printerJob.findUniqueOrThrow.mockResolvedValue(baseDbJob({ attemptCount: 1 }));
      // Call order: (1) the queued->accepted claim, (2) accepted->dispatching,
      // (3) dispatching->delivered — simulated here as having lost the race
      // (count: 0 — another observer already moved the row off `dispatching`
      // before this worker's own genuinely-successful write could land).
      mockPrisma.printerJob.updateMany
        .mockResolvedValueOnce({ count: 1 })
        .mockResolvedValueOnce({ count: 1 })
        .mockResolvedValueOnce({ count: 0 });

      await processor.process(job('job-1'));

      const terminalWrite = mockPrisma.printerJob.updateMany.mock.calls.find(
        (c: any) => c[0].data.status === PrintJobStatus.delivered,
      );
      expect(terminalWrite).toBeDefined();
      // Crucially: this call is itself CAS-guarded (status: dispatching in
      // its where clause) — it is the guard, not the outcome, that this
      // test proves exists. A plain update() would have no such guard.
      expect(terminalWrite[0].where).toEqual({ id: 'job-1', status: PrintJobStatus.dispatching });
      await new Promise((resolve) => server.close(resolve));
    });

    it('losing the queued-to-accepted claim race is a safe no-op (no double dispatch)', async () => {
      mockPrisma.printerJob.findUnique.mockResolvedValue(baseDbJob());
      mockPrisma.printerJob.updateMany.mockResolvedValue({ count: 0 });

      await processor.process(job('job-1'));

      expect(mockPrisma.printerJob.update).not.toHaveBeenCalled();
      expect(mockPrisma.printerJob.findUniqueOrThrow).not.toHaveBeenCalled();
    });

    it.each([
      PrintJobStatus.printed,
      PrintJobStatus.delivered,
      PrintJobStatus.manual,
      PrintJobStatus.failed,
      PrintJobStatus.cancelled,
      PrintJobStatus.uncertain,
    ])('a job already in terminal state %s is never re-processed', async (status) => {
      mockPrisma.printerJob.findUnique.mockResolvedValue(baseDbJob({ status }));

      await processor.process(job('job-1'));

      expect(mockPrisma.printerJob.update).not.toHaveBeenCalled();
      expect(mockPrisma.printerJob.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('unknown connection types fail closed', () => {
    it('never fabricates success for a connection type this processor does not recognise', async () => {
      mockPrisma.printerJob.findUnique.mockResolvedValue(
        baseDbJob({ printer: { id: 'printer-1', connectionType: 'future_type' as any } }),
      );
      mockPrisma.printerJob.findUniqueOrThrow.mockResolvedValue(baseDbJob({ attemptCount: 1 }));

      await processor.process(job('job-1'));

      expect(mockPrisma.printerJob.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'job-1', status: PrintJobStatus.accepted },
          data: expect.objectContaining({ status: PrintJobStatus.failed }),
        }),
      );
    });
  });

  it('a missing printerJobId is a no-op', async () => {
    await processor.process({ data: {} } as any);
    expect(mockPrisma.printerJob.findUnique).not.toHaveBeenCalled();
  });

  it('a job that no longer exists is a no-op', async () => {
    mockPrisma.printerJob.findUnique.mockResolvedValue(null);
    await processor.process(job('missing-job'));
    expect(mockPrisma.printerJob.updateMany).not.toHaveBeenCalled();
  });
});
