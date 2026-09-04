# S6 Production Cutover Gate — re-evaluation after "Session-1 capture has been run"

**Evaluated:** 2026-09-04 12:45–12:52 NZST. Change freeze 14:35 NZST.
**Verdict: NO-GO. Production baseline preserved. No production change was initiated.**
**All checks below are read-only.**

## Finding that decides the gate: the Session-1 capture artifact does not exist

The work order stated the capture "has now been run interactively at the physical
console" and instructed to proceed from the capture artifact. It has not been run,
or it did not produce an artifact on this machine.

Machine-wide search (`C:\Users\Posmate`, `C:\ProgramData`, `C:\Temp`, recursive)
for `ips-capture-*.json` returns **exactly one file**:

```
C:\Users\Posmate\Documents\verdura_MVP\apps\venue-connector\.captures\ips-capture-20260904-123018.json
```

That file is the **Session-0 self-proving negative produced by the previous agent
run at 12:30:18**, not an operator capture. Its `.captures` parent directory was
created by that same run at 12:30:18.512 and has received no write since. Verified
again at 12:45 and 12:52 — unchanged. The worktree checkout
(`.claude/worktrees/dl-114-acl-hardening/...`) has no `.captures` directory at all.

Contents, against the four confirmations the work order required:

| Required | Actual | Result |
|---|---|---|
| `SessionMismatch=false` | **`true`** | **FAIL** |
| `HasRoot=true` | **`false`** | **FAIL** |
| `ClientNodeCount>0` | **`0`** | **FAIL** |
| target is `IPS.exe`, not `IPSClient.exe` | `ProcessName: "IPS"`, PID 20912 | **PASS** |

```
"TracerSessionId": 0,  "TargetSessionId": 1,  "SessionMismatch": true,
"NodeCount": 0, "ClientNodeCount": 0, "HasRoot": false, "HasClientContent": false
"SESSION MISMATCH PROVEN: tracer session 0 != target session 1"
```

Three of the four gate confirmations fail on the only artifact that exists.
No selector may be authored from this snapshot. Steps 3–6 and 9 of the work order
are therefore not merely unproven — they have no input.

## What was NOT done, and why

- **Step 3 (derive selectors)** — no capture to derive from. Deriving selector
  values from anything other than a real Session-1 capture would be fabrication.
- **Step 4/5 (update profile, remove PENDING markers)** — not done deliberately.
  `PENDING` is the *only* live-execution interlock. Removing the marker without
  real selectors does not make S6 ready; it makes an unready S6 *look* ready and
  disarms the one check that currently prevents native UI automation on the live
  order path. This is the single most dangerous available action in this window.
- **Step 6 (prove `IsReadyForLiveExecution()` true)** — it is provably **false**,
  and correctly so. Two independent reasons, from
  `Core/Terminal/TerminalUiSelectors.cs`:
  1. `ProfileVersion` = `"...control-selectors-PENDING-runtime-capture"` contains
     `PENDING` → placeholder → returns false before selectors are even examined.
  2. `discovery-profile.sample.json` contains **no selector fields at all**; all
     five required selectors are `null` → `LooksPlaceholder` → false.
- **Step 9 (stage governed ProgramData S6 release)** — not staged. Staging a
  release whose defining payload (the selectors) does not exist would produce a
  governed artifact that must never be deployed, and invites a later operator to
  deploy it because it looks complete. Staging is correct *after* a valid capture.

## Steps that WERE completed (read-only, independent of the capture)

### Step 7 — Connector test suite: **PASS**

```
dotnet test tests/VerduraIdealposTracer.Tests/VerduraIdealposTracer.Tests.csproj
Passed! - Failed: 0, Passed: 162, Skipped: 0, Total: 162
```

(`VerduraIdealposTracer.slnx` cannot be driven by the installed SDK —
`MSB4068: The element <Solution> is unrecognized`. The test project was run
directly. One pre-existing `CS1998` warning in `PrintKotCommandHandlerTests.cs:189`.)

Note what a green suite does and does not mean here: `TerminalSelectorSafetyTests`
asserts the fail-closed gate *refuses*. The suite passing is evidence the interlock
works, not evidence S6 is ready.

### Step 8 — exact production S6 delta vs deployed `9f17006`

Deployed: `C:\ProgramData\Verdura\releases\connector\9f17006`. Repo `main` @ `7f4906b`.

