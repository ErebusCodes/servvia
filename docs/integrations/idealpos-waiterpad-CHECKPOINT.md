# WaiterPad / Ideal Handheld — checkpoint, 2026-09-07 ~01:00 NZST

**Stopped cleanly. Nothing in flight, nothing half-done, nothing uncommitted.**

Read this first when resuming. It exists so the next session does not have to
reconstruct where the line is.

---

## Where things stand

**Branch:** `order-tablet-production-readiness`. Working tree clean apart from
`.claude/worktrees/`, which is a tooling artefact and was left untracked
deliberately.

**Tonight's commits, oldest first:**

| Commit | What |
| --- | --- |
| `55edba2` | The WaiterPad protocol contract, from static analysis of `IPS.exe` |
| `fabd2c1` | Machine-attribution correction — Back / Machine 1 is not the venue |
| `4ce28c2` | The offline, unreachable half of the driver (codec, parser, state mapping, gate) |
| `4b27a5d` | Fix: literal NUL bytes in one test fixture |

**Evidence bundle** (reproduction tooling + disassembly traces, read-only):
`C:\ProgramData\Verdura\evidence\idealpos-waiterpad-static-20260906\`

**Verification state at stop:** 187 WaiterPad tests pass; 460 pass across
`pos-sync` + `orders/rounds` with no regression; `tsc --noEmit` clean; `eslint`
clean; `check:nul-bytes` and `check:bridge-governance` pass.

---

## The two things that must not be forgotten

### 1. Machine scope

This investigation could only read **Back / Machine 1** (`DESKTOP-SOKKOQ7`,
192.168.1.250, the POSServer host). The handheld server runs on **Front /
Machine 2** (`DESKTOP-70DQTGJ`, 192.168.1.199), which holds the entitlement
(`Ideal Handheld 2`, `HandheldNumber=2`) and was never inspected.

A negative observed on Back is evidence about Back. The first version of the
contract document broke this rule and was corrected in `fabd2c1`; the rule is
now enforced by the `[BACK]` / `[FRONT]` / `[STATIC]` tags in §0a of the
contract. Do not re-derive venue facts from this machine.

### 2. Nothing can transmit, and that is load-bearing

Three independent barriers, all asserted by tests:

* `assertNoTransportAvailable()` throws unconditionally — there is no transport;
* `IDEALPOS_WAITERPAD_CERTIFIED` is unset, must name a host rather than a
  boolean, and does not transfer between machines;
* no checksum can be generated, so no packet can be built at all.

**A transport requires explicit approval.** It was not authorised tonight.

---

## Resume order

Nothing below needs re-investigation of Back. The remaining evidence is on
Front or with the vendor.

**On Front / Machine 2 — read-only, no transmission:**

1. `Get-NetTCPConnection -State Listen` (or `netstat -ano`), naming the port
   `IPS.exe` is bound to. Converts the 6983 constant from expected to observed.
   Closes `WAITERPAD-BIND-001`.
2. Copy off `Ideal Handheld.log`. It is the only place a genuine successful
   WaiterPad order can be reconstructed — and the only route to a real
   `<Checksum>` value with its packet, which is what closes
   `WAITERPAD-CHECKSUM-001`.

**Vendor questions:**

3. Is the protocol on 6983 available to a third-party device, and under what
   terms? (`WAITERPAD-SUPPORT-001`)
4. How does a device register? (`WAITERPAD-REGO-001`)
5. In a two-machine deployment like this one, what routes a handheld order to
   the delete-and-rewrite relay path rather than the appending socket path?
   (`WAITERPAD-RECON-001`)

Blocker `WAITERPAD-ACKLOSS-001` — an `ACK` is emitted for a packet silently
dropped when the till's 200-slot buffer is full — is proven and has no
outstanding evidence question. It is a design constraint, not an unknown: every
`ACK` must be followed by a readback.

---

## What is deliberately unimplemented, and must stay that way until the above

* **Reconciliation of a round against a readback.**
  `reconcileRoundAgainstReadback()` throws. It needs items 2 and 5 above.
* **Checksum generation.** `UnresolvedChecksumProvider` throws. A deterministic
  Verdura hash is not a WaiterPad checksum; see the reasoning in
  `waiterpad-checksum.ts`.
* **Any transport, retry, or routing change.** `dine-in-route.ts` still resolves
  **WEBIT** by default and knows nothing about this module tree. The WaiterPad
  modules have no importers anywhere in the codebase.

---

## Where to read next

* Contract: `docs/integrations/idealpos-waiterpad-protocol-contract-2026-09-06.md`
  (§0a machine scope, §7 pricing, §12 idempotency, §15 unknowns, §16 verdict,
  §17.1 the v1→v2 correction)
* Code: `apps/api/src/pos-sync/waiterpad/` — start at `waiterpad-evidence.ts`,
  which links every constant to the address it came from
* Blocker register: `UNRESOLVED_PRODUCTION_BLOCKERS` in
  `waiterpad-round-state.ts`, asserted by test
