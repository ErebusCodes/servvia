/**
 * ONE ORDER, ONE POS PIPELINE. THE PROOF.
 *
 * WHAT THIS FILE IS DEFENDING. Verdura can now put a dine-in order into
 * IdealPOS two ways - the certified Webit/Bridge path, and the native handheld
 * Order2 path. Both are real, both work, and until the strategy column existed
 * both could claim the SAME order: the two dispatcher sweeps select on
 * `POSSyncRecord.status = not_synced`, and `NativeTableRoundService` did not
 * touch `POSSyncRecord` at all. One restaurant order becomes two dockets on one
 * table and two lines on one bill, and nobody finds out until a customer
 * disputes the total.
 *
 * THE TWO NUMBERS EVERY TEST BELOW IS REALLY ABOUT:
 *
 *     WEBIT_SEND_COUNT   how many idealpos.submit_order.v1 ConnectorCommands
 *                        were created. For a native order this must be 0.
 *     NATIVE_SEND_COUNT  how many Order2 packets reached the till. For any
 *                        order this must be <= 1 per round, and 0 for an order
 *                        the native path does not own.
 *
 * They are asserted together, in the same test, from the same run - because the
 * failure being excluded is not "one of them went wrong", it is "both of them
 * went right, for the same order".
 *
 * HOW REAL THIS IS. The real `OrdersService` creates the orders. The real
 * `PosStrategyResolver` reads the real configuration. The real
 * `IdealposOrderDispatcherService` and the real `PosSyncDispatcherService`
 * sweep, with their real `where` clauses evaluated by an in-memory store that
 * implements Prisma's filter semantics rather than ignoring them - so deleting
 * `strategy: webit` from either query fails these tests instead of passing
 * them. The real `NativeTableRoundService`, writer, codec and TCP transport
 * carry the native side, against the fake WaiterPad listener that records exact
 * bytes.
 *
 * Only three things are replaced, and each is a genuine external boundary: the
 * database, the BullMQ queue, and the till.
 */

import {
  build,
  closeHarness,
  ACTOR,
  createDineInOrder,
  installHarnessLifecycle,
  LEGACY_ENV,
  MENU_ITEM,
  NATIVE_ENV,
  openTill,
  runBothSweeps,
  setHarness,
  tillServer,
  VENUE,
  type Harness,
  type Ledger,
} from './testing/native-order-harness';
import { NativeRoundError } from './waiterpad/native-table-round.service';
import { POSSyncStatus, PosSubmissionStrategy, ServiceMode } from '@prisma/client';
import { ServiceUnavailableException } from '@nestjs/common';

installHarnessLifecycle();

/** The harness under test, registered for teardown. */
let harness: Harness | null = null;
async function open(env: Record<string, string>): Promise<Harness> {
  harness = setHarness(await build(env));
  return harness;
}

/** A second module over the SAME rows: a restart, or a second worker process. */
async function openOver(ledger: Ledger, env: Record<string, string>): Promise<Harness> {
  const fresh = await build(env);
  fresh.ledger.posSyncRecords = ledger.posSyncRecords;
  fresh.ledger.orders = ledger.orders;
  fresh.ledger.items = ledger.items;
  fresh.ledger.rounds = ledger.rounds;
  fresh.ledger.attempts = ledger.attempts;
  return fresh;
}

// ═════════════════════════════════════════════════════════════════════════
// 1. A native dine-in order is owned by native, and Webit can never have it.
// ═════════════════════════════════════════════════════════════════════════
describe('1. a native dine-in order', () => {
  it('is owned by native, sends exactly once natively, and leaves NOTHING for the Webit sweep', async () => {
    const till = await openTill();
    const h = await open(NATIVE_ENV(till.port));

    const order = await createDineInOrder(h);

    // ── The durable ownership decision, written with the order. ──
    const record = h.ledger.recordFor(order.id)!;
    expect(record.strategy).toBe(PosSubmissionStrategy.native_table_round);
    // And it is NOT `not_synced`, which is the status both sweeps select on.
    // This is the structural half of the guarantee: it holds for any query
    // that has never heard of the strategy column.
    expect(record.status).toBe(POSSyncStatus.owned_by_native);
    expect(record.status).not.toBe(POSSyncStatus.not_synced);

    // ── The native send. One packet. ──
    const sent = await h.native.sendToKitchen(order.id);
    expect(sent.status).toBe('sentAwaitingConfirmation');
    expect(h.nativeSendCount()).toBe(1);

    // ── Now let BOTH legacy sweeps run, repeatedly, as they would all shift. ──
    await runBothSweeps(h);
    await runBothSweeps(h);
    await runBothSweeps(h);

    // THE ASSERTION THIS FILE EXISTS FOR.
    expect(h.webitSendCount()).toBe(0);
    expect(h.queuedForProcessing()).toBe(0);
    expect(h.nativeSendCount()).toBe(1);

    // The record was not touched by either sweep - no claim, no attempt, no
    // status move. An order that is somebody else's is left entirely alone.
    expect(record.status).toBe(POSSyncStatus.owned_by_native);
    expect(record.connectorSubmitCommandId).toBeNull();
    expect(record.attemptCount).toBe(0);
    expect(record.dispatchAttemptCount).toBe(0);
    expect(record.dispatchClaimId).toBeNull();
  });
});

