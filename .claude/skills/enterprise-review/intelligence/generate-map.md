# review-intelligence / generate-map — v1.0

Produces the cached repository artifacts consumed by impact tracing (Core §3
STEP 4) and by review-drift. Runs standalone on request, or dispatched by the
orchestrator when a selected path requires artifacts that are missing (kernel
rule: never ad-hoc discovery inline; never dispatched during PATH-1).

## Outputs — written to <target repo>/.claude/review/intelligence/

| File | Contents | Cap |
|---|---|---|
| architecture.md | Modules, layers, allowed dependency directions, ownership | 200 lines |
| public-api.md | Exported surfaces: routes, schemas, events, SDK symbols | 200 lines |
| dependency-graph.md | Module-level edges (never file-level) | 150 lines |
| conventions.md | Convention candidates, each with ≥3 path citations | 100 lines |

Each artifact header records the refresh date and the commit it was built from.

## Rules

- Every statement cites repository paths. Anything unverifiable is OMITTED —
  artifacts have no UNVERIFIED section; uncertainty does not belong in a map.
- Artifacts are navigation aids, never evidence: findings must still cite
  current code (the same principle as review-memory §1 applies).
- Refresh triggers: dependency manifest change, top-level module added or
  removed, 20 reviews since last refresh, or explicit request.
- A refresh replaces artifacts wholesale; no incremental edits. Convention
  invalidations discovered during refresh are proposed to the orchestrator
  for the memory transaction (review-memory §4) — this module never writes
  memory.json itself.

---
Changelog: v1.0 — initial.
