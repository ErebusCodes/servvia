# IdealPOS native ingress — static investigation, 2026-09-05

**Method:** read-only. `ilspycmd` decompilation of managed assemblies, string
and type-library extraction from `IPS.exe`, registry reads, filesystem listing,
and one `netstat` listing. **No COM object was instantiated. No packet was
sent. No file was written into any IdealPOS folder. No IdealPOS database was
opened. No vendor was contacted.**

**Classification used throughout:**

- **`locally identified native ingress candidate`** — a mechanism visible in
  the installed artifacts that appears able to originate a native sale.
- **`vendor-supported integration surface`** — a mechanism the vendor
  documents and supports for third-party use.

**Nothing in this document is promoted to the second class.** No local artifact
asserts support status for anything here.

---

## 0. Headline: the lead has changed

The previous working assumption was that **`IKM.API` / `EnqueueOrderToPOS` is
the most promising native ingress family**. Tonight's decompilation shows that
is **wrong**, and the reason is structural rather than a matter of degree:

> **`IKM.API` has no inbound-order path to any COM host at all.** The class
> that carries `EnqueueOrderToPOS` is `[ComVisible(false)]`; the COM event
> interface `ICOMServerEvents` exposes only `StatusUpdate` and
> `CommunicationsError`; and `COMServer.Incoming()` dequeues every inbound
> packet and processes **only** `Status`, silently discarding everything else,
> including `Order`. `IKM.API` is a kitchen-monitor **docket display**
> transport, outbound from the POS.

The actual native ingress family, identified tonight, is **"Ideal Handheld" /
WaiterPad**: a licence-gated Winsock listener inside `IPS.exe` speaking an XML
packet protocol, with a first-party file-drop adapter (`VariPad.dll`) that
demonstrates the exact packet shape — including, decisively, that it **does not
supply a price**.

Everything below is the evidence.

---

## 1. `IKM.API` — what it actually is

`C:\Program Files (x86)\Idealpos Solutions\Idealpos\IKM.API.dll`, 114,688
bytes, 2022-09-12, managed (.NET Framework 4.0),
`AssemblyTitle("Ideal Kitchen Monitor")`, `AssemblyVersion 1.5.7744.19073`.
Ships with `.pdb` and `.tlb`. Decompiled to 4,319 lines.

### 1.1 Transport — answered

| Question | Answer | Evidence |
| --- | --- | --- |
| What process consumes `EnqueueOrderToPOS`? | **`COMServer`, in-process, inside whatever host loaded the assembly.** It is a plain .NET delegate event on `Connection`, subscribed by `COMServer.SendOrderToPOS`. | `COMServer.StartServer()`: `connection.EnqueueOrderToPOS += SendOrderToPOS` |
| Is the handoff in-process eventing, COM, files, sockets, named pipes, or Windows messages? | **Two distinct hops.** Wire: **TCP sockets** (`System.Net.Sockets.TcpClient`, `BeginConnect(mIPAddress, mPort, …)`), payload **XML** over a UTF-8 framed `<IKMPacket Type='…'>` envelope. Host handoff: **in-process .NET delegate**, not COM. | `Connection.mSocket : TcpClient`; `IKMPacket.Encapsulate`; `XMLValues.POSNamespace = "ips.idealpos.com.au"` |
| Which installed component subscribes to it? | **`COMServer` only.** It is the sole subscriber in the assembly. | single `+=` site |
| Does `ips.exe` consume the order, or does another executable translate it first? | **`ips.exe` is the COM host of `IKMAPI.COMServer`, and it consumes nothing inbound, because nothing inbound is offered to it.** | see 1.2 |

**`ips.exe` is definitively the COM client.** Its binary embeds the
type-library path it was compiled against:

```
0x0029e246  C:\dev\Idealpos\trunk\Components\IKM\IKM.API.tlb
0x0029e280  IKM_API
```

and it carries the host-side lifecycle:

```
Initialising Ideal Kitchen Monitor Interface...
IKM API STARTED.
IKM API Restarted.
frmMenu.StartIKMAPI on Line:
Ideal Kitchen Monitor cannot be initialized, restart Idealpos and try again
This IP address has already been used for another Kitchen Monitor.
```

COM registration confirms the classes are installed (`HKLM\SOFTWARE\Classes\
CLSID\{320dd65b-…}` → `mscoree.dll`, `Assembly = IKM.API`,
`Class = IKMAPI.COMServer`, both native and `WOW6432Node`), with ProgIDs
`IKMAPI.COMServer`, `.Order`, `.Item`, `.Items`, `.Customer`, `.Notification`,
`.Printer`, `.PrinterRedirect`, `.TextItem(s)`, `.NotificationMessage(s)`,
`.KitchenMonitorStartupForm`.

### 1.2 Why the inbound path is a dead end — proved

The full inbound route, traced line by line:

```
socket bytes
  → Connection.Incoming()                        // dequeues mIncomingQueue
      if type == OrderAcknowledge  → mSent.Remove(id)      // retry bookkeeping
      else                         → InsertOrderForPOS(packet)
  → Connection.EnqueueOrderToPOS?.Invoke(packet)           // .NET delegate
  → COMServer.SendOrderToPOS(packet)                       // the only subscriber
  → COMServer.mIncomingQueue.Enqueue(packet)
  → COMServer.Incoming()
        while (count > 0) {
          packet = Dequeue();
          if (packet is Status) { … PostToStatusUpdate(status); }
          // ← NO else. Every non-Status packet is dequeued and dropped.
        }
```

Three independent facts close it:

1. **`[ComVisible(false)] public class Connection`** — the class carrying
   `EnqueueOrderToPOS` is explicitly hidden from COM. No external process can
   subscribe to that event.
2. **`ICOMServerEvents` declares exactly two members**: `StatusUpdate`
   (DispId 1) and `CommunicationsError` (DispId 2). There is no order event.
3. **`COMServer.Incoming()` has no `else` branch.** An inbound `Order` packet
   is dequeued and discarded without being surfaced anywhere.

So `IKM.API` cannot deliver an inbound order to a COM host, and `ips.exe`
therefore cannot receive one through it. **`locally identified native ingress
candidate` — withdrawn for `IKM.API`.**

### 1.3 What `ICOMServer` does offer

```
int  ServerPort { get; set; }            int  POS { get; set; }
void SetIPAddresses(ref string[])        void SetPorts(ref int[])
void StartServer()                       void StopServer()
int  Enqueue(IOrder value)
bool TestConnection(string ip, int port, int pos)
void SetPrinterNames(ref string[])
bool RedirectPrinting(IOrder, IPrinterRedirect)
```

- `StartServer()` is a **misnomer**: it opens outbound `TcpClient` connections
  to configured kitchen-monitor IP/port pairs. There is **no `TcpListener`
  anywhere in the assembly.**
- `Enqueue(IOrder)` is unambiguously **outbound docket distribution**. It walks
  the order's items, calls `GetRespectiveMonitors(item)` — which consults
  `item.KitchenPrint(i)` per printer index — clones the order per monitor
  (`CloneWithoutItems()` plus header/footer copy), and queues one docket per
  destination.
- **`RedirectPrinting` is a stub.** Its entire body is
  `bool result = default(bool); return result;`. It does nothing and returns
  `false`.

### 1.4 Table identity in `IOrder` — with the caution the brief asked for

`IOrder` members, verbatim from the decompile:

| Member | Type | Note |
| --- | --- | --- |
| `Type` | `OrderType` | `PendingSale, TableOrder, NormalSale, BarTab, Custom, HHS, WebOrder, Machine` |
| `Code` | `string` | see below |
| `Adults` / `Children` | `int` | **covers.** Rendered as `Covers: {Adults}/{Children}` |
| `Server` | `string` | **operator/staff.** Rendered as `Clerk: {Server}` |
| `POS` | `int` | **POS/terminal number** |
| `OrderNumber`, `Audit`, `POSIdentifier` | `string`/`int` | identifier candidates |
| `OrderOperation` | `POSOrderOperation` | `None, Normal, DeleteAll, DeleteLine, ReplaceLine` |
| `ResetOrder` | `bool` | |
| `Status` | `short` | undocumented, no consumer in this assembly |
| `TimeIn` / `TimeOut` | `DateTime` | |
| `TrainingMode` | `bool` | |
| `SaleTypeDescription`, `Customer`, `OrderCustomer` | | |
| `Items`, `AddItem(Item)` | `IItems` | line construction |
| `PrinterName`, `Header`, `Footer`, `Notify` | | docket presentation |
| `POSMode` | `IKMPOSMode` | `None, Demo, Expiry, FullLicense` — licence state is *queryable* |

**`Code` — the evidence, not an assumption.** `Code` is **type-dependent**, and
the assembly says so in its own docket renderer:

```csharp
switch (Type) {
  case OrderType.BarTab:      "Bar Tab: {0}", Code
  case OrderType.TableOrder:  "Table: {0}",   Code      // ← table identifier
  case OrderType.PendingSale: "Pending: {0}", Code
  case OrderType.NormalSale:  "Audit: {0}-{1}", Code, POS
  case OrderType.WebOrder:    "Order: {0}", OrderNumber // ← Code unused
}
```

So: **when `Type == TableOrder`, `Code` carries the table identifier** — proved
within this assembly. What it is *not*: proof that `Code` equals the Verdura
`tableNumber`, or that it equals `TableMapSetups.Caption` rather than
`TableMapSetups.Code`. Those remain the open questions the table-`Code` premise
was already withdrawn over. Note also that for `WebOrder` — the type Verdura's
current path produces — `Code` is not rendered at all.