// ═════════════════════════════════════════════════════════════════════════
// 2. A legacy order still behaves exactly as it always did.
// ═════════════════════════════════════════════════════════════════════════
describe('2. a legacy (non-native) order', () => {
  it('is owned by webit, is picked up by the Webit sweep, and the native service refuses it', async () => {
    await openTill();
    // Production's own configuration: IDEALPOS_POS_STRATEGY unset. The till is
    // listening, which is the point - a native packet COULD physically be
    // sent, and the only thing stopping it is ownership.
    const h = await open(LEGACY_ENV);

    const order = await createDineInOrder(h);

    const record = h.ledger.recordFor(order.id)!;
    expect(record.strategy).toBe(PosSubmissionStrategy.webit);
    expect(record.status).toBe(POSSyncStatus.not_synced);

    // The legacy path still works, unchanged. This is the half of the
    // invariant that is easy to break while fixing the other half.
    const swept = await h.webitSweep.sweepDispatch();
    expect(swept.eligible).toBe(1);
    expect(h.webitSendCount()).toBe(1);

    // ── And the native service refuses it, BEFORE any transport. ──
    await expect(h.native.sendToKitchen(order.id)).rejects.toMatchObject({
      reason: 'not_native_owned',
    });
    expect(h.nativeSendCount()).toBe(0);
    expect(tillServer().connections).toBe(0);
    // No round was opened and no line was claimed, so nothing about this
    // order's Webit delivery was disturbed by the attempt.
    expect(h.ledger.rounds).toHaveLength(0);
    expect(h.ledger.items.every((i) => i.nativeRoundId === null)).toBe(true);
  });
});

// ═════════════════════════════════════════════════════════════════════════
// 3 & 4. Fail closed. Never fail over.
// ═════════════════════════════════════════════════════════════════════════
describe('3. the native strategy is selected but the feature is disabled', () => {
  it('refuses the order outright - no native send, and NO Webit fallback', async () => {
    const till = await openTill();
    const h = await open(NATIVE_ENV(till.port, { IDEALPOS_WAITERPAD_NATIVE_ENABLED: 'false' }));

    // The order is never created. Staff see a refusal at the tablet, which is
    // a problem somebody fixes - unlike a silent switch to Webit, which is a
    // problem nobody sees until a certification turns out to be worthless.
    await expect(createDineInOrder(h)).rejects.toBeInstanceOf(ServiceUnavailableException);

    expect(h.ledger.orders).toHaveLength(0);
    expect(h.ledger.posSyncRecords).toHaveLength(0);

    await runBothSweeps(h);
    expect(h.webitSendCount()).toBe(0);
    expect(h.nativeSendCount()).toBe(0);
    expect(tillServer().connections).toBe(0);
  });
});

describe('4. the native strategy is selected but the configuration is invalid', () => {
  it.each([
    ['no host', { IDEALPOS_WAITERPAD_HOST: '' }],
    ['no DeviceID', { IDEALPOS_WAITERPAD_DEVICE_ID: '' }],
    ['no clerk', { IDEALPOS_WAITERPAD_CLERK: '' }],
    ['an out-of-range port', { IDEALPOS_WAITERPAD_PORT: '70000' }],
  ])('fails closed on %s - no native send, no Webit fallback', async (_label, over) => {
    const till = await openTill();
    const h = await open(NATIVE_ENV(till.port, over));

    await expect(createDineInOrder(h)).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(h.ledger.posSyncRecords).toHaveLength(0);

    await runBothSweeps(h);
    expect(h.webitSendCount()).toBe(0);
    expect(h.nativeSendCount()).toBe(0);
  });

  it('refuses an unrecognised strategy rather than defaulting to either pipeline', async () => {
    const till = await openTill();
    // The certification-killing typo. Defaulting here would run every order
    // through Webit while an operator believed they were exercising native.
    const h = await open(NATIVE_ENV(till.port, { IDEALPOS_POS_STRATEGY: 'native_table_rouns' }));

    await expect(createDineInOrder(h)).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(h.ledger.posSyncRecords).toHaveLength(0);
    await runBothSweeps(h);
    expect(h.webitSendCount()).toBe(0);
    expect(h.nativeSendCount()).toBe(0);
  });
});

