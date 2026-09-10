/**
 * SEND TO KITCHEN, AS A WAITER ACTUALLY PRESSES IT.
 *
 * `native-delta-rounds.spec.ts` proves the SERVICE carries a whole service
 * correctly. This proves the same thing one layer up, through the real HTTP
 * handler the Order Tablet calls - because the handler is where the new lines
 * get priced, where the double-tap guard lives, and where an uncertain round
 * has to be turned into something a client cannot misread as success.
 *
 * THE WORKFLOW UNDER TEST, which is the one the product promises:
 *
 *     open Table 5, covers 2, add Item A, Send   -> round 1 carries A
 *     reopen Table 5,          add Item B, Send  -> round 2 carries B, ONLY B
 *
 * Item A is never sent twice. Not after a confirmed round, not after an
 * uncertain one, not after a restart, and not when the waiter taps twice.
 *
 * EVERY TEST READS THE BYTES THE SOCKET CARRIED and asserts what is ABSENT as
 * hard as what is present, because the failure that matters here is not "the
 * order did not arrive" - it is "the order arrived twice", on a real bill, and
 * nobody notices until the docket prints.
 */

import { HttpException, HttpStatus } from '@nestjs/common';

import {
  ACTOR,
  build,
  createDineInOrder,
  installHarnessLifecycle,
  MENU,
  NATIVE_ENV,
  openTill,
  runBothSweeps,
  setHarness,
  tillServer,
  VENUE,
  type Harness,
  type Ledger,
} from './testing/native-order-harness';

installHarnessLifecycle();

const REQ = (n: number): string => `send-press-${n}-0123456789abcdef`;

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

async function open(env: Record<string, string>): Promise<Harness> {
  return setHarness(await build(env));
}

/** One press of Send to Kitchen, through the real handler. */
async function send(
  h: Harness,
  orderId: string,
  press: number,
  items: { menuItemId: string; quantity: number }[] = [],
) {
  return await h.rounds.submitRound(REQUEST, orderId, { items, requestKey: REQ(press) });
}

/**
 * A press expected NOT to succeed. Returns the response body the handler put
 * inside its exception, which is the same shape a 202 returns - so a client
 * reads one contract either way.
 */
async function sendExpectingRefusal(
  h: Harness,
  orderId: string,
  press: number,
  items: { menuItemId: string; quantity: number }[] = [],
): Promise<{ status: number; body: Record<string, unknown> }> {
  try {
    await send(h, orderId, press, items);
  } catch (err) {
    if (err instanceof HttpException) {
      return {
        status: err.getStatus(),
        body: err.getResponse() as Record<string, unknown>,
      };
    }
    throw err;
  }
  throw new Error('expected the handler to refuse, but it accepted');
}

/** The nth packet the till received, as text. */
function packet(n: number): string {
  const requests = tillServer().requests;
  expect(requests.length).toBeGreaterThan(n);
  return requests[n];
}

function pluesOf(payload: string): string[] {
  return [...payload.matchAll(/<StockItem>([^<]*)<\/StockItem>/g)].map((m) => m[1]).sort();
}

function tableOf(payload: string): string | null {
  return /<Table>([^<]*)<\/Table>/.exec(payload)?.[1] ?? null;
}

function guestsOf(payload: string): string | null {
  return /<Guests>([^<]*)<\/Guests>/.exec(payload)?.[1] ?? null;
}

/** Stand in for the reconciliation the round is waiting on - it has its own spec. */
function reconcileConfirmed(ledger: Ledger, roundId: string): void {
  const round = ledger.rounds.find((r) => r.id === roundId);
  if (!round) throw new Error(`no round ${roundId}`);
  round.state = 'confirmed';
}

const line = (item: { id: string }, quantity = 1) => ({ menuItemId: item.id, quantity });

