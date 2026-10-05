# Servvia release-readiness program

> **BMAD PLANNING ARTIFACT, NOT REQUIREMENTS AUTHORITY.** Requirements authority is `PRD/product-requirements.md` (SPRD) and `PRD/00`–`PRD/09`, with conflicts resolved by `PRD/00` §00.1.1. This document organises planning around existing requirements. It defines no requirement, target or owner decision. The quality obligations it refers to are SPRD §15–§27. The production-readiness gates are SPRD §24 and the per-capability readiness of `PRD/00` §00.8. Pilot and go-live governance is `PRD/00` §00.9. The release-acceptance list is SPRD §11. Story status comes from `_bmad-output/implementation-artifacts/sprint-status.yaml`.
>
> Status: **REVISION 2, 2026-10-06, awaiting orchestrator approval.**
> - The orchestrator accepted the framework of revision 1 (`bacf63b`): the G1–G5 concept, April 2027 as a planning target, the retired 600-hour ceiling, the hour envelope, the loop-maturity assessment, the readiness gaps and the risk separation.
> - Revision 2 corrects the production-completion definition, folds the readiness and loop gaps into controlled BMAD planning, and fixes the status and dependency bookkeeping.
> - **No gate has been passed.**

## 1. What "complete" means

The owner's definition is: Servvia is genuinely production-ready and enterprise-grade, with the governed autonomous improvement system operational as part of the development lifecycle.

**STORY COMPLETE ≠ PRODUCT PRODUCTION READY.** All tracked stories reaching `done` is necessary, but production readiness is decided only by the release gates in §5. This restates SPRD §24 ("Implemented is not production ready") and §26 ("a story is not DONE solely because code exists").

**Enterprise quality is continuous, not a later phase.** Each applicable story carries its own obligations under SPRD §15 rows A–AH and §26, as acceptance criteria and its Definition of Done:

- tests;
- security and least privilege;
- data integrity;
- failure behaviour;
- compatibility and migrations;
- observability;
- performance against approved targets;
- accessibility where applicable;
- operational supportability.

The readiness work (RR units, G2–G5) is a **convergence and qualification layer that proves the integrated product**. It never substitutes for story-level engineering quality, and there is no "features first, quality later" sequence.

**Quality depth and product breadth are separate.** Enterprise-grade does not mean building every conceivable enterprise feature before release. Product scope stays as the normative PRD sets it, including ADR 0002, Epic 13's deferred scope and `TARGET CAPABILITY — FUTURE DELIVERY`.

## 2. Canonical story denominator

| Measure | Count |
|---|---|
| Original tracked stories (revision 1) | 98 |
| New stories required (§6) | **10** (1.11, 1.12, 4.3, 12.17, 12.18, 20.1–20.5) |
| Existing stories extended (§6) | 2 (12.8, 12.10) |
| Gate, process or evidence units not represented as stories (§6) | 3 (RR-6, RR-8, AIL-2) |
| **FINAL CANONICAL DENOMINATOR (TOTAL TRACKED)** | **108** = 98 + 10 |
| DONE | 28 |
| REVIEW | 0 |
| BACKLOG | 80 |
| DEFERRED (Status line) | 5: 1.10, 13.1, 13.2, 13.5, 13.7 |
| BLOCKED for the whole story | 8: 10.6 (O-3), 11.1 (O-5), 11.2 (O-6), 11.3 (O-4/O-5), 12.10 (DEF-25), 13.3, 13.6, 20.5 (no natural correction evidence) |
| BLOCKED in part (mechanics ready) | 5: 3.2, 10.3, 12.1, 12.13, 13.4 |
| NEEDS AUTHORIZATION | 3 whole (1.6, 4.2, 12.12); 2 in part (4.3 production deployment, 20.1 required-check enforcement) |

Reproducible from the repository:

- `sprint-status.yaml` has 108 story keys, matching the 108 `Story N.M` headings of `epics.md`;
- `sprint_plan.py generate --dry-run` reports 19 epics, 108 stories, `in_sync`;
- the traceability audit reports 108 stories, 0 failures.

