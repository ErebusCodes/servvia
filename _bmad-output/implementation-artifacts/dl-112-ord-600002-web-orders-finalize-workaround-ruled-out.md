# DL-112 — ORD-600002: the Web Orders "Finalize → Send to Table" workaround, ruled out

Read-only investigation. No native UI action taken, no button clicked, no caption changed, no order
transferred, no option altered, no order submitted. Every database access was a `SELECT` or an
`INFORMATION_SCHEMA` read. IPS.exe was read, never modified. ORD-600002 preserved unchanged.

Adds evidence to DL-108; supersedes nothing. DL-108/109/110 stand as written — DL-110 remains
authoritative where it corrects DL-109.

Origin: an operational proposal to use the native Web Orders screen as a temporary bridge — have
staff press `Finalize` to push the web order onto the requested dine-in table, and possibly relabel
that button "Send to Table". Both halves of the proposal are unsafe. The finding below is the reason.

Binary identity re-confirmed for this phase: `IPS.exe` v7.133.0200,
SHA256 `f18475a784c996351048d4f537cf0cc8e2d5ee9aa7b01b38130cdadcc85a520e` — byte-identical to the
build examined in DL-109/DL-110.

## 1. `Finalize` is a tender/closure path, not a table assignment

The Web Orders screen is `frmPendingSales` retitled `Web Orders` and filtered
`WHERE trim(PendingSales.Code) LIKE 'WB*'`. Its compiled control set is:

```
cmdPrint  cmdRecall  cmdBillPrint  cmdDelete  cmdModify  cmdTransferToTable  cmdEmail  cmdReprintKitchen
```

There is **no `cmdFinalize` on this form.** The caption literal `Finalize` (`0033dcd8`), the
`This Order has been Pre-Paid.` branch (`0033e010`) and the confirm
`Are you sure you wish to` + `Finalize this Order?` (`0033e050`/`0033e088`) sit immediately before the
procedure error-descriptor `.cmdRecall_Click` (`0033e0b8`). The on-screen "Finalize" is therefore
**`cmdRecall` re-captioned in web-order mode**.

Its automatic counterpart `AutoFinalizeToSale` — gated by `IDEALWEBITAUTOFINALIZE`, live value `0` —
is unambiguously a tender routine. Adjacent literals:

```
 TenderType=    FinalizedTableBarTab=    PrePaidOrder=    WEB ORDER
TotalAmount=   Sales   Subtotal   Amount   Drawer   SalesCategory   SalesCategoryAllOthersAmt
CASH SALE   GSTNotcollected   clsPendingSale.FinalizeCustomerPoints   ProcessRoomInterface
SELECT * FROM AccessTransactions WHERE Cons=
```

No table-selection literal appears anywhere in that cluster.

**Conclusions.** `Finalize` posts a tender, writes sales/sales-category/drawer totals, accrues
customer points and writes transaction/audit history. Whether the manual button tenders immediately
or loads the sale for tendering is not proven from static analysis — but both terminal states are
closure paths.

- It must **never** be relabelled "Send to Table". Beyond the vendor-binary prohibition, that caption
  would put the most misleading possible label on a control that takes money and closes the sale.
- It must not be clicked on ORD-600002: it would record revenue never taken and destroy the only
  `WB*` pending sale that has ever existed in this database.

## 2. `Transfer to a Table` is a separate action, and is not reachable for `WB*` sales

| Property | Value |
|---|---|
| Control | `cmdTransferToTable` (`0044c4b9`) |
| Confirm | `Are you sure you wish to Transfer to a Table?` (`0033e178`) |
| Audit descriptor | `Transfer Pending Sale to Table: ` (`002f3550`) — action code `PDTF` |
| Times used at this venue | **0** — `AccessTransactions` has no `PDTF` row, ever |

It is a different control, a different confirmation and a different audit code from `Finalize`.

Neither screen can reach it for a web order:

- The **Web Orders** screen physically exposes only Email / Reprint Kitchen / Print / Finalize
  (operator screenshots, DL-108 §1).
- The **standard Pending Sales** screen does expose the control, but its list filter excludes web
  orders outright:
  `WHERE trim(PendingSales.Code) NOT LIKE 'WB*' AND … NOT LIKE '8888*' AND … NOT LIKE '{*' AND … NOT LIKE '-*'`
  (`0033e5e0`).

So there is currently no screen from which `WBORD-600002` can be transferred to a table. This is a
structural finding about the installed build's UI, not a permissions or clerk-rights issue.

