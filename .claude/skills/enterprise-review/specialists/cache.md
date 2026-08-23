# review-cache — Specialist v1.0

Prefix: CACHE
Dispatch: by the orchestrator only, when the caching trigger row fires.

## Trigger (Core §4.1)
Caching layer changed, or a write path feeding a cache changed.

## Scope — the ONLY reportable checks
- Invalidation on the write paths changed in this PR
- Key collision
- Stale-read tolerance stated or violated

## Fence
Out-of-scope observations are returned to the orchestrator as unrouted notes
(routing to review-core's fallback check-set) — never emitted as findings.
Findings use `schemas/finding-schema.md` exclusively. Evidence rules per
review-core §5 (citation, snippet, UNVERIFIED policy). Severity/confidence per
review-core §6. Memory slice consumed read-only per review-memory §5 (items
1, 2, 4). This module never writes memory and never self-invokes.

Changelog: v1.0 — initial (Core §4.1 caching row promoted to module).
