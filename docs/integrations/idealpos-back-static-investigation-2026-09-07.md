# IdealPOS — read-only Back investigation, 2026-09-07

**Machine:** Back / Machine 1, `DESKTOP-SOKKOQ7`, 192.168.1.250, the POSServer
host. **Front / Machine 2 (`DESKTOP-70DQTGJ`, 192.168.1.199) was not touched in
any way during this session** — no credential use, no SMB, no remote execution,
no ping.

**Passivity.** No packet was sent to 6983, 7983, 11183, 12183, 13184, 11000 or
any other port. No WaiterPad request was constructed for transmission. No
IdealPOS file was written. No IdealPOS service or process was started, stopped
or restarted. No database was written. No configuration or registry value was
changed. Every reading below is either a file read, a registry read, or the
machine reporting its own process/socket table to itself.

**Method.** `pefile` + `capstone` x86-32 against the installed binaries, the
string dump from the 2026-09-06 session (re-verified against the same
40,143,120-byte / 2023-09-11 `IPS.exe`), read-only `Get-NetTCPConnection`,
`Get-Process`, `Get-CimInstance Win32_Process`, `Get-FileHash`, registry reads,
and greps over the IdealPOS log tree.

**Evidence classes used here, per the brief:**

| Tag | Meaning |
| --- | --- |
| `[RUNTIME-BACK]` | Observed running on Back today. Says nothing about Front. |
| `[STATIC]` | Read out of a binary. The binaries are the same build on both machines, so static findings are machine-independent. |
| `[HISTORICAL]` | Read out of a log or a stored watermark on Back. A record of the past, on this machine only. |
| `[INFERENCE]` | Reasoning over the above. Explicitly not an observation. |
| `[UNKNOWN]` | Asked, not answered. |

> **The rule that governs the whole document.** A `[STATIC]` or `[INFERENCE]`
> finding is never promoted to observed Front behaviour. Where a static finding
> creates an expectation about Front, it is written as an expectation.

---

## 1. The headline findings

| # | Finding | Class |
| --- | --- | --- |
| 1 | `IPS.exe` and `IPSWorker.exe` are **byte-identical**. One image, two names. | `[RUNTIME-BACK]` for the hashes; `[STATIC]` for the consequence |
| 2 | There is **no terminal-indexed `1<n>183` port scheme**. `IPSDeploy` uses **13184, not 13183**, and 13183 does not appear in `IPS.exe` at all. | `[STATIC]` |
| 3 | **12183 is the `wsPrinterError` listener**, and its bind failure *doubles* as the single-instance guard. The 2026-09-06 contract's flat retraction of "printer-error channel" was an over-correction. | `[STATIC]` + `[HISTORICAL]` |
| 4 | **Device registration is automatic and capped by the handheld licence count.** An unknown `DeviceID` is auto-added to a 99-slot in-process array if there is licence headroom; otherwise `BAD REGO` → `NAKREGO`. | `[STATIC]` |
| 5 | `wsWaiterPad_DataArrival` has **two gates that answer nothing at all** — `NOT HandheldLicensed` and `NoReceiving=TRUE`. Silence is a protocol outcome, not only a network fault. | `[STATIC]` |
| 6 | **One `NAK` condition is now traced and it is a busy signal**: an ORDER arriving while `HandheldProcessing` is set is NAK'd. | `[STATIC]` |
| 7 | The socket ORDER path writes a `POSServerMessages` row of type **`IH-PRINT`**; the only **`IH-DATA`** INSERT in the binary is a **provisioning marker with no `Data` column**, inside a database-housekeeping routine. | `[STATIC]` |
| 8 | Front's handheld log is `\LOGS\Ideal Handheld*.*`, gated by a `HandheldLog` config key, with a per-user registry watermark `CurrentHandheldLogDate` that says whether the category has ever been written. | `[STATIC]` + `[HISTORICAL]` |
| 9 | Back's handheld watermark reads **06 Jun 2019**, alongside FuelConsole and Smartlink — features this venue does not use. | `[HISTORICAL]` |
| 10 | A `WaiterPads` **table exists in the IdealPOS schema**, and the handheld config-key set is larger than the contract recorded — including **`HANDHELDWEBITONLY1/2/3`**, indexed by handheld number. | `[STATIC]` |

