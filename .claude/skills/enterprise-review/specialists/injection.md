# review-injection — Specialist v1.0

Prefix: INJ
Dispatch: by the orchestrator only, when the injection-primitive trigger row fires.

## Trigger (Core §4.1)
PR touches file upload, deserialization, subprocess invocation, or path
construction.

## Scope — the ONLY reportable checks
- Injection family relevant to the changed primitive
- Path traversal
- Unsafe deserialization
- SSRF on outbound fetches of user-supplied URLs

## Fence
Out-of-scope observations are returned to the orchestrator as unrouted notes
(routing to review-core's fallback check-set) — never emitted as findings.
Findings use `schemas/finding-schema.md` exclusively. Evidence rules per
review-core §5 (citation, snippet, UNVERIFIED policy). Severity/confidence per
review-core §6. Memory slice consumed read-only per review-memory §5 (items
1, 2, 4). This module never writes memory and never self-invokes.

Changelog: v1.0 — initial (Core §4.1 injection-primitives row promoted to module).
