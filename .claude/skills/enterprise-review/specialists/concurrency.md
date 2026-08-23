# review-concurrency — Specialist v1.0

Prefix: CONC
Dispatch: by the orchestrator only, when the concurrency trigger row fires.

## Trigger (Core §4.1)
Async, concurrent, or parallel code changed.

## Scope — the ONLY reportable checks
- Unawaited promises
- Shared mutable state
- Cancellation and timeout propagation
- Resource cleanup on all exit paths
- Retry storms

## Fence
Out-of-scope observations are returned to the orchestrator as unrouted notes
(routing to review-core's fallback check-set) — never emitted as findings.
Findings use `schemas/finding-schema.md` exclusively. Evidence rules per
review-core §5 (citation, snippet, UNVERIFIED policy). Severity/confidence per
review-core §6. Memory slice consumed read-only per review-memory §5 (items
1, 2, 4). This module never writes memory and never self-invokes.

Changelog: v1.0 — initial (Core §4.1 async/concurrency row promoted to module).