---

## 2. `IPS.exe` and `IPSWorker.exe` are the same file

`[RUNTIME-BACK]`, 2026-09-07:

```
IPS.exe        40,143,120  2023-09-11  F18475A784C996351048D4F537CF0CC8E2D5EE9AA7B01B38130CDADCC85A520E
IPSWorker.exe  40,143,120  2023-09-11  F18475A784C996351048D4F537CF0CC8E2D5EE9AA7B01B38130CDADCC85A520E
```

Identical SHA-256. This explains why every virtual address in the WaiterPad
disassembly resolves identically in both files, and it has one consequence that
changes how tomorrow's capture must be read:

> **`[INFERENCE]`, but a strong one.** Both images contain the listener code for
> 6983, 7983 *and* 12183. Therefore "the binary contains the WaiterPad port"
> tells you nothing about which process binds it. A listener may only be
> attributed by **PID → process → path → command line**, never by process name
> and never by which file contains the constant.

The Front capture script records exactly that join for every listening socket.

---

## 3. The port family, and the scheme that is not there

The brief asked whether a terminal-indexed `1<n>183` scheme has real evidence
behind it. **It does not.** Here is the whole family, each entry a literal
32-bit immediate located by an exhaustive scan of the `.text` of every IdealPOS
binary on the machine.

| Port | Executable | Role | Site |
| --- | --- | --- | --- |
| 6983 | `IPS.exe` | `wsWaiterPad` LocalPort (dispid 2) + Listen (dispid 0x41) | `0x02811abb` (+ reset sites `0x02812adf`, `0x028136e5`) |
| 7983 | `IPS.exe` / `IPSWorker.exe` | POSWorker listener LocalPort | `0x029938be` |
| 11183 | `IPSPrinterServer.exe` | LocalPort (dispid 2) + Listen | `0x00413a92` |
| 11183 | `IPS.exe` | **RemotePort** (dispid 1) + Connect (dispid 0x40), printing path | `0x00fb3c7e` |
| 11183 | `IPS.exe` | RemotePort on `wsSynch` | `0x01780b49` |
| 11183 | `IPS.exe` | RemotePort in the printer dispatch (`127.0.0.1`, `-----Connecting to `, ` - POS `) | `0x023dc374` |
| 12183 | `IPS.exe` | `wsPrinterError` LocalPort + Listen | `0x0283ecd9` |
| 12183 | `IPSPrinterServer.exe` | **RemotePort** | `0x0041cb37` |
| 12183 | `IPS.exe` | RemotePort on a loopback dial (`127.0.0.1` adjacent) | `0x014e11ab` |
| 13184 | `IPSDeploy.EXE` | LocalPort **and** RemotePort | `0x00426b8f`, `0x0041eb??` |
| 11000 | `IPS.exe` | POSServer | `0x02848b3d` |

`[STATIC]`. Three independent reasons the `1<n>183` reading fails:

1. **`13183` has zero `.text` occurrences in `IPS.exe`.** The deploy port is
   **13184**. An off-by-one that a real scheme would not have.
2. **Every value is a literal immediate.** No site computes a port from a
   terminal number, a POS number or any other index. There is no arithmetic to
   find.
3. **11183 and 12183 are a bidirectional pair between two programs**, not two
   instances of one program: `IPSPrinterServer` binds 11183 and dials 12183;
   `IPS.exe` binds 12183 and dials 11183.

> **`[INFERENCE]`, recorded as a hypothesis that is now closed:** the
> "terminal-indexed scheme" was a pattern-match on three numbers ending in 183.
> It has no mechanism behind it. **The practical consequence for tomorrow: Front's
> `IPS.exe` will bind the same 12183 Back's did. An observed 12183 on Front is
> not the WaiterPad ingress.**

### 3.1 The dispid decoding, independently reproduced

