# Bridge read-only POSServer config delta

**Status: APPLIED 2026-09-04 22:33, WITH TWO CORRECTIONS.** See
"Corrections found on application" immediately below before reading the rest
of this document — as originally staged, this delta would have been a silent
no-op.

---

## Corrections found on application

### Correction 1 — wrong config section (would have been a silent no-op)

The delta below said to add an `<appSettings>` key
`Bridge:PosServerConnection`. `BridgeConfig.cs` actually reads
`ConfigurationManager.ConnectionStrings["PosServerConnection"]` — a
`<connectionStrings>` entry. The staged text had trusted a stale comment in
`OrderLifecycleWatcher.cs` ("Null unless Bridge:PosServerConnection is
configured") rather than the loader. Applying it verbatim would have
changed nothing and left `_posServerRepo` null while appearing to succeed.

**What was actually applied** (into `<connectionStrings>`):

```xml
<add name="PosServerConnection"
     connectionString="Server=localhost\IDEALSQL;Database=POSServer;Trusted_Connection=True;"
     providerName="System.Data.SqlClient" />
```

### Correction 2 — the deployed binary has no cross-store code at all

More fundamentally: the Bridge running in production is built from commit
`abe301a`, and **cross-store reconciliation does not exist in it**.
`PosServerReadRepository.cs`, `BridgeConfig.PosServerConnectionString` and
`OrderLifecycleWatcher.ObserveTableLink` were all added later, in `8d0cd1a`
(with `4b2a394` and `442a7c4` after it). Verified three ways: the file is
absent from `git ls-tree abe301a`; `git show abe301a:.../BridgeConfig.cs`
contains no `PosServer` symbol; and the live Bridge log after restart emits
neither `watcher_cross_store_disabled` nor any POSServer line, because
neither exists in that build.

**Consequence: the connection string applied above is INERT today.** It is
correct and validated, but it activates only when a Bridge built from a
commit containing `8d0cd1a` is deployed. That deployment has NOT been done —
it is a larger change than this config delta, and it grants a live
connection to a production restaurant database as `NT AUTHORITY\SYSTEM`
(see "Permission caveat" below, which is why least-privilege hardening
should land with it rather than after it).

### What DID take effect

The `ExpectedIpsExePath` correction is honoured by the deployed binary
(`BridgeConfig.cs` line 82 at `abe301a`), and `/api/health` went from
`ipsExePathExists: false` to `true`.

---

## Original staged delta (retained for the record — see corrections above)

---

## Why

`OrderLifecycleWatcher.ObserveTableLink` is the only mechanism that can ever
move an order to `assigned_to_table`, and it is a no-op today:

```csharp
if (_posServerRepo == null) {
    Logger.Debug("watcher_cross_store_disabled", ...);
    return;
}
```

`_posServerRepo` is null because `Bridge:PosServerConnection` is unset in the
deployed config, so cross-store reconciliation never runs and the Bridge can
never report a table observation to anyone.

## The delta

Two `<appSettings>` changes to
`C:\ProgramData\Verdura\config\bridge\VerduraIdealposBridge.exe.config`.

### 1. Enable read-only cross-store reconciliation (ADD)

```xml
<add key="Bridge:PosServerConnection"
     value="Server=localhost\IDEALSQL;Database=POSServer;Trusted_Connection=True;" />
```

Derived from the already-deployed `IpsConnection`, changing only the database
name. Same instance, same integrated auth — **no new credential is introduced
and nothing secret is added to the file.**

### 2. Correct the IPS executable path (CHANGE)

```diff
-<add key="Idealpos:ExpectedIpsExePath" value="C:\Idealpos\IPS.exe" />
+<add key="Idealpos:ExpectedIpsExePath" value="C:\Program Files (x86)\Idealpos Solutions\Idealpos\IPS.exe" />
```

The configured path does not exist. The running process is
`C:\Program Files (x86)\Idealpos Solutions\Idealpos\ips.exe` (verified against
the live `IPS` process). `AvailabilityChecker` reports `IpsExePathExists` from
`File.Exists()` on this value, so `/api/health` currently reports `false` while
IdealPOS is running. It is **reporting only** — the value is not added to
`reasons` and does not gate `OrderProcessingPathAvailable` — so this is a
health-accuracy fix, not a functional one.

## Read-only validation already performed (2026-09-04)

Executed against the live instance as `DESKTOP-SOKKOQ7\Posmate`. **Only
`SELECT` and catalog reads were issued; no `INSERT`/`UPDATE`/`DELETE`/DDL.**

| Check | Result |
| --- | --- |
| `POSServer` database exists | **Yes** — `state_desc = ONLINE`, `is_read_only = False` |
| Required table `dbo.PendingSales` | **Present** — 16 columns |
| Related `dbo.PendingSaleLines` | **Present** — 18 columns |
| The exact repository query `select ID, Code, Map, POS from dbo.PendingSales order by ID desc` | **Compiles and executes**, returned 2 rows |
| Rows returned | `ID 99410 Code 'WBORD' Map 0 POS 1`, `ID 99408 Code '0' Map 1 POS 1` |
| Mutation exercised | **None** |
| Integration stored procedures | **None** in `POSServer`; only a `TRIM` function in `IPSTransaction` |

`ID 99410` is the manually typed `WBORD` decoy row that `Reconciliation`'s own
comments warn about — its presence is exactly why `IsAnchorMatch` is an exact
comparison and not a prefix match.

## Permission caveat — read this before applying

The validation above ran as `DESKTOP-SOKKOQ7\Posmate`, who **is `sysadmin`**.
That does not by itself prove the Bridge can read POSServer, because the Bridge
runs as **LocalSystem** and connects as `NT AUTHORITY\SYSTEM`.

Verified separately: `NT AUTHORITY\SYSTEM` **is a member of `sysadmin`**, so
the connection will succeed.

**This is not least privilege.** `POSServer` has no scoped database principals
at all; access is purely server-role based, so the Bridge's connection will
carry full write authority over a live restaurant database while its code
(`PosServerReadRepository`) only ever issues `SELECT`. Recommended hardening,
separate from this change: create a dedicated login with `CONNECT` on
`POSServer` and `SELECT` on `dbo.PendingSales` only, and point
`Bridge:PosServerConnection` at it.

## What this does NOT achieve

Enabling it does **not** produce automatic table assignment. Verdura still
cannot cause an IdealPOS table assignment — the Webit `WebOrder` contract has
no table field. This only lets the Bridge *observe* a table sale that already
exists and report `assigned_to_table`.

It is also correlation-grade, not proof. `Reconciliation.SelectTableSale`
matches purely on `Code == requestedTable` at `Pos == 1`, and neither
`PendingSales` nor `PendingSaleLines` has any column referencing a web order,
so a staff-created walk-in on the same table satisfies it identically.

## Rollback

Fully reversible, config-only, no data migration.

1. Snapshot first:
   `copy "C:\ProgramData\Verdura\config\bridge\VerduraIdealposBridge.exe.config" "C:\ProgramData\Verdura\rollback\bridge-posserver-readback-<date>\VerduraIdealposBridge.exe.config.pre"`
2. Apply the two `appSettings` edits.
3. Restart `VerduraIdealposBridgeSvc` only. It has no dependent services.
4. Verify `/api/health` reports `sqlConnected: true` and `ipsExePathExists: true`.
5. To roll back: restore the `.pre` file and restart the service. Removing
   `Bridge:PosServerConnection` returns `_posServerRepo` to null, and the
   watcher goes back to logging `watcher_cross_store_disabled` — the exact
   behaviour in production today.

Rollback carries no risk of data loss: nothing in this change writes to any
database.
