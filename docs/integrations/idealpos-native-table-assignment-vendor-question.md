# IdealPOS native table-sale integration — vendor question and evidence package

**Status: LOCAL INVESTIGATION EXHAUSTED ON THE SURFACES INSPECTED. Vendor answer required.**
Prepared 2026-09-04 against the live DUNEDIN installation; evidence item **B**
corrected the same evening after further measurement withdrew an earlier
reading. Read-only throughout: no experimental write was made to IdealPOS,
POSServer or IPSTransaction, and no undocumented protocol command was
transmitted.

---

## The question

> **What is the supported IdealPOS integration mechanism for an external
> application to open or use an existing native table sale, add PLUs through
> IdealPOS's own pricing engine, send only newly-added lines to the kitchen,
> append later rounds to the same native sale, correlate the resulting native
> sale and lines back to an external idempotent request, and perform
> authorized finish/cancel operations?**

We are **not** asking how to insert rows directly into `PendingSales`, and we
are **not** asking to use undocumented internal protocols. We are asking which
supported interface we should be using instead.

### What we are building

A tablet ordering frontend that must behave as a trustworthy frontend for the
restaurant's **real native IdealPOS table sale**:

- Table 5, Round 1 → a native Table 5 sale, IdealPOS resolving all prices,
  exactly one KOT for the Round 1 items, then reconciliation before we report
  success to staff.
- Table 5, Round 2 → **append** to the same native sale, exactly one new KOT
  containing **only** the Round 2 items.
- On retry/crash/timeout → never resend a round IdealPOS may already have
  accepted.
- Close/cancel → through real, permission-aware IdealPOS operations.

## Installation under test

| Component | Version | Notes |
| --- | --- | --- |
| `IPS.exe` | **7.133.0200** | Native/unmanaged. Child of `IPSClient.exe`. Listens TCP 12183. |
| `IPSClient.exe` | 8.0.0.5 | Managed. Launcher/parent of `IPS.exe`. Listens 5501/5502. |
| `IPSWorker.exe` | 7.133.0200 | Native, `/WORKER`, child of `IPS.exe`. Listens 7983. |
| `POSServer.exe` | 8.0.0.1 | Managed. Service `IdealposServer`, `NT AUTHORITY\NetworkService`, `/mode=service`. Listens TCP **11000**. |
| `IPSPrinterServer.exe` | 8.00.0001 | Native. Child of `ipsdeploy.exe`. Listens TCP 11183. |
| `IdealposService.exe` | 2.9.8 | Managed. Service, NetworkService. Outbound HTTPS only; no local listener. |
| `ipsdeploy.exe` | 7.110.0001 | Native, `/startall`. Launcher/supervisor. |
| `IdealPos.Licensing.exe` | 1.5.10.0 | WCF `net.tcp://localhost:808` — licensing contracts only. |
| `IdealposObjects.dll` | 7.1.0.5 | COM-registered; contains `ISale` with `Table`/`TableMap`. |
| `IdealPos.Webit.Core.dll` | 1.0.0.0 | The inbound web-order contract we use today. |
| SQL | `localhost\IDEALSQL` | Databases `IPSTransaction`, `POSServer`. |

Fields this question refers to:
`IdealposObjects.ISale.Table` / `.TableMap`,
`IPSTransaction.PendingSales.Reference`,
`IPSTransaction.PendingSaleLines.Printed`,
`IPSTransaction.PendingSaleLines.OrderedTime`,
`IPSTransaction.TransactionReference.Reference` / `.UserDefinedText`.

---

## The 15 questions

**Entry point**

1. Is there a supported API/SDK/COM/service entry point for **creating or
   opening a native table sale at a specified Table / TableMap**?
2. If `IdealposObjects.ISale` is intended for this purpose, **what supported
   component accepts or submits it?** Please name the assembly, interface,
   method and required initialization sequence.

**Correlation**

3. Is `IPSTransaction.PendingSales.Reference` intended for third-party
   correlation? If so, **through what supported API is it set?**