The 2026-09-06 contract decoded dispid 2 = `LocalPort` and 0x41 = `Listen`. This
session reproduced both and added their counterparts:

| dispid | Property/method | Corroboration |
| --- | --- | --- |
| 1 | `RemotePort` | set to 11183 immediately before a dispid-0x40 call, in a sub whose error string is `"Error in wsConnect : "` |
| 2 | `LocalPort` | `push 2` at `0x02811b62` (6983) and `0x0283ed80` (12183), each followed by a `.Item(0)` control-array fetch |
| 0xa | `RemoteHost` | set from a string parsed out of a host argument |
| 0x40 | `Connect` | `__vbaLateIdCall(obj, 0x40, 0)` after the RemoteHost/RemotePort pair |
| 0x41 | `Listen` | `__vbaLateIdCall(obj, 0x41, 0)` after the LocalPort set |

`[STATIC]`.

---

## 4. 12183 — the correction owed to the correction

The 2026-09-06 contract §17 said, of `ipad-integration-discovery-2026-09-06.md`:

> "12183 — `IPS.exe` — internal printer-error channel (previously established)"
> → **"Not the printer-error channel; the single-instance guard."**

**That retraction was wrong, and this session has direct evidence.**

`[HISTORICAL]`, from `C:\ProgramData\Idealpos Solutions\Idealpos\LOGS\Printing.log`:

```
20260904 12:29:59.004    -----Accepted Request.
20260904 12:29:59.004    wsPrinterError_DataArrival : GET / HTTP/1.1
User-Agent: Mozilla/5.0 (Windows NT; Windows NT 10.0; en-NZ) WindowsPowerShell/5.1.19041.6456
Host: localhost:12183
...
20260904 12:29:59.019    wsPrinterError_ConnectionRequest 9868
20260904 12:29:59.034    Estranged Data : GET / HTTP/1.1
```

The socket that received traffic on 12183 is named **`wsPrinterError`**.
`[STATIC]` corroborates: the strings `wsPrinterError_ConnectionRequest`,
`wsPrinterError_DataArrival`, `wsPrinterError_Close`, `-----Accepted Request.`
and `Estranged Data : ` sit in the same neighbourhood
(`0x003c8314`–`0x003c8584`) as
`"Idealpos is already running.  Idealpos will now shut down."` (`0x003c7ad0`),
and the 12183 LocalPort/Listen site at `0x0283ecd9` is inside the printing form
(`"Printing"`, `"Connected to "`, `" : File to Print: "`, `"\PrintJobs\"`).

**The accurate statement, replacing both earlier ones:**

> TCP 12183 is `IPS.exe`'s **`wsPrinterError` inbound channel**, which
> `IPSPrinterServer` dials. Because `IPS.exe` binds it at startup, the **bind
> failure doubles as a single-instance guard** and raises *"Idealpos is already
> running."* Both readings were partly right; neither was the whole thing.
> `[STATIC]` + `[HISTORICAL]`.

### 4.1 Evidence hygiene — that log entry is ours

**The 2026-09-04 12:29:59 entries in `Printing.log` are Verdura's own probe**, a
PowerShell HTTP GET from an earlier session. They are not IdealPOS traffic and
must never be cited as evidence of how a real client talks to 12183. The
registry watermark `CurrentPrintingDate = 04 Sep 2026 12:29:59` records the same
event.

They are still useful — they prove the socket accepts connections and logs
unrecognised bytes as `Estranged Data` — but the provenance travels with them.

---

## 5. Device registration — `WAITERPAD-REGO-001`, substantially answered

`[STATIC]`. The registration sub sits immediately after the six response bodies
(`0x01824ada`–`0x01824de4`) and reads:

