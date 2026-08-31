# DL-113 — The POSServer table-sale protocol, and what it settles about the cross-store transition

Read-only. **No database access of any kind in this phase** — not even a `SELECT`. No UI action, no
click, no caption change, no transfer, no option altered, no order created or modified. IPS.exe was
not read. Every finding below comes from static analysis of the decompiled managed assemblies already
present at `.tmp-idealpos-il-tools/`, which are vendor diagnostic artifacts kept on disk and never
redistributed.

Adds evidence to DL-112 and supersedes none of it. DL-112 §A4b remains authoritative on the two-store
model; this document identifies the mechanism behind it and, in §4, corrects one detail of the
"capture the POSServer identity" half of the corrected model.

Why this was reachable at all: DL-108 through DL-112 worked against `IPS.exe`, a VB6 binary that had
to be read as raw literals and decoded branches. POSServer is **managed .NET**, and
`POSServer.Communication.dll` decompiles cleanly. The pending-sale side of the transition was
therefore readable as ordinary source, not inferred from string offsets.

## 1. POSServer's pending-sale store is written by exactly five packets

`POSServer.Communication` implements a text-packet protocol; every handler is a `BaseTextPacket`
subclass keyed by a 9-character `Identifier`. The complete set that writes `PendingSales`:

| Identifier | Handler | Effect on `POSServer.dbo.PendingSales` |
|---|---|---|
| `TABLEDATA` | `UpdateDataRequest` | **Replace one table.** Loads by `(Code, Map, Pos=1)`, marks the row and all its lines deleted, saves, then inserts a brand-new row and lines in a transaction. |
| `NEWLINES` | `AdditionalDataRequest` | **Append to one table.** Loads by `(Code, Map, Pos=1)`, **creates the row if absent**, appends lines continuing the existing line numbering, saves. |
| `DELETE` | `DeleteDataRequest` | Removes one table's sale. |
| `SYSDATA` | `SystemDataRequest` | **Full snapshot.** `ProcessPendingSales` calls `PendingSalesCollection().ClearAll()` and rebuilds the entire store from the pushed XML. |
| `CLEARDATA` | `ClearDataRequest` | Bit 2 clears `PendingSales`, `TableMaps` and `DELETE FROM TablePayments`. |

Two things follow immediately, and both matter more than they look.

**`POSServer.dbo.PendingSales` is a replica, not a system of record.** It is maintained entirely by
pushes from POS terminals. Nothing in the protocol lets an outside party register a sale into it; the
only writers are these handlers, and the only senders are Idealpos's own terminals.

**Its row IDs are not durable.** `TABLEDATA` regenerates a table's ID on *every ordinary update*, and
`SYSDATA` regenerates every ID in the store. The IDs observed live in DL-112 §A4b (99408 / 99410 /
99411) are the identities of one moment, not handles.

## 2. `MOVETABLE` is not a sale transfer — it is floor-plan geometry

Worth recording explicitly, because the name invites exactly the wrong conclusion. `MoveRequest`
(`MOVETABLE`) parses four fixed-width integers and does this:

```
TableMapSetups tableMapSetups = new TableMapSetups();
if (tableMapSetups.LoadByPrimaryKey(code, 3, itemIndex))
{
    tableMapSetups.X1 = value;
    tableMapSetups.Y1 = value2;
    tableMapSetups.Save();
}
```

It moves a table's icon on the floor plan. It does not touch `PendingSales` and moves no sale. No
packet in the protocol transfers a sale between tables.

## 3. The exact native Web Order → POSServer table transition: **DEFINITIVELY BLOCKED**, and now for a named reason

The transition, stated precisely:

```
IPSTransaction.dbo.PendingSales (WB* web order, Webit-ingested)
      |
      |  (1) a POS terminal must load that sale and save it to a table
      v
IPS.exe emits TABLEDATA (or NEWLINES) for that table code
      |
      |  (2) POSServer applies the handler
      v
POSServer.dbo.PendingSales row, Code = table, Map, Pos = 1
```

Step 2 is not the blocker. POSServer would accept `TABLEDATA` for table 5 without complaint —
`NEWLINES` will even create the row if it does not exist. The protocol has no notion of a sale's
origin and no web-order-specific rejection.

**Step 1 is the blocker, and it is inside IPS.exe.** DL-112 §A2 already decoded the guard: `frmSale`
refuses to convert a recalled *pending sale* into a table sale and raises `Cannot Transfer to Table!`
(literal at `0x003b4ecc`, single reference at `0x0228f3fb`). DL-112 §A3 established that Web Orders
mode hides `cmdTransferToTable`, so `PDTF` is unreachable for `WB*` rows. Between them, no terminal
action exists that would cause a `WB*` sale to be emitted as `TABLEDATA` for a table.

