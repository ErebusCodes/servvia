# Story 1.9 — freeze-candidate packet

> **FREEZE CANDIDATE — NOT YET FROZEN.** Nothing in this directory has authority. Story 1.9 implementation is **not authorized**. Only the orchestrator freezes an objective (`../../objectives/README.md`). Story 1.9 stays `REWRITE — NOT FROZEN` in tracking until then; Story 1.10 stays deferred.

- **Story:** 1.9, test-harness loopback binding (`_bmad-output/planning-artifacts/epics.md`, Epic 1).
- **Objective id:** `story-1-9-test-harness-loopback-binding`, version 1.
- **Baseline:** `e42edeb3c865737e919be8c1c8bebfc4bb7f279b` (`integration/normative-prd-baseline` after Story 14.2).
- **Draft objective:** `v1.objective.json`. Its sha256 is recorded in `manifest.json` and printed by the generator.
- **Story spec:** `_bmad-output/implementation-artifacts/spec-1-9-test-harness-loopback-binding.md`, status `ready-for-dev`. Its intent-contract hash is in the objective's `inputs`.
- **Epic context:** `_bmad-output/implementation-artifacts/epic-1-context.md`, as committed at the baseline. Its sha256 is in the objective's `inputs`.

## Contents

| Path | What it is |
|---|---|
| `v1.objective.json` | The draft objective (`servvia.objective/v2`), generated |
| `manifest.json` | Packet manifest: the draft hash, the inputs, the derived baseline facts and the sha256 of every packet file and of the spec. Generated |
| `generator/generate.mjs` | Deterministic generator. Uses the explicit baseline from `inputs.json`, reads baseline facts with `git show <baseline>:…`, uses repository-relative paths and fails closed |
| `generator/inputs.json` | The only non-derivable inputs, each with provenance: identity, approved lockfile entries, measured floors, the allowed skip |
| `generator/checks/*.js` | Templates of the five Story 1.9 checks. The generator fills their constants from the baseline |
| `provisioning/` | Evaluator dependency provisioning (`provision.sh`) and its instructions |
| `evidence/EVIDENCE.md` | Defect, mechanism, baseline measurements, Node qualification, evaluator run and adversarial results |
| `evidence/DRAFT-RECONCILIATION.md` | Every claim of the paused 2026-10-05 draft, classified KEEP / UPDATE / REMOVE / UNSUPPORTED / SUPERSEDED |
| `evidence/*.js`, `evidence/*.mjs`, `evidence/*.out`, `evidence/*.txt` | The scratch experiments, the measurement runner and the adversarial probe tool, with their outputs |

## Regenerate and verify

Run under Node 22, with a `node_modules` that holds the repository-locked `js-yaml` (for example one provisioned by `provisioning/provision.sh` with npm 11.17.0):

```bash
node _bmad-output/implementation-artifacts/objective-drafts/story-1-9-test-harness-loopback-binding/generator/generate.mjs \
  --repo . --node-modules <dir> --check      # byte-identical regeneration of the draft and the manifest
node tooling/evaluator/bin/loop.mjs validate \
  --objective-file _bmad-output/implementation-artifacts/objective-drafts/story-1-9-test-harness-loopback-binding/v1.objective.json \
  --repo <a checkout whose HEAD is the baseline, with this spec on disk>
```

`loop.mjs validate` requires HEAD to be the baseline. Run it in a disposable checkout of `e42edeb` with the spec and the draft copied in, as was done for the evidence.

## Freeze procedure (orchestrator only)

1. Issue the freeze authorization; the decisions it rests on are recorded under "Freeze decisions" below.
2. On the baseline `e42edeb3c865737e919be8c1c8bebfc4bb7f279b` (the anchor's parent must be exactly that commit), commit only:
   - `v1.objective.json`, byte for byte, as `_bmad-output/implementation-artifacts/objectives/story-1-9-test-harness-loopback-binding/v1.objective.json`;
   - the story spec, byte for byte, at `_bmad-output/implementation-artifacts/spec-1-9-test-harness-loopback-binding.md`.

   The packet itself is not part of the anchor. It lives on the integration branch for review.
3. Record the anchor commit and the approved sha256. Evaluate candidates per `provisioning/README.md`: provision with npm **11.17.0** on Node 22, and launch the evaluator under **Node 22**. The evaluator records `record.environment.node`.

## Freeze decisions (orchestrator, 2026-10-05)

1. **Option A:** provisionally accepted, conditional on a positive-control PASS. Validated: see `evidence/EVIDENCE.md` section 7.
2. **Registry-derived lockfile entries:** accepted. They are now also proven in a real install: npm 11.17.0 on Node 22 produced exactly these entries.
3. **Positive control:** required before freeze. Done in a disposable clone and never published.
4. **Floors:** accepted (unit 2120, integration 378).
5. **Tooling (Tier 2):**
   - Node 22 is the runtime and evaluator engine.
   - The lockfile is authored, and dependencies are provisioned, with exactly npm 11.17.0 on Node 22 (`provisioning/fetch-npm.sh`).
   - npm 10 output is not accepted, and no version floats.
   - No `packageManager` field is added.
6. **AC-4 is structural:** only the harness's one host-less server-start expression may change, and it must become the explicit loopback bind. No source line number is part of the contract.

## TAP residual (unchanged)

The open residual stays open: the first **naturally occurring** rendered correction must establish whether the correction packet is sufficient. This preparation fabricated no implementation failure and no correction cycle. The evaluator runs here judged a no-op candidate only, outside any ledger, so no correction packet was issued.
