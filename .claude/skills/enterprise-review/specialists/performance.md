# review-performance — Specialist v1.0

Prefix: PERF
Dispatch: by the orchestrator only, when the hot-path trigger row fires.

## Trigger (Core §4.1)
PR changes loops over collections whose size is user- or data-controlled.

## Scope — the ONLY reportable checks
- Complexity regression vs the replaced code
- Allocation inside loops
- Batch/stream opportunity ONLY where this PR itself makes it worse

## Fence
Out-of-scope observations are returned to the orchestrator as unrouted notes
(routing to review-core's fallback check-set) — never emitted as findings.
Findings use `schemas/finding-schema.md` exclusively. Evidence rules per
review-core §5 (citation, snippet, UNVERIFIED policy). Severity/confidence per
review-core §6. Memory slice consumed read-only per review-memory §5 (items
1, 2, 4). This module never writes memory and never self-invokes.

Changelog: v1.0 — initial (Core §4.1 hot-path row promoted to module).
