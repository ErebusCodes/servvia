# Ideal Handheld / WaiterPad — implementation-oriented protocol contract

**Written:** 2026-09-06, 23:30 – 00:45 NZST. **Passive investigation only.**

**Method.** Static analysis of the installed `IPS.exe` (40,143,120 bytes,
2023-09-11) using `pefile` + `capstone` x86-32 disassembly against a
byte-offset string map; read-only reads of the IdealPOS log tree; one
read-only `Get-NetTCPConnection -State Listen` query of this host's own TCP
table. **No packet was sent to any IdealPOS port. No connection was opened to
6983, 7983 or 12183. No WPPacket was transmitted or replayed. No database was
written. No config, registry or service was changed. No printer action. No COM
object instantiated. No UI automation. No vendor contact.**

**Reproducibility.** All addresses below are virtual addresses in `IPS.exe`
(`ImageBase 0x00400000`). Tooling kept in the session scratchpad
(`xref.py`, `ipsdis.py`, `annot.py`, `trace.py`).

**Evidence grades used, exactly as briefed:**
`PROVEN RUNTIME` · `PROVEN STATIC` · `STRONGLY INDICATED` · `NOT SHOWN` ·
`CONTRADICTED`.

---

## 0. Headline

Five things changed tonight.

1. **The listener port is resolved: TCP `6983`, hardcoded.** `PROVEN STATIC`,
   with the decoding method corroborated at runtime by an identical code
   pattern on a port we can observe.
2. **That listener is not open on this installation, and never has been.**
   `PROVEN RUNTIME`. 12183 — which an earlier note tentatively associated with
   the handheld family — is IPS.exe's **single-instance guard**, not the
   handheld ingress.
3. **Pricing is settled.** IdealPOS *replaces* a `<Price>` of `-9999` with
   `StockItems.Price<PriceLevel>` read from its own catalogue. This is no
   longer an inference from the sender side; it is the receiver's own branch.
   `PROVEN STATIC`.
4. **The append-vs-replace catastrophe risk is resolved by splitting the
   question.** There are **two different order routines**. The TCP WaiterPad
   path uses `WPOrder`, which contains **no `DELETE`** against `PendingSales`
   or `PendingSaleLines`. The delete-and-rewrite belongs to
   `ProcessHandheldOrder`, which serves the **POSServer-relayed** path, not the
   socket path. `PROVEN STATIC`.
5. **`ACK` does not mean the sale was written.** `ACK` is returned the moment
   the packet is stored in a 200-slot **in-memory array**, before any database
   work. `PROVEN STATIC`. This is the single most consequential finding for
   Verdura's recovery design.

---

## 1. Topology

```
Verdura ──TCP 6983──►  IPS.exe  (VB6, Session 1, the till UI process)
                        │  wsWaiterPad (MSWinsock control array, index 0)
                        │  wsWaiterPad_DataArrival → WPParsePacket
                        │      ├─ licence gate: NOT HandheldLicensed → exit
                        │      ├─ verb dispatch (§4)
                        │      └─ ORDER/ORDER2 → CheckWPOrder → in-RAM buffer, return ACK
                        │
                        │  (later, asynchronously)
                        │  "Buffered packet index=" drain → WPOrder
                        │      ├─ table lock check
                        │      ├─ PendingSales / PendingSaleLines  (index CodePOS / CodePOSLine)
                        │      ├─ StockItems price resolution
                        │      ├─ TableMapSetups status/seats
                        │      ├─ "Ready to Print!" → IKM → set Printed flags
                        │      └─ ~STATUS / ~TABLEDATA / UNLOCK ──► POSServer (TCP 11000)
                        │
                        └─ IPS.exe ──loopback TCP 11000──► POSServer.exe (SQL Server, downstream copy)
```

| Fact | Grade |
| --- | --- |
| `IPS.exe` hosts the WaiterPad listener (`wsWaiterPad`, MSWinsock) | `PROVEN STATIC` |
| A second listener, `IPSWorker` (`frmPOSWorkerListener`), lives at TCP **7983** and belongs to the **POSWorker** process, not the till UI | `PROVEN STATIC` + `PROVEN RUNTIME` — its `StartupListener Start` / `Socket listening.` / `StartupListener End` triple appears 661 times in `POSWorker.log`, 2023-03-12 → 2026-09-05 |
| TCP **12183** on `IPS.exe` is a single-instance guard, not handheld | `PROVEN STATIC` — the same LocalPort/Listen pattern, whose bind-failure branch raises *"Idealpos is already running.  Idealpos will now shut down."*, at `0x0283ecd9` — plus `PROVEN RUNTIME` (observed listening, pid 20056) |
| `POSServer` holds a rewritten downstream representation, not the authoritative store | `STRONGLY INDICATED` — carried forward unchanged from `idealpos-native-invocation-decision-2026-09-05.md` |

---

## 2. Exact ingress endpoint

### 2.1 The port — how it was resolved

VB6 compiles the port as a numeric immediate, so it never appears as a string.
It was recovered by locating the property assignment itself.

At `0x02811abb`, inside the WaiterPad startup-listener sub (`0x02811a20`,
which logs *"Startup Listener."* at `0x02811d31` and whose failure branch logs
*" when trying to set Ideal Handheld port to Listen."* at `0x02811ef3`):

```
0x02811abb  mov  dword ptr [ebp-0x68], 0x1b47      ; VARIANT lVal  = 6983
0x02811ac2  mov  dword ptr [ebp-0x70], 3           ; VARIANT vt    = VT_I4
0x02811ad2  call dword ptr [eax+0x304]             ; Me.wsWaiterPad  (control array)
0x02811afe  call dword ptr [edx+0x40]              ; .Item(0)
0x02811b68  call dword ptr [0x401538]              ; __vbaLateIdSt(obj, dispid=2, VARIANT)
0x02811cf8  push 0 / push 0x41 / call [0x401048]   ; __vbaLateIdCall(obj, dispid=0x41)  → .Listen
```

**`0x1B47 = 6983`.**

**Why the dispid decoding is trustworthy.** The identical five-step pattern —
`VT_I4` variant, `[eax+0x304]`, `.Item(0)`, `__vbaLateIdSt(…, 2, …)`,
`__vbaLateIdCall(…, 0x41)` — occurs at `0x0283ecd9` with the immediate
`0x2F97 = 12183`, and **12183 is observed listening under `IPS.exe`**. The same
pattern at `0x029938be` carries `0x1F2F = 7983` for `IPSWorker`, and
`POSWorker.log` records that listener starting successfully 661 times. So
dispid 2 = `LocalPort` and dispid 0x41 = `Listen` are confirmed against runtime
behaviour, not guessed from a type library.

