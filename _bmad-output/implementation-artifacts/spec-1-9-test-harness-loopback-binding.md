---
title: 'Story 1.9: API test requests target the explicit loopback endpoint their test server is bound to'
type: 'bugfix'
created: '2026-10-05'
status: 'ready-for-dev'
review_loop_iteration: 0
followup_review_recommended: false
context: []
warnings: []
deferred: []
---

> **FREEZE CANDIDATE — NOT YET FROZEN.** Prepared 2026-10-05 against baseline `e42edeb3c865737e919be8c1c8bebfc4bb7f279b`. Implementation is **not authorized**. The orchestrator alone freezes the objective (`_bmad-output/implementation-artifacts/objectives/README.md`). The freeze-candidate packet, its evidence and the generator are in `_bmad-output/implementation-artifacts/objective-drafts/story-1-9-test-harness-loopback-binding/`.

<intent-contract>

## Intent

**Problem:** The API test suites start in-process Nest test applications and drive them with Supertest. With `supertest@6.3.4` (the version the baseline locks), `request(app.getHttpServer())` on a server that is not yet listening calls `listen(0)` with no host (`supertest/lib/test.js`). On a dual-stack host that binds the IPv6 wildcard `[::]`, while Supertest sends the request to `127.0.0.1:<port>`. In the same way, `apps/api/test/connector-command-harness.integration-spec.ts:171` calls `await app.listen(0);` (wildcard `[::]`) while its external command process targets `http://127.0.0.1:<port>/api`.

The bound endpoint and the request endpoint therefore differ. On macOS (BSD socket semantics), another process can bind `127.0.0.1:<port>` explicitly while the test server holds `[::]:<port>`, and from then on every request the test sends to `127.0.0.1:<port>` reaches that other process, not the test application. Explicit loopback binds on ephemeral-range ports are routine, for example any "find a free port, then start a service on it" pattern such as the evaluator's own disposable PostgreSQL and Redis.

Measured on the baseline (2026-10-05): all 25 Supertest-importing files in `apps/api` drive in-process servers this way. The mechanism was reproduced deterministically under Node 22 and Node 24. The 2026-10-05 Batch 2 intermittent `orders.integration-spec` failures (`read ECONNRESET`, `socket hang up` on `127.0.0.1` requests) are the recorded symptom. This is Epic 1 test-truthfulness hardening (PRD section 21).

**Approach:**
- Upgrade the API's dev-only `supertest` from `^6.3.4` to `^7.3.1`. Version 7 starts an unbound server on `127.0.0.1` and requests `127.0.0.1`.
- Make the one explicit host-less test listen bind the loopback explicitly: `await app.listen(0, '127.0.0.1');`.
- Change nothing else. In particular, there is no production networking change and no shared bootstrap or monkeypatch.

## Boundaries & Constraints

**Always:**
- Endpoint-identity invariant: every HTTP request a test sends to an in-process Servvia test server targets exactly the explicit local endpoint that server is bound to, `127.0.0.1:<port>`. No test server binds a wildcard (`::`, `0.0.0.0`) or an unspecified host. A wildcard/IPv4 address mismatch can never let an unrelated local process receive a test request.
- The dependency change is exactly:
  - `apps/api` `devDependencies.supertest` `^6.3.4` → `^7.3.1`;
  - `package-lock.json` `node_modules/supertest` 7.3.1, `node_modules/superagent` 10.4.1 and `node_modules/formidable` 3.5.4, with their registry integrity, all dev-only;
  - the `apps/api` supertest range;
  - npm's synchronisation of the lockfile's `name`/`engines` metadata with the unchanged `package.json` files.

  Nothing else in either file changes. npm may re-sort `devDependencies` keys.
- `apps/api/test/connector-command-harness.integration-spec.ts` changes in line 171 only: `await app.listen(0);` → `await app.listen(0, '127.0.0.1');`.
- All existing tests still run and pass at their measured floors: API unit (≥2120), API integration (≥378; the only skips are the 5 GcsStorageProvider tests), lint and typecheck. Story 1.7's recovery truthfulness and Story 1.8's host-override fail-safe pass unchanged. The recovery suite body still hashes to `f99f78cc8974a7315ee848ef02044a34e81968d34faec76fbe4f68926f9008f0`.
- Node 22 is the repository-pinned engine (`.nvmrc`, `engines >=22 <23`); the dependency change installs and runs under it.

