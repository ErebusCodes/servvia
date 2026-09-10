/**
 * A ROUND THAT CREATED NOTHING MUST GIVE ITS LINES BACK.
 *
 * THE FAILURE THIS FILE EXISTS TO PREVENT is not duplication - it is the
 * opposite, and it is quieter. A round that ends without reaching the till but
 * KEEPS its lines claimed makes those lines invisible to every later round,
 * because the delta rule is "every OrderItem with nativeRoundId = NULL". The
 * food is not sent, is not re-sendable, and is never mentioned again. The
 * tablet, meanwhile, reports the NEXT round as sent and shows a calm blue
 * banner.
 *
 * Two ways in were open at once:
 *
 *   1. AN UNMAPPED PLU. `resolveLines` threw before the round was frozen and
 *      the throw escaped. The round stayed `drafting` - which is not an
 *      IN_FLIGHT state, so it blocked nothing and warned nobody - holding its
 *      lines forever. An order for lamb, tiramisu and a Coke reached the
 *      kitchen as a Coke.
 *   2. A LOCK REJECTION. The API answered `safeToRetry: true`, honestly meaning
 *      "the till created nothing", and the round kept its lines anyway. The
 *      retry it invited hit `nothing_to_send`: "every line on this order has
 *      already been assigned to a round". A promise the database could not
 *      keep, on a table nobody could clear.
 *
 * THE PRECONDITION THAT LICENSES ALL OF THIS, and the thing these tests are
 * really guarding: lines may be released ONLY where nothing can have been
 * created. For (1) that is structural - no socket was opened. For (2) it is
 * `nativeEffect: 'not_accepted'`, which the decision table grants to LOCK alone
 * because its "LOCKED BY" check returns before the receiver buffers anything.
 * Every other outcome - NAK, DUPLICATE, NAKREGO, silence - keeps its lines, and
 * the last describe block is there to prove it still does.
 */

import { HttpException } from '@nestjs/common';
import { NativeRoundState } from '@prisma/client';

import { startFakeWaiterPadServer } from './testing/fake-waiterpad-server';
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

const REQ = (n: number): string => `line-release-press-${n}-0123456789ab`;

async function open(behaviour: Parameters<typeof openTill>[0] = { kind: 'ack' }): Promise<Harness> {
  const till = await openTill(behaviour);
  return setHarness(await build(NATIVE_ENV(till.port)));
}

/**
 * One press of Send to Kitchen, as the CLIENT experiences it.
 *
 * The controller answers 202 for the one outcome staff may relax about and
 * throws an HttpException carrying the same body shape for every other, so that
 * no generic client mistakes an uncertain round for a success. A test that only
 * looked at resolved promises would therefore never see `rejected` or
 * `uncertain` at all - which are precisely the outcomes this file is about.
 */
async function send(
  h: Harness,
  orderId: string,
  press: number,
  items: { menuItemId: string; quantity: number }[] = [],
): Promise<{
  status?: string;
  error?: string;
  safeToRetry: boolean;
  message: string;
  roundId?: string;
}> {
  try {
    return await h.rounds.submitRound(REQUEST, orderId, { items, requestKey: REQ(press) });
  } catch (err) {
    if (err instanceof HttpException) {
      return err.getResponse() as {
        status?: string;
        error?: string;
        safeToRetry: boolean;
        message: string;
        roundId?: string;
      };
    }
    throw err;
  }
}

/** Every line on the order that no round has claimed. */
const unclaimed = (h: Harness): unknown[] => h.ledger.items.filter((i) => i.nativeRoundId == null);

/** The PLUs the till actually received, in order, across every packet. */
function pluesSent(): string[] {
  const out: string[] = [];
  for (const packet of tillServer().requests) {
    for (const m of packet.matchAll(/<StockItem>(\d+)<\/StockItem>/g)) out.push(m[1]);
  }
  return out;
}

