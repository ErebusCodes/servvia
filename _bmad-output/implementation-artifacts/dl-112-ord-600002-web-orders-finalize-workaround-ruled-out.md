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

---

# Addendum — 2026-09-01: the RED BULL / `WBORD` order, and the installed transfer architecture

Read-only. No UI action, no click, no caption change, no transfer, no option altered, no order
created or modified. All database access was `SELECT` / `INFORMATION_SCHEMA`; IPS.exe was read only.

A second item — RED BULL, $4.00 — was observed in the Web Orders queue and reported as a possible
improvement over ORD-600002, on the grounds that it could be recalled into the normal sale screen.
It is not an improvement, and the record must not carry it as one.

## A1. RED BULL did NOT traverse Verdura / Connector / Bridge / Webit

| Evidence | Value |
|---|---|
| `dbo.WebPendingOrder` rows | still exactly **2** — `ORD-600001`, `ORD-600002`, both `Processed=1`. **No row for RED BULL.** |
| Native audit `Cons 90491`, POS **2**, 2026-08-31 23:35:33, Clerk **108** | line 1 `SI 221 RED BULL`; line 2 `H [ Saved to Pending Sale WBORD ]` |
| `PendingSales` 4523 | `Code='WBORD'` (no order reference appended), `ClerkID=108`, `POS=1` |
| `PendingSaleLines` 4523 | `SI 221 RED BULL qty 1 $4 Printed=1`, `ClerkID=108`, `LocationSold=1`; **no `H` message lines** |

It was entered manually on native POS terminal 2 by clerk 108 and saved to a native pending sale
whose code was typed as `WBORD`. Its appearance in the Web Orders queue is explained **entirely** by
that screen's filter `WHERE trim(PendingSales.Code) LIKE 'WB*'` — a naming collision, not an ingest.

### Correction to this document's own §1

§1 above closes with "destroy the only `WB*` pending sale that has ever existed in this database."
That was true when written on 2026-08-31. It is now false: `PendingSales` 4523 (`Code='WBORD'`) is a
second `WB*` row, created manually at 23:35:33 that same evening. The original wording is left
standing rather than rewritten, per this project's DL-109/DL-110 convention. The operative point is
unchanged and if anything stronger — ORD-600002 remains the only *Webit-ingested* `WB*` sale, and the
only one carrying a Verdura order reference.

Contrast with a genuine Webit order (ORD-600002, `PendingSales` 4522): `Code='WBORD-600002'` built as
`"WB" & OrderReference` (DL-108 §3), header `ClerkID=1` (`IdealWebitClerk`), line `ClerkID=10000`,
`LocationSold=0`, and two `H` message lines carrying `Order Tablet Checkout (Guests: 1)`.

**Do not cite RED BULL as evidence that a Verdura web order can be recalled differently from
ORD-600002.** Recalling a pending sale into the sale screen is the ordinary native workflow — this
site has 4,521 `Saved to Pending Sale` and 13,183 `Saved to Table` audit events. RED BULL demonstrates
nothing about the Webit pipeline.

## A2. What RED BULL *is* useful for

It exercised a native guard we had not previously reached:

- a recalled pending sale does load into the normal `frmSale` screen;
- attempting a table conversion from there reaches real native code;
- the installed IPS.exe rejects it with `Cannot Transfer to Table!`

Traced in the installed binary: the literal is at file offset `0x003b4ecc` (VA `0x007b4ecc`) with
exactly **one** code reference, at `0x0228f3fb`, inside the `frmSale` procedure that also owns
`Cannot Transfer to a Pending Sale!`, `Cannot save Table Sale to Pending Sale!` and
`Cannot save a Hold Print sale to a Pending Sale`. The decoded branch:

```
mov   ecx,[ebp+0x20]          ; procedure parameter (Integer)
movsx edx,word [ecx]
test  edx,edx
jnz   skip                    ; precondition 1: parameter must be 0
movsx eax,word [0x02a2f55c]   ; module-level flag
test  eax,eax
jz    skip                    ; precondition 2: flag must be non-zero
call  [edx+0x3e0]             ; fetch a form control
call  __vbaLateIdCallLd       ; late-bound property get -> its text
push  eax                     ; needle   = that text
push  0x7b0ae4                ; haystack = literal "Pending Sale"
push  0
call  __vbaInStr
neg / sbb / neg / neg         ; -> boolean
test  eax,eax
jz    skip
=> MsgBox "Cannot Transfer to Table!"
```

Imports resolved from the PE import directory: `0x401404 __vbaInStr`, `0x401428 __vbaStrCopy`,
`0x401508 __vbaStrMove`, `0x4012c4 __vbaLateIdCallLd`.

**Reason for rejection:** the sale loaded on screen is itself a recalled *Pending Sale*, and this
build refuses to convert a pending sale into a table sale through the sale screen. Corroborated
behaviourally — the same clerk on the same terminal saved sales directly to Table 17 and Table 18
minutes earlier (`[ Saved to Table ]`, `Cons` 90482 / 90483 / 90490), so the table path itself is
healthy; only the pending-sale-to-table conversion is blocked. The `WB` prefix is incidental: any
pending sale meets the same guard.

Not resolved, and deliberately not guessed: the identity of the control whose text is read (a
late-bound DispID call) and the module flag at `0x02a2f55c`.

## A3. The installed-v7 transfer architecture

**Web Orders mode** — `frmPendingSales`, filter `Code LIKE 'WB*'`:
Email · Reprint Kitchen · Print · `cmdRecall` re-captioned **`Finalize`** · native transfer control
**hidden**.

**Normal Pending Sales mode** — `frmPendingSales`, filter excludes `WB*`
(`NOT LIKE 'WB*' AND NOT LIKE '8888*' AND NOT LIKE '{*' AND NOT LIKE '-*'`):
Windows Print · **Transfer to Table** (`cmdTransferToTable`, `PDTF`) · Email · Reprint Kitchen ·
Modify · Print · OK.

**Recalled pending sale** — `frmSale`: attempting table conversion hits the §A2 guard and yields
`Cannot Transfer to Table!`.

All controls are instantiated on both variants of the one form; the mode switches visibility and
captions. There is no `cmdFinalize` control — `Finalize` is `cmdRecall`'s web-order caption, and `OK`
is the same control's normal-mode caption.

**Therefore there are NOT two interchangeable ways to transfer.** Only `PDTF` appears designed for
pending-sale-to-table transfer, and Web Orders mode prevents access to it. No supported option, sale
type, licence, permission or clerk right governing that visibility has been found; on current
evidence it is compiled logic. Both questions are now DL-111 Q7 and Q8.

## A4. Reconciliation consequence

ORD-600002 native state: `PendingSales.ID = 4522`, `Code = WBORD-600002`, `Reference = NULL`.

Bridge reconciles via `PendingSales.Reference` (`IdealposReadRepository.cs:266`), which is NULL — so
it cannot correlate this order today. And if `PDTF` later becomes available, the transfer changes
`Code` from `WBORD-600002` to the native table code, destroying the only currently visible ORD
identifier.

Likely robust future model, recorded and **deliberately not implemented** — vendor transfer semantics
must come first:

1. at initial Webit/native detection, correlate once on `Code = 'WB' + externalOrderId`;
2. capture the immutable `PendingSales.ID`;
3. persist that ID in Bridge/Verdura synchronization state;
4. follow the same native ID through any supported transfer;
5. verify the resulting `Code`/table;
6. only then set `tableMatchesRequest = true`.

## A4b. CORRECTION to A4 — there are TWO pending-sale stores, and the single-ID model is invalid

Established 2026-09-01, read-only, from the live SQL instance. A4 above (and every earlier statement
of the "capture `PendingSales.ID` and follow the same ID after transfer" model) assumed one store.
That assumption is wrong. The wording in A4 is left standing per the DL-109/DL-110 convention; this
section supersedes it.

