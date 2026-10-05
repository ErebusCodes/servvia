# Servvia — Sprint Change Proposal (BMAD reconciliation from the normative PRD), 2026-10-05

> **PLANNING / EXECUTION-STATE EVIDENCE — NOT REQUIREMENTS AUTHORITY.** Requirements authority is `PRD/product-requirements.md` and the normative volumes `PRD/00`–`PRD/09`. This file is the frozen BMAD reconciliation target (revision 2 plus the decisions recorded in §17 and the checkpoint state in §18). It is published as a checkpoint record and is not a BMAD workflow input until Story 14.2 re-anchors BMAD.

> **Status:** **REVISION 2 — CORRECTED AND FROZEN PLANNING TARGET (2026-10-05).** Revision 1 is retained only as local evidence (not published). Orchestrator verdict on rev 1: REVISE. Rev 2 records D-1 (APPROVED — TIER 2), reclassifies O-10 and O-13, decomposes O-3/O-4/O-5/O-6, restates P13, rebuilds the pilot critical path and native sequencing, and reduces the decision docket. Wave A remains **NOT AUTHORIZED**. Planning only. No code, migration, contract, test, CI or configuration was changed. No git write occurred.
> **Format:** BMAD correct-course ("sprint change proposal") structure. The BMAD skill was **not invoked**: its installation in the original checkout is deleted in the working tree, and its accepted copy lives only in the `integration/accepted-batch-2` lineage. This proposal is the input for running `bmad-correct-course` / `bmad-sprint-planning` on the integrated baseline after Wave A.
> **Requirements authority:** `PRD/product-requirements.md` (SPRD) → `PRD/README.md` → volumes 00–09 (normative 2026-10-05) → ADR 0001, ADR 0002, recorded Tier-2 decisions. `docs/planning/` and the pre-normative `epics.md` are history only.

---

## 1. BMAD inventory and authority

| Artifact | Location | Status | Authority |
|---|---|---|---|
| `_bmad-output/planning-artifacts/epics.md` (1,544 lines; 13 epics; generated 2026-10-03 by `bmad-create-epics-and-stories` 6.12.0) | accepted lineage (`38bea30`, `354ea1b`); deleted in the original checkout working tree | **Active planning, now stale.** Its inputs are the pre-normative SPRD (CC-3) and `fileRestructure.md` | Planning only; superseded in part by this proposal |
| `_bmad-output/implementation-artifacts/sprint-status.yaml` (generated 2026-10-03) | accepted lineage | **Active tracking, stale:** 1.3, 12.3 (12.3a), 12.5 are accepted but shown `backlog`; 1.7 and 1.8 absent | Tracking |
| `epic-1-context.md`, `epic-12-context.md` | accepted lineage | Active, stale (name `fileRestructure.md` as architecture authority) | Planning |
| `spec-1-3`, `spec-1-7`, `spec-1-8`, `spec-12-3a`, `spec-12-5` and `objectives/*/v1.objective.json` (frozen) | accepted lineage | **Historical accepted evidence.** Frozen objectives are hash-bound | Never rewritten |
| `_bmad/custom/*.toml` (11 files) | accepted lineage | Active BMAD configuration; **pins `fileRestructure.md` as the architecture input** | Configuration — must be re-pointed before any BMAD run |
| Story 1.9 draft | local evidence only (not published) | PAUSED, not frozen, draft objective stale | None |
| Story 1.10 (`story-1-10-ci-asserts-native-round-recovery-execution`) | named only in the 1.9 spec | Not started | None |
| `docs/epics.md`, `docs/sprints.md`, `docs/planning/*` | lineage / checkout | Historical planning | **Never requirements authority** |

---

## 2. Requirements delta (what the normative PRD changes in planning)

1. **O-20 and O-21 are decided** (00 §00.10.6). Epic 13 Story 13.2's blocker is gone. Provenance and credential work become **foundation work** (Wave B), not deferred placeholders.
2. **New normative invariants** now drive stories: INV-5 (full provenance), INV-3 (identity classes, device/system actors first-class), DEC-OPS-21 (device and system audit attribution), DEC-ADMIN-22 (event-triggered revocation), and P3 (business date).
3. **P11** fixes the headline sales measure. This lets the metric computation be built before O-6 decides day-close content.
4. **Architecture authority is SPRD Part C**, not `fileRestructure.md`. Every BMAD input and configuration that names `fileRestructure.md` is stale.
5. **The approved Tier-2 register (00 §00.10.4)** settles cancel/void/comp (DEC-OPS-1), routing (DEC-OPS-4), uncertain payments (DEC-FIN-11), print-job states and Venue Edge identity. Stories 7.1, 7.2, 12.7 and 10.x are rewritten to cite them.
6. **KitchenOS future-delivery capabilities** (185 requirements) stay **outside** the executable backlog until DEC-X-17 schedules them.
7. **ADR 0002 stays in force:** the reduced first pilot, integrated card (CARD3), the web Order Tablet in Staff Mode as the temporary settlement surface, Guest Mode / Windows POS / cash drawer excluded, KDS included. Its sentence "O-20 and O-21 stay open" is superseded by the 2026-10-05 ratification. No other ADR 0002 change is made.

---

## 3. Verified implementation baseline

**Lineage topology:**
- `main` = `a005642` = `origin/main`.
- `integration/accepted-batch-2` = `38bea30` (main + 74 commits; contains `78b0253`, `fff21b2` and all Story 2.x, 8.1, 8.3, 12.14, 12.15 work, plus accepted 1.3, 12.3a, 12.5, 1.7, 1.8).
- `cleanup/retire-legacy-apps` = `354ea1b` (= `38bea30` + legacy-app deletion; docs and contract notes only).
- **The original checkout's working tree is not the engineering baseline:**
  - it lacks venue scope and fail-closed realtime;
  - it carries pre-commit D13 work (untracked `internal/events`, `workers`);
  - it lacks ADR 0002;
  - it holds the **only copy of the normative PRD corpus** (`PRD/`, untracked).

