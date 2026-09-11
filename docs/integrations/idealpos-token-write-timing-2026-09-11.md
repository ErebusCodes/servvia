# When does IPS.exe write the duplicate token? — Unknown J, closed

**Date:** 2026-09-11
**Method:** static analysis of the local `IPS.exe` only. No network, no live
packet, no IdealPOS process started, nothing written to any IdealPOS store.
**Grade:** `PROVEN STATIC`

---

## The question

`waiterpad-reconciliation.ts` carried this open question, and the whole
confirmation rule rested on the answer:

> whether the token row is written BEFORE or AFTER the sale is durable — **if
> before, a stored token proves receipt but not application**

If the token is written *after* the sale is durable, holding our token is proof
the round is on the customer's bill, and reconciliation may confirm on it alone.
If *before*, it is proof only that our packet was picked up.

## The answer

**BEFORE.** The token is written before the receiver has deleted the table's
existing pending sale, and long before it writes a single line of the new one.

## The evidence

Binary: `C:\Program Files (x86)\Idealpos Solutions\Idealpos\IPS.exe`
(40,143,120 bytes). ImageBase `0x00400000`, `.text` `0x00401000`–`0x02a2e0d4`.
Addresses below are virtual and match the 2026-09-06 protocol contract exactly,
which is itself a check that the contract and this build agree.

### 1. There is one writer of the token row, and one caller of it

`"UPDATE AAAExampleData SET Data"` exists once in the image, at `0x0070db80`.
It is pushed at exactly one code site, `0x018268d8`. Walking back to the nearest
`push ebp; mov ebp, esp` gives the enclosing function:

```
SaveChecksum entry (derived)      0x018267f0
2026-09-06 contract said          0x018267f0     ✔ agree
callers of SaveChecksum           0x01827301     (exactly one, binary-wide)
enclosing function of that call   0x01826b90     = ProcessHandheldOrder
```

Callers were found by scanning every `E8` in `.text` and resolving the rel32, so
"exactly one" is over the whole image and not over a window.

### 2. Inside `ProcessHandheldOrder`, the token write comes first

Disassembling from the function prologue at `0x01826b90` — 770 instructions,
with the stream confirmed aligned by decoding the `call` at `0x01827301`
exactly — the string references appear in this address order:

```
0x01826f70   "Table"
0x01827106   "DeviceID"
0x01827189   "ProcessHandheldOrder Processing STARTED : Table "
0x01827234   "Checksum"
0x01827301   call SaveChecksum                      <<<< TOKEN WRITTEN HERE
0x01827321   "Clerk"
0x0182742e   "Guests"
0x018274ce   "----------- TABLE ORDER : "
0x01827664   "DELETE * FROM PendingSaleLines WHERE Code='"
0x01827709   "DELETE * FROM PendingSales WHERE Code='"
0x01827c01   "OrderItem"   ... "StockItem" "Quantity" "Seat" "PriceLevel" "Price"
```

### 3. Address order is execution order here

Layout is not flow, so the branches were enumerated:

* **20 branches** in the function up to `0x01827800`.
* **2 of them jump over the token write** — `0x01827290 jne` and `0x018272f0 je`
  — and *both land at `0x01827306`*, the instruction immediately after the call.
  These are the guards that skip the write when no `Checksum` node was sent.
  Neither reaches the deletes without passing the call site.
* **0 branches jump backward into or before the token write** from anywhere
  after it.
* Between `0x01827301` and the first delete there are 5 short forward branches
  (`jge`/`jne` into `0x0182734b`, `0x0182737f`, `0x01827413`, `0x01827458`,
  `0x0182748c`) — local conditionals, none leaving the region.

So on every path that reaches the `PendingSales` deletes, the token write has
already been passed.

---

## What follows from it

### The token alone must not confirm a round — and no longer does

`reconcileAmbiguousSend` used to return `confirmed` on token equality alone.
That is now a `manualResolutionRequired` with the reason stated, and `confirmed`
requires **both halves**:

