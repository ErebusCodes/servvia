/**
 * Mapping WaiterPad protocol outcomes onto the existing round state machine.
 *
 * THERE IS ONLY ONE STATE MACHINE. `orders/rounds/order-round.model.ts` already
 * owns round lifecycle, and it was written with exactly this problem in mind:
 * every ambiguous edge leads to `unresolved`, `unresolved` has no automatic
 * exit, and `confirmed` is reachable only with a causal native identity. This
 * module does NOT reimplement any of that. It decides, for a given protocol
 * outcome, which of that model's transitions is LICENSED — and the caller
 * applies it using the model's own functions.
 *
 * Keeping the decision separate from the application is deliberate. A protocol
 * response is evidence; a state change is a commitment. Putting them in one
 * function invites a future edit that quietly promotes weak evidence.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHAT AN ACK IS WORTH, PRECISELY. Weaker than "buffered", which is already
 * weaker than "executed".
 *
 * `CheckWPOrder` sets its result to 1, then scans a 200-slot in-memory array
 * for a free slot and stores the packet there. But the loop-exhausted path at
 * 0x01826751 calls `__vbaExitProc` immediately WITHOUT touching the result,
 * which is still 1. So when every slot is occupied the caller sends an ACK for
 * a packet that was never buffered and will never be processed.
 *
 * An ACK therefore means: "accepted into volatile memory, OR silently dropped
 * because the buffer was full". Those are indistinguishable on the wire. Even
 * a perfect ACK still precedes all database work, which happens later in a
 * separate drain loop.
 *
 * This is why nothing in this file can confirm a round, and why every path to
 * `confirmed` runs through a readback.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * PURE. Decisions only. No I/O, no persistence, no transport.
 */

import type { OrderRound, RoundState } from '../../orders/rounds/order-round.model';
import type { WaiterPadResponse, WaiterPadResponseParse } from './waiterpad-response';

export class WaiterPadRoundStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WaiterPadRoundStateError';
  }
}

/**
 * Raised by anything whose correct behaviour depends on evidence we do not
 * have. Never caught and defaulted — that would reintroduce the guess.
 */
export class WaiterPadUnresolvedPolicyError extends Error {
  constructor(
    message: string,
    readonly blockerId: string,
  ) {
    super(message);
    this.name = 'WaiterPadUnresolvedPolicyError';
  }
}

/**
 * What the outcome proves about state on the till.
 *
 * There is no `executed` member, and there never will be one derived from a
 * response: no WaiterPad response body carries any native identifier, price,
 * line or sale reference. Only a readback can raise evidence above this.
 */
export type NativeEffect =
  /** Positive evidence the packet was NOT taken. Only LOCK earns this. */
  | 'not_accepted'
  /** Accepted into volatile memory, or silently dropped on buffer exhaustion. */
  | 'accepted_or_dropped_unexecuted'
  /** We do not know. The default, and where everything unclear lands. */
  | 'unknown';

/** The transition this outcome licenses, named for the model function that applies it. */
export type LicensedTransition =
  | {
      readonly apply: 'markDelivered';
      readonly to: Extract<RoundState, 'awaiting_native_confirmation'>;
    }
  | { readonly apply: 'rejectRound'; readonly to: Extract<RoundState, 'rejected'> }
  | { readonly apply: 'markUnresolved'; readonly to: Extract<RoundState, 'unresolved'> };

export interface WaiterPadOutcomeDecision {
  readonly transition: LicensedTransition;
  readonly nativeEffect: NativeEffect;
  /**
   * True when the round's real fate can only be settled by reading the table
   * back. A caller may not treat the round as finished while this is true.
   */
  readonly requiresReadback: boolean;
  /**
   * True only when there is positive evidence nothing was accepted, so the
   * same payload could be presented again by a human decision.
   *
   * This is NOT permission to retry automatically. Nothing in this codebase
   * retries; see the module comment on `waiterpad-gate.ts`.
   */
  readonly safeToRepresentToOperator: boolean;
  /** Operator-facing explanation. Written to be read at 9pm on a Friday. */
  readonly reason: string;
}