| Class | Stories | Count | Done |
|---|---|---|---|
| Governance / planning | 14.1, 14.2 | 2 | 2 |
| Deferred and blocked scope placeholders | Epic 13 | 7 | 0 |
| Build, CI and test integrity | Epic 1 (1.1–1.12) | 12 | 8 |
| Release and operational readiness | Epics 3, 4, 12 | 22 | 4 |
| Product and platform | Epics 2, 5, 6, 8, 9, 10, 11, 15, 16, 17, 18, 19 | 60 | 14 |
| Engineering lifecycle (autonomous loop) | Epic 20 (20.1–20.5) | 5 | 0 |

**IMPLEMENTATION STORIES:** 99 (all classes except governance and the Epic 13 placeholders), of which 26 are done. Excluding the deferred Story 1.10, 98 are active.

**History:** 61 (`a3b1e0a`) → 70 (`354ea1b`) → 93 (`0d1e334`) → 98 (`6526159`, the Epic 15 split) → **108** (this revision). **97** was an owner conversational reference. It is unsupported by repository history and is not a denominator.

**Bookkeeping corrected in this revision:**

- **Status drift.** The `epics.md` Status lines of 1.1–1.5, 2.1–2.3, 2.5–2.7 and 12.5 now read DONE. Each cites its tracking and accepted-lineage evidence (`sprint-status.yaml`, `docs/checkpoints/2026-10-05`) and its implementing or integration commit. Active statuses now agree for all 108 stories.
- **Dependency anomalies (12.6, 12.15).** These were **artifacts of the revision-1 extraction script**, not planning errors.
  - The second "Depends on" attributed to 12.6 belongs to the untracked `#### Former item 12.7` block.
  - The "12.15 → 12.15" line belongs to `#### Former item 12.16`, which legitimately depended on 12.15.
  - Story 12.6 declares exactly one dependency (none) and 12.15 declares none.
  - Nothing was changed. A parser that ends a story at any `####` heading finds no duplicate and no self-referential dependency.

## 3. Pilot scope versus Servvia production-complete scope

Two milestones, two scopes:

| | First pilot (G4) | Servvia production complete (G5) |
|---|---|---|
| Authority | ADR 0002 (reduced first pilot); SPRD §11, §13; `PRD/00` §00.9 | SPRD §32 (exactly four permanent Android apps), §34 (transitional components retire by PR-8: build → migrate → prove → retire), §24 |
| Waiter Tablet Staff Mode | The transitional **web Order Tablet** (Staff Mode) on Core may serve as the settlement surface (ADR 0002 item 8). O-1 asks whether the native Waiter Tablet is required *for the pilot venue*: open. | **`apps/android/waiter-tablet` Staff Mode (Epic 19) is required.** The web Order Tablet retires (19.3). |
| KDS | The transitional **web KDS** on Core with a D8 device credential (D-1, D-3; Epic 6). | **`apps/android/kds` (Epic 18) is required.** The web KDS retires (18.4). |
| Kiosk | Off in production (12.5). | **SCOPE AMBIGUITY, recorded.** If the G5 product-surface scope includes a kiosk, only `apps/android/kiosk` can satisfy it (13.7 leaves DEFERRED). There is no transitional kiosk surface: the web customer kiosk was removed (§34.3). |
| Window display / entrance menu | None (the legacy app was removed, §34.3; WD-1 gap). | **SCOPE AMBIGUITY, recorded.** If it is included, only `apps/android/window-display` can satisfy it (13.7). |
| Guest Mode | Not in the pilot (ADR 0002 item 4; 13.2 DEFERRED; P9 open). | **SCOPE AMBIGUITY, recorded.** If it is included, only as a mode of `apps/android/waiter-tablet` (13.2; WT-4). |
| Windows POS | Frozen, not in the pilot. | Frozen: PENDING USER POS ANALYSIS REPORT (13.1). |
| Transactional backend | Go Core; no Nest transactional path for the pilot workflows (SPRD §11 first usable product). | Go Core; every transitional component that still serves a G5 surface either retires or has the bounded overlap PR-7 requires (source owner, target owner, cutover, retirement criteria, bounded period). |

