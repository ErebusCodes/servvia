# VerduraIdealposBridge

A small Windows Service that exposes Idealpos's confirmed local order-
injection pipeline as a clean HTTP + WebSocket JSON API, so Verdura never
needs to know Idealpos's SQL Server, DLLs, COM interfaces, or native
processes exist.

```
Verdura Tablet / Verdura Backend
        │  HTTP + JSON, WebSocket events
        ▼
VerduraIdealposBridge  (this project)
        │  IdealPos.Webit.Core.dll -> LocalDataHelper.InsertOrders()
        ▼
dbo.WebPendingOrder  ->  native IPS.exe  ->  dbo.PendingSales / PendingSaleLines
        │
        ▼
Idealpos table map, existing payment/Eftpos workflow
```

This project is the direct continuation of the Idealpos reverse-engineering
work and `VerduraIdealposHarness` in this same folder tree. Read those
first if you haven't — this README assumes the investigation's findings
(Sections D, F, K) as background and doesn't re-derive them.

**Payment is never touched.** There is no `/pay` endpoint anywhere in this
project. Once an order reaches Idealpos, staff open the table and use
Idealpos's own payment controls exactly as today — see "Payment stays in
Idealpos" below.

---

## Architecture decision: why one net48 process, not ASP.NET Core + IPC

`IdealPos.Webit.Core.dll` (and its two dependencies, `IdealPos.Data.dll`
and `IdealPos.Common.dll`) are compiled against .NET Framework 4.0 —
confirmed from their own decompiled assembly metadata, same as
`VerduraIdealposHarness`. A single in-process .NET Framework 4.8 host can
call them directly, with zero IPC and zero second runtime to keep alive.
ASP.NET Core would need a separate .NET Framework bridge process just to
reach these DLLs at all, for no benefit this project needs — so that's
what was deliberately not built.

HTTP hosting is `System.Net.HttpListener` (in-box), not ASP.NET/OWIN.
Real-time push is a native `System.Net.WebSockets` upgrade through the
same `HttpListener` (in-box since .NET Framework 4.5), not SignalR — this
keeps the whole project at **zero NuGet packages**. JSON
(`Newtonsoft.Json.dll`) and the local idempotency store
(`System.Data.SQLite.dll`) both reuse Idealpos's own bundled copies of
those libraries instead of pulling anything new onto a restaurant PC that
may not have reliable internet access — see `lib/PUT_DLLS_HERE.txt`.

---

## Validation status

**2026-08-19 preflight update.** This project was rebuilt with `dotnet build
-c Release` directly against the REAL `IdealPos.Webit.Core.dll` /
`IdealPos.Data.dll` / `IdealPos.Common.dll` / `Newtonsoft.Json.dll` /
`System.Data.SQLite.dll` (Idealpos v6.05.0001, `IdealPos.Webit.Core`
`Version=1.0.0.0`, `PublicKeyToken=c5adf46cc9f0e6c6`) — not a hand-written
stub — and `dotnet publish -r win-x64` also succeeded. This is genuine
**compile-time proof against the real vendor API surface**, stronger than
the earlier stub-based check this section previously described.

