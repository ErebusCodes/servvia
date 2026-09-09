# WaiterPad acceptance runbook

Everything needed to finish the live Order2 acceptance test **in about two
minutes**, the moment a handheld licence seat is free.

Read `docs/integrations/idealpos-waiterpad-CHECKPOINT.md` first. Nothing here
is wired into the application: the module tree still cannot open a socket, and
`waiterpad-gate.ts` is untouched. These are operator tools, run by hand.

## Status as of 2026-09-09 14:20

The test was **authorised, attempted, and refused** — twice, in ~310 ms, with
`NAKREGO`. Neither send touched a sale. The blocker is not code:

```
20260909 14:15:10.568    VERDURA-ACCEPT-20260909-0001 - WP Current Count=2 - Waiters=2
20260909 14:15:10.608    BAD REGO
```

Two licence seats, both taken. One is wasted on a phantom that registers with
`DeviceID` and `LocalAddress` both literally `undefined` — the iPad app
registering before it knows its own identity — a few seconds before the real
iPad registers. See `WAITERPAD-LICENCE-001`.

## Step 0 — free a seat (operator, required)

The phantom seat clears when `IPS.exe` restarts. **Do not restart during
trade.** After the restart, confirm a seat is actually free before spending the
window:

```bash
ssh -i ~/.ssh/verdura_front_evidence_ed25519 USER@192.168.1.199 \
  "powershell -NoProfile -Command \"Select-String -Path 'C:\ProgramData\Idealpos Solutions\Idealpos\LOGS\Ideal Handheld.log' -Pattern 'Current Count' | Select-Object -Last 1 | ForEach-Object { \$_.Line }\""
```

Proceed only if it reads `Current Count=1 - Waiters=2` or lower. At
`Count=2 - Waiters=2` the test will be refused again and nothing is learned.

If the phantom reappears immediately after restart, that is itself the finding:
the venue can never hold two real handhelds, and the seat must be bought rather
than reclaimed.

## Step 1 — registration probe (no sale is touched)

```bash
node scripts/waiterpad-acceptance/make-payloads.mjs /tmp/wp
node scripts/waiterpad-acceptance/wp-send.mjs /tmp/wp/test.payload /tmp/wp/t
```

- `ACK` → a seat was granted. Continue.
- `NAKREGO` → still no seat. **Stop.** Do not send the order.

## Step 2 — one order, once

```bash
node scripts/waiterpad-acceptance/wp-send.mjs /tmp/wp/order.payload /tmp/wp/o
```

One line, `$3.00`, table 99, `SkipKitchen=1`. Table 99 is chosen so that no
real customer's bill can be touched; `SkipKitchen=1` is chosen so the kitchen
does not fire if the order lands. Both are deliberate.

**`wp-send.mjs` sends exactly once and never retries.** If the response is
ambiguous — timeout, connection lost, a NAK that may belong to a fragment —
that ambiguity is the result. Do not send it again. A NAK is *not* proof of
rejection: on 2026-09-04 a NAK arrived for a trailing fragment of an order that
had already been accepted and printed (`WAITERPAD-FRAMING-001`).

## Step 3 — read back what actually happened

```bash
ssh -i ~/.ssh/verdura_front_evidence_ed25519 USER@192.168.1.199 \
  "powershell -NoProfile -Command \"Get-Content -LiteralPath 'C:\ProgramData\Idealpos Solutions\Idealpos\LOGS\POSWorker.log' -Tail 30\""
```

Then the same for `Ideal Handheld.log`, `POSActivity.log`, `Printing.log`.

What each answers:

| Look for | Answers |
|---|---|
| `ProcessHandheldOrder … Table 99` in `POSWorker.log` | the order was durably processed |
| `` `IH99 `` line rows, and the price on them | **`WAITERPAD-PRICE-001`** — whether the till trusts the sent `3.00` or re-resolves it from `StockItems` |
| `SendToKitchen` / a `KitchenPrinter_*.Dat` | whether `SkipKitchen=1` actually suppresses the kitchen (unobserved in all 42 genuine packets — it is always `0`) |
| `CheckHandheldMessages data=` `` `IH99 `` in `POSActivity.log` | the POS terminal saw the round |
| gap between the ACK and `ProcessHandheldOrder` | confirms `WAITERPAD-ACKLOSS-001` on our own traffic |

## Step 4 — clean up

Void the table 99 tab on the POS. It is a real pending sale even though table
99 is not a real table.

## Afterwards

Record the outcome in the checkpoint with the usual grading, and update the
blocker register in `waiterpad-round-state.ts`. Do **not** move
`DisabledTableRoundWriter`/`waiterpad-gate.ts` on the strength of one accepted
order: acceptance alone does not close `WAITERPAD-CHECKSUM-001`,
`-DUPGATE-001`, `-ACKLOSS-001`, `-FRAMING-001` or `-RECON-001`, and exactly-once
still has to be carried entirely on Verdura's side.