**Rules preserved:**

- exactly four canonical Android apps;
- no Android order-tablet or customer-tablet app;
- the web Order Tablet and web KDS may remain transitional for the pilot only.

**G5 completion rule.** G5 cannot pass while any product surface in the G5 release scope is served by a knowingly transitional surface where SPRD §32 and §34 designate a permanent native replacement. A required permanent surface can therefore never stay unimplemented indefinitely behind a transitional one.

**Recorded ambiguity: G5 product-surface scope.** The normative PRD does not state which customer-facing surfaces (kiosk, window display, Guest Mode) the first production release must contain. Their delivery phase is open (SPRD §13, DEC-X-17; P9 for display policy). This plan does not invent the answer. It requires an owner scope decision before G5 is planned in detail. Whatever is in scope is delivered natively, and whatever is out of scope is recorded as not yet delivered, never served by a transitional substitute.

## 4. Quantitative targets and owner gates (preserved, not extended)

**Targets are the approved SPRD values only** (§10 NFR-PERF/NFR-REL/NFR-AUD/NFR-SEC-2, §15 rows O–P, §19):

- read P95 < 200 ms;
- submit P95 < 500 ms (excluding printing);
- KDS propagation < 3 s;
- print < 3 s (on venue hardware);
- "86" propagation p95 < 30 s;
- Admin initial load < 2 s on 10 Mbps;
- kiosk navigation < 1 s per page;
- 99.5% monthly availability;
- backups retained 30 days;
- audit retained ≥ 90 days;
- TLS ≥ 1.2, plus the §16 authentication baselines.

These are the O-19 planning baseline; owner confirmation is still required before release acceptance. All **OWNER TARGET REQUIRED** rows of §19 remain unresolved, and **P7** (O-19, DEC-X-8 capacity, DEC-X-9 RPO/RTO) is unresolved. KitchenOS figures that were not approved are **not adopted**: 99.9%, zero data loss, 500–2000+ orders/hour, < 1% error, ROI or timeline claims.

| Gate | Class | Blocks |
|---|---|---|
| P5 compliance regime | production / compliance gate | G5; any compliance commitment |
| P6 financial-control values | pilot and production policy gate | pilot enablement of the affected controls (16.3); G4 |
| P10 guest-safety configuration | production gate where relevant | G5 for affected surfaces |
| P7 (O-19, DEC-X-8, DEC-X-9) | release-acceptance gate | G5; restore thresholds of 3.2 |
| O-3, O-4, O-5, O-6 (owner parts) | pilot dependencies | 10.6, 11.x, 12.8 final pass, 12.12; G4 |
| P13 pilot venue and timing | pilot dependency | 12.12; G4 |
| DEF-25 defect-severity policy | release gate | 12.10, 1.11 triage, RR-6; G3–G5 |
| O-1 (native Waiter Tablet at the pilot venue) | pilot-scope decision | whether Epic 19 is also in G4; it never removes Epic 19 from G5 |
| G5 product-surface scope (§3) | owner scope decision (recorded ambiguity) | detailed G5 planning for kiosk, window display, Guest Mode |
| DL-117 (11 October 2026) | **NOT APPROVED** | nothing |
| Windows POS | PENDING USER POS ANALYSIS REPORT | 13.1 |

## 5. Release gates (final model)

Gates are cumulative, so each requires the previous one. A gate passes only with its evidence recorded in the gate-record register (`release-gate-register.md`, RR-8) and accepted by the orchestrator, and by the owner where the gate names an owner decision. **No gate is inferred from story status.**

