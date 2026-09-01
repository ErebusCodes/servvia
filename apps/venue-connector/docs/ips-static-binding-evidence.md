# IPS.exe — Static Binding Evidence (2026-09-02)

Read-only static analysis of the vendor binaries. **No vendor binary was modified, patched, or executed to produce anything in this document.** Method: PE header inspection, `ilspycmd` decompilation of the managed assembly, and ASCII/UTF-16LE string and identifier extraction from the native one.

Every finding here is `PROVEN_STATIC` — a real name read out of a shipped binary. Static evidence names a control; it does **not** establish that the control is present on the screen the driver will face, nor its runtime window class or control id. Nothing in this document may drive a live mutating action; `TerminalBindingReadiness.CanDriveMutatingAction` enforces that in code, and `TerminalActionBindingTests` proves it.

---

## 1. Target correction: the POS is `IPS.exe`, not `IPSClient.exe`

Commit `bc8cf17` concluded that `IPSClient.exe` owns the terminal UI, on the strength of a window titled `IPS Client - Terminal 1`. That conclusion is **wrong**, and this is the correction.

### PE headers

| Binary | Machine | CLR directory RVA | Verdict |
|---|---|---|---|
| `IPS.exe` (40,143,120 B) | 0x14c | **0** | **Native — VB6** |
| `IPSClient.exe` (1,224,192 B) | 0x14c | 8200 | Managed .NET |

This is also why the earlier `IPS.decompiled.cs` is 0 bytes: `ilspycmd` cannot decompile a native binary.

### `IPSClient.exe` contains no POS UI

Decompiled: 95 classes, ~40 `Form` subclasses — **every one** data replication or housekeeping. `OverwriteInProgress2Form`, `OverwriteTransferring`, `TransferInProgressForm`, `ReceiveForm`, `SavedPacketListViewForm`, `ListenForHibernationForm`, `TerminalVisibilityForm`, `HousekeepingStatusForm`.

Those map **1:1 onto the live capture's window list** — `Overwrite In Progress`, `OverwriteTransferring`, `Overwrite Preparing`, `Hibernate Listener`.

| Term | `IPSClient.exe` | `IPS.exe` |
|---|---|---|
| Table Map | 0 | **8** |
| Tender | **0** | **93** |
| Kitchen | **0** | **25** |
| Quantity | **0** | **54** |
| PLU | 0 (see below) | **6** |
| Recall | 0 | **5** |
| Overwrite / Packet / Terminal | 940 / 696 / 2093 | — |

The apparent `IPSClient` hits are false positives, which is why each was checked rather than counted:

- `Table` ×164 → `TableLayoutPanel` (77), `colTable`, `prgTables`, `TotalTablesToProcess` — **database** tables being replicated.
- `PLU` ×1 → `DataRow1.ShowPlusMinus`, an Xceed grid property.
- `Sale` ×33 → `colSales`, a grid column in a sync summary view.

**`IPSClient.exe` is the Idealpos data-replication client.** The chrome-only captures were never a rendering problem: we bound a background sync client that has no client area to render.

---

## 2. Extracted control surface — `IPS.exe`

VB6 compiles event-handler names and error-handler traces into the binary, which exposes real identifiers. Totals from 42,705 unique strings:

| Prefix | Kind | Count |
|---|---|---|
| `cmd` | CommandButton | 465 |
| `lbl` | Label | 355 |
| `frm` | Form | 337 |
| `mnu` | Menu | 258 |
| `cmb` | ComboBox | 155 |
| `chk` | CheckBox | 110 |
| `txt` | TextBox | 93 |
| `tmr` | Timer | 76 |
| `opt` | OptionButton | 47 |
| `pic` | PictureBox | 43 |
| `grd` | Grid | 38 |
| `lst` | ListBox | 12 |
| `fra` | Frame | 11 |

Plus 219 wired event handlers and 710 procedure names recovered from `.ProcName on Line:` traces.

### Candidate POS forms

| TYPE | NAME | PARENT FORM | STATIC CONFIDENCE |
|---|---|---|---|
| Form | `frmSale` | — | Sale screen (high) |
| Form | `frmTables` | — | Table map / selection (high) |
| Form | `frmTableDetails` | — | Table detail (high) |
| Form | `frmTableSummary` | — | Table summary (high) |
| Form | `frmTouchScreen` | — | Touch POS surface (medium) |
| Form | `frmTouchscreenGrid` | — | Item grid (medium) |
| Form | `frmPOSScreenTaskBar` | — | POS chrome (medium) |

### Action controls

