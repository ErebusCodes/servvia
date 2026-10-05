# Servvia release-readiness program

> **BMAD PLANNING ARTIFACT, NOT REQUIREMENTS AUTHORITY.** Requirements authority is `PRD/product-requirements.md` (SPRD) and `PRD/00`–`PRD/09`, with conflicts resolved by `PRD/00` §00.1.1. This document organises planning around existing requirements. It defines no requirement, target or owner decision. The quality obligations it refers to are SPRD §15–§27. The production-readiness gates are SPRD §24 and the per-capability readiness of `PRD/00` §00.8. Pilot and go-live governance is `PRD/00` §00.9. The release-acceptance list is SPRD §11. Story status comes from `_bmad-output/implementation-artifacts/sprint-status.yaml`.
>
> Status: **PROPOSED 2026-10-06, awaiting orchestrator review.** No gate below has been passed. The planning units proposed in §6 are **not yet tracked stories**, and the tracked denominator stays 98 until the orchestrator approves them.

## 1. What "complete" means

The owner's definition is: Servvia is genuinely production-ready and enterprise-grade, with the governed autonomous improvement system operational as part of the development lifecycle.

Therefore:

**STORY COMPLETE ≠ PRODUCT PRODUCTION READY.**

All 98 tracked stories reaching `done` is necessary, but it is not enough; production readiness is decided only by the release gates in §4. SPRD §24 already says this ("Implemented is not production ready"), and SPRD §26 says that "a story is not DONE solely because code exists".

**Enterprise-quality principle.** Every applicable story is engineered to the SPRD Enterprise Quality Bar (§15 rows A–AH) from the start. That means architectural correctness, maintainability, security and least privilege, data integrity, explicit failure behaviour, observability, testability, deterministic and reproducible behaviour, safe migrations and compatibility, performance against *approved* targets, accessibility where applicable, and operational supportability.

**Quality depth and product breadth are separate.** Enterprise-grade does not mean building every conceivable enterprise feature before release. Product scope stays as the normative PRD sets it, including ADR 0002, the deferred scope of Epic 13 and `TARGET CAPABILITY — FUTURE DELIVERY` items.

## 2. Canonical story denominator (2026-10-06, after Story 15.1 closed)

| Measure | Count | Source |
|---|---|---|
| **TOTAL TRACKED** | **98** | `sprint-status.yaml` story keys (98), which match the `Story N.M` headings of `epics.md` one to one. The traceability audit also reports 98/98. |
| DONE | 28 | `sprint-status.yaml` |
| REVIEW | 0 | `sprint-status.yaml` |
| BACKLOG | 70 | `sprint-status.yaml`, including the deferred, blocked and authorization-gated stories below |
| DEFERRED (story Status line) | 5 | 1.10, 13.1, 13.2, 13.5, 13.7 |
| BLOCKED for the whole story on an owner or external item | 7 | 10.6 (O-3), 11.1 (O-5), 11.2 (O-6), 11.3 (O-4/O-5), 12.10 (DEF-25 policy), 13.3, 13.6 |
| BLOCKED in part (the mechanics are ready) | 5 | 3.2, 10.3, 12.1, 12.13, 13.4 |
| NEEDS AUTHORIZATION (remote, infrastructure or venue action) | 3 | 1.6, 4.2, 12.12 |

| Class | Stories | Count | Done |
|---|---|---|---|
| Governance / planning | 14.1, 14.2 | 2 | 2 |
| Deferred and blocked scope placeholders | Epic 13 (13.1–13.7) | 7 | 0 |
| Build, CI and test integrity (implementation) | Epic 1 (1.1–1.10) | 10 | 8 |
| Release and operational readiness (implementation) | Epics 3, 4, 12 | 19 | 4 |
| Product and platform (implementation) | Epics 2, 5, 6, 8, 9, 10, 11, 15, 16, 17, 18, 19 | 60 | 14 |

**IMPLEMENTATION STORIES** (code-bearing; excludes governance and the Epic 13 placeholders): **89**, of which **26 are done**. Excluding the deferred Story 1.10 there are **88 active implementation stories**.

