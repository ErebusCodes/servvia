/**
 * Deciding whether a round that we could not confirm on the wire actually
 * landed.
 *
 * WHY AN ABSTRACTION RATHER THAN AN ANSWER. The exact confirmation condition
 * needs one thing we do not have: a legitimate handheld licence seat and the
 * short acceptance run it unlocks (`WAITERPAD-LICENCE-001`). What we DO know is
 * the shape of the evidence that will be available, and that shape is stable
 * enough to build against now, so the live run fills in a predicate rather than
 * forcing a redesign.
 *
 * WHAT THE RECEIVER LEAVES BEHIND, from the 2026-09-08 16:38 trace:
 *
 *   POSWorker.log      ProcessHandheldOrder STARTED : Table <n> and Map <m>
 *                      then one `IH<table>,... line per item
 *                      then SendToKitchen Code=`IH<table> POS=<p>
 *                      then Totally finished : Table <n>
 *   PrintJobs          KitchenPrinter_<n>.Dat written, printed, deleted
 *   POSActivity.log    CheckHandheldMessages data=`IH<table><clerk>
 *                      Deleting PendSale record `IH<table> p=<p>
 *   AAAExampleData     ColumnType='IH-<DeviceID>', Data=<our token>
 *
 * THE LAST ONE IS THE INTERESTING ONE, and it is new as of 2026-09-09. The
 * receiver stores OUR token verbatim, keyed by OUR DeviceID
 * (`INSERT INTO AAAExampleData (InsertDate, ColumnType, Data)`, 0x70e7d4). That
 * is the first thing found anywhere on this protocol that ties a durable row on
 * the till to a specific Verdura submission. It is one-deep, so it only speaks
 * about the MOST RECENT attempt for a device — but for the ambiguous-send case,
 * the most recent attempt is precisely the one in question.
 *
 * That is why `tokenEcho` is modelled as strong evidence and PLU/quantity
 * matching is not: content equality cannot distinguish "we caused this" from
 * "a waiter keyed the same items while we were deciding".
 */

import type { SendInitiatedRecord } from './waiterpad-table-round-writer';

/** Evidence a reconciler may be given. Every field is optional and may be unknown. */
export interface ReconciliationEvidence {
  /**
   * The `Data` value currently stored against `ColumnType='IH-<our DeviceID>'`.
   * `null` means the row is absent; `undefined` means we did not look.
   */
  readonly storedTokenForDevice?: string | null;
  /** Whether a `ProcessHandheldOrder` run for this table is recorded after our send. */
  readonly processedForTableAfterSend?: boolean;
  /** Whether a kitchen docket for this table was produced after our send. */
  readonly kitchenFiredAfterSend?: boolean;
  /** Lines currently on the native tab, if a readback was performed. */
  readonly nativeLineCountForTable?: number;
  /** Lines the round expected to add. */
  readonly expectedLineCount?: number;
}

export type ReconciliationVerdict =
  /** The round is on the till. Safe to mark confirmed. */
  | { readonly kind: 'confirmed'; readonly basis: string }
  /** The round is definitely NOT on the till. Safe to re-prepare as a new attempt. */
  | { readonly kind: 'notApplied'; readonly basis: string }
  /** Neither could be established. A human decides. */
  | { readonly kind: 'manualResolutionRequired'; readonly basis: string };

/**
 * The predicate the next acceptance run will finalise.
 *
 * DELIBERATELY CONSERVATIVE. It returns `confirmed` on exactly one condition —
 * the till is holding OUR token against OUR device — and `notApplied` on
 * exactly one — the till is holding a DIFFERENT token AND nothing was processed
 * for the table. Everything else is a human's call, which is the correct
 * default for a protocol where ACK precedes processing and a NAK can follow an
 * accepted order.
 *
 * WHAT WOULD MAKE THIS STRONGER, and what the live run should measure:
 *   * whether the token row is written BEFORE or AFTER the sale is durable —
 *     if before, a stored token proves receipt but not application;
 *   * whether `Totally finished` is reliably observable from Verdura's side.
 */
export function reconcileAmbiguousSend(
  record: SendInitiatedRecord,
  evidence: ReconciliationEvidence,
): ReconciliationVerdict {
  const stored = evidence.storedTokenForDevice;

  if (stored === record.token) {
    return {
      kind: 'confirmed',
      basis:
        'the till is holding this attempt token against this DeviceID in ' +
        "AAAExampleData (ColumnType='IH-<DeviceID>'), which only our packet could " +
        'have put there',
    };
  }

  if (
    typeof stored === 'string' &&
    stored !== record.token &&
    evidence.processedForTableAfterSend === false
  ) {
    return {
      kind: 'notApplied',
      basis:
        'the till holds a different token for this device and recorded no ' +
        'ProcessHandheldOrder for this table after the send',
    };
  }

  if (stored === null && evidence.processedForTableAfterSend === false) {
    return {
      kind: 'notApplied',
      basis: 'no token row exists for this device and nothing was processed for the table',
    };
  }

  return {
    kind: 'manualResolutionRequired',
    basis: describeGap(record, evidence),
  };
}

function describeGap(record: SendInitiatedRecord, evidence: ReconciliationEvidence): string {
  const parts: string[] = [];
  if (evidence.storedTokenForDevice === undefined) {
    parts.push('the stored token for this device was not read');
  }
  if (evidence.processedForTableAfterSend === undefined) {
    parts.push('no processing evidence was gathered for the table');
  }
  if (
    evidence.nativeLineCountForTable !== undefined &&
    evidence.expectedLineCount !== undefined &&
    evidence.nativeLineCountForTable !== evidence.expectedLineCount
  ) {
    parts.push(
      `native line count ${evidence.nativeLineCountForTable} does not match the ` +
        `expected ${evidence.expectedLineCount}`,
    );
  }
  if (parts.length === 0) {
    parts.push('the available evidence does not distinguish applied from not applied');
  }
  return (
    `round ${record.roundId} attempt ${record.attemptId} on table ${record.table}: ` +
    `${parts.join('; ')}. Content matching alone is NOT causality.`
  );
}

/**
 * Recorded so the next acceptance run has a checklist rather than a memory.
 */
export const RECONCILIATION_OPEN_QUESTIONS = [
  'Is the AAAExampleData token row written before or after the sale becomes durable?',
  'Does a NAKREGO ever leave a token row behind? (2026-09-09 says the gate runs first, so it should not.)',
  'Is `Totally finished : Table <n>` observable from Verdura without log scraping?',
  'Does a second round on the same table overwrite the same one-deep token row?',
] as const;
