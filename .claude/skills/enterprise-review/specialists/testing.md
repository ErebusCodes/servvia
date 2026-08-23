# review-testing — Specialist v1.0

Prefix: TEST
Dispatch: by the orchestrator only, on PATH-2 and PATH-3 (registry rule).
There is no trigger row; this module deepens the baseline test checks and
Core's Test Assessment when review effort is escalated.

## Scope — the ONLY reportable checks
- Missing tests on changed risky logic (emitted at MEDIUM per Core §6)
- Failure-case and edge-input coverage of the changed functions
- Assertions weakened or tests skipped relative to base (escalating the
  baseline detection with specifics)
- Mocks that mask the changed behavior under test

## Assembly rule
On paths where this module is dispatched, its 2–4 sentence summary (with the
single most important missing test, sized S/M/L/XL) supersedes review-core's
Test Assessment section; the orchestrator uses it at assembly.

## Fence
Out-of-scope observations are returned to the orchestrator as unrouted notes
(routing to review-core's fallback check-set) — never emitted as findings.
Findings use `schemas/finding-schema.md` exclusively. Evidence rules per
review-core §5 (citation, snippet, UNVERIFIED policy). Severity/confidence per
review-core §6. Memory slice consumed read-only per review-memory §5 (items
1, 2, 4). This module never writes memory and never self-invokes.

Changelog: v1.0 — initial.
