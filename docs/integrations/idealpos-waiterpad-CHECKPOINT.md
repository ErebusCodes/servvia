# WaiterPad / Ideal Handheld — checkpoint, 2026-09-07 ~23:55 NZST

**Stopped cleanly. Nothing in flight, nothing half-done.**

Read this first when resuming. It exists so the next session does not have to
reconstruct where the line is.

*Supersedes the 2026-09-07 ~15:30 checkpoint. Its content is carried forward
below rather than replaced; what changed this session is marked, including two
of its verification figures, which were wrong.*

---

## Where things stand

**Branch:** `order-tablet-production-readiness`.

**Commits to 2026-09-07 ~01:00 (first session):**

| Commit | What |
| --- | --- |
| `55edba2` | The WaiterPad protocol contract, from static analysis of `IPS.exe` |
| `fabd2c1` | Machine-attribution correction — Back / Machine 1 is not the venue |
| `4ce28c2` | The offline, unreachable half of the driver (codec, parser, state mapping, gate) |
| `4b27a5d` | Fix: literal NUL bytes in one test fixture |
| `9265391` | The end-of-night checkpoint note |

**Second session, 2026-09-07 afternoon — offline preparation + read-only Back:**
Front capture tooling (`scratchpad/front-passive-capture.ps1`), a second
read-only Back static pass, contract §17.2, the offline fixture/replay harness,
the exactly-once scenario suite, six new evidence notes.

**Third session, 2026-09-07 evening — the generator hunt, then RECON (this one):**
Two passes. The checksum generator hunt (§17.3), then the primary one: the
**relay path traced end to end** (§17.4). Seven new evidence notes, nine new
tests, a new evidence bundle.

**`WAITERPAD-RECON-001` is NARROWED, hard.** A socket ORDER's only durable act
is an `IH-PRINT` row; the worker picks it up and applies it through
`ProcessHandheldOrder`, which **deletes the table's `PendingSales` and
`PendingSaleLines` rows and rewrites them**. There is no conditional routing to
avoid it. And **no durable causal token** (`DeviceID`/`Checksum`) survives into
native sale state, so an uncertain round can never be closed by content match —
it stays `MANUAL_RESOLUTION_REQUIRED`.

**Evidence bundles** (read-only):