/**
 * The persist-before-send boundary.
 *
 * The existing model already mints `idempotencyKey` when a round is OPENED,
 * durably, before any submission is attempted, and sets `payloadFrozenAt` on
 * the `drafting -> submitting` edge. This asserts a caller actually crossed
 * that boundary before touching a socket, so a crash mid-send always leaves a
 * durable record identifying what was in flight.
 *
 * Call this immediately before handing a packet to a transport — which, today,
 * does not exist.
 */
export function assertPersistedBeforeSend(round: OrderRound): void {
  if (round.state !== 'submitting') {
    throw new WaiterPadRoundStateError(
      `a round must be in 'submitting' before its packet may leave the process; ` +
        `this round is '${round.state}'`,
    );
  }
  if (round.payloadFrozenAt === null) {
    throw new WaiterPadRoundStateError(
      'payloadFrozenAt is null: the line set was never frozen, so a retry could ' +
        'present different content under the same identity',
    );
  }
  if (!round.idempotencyKey) {
    throw new WaiterPadRoundStateError(
      'round has no idempotency key; it was not durably opened before submission',
    );
  }
  if (round.lines.length === 0) {
    throw new WaiterPadRoundStateError('refusing to send a round with no lines');
  }
}

/** A parsed, well-formed response mapped to its decision. */
export function decideFromResponse(response: WaiterPadResponse): WaiterPadOutcomeDecision {
  switch (response.type) {
    case 'ACK':
      return {
        transition: { apply: 'markDelivered', to: 'awaiting_native_confirmation' },
        nativeEffect: 'accepted_or_dropped_unexecuted',
        requiresReadback: true,
        safeToRepresentToOperator: false,
        reason:
          'ACK: the till accepted the packet into memory, or silently dropped it ' +
          'because its 200-slot buffer was full — the two are indistinguishable. ' +
          'No sale, line or docket exists yet either way. Read the table back ' +
          'before telling anyone this round is with the kitchen.',
      };

    case 'LOCK':
      // The "LOCKED BY" check runs, and returns, BEFORE the buffering loop, so
      // this is the one outcome with positive evidence of non-acceptance.
      return {
        transition: { apply: 'rejectRound', to: 'rejected' },
        nativeEffect: 'not_accepted',
        requiresReadback: false,
        safeToRepresentToOperator: true,
        reason:
          `LOCK: table is held by POS ${response.posNumber} (code ${response.lockCode}). ` +
          'The lock is checked before the packet is buffered, so nothing was ' +
          'accepted. The round can be presented again once the table is free — ' +
          'by an operator decision, not automatically.',
      };

    case 'NAK':
      return {
        transition: { apply: 'rejectRound', to: 'rejected' },
        nativeEffect: 'unknown',
        requiresReadback: true,
        safeToRepresentToOperator: false,
        reason:
          'NAK: the till refused the order. One NAK condition is now traced and ' +
          'it is a BUSY signal, not a rejection — WPParsePacket answers NAK when ' +
          'HandheldProcessing is already set (0x0281852d), i.e. the till is ' +
          'mid-drain. Other NAK sources remain untraced, so non-acceptance is ' +
          'still not proven: read the table back before resubmitting anything, ' +
          'and never treat a NAK as licence to retry automatically.',
      };

    case 'DUPLICATE':
      // Explicitly NOT success. The guard is one-deep and compares a
      // sender-supplied string against a single stored value; it says a packet
      // with this checksum was accepted at some point, not that the resulting
      // sale exists now or contained what we think.
      return {
        transition: { apply: 'markUnresolved', to: 'unresolved' },
        nativeEffect: 'unknown',
        requiresReadback: true,
        safeToRepresentToOperator: false,
        reason:
          'DUPLICATE: the till has seen this checksum from this device before. ' +
          'That is not confirmation — the guard is one deep and says nothing ' +
          'about whether the resulting sale exists or what it contains. Only a ' +
          'readback showing the expected native state may resolve this round.',
      };

    case 'NAKREGO':
      return {
        transition: { apply: 'markUnresolved', to: 'unresolved' },
        nativeEffect: 'unknown',
        requiresReadback: true,
        safeToRepresentToOperator: false,
        reason:
          'NAKREGO: the device is not registered with the till. The full set of ' +
          'conditions emitting NAKREGO was not traced — it is reachable from at ' +
          'least four sites, two of them outside the order path — so it cannot ' +
          'be treated as a clean rejection.',
      };

    case 'NAKPRINT':
      return {
        transition: { apply: 'markUnresolved', to: 'unresolved' },
        nativeEffect: 'unknown',
        requiresReadback: true,
        safeToRepresentToOperator: false,
        reason:
          'NAKPRINT on an order submission: this response belongs to PRINTBILL ' +
          'and should be unreachable here. Treating an unexpected response as ' +
          'anything but unresolved would be a guess.',
      };
  }
}

