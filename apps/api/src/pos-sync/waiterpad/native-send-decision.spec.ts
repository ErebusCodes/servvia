/**
 * WHAT WE CONCLUDED, WRITTEN NEXT TO WHAT THE TILL SAID.
 *
 * `NativeSendAttempt` already carried `outcomeKind` (the transport's
 * observation) and `decision` (our conclusion about what that observation
 * licenses). The column existed, the method that wrote it existed, and NOTHING
 * IN THE RUNNING APPLICATION CALLED IT - so every attempt row in the database
 * had an empty `decision`, and a support engineer reading one at midnight could
 * see that the till answered ACK but not whether we had treated that as a
 * landed round or as an unknown one. The two are not the same thing on this
 * protocol, which is the entire reason the column is separate.
 *
 * THE SAFETY PROPERTY THIS FILE EXISTS TO PIN. The decision is written AFTER
 * the bytes have gone, which makes it the most dangerous kind of write in this
 * module: a diagnostic that runs at a moment when failure must not be
 * reportable. If a write to this column could throw its way out to the caller,
 * a completed send would surface as an exception, an exception reads as "the
 * send failed", and "the send failed" is the one conclusion this protocol never
 * licenses - it is how a second docket reaches a customer's bill. So the last
 * describe drives the column's write into the ground and asserts that the round
 * settles exactly as it would have, with no extra connection to the till.
 */

import { createServer } from 'node:net';
import type { AddressInfo } from 'node:net';

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
  type Row,
} from '../testing/native-order-harness';
import { HttpException } from '@nestjs/common';
import { StaffRole } from '@prisma/client';

installHarnessLifecycle();
jest.setTimeout(20000);

const REQ = (n: number): string => `decision-press-${n}-0123456789abcdef`;

/** An ephemeral port that is provably free: bound, read, and given straight back. */
async function takeAndReleaseAPort(): Promise<number> {
  const server = createServer();
  const port = await new Promise<number>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port));
  });
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

const CALLER = {
  user: {
    id: ACTOR.id,
    email: ACTOR.email,
    role: StaffRole.cashier,
    organizationId: VENUE.organizationId,
    venueId: VENUE.id,
  },
} as never;

/**
 * The read timeout at its configuration floor. Two of the cases below reach
 * their outcome by waiting one out, and the production default turns this file
 * into a minute of sleeping. How long the writer waits is asserted in
 * `waiterpad-transport-timers.spec.ts`, which is where it means something.
 */
const ENV = (port: number): Record<string, string> =>
  NATIVE_ENV(port, { IDEALPOS_WAITERPAD_READ_TIMEOUT_MS: '250' });

/** Send one round against a till behaving as given, and return the attempt row. */
async function sendOneRound(
  behaviour: Parameters<typeof openTill>[0],
): Promise<{ h: Harness; attempt: Row; roundState: string }> {
  const till = await openTill(behaviour);
  const h = setHarness(await build(ENV(till.port)));
  const order = await createDineInOrder(h, {
    items: [{ menuItemId: MENU.lamb.id, quantity: 1 }],
  });

  // Every outcome but the ACK answers non-2xx, and the body is the round -
  // which is the whole point of the controller's contract. Both shapes are
  // accepted here because this file is about the DATABASE ROW, not the status
  // code, and that is asserted in the controller's own spec.
  try {
    await h.rounds.submitRound(CALLER, order.id, { items: [], requestKey: REQ(1) });
  } catch (err) {
    if (!(err instanceof HttpException)) throw err;
  }

  expect(h.ledger.attempts).toHaveLength(1);
  return {
    h,
    attempt: h.ledger.attempts[0],
    roundState: String(h.ledger.rounds[0].state),
  };
}

