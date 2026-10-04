---
title: 'Story 1.7: Native-round-recovery integration tests run truthfully in CI'
type: 'bugfix'
created: '2026-10-04'
status: 'ready-for-dev'
review_loop_iteration: 0
followup_review_recommended: false
context: []
warnings: ['oversized']
deferred: []
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
