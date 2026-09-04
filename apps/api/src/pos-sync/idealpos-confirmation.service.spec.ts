import { POSSyncStatus } from '@prisma/client';
import { IdealposConfirmationService } from './idealpos-confirmation.service';
import {
  BridgeOrderStatusReader,
  BridgeStatusReadOutcome,
  decideConfirmation,
} from './bridge-order-status';

/** A body shaped exactly like IdealposBridge's ToResponseBody(). */
const bridgeBody = (over: Record<string, unknown> = {}) => ({
  externalOrderId: 'ORD-600003',
  status: 'submitted_to_idealpos',
  table: '12',
  idealposWebPendingOrderId: 4711,
  idealposPendingSaleId: 99410,
  idealposPendingSaleCode: 'WBORD-600003',
  posServerPendingSaleId: null,
  posServerPendingSaleCode: null,
  tableMatchesRequest: null,
  tableAssignedNatively: false,
  strategyUsed: 'NoHint',
  lastError: null,
  ...over,
});

const assignedBody = (over: Record<string, unknown> = {}) =>
  bridgeBody({
    status: 'assigned_to_table',
    posServerPendingSaleId: 99411,
    posServerPendingSaleCode: '12',
    tableMatchesRequest: true,
    ...over,
  });

describe('decideConfirmation', () => {
  it('assigned_to_table with a matching observed code confirms', () => {
    const d = decideConfirmation({ kind: 'ok', body: assignedBody() }, '12');
    expect(d.nextStatus).toBe(POSSyncStatus.synced);
    expect(d.observedTableCode).toBe('12');
    expect(d.tableCorroborated).toBe(true);
  });

  it('assigned_to_table with tableMatchesRequest null does NOT confirm', () => {
    const d = decideConfirmation(
      { kind: 'ok', body: assignedBody({ tableMatchesRequest: null }) },
      '12',
    );
    expect(d.nextStatus).toBeNull();
    expect(d.tableCorroborated).toBe(false);
    expect(d.reason).toContain('NOT DETERMINED');
  });

  it('assigned_to_table without an observed code does NOT confirm', () => {
    const d = decideConfirmation(
      { kind: 'ok', body: assignedBody({ posServerPendingSaleCode: null }) },
      '12',
    );
    expect(d.nextStatus).toBeNull();
    expect(d.reason).toContain('observed table identity is missing');
  });

  it('assigned_to_table on a DIFFERENT table does NOT confirm', () => {
    const d = decideConfirmation(
      { kind: 'ok', body: assignedBody({ posServerPendingSaleCode: '7' }) },
      '12',
    );
    expect(d.nextStatus).toBeNull();
    expect(d.reason).toContain('mismatch');
    expect(d.observedTableCode).toBe('7');
  });

  it('assigned_to_table with no requested table to compare does NOT confirm', () => {
    const d = decideConfirmation({ kind: 'ok', body: assignedBody() }, null);
    expect(d.nextStatus).toBeNull();
    expect(d.reason).toContain('no requested table');
  });

  it.each(['rejected', 'failed'])('bridge %s becomes failed', (status) => {
    const d = decideConfirmation(
      { kind: 'ok', body: bridgeBody({ status, lastError: 'PLU 999 unknown' }) },
      '12',
    );
    expect(d.nextStatus).toBe(POSSyncStatus.failed);
    expect(d.reason).toContain('PLU 999 unknown');
  });

  it.each([
    'received',
    'validated',
    'submitted_to_idealpos',
    'pending_idealpos_processing',
    'processed',
    'anchored_in_idealpos',
    'uncertain',
    'paid',
    'closed',
  ])('bridge %s leaves the record awaiting', (status) => {
    const d = decideConfirmation({ kind: 'ok', body: bridgeBody({ status }) }, '12');
    expect(d.nextStatus).toBeNull();
    expect(d.tableCorroborated).toBe(false);
  });

  it('an unreachable bridge is never success and never failure', () => {
    const d = decideConfirmation({ kind: 'unavailable', reason: 'ECONNREFUSED' }, '12');
    expect(d.nextStatus).toBeNull();
    expect(d.reason).toContain('unavailable');
  });

  it('a malformed body is never success and never failure', () => {
    const d = decideConfirmation({ kind: 'malformed', reason: 'not json' }, '12');
    expect(d.nextStatus).toBeNull();
  });

  it('a 404 is not evidence of failure', () => {
    const d = decideConfirmation({ kind: 'notFound' }, '12');
    expect(d.nextStatus).toBeNull();
    expect(d.reason).toContain('not evidence of failure');
  });

  it('an empty status is not interpreted', () => {
    const d = decideConfirmation({ kind: 'ok', body: bridgeBody({ status: '' }) }, '12');
    expect(d.nextStatus).toBeNull();
  });

  it('table comparison is case-insensitive and whitespace tolerant', () => {
    const d = decideConfirmation(
      { kind: 'ok', body: assignedBody({ posServerPendingSaleCode: ' t12 ' }) },
      'T12',
    );
    expect(d.nextStatus).toBe(POSSyncStatus.synced);
  });
});

