# WaiterPad acceptance runbook

Everything needed to finish the live acceptance **in about ten minutes**, once
Verdura has its own handheld licence seat.

Read `docs/integrations/idealpos-waiterpad-CHECKPOINT.md` first. The application
is wired to `DisabledTableRoundWriter` and nothing here runs on its own; these
are operator tools, run by hand.

## Status

The test was **authorised, attempted, and refused** on 2026-09-09 — twice, in
~310 ms, with `NAKREGO`. Neither send touched a sale.

```
20260909 14:15:10.568    VERDURA-ACCEPT-20260909-0001 - WP Current Count=2 - Waiters=2
20260909 14:15:10.608    BAD REGO
```

**The only remaining live gate is a handheld licence seat.** Everything else
that could be settled without another live order has been.

## Step 0 — a seat, the right way

Two seats are licensed and both are taken. One is wasted on a phantom: the iPad
app registers with `DeviceID` and `LocalAddress` both literally `undefined`
before it knows its own identity, a few seconds before registering properly, and
that registration is never released.

**Preferred fixes, in order:**

1. **Report the phantom to Idealpos** and have the client fixed. The evidence
   summary is in the checkpoint under *Vendor issue*. This is the real fix: it
   returns a seat the venue has already paid for.
2. **Licence a third seat.** Verdura needs its own regardless of the phantom —
   it is a third device.

An IPS restart in a maintenance window clears the phantom temporarily. That is a
workaround for testing, **not** the production architecture, and it must never
happen during trade.

Do **not** work around this by borrowing an identity. `waiterpad-device-identity.ts`
refuses the iPad's DeviceID and `undefined` outright, and that refusal is tested.

### Confirm a seat is actually free before spending the window

```bash
ssh -i ~/.ssh/verdura_front_evidence_ed25519 USER@192.168.1.199 \
  "powershell -NoProfile -Command \"Select-String -Path 'C:\ProgramData\Idealpos Solutions\Idealpos\LOGS\Ideal Handheld.log' -Pattern 'Current Count' | Select-Object -Last 1 | ForEach-Object { \$_.Line }\""
```

Proceed only if it reads `Current Count=1 - Waiters=2` or lower — or a higher
`Waiters` if a seat was purchased. At `Count=N - Waiters=N` the test will be
refused again and nothing is learned.

## A. Verify the seat with a non-mutating Test

```bash
node scripts/waiterpad-acceptance/make-payloads.mjs /tmp/wp
node scripts/waiterpad-acceptance/wp-send.mjs /tmp/wp/test.payload /tmp/wp/t
```

## B. Require ACK before sending any order

- `ACK` → a seat was granted. Continue.
- `NAKREGO` → still no seat. **Stop.** Do not send an order.

## C. Choose a safe table

Use a table that is **not in service**. The generated order targets **table 99**
so that no real customer's bill can be touched. If 99 is a real table at this
venue, edit `make-payloads.mjs` before running.

## D. Record the current product price

Before sending, note the till's price for PLU 251 (`Coke No Sugar -- can 330ml`).
Step J compares against it.

## E. Snapshot the before-state

```bash
ssh ... "powershell -NoProfile -Command \"Get-Content -LiteralPath 'C:\ProgramData\Idealpos Solutions\Idealpos\LOGS\POSWorker.log' -Tail 5\""
```

Repeat for `Ideal Handheld.log`, `POSActivity.log`, `Printing.log`.

## F. Generate through the production codec

`make-payloads.mjs` builds every payload with `serialiseOrder2`, so the bytes on
the wire are the bytes the application would send. It emits three:

| payload | pricing | what it proves |
|---|---|---|
| `test.payload` | — | registration only, mutates nothing |
| `order.payload` | **sentinel `-9999`** | the production path: the till resolves the price |
| `order-explicit.payload` | explicit `3.00` | the iPad's path, for comparison |

