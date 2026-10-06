# Story 20.3 freeze-candidate evidence

> **FREEZE CANDIDATE — NOT YET FROZEN.** Prepared 2026-10-06. Evidence classes are kept apart: **code** (read at a commit), **test** (executed here), **prior validation** and **documentation**. Nothing here is live or production evidence. Draft objective sha256: `9dccbd0080b94276639e690a25a412fdf4b6f2ae917809401bf64a2bad3ca2fc` (also in `../manifest.json`).

## 1. Preflight (code)

- `integration/normative-prd-baseline` was at `7f21624`, the accepted program revision 2, matching PR #1's head.
- `main` was at `a005642`.
- Story statuses: 15.1 done, 1.10 deferred, 20.3 backlog. All gates were NOT PASSED.
- The original checkout's fingerprint was identical.
- **Baseline: `cc831dc`.** It adds `epic-20-context.md` (the hash-bound input) and refines Story 20.3 within its accepted scope. This is planning only.

## 2. Existing telemetry and evidence (code)

| Source | Holds | Use |
|---|---|---|
| git | Commit times of anchors, candidates and integration merges; test files at each commit | derived (committer time) |
| Evaluator ledger `~/.servvia/evaluator-state/<id>/ledger.json` | Per iteration: `n`, candidate, parent, verdict, decision, `recordSha256`, `at` (end), hash chain and seal | derived (read only; `verifyChain`) |
| Evaluation record `record.json` | `evaluatedAt` (start), per-check `durationMs` | derived (read only; SHA-256 checked) |
| `lessonCandidates` | Repeated failure signatures (0 so far) | not needed |
| Lifecycle commits, chat sessions | Preparation and review happened, but neither was measured | **not used**: inferring effort from them would be fabrication |

There was no existing telemetry tool. The only other mentions of "telemetry" in the repository are the evaluator disabling Go and .NET vendor telemetry, and architecture text about Venue Edge.

## 3. Telemetry model (documentation; fixed by the spec's intent contract)

