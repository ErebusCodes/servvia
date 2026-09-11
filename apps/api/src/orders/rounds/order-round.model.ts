/**
 * Multi-round table ordering -- the vendor-independent domain core.
 *
 * WHAT THIS IS. Pure functions and types describing one restaurant table
 * session's rounds: how a round is identified, when its payload freezes, which
 * lifecycle transitions are legal, and which lines may be sent. It is the
 * source-level half of the design in
 * `docs/integrations/multi-round-ordering-model-gap.md`.
 *
 * WHAT THIS IS NOT. It has no Prisma import, no HTTP surface, no IdealPOS
 * concept, and no migration behind it. Nothing in the running application
 * calls it yet. That is deliberate: the entities it describes cannot be
 * migrated until a native append mechanism is known, but the RULES are
 * vendor-independent and are exactly the part worth pinning down with
 * executable tests rather than prose.
 *
 * WHY IT IS SAFE TO LAND UNUSED. Adding it changes no behaviour, touches no
 * table, and cannot be reached from any controller. When the migration is
 * eventually taken, these functions become the service layer's decision
 * points, already covered.
 */

/**
 * A round's lifecycle.
 *
 * The two non-obvious states carry the whole safety argument:
 *
 * - `awaiting_native_confirmation` -- the payload definitely left us and the
 *   POS definitely received it, but no causal native identity has come back.
 *   Distinct from `submitting`, which means the outcome of the send itself is
 *   still unknown.
 * - `unresolved` -- the send produced NO definite outcome at all (no response,
 *   a torn connection, a device restart mid-flight). This is the state that
 *   must never be silently retried or silently discarded, and the only state
 *   that requires a human decision to leave.
 *
 * `rejected` and `failed` are kept separate because they license different
 * recoveries: a rejection is the POS refusing a payload a human can fix and
 * resubmit; a failure is exhausted delivery attempts against an unchanged
 * payload.
 *
 * `resolved_manually` is the only exit from `unresolved` that does not need a
 * machine to have seen anything, and it exists because without it `unresolved`
 * is a dead end that holds the table forever. It is kept apart from
 * `confirmed` on purpose: testimony and causal evidence are different claims,
 * and a state machine that cannot tell them apart cannot be audited.
 */
export type RoundState =
  | 'drafting'
  | 'submitting'
  | 'awaiting_native_confirmation'
  | 'confirmed'
  | 'rejected'
  | 'failed'
  | 'unresolved'
  /**
   * A HUMAN looked at the real till and vouched that this round is on the
   * table. Terminal, settled, and emphatically NOT `confirmed` -- see
   * `attestRoundPresent`.
   */
  | 'resolved_manually'
  | 'abandoned';

/** States from which no further transition is possible. */
export const TERMINAL_ROUND_STATES: ReadonlySet<RoundState> = new Set<RoundState>([
  'confirmed',
  'failed',
  // Terminal because a person has taken responsibility for it. Re-resolving
  // would let a second opinion silently overwrite the first, and the record of
  // who settled a disputed bill is the only thing that makes it settled.
  'resolved_manually',
  'abandoned',
]);

/**
 * States in which the round still occupies the session's single "in flight"
 * slot. A new round may not be OPENED while one of these is current.
 *
 * `rejected` is deliberately NOT here: a rejected round's items return to an
 * editable draft (see `reopenRejectedRound`), which is a transition of the
 * SAME round, not a new one.
 */
export const IN_FLIGHT_ROUND_STATES: ReadonlySet<RoundState> = new Set<RoundState>([
  'submitting',
  'awaiting_native_confirmation',
  'unresolved',
]);

/**
 * The legal transition graph.
 *
 * Conservative by construction: every ambiguous edge leads to `unresolved`,
 * and `unresolved` has no automatic exit. Nothing here can move a round to
 * `confirmed` by itself -- that edge exists only from
 * `awaiting_native_confirmation`, and only a caller holding a causal native
 * identity may take it (enforced by `confirmRound`, not by this table alone).
 */