**97 versus 98.** No planning artifact has ever recorded 97. The tracked count moved as follows:

- 61 at `a3b1e0a`;
- 70 by `354ea1b`;
- 93 at `0d1e334` (Story 14.2);
- 98 at `6526159`. The Epic 15 reconciliation removed 15.2 and 15.4 and added 15.2a–d, 15.4a, 15.4b and 15.7.

So 98 is the canonical denominator. The figure of 97 is one fewer than 98, and two explanations fit it; neither is verifiable from the repository:

- it counts the stories other than the deferred Story 1.10;
- it predates the addition of Story 15.7 (new on 2026-10-06) in the same reconciliation.

The denominator is not redefined here. Any narrower denominator (for example, active implementation stories = 88) is stated with its definition.

**Bookkeeping drift (reported, not changed here).**
- Twelve stories are `done` in `sprint-status.yaml` but their `epics.md` Status line still reads `READY`: 1.1, 1.2, 1.3, 1.4, 1.5, 2.1, 2.2, 2.3, 2.5, 2.6, 2.7 and 12.5. `sprint-status.yaml` is the status tracker.
- Story 12.6 carries two "Depends on" lines.
- Story 12.15 names itself as its own dependency.

These are recommended as a separate bookkeeping correction.

## 3. Quantitative targets and owner gates (preserved, not extended)

**Targets are the approved SPRD values only** (SPRD §10 NFR-PERF/NFR-REL/NFR-AUD/NFR-SEC-2, §15 rows O–P, §19):

- API read P95 < 200 ms;
- order submission P95 < 500 ms (excluding printing);
- kitchen-ticket propagation to the KDS < 3 s;
- print < 3 s (on venue hardware);
- availability ("86") propagation p95 < 30 s;
- Admin initial load < 2 s on 10 Mbps;
- kiosk navigation < 1 s per page;
- 99.5% monthly availability;
- daily backups retained 30 days;
- audit retained ≥ 90 days;
- TLS 1.2 or higher, plus the SPRD §16 authentication baselines.

These are a planning baseline (O-19); the owner still has to confirm them before release acceptance. Every SPRD §19 row marked **OWNER TARGET REQUIRED** stays unresolved: capacity, throughput, concurrency, reconnect storms, backlog and others. **P7** (O-19 confirmation, DEC-X-8 capacity, DEC-X-9 RPO/RTO) is unresolved. KitchenOS figures that were not approved are **not adopted**: 99.9%, zero data loss, 500–2000+ orders/hour, < 1% error, and any ROI or timeline claims.

**Owner and external gates, classified as SPRD/`PRD_ALIGNMENT.md` classify them (none is approved):**

| Gate | Class | Blocks |
|---|---|---|
| P5 compliance regime (DEC-X-5, INV-22) | production / compliance gate | G5 production release; any compliance commitment |
| P6 financial-control values (DEC-X-7 etc.) | pilot / production policy gate | pilot enablement of the affected controls (16.3), G4 |
| P10 guest-safety configuration (allergens) | production gate where relevant | G5 for affected surfaces |
| P7 = O-19 confirmation, DEC-X-8, DEC-X-9 | release-acceptance gate | G5; the restore acceptance thresholds of 3.2 |
| O-3 (provider, acquirer, terminal, terms), owner part | pilot dependency | 10.6, the final pass of 12.8, G4 |
| O-4 (hardware; kitchen printing), owner part | pilot dependency | 11.3, 12.12, `minSdk` input to 17.1, G4 |
| O-5 (receipt and NZ tax-invoice content), owner part | pilot dependency | 11.1, 11.3, G4 |
| O-6 (pilot close reports) / DEC-FIN-10, owner part | pilot dependency | 11.2, the end-of-day runbook in 12.9, G4 |
| P13 pilot venue and timing | pilot dependency | 12.12, G4 |
| DEF-25 defect-severity policy (ODR) | release gate | 12.10, G3–G5 (SPRD §24 item 15) |
| O-1 native Waiter Tablet at the pilot | owner decision | whether Epic 19 is inside G4 (ADR 0002 default: no) |
| DL-117 (11 October 2026 milestone) | **NOT APPROVED** | nothing; it is not a plan date |
| Windows POS behaviour | PENDING USER POS ANALYSIS REPORT | 13.1; the POS stays frozen |

