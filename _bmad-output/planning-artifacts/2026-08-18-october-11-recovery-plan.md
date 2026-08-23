# 11 October Recovery Plan — Order Tablet → Idealpos → EFTPOS → KDS/KOT

> **Correction addendum — 2026-08-21 (`docs/decisions-log.md` DL-088).** §1 and §4's "0 of Epic 15's 12 stories are `done`" was accurate the instant it was written but has been stale since the same day: `15-1` and `15-4` were completed later on 2026-08-18, and `15-3` on 2026-08-19 (see `sprint-status.yaml`'s own dated comments and `_bmad-output/implementation-artifacts/2026-08-20-october-critical-path-matrix.md`). Current, authoritative count: **3 of 12 done** (`15-1`, `15-3`, `15-4`). §1's SSH/Windows-access framing ("no session to date has had" live access) is also stale: `_bmad-output/implementation-artifacts/table19-live-test-checklist.md` records that a **read-only** SSH route to the target Windows host now exists — still far short of any live Windows/IdealPOS/EFTPOS/KOT evidence, but no longer "no access." This banner corrects the record; the original text below is preserved unmodified as historical evidence of this plan's state on 2026-08-18.

**Date:** 2026-08-18
**Baseline commit:** `175cbbd` (main, unchanged by this plan)
**Author role:** BMAD planning-correction pass, in response to the 2026-08-18 forensic audit (`docs/audits/enterprise-readiness-audit.md` lineage; full audit text reproduced nowhere in this repo verbatim — see §2 for how it was validated)
**Status:** Planning correction complete. Application code, tests, database, Git state, cloud resources and Idealpos/EFTPOS/KDS/KOT systems are unchanged by this document or the pass that produced it.

This is the single consolidated recovery/readiness artifact required by this pass. It does not duplicate the full prose already recorded in `docs/epics.md`, `docs/decisions-log.md`, `_bmad-output/implementation-artifacts/sprint-status.yaml`, and `_bmad-output/implementation-artifacts/deferred-work.md` — it indexes and sequences that material into one dependency-ordered, evidence-gated plan. Where this document and any of those four files appear to disagree, the four files (edited directly, closer to the evidence) are authoritative; report the discrepancy rather than trusting this summary.

---

## 1. Go/No-Go — 11 October

**Assessment: NO-GO at current pace, as scoped.** This is not reopened by this plan — the fixed date stands per owner direction. What follows are the objective conditions that would recover it, and the external gates beyond which it becomes objectively unrecoverable.

Zero of Epic 15's 12 stories are `done`. Two of the three P0 blockers the audit found (no real Idealpos adapter; the Windows connector's UI-automation client has never run against a real Idealpos installation) are not engineering backlog — they are blocked on vendor access and physical hardware that no session to date has had. The third (the KOT print queue has no producer) is buildable without external access but is not a small fix.

**Objective conditions to recover the date, all required:**

1. **Decision 1** (Idealpos access route, `DL-079`) resolves to a viable route — either vendor confirmation or a disclosed-risk commitment to the API-less UI Automation route already selected for discovery (`DL-071`).
2. **Decision 2** (real target access, `DL-080`) delivers live Windows/Idealpos/EFTPOS/KDS/KOT access by **no later than early-to-mid September 2026** — see §7's required-by dates. This is the single hardest external deadline in the plan.
3. **Decision 3** (Order Tablet auth, `DL-081`) is made before `E15-S6`/`E15-S10` are built, so payment-confirmation and audit-attribution work isn't built against an identity model that changes later.
4. The immediately-startable, parallelizable engineering work in §7 (Track A) is substantially complete **before** real access arrives, so the external-access window is spent on `9-2`'s remaining discovery scope, `E15-S5`–`E15-S12`, and the on-site pilot — not on work that could have been done in parallel.
5. `9-2`'s remaining scope (live Windows/Idealpos UI discovery) and the resulting adapter-viability call both close without discovering a dead end (e.g. Idealpos UI automation proves infeasible, or licensing prohibits it).
6. `E15-S5` through `E15-S12` execute and each passes its own real-evidence-tier gate (§8) — no story here may be marked complete on mocked/simulated evidence.
7. An on-site production pilot (`E15-S12`) proves the full vertical slice (§8) including rollback and operator recovery.