| Capability | Accepted lineage (`38bea30`/`354ea1b`) | Actual checkout | Transitional (Nest / Admin Console) | Missing |
|---|---|---|---|---|
| Core staff venue scope (§16.3) | **Implemented** (`identity/venueaccess.go:81`, wired `server.go:83…240`; realtime 4403) | Missing | Nest guard (A only, `d6a4f27`) | — |
| Fail-closed realtime verification (§16.12) | **Implemented** (`realtimeapi/handler.go:272-286, 420-436`) | **Fails open** (`handler.go:352`) | — | — |
| Event-triggered revocation (DEC-ADMIN-22) | Periodic 60 s re-check only (`handler.go:72, 241`) | Same | Nest revoke updates rows only | **Push-close on revocation** |
| Device/system audit actors (DEC-OPS-21) | Schema supports staff/device/system (`AuditLog` actor-shape CHECK); **Nest writers use it**; **Core writers write staff only**; Core kitchen writes `KitchenTicketTransition` with actor kind | Schema staff-only | Nest `audit-actor.ts` | **All Core `AuditLog` writers** |
| O-20 elevation | Nest issues `tablet_device` (30 d), `tablet_staff` (20 m), `tablet_manager` (5 m), Argon2id PIN, venue-grant check at elevation, per-route rate limits; Core verifies only | Nest without venue-grant check | DL-081 web tablet | **No application-identity claim; no Core issuance; no account lockout; no native client** |
| O-21 provenance | `Order.source`, round `submittedByStaffId`, idempotency keys; events carry no actor/correlation/causation | Same | — | **Application, device, mode, actor class, guest session, correlation/causation on records and events** |
| P3 business date | `Venue.timezone` stored, unused | Same | — | **Everything** |
| P11 Net Sales | No reporting (Nest `ReportingModule` empty; web reports are mock data) | Same | — | **Everything** |
| Kitchen chain (ORD-1 → KIT-4) | Round → `DomainEvent` in the same transaction → idempotent projector → ticket states → realtime kitchen audience → transitions with actor (Core) | Partially (D13 uncommitted) | **Web KDS still uses Nest orders and socket.io** | **KIT-1 line routing (single `kitchen` station); Core kitchen HTTP routes do not accept D8 `kds` device credentials; no Core printing** |
| Payments (CARD3 chain) | D5 checks, D6 payments (trusted `payment_adapter` result route, uncertain state), D7 shifts, D9 refunds — all in Core | Partially | Order Tablet never settles (Idealpos observation only) | **Venue Edge (README only); Core → adapter dispatch of pending card payments; manual uncertain-payment resolution route; reconciliation job** |
| Clients on Core | — | — | Web Order Tablet and web KDS call **Nest** only | **No client switched to Core** |
| Android ×4, Windows POS | README scaffolds only | Same | — | Everything (O-10: Tier-2 recommendation in §11) |
| Device kinds | `pos_terminal`, `order_tablet`, `kds`, `payment_adapter` | Same | `TabletDevice` (Nest) | `kiosk`, `window_display`, Waiter Tablet kind (additive, DEC-OPS-13 / O-21) |

---

## 4. Existing-story reconciliation

| Story | Disposition | Evidence / reason |
|---|---|---|
| 1.1, 1.2, 1.4, 1.5 | KEEP (done) | sprint-status `done` |
| 1.3 | KEEP (done) — **correct the tracking** | Accepted in `ff3e4d7`; sprint-status says `backlog` |
| 1.6 Protect main | KEEP, REORDER after Wave A | Needs GitHub administration authorization |
| 1.7, 1.8 | KEEP (done) — **add to tracking** | Accepted in `38bea30`; absent from sprint-status |
| **1.9** Test-harness loopback binding | **REWRITE + REORDER into Wave A** (objective frozen only after its preconditions in §15 hold) | Still valid: a measured flake on `38bea30` makes evaluator verdicts untrustworthy (SPRD §21; NFR TEST-21). The draft objective is stale; regenerate and freeze it on the integrated baseline. Scope unchanged (supertest 7.3.1 + one explicit loopback listen). It precedes all Wave B stories because they rely on integration-test verdicts |
| **1.10** CI asserts the recovery suite executes | **KEEP, DEFER** to the first Epic 1 slot after Wave B starts | Truthfulness hygiene; it blocks no normative requirement. Not started |
| 2.1–2.11 | KEEP (done) | All in the accepted lineage |
| 2.1 / 2.5 residue | **SPLIT → new 15.4** | Event-triggered push-close (DEC-ADMIN-22) is not implemented; the periodic re-check is done |
| 3.1, 3.2 | KEEP (operational track) | NEEDS AUTHORIZATION; RPO/RTO is a P7 gate for 3.2 acceptance |
| 4.1, 4.2 | KEEP (operational track) | Staging needs infrastructure authorization |
| 5.1 | **REWRITE** | Guest off and Staff elevation stay. Remove "O-20/O-21 open". The web tablet keeps DL-081 (transitional, O-2); add the application-identity claim from 15.3 |
| 5.2, 5.3 | KEEP; depend on 15.2/15.3 | The web tablet's switch to Core must write O-21 provenance |
| 6.1 | **REWRITE** | Per **D-1** the first pilot uses the transitional web KDS migrated to Core. It reads and transitions Core kitchen tickets with a per-device D8 `kds` credential (15.5; D-3). Web-KDS-only features are not imported |
| 6.2, 6.3 | KEEP (transitional web KDS on Core, per D-1) | KIT-6, KIT-5 |
| 7.1 | **REWRITE** → 16.3 | Cite DEC-OPS-1 (approved). Values per P6 are configuration, not invented |
| 7.2 | **REWRITE** → 16.4 | Cite DEC-FIN-11; add the manual resolution route with evidence and step-up |
| 8.1, 8.3 | KEEP (done) | — |
| 8.2 | KEEP; **REORDER** into Wave C | VEN-1 and P3 boundary configuration live in the same settings |
| 9.1–9.6 | KEEP | ADR 0002 item 8 minimum settlement boundary; depend on 15.2 and 16.1 |
| 10.1 | KEEP (mostly present) | Contract exists in `contracts/openapi/payments.yaml`; verify gaps |
| 10.2–10.4 | KEEP | Simulator first |
| 10.5 | **SPLIT** → 10.5a Edge foundation; **10.5b** card command lease | EDGE-2 outbound-only: Edge leases pending card commands from Core. Nothing dispatches pending card payments today |
| 10.6 | KEEP, BLOCKED: O-3 | Gates the pilot |
| 11.1, 11.3 | KEEP, BLOCKED: O-5 / O-4 | — |
| 11.2 | **REWRITE** | Depends on 16.1 (P3) and 16.5 (P11); content stays BLOCKED: O-6 / DEC-FIN-10 |
| 12.1, 12.2, 12.9–12.13 | KEEP | Thresholds stay owner targets |
| 12.3 | **SPLIT** | Database timeouts are done (12.3a); device-route rate limits and dead-letter replay remain as 12.3b |
| 12.4, 12.6 | KEEP | Legacy decoupling; no mock data |
| 12.5 | KEEP (done) — correct the tracking | Accepted `e575658` |
| 12.7 | **SUPERSEDE** → 16.2 | Re-scoped to DEC-OPS-4 (line-level, effective-at-submission routing) |
| 12.8 | KEEP | Release acceptance (SPRD §11) |
| 12.11 | KEEP; **gate wording changed** | O-19 is now a planning baseline. The test runs against the baseline values; release acceptance still needs owner confirmation |
| 12.14, 12.15 | KEEP (done) | — |
| 12.16 | **MERGE** → 15.2 | Device-originated order creator is a special case of O-21 provenance |
| 13.1 Windows POS | KEEP, BLOCKED | PENDING USER POS ANALYSIS REPORT; ADR 0002 item 1 |
| 13.2 Guest Mode | **SPLIT / DEFER** | Decisions are now resolved (O-21, DEC-OPS-8). Still excluded from the first pilot (ADR 0002 item 4); display policy P9. Becomes Epic 19 follow-on |
| 13.3, 13.4, 13.6 | KEEP, BLOCKED / FUTURE | O-17, O-7, O-16, O-18 details; DEC-X-17 |
| 13.5 | **SPLIT** | P11 computation → 16.5 (current). RPT-1 breadth stays deferred (SHOULD; DEC-BI residuals) |
| 13.7 | **SPLIT / DEFER** | Native kiosk and window display stay deferred (after Epic 17; DEC-OPS-13 kinds; P9); not first-pilot surfaces |

