# review-database — Specialist v1.0

Prefix: DB
Dispatch: by the orchestrator only, when the database trigger row fires.
Covers migrations; there is no separate migration module.

## Trigger (Core §4.1)
SQL, ORM models/queries, or migration files changed.

## Scope — the ONLY reportable checks
- Transaction boundaries
- Isolation assumptions
- Index coverage for new query shapes
- Migration reversibility
- Lock duration on large tables
- N+1 introduced at call sites of changed queries

## Fence
Out-of-scope observations are returned to the orchestrator as unrouted notes
(routing to review-core's fallback check-set) — never emitted as findings.
Findings use `schemas/finding-schema.md` exclusively. Evidence rules per
review-core §5 (citation, snippet, UNVERIFIED policy). Severity/confidence per
review-core §6. Memory slice consumed read-only per review-memory §5 (items
1, 2, 4). This module never writes memory and never self-invokes.

Changelog: v1.0 — initial (Core §4.1 database/migration row promoted to module).