- **Measured:** an event recorded live, with the clock (`SERVVIA_TELEMETRY_CLOCK` or the system clock). This covers phase start and end for preparation, implementation, correction and review; blocked start and end with a reason class; review decisions; acceptance; and defects.
- **Derived:** values re-computable from immutable sources, written only by `derive`:
  - `frozen` (anchor commit time);
  - `candidate` (each candidate's commit time);
  - `evaluated` (ledger time, record start, verdict, decision, iteration);
  - `test-growth` (the evaluator's `countTests` over its policy's `testFiles`, anchor to candidate);
  - `integrated` (merge commit time).
- **Recorded:** explicit statements. These are back-dated events (`--at`) and `effort-recorded` hours.
- **Unknown:** `null` with provenance `unknown`. It is never 0 and never an estimate.
- **Waiting is separate:** effective time = phase intervals minus blocked intervals, and waiting has its own metric.
- **Append-only:** a hash chain over the log; corrections are `retract` events; `verify` detects edits, removals, insertions, reordering and extra keys.

Phases follow Servvia governance: PREPARATION → FREEZE (`frozen`) → IMPLEMENTATION → EVALUATION (`evaluated`) → CORRECTION and re-evaluation → REVIEW (`review-decision`) → ACCEPTANCE (`accepted`), with BLOCKED/WAITING as separate intervals.

Retrospectives use `summary --epic <n>` (JSON or text).

## 4. Historical backfill (code + test)

Seven governed stories are backfilled with derived events only. In each case, the ledger is chain-verified by the evaluator's `verifyChain` and the record SHA-256 matches the ledger. The facts are fixed in `generator/history.json`.

| Story | Freeze → candidate (wall clock) | Evaluation | Iterations / corrections | First pass | Test declarations added | Freeze → integration |
|---|---|---|---|---|---|---|
| 1.3 | 503 s | 20.7 s | 1 / 0 | PASS | 2 | derived |
| 12.3a | 1,378 s | 59.6 s | 1 / 0 | PASS | 6 | derived |
| 12.5 | 2,320 s | 71.4 s | 1 / 0 | PASS | 8 | derived |
| 1.7 | 662 s | 145.0 s | 1 / 0 | PASS | 0 | derived |
| 1.8 | 494 s | 106.4 s | 1 / 0 | PASS | 0 | derived |
| 1.9 | 74 s | 286.4 s | 1 / 0 | PASS | 0 | derived |
| 15.1 | 260 s | 68.4 s | 1 / 0 | PASS | 5 | derived |

For every one of them, these stay **unknown**: preparation elapsed, effective implementation, review rounds, recorded effort, waiting and defects.

**Freeze → candidate is wall clock, not effort.** For example, 1.3, 12.3a and 12.5 were frozen within the same two seconds and then implemented one after another.

## 5. Integrity and privacy boundaries (test)

- `telemetry-contract` proves that `derive` leaves the ledger, the records and the repository byte-identical, and refuses:
  - a tampered ledger;
  - a mismatched record;
  - an integration commit that does not contain the candidate.
- The evaluator, objectives, epic contexts, PRD, CI and manifests are forbidden surfaces.
- `telemetry-boundaries` restricts the tool to:
  - imports of `node:fs`, `node:fs/promises`, `node:path`, `node:crypto`, `node:child_process`, `node:url` and `node:process`, relative modules and the read-only `tooling/evaluator/lib`;
  - no network API;
  - child processes that run `git` only;
  - no surveillance data source;
  - no dependency manifest.
- Events have a closed key set and no person field.

## 6. Controls (test, disposable)

The controls ran in a disposable clone. The simulated anchor's first parent is `cc831dc`, and it holds only the draft objective (byte-identical) and the spec. The positive candidate is that anchor plus the disposable implementation. Each was judged by `evaluate.mjs` from the anchor's export, with no loop and therefore no ledger. See `control-negative.txt` and `control-positive.txt`.

| Control | Verdict | Detail |
|---|---|---|
| Negative (unfixed baseline) | **FAIL** | `node-tests` ran 115 evaluator tests, all healthy. `telemetry-contract`, `telemetry-boundaries` and `telemetry-backfill` fail because the CLI and the log do not exist. RT-1…RT-6 are missing. Every failure is Story 20.3's. |
| Positive (disposable implementation) | **PASS** | `node-tests` 121 (115 + 6); contract, boundaries and backfill pass. RT-1…RT-6 are `FAILED (behavioral)` on the baseline. No integrity finding. |

**History of the objective bytes.** Each change was followed by both controls rerunning on the new bytes:

1. `354b9fda`: the negative control gave INTEGRITY_VIOLATION (`too-few-tests`, a minimum on a brand-new suite), and the positive gave NEEDS_REVIEW (the disposable RT-5 passed vacuously; the evaluator caught it).
2. `6bde3a18`: still INTEGRITY_VIOLATION, because the evaluator requires at least one test per test check.
3. `c1fdda9f`: one `node-tests` check now runs the evaluator suite together with the telemetry suite, with a floor of 115. Negative FAIL, positive PASS.
4. **`9dccbd00`** (final): the contract also proves every phase, blocked reason, review outcome and defect kind. Negative FAIL, positive PASS.

The positive-control implementation, its backfill log and the disposable clones were deleted after validation. None of them was committed or published.

## 7. Adversarial validation (test)

`adversarial-probes.mjs` ran each variant through the full governed evaluator. **24 variants: 24 caught, 0 masked.** The unchanged positive control passes. See `adversarial-probes.out`.

Some variants were caught by exactly one mechanism, which shows that each mechanism is needed:

| Variant | Caught only by |
|---|---|
| Fabricated historical effort or phase | `telemetry-backfill` |
| No provenance distinction | `telemetry-contract` |
| Invasive capture (host and user) | `telemetry-boundaries` |
| Frontmost-application probe | `telemetry-boundaries` |
| Third-party upload | `telemetry-boundaries` |
| Edited evaluator test, weakened objective | integrity (governance) |
| Skipped required test | integrity (skip) |
| Vacuous required test | NEEDS_REVIEW (`required-test-passes-on-baseline`) |
| Package dependency, data outside the surfaces | integrity (forbidden surface) |

## 8. Determinism and health (test)

- `generate.mjs --check`: IDENTICAL, both in the worktree and in a fresh clone (see the final report).
- `loop.mjs validate` on a fresh clone at `cc831dc` with the spec on disk: `OBJECTIVE READY FOR FREEZE`, `9dccbd00…`.
- Evaluator self-tests: 115/115, inside both controls and separately.
- `~/.servvia` holds no Story 20.3 state.

## 9. TAP residual (prior validation)

These controls and probes ran outside any ledger. They are not a natural correction cycle, and the TAP natural-correction residual stays **open**.