4. Is there another external-reference / source / idempotency field intended
   for integrating third-party orders with native table sales? We also found
   `TransactionReference.Reference` and `TransactionReference.UserDefinedText`
   (both unused here) — are those the intended mechanism?
5. **What stable native identifier should an integration retain** for (a) the
   table sale and (b) individual sale lines?

**Rounds and KOT**

6. How should an integration **append Round 2 to the existing native table
   sale** rather than creating a second sale?
7. What supported operation causes **only newly-added lines** to be sent to
   the kitchen?
8. Is `PendingSaleLines.Printed` the authoritative "already sent to kitchen"
   state, or merely a persistence implementation detail?
9. Is `OrderedTime` meaningful **per round**, per line, or only at initial
   order creation?
15. Is there a supported **KOT audit/result identifier** we can use to prove a
    particular round was printed exactly once?

**Pricing — we specifically do not want to be the price authority**

10. Does a supported API accept **PLU / quantity / modifiers and let IdealPOS
    calculate the effective price itself**?
11. How are table price levels, specials, modifiers, tax, discounts and
    rounding resolved when an external integration adds a PLU?

**Lifecycle and safety**

12. What supported permission-aware operations exist for **finish / delete /
    cancel / void**, and what staff/operator context must be supplied?
13. What is the supported **idempotency/recovery mechanism after an ambiguous
    timeout**? We must not resend a round IdealPOS may already have accepted.
14. Is TCP 11000 / POSServer's `SENDSTAT` protocol supported for third
    parties? **Our default assumption is NO** and we will not use it unless
    you tell us otherwise.

**Additional — TCP 12183, withdrawn as a question and disclosed as an error.**
We previously asked whether `IPS.exe`'s TCP 12183 listener was a supported
interface, and stated we had not sent anything to it. **Both were wrong, and we
correct them here.**

We did send to it: four `GET / HTTP/1.1` requests from a PowerShell HTTP client
on 2026-09-04 at 12:29:59, which constitute the entire recorded contents of
`Printing.log`. We apologise for the unsolicited traffic to an undocumented
port on a live installation, and we have stopped.

Its own response tells us what it is: it logged our well-formed HTTP request as
`Estranged Data` and returned nothing. String inspection of `ips.exe` shows
`wsPrinterError` is an `MSWinsockLib.Winsock` control on form
`frmIPSPrintServerComms`, with handlers `wsPrinterError_ConnectionRequest` /
`_DataArrival` / `_Close`, adjacent to `Printer ERROR!`, `Paper Out/Cover
Open`, `Printer Turned Off`, `Throwing Retry Screen` and `Giving User
decision...`. We classify it as an internal printer-error channel, not an
integration surface, and we are not asking about it further.

**Additional — the questions we should have been asking.** This installation
carries COM-registered `IKMAPI.COMServer` (`IKM.API.dll`, exposing
`SendOrderToPOS`, `InsertOrderForPOS`, `OrderAcknowledge`, and a `POSOrderType`
of `PendingSale`/`NormalSale`) and `VariPad.VariPadManager` (`VariPad.dll`,
exposing `ImportVariPadOrderFile` / `ProcessVariPadOrders`). `ips.exe` itself
logs `Handheld Order successfully added to Pending Sales.` immediately before
its table-KOT send sequence.

16. Is `IKM.API` (`IKMAPI.COMServer`) a supported third-party integration
    surface, or strictly internal to Ideal Kitchen Monitor?
17. What are the semantics of `SendOrderToPOS` / `InsertOrderForPOS`, and what
    does `POSOrderType.PendingSale` do — create a pending sale, or append to an
    existing one?
18. Does `OrderAcknowledge` return a durable native identifier an integration
    may retain for reconciliation? This is precisely the correlation key
    questions 3–5 are asking for.
19. Is `VariPad`'s order-file import a supported ingestion path, and what is
    the file contract?
