# DL-109 — Dunedin Ideal Handheld: licence state and installed wire contract

Bounded read-only phase. No packet sent, no IdealPOS mutation, no order created, no config changed,
no Finalize/Transfer clicked. All database access was `SELECT`. ORD-600002 untouched.

Answers the two questions DL-108 left open: (A) is Ideal Handheld licensed on this installation, and
(B) what does the installed handler actually accept.

## 1. Licence — NOT LICENSED (high confidence, local evidence)

Current gateway record, `C:\ProgramData\Idealpos Solutions\Idealpos\LOGS\IPSError.log`, most recent
check 2026-08-31 14:27:15:

```
License Gateway: UserName=Sila Restaurant  POSNumber=1 Options=Pack 2
                 License Enabled=True   ExpiryDate=14 Sep 2026 12:14:38 : Type=2
```

The licence is live and renewing (weekly `Type=2` heartbeat, unbroken back through July). `Options`
carries the granted module list, and it contains **only `Pack 2`**.

`IDEAL HANDHELD` is a distinct module name in IPS.exe's own module table, a peer of `Pack 1`,
`Pack 2`, `Idealpos Restaurant`, `Idealpos Reservations`, `Starr Server`, `Tyro Pay@Table` and ~90
others (table at file offset `0x2483b48`+, stride-aligned; `IDEAL HANDHELD` also at `0x3cbc38`).

The gate itself, inside `IPS.clsOnlineLicensing.CheckModules`, is a linear membership test over the
licensed-module array:

```
02883902  mov  dword ptr [ebp-0x64], 0x7cbc38   ; literal "IDEAL HANDHELD" (VT_BSTR)
0288391e  call [0x401394]                        ; variant compare vs array element
02883929  call ebx
02883944  test si, si
02883947  jne  0x2883964                         ; match -> licensed
02883949  ...                                    ; no match -> ++index, loop 0x288388d
```

No `Pack` special-casing appears in that function — it is a plain string-equality search.

Runtime consequence, in the handheld listener:
`WaiterPad_DataArrival EXIT because NOT HandheldLicensed` — the socket accepts the connection and
then silently discards the payload. An unlicensed integration would fail *silently*, not loudly.

Corroborating negatives:
- Zero occurrences of "handheld"/"waiterpad" in any Idealpos log.
- `IPSTransaction.dbo.AAAExampleData` contains no `IH-` rows — the handheld duplicate store has never
  been written. Handheld ordering has never run at this venue.
- No handheld device registration table exists in either database.

**Residual uncertainty (the only reason this is not "definitive"):** local evidence cannot prove that
`Pack 2` is not expanded, server-side, into a module set that includes Ideal Handheld before the array
above is populated. The gateway logs the raw `Options` string, not the expanded array.

**Exact dealer question:**
> For Sila Restaurant (POS number 1, licence currently reporting `Options=Pack 2`): does our licence
> include the **IDEAL HANDHELD** module? If not, what is required to add it, and how many handheld
> device licences would that provide?

## 2. Installed handlers — there are TWO, and they behave differently

| | IPS.exe path | POSServer path |
|---|---|---|
| Binary | `C:\Program Files (x86)\Idealpos Solutions\Idealpos\IPS.exe` | `C:\Program Files\Idealpos Solutions\POSServer\POSServer.exe` (+ `POSServer.Communication.dll`) |
| Version | 7.133.0200 | 8.0.0.1 |
| SHA256 | `F18475A784C996351048D4F537CF0CC8E2D5EE9AA7B01B38130CDADCC85A520E` | `E1028E2350B4A6ADEB76012AF21FC1CD0C67308878C28FF809EDAF2A7B3591D0` (the DLL) |
| Process | pid 17896, interactive POS terminal | pid 7136, Windows Service |
| Listener | `wsWaiterPad`, `0.0.0.0:12183` (sole TCP listener on the process) | `0.0.0.0:11000` and `[::]:11000` |
| Licence gate | yes — discards on `NOT HandheldLicensed` | none found in the packet handler |
| Prints KOT | **YES** | **NO** |
| Duplicate store | `AAAExampleData`, `ColumnType='IH-<checksum>'` — durable | in-memory, 100 slots, 10-min TTL — **lost on restart** |
| Writes to | `IPSTransaction`, then pushes to POSServer | `POSServer` database directly |

`POSServer.Communication.dll` as installed was confirmed to contain `IHORDER`, `IHSALE`, `IHENQUIRY`,
`IHPAYMENT`, `WPPacket`, `ACKDATA`, `NAKDATA`, `OrderItem`, `PriceLevel`, `TaxString` — so the
decompiled implementation reviewed in DL-108 **is** the installed build, closing that caveat.

