/**
 * WHAT THE ROUND BANNER IS ALLOWED TO CHANGE INTO.
 *
 * The banner starts as the answer to a Send press. Then `GET /orders/:id/rounds`
 * begins reporting where that round actually stands, and this module is the only
 * place that decides whether the new report may replace the sentence on screen.
 *
 * It is a separate module from the page for one reason: the rule below is a
 * safety rule, and a safety rule buried inside a 2,000-line component is one
 * nobody can test in isolation or read without the rest of the screen.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THE RULE. A ROUND IS NEVER TALKED DOWN.
 *
 * Every asymmetry on this integration points the same way: a round that did not
 * arrive costs a waiter a walk to the till, and a round that arrives twice is a
 * wrong bill nobody notices until the customer reads it. So the banner may
 * always become MORE alarming and may become less alarming only on positive
 * evidence that the round is settled.
 *
 * Concretely, once `requiresReconciliation` is true it is cleared only by a
 * readback row that is `settled` - confirmed, rejected, or provably never sent.
 * `unresolved` is deliberately not settled, so a round that nobody can explain
 * keeps its red banner for as long as nobody can explain it.
 *
 * AND SILENCE CHANGES NOTHING. A failed poll, a poll that returns rows about
 * other rounds, a poll during a network drop - none of them reach this function
 * with a matching row, and the banner is left exactly as it was. Not looking is
 * not the same as finding nothing; a screen that quietly relaxed whenever it
 * lost the server would relax hardest at exactly the moment the till was
 * unreachable.
 */

/** One round of an order, as `GET /api/admin/orders/:id/rounds` reports it. */
export interface RoundStatusRow {
  roundId: string;
  sequence: number;
  /** The durable server enum, carried through unmapped. */
  state: string;
  status:
    | 'confirmed'
    | 'resolvedManually'
    | 'awaitingConfirmation'
    | 'unresolved'
    | 'rejected'
    | 'notSent'
    | 'assembling';
  message: string;
  requiresReconciliation: boolean;
  /** True when the round can no longer change on its own. The ONLY thing that may calm the banner. */
  settled: boolean;
  sendInitiatedAt: string | null;
  lineCount: number;
  /**
   * What a manager is shown BEFORE they may vouch for this round. Present only
   * on a round that needs a human - the server attaches it to nothing else.
   */
  attestation?: RoundAttestationEvidence | null;
}

/**
 * THE DOCKET A MANAGER STANDS AT THE TILL HOLDING.
 *
 * Every field here exists to be compared against something on an IdealPOS
 * screen: the table code as the till writes it, the covers, and the lines with
 * their quantities, seats and native codes. Being asked to confirm a round you
 * have not been shown is not a check - it is a formality with a signature on
 * it, and a formality is what a tired manager produces at 9pm.
 */
export interface RoundAttestationEvidence {
  /** The IDEALPOS table code - what is written on the till, not the Verdura display number. */
  posTableCode: string;
  guests: number;
  lines: {
    description: string;
    quantity: number;
    /** The native code, where the item has one. Tells two similar-reading dishes apart. */
    plu: string | null;
    seat: number | null;
  }[];
  /** Our own id for the order, as the till would know it. */
  externalOrderId: string;
  /** When it went, ISO. Part of the docket, so the panel can never render half-assembled. */
  sentAt: string | null;
  /** A SHORT PREFIX ONLY - enough to read to somebody on the phone, never enough to replay. */
  tokenPrefix: string | null;
}

/** What the banner renders. Produced by a Send press, then kept true by the readback. */
export interface NativeRoundView {
  roundId: string;
  sequence: number;
  status:
    | 'confirmed'
    | 'resolvedManually'
    | 'sentAwaitingConfirmation'
    | 'uncertain'
    | 'registrationRejected'
    | 'rejected'
    | 'failedBeforeSend';
  message: string;
  safeToRetry: boolean;
  requiresReconciliation: boolean;
  replayed: boolean;
  /** Set when the server REFUSED before opening a round at all (round_in_flight, etc.). */
  refusal?: string;
  /**
   * The docket, once the server has sent one. Null on a banner produced by a
   * Send press, because a press knows what it sent but not what the server
   * recorded; the first readback fills it in.
   */
  evidence?: RoundAttestationEvidence | null;
}

/**
 * The readback's vocabulary in the banner's.
 *
 * `assembling` becomes `sentAwaitingConfirmation` rather than anything softer:
 * a round being sent this instant is not a round it is safe to send again, and
 * the two are indistinguishable to a waiter looking at a screen.
 */