**Objective no-go thresholds:**

| Threshold | Date | If missed |
|---|---|---|
| Live Windows/Idealpos access secured (Decision 2) | Early-to-mid September 2026 (rough, capacity-unverified — see `DL-080`) | No real Idealpos/EFTPOS/KDS/KOT leg can exist by 11 October; the venue continues its current manual/EFTPOS workflow outside Verdura for those functions on that date |
| Decision 1 resolved | Same practical bottleneck as above — whichever resolves later sets the true gate | Same as above |
| Decision 3 resolved | Within 1–2 weeks of this plan's circulation, and before `E15-S6`/`E15-S10` build starts | Continued building against the current inconsistent PIN/JWT state risks rework, not an outright date-miss on its own |
| `9-2` remaining scope + adapter-viability call closes | As soon as access (above) is granted | If Idealpos UI automation proves infeasible, the October Idealpos leg has no fallback route inside this plan's current scope |

If any of 1, 2, or 5 above resolve unfavourably or too late, the correct action is a scope/date conversation with the owner, not silent slippage — this is the audit's own top recommendation and this plan does not override it.

---

## 2. Audit validation

The audit's 13 sections were independently cross-checked against current source (branch `main` @ `175cbbd`, zero drift from the audit's own baseline) in a dedicated read-only validation pass. **All 13 checked claims were CONFIRMED against exact file:line evidence; none were contradicted.** Confirmed, with file:line citations retained in this pass's working notes (not reproduced here to avoid staleness as line numbers shift):

- Order Tablet: fabricated 10% service charge, additive GST on a GST-inclusive price, `handlePayAll` is a bare status PATCH with no gateway call, `handlePrintBill` is a UI-only state flip, zero test files.
- `pos-sync.processor.ts`'s own doc comment: `synced`/`failed` are structurally unreachable without a real adapter.
- Connector command protocol implements exactly one type, `connector.self_test.v1` (synthetic, side-effect-free).
- `WindowsUiAutomationClient.cs`'s own doc comment: "UNVERIFIED ... has not been run against a real Idealpos window."
- `orders.service.ts` creates `PrinterJob` rows via `tx.printerJob.create()` but no `.add()` call to the BullMQ print-jobs queue exists anywhere in `apps/api/src` — the registered `PrintJobsProcessor` consumer is fully built and tested but never fed.
- Story 15.1 auth inconsistency: `KdsPinGate` (shared PIN) vs `ProtectedRoute` (JWT) for the same tablet UI, confirmed in `App.tsx`.
- Window Display (`apps/window-display`) still contains a live, reachable Stripe Terminal checkout flow (`KioskOrderPage.tsx`).
- Two independent KDS implementations (`admin-console/.../KitchenDisplayPage.tsx`, `window-display/.../KdsPage.tsx`) confirmed.
- Two independently-sized, separately-routed table-management implementations confirmed (not an alias) — `apps/admin-console/src/pages/settings/TableManagementPage.tsx` (`/settings/tables`, 495 lines) and `apps/admin-console/src/pages/table-management/TableManagementPage.tsx` (`/table-management`, 832 lines).
- No `.github/workflows/` directory anywhere in the repo.
- `apps/api/.git/` (nested repo, contains only an `sdd/` subdirectory) and both `.worktrees/*` directories (gitdir pointers to a different machine/user, `/home/cyrus/Documents/verdura/...`) confirmed, with sizes matching the audit's figures (`.git` 622M, `.worktrees` 725M, root `node_modules` 749M, repo total 2.2G).
- EFTPOS: only fixture/mock data and static UI badges found anywhere in application source; no real integration logic.

No P0/P1 audit finding was found to be stale, exaggerated, or contradicted by current source. Where the audit and this repository's own documents disagreed on a secondary point — the tablet's GST handling — this repository's own record (`DL-072`) is more recent and more authoritative than the audit's characterization, and is what this plan and the corrected tracker follow (see §3).

---

## 3. Reconciled story inventory

**Baseline (audit-reported):** 51 stories — 32 `done` / 13 `backlog` / 5 `blocked` / 1 non-canonical (`5-4: review`).

