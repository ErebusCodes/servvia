# Review Orchestrator — Routing Protocol v1.1

Companion to `code-review-spec.md` (the Core Execution Protocol). The orchestrator
routes; it never reviews. It reads no diff hunks, forms no opinions about code,
and emits no findings of its own. Its outputs are: a review plan, dispatched
module invocations, a merged finding set, and a memory write.

Precedence: Core Protocol §5 (evidence) and §8 (output contract) bind every
module in this system, including merge and validation. Nothing in this document
may weaken them.

---

## 1. MODULE REGISTRY

| Module | Role | Dispatch condition | Requires artifacts |
|---|---|---|---|
| review-core | Full single-pass review per Core Protocol | Always (PATH-1, PATH-2); as coordinator-of-record on PATH-3 | — |
| review-memory | Read/write persistent review state | Always | memory file (created if absent) |
| review-intelligence | Generate/refresh repo architecture map | On structural change or map absence | — |
| review-validator | Adversarial validation of merged findings | Always, exactly once, post-merge | — |
| review-security | §4.1 auth + injection-primitive rows | Trigger rows fired | — |
| review-database | §4.1 SQL/ORM/migration row | Trigger row fired | — |
| review-api | §4.1 public-API row | Trigger row fired | — |
| review-performance | §4.1 hot-path + caching rows | Trigger rows fired | — |
| review-concurrency | §4.1 async/concurrent row | Trigger row fired | — |
| review-infra | §4.1 infra/IaC/CI row | Trigger row fired | — |
| review-testing | Core Protocol Test Assessment, expanded | PATH-2/PATH-3 only | — |
| review-architecture | Drift detection: layer violations, cycles, boundary erosion | PATH-3, or explicit request | intelligence map (hard) |
| review-merge | Dedup + conflict resolution | PATH-2/PATH-3 only | — |

Specialist scopes are the Core Protocol §4.1 matrix rows, verbatim. A specialist
MUST NOT report outside its row's check-set; out-of-scope observations are
returned to the orchestrator as unrouted notes, which the orchestrator forwards
to review-core's fallback check-set — never directly to output.

Missing hard artifact rule: if a module's required artifact is absent, the
orchestrator either (a) schedules review-intelligence first, or (b) skips the
module and records one line in Verification Requests: "review-architecture
skipped: no intelligence map." Silent degradation is prohibited.

---

## 2. ROUTING ALGORITHM

```
STEP 1  CLASSIFY
        size    = changed LOC (excluding generated/lockfiles), file count
        triggers = fired rows from Core Protocol §4.1 (baseline always fires)
        risk    = HIGH if any of {auth, migration, public-API break,
                  infra-with-IAM-delta} triggers fired, else NORMAL

STEP 2  SELECT PATH (first match wins)
        PATH-3 PARALLEL   size > 1500 LOC OR > 30 files OR triggers ≥ 4
        PATH-2 ESCALATED  risk == HIGH OR triggers ≥ 2 OR size > 400 LOC
        PATH-1 STANDARD   everything else
        (Thresholds are tunable defaults; repo policy may override. The
        orchestrator states the selected path and why in the plan.)

STEP 3  MEMORY READ
        Load memory file. Extract the slice relevant to touched paths:
        prior findings + status, learned conventions, suppressions.
        Inject this slice into every dispatched module's context.

STEP 4  DISPATCH
        PATH-1: review-core
        PATH-2: review-core (fallback + baseline + untriggered scope)
                + the 1–4 specialists whose rows fired, in parallel
        PATH-3: all fired specialists in parallel + review-core restricted
                to baseline + fallback + impact trace (Step 4 of Core §3)
        Every module receives: its scope, the diff slice relevant to it,
        the memory slice, and the shared finding schema (§3 below).

STEP 5  MERGE (PATH-2/3 only; PATH-1 skips to STEP 6)
        review-merge applies §4 rules to the union of finding sets.

STEP 6  VALIDATE
        review-validator receives the merged (or sole) finding set and
        attempts to disprove each finding: locate the citation, test the
        failure scenario's reachability, search for intentionality evidence
        and existing handling the reviewer missed. Powers: demote to
        Question, remove, correct severity/confidence. It may NOT add
        findings. Output caps (max 10 / max 5) are applied here, after
        validation, never before.

STEP 7  MEMORY WRITE (single writer)
        Orchestrator appends: emitted finding IDs + hashes, validator
        removals (as false-positive candidates), new conventions observed
        with ≥3 supporting citations. Specialists never write memory.

STEP 8  EMIT
        Assemble final report per Core Protocol §8, with one added line in
        Summary: path taken and modules invoked.

FAILURE RULE: a specialist that errors or times out does not block the
review. Its scope is recorded in Verification Requests as unreviewed, and
the Verdict may not be APPROVE if the failed scope was risk-HIGH.
```

---

## 3. SHARED FINDING SCHEMA

Extracted to `schemas/finding-schema.md` — the sole definition of finding
structure, the dedup_key computation, and module id prefixes. Binding on
every module; merge rejects non-conformant findings. v1.0 of this document
embedded the schema here; it now lives in one place per this system's
single-source rule.

---

## 4. MERGE RULES

1. **Dedup**: identical `dedup_key` → merge into one finding. Keep the version
   with the stronger evidence (more specific snippet, concrete failure
   scenario); union the `files` lists; record both source modules.
2. **Severity conflict** on merged findings: keep the higher severity but mark
   `confidence: MEDIUM` at most — the disagreement is itself uncertainty.
   The validator adjudicates.
3. **Adjacent findings** (same file, same category, adjacent line buckets):
   merge if the fix is shared; otherwise keep separate.
4. **Cross-module contradiction** (one module's fix would trigger another's
   finding): neither is emitted as-is; both are demoted to a single Question
   presenting the tension. This is the merge engine's only demotion power.
5. Caps are global post-merge: max 10 findings total across all modules,
   overflow summarized by theme per Core §8 — never per-module quotas.

---

## 5. MEMORY CONTRACT (consumed by review-memory spec, summarized here)

Read model injected to modules (the "slice"):
- Findings previously emitted on paths touched by this PR: id, dedup_key,
  status ∈ {open, fixed, acknowledged, wontfix}.
- Suppression list: dedup_keys marked wontfix — modules MUST NOT re-emit;
  reference in one line only if the code regressed.
- Conventions: statements with citation counts ("all handlers return
  Result<T> — 47 citations").

Write model (orchestrator only, append-only, one entry per review):
- review id, PR ref, path taken, emitted finding records, validator
  removals, new convention candidates.

Compaction: when the memory file exceeds its size budget, fixed findings
older than N reviews are dropped; wontfix suppressions and conventions
never auto-expire.

---

## 6. WHAT THE ORCHESTRATOR MAY NEVER DO

- Read diff hunks or form judgments about code quality.
- Alter a finding's content, severity, or confidence (merge and validator
  have defined powers; the orchestrator has none).
- Skip the validator on any path, including PATH-1.
- Write findings into memory that were removed by the validator as anything
  other than false-positive candidates.
- Invoke a specialist whose trigger did not fire, except on PATH-3 or by
  explicit user/policy request.

---
Changelog: v1.1 — finding schema extracted to schemas/finding-schema.md; §3 is now a pointer. v1.0 — initial.