An exhaustive scan of `.text` for each candidate port encoded as
`mov [ebp-disp], imm32` / `push imm32` found **exactly one** site for 6983's
listener assignment, plus two further 6983 references at `0x02812adf` and
`0x028136e5` inside the listener-reset sub at `0x02812500` — the
`tmrCheckWaiterPadStatus` / `RESET WAITER PAD` path.

> **Ingress endpoint: `TCP <till-host>:6983`, fixed constant, not configurable
> through any `Setup`/config key.** `PROVEN STATIC`.
>
> A search of every `*PORT*` string in `IPS.exe` returns no handheld port key.
> The handheld config keys that do exist are `HANDHELDPROTOCOL2`,
> `HANDHELDRESETSECONDS`, `HANDHELDCLOSESECONDS`, `HANDHELDBACKGROUND`,
> `HANDHELDUNICODE`, `HandheldDefaultMap`, `HANDHELDTABCOLOUR1..8`,
> `WaiterPadPriceLevel`, `WaiterPadNotes`, `ForceHandheldBillPrinterName`.
> None sets a port.

### 2.2 The listener is closed here — and always has been

Read-only local TCP table, 2026-09-07 ~00:05 NZST:

```
0.0.0.0:808     IdealPos.Licensing (11820)
0.0.0.0:5501    IPSClient (12800)          0.0.0.0:5502   IPSClient
0.0.0.0:11000   POSServer (7136)
0.0.0.0:11183   IPSPrinterServer (2528)
0.0.0.0:12183   IPS (20056)                ← single-instance guard
0.0.0.0:13184   ipsdeploy (12668)
```

**No 6983. No 7983.** `PROVEN RUNTIME`.

Corroboration from IdealPOS's own logs (37 MB, 227 files, back to 2019):

| Probe | Result | Grade |
| --- | --- | --- |
| `"Startup Listener."` — the WaiterPad startup log line, emitted immediately after the `LocalPort`/`Listen` pair | **zero occurrences, ever** | `PROVEN RUNTIME` |
| `"StartupListener Start"` — the *IPSWorker* equivalent | 661 occurrences in `POSWorker.log` | `PROVEN RUNTIME` |
| case-insensitive `handheld` / `waiterpad` / `varipad` across the whole log tree | zero matches (re-confirmed tonight) | `PROVEN RUNTIME` |
| licence line at every `IPS.exe` startup | `UserName=Sila Restaurant  POSNumber=1  Options=Pack 2  License Enabled=True : Type=2` — no handheld/eCommerce entitlement named, ever | `PROVEN RUNTIME` |

> **The Ideal Handheld ingress has never been opened on this installation.**
> This is a stronger statement than the previous "licence status UNKNOWN, the
> socket listens at startup". The socket does **not** listen. The earlier
> reading — that the gate is applied only later at `DataArrival` — remains true
> of `WaiterPad_DataArrival EXIT because NOT HandheldLicensed` (`0x003c227c`),
> but it is not the only gate: something upstream prevents the listener sub
> from ever running to completion here.
>
> **`CONTRADICTED`:** the earlier association of TCP 12183 with the WaiterPad
> listener. 12183 is the single-instance guard.
>
> **`NOT SHOWN`:** the precise gate that suppresses the startup. The sub at
> `0x02811a20` is reached through the form's method table and has no direct
> `E8` caller, so the guard condition was not traced. Candidate: the same
> `HandheldLicences` licence check named at `0x00357f5c`.

---

## 3. WPPacket framing

| Property | Value | Grade |
| --- | --- | --- |
| Transport | TCP stream, MSWinsock, `wsWaiterPad(0)` accepts onto further indices (`"Accepted connection on Socket Index : "`, `"Setting Socket Index 0 to Listen."`) | `PROVEN STATIC` |
| Payload | XML, `<?xml version='1.0' encoding='utf-8' ?>` | `PROVEN STATIC` |
| Root element | `<WPPacket>`; verb carried on the `Type` attribute for responses, and in a `<WPType>` element for requests (`0x02817647`) | `PROVEN STATIC` |
| Message delimiter | `</WPPacket>` — the receiver scans the accumulated buffer for the closing tag (`0x02818a20`) and logs `"Parsing from Index = "` (`0x02818575`) | `STRONGLY INDICATED` — the strings are present and used in the parse loop; the exact framing state machine was not fully decoded |
| Multiple packets per TCP read | supported (`"Buffered packet index="`, `"Parsing from Index = "`) | `STRONGLY INDICATED` |
| Large responses | `"---Sent Large Return Packet---"` (`0x003c2890`), chunked via `SendProgress` / `SendComplete` | `PROVEN STATIC` |
| Unicode | `HANDHELDUNICODE` config key exists | `NOT SHOWN` what it switches |
| Protocol version | `PROTOCOL2` element (`0x0281785b`) and `HANDHELDPROTOCOL2` config key; selects `ORDER` vs `ORDER2` handling | `STRONGLY INDICATED` |

**Malformed input handling.** `"XML parsing error"` (`0x02818ae8`) →
`NAKREGO`-class response. `"DISCARDING PACKET! ORDER PACKET contained no
items! IP-3933"` (`0x02818628`) — an ORDER with no `<OrderItem` is **silently
discarded**. `PROVEN STATIC`. That last one is a hazard: a discarded packet is
not obviously distinguishable from an accepted one at the wire level.

---

## 4. Request schema — verbs

Dispatch decoded from `WPParsePacket` (`0x02817900` – `0x02818b30`), in the
order the string constants are referenced:

| Verb | Handler | Notes | Grade |
| --- | --- | --- | --- |
| `REQUESTPROGRAM` | menu/table/clerk export | replies with the handheld program: `RootMenuCode`, `WPTables`, `WPClerks`, `WPMenuItems`, `AddPOSMenus`, `AddPOSGrids`, table-status colours. Gated by `"You must have POSServer set up to run Ideal Handheld"` (`0x02817b52`) | `PROVEN STATIC` |
| `COMMAND` | — | present at `0x02817608`; not decoded | `NOT SHOWN` |
| `LOGOUT` | device deregistration | `0x02817bf6`, takes `DeviceID` | `PROVEN STATIC` |
| `REQUESTTABLESTATUS` | table readback | `0x02817d3e`, takes `Table` — see §13 | `PROVEN STATIC` |
| `PRINTBILL` | `WPBillPrint` (`0x018255f0`) | `0x028180f7`; honours `ForceHandheldBillPrinterName`; can return `NAKPRINT` | `PROVEN STATIC` |
| `ORDER` | `CheckWPOrder` (`0x01825f30`) | `0x0281838c` | `PROVEN STATIC` |
| `ORDER2` | `CheckWPOrder` (same sub) | `0x028183c1` / `0x02817568`; the PROTOCOL2 variant | `PROVEN STATIC` |