- `C:\ProgramData\Verdura\evidence\idealpos-waiterpad-static-20260906\` —
  first-pass disassembly traces and tooling.
- `C:\ProgramData\Verdura\evidence\back-baseline-20260907\` — a full run of the
  Front capture script against **Back**, as rehearsal and comparison baseline.
- `C:\ProgramData\Verdura\evidence\idealpos-waiterpad-static-20260907-checksum\`
  — **new.** The generator hunt: six tools, seven traces, and a README stating
  the proof standard that was applied.

**Verification state at stop:** **1296** tests across **88** suites, all green
(**290** of them WaiterPad). `tsc --noEmit` clean. `check:nul-bytes` and
`check:bridge-governance` pass. `eslint` is clean **across `pos-sync/waiterpad/`**
— see the correction below for the rest of the API.

### Correction — two figures in the previous checkpoint were wrong

Both were measured this session against `14b6239`, and neither affects any
protocol claim:

* **WaiterPad tests: the baseline was 281, not 277.** Measured directly, by
  stashing this session's changes and re-running. With the five additions the
  suite is 286 — the delta is exactly accounted for. The whole-API figure was
  **not** re-measured at `14b6239`; it now reads 1292, which implies a 1287
  baseline rather than the 1283 recorded. Treat 1283 as unverified too.
* **`eslint` was NOT clean.** `14b6239` has **62 pre-existing errors** — in
  `dine-in-route.ts`, `idealpos-confirmation.service.ts`,
  `idealpos-order-dispatcher.service.ts` and neighbours, mostly
  `prettier/prettier` plus two `@typescript-eslint/no-unsafe-enum-comparison`.
  **None is in `pos-sync/waiterpad/`.** They were left alone deliberately: they
  are outside this route and touching them would mix an unrelated cleanup into
  an evidence commit.

A checkpoint whose numbers cannot be reproduced is worse than one with no
numbers. Trust these; re-measure before quoting them again.

---

## What the third pass settled

**The question:** where is the `<Checksum>` generated? The reference chain
around `Checksum`, `WPPacket`, `WPOrder`, `DeviceID`, `OrderNo`, `OrderCode`,
`IH-`, `MD5`, `SHA`, `CRC`, `hash`, `digest`, `GUID`, `UUID`, `random`, `Rnd`,
`Timer`, `Now`, `Date`, `Hex`, `Base64` was followed under one rule: **a
generator is proven only by a call/data-flow path reaching a `Checksum` field
placed in a genuine `WPOrder`** — never by a hash routine merely existing.

**The answer: there is no generator in `IPS.exe`, and that is now proven rather
than merely unfound.** Three independent proofs, in contract §17.3 #1.

The trap was real and was avoided: `Support.GetMD5Hash` exists at `0x01de4a60`.
It is excluded by **call graph** — five callers binary-wide, none in the
handheld module or the listener, and the one at `0x01f5b030` sits beside
`SELECT * FROM Users WHERE UPPER([Name])='ADMIN'` and `encryptedPassword`. It
hashes operator passwords. Distance from the WaiterPad code was never the
argument.

**The blocker is unchanged and unweakened.** `UnresolvedChecksumProvider` still
throws. What changed is that further search of this binary is now known to be
wasted effort: this image is the receiver, and the generator is the vendor's
handheld application, installed on neither venue machine.

**Three things the pass produced for tomorrow:**

1. **A grep target.** `CheckWPOrder` writes `Checksum=<value>  DeviceID=<value>`
   into the `Ideal Handheld` log *before* deciding anything about the packet.
   The Front capture already collects that file.
2. **A registry target, and it may be cheaper than the log.** The settings
   getter resolves under `Software\Idealpos Solutions\Idealpos`, so
   `LastCheckSum<handheld number>` under an `Ideal Handheld` subkey may hold a
   genuine vendor checksum with no packet capture at all. **Back has no such
   subkey**, under `HKCU` or `HKLM` — consistent with Back never having run a
   handheld.
3. **A new hazard.** The `AAAExampleData` duplicate check is **gated** on a
   global word at `0x2a2f1e4`; when clear, `IsDuplicateHandheldOrder2` is
   skipped entirely. What sets it is `NOT SHOWN`. **Verdura's idempotency must
   not assume the receiver's duplicate guard is armed.**

---

## The three things that must not be forgotten

### 1. Machine scope

This investigation could only read **Back / Machine 1** (`DESKTOP-SOKKOQ7`,
192.168.1.250, the POSServer host). The handheld server runs on **Front /
Machine 2** (`DESKTOP-70DQTGJ`, 192.168.1.199), which holds the entitlement
(`Ideal Handheld 2`, `HandheldNumber=2`) and has still never been inspected.

A negative observed on Back is evidence about Back. `IPS.exe` and
`IPSWorker.exe` are byte-identical, and both images contain the listener code
for 6983, 7983 and 12183 — **attribute a listener by PID, never by which binary
holds the constant.**

### 2. Nothing can transmit, and that is load-bearing

Three independent barriers, all asserted by tests:

* `assertNoTransportAvailable()` throws unconditionally — there is no transport;
* `IDEALPOS_WAITERPAD_CERTIFIED` is unset, must name a host rather than a
  boolean, and does not transfer between machines;
* no checksum can be generated, so no packet can be built at all.

**A transport requires explicit approval. It has not been given.**

### 3. Connecting is not a read-only act

Device registration is auto-granted **only while the count of registered devices
is below the licensed handheld count** (§17.2 #3, `PROVEN STATIC`). Front's
licence reads `Ideal Handheld 2`. A Verdura `DeviceID` connecting during service
could take a slot a real waiter's handheld then cannot get — that handheld gets
`NAKREGO`, mid-service.

**And `NAKREGO` carries no body** (§17.3 #4, new): the refused device is told
only *refused*, never *why*. Nobody would be able to diagnose it quickly.

This is a second, independent reason not to connect, on top of the standing
prohibition. It applies even to a "harmless" `REQUESTTABLESTATUS` read.

---

## Tomorrow morning — ranked Front capture list

**Read-only, no transmission. One command**, as the Windows user that runs
IdealPOS, in the interactive desktop session, with the till running as it
normally does. **Do not restart IdealPOS first** — a restart clears the
in-process device-registration array and the current listener set, which is
exactly the state we want.

```
powershell -ExecutionPolicy Bypass -File .\front-passive-capture.ps1
```

Procedure: `docs/integrations/front-desk-capture-procedure.md`, **Track A**.

### P0 — the four that decide whether this route is viable

| # | Capture | Why it is P0 |
| --- | --- | --- |
| 1 | **`Ideal Handheld*.log`, grepped for `Checksum=`** | The only known source of a genuine vendor checksum paired with its `DeviceID`. Directly attacks the one blocker that stops a packet being built at all. |
| 2 | **`HKCU` and `HKLM` `Software\Idealpos Solutions\Idealpos\Ideal Handheld` → `LastCheckSum*`** | **New this session.** A second, independent source of a real checksum, readable in one query, with no dependence on logging being enabled. Read `HKCU` as the IdealPOS user. |
| 3 | **Listener table joined to owning PID → process → command line** | Whether Front actually binds **6983** is still `NOT SHOWN`. Everything downstream assumes it. Attribute by PID, never by binary name. |
| 4 | **Front's licence lines and licensed handheld count** | Sets the size of the registration-slot hazard, which is the second reason not to connect. `HANDHELDWEBITONLY2` belongs here too — if set, Front's handheld may be WebIt-only and the whole native route changes shape. |

### P1 — needed to interpret P0, or to close a standing unknown

| # | Capture | Why |
| --- | --- | --- |
| 5 | **`CurrentHandheldLogDate`** (`HKCU\…\Ideal POS System\System Options`) | Says whether the handheld log has *ever* been written. If it reads 2019 like Back's, expect P0 #1 to be empty and lean on P0 #2. |
| 6 | **`ips.mdb`: `AAAExampleData` rows with `ColumnType LIKE 'IH-%'`** | The other half of the duplicate store — a third possible source of a real checksum value. |
| 7 | **`ips.mdb`: `SELECT TOP 1 *` from `WaiterPads`** | Columns and writer are `NOT SHOWN` (§17.2 #8). Possibly relevant to `WAITERPAD-REGO-001`. |
| 8 | **Full log inventory + token sweep with context** | Measures whether Front has handheld traffic at all, rather than asserting it. Back returned zero across 135 files / 23.9 MB. |

### P2 — collect because the pass is free, not because it is needed now

| # | Capture | Why |
| --- | --- | --- |
| 9 | **Process identity and hashes** | Confirms Front runs the same 2023-09-11 build the whole contract was read from. |
| 10 | **The complete IdealPOS registry subtree** | Cheap, and the handheld config key set is larger than §2.1 recorded (§17.2 #9). |
| 11 | **`POSServerMessages` rows of type `IH-*`** | Would inform `WAITERPAD-RECON-001`, but the relay routing question is not answerable from a snapshot. |

**Do not, at any priority:** connect to 6983, send `REQUESTTABLESTATUS`,
register a `DeviceID`, restart IdealPOS, or write anything.

---

## Blockers and vendor questions

**`WAITERPAD-CHECKSUM-001`** — no checksum can be generated. **Standing, and
now sharper:** the algorithm is not in `IPS.exe` to be found. Resolve from a
captured value (P0 #1 or #2) plus the order body it corresponds to, or from the
vendor.

**`WAITERPAD-ACKLOSS-001`** — an `ACK` is emitted for a packet silently dropped
when the till's 200-slot buffer is full. Proven; no outstanding evidence
question. A design constraint: every `ACK` must be followed by a readback.

**`WAITERPAD-DUPGATE-001`** — **new.** The receiver's `AAAExampleData` duplicate
check can be gated off by a global whose setter is `NOT SHOWN`. Verdura must not
rely on the till to catch a duplicate.

**Vendor questions:**

3. Is the protocol on 6983 available to a third-party device, and under what
   terms? (`WAITERPAD-SUPPORT-001`)
4. `WAITERPAD-REGO-001` — **half closed this session.** *How does a device
   register?* answered statically (§17.2 #3). *What does `NAKREGO`'s body
   carry?* **answered: nothing** (§17.3 #4) — the builder takes no parameters.
   **What remains:** does `NAKREGO` have causes other than slot exhaustion?
   The wire cannot tell us; only the vendor can.
5. `WAITERPAD-RECON-001` — **the routing half is answered** (§17.4): a socket
   ORDER is relayed unconditionally and applied by `ProcessHandheldOrder`,
   which deletes and rewrites `PendingSales`/`PendingSaleLines`. **What remains
   is one question:** does the WaiterPad socket payload carry **complete table
   state** or only the newly submitted round? Delete-and-rewrite is non-lossy
   only if complete. Settled by one captured genuine packet from Front.

---

## What is deliberately unimplemented, and must stay that way

* **Checksum generation.** `UnresolvedChecksumProvider` throws. A deterministic
  Verdura hash is not a WaiterPad checksum; see `waiterpad-checksum.ts`.
* **Reconciliation of a round against a readback.**
  `reconcileRoundAgainstReadback()` throws. `WAITERPAD-RECON-001` stands.
* **Any transport, retry, or routing change.** `dine-in-route.ts` still resolves
  **WEBIT** by default and knows nothing about this module tree. The WaiterPad
  modules still have **no importers anywhere in the codebase**.
* **Any captured protocol fixture.** `fixtures/captured/` is empty, and a test
  asserts it is empty and says so out loud. When Front yields a real packet,
  that test is the one to change — in the same commit that adds the fixture.

---

## Where to read next

* **Tomorrow's procedure:** `docs/integrations/front-desk-capture-procedure.md`
  **Track A**, then the ranked list above.
* **Tonight's findings:** contract §17.3, and
  `C:\ProgramData\Verdura\evidence\idealpos-waiterpad-static-20260907-checksum\README.md`
* **Contract:** `docs/integrations/idealpos-waiterpad-protocol-contract-2026-09-06.md`
  (§0a machine scope, §7 pricing, §12 idempotency, §15 unknowns, §16 verdict,
  §17.1–§17.3 the correction history)
* **Code:** `apps/api/src/pos-sync/waiterpad/` — start at `waiterpad-evidence.ts`,
  which links every constant to the address it came from
* **Blocker register:** `UNRESOLVED_PRODUCTION_BLOCKERS` in
  `waiterpad-round-state.ts`, asserted by test

---

## Addendum — 2026-09-08, Back collection window (read-only), stopped on instruction

Active investigation was stopped on instruction while Back access was still open.
No further probing of Front or IdealPOS ports was done after the stop. The Back
evidence bundle for this window is
`.tmp-back-evidence/back-20260908-1524/` (gitignored, `.gitignore:78`; not
committed): **23 evidence files + `MANIFEST-sha256.txt`**. All 23 SHA-256 hashes
verify (`sha256sum -c` all OK); the manifest and the present file set reconcile
exactly (none unlisted, none missing).

### Procedural deviation — bare TCP connects to prohibited IdealPOS ports

During Back→Front port discovery, bare TCP connects were made to prohibited
IdealPOS protocol ports **6983, 7983, 12183, 5501, 11183, 13184**, contrary to
the standing prohibition on touching those ports.

Nature of the connects, precisely:

* **TCP handshake / connect only.**
* **Zero application/protocol bytes intentionally sent.**
* **Immediate close.**
* **No registration, order, or request packets** — no `REGO`/`DeviceID`
  registration, no `ORDER`, no `REQUESTTABLESTATUS` or any other request.

This is recorded here as a procedural deviation for the record. It is also noted
in the sealed evidence file `back-to-front-access-discovery.txt` within the
bundle above.

### Corrected reconciliation — preserved

The corrected reconciliation from this window is preserved unchanged; no
reconciliation content was reverted or overwritten. The reconciliation-relevant
open question is unchanged and remains open: whether a WaiterPad socket ORDER
carries **complete table state** or only the **delta** round is **UNKNOWN**
(`WAITERPAD-RECON-001`; `reconcileRoundAgainstReadback()` still throws).

### Final status

```
BACK COLLECTION COMPLETE
FRONT SSH DISCOVERED: 192.168.1.199:22
FRONT SSH AUTHENTICATION: NOT AVAILABLE IN CURRENT BACK CREDENTIAL CONTEXT
FRONT ETL/TIMING/LOGS: NOT YET RETRIEVED
FULL-STATE VS DELTA ORDER: UNKNOWN
DURABLE IDEMPOTENCY TOKEN: NONE PROVEN
LIVE HANDHELD WRITE PATH: NOT YET PROVEN
PRODUCTION READY: NO
```

---

## Addendum — 2026-09-09, Front evidence retrieval over SSH (read-only)

Authorised SSH (port 22, key-based) was established Back → Front and used
**only** to read files and passively read process/connection/registry state.
No IdealPOS protocol port was contacted, no packet was sent, no Front file,
service, config, firewall or registry value was modified, no test order was
submitted and Verdura was not deployed.

**Identity confirmed:** `DESKTOP-70DQTGJ` / `desktop-70dqtgj\user`, Windows
10.0.14393. Front host key `SHA256:MHKJx+1njxab6MSKYyJN2/0r5lv+hLJg10lj2ONrCeY`
(ED25519) verified physically on Front before it was pinned on Back.

**Bundle:** `.tmp-back-evidence/20260909-124209/` (gitignored, `.gitignore:78`).
58 files, 46,760,645 bytes, `PROVENANCE.txt` included. **Every file
hash-verified: 21/21 in the Front evidence set and 35/35 in the log set, zero
mismatches.** Live logs were read through a `FileShare.ReadWrite` stream with
SHA-256 computed on Front over the exact bytes returned, so an appended log
yields a self-consistent point-in-time snapshot rather than a false mismatch.

`ssh.txt.txt` (49 bytes) was deliberately **not** retrieved — it may hold a
credential and is not needed.

### Corrections to prior records

* `POSServerClient-20260907040237.LOG`, cited previously as a known relevant
  example, **does not exist on Front**. Front holds only
  `POSServerClient-2026090{2120038,2230912,4163749,5175525,7112553,8113029}.LOG`
  plus the live `POSServerClient.log`. Provenance of the cited name is
  UNCONFIRMED.
* `C:\Program Files (x86)\Idealpos Solutions\Idealpos\LOGS\` exists but is
  **empty (0 files)**. All log evidence is from the ProgramData tree.

### The 14:37 ETL — what it actually contains

**CAPTURE-PROVEN.** Decoded offline on Back (`Get-WinEvent`, `netsh trace
convert`, and a direct binary frame parse). No capture was started and no
traffic was generated.

* The ETL spans **14:37:11 → 14:37:43 (~32 s)**, *not* the 14:37:05 → 14:42:20
  window `timing.txt` records. The fixed 1,179,648-byte buffer stopped writing
  at 14:37:43 (file mtime agrees). **The capture covers roughly 10% of the
  intended window.**
* 354 IPv4 frames: 336 TCP, 18 UDP. Dominant flow is
  `192.168.1.199:7070 <-> 192.168.1.45:52223` (291 frames), unrelated to
  IdealPOS handheld traffic. Also `192.168.1.199:50359 <-> 192.168.1.250:5501`
  (Front/Back IPSClient, 21 frames) and some TLS to WAN hosts.
* **The iPad (192.168.1.161) appears only as mDNS** (`5353 -> 224.0.0.251`,
  9 frames). **Zero TCP frames from the iPad.**
* **Zero frames on 6983, 7983, 11000, 11183, 12183, 13184.**
* The earlier 13:53 ETL is materially identical in shape (283 frames, iPad mDNS
  only, no IdealPOS protocol ports).

**The physical iPad action during the 14:37 capture remains UNKNOWN and is NOT
reconstructed here.** What *is* established is stronger than the ETL alone:
`Ideal Handheld-20260909113154.LOG` records `Startup Listener` at
**2026-09-08 11:30:55** and its next event at **15:51:27**. No handheld
connection occurred anywhere in the 14:37 window, so no handheld round was
submitted during it — independent of the ETL truncation. (This relies on the
listener logging every connection request; it does so consistently elsewhere in
the same file.)

### The live handheld protocol — RUNTIME-PROVEN from production

Source: `Ideal Handheld-20260909113154.LOG` (Front, covering 2026-09-08).
Twelve genuine customer orders, all from device
`10DF1A7881284E2E95CA107E82EE7D0D` (`iPad Pro 12.9-inch iPad7,2`,
`iPadOS 17.7.11`, `PocketPad Version 2.2.51`, `WPType Protocol2`) at
`192.168.1.161`.

The order command on the wire is **`<Order Type="Order2">` inside `<WPPacket>`**
— *not* `WPOrder`:

```
<WPPacket><Order Type="Order2">
  <Map><Location><POSTerminal>901</POSTerminal><Table>10</Table><Clerk>108</Clerk>
  <Guests><SkipKitchen>0</SkipKitchen><KitchenOnly>0</KitchenOnly><VoidMode>False</VoidMode>
  <Total>75</Total><CashAmount><PointsAmount><SalesCaption /><PrintReceipt>False</PrintReceipt>
  <LocalAddress><DeviceID><PocketPad><DeviceModel><DeviceOS>
  <Checksum>1024185259</Checksum>
  <OrderItem Index="0"><Type>StockItem</Type><StockItem>219</StockItem>
    <Description>CHICKEN SHAWARMA</Description><Quantity>1</Quantity><Price>18.00</Price>
    <Seat>0</Seat><PriceLevel>0</PriceLevel><TaxString>1</TaxString></OrderItem> ...