| Half | Question it answers | Evidence |
| --- | --- | --- |
| **Causal** | did OUR packet cause this? | the till holds our attempt token against our DeviceID in `AAAExampleData` |
| **Durable** | does the customer's bill actually hold the lines? | a **delta**: the table's line multiset AFTER, minus a baseline captured BEFORE the socket opened, equals exactly this round's items |

Neither is sufficient. A readback alone is correlation — a waiter keying the
same items produces identical evidence. The token alone is now understood to be
correlation of a different kind: evidence about our packet's *receipt*, not
about the bill.

No connector build binds an evidence reader, so the old rule never ran against
real evidence in any environment. The correction is pre-emptive.

#### Correction, 2026-09-12: the durable half is a delta, not a count

The row above originally read *"a readback shows at least `expectedLineCount`
lines on the table"*. That was written the same day and was wrong, in a way
worth recording because it looked exactly like a durability check.

`observedLineCount >= expectedLineCount` is satisfied by almost any occupied
table. A tab already carrying five lines "proves" a two-line round that never
arrived. So on any table with prior content the predicate reduced to token
equality — which is precisely what this entire document exists to forbid. It
also could not distinguish the one coincidence the causal half is there to
exclude: a line that was *already on the tab* stood in perfectly well for one
that never came.

The durable half is therefore a subtraction, evaluated as a multiset keyed by
native code:

```
(native lines AFTER)  minus  (native lines BEFORE)  ===  this round's items
```

The BEFORE term is a baseline captured and committed **before the socket
opened** (`NativeSendAttempt.preSendTableSnapshot`), and the expected items are
frozen with the attempt (`NativeSendAttempt.expectedNativeItems`) rather than
re-derived later from a PLU mapping that may since have been edited.

That single change is what makes these decidable rather than lucky:

| case | why the delta gets it right |
| --- | --- |
| same PLU already on the table | it is in the baseline, so it is not in the delta |
| round 2 repeats round 1's item | round 1's line is part of round 2's baseline |
| qty 1, then qty 1 again | baseline 1 → after 2 → delta 1 |
| qty 2 against two earlier qty-1 lines | baseline 2 → after 4 → delta 2 |
| someone else adds a line | unexplained growth → `conflicting` |
| a line is voided underneath us | prior lines changed → `conflicting` |

Both halves are mutation-proven: removing the token comparison fails 3 tests,
removing the delta comparison fails 7, and one test states the old count rule's
failure directly. See `waiterpad-native-evidence.ts` and its spec.

A baseline that was never captured, or that is too old to describe the table,
yields no delta at all — the round stays unconfirmed and escalates to a human.
It cannot produce a wrong `confirmed`.

### There is a data-loss window on the till, and it is not ours to fix

Between `SaveChecksum` at `0x01827301` and the line writes after `0x01827c01`,
the receiver **deletes the table's existing pending sale**. A crash or restart
of `IPS.exe` in that window leaves:

* the token recorded — so a resend of the same payload would be answered
  `DUPLICATE`;
* the table's previous order **gone**;
* the new lines never written.

Verdura cannot repair that state and must never try. It is one more reason the
codebase has no automatic retry: a resend into this window is refused as a
duplicate while the table has already lost its order, and the only correct
response is a person at the till.

### What is still `NOT SHOWN`

* Where the new `PendingSales` / `PendingSaleLines` rows are written. The only
  SQL literals inside `ProcessHandheldOrder` are the two deletes; the inserts
  are in a callee that was not traced. This does not weaken the finding — the
  token write precedes the deletes, and the inserts can only follow them.
* Whether `SendToKitchen` and the ACK sit before or after the inserts. Not
  needed: both are after the token write, which is what the question asked.
* The checksum **generation** algorithm remains `NOT SHOWN` and is unchanged by
  this pass. `IPS.exe` is the receiver; it contains no generator.

---

## Reproducing this

The three scripts used are pure static readers built on `pefile` + `capstone`:
map VA→file offset through the section table, find `push imm32` sites for a
string's VA, resolve `E8 rel32` call targets image-wide, and disassemble from a
known prologue so the instruction stream is aligned. None of them execute any
part of the binary.