---

## 5. Proposed new and rewritten epics and stories

Each story's Definition of Done is SPRD Part B (§26). Each runs under a frozen objective, the evaluator and disposable PostgreSQL 18 / Redis in UTC.

### Epic 14 — Baseline integration and planning re-anchor (Wave A)

**14.1 Integrate the normative PRD into the accepted lineage and retire `fileRestructure.md` authority**
- **Objective:** create one integrated baseline. It is the cleanup tip plus the normative PRD corpus (16 files, byte-exact), with `fileRestructure.md` removed (consolidated into Part C).
- **Rewrites:** current-state references to `fileRestructure.md` are re-pointed to SPRD Part C. Historical and frozen evidence is not rewritten.
- **Requirements:** SPRD §28, §36; README "Normative corpus baseline"; PR-7.
- **Dependencies:** orchestrator authorization of the git operations in §8.
- **Acceptance boundary:** docs and configuration only; no runtime code change.
- **Evidence and tests:**
  - sha256 of every PRD file equals the checkout copy;
  - `git grep fileRestructure` returns only historical, archive and frozen-objective hits;
  - architecture guard tests, the CI workflow parse and dev-script tests are green;
  - the four Android directories are present, and the three legacy directories are absent.

**14.2 Re-point BMAD configuration and regenerate planning artifacts**
- **Objective:** move `_bmad/custom/*.toml` and the epic contexts to SPRD Part C plus volumes 00–09. Run `bmad-correct-course` with this proposal, then `bmad-sprint-planning`.
- **Sprint status:** correct it (1.3, 1.7, 1.8, 12.3a, 12.5 done).
- **Requirements:** SPRD §28; 00 §00.1.1.
- **Dependencies:** 14.1.
- **Acceptance boundary:** planning artifacts and BMAD configuration only.
- **Evidence:**
  - no active BMAD input names `fileRestructure.md` or `docs/planning/`;
  - frozen objectives are unchanged (hashes).

**1.9 (rewritten)** — test-harness loopback binding.
- **Objective:** regenerate the fragment and objective from the integrated tip, freeze them, then build and evaluate.
- **Evidence:** 25/25 Supertest files evidenced; unit and integration floors as in the draft spec; recovery-suite hash unchanged.

### Epic 15 — Canonical identity, provenance and audit (Wave B)

**15.1 Core audit records device and system actors truthfully**
- **Requirements:** INV-3, DEC-OPS-21, DEC-X-6, NFR-AUD, O-21 §4.
- **Scope:** every Core `AuditLog` writer (orders, tables, checks, payments, adjustments, promotions, shifts, devices) writes `actorType` / device / system fields per the existing actor-shape CHECK. No system action borrows a staff identity.
- **Dependencies:** 14.1.
- **Evidence:** integration tests per writer for a staff, device and system actor; a negative test that a device action can never write a staff id.

**15.2 O-21 provenance persistence** (absorbs 12.16)
- **Requirements:** O-21 §1–8; INV-5; OPS-2; WT-6; PAY-3; ORD-3.
- **Scope:**
  - additive Prisma migration on orders, rounds, checks, payments and refunds: application identity, device id, operating mode, actor class, actor or guest-session id, correlation id, idempotency context;
  - domain-event metadata: actor, correlation and causation;
  - contracts updated additively;
  - a replay returns the original provenance;
  - `order_tablet` stays readable, and native clients cannot emit it;
  - no destructive enum change.
- **Dependencies:** 15.1, 15.3 (claims).
- **Evidence:**
  - a mixed-mode visit test (rounds from different actors);
  - an idempotent replay from a different credential keeps the original;
  - a client-declared mode is ignored;
  - published migrations are untouched.

**15.3 Credentials carry application identity (O-20 / O-21 foundation)**
- **Requirements:** O-20 §1–5, 7, 10; O-21 §7; O-2.
- **Scope:**
  - Nest-issued tablet and KDS credentials (transitional under O-2) gain an application-identity claim;
  - Core verifies it and derives mode and actor class from the credential kind;
  - account-level PIN lockout as configurable policy (P2 values, no invented numbers);
  - no silent refresh of staff authority.
- **Dependencies:** 14.1.
- **Evidence:** a token without the claim is refused on native-only routes (legacy web clients keep a compatibility path until migrated); lockout tests use configuration.

**15.4 Event-triggered realtime revocation (DEC-ADMIN-22)**
- **Requirements:** DEC-ADMIN-22, ADMIN-33, SPRD §16.5, NFR-SEC-3, O-20 §7.
- **Scope:** revoking a staff session, account, venue grant or device closes the affected live connections by the revocation event itself. The 60 s re-check stays as a safety net.
- **Dependencies:** 15.1 (audit of the close).
- **Evidence:** the close latency is measured and reported. Its threshold is an owner target, so the test asserts event-driven closure and does not invent a numeric bound.

**15.5 Core kitchen routes accept D8 `kds` device credentials**
- **Requirements:** INV-3, NFR-SEC-3, KIT-4, O-21 §4; O-13 architecture (per-device D8 identity; §12); D-3 for the transitional web KDS.
- **Scope:** the device-auth chain on `/kitchen-tickets` GET and transition. Transitions are attributed to the device actor; revocation is honoured.
- **Dependencies:** 15.1.
- **Evidence:** a revoked device is refused (HTTP and realtime); a cross-venue device is refused.

### Epic 16 — Service-day correctness (Wave C)

**16.1 P3 business date**
- **Requirements:** P3 rules 1–10; INV-8; FIN-31; VEN-1.
- **Scope:**
  - effective-dated venue trading-day boundary (organization default plus venue override; prospective changes only);
  - deterministic assignment on orders, rounds, checks, payments, refunds and shifts;
  - UTC preserved; DST reproduction tests.
- **Dependencies:** 8.2, 15.2 (shared migration window).
- **Evidence:** a property test across DST transitions; boundary-change tests prove no historical rewrite.

