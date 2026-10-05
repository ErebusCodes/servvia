# Story 15.1 evaluator provisioning

> **FREEZE CANDIDATE — NOT YET FROZEN.** These are instructions for the orchestrator's evaluation of a Story 15.1 candidate. They have no authority until the objective is frozen.

## What the evaluation needs

Story 15.1 changes no dependency. The objective forbids `package.json`, `package-lock.json`, `go.mod` and `go.sum`. The evaluator still needs three things:

- **`--node-modules`**: one `node_modules` root, linked into the candidate and baseline workspaces. It is used only by the `prisma-migrate-deploy` setup step, which builds the schema the Core tests run against.
- **`--go-root` and `--go-modcache`**: Go **1.27.1** (the `go` directive of `services/core-platform/go.mod`) and a module cache holding every module in `go.sum`. The evaluator runs Go offline: `GOFLAGS=-mod=readonly`, `GOPROXY=off`, `GOTOOLCHAIN=local`, `GOSUMDB=off`.
- **`--pg-bin` and `--redis-bin`**: PostgreSQL 18 and Redis, started disposably by the evaluator (UTC). The validation used PostgreSQL 18.4.

## Toolchain

- **Node 22** (`.nvmrc` 22; `engines` `>=22 <23`). Validated with 22.23.3.
- **npm 11.17.0** on Node 22, as decided for the repository on 2026-10-05. Obtain it with `../../story-1-9-test-harness-loopback-binding/provisioning/fetch-npm.sh`, and put its `bin` before Node 22's on `PATH`. No `packageManager` field.
- **Go 1.27.1**, with a module cache populated beforehand. `go mod download` with network access, in any checkout of the baseline, fills it. The evaluation itself never downloads.

## `provision.sh`

```
provision.sh <repo> <anchor-commit> <objective-path> <candidate-commit> <go-root> <go-modcache> <out-dir>
```

It refuses (non-zero exit and `<out-dir>/REFUSED`) unless all of the following hold:

1. Node is major 22 and npm is exactly 11.17.0.
2. `<go-root>` is go1.27.1.
3. The candidate's `package-lock.json`, `go.mod` and `go.sum` are byte-identical to the baseline's.
4. Offline `go mod verify` passes against `<go-modcache>`.
5. `npm ci --ignore-scripts` succeeds and leaves the lockfile byte-identical.

It exports the candidate with `git archive` into `<out-dir>/tree` and never touches a checkout. It prints `NODE_MODULES=<out-dir>/tree/node_modules`.

| Property | Answer |
|---|---|
| Deterministic | Yes. `npm ci` installs exactly the unchanged lockfile, verified by integrity; Go runs offline against a verified cache. |
| Mutates the repository | No. |
| Network | npm registry, unless the npm cache holds every tarball (it did on 2026-10-06). None for Go. |
| Validated | 2026-10-06, Node 22.23.3, npm 11.17.0, go1.27.1, on the disposable positive control. Lockfile, go.mod and go.sum identical to the baseline; `go mod verify`: all modules verified; lockfile sha256 `6ed14a22…cc7f1e965` unchanged. See `../evidence/EVIDENCE.md`. |

## Evaluation command (after freeze)

```bash
# PATH=<npm-11.17.0>/bin:<node22>/bin:$PATH
git -C <repo> archive <anchor> tooling/evaluator | tar -x -C <eval-dir>
provision.sh <repo> <anchor> _bmad-output/implementation-artifacts/objectives/story-15-1-core-audit-actor-attribution/v1.objective.json <candidate> <go-root> <go-modcache> <prov-dir>
node <eval-dir>/tooling/evaluator/bin/loop.mjs advance --repo <repo> --worktree <checkout> \
  --anchor-commit <anchor> --objective <objective path> --objective-sha256 <approved sha256> \
  --candidate <candidate> --node-modules <prov-dir>/tree/node_modules \
  --go-root <go-root> --go-modcache <go-modcache> \
  --pg-bin <PostgreSQL 18 bin> --redis-bin <Redis bin>
```
