# Verdura Repository Story Audit — 2026-08-16

**Audit type:** Evidence-gathering and status-reconciliation. Read-only. No implementation, schema, story status, or controlling BMAD document was modified during this audit.
**Companion artifact:** [`story-status-ledger-2026-08-16.csv`](./story-status-ledger-2026-08-16.csv) — 125 rows, one per canonical story or unstoried/un-epiced finding. All counts in this report are recomputed from that CSV, not estimated.

---

## 1. Executive Conclusion

The repository is a genuinely substantial, mostly real implementation — not a mock-up — but the BMAD tracker (`sprint-status.yaml`, 37 tracked entries) covers less than a third of the 125-item canonical inventory this audit reconstructed from `docs/epics.md`, the 29 real story files, and direct source inspection. Two distinct failure modes coexist:

1. **Documentation lag, not fabrication.** Three story files (`1-4`, `2-1`, `2-6`) declare a stale status (`ready-for-dev`, `in-progress`, `review`) while `sprint-status.yaml` correctly says `done` and the code backs that up — except for `2-6`.
2. **One genuine overstated-completion finding.** Story `2-6` ("Admin Login Page") describes an email/password login form (`LoginPage.tsx`, zod validation, specific error copy) that **does not exist anywhere in the current codebase**. The admin console was quietly rebuilt around a shared numeric PIN gate (`AdminPinGate.tsx` / `POST /api/auth/admin-pin`) — real, tested, and working, but with no story or decision record authorizing the replacement. `2-6`'s own acceptance criteria are unsatisfiable against current source while the story sits `review`/tracker-`done`.

Beyond the tracker, **32 of 125 canonical items are `NOT_STARTED`**, **21 are `PARTIALLY_COMPLETE`**, **8 are `PROTOTYPE_OR_MOCK_ONLY`** (most notably the entire Reporting epic's backend, and the Admin Dashboard's home-page KPI tile, staff page, audit-log page, and payments/integration-tools pages), and **at least 4 substantial features have real, working code with no controlling epic or story at all** — most strikingly the entire Order Tablet feature (a dedicated frontend workspace plus a real backend-integrated page).

No P0 truthfulness regression was found beyond what `deferred-work.md` and prior audits already document (the pos-sync/print-jobs queue dormancy is confirmed still true, not newly discovered). The one new P0-adjacent finding is the `2-6` overstatement, because it means the tracker's `done` count cannot currently be trusted at face value without cross-checking the story file itself.

---

## 2. Audit Scope and Method

