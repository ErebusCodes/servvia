---
baseline_commit: HEAD@2026-08-19
epic: E16
blocked_on: null
tracer_bullet: false
production_story: true
---

# Story 16.3: CI Regression Gates

Status: in-progress (workflow authored and independently verified end-to-end locally; `customer-website` typecheck gap now resolved; two NEW blockers found this session — `apps/` untracked by git, and pre-existing `apps/api` lint debt — neither fixed, both required before this story can be `done`; not yet pushed or activated — see "What remains" below)

## Story

As the team shipping toward the 11 October pilot,
I want lint, typecheck, unit and integration tests to run unattended on every PR against a real Postgres/Redis,
so that "the suite is green" stops being a self-reported claim from whoever last ran it manually — the exact "self-reported only" verification-band gap the October audit named directly (`docs/epics.md` E16-S3).

## Context / why this, now

Picked as the next unblocked, self-contained, October-critical action while authorized SSH access to the disposable Idealpos Windows host was being arranged (that work — the Table 12 bridge experiment — remains genuinely blocked on real connection details; see the session's own access-gate report). No CI workflow directory existed anywhere in this repository before this story — confirmed by direct inspection.

## Scope

Promotes the long-backlog `E1-S5`/`1-5-ci-pipeline` to explicit scope per `docs/epics.md` E16-S3: lint, typecheck, unit and integration tests for every app in the monorepo, running unattended on every PR. Does not implement a deployment pipeline, does not touch any billing/Idealpos/connector logic, does not fix unrelated app-level defects beyond what was needed to make this gate meaningful (see "Defects found and fixed" below for the precise, bounded exception).

## What was built

CI workflow — six jobs, each verified locally against its exact command sequence before being trusted:

1. **`api-lint-typecheck-unit`** — `npm run lint:api`, `npm run typecheck --workspace=apps/api`, `npm run build --workspace=apps/api`, `npm test --workspace=apps/api`.
2. **`api-integration`** — real `postgres:16-alpine` + `redis:7-alpine` CI service containers (not the local dev docker-compose helper, which isn't appropriate inside a CI runner), `npm run db:migrate` (from a completely empty database) → `npm run db:seed` → `npm run test:integration --workspace=apps/api`.
3. **`admin-console`** — lint, typecheck, `vitest run`, build (this is the Order Tablet / KDS app — Story 15-4's `billing.ts`/`OrderTabletPage.tsx` tests run here).
4. **`customer-website`** — lint, typecheck, build. No test script exists in this app's `package.json` — not invented here; recorded honestly as a gap, not silently skipped.
5. **`window-display`** — lint, typecheck, build. Same no-test-script situation.
6. **`venue-connector`** — `dotnet build` the `.slnx` solution (which already deliberately scopes out the two Windows-only projects, `Cli`/`Windows`, both `net8.0-windows` — everything the solution file references is genuinely cross-platform `net8.0`), then `dotnet test` the Tests project, `--no-build` — this includes the real separate-process `CrashReplayTests.cs` (genuine `SIGKILL`s of a spawned OS process), not just in-memory unit tests.

## Independent local verification (not just "should work")

Every job's exact command sequence was run directly, not assumed:

- **`api-integration`**: spun up isolated, disposable `postgres:16-alpine`/`redis:7-alpine` containers on non-default ports (5433/6380, to avoid touching the existing local dev database), ran `prisma migrate deploy` against a genuinely empty database (all 13 migrations applied cleanly from zero — itself real evidence the migration chain is sound end-to-end, not just against an already-migrated dev DB), seeded, then ran the full integration suite.
- **`venue-connector`**: ran `dotnet build` on the `.slnx` then `dotnet test --no-build` exactly as the workflow does — 38/38 passing, including the real crash/replay tests.
- **`admin-console`**: `lint`/`typecheck`/`test`/`build` all independently re-run clean (101/101 tests, per this session's own prior Story 15-4 re-verification work).
- **`customer-website`** / **`window-display`**: `lint`/`typecheck`/`build` run directly — see "Defects found" below for what this surfaced.

## Defects found and fixed (in-scope: making the gate itself trustworthy)

**1. Integration-suite rate-limit cascade — real, reproduced, fixed.** Running the full 13-file integration suite against a genuinely fresh database for what appears to be the first time ever (no CI existed before this story to have done it) produced **58 failures**, every one a `429 Too Many Requests` on `/api/auth/login`. Root cause: `RateLimitGuard` (`src/auth/guards/rate-limit.guard.ts`) keys its Redis-backed bucket by `(ip, method, path)` — shared across every test file in the same `--runInBand` process. A few individual spec files (`connector.integration-spec.ts`, `tablet-auth.integration-spec.ts`) had each independently added their own ad hoc clearing of the specific keys they cared about, but this doesn't scale: as more integration spec files were added over time (this repo now has 13), the shared `/api/auth/login` bucket (10 requests / 900s default) is exhausted by earlier files before later, unrelated files (e.g. `menu.integration-spec.ts`, which has no rate-limit awareness of its own) ever get to make their own single login call. **Fixed**: new `apps/api/test/integration-rate-limit-reset.ts`, wired via `jest-integration.json`'s `setupFilesAfterEnv` (not `setupFiles` — that runs before the test framework's own `beforeAll` is available) — clears every `rate-limit:*` Redis key once at the start of every integration spec file, centrally, so no future spec file needs to remember to add this itself. Re-run after the fix: 194/199 passing (5 correctly, deliberately skipped — see below), zero rate-limit-related failures.
2. **`connector-command-harness.integration-spec.ts`'s `ts-node` path — real, reproduced, fixed.** The remaining 4 failures after the rate-limit fix were all `spawn .../apps/node_modules/.bin/ts-node ENOENT`. `npm` workspace hoisting places `ts-node` at the monorepo ROOT `node_modules/.bin/`, not `apps/node_modules/.bin/` — the existing path computation (`path.join(__dirname, '..', '..', ...)` from `apps/api/test`) was one level short. This test file — which proves Story 2-10's real separate-process crash/replay evidence — had apparently never been run to completion in a genuinely fresh environment before either. **Fixed**: corrected to three `..` levels. Re-run: 194/194 non-skipped tests passing.
3. **`window-display`'s 6 lint errors and stale `@ts-ignore` suppressions — real, pre-existing, fixed.** `@ts-ignore` on 4 JSX imports (`ts-ignore` is banned by this project's own ESLint config in favor of `@ts-expect-error`, which fails loudly if the suppressed error ever stops existing — a real correctness improvement, not just a style swap) plus 2 fully unused symbols (`DietaryTags`, `photoLayer` in `KioskWindowSignagePage.tsx` — defined, never referenced anywhere). Investigated each `@ts-ignore` individually rather than blindly swapping the directive: all 4 turned out to be genuinely unused (no underlying type error exists on any of those 4 import lines any more) — removed all 4 outright rather than leaving unnecessary suppression comments. Re-verified: lint, typecheck, and build all clean.

## `customer-website` typecheck gap — RESOLVED (2026-08-19, follow-up session)

The 13 errors originally cited were an undercount caused by a truncated (`tail -20`) capture of the `tsc` output in the session that first found them. Re-run in full: **32 real errors** (13× `TS2339`, 19× `TS2741`), grouped into exactly two root causes, both fixed:

1. **Missing default on a destructured optional prop (19 errors, 5 components).** TypeScript infers a destructured prop as *required* unless it has a default value — every affected call site omitted the prop, which is valid at runtime (an omitted prop is simply `undefined`) but not inferable as optional without an explicit default. Fixed by adding `= undefined` / `= false` / `= null` defaults in `DrinksMenu.jsx` (`SectionHeading`), `ReservationSummary.jsx` (`mobile`, `Row`'s `icon`), and `Step1Details.jsx` (`FieldLabel`'s `required`). One further case in `DrinksMenu.jsx`'s `DrinkRow` (`badge` prop) was confirmed genuinely dead — zero call sites ever pass it, zero usage in the render body — and removed outright rather than given a default. All fixes are behaviorally identical to the pre-fix runtime (an omitted prop was already `undefined`); no regression test added per the task's own conditional (only required "where the correction changes meaningful behaviour").
2. **Untyped `useState({})` (13 errors, 1 component).** `Step1Details.jsx`'s `errors` state was declared as `useState({})`, which freezes its inferred type at `{}` for the whole component (unlike a plain `const e = {}; e.x = 'y'`, which TS handles via evolving-object-type inference) — every later `errors.date`/`errors.email`/etc. read was then a `TS2339`. Fixed with an explicit JSDoc `@type` shape matching exactly what `validate()` in the same file ever assigns to it.

**A second, deeper, previously-invisible gap was found and fixed during independent review of this fix itself**: `apps/customer-website/jsconfig.json`'s `include` list never listed the app's real entry point (`src/main.jsx`) or `src/App.jsx` as roots, and nothing in the included set imports either of them (the dependency direction runs the other way). Confirmed via `tsc --listFiles`: only 24 of 28 real, non-generated `.js`/`.jsx` files were ever being type-checked — `npm run typecheck` was exiting 0 while silently never checking the app's router or several components reachable only from it (`ProtectedRoute`, `UserNotRegisteredError`, `admin/PendingCalendarEvents`, `hooks/use-mobile`). This is exactly the "checks that appear green because files were accidentally excluded" failure mode this story's own independent-review checklist calls for. Fixed by widening `include` to `src/**/*.js`/`src/**/*.jsx` (same `exclude` list retained). Widening the scope transitively surfaced 9 further errors in the generated shadcn/ui `toast.jsx`/`toaster.jsx` components (TypeScript's `exclude` only blocks a file from being an independent glob-root — it does not block type-checking a file reached via `import` from an included file, so excluding `src/components/ui` did not shield these once `App.jsx` — which imports `Toaster` — became a checked root). Fixed properly (not suppressed): added standard JSDoc `@type` annotations to `toast.jsx`'s 6 `React.forwardRef` components, using real HTML-attribute types matching what each component actually forwards; `toaster.jsx`'s 3 errors resolved automatically once `toast.jsx`'s exports were properly typed.

**Result: `npx tsc -p ./jsconfig.json` now passes with zero errors**, checking every real file in the app (not just 24 of 28 as before). No `any`, no blanket casts, no `@ts-ignore`/`@ts-nocheck`, no exclusions added, no strict-mode weakening.

## CI workflow review (2026-08-19, follow-up session)

Independent review of `ci.yml` against the story's own security/reliability checklist. Findings, all fixed:

- **No `permissions:` block existed** — added a top-level `permissions: { contents: read }`. None of the six jobs write back to the remote repository (no comments, no pushed commits, no releases); explicit least-privilege scoping means the workflow doesn't inherit a broader default if the repo's own default token permissions are ever changed later.
- **No `timeout-minutes:` on any job** — added (15 min for `api-lint-typecheck-unit`/`api-integration`/`admin-console`/`venue-connector`; 10 min for `customer-website`/`window-display`, which have no test step). Prevents an unbounded 360-minute default consuming runner minutes if a step ever hangs.
- Already correct, confirmed by inspection (no change needed): `concurrency` with `cancel-in-progress`, Postgres/Redis service health checks, isolated service-container ports, no `secrets.*` references anywhere in the workflow (every credential-shaped value is an explicitly-commented CI-only ephemeral placeholder), fork-PR default read-only token, `.slnx` solution scoping that excludes the two Windows-only connector projects from the Linux runner, and no Idealpos/EFTPOS/Windows-only UI automation anywhere in the workflow.
- YAML re-validated with `js-yaml` after both edits (no `pyyaml`/`actionlint` available in this environment) — parses cleanly, all 6 job names and expected key values present.

## NEW critical finding — `apps/` is not tracked by git at all (blocks this story regardless of code correctness)

Discovered during this session's adversarial/independent-review pass, specifically the checklist item asking to look for "stale paths left by the repository restructure" and CI paths behaving unexpectedly.

- `git ls-files apps/` from the top-level repo returns **zero files**. The entire `apps/` directory — `api`, `admin-console`, `customer-website`, `window-display`, `venue-connector`, i.e. all real application source this and every prior story in this engagement has been editing — has never been committed to the top-level repository's git history. `git status --porcelain apps/` shows it as a single untracked `?? apps/` entry, not as modified tracked files.
- `apps/api` additionally contained its own nested `.git` directory, pointed at the exact same remote
  and the exact same `HEAD` commit (`175cbbd1...`) as the top-level repo — i.e. a stray, accidental full duplicate clone, not a real submodule (no `.gitmodules` exists anywhere). This nested repo **also** tracks zero files at its own `HEAD` (`git ls-files` inside it returns 0) — so there is no git history anywhere, in either location, for any file under `apps/`. `git log` cannot be used to date any finding in this directory (see the lint-error root-cause section below, where this mattered directly).
- **Consequence**: pushing the workflow today would fail all six jobs on a real CI runner immediately at checkout + first `npm ci`/`dotnet build` step — not for any reason related to code correctness, but because the application source the workflow's jobs depend on does not exist in the pushed repository at all. This is the dominant blocker for this story's stated goal ("all six CI jobs can pass from a clean environment... on CI") and is unrelated to, and discovered independently of, every code-level fix in this story.
- **Not fixed here.** Resolving it requires deciding how `apps/` should actually be tracked (folded into the top-level repo proper vs. registered as a real git submodule vs. something else) and almost certainly touches the stray nested `apps/api/.git` directory — a repository-structure decision squarely outside this task's explicit boundary ("Do not: stage files; create a commit... configure repository settings") and outside "the 13 customer-website type errors" scope. Recorded here and in `deferred-work.md` as the single most important open item.

## NEW finding — `apps/api` full-project lint is not clean: 302 errors / 263 warnings (pre-existing, out of scope, NOT fixed)

Discovered while re-running Job 1 (`api-lint-typecheck-unit`) from a fresh clean-environment pass. `npm run lint:api` (`eslint "{src,apps,libs,test}/**/*.ts"` inside `apps/api`) fails with **302 errors, 263 warnings** across 27 files. Rule breakdown: 260× `@typescript-eslint/no-unsafe-argument`, 181× `no-unsafe-member-access`, 69× `prettier/prettier`, 32× `no-unsafe-assignment`, plus small counts of `no-unnecessary-type-assertion`/`no-unsafe-call`/`no-unsafe-return`/`no-require-imports`/`no-unused-vars` and 3 parse-related messages.

- The overwhelming majority (278 of 302 errors, across 23 files — every `test/*.integration-spec.ts` file, plus `menu-items.service.spec.ts`, `orders.service.spec.ts`, `venues.service.spec.ts`, and the queue processor specs) is concentrated in test files this story never touched, matching a single systemic pattern: supertest's `.request(app.getHttpServer())` and `.body` are `any`-typed, and every property read off them (`.accessToken`, `.enrollmentId`, `.staff`, etc.) trips `no-unsafe-member-access`/`no-unsafe-argument`. Because `git ls-files` returns nothing for any file under `apps/` (see above), this cannot be dated via `git blame`/`git log` — but the pattern (nearly universal across every integration spec, near-absent in `src/`) is consistent with a long-standing, never-previously-gated condition rather than anything introduced this session.
- A smaller slice (~24 errors, in `src/printer/printer-dispatcher.service.ts`, its spec, and `kot-renderer.spec.ts`) traces to this engagement's own earlier Story E8-S1 work — mostly `prettier/prettier` formatting differences (auto-fixable) plus a few `no-unsafe-return`/`no-require-imports` findings. Called out explicitly rather than folded into the "pre-existing, unrelated" bucket, since it is attributable to prior work in this same engagement, not to a third party.
- **Not fixed.** 302 errors spanning 27 files is a large, unbounded body of work with no connection to "the 13 [32] customer-website type errors" this story was scoped to correct — fixing it here would be exactly the kind of unauthorized scope expansion the governing task explicitly prohibits. Recorded honestly instead: **Job 1 (`api-lint-typecheck-unit`) does not currently pass its lint step**, independent of and in addition to the git-tracking blocker above.
- A related shell-level false positive was found and resolved during triage, not in `ci.yml` itself: an ad hoc diagnostic command of the form `npm run lint:api 2>&1 | tail -5 && npm run typecheck ...` appeared to let a failing `lint:api` step fall through to later, passing steps. Root cause confirmed: without `pipefail`, a `cmd | tail`'s exit status is `tail`'s (near-always 0), not `cmd`'s — masking the real failure in that manually-chained reproduction command only. `ci.yml` itself was independently confirmed unaffected: each `run:` step is separate (not piped through anything), so a failing `lint:api` step genuinely fails and stops the job on a real CI runner, exactly as intended.

## Tests / validation — exact results

- `apps/api` unit suite: 578/578 passing (unchanged by this story; re-run to confirm no regression from the two fixes above).
- `apps/api` integration suite, from a genuinely fresh database: **194/194 non-skipped tests passing** (5 correctly skipped — `gcs-storage-provider.integration-spec.ts`, deliberately `describe.skip`'d, needs real GCP credentials not available/required for the `local` media-storage default).
- `apps/api` lint (`npm run lint:api`): **fails — 302 errors, 263 warnings across 27 files** (see "NEW finding" above). Pre-existing/out-of-scope; not fixed. This means Job 1 does not currently pass end-to-end.
- `apps/admin-console`: 101/101 tests, lint clean (aside from 4 pre-existing, unrelated findings already documented in Story 15-4's own record), typecheck clean, build clean.
- `apps/customer-website`: lint clean, build clean, **typecheck now clean — 0 errors** (32 real errors found and fixed this session, plus a `jsconfig.json` scope gap; see "RESOLVED" section above).
- `apps/window-display`: lint clean (after this story's fix), typecheck clean (after this story's fix), build clean.
- `apps/venue-connector`: 38/38 .NET tests passing (including real separate-process crash/replay — confirmed `CrashReplayTests.cs` contains 4 `[Fact]`/`[Theory]` tests and none of the 38 were skipped), solution build clean, 0 warnings.
- CI workflow: independently re-reviewed for security/reliability; `permissions:` and `timeout-minutes:` added to every job; YAML re-validated with `js-yaml`. All other checklist items (concurrency, service health checks, secret handling, fork-PR token scope, Windows-only project exclusion) confirmed already correct.
- **Local reproduction ≠ CI runner.** All of the above is from directly running each job's exact command sequence in this working tree — none of it ran on a real CI runner, and per the newly-discovered git-tracking gap below, it could not yet succeed there even if pushed.

## What remains (not done by this story, deliberately)

- **`apps/` is not tracked by git at all — must be resolved first, by a separately-authorized operator decision** (see "NEW critical finding" above). Until `apps/` is genuinely committed into a repository history that a `git push`/`checkout` can retrieve, pushing this workflow cannot succeed regardless of any code-level fix.
- **`apps/api`'s full-project lint is not clean** (302 pre-existing errors/263 warnings, see above) — Job 1 will fail on a real run until this is separately addressed; out of scope for this story.
- **The workflow file is not yet pushed to the real repository**. Per this session's standing default (no commit/push without explicit instruction), it stays local/uncommitted, exactly like every other change this session.
- **Branch protection ("blocking merge") is not configured.** A workflow file alone only reports status checks — making them REQUIRED to merge is a repository-admin action (Settings → Branches → main → "Require status checks to pass before merging", selecting each of the 6 job names above) that this story deliberately does not take unilaterally; it is a separate, higher-stakes decision on shared infrastructure for a human to make explicitly.
- Once all four of the above happen, this story's own acceptance criteria ("running unattended on every PR, blocking merge") are genuinely met — until then, status is `in-progress`, not `done`, honestly.

## Files Changed

- CI workflow (new, then modified this session — `permissions:`, `timeout-minutes:` added to all jobs)
- `apps/api/test/integration-rate-limit-reset.ts` (new) — centralized rate-limit-bucket reset
- `apps/api/test/jest-integration.json` (modified) — wired the new setup file via `setupFilesAfterEnv`
- `apps/api/test/connector-command-harness.integration-spec.ts` (modified) — fixed the `ts-node` binary path
- `apps/window-display/src/App.tsx` (modified) — removed 4 dead `@ts-ignore`/`@ts-expect-error` suppressions
- `apps/window-display/src/pages/KioskWindowSignagePage.tsx` (modified) — removed 2 fully unused symbols
- `apps/customer-website/src/components/DrinksMenu.jsx` (modified, this session) — added default on `SectionHeading`'s `subtitle`, removed dead `badge` prop from `DrinkRow`
- `apps/customer-website/src/components/reservation/ReservationSummary.jsx` (modified, this session) — added defaults on `mobile`, `Row`'s `icon`
- `apps/customer-website/src/components/reservation/Step1Details.jsx` (modified, this session) — added default on `FieldLabel`'s `required`, JSDoc-typed the `errors` `useState`
- `apps/customer-website/jsconfig.json` (modified, this session) — widened `include` to cover the app's real entry point and all reachable files
- `apps/customer-website/src/components/ui/toast.jsx` (modified, this session) — added JSDoc `@type` annotations to 6 `React.forwardRef` components
- `_bmad-output/implementation-artifacts/deferred-work.md` (modified) — customer-website typecheck gap resolved; git-tracking and API-lint findings recorded
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (modified) — `16-3` status
- `_bmad-output/implementation-artifacts/16-3-ci-regression-gates.md` (this file)

## Change Log

- 2026-08-19: CI workflow authored (6 jobs across all 5 apps + venue-connector). Independently verified end-to-end by directly running every job's exact command sequence, including a from-zero real-Postgres integration run. Found and fixed 3 real defects (integration-suite rate-limit cascade, a `ts-node` path bug, `window-display`'s stale lint/type suppressions and dead code). Found and deliberately deferred 1 real, unrelated defect (`customer-website` typecheck, originally miscounted as 13 pre-existing errors). Not yet pushed or activated as a required check — both are explicit operator actions, not taken by this story.
- 2026-08-19 (follow-up session): Re-investigated the `customer-website` typecheck gap — corrected the count (32 real errors, not 13, from a truncated capture), grouped into 2 root causes, fixed all of them without `any`/casts/suppressions. Found and fixed a deeper `jsconfig.json` scope gap the fix itself surfaced (app entry point never type-checked; widening then required properly typing 6 generated shadcn/ui components rather than reverting or suppressing). Independently reviewed CI workflow for security/reliability; added missing `permissions:` and `timeout-minutes:`. Found and did NOT fix two new, larger blockers: `apps/` is entirely untracked by git in both the top-level repo and a stray nested `apps/api/.git` duplicate clone (blocks any real CI run regardless of code correctness); `apps/api`'s full-project lint has 302 pre-existing errors/263 warnings (blocks Job 1, unrelated to and far larger than this story's scope). Both recorded precisely for a later, separately-scoped session. Nothing staged, committed, or pushed.
