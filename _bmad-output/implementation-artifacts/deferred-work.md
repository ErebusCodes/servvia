# Deferred Work

## Session handoff snapshot (2026-08-28, end of session — DL-107 second PLU batch)

Quick-orientation pointer for the next session — full detail lives in
`docs/windows-production-deployment.md` and
`_bmad-output/implementation-artifacts/dl-107-dunedin-live-certification-runbook.md`
§1l, not duplicated here.

- **Canonical Windows repo:** `C:\Users\Posmate\Documents\verdura_MVP`,
  `HEAD` = `d5a40fbe2f32f98c4e21da2e59296aa6560acbcc`, matching Mac `HEAD`
  and GitHub `origin/main` exactly. Tracked tree clean. CI green.
- **PLU mapping coverage: 9/70 curated items mapped, 61 unmapped** (DL-107
  §1j/§1l). Next three ready-to-apply candidates (deferred, not yet
  applied, human sign-off still required per mapping):
  Halloumi Loaf→705, Greek Eggplant & Lamb Moussaka→673, Mighty Angus Beef
  Burger→679. Falafel Plate/667 stays excluded pending human resolution of
  the 667 ("FALAFEL SALAD") vs 761 ("FALAFEL SALAD/ PLATE") content
  mismatch — see runbook §1k.