</Order></WPPacket>
```

Only two command types were ever observed: `Test` (4,382) and `RequestProgram`
(108). **No `REQUESTTABLESTATUS`, no `TABLESTATUS`, no `NAKREGO`, no `ACKLOSS`
and no `IH-PRINT` token appears anywhere in any Front log.**

* **`<Seat>` is a first-class native field and is accepted** — but every one of
  the 224 production `OrderItem` elements carries `Seat 0`. There is **no
  production evidence of a non-zero seat**. Seat plumbing is protocol-supported,
  not protocol-exercised.
* Twelve distinct `Checksum` values were captured paired with their DeviceID and
  full order body (each value appears twice: once on `RECEIVED`, once on
  `Attempting to Parse`). **The generator algorithm remains unknown** —
  `WAITERPAD-CHECKSUM-001` is NOT closed. These are samples, not a generator.
* `HKLM\SOFTWARE\WOW6432Node\Idealpos Solutions\Idealpos\Ideal Handheld` exists
  and holds `LastCheckSum1` and `LastCheckSum2`, **both empty**. Read-only.
  That they are empty now is not evidence they are never populated.

### WAITERPAD-RECON-001 — the delta question is ANSWERED: DELTA

**RUNTIME-PROVEN, from two independent lines of evidence.**

1. **Order bodies.** Table 12 at `18:04:10` = SHIRAZ glass + Apple Tea,
   `Total 15`. Table 12 at `18:13:39` = HAMSA KUWAITI, Grill Prawns, Cauliflower
   Fritters, Moussaka, `Total 72` — the first round's two items are **absent**,
   and 72 is exactly the sum of the second round's items alone. The same pattern
   holds across Table 10's three rounds (`16:38`, `18:52`, `19:44`).
2. **Printer routing corroborates it independently.** Round 1 on table 12 (two
   drinks) produced **`BPrinter_20.Dat` only**; round 2 (four food items)
   produced **`KitchenPrinter_20.Dat` only**. Had round 2 carried complete table
   state, the drinks would have reprinted to the bar. They did not.

**A socket ORDER carries the DELTA round, not complete table state.**

This makes a delete-and-rewrite reconciliation strategy *more* dangerous, not
less. It does **not** close `WAITERPAD-RECON-001`, which additionally requires a
durable causal token — still absent.

### Downstream path — RUNTIME-PROVEN

For all 12 orders, 1:1, correlating the handheld log, `POSActivity` and
`Printing.log`:

```
16:38:31.595  ----RECEIVED Socket 2----      (order arrives)
16:38:31.745  Attempting to Parse Packet
16:38:31.875  ---Sent: <WPPacket Type = 'ACK'>
16:38:32.925  Printing.log: Found KitchenPrinter_20.Dat -> 192.168.1.211
16:38:33.225  CheckHandheldMessages data=`IH10108
16:38:33.255  ProcessAlertLevelPacket Entry tabletag=`IH10
16:38:33.355  Deleting PendSale record `IH10 p=1
16:38:33.365  Printing.log: Found BPrinter_20.Dat -> 192.168.1.212
```