**Both `ORDER` and `ORDER2` reach the same entry point** — the single `E8` call
to `CheckWPOrder` is at `0x02818883`. The difference is in packet parsing, not
in the write path. `PROVEN STATIC`.

**Device registration is a precondition.** `CheckWPOrder`'s neighbourhood
carries `"Ideal Handheld - WP Current Count="`, `" - Waiters="`,
`"Adding <x> to current devices."` and `"BAD REGO"`, and `NAKREGO` is one of
the responses. `STRONGLY INDICATED`: a `DeviceID` unknown to the POS is
rejected with `NAKREGO` rather than accepted. `NOT SHOWN`: how a device becomes
registered — presumably via `REQUESTPROGRAM`, but that was not traced.

---

## 5. Order schema

### 5.1 The `<Order>` envelope

The authoritative shape comes from `VariPad.dll`'s `ImportVariPadOrderFile`,
which is first-party Idealpos code that *emits* this exact packet:

```xml
<?xml version='1.0' encoding='utf-8' ?>
<WPPacket>
  <Order Type="ORDER">
    <Table>5</Table>            <Clerk>1</Clerk>        <Guests>0</Guests>
    <VoidMode>False</VoidMode>  <Total>0</Total>
    <CashAmount>0</CashAmount>  <PointsAmount>0</PointsAmount>
    <SalesCaption/>             <PrintReceipt>False</PrintReceipt>
    <LocalAddress/>             <DeviceID/>
    <OrderItem Index="">
      <Type/>                   <StockItem>23</StockItem>
      <Description>Lemon slice</Description>
      <Quantity>1</Quantity>    <Price>-9999</Price>
      <Seat>0</Seat>            <PriceLevel>1</PriceLevel>
    </OrderItem>
  </Order>
</WPPacket>
```

### 5.2 What `IPS.exe` actually reads

Element names, in the order the receiver dereferences them:

| Element | Read at | Consumed as | Grade |
| --- | --- | --- | --- |
| `Table` | `CheckWPOrder` `0x01825fda`; `WPOrder` | the table number; becomes `PendingSales.Code` | `PROVEN STATIC` |
| `DeviceID` | `CheckWPOrder` `0x018260f5`; `WPOrder` `0x0182d538` | duplicate-guard key and lock owner | `PROVEN STATIC` |
| `Checksum` | `CheckWPOrder` `0x01826163`; `WPOrder` `0x0182d5ce` | duplicate-guard value — **sender-supplied** | `PROVEN STATIC` |
| `Clerk` | `WPOrder` `0x0182d737` | `PendingSales.ClerkID` | `PROVEN STATIC` |
| `Guests` | `WPOrder` `0x0182d83b` | covers → `TableMapSetups.GuestsSaved`, with `DefaultCovers` fallback | `PROVEN STATIC` |
| `OrderItem` | `WPOrder` `0x0182f16b` | the line collection | `PROVEN STATIC` |
| ↳ `StockItem` | `0x0182f1e8` | PLU → `StockItems` lookup | `PROVEN STATIC` |
| ↳ `Quantity` | `0x0182f268` | line quantity | `PROVEN STATIC` |
| ↳ `Instruction` | `0x0182f617` | kitchen instruction / non-stock line | `PROVEN STATIC` |
| ↳ `description` (lowercase) | `0x0182f708` | supplied description | `PROVEN STATIC` |
| ↳ `PriceLevel` | `0x0182fcc3` | selects `StockItems.Price<N>` — see §7 | `PROVEN STATIC` |
| ↳ `Price` | `0x0182fd43` | `-9999` sentinel, else the literal price — see §7 | `PROVEN STATIC` |
| `Map` | **not read from the packet in either order routine** | the POS resolves it (`HandheldDefaultMap` config key exists) | `STRONGLY INDICATED` |
| `Seat` | not observed being read on the order path | | `NOT SHOWN` |
| `Total`, `CashAmount`, `PointsAmount`, `VoidMode`, `PrintReceipt`, `SalesCaption`, `LocalAddress` | not observed on the order path | | `NOT SHOWN` |
| `OrderItem/@Index` | `VariPad` always emits `""` | | `NOT SHOWN` whether the receiver reads it |

> **`Map` is not a request field.** The log line
> `"WPOrder Processing STARTED : Table <n> and Map <m>"` reports a value the POS
> derived, and the subsequent lookup is
> `SELECT * FROM TableMapSetups WHERE code=<map> AND Type=3 AND [Index]=<table>`.
> This matches the Table 5 capture exactly: that table is keyed `Code`(map)=1 /
> `ItemType`=3 / `ItemIndex`=5. **Verdura cannot choose the map over this
> protocol.** For a single-map venue that is fine. It must be verified before
> go-live, and it is a hard constraint to record.

---

## 6. Response schema

Six literal response bodies exist, each returned by its own small accessor sub:

```xml
<?xml version='1.0' encoding='utf-8' ?><WPPacket Type = 'ACK'></WPPacket>
<?xml version='1.0' encoding='utf-8' ?><WPPacket Type = 'NAK'></WPPacket>
<?xml version='1.0' encoding='utf-8' ?><WPPacket Type = 'DUPLICATE'></WPPacket>
<?xml version='1.0' encoding='utf-8' ?><WPPacket Type = 'LOCK{n}'></WPPacket>
<?xml version='1.0' encoding='utf-8' ?><WPPacket Type = 'NAKREGO'>…</WPPacket>
<?xml version='1.0' encoding='utf-8' ?><WPPacket Type = 'NAKPRINT'>…</WPPacket>
```

The selection, decoded verbatim from `0x02818878` – `0x0281895f`:

```
r = CheckWPOrder(xmlDoc)                  ' Integer

if r = 0  or r = 3      → NAK             (0x028188a9)
if r = 1                → ACK             (0x028188ce)
if r > 0x2EE0 (12000)   → LOCK & r        (0x028188f8, r passed byref into the builder)
if r = 4                → DUPLICATE       (0x0281891d)
otherwise               → NAKREGO         (0x02818936 / 0x0281894f)
```

`PROVEN STATIC`, all five branches.

**`LOCK` encodes the holding terminal.** In `CheckWPOrder` at `0x018264f8`:

