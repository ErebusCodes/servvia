# S6 Production Readiness Gate — 2026-09-04 work window

**Window:** 12:03–15:00 NZST (change-freeze at 14:35). Evidence collected 12:28–12:35 NZST.
**Verdict: PRODUCTION READINESS: BLOCKED — the S6 Session-1 control-tree capture
cannot be performed from a non-interactive (Session 0) context, and no capture
artifact has ever been produced. Control selectors remain PENDING.**

No production change was initiated. All checks below are read-only.

## Phase 0 — preconditions (PASS)

| Check | Result |
|---|---|
| Platform health | 9/9 Verdura services `Running` |
| API health (`127.0.0.1:3000/api/health`) | `200 {"status":"ok","db":"ok","redis":"ok"}` |
| `IPS.exe` running | PID **20912**, session **1**, started 2026-09-04 04:01:30, `C:\Program Files (x86)\Idealpos Solutions\Idealpos\ips.exe` |
| `IPSClient.exe` also running (ambiguity trap) | PID 12800, session 1, since 2026-08-27 |
| Deployed connector | `C:\ProgramData\Verdura\releases\connector\9f17006` (confirmed by logged content root) |
| Rollback target | `9f17006` is the only release and is the currently deployed one — rollback is the present state, trivially usable |
| Git | `main` @ `7f4906b`, clean except untracked `.claude/worktrees/` |

## The blocker (PROVEN, not asserted)

`IPS.exe` runs in **desktop session 1**. Every agent/service context here runs in
**session 0**. UI Automation cannot cross session boundaries, so the target's
windows do not exist on this desktop (`MainWindowHandle: 0` from session 0).

The passive capture was executed (read-only: no click, no keystroke, no
transaction) and produced a **self-proving negative**:

`apps/venue-connector/.captures/ips-capture-20260904-123018.json`

```json
"TracerSessionId": 0,
"TargetSessionId": 1,
"SessionMismatch": true,
"NodeCount": 0,
"ClientNodeCount": 0,
"HasRoot": false,
"HasClientContent": false
```

```
EnumWindows found 0 top-level window(s) for candidate process(es) on this desktop.
SESSION MISMATCH PROVEN: tracer session 0 != target session 1; no window of the
target is on this desktop. Run inside the target's session.
Capture exit code: 1
```

Per `ControlTreeCapture.cs`, `HasClientContent == false` means **no selector may
be authored from this snapshot**. The capture harness itself is proven working —
it bound the correct process (`IPS`, PID 20912) and failed closed for the right
reason. Only the execution context is wrong.

## Consequences for the remaining gate criteria

`apps/venue-connector/docs/discovery-profile.sample.json` still reads:

```
"ProfileVersion": "ips-vb6-native-target-corrected-2026-09-02__control-selectors-PENDING-runtime-capture"
```

`TerminalSelectorReadiness.PlaceholderMarkers` matches `"PENDING"`, so
`IsReadyForLiveExecution()` returns false and the native driver refuses live
execution **by design**. Therefore these criteria are not merely unproven, they
are **unprovable in this window** — each depends on live native automation that
the fail-closed interlock correctly refuses:

- Table mapping proven — BLOCKED (downstream of selectors)
- Connector→IdealPOS table operation proven — BLOCKED (downstream of selectors)
- `tableAssignmentConfirmed=true` — BLOCKED (downstream of selectors)
- Tablet end-to-end order proven — BLOCKED (downstream of selectors)
- No duplicate/orphan process or order — not assessable; nothing was submitted

**Do not remove "PENDING" by hand.** `Cli/Program.cs` builds the automation
client from the profile before branching on `TRACER_MODE`; editing the version
string defeats the only safety interlock without producing real selectors.

## Live-path state (why nothing is currently at risk)

`VerduraConnector` runs with `TRACER_MODE=cloud`. No native IdealPOS UI
automation is on the live order path today. S6 is precisely the change that
would switch it on — which is why it must not be deployed with placeholder
selectors.

The deployed override
`C:\ProgramData\Verdura\config\connector\discovery-profile.local.json` is still
the known-stale one and must be corrected at connector redeploy, not preserved:

```json
{ "ExpectedProcessName": "IPSClient",
  "ExpectedMainWindowTitleContains": "Idealpos",
  "ProfileVersion": "DUNEDIN-CLOUD-MODE-UNUSED" }
```

## Health caveat (not a gate blocker)

The connector's poll loop logged intermittent `503 Service Unavailable` from
`http://127.0.0.1:3000/api/` at 00:13, 00:15, 04:14, 08:11 and 08:12 UTC today,
recovering via backoff each time. `/api/health` answers `200 ok/ok/ok` on demand.
"API healthy" is therefore true at the point-check but not continuously true —
worth a separate look, unrelated to S6.

## What unblocks S6

The capture must be run **by the operator, interactively, inside session 1** —
the console desktop where IdealPOS is displayed — with an IdealPOS **sale screen
open and rendered**. It is read-only and takes ~8–20 seconds:

```
C:\Users\Posmate\Documents\verdura_MVP\apps\venue-connector\tools\verdura-run-capture.cmd
```

A run is only usable when the resulting JSON shows `SessionMismatch: false`,
`HasRoot: true` and `ClientNodeCount > 0`. That output is then turned into real
selectors and a non-placeholder `ProfileVersion`; only then can S6 be scheduled.
