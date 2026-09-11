/**
 * Deciding whether a round that we could not confirm on the wire actually
 * landed.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THIS FILE IS NOW AN ADAPTER. The decision lives in
 * `waiterpad-native-evidence.ts`.
 *
 * It used to hold the rule itself, and the rule it held was wrong in a way
 * worth recording. It asked:
 *
 *     stored token === our token   AND   observedLineCount >= expectedLineCount
 *
 * The second term looks like a durability check and is not one. A tab already
 * carrying five lines satisfies `5 >= 2` for a two-line round that never
 * arrived, so on any occupied table the predicate reduced to token equality —
 * and token equality is precisely what must never confirm, because IPS.exe
 * writes our token (`SaveChecksum` 0x018267f0, called at 0x01827301 inside
 * `ProcessHandheldOrder` 0x01826b90) BEFORE the `DELETE * FROM
 * PendingSaleLines` at 0x01827664, the `DELETE * FROM PendingSales` at
 * 0x01827709, and every line write that follows them. A stored token proves our
 * packet was PICKED UP. It does not prove one line exists.
 *
 * The durable half is now a DELTA against a baseline captured before the
 * socket, evaluated as a line multiset. See the header of
 * `waiterpad-native-evidence.ts` for why each half is necessary and why neither
 * is sufficient.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHY THE THREE-VERDICT SHAPE SURVIVES.
 *
 * The evaluator answers with five outcomes; the reconciler can act on three.
 * The mapping is deliberately lossy in one direction only — every outcome that
 * is not `confirmedCausalDurable` and not `notProven` becomes
 * `manualResolutionRequired`, which changes nothing about the round except what
 * a human is eventually told. `pending`, `unavailable` and `conflicting` are
 * different facts and are preserved in the basis text, because an operator
 * reading an incident needs to know whether the till disagreed with us or
 * simply could not be reached.
 *
 * WHAT THE RECEIVER LEAVES BEHIND, from the 2026-09-08 16:38 trace, unchanged:
 *
 *   POSWorker.log      ProcessHandheldOrder STARTED : Table <n> and Map <m>
 *   PrintJobs          KitchenPrinter_<n>.Dat written, printed, deleted
 *   POSActivity.log    CheckHandheldMessages data=`IH<table><clerk>
 *   AAAExampleData     ColumnType='IH-<DeviceID>', Data=<our token>
 */

import {
  evaluateStrongNativeEvidence,
  mayConfirm,
  mayReleaseLines,
  type StrongEvidenceVerdict,
  type StrongNativeEvidence,
} from './waiterpad-native-evidence';
import type { SendInitiatedRecord } from './waiterpad-table-round-writer';

/**
 * Evidence a reconciler may be given.
 *
 * This is `StrongNativeEvidence` verbatim. It is re-exported under the old name
 * so the reader port and its implementations keep one vocabulary, and so that a
 * grep for either name finds the same type rather than two that drifted.
 */
export type ReconciliationEvidence = StrongNativeEvidence;

export type ReconciliationVerdict =
  /** The round is on the till. Safe to mark confirmed. */
  | { readonly kind: 'confirmed'; readonly basis: string }
  /** The round is definitely NOT on the till. Safe to re-prepare as a new attempt. */
  | { readonly kind: 'notApplied'; readonly basis: string }
  /** Neither could be established. A human decides. */
  | { readonly kind: 'manualResolutionRequired'; readonly basis: string };

/**
 * The predicate, as the reconciler consumes it.
 *
 * `confirmed` REQUIRES BOTH HALVES and cannot be reached any other way:
 *
 *   CAUSAL   the till holds OUR token against OUR DeviceID. Only our packet
 *            could have put it there — this is what rules out "a waiter keyed
 *            the same items while we were deciding".
 *   DURABLE  the native table gained EXACTLY this round's lines, measured
 *            against a baseline captured before the socket opened. This is
 *            what rules out "processing began and died before writing
 *            anything", and what stops a line that was already on the tab from
 *            standing in for one that never arrived.
 *
 * `notApplied` still needs POSITIVE evidence that the table was not processed
 * at all — which, by the same trace, also means the receiver never reached the
 * DELETE, so the table still holds whatever it held before. Ignorance never
 * reaches it: a source that could not be read yields `manualResolutionRequired`,
 * never a release of the round's lines.
 */
export function reconcileAmbiguousSend(
  record: SendInitiatedRecord,
  evidence: ReconciliationEvidence,
): ReconciliationVerdict {
  const verdict = evaluateStrongNativeEvidence(
    {
      roundId: record.roundId,
      attemptId: record.attemptId,
      table: String(record.table),
      token: record.token,
    },
    {
      ...evidence,
      // The attempt froze what it actually sent. A reader may override it only
      // by supplying its own, which no production reader does — it exists so a
      // test can drive a mismatch between what was sent and what is expected.
      expectedItems: evidence.expectedItems ?? record.expectedItems,
    },
  );

  return toReconciliationVerdict(verdict);
}

/**
 * Five outcomes to three actions.
 *
 * The guards are `mayConfirm` and `mayReleaseLines` rather than a comparison
 * against the outcome string, because those two functions also check that the
 * verdict's own `causal`/`durable` flags agree with its label. A future edit
 * that reached the label without satisfying both halves would still be refused
 * here.
 */
export function toReconciliationVerdict(verdict: StrongEvidenceVerdict): ReconciliationVerdict {
  if (mayConfirm(verdict)) {
    return { kind: 'confirmed', basis: verdict.basis };
  }
  if (mayReleaseLines(verdict)) {
    return { kind: 'notApplied', basis: verdict.basis };
  }
  return { kind: 'manualResolutionRequired', basis: verdict.basis };
}

/**
 * Recorded so the next acceptance run has a checklist rather than a memory.
 *
 * The first question is ANSWERED — statically, from IPS.exe, on 2026-09-11 —
 * and is kept here with its answer rather than deleted, because the answer is
 * the reason this module's shape changed.
 */
export const RECONCILIATION_OPEN_QUESTIONS = [
  'ANSWERED 2026-09-11 (STATIC-PROVEN): the AAAExampleData token row is written BEFORE the sale ' +
    'becomes durable — SaveChecksum 0x018267f0, called at 0x01827301, ahead of the deletes at ' +
    '0x01827664/0x01827709. Token equality therefore proves receipt, not application.',
  'Does a NAKREGO ever leave a token row behind? (2026-09-09 says the gate runs first, so it should not.)',
  'Is `Totally finished : Table <n>` observable from Verdura without log scraping?',
  'Does a second round on the same table overwrite the same one-deep token row?',
  'Does PendingSaleLines.PendingSaleID exist under that name on the Front-desk machine? It comes ' +
    "from IPS.Data.SQL.dll's embedded DDL rather than from the sealed capture, and the readback " +
    'join depends on it.',
] as const;
