/**
 * The one production ConnectorCommand type this story adds, following the
 * existing dotted/versioned convention established by
 * connector-command.service.ts's 'connector.self_test.v1'.
 *
 * A connector-side handler for this command type would call the real,
 * already-documented VerduraIdealposBridge contract (POST /api/orders —
 * see /Users/sarwarkhan/Documents/IdealposBridge/examples/verdura-client-example.md,
 * read but not modified for this story). No such handler exists yet under
 * apps/venue-connector (confirmed by inspection) — that is a separate,
 * follow-on unit of work. This file defines only the Verdura-side envelope
 * and payload shape; it is deliberately the exact output shape of
 * buildIdealposOrderPayload (idealpos-order-payload-mapper.ts), never a
 * second, independently-invented translation.
 */
export const IDEALPOS_SUBMIT_ORDER_COMMAND_TYPE = 'idealpos.submit_order.v1';
export const IDEALPOS_SUBMIT_ORDER_SCHEMA_VERSION = 1;
export const IDEALPOS_SUBMIT_ORDER_REQUIRED_CAPABILITY = 'idealpos.submit_order.v1';

/**
 * Result-type vocabulary a connector reports back via the existing generic
 * ConnectorCommandReportDto.resultType. Deliberately small: this story's
 * dispatcher only distinguishes what it can act on truthfully — "the
 * bridge accepted the HTTP submission" vs "it definitely did not" vs
 * "unknown". It does NOT attempt the fuller evidence-tier taxonomy a real
 * connector-side handler will eventually need (e.g. distinguishing native
 * IdealPOS consumption from bridge acceptance) — that requires the
 * connector-side implementation this story does not include, and adding
 * result codes for evidence this dispatcher can never itself produce or
 * consume would be speculative.
 */
export const IDEALPOS_SUBMIT_ORDER_RESULT_TYPE = {
  /** IdealposBridge returned 2xx to POST /api/orders. NOT evidence of native IdealPOS consumption, a KOT, or kitchen receipt — see POSSyncStatus.submitted_awaiting_confirmation's own doc comment. */
  BRIDGE_ACCEPTED: 'bridge_accepted',
  /** IdealposBridge returned a definite rejection (e.g. 400 unknown table/product) — a real response was received and it was negative. */
  BRIDGE_REJECTED: 'bridge_rejected',
  /** The connector could not reach the bridge, or the bridge returned 5xx / an unparseable response. */
  BRIDGE_UNREACHABLE_OR_FAILED: 'bridge_unreachable_or_failed',
} as const;

export type IdealposSubmitOrderResultType =
  (typeof IDEALPOS_SUBMIT_ORDER_RESULT_TYPE)[keyof typeof IDEALPOS_SUBMIT_ORDER_RESULT_TYPE];