const LEGAL_TRANSITIONS: Readonly<Record<RoundState, ReadonlySet<RoundState>>> = {
  drafting: new Set<RoundState>(['submitting', 'abandoned']),
  // A send whose outcome we never learned goes to `unresolved`, never back to
  // `drafting` -- returning to draft would let staff edit a payload that may
  // already be in the kitchen.
  submitting: new Set<RoundState>([
    'awaiting_native_confirmation',
    'rejected',
    'failed',
    'unresolved',
  ]),
  awaiting_native_confirmation: new Set<RoundState>([
    'confirmed',
    'rejected',
    'failed',
    'unresolved',
  ]),
  // A human resolved the ambiguity by looking at the real POS/kitchen state.
  unresolved: new Set<RoundState>([
    'awaiting_native_confirmation',
    'confirmed',
    'rejected',
    'failed',
    // The human exit. The ONLY state from which it is reachable: a round that
    // nobody has been asked about has nothing for a person to have vouched
    // for, and letting testimony short-circuit a round that is merely still in
    // flight would replace evidence that is coming with evidence that is
    // weaker.
    'resolved_manually',
    'abandoned',
  ]),
  // A rejected round is repairable: its lines return to draft under the SAME
  // round identity (see reopenRejectedRound).
  rejected: new Set<RoundState>(['drafting', 'abandoned']),
  confirmed: new Set<RoundState>([]),
  failed: new Set<RoundState>([]),
  resolved_manually: new Set<RoundState>([]),
  abandoned: new Set<RoundState>([]),
};

export function isLegalRoundTransition(from: RoundState, to: RoundState): boolean {
  return LEGAL_TRANSITIONS[from].has(to);
}

/** A line belonging to exactly one round. */
export interface RoundLine {
  /** Stable within the session, assigned at draft time, never reused. */
  readonly lineId: string;
  readonly menuItemId: string;
  readonly quantity: number;
  /**
   * Verdura's EXPECTED unit price, in cents.
   *
   * Named `expected` on purpose: it is what the tablet displayed, submitted
   * for the POS to verify, and never an instruction to the POS to charge it.
   * The POS remains price authority. Nothing in this module computes a total
   * from it.
   */
  readonly expectedUnitPriceCents: number;
  readonly notes?: string;
}

/**
 * A link to a native sale.
 *
 * `tier` is the whole point. `correlated` means "something consistent with
 * this round was observed" (e.g. a table code matched). `causal` means the POS
 * returned an identity attributable to THIS round. Only `causal` may confirm --
 * the same rule `decideConfirmation` enforces for POSSyncRecord, expressed
 * once here rather than reinvented weaker.
 */
export interface NativeSaleRef {
  readonly tier: 'correlated' | 'causal';
  readonly saleId: string;
  /** Present only when the POS exposes per-line identities. */
  readonly lineIds?: readonly string[];
  readonly observedAt: Date;
}

export interface OrderRound {
  readonly roundId: string;
  /** The session this round belongs to -- `Order.id` in the proposed schema. */
  readonly sessionId: string;
  /** 1-based, contiguous, unique within the session. */
  readonly sequence: number;
  /**
   * IMMUTABLE, minted when the round is OPENED -- never at submit time.
   *
   * This is the fix for the restart hole: the key is durable before any
   * submission is attempted, so a retry after any failure (including a browser
   * restart) presents the same key. Today's equivalent is born in React state
   * at submit time and dies with the tab.
   */
  readonly idempotencyKey: string;
  readonly state: RoundState;
  readonly lines: readonly RoundLine[];
  /**
   * Set exactly once, on the `drafting -> submitting` edge. Non-null means the
   * line set is frozen and may no longer be edited under this identity.
   */
  readonly payloadFrozenAt: Date | null;
  /**
   * The native identity, once known. Null until then -- and a round may NEVER
   * be `confirmed` while this is null or merely `correlated`.
   */
  readonly nativeSaleRef: NativeSaleRef | null;
}

export class RoundInvariantError extends Error {}

/** Opening a round is refused while another still occupies the session. */
export function canOpenNextRound(rounds: readonly OrderRound[]): boolean {
  return !rounds.some((r) => IN_FLIGHT_ROUND_STATES.has(r.state) || r.state === 'drafting');
}

/**
 * The next sequence number for a session.
 *
 * Derived from the highest sequence ever used, NOT from the count, so an
 * abandoned round never causes a sequence to be reused.
 */
export function nextRoundSequence(rounds: readonly OrderRound[]): number {
  return rounds.reduce((max, r) => Math.max(max, r.sequence), 0) + 1;
}

export function openRound(params: {
  rounds: readonly OrderRound[];
  sessionId: string;
  roundId: string;
  idempotencyKey: string;
}): OrderRound {
  if (!canOpenNextRound(params.rounds)) {
    throw new RoundInvariantError(
      'cannot open a new round while another round is drafting or unresolved on this session',
    );
  }
  if (params.rounds.some((r) => r.idempotencyKey === params.idempotencyKey)) {
    throw new RoundInvariantError(
      'idempotencyKey is already used by another round on this session',
    );
  }
  return {
    roundId: params.roundId,
    sessionId: params.sessionId,
    sequence: nextRoundSequence(params.rounds),
    idempotencyKey: params.idempotencyKey,
    state: 'drafting',
    lines: [],
    payloadFrozenAt: null,
    nativeSaleRef: null,
  };
}