| Store | Role | Contents observed |
|---|---|---|
| `IPSTransaction.dbo.PendingSales` (45 rows) | Webit / phone / operator pending-sale store | `4522 WBORD-600002`, `4523 WBORD`, 43 stale orders. **No row for any table.** |
| `POSServer.dbo.PendingSales` (3 rows) | **native table-sale store** | `99411 Code='17' Map=1` (live table), `99410 Code='WBORD' Map=0`, `99408 Code='0' Map=1` (empty stub) |

Three consequences:

1. **Table sales do not live in `IPSTransaction`.** Table 17 was occupied
   (`TableMapSetups` Status=8, StartTime 22:39:32) with 21 lines in `POSServer.PendingSales` 99411
   and **no** `IPSTransaction.PendingSales` row at all.
2. **`WBORD-600002` was never registered with POSServer.** The natively-created `WBORD` propagated to
   both stores; the Webit-injected `WBORD-600002` exists only in `IPSTransaction`. This is a plausible
   root cause for Web Orders mode hiding `cmdTransferToTable`: a `WB*` Webit row is not a
   POSServer-registered, table-capable sale.
3. **The ID spaces are disjoint.** `IPSTransaction.PendingSales.ID = 4522` cannot survive into
   POSServer's space (99408–99411). Following 4522 through a transfer would follow it to a row that
   has stopped being the table sale.

Corrected future model — a **cross-store transition**, still deliberately NOT implemented:

```
Verdura externalOrderId
  <-> IPSTransaction web-order identity   (correlate once on Code = 'WB' + externalOrderId)
  <-> supported native conversion event
  <-> POSServer table-sale identity        (resolve by Code = requested table, Map, POS)
  <-> requested native table
```

The second half cannot be specified safely until vendor transfer semantics are known.

### Incidental KOT evidence, and it is favourable

`POSServer.PendingSales` 99411 (Table 17) carried **21 lines added across 54 minutes**
(`OrderedTime` 22:39:28 -> 23:33:44) — several successive rounds on one open table — with **all 21
lines `Printed=1` and none `Printed=0`**. That is IdealPOS's native per-line anti-reprint discipline
working in production: each round prints once, `SetPrintedFlags` marks it, and later saves to the
same table do not resend it.

Separately, `Support.PrintTableTransferToKitchen`'s query is verbatim
`SELECT * FROM PendingSaleLines WHERE Code='TRANSFER' ORDER BY Line`. `PendingSaleLines` has **no
`Code` column in either database**, and no `PendingSales` row whose code contains `TRANSFER` has ever
existed here. So that routine does **not** re-select the transferred sale's food lines by
`PendingSaleID`, and against this schema the query cannot match anything.

This downgrades §3's "evidence points to YES" on a duplicate food docket to **evidence now points to
NO** — but not to proven-safe. `PDTF` has still never run here, and a query that cannot bind is as
likely to error as to no-op. The KOT gate stays closed.

## A5. Standing operational risk (not actioned)

`PendingSales` 4522 (`WBORD-600002`) and 4523 (`WBORD`) are both open in a live venue — real table
service was running through 23:35 on 2026-08-31. They are diagnostic specimens, and clearing them is
a production mutation requiring its own plan and explicit approval. **Not actioned in this phase.**
Flagged so it is a decision rather than an accident of the next shift reset.

## A6. State verified unchanged at the end of this addendum

- `PendingSales` 4522 — `Code=WBORD-600002`, `POS=1`, `Status=0`, `Reference` NULL, 3 lines.
- `PendingSales` 4523 — `Code=WBORD`, `POS=1`, `Status=0`, `Reference` NULL, 1 line, `Printed=1`.
- `dbo.WebPendingOrder` — 2 rows, unchanged.
- `TableMapSetups` Table 5 — `Status=0` (Ready), `StartTime` NULL.
- `TableTransfersToKitchen` left at `1`. No option written. `PDTF` event count still 0.
