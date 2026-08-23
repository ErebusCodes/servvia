# review-infra — Specialist v1.0

Prefix: INFRA
Dispatch: by the orchestrator only, when the infrastructure trigger row fires.

## Trigger (Core §4.1)
Infra, IaC, CI/CD, or container files changed.

## Scope — the ONLY reportable checks
- Least-privilege IAM deltas
- Secret handling
- Rollback path
- Health/readiness probe correctness
- Deploy-order coupling with code changes in the same PR

## Fence
Out-of-scope observations are returned to the orchestrator as unrouted notes
(routing to review-core's fallback check-set) — never emitted as findings.
Findings use `schemas/finding-schema.md` exclusively. Evidence rules per
review-core §5 (citation, snippet, UNVERIFIED policy). Severity/confidence per
review-core §6. Memory slice consumed read-only per review-memory §5 (items
1, 2, 4). This module never writes memory and never self-invokes.

Changelog: v1.0 — initial (Core §4.1 infra row promoted to module).
