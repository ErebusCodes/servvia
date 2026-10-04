---
title: 'Story 1.8: Native-round-recovery tests refuse a DATABASE_URL host query override'
type: 'bugfix'
created: '2026-10-04'
status: 'done'
baseline_revision: '18034fb7eca030cae4212910518a82002f7b5dc1'
review_loop_iteration: 0
followup_review_recommended: false
context: []
warnings: ['oversized']
deferred:
  - summary: >-
      The host-parameter refusal has no lasting regression protection: only the frozen objective's native-round-recovery-fail-safe check exercises it, and CI api-integration only runs the safe configuration.
    evidence: |-
      Verification-gap layer (pre-verified) and Blind Hunter: no repo test or CI job runs the guard with a host query parameter; deleting `!target.hasHostParameter` would keep every repo check green. The intent forbids adding tests and touching .github/**, so this belongs with the already-recorded CI-hardening follow-up (promote the fail-safe cases into a repo-owned check run by api-integration).
    location: >-
      apps/api/test/native-round-recovery.integration-spec.ts (optedIn guard); .github/workflows/ci.yml api-integration
    severity: medium
  - summary: >-
      integration-setup.ts, the second guard layer, enforces no host locality and does not refuse a host query parameter.
    evidence: |-
      Pre-existing, recorded in the spec as Recorded-not-in-scope (a) and in the frozen objective's architecture constraints; the intent forbids changing integration-setup.ts.
    location: >-
      apps/api/test/integration-setup.ts
    severity: medium
  - summary: >-
      Query parameters other than host (notably libpq `service`, also `port`/`user`) were not measured as connection redirectors in this stack.
    evidence: |-
      The orchestrator measured hostaddr, dbname and database as NOT honoured by Prisma 5.22's Rust engine (database always from the path), which refutes the Blind Hunter claim for those. `service` (libpq service file) was not measured; settle by testing `?service=` against the Prisma 5.22 engine without a reachable server, as was done for host.
    location: >-
      apps/api/test/native-round-recovery.integration-spec.ts (targetOf)
    severity: medium (unverified)
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

### 2026-10-04 — Review pass
- verdicts: 12 findings — high 0, medium 3, low 1, false 7, maybe-false 1
- findings:
  - `[maybe-false]` `[defer]` (Blind Hunter) Other redirecting query parameters (hostaddr, service, dbname/database, port, user) are not refused. — Measured evidence in the objective refutes hostaddr/dbname/database for Prisma 5.22's engine (database always from the path, opt-in reads the path); `service` was not measured; settle by testing `?service=` against the engine without a reachable server. Deferred as medium (unverified).
  - `[medium]` `[defer]` (Blind Hunter) No test covers the new refusal; a regression would show only as a quiet skip. — Grouped with the verification-gap finding below (same root cause: no repo-owned check of the refusal). For this candidate the rows are exercised by the objective's 14-case fail-safe check, and a local scratch run of all 14 cases plus an admission control passed; lasting protection needs the CI-hardening follow-up because the intent forbids adding tests.
  - `[medium]` `[defer]` (Blind Hunter) integration-setup.ts, the second layer, was not updated for the host parameter. — Real but pre-existing and excluded by the intent (Never change integration-setup.ts); recorded in the spec as (a).
  - `[false]` `[reject]` (Blind Hunter) The header's engine claim has no source. — The comment states the measured behaviour accurately; its provenance (Prisma 5.22 Rust engine, orchestrator measurement 2026-10-04) is in this spec's Intent and the frozen objective, so no reader is misled.
  - `[low]` `[reject]` (Blind Hunter) The skip warning does not say which condition failed; wording slightly awkward. — Cosmetic; the warning names the host-parameter rule explicitly; per-reason reporting would add branches to the guard, and the intent fixes the warning's tag/opt-in shape.
  - `[false]` `[reject]` (Blind Hunter) Unsafe URLs only skip, never fail hard. — The intent mandates exactly this refusal: the existing conditional skip alias with the console.warn.
  - `[false]` `[reject]` (Blind Hunter) Spec moved to in-review with no record of work. — Workflow bookkeeping: the Auto Run Result is written at Finalize; any fix would edit this build's spec.
  - `[false]` `[reject]` (Blind Hunter) Unix-socket `?host=/path` URLs are now always refused, undocumented. — Intended (any value is refused) and documented: the header says "with any value" and the warning says DATABASE_URL must carry no `host` query parameter.
  - `[false]` `[reject]` (Intent Alignment) The diff acts on the predicate surface while the intent lives at the runtime surface, which nothing in the change exercises. — The runtime surface was exercised: a scratch jest run of all 14 refusal configurations (0 tests executed, guard/refusal evidence, no connection attempt) plus a safe-configuration control (16 executed against an unreachable port) passed; the 16-pass row is the evaluator's api-integration. Diff implements reading R1, no divergence.
  - `[medium]` `[defer]` (Verification Gap) The host-parameter refusal is checked only by the one-off objective, not by any repo test or CI. — Pre-verified gap with disposition defer; grouped with the Blind Hunter no-test finding; intent forbids tests and .github changes; belongs to the CI-hardening follow-up.
  - `[false]` `[reject]` (Verification Gap, other) withUtcSession re-serialization keeps the check consistent; no defect found. — Not a defect claim.
  - `[false]` `[reject]` (Edge Case Hunter) Diff vs 0b89494 also lists the frozen v1.objective.json, and baseline_revision is 18034fb. — The objective file comes from the orchestrator's freeze commit 18034fb (the anchor), not the candidate; the diff from the anchor lists only the guard file and this spec; baseline_revision is the run's start commit as step-03 requires.

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

Status: done (CANDIDATE PRODUCED; technical completion is the evaluator's decision only)

**Summary.** The native-round-recovery guard now also refuses when DATABASE_URL (as seen after integration-setup.ts) carries any query parameter whose decoded name lower-cases to `host`, whatever its value (empty and repeated included): `targetOf` returns `hasHostParameter` from `[...parsed.searchParams.keys()].some((key) => key.toLowerCase() === 'host')`, and `optedIn` requires `!target.hasHostParameter`. The engine's effective-host choice is not modelled.

**Files changed.**
- `apps/api/test/native-round-recovery.integration-spec.ts` — guard (`targetOf`, `optedIn`), its header-comment refusal list, and one added sentence in the warning after the unchanged tag and opt-in name.
- `_bmad-output/implementation-artifacts/spec-1-8-native-round-recovery-host-override-safety.md` — workflow bookkeeping outside the intent contract.

**Review.** 12 findings: 0 patches applied (patched counts: high 0, medium 0, low 0); 3 deferred (no lasting CI regression check for the refusal; integration-setup.ts host locality, pre-existing; unmeasured `service` parameter, unverified); 9 rejected with reasons in the Review Triage Log.

**Follow-up review recommendation:** false (no patched entries).

**Verification.**
- Lint (`eslint "{src,apps,libs,test}/**/*.ts"`) and typecheck (`tsc --noEmit`) from apps/api in a scratch export: exit 0.
- `git diff --name-only` from the anchor 18034fb: only the guard file and this spec. From 0b89494 it also lists the frozen objective, which the anchor commit itself added.
- Recovery suite from the `describeOrSkip` marker to EOF: SHA-256 `f99f78cc8974a7315ee848ef02044a34e81968d34faec76fbe4f68926f9008f0`, marker once; 16 `it(` calls; no call-form skip/focus or suppression in added lines.
- Scratch jest runs (DATABASE_URL on 127.0.0.1:1, nothing listening; Redis pointed at port 1): all 14 fail-safe configurations discovered the file, executed 0 recovery tests and showed the guard warning or integration-setup refusal with no connection attempt; a safe-configuration control executed all 16 (the guard admits). The 16-pass row needs PostgreSQL and is the evaluator's api-integration check; API unit tests were not run locally (evaluator).

**Residual risks.** The deferred items above; and the CI DRIFT COULD FALSE-GREEN follow-up recorded in Design Notes.