| Gate | Meaning | Acceptance (evidence-based) | State |
|---|---|---|---|
| **G1 — Story complete** | governed story acceptance | The story's acceptance criteria and applicable §15 obligations hold with evidence. A governed story also needs a frozen objective, evaluator PASS / CANDIDATE_READY_FOR_ACCEPTANCE, an intact ledger and the integration commit. The orchestrator accepts. | Per story: 28 |
| **G2 — Subsystem integration ready** | integrated subsystem evidence | Every story of the subsystem is G1. Contract tests and the subsystem's critical journeys pass in the standing regression gate (1.12) and on staging (4.2). Its observability signals are live and alertable. It has no open release-blocking defect (DEF-25). A subsystem record is in the register. | None passed |
| **G3 — Release candidate ready** | reproducible candidate on staging with release evidence | One artifact from 4.3 is deployed to staging by script. On that artifact, SPRD §24 items 1–13 are evidenced: security review with threat review (12.10), supply chain (1.11), regression and migrations (1.12, 3.1), rollback rehearsed (4.3, 3.2, 12.9), observability (12.1, 12.2, 12.13), documentation (12.9, 12.18), secrets and configuration, performance against the §19 baseline (12.11), failure drills and data integrity (12.8), UX and accessibility (12.17). Durable evidence and evaluator isolation (20.4) are in place for the evaluations behind it. No release-blocking defect. | Not passed |
| **G4 — Pilot ready** | pilot-specific gates | G3 for the pilot scope (§3), plus: the SPRD §11 release-acceptance list; the pilot acceptance criteria; the venue dry run (12.12); provider and terminal certification (10.6). Resolved: P13, the owner parts of O-3/O-4/O-5/O-6, P6 values for every enabled control. Cutover authorization. | Not passed |
| **G5 — Servvia production ready** | integrated target product released | G4 executed. Then: **permanent-architecture completion** of every product surface in the G5 scope (§3: native Waiter Tablet Staff Mode and native KDS, with the transitional web surfaces retired per PR-8, plus any other in-scope surface natively); G3 repeated on the production-complete release candidate; stabilization (RR-6) to the DEF-25 policy; all 15 SPRD §24 gates; every shipped capability meets `PRD/00` §00.8 items 1–7, with residual risk accepted by the owner; P7, P5 and P10 resolved as applicable; production operations readiness (runbooks rehearsed, monitoring and alerting live, backup and restore rehearsed); owner production-rollout authorization. | Not passed |

## 6. Readiness and loop gaps in controlled planning

**RR mapping**

| RR unit | Existing owner / story | New story needed? | Gate / process role | Normative source |
|---|---|---|---|---|
| RR-1 supply-chain / dependency security | none (CI exists, no scanning) | **Yes: 1.11** | G3 criterion | SPRD §15 row S; §16 item 14 |
| RR-2 threat review | 12.10 (security review, penetration test) | No: **12.10 extended** | G3 criterion | §16; §24 item 2; `PRD/00` §00.8 item 7 |
| RR-3 accessibility / UX acceptance | none at release level (story-level obligations stay) | **Yes: 12.17** | G3 criterion | §22, §23; §15 rows AB, AC; §24 items 12–13 |
| RR-4 release artifact, deploy and rollback | 4.1, 4.2 (environments), 12.9 (runbooks) | **Yes: 4.3** | G3 criterion (G5 for production) | §15 row Q; §24 items 4, 5, 8 |
| RR-5 standing regression / E2E, migration drift | 12.8 (acceptance runs), 3.1 (baseline rehearsal), 1.10 (deferred) | **Yes: 1.12** | G2 and G3 criterion | §21; §24 items 3–4 |
| RR-6 stabilization cycles | none | No: **recurring process** (defect intake, triage, burn-down per release candidate and after the pilot) | G5 criterion; recorded in the register | §25; §24 item 15 |
| RR-7 release-level data integrity | 12.8 (release acceptance includes reconciliation) | No: **12.8 extended** | G3 criterion | §17; §24 item 11 |
| RR-8 gate-record register | none | No: **evidence requirement**, created now (`release-gate-register.md`) | evidence for G2–G5 | §24 (explicit release evidence) |
| RR-9 production documentation | 12.9 (runbooks only) | **Yes: 12.18** | G3 criterion | `PRD/00` §00.8 item 6; §15 row AF |

