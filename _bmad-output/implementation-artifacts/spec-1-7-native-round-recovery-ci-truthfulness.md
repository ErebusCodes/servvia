---
title: 'Story 1.7: Native-round-recovery integration tests run truthfully in CI'
type: 'bugfix'
created: '2026-10-04'
status: 'done'
baseline_revision: '1af32df849c84c6234e3ea0a4d990df21ec68aba'
review_loop_iteration: 0
followup_review_recommended: false
context: []
warnings: ['oversized']
deferred:
  - summary: >-
      CI api-integration still reports green if the native-round-recovery guard falls back to describe.skip (opt-in drift, DB rename, host change); nothing asserts the 16 tests executed.
    evidence: |-
      Verified: ci.yml api-integration has no step checking Jest skipped/executed counts (only the Go job has "No suite skipped silently"). The skip-on-mismatch mechanism is pre-existing and mandated by the intent (describe.skip with a loud warning); this story may change ci.yml only by the one env entry, so a CI no-skip assertion (e.g. Jest --json, fail on any skip outside the 5 GcsStorageProvider tests) is a follow-up story.
    location: >-
      .github/workflows/ci.yml:140 (Integration tests step); apps/api/test/native-round-recovery.integration-spec.ts:95
    severity: medium
  - summary: >-
      A libpq-style ?host= / ?hostaddr= query parameter in DATABASE_URL might redirect the connection while the guard reads the URL authority host as localhost.
    evidence: |-
      Unverified. Settle by confirming whether Prisma's PostgreSQL connector honours a TCP hostname in the `host` query parameter (it is documented for Unix-socket directories). If it does, the guard should treat a URL carrying host/hostaddr query parameters as non-local. Exploiting it also requires the operator to set the opt-in to that database's exact name.
    location: >-
      apps/api/test/native-round-recovery.integration-spec.ts:75-93
    severity: medium (unverified)
  - summary: >-
      The suite's pre-existing beforeEach deletes ALL order/orderItem/nativeTableRound/nativeSendAttempt rows, which on the shared CI database could affect other specs or hit restrictive foreign keys.
    evidence: |-
      Unverified for CI ordering; the spec's TEST-PROVEN measurement on e575658 (database recovery_it, full suite) gave 378 passed, 5 skipped, 0 failed, so running it broke no other suite there. Settled by the evaluator's api-integration run on eval_candidate. Test bodies are frozen by the intent, so any scoping change is a separate story.
    location: >-
      apps/api/test/native-round-recovery.integration-spec.ts:217 (beforeEach)
    severity: medium (unverified)
  - summary: >-
      The suite's pre-existing fixtures (it-org, it-staff, it-venue, it-cat, it-item) are upserted into the shared database and never removed.
    evidence: |-
      Unverified harm: later specs that count or assume seeded state could see them. The same full-suite measurement (378 passed, 0 failed) showed no breakage; settled by the evaluator's api-integration run. Test bodies are frozen by the intent.
    location: >-
      apps/api/test/native-round-recovery.integration-spec.ts (fixture setup)
    severity: medium (unverified)
---

<intent-contract>

## Intent

**Problem:** The 16 tests in `apps/api/test/native-round-recovery.integration-spec.ts` run only when `DATABASE_URL` is local, not `verdura_production`, and contains one of the words `_it`, `test`, `audit`, `throwaway`, `disposable`. CI's `api-integration` database is `verdura_dev` and the evaluator's is `eval_candidate`, so all 16 are skipped through `describe.skip` while the job stays green (Epic 1: "what passes CI is what runs"; NFR TEST-21). Measured on `e575658` (TEST-PROVEN): database `eval_candidate` gives 362 passed, 21 skipped (16 recovery + 5 GCS), 0 failed; database `recovery_it` gives 378 passed, 5 skipped (GCS only), 0 failed. The 16 pass when allowed to run, and running them breaks no other suite on the shared database.

**Approach:** Replace the database-name word heuristic with an explicit, test-only opt-in that vouches for one named database: `NATIVE_ROUND_RECOVERY_INTEGRATION_TEST_DATABASE`. The suite executes only when the database is local, is not production-named, and the opt-in equals the exact name of the database `DATABASE_URL` points at. CI's `api-integration` job sets the opt-in to its own disposable database. CI and test truthfulness only; no production behaviour changes.

