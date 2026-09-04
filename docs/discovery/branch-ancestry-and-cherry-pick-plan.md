# `order-tablet-production-readiness` — ancestry, categories, cherry-pick plan

**Prepared:** 2026-09-05 (offline). **Nothing was rebased, merged, pushed or
rewritten.** This is a plan, not an operation.

**Snapshot warning.** The SHAs below are exact as of `0b2f50a` (18 commits
ahead of `main`). This document was first written at 14 commits and has already
been revised once because the branch moved under it. Re-derive with
`git log --oneline --reverse main..HEAD` before running anything; if the count
does not match, the sequences are stale.

---

## 1. Ancestry

```
main    7f4906b  docs(dl-114): record change-freeze accuracy notes as section 15.7
                 └── merge-base with HEAD (main is a strict ancestor; no divergence)
```

`order-tablet-production-readiness` is **14 commits ahead of `main`, 0 behind**.
The branch is a clean linear descendant, so every cherry-pick sequence below can
be replayed onto `7f4906b` (or any later `main`) without a merge.

```
7f4906b (main)
  ├─ 8f9dfb5  feat(s6)     re-base IdealPOS automation on a Win32 selector model
  ├─ 0055c99  fix(s6)      emit the Win32 child tree unconditionally in the capture
  ├─ 969e5c5  probe(s6)    deep read-only MSAA enumeration; gate on addressability
  ├─ 454e098  fix(tablet)  durable duplicate-submission guard, rate-limit retry
  ├─ a6957e0  feat(sync)   Bridge confirmation readback; retry idempotency
  ├─ f66f925  feat(sync)   connector-mediated order-status readback
  ├─ b8e4374  docs(pos)    vendor package + read-only capture harness
  ├─ 2fcec29  fix(pos)     withdraw the table-Code premise; harden the capture
  ├─ a73292b  docs(pos)    three evidence-discipline corrections
  ├─ 8aec95a  fix(pos)     capture was dropping the table number; delta summary
  ├─ 56a0beb  fix(sync)    fail closed — no path reaches `synced`
  ├─ 6f90fca  docs(tablet) multi-round data-model gap analysis
  ├─ d193945  docs(pos)    static investigation C/D/E/F + vendor disclosure
  ├─ ccc1fd7  test(limit)  measure every quantity in the committed-then-lost retry
  ├─ 933ce5d  docs(git)    this document
  ├─ 98c8e67  docs(pos)    decompile IKM.API; withdraw the OrderAcknowledge overstatement
  ├─ 32d1fa3  docs(disc)   close six live-discovery checklist items
  └─ 0b2f50a  fix(pos)     write current-run.txt without a BOM  ← HEAD
```

## 2. Categories

### A — S6 UI automation experiments (3 commits)

Exclusively `apps/venue-connector/src/VerduraIdealposTracer.*` (CLI, Core,
Windows) plus their gate-result documents.

| Commit | Scope |
| --- | --- |
| `8f9dfb5` | Win32 selector model, window selection, terminal selectors, 4 gate-result docs |
| `0055c99` | emit the Win32 child tree unconditionally in the capture |
| `969e5c5` | deep read-only MSAA enumeration + `CaptureUsability` gate + tests |

**Self-contained.** Touches no API, no schema, no tablet. This is the category
most safely dropped or parked: it is exploratory UI-automation work whose
premise (drive the IdealPOS UI) is exactly what the vendor question is trying
to avoid needing. Item F's discovery of `IKM.API` / `VariPad` makes it more
likely this whole line is superseded.

### B — Order Tablet / idempotency / reconciliation source work (5 commits)

The production source changes. Everything here touches `apps/api/src` and/or
`apps/admin-console`.

| Commit | Scope | Depends on |
| --- | --- | --- |
| `454e098` | tablet durable duplicate-submission guard (`localStorage`); transient rate-limit retry + guard tests | — |
| `a6957e0` | `bridge-order-status.ts`, `idealpos-confirmation.service.ts`, module wiring, rate-limit spec additions, connector readback config doc | `454e098` (same rate-limit files) |
| `f66f925` | connector-mediated reader + constants; connector-side `IdealposBridgeClient` / `IdealposOrderStatusService` | `a6957e0` |
| `56a0beb` | **fail-closed policy**; rewrites the `synced` branch and 9 tests; truth-table doc | `a6957e0`, `f66f925` |
| `ccc1fd7` | the five-quantity retry ledger test | `454e098`, `a6957e0` |