```
0x018264d7  call [0x4014b4]        ; __vbaFpI2 — the POS number parsed out of the
                                   ;   table-status string after InStr(…, "LOCKED BY")
0x018264f8  add  di, 0x2ee0        ; + 12000
0x01826503  mov  [ebp-0x30], edi   ; function result
            log "Exiting.  CT Success = " & …
```

So the response type is literally `LOCK` + `(12000 + lockingPosNumber)`, e.g.
`LOCK12002`. `PROVEN STATIC`.

**No response carries a native identifier.** No sale id, no line ids, no
timestamp, no echo of the request. `PROVEN STATIC` — the six bodies above are
the complete set, and four of them are constant strings with no interpolation
at all.

---

## 7. Pricing semantics — the production acceptance question

**Answer: WaiterPad supplies PLU + quantity + `PriceLevel`, and signals
"you decide" with `Price = -9999`. IdealPOS then reads the price out of its own
`StockItems` row. Verdura will result in the native IdealPOS price.**

This is now receiver-side evidence, not an inference from the first-party
sender.

`IPS.exe` contains **exactly one** IEEE-754 double equal to `-9999.0`, at
`0x00474698`. It is referenced from two sites, and **both are inside the
handheld order routines**:

```
; WPOrder, at 0x0182fd42 → 0x0182fe73
0x0182fcc3  push 0x6a5ce8            ; "PriceLevel"      → read from <OrderItem>
0x0182fd43  push 0x68dd3c            ; "Price"           → read from <OrderItem>
0x0182fd92  call [0x4011ac]          ; __vbaCyStr        → Currency
0x0182fdd1  fld  qword ptr [0x474698]; -9999.0
0x0182fdd7  call [0x401318]          ; __vbaFpCmpCy
            ; if equal:
0x0182fe55  push 0x68dd3c            ; "Price"
0x0182fe5e  call [0x401014]          ; __vbaStrI2(priceLevel)
0x0182fe73  call [0x4010b8]          ; __vbaStrCat       → "Price" & N
```

and the same construction in `ProcessHandheldOrder` at `0x01828538`, where the
resolved value is written straight back over the packet's price:

```
0x01828538  fld  qword ptr [0x474698]     ; -9999.0
0x0182853e  call [0x401318]               ; __vbaFpCmpCy
0x01828546  jne  0x1828677                ; not the sentinel → leave the price alone
0x01828560  call [edx+0xb4]               ; rsStockItem.Fields
0x01828583  push 0x68dd3c                 ; "Price"
0x0182858f  call [0x401014]               ; __vbaStrI2(priceLevel)
0x018285a0  call [0x4010b8]               ; __vbaStrCat  → "Price1" … "Price6"
0x018285dd  call [edx+0x30]               ; Fields.Item("Price"&N)
0x01828607  call [ecx+0x44]               ; .Value
0x01828626  call [0x401224]               ; __vbaCyVar
0x0182862c  mov  [ebp-0x88], eax          ; ← overwrites the same Currency that
0x01828632  mov  [ebp-0x84], edx          ;   was just compared to -9999
```

Immediately afterwards the routine reads `description` from the same stock-item
recordset (`0x018286c4`) — the `OPEN STOCK ITEM` / `** Item Not Found **`
lookup already known from the strings.

| Claim | Grade |
| --- | --- |
| `-9999` is the "POS determines price" sentinel, recognised by the receiver | **`PROVEN STATIC`** (was `STRONGLY SUGGESTED`) |
| On the sentinel, IdealPOS substitutes `StockItems.Price<PriceLevel>` | **`PROVEN STATIC`** (was `STRONGLY SUGGESTED`) |
| `PriceLevel` selects which of the native price columns is used | **`PROVEN STATIC`** |
| A **non**-sentinel `<Price>` is honoured verbatim as the line price | **`PROVEN STATIC`** — the `jne` skips the substitution entirely, so whatever was parsed stands |
| IdealPOS was price authority in the observed native-UI workflow | `STRONGLY INDICATED` — Table 5: `Col4` = 1.5000 / 6.0000, the configured Level-1 prices, with no price supplied by anyone |
| Webit corroboration from a second, independent path | `PROVEN RUNTIME` — `Webit.log` 2026-09-02: we sent `PricePaid=0`, IdealPOS resolved `PricePaid=15` from `StockItem.PricingMode=1` |
| Promotions / happy-hour / time-based pricing are applied on this path | `NOT SHOWN` — the branch reads a plain `Price<N>` column; `WPSetPriceLevel` and the `[BLOCK]` / `23:59` strings at `0x0030d3a4` – `0x0030d3c8` were not traced |

> **Acceptance rule for Verdura, derived directly from the branch:**
> always send `<Price>-9999</Price>`. Never send a computed Verdura price. A
> real number in that element is a silent price override, not a hint.

---

## 8. Table and map semantics

| Property | Finding | Grade |
| --- | --- | --- |
| `<Table>` is the bare table number | `PROVEN STATIC` — flows to `PendingSales.Code`; matches the Table 5 capture where `Code = '5'` |
| Table 0 is not addressable | `PROVEN STATIC` — `VariPad`: `m_table == 0` ⇒ `GetXml()` returns empty |
| The map is chosen by the POS, not the packet | `STRONGLY INDICATED` (§5.2) |
| Table identity resolves as `TableMapSetups` `code`=map, `Type`=3, `[Index]`=table | `PROVEN STATIC` (`0x018329bf`) + `PROVEN RUNTIME` (Table 5 = 1 / 3 / 5) |
| `Caption` is not the identifier | `PROVEN RUNTIME` — empty for all 19 real tables |
| The sale is scoped `POS = 1` | `PROVEN STATIC` — `SELECT * FROM PendingSales WHERE Code = '<n>' AND POS = 1` (`0x003e13b4`); the readback uses `… AND POS=1 ORDER BY Line` — plus `PROVEN RUNTIME` (the Table 5 sale carried `POS = 1` while the operating till header read POS 2) |
| Table status transitions are written back — `TableMapSetups.status`, `startTime`, `Seats`, `GuestsSaved`, `ATBLSEATS` | `PROVEN STATIC` (`0x01832ba8` – `0x0183382f`) |

---

## 9. PLU and quantity semantics

