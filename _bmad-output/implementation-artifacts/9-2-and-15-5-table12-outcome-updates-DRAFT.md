---
status: DRAFT — NOT YET APPLIED
prepared: 2026-08-19 (macOS preflight, no live Windows/Idealpos evidence exists yet)
purpose: >
  Pre-written BMAD update text for each possible outcome of tomorrow's
  controlled Table 12 experiment (IdealposBridge repo,
  docs/table12-preflight/). Apply ONLY the section matching the actual
  outcome, after the experiment, with real evidence filled in. Do not copy
  any of this into sprint-status.yaml / deferred-work.md / decisions-log.md
  / docs/epics.md until then. This file itself is not read by any tooling
  and makes no live claim.
---

# Preserve first: the true baseline as of 2026-08-19

Before applying anything below, confirm these current, accurate statements
still hold (do not silently let a prepared update contradict them without
noticing):

- `sprint-status.yaml` line 150: `9-2-idealpos-uibridge-tracer: blocked` —
  blocked on `REAL_WINDOWS_CONNECTOR` + `REAL_IDEALPOS_UI_DISCOVERY`
  evidence. The discovery-tracer's own scope (UI Automation discovery) is
  **separate from** the IdealposBridge repository this preflight covers —
  the bridge is a different, newer, API-less-injection route (`WebPendingOrder`
  via `LocalDataHelper.InsertOrders()`), not UI Automation. Do not conflate
  "story 9-2 unblocked" with "the bridge route proven" — they are different
  claims about different mechanisms.
- `sprint-status.yaml` line 176: `15-5-tablet-idealpos-handoff: blocked` —
  blocked on DL-064 (vendor/reseller confirmation + hardware audit), and
  still needs "a real Idealpos-order-submit command type built on" the
  connector-command protocol (stories 2-9/2-10, done).
- No decision record currently selects the bridge (`WebPendingOrder`
  injection) as Verdura's production Idealpos integration route. No
  architecture document commits to it. The bridge has never been executed
  against a real Idealpos database or UI before this preflight session.
- `docs/table12-preflight/` (IdealposBridge repo) records 2026-08-19's
  preflight findings: two real P0 build defects found and fixed, one real
  P1 truthfulness defect found and fixed (timeout→`uncertain` not
  `failed`), full independent source review with no other P0/P1, and
  explicit non-claims: no `REAL_WINDOWS_CONNECTOR`, `REAL_IDEALPOS`,
  `REAL_EFTPOS`, or `REAL_KOT_PRINTER` evidence exists yet.

---

## Outcome A — bridge route proven (all conditions pass)

Trigger: `WebPendingOrder` consumed, `PendingSales.Code` equals the
requested table, native Idealpos UI shows Table 12 active with correct
items — per `operator-runbook.md` Phase 2 in full.

**Apply to `docs/decisions-log.md`**: a new decision record, e.g. `DL-0XX`
(next available number), title "Idealpos table-order injection: bridge
(`WebPendingOrder`) route selected as production candidate, subject to
EFTPOS/reconciliation validation." Body must state exactly what was proven
(the six conditions from the governing task's Objective) and exactly what
was NOT proven (EFTPOS, KDS, KOT, production deployment, failure recovery
under load, vendor support/upgrade compatibility) — do not let the
decision record's own language imply more than the evidence supports.
Reference the specific evidence: `WebPendingOrder.ID`, `PendingSales.ID`/
`.Code`, timestamps, from tomorrow's actual run (not this draft's
placeholders).

**Apply to `sprint-status.yaml`**: `9-2-idealpos-uibridge-tracer` status
and note UNCHANGED (the UI Automation tracer's own blocked status is
independent of the bridge route being proven — do not mark it done or
unblocked based on bridge evidence). Add a NEW line for a bridge-tracking
story if none exists yet (check `docs/epics.md` for whether the recovery
plan already anticipated one under a Story 2-x or 9-x slot before
inventing a new number) — status `in-progress`, noting the proven route
and the explicit remaining gate: "authoritative total/reference capture and
controlled normal Idealpos payment/EFTPOS validation" (the governing task's
own stated next-smallest-step).

