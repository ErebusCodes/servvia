/**
 * THE WAY BACK OUT. What a screen learns about a round AFTER the send answered.
 *
 * `native-rounds.controller.spec.ts` proves what Send to Kitchen does. This
 * proves what happens next, which until this route existed was nothing at all:
 *
 *     POST  -> "sentAwaitingConfirmation"     the best any send may ever say
 *     ...    (a service goes by)
 *     sweep -> the round is escalated to `unresolved`
 *     GET   -> "unresolved. DO NOT send it again."
 *
 * WITHOUT THE LAST LINE THE THIRD ONE REACHES NOBODY. The escalation was always
 * real and always durable; it changed a row the tablet never read. So the
 * screen went on showing the POST's sentence - "SENT, AWAITING TILL
 * CONFIRMATION" - for the rest of the night, about a round the server had
 * already given up on. That is the failure these tests are about: not a wrong
 * label, but a REASSURING one that outlived its truth.
 *
 * AND THE READ MUST STAY A READ. Every test here runs against a live fake till
 * and asserts the socket saw nothing while the route was called - because the
 * one thing a route staff can refresh at will must never learn to do is send a
 * round again.
 */

import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { NativeRoundState } from '@prisma/client';

import {
  ACTOR,
  build,
  createDineInOrder,
  installHarnessLifecycle,
  MENU,
  NATIVE_ENV,
  openTill,
  setHarness,
  tillServer,
  VENUE,
  type Harness,
} from './testing/native-order-harness';

installHarnessLifecycle();

const REQ = (n: number): string => `readback-press-${n}-0123456789abcd`;

/** The authenticated caller, exactly as the guards would have left it. */
const REQUEST = {
  user: {
    id: ACTOR.id,
    email: ACTOR.email,
    role: ACTOR.role,
    organizationId: VENUE.organizationId,
    venueId: VENUE.id,
  },
} as never;

/** Escalate after one minute, so a test can age a round without waiting for one. */
const FAST_ESCALATION = { IDEALPOS_NATIVE_RECONCILE_ESCALATE_AFTER_MS: String(60_000) };

async function open(over: Record<string, string> = {}): Promise<Harness> {
  const till = await openTill();
  return setHarness(await build(NATIVE_ENV(till.port, { ...FAST_ESCALATION, ...over })));
}

async function send(
  h: Harness,
  orderId: string,
  press: number,
  items: { menuItemId: string; quantity: number }[] = [],
) {
  return await h.rounds.submitRound(REQUEST, orderId, { items, requestKey: REQ(press) });
}

/** The read route, through the real handler. */
async function read(h: Harness, orderId: string) {
  return (await h.rounds.listRounds(REQUEST, orderId)).rounds;
}

/** Minutes from now, for ageing a round past its escalation window. */
const minutesOn = (n: number): Date => new Date(Date.now() + n * 60_000);