// ═════════════════════════════════════════════════════════════════════════
// 5. The strategy survives a restart, because it was never in memory.
// ═════════════════════════════════════════════════════════════════════════
describe('5. a crash after ownership is persisted', () => {
  it('comes back with the same strategy, and a restarted Webit sweep still cannot claim it', async () => {
    const till = await openTill();
    const before = await open(NATIVE_ENV(till.port));

    const order = await createDineInOrder(before);
    await before.native.sendToKitchen(order.id);
    expect(before.nativeSendCount()).toBe(1);

    const ledger = before.ledger;
    const record = ledger.recordFor(order.id)!;
    const strategyBefore = record.strategy;

    // ── The restart. A completely new module over the SAME rows, and this
    //    time with the native strategy configuration REMOVED, as if an
    //    operator "fixed" it during the outage. That edit must not be able to
    //    move an order that may already be on the native tab. ──
    await before.module.close();
    const after = setHarness(await openOver(ledger, LEGACY_ENV));

    expect(ledger.recordFor(order.id)!.strategy).toBe(strategyBefore);
    expect(ledger.recordFor(order.id)!.status).toBe(POSSyncStatus.owned_by_native);

    await runBothSweeps(after);
    expect(after.webitSendCount()).toBe(0);
    expect(after.queuedForProcessing()).toBe(0);
    // Still exactly the one packet from before the restart.
    expect(tillServer().requests).toHaveLength(1);

    // And the native service, restarted, will not re-send the round either.
    await expect(after.native.sendToKitchen(order.id)).rejects.toMatchObject({
      reason: 'round_in_flight',
    });
    expect(tillServer().requests).toHaveLength(1);
  });
});

// ═════════════════════════════════════════════════════════════════════════
// 6. A duplicate request selects nothing a second time.
// ═════════════════════════════════════════════════════════════════════════
describe('6. the same order submitted twice', () => {
  it('re-uses the original order and its original strategy - no second selection, no second send', async () => {
    const till = await openTill();
    const h = await open(NATIVE_ENV(till.port));

    const dto = {
      venueId: h.ledger.venueId,
      tableId: h.ledger.tableId,
      serviceMode: ServiceMode.dine_in,
      guests: 2,
      items: [{ menuItemId: MENU_ITEM.id, quantity: 1 }],
      idempotencyKey: 'the-same-key-from-one-double-tap',
    } as never;

    const first = await h.orders.createStaffOrder(dto, VENUE.organizationId, ACTOR);
    await h.native.sendToKitchen(first.id);

    // The replay. The REAL idempotency lookup finds the original, so
    // persistOrder - and therefore the strategy decision - is never reached a
    // second time.
    const second = await h.orders.createStaffOrder(dto, VENUE.organizationId, ACTOR);

    expect(second.id).toBe(first.id);
    expect(h.ledger.posSyncRecords).toHaveLength(1);
    expect(h.ledger.recordFor(first.id)!.strategy).toBe(PosSubmissionStrategy.native_table_round);

    // One native send, and the second press has nothing new to carry.
    expect(h.nativeSendCount()).toBe(1);
    await expect(h.native.sendToKitchen(first.id)).rejects.toMatchObject({
      reason: 'round_in_flight',
    });
    expect(h.nativeSendCount()).toBe(1);

    await runBothSweeps(h);
    expect(h.webitSendCount()).toBe(0);
  });
});

