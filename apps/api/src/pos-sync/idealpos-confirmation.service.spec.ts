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
  // FAIL-CLOSED (2026-09-04). This is the case that used to promote to
  // `synced`. A staff-created walk-in on the same table is MODELLED to produce
  // an indistinguishable Bridge body -- inferred from reading
  // Reconciliation.SelectTableSale, which reads only Pos and Code, and NOT
  // from any live walk-in observation. On that inference the evidence is
  // table-code correlation, never causation.
  it('assigned_to_table with a matching observed code CORROBORATES but does NOT confirm', () => {
    const d = decideConfirmation({ kind: 'ok', body: assignedBody() }, '12');
    expect(d.nextStatus).toBeNull();
    expect(d.observedTableCode).toBe('12');
    expect(d.tableCorroborated).toBe(true);
    expect(d.reason).toContain('corroboration only');
  });

  it('an unrelated walk-in on the requested table is indistinguishable and stays awaiting', () => {
    // Nothing in the Bridge contract ties a POSServer table sale to a web
    // order, so this CONSTRUCTED body is what the source says a walk-in would
    // produce. It is not a captured live walk-in. The point of the test is
    // that the decision is identical either way -- which is precisely why
    // neither may confirm.
    const walkIn = decideConfirmation(
      { kind: 'ok', body: assignedBody({ externalOrderId: 'ORD-UNRELATED' }) },
      '12',
    );
    expect(walkIn.nextStatus).toBeNull();
    expect(walkIn.tableCorroborated).toBe(true);
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
    // Still only corroboration -- normalisation decides whether the codes
    // MATCH, never whether a match is sufficient to confirm.
    expect(d.nextStatus).toBeNull();
    expect(d.tableCorroborated).toBe(true);
  });
});

/**
 * The policy this module exists to enforce, asserted as a property rather than
 * trusted to a doc comment: no Bridge read of any shape may produce `synced`
 * while no causal native identity exists.
 */
describe('decideConfirmation fail-closed policy', () => {
  const everyNonRejectingStatus = [
    'received',
    'validated',
    'submitted_to_idealpos',
    'pending_idealpos_processing',
    'processed',
    'anchored_in_idealpos',
    'assigned_to_table',
    'uncertain',
    'paid',
    'closed',
  ];

  it.each(everyNonRejectingStatus)('never reaches synced on bridge status %s', (status) => {
    for (const requested of ['12', 'T12', '', null]) {
      for (const matches of [true, false, null]) {
        const d = decideConfirmation(
          {
            kind: 'ok',
            body: assignedBody({
              status,
              tableMatchesRequest: matches,
              posServerPendingSaleCode: '12',
            }),
          },
          requested,
        );
        expect(d.nextStatus).not.toBe(POSSyncStatus.synced);
      }
    }
  });

  it('never reaches synced on any non-ok read outcome', () => {
    const outcomes: BridgeStatusReadOutcome[] = [
      { kind: 'notFound' },
      { kind: 'unavailable', reason: 'ECONNREFUSED' },
      { kind: 'malformed', reason: 'not json' },
    ];
    for (const o of outcomes) {
      expect(decideConfirmation(o, '12').nextStatus).not.toBe(POSSyncStatus.synced);
    }
  });

  // The grounds named as individually insufficient. Each is expressed as the
  // Bridge body that would carry it, and each must leave the record awaiting.
  it('rejects every individually-insufficient ground for confirmation', () => {
    const insufficient: Array<[string, BridgeStatusReadOutcome]> = [
      // WebOrder processed alone -- native IdealPOS consumed the web order,
      // but that says nothing about a table or a sale identity.
      [
        'processed alone',
        { kind: 'ok', body: bridgeBody({ status: 'processed', processed: true }) },
      ],
      // Anchored in IdealPOS -- a real anchor row, still not a table sale.
      ['anchor alone', { kind: 'ok', body: bridgeBody({ status: 'anchored_in_idealpos' }) }],
      // The requested table echoed back. body.table is Verdura's own input.
      [
        'requested table echoed',
        { kind: 'ok', body: bridgeBody({ status: 'validated', table: '12' }) },
      ],
      // Absence of an error is not success.
      [
        'no error reported',
        { kind: 'ok', body: bridgeBody({ status: 'submitted_to_idealpos', lastError: null }) },
      ],
      // Heuristic Bridge states, documented as inferred rather than proven.
      ['heuristic paid', { kind: 'ok', body: bridgeBody({ status: 'paid' }) }],
      ['heuristic closed', { kind: 'ok', body: bridgeBody({ status: 'closed' }) }],
      // Genuinely ambiguous by construction.
      ['uncertain', { kind: 'ok', body: bridgeBody({ status: 'uncertain' }) }],
    ];
    for (const [label, outcome] of insufficient) {
      const d = decideConfirmation(outcome, '12');
      expect([label, d.nextStatus]).toEqual([label, null]);
    }
  });

  it('an explicit bridge rejection is still terminal -- fail-closed is not fail-silent', () => {
    for (const status of ['rejected', 'failed']) {
      const d = decideConfirmation({ kind: 'ok', body: bridgeBody({ status }) }, '12');
      expect(d.nextStatus).toBe(POSSyncStatus.failed);
    }
  });
});

