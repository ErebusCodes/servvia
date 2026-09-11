/**
 * EVERY CRASH BOUNDARY, AND WHAT A RESTART IS ALLOWED TO DO ABOUT IT.
 *
 * THE HOLE. A round left `submitting` occupied its table's single in-flight
 * slot and was swept by nothing: the reconciler's candidate set is
 * `[awaiting_native_confirmation, unresolved]`, `sendRound` only touches
 * `drafting`, manual resolution only touches `unresolved`. So an API restart
 * during a service - a deploy, a crash, a Windows update - permanently killed
 * every table with a round in flight at that instant, and the tablet showed
 * nothing alarming because `submitting` reports `requiresReconciliation:
 * false`. Staff found out by pressing Send and getting a 409 that never
 * stopped.
 *
 * THE PROPERTY UNDER TEST, and the only one that matters: RELEASE REQUIRES
 * PROOF. A round may have its lines given back only where the durable rows
 * establish that nothing was written. Everywhere else - including everywhere
 * that is merely unclear - the lines stay claimed and the round becomes a
 * human's problem. Getting this backwards puts a second copy of a customer's
 * food on a bill nobody re-reads, so each boundary below asserts the verdict,
 * the lines, the table, AND that no socket was opened.
 *
 * A CRASH IS MODELLED AS A NEW PROCESS OVER THE SAME ROWS. `build(env, ledger)`
 * gives brand new services, timers and sockets against the durable state the
 * dead instance left behind - which is the only honest way to test this,
 * because anything the new instance concludes it must have concluded from the
 * database.
 */

import { NativeRoundState } from '@prisma/client';

import {
  ACTOR,
  build,
  closeHarness,
  createDineInOrder,
  installHarnessLifecycle,
  MENU,
  NATIVE_ENV,
  openTill,
  setHarness,
  tillServer,
  VENUE,
  type Harness,
} from '../testing/native-order-harness';
import { startFakeWaiterPadServer } from './testing/fake-waiterpad-server';
import { ConfigService } from '@nestjs/config';

import type { PrismaService } from '../../prisma/prisma.service';
import { decideRecovery, NativeRoundRecoveryService } from './native-round-recovery.service';

installHarnessLifecycle();

const REQUEST = {
  user: {
    id: ACTOR.id,
    email: ACTOR.email,
    role: ACTOR.role,
    organizationId: VENUE.organizationId,
    venueId: VENUE.id,
  },
} as never;

const REQ = (n: number): string => `recovery-press-${n}-0123456789abc`;

/** Old enough that recovery will judge it rather than leave it alone. */
const LONG_AGO = new Date(Date.now() - 60 * 60_000);

async function open(): Promise<Harness> {
  const till = await openTill();
  return setHarness(await build(NATIVE_ENV(till.port)));
}

const unclaimed = (h: Harness): unknown[] => h.ledger.items.filter((i) => i.nativeRoundId == null);

