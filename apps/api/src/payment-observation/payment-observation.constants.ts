import { PaymentObservationState } from '@prisma/client';

/**
 * Story 15-6: native IdealPOS payment-state OBSERVATION and reconciliation.
 * Never Order Tablet payment initiation -- DL-087 remains controlling: the
 * Order Tablet never processes or selects tender for payment; payment
 * happens later, entirely inside native IdealPOS/EFTPOS; this module may
 * only observe and reconcile the resulting native state, never mutate it.
 *
 * `PaymentObservationSchemaVersion` versions the wire shape a future
 * connector-reported observation (or this story's own fixture-injection
 * endpoint) submits -- mirrors IDEALPOS_SUBMIT_ORDER_SCHEMA_VERSION's own
 * convention (idealpos-order.constants.ts) of a single, explicit integer
 * gate a strict parser fails closed against.
 */
export const PAYMENT_OBSERVATION_SCHEMA_VERSION = 1;

/**
 * The one, and only, currently-real writer of a PaymentObservationEvent in
 * this repository is the fixture-injection endpoint (dev/test only, fail-
 * closed in production -- see payment-observation-fixture-injection.controller.ts).
 * No connector, adapter, or live Bridge integration reports a real payment
 * observation yet -- see this module's own schema.prisma doc comment for
 * exactly why (no `/pay` endpoint, no proven tender/payment-observation
 * contract in the real Bridge as of this session's own source read).
 */
export const PAYMENT_OBSERVATION_REQUIRED_CAPABILITY = 'idealpos.payment_status.v1';

/**
 * Explicit, closed state-transition table -- the sole authority for whether
 * an incoming observation may change PaymentObservation.state. `newState
 * === currentState` (a repeat/self-confirmation) is ALWAYS allowed in
 * addition to this table (checked separately by the service, not listed
 * here to avoid ten redundant self-referencing entries). Any transition not
 * listed here is REJECTED -- the incoming event is still durably recorded
 * (PaymentObservationEvent never rejects an insert on this basis), but the
 * projection moves to `conflict` instead of applying it, and the event's
 * own `applied` flag stays false with a sanitized `conflictReason`.
 *
 * This is a deliberately conservative, closed allow-list, not a general
 * state machine — every entry was chosen because a real IdealPOS/EFTPOS
 * lifecycle can plausibly reach it (e.g. paid -> refunded, or an
 * originally-unsupported adapter later gaining a supported observation
 * source -> pending/paid directly). `declined`/`cancelled`/`reversed`/
 * `refunded`/`conflict` are dead ends: nothing may automatically leave
 * them. A later, contradictory report against ANY of those states is
 * therefore always a conflict, never a silent overwrite — this is what
 * makes "out-of-order updates cannot regress a terminal state" true by
 * construction rather than by trusting a client-supplied timestamp.
 */
export const PAYMENT_OBSERVATION_ALLOWED_TRANSITIONS: Record<
  PaymentObservationState,
  PaymentObservationState[]
> = {
  not_observed: [
    'observation_unsupported',
    'pending',
    'paid',
    'declined',
    'cancelled',
    'uncertain',
  ],
  observation_unsupported: ['pending', 'paid', 'declined', 'cancelled', 'uncertain'],
  pending: ['paid', 'declined', 'cancelled', 'uncertain'],
  uncertain: ['paid', 'declined', 'cancelled'],
  paid: ['reversed', 'refunded'],
  declined: [],
  cancelled: [],
  reversed: [],
  refunded: [],
  conflict: [],
};

/** States that represent a real, no-longer-pending outcome -- used only for read-side UX classification (e.g. "requires manual review"), never to gate a write. */
export const PAYMENT_OBSERVATION_TERMINAL_STATES: ReadonlySet<PaymentObservationState> = new Set([
  'declined',
  'cancelled',
  'reversed',
  'refunded',
  'conflict',
]);

/**
 * Closed set for PaymentObservation.discrepancyState -- a plain `String`
 * column (not a Prisma enum), matching POSSyncRecord.authoritativeSource's
 * own established "closed set, application-enforced" convention exactly
 * (see that column's own doc comment in schema.prisma) rather than
 * introducing a second, redundant pattern for the same kind of value.
 */
export const PAYMENT_DISCREPANCY_STATE = {
  /** No authoritative native amount exists yet to compare against. */
  PENDING_AUTHORITATIVE_TOTAL: 'pending_authoritative_total',
  /** authoritativePayableCents === provisionalPayableCents exactly (integer cents, zero tolerance). */
  EXACT_MATCH: 'exact_match',
  /** Amounts differ -- requires human review, never auto-corrected. */
  MISMATCH: 'mismatch',
  /** State reached paid/reversed/refunded but no native amount was ever supplied. */
  MISSING_NATIVE_AMOUNT: 'missing_native_amount',
  /** A native amount was supplied but its currency does not match the venue's own configured currency. */
  CURRENCY_MISMATCH: 'currency_mismatch',
} as const;

export type PaymentDiscrepancyState =
  (typeof PAYMENT_DISCREPANCY_STATE)[keyof typeof PAYMENT_DISCREPANCY_STATE];

/**
 * Closed set of tender-method strings this module will accept and store
 * verbatim (never inferred, never defaulted) -- deliberately does NOT
 * include anything Verdura itself could ever set (this module never
 * selects a tender; it only records what an authoritative source already
 * reported). Kept intentionally small and reviewed, matching this
 * repository's closed-enum-adjacent convention for free-text fields.
 */
export const PAYMENT_OBSERVATION_TENDER_METHODS = ['card', 'cash', 'eftpos', 'other'] as const;
