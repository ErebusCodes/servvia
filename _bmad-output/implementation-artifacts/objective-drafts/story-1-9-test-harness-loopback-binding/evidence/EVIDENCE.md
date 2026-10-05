# Story 1.9 — preparation evidence (2026-10-05)

> **FREEZE CANDIDATE — NOT YET FROZEN.** Evidence record, not authority. Each statement is labelled as an **observation** (measured or read here) or an **inference** (reasoned from observations or documented semantics). Scratch locations are omitted. Every run used disposable exports and clones of the repository, never a working checkout.

## 1. Defect surface at the baseline `e42edeb`

| Fact | Kind | Value |
|---|---|---|
| `apps/api` `devDependencies.supertest` | observation | `^6.3.4` (`@types/supertest` `^6.0.2`) |
| Lockfile resolution | observation | `supertest` 6.3.4, `superagent` 8.1.2, `formidable` 2.1.5, all `dev: true`; 1,451 lockfile package entries |
| Supertest 6.3.4 behaviour | observation | `lib/test.js:48` `this._server = app.listen(0)` (no host); `lib/test.js:51` request URL `http://127.0.0.1:<port>` |
| Host-less listen in test code | observation | exactly one: `apps/api/test/connector-command-harness.integration-spec.ts:171` `await app.listen(0);`. The harness then targets `http://127.0.0.1:<port>/api` |
| Other listen calls in test code | observation | 6, all explicit `'127.0.0.1'`. Production `apps/api/src/main.ts:144` binds `0.0.0.0` (out of scope) |
| Supertest-importing files | observation | 25: 23 `apps/api/test/*.integration-spec.ts`, plus `src/auth/guards/jwt-auth.guard.spec.ts` and `src/orders/kiosk-production-availability.spec.ts` |
| Changes since the draft's baseline `38bea30` | observation | `apps/api`: only `README.md` and `src/media/media.service.ts`; the harness file is byte-identical (sha256 `8723e2d8…11650e3`); `package-lock.json` changed only at `354ea1b` (158 packages removed, 0 added, 2 changed: the root entry and `@types/trusted-types`); `354ea1b → e42edeb` changed no package |
| Runtime, unit and integration suites (evaluator probe, Node 22) | observation | 1,196 test-server listens, **every one on the wildcard** `:::<port>`; 0 requests reached a loopback-bound server; 0 of 25 Supertest files evidenced; 998 distinct bind/request problems |

**Which comparison is meaningful.** The objective compares a candidate with **`e42edeb`**, the anchor's parent. The `38bea30 → 354ea1b` delta (158 removed packages, recomputed exactly) matters only because it makes the paused draft's dependency hashes stale; it is not part of Story 1.9.

## 2. Mechanism

Scratch experiments (`mechanism-forward.js`, `mechanism-reverse.js`, outputs in `mechanism.out`). macOS 27.0.1 (darwin-arm64), ephemeral range 49152–65535. The results are identical under Node 22.23.3 and Node 24.19.0.

| Experiment | Kind | Result |
|---|---|---|
| Another process holds `127.0.0.1:P`; the test calls a host-less `listen(P)` | observation | succeeds, bound `[::]:P`; a request to `127.0.0.1:P` is answered by **the other process** |
| Same, with `listen(P, '127.0.0.1')` | observation | refused, `EADDRINUSE` (the safe behaviour) |
| The test holds `[::]:P` (host-less `listen(0)`); another process then binds `127.0.0.1:P` explicitly | observation | the other bind **succeeds**; a request to `127.0.0.1:P` is answered by **the other process** |
| 2,000 loopback listeners held; 3,000 host-less `listen(0)` | observation | 0 assigned a held port (ephemeral allocation avoids them) |
| 1,000 host-less servers held; 3,000 `listen(0, '127.0.0.1')` in another process and in the same process | observation | 0 landed on a held port |
| The evaluator's `services.mjs` `freePort()` | observation | binds `127.0.0.1:0`, closes it, then starts PostgreSQL and Redis on that **explicit** port |
| Natural trigger | inference | an explicit loopback bind on an ephemeral-range port, by another process, while a test holds the wildcard. "Find a free port, then bind it explicitly" patterns do exactly that; for example, a concurrently starting evaluation's database or Redis. The hijacked request then reaches a non-HTTP service, which matches the recorded `read ECONNRESET` and `socket hang up` |
| Linux CI | inference (not measured; Docker was not running) | Linux refuses an IPv4 bind that overlaps a dual-stack wildcard bind on the same port, so the defect is expected to be latent in CI (ubuntu, Node 22) and exposed on macOS hosts (developers, the local evaluator) |

