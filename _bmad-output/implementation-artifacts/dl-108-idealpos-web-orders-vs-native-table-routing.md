# DL-108 — IdealPOS Web Orders queue vs. native table routing (ORD-600002 forensics)

Read-only investigation. No code changed, no config changed, no order submitted, no native UI action
taken. Every database access was a `SELECT`. ORD-600002 preserved unchanged.

Supersedes the working assumption in `table-assignment-review.md` (2026-08-19) that one of five
`ITableAssignmentStrategy` values would resolve native table assignment.

## 1. Physical evidence (operator observation at the Dunedin terminal, 2026-08-31)

Authoritative, from three screenshots taken at the live POS:

- **SCREEN 1** — main POS screen shows a separate top banner: `WEB ORDERS 1`.
- **SCREEN 2** — a dedicated `Web Orders` screen listing ORD-600002: Chicken Ballista Pizza, $23.00,
  expected time ~20:08, reference shown as `ORD-600002`. Available actions: **Reprint Kitchen**,
  **Print**, **Finalize**.
- **SCREEN 3** — the normal Table Map shows Table 5 as `Ready` (unoccupied).

Exactly one physical kitchen docket printed. No duplicate order, no duplicate KOT.

This proves the web-order queue and the table map are **separate native states**, not one state with a
wrong label.

## 2. Environment as installed (not as previously assumed)

| Fact | Value | Source |
|---|---|---|
| IPS.exe version | **7.133.0200** | file version resource (the 2026-08-19 preflight assumed v6.05) |
| SQL instance | `DESKTOP-SOKKOQ7\IDEALSQL`, db `IPSTransaction` | live |
| `IDEALWEBITAUTOPRINTKITCHEN` | `-1` (true) | `dbo.Options` |
| `IDEALWEBITAUTOFINALIZE` | `0` (false) | `dbo.Options` |
| `IDEALWEBITTENDER` | `0` (unset) | `dbo.Options` |
| `IDEALWEBITSTATUSSALETYPE0..3` | all `0` (Sale Type Link unconfigured) | `dbo.Options` |
| `HANDHELDV7FEATURES` | `1` | `dbo.Options` |
| `HANDHELDWEBITONLY1/2/3` | `0` (handhelds not restricted to Webit-only) | `dbo.Options` |
| `TABLESERVERIPADDRESS` | `192.168.1.250` | `dbo.Options` |
| Table 5 native identity | `TableMapSetups` Code=1, Type=3, Index=5, Caption=`5`, Seats=4 | live |

`IDEALWEBITAUTOPRINTKITCHEN = -1` is why exactly one docket printed at ingest.
`IDEALWEBITAUTOFINALIZE = 0` is why the order sits in the queue awaiting an operator.

## 3. Stage 1 — Webit ingest (settled, by disassembly of the installed IPS.exe)

`IdealWebit` (VB6, inside IPS.exe) consumes `WebPendingOrder` and issues `APENDSAL`. The pending-sale
code is built here:

```
012cb4dd  call [edx+0x98]      ; IWebOrder::get_OrderReference
012cb501  push 0x6bc0e4        ; literal "WB"
012cb50a  call __vbaStrCat     ; "WB" & OrderReference
012cb521  -> [ebp-0x30]        ; == the code sent in APENDSAL
```

Unconditional — the only branch between the fetch and the concatenation is the COM `HRESULT` check.
Hence `WBORD-600002`.

Every `IWebOrder` member `Webit_AddWebOrder` reads, with `this` traced to the WebOrder argument:

`Customer / DatebaseId / DeliveryAddress / DeliveryDate / DiscountAmount / GiftOrder / Items /
Message / OrderAmount / OrderReference / OrderedDate / PaymentDetail / SurchargeAmount`

**`DeliverTo` and `HostReference` are never read.** `HostReference` (vtable `0x6c`/`0x70`) has zero
call sites anywhere in the component. The vtable map is anchored independently: slot `0x98` produced
exactly `WB`+`ORD-600002`, and slot `0x78` (`Message`) is called 8x in the region Webit.log shows
splitting the message into text items.

Corroborating: no `IdealWebitTable` option exists; the only token `AddWebOrder` parses from `Message`
is `[REFERENCE=`, which sets `PendingSales.Reference`, not `Code`.

**Consequence:** none of the five `ITableAssignmentStrategy` values can produce `PendingSales.Code = 5`.
`NoHint` failed live; `HostReference` and `Message` are eliminated by ORD-600002 itself (both fields
were populated and ignored for `Code`); `DeliverTo` is eliminated by disassembly; `ReferencePrefix`
would deterministically yield `WBT5-ORD-600002`.