describe('IdealposConfirmationService.sweepConfirm', () => {
  const makePrisma = (
    records: Array<{ id: string; orderId: string; venueId: string; posTableId: string | null }>,
    posTableCode: string | null = '12',
    updateCount = 1,
  ) => ({
    pOSSyncRecord: {
      findMany: jest.fn().mockResolvedValue(records),
      updateMany: jest.fn().mockResolvedValue({ count: updateCount }),
    },
    order: {
      findUnique: jest.fn().mockResolvedValue(
        posTableCode === null ? { table: null } : { table: { posTableCode } },
      ),
    },
  });

  const reader = (outcome: BridgeStatusReadOutcome): BridgeOrderStatusReader => ({
    read: jest.fn().mockResolvedValue(outcome),
  });

  const oneRecord = [{ id: 'psr-1', orderId: 'ORD-600003', venueId: 'v1', posTableId: null }];

  it('is inert when no reader is configured', async () => {
    const prisma = makePrisma(oneRecord);
    const svc = new IdealposConfirmationService(prisma as never);

    const r = await svc.sweepConfirm();

    expect(r.disabled).toBe(true);
    expect(prisma.pOSSyncRecord.findMany).not.toHaveBeenCalled();
    expect(prisma.pOSSyncRecord.updateMany).not.toHaveBeenCalled();
  });

  it('only ever selects records still awaiting confirmation', async () => {
    const prisma = makePrisma(oneRecord);
    const svc = new IdealposConfirmationService(
      prisma as never,
      reader({ kind: 'ok', body: assignedBody() }),
    );

    await svc.sweepConfirm();

    expect(prisma.pOSSyncRecord.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: POSSyncStatus.submitted_awaiting_confirmation },
      }),
    );
  });

  it('assigned_to_table advances to synced and records the OBSERVED table code', async () => {
    const prisma = makePrisma(oneRecord);
    const svc = new IdealposConfirmationService(
      prisma as never,
      reader({ kind: 'ok', body: assignedBody({ posServerPendingSaleCode: '12' }) }),
    );

    const r = await svc.sweepConfirm();

    expect(r.confirmed).toBe(1);
    const call = prisma.pOSSyncRecord.updateMany.mock.calls[0][0];
    expect(call.data.status).toBe(POSSyncStatus.synced);
    expect(call.data.posTableId).toBe('12');
    expect(call.data.syncedAt).toBeInstanceOf(Date);
  });

  it('every write is guarded on the record still being awaiting — terminal states cannot regress', async () => {
    const prisma = makePrisma(oneRecord);
    const svc = new IdealposConfirmationService(
      prisma as never,
      reader({ kind: 'ok', body: assignedBody() }),
    );

    await svc.sweepConfirm();

    const call = prisma.pOSSyncRecord.updateMany.mock.calls[0][0];
    expect(call.where).toEqual({
      id: 'psr-1',
      status: POSSyncStatus.submitted_awaiting_confirmation,
    });
  });

  it('a concurrent writer winning the guarded update is counted as raced, not confirmed', async () => {
    const prisma = makePrisma(oneRecord, '12', /* updateCount */ 0);
    const svc = new IdealposConfirmationService(
      prisma as never,
      reader({ kind: 'ok', body: assignedBody() }),
    );

    const r = await svc.sweepConfirm();

    expect(r.raced).toBe(1);
    expect(r.confirmed).toBe(0);
  });

  it('repeated polling is idempotent: a second identical read applies nothing new', async () => {
    // First sweep applies; the row is no longer selected afterwards.
    const prisma = makePrisma(oneRecord);
    const svc = new IdealposConfirmationService(
      prisma as never,
      reader({ kind: 'ok', body: assignedBody() }),
    );

    const first = await svc.sweepConfirm();
    expect(first.confirmed).toBe(1);

    prisma.pOSSyncRecord.findMany.mockResolvedValue([]); // already synced
    const second = await svc.sweepConfirm();

    expect(second.examined).toBe(0);
    expect(second.confirmed).toBe(0);
    expect(prisma.pOSSyncRecord.updateMany).toHaveBeenCalledTimes(1);
  });

  it('a rejected order becomes failed with the bridge reason and failedAt', async () => {
    const prisma = makePrisma(oneRecord);
    const svc = new IdealposConfirmationService(
      prisma as never,
      reader({ kind: 'ok', body: bridgeBody({ status: 'rejected', lastError: 'bad PLU' }) }),
    );

    const r = await svc.sweepConfirm();

    expect(r.failed).toBe(1);
    const call = prisma.pOSSyncRecord.updateMany.mock.calls[0][0];
    expect(call.data.status).toBe(POSSyncStatus.failed);
    expect(call.data.errorMessage).toContain('bad PLU');
    expect(call.data.failedAt).toBeInstanceOf(Date);
  });

  it('an unavailable bridge writes NOTHING', async () => {
    const prisma = makePrisma(oneRecord);
    const svc = new IdealposConfirmationService(
      prisma as never,
      reader({ kind: 'unavailable', reason: 'ETIMEDOUT' }),
    );

    const r = await svc.sweepConfirm();

    expect(r.unchanged).toBe(1);
    expect(r.confirmed).toBe(0);
    expect(prisma.pOSSyncRecord.updateMany).not.toHaveBeenCalled();
  });

  it('a malformed body writes NOTHING', async () => {
    const prisma = makePrisma(oneRecord);
    const svc = new IdealposConfirmationService(
      prisma as never,
      reader({ kind: 'malformed', reason: 'unparseable' }),
    );

    await svc.sweepConfirm();
    expect(prisma.pOSSyncRecord.updateMany).not.toHaveBeenCalled();
  });

  it('a reader that throws does not abort the sweep or invent a verdict', async () => {
    const records = [
      { id: 'psr-1', orderId: 'ORD-1', venueId: 'v1', posTableId: null },
      { id: 'psr-2', orderId: 'ORD-2', venueId: 'v1', posTableId: null },
    ];
    const prisma = makePrisma(records);
    const throwingReader: BridgeOrderStatusReader = {
      read: jest
        .fn()
        .mockRejectedValueOnce(new Error('socket hang up'))
        .mockResolvedValueOnce({ kind: 'ok', body: assignedBody() }),
    };
    const svc = new IdealposConfirmationService(prisma as never, throwingReader);

    const r = await svc.sweepConfirm();

    expect(r.examined).toBe(2);
    expect(r.unchanged).toBe(1); // the thrower
    expect(r.confirmed).toBe(1); // the healthy one still processed
  });

  it('an order whose table is unmapped (no posTableCode) is never confirmed', async () => {
    const prisma = makePrisma(oneRecord, /* posTableCode */ null);
    const svc = new IdealposConfirmationService(
      prisma as never,
      reader({ kind: 'ok', body: assignedBody() }),
    );

    const r = await svc.sweepConfirm();

    expect(r.confirmed).toBe(0);
    expect(prisma.pOSSyncRecord.updateMany).not.toHaveBeenCalled();
  });

  it('reads the bridge with THIS record own externalOrderId, so one order cannot affect another', async () => {
    const records = [
      { id: 'psr-1', orderId: 'ORD-AAA', venueId: 'v1', posTableId: null },
      { id: 'psr-2', orderId: 'ORD-BBB', venueId: 'v1', posTableId: null },
    ];
    const prisma = makePrisma(records);
    const r = reader({ kind: 'ok', body: bridgeBody({ status: 'processed' }) });
    const svc = new IdealposConfirmationService(prisma as never, r);

    await svc.sweepConfirm();

    expect((r.read as jest.Mock).mock.calls.map((c) => c[0])).toEqual(['ORD-AAA', 'ORD-BBB']);
  });

  it('restart recovery: a fresh sweep re-selects whatever is still awaiting', async () => {
    // No in-memory state survives a restart; correctness comes purely from the
    // status filter, so a new instance behaves identically.
    const prisma = makePrisma(oneRecord);
    const svc = new IdealposConfirmationService(
      prisma as never,
      reader({ kind: 'ok', body: assignedBody() }),
    );

    const r = await svc.sweepConfirm();
    expect(r.confirmed).toBe(1);
    expect(prisma.pOSSyncRecord.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: POSSyncStatus.submitted_awaiting_confirmation } }),
    );
  });
});