**16.2 Line-level station routing** (supersedes 12.7)
- **Requirements:** KIT-1, DEC-OPS-4, PRT-1.
- **Scope:** a station configuration model; routing effective at submission; one round produces multiple station tickets.
- **Dependencies:** 14.1.

**16.3 Cancel, void and comp in Core** (rewrites 7.1)
- **Requirements:** DEC-OPS-1, OPS cancel/void rows, PR-9.
- **Scope:** append-only and linked; permissions and thresholds are configuration (P6 values supplied by the owner before pilot enablement).

**16.4 Order completion and uncertain-payment resolution** (rewrites 7.2)
- **Requirements:** DEC-FIN-11, PAY-6.
- **Scope:** an append-only manual resolution route with provider evidence and step-up; a contradicting fact goes to reconciliation.

**16.5 P11 operational sales computation**
- **Requirements:** P11 rules 1–4; 08.12; BI-3, BI-7.
- **Scope:** Core read model for Gross Sales, Discounts/Comps, Net Sales incl. GST, GST, Net Sales excl. GST and Refunds/Returns per business date (16.1). Tenders are reported separately.
- **Evidence:** the metric-catalogue definitions are reproduced from fixtures; refunds land on their own business date.

**8.2 (kept)** — venue, tax and table settings from real data, including the P3 boundary configuration UI/API.

### Epics 5, 6, 9 (transitional clients onto Core; kept, rewritten as noted in §4)

**Epic 6 under D-1:** the transitional web KDS (Admin Console KDS build mode) moves off Nest onto Core kitchen tickets and the Core realtime kitchen audience. It authenticates with a per-device D8 `kds` credential (15.5 and D-3). It keeps only the KIT-1 to KIT-6 behaviour; no web-KDS-only feature becomes a requirement. It is transitional: it retires through Epic 18 (PR-8, SPRD §34).

### Epic 10 (CARD3; kept)
- **New 10.5b — Core → Venue Edge card command lease.**
  - Requirements: EDGE-2, EDGE-3, PAY-1, PAY-6, ADR 0002 item 2.
  - Scope: Edge pulls pending card commands outbound-only with leases and idempotency; the result returns through the existing trusted adapter route.
  - Dependencies: 10.5a.

### Epic 17 — Native platform foundation (post-pilot track)
- **17.1 Android engineering baseline per O-10.**
  - Requirements: SPRD §4, §32; O-10 (Tier-2 recommendation in §11, awaiting orchestrator decision).
  - Scope: Gradle root at `apps/android/`; convention plugins in `packages/android/build-logic`; version catalog; wrapper and dependency verification; CI job; no product UI.
  - Starts after the orchestrator decides O-10, and the exact version pins are verified in the story (§11).
- **17.2 Native device enrollment, secure credential storage and Core realtime client.**
  - Requirements: D8, O-13 architecture (§12), O-20 §8, NFR-RT, `contracts/realtime`.
  - Dependencies: 17.1, 15.3, 15.5.
  - It becomes `packages/android` shared code only when the second app (Waiter Tablet) consumes it (rule 8).

### Epic 18 — Native KDS (post-pilot; first native surface — platform pathfinder; see §6.3)
- **18.1** Tickets and transitions on Core with a D8 identity (KIT-3, KIT-4).
- **18.2** Outage cache and reconnect with refetch and dedupe (KIT-6).
- **18.3** Ready alert and age colours (KIT-5).
- **18.4** Parity proof and venue migration, then retire the transitional web KDS (D-1 steps 4–6; PR-8, SPRD §34).
- **Dependencies:** 17.2, and the pilot-path work 15.5 and 16.2.

### Epic 19 — Native Waiter Tablet Staff Mode (post-pilot; primary transitional-retirement target)
- **19.1** Staff elevation per O-20.
- **19.2** Ordering on Core with O-21 provenance.
- **19.3** Settlement parity with Epic 9, then retire web-tablet settlement (ADR 0002 item 8 retirement rule).
- **Dependencies:** 17.2 (proven by Epic 18), 15.2, 15.3, Epic 9.
- **Then:** Guest Mode (deferred; P9) and the native kiosk / window display (deferred; DEC-OPS-13, P9).

---

## 6. Execution waves and pilot critical path (corrected for D-1)

### 6.1 Waves
1. **Wave A — baseline** (NOT AUTHORIZED; §8): 14.1 → 14.2 → 1.9 (objective frozen after §15 preconditions). The operational track (3.1, 4.1) starts when separately authorized.
2. **Wave B — identity, provenance, audit:** 15.1 and 15.3 → 15.2, 15.5, 15.4. Venue scope and fail-closed realtime come with Wave A (already in the lineage).
3. **Wave C — service-day correctness:** 8.2 → 16.1; 16.2, 16.3, 16.4, 16.5.
4. **Wave C′ — transitional pilot surfaces on Core** (ADR 0002 and D-1): Epic 5 (web Order Tablet Staff Mode), Epic 6 (web KDS on Core), Epic 9 (cash settlement).
5. **CARD3 track** (after Wave A, in parallel): 10.1 → 10.5a → 10.5b → 10.2 → 10.3 → 10.4; 10.6 after the O-3 business choice.
6. **Pilot content:** 11.1 / 11.3 (O-5 / O-4 business residue), 11.2 (O-6 business residue; after 16.1, 16.5).
7. **Release readiness:** 3.2, 4.2, 12.1–12.4, 12.6, 12.8–12.13; 12.11 against the O-19 planning baseline.
8. **Post-pilot native track:** 17.1 → 17.2 → Epic 18 → Epic 19. This is TARGET permanent architecture, not FUTURE scope; it is simply off the first-pilot critical path (SPRD §13: native apps beyond the first pilot unless O-1 says otherwise).

### 6.2 First-pilot critical path
1. A (14.1, 14.2, 1.9).
2. B (15.1, 15.3 → 15.2, 15.5; 15.4 before release acceptance).
3. C (8.2 → 16.1; 16.2; 16.3; 16.4; 16.5).
4. **KDS chain under D-1:** Core round commit → durable `DomainEvent` (implemented) → idempotent ticket projection (implemented) → line-level station routing (16.2) → Core KDS device authorization with a per-device D8 credential (15.5, D-3) → transitional web KDS consuming Core HTTP and the realtime kitchen audience (6.1) → acknowledgement and state transitions with optimistic versioning (implemented; device actor via 15.1) → retry and recovery: reconnect, refetch, dedupe and outage cache (6.2) → audit and provenance (15.1, 15.2) → printing only if the venue requires kitchen printing (O-4 business residue; 11.3 through Venue Edge).
5. Ordering and settlement: 5.1 → 5.2 → 5.3; 9.1 → 9.6.
6. CARD3: 10.1 → 10.5a → 10.5b → 10.2 → 10.3 → 10.4 → 10.6 (O-3).
7. 11.1, 11.2, 11.3 (O-5, O-6, O-4 business residues).
8. Release acceptance: 12.8, 12.10, 12.11, 12.12 (O-19 owner confirmation).
9. Pilot enablement: P6 values, P13 choices (§14).
10. Production cutover: separate approval; P5, P10.