## 4. Release gates

Gates are cumulative: each one requires the one before it. A gate passes only with the evidence listed, recorded as a dated **gate record** and accepted by the orchestrator, plus the owner where the gate names an owner decision. **No gate is inferred from story status.** In particular, the last story reaching `done` passes nothing by itself.

| Gate | Scope | Acceptance (all evidence-based) | State |
|---|---|---|---|
| **G1 — Story complete** | one story | The story's acceptance criteria hold with evidence. For a governed story, that means a frozen objective, an evaluator PASS / CANDIDATE_READY_FOR_ACCEPTANCE, a ledger with an intact chain, and the integration commit. The applicable SPRD §15 obligations hold (§26). The orchestrator accepts. | Per story: 28 passed (the `done` stories) |
| **G2 — Subsystem integration ready** | one subsystem or wave (for example, the Wave B identity/audit set, pilot surfaces, CARD3 payments) | Every story of the subsystem is G1. Contract tests pass for its `contracts/`. Its critical journeys pass end to end on staging (4.2). It has its observability (§20). It has no open release-blocking defect under the DEF-25 policy. A subsystem integration record is kept. | Not passed for any subsystem |
| **G3 — Release candidate ready** | one versioned build | A reproducible release artifact from CI (RR-4) is deployed to staging by the documented deployment. On that exact artifact, SPRD §24 items 1–13 are evidenced: architecture compliance; security review including threat review (12.10, RR-2); tests (§21, including regression/E2E RR-5); migrations from zero, upgrade and drift (3.1, RR-5); rollback and recovery rehearsed (3.2, 12.9, RR-4); observability (12.1, 12.2, 12.13); runbooks (12.9); secrets and configuration (1.5, 4.1); performance against the §19 baseline (12.11); failure-mode drills (12.8); data integrity (RR-7); UX and accessibility acceptance (RR-3); supply chain (RR-1). Release-blocking defects: none. | Not passed |
| **G4 — Pilot ready** | the first independent pilot (SPRD §11; ADR 0002 scope) | G3, plus: the SPRD §11 release-acceptance list (pricing and tax, no duplicate charges or KOTs, ordered replay, station routing, reconciliation, refunds, device revocation, audit correlation, staff-visible recovery); the pilot acceptance criteria; the venue dry run on real hardware and LAN (12.12); the provider and terminal certified (10.6). Resolved for the pilot: P13, the owner parts of O-3/O-4/O-5/O-6, and P6 values for every enabled financial control. Separate operational authorization for cutover. | Not passed |
| **G5 — Production ready** | general production release | G4, plus: the pilot executed, followed by a stabilization period with a defect burn-down under the DEF-25 policy (RR-6); all 15 SPRD §24 gates evidenced, including item 14 (pilot and go-live acceptance) and item 15 (no unresolved release-blocking defects); every shipped capability meets `PRD/00` §00.8 items 1–7 (its acceptance criteria, resolved open decisions, runbooks, live alertable signals, documentation set, security testing), and any known residual risk carries an explicit owner acceptance (§00.8 item 5); P7 resolved (O-19 confirmation, DEC-X-8, DEC-X-9); P5 resolved before any compliance commitment; P10 where relevant; production rollout authorization by the owner. | Not passed |

## 5. Existing BMAD coverage of release readiness