For contrast, a *different* native path is in daily use here: `AccessTransactions` holds 21
`Cash Sale Transferred to Table` events (Typ `G`, Code `9999`), which is the sale-screen
"save this Sale to a Table" flow (`UPDATE PendingSales SET Code='…'`, `003b56e8`), not `PDTF`.

## 3. Duplicate-KOT risk is real and unresolved

| Evidence | Value |
|---|---|
| Site option `TableTransfersToKitchen` | **`1`** (live, `dbo.Options`) |
| Dedicated routine | `Support.PrintTableTransferToKitchen` (`0036a0e4`) |
| Its query | `SELECT * FROM PendingSaleLines WHERE Code='TRANSFER' ORDER BY Line` (`0036a058`) |
| Its print path | `SendToKitchen Code=` (`0036a144`), `Printing to KP ` (`0036a170`), `Printed Flags Set:` (`0036a1f0`) |
| ORD-600002 line state | `Printed=1` |
| Historical precedent | none — 0 `PDTF` events |

A transfer therefore has a dedicated kitchen-print path and it is enabled at this site. Whether that
routine filters on `Printed=1` is **not determinable from static strings**, and with no `PDTF` event
in this database's history there is no empirical precedent to appeal to.

**Consequently no controlled transfer test is authorized.** The failure mode is sending the food a
second time on a live service.

## 4. Reconciliation would not survive a transfer

| Fact | Value |
|---|---|
| Bridge lookup | `select … from dbo.PendingSales where Reference = @ref` (`IdealposReadRepository.cs:266`, `GetPendingSaleByReference`) |
| `PendingSales.Reference` for ORD-600002 | **NULL** |
| `PendingSales.Label` for ORD-600002 | empty |
| Only surviving native ORD identifier | `PendingSales.Code = 'WBORD-600002'` |
| Transfer mechanism | `UPDATE PendingSales SET Code='…'` — overwrites exactly that column |

Two separate conclusions, and they should not be conflated:

1. **Bridge cannot reconcile ORD-600002 even today.** `Reference` is NULL, so
   `ObservePendingSaleAssignment` never correlates; the record stays at `Processed` and ages out to
   `Uncertain`. This is a pre-existing gap, not one a transfer would introduce.
2. **A transfer would additionally destroy the last identifier.** `Code` is the only place
   `ORD-600002` survives natively, and it is the field a transfer rewrites to the table number.

Smallest future Verdura change, recorded here and **deliberately not implemented**: capture and
persist the immutable `PendingSales.ID` at ingest — correlating once on `Code = 'WB' + externalOrderId`
before any operator action — and reconcile on that ID rather than on `Reference` or `Code`.

## 5. Button caption

The caption is a compiled vendor UI string: a UTF-16 literal at offset `0033dcd8` inside IPS.exe,
applied at runtime by `frmPendingSales` in web-order mode. `IPSTransaction` contains no language,
caption, translation or locale table, and the string is not in `dbo.Options`. Classification **D —
compiled vendor UI**. Not configurable, not renameable, and not to be patched.

## 6. Verdict

| Item | Status |
|---|---|
| Temporary Web Orders → `Finalize` → Table workaround | **REJECTED** — Finalize is tender/closure |
| Relabel `Finalize` to "Send to Table" | **REJECTED** — compiled vendor UI, and semantically wrong |
| Temporary Web Orders → native `Transfer to a Table` | **BLOCKED** pending vendor confirmation |
| — blocker 1 | how (or whether) `WB*` transfer is exposed/enabled |
| — blocker 2 | duplicate-KOT semantics with `TableTransfersToKitchen=1` |
| Controlled live transfer test | **NOT AUTHORIZED** |
| Long-term direct native table assignment | unchanged — still needs the dealer licence/protocol answer |
| Release decision | unchanged — **NO-GO — DINE-IN ORDER TABLET** |

Both blockers are now questions 7 and 8 of DL-111.

## 7. State verified unchanged at the end of this phase

- `PendingSales` ID 4522 — `Code=WBORD-600002`, `POS=1`, `Status=0`, `Label` empty, `Reference` NULL,
  `ClerkID=1`; 3 `PendingSaleLines`; exactly 1 `WB%` pending sale in the database.
- `TableMapSetups` Code=1, Type=3, Index=5, Caption=`5` — `Status=0` (Ready), `StartTime` NULL.
- `TableTransfersToKitchen` left at `1`. No option written.
