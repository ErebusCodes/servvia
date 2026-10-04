---
title: 'Story 1.8: Native-round-recovery tests refuse a DATABASE_URL host query override'
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

**Problem:** Story 1.7's guard in `apps/api/test/native-round-recovery.integration-spec.ts` judges locality only by the URL authority (`new URL(DATABASE_URL).hostname`). The database stack (Prisma 5.22 `prisma-client-js`, Rust query engine, no driver adapter) honours a `host` query parameter in preference to the authority. So a `DATABASE_URL` such as `postgresql://u:p@localhost:5432/db?host=other` with a matching opt-in passes the guard and runs the 16 destructive recovery tests against `other`. Measured by the orchestrator on 2026-10-04 (TEST-PROVEN, no remote connection): with `?host=db.invalid` and a matching opt-in, all 16 tests executed against the alternate target. This is a bounded security remediation of accepted Story 1.7 (Epic 1; NFR TEST-21).

**Approach:** Fail closed. The guard also refuses whenever `DATABASE_URL` carries any query parameter whose decoded name is `host`, compared case-insensitively, whatever its value (empty and repeated included). The guard does not reproduce the engine's effective-host algorithm. Test-only change; nothing else in the repository changes.

## Boundaries & Constraints

**Always:**
- Security invariant. The recovery tests execute only when ALL of these hold for `DATABASE_URL` as the spec sees it at load time (after `integration-setup.ts`):
  1. the URL authority host is exactly `localhost` or `127.0.0.1`;
  2. no query parameter whose decoded name is `host`, in any letter case, is present (any value, empty, or repeated);
  3. the path database name is not production-like under the existing protection;
  4. `NATIVE_ROUND_RECOVERY_INTEGRATION_TEST_DATABASE` exactly equals the path database name.
- In every other case, zero recovery tests execute. The refusal is explicit: the existing conditional skip alias with the `console.warn`, whose text keeps the tag `[native-round-recovery.integration-spec] SKIPPED.` followed by the opt-in variable name. No connection to an alternate target is attempted.
- The normal safe configuration (local authority, no host parameter, non-production name, exact opt-in) still runs and passes the same 16 tests, with zero recovery tests skipped.
- Only the guard block and its directly relevant header comment change. Everything from `describeOrSkip('native round recovery, against real PostgreSQL'` to the end of the file stays byte-identical.

**Never:**
- Change any file other than `apps/api/test/native-round-recovery.integration-spec.ts`, and this story spec for workflow bookkeeping. In particular, never change `apps/api/test/integration-setup.ts` or any other file under `apps/api/test/**`, `apps/api/src/**` (including `PrismaService` and `withUtcSession`), `apps/api/prisma/**`, `.github/**`, `tooling/**` (the evaluator), `services/**`, `contracts/**`, `apps/web/**`, `docs/**`, `PRD/**`, `_bmad/**`, `.claude/**`, `_bmad-output/planning-artifacts/**`, any `package.json` or `package-lock.json`, or anything belonging to Story 1.7 (its spec, frozen objective, anchor, candidate, ledger and evidence are immutable).
- Add, remove, skip, focus, rename or weaken any test, or add a lint or type suppression.
- Change production behaviour, Prisma configuration, schema, migrations, auth or API contracts. If the intent needs any of these, HALT blocked with `OBJECTIVE SCOPE INVALID`.
- Model the engine's choice of host (for example "last `host` wins") or accept a host parameter because its value is local.

## I/O & Edge-Case Matrix

`<db>` is the local, non-production database the evaluator provides; the opt-in equals `<db>` unless stated.

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Safe configuration | `localhost` or `127.0.0.1` authority, no host parameter, opt-in `<db>` | the 16 tests execute and pass | No error expected |
| Opt-in absent | local `<db>`, no opt-in | file discovered, 0 recovery tests executed | guard warning |
| Opt-in empty | opt-in `''` | 0 executed | guard warning |
| Opt-in names another database | opt-in `<db>_other` | 0 executed | guard warning |
| Non-local authority | `db.invalid` authority | 0 executed | guard warning |
| Production-named | `verdura_production`, matching opt-in | 0 executed | `integration-setup.ts` refusal |
| Unparsable URL | `not a url` | 0 executed | `integration-setup.ts` refusal |
| Host parameter, remote value | `?host=db.invalid` | 0 executed, no connection attempt | guard warning |
| Host parameter, local value | `?host=127.0.0.1` or `?host=localhost` | 0 executed, no connection attempt | guard warning |
| Host parameter, empty | `?host=` | 0 executed, no connection attempt | guard warning |
| Host parameter, repeated | `?host=127.0.0.1&host=db.invalid` | 0 executed, no connection attempt | guard warning |
| Host parameter, percent-encoded name | `?%68ost=db.invalid` | 0 executed, no connection attempt | guard warning |
| Host parameter, other letter case | `?HOST=db.invalid` or `?Host=db.invalid` | 0 executed, no connection attempt | guard warning |