// ═══════════════════════════════════════════════════════════════════════════
describe('the reassuring message does not outlive its truth', () => {
  // ═════════════════════════════════════════════════════════════════════════

  it('turns "awaiting the till" into "nobody knows" once escalation has fired', async () => {
    const h = await open();
    const order = await createDineInOrder(h, {
      items: [{ menuItemId: MENU.lamb.id, quantity: 1 }],
    });

    const sent = await send(h, order.id, 1);
    // The best a send may ever report. The receiver ACKs before durable
    // processing, so nothing stronger is available from the wire.
    expect(sent.status).toBe('sentAwaitingConfirmation');

    // Immediately after, the screen is told the same thing the POST said.
    const fresh = await read(h, order.id);
    expect(fresh).toHaveLength(1);
    expect(fresh[0].status).toBe('awaitingConfirmation');
    expect(fresh[0].requiresReconciliation).toBe(false);

    // A whole service goes by and nothing ever confirms it.
    const swept = await h.reconciler.sweep(minutesOn(20));
    expect(swept.escalated).toBe(1);

    // THE POINT. The screen now learns what the server already believes.
    const aged = await read(h, order.id);
    expect(aged[0].state).toBe(NativeRoundState.unresolved);
    expect(aged[0].status).toBe('unresolved');
    expect(aged[0].requiresReconciliation).toBe(true);
    expect(aged[0].message).toContain('DO NOT send it again');
    // Not settled: an unresolved round is a human's problem, not a closed one.
    expect(aged[0].settled).toBe(false);
  });

  it('leaves a round inside its window reading as awaiting, not as alarming', async () => {
    const h = await open();
    const order = await createDineInOrder(h, {
      items: [{ menuItemId: MENU.lamb.id, quantity: 1 }],
    });
    await send(h, order.id, 1);

    // Thirty seconds into a sixty-second window. Still legitimately in flight,
    // and telling staff otherwise would train them to ignore the alarm.
    const swept = await h.reconciler.sweep(new Date(Date.now() + 30_000));
    expect(swept.escalated).toBe(0);

    const rounds = await read(h, order.id);
    expect(rounds[0].status).toBe('awaitingConfirmation');
    expect(rounds[0].requiresReconciliation).toBe(false);
  });

  it('reports how long a round has been unproven, from the attempt escalation measures', async () => {
    const h = await open();
    const order = await createDineInOrder(h, {
      items: [{ menuItemId: MENU.lamb.id, quantity: 1 }],
    });
    await send(h, order.id, 1);

    const [round] = await read(h, order.id);
    expect(round.sendInitiatedAt).toBeInstanceOf(Date);

    // The same instant the sweep runs its escalation clock against - a screen
    // saying "waiting 9 minutes" about a round the sweep considers 4 minutes
    // old would be two different clocks shown to the same person.
    const attempt = h.ledger.attempts.find((a) => a.roundId === round.roundId);
    expect(round.sendInitiatedAt).toEqual(attempt?.sendInitiatedAt);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('it is a read, and it stays one', () => {
  // ═════════════════════════════════════════════════════════════════════════

  it('sends nothing to a listening till, however alarming what it finds is', async () => {
    const h = await open();
    const order = await createDineInOrder(h, {
      items: [{ menuItemId: MENU.lamb.id, quantity: 1 }],
    });
    await send(h, order.id, 1);

    const afterSend = h.nativeSendCount();
    expect(afterSend).toBe(1);

    // Escalate it, so every subsequent read finds a round in the state most
    // likely to tempt a helpful "just send it again".
    await h.reconciler.sweep(minutesOn(20));

    // Read it as often as a waiter refreshing a screen would.
    for (let i = 0; i < 10; i += 1) {
      const rounds = await read(h, order.id);
      expect(rounds[0].requiresReconciliation).toBe(true);
    }

    // The fake till is listening the whole time and hears nothing more.
    expect(h.nativeSendCount()).toBe(afterSend);
    expect(tillServer().requests).toHaveLength(afterSend);
  });

  it('changes no round state - reading is not an event in a round life', async () => {
    const h = await open();
    const order = await createDineInOrder(h, {
      items: [{ menuItemId: MENU.lamb.id, quantity: 1 }],
    });
    await send(h, order.id, 1);

    const before = h.ledger.rounds.map((r) => ({ ...r }));
    await read(h, order.id);
    await read(h, order.id);
    expect(h.ledger.rounds).toEqual(before);
  });

  it('does not release a single line, whatever state it finds them in', async () => {
    const h = await open();
    const order = await createDineInOrder(h, {
      items: [{ menuItemId: MENU.lamb.id, quantity: 1 }],
    });
    await send(h, order.id, 1);
    await h.reconciler.sweep(minutesOn(20));

    const claimed = h.ledger.items.filter((i) => i.nativeRoundId != null).length;
    expect(claimed).toBeGreaterThan(0);

    await read(h, order.id);

    // An unresolved round keeps its lines. Releasing them here would let the
    // next Send carry food that may already be on the table.
    expect(h.ledger.items.filter((i) => i.nativeRoundId != null)).toHaveLength(claimed);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('a whole table, read back', () => {
  // ═════════════════════════════════════════════════════════════════════════

  it('returns every round in sequence order, each with its own state', async () => {
    const h = await open();
    const order = await createDineInOrder(h, {
      items: [{ menuItemId: MENU.lamb.id, quantity: 1 }],
    });

    // Round 1: sent, then confirmed - which in life only the till's own token
    // may do, and which here is written directly so the read has a settled
    // round to report next to an unsettled one.
    await send(h, order.id, 1);
    const first = h.ledger.rounds[0];
    first.state = NativeRoundState.confirmed;

    // Round 2: the mains, still awaiting.
    await send(h, order.id, 2, [{ menuItemId: MENU.fish.id, quantity: 1 }]);

    const rounds = await read(h, order.id);
    expect(rounds.map((r) => r.sequence)).toEqual([1, 2]);
    expect(rounds[0].status).toBe('confirmed');
    expect(rounds[0].settled).toBe(true);
    expect(rounds[0].requiresReconciliation).toBe(false);
    expect(rounds[1].status).toBe('awaitingConfirmation');
    expect(rounds[1].settled).toBe(false);

    // Each round reports the lines that are ITS OWN, which is what makes the
    // readback usable for telling a waiter what went when.
    expect(rounds[0].lineCount).toBe(1);
    expect(rounds[1].lineCount).toBe(1);
  });

  it('carries the durable enum alongside the derived fields', async () => {
    const h = await open();
    const order = await createDineInOrder(h, {
      items: [{ menuItemId: MENU.lamb.id, quantity: 1 }],
    });
    await send(h, order.id, 1);

    // A client built today still SEES a state added to the enum tomorrow,
    // rather than having it folded into whichever derived value fits closest.
    const [round] = await read(h, order.id);
    expect(round.state).toBe(NativeRoundState.awaiting_native_confirmation);
    expect(Object.values(NativeRoundState)).toContain(round.state);
  });

  it('answers with an empty list for an order that has never sent a round', async () => {
    const h = await open();
    const order = await createDineInOrder(h, {
      items: [{ menuItemId: MENU.lamb.id, quantity: 1 }],
    });

    // Empty, not an error: an order with no rounds is the ordinary state of
    // every table between being seated and the first Send.
    expect(await read(h, order.id)).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('who may look', () => {
  // ═════════════════════════════════════════════════════════════════════════

  it('refuses a caller from another organization', async () => {
    const h = await open();
    const order = await createDineInOrder(h, {
      items: [{ menuItemId: MENU.lamb.id, quantity: 1 }],
    });
    await send(h, order.id, 1);

    const outsider = {
      user: {
        ...(REQUEST as { user: Record<string, unknown> }).user,
        organizationId: 'org-someone-else',
      },
    } as never;

    // Till state for a neighbouring venue's table is not theirs to read, and a
    // route that "only reads" is exactly where that leak would be tolerated.
    await expect(h.rounds.listRounds(outsider, order.id)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('404s an order that does not exist, without inventing an empty round list', async () => {
    const h = await open();
    await expect(h.rounds.listRounds(REQUEST, 'order-that-never-was')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