| Readiness area | Existing coverage | Assessment |
|---|---|---|
| Full-system integration, E2E, failure injection | 12.8 (end-to-end acceptance and failure drills; final pass needs 10.6), 6.2, 10.3 | Covered as acceptance; no standing regression/E2E suite in CI (gap RR-5) |
| Regression testing | Epic 1 CI (1.1–1.9, Go Core CI 1.2), 1.6 branch protection (NEEDS AUTHORIZATION), 1.10 (DEFERRED) | Partial (RR-5) |
| Bug and stabilization cycles | none | Gap (RR-6) |
| Security hardening; authorization, provenance and audit validation | Epic 2 (done), Epic 15, 12.10 security review and penetration test (BLOCKED: DEF-25) | Covered; threat review not explicit (RR-2) |
| Dependency and supply-chain security (§15 row S, §16 item 14) | none | Gap (RR-1) |
| Secrets and configuration | 1.5 (done), 4.1, 12.13 | Covered |
| Performance, load, capacity, scalability | 12.11 (smoke against the O-19 baseline) | Partial: capacity targets are OTR (P7); no invented numbers |
| Reliability, backup and restore | 3.2 (BLOCKED for RPO/RTO thresholds), 12.3a (done), 12.3b | Covered for mechanics |
| Database migration, rollback, recovery | 3.1, 12.9 | Partial: from-zero/upgrade/drift verification (§21) not explicit (RR-5) |
| Observability, logging, metrics, alerting, health | 12.1, 12.2, 12.13, existing Core health and readiness | Covered (12.1 thresholds are OTR) |
| Production CI/CD, release artifact, deployment and rollback | CI (Epic 1); 4.1 Windows service; 4.2 staging; 12.9 runbooks | Gap for a reproducible release artifact and scripted deploy/rollback (RR-4) |
| Environment and configuration management | 4.1, 4.2 | Covered |
| Runbooks, incident readiness | 12.9 (end-of-day runbook BLOCKED: O-6), 12.2 | Covered |
| Accessibility and UX acceptance (§22, §23) | none at release level | Gap (RR-3) |
| Hardware, payment terminal and provider, printing, KDS, venue networking | 10.5a/b, 10.6, 11.3, Epic 6, 12.12, Epic 18 | Covered (owner/external blocked) |
| Compliance and release gates | SPRD §24 / §25; this document's §4 | Gate structure added here |
| Production documentation | 12.9 (§15 row AF); `PRD/00` §00.8 item 6 (API reference from `contracts/`, data-model and deployment documentation, security procedures, role-specific user guidance) | Partial: runbooks covered; the rest of the §00.8 documentation set has no story (RR-9) |
| Pilot qualification, release acceptance | 12.8, 12.12, SPRD §11 | Covered as acceptance; gate records added (RR-8) |
| Data-integrity validation (§17; §24 item 11) | concurrency and idempotency tests inside stories | Partial: no release-level integrity validation (RR-7) |
| Autonomous improvement loop | not represented in BMAD | Gap (AIL-1…AIL-6) |

## 6. Proposed planning units for genuine gaps (NOT YET TRACKED)

Each unit cites the normative requirement it serves. None adds product scope or a new target. Each enters `epics.md` and `sprint-status.yaml` only by orchestrator approval; on approval the tracked denominator rises from 98 by the number approved.