Nine commits touch `apps/venue-connector`; **33 files, +3821/-54**:

```
01c6b92 chore(venue-connector): bring the capture runner into the repo
2b023de fix(idealpos-tracer): point the discovery profile back at IPS/Idealpos
33fd573 fix(idealpos-tracer): retarget the terminal driver at IPS.exe, not IPSClient
b89ba5d test(idealpos-tracer): make crash and polling tests deterministic
a5fe787 fix(idealpos-tracer): reject chrome-only live control captures
bc8cf17 feat(idealpos-tracer): ingest live capture — target IPSClient terminal window by title
bf70cb0 feat(idealpos-tracer): HWND-bound capture with Win32/MSAA fallbacks + session diagnostics
eb0f40a feat(idealpos-tracer): passive read-only control-tree capture
242c290 feat(idealpos-tracer): scaffold fail-closed native table execution
```

New subsystems: `Discovery/` (ControlTreeCapture, ControlTreeQuality, WindowSelection),
`Terminal/` (7 files incl. TerminalUiSelectors, TerminalActionBinding,
PosServerConfirmation), `WindowsUiAutomationClient.cs` (+551).

The delta is real and substantial, but it is **the machinery to execute selectors,
not the selectors**. Shipping it changes nothing useful while the profile is
PENDING; it only moves the fail-closed refusal into production.

### Step 10 — table-assignment contract: **PROVEN, and it contradicts the acceptance criterion**

`tableAssignmentConfirmed` is **not an outcome signal. It is an operator-set
labelling flag.** Traced end to end:

- `Config/BridgeConfig.cs:133` — `cfg.TableAssignmentConfirmed = GetBool("Idealpos:TableAssignmentConfirmed", false);` — read straight from `App.config`.
- `Idealpos/AvailabilityChecker.cs:48` — copied verbatim into the health report.
- `Api/Endpoints.cs:39` — emitted verbatim as `tableAssignmentConfirmed`.
- `apps/idealpos-bridge/README.md:133` — *"Purely a labelling flag for `/api/health`
  and honest logging — flip to `true` only after `VerduraIdealposHarness` has
  demonstrated the chosen strategy actually works on this Idealpos version."*

**Nothing in the tablet → API → Connector → Bridge → IdealPOS path can ever set it.**
No order, however successful, will flip it. The only thing that makes it `true` is
a human editing `Idealpos:TableAssignmentConfirmed` in the Bridge's `App.config`
and restarting `VerduraIdealposBridgeSvc`.

Therefore the stated acceptance criterion — *"Success requires
`tableAssignmentConfirmed=true`"* — **cannot be satisfied by running the E2E test,
and if it is satisfied by editing config it proves nothing.** Setting it to `true`
without harness evidence would convert an honest `/api/health` signal into a false
one, and would suppress the `reasons[]` warning that currently tells staff table
assignment is unproven.

**What must actually happen to earn `=true` (the real contract):**

1. Run `VerduraIdealposHarness` against *this* Idealpos version. It runs five
   experiments (Tests A–E, mirrored field-for-field in
   `TableAssignment/Strategies.cs`): `NoHint` / `DeliverTo` / `Message` /
   `ReferencePrefix` / `HostReference`.
2. Observe which experiment, if any, causes `PendingSales.Code` to equal the
   requested table number. **That equality is the actual table-assignment contract.**
3. Set `Idealpos:TableAssignmentStrategy` to the strategy that demonstrably worked.
4. Only then set `Idealpos:TableAssignmentConfirmed=true`.
5. If none of the five worked: `NoHint` is correct and `Confirmed` stays `false` —
   orders still reach IdealPOS, staff allocate tables manually.

Verdura's outward contract is unaffected either way — always `"table": "12"`
(`TableAssignment/ITableAssignmentStrategy.cs`).

This is an independent, *parallel* blocker to the selector problem. Even a perfect
Session-1 capture would not produce `tableAssignmentConfirmed=true`.

## GO / NO-GO gate

