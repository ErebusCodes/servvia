/**
 * RECONCILIATION POLLS. IT NEVER RESENDS.
 *
 * Those are two different operations and the difference is the entire safety
 * argument of this integration. A round whose outcome is unknown may already be
 * on the tab; looking at the till costs nothing, and sending it again is a
 * second Lamb Shank on a real customer's real bill.
 *
 * SO THE FIRST TEST IN THIS FILE IS NOT ABOUT BEHAVIOUR AT ALL. It is about the
 * service's shape: it holds no writer, no transport, and nothing that could
 * open a socket. Every other test then runs against a live fake till and
 * asserts that the socket saw nothing - because the strongest proof that
 * something cannot happen is a real listener that stays silent while it is
 * given every opportunity.
 *
 * THE OTHER HALF IS RESTART. Nothing about which rounds are outstanding lives
 * in the process. A completely new instance over the same rows resumes
 * RECONCILING them, and there is no submission state to resume because this
 * service never held any.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { ConfigService } from '@nestjs/config';

import {
  NativeRoundReconciliationService,
  type NativeRoundEvidenceReader,
} from './native-round-reconciliation.service';
import type { ReconciliationEvidence } from './waiterpad-reconciliation';
import {
  startFakeWaiterPadServer,
  type FakeWaiterPadServer,
} from './testing/fake-waiterpad-server';
import type { PrismaService } from '../../prisma/prisma.service';
// Shared with `native-order-harness.ts` on purpose. When each store owned a
// private copy of these semantics they diverged, and the production code that
// began issuing `updateMany` failed nine tests in the store that had never
// heard of it.
import { applyUpdateMany, type Row } from '../testing/prisma-filter';

const DEVICE = 'VERDURA-ACCEPT-0001';

/** What a fixture round of `n` lines asked the till to add: PLU1..PLUn, one of each. */
function expectedFor(n: number): { nativeCode: string; quantity: number }[] {
  return Array.from({ length: n }, (_, i) => ({ nativeCode: `PLU${i + 1}`, quantity: 1 }));
}

/**
 * A readback showing exactly the lines a fixture round of `n` lines was to add,
 * on a table that was free beforehand — so the delta is precisely the round.
 */
function landed(n: number): ReconciliationEvidence['currentTable'] {
  return {
    status: 'observed',
    tableCode: '5',
    pos: 1,
    map: '1',
    lines: expectedFor(n).map((i) => ({ nativeCode: i.nativeCode, quantity: i.quantity })),
  };
}

/**
 * The durable rows a restart reads back. Deliberately a plain object graph with
 * no behaviour: everything this service knows must come from here, and a store
 * that remembered anything of its own would hide a dependency on process state.
 */
class Store {
  rounds: Row[] = [];
  attempts: Row[] = [];
  items: Row[] = [];
  private seq = 0;

  /**
   * A round that was sent, and whose outcome is unknown.
   *
   * `sentAgoMs` is what drives escalation - a round that has been "awaiting the
   * till" for twenty minutes is telling staff something that is no longer true.
   */
  addSentRound(params: {
    id: string;
    state: string;
    token: string;
    sentAgoMs: number;
    lines?: number;
  }): void {
    this.seq += 1;
    this.rounds.push({
      id: params.id,
      orderId: `order-${params.id}`,
      venueId: 'venue-1',
      sequence: 1,
      idempotencyKey: `order-${params.id}:r1`,
      requestKey: null,
      state: params.state,
      posTableCode: '5',
      guests: 2,
      nativeSaleId: null,
      nativeSaleTier: null,
      nativeObservedAt: null,
      createdAt: new Date(Date.now() - params.sentAgoMs),
    });
    this.attempts.push({
      id: `attempt-${params.id}`,
      roundId: params.id,
      attemptId: `att-${params.id}`,
      externalOrderId: `order-${params.id}`,
      posTableCode: '5',
      deviceId: DEVICE,
      token: params.token,
      payloadHash: 'hash',
      sendInitiatedAt: new Date(Date.now() - params.sentAgoMs),
      // THE TWO TERMS OF THE DELTA, committed with the attempt. A fixture
      // round of N lines asked the till for PLU1..PLUN, one of each, against a
      // table that was free. Tests that want a different "before" override the
      // baseline; tests that want a different "after" pass `currentTable`.
      preSendTableSnapshot: { status: 'noOpenSale', reason: 'table was free before the send' },
      expectedNativeItems: expectedFor(params.lines ?? 1),
    });
    for (let i = 0; i < (params.lines ?? 1); i += 1) {
      this.items.push({
        id: `item-${params.id}-${i}`,
        orderId: `order-${params.id}`,
        nativeRoundId: params.id,
      });
    }
  }