20. What licence entitlement do IKM API, VariPad and handheld ordering require,
    and is any of them enabled on this installation?
21. Which of these, if any, can target a table/map, append to an existing table
    sale, and send only newly-added lines to the kitchen?
22. `ips.exe` references a `PrintJobs.Log` that is not written on this
    installation. How is per-job print logging enabled, and does it record KOT
    content?

We have not invoked any of these interfaces and will not do so without your
confirmation that doing so is supported.

---

## Evidence appendix

All observations are from read-only inspection of this installation. **We do
not claim vendor absence from local absence** — these are the facts we can see,
not a statement about what IdealPOS supports.

**A. Verdura's Webit orders become `WBORD-*` sales, not native table sales.**
`IPSTransaction.PendingSales` shows our three orders as
`ID 4522 Code 'WBORD-600002'`, `ID 4524 Code 'WBORD-600003'`, `ID 4523 Code 'WBORD'`.

**B. We have never yet observed a native table sale at rest, in either store.**

*(This item was rewritten on 2026-09-04 evening. It previously asserted
"native table sales use the table number as `Code`", citing `ID 4527 Code
'343'`, `4497 Code '190'`, `4486 Code '537'`. Further read-only measurement
disproved that reading. The original claim is withdrawn.)*

The table map is `POSServer.TableMapSetups` `Code 1, ItemType 3,
ItemIndex 1..19` — nineteen tables. `IPSTransaction.TableActivity` records
real table use as `(Table 1..19, MapCode 1)` and holds 197 activities for
Table 5 alone. So tables are numbered 1..19 and are used daily.

Every numeric `IPSTransaction.PendingSales.Code` present — 343, 190, 537, 328,
272, 32, 995, 994, 885, 608, 579, 550 — is **outside 1..19**, and each carries
a customer-name or `MAKE IT NOW/TAKEWAY` value in `Label`. Sale 4527's nine
lines all share one `OrderedTime` and are all `Printed = 1` — a single-round
ticket. They do not look like table numbers.

**On `Map`, stated only where observed.** `POSServer.PendingSales` holds three
rows in total, so only two IPSTransaction rows have an observable counterpart
today:

| IPSTransaction | POSServer counterpart | Observed `Map` |
| --- | --- | --- |
| `4527 Code '343'` | `99697 Code '343'` | **0** |
| `4523 Code 'WBORD'` | `99410 Code 'WBORD'` | **0** |
| `4522 'WBORD-600002'`, `4524 'WBORD-600003'`, and the other 43 rows | *(none present)* | **not observed** |

The remaining historical IPSTransaction rows have **no current POSServer
counterpart**, so no `Map` value can be attributed to them. We do not infer
one. The third POSServer row is `99408 Code '0', Map 1, ClerkID 0`, with zero
lines — the only `Map 1` row present.

Two further structural facts:

- `IPSTransaction.PendingSales` has **no `Map` column at all** (full column
  list: ID, Code, POS, Date, CustomerID, ClerkID, Status, Label, Address1-2,
  Suburb, State, Postcode, OrderDate, ReadyForPayment, Prepayment, OrderState,
  SentOnline, Reference). It cannot by itself express which table map a sale
  belongs to. `POSServer.PendingSales` can, and does.
- **No native table-sale `PendingSales` row is present at the current
  closed/idle snapshot**, in either database, and all 19 table-map rows are
  `Status 0`. Its lifetime and keying remain to be established by the
  controlled capture. We are specifically *not* claiming such a row is
  transient — we have not observed one at all, and whether it is created on
  table-open, on first item, on Send, or at some other transition is exactly
  what the capture is designed to determine.

**What this means for the questions below.** We cannot yet state how an open
native table sale is keyed, which store is authoritative for it, or what
identifier it exposes — so questions 5, 6 and 13 are asked from an explicitly
unknown starting point rather than from an assumed one. A controlled two-round
capture on Table 5 is scheduled to establish the observable facts; it cannot
by itself answer what is *supported*, which is what we are asking you.

