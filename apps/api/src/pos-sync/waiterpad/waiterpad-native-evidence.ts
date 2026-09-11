/**
 * THE STRONG EVIDENCE MODEL: what it takes to say a round is on a customer's bill.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THE QUESTION THIS FILE ANSWERS, EXACTLY.
 *
 *   "Did THIS Verdura round become part of THIS native IdealPOS table sale?"
 *
 * Not "is there an order like ours on the till". Not "did the till ACK". Those
 * are different questions with cheaper answers, and answering them instead is
 * how a waiter gets told the kitchen has food it never heard of.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHY ONE HALF IS NEVER ENOUGH, AND WHICH HALF IS WHICH.
 *
 * CAUSAL — the till holds OUR attempt token against OUR DeviceID, in
 * `AAAExampleData` at `ColumnType='IH-<DeviceID>'`. Only our packet could have
 * put that value there, so it rules out the one thing content can never rule
 * out: a waiter keying the same items on the terminal while we were deciding.
 *
 * It does NOT prove a single line exists. STATIC-PROVEN from IPS.exe:
 * `SaveChecksum` (0x018267f0) is the only writer of that row, its only caller
 * is 0x01827301 inside `ProcessHandheldOrder` (0x01826b90), and that call sits
 * BEFORE the `DELETE * FROM PendingSaleLines` at 0x01827664 and the
 * `DELETE * FROM PendingSales` at 0x01827709 — and therefore before every line
 * write that follows them. The window this opens is not empty: between the
 * token write and the line writes the receiver DELETES the table's existing
 * pending sale. A crash there leaves a till whose token says "seen", whose
 * table has lost its previous order, and whose new lines never existed.
 *
 * DURABLE — a readback of the native table shows the round's lines actually on
 * it. On its own this is CORRELATION and nothing more: two rounds that ordered
 * the same item are indistinguishable by content, and
 * `REQUESTTABLESTATUS` does not emit `OrderedTime`, the only field that
 * partitions a sale's lines into the rounds that produced them.
 *
 * So `confirmed` requires BOTH, and they are checked against different things.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THE DURABLE HALF IS A DELTA, NOT A COUNT. THIS IS THE CORRECTION.
 *
 * The previous predicate asked `observedLineCount >= expectedLineCount`. That
 * is satisfied by almost any occupied table: a tab already carrying five lines
 * "proves" a two-line round that never arrived. Worse, it is satisfied by
 * exactly the coincidence the causal half exists to exclude — so in practice it
 * reduced to token equality, which is the thing this module must never do.
 *
 * The durable half is therefore
 *
 *     (native lines AFTER) minus (native lines BEFORE) === (this round's items)
 *
 * evaluated as a multiset keyed by native code. The BEFORE term is a baseline
 * captured and persisted BEFORE the socket was opened — see
 * `preSendTableSnapshot` on `NativeSendAttempt`. Without a durable baseline
 * there is no delta, and this module says so rather than falling back to a
 * count.
 *
 * That single change is what makes each of these decidable rather than lucky:
 *
 *   same PLU already on the table   it is in the baseline, so it is not delta
 *   round 2 repeats round 1's item  round 1's line is in round 2's baseline
 *   qty 1, then qty 1 again         baseline 1 -> after 2 -> delta 1
 *   qty 2 against two earlier 1s    baseline 2 -> after 4 -> delta 2
 *   someone else adds a line        unexplained growth -> conflicting
 *   a line disappears               prior lines changed -> conflicting
 *
 * ─────────────────────────────────────────────────────────────────────────
 * PURE. No I/O, no clock, no database. Every rule below is a function of its
 * arguments, which is what lets the whole decision surface be mutation-tested
 * without a till.
 */

/** How a native table read resolved. "Could not read" is NOT "nothing there". */
export type NativeTableReadStatus =
  /** Resolved: exactly one sale for this table context, canonicalised. */
  | 'observed'
  /** Resolved: no native sale exists for this table context. The table is free. */
  | 'noOpenSale'
  /** Two sales matched one table context, or a line could not be read. Never reduced to one. */
  | 'ambiguous'
  /** Unreachable, timed out, permission denied. Reporting this as `noOpenSale` is how a round gets called dead. */
  | 'unavailable';