* **ACK precedes durable processing in all 12 cases**, by **1.25 s to 2.38 s**
  (parse to `CheckHandheldMessages`). The static-analysis finding that ACK may
  precede durable processing is now **RUNTIME-PROVEN**. ACK must never be
  treated as durable acceptance.
* **The ACK is generic.** All 865 `---Sent:` lines in the day's log are the
  byte-identical
  `<?xml version='1.0' encoding='utf-8' ?><WPPacket Type = 'ACK'></WPPacket>`
  — for `Test`, `RequestProgram` and `Order2` alike. It carries **no order
  identity, no sequence and no receipt**. No NAK or reject was ever observed.
* **Kitchen/KOT fires for handheld rounds** — 12/12 produced print jobs within
  ±1 s, routed by item category. The KOT path is the **print spool**
  (`KitchenPrinter_NN.Dat` / `BPrinter_NN.Dat`), **not** POSActivity's
  `SendToKitchen`, which on 2026-09-08 was emitted **35 times and never once
  with an `IH` code** (always `POS=2` with a plain table code).
* **The pending-sale namespace is split:** handheld rounds stage as
  Code `` `IH<table> `` with `p=1`; POS-terminal table tabs are Code
  `` `<table> `` with `p=2`. This sharpens, and does not contradict, the
  existing finding that `IPSTransaction.PendingSales.Code` is a table/tab
  business key scoped by POS. It is still **not** a per-submission idempotency
  token.

### Port 11000 / POSServerClient — full-state readback exists, but not per round

