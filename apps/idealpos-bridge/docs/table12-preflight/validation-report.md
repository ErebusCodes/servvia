# Automated validation report — 2026-08-19 macOS preflight

## What ran, and exact results

### Build (against the real vendor assemblies)

A real local mirror of the target Idealpos installation
(`/Users/sarwarkhan/Documents/Idealpos Solutions/Idealpos`, v6.05.0001,
`IdealPos.Webit.Core` `Version=1.0.0.0` `PublicKeyToken=c5adf46cc9f0e6c6`)
was available on this preflight machine. The real
`IdealPos.Webit.Core.dll` / `IdealPos.Data.dll` / `IdealPos.Common.dll` /
`Newtonsoft.Json.dll` / `System.Data.SQLite.dll` (+ x86/x64
`SQLite.Interop.dll`) were temporarily copied into `lib/` (exactly the
layout `lib/PUT_DLLS_HERE.txt` has always specified), a real build was run,
and the DLLs were then removed again afterward — this repository's `lib/`
now contains only the original `PUT_DLLS_HERE.txt` placeholder, unchanged
from before this session, and no vendor DLL was left behind or is included
in this preflight's own deliverables (see `windows-package/`'s own note on
why they must never be redistributed from here).

```
$ dotnet build VerduraIdealposBridge.csproj -c Release
Build succeeded.
    0 Warning(s)
    0 Error(s)
```

Before the two P0 fixes in this session, the identical command failed
first with `NETSDK1022` (duplicate Compile items), then — once that was
fixed — with `CS0029: Cannot implicitly convert type 'void' to 'int'` at
`Idealpos/IdealposOrderSubmitter.cs:84` (the real
`LocalDataHelper.InsertOrders()` signature). Both are real, reproduced,
fixed defects — not environment artifacts. `NETSDK1022` in particular is
platform-independent: it would have failed identically on Windows.

```
$ dotnet publish VerduraIdealposBridge.csproj -c Release -r win-x64 --self-contained false
VerduraIdealposBridge -> .../bin/Release/net48/win-x64/VerduraIdealposBridge.exe
VerduraIdealposBridge -> /tmp/bridge-publish-test/
```
Publish also succeeded, producing the expected 10-file output (exe, config,
pdb, 5 vendor DLLs, 2 arch-specific SQLite.Interop.dll copies) — confirming
the packaging mechanics `windows-package/build-and-package.ps1` relies on
work end-to-end.

### `--selftest` (pure-logic test suite)

**Not executed in this environment.** `VerduraIdealposBridge.exe` is a
`net48` executable; running it requires Windows or Mono, neither available
on this macOS preflight machine (Mono was deliberately not installed —
installing a heavy new toolchain purely to approximate, not replace,
real Windows execution was judged not worth the environment change for a
preflight). This is a genuine, disclosed gap, not a claimed pass.

**Exact one-command Windows step** (also embedded in
`windows-package/build-and-package.ps1`, which runs this automatically):
```powershell
.\bin\Release\net48\VerduraIdealposBridge.exe --selftest
```
Expected: `20 passed, 0 failed.` — 8 `OrderValidatorTests` + 7
`TableAssignmentStrategyTests` (both pre-existing) + 5 new
`OrderStatusTests` (added this session, covering the `Uncertain`
truthfulness fix: wire-string round-trip, `IsTerminal` for `Uncertain`
specifically, `IsTerminal` unchanged for `Failed`, the three in-flight
states remain non-terminal, and every `OrderStatus` value has a unique
non-empty wire string).

### Static/manual review coverage (exact scope, no gaps left unstated)

Every source file in the repository was read in full this session:
`Api/Endpoints.cs`, `App.config`, `BridgeHost.cs`, `BridgeService.cs`,
`Config/BridgeConfig.cs`, `deploy/*.ps1`, `examples/*`, `Http/*.cs`,
`Idealpos/*.cs`, `Logging/Logger.cs`, `Orders/*.cs`, `Program.cs`,
`Realtime/*.cs`, `README.md`, `TableAssignment/*.cs`, `Tests/*.cs`,
`VerduraIdealposBridge.csproj`. Findings are in `operator-runbook.md`'s
"Independent review summary" table.

