# review-drift — Specialist v1.0

Prefix: DRIFT
Dispatch: by the orchestrator only, on PATH-3 or explicit request.
Hard requirement: intelligence artifacts (architecture.md, dependency-graph.md).
If absent, this module does not run; the orchestrator either dispatches
generate-map first or records one Verification Request — never silent skip
(kernel rule).

## Scope — the ONLY reportable checks
- New dependency cycles introduced by this PR (against dependency-graph.md)
- Imports crossing layer boundaries declared in architecture.md
- Duplicated abstraction: new code re-implementing a mapped module's
  responsibility
- Boundary erosion: reaching into another module's internals rather than its
  public surface

## Evidence rule (stricter than base)
Every finding cites BOTH the current code (Core §5) and the specific map entry
it violates. Because the map can be stale: severity caps at HIGH, and
confidence caps at MEDIUM whenever the map is older than 20 reviews.

## Fence
Out-of-scope observations are returned to the orchestrator as unrouted notes —
never emitted as findings. Findings use `schemas/finding-schema.md`
exclusively. Severity/confidence per review-core §6. Memory slice consumed
read-only per review-memory §5 (items 1, 2, 4). This module never writes
memory and never self-invokes.

---
Changelog: v1.0 — initial.