**Apply to `sprint-status.yaml` line 176 (`15-5`)**: status stays `blocked`
— do NOT mark done. Update the note to record that the connector-command
dependency now has a concrete target route (the bridge, running behind the
Venue Connector per the architecture boundary in the governing task), but
DL-064 (vendor confirmation) remains the blocking gate, and 15-5's full
acceptance criteria (authoritative totals, references, mapping, uncertain
outcomes, replay safety — all beyond "Table 12 accepts an order") remain
unmet.

**Apply to `deferred-work.md`**: new entry recording the bridge's
build/source fixes (the two P0s + the `uncertain`-status P1) as resolved
findings from this preflight+experiment, and the remaining EFTPOS/
production-hardening gaps as the new deferred items, Priority P1 (October
critical path).

---

## Outcome B — bridge proven but table assignment needs correction

Trigger: native Idealpos consumes the order, but `PendingSales.Code` ≠ the
requested table.

**Apply to `docs/decisions-log.md`**: no new decision record yet — this
outcome is "partially proven, root cause under `table-assignment-review.md`'s
own outcome-B section," not a selected-route decision. Do not write a
DL-0XX claiming the route works until the correction is made and re-tested.

**Apply to `sprint-status.yaml`**: no change to `9-2`/`15-5`. Optionally
note in `deferred-work.md` (not `sprint-status.yaml`) that a table-
assignment-strategy correction is in progress, referencing
`table-assignment-review.md`'s specific diagnostic already prepared.

**Apply to `IdealposBridge/docs/table12-preflight/table-assignment-review.md`**
itself: append the actual observed `Caption`/`Code`/`PendingSales.Code`
values and which of the five strategies (or a newly-identified field) was
tried next, per that document's own "before writing any code" checklist.

---

## Outcome C — native consumption unavailable

Trigger: `WebPendingOrder` row never reaches `Processed=1`.

**Apply to nothing in `sprint-status.yaml`/`decisions-log.md` yet** — this
is a diagnostic-in-progress state, not evidence of anything provable or
disprovable about the route. Record findings only in
`IdealposBridge/docs/table12-preflight/` (a new dated findings file) per
`operator-runbook.md`'s Outcome C guidance (service/module/config/schema
diagnosis) and this session's own investigation notes on which Idealpos
service/process is expected to perform the consumption.

---

## Outcome D — database integration incompatible

Trigger: an unexpected schema mismatch (beyond the `InsertOrders()`
signature already fixed this session) prevents the bridge from working
against the real disposable Idealpos version at all.

**Apply to `docs/decisions-log.md`**: a new decision record documenting the
specific incompatibility (exact Idealpos version, exact schema/API
mismatch, with evidence) — this would be a genuinely new finding beyond
anything this preflight could detect from static analysis + one reference
install's assemblies, and is exactly the kind of DL-0xx-worthy fact this
repository's existing decision log (DL-064 through DL-082) already models.

**Apply to `sprint-status.yaml`**: no change to `9-2`/`15-5` beyond adding
a `deferred-work.md` entry naming the specific incompatibility as a new,
concrete blocker distinct from DL-064's vendor/hardware-audit blocker.

---

## Outcome E — live result uncertain

Trigger: `uncertain` status reached (this session's own P1 fix — see
`operator-runbook.md`), or any ambiguous partial result the runbook's
stop/escalation conditions apply to.

**Apply to nothing in `sprint-status.yaml`/`decisions-log.md`.** Record in
a new dated file under `IdealposBridge/docs/table12-preflight/`: last known
durable state, whether native execution may have occurred (per the
`uncertain` status's own `lastError` evidence), the safe cleanup procedure
actually used, and the exact blocker preventing a confident outcome A/B/C/D
classification. This outcome by definition does not yet support any BMAD
tracking-file update — updating those files with an unconfirmed claim would
itself be the exact overclaiming this entire preflight was designed to
prevent.