| Id | Proposed unit | Serves | Proposed placement |
|---|---|---|---|
| RR-1 | Dependency and supply-chain security: lockfile and checksum pinning enforced in CI, known-vulnerability scanning of npm and Go modules with a triage rule | SPRD §15 row S; §16 item 14 | Epic 12 |
| RR-2 | Threat review per external surface (Core API, realtime, Venue Edge, device credentials), feeding 12.10 | SPRD §16; §24 item 2; `PRD/00` §00.8 item 7 (security testing, penetration testing before production exposure) | Epic 12 (with 12.10) |
| RR-3 | Accessibility and UX acceptance of each pilot surface | SPRD §22, §23; §24 items 12–13 | Epic 12 |
| RR-4 | Reproducible release artifact from CI; scripted deploy and rollback to staging, then production; release versioning | SPRD §15 row Q; §24 items 4–5, 8 | Epic 4 |
| RR-5 | Standing regression suite: critical E2E journeys in CI, migration from zero / upgrade / drift checks, contract tests as a release gate | SPRD §21; §24 items 3–4 | Epic 1 or 12 |
| RR-6 | Stabilization cycles: defect intake, triage and burn-down against the DEF-25 policy (the policy itself is an owner decision) | SPRD §25; §24 item 15 | Epic 12 |
| RR-7 | Release-level data-integrity validation (reconciliation of orders, checks, payments, refunds and shift cash; audit and event coverage) | SPRD §17; §24 item 11 | Epic 12 |
| RR-8 | Gate records: the G2–G5 evidence register and its review procedure | SPRD §24 ("explicit release evidence") | Epic 12 |
| RR-9 | Production documentation set per `PRD/00` §00.8 item 6 (API reference, data-model and deployment documentation, security procedures, role-specific user guidance) | `PRD/00` §00.8 item 6; SPRD §15 row AF | Epic 12 |
| AIL-1 | Evaluator in CI: anchored evaluation runs on pushed candidates; evidence retained outside the developer machine | owner completion definition (development lifecycle); SPRD §21 tests in CI | new enabler epic (loop) |
| AIL-2 | Correction protocol proven on real stories (the TAP residual): capture the first natural correction, assess packet sufficiency, never manufacture one | evaluator README Phase 2 | loop epic |
| AIL-3 | Reusable objective-preparation tooling (generator, controls, adversarial probes and provisioning as shared tools instead of per-story scripts) | determinism and cost of preparation | loop epic |
| AIL-4 | Phase 3: lesson extraction and promotion (review of `LESSON CANDIDATE`s, promotion into policy and checks under orchestrator approval). Start only when natural failure evidence exists. | owner completion definition | loop epic (gated on evidence) |
| AIL-5 | Effort and outcome telemetry per governed story (preparation time, evaluation time, iterations) for the forecasting model in §8 | §8 | loop epic |
| AIL-6 | Durable, off-host evidence and ledger retention; review of the same-account trust model (sandboxing) | evaluator README "Evidence (provisional)", "Limitations" | loop epic |

## 7. Autonomous Improvement Loop maturity

| Capability | State | Evidence | Remaining work |
|---|---|---|---|
| Objective schema, validation, hash-bound inputs (spec intent contract, epic context) | **Operational** | `tooling/evaluator/lib/objective.mjs`; `loop.mjs validate`; 7 frozen objectives | — |
| Objective freeze (orchestrator anchor; parent = baseline; byte-identical) | **Operational** | `objectives/README.md`; anchors `fc064b5`, `e1dae66`, … | — |
| Independent evaluator (anchored export, authenticity, no LLM in the verdict) | **Operational** | `evaluate.mjs`; `authenticateEvaluator`; records `evaluator.authentic: true` | OS sandbox (AIL-6) |
| Deterministic verdicts and integrity policy (surfaces, governance paths, skips, suppressions) | **Operational** | `verdict.mjs`, `integrity.mjs`, `policy.json`; self-tests 115/115 | — |
| Baseline proof of required tests | **Operational** | `baseline.mjs`; for example, 15.1 RT-1…RT-5 `NOT_RUN_BUILD_FAILURE` | — |
| Evidence records and redaction | **Operational, provisional retention** | `~/.servvia/evaluator-evidence/` | AIL-6 |
| Hash-chained ledger, lock, bounded correction controller (gate/advance, signatures, failure packets, 2 corrections) | **Implemented; real use = first-pass PASS only** | `controller.mjs`, `signature.mjs`, `packet.mjs`; loop pilots proved FAIL → CORRECT → PASS and REPEATED_FAILURE_SIGNATURE synthetically; 7 real stories, 7 first-iteration PASSes, 0 corrections | AIL-2 (TAP residual open) |
| Deterministic objective generation | **Partial** | Per-story generators with `--check` (Stories 1.9 and 15.1) | AIL-3 |
| Positive and negative controls, adversarial validation | **Partial (manual, per story)** | 15.1: negative FAIL, positive PASS, 27/27 caught, 0 masked | AIL-3 |
| Governed provisioning (toolchain pins) | **Partial (per story)** | `provisioning/provision.sh` (1.9, 15.1) | AIL-3 |
| BMAD integration (gate before planning, advance after a run) | **Operational** | `_bmad/custom/bmad-build-auto.toml` | — |
| Acceptance and integration discipline | **Operational (manual, orchestrator)** | merges `963bd4c`, `4747043`; lifecycle commits | gate records (RR-8) |
| CI wiring of the evaluator | **Missing** | no evaluator job in `.github/workflows/ci.yml` | AIL-1 |
| Lesson extraction, rule promotion (Phase 3) | **Deferred (no evidence yet)** | `lessonCandidates` recorded only on repeated signatures; 0 across all ledgers | AIL-4 |
| Learning and feedback into planning (retrospectives, forecasting) | **Missing** | no epic retrospective run; no effort telemetry | AIL-5; retrospectives |