## 4. Native state after ingest — does Table 5 survive anywhere?

**No.** The value 5 was never transmitted to Idealpos in any form.

- `dbo.PendingSales` ID 4522: `Code=WBORD-600002`, `POS=1`, `Status=0`, `Label=''`, `Reference=NULL`,
  `CustomerID=0`, `ClerkID=1`, all address columns empty.
- `dbo.PendingSaleLines` (PendingSaleID 4522): `SI|708|CHICKEN BALLISTA PIZZA|qty 1|$23|Printed=1`,
  plus two `H` text lines `Order Tablet Checkout (Guests:` / ` 1)` (the Message, chunked at 30 chars).
- `dbo.WebPendingOrder` ID 2 — the serialized `WebOrder` blob (2520 bytes) contains exactly these
  string values: `VerduraIdealposBridge` (HostReference), `ORD-600002` (OrderReference),
  `Order Tablet Checkout (Guests: 1)` (Message), `Web Order` (Customer.ContactName),
  `CHICKEN BALLISTA PIZZA`. The `<DeliverTo>k__BackingField` slot is present and **null**.
- Both `WebPendingOrder` rows are `Processed=1`. Only one `WB%` pending sale has ever existed in this
  database.

## 5. Stage 2 — the Web Orders screen (identified)

The physical `Web Orders` screen is **`frmPendingSales` inside IPS.exe** (VB6), retitled and filtered:

```
 WHERE trim(PendingSales.Code) LIKE 'WB*'
```

Its action vocabulary, recovered from the form's string region and its handlers' constant references:

| Action | Evidence | Audit descriptor |
|---|---|---|
| Finalize | `Are you sure you wish to` + `Finalize this Order?` (YESNO), with a `This Order has been Pre-Paid.` branch; handler sits alongside `.cmdRecall_Click` | — |
| Reprint Kitchen | constant `PSRP` referenced by the adjacent handler | `PSRP` = `Pending Sale Reprint: ` |
| **Transfer to a Table** | `Are you sure you wish to Transfer to a Table?` (YESNO) | `PDTF` = `Transfer Pending Sale to Table: ` |
| Bill Print / Delete / Reprint Tables | `.cmdBillPrint_Click`, `Delete Pending Sale `, `Reprint Tables` | — |

So a native **operator-driven** transfer from the web-order queue onto a table exists and is audited.
It is UI-only: the POSServer packet surface (`TRANSACTN, CLOSE_TAB, TABEXISTS, GETONETAB, GETALLTAB,
GETORDER, SENDSTAT, TABLEDATA, MOVETABLE, LOCKTAB, GETTBLPAY, IHSALE, IHPAYMENT, IHORDER, IHENQUIRY,
TBLMAPDTA, ...`) exposes **no** "transfer pending sale to table" operation. `MOVETABLE` moves a
table's X/Y position on the floor plan, not a sale.

`Finalize` is a close/tender action, not a table assignment: it is the manual counterpart of
`IDEALWEBITAUTOFINALIZE` ("Automatically Finalize Prepaid Web Orders") and pairs with
`IDEALWEBITTENDER` (the Web Order Tender, currently `0`/unset here). Its handler references no
table-selection strings. **Its duplicate-KOT behaviour was NOT established** — do not click it.

## 6. `OrderMode.EatIn`

- **Initial ingest:** not used. `OrderDetail` (vtable `0x88`) is absent from `Webit_AddWebOrder`'s
  WebOrder reads; its call sites in the component belong to `GetWebOrderStatus`.
- **Table routing:** not used, and cannot be. The only setting it can reach is the Sale Type Link
  (`IDEALWEBITSTATUSSALETYPE0..3`), which maps an order mode to a **Sale Type**, never to a table —
  and all four are `0` (unconfigured) at this venue.

## 7. The supported direct-to-table path: Ideal Handheld / WaiterPad

IPS.exe 7.133.0200 implements a **second, independent order-ingestion protocol** that writes straight
onto a native table. Confirmed in the installed binary:

```
ProcessHandheldOrder Processing STARTED : Table <n> and Map <m>
----------- TABLE ORDER : <n>  Covers:<g> -----------
Handheld Order successfully added to Pending Sales.
SELECT * FROM TableMapSetups WHERE code=<m> AND Type=3 AND [Index] = <n>
Ready to Print!  ->  Finished sending to IKM  ->  " (WP)"  ->  Printed : Table <n>
Finished setting Printed Flags : Table <n>
About to Send to POSServer : Table <n>
Sending Status to POSServer / Sending Table Data to POSServer / Sending UNLOCK command to POSServer
IdealHandheldProcessing finished
```