## Boundaries & Constraints

**Always:**
- The suite executes only when ALL hold: (1) the `DATABASE_URL` host is `localhost` or `127.0.0.1`; (2) the database name is not production-named; (3) `NATIVE_ROUND_RECOVERY_INTEGRATION_TEST_DATABASE` is set and equals the name of the database `DATABASE_URL` points at. In every other case, including an unparsable URL, it does not execute: `describe.skip` with the existing loud `console.warn`, updated to name the opt-in. The default is non-executing.
- The guard judges `DATABASE_URL` as the spec sees it at load time, after `integration-setup.ts` has applied `INTEGRATION_DATABASE_URL` precedence. That is the database the tests connect to.
- The opt-in vouches for one named database, never for "any". The name-word heuristic no longer decides on its own, so `verdura_dev` and `eval_candidate` are not treated as disposable by their names.
- The 16 tests keep their exact names, bodies and assertions. The variable is read only in that spec file.
- In `.github/workflows/ci.yml`, the only change is `NATIVE_ROUND_RECOVERY_INTEGRATION_TEST_DATABASE: verdura_dev` in the `api-integration` job's `env:` block. It equals that job's PostgreSQL service database. An explanatory YAML comment line directly above the entry is the only text allowed with it.

**Never:**
- Add, remove, skip, focus, rename or weaken any test, or add a lint or type suppression.
- Change `apps/api/test/integration-setup.ts` (its `INTEGRATION_DATABASE_URL` precedence and production-name refusal), any other file under `apps/api/test/**`, `apps/api/src/**`, `apps/api/prisma/**`, `services/**`, `contracts/**`, `apps/web/**`, `apps/venue-connector/**`, any `package.json` or `package-lock.json`, `tooling/**`, `_bmad/**`, `.claude/**`, `docs/**`, `PRD/**` or `_bmad-output/planning-artifacts/**`.
- Change anything else in `ci.yml`: action versions, SDKs, job structure, steps, dependencies, other env entries or other jobs.
- Read the opt-in from any application, configuration-validation, runtime or production surface. Change production behaviour, schema, migrations, runtime database configuration, auth, API contracts or staff/customer workflows. If the intent needs any of these, HALT blocked with `OBJECTIVE SCOPE INVALID`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| CI | `127.0.0.1:5432/verdura_dev`, opt-in `verdura_dev` | the 16 tests execute and pass | No error expected |
| Evaluator candidate | local `eval_candidate`, opt-in `eval_candidate` | the 16 tests execute and pass | No error expected |
| Opt-in absent | local `recovery_it` (accepted by the old heuristic), no opt-in | file discovered, 0 recovery tests executed | loud warning naming the opt-in |
| Opt-in empty | local database, opt-in `''` | 0 executed | loud warning |
| Opt-in names another database | local `verdura_dev`, opt-in `verdura_dev_other` | 0 executed | loud warning |
| Non-local host | `db.invalid/verdura_dev`, opt-in `verdura_dev` | 0 executed | loud warning |
| Production-named | local `verdura_production`, opt-in `verdura_production` | 0 executed (`integration-setup.ts` may already refuse the file) | refusal or loud warning |
| Unparsable URL | `DATABASE_URL` that `new URL` rejects | 0 executed | refusal or loud warning, never a run |

</intent-contract>

## Code Map