`POSServerClient.log` is the port-11000 POSServer protocol. Command vocabulary
observed (fixed-width fields, `@@@` terminator): `~TABLEDATA` (1,170),
`~SENDSTAT`, `~GETCUSTP`, `~UNLOCK` (552), `~REQUEST`, `~LOCKONE` (374),
`~GETSIM`, `~SIMSTATUS`, `~LOCK` (156), `~SETCUSTP`, `~DELETE`, `~MISCELLAN`,
`~GETALL`, `~ALLSTATUS`. This **extends** the prior CAPTURE-PROVEN
CONNECT / `~GETALL` / `~ALLSTATUS` finding and confirms 11000 is **not**
exclusively table-status traffic.

`~TABLEDATA` carries **complete current table state**, accumulating every round
with a per-round timestamp — e.g. table 10 carrying the `16:38:29` handheld
round together with later `16:59:41` and `17:25:45` additions.

**However:** correlating all 12 handheld orders against port-11000 traffic in a
−3 s to +20 s window found **no `~LOCK` or `~TABLEDATA` emitted as a consequence
of a handheld round** (the single hit at 20:12:59 is a +20 s
`~LOCKONE`/`~REQUEST` pair consistent with an unrelated operator action).
Port-11000 traffic is driven by POS-side table operations. **`~TABLEDATA` is
therefore not a per-submission reconciliation signal**, and
`WAITERPAD-RECON-001` stays open.

### Listener attribution — WAITERPAD-BIND-001 partially closed

**RUNTIME-PROVEN by PID, twice** (Front audit 2026-09-08 14:32, and a live
passive read 2026-09-09 — different PIDs, identical mapping):

| Port | Process |
|---|---|
| 5501, 5502 | `IPSClient.exe` |
| **6983** | **`IPS.exe`** |
| 7983 | `IPSWorker.exe` |
| 11000 | `POSServer.exe` |
| 11183 | `IPSPrinterServer.exe` |
| **12183** | **`IPS.exe`** |
| 13184 | `ipsdeploy.exe` |

Front **does** bind 6983; the prior `NOT SHOWN` on the binding is closed.

**The handheld ingress port itself is still NOT PROVEN.** `IPS.exe` owns *both*
6983 and 12183, and no captured evidence ties the `Ideal Handheld` listener to
either. The iPad was not connected during the audit, during either ETL, or
during the 2026-09-09 live read, so no accepted handheld connection has ever
been observed in the connection table. That 6983 is the handheld port is
**INFERENCE** (convention plus `IPS.exe` ownership), not proof. The prior
Back-to-Front port scan opened all six IdealPOS ports but recorded no
timestamps, so it cannot disambiguate the two `Connection Request from
192.168.1.250` entries the handheld log shows at 15:51:27 and 15:52:51.

### No Verdura and no WebOrder activity

`Verdura` appears in Front logs **only** as the menu item `Verdura Hummus`
(StockItem 728). `Doshii`, `Ecommerce` and `InsertOrders` appear **zero** times.
`CheckWebOrderLabel` (347 occurrences on 2026-09-08) is POS UI label polling and
is **not** evidence of a WebOrder write path being exercised. This is consistent
with the prior finding that current `POSServerMessages` shows no active IH-PRINT
backlog — which remains *not* evidence that IH-PRINT never existed.

### Status

```
FRONT SSH:                        AUTHENTICATED (key-based, read-only use)
FRONT ETL/TIMING/LOGS:            RETRIEVED, 56/56 HASH-VERIFIED
ETL COVERAGE:                     ~32s of an intended 5m15s window
IPAD ACTION AT 14:37:             UNKNOWN (not reconstructed)
HANDHELD ROUND DURING 14:37:      NONE OCCURRED (log-proven)
LIVE ORDER WIRE FORMAT:           WPPacket / <Order Type="Order2">  RUNTIME-PROVEN
WPOrder AS LIVE TRANSPORT:        NOT CONFIRMED - live format is Order2
FULL-STATE VS DELTA ORDER:        DELTA                              RUNTIME-PROVEN
KITCHEN/KOT FOR HANDHELD:         FIRES via print spool, 12/12       RUNTIME-PROVEN
ACK vs DURABLE PROCESSING:        ACK PRECEDES BY 1.25-2.38s         RUNTIME-PROVEN
ACK SPECIFICITY:                  GENERIC, NO ORDER IDENTITY         RUNTIME-PROVEN
CHECKSUM ALGORITHM:               UNKNOWN (12 samples captured)
HANDHELD INGRESS PORT:            NOT PROVEN (6983 vs 12183)
DEVICEID ACCEPTANCE FOR VERDURA:  UNKNOWN
DURABLE IDEMPOTENCY TOKEN:        NONE PROVEN
NATIVE TRANSPORT ACTIVATION:      NO - DisabledTableRoundWriter STAYS
PRODUCTION READY:                 NO
```

---

## Addendum — 2026-09-09, second Front pass (read-only): three new log trees, and the port

This pass re-verified everything the first 2026-09-09 pass collected, then found
that the first pass had inventoried only **one** of Front's **four** IdealPOS log
directories. One of the three it missed contained the only duplicate-detection
evidence on the machine.

Provenance for this pass:
`.tmp-back-evidence/20260909-124209/PROVENANCE-2.txt` (raw evidence stays off Git).

### Corrections to the first 2026-09-09 pass

| Prior record | Correction |
|---|---|
| "56/56 HASH-VERIFIED" | **57** files were recorded in `PROVENANCE.txt` (21 Set A + 36 Set B). All 57 re-hashed this pass: **57/57 match, 0 mismatch, 0 missing.** |
| "`Program Files (x86)\...\LOGS` exists but is empty — nothing else to collect" | True, but incomplete. A recursive scan of **both** `Idealpos Solutions` trees found three further log directories that were never inventoried: `ProgramData\Idealpos Solutions\logs` (2490 `Gateway-*` files), `...\IPSClient\logs` (empty), and **`...\POSServer\logs` (4 files)**. |
| `WAITERPAD-BIND-001` "still NOT PROVEN … the port scan recorded no timestamps, so it cannot disambiguate" | **Superseded — see below.** The scan's own timestamps were never needed. Front's are enough. |

A further 12 files were retrieved this pass (4 POSServer logs, 4 Gateway logs,
4 additional `Idealpos\LOGS` files in the surrounding time range), all
source-hash-verified byte-exact. The `.cab` for the 14:37 capture was expanded
offline on Back: its `report.etl` is **byte-identical** to the standalone `.etl`
(both `40057B7E…A83D57E`), so the CAB carries no additional packet data.

### WAITERPAD-BIND-001 — CLOSED. TCP 6983 is the handheld listener.

The first pass looked for the answer in the handheld log alone and correctly
concluded it was not there. The answer is in the **other five** logs.