  round(id: string): Row {
    const r = this.rounds.find((x) => x.id === id);
    if (!r) throw new Error(`no round ${id}`);
    return r;
  }

  linesOf(id: string): Row[] {
    return this.items.filter((i) => i.nativeRoundId === id);
  }

  asPrisma(): PrismaService {
    const api = {
      $transaction: <T>(cb: (tx: unknown) => Promise<T>): Promise<T> => cb(api),
      nativeTableRound: {
        findMany: ({ where, take }: { where: Row; take?: number }) => {
          const states = (where.state as { in: string[] }).in;
          return Promise.resolve(
            this.rounds
              .filter((r) => states.includes(r.state as string))
              .slice(0, take ?? 50)
              .map((r) => ({
                ...r,
                attempts: this.attempts
                  .filter((a) => a.roundId === r.id)
                  .sort(
                    (a, b) =>
                      (b.sendInitiatedAt as Date).getTime() - (a.sendInitiatedAt as Date).getTime(),
                  )
                  .slice(0, 1),
                items: this.linesOf(r.id as string),
              })),
          );
        },
        update: ({ where, data }: { where: { id: string }; data: Row }) => {
          const r = this.round(where.id);
          Object.assign(r, data);
          return Promise.resolve(r);
        },
        /**
         * The conditional write every verdict in this sweep goes through.
         *
         * `markConfirmed`, `markNotApplied` and `escalate` all name the state
         * they expect to still find, so that a round a MANAGER settled between
         * this sweep's read and its write matches nothing and keeps their
         * resolution. `count === 0` is how the sweep learns it lost, and
         * `markNotApplied` in particular refuses to touch the lines when it
         * does - which is the difference between leaving a settled round alone
         * and putting its food onto a second bill.
         */
        updateMany: ({ where, data }: { where?: Row; data: Row }) =>
          Promise.resolve(applyUpdateMany(this.rounds, where, data)),
      },
      orderItem: {
        updateMany: ({ where, data }: { where: Row; data: Row }) =>
          Promise.resolve(applyUpdateMany(this.items, where, data)),
      },
    };
    return api as unknown as PrismaService;
  }
}

function config(over: Record<string, string> = {}): ConfigService {
  const env: Record<string, string> = {
    IDEALPOS_NATIVE_RECONCILE_ENABLED: 'true',
    IDEALPOS_NATIVE_RECONCILE_ESCALATE_AFTER_MS: String(5 * 60_000),
    ...over,
  };
  return { get: (key: string) => env[key] } as unknown as ConfigService;
}

/** A reader that answers with fixed evidence, and records that it was asked. */
/**
 * A bound evidence reader.
 *
 * IT SUPPLIES BOTH HALVES OF A CONFIRMATION BY DEFAULT, because since
 * 2026-09-11 neither half alone reaches `confirmed`: the till's token proves
 * our packet was picked up (causal) and a readback proves the lines are on the
 * tab (durable), and the token is written by `ProcessHandheldOrder` BEFORE the
 * lines are, so it cannot speak for them. A test that wants to withhold the
 * durable half passes `currentTable: undefined` explicitly, which is how "did
 * not look" is spelled.
 *
 * THE DURABLE HALF IS A DELTA, so the default here is a baseline of a FREE
 * table and a readback showing exactly the one line the fixture round expects.
 * A count would not do: a readback of "one line present" says nothing unless
 * you know what was there before.
 */