// ═══════════════════════════════════════════════════════════════════════════
describe('the decision table, boundary by boundary', () => {
  // ═════════════════════════════════════════════════════════════════════════
  //
  // The verdict as a pure function of durable evidence, so every boundary can
  // be stated exactly rather than approximated by arranging a crash.

  const MIN_AGE = 5 * 60_000;
  const old = { ageMs: 60 * 60_000 };

  it('BOUNDARY 1 - crash before the attempt row: nothing was sent, so release', () => {
    // `recordSendInitiated` is awaited to durability BEFORE the socket opens.
    // No attempt row is therefore positive evidence, not merely absent
    // evidence - which is the distinction the whole module turns on.
    const v = decideRecovery(
      { state: NativeRoundState.submitting, ...old, hasAttempt: false, bytesLeftHost: null },
      MIN_AGE,
    );
    expect(v.kind).toBe('released');
  });

  it('BOUNDARY 2 - crash between openRound and the submitting write: release', () => {
    const v = decideRecovery(
      { state: NativeRoundState.drafting, ...old, hasAttempt: false, bytesLeftHost: null },
      MIN_AGE,
    );
    expect(v.kind).toBe('released');
  });

  it('BOUNDARY 3 - attempt persisted, socket never written: release', () => {
    const v = decideRecovery(
      { state: NativeRoundState.submitting, ...old, hasAttempt: true, bytesLeftHost: false },
      MIN_AGE,
    );
    expect(v.kind).toBe('released');
  });

  it('BOUNDARY 4 - attempt persisted, outcome never recorded: RECONCILE ONLY', () => {
    // The widest and most dangerous window. The packet may be in the
    // receiver's buffer, on the tab, or already printed in the kitchen.
    const v = decideRecovery(
      { state: NativeRoundState.submitting, ...old, hasAttempt: true, bytesLeftHost: null },
      MIN_AGE,
    );
    expect(v.kind).toBe('unresolved');
  });

  it('BOUNDARY 5 - bytes durably left the host: RECONCILE ONLY', () => {
    const v = decideRecovery(
      { state: NativeRoundState.submitting, ...old, hasAttempt: true, bytesLeftHost: true },
      MIN_AGE,
    );
    expect(v.kind).toBe('unresolved');
  });

  it('never releases a round whose bytes may have gone, at any age', () => {
    // The asymmetry, asserted directly: age is a reason to LOOK at a round, and
    // never a reason to trust it more.
    for (const ageMs of [MIN_AGE, MIN_AGE * 10, MIN_AGE * 1000]) {
      for (const bytesLeftHost of [true, null]) {
        const v = decideRecovery(
          { state: NativeRoundState.submitting, ageMs, hasAttempt: true, bytesLeftHost },
          MIN_AGE,
        );
        expect(v.kind).toBe('unresolved');
      }
    }
  });

  it('leaves a young round alone, because a live request is probably holding it', () => {
    // Recovering a round whose socket is open THIS INSTANT would race the
    // writer it exists to clean up after - and on the release branch would give
    // back the lines of a round that is being sent.
    const v = decideRecovery(
      {
        state: NativeRoundState.submitting,
        ageMs: 1_000,
        hasAttempt: false,
        bytesLeftHost: null,
      },
      MIN_AGE,
    );
    expect(v.kind).toBe('stillInFlight');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('a restart over the same rows', () => {
  // ═════════════════════════════════════════════════════════════════════════

  it('frees a table killed by a crash before any attempt was recorded', async () => {
    const h = await open();
    const order = await createDineInOrder(h, {
      items: [{ menuItemId: MENU.lamb.id, quantity: 1 }],
    });
    await h.rounds.submitRound(REQUEST, order.id, { items: [], requestKey: REQ(1) });

    // THE CRASH: the process died mid-send. Its durable trace is a round stuck
    // in `submitting` with the attempt row it never got to write.
    const round = h.ledger.rounds[0];
    round.state = NativeRoundState.submitting;
    round.updatedAt = LONG_AGO;
    h.ledger.attempts.length = 0;

    // A NEW PROCESS starts over those rows.
    await closeHarness(h);
    const till2 = await startFakeWaiterPadServer({ kind: 'ack' });
    const restarted = setHarness(await build(NATIVE_ENV(till2.port), h.ledger));
    try {
      const swept = await restarted.recovery.sweep();
      expect(swept.examined).toBe(1);
      expect(swept.released).toBe(1);

      // Settled, lines back, table free.
      expect(round.state).toBe(NativeRoundState.abandoned);
      expect(unclaimed(restarted)).toHaveLength(1);

      // AND THE TABLE WORKS AGAIN. This is the whole point: before recovery
      // existed, this call answered `round_in_flight` forever.
      const retry = await restarted.rounds.submitRound(REQUEST, order.id, {
        items: [],
        requestKey: REQ(2),
      });
      expect(retry.status).toBe('sentAwaitingConfirmation');
      expect(till2.requests).toHaveLength(1);
      expect(till2.requests[0]).toContain(`<StockItem>${MENU.lamb.posProductCode}</StockItem>`);
    } finally {
      await till2.close();
    }
  });

  it('escalates rather than releases when bytes may have gone, and never resends', async () => {
    const h = await open();
    const order = await createDineInOrder(h, {
      items: [{ menuItemId: MENU.lamb.id, quantity: 1 }],
    });
    await h.rounds.submitRound(REQUEST, order.id, { items: [], requestKey: REQ(1) });

    // THE CRASH: after the socket, before the outcome was written. The attempt
    // row stands with no outcome on it - the shape a `kill -9` mid-exchange
    // leaves behind.
    const round = h.ledger.rounds[0];
    round.state = NativeRoundState.submitting;
    round.updatedAt = LONG_AGO;
    for (const a of h.ledger.attempts) {
      a.bytesLeftHost = null;
      a.outcomeKind = null;
      a.settledAt = null;
    }

    await closeHarness(h);
    const till2 = await startFakeWaiterPadServer({ kind: 'ack' });
    const restarted = setHarness(await build(NATIVE_ENV(till2.port), h.ledger));
    try {
      const swept = await restarted.recovery.sweep();
      expect(swept.unresolved).toBe(1);
      expect(swept.released).toBe(0);

      expect(round.state).toBe(NativeRoundState.unresolved);
      // LINES STAY CLAIMED. This is what stops them reaching a later round.
      expect(unclaimed(restarted)).toHaveLength(0);
      // RECOVERY OPENED NO SOCKET. A live listener heard nothing at all.
      expect(till2.requests).toHaveLength(0);
      expect(till2.connections).toBe(0);
      // And no second attempt was minted.
      expect(restarted.ledger.attempts).toHaveLength(1);
    } finally {
      await till2.close();
    }
  });

  it('an escalated round is a human problem, not a blocked table forever', async () => {
    const h = await open();
    const order = await createDineInOrder(h, {
      items: [{ menuItemId: MENU.lamb.id, quantity: 1 }],
    });
    await h.rounds.submitRound(REQUEST, order.id, { items: [], requestKey: REQ(1) });
    const round = h.ledger.rounds[0];
    round.state = NativeRoundState.submitting;
    round.updatedAt = LONG_AGO;
    for (const a of h.ledger.attempts) a.bytesLeftHost = true;

    await h.recovery.sweep();
    expect(round.state).toBe(NativeRoundState.unresolved);

    // The readback now TELLS staff, which `submitting` never did: it reported
    // `requiresReconciliation: false` and a calm "being sent right now".
    const [row] = (await h.rounds.listRounds(REQUEST, order.id)).rounds;
    expect(row.status).toBe('unresolved');
    expect(row.requiresReconciliation).toBe(true);
    expect(row.message).toContain('DO NOT send it again');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('it is idempotent, and two workers cannot disagree', () => {
  // ═════════════════════════════════════════════════════════════════════════

  it('sweeping repeatedly settles a round once and then finds nothing', async () => {
    const h = await open();
    const order = await createDineInOrder(h, {
      items: [{ menuItemId: MENU.lamb.id, quantity: 1 }],
    });
    await h.rounds.submitRound(REQUEST, order.id, { items: [], requestKey: REQ(1) });
    const round = h.ledger.rounds[0];
    round.state = NativeRoundState.submitting;
    round.updatedAt = LONG_AGO;
    h.ledger.attempts.length = 0;

    const first = await h.recovery.sweep();
    expect(first.released).toBe(1);

    // A settled round is outside the candidate set entirely, so the second
    // pass has nothing to look at - not merely nothing to change.
    const second = await h.recovery.sweep();
    expect(second.examined).toBe(0);
    expect(second.released).toBe(0);
    expect(unclaimed(h)).toHaveLength(1);
  });

  it('two workers racing the same round settle it exactly once', async () => {
    const h = await open();
    const order = await createDineInOrder(h, {
      items: [{ menuItemId: MENU.lamb.id, quantity: 1 }],
    });
    await h.rounds.submitRound(REQUEST, order.id, { items: [], requestKey: REQ(1) });
    const round = h.ledger.rounds[0];
    round.state = NativeRoundState.submitting;
    round.updatedAt = LONG_AGO;
    h.ledger.attempts.length = 0;

    // A second instance over the same rows - two API processes coming up
    // together after a restart, which is the ordinary case on a redeploy.
    const till2 = await startFakeWaiterPadServer({ kind: 'ack' });
    const worker2 = await build(NATIVE_ENV(till2.port), h.ledger);
    try {
      const [a, b] = await Promise.all([h.recovery.sweep(), worker2.recovery.sweep()]);

      // Exactly one release across both, because the write is a compare-and-set
      // naming the state each sweep read. The loser changes nothing.
      expect(a.released + b.released).toBe(1);
      expect(round.state).toBe(NativeRoundState.abandoned);
      // AND THE LINES WERE RELEASED ONCE, not twice - a double release would
      // be invisible here but is exactly what the transaction ordering exists
      // to prevent, so assert the end state precisely.
      expect(unclaimed(h)).toHaveLength(1);
    } finally {
      await worker2.module.close();
      await till2.close();
    }
  });

  it('does not touch a round a live request is still sending', async () => {
    const h = await open();
    const order = await createDineInOrder(h, {
      items: [{ menuItemId: MENU.lamb.id, quantity: 1 }],
    });
    await h.rounds.submitRound(REQUEST, order.id, { items: [], requestKey: REQ(1) });
    const round = h.ledger.rounds[0];
    // Mid-send RIGHT NOW: `submitting`, and only moments old.
    round.state = NativeRoundState.submitting;
    round.updatedAt = new Date();

    const swept = await h.recovery.sweep();
    expect(swept.stillInFlight).toBe(1);
    expect(swept.released).toBe(0);
    expect(swept.unresolved).toBe(0);
    expect(round.state).toBe(NativeRoundState.submitting);
    // Its lines were NOT given back to a round that is being sent this instant.
    expect(unclaimed(h)).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('no durable state is invisible to every sweeper', () => {
  // ═════════════════════════════════════════════════════════════════════════

  it('every state is reachable by recovery, reconciliation, a route, or is terminal', async () => {
    // A live till is opened so the closing assertion - that establishing this
    // contract sends nothing - has a real listener behind it.
    await open();

    // The contract, written out. A state that is in none of these columns is a
    // round that can own lines, block a table, and be reached by nothing -
    // which is precisely what `submitting` was.
    const RECOVERABLE: NativeRoundState[] = [
      NativeRoundState.drafting,
      NativeRoundState.submitting,
    ];
    const RECONCILABLE: NativeRoundState[] = [
      NativeRoundState.awaiting_native_confirmation,
      NativeRoundState.unresolved,
    ];
    const MANUALLY_RESOLVABLE: NativeRoundState[] = [NativeRoundState.unresolved];
    const TERMINAL: NativeRoundState[] = [
      NativeRoundState.confirmed,
      NativeRoundState.rejected,
      NativeRoundState.failed,
      NativeRoundState.abandoned,
      NativeRoundState.resolved_manually,
    ];

    const covered = new Set<string>([
      ...RECOVERABLE,
      ...RECONCILABLE,
      ...MANUALLY_RESOLVABLE,
      ...TERMINAL,
    ]);

    for (const state of Object.values(NativeRoundState)) {
      expect(covered.has(state)).toBe(true);
    }
    // And no terminal state holds an in-flight slot, so none of them can block
    // a table while being unreachable.
    expect(TERMINAL.some((s) => RECOVERABLE.includes(s) || RECONCILABLE.includes(s))).toBe(false);
    expect(tillServer().requests).toHaveLength(0);
  });
});

// ═════════════════════════════════════════════════════════════════════════
/**
 * THE AGE GATE IS MEASURED ON THE DATABASE'S CLOCK, NOT THIS PROCESS'S.
 *
 * `NativeTableRound.updatedAt` is written by POSTGRES. The sweep used to
 * compare it against `new Date()` in the API process, so the difference
 * between two machines' clocks went straight into `ageMs`. The repository's
 * own PostgreSQL integration spec found it, by failing intermittently against
 * a containerised database whose clock wandered either side of the host's.
 *
 * At the shipped five-minute gate a few milliseconds are nothing and nobody
 * would ever have seen it. THE DIRECTION THAT MATTERS IS THE OTHER ONE: a
 * database clock LAGGING the API by more than the gate inflates every age by
 * exactly that lag, defeats the gate entirely, and lets this sweep judge a
 * round a LIVE request is still sending - releasing the lines of a send that
 * is on the wire, which is the one outcome this service exists to prevent.
 *
 * Asserted here rather than against a real database because a test that waits
 * for two machines to disagree by five minutes cannot be written. The database
 * clock is a stub, moved deliberately, and the only question asked is which of
 * the two clocks the verdict followed.
 */
describe('the clock the age gate is measured on', () => {
  const GATE_MS = 5 * 60_000;

  /**
   * One `submitting` round, with BOTH the database's clock and the instant the
   * database stamped `updatedAt` under the test's control.
   */
  function recoveryOver(databaseNow: Date, updatedAt: Date) {
    const round = {
      id: 'round-1',
      state: NativeRoundState.submitting,
      updatedAt,
      attempts: [] as unknown[],
    };
    const updates: Record<string, unknown>[] = [];

    const prisma = {
      $queryRaw: () => Promise.resolve([{ now: databaseNow }]),
      nativeTableRound: {
        findMany: () => Promise.resolve([round]),
        updateMany: ({ data }: { data: Record<string, unknown> }) => {
          updates.push(data);
          return Promise.resolve({ count: 1 });
        },
      },
      orderItem: { updateMany: () => Promise.resolve({ count: 1 }) },
      $transaction: <T>(cb: (tx: unknown) => Promise<T>): Promise<T> => cb(prisma),
    } as unknown as PrismaService;

    const config = {
      get: (key: string) =>
        ({
          IDEALPOS_NATIVE_RECONCILE_ENABLED: 'true',
          IDEALPOS_NATIVE_RECOVERY_MIN_AGE_MS: String(GATE_MS),
        })[key],
    } as unknown as ConfigService;

    return { service: new NativeRoundRecoveryService(prisma, config), round, updates };
  }

  it('refuses to judge a fresh round even when THIS process thinks it is old', async () => {
    // THE DANGEROUS SKEW, and the whole reason for the change. The database's
    // clock is six minutes BEHIND this process. The round was stamped by the
    // database a moment ago, so by the only clock that wrote it the round is
    // FRESH - a live request may be holding it this instant. A sweep measuring
    // against its own clock would compute an age of six minutes, clear the
    // five-minute gate, and release the lines of a send that is on the wire.
    const databaseNow = new Date(Date.now() - (GATE_MS + 60_000));
    const { service, round, updates } = recoveryOver(databaseNow, databaseNow);

    const swept = await service.sweep();

    expect(swept.stillInFlight).toBe(1);
    expect(swept.released).toBe(0);
    expect(updates).toHaveLength(0);
    expect(round.state).toBe(NativeRoundState.submitting);
  });

  it("judges a genuinely old round on the database's own reckoning", async () => {
    // The same service and the same gate; the only change is that the round is
    // old BY THE DATABASE'S CLOCK. Without this, the test above would pass
    // just as well against a sweep that had stopped working altogether.
    const databaseNow = new Date(Date.now() - (GATE_MS + 60_000));
    const { service, updates } = recoveryOver(
      databaseNow,
      new Date(databaseNow.getTime() - (GATE_MS + 60_000)),
    );

    const swept = await service.sweep();

    expect(swept.stillInFlight).toBe(0);
    expect(swept.released).toBe(1);
    expect(updates).toHaveLength(1);
  });

  it('falls back to this process rather than failing when the clock cannot be read', async () => {
    // A database that will not answer `SELECT now()` must not stop recovery.
    // The fallback is exactly the behaviour that shipped before this change,
    // and is still bounded by a gate measured in minutes.
    const prisma = {
      $queryRaw: () => Promise.reject(new Error('connection terminated')),
      nativeTableRound: {
        findMany: () =>
          Promise.resolve([
            {
              id: 'round-1',
              state: NativeRoundState.submitting,
              updatedAt: new Date(Date.now() - 60 * 60_000),
              attempts: [],
            },
          ]),
        updateMany: () => Promise.resolve({ count: 1 }),
      },
      orderItem: { updateMany: () => Promise.resolve({ count: 1 }) },
      $transaction: <T>(cb: (tx: unknown) => Promise<T>): Promise<T> => cb(prisma),
    } as unknown as PrismaService;

    const config = {
      get: (key: string) =>
        ({
          IDEALPOS_NATIVE_RECONCILE_ENABLED: 'true',
          IDEALPOS_NATIVE_RECOVERY_MIN_AGE_MS: String(GATE_MS),
        })[key],
    } as unknown as ConfigService;

    // An hour old by any clock in the building.
    const swept = await new NativeRoundRecoveryService(prisma, config).sweep();
    expect(swept.released).toBe(1);
  });
});
