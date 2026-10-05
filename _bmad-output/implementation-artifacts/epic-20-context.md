# Epic 20 Context: Governed autonomous improvement loop (development lifecycle)

<!-- Generated from planning artifacts. Regenerate with compile-epic-context if planning docs change. -->
<!-- Compiled 2026-10-06 (Story 20.3 objective preparation) from epics.md Epic 20 and the accepted release-readiness program revision 2 (7f21624); architecture authority is PRD/product-requirements.md Part C. -->

## Goal

The governed evaluator (`tooling/evaluator`, Phases 1 and 2) judges candidates deterministically against frozen objectives. Epic 20 makes the loop part of the development lifecycle rather than a local, per-story tool:

- the evaluator runs in CI;
- objective preparation uses reusable tooling;
- program telemetry and retrospectives feed planning and forecasting;
- evidence is durable and the evaluator is isolated from the code it judges;
- lessons are extracted and promoted once genuine correction evidence exists.

Natural correction evidence (the TAP residual) is an evidence requirement. It is never manufactured.

## Stories

- Story 20.1: Governed evaluator in CI
- Story 20.2: Reusable objective-preparation tooling
- Story 20.3: Program telemetry and retrospective feedback
- Story 20.4: Durable evidence retention and stronger evaluator isolation
- Story 20.5: Lesson extraction and promotion (Phase 3)

## Requirements & Constraints

- **Tests and evidence (SPRD §21, §24, §26):**
  - verdicts come from deterministic tests on disposable environments;
  - release readiness rests on explicit evidence (test reports, review records, rehearsal logs), not informal confidence;
  - a story is not done solely because code exists.
- **Evaluator independence:**
  - the objective, the evaluator's code and policy, and its environment come from the anchor commit, never from a candidate;
  - `tooling/evaluator/**`, frozen objectives and the epic contexts are governance paths a candidate never changes;
  - nothing in this epic may turn a FAIL into a PASS, alter frozen objective bytes, or modify or rewrite evaluator evidence or ledger history.
- **Telemetry is engineering-program measurement, not surveillance (owner program definition, 2026-10-06).**
  - It records story and objective identity, lifecycle events and their times, evaluator iterations and outcomes, test-suite growth, defects, and waiting time kept separate from effective work.
  - It never records keyboard or mouse activity, screenshots, workstation activity, files outside the repository and evaluator state, browsing, message contents, private reasoning, or anything that scores or ranks individuals.
  - It uses no third-party telemetry service.
- **No fabricated data:** unmeasured history stays explicitly unknown. Measured, derived (re-computable from immutable sources), explicitly recorded and unknown values are distinguished. Planning estimates (the effective-hour envelope) and assessments (April 2027: AT RISK) are hypotheses that telemetry tests. They are never acceptance thresholds.
- **Append-only evidence:** corrections are new, auditable records, never in-place edits.

## Technical Decisions

- Repository tooling lives under `tooling/` (SPRD Part C §30). It is Node.js with built-in modules only, and adds no new dependency.
- The evaluator's ledger (`servvia.iteration-ledger/v1`, hash-chained and sealed) and evaluation records (`record.json`, with `evaluatedAt` and per-check durations) live outside the repository (`~/.servvia/evaluator-state`, `~/.servvia/evaluator-evidence`). They are read, never written, by anything other than the evaluator.
- Changes to `tooling/evaluator/**` are governance changes, accepted by the orchestrator and never made by another story's candidate.

## Cross-Story Dependencies

- 20.3 and 20.2 have no dependency and come first (the program definition puts 20.3 before the next governed product story).
- 20.1 needs Story 1.6 (protected `main`; NEEDS AUTHORIZATION) only for enforcement as a required check.
- 20.4 needs 20.1, and is required before the first release candidate (G3).
- 20.5 is BLOCKED until natural correction evidence exists, and consumes 20.3's records.