**TableMap field: there is none.** The complete XML element set for `Order` is
`Mode, Version, Code, POS, Operation, PrinterName, Type, OrderNumber, Server,
Adults, Children, TimeIn, TimeOut, Status, Customer, ResetOrder, Audit,
TrainingMode, SaleTypeDescription, Header, Footer, Items`. **No `Map`.** This
matters: `Map` is the column that separates a table-map sale (`Map 1`) from a
takeaway/web ticket (`Map 0`), and `Reconciliation.SelectTableSale` already
ignores it.

### 1.5 `IItem` — items, and what is missing

| Member | Type | Note |
| --- | --- | --- |
| `Line` | `int` | **line identity** |
| `StockCode` | `string` | **PLU / stock code** |
| `Quantity` | `decimal` (marshalled `Currency`) | |
| `SaleAmount` | `decimal` (settable) | see §5 |
| `AverageCost` | `decimal` (settable) | |
| `Type` | `Item.ItemType` | `StockItem, HashText, Instruction, Condiment, PrintGroup` |
| `PrintGroup` | `int` | |
| `ReceiptPrint` / `KitchenPrint` | `bool` | routing |
| `Away` | `bool` | course/away marker |
| `Seat` | `int` | |
| `ItemDescription`, `ItemDescription2`, `DeptDescription` | `string` | |
| `CopyPrinters(IItem)` | | |

**Modifiers and notes are not fields — they are sibling lines.** There is no
modifier collection on `IItem`. `ItemType.Condiment` and `ItemType.Instruction`
are how a modifier or a kitchen instruction is expressed: as its own `Item` row
following the `StockItem` it qualifies. `Order.ToString()` confirms the
rendering split — `StockItem` prints as `{qty}×{desc}`, everything else prints
indented without a quantity.

**Line operation** lives on the *order*, not the line:
`POSOrderOperation { None, Normal, DeleteAll, DeleteLine, ReplaceLine }`.

### 1.6 Multiple rounds — what exists and what it means

The append-shaped primitives **do exist**:

- `POSOrderOperation.DeleteLine` / `.ReplaceLine` / `.DeleteAll`
- `IOrder.ResetOrder : bool`
- `IOrder.Code` as a stable per-table key
- `IItem.Line` as a line ordinal

But **their semantics are not defined in this assembly.** `OrderOperation` is
serialised (`<Operation>`) and deserialised, and **never read** by any code
path in `IKM.API`. The same is true of `ResetOrder`. They are transported, not
interpreted. Whatever meaning they have is assigned by the receiving kitchen
monitor — not by the POS, and not here.

**Verdict:** `IKM.API` structurally *transports* an append-shaped vocabulary
for kitchen-monitor dockets. It provides **no** mechanism to add a round to an
existing native table order, because it provides no ingress at all.

### 1.7 Response / acknowledgement — every packet traced

Seven packet types: `CONNECTIONCOMMAND`, `NoOp`, `ORDER`, `OrderAck`,
`COMMAND`, `STATUS`, `TEST`.