This sharpens DL-112's finding rather than replacing it. The earlier documents established *that*
there is no path; this one establishes *where* the missing link is — the POSServer side is willing,
and the whole prohibition lives in the IPS.exe terminal. It also independently explains DL-112 §A4b
observation 2 ("`WBORD-600002` was never registered with POSServer"): a Webit row is injected
straight into `IPSTransaction` and is never the subject of a terminal's `TABLEDATA` push, so it can
never appear in POSServer. The natively created `WBORD` propagated to both stores precisely because
it *was* keyed in on a terminal.

**DL-111 Q7/Q8 remain the gate.** Nothing here authorises a transfer, and nothing here changes the
duplicate-KOT position.

## 4. Correction to DL-112 §A4b's corrected model: do not capture the POSServer identity

DL-112 §A4b's corrected model ends with "resolve by `Code = requested table`, `Map`, `POS`". That is
right. But every earlier framing — including this project's own first implementation of it — also
carried the instruction to *capture* the POSServer identity and follow it, inherited from the
single-store model in §A4.

Given §1, capturing a POSServer **ID** is unsafe. `TABLEDATA` deletes and re-inserts the row on any
ordinary table edit, so a stored ID goes stale the first time staff add a round. Code that
re-resolved by that ID would find nothing and — in the bridge's case — would have read "row gone" as
"table closed, order paid", mid-service, on a live table.

The durable handle is the natural key POSServer's own handlers query on: **`(Code, Map, Pos=1)`**.
Both `NEWLINES` and `TABLEDATA` load by exactly that.

This was found and fixed in the same session that introduced it; see
`apps/idealpos-bridge/Orders/Reconciliation.cs` and `PosServerReadRepository.TableSaleIsOpen`, which
has no `GetById` by deliberate omission.

## 5. Second-round append: the mechanism exists natively and is not reachable from Verdura

`NEWLINES` is a genuine append, and a well-behaved one: it loads the existing sale, continues line
numbering from the current count, adds only the new lines, and saves. It does not rewrite what is
already there. This is the mechanism behind DL-112's incidental KOT evidence — Table 17's 21 lines
accumulated across 54 minutes with every line `Printed=1` and none `Printed=0`.

So the native capability Verdura needs for a second round already exists and is already exercised
daily at this venue. Verdura cannot reach it, for two independent reasons:

1. **There is no row to append to.** `NEWLINES` targets `(Code, Map, Pos=1)`. Until a Verdura order
   is a POSServer table sale, there is no such row — and §3 is why there never is one. This is not a
   second blocker; it is the first blocker again.
2. **The bridge does not speak this protocol.** It submits through `IdealPos.Webit.Core`'s
   `InsertOrders()`, which writes `IPSTransaction.dbo.WebPendingOrder`. `NEWLINES` is a POSServer
   socket packet from a terminal. Even with the row present, emitting it would mean impersonating an
   Idealpos terminal on the POSServer protocol — which is not a supported integration, is not
   authorised, and is not proposed here.

Note what `NEWLINES` would do if it *were* sent for a table with no existing row: it would create
one. That is a route to fabricating a table sale that bypasses every native guard in §3, and it must
not be taken. Recorded so the option is explicitly closed rather than quietly rediscovered.

## 6. Verdict

| Item | Status |
|---|---|
| Native Web Order → POSServer table transition | **DEFINITIVELY BLOCKED** — POSServer would accept it; IPS.exe will not emit it (DL-112 §A2/§A3) |
| Blocking component | IPS.exe terminal, not POSServer, not the protocol, not permissions |
| `MOVETABLE` as a transfer path | **RULED OUT** — floor-plan geometry only |
| Deterministic cross-store linkage | **IDENTIFIED** — `(Code, Map, Pos=1)`, POSServer's own natural key |
| Capturing a POSServer row ID | **UNSAFE** — regenerated by `TABLEDATA`/`SYSDATA` (corrects §A4) |
| Native second-round append | **EXISTS** (`NEWLINES`), unreachable from Verdura for the §3 reason |
| Writing to POSServer to force a table sale | **PROHIBITED** — bypasses every guard in §3 |
| Controlled ORD-600002 → Table 5 proof | **NOT READY** — see §7 |
| Release decision | unchanged — **NO-GO — DINE-IN ORDER TABLET** |

## 7. Why a controlled ORD-600002 → Table 5 proof is not ready

There is no supported action that would perform it. The three conceivable routes are each closed:

- **Native transfer (`PDTF`)** — unreachable for `WB*` (DL-112 §A3), and `TableTransfersToKitchen=1`
  with zero historical `PDTF` events means the KOT question is unresolved (DL-112 §3, downgraded but
  not cleared in §A4b). DL-112 already recorded that no controlled transfer test is authorised.
- **Recall then convert on the sale screen** — proven to fail on the installed build with
  `Cannot Transfer to Table!` (DL-112 §A2).
- **Direct write to POSServer (`TABLEDATA`/`NEWLINES`, or raw SQL)** — would fabricate a table sale
  outside every native guard, including the KOT path. Prohibited, per §5.

