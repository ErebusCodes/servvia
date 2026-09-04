# S6 Gate — evaluation of the genuine Session-1 capture (13:07:59)

**Evaluated:** 2026-09-04 13:09–13:25 NZST. Freeze 14:35. **No production change made.**
**Verdict: NO-GO.** The capture is genuine and correctly executed, but it captured the
**back-office dashboard, not the sale screen** — and three deeper blockers mean S6 is
not one capture away.

## 1–2. Capture parsed and confirmed

`apps/venue-connector/.captures/ips-capture-20260904-130759.json` (30,620 bytes, 13:08:00).

| Required | Actual | |
|---|---|---|
| `ProcessName=IPS` | `IPS`, PID 20912 | **PASS** |
| `SessionMismatch=false` | `false` (tracer 1, target 1) | **PASS** |
| `HasRoot=true` | `true` | **PASS** |
| `ClientNodeCount=56` | `56` (NodeCount 59) | **PASS** |

`Truncated=false`, `Mechanism=2` (Win32), exit 0. The operator ran this correctly in
session 1. All four stated confirmations pass.

## The problem: right session, wrong window

The bound window was:

```
RootWindowTitle : Idealpos v7.1 Build 33    Sila Restaurant    DUNEDIN - BACKOFFICE(1)
ClassName       : ThunderRT6MDIForm      IsWindowVisible : false
```

The capture's own diagnostics say so explicitly:

```
WARNING: the bound window '...BACKOFFICE(1)' (0x1D077E) reports IsWindowVisible=false.
UIA FromHandle returned 2 node(s) but ZERO client-area content - only window chrome...
  This is a FAILED capture, not a sale screen: no selector can be derived from it.
  Bring the terminal to a visible, logged-in sale/table screen and re-run.
UIA yielded no client-area content; used Win32 EnumChildWindows fallback.
```

The 56 "client nodes" come from the Win32 fallback walking the **back-office dashboard**:

- `MenuItems`: `File | Enquiry | Transactions | Listings | Reports | Stocktake | Utilities | Setup | Help` — the back-office menu bar.
- Tree content: buttons `Sales Amount`, `This Week`, `Last Week`, `Last Year`; six
  `XTPChartControl` chart controls; one `MSFlexGridWndClass`; an embedded
  `Internet Explorer_Server`; eight `ThunderRT6Timer`.
- No table map, no PLU field, no Save-to-Table action.

**`HasClientContent=true` is necessary but not sufficient.** `ControlTreeQuality`
only asks "is every root child a TitleBar?". Win32-fallback nodes are typed `Win32`,
never `TitleBar`, so the structural check passes on any Win32 tree — including a
dashboard. The header booleans cannot distinguish "sale screen" from "wrong screen".

### Why it bound the wrong window — deterministic and fixable

The real sale window **was enumerated** and was **visible**:

```
Handle 0x1405F6   Title "POS Screen"   Class ThunderRT6FormDC   Visible True   IPS/20912
```

`Discovery/WindowSelection.cs` rule 1 is a title-hint match, and the hint comes from
the profile's `ExpectedMainWindowTitleContains` = **`"Idealpos"`**. The BACKOFFICE MDI
title contains "Idealpos"; **"POS Screen" does not**. So the back-office form wins on
rule 1 and the sale screen is never reached. Reproducible, and caused by the profile —
not by the operator and not by IdealPOS.

**Staged fix (source only, read-only capture):**
- `apps/venue-connector/docs/discovery-profile.pos-screen-capture.json` — same file with
  `ExpectedMainWindowTitleContains: "POS Screen"`. It **keeps the PENDING
  `ProfileVersion`** deliberately, so it can never be mistaken for live-ready.
- `apps/venue-connector/tools/verdura-run-capture-posscreen.cmd` — runner pointing at it.

The shipped `discovery-profile.sample.json` was **not** modified.

## 3–5. Why selectors still cannot be derived, populated, or made ready

Three blockers that a corrected re-capture does **not** clear.

### B1 — the application exposes zero AutomationIds

Across all 57 nodes: **`NON-EMPTY AutomationId count: 0`**. Every node is
`ControlType=Win32`; class names are VB6 runtime controls (`ThunderRT6*`,
`AfxOleControl42u`, `MSFlexGridWndClass`). UIA returned **only chrome** on this
process; the Win32 `EnumChildWindows` fallback is the only mechanism that produces
content, and it yields class names, handles and z-order — **not AutomationIds**.

All five required selectors are `*AutomationId` fields
(`Core/Terminal/TerminalUiSelectors.cs:14-18`). **No Win32-mechanism capture of this
VB6 application — including a correctly-bound POS Screen capture — can populate them
with genuine values.** The selector model must be re-based on
(class name + control id + ordinal path) before any capture can fill it.

Inventing AutomationId strings to satisfy the gate would produce selectors that match
nothing and a profile that lies. Not done.

### B2 — the profile cannot carry selectors, and its version is ignored

`IdealposVerifiedProfile` (`Core/Automation/IIdealposUiAutomationClient.cs:115`) has
exactly three fields: `ExpectedProcessName`, `ExpectedMainWindowTitleContains`,
`ProfileVersion`. There is **no selector field in the schema** — added JSON properties
are silently ignored by the deserializer.

`Cli/Program.cs:49`:

```csharp
var windowsSettings = new WindowsAutomationSettings(
    expectedProfile.ExpectedProcessName, expectedProfile.ExpectedMainWindowTitleContains);
```

