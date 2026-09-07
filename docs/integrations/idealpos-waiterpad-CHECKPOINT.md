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