The Karpathy-style loop is therefore **not complete**. What exists is a mature, deterministic *evaluation and bounded-correction* system. The iterative *improvement* layer (CI operation, natural correction evidence, lesson promotion and learning feedback) remains.

## 8. Program to production readiness (owner target: April 2027)

**April 2027 is the owner's target for genuine production readiness (G5).** It is a planning target, not a requirement and not a launch date. Production cutover remains a separately authorised operational action (SPRD §11). DL-117 is not approved.

Waves follow the recorded `Depends on` lines of `epics.md`. They overlap where the dependencies allow.

1. **Wave B — identity, provenance and audit (current).** 15.1 is done. Next:
   - 15.3 → 15.2a → 15.2b; 15.2a → 15.2d;
   - 15.1 → 15.5; 15.7; 15.4a → 15.4b; 15.2c (independent).
   - **Feeds:** 5.1/5.2 (15.3, 15.2a), 6.1 (15.5, 15.7), Epic 9 (15.2d), 17.2 (15.3, 15.5, 15.7), 16.3 (15.1, 15.2a).
2. **Platform and operations foundations (parallel).**
   - 3.1 → 3.2;
   - 4.1 → 4.2 (needs authorization), which is a prerequisite of 5.2, 12.1, 12.9 and 12.11;
   - 12.2, 12.3b, 12.4, 12.6, 12.13;
   - 1.6 (needs authorization);
   - RR-1, RR-4, RR-5;
   - AIL-1, AIL-3, AIL-5.
3. **Wave C — service-day correctness on Core.**
   - 8.2 → 16.1 (with 15.2a) → 16.5;
   - 16.2;
   - 16.3 (15.1, 15.2a; pilot enablement needs P6) → 16.4.
4. **Transitional pilot surfaces.**
   - 5.1 → 5.2 → 5.3 (Order Tablet Staff Mode on Core);
   - 6.1 (needs 16.2, 15.5, 15.7) → 6.2, 6.3 (web KDS on Core).
5. **Cash settlement.** 9.1 → 9.2 → 9.3/9.4 → 9.5, 9.6 (after 15.2d).
6. **CARD3 payments.** 10.1 → 10.2 → 10.3, 10.4; 10.5a → 10.5b; then 10.6. 10.6 is **external: O-3**.
7. **Receipts, printing and day close.** 11.1 (O-5), 11.3 (O-4/O-5), 11.2 (O-6; needs 16.1, 16.5).
8. **Integration and qualification (G2 → G3).**
   - 12.1, 12.8, 12.9, 12.10 (DEF-25), 12.11;
   - RR-2, RR-3, RR-5, RR-7, RR-8;
   - subsystem integration records, then the release candidate.
9. **Pilot (G4).** 12.12 venue dry run (venue authorization, P13), resolution of the owner gates, cutover authorization.
10. **Stabilization (G5 path).** RR-6 defect burn-down under the DEF-25 policy; AIL-2/AIL-4 if natural evidence arises.
11. **Production release (G5).** P7 (O-19, DEC-X-8, DEC-X-9), P5, P10 and production rollout authorization.
12. **Native Android track (Epics 17–19, labelled post-pilot).**
    - 17.1 → 17.2 (needs 15.3, 15.5, 15.7) → 18.1–18.4 (native KDS; retires the web KDS) and 19.1–19.3 (Waiter Tablet Staff Mode; retires the web tablet).
    - **Open for orchestrator/owner decision:** whether G5 "production ready" by April 2027 includes the native KDS and Waiter Tablet, or whether production starts on the transitional surfaces (ADR 0002; O-1 default no). This plan does not decide it.