### 6.3 Native sequencing after D-1

| Factor | Native KDS | Native Waiter Tablet Staff Mode |
|---|---|---|
| Transitional replacement pressure | Low: web KDS on Core is a read-and-transition surface | **High:** web-tablet settlement is a temporary ADR 0002 exception, and the Windows POS is frozen, so the native tablet is the only unblocked permanent settlement surface |
| Backend readiness after the pilot path | Ready (15.5, 16.2) | Ready (Epics 5, 9; 15.2, 15.3) |
| Pilot dependency | None (D-1) | None (ADR 0002 item 8) |
| O-20 dependency | None (device identity only) | Full native staff elevation |
| Operational risk if defective | Kitchen visibility | Money, settlement, staff authority |
| UI complexity | Small | Large (menu, modifiers, rounds, checks, tenders, card) |
| Device-auth and platform foundation | Exercises D8 enrollment, secure storage, realtime client and offline cache with no staff or money logic | Needs all of that plus O-20 |
| Transitional surface retired | Web KDS mode | Web Order Tablet, DL-081 Nest tablet identity, ADR 0002 settlement exception |

**Recommendation:** after the pilot-critical transitional work, build the **native KDS first as a time-boxed platform pathfinder.** It proves the O-10 baseline and the shared device-identity, secure-storage and realtime foundation (17.2) on the lowest-risk surface. The **native Waiter Tablet Staff Mode** then follows as the primary transitional-retirement target and reuses the proven foundation. Staff Mode can start as soon as 17.2 is proven, without waiting for KDS venue migration (18.4).

---

## 7. Requirements → implementation traceability (pilot and current delivery)

| Requirement | Status (lineage) | Evidence | Story | Gate |
|---|---|---|---|---|
| ORD-1, ORD-3 durable, idempotent round | Implemented in Core | `orders/pgstore/store.go:478-488`; `service.go:212-303` | — (verify in 12.8) | — |
| ORD-2, ORD-4 server validation | Implemented in Core (D3) | Core orders | — | — |
| ORD-5 / WT-6 / INV-5 provenance | Partial | `source`, `submittedByStaffId` only | 15.2, 15.3 | — |
| KIT-1 line routing | Missing (single station) | `kitchen/routing.go:12-25`; `main.go:123` | 16.2 | — |
| KIT-2, KIT-3, KIT-4 | Core implemented; client on Nest | projector, realtime kitchen audience | 6.1 (pilot, per D-1); 18.1 (post-pilot); 15.5 | D-3 |
| KIT-5, KIT-6 | Client work | contracts/realtime §recovery | 6.2, 6.3 or 18.2, 18.3 | — |
| PAY-1 card via Edge (CARD3) | Core D6 trusted result route; **no Edge, no dispatch** | `server.go:173-189`; `services/venue-edge` README only | 10.5a, 10.5b, 10.2, 10.6 | O-3 |
| PAY-1 cash in shift | Core D7 | `shifts/shift.go:65-81` | 9.1, 9.3 | — |
| PAY-3, PAY-4, PAY-5, PAY-6 | Core state machine; manual resolution missing | `payments/payment.go:19-63` | 10.2, 10.3, 16.4 | — |
| PAY-7 refunds | Core D9 | `refunds/refund.go` | 9.5, 10.4 | P6 (authority values) |
| REC-1, PRT-1–3, ADM-2 | Printing only in Nest; no Edge | `printer-dispatcher.service.ts` | 11.1, 11.3 | O-4, O-5 |
| RPT-2 / P3 / P11 | Missing | — | 16.1, 16.5, 11.2 | O-6, DEC-FIN-10 |
| STF-1, NFR-SEC-1/2, §16.3 venue scope | Implemented (lineage) | `identity/venueaccess.go:81` | done (2.x, 8.x) | — |
| §16.12 fail-closed realtime | Implemented (lineage) | `realtimeapi/handler.go:272-286` | done (2.1) | — |
| NFR-SEC-3 / DEC-ADMIN-22 revocation | Periodic only | `handler.go:72, 241` | 15.4 | — |
| NFR-AUD / DEC-OPS-21 | Nest yes, Core no | `audit-actor.ts`; Core writers | 15.1 | — |
| O-20 (Staff Mode) | Nest DL-081; no application claim; no native | `tablet-auth.service.ts:134-177` | 15.3, 19.1 | P2 values |
| VEN-1, TBL-1 | Mock data in Admin | — | 8.2 | — |
| AVL-1, MENU-6 | Transitional Nest | — | 13.3 | O-17 |
| WT-4 Guest never staff | Enforced (Core refuses unelevated) | `orders/order.go:49-53` | 5.1 | — |
| NFR-REL backups, restore | Not rehearsed | — | 3.1, 3.2 | P7 (RPO/RTO) |
| §11 release acceptance | — | — | 12.8 | O-19 confirmation |

---

## 8. Cleanup and integration reconciliation plan — *(rev 2 status: not authorized. **Executed 2026-10-05 as Wave A, commit `5ee6474`; see §18.**)*

**Goal:** one integrated branch that holds the accepted engineering lineage, the legacy cleanup and the normative PRD, without resurrecting `fileRestructure.md` or the legacy applications, and without touching the original checkout's unrelated work.

1. **Freeze evidence (read-only):**
   - sha256 manifest of the checkout's `PRD/` (16 files);
   - `git status -uall` and `git diff` captures of the original checkout, stored outside the repository.
2. **Proposed for authorization:** `git worktree add -b integration/normative-prd-baseline <scratch>/wt-normative 354ea1b`. This creates a new branch; no existing branch moves.
3. **In that worktree:**
   - copy the 16 normative `PRD/` files byte-exact, then verify the sha256 manifest;
   - `git rm fileRestructure.md`;
   - re-point current-state references in READMEs and `contracts/*` notes (the current-state subset of the 64 files that mention it; see §16). BMAD configuration and epic contexts follow in 14.2, after this commit;
   - **do not** rewrite frozen objectives, specs, `docs/archive` or the historical `docs/product-requirements.md` snapshot.
4. **Validate (docs and configuration only):** architecture guard tests, dev-script tests, CI workflow parse. Check that `apps/kitchen-display`, `apps/order-tablet` and `apps/window-display` are absent and that `apps/android` has exactly four apps.
5. **Proposed for authorization:** one local commit (no AI attribution trailer, per the standing rule). No push.
6. **Original checkout:**
   - no reset and no clean;
   - after step 5, classify its residue path-by-path against the integrated tip into (a) superseded by the lineage (pre-commit D13 work, older Core files), (b) the normative PRD (now integrated), (c) owner-only work (for example the xlsx→csv change and `docs/planning` edits);
   - only (c) is preserved forward, as a separate patch for owner review.