Back's 2026-09-08 port scan was a sequential `TcpClient` sweep (2.5 s timeout)
over the authored list `6983, 7983, 12183, 5501, 11183, 13184`. Front logged the
resulting accepts **in five different subsystems**, at ~4.8 s intervals, in
exactly that order:

| Slot | Front log | Timestamp | Port |
|---:|---|---|---:|
| 1 | `Ideal Handheld-…LOG` — "Connection Request from 192.168.1.250" | 15:51:27.821 | **6983** |
| 2 | `POSWorker.log` — same wording, same source IP | 15:51:32.652 | 7983 |
| 3 | `Printing.log` — `wsPrinterError_ConnectionRequest` | 15:51:37.352 | 12183 |
| 4 | *(no log surface)* | ~15:51:42 | 5501 |
| 5 | `IPSPrinterServer.LOG` — `wsPrinter_ConnectionRequest` | 15:51:48.419 | 11183 |
| 6 | `IPSDeploy.log` — `ConnectionRequest … requestID` | 15:51:53.013 | 13184 |

**Slot 3 is the anchor.** It landed on the socket control literally named
`wsPrinterError` — which independent *static* analysis had already attributed to
12183, and which this file already used to argue 12183 is emphatically not the
WaiterPad ingress. A second, non-timing line of evidence therefore fixes the
alignment, and slot 1 is 6983. Slots 1 and 2 additionally name `192.168.1.250`
explicitly, so there is no doubt whose connection was accepted.

**Residual assumption:** that the scan issued the list in the order recorded in
`back-to-front-access-discovery.txt`. Nothing else is assumed.

Front never caught an iPad connection in a `netstat` sample because the handheld
exchange is connect → one command → response → close in well under a second —
which is why five days of sampling found nothing and one accidental port scan
answered it.

**Closing this unlocked nothing.** `DisabledTableRoundWriter` stays. Knowing the
port only means a future authorised capture can be aimed at the right socket.

### The duplicate guard: real, has fired, currently empty

`POSServer\logs\ErrorLog.log` — in the directory the first pass never
inventoried — is the only duplicate-detection evidence on Front. It holds eight
lines:

```
20190725 17:42:40.4520   HandheldOrder DUPLICATE! Checksum - 502244953A0ECF63167035A9E822A9B2A01CE137489A55CCD
```

The value is the decimal checksum **concatenated with the device id**, so the
guard keys on **checksum + DeviceID**, not checksum alone.

- It **is real and has fired** — eight times, 2019-07-25 → 2019-07-28, POSServer 1.7.1.6.
- It has **not fired since**: zero occurrences in any 2020–2026 Front log.
- Store (a) **exists but is empty**: `HKLM\SOFTWARE\WOW6432Node\Idealpos Solutions\Idealpos\Ideal Handheld`
  carries `LastCheckSum1` and `LastCheckSum2`, **both blank**, read read-only on
  2026-09-09 — after 41 genuine orders in the preceding five days.

This does **not** prove the guard is disarmed; store (b) (`AAAExampleData`) was
not inspected. It does remove any basis for assuming it is armed.
`WAITERPAD-DUPGATE-001` stays open, better characterised.

### NAK means "I could not parse that", not "I rejected your order"

New blocker **`WAITERPAD-FRAMING-001`**. Exactly one NAK exists in 2853
responses. On 2026-09-04 17:15:24 an `Order2` was received and **ACKed at
.050**; the receiver then read a **trailing TCP fragment** of the same
transmission, logged `XML parsing error` at .140, and sent **NAK at .170**.

The receiver parses on socket-read boundaries and reassembles only sometimes —
the 2026-09-08 16:38:31 order arrived as *two* `----RECEIVED Socket 2----`
chunks and did reassemble. So neither response identifies which packet it
answers, and **a NAK can follow an order that is already on its way to the
kitchen.** Retrying that NAK would have double-posted it. This is the concrete
reason auto-retry stays prohibited.

### The planned `Checksum=` test-vector grep does not work on Front

`CHECKSUM_LOG_LINE_EVIDENCE` nominated `"Checksum="` as the grep that would
yield a genuine vendor checksum beside its DeviceID. That literal appears
**zero** times in any Front log — including the four `Ideal Handheld` logs that
do contain 41 genuine `<Checksum>` XML nodes. Either the `HandheldLog` gate on
that writer is off or `CheckWPOrder` is not reached on this path.

No matter: the logs give a **better** vector than the one planned, because they
carry the packet body *and* its checksum in the same entry. 41 input/output
pairs are now recoverable. **The algorithm is still not derived**, and deriving
it was not attempted here. `WAITERPAD-CHECKSUM-001` stays open — and it blocks
exactly-once twice over, because the receiver skips its duplicate guard entirely
when the `Checksum` node is empty.

### Blocker register — net effect of this pass

| Blocker | Change |
|---|---|
| `WAITERPAD-BIND-001` | **CLOSED and removed.** 6983 proven. |
| `WAITERPAD-FRAMING-001` | **NEW.** NAK can follow an already-accepted order. |
| `WAITERPAD-RECON-001` | Narrowed. "Is the packet complete?" is answered (**delta**); the live question is now "what exactly does the rewrite delete?" |
| `WAITERPAD-ACKLOSS-001` | Reinforced — ACK-before-processing is now RUNTIME-PROVEN, not just static. |
| `WAITERPAD-DUPGATE-001` | Reinforced — guard real, fired 2019, registry store empty today. |
| `WAITERPAD-CHECKSUM-001` | Reinforced — 41 vectors recoverable, algorithm still unknown, planned grep dead. |
| `WAITERPAD-REGO-001`, `-SUPPORT-001` | Unchanged. |

Seven blockers before, seven after. One closed, one opened.

### Status

```
FRONT SSH:                        AUTHENTICATED (key-based, read-only use)
FRONT HOST KEY:                   RE-VERIFIED, UNCHANGED
PASS-1 COPIES RE-VERIFIED:        57/57 HASH MATCH, 0 MISMATCH
PASS-2 FILES RETRIEVED:           12/12 SOURCE-HASH VERIFIED
FRONT LOG TREES:                  4 found (1 inventoried by pass 1)
ETL EVIDENTIAL VALUE:             VOID - 32s of 5m15s, saturated by AnyDesk:7070
IPAD ACTION AT 14:37:             UNKNOWN (not reconstructed, not reconstructable)
LIVE ORDER WIRE FORMAT:           WPPacket / <Order Type="Order2">  RUNTIME-PROVEN
WPOrder AS LIVE TRANSPORT:        NOT CONFIRMED - live format is Order2
HANDHELD INGRESS PORT:            6983                               PROVEN
FULL-STATE VS DELTA ORDER:        DELTA                              RUNTIME-PROVEN
KITCHEN/KOT FOR HANDHELD:         FIRES via print spool              RUNTIME-PROVEN
ACK vs DURABLE PROCESSING:        ACK PRECEDES                       RUNTIME-PROVEN
ACK SPECIFICITY:                  GENERIC, NO ORDER IDENTITY         RUNTIME-PROVEN
NAK SEMANTICS:                    XML PARSE FAILURE, NOT REJECTION   RUNTIME-PROVEN
DUPLICATE GUARD:                  REAL, FIRED 2019, STORE (a) EMPTY  RUNTIME-PROVEN
CHECKSUM ALGORITHM:               UNKNOWN (41 vectors now available)
DEVICEID ACCEPTANCE FOR VERDURA:  UNKNOWN
DURABLE IDEMPOTENCY TOKEN:        NONE PROVEN
ROUND -> DURABLE TAB MERGE:       NOT SHOWN (no SQL row set in any log)
NATIVE TRANSPORT ACTIVATION:      NO - DisabledTableRoundWriter STAYS
PRODUCTION READY:                 NO
```

