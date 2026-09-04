/**
 * The Connector-mediated order-status readback contract.
 *
 * WHY A COMMAND AND NOT AN HTTP CALL. IdealposBridge listens on
 * 127.0.0.1:5588 on the venue machine and is authenticated with a bearer
 * key held in the Bridge's own config. The API is not on that loopback
 * interface and must not hold that credential: the Venue Connector is the
 * one component that is deliberately co-located with Bridge and already
 * trusted with its URL and key (see IdealposBridgeClient's own doc
 * comment — "the base URL and API key are supplied by the caller from
 * trusted connector configuration ... so a command can never redirect this
 * client anywhere else"). Giving the API a direct Bridge coupling would
 * duplicate that credential into a second process and a second network
 * path for no gain, so the readback rides the existing Story 2-10 command
 * protocol exactly as `idealpos.submit_order.v1` already does.
 *
 * WHAT THIS IS NOT. This command carries no order data, no table, and no
 * write of any kind. It is a pure read of
 * `GET /api/orders/{externalOrderId}` on Bridge. It cannot create,
 * modify, or assign anything in IdealPOS.
 */
export const IDEALPOS_ORDER_STATUS_COMMAND_TYPE = 'idealpos.order_status.v1';
export const IDEALPOS_ORDER_STATUS_SCHEMA_VERSION = 1;
export const IDEALPOS_ORDER_STATUS_REQUIRED_CAPABILITY = 'idealpos.order_status.v1';

/**
 * Result-type vocabulary the connector reports back. Deliberately keeps
 * "the Bridge answered, and the answer was 'I have no such order'"
 * (`BRIDGE_ORDER_NOT_FOUND`) separate from "we learned nothing"
 * (`BRIDGE_UNREACHABLE_OR_FAILED`) and from "the Bridge answered with
 * something we refuse to interpret" (`BRIDGE_STATUS_UNREADABLE`).
 *
 * That three-way split is the whole point: `decideConfirmation` treats all
 * three as non-confirming, but they are NOT interchangeable — a 404 is a
 * real answer that must never become `failed` (Bridge's SQLite state can
 * be lost and re-created), while an unreachable Bridge is not an answer at
 * all. Collapsing them would let an infrastructure outage look like
 * evidence about an order.
 *
 * Must byte-match the connector-side constants in
 * apps/venue-connector/src/VerduraIdealposTracer.Core/OrderSubmission/IdealposOrderStatusService.cs.
 */
export const IDEALPOS_ORDER_STATUS_RESULT_TYPE = {
  /** Bridge returned 2xx with a parseable order record. The body is in `resultPayload.body`. NOT itself a confirmation — `decideConfirmation` still adjudicates it. */
  BRIDGE_ORDER_STATUS: 'bridge_order_status',
  /** Bridge returned 404: it has no record of this externalOrderId. A real answer, but never evidence of failure. */
  BRIDGE_ORDER_NOT_FOUND: 'bridge_order_not_found',
  /** Bridge returned 2xx but the body was absent, oversized, or not parseable as an order record. Refused rather than guessed at. */
  BRIDGE_STATUS_UNREADABLE: 'bridge_status_unreadable',
  /** Could not reach Bridge, or Bridge returned a non-2xx/non-404 response. We learned nothing. */
  BRIDGE_UNREACHABLE_OR_FAILED: 'bridge_unreachable_or_failed',
  /** The command's own payload was malformed — Bridge was never contacted. */
  CONNECTOR_PAYLOAD_INVALID: 'connector_payload_invalid',
} as const;

export type IdealposOrderStatusResultType =
  (typeof IDEALPOS_ORDER_STATUS_RESULT_TYPE)[keyof typeof IDEALPOS_ORDER_STATUS_RESULT_TYPE];

/**
 * The probe command's payload. Deliberately the minimum that identifies
 * the read: no table, no items, no totals. A connector that receives this
 * command cannot learn anything about the order's contents from it, and
 * cannot be steered at a different host — the Bridge base URL and key come
 * from connector-local configuration, never from here.
 */
export interface IdealposOrderStatusCommandPayload {
  externalOrderId: string;
}

/** Stable, attempt-qualified idempotency key. See ConnectorBridgeOrderStatusReader for why the attempt ordinal is part of it. */
export function buildOrderStatusIdempotencyKey(externalOrderId: string, attempt: number): string {
  return `idealpos-order-status:${externalOrderId}:${attempt}`;
}
