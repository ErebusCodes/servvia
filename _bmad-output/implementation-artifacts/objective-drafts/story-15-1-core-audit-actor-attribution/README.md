# Story 15.1 freeze-candidate packet

> **FREEZE CANDIDATE — NOT YET FROZEN.** Prepared 2026-10-06. This packet has no authority. The orchestrator alone freezes an objective (`../../objectives/README.md`). Story 15.1 implementation is **not authorized**.

Story 15.1: Core audit records the real actor class, and the device a staff action was taken on.

| Item | Value |
|---|---|
| Baseline | `5d5772d8ad172a6374beb5892a22a389ac34c8af` (the Story 15.1 planning correction on `integration/normative-prd-baseline`; Core, Prisma, Nest, contracts and evaluator trees identical to `6526159`) |
| Draft objective | `v1.objective.json` (sha256 in `manifest.json`) |
| Story spec | `_bmad-output/implementation-artifacts/spec-15-1-core-audit-actor-attribution.md` (its `<intent-contract>` is hash-bound) |
| Epic context | `_bmad-output/implementation-artifacts/epic-15-context.md` (sha256-bound; it exists on the baseline) |
| Generator | `generator/generate.mjs` + `generator/inputs.json` + `generator/checks/` |
| Provisioning | `provisioning/README.md`, `provisioning/provision.sh` |
| Evidence | `evidence/EVIDENCE.md` |

## Contents

- `generator/inputs.json`: the explicit baseline, where the floor was measured, and the few non-derivable inputs (writer matrix, required tests, evaluator-owned test names, floor, toolchain), with provenance.
- `generator/generate.mjs`: builds `v1.objective.json` and `manifest.json` deterministically. Facts come from the baseline commit (`git show`, `git grep`, `git ls-tree`), never a working tree. It fails closed on any violated precondition (for example, the baseline's AuditLog writers differ from the declared matrix, the audit package already exists, or the actor-shape migration has changed). `--check` regenerates and requires byte identity.
- `generator/checks/writer-coverage.js`: the `audit-writer-single-path` check.
- `generator/checks/attribution-blackbox.js` with `attribution_routes_test.go.txt` and `attribution_model_test.go.txt`: the `audit-attribution-routes` and `audit-actor-model` checks. Each places the evaluator-owned Go test in the candidate, runs it and removes it.
- `evidence/`: the writer matrix, schema verification, the payment-adapter and 15.2c conclusions, the baseline measurement, the controls, the adversarial probes and determinism.

## Regenerate

```bash
node _bmad-output/implementation-artifacts/objective-drafts/story-15-1-core-audit-actor-attribution/generator/generate.mjs --repo <repository root> [--check]
```

Run it under Node 22. `tooling/evaluator` in the working tree must equal the baseline's.

## Freeze (orchestrator only)

A freeze commit whose first parent is exactly the baseline and that contains only:

- `_bmad-output/implementation-artifacts/objectives/story-15-1-core-audit-actor-attribution/v1.objective.json` (byte-identical to this draft);
- the story spec, with its intent contract unchanged.

The epic context is already on the baseline. Evaluation then follows `provisioning/README.md`.
