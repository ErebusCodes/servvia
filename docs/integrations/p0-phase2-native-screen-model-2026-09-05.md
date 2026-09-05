# P0 Phase 2 — the native screen/control model, from static evidence

**Written:** 2026-09-05, under the P0 master execution directive.
**Method:** offline only. Read-only byte reads of
`C:\Program Files (x86)\Idealpos Solutions\Idealpos\IPS.exe` plus the
already-committed passive captures. **No IdealPOS process was driven, no
screen was navigated, no input of any kind was sent.** Nothing was invoked.

This phase answers: *what are the screens, what are the controls, and can we
bind to them deterministically?*

---

## 1. The screens are separate VB6 forms, and we have only ever captured one

IPS.exe is VB6. Its forms are recoverable by name from the binary's procedure
trace strings. The three screens directive §7B requires recognising are:

| Directive screen | VB6 form | Window evidence |
| --- | --- | --- |
| Sale entry / POS | `frmSale` | title `POS Screen`, class `ThunderRT6FormDC` — captured |
| Table Map | `frmTables` | **never captured** |
| Table Details | `frmTableDetails` | **never captured** |

**This reframes the Phase 2 problem.** Every passive capture we hold
(`apps/venue-connector/.captures/`) targeted either the back-office MDI frame
(`ThunderRT6MDIForm`, 59 nodes) or `POS Screen` (3 nodes). The Table Map — the
screen that performs the send, and the screen where selecting the wrong cell
is the §29 catastrophe — has never been enumerated at all. The prior
conclusion "the native UI has shallow exposure" was measured on `frmSale` and
was then generalised to the whole application. It does not transfer.

## 2. `frmTables` — the Table Map, and the send boundary

Recovered controls and procedures (verbatim string fragments, `IPS.exe`
`0x0035fab8`–`0x00361218`):

**Procedures:** `SaveSale`, `SetupMapButtons`, `SaveDirectToTable`,
`SetStatus`, `Sendtabledatatoserver`, `SendUnLocktoServer`,
`SendDeleteCommandtoServer`.

**Controls:** a `cmd` **control array** — the table cells — plus
`cmdBill`, `cmdCancel`, `cmdDetails`, `cmdFinished`, `cmdInactive`,
`cmdKitchen`, `cmdMap`, `cmdModify`, `cmdOccupy`, `cmdPay`,
`cmdReservations`, `cmdReserve`, `cmdSale`, `cmdServed`, `cmdSummary`,
`cmdTransfer`.

Three consequences, each of which changes the driver design.

**C1 — the table cells are a VB6 control array handled on `MouseDown`, not
`Click`.** The recovered handler is `frmTables.cmd_MouseDown` (with
`cmd_GotFocus` also present); there is no `cmd_Click`. A `BM_CLICK` posted to
a VB6 CommandButton raises `Click`, **not** `MouseDown`. If the map cell's
real behaviour hangs off `MouseDown`, the existing
`Win32NativeAction.Click` primitive would issue a message that does nothing —
or, worse, does something different from what a human's press does.
**STRONGLY SUGGESTED** from the handler names; must be settled before any
live action. This alone invalidates a naive "click the table cell" driver.

**C2 — the destructive buttons live on the same form as the send.**
`cmdPay`, `cmdFinished`, `cmdTransfer`, `cmdCancel` sit beside the map cells.
Recovered prompts confirm their reach: `Are you sure you want to Transfer all
items from Table `, `This table has an Unpaid Balance.  Are you sure you wish
to Finish?`, `This process will Delete items from the table.` Coordinate-based
or ordinal-guessed input on this form can pay, finish, transfer or cancel a
real sale. Under §6 and §29 this makes exact, name-or-identity-bound control
resolution mandatory here — not merely preferable.

**C3 — the Table Map is drawn from POSServer.** Recovered:
`IPS was unable to get Table Data from the POSServer! ` /
`The Table Map cannot be used.` / `Load POSServer and Restart POS!`
So `frmTables` *reads* POSServer to render, while `frmPOSServerComms` writes
to it. POSServer is therefore not purely downstream of the UI — it is the
table-state representation the Table Map itself consumes. This is consistent
with, and sharpens, the downgraded architecture claim in
`idealpos-native-invocation-decision-2026-09-05.md` §1.

## 3. Native table status vocabulary — the §21 acceptance signal

`frmTables.SetStatus` carries the full legend:

```
Table Reserved (        Seated - Ready to Order (
Ordered but not Served (    Order Sent to Kitchen
Ordered and Served (        Bill has been printed (
Table to be Cleaned (       Un-Reserve / Active
```

Acceptance criterion §21.1 ("Table 5 changed from Ready/free to active") now
has a concrete, readable native target rather than a vague one. `Order Sent to
Kitchen` is the state Round 1 should produce.

## 4. `frmSale` — the sale-entry screen, and the hard part

