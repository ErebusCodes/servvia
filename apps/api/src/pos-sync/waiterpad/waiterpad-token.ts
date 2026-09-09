/**
 * The duplicate-guard token that rides in `<Checksum>`.
 *
 * WHY THIS REPLACES A "CHECKSUM ALGORITHM". `waiterpad-checksum.ts` refuses to
 * produce a value because the vendor algorithm is unknown. On 2026-09-09 static
 * analysis showed the algorithm does not matter, because the receiver never
 * computes one:
 *
 *   IsDuplicateHandheldOrder2(checksum, deviceId)  @ 0x01835070
 *     1. SELECT * FROM AAAExampleData WHERE ColumnType='IH-<DeviceID>'   (0x70e770 + 0x70e764)
 *     2. if the recordset is empty          -> NOT a duplicate, and
 *        INSERT INTO AAAExampleData (InsertDate, ColumnType, Data)       (0x70e7d4)
 *        stores our value VERBATIM
 *     3. otherwise compare the row's `Data` column against the incoming
 *        value with __vbaStrCmp  (0x0183534d, import 0x401254)
 *          equal     -> DUPLICATE   (returns -1 at 0x01835390)
 *          not equal -> not a duplicate
 *
 * Every operation on the value is a string operation - `__vbaStrCmp`,
 * `__vbaStrCat`, `__vbaStrCopy`, `__vbaStrMove`. There is no arithmetic, no
 * hash, no length rule and no validation anywhere on the path. The `<Checksum>`
 * element is an OPAQUE EQUALITY TOKEN scoped by DeviceID.
 *
 * WHAT THAT BUYS, AND WHAT IT DOES NOT.
 *
 *   IT BUYS: a resend of the SAME attempt, carrying the SAME token, is caught
 *   by the till and answered DUPLICATE instead of being posted twice.
 *
 *   IT DOES NOT BUY: protection across a token change, because the store is
 *   ONE DEEP - a single row per device holding only the last value. Attempt A,
 *   then B, then A again reads as three distinct orders. Nor is the guard
 *   guaranteed to be running at all: `CheckWPOrder` jumps clean over
 *   `IsDuplicateHandheldOrder2` when the global word at 0x2a2f1e4 is clear
 *   (cmp/je at 0x01826289), and what sets it is NOT SHOWN. And an EMPTY token
 *   skips the guard unconditionally (__vbaStrCmp against '' at 0x018261fa).
 *
 * So exactly-once still lives on Verdura's side. This token is a second line of
 * defence that we can now actually deploy, not a replacement for the first.
 */

import { createHash, randomUUID } from 'node:crypto';

export class WaiterPadTokenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WaiterPadTokenError';
  }
}

/**
 * Shape of the token on the wire.
 *
 * The receiver imposes NO format - it string-compares whatever arrives. We
 * nevertheless constrain ourselves, because the value is interpolated into
 * SQL by the receiver (`... Data) VALUES ('` + value + `'`) with no visible
 * escaping. A token that cannot contain a quote cannot break that statement.
 *
 * 32 lowercase hex characters: unambiguous, quote-free, and comfortably wide
 * enough that two distinct attempts will not collide.
 */
const TOKEN_RE = /^[0-9a-f]{32}$/;

/**
 * Characters that must never reach the till, listed rather than written as a
 * regex class: the set contains a quote and a backslash, and escaping those in
 * a literal is a known source of bugs.
 */
const HOSTILE_CHARS: readonly string[] = ["'", '"', ';', String.fromCharCode(92)];

function hasHostileChar(value: string): boolean {
  for (const c of HOSTILE_CHARS) {
    if (value.includes(c)) return true;
  }
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

export interface WaiterPadTokenInput {
  /** Verdura's durable id for this ROUND. Stable across restarts and retries. */
  readonly roundId: string;
  /**
   * Which attempt this is for that round. A round that is re-prepared after an
   * operator decision gets a NEW attempt, and therefore a NEW token, because
   * the till would otherwise answer DUPLICATE to a genuinely new submission.
   */
  readonly attemptId: string;
}

/**
 * Derive the token deterministically from (roundId, attemptId).
 *
 * DETERMINISTIC ON PURPOSE. If the process crashes between persisting the
 * attempt and sending, restart recomputes the SAME token from the SAME durable
 * inputs. That is what makes the receiver's guard able to recognise a resend of
 * this attempt rather than mistaking it for a new order. A random token minted
 * at send time would lose exactly that property.
 */
export function deriveWaiterPadToken(input: WaiterPadTokenInput): string {
  const roundId = requireIdent(input?.roundId, 'roundId');
  const attemptId = requireIdent(input?.attemptId, 'attemptId');
  return createHash('sha256')
    .update('verdura.waiterpad.token.v1\u0000')
    .update(roundId)
    .update('\u0000')
    .update(attemptId)
    .digest('hex')
    .slice(0, 32);
}

/** Mint an attempt id. One per genuine submission attempt, never reused. */
export function newAttemptId(): string {
  return randomUUID();
}

export function assertValidWaiterPadToken(token: unknown): asserts token is string {
  if (typeof token !== 'string' || !TOKEN_RE.test(token)) {
    throw new WaiterPadTokenError(
      'token must be 32 lowercase hex characters; the receiver interpolates it ' +
        'into SQL without escaping, so the character set is deliberately narrow',
    );
  }
}

function requireIdent(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new WaiterPadTokenError(`${field} must be a non-empty string`);
  }
  if (hasHostileChar(value)) {
    throw new WaiterPadTokenError(`${field} contains characters that must never reach the till`);
  }
  return value;
}

/**
 * What the receiver's guard can and cannot do, as data, so the operator report
 * and the tests can state it without re-deriving it from prose.
 */
export const RECEIVER_GUARD_PROPERTIES = {
  /** Keyed on the pair, not on the token alone. */
  scopedBy: ['checksum', 'deviceId'] as const,
  /** One row per device: only the LAST token is remembered. */
  depth: 1,
  /** An empty <Checksum> skips the guard entirely. */
  emptyTokenSkipsGuard: true,
  /** The whole guard can be jumped over by a flag we do not control. */
  canBeDisabledByReceiverFlag: true,
  /** Therefore: */
  sufficientForExactlyOnce: false,
} as const;
