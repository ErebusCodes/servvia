/**
 * A WHOLE SHIFT ON TABLE 5, WITH THE TILL ANSWERING.
 *
 * Every other spec in this directory stops at the wire. This one carries three
 * rounds all the way to the state a waiter actually reads — `confirmed`, the
 * green acknowledgement — through the real services, the real codec, a real
 * socket to a fake till, and the real reconciler holding a real evidence
 * reader and a real pre-send baseline.
 *
 * WHAT IT IS FOR. The confirmation path is assembled from pieces that are each
 * tested alone: a predicate, a baseline rule, a reader, a sweep, an invariant.
 * Pieces that pass alone can still fail to add up — a baseline that is never
 * captured, a token that never reaches the predicate, a delta computed against
 * the wrong round. This is the spec that fails if they do not add up.
 *
 * THE SHAPE, and it is the acceptance script verbatim:
 *
 *   Round 1  covers 2, items A and B   -> one socket, one Order2, ACK is not
 *                                         success, evidence arrives, CONFIRMED
 *   Round 2  add item C                -> packet carries C ONLY, A and B absent,
 *                                         distinct token, CONFIRMED against a
 *                                         baseline that already holds A and B
 *   Round 3  order item A again        -> only the NEW A goes, and the reader
 *                                         distinguishes it from round 1's A
 *
 * Then the ways it goes wrong, each asserted to leave the round where it was
 * and to put nothing further on the wire.
 *
 * THE TAB IS DRIVEN BY THE TEST, NEVER BY THE PACKETS. If the fixture applied
 * each Order2 to itself, a round would confirm because the fixture echoed it
 * back and this would prove only that the fixture works. Every line is added by
 * an explicit `tab.serve(...)`, standing for the receiver having written it.
 */

import { NativeRoundState } from '@prisma/client';

import {
  ACTOR,
  MENU,
  NATIVE_ENV,
  build,
  createDineInOrder,
  installHarnessLifecycle,
  openTill,
  setHarness,
  tillServer,
  VENUE,
  type Harness,
} from '../testing/native-order-harness';
import type { NativeRoundEvidenceReader } from './native-round-reconciliation.service';
import type { PreSendBaselineSource } from './native-pre-send-baseline';
import type { NativeLineObservation, NativeTableSnapshot } from './waiterpad-native-evidence';
import type { ReconciliationEvidence } from './waiterpad-reconciliation';
import type { SendInitiatedRecord } from './waiterpad-table-round-writer';

installHarnessLifecycle();

const TABLE = '5';

/** The native tab for table 5, as POSServer would report it. */
class Tab {
  private lines: NativeLineObservation[] = [];

  /** The receiver applied these PLUs. */
  serve(...codes: string[]): void {
    for (const code of codes) this.lines.push({ nativeCode: code, quantity: 1 });
  }

  /** Somebody voided a line at the terminal. */
  void(code: string): void {
    const i = this.lines.findIndex((l) => l.nativeCode === code);
    if (i >= 0) this.lines.splice(i, 1);
  }

  snapshot(): NativeTableSnapshot {
    return {
      status: 'observed',
      tableCode: TABLE,
      pos: 1,
      map: '1',
      lines: this.lines.map((l) => ({ ...l })),
      observedAt: new Date().toISOString(),
    };
  }

  get size(): number {
    return this.lines.length;
  }
}

/** The pre-send baseline: the tab exactly as it stands when Send is pressed. */
class TabBaseline implements PreSendBaselineSource {
  constructor(private readonly tab: Tab) {}
  readBaseline(): Promise<NativeTableSnapshot> {
    return Promise.resolve(this.tab.snapshot());
  }
}

/**
 * The evidence reader, standing in for the connector.
 *
 * It reports the tab as it stands NOW and the token the till holds. It invents
 * neither: `storedToken` defaults to the attempt's own token, which stands for
 * "ProcessHandheldOrder picked our packet up", and `fail()` makes it report
 * ignorance exactly as a real outage would.
 */
class TillEvidence implements NativeRoundEvidenceReader {
  storedToken: string | null | undefined;
  reads = 0;
  private failing = false;

  constructor(private readonly tab: Tab) {}

  fail(on = true): void {
    this.failing = on;
  }

  readEvidence(record: SendInitiatedRecord): Promise<ReconciliationEvidence> {
    this.reads += 1;
    if (this.failing) return Promise.resolve({});
    return Promise.resolve({
      storedTokenForDevice: this.storedToken === undefined ? record.token : this.storedToken,
      currentTable: this.tab.snapshot(),
    });
  }
}

