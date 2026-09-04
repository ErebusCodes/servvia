# S6 — the three root causes fixed in source

**Implemented:** 2026-09-04 14:00–14:55 NZST.
**Production: UNCHANGED.** No cutover. `VerduraConnector` still runs
`releases\connector\9f17006` (binary dated 2026-08-30 20:00:50), 9/9 services Running.
**Tests: 200/200 PASS** (baseline was 162/162; 38 added, 0 removed, 0 failed).

This addresses the operator direction to fix the actual engineering problem rather
than take another capture. A corrected capture is still required — but it is now the
*input to a model that can consume it*, which it previously was not.

---

## Root cause 1 — wrong window selected

**Fixed.** `Core/Discovery/WindowSelection.cs`.

The 13:07:59 capture was genuine and correctly executed by the operator, but bound:

```
0x1D077E  "Idealpos v7.1 Build 33  Sila Restaurant  DUNEDIN - BACKOFFICE(1)"
          class ThunderRT6MDIForm   visible=false
```

instead of the sale window, which was enumerated in the same pass and *was* visible:

```
0x1405F6  "POS Screen"   class ThunderRT6FormDC   visible=true
```

The cause is structural, not operational: rule 1 was a substring match on the profile
hint `"Idealpos"`. The back-office title contains it; **"POS Screen" does not**. The
hint could only ever pick the wrong window.

### What replaced it

`WindowSelectionCriteria` — declarative and deterministic:

| Signal | Score | Purpose |
| --- | --- | --- |
| `TitleEquals` | 1000 | Exact title. Deliberately exceeds every other signal combined (170), so "POS Screen" cannot be outvoted. |
| `TitleContains` | 100 | The legacy hint, demoted to a weak signal. |
| `PreferredClassNames` | 40 | e.g. `ThunderRT6FormDC`. |
| `Visible` | 20 | Tie-break only. |
| On primary process | 10 | Tie-break only. |

`TitleExcludes` and `ExcludedClassNames` are **absolute** — an excluded window can never
be selected at any score. Visibility and process affinity only break ties between
windows that already matched something; they never create a match alone.

Two entry points, deliberately different:

- **`Select`** — strict. Returns `Selected` only when exactly one window holds the top
  score. A tie is `Ambiguous`, no match is `NoCandidate`; **both are refusals.** Anything
  that intends to *act* uses this, so a window can never be chosen by enumeration order.
- **`Choose`** — the lenient capture path, since a read-only capture of *something* is
  still evidence. Its fallback chain is unchanged, but it now honours exclusions, so it
  can never re-bind the back-office frame.

The ad-hoc `verdura-run-capture-posscreen.cmd` is retained for evidence only. The
architecture is **not** built on it: the fix is in the selector logic, and the staged
profile now expresses it declaratively rather than by swapping a title string.

---

## Root cause 2 — the AutomationId model was incompatible with the application

**Fixed.** New `Core/Terminal/Win32ControlSelector.cs`.

The capture walked 57 nodes of `IPS.exe` and found **zero non-empty AutomationIds**.
Every node was `ControlType=Win32` with VB6 runtime classes (`ThunderRT6*`,
`AfxOleControl42u`, `MSFlexGridWndClass`); UI Automation returned only window chrome,
and the Win32 `EnumChildWindows` fallback was the only mechanism producing content.

**No capture of this application, however well targeted, could have populated the old
five `*AutomationId` fields with genuine values.** The only way to make that model
"ready" was to invent strings matching nothing. Not done.

### The replacement, built on what the Win32 capture actually provides

`Win32ControlSelector` — `ClassName`, `ControlId` (`GetDlgCtrlID`, the design-time VB6
control index and the closest thing this application has to a stable id), `TextEquals`,
`TextContains`, `ClassPath` (ancestor class chain, suffix-matched), `Ordinal`.

Three rules make it safe:

1. **No HWND may be persisted.** The selector type has *no handle member at all* —
   enforced structurally and asserted by a reflection test. Handles are re-issued on
   every form load; identity is resolved at runtime into `Win32ControlNode`, which is
   the observation side and does carry one.