/** One native line, reduced to the only two things confirmation may reason about. */
export interface NativeLineObservation {
  readonly nativeCode: string;
  readonly quantity: number;
}

/**
 * One observation of a native table.
 *
 * `pos` and `map` are carried because they are the table CONTEXT: the same
 * table number exists in the web/takeaway partition, and reading across that
 * boundary would let a web ticket confirm a dine-in round.
 */
export interface NativeTableSnapshot {
  readonly status: NativeTableReadStatus;
  readonly tableCode?: string;
  readonly pos?: number;
  readonly map?: string;
  readonly lines?: readonly NativeLineObservation[];
  /** Populated for every non-`observed` status. Surfaced to operators verbatim. */
  readonly reason?: string;
  /** Observational only — POSServer regenerates it on ordinary edits. Never matched on. */
  readonly observedRowId?: number;

  /**
   * When this observation was taken, as an ISO timestamp.
   *
   * Carried so a BASELINE can be aged. It plays no part in the delta itself —
   * `evaluateStrongNativeEvidence` never reads it — because a timestamp cannot
   * make two line multisets agree or disagree. Its only job is upstream, where
   * `isUsableBaseline` refuses an observation too old to describe the table
   * now. An absent value means the age is unknown, which is refused there.
   */
  readonly observedAt?: string;
}

/** What this round was supposed to add, in native terms. */
export interface ExpectedNativeItem {
  readonly nativeCode: string;
  readonly quantity: number;
}

/**
 * Everything a reader may gather about one attempt. Every field is optional and
 * `undefined` means "did not look" — which is ignorance, never absence.
 * Conflating the two is how a round gets marked dead because a query timed out.
 */
export interface StrongNativeEvidence {
  /**
   * `Data` at `ColumnType='IH-<our DeviceID>'`.
   * A string is the stored value; `null` means the row is absent; `undefined`
   * means we did not read it.
   */
  readonly storedTokenForDevice?: string | null;

  /**
   * Whether a `ProcessHandheldOrder` run for this table is recorded after our
   * send. Only ever used to strengthen a NEGATIVE — it can license `notProven`,
   * and it can never contribute to `confirmed`.
   */
  readonly processedForTableAfterSend?: boolean;

  /**
   * Whether a kitchen docket for this table was produced after our send.
   *
   * OBSERVATIONAL ONLY. It is carried so an operator reading an incident can
   * see it, and it contributes to NO branch of the decision below. Two reasons:
   * a docket does not say whose round produced it, and `PendingSaleLines.Printed`
   * was observed True on every line at creation while both printer logs recorded
   * zero bytes — so the flag is written by the sale path, not the printer path.
   */
  readonly kitchenFiredAfterSend?: boolean;

  /** The native table as it stood BEFORE the socket was opened. */
  readonly preSendTable?: NativeTableSnapshot;

  /** The native table as it stands now. */
  readonly currentTable?: NativeTableSnapshot;

  /** The native codes and quantities this round was to add. */
  readonly expectedItems?: readonly ExpectedNativeItem[];
}

/**
 * The five outcomes. Only the first may advance a round to `confirmed`; every
 * other one leaves it exactly where it was.
 */
export type StrongEvidenceOutcome =
  /** Causal AND durable. The round is on the customer's bill. */
  | 'confirmedCausalDurable'
  /** Nothing is wrong; the evidence simply is not complete yet. Look again later. */
  | 'pending'
  /** Positive evidence the round did NOT land. Its lines may be released. */
  | 'notProven'
  /** A source could not be read. Says nothing about the round either way. */
  | 'unavailable'
  /** Sources disagree, or the table moved in a way this round cannot explain. A human decides. */
  | 'conflicting';

export interface StrongEvidenceVerdict {
  readonly outcome: StrongEvidenceOutcome;
  /** Operator-facing, complete enough to act on without opening a SQL client. */
  readonly basis: string;
  /** Which halves were satisfied. Recorded so a support view can show the working. */
  readonly causal: boolean;
  readonly durable: boolean;
}