// ═════════════════════════════════════════════════════════════════════════
describe('the real HTTP route reaches the till', () => {
  it('carries table, covers, product code and quantity from the actual staff action', async () => {
    const till = await openTill();
    const h = await open(NATIVE_ENV(till.port));

    // Table A is Verdura table 12 and native table 5. Covers are 4.
    const order = await createDineInOrder(h, {
      tableId: 'tbl-a',
      guests: 4,
      items: [line(MENU.lamb, 2)],
    });

    const res = await send(h, order.id, 1);

    expect(res.status).toBe('sentAwaitingConfirmation');
    expect(res.sequence).toBe(1);
    expect(res.replayed).toBe(false);
    // ACK IS NOT CONFIRMED, and the contract must not let a client think it is.
    expect(res.safeToRetry).toBe(false);
    expect(res.requiresReconciliation).toBe(false);

    // ── The wire. The native code, never the Verdura display number. ──
    expect(tableOf(packet(0))).toBe('5');
    expect(packet(0)).not.toContain('<Table>12</Table>');
    expect(guestsOf(packet(0))).toBe('4');
    expect(pluesOf(packet(0))).toEqual(['101']);
    expect(packet(0)).toContain('<Quantity>2</Quantity>');
    // The order's own id travelled with it, so a human holding an attempt row
    // can find the order.
    expect(h.ledger.attempts[0].roundId).toBe(res.roundId);

    // And nothing about this went near the Webit pipeline.
    await runBothSweeps(h);
    expect(h.webitSendCount()).toBe(0);
    expect(h.nativeSendCount()).toBe(1);
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe('a whole service on one table: first, second and third rounds', () => {
  it('sends three rounds that partition the order - every line once, no line twice', async () => {
    const till = await openTill();
    const h = await open(NATIVE_ENV(till.port));

    // ── ROUND 1: the drinks the waiter took on arrival. ──
    const order = await createDineInOrder(h, {
      tableId: 'tbl-a',
      items: [line(MENU.coke), line(MENU.water)],
    });
    const first = await send(h, order.id, 1);
    expect(first.sequence).toBe(1);
    expect(pluesOf(packet(0))).toEqual(['201', '202']);

    reconcileConfirmed(h.ledger, first.roundId);

    // ── ROUND 2: mains, entered twenty minutes later on the reopened table. ──
    const second = await send(h, order.id, 2, [line(MENU.lamb), line(MENU.fish)]);
    expect(second.sequence).toBe(2);
    expect(second.status).toBe('sentAwaitingConfirmation');

    // THE PRODUCT PROMISE. The drinks are already on the native tab; their
    // PLUs appearing here would be two extra drinks on a real bill.
    expect(pluesOf(packet(1))).toEqual(['101', '102']);
    expect(packet(1)).not.toContain('<StockItem>201</StockItem>');
    expect(packet(1)).not.toContain('<StockItem>202</StockItem>');

    reconcileConfirmed(h.ledger, second.roundId);

    // ── ROUND 3: dessert. ──
    const third = await send(h, order.id, 3, [line(MENU.tiramisu)]);
    expect(third.sequence).toBe(3);
    expect(pluesOf(packet(2))).toEqual(['301']);
    expect(packet(2)).not.toContain('<StockItem>101</StockItem>');
    expect(packet(2)).not.toContain('<StockItem>201</StockItem>');

    // ── Three rounds, three packets, three connections, not one byte more. ──
    expect(tillServer().requests).toHaveLength(3);
    expect(tillServer().connections).toBe(3);
    expect(h.ledger.roundsFor(order.id).map((r) => r.sequence)).toEqual([1, 2, 3]);

    // The partition, stated directly: the union of the rounds is the order,
    // and the rounds are disjoint.
    expect(h.ledger.items.every((i) => i.nativeRoundId !== null)).toBe(true);
    expect(new Set(h.ledger.attempts.map((a) => a.token)).size).toBe(3);

    await runBothSweeps(h);
    expect(h.webitSendCount()).toBe(0);
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe('two tables, and coming back to the first', () => {
  it('never lets one table’s round reach the other, and each table keeps its own sequence', async () => {
    const till = await openTill();
    const h = await open(NATIVE_ENV(till.port));

    const a = await createDineInOrder(h, { tableId: 'tbl-a', items: [line(MENU.coke)] });
    const b = await createDineInOrder(h, { tableId: 'tbl-b', items: [line(MENU.lamb)] });

    const a1 = await send(h, a.id, 1);
    expect(tableOf(packet(0))).toBe('5');
    reconcileConfirmed(h.ledger, a1.roundId);

    // The waiter walks to table B and sends a completely different order.
    const b1 = await send(h, b.id, 2);
    expect(tableOf(packet(1))).toBe('7');
    // Table B's Verdura number is 3 and table A's native code is 5; both would
    // be somebody else's bill.
    expect(packet(1)).not.toContain('<Table>3</Table>');
    expect(packet(1)).not.toContain('<Table>5</Table>');
    expect(pluesOf(packet(1))).toEqual(['101']);
    expect(packet(1)).not.toContain('<StockItem>201</StockItem>');
    reconcileConfirmed(h.ledger, b1.roundId);

    // ── Back to table A for a second round there. ──
    const a2 = await send(h, a.id, 3, [line(MENU.tiramisu)]);
    expect(tableOf(packet(2))).toBe('5');
    // Only the dessert. Not table A's earlier drink, and not table B's main -
    // the second is the failure a venue-wide "unsent lines" query would give.
    expect(pluesOf(packet(2))).toEqual(['301']);
    expect(packet(2)).not.toContain('<StockItem>201</StockItem>');
    expect(packet(2)).not.toContain('<StockItem>101</StockItem>');

    // Sequences are per order, so returning to A continues A's numbering
    // rather than the venue's.
    expect(a2.sequence).toBe(2);
    expect(b1.sequence).toBe(1);
    expect(h.ledger.roundsFor(a.id).map((r) => r.sequence)).toEqual([1, 2]);
    expect(h.ledger.roundsFor(b.id).map((r) => r.sequence)).toEqual([1]);
    expect(tillServer().requests).toHaveLength(3);
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe('a prior round is never resent', () => {
  it('leaves a CONFIRMED round alone - its lines can never be swept into a later one', async () => {
    const till = await openTill();
    const h = await open(NATIVE_ENV(till.port));

    const order = await createDineInOrder(h, { tableId: 'tbl-a', items: [line(MENU.lamb)] });
    const first = await send(h, order.id, 1);
    reconcileConfirmed(h.ledger, first.roundId);

    await send(h, order.id, 2, [line(MENU.coke)]);

    expect(pluesOf(packet(1))).toEqual(['201']);
    expect(packet(1)).not.toContain('<StockItem>101</StockItem>');
    // The claim is what guarantees it: the lamb line still carries round one's
    // id, so the "unclaimed lines" query cannot see it.
    expect(h.ledger.pluesOfRound(first.roundId)).toEqual(['lamb']);
    expect(tillServer().requests).toHaveLength(2);
  });

  it('an UNCERTAIN round blocks the table, answers 409, and does not lose the new lines', async () => {
    const till = await openTill({ kind: 'silent' });
    const h = await open(NATIVE_ENV(till.port));

    const order = await createDineInOrder(h, { tableId: 'tbl-a', items: [line(MENU.lamb)] });

    // The till takes the bytes and says nothing - the ambiguous case.
    const uncertain = await sendExpectingRefusal(h, order.id, 1);

    // NOT A 2XX. Every generic client reads 2xx as done and 5xx as retry-me,
    // and both are wrong for a round that may already be on the tab.
    expect(uncertain.status).toBe(HttpStatus.CONFLICT);
    expect(uncertain.body.status).toBe('uncertain');
    expect(uncertain.body.safeToRetry).toBe(false);
    expect(uncertain.body.requiresReconciliation).toBe(true);
    expect(String(uncertain.body.message)).toMatch(/DO NOT send it again/i);

    // The waiter adds a drink and presses Send. The table is blocked, and the
    // refusal is machine-readable so no client has to parse prose.
    const blocked = await sendExpectingRefusal(h, order.id, 2, [line(MENU.coke)]);
    expect(blocked.status).toBe(HttpStatus.CONFLICT);
    expect(blocked.body.error).toBe('round_in_flight');
    expect(blocked.body.safeToRetry).toBe(false);

    // NOTHING FURTHER LEFT THE HOST, and the drink was NOT written to the
    // order. An order that silently grew during a refusal is an order whose
    // next round carries food the waiter does not remember ordering.
    expect(tillServer().requests).toHaveLength(1);
    expect(h.ledger.items).toHaveLength(1);
    expect(h.ledger.roundsFor(order.id)).toHaveLength(1);
  }, 20000);

  it('once a human resolves the uncertain round, the next round carries only what is new', async () => {
    const till = await openTill({ kind: 'nak' });
    const h = await open(NATIVE_ENV(till.port));

    const order = await createDineInOrder(h, { tableId: 'tbl-a', items: [line(MENU.lamb)] });
    // A NAK is uncertain, not a rejection: the till has answered NAK to a
    // fragment of an order it had already printed.
    const first = await sendExpectingRefusal(h, order.id, 1);
    expect(first.body.status).toBe('uncertain');

    // The human looks at the till and finds the round IS on the tab.
    reconcileConfirmed(h.ledger, first.body.roundId as string);

    // Service resumes. This till NAKs everything, so round two is uncertain
    // too - which is fine and is not what this test is about. What matters is
    // what the packet CONTAINED.
    const second = await sendExpectingRefusal(h, order.id, 2, [line(MENU.coke)]);
    expect(second.body.roundId).not.toBe(first.body.roundId);

    // THE DANGEROUS PATH. "It was uncertain, so send it again to be safe" is
    // exactly how a customer gets two lamb shanks. The uncertain round's line
    // stays with the uncertain round.
    expect(pluesOf(packet(1))).toEqual(['201']);
    expect(packet(1)).not.toContain('<StockItem>101</StockItem>');
    expect(tillServer().requests).toHaveLength(2);
  }, 20000);

  it('refuses a round with nothing new rather than spend an identity asking for nothing', async () => {
    const till = await openTill();
    const h = await open(NATIVE_ENV(till.port));

    const order = await createDineInOrder(h, { tableId: 'tbl-a', items: [line(MENU.lamb)] });
    const first = await send(h, order.id, 1);
    reconcileConfirmed(h.ledger, first.roundId);

    const empty = await sendExpectingRefusal(h, order.id, 2);
    expect(empty.status).toBe(HttpStatus.BAD_REQUEST);
    expect(empty.body.error).toBe('nothing_to_send');
    expect(tillServer().requests).toHaveLength(1);
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe('the waiter taps Send twice', () => {
  it('the same request key sends once and the second tap is answered, not repeated', async () => {
    const till = await openTill();
    const h = await open(NATIVE_ENV(till.port));

    const order = await createDineInOrder(h, { tableId: 'tbl-a', items: [line(MENU.lamb)] });

    const first = await send(h, order.id, 1, [line(MENU.coke)]);
    const second = await send(h, order.id, 1, [line(MENU.coke)]);

    expect(second.roundId).toBe(first.roundId);
    expect(second.replayed).toBe(true);
    expect(second.status).toBe('sentAwaitingConfirmation');

    // ONE packet, ONE connection, ONE round - and crucially ONE coke. A
    // replayed request must not append its lines a second time.
    expect(tillServer().requests).toHaveLength(1);
    expect(tillServer().connections).toBe(1);
    expect(h.ledger.roundsFor(order.id)).toHaveLength(1);
    expect(h.ledger.items).toHaveLength(2);
    expect(pluesOf(packet(0))).toEqual(['101', '201']);
  });

  it('two simultaneous taps race to one round and one packet', async () => {
    const till = await openTill();
    const h = await open(NATIVE_ENV(till.port));

    const order = await createDineInOrder(h, { tableId: 'tbl-a', items: [line(MENU.lamb)] });

    // Both presses in flight at once, same key - a genuine double tap rather
    // than a sequential retry.
    const [a, b] = await Promise.all([
      send(h, order.id, 1, [line(MENU.coke)]),
      send(h, order.id, 1, [line(MENU.coke)]),
    ]);

    expect(a.roundId).toBe(b.roundId);
    // Exactly one of them did the sending.
    expect([a.replayed, b.replayed].filter(Boolean)).toHaveLength(1);
    expect(tillServer().requests).toHaveLength(1);
    expect(tillServer().connections).toBe(1);
    expect(h.ledger.roundsFor(order.id)).toHaveLength(1);
    expect(h.ledger.attempts).toHaveLength(1);
  });

  it('a DIFFERENT key on an in-flight table is refused, not silently merged', async () => {
    const till = await openTill();
    const h = await open(NATIVE_ENV(till.port));

    const order = await createDineInOrder(h, { tableId: 'tbl-a', items: [line(MENU.lamb)] });
    await send(h, order.id, 1);

    // An impatient second tap that minted a fresh key. The round is awaiting
    // confirmation, so the table's single in-flight slot is taken.
    const again = await sendExpectingRefusal(h, order.id, 2, [line(MENU.coke)]);
    expect(again.status).toBe(HttpStatus.CONFLICT);
    expect(again.body.error).toBe('round_in_flight');
    expect(tillServer().requests).toHaveLength(1);
    // And the coke was not written, so it is not stranded on a blocked table.
    expect(h.ledger.items).toHaveLength(1);
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe('the tablet is refreshed, or the API restarts', () => {
  it('a fresh process reads the same rounds, refuses to resend, and continues the numbering', async () => {
    const till = await openTill();
    const h = await open(NATIVE_ENV(till.port));

    const order = await createDineInOrder(h, { tableId: 'tbl-a', items: [line(MENU.lamb)] });
    const first = await send(h, order.id, 1);
    expect(h.nativeSendCount()).toBe(1);

    // ── The restart. A completely new module over the same rows. Nothing in
    //    memory survives; everything that matters was on disk before the
    //    socket opened. ──
    const ledger = h.ledger;
    await h.module.close();
    const after = setHarness(await build(NATIVE_ENV(till.port)));
    after.ledger.orders = ledger.orders;
    after.ledger.items = ledger.items;
    after.ledger.rounds = ledger.rounds;
    after.ledger.attempts = ledger.attempts;
    after.ledger.posSyncRecords = ledger.posSyncRecords;

    // The tablet re-sends the SAME press it was unsure about. It is answered
    // with the round that already exists, not with a second packet.
    const replay = await after.rounds.submitRound(REQUEST, order.id, {
      items: [],
      requestKey: REQ(1),
    });
    expect(replay.roundId).toBe(first.roundId);
    expect(replay.replayed).toBe(true);
    expect(tillServer().requests).toHaveLength(1);

    // Once resolved, service resumes and the numbering continues from disk
    // rather than from anything a browser held.
    reconcileConfirmed(after.ledger, first.roundId);
    const next = await after.rounds.submitRound(REQUEST, order.id, {
      items: [line(MENU.coke)],
      requestKey: REQ(2),
    });
    expect(next.sequence).toBe(2);
    expect(pluesOf(packet(1))).toEqual(['201']);
    expect(packet(1)).not.toContain('<StockItem>101</StockItem>');
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe('the endpoint refuses what it must', () => {
  it('a legacy-owned order is refused before anything is priced or written', async () => {
    const till = await openTill();
    const h = await open(NATIVE_ENV(till.port));

    const order = await createDineInOrder(h, { tableId: 'tbl-a', items: [line(MENU.lamb)] });
    h.ledger.recordFor(order.id)!.strategy = 'webit';

    const refused = await sendExpectingRefusal(h, order.id, 1, [line(MENU.coke)]);
    expect(refused.status).toBe(HttpStatus.CONFLICT);
    expect(refused.body.error).toBe('not_native_owned');
    expect(refused.body.safeToRetry).toBe(false);

    expect(tillServer().connections).toBe(0);
    expect(h.ledger.rounds).toHaveLength(0);
    // Not priced, not written. A refusal must cost nothing.
    expect(h.ledger.items).toHaveLength(1);
  });

  it('an unknown order is a 404, and nothing is opened', async () => {
    const till = await openTill();
    const h = await open(NATIVE_ENV(till.port));

    const refused = await sendExpectingRefusal(h, 'order-that-does-not-exist', 1);
    expect(refused.status).toBe(HttpStatus.NOT_FOUND);
    expect(tillServer().connections).toBe(0);
  });

  it('fails before send - and says so - when the writer cannot reach the till', async () => {
    const till = await openTill();
    const h = await open(NATIVE_ENV(till.port));
    const order = await createDineInOrder(h, { tableId: 'tbl-a', items: [line(MENU.lamb)] });

    // The till goes away between opening and sending: the shape of a network
    // outage mid-service.
    await tillServer().close();

    const failed = await sendExpectingRefusal(h, order.id, 1);
    expect(failed.status).toBe(HttpStatus.SERVICE_UNAVAILABLE);
    expect(failed.body.status).toBe('failedBeforeSend');
    // THE ONE OUTCOME THAT IS SAFE TO REPEAT, because nothing left the device.
    expect(failed.body.safeToRetry).toBe(true);
    expect(failed.body.requiresReconciliation).toBe(false);
    expect(String(failed.body.message)).toMatch(/safe to send again/i);
  }, 20000);
});