2. **Positional selectors are refused.** A selector needs at least one non-positional
   discriminator. `Ordinal` and `ClassPath` alone are rejected — they follow a layout
   change silently. Ordinal may *narrow* an already-matching set as a documented
   tie-break; it can never constitute a selector.
3. **Zero or many matches both fail closed.** `NotFound` and `Ambiguous` are refusals.
   A matching set is never narrowed by taking the first element.

Coordinates and `SendInput` are not used anywhere. Targeting is semantic and
hierarchical throughout.

---

## Root cause 3 — configuration and execution were both incomplete

### 3a. The profile could not carry selectors, and its version was discarded

**Fixed.** `IdealposVerifiedProfile` gained the window rules, the five Win32 selectors,
and a required verification selector — all optional/additive, so the three-field profile
deployed in production still deserializes (covered by test).

`Cli/Program.cs` built the settings with **two arguments**:

```csharp
new WindowsAutomationSettings(profile.ExpectedProcessName, profile.ExpectedMainWindowTitleContains)
```

so every selector defaulted to null **and the profile's own `ProfileVersion` was
silently dropped**, leaving `TerminalProfileVersion` at
`"UNSET-PENDING-session1-discovery"` — which trips four placeholder markers at once.
Readiness was therefore unreachable by *any* edit to *any* JSON file. It is now:

```csharp
var windowsSettings = WindowsAutomationSettings.FromProfile(expectedProfile);
```

### 3b. Readiness — re-expressed for the real mechanism, not weakened

`TerminalSelectorReadiness` still demands a real profile version plus a full required
set. It now **additionally** demands that each selector pass structural validation, that
`TableCellTemplate` actually contain `{code}` (or it cannot address a specific table),
and that a **post-action verification selector exist** — so a profile can no longer be
ready for an action whose success could not be proven. Strictly stronger than before.

### 3c. Native execution now exists, with verification as a precondition of success

**Implemented.** New `Windows/Win32TerminalDriver.cs`, in three deliberately separate
types so "can observe" and "can mutate" are distinguishable at a glance:

- **Layer A — `Win32ControlDiscovery`.** Read-only. Walks the bound window into
  `Win32ControlNode`s (class, caption via `WM_GETTEXT`, control id, visibility,
  enablement, class path, sibling ordinal). Bounded: 2000 nodes, depth 24. Sends nothing.
- **Layer B — `Win32NativeAction`.** The only mutating type, holding the only
  message-sending interop (`WM_SETTEXT`, `BM_CLICK`). Every method reports whether the
  message was **issued** — never whether it succeeded.
- **Layer C — `Win32ActionVerification`.** Re-enumerates the window after the action and
  requires the confirmation control to resolve to exactly one node whose text carries the
  requested table code.

`AttemptSaveToTableAsync` is now: process → window → modal → readiness → **strict window
bind** → resolve *every* control before acting on any → **idempotency check** → act →
**verify** → fail closed if unproven.

Two properties worth stating plainly:

- **Success is earned, never assumed.** `BM_CLICK` returning is not success. If
  verification does not observe the expected state, the result is fail-closed *with*
  `SendBoundaryCrossed = true` and `Mutated = true`, so the orchestrator knows the round
  must not be blindly retried.
- **Idempotent by observation.** If the confirmation control already shows the requested
  table, the round returns success **without acting again** — a retry after a lost
  response cannot double-apply.

---

## Tests — 200/200

38 added. Coverage against the operator's list:

| Required | Where |
| --- | --- |
| Correct POS Screen selection over Backoffice | `PosScreenWindowSelectionTests` — using the two real windows from the 13:07:59 capture, including a test that *documents the old defect* |
| Selector parsing/validation | `Win32SelectorModelTests`, `DiscoveryProfileDeserializationTests` |
| No persisted HWND assumption | `Selector_HasNoHandleMember_SoAnHwndCannotBePersisted` (reflection) |
| Missing/ambiguous control fails closed | `NoMatch_FailsClosedAsNotFound`, `MultipleMatches_FailClosedAsAmbiguous_RatherThanTakingTheFirst` |
| Wrong window fails closed | `TwoEquallyGoodCandidates_FailClosedAsAmbiguous`, `NothingMatches_FailsClosedRatherThanFallingBack`, `RequireVisible_RejectsTheInvisibleBackOfficeFrame` |
| Readiness passes only with a complete real profile | `TerminalSelectorSafetyTests` (11 cases), `PopulatedProfile_BindsEverySelectorAndBecomesReady` |
| Action cannot claim success without verification | `NoVerificationSelector_IsNotReady` + the fail-closed branch in `AttemptSaveToTableAsync` |
| Duplicate/retry safety | idempotent no-op branch; existing `TerminalIdempotencyTests` still green |
| Existing behaviour green | 162 baseline tests all still pass |