### Idempotency / duplicate / replay behaviour

Reviewed by reading `Orders/OrderService.cs`, `Orders/OrderStateStore.cs`,
and `Tests/TableAssignmentStrategyTests.cs`'s determinism assertion for
`ReferencePrefixStrategy`. The design is real and sound (SQLite primary key
+ pre-transaction check + re-check inside a per-table lock + a
deterministic `WebReference` derivation for strategies that mutate it) —
but **not exercised by an automated test against a real SQLite file or
concurrent callers** in this session, because doing so would require adding
a `System.Data.SQLite`-dependent test to a test suite this project
deliberately keeps pure-logic-only (`Tests/`'s own stated design: "no SQL
Server, no Idealpos DLLs, no Windows Service required"). Adding that
dependency would be a real infrastructure change beyond this preflight's
"do not redesign unrelated components" boundary — flagged as a genuine,
pre-existing gap (not introduced by this session), not fixed. The Phase 3
replay step in `operator-runbook.md` is the actual, real evidence for this
behaviour, and must run on Windows tomorrow.

### SQL injection / parameterization

Every SQL statement in `Idealpos/IdealposReadRepository.cs` and
`Orders/OrderStateStore.cs` was read individually and confirmed to use
`SqlParameter`/`SQLiteParameter` (`.Parameters.AddWithValue(...)`) — zero
string concatenation of caller-supplied values into SQL text anywhere in
the repository. Manual verification, not an automated test (no test
project references `System.Data.SqlClient`/`System.Data.SQLite`, per the
prior finding).

### Authentication

`Http/HttpServer.cs CheckAuth`/`SecureEquals` read in full: every route
(including `/api/health` and the WebSocket upgrade) requires
`Authorization: Bearer <key>`, constant-time compared, no unauthenticated
path, no dev-only bypass (`#if DEBUG` or similar) found anywhere in the
codebase. Manual verification — `SecureEquals` is a private method not
exposed for a pure-logic test without a wider refactor, not attempted here.

### Log redaction

`Logging/Logger.cs` read in full, plus every `Logger.*` call site across
the codebase (`grep -rn "Logger\."`). No call site passes an API key,
connection string, or raw exception message from a SQL/Idealpos call —
`IdealposOrderSubmitter.cs`'s error logging uses `ex.GetType().Name` +
`ex.Message` only for the SUBMISSION exception (not a credential-bearing
one), matching the same pattern this bridge's own investigation already
uses elsewhere. `Logger.Redacted` exists as an explicit marker; no call
site currently needs it (no code path logs a secret at all, redacted or
otherwise). Manual verification.

### Checksum / package verification

`windows-package/source-manifest-sha256.txt` — SHA256 of every source file
in the repository (excluding `bin/`, `obj/`, `docs/`, and `lib/*.dll` which
are never present in source control), generated this session. Verification
command (PowerShell, for the Windows machine) is embedded in that file's
own header and in `build-and-package.ps1`, which runs it automatically
before building.

## Summary table

| Check | Tier achieved |
|---|---|
| `dotnet build` against real vendor DLLs | **Done, passed, 0 errors** (this session) |
| `dotnet publish -r win-x64` | **Done, passed** (this session) |
| `--selftest` (20 assertions incl. 5 new) | **Not run** — requires Windows/Mono; exact command given above |
| Full manual source review (every file) | **Done** (this session) |
| SQL injection / parameterization | **Done** (manual, 100% parameterized, confirmed) |
| Authentication coverage | **Done** (manual, no unauthenticated route) |
| Log redaction | **Done** (manual, no secret ever logged) |
| Idempotency/replay — design review | **Done** (manual) |
| Idempotency/replay — automated test | **Not done** — pre-existing gap, real evidence is the Phase 3 live replay step |
| Checksum manifest | **Done** (generated this session) |
| Live health/order/UI evidence | **Not done — requires Windows/Idealpos**, this is tomorrow's entire purpose |

No claim of Windows, live-Idealpos, EFTPOS, KDS, or KOT evidence is made
anywhere in this preflight's deliverables.
