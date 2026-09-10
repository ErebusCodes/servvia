/**
 * A ROUND IS NEVER TALKED DOWN.
 *
 * These tests are about one direction of travel. The banner may always become
 * more alarming, and may become less alarming only on positive evidence that
 * the round is settled - because on this integration the two failures are not
 * symmetric. A round wrongly shown as unresolved costs a waiter a walk to the
 * till. A round wrongly shown as fine gets sent again, and a second Lamb Shank
 * lands on a real customer's bill where nobody notices it until they read it.
 *
 * So most of what follows is written as an attempt to TALK A ROUND DOWN, and
 * asserts that it fails.
 */

import { describe, expect, it } from 'vitest';

import {
  mergeRoundReadback,
  type NativeRoundView,
  type RoundStatusRow,
} from './nativeRoundView';

/** The banner as a Send press leaves it: sent, ACKed, not yet proven. */
const AWAITING: NativeRoundView = {
  roundId: 'round-1',
  sequence: 1,
  status: 'sentAwaitingConfirmation',
  // The same sentence the readback's default row carries, so that the
  // "nothing changed" test below is genuinely about an unchanged round rather
  // than about two fixtures that happen to disagree.
  message: 'Sent to the till. Waiting for confirmation that it landed.',
  safeToRetry: false,
  requiresReconciliation: false,
  replayed: false,
};

/** The banner after an ambiguous send: red, and the Send button disabled. */
const UNCERTAIN: NativeRoundView = {
  roundId: 'round-1',
  sequence: 1,
  status: 'uncertain',
  message: 'This round may already be on the table. DO NOT send it again.',
  safeToRetry: false,
  requiresReconciliation: true,
  replayed: false,
};

const row = (over: Partial<RoundStatusRow> = {}): RoundStatusRow => ({
  roundId: 'round-1',
  sequence: 1,
  state: 'awaiting_native_confirmation',
  status: 'awaitingConfirmation',
  message: 'Sent to the till. Waiting for confirmation that it landed.',
  requiresReconciliation: false,
  settled: false,
  sendInitiatedAt: new Date().toISOString(),
  lineCount: 2,
  ...over,
});

const UNRESOLVED_ROW = row({
  state: 'unresolved',
  status: 'unresolved',
  message: 'This round may be on the table and may not be - nobody knows. DO NOT send it again.',
  requiresReconciliation: true,
  settled: false,
});