Recovered procedures include `BringPendingSaleToGrid`,
`BringReorderItemsToGrid`, `UpdateQtyAmtExistingRow`, `CalculateItemCount`,
`ExitPOSScreen`, `HomeScreen`. Recovered control fragments include `grd`
(`grd_GotFocus`, `grd_LeaveCell`), `grdTend`, `grdCust`, `txtTend`,
`lblOrderNumber`, `cmdPayLine`.

**The sale line area is a `TrueOleDBGrid80.TDBGrid`** — a ComponentOne ActiveX
grid, present throughout the binary. An ActiveX grid is a real windowed
control and is the natural source for §7D's "verify the staged item before
table commit" read-back.

**But the captured `POS Screen` window exposed only three nodes**: the form
plus two `ThunderRT6PictureBoxDC` panes. No grid, no buttons, no text field.
Combined with the binary's `POS Screen Grid` / `POS Screen Menu` /
`POS Screen Grids` configuration vocabulary, the most likely reading is that
the POS button surface is **owner-drawn inside a PictureBox** — invisible to
Win32 child enumeration, UIA and, probably, MSAA.

Two readings remain open and are **not** distinguishable from static evidence:

- **(a)** the sale grid exists but was absent from the capture because no sale
  was staged at that moment, in which case a real windowed grid appears once
  an item is entered and gives us both item verification and line read-back; or
- **(b)** the item area is owner-drawn too, in which case there is no semantic
  binding on `frmSale` at all and item entry must fall back to
  `GUARDED_INPUT` — keyboard PLU digits into a positively-verified screen.

**Reading (b) is the P0 risk.** It does not block the round (POS terminals
accept keyboard PLU entry), but it removes the pre-send verification §7D
requires, and §29 forbids proceeding when the wrong PLU may be entered. If (b)
holds, the pre-send check must come from somewhere other than the sale screen.

## 5. The binding mechanism, per operation

Per §6, choose the strongest available mechanism per operation rather than
forcing one. Current best assessment:

| Operation | Mechanism | Confidence |
| --- | --- | --- |
| Bind IPS.exe process/session | process + module path + window | settled |
| Recognise `POS Screen` | window title + class | **PROVED** by capture |
| Recognise Table Map | window title/class of `frmTables` | **UNKNOWN — never captured** |
| Recognise Table Details | window of `frmTableDetails` | **UNKNOWN — never captured** |
| Select Table N | `WIN32_CONTROL` on the `cmd` array, `MouseDown` semantics | plausible, unverified (C1) |
| Enter PLU/qty | `GUARDED_INPUT` keyboard, unless (a) holds | unresolved (§4) |
| Verify staged item | TDBGrid read-back if (a); otherwise none | unresolved (§4) |
| Commit (TABLE MAP → Table N) | same as "Select Table N" | plausible, unverified |
| Modal/unknown detection | window enumeration + known caption set | partially recovered |

## 6. The one passive observation that unblocks Phase 3

Everything above is static. The blocking unknown is a single read-only
capture that has never been taken:

> **Enumerate `frmTables` (the Table Map) and `frmSale` with a staged item,
> via Win32 child enumeration, MSAA and UIA, while those screens are on
> display.**

That capture is passive — the existing tracer's MSAA path reads `accName` /
`accRole` / `accState` / `accValue` / `accLocation` / `accDefaultAction` and
never calls `accDoDefaultAction`, `accSelect` or `put_accValue`. But it cannot
be taken without the screens being open, and **opening them is navigation,
which is input.** Under §20 and §31 I will not navigate IdealPOS to obtain it.

It therefore needs one of:

1. a human to leave IdealPOS on the Table Map (and separately on the POS
   Screen with one item staged) while a read-only capture runs; or
2. explicit approval for the driver to perform *navigation-only* steps under
   full guarding, which is a weaker fence than §20 currently sets.

Option 1 costs minutes, changes nothing, and needs no new code — the capture
path already exists. It is the cheapest unblock on the critical path.

## 7. Evidence grading

- `frmTables`, `frmTableDetails`, `frmSale` are distinct forms: **PROVED**
  (binary).
- The Table Map has never been captured: **PROVED** (capture inventory).
- Table cells are a `cmd` control array with a `MouseDown` handler and no
  recovered `Click` handler: **PROVED** that the strings exist; **STRONGLY
  SUGGESTED** that `MouseDown` is the operative path.
- Pay/Finish/Transfer/Cancel share the Table Map form: **PROVED** (binary).
- The Table Map renders from POSServer: **PROVED** (error strings).
- The native table status vocabulary: **PROVED** (binary).
- The sale line area is a TrueDBGrid: **STRONGLY SUGGESTED** — the control is
  in the binary and `grd*` handlers belong to `frmSale`, but it was not
  observed in the one `POS Screen` capture we hold.
- `frmSale`'s item surface is owner-drawn and unbindable: **INFERRED**, and
  the single most important thing to disprove.
