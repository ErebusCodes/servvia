# review-api — Specialist v1.0

Prefix: API
Dispatch: by the orchestrator only, when the public-API trigger row fires.

## Trigger (Core §4.1)
Public API surface changed: routes, GraphQL schema, exported SDK symbols,
event payloads.

## Scope — the ONLY reportable checks
- Backward compatibility of the changed surface
- Versioning
- Error contract consistency with existing endpoints
- Idempotency of non-GET mutations
- Input validation at the boundary

## Fence
Out-of-scope observations are returned to the orchestrator as unrouted notes
(routing to review-core's fallback check-set) — never emitted as findings.
Findings use `schemas/finding-schema.md` exclusively. Evidence rules per
review-core §5 (citation, snippet, UNVERIFIED policy). Severity/confidence per
review-core §6. Memory slice consumed read-only per review-memory §5 (items
1, 2, 4). This module never writes memory and never self-invokes.

Changelog: v1.0 — initial (Core §4.1 public-API row promoted to module).
