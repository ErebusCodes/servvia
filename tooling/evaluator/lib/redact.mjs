/**
 * Everything the evaluator writes passes through redact(): raw logs, excerpts
 * and the record. Credentials are removed by shape (the patterns the API's own
 * security events use, apps/api/src/observability/security-events.ts) and by
 * value (every secret-looking variable of the evaluation environment).
 */
export const REDACTED = '[redacted]';

const PATTERNS = [
  // JWT (header.payload.signature, base64url)
  /eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}/g,
  // Authorization header values
  /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi,
  // credential setup codes: <uuid>.<secret>
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[A-Za-z0-9_-]{16,}/gi,
  // credentials in connection URLs
  /\b([a-z][a-z0-9+.-]*:\/\/[^\s:/@]+):[^\s@/]+@/gi,
  // cookies
  /\b(set-cookie|cookie)\s*:\s*[^\r\n]+/gi,
  // key/value secrets in text and JSON
  /(["']?(?:password|passwd|pin|secret|token|api[_-]?key|authorization|cookie)["']?\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s,;}]+)/gi,
  // email addresses
  /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,
];

const SECRET_NAME = /SECRET|TOKEN|PASSWORD|PASSWD|KEY|PIN|COOKIE|CREDENTIAL/i;

/** The values of an environment that must never appear in evidence. */
export function secretValues(env) {
  return Object.entries(env ?? {})
    .filter(([name, value]) => SECRET_NAME.test(name) && typeof value === 'string' && value.length >= 6)
    .map(([, value]) => value)
    .sort((a, b) => b.length - a.length);
}

export function redact(text, secrets = []) {
  let out = String(text ?? '');
  for (const value of secrets) out = out.split(value).join(REDACTED);
  out = out.replace(PATTERNS[0], REDACTED);
  out = out.replace(PATTERNS[1], `$1 ${REDACTED}`);
  out = out.replace(PATTERNS[2], REDACTED);
  out = out.replace(PATTERNS[3], `$1:${REDACTED}@`);
  out = out.replace(PATTERNS[4], `$1: ${REDACTED}`);
  out = out.replace(PATTERNS[5], `$1${REDACTED}`);
  out = out.replace(PATTERNS[6], REDACTED);
  return out;
}

/** Redacts every string inside a JSON-compatible value, keeping its structure. */
export function redactDeep(value, secrets = []) {
  if (typeof value === 'string') return redact(value, secrets);
  if (Array.isArray(value)) return value.map((v) => redactDeep(v, secrets));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, redactDeep(v, secrets)]));
  }
  return value;
}
