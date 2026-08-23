/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-return */
import { Test, TestingModule } from '@nestjs/testing';
import { PosSyncProcessor } from './pos-sync.processor';
import { PrismaService } from '../../prisma/prisma.service';
import { POSSyncStatus, POSAdapterType } from '@prisma/client';

const mockPrisma: any = {
  pOSSyncRecord: {
    findUnique: jest.fn(),
    updateMany: jest.fn(),
  },
  order: {
    updateMany: jest.fn(),
  },
  // Array-form transaction: both operations are already-invoked Prisma
  // promises by the time they reach here (matching real Prisma's API), so
  // resolving them together is a faithful enough mock for unit purposes.
  // The actual atomicity guarantee (a crash/interleaving between the two
  // writes can never leave them diverged) is proven against real Postgres
  // in test/pos-sync.integration-spec.ts, not here.
  $transaction: jest.fn((ops: unknown[]) => Promise.all(ops)),
};

function job(posSyncRecordId: string) {
  return { data: { posSyncRecordId } } as any;
}

function baseRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: 'record-1',
    orderId: 'order-1',
    venueId: 'venue-1',
    adapterType: POSAdapterType.api,
    status: POSSyncStatus.not_synced,
    posOrderId: null,
    attemptCount: 0,
    ...overrides,
  };
}

describe('PosSyncProcessor', () => {
  let processor: PosSyncProcessor;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockPrisma.pOSSyncRecord.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.order.updateMany.mockResolvedValue({ count: 1 });

    const module: TestingModule = await Test.createTestingModule({
      providers: [PosSyncProcessor, { provide: PrismaService, useValue: mockPrisma }],
    }).compile();

    processor = module.get<PosSyncProcessor>(PosSyncProcessor);
  });

  it('does nothing if posSyncRecordId is missing', async () => {
    await processor.process({ data: {} } as any);
    expect(mockPrisma.pOSSyncRecord.findUnique).not.toHaveBeenCalled();
  });

  it('does nothing if the record no longer exists', async () => {
    mockPrisma.pOSSyncRecord.findUnique.mockResolvedValue(null);
    await processor.process(job('record-1'));
    expect(mockPrisma.pOSSyncRecord.updateMany).not.toHaveBeenCalled();
  });

  describe('none-adapter venues never produce anything but not_applicable', () => {
    it('resolves a not_synced, none-adapter record to not_applicable with no posOrderId', async () => {
      mockPrisma.pOSSyncRecord.findUnique.mockResolvedValue(
        baseRecord({ adapterType: POSAdapterType.none }),
      );

      await processor.process(job('record-1'));

      expect(mockPrisma.pOSSyncRecord.updateMany).toHaveBeenCalledWith({
        where: { id: 'record-1', status: POSSyncStatus.not_synced },
        data: { status: POSSyncStatus.not_applicable, errorMessage: null },
      });
      expect(mockPrisma.order.updateMany).toHaveBeenCalledWith({
        where: { id: 'order-1', posSyncStatus: POSSyncStatus.not_synced },
        data: { posSyncStatus: POSSyncStatus.not_applicable },
      });
    });
  });

  describe('any real, unimplemented adapter type never produces synced or a fabricated posOrderId', () => {
    it.each([
      POSAdapterType.api,
      POSAdapterType.sql,
      POSAdapterType.odbc,
      POSAdapterType.csv,
      POSAdapterType.local_agent,
    ])(
      '%s resolves to unsupported, with an explicit reason and no posOrderId',
      async (adapterType) => {
        mockPrisma.pOSSyncRecord.findUnique.mockResolvedValue(baseRecord({ adapterType }));

        await processor.process(job('record-1'));

        expect(mockPrisma.pOSSyncRecord.updateMany).toHaveBeenCalledWith({
          where: { id: 'record-1', status: POSSyncStatus.not_synced },
          data: {
            status: POSSyncStatus.unsupported,
            errorMessage: expect.stringContaining(adapterType),
          },
        });
        const [[call]] = mockPrisma.pOSSyncRecord.updateMany.mock.calls;
        expect(call.data).not.toHaveProperty('posOrderId');
        expect(call.data.status).not.toBe(POSSyncStatus.synced);
      },
    );

    it('never calls updateMany with status: synced under any circumstance', async () => {
      for (const adapterType of [
        POSAdapterType.none,
        POSAdapterType.api,
        POSAdapterType.sql,
        POSAdapterType.odbc,
        POSAdapterType.csv,
        POSAdapterType.local_agent,
      ]) {
        mockPrisma.pOSSyncRecord.findUnique.mockResolvedValue(baseRecord({ adapterType }));
        await processor.process(job('record-1'));
      }
      const calledStatuses = mockPrisma.pOSSyncRecord.updateMany.mock.calls.map(
        (c: any) => c[0].data.status,
      );
      expect(calledStatuses).not.toContain(POSSyncStatus.synced);
      expect(calledStatuses).not.toContain(POSSyncStatus.failed);
    });
  });

  describe('terminal states are never re-processed', () => {
    it.each([
      POSSyncStatus.synced,
      POSSyncStatus.failed,
      POSSyncStatus.not_applicable,
      POSSyncStatus.unsupported,
    ])('a record already in %s is a safe no-op', async (status) => {
      mockPrisma.pOSSyncRecord.findUnique.mockResolvedValue(baseRecord({ status }));

      await processor.process(job('record-1'));

      expect(mockPrisma.pOSSyncRecord.updateMany).not.toHaveBeenCalled();
      expect(mockPrisma.order.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('duplicate/concurrent delivery safety', () => {
    it('issues the record write and the Order mirror write inside a single transaction, never as two independent round-trips', async () => {
      mockPrisma.pOSSyncRecord.findUnique.mockResolvedValue(baseRecord());

      await processor.process(job('record-1'));

      // Both writes must be batched into one $transaction([...]) call — not
      // two separate awaited calls — so a crash between them can never
      // leave POSSyncRecord.status terminal while Order.posSyncStatus is
      // stranded at not_synced forever (a P0 found in independent review:
      // once the record is terminal, reprocessing is a guaranteed no-op via
      // the terminal-state guard above, so nothing would ever revisit the
      // order to correct a stranded mirror).
      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
      expect(mockPrisma.pOSSyncRecord.updateMany).toHaveBeenCalledWith({
        where: { id: 'record-1', status: POSSyncStatus.not_synced },
        data: expect.objectContaining({ status: POSSyncStatus.unsupported }),
      });
      expect(mockPrisma.order.updateMany).toHaveBeenCalledWith({
        where: { id: 'order-1', posSyncStatus: POSSyncStatus.not_synced },
        data: { posSyncStatus: POSSyncStatus.unsupported },
      });
    });
  });

  it('never increments attemptCount or sets lastAttemptAt — no real submission attempt is ever made by this processor', async () => {
    mockPrisma.pOSSyncRecord.findUnique.mockResolvedValue(baseRecord());
    await processor.process(job('record-1'));
    const [[call]] = mockPrisma.pOSSyncRecord.updateMany.mock.calls;
    expect(call.data).not.toHaveProperty('attemptCount');
    expect(call.data).not.toHaveProperty('lastAttemptAt');
  });
});
