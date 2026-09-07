# WaiterPad / Ideal Handheld — checkpoint, 2026-09-07 ~15:30 NZST

**Stopped cleanly. Nothing in flight, nothing half-done.**

Read this first when resuming. It exists so the next session does not have to
reconstruct where the line is.

*Supersedes the 2026-09-07 ~01:00 checkpoint; the earlier one's content is
carried forward below rather than replaced, and the parts that changed are
marked.*

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

- Front capture tooling: `scratchpad/front-passive-capture.ps1`, rehearsed
  against Back and corrected.
- Second read-only static pass on Back:
  `docs/integrations/idealpos-back-static-investigation-2026-09-07.md`.
- Contract amended: §17.2, plus two in-place scope tightenings.
- Offline fixture/replay harness + corpus:
  `apps/api/src/pos-sync/waiterpad/waiterpad-fixtures.ts` and `fixtures/`.
- Exactly-once scenario suite: `waiterpad-exactly-once.spec.ts`.
- Six new evidence notes in `waiterpad-evidence.ts`.

**Evidence bundles** (read-only):

- `C:\ProgramData\Verdura\evidence\idealpos-waiterpad-static-20260906\` —
  disassembly traces and tooling.
- `C:\ProgramData\Verdura\evidence\back-baseline-20260907\` — **new.** A full
  run of the Front capture script against **Back**, as a rehearsal and as the
  comparison baseline for tomorrow. Labelled Back evidence in its own
  `01-identity.txt`.

**Verification state at stop:** 277 WaiterPad tests pass (was 187); 626 across
`pos-sync` + `orders`; **1283 across the whole API suite, 88 suites, all green**;
`tsc --noEmit` clean; `eslint` clean; `check:nul-bytes` and
`check:bridge-governance` pass.

---

## The three things that must not be forgotten

### 1. Machine scope

This investigation could only read **Back / Machine 1** (`DESKTOP-SOKKOQ7`,
192.168.1.250, the POSServer host). The handheld server runs on **Front /
Machine 2** (`DESKTOP-70DQTGJ`, 192.168.1.199), which holds the entitlement
(`Ideal Handheld 2`, `HandheldNumber=2`) and has still never been inspected.

A negative observed on Back is evidence about Back. The rule is enforced by the
`[BACK]` / `[FRONT]` / `[STATIC]` tags in contract §0a, and by the
`[RUNTIME-BACK]` / `[STATIC]` / `[HISTORICAL]` / `[INFERENCE]` / `[UNKNOWN]`
tags in the 2026-09-07 investigation.

**New this session, and it matters for how tomorrow's listener table is read:**
`IPS.exe` and `IPSWorker.exe` are **byte-identical**. Both images contain the
listener code for 6983, 7983 and 12183. **Attribute a listener by PID, never by
which binary holds the constant.**

### 2. Nothing can transmit, and that is load-bearing

Three independent barriers, all asserted by tests:

* `assertNoTransportAvailable()` throws unconditionally — there is no transport;
* `IDEALPOS_WAITERPAD_CERTIFIED` is unset, must name a host rather than a
  boolean, and does not transfer between machines;
* no checksum can be generated, so no packet can be built at all.

**A transport requires explicit approval.** It has not been given.

### 3. NEW — connecting is not a read-only act

Device registration is **auto-granted only while the count of registered devices
is below the licensed handheld count** (contract §17.2 #3, `PROVEN STATIC`).
Front's licence reads `Ideal Handheld 2`. A Verdura `DeviceID` connecting during
service could take a slot a real waiter's handheld then cannot get — that
handheld gets `NAKREGO`, mid-service.

This is a **second, independent reason not to connect**, on top of the standing
prohibition. It applies even to a "harmless" `REQUESTTABLESTATUS` read.

---

## Resume order

Nothing below needs further investigation of Back. It has been read to
exhaustion: 135 log files, 23.9 MB, 2025-09 → 2026-09-07, **zero** WaiterPad or
handheld tokens.

**On Front / Machine 2 — read-only, no transmission. One command:**

```
powershell -ExecutionPolicy Bypass -File .\front-passive-capture.ps1
```

Procedure: `docs/integrations/front-desk-capture-procedure.md`, **Track A**.
Run it as the Windows user that runs IdealPOS, in the interactive desktop
session, with the till running as it normally does. **Do not restart IdealPOS
first** — a restart clears the in-process device-registration array and the
current listener set, which is exactly the state we want.

It collects, in one pass: the complete listener table joined to owning
PID/process/path/command line; process identity and hashes; the IdealPOS
registry including **`CurrentHandheldLogDate`**; a full log inventory; copies of
`Ideal Handheld*` and every other relevant log; `ips.mdb`; a token sweep with
context; Front's own licence lines; and a manifest with a passivity self-check.

**Vendor questions — unchanged except #4:**

3. Is the protocol on 6983 available to a third-party device, and under what
   terms? (`WAITERPAD-SUPPORT-001`)
4. ~~How does a device register?~~ **Answered statically** (§17.2 #3). What
   remains for the vendor: does `NAKREGO` have causes other than slot
   exhaustion, and what does its body carry? (`WAITERPAD-REGO-001`, narrowed)
5. In a two-machine deployment like this one, what routes a handheld order to
   the delete-and-rewrite relay path rather than the appending socket path?
   (`WAITERPAD-RECON-001` — **narrowed but standing**, §17.2 #6)

Blocker `WAITERPAD-ACKLOSS-001` — an `ACK` is emitted for a packet silently
dropped when the till's 200-slot buffer is full — is proven and has no
outstanding evidence question. It is a design constraint, not an unknown: every
`ACK` must be followed by a readback.

---

## What is deliberately unimplemented, and must stay that way

* **Reconciliation of a round against a readback.**
  `reconcileRoundAgainstReadback()` throws. `WAITERPAD-RECON-001` was narrowed
  this session, not closed.
* **Checksum generation.** `UnresolvedChecksumProvider` throws. A deterministic
  Verdura hash is not a WaiterPad checksum; see `waiterpad-checksum.ts`.
* **Any transport, retry, or routing change.** `dine-in-route.ts` still resolves
  **WEBIT** by default and knows nothing about this module tree. The WaiterPad
  modules still have **no importers anywhere in the codebase**.
* **Any captured protocol fixture.** `fixtures/captured/` is empty, and a test
  asserts it is empty and says so out loud. When Front yields a real packet, that
  test is the one to change — in the same commit that adds the fixture.

---

## Where to read next

* **Tomorrow's procedure:** `docs/integrations/front-desk-capture-procedure.md`
  **Track A** — one command, then read §A4's ordering.
* **Tonight's Back findings:**
  `docs/integrations/idealpos-back-static-investigation-2026-09-07.md`
* **Contract:** `docs/integrations/idealpos-waiterpad-protocol-contract-2026-09-06.md`
  (§0a machine scope, §7 pricing, §12 idempotency, §15 unknowns, §16 verdict,
  §17.1 the v1→v2 correction, **§17.2 the v2→v3 additions**)
* **Code:** `apps/api/src/pos-sync/waiterpad/` — start at `waiterpad-evidence.ts`,
  which links every constant to the address it came from
* **Exactly-once behaviour:** `waiterpad-exactly-once.spec.ts` — scenarios A–J
  as executable tests
* **Fixture harness:** `waiterpad-fixtures.ts` and `fixtures/captured/README.md`
* **Blocker register:** `UNRESOLVED_PRODUCTION_BLOCKERS` in
  `waiterpad-round-state.ts`, asserted by test