7. **Publication** (push, PR, main movement) is a separate owner/orchestrator authorization after CI-equivalent validation.

**Hazards guarded:**
- copying from the checkout's untracked `PRD/` (not from lineage `PRD/`) prevents losing the normative baseline;
- `git rm fileRestructure.md` in the same commit prevents resurrecting it;
- branching from `354ea1b` keeps the legacy deletions;
- there is no `git add -A` (root `node_modules` symlink, unrelated dirty work).

---

## 9. Reduced decision docket

### Tier 2 — decided this pass
| ID | Decision |
|---|---|
| **D-1** | **APPROVED — TIER 2 (orchestrator, 2026-10-05).** The first pilot uses the transitional web KDS migrated to canonical Go Core. The permanent destination stays `apps/android/kds`. Replacement sequence: (1) Core authoritative for KDS state; (2) web KDS consumes Core, not Nest; (3) native KDS on the same contracts; (4) native parity proven (functional, security, reliability, operational); (5) callers and venue operation migrate; (6) web KDS retires. Transitional architecture only: no permanent web KDS, no implementation authorized, no web-KDS-only features imported |
| **O-13 (architecture)** | **KDS authentication uses a per-device, venue-bound D8 device identity and credential.** No human login for ordinary KDS operation. Residuals in §12 |

### Tier 2 — awaiting orchestrator decision
| ID | Decision | Recommendation |
|---|---|---|
| **O-10** | Android engineering baseline | §11 (exact version pins verified inside Story 17.1 against the stated criteria) |
| **D-3** | Credential used by the **transitional web KDS** at the pilot | A per-device D8 `kds` credential enrolled into each KDS browser installation and verified by Core (15.5). Retire the Nest venue-PIN `kds_device` token for pilot venues. Reason: SPRD §11 release acceptance requires device revocation, and the O-13 direction is per-device identity. The venue PIN is shared and not per-device revocable (ADMIN-38 keeps it TRANSITIONAL) |

### Tier 3 — owner decision
| ID | Decision |
|---|---|
| O-1 | Whether the native Waiter Tablet is required for the first pilot (default per ADR 0002: no; the web Staff Mode settlement surface remains valid) |
| O-3 (business) | Card provider/acquirer, terminal model and commercial terms |
| O-4 (business) | Pilot-venue hardware purchase and whether the venue requires kitchen printing |
| O-5 (business/legal) | Required receipt and NZ tax-invoice content and issuance rules (with P5 professional advice) |
| O-6 (business) | Which reports and close actions the owner requires at pilot day close (with DEC-FIN-10) |
| Pilot timing and venue | Pilot venue and date (DL-117 NOT approved) |
| Distribution channel | How production APKs reach venue devices (store versus managed distribution) — ops/commercial choice; it does not block 17.1 |

### Policy / configuration (open until their existing gate)
P6 (financial control values); P2 (session, PIN, lockout and device-credential rotation values); DEC-FIN-10, DEC-BI-2, DEC-BI-4, DEC-BI-11; venue tax and table configuration; the KIT-5 age threshold (venue configuration).

### Production / release gates
O-19 owner confirmation (release acceptance); DEC-X-8, DEC-X-9 (release acceptance); P5 (production and compliance); P10 (production use of allergen enforcement and acknowledgement); D-2, the Wave A git authorization (orchestrator, separate).

### Resolved architecture — implementation missing (not decisions)
- O-20, O-21: 15.2, 15.3, 19.1.
- DEC-ADMIN-22: 15.4.
- DEC-OPS-21: 15.1.
- KDS D8 credential on Core HTTP: 15.5.
- DEC-OPS-4 routing: 16.2.
- DEC-OPS-1: 16.3.
- DEC-FIN-11: 16.4.
- P3: 16.1.
- P11: 16.5.
- EDGE-1/2 (printing and card command lease via Venue Edge): 10.5a, 10.5b, 11.3.
- DEC-OPS-13 device kinds: with Epic 18 and the kiosk work.
- Venue scope and fail-closed realtime: in the lineage; integrated by Wave A.

## 10. Future and deferred backlog (outside execution)

- The 185 `TARGET CAPABILITY — FUTURE DELIVERY` requirements (DEC-X-17).
- Guest Mode (ADR 0002 item 4; P9); native kiosk and window display (13.7).
- Windows POS (13.1, P12).
- Online ordering (O-18 details), reservations ownership (O-7, 13.4), RPT-1 breadth, AVL-1 channel scope (O-17).
- Ledger, SSO and floor plan (DEFERRED).

**Unchanged constraints:** DL-117 (11 October 2026 milestone) is NOT approved and no wave is dated by it; Windows POS behaviour stays frozen; CARD3 is the only first-pilot card path; exactly four Android apps; no permanent web KDS (the web KDS mode is transitional and retires under PR-8).

---

## 11. O-10 — Android engineering baseline (Tier-2 recommendation, awaiting orchestrator decision)

**Fixed by SPRD (not reopened):** Kotlin native Android; exactly four apps; no fifth, customer or order-tablet app; shared code in `packages/android/` only when genuinely shared; the old `android/core`, `models` and `build-logic` scaffolds are not recreated.

**Version-selection rule:** choose the newest **stable, mutually compatible, supported** line, never alpha, beta or RC. Verify current releases inside Story 17.1, and record the evidence (release notes and compatibility tables) in the story before pinning. Upgrades go through a dedicated story; there are no floating versions.

