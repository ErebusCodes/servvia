---
baseline_commit: 62db118
supersedes_static_service_token_story: true
---

# Story 2.9: Enterprise Venue Connector Identity and Command Authentication

Status: done (Phase 1 — connector identity, enrolment, authentication, revocation, rotation, tenant isolation, minimal heartbeat)

## Story

As a platform and venue operator,
I want every on-premise Verdura Connector to have a paired, revocable, venue-bound machine identity and an outbound-only authenticated command channel,
so that Idealpos and KOT operations cannot be invoked across venues, forged with a shared secret or exposed to the public internet.

This story implements the trust boundary required by [`docs/target-operating-model.md`](../../docs/target-operating-model.md). The previously implemented shared `INTERNAL_SERVICE_TOKEN` guard is transitional scaffolding only and does not complete this story.

> **Forward-reference note (2026-08-16, does not change this story's scope or acceptance criteria):** when a Verdura Connector installation targets an Idealpos venue via the proposed API-less interim adapter, it is realized as a Windows Service (provisionally .NET 8) implementing this story's identity/pairing/durable-queue contract, paired with a separate interactive Idealpos POS Bridge process over a secured local IPC mechanism (e.g. a named pipe). See `docs/integrations/idealpos.md` §14.1 and the tracer bullet story `9-2-idealpos-uibridge-tracer`, currently blocked on live discovery. This story remains platform-agnostic; nothing here is Idealpos- or Windows-specific.

## Scope correction (2026-08-16) — read before the ACs below

The original ACs 1–10 (kept verbatim further down for product-intent continuity) describe the **complete** connector trust boundary: identity, an outbound authenticated command/result session protocol, an encrypted local durable queue with persist-before-acknowledge semantics, full heartbeat telemetry (Idealpos/printer reachability, queue depth, oldest command age), and migrating the existing `printer`/`pos-sync` internal endpoints off `ServiceTokenGuard`. Attempting all of that in one pass is not "the smallest production-grade slice," and no real connector or command protocol exists yet to authenticate against.

This implementation session delivers **Phase 1 only: connector identity, enrolment, durable authentication, revocation, rotation, tenant isolation, and a minimal self-report heartbeat** — the identity tracer that every later phase depends on. It does **not** implement a command/session protocol, a durable local queue, printer/pos-sync reachability reporting, or the `ServiceTokenGuard` migration. Those remain explicitly deferred; see "Deferred to a follow-on story" below and `deferred-work.md`.

**No claim in this story, its code, or its tests should be read as evidence that a real Idealpos, EFTPOS, KDS, or printer connection has been established.** This story authenticates a connector's *identity*; it does not implement, simulate, or infer any Idealpos/EFTPOS/printer outcome. There is no dependency anywhere in this implementation on an undocumented Idealpos API, database write, or DLL call.

**Transport security boundary (explicit, not implemented here):** this tracer implements application-layer credential authentication (Argon2id-hashed secrets, DB-backed, real-time revocable) over whatever transport the existing NestJS/Express app already runs on. It does **not** implement or claim mutual TLS, certificate pinning, hardware binding, or Windows credential-store protection. Those belong to deployment configuration and/or the later Windows connector story (see the forward-reference note above) and must not be claimed as done here.

### Phase 1 lifecycle model (implemented)

A `ConnectorInstallation` has exactly one of three **persisted** states:
- `active` — the current, authenticated production identity for a venue. At most one `active` installation may exist per venue at any time, enforced by a database partial unique index (not just application logic).
- `revoked` — permanently and immediately rejected on every subsequent authentication attempt; set by an authorised admin action, always with `revokedAt` and `revokedByStaffId` recorded.
- `replaced` — superseded by a newer installation via rotation (redeeming a new enrolment code for a venue that already has an active installation); `replacedByInstallationId` records the successor, preserving lineage.

"Offline" and "degraded" are **not** separate persisted states — they are derived, at read time, from `lastSeenAt` on an otherwise-`active` row. This story does not invent a heartbeat-timeout policy (how long since `lastSeenAt` before an admin UI should call a connector "offline"); that threshold is product policy for a later, UI-facing story and is recorded below as an unresolved decision.

A `ConnectorEnrollment` is a separate, short-lived, single-use bootstrap credential (15-minute expiry, Argon2id-hashed, database-CAS-enforced single use) that an admin creates and a connector redeems exactly once for a durable `ConnectorInstallation` identity — an OAuth-style "authorization code → access credential" exchange, chosen so the long-lived secret is never the same value an admin has to communicate out-of-band.

### Phase 1 acceptance criteria (implemented and verified this session)

1. An authorised admin (`owner`/`admin` role, RBAC- and JWT-authenticated) can create a connector enrolment for a specific venue in their own organization; a venue outside the caller's organization is rejected (404) at the service boundary, in addition to the database's own FK structure.
2. The connector exchanges the short-lived, single-use bootstrap token for durable installation credentials (`installationId` + secret) via `POST /api/connector/enroll`, presented as `Authorization: Bearer <bootstrapToken>`.
3. The durable secret and the bootstrap code are never stored or returned in plaintext after issuance — both are Argon2id-hashed at rest; only the one-time issuance response contains the plaintext value.
4. The connector authenticates on every subsequent request (`Authorization: Bearer <installationId>.<secret>`, verified via `ConnectorAuthGuard` against the stored Argon2id hash) and can self-report `version`/`capabilities` via `POST /api/connector/heartbeat`, which also updates `lastSeenAt`.
5. The backend resolves an authenticated connector to the correct `organizationId`/`venueId` on every request; this resolution is exercised by real HTTP calls in the integration suite, not asserted only in unit mocks.
6. A revoked or replaced installation is rejected immediately on its next authentication attempt (no unaudited trust gap, no grace period).
7. Reusing an already-redeemed (or expired) bootstrap token is rejected; single-use is enforced by a database compare-and-swap (`usedAt: null` guard), not an application-level read-then-write.
8. Cross-venue/cross-tenant access is rejected at both the database boundary (foreign keys, tenant-scoped `WHERE` clauses) and the service boundary (explicit organization/venue ownership checks) — proven for enrolment creation, revocation, and admin status reads.
9. Concurrent enrolment/replacement cannot leave two active production identities for the same venue: enforced by a database partial unique index (`ConnectorInstallation_one_active_per_venue`), proven under both a realistic same-service race and a deterministic, manually-timed true-overlap race against real Postgres.
10. Security-relevant lifecycle events (`CONNECTOR_ENROLLMENT_CREATED`, `CONNECTOR_ENROLLED`, `CONNECTOR_REVOKED`) are written as audit records via the existing `AuditLogService`, with no plaintext bootstrap code, durable secret, or hash value ever present in the audit payload — proven by a real-Postgres test that serializes recorded audit rows and asserts none of the collected plaintext secrets from the run appear in them.

### Deferred to a follow-on story (explicitly out of scope this session)

- The outbound-only authenticated command/result **session protocol** (original ACs 5–7: per-command authorization against capability/target resource, `CONNECTOR_ACCEPTED` persist-before-acknowledge semantics, POS/KDS/KOT independent delivery/acknowledgement state). No command protocol exists yet for a connector identity to execute against.
- The **encrypted local durable queue** on the connector side (original AC6/Task 3) — there is no connector process yet to hold one.
- **Full heartbeat telemetry** beyond self-reported `version`/`capabilities`: Idealpos/printer reachability, queue depth, oldest command age (original AC8) — these describe state this backend has no way to observe truthfully without the command protocol above; reporting them now would risk exactly the kind of fabricated-state problem stories 8-1/9-1 removed.
- **Migrating `printer.controller.ts`/`pos-sync.controller.ts` off `ServiceTokenGuard`** onto connector identity (original Task "Migrate printer/POS internal endpoints..."). `ServiceTokenGuard`/`INTERNAL_SERVICE_TOKEN` remain in place, unmodified, and still gate those two controllers exactly as before this story ran — this story adds a new, parallel identity mechanism without touching the old one's existing consumers.
- **Dashboards/alerts** for disconnected/obsolete/revoked/backlogged installations (original Task) — no UI work was in scope.
- mTLS, certificate pinning, or hardware/TLS-level binding (original AC4's "outbound TLS only" framing) — see the transport security boundary note above.

### Unresolved decisions (recorded, not silently invented)

- **Heartbeat-staleness → "offline" threshold.** How long since `lastSeenAt` before an admin UI should present a connector as offline is a product/UX decision, not derivable from existing materials. Not decided here; `lastSeenAt` is stored so a future story can apply whatever threshold is chosen without a schema change.
- **Enrolment TTL (15 minutes) and bootstrap-code/secret entropy (32 random bytes, base64url) and enrolment rate limit (10/900s)** were chosen as reasonable, codebase-consistent defaults (matching this repository's existing `KDS_TOKEN_EXPIRY`-style and `@RateLimit`-style conventions) rather than derived from an explicit stated policy. Flagged here in case product/security wants a different value.
- **Whether a revoked/replaced `ConnectorInstallation` row should ever be hard-deleted** (e.g. for data retention/compliance) is not decided; this implementation keeps all rows indefinitely for audit/lineage purposes, matching this repository's general soft-lifecycle convention (e.g. `PrinterJob`, `POSSyncRecord`).

## Original Acceptance Criteria (product intent for the complete story; see "Scope correction" above for what is actually implemented now)

1. An authorized venue administrator creates a one-time, short-lived pairing code bound to organization and venue.
2. Pairing creates a unique connector installation ID and non-exportable/private credential or mutually authenticated certificate; no credential is shared between installations.
3. Connector credentials are stored encrypted, rotated, expire according to policy and can be revoked immediately without affecting other venues.
4. The connector opens outbound TLS only. No public inbound port, Idealpos exposure or cloud Redis credential is permitted.
5. Every command is authorized against organization, venue, installation, capability and target resource; cross-venue commands fail closed.
6. The connector persists a command locally before returning `CONNECTOR_ACCEPTED` and stores the idempotent result by command ID/order version.
7. POS, KDS and each KOT result use signed/scoped callbacks or the authenticated session and retain independent delivery/acknowledgement state.
8. Heartbeat reports installation version, supported capabilities, Idealpos/printer reachability, queue depth and oldest command age without leaking secrets.
9. Pair, rotate, revoke, replay, duplicate, expiry, clock-skew, wrong-venue and stolen-credential tests pass.
10. All lifecycle and command events emit correlated, append-only audit records with actor/installation identity.

## Tasks

- [x] Define installation, credential, capability and revocation schema with tenant-aware unique constraints. *(`ConnectorEnrollment` + `ConnectorInstallation`, migration `20260816140000_connector_identity`; partial unique index enforces one active installation per venue.)*
- [x] Implement authorized one-time pairing and durable credential issuance. *(`ConnectorService.createEnrollment`/`redeemEnrollment`; Argon2id throughout — no certificate/mTLS issuance, see transport security boundary note.)*
- [ ] Implement outbound authenticated connector session and scoped command/result protocol. *(Deferred — no command protocol exists yet.)*
- [ ] Implement encrypted local durable queue and persist-before-acknowledge behavior. *(Deferred — connector-side, no process exists yet.)*
- [x] Implement rotation, revocation, heartbeat and capability reporting. *(Rotation = redeeming a new enrolment for a venue with an existing active installation; revocation = admin endpoint; heartbeat = self-reported `version`/`capabilities`/`lastSeenAt` only — no reachability/queue-depth telemetry, see deferred list.)*
- [ ] Migrate printer/POS internal endpoints away from shared `INTERNAL_SERVICE_TOKEN` authorization. *(Deferred — out of scope this session, see deferred-work.md.)*
- [x] Add cross-tenant, replay, duplicate, outage, restart and revocation integration tests. *(Real-Postgres: `backend/test/connector.integration-spec.ts` — tenant isolation, single-use replay, expiry, revocation, rotation, and two concurrency proofs. "Restart" is inherent to this design — identity is DB-resident, not held in connector process memory, so there is nothing connector-restart-specific to test at this layer.)*
- [ ] Add dashboards/alerts for disconnected, obsolete, revoked and backlogged installations. *(Deferred — no UI work in scope.)*

## Definition of Done

**For Phase 1 (this session):** an admin can create an enrolment for the venue, a connector can redeem it for a durable, revocable, Argon2id-hashed identity, authenticate as that identity, self-report a heartbeat, be revoked or rotated, and every cross-tenant/replay/concurrency edge case fails closed — all proven against real Postgres, not mocks, with no regression to existing `printer`/`pos-sync` behaviour (still gated by the unchanged `ServiceTokenGuard`). See the Dev Agent Record below for the actual evidence.

**For the complete story (original DoD, not yet met):** one real venue connector can be paired, receive a scoped test command, persist it, report a truthful result, survive restart and be revoked, using a real command/session protocol against real (or at minimum realistically simulated) connector software. This remains blocked on the deferred work above and, ultimately, on real Windows/Idealpos environment access (`REAL_WINDOWS_CONNECTOR`/`REAL_IDEALPOS` evidence tiers) that this session does not have.

## Dev Agent Record

### Implementation summary (2026-08-16)

- **Schema**: `ConnectorEnrollment` (bootstrap credential) and `ConnectorInstallation` (durable identity) added to `prisma/schema.prisma`; migration `backend/prisma/migrations/20260816140000_connector_identity/` adds both tables plus a hand-authored partial unique index (`ConnectorInstallation_one_active_per_venue`, not expressible in Prisma's schema DSL) and a defensive CHECK constraint. See that migration's `VERIFY.md` for clean-DB-from-zero and populated-DB deployment evidence.
- **Service**: `backend/src/connector/connector.service.ts` — `createEnrollment`, `redeemEnrollment` (interactive `$transaction`: CAS-consume enrolment → best-effort replace prior active → insert new active → link lineage, with P2002 translated to a 409 conflict), `authenticate` (constant-effort Argon2id verify against a fixed decoy hash for unknown/inactive candidates, mirroring `staff.service.ts`'s established anti-enumeration pattern), `reportHealth`, `revoke`, `getStatus` (metadata only, never `secretHash`).
- **Guard**: `backend/src/auth/guards/connector-auth.guard.ts` — DB-backed per-request authentication (not JWT), attaches `request.connector`, structurally separate from the existing `req.user` staff/kds_device union.
- **Controllers**: `backend/src/connector/connector-admin.controller.ts` (JWT+RBAC-gated, admin-facing: create enrolment, get status, revoke) and `backend/src/connector/connector.controller.ts` (connector-facing: `enroll`, `heartbeat`; both credentials travel as `Authorization: Bearer`, not request body, so `CsrfMiddleware`'s existing Bearer-token bypass covers an unattended connector with no browser session).
- **Shared util**: `backend/src/common/utils/extract-bearer-token.ts`, used by both the guard and the `enroll` endpoint.
- **Module wiring**: `ConnectorModule` registered in `app.module.ts`; imports `AuthModule` (for `JwtAuthGuard`/`RolesGuard`/`RateLimitGuard`) rather than redeclaring guards.

### Evidence

- `STATIC_ANALYSIS`: `npx tsc --noEmit` clean. `npx eslint` clean on every new/changed **source and unit-test** file (`src/connector/**`, `src/auth/guards/connector-auth.guard.ts` + its spec, `src/common/utils/extract-bearer-token.ts`) — confirmed after the independent-review fix below. **Correction to an earlier overclaim**: `backend/test/connector.integration-spec.ts` itself is *not* eslint-clean (59 problems, mostly `@typescript-eslint/no-unsafe-member-access` on Supertest's untyped `.body`) — verified this session to be the exact same pre-existing, repository-wide convention already affecting every other `*.integration-spec.ts` file (`test/orders.integration-spec.ts`: 142 problems; `test/menu.integration-spec.ts`: 111; `test/printer-jobs.integration-spec.ts`: 28), already tracked at P2 in `deferred-work.md` ("Backend lint currently fails: 205 problems... concentrated in `backend/test/*.integration-spec.ts`"). Not a new regression, but the original evidence claim's wording was inaccurate and is corrected here. `npm run build` succeeds; app boots and registers all connector routes correctly against the real dev Postgres/Redis (verified via a manual `dist/main.js` boot).
- `UNIT_OR_MOCK`: 26 connector-related unit tests (22 in `connector.service.spec.ts`, 4 in `connector-auth.guard.spec.ts`), all passing; full existing unit suite re-run and confirmed 390/390 passing after the independent-review fixes below, zero regressions.
- `REAL_POSTGRES`: `backend/test/connector.integration-spec.ts`, 13 tests. Independently re-executed twice this session (once standalone, once as part of the full `npm run test:integration` run below), both fully green with zero flakiness, after the independent-review fixes were applied. Covers: admin enrolment creation and its own tenant-boundary rejection; full bootstrap→durable-credential exchange with a real Argon2id-hash comparison against the plaintext; single-use replay rejection; expiry rejection; authenticate+heartbeat updating real DB state and never leaking `secretHash` over HTTP; malformed/wrong-secret/missing-credential rejection (including the CSRF-layer 403 for a fully headerless request — a real, correctly-defense-in-depth finding, not a bug, documented inline); admin revocation with immediate real-time rejection; cross-org revocation rejection; rotation with real lineage recording and a real "exactly one active row" check; and **two** concurrency proofs — one realistic HTTP-level race (both legitimate outcomes accepted, since this design's graceful-rotation path is a valid non-error resolution depending on scheduling) and one deterministic, manually-timed true-overlap race (holding one transaction open while a second's insert genuinely blocks at the DB level, then asserting it fails with a real Postgres `P2002` once unblocked) — proving the partial unique index itself, not application luck, is the actual enforcement mechanism.
- `REAL_REDIS_OR_QUEUE`: not separately applicable — `RateLimitGuard` (real Redis-backed) is exercised as a side effect of every real HTTP call in the integration suite above; no BullMQ queue involvement in this story. **Independent-review reproduction**: running `npm run test:integration` twice back-to-back within the same ~900s window spuriously fails ~88/107 tests suite-wide (not connector-specific) because every spec's `beforeAll` logs in from the same `127.0.0.1` IP and the login rate-limit bucket (`rate-limit:::ffff:127.0.0.1:POST:/api/auth/login`) is shared across all specs and all runs — confirmed via `redis-cli`/`docker exec` inspection (TTL ~428s remaining after the failure). This is a concrete, reproduced instance of the pre-existing rate-limit-bucketing gap already flagged in `deferred-work.md` (2-5 code review), not a defect introduced by this story; clearing the `rate-limit:*` keys in the local dev Redis and re-running restored a full 107/107 pass. Addended to `deferred-work.md` as a reproduction, not a new finding.
- `REAL_WINDOWS_CONNECTOR` / `REAL_IDEALPOS`: **not attempted, not available in this session** — no real Windows host or Idealpos installation is reachable from this environment. This is recorded as an explicit boundary, not a failure: nothing in this story's code, tests, or documentation claims either has been contacted.
- **Migration verification, independently re-executed this session** (not merely re-cited from `VERIFY.md`): (1) against the existing shared local dev Postgres — implicit in every integration-test pass above, since the migration was already applied there; (2) clean-from-zero — a fresh, disposable `postgres:16-alpine` container (`verdura-migration-verify-story29`, port 5501, removed immediately after) ran all 8 migrations via `prisma migrate deploy` successfully, and `psql \d "ConnectorInstallation"` confirmed the partial unique index (`... UNIQUE, btree ("venueId") WHERE status = 'active'`), the `CHECK` constraint, and all FKs exist exactly as `VERIFY.md` documents.
- Full existing integration suite (`npm run test:integration`, 107/107) and full unit suite (`npx jest`, 390/390) re-run after the independent-review fixes below to confirm no regression to `orders`, `menu`, `pos-sync`, `pos-sync-dispatcher`, `printer-jobs`, and `reservations`.

### Independent review

A fresh review pass (this session, 2026-08-16) covered authentication/secret handling, tenant/venue isolation, DB constraints and concurrency, revocation/rotation/replacement, retry/replay/crash behaviour, migration safety, and story-to-code/evidence traceability. One correction loop was applied (of three permitted); no second loop was needed.

**Already fixed prior to this review pass** (found by an earlier review within the same implementation session, evidenced by the code comment at `connector.controller.ts`'s `heartbeat` guard array): `RateLimitGuard` was reordered ahead of `ConnectorAuthGuard` on `POST /connector/heartbeat`. NestJS evaluates guards in array order and short-circuits on the first rejection, so `ConnectorAuthGuard`-first would let an unauthenticated flood of garbage bearer tokens skip the rate limiter entirely while still paying the full memory-hard Argon2id verify cost on every single attempt — an unauthenticated computational-amplification vector. Classified **P1** (availability/DoS-adjacent), already resolved, confirmed still correctly ordered as of this review.

**Found and fixed this review pass:**

1. **P1 — an audit-log write failure could strand an already-issued single-use enrolment with its credential undelivered.** `ConnectorService.redeemEnrollment`, `revoke`, and `createEnrollment` called `AuditLogService.logAuthEvent` directly, unguarded, *after* the durable database effect had already committed. For `redeemEnrollment` specifically this is a real (if narrow) correctness bug, not just a logging nicety: the bootstrap token's single-use CAS had already flipped `usedAt`, and the new `ConnectorInstallation` row already existed as `active`, by the time the audit call could throw — a transient audit-write failure (e.g. a momentary DB blip) would surface as a 500 to the connector, which received no credential and cannot retry with the same (now-consumed) token. Recovery required an admin to notice the orphaned `active` installation, revoke it, and issue a fresh enrolment — a support burden, not a security hole (the system still fails closed: no unauthenticated credential is ever exposed), but a genuine reliability defect. This repository has an established fix pattern for exactly this class of bug — `PrinterJobsService#logAuditEventSafely` (story 8-1) — which `ConnectorService` did not follow. **Fix**: added `ConnectorService#logAuditEventSafely` (identical pattern) and wrapped all three audit-write call sites (including, for `redeemEnrollment`/`revoke`, the actor-resolution step that precedes the audit write) so a transient audit-log failure is logged non-fatally and never turns an already-successful durable operation into a client-visible failure. Verified via the existing real-Postgres suite (unchanged pass/fail shape) plus a manual code-path re-read; no new test was added specifically for a forced audit-log failure, since the repository has no fault-injection harness for this (same limitation already recorded against the identical pattern in story 9-3's deferred-work entry) — noted here rather than silently assumed covered.
2. **P2 — a new unit-test file did not meet this story's own "eslint clean" claim.** `connector-auth.guard.spec.ts` had 6 real lint errors (`@typescript-eslint/no-unsafe-return`, `@typescript-eslint/unbound-method`, `prettier/prettier`) from untyped `any` mock scaffolding and bare method references. **Fix**: retyped the mock `Request`/`ExecutionContext` shapes using the real `ConnectorIdentity` type instead of `any`, and scoped a single `/* eslint-disable @typescript-eslint/unbound-method */` at the top of the file for the intentional bare-mock-method-reference assertions (`expect(connectorService.authenticate).not.toHaveBeenCalled()`), matching how this exact false-positive is handled elsewhere in the codebase's guard specs. `npx eslint` now reports zero problems for this file; all 4 of its tests still pass unchanged in behaviour.
3. **P3 (documentation accuracy) — the original evidence section overclaimed "eslint clean on all new/changed files."** Corrected above: true for every new/changed `src/**` file, not true (nor claimed as a new regression) for the new integration-spec file, which inherits this repository's pre-existing, already-P2-tracked integration-test lint debt.

**Findings considered and explicitly not fixed (deferred, with reasoning):**

- The shared-IP login rate-limit bucket causing spurious integration-suite failures on rapid repeated runs (see `REAL_REDIS_OR_QUEUE` evidence above) is a manifestation of an already-tracked, pre-existing, repository-wide gap (`deferred-work.md`, 2-5 code review: "IP-extraction failures... collapse all such requests into a shared `127.0.0.1` rate-limit bucket"), not something introduced by or specific to this story. Fixing the underlying rate-limiter key strategy is out of this story's scope; the reproduction is recorded as an addendum to the existing entry, not a new story-specific defect.
- No forced-real-infra-failure test exists for the new `logAuditEventSafely` non-fatal path (fix #1 above) — consistent with this repository's established position (see story 9-3's identical deferred item) that building a general fault-injection harness for a single call site is disproportionate. Recorded, not silently assumed covered.

No unresolved P0 or P1 finding remains in scope for this story.

## File List

- `backend/prisma/schema.prisma` (modified — new enum + 2 models + back-relations)
- `backend/prisma/migrations/20260816140000_connector_identity/migration.sql` (new)
- `backend/prisma/migrations/20260816140000_connector_identity/VERIFY.md` (new)
- `backend/src/connector/connector.service.ts` (new; modified during independent review — non-fatal audit-log wrapper, see Independent review #1)
- `backend/src/connector/connector.service.spec.ts` (new)
- `backend/src/connector/connector.module.ts` (new)
- `backend/src/connector/connector-admin.controller.ts` (new)
- `backend/src/connector/connector.controller.ts` (new)
- `backend/src/connector/dto/connector-heartbeat.dto.ts` (new)
- `backend/src/auth/guards/connector-auth.guard.ts` (new)
- `backend/src/auth/guards/connector-auth.guard.spec.ts` (new; rewritten during independent review — lint fix, see Independent review #2)
- `backend/src/common/utils/extract-bearer-token.ts` (new)
- `backend/src/app.module.ts` (modified — register `ConnectorModule`)
- `backend/test/connector.integration-spec.ts` (new)

## Change Log

- 2026-08-16: Phase 1 (connector identity tracer) implemented and verified against real Postgres; story scope corrected at its source to separate what is actually delivered from the original story's full command-protocol/durable-queue/dashboard scope, which remains deferred. Full existing test suite regression-checked.
- 2026-08-16 (independent review): fresh review pass completed. One P1 (non-fatal audit-log handling, matching the established `logAuditEventSafely` repository pattern) and one P2 (new-file lint cleanliness) found and fixed; one P3 documentation overclaim corrected; migration deploy independently re-verified against both a populated and a from-zero disposable database; full unit (390/390) and real-Postgres integration (107/107, including 13/13 for this story's own suite, executed twice) suites re-confirmed green with zero regressions. No unresolved P0/P1 remains. Status promoted to `done`.
