# P0 Phase 1 — audit of the existing native driver against the proven workflow

**Written:** 2026-09-05, under the P0 master execution directive.
**Method:** offline source audit only. No IdealPOS process, database, socket,
service or configuration was touched. Nothing was invoked, deployed or pushed.
**Deadline context:** Friday 25 September 2026.

The question this audit answers is narrow: *does the code we already have
drive the workflow that the 2026-09-05 Table 5 experiment proved?*

**It does not.** The state/identity layer is sound and largely reusable. The
driver layer implements a different workflow that cannot produce a native
round, and must be replaced rather than repaired.

---

## 1. The proven workflow, restated as the audit baseline

Round 1: native sale-entry screen → enter PLU/items → **TABLE MAP** → select
destination Table N. The TABLE MAP → Table N step *is* the commit/send.

Round 2: Table Map → existing Table N → Details → POS → enter only the new
items → **TABLE MAP** → same Table N.

Two properties matter for the audit:

- **Item entry precedes table selection.** The table is the destination of a
  staged sale, not a field inside it.
- **There is no Save button.** The send boundary is the table-map selection.

## 2. Verdict per component

| Component | File | Verdict |
| --- | --- | --- |
| Round contracts | `Core/Terminal/TerminalRoundContracts.cs` | **KEEP** |
| Round state machine | `Core/Terminal/TerminalRoundState.cs` | **KEEP + extend** |
| Round orchestration | `Core/Terminal/TerminalRoundService.cs` | **KEEP + fix one call site** |
| Confirmation evaluator | `Core/Terminal/PosServerConfirmation.cs` | **KEEP + harden** |
| Win32 discovery/action/verify layering | `Windows/Win32TerminalDriver.cs` | **KEEP the layering, FIX the verifier** |
| Selector model | `Core/Terminal/TerminalUiSelectors.cs` | **FIX — remodel around the real workflow** |
| Action plan text | `Core/Terminal/TerminalActionPlan.cs` | **FIX — step 9 describes a Save button** |
| **Save-to-table execution path** | `Windows/WindowsUiAutomationClient.cs` §`AttemptSaveToTableAsync` | **DELETE/REWRITE** |
| Deployed connector profile | `C:\ProgramData\Verdura\config\connector\discovery-profile.local.json` | **FIX — targets the wrong executable** |

## 3. KEEP — what already matches the directive

These are not "close enough"; they are correct and should be built on.

**`TerminalRoundItem(NativeCode, Quantity)` has no price field.** A price
cannot be sent because the type has nowhere to put one; prices appear only as
`ObservedTerminalLine` on results. This satisfies §18 structurally rather than
by convention.

**Second rounds carry only new items.** `TerminalRoundRequest` documents and
the plan builder assumes the incremental model of §13.

**`SendBoundaryCrossed` is separate from the outcome**, and
`AssertHonestFailClosed()` throws if a refusal ever claims a mutation. This is
exactly the §9 distinction between "refused before the irreversible act" and
"we do not know".

**`TerminalRoundService` implements the §9 ordering correctly**: it persists
`SEND_INITIATED` *before* invoking the driver, fires a crash hook there, and
its idempotency gate refuses to drive the UI again for any key at or past the
boundary (`IsPastSendBoundary`). `CONFIRMED` is reachable only through a
native confirmation, never from UI success — the UI-success path lands on
`AWAITING_NATIVE_CONFIRMATION`.

**`TerminalConfirmationEvaluator` is already ID-free.** It reasons over the
natural key `(Code, Pos, Map)` plus a line multiset, with no row-ID field
anywhere. §17's requirement that `posServerPendingSaleId` must not be a
stability dependency is *already met* here and in the bridge, where
`OrderLifecycleWatcher.ObservePendingSaleStillOpen` deliberately re-checks by
`Code` and documents why the ID cannot be used.

## 4. DELETE/REWRITE — the driver does not drive the proven workflow

`WindowsUiAutomationClient.AttemptSaveToTableAsync` performs, in order:
resolve a `PluEntryField` and a `SaveToTableAction`; **`SetText(pluHandle,
request.TableCode)`**; `Click(saveHandle)`; then verify a confirmation control
contains the table code.

**D1 — the table code is typed into the PLU field.**
`WindowsUiAutomationClient.cs:309`. This is the semantic confusion named in
directive §8, present verbatim. TABLE and PLU are different concepts entering
different controls at different workflow stages.

**D2 — the round's items are never entered at all.** `request.Items` is not
read anywhere in the Windows client; grep for `.Items`, `NativeCode` and
`Quantity` in that file returns nothing. The contracts carry the items
faithfully all the way to the driver, which then discards them. Consequently
this path cannot produce the required native round *even if D1 were fixed* —
there is no item to send.

**D3 — the send boundary is an invented Save button.** `SaveToTableAction` has
no counterpart in the proven workflow, which commits via TABLE MAP → Table N.
Directive §6F prohibits exactly this.

**D4 — the wrong-table hazard is live in the verifier.**
`Win32ActionVerification.ProveTableAssigned` accepts the assignment when the
confirmation control's text merely *contains* the expected code
(`Win32TerminalDriver.cs:163`). Table `5` is a substring of `15`, `25`, `50`
and `Table 5 of 19`. Under §29 ("wrong table may be selected → stop") this
must become an exact, delimiter-aware match against a parsed table identity.