**AIL mapping**

| AIL unit | Existing owner / story | New story needed? | Gate / process role | Normative source |
|---|---|---|---|---|
| AIL-1 evaluator in CI | none (evaluator local only) | **Yes: 20.1** | G1 evidence durability; required check after 1.6 | §21 (TEST-21); §24 explicit evidence |
| AIL-2 natural correction / TAP evidence | evaluator Phase 2 (implemented) | No: **evidence requirement**; arises only naturally and is never manufactured | prerequisite of 20.5 | evaluator README Phase 2; DOD-26 |
| AIL-3 reusable objective / control / provisioning tooling | per-story scripts (1.9, 15.1) | **Yes: 20.2** | process efficiency for G1 | §21 deterministic tests; DOD-26 |
| AIL-4 Phase 3 lesson extraction and promotion | `lessonCandidates` field only | **Yes: 20.5** (BLOCKED on AIL-2 evidence) | process improvement | DOD-26 |
| AIL-5 telemetry and retrospective feedback | none | **Yes: 20.3** | forecasting (§9); retrospectives | DOD-26; §24 |
| AIL-6 durable evidence, stronger isolation | provisional `~/.servvia` evidence | **Yes: 20.4** | G3 criterion (evidence behind the release candidate) | §24 evidence; §16; §15 row M |

The 10 new stories are written into `epics.md` (Epics 1, 4, 12 and the new Epic 20) and `sprint-status.yaml`. Each has acceptance criteria, traceability, dependencies and status. The extensions to 12.8 and 12.10 are dated acceptance-criteria lines in those stories. Nothing required is left outside the controlled plan.

## 7. Autonomous Improvement Loop: maturity and integration

| Capability | State | Evidence | Remaining work |
|---|---|---|---|
| Objective schema, validation, hash-bound inputs | Operational | `objective.mjs`, `loop.mjs validate`; 7 frozen objectives | — |
| Freeze discipline | Operational | anchors such as `fc064b5`, `e1dae66` | — |
| Independent evaluator; deterministic verdicts; integrity policy | Operational | authenticity check; self-tests 115/115 | isolation (20.4) |
| Baseline proof of required tests | Operational | e.g. 15.1 RT-1…RT-5 `NOT_RUN_BUILD_FAILURE` | — |
| Ledger, lock, bounded correction controller | Implemented; real use is first-pass PASS only | synthetic pilots proved FAIL → CORRECT → PASS; 7 real stories, 0 corrections | AIL-2 evidence |
| Objective generation, controls, adversarial checks, provisioning | Partial (per story) | 1.9, 15.1 packets | 20.2 |
| Evidence retention | Provisional | `~/.servvia` | 20.4 |
| BMAD integration | Operational | `bmad-build-auto.toml` | — |
| CI wiring | Missing | no evaluator job in `ci.yml` | 20.1 |
| Phase 3 lessons | Deferred, evidence-gated | 0 lesson candidates | 20.5 |
| Learning feedback (telemetry, retrospectives) | Missing | no retrospective; no telemetry | 20.3 |

**When each AIL unit occurs.** The units run alongside product work and never block ordinary stories on Phase 3:

| Unit | Timing |
|---|---|
| 20.3 (AIL-5) telemetry | **First**, so the rest of the program is measured. Lightweight; begins with the next governed story. |
| 20.2 (AIL-3) reusable tooling | **Early**, during Wave B, to cut the preparation cost that dominates governed stories. |
| 20.1 (AIL-1) evaluator in CI | **Early**, alongside the foundations wave. Enforcement as a required check follows 1.6 (needs authorization). |
| 20.4 (AIL-6) durable evidence and isolation | Mid-program, **before the first release candidate (G3)**. |
| AIL-2 | Continuous observation. Each natural FAIL → CORRECT cycle is captured and its packet assessed; none is manufactured. |
| 20.5 (AIL-4) Phase 3 | **Only after** genuine correction or repeated-signature evidence. If none arises before G5, it stays blocked and that is reported, not faked. |

