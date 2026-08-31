# Install locations, config, and rollback

## Where things go

**Binaries** (the output of `build-and-package.ps1`, including the copied
Idealpos vendor DLLs — see that script's own note on why they must be
built on-machine, not shipped):

```
C:\Program Files\Verdura\IdealposBridge\
    VerduraIdealposBridge.exe
    VerduraIdealposBridge.exe.config
    VerduraIdealposBridge.pdb
    App.config
    IdealPos.Webit.Core.dll, IdealPos.Data.dll, IdealPos.Common.dll
    Newtonsoft.Json.dll, System.Data.SQLite.dll
    x86\SQLite.Interop.dll, x64\SQLite.Interop.dll
    build-output-manifest-sha256.txt
```

**Mutable config/state/logs** (the bridge resolves `Bridge:StateDatabasePath`
and `Logging:Directory` relative to its own base directory by default — see
`Config/BridgeConfig.cs ResolvePath`; override both to point here instead,
so a future reinstall of the binaries directory doesn't touch state/logs):

```
C:\ProgramData\Verdura\IdealposBridge\
    state\bridge-state.sqlite
    logs\bridge-YYYY-MM-DD.log
```

In `App.config`, before first run, set:
```xml
<add key="Bridge:StateDatabasePath" value="C:\ProgramData\Verdura\IdealposBridge\state\bridge-state.sqlite" />
<add key="Logging:Directory" value="C:\ProgramData\Verdura\IdealposBridge\logs" />
```

Never place bridge binaries inside `C:\Program Files (x86)\Idealpos
Solutions\...` or any existing Idealpos install directory, and never
overwrite an Idealpos-owned file. If co-location under that tree is later
proven genuinely required (it is not, for anything in this preflight), use
a dedicated `VerduraIdealposBridge` subdirectory there instead, per the
governing task's own instruction — not needed for tomorrow's test.

## Configuration — no secrets in this repository or package

This bridge is configured entirely via `App.config` `<appSettings>` /
`<connectionStrings>` — confirmed by reading `Config/BridgeConfig.cs`
completely: there is no environment-variable override mechanism anywhere
in the source (no `Environment.GetEnvironmentVariable` call exists in this
codebase). Do not invent one; configure via `App.config` only, and keep the
real, secret-bearing `App.config` OUT of source control (it already is —
this repository is not even a git repository, so there is nothing to
`.gitignore`, but the same discipline applies to wherever this package is
stored: do not commit or share the real `App.config` once secrets are
filled in).

A sanitized `sample.App.config` (no real secrets, every value either a safe
default or an explicit placeholder) is alongside this file. Copy it to
`App.config` in the install directory and fill in, per the runbook:

- `connectionStrings/IpsConnection` — the disposable test SQL Server target
- `Bridge:ApiKey` — generate a fresh secret (e.g. `[guid]::NewGuid()` in
  PowerShell), never reuse a key from another environment
- `Idealpos:TableAssignmentStrategy` — per `table-assignment-review.md`,
  start with whichever strategy you intend to try first (`DeliverTo` is a
  reasonable first guess, but nothing here should be assumed — this is
  exactly the day's open question)
- `Bridge:StateDatabasePath` / `Logging:Directory` — the `C:\ProgramData\...`
  paths above

Restrict NTFS permissions on `App.config` once the real API key/connection
string are filled in (the bridge itself has no permission-management
code — this is an operator step): grant read access only to the account
that will run the bridge process and to administrators.

## Start (manual foreground — required for the first controlled test)

Per the governing task: do **not** install the Windows Service until AFTER
the controlled Table 12 experiment succeeds. Run in the foreground so you
can watch its console output and Ctrl+C it immediately if anything looks
wrong:

```powershell
cd "C:\Program Files\Verdura\IdealposBridge"
.\VerduraIdealposBridge.exe --console
```

Confirm health before submitting anything:
```powershell
$key = "<the Bridge:ApiKey you set>"
Invoke-RestMethod -Uri "http://127.0.0.1:5588/api/health" -Headers @{ Authorization = "Bearer $key" } | ConvertTo-Json
```
`orderProcessingPathAvailable` must be `true`, `reasons` must be empty,
before proceeding — see the runbook.

## Stop

Foreground: `Ctrl+C` in the console window (handled explicitly —
`Program.cs RunInteractive` installs a `Console.CancelKeyPress` handler
that calls `BridgeHost.Stop()` cleanly, including stopping the HTTP
listener and disposing the watcher timer).

## Uninstall / rollback

Since the Windows Service is deliberately not installed for the first test:
1. Stop the foreground process (Ctrl+C).
2. Delete `C:\Program Files\Verdura\IdealposBridge\` — safe, contains only
   this build's binaries (including the copied vendor DLLs — deleting them
   here does not affect the real Idealpos installation, which has its own
   separate copies).
3. Optionally delete `C:\ProgramData\Verdura\IdealposBridge\` — this
   removes the local idempotency/lifecycle state and logs. Do this only
   after you have finished extracting whatever evidence you need from
   them; per `deploy/uninstall-service.ps1`'s own existing convention, this
   project's own uninstall script also deliberately leaves this data in
   place by default.

If the Windows Service is installed later (after a successful controlled
test, and only then): `deploy\uninstall-service.ps1` (existing script,
unchanged by this preflight) stops and removes the service via `sc.exe
delete`, same "leave state/logs in place" behaviour.

Nothing in this bridge modifies the Idealpos installation itself at any
point — the only write this process ever performs against Idealpos is
`LocalDataHelper.InsertOrders()` (a normal application-level operation
Idealpos's own DLL performs, not a filesystem/registry change) — so there
is no Idealpos-side rollback procedure to define.