| Question | Answer |
| --- | --- |
| Who generates the GUID? | **The sender.** `IKMPacket()`'s base constructor does `mIdentifier = Guid.NewGuid()`, serialised as the `identifier` attribute. |
| Does the response carry only success/failure? | **Less than that.** `OrderAcknowledge` carries exactly two things: `id` (the sender's own GUID, echoed) and `discarded` (bool). |
| Does any response carry a native sale ID / pending-sale ID / line IDs? | **No. None of the seven packet types carries any native identifier.** |
| Do later status queries exist? | **No query API exists.** `ICOMServer` has no read method. The only inbound information ever surfaced is a `Status` packet → the `StatusUpdate` COM event. |

Two further details worth recording:

- **`OrderAcknowledge.ToXml()` returns `string.Empty`.** This assembly parses
  acknowledgements but never emits one — confirming its role as the *sender*
  of orders and *receiver* of acks.
- **`Discarded` is parsed and never read.** It is a dead field within
  `IKM.API`. (`IPS.exe` has an `Order DISCARD ` log string, so the host may
  act on the *CommunicationsError* path; that is not the same thing and is not
  proved here.)
- The only effect of a received ack is `mSent.Remove(identifier)` — removal
  from an outbound retry queue.

`Status` is the sole inbound-surfaced type, and it is **bump-bar feedback**:
`StatusType { ReprintOrder, Done, DoneAndPrint, ChangePrintGroup,
PrintGroupDone }`, plus `Code`, `POS`, `Data` and the `Order` it refers to.

**The earlier withdrawal of the `OrderAcknowledge` overstatement stands, and is
strengthened**: a sender-generated key echoed back is a transport-level
idempotency primitive and nothing more. It is not causal native identity.

---

## 2. The real ingress family: Ideal Handheld / WaiterPad

Identified tonight from `IPS.exe` strings. **`WP` = WaiterPad.**

### 2.1 A licence-gated Winsock listener inside `IPS.exe`

```
0x003c1b90  Startup Listener.
0x003c1bb8   when trying to set Ideal Handheld port to Listen.
0x003c212c  Setting Socket Index 0 to Listen.  State=
0x003c2188  Error in wsWaiterPad.ConnectionRequest Line
0x003c227c  WaiterPad_DataArrival EXIT because NOT HandheldLicensed
0x003c2618  You must have POSServer set up to run Ideal Handheld
0x003c1c5c  HANDHELDRESETSECONDS
0x003c1cf4  HANDHELDCLOSESECONDS
0x0030bb30  HANDHELDPROTOCOL2
```

Protocol verbs, adjacent in the binary:
`REQUESTPROGRAM`, `LOGOUT`, `REQUESTTABLESTATUS`, `PRINTBILL`, `ORDER`,
with `WPType`, `PROTOCOL2`, `RootMenuCode`, and:

```
0x003c26f0  parsing ORDER but HandheldProcessing set - sending NAK back
0x003c27ac  <OrderItem
0x003c27c8  DISCARDING PACKET! ORDER PACKET contained no items! IP-3933
```

**Observed listener state (read-only `netstat`, nothing connected to):**

```
TCP  0.0.0.0:12183  LISTENING  pid 8684 (IPS.exe)            ← sole IPS listener
TCP  0.0.0.0:11183  LISTENING  pid 2528 (IPSPrinterServer)
```

**Licence status is UNKNOWN.** The socket is set to listen at startup; the
`HandheldLicensed` gate is applied later, at `DataArrival`. An open port is
therefore **not** evidence the module is licensed.

### 2.2 The handheld order processing routine — and the Map field

The complete routine, in binary order:

```
Checking Handheld Order : Table                     ← CheckWPOrder
DeviceID= / Checksum=
Exiting.  DUPLICATE ORDER!                          ← native idempotency
UPDATE AAAExampleData SET Data='…' WHERE ColumnType='IH-…'   ← checksum store
ProcessHandheldOrder Processing STARTED : Table <n> and Map <m>   ← TABLE + MAP
----------- TABLE ORDER : …  Covers: … -----------
DELETE * FROM PendingSaleLines WHERE Code='…'
DELETE * FROM PendingSales     WHERE Code='…'
OPEN STOCK ITEM  /  ** Item Not Found **
INSERT INTO POSServerMessages (CreatedDate,MessageType,Data) VALUES ('…','HHPOS-ALT','…')
Locked Table : Table   /  Table is locked by   /  is being used by
About to update from POSServer...
Removing residual items from Cleaned Table
Handheld Order successfully added to Pending Sales.
SELECT * FROM TableMapSetups WHERE code=<n> AND Type=3 AND [Index] = <n>
Ready to Print!
Finished sending to IKM
UpdateForeignTenders
Printed : Table
Finished setting Printed Flags : Table
About to Send to POSServer : Table
Sending Status / Table Data / UNLOCK command to POSServer : Table
CRITICAL ERROR - WP Order - Table <n> was not updated to POSServer!
IdealHandheldProcessing finished
```

Four findings of direct consequence to Verdura:

1. **The handheld path is `Table` *and* `Map` aware** —
   `ProcessHandheldOrder Processing STARTED : Table <n> and Map <m>`. `Map` is
   exactly the discriminator `Reconciliation.SelectTableSale` ignores.
2. **A native idempotency mechanism already exists**: `DeviceID` + `Checksum`,
   persisted under `ColumnType='IH-…'`, yielding
   `Exiting.  DUPLICATE ORDER!`. A duplicate handheld submission is rejected
   natively — which is a materially better primitive than anything in
   `IKM.API`.
3. **Rounds are implemented as delete-and-rewrite**, not append:
   `DELETE * FROM PendingSaleLines WHERE Code=…` then
   `DELETE * FROM PendingSales WHERE Code=…`, then
   `Handheld Order successfully added to Pending Sales.` **Strongly suggested**,
   not proved: the exact ordering of delete vs. re-insert, and whether the
   delete is scoped to unprinted lines, cannot be determined from strings.
   **This is the single most important thing tomorrow's Table 5 two-round
   capture can settle**, and it directly determines whether `nativeLineIds`
   can ever be stable.
4. **`SELECT * FROM TableMapSetups WHERE code=<n> AND Type=3 AND [Index]=<n>`**
   — the handheld path resolves the table through `TableMapSetups.code`, not
   `Caption`. Suggestive for the withdrawn table-`Code` premise; **not**
   conclusive, because the value bound to `code` is not visible in strings.

`POSServerMessages` is a **database-table message bus** between the POS and
POSServer, with types `IH-DATA`, `IH-CMD`, `IH-PRINT`, `IH-ERROR`,
`HHPOS-ALT`, `HHPOS-FIN`. Processing is serialised by a `POSWorker` semaphore
(`WORKERBUSY.1`, `Semaphore.tmp`, `frmPOSWorker.LoadRequiredLicenses`).

### 2.3 `VariPad.dll` — a first-party file-drop adapter, and the reference packet

`VariPad.dll`, 10,752 bytes, 2022-03-23,
`AssemblyDescription("Idealpos VariPad Link")`, COM-registered as
`VariPad.VariPadManager` (`{2DDA2801-…}`), 277 lines decompiled. `IPS.exe`
contains `modVariPAD` and the config key **`VARIPADFOLDER`**.

Its entire contract:

```csharp
public interface IVariPadManager {
    string variPadFolder { get; set; }
    string GetXml();          // returns "<filename>|<WPPacket XML>", or ""
}
```

`GetXml()` → `ProcessVariPadOrders()` → `Directory.GetFiles(variPadFolder,
"P*.txt")` → parses `files[0]` as **semicolon-delimited** lines:

| Field | Meaning |
| --- | --- |
| `[0]` | StockItem (PLU) |
| `[1]` | quantity |
| `[2]` | secondary text line |
| `[3]` | description |
| `[4]` | **Table** |
| `[6]` | **Clerk** |

and emits exactly the WaiterPad packet shape:

```xml
<WPPacket>
  <Order Type="ORDER">
    <Table>…</Table>   <Clerk>…</Clerk>  <Guests>0</Guests>
    <VoidMode>False</VoidMode>  <Total>0</Total>
    <CashAmount>0</CashAmount>  <PointsAmount>0</PointsAmount>
    <SalesCaption/>  <PrintReceipt>False</PrintReceipt>
    <LocalAddress/>  <DeviceID/>
    <OrderItem Index="">
      <Type/>  <StockItem>…</StockItem>  <Description>…</Description>
      <Quantity>…</Quantity>  <Price>-9999</Price>
      <Seat>0</Seat>  <PriceLevel>1</PriceLevel>
    </OrderItem>
    …
  </Order>
</WPPacket>
```

**`Table` is a first-class integer field.** `m_table == 0` means "no order" and
`GetXml()` returns empty — table 0 is not addressable.

**Never instantiated on this machine.** `VariPadManager`'s constructor
unconditionally calls `VariPadLog.Initialise()` → `VariPadLog.Write("VariPad
initialised")`, which creates
`C:\ProgramData\Idealpos Solutions\Idealpos\logs\VariPad*`. **No such log
exists.** So the class is registered but has never been constructed here.

---

## 3. Local documentation search — result

Searched `C:\Program Files (x86)\Idealpos Solutions`,
`C:\ProgramData\Idealpos Solutions`, `C:\Users\Public`, and the user's
Documents/Downloads/Desktop for `*.chm`, `*.pdf`, `*.hlp`, `*.htm(l)`, `*.xml`,
`*.txt`, `*.rtf`, `*.doc(x)`, plus a name search for
`IKM|VariPad|Handheld|KitchenMon|ODS`, plus the uninstall registry and the
licence agreement text.

### **There is no IKM API documentation on this machine. None.**

- **No CHM, no PDF, no HLP** relating to IdealPOS anywhere. The only PDFs found
  are a Bixolon printer manual and unrelated personal documents.
- **No `IKM.API.xml`.** Every `.xml` doc file under the install directory
  belongs to a third-party library — `log4net.xml`, `Newtonsoft.Json.xml`,
  `CefSharp.XML`, `DotNetOpenAuth.*.xml`, `System.Net.Http.xml`,
  `RestSharp.xml`, `PhoneNumbers.xml`, `System.Data.SQLite.xml`.
- **No sample code** of any kind.
- **Licence agreement mentions nothing**: `Kitchen Monitor` = 0 hits,
  `IKM` = 0, `VariPad` = 0, `Handheld` = 0, `SDK` = 0, `integration` = 0,
  `module` = 0, `interface` = 0. (`API` = 1, incidental.)
- **Installer feature names**: three `Idealpos 7` entries only (installed
  2019-06-06, 2022-10-19, 2023-11-06). **No separate Kitchen Monitor,
  Handheld, VariPad or SDK product is registered.**

### What *was* found, and what it is worth

| Artifact | What it is | Not |
| --- | --- | --- |
| `IdealHandheldMenuItems.xml` (134 KB) and `IdealHandheldMenus.xml` (16 KB), both **2014-05-06** | ADO persisted rowsets — a handheld button-grid export. 75 menu rows, 833 item rows, columns `Code, MenuCode, Description, StockItem, MenuLink, Behaviour, Data, BackColour` | **Not documentation.** And **not this venue's data**: descriptions are a generic sandwich-shop menu (`*SPREADS*`, `*MEAT* $$$`), the file date is install-media vintage, and the venue's installs are 2019+. Vendor sample data. |
| Licence/module strings in `IPS.exe` | `HandheldLicences`, `Handheld / eCommerce Only`, `WaiterPad_DataArrival EXIT because NOT HandheldLicensed`, `frmPOSWorker.LoadRequiredLicenses`, `You are not licenced to use this module` | Proves a **licence gate named for handheld** exists. Says nothing about this venue's entitlement. |
| `IKM.API.tlb`, `variPad.tlb` (both 2014-11-25) | Type libraries | Machine-readable interface definitions, already covered by decompilation. No prose, no support statement. |

**Conclusion for the brief's question:** no local artifact describes IKM,
VariPad or Ideal Handheld as an integration SDK or a supported handheld API.
There is no wording to record, and no version to record. **Support status
remains `UNKNOWN UNTIL SUPPORTED-INTERFACE EVIDENCE`.**

---

## 4. KOT path — sharpening the guarantee boundary

The observed sequence:

```
Ready to Print!  →  Finished sending to IKM  →  Printed : Table  →  Finished setting Printed Flags : Table
```

### 4.1 It is inside the handheld routine, not a generic print path

Those four strings sit **between** `Handheld Order successfully added to
Pending Sales.` and `About to Send to POSServer : Table`, inside the
`WPOrder` / `ProcessHandheldOrder` block (0x0030dc4c–0x0030e6e4). They are the
handheld order's kitchen dispatch, not a general-purpose printing routine.

### 4.2 What "IKM" means here — answered

**Kitchen Monitor, not printer delivery.** Three independent supports:

1. `IKM` in `IPS.exe` resolves to the type library
   `Components\IKM\IKM.API.tlb` and the `StartIKMAPI` / `IKM API STARTED.`
   lifecycle. There is no other `IKM` in the binary.
2. `IKM.API`'s only outbound operation, `Enqueue(IOrder)`, distributes dockets
   to configured kitchen **monitors** over TCP.
3. `IPS.exe` carries `IKM must use an ethernet connection` — a monitor-side
   connectivity constraint, distinct from the printer path below.

**`Finished sending to IKM` therefore means "handed to the Kitchen Monitor
transport", not "a printer produced paper".**

### 4.3 Is `Printed` set before physical printer success? — Yes, provably

Ethernet printer delivery is a **completely separate, asynchronous code path**,
in `frmMenu`, over MSWinsock, against a **separate process**:

```
0x003583e0  \IPSPrinterServer.exe                      ← separate executable, PID 2528, listening :11183
0x003c7c74  Sending Ethernet Printer Check Data...
0x003c817c    :  Sending m_EthernetPrintJob Length =
0x003c7e10  wsIPSPrintServer_SendComplete
0x003c810c  wsIPSPrintServer_DataArrival event... RECEIVED.
0x003c7f64  Ethernet Printer OK! ASC dt=
0x003c820c  wsIPSPrintServer_DataArrival event... Printer ERROR! ASC dt=
0x003c828c   Throwing Retry Screen
0x003c82e4  Paper Out/Cover Open
0x003c8508  Printer Turned Off
0x003c8774  Could not Send Print Job to Ethernet printer at
0x003c87dc  Could not Connect to IPS Print Server at
0x003d6d70  Failed Print Job - will continue to Retry for 60 seconds from
0x0039ea70  SendPrintJobs but IdealHandheldProcessing.  Exiting but will try again later...
```

The physical outcome is only known when `wsIPSPrintServer_DataArrival` fires —
either `RECEIVED.` → `Ethernet Printer OK!`, or `Printer ERROR!` → a retry
screen requiring a **human decision** (`-----Giving User decision...`,
`-----User chose to send `, `-----Sent Error Job to local port.`).

`Finished setting Printed Flags : Table` is written in the WPOrder routine,
long before any of that. And the last string above proves the two are not even
concurrent: **print jobs are deliberately deferred while handheld processing
runs.**

### 4.4 The boundary, stated so it cannot be collapsed

| Claim | Status |
| --- | --- |
| the line was selected for printing (`Select * from PendingSaleLines where Printed=False AND Code='…'`, in `PrintingRoutines`) | **PROVED** it exists |
| the payload was handed to the Kitchen Monitor transport (`Finished sending to IKM`) | **PROVED** as a log ordering |
| `PendingSaleLines.Printed` was set (`Finished setting Printed Flags`) | **PROVED** it follows the IKM handoff |
| **a physical KOT was definitely emitted** | **NOT ESTABLISHED, and structurally cannot be inferred from the flag** |

> **`line marked Printed` ≠ `one physical KOT definitely emitted`.**
> The flag is set in one routine; delivery is decided in another routine, in a
> separate process, asynchronously, with a 60-second retry window and a
> human-decision failure path. Verdura must never render `Printed` as "the
> kitchen has it".

### 4.5 Retry behaviour, and print-job identity

- **Bounded retry**: `Failed Print Job - will continue to Retry for 60 seconds
  from <t>`. After that, the human-decision path.
- **Does retry send the same payload?** **Strongly suggested yes.**
  `m_EthernetPrintJob` is a module-level buffer, and the recovery strings
  (`-----Saving Job into #51`, `-----Have loaded details of … and Deleted it.`,
  `-----Closing wsIPSPrintServer, then Opening File …`) describe re-opening a
  saved job file rather than rebuilding it. **Not proved** — that requires
  observing bytes, which was not done.
- **Is there a print-job ID?** **Yes, in memory and in a log — not persisted to
  the sale.** `-----Got details from … and placed in JOB#`,
  `New PrintJob = `, `-----Saving Job into #51`, ` : data in PrintJobs.Log`.
  The directories `C:\ProgramData\Idealpos Solutions\Idealpos\PrintJobs` and
  `…\PrintJobsDelayed` exist. **No native column ties a print job back to a
  `PendingSaleLines` row**, so a job id is not usable as KOT evidence for a
  specific round today.

This is exactly why `OrderRound.kotEvidenceTier` in the schema design is
three-valued (`queued` / `flag_set` / `emitted`): the local evidence tops out
at `flag_set`.

---

## 5. Pricing — is `SaleAmount` authoritative?

The brief asks whether `IItem.SaleAmount` is mandatory input, optional hint,
ignored/recalculated, or display/audit only.

### 5.1 Within `IKM.API`: structurally mandatory, semantically unused

**Mandatory on the wire.** `Item(XmlElement)` does, with no null guard:

```csharp
Quantity    = decimal.Parse(theItem["Quantity"].InnerText);
AverageCost = decimal.Parse(theItem["AverageCost"].InnerText);
SaleAmount  = decimal.Parse(theItem["SaleAmount"].InnerText);
```

A missing `<SaleAmount>` throws `NullReferenceException`; an empty one throws
`FormatException`. `WriteXml` always emits it. So the element **must** be
present in a well-formed packet.

**Unused by every consumer in the assembly.** Exhaustive search: `SaleAmount`
appears at exactly four sites — the interface declaration, the auto-property,
one `decimal.Parse`, one `WriteElementString`. It is **not** in
`Order.ToString()` (the rendered docket prints only `{Quantity}×{Description}`),
not in `GetRespectiveMonitors` (routing uses `KitchenPrint`), and not in any
arithmetic anywhere. **Within `IKM.API` it is transported and nothing else.**

(Incidental defect worth noting if this API is ever used: both the parse and
the write are culture-sensitive — no `CultureInfo` is passed — so a sender and
receiver under different locales would disagree about the decimal separator.)

### 5.2 The decisive evidence: what the first-party adapter actually sends

The brief asks whether native handheld code populates PLU + qty and leaves
amount blank, or computes a price. `VariPad.dll` answers it directly.

For **every real stock item**, `ImportVariPadOrderFile` sets:

```csharp
orderItem.stockItem = array2[0];   // PLU from the drop file
orderItem.quantity  = array2[1];   // qty from the drop file
orderItem.price     = "-9999";     // ← sentinel: NO price supplied
orderItem.priceLevel = "1";
orderItem.seat       = "0";
```

Only synthetic text lines get a real value (`price = "0"`, `type = "Text"`).
`m_total` is declared, serialised as `<Total>`, and **never assigned** — it is
always `0`. `m_guests` is likewise always `0`.

> **A first-party Idealpos adapter, shipped in the product, sends PLU +
> quantity + `Price = -9999` and a `Total` of zero, for every stock item.**

That is as close to a positive answer as static evidence can get: the native
handheld ingress contract **does not require the sender to supply a price**,
and the first-party implementation deliberately does not.

Supporting, from the handheld routine in `IPS.exe`: `OPEN STOCK ITEM` and
`** Item Not Found **` show the POS **looks the stock item up** while
processing a handheld order — the behaviour of a system deriving price from its
own catalogue.

### 5.3 What is still not proved

**`IPS.exe`'s handling of `-9999` is not directly observable from strings** —
it is a VB6 numeric constant, compiled inline, so it never appears as a string.
The inference is from the sender side and from the stock-item lookup, not from
the receiver's branch.

Per the brief's instruction not to infer recalculation without evidence:

| Claim | Grade |
| --- | --- |
| The native handheld ingress contract does not require a price from the sender | **STRONGLY SUGGESTED** (first-party adapter never supplies one) |
| IdealPOS recalculates the price from the PLU | **STRONGLY SUGGESTED** (`OPEN STOCK ITEM`, `** Item Not Found **`) — **not proved** |
| `-9999` is specifically a "no price" sentinel | **STRONGLY SUGGESTED** — the value is otherwise nonsensical, but the receiver's branch was not read |
| `IItem.SaleAmount` (IKM) is display/audit only | **PROVED within `IKM.API`**; its meaning to a *kitchen monitor* is UNKNOWN |

**The blocker the brief anticipated does not materialise.** Installed
first-party code does **not** always supply a price — it deliberately supplies
a sentinel instead. That is consistent with "IdealPOS is price authority",
though it does not yet prove it.

---

## 6. Classification summary

| Mechanism | Class | Why |
| --- | --- | --- |
| `IKM.API` `Enqueue(IOrder)` | **not an ingress at all** | outbound docket distribution to kitchen monitors |
| `IKM.API` `EnqueueOrderToPOS` | **withdrawn as a candidate** | `[ComVisible(false)]`; not on `ICOMServerEvents`; inbound `Order` packets are dequeued and discarded by `COMServer.Incoming()` |
| Ideal Handheld / WaiterPad TCP listener (`IPS.exe`, :12183) | **`locally identified native ingress candidate`** | licence-gated, Table+Map aware, native DeviceID+checksum dedup, writes `PendingSales` |
| `VariPad.dll` file drop (`P*.txt` → `variPadFolder`) | **`locally identified native ingress candidate`** | first-party adapter producing the WaiterPad packet; COM-registered; never instantiated here |
| Any of the above | **`vendor-supported integration surface`** | **NO.** No local artifact asserts support status for any of them. |

**Presence is not permission, and a listening port is not a licence.**

---

## 7. What the Table 5 capture settled — RESULTS IN, 2026-09-05

**The live run happened the same day. Results:
[`idealpos-table5-two-round-result-2026-09-05.md`](../discovery/idealpos-table5-two-round-result-2026-09-05.md).**
Against the five questions below:

| # | Question | Outcome |
| --- | --- | --- |
| 1 | delete-and-rewrite or append? | **Both, at different layers.** Round 2 **appends** lines to the same sale (proved); the sale row itself is **delete-and-rewritten** under a new surrogate ID (strongly suggested — observed 4 IDs for one sale, once with no action on the table). Per-line identity is therefore the line **ordinal + `OrderedTime`**, never `PendingSaleID`. |
| 2 | `Map` for a Table 5 sale vs `Map 0` for `WBORD-*`? | **`Map = 1`.** Proved. Confirms `Map` separates table sales from web/takeaway tickets, and that `SelectTableSale` ignoring `Map` is a real defect. |
| 3 | What does `TableMapSetups.code` hold? | Reframed by the data: the table is keyed `Code`(map)=1 / `ItemType`=3 / `ItemIndex`=5, and **`Caption` is empty for every table row**. |
| 4 | Does `Printed` flip per round? | **No — it is `True` on arrival for every line.** There is no unprinted state in POSServer at all. The round marker is **`OrderedTime`**. |
| 5 | Does round 2 mutate or replace the `PendingSales` row? | Replaced (new ID), contents appended and preserved. **The surrogate ID is disqualified as a causal anchor.** |

The original list is kept below for provenance.

### Original questions (superseded by the table above)

Reordered by what tonight changed:

1. **Is the round mechanism delete-and-rewrite or append?** §2.2 finding 3.
   This determines whether `OrderRound.nativeLineIds` can ever be stable, and
   therefore whether per-line causal identity is achievable at all.
2. **What is the `Map` value for a Table 5 sale**, and does it differ from the
   `Map 0` observed for Verdura's `WBORD-*` web orders?
3. **What does `TableMapSetups.code` hold** for Table 5 — the number, the
   caption, or neither?
4. **Does `PendingSaleLines.Printed` flip per round**, leaving round 1's lines
   `True` and round 2's `False`? That is the native round marker the design
   depends on.
5. **Does a second round mutate the existing `PendingSales` row or replace it?**
   The `DELETE … WHERE Code=` strings make replacement plausible; the row's
   identity across rounds decides whether a native sale id is stable enough to
   be causal identity.

---

## 8. Vendor questions this changes

The existing vendor package asks about `IKM.API`. Those questions should be
**re-pointed**, because they now target the wrong module:

- **Withdraw:** "Is `IKM.API` (`IKMAPI.COMServer`) a supported third-party
  integration for submitting orders?" — it structurally is not an order intake
  at all, and asking implies we did not read it.
- **Add:** Is the **Ideal Handheld / WaiterPad** protocol (TCP listener,
  `WPPacket` XML, `PROTOCOL2`) available to third-party devices, and under what
  licence (`HandheldLicences`, `Handheld / eCommerce Only`)?
- **Add:** Is `VariPad.dll`'s `variPadFolder` file drop (`P*.txt`,
  semicolon-delimited, field 4 = Table, field 6 = Clerk) a supported
  integration path?
- **Add:** Is `Price = -9999` the documented "POS determines price" sentinel?
- **Add:** Does a second handheld order for an open table append to the
  existing `PendingSales` row, or delete and rewrite it?
- **Add:** Does any handheld response carry a native sale identifier, or is
  `Handheld Order successfully added to Pending Sales.` the only signal?
