# IdealPOS handheld registration capacity — vendor escalation

**Status:** Ready to send. Blocking. Raise now, not on the eve of go-live.
**Owner:** Verdura (restaurant to forward to the Idealpos reseller/vendor)
**Raised:** 2026-09-09
**Blocks:** the entire Verdura Order Tablet native workflow (`WAITERPAD-LICENCE-001`)

---

## 1. What we are asking for, in one sentence

**Verdura needs its own legitimate IdealPOS handheld registration seat**, under its
own device identity, so that it can send genuine handheld orders to the venue's
IdealPOS without displacing or impersonating the existing iPad.

Everything else on our side is built. This is the one thing we cannot solve in
software, and we are not willing to solve it the wrong way — see §5.

---

## 2. What we have observed, stated precisely

These are direct observations from the venue's own Front terminal. Where we do
not know something, §4 says so explicitly rather than filling the gap.

| Observation | Value |
| --- | --- |
| Licensed handheld capacity (`Waiters`) | **2** |
| Current registration count (`WP Current Count`) | **2** |
| Registrations present | one genuine iPad; one entry whose identity fields read literally `undefined` |
| Verdura's result when registering under its own device identity | `BAD REGO` → `NAKREGO` |
| Attempts | 2, on 2026-09-09 |

**After the `NAKREGO` refusal, on both attempts:**

- no sale was created;
- no `ProcessHandheldOrder` ran;
- no `SendToKitchen` fired;
- no kitchen docket was produced;
- **the real iPad was not displaced and continued working normally.**

The refusal is therefore clean and safe — registration is rejected *before* any
sale processing. We are not reporting a data-integrity incident. We are
reporting that we cannot obtain a seat.

---

## 3. Our reading of the cause

Licensed capacity is 2 and 2 registrations are held. One is the venue's real
iPad. The other holds `undefined` in place of a device identity.

With capacity full, a third device — Verdura, using its own identity — is
refused. That is consistent, expected licence-gate behaviour, not a defect.

The question we cannot answer ourselves is what the second registration is.

---

## 4. What we are explicitly NOT claiming

We want to be careful here, because a wrong accusation wastes your time and
ours.

- **We do not claim which application created the `undefined` registration.**
  We have not traced its origin, and we have no evidence identifying the
  responsible client.
- **We do not claim it is a defect in IdealPOS.** It may be expected behaviour
  for a client that registers before it knows its own identity, a stale entry
  from a prior device, or something else entirely.
- **We do not claim it is recoverable capacity.** If it is legitimately in use,
  then the venue simply needs more capacity, which is a commercial question
  rather than a technical one.

---

## 5. What we will not do

Stated up front so there is no ambiguity about the kind of integration this is.

- We will **not** send the iPad's DeviceID. Orders would post under a device a
  human is holding, and would corrupt that device's duplicate-guard state.
- We will **not** register as `undefined`, or borrow any other handheld's
  identity.
- We will **not** design around restarting `IPS.exe` during service.
- We will **not** send another live order until a legitimate seat exists.

Our software enforces all of these: the device identity module hard-refuses the
iPad's id and the literal `undefined`, and the native path is disabled by
default and fails closed on incomplete configuration.

---

## 6. What we would like from Idealpos

Any ONE of these unblocks us. We have no preference beyond whichever you
consider supported.

**A. Identify and clear the `undefined` registration.**
If it is stale or spurious, how is it correctly removed, and how is it
prevented from returning? If clearing it requires a service restart, we would
schedule that outside trading hours with the venue.

**B. Increase licensed handheld capacity.**
If the second registration is legitimate, the venue is simply at capacity and
needs one more handheld licence. Please advise cost and lead time — lead time
matters more than cost to us right now.

**C. Confirm the supported path for an additional handheld client.**
What are the supported requirements for a third-party or additional native
handheld to register against this installation? If there is a supported
registration procedure, provisioning step, or device-identity convention we
should be following, we will follow it.

---

## 7. Why the timing matters

The venue's target date for this workflow is **18 September 2026**. Every part
of the integration that can be built and tested offline is built and tested;
the outstanding work on our side is measured in hours once a seat exists.

The licence question is the long pole, and it is the one entirely outside our
control. That is the only reason we are raising it well ahead of the date
rather than at it.

---

## 8. Contact and next step

Please reply with which of A, B or C applies. If it is B, we would like a
quote and a lead time. If it is A, we would like to agree a window with the
venue.

If it is useful, we can supply the exact Front-terminal readings above and the
timestamps of both refused registration attempts.
