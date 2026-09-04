# STAGED — Bridge read-only POSServer config delta

**Status: PREPARED, NOT APPLIED.** Staged 2026-09-04, after the production
change freeze. No production config, service or release was touched.

Apply only in an approved change window.

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