/** Lines may be edited only while drafting. */
export function setRoundLines(round: OrderRound, lines: readonly RoundLine[]): OrderRound {
  if (round.state !== 'drafting') {
    throw new RoundInvariantError(`cannot edit lines of a round in state '${round.state}'`);
  }
  if (round.payloadFrozenAt !== null) {
    throw new RoundInvariantError('cannot edit lines of a round whose payload is frozen');
  }
  return { ...round, lines: [...lines] };
}

/**
 * `drafting -> submitting`. Freezes the payload.
 *
 * An empty round is refused: a zero-line submission would consume an
 * idempotency key and a sequence number while asking the kitchen for nothing.
 */
export function beginSubmission(round: OrderRound, now: Date): OrderRound {
  if (!isLegalRoundTransition(round.state, 'submitting')) {
    throw new RoundInvariantError(`cannot submit a round in state '${round.state}'`);
  }
  if (round.lines.length === 0) {
    throw new RoundInvariantError('cannot submit a round with no lines');
  }
  return { ...round, state: 'submitting', payloadFrozenAt: now };
}

/** The POS definitely received the payload; no causal identity yet. */
export function markDelivered(round: OrderRound): OrderRound {
  return transition(round, 'awaiting_native_confirmation');
}

/**
 * The ONLY path to `confirmed`, and it demands a `causal` identity.
 *
 * A `correlated` reference is recorded but never confirms -- mirroring the
 * fail-closed policy in `bridge-order-status.ts`. This is why the function
 * takes the reference rather than reading it off the round.
 */
export function confirmRound(round: OrderRound, ref: NativeSaleRef): OrderRound {
  if (!isLegalRoundTransition(round.state, 'confirmed')) {
    throw new RoundInvariantError(`cannot confirm a round in state '${round.state}'`);
  }
  if (ref.tier !== 'causal') {
    throw new RoundInvariantError(
      'refusing to confirm on a correlated native reference -- only a causal identity may confirm',
    );
  }
  return { ...round, state: 'confirmed', nativeSaleRef: ref };
}

/** Records a correlated observation without advancing the lifecycle. */
export function recordCorroboration(round: OrderRound, ref: NativeSaleRef): OrderRound {
  if (ref.tier !== 'correlated') {
    throw new RoundInvariantError('recordCorroboration accepts only a correlated reference');
  }
  if (TERMINAL_ROUND_STATES.has(round.state)) return round;
  return { ...round, nativeSaleRef: ref };
}

export function rejectRound(round: OrderRound): OrderRound {
  return transition(round, 'rejected');
}

export function failRound(round: OrderRound): OrderRound {
  return transition(round, 'failed');
}

/**
 * The ambiguous-outcome edge: we do not know whether the kitchen has this
 * round. Conservative by design -- no automatic exit exists.
 */
export function markUnresolved(round: OrderRound): OrderRound {
  return transition(round, 'unresolved');
}

/**
 * What a person reported after physically looking at the till.
 *
 * NOTE WHAT IS ABSENT: there is no outcome meaning "it is not there, so send it
 * again". An earlier version had one. See `attestRoundPresent` for why it was
 * removed rather than kept behind a warning.
 */
export type ManualResolutionOutcome =
  /** They can see this round on the table. It is settled; its lines stay claimed. */
  | 'present'
  /**
   * They looked and could not see it. RECORDED, AND NOTHING ELSE CHANGES.
   *
   * Deliberately not a resolution. It settles no state, releases no line, and
   * leaves the round exactly as unresolved as it was - because a person failing
   * to see a round is not evidence that the round is absent.
   */
  | 'notFound';

