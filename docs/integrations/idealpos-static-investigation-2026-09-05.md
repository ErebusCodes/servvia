# IdealPOS static investigation — 2026-09-05 (offline session)

**Method:** read-only. Binary/string inspection of installed artifacts, COM
registration reads, `SELECT`-only schema and data queries, and already-recorded
log files. **No network connection was opened to any IdealPOS port, and no
write interface was invoked.**

Evidence grades used throughout: **proved** (directly observed here),
**strongly suggested** (consistent evidence, one inference), **unknown**,
**vendor-dependent**.

---

## C. TCP 12183 / `wsPrinter` — classification

### `classification = internal`

Not a supported integration surface. Not a web service. Not job submission.

### Correction: "nothing was sent to it" was wrong

The vendor package states we have not sent anything to TCP 12183. **That is
false, and this section withdraws it.** The complete contents of
`Printing.log` (1002 bytes) and `Printing201911.log` (64 bytes) — every byte of
both files — is a single burst at **2026-09-04 12:29:59**:

```
20260904 12:29:59.002    wsPrinterError_ConnectionRequest 9868
20260904 12:29:59.004    -----Accepted Request.
20260904 12:29:59.004    wsPrinterError_DataArrival : GET / HTTP/1.1
User-Agent: Mozilla/5.0 (Windows NT; Windows NT 10.0; en-NZ) WindowsPowerShell/5.1.19041.6456
Host: localhost:12183
Connection: Keep-Alive
20260904 12:29:59.004    Estranged Data : GET / HTTP/1.1 …
```

Four `GET / HTTP/1.1` requests, all from `WindowsPowerShell/5.1.19041.6456`,
across two connections. Those are ours — a PowerShell HTTP client, from this
machine, during that day's probing. The port had no other traffic in its entire
recorded history.

This must be disclosed to the vendor rather than quietly dropped. **Proved.**

### What the port actually is

From `ips.exe` (native VB6, 40MB), UTF-16 string tables:

- `wsPrinterError` is declared as `MSWinsockLib.Winsock` on form
  `frmIPSPrintServerComms`. Its sibling control is `wsIPSPrintServer`, also a
  Winsock. **Proved.**
- Handlers present: `wsPrinterError_ConnectionRequest`,
  `wsPrinterError_DataArrival`, `wsPrinterError_Close`. **Proved.**
- Adjacent strings, in string-table order:
  `IPSPrintServer_DataArrival event... Printer ERROR! ASC dt=` →
  `Throwing Retry Screen` → `New PrintJob = ` → `Paper Out/Cover Open` →
  `wsPrinterError_ConnectionRequest` → `-----Accepted Request.` → … →
  `-----Giving User decision...` → `Printer Turned Off` → `SOCKET ERROR!`.
  **Proved.**
- The literal `12183` does **not** appear anywhere in `ips.exe` (neither ASCII
  nor UTF-16). The port is configured or computed elsewhere. **Proved.**
- `netstat`: 12183 → PID 20912 = `IPS.exe`; 11183 → PID 2528 =
  `IPSPrinterServer.exe`. **Proved.**

So it is a raw Winsock channel on which **printer error conditions are reported
back into IPS.exe**, which then raises an operator retry screen. It is one half
of a pair with `wsIPSPrintServer` (the outbound side toward
`IPSPrinterServer.exe` on 11183).

### Why it is definitively not HTTP

Our HTTP `GET /` was accepted, read, and then logged as **`Estranged Data`** —
the listener's own word for bytes it does not recognise. It returned no HTTP
response. A raw socket that logs a well-formed HTTP request as estranged is not
an HTTP server. **Proved.**

### Ruling out the alternatives

| Hypothesis | Verdict |
| --- | --- |
| printer error callback / reporting | **matches all evidence** |
| printer-job submission | no — job submission is `m_EthernetPrintJob` / `wsIPSPrintServer`, and jobs go to the kitchen printer at an Ethernet address on port 9100 |
| browser / web-service integration | no — HTTP is classified `Estranged Data` |
| unrelated internal IPC | partly true, but the naming, handlers and adjacent error strings make it specifically the printer-error channel |

**Do not send anything further to this port.** It is internal, it is not
documented, and we have now demonstrated that unsolicited traffic reaches a
live production component's error handler.

---

## D. Native KOT semantics — what `Printed` actually means

### The send sequence, recovered from `ips.exe`

One contiguous string-table run, in order:

```
Handheld Order successfully added to Pending Sales.
SELECT * FROM TableMapSetups WHERE code= … AND Type=3 AND [Index] = …
Ready to Print!
Finished sending to IKM
 (WP)
Printed : Table
Finished setting Printed Flags : Table
About to Send to POSServer : Table
WPOrder end - IPSTableServerInUse for …
```

**Proved:** the `Printed` flags are written **after** `Finished sending to IKM`,
not before. String-table adjacency is ordering evidence, not proof of runtime
sequence — but the log messages are self-describing and the order is
unambiguous.

### Against the four candidate meanings

| # | Candidate meaning of `Printed=1` | Verdict |
| --- | --- | --- |
| 1 | selected for print | **Ruled out.** The flag write follows the send. |
| 2 | handed to IPSPrinterServer / IKM | **Strongly suggested.** `Finished sending to IKM` immediately precedes `Finished setting Printed Flags`. |
| 3 | successfully transmitted | **Unknown.** Whether "finished sending" means the socket write completed or was acknowledged is not determinable from strings. |
| 4 | physically printed | **Ruled out.** See below. |

Meaning 4 is impossible because physical failure is reported **asynchronously
and later**, on the separate `wsPrinterError` channel (§C): `Paper Out/Cover
Open`, `Printer Turned Off`, `Throwing Retry Screen`, `Giving User decision...`.
A flag written during the send cannot encode an outcome that arrives after it.

**Therefore `Printed` must not be called "KOT-sent" without qualification.** The
defensible wording is: *"the flag IdealPOS sets after handing the round to the
print/KDS pipeline, and before any printer acknowledgement or error is
processed."* Its exact transition point within meanings 2–3 is unresolved.

### Lost KOT — is it possible after `Printed=1`?

**Yes, strongly suggested.** The sequence is: send → set `Printed=1` → (later)
printer reports `Paper Out/Cover Open` or `Printer Turned Off` → IPS throws a
retry screen → `Giving User decision...`. If the operator declines or dismisses
that screen, the flag records a print that never physically happened. Nothing
observed clears `Printed` on that path.

**Consequence for Verdura:** `Printed=1` can never, on its own, be reported to
staff as "the kitchen has this". Tomorrow's physical docket remains the ground
truth for observed output.

### Duplicate KOT — is it possible on retry?