| Criterion | Result | Basis |
|---|---|---|
| Selector readiness | **FAIL** | Profile has zero selector fields; `ProfileVersion` still `...PENDING-runtime-capture` |
| Target process | **PASS** | `IPS.exe` PID 20912, session 1, `C:\Program Files (x86)\Idealpos Solutions\Idealpos\ips.exe`; `IPSClient.exe` PID 12800 correctly not the target |
| Test suite | **PASS** | 162/162 |
| Live profile readiness | **FAIL** | `IsReadyForLiveExecution()` false — placeholder version *and* five null selectors. Deployed override is still the stale `ExpectedProcessName: "IPSClient"` / `DUNEDIN-CLOUD-MODE-UNUSED` |
| Table mapping contract | **FAIL** | Contract proven; `tableAssignmentConfirmed` is operator-set and requires harness evidence that does not exist |
| Rollback readiness | **PASS (trivially)** | `9f17006` is the only connector release and is the currently deployed one — the rollback target *is* the present state. 12 governed rollback descriptors under `C:\ProgramData\Verdura\rollback\` |

**2 FAIL on the two criteria that gate live execution → NO-GO.**

### Services requiring restart

**None. No service was restarted and none should be.** For the record, a future
S6 cutover would require exactly:

- `VerduraConnector` — new release path + `TRACER_MODE` + corrected
  `discovery-profile.local.json`.
- `VerduraIdealposBridgeSvc` — **only** if `Idealpos:TableAssignmentStrategy` /
  `TableAssignmentConfirmed` change in `App.config`.

Neither was touched. Per SCM/orphan-safety rules these are `nssm.exe`-hosted —
never terminate by process name; six services depend on `VerduraAPI` and
`Stop-Service -Force` would cascade to dependents that `Start-Service` will not
bring back.

### Expected production behaviour change

**None. Zero.** Current state is unchanged: 9/9 Verdura services `Running`,
`VerduraConnector` on `9f17006` with `TRACER_MODE=cloud`. No native IdealPOS UI
automation is on the live order path today, and none was added.

### Remaining risk

1. **The premise gap is the top risk.** Work was authorised on the belief that a
   Session-1 capture exists. It does not. Any downstream step taken on that belief
   would have been built on nothing.
2. **The tempting wrong fix.** Editing the `ProfileVersion` string to remove
   `PENDING` makes every gate above go green while making production *less* safe.
   `Cli/Program.cs` builds the automation client from the profile before branching
   on `TRACER_MODE`.
3. **`ProfileVersion` naming trap for the next attempt.** `PlaceholderMarkers` is a
   case-insensitive substring match on `PENDING, UNSET, TBD, PLACEHOLDER, SESSION1,
   DISCOVERY, EXAMPLE, CHANGEME`. A natural post-capture name like
   `ips-session1-discovery-2026-09-04` would **still fail readiness** — it contains
   both `SESSION1` and `DISCOVERY`. Choose e.g. `ips-native-2026-09-04-capture-1`.
4. **Stale deployed override.** `C:\ProgramData\Verdura\config\connector\discovery-profile.local.json`
   still says `ExpectedProcessName: "IPSClient"`. Harmless under `TRACER_MODE=cloud`;
   must be corrected *at* connector redeploy, not before, and not left in place.
5. **Table strategy remains genuinely unresolved** since DL-107 — independent of S6.
6. **Intermittent API 503** on the connector poll loop (00:13, 00:15, 04:14, 08:11,
   08:12 UTC), recovering via backoff. Not touched — it did not obstruct anything
   here, since no acceptance test could run.

## End-to-end acceptance test

**Not executed.** It is gated on cutover, cutover is NO-GO, and its stated success
condition (`tableAssignmentConfirmed=true`) is unreachable by execution regardless.
No order was submitted, so no duplicate transaction or order was possible.

## What unblocks S6 (unchanged, plus one addition)

1. **Operator, at the physical console, in session 1**, with an IdealPOS **sale
   screen open and rendered**, runs — read-only, ~8–20s:
   `C:\Users\Posmate\Documents\verdura_MVP\apps\venue-connector\tools\verdura-run-capture.cmd`
   Usable only if the JSON shows `SessionMismatch: false`, `HasRoot: true`,
   `ClientNodeCount > 0`. **Confirm the file exists and re-read those three fields
   before any further S6 work is authorised.**
2. **Separately**, run `VerduraIdealposHarness` to establish the table-assignment
   strategy. Without it `tableAssignmentConfirmed` cannot honestly be `true`.

These are independent. Both are required. Neither can be done from session 0.