| Property | Finding | Grade |
| --- | --- | --- |
| `<StockItem>` is the PLU / stock code, looked up in `StockItems` | `PROVEN STATIC` |
| Unknown PLU → `** Item Not Found **` | `PROVEN STATIC`; `NOT SHOWN` whether that aborts the packet, drops the line, or writes an open item (`OPEN STOCK ITEM` is the adjacent branch) |
| `<Quantity>` is carried per line | `PROVEN STATIC` |
| The native UI splits qty 2 into two qty-1 lines | `PROVEN RUNTIME` (Table 5) — but this says nothing about what the handheld path does with `Quantity > 1` |
| Whether `Col4` is unit or extended price when `Col3 > 1` | `NOT SHOWN` — the Table 5 run sidestepped it structurally; no row with `Col3 > 1` was ever produced |
| Modifiers/instructions are sibling lines (`<Instruction>`), not fields | `PROVEN STATIC` — consistent with `IKM.API`'s `ItemType.Condiment` / `.Instruction` |
| Line fields written by the order routine: `SeatNumber`, `Balance`, `Printed`, `locationSold`, `OrderedTime` | `PROVEN STATIC` (`0x01830c83` – `0x01831d38`) |
| `PendingSaleLines.Col0` is a line-type discriminator and `'HH'` is one of its values (`SELECT … WHERE Col0='HH' AND Code=`, `Col0<>'HH'`, `(Col0='H' OR Col0='SI')`) | `STRONGLY INDICATED` that handheld-origin lines are distinguishable in the row itself; `NOT SHOWN` which value `WPOrder` writes. **This is the closest thing to a native provenance marker found so far and is worth one targeted read.** |

---

## 10. Append / new-round semantics

**The two routines are different programs, and only one of them is on the
socket path.**

| | `WPOrder` (`0x0182cad0`) | `ProcessHandheldOrder` (`0x01826b90`) |
| --- | --- | --- |
| Reached from | the in-RAM buffer drain, `"Buffered packet index="` → `0x0281244a`; and `0x0282c146` (`WPPacket` + `ATBLACT` table-activity path) | `0x029507aa`, in the `"Loaded xml to process Handheld Order"` / `messageType` / `IH-ERROR` block — the **POSServerMessages `IH-DATA` relay** |
| `DELETE * FROM PendingSaleLines WHERE Code=` | **absent** | present (`0x01827665`) |
| `DELETE * FROM PendingSales WHERE Code=` | **absent** | present (`0x0182770a`) |
| Row access | index seeks: `CodePOS` (`0x0182d94e`) on `PendingSales`, `CodePOSLine` (`0x0182eb3e`) on `PendingSaleLines` | recordset re-creation after the deletes |
| Locking | full: `"Table is locked by "`, `"is being used by"`, `"Locked Table : Table"`, `"About to update from POSServer..."`, UNLOCK to POSServer | none of these |
| Kitchen dispatch | `"Ready to Print!"` → `"Finished sending to IKM"` → `" (WP)"` → `"Printed : Table"` → `"Finished setting Printed Flags : Table"` | absent |
| Ends with | `"IdealHandheldProcessing finished"` | `"Totally finished : Table"` |

| Claim | Grade |
| --- | --- |
| The TCP WaiterPad ORDER path is `WPOrder` | `PROVEN STATIC` — single call chain: `WPParsePacket` → `CheckWPOrder` → buffer; buffer drain → `WPOrder` |
| `WPOrder` issues no `DELETE` against `PendingSales` / `PendingSaleLines` | `PROVEN STATIC` — exhaustive xref of both DELETE literals: `0x01827665`, `0x0182770a`, plus one unrelated site at `0x025dc50b` |
| `WPOrder` therefore appends to an existing table sale rather than replacing it | `STRONGLY INDICATED` — the index-seek pattern (`CodePOS` / `CodePOSLine`), the absence of any delete, and the `"Removing residual items from Cleaned Table"` branch all point one way, but the `AddNew` / `Update` calls themselves are vtable dispatches and were not individually decoded |
| The delete-and-rewrite hazard flagged in `idealpos-native-invocation-decision-2026-09-05.md` §2.3 reading (b) applies to the **relay** path, not the socket path | `PROVEN STATIC` for the routine split; `STRONGLY INDICATED` for the conclusion |
| The relay path exists and can be reached — POSServerMessages `IH-DATA`, plus `UPDATE POSServerMessages SET ProcessedDate = NULL WHERE MessageType='IH-DATA'` (`0x018357d2`) | `PROVEN STATIC` — **so the hazard is not eliminated, only localised.** A multi-terminal venue may route a handheld order through it. |

**Comparison with the proven manual Table 5 R1/R2 behaviour.** The native UI
result was: create at TABLE MAP selection; round 2 appends lines 2–3 to the
same sale; round 1's line survives byte-for-byte including `OrderedTime`; one
KOT per round containing only that round's items; POSServer's surrogate
`PendingSales.ID` churns. `WPOrder`'s shape is consistent with reproducing
exactly that — the same `Code`+`POS` keying, the same `OrderedTime` write, the
same `Printed`-flag-after-dispatch ordering, and the same `~TABLEDATA` /
`~NEWLINES` push to POSServer at the end (`"Sending Status to POSServer"`,
`"Sending Table Data to POSServer"`, `"Sending UNLOCK command to POSServer"`).
**It is consistency, not proof.** No handheld order has ever run on this
installation.

---

## 11. Locking

| Property | Finding | Grade |
| --- | --- | --- |
| A table lock exists and is checked **before** the packet is accepted | `PROVEN STATIC` — `CheckWPOrder` does `InStr(tableStatus, "LOCKED BY")` at `0x01826462` |
| The locking terminal is returned to the caller | `PROVEN STATIC` — `LOCK` + (12000 + POS) |
| A second lock family exists at processing time | `PROVEN STATIC` — `WPOrder`: `"Table is locked by "`, `"is being used by"`, `"Locked Table : Table "`, `"---WPOrder - Table Server in use - exiting..."`, `"WPOrder end - IPSTableServerInUse for 2 seconds."` |
| The lock is released by an explicit UNLOCK to POSServer | `PROVEN STATIC` — `"Sending UNLOCK command to POSServer : Table "` |
| A POS-side lock is surfaced to staff | `PROVEN STATIC` — `"Table Locked by Handheld POS!"` (`0x0030d98c`), `"Handheld Table locked by POS "` (`0x00316814`) |
| Lock timeout / expiry semantics | `NOT SHOWN`. `HANDHELDRESETSECONDS` and `HANDHELDCLOSESECONDS` govern the **socket**, not the table lock. |

> A `LOCK{n}` response is a **retryable** outcome and must be modelled
> separately from `NAK`. It says "someone else holds this table right now",
> not "your order was rejected".

---

## 12. Duplicate and idempotency semantics