**D5 — the idempotency short-circuit can produce a false confirmation.**
Before acting, the method asks whether the confirmation control already shows
the requested table; if so it returns `Success` with `Mutated = false`
(`WindowsUiAutomationClient.cs:288-305`). But an *already-active* Table 5 is
the normal precondition for Round 2, and is also what a human's own order
produces. As written, a Round 2 request against an open Table 5 would report
success **without sending anything**, and `TerminalRoundService` would then
route it to `AWAITING_NATIVE_CONFIRMATION` on the strength of a send that
never happened. "This table is open" is not "this round was applied".

**D6 — there is no screen-state model.** The method checks for a modal and for
a bound window, then assumes it is on the sale screen. Directive §7B requires
distinguishing Table Map / sale-entry / Table Details / modal / unknown, and
aborting on unknown.

**D7 — success is a UI substring, not a native delta.** No pre-send snapshot,
no post-send snapshot, no delta.

## 5. FIX — defects in otherwise-sound code

**F1 — the pre-send snapshot is dropped at the call site.**
`TerminalRoundService.cs:123` calls `ConfirmRoundAsync(..., map: null,
beforeFingerprint: null, ...)`. The evaluator supports a `before` fingerprint
and uses it for both the prior-line-preservation rule and the delta rule; the
orchestrator hardcodes `null`. Effect: for a second round the
prior-lines-retained check iterates an empty dictionary and passes vacuously,
and the delta is computed against zero. A Round 2 that repeated a Round 1 PLU
would mis-evaluate, and a silently dropped Round 1 line would not be caught.
Directive §10 requires PRE-SEND + EXPECTED + POST-SEND. This is a small change
at the call site plus persistence of the snapshot per §9 step 4.

**F2 — `Map` is carried but never compared.** `TableSaleFingerprint.Map`
exists; `Evaluate` never reads it, and the call site passes `map: null`. §17
notes map-aware selection is useful because the observed Table 5 was `Map=1`,
and the existing docs already record `SelectTableSale`'s `Map` omission as a
demonstrated defect. Map should be compared as table-context evidence — while
remaining non-causal per §10.

**F3 — unexpected concurrent lines are silently tolerated.** `Evaluate` checks
that expected codes appear with the right delta and that prior codes did not
shrink. It never asks whether *unexpected* new codes appeared. Under §11, a
human adding an item to Table 5 between our snapshots must make the outcome
ambiguous, not confirmed. A first round is worse: `before` is ignored entirely
on that path, so a pre-existing sale carrying the same PLU would confirm a
round we did not cause.

**F4 — no `MANUAL_RESOLUTION_REQUIRED` state.** §9 lists it separately from
`UNCERTAIN_NATIVE_OUTCOME`. Today everything ambiguous collapses into
`UNCERTAIN`. The distinction matters operationally: "retry is unsafe, machine
may still resolve it" versus "a human must look at this table now".

## 6. Safety state as found

Nothing in the current tree can drive IdealPOS today, and that is by
construction rather than by luck:

- `WindowsAutomationSettings` defaults every selector to `null` and the
  profile version to `UNSET-PENDING-session1-discovery`.
- `TerminalSelectorReadiness.IsReadyForLiveExecution` refuses placeholder
  versions and null/invalid selectors, and `AttemptSaveToTableAsync` returns
  fail-closed at that gate before reaching any action.
- The only committed profile, `docs/discovery-profile.pos-screen-capture.json`,
  deliberately keeps `PENDING` in its version string so it can never pass.

**One finding to carry forward.** The *deployed* connector profile at
`C:\ProgramData\Verdura\config\connector\discovery-profile.local.json` sets
`ExpectedProcessName: "IPSClient"`. Directive §6 requires `IPS.exe`. It is
inert today (`ProfileVersion: "DUNEDIN-CLOUD-MODE-UNUSED"`, no selectors, so
readiness refuses), but it must be corrected before certification — and must
not be corrected *before* the driver is rewritten, since a profile naming the
right process is one step closer to being live-capable.

## 7. What Phase 2 inherits

The selector model needs remodelling before passive recognition work is
meaningful. Required concepts, replacing `SaveToTableAction`:

1. `TableMapScreen` — recognition, not just a control.
2. `SaleEntryScreen` — recognition.
3. `TableDetailsScreen` — recognition.
4. `TableCell(code)` — exact identity, not substring (`TableCellTemplate`
   already carries a `{code}` placeholder and is the right seed).
5. `PluEntryField` + `QuantityEntry` — item entry, distinct from table
   selection.
6. `StagedSaleLines` — read-back of what is staged *before* the commit, so
   D2's missing verification step exists.
7. `TableMapCommand` — the navigation that performs the commit.
8. `ModalOrUnknown` — the abort condition.

## 8. Evidence grading

- The driver types the table code into the PLU field: **PROVED** (source).
- The driver never enters the round's items: **PROVED** (source).
- The idempotency short-circuit can report success without sending:
  **PROVED** (source path).
- Substring table matching admits a wrong-table match: **PROVED** (source).
- The pre-send fingerprint is dropped at the call site: **PROVED** (source).
- Nothing in the tree can currently act on IdealPOS: **STRONGLY SUGGESTED** —
  every gate found refuses, but this is an audit of the paths found, not a
  proof that no path exists.