A proof would additionally need Table 5 to be free at the time (last verified `Status=0` Ready,
`StartTime` NULL, DL-112 §A6) and would have to run outside live service. Neither condition is the
binding constraint; the absence of any permitted mechanism is.

**Blocked on DL-111 Q7 and Q8.** Unchanged, and this document adds no route around them.

## 8. State verified unchanged

No state was read or written in this phase. The last verified values stand as recorded in DL-112 §A6:
`PendingSales` 4522 (`WBORD-600002`) and 4523 (`WBORD`) open and unmodified; `dbo.WebPendingOrder` 2
rows; `TableMapSetups` Table 5 `Status=0` Ready, `StartTime` NULL; `TableTransfersToKitchen=1`, no
option written; `PDTF` event count 0.

DL-112 §A5's standing operational risk is also unchanged and still not actioned: 4522 and 4523 remain
open in a live venue, and clearing them is a production mutation needing its own plan and approval.

---

# Addendum — POSServer's two WCF services, and why `ITableOrdering` is not what its name suggests

Read-only. No database access, no live service contacted, no HTTP request issued, no registry value
written. Static decompilation of an installed vendor assembly, plus one registry read.

Recorded because the name is actively misleading and the next reader will otherwise spend a day on
it, exactly as this phase nearly did. `POSServer.Communication` contains
`ApplicationLog.Write("Creating TableOrderingHost")` and hosts a WCF endpoint literally called
`tableordering` — which reads, on first encounter, as a supported table-order write API and therefore
as the answer to DL-111 Q5.

It is not. It is a floor-plan picture renderer.

## B1. The contract

`ITableOrdering` lives in `POSServer.API.WCF`, shipped in
`C:\Program Files\Idealpos Solutions\POSServer\POSServer.WCF.dll` (installed at this site; not
previously decompiled, hence not covered by DL-108 through DL-113 §1-§8). Its complete surface:

```csharp
public interface ITableOrdering
{
    [OperationContract] [WebGet(UriTemplate = "/map/{mapnumber}")] Stream Map(string mapNumber);
    [OperationContract] [WebGet(UriTemplate = "/maps/")]           Stream MapIndex();
}
```

Two operations, both `WebGet`. There is no `WebInvoke`, so nothing on this contract accepts a body
and nothing writes. The implementing class `TableOrdering` emits HTML5 canvas drawing script —
`ctx.fillStyle`, `ctx.fillRect`, `ctx.font`, with a private `ItemType { None, Box, Line, Table }`
enum for the shapes it draws. It renders the table map as a picture for a browser.

It reads `TableMapSetups` geometry. It does not touch `PendingSales` at all.

## B2. It is not even running here

The host is gated in `Listener`'s constructor:

```csharp
using RegistryKey registryKey2 = registryKey.OpenSubKey("SOFTWARE\Idealpos Solutions\POSServer");
if ((int)registryKey2.GetValue("TableOrdering", 0) == 1) { createTableService = true; }
```

Read live from this host: `HKLM\SOFTWARE\Idealpos Solutions\POSServer` exists and holds exactly three
values — `FIX1`, `InstallDate`, `InstallPath`. There is no `TableOrdering` value, so `GetValue`
returns its default `0`, `createTableService` stays false, and `TableOrderingHost` is never
constructed. The endpoint at `http://localhost:{WCFPort}/tableordering/` is not listening.

No request was sent to confirm that, deliberately: POSServer is a live production service and
probing it is an action against production, not an observation of it.

## B3. The other WCF service, for completeness

`StockControlHost` **is** started unconditionally. Its contract `IStockService`
(`http://au.com.idealpos.stock/`) is stocktake only: `GetLocations`, `GetPriceDescriptors`,
`GetStockItems`, `GetSuppliers`, `GetData`, `Ping`, `GetFile`, `RegisterDevice`, `VerifyAccess`,
`SubmitResults`, `TransferResults`. Its four `WebInvoke` operations write stocktake results and
device registrations. None creates a sale, assigns a table, or appends a line.

## B4. Consequence

Both of POSServer's WCF surfaces are now accounted for, and neither is an order-ingestion path. Taken
with §1 of this document — where the pending-sale store is shown to be written only by the five
terminal-push packet handlers — **POSServer exposes no supported way for a third party to create a
sale, assign a table, or append a round.** §3's conclusion is unchanged and now rests on a complete
enumeration of POSServer's external surface rather than on the packet protocol alone.

This closes local API archaeology on POSServer. The remaining routes are the ones DL-111 already
asks the vendor about, and the handheld/WaiterPad interface on TCP 12183 remains the only candidate
that performs order → table → KOT → append as one native operation.

| Question | Answer |
|---|---|
| `ITableOrdering` an order-ingestion API | **NO** — floor-plan renderer, read-only |
| Table ordering service active at this venue | **NO** — registry value absent, host never started |
| Order creation capability | **NO** |
| Table assignment capability | **NO** |
| Append capability | **NO** |
