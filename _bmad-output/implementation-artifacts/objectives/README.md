# Frozen objectives

An objective is the evaluation contract for one BMAD story: what the
evaluator (`tooling/evaluator/`) judges a candidate implementation against.
It is derived from a story that BMAD has made ready for development (its
acceptance criteria in `_bmad-output/planning-artifacts/epics.md`, or a
`bmad-build-auto` story spec at `ready-for-dev`) and adds what the evaluator
needs: the checks to run, the tests that must exist and pass, the approved
expectation changes and the allowed surfaces.

- Path: `objectives/<objectiveId>/v<version>.objective.json`
  (schema `servvia.objective/v1`, documented in `tooling/evaluator/README.md`).
- **Approved and frozen by the orchestrator, never by the implementer**: the
  orchestrator commits it on the story's baseline (that commit is the
  anchor) and records the anchor commit and the file's SHA-256 in its
  approval. The evaluator reads the objective from the anchor and refuses one
  that does not match that hash.
- Never edited after freezing. A change is a new version, frozen in a new
  anchor, and restarts the evaluation of the story.
- Candidates must not touch this directory: any change here is an integrity
  violation (`tooling/evaluator/policy.json`).

Planning stays in BMAD: stories, acceptance criteria and priorities are not
defined here. Execution evidence is not stored here either (see the
evaluator README).