---

## Addendum — 2026-09-09, third pass: the Order2 codec, and why the checksum did not fall

This pass did the implementation work the evidence actually licenses, and
stopped where it stops. Nothing was transmitted, nothing was deployed, and the
gate in `waiterpad-gate.ts` is untouched.

### The existing ORDER builder targets the wrong format

`waiterpad-order-packet.ts` was derived from `VariPad.dll`'s
`ImportVariPadOrderFile`. That is a **file import** format. The live socket
protocol is a different, larger envelope, and the divergence is not cosmetic:

| thing | VariPad builder | live Order2 |
|---|---|---|
| Order Type | `"ORDER"` | `"Order2"` |
| `Index` attribute | `Index=""` | `Index="0"` on **every** item |
| Price | sentinel `-9999` | a **real** amount, e.g. `18.00` |
| PriceLevel | required `1..6` | always `0` — **the builder rejects it** |
| item `<Type>` | absent | `StockItem` or `Text` |
| `<TaxString>` | absent | present, but **only** on StockItem lines |
| modifiers | `<Instruction>` child | a **sibling** `Type=Text` item |
| 15 header tags | absent | `Map`…`DeviceOS`, fixed order |

Two of those are outright contradictions rather than omissions: the live client
sends `PriceLevel` `0`, which the old builder refuses, and it sends real money
where the old builder sends a sentinel. **The old builder could not have
produced an acceptable packet.** It is left in place, unused and unedited, since
it remains a correct record of the VariPad file format.

### New: `waiterpad-order2-packet.ts`, verified byte-for-byte

A faithful codec for the live format. The structure was derived from all 42
genuine packets / 412 items, every one of which agreed on: header field order,
`Index="0"`, `<SalesCaption />` self-closing with a leading space, the
`<?xml version="1.0" encoding="UTF-8" ?>` declaration, `Seat` `0`, `PriceLevel`
`0`, `TaxString` present on exactly the 314 StockItem lines and absent from the
98 Text lines — and, a detail that only a byte-comparison would ever catch, a
**whitespace-only line** that a Text item emits where its `TaxString` would go.

`scripts/verify-order2-roundtrip.mjs` reconstructs each genuine packet through
the codec and compares:

```
Order2 round-trip: 42/42 reproduced byte-for-byte
```

The script reads the ignored evidence tree and **skips** (exit 2) on a clean
checkout, so raw evidence stays off Git while the committed Jest suite holds the
shape with synthetic fixtures.

Two further details the round-trip forced out, both of which a hand-written
codec would have got wrong:

- **Descriptions carry significant leading and trailing whitespace.** The client
  uses leading spaces to mark a modifier line on the kitchen docket. Trimming a
  description silently changes the packet.
- **The client escapes `'` as `&apos;` and `&` as `&amp;`.** Our existing
  `escapeXmlText` already matched, which is now asserted rather than assumed.

### The checksum did not fall, and here is exactly how far it got

`WAITERPAD-CHECKSUM-001` stays open. This was attacked properly and failed:

- 672 combinations were tested — 14 input recipes (full body, body minus the
  checksum node, whitespace-stripped variants, the item block alone, and several
  field concatenations) × 4 encodings (UTF-8, UTF-16LE, code unit, low byte) ×
  12 hash functions (Java 31, djb2, djb2-xor, sdbm, FNV-1, FNV-1a, CRC32,
  Adler32, sums, and both .NET Framework `string.GetHashCode` variants).
  **No combination reproduced a single one of the 42 values.**
- The values are not time-derived: sorted by timestamp they are neither
  monotonic nor correlated with elapsed time, and they occupy the full signed
  32-bit range in both signs.
- **The dataset cannot distinguish a content hash from a per-submission nonce**,
  because no two of the 42 packets share content — zero identical bodies and
  zero identical item lists. A collision would settle it; the corpus has none.

That last point matters for planning. If the value is a nonce, Verdura could
mint its own and the receiver's duplicate guard would work as retry protection.
If it is a content hash, it cannot be minted without the algorithm. **We do not
know which**, and the difference decides whether replay protection is available
at all. The algorithm lives in the PocketPad iOS app, which is not reachable
from Back — so this is now a vendor question or an app-binary question, not a
black-box one. Further guessing from Back is not worth the tokens.

### Two blockers this work newly exposed

**`WAITERPAD-PRICE-001` — Order2 carries a real price, and who wins is NOT SHOWN.**
The old design's invariant "Verdura must never set the price" is *incompatible*
with the live wire format, which always carries a real amount and never a
sentinel. Whether the receiver trusts the sent price or re-resolves it from
`StockItems` is unobserved, and the two readings differ by a customer being
charged the wrong amount. The codec therefore makes price a required, explicit,
2dp string rather than defaulting it — a caller must state the amount, and
cannot let one slip through.

**`WAITERPAD-SEAT-001` — Seat is 0 in 100% of observed traffic.**
This branch persists seat assignment through the native pipeline (658f428), but
all 412 genuine items carry `<Seat>0</Seat>`. The venue has never exercised seat
assignment over this protocol. Receiver behaviour for a non-zero `Seat` is not
contradicted — it is simply never tested, and sending one would be the first
time it had happened on this till.

### Blocker register

Nine open: `-ACKLOSS-001`, `-CHECKSUM-001`, `-DUPGATE-001`, `-FRAMING-001`,
`-PRICE-001`, `-RECON-001`, `-REGO-001`, `-SEAT-001`, `-SUPPORT-001`.
Seven before this pass, nine after. `-BIND-001` closed last pass; `-PRICE-001`
and `-SEAT-001` opened by this one. **The register grew because the codec work
made two real hazards visible, not because anything regressed.**

### Status

