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
| The verdict | computed from runner output (Jest JSON, `go test -json`, Node TAP, .NET TRX, exit codes) |

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
  # optional: --go-root, --go-modcache, --dotnet-root, --nuget-packages, --pg-bin, --redis-bin, --evidence-dir
```

Exit code: 0 `PASS`, 1 `FAIL`, 2 `NEEDS_REVIEW`, 3 `INTEGRITY_VIOLATION`, 4 `HARNESS_ERROR`.

Tests of the evaluator itself: `node --test 'tooling/evaluator/test/*.test.mjs'`.

## The objective (`servvia.objective/v1`)

A JSON file, frozen by the orchestrator in its own commit (the anchor) whose
parent is `baseline`. Validated by `validateObjective` in `lib/objective.mjs`.
Schema `servvia.objective/v2` for every new draft; `v1` (which carried an
`approval` field) stays loadable for objectives already frozen.

A file is a **draft** or **frozen** by where it is, never by what it says: a
draft in `objective-drafts/` has no authority; a frozen objective is the same
bytes committed under `objectives/` at an anchor the orchestrator recorded
with its SHA-256. A v2 objective therefore has no `approval` field (placeholder
approval text could only imply an authorization that does not exist).

| Field | Meaning |
| --- | --- |
| `objectiveId`, `storyId`, `version`, `title` | identity; `storyId` is the epic story (`12.5`, `12.3a`), `objectiveId` is `story-<epic>-<story>-<slug>` (`story-12-3a-core-database-timeouts`), the one key of its ledger, evidence and cleanup; a changed objective is a new `version` in a new anchor |
| `inputs` (v2) | `storySpec`: the BMAD spec's `path` and the SHA-256 of its `<intent-contract>` block; `epicContext`: the committed epic context's `path` and SHA-256. `validate` requires them on disk (the epic context committed and unmodified, the baseline the repository's HEAD); `gate` and every evaluation require them at the anchor; a candidate changing the intent contract or the epic context is an `INTEGRITY_VIOLATION`; the spec itself (where the workflow records status and logs) is always an allowed surface |
| `baseline` | the commit the work starts from: the anchor commit's parent |
| `requirementRefs`, `architectureConstraints`, `acceptanceCriteria` | traceability (PRD, `fileRestructure.md`, ADRs, the BMAD story); ACs as Given/When/Then |
| `approval` (v1 only) | `approvedBy`, `reference`; not allowed in v2 |
| `environment.services` | `postgres`, `redis`: started disposable, loopback only |
| `setup` | commands run before the checks (code generation, migrations, seed) |
| `checks` | `id`, `category`, `runner` (`jest`, `go-test`, `node-test`, `dotnet-test`, `command`), `args`, `cwd`, `mandatory`, `minTests`, `configFiles` (configuration the check depends on: protected), optional `flakePolicy.approvedRetries` |
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
| `INTEGRITY_VIOLATION` | the candidate changed what judges it, removed or disabled tests, does not descend from the anchor, the objective does not match its approved hash, or a mandatory check that built executed fewer tests than its floor (a check that did not build is a FAIL: its count means nothing, and removed tests are judged statically) |
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
  ledger. The chain is `anchor → C1 → C2 → C3`: no sibling correction from
  the anchor, no correction from an unrecorded commit.
- **Starting commit** (`loop.mjs gate`, `gate` in `lib/controller.mjs`): the
  ledger decides which run is next and where it may start, on a clean
  checkout:

  | Run | Requires |
  | --- | --- |
  | initial (C1) | no candidate of this objective version evaluated; HEAD is exactly the anchor; no failure packet |
  | correction (C2, C3) | the last candidate's verdict is `FAIL` and decision `CORRECT`; HEAD is exactly that failed candidate (not the anchor, a sibling or any descendant); it descends from the anchor and holds the frozen objective and the approved inputs (intent contract, epic context) unchanged; `--failure-packet` is the packet the controller issued for it, byte for byte; fewer than 1 + `maxCorrections` candidates so far |

  Anything else is `CLOSED`, including every STOP, a passed loop, a
  superseded or conflicting objective version, and a ledger that does not
  verify (`LEDGER_TAMPERED`) or belongs to another objective
  (`LEDGER_MISMATCH`). A sealed ledger stays sealed: emptying its history
  does not reset the loop.
- **Quiescent candidate** (`advance --worktree <checkout>`): the run's
  checkout must be the candidate with a clean tree before the evaluation
  starts (`STOP WORKTREE_NOT_QUIESCENT`, nothing recorded) and still after it
  ends (`STOP CANDIDATE_CHANGED_DURING_EVALUATION`, recorded). The
  evaluator judges the commit by id in any case; this refuses a run in which
  something (a subagent still running) was writing while it was captured.
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
  One `advance` at a time per objective (`ledger.lock`, held for the whole
  evaluation; a lock whose process has exited is taken over): a concurrent
  one is refused with `STOP LOOP_BUSY` and records nothing, and a ledger
  changed during an evaluation is never overwritten. Repeated signatures are recorded as unreviewed `LESSON CANDIDATE` entries;
  nothing is promoted.
- **Objective freeze**: `loop.mjs validate` checks a draft and prints
  `OBJECTIVE READY FOR FREEZE` with its SHA-256, marked as a draft with no
  authority; it never freezes or approves.
  `loop.mjs gate` is open only for an anchored objective matching the
  approved hash, whose loop is open, from the one starting commit above.

BMAD: `_bmad/custom/bmad-build-auto.toml` runs the gate before planning and
`loop.mjs advance --worktree` after a run ends `done` (which means "candidate
produced"); corrections are new `bmad-build-auto` runs, checked out at the
failed candidate, given the `failure_packet`. A correction run reopens the
spec at `in-progress` and implements (never a follow-up review of the failed
run); its implementer receives the packet and nothing else from the
evaluator. Subagent completion is an explicit gate: a launch or resume
acknowledgement, or a message from a subagent still running, is not a
result, whatever the platform calls the launch.

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

**Baseline evidence.** For each required test with `expectBaselineFailure`,
`record.requiredTests[].baseline` says what happened to that test on the
baseline (`lib/baseline.mjs`), never only how many failed:

| State | Failure class | Meaning |
| --- | --- | --- |
| `FAILED` | behavioral | it ran and failed |
| `SKIPPED` | | it was reported as skipped |
| `NOT_RUN_BUILD_FAILURE` | build | its package, suite or test file did not compile or load (Go `FailedBuild`, a Jest suite that failed to run, a Node test file that exited, a .NET build error) |
| `NOT_RUN_PACKAGE_FAILURE` | behavioral | its package failed before any of its tests reported |
| `NOT_RUN_TIMEOUT` | harness | the check timed out first |
| `NOT_RUN_SETUP_FAILURE` | setup | a baseline setup step failed (the verdict is `HARNESS_ERROR`) |
| `NOT_RUN_HARNESS_ERROR` | harness | the baseline check gave no usable result (`HARNESS_ERROR`) |
| `NOT_FOUND` | | the check ran, reported no such test, and nothing it depends on failed to build |
| `PASSED_UNEXPECTEDLY` | | it passed (`NEEDS_REVIEW`) |

Each entry also carries the baseline results named like the test, the
failed package, suite or file that explains a test that did not run, and a
redacted excerpt (at most 1500 characters) and source location.
`satisfiesExpectedBaselineFailure` is whether the objective's "fails or does
not run on the baseline" is met; the verdict rules are unchanged. The
baseline's setup and check output is kept as `baseline-setup-<id>.log` and
`baseline-check-<id>.log`. Evaluations made before this (the first three real
stories) have aggregate baseline counts only.

## Limitations

- Same-account execution: tampering is detected, not prevented.
- Checks execute candidate code (tests are code). They run with test-only
  credentials and disposable local services, but not in an OS sandbox.
- "Fewer tests in a file" counts `it(`/`test(`/`func Test` declarations; a
  weakened assertion inside a kept test is caught only as an unapproved
  modification of an existing test (`NEEDS_REVIEW`).
- The baseline-failure proof places only the listed test `files` on the
  baseline; tests that need new fixtures elsewhere must list them too.

## .NET (`dotnet-test`)

A `dotnet-test` check names only what to test (`args`: a solution, project
and options such as `-c Release`; `cwd`). The evaluator adds the TRX logger,
its own results directory, `--disable-build-servers` and
`UseSharedCompilation=false`, and reads every TRX file the run writes (one
per test assembly).

- `dotnet` is the one in `--dotnet-root <dir>` (the SDK directory holding the
  `dotnet` executable, e.g. Homebrew's `/opt/homebrew/opt/dotnet/libexec`),
  placed on the evaluator's own `PATH`; there is no fallback to the
  operator's `PATH`. The environment sets `DOTNET_ROOT`, a scratch
  `DOTNET_CLI_HOME` (so no user-level NuGet configuration or credentials are
  read), `NUGET_PACKAGES` (`--nuget-packages <dir>` for a primed cache, else a
  scratch one restored from the default source), and turns off telemetry,
  node reuse and the MSBuild server, so no process outlives the check.
- Results: every `UnitTestResult` by its fully qualified `testName`
  (theories have one result per data row); `Passed` passes, `NotExecuted`,
  `Inconclusive`, `Pending`, `NotRunnable` and `Disconnected` are skipped,
  anything else fails. A file whose own counter disagrees with the results
  read is a harness error.
- A compile error (`error CS…`, `MSB…`, `NETSDK…`) is a failed result named
  `dotnet build (failed)`; a restore failure (`error NU…`), a dotnet that
  cannot be started or a run with no results is a harness error.
- Stack-trace locations (`File.cs:line N`) are made repository-relative, so
  failure packets carry them.
- C# test identity: `*Tests.cs` / `*Test.cs` are test files; xUnit `[Fact]`,
  `[Theory]` and the `Skippable` variants are counted and named by method, so
  a removed test needs `retiresTests`; `Skip =`, `Skip.If…` and `Assert.Skip…`
  are skips; `#pragma warning disable` and `[SuppressMessage]` are
  suppressions; project, solution, runsettings, `Directory.Build.*`,
  `global.json` and NuGet configuration files are expectation surfaces.