**Reproduction attempts (bounded):**
- 2 full baseline measurements (unit plus integration; Node 22 and Node 24);
- 13 targeted `orders.integration-spec` runs (10 under Node 22, 3 under Node 24);
- 2 evaluator runs, each running the integration suite twice: `api-integration`, and the endpoint probe.

That is 6 full integration runs plus 13 targeted runs, with **no natural failure**. Prior accepted evidence: the 2026-10-05 Batch 2 matrix on `38bea30` failed 2 of 10 targeted runs (`read ECONNRESET`, `socket hang up` on `127.0.0.1` requests), and the other baseline workspace in that matrix failed 0 of 10.

**Verdict: `FLAKE NOT REPRODUCED — MECHANISM CONFIRMED`.**

## 3. Baseline measurements (Node 22 qualification)

`baseline-measure.mjs`; outputs in `baseline-measure-n22.txt` and `baseline-measure-n24.txt`. Disposable PostgreSQL 18 and Redis in UTC, after `prisma migrate deploy`, `prisma generate` and seed.

| | Node 22.23.3 (repository-pinned) | Node 24.19.0 (host default) |
|---|---|---|
| API unit | 2120 passed of 2120 (136 suites) | 2120 of 2120 |
| API integration | 378 passed, 5 skipped (GcsStorageProvider only), 0 failed (34 suites) | identical |
| Targeted orders runs | 10 of 10 pass | 3 of 3 pass |

**Node qualification:**
- **Repository and CI evidence:** `.nvmrc` 22; `engines` `>=22 <23` (root and `apps/api`); every CI job's `setup-node` reads `.nvmrc`; CI runs on ubuntu.
- **Behaviour:** Story 1.9 behaviour does not differ between Node 22 and 24. The mechanism and the suite results are identical.
- **Requirement:** the objective requires no version, because the schema has no field for it. The packet requires Node 22 for provisioning (enforced by `provision.sh`) and for launching the evaluator (recorded as `record.environment.node`).
- **Conclusion:** no freeze blocker.

## 4. Evaluator provisioning (validated)

- **Run:** `provisioning/provision.sh` on a simulated anchor in a disposable clone, under Node 22.23.3 / npm 10.9.9.
- **Lockfile:** byte-identical to the baseline's, so the dependency gate's "identical" path was taken. `npm ci --ignore-scripts` succeeded from the local npm cache, and the lockfile's sha256 (`9fca1530…61d10ad5f`) was unchanged afterwards.
- **Runtime resolution:** passed (supertest 6.3.4, superagent 8.1.2, formidable 2.1.5, as locked).
- **Install scripts:** with `--ignore-scripts`, the API suites ran green after the evaluator's own `prisma-generate` setup step, so no install script is needed.

## 5. Evaluator runs on the draft (no-op candidate, simulated freeze in a disposable clone)

