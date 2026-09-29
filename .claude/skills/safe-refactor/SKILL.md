# Claude Code Task: Safe Codebase Refactoring — Execution Protocol

You are performing a production-grade structural cleanup of this codebase. This document is an **operational protocol**, not a goal statement. Follow the phases in order. Do not skip gates. Do not reorder phases.

---

## 1. Mission & Non-Negotiable Constraints

Improve maintainability, naming, organization, and consistency with **zero functional change**.

Invariants (violating any of these is task failure regardless of how clean the code becomes):

- Identical runtime behavior, UI appearance, and UX flow
- Identical public API surface (exported symbols consumed outside this repo, HTTP routes, webhook handlers, CLI entry points)
- Identical routing (URLs, route params, redirects)
- Identical configuration behavior (env var names, config keys, build output paths)
- No new frameworks, no rewrites, no dependency additions or upgrades
- No broken imports, references, or tests at any commit boundary

**Suspected bugs:** never fix business logic, even "obvious" bugs. Tag with `TODO(refactor): suspected bug — <one-line description>` and include in the final report under Deferred Findings. Judgment calls about what is "obviously" broken are exactly where regressions originate.

When uncertain at any decision point: take the conservative option, tag with `TODO(refactor):`, report, and move on.

---

## 2. Phase −1 — Preconditions & Baseline (MANDATORY, before any analysis)

1. Verify the working tree is clean (`git status`). If dirty: **STOP** and report. Do not stash or commit user work.
2. Create and switch to a dedicated branch: `refactor/structural-cleanup-<YYYYMMDD>`.
3. Detect and record the project's canonical commands (from `package.json` scripts, CI config, or README): install, build, typecheck, lint, unit tests, integration tests.
4. Run the full validation suite **before touching anything** and record verbatim output to `docs/refactors/baseline.md`:
   - build result
   - typecheck result
   - lint result (error/warning counts)
   - test results (pass/fail/skip counts, names of any failing tests)
5. Pre-existing failures are recorded as the baseline. The gate standard for every later phase is: **no regression versus baseline** — not "everything green." Never attempt to fix pre-existing failures; they are out of scope.