| TYPE | CONTROL NAME | CONTROL CLASS | EVENT HANDLER | PARENT FORM | STATIC CONFIDENCE |
|---|---|---|---|---|---|
| Button | `cmdSave` | *(runtime)* | `cmdSave_Click` | `frmSale` | High |
| Button | `cmdRecall` | *(runtime)* | `cmdRecall_Click` | `frmSale` | High |
| Button | `cmdKitchen` | *(runtime)* | `cmdKitchen_Click` | `frmSale` | High — **observe only** |
| Button | `cmdReprintKitchen` | *(runtime)* | — | `frmSale` | High — **never invoke** |
| Button | `cmdPopulateQuantity` | *(runtime)* | — | `frmSale` | Medium |
| Button | `cmdClearZeroQty` | *(runtime)* | — | `frmSale` | Medium |
| Button | `cmdBill` / `cmdBillPrint` | *(runtime)* | `cmdBill_Click` | `frmSale` | Medium |
| Button | `cmdFinished` | *(runtime)* | `cmdFinished_Click` | `frmSale` | Medium |
| Button | `cmdMenuItems` | *(runtime)* | `cmdMenuItems_Click` | `frmSale` | Medium |

`CONTROL CLASS` is deliberately unfilled: VB6 window classes (`ThunderRT6*`) are registered at runtime and are **not** reliably present as literals in the binary. They come from the runtime capture, not from here.

### Corroborating strings

`Loading Table Map...` · `Return to Table Map without paying` · `Cannot Save to Table` · `Cannot save Table Sale to Pending Sale!` · `PLU Code` / `PLU CODE` · `Enter Quantity` · `A valid quantity is required.` · `Invalid Quantity!` · `About to Send to POSServer : Table` · `&Transfer to Table` · `&Close Current Sale`

---

## 3. Controls the driver must never bind (permanent denylist)

Real names, read from `IPS.exe`. Nothing in the Verdura round contract — select a table, enter a code and quantity, save the round — needs any of them, so a binding to one indicates a mis-derived binding rather than a feature.

`cmdPay` · `cmdPayAll` · `cmdPayLine` · `cmdPayment` · `cmdGotoTender` · `cmdTender` · `cmdCashDecs` · `cmdDelete` · `cmdDeleteLine` · `cmdDeleteText`

Enforced in `TerminalBindingReadiness.IsForbiddenControl`, refused at **any** evidence level, and refused for probing as well as for acting.

---

## 4. POSServer procedure names (VB6 error traces)

Not callable and not bindable — corroborating evidence about how IPS talks to POSServer, which reconciliation must reason about.

`SendNewlinesToServer` · `SendTableDatatoServer` · `SendODSTableStatus` · `SendODSPacket` · `SendCommand_SALE` · `SendCommand_PAYMENT` · `SendCommand_ADJUSTMENT` · `RecallPendingSale`

**`SendNewlinesToServer` is the notable one:** direct evidence that IPS itself models a second round as sending only *new* lines — the behaviour the second-round acceptance criterion asserts. It is evidence the vendor's own model matches ours, not proof our round will behave that way.

---

## 5. Kitchen printing

**Vocabulary:** `IPS.exe` contains **zero** occurrences of `KOT`. The vendor term is *Kitchen*. Recorded so nobody searches the binary, database, or a report for the wrong word and concludes the feature is absent.

Option names found — names only; whether any is enabled for this venue is a live configuration question this analysis cannot answer:

`AutoKitchenPrint` · `InhibitKitchenPrinting` · `DontPrinttoKitchen` · `DontSendRefundsToKitchen` · `AccumulateItemsonKitchen` · `DepartmentSalesNOTgotoKitchen` · `COMPONENTSTOKITCHEN` · `KITCHENSEPARATE` · **`IdealWebitAutoPrintKitchen`**

These bear directly on discovery checklist item **F** (can kitchen printing be suppressed, and by what scope). `InhibitKitchenPrinting` and `DontPrinttoKitchen` suggest suppression exists; neither their scope nor their current value is established here.

**`IdealWebitAutoPrintKitchen` matters for native/Webit mutual exclusion:** it shows the Webit web-ordering path has its own kitchen auto-print trigger, independent of the native sale screen. "Exactly one KOT per round" therefore has to be argued across **both** paths, not just within the native one.

---

## 6. What this does not establish

- That any named control is present on the screen the driver will face.
- Any runtime window class, control id, geometry, or z-order.
- Which form is actually foreground at any moment.
- Whether this venue's table map contains Table 5, or how its cells are identified — table maps are configurable (`frmFileTableMaps`), so cell identity **must** come from the runtime tree and must never be a guessed template.
- Any kitchen-print configuration value.

All of the above require the passive runtime capture against a running `IPS.exe`. Until then every binding stays `PROVEN_STATIC` and the readiness gate refuses live execution.