- **Live Bridge/IdealPOS-SQL credential access was blocked by the
  tool-permission classifier this session** for both the Bridge `ApiKey`
  (authenticated `GET /api/health`/`/api/products`) and the IdealPOS SQL
  vault password — any attempt to read or transmit either was refused.
  Preconditions for §1l's batch were instead satisfied from same-day
  secondary evidence (service status, logs, §1k's own fresh live check)
  under explicit operator direction. **The next session doing further PLU
  work or live Bridge verification will likely need a different approved
  access method** (e.g. the operator supplying the credential directly, or
  a permission rule change) rather than assuming the same workaround path
  is available.
- **Production services (all healthy at session end):** `VerduraAPI`
  (3000), `VerduraConnector`, `VerduraIdealposBridgeSvc`,
  `VerduraPostgreSQL` (5432) all `SERVICE_RUNNING`; Redis (Docker, 6379)
  healthy; `VerduraOrderTablet` (5176)/`VerduraAdminConsole` (5177)/Window
  Display (5174) unchanged from prior session's verified state.
- **`TableAssignmentStrategy=NoHint` / `TableAssignmentConfirmed=false`
  remain unresolved** — no live table-assignment discovery was performed
  this session (explicitly out of scope). Still blocks §4 of the DL-107
  runbook (the live-order certification procedure).
- **No real KOT transport and no live end-to-end order certification
  exist yet** — unchanged from prior sessions; nothing this session
  changed that status either way.
- **Retired rollback checkout (do not delete yet):**
  `C:\Users\Posmate\Documents\verduraBridge\VerduraServer.retired-<timestamp>`
  — zero active references, see the dedicated deferred item below.
- **Outstanding P1 (do not fix without explicit instruction to start):**
  `RateLimitGuard`/health-probe Redis-outage hang — see the dedicated
  entry below for exact required scope.
- **IdealPOS/production-order safety:** no live order or KOT may be
  submitted/triggered without explicit authorization in the session that
  does it: this applies to every future session, not just this one.

## Deferred from: Redis Docker/reboot outage incident response (2026-08-27)

- **RESOLVED 2026-08-27: Redis/Docker reboot persistence.** A Windows
  reboot left Docker's engine down and production Redis unreachable,
  requiring manual SSH-driven recovery. Fixed with a permanent `Verdura
  Redis Startup` Scheduled Task (`AtLogOn` for Posmate) running
  `verduraBridge\VerduraServerOps\ensure-verdura-redis.ps1`, plus
  `docker update --restart=no` on the two dev-only containers
  (`verdura-postgres-1`, `verdura-local-postgres`) that had been
  auto-starting alongside Redis. Verified end-to-end across a real,
  controlled reboot. Full detail: `docs/windows-production-deployment.md`
  §8.
- **NOT resolved — tracked separately: the code-level hang defect.** The
  reboot fix above makes the Redis-down window far shorter and fully
  self-healing, but does not change what happens *during* that window:
  `RateLimitGuard` (`apps/api/src/auth/guards/rate-limit.guard.ts`) awaits
  `redis.eval()` on `REDIS_CLIENT`, which `redis.module.ts` configures
  with `maxRetriesPerRequest: null` (correct for BullMQ, wrong for a
  bounded per-request guard) — so a Redis outage still hangs every
  guarded HTTP request (including the public menu) indefinitely rather
  than failing fast. `HealthService`'s own `HEALTH_REDIS` client
  (`health.module.ts`) has no bounded timeout either, relying on
  ioredis's slow default retry ceiling instead of failing fast. Neither
  has been changed. Needed: a bounded timeout/fail-fast strategy for
  request-path Redis use (without weakening BullMQ's own
  `maxRetriesPerRequest: null` requirement), an explicit documented
  fail-open/fail-closed policy for rate limiting under a Redis outage, a
  short bounded timeout on the health probe, and regression tests proving
  neither the menu nor `/api/health` can hang when Redis is down. Owner:
  backend. Priority: P1 (directly caused a real production outage
  tonight; the reboot-persistence fix reduces likelihood, not impact).

## Deferred from: Windows runtime migration to `verduraBridge` (2026-08-27)

- **RESOLVED 2026-08-27 (superseded same day): legacy Windows Verdura
  clone relocated from Desktop to Documents.** Then, later the same day,
  `C:\Users\Posmate\Documents\verdura_MVP` was reconciled to current
  `main` and promoted to the sole active application checkout — see
  `docs/windows-production-deployment.md` §5. This entry stays for
  history only; do not re-apply its now-superseded "legacy, do not use"
  characterization.
- **Permanently delete the retired duplicate checkout once production has
  run stably from `verdura_MVP`.** Currently preserved (not deleted) at
  `C:\Users\Posmate\Documents\verduraBridge\VerduraServer.retired-<timestamp>`
  as a rollback path — audited before retirement (zero unique required
  content; historical debug/bootstrap scripts already preserved into
  `verdura_MVP\_preserved-from-VerduraServer\`). No production reference
  remains to it (confirmed via NSSM/scheduled-task/script/process scan).
  Owner: whoever confirms `verdura_MVP` has been stable through at least
  one full production day/reboot cycle. Priority: P3, no functionality
  blocked on it.
- **Migrate `VerduraPostgresBin` and `verduradb` into `verduraBridge`,
  matching the rest of the Windows runtime layout.** Currently deferred at
  `C:\Users\Posmate\Documents\VerduraPostgresBin` and
  `C:\Users\Posmate\Documents\verduradb`. A combined maintenance plan has
  been drafted (backup/validate, service shutdown, filesystem move with
  count/size verification, service `binPath`/`pg-backup.ps1` path updates,
  restart, connectivity/health verification, rollback plan) but is
  **plan-only — not executed.** Requires an explicit approved maintenance
  window; PostgreSQL must not be stopped and neither directory may be moved
  before that approval. Full plan: `docs/windows-production-deployment.md`
  §7 (baseline recorded 2026-08-27: PostgreSQL 18.6, `pg_isready` and
  `GET /api/health` both healthy).

## Deferred from: Story 9-2 discovery-tracer independent review session (2026-08-16)

Story 9-2 remains `blocked` (gate: `REAL_WINDOWS_CONNECTOR + REAL_IDEALPOS_UI_DISCOVERY evidence required`) — see the story file for the full outcome. Two items considered during its fresh independent review and deliberately not fixed, with reasoning recorded at the time (also in the story's own Dev Agent Record):

- **`windows-connector/src/VerduraIdealposTracer.Core/Discovery/DiscoveryTraceResult.cs`'s `Diagnostics` list, and the durable local log it feeds, include Idealpos window titles verbatim with no redaction/allowlist.** This tracer's discovery-only scope never reaches an order/payment screen by design, and the expected profile (Idealpos's table-selection screen) is not expected to carry sensitive content in its title — but this is unverified against a real installation (no live access this session), and no defense-in-depth redaction backstop exists. Owner: whoever implements the real order-entry tracer, which will need a deliberate diagnostic-sanitization policy regardless (real order/item content will legitimately flow through that tracer's own logs). Priority: P2 for that future story — not fixed here because building a speculative redaction heuristic without real window-title samples to validate against risks hiding genuinely useful diagnostic information for no proven benefit, and this story's own scope structurally cannot reach the screens where the risk would materialize.
- **`windows-connector/src/VerduraIdealposTracer.Windows/WindowsUiAutomationClient.cs`'s `IsBusy` check always returns `false`** — no busy-state control has been discovered yet to check against (live-discovery checklist item G). Disclosed in the source itself as a known gap, not a verified fact; a modal progress dialog (if Idealpos shows one) is still caught separately by `HasModalChildWindow`. Owner: whoever completes live discovery and implements the real check. Priority: P3.

## P0 work introduced by the 2026-08-16 Idealpos local-evidence and API-less adapter planning session

These items gate the API-less Idealpos adapter path specifically (they do not gate the vendor-supported path, which remains gated by the pre-existing DL-064 items below). See `docs/integrations/idealpos.md` §12–§21, DL-065–DL-068.

- Complete `docs/discovery/idealpos-live-discovery-checklist.md` in full — currently not started. Blocks DL-064 (beyond the truthfulness fix), story `9-2`, and the KDS/KOT suppression decision.
- Resolve the KDS/KOT duplicate-print decision (`idealpos.md` §18, DL-067) once discovery item F is answered — do not silently allow Idealpos to print kitchen tickets for Verdura-originated API-less orders.
- Confirm whether Idealpos or its reseller has a written position on UI-automation-based order entry (discovery item I) before any tracer bullet or pilot proceeds — absent explicit approval, the API-less path is disclosed to the venue operator as Verdura's own engineering risk, not a vendor-endorsed integration.
- Story `9-2` (Idealpos UI-bridge tracer bullet) itself is not started and is blocked on the above plus story `2-9` (connector identity, currently backlog).

## P0 work introduced by the 2026-08-15 operating-model decision

The items below are not discretionary deferrals. They gate any live Idealpos, payment or kitchen rollout and inherit [`docs/target-operating-model.md`](../../docs/target-operating-model.md).

- Confirm Idealpos build, perpetual-licence entitlements, optional modules/subscriptions, supported web-order ingress, item/modifier/table/tax/tender mapping and stable transaction/payment references with Idealpos/Oolio or the reseller.
- Implement canonical immutable order versions, database idempotency and a transactional outbox for POS, KDS and each preparation-station KOT command.
- Implement a paired, revocable, venue-bound connector using outbound mutual TLS and an encrypted local durable queue; remove shared service-token/cloud-Redis edge assumptions.
- Prove the standard path: connector acceptance → Idealpos → Verdura KDS/KOT → existing Idealpos-integrated EFTPOS/cash → payment reconciliation.
- Implement provider-neutral online payment with signed webhooks, replay protection, refunds and Idealpos `PREPAID / ONLINE` mapping before enabling it.
- Implement versioned preparation-station routing and suppress duplicate Idealpos kitchen printing for Verdura-originated orders.
- Build staff-owned reconciliation for uncertain POS outcomes, online-paid/POS-failed cases, amount/tender mismatch, void, refund and reprint.
- Add correlated append-only audit, venue/tenant isolation, separation of duties, connector observability, backup/restore and outage/restart/replay tests.

## Deferred from: Story 6-1 real-PostgreSQL verification session (2026-08-15)

- **`test/menu.integration-spec.ts` leaks `Phase 2 Integration Test Item` / `Phase 2 Integration Test Relative Image Item` MenuItem rows into the shared local dev database on every successful run, not just failures.** Confirmed via `git diff --stat` that this story never touched that file — pre-existing, unrelated test-hygiene gap. Found while running the full real-Postgres integration suite repeatedly to verify Story 6-1's own tests; the leaked rows caused `menu.integration-spec.ts`'s own `toHaveLength(70)` assertion to fail on a subsequent run once enough had accumulated. Manually cleaned from the shared dev database each time it was found (`DELETE FROM "MenuItem" WHERE title IN (...)`); not fixed in code — the test needs a proper `afterEach`/`afterAll` cleanup or a unique-per-run title tag, same pattern already used correctly elsewhere in the integration suite (e.g. `noteTag()` in `orders.integration-spec.ts`). Reproduced again during the 2026-08-15 real-Postgres verification round (`npm run test:integration`, `Phase 4 Integration Unavailable Item` variant); cleaned from the dev DB again, still not fixed in code. Owner: backend/test infrastructure. Priority: P2.
- **No CI pipeline runs `npm run test:integration` (or any test) automatically.** There is no `.github/workflows` directory in this repository. Real-Postgres evidence for Story 6-1 (and everything else) currently depends entirely on a human or agent remembering to start Docker and run the integration suite manually before trusting a change; nothing prevents a future commit from silently breaking database-level idempotency/uniqueness enforcement or reintroducing a concurrency race, since the tests that would catch it never run unattended. Already tracked at the epic level as `1-5-github-actions-ci: backlog`; flagged again here specifically because it is the direct answer to "if idempotency or payment uniqueness were broken in production, which executed gate from this session would detect it?" — the honest answer is none, automatically; detection currently requires someone to re-run this session's manual procedure. Owner: DevOps/platform. Priority: P1.

## Deferred from: Story 8-1 truthful-printer-states implementation session (2026-08-15)

- **The `print-jobs` BullMQ queue is never fed — `PrintJobsProcessor` never runs automatically in production today.** Confirmed via `grep -rn "InjectQueue" backend/src` — the only queue actually injected anywhere in the codebase is `EMAILS`. `OrdersService.persistOrder` creates `PrinterJob` rows (`queued` status) but never calls `.add()` on the print-jobs queue; this is a pre-existing, already-documented gap (`docs/printers.md`'s implementation-status banner), not introduced by Story 8-1. Practical consequence, stated plainly: every truthful-state guarantee Story 8-1 proves (no fabricated `printed`, CAS-guarded crash-window/duplicate handling, production mock lockout) is exercised by tests calling `PrintJobsProcessor.process()`/`PrinterJobsService.requestReprint()` directly — there is currently no running worker consuming real jobs for these guarantees to protect in production, because printing does not happen automatically at all yet. This is the direct answer to Story 8-1's own verification-gap question ("if a kitchen ticket were silently lost or automatically printed twice, which executed gate would detect it?") for the "silently lost" half: today, none — because nothing is trying. Wiring the enqueue call is deliberately out of Story 8-1's scope (a first-time production behavior change, not a truthfulness fix to an already-running path) and should be its own reviewed story once the on-premise connector or an interim dispatch trigger exists. **Confirmed still unresolved and, unlike the sibling `pos-sync` gap above, correctly NOT addressed by story 9-3 (2026-08-16, DL-069): `PrintJobsProcessor` opens a direct cloud-to-LAN TCP socket to `printer.host:printer.port` for `tcp`/`network` printers — wiring this queue as-is would violate target-operating-model.md §8/DL-054. This gap remains genuinely blocked pending a real venue connector (story 2-9 plus a printer-side component) or a separate written decision narrowing production dispatch to network-free connection types.** Owner: backend + the connector work. Priority: P1.
- **No Admin Dashboard or KDS UI surfaces `PrinterJob` state at all.** Confirmed via `grep -rln "PrinterJob" admin-frontend/src kiosk-frontend/src` returning zero matches. Story 8-1's own AC4 calls for this; implemented instead at the API-contract level only (`GET /admin/printers/:id/jobs`, `GET /admin/orders/:id/print-jobs` return the distinct truthful status values), since building a new frontend page is a separate, larger project with no test/evidence expectation anywhere in this session's governing instructions. See the story's own "Scope note" section for full reasoning. Owner: admin-frontend + backend (endpoints already exist). Priority: P2.

## Deferred from: Story 9-1 truthful-POS-sync-states implementation session (2026-08-15)

- **RESOLVED BY STORY 9-3 (implemented and independently reviewed, 2026-08-16): the `pos-sync` BullMQ queue is now fed by a real, tested outbox dispatcher.** `PosSyncDispatcherService` (`backend/src/pos-sync/pos-sync-dispatcher.service.ts`) periodically claims committed `POSSyncRecord` rows via a database-enforced compare-and-swap and enqueues them to the existing `pos-sync` queue, which the already-truthful, already-reviewed `PosSyncProcessor` (story 9-1, confirmed byte-identical/unchanged) now genuinely consumes for the first time. Evidence: 364/364 unit tests, 94/94 real-Postgres integration tests (19 for this story's own suite, including a `REAL_REDIS_OR_QUEUE_WORKER`-tier end-to-end test — the first in this repository to reach that evidence tier for either previously-dormant queue), 6+ consecutive clean repeated runs. One real P0 was found in independent review and fixed: the `pos-sync` queue had no `defaultJobOptions`, which silently broke the dispatcher's own infra-failure safety net (a failed BullMQ job was never removed, so a same-jobId re-add silently no-op'd instead of genuinely re-queuing) — fixed with `attempts`/`backoff`/`removeOnFail`/`removeOnComplete` scoped to the `pos-sync` queue only, proven with a dedicated real-Redis reproduction test. `orders.service.ts` required no logic change (comment only). Full detail: `_bmad-output/implementation-artifacts/9-3-pos-sync-outbox-dispatch.md`. The sibling `print-jobs` gap below is a different risk class and remains NOT resolved by story 9-3 — see DL-069 for why the two were split rather than fixed together. Priority: resolved (was P1).
- **No Admin Dashboard UI surfaces `POSSyncRecord` state at all.** `admin-frontend/src/App.tsx` routes `/pos-sync` to a bare `ModulePlaceholderPage`; confirmed via `grep -rln "posSync|POSSync" admin-frontend/src` returning only that placeholder route/label, no component consuming real data. Implemented instead at the API-contract level only (`GET /admin/venues/:id/pos-sync-records`, `GET /admin/orders/:id/pos-sync`, both JWT/role/venue-scoped), matching Story 8-1's identical precedent and reasoning (building a new frontend page is separate, larger scope with no test/evidence expectation in this story). Owner: admin-frontend + backend (endpoints already exist). Priority: P2.
- **`pos-sync.controller.ts`'s `GET /pos-sync/records` remains a hardcoded stub (`{ status: 'success', records: [] }`) behind `ServiceTokenGuard`.** Pre-existing scaffolding (present before this story, symmetric with `printer.controller.ts`'s identical stub), presumably reserved for a future on-premise connector reporting endpoint — intentionally left untouched; this story's real admin-facing visibility work lives in the new `PosSyncRecordsController` instead. Owner: backend, once the connector's own reporting contract (E9-S3..S7) is defined. Priority: P3.
- **`test/menu.integration-spec.ts` leaked fixture rows into the shared dev database again during this session** (`Phase 4 Integration Unavailable Item`, the exact variant already logged in the Story 6-1 entry above) — reproduced across several separate `npm run test:integration` runs while verifying this story, unrelated to any pos-sync change (`git diff --stat` confirms this story never touches that file). Cleaned from the dev database each time; still not fixed in code. Already tracked above at P2 — restated here only as fresh reproduction evidence, not a new finding.
- **[Independent review, verification-gap reviewer] No automated check enforces that the correction migration's SQL and the standalone re-runnable script stay byte-for-byte in sync going forward.** They are two independently hand-maintained files (`prisma/migrations/20260815150100_pos_sync_correct_fabricated_records/migration.sql` and `prisma/scripts/correct-fabricated-pos-sync-records.ts`) with no shared source. **Fixed during this story's review loop**: a normalized-text-equality test was added (`test/pos-sync.integration-spec.ts`, "migration/script SQL parity" describe block) that fails the moment either file's SQL changes without the other. Restated here only because the underlying two-file-maintenance pattern itself (not just this one instance) may recur for any future correction migration — worth a lint rule or codegen approach if this pattern repeats. Owner: backend. Priority: P3.
- **[Independent review, verification-gap reviewer] This story's fabrication-regression guard is scoped to one file and provides no forward protection once a real Idealpos adapter exists.** `test/pos-sync.integration-spec.ts`'s "static fabrication-removal evidence" test statically greps `pos-sync.processor.ts` for the removed `IDEAL-*` construct — by design, since that is the only file this story can prove anything about (no real Idealpos exists to assert behavior against). When a real adapter lands (E9-S3..S7, blocked on DL-064) in a new file, nothing built in this story would catch that new file reintroducing a fabrication-style bug (a synthesized reference presented as an Idealpos confirmation). This is a scope boundary, not a defect in this story, but was not previously named explicitly. Recommend: whichever story implements the first real adapter must itself carry an equivalent regression test (e.g., asserting the adapter's `posOrderId`/`synced` outcome is only ever set from a real HTTP/SQL/ODBC response object, never synthesized) rather than assuming this story's guard extends automatically. Owner: whoever picks up E9-S3 (first real adapter story). Priority: P2.
- **[Independent review, verification-gap reviewer] No test exercises `PosSyncProcessor` via a real, running BullMQ `Worker` consuming a real enqueued Redis job — every test (unit and integration) calls `processor.process(...)` directly.** Consistent with the queue being genuinely dormant in production (see the first entry above), but worth naming as its own angle: if the queue is ever wired up, this story provides no regression coverage for the NestJS+BullMQ plumbing itself (retry/backoff config, stalled-job redelivery, concurrency settings) — only the pure business-logic function is proven. Owner: backend, at the same time the enqueue call is finally wired up. Priority: P2.

## Deferred from: Story 9-3 pos-sync-outbox-dispatch implementation session (2026-08-16)

Three test-coverage gaps were named by the verification-gap reviewer during independent review and consciously deferred rather than fixed, each with reasoning recorded at the time (also in the story's own Dev Agent Record):

- **No test forces a genuine, real infra failure (e.g. a real transient Postgres error) mid-`PosSyncProcessor.process()` to exercise the AC17 recovery path end-to-end.** The existing AC17 tests prove the *recovery mechanism* (a record whose `dispatchedAt` is stale, or whose BullMQ job genuinely failed, becomes re-eligible and is genuinely re-processed) using manually seeded state and a dedicated throwaway-queue reproduction, not a forced real fault inside the actual `PosSyncProcessor` transaction. Safely forcing a real mid-transaction Postgres fault would require fault-injection infrastructure (e.g. a proxy or a deliberately-poisoned connection pool) that doesn't exist in this repository and was judged disproportionate to add for this story alone. Owner: backend/test infrastructure, if a general fault-injection harness is ever built for other stories too. Priority: P3.
- **No test exercises the periodic `setInterval` timer path itself** (`PosSyncDispatcherService.onModuleInit`'s timer registration, its own `.catch()` error-logging branch, and `onModuleDestroy`'s `clearInterval`). Deliberately disabled during the entire test suite (`NODE_ENV === 'test'` skips starting it) to prevent the dispatcher from picking up other test files' fixture rows mid-run — the wrapped logic (`sweep()`) is otherwise fully tested, but the timer wiring's own error-handling branch has zero direct execution coverage. Owner: backend, low priority given the wrapped logic's coverage. Priority: P3.
- **No live KDS WebSocket assertion proves non-coupling between POS-sync dispatch and KDS delivery**, beyond a static source-grep confirming the dispatcher never references `orders.gateway` and a real integration test confirming the `print-jobs` queue's job count is unchanged after a dispatch sweep. Judged sufficient given `orders.gateway.ts` is entirely untouched by this story and already has its own test coverage elsewhere; a live end-to-end WebSocket test was judged disproportionate for what is, structurally, a non-interaction. Owner: n/a — revisit only if a future change actually introduces a coupling point. Priority: P3.

## Deferred from: Story 2-9 connector-identity-tracer implementation session (2026-08-16)

Story 2-9's original scope (see the story file's "Scope correction" section) covers the complete connector trust boundary: identity, an outbound authenticated command/result session protocol, an encrypted local durable queue, full heartbeat reachability telemetry, and migrating `printer`/`pos-sync` off the shared `ServiceTokenGuard`. This session deliberately implemented only the identity/enrolment/authentication/revocation/rotation/tenant-isolation/minimal-heartbeat slice (the smallest production-grade tracer everything else depends on), consciously deferring the rest rather than attempting it against a non-existent command protocol or connector process:

- **No command/session protocol exists.** Original ACs 5–7 (per-command authorization against capability/target resource, `CONNECTOR_ACCEPTED` persist-before-acknowledge semantics, independent POS/KDS/KOT delivery-acknowledgement state) are not implemented — there is nothing yet for a connector identity to execute against. Owner: whoever picks up the next connector-dependent story. Priority: tracked at the epic level (`venue-connector-identity-and-durable-queue` in `sprint-status.yaml`), not restated as a numeric priority here since it is the story's own next phase, not a defect.
- **No encrypted local durable queue.** Original AC6/Task 3 describes connector-side (not backend-side) durable storage; no connector process exists yet to hold one. Same owner/tracking as above.
- **Heartbeat reports only self-declared `version`/`capabilities`, not Idealpos/printer reachability, queue depth, or oldest command age (original AC8).** Reporting those now, with no real Idealpos/printer/queue behind them, would risk exactly the kind of fabricated-state problem stories 8-1/9-1 deliberately removed. Owner: same as above, once the command protocol exists to observe those states truthfully.
- **`printer.controller.ts`/`pos-sync.controller.ts` remain on `ServiceTokenGuard`/`INTERNAL_SERVICE_TOKEN`, unmigrated to connector identity.** Both are untouched by this story — confirmed via `git diff` showing zero changes to either file. This is the direct continuation of the pre-existing note already logged above under "Story 9-1" (`pos-sync.controller.ts`'s stub, P3) and "Story 8-1" (print-jobs queue never fed, P1) — migrating those two controllers' auth mechanism should happen together with whatever story finally wires a connector to consume them. Owner: backend + connector work. Priority: P2 (auth-mechanism migration itself is not urgent while both endpoints remain unreachable stubs; re-prioritize to P1 the moment either is wired to anything real).
- **No dashboards/alerts for disconnected/obsolete/revoked/backlogged installations.** No UI work was in scope this session; `GET /api/venues/:venueId/connector/installations` exists as the API-contract equivalent, matching the identical precedent already set by stories 8-1 and 9-1 for `PrinterJob`/`POSSyncRecord` admin visibility. Owner: admin-frontend + backend (endpoint already exists). Priority: P2.
- **Heartbeat-staleness → "offline" threshold is an explicitly unresolved product decision** (recorded in the story file itself, not invented here). `lastSeenAt` is persisted so a future story can apply whatever threshold product/UX decides without a schema change. Owner: product. Priority: P3 (no functionality blocked on it today).
- **Enrolment TTL (15 min), bootstrap-code/secret entropy (32 random bytes), and the enrolment/authentication rate limits (10/900s, 120/60s) are engineering defaults chosen for consistency with this codebase's existing conventions, not derived from an explicit stated security policy.** Flagged in case product/security wants different values. Owner: security/product. Priority: P3.

## Deferred from: Story 2-9 independent review session (2026-08-16, story promoted to done)

Two items considered during the fresh independent review that closed out Story 2-9 and deliberately not fixed, with reasoning recorded at the time (also in the story's own Dev Agent Record):

- **No forced-real-infra-failure test exercises the new `ConnectorService#logAuditEventSafely` non-fatal path.** The review found and fixed a real bug (an unguarded audit-log write after a committed durable effect could turn a successful `redeemEnrollment`/`revoke` into a client-visible failure) by adding the established `logAuditEventSafely` pattern (story 8-1 precedent). No test forces a genuine audit-write failure to exercise the new catch branch, for the same reason already recorded against the identical gap in story 9-3's deferred-work entry: a general fault-injection harness doesn't exist in this repository and building one for a single call site was judged disproportionate. Owner: backend/test infrastructure, if a general fault-injection harness is ever built. Priority: P3.
- **Reproduced (not newly discovered): running `npm run test:integration` twice within the same ~900s window spuriously fails most of the suite (88/107 in one reproduction) via the shared `127.0.0.1` login rate-limit bucket**, not any story-specific defect. This is a concrete, reproduced instance of the pre-existing gap already logged under "Deferred from: code review of 2-5-rate-limiting" ("IP-extraction failures... collapse all such requests into a shared `127.0.0.1` rate-limit bucket"). Workaround used this session: clear `rate-limit:*` keys in the local dev Redis before re-running. Not fixed in code — restated here only as fresh, concrete reproduction evidence (with the exact Redis key pattern and observed TTL) that anyone re-running the full integration suite twice in quick succession should expect this, not assume a regression. Already tracked at its priority under 2-5 above; no new priority assigned.

## Deferred from: Story 2-10 connector-command-protocol independent review session (2026-08-16, story promoted to done)

Two items considered during the fresh independent review that closed out Story 2-10 and deliberately not fixed, with reasoning recorded at the time (also in the story's own Dev Agent Record):

- **`ConnectorCommandService#report()`'s idempotent-repeat check compares `idempotencyKey`+`status`+`resultType` but not `resultPayload`.** A repeat report with an identical key/outcome/type but a genuinely different `resultPayload` is silently accepted as a no-op rather than flagged as a discrepancy. Judged acceptable for this story's threat model (the caller is already an authenticated, trusted connector installation — not a tenant/auth boundary) and this story's own payload (a deterministic hash with no legitimate reason to vary between reports of the same command). A future story adding a real command type with a genuinely variable result payload should revisit whether payload-equality checking is needed. Owner: whoever adds the first real (non-tracer) command type. Priority: P3.
- **`ConnectorCommandService#poll()`'s candidate over-fetch (`MAX_POLL_BATCH * 3`) is a throughput heuristic, not a correctness guarantee.** Under heavy capability heterogeneity in a venue's command backlog, a single poll could return fewer than `MAX_POLL_BATCH` eligible commands even if more exist beyond the over-fetch window — delayed by one poll cycle, never lost or duplicated. Not expected to matter at this story's single-command-type, single-venue scale. Owner: backend, revisit if/when multiple concurrent command types with divergent capability requirements exist. Priority: P3.

Additionally, restated (not a new finding, a direct continuation of an already-tracked gap): **no test exercises `ConnectorCommandSweeperService`'s own `setInterval` timer wiring** — deliberately disabled during the test suite (`NODE_ENV=test`) for the identical cross-test-contamination reason already documented for `PosSyncDispatcherService` (story 9-3's own deferred-work entry). The wrapped logic (`ConnectorCommandService#sweep()`) is fully tested directly; only the timer registration/error-handling branch has zero direct execution coverage. Owner: backend, low priority given the wrapped logic's coverage. Priority: P3.

**A real, fixed gap** (not deferred — recorded here for continuity with the identical entry under "Story 2-9 independent review session" above): this story's own test volume was enough to push the *whole* integration suite's shared `127.0.0.1` `/api/auth/login` rate-limit bucket over its 10-per-900s budget within a single `npm run test:integration` run — not merely on a rapid re-run, as story 2-9's own reproduction showed. Fixed this session by broadening both new integration-spec files' rate-limit-clearing helper from a connector-path-only pattern to the entire `rate-limit:*` keyspace, called in `beforeEach`/`afterAll` so it self-heals regardless of file execution order. The full 9-suite integration run now passes cleanly in one shot (confirmed 3 consecutive runs). The underlying rate-limiter key design itself (`rate-limit.guard.ts`, IP+path-keyed) is unchanged — this fix is test-hygiene only, not a production behavior change, and does not resolve the general "IP-extraction failures collapse into a shared bucket" gap tracked under 2-5.

## Deferred from: Order Tablet scope-correction verification (2026-08-16, during story 2-9's handoff)

The Order Tablet (`tablet-frontend/`, `admin-frontend/src/pages/order-tablet/OrderTabletPage.tsx`) previously had zero epic/story coverage (`_bmad-output/audits/repository-story-audit-2026-08-16.md` §7). It is explicitly in scope for the 11 October 2026 critical path, not deferred backlog — a new epic (`docs/epics.md` E15, tracked in `sprint-status.yaml` as `epic-15`) was filed this session to cover it. Nothing below was fixed this session (out of Story 2-9's connector-identity scope); each is independently re-verified against current source (not assumed from the prior audit) and is now traced to a specific E15 story rather than left as a bare finding:

- **`handlePayAll()` marks an order `completed` via `PATCH /api/admin/orders/:id/status` with no payment gateway call of any kind, for both `card` and `cash`.** Owner: E15-S6. Priority: P0 (billing/trust-critical — a table's payment can be marked complete with zero real payment confirmation).
- **`handlePrintBill()` is local UI state only (`setPrinted`/`setTimeout`) — no `PrinterJob`, no backend call, no real printer contacted.** Owner: E15-S8. Priority: P1.
- **The promo-code control hardcodes a single fixed code (`VERDURA10`, −10%) as a client boolean toggle with no backend validation or real promo entity**, and **`getModifierGroupsForItem()` hardcodes all modifier groups/options/prices by category-name substring match**, applying a generic "Preparation: Medium Well/Well Done/Medium Rare" fallback to every non-drink/non-pizza item regardless of fit. Owner: E15-S3. Priority: P1 (menu/pricing integrity).
- **The on-screen running total fabricates a 10% "service" charge with no backend counterpart**, and (via the fake promo) discounts a GST base the backend never computes that way — meaning the total shown to staff/guest before submission does not match what `OrdersService.computeTotals` actually stores once the order is submitted. The GST (15%, exclusive-of-price) line itself is correct and consistent with the backend/kiosk convention — this is not a GST double-count bug, contrary to an initial hypothesis; see `docs/epics.md` E15's banner for the full verification. Owner: E15-S4. Priority: P1 (billing-trust gap, distinct from and in addition to the tax-handling question).
- **Table notes (`tableNote`) are pure `useState` — never persisted to any API**; lost on refresh/restart, invisible to any other device or the KDS. Owner: E15-S10 (or folded into E15-S2). Priority: P2.
- **Table transfer is honestly disclosed as unsupported** (`handlePerformTransfer` returns a real error message, does not fake success) — the one item in this list that is already correctly handled, restated here only so it isn't mistaken for an open gap. No action needed beyond E15-S2 eventually implementing it for real.
- **Standalone tablet builds gate `OrderTabletPage` behind a shared venue-wide `KdsPinGate` PIN; the embedded admin route gates the identical component behind full per-staff JWT `ProtectedRoute` login** — two different authentication strengths and audit-actor attributions for the same payment-marking UI depending on entry point. Owner: E15-S1. Priority: P1 (needs an explicit product/security decision, not a unilateral code fix — see E15-S1's `BLOCKED ON` note).
- **Zero test files exist for `OrderTabletPage.tsx` or anything under `tablet-frontend/`.** Owner: E15-S11. Priority: P2.

## Deferred from: 2026-08-15 target-operating-model conformance audit (code-level findings, not yet story-filed)

These are verified against current source but are not themselves P0 operating-model gates (tracked separately above) — they are concrete security/tenancy/hygiene findings that should become stories once the P0 truthfulness/idempotency work (stories 6-1, 8-1, 9-1, 2-9) lands. Evidence, impact, suggested owner and priority given for each; none have been implemented as part of this documentation pass.

- **Row-Level Security enabled with zero policies; app connects as the table-owning role, which bypasses RLS by default.** `backend/prisma/migrations/20260618000001_enable_rls_all_tables/migration.sql` runs `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` on 18 tables with no `CREATE POLICY` statements; `docker-compose.yml` connects as `POSTGRES_USER: verdura`, the schema-owning role. Impact: tenancy isolation rests entirely on application-layer `WHERE venueId` discipline, not a database-enforced boundary, despite the schema visibly appearing to have one. Owner: backend/platform. Priority: P1. Suggested resolution: either write real per-tenant policies + `FORCE ROW LEVEL SECURITY` + a non-owner connecting role, or remove the `ENABLE ROW LEVEL SECURITY` statements so the schema stops implying a control that isn't functioning.
- **Kiosk order creation is unauthenticated and not bound to a specific venue.** `POST kiosk/orders` trusts a client-supplied `venueId` with no device/venue binding, unlike the KDS device-token pattern. Tracked as epics.md E6-S10 (backlog, not yet story-filed). Owner: backend. Priority: P1.
- **Historic Supabase credentials remain recoverable from git history.** `backend/.env.direct` and `backend/.env.pooler.bak` were committed in the initial commit and later removed from HEAD (`git log --all` shows both commits), but remain in history. `.gitignore` now correctly excludes `.env.*`/`*.env.bak` going forward. Owner: whoever holds the Supabase project credentials. Priority: P0 — external action, independent of any code or documentation fix; rotation status must be confirmed regardless of the git cleanup.
- **Docker Compose ships insecure default secrets that silently activate if env vars are not overridden.** `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `SEED_OWNER_PASSWORD` use `${VAR:-default}` shell fallbacks to visibly-dummy values in `docker-compose.yml`. Application code itself fails closed (`config.getOrThrow()`), but Compose supplies a plausible value before that check ever runs. Owner: DevOps/platform. Priority: P1.
- **`staff.controller.ts` does not exist — no admin HTTP surface for staff management, despite a real `StaffService`.** `backend/src/staff/` has a service, module and DTOs but no controller. The admin-frontend Staff page renders client-side mock data with no API calls. Owner: backend + admin-frontend. Priority: P2.
- **Several admin-dashboard pages (Payments, Integration Tools, Reports) have no backend behind them.** They import from local static/mock data modules with zero `fetch`/API calls, so staff see plausible-looking numbers disconnected from real data. Owner: admin-frontend. Priority: P2.
- **Reservation capacity check is a check-then-act race, not database-enforced.** `reservations.service.ts`'s capacity check is a plain read followed by a separate write with no transaction/lock. Owner: backend. Priority: P2.
- **Order-ID generation (`ORD-6xxxxx` read-then-increment) races under concurrent load — priority elevated to P1 (2026-08-15, Story 6-1 review).** `persistOrder`'s order-numbering block computes the next ID via `findFirst`-then-increment inside the insert transaction; two concurrent *different*-idempotencyKey order creations can collide on the generated primary key. Originally logged as P2 (general concurrency hygiene); elevated after two independent reviewers of Story 6-1 (adversarial + concurrency/edge-case) confirmed this interacts with the new idempotency-key P2002 recovery logic: `recoverFromPersistConflict` correctly does not misclassify a primary-key collision as an idempotency or payment conflict (it falls through to a generic re-thrown error, a clean 500 — not a duplicate order or data corruption), but it does mean one of two legitimately-concurrent *new* orders can fail outright under load, directly adjacent to Story 6-1's own AC5 concurrency guarantee. Fix: replace with a Postgres sequence or a bounded retry-on-conflict loop around `persistOrder`. Owner: backend. Priority: P1.
- **Idempotent replay re-validates against live menu state, so a legitimate retry can fail if the menu changed since the original order (2026-08-15, Story 6-1 review).** `OrdersService.create()`/`createStaffOrder()` recompute pricing/availability via `resolveOrderItems` on every call, including a pure idempotency-key replay — if a menu item is deleted, made unavailable, or re-priced between the original submission and a network-retry of the same request, the retry fails (400/409) instead of returning the original order, narrowly contradicting the "retry always returns the original result" guarantee. Flagged independently by two reviewers (adversarial + concurrency/edge-case). Practical window is narrow (retries happen within seconds; menu changes are staff-driven, not automatic) but real. Fix requires a design decision: compare a replay against the originally-submitted request shape (cache the raw request, or store enough of the original snapshot to avoid re-deriving it) rather than re-validating live state. Owner: backend. Priority: P2.
- **35 broken markdown links across `_bmad-output/implementation-artifacts/2-4-rbac-guard.md`, `2-5-rate-limiting.md`, `2-6-admin-login-page.md`, and one in `docs/discovery/current-system.md`** — all absolute `file:///home/cyrus/Documents/...` paths pointing at a different machine's filesystem from a prior checkout, never revalidated against this repo layout. Owner: tech writer / doc maintainer. Priority: P3. The `docs/discovery/current-system.md` instance has been fixed as part of this documentation pass; the three `_bmad-output` story files were left untouched as historical evidence (per the "preserve historical evidence" instruction) but should be corrected or annotated in a future editorial pass.
- **Root-level `AUDIT_REPORT.md` and `AUDIT_REPORT_V2.md` are now both superseded by the 2026-08-15 documentation corpus but were not previously marked as such.** Superseded banners were added to both as part of this documentation pass (2026-08-15) — no further action needed unless the files are deleted outright, which is a human decision (they retain provenance value).
- **Backend lint currently fails: 205 problems (136 errors, 69 warnings), concentrated in `backend/test/*.integration-spec.ts`, dominated by `@typescript-eslint/no-unsafe-*` violations.** Would fail a CI gate if one existed (none does — see `1-5-github-actions-ci: backlog`). Owner: backend. Priority: P2.

## Deferred from: code review of 5-1-reservation-crud-api (2026-06-21)

- E5-S1 `create()` already implements a basic capacity check using `venue.coversPerSlot` — this is E5-S3's stated scope ("Capacity enforcement, configurable covers-per-slot check on create"). E5-S3 must review the existing check, add configurability (per-venue override, admin bypass), and document it as already partially implemented [api/src/reservations/reservations.service.ts:31–50]
- `GET /api/admin/reservations?venueId=` query param accepts any string; an invalid UUID passes to Prisma and produces a 500 instead of 400. Add `new ParseUUIDPipe({ optional: true })` or equivalent custom pipe in a future API refinement story [api/src/reservations/reservations.controller.ts:37]

## Deferred from: code review of 4-2-menu-item-crud-api (2026-06-20)

- Hard delete in `remove()` is spec-correct (AC-1); when E4-S8 converts to soft delete, ensure `OrderItem.menuItemId` FK cascade/SET-NULL is configured before orders (E6) ship
- No pagination on `findAll` — consistent with categories pattern; add `take`/`skip` when real query volumes require it
- Raw Prisma models returned from all endpoints — exposes `organizationId`, `createdById`, `deletedAt`; address with response DTOs in E13 security hardening
- Empty PATCH body silently accepted as no-op — spurious `updatedAt` bump; address with a future API refinement story
- `imageUrl`/`imageThumbnailUrl` allow localhost URLs (`require_tld: false`) — SSRF risk only if server-side fetching is ever added; consistent with categories URL options
- `nutritionalDetails`/`modifierGroups` accept untyped JSON blobs — explicitly deferred by Dev Notes; define `ModifierGroupDto` when kiosk display needs stable schema
- `update()` spreads `undefined` DTO fields — Prisma ignores undefined safely; revisit if Prisma major version changes semantics
- `nutritionalDetails` typed as `Record<string, object>` excludes primitive leaf values — functional; no runtime impact with `@IsObject()` top-level check

## Deferred from: code review of 1-1-scaffold-verdura-api (2026-06-18)

- Redis service has no authentication configured in docker-compose.yml — local dev only; add `requirepass` / `REDIS_PASSWORD` when adding production config
- Default credentials in `.env.example` and docker-compose match expected local dev values (`verdura`/`verdura`) — not a concern for local dev but rotate before any shared or cloud environment
- No Helmet, CORS, or global ValidationPipe in main.ts — out of scope for scaffold; address when adding routes (E2+)
- No rate limiting / ThrottlerModule — E2 story scope
- `skipLibCheck: true` in tsconfig.json — NestJS ecosystem convention; acceptable at this stage
- docker-compose.yml has no app service with `depends_on: condition: service_healthy` — no app service yet; remember to wire when adding the NestJS service entry
- REDIS_PASSWORD absent from Joi validation schema and .env.example — production infrastructure concern; add when Redis auth is introduced
- MongoDB healthcheck does not authenticate (`mongosh --eval "db.adminCommand('ping')"` without credentials) — acceptable for local dev healthcheck; update if credential verification becomes important

## Deferred from: code review of 2-2-jwt-refresh-token (2026-06-19)

- No CSRF token mechanism — `sameSite: 'strict'` provides partial protection but no double-submit cookie or CSRF header check. Out of scope for 2-2; address when adding state-mutating admin endpoints.
- `JwtStrategy` not exported from `AuthModule` — Passport registers it by provider side-effect so `@UseGuards(JwtAuthGuard)` works. Only a gap if a module needs to inject `JwtStrategy` directly, which nothing does yet.

## Deferred from: code review of 2-3-auth-endpoints (2026-06-19)

- Owner staff record is soft-deleted before the seed script is executed — seed completes but owner remains soft-deleted. [api/prisma/seed.ts:22]
- Broken anchor link in Table of Contents of README.md. [README.md]
- Lack of Swagger OpenAPI decorators on AuthController. [api/src/auth/auth.controller.ts]

## Deferred from: code review of 2-5-rate-limiting (2026-06-19)

- `routeId` uses `request.path` not route template — affects future parameterized routes; each unique path param value creates a distinct Redis key, fragmenting the rate-limit counter per resource rather than per user+route [api/src/auth/guards/rate-limit.guard.ts:80]
- Redis Cluster atomicity not guaranteed — Lua script is safe on standalone Redis only; if Redis Cluster is introduced, `EVAL` with keys hashed to different slots loses atomicity; document the single-node assumption or use a Redis Cluster-safe approach [api/src/auth/guards/rate-limit.guard.ts]
- IP-extraction failures (null socket, closed connection) collapse all such requests into a shared `127.0.0.1` rate-limit bucket — health checks and internal tooling on localhost share the same bucket as any failed extraction [api/src/auth/guards/rate-limit.guard.ts:154]
- IPv6/dual-stack creates two distinct rate-limit buckets for the same physical client (`::ffff:203.0.113.1` vs `203.0.113.1`); normalize IPv4-mapped IPv6 addresses before building the Redis key [api/src/auth/guards/rate-limit.guard.ts:81]
- Fail-open on Redis error disables rate limiting entirely — explicit design trade-off required by AC 6; revisit with Redis HA or a circuit-breaker pattern if the threat model changes [api/src/auth/guards/rate-limit.guard.ts]

## Deferred from: code review of 1-7-scaffold-verdura-kiosk (2026-06-20)

- `tsc -b` with `composite: false` and `noEmit: true` is contradictory — `tsc -b` is project-references build mode requiring `composite: true`; currently degrades to a full typecheck rebuild, which works but breaks if project references are added. Pre-existing admin pattern. [kiosk/package.json:8, kiosk-frontend/tsconfig.json:12]
- `VITE_API_URL` in vite.config.ts is a dev-proxy setting only — not consumed by any `src/` file and has no effect in production builds. A production API client (e.g., axios baseURL from `import.meta.env.VITE_API_URL`) must be wired before kiosk makes real API calls. [kiosk/.env.example, kiosk-frontend/vite.config.ts]
- `@typescript-eslint/no-explicit-any: 'off'` globally allows unchecked `any` usage despite `strict: true` in tsconfig — pre-existing admin pattern; revisit if any-proliferation becomes a maintenance issue. [kiosk/eslint.config.js:22]
- `loadEnv(mode, cwd(), '')` loads all process env vars (not just `VITE_`-prefixed) into the vite config scope — only `VITE_API_URL` is consumed, so no current leakage, but the empty prefix is unnecessarily permissive. Pre-existing admin pattern. [kiosk/vite.config.ts:5]

## Deferred from: code review of 4-3-admin-category-management-page (2026-06-21)

- Admin sidebar nav grouping — AC1 of story 4-3 specified "under a 'Menu' group"; deferred by decision to a future UX story covering holistic sidebar grouping once E4-S4 (menu items page) and E5 (reservations) add more nav links [admin/src/components/layout/AdminLayout.tsx]
- Concurrent move operations from two browser sessions can corrupt `sortOrder` — multi-user write collision on `handleMoveUp`/`handleMoveDown`; last-write-wins at DB; requires WebSocket, polling, or optimistic-locking at API level to resolve [admin/src/pages/menu/CategoryManagementPage.tsx]
- `sorted` stale-closure in move handlers — general React closures-in-event-handlers pattern; if a background query refetch causes a re-render between the two sequential `await` PATCHes, the second call uses the pre-refetch snapshot; low risk given the short await window [admin/src/pages/menu/CategoryManagementPage.tsx:handleMoveUp/handleMoveDown]
- `sorted[index]!` non-null assertion — theoretically unsafe if the list shrinks (another session deletes a category) between the last render and when the click handler fires; guarded by React's render/event synchronisation in practice; revisit if concurrent deletes become a real scenario [admin/src/pages/menu/CategoryManagementPage.tsx:handleMoveUp/handleMoveDown]
