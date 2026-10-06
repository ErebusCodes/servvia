# Story 20.3 freeze-candidate packet

> **FREEZE CANDIDATE — NOT YET FROZEN.** Prepared 2026-10-06. This packet has no authority. The orchestrator alone freezes an objective (`../../objectives/README.md`). Story 20.3 implementation is **not authorized**.

Story 20.3 (AIL-5): engineering-program telemetry and retrospective feedback.

| Item | Value |
|---|---|
| Baseline | `cc831dc629bba3b596287decce147080bf9f7f75` (the Story 20.3 refinement and Epic 20 context on `integration/normative-prd-baseline`, after the accepted program revision 2, `7f21624`) |
| Draft objective | `v1.objective.json` (sha256 in `manifest.json`) |
| Story spec | `_bmad-output/implementation-artifacts/spec-20-3-program-telemetry.md` (its `<intent-contract>` fixes the CLI, event and summary contract and is hash-bound) |
| Epic context | `_bmad-output/implementation-artifacts/epic-20-context.md` (sha256-bound; on the baseline) |
| Generator | `generator/generate.mjs`, `generator/inputs.json`, `generator/history.json`, `generator/checks/` |
| Provisioning | `provisioning/README.md` |
| Evidence | `evidence/EVIDENCE.md` |

## Contents

- **`generator/inputs.json`:** the baseline and the non-derivable inputs: the required-test names, the allowed Node built-ins and the evaluator self-test floor.
- **`generator/history.json`:** the seven governed stories' ledger facts. They were read once from their chain-verified ledgers and SHA-256-checked records; the ledger integrity hashes are kept as provenance.
- **`generator/generate.mjs`:**
  - computes each historical story's expected backfill (events and summary metrics) from git objects at the baseline and from `history.json`;
  - writes the objective and the manifest deterministically;
  - `--check` requires byte identity.
- **`generator/checks/telemetry-contract.js`:** the evaluator-owned black-box contract test, run against fixture repositories and ledgers in a temporary directory.
- **`generator/checks/telemetry-boundaries.js`:** the static privacy and isolation boundary.
- **`generator/checks/telemetry-backfill.js`:** the committed log against the fixed historical facts.

## Regenerate

```bash
node _bmad-output/implementation-artifacts/objective-drafts/story-20-3-program-telemetry/generator/generate.mjs --repo <repository root> [--check]
```

## Freeze (orchestrator only)

A commit whose first parent is exactly the baseline, containing only the draft objective (byte-identical) as `_bmad-output/implementation-artifacts/objectives/story-20-3-program-telemetry/v1.objective.json`, plus the story spec. The epic context is already on the baseline.
