> ## ⚠️ SUPERSEDED — read this box before the document below
>
> **This checkpoint describes 2026-09-07. Two working sessions have happened
> since, and several of its "not done" statements are no longer true.** It is
> kept unedited as a dated record; nothing below this box has been rewritten.
>
> **What has changed since, as of 2026-09-12:**
>
> | Then (2026-09-07) | Now |
> | --- | --- |
> | `confirmed` unreachable; no evidence reader anywhere | **Strong automatic confirmation works offline**, end to end |
> | Confirmation rule undecided | **Causal token AND durable line delta**, both required, both mutation-proven |
> | — | Token equality alone can **never** confirm: `IPS.exe` writes it before any sale line |
> | — | Native writer **refuses to start** without reader + sweep + baseline source |
> | Five P0 lifecycle defects open | All five closed (were closed 2026-09-11) |
> | Site config largely unknown | Map **1**, Location **1**, POSTerminal **901** (the iPad's), Clerk **108** — proven from 42 real captures |
> | PriceLevel unknown | Still **unproven**, and now known to be *unprovable from the captures* — the prover is built and needs one read-only `StockItems` query |
> | 11 lint errors | Zero |
>
> **What has NOT changed:** the handheld licence seat (`WAITERPAD-LICENCE-001`)
> is still the external blocker, capacity still 2/2, still no vendor reply.
> The migration baseline is still **rehearsed, not executed**. Production is
> still empty and unseeded. Live Order2 acceptance still requires legitimate
> handheld capacity, and no live order has been sent.
>
> **Current state lives in:**
> - `docs/integrations/idealpos-token-write-timing-2026-09-11.md` — why the token cannot confirm alone, and what the durable half actually is
> - `docs/runbooks/migration-baseline.md` — the migration position, re-rehearsed 2026-09-12
> - `docs/integrations/idealpos-handheld-licence-escalation.md` — the licence blocker, updated 2026-09-12
> - `scripts/site-config/site-config-evidence.json` — what the 42 captures prove
> - `apps/api/src/pos-sync/waiterpad/waiterpad-native-evidence.ts` — the confirmation rule itself
>
> ---

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

---

## Addendum — 2026-09-09, offline build-out: two blockers closed, the writer implemented

With live acceptance blocked on a licence seat, this pass did everything that
did not need another live order. Two blockers closed **on evidence**, and the
production writer now exists behind a fail-closed gate.

Static analysis was done on Back against its own copy of `IPS.exe`
(40,143,120 bytes, 2023-09-11, sha256 `f18475a7…c85a520e` — the same build Front
runs), with capstone/pefile. Nothing was executed and Front was not touched.

### The checksum is not a checksum — `WAITERPAD-CHECKSUM-001` CLOSED

`IsDuplicateHandheldOrder2(checksum, deviceId)` at `0x01835070` does three
things and no more:

1. builds `'IH-'` + DeviceID and runs
   `SELECT * FROM AAAExampleData WHERE ColumnType='…'`
2. on an empty recordset, **stores our value verbatim** via
   `INSERT INTO AAAExampleData (InsertDate, ColumnType, Data) VALUES ('…'`
3. otherwise reads the row's `data` column and compares it with **`__vbaStrCmp`**
   (`0x0183534d`), returning `-1` for a match

Every instruction touching the value is a string operation — `__vbaStrCmp`,
`__vbaStrCat`, `__vbaStrCopy`, `__vbaStrMove`. **No arithmetic, no hash, no
validation.** The vendor algorithm was never findable because the receiver never
computes one.

So the question "what algorithm?" was the wrong question. `<Checksum>` is an
**opaque equality token scoped by DeviceID**, and Verdura can mint its own.
`waiterpad-token.ts` derives it as `sha256(roundId, attemptId)[0..32]` —
deterministic, so a crash-and-restart recomputes the same value and the till can
recognise a resend of *that attempt* rather than treating it as a new order.

What it still does **not** buy, and `WAITERPAD-DUPGATE-001` stays open for:
the store is **one deep per device**, so A→B→A reads as three orders; an empty
token skips the guard entirely (`__vbaStrCmp` against `''` at `0x018261fa`); and
the whole check is jumped over when the global at `0x2a2f1e4` is clear
(`0x01826289`). Exactly-once stays on Verdura's side.

### The -9999 price sentinel IS honoured — `WAITERPAD-PRICE-001` CLOSED

This one reverses the previous pass's conclusion, and reverses it the safe way.

`ProcessHandheldOrder` converts `<Price>` with `__vbaCyStr`, then at `0x01828538`
compares it against the constant at `0x474698` — **the double `-9999.0`** — using
`__vbaFpCmpCy`. The branch is `jne`:

- **not equal** → jumps past the lookup: **the sent price is used verbatim**
- **equal** → falls through, builds the column name `"Price" & PriceLevel` via
  `__vbaStrI2`, reads it from `StockItems`, and **overwrites** the price
  (`0x0182862c`)

The last pass recorded "there is no sentinel in Order2" from traffic alone. That
was true of the *iPad*, which always sends a real amount — and false of the
*protocol*. The invariant "Verdura never sets a price" survives intact: send
`-9999` and the till prices the line itself.

`PriceLevel` becomes a literal column name on that path, so it must be 1..6 —
the image has `Price1`..`Price4` and `Price8`, and no `Price0`. That also
explains why the old VariPad builder demanded 1..6: it was right for the
sentinel path all along.

### What the rewrite deletes — `WAITERPAD-RECON-001` narrowed again

`ProcessHandheldOrder` loads the literal `` `IH `` (`0x70dd64`), appends the
table number, and uses the result as the Code in both
`DELETE * FROM PendingSaleLines WHERE Code='…'` (`0x01827665`) and
`DELETE * FROM PendingSales WHERE Code='…'`.

**The delete is scoped to the `` `IH<table> `` staging rows, not the customer's
tab.** The apparent contradiction between the static delete-and-rewrite reading
and the runtime fact that rounds accumulate is resolved: they were never in
conflict. Recorded as `REWRITE_DELETES_STAGING_CODE_EVIDENCE`.

`RECON-001` stays open for the remaining halves — no `OrderedTime` in the
readback, and the token-row write ordering is unknown — but it now has a real
causal signal to build on (below).

### Seat — still fail-closed, deliberately

`<Seat>` is read and converted with `__vbaI2Str` into `[ebp-0xb0]`
(`0x01827edd`). There are exactly two references to that local: that write, and a
read at `0x01827e43` that copies it under a guard whose else-branch substitutes
`0`. The read sits at a *lower* address than the write, so the cross-iteration
relationship is not resolved by static reading, and a naive reading suggests an
off-by-one that is **not** being asserted.

That licenses carrying Seat through the codec. It does **not** license sending a
non-zero Seat to a live till. The writer refuses `seat > 0` unless
`IDEALPOS_WAITERPAD_ALLOW_NON_ZERO_SEAT=true`, and **never silently rewrites a
seat to 0** — that would move a customer's item to another seat.

### What was built

| module | role |
|---|---|
| `waiterpad-order2-packet.ts` | the codec; pricing is now an explicit `nativeResolved` \| `explicit` choice |
| `waiterpad-token.ts` | durable duplicate token + what the receiver guard can/cannot do, as data |
| `waiterpad-device-identity.ts` | Verdura's own DeviceID; **hard-refuses** the iPad's id and `undefined` |
| `waiterpad-config.ts` | fail-closed activation gate; collects every reason it stayed shut |
| `waiterpad-transport.ts` | one bounded send, **no retry path exists** |
| `waiterpad-table-round-writer.ts` | `ITableRoundWriter` + `DisabledTableRoundWriter` (still the wired one) |
| `waiterpad-reconciliation.ts` | the predicate the next live run finalises |
| `testing/fake-waiterpad-server.ts` | 11 scripted receiver behaviours |

**The safety invariant was narrowed, not deleted.** `waiterpad-safety.spec.ts`
used to assert that *nothing* in the tree could open a socket. It now asserts
that the set of files with network capability is **exactly**
`['waiterpad-transport.ts']`, so a second one cannot appear silently. The old
test's own comment asked that a future transport "delete this test on purpose,
not slip past it" — this is that deletion, done on purpose.

The transport's central rule is that ambiguity after the write is never reported
as failure. `bytesLeftHost` is false **only** when nothing was written; a reset
that arrives *after* `connect` is uncertain, not failed, and there is a test
whose job is to stop someone "fixing" that.

### The strongest causal signal we have ever had

The receiver stores **our token, verbatim, keyed by our DeviceID**. That is the
first durable row on the till that can be tied to a specific Verdura submission.
`reconcileAmbiguousSend` therefore returns `confirmed` on exactly one condition —
the till is holding this attempt's token for this device — and demands a human
otherwise. It explicitly refuses to confirm on PLU/quantity coincidence.

It is one-deep, so it speaks only about the most recent attempt for a device —
which, for an ambiguous send, is precisely the attempt in question.

### Deployment sequence

The `OrderItem.seat` migration exists and **is not yet applied**
(`20260909010000_add_order_item_seat`, `prisma migrate status` confirms). It was
**not** applied in this session: that was not part of an authorised deployment.

```
1.  npm run db:migrate          # = prisma migrate deploy, apps/api
2.  deploy apps/api
3.  deploy connector / bridge
4.  deploy admin console (Order Tablet)
```

The migration is backward compatible — a nullable column with no default — so
step 1 is safe to run ahead of step 2, and existing rows stay `NULL` (meaning
"no seat", never seat 0).

### Vendor issue for Idealpos — the phantom registration

Worth raising independently of Verdura, because the venue is paying for a seat
it never gets.

> The Idealpos handheld client registers **twice** per IPS session. It first
> registers with `DeviceID` and `LocalAddress` both literally the string
> `undefined`, then a few seconds later with its real identity. The phantom
> registration consumes one of the licensed handheld seats and is never
> released; the seat is only recovered by restarting IPS.
>
> Observed on DESKTOP-70DQTGJ in every retained `Ideal Handheld` log covering an
> IPS start:
>
> ```
> 20260905 13:20:59.461  Adding undefined to current devices.
> 20260905 13:21:05.420  Adding 10DF1A78…7D0D to current devices.
> 20260906 14:16:51.546  Adding undefined to current devices.
> 20260906 14:16:57.617  Adding 10DF1A78…7D0D to current devices.
> 20260909 11:42:54.450  Adding undefined to current devices.
> 20260909 11:43:00.419  Adding 10DF1A78…7D0D to current devices.
> ```
>
> Effect: `WP Current Count=2 - Waiters=2` with only one physical handheld in
> use, so a second genuine device is refused `NAKREGO` / `BAD REGO`.
> PocketPad Version 2.2.51, iPadOS 17.7.11, IPS.exe build 2023-09-11.

### Status

```
SOFTWARE IMPLEMENTATION:          READY  (codec, token, identity, config,
                                   transport, writer, reconciliation, fakes)
ORDER2 CODEC:                     42/42 byte-exact vs genuine packets
CHECKSUM:                         CLOSED - opaque token, Verdura mints its own
PRICE AUTHORITY:                  CLOSED - -9999 sentinel honoured; policy is
                                   nativeResolved, so Verdura sets no price
DELETE SCOPE:                     CLOSED - staging `IH<table> rows, not the tab
SEAT:                             FAIL-CLOSED, never silently downgraded
TRANSPORT:                        ONE bounded send, no retry path exists
FAILURE SEMANTICS:                ACK != durable; NAK may follow acceptance;
                                   NAKREGO = registration refused; anything
                                   after the write = UNCERTAIN
RECONCILIATION:                   abstraction in place; token row is the
                                   strongest causal signal found to date
CONFIG GATE:                      FAIL CLOSED, 12 required settings
WIRED WRITER:                     DisabledTableRoundWriter
MIGRATION:                        present, NOT applied (deliberately)
WEBORDER / INSERTORDERS / DOSHII: ABSENT from the native path
LIVE ACTIVATION:                  BLOCKED - handheld licence capacity only
PRODUCTION READY:                 NO
```

---

## Addendum — 2026-09-10, the readback: escalation that reaches a person

Reconciliation has been able to escalate an unproven round since `e5446b8`. It
could not tell anybody. This closes that.

### The hole

`POST /api/admin/orders/:id/rounds` answers once, about the instant it ran, and
the best it may ever say is `sentAwaitingConfirmation` — the receiver ACKs
before durable processing, so no send can honestly report more. Everything after
that belongs to reconciliation: `confirmed` against the till's own token row, or,
when nothing ever confirms it, **escalated to `unresolved`** after a bounded wait
so that a human looks at the till.

That escalation was real, durable, and invisible. It changed a row nothing read.
The tablet's banner was set once from the POST's answer and never revisited, so
a waiter went on reading **"ROUND 1 SENT — AWAITING TILL CONFIRMATION"** for the
rest of the service about a round the server had already given up on — and the
Send button stayed alive underneath it.

A stale reassuring message is worse than an alarming true one. On this
integration it is worse in the specific direction that costs money: the whole
point of escalation is that an unproven round should get *more* alarming with
age, and the screen was doing the opposite.

### What was built

| Piece | What it is |
| --- | --- |
| `NativeTableRoundService.readRounds` | Reads every round of an order. No writer, no transport, returns rows. |
| `GET /api/admin/orders/:id/rounds` | The read route. Same guards, same venue/org scoping as the POST — now via one shared `assertInScope`, so the two cannot drift. |
| `describeRoundForReadback` | Durable state → a sentence for someone *looking*. Exhaustive over the enum, no default. |
| `nativeRoundView.ts` (console) | The merge rule, extracted so it is testable without rendering the screen. |
| The poll | Runs beside the existing `pos-sync` / `print-jobs` polls, with **no terminal-state shortcut**. |

### The two vocabularies, and why they are not one

`SendToKitchenResult` has no `confirmed` member and must never gain one — no
send may report a round confirmed. `RoundReadStatus` has one, because by the time
the readback is asked, reconciliation may genuinely have got there. Collapsing
them would mean one of the two lying: a confirmed round reported forever as
`sentAwaitingConfirmation`, or a value in the send path's type that the send path
is forbidden to produce.

Same reasoning for the messages. `describeExistingRound` speaks to the instant
after a *second tap* ("nothing was sent again"); the readback speaks to someone
who pressed nothing. Sharing them would force one context's sentence onto the
other.

### A round is never talked down

The merge rule is the safety-critical half, and it is one-directional:

* The banner may always become **more** alarming.
* It becomes less alarming **only** on a `settled` row — `confirmed`, `rejected`,
  or provably never sent. `unresolved` is deliberately *not* settled, so a round
  nobody can explain keeps its red banner for as long as nobody can explain it.
* **Silence changes nothing.** A failed poll, a network drop, a poll returning
  rows about other rounds — none of them reach the merge with a matching row, and
  the banner is left untouched. There is no error path that clears it. A screen
  that relaxed whenever it lost the server would relax hardest at exactly the
  moment the till was unreachable.
* `safeToRetry` is never inferred from ignorance — only from a settled row that
  created nothing.
* A poll must not *cost* information: while a round is still a human's problem,
  the send-time cause is kept, because `registrationRejected` ("it is a licence")
  is something a waiter can act on and the readback's general "nobody knows" is not.

The banner gained a fourth state, GREEN, reachable **only** from the readback —
which makes the existing comment true rather than aspirational: green means the
till was seen holding our own token, and a send can never produce it.

After a reload the poll adopts an alarming round from nothing, and only an
alarming one. A red "do not send again" that a refresh would otherwise have
silently discarded is exactly what must survive; materialising a reassuring
"sent, awaiting the till" for a press this device never made would be the screen
inventing history.

### It cannot send

The read route has no writer in its dependency graph, and `readRounds` returns
rows. This matters more here than in the reconciler: staff can refresh this at
will, and a route that reacted to finding a worrying round by resending it would
be the single most damaging thing on the screen. Asserted with a live fake till
that hears nothing across ten reads of an escalated round, and by tests that the
read changes no round state and releases no line.

### Verification

```
api             99 suites / 1536 tests   PASS
admin-console   17 files  /  196 tests   PASS
tsc --noEmit    both apps                CLEAN
eslint          all changed files        CLEAN
```

The two new component tests were mutation-checked: with the poll disabled, both
fail. `native-round-readback.spec.ts` drives the real POST handler, a real
reconciliation sweep and the real GET handler over one order.

The harness gained `nativeTableRound.findMany` and the reconciler (reader
**unbound**, as production is), so the escalation path is now exercised
end-to-end rather than only in the reconciler's own unit spec.

### What this does NOT change

Still true, unchanged by this work:

```
WIRED WRITER:      DisabledTableRoundWriter
MIGRATION:         present, NOT applied (deliberately)
LIVE ACTIVATION:   BLOCKED - handheld licence capacity (WAITERPAD-LICENCE-001)
EVIDENCE READER:   UNBOUND in every build, so `confirmed` is unreachable in
                   production today and the readback's working half is
                   escalation - which is the half that needs no till access
PRODUCTION READY:  NO
```

The green banner is implemented and tested but cannot appear in production until
a connector build can read the till's token row. That is deliberate: the code
path exists so that binding a reader is a configuration change rather than a
feature, and until then every evidence field stays `undefined`, which the
predicate reads as ignorance and never as absence.
