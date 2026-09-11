/**
 * The Connector-mediated native-round evidence contract.
 *
 * WHY A COMMAND AND NOT A DATABASE CONNECTION. The evidence lives in two
 * read-only places on the venue machine: the till's stored checksum
 * (`AAAExampleData.Data` at `ColumnType='IH-<DeviceID>'`) and the native table
 * sale (`POSServer.dbo.PendingSales` joined to `PendingSaleLines`). The API is
 * not on that machine and must not hold credentials for it. The Venue Connector
 * already is, already holds them, and already carries the read-only readers for
 * both — so this rides the existing Story 2-10 command protocol exactly as
 * `idealpos.order_status.v1` does, rather than growing a second network path
 * and a second copy of a SQL credential.
 *
 * WHAT THIS COMMAND IS NOT. It carries a table code and a DeviceID and nothing
 * else. It contains no order content, no items, no prices, no customer data. It
 * cannot write, cannot submit, cannot retry, cannot reach TCP 6983, and cannot
 * be steered at a different host — the connection strings come from
 * connector-local configuration, never from this payload. A connector that
 * received a hostile version of this command could at most read a table it was
 * already configured to read.
 */

export const NATIVE_ROUND_EVIDENCE_COMMAND_TYPE = 'idealpos.native_round_evidence.v1';
export const NATIVE_ROUND_EVIDENCE_SCHEMA_VERSION = 1;
export const NATIVE_ROUND_EVIDENCE_REQUIRED_CAPABILITY = 'idealpos.native_round_evidence.v1';

/**
 * Result-type vocabulary the connector reports back.
 *
 * THE SPLIT IS THE POINT, and it is the same discipline the order-status probe
 * already follows: "we read the till and here is what it holds" must never be
 * interchangeable with "we could not read the till". The first can settle a
 * round; the second can only leave it where it is. Collapsing them would let an
 * outage look like evidence about a customer's bill.
 */
export const NATIVE_ROUND_EVIDENCE_RESULT_TYPE = {
  /** Both reads were attempted and their outcomes are in `resultPayload`. Individual halves may still be unavailable. */
  NATIVE_EVIDENCE: 'native_evidence',
  /** The connector has no evidence capability configured at all. Nothing was read. */
  EVIDENCE_READER_UNCONFIGURED: 'evidence_reader_unconfigured',
  /** The connector tried and could not read either source. We learned nothing. */
  EVIDENCE_UNAVAILABLE: 'evidence_unavailable',
  /** The command's own payload was malformed — nothing was read. */
  CONNECTOR_PAYLOAD_INVALID: 'connector_payload_invalid',
} as const;

export type NativeRoundEvidenceResultType =
  (typeof NATIVE_ROUND_EVIDENCE_RESULT_TYPE)[keyof typeof NATIVE_ROUND_EVIDENCE_RESULT_TYPE];

/**
 * The probe payload: the minimum that identifies the two reads.
 *
 * `map` is carried when the round's own pre-send baseline observed one, so both
 * terms of the delta are read from the same native table context. Without it
 * the connector falls back to its CONFIGURED map, and if that is unset the read
 * fails closed rather than guessing which partition to look in — Map 0 is the
 * web/takeaway partition and reading across that boundary would let a web
 * ticket answer a dine-in question.
 */
export interface NativeRoundEvidenceCommandPayload {
  /** The native table code, e.g. "5". */
  readonly posTableCode: string;
  /** The Verdura handheld identity whose token row to read. Never the venue iPad's. */
  readonly deviceId: string;
  /** The map partition the pre-send baseline was read in, when one is known. */
  readonly map?: string;
}

/**
 * Stable, attempt-qualified idempotency key.
 *
 * Keyed by ATTEMPT rather than by round, because the token row is one-deep per
 * device and therefore speaks only about the most recent attempt. A probe
 * created for attempt N must never be reused to answer a question about attempt
 * N+1. The trailing ordinal lets successive probes for the same attempt
 * converge over sweeps, and makes two concurrent sweeps compute the SAME key —
 * so the second collides on the unique constraint and gets the existing row
 * instead of creating a duplicate.
 */
export function buildNativeEvidenceIdempotencyKey(attemptId: string, probe: number): string {
  return `native-round-evidence:${attemptId}:${probe}`;
}