function reader(evidence: ReconciliationEvidence): NativeRoundEvidenceReader & { calls: number } {
  const withDurable: ReconciliationEvidence = {
    preSendTable: { status: 'noOpenSale', reason: 'table was free before the send' },
    currentTable: landed(1),
    ...evidence,
  };
  const r = {
    calls: 0,
    readEvidence: () => {
      r.calls += 1;
      return Promise.resolve(withDurable);
    },
  };
  return r;
}

function build(
  store: Store,
  evidenceReader: NativeRoundEvidenceReader | null = null,
  over: Record<string, string> = {},
): NativeRoundReconciliationService {
  return new NativeRoundReconciliationService(store.asPrisma(), config(over), evidenceReader);
}

let server: FakeWaiterPadServer | null = null;
afterEach(async () => {
  await server?.close();
  server = null;
});

// ═════════════════════════════════════════════════════════════════════════
describe('it cannot resend, by construction', () => {
  it('names no writer and no transport anywhere in its own source', () => {
    // The FILE is the guarantee, read as text. A future edit wanting to resend
    // from here would have to import a writer or a socket, and that import
    // would fail this assertion before any behaviour changed.
    const raw = readFileSync(join(__dirname, 'native-round-reconciliation.service.ts'), 'utf8');
    // Comments stripped first. The header discusses the writer at length -
    // explaining exactly why it is absent - and an assertion that could be
    // satisfied by deleting an explanation would be measuring the wrong thing.
    // What must be absent is CODE.
    const source = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

    // No transport, at all.
    for (const forbidden of ['node:net', "from 'net'", "from 'tls'", "from 'dgram'"]) {
      expect(source).not.toContain(forbidden);
    }
    // No writer, and no way to reach one.
    expect(source).not.toMatch(/TABLE_ROUND_WRITER|ITableRoundWriter|WaiterPadTableRoundWriter/);
    // And no call that could send a round, under any of its names. (The words
    // appear in prose above; only CALLS are excluded, hence the parenthesis.)
    expect(source).not.toMatch(/\.(writeRound|sendRound|submitRound|openRound|sendToKitchen)\s*\(/);
  });

  it('opens no connection to a listening till, however many rounds it settles', async () => {
    // A REAL listener, on a real port, for the whole sweep. If anything in the
    // reconciler could send, this is where it would show up.
    server = await startFakeWaiterPadServer({ kind: 'ack' });

    const store = new Store();
    store.addSentRound({
      id: 'r1',
      state: 'awaiting_native_confirmation',
      token: 'tok-1',
      sentAgoMs: 0,
    });
    store.addSentRound({ id: 'r2', state: 'unresolved', token: 'tok-2', sentAgoMs: 60 * 60_000 });
    store.addSentRound({
      id: 'r3',
      state: 'awaiting_native_confirmation',
      token: 'tok-3',
      sentAgoMs: 60 * 60_000,
    });

    // Confirms r1 (its token is the one the till holds) and escalates r3.
    const service = build(store, reader({ storedTokenForDevice: 'tok-1' }));
    const result = await service.sweep();

    expect(result.examined).toBe(3);
    expect(result.confirmed).toBeGreaterThan(0);

    // NOT ONE BYTE, NOT ONE CONNECTION.
    expect(server.connections).toBe(0);
    expect(server.requests).toHaveLength(0);
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe('confirming, and refusing to confirm', () => {
  it('confirms ONLY on our own token against our own device AND a readback', async () => {
    const store = new Store();
    store.addSentRound({
      id: 'r1',
      state: 'awaiting_native_confirmation',
      token: 'tok-1',
      sentAgoMs: 0,
    });

    const result = await build(store, reader({ storedTokenForDevice: 'tok-1' })).sweep();

    expect(result.confirmed).toBe(1);
    const round = store.round('r1');
    expect(round.state).toBe('confirmed');
    // The tier records WHY it was confirmed. `causal` is the only tier that may
    // confirm - a table-code or content match is corroboration, and
    // corroboration cannot tell "we caused this" from "a waiter keyed the same
    // items while we were deciding".
    expect(round.nativeSaleTier).toBe('causal');
    expect(round.nativeSaleId).toBe('tok-1');
    expect(round.nativeObservedAt).toBeInstanceOf(Date);
  });

  it('does NOT confirm on a docket, a table match or a line count - only the token', async () => {
    const store = new Store();
    store.addSentRound({
      id: 'r1',
      state: 'awaiting_native_confirmation',
      token: 'tok-1',
      sentAgoMs: 0,
      lines: 2,
    });

    // Everything short of the token says yes. It is still not enough: a waiter
    // keying the same two items at the till produces exactly this picture.
    const result = await build(
      store,
      reader({
        processedForTableAfterSend: true,
        kitchenFiredAfterSend: true,
        currentTable: landed(2),
      }),
    ).sweep();

    expect(result.confirmed).toBe(0);
    expect(store.round('r1').state).toBe('awaiting_native_confirmation');
  });

  it('confirms nothing at all when no evidence reader is bound - production today', async () => {
    const store = new Store();
    store.addSentRound({
      id: 'r1',
      state: 'awaiting_native_confirmation',
      token: 'tok-1',
      sentAgoMs: 0,
    });

    const result = await build(store, null).sweep();

    // NOT LOOKING IS NOT THE SAME AS FINDING NOTHING. With no reader every
    // evidence field is `undefined`, which the predicate reads as ignorance -
    // never as "the till holds nothing", which would confirm a not-applied
    // verdict drawn from never having looked.
    expect(result.readerBound).toBe(false);
    expect(result.confirmed).toBe(0);
    expect(result.notApplied).toBe(0);
    expect(result.stillPending).toBe(1);
    expect(store.round('r1').state).toBe('awaiting_native_confirmation');
  });
});

// ═════════════════════════════════════════════════════════════════════════
/**
 * THE TOKEN IS WRITTEN BEFORE THE SALE EXISTS, so it cannot confirm on its own.
 *
 * `SaveChecksum` - the only writer of AAAExampleData for our DeviceID - is
 * called from inside `ProcessHandheldOrder` at 0x01827301, ahead of the
 * receiver's own `DELETE * FROM PendingSales` at 0x01827709 and ahead of every
 * line write. A stored token therefore proves our packet was PICKED UP and
 * says nothing about the customer's bill; the window it leaves open is a till
 * that has deleted the table's previous order and not yet written the new one.
 */
describe('our token alone is receipt, not application', () => {
  it('does not confirm when nobody read the table back', async () => {
    const store = new Store();
    store.addSentRound({
      id: 'r1',
      state: 'awaiting_native_confirmation',
      token: 'tok-1',
      sentAgoMs: 0,
    });

    const result = await build(
      store,
      reader({
        storedTokenForDevice: 'tok-1',
        // "Did not look" - which is ignorance, never absence.
        currentTable: undefined,
      }),
    ).sweep();

    expect(result.confirmed).toBe(0);
    expect(store.round('r1').state).toBe('awaiting_native_confirmation');
    // And nothing is fabricated onto the round on the way past.
    expect(store.round('r1').nativeSaleTier ?? null).toBeNull();
    expect(store.round('r1').nativeSaleId ?? null).toBeNull();
  });

  it('does not confirm when the readback shows fewer lines than the round was to add', async () => {
    // The crash window, exactly: token written, lines not.
    const store = new Store();
    store.addSentRound({
      id: 'r1',
      state: 'awaiting_native_confirmation',
      token: 'tok-1',
      sentAgoMs: 0,
      lines: 3,
    });

    const result = await build(
      store,
      reader({
        storedTokenForDevice: 'tok-1',
        // One of the three arrived. The delta is short, so nothing is proven.
        currentTable: landed(1),
      }),
    ).sweep();

    expect(result.confirmed).toBe(0);
    expect(store.round('r1').state).toBe('awaiting_native_confirmation');
    // NOR does it go the other way. Failing to confirm is not proof of absence,
    // and the lines stay claimed by this round.
    expect(result.notApplied).toBe(0);
    expect(store.linesOf('r1')).toHaveLength(3);
  });

  it('does not confirm on a readback alone - that is correlation, not causality', async () => {
    const store = new Store();
    store.addSentRound({
      id: 'r1',
      state: 'awaiting_native_confirmation',
      token: 'tok-1',
      sentAgoMs: 0,
      lines: 2,
    });

    // The lines are on the table, but nothing ties them to OUR packet: a
    // waiter keying the same two items produces exactly this evidence.
    const result = await build(
      store,
      reader({
        storedTokenForDevice: undefined,
        currentTable: landed(2),
      }),
    ).sweep();

    expect(result.confirmed).toBe(0);
    expect(store.round('r1').state).toBe('awaiting_native_confirmation');
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe('a round proven not to have landed', () => {
  it('is marked failed and gives its lines back, so the next round carries them', async () => {
    const store = new Store();
    store.addSentRound({ id: 'r1', state: 'unresolved', token: 'tok-1', sentAgoMs: 0, lines: 2 });

    // The till holds a DIFFERENT token and nothing was processed for the table:
    // the two conditions together, which is the only way this verdict is
    // reachable.
    const result = await build(
      store,
      reader({ storedTokenForDevice: 'someone-elses-token', processedForTableAfterSend: false }),
    ).sweep();

    expect(result.notApplied).toBe(1);
    expect(store.round('r1').state).toBe('failed');
    // The point of the release: this is food a customer ordered and did not
    // get. Leaving the lines claimed by a dead round would strand them.
    expect(store.linesOf('r1')).toHaveLength(0);
    expect(store.items.every((i) => i.nativeRoundId === null)).toBe(true);
  });

  it('never releases lines on ambiguity - only on the two-condition proof', async () => {
    const store = new Store();
    store.addSentRound({ id: 'r1', state: 'unresolved', token: 'tok-1', sentAgoMs: 0, lines: 2 });

    // A different token, but processing WAS observed for the table. That is
    // ambiguous, not negative - and releasing here would set up a resend of a
    // round that may well be on the tab.
    const result = await build(
      store,
      reader({ storedTokenForDevice: 'someone-elses-token', processedForTableAfterSend: true }),
    ).sweep();

    expect(result.notApplied).toBe(0);
    expect(store.round('r1').state).toBe('unresolved');
    expect(store.linesOf('r1')).toHaveLength(2);
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe('escalation: an unproven round gets more alarming with age, not less', () => {
  it('downgrades a long-awaiting round to unresolved, and touches nothing else', async () => {
    const store = new Store();
    store.addSentRound({
      id: 'r1',
      state: 'awaiting_native_confirmation',
      token: 'tok-1',
      sentAgoMs: 20 * 60_000,
      lines: 2,
    });

    const result = await build(store, null).sweep();

    expect(result.escalated).toBe(1);
    // "Sent — waiting for the till" would sit there all night looking like
    // progress. `unresolved` is the state that puts it in front of a human.
    expect(store.round('r1').state).toBe('unresolved');
    // State only. No lines moved, so nothing became re-sendable as a
    // side effect of a clock.
    expect(store.linesOf('r1')).toHaveLength(2);
  });

  it('leaves a round that is still inside its window alone', async () => {
    const store = new Store();
    store.addSentRound({
      id: 'r1',
      state: 'awaiting_native_confirmation',
      token: 'tok-1',
      sentAgoMs: 30_000,
    });

    const result = await build(store, null).sweep();

    expect(result.escalated).toBe(0);
    expect(result.stillPending).toBe(1);
    expect(store.round('r1').state).toBe('awaiting_native_confirmation');
  });

  it('does not escalate a round that is already unresolved - there is nowhere worse to go', async () => {
    const store = new Store();
    store.addSentRound({ id: 'r1', state: 'unresolved', token: 'tok-1', sentAgoMs: 60 * 60_000 });

    const result = await build(store, null).sweep();

    expect(result.escalated).toBe(0);
    expect(store.round('r1').state).toBe('unresolved');
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe('a restart resumes reconciliation, and only reconciliation', () => {
  it('a brand new instance picks up the same outstanding rounds from the database', async () => {
    server = await startFakeWaiterPadServer({ kind: 'ack' });

    const store = new Store();
    store.addSentRound({
      id: 'r1',
      state: 'awaiting_native_confirmation',
      token: 'tok-1',
      sentAgoMs: 0,
    });
    store.addSentRound({ id: 'r2', state: 'unresolved', token: 'tok-2', sentAgoMs: 0 });

    // ── Before the restart: a sweep that settles nothing, because no reader
    //    is bound. Both rounds stay outstanding. ──
    const before = build(store, null);
    const first = await before.sweep();
    expect(first.examined).toBe(2);
    expect(first.confirmed).toBe(0);

    // ── The restart. A completely new service over the SAME rows. Nothing in
    //    memory survives, and nothing needed to: which rounds are outstanding
    //    was never in this process. ──
    const after = build(store, reader({ storedTokenForDevice: 'tok-2' }));
    const second = await after.sweep();

    expect(second.examined).toBe(2);
    // It resumed RECONCILING - and settled the one the evidence covers.
    expect(second.confirmed).toBe(1);
    expect(store.round('r2').state).toBe('confirmed');
    expect(store.round('r1').state).toBe('awaiting_native_confirmation');

    // AND IT RESUMED NOTHING ELSE. There is no submission to resume, because
    // this service has never held any - the till saw nothing across both
    // sweeps and the restart between them.
    expect(server.connections).toBe(0);
    expect(server.requests).toHaveLength(0);
  });

  it('sweeping repeatedly is idempotent - a confirmed round is not re-examined', async () => {
    const store = new Store();
    store.addSentRound({
      id: 'r1',
      state: 'awaiting_native_confirmation',
      token: 'tok-1',
      sentAgoMs: 0,
    });

    const evidence = reader({ storedTokenForDevice: 'tok-1' });
    const service = build(store, evidence);

    await service.sweep();
    expect(store.round('r1').state).toBe('confirmed');
    const asked = evidence.calls;

    // A confirmed round is outside the reconcilable set entirely, so the next
    // tick does not even ask the till about it. Reconciliation polling must not
    // grow without bound as a service fills up with settled rounds.
    const again = await service.sweep();
    expect(again.examined).toBe(0);
    expect(evidence.calls).toBe(asked);
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe('a reader that misbehaves', () => {
  it('does not stop the sweep, and settles nothing on the round that threw', async () => {
    const store = new Store();
    store.addSentRound({
      id: 'r1',
      state: 'awaiting_native_confirmation',
      token: 'tok-1',
      sentAgoMs: 0,
    });
    store.addSentRound({
      id: 'r2',
      state: 'awaiting_native_confirmation',
      token: 'tok-2',
      sentAgoMs: 0,
    });

    let call = 0;
    const flaky: NativeRoundEvidenceReader = {
      readEvidence: () => {
        call += 1;
        if (call === 1) return Promise.reject(new Error('the till log was unreadable'));
        // Both halves, because since 2026-09-11 neither confirms alone.
        return Promise.resolve({
          storedTokenForDevice: 'tok-2',
          preSendTable: { status: 'noOpenSale' as const, reason: 'free before the send' },
          currentTable: landed(1),
        });
      },
    };

    const result = await build(store, flaky).sweep();

    expect(result.errored).toBe(1);
    // An unreadable log is ignorance, and ignorance settles nothing. The round
    // is untouched and will be looked at again next tick.
    expect(store.round('r1').state).toBe('awaiting_native_confirmation');
    // And one bad round does not cost the others their tick.
    expect(result.confirmed).toBe(1);
    expect(store.round('r2').state).toBe('confirmed');
  });
});