</intent-contract>

## Code Map

- `apps/api/test/native-round-recovery.integration-spec.ts:28-43` -- header comment. Its "IT REFUSES TO RUN…" list (host, production name, opt-in) gains the host-query-parameter condition with a one-line reason (the engine prefers a `host` query parameter over the authority). "HOW TO RUN IT" (lines 45-51) stays valid as written.
- `apps/api/test/native-round-recovery.integration-spec.ts:65-107` -- THE GUARD and the only code to change: `OPT_IN_KEY`, `PRODUCTION_LIKE_NAME` (byte-identical copy of `integration-setup.ts`'s pattern; keep it), `targetOf` (parses with `new URL`, returns `{ host, name }` or null), `optedIn`, `describeOrSkip = optedIn ? describe : describe.skip`, and the `console.warn` (lines 97-107). Extend this logic so a URL with any query parameter whose decoded name lower-cases to `host` is not opted in. `URL.searchParams` iterates decoded names: `%68ost` arrives as `host`, and each repeated or empty parameter is its own entry. Line 109 onwards (`describeOrSkip('native round recovery, …'` to end of file, 726 lines in total) must stay byte-identical. Its SHA-256 from the marker to EOF at baseline `0b89494` is `f99f78cc8974a7315ee848ef02044a34e81968d34faec76fbe4f68926f9008f0`.
- `apps/api/test/integration-setup.ts` -- read-only. It runs first (`setupFiles` in `test/jest-integration.json`), applies `INTEGRATION_DATABASE_URL` precedence and refuses unreadable or production-named URLs. It then rewrites `DATABASE_URL` through `withUtcSession`, which re-serializes the query and appends `options=-c TimeZone=UTC`. So the guard always sees an `options` parameter, which must not be treated as a host parameter, and an encoded `%68ost=` reaches the guard already serialized as `host=`. It enforces no host locality itself (recorded, not in scope).
- `apps/api/src/prisma/prisma.service.ts:15-36` -- read-only. `withUtcSession` keeps every other query parameter, and `PrismaService` passes the result to the engine as the datasource URL. That is why a `host` parameter reaches the engine.
- `apps/api/test/integration-rate-limit-reset.ts` -- read-only. It connects to Redis only, never to the database, so a refused suite makes no database connection.
- `tooling/evaluator/policy.json` -- read-only. Its `skipPatterns` flag any added line holding a call-form skip or focus. Keep the conditional alias without call parentheses on the skip. Its `suppressionPatterns` flag any added lint or type suppression directive, so add none. The file's test-declaration count must not change.
- Continuity (Story 1.7, done): 1.7 introduced the opt-in and this guard, and kept tests frozen. Its review deferred this exact `?host=` question as "medium (unverified)". The orchestrator's measurement has now settled it as real. Story 1.3/1.7 rule: fix the cause and never skip or edit tests.

## Tasks & Acceptance

**Execution:**
- `apps/api/test/native-round-recovery.integration-spec.ts` -- in the guard, treat a `DATABASE_URL` that carries any query parameter whose decoded name is `host` (case-insensitive, any value) as not opted in. Update the header comment's refusal list to state that condition and its reason. Keep the warning tag immediately followed by the opt-in variable name; it may also mention the host parameter after that. -- This closes the authority/engine host mismatch with the simplest fail-closed rule.
- No test file is added or edited to cover the I/O matrix: tests are frozen by this intent. The matrix's refusal rows are exercised by the objective's `native-round-recovery-fail-safe` check (fourteen cases), and the safe row by `api-integration` (RT-01 to RT-16).

**Acceptance Criteria:**
- Given a `DATABASE_URL` with a local authority, a non-production database name and a matching opt-in, but any `host` query parameter (remote, local, empty, repeated, percent-encoded name, or another letter case), when the API integration suite runs the native-round-recovery file, then the file is discovered, 0 recovery tests execute, the output carries the guard warning (tag followed by the opt-in name), and no connection to the alternate target is attempted.
- Given the six Story 1.7 fail-safe configurations (opt-in absent, empty, or naming another database; non-local authority; production-named database; unparsable URL), when the suite runs that file, then 0 recovery tests execute with the guard warning or the existing `integration-setup.ts` refusal, as before.
- Given the safe configuration (local authority, no host parameter, non-production name, exact opt-in) on a database migrated and seeded as CI does, when the full API integration suite runs, then the same 16 recovery tests execute under their exact names and pass, and the only skips are the 5 GCS tests.
- Given the candidate, when it is compared with baseline `0b89494`, then only the guard and its header comment differ in the spec file, the recovery suite from its `describeOrSkip` to the end of the file is byte-identical, no other repository file changes apart from this story spec, and API unit tests, lint and typecheck pass.

## Spec Change Log

## Review Triage Log

## Design Notes

**Why refuse every `host` parameter.** The engine accepts only the exact decoded name `host` and uses the LAST value when it is repeated, while `URLSearchParams.get` returns the first. An empty `host=` still overrides. Copying that algorithm would tie the guard to one engine version's parsing. Refusing any parameter whose decoded name lower-cases to `host` is a strict superset of the engine's behaviour. It also fails closed if a future driver matches the name case-insensitively. A legitimate local run never needs the parameter.

**Measured parameter semantics (orchestrator, 2026-10-04, TEST-PROVEN locally).** `HOST` and `Host` were ignored by the engine. `%68ost` was decoded and honoured. `hostaddr`, `dbname` and `database` were not honoured: the database always comes from the path. So condition 3 (the production-name check on the path) and condition 4 (the exact-name opt-in) keep reading the path name, unchanged.

**Baseline.** The accepted Story 1.7 candidate `0b89494821fe6a1def9dd1af0d2d30071325b957` is the baseline. Under the objective's `native-round-recovery-fail-safe` check, its six Story 1.7 cases pass, but every host-query case executes all 16 recovery tests, and `?host=db.invalid` attempts the alternate target. The check therefore fails on the baseline, which is the vulnerability recorded as a mechanical baseline fact. The 16 tests already run and pass in the safe configuration at this baseline. They are therefore regression characterizations (RT-01 to RT-16), not baseline failures.

**Sketch (illustrative only, not prescriptive):**
```ts
const hasHostParameter = [...parsed.searchParams.keys()].some((k) => k.toLowerCase() === 'host');
```

**Recorded, not in scope.**
- (a) `integration-setup.ts` enforces no host locality. Its production-name refusal reads the path database name, and in this stack `dbname`/`database` query parameters did not override the database. No change is authorized there.
- (b) Follow-up finding: CI DRIFT COULD FALSE-GREEN. `api-integration` stays green if the guard falls back to the skip. A separate CI-hardening story is required. CI is not touched here.

## Verification

**Commands:** (from `apps/api`, in an anchored run)
- `node ../../node_modules/eslint/bin/eslint.js "{src,apps,libs,test}/**/*.ts"` -- expected: exit 0, no new suppression.
- `node ../../node_modules/typescript/bin/tsc --noEmit` -- expected: exit 0.
- `git diff --name-only 0b89494821fe6a1def9dd1af0d2d30071325b957` -- expected: only `apps/api/test/native-round-recovery.integration-spec.ts` and this story spec.
- `node -e` SHA-256 of the spec file from the marker `describeOrSkip('native round recovery, against real PostgreSQL'` to EOF -- expected: `f99f78cc8974a7315ee848ef02044a34e81968d34faec76fbe4f68926f9008f0`, and the marker occurs exactly once.

**Manual checks:**
- The added lines contain no call-form skip or focus and no suppression directive, and the `it(` count is still 16.
- The full integration suite, the fail-safe check (fourteen cases) and the API unit suite need PostgreSQL and Redis. They are the evaluator's checks under the frozen objective.


## Auto Run Result

Status: ready-for-dev
Blocking condition: waiting-for-objective-approval: draft _bmad-output/implementation-artifacts/objective-drafts/story-1-8-native-round-recovery-host-override-safety/v1.objective.json sha256 f1cc2e9c54b988b2a64cb4e448267545a5db0ccc565e2b7f35e878e5dfefa966