### 12.1 The mechanism, decoded

```
CheckWPOrder(xml):
    table    = xml..Table
    deviceID = xml..DeviceID
    node     = xml..Checksum
    if node Is Nothing        → SKIP the duplicate check entirely   (0x018261ad)
    chk      = node.text
    if chk = ""               → SKIP the duplicate check entirely   (0x01826202)
    log "Checksum=" & chk & "  DeviceID=" & deviceID
    if g_flag[0x02A2F1E4] <> 0 then                                  (0x01826289)
        if IsDuplicateHandheldOrder2(chk, deviceID) then
            result = 4  → DUPLICATE                                  (0x018262b6)
    else
        ' in-memory LastCheckSum comparison, same outcome
            result = 4  → DUPLICATE                                  (0x01826329)
    if InStr(tableStatus, "LOCKED BY") then
            result = 12000 + lockingPos  → LOCK                      (0x018264f8)
    result = 1
    for i = 1 to 200
        if g_WPPackets(i) Is Nothing then
            Set g_WPPackets(i) = xml        ' ← in-RAM buffer        (0x018265ee)
            Exit Function                   ' ← returns ACK here     (0x018265f4)
    ' array full → falls through to the r = 0 / 3 NAK range
```

`IsDuplicateHandheldOrder2` (`0x01835070`):

```
SELECT * FROM AAAExampleData WHERE ColumnType='IH-<DeviceID>'
if no row:
    INSERT INTO AAAExampleData (InsertDate, ColumnType, Data) VALUES ('<now>', 'IH-<DeviceID>', '')
    → not a duplicate
else:
    if StrCmp(row.Data, checksum) = 0 → return True (0xFFFF)         (0x01835390)
```

`SaveChecksum` (`0x018267f0`) writes it:
`UPDATE AAAExampleData SET Data='<checksum>' WHERE ColumnType='IH-<DeviceID>'`
— and its **only** caller is `0x01827301`, inside `ProcessHandheldOrder`.

### 12.2 What that means, stated precisely

| Question | Answer | Grade |
| --- | --- | --- |
| Is there a request identity? | **Yes, and Verdura controls it**: `DeviceID` + `Checksum`, both sender-supplied. | `PROVEN STATIC` |
| Is the duplicate check durable across an IPS restart? | **Yes** — the comparand lives in a database table (`AAAExampleData`, one row per `ColumnType='IH-<DeviceID>'`). | `PROVEN STATIC` |
| Is it a general idempotency key? | **No. It is one-deep per device.** Only the *most recent* checksum is retained. Send A, then B, then A again → A is **accepted a second time**. | `PROVEN STATIC` |
| Is the check mandatory? | **No.** Omit `<Checksum>` or send it empty and the check is skipped outright. | `PROVEN STATIC` |
| Is there a native sale identity? | **No.** No response carries one; `POSServer.PendingSales.ID` is a churning surrogate. | `PROVEN STATIC` / `PROVEN RUNTIME` (Table 5: four IDs for one sale) |
| Is there a native line identity? | **No stable one.** The usable partition is line ordinal + `OrderedTime`. | `PROVEN RUNTIME` (Table 5) |
| Is there a status readback? | **Yes** — `REQUESTTABLESTATUS` (§13). | `PROVEN STATIC` |
| **Does `ACK` mean the round was durably executed?** | **NO.** `ACK` is returned from `CheckWPOrder` the instant the XML document is parked in `g_WPPackets(i)`, an in-process array of at most 200 slots. Not one row has been written at that point. If `IPS.exe` dies between `ACK` and the buffer drain, **the round is lost with no trace anywhere**. | **`PROVEN STATIC`** |
| Does `SaveChecksum` run on the socket path? | **Not observably.** Its sole caller is inside `ProcessHandheldOrder` (the relay path). `WPOrder` touches `LastCheckSum` at `0x0182d6b1` but does not call `SaveChecksum`. | `PROVEN STATIC` for the caller set; `NOT SHOWN` what `WPOrder` does with `LastCheckSum` |
| Where is the checksum written relative to the sale? | If it is written by `ProcessHandheldOrder`, it is written **during** processing, not at ACK. So a crash after `ACK` and before the drain leaves **no** checksum recorded either — meaning a resend would *not* be rejected as duplicate. | `STRONGLY INDICATED` |

### 12.3 The brief's question, answered directly

> *"After Verdura loses the response or restarts, can it determine whether this
> exact round was already accepted without blindly resending it?"*

**Not from the protocol alone. `NOT SHOWN` — and, on the evidence,
structurally not available.**

- There is **no query that answers "did you receive request X"**. The only
  readback is *table state*, not *request state*.
- `DUPLICATE` is informative only for the **immediately preceding** packet from
  the same `DeviceID`, and only if the packet before it actually reached
  `SaveChecksum`.
- `ACK` is not evidence of durability, so a lost `ACK` and a lost *round* are
  indistinguishable at the wire.

**But a safe procedure does exist**, built out of the readback rather than the
ack:

```
1. Verdura assigns each round a deterministic Checksum (stable across retries).
2. Send ORDER.  On ACK → mark "submitted, unconfirmed", never "sent to kitchen".
3. On timeout / lost response / restart:
      a. REQUESTTABLESTATUS for the table
      b. reconstruct the native line set (Index, StockItem, Quantity, Price, PriceLevel, SeatNumber)
      c. compare against the expected post-round line set
      d. round's lines absent   → resend the identical packet
         round's lines present  → do not resend; record reconciled
         ambiguous (same PLU/qty already present from an earlier round)
                                → HALT and require human resolution
4. LOCK{n}                      → retry with backoff; this is not a failure.
5. NAK / NAKREGO / DUPLICATE    → do not retry; surface to an operator.
```

Step (d)'s ambiguity is real and unavoidable: the readback has no round marker.
`PendingSaleLines.OrderedTime` partitions rounds *in the database* — but
`OrderedTime` is **not** among the fields the `REQUESTTABLESTATUS` response
carries (§13). So the reconciliation is exact only when the round's contents
are distinguishable from what was already on the table.

---

## 13. Native readback and reconciliation

`REQUESTTABLESTATUS` is served by the builder at `0x01823a2a` – `0x01824725`:

```sql
SELECT * FROM PendingSaleLines WHERE Code='<table>' AND POS=1 ORDER BY Line
```

and emits, per row, an `<OrderItem>` carrying:

