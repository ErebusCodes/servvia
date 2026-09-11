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
 * The predicate, and the ONE question it used to get wrong.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THE TOKEN IS WRITTEN BEFORE THE SALE EXISTS. RESOLVED 2026-09-11, STATIC.
 *
 * This function previously returned `confirmed` on token equality alone, and
 * carried a note saying the live run should measure "whether the token row is
 * written BEFORE or AFTER the sale is durable - if before, a stored token
 * proves receipt but not application". It is written BEFORE, and it did not
 * take a live run to find out. From `IPS.exe`, statically:
 *
 *   SaveChecksum (0x018267f0) is the only writer of AAAExampleData.Data for
 *   ColumnType='IH-<DeviceID>'. Its ONLY caller is 0x01827301, inside
 *   ProcessHandheldOrder (0x01826b90). Within that function the call sits
 *   BEFORE both
 *       0x01827664  DELETE * FROM PendingSaleLines WHERE Code='...'
 *       0x01827709  DELETE * FROM PendingSales     WHERE Code='...'
 *   and before every line-building read that follows them. The only two
 *   branches that bypass the call land at 0x01827306 - the instruction
 *   immediately after it - and no branch anywhere in the function jumps
 *   backward into or before it. So on every path that reaches the writes, the
 *   token has already been dealt with.
 *
 * WHAT THAT MEANS. A stored token proves our packet was PICKED UP by
 * ProcessHandheldOrder. It does not prove a single line exists. Worse, the
 * window it opens is not empty: between the token write and the line writes the
 * receiver DELETES the table's existing pending sale, so a crash in that window
 * leaves a till whose token says "seen", whose table has lost its previous
 * order, and whose new lines were never written. Confirming on the token alone
 * would report that state to a waiter as food on the table.
 *
 * SO `confirmed` NOW NEEDS BOTH HALVES, and they answer different questions:
 *
 *   CAUSAL   the till holds OUR token against OUR DeviceID. Only our packet
 *            could have put it there - this is what rules out "a waiter keyed
 *            the same items while we were deciding".
 *   DURABLE  a readback shows the table actually holds at least the lines this
 *            round was meant to add. This is what rules out "processing began
 *            and died before writing anything".
 *
 * Neither is sufficient. Content matching alone is CORRELATION and never
 * reaches `confirmed` - that was always true and is unchanged. Token equality
 * alone is now correlation of a different kind: evidence about our packet's
 * receipt, not about the customer's bill.
 *
 * NOTHING IN PRODUCTION EVER RAN THE OLD RULE. No connector build binds an
 * evidence reader, so this predicate has never been reached with real evidence.
 * The correction is pre-emptive, which is the only good time to make it.
 *
 * `notApplied` is unchanged and still needs positive evidence that the table
 * was not processed at all - which, by the same trace, also means the receiver
 * never reached the DELETE, so the table still holds whatever it held before.
 */
export function reconcileAmbiguousSend(
  record: SendInitiatedRecord,
  evidence: ReconciliationEvidence,
): ReconciliationVerdict {
  const stored = evidence.storedTokenForDevice;

  if (stored === record.token) {
    // CAUSAL, and now we need DURABLE beside it. `expectedLineCount` of 0 is
    // not a licence either: a round that expected nothing is a round that
    // should never have been sent, and it is not this predicate's job to
    // rescue one.
    const observed = evidence.nativeLineCountForTable;
    const expected = evidence.expectedLineCount;
    const durable =
      typeof observed === 'number' &&
      typeof expected === 'number' &&
      expected > 0 &&
      observed >= expected;

    if (durable) {
      return {
        kind: 'confirmed',
        basis:
          'the till is holding this attempt token against this DeviceID in ' +
          "AAAExampleData (ColumnType='IH-<DeviceID>'), which only our packet could " +
          `have put there, AND a readback shows ${String(observed)} line(s) on the ` +
          `table against the ${String(expected)} this round was to add - so the ` +
          'round was both caused by us and is durably on the tab',
      };
    }

    return {
      kind: 'manualResolutionRequired',
      basis:
        'the till holds this attempt token for this DeviceID, so our packet WAS ' +
        'picked up - but the token is written by ProcessHandheldOrder BEFORE the ' +
        'sale lines are written (SaveChecksum at 0x01827301, ahead of the ' +
        'PendingSales deletes at 0x01827664/0x01827709), so it proves receipt and ' +
        'not application. Without a readback showing the lines on the table this ' +
        'round cannot be called confirmed. ' +
        describeGap(record, evidence),
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