Transport and envelope, also in the installed binary: a Winsock listener (`wsWaiterPad`,
"Ideal Handheld port to Listen") accepting `WPPacket` XML with response types
`ACK` / `NAK` / `DUPLICATE` / `LOCKED...` / `NAKREGO` / `NAKPRINT`; option `HANDHELDPROTOCOL2`.

Duplicate suppression is native: `Checking Handheld Order : Table ... Checksum=... DeviceID=...` then
`Exiting.  DUPLICATE ORDER!`, backed by `IsDuplicateHandheldOrder2` storing
`AAAExampleData.ColumnType = 'IH-<checksum>'`. Table locking is native:
`Table Locked by Handheld POS!`, with `Sending UNLOCK command to POSServer` on completion.

The managed reference implementation of the same packet (`POSServer.Communication`, `IHORDER`) shows
the payload shape — `Checksum, Table, POSTerminal, Map, Clerk, Guests, Location`, repeated
`OrderItem{StockItem, Quantity, Description, Price, PriceLevel, Seat, Type, TaxString}` — and the
semantics: load `PendingSales` by `(Code=Table, Map, Pos=1)`, **create if absent, append if present**,
set `TableMapSetups.Status = 8` and `StartTime`/`Seats`/`GuestsSaved`, then broadcast `~SENDSTAT` to
every other connected client so no terminal cache goes stale. That build's field names come from a
different version than the one installed and must be re-confirmed field-by-field before
implementation, but its vocabulary matches IPS.exe's own strings.

**This is the mechanism that satisfies the production requirement**, including the previously-deferred
"add another round to an open table" workflow — the append branch is native behaviour, not a
workaround.

### Gates to close before building against it

1. **Licence.** `WaiterPad_DataArrival EXIT because NOT HandheldLicensed` — the listener discards data
   unless the Ideal Handheld module is licensed. Licensing is per-module via
   `IdealPos.Licensing.exe` / `IdealposLicensingLocal.dll` (Setup - Licence Gateway).
   `dbo.AAAExampleData` contains **no `IH-` rows** — handheld ordering has never run at this venue.
2. **Device registration.** `NAKREGO` / `BAD REGO`, with a device/waiter slot count
   (`WP Current Count=`, `Waiters=`, `Adding <x> to current devices.`). The Bridge must register as a
   device.
3. **Wire format for the installed v7 build** (`HANDHELDV7FEATURES=1`, `HANDHELDPROTOCOL2`).
4. **Listener endpoint** — port, and whether IPS.exe or the table server at
   `TABLESERVERIPADDRESS=192.168.1.250` terminates the connection.

## 8. Classification

**A — IdealPOS supports direct remote-device to requested-table routing**, natively, with one KOT,
native idempotency, native locking and native cache broadcast. It is simply **not** the Webit
web-order pipeline the Bridge currently uses. Reaching it is a Bridge **source** change (new transport
and packet builder), not a config change, and is gated on a commercial licence question.

Not classification C: this is not a manual-only vendor workflow.

## 9. Do-not-touch list (current)

- Do **not** click `Finalize` on ORD-600002 — it is a close/tender action and its KOT behaviour is
  unestablished.
- Do **not** click `Transfer to a Table` on ORD-600002 yet — it is the correct manual native action,
  but whether it reprints the kitchen docket is unestablished, and ORD-600002 is the only diagnostic
  specimen.
- Do **not** `UPDATE PendingSales.Code` directly (unchanged ruling from `table-assignment-review.md`).
- Do **not** switch `Idealpos:TableAssignmentStrategy` to `Message`; printing "Table 5" on the docket
  does not meet the business requirement.
- Do **not** spend another live certification order.

## 10. Next action

Confirm with the Idealpos dealer / Setup - Licence Gateway whether the **Ideal Handheld** module is
licensed for Dunedin and how many device licences exist. Every subsequent design decision depends on
that answer, and obtaining it costs no live order and no physical action at the terminal.

## 11. Status carried forward

| Item | Status |
|---|---|
| Order Tablet to Bridge to Webit to native sale, correct item/PLU/price, exactly one KOT | PROVEN (ORD-600002) |
| `Table.posTableCode` = `TableMapSetups.Caption` contract (DL-097) | PROVEN, unchanged |
| Native Table 5 assignment via any `ITableAssignmentStrategy` | **IMPOSSIBLE — closed, with proof** |
| Native Table 5 assignment via Ideal Handheld protocol | **SUPPORTED, BLOCKED on licence + protocol confirmation** |
| Add another round to an open table | native in the handheld path; unavailable in the Webit path |
| `Idealpos:TableAssignmentConfirmed` | remains `false` |