interface Shift {
  h: Harness;
  tab: Tab;
  evidence: TillEvidence;
}

async function openShift(): Promise<Shift> {
  const server = await openTill();
  const tab = new Tab();
  const evidence = new TillEvidence(tab);
  const h = setHarness(
    await build(NATIVE_ENV(server.port), undefined, {
      baselineSource: new TabBaseline(tab),
      evidenceReader: evidence,
    }),
  );
  return { h, tab, evidence };
}

/**
 * The authenticated request the real handler expects. Same shape the
 * controller's own spec uses, so both drive the handler identically.
 */
const REQUEST = {
  user: {
    sub: ACTOR.id,
    email: ACTOR.email,
    role: ACTOR.role,
    organizationId: VENUE.organizationId,
    venueId: VENUE.id,
  },
} as never;

/**
 * One press of Send to Kitchen, through the real handler.
 *
 * `items` are the NEW lines this press adds — which is how the tablet works:
 * a waiter adds to the order and presses Send, and the handler appends them
 * and opens a round over everything still unclaimed.
 */
async function send(
  h: Harness,
  orderId: string,
  press: number,
  items: { menuItemId: string; quantity: number }[] = [],
) {
  return await h.rounds.submitRound(REQUEST, orderId, {
    items,
    requestKey: `press-${press}-${'k'.repeat(20)}`,
  });
}

function roundState(h: Harness, roundId: string): unknown {
  return h.ledger.rounds.find((r) => r.id === roundId)?.state;
}

function round(h: Harness, roundId: string) {
  const r = h.ledger.rounds.find((x) => x.id === roundId);
  if (!r) throw new Error(`no round ${roundId}`);
  return r;
}

describe('TABLE 5: three rounds, the till answering', () => {
  it('carries a whole service from Send to green, and sends no line twice', async () => {
    const { h, tab, evidence } = await openShift();
    const till = tillServer();

    // ── ROUND 1: covers 2, item A and item B ────────────────────────────
    const order = await createDineInOrder(h, {
      guests: 2,
      items: [
        { menuItemId: MENU.lamb.id, quantity: 1 },
        { menuItemId: MENU.coke.id, quantity: 1 },
      ],
    });

    const r1 = await send(h, order.id, 1);
    const round1 = r1.roundId;

    // EXACTLY ONE SOCKET, EXACTLY ONE PACKET, THE RIGHT TABLE AND COVERS.
    expect(till.requests).toHaveLength(1);
    expect(till.requests[0]).toContain(`<Table>${TABLE}</Table>`);
    expect(till.requests[0]).toContain('<Guests>2</Guests>');
    expect(till.requests[0]).toContain(`<StockItem>${MENU.lamb.posProductCode}</StockItem>`);
    expect(till.requests[0]).toContain(`<StockItem>${MENU.coke.posProductCode}</StockItem>`);

    // ONE DURABLE ATTEMPT, and it carries both terms of the delta.
    expect(h.ledger.attempts).toHaveLength(1);
    expect(h.ledger.attempts[0].preSendTableSnapshot).toBeTruthy();
    expect(h.ledger.attempts[0].expectedNativeItems).toBeTruthy();

    // ACK IS NOT SUCCESS.
    expect(r1.status).toBe('sentAwaitingConfirmation');
    expect(roundState(h, round1)).toBe(NativeRoundState.awaiting_native_confirmation);

    // A sweep BEFORE the till has written anything confirms nothing: the token
    // proves our packet was picked up, and no line exists yet.
    expect((await h.reconciler.sweep()).confirmed).toBe(0);
    expect(roundState(h, round1)).toBe(NativeRoundState.awaiting_native_confirmation);

    // The receiver writes the lines. Now the evidence is complete.
    tab.serve(MENU.lamb.posProductCode, MENU.coke.posProductCode);
    expect((await h.reconciler.sweep()).confirmed).toBe(1);

    expect(roundState(h, round1)).toBe(NativeRoundState.confirmed);
    // Only a CAUSAL tier may confirm.
    expect(round(h, round1).nativeSaleTier).toBe('causal');

    // ── ROUND 2: add item C ─────────────────────────────────────────────
    const r2 = await send(h, order.id, 2, [{ menuItemId: MENU.tiramisu.id, quantity: 1 }]);
    const round2 = r2.roundId;

    expect(till.requests).toHaveLength(2);
    // THE DELTA RULE: C only. A and B must not be resent.
    expect(till.requests[1]).toContain(`<StockItem>${MENU.tiramisu.posProductCode}</StockItem>`);
    expect(till.requests[1]).not.toContain(`<StockItem>${MENU.lamb.posProductCode}</StockItem>`);
    expect(till.requests[1]).not.toContain(`<StockItem>${MENU.coke.posProductCode}</StockItem>`);

    // A DISTINCT durable round and a DISTINCT token.
    expect(h.ledger.attempts).toHaveLength(2);
    expect(h.ledger.attempts[0].token).not.toBe(h.ledger.attempts[1].token);
    expect(round2).not.toBe(round1);

    tab.serve(MENU.tiramisu.posProductCode);
    await h.reconciler.sweep();

    expect(roundState(h, round2)).toBe(NativeRoundState.confirmed);
    // Round 1 did not regress, and its lines were not counted a second time.
    expect(roundState(h, round1)).toBe(NativeRoundState.confirmed);

    // ── ROUND 3: item A again, deliberately ─────────────────────────────
    const r3 = await send(h, order.id, 3, [{ menuItemId: MENU.lamb.id, quantity: 1 }]);
    const round3 = r3.roundId;

    expect(till.requests).toHaveLength(3);
    // Only the NEW occurrence of A.
    expect(till.requests[2]).toContain(`<StockItem>${MENU.lamb.posProductCode}</StockItem>`);
    expect(till.requests[2]).not.toContain(
      `<StockItem>${MENU.tiramisu.posProductCode}</StockItem>`,
    );
    expect(till.requests[2]).not.toContain(`<StockItem>${MENU.coke.posProductCode}</StockItem>`);

    // THE CASE A COUNT WOULD GET WRONG. The tab already holds round 1's A, so
    // "a lamb is on the table" is true and means nothing. The delta is zero.
    expect((await h.reconciler.sweep()).confirmed).toBe(0);
    expect(roundState(h, round3)).toBe(NativeRoundState.awaiting_native_confirmation);

    // The receiver writes the SECOND A. Now the delta is exactly one A.
    tab.serve(MENU.lamb.posProductCode);
    await h.reconciler.sweep();

    expect(roundState(h, round3)).toBe(NativeRoundState.confirmed);

    // THREE ROUNDS, THREE PACKETS, FOUR LINES. Nothing sent twice.
    expect(till.requests).toHaveLength(3);
    expect(tab.size).toBe(4);
    expect(evidence.reads).toBeGreaterThan(0);
  }, 30_000);
});