```
log "Ideal Handheld" & deviceId & " - WP Current Count=" & n & " - Waiters=" & m

0x0182507d   cmp  word [ebp-0x18], 0        ; already known?
0x01825081   jne  0x1825172                 ;   -> return TRUE
0x0182508b   cmp  dx, word [0x2a2f470]      ; currentCount vs licensed count
0x01825092   jge  0x1825183                 ;   -> "BAD REGO", return FALSE
0x018250a0   for ebx = 1 to 0x63            ; 99 slots
0x018250c1     __vbaStrCmp(g_devices(ebx), "")
0x01825116     __vbaStrCopy(g_devices(ebx), deviceId)
             log "Adding " & deviceId & " to current devices."
0x01825172   result = -1                    ; TRUE
```

and the cap `[0x2a2f470]` is written at `0x027e3965` from the licensing COM
object at `[0x2a2f178]`; the adjacent `[0x2a2f46e]` is set to
`(count > 0)` and is the `HandheldLicensed` boolean the DataArrival gate tests.

**What this settles:**

- There is **no enrolment ceremony**. A first packet from an unknown `DeviceID`
  registers it, if there is headroom.
- **`NAKREGO` means "no licensed slot left"**, at least on this branch.
- The device registry is an **in-process VB array**, so it does **not** survive
  an `IPS.exe` restart.

**What this raises — a new operational risk, and it is the most important thing
in this document for anyone tempted to "just try it":**