- `apps/api/test/native-round-recovery.integration-spec.ts:1-39` -- header comment. Update "IT REFUSES TO RUN…" and "HOW TO RUN IT" to the opt-in. The example must set `NATIVE_ROUND_RECOVERY_INTEGRATION_TEST_DATABASE` to the same database name as its `DATABASE_URL`.
- `apps/api/test/native-round-recovery.integration-spec.ts:52-70` -- THE GUARD (`url`, `looksDisposable`, `describeOrSkip`, the `console.warn`). This is the only code to change. The line-70 `describeOrSkip(...)` call and everything after it (`beforeEach` at 185-189 deletes ALL rows of nativeSendAttempt, orderItem, nativeTableRound and order) stays byte-identical.
- `apps/api/test/integration-setup.ts` -- read-only. Runs first (`setupFiles` in `test/jest-integration.json`). It copies `INTEGRATION_DATABASE_URL` into `DATABASE_URL` and throws for an unreadable URL or a name matching `FORBIDDEN_DATABASE_NAMES` (`/(^|[_-])(prod|production|live)([_-]|$)|production/i`, not exported). It then appends `options=-c TimeZone=UTC` via `withUtcSession`, so the guard must read the name from the URL path, not by substring. `databaseNameOf` (`new URL`, path without `/`, `decodeURIComponent`) is the reference for "the name of the database".
- `apps/api/test/gcs-storage-provider.integration-spec.ts:12-28` -- naming precedent (`GCS_INTEGRATION_TEST_*`, read only in its spec). Read-only. Its 5 skips stay.
- `.github/workflows/ci.yml:82-140` -- `api-integration` job: service `POSTGRES_DB: verdura_dev`; `env:` at 111-125 with `DATABASE_URL: postgresql://verdura:verdura_ci_only@127.0.0.1:5432/verdura_dev`. Add the one entry there.
- `apps/api/src/prisma/prisma.service.ts` -- read-only. `PrismaService` connects with `process.env.DATABASE_URL`, so the guarded URL is the one the tests use.
- `tooling/evaluator/policy.json` -- read-only. Its `skipPatterns` flag any ADDED line with a `describe.skip(` / `it.skip(`-style call as an integrity violation, and its `suppressionPatterns` flag any added lint-rule or TypeScript suppression directive. Keep the skip as the existing conditional alias (`cond ? describe : describe.skip`, no call parentheses on `describe.skip`), and add no suppression comment. The test-declaration count of the file must not change.
- Continuity: Story 1.3 (done) made a CI job truthful by fixing the cause, not by skipping or editing tests. Same rule here.

## Tasks & Acceptance

**Execution:**
- `apps/api/test/native-round-recovery.integration-spec.ts` -- rewrite only the guard block and the header comment as in Boundaries -- the opt-in replaces the word heuristic, and the default stays non-executing.
- `.github/workflows/ci.yml` -- add `NATIVE_ROUND_RECOVERY_INTEGRATION_TEST_DATABASE: verdura_dev` to the `api-integration` `env:` block -- CI then executes the 16 tests against its own disposable database.

**Acceptance Criteria:**
- Given a local, non-production PostgreSQL database migrated and seeded as CI does, and the opt-in equal to its name, when the API integration suite runs, then the 16 native-round-recovery tests execute under their existing names and pass.
- Given any fail-safe row of the matrix, when the integration suite runs for that file, then the file is discovered and 0 recovery tests execute.
- Given the candidate's `ci.yml`, when it is parsed, then the `api-integration` env holds the opt-in equal to its PostgreSQL service database and `DATABASE_URL` database, and nothing else differs semantically from the baseline.
- Given the candidate, when the full API integration suite, the API unit suite, lint and typecheck run, then all pass, and the only integration skips are the 5 GCS tests.
- Given the candidate tree, when it is searched for the opt-in name, then it appears only in the spec file and `ci.yml`. No application, configuration or runtime file reads it, and the diff touches only those two files and this spec.

## Spec Change Log

## Review Triage Log