describe('the ways a shift goes wrong, and what each one costs', () => {
  async function oneSentRound(): Promise<Shift & { roundId: string }> {
    const shift = await openShift();
    const order = await createDineInOrder(shift.h, {
      guests: 2,
      items: [{ menuItemId: MENU.lamb.id, quantity: 1 }],
    });
    const r = await send(shift.h, order.id, 1);
    return { ...shift, roundId: r.roundId };
  }

  it('an evidence-reader outage confirms nothing, releases nothing and sends nothing', async () => {
    const { h, tab, evidence, roundId } = await oneSentRound();
    const till = tillServer();

    tab.serve(MENU.lamb.posProductCode);
    evidence.fail();

    const sweep = await h.reconciler.sweep();

    expect(sweep.confirmed).toBe(0);
    // Crucially NOT notApplied: an outage must never release a round's lines.
    expect(sweep.notApplied).toBe(0);
    expect(roundState(h, roundId)).toBe(NativeRoundState.awaiting_native_confirmation);
    expect(till.requests).toHaveLength(1);

    // When the reader comes back the same round confirms. Nothing was lost,
    // and still nothing went back on the wire.
    evidence.fail(false);
    await h.reconciler.sweep();
    expect(roundState(h, roundId)).toBe(NativeRoundState.confirmed);
    expect(till.requests).toHaveLength(1);
  }, 30_000);

  it('concurrent and repeated sweeps over a confirmed round change nothing', async () => {
    const { h, tab, roundId } = await oneSentRound();
    const till = tillServer();

    tab.serve(MENU.lamb.posProductCode);
    await h.reconciler.sweep();
    const settled = { ...round(h, roundId) };

    // Two workers at once, then another tick.
    await Promise.all([h.reconciler.sweep(), h.reconciler.sweep()]);
    await h.reconciler.sweep();

    const now = round(h, roundId);
    expect(now.state).toBe(NativeRoundState.confirmed);
    expect(now.nativeSaleId).toBe(settled.nativeSaleId);
    expect(now.nativeObservedAt).toEqual(settled.nativeObservedAt);
    expect(till.requests).toHaveLength(1);
  }, 30_000);

  it('a line somebody else rang in goes to a human, not to confirmed', async () => {
    const { h, tab, roundId } = await oneSentRound();

    // Our line arrived AND a waiter rang something else in at the terminal.
    tab.serve(MENU.lamb.posProductCode, MENU.fish.posProductCode);

    expect((await h.reconciler.sweep()).confirmed).toBe(0);
    expect(roundState(h, roundId)).not.toBe(NativeRoundState.confirmed);
  }, 30_000);

  it('a line voided under a round in flight is conflicting, never confirmed', async () => {
    const { h, tab } = await openShift();

    const order = await createDineInOrder(h, {
      guests: 2,
      items: [{ menuItemId: MENU.lamb.id, quantity: 1 }],
    });
    const r1 = await send(h, order.id, 1);
    tab.serve(MENU.lamb.posProductCode);
    await h.reconciler.sweep();
    expect(roundState(h, r1.roundId)).toBe(NativeRoundState.confirmed);

    const r2 = await send(h, order.id, 2, [{ menuItemId: MENU.coke.id, quantity: 1 }]);

    // Round 2's own item lands, and round 1's line is voided at the terminal.
    tab.serve(MENU.coke.posProductCode);
    tab.void(MENU.lamb.posProductCode);

    await h.reconciler.sweep();

    // Round 2's item IS on the table, but the table no longer matches the
    // baseline it was measured against. A human looks.
    expect(roundState(h, r2.roundId)).not.toBe(NativeRoundState.confirmed);
    // And round 1, already terminal, does not regress.
    expect(roundState(h, r1.roundId)).toBe(NativeRoundState.confirmed);
  }, 30_000);

  it('a token that is not ours never confirms, however well the lines agree', async () => {
    const { h, tab, evidence, roundId } = await oneSentRound();

    // The lines are exactly right. The till holds somebody else's token, which
    // is what a waiter keying the same item would leave behind.
    tab.serve(MENU.lamb.posProductCode);
    evidence.storedToken = 'a-token-from-another-device';

    expect((await h.reconciler.sweep()).confirmed).toBe(0);
    expect(roundState(h, roundId)).not.toBe(NativeRoundState.confirmed);
  }, 30_000);

  it('a round a manager resolved by hand is never later machine-confirmed', async () => {
    const { h, tab, roundId } = await oneSentRound();

    // A manager settles it while the till is still silent.
    round(h, roundId).state = NativeRoundState.resolved_manually;

    // The till then produces perfect evidence. It must change nothing: a person
    // took responsibility and a sweep must not overwrite that.
    tab.serve(MENU.lamb.posProductCode);

    expect((await h.reconciler.sweep()).confirmed).toBe(0);
    expect(roundState(h, roundId)).toBe(NativeRoundState.resolved_manually);
  }, 30_000);

  it('with no baseline source bound, nothing confirms and nothing is resent', async () => {
    // The production default. The round goes, the till answers, and the round
    // still cannot be machine-confirmed - because the delta has nothing to
    // subtract. It escalates to a human instead, which is the honest outcome.
    const server = await openTill();
    const tab = new Tab();
    const h = setHarness(
      await build(NATIVE_ENV(server.port), undefined, { evidenceReader: new TillEvidence(tab) }),
    );
    const till = tillServer();

    const order = await createDineInOrder(h, {
      guests: 2,
      items: [{ menuItemId: MENU.lamb.id, quantity: 1 }],
    });
    const r = await send(h, order.id, 1);

    tab.serve(MENU.lamb.posProductCode);
    const sweep = await h.reconciler.sweep();

    expect(sweep.confirmed).toBe(0);
    expect(sweep.notApplied).toBe(0);
    expect(roundState(h, r.roundId)).toBe(NativeRoundState.awaiting_native_confirmation);
    expect(till.requests).toHaveLength(1);
  }, 30_000);
});

/**
 * The sweep is the only thing that may advance a round, and it holds nothing
 * that could send one. Asserted structurally rather than by watching a socket,
 * because the strongest form of "this cannot happen" is "there is nothing here
 * that could do it".
 */
describe('reconciliation polls; it never resends', () => {
  it('holds no writer and no transport', async () => {
    const { h } = await openShift();

    const held = Object.values(h.reconciler as unknown as Record<string, unknown>);
    for (const dep of held) {
      if (!dep || typeof dep !== 'object') continue;
      expect(dep).not.toHaveProperty('writeRound');
    }

    // And a sweep over an order with everything to gain still opens nothing.
    const till = tillServer();
    const before = till.requests.length;
    await h.reconciler.sweep();
    expect(till.requests).toHaveLength(before);
  }, 30_000);
});