| Element | VA |
| --- | --- |
| `Index` | `0x01823c19` |
| `StockItem` | `0x01823dd5`, `0x01823e4f` |
| `Description` | `0x01823ffa` |
| `Quantity` | `0x018241a9` |
| `Price` | `0x0182437d` |
| `SeatNumber` | `0x018245c7` |
| `PriceLevel` | `0x01824725` |

`PROVEN STATIC`.

| Property | Finding | Grade |
| --- | --- | --- |
| A supported-shaped, read-only table readback exists over the same socket | `PROVEN STATIC` |
| It returns the **resolved native price**, so Verdura can verify the acceptance requirement per line | `PROVEN STATIC` |
| It returns `Index` — a line ordinal, the same ordinal the Table 5 capture found to be the only stable per-line handle | `PROVEN STATIC` |
| It does **not** return `OrderedTime` or `Printed` | `PROVEN STATIC` — absent from the builder — so **rounds cannot be partitioned from the readback** |
| A second readback exists internally (`GetTableData. TableNumber= … MapNumber= … ClerkCode= … CustomerCode=`, `GetPendingSaleLineCollection LineCount=`) | `PROVEN STATIC`; `NOT SHOWN` whether it is reachable over the protocol |

> `REQUESTTABLESTATUS` is a **read**. It sends no order and changes no state.
> It is the one WaiterPad verb that could, in principle, be exercised first
> under an authorised test — and it is the foundation of the recovery procedure
> in §12.3.

---

## 14. KOT semantics

Sequence inside `WPOrder`, in code order:

```
"Handheld Order successfully added to Pending Sales."   0x0183293c
   SELECT * FROM TableMapSetups WHERE code=… AND Type=3 AND [Index]=…
   status / startTime / Seats / GuestsSaved / ATBLSEATS
"Ready to Print!"                                       0x01833ba6
"Finished sending to IKM"                               0x01833d7e
" (WP)"                                                 0x01833f2e
"Printed : Table "                                      0x01834283
"Finished setting Printed Flags : Table "               0x0183435d
"About to Send to POSServer : Table "                   0x018343c7
```

| Claim | Grade |
| --- | --- |
| Kitchen dispatch is triggered inside the handheld order routine, not by a generic later sweep | `PROVEN STATIC` |
| "IKM" here means the **Kitchen Monitor transport**, not a printer | `PROVEN STATIC` — carried forward: `IKM` in `IPS.exe` resolves only to `Components\IKM\IKM.API.tlb`, whose sole outbound operation distributes dockets to monitors |
| Only **new** lines are dispatched | `STRONGLY INDICATED` — the print selection is `Select * from PendingSaleLines where Printed=False AND Code = '` (`0x0039f890`), and `Printed` is set **after** the IKM handoff (`"Finished setting Printed Flags"` follows `"Finished sending to IKM"`). `PROVEN RUNTIME` corroboration from the native UI: Table 5 round 2 emitted one docket containing **only** the round-2 items, and round 1's line was not reprinted. |
| `Printed = True` ⇒ a physical KOT was emitted | **`CONTRADICTED`.** The flag is set in this routine; physical delivery is decided asynchronously in `frmMenu` / `IPSPrinterServer` with a 60-second retry and a human-decision failure path, and `"SendPrintJobs but IdealHandheldProcessing.  Exiting but will try again later..."` proves the two are deliberately **not** concurrent. Table 5 recorded 0 bytes in both printer logs while every line arrived `Printed=True`. |
| Bill printing is a separate verb with its own failure response | `PROVEN STATIC` — `PRINTBILL` → `WPBillPrint` → `NAKPRINT` on failure; honours `ForceHandheldBillPrinterName` |
| KOT evidence available to Verdura tops out at `flag_set` | `PROVEN STATIC` — this is exactly why `OrderRound.kotEvidenceTier` is three-valued |

---

## 15. Remaining unknowns

Ranked by what actually blocks the driver.

| # | Unknown | Why it matters | Grade today |
| --- | --- | --- | --- |
| 1 | **Does this venue hold a handheld licence, and would the listener open if it did?** | Nothing else matters until 6983 is listening. | `PROVEN RUNTIME` that it is not licensed and not listening; `NOT SHOWN` what enabling it requires |
| 2 | **Support status of the protocol.** No local artifact describes Ideal Handheld / WaiterPad as a third-party integration surface. | An unsupported write path into a live restaurant's till is not shippable, licence or no licence. | `NOT SHOWN` — unchanged, and unchangeable without the vendor |
| 3 | The gate that suppresses the WaiterPad startup listener sub (`0x02811a20`) | Determines whether a licence alone opens the port. | `NOT SHOWN` |
| 4 | How a `DeviceID` becomes registered (`BAD REGO` / `NAKREGO` / `"Adding … to current devices."`) | Verdura cannot send a first ORDER without it. | `NOT SHOWN` |
| 5 | Which `Col0` value `WPOrder` writes on a handheld line (`'HH'` / `'H'` / `'SI'`) | Would give a **native provenance marker** — the first one found. Answerable by one read-only SELECT against POSServer once a handheld line exists. | `STRONGLY INDICATED` that the discriminator exists |
| 6 | `AddNew` vs in-place update inside `WPOrder`'s line loop | Converts §10's append conclusion from `STRONGLY INDICATED` to `PROVEN STATIC`. Answerable statically with more disassembly. | `STRONGLY INDICATED` |
| 7 | `Quantity > 1` representation, and unit-vs-extended `Col4` | Affects every multi-quantity line. Never observed. | `NOT SHOWN` |
| 8 | Behaviour on unknown PLU — abort packet / drop line / open item | Fail-closed design depends on it. | `NOT SHOWN` |
| 9 | Whether `Seat`, `Guests`, `Total`, `VoidMode` are read on the order path | Affects covers and seat routing. | `NOT SHOWN` |
| 10 | Promotion / time-based pricing on the sentinel path | The branch reads a plain `Price<N>` column. If promotions apply elsewhere, native price may still differ. | `NOT SHOWN` |
| 11 | Whether a multi-terminal venue can route a handheld order through the **relay** path (`ProcessHandheldOrder`, delete-and-rewrite) | This is the surviving correctness catastrophe. | `PROVEN STATIC` that the path exists; `NOT SHOWN` what selects it |
| 12 | Framing state machine precision — delimiter, partial reads, keepalive, `HANDHELDCLOSESECONDS` | Wire-level robustness. | `STRONGLY INDICATED` shape only |

---

## 16. Verdict

> ### Do we now have enough evidence to implement a guarded Verdura WaiterPad / native-table driver?
>
> **Enough to *build* it: yes. Enough to *enable* it: no — and the reason is
> no longer an evidence gap, it is a fact about this installation.**

