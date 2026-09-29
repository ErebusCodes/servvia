# DL-110 — Dunedin Ideal Handheld: independent verification of DL-109, and two material corrections

Bounded read-only phase. No packet sent. No IdealPOS mutation. No order created. No Finalize/Transfer.
`NoHint` and `TableAssignmentConfirmed` unchanged. All database access was `SELECT`. ORD-600002 untouched.

Purpose: re-derive DL-109's load-bearing claims from the installed artefacts rather than accept them.
Most reproduced exactly. **Two did not**, and both change the verdict's basis.

## 1. Claims that reproduced exactly

| Claim | Verified |
|---|---|
| IPS.exe `7.133.0200`, SHA256 `F18475A7…A520E` | yes, byte-for-byte |
| POSServer.Communication.dll `8.0.0.1`, SHA256 `E1028E23…91D0` | yes |
| IPS pid 17896 sole TCP listener `0.0.0.0:12183` | yes |
| POSServer pid 7136 listening `0.0.0.0:11000` + `[::]:11000` | yes |
| Bridge listening `127.0.0.1:5588` | yes |
| Licence `Options=Pack 2`, Enabled=True, expiry 14 Sep 2026, Type=2 | yes — latest record 20260831 14:27:15 |
| Zero "handheld"/"waiterpad" occurrences in any Idealpos log | yes |
| `AAAExampleData` `IH-%` rows | **0** — handheld ordering has never run here |
| No licence/module/device table in `IPSTransaction` | yes |
| ORD-600002 preserved | yes — `PendingSales` 4522, `Code=WBORD-600002`, POS=1, Status=0, ClerkID=1, Reference NULL |
| Table 5 Ready | yes — `TableMapSetups` Code=1 Type=3 Index=5 Caption=`5` Status=0 Seats=4 StartTime NULL |
| `NoHint` / `TableAssignmentConfirmed=false` | yes, in both source and deployed `.exe.config` |

New corroboration on the licence, stronger than DL-109 had: the module-name string table sits
immediately adjacent to the `IPS.clsOnlineLicensing.CheckModules` literal, and `IDEAL HANDHELD`,
`Pack 1` and `Pack 2` are **peers in that same table** —

```
…IPS.clsOnlineLicensing.CheckModules…IDEAL HANDHELD…Back Office…Bevcon…
Head Office…Idealpos Reservations…Netcomm Modem…Pack 1…Pack 2…PC Eftpos NZ…
```

`Pack 2` is itself a module name in the same namespace, not self-evidently a bundle. `Pack 1` and
`Pack 2` are the only `Pack N` literals in the binary. A linear membership test over the licensed
array would need `IDEAL HANDHELD` in that array; the gateway reports only `Pack 2`.

## 2. CORRECTION 1 — the installed POSServer has no `IHORDER` handler

DL-109 §2 stated the installed `POSServer.Communication.dll` "was confirmed to contain `IHORDER`,
`IHSALE`, `IHENQUIRY`, `IHPAYMENT`, `WPPacket`, `ACKDATA`, `NAKDATA`, `OrderItem`, `PriceLevel`,
`TaxString` — so the decompiled implementation reviewed in DL-108 **is** the installed build, closing
that caveat."

**That caveat is not closed. It is open, and it fails.**

Full command vocabulary extracted from the installed DLL's user-string heap:

```
IHSALE (3)   IHENQUIRY (1)   IHPAYMENT (2)
ACKDATA  NAKDATA  DUPLICATE  WPPacket  SENDSTAT  VALIDCLERKS
LOCKED ISLOCKED LOCKTAB LOCKALL UNLOCKTAB TABEXISTS TABLEDATA MOVETABLE
GETORDER HELDORDCD BARTAB CLIPP PAYPAL TYRO…
```

**`IHORDER` is absent.** So are `OrderItem`, `StockItem`, `PriceLevel` and `TaxString` — in UTF-8 and
UTF-16, in that DLL and in *every* `.dll`/`.exe` in the POSServer install:

| File | IHORDER | OrderItem | StockItem | PriceLevel | TaxString |
|---|---|---|---|---|---|
| POSServer.Communication.dll | 0 | 0 | 0 | 0 | 0 |
| POSServer.WCF.dll | 0 | 0 | 15 | 0 | 0 |
| IdealposObjects.dll (v7.1.0.5) | 0 | 0 | 3 | 6 | 3 |
| POSServer.exe / .Core / .Data | 0 | 0 | 0 | 0 | 0 |

The `StockItem`/`PriceLevel`/`TaxString` hits in `IdealposObjects.dll` are generic data-object member
names, not handheld packet fields. A filesystem-wide search found exactly **one**
`POSServer.Communication.dll` on this machine — v8.0.0.1, dated 2021-07-14. No newer build is staged.