// ═════════════════════════════════════════════════════════════════════════
// 7 & 8. The sweep racing the native submission, and arriving after it.
// ═════════════════════════════════════════════════════════════════════════
describe('7. a dispatcher sweep racing the native submission', () => {
  it('only the native path wins, whichever order they interleave in', async () => {
    const till = await openTill();
    const h = await open(NATIVE_ENV(till.port));

    const order = await createDineInOrder(h);

    // Both start at once. There is no lock and no ordering here on purpose:
    // the exclusion must come from the row itself, not from who got there
    // first, because a real sweep runs on a timer nobody controls.
    const [sendResult] = await Promise.all([
      h.native.sendToKitchen(order.id),
      h.webitSweep.sweepDispatch(),
      h.legacySweep.sweep(),
      h.webitSweep.sweepDispatch(),
    ]);

    expect(sendResult.status).toBe('sentAwaitingConfirmation');
    expect(h.nativeSendCount()).toBe(1);
    expect(h.webitSendCount()).toBe(0);
    expect(h.queuedForProcessing()).toBe(0);
  });
});

describe('8. the legacy sweep running after a native send has been initiated', () => {
  it('skips the order permanently, tick after tick, and never marks it failed', async () => {
    const till = await openTill();
    const h = await open(NATIVE_ENV(till.port));

    const order = await createDineInOrder(h);
    await h.native.sendToKitchen(order.id);
    expect(h.ledger.attempts).toHaveLength(1); // SendInitiated evidence exists

    for (let tick = 0; tick < 10; tick += 1) await runBothSweeps(h);

    expect(h.webitSendCount()).toBe(0);
    expect(h.queuedForProcessing()).toBe(0);

    const record = h.ledger.recordFor(order.id)!;
    // "Skipped" must mean untouched. Marking it `failed` would put a false
    // error in front of staff whose round is on its way to the till normally.
    expect(record.status).toBe(POSSyncStatus.owned_by_native);
    expect(record.errorMessage).toContain('native IdealPOS handheld workflow');
    expect(record.failedAt).toBeUndefined();
  });
});

// ═════════════════════════════════════════════════════════════════════════
// 9. The native service, called for an order it does not own.
// ═════════════════════════════════════════════════════════════════════════
describe('9. the native service called for a legacy-owned order', () => {
  it('refuses before the transport, even with a perfectly good native configuration', async () => {
    const till = await openTill();
    // Native fully configured AND usable. The ONLY thing standing between this
    // order and a real Order2 packet is the ownership record.
    const h = await open(NATIVE_ENV(till.port));

    const order = await createDineInOrder(h);
    // Somebody hands this order to the Webit pipeline instead - a data repair,
    // a backfill, a bug. The native service must now refuse it.
    const record = h.ledger.recordFor(order.id)!;
    record.strategy = PosSubmissionStrategy.webit;
    record.status = POSSyncStatus.not_synced;

    await expect(h.native.sendToKitchen(order.id)).rejects.toBeInstanceOf(NativeRoundError);
    await expect(h.native.sendToKitchen(order.id)).rejects.toMatchObject({
      reason: 'not_native_owned',
    });

    expect(h.nativeSendCount()).toBe(0);
    expect(tillServer().connections).toBe(0);
    expect(h.ledger.rounds).toHaveLength(0);
    expect(h.ledger.attempts).toHaveLength(0);
  });
});

// ═════════════════════════════════════════════════════════════════════════
// 10. Two independent workers cannot disagree.
// ═════════════════════════════════════════════════════════════════════════
describe('10. two independent dispatch workers', () => {
  it('cannot claim different routes for the same order, because neither of them decides one', async () => {
    const till = await openTill();
    const h = await open(NATIVE_ENV(till.port));

    const order = await createDineInOrder(h);
    const strategy = h.ledger.recordFor(order.id)!.strategy;

    // A second, entirely separate worker process over the same rows - and, to
    // make it as adversarial as possible, one configured for the OTHER
    // strategy. If a route were ever derived at dispatch time rather than read
    // from the row, this is the configuration that would derive a different
    // one.
    const secondWorker = await openOver(h.ledger, LEGACY_ENV);
    try {
      await Promise.all([
        runBothSweeps(h),
        runBothSweeps(secondWorker),
        h.native.sendToKitchen(order.id),
      ]);

      // The route is what it was. No worker moved it, because no worker has
      // the authority to: the only writer of `strategy` is the transaction
      // that created the order, and it has already committed.
      expect(h.ledger.recordFor(order.id)!.strategy).toBe(strategy);
      expect(h.webitSendCount()).toBe(0);
      expect(secondWorker.webitSendCount()).toBe(0);
      expect(h.queuedForProcessing()).toBe(0);
      expect(secondWorker.queuedForProcessing()).toBe(0);
      expect(h.nativeSendCount()).toBe(1);
    } finally {
      await closeHarness(secondWorker);
    }
  });
});