// ═══════════════════════════════════════════════════════════════════════════
describe('the escalation reaches the screen', () => {
  // ═════════════════════════════════════════════════════════════════════════

  it('turns a reassuring banner red when the server has given up on the round', () => {
    // The whole reason the readback exists: without it this banner keeps
    // saying "awaiting the till" for the rest of the service.
    const merged = mergeRoundReadback(AWAITING, [UNRESOLVED_ROW]);

    expect(merged?.requiresReconciliation).toBe(true);
    expect(merged?.status).toBe('uncertain');
    expect(merged?.message).toContain('DO NOT send it again');
    expect(merged?.safeToRetry).toBe(false);
  });

  it('shows a round the till has confirmed, which no send may ever report', () => {
    const merged = mergeRoundReadback(
      AWAITING,
      [row({ state: 'confirmed', status: 'confirmed', message: 'On the table in IdealPOS.', settled: true })],
    );

    expect(merged?.status).toBe('confirmed');
    expect(merged?.requiresReconciliation).toBe(false);
    // Confirmed is NOT an invitation to send again - it means the food is
    // already on the tab.
    expect(merged?.safeToRetry).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('attempts to talk a red banner down', () => {
  // ═════════════════════════════════════════════════════════════════════════

  it('refuses to relax on a row that is merely unsettled', () => {
    // The dangerous shape: the server no longer flags reconciliation but has
    // not settled the round either. That is ignorance, and ignorance must not
    // read as reassurance.
    const merged = mergeRoundReadback(
      UNCERTAIN,
      [row({ requiresReconciliation: false, settled: false })],
    );

    expect(merged?.requiresReconciliation).toBe(true);
    expect(merged?.status).toBe('uncertain');
    expect(merged?.safeToRetry).toBe(false);
  });

  it('refuses to relax while the round is still unresolved, however long that is', () => {
    const merged = mergeRoundReadback(UNCERTAIN, [UNRESOLVED_ROW]);
    expect(merged?.requiresReconciliation).toBe(true);
  });

  it('relaxes only when the round is settled - here, proven never to have been sent', () => {
    const merged = mergeRoundReadback(
      UNCERTAIN,
      [row({ state: 'failed', status: 'notSent', message: 'Never reached the till.', settled: true })],
    );

    expect(merged?.requiresReconciliation).toBe(false);
    expect(merged?.status).toBe('failedBeforeSend');
    // The one direction where retrying IS the right thing: nothing was created,
    // and the lines are back on the order waiting for a waiter to send them.
    expect(merged?.safeToRetry).toBe(true);
  });

  it('relaxes on a rejection, which is positive evidence that nothing was created', () => {
    const merged = mergeRoundReadback(
      UNCERTAIN,
      [row({ state: 'rejected', status: 'rejected', message: 'IdealPOS refused it.', settled: true })],
    );

    expect(merged?.requiresReconciliation).toBe(false);
    expect(merged?.safeToRetry).toBe(true);
  });

  it('does not offer a retry for a confirmed round, settled though it is', () => {
    const merged = mergeRoundReadback(
      UNCERTAIN,
      [row({ state: 'confirmed', status: 'confirmed', message: 'On the table.', settled: true })],
    );

    expect(merged?.requiresReconciliation).toBe(false);
    expect(merged?.safeToRetry).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('silence changes nothing', () => {
  // ═════════════════════════════════════════════════════════════════════════

  it('leaves the banner alone when the poll returned no rows at all', () => {
    // A failed fetch reaches here as an empty list at worst. A screen that
    // relaxed on an empty answer would relax hardest exactly when the server
    // was unreachable.
    expect(mergeRoundReadback(UNCERTAIN, [])).toBe(UNCERTAIN);
  });

  it('leaves the banner alone when the poll spoke only about other rounds', () => {
    const other = row({ roundId: 'round-2', sequence: 2, status: 'confirmed', settled: true });
    // A settled EARLIER round must not erase a live warning about a later one.
    expect(mergeRoundReadback(UNCERTAIN, [other])).toBe(UNCERTAIN);
  });

  it('returns the same object when nothing changed, so the banner does not re-render', () => {
    expect(mergeRoundReadback(AWAITING, [row()])).toBe(AWAITING);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('a poll that costs information is a poll that should not run', () => {
  // ═════════════════════════════════════════════════════════════════════════

  it('keeps the send-time cause while the round is still a human’s problem', () => {
    const registration: NativeRoundView = {
      ...UNCERTAIN,
      status: 'registrationRejected',
      message: 'The till refused this device’s registration — it is a licence, not a retry.',
    };

    // The readback knows only "unresolved". The send knew WHY, and why is the
    // half a waiter can act on.
    const merged = mergeRoundReadback(registration, [UNRESOLVED_ROW]);

    expect(merged?.status).toBe('registrationRejected');
    expect(merged?.message).toContain('licence');
    expect(merged?.requiresReconciliation).toBe(true);
  });

  it('adopts the server’s words once the state actually moves', () => {
    const merged = mergeRoundReadback(
      { ...UNCERTAIN, status: 'registrationRejected' },
      [row({ state: 'failed', status: 'notSent', message: 'Never reached the till.', settled: true })],
    );

    expect(merged?.status).toBe('failedBeforeSend');
    expect(merged?.message).toBe('Never reached the till.');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('a screen with no banner at all', () => {
  // ═════════════════════════════════════════════════════════════════════════

  it('recovers an unresolved round after a reload, which is what a refresh would have lost', () => {
    const merged = mergeRoundReadback(null, [
      row({ roundId: 'round-1', sequence: 1, status: 'confirmed', settled: true }),
      { ...UNRESOLVED_ROW, roundId: 'round-2', sequence: 2 },
    ]);

    expect(merged?.roundId).toBe('round-2');
    expect(merged?.requiresReconciliation).toBe(true);
    expect(merged?.safeToRetry).toBe(false);
  });

  it('invents nothing for rounds that are merely in flight', () => {
    // Materialising "sent, awaiting the till" for a press this device never
    // made would be the screen inventing history. Only the alarm survives a
    // reload; the reassurance does not need to.
    expect(mergeRoundReadback(null, [row()])).toBeNull();
    expect(mergeRoundReadback(null, [])).toBeNull();
  });

  it('picks the LATEST alarming round when more than one needs a human', () => {
    const merged = mergeRoundReadback(null, [
      { ...UNRESOLVED_ROW, roundId: 'round-1', sequence: 1 },
      { ...UNRESOLVED_ROW, roundId: 'round-3', sequence: 3 },
    ]);

    expect(merged?.sequence).toBe(3);
  });
});