/**
 * The attempt a verdict is about.
 *
 * `token` lives here rather than in the evidence for a reason: it is OUR value,
 * derived from durable ids, and the evidence is what the TILL says. Putting
 * both in one bag would let a reader supply the value it is supposed to be
 * checked against, which is the one substitution that turns this predicate into
 * a rubber stamp.
 */
export interface EvidenceSubject {
  readonly roundId: string;
  readonly attemptId: string;
  /** The native table code this round was built against, e.g. "5". */
  readonly table: string;
  /** The opaque equality token sent as `<Checksum>`. `undefined` only in malformed callers. */
  readonly token?: string;
}

/** Sums a line multiset by trimmed, case-insensitive native code. */
function byCode(lines: readonly NativeLineObservation[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const line of lines) {
    const code = line.nativeCode.trim().toUpperCase();
    map.set(code, (map.get(code) ?? 0) + line.quantity);
  }
  return map;
}

function expectedByCode(items: readonly ExpectedNativeItem[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const item of items) {
    const code = item.nativeCode.trim().toUpperCase();
    map.set(code, (map.get(code) ?? 0) + item.quantity);
  }
  return map;
}

/**
 * Exact table matching. A substring test would let table 5 confirm against
 * table 15, 25 or 50 — the same defect the connector's evaluator carries a
 * named test for.
 */
function sameTable(a: string | undefined, b: string | undefined): boolean {
  if (a === undefined || b === undefined) return false;
  return a.trim() === b.trim();
}

function verdict(
  outcome: StrongEvidenceOutcome,
  basis: string,
  causal: boolean,
  durable: boolean,
): StrongEvidenceVerdict {
  return { outcome, basis, causal, durable };
}

/**
 * The whole decision.
 *
 * ORDER MATTERS AND IS DELIBERATE. The causal half is evaluated first, because
 * without it no amount of content agreement can reach `confirmed` and there is
 * no reason to reason about lines at all. The negative cases are then taken
 * before the positive one, so that "we know it did not land" is never reached
 * by exhausting the ways to confirm it.
 */
