# Servvia evaluator (Phases 1 and 2)

Judges one **candidate commit** against a **frozen objective**, without trusting
the implementer's account of its own work. Deterministic: git, the test
runners and this code produce the evidence; `lib/verdict.mjs` computes the
verdict. No language model takes part in it.

Phase 1 is the evaluator. Phase 2 adds a bounded correction loop around it
(`bin/loop.mjs`, below). There is no automatic revert, rule promotion, lesson
learning or CI wiring.

## Trust model

The candidate can change any file in its tree. What judges it is therefore
never taken from the candidate:

| Authority | Taken from |
| --- | --- |
| The objective | the **anchor commit** (`git cat-file`), checked against the SHA-256 the orchestrator recorded on approval |
| The evaluator's code and policy | the anchor commit: the running evaluator refuses to work (`HARNESS_ERROR`) unless every one of its files is identical to the anchor's `tooling/evaluator/` |
| The environment | `env/evaluation.json` at the anchor, plus the disposable services the evaluator starts; nothing is inherited from the shell and no `.env` is read |
| The code under test | `git archive` of the candidate commit into a fresh directory, never a working tree |
| The verdict | computed from runner output (Jest JSON, `go test -json`, Node TAP, exit codes) |

The guarantee is **detection by reconstruction**, not prevention: under one
Unix account an implementer can write anywhere, but anything it changes in
the objective, the evaluator, the policy or a check's configuration is
visible in `git diff anchor..candidate` and rejected. Run the evaluator from
an export of the anchor commit, not from the candidate's checkout.

## Running it

```bash
# From an export of the anchor commit (so the evaluator is the frozen one):
git -C <repo> archive <anchor> tooling/evaluator | tar -x -C /tmp/eval-anchor
node /tmp/eval-anchor/tooling/evaluator/bin/evaluate.mjs \
  --repo <repo> --anchor-commit <anchor> \
  --objective _bmad-output/implementation-artifacts/objectives/<id>/v<n>.objective.json \
  --objective-sha256 <hash recorded at approval> \
  --candidate <sha> \
  --node-modules <a node_modules root>   # dependencies (linked, never written)
  # optional: --go-root, --go-modcache, --pg-bin, --redis-bin, --evidence-dir
```

Exit code: 0 `PASS`, 1 `FAIL`, 2 `NEEDS_REVIEW`, 3 `INTEGRITY_VIOLATION`, 4 `HARNESS_ERROR`.

Tests of the evaluator itself: `node --test 'tooling/evaluator/test/*.test.mjs'`.

## The objective (`servvia.objective/v1`)

A JSON file, frozen by the orchestrator in its own commit (the anchor) whose
parent is `baseline`. Validated by `validateObjective` in `lib/objective.mjs`.

| Field | Meaning |
| --- | --- |
| `objectiveId`, `storyId`, `version`, `title` | identity; a changed objective is a new `version` in a new anchor |
| `baseline` | the commit the work starts from: the anchor commit's parent |
| `requirementRefs`, `architectureConstraints`, `acceptanceCriteria` | traceability (PRD, `fileRestructure.md`, ADRs, the BMAD story); ACs as Given/When/Then |
| `approval` | `approvedBy`, `reference` (where the orchestrator approved it) |
| `environment.services` | `postgres`, `redis`: started disposable, loopback only |
| `setup` | commands run before the checks (code generation, migrations, seed) |
| `checks` | `id`, `category`, `runner` (`jest`, `go-test`, `node-test`, `command`), `args`, `cwd`, `mandatory`, `minTests`, `configFiles` (configuration the check depends on: protected), optional `flakePolicy.approvedRetries` |
| `requiredTests` | tests that must run and pass; `expectBaselineFailure: true` (with `files`) means the evaluator also runs them on the baseline and expects them to fail there; `false` needs a `baselineException`: `regression-characterization`, `architecture-completeness`, `refactoring-invariant` or `coverage` |
| `surfaces.allowed`, `surfaces.forbidden` | where the implementation may and may not change code |
| `expectationChanges` | existing tests, fixtures, snapshots, manifests or build configuration the story is approved to change, each with a reason; authorizing a test file never authorizes removing its tests: each removed test must be named in `retiresTests` |
| `allowedSkips`, `allowedSuppressions` | skips and lint/type suppressions the objective accepts |
| `completionCriteria` | what "done" means, in words, for the orchestrator |

## Path classes (`policy.json`)

- **Governance (evaluation authority)**: the evaluator, frozen objectives,
  `PRD/`, `fileRestructure.md`, ADRs, BMAD configuration and skills. A
  candidate changing any of it is an `INTEGRITY_VIOLATION`.
- **Objective-controlled expectation surfaces**: tests, fixtures, snapshots,
  manifests, build and test configuration, CI. They may change where the
  objective's `expectationChanges` authorizes the path. Otherwise: removing or
  disabling tests (a deleted test file, fewer tests in a file, an added skip
  or focus) or changing a check's own `configFiles` is an
  `INTEGRITY_VIOLATION`; any other change is `NEEDS_REVIEW`.

## Verdicts

Strongest first; the strongest present wins.