**Never:**
- Change any file other than `apps/api/package.json`, `package-lock.json` and `apps/api/test/connector-command-harness.integration-spec.ts`, plus this story spec for workflow bookkeeping. That includes:
  - production code (`apps/api/src/**`, including `main.ts` and its listen host), Prisma, schema or migrations;
  - other test files or test helpers, jest/tsconfig/eslint configuration;
  - the root `package.json` or any other package manifest or lockfile;
  - `.github/**`, `tooling/**` (the evaluator), `services/**`, `contracts/**`, other apps, `docs/**`, `PRD/**`, `_bmad/**`, `.claude/**`, `_bmad-output/planning-artifacts/**`, `_bmad-output/implementation-artifacts/objective-drafts/**`;
  - anything belonging to Stories 1.7 or 1.8: their specs, frozen objectives, anchors, candidates, ledgers and evidence, and `apps/api/test/native-round-recovery.integration-spec.ts`.
- Add, upgrade or remove any other dependency (including `@types/supertest`, `superagent` declared directly, or a production dependency), or change npm settings.
- Add a shared test bootstrap, a global `http`/`net` monkeypatch, a jest setup file, an environment switch or a new test file. Do not add, remove, skip, focus, rename or weaken any test, or add a lint or type suppression.
- Bind a test server to `::`, `0.0.0.0`, `localhost` or no host, or rely on probabilistic port selection to avoid collisions.
- If the intent needs any of these, HALT blocked with `OBJECTIVE SCOPE INVALID`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Supertest on an unbound Nest server | `request(app.getHttpServer())` | server listens on `127.0.0.1:<p>`; request targets `127.0.0.1:<p>` | No error expected |
| Connector command harness | external process with `baseUrl http://127.0.0.1:<p>/api` | API listens on `127.0.0.1:<p>` | No error expected |
| Tests' own fake servers (printer, bridge, waiterpad) | already `listen(0, '127.0.0.1')` | unchanged; requests match | No error expected |
| Another local process binds `127.0.0.1:<p>` explicitly | while the test server holds the port | the test server holds `127.0.0.1:<p>` itself, so the other bind fails (`EADDRINUSE`); the test request never reaches another process | No error expected |
| Supertest 7 against an already-listening `::` server | e.g. `app.listen(0, '::')` before `request(server)` | forbidden: still mismatched (requests `127.0.0.1`) | rejected by `loopback-endpoint-identity` and `test-server-explicit-loopback` |

</intent-contract>

## Code Map

- `apps/api/package.json` -- `devDependencies.supertest` (dev-only; Supertest is imported only by test files).
- `package-lock.json` -- `node_modules/supertest`, `node_modules/superagent`, `node_modules/formidable` (all `dev: true`).
- `apps/api/test/connector-command-harness.integration-spec.ts:171` -- the one host-less `app.listen(0)` in test code.
- Supertest importers (unchanged, 25 files): 23 `apps/api/test/*.integration-spec.ts`, plus `apps/api/src/auth/guards/jwt-auth.guard.spec.ts` and `apps/api/src/orders/kiosk-production-availability.spec.ts`.
- Already explicit (unchanged): every other test `listen` call binds `'127.0.0.1'` (`native-send-decision.spec.ts:56`, `fake-waiterpad-server.ts:144`, `print-jobs.processor.spec.ts:160,350`, `idealpos-order-submission-bridge-e2e.integration-spec.ts:122`, `printer-jobs.integration-spec.ts:115`). Production `main.ts:144` binds `0.0.0.0` by design and is out of scope.

## Tasks & Acceptance

**Execution:**
- [ ] `apps/api/package.json`, `package-lock.json` -- under Node 22, from the repository root: `npm install supertest@7.3.1 --save-dev -w apps/api --ignore-scripts`. Then confirm that the lockfile delta is exactly the approved entries (supertest 7.3.1, superagent 10.4.1, formidable 3.5.4, with the integrity values pinned in the objective) -- this upgrades the test client to bind and request the same loopback endpoint.
- [ ] `apps/api/test/connector-command-harness.integration-spec.ts` -- line 171: `await app.listen(0, '127.0.0.1');` -- explicit loopback bind matching the harness's `baseUrl`.

