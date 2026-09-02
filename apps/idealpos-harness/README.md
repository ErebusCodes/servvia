# VerduraIdealposHarness

A standalone .NET Framework 4.8 console harness that calls **Idealpos's own
assemblies** to determine, empirically, whether a `WebOrder` can carry a
table assignment through to a native `IPS.exe` pending sale — and if so,
which field does it.

It exists to answer exactly one question, and the Bridge's
`Idealpos:TableAssignmentConfirmed` flag depends on its answer.

> **Provenance.** This project previously lived at
> `C:\Users\Posmate\Documents\VerduraIdealposHarness\`. It was brought into
> the repository on 2026-09-03 under DL-114, which eliminates the
> `Documents`-root directories. Only source was moved — `bin/`, `obj/` and
> the three vendor DLLs were build output or copies of files already present
> in the licensed Idealpos install (verified byte-identical by SHA-256), so
> nothing unique was discarded. The original directory had no `README.md`;
> this file reconstructs one from `Program.cs`, the `.csproj`, `App.config`
> and `apps/idealpos-bridge/README.md`.

---

## The certification gate this harness serves

`Idealpos:TableAssignmentConfirmed` is a labelling flag on the Bridge that
feeds `/api/health` and the Bridge's logging. Per
`apps/idealpos-bridge/README.md`, it is to be flipped to `true` **only after
this harness has demonstrated that the chosen strategy actually works on
this Idealpos version.**

**Retiring the `Documents`-root copy of this project does not discharge,
weaken or bypass that gate.** The gate is satisfied by a harness *run*
producing evidence, not by where the source is stored. Nothing in this
relocation changes what `TableAssignmentConfirmed` requires.

The five strategies below correspond to
`apps/idealpos-bridge/TableAssignment/Strategies.cs`.

---

## Build

1. Copy the three vendor assemblies into `lib/` — see
   `lib/PUT_DLLS_HERE.txt`. They are **not** tracked in git (licensed
   third-party binaries, and a committed copy would go stale against the
   real install).

   Take `IdealPos.Webit.Core.dll` and `IdealPos.Common.dll` from
   `IdealposService\`, **not** from `Idealpos\` — on DESKTOP-SOKKOQ7 those
   two directories hold different builds.

2. Build:

   ```
   dotnet build apps\idealpos-harness\VerduraIdealposHarness.csproj -c Release
   ```

   Needs the .NET Framework 4.8 Developer/Targeting Pack if building with
   `dotnet build` rather than Visual Studio. Nothing else — the project
   references only in-box framework assemblies plus the three Idealpos DLLs,
   and pulls no NuGet packages.

## Set up a test database

`App.config` ships with a **deliberately unusable** connection string:
`Server=localhost\IDEALSQL`. `localhost` will not resolve to the POS box, so
the harness fails loudly on connect instead of silently falling back to
`IdealPos.Webit.Core.dll`'s own hardcoded default —
`Server=localhost\IDEALSQL;Database=IPSTransaction;Trusted_Connection=True;`
— which a **live production POS Server machine would also satisfy.**

Before `insert` will run, point it at a disposable test SQL Server instance
restored from `Idealpos/TemplateDatabases/ipstransactionnew.zip`'s
`database.bak`.

> **Do not point this at the live restaurant's POS Server.** `insert` writes
> a real `WebOrder` through Idealpos's own `LocalDataHelper.InsertOrders()`.

`insert` additionally requires two guard arguments that cannot be defaulted:
`--i-understand-this-is-a-test` and `--confirm-server <name>`.

## Commands

```
list-products [--filter TEXT] [--top N]
    Read-only. Calls Idealpos's own LocalDataHelper.GetIpsStockItemsDic()
    against the configured test database and prints real stock item codes
    for use with --burger/--chips/--coke. Run this first.

insert --test A|B|C|D|E --i-understand-this-is-a-test --confirm-server <name>
       [--table 12] [--burger CODE] [--chips CODE] [--coke CODE] [--auto-items]
    Constructs ONE real WebOrder and calls LocalDataHelper.InsertOrders().

watch <reference-or-prefix> [--interval-seconds 5] [--timeout-minutes 15]
    Read-only. Polls WebPendingOrder / PendingSales / PendingSaleLines for
    the given WebReference (prefix match) and reports what native IPS.exe
    has done with it. Never writes anything.
```

### The five experiments

| | Strategy |
| --- | --- |
| **A** | `OrderDetail=EatIn` only (baseline / no table hint) |
| **B** | `OrderDetail=EatIn`, `DeliverTo=<table>` |
| **C** | `OrderDetail=EatIn`, `Message="Table <table>"` |
| **D** | `OrderDetail=EatIn`, `OrderReference="T<table>-<base-reference>-D"` |
| **E** | `OrderDetail=EatIn`, `HostReference=<table>` |

**D** extrapolates the confirmed Doshii payment-side `OrderId` convention
`"<prefix>-<table>"` seen in `ProcessDoshiiService.ProjectPacket`. That is an
experiment, **not** a confirmed `WebOrder` convention.

### Example

```
VerduraIdealposHarness.exe list-products --filter burger
VerduraIdealposHarness.exe insert --test A --i-understand-this-is-a-test \
    --confirm-server "TESTPOS\IDEALSQL" --auto-items
VerduraIdealposHarness.exe watch VERDURA-TEST-0001-A
```

## Related

- `apps/idealpos-bridge/README.md` — the Bridge that consumes this answer;
  see its `Idealpos:TableAssignmentConfirmed` row.
- `apps/idealpos-bridge/TableAssignment/Strategies.cs` — the same five
  strategies as implemented in the Bridge.
- `_bmad-output/implementation-artifacts/dl-107-dunedin-live-certification-runbook.md`
  — the live-order certification this feeds.
