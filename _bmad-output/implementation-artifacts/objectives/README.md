# Frozen objectives

An objective is the evaluation contract for one BMAD story: what the
evaluator (`tooling/evaluator/`) judges a candidate implementation against.
It is derived from a story that BMAD has made ready for development (its
acceptance criteria in `_bmad-output/planning-artifacts/epics.md`, or a
`bmad-build-auto` story spec at `ready-for-dev`) and adds what the evaluator
needs: the checks to run, the tests that must exist and pass, the approved
expectation changes and the allowed surfaces.

- Drafts: `objective-drafts/<objectiveId>/v<version>.objective.json`, written
  and validated by `bmad-build-auto` (`loop.mjs validate`, which reports
  `OBJECTIVE READY FOR FREEZE` and the SHA-256). A draft has no authority.
- Frozen: `objectives/<objectiveId>/v<version>.objective.json`
  (schema `servvia.objective/v1`, documented in `tooling/evaluator/README.md`).
- **Approved and frozen by the orchestrator, never by the implementer**: the
  orchestrator approves a specific draft by its SHA-256. The draft is then
  committed unchanged on the story's baseline, only on the orchestrator's
  explicit instruction naming that SHA-256 (that commit is the anchor), and
  the orchestrator records the anchor commit with the hash. The evaluator
  reads the objective from the anchor and refuses one that does not match the
  approved hash, so an objective the implementer wrote or changed itself never
  matches the orchestrator's record.
- Never edited after freezing. A change is a new version, frozen in a new
  anchor, and restarts the evaluation of the story.
- Candidates must not touch this directory: any change here is an integrity
  violation (`tooling/evaluator/policy.json`).

Planning stays in BMAD: stories, acceptance criteria and priorities are not
defined here. Execution evidence is not stored here either (see the
evaluator README).
