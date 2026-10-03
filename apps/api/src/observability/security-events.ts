import { currentRequestContext } from './request-context';

/**
 * Security events (Story 12.13 foundation; NFR-OBS, NFR-AUD): refusals and
 * failures of authentication and authorization, written as one JSON line on
 * stdout in the same shape as Go Core's slog JSON (`time`, `level`, `msg`,
 * `event`, snake_case fields, `request_id`), so one collector can ingest both
 * services. They are operational records for investigation, not the business
 * audit trail: AuditLog stays that, and no refusal writes an AuditLog row
 * here.
 *
 * Only names from this taxonomy can be emitted, and every field passes
 * through redactSecurityFields first, so a credential, token, setup code,
 * password, PIN or email address never reaches a log line, whatever a caller
 * passes.
 */
export const SECURITY_EVENTS = {
  // Sign-in (Story 2.4)
  login_failed: 'warn',
  login_failed_unknown_account: 'warn',
  login_throttled: 'warn',
  login_throttle_unavailable: 'error',
  // Sessions (Stories 2.5, 2.8). Same name as Core's event.
  staff_session_refused: 'warn',
  staff_session_check_failed: 'error',
  // Credentials (Story 8.1)
  credential_setup_refused: 'warn',
  // Per-address request limiting (NFR-SEC-2)
  rate_limit_exceeded: 'warn',
  rate_limit_unavailable: 'error',
} as const;

export type SecurityEventName = keyof typeof SECURITY_EVENTS;
export type SecurityEventLevel = (typeof SECURITY_EVENTS)[SecurityEventName];

type FieldValue = string | number | boolean | null | undefined;
export type SecurityEventFields = Record<string, FieldValue>;

/** Field names whose values are never logged, whatever they hold. */
const SECRET_FIELD =
  /pass(word|wd)?|pin|secret|token|authori[sz]ation|cookie|code|otp|hash|credential|session_?key|e-?mail/i;

/** Values that are credentials wherever they appear. */
const SECRET_VALUES: RegExp[] = [
  // A JWT (header.payload.signature, base64url).
  /eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}/g,
  // An Authorization header value.
  /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi,
  // A credential setup code (Story 8.1): <uuid>.<secret>.
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[A-Za-z0-9_-]{16,}/gi,
  // An email address.
  /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,
];

const MAX_VALUE_LENGTH = 256;
export const REDACTED = '[redacted]';

function redactValue(value: FieldValue): FieldValue {
  if (typeof value !== 'string') return value;
  let text = value;
  for (const pattern of SECRET_VALUES) text = text.replace(pattern, REDACTED);
  // One event, one line: no control characters (log injection), bounded size.
  // eslint-disable-next-line no-control-regex
  text = text.replace(/[\u0000-\u001f\u007f]/g, ' ');
  return text.length > MAX_VALUE_LENGTH ? `${text.slice(0, MAX_VALUE_LENGTH)}…` : text;
}

/** The fields as they may be logged: secret-named fields and secret-shaped values removed. */
export function redactSecurityFields(fields: SecurityEventFields): SecurityEventFields {
  const safe: SecurityEventFields = {};
  for (const [name, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    const key = name.replace(/[^A-Za-z0-9_]/g, '_').slice(0, 64);
    safe[key] = SECRET_FIELD.test(name) ? REDACTED : redactValue(value);
  }
  return safe;
}

/** Where event lines go; stdout in production, replaceable in tests. */
export type SecurityEventSink = (line: string) => void;

let sink: SecurityEventSink = (line) => {
  process.stdout.write(`${line}\n`);
};

export function setSecurityEventSink(next: SecurityEventSink): SecurityEventSink {
  const previous = sink;
  sink = next;
  return previous;
}

/**
 * Writes one security event. Never throws: a logging failure must not change
 * the outcome of the request that is being refused.
 */
export function logSecurityEvent(
  event: SecurityEventName,
  msg: string,
  fields: SecurityEventFields = {},
): void {
  try {
    const context = currentRequestContext();
    // The envelope comes last, so no field can overwrite it.
    const line = {
      ...redactSecurityFields(fields),
      time: new Date().toISOString(),
      level: SECURITY_EVENTS[event].toUpperCase(),
      msg: redactValue(msg),
      service: 'api',
      event,
      request_id: context?.requestId,
      correlation_id: context?.correlationId,
    };
    sink(JSON.stringify(line));
  } catch {
    // Deliberately swallowed; see above.
  }
}