function toBannerStatus(status: RoundStatusRow['status']): NativeRoundView['status'] {
  switch (status) {
    case 'confirmed':
      return 'confirmed';
    // KEPT SEPARATE FROM `confirmed` ALL THE WAY TO THE PIXEL. Folding it in
    // here would be the last place the difference could be lost, and it would
    // lose it silently: the two states mean "the till was seen holding our
    // token" and "a person says they saw the food", and a waiter who is shown
    // the same green for both has been told the machine checked when nobody
    // did. It is settled either way - which is all the SEND button needs to
    // know - but settled is not the same claim as proven.
    case 'resolvedManually':
      return 'resolvedManually';
    case 'unresolved':
      return 'uncertain';
    case 'rejected':
      return 'rejected';
    case 'notSent':
      return 'failedBeforeSend';
    case 'awaitingConfirmation':
    case 'assembling':
      return 'sentAwaitingConfirmation';
  }
}

/**
 * Fold one poll's rows into the banner.
 *
 * Returns the banner unchanged - by identity, so React re-renders nothing -
 * whenever the poll said nothing about the round on screen.
 *
 * @param current the banner as it stands, or null if the screen has none
 * @param rows    what the server just reported about this order's rounds
 */
export function mergeRoundReadback(
  current: NativeRoundView | null,
  rows: RoundStatusRow[],
): NativeRoundView | null {
  if (current) {
    // ONLY THE ROUND ON SCREEN. A report about round 1 must never overwrite a
    // banner about round 2 - that is how a settled earlier round would erase a
    // live warning about the one the waiter just sent.
    const row = rows.find((r) => r.roundId === current.roundId);
    if (!row) return current;

    // THE NEVER-TALKED-DOWN RULE. Red stays red until something settles it.
    const requiresReconciliation = current.requiresReconciliation
      ? row.requiresReconciliation || !row.settled
      : row.requiresReconciliation;

    // Retrying is offered only where the server says the round is finished AND
    // finished in a way that created nothing. Never inferred from silence.
    const safeToRetry = row.settled && (row.status === 'rejected' || row.status === 'notSent');

    // WHEN NOTHING HAS MOVED, THE SEND'S OWN WORDS STAY. A round that was
    // already a human's problem and still is has learned nothing from this
    // poll, and the send-time answer is the more useful of the two sentences:
    // `registrationRejected` says the identity was refused and that it is a
    // licence, which is something a waiter can act on. Overwriting it with the
    // readback's general "nobody knows" would be a poll that costs information
    // every time it runs and adds none.
    const unmoved = current.requiresReconciliation && requiresReconciliation;

    const next: NativeRoundView = {
      ...current,
      sequence: row.sequence,
      status: unmoved
        ? current.status
        : requiresReconciliation
          ? 'uncertain'
          : toBannerStatus(row.status),
      // Otherwise the message is the SERVER's. Re-writing it here would create
      // a second vocabulary for the same states that could drift from the one
      // with the evidence behind it.
      message: unmoved ? current.message : row.message,
      safeToRetry,
      requiresReconciliation,
      // A replayed send stays replayed: that fact is about how the round was
      // submitted and no later observation of the till changes it.
      replayed: current.replayed,
      // THE DOCKET IS FACTS, NOT STATUS, so the never-talked-down rule does not
      // apply to it - it is simply the latest the server has said. Held once
      // it has arrived rather than re-read every poll: a round's lines are
      // frozen at submit time and cannot change afterwards, so a poll that
      // stops carrying them (the round settled, and the server rightly stops
      // attaching a panel to a round nobody may attest to) must not blank the
      // evidence out from under a manager mid-read.
      evidence: current.evidence ?? row.attestation ?? null,
    };

    return same(current, next) ? current : next;
  }

  // NO BANNER ON SCREEN. This is a reload, or a waiter returning to a table
  // from another one. Only an ALARMING round is adopted from nothing: a red
  // "do not send again" that a refresh would otherwise have silently discarded
  // is exactly the thing that must survive, whereas materialising a reassuring
  // "sent, awaiting the till" for a press this device never made would be the
  // screen inventing history.
  const alarming = [...rows].reverse().find((r) => r.requiresReconciliation);
  if (!alarming) return null;

  return {
    roundId: alarming.roundId,
    sequence: alarming.sequence,
    status: 'uncertain',
    message: alarming.message,
    safeToRetry: false,
    requiresReconciliation: true,
    replayed: false,
    evidence: alarming.attestation ?? null,
  };
}

/** Field-wise equality, so an unchanged poll does not re-render the banner. */
function same(a: NativeRoundView, b: NativeRoundView): boolean {
  return (
    a.roundId === b.roundId &&
    a.sequence === b.sequence &&
    a.status === b.status &&
    a.message === b.message &&
    a.safeToRetry === b.safeToRetry &&
    a.requiresReconciliation === b.requiresReconciliation &&
    a.replayed === b.replayed &&
    // Identity, not deep equality, and NORMALISED - a banner that has never
    // been polled has no `evidence` key at all, and `undefined` and `null` both
    // mean "no docket". Comparing them raw would make the first poll of every
    // ordinary round return a fresh object and re-render the banner for no
    // reason, which is the exact cost this function exists to avoid.
    (a.evidence ?? null) === (b.evidence ?? null)
  );
}