---

## What is still PENDING, and why

**The selector values.** `TableMapControl`, `TableCellTemplate`, `PluEntryField`,
`SaveToTableAction` and `TableAssignmentConfirmationControl` are `null` in every shipped
profile, and `ProfileVersion` still carries `PENDING`. They can only be filled from a
correctly-bound **POS Screen** capture, which requires a physical console — IPS runs in
session 1, agents run in session 0.

This is now a *data* gap, not a *model* gap. That is the whole difference from this
morning: the model can finally represent what a capture of this application can supply.

### Operator action — read-only, ~8–20 s, physical console

With the terminal on a **visible, logged-in sale/table screen**:

```
C:\Users\Posmate\Documents\verdura_MVP\apps\venue-connector\tools\verdura-run-capture-posscreen.cmd
```

Usable only if the JSON shows `SessionMismatch: false`, `HasRoot: true`,
`ClientNodeCount > 0`, **`RootWindowTitle` is `POS Screen`** (not `...BACKOFFICE(1)`),
and the diagnostics do not contain `"This is a FAILED capture"`. The capture now also
logs its window-selection decision and reason.

---

## Table assignment — a safe strategy, and what was refused

`tableAssignmentConfirmed` was **not** flipped. Under the new architecture it can only
become true by the intended route: Verdura requests a table → the native action runs →
Layer C observes IdealPOS's own confirmation control carrying that table code → only
then is the flag earned.

**The Harness was not run, and must not be.** Its shipped
`Server=localhost\IDEALSQL;Database=IPSTransaction` is described in its README as
"intentionally NOT usable" because "localhost will not resolve to the POS box". **This
host IS the POS box** — `MSSQL$IDEALSQL` is Running here, and the live Bridge connects to
that identical target. Running `insert` would write a real `WebOrder` into the live
restaurant database. No destructive workaround was manufactured.

**Recommended proof, in order of preference:**

1. **Read-only verification after a controlled console action.** The operator assigns a
   round to a designated table at the physical terminal; verification is a `SELECT`-only
   query against `IPSTransaction` plus the Layer C UI observation. This writes nothing,
   needs no new database, and exercises exactly the code path production would use.
2. **A disposable restore.** `archive\postgres-backups-pre-20260903\` and the SQL side
   could seed a throwaway instance, but that instance does not exist on this host and
   creating one is a separate approved change.

Option 1 is the one to take. It needs no new infrastructure and no live write.

---

## Cutover — deliberately NOT done

The freeze was 14:35 NZST; this work completed at ~14:55. Every one of the operator's
cutover preconditions was checked and **the selector-values one fails**:

| Precondition | State |
| --- | --- |
| Real root causes fixed | **YES** — all three, in source |
| Tests green | **YES** — 200/200 |
| Real POS Screen capture validating the model | **NO** — needs the physical console |
| Table assignment safely proven | **NO** — strategy identified, not executed |
| Post-action verification implemented | **YES** |
| Rollback governed and ready | **YES** — `9f17006` is deployed and is the rollback target |
| Adequate recovery time before freeze | **NO** |

Per the direction — *"Do not rush a production cutover merely to meet the clock"* — the
implementation and evidence are complete and **production is unchanged**. `9f17006`
remains the safe baseline.

---

## Unrelated pre-existing production issue

The Connector's polling loop has been failing **503 Service Unavailable** since
**2026-09-03T13:34:55**, a day before any of this work. The API side names the cause:
`RateLimitGuard error (failing closed): Command timed out`. `/api/health` still reports
`redis: ok`, so Redis is reachable but a rate-limiter command times out and the guard
fails closed. This blocks the connector command path entirely and would independently
prevent any end-to-end tablet→IdealPOS proof. Reported for separate action; not touched.
