# Security events: what the services emit, and what is still owed

This page covers Story 12.13 (foundation) and Story 12.2 (request IDs).

## What exists

- **Both services write security events as JSON lines on stdout**, in one
  shape:
  - envelope fields `time`, `level`, `msg` and `event`, plus snake_case
    fields;
  - `request_id` on every event made during a request;
  - the Nest API also adds `correlation_id` and `"service":"api"`.
- **Go Core** uses `log/slog`'s JSON handler. Its events:
  - `staff_session_refused`
  - `venue_access_denied`
- **The Nest API** uses `apps/api/src/observability/security-events.ts`. Only
  the event names listed there can be emitted, and every field is redacted
  first. Its events:

  | Event | Level |
  | --- | --- |
  | `login_failed` | warn |
  | `login_failed_unknown_account` | warn |
  | `login_throttled` | warn |
  | `login_throttle_unavailable` | error |
  | `staff_session_refused` | warn |
  | `staff_session_check_failed` | error |
  | `credential_setup_refused` | warn |
  | `rate_limit_exceeded` | warn |
  | `rate_limit_unavailable` | error |

- **Request IDs.** Both services:
  - accept a safe inbound `X-Request-Id` (`[A-Za-z0-9._:-]`, 1–128
    characters), or make one;
  - set `X-Correlation-Id` from the inbound header, or from the request ID;
  - echo both on the response.

  A support report that quotes the response's `X-Request-Id` finds its events.
- **Redaction is in the services, before anything leaves them.**
  - A field whose name suggests a secret always logs as `[redacted]`. This
    covers passwords, PINs, tokens, authorization, cookies, codes, hashes,
    credentials and email.
  - These values are removed from any other field: JWTs, `Bearer` and `Basic`
    values, setup codes, and email addresses.
  - Control characters are removed, so one event stays on one line.
  - Values are capped at 256 characters.
  - Sign-in events identify an account only by an HMAC pseudonym (`account`),
    never by its address.
  - Tests prove all of this: `security-events.spec.ts` and
    `test/security-events.integration-spec.ts`.
- **Security events are not the audit trail.** `AuditLog` remains the
  business audit trail, and a refusal writes no `AuditLog` row. To pick these
  lines out of the Nest API's mixed output, select lines that parse as JSON
  and have an `event` field.

## What is still owed (Story 12.13 remains BLOCKED for these)

- **Durable store and shipping:**
  - a collector on the host reading both services' stdout files;
  - the store it ships to.

  The provider and its cost are an owner decision, and no sink is configured
  in the repository.
- **Retention:**
  - at least 90 days, per the acceptance criteria;
  - anything longer is an owner decision.
- **Rotation of the NSSM stdout files on the host:**
  - NSSM's file rotation (`AppRotateFiles`, `AppRotateBytes`) is host
    configuration, not tracked in this repository;
  - it is applied with the deployment, which needs authorization.