| Run | Draft sha256 | Result |
|---|---|---|
| 1 | `1c99bf8f…3086b86` (superseded) | `FAIL`, as expected for the unfixed baseline. **It also exposed a stale inherited constant:** Story 1.8's `ci-workflow-opt-in` pins a hash of `ci.yml` taken at Story 1.8's baseline, and `ci.yml` changed legitimately at `354ea1b`. The generator now re-derives it at the baseline (`955973ff…`), after proving it reproduces Story 1.8's constant (`8ce71293…`) at Story 1.8's own baselines `0b89494` and `38bea30` |
| 2 (final) | `02206f1c5bb5812f9a4f0085c825f914f0a1e6e52be9e00e7dcaed80fb4c5049` | `FAIL` (record sha256 `2ebe0459…5abf47f`). See the breakdown below |

**Breakdown of the final run:**
- **Setup:** the evaluator was authentic (tree `31f37af2…`), running on Node 22.23.3. The diff against the anchor was empty, and there were no integrity findings.
- **Verdict reasons:** exactly 4. `loopback-endpoint-identity`, `test-server-explicit-loopback`, `connector-harness-change-bounded` and `supertest-dependency-delta` all failed.
- **Passed:**
  - `api-integration` (378 passed, 5 skipped; RT-01 to RT-16 present);
  - `api-unit` (2120);
  - `api-lint` and `api-typecheck`;
  - `native-round-recovery-fail-safe` and `native-round-recovery-suite-unchanged`;
  - `ci-workflow-opt-in`;
  - `supertest-runtime-resolution`.

**Expected verdicts after freeze:**
- **Unchanged or partial candidate:** `FAIL` (the checks above).
- **A candidate that touches anything outside its three files, the Stories 1.7/1.8 artifacts, governance, the objective, the epic context, the spec's intent contract, or adds a test or helper file:** `INTEGRITY_VIOLATION`.
- **A correct Option A candidate:** expected to `PASS`, but **not demonstrated**. No positive control was built, because implementation is not authorized.

## 6. Adversarial coverage (`adversarial-probes.mjs`, output `adversarial-probes.out`)

- **Variants:** 27 deliberately wrong candidates and a no-op, each on the simulated anchor of the final draft.
- **Judging:** each was judged with the anchor's own `staticIntegrity`, the evaluator's intent-contract rule, and the three static checks.
- **Masking:** every variant also lacks the fix, so the check messages were compared with the no-op's.

Result: **27 of 27 wrong variants are rejected by a finding specific to them, and 0 are rejected only because the fix is absent.**

| Attack | Rejected by |
|---|---|
| wildcard `::` / `0.0.0.0` / bracket-call listen in the harness | `test-server-explicit-loopback`, `connector-harness-change-bounded` |
| harness test skipped; harness assertion weakened | `INTEGRITY_VIOLATION` (tests-removed, skip-or-focus-added); `connector-harness-change-bounded` |
| new helper / new test / new src spec reintroducing a host-less listen | `INTEGRITY_VIOLATION` (unauthorized-surface-added or forbidden-surface) + `test-server-explicit-loopback` |
| test file deleted; one test removed | `INTEGRITY_VIOLATION` (forbidden-surface) |
| recovery suite skipped (1.7); host-override guard removed (1.8); integration-setup bypass; `.env` bypass | `INTEGRITY_VIOLATION` (forbidden-surface) |
| hard-coded success: jest-integration narrowed | `INTEGRITY_VIOLATION` (forbidden-surface) |
| hard-coded success: unit jest config or `test` script in `apps/api/package.json`; extra dependency; other lockfile package changed | `supertest-dependency-delta` (package or lockfile changed beyond the approved delta) |
| root dependency; production listen host; CI `continue-on-error` | `INTEGRITY_VIOLATION` (forbidden-surface) |
| evaluator, objective or epic context edited; spec intent contract edited; this packet edited | `INTEGRITY_VIOLATION` (governance-modified, objective-modified, intent-contract-modified, forbidden-surface) |

The runtime check `loopback-endpoint-identity` (every bind on `127.0.0.1`, every request matched, 25/25 files evidenced, suites at their floors) additionally rejects any unsafe bind reached through code paths that static scans cannot see.