**No-test fallback:** if the repo has no test suite or coverage is absent for large areas, record this in the baseline. The fallback verification standard for affected code is: build passes + typecheck passes + route/page inventory unchanged (see Phase 0 output #4). In fallback areas, Tier 2b work (extractions) is prohibited — downgrade to propose-only.

---

## 3. Phase 0 — Read-Only Audit & Plan

No file modifications in this phase. Produce `docs/refactors/plan.md` containing:

1. **Framework & tooling detection:** framework(s) (Next.js/Remix/Vite/CRA/Express/etc.), router type (file-based vs. code-based), package manager, TS or JS, formatter/linter config presence, monorepo/workspace layout if any.
2. **Frozen-path inventory** (see §5) — explicit list of files and directories that must never be renamed or moved, with the reason each is frozen.
3. **Architecture map:** top-level module inventory, dependency direction between major areas, entry points, shared code locations. Keep this to one page — it exists for impact tracing, not documentation polish.
4. **Route/page inventory:** every URL/route the app serves and the file that owns it. This list must be byte-identical at the end of the task.
5. **Proposed changes, pre-classified by tier** (see §4), each with: target path(s), action, tier, and evidence status.
6. **Explicitly deferred items:** every Tier 3 candidate, listed with rationale.

Commit the plan as the first commit. All subsequent work must trace to a plan entry; if new work is discovered mid-execution, append it to the plan in the same commit that implements it.

---

## 4. Risk Classification

Every change belongs to exactly one tier. When a change spans tiers, it takes the highest tier involved.

**Tier 1 — Mechanical, tool-verified (auto-apply)**
- Formatting via the repo's existing formatter config only (never hand-format; if no formatter config exists, skip formatting entirely — do not introduce one)
- `eslint --fix` using existing config only
- Import sorting/deduplication via tooling
- Removal of unused imports **flagged by the compiler or linter** (not by your own reading)

**Tier 2a — Verifiable refactors (apply with per-batch gates)**
- Symbol renames (functions, variables, types) via LSP-style rename or codemod — never regex find/replace across strings; verify no string-literal references (dynamic keys, serialization, logging contracts) before renaming
- File renames and moves of non-frozen files, with all imports updated
- Folder restructuring of non-frozen directories
- Dead code removal that passes the full Evidence Standard (§6)

**Tier 2b — Structural extractions (apply only with test coverage)**
- Splitting large components/modules
- Extracting shared utilities/hooks from duplicated logic
- Precondition: the affected code paths have existing test coverage that exercises them. No coverage → downgrade to Tier 3 (propose only). Do not write new tests to unlock this tier — that expands scope.

**Tier 3 — Behavior-adjacent (NEVER apply; report only)**
- Memoization (`useMemo`, `React.memo`, `useCallback`) — changes referential identity, therefore behavior
- Lazy loading / code splitting — changes load timing
- Any change to rendering logic, state management, async flow, effects, or event handling
- Any routing change
- Type changes that alter runtime behavior (e.g., changed default values, narrowed runtime checks)
- Performance "optimizations" of any kind
- Dependency changes

Tier 3 items go in the final report under Deferred Recommendations with rationale and estimated effort (S/M/L/XL).

**TypeScript improvements** (replacing `any`, tightening interfaces): Tier 2a, with the constraint that emitted JavaScript must be unchanged — type-only edits only. If tightening a type requires touching runtime code, defer to Tier 3.

---

## 5. Frozen Paths (Framework Awareness)

Never rename, move, or delete, regardless of how "unclear" the name looks:

- File-router directories and their contents: `pages/`, `app/`, `api/`, `routes/`
- Convention files: `layout.*`, `page.*`, `route.*`, `loading.*`, `error.*`, `not-found.*`, `middleware.*`, `index.*` where the framework resolves it, `_app.*`, `_document.*`
- All configuration: `*.config.*`, `.env*`, `tsconfig*`, lockfiles, `.eslintrc*`, `.prettierrc*`
- CI/CD: Dockerfiles, compose files, deploy configs
- Database migrations, seeds, generated schema/client code
- Anything referenced by string path in configs, scripts, CI, or `package.json`
- Public assets referenced by URL

If a frozen file's *contents* need Tier 1/2 internal cleanup, that is allowed — the freeze applies to name, path, and existence.

---

## 6. Evidence Standard for Deletion

"Unused" is a claim requiring evidence, not an impression. Before deleting any file, export, or component, ALL of the following must pass:

1. **Reference search:** project-wide search for the symbol name and the file path (including extension-less and aliased forms) returns zero non-self references.
2. **Dynamic reference check:** search for the name as a string literal — dynamic `import()`, `require()` with variables, registry/plugin maps, `lazy()` calls, template strings that could resolve to the path.
3. **Config/tooling check:** not referenced in any config, CI file, script, or `package.json` field.
4. **Framework check:** not a convention-bound file (§5) and not auto-registered by the framework (file routes, API handlers, middleware, migrations).
5. **Export surface check:** not re-exported through a barrel file or package entry point that external consumers could import.

Log the result of all five checks per deletion in `docs/refactors/deletions.md`. If **any** check is ambiguous or cannot be completed, do not delete — tag the file with `TODO(refactor): candidate for removal — <which check was inconclusive>` and list it in the report.

---

## 7. Execution Phases & Validation Gates

**Gate (run after every phase, and after every batch within Phases 3–5):**
build → typecheck → lint → tests. Standard: no regression versus the Phase −1 baseline.

**Gate failure protocol:** stop immediately → `git checkout` / revert the current phase's uncommitted work (or `git revert` the phase commit if already committed) → record the failure verbatim in the report → retry once with the cause fixed → if the same phase fails its gate twice, abandon that phase permanently, record it as Deferred, and continue to the next phase.

| Phase | Work | Commit message | Notes |
|---|---|---|---|
| 1 | Tier 1 mechanical cleanup | `chore(refactor): tool-driven formatting and import cleanup` | One commit. No hand edits. |
| 2 | Symbol renames (Tier 2a) | `refactor: rename symbols for clarity (batch N)` | Batch by module. Gate per batch. |
| 3 | File/folder moves & renames (Tier 2a) | `refactor: restructure <area> (batch N)` | Only after Phase 2 is fully green. Gate per batch. Re-verify route inventory after each batch. |
| 4 | Dead code removal (Tier 2a + §6 evidence) | `refactor: remove verified dead code (batch N)` | Evidence log updated in the same commit. |
| 5 | Extractions (Tier 2b) | `refactor: extract <utility/hook> from <source>` | One extraction per commit. Coverage precondition per §4. |
| 6 | Report | `docs: refactor final report` | See §8. |

Every commit must build independently. Never mix tiers or phases in one commit. Small and boring beats large and impressive.

**Scope control:** if the repository is too large to complete all phases within the session, complete phases in order and stop cleanly at a gate boundary — a finished Phase 2 with a green gate is a valid stopping point; a half-finished Phase 3 is not. Record the stopping point and remaining plan items in the report.

---

## 8. Final Report — `docs/refactors/final-report.md`

Structured sections, evidence-cited with file paths throughout. Label anything not directly verified as UNVERIFIED.

1. **Status line:** builds / typechecks / lints / tests versus baseline (verbatim final gate output).
2. **Architecture overview:** before/after structure, one page max.
3. **Change inventory:** files renamed (old → new), files moved, symbols renamed (with reference counts updated), files deleted (link each to its §6 evidence entry).
4. **Validation log:** gate results per phase/batch, including any failures and how they were resolved or abandoned.
5. **Deferred recommendations:** every Tier 3 item and every downgraded/abandoned item, each with rationale and S/M/L/XL effort estimate.
6. **`TODO(refactor):` index:** every tag added, with file path and line.
7. **Explicitly not done:** plan items skipped, with reasons.

---

## 9. Stop Conditions (halt the entire task, revert to last green commit, report)

- The same phase fails its gate twice (per §7 — abandon phase, not task, unless it is Phase 1)
- A change cannot be verified without guessing about runtime behavior
- The route/page inventory (Phase 0, item 4) differs at any gate
- Frozen-path modification turns out to be required to proceed
- Baseline commands cannot be determined or executed

Stopping early with a clean, gated, partial result is success. A completed task with an unverifiable diff is failure.