IPS.exe requires POSServer for this feature: `You must have POSServer set up to run Ideal Handheld`.
POSServer is running and healthy — IPS polls it every 15 s (`POSServerClient.log`: `RECEIVED: …@@@`,
`Entering ParseTableData`, `TableUpdated= 1000`).

**Architecture correction to DL-108:** the KOT evidence (`Ready to Print!` → `Finished sending to IKM`
→ `" (WP)"` → `Printed : Table N`) belongs to the IPS.exe path only. POSServer's `IHORDER` sets
`Printed = true` on every line and contains no kitchen-print code at all.

## 3. Wire contract as installed

**IPS.exe path** — XML over TCP. Request root `Root`, attribute `WPType`, values observed:
`ORDER`, `REQUESTPROGRAM`, `REQUESTTABLESTATUS`, `PRINTBILL`, `LOGOUT`, `TEST`. Version flag
`PROTOCOL2`; `RootMenuCode`; `<OrderItem` children parsed positionally (`Parsing from Index = `).
Responses:
`<?xml version='1.0' encoding='utf-8' ?><WPPacket Type = 'ACK'|'NAK'|'DUPLICATE'|'LOCK…'|'NAKREGO'|'NAKPRINT'></WPPacket>`.
Failure modes: `DISCARDING PACKET! ORDER PACKET contained no items! IP-3933`, `XML parsing error`,
`parsing ORDER but HandheldProcessing set - sending NAK back`.

**POSServer path** — separator-delimited text frame terminated `@@@`; field 0 is the identifier
(`IHORDER`), field 1 is XML. `&` is escaped to `&amp;` before parsing. Payload under `WPPacket`'s
first child:

- `Checksum`, `Table`, `POSTerminal`, `Map` (0 coerced to 1), `Clerk`, `Guests`, `Location` (0 coerced to 1)
- repeated `OrderItem` = `StockItem`, `Quantity`, `Description` (truncated to 50), `Price`,
  `PriceLevel`, `Seat`, `Type` (`Text` ⇒ `Col0='H'`, else `Col0='SI'`), optional `TaxString`

Response: `~IHORDER  <sep><?xml …?><WPPacket Type='ACKDATA'|'NAKDATA'|'DUPLICATE'><HandheldOrder
Checksum='…'/></WPPacket><sep>@@@`.

## 4. Idempotency — weaker than assumed

POSServer's `HandheldHelper.IsDuplicate` is a 100-entry in-memory ring with a 10-minute expiry and no
persistence:

```csharp
private string[] _checksum = new string[100];
private DateTime[] _checksumDate = new DateTime[100];
// entries older than 10 minutes are recycled; nothing is written to disk
```

Checksum is a free-form string — no algorithm, no length rule, and `DeviceID` does not participate on
this path. So a Verdura `externalOrderId` maps cleanly as the value, **but**:

- a retry more than 10 minutes after the original would create a **second order**;
- a POSServer restart clears the ring entirely;
- more than 100 orders in 10 minutes evicts early entries.

Durable idempotency must therefore come from the Bridge: read back the table's `PendingSaleLines`
before any retry, and fail *uncertain* rather than resend.

(The IPS.exe path is stronger — `IsDuplicateHandheldOrder2` persists `IH-<checksum>` rows.)

## 5. Append / second-round semantics (POSServer path, from the installed DLL)

- Existing sale located by `(Code = Table, Map, Pos = 1)`.
- Absent ⇒ created. Present ⇒ **new lines appended**, `Line` continuing from the current count;
  existing lines are never touched, so already-printed items are preserved.
- `TableMapSetups.Status` set to `8`; `StartTime` set when previous status was `0` or `5`;
  `Seats`/`GuestsSaved` updated unless `Guests` is `0` or `9999`.
- Locking: `map.GetLockedBy(table)` — if another terminal holds it, the packet is rejected with a
  LOCKED response and nothing is written; the lock is set for the caller and cleared on both the
  success and exception paths.
- `~SENDSTAT` broadcast to every other connected client, so no terminal cache goes stale.

This is genuine native support for "add another round to an open table".

## 6. Pricing — conflicts with the native-authority requirement

`IHORDER` writes the supplied price verbatim: `Col4 = Math.Round(Convert.ToDecimal(Price), 2)`.
There is no stock lookup, no sentinel for "price it yourself", and `PriceLevel` is merely stored in
`Col6`. On this path the **caller becomes authoritative for the native line price** — the opposite of
the Webit path, where IPS priced PLU 708 itself at $23.00.

Native reference values confirmed: `StockItems` code `708` = `CHICKEN BALLISTA PIZZA`;
`StockItemsValue` Type=1 Level=1 = `23.0000`; `ECOMMERCEPRICELEVEL = 1`.

