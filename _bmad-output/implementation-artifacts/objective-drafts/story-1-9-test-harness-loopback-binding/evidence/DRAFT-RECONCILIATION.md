# Story 1.9 — reconciliation of the paused 2026-10-05 draft

> **FREEZE CANDIDATE — NOT YET FROZEN.** Evidence record, not authority.

**Source.** The paused, unpublished draft (spec, fragment and objective generators, check scripts, provisioning script, probe outputs) was kept outside the repository as historical draft material. Its draft objective (sha256 `1e5872…648b`, baseline `38bea30`) was never frozen and is **not reused**.

**Revalidated against:**
- baseline `e42edeb3c865737e919be8c1c8bebfc4bb7f279b`;
- the normative PRD (sections 16, 21 and 24);
- the committed Epic 1 context;
- the actual harness and dependencies;
- the evaluator at the baseline.

| # | Draft statement | Class | Finding at `e42edeb` |
|---|---|---|---|
| 1 | `apps/api` declares `supertest ^6.3.4`, locked 6.3.4 (superagent 8.1.2, formidable 2.1.5) | KEEP | Re-measured: identical |
| 2 | Supertest 6.3.4 `listen(0)` without host on an unbound server, requests `127.0.0.1` | KEEP | Observed in the installed `supertest/lib/test.js` (line 48 `app.listen(0)`, line 51 `http://127.0.0.1:` + port) |
| 3 | `connector-command-harness.integration-spec.ts:171` `await app.listen(0);` | KEEP | Re-measured: identical; the file is byte-identical to `38bea30` (sha256 `8723e2d8…11650e3`) |
| 4 | 25 Supertest-importing files (23 integration specs + 2 unit specs) | KEEP | Re-derived by `git grep` at the baseline: the same 25 files; the generator derives the list instead of hand-typing it |
| 5 | Every other test `listen` already names `'127.0.0.1'` | KEEP | Re-measured: 6 call sites, all explicit; production `main.ts:144` binds `0.0.0.0` (out of scope) |
| 6 | "On macOS the kernel can hand out an ephemeral port for a wildcard listener that another process already holds on `127.0.0.1`" | UPDATE (mechanism corrected) | Not observed: 0 of 3,000 host-less `listen(0)` calls received a port held by 2,000 loopback listeners (Node 22 and 24). What is observed deterministically: (a) a host-less `listen(P)` succeeds while another process holds `127.0.0.1:P`, and (b) another process can bind `127.0.0.1:P` explicitly while the test holds `[::]:P`. In both cases a request to `127.0.0.1:P` is answered by the other process. The natural trigger is an explicit loopback bind on an ephemeral-range port, for example the evaluator's own `freePort()` followed by PostgreSQL or Redis on that port |
| 7 | The Batch 2 flake was this collision ("expected 409 got 403", "socket hang up") | UPDATE | The recorded symptom (2026-10-05 flake matrix on `38bea30`: 2 of 10 targeted runs, `read ECONNRESET` and `socket hang up` on `127.0.0.1` requests) is consistent with the mechanism; the "409 vs 403" wording has no surviving log and is dropped. Attribution remains an inference |
| 8 | Unit floor ≥1736, integration floor ≥362 (inherited from Story 1.8) | UPDATE | Re-measured: unit 2120/2120, integration 378 passed / 5 skipped; floors raised to 2120 and 378 |
| 9 | 2,120 unit / 378 integration (Option A on `38bea30`, Node 24) | SUPERSEDED | Measured on a fix tree that no longer exists; the baseline counts above replace it |
| 10 | Dependency-delta constants `PKG`/`LOCK` (hashes of the `38bea30` manifests) | SUPERSEDED | The lockfile changed at `354ea1b` (158 packages removed); constants are re-derived from `e42edeb` by the generator |
| 11 | Approved entries supertest 7.3.1, superagent 10.4.1, formidable 3.5.4 with their integrity | KEEP | Every field verified against the npm registry; still the newest in-range versions; static feasibility at `e42edeb`: every transitive need is already locked at a satisfying version and no old-closure dependency becomes an orphan |
| 12 | Lockfile-metadata allowance with hard-coded `verdura-monorepo` | UPDATE | Values now derived from the baseline lockfile (`name` `verdura-monorepo`; root `package.json` name `servvia-monorepo`) |
| 13 | `connector-harness-change-bounded` pins the full sha256 of the fixed file | UPDATE | Re-designed to derive only from the baseline (line 171 must be the explicit bind; with line 171 restored the file must hash to the baseline), so no fixed file had to be produced |
| 14 | `endpoint-check.js` REQUIRED list (hand-typed, corrected later) | UPDATE | Generated from the baseline tree; the probe now observes every `net.Server` listen and every `http`/`https` request and `get`; temporary files are removed in a `finally` |
| 15 | `test-server-explicit-loopback` scans `.listen(` | UPDATE | Also catches the bracket form `['listen'](`, and `.js/.mjs/.cjs` files under `apps/api/test` |
| 16 | Forbidden surfaces: hard-coded list including `apps/kitchen-display/**`, `apps/order-tablet/**`, `apps/window-display/**` | UPDATE | Those directories no longer exist (CC-4). The list is now derived from the baseline tree: 107 globs, including every other `apps/api/test` file, every other manifest and lockfile, `.env` files, other specs, planning artifacts and this packet |
| 17 | Option A selected by the orchestrator (supertest 7 + one explicit bind; B and C rejected) | KEEP — confirm at freeze | Carried as an architecture constraint, explicitly marked for confirmation at freeze |
| 18 | Evaluator provisioning: `npm ci --ignore-scripts` from the approved lockfile (`provision.sh`, never run) | UPDATE | Rewritten with repository-relative arguments: Node 22 required; refuses before installing unless the lockfile equals the baseline's or passes the anchored dependency check; verifies the lockfile is unchanged and the runtime resolution. Validated end to end on the baseline (see EVIDENCE.md) |
| 19 | Generators `gen-fragment-1-9.mjs` / `gen-objective-1-9.mjs` (absolute session paths, `38bea30` guard, "epics.md is not edited") | SUPERSEDED | Replaced by `generator/generate.mjs`: explicit baseline input, repository-relative, fails closed, deterministic, with a `--check` mode |
| 20 | requirementRefs: "recorded only in its story spec (epics.md is not edited)" | REMOVE | Story 1.9 is in `epics.md` since Story 14.2 |
| 21 | requirementRefs to PRD sections 16, 21 and 24 | KEEP | The sections still carry those requirements in the normative PRD |
| 22 | Static negative probes (21 variants, including Option A positive control) | UPDATE | Re-run with 27 wrong variants and a no-op; no positive control (implementation not authorized). All 27 are rejected by a finding specific to them |
| 23 | "Production `npm ls --omit=dev` shows neither superagent nor formidable" (Option A tree) | UNSUPPORTED (not re-measured) | Needs a fixed tree; the dependency check pins `dev: true` on all three entries instead |
| 24 | `LIBPQ SERVICE FORM NOT APPLICABLE TO CURRENT PRISMA PATH`; Story 1.10 separate | KEEP | Unchanged; Story 1.10 remains deferred |