| Verdict | Meaning |
| --- | --- |
| `INTEGRITY_VIOLATION` | the candidate changed what judges it, removed or disabled tests, does not descend from the anchor, the objective does not match its approved hash, or a mandatory check executed fewer tests than its floor |
| `HARNESS_ERROR` | the evaluation could not be carried out (unknown commit, an evaluator that is not the frozen one, invalid objective, a tool that would not start) |
| `FAIL` | a mandatory check or a required test failed, or a required test is missing |
| `NEEDS_REVIEW` | possibly legitimate, not authorized: an unapproved change to an existing test or surface, a new suppression, a skip at run time, a required test that already passes on the baseline, a check that failed and then passed on retry (a flake) without an approved flake policy |
| `PASS` | none of the above |

There is no "pass with flake": a flaky mandatory check is `NEEDS_REVIEW`
unless the frozen objective approved retries for it.

## The bounded correction loop (Phase 2)

`bin/loop.mjs` (`lib/controller.mjs`) evaluates successive candidates of one
frozen objective version and decides what happens next. It never corrects
anything itself.

| Evaluator verdict | Decision |
| --- | --- |
| `PASS` | `CANDIDATE_READY_FOR_ACCEPTANCE`: technically eligible; the orchestrator accepts (or not); nothing is merged or pushed |
| `FAIL` | `CORRECT` with a failure packet, unless the same failure signature occurred before (`STOP REPEATED_FAILURE_SIGNATURE`) or this was the last allowed candidate (`STOP CORRECTION_LIMIT_REACHED`) |
| `NEEDS_REVIEW`, `INTEGRITY_VIOLATION`, `HARNESS_ERROR` | `STOP`: back to the orchestrator, never corrected |

- **Limit**: an initial candidate and at most `policy.loop.maxCorrections`
  (2) corrections: C1, C2, C3.
- **History**: each correction is a new commit descending from the previous
  candidate (an amended or rebased candidate stops the loop:
  `CANDIDATE_HISTORY_VIOLATION`); failed candidates stay in git and in the
  ledger.
- **Objective versions**: one loop per version. A newer frozen version
  supersedes the open loop (its candidates are kept, marked superseded) and
  restarts the count; an older version or a second freeze of the same
  version is refused (`OBJECTIVE_SUPERSEDED`, `OBJECTIVE_VERSION_CONFLICT`).
- **Failure signature** (`lib/signature.mjs`): per failing check and test,
  the normalized test name and error class (first meaningful line), with
  paths, ports, ids, hex, timestamps and numbers removed; sorted and hashed.
  Equal failures in different runs share a signature.
- **Failure packet** (`servvia.failure-packet/v1`, `lib/packet.mjs`): objective
  identity and hash, iteration, candidate, signature, each failing check and
  test with its error class, a redacted excerpt (at most 1500 characters)
  and a source location when one can be read deterministically; the
  objective's required tests and surfaces; fixed correction rules. No raw
  logs, environment or evaluator policy.
- **Ledger** (`servvia.iteration-ledger/v1`): outside the repository
  (`~/.servvia/evaluator-state/<objectiveId>/ledger.json` by default), one
  entry per candidate (candidate, parent candidate, verdict, decision,
  signature, packet and record SHA-256s), hash-chained and sealed on every
  write; a ledger edited by hand stops the loop (`LEDGER_TAMPERED`).
  Repeated signatures are recorded as unreviewed `LESSON CANDIDATE` entries;
  nothing is promoted.
- **Objective freeze**: `loop.mjs validate` checks a draft and prints
  `OBJECTIVE READY FOR FREEZE` with its SHA-256; it never freezes or approves.
  `loop.mjs gate` is open only for an anchored objective matching the
  approved hash, whose loop is open.

BMAD: `_bmad/custom/bmad-build-auto.toml` runs the gate before planning and
`loop.mjs advance` after a run ends `done` (which means "candidate
produced"); corrections are new `bmad-build-auto` runs given the
`failure_packet`.

## Evidence (provisional)

Each evaluation writes, by default under `~/.servvia/evaluator-evidence/`
(outside the repository), a directory holding `record.json` and the raw
output of each setup step and check. Everything is redacted before it is
written (JWTs, Bearer/Basic values, setup codes, connection-string passwords,
cookies, key/value secrets, email addresses, and the value of every
secret-named variable of the evaluation environment). The record lists each
file's SHA-256. Cleanup is deterministic and manual:
`loop.mjs cleanup --older-than-days <n>` removes evaluations older than n
days; `--purge-objective <id>` removes one objective's ledger and evidence.
This is not the final retention architecture. Nothing is written to `PRD/` or committed.

## Limitations

- Same-account execution: tampering is detected, not prevented.
- Checks execute candidate code (tests are code). They run with test-only
  credentials and disposable local services, but not in an OS sandbox.
- "Fewer tests in a file" counts `it(`/`test(`/`func Test` declarations; a
  weakened assertion inside a kept test is caught only as an unapproved
  modification of an existing test (`NEEDS_REVIEW`).
- The baseline-failure proof places only the listed test `files` on the
  baseline; tests that need new fixtures elsewhere must list them too.