## 8. Program toward April 2027

**April 2027: OWNER TARGET — PLANNING, NOT NORMATIVE REQUIREMENT.** It is the target for G5. Production cutover remains a separately authorised action, and DL-117 is not approved.

Waves follow the recorded dependencies in `epics.md` and overlap where those allow. Quality obligations travel with every story (§1).

1. **Wave B — identity, provenance, audit (current).**
   - 15.3 → 15.2a → 15.2b; 15.2a → 15.2d;
   - 15.5 (15.1 done); 15.7; 15.4a → 15.4b; 15.2c.
   - In parallel: 20.3, 20.2.
2. **Foundations (parallel).**
   - 3.1 → 3.2; 4.1 → 4.2 (needs authorization) → 4.3;
   - 1.11, 1.12; 12.2, 12.3b, 12.4, 12.6, 12.13;
   - 1.6 (needs authorization); 20.1.
3. **Wave C — service-day correctness.** 8.2 → 16.1 → 16.5; 16.2; 16.3 (P6) → 16.4.
4. **Pilot surfaces (transitional).** 5.1 → 5.3; 6.1 (needs 15.5, 15.7, 16.2) → 6.2, 6.3.
5. **Cash settlement.** 9.1 → 9.6 (after 15.2d).
6. **CARD3 payments.** 10.1 → 10.2 → 10.3, 10.4; 10.5a → 10.5b; then 10.6 (external: O-3).
7. **Receipts, printing, day close.** 11.1 (O-5), 11.3 (O-4/O-5), 11.2 (O-6; needs 16.1, 16.5).
8. **Native Android foundation.** 17.1 (dependencies met) → 17.2 (needs 15.3, 15.5, 15.7). The native apps are not part of the first pilot's deployment (SPRD §13, unless O-1 decides otherwise), but their development may start as soon as dependencies allow, because they are on the G5 critical path. The epics' "post-pilot" labels describe deployment, not a development embargo.
9. **Pilot qualification (G2 → G3 → G4).**
   - 12.1, 12.8 (extended), 12.9, 12.10 (extended; DEF-25), 12.11, 12.17, 12.18, 20.4;
   - the venue dry run 12.12; owner pilot gates; pilot.
10. **Native KDS and Waiter Tablet Staff Mode (on the G5 critical path).**
    - 18.1 → 18.2, 18.3 → 18.4 (parity, venue migration, web KDS retirement);
    - 19.1 → 19.2 → 19.3 (settlement parity after Epic 9; web tablet retirement).
    - Both can run in parallel with the pilot once 17.2 is proven.
11. **Other in-scope permanent surfaces**, per the G5 scope decision (§3): 13.7 (kiosk, window display), 13.2 (Guest Mode).
12. **Production qualification and stabilization.** G3 on the production-complete candidate; RR-6 stabilization; P7, P5, P10.
13. **Production release (G5).** Owner rollout authorization.

**Revised critical path.**

- **Engineering:** Wave B (15.3, 15.2a, 15.5, 15.7) → 17.1/17.2 → native KDS (18.1–18.4) and native Waiter Tablet Staff Mode (19.1–19.3; 19.3 also needs Epic 9). These must reach parity and retire the transitional surfaces after the pilot has proven the Core workflows.
- **Pilot path in parallel:** pilot surfaces (5.x, 6.x), settlement (9.x), CARD3 (10.x), receipts (11.x) → qualification → pilot → stabilization.
- **External:** O-3 (provider, terminal, certification for 10.6) and O-4 (hardware, including Android devices, which also feed the `minSdk` input to 17.1) gate both the pilot and native parity. The G5 surface-scope decision gates detailed planning for 13.2 and 13.7.