describe('IdealposConfirmationService.sweepConfirm', () => {
  const makePrisma = (
    records: Array<{ id: string; orderId: string; venueId: string; posTableId: string | null }>,
    posTableCode: string | null = '12',
    updateCount = 1,
  ) => ({
    pOSSyncRecord: {
      // `count` drives the rotating offset (see sweepConfirm). Defaulting it
      // to the fixture size keeps every pre-existing test on the skip:0 path
      // it was written for; the rotation tests below override it.
      count: jest.fn().mockResolvedValue(records.length),
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

  it('assigned_to_table leaves the record awaiting and writes NOTHING', async () => {
    const prisma = makePrisma(oneRecord);
    const svc = new IdealposConfirmationService(
      prisma as never,
      reader({ kind: 'ok', body: assignedBody({ posServerPendingSaleCode: '12' }) }),
    );

    const r = await svc.sweepConfirm();

    expect(r.confirmed).toBe(0);
    expect(r.unchanged).toBe(1);
    expect(prisma.pOSSyncRecord.updateMany).not.toHaveBeenCalled();
  });

  it('repeated sweeps over the same corroborated record never transition it', async () => {
    const prisma = makePrisma(oneRecord);
    const svc = new IdealposConfirmationService(
      prisma as never,
      reader({ kind: 'ok', body: assignedBody({ posServerPendingSaleCode: '12' }) }),
    );

    await svc.sweepConfirm();
    await svc.sweepConfirm();
    await svc.sweepConfirm();

    expect(prisma.pOSSyncRecord.updateMany).not.toHaveBeenCalled();
  });

  it('concurrent sweeps produce at most one terminal transition', async () => {
    // Two sweeps race on the same record with a real terminal outcome. The
    // guarded updateMany means the loser sees count 0 and reports `raced`,
    // never a second transition.
    const prisma = makePrisma(oneRecord);
    let calls = 0;
    prisma.pOSSyncRecord.updateMany = jest.fn().mockImplementation(() => {
      calls += 1;
      return Promise.resolve({ count: calls === 1 ? 1 : 0 });
    });
    const svc = new IdealposConfirmationService(
      prisma as never,
      reader({ kind: 'ok', body: bridgeBody({ status: 'rejected' }) }),
    );

    const [a, b] = await Promise.all([svc.sweepConfirm(), svc.sweepConfirm()]);

    expect(a.failed + b.failed).toBe(1);
    expect(a.raced + b.raced).toBe(1);
  });

  it('every write is guarded on the record still being awaiting — terminal states cannot regress', async () => {
    const prisma = makePrisma(oneRecord);
    const svc = new IdealposConfirmationService(
      prisma as never,
      reader({ kind: 'ok', body: bridgeBody({ status: 'rejected' }) }),
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
      reader({ kind: 'ok', body: bridgeBody({ status: 'rejected' }) }),
    );

    const r = await svc.sweepConfirm();

    expect(r.raced).toBe(1);
    expect(r.confirmed).toBe(0);
    expect(r.failed).toBe(0);
  });

  it('repeated polling is idempotent: a second identical read applies nothing new', async () => {
    // First sweep applies a real terminal outcome; the row is no longer
    // selected afterwards because it left `submitted_awaiting_confirmation`.
    const prisma = makePrisma(oneRecord);
    const svc = new IdealposConfirmationService(
      prisma as never,
      reader({ kind: 'ok', body: bridgeBody({ status: 'rejected' }) }),
    );

    const first = await svc.sweepConfirm();
    expect(first.failed).toBe(1);

    prisma.pOSSyncRecord.findMany.mockResolvedValue([]); // already terminal
    const second = await svc.sweepConfirm();

    expect(second.examined).toBe(0);
    expect(second.failed).toBe(0);
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
        .mockResolvedValueOnce({ kind: 'ok', body: bridgeBody({ status: 'rejected' }) }),
    };
    const svc = new IdealposConfirmationService(prisma as never, throwingReader);

    const r = await svc.sweepConfirm();

    expect(r.examined).toBe(2);
    expect(r.unchanged).toBe(1); // the thrower
    expect(r.failed).toBe(1); // the healthy one still processed
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
      reader({ kind: 'ok', body: bridgeBody({ status: 'rejected' }) }),
    );

    const r = await svc.sweepConfirm();
    expect(r.failed).toBe(1);
    expect(prisma.pOSSyncRecord.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: POSSyncStatus.submitted_awaiting_confirmation } }),
    );
  });

  // ── Rotation: fail-closed regression guard (2026-09-05) ──────────────────
  //
  // Since nothing reaches `synced`, records leave the awaiting set only on an
  // explicit rejection. These tests prove the sweep cannot starve newer
  // records behind a wall of permanently-awaiting ones.

  it('does not page while the awaiting set fits in one batch', async () => {
    const prisma = makePrisma(oneRecord);
    prisma.pOSSyncRecord.count = jest.fn().mockResolvedValue(1);
    const svc = new IdealposConfirmationService(
      prisma as never,
      reader({ kind: 'ok', body: assignedBody() }),
    );

    await svc.sweepConfirm();
    await svc.sweepConfirm();
    await svc.sweepConfirm();

    for (const call of prisma.pOSSyncRecord.findMany.mock.calls) {
      expect(call[0].skip).toBe(0);
    }
  });

  it('rotates the offset so a large awaiting set is fully covered', async () => {
    // 130 permanently-awaiting records, batch size 50: three ticks must cover
    // offsets 0, 50 and 100 — i.e. every record is examined within
    // ceil(130/50) = 3 sweeps. Before the fix every tick used offset 0 and
    // records 51..130 were NEVER examined.
    const prisma = makePrisma(oneRecord);
    prisma.pOSSyncRecord.count = jest.fn().mockResolvedValue(130);
    const svc = new IdealposConfirmationService(
      prisma as never,
      reader({ kind: 'ok', body: assignedBody() }),
    );

    await svc.sweepConfirm();
    await svc.sweepConfirm();
    await svc.sweepConfirm();

    expect(prisma.pOSSyncRecord.findMany.mock.calls.map((c) => c[0].skip)).toEqual([0, 50, 100]);
  });

  it('wraps the offset back to the start of the set', async () => {
    const prisma = makePrisma(oneRecord);
    prisma.pOSSyncRecord.count = jest.fn().mockResolvedValue(60);
    const svc = new IdealposConfirmationService(
      prisma as never,
      reader({ kind: 'ok', body: assignedBody() }),
    );

    await svc.sweepConfirm();
    await svc.sweepConfirm();
    await svc.sweepConfirm();

    // 60 awaiting, batch 50: offsets 0, 50, then 100 % 60 = 40. Never stuck.
    expect(prisma.pOSSyncRecord.findMany.mock.calls.map((c) => c[0].skip)).toEqual([0, 50, 40]);
  });

  it('pages over a STABLE ordering, never the mutable updatedAt', async () => {
    // Offsetting into an ordering that shifts as rows are examined would skip
    // records silently. `id` is immutable; `updatedAt` is not.
    const prisma = makePrisma(oneRecord);
    prisma.pOSSyncRecord.count = jest.fn().mockResolvedValue(130);
    const svc = new IdealposConfirmationService(
      prisma as never,
      reader({ kind: 'ok', body: assignedBody() }),
    );

    await svc.sweepConfirm();

    expect(prisma.pOSSyncRecord.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { id: 'asc' }, take: 50 }),
    );
  });

  it('short-circuits and resets the cursor when nothing is awaiting', async () => {
    const prisma = makePrisma([]);
    prisma.pOSSyncRecord.count = jest.fn().mockResolvedValue(0);
    const svc = new IdealposConfirmationService(
      prisma as never,
      reader({ kind: 'ok', body: assignedBody() }),
    );

    const r = await svc.sweepConfirm();

    expect(r.examined).toBe(0);
    expect(r.disabled).toBe(false);
    expect(prisma.pOSSyncRecord.findMany).not.toHaveBeenCalled();
  });

  it('an explicit rejection is still terminal for a record deep in the set', async () => {
    // The whole point of rotation: a rejection arriving for a record that is
    // not at the head of the queue must still be actioned.
    const prisma = makePrisma(oneRecord);
    prisma.pOSSyncRecord.count = jest.fn().mockResolvedValue(500);
    const svc = new IdealposConfirmationService(
      prisma as never,
      reader({ kind: 'ok', body: bridgeBody({ status: 'rejected' }) }),
    );

    const r = await svc.sweepConfirm();

    expect(r.failed).toBe(1);
    expect(r.confirmed).toBe(0);
  });

  it('`confirmed` is structurally unreachable — a non-zero value would mean fail-closed broke', async () => {
    const prisma = makePrisma(oneRecord);
    const svc = new IdealposConfirmationService(
      prisma as never,
      reader({ kind: 'ok', body: assignedBody() }),
    );

    const r = await svc.sweepConfirm();

    expect(r.confirmed).toBe(0);
  });
});
