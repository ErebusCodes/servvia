# review-auth — Specialist v1.0

Prefix: SEC
Dispatch: by the orchestrator only, when the auth trigger row fires.

## Trigger (Core §4.1)
Authentication, session, token, or permission code changed in the PR.

## Scope — the ONLY reportable checks
- Authentication vs authorization confusion
- Privilege escalation paths
- Token validation completeness (signature, expiry, audience)
- Session fixation
- Authorization checks present on EVERY new endpoint, not just the featured one

## Fence
Out-of-scope observations are returned to the orchestrator as unrouted notes
(routing to review-core's fallback check-set) — never emitted as findings.
Findings use `schemas/finding-schema.md` exclusively. Evidence rules per
review-core §5 (citation, snippet, UNVERIFIED policy). Severity/confidence per
review-core §6. Memory slice consumed read-only per review-memory §5 (items
1, 2, 4). This module never writes memory and never self-invokes.

Changelog: v1.0 — initial (Core §4.1 auth row promoted to module).