**Consequence:** the installed POSServer build predates or omits handheld *order ingestion*. It can
answer sale/enquiry/payment traffic but has no command to create an order. The `IHORDER`
implementation described in DL-108 §3 and DL-109 §3/§5/§6 belongs to a **different, newer build** —
exactly the risk the brief warned about. Every conclusion DL-109 drew from it about **this**
installation is therefore unsupported, specifically:

- the POSServer append/second-round semantics (DL-109 §5)
- the caller-becomes-price-authoritative risk (DL-109 §6)
- the 100-entry / 10-minute in-memory duplicate ring (DL-109 §4)

Those may still describe some Idealpos build. They are not evidence about Dunedin.

By contrast, IPS.exe v7.133.0200 **does** carry the complete WaiterPad order vocabulary:
`WPType`, `PROTOCOL2`, `RootMenuCode`, `REQUESTPROGRAM`, `REQUESTTABLESTATUS`, `PRINTBILL`, `LOGOUT`,
`OrderItem`, `StockItem`, `PriceLevel`, `TaxString`, `Checksum`, `LastCheckSum`, `DeviceID`,
`POSTerminal`, `Guests`, `NAKREGO`, `BAD REGO`, `NAKPRINT`, `HandheldProcessing`, `Parsing from Index`,
and the gate `NOT HandheldLicensed`.

**So there is exactly one order-ingestion handler on this installation — IPS.exe — and it is the
licence-gated one.** There is no unlicensed fallback path. This makes the licence blocker total
rather than merely preferable, and it removes the "POSServer prints no KOT / steals pricing" dilemma:
that path cannot take an order here at all.

## 3. CORRECTION 2 — governance is half-tracked, not untracked

DL-109 §10 reported "zero files matching `verduraIdealposBridge`" in `verdura_MVP`. That was a
string-match artefact. Tracked at `9f17006` (canonical repository):

- `apps/venue-connector/src/VerduraIdealposTracer.Core/OrderSubmission/IdealposBridgeClient.cs`
- `apps/venue-connector/tests/VerduraIdealposTracer.Tests/IdealposBridgeClientTests.cs`

That file defines `BridgeOrderRequest(ExternalOrderId, Table, Items, Notes)` and `BridgeOrderItem` —
i.e. **the Bridge's `POST /api/orders` contract is governed source.** It also encodes a structural
invariant worth preserving: the request record has nowhere to put a price, so the connector
physically cannot send one.

What is **not** tracked is the Bridge *server* — `C:\Users\Posmate\Documents\verduraBridge\
verduraIdealposBridge` (31 `.cs` files including `Idealpos/IdealposOrderSubmitter.cs`,
`TableAssignment/ITableAssignmentStrategy.cs`, `Strategies.cs`, `TableAssignmentStrategyFactory.cs`,
`Orders/OrderService.cs`). No `.git` exists at any ancestor directory; the path was walked to the
drive root.

The corrected statement: **the client half is governed; the server half — precisely where a WaiterPad
transport would be implemented — is not.** The governance blocker stands, and it lands exactly on the
code this work would touch.

## 4. Values that remain correct for a future Table 5 packet

Table `5`; Map `1`; Location `1`; Pos `1`; StockItem `708`; Qty `1`; native price `23.0000`
(`StockItemsValue` Type=1 Level=1); `ECOMMERCEPRICELEVEL = 1`.

Still not derivable, unchanged from DL-109: **POSTerminal** (`POSTerminal.xml` lists only
`Code="1"` and `Code="2"` — BACKOFFICE and POS; a handheld's terminal identity belongs to the
registered device) and **Clerk** (a business decision; `VALIDCLERKS` lives in the POSServer DLL,
live tables use 108, Webit uses 1).

Note `HANDHELDDEFAULTMAP` is **blank** in `dbo.Options` — the handheld default map has never been
configured, consistent with the feature never having run. `HANDHELDV7FEATURES=1` is a
behaviour toggle in the Options table, **not** licence evidence; the gate is the module check in
IPS.exe.

## 5. Verdict

Unchanged in direction, strengthened in basis. Three blockers:

1. **Ideal Handheld licence not present** (high confidence; dealer confirmation closes the residual
   question of whether `Pack 2` expands server-side).
2. **No unlicensed fallback** — the installed POSServer cannot ingest handheld orders at all
   (new finding; removes the alternative DL-109 left open).
3. **Bridge server source ungoverned** — the exact code a transport would be added to.

Device registration remains uncharacterisable locally (`NAKREGO`, `BAD REGO`, `WP Current Count=`,
`Adding <x> to current devices.`, `DeviceID`, `LastCheckSum` are all IPS.exe-internal; no device table
exists in either database). It cannot be characterised without a licensed device, so it is not an
independent blocker — it is downstream of blocker 1.
