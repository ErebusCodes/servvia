/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-call */

import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { getQueueToken } from '@nestjs/bullmq';
import { PosSyncDispatcherService } from './pos-sync-dispatcher.service';
import { PrismaService } from '../prisma/prisma.service';
import { QUEUE_NAMES } from '../queue/queue.constants';

const mockPrisma: any = {
  pOSSyncRecord: {
    findMany: jest.fn(),
    updateMany: jest.fn(),
  },
};

const mockQueue: any = {
  add: jest.fn(),
};

function candidate(overrides: Record<string, unknown> = {}) {
  return {
    id: 'record-1',
    venueId: 'venue-1',
    orderId: 'order-1',
    dispatchAttemptCount: 0,
    ...overrides,
  };
}

describe('PosSyncDispatcherService', () => {
  let service: PosSyncDispatcherService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockPrisma.pOSSyncRecord.findMany.mockResolvedValue([]);
    mockPrisma.pOSSyncRecord.updateMany.mockResolvedValue({ count: 1 });
    mockQueue.add.mockResolvedValue({ id: 'job-1' });

    // process.env.NODE_ENV is already 'test' under Jest, so onModuleInit's
    // timer never starts — matching production behavior in every other
    // respect except the automatic timer (see the service's own doc
    // comment on why the timer must never run during the test suite).
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PosSyncDispatcherService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: getQueueToken(QUEUE_NAMES.POS_SYNC), useValue: mockQueue },
        { provide: ConfigService, useValue: { get: (_key: string, def?: unknown) => def } },
      ],
    }).compile();

    service = module.get<PosSyncDispatcherService>(PosSyncDispatcherService);
  });

  afterEach(() => {
    service.onModuleDestroy();
  });

  it('does nothing when there are no eligible candidates', async () => {
    const result = await service.sweep();
    expect(result).toEqual({
      eligible: 0,
      claimed: 0,
      published: 0,
      publishFailed: 0,
      exhausted: 0,
    });
    expect(mockQueue.add).not.toHaveBeenCalled();
  });

  it('the eligibility query never filters by venueId — this is a platform-wide sweep, not per-venue', async () => {
    await service.sweep();
    const where = mockPrisma.pOSSyncRecord.findMany.mock.calls[0][0].where;
    expect(where).not.toHaveProperty('venueId');
    expect(where.status).toBeDefined();
    expect(where.dispatchExhaustedAt).toBeNull();
  });

  it('claims a candidate, enqueues with a deterministic jobId, and marks it dispatched', async () => {
    mockPrisma.pOSSyncRecord.findMany.mockResolvedValueOnce([candidate()]);

    const result = await service.sweep();

    expect(result.claimed).toBe(1);
    expect(result.published).toBe(1);
    expect(mockQueue.add).toHaveBeenCalledWith(
      'sync-order',
      { posSyncRecordId: 'record-1' },
      { jobId: 'pos-sync-record-1' },
    );

    // First updateMany call is the claim; assert it is a guarded CAS, not
    // an unconditional write.
    const claimCall = mockPrisma.pOSSyncRecord.updateMany.mock.calls[0][0];
    expect(claimCall.where.id).toBe('record-1');
    expect(claimCall.where.status).toBe('not_synced');
    expect(claimCall.data.dispatchClaimId).toEqual(expect.any(String));
    expect(claimCall.data.dispatchedAt).toBeNull();

    // Second updateMany call confirms dispatch, guarded on the same claim id.
    const confirmCall = mockPrisma.pOSSyncRecord.updateMany.mock.calls[1][0];
    expect(confirmCall.where.id).toBe('record-1');
    expect(confirmCall.where.dispatchClaimId).toBe(claimCall.data.dispatchClaimId);
    expect(confirmCall.data.dispatchedAt).toEqual(expect.any(Date));
  });

  it('a lost claim race (updateMany count 0) is a safe no-op — never enqueues', async () => {
    mockPrisma.pOSSyncRecord.findMany.mockResolvedValueOnce([candidate()]);
    mockPrisma.pOSSyncRecord.updateMany.mockResolvedValueOnce({ count: 0 }); // claim lost

    const result = await service.sweep();

    expect(result.claimed).toBe(0);
    expect(result.published).toBe(0);
    expect(mockQueue.add).not.toHaveBeenCalled();
  });

  it('an enqueue failure records a sanitized lastDispatchError and does not mark dispatchedAt', async () => {
    mockPrisma.pOSSyncRecord.findMany.mockResolvedValueOnce([candidate()]);
    mockQueue.add.mockRejectedValueOnce(new Error('connect ECONNREFUSED 10.0.0.5:6379'.repeat(20)));

    const result = await service.sweep();

    expect(result.claimed).toBe(1);
    expect(result.published).toBe(0);
    expect(result.publishFailed).toBe(1);

    const errorWriteCall = mockPrisma.pOSSyncRecord.updateMany.mock.calls[1][0];
    expect(errorWriteCall.data.lastDispatchError).toMatch(/^Enqueue failed: connect ECONNREFUSED/);
    expect(errorWriteCall.data.lastDispatchError.length).toBeLessThan(400);
    expect(errorWriteCall.data.dispatchedAt).toBeUndefined();
  });

  it('an unexpected error processing one candidate does not abort the rest of the batch', async () => {
    mockPrisma.pOSSyncRecord.findMany.mockResolvedValueOnce([
      candidate({ id: 'poison-record' }),
      candidate({ id: 'record-2' }),
    ]);
    // First candidate's claim throws unexpectedly (not a normal enqueue
    // failure — simulates e.g. a transient DB error during the claim
    // itself); second candidate must still be processed normally.
    mockPrisma.pOSSyncRecord.updateMany
      .mockRejectedValueOnce(new Error('unexpected DB blip'))
      .mockResolvedValueOnce({ count: 1 }) // record-2 claim
      .mockResolvedValueOnce({ count: 1 }); // record-2 dispatch confirm

    const result = await service.sweep();

    expect(result.claimed).toBe(1);
    expect(result.published).toBe(1);
    expect(mockQueue.add).toHaveBeenCalledTimes(1);
    expect(mockQueue.add).toHaveBeenCalledWith(
      'sync-order',
      { posSyncRecordId: 'record-2' },
      { jobId: 'pos-sync-record-2' },
    );
  });

  it('a candidate whose dispatchAttemptCount already meets the budget is marked exhausted, never claimed for dispatch', async () => {
    mockPrisma.pOSSyncRecord.findMany.mockResolvedValueOnce([
      candidate({ dispatchAttemptCount: 20 }),
    ]);

    const result = await service.sweep();

    expect(result.exhausted).toBe(1);
    expect(result.claimed).toBe(0);
    expect(mockQueue.add).not.toHaveBeenCalled();

    const exhaustCall = mockPrisma.pOSSyncRecord.updateMany.mock.calls[0][0];
    expect(exhaustCall.data.dispatchExhaustedAt).toEqual(expect.any(Date));
    expect(exhaustCall.where.dispatchExhaustedAt).toBeNull();
  });

  it('never writes POSSyncRecord.status or Order.posSyncStatus under any circumstance', async () => {
    mockPrisma.pOSSyncRecord.findMany.mockResolvedValueOnce([candidate()]);
    mockPrisma.order = { updateMany: jest.fn() };

    await service.sweep();

    for (const call of mockPrisma.pOSSyncRecord.updateMany.mock.calls) {
      expect(call[0].data).not.toHaveProperty('status');
    }
    expect(mockPrisma.order.updateMany).not.toHaveBeenCalled();
  });

  it('never publishes to any queue other than pos-sync (print-jobs isolation, DL-069)', async () => {
    // Independent review (2026-08-16): the original version of this test
    // only checked the service's own property names for a hardcoded
    // 'printQueue' string, which proves nothing structural. The real,
    // meaningful proof that print-jobs is never touched is (a) this
    // service's constructor injects exactly one queue token
    // (getQueueToken(QUEUE_NAMES.POS_SYNC) — see the providers array in
    // beforeEach above, the only Queue this class can possibly call `add`
    // on), and (b) the real-Redis integration test
    // (pos-sync-dispatcher.integration-spec.ts, "print-jobs isolation"
    // describe block) that asserts the real print-jobs queue's job count is
    // unchanged after a real sweep. This unit test is retained only as a
    // cheap, fast smoke check that the single injected queue is actually
    // the one being called.
    mockPrisma.pOSSyncRecord.findMany.mockResolvedValueOnce([candidate()]);
    await service.sweep();
    expect(mockQueue.add).toHaveBeenCalledTimes(1);
  });

  it('a confirm-write failure after a successful enqueue (crash-after-send) does not throw, and the enqueue itself is not undone', async () => {
    mockPrisma.pOSSyncRecord.findMany.mockResolvedValueOnce([candidate()]);
    // Claim succeeds, enqueue succeeds, but the follow-up updateMany that
    // marks dispatchedAt throws (e.g. a transient DB error between the
    // enqueue and the confirmation write — the crash-after-send window).
    mockPrisma.pOSSyncRecord.updateMany
      .mockResolvedValueOnce({ count: 1 }) // claim
      .mockRejectedValueOnce(new Error('transient DB error confirming dispatch'));

    const result = await service.sweep();

    // The sweep itself must not throw or abort — this is caught by the
    // per-candidate try/catch, matching the "poison cannot monopolize a
    // batch" guarantee.
    expect(result.claimed).toBe(1);
    expect(mockQueue.add).toHaveBeenCalledTimes(1); // the enqueue genuinely happened and is not retracted
    // published is NOT incremented, since the confirm write never
    // completed — this correctly leaves dispatchedAt unset, so the row
    // remains re-claimable once its lease expires (real recovery is
    // proven against real Postgres + real Redis in the integration suite's
    // "AC17 BullMQ failure-recovery mechanics" block).
    expect(result.published).toBe(0);
  });

  it('the sweep query is capped to the configured batch size', async () => {
    await service.sweep();
    expect(mockPrisma.pOSSyncRecord.findMany.mock.calls[0][0].take).toEqual(expect.any(Number));
    expect(mockPrisma.pOSSyncRecord.findMany.mock.calls[0][0].take).toBeGreaterThan(0);
  });

  it('the sweep query orders deterministically by createdAt ascending (oldest first)', async () => {
    await service.sweep();
    expect(mockPrisma.pOSSyncRecord.findMany.mock.calls[0][0].orderBy).toEqual({
      createdAt: 'asc',
    });
  });

  it('onModuleInit does not start a timer under NODE_ENV=test', () => {
    // @ts-expect-error accessing private field for the one test that
    // specifically needs to prove the cross-test-contamination guard exists.
    expect(service.timer).toBeNull();
  });
});