/**
 * Every non-response outcome: an unparseable reply, no reply, a timeout, or a
 * process that restarted while a round was in flight.
 *
 * They all collapse to the same decision, and that is the correct answer
 * rather than a lazy one — in each case the packet may or may not have reached
 * the till, and nothing observed distinguishes them.
 */
export type NonResponseOutcome =
  | { readonly kind: 'unparseable'; readonly parse: Extract<WaiterPadResponseParse, { ok: false }> }
  | { readonly kind: 'timeout'; readonly waitedMs: number }
  | { readonly kind: 'connection_lost' }
  | { readonly kind: 'process_restarted_in_flight' };

export function decideFromNonResponse(outcome: NonResponseOutcome): WaiterPadOutcomeDecision {
  const detail =
    outcome.kind === 'unparseable'
      ? `the reply was not a WaiterPad response (${outcome.parse.reason}: ${outcome.parse.detail})`
      : outcome.kind === 'timeout'
        ? `no reply within ${outcome.waitedMs}ms`
        : outcome.kind === 'connection_lost'
          ? 'the connection dropped before a reply arrived'
          : 'the process restarted while this round was in flight';

  return {
    transition: { apply: 'markUnresolved', to: 'unresolved' },
    nativeEffect: 'unknown',
    requiresReadback: true,
    safeToRepresentToOperator: false,
    reason:
      `Unresolved: ${detail}. The packet may or may not have reached the till. ` +
      'Do not resend. Read the table back, and if the readback cannot ' +
      'distinguish this round from what was already there, escalate to a human.',
  };
}

/**
 * The one question a caller most wants answered automatically, and the one we
 * refuse to answer.
 *
 * DELIBERATELY UNIMPLEMENTED. The reason CHANGED on 2026-09-07 and got worse,
 * not better. The old reason was that we could not tell which of two routines
 * would write a handheld order. That is now settled for the socket ORDER case
 * (`RELAY_PATH_CHAIN_EVIDENCE`): a socket order's only durable act is an
 * `IH-PRINT` row in `POSServerMessages`, the worker timer picks it up, and
 * `ProcessHandheldOrder` — which has exactly one caller image-wide — applies it
 * by DELETEing the table's `PendingSales` and `PendingSaleLines` rows and
 * rewriting them. There is no conditional routing to avoid that path.
 *
 * `WPOrder` is a DIFFERENT procedure with different callers, and its trigger is
 * still `[UNKNOWN]`. The two are not merged here.
 *
 * THREE THINGS NOW BLOCK THIS, and each is enough on its own:
 *
 *   1. NO CAUSAL TOKEN. The rewrite assigns no `DeviceID` and no `Checksum`
 *      (`RECOVERY_CAUSAL_TOKEN_EVIDENCE`). Nothing durable distinguishes
 *      "Verdura caused this exact PLU/quantity delta" from "a human added the
 *      same items while we were recovering". Content equality is not proof.
 *   2. SCOPE OF THE DELETE IS UNCONFIRMED. Delete-and-rewrite is non-lossy only
 *      if the packet carries COMPLETE table state. Whether it does is not
 *      answerable from field names and needs one captured genuine packet.
 *   3. NO `OrderedTime` IN THE READBACK, so two rounds that ordered the same
 *      item remain indistinguishable in the response.
 *
 * A plausible-looking implementation here would be a guess about whether a
 * kitchen receives one round or an entire table again. It throws instead.
 */