- **Method:** static source inspection (file reads, targeted greps, directory structure, Prisma schema/migration inspection) plus reading every applicable story file, `docs/epics.md`, `sprint-status.yaml`, `deferred-work.md`, `decisions-log.md`, and supporting docs (`mvp.md`, `target-operating-model.md`, `prd.md`, `printers.md`, `offline.md`, `ux.md`, `production_readiness_report.md`, `docs/audits/enterprise-readiness-audit.md`, all `_bmad-output/planning-artifacts/*`).
- **No tests were executed this session.** `backend/test/*.integration-spec.ts` files were read to confirm they use a real `PrismaService`/Postgres connection (not mocks) where relevant, but none were run — this session had no way to positively confirm the shared dev database was disposable (prior story evidence, e.g. story 9-1's Dev Agent Record, explicitly describes a "populated shared dev DB"), so execution was avoided per this audit's safety constraints. Evidence tiers accordingly cap at `REAL_POSTGRES (reproducible, not re-executed this session)` rather than a freshly-confirmed pass.
- `npm audit` was considered for E13-S6 and **not run** — it requires contacting the external npm registry, which this session's scope prohibited ("do not... contact external services"). This is recorded as a limitation, not a finding either way.
- Seven parallel fresh-context research agents ("forks," inheriting this audit's full task brief) each covered a bounded epic cluster and returned structured, file-cited findings, which this report and the CSV synthesize. This kept per-file evidence-gathering out of the lead auditor's context while preserving full traceability — every claim below cites a real repo-relative path.
- No Idealpos installation files, certificates, keys, licence values, payment credentials, or database contents were accessed. No file under `/Users/sarwarkhan/Documents/Idealpos Solutions` was touched.

---

## 3. Repository-Instruction Sufficiency

**No `AGENTS.md` or `CLAUDE.md` file exists anywhere in this repository.** There is no machine-readable, repo-scoped instruction file establishing coding conventions, safety constraints, or agent behavior for this codebase. All governing context instead lives in the BMAD documentation corpus (`docs/`, `_bmad-output/`) and the root `README.md`/`PRODUCT.md`/`DESIGN.md`. This is a genuine gap for any future automated agent picking up work here without being handed this conversation's context — recommend authoring a root `AGENTS.md` that at minimum points to `docs/target-operating-model.md` as the normative contract and `docs/mvp.md`/`docs/decisions-log.md` as the current-state authority, mirroring what this audit had to reconstruct manually.

Package manifests (`package.json` workspaces: `backend`, `customer-frontend`, `admin-frontend`, `kiosk-frontend`, `tablet-frontend`) are consistent with the actual directory structure. `docker-compose.yml` defines 8 services (`postgres`, `redis`, `backend`, `customer`, `kiosk`, `kds`, `admin`, `tablet`) — broader and more current than `sprint-status.yaml`'s stale `E1-S10: backlog` entry implies. No CI workflow directory exists — CI is confirmed absent, consistent with `deferred-work.md`'s existing P1 finding.

---

## 4. Canonical Story Inventory Summary

Recomputed directly from the CSV (125 rows):

| Metric | Count |
| --- | --- |
| Total canonical rows (epics.md stories + tracer stories + unstoried/un-epiced findings) | **125** |
| Rows present in `sprint-status.yaml` tracker | **37** |
| Rows with a real implementation-artifact story file | **29** (the `_bmad-output/implementation-artifacts/` directory has 31 files total: 29 story `.md` files + `deferred-work.md` + `sprint-status.yaml`, neither of which is itself a story) |
| Rows whose declared status string contains "done" | **29** |
| Rows with an explicit story-file-vs-tracker status discrepancy flagged | **3** (`1-4`, `2-1`, `2-6`) |

Assessed-status breakdown (independently assigned by this audit, not copied from any tracker):

| Assessed status | Count |
| --- | --- |
| `VERIFIED_COMPLETE` | 27 |
| `COMPONENT_COMPLETE` | 20 |
| `PARTIALLY_COMPLETE` | 21 |
| `NOT_STARTED` | 32 |
| `PROTOTYPE_OR_MOCK_ONLY` | 8 |
| `IMPLEMENTED_UNVERIFIED` | 6 |
| `UNCLEAR` | 6 |
| `BLOCKED` | 3 |
| `SUPERSEDED_OR_SKIPPED` | 2 |

`docs/epics.md` defines 113 numbered `E{n}-S{m}` stories across 14 epics. Only 29 of those (plus the 4 tracer-bullet insertions `6-1`/`8-1`/`9-1`/`9-2`, which sit outside the `E{n}-S{m}` numbering as first-slice gates) have ever had a dedicated story file — **the tracker enumerates roughly a third of the actual roadmap**, confirming this audit's initiating premise.

**No completion percentage is stated anywhere in this report**, per this audit's own instructions — the status-taxonomy breakdown above is the intended replacement for a single number.

---

## 5. Epic-by-Epic Assessment

### E1 — Foundation
Scaffold stories (`1-1`, `1-7`, `1-6`) are genuinely complete. `1-4` (BullMQ/health) is real but its story file was never updated after landing (tracker was right, file was stale). `E1-S5` (CI) and `E1-S8`/`E1-S9` (standalone printer/POS-agent processes) are honestly `NOT_STARTED` — the backend instead hosts `printer`/`pos-sync` as in-process NestJS modules, a real architectural divergence from the original scaffold intent that was never formally superseded. `E1-S10` (Docker Compose) is more complete than its stale `backlog` tracker entry suggests. `E1-S11` (menu data migration script) only partially exists (`scripts/validate-menu.mjs` is a consistency checker, not a seed/migration tool).

### E2 — Authentication
Backend auth (`2-2` through `2-5`, `2-8`) is solid, tested, `VERIFIED_COMPLETE`. `2-1` has the same documentation-lag pattern as `1-4`. **`2-6` is this epic's headline finding**: the described email/password admin login page was replaced by an undocumented PIN-gate (`POST /api/auth/admin-pin`) with real backend logic and tests but zero governing story, decision record, or updated acceptance criteria — a genuinely overstated `done` claim. `2-7` (CDN edge middleware) has real code but no reproducible evidence of an actual live deployment. `2-9` (venue connector identity) is correctly and honestly `backlog`.

### E3 — Venues & Tables
Solid CRUD (`3-1`, `3-2`, `3-5`) with real but untested-at-the-integration-tier evidence. **`3-4` surfaces a genuine duplicate-implementation defect**: two separately-routed, differently-sized `TableManagementPage` components exist simultaneously (`/table-management` and `/settings/tables`), disambiguated only by an import alias (`LiveTableManagementPage`) — this needs a human decision, not a code fix by an agent guessing intent. A dormant `FloorPlan` Prisma model has zero backend references.

### E4 — Menu Management
The best-covered "shadow epic" in the repository: only 3 of 11 stories have story files, but **8 of the 11 are actually implemented** (category/menu CRUD, soft delete, kiosk menu API, venue overrides read-path, live public-site integration, image upload UI). The two real gaps: `E4-S6`'s media upload stores original bytes locally instead of the documented S3+sharp+webp pipeline (a real, disclosed architecture deviation from DL-026), and `E4-S5`'s `nutritionalDetails`/`modifierGroups` remain untyped JSON with no confirmed enum validation despite the epic's AC requiring it.

### E5 — Reservations
Core CRUD/FSM/capacity (`5-1`–`5-3`) is `COMPONENT_COMPLETE` with real-Postgres-tier evidence. `5-4` (email) is honestly still `review`, never promoted. **`5-5` (Admin Reservations list) was downgraded during independent review**: the page genuinely fetches real reservation data, but `ReservationsPage.tsx` also blends in hardcoded mock-fallback numbers whenever real values are falsy (`todayRes || 48`, `arriving30 || 6`, etc.), a hardcoded `capacityPercent = 70` explicitly commented "to match mockup perfectly," and hand-tuned bar-chart widths for specific time slots. This is real data with baked-in plausible-looking fake numbers in the same component — reassessed `PARTIALLY_COMPLETE`, not `COMPONENT_COMPLETE`. `E5-S7`/`E5-S8` (daily email settings page, midnight scheduled summary) are genuinely `NOT_STARTED` — no cron/repeatable job exists anywhere in the queue layer. `E5-S9`'s route-removal AC is satisfied, but the dead `AdminDailyEmail.jsx` file was never deleted. `E5-S10` (Payment entity manual-confirm) is model-only — zero business logic wired to reservations.

### E6 — Ordering
The most consequential epic. Story `6-1` (idempotency + payment-ref linkage) is genuinely `COMPONENT_COMPLETE` with strong real-Postgres evidence, and — the most important positive finding in this audit — **`orders.service.ts`'s `persistOrder` genuinely writes `Order`+`OrderItem`+`POSSyncRecord`+`PrinterJob` inside one Prisma transaction**, a real transactional outbox, not a documentation claim. But the outbox is never *dispatched*: no code anywhere enqueues these rows onto BullMQ (confirmed again, matching `deferred-work.md`'s pre-existing finding for both queues). `E6-S4`'s "dual checkout flow" cannot be considered done in any sense that includes Idealpos, because Idealpos submission doesn't exist yet (separately blocked on DL-064) — only the Verdura-side order creation and Stripe verification code exist. `E6-S6`/`S7`/`S8` (offline queue, idle timeout, allergen display) are confirmed absent by targeted grep, not assumed. An unstoried, real Stripe Terminal card-present flow exists with **no auth guard** on its endpoints — flagged as a security gap in §9.

### E7 — Kitchen Display System
Zero story files for an epic with substantial real functionality. **Two independent, non-mock KDS implementations exist** (`kiosk-frontend/KdsPage.tsx` and `admin-frontend/KitchenDisplayPage.tsx`), both wired to the same real WebSocket gateway — genuine duplication, not one shared component reused. `E7-S6` (PIN-gated venue token) is real and tested (`kds-auth.service.ts`) but duplicated across two frontend packages instead of shared. `E7-S5` (audible alert) is confirmed absent.

### E8 — Printer Service
`8-1` (truthful states tracer) is solid for its frozen scope. The print-jobs queue is confirmed dormant (same root cause as E6/E9). A real, generic `net.Socket` TCP dispatch exists (not a mock), but ESC/POS-specific framing is absent and correctly still `BLOCKED ON: Q2` per its own epic banner. `/printers` admin UI is a confirmed placeholder stub despite real backend endpoints existing to consume.

### E9 — IdealPOS Integration
`9-1` (truthfulness fix) and `9-2` (API-less tracer, from the prior session in this conversation) are both accurately represented — `9-1` done, `9-2` correctly blocked. **ID-hygiene note (independent review):** the string "9-2" appears in two distinct CSV `story_id` values — its own row, and `"E9-S7 / 9-2"` (the row cross-referencing which epics.md story `9-2` realizes). These describe different things (the tracer story itself vs. the epics.md story it gates) and are not a content duplicate, but a naive grep for "9-2" will find two rows — unlike its sibling tracers `6-1`/`8-1`/`9-1`, which each appear in exactly one row. No content is wrong; flagged for future ID-scheme cleanup only. The transactional-outbox write path for `POSSyncRecord` is real (same transaction as E6's finding). `E9-S2`'s NullAdapter-equivalent logic exists but runs as an in-cloud NestJS worker, not the separately-scoped on-premise agent the epic specifies — architecture has diverged without a formal decision record. `E9-S9`'s backend API (`pos-sync-records.controller.ts`) is real and shipped as part of story 9-1, but the admin UI route is still a placeholder — a real, already-built API sitting unconsumed.

### E10 — Admin Dashboard (Core)
Zero story files. The most consequential finding: **`DashboardPage.tsx` wraps a hardcoded mock constant in a TanStack Query hook**, making static data look like a live fetch — more deceptive than an obvious hardcoded value would be, because the code pattern reads as real data-fetching infrastructure. `StaffPage.tsx` and `AuditLogsPage.tsx` are confirmed to have zero API calls, and in both cases **the backend has no controller to call at all** (`staff`/`audit` modules are service-only). `OrdersPage.tsx` is the one genuinely real E10 surface (real fetch + real socket.io-client + real controller routes), though it appears to use a hardcoded default venue ID.

### E11 — Reporting
The backend (`ReportingModule`) is a **literal empty stub** — zero controllers, zero providers. The frontend (`ReportsPage.tsx` and four sibling components, ~1,650 lines) is a fully built, polished UI entirely driven by a local mock-data module, complete with simulated latency/error-injection toggles built into the UI itself. This is the cleanest `PROTOTYPE_OR_MOCK_ONLY` case in the repository.

### E12 — Menu Display Kiosk & Kiosk Hardening
More built than its "zero story files, epic backlog" status suggests: a real playlist/rotation signage engine, real fullscreen/context-menu hardening components, and a real (if narrower-than-specified) PIN overlay exist. Several sub-items (`E12-S2` service worker, `E12-S6` formal device registration) remain genuinely unclear pending a deeper read this audit's time budget did not reach — recorded as `UNCLEAR`, not guessed.

### E13 — Security Hardening & Compliance
A genuinely mixed, concretely-evidenced epic. Real: security headers, CORS whitelist, global DTO validation, and rate limiting on a broader surface than previously documented. Real gap: media upload only checks the client-declared MIME type, never actual file-signature bytes — a spoofable control, distinct from the (real, solid) path-traversal protection in the same file. Not started: secret-rotation documentation, dependency audit, penetration-test checklist. `docker-compose.yml`'s insecure default secrets are confirmed still present (pre-existing P1).

### E14 — Airtable Decommission
Both of the epic's own literal grep-based acceptance criteria (`airtable`, `pending_calendar_events`) pass with zero non-doc hits — satisfied as a side effect of the ground-up NestJS rebuild, never tracked as its own story. One orphaned dead file (`PendingCalendarEvents.jsx`) remains on disk, unimported, contradicting the epic's explicit file-removal AC in letter though not in effect.

---

## 6. Declared-versus-Actual Discrepancies

| Story ID | Declared status | Independently assessed status | Reason | Supporting evidence | Required correction |
| --- | --- | --- | --- | --- | --- |
| `1-4` | Story file: `ready-for-dev`; tracker: `done` | `VERIFIED_COMPLETE` | Documentation lag — code and tests are real and complete; only the story file's own status field/checkboxes were never updated | `backend/src/health/*`, `backend/src/queue/queue.module.ts` + specs | Update story file's `Status:` field and task checkboxes to `done` |
| `2-1` | Story file: `in-progress`; tracker: `done` | `VERIFIED_COMPLETE` | Same documentation-lag pattern | `backend/src/staff/staff.service.ts` + 14-test spec | Update story file's `Status:` field and checkboxes to `done` |
| `2-6` | Story file: `review` (all tasks checked); tracker: `done` | `PARTIALLY_COMPLETE` — **overstated** | The story's own acceptance criteria describe a feature (`LoginPage.tsx`, email/password form) that does not exist in the codebase. It was replaced by a different, real, tested PIN-gate design with no decision record | `admin-frontend/src/pages/login/LoginPage.tsx` confirmed absent; `AdminPinGate.tsx`/`POST /api/auth/admin-pin` confirmed present and tested instead | File a new story for the actual PIN-console design with real AC; correct `2-6` to reflect what shipped; add a decision-log entry explaining the pivot |
| `E1-S10` | Tracker: `backlog` | `VERIFIED_COMPLETE` | Tracker understates — Docker Compose is more complete than the original AC scoped (8 services vs. the originally-scoped backend+db+redis) | `docker-compose.yml:4-33` and full service list | Update `sprint-status.yaml` to `done`; file/close a retroactive story |
| `4-2` | Story file/deferred-work.md (2026-06-20): delete is "hard delete, spec-correct" | Code: soft delete (`deletedAt`) | Undocumented drift — a later change converted hard delete to soft delete with no story or decision recording it | `backend/src/menu/menu-items.service.ts:89-93` | Add a decision-log entry or story documenting the soft-delete conversion (this also substantively satisfies `E4-S8`) |
| E14 (all 4 stories) | Not tracked anywhere | 3 of 4 `VERIFIED_COMPLETE`/`SUPERSEDED`, 1 `PARTIALLY_COMPLETE` | Satisfied incidentally by the ground-up rebuild, but the tracker has no record of this epic existing at all | grep evidence in §5 above | Retroactively mark E14 as superseded-by-rebuild in the tracker |

---

## 7. Cross-Epic and Missing-Story Gaps

**Implemented features with no controlling epic or story at all (most severe class):**
- **Order Tablet** — a full, real, dedicated `tablet-frontend` workspace plus `admin-frontend/src/pages/order-tablet/OrderTabletPage.tsx`, reused across both packages, backed by real KDS-token auth. `docs/epics.md` never mentions an Order Tablet surface in any epic, despite `target-operating-model.md` explicitly naming `VERDURA_STAFF_TABLET`/`VERDURA_CUSTOMER_TABLET` as order sources. This is the single largest unowned feature in the repository.
- **Admin PIN console login** (`POST /api/auth/admin-pin`) — see §6.
- **Integration Tools** and **Payments** admin pages — exist with no epic coverage at all (not just no story).
- **Inventory** — tracked entirely outside the BMAD epic/story system, via a parallel `docs/superpowers/plans/` planning artifact. This is a dual-tracking-system gap: a real feature area with real frontend code that this audit's canonical BMAD sources (`epics.md`, `sprint-status.yaml`) do not reference at all.

**Implemented features with an epic but no story file (large class, ~40 items):** the majority of E4, all of E6 beyond `6-1`, all of E7, most of E8/E9/E10, and effectively all of E12/E13. See the CSV for the full per-item breakdown; §5 above summarizes each epic's pattern.

**Dormant queues (confirmed, not new):** `pos-sync` and `print-jobs` BullMQ queues are never fed by order creation despite real, transactional outbox rows being created for both. This is the single most consequential cross-cutting gap in the repository — it means E6, E8, and E9's "outbox" claims are each only half-true (persistence real, dispatch absent), and it is the same root cause in all three epics, not three independent gaps.

**Duplicate/dead code requiring a human decision:**
- Two live `TableManagementPage` components (`E3-S4`) — not resolved by this audit, flagged for human decision.
- Two independent KDS implementations (`E7-S1`) — both real, not a mock vs. real split.
- Two separate `KdsPinGate.tsx` components (kiosk-frontend and admin-frontend) — should be a shared package.
- One orphaned dead file each in `customer-frontend` (`AdminDailyEmail.jsx`, `PendingCalendarEvents.jsx`).

**APIs without UI consumers:** `pos-sync-records.controller.ts` (E9-S9), `printer-jobs.controller.ts`/`printer.controller.ts` (E8-S8), audit-log read path does not exist at all (see §9).

**UIs without real APIs (backed by mocks/static data):** Reporting (entire epic — backend is an empty stub), Dashboard home KPIs, Staff management, Audit log view, and (per `deferred-work.md`, not independently re-verified by every fork) Payments and Integration Tools.

---

## 8. Architecture and Target-Operating-Model Gaps

- The transactional-outbox **pattern** required by `target-operating-model.md` §2 is real and correctly implemented (single-transaction write of Order + POSSyncRecord + PrinterJob). The outbox **dispatch** half of the same requirement does not exist for either downstream queue. The operating model's "durable independent fan-out" language is therefore only half-satisfied by current code — the durability exists, the fan-out does not. **Clarification (independent review):** KDS delivery today works via a direct, synchronous WebSocket push from `orders.gateway.ts`, invoked in-process at order-creation time — it is not itself routed through a durable outbox+dispatch pattern; it simply isn't gated behind either of the two dormant queues, which is why it fires while POS/printer dispatch does not. The operating model's fuller "outbox command" framing for KDS is therefore not yet literally implemented either — it currently works by a different, simpler mechanism that happens to be reliable as long as the API process itself stays up.
- `E6-S4`'s in-person checkout path cannot reach the target operating model's Idealpos-first sequencing at all today, because no Idealpos submission code exists (separately, correctly blocked on DL-064 — this is not a new gap, but this audit confirms the Verdura-side prerequisite code that *would* feed it is otherwise ready).
- `E1-S8`/`E1-S9`/`E8-S1`/`E9-S2` all show the same architectural pattern: the on-premise/connector model described in `target-operating-model.md` §8 and `docs/integrations/idealpos.md` §13–§14 has not yet been extended to the printer or POS-sync subsystems as separate processes — both currently run in-process inside the cloud API, which is itself a documented anti-pattern (`docs/printers.md`'s own implementation-status banner already says this).
- KDS/KOT ownership (DL-063/DL-067) is architecturally sound in code — Verdura's WebSocket-based KDS fan-out is real — but nothing in the current codebase yet enforces or tests Idealpos duplicate-print suppression, because no Idealpos submission path exists yet to duplicate against. Not a regression; simply not yet reachable.

---

## 9. Security, Tenancy, and Data-Integrity Gaps

- **`POST kiosk/orders` remains fully unauthenticated** with a client-supplied `venueId` (confirmed again this session, `orders.controller.ts:39`) — already tracked as P1 in `deferred-work.md` (`E6-S10`).
- **Stripe Terminal endpoints have no auth guard** (`orders.controller.ts:43-55`) — a real, unmocked payment-adjacent surface with no access control, not previously named explicitly in `deferred-work.md`. New finding this session.
- **Media upload validates only the client-declared MIME type, not actual file-signature bytes** (`media.service.ts`) — spoofable; the separate path-traversal control in the same file is solid and should not be conflated with this gap.
- **`staff` and `audit` backend modules have no controller at all** — `StaffPage.tsx` and `AuditLogsPage.tsx` render entirely static/mock data because there is nothing for them to call. This means there is currently **no way to view audit logs from the Admin Dashboard at all**, despite story 2-8 real audit-writing logic existing.
- **`docker-compose.yml` ships plaintext insecure default secrets** via `${VAR:-default}` fallbacks — confirmed still present (pre-existing P1 in `deferred-work.md`).
- Row-Level Security is enabled with zero policies and the app connects as the schema-owning role (pre-existing P1 in `deferred-work.md`, not re-verified line-by-line this session but no evidence found contradicting it).
- Rate limiting coverage is broader than previously documented (now confirmed on kiosk/orders/reservations/KDS-auth endpoints, not just auth) — a positive correction to `deferred-work.md`'s implied scope.

---

## 10. Integration, Queue, Worker, and External-Evidence Gaps

- `pos-sync` and `print-jobs` BullMQ queues: rows created transactionally, never enqueued — confirmed dormant in both epics this session (see §7).
- No real Idealpos, EFTPOS, or payment-provider sandbox evidence exists anywhere in this repository — all Stripe code is exercised only against mocks in the test suite; the one non-test code path (`verifyKioskPayment`) explicitly short-circuits when `NODE_ENV=test`, meaning **no executed evidence of a real Stripe verification round-trip exists in this repository's test suite at all**, only real SDK-call code that has never been proven to run end-to-end within this codebase's own tests.
- The Idealpos API-less adapter architecture (`docs/integrations/idealpos.md` §12–§21, story `9-2`) remains entirely a documentation artifact from a prior session — zero code exists, correctly.
- No worker-level test exercises `PrintJobsProcessor`/`PosSyncProcessor` via a real running BullMQ `Worker` consuming a real enqueued Redis job — every test calls the processor's `process()` method directly (already disclosed in stories 8-1/9-1's own deferred-work entries, confirmed still true).

---

## 11. Testing and Verification Gaps

- Several `VERIFIED_COMPLETE`/`COMPONENT_COMPLETE` rows in the CSV rest on **unexecuted-but-present** test evidence (`UNIT_OR_MOCK`/`REAL_POSTGRES (reproducible, not re-run this session)`) rather than a freshly confirmed pass — this is disclosed per-row in the CSV's `strongest_evidence` column, not silently upgraded.
- `kiosk.controller.ts` (both the tables and menu endpoints, `E3-S5`/`E4-S9`) has **zero test coverage** despite being real, working, unauthenticated public-facing code.
- No integration/e2e test proves the KDS WebSocket push actually reaches a browser end-to-end; the wiring is real on both ends (confirmed by reading both the emitter and the real `socket.io-client` consumer) but never exercised as a single test.
- `npm audit` (E13-S6) was not run this session (external network contact out of scope) — genuinely unknown CVE status, not assumed clean.
- Only 2 of ~15+ backend DTO files were spot-checked for `E13-S3`; the pattern held in both, but a full sweep was not performed.

### 11.1 — Per-epic verification gap: "what production failure would current evidence miss?"

An independent reviewer answered this exact question per epic, verifying against real test files wherever one exists (E1–E9, E13 verified by opening the actual spec files; E10–E12, E14 assessed from the report/CSV since no test files exist to open for them):

| Epic | Undetectable failure mode |
| --- | --- |
| E1 | `queue.module.spec.ts` only asserts a string constant equals itself — a real Redis/BullMQ misconfiguration in production would leave every queue silently non-functional with this test still green. |
| E2 | `rate-limit.guard.spec.ts` mocks the Redis client's `eval` entirely — the real Lua rate-limit script never runs against real Redis; a script bug causing fail-open (all requests allowed) or fail-closed (all users locked out) would not be caught. |
| E3 | `tables.controller.spec.ts` stubs `JwtAuthGuard`/`RolesGuard` to always pass and mocks the service — a real authorization bypass or cross-venue scoping leak in the actual guard/service code would not be caught, because the pieces that would enforce it are stubbed out of the test. |
| E4 | Confirmed as a live gap, not just an untested corner: `media.service.spec.ts` proves upload validation trusts only the caller-supplied MIME-type string; a malicious file with a spoofed `image/jpeg` header would pass in production exactly as it passes in the test's own fake-bytes fixture. |
| E5 | `reservations.integration-spec.ts` gives strong real-Postgres coverage for capacity/FSM, but confirmation/cancellation email evidence is mock-only — a real Resend API-key/account failure in production could silently drop every confirmation email with nothing in CI ever calling the real Resend endpoint. |
| E6 | `orders.integration-spec.ts` never asserts anything about `POSSyncRecord`/`PrinterJob` dispatch, and Stripe verification explicitly short-circuits under `NODE_ENV=test` — a real paid kiosk order could be captured by Stripe successfully while its POS/printer outbox rows never reach a worker, and nothing would flag it. |
| E7 | `kds-auth.service.spec.ts` is fully mocked — a real WebSocket disconnect/reconnect race that silently drops an order push to the physical kitchen screen (staff simply never see the order) would not be caught; no test exercises the real socket.io round trip. |
| E8 | `printer-jobs.service.spec.ts` is fully mocked and tests only org/venue-scoping, not ESC/POS byte generation; combined with the confirmed-dormant queue, a real printer could receive garbled bytes or never receive the job at all, with nothing sending real or simulated bytes to a socket in any test. |
| E9 | `pos-sync.processor.spec.ts` calls `processor.process()` directly with a hand-built job object, never via a real BullMQ `Worker` consuming from Redis — a production serialization mismatch between what's enqueued and what the processor expects would bypass the test entirely, since it skips Redis's own (de)serialization. |
| E10 | (assessed from report/CSV) `DashboardPage.tsx`'s KPI tile wraps a hardcoded mock constant in a real-looking query hook with zero tests — a manager could view completely fake revenue numbers indefinitely with nothing to catch it. |
| E11 | (assessed from report/CSV) Backend is an empty stub; if shipped as-is with tests added only against the mock frontend, real sales/reservation data could be miscounted with nothing to catch it, since the epic has zero backend coverage today. |
| E12 | (assessed from report/CSV) No test files exist for any story; a real kiosk device could fail to enter fullscreen or fail to block Alt+F4/right-click, letting a customer escape to the underlying OS, with no browser-level test to catch it. |
| E13 | Beyond the E2/E4 findings above, security headers and CORS (`E13-S1`/`S2`) have no spec files at all — a real production misconfiguration (CSP broken by middleware reordering, wrong CORS origin deployed) would ship silently since nothing asserts actual response headers on a running server. |
| E14 | (assessed from report/CSV) Acceptance is satisfied purely by a static grep returning zero hits for "airtable" — no functional test exists; a residual dependency constructed dynamically or differently-cased could fail in production with nothing to catch it. |

---

## 12. Production-Readiness Gaps

This audit did not re-litigate the existing, still-current production-readiness verdict (`_bmad-output/planning-artifacts/final-launch-approval.md`: **NOT APPROVED FOR PRODUCTION OR AN ON-SITE POS-CONNECTED PILOT**; `docs/mvp.md`: **Controlled prototype; not approved for production or real-money operation**). Nothing found this session contradicts or resolves that verdict. The new findings in this report (dormant outbox dispatch confirmed across three epics, `2-6`'s overstated completion, the unauthenticated Stripe Terminal endpoints, the audit-log read-path gap) are all consistent with — and add concrete detail to — the existing "not production-ready" position rather than changing it in either direction.

---

## 13. Dependency-Ordered Next-Work Queue

### Ready now (prerequisites satisfied, small, well-specified)

1. **Wire the `pos-sync` and `print-jobs` BullMQ dispatch calls** (the single highest-leverage fix in this audit — closes the outbox gap in E6, E8, and E9 simultaneously). Prerequisites (transactional outbox writes, queue infrastructure, both processors) all already exist and are tested.
2. **Build a real `GET /admin/staff` + `staff.controller.ts`** and wire `StaffPage.tsx` to it — `staff.service.ts` already has the business logic; only the HTTP surface is missing.
3. **Build a real audit-log read endpoint** (`audit.controller.ts`) and wire `AuditLogsPage.tsx` — `audit.service.ts`'s write path is already real and tested.
4. **Add a magic-byte/content-sniffing check to `media.service.ts`** (E13-S4) — small, isolated, well-understood fix.
5. **Delete the two orphaned dead files** (`AdminDailyEmail.jsx`, `PendingCalendarEvents.jsx`) — trivial cleanup, zero risk.
6. **Add an auth guard to the Stripe Terminal endpoints** (`orders.controller.ts:43-55`) — small, high-value security fix.

### Needs story correction first (ambiguous, oversized, or contradictory)

- **`2-6` / admin login** — needs a new story documenting the real PIN-console design before any further auth UI work proceeds, so the next agent isn't misled by the existing story's unsatisfiable AC.
- **`E3-S4` / duplicate TableManagementPage** — needs a human product decision (consolidate vs. document distinct purposes) before any agent touches either file.
- **E11 Reporting** — the existing epic's stories (sales/top-items/reservation reports) are reasonably scoped, but building the real backend against the current fully-mocked frontend needs an explicit decision on whether the mock UI's exact interaction model is the target, or whether it gets rebuilt alongside the real API.
- **E1-S8/E1-S9/E8-S1/E9-S2** — the "separate on-premise process" framing has architecturally diverged (everything currently runs in-process in the cloud API); these need to be formally re-scoped or superseded before being picked up as-written.

### Blocked (external decision, hardware, or prerequisite story required)

- All real Idealpos adapter work (`E9-S3`–`S7`) — `BLOCKED ON: DL-064`.
- Idealpos API-less tracer (`9-2`) — blocked on live Windows discovery + story `2-9`.
- ESC/POS hardware dispatch (`E8-S2`) — `BLOCKED ON: Q2` (hardware confirmation).
- `E14-S4` (Google Calendar integration) — blocked on a product decision on whether calendar sync is still required at all.
- `npm audit` (E13-S6) — blocked on a session scoped to permit external network contact.

---

## 14. Human/Vendor Decisions Required

1. Which `TableManagementPage` is authoritative — consolidate or document the split (E3-S4).
2. Is calendar sync (E14-S4) still a product requirement?
3. Is the PIN-console admin login (replacing `2-6`'s email/password design) the intentional, permanent design — and if so, is a shared single PIN an acceptable identity model, or does it need to become per-staff?
4. Should Inventory move into the formal BMAD epic/story system, or remain governed by the separate `docs/superpowers/` planning track?
5. Should the Order Tablet feature be retroactively given its own epic, given its real size and the fact that `target-operating-model.md` already assumes its existence?
6. Idealpos vendor/reseller discovery (DL-064) — unchanged, still open from prior sessions.

---

## 15. Independent Review Results (2026-08-16, five fresh-context reviewers)

Five reviewers, each starting with no prior context beyond this report and the CSV, independently checked this audit against its own five mandated angles. One correction loop was applied (of three permitted); no second loop was needed.

- **Inventory-completeness reviewer:** confirmed all 113 `docs/epics.md` stories are represented in the CSV, confirmed all 37 `sprint-status.yaml` tracker entries are represented, independently re-derived every summary count in §4 from the raw CSV and got identical numbers, and independently re-confirmed the `2-6` headline finding (`LoginPage.tsx` absent, `AdminPinGate.tsx` present) from scratch. Found one ID-hygiene nit (the `9-2` dual-appearance noted in §5's E9 section) and one wording imprecision (the "30 files" figure, corrected in §4) — no missing, fabricated, or truly duplicated stories.
- **Evidence-challenge reviewer:** adversarially re-verified 10 sampled `VERIFIED_COMPLETE`/`COMPONENT_COMPLETE` rows plus this report's three most load-bearing claims (the `2-6` PIN-gate finding, the `DashboardPage.tsx` mock-KPI finding, and the `persistOrder` transactional-outbox finding) by reading the actual cited files. All three headline claims confirmed exactly as stated. One row (`5-5`) was found over-classified and corrected — see §6/§13's E5 update.
- **Architecture/TOM-alignment reviewer:** independently re-verified the outbox write/dispatch asymmetry (confirmed real), the KDS-fan-out-vs-POS-dispatch asymmetry (confirmed real, with one worthwhile nuance: KDS fan-out is a direct synchronous socket push, not itself an outbox+dispatch pattern — it works because it isn't gated behind either dormant queue, not because it follows the same durable-outbox design), checked every `VERIFIED_COMPLETE`/`COMPONENT_COMPLETE` row's dependency chain for a dependency on a `NOT_STARTED`/`BLOCKED` row (found none), and spot-checked epics.md's own `Dependencies:` lines against this report's epic narratives (all consistent). No corrections required.
- **Security/data-integrity reviewer:** independently re-verified all seven claims in §9 by reading the cited files directly (kiosk-order auth, Stripe Terminal auth, media MIME-only validation, missing staff/audit controllers, RLS-with-zero-policies) — all confirmed accurate as written. Additionally spot-checked tenant isolation on `venues`/`tables`/`orders` controllers (found genuine `organizationId`/`venueId` scoping in each, no new cross-tenant leak) and scanned for uncatalogued hardcoded secrets (found none beyond the already-disclosed labeled dev-only defaults). No corrections required; no new Section 9 finding beyond what was already listed.
- **Verification-gap reviewer:** answered "what production failure would current evidence miss?" for all 14 epics, opening real test files for 10 of them. Findings incorporated into the new §11.1 above — this was net-new content this audit's first draft did not contain, not a correction to an existing claim.

**Net effect of this correction loop:** one CSV row and its corresponding report narrative downgraded (`5-5`: `COMPONENT_COMPLETE` → `PARTIALLY_COMPLETE`), one new report subsection added (§11.1), two minor wording clarifications applied (§4 file count, §5 E9 ID-hygiene note), zero rows added or removed, zero epic assessments overturned.

---

## 16. Audit Limitations

- No tests were executed; all "real-Postgres" evidence tiers are marked "reproducible, not re-executed this session" rather than freshly confirmed.
- `npm audit` was not run (external network contact out of scope for this session).
- Several `E12`/`E8-S3`/`E8-S5` items are marked `UNCLEAR` where the assigned research fork's time budget did not reach a full read of the relevant file — these are honestly downgraded rather than guessed, per this audit's own instructions.
- Frontend component behavior (e.g., whether `KioskFullscreenShell` actually disables all keyboard shortcuts, whether `KioskWindowManagementPage.tsx` actually round-trips promotional-banner content to the signage page) was assessed from source reading only, not from running the application in a browser.
- This audit's 125-row inventory is reconciled against `docs/epics.md` as the roadmap source of truth; if requirements exist in `docs/prd.md`/`docs/superpowers/` that were never promoted into `epics.md` at all, they are not fully represented here beyond the Inventory cross-reference noted in §7.

---

## 17. Recommended Next Smallest Story

**Wire the `pos-sync` and `print-jobs` BullMQ enqueue calls in `orders.service.ts`'s `persistOrder`.**

- **Why unblocked:** the transactional outbox rows, the BullMQ queue infrastructure, and both consuming processors (with real, tested, truthful-state logic per stories 8-1/9-1) already exist. Only the `.add()` calls are missing.
- **Business value:** this is the single highest-leverage fix identified in this audit — it is the shared root cause behind gaps independently found in E6, E8, and E9.
- **Dependencies:** none beyond what already exists and is tested.
- **Principal risks:** this is explicitly named in stories 8-1/9-1's own deferred-work entries as "a first-time production behavior change, not a truthfulness fix to an already-running path" — it will cause real (currently-dormant) network/socket attempts to fire for the first time, so it needs its own reviewed story with real-environment testing, not a drive-by change.
- **Expected evidence tier:** `REAL_POSTGRES` + `REAL_REDIS_OR_QUEUE_WORKER` (a real BullMQ worker actually consuming a real enqueued job — currently the one evidence tier no existing test in this repository reaches).
- **Fits one focused BMAD session:** yes — scope is narrow (two `.add()` call sites plus their queue-option config), but should include a real running-worker test as its Definition of Done, closing the gap named in §10.

This story is **not implemented in this audit session**, per this session's explicit scope.