Mitigation would be for the Bridge to read the native price from `StockItemsValue` and echo it, making
the value POS-derived — but the POS would no longer *compute* it at write time, so promotions, price
levels and time-based pricing would not apply. This is a real regression risk against the Webit path
and a reason to prefer the IPS.exe-hosted handler if the licence allows.

## 7. Dunedin native values for a future Table 5 packet

| Field | Value | Basis |
|---|---|---|
| Table | `5` | `TableMapSetups` ItemType=3, ItemIndex=5; `IPSTransaction` Caption `5` = Verdura `posTableCode` (DL-097) |
| Map | `1` | `TableMaps` Code=1 "Restaurant"; every live pending sale has Map=1 |
| Location | `1` | `Locations` Code=1 "Location 1" (0 is coerced to 1 anyway) |
| Pos (on the sale) | `1` | hardcoded by the handler |
| StockItem / Qty | `708` / `1` | order content |
| Price | `23.00` | `StockItemsValue` Type=1 Level=1 — see §6 |
| Guests | from the order | `0`/`9999` mean "leave seats unchanged" |
| **POSTerminal** | **not derivable** | used only for table-lock ownership; belongs to the registered device. `POSTerminals` holds Code 1=BACKOFFICE, 2=POS |
| **Clerk** | **not derivable — business decision** | must be in POSServer `VALIDCLERKS = [1][2][4][7][8][9][108]`: 1 TANISA, 2 Ali, 4 SAYED, 7 NKANYISO, 8 Kitchen, 9 TEE, 108 chowdhury. Live tables currently use 108; Webit uses `IDEALWEBITCLERK = 1` |

Note: POSServer's own `TableMapSetups.Caption` values are blank — table identity there is `ItemIndex`.

Live table state at time of writing: tables 9, 10, 11, 13, 17, 18 open (`Status=8`, ClerkID 108);
**Table 5 `Status=0`, no StartTime — Ready**, exactly as observed physically. `WBORD-600002` does not
exist in the POSServer database at all; it lives only in `IPSTransaction`. That is the web-order/table
separation, visible at the data layer.

## 8. Device registration

Required, and not characterisable locally. Evidence: `NAKREGO`, `BAD REGO`, `WP Current Count=`,
` - Waiters=`, `Adding <x> to current devices.`, `LastCheckSum`, `DeviceID`. No device table exists in
either database, so registration state appears to be runtime/in-memory on the IPS.exe path. Whether
registration itself consumes a licence seat cannot be determined without a licensed device.

## 9. Security / network boundary

- Both listeners already bind `0.0.0.0` and are LAN-reachable today; this is pre-existing, not
  something an integration would introduce.
- No authentication beyond device registration and the licence gate. Traffic is plaintext XML.
- The Bridge runs on this same host (`127.0.0.1:5588`), so it can reach `127.0.0.1:11000` (or
  `:12183`) locally. **No new firewall port would be required.**

## 10. Source governance — BLOCKER

| Location | Tracked? |
|---|---|
| `C:\Users\Posmate\Documents\verduraBridge\verduraIdealposBridge` | **No** — no `.git` at any ancestor |
| `verdura_MVP` (`github.com/ErebusCodes/verdura_MVP`, HEAD `9f17006`) | tracks `apps/venue-connector/**`; **zero** files matching `verduraIdealposBridge` |
| `VerduraServer.retired-20260827-155640` (same origin) | **zero** Bridge files |

There is no authoritative tracked source for `VerduraIdealposBridge` anywhere on this machine.
Per the governance rule, implementation of a new production transport stops here.

## 11. Verdict

Two independent blockers, either of which is sufficient:

1. **Ideal Handheld licence not present** on this installation (high confidence; dealer confirmation
   closes the residual `Pack 2` bundling question).
2. **No authoritative tracked Bridge source** to implement into.

And one design risk to resolve before committing to the architecture: on the POSServer path the caller
becomes price-authoritative and **no kitchen docket prints at all**. Only the IPS.exe-hosted handler
both prices natively and prints — and that is precisely the one behind the licence gate.

## 12. Status carried forward

| Item | Status |
|---|---|
| `Idealpos:TableAssignmentStrategy` | unchanged, `NoHint` |
| `Idealpos:TableAssignmentConfirmed` | unchanged, `false` |
| ORD-600002 | preserved, unmutated |
| Handheld licence | **BLOCKED — not present locally; dealer question issued** |
| Installed wire contract | **CONFIRMED** for both handlers (see §3) |
| Bridge source governance | **BLOCKED — untracked** |
| Native table routing (P0-A) | supported by vendor, gated |
| Second round to open table (P0-B) | supported natively by the same mechanism |