What we can still state without reservation is that **a Verdura order never
becomes a table sale**: `ORD-600002` reached `WebPendingOrder.Processed = 1`
(native IdealPOS consumed it) with no table sale ever created for it, and our
three orders remain `WBORD*` rows at `Map 0`.

**C. `ISale.Table` / `TableMap` exist, but no local submit method was found.**
`IdealposObjects.Sale` (CLSID `174C1477-…`, ProgID `IdealposObjects.Sale`) is
COM-registered and carries `Table`/`TableMap`, but its only methods are
`ConvertJson` and `SetupItem`. `IdealposObjects.IManager` exposes only
CustomerTransaction/CustomerAccountUpdate operations and takes no `Sale`. No
type in any decompiled IdealPOS assembly takes or returns a `Sale`; the only
consumer of `IdealposObjects` is `POSServer.Communication`, for
`CustomerTransaction` only. No late-bound path exists either — the only
`Activator.CreateInstance` sites are POSServer's packet factory and
IdealposService's own-assembly plugin loader; there is no `CreateObject`,
`GetTypeFromProgID`, `GetTypeFromCLSID` or `InvokeMember` against its GUIDs.

**D. `PendingSales.Reference` exists but is unused here.**
Populated in **0 of 47** pending sales. By contrast `Label` (staff free text,
e.g. "HAJAR AT 5.30 PM") is populated in 43 of 47. `TransactionReference`
— the completed-transaction reference table keyed `(Cons, POS)`, carrying
`Reference varchar(255)` and `UserDefinedText varchar(max)` — is **empty
(0 rows)**.

**E. POSServer's table protocol carries table state, not line items.**
Captured live in `POSServerClient.log`: `~SENDSTAT 11850204@@@`, and a close
sequence `SENDSTAT(status) → SENDSTAT(zeroed) → ~DELETE 18 …@@@`. Matches the
`UpdateStatus` handler. Fields are map, table, time, status, amount, guests —
**no line items, no sale identifier, no KOT state, no correlation field**.
`POSServer.PendingSales` also uses a **separate ID space** from IPSTransaction
(the same live sale is `99697` in POSServer and `4527` in IPSTransaction).

**F. IdealposService's installed plugin is outbound sync only.**
Its log shows exactly one plugin loaded:
`IdealposService.Online.SalesSync.IdealposSyncPlugin` ("Synchronize data").
`LoadPlugins` scans only `Assembly.GetExecutingAssembly()`, so there is no
third-party plugin extension point on this installation.

**G. No durable KOT audit record found in the surfaces inspected.**
No print-job/spool/KOT table with rows exists in `IPSTransaction` (only
`QueuedPacket`, 0 rows). `IPSPrinterServer` logs record only process
start/exit, not per-job detail. KOT routing itself is configured by
`StockItems.PrintPend1..12` plus `PrintGroups` and `NetworkPrinters`
(kitchen printer at an Ethernet address, port 9100). This does not rule out a
runtime trace we have not yet used.

**H. Native pricing is resolved from configuration, not supplied.**
`StockItemsValue(StockItemID, Type, Level, Value)` with
`StockItemsValueType` = {1 Price, 2 Points, 3 Tax} — i.e. price by item and
price level. This is exactly the engine we want to keep authoritative.

**I. Permission tokens governing table lifecycle exist.**
`IPSTransaction.Security` (388 rows) includes `CP\Table Map\FINISH`,
`CP\Table Map\DELETE`, `CP\Table Map\Can Override Locks`, `CP\POS\REFUND`.

## Where to send this

Idealpos Solutions support / developer-integration channel
(<https://www.idealpos.com.au/support/>), or the Support tooling inside
IdealPOS (`IdealposSupport.FileTools`), which attaches the installation's
licensing ID. Include this document plus the installation's licensing ID.

**No authenticated Idealpos support channel is available to this engineering
environment, so this has not been sent.** It must go from an account
authorised on this installation.