/**
 * THE HUMAN EXIT FROM `unresolved`, and the only one that exists.
 *
 * WHY IT HAD TO BE BUILT. `unresolved` occupies the session's in-flight slot,
 * so no further round may open while one stands. Its machine exits both need
 * evidence read from the till, and no build binds a reader yet -- so in the
 * configuration this integration actually ships in, a round escalates to
 * `unresolved` and the table is finished for the night. `unresolved` was
 * documented from the first commit as "the only state that requires a human to
 * leave", and until now there was no way for a human to leave it.
 *
 * IT IS NOT `confirmRound`, AND MUST NEVER BECOME IT. `confirmed` asserts that
 * the till was seen holding OUR token against OUR DeviceID -- a fact only our
 * own packet could have produced. A manager reading a bill sees FOOD, and food
 * on a table cannot distinguish "our round put it there" from "somebody keyed
 * the same items while we were deciding". That is the correlated-vs-causal
 * distinction this module exists to protect, wearing a person instead of a
 * PLU match. Testimony is good enough to settle a table and not good enough to
 * be called proof, so it gets its own terminal state and keeps its own name.
 *
 * IT KEEPS THE LINES CLAIMED, which is the entire safety of it. Lines that stay
 * claimed cannot be swept into a later round, so the worst case of a mistaken
 * attestation is a customer who ordered food and did not get it -- which a
 * waiter notices within minutes, and which is fixed by ordering it again.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THERE IS NO OPPOSITE OF THIS FUNCTION, AND THAT IS DELIBERATE.
 *
 * An earlier version of this module offered a second outcome - the manager
 * reports the round is NOT on the table, its lines are released, and the next
 * Send carries them. It is removed, and it must not come back, because the two
 * directions are not symmetrical and treating them as a pair is what makes the
 * second one look reasonable.
 *
 * "I can see it" is an OBSERVATION. "I cannot see it" is a FAILURE TO OBSERVE,
 * and the difference is the whole argument:
 *
 *   * the receiver ACKs before durable processing, so a packet can be accepted
 *     and not yet visible anywhere;
 *   * a round can sit in a 200-slot buffer waiting for a drain loop;
 *   * the manager may be looking at the wrong table, the wrong POS terminal, or
 *     the right table before the kitchen printer has caught up.
 *
 * Every one of those produces "I cannot see it" while the food is on its way to
 * the customer. Releasing the lines then puts a second copy of the round on a
 * bill nobody re-reads - the exact failure this entire module exists to
 * prevent, arrived at through a dialog instead of a retry loop.
 *
 * The cost of refusing is real and is accepted: a table stays blocked, and the
 * customer's food has to be re-entered as a new order by a human who knows what
 * they are doing. That is visible, recoverable, and survivable for one service.
 * A double-charged bill is none of those things.
 *
 * If a defensible negative rule is ever wanted, it needs POSITIVE evidence that
 * nothing was created - the till's own token row absent for our DeviceID, or a
 * full table readback cross-checked against our line set. Both need the
 * evidence reader. Neither needs a person to guess.
 * ─────────────────────────────────────────────────────────────────────────
 */
export function attestRoundPresent(round: OrderRound): OrderRound {
  if (round.state !== 'unresolved') {
    throw new RoundInvariantError(
      `only an unresolved round may be settled by hand; this one is '${round.state}'`,
    );
  }
  return transition(round, 'resolved_manually');
}

/**
 * A rejected round returns to an editable draft WITHOUT changing its identity.
 *
 * `roundId`, `sequence` and `idempotencyKey` all survive; only
 * `payloadFrozenAt` is cleared so the lines become editable again. This is
 * what lets staff fix a bad PLU and resubmit without the POS seeing a second,
 * differently-keyed round.
 */
export function reopenRejectedRound(round: OrderRound): OrderRound {
  if (!isLegalRoundTransition(round.state, 'drafting')) {
    throw new RoundInvariantError(`cannot reopen a round in state '${round.state}'`);
  }
  return { ...round, state: 'drafting', payloadFrozenAt: null };
}

/**
 * The lines a submission for this round must carry: its own, and only its own.
 *
 * This is the structural guarantee that a confirmed round is never re-sent --
 * the payload is built from one round's line set, never from the session's.
 */
export function linesToSend(round: OrderRound): readonly RoundLine[] {
  if (round.state !== 'submitting') {
    throw new RoundInvariantError(
      `refusing to build a payload for a round in state '${round.state}' -- only a frozen, submitting round may be sent`,
    );
  }
  return round.lines;
}

/** Every line already handed to the kitchen across the session. */
export function sentLines(rounds: readonly OrderRound[]): readonly RoundLine[] {
  return rounds
    .filter((r) => r.state !== 'drafting' && r.state !== 'abandoned')
    .flatMap((r) => r.lines);
}

function transition(round: OrderRound, to: RoundState): OrderRound {
  if (!isLegalRoundTransition(round.state, to)) {
    throw new RoundInvariantError(`illegal round transition '${round.state}' -> '${to}'`);
  }
  return { ...round, state: to };
}