**`56a0beb` is the one that must not be separated from its predecessors.** It
removes the only `synced` transition; lifting it alone onto a base without
`a6957e0`/`f66f925` has nothing to modify.

### C — IdealPOS evidence, tooling and analysis (6 commits)

`docs/` and `windows-deploy/ops/` only. No application source.

| Commit | Scope | Depends on |
| --- | --- | --- |
| `b8e4374` | vendor package rewrite; creates `idealpos-table-capture.ps1` | — |
| `2fcec29` | withdraws the table-`Code` premise; rewrites the capture; creates the diff tool and the runbook | `b8e4374` |
| `a73292b` | three evidence-discipline corrections (transient/close-authorization/`Map`) | `2fcec29` |
| `8aec95a` | fixes the dropped `Table` column; adds `candidate-new-sale`; baseline guard | `2fcec29` |
| `6f90fca` | multi-round data-model gap analysis (+15 lines into the truth-table doc) | `56a0beb` (touches its doc) |
| `d193945` | static investigation C/D/E/F; vendor disclosure; runbook qty-2 change | `b8e4374`, `2fcec29`, `a73292b` |
| `933ce5d` | this document | — |
| `98c8e67` | `IKM.API` decompilation; withdraws the `OrderAcknowledge` overstatement | `d193945` |
| `32d1fa3` | closes six live-discovery checklist items; records the reverse-engineering tension | `98c8e67` |
| `0b2f50a` | `current-run.txt` BOM fix in the capture script | `8aec95a` |

Note `6f90fca` is categorised here as analysis, but it **also edits
`docs/integrations/idealpos-confirmation-truth-table.md`**, which category B's
`56a0beb` creates. That is the one cross-category file dependency.

## 3. Cherry-pick sequences

All sequences assume a fresh branch rooted at the intended base:

```bash
git switch -c <new-branch> 7f4906b     # or a later main
```

### 3a. Production-readiness only — the recommended shape

Source work plus the evidence that justifies it, leaving the S6 UI-automation
experiments behind:

```bash
git cherry-pick 454e098 a6957e0 f66f925 56a0beb ccc1fd7
git cherry-pick b8e4374 2fcec29 a73292b 8aec95a 0b2f50a d193945 98c8e67 32d1fa3 6f90fca 933ce5d
```

**Order matters.** `6f90fca` is moved to last because it edits the truth-table
document that `56a0beb` creates; picking it before `56a0beb` conflicts. Within
each group the original order is preserved.

Expected conflicts: none. The two groups are disjoint by path except for that
one document, which the ordering resolves.

### 3b. Everything, minus nothing

```bash
git cherry-pick 8f9dfb5 0055c99 969e5c5 454e098 a6957e0 f66f925 \
                b8e4374 2fcec29 a73292b 8aec95a 56a0beb 6f90fca \
                d193945 ccc1fd7 933ce5d 98c8e67 32d1fa3 0b2f50a
```

Identical to the current branch content. Equivalent to a fast-forward, and only
worth doing if the base has moved.

### 3c. Evidence and tooling only — for a docs/tooling PR

```bash
git cherry-pick b8e4374 2fcec29 a73292b 8aec95a 0b2f50a d193945 98c8e67 32d1fa3
```

Deliberately excludes `6f90fca`, which depends on `56a0beb`'s document. If the
gap analysis is wanted in this PR, take the file from `6f90fca` without the
15-line truth-table hunk:

```bash
git checkout 6f90fca -- docs/integrations/multi-round-ordering-model-gap.md
```

### 3d. The safety fix alone — if `synced` must be closed urgently

```bash
git cherry-pick a6957e0 f66f925 56a0beb
```

`56a0beb` cannot be lifted alone. This is the minimum set that closes the
correlation-grade `synced` promotion.

## 4. Two things to settle before any of this runs

1. **What is the intended base?** Everything above roots at `7f4906b`, today's
   `main`. If `main` has since moved, re-derive the merge-base first — the
   sequences hold, the root does not.
2. **Is category A wanted at all?** Three commits of Win32/MSAA UI-automation
   work sit on a premise the vendor question exists to replace, and item F
   surfaced two installed COM order-ingestion surfaces (`IKM.API`, `VariPad`)
   that would make UI automation unnecessary if either is supported. Parking
   category A until the vendor answers looks right, but that is a product call,
   not a git one.

## 5. Not done, deliberately

No rebase, no merge, no push, no history rewrite, no branch created. Every
command above is written out for a human to run after deciding §4.