**Acceptance Criteria:**
- Given the candidate, when the full API unit and integration suites run with the endpoint probe, then every in-process test server binds `127.0.0.1` and every request to it targets `127.0.0.1` on the same port. All 25 Supertest-importing files show matched runtime evidence, and both suites pass at their floors.
- Given the candidate's test sources, when they are scanned, then every `listen` call in API test code names `'127.0.0.1'` explicitly.
- Given the candidate, when its manifests are compared with the baseline, then the only dependency change is the approved dev-only supertest delta. The `supertest` the tests load at runtime is the version the lockfile pins.
- Given the candidate, when the harness is compared with the baseline, then it differs only at line 171.
- Given the candidate, when the inherited checks run, then:
  - API integration passes (≥378; only the 5 GCS skips) and API unit passes (≥2120);
  - lint and typecheck pass;
  - Story 1.8's fail-safe passes;
  - the recovery suite hash is unchanged;
  - the CI opt-in wiring is unchanged.
- Given the candidate, when it is compared with the baseline, then nothing outside the three authorised files (and this spec) changes.

## Spec Change Log

- 2026-10-05 (objective preparation): rebased from the paused draft (baseline `38bea30`, not frozen) onto `e42edeb`. Floors re-measured (unit 1736 → 2120, integration 362 → 378, as measured on the baseline under Node 22 and Node 24). The mechanism statement was corrected: ephemeral-port allocation alone did not collide (3,000 trials in each direction, under each of Node 22 and Node 24); the collision needs an explicit loopback bind by another process while the test server holds the wildcard, which was reproduced deterministically. The Node 22 engine and the evaluator provisioning were made explicit.

## Review Triage Log

## Design Notes

**Why Option A (supertest 7 + the one explicit bind).** Selected by the orchestrator on 2026-10-05; to be confirmed at freeze.
- Option B (a shared bootstrap or an `http`/`net` monkeypatch forcing `127.0.0.1`) is test-only and broad. But it would hide every future host-less listen behind global magic, and the next wildcard mistake would pass silently.
- Option C (editing all 25 suites to `listen(0, '127.0.0.1')` before `request`) is explicit, but wide and repetitive.
- Option A fixes the client at its source with an upstream, maintained behaviour (Supertest ≥7 binds `127.0.0.1` for an unbound server). It makes the single explicit listen explicit too. It is enforced by:
  - a runtime endpoint-identity check;
  - a static explicit-loopback scan;
  - an exact dependency-delta pin;
  - a bounded harness change;
  - a runtime resolution check.

**Measured on the baseline `e42edeb` (2026-10-05, disposable PostgreSQL 18 and Redis in UTC).**
- Unit 2120/2120 and integration 378 passed / 5 skipped / 0 failed, identically under Node 22.23.3 and Node 24.19.0.
- The flake did not reproduce naturally in 15 bounded runs (2 full integration runs, 13 targeted `orders.integration-spec` runs).
- The mechanism reproduced deterministically: an explicit `127.0.0.1:<p>` bind by another process succeeds while the test server holds `[::]:<p>`, and the request is answered by that other process. An explicit `listen(p, '127.0.0.1')` is refused instead (`EADDRINUSE`).

**Evaluator dependency provisioning.** The evaluator links one operator-supplied `node_modules` root into both workspaces; it does not install the candidate's lockfile. The orchestrator therefore provisions the Story 1.9 evaluation's `node_modules` under Node 22 with `npm ci --ignore-scripts` from the candidate's lockfile, after `supertest-dependency-delta` has passed on it (packet `provisioning/README.md`). `supertest-runtime-resolution` makes any mismatch between the runtime and the candidate's lockfile a failure.

**Recorded, not in scope.**
- `LIBPQ SERVICE FORM NOT APPLICABLE TO CURRENT PRISMA PATH`.
- Story 1.10 (`story-1-10-ci-asserts-native-round-recovery-execution`, CI asserting the recovery suite executes) is separate, deferred and follows this story.
- Linux CI is expected, by kernel semantics, to refuse the overlapping loopback bind, so the defect is latent there; not measured.

## Verification

**Commands:** (from `apps/api`, in an anchored run)
- `node ../../node_modules/jest/bin/jest.js` -- expected: unit suite green (≥2120).
- `node ../../node_modules/jest/bin/jest.js --config ./test/jest-integration.json --runInBand` -- expected: ≥378 passed, only the 5 GCS skips.
- the objective's `loopback-endpoint-identity`, `test-server-explicit-loopback`, `connector-harness-change-bounded`, `supertest-dependency-delta` and `supertest-runtime-resolution` checks -- expected: ok.

**Manual checks:**
- `git diff` against the baseline touches only the three authorised files (and this spec).