**Yes, strongly suggested.** Retry is operator-driven from the error screen and
re-sends a job whose `Printed` flag is already set — so the flag does not gate
the retry. Related reprint operations exist and are audited:
`Table Details Reprint Table`, `Pending Sale Reprint:`, `Cancelled Print Job`,
`Reprint Tables` (permission-gated: *"This Clerk does not have permission for
this function."*). `Reprint` occurs 15× (UTF-16) in `ips.exe`. **Proved** that
the capability exists; **strongly suggested** that it can duplicate a KOT.

### Other artifacts located

- `PrintJobs.Log` is named in `ips.exe` (`: data in PrintJobs.Log`) — a
  per-job log distinct from `IPSPrinterServer.LOG`. **It does not exist in the
  LOGS directory on this installation**, so per-job detail is not being written
  here. Worth asking the vendor how it is enabled.
- `StockItems.PrintPend1..12` (`PrintPend` occurs 55× UTF-16),
  `ComponentsPendPrint`, `PrintGroups`, `NetworkPrinters` — routing config,
  already recorded.
- `QueuedPacket` does not appear in `ips.exe` at all, consistent with the table
  being empty and unused.

---

## E. Native pricing model

### `Col4` — tested, not assumed

For sale 4527, every line's `Col4` was compared against
`StockItemsValue(Type=1 /* Price */, Level=1)` for the same PLU, joined on
`StockItems.Code`:

| Line | PLU | Description | `Col3` | `Col4` | Configured L1 price |
| --- | --- | --- | --- | --- | --- |
| 1 | 516 | Lamb shank - MOZZA | 1 | 45 | 45.0000 |
| 2 | 572 | MARAG POTATO | 0 | 0 | *(no row)* |
| 3 | 29 | MAABOUCH | 1 | 0.75 | 0.7500 |
| 4 | 758 | FATTOUSH SALAD | 1 | 18 | 18.0000 |
| 5 | 636 | Laban | 1 | 5.5 | 5.5000 |
| 6 | 636 | Laban | 1 | 5.5 | 5.5000 |
| 7 | 205 | Rice Pudding | 1 | 7 | 7.0000 |
| 8 | 511 | MUHALLEBI | 1 | 6 | 6.0000 |
| 9 | 578 | TIRAMISU | 1 | 12 | 12.0000 |

**Proved:** every priced line's `Col4` equals the configured Level-1 price
exactly. IdealPOS resolved these prices from its own configuration; they were
not supplied. This is the engine we want to keep authoritative.

**Explicitly NOT proved — and this is the trap:** every line has `Col3 = 1`.
Unit price and extended price are numerically identical at quantity 1, so this
data **cannot distinguish them**. `Col4` is equally consistent with unit price
and extended price. Anyone claiming `Col4` is "unit price" from this evidence is
inferring from the column name, which is exactly what we must not do.

> **Action for tomorrow:** make item **B quantity 2**. A single qty-2 line
> separates the two readings in one observation — `Col4 = unit` vs
> `Col4 = unit × 2` — and costs nothing extra. This has been added to the
> runbook.

Line 2 (MARAG POTATO, `Col3=0`, `Col4=0`, no `StockItemsValue` row at all) is
**unknown**: a zero-priced condiment, a modifier line attached to line 1, or
something else. `Col3=0` is not obviously a quantity.

### Price-level selection

Every price-level column in `IPSTransaction`:

`Clerk.DefaultPriceLevel`, `Customer.PriceLevel`, `Menus.PriceLevel`,
`PriceLevelSchedule.PriceLevel` (time-of-day scheduling),
`TouchScreen.OverridePriceLevel`, `TouchscreenGrids.PriceLevel`,
`TouchscreenGridDetails.OverridePriceLevel`, `PriceChanges.PriceLevel`,
`PdePriceChanges.PriceLevelDescriptor`.

**Proved:** there is **no** price-level column on `TableMapSetups`,
`PendingSales`, `PendingSaleLines` or `TableActivity`. On this schema, the
table or map does not select the price level. The levers are clerk, customer,
menu, time schedule and touchscreen button.

**Not concluded:** `StockItemsbyLocation` exists, so location affects stock and
possibly pricing through a path not examined. Location-based pricing is
**unknown**, not ruled out.

### Still open

Modifier representation, promotion/discount application, tax resolution
(`StockItemsValueType` 3 = Tax) and rounding are **unknown** — deliberately, as
tomorrow's items are chosen without modifiers so the first pass is clean. The
goal for tomorrow is to be able to say *"IPS chose price X because
configuration/rules yielded X"*, and the `Col4` ↔ `StockItemsValue` join above
is the mechanism that lets us say it.

---

## F. Installed integration modules — the most significant find

`ips.exe` contains: `Handheld` ×44 (UTF-16), `IdealHandheld` ×2, `Webit` ×27,
`Waiter` ×26, `IKM` ×24, `ResDiary` ×16, `SmartConnect` ×3. `Doshii` and
`VariPad` do **not** appear in `ips.exe`. **Proved.**

And in the KOT sequence recovered in §D, the line immediately preceding the
table lookup is:

> `Handheld Order successfully added to Pending Sales.`

**A native handheld order path exists that adds an order to Pending Sales and
then runs the table KOT send.** That is the shape of the capability Verdura
needs. **Proved** that the string exists in the live binary; **strongly
suggested** that it is the handheld ingestion path.

### The modules, on disk and COM-registered

All are managed (.NET) assemblies with type libraries, and all are registered
COM servers on this machine (`HKLM\SOFTWARE\Classes`). Registration is an
install-time fact and is **not** evidence of licensing.

| Assembly | Date | ProgIDs registered | Interfaces / members found | Direction |
| --- | --- | --- | --- | --- |
| **`IKM.API.dll`** (114 KB) | 2022-09-12 | `IKMAPI.COMServer`, `IKMAPI.Item`, `IKMAPI.Items`, `IKMAPI.Customer`, `IKMAPI.Notification`, `IKMAPI.KitchenMonitorStartupForm` | **`SendOrderToPOS`**, **`InsertOrderForPOS`**, **`EnqueueOrderToPOS`** (event), **`OrderAcknowledge`**, `POSOrderType` = {`PendingSale`, `NormalSale`}, `PrintGroupDone`, `StatusUpdateSend`, `CommunicationsErrorSend`, `OrderList_Last15Processed`, `RedirectPrinting`, `PrinterName`, `PrintStyle`, `IKMPOSMode`, `AddItem`, `StockItem` | **inbound to POS** |
| **`VariPad.dll`** (10 KB) | 2022-03-23 | `VariPad.VariPadManager` | `IVariPadManager`, `IVariPadManagerEvents`, **`ImportVariPadOrderFile`**, **`ProcessVariPadOrders`**, `GetFiles`, `OrderItem`, `stockItem` | **inbound, file-drop** |
| `SmartConnect.dll` (17 KB) | 2022-08-02 | `SmartConnect.SmartConnectManager`, `SmartConnect.SmartPayObject`, `SmartConnect.SmartPayRequest`, `SmartConnect.SmartPayTransaction`, `SmartConnect.Data` | `ISmartConnectManager`, `GetBaseURL`, `AppSettings` | outbound; `SmartPay*` indicates **payment**, not ordering |
| `ResDiaryPOS.dll` + `ResDiary.EposServiceConsumer.Helpers.dll` | — | `ResDiaryPOS.ResDiaryManager`, `.Transaction`, `.Business_Objects.Item`, `.Business_Objects.Receipt` | — | bookings |
| `IdealHandheldMenus.xml`, `IdealHandheldMenuItems.xml` | **2014-05-06** | — | ADO persisted-recordset menu export (`Code`, `MenuCode`, `Description`, colours) | legacy handheld menu format |

### Why `IKM.API` is the lead

`IKM.API` is the Ideal Kitchen Monitor API — and `Finished sending to IKM` sits
inside the live KOT send path, so IKM is wired into the running print pipeline
on this installation. Its surface is not read-only: `SendOrderToPOS`,
`InsertOrderForPOS`, an `OrderAcknowledge` (an acknowledgement, which is exactly
the causal-identity primitive §B of the confirmation audit says we lack), and a
`POSOrderType` enum whose values are `PendingSale` and `NormalSale` — the same
`PendingSales` structure the table sale lives in.

`VariPad` answers a question the live-discovery checklist has carried as
`BLOCKED_REQUIRES_VENDOR` since 2026-08-17: *"supported import/watch-folder
ingestion mechanisms, e.g. a documented file drop"*. `ImportVariPadOrderFile` /
`ProcessVariPadOrders` / `GetFiles` is a file-drop order ingestion mechanism,
installed on this machine.

### What this does not establish

- **Not licensed-or-enabled.** COM registration is install-time. No IKM,
  VariPad, Handheld or SmartConnect configuration was found anywhere under
  `C:\ProgramData\Idealpos Solutions\Idealpos`. **Unknown**, and
  **vendor-dependent** — the licence gateway decides.
- **Not table-aware.** Whether any of these can target a specific table/map,
  append to an existing sale, or send only new lines is **unknown**. None of it
  was invoked, and none of it will be.
- **Not endorsed.** Presence is not permission.

### The vendor question changes shape

The package currently asks an open question: *"what is the supported
mechanism?"* It can now ask specific, answerable ones — which is far more likely
to get a useful reply:

1. Is `IKM.API` (`IKMAPI.COMServer`) a supported third-party integration
   surface, or strictly internal to Ideal Kitchen Monitor?
2. What are the semantics of `SendOrderToPOS` / `InsertOrderForPOS`, and what
   does `POSOrderType.PendingSale` do — create a pending sale, or append to one?
3. Does `OrderAcknowledge` return a durable native identifier we may retain for
   reconciliation? (This is the missing causal identity.)
4. Is `VariPad`'s order-file import (`ImportVariPadOrderFile`) a supported
   ingestion path, and what is the file contract?
5. What licence entitlement do IKM API, VariPad and handheld ordering require,
   and is any of them enabled on this installation?
6. Which of these can target a table/map, append to an existing table sale, and
   send only newly-added lines?
7. `PrintJobs.Log` is referenced by `ips.exe` but is not written here — how is
   per-job print logging enabled, and does it record KOT content?

---

## Summary of corrections owed to the vendor package

1. **"Nothing was sent to TCP 12183" is false.** Four PowerShell `GET /`
   requests reached it on 2026-09-04 at 12:29:59, and the listener logged them
   as `Estranged Data`. Disclose this.
2. TCP 12183 is **not** an open question about a possible web interface. It is
   `wsPrinterError`, an internal VB6 Winsock printer-error channel. Reclassify
   and stop asking about it as an integration candidate.
3. `PendingSaleLines.Printed` must not be described as "KOT-sent". Use "set
   after handing the round to the print/KDS pipeline, before any printer
   acknowledgement".
4. Add the `IKM.API` / `VariPad` / handheld questions above; they are more
   specific and more answerable than the current open-ended question 2.