export function reconcileRoundAgainstReadback(): never {
  throw new WaiterPadUnresolvedPolicyError(
    'Automatic reconciliation of a round against a table readback is not ' +
      'implemented. The routing question is now ANSWERED - a socket ORDER is ' +
      'relayed as an IH-PRINT row and applied by ProcessHandheldOrder, which ' +
      'deletes the table sale and lines and rewrites them - and that makes this ' +
      'harder, not easier. Three things must be settled first: (1) no durable ' +
      'causal token (no DeviceID, no Checksum) reaches native sale state, so an ' +
      'exact content match cannot prove Verdura caused it; (2) whether the ' +
      'packet carries COMPLETE table state, without which the rewrite is lossy; ' +
      'and (3) how to attribute readback lines to a round when the response ' +
      'carries no OrderedTime. Until then an ambiguous round is a human ' +
      'decision.',
    'WAITERPAD-RECON-001',
  );
}

/**
 * The complete list of things a caller might reasonably expect this module to
 * do, that it deliberately does not.
 *
 * Exported so tests can assert the list has not silently shrunk, and so an
 * operator report can render it.
 */
export const UNRESOLVED_PRODUCTION_BLOCKERS = [
  {
    id: 'WAITERPAD-RECON-001',
    title: 'Automatic round-vs-readback reconciliation',
    why: 'Append-vs-relay semantics NOT SHOWN; readback has no OrderedTime.',
  },
  {
    id: 'WAITERPAD-CHECKSUM-001',
    title: 'Checksum generation algorithm',
    why: 'The receiver only compares; no generator exists on either venue machine.',
  },
  {
    id: 'WAITERPAD-ACKLOSS-001',
    title: 'ACK returned on buffer exhaustion',
    why:
      'CheckWPOrder leaves its result at 1 when all 200 buffer slots are full ' +
      '(0x01826751), so an ACK can be sent for a packet that was silently dropped.',
  },
  {
    id: 'WAITERPAD-BIND-001',
    title: 'Front / Machine 2 is not observed listening on 6983',
    why: 'The port is PROVEN STATIC; the binding on Front has never been read.',
  },
  {
    id: 'WAITERPAD-SUPPORT-001',
    title: 'Vendor support status unasserted',
    why: 'No local artifact describes this protocol as a third-party surface.',
  },
  {
    id: 'WAITERPAD-REGO-001',
    title: 'NAKREGO causes beyond slot exhaustion unknown',
    why:
      'Narrowed twice, not closed. Registration is auto-granted while ' +
      'registeredCount < licensedHandheldCount (PROVEN STATIC), and NAKREGO ' +
      'carries NO body at all - its builder takes no parameters - so the wire ' +
      'never says why a device was refused. Whether slot exhaustion is the ' +
      'only cause is answerable by the vendor and by nothing we can observe.',
  },
  {
    id: 'WAITERPAD-DUPGATE-001',
    title: 'The receiver duplicate guard can be switched off',
    why:
      'CheckWPOrder skips IsDuplicateHandheldOrder2 entirely when the global ' +
      'word at 0x2a2f1e4 is clear (cmp/je at 0x01826289). What sets it is NOT ' +
      'SHOWN, so Verdura cannot assume the till will catch a duplicate round ' +
      'and must carry exactly-once entirely on its own side.',
  },
] as const;
