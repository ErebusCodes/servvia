# Story 1.9 evaluator provisioning

> **FREEZE CANDIDATE — NOT YET FROZEN.** These are instructions for the orchestrator's evaluation of a Story 1.9 candidate. They have no authority until the objective is frozen.

## Why provisioning is needed

The evaluator links one operator-supplied `node_modules` root into the candidate and baseline workspaces (`--node-modules`). It never installs the candidate's lockfile.

Story 1.9 changes the dev dependency `supertest`, so the evaluated dependencies must be the **candidate's**. The installation must not bring in anything the objective has not approved.

## Toolchain (Tier-2 tooling decision, 2026-10-05)

- **Runtime and evaluator:** Node 22 (`.nvmrc` 22; `engines` `>=22 <23`). Validated with Node 22.23.3.
- **Lockfile authoring and provisioning:** exactly **npm 11.17.0** running on Node 22. Tarball `https://registry.npmjs.org/npm/-/npm-11.17.0.tgz`, integrity `sha512-PurxiZexEHDTE4SSaLI3ZrnbAGiZfeyUcQcxcP5D+hfytNAze/D1IzDuInTn9XVLIbAQUnQuSPXJx02LHjLvQw==`, engines `^20.17.0 || >=22.9.0`. The registry publishes a signature for it; no provenance attestation is published. Only the sha512 integrity is verified here.
- **Not accepted:**
  - Node 22's bundled npm 10.9.9. It nests the supertest, superagent and formidable lockfile entries under `apps/api/node_modules` and drops `libc` from 22 unrelated platform entries, which widens the lockfile delta.
  - Any floating npm version.
- **Scope:** this is a Story 1.9 constraint, not a repository package-manager migration. No `packageManager` field is added.

`fetch-npm.sh <dir>` obtains npm 11.17.0:
1. It requires Node 22 and downloads the exact tarball.
2. It refuses unless the sha512 matches.
3. It extracts the tarball and writes `<dir>/bin/npm`, a wrapper that runs the verified `npm-cli.js` with the `node` on `PATH`.

Put `<dir>/bin` **before** the Node 22 bin directory on `PATH`. Node 22's own bin directory carries npm 10, which must not win:

```bash
PATH=<dir>/bin:<node22>/bin:$PATH   # node v22.x, npm 11.17.0 (running on Node 22)
```

## What `provision.sh` does

```
provision.sh <repo> <anchor-commit> <objective-path> <candidate-commit> <out-dir>
```

1. **Toolchain.** Requires Node **22**, the repository-pinned engine (`.nvmrc` 22; `engines` `>=22 <23` in the root and `apps/api` manifests; CI's `setup-node` reads `.nvmrc`). It also requires `npm --version` to be exactly **11.17.0**, running on Node 22. Anything else is refused before any work.
2. **Export.** Exports the candidate with `git archive` into `<out-dir>/tree`, a new directory. The repository and its checkouts are never touched.
3. **Dependency gate before installation.** The candidate's `package-lock.json` must either:
   - be byte-identical to the baseline's; or
   - pass the **anchored** objective's `supertest-dependency-delta` check (the script is taken from the anchor commit, never from the candidate).

   Otherwise nothing is installed and the script fails.
4. **Install.** Runs `npm ci --ignore-scripts --no-audit --no-fund`. Install scripts never run, and the evaluator's `prisma-generate` setup step generates the Prisma client. The script then checks that `package-lock.json` is unchanged.
5. **Runtime check.** Runs the anchored `supertest-runtime-resolution` check on the installed tree.
6. **Output.** Prints `NODE_MODULES=<out-dir>/tree/node_modules` for `--node-modules`.

On any refusal it exits non-zero and writes `<out-dir>/REFUSED`. That directory must never be used.

| Property | Answer |
|---|---|
| Deterministic | Yes. `npm ci` installs exactly the lockfile, and every tarball is verified against its lockfile integrity. |
| Mutates the candidate repository | No. It works only in `<out-dir>` and leaves the lockfile byte-identical. |
| Network | Needs the npm registry unless the npm cache already holds every tarball. On 2026-10-05 the baseline installed from the local cache. |
| Safe for evaluation | Yes. No install scripts run, and an unapproved dependency change is refused before installation. |
| Versions pinned | Yes, by the lockfile, and for Story 1.9's delta by the objective's exact entries. |
| Validated | Yes, on 2026-10-05, under Node 22.23.3 / npm 11.17.0, on the disposable positive-control candidate (the "differs from the baseline" path). The anchored dependency check passed before install; `npm ci` succeeded; the lockfile was unchanged (sha256 `6ed14a22…cc7f1e965`); runtime resolution was supertest 7.3.1, superagent 10.4.1 and formidable 3.5.4. npm 10.9.9 is refused. Earlier, the baseline path was validated under npm 10.9.9. See `../evidence/EVIDENCE.md`. |

## Evaluation command (after freeze)

```bash
# Toolchain: PATH=<npm-11.17.0 dir>/bin:<node22>/bin:$PATH  (fetch-npm.sh)
# From an export of the anchor commit (so the evaluator is the frozen one), under Node 22:
git -C <repo> archive <anchor> tooling/evaluator | tar -x -C <eval-dir>
provision.sh <repo> <anchor> _bmad-output/implementation-artifacts/objectives/story-1-9-test-harness-loopback-binding/v1.objective.json <candidate> <prov-dir>
node <eval-dir>/tooling/evaluator/bin/loop.mjs advance --repo <repo> --worktree <checkout> \
  --anchor-commit <anchor> --objective <objective path> --objective-sha256 <approved sha256> \
  --candidate <candidate> --node-modules <prov-dir>/tree/node_modules \
  --pg-bin <PostgreSQL 18 bin> --redis-bin <Redis bin>
```

Provision once per candidate: a correction candidate may carry a different lockfile.
