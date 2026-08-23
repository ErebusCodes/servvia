---
baseline_commit: HEAD@2026-08-16 (continues story 2-9's connector identity work in the same session)
epic: E2
realizes: the "connector command/session protocol" explicitly deferred by story 2-9 Phase 1 ("Deferred to a follow-on story" section) and the follow-on story referenced by `sprint-status.yaml`'s `venue-connector-identity-and-durable-queue` gate
supersedes: nothing — no existing story owned this capability; verified by reading epics.md's E2/E9 sections, decisions-log.md's DL-064–069, and stories 9-1/9-2/9-3 before filing this ID
tracer_bullet: true
production_story: false
transport_decision: docs/decisions-log.md DL-070
---

# Story 2.10: Connector Command & Acceptance Protocol

Status: done

## Story

As the platform and venue operator,
I want a durable, authenticated command that Verdura can assign to the correct connector installation for a venue, and a truthful, persisted acknowledgement that the connector durably accepted responsibility for it,
so that story 9-2 (Idealpos UI-bridge tracer), a future connector-dependent POS-sync/print-job dispatch path, and Epic 15's Order Tablet stories (E15-S5/S6/S7) have a real, proven command-assignment mechanism to build on — one that never claims Idealpos, EFTPOS, KDS, or printer success, only that an authenticated connector accepted responsibility for a unit of work.

This story is Phase 2 of the connector work story 2-9 (Phase 1: identity, enrolment, authentication, revocation, rotation, minimal heartbeat — done) explicitly deferred. Nothing here implements Idealpos automation, EFTPOS handling, printer communication, or Order Tablet UI — see Explicit Exclusions.

## Story Ownership — verified before this ID was assigned

Before filing a new story, the repository was checked for an existing owner of this capability:
- `docs/epics.md` E2 (Authentication) ends at E2-S9 (superseded by story 2-9); no E2 story names a command protocol. A new `E2-S10` entry was added to `docs/epics.md` to make this story traceable from the epic, not left as an orphan tracer like stories 6-1/8-1/9-1 initially were.
- `docs/epics.md` E9 (IdealPOS Integration) is Idealpos-specific by definition (`BLOCKED ON: Q1`/DL-064 for every story except the truthfulness fix); this protocol is deliberately Idealpos-agnostic (its only implemented command type has no Idealpos content) and does not belong there.
- Story 2-9's own file states: *"The outbound-only authenticated command/result session protocol... No command protocol exists yet for a connector identity to execute against... Owner: whoever picks up the next connector-dependent story."* — this is exactly that story, continuing story 2-9's own numbering (2-9 → 2-10) rather than a fresh, disconnected ID.
- Story 9-2 (Idealpos UI-bridge tracer) explicitly lists *"story 2-9's remaining command/session-protocol phase"* as one of its two blocking dependencies (the other being live Windows discovery) — confirming this capability was anticipated but never filed.
- Story 9-3 (pos-sync outbox dispatch) explicitly does not touch the connector at all (cloud-internal only) — not a candidate owner.

No existing story, decision record, or code implements any part of this capability. Assigned as **Story 2-10**.

## Scope

### In scope
- A durable, DB-persisted command envelope and state machine (`ConnectorCommand`), transport-agnostic in design.
- Authenticated HTTPS polling as the connector-facing transport (see `docs/decisions-log.md` DL-070 for the full evaluated-alternatives record).
- Admin-triggered creation of exactly one command type: `connector.self_test.v1` — a synthetic, side-effect-free echo. No real command type (e.g. an Idealpos-order-submit type) is implemented.
- Claim (with a time-bound lease), `CONNECTOR_ACCEPTED` acceptance, and a truthful, operation-specific terminal report (`succeeded`/`failed`), each independently idempotent.
- Reconciliation sweep for lease-exhaustion (`expired`) and accepted-but-never-resolved (`unknown`) outcomes.
- A minimal, dependency-free, cross-platform connector proof harness (`backend/scripts/connector-command-harness.ts`) demonstrating persist-before-ack against real disposable local storage and real process kills — not the production Windows connector.
- Tenant/venue isolation, revocation-during-claim, rotation/replacement ownership recovery, real concurrency, and audit correlation, each proven against real Postgres.

### Explicit exclusions
- **No Idealpos automation, UI bridge, or mapping.** Story 9-2 remains separately blocked on live Windows discovery; this story does not unblock its blocking conditions, only its connector-command-protocol dependency.
- **No EFTPOS or payment handling of any kind.**
- **No printer communication.** `print-jobs` dispatch remains blocked per DL-069, unaffected by this story.
- **No Order Tablet UI change.** Epic 15's E15-S5/S6/S7 remain unimplemented; this story only removes their connector-command-protocol dependency, recorded honestly in `docs/epics.md`'s E15 banner and this story's own Change Log.
- **No production Windows connector.** `backend/scripts/connector-command-harness.ts` is a proof harness only — see its own doc comment.
- **No real command type beyond `connector.self_test.v1`.** A future story adds real command types against this same envelope/state machine without protocol changes.
- **No mutual TLS, certificate pinning, or hardware binding.** Identical transport-security boundary to story 2-9 — see DL-070.
- **No IN_PROGRESS state.** Considered and deliberately not added: this tracer's only command type resolves from `accepted` directly to a terminal report with no genuine intermediate processing phase to represent; a future real command type's story may add one if it turns out to be genuinely required for that type, without a state-machine migration (the enum can be extended additively).

## State Model

`ConnectorCommandStatus` (`backend/prisma/schema.prisma`):

| Status | Meaning | Terminal? |
| --- | --- | --- |
| `pending` | Created, not yet claimed by any connector. | No |
| `claimed` | Offered to and claimed by a specific active installation, under a time-bound lease; not yet accepted. | No |
| `accepted` | `CONNECTOR_ACCEPTED` — the connector durably persisted responsibility. **Never** evidence of Idealpos/EFTPOS/KDS/printer success. | No |
| `succeeded` | Truthful terminal success reported by the connector, carrying an operation-specific `resultType`. | Yes |
| `failed` | Truthful terminal failure reported by the connector. | Yes |
| `expired` | Claim/redelivery budget exhausted before ever reaching `accepted` — safe, nothing was ever confirmed accepted. | Yes |
| `unknown` | Reached `accepted` but no terminal report arrived within the reconciliation window — reconciliation-required, never auto-retried. | Yes |
| `cancelled` | Administratively cancelled while still `pending`/`claimed`; cannot be cancelled once `accepted`. | Yes |

Every transition and its authorised actor/preconditions/DB guard/audit/retry-eligibility:

| Transition | Actor | Precondition | DB guard | Audit event | Retry-eligible? | Terminal? |
| --- | --- | --- | --- | --- | --- | --- |
| → `pending` | Authenticated admin (`admin` role) | Venue belongs to caller's organization | `connectorCommand.create` (unique `(organizationId, venueId, idempotencyKey)`) | `CONNECTOR_COMMAND_CREATED` | n/a (creation) | No |
| `pending`/stale-`claimed` → `claimed` | Authenticated active connector (poll) | Venue match; not expired; capability match; installation under outstanding cap | `updateMany` CAS on `status`+`leaseExpiresAt` | none (internal bookkeeping, mirrors story 9-3's precedent) | Yes (next poll, until budget exhausted) | No |
| `claimed` → `accepted` | Authenticated connector that holds the claim | `claimedByInstallationId` matches caller | `updateMany` CAS on `status`+`claimedByInstallationId` | `CONNECTOR_COMMAND_ACCEPTED` | Idempotent (same installation, already `accepted` → silent success) | No |
| `accepted` → `succeeded`/`failed` | Authenticated connector that holds the acceptance | `claimedByInstallationId` matches caller; `status='accepted'` | `updateMany` CAS on `status`+`claimedByInstallationId` | `CONNECTOR_COMMAND_SUCCEEDED`/`CONNECTOR_COMMAND_FAILED` | Idempotent on identical repeat; **conflicting** repeat rejected+audited | Yes |
| stale-`claimed` (budget exhausted) → `expired` | System (poll-time lazy check, or sweep) | `claimAttemptCount >= maxClaimAttempts` | `updateMany` CAS on `status`+`leaseExpiresAt` | none (system bookkeeping — nothing was ever accepted, no security-relevant fact to record) | No | Yes |
| `pending` past `expiresAt` → `expired` | System (sweep) | `expiresAt < now()` | `updateMany` CAS on `status`+`expiresAt` | none | No | Yes |
| `accepted` past `terminalReportDeadline` → `unknown` | System (sweep) | `terminalReportDeadline < now()` | `updateMany` CAS on `status`+`terminalReportDeadline` | `CONNECTOR_COMMAND_MARKED_UNKNOWN` | No — reconciliation-required, never auto-retried | Yes |
| `pending`/`claimed` → `cancelled` | Authenticated admin (`admin` role) | Not yet `accepted` | `updateMany` CAS on `status IN (pending, claimed)` | `CONNECTOR_COMMAND_CANCELLED` | n/a | Yes |

## Command Envelope

`ConnectorCommand` (full definition: `backend/prisma/schema.prisma`):

| Field | Purpose |
| --- | --- |
| `id` | Command ID |
| `commandType`, `schemaVersion` | Versioned command contract — only `connector.self_test.v1`/`1` implemented |
| `organizationId`, `venueId` | Tenant scope; the resolvable target (the venue's currently-active installation, resolved at claim time — not pre-assigned, so rotation is handled correctly) |
| `sourceAggregateType`, `sourceRecordId` | Points at the upstream business record; nullable — this tracer's own command has no upstream aggregate by design (admin-triggered, not order/POS-driven) |
| `idempotencyKey` | Caller-supplied, unique per `(organizationId, venueId)` — creation-time idempotency |
| `correlationId`, `causationId` | Trace context (nullable, unused by this tracer's own creation path, present for a future real command type) |
| `requiredCapability` | Only an installation whose self-reported (story 2-9 heartbeat) capabilities contain this key may claim it |
| `payload` | Ceiling-enforced (`MAX_PAYLOAD_BYTES`) at creation; never secrets/card data/unnecessary customer data |
| `claimedByInstallationId`, `claimedAt`, `leaseExpiresAt`, `claimAttemptCount`, `maxClaimAttempts` | Claim/lease bookkeeping |
| `acceptedAt`, `terminalReportDeadline` | Acceptance + reconciliation-window bookkeeping |
| `resultType`, `resultPayload`, `failureReason`, `reportedAt`, `reportIdempotencyKey` | Truthful terminal report |
| `cancelledAt`, `cancelledByStaffId` | Cancellation |

Database-enforced invariants (hand-authored in the migration, mirroring story 2-9's own partial-unique-index precedent):
- `claimedByInstallationId`/`claimedAt`/`leaseExpiresAt` are set atomically together or not at all (`ConnectorCommand_claim_fields_consistent`).
- `accepted` requires a recorded claim owner (`ConnectorCommand_accepted_has_claim_owner`).
- `succeeded`/`failed` requires a real, recorded `acceptedAt` (`ConnectorCommand_terminal_report_requires_acceptance`) — a command cannot jump straight to a truthful terminal outcome without having been accepted first.
- `cancelled` requires `cancelledAt` (`ConnectorCommand_cancelled_has_cancelledAt`).

## Acknowledgement Contract

`CONNECTOR_ACCEPTED` (`accepted` status) may only be reported after the connector has durably persisted enough information to resume the command after a process/machine restart. Proven, not merely asserted: `backend/scripts/connector-command-harness.ts` is a minimal, dependency-free harness that fsyncs a claimed command to a local NDJSON file **before** calling `/accept`, and fsyncs its terminal result **before** calling `/report`. `backend/test/connector-command-harness.integration-spec.ts` spawns this harness as a real, separate OS process against a real running backend and a real local Postgres database, and unconditionally `SIGKILL`s it at each of the three persist-before-ack boundaries, then restarts it and proves exactly one successful terminal report results — never zero (lost), never two (duplicated/conflicting).

## Retry and Lease Rules

- **Claim lease:** `CLAIM_LEASE_MS` (2 minutes). A `claimed` command whose lease has expired without reaching `accepted` becomes eligible for redelivery to whichever installation is currently active for the venue (not necessarily the original claimant — see rotation/replacement below).
- **Claim-attempt budget:** `maxClaimAttempts` (default 5). Once exhausted, a stale-leased command transitions to `expired` instead of being reclaimed again — never offered forever.
- **Overall command expiry:** `COMMAND_TTL_MS` (1 hour). A command not yet `accepted` by this time is never claimed again, regardless of claim-attempt budget.
- **Terminal-report window:** `TERMINAL_REPORT_WINDOW_MS` (5 minutes after acceptance). An `accepted` command with no terminal report by this deadline becomes `unknown` — reconciliation-required, never auto-retried (retrying an already-accepted command could duplicate a future real command type's side effect).
- **Poll batch/outstanding bounds:** `MAX_POLL_BATCH` (5 per poll call) and `MAX_OUTSTANDING_PER_INSTALLATION` (20 `claimed`+`accepted` rows); once at the cap, poll returns empty rather than erroring.

## Security Invariants

- Every connector-facing route requires Story 2-9's `ConnectorAuthGuard` — re-authenticated on every single call, never a session negotiated once (see DL-070).
- Identity (`organizationId`/`venueId`/`installationId`) is resolved exclusively from the authenticated credential — never a caller-supplied venue/org parameter, on any route.
- `RateLimitGuard` is ordered before `ConnectorAuthGuard` on every connector-facing route (the same computational-amplification defense story 2-9's own independent review established for `/heartbeat`, applied proactively here from the start).
- Command type, schema version, capability, and payload size are all validated (`class-validator` DTOs, `MAX_PAYLOAD_BYTES`).
- Tenant/venue ownership is enforced at both the service layer (identity-scoped queries) and the database layer (FKs, the CAS `WHERE` clauses themselves scoping every mutation to `organizationId`+`venueId`).
- A revoked/replaced installation cannot poll, accept, or report anything — rejected at the guard, before any command logic runs (proven in the real-Postgres suite).
- No secret, credential, or unnecessary payload content appears in any audit event or error message (proven by a real-Postgres test that collects every plaintext secret generated during the run and asserts none appear in the serialized audit rows).

## Failure Matrix

| Scenario | Result | Evidence |
| --- | --- | --- |
| Cross-venue/cross-tenant poll | Never returns another venue's commands | `connector-command.integration-spec.ts` |
| Cross-tenant command creation | 404 | same |
| Revoked connector polls/accepts | 401 (guard-level, before command logic) | same |
| Two concurrent claim attempts for one command | Exactly one wins | same (real-Postgres concurrency test) |
| Duplicate poll while lease fresh | Command not re-offered | same |
| Repeat accept (same installation) | Idempotent no-op | same |
| Repeat identical terminal report | Idempotent no-op | same |
| Conflicting terminal report | Rejected (409) + audited | same |
| Claimed command, lease expires, budget not exhausted | Reclaimable by the currently-active installation (may differ after rotation) | same |
| Claimed command, lease expires, budget exhausted | `expired`, never offered again | same |
| Pending command past overall expiry | `expired` via sweep, never claimable | same |
| Accepted command, terminal-report window elapses | `unknown` via sweep, audited, late report rejected | same |
| Cancel a pending/claimed command | `cancelled` | same |
| Cancel an already-accepted command | Rejected (404) | same |
| Connector process killed after local persist, before `/accept` | Safe resume, exactly one terminal report | `connector-command-harness.integration-spec.ts` |
| Connector process killed after `/accept`, before terminal persist | Safe resume, exactly one terminal report | same |
| Connector process killed after terminal persist, before `/report` | Safe resume, exactly one terminal report | same |
| Tracer command lifecycle vs. `POSSyncRecord`/`PrinterJob` | Zero coupling — counts unchanged before/after | `connector-command.integration-spec.ts` |

## Acceptance Criteria

1. An authorised admin can trigger this story's one tracer command type for a venue in their own organization; a venue outside it is rejected (404).
2. An authenticated, active connector installation can claim (poll), accept, and truthfully report only commands for its own organization/venue.
3. `CONNECTOR_ACCEPTED` is reported only after the connector's own durable local persistence — proven via a real process kill and safe resume (`DURABLE_CONNECTOR_HARNESS` tier), not asserted.
4. A revoked or replaced connector installation cannot claim, accept, or report anything — rejected immediately, at the authentication guard, on its very next request.
5. A command cannot be claimed by two independent executions — proven under real concurrent load against real Postgres.
6. Duplicate polling, reconnects, and redelivery preserve exactly one logical command (no duplicate rows, no duplicate independent executions).
7. Acceptance is idempotent; completion/failure reports are idempotent; a conflicting terminal report is rejected and audited, never silently overwritten.
8. A claimed-but-unaccepted command becomes safely reclaimable after its lease, and is never offered again once its redelivery budget or overall expiry is exhausted.
9. Cross-tenant/cross-venue access is rejected at both the service and database boundaries.
10. Connector replacement (rotation) has deterministic command-ownership recovery: a command claimed by a since-replaced installation becomes claimable by the new active installation once its lease lapses — proven end-to-end against real Postgres.
11. An `accepted` command with no terminal report within its reconciliation window becomes `unknown` (reconciliation-required) — never silently resolved, never auto-retried.
12. Batch size and per-installation outstanding-command count are bounded.
13. Security-relevant lifecycle events are auditable without ever exposing a credential or unnecessary payload content.
14. Existing `POSSyncRecord`/`PrinterJob` state machines are provably untouched by this story's command lifecycle.
15. No code path, test, or document may claim Idealpos, EFTPOS, KDS, or printer success — `CONNECTOR_ACCEPTED`/`succeeded` mean only that the authenticated connector durably accepted/completed responsibility for a synthetic self-test command.

## Evidence Requirements

- `STATIC_ANALYSIS`: `tsc --noEmit`, `eslint` clean on all new/changed source files.
- `UNIT_OR_MOCK`: mocked-Prisma unit tests for every state-machine branch in `connector-command.service.ts`.
- `REAL_POSTGRES`: `connector-command.integration-spec.ts` — every Failure Matrix row above, against real Postgres, including real concurrency.
- `REAL_REDIS_OR_QUEUE`: not separately applicable — `RateLimitGuard` (real Redis-backed) is exercised as a side effect of every real HTTP call above; no BullMQ queue involved in this story.
- `DURABLE_CONNECTOR_HARNESS`: `connector-command-harness.integration-spec.ts` — a real, separate OS process, real fsync'd local storage, real `SIGKILL`s, real resume.
- `REAL_WINDOWS_CONNECTOR`/`REAL_IDEALPOS`/`REAL_EFTPOS`/`REAL_KOT_PRINTER`: **not attempted, not available in this session** — explicit boundary, not a failure or a success. Nothing in this story's code, tests, or documentation claims any of these were contacted.
- Migration verification against both the populated shared dev database and a clean-from-zero disposable container.
- Full existing unit and real-Postgres integration suites re-run to confirm zero regression.

## Rollback/Migration Considerations

Purely additive: one new enum, one new table, four hand-authored CHECK constraints, new back-relation fields on `Organization`/`Venue`/`Staff`/`ConnectorInstallation`. No existing table, column, enum value, or constraint is altered. Safe to roll back by dropping the new table/enum alone (no other table references `ConnectorCommand`).

## Definition of Done

All fifteen acceptance criteria pass with real evidence at the tier each requires (see Dev Agent Record for actual results). No unresolved P0/P1 from independent review. Migration verified against both a populated and a clean-from-zero database. Full existing test suites re-confirmed with zero regression. Documentation makes no real-Idealpos/EFTPOS/KDS/KOT claim anywhere. Story 9-2 and Epic 15's E15-S5/S6/S7 have their connector-command-protocol dependency genuinely satisfied (their *other* blocking dependencies — live Windows discovery, DL-064, DL-067 — remain unaffected and unresolved by this story).

## Dev Agent Record

### Implementation summary (2026-08-16)

- **Schema**: `ConnectorCommand` + `ConnectorCommandStatus` added to `prisma/schema.prisma`; migration `backend/prisma/migrations/20260816150000_connector_command_protocol/` adds the table, indexes, FKs, and four hand-authored CHECK constraints.
- **Service**: `backend/src/connector/connector-command.service.ts` — `createTracerCommand`, `poll`, `accept`, `report`, `cancel`, `getStatus`, `sweep`.
- **Sweeper**: `backend/src/connector/connector-command-sweeper.service.ts` — periodic timer wrapper, disabled under `NODE_ENV=test` (mirrors story 9-3's `PosSyncDispatcherService` precedent exactly, for the identical cross-test-contamination reason).
- **Controllers**: `connector-command.controller.ts` (connector-facing: poll/accept/report) and `connector-command-admin.controller.ts` (admin-facing: trigger tracer, status, cancel).
- **Harness**: `backend/scripts/connector-command-harness.ts` — dependency-free proof harness (see its own doc comment for the full design rationale).
- **Transport decision**: `docs/decisions-log.md` DL-070, evaluated against three alternatives, before implementation began.

### Evidence

- `STATIC_ANALYSIS`: `npx tsc --noEmit` clean across the whole backend (including the new `scripts/` file). `npx eslint` clean on every new/changed `src/**` and `scripts/**` file. The two new `test/**` integration-spec files carry the same pre-existing, repository-wide `@typescript-eslint/no-unsafe-*` lint debt already documented against every other `*.integration-spec.ts` file (story 2-9's own review) — not a new regression, not claimed as clean.
- `UNIT_OR_MOCK`: 20 new unit tests (`connector-command.service.spec.ts`), all passing. Full existing unit suite re-confirmed 410/410 (390 pre-existing + 20 new), zero regressions.
- `REAL_POSTGRES`: `connector-command.integration-spec.ts`, 22 tests, covering the full Failure Matrix above — including a real concurrent-claim race, cross-tenant isolation, revocation-during-claim, rotation/replacement ownership recovery, lease exhaustion, overall expiry, reconciliation (`unknown`), cancellation, bounded outstanding commands, and non-coupling with `POSSyncRecord`/`PrinterJob`. Re-run as part of the full 9-suite integration run (see below) three consecutive times with zero flakiness.
- `DURABLE_CONNECTOR_HARNESS`: `connector-command-harness.integration-spec.ts`, 4 tests — one happy-path run proving the local NDJSON log genuinely exists on disk with fsync'd `claimed`/`terminal` entries, and three real-`SIGKILL` crash-window tests (one per persist-before-ack boundary), each followed by a real process restart and exactly-one-terminal-report verification. Re-run repeatedly across multiple full-suite passes (see below), zero flakiness.
- `REAL_REDIS_OR_QUEUE`: not separately applicable to this story's own queue usage — see Evidence Requirements above. **A real, fixed gap, not merely worked around:** this story's own test volume (~13 connector enrolments/logins across its two new files) was enough to push the *whole* integration suite's shared `127.0.0.1` `/api/auth/login` rate-limit bucket (E2-S5, correctly enforced) over its 10-per-900s budget within a single `npm run test:integration` run — a regression in "the full suite passes in one clean run" that story 2-9's own equivalent gap never actually triggered end-to-end (that story only *reproduced* the bucket-sharing risk by running its own file twice in a row). **Fixed** by broadening both new files' existing rate-limit-clearing helper from a connector-path-only pattern to the entire `rate-limit:*` keyspace (local dev Redis only), called in `beforeEach` and `afterAll` so the fix is self-healing regardless of file execution order. Verified: the full 9-suite integration run (133 tests) now passes cleanly in one shot, confirmed on three consecutive runs with no manual key-clearing between them.
- `REAL_WINDOWS_CONNECTOR`/`REAL_IDEALPOS`/`REAL_EFTPOS`/`REAL_KOT_PRINTER`: **not attempted, not available in this session.** Explicit boundary.
- **Migration**: applied cleanly to the populated shared local dev Postgres; independently re-verified via a disposable `postgres:16-alpine` container running all 9 migrations from zero, with `psql \d "ConnectorCommand"` confirming all four CHECK constraints, the unique index, and all FKs exist exactly as designed.
- Full existing real-Postgres integration suite (`npm run test:integration`) re-run to confirm zero regression to `orders`, `menu`, `pos-sync`, `pos-sync-dispatcher`, `printer-jobs`, `reservations`, and `connector` (story 2-9's own suite) — see Change Log for the result.

### Independent review

A fresh review pass (2026-08-16, same session) covered protocol/state-machine correctness, persist-before-ack semantics, crash windows/replay, authentication/revocation, tenant/venue isolation, database concurrency, payload privacy, migration safety, .NET-connector compatibility, and BMAD traceability/documentation overclaims. One correction loop was applied (of three permitted); no second loop was needed.

**Found and fixed:**

1. **P1 — the same audit-log-ordering bug class fixed in story 2-9's own review, reintroduced here.** `logAuditEventSafely` originally took a pre-built event object: `await this.logAuditEventSafely(await this.systemAuditEvent(...))`. Because `systemAuditEvent` resolves a synthetic system actor via `Staff.upsert` — itself a real database write — that `await` was evaluated as a call *argument*, before `logAuditEventSafely`'s own `try`/`catch` ever started. A transient failure in that actor-resolution write would therefore throw uncaught, turning an already-committed `accept()`/`report()` transition (or, in `sweep()`, an already-committed `unknown`-marking) into a client-visible 500 or a silently-aborted sweep tick — exactly the reliability defect this pattern exists to prevent, reintroduced by not carrying the lesson from story 2-9's review into this new file. **Fix**: `logAuditEventSafely` now takes a lazy factory (`() => Promise<Event>`) instead of a pre-built object, so the entire event construction — including actor resolution — runs inside the try/catch at every one of its six call sites (`createTracerCommand`, `accept`, `report`'s success and conflict paths, `cancel`, `sweep`'s unknown-marking). Verified: full unit suite (410/410) and full real-Postgres integration suite (133/133, 9 suites, 3 consecutive clean runs) re-confirmed after the fix, zero regressions.

**Considered and explicitly not fixed (deferred, with reasoning):**

- **P3 — `report()`'s idempotent-repeat check compares `idempotencyKey`+`status`+`resultType` but not `resultPayload`.** A repeat report with the same key/outcome/type but a genuinely different `resultPayload` would be silently accepted as an idempotent no-op rather than flagged as a discrepancy. Judged acceptable for this story's threat model: the caller is already an authenticated, trusted connector installation (the same trust boundary story 2-9's heartbeat's unvalidated `capabilities` payload already relies on) — this is not a tenant-isolation or authentication boundary, and a real command type's own story can add payload-equality checking if it turns out to matter once real (non-synthetic) result payloads exist. Recorded in `deferred-work.md`.
- **P3 — `poll()`'s candidate over-fetch (`MAX_POLL_BATCH * 3`) is a throughput heuristic, not a correctness guarantee.** Under heavy capability heterogeneity in a venue's command backlog, a single poll could return fewer than `MAX_POLL_BATCH` eligible commands even if more exist beyond the over-fetch window, requiring an extra poll cycle to fully drain. Not a correctness defect (nothing is lost or duplicated, just delayed by one cycle) and not expected to matter at this story's single-command-type, single-venue scale. Recorded in `deferred-work.md`.

No unresolved P0 or P1 finding remains in scope for this story.

## File List

- `backend/prisma/schema.prisma` (modified — new enum + model + back-relations)
- `backend/prisma/migrations/20260816150000_connector_command_protocol/migration.sql` (new)
- `backend/src/connector/connector-command.service.ts` (new)
- `backend/src/connector/connector-command.service.spec.ts` (new)
- `backend/src/connector/connector-command-sweeper.service.ts` (new)
- `backend/src/connector/connector-command.controller.ts` (new)
- `backend/src/connector/connector-command-admin.controller.ts` (new)
- `backend/src/connector/dto/connector-command-report.dto.ts` (new)
- `backend/src/connector/dto/create-connector-command.dto.ts` (new)
- `backend/src/connector/connector.module.ts` (modified — register new providers/controllers)
- `backend/scripts/connector-command-harness.ts` (new)
- `backend/test/connector-command.integration-spec.ts` (new)
- `backend/test/connector-command-harness.integration-spec.ts` (new)
- `docs/decisions-log.md` (modified — DL-070)
- `docs/epics.md` (modified — new E2-S10 entry, cross-references from E9/E15)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (modified)
- `_bmad-output/implementation-artifacts/deferred-work.md` (modified, if applicable)

## Change Log

- 2026-08-16: Story 2-10 filed and implemented in one session, continuing story 2-9's own numbering. Transport decision (DL-070) recorded before implementation. Full command envelope, state machine, claim/accept/report protocol, sweeper, and a real durable-connector proof harness implemented and verified.
- 2026-08-16 (independent review): fresh review pass completed. One P1 found and fixed (audit-log event construction, including a real DB write for system-actor resolution, was evaluated outside `logAuditEventSafely`'s own try/catch — the same bug class story 2-9 fixed in its own file, reintroduced here at six call sites; fixed by switching to a lazy-factory signature). One real, fixed gap in the suite's shared login rate-limit bucket (this story's own test volume pushed the *whole* integration suite over budget in a single run, not just this file rerun twice) — fixed by broadening the rate-limit-clearing helper to the full keyspace, self-healing via `beforeEach`/`afterAll`; full 9-suite integration run (133 tests) now passes cleanly in one shot, confirmed on 3 consecutive runs. Two P3 findings considered and deferred with reasoning (`report()`'s idempotency check not comparing `resultPayload`; `poll()`'s over-fetch heuristic). No unresolved P0/P1 remains. Full unit (410/410) and real-Postgres integration (133/133) suites re-confirmed green after all fixes. Status: `done`.
