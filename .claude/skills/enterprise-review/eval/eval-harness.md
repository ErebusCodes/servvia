# Eval Harness — v1.0

The verification instrument for the review system. Component version bumps are
gated on this: no component releases without a passing run. This spec defines
what a fixture is, what ground truth looks like, and what "passing" means.

Design principle: the harness tests the system's CONTRACTS (verdict, blocker
set, dedup keys, routing path, memory transactions), never its prose. Wording
is free to vary between runs; contracts are not.

---

## 1. LAYOUT

```
eval/
├── fixtures/
│   └── <fixture-name>/
│       ├── tree/                 # minimal repo state (only files the review needs)
│       ├── pr.md                 # title, description, linked-issue text
│       ├── pr.diff               # the diff under review
│       ├── policy.md             # optional REVIEW_POLICY.md for this fixture
│       ├── memory.json           # optional pre-seeded memory
│       └── expected.json         # ground truth (§2)
└── ledger.md                     # one row per run: date, component versions,
                                  # fixture results, pass/fail
```

Fixtures are frozen. Editing a fixture's tree, diff, or expected.json is a
fixture version bump, recorded in the ledger. Never tune a fixture to make a
failing component pass; decide explicitly which one is wrong and record why.

---

## 2. GROUND TRUTH FORMAT

```json
{
  "expected_path": "PATH-2",
  "expected_verdict": "BLOCKED",
  "blocker_dedup_keys": ["src/auth/session.ts|auth|0"],
  "must_find_top3": ["src/auth/session.ts|auth|0"],
  "must_find_anywhere": ["src/db/migrate_004.sql|migration|0"],
  "must_not_find": ["src/utils/format.ts|*|*"],
  "max_findings": 6,
  "memory_assertions": {
    "must_suppress": [],
    "must_reference_not_rerarge": [],
    "post_run_status": {"SEC-003": "open"}
  }
}
```

Keys are dedup_keys (schema §dedup_key), which is why they are stable across
runs and across wording. `must_not_find` supports wildcards on category and
bucket to express "nothing at all about this file."

---

## 3. STARTER FIXTURE SET (build these five first)

| Fixture | Purpose | Core assertions |
|---|---|---|
| `clean-refactor` | False-positive budget | PATH-1, APPROVE, findings ≤ 1, empty blocker set |
| `planted-auth-bug` | Detection + routing | PATH-2 (auth trigger), BLOCKED, bug's dedup_key in top-3 |
| `unsafe-migration` | DB check-set + severity coupling | migration finding present with concrete failure scenario; verdict APPROVE-WITH-FIXES or BLOCKED per planted severity |
| `oversized-cross-cutting` | PATH-3 routing + merge + caps | PATH-3 selected, ≤10 findings emitted, no duplicate dedup_keys in output |
| `memory-round-2` | Persistence behavior | Pre-seeded memory with one `open` and one `wontfix` entry on touched paths; open finding referenced in one line, wontfix not re-emitted, post-run memory.json parses and contains exactly one new review_log entry |

Fixtures should be derived from real PRs (yours: Verdura/ShiftPilot history is
the best source — bugs that actually shipped make the truest `must_find`
entries), sanitized of secrets before freezing.

---

## 4. PASS CRITERIA

A fixture passes when ALL hold:
1. Routing: selected path == expected_path.
2. Verdict: exact match.
3. Blockers: emitted blocker dedup_key set == expected set (order-free).
4. Detection: every `must_find_top3` key appears in the top 3 findings by
   severity; every `must_find_anywhere` key appears somewhere in Findings.
5. Precision: no finding matches `must_not_find`; finding count ≤ max_findings.
6. Schema: every emitted finding parses against the finding schema; CRITICAL/
   HIGH findings all carry failure scenarios; no duplicate dedup_keys.
7. Memory: post-run memory file parses; all memory_assertions hold; exactly
   one review_log entry was appended.

Material-equivalence check (run on release candidates, not every run): execute
the same fixture twice; criteria 1–3 must produce identical results, and the
symmetric difference of emitted dedup_key sets must be ≤ 1.

A RUN passes when all fixtures pass. Partial passes are recorded per-fixture
in the ledger; there is no aggregate score — a score would hide which contract
broke.

---

## 5. FAILURE PROTOCOL

When a fixture fails:
1. Classify: routing error | detection miss | false positive | schema
   violation | memory fault | equivalence drift.
2. Locate: which component's spec governs the failed contract (use the
   kernel's authority map).
3. Decide: component bug (fix the module), spec ambiguity (fix the spec and
   bump its version), or wrong ground truth (bump the fixture, with written
   justification in the ledger).
4. Re-run the full set, not just the failed fixture — a fix that breaks a
   different fixture is the regression this harness exists to catch.

---
Changelog: v1.0 — initial.