| Area | Recommendation |
|---|---|
| Kotlin | Kotlin 2.x stable (K2 compiler); one version for every module, pinned in the catalog |
| Build | Gradle wrapper pinned with `distributionSha256Sum`; the Android Gradle Plugin's current stable major, matched to the Gradle and Kotlin compatibility tables |
| Build scripts | Kotlin DSL (`*.gradle.kts`) only |
| Gradle root | `apps/android/settings.gradle.kts` includes the four apps. Convention plugins go in `packages/android/build-logic` (an included build — the `packages/android` build-module option Part C allows). Shared libraries become `packages/android/<lib>` modules only when a second app consumes them |
| Versions | One `gradle/libs.versions.toml` version catalog; Gradle dependency verification (`verification-metadata.xml`) and dependency locking for supply-chain integrity (Part B) |
| UI | Jetpack Compose (Material 3), tablet-first layouts; no XML view system for new UI |
| SDK governance | `compileSdk` is the latest stable platform. `targetSdk` is the latest stable level meeting the distribution channel's requirement, reviewed every year. `minSdk` is the lowest API level among owner-approved venue hardware (an O-4 business input), never below **API 26** (native `java.time`, modern TLS and Keystore behaviour). All three are set in one convention plugin |
| JDK | JDK 17 toolchain (the build JDK the Android Gradle Plugin requires); bytecode target 17 |
| DI | Hilt (compile-time; justified by lifecycle-scoped shared components: credentials, realtime, cache) |
| Async | Kotlin coroutines and Flow |
| Networking | OkHttp (one client for HTTP and WebSocket; TLS ≥ 1.2 per NFR-SEC-2). Typed clients from `contracts/openapi`, generated or hand-written (a Tier-1 choice in 17.2), guarded by contract tests. kotlinx.serialization |
| Realtime | OkHttp WebSocket implementing `contracts/realtime/servvia-realtime.md`: authorize at subscribe, dedupe by event ID, drop stale versions, 1–30 s backoff, refetch over HTTP after `subscribed`; fail closed on credential errors |
| Local persistence | Room for the ticket and command cache (KIT-6) and the pending-command queue; DataStore for settings |
| Secure credential storage | Android Keystore non-exportable keys (StrongBox where present) wrapping a Tink AEAD key; encrypted credential blobs in DataStore. Do not adopt `androidx.security:security-crypto` (deprecated upstream; confirm in 17.1). No staff secret is stored on the device (O-20 §8) |
| Testing | JVM unit tests (JUnit, kotlinx-coroutines-test, Turbine); MockWebServer for HTTP and WebSocket; Robolectric where needed; Compose UI tests; instrumented tests on Gradle Managed Devices; contract tests against `contracts/`; JUnit XML results for the evaluator |
| Static analysis | Android Lint (baseline committed, no suppressions for new code); ktlint via Spotless; detekt |
| CI | A GitHub Actions job: Gradle wrapper validation, JDK 17, build, unit tests, lint, detekt, Spotless check; managed-device instrumented tests; configuration cache; no `continue-on-error` |
| Release and signing | Debug and CI builds unsigned or debug-signed only. Release signing keys are never in the repository, CI logs or images; signing runs only in a separately authorized release pipeline with an external secret store. The distribution channel is an ops/commercial choice (§9) |

Exact pins (Kotlin, Gradle, Android Gradle Plugin, Compose BOM, compile/target SDK) are verified and recorded in 17.1. They are not escalated to the owner.

## 12. O-13 — final decomposition

**Architecture (Tier 2, decided this pass):** KDS authentication uses a per-device, venue-bound D8 device identity and credential. There is no human login for ordinary KDS operation, and staff and guest authorization stay separate.

| Residual | Classification | Resolution or owner |
|---|---|---|
| Enrollment and pairing | Tier 1 (mechanism exists: Core D8 enrollment routes) | An administrator creates a single-use, short-lived enrollment in the Admin Console; the device redeems it once; audited (15.5, 17.2) |
| Credential bootstrap | Tier 1 | The first credential is issued only on redemption; nothing ships pre-provisioned |
| Secure device storage | Tier 1 under O-10 | §11 secure storage; browser storage for the transitional web KDS is covered by D-3 |
| Rotation | Mechanism Tier 1; cadence is policy (P2) | Renewal by an authenticated device; values configured |
| Revocation | Resolved architecture (NFR-SEC-3, DEC-ADMIN-22) | 15.4, 15.5 |
| Recovery and re-enrollment | Tier 1 | Revoke, then enroll anew; never reuse a credential |
| Realtime subscription authorization | Resolved (D8 `kds` → kitchen audience) | Implemented; verified in 15.5 |
| Venue reassignment | Determined by venue-bound identity (INV-3, O-21 immutability) | Revoke and re-enroll at the new venue; no in-place venue move |
| Lost or stolen device | Resolved (O-20 §7 pattern) | Device revocation |
| Audit and provenance | Resolved (DEC-OPS-21, O-21) | 15.1, 15.2 |
| Human step-up for privileged KDS administration | Not needed | Device administration happens in the Admin Console under staff authorization; the KDS app has no privileged functions |
| Pilot web-KDS credential | Tier 2 (D-3) | §9 |

**Tier-3 residue: none.** The original O-13 question ("authenticated KDS versus the old no-auth KDS") is answered by the architecture. Named-person attribution of kitchen actions is not a PRD requirement; adding it would be a new requirement, not an O-13 residue.

## 13. O-3, O-4, O-5, O-6 decomposition

| Item | Business / policy decision (owner) | Architecture / mechanism (decided, or Tier 2/1) |
|---|---|---|
| **O-3** payment provider and real terminal | Provider and acquirer, terminal model, commercial terms, and accepting the provider's certification obligations | **Decided:** CARD3 trusted-adapter boundary (D6 result route; only a `payment_adapter` D8 identity reports results); provider-neutral contract (PAY-4); no raw card data (PAY-5); idempotency and uncertain-outcome handling (PAY-6, DEC-FIN-11); Edge outbound command lease (EDGE-2). **Tier 1 after selection:** provider-specific adapter and its certification evidence (10.6) |
| **O-4** printers, cash drawer, KDS hardware, protocol | Which physical devices the pilot venue buys; whether the venue requires kitchen printing. The cash drawer is already excluded from the first pilot (ADR 0002 item 3) | **Decided:** Venue Edge owns local hardware (EDGE-1); print jobs with independent delivery states (KIT-2; approved Tier-2 print-job states); retry, logging and reprint (PRT-1, PRT-2); a device abstraction in Edge. **Tier 1 after selection:** wire protocol and driver for the chosen hardware; on-hardware latency validation (12.12) |
| **O-5** receipt and NZ tax-invoice obligations | The required content and issuance rules (a legal/tax determination, with P5 professional advice) | **Decided:** receipt rendered from the immutable Core check and payment record; versioned template; issued-receipt record persisted and audited; reprints marked; numbering per INV-9; delivered as an Edge print job. Content is configuration filled in after the business decision |
| **O-6** minimum pilot day reports | Which reports and close actions the owner requires at pilot close (with DEC-FIN-10 close rules) | **Decided:** P3 business date; P11 metric definitions (08.12); canonical Core read models (16.5); day close as a separate append-only lifecycle (P3 rule 7); payments reported separately from sales |

## 14. Corrected P13

**P13 — Pilot readiness choices (owner):**
- O-3 business part;
- O-4 business part;
- O-5 business/legal part;
- pilot venue and timing (DL-117 NOT approved).

**Removed from P13:**
- O-13: architecture decided, no Tier-3 residue;
- every mechanism part of O-3, O-4 and O-5 (resolved architecture or Tier 1).

**Not in P13 (unchanged homes):**
- O-6 business part: the pilot-reporting gate with DEC-FIN-10;
- O-1: the owner pilot-scope decision under P9.