export function evaluateStrongNativeEvidence(
  attempt: EvidenceSubject,
  evidence: StrongNativeEvidence,
): StrongEvidenceVerdict {
  const where = `round ${attempt.roundId} attempt ${attempt.attemptId} on table ${attempt.table}`;
  const stored = evidence.storedTokenForDevice;
  const token = attempt.token;

  // ── CAUSAL HALF ────────────────────────────────────────────────────────
  if (token === undefined) {
    return verdict(
      'unavailable',
      `${where}: no attempt token was supplied to compare against the till's stored value, ` +
        'so the causal half cannot be evaluated at all.',
      false,
      false,
    );
  }

  if (stored === undefined) {
    // Never looked. This is ignorance, and ignorance is `pending` — the sweep
    // will come back. It is emphatically not `notProven`.
    return verdict(
      'unavailable',
      `${where}: the till's stored token for this DeviceID was not read, so nothing causal is ` +
        'known. Content agreement alone is correlation and can never confirm a round.',
      false,
      false,
    );
  }

  if (stored === null) {
    // The row is absent. That is real evidence, but only a strong negative when
    // we also know the table was not processed — the row is ONE DEEP per
    // device, so a later attempt from the same device overwrites it.
    if (evidence.processedForTableAfterSend === false) {
      return verdict(
        'notProven',
        `${where}: no token row exists for this DeviceID and no ProcessHandheldOrder ran for ` +
          'this table after the send, so the packet was never picked up. The round did not land.',
        false,
        false,
      );
    }
    return verdict(
      'pending',
      `${where}: no token row exists for this DeviceID, but whether the table was processed is ` +
        'unknown. The row is one-deep per device, so its absence alone does not prove our ' +
        'packet was never seen.',
      false,
      false,
    );
  }

  if (stored !== token) {
    // A different token. Same reasoning: strong only alongside "nothing was
    // processed", because a LATER attempt from this device overwrites the row.
    if (evidence.processedForTableAfterSend === false) {
      return verdict(
        'notProven',
        `${where}: the till holds a different token for this DeviceID and recorded no ` +
          'ProcessHandheldOrder for this table after the send. The round did not land.',
        false,
        false,
      );
    }
    return verdict(
      'pending',
      `${where}: the till holds a different token for this DeviceID. The row is one-deep, so a ` +
        'later attempt may simply have overwritten ours; without processing evidence this ' +
        'neither confirms nor excludes the round.',
      false,
      false,
    );
  }

  // From here the causal half HOLDS: only our packet could have written this.
  const causal = true;

  // ── DURABLE HALF ───────────────────────────────────────────────────────
  const before = evidence.preSendTable;
  const after = evidence.currentTable;
  const expected = evidence.expectedItems;

  if (expected === undefined || expected.length === 0) {
    return verdict(
      'conflicting',
      `${where}: the till picked up our packet, but this round declares no native items, so ` +
        'there is no delta that could ever prove it landed. A round that expected nothing ' +
        'should never have been sent.',
      causal,
      false,
    );
  }

  if (before === undefined) {
    return verdict(
      'pending',
      `${where}: the till holds our token, so our packet WAS picked up — but no pre-send ` +
        'baseline of the native table was captured, so the lines it added cannot be ' +
        'separated from the lines that were already there. The token is written by ' +
        'ProcessHandheldOrder BEFORE the sale lines (SaveChecksum at 0x01827301, ahead of ' +
        'the deletes at 0x01827664/0x01827709), so it proves receipt and not application.',
      causal,
      false,
    );
  }

  if (before.status === 'unavailable' || before.status === 'ambiguous') {
    return verdict(
      'unavailable',
      `${where}: the pre-send baseline is ${before.status} (${before.reason ?? 'no reason given'}), ` +
        'so there is no term to subtract and no delta to evaluate.',
      causal,
      false,
    );
  }

  if (after === undefined) {
    return verdict(
      'pending',
      `${where}: the till holds our token, but the native table has not been read back, so ` +
        'whether the sale lines were ever written is unknown.',
      causal,
      false,
    );
  }

  if (after.status === 'unavailable' || after.status === 'ambiguous') {
    return verdict(
      'unavailable',
      `${where}: the native table read is ${after.status} (${after.reason ?? 'no reason given'}). ` +
        'An unreadable table is not an empty one.',
      causal,
      false,
    );
  }

  if (after.status === 'noOpenSale') {
    // This is the crash-in-the-window state the static trace predicted: token
    // written, pending sale deleted, lines never written. It is a real and
    // dangerous native state, so it goes to a human rather than being called
    // either way.
    return verdict(
      'conflicting',
      `${where}: the till holds our token — so ProcessHandheldOrder began — yet no native sale ` +
        'exists for this table. That is exactly the window between the token write and the ' +
        "line writes, in which the receiver has already DELETED the table's previous pending " +
        'sale. The table may have LOST an earlier order. A human must look at the till.',
      causal,
      false,
    );
  }

  // Both terms observed. Check they describe the same table context before
  // subtracting one from the other.
  if (!sameTable(after.tableCode, attempt.table)) {
    return verdict(
      'conflicting',
      `${where}: the native sale read back is on table '${after.tableCode ?? '(none)'}', not the ` +
        `requested '${attempt.table}'.`,
      causal,
      false,
    );
  }

  if (before.status === 'observed' && !sameTable(before.tableCode, attempt.table)) {
    return verdict(
      'conflicting',
      `${where}: the pre-send baseline is on table '${before.tableCode ?? '(none)'}', not the ` +
        `requested '${attempt.table}', so it is not a baseline for this round.`,
      causal,
      false,
    );
  }

  if (
    before.status === 'observed' &&
    before.pos !== undefined &&
    after.pos !== undefined &&
    before.pos !== after.pos
  ) {
    return verdict(
      'conflicting',
      `${where}: the table's POS context changed from ${before.pos} to ${after.pos} across the ` +
        'round, so the two reads are not of the same native sale.',
      causal,
      false,
    );
  }

  if (
    before.status === 'observed' &&
    before.map !== undefined &&
    after.map !== undefined &&
    before.map.trim() !== after.map.trim()
  ) {
    return verdict(
      'conflicting',
      `${where}: the table's map partition changed from '${before.map}' to '${after.map}' across ` +
        'the round. Map 0 is the web/takeaway partition; reading across that boundary would ' +
        'let a web ticket confirm a dine-in round.',
      causal,
      false,
    );
  }

  const beforeLines = byCode(before.lines ?? []);
  const afterLines = byCode(after.lines ?? []);
  const want = expectedByCode(expected);

  // Every line that was already there must still be there, at least as many.
  // A round may only ADD; a line that shrank means somebody voided something,
  // and a table that is being edited underneath us cannot be attributed.
  for (const [code, priorQty] of beforeLines) {
    const nowQty = afterLines.get(code) ?? 0;
    if (nowQty < priorQty) {
      return verdict(
        'conflicting',
        `${where}: native code '${code}' dropped from ${priorQty} to ${nowQty} between the ` +
          'pre-send baseline and now. A later round must retain earlier lines, so the table ' +
          'has been edited by someone else and this round cannot be attributed.',
        causal,
        false,
      );
    }
  }

  // The delta must be EXACTLY the round's items — no more, no less.
  for (const [code, wantQty] of want) {
    const priorQty = beforeLines.get(code) ?? 0;
    const nowQty = afterLines.get(code) ?? 0;
    const delta = nowQty - priorQty;

    if (delta < wantQty) {
      return verdict(
        'pending',
        `${where}: expected ${wantQty} new of native code '${code}' but ${delta} appeared. The ` +
          'till has our token, so our packet was picked up — the lines may still be being ' +
          'written, or may never have been. Looking again is safe; resending is not.',
        causal,
        false,
      );
    }

    if (delta > wantQty) {
      return verdict(
        'conflicting',
        `${where}: expected ${wantQty} new of native code '${code}' but ${delta} appeared. ` +
          'Something added this item beyond our round — a duplicate, or concurrent activity ' +
          'on the table. A human must look before this round is called anything.',
        causal,
        false,
      );
    }
  }

  // Anything that GREW and was not ours is someone else acting on the same
  // table between the two reads. An unresolved round beats a false confirmation.
  for (const [code, nowQty] of afterLines) {
    if (want.has(code)) continue;
    const priorQty = beforeLines.get(code) ?? 0;
    if (nowQty - priorQty <= 0) continue;
    return verdict(
      'conflicting',
      `${where}: native code '${code}' gained ${nowQty - priorQty} between the pre-send baseline ` +
        'and now but was not part of this round. Somebody else changed the table while this ' +
        'round was in flight, so its contribution cannot be isolated.',
      causal,
      false,
    );
  }

  return verdict(
    'confirmedCausalDurable',
    `${where}: CAUSAL — the till holds this attempt's token against this DeviceID in ` +
      "AAAExampleData (ColumnType='IH-<DeviceID>'), which only our packet could have written. " +
      "DURABLE — the native table changed by exactly this round's items " +
      `(${describeDelta(want)}) against a pre-send baseline of ${beforeLines.size} line group(s), ` +
      'with every prior line retained and nothing unexplained added. The round is on the bill.',
    causal,
    true,
  );
}

function describeDelta(want: Map<string, number>): string {
  return [...want.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([code, qty]) => `${qty}x ${code}`)
    .join(', ');
}

/** Only this outcome may advance a round to `confirmed`. Used by the reconciler and asserted by test. */
export function mayConfirm(v: StrongEvidenceVerdict): boolean {
  return v.outcome === 'confirmedCausalDurable' && v.causal && v.durable;
}

/** Only this outcome may release a round's lines for a genuinely new send. */
export function mayReleaseLines(v: StrongEvidenceVerdict): boolean {
  return v.outcome === 'notProven';
}
