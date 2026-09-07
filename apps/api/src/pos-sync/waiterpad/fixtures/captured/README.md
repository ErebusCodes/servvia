# `captured/` — genuine WaiterPad bytes only

**This directory is empty, and that is the current state of the evidence.**

Nothing in it yet. No WaiterPad packet has ever been observed at this venue by
this project: not a request, not a response, not a `<Checksum>` value with the
packet it belonged to. Everything in `../synthetic/` is a document *we* wrote
from static analysis of `IPS.exe`. Those fixtures can show that our parser
handles a shape. They can never show that IdealPOS produces it.

## What belongs here

Bytes that a real IdealPOS emitted, or that a real Ideal Handheld device sent,
observed on a named machine at a named time. Typical sources, in descending
order of value:

1. **Front / Machine 2's `Ideal Handheld*.log`** — the handheld log category.
   A successful historical order in that file carries `DeviceID`, a real
   `Checksum=` value, the table, the PLUs, the resolved price and the
   ACK/NAK/DUPLICATE that followed. One such packet-and-checksum pair is a test
   vector; several are the algorithm. This is what closes
   `WAITERPAD-CHECKSUM-001`.
2. **A real `NAKREGO` body.** Its contents are undecoded. The synthetic fixture
   deliberately carries an empty body rather than an invented one.
3. **A real `REQUESTTABLESTATUS` response.** Would promote §13 from
   `PROVEN STATIC` to `PROVEN RUNTIME`, and would settle whether the readback
   really carries no `OrderedTime`.
4. **A genuine `WPOrder Processing STARTED` / `ProcessHandheldOrder` log
   sequence.** Which of the two routines a real order takes is
   `WAITERPAD-RECON-001`, the surviving correctness risk.

## What does NOT belong here

- Anything reconstructed from a log line plus our assumptions. That is
  synthetic, however real its inspiration, and belongs in `../synthetic/` with
  `derivedFrom` saying so.
- Anything whose machine or timestamp is unknown. `CapturedOrigin` requires
  `machine`, `sourceFile`, `observedAt` and `method`, and the loader refuses a
  file missing any of them. That is deliberate: this project has twice filed a
  Back-scoped observation as a venue-wide fact, and the fixture format is
  built so it cannot happen a third time.
- Anything obtained by transmitting to a till. No packet has been sent, and
  sending one requires explicit authorisation that has not been given.

## File format

One JSON file per fixture:

```json
{
  "kind": "order_response",
  "origin": {
    "provenance": "captured",
    "machine": "DESKTOP-70DQTGJ",
    "sourceFile": "C:\\ProgramData\\Idealpos Solutions\\Idealpos\\LOGS\\Ideal Handheld.log",
    "observedAt": "2026-09-08T09:14:03+12:00",
    "method": "read-only copy taken by scratchpad/front-passive-capture.ps1"
  },
  "body": "<?xml version='1.0' encoding='utf-8' ?><WPPacket Type = 'ACK'></WPPacket>",
  "note": "Response to the 09:14 order on table 5; the request is in ../captured/..."
}
```

`kind` is one of `order_response`, `table_status_response`, `malformed`.

Adding a file here changes no production behaviour. It changes what the test
suite can honestly assert — and `assertCapturedEvidence` is the seam that says
which assertions those are.