**Corrections applied (no evidence changed, only mislabeled tracker entries):**
- `5-4-email-confirmation-cancellation`: `review` → `in-progress`. `review` is not a member of the tracker's own status vocabulary (`backlog`/`ready-for-dev`/`in-progress`/`done`/`skipped`/`blocked`, defined in `sprint-status.yaml`'s own header). The story's implementation is complete (208/208 tests, lint clean) but its file carries no independent code-review record — `done` requires dev-story *and* code-review complete per the tracker's own definition; only the first half is evidenced. Not on the October critical path.
- `15-1-tablet-venue-and-auth-decision`: `backlog` → `blocked`. A story file already exists for 15-1 (`backlog` means none does, per the tracker's own definition), and that file's own Status header already reads "blocked (auth-identity sub-scope only)". The tracker previously contradicted its own story file. The venue tax/locale metadata sub-scope of this same story is `done` (2026-08-17, `DL-072`) — this is a genuine split-completion case, represented as `blocked` because the story's remaining required sub-scope (auth identity) is blocked, per this tracker's convention that any story with a blocked required sub-scope is `blocked`, not `backlog`.

**New stories filed (Phase 4 ownership gaps, all `backlog`, none implemented):**

| Story | Owns | Epic |
|---|---|---|
| `3-6-consolidate-table-management-duplicate` | Reconcile the two live, unmerged table-management implementations | E3 |
| `16-1-connector-print-observability-alerting` | Connector/print-pipeline observability and alerting | E16 (new) |
| `16-2-backup-restore-outage-replay-testing` | Backup/restore + outage/replay testing for connector/pos-sync/print queues | E16 |
| `16-3-ci-regression-gates` | CI (promotes `1-5-github-actions-ci`) — lint/typecheck/unit/integration on every PR | E16 |
| `16-4-rls-policy-enforcement` | RLS enabled with zero policies (18 tables) | E16 |
| `16-5-kiosk-order-creation-venue-binding` | Unauthenticated, venue-unbound kiosk order creation (promotes `E6-S10`) | E16 |
| `16-6-docker-default-secrets-hardening` | Docker Compose insecure default secrets | E16 |
| `16-7-operator-ui-printerjob-possync-state` | Operator UI for `PrinterJob`/`POSSyncRecord` state (`/printers`, `/pos-sync` are stubs) | E16 |

**Reconciled totals:**

| Stage | Total | done | backlog | blocked | in-progress | invalid |
|---|---|---|---|---|---|---|
| Audit baseline | 51 | 32 | 13 | 5 | 0 | 1 |
| After status corrections | 51 | 32 | 12 | 6 | 1 | 0 |
| After +8 new stories | **59** | **32** | **20** | **6** | **1** | **0** |

Verified by direct count against `sprint-status.yaml`'s `development_status:` block: 32 `done` entries, 20 `backlog`, 6 `blocked`, 1 `in-progress`, summing to 59 total story lines. No epic was renumbered; no existing story's evidence was altered — only the two corrections and eight additions above changed the count. **No P0/P1 audit finding lacks a story or a decision-gate owner** — every gap in Phase 4 of the driving instructions maps to exactly one of the stories above or one of the eight decisions in §6.

---

## 4. Epic 15 status matrix — the complete October critical path

**0 of 12 done**, matching the audit exactly. All statuses below are identical across `sprint-status.yaml`, `docs/epics.md`, and (where a story file exists) the story file itself — cross-checked as part of this pass's validation (§9).

| Story | Status | Blocker | Evidence tier today |
|---|---|---|---|
| 15-1 tablet venue & auth decision | `blocked` (split — see §3) | Decision 3 (`DL-081`), auth sub-scope only | `INTEGRATION_LOCAL` (metadata sub-scope, done) / `PLANNED_ONLY` (auth sub-scope) |
| 15-2 real table/order lifecycle | `backlog` | none — unblocked | `PLANNED_ONLY` (underlying endpoints are real; story itself not filed) |
| 15-3 menu/modifier integrity | `backlog` | none — unblocked | `PLANNED_ONLY` |
| 15-4 idempotent submission + truthful totals | `backlog` | none — unblocked | `PLANNED_ONLY` |
| 15-5 Idealpos handoff | `blocked` | `DL-064` / Decision 1 (`DL-079`) | `PLANNED_ONLY` |
| 15-6 EFTPOS/cash handoff | `blocked` (card path only; cash path unblocked) | 15-5 (card path) | `PLANNED_ONLY` |
| 15-7 KDS/KOT routing + dedup | `blocked` | story 9-2 (blocked) + `DL-067` | `PLANNED_ONLY` |
| 15-8 bill/settlement/closure | `backlog` | depends on 15-6 for closure gate | `PLANNED_ONLY` |
| 15-9 offline/retry/recovery | `backlog` | none — unblocked (coordinate with E6-S6) | `PLANNED_ONLY` |
| 15-10 reconciliation/audit visibility | `backlog` | depends on 15-5/15-6/15-7 for full correlation | `PLANNED_ONLY` |
| 15-11 automated test coverage | `backlog` | none — unblocked | `PLANNED_ONLY` (zero test files exist today) |
| 15-12 real E2E acceptance (terminal gate) | `blocked` | every other E15 story + `DL-064` + real on-site access | `PLANNED_ONLY` — the only story permitted to produce `REAL_WINDOWS_CONNECTOR`/`REAL_IDEALPOS`/`REAL_EFTPOS`/`REAL_KDS`/`REAL_KOT_PRINTER` evidence |

---

## 5. Owner decision register

All eight required decisions are formally recorded in `docs/decisions-log.md` as `DL-079` through `DL-086`, each with the full question/evidence/options/recommendation/trade-offs/affected-stories/severity/owner/required-by/safe-default/effect-on-Oct-11 structure. None is silently decided — each carries a recommendation only, pending the named owner's sign-off. Summary:

| # | Decision | DL | Recommendation | Owner | Severity |
|---|---|---|---|---|---|
| 1 | Idealpos access route | `DL-079` | Pursue vendor confirmation in parallel with clearing route 4's (API-less UI Automation) live-discovery gate — don't wait serially | Idealpos relationship owner | Critical-path |
| 2 | Real target access (Windows/Idealpos/EFTPOS/KDS/KOT) | `DL-080` | Single combined on-site session covering discovery + EFTPOS/KDS/KOT observation + story 9-2's tracer together | Venue owner + Idealpos relationship owner | Critical-path, external |
| 3 | Order Tablet authentication | `DL-081` | Hybrid — shared PIN for fast table-side re-entry within an authenticated shift, JWT for the shift/session boundary | Product/security owner | High |
| 4 | Window Display Stripe flow + duplicate KDS | `DL-082` | Fail-closed/feature-gate for October (not retire, not adopt) | Product owner | Medium for Oct / High for operating-model integrity |
| 5 | Git delivery boundary | `DL-083` | Commit now, in logical slices, independent of Epic 15 progress, once Decision 8 clears | Repository owner | High for data-loss risk |
| 6 | Broken worktrees | `DL-084` | Focused content review (excluding disposable `node_modules`) before any disposition | Repository owner / worktree creator | Low for October |
| 7 | Git history rewrite | `DL-085` | Defer until Decision 5's commits are stable and backed up | Repository owner, all-machine coordination | Low |
| 8 | Nested repo `apps/api/.git` | `DL-086` | Confirm provenance with whoever last worked in `apps/api` before any commit staging touches that directory | Repository owner | High for commit-boundary work only |

Decisions 5–8 are repository-stabilization concerns, kept deliberately separate from the product critical path (§10).

---

## 6. Fixed-date critical path — dependency-ordered

Two tracks run in parallel: **Track A** (no external dependency, startable immediately) and **Track B** (gated on owner decisions or vendor/physical access). Track A should be substantially complete before Track B's access window opens, so that window is spent on what only real access can unlock.

### Track A — immediately startable, parallelizable

| Story | Objective | Prerequisite | Owner | Effort | Evidence required | Rollback/fallback |
|---|---|---|---|---|---|---|
| 15-4 | Remove fabricated 10% service charge; correct GST-inclusive provisional total per `DL-072` | None | Frontend + product | M | `STATIC_ANALYSIS` + unit tests on `totals` computation | Revert to current (known-defective) display if a regression is found — no data migration involved |
| 15-2 | Formalize existing real table/order-lifecycle endpoints as tested AC | None | Backend + frontend | S | `INTEGRATION_LOCAL` | N/A — no behavior change, only test coverage |
| 15-3 | Replace hardcoded modifier-group matching with real `MenuItem`/modifier config; remove fake promo toggle | Coordinate with E4-S5 | Backend + frontend | M | `INTEGRATION_LOCAL` | Keep promo UI hidden until a real entity exists, per this story's own AC |
| 15-9 | Bounded local offline queue for order submission/status transitions | Coordinate with E6-S6 | Frontend | M | `INTEGRATION_LOCAL` | Falls back to current fail-fast behavior (honest, not resilient) if not completed in time |
| 15-11 | Add automated coverage for `OrderTabletPage.tsx` | Can begin now, extend as 15-2/15-3/15-4 land | Frontend | M | `UNIT_OR_MOCK` + `INTEGRATION_LOCAL` | N/A |
| E8-S1 (KOT dispatch producer) *(backlog, not yet story-filed in `sprint-status.yaml` — see `docs/epics.md` E8)* | Wire the missing `PrinterJob`→queue producer via connector-mediated pull/claim/lease dispatch (DL-069-compliant) | None for the cloud-side logic | Backend + connector | L | `INTEGRATION_LOCAL` (cloud-side); real on-prem validation needs a real printer, not blocked on Idealpos access | No production dispatch path may open a direct cloud-to-LAN socket — this is enforced by construction, not a rollback concern |
| 16-1 | Connector/print-pipeline observability + alerting | Coordinate with E8-S1/15-10 | Backend | M | `INTEGRATION_LOCAL` | N/A |
| 16-3 | CI: lint/typecheck/unit/integration on every PR, blocking merge | None | DevOps | S–M | Green CI run, reproducible | N/A |
| 16-4 | RLS: real per-tenant policies + non-owner connecting role, or remove the misleading `ENABLE ROW LEVEL SECURITY` statements | None | Backend/security | M | Migration + policy tests | N/A — defense-in-depth only, app-layer scoping is the current actual boundary |
| 16-6 | Docker Compose default-secret hardening | None | DevOps | S | Config review | N/A |
| 16-7 | Operator UI for `PrinterJob`/`POSSyncRecord` state (extend existing `/printers`, `/pos-sync` stub routes) | None — backend APIs already exist | Frontend | M | `INTEGRATION_LOCAL` | N/A |
| 3-6 | Consolidate or explicitly retain the two table-management implementations | None | Frontend | S–M | Decision recorded either way | N/A |

### Track B — gated on owner decisions or external access

| Story | Objective | Prerequisite | Owner | Effort | Evidence required | Can start without real Idealpos access? | Completion gate | No-go threshold |
|---|---|---|---|---|---|---|---|---|
| 15-1 (auth sub-scope) | Ratify/implement the tablet auth model | Decision 3 (`DL-081`) | Product/security + frontend | S–M | `INTEGRATION_LOCAL` | Yes | Decision recorded + both entry points consistent | Should resolve within 1–2 weeks of this plan's circulation |
| 15-5 | Real Idealpos-order-submit `ConnectorCommand` type, PLU/mapping, authoritative totals, uncertain-outcome handling | `DL-064` / Decision 1 (`DL-079`); story 2-10's protocol (done) | Backend + connector | XL | `REAL_IDEALPOS` for the terminal claim; `INTEGRATION_LOCAL` for the command-protocol plumbing | No — the adapter itself cannot be proven without a real target, though the command-type/mapping-table scaffolding can be built against the protocol now | A real Idealpos-confirmed `synced` transaction with persisted reference | This is the single largest lever on the whole date — see §1 |
| 9-2 (remaining scope) | Live Windows/Idealpos UI discovery | Decision 2 (`DL-080`) | Whoever secures physical/remote access | M (once access exists) | `REAL_WINDOWS_CONNECTOR` + `REAL_IDEALPOS_UI_DISCOVERY` | No — definitionally requires the real machine | Every item in `docs/discovery/idealpos-live-discovery-checklist.md` answered from direct observation or a recorded vendor response | Early-to-mid September 2026 (§1) |
| 15-6 | Real EFTPOS/cash payment-confirmation gate, per-seat reconciliation, void/refund/retry/reprint | 15-5 (card path); cash path unblocked | Backend + frontend | L | `REAL_EFTPOS` for card; `INTEGRATION_LOCAL` for cash | Cash path: yes. Card path: no | A real Idealpos-reported EFTPOS transaction reference before `completed` | Same as 15-5 |
| 15-7 | KDS/KOT routing + duplicate-print prevention | story 9-2 + `DL-067` | Backend + connector | M | `REAL_KDS`/`REAL_KOT_PRINTER` for the terminal claim | No | Idealpos confirmed not to double-print a Verdura-originated KOT | Same as Decision 2 |
| 15-8 | Real `PrinterJob`-backed bill print; gate table closure on real payment state | 15-6, E8-S1 | Frontend + backend | M | `REAL_KOT_PRINTER` | Partially — the `PrinterJob` plumbing can be built now; the "real printed bill" claim needs a printer | Real, non-`queued` print confirmation before "bill printed" is shown | — |
| 15-10 | Full order↔Idealpos↔EFTPOS↔KDS↔KOT correlation view | 15-5/15-6/15-7 | Backend + frontend | M | `INTEGRATION_LOCAL` (view) / real references once upstream stories land | Yes for the view scaffold; no for real correlated data | Every reference traceable end to end from one operator view | — |
| 15-12 | Real on-site E2E acceptance + rollback proof | Every other E15 story + `DL-064` + real on-site access | Whoever runs the pilot | L | `PRODUCTION_PILOT` | No | Full vertical slice (§8) proven on the authorised Windows/Idealpos venue environment, with rollback and operator recovery demonstrated | Terminal gate — 11 October itself |

**Vendor-blocked (cannot proceed regardless of engineering capacity):** 15-5's real-adapter claim, 9-2's remaining discovery, 15-6's card path, 15-7, 15-12 — all gated on Decisions 1 and 2.
**Windows/on-site-blocked specifically:** 9-2, 15-12, and the real-evidence tier (not the scaffolding) of 15-5/15-7/15-8.
**Owner-decision-blocked only (no vendor/hardware dependency):** 15-1's auth sub-scope (Decision 3).

Non-critical (§9, tracked separately, not sequenced here): `16-2`, `16-5` (unless Window Display's legacy flow stays live — see Decision 4), Decisions 5–8's repository-stabilization actions.

---

## 7. Vertical-slice acceptance gate — the terminal October proof

No story above may substitute mocked/simulated/local evidence for this gate. This is the complete journey `E15-S12` must prove on the real Dunedin venue environment:

1. Staff/customer authenticates to Order Tablet (per Decision 3's ratified model).
2. Table, seat, items, modifiers and notes are validated against real configuration (15-2, 15-3).
3. Verdura creates an idempotent order (15-4).
4. Verdura submits it through the Venue Connector (15-5, on story 2-10's protocol).
5. Idealpos accepts it and returns authoritative references and totals (15-5).
6. Verdura blocks any price/GST/rounding conflict between its provisional total and Idealpos's authoritative one (15-4/15-5, `DL-072`).
7. The order reaches KDS (15-7).
8. Connector-mediated KOT work reaches the correct preparation-station printer (E8-S1, 15-7).
9. Idealpos initiates and records EFTPOS (15-6).
10. Verdura records truthful POS, payment, KDS and printer states throughout (15-10, reusing 8-1's and 9-1's truthful-state models).
11. Duplicate, retry, crash, timeout, offline and uncertain-result scenarios remain safe at every step above (15-9, and each story's own idempotency/uncertain-state AC).
12. Reconciliation traces every system reference end to end (15-10).
13. The journey is proven on the authorised Windows/Idealpos venue environment, not a demo/mock/local target (9-2's real access, 15-12).
14. An on-site pilot proves rollback and operator recovery (15-12, 16-1/16-7 for the operator-facing half).

---

## 8. Scope boundaries — explicitly excluded from this plan

- Online/prepaid payment (`E6-S9`) remains out of scope — no code exists for it, correctly.
- Idealpos is never made optional — every story above assumes Idealpos remains the POS/payment system of record.
- Window Display's Stripe flow is not silently preserved — Decision 4 requires an explicit fail-closed/gate/retain choice, defaulting to fail-closed for October per this plan's recommendation.
- No production printing path may open a direct cloud-to-LAN socket (DL-069, enforced by construction in E8-S1's expanded AC).
- No UI button marks payment complete without authoritative Idealpos/EFTPOS evidence (15-6's AC).
- No fabricated transaction reference is ever accepted or displayed (15-5's AC, `9-1`'s existing truthful-state model).
- Queued is never treated as delivered; timeout is never treated as definitive success or failure (this rule already governs 8-1's and 9-1's done state machines and is extended to every new/expanded E15 story).
- Verdura's provisional total is never the final EFTPOS charge — Idealpos's authoritative total always is (`DL-072`, 15-5/15-6).
- No Verdura surface adds GST to an already GST-inclusive price (`DL-072`; the open question of whether shared `computeTotals`/kiosk logic has the same defect is explicitly out of Epic 15's scope, not resolved by this plan).
- CRM, loyalty, workforce, finance, analytics or any other deferred feature area is not pulled onto this critical path — E10–E12/E14 remain untouched by this pass.

---

## 9. Repository-stabilization workstream — separate from product delivery

Kept explicitly off the product critical path per Decisions 5–8. Classification:

| Item | Classification | Gate |
|---|---|---|
| `apps/api/.git` nested repo | **Threatens safe commits immediately** | Decision 8 (`DL-086`) — provenance must be confirmed before staging anything under `apps/api` |
| Uncommitted restructure + GCS migration work (Decision 5) | **Requires owner approval to sequence, but is itself low-risk to commit once Decision 8 clears** | Decision 5 (`DL-083`) |
| `.worktrees/inventory-ui-redesign`, `.worktrees/inventory-foundation` | **Requires owner approval** — do not delete; content review needed first | Decision 6 (`DL-084`) |
| Local disk housekeeping (`node_modules`, `dist/`, `local-postgres/data` if services stopped) | **Safe cleanup, local-disk only, does not touch `.git`** | No owner sign-off strictly required, but out of scope for this pass regardless (no deletions performed here) |
| Git history rewrite (~332 MB dead media blobs) | **Requires history rewriting — separate authorization** | Decision 7 (`DL-085`) — explicitly deferred until Decision 5's commits are stable and backed up |
| Adding `apps/api/.git/` to root `.gitignore` | Safe, config-only change | Not performed by this pass (out of scope: no Git state or ignore-rule changes) — recommended for whoever executes Decision 5 |

None of the above was executed by this pass. No deletion, staging, commit, stash, clean, ignore-rule change, or history rewrite occurred.

---

## 10. Validation performed

- **Story ID cross-references:** every story ID cited in this document, `docs/epics.md`, and `sprint-status.yaml` was checked for internal consistency (e.g. `15-5` referenced from `15-6`'s blocker, `15-7`'s blocker on `9-2` and `DL-067`) — no dangling or contradictory references found.
- **Status-vocabulary conformance:** every story in `sprint-status.yaml` now uses one of the six defined values (`backlog`/`ready-for-dev`/`in-progress`/`done`/`skipped`/`blocked`); `5-4`'s prior `review` value was the only non-conforming entry and is corrected (§3).
- **Story-count reconciliation:** §3's table reconciles 51 → 59 with every new/changed line accounted for; verified by direct count against the tracker file, not by arithmetic alone.
- **October-requirement ownership:** every capability named in the driving instructions' Phase 4 (A–E) maps to exactly one story — see §3's new-story table and §6/§7's story references. No orphaned P0/P1 finding remains without a story or decision-gate owner.
- **Dependency ordering:** §6's Track A/Track B split and each row's "prerequisite" column were checked for cycles — none found (e.g. 15-8 depends on 15-6 depends on 15-5 depends on Decision 1/DL-064, a strict chain, not a cycle; E8-S1 has no upstream story dependency).
- **Eight owner decisions present:** confirmed all of `DL-079`–`DL-086` exist in `docs/decisions-log.md` with the full required structure (§5).
- **Epic 15 status agreement:** all 12 stories' statuses were checked across `sprint-status.yaml`, `docs/epics.md`, and the one existing story file (`15-1`) — consistent (§4).
- **Vertical-slice completeness:** §7's 14 steps were checked against the driving instructions' own list — complete, no step omitted.
- **Repository cleanup separation:** §9 confirmed separate from §6/§7's product path; no repository-stabilization item appears on the product critical path except where explicitly noted as a commit-boundary prerequisite for continuing to work safely (Decision 8 blocking Decision 5).
- **Historical evidence intact:** no `done` story's original evidence text was altered; corrections were appended as dated notes (`docs/decisions-log.md`, `sprint-status.yaml` comments, `deferred-work.md`'s dated correction blocks), consistent with the instruction not to rewrite dated evidence.
- **No application code, test, database, Git state, cloud resource, deployment, Idealpos, payment, or KOT print action was taken** by this pass — confirmed by `git status` showing only planning-document modifications (`docs/epics.md`, `docs/decisions-log.md`, `docs/architecture.md`, `_bmad-output/implementation-artifacts/sprint-status.yaml`, `_bmad-output/implementation-artifacts/deferred-work.md`, and this new file) among the changes attributable to this pass.

---

## 11. Final handoff

1. **Status:** Planning-correction complete. BMAD now represents audited reality; the fixed-date critical path is dependency-ordered and evidence-gated; all eight owner decisions are recorded pending sign-off.
2. **Files updated:** `docs/epics.md`, `docs/decisions-log.md`, `docs/architecture.md` (two stale pre-restructure path references only), `_bmad-output/implementation-artifacts/sprint-status.yaml`, `_bmad-output/implementation-artifacts/deferred-work.md`, and this new consolidated artifact.
3. **Corrected counts:** 51 → 59 stories (§3); Epic 15 = 0/12 done, confirmed matching the audit exactly (§4).
4. **Status corrections:** `5-4` `review`→`in-progress`; `15-1` `backlog`→`blocked` (§3).
5. **New/expanded stories:** 8 new (`3-6`, `16-1`–`16-7`); `E15-S5`, `E15-S6`, `E15-S10`, `E8-S1` expanded in `docs/epics.md` per Phase 4 A–C; rationale in §3 and inline in `docs/epics.md`.
6. **Eight owner decisions:** `DL-079`–`DL-086`, full detail in `docs/decisions-log.md`, summarized in §5.
7. **Critical-path sequence:** §6 (Track A immediately startable/parallel; Track B gated).
8. **Immediately startable/parallelizable:** 15-2, 15-3, 15-4, 15-9, 15-11, E8-S1 (KOT dispatch producer, cloud-side), 16-1, 16-3, 16-4, 16-6, 16-7, 3-6 — twelve items, none blocked on any owner decision or external access.
9. **Externally blocked:** 15-5's real-adapter claim, 9-2's remaining scope, 15-6's card path, 15-7, 15-12 — all on Decisions 1/2 (`DL-079`/`DL-080`).
10. **No-go gates and required-by dates:** §1's table — the hardest is live Windows/Idealpos access by early-to-mid September 2026.
11. **Repository-stabilization blockers:** §9 — `apps/api/.git` provenance (Decision 8) is the immediate commit-safety blocker; worktrees and history rewrite are owner-approval items, not immediate blockers.
12. **Vertical-slice acceptance criteria:** §7, fourteen steps, terminal gate is `E15-S12`.
13. **Validation results:** §10 — all checks passed; no contradictions found.
14. **Unresolved owner questions:** the eight decisions in §5/`docs/decisions-log.md` — none answered by this pass.
15. **Single next smallest unblocked critical-path story:** **`15-4`** (remove the fabricated 10% service charge; correct the GST-inclusive provisional total per `DL-072`) — no prerequisite, no owner decision required, `M` effort, well-specified acceptance criteria already in `docs/epics.md` E15-S4. `15-2`/`15-3`/`16-3` are equally unblocked and can run in parallel with it, but `15-4` fixes the single most visible billing-integrity defect the audit named and is the smallest of the four.
16. **Confirmation:** No application code, test, database schema/data, Git staging or history, GCS resource, MediaAsset functionality, Windows connector implementation, or Idealpos/EFTPOS/KDS/KOT runtime system was changed, deployed, or contacted by this pass. All changes are confined to the six planning documents listed in item 2.