13. **Out of scope until decided:** Epic 13 (Windows POS: PENDING USER POS ANALYSIS REPORT; Guest Mode; native kiosk and window display; other deferred scope).

**Critical path (engineering):** Wave B (15.3, 15.2a, 15.5, 15.7) → pilot surfaces (5.x, 6.x) and settlement (9.x) → CARD3 (10.x) → qualification (12.8, 12.10, 12.11, RR units) → pilot → stabilization.

**Critical path (external):** O-3 provider and terminal selection and certification (10.6) and the hardware (O-4) will probably dominate, because they gate 10.6, 11.3, 12.8's final pass and 12.12.

## 9. Estimate envelope (planning estimate, not a requirement or guarantee)

The earlier ~600-hour ceiling is **no longer authoritative**. It covered a narrower scope. The owner's definition now also includes:

- the remaining BMAD implementation;
- autonomous-loop maturation;
- comprehensive QA;
- security and reliability hardening;
- performance and load qualification;
- production infrastructure, CI/CD and observability;
- stabilization;
- pilot and release qualification.

| Case | Effective engineering hours |
|---|---|
| Aggressive | ≈ 1,000 |
| Central | ≈ 1,200–1,400 |
| Contingency | up to ≈ 1,750 |

These are a provisional planning envelope supplied by the owner. **No story-level hour precision is claimed.**

**Empirical evidence available (seven governed stories, 2026-10-04 to 2026-10-06):**
- **First-iteration pass rate:** 7 of 7 stories (1.3, 1.7, 1.8, 1.9, 12.3a, 12.5, 15.1); 0 corrections.
- **Freeze-to-candidate time** (commit timestamps): 1–39 minutes.
- **Evaluation time:** 0.2–4.6 minutes of check time.
- **Objective preparation dominates:** design, evaluator checks, controls and adversarial validation took a session-scale effort per story (Story 15.1 needed three control reruns as its objective bytes evolved), plus orchestrator review cycles.

Commit timestamps understate preparation, which is not separately recorded. A forecasting model therefore needs AIL-5 telemetry. Until then, use story count by wave × an observed per-story preparation/implementation/review profile, with the envelope above as the bound. External waiting time (§10) is excluded from effective hours.

## 10. Schedule risk

**ENGINEERING EXECUTION RISK** (reducible by engineering):
- remaining Wave B and C complexity (provenance migrations, the business date);
- client migration of the web tablet and KDS onto Core;
- Venue Edge reliability on the LAN;
- regression debt while legacy and transitional paths coexist;
- performance against the §19 baseline;
- preparation cost per governed story;
- defects found only in integrated E2E;
- the unproven correction path (AIL-2);
- native Android scope if it is included in G5.

**EXTERNAL / OWNER DEPENDENCY RISK** (autonomous coding cannot remove it):
- **Owner decisions and values:** P5, P6, P7 (O-19, DEC-X-8, DEC-X-9), P10, P13, DEF-25, O-1, and the owner parts of O-3, O-4, O-5 and O-6.
- **Commercial and physical:** payment provider, acquirer and terminal selection and certification; physical hardware procurement (terminals, printers, tablets, KDS devices).
- **Venue access:** venue access and on-site testing (12.12).
- **External services:** provider sandboxes and certification, hosting and infrastructure provisioning (4.2); compliance advice.
- **Real-world failures:** failures discovered only in real use during the pilot.
- **Authorizations:** GitHub administration (1.6), production database and infrastructure actions, and production rollout authorization.

## 11. Next step

Orchestrator review of this program: the gates, the proposed units RR-1…RR-9 and AIL-1…AIL-6, the open native-track scope question, and the bookkeeping drift in §2. **No story is selected and none is started** until that review.