### 2026-10-04 — Review pass
- verdicts: 25 findings — high 0, medium 3, low 4, false 14, maybe-false 4
- findings:
  - `[medium]` `[defer]` (blind-hunter) CI can stay green when the guard falls back to describe.skip; no fail-in-CI or executed-count check — real (no skip assertion in api-integration), but the skip-with-warning mechanism is pre-existing and mandated by the intent, and ci.yml may change only by the one env entry; deferred as a follow-up CI no-skip step.
  - `[false]` `[reject]` (blind-hunter) the diff does not show the CI job running this spec — ci.yml:140-141 "Integration tests" runs `npm run test:integration` = `jest --config ./test/jest-integration.json --runInBand` (apps/api/package.json:27), which discovers this spec.
  - `[maybe-false]` `[defer]` (blind-hunter) `?host=` query parameter could bypass the localhost check — needs confirmation that Prisma honours a TCP host in the `host` query parameter; if true medium (operator must still vouch for the exact name); deferred unverified.
  - `[false]` `[reject]` (blind-hunter) IPv6 loopback / Unix sockets are skipped — the intent requires host `localhost` or `127.0.0.1` exactly; skipping anything else is the specified fail-safe, not a defect.
  - `[low]` `[reject]` (blind-hunter) warning does not name which condition failed — real but cosmetic; the fix adds branches/diagnostics to the guard, and the warning already names the opt-in and the requirement.
  - `[low]` `[reject]` (blind-hunter) the copied production-name pattern can drift from integration-setup.ts — the shared fix requires exporting from integration-setup.ts, which the intent forbids changing; the setup refusal still runs first, so drift only weakens a second layer.
  - `[low]` `[reject]` (blind-hunter) PRODUCTION_LIKE_NAME is redundant and misses names like `verdura_prod2` — it is byte-identical to integration-setup.ts's pattern, as the spec requires ("at least as strict"); execution still needs the exact-name opt-in.
  - `[low]` `[reject]` (blind-hunter) CI vouches for a conventional dev name `verdura_dev` — the value is fixed by the intent and objective (equal to the job's POSTGRES_DB); renaming the CI database is out of the allowed ci.yml change.
  - `[false]` `[reject]` (blind-hunter) the guard logic has no tests — adding tests is forbidden by the intent; the guard is exercised by the objective's native-round-recovery-fail-safe check (run locally: 6/6 ok) and api-integration.
  - `[false]` `[reject]` (blind-hunter) `vouchedFor !== ''` is redundant — redundancy causes no wrong behaviour; it states the intent's "set and equals" condition explicitly.
  - `[false]` `[reject]` (blind-hunter) case-sensitive name comparison can refuse `recovery_IT` vs `recovery_it` — the intent requires the exact name; a mismatch fails safe with the warning.
  - `[false]` `[reject]` (blind-hunter) spec moves to in-review without a record of work — the spec records results in Finalize (Auto Run Result); a fix that edits this build's spec is rejected.
  - `[false]` `[reject]` (blind-hunter) guard evaluation order relative to integration-setup.ts is not enforced — apps/api/test/jest-integration.json lists integration-setup.ts in `setupFiles`, which Jest runs before the test module loads; that file is protected and unchanged.
  - `[medium]` `[defer]` (verification-gap) api-integration passes even when the 16 tests are skipped; no CI executed/skip-count assertion — pre-verified gap, filed disposition defer; same root cause as the first row; follow-up story for a Jest --json no-skip step.
  - `[false]` `[reject]` (verification-gap, other) IPv6 loopback or Docker hostnames are treated as non-local — the intent's local set is exactly `localhost`/`127.0.0.1`; skipping fails safe as specified.
  - `[false]` `[reject]` (intent-alignment) matrix outcomes are not exercised by tests in the diff — adding tests is forbidden; the fail-safe rows were executed locally via the objective's fail-safe check (6/6 ok, 0 recovery tests executed), the opted-in path attempts all 16, and the evaluator runs the passing rows.
  - `[false]` `[reject]` (intent-alignment) production-named URL fails via integration-setup refusal rather than skipping — the matrix explicitly allows "refusal or loud warning".
  - `[false]` `[reject]` (intent-alignment) unparsable URL is refused by integration-setup before the guard — permitted by the matrix ("refusal or loud warning, never a run").
  - `[false]` `[reject]` (intent-alignment) opt-in could be supplied through apps/api/.env via integration-setup's loadDotEnv — integration-setup.ts:45-77 does load unset keys, but a value there is still an explicit vouch for one exact local non-production database; the variable is read only in the spec file, which is what the intent constrains.
  - `[false]` `[reject]` (intent-alignment) the story spec frontmatter is a third touched file — the spec is an allowed surface (workflow bookkeeping outside the intent contract).
  - `[medium]` `[defer]` (edge-case-hunter) throw when not opted in under `CI=true` — same root cause as the first row; throwing contradicts the intent's describe.skip-with-warning rule; deferred with that group.
  - `[false]` `[reject]` (edge-case-hunter) trim surrounding whitespace in the opt-in — the intent requires an exact match; trimming loosens the vouch, and a mismatch fails safe.
  - `[maybe-false]` `[defer]` (edge-case-hunter) `host=` query parameter can redirect the connection — same as the blind-hunter `?host=` row; deferred unverified.
  - `[maybe-false]` `[defer]` (edge-case-hunter) pre-existing beforeEach deletes all order rows on the shared CI database — prior measurement (378 passed, 0 failed with the suite running) indicates no breakage; settled by the evaluator's api-integration run; test bodies are frozen by the intent; if true medium.
  - `[maybe-false]` `[defer]` (edge-case-hunter) pre-existing fixtures are never removed from the shared database — same measurement shows no breakage; settled by the evaluator; test bodies are frozen; if true medium.

## Design Notes

**Why the required tests' baseline `files` is `jest-integration.json`.** The change under test is the guard inside the spec file itself. Placing the candidate's spec file on the baseline would carry the fix there. Overlaying the unchanged, protected `apps/api/test/jest-integration.json` makes the baseline run the unmodified `e575658` tree, where all 16 must be SKIPPED. That is the baseline's "does not run" state. The `api-integration` floor (362) is the baseline's executed count. A candidate whose 16 still skip while Jest exits 0 therefore FAILs on the missing required tests; it does not trip an integrity stop.

**Production-name rule.** The guard applies its own production-name refusal at least as strict as `integration-setup.ts`, because it cannot import that file's private pattern. The setup file's earlier refusal is a second layer, not the guard.

**Baselines.** The accepted product baseline is `e575658ec1ae01165bf360069f1340c1b9f4b77b`, the accepted integrated state on which the false-green was first measured. The governed Git baseline is `6fc711362f12aaa8dfbca77a176e4101b460a7cd`: the objective's machine-readable `baseline` and the anchor's required parent, so the frozen objective is judged by the corrected evaluator. It is a `--no-ff` merge of `e575658` with the accepted evaluator-governance commit `8095257ea12be988a2d4e29be52d69f79c968315`, and differs from `e575658` in exactly three files (`tooling/evaluator/lib/integrity.mjs`, `tooling/evaluator/test/surface-addition.test.mjs`, `tooling/evaluator/README.md`); all 1774 other tracked paths are identical, so the product tree, the guard and the 16 tests are the same at both. Re-measured on `6fc7113`, the false-green is identical: 34 suites / 383 tests, 362 passed, 21 skipped (the same 16 recovery tests + 5 GCS), 0 failed, Jest exit 0, and `ci.yml` has no opt-in. The candidate's surfaces are unchanged and do not include those evaluator files.

**Fail-safe evidence.** The `native-round-recovery-fail-safe` check covers six cases. Opt-in absent, opt-in empty, opt-in naming another database, and non-local host must each execute 0 recovery tests AND emit the guard warning, identified by the stable tag `[native-round-recovery.integration-spec] SKIPPED.` followed by the opt-in variable's name. Production-named database and unparsable `DATABASE_URL` must each execute 0 recovery tests AND show `integration-setup.ts`'s existing refusal. The rewritten guard's `console.warn` must therefore keep that exact tag and name `NATIVE_ROUND_RECOVERY_INTEGRATION_TEST_DATABASE` after it.

## Verification

**Commands:** (from `apps/api`, in an anchored run; no database needed)
- `node ../../node_modules/eslint/bin/eslint.js "{src,apps,libs,test}/**/*.ts"` -- expected: exit 0, no new suppression.
- `node ../../node_modules/typescript/bin/tsc --noEmit` -- expected: exit 0.
- `git diff --name-only <baseline>` -- expected: only the spec file, `.github/workflows/ci.yml` and this story spec.
- `git grep -n NATIVE_ROUND_RECOVERY_INTEGRATION_TEST_DATABASE -- . ':!_bmad-output'` -- expected: only the spec file and `ci.yml`.

**Manual checks:**
- Lines from `describeOrSkip('native round recovery, against real PostgreSQL'` to the end of the spec file are unchanged from the baseline.
- The integration suite itself (PostgreSQL and Redis) is run by the evaluator under the frozen objective's `api-integration` and `native-round-recovery-fail-safe` checks. The fail-safe check runs six cases (see Design Notes, Fail-safe evidence): four that must show 0 recovery tests executed plus the guard warning (tag `[native-round-recovery.integration-spec] SKIPPED.` followed by `NATIVE_ROUND_RECOVERY_INTEGRATION_TEST_DATABASE`), and two (production-named database, unparsable `DATABASE_URL`) that must show 0 executed plus `integration-setup.ts`'s existing refusal.


## Auto Run Result

Status: ready-for-dev
Blocking condition: waiting-for-objective-approval: draft _bmad-output/implementation-artifacts/objective-drafts/story-1-7-native-round-recovery-ci-truthfulness/v1.objective.json sha256 c80a4dd927e3c59a94e17a726a2205d2244ff8f1e62f468c3086a9ebf10971eb

Supersedes drafts c485af089f5dcad10177dc0599a77ae828172d12ff5b8b2c65755981a2beb4c3 and 40b0fc584c08a28908c57fe25a435831d107c39245de9071aadb245221122cf6 (baseline e575658); this draft's baseline is the governed Git baseline 6fc711362f12aaa8dfbca77a176e4101b460a7cd.

### 2026-10-04 — Anchored implementation run (objective_anchor 1af32df849c84c6234e3ea0a4d990df21ec68aba, gate OPEN, run initial, iteration 1)

Status: done (CANDIDATE PRODUCED; technical completion is the evaluator's decision only)

**Summary.** The database-name word heuristic in the native-round-recovery spec's guard is replaced by an explicit, test-only opt-in, `NATIVE_ROUND_RECOVERY_INTEGRATION_TEST_DATABASE`. The suite executes only when the `DATABASE_URL` it sees after `integration-setup.ts` has a `localhost`/`127.0.0.1` host, a database name that does not match the production pattern (byte-identical to `integration-setup.ts`'s), and an opt-in that is set, non-empty and exactly equal to that database name. Otherwise, including an unparsable URL, it stays on the existing `describeOrSkip = optedIn ? describe : describe.skip` path with a loud warning tagged `[native-round-recovery.integration-spec] SKIPPED.` followed by the opt-in name. CI's `api-integration` job sets the opt-in to its own database, `verdura_dev`.

**Files changed.**
- `apps/api/test/native-round-recovery.integration-spec.ts` -- the header comment (opt-in rule and how to run it) and the guard block only; from `describeOrSkip('native round recovery, against real PostgreSQL'` to the end of the file is byte-identical, and there are still 16 `it(` declarations.
- `.github/workflows/ci.yml` -- one comment line plus `NATIVE_ROUND_RECOVERY_INTEGRATION_TEST_DATABASE: verdura_dev` in the `api-integration` `env:` block.
- This story spec -- frontmatter (status, baseline_revision, deferred), Review Triage Log and Auto Run Result; the intent contract is unchanged.

**Review findings.** 25 findings across 4 layers: 0 patches applied; 7 rows deferred as 4 entries (CI no-skip assertion, medium; `?host=` query override, medium unverified; shared-DB deletes in the pre-existing beforeEach, medium unverified; fixtures never removed, medium unverified); 18 rejected (14 false, 4 low), each with its reason in the Review Triage Log above.

**Follow-up review recommendation:** false. 0 patched entries (high 0, medium 0, low 0).

**Verification performed** (scratch copy of the tree with read-only symlinked node_modules and a locally generated Prisma client; no database or service used):
- `eslint "{src,apps,libs,test}/**/*.ts"` (apps/api): exit 0.
- `tsc --noEmit` (apps/api): exit 0.
- `git diff --name-only 1af32df` lists only the spec file, `.github/workflows/ci.yml` and this story spec.
- `git grep -n NATIVE_ROUND_RECOVERY_INTEGRATION_TEST_DATABASE -- . ':(exclude)_bmad-output'` finds it only in the spec file and `ci.yml` (the spec's `':!_bmad-output'` form is rejected by this git version as "Unimplemented pathspec magic"; `:(exclude)` is the equivalent).
- Manual: the tail from `describeOrSkip('native round recovery, against real PostgreSQL'` to the end of the file is identical to the baseline; the added lines match none of the evaluator policy's skip or suppression patterns.
- The objective's `ci-workflow-opt-in` check ran locally: ok.
- The objective's `native-round-recovery-fail-safe` check ran locally against an unreachable `127.0.0.1:1` database and `REDIS_PORT=1`, with output written to the scratchpad instead of `$HOME`: all 6 cases ok (file discovered, 0 recovery tests executed, guard warning or integration-setup refusal present).
- Opted-in positive path (opt-in = database name `eval_candidate`, unreachable database): all 16 tests attempted (failed only with "Can't reach database server"), so the guard selects `describe`.

**Residual risks.** The 16 tests executing and passing against real PostgreSQL and Redis (matrix rows CI and Evaluator candidate, RT-01 to RT-16), the full API integration suite and the API unit suite were not run here; they are the evaluator's checks. CI can still go green if the opt-in later drifts (deferred). The `?host=` override is unverified (deferred).