> Front's licence reads `Ideal Handheld 2`. If that grants two handheld slots
> and both are held by real waiter devices, a Verdura `DeviceID` is refused —
> and **if Verdura registered first, a real waiter's handheld would be the one
> refused.** Connecting a new device to a live service is therefore **not a
> read-only act, even before a single ORDER is sent.** `[INFERENCE]` on the
> slot count (we have not read Front's licensed number), `[STATIC]` on the
> mechanism.

**Still `[UNKNOWN]`:** whether `NAKREGO` has other causes, what the `NAKREGO`
body contains, and what number Front's licence actually grants.

---

## 6. Two gates that answer nothing at all

`[STATIC]`, inside `wsWaiterPad_DataArrival`:

```
0x02815759  cmp  word [0x2a2f46e], 0        ; HandheldLicensed
0x02815760  jne  past
            log "WaiterPad_DataArrival EXIT because NOT HandheldLicensed"
            exit                            ; <- no response written

0x028157d0  cmp  word [0x2a2f46c], 0        ; NoReceiving
0x028157d9  cmp  word [0x2a2f1e4], 0
            log "WaiterPad_DataArrival EXIT because NoReceiving=TRUE"
            exit                            ; <- no response written
```

Neither branch writes a response body. The sender sees a connection that
accepted its bytes and never replied.

> **Consequence for the driver, and it is already reflected in the code:**
> "no reply" is a **first-class protocol outcome** on this route, not merely a
> network fault. A silent till and a lost response are indistinguishable at the
> wire — and both are indistinguishable from a round that was accepted and
> executed. Every one of them lands in `unresolved`.

`[UNKNOWN]`: what sets `NoReceiving`. `[INFERENCE]`: `[0x2a2f1e4]` is the same
global `CheckWPOrder` tests to choose between the durable duplicate check and
the in-memory `LastCheckSum` comparison, which is consistent with it meaning
"POSServer is configured/reachable" — but that is not traced.

---

## 7. One traced `NAK` condition

`[STATIC]`. `"parsing ORDER but HandheldProcessing set - sending NAK back"` is
referenced at `0x0281852d`, inside `WPParsePacket`, between the ORDER/ORDER2
dispatch (`0x0281838c`) and the item-count check (`0x02818602`).

So a `NAK` can mean **the till is busy draining a previous packet**, not that
the order was rejected on its merits.

**This does not license retrying a NAK.** `CheckWPOrder` returning 0 or 3 also
produces `NAK`, and those conditions remain `[UNKNOWN]`. The conservative
mapping in `waiterpad-round-state.ts` is unchanged; only its explanation now
cites the traced case.

---

## 8. `IH-PRINT` vs `IH-DATA` — the relay question, narrowed

`[STATIC]`. Three sites matter.

**(a) The socket ORDER path writes an `IH-PRINT` row.** Inside `WPParsePacket`,
right after the no-items discard check:

```
0x02818628  "DISCARDING PACKET! ORDER PACKET contained no items! IP-3933"
0x028186d1  "dd MMM yyyy HH:nn:ss"
0x02818755  "INSERT INTO POSServerMessages (CreatedDate,MessageType,Data) VALUES ('"
0x0281877c  "','IH-PRINT','"
```

**(b) The only `IH-DATA` INSERT in the binary is a provisioning marker.** At
`0x01a31089`, in a routine surrounded by one-off database fixes:

```
0x01a30c8c  "FixLocation0"
0x01a30f01  "SELECT * FROM POSServerMessages WHERE MessageType='IH-DATA'"
0x01a31089  "INSERT INTO POSServerMessages (CreatedDate,MessageType) VALUES ('"
0x01a310b0  "','IH-DATA')"
0x01a315dc  "MiscellaneousFixes"
```

Note the INSERT has **no `Data` column** and is guarded by an existence SELECT.
It is a sentinel row, not an order.

**(c) `ProcessHandheldOrder` is driven by `frmPOSWorker`'s timer.** The caller
at `0x029507aa` sits in a string neighbourhood that includes
`frmPOSWorker.LoadRequiredLicenses`, `IPSWorker.EXIT`, `SEMAPHORE.TMP`, and:

```
0x0294f7c0  "SELECT * FROM POSServerMessages WHERE MessageType='IH-ERROR'
             OR (ProcessedDate IS NULL AND (MessageType='IH-PRINT'
             OR MessageType='IH-CMD')) ORDER BY CreatedDate"
0x0295063a  "Loaded xml to process Handheld Order"
0x02950673  "WPPacket"
0x0295081b  "messageType"
```

**Where that leaves `WAITERPAD-RECON-001`:**

> The hazard is **narrowed, not removed — and narrowed in an uncomfortable
> direction.** The socket path *does* write a `POSServerMessages` row, and the
> process that polls those rows *is* the one that owns the delete-and-rewrite
> routine. What the worker's `messageType` dispatch does with an order-shaped
> packet is `[UNKNOWN]`. **`WAITERPAD-RECON-001` stands.**
>
> `[INFERENCE]`, not asserted: because `IPS.exe` and `IPSWorker.exe` are the
> same image, "the relay runs in a different process" is not something the
> binary can tell us. Which form is running is a runtime fact per machine.

---

## 9. The handheld log, and the cheapest reading available on Front

`[STATIC]`. `IPS.exe`'s log-housekeeping table pairs globs with directories:

```
0x0153a08b  "IPSData*.*"           0x0153a0a0  "\Database Backups"
0x0153a0e2  "Ideal Handheld*.*"    0x0153a0f7  "\LOGS"
0x0153a139  "IdealposNET*.*"       0x0153a190  "POSServerClient*.*"
0x0153a448  "POSWorker*.*"         0x0153a49f  "Webit*.*"
0x0153a4f6  "PrintJobs*.*"         0x0153a54d  "Printing*.*"
```

The category is named `HandheldLog` (`0x00349cac`), alongside `IPSLog`,
`PrintJobs`, `FuelConsole`, `Smartlink`, `Webit`, `Printing`,
`POSServerClient`.

`[HISTORICAL]`, read read-only from
`HKCU\SOFTWARE\VB and VBA Program Settings\Ideal POS System\System Options` on
Back:

```
CurrentIPSLogDate            = 01 Sep 2026 04:00:10
CurrentWebitDate             = 01 Sep 2026 04:02:00
CurrentPOSServerClientDate   = 01 Sep 2026 00:00:14
CurrentPrintingDate          = 04 Sep 2026 12:29:59   <- our own 12183 probe
CurrentHandheldLogDate       = 06/06/2019 11:17:12    <- never advanced
CurrentFuelConsoleDate       = 06/06/2019 11:17:12
CurrentSmartlinkDate         = 06/06/2019 11:17:12
```

Back's handheld watermark sits at the install date, next to two features this
venue demonstrably does not use. That is the shape of a log category that has
never been written.

> **This is the single cheapest decisive reading on Front**, it is per-user
> (HKCU, so it must be read as the user that runs IdealPOS), and it is now in
> the capture script.

---

## 10. Corpus sweep — Back has never seen a WaiterPad packet

`[HISTORICAL]`. A token sweep over **135 copied log files, 23.9 MB**, spanning
2025-09 to 2026-09-07, returned **zero** matches for every one of:

```
WPPacket  WPOrder  WPType  WaiterPad  "Waiter Pad"  "Ideal Handheld"  Handheld
REQUESTPROGRAM  REQUESTTABLESTATUS  PRINTBILL  ORDER2  LOGOUT
NAKREGO  NAKPRINT  DUPLICATE  "BAD REGO"  LOCK1
Checksum  DeviceID  "WP Current Count"  "Waiters="  "current devices"
"Startup Listener"  "Setting Socket Index"  HandheldLicensed  NoReceiving
"Buffered packet index"  "Parsing from Index"  "DISCARDING PACKET"
"WPOrder Processing STARTED"  ProcessHandheldOrder  IdealHandheldProcessing
"Ready to Print"  "Finished sending to IKM"  "Printed : Table"
IH-DATA  IH-PRINT  IH-CMD  IH-ERROR  POSServerMessages
"Table is locked by"  "LOCKED BY"  "Sending UNLOCK command"
-9999  PriceLevel  "Item Not Found"  "OPEN STOCK ITEM"
HandheldNumber  "Ideal Handheld 2"  6983  7983  11183
```

The only non-zero hits were `License Enabled` / `Options=` (379 each),
`POSNumber` (1882), `12183` (4 — our own probe), `13184` (1) and `11000` (45).

Back's licence line, every startup:

```
License Gateway: UserName=Sila Restaurant  POSNumber=1  Options=Pack 2
License Enabled=True   ExpiryDate=21 Sep 2026 13:42:00 : Type=2
```

No handheld entitlement, no `HandheldNumber`. **Consistent with, and evidence
only for, Back.**

This sweep is the exact sweep the Front script runs, so tomorrow's output is
directly comparable. The Back baseline is filed at
`C:\ProgramData\Verdura\evidence\back-baseline-20260907\`.

---

## 11. Artefacts found on Back that were not previously recorded

### 11.1 The `WaiterPads` table exists in the schema

`[STATIC]`, from the `MSysObjects` catalogue inside
`C:\ProgramData\Idealpos Solutions\Idealpos\ips.mdb` (string-scanned read-only;
no database engine was attached):

```
... WriteOffTrans, WriteOffLines, WriteOffCategories, WaiterPads, VATTrans,
    Users, Transactions, TouchscreenLayouts, ... TableMapSetups, TableMaps,
    TableActivity, SystemOptions, ...
```

A table named **`WaiterPads`** is part of the IdealPOS schema. `IPS.exe`
contains **no SQL referencing it** — the only `WaiterPad`-cased strings in the
binary are VB member names (`modWaiterPad`, `wsWaiterPad`, `fmeWaiterPad`,
`tmrCheckWaiterPadStatus`) and the `WaiterPadNotes` / `WaiterPadPriceLevel` /
`WaiterPadCodeOrder` config keys. So `[UNKNOWN]`: what writes it, what its
columns are, and whether it relates to device registration at all. Worth one
read-only `SELECT TOP 1 *` when a Front session or a POSServer read is
authorised.

### 11.2 The handheld config-key set is larger than recorded

`[STATIC]`, from `ips.mdb`. Keys the 2026-09-06 contract did not list:

| Key | Note |
| --- | --- |
| **`HANDHELDWEBITONLY1` / `2` / `3`** | **Indexed by handheld number.** Front is `HandheldNumber=2`, so `HANDHELDWEBITONLY2` is the one that applies to it. A per-handheld switch whose name pairs the handheld feature with Webit — the route Verdura uses today — and whose value on Front is unknown and worth reading. |
| `HandheldV7Features` | |
| `HandheldPOSLayout` | |
| `HandheldItemGraphicLocation`, `HandheldItemBackgroundGraphic` | |
| `WaiterPadCodeOrder` | referenced from `modWaiterPad.WPMenuItems` |
| `HandheldLog` | gates whether the handheld log is written at all |
| `HANDHELDTABCOLOUR1..18` | the contract recorded 1..8; there are 18 |

None of them sets a port. The contract's statement that TCP 6983 has no config
key stands.

### 11.3 Vendor-shipped handheld menu exports

`[STATIC]`. `IdealHandheldMenus.xml` (16,481 bytes) and
`IdealHandheldMenuItems.xml` (134,245 bytes), both dated 2014-05-06, sit in the
IdealPOS program directory on Back. They are ADO persisted recordsets
(`urn:schemas-microsoft-com:rowset`) carrying menu/grid rows with `Code`,
`Description`, `BackColour`, `ForeColour`, `PriceLevel` and layout attributes.

`[INFERENCE]`: their 2014 date and demo-looking contents make them almost
certainly installer-shipped sample data rather than this venue's menu. They are
recorded because they show the **shape of the handheld program export** the
`REQUESTPROGRAM` verb serves — not because they are evidence of handheld use
here.

### 11.4 `IPS.exe` was not running during this session

`[RUNTIME-BACK]`, 2026-09-07 14:48 NZST. Back's listener table:

```
808    IdealPos.Licensing (2212)     5501/5502  IPSClient (4900)
11000  POSServer (9000)              11183      IPSPrinterServer (12504)
13184  ipsdeploy (4668)
```

**No 12183, and no `IPS.exe` process at all.** The 2026-09-06 contract recorded
12183 listening under `IPS` (pid 20056); today `IPS.exe` is simply not running.
That is consistent with — and mildly corroborates — 12183 being bound by
`IPS.exe` and nothing else. It is also a reminder that **a port's absence is a
statement about the moment you looked**, which is exactly why the Front capture
records process start times alongside the listener table.

---

## 12. What this session did NOT establish

| Question | Status |
| --- | --- |
| Is 6983 bound on Front? | `[UNKNOWN]` — unchanged. Only Front can answer. |
| Has a handheld order ever run at this venue? | `[UNKNOWN]` — Back's corpus says no handheld order ran *on Back*, which was already known and is now measured over 135 files. |
| What a real `<Checksum>` value looks like | `[UNKNOWN]` |
| What the `NAKREGO` body contains | `[UNKNOWN]` |
| What routes an order to `ProcessHandheldOrder` | `[UNKNOWN]` — narrowed, §8 |
| Whether `WPOrder` appends or replaces | still `STRONGLY INDICATED` from the absence of DELETE; the `AddNew` vtable dispatches were not decoded this session |
| What `NoReceiving` is set by | `[UNKNOWN]` |
| Whether the protocol is supported for third-party use | `[UNKNOWN]` — a vendor question, unanswerable locally |
| What Front's licensed handheld slot count is | `[UNKNOWN]` — and it now matters more than it did, see §5 |

---

## 13. Reproduction

Tooling used tonight is in the session scratchpad and is a superset of the
2026-09-06 bundle:

- `portscan.py` — scan a PE's `.text` for a port as a 32-bit immediate and
  classify the encoding (`mov [ebp-x], imm32` / `push imm32` / `mov eax, imm32`)
- `multiport.py` — the same across several binaries at once
- `dis2.py` — disassemble any of the sibling binaries, not only `IPS.exe`
- `gref.py` — find `.text` references to a global address
- `strdump.py` — ASCII + UTF-16LE string dump with file offsets, for `.mdb` too
- `imports.py` — map import thunk addresses to `MSVBVM60` names
- plus `xref.py` / `ipsdis.py` / `annot.py` / `trace.py` from the previous
  session, repointed at this session's string dump

The Back baseline capture — produced by running
`scratchpad/front-passive-capture.ps1` against Back as a rehearsal — is at
`C:\ProgramData\Verdura\evidence\back-baseline-20260907\`. It is **Back
evidence** and is labelled as such in its own `01-identity.txt`.
