---
title: 'Story 20.3: Engineering-program telemetry and retrospective feedback'
type: 'feature'
created: '2026-10-06'
status: 'ready-for-dev'
review_loop_iteration: 0
followup_review_recommended: false
context: []
warnings: []
deferred: []
---

> **FREEZE CANDIDATE — NOT YET FROZEN.** Prepared 2026-10-06 against baseline `cc831dc629bba3b596287decce147080bf9f7f75`. Implementation is **not authorized**. The orchestrator alone freezes the objective (`_bmad-output/implementation-artifacts/objectives/README.md`). The freeze-candidate packet, its evidence and the generator are in `_bmad-output/implementation-artifacts/objective-drafts/story-20-3-program-telemetry/`.

<intent-contract>

## Intent

**Problem:** Program forecasts (the effective-hour envelope; the April 2027 assessment) rest on assumptions, because nothing records how long governed stories take, where time goes, or how often candidates need correction. The evaluator's ledger and records hold some facts (iterations, verdicts, evaluation times), git holds others (freeze, candidate and integration times, test files), and the rest (preparation, review, waiting) is not recorded at all.

**Approach:** Add a small repository tool, `tooling/telemetry/`, built on Node.js built-in modules only:

- it appends engineering-program **events** to a hash-chained, append-only log in the repository, `_bmad-output/implementation-artifacts/telemetry/events.jsonl`;
- it **derives** facts from git and from the evaluator's ledger and records, reading them and never writing them;
- it produces a deterministic per-story and program **summary** for forecasting and epic retrospectives.