/** Temporarily strip an item's native code, restoring it whatever happens. */
async function withUnmapped(item: { posProductCode: string }, fn: () => Promise<void>) {
  const original = item.posProductCode;
  (item as { posProductCode: string | null }).posProductCode = null;
  try {
    await fn();
  } finally {
    (item as { posProductCode: string | null }).posProductCode = original;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
describe('an unmapped PLU refuses the round and gives every line back', () => {
  // ═════════════════════════════════════════════════════════════════════════

  it('releases the lines atomically, having opened no socket at all', async () => {
    const h = await open();
    const order = await createDineInOrder(h, {
      items: [
        { menuItemId: MENU.lamb.id, quantity: 1 },
        { menuItemId: MENU.tiramisu.id, quantity: 1 },
      ],
    });

    await withUnmapped(MENU.tiramisu, async () => {
      const refused = await send(h, order.id, 1);
      expect(refused.error).toBe('unmapped_item');
      expect(refused.message).toMatch(/no usable IdealPOS product code/);
    });

    // The refusal names the item, which is the only thing that makes it fixable.
    // And nothing was sent: the fake till is listening and heard nothing.
    expect(tillServer().requests).toHaveLength(0);
    expect(tillServer().connections).toBe(0);

    // THE POINT. The round is settled and owns nothing.
    expect(h.ledger.rounds).toHaveLength(1);
    expect(h.ledger.rounds[0].state).toBe(NativeRoundState.abandoned);
    expect(unclaimed(h)).toHaveLength(2);
  });

  it('carries ALL the original lines once the mapping is corrected', async () => {
    const h = await open();
    const order = await createDineInOrder(h, {
      items: [
        { menuItemId: MENU.lamb.id, quantity: 1 },
        { menuItemId: MENU.tiramisu.id, quantity: 1 },
      ],
    });

    await withUnmapped(MENU.tiramisu, async () => {
      const refused = await send(h, order.id, 1);
      expect(refused.error).toBe('unmapped_item');
      expect(refused.message).toMatch(/no usable IdealPOS product code/);
    });

    // The operator fixes the menu. The waiter adds a drink and sends again.
    const second = await send(h, order.id, 2, [{ menuItemId: MENU.coke.id, quantity: 1 }]);
    expect(second.status).toBe('sentAwaitingConfirmation');

    // THE REGRESSION. Before the fix this packet carried the Coke and nothing
    // else, and the lamb and the tiramisu were never seen again.
    const sent = pluesSent();
    expect(sent).toHaveLength(3);
    expect(sent).toEqual(expect.arrayContaining([MENU.lamb.posProductCode]));
    expect(sent).toEqual(expect.arrayContaining([MENU.tiramisu.posProductCode]));
    expect(sent).toEqual(expect.arrayContaining([MENU.coke.posProductCode]));
    // Exactly once each - a release that duplicated would be the other failure.
    expect(new Set(sent).size).toBe(3);
  });

  it('releases the WHOLE round when a later line is the unmapped one', async () => {
    // The resolver walks the lines in order. An early success followed by a
    // late failure must not leave the successful ones claimed: a partial round
    // hands the kitchen an order the customer did not place.
    const h = await open();
    const order = await createDineInOrder(h, {
      items: [
        { menuItemId: MENU.lamb.id, quantity: 1 },
        { menuItemId: MENU.fish.id, quantity: 1 },
        { menuItemId: MENU.tiramisu.id, quantity: 1 },
      ],
    });

    await withUnmapped(MENU.tiramisu, async () => {
      const refused = await send(h, order.id, 1);
      expect(refused.error).toBe('unmapped_item');
      expect(refused.message).toMatch(/no usable IdealPOS product code/);
    });

    expect(unclaimed(h)).toHaveLength(3);
    expect(tillServer().requests).toHaveLength(0);
  });

  it('leaves the table free rather than blocked, because nothing is in flight', async () => {
    const h = await open();
    const order = await createDineInOrder(h, {
      items: [{ menuItemId: MENU.tiramisu.id, quantity: 1 }],
    });

    await withUnmapped(MENU.tiramisu, async () => {
      const refused = await send(h, order.id, 1);
      expect(refused.error).toBe('unmapped_item');
      expect(refused.message).toMatch(/no usable IdealPOS product code/);
    });

    // A settled round holds no in-flight slot, so the corrected send opens
    // normally rather than being refused as `round_in_flight`.
    const retry = await send(h, order.id, 2);
    expect(retry.status).toBe('sentAwaitingConfirmation');
    expect(pluesSent()).toEqual([MENU.tiramisu.posProductCode]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('a LOCK rejection means safeToRetry, and the retry actually works', () => {
  // ═════════════════════════════════════════════════════════════════════════

  it('records the rejection and gives the lines back in the same settlement', async () => {
    const h = await open({ kind: 'lock', posNumber: 2 });
    const order = await createDineInOrder(h, {
      items: [{ menuItemId: MENU.lamb.id, quantity: 1 }],
    });

    const first = await send(h, order.id, 1);
    expect(first.status).toBe('rejected');

    // `rejected`, NOT `abandoned`: the till refused this one, and an incident
    // review has to be able to tell that from Verdura declining to send.
    expect(h.ledger.rounds[0].state).toBe(NativeRoundState.rejected);
    expect(unclaimed(h)).toHaveLength(1);
    expect(tillServer().requests).toHaveLength(1);
  });

  it('the retry carries the original item exactly once, over a second socket', async () => {
    const h = await open({ kind: 'lock', posNumber: 2 });
    const order = await createDineInOrder(h, {
      items: [{ menuItemId: MENU.lamb.id, quantity: 1 }],
    });
    await send(h, order.id, 1);

    // The table is unlocked; the waiter presses Send again. THE REGRESSION:
    // this used to answer `nothing_to_send`, because the rejected round still
    // owned the only line on the order.
    const retry = await send(h, order.id, 2);
    expect(retry.status).toBe('rejected'); // the fake till is still locked
    expect(pluesSent()).toEqual([MENU.lamb.posProductCode, MENU.lamb.posProductCode]);

    // Two genuine sends, two attempts, two connections. Not a reconnect: each
    // is a separate deliberate press with its own request key.
    expect(tillServer().connections).toBe(2);
    expect(h.ledger.attempts).toHaveLength(2);
    expect(new Set(h.ledger.attempts.map((a) => a.attemptId)).size).toBe(2);
    expect(new Set(h.ledger.attempts.map((a) => a.token)).size).toBe(2);
  });

  it('reaches the kitchen once the table is free', async () => {
    const locked = await openTill({ kind: 'lock', posNumber: 2 });
    const h = setHarness(await build(NATIVE_ENV(locked.port)));
    const order = await createDineInOrder(h, {
      items: [{ menuItemId: MENU.lamb.id, quantity: 1 }],
    });
    await send(h, order.id, 1);

    // THE OTHER POS LETS GO. Modelled as a new process against an unlocked
    // till over the SAME durable rows, which is also the only honest way to
    // model it: nothing about the released lines lives in the old instance.
    await closeHarness(h);
    await locked.close();

    const unlocked = await startFakeWaiterPadServer({ kind: 'ack' });
    const h2 = setHarness(await build(NATIVE_ENV(unlocked.port), h.ledger));
    try {
      const retry = await h2.rounds.submitRound(REQUEST, order.id, {
        items: [],
        requestKey: REQ(3),
      });
      expect(retry.status).toBe('sentAwaitingConfirmation');
      expect(unlocked.requests).toHaveLength(1);
      expect(unlocked.requests[0]).toContain(`<StockItem>${MENU.lamb.posProductCode}</StockItem>`);
      // The lamb went to the kitchen ONCE across both presses.
      expect(h2.ledger.items).toHaveLength(1);
    } finally {
      await unlocked.close();
    }
  });

  it('tells the waiter their items are back on the order', async () => {
    const h = await open({ kind: 'lock', posNumber: 2 });
    const order = await createDineInOrder(h, {
      items: [{ menuItemId: MENU.lamb.id, quantity: 1 }],
    });
    await send(h, order.id, 1);

    const [row] = (await h.rounds.listRounds(REQUEST, order.id)).rounds;
    expect(row.status).toBe('rejected');
    expect(row.settled).toBe(true);
    expect(row.requiresReconciliation).toBe(false);
    expect(row.message).toContain('back on the order');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('every outcome WITHOUT proof of non-acceptance keeps its lines', () => {
  // ═════════════════════════════════════════════════════════════════════════
  //
  // The other side of the same rule, and the more important one. These
  // responses all mean "we do not know", and a released line under any of them
  // is a second copy of a customer's food on a bill nobody re-reads.

  it.each<[string, Parameters<typeof openTill>[0], NativeRoundState]>([
    // A NAK has been observed answering a fragment of an order that was already
    // accepted and already printed in the kitchen.
    ['a NAK', { kind: 'nak' }, NativeRoundState.unresolved],
    // Registration refused - but NAKREGO is reachable from sites outside the
    // order path, so it is not a clean rejection.
    ['a NAKREGO', { kind: 'nakrego' }, NativeRoundState.unresolved],
    // Silence after the write. The packet may be in the receiver's buffer.
    ['silence', { kind: 'silent' }, NativeRoundState.unresolved],
    // Bytes went out and the peer vanished.
    ['a reset after the request', { kind: 'resetAfterRequest' }, NativeRoundState.unresolved],
  ])(
    '%s leaves the lines claimed and the round unresolved',
    async (_label, behaviour, expected) => {
      const h = await open(behaviour);
      const order = await createDineInOrder(h, {
        items: [{ menuItemId: MENU.lamb.id, quantity: 1 }],
      });

      await send(h, order.id, 1);

      expect(h.ledger.rounds[0].state).toBe(expected);
      // NOT released. This is the assertion that stops a future "tidy up the
      // stuck rounds" change from turning an ambiguous send into a duplicate.
      expect(unclaimed(h)).toHaveLength(0);
      expect(h.ledger.items.every((i) => i.nativeRoundId === h.ledger.rounds[0].id)).toBe(true);
    },
  );

  it('and the next press is refused rather than carrying anything', async () => {
    const h = await open({ kind: 'nak' });
    const order = await createDineInOrder(h, {
      items: [{ menuItemId: MENU.lamb.id, quantity: 1 }],
    });
    await send(h, order.id, 1);

    // `unresolved` holds the in-flight slot. The second press is refused
    // BEFORE anything is written, and the till hears nothing further.
    const blocked = await send(h, order.id, 2, [{ menuItemId: MENU.coke.id, quantity: 1 }]);
    expect(blocked.error).toBe('round_in_flight');
    expect(blocked.safeToRetry).toBe(false);
    expect(tillServer().requests).toHaveLength(1);
  });
});