## 15. Story 1.9 — preconditions before its objective may be frozen
1. Wave A is authorized and 14.1 is committed locally. The integrated tip exists and is the objective's anchor.
2. 14.2 has re-pointed the BMAD configuration and epic contexts; the objective binds those planning inputs (objective schema v2).
3. Baseline measurements are re-taken on the integrated tip: unit and integration floors, lint and typecheck, the recovery-suite hash, and the Supertest-file inventory. The 354ea1b lockfile changed (158 packages removed), so the dependency delta (supertest 7.3.1 and its transitive set) is recomputed against it.
4. The endpoint-check REQUIRED list is regenerated mechanically (not hand-typed) with `gen-fragment-1-9.mjs` / `gen-objective-1-9.mjs`.
5. Evaluator dependency provisioning is decided: install from the approved lockfile (`provision.sh`) plus a Supertest runtime-resolution check, replacing the operator-supplied `node_modules` link.
6. The flake still reproduces (or its mechanism is still demonstrable) on the integrated tip.

Story 1.10 stays KEEP / DEFER behind 1.9.

## 16. Files to be updated at Wave A and BMAD re-anchoring (not now)

**Wave A (14.1) on `integration/normative-prd-baseline`:**
- `PRD/` (16 files, byte-exact from the checkout);
- delete `fileRestructure.md`;
- current-state references in READMEs (repository root; `apps/android/*`; `apps/api`; `apps/web/*`; `apps/windows/pos-terminal/**`; `data/**`; `database`) and the `contracts/openapi/orders.yaml` and `contracts/realtime/orders-socket.md` notes.

**BMAD re-anchoring (14.2):**
- `_bmad/custom/*.toml` (11 files);
- `_bmad-output/planning-artifacts/epics.md` (via `bmad-correct-course` with this proposal);
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (via `bmad-sprint-planning`; target in `proposed-sprint-status-v2.yaml`);
- `epic-1-context.md` and `epic-12-context.md` regenerated, plus new contexts for Epics 14–16 when drafted.

**Never modified:**
- frozen `objectives/*/v1.objective.json`;
- accepted `spec-*.md` files;
- `docs/archive/**`;
- the `docs/product-requirements.md` evidence snapshot;
- this proposal's rev 1.

---

## 17. Orchestrator decisions recorded after rev 2 (2026-10-05)

**Verdict:** corrected reconciliation ACCEPTED. **O-10: APPROVED — TIER 2. D-3: APPROVED — TIER 2.** Wave A is authorized for controlled local execution only (no push, PR, main movement, Story 14.2 or Story 1.9).

**O-10 — approved Android baseline:**
- **Stack:** native Kotlin (Kotlin 2.x stable, K2 generation); pinned Gradle wrapper; an Android Gradle Plugin from a mutually compatible, supported, stable version set; Kotlin DSL; Jetpack Compose / Material 3; JDK 17 baseline.
- **Builds and dependencies:** one version catalog; dependency verification and locking; convention/build logic as justified; shared runtime modules extracted only when genuine cross-app reuse exists.
- **Libraries:** Hilt; coroutines / Flow; OkHttp for HTTP and WebSocket; kotlinx.serialization; contract/OpenAPI-derived clients where appropriate; Room; DataStore; Android Keystore for protected device credential material.
- **Testing:** JUnit, Turbine, MockWebServer, Robolectric, Compose UI tests, managed-device / instrumented tests, contract tests.
- **Quality and release:** Android Lint, ktlint / Spotless, detekt; CI without `continue-on-error` for required Android verification; signing isolated to a separately authorized release pipeline.

**Refinements (supersede the corresponding §11 wording):**
- **Version governance:** not "always newest". At Story 17.1, verify official compatibility and release information and pin a supported, stable, mutually compatible, reproducible Kotlin / Gradle / AGP / Compose / JDK / SDK set. After pinning, upgrades are deliberate controlled changes; production builds never float against "latest".
- **SDK:**
  - `minSdk` is derived from approved venue hardware and is never below API 26 without a new architecture decision;
  - `compileSdk` is the supported stable SDK appropriate to the selected toolchain;
  - `targetSdk` satisfies the selected distribution and platform requirements at release time;
  - the distribution channel remains an owner / release choice.
- **Secure storage:** the Android Keystore is the invariant, with hardware-backed / StrongBox protection where available and appropriate. StrongBox availability is not a universal device-compatibility requirement. No reusable staff secret is stored on the device. (Tink is a permitted Tier-1 implementation detail, not part of the invariant.)

**D-3 — approved:** the transitional pilot web KDS authenticates to canonical Core with a **per-device, venue-bound D8 credential**. The Nest venue PIN is not the canonical pilot authentication model, and ordinary KDS operation needs no human login.
- **The transitional web KDS must support:** device enrollment and bootstrap; secure handling of its device credential appropriate to its deployment model; Core HTTP and realtime authorization; device revocation; venue binding; audit attribution; and O-21 provenance attribution.
- **Scope limit:** no permanent browser-credential architecture is designed beyond what this transitional surface requires.
- **Native KDS:** later uses the same canonical device-identity concept with Android-appropriate secure storage.

**Preserved:**
- D-1 (pilot: transitional web KDS on Core; permanent target `apps/android/kds`; six-step replacement sequence; no permanent web KDS).
- Native sequencing: (1) Android foundation; (2) native KDS as a constrained technical pathfinder; (3) Waiter Tablet Staff Mode as the primary high-value native replacement. Staff Mode may begin once the shared foundation is proven, without waiting for native KDS venue cutover. Native KDS stays post-first-pilot replacement work under D-1.

**Docket effect:** O-10 and D-3 move from "Tier 2 — awaiting orchestrator decision" to "Tier 2 — decided". Epic 17 is no longer gated on a decision.


---

## 18. Checkpoint execution state (2026-10-05)

- **Wave A: COMPLETED.**
  - Commit `5ee6474` on `integration/normative-prd-baseline` (parent `354ea1b`, the cleanup tip).
  - Content: the 16 normative PRD files (byte-exact to the accepted manifest), `fileRestructure.md` deleted, and current-state README and contract-note references re-pointed to `PRD/product-requirements.md`.
  - Validation identical to the `354ea1b` baseline: dev-scripts 84/84, evaluator 115/115, Go architecture guard ok, YAML parse ok.
- **Story 14.2 (BMAD re-anchoring): NEXT, NOT STARTED, NOT AUTHORIZED.** The BMAD configuration (`_bmad/custom/*.toml`) and planning artifacts still name `fileRestructure.md` until 14.2 runs.
- **Story 1.9: REWRITE, NOT FROZEN** (preconditions in §15).
- **Story 1.10: DEFERRED.**
- **Decisions in force:** D-1, O-10, D-3 (Tier 2, orchestrator), as in §9 and §17. In the §9 docket, O-10 and D-3 appear under "awaiting"; §17 records their approval.
- **All work is paused pending owner return.**