That earlier stub-based claim ("compiles cleanly ... against stub types
whose members exactly match the real decompiled ... signatures") did **not**
fully hold up: building against the real assembly found and required fixing
one real signature mismatch —
`LocalDataHelper.InsertOrders(IEnumerable<WebOrder>, Guid)` returns `void`
in the real DLL, not `int`/rows-affected as this project previously assumed
(`Idealpos/IdealposOrderSubmitter.cs` used to assign its result to
`int rows`, which would not even compile against the real assembly). Fixed:
`OrderSubmissionResult.RowsInserted` (which that non-existent return value
fed) has been removed — `Success = true` was, and remains, evidence only
that `InsertOrders()` did not throw, never evidence of a row count or of
native consumption. See `OrderLifecycleWatcher` for the only real evidence
of native consumption (`WebPendingOrder.Processed`).

Every other real-DLL member this project references (`WebOrder`'s
`OrderReference`/`HostReference`/`DeliverTo`/`Message`/`OrderDetail`/
`PaymentDetail`/`Items`/etc., `StockItem`'s `Code`/`Description`/`Quantity`/
`PricingMode`, `LocalDataHelper.GetIpsStockItemsDic()`) compiled cleanly on
the first attempt with the real assembly — no other signature mismatches
were found.

A second, independent-review-driven fix landed in the same pass: a
stale-timeout in `OrderLifecycleWatcher` used to transition an order
straight to `failed`, even when `WebPendingOrder.Processed=1` had already
been CONFIRMED (i.e. native Idealpos definitely consumed the order) — a
false claim of confirmed non-execution. A new `uncertain` terminal status
now covers every timeout case instead; see "Order lifecycle" below.

The pure-logic test suite (`Tests/`, runnable via `--selftest`, now
including new `OrderStatusTests` coverage for the `uncertain` fix) has
**not** been executed in this environment — running a `net48` executable
requires Windows (or Mono, untested here). That remains the next step, on
the real Windows machine: `VerduraIdealposBridge.exe --selftest`. This has
also still not been build- or run-tested against a real SQL Server /
running Idealpos process, since that also requires the real Windows
machine — see "Testing" below.

---

## Build

1. Copy the required DLLs into `lib/` (and `lib/x86/`, `lib/x64/`) — see
   `lib/PUT_DLLS_HERE.txt` for exact source paths in the Idealpos install.
2. ```
   cd VerduraIdealposBridge
   dotnet build -c Release
   ```
   If `dotnet build` can't find .NET Framework 4.8 reference assemblies,
   install the **.NET Framework 4.8 Targeting Pack** (part of Visual
   Studio's ".NET desktop development" workload, or standalone from
   Microsoft), or build from Visual Studio directly.
3. Output lands in `bin\Release\net48\`. The DLLs from `lib/` must sit next
   to `VerduraIdealposBridge.exe` at run time — either copy them into the
   output folder alongside `lib/`, or adjust the `<HintPath>`s in
   `VerduraIdealposBridge.csproj`.

## Configure

Edit `App.config` before running anything:

| Setting | Notes |
|---|---|
| `connectionStrings:IpsConnection` | Placeholder by default (`CHANGE_ME_TEST_SERVER`) — the bridge refuses to start until this is a real target, and refuses to silently fall back to `IdealPos.Webit.Core.dll`'s own hardcoded default (which would also match production). |
| `Bridge:ApiKey` | Required, no default. Generate a real secret (e.g. a GUID) and keep `App.config` out of source control / restrict its file permissions. |
| `Bridge:BindAddress` / `Bridge:Port` | Default `127.0.0.1:5588`. |
| `Bridge:AllowLan` | Must be explicitly `true` for a non-loopback `BindAddress` to take effect — a second, deliberate gate. See "Security". |
| `Idealpos:TableAssignmentStrategy` | Required, no default. One of `NoHint` / `DeliverTo` / `Message` / `ReferencePrefix` / `HostReference` — see "Table assignment" below. The bridge refuses to start without this set. |
| `Idealpos:TableAssignmentConfirmed` | Purely a labelling flag for `/api/health` and honest logging — flip to `true` only after `VerduraIdealposHarness` has demonstrated the chosen strategy actually works on this Idealpos version. |
| `Idealpos:PollingIntervalSeconds` / `Idealpos:OrderStaleTimeoutMinutes` | Background watcher cadence and give-up timeout. |
| `Bridge:StateDatabasePath` | SQLite file for idempotency/lifecycle tracking. |
| `Logging:Directory` / `Logging:MinLevel` | See "Logging". |

## Run

**Interactively, for testing** (also works if launched from a console even
without `--console`, via `Environment.UserInteractive`):
```
VerduraIdealposBridge.exe --console
```
Ctrl+C to stop.

**Self-test** (pure logic only — no SQL Server, no Idealpos DLLs actually
touched at the SQL level, just the validator/strategy code):
```
VerduraIdealposBridge.exe --selftest
```

**As a Windows Service** — see `deploy/install-service.ps1` (run elevated):
```powershell
.\deploy\install-service.ps1 -ServiceAccount "DOMAIN\VerduraBridgeSvc" -ServiceAccountPassword (Read-Host -AsSecureString)
Start-Service VerduraIdealposBridge
```
See `deploy/uninstall-service.ps1` to remove it.

### Which Windows account should the service run as?

`Trusted_Connection=True` in the connection string means the Windows
account running this service **is** the SQL Server login. The safest
starting point is the **same account `IdealposService` itself already runs
as** — it's already proven to work against this database:
```powershell
sc.exe qc IdealposService
```
look at `SERVICE_START_NAME` in the output and pass that to
`install-service.ps1 -ServiceAccount`. If you'd rather use a dedicated
account, create it and grant it a SQL Server login with **both**
`db_datareader` and `db_datawriter` on `IPSTransaction` —
`db_datawriter` is required because `LocalDataHelper.InsertOrders()`
performs a real `INSERT` into `dbo.WebPendingOrder`.

The service is configured for automatic start and automatic restart on
crash (`sc.exe failure ... actions= restart/5000/restart/5000/restart/30000`),
and `AutoLog=true` means a failed `OnStart` is written to the Windows
Application Event Log, not just lost.

---

## API

Full reference with example payloads: `examples/verdura-client-example.md`.
Runnable browser example: `examples/verdura-client-example.html`.

| Endpoint | Purpose |
|---|---|
| `GET /api/health` | Bridge status **and** Idealpos readiness — see "Health means two different things" below. |
| `GET /api/tables` | Read-only `dbo.TableMapSetups`. |
| `GET /api/products` | Idealpos's own `LocalDataHelper.GetIpsStockItemsDic()`. |
| `POST /api/orders` | Create a table order. Idempotent on `externalOrderId`. |
| `GET /api/orders/{externalOrderId}` | Current lifecycle state. |
| `GET /ws/orders` (WebSocket) | Real-time `order.statusChanged` push. |

Every endpoint, including `/api/health` and the WebSocket upgrade, requires
`Authorization: Bearer <Bridge:ApiKey>` — the one exception is that the
WebSocket route *also* accepts `?api_key=...` in the query string, because
browsers cannot set custom headers on a WebSocket handshake. This is a
documented, narrow exception, not a general auth bypass — see
`Http/HttpServer.cs`'s `CheckAuth`.

### Health means two different things — don't conflate them

`bridgeRunning: true` only means this process is alive. `/api/health`
separately reports `sqlConnected`, `assembliesLoaded`, `ipsExeRunning`,
`tableAssignmentConfirmed`, and a rolled-up `orderProcessingPathAvailable`
— check that last field, plus `reasons[]`, before letting Verdura staff
submit an order. See `Idealpos/AvailabilityChecker.cs`.

### Table assignment

`Idealpos:TableAssignmentStrategy` selects exactly one of
`VerduraIdealposHarness`'s five experiments (`TableAssignment/Strategies.cs`
mirrors harness Tests A–E field-for-field). Run the harness against this
Idealpos version first, see which test (if any) causes
`PendingSales.Code` to equal the requested table, then set the matching
strategy name here. Verdura's own contract never changes — it's always
`"table": "12"` regardless of which strategy is active internally
(`TableAssignment/ITableAssignmentStrategy.cs`).

If none of the five worked in your harness testing, set
`Idealpos:TableAssignmentStrategy=NoHint` — orders still reach Idealpos and
save the order-entry step, they just won't auto-attach to a table; staff
will see them in whatever unassigned/web-orders queue Idealpos uses and
allocate manually. `/api/health`'s `tableAssignmentConfirmed: false` and
the extra `reasons[]` entry make this state impossible to miss.

### Order lifecycle — confirmed vs heuristic

```
received -> validated -> submitted_to_idealpos -> pending_idealpos_processing
    -> processed -> assigned_to_table -> paid -> closed
                  \-> rejected              (corrupted-record cleanup path)
    submitted_to_idealpos/pending_idealpos_processing/processed
                  \-> uncertain             (watcher timed out — see below;
                                              NOT a confirmed failure)
    InsertOrders() throws -> failed         (the ONLY trigger for failed)
```

| Transition | Basis |
|---|---|
| `received` → `validated` | Bridge-local: table/products exist, quantities valid, not a duplicate. |
| `validated` → `submitted_to_idealpos` | `LocalDataHelper.InsertOrders()` returned without throwing. This is evidence the call did not throw — the real method returns `void` (confirmed 2026-08-19 against the real assembly), so there is no row-count or other feedback to treat as stronger proof than that. |
| → `pending_idealpos_processing` / `processed` | **Confirmed**: `dbo.WebPendingOrder.Processed` observed 0 then 1. |
| → `assigned_to_table` | **Not fully confirmed** (the harness's open question) — a `dbo.PendingSales` row was found; `tableMatchesRequest` tells you whether its `Code` actually equals the table you asked for. Check it. |
| → `rejected` | Confirmed code path: row disappeared from `WebPendingOrder` before `Processed=1`, matching `LocalDataHelper.GetPendingOrders()`'s corrupted-record cleanup for deserialization failures — not a business rejection signal (none exists in the local pipeline). |
| → `failed` | **Only** `InsertOrders()` itself throwing a confirmed exception. A stale timeout no longer reaches this state (see below) — fixed 2026-08-19, independent review. |
| → `uncertain` | `Idealpos:OrderStaleTimeoutMinutes` elapsed while still at `submitted_to_idealpos`/`pending_idealpos_processing`/`processed`. Deliberately distinct from `failed`: at `processed` specifically, `WebPendingOrder.Processed=1` WAS already confirmed — native Idealpos definitely consumed the order — so calling that "failed" would be false. `lastError` on an `uncertain` order states exactly which evidence was and wasn't confirmed. Terminal (never re-observed); resolve by checking the Idealpos UI/table directly, and confirm no duplicate exists before ever resubmitting under a new `externalOrderId`. |
| → `paid` → `closed` | **Heuristic, explicitly not confirmed against native IPS.exe's real behaviour**: the tracked `PendingSales` row disappeared. `Transactions` has a confirmed audit trigger but no confirmed foreign key back to `PendingSales`/`Reference`, so this bridge cannot currently prove *why* the row disappeared, only that it did. Validate this specifically during Test 8/9 below before relying on it operationally. |

Every one of these is implemented in `Orders/OrderLifecycleWatcher.cs`,
with the same confirmed/heuristic labelling in code comments at each
transition.

### Idempotency

`externalOrderId` is the SQLite primary key in `Orders/OrderStateStore.cs`.
`OrderService.SubmitOrder()` checks it **before** doing any Idealpos or
even validation work, and again after acquiring a per-table lock (race
safety). A repeat submission returns the existing record with
`"duplicate": true` and **never calls `InsertOrders()` a second time**.
`LocalDataHelper.InsertOrders()`'s own SQL is also naturally deduplicating
on `(WebReference, Origin)` — a defence-in-depth second layer, not the
primary mechanism.

### Concurrency / table safety

Order processing is serialized per requested table
(`ConcurrentDictionary<string, object>` of lock objects in
`OrderService.cs`) so two near-simultaneous submissions for the same table
don't race inside the bridge. `TableDto.LikelyOccupied` is surfaced as
`tableOccupiedWarning` on the order response rather than used to hard-block
submission — it's an explicit heuristic (`Amount > 0 OR Status != 0`), and
Idealpos's own `CheckTableLocked` was only confirmed to run on Doshii's
*payment* path (investigation Section K.4), not confirmed to run on this
local order-creation path at all. Hard-blocking on an unconfirmed heuristic
risks refusing legitimate orders; warning and logging is the honest middle
ground until live testing says otherwise.

### Payment stays in Idealpos

No endpoint in this project initiates or touches payment. The bridge only
*observes* (read-only) whether a tracked order's `PendingSales` row has
disappeared, and reports that as `paid`/`closed` — see the heuristic note
above. Staff open the table and use Idealpos's existing payment controls;
Idealpos talks to Eftpos exactly as it does today (investigation Section
I: every payment component found is a local, outbound-only client compiled
into `IPS.exe`).

---

## Security

- Binds to `127.0.0.1` by default. `Bridge:AllowLan=true` is required (in
  addition to changing `BindAddress`) before the bridge will start bound to
  anything else — two deliberate gates, not one.
- Every request needs `Authorization: Bearer <key>`. No unauthenticated
  route exists, including `/api/health`.
- If Verdura tablets call this bridge directly over the restaurant LAN,
  open the configured port (default `5588`) in Windows Firewall for the
  specific tablet subnet, e.g.:
  ```powershell
  New-NetFirewallRule -DisplayName "VerduraIdealposBridge" -Direction Inbound `
      -Protocol TCP -LocalPort 5588 -RemoteAddress 192.168.1.0/24 -Action Allow
  ```
  Scope `-RemoteAddress` as tightly as your network allows — don't open it
  to `Any`.
- No SQL connection string or credential is ever returned in an API
  response — check `Api/Endpoints.cs` if extending this; `/api/health`
  reports connectivity as a boolean + short detail string, never the
  connection string itself.
- `Bridge:ApiKey` comparison uses a constant-time check
  (`HttpServer.SecureEquals`) to avoid a timing side-channel.

## Logging

Structured `key=value` lines, one per event, written to
`Logging:Directory\bridge-YYYY-MM-DD.log` (`Logging/Logger.cs`) — no
external log aggregation dependency. Every order submission logs its
external order ID, table, product codes, the Idealpos submission attempt
and result, `WebPendingOrder`/`PendingSales` IDs as they're discovered, and
every state transition (`Orders/OrderLifecycleWatcher.cs`'s `Transition()`
helper). Secrets are never logged — `Logger.Redacted` exists as an explicit
marker for any call site that needs to note a value was intentionally
withheld.

---

## Testing

Reuse the disposable Idealpos test environment already set up for
`VerduraIdealposHarness` (`../idealpos-harness/README.md` "1. Set up
the disposable test environment"). Point this bridge's `App.config` at the
same test SQL Server. **Never point this at the live restaurant.**

| # | Test | How |
|---|---|---|
| 1 | Health | `GET /api/health` with the test instance running → `orderProcessingPathAvailable: true`. Stop `IPS.exe` and confirm it flips to `false` with a clear reason. |
| 2 | Products | `GET /api/products` → real demo stock items, not placeholders. |
| 3 | Tables | `GET /api/tables` → real demo `TableMapSetups` rows, including your test table (e.g. "12"). |
| 4 | Order submission | `POST /api/orders` per `examples/verdura-client-example.md` → exactly one new row appears in `dbo.WebPendingOrder`. |
| 5 | Native consumption | Watch `GET /api/orders/{id}` or the WebSocket feed → status reaches `processed` (`WebPendingOrder.Processed` flips to 1). |
| 6 | Table assignment | Status reaches `assigned_to_table` with `tableMatchesRequest: true` for the configured strategy — if `false` or it never arrives, that strategy doesn't work on this Idealpos version; try another. |
| 7 | UI | Table 12 shows active/occupied on the Idealpos client's table map; opening it shows the submitted items. |
| 8 | Payment | Pay normally through Idealpos, using a sandbox/test Eftpos terminal — never a live one. |
| 9 | Completion detection | Confirm the WebSocket feed emits `paid` then `closed` shortly after — this is the heuristic from "Order lifecycle" above; if it *doesn't* fire, or fires for the wrong reason, that's exactly the signal this bridge needs stronger evidence for. |
| 10 | Duplicate request | `POST /api/orders` twice with the same `externalOrderId` → second response has `"duplicate": true`, and exactly one `WebPendingOrder` row exists for it (check via SQL, not just the API's own claim). |

Only after all ten pass repeatedly against the disposable instance should
production configuration even be discussed.

---

## Project layout

```
VerduraIdealposBridge.csproj   net48, zero NuGet packages
App.config                     bind address/port, API key, SQL connection, strategy, logging
Program.cs                     entry point — console / --selftest / Windows Service
BridgeHost.cs                  wires every component together; used by both run modes
BridgeService.cs               ServiceBase wrapper
Config/BridgeConfig.cs         fail-closed App.config reader
Logging/Logger.cs              structured file logger
Idealpos/                      everything that touches Idealpos
  Dto.cs                         TableDto / ProductDto — confirmed fields vs documented heuristics
  IdealposAssemblyProbe.cs       optional DLL probing + load-check for /api/health
  IdealposReadRepository.cs      all read-only SQL (WebPendingOrder/PendingSales/PendingSaleLines/TableMapSetups) + GetIpsStockItemsDic()
  IdealposOrderSubmitter.cs      the only place this bridge writes to Idealpos — LocalDataHelper.InsertOrders()
  AvailabilityChecker.cs         /api/health's "bridge running" vs "Idealpos ready" logic
TableAssignment/                ITableAssignmentStrategy + the 5 harness-mirroring strategies + factory
Orders/                         idempotency store, validator, lifecycle watcher, orchestration
Http/                           HttpListener-based router, JSON helpers
Realtime/                       WebSocket hub + event shape
Api/                            endpoint handlers
Tests/                          pure-logic self-tests (--selftest), no SQL/Idealpos required
deploy/                         Windows Service install/uninstall PowerShell
examples/                       curl + browser client reference
```

## Known limitations / deliberately out of scope for v1

- WebSocket events are broadcast to every connected client — no per-table
  or per-tablet topic filtering yet. Fine for a single small restaurant
  deployment; add filtering if Verdura scales to many simultaneous tablets
  wanting only their own order's updates.
- `ProductDto.Available` is always `true` — `GetIpsStockItemsDic()`'s own
  SQL doesn't project an availability column, and this investigation never
  directly confirmed the exact column/table for the `AvailableOnline`
  property found via string extraction on a *different* Idealpos assembly.
  See `Idealpos/Dto.cs`'s comment before wiring this up.
- The `paid`/`closed` heuristic (a `PendingSales` row disappearing) is the
  single least-confirmed piece of this whole project — see Test 9 above.
- No multi-tenant/multi-site support — one bridge instance targets one
  Idealpos `IPSTransaction` database.
