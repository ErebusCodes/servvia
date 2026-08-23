/**
 * E8-S1 (expanded, KOT dispatch producer). The one production command type
 * this story adds, following the existing dotted/versioned convention
 * established by `connector-command.service.ts`'s
 * `connector.self_test.v1`.
 */
export const PRINT_KOT_COMMAND_TYPE = 'printer.print_kot.v1';
export const PRINT_KOT_SCHEMA_VERSION = 1;
export const PRINT_KOT_REQUIRED_CAPABILITY = 'printer.print_kot.v1';

/**
 * Structured result codes a connector reports back via the existing
 * `ConnectorCommandReportDto.resultType` (a free-form, bounded string —
 * unchanged). Distinguishing these lets `PrinterDispatcherService`'s
 * reconciler apply the right, safe transition (bounded auto-retry vs.
 * manual-only vs. terminal) instead of treating every failure identically.
 */
export const KOT_RESULT_TYPE = {
  /** A real device-path/print-spooler acknowledgement was received. */
  EXECUTED_ACKNOWLEDGED: 'executed_acknowledged',
  /** Confirmed NOT executed (e.g. connection refused, timeout before send) — safe to auto-retry. */
  RETRYABLE_LOCAL_FAILURE: 'retryable_local_failure',
  /** The connector has no supported transport for this printer's configuration. */
  UNSUPPORTED: 'unsupported',
  /** Command version or payload structure not recognized by this connector build. */
  UNSUPPORTED_VERSION: 'unsupported_version',
  /** Payload checksum did not match the declared content — never retried blindly. */
  CHECKSUM_MISMATCH: 'checksum_mismatch',
  /** Payload failed structural validation. */
  MALFORMED_PAYLOAD: 'malformed_payload',
  /** Execution was attempted but the outcome could not be confirmed locally. */
  UNCERTAIN_LOCAL_RESULT: 'uncertain_local_result',
  /** The connector observed the underlying order/job was cancelled before printing. */
  CANCELLED: 'cancelled',
} as const;

export type KotResultType = (typeof KOT_RESULT_TYPE)[keyof typeof KOT_RESULT_TYPE];
