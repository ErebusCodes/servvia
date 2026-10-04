# Frozen objectives

An objective is the evaluation contract for one BMAD story: what the
evaluator (`tooling/evaluator/`) judges a candidate implementation against.
It is derived from a story that BMAD has made ready for development (its
acceptance criteria in `_bmad-output/planning-artifacts/epics.md`, or a
`bmad-build-auto` story spec at `ready-for-dev`) and adds what the evaluator
needs: the checks to run, the tests that must exist and pass, the approved
expectation changes and the allowed surfaces.

- Ids: `story-<epic>-<story>-<slug>` (`story-12-5-kiosk-off-in-production`,
  `story-12-3a-core-database-timeouts` for an orchestrator-scoped slice): the
  same id names the draft, the frozen objective, its ledger and evidence.
- Drafts: `objective-drafts/<objectiveId>/v<version>.objective.json`, written
  and validated by `bmad-build-auto` (`loop.mjs validate`, which reports
  `OBJECTIVE READY FOR FREEZE` and the SHA-256). A draft has no authority,
  and carries no approval text (schema `servvia.objective/v2`, documented in
  `tooling/evaluator/README.md`).
- Frozen: `objectives/<objectiveId>/v<version>.objective.json`.

## Lifecycle

1. **Epic context, once per epic.** `epic-<N>-context.md` is compiled once,
   outside story runs, and committed to the line the stories start from. It
   is canonical and immutable: story runs load it and never regenerate or
   rewrite it, and a candidate that changes it is an integrity violation. A
   change is a new commit made deliberately, after which open drafts are
   re-planned.
2. **Planning (no anchor).** `bmad-build-auto` plans the story to
   `ready-for-dev`, drafts the objective from the spec and the committed epic
   context (`inputs`: the spec's intent-contract hash, the context's hash),
   validates it and halts with status `ready-for-dev` and the condition
   `waiting-for-objective-approval`. That is not a blocked or failed story.
   The run commits nothing; the spec and the draft are left on disk.
3. **Freeze (orchestrator only).** The orchestrator approves a specific draft
   by its SHA-256 and, on the draft's `baseline` (its parent must be exactly
   that commit), commits:
   - the draft, byte for byte, as `objectives/<objectiveId>/v<version>.objective.json`;
   - the story spec, as the planning run left it (status `ready-for-dev`).

   Nothing else. That commit is the anchor; the orchestrator records it with
   the hash. Everything the implementation needs (spec, epic context,
   objective) is then in one clean, reproducible commit.
4. **Implementation (anchored).** A run invoked with
   `objective_anchor: commit=<anchor> path=<objective> sha256=<hex>` and the
   spec path starts from a clean checkout of the anchor. `loop.mjs gate`
   opens only if the anchor holds the approved objective and the same inputs;
   step 1 resumes the `ready-for-dev` spec.

- Never edited after freezing. A change is a new version, frozen in a new
  anchor, and restarts the evaluation of the story.
- Candidates must not touch this directory: any change here is an integrity
  violation (`tooling/evaluator/policy.json`).

Planning stays in BMAD: stories, acceptance criteria and priorities are not
defined here. Execution evidence is not stored here either (see the
evaluator README).