`order.payload` is the one that matters. It carries `<Price>-9999</Price>` and
`<PriceLevel>1</PriceLevel>`, which static analysis says makes the receiver read
the price from `StockItems.Price1` instead of believing us.

## G. Send once

```bash
node scripts/waiterpad-acceptance/wp-send.mjs /tmp/wp/order.payload /tmp/wp/o
```

**`wp-send.mjs` sends exactly once and never retries.** If the result is
ambiguous — a timeout, a reset, or a NAK — that ambiguity **is** the result.

**N. Do not resend.** A NAK is not proof of rejection: on 2026-09-04 a NAK
arrived for a trailing fragment of an order that had already been accepted and
printed (`WAITERPAD-FRAMING-001`). Resending it would have double-charged the
table.

## H. Read the native after-state

```bash
ssh ... "powershell -NoProfile -Command \"Get-Content -LiteralPath 'C:\ProgramData\Idealpos Solutions\Idealpos\LOGS\POSWorker.log' -Tail 30\""
```

| Look for | Answers |
|---|---|
| `ProcessHandheldOrder … Table 99` | the order was durably processed |
| the gap between our ACK and that line | confirms `WAITERPAD-ACKLOSS-001` on our own traffic |

## I. Verify the kitchen (K O T)

`SendToKitchen Code=`IH99` in `POSWorker.log`, then a `KitchenPrinter_*.Dat` in
`Printing.log`. The production writer always sets `SkipKitchen=0`: a round the
kitchen never sees is a round the customer never receives.

## J. Verify the price — the one that settles `WAITERPAD-PRICE-001` live

Compare the price on the `` `IH99 `` line against the price recorded in step D.

- **matches the till's own price** → the sentinel was honoured, as static
  analysis predicts. Production stays on `nativeResolved`.
- **shows `-9999`, or the line is rejected** → the sentinel is NOT honoured on
  this build. Switch `IDEALPOS_WAITERPAD_PRICE_POLICY` to `explicit` **and**
  re-open `WAITERPAD-PRICE-001`, because Verdura would then own pricing and the
  menu must be proven in sync before go-live.

Optionally send `order-explicit.payload` to a second test table and confirm the
till takes `3.00` verbatim.

## K. Verify the table

The kitchen docket should read `TABLE 99`, and the round should appear on table
99's tab — not on any other table, and not as a separate sale.

## L. Verify reconciliation

Read back the duplicate-token row. This is the strongest causal signal available
and the thing `waiterpad-reconciliation.ts` is built around:

```sql
SELECT Data FROM AAAExampleData WHERE ColumnType = 'IH-<Verdura DeviceID>'
```

It should equal the `<Checksum>` from the payload we sent. If it does, an
ambiguous send can be reconciled by reading this row, and
`reconcileAmbiguousSend` returns `confirmed` on exactly that basis.

Also answer the questions in `RECONCILIATION_OPEN_QUESTIONS`, especially:
**is the token row written before or after the sale becomes durable?** If
before, a stored token proves receipt but not application, and the predicate
needs a second condition.

## M. Optional — the Seat test

Only after the above passes. Set `IDEALPOS_WAITERPAD_ALLOW_NON_ZERO_SEAT=true`,
send one order with `Seat=1`, and check whether the seat survives onto the
native line. All 412 genuine items carry `Seat 0`, so this has never been
exercised on this till (`WAITERPAD-SEAT-001`).

If the seat is ignored or the line is rejected, leave the flag off: the writer
then **refuses** a non-zero seat rather than silently sending 0.

## Clean up

Void the table 99 tab on the POS. It is a real pending sale even though 99 is
not a real table.

## Afterwards

Record the outcome in the checkpoint and update the blocker register. Do **not**
switch `IDEALPOS_WAITERPAD_NATIVE_ENABLED` to `true` on the strength of one
accepted order: acceptance closes none of `-ACKLOSS-001`, `-FRAMING-001`,
`-DUPGATE-001` or `-RECON-001`, and exactly-once is still carried entirely on
Verdura's side.
