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
  | `venue_access_denied` | warn (Story 2.10; Core's name and fields) |
  | `venue_access_check_failed` | error |
  | `rate_limit_exceeded` | warn |
  | `rate_limit_unavailable` | error |
  | `audit_write_failed` | error (an `AuditLog` row written off the response path could not be written) |

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
  business audit trail. Refused sessions, venue access and rate-limited
  requests write no `AuditLog` row; a refused sign-in for an existing account
  also writes a `login_failed` row, off the response path (an unknown address
  writes none, so waiting for it would reveal which accounts exist). To pick
  these lines out of the Nest API's mixed output, select lines that parse as
  JSON and have an `event` field.
- **Client addresses** (`client_ip`) are the address the rate limiter counts,
  believed from X-Forwarded-For only behind a loopback proxy
  (`apps/api/src/config/client-ip.ts`), never a raw header a client wrote.

## What is done, and what is still owed

Kept apart, because they are owned differently:

1. **Application security events — done.** Structured, redacted events from
   a fixed taxonomy, with request and correlation IDs, in both services (above).
   They are emitted to stdout only: that is not durable and not centralized.
2. **A durable, centralized sink — external/infrastructure, not chosen.** A
   collector on the host reading both services' stdout, and the store it ships
   to. No provider is selected and none is configured in the repository; until
   one is, events exist only in the host's stdout files.
3. **Host output rotation — infrastructure/operations, not done.** NSSM's
   rotation (`AppRotateFiles`, `AppRotateBytes`) is host configuration, not in
   this repository, applied with an authorized deployment (see the cutover
   list in `docs/windows-production-deployment.md`).
4. **Retention.** At least 90 days is already established (NFR-AUD; Story
   12.13's acceptance criteria); it is not a decision still to make. Retention
   beyond that, and any material recurring cost of a provider, are owner and
   infrastructure decisions.
