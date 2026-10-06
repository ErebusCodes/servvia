# Servvia checkpoint — 2026-10-06, second pause (Story 20.3 in review)

> **EXECUTION / RECOVERY EVIDENCE — NOT REQUIREMENTS AUTHORITY.** This file records the project state so a fresh session can recover it without chat history. It defines no requirement.
>
> Requirements authority is [`PRD/product-requirements.md`](../../../PRD/product-requirements.md) (SPRD) and `PRD/00`–`PRD/09`; conflicts follow `PRD/00` §00.1.1. BMAD (`_bmad-output/`) is planning.
>
> **SERVVIA PAUSED — NO NEW TASKS AUTHORIZED UNTIL OWNER RETURNS.**

Earlier the same day, the first pause ([`README.md`](README.md), at `127482c`) recorded Story 15.1 as a freeze candidate. That record is historical, and everything after it is recorded here.

## 1. Repository state

| Item | State |
|---|---|
| Integration branch | `integration/normative-prd-baseline` on `origin` (`https://github.com/ErebusCodes/servvia`). Before this checkpoint it was at `2b05833`, local and remote identical and the worktree clean. The tip is now the commit that adds this file, whose parent is `2b05833`. |
| Pull request | [#1](https://github.com/ErebusCodes/servvia/pull/1) → `main`: **open, unmerged, no auto-merge** |
| `main` | `a005642` (local and remote), not moved |
| Deployment / production | none |
| Original local checkout | Mixed and dirty. Preserved untouched: never staged, cleaned, reset or committed. Its fingerprint (index, staged, entries, unstaged, status hashes) is identical to the session's baseline. |
| Story branches (local only) | Kept with their worktrees: `story/story-1-9-…` (`f9110b7`), `story/story-15-1-core-audit-actor-attribution` (`453d07b`), `story/story-20-3-program-telemetry` (`1def3d1`). They are not published, and every one is integrated through a merge on the integration branch. |
| Evaluator state (outside the repository) | `~/.servvia/evaluator-state/<objectiveId>/ledger.json` and `~/.servvia/evaluator-evidence/` for 8 governed objectives: 1.3, 1.7, 1.8, 1.9, 12.3a, 12.5, 15.1 and 20.3. Each passed on iteration 1, and every ledger chain is intact. |

## 2. Story state

| Story | State |
|---|---|
| 15.1 Core audit actor attribution | **DONE**, orchestrator-accepted. Objective `06db19c2…`, anchor `e1dae66`, candidate `453d07b`, integrated `4747043`. |
| **20.3 Engineering-program telemetry (AIL-5)** | **IN REVIEW — GOVERNED PASS — AWAITING ORCHESTRATOR ACCEPTANCE.** Not done, and not yet accepted program infrastructure. |
| 15.3 Core-derived application identity | **NOT STARTED.** No objective preparation is authorized. |
| 1.10 CI asserts the native-round-recovery suite executes | **DEFERRED** |

- **Canonical BMAD denominator: 108 tracked stories** (history 61 → 70 → 93 → 98 → 108). 28 are done and 1 is in review (20.3). Status lives in `_bmad-output/implementation-artifacts/sprint-status.yaml`, and traceability is 108/108.
- **Enterprise production-readiness program:** revision 2 was accepted at `7f21624` (`_bmad-output/planning-artifacts/release-readiness-program.md`).
- **April 2027:** the owner's target for G5. It is a planning target, assessed **AT RISK**.
- **Planning envelope:** about 1,000 (aggressive), 1,200–1,400 (central) and 1,750 (contingency) effective engineering hours.
- These estimates and assessments are planning evidence, **not normative requirements**.

## 3. Story 20.3 recovery information

| Item | Value |
|---|---|
| Baseline | `cc831dc629bba3b596287decce147080bf9f7f75` (Epic 20 context and the Story 20.3 refinement) |
| Preparation packet | `144aea8` (`_bmad-output/implementation-artifacts/objective-drafts/story-20-3-program-telemetry/`) |
| Freeze anchor | `e5331d7669f5069d71ad174a2d6478939d22f47d` (parent `cc831dc`; contains only the objective and the spec) |
| Frozen objective | `_bmad-output/implementation-artifacts/objectives/story-20-3-program-telemetry/v1.objective.json`, sha256 `9dccbd0080b94276639e690a25a412fdf4b6f2ae917809401bf64a2bad3ca2fc` (intent contract `694bbfdf…`, Epic 20 context `bc56a8de…`) |
| Candidate | `1def3d160bed1cb105a41798eaf09d4c445abf25`: `tooling/telemetry/**` and `_bmad-output/implementation-artifacts/telemetry/events.jsonl` (9 files) |
| Governed evaluation | 1 iteration. Verdict **PASS**, decision **CANDIDATE_READY_FOR_ACCEPTANCE**. Evaluation record `e7793634ce4ff3a31cc289fdd74e9c77236c995d2069839159b92031c57bc11d`, ledger integrity `31633439e79a53942b21bc16312226186789822ee51d4cdf04694d40f442b9e9` (status `passed`, chain intact, 0 lesson candidates). No integrity findings. |
| Checks | `node-tests` 121/121 (the evaluator's 115 plus 6 telemetry tests; on the baseline, 115 passed and 6 failed); `telemetry-contract` passes (102 assertions); `telemetry-boundaries` passes; `telemetry-backfill` passes (25 assertions) |
| Required tests | RT-1…RT-6 pass on the candidate; all are `FAILED (behavioral)` on the baseline |
| Integration | merge `c1e39d4` (parents `144aea8`, `1def3d1`; the telemetry tree is identical to the candidate) |
| Lifecycle head | `2b05833`: 20.3 set to `review`, plus Story 20.3's own derived telemetry (the tool's first real use) |
| Telemetry log | `_bmad-output/implementation-artifacts/telemetry/events.jsonl`: 40 events and `telemetry verify` is ok. It holds 35 derived backfill events (7 stories) and 5 derived events for Story 20.3. |
| Historical backfill | 1.3, 12.3a, 12.5, 1.7, 1.8, 1.9 and 15.1, derived only. Freeze-to-candidate is labelled wall-clock time, not effort. Preparation, effective time, review, recorded effort, waiting and defects are unknown. The objective's backfill check matched it exactly. |
| TAP residual | **OPEN.** Story 20.3 passed on iteration 1, so no natural correction occurred. |

**Known residual observations (recorded, not fixed):**

1. **Test growth is a heuristic.** It uses the evaluator's `countTests` rule, as the frozen contract requires. Story 20.3 reports 7 because the rule also matches the fixture string `it('works', …)` inside its test file.
2. **Prospective measurement depends on `record` calls.** Preparation and review are measured only if the workflow actually records them at each phase boundary. Nothing enforces this yet.
3. **Unmeasured history stays unknown.** Historical effort that was never measured remains unknown.
4. **Each lifecycle record needs a commit.** The log is repository-backed under the current design.

## 4. Enterprise release state

**STORY COMPLETE ≠ SERVVIA PRODUCTION READY.**

- **Gates:** G1 (story), G2 (subsystem integration), G3 (release candidate), G4 (pilot) and G5 (Servvia production ready) are defined in the readiness program, and their decisions are recorded in `_bmad-output/planning-artifacts/release-gate-register.md`. **G2–G5 are NOT PASSED.**
- **What production readiness still depends on:**
  - the readiness program;
  - the permanent target architecture for in-scope production surfaces (native KDS and Waiter Tablet Staff Mode for G5);
  - qualification and stabilization;
  - operations readiness;
  - the owner and compliance gates (P5, P6, P7/O-19, P10, P13, DEF-25, O-1 pilot scope, G5 surface scope, the owner parts of O-3–O-6; DL-117 not approved);
  - owner rollout authorization.

## 5. Architecture invariants (verified, unchanged)

- Exactly four Android apps: `apps/android/{waiter-tablet,kds,kiosk,window-display}`. There is no Android order-tablet or customer-tablet app.
- Windows POS frozen: PENDING USER POS ANALYSIS REPORT.
- The web Order Tablet and web KDS are transitional, may serve the first pilot (ADR 0002), and are not production-complete surfaces.
- The normative PRD is unchanged.

## 6. Autonomous improvement loop

- **Operational:** objective preparation, freeze, the independent evaluator, deterministic verdicts, integrity policy, ledgers and evidence. The bounded correction controller is implemented but not yet naturally exercised.
- **Story 20.3 (AIL-5 telemetry):** implemented with a governed PASS, but it awaits orchestrator acceptance. It must be accepted before it is relied on as program infrastructure.
- **AIL-2 / TAP:** open. Never manufacture a correction.
- **Phase 3 (20.5):** blocked until natural correction evidence exists.
- **Other AIL units:** 20.1, 20.2 and 20.4 follow the approved sequencing in the readiness program.

## 7. Resume

**RESUME POINT: ORCHESTRATOR REVIEW OF STORY 20.3 GOVERNED PASS.**

Story 15.3 is **not** automatically next. It may follow after acceptance, but only on a fresh orchestrator instruction.

Recovery steps for a fresh session:

1. Fetch `origin`.
2. Verify the branch tip is this checkpoint commit (parent `2b05833`), PR #1 is open and unmerged, and `main` is at `a005642`.
3. Read this file, `release-readiness-program.md` and the Story 20.3 packet.
4. Optionally run `node tooling/telemetry/bin/telemetry.mjs verify` and `summary --format text`.

The original local checkout must stay untouched.