The protocol is now specified to implementation depth: endpoint, framing,
verbs, order schema, the complete response set including `LOCK{12000+POS}`, the
pricing contract, the duplicate mechanism and its exact limits, the readback
field set, and the KOT ordering. Three of the four questions the brief called
substantive are answered at `PROVEN STATIC`.

What stops it is simpler than anything further research can address: **there is
nothing listening on 6983, this venue holds no handheld entitlement, and no
handheld order has ever run here.** A driver cannot be certified against a port
that does not exist, and the vendor has still asserted no support status for
the protocol.

### 16.1 What Claude Code should implement now

All of this is offline, testable without a live POS, and touches no production
runtime.

1. **`WaiterPadPacket` codec** — a new module in `apps/venue-connector`.
   Serialise the §5.1 envelope; parse the six §6 responses into a discriminated
   union `Ack | Nak | Duplicate | Lock{posNumber} | NakRego | NakPrint`. `LOCK`
   must parse the trailing integer and subtract 12000.
2. **Hard-coded price sentinel.** The line builder must emit
   `<Price>-9999</Price>` unconditionally, with **no code path** able to place
   a Verdura-computed price in that element. Enforce with a unit test that
   fails on any other value.
3. **`RequestTableStatus` reader** — the §13 field set into a typed
   `NativeTableLineSet { index, stockItem, description, quantity, price,
   seatNumber, priceLevel }`, with the space-padding trim the Table 5 capture
   showed is mandatory.
4. **Deterministic round checksum.** A stable hash over
   `(verduraOrderId, roundOrdinal, normalised line set)` — identical on every
   retry of the same round, distinct for every distinct round. Populate
   `<Checksum>` and a stable `<DeviceID>`. Document in the code that this buys
   **one-deep** replay protection only.
5. **`RoundSubmissionState` machine** with the states the protocol actually
   distinguishes: `unsent → submitted_unconfirmed(ACK) → reconciled |
   lock_retry(LOCK) | rejected(NAK/NAKREGO) | duplicate_reported(DUPLICATE) |
   ambiguous_halt`. **`ACK` must map to `submitted_unconfirmed`, never to
   `sent` and never to `kitchen_has_it`.**
6. **The §12.3 recovery procedure**, implemented against the readback, with the
   ambiguity case wired to `ambiguous_halt` plus operator escalation rather
   than a silent resend.
7. **`kotEvidenceTier` capped at `flag_set`** on this path, with a comment
   citing §14.
8. **A transport that cannot connect.** The socket client ships behind a config
   flag defaulting to off, plus a startup assertion that refuses to dial unless
   an explicit `IDEALPOS_WAITERPAD_CERTIFIED=<venue-id>` marker is present. No
   environment currently satisfies it.
9. **Golden-file tests** built from `VariPad.dll`'s emitted packet shape and
   from the six literal response bodies — the only inputs we can honestly claim
   as first-party.
10. **Update the vendor question package** with the §15 list, and withdraw the
    remaining `IKM.API` questions.

### 16.2 What must stay gated until onsite certification

- Any TCP connection to 6983, on any host. Including "just to see if it
  answers".
- Any `ORDER` / `ORDER2` transmission.
- `PRINTBILL`, and anything else that can move paper.
- Enabling the WaiterPad route in `dine-in-route.ts`. **Webit remains the
  default**, unchanged.
- Any claim to an operator that a round reached the kitchen.

### 16.3 The minimum specific missing evidence — not another broad investigation

Six items. Four are questions for a person; two are single reads.

1. **Does the venue hold, or can it obtain, the Ideal Handheld / eCommerce
   licence option?** One line from the licence record. Today every startup logs
   `Options=Pack 2`.
2. **Vendor: is the WaiterPad TCP protocol on 6983 available to a third-party
   device, and under what terms?** This is the support-status question, and
   nothing local can answer it.
3. **Vendor: how does a device register (`BAD REGO` / `NAKREGO`)?** Without it
   the first ORDER cannot be sent.
4. **Vendor: in a two-terminal venue, what routes a handheld order to the
   POSServer relay path (`ProcessHandheldOrder`, delete-and-rewrite) instead of
   the socket path (`WPOrder`)?** This is the surviving correctness risk
   (§15 #11).
5. **The licence line and `grep -i handheld` from `DESKTOP-70DQTGJ`.** One SSH
   session, read-only. Settles whether the Front-desk till differs from this
   host — still open from the 2026-09-06 iPad discovery.
6. **One authorised loopback `REQUESTTABLESTATUS` against a licensed
   installation**, read-only, against a table with known contents. It sends no
   order, writes nothing and prints nothing — and it would convert §13 from
   `PROVEN STATIC` to `PROVEN RUNTIME` and validate the entire recovery
   procedure. **Not tonight, and not on this host.**

Items 1–4 are vendor/operator questions. Nothing further can be extracted from
this machine by reading it harder.

---

## 17. Corrections to earlier documents

| Document | Statement | Correction |
| --- | --- | --- |
| `idealpos-native-ingress-2026-09-05.md` §2.1 | listed `0.0.0.0:12183 (IPS.exe)` under the WaiterPad listener heading | 12183 is the single-instance guard (`0x0283ecd9`). The WaiterPad listener is 6983 and is **not open**. |
| same, §2.1 | "The socket is set to listen at startup; the `HandheldLicensed` gate is applied later, at `DataArrival`. An open port is therefore not evidence the module is licensed." | The first clause is not true here — the socket never listens. The `DataArrival` gate is real but is not the only one. |
| same, §5.3 | `-9999` as sentinel, and price recalculation, graded `STRONGLY SUGGESTED`, "the receiver's branch was not read" | The receiver's branch has now been read. Both promote to `PROVEN STATIC`. |
| `idealpos-native-invocation-decision-2026-09-05.md` §2.3 | append-vs-replace framed as one unresolved question with a catastrophic branch | It is two routines. The socket path has no DELETE; the catastrophic branch belongs to the POSServer relay path. |
| same, §2.4 | ranked the `VariPad` file drop above WaiterPad TCP | WaiterPad TCP now ranks first on evidence: it alone has a readback, a response vocabulary, a lock protocol, a durable duplicate guard and a proven price-resolution branch. Its accessibility problem is worse, and that is now measured rather than assumed. |
| `ipad-integration-discovery-2026-09-06.md` §2.1 | "12183 — `IPS.exe` — internal printer-error channel (previously established)" | Not the printer-error channel; the single-instance guard. The printer channel is `IPSPrinterServer` on 11183, dialled **outbound** by `IPS.exe`. |
