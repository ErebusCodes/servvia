# Finding Schema v1.0 — the only finding format in this system

Every module that emits findings (review-core, every specialist) emits ONLY
this structure. review-merge rejects anything else. review-validator operates
on these fields. No module may add, drop, or rename fields; extensions require
a schema version bump here, nowhere else.

```json
{
  "id": "SEC-003",                          // {MODULE-PREFIX}-{seq}
  "title": "",
  "severity": "CRITICAL|HIGH|MEDIUM|LOW",   // per review-core §6
  "confidence": "HIGH|MEDIUM|LOW",          // per review-core §6
  "category": "matrix-row-id",              // e.g. "auth", "migration"
  "files": [{"path": "", "lines": "41-44"}],
  "snippet": "",                            // ≤3 lines, verbatim, post-change
  "issue": "",                              // ≤3 sentences
  "failure_scenario": "",                   // REQUIRED for CRITICAL/HIGH
  "fix": "",                                // code preferred over prose
  "source_module": "review-security",
  "dedup_key": "src/auth/session.ts|auth|0" // computed, see below
}
```

## dedup_key (computed, never authored)

```
dedup_key = primary_file_path + "|" + category + "|" + floor(start_line / 50)
```

Properties this must preserve, in priority order:
1. Two modules flagging the same defect at the same location produce the SAME
   key (dedup is set arithmetic, not prose similarity).
2. The key survives small line drift between review rounds (the /50 bucket).
3. The key joins across systems: findings ↔ memory entries ↔ suppressions ↔
   false-positive candidates all match on it.

## Module prefixes (id namespace)

CORE, SEC (auth), INJ (injection primitives), API, DB (database+migration),
PERF, CONC, CACHE, INFRA, TEST, DRIFT. One prefix per specialist file;
registered here so ids never collide at merge.

## Severity/confidence coupling (pointer, not restatement)

The rules binding severity to confidence and to failure scenarios live in
review-core §6 and are enforced by the validator. This schema only carries
the values.

---
Changelog: v1.0 — initial (extracted from review-orchestrator v1.0 §3).