// ═════════════════════════════════════════════════════════════════════════
describe('the decision this writer reached is durable, for every outcome', () => {
  it('an ACK records awaiting-confirmation AND that it still needs a readback', async () => {
    const { attempt, roundState } = await sendOneRound({ kind: 'ack' });

    // THE PAIR IS THE POINT. `awaiting_native_confirmation` alone would not
    // say whether we considered the round finished, because the receiver emits
    // its ACK before durable processing - the same ACK it emits for a no-op,
    // and the same one it emits when its 200-slot buffer was full and the
    // packet was dropped. `:readback` is the record that we knew that.
    expect(attempt.decision).toBe('awaiting_native_confirmation:readback');
    expect(attempt.outcomeKind).toBe('responded');
    expect(attempt.bytesLeftHost).toBe(true);
    expect(roundState).toBe(NativeRoundState.awaiting_native_confirmation);
  });

  it('a till that never answers records the uncertain decision, not a failure', async () => {
    const { attempt, roundState } = await sendOneRound({ kind: 'silent' });

    // THE DANGEROUS ONE. The bytes went and nothing came back, so the round is
    // a human's problem - and the row has to say we knew that, because the
    // alternative reading of an empty column during an incident review is "we
    // never decided", which invites somebody to decide it now, in hindsight,
    // in favour of a resend.
    expect(attempt.decision).toBe(`${NativeRoundState.unresolved}:readback`);
    expect(attempt.bytesLeftHost).toBe(true);
    expect(roundState).toBe(NativeRoundState.unresolved);
  });

  it('a NAK records UNRESOLVED, and the row proves we did not read it as a refusal', async () => {
    const { attempt, roundState } = await sendOneRound({ kind: 'nak' });

    // THE MOST VALUABLE ROW IN THIS FILE.
    //
    // "NAK" reads as "the till said no", and `rejected` is the state that
    // licenses a repair-and-resubmit. That mapping is exactly the one this
    // protocol cannot afford: on 2026-09-04 the till answered NAK to a
    // trailing fragment of an order it had ALREADY accepted and ALREADY
    // printed in the kitchen, and the one traced NAK condition is a BUSY
    // signal rather than a refusal. So the response says NAK, the decision
    // says unresolved, and the two columns sitting side by side in the
    // database are the record that the difference was deliberate - which is
    // precisely the question somebody will ask of this row when a customer
    // disputes a duplicate.
    expect(attempt.responseNote).toBe('NAK');
    expect(attempt.decision).toBe(`${NativeRoundState.unresolved}:readback`);
    expect(String(attempt.decision)).not.toContain(NativeRoundState.rejected);
    expect(roundState).toBe(NativeRoundState.unresolved);
  });

  it('a locked table is the ONE response that records a rejected decision', async () => {
    const { attempt, roundState } = await sendOneRound({ kind: 'lock', posNumber: 3 });

    // LOCK is the only response with POSITIVE evidence of non-acceptance - the
    // receiver's "LOCKED BY" check runs and returns BEFORE its buffering loop -
    // so it is the only one that reaches `rejected` and the only one that does
    // not need the till read back. The absence of the `:readback` suffix here
    // is the row carrying that distinction, and it is the difference between a
    // round a human may present again and one nobody may.
    expect(attempt.decision).toBe(String(NativeRoundState.rejected));
    expect(String(attempt.decision)).not.toContain(':readback');
    expect(attempt.responseNote).toBe('LOCK');
    expect(roundState).toBe(NativeRoundState.rejected);
  });

  it('a connect that never lands records the failed-before-send decision', async () => {
    // A PORT WITH NOTHING LISTENING, taken and released directly rather than
    // through `openTill`. The harness lifecycle closes whatever `openTill`
    // last handed out, and a fake till closed twice never calls back - so
    // borrowing one here and shutting it down would hang the teardown rather
    // than fail the test.
    const port = await takeAndReleaseAPort();

    const h = setHarness(await build(ENV(port)));
    const order = await createDineInOrder(h, {
      items: [{ menuItemId: MENU.lamb.id, quantity: 1 }],
    });
    try {
      await h.rounds.submitRound(CALLER, order.id, { items: [], requestKey: REQ(2) });
    } catch (err) {
      if (!(err instanceof HttpException)) throw err;
    }

    const attempt = h.ledger.attempts[0];
    expect(attempt.bytesLeftHost).toBe(false);
    expect(attempt.outcomeKind).toBe('failedBeforeSend');
    // The decision is recorded on the one path where a human MAY present the
    // same payload again, so the row says which of the two kinds of "it did
    // not work" this was.
    expect(attempt.decision).toBeTruthy();
    // And the lines went back on the order, which is what makes it the safe one.
    expect(h.ledger.items.filter((i) => i.nativeRoundId === null)).toHaveLength(1);
  });

  it('never claims a decision the writer did not reach', async () => {
    // Every recorded decision names a real durable state. A column holding a
    // value outside the enum would be a column somebody eventually parses.
    const states = new Set<string>(Object.values(NativeRoundState));
    for (const behaviour of [
      { kind: 'ack' } as const,
      { kind: 'nak' } as const,
      { kind: 'nakrego' } as const,
    ]) {
      const { attempt } = await sendOneRound(behaviour);
      expect(states.has(String(attempt.decision).split(':')[0])).toBe(true);
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe('a diagnostic write may never turn a completed send into a failure', () => {
  /**
   * THE WHOLE REASON THE WRITE IS BEST-EFFORT.
   *
   * By the time the decision is written the packet has already reached the
   * till. If the database is unreachable at that instant - a failover, a
   * connection-pool exhaustion, a `pg_terminate_backend` - the ONLY safe
   * behaviour is to lose the diagnostic and keep the send. The alternative is
   * an exception propagating out of a send that succeeded, which every caller
   * above reads as "it did not go", and which ends with a waiter pressing Send
   * on a round that is already in the kitchen.
   */
  async function sendWithABrokenDecisionWrite(): Promise<Harness> {
    const till = await openTill({ kind: 'ack' });
    const h = setHarness(await build(ENV(till.port)));

    // Break ONLY the decision write. `update` is used by both the outcome and
    // the decision writers, so the double throws for the second call onward -
    // leaving the outcome recorded, which is the realistic shape of a database
    // that goes away mid-send rather than an artificial one.
    const real = h.ledger.attempts;
    let updates = 0;
    const prisma = (h.rounds as unknown as { prisma: Row }).prisma;
    const attemptApi = prisma.nativeSendAttempt as { update: (a: Row) => Promise<unknown> };
    const realUpdate = attemptApi.update.bind(attemptApi);
    attemptApi.update = (args: Row) => {
      updates += 1;
      if (updates > 1) return Promise.reject(new Error('connection terminated by administrator'));
      return realUpdate(args);
    };

    const order = await createDineInOrder(h, {
      items: [{ menuItemId: MENU.lamb.id, quantity: 1 }],
    });
    await h.rounds.submitRound(CALLER, order.id, { items: [], requestKey: REQ(3) });
    expect(real).toHaveLength(1);
    return h;
  }

  it('settles the round exactly as it would have, and opens no second connection', async () => {
    const h = await sendWithABrokenDecisionWrite();

    // THE ROUND IS UNAFFECTED. Same state, same claimed lines.
    expect(h.ledger.rounds[0].state).toBe(NativeRoundState.awaiting_native_confirmation);
    expect(h.ledger.items.filter((i) => i.nativeRoundId === null)).toHaveLength(0);

    // AND NOT ONE EXTRA PACKET. This is the assertion the whole file is for:
    // a failed diagnostic must not become a retry, and nothing in this
    // codebase retries - so the count is the proof, not the intention. The
    // till was opened inside the helper, so these are absolute counts for the
    // whole test rather than a delta.
    expect(tillServer().connections).toBe(1);
    expect(tillServer().requests).toHaveLength(1);
  });

  it('leaves the columns that safety actually reads intact', async () => {
    const h = await sendWithABrokenDecisionWrite();
    const attempt = h.ledger.attempts[0];

    // Restart recovery classifies a round from `bytesLeftHost` and whether an
    // outcome was recorded at all - never from `decision`. So a decision that
    // failed to persist must leave a row that recovery still reads correctly,
    // which is exactly why the decision is a SEPARATE write made last.
    expect(attempt.bytesLeftHost).toBe(true);
    expect(attempt.outcomeKind).toBe('responded');
    expect(attempt.decision ?? null).toBeNull();
  });

  it('a restart after a lost decision still calls the round uncertain, never releasable', async () => {
    const h = await sendWithABrokenDecisionWrite();
    // Age it past every gate and put it back mid-flight, as a crash would.
    h.ledger.rounds[0].state = NativeRoundState.submitting;
    h.ledger.rounds[0].updatedAt = new Date(Date.now() - 60 * 60_000);

    // The first process ENDS before the second starts. Without this its
    // services - and their timers - stay alive alongside the new ones, which
    // is both an unfaithful model of a restart and an open handle that keeps
    // the test runner from exiting.
    const port = tillServer().port;
    await closeHarness(h);
    const restarted = setHarness(await build(ENV(port), h.ledger));
    const swept = await restarted.recovery.sweep();

    // Bytes left the host, so the round is a human's problem - and the missing
    // diagnostic column changed nothing about reaching that conclusion.
    expect(swept.unresolved).toBe(1);
    expect(swept.released).toBe(0);
    expect(h.ledger.rounds[0].state).toBe(NativeRoundState.unresolved);
    expect(h.ledger.items.filter((i) => i.nativeRoundId === null)).toHaveLength(0);
  });
});