Only **two** arguments. Every selector defaults to `null`, and `TerminalProfileVersion`
stays at its default `"UNSET-PENDING-session1-discovery"` — **the profile's own
`ProfileVersion` is never passed through.** That default trips four placeholder markers
at once (`UNSET`, `PENDING`, `SESSION1`, `DISCOVERY`).

**Consequence: step 4 is impossible by configuration and step 5 is impossible without a
source change.** No edit to any JSON file can make `IsReadyForLiveExecution()` return
true. Making it true requires adding selector fields to the profile record and passing
them plus the version through `Program.cs` — a code change, not a staging profile.

### B3 — native Save-to-Table execution does not exist

`WindowsUiAutomationClient.AttemptSaveToTableAsync` verifies process, window and modal,
then hits the readiness gate. **Past that gate it still refuses:**

```csharp
// Selectors present but the live-action steps are intentionally
// NOT implemented in this scaffold commit — still refuse to act.
return Task.FromResult(TerminalSaveToTableResult.FailClosed(
    TerminalExecutionOutcome.ControlNotFound, request.RoundId, request.TableCode,
    "selectors present, but native Save-to-Table execution is not enabled in this scaffold "
    + "(no click/SetValue/Send has been implemented yet); this commit is fail-closed by design.", plan));
```

A search for `InvokePattern|SetValue|SendInput|keybd_event|SetForegroundWindow|
WM_COMMAND|SendMessage|PostMessage|mouse_event` across the whole Windows project returns
**four hits: three comments and one refusal message. Zero actual calls.**

**Even with perfect selectors and readiness true, S6 cannot assign a table.** Making
readiness pass only moves the refusal from branch 4 to branch 5. It buys nothing.

## 6. Connector test suite — PASS

`162/162` passed, 0 failed, 0 skipped. Baseline held (run twice, 12:52 and 13:18).

## 7. Harness — STOPPED before any action, as instructed

**No Harness command was run. Nothing was built, inserted, or altered.**

It cannot run as things stand, and one of the reasons is a live-safety problem:

| Prerequisite | State |
|---|---|
| Three vendor DLLs in `apps/idealpos-harness/lib/` | **Absent** — only `PUT_DLLS_HERE.txt` |
| Built output | **Absent** — no `bin/` |
| .NET Framework 4.8 targeting pack | Unverified |
| Disposable test SQL instance | **Does not exist on this host** |

### The harness's documented safety interlock is VOID on this machine

`App.config` ships `Server=localhost\IDEALSQL;Database=IPSTransaction;Trusted_Connection=True;`
and the README calls it "intentionally NOT usable" because *"localhost will not resolve
to the POS box"*. **This host is the POS box.**

- `MSSQL$IDEALSQL` — **Running** on this machine.
- The live Bridge (`C:\ProgramData\Verdura\config\bridge\VerduraIdealposBridge.exe.config`)
  connects to `Server=localhost\IDEALSQL` / `Database=IPSTransaction` — **the identical
  target**.

So the shipped "safe" default resolves straight to the **live restaurant production
database**. The README anticipates exactly this — *"which is exactly the string a LIVE
production POS Server machine would also satisfy if this harness were ever run there"* —
and this is that machine. Running `insert` here with the shipped config writes a **real
`WebOrder` into live production** via `LocalDataHelper.InsertOrders()`.

**Do not build and run the harness on this host against `localhost\IDEALSQL`.**

## GO / NO-GO gate

| Criterion | Result |
|---|---|
| Session-1 capture | **PASS** (genuine, session 1, exit 0) — but wrong window; unusable for selectors |
| Selectors derived | **FAIL** — zero AutomationIds exist to derive (B1) |
| Profile readiness | **FAIL** — unreachable by configuration; `Program.cs` passes 2 of 11 fields (B2) |
| Connector tests | **PASS** — 162/162 |
| Table-assignment strategy empirically proven | **FAIL** — not run; prerequisites absent and live-DB hazard (§7) |
| Correct Bridge configuration identified | **FAIL** — cannot be identified without harness evidence |
| `tableAssignmentConfirmed=true` justified | **NO** — no evidence exists; flag not touched |
| S6 staging | **NOT READY** — native execution unimplemented (B3) |
| Rollback | **READY** — `9f17006` is the only connector release and is the deployed one; the rollback target is the present state |

### Services requiring lifecycle action

**None. No service was started, stopped or reconfigured.** All 9 Verdura services remain
`Running`. A future cutover would need `VerduraConnector`, and `VerduraIdealposBridgeSvc`
only if table-assignment keys change. Both untouched. (NSSM-hosted: never terminate by
process name; six services depend on `VerduraAPI` and `Stop-Service -Force` cascades to
dependents that `Start-Service` will not restore.)

### Time

Evaluated 13:09–13:25 NZST. **~70 minutes to the 14:35 freeze** at time of writing.

Not enough to clear B1+B2+B3 — those are development work (re-model selectors on Win32
identity, thread them through the profile and `Program.cs`, then implement the native
actions), plus a harness run that needs a test database that does not exist here.

## Immediate next action (operator, physical console, read-only, ~8–20s)

```
C:\Users\Posmate\Documents\verdura_MVP\apps\venue-connector\tools\verdura-run-capture-posscreen.cmd
```

With the terminal on a **visible, logged-in sale/table screen**. Usable only if the JSON
shows `SessionMismatch: false`, `HasRoot: true`, `ClientNodeCount > 0`, **and
`RootWindowTitle` is `POS Screen`** rather than `... BACKOFFICE(1)`, and the diagnostics
do **not** contain `"This is a FAILED capture"`.

That capture is still worth taking — it is the input needed to design the Win32-based
selector model — but it will not by itself make S6 deployable, because of B1–B3.