## 9. Forecast

**Effective engineering hours.** These are a planning estimate supplied by the owner, not a requirement or guarantee.

| Case | Hours |
|---|---|
| Aggressive | ≈ 1,000 |
| Central | ≈ 1,200–1,400 |
| Contingency | ≈ 1,750 |

**The envelope is retained, but its expected value is skewed upward.** Two things now sit inside G5: the native KDS and Waiter Tablet (Epics 17–19, 9 stories on Android scaffolds with no product code yet) and the ten new readiness and loop stories. The owner's envelope already described full production readiness, so this is not a material change of scope. It does make the upper half of the central range (≈ 1,400) the more likely planning value. If the G5 surface-scope decision adds kiosk, window display or Guest Mode natively, the contingency figure becomes the realistic planning case and the envelope should be revisited then.

**Indicative allocation of the central case.** These are planning shares, not measured values. AIL-5 telemetry (20.3) will replace them with measurements.

| Category | Share |
|---|---|
| Implementation of the remaining in-plan backlog (72 stories: 80 backlog less the 7 Epic 13 placeholders and the deferred 1.10; native Android ≈ a fifth of it) | ≈ 50–55% |
| Evaluator and objective preparation for governed stories (falling as 20.2 lands) | ≈ 15–20% |
| Integrated qualification (G2–G4 evidence, RR stories, drills, security review, performance, accessibility, documentation) | ≈ 15–20% |
| Stabilization (RR-6) after the pilot and on the production candidate | ≈ 8–12% |
| **External waiting** | **0 hours, by definition.** Its calendar impact is separate (below). |

**Calendar.** From 2026-10-06 to the end of April 2027 is about 29 weeks. The envelope needs sustained effective throughput of:

- about 34 h/week (aggressive);
- about 41–48 h/week (central);
- about 60 h/week (contingency).

That is before any external waiting. Several external items take weeks to months each and cannot be compressed by engineering: provider and acquirer selection and certification (O-3), hardware procurement and venue access (O-4, P13, 12.12), and owner decisions.

**Assessment: AT RISK.** It is not OFF TRACK, because:

- the governed pipeline has delivered 7 of 7 stories at first-iteration PASS;
- the post-freeze implementation time is minutes;
- many remaining stories are small, Core-centred and already READY.

It is not ON TRACK, because:

- 80 stories remain, including the entire native Android product (scaffolds only) now on the G5 path;
- the external critical path (O-3, O-4) is unresolved and has no date;
- several G5 gates depend on owner decisions with no date: P5, P7, the DEF-25 policy and the G5 surface scope;
- governed-story preparation cost is not yet measured (20.3);
- the correction protocol is unproven on real stories.

The date is not guaranteed. The assessment is revised when 20.3 telemetry and the owner decisions arrive.

## 10. Schedule risk

**ENGINEERING EXECUTION RISK:**

- Wave B and C complexity (provenance migrations, the business date);
- client migration of the web tablet and KDS onto Core;
- native Android delivery and parity (Epics 17–19);
- Venue Edge reliability on the LAN;
- regression while legacy and transitional paths coexist;
- performance against the §19 baseline;
- preparation cost per governed story;
- defects found only in integrated end-to-end testing;
- the unproven correction path.

**EXTERNAL / OWNER DEPENDENCY RISK:**

- **Owner decisions and values:** P5, P6, P7, P10, P13, DEF-25, O-1 (pilot scope), the G5 product-surface scope, and the owner parts of O-3, O-4, O-5 and O-6.
- **Commercial and physical:** provider, acquirer and terminal certification; hardware procurement (terminals, printers, Android devices).
- **Venue access:** the pilot venue and on-site testing.
- **External services:** infrastructure provisioning and compliance advice.
- **Real-world failures:** failures discovered in real use.
- **Authorizations:** GitHub administration, production infrastructure and database actions, and production rollout.

## 11. Next step

Orchestrator approval of this revision. **No story is selected and none is started** until then.