```
ORDER2 WIRE FORMAT:               DERIVED AND VERIFIED 42/42 BYTE-EXACT
ORDER2 CODEC:                     IMPLEMENTED, PURE, UNWIRED, 23 TESTS
EXISTING ORDER BUILDER:           WRONG FORMAT (VariPad file import) - unused
CHECKSUM ALGORITHM:               NOT DERIVED (672 combinations exhausted)
CHECKSUM SEMANTICS:               HASH vs NONCE UNDECIDABLE FROM 42 VECTORS
PRICE AUTHORITY:                  NOT SHOWN - new blocker
SEAT NON-ZERO:                    NEVER OBSERVED - new blocker
TRANSPORT:                        STILL ABSENT (no net/tls/http import)
NEST WIRING:                      NONE (module has no callers)
WEBORDER / INSERTORDERS / DOSHII: ABSENT FROM WRITE PATH
LIVE ACCEPTANCE TEST:             NOT PERFORMED - see below
NATIVE TRANSPORT ACTIVATION:      NO
PRODUCTION READY:                 NO
```

### Why no live acceptance test was performed

The brief asked to finish through controlled live acceptance. That step was not
taken, and it should not be taken on the strength of the current evidence:

1. **A send cannot be made replay-safe.** The checksum algorithm is unknown, and
   an empty `<Checksum>` makes the receiver skip `IsDuplicateHandheldOrder2`
   entirely. Front's `LastCheckSum1`/`LastCheckSum2` are empty after 41 real
   orders, so there is no evidence the guard is armed even when populated.
2. **No response distinguishes success from silent loss.** ACK precedes durable
   processing, is byte-identical to a Test ACK, and is also returned when the
   200-slot buffer is full. A NAK can arrive for a fragment of an order that was
   already accepted and already printed.
3. **A wrong price posts to a real customer's tab**, and the kitchen fires
   immediately — `SendToKitchen` runs about 300 ms after the packet lands, with
   no confirmation step and no soft-delete.

Any test order lands on a real table in a live restaurant during trade. There is
no test till, no maintenance window, and no vendor confirmation on record. The
correct next step is not a more careful send; it is one of: a vendor answer on
the checksum and on price authority, a non-production IdealPOS instance, or an
explicitly agreed maintenance window on a table that is out of service — an
operator decision, not one to be taken unilaterally from Back.

---

## Addendum — 2026-09-09 14:15–14:20, AUTHORISED LIVE ACCEPTANCE TEST

The operator explicitly authorised minimal, controlled Order2 acceptance tests
on the live system over TCP 6983, before departing at 15:00. Two sends were
made. **Both were refused by the till, and neither touched a sale.**

### What was sent, and what came back

| # | 14:15:10 | 14:19:55 |
|---|---|---|
| packet | `<Command Type="Test">` | `<Order Type="Order2">`, table 99, 1 line |
| bytes | 581 | 1422 |
| response | `NAKREGO` (77 bytes, 315 ms) | `NAKREGO` (77 bytes, 306 ms) |
| Front logged | `BAD REGO` | `BAD REGO` |
| sale created | none | none |

Both used `DeviceID VERDURA-ACCEPT-20260909-0001` from Back (192.168.1.250).
Single attempt each. **No retry was issued for either.**

### THE BLOCKER IS A LICENCE SEAT — `WAITERPAD-LICENCE-001`

Front logged, immediately before each refusal:

```
20260909 14:15:10.568    VERDURA-ACCEPT-20260909-0001 - WP Current Count=2 - Waiters=2
20260909 14:15:10.608    BAD REGO
```

The handheld licence has **two** seats and both were occupied. And one is
**wasted on a phantom**: at 11:42:54 that morning a device registered with
`DeviceID` *and* `LocalAddress` both literally `undefined` — the iPad app
registering before it knows its own identity — taking seat 1. The real iPad
took seat 2 six seconds later:

```
20260909 11:42:54.450    Adding undefined to current devices.
20260909 11:43:00.419    Adding 10DF1A7881284E2E95CA107E82EE7D0D to current devices.
```

So the venue runs permanently one seat down, from every IPS start until the
next. Verdura cannot register, and therefore cannot post an order at all,
until a seat is freed or bought. This is not a code problem and no amount of
codec work moves it.

### Three things the test PROVED that were previously assumptions

1. **`NAKREGO` is caused by slot exhaustion — RUNTIME.** Previously PROVEN
   STATIC only, and never once observed in the historical corpus (zero NAKREGO
   in 2853 responses). It fired twice on demand, with `BAD REGO` beside it.
   `WAITERPAD-REGO-001` narrows to "is this the *only* cause", which the wire
   cannot answer because NAKREGO carries no body.
2. **The ORDER path is registration-gated, and the gate runs BEFORE processing.**
   This is a genuine safety property of the receiver, not a hazard: an
   unregistered device cannot post a sale. `POSWorker.log` shows only timer
   ticks across the whole window — no `ProcessHandheldOrder`, no
   `SendToKitchen`, no table 99, nothing.
3. **Our generated Order2 is well-formed to the real parser.** The receiver
   logged the packet body in full and produced **no** `XML parsing error` and
   **no** `NAK` — it parsed cleanly and reached the registration gate, which
   sits after the parse. The 42/42 offline round-trip is now backed by the live
   receiver accepting the codec's output as valid XML.

### What was deliberately NOT done

Re-sending under the venue iPad's own `DeviceID` would have bypassed the
licence gate and posted a real order. It was not done. The authorisation was
for a controlled test of **Verdura's** path; borrowing another device's
identity would defeat the very gate the till uses to protect itself, would
pollute the real device's duplicate state, and would produce evidence that does
not describe how Verdura would run in production — it needs its own seat either
way.

### Status

```
LIVE TEST PERFORMED:              YES - 2 sends, both refused, zero mutation
ORDER2 XML VALID TO REAL PARSER:  YES - parsed, no XML error, no NAK
ORDER PATH REGISTRATION-GATED:    YES - gate runs before processing
NAKREGO FROM SLOT EXHAUSTION:     RUNTIME-PROVEN
HANDHELD LICENCE SEATS:           2, BOTH TAKEN (one by a phantom "undefined")
VERDURA CAN REGISTER:             NO
ORDER ACCEPTANCE:                 UNTESTABLE UNTIL A SEAT IS FREE
NATIVE TRANSPORT ACTIVATION:      NO
PRODUCTION READY:                 NO
```

### The single next action

Free or buy a handheld licence seat. The phantom seat clears on an IPS restart,
which is an operator decision and **must not** happen during trade. Once a seat
is available the same two commands re-run unchanged and the remaining
questions — acceptance, whether the round lands on the native tab, price
authority (`WAITERPAD-PRICE-001`) and kitchen behaviour — become answerable in
minutes.