Every value says how it is known: **measured** (taken from the clock when the event was recorded), **derived** (re-computable from git objects and the evaluator's ledger and records), **recorded** (stated explicitly by a person or process, including back-dated events), or **unknown** (with value `null`). Nothing is inferred to fill a gap.

### Contract (fixed; the evaluator's own checks call it)

`node tooling/telemetry/bin/telemetry.mjs <command> [--option value]…`.

- **Options:**
  - every option is `--name value`;
  - `--ref key=value` may repeat;
  - an unknown option, a missing value or an invalid value is refused.
- **Log:** `--log <path>`, defaulting to `_bmad-output/implementation-artifacts/telemetry/events.jsonl` relative to the working directory.
- **Exit codes:** 0 on success. Any refusal or integrity failure exits non-zero, writes the reason to stderr and changes nothing.

**Event** (`servvia.telemetry-event/v1`):
- one JSON object per line, the file ending with a newline;
- keys in this order, absent ones omitted, no other keys ever: `schema`, `seq` (1, 2, … in file order), `prev` (SHA-256 hex of the previous line's bytes without its newline; `null` for `seq` 1), `at` (UTC, `YYYY-MM-DDTHH:MM:SS.mmmZ`), `story` (for example `15.1`), `objectiveId`, `type`, `phase`, `reason`, `value` (number), `unit`, `refs` (string → string, keys sorted), `corrects` (a `seq`), `note` (at most 200 characters), `provenance` (`measured`, `derived` or `recorded`).
- An existing line is never changed, reordered or removed.

| `type` | Written by | Fields and rules |
|---|---|---|
| `phase-start`, `phase-end` | `record` | `phase` ∈ `preparation`, `implementation`, `correction`, `review`. A start is refused while the same phase of the story is open; an end is refused unless it is open. |
| `blocked-start`, `blocked-end` | `record` | Start needs `reason` ∈ `owner-decision`, `external`, `authorization`, `infrastructure`, `other`. One open blocked interval per story; an end needs an open start. Waiting is never effort. |
| `review-decision` | `record` | `reason` ∈ `accept`, `revise`, `reject` |
| `accepted` | `record` | orchestrator acceptance |
| `effort-recorded` | `record` | `phase` and `value` > 0 with `unit` `hours`; always `provenance: recorded` |
| `defect` | `record` | `reason` ∈ `escaped`, `reopened` |
| `retract` | `record` | `corrects` names an earlier non-`retract` event not already retracted; `note` (the reason) is required. The retracted event stays in the log and is excluded from every computation. |
| `frozen`, `candidate`, `evaluated`, `test-growth`, `integrated` | `derive` only | `record` refuses them; always `provenance: derived` |

- **`record --story <id> --type <type> [--phase] [--reason] [--value] [--unit] [--corrects] [--note] [--objective-id] [--ref k=v]… [--at <time>]`** appends one event. Without `--at`, `at` is the clock and `provenance` is `measured`. The clock is the environment variable `SERVVIA_TELEMETRY_CLOCK` when it is set (an ISO time), otherwise the system clock. With `--at`, `provenance` is `recorded`.
- **`derive --repo <dir> --objective-id <id> --story <id> --state-dir <dir> --evidence-dir <dir> [--integration <commit>]`** reads `<state-dir>/<objective-id>/ledger.json` and refuses it unless the evaluator's own `verifyChain` (`tooling/evaluator/lib/controller.mjs`) accepts it. For each version and iteration it reads `<evidence-dir>/<objective-id>/v<version>/<basename of the iteration's evidenceDir>/record.json` and refuses it unless its SHA-256 equals the iteration's `recordSha256`. It then appends:
  - **`frozen`** at the anchor commit's committer time, with `refs.anchor` (full id) and `refs.baseline`;
  - per iteration, **`candidate`** at the candidate's committer time, with `refs.candidate` and `refs.parent` (the previous candidate, or the anchor);
  - per iteration, **`evaluated`** at the iteration's `at`, with `value` = iteration number, `refs.candidate`, `refs.record` (record SHA-256), `refs.startedAt` (the record's `evaluatedAt`), `refs.verdict` and `refs.decision`;
  - per version, **`test-growth`** with `value` = Σ over the files changed between the anchor and the version's last candidate that match the anchor's `tooling/evaluator/policy.json` `testFiles` globs, of `countTests(candidate text) − countTests(anchor text)`, using the evaluator's own `countTests` (`lib/integrity.mjs`); at = the last candidate's committer time; `refs.anchor`, `refs.candidate`;
  - with `--integration`, **`integrated`** at that commit's committer time, with `refs.commit` and `refs.candidate`. It is refused unless the last candidate is an ancestor of the commit.

  Every event carries `objectiveId`, and times are committer times in UTC. An event equal in `story`, `objectiveId`, `type` and `refs` to one already present is not appended again (`derive` is idempotent). `derive` writes nothing but the log.
- **`verify`** prints `ok <n> events` and exits 0 when every line parses, has only contract keys, has `seq` = its line number, and its `prev` matches the previous line's SHA-256. Otherwise it exits non-zero naming the first bad `seq`.
- **`summary [--story <id>] [--epic <n>] [--format json|text]`** refuses a log that fails `verify`. `--epic 15` selects stories `15.*`. The default JSON output is `{"schema":"servvia.telemetry-summary/v1","stories":[…],"program":{…}}`, with stories in numeric story order (`1.9` before `1.10` before `12.3a`).
  - Each story is `{"story","objectiveIds":[…],"metrics":{…}}`.
  - Each metric is `{"value","provenance","basis"}`, with `provenance` ∈ `measured`, `derived`, `recorded`, `unknown`, and `value` `null` exactly when it is `unknown`.
  - Retracted events are ignored. Intervals are closed start/end pairs, and open intervals are ignored.
  - A value computed from more than one provenance takes the weakest (`recorded` < `derived` < `measured`).
  - A story is **live-tracked** when it has at least one `phase-start` event.

  | Metric | Value |
  |---|---|
  | `preparationElapsedMs` | Σ preparation intervals; else unknown |
  | `implementationElapsedMs` | Σ implementation intervals; else, derived, the first `candidate` time − the first `frozen` time; else unknown |
  | `implementationEffectiveMs` | Σ implementation intervals minus their overlap with blocked intervals; else unknown (never derived from wall clock) |
  | `evaluationElapsedMs` | Σ over `evaluated` of (`at` − `refs.startedAt`); else unknown |
  | `evaluatorIterations` | count of `evaluated`; else unknown |
  | `correctionIterations` | count of `evaluated` with `value` > 1; else unknown |
  | `firstPassVerdict` | `refs.verdict` of the first `evaluated` with `value` 1; else unknown |
  | `reviewRounds` | count of `review-decision`; else unknown |
  | `blockedMs` | Σ blocked intervals; 0 for a live-tracked story without any; else unknown |
  | `recordedEffortHours` | Σ `effort-recorded` values; else unknown |
  | `testDeclarationsAdded` | Σ `test-growth` values; else unknown |
  | `defectsEscaped`, `defectsReopened` | count of `defect` with that reason; 0 for a live-tracked story without any; else unknown |
  | `cycleElapsedMs` | from the first preparation start (else the first `frozen`) to the last `accepted` (else the last `integrated`); else unknown |

  `program` holds `stories` (count), `firstPassRate` (`{"value","n"}` over stories with a known `firstPassVerdict`, where `value` is the share that is `PASS`), and per numeric metric `{"n","median","p90","unknown"}`, with nearest-rank percentiles computed over known values only.

  `--format text` renders the same content deterministically: each story with each metric name, its value and provenance. The same log, repository and inputs always give byte-identical output.

## Boundaries & Constraints

**Always:**
- Everything is append-only. A correction is a `retract`, never an edit. `verify` detects any edited, removed, inserted or reordered line, and `summary` refuses such a log.
- The telemetry only **reads** git objects of `--repo`, the ledger and records named by `derive`, and its own log. It writes only by appending to its log. It never changes a verdict, a ledger, a record, a frozen objective or anything under `tooling/evaluator/`.
- Waiting (blocked intervals) is kept separate from effort, and effective time never includes it.
- Every correction iteration in the ledger appears as an `evaluated` event and is counted.
- The repository log holds the backfill of the seven governed stories completed before this story: 1.3, 1.7, 1.8, 1.9, 12.3a, 12.5 and 15.1. It is produced by `derive` from their ledgers and records, with each story's integration commit, so it contains **derived events only**. Their preparation effort, review rounds, recorded effort, effective time and waiting stay **unknown**.

**Never:**
- No value without a source: no estimate, average or session duration stands in for an unmeasured value, and no historical effort is invented.
- **No surveillance.** No keyboard, mouse, screen, window, process, clipboard, shell-history, browser or message data; no files outside the repository and the named evaluator state; nothing identifying or ranking a person (events carry no person field). No network access, no third-party service and no dependency beyond Node.js built-ins (plus read-only imports from `tooling/evaluator/lib/`). Child processes run `git` only.
- No change to `tooling/evaluator/**`, frozen objectives, epic contexts, the PRD, `.github/**`, product code or other tests. No skip, focus or suppression.
- The effective-hour envelope and the April 2027 assessment are not inputs, thresholds or outputs of this tool.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected | Error Handling |
|----------|--------------|----------|----------------|
| Live phase | `record` phase-start, then phase-end for implementation | Interval measured; `implementationElapsedMs` measured | — |
| Back-dated event | `record … --at <time>` | `provenance: recorded` | — |
| Waiting inside work | implementation 10:00–12:00, blocked 10:30–11:00 | elapsed 2 h, effective 1.5 h, blocked 0.5 h | — |
| Phase misuse | end without start; second start while open; unknown phase or type | nothing appended | refused, non-zero |
| Derived-only type | `record --type evaluated` | nothing appended | refused |
| Retraction | `retract --corrects 3 --note …` | line 3 unchanged; excluded from metrics | retracting twice refused |
| Tampering | any line edited, removed, inserted or reordered | `verify` names the first bad `seq`; `summary` refuses | non-zero |
| Unknown option or extra data | `--keystrokes x`, or a line with another key | refused or `verify` fails | non-zero |
| Ledger with corrections | iterations FAIL/CORRECT, FAIL/CORRECT, PASS | `evaluatorIterations` 3, `correctionIterations` 2, `firstPassVerdict` FAIL | — |
| Tampered ledger or record | seal or chain broken; record SHA-256 differs | nothing appended | refused |
| Derive twice | same inputs | second run appends nothing | — |
| Historical story | only derived events | preparation, review, effort, effective, blocked: `unknown` (`null`) | — |

</intent-contract>

## Code Map

- `tooling/evaluator/lib/controller.mjs`: `verifyChain(ledger)`, `sealOf`; ledger schema `servvia.iteration-ledger/v1` (`versions[].anchorCommit`, `baseline`, `version`, `iterations[]` with `n`, `candidate`, `parentCandidate`, `verdict`, `decision`, `recordSha256`, `evidenceDir`, `at`, `prevHash`). Read only.
- `tooling/evaluator/lib/integrity.mjs` (`countTests`) and `lib/glob.mjs` (`matches`); `tooling/evaluator/policy.json` (`testFiles`). Read only.
- Evaluation records: `record.json` (`evaluatedAt` = evaluation start; `checks[].durationMs`). Read only.
- Real ledgers and evidence: `~/.servvia/evaluator-state/<objectiveId>/ledger.json`, `~/.servvia/evaluator-evidence/<objectiveId>/v<n>/<dir>/record.json`. They are used once, to produce the committed backfill.
- Integration commits of the seven governed stories: 1.3 `ff3e4d7`, 1.7 and 1.8 `38bea30`, 1.9 `963bd4c`, 12.3a `8a4d3ab`, 12.5 `e575658`, 15.1 `4747043`.

## Tasks & Acceptance

**Execution:**
- `tooling/telemetry/bin/telemetry.mjs` (and any modules under `tooling/telemetry/`): the contract above.
- `tooling/telemetry/test/telemetry.test.mjs`: the required tests below (`node --test`), on fixture git repositories and fixture ledgers built in temporary directories.
- `_bmad-output/implementation-artifacts/telemetry/events.jsonl`: the backfill, produced by `derive` for the seven stories (in the order 1.3, 12.3a, 12.5, 1.7, 1.8, 1.9, 15.1) with their integration commits.
- `tooling/telemetry/README.md`: usage, the event and provenance model, the privacy boundary, and how retrospectives use `summary --epic`.

**Required tests** (names as `node --test` reports them):
- `telemetry: the event log is append-only and hash-chained`
- `telemetry: unknown values stay unknown`
- `telemetry: blocked time is kept separate from effort`
- `telemetry: iterations and corrections are derived from the ledger`
- `telemetry: deriving never writes evaluator state`
- `telemetry: the summary is deterministic`

**Acceptance Criteria:**
- Given a sequence of `record` calls, when the log is verified and summarised, then every value carries its provenance, the intervals and waiting are separate, and nothing invalid is ever appended.
- Given an evaluator ledger and its records, when `derive` runs (twice), then each iteration, correction and verdict appears exactly once as derived events, and the ledger and records are byte-identical afterwards.
- Given the repository log, when it is verified and summarised, then the seven historical stories show their derived facts exactly as git, their ledgers and their records give them, and every unmeasured value is unknown.
- Given the candidate, when it is compared with the baseline, then only `tooling/telemetry/**`, the telemetry log and this spec change, and the tool uses no network, no non-built-in dependency and no process other than `git`.

## Verification

The evaluator runs the frozen objective:
- `node-tests`: one `node --test` run of the evaluator's own suite (at least its baseline 115, unchanged) and the telemetry suite, holding the required tests;
- `telemetry-contract`: an evaluator-owned black-box test of the contract on fixture repositories and ledgers, run from a temporary directory;
- `telemetry-boundaries`: a static check of imports, child processes and prohibited data sources;
- `telemetry-backfill`: the repository log against git and the seven stories' ledger facts, fixed in the objective.

## Spec Change Log

- 2026-10-06: Freeze candidate prepared (Story 20.3 objective preparation). Not frozen.
