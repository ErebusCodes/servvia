# Table 5 two-round capture — live runbook

**Written:** 2026-09-04 evening (offline preparation; no till action performed).
**To be executed:** 2026-09-05, on site, after 11:30 AM, before service.
**Operator:** must be physically at the venue. Every till action below is done
by a human on the IdealPOS terminal. Nothing in this runbook automates the UI.
**Read-only:** the capture tooling issues `SELECT` statements only. It never
writes to IdealPOS, POSServer or IPSTransaction, never sends anything to any
IdealPOS port, and never changes printer routing. The only state change in the
whole procedure is the one the operator makes by hand on the till, which is an
ordinary table sale that is then closed normally.

---

## 1. What this establishes, and what it cannot

This is an **observation** exercise. It records what IdealPOS actually does to
its own data when a cashier runs a two-round table sale. It answers the
"what is observable" half of the integration question.

It does **not** answer what is *supported*. No amount of observation tells us
which interface Idealpos endorses for an external application, and we must not
build on an observed behaviour that the vendor has not sanctioned. The vendor
package (`../integrations/idealpos-native-table-assignment-vendor-question.md`)
carries that half, and must be sent independently.

### The premise this replaces

Until 2026-09-04 evening we believed native table sales were keyed by table
number in `IPSTransaction.PendingSales.Code`. That was wrong — see evidence
item B of the vendor package. The honest position going into tomorrow is:

> We do not know where an open native table sale lives, how it is keyed, or
> what identifier it exposes. Tables 1–19 exist and are used daily, yet no
> `PendingSales` row for any table exists in either database at rest.

The capture is therefore deliberately **unfiltered** on both `PendingSales`
stores. A filter built on a guess would return zero rows and waste the window.

---

## 2. Preconditions — check all before starting

| # | Check | How |
| --- | --- | --- |
| 1 | Restaurant not yet in service; Table 5 free and will stay free for ~20 min | Visual |
| 2 | Operator authorised to open, send and close a table sale on this till | Staff |
| 3 | Kitchen aware that up to **two KOTs will print for Table 5** and are to be discarded | Tell them first |
| 4 | Preflight passes | `.\idealpos-table-capture.ps1 -Preflight -NewRun -TableCode 5` → `verdict : READY` |
| 5 | No other table is open, and none opens mid-run | `posserver.TableMapSetups` all `Status 0` in the preflight output |

> **Item 3 is the only real-world side effect of this procedure.** Two live
> kitchen dockets will print. Do not run it during service.

### Choosing items A and B

Pick two **different, cheap, non-prepared** PLUs that go to a kitchen printer
(so the KOT actually fires). Write down their PLU codes before starting — the
analysis joins on `StockItems.Code`, which is what `PendingSaleLines.Col1`
holds. Do not use an item with modifiers or a set-menu component for this
first pass; keep the two rounds trivially distinguishable.

- Item A code: `________`  description: `________________`
- Item B code: `________`  description: `________________`

---

## 3. The sequence

Run each command, **then** perform the till action on the line below it, then
run the next command. Never run two captures without an action between them,
and never perform two actions without a capture between them — the whole
method rests on one action per delta.

Each capture takes a few seconds. Wait for `=== written to ... ===` before
touching the till.

```
cd C:\Users\Posmate\Documents\verdura_MVP\windows-deploy\ops
```

| Step | Command | Then, on the till |
| --- | --- | --- |
| 0 | `.\idealpos-table-capture.ps1 -NewRun -Step 00-baseline -TableCode 5` | *(nothing — this is the before picture)* |
| 1 | | **Open Table 5.** Assign guests as normal. Do not add anything yet. |
| 2 | `.\idealpos-table-capture.ps1 -Step 01-open -TableCode 5` | |
| 3 | | **Add item A** (qty 1). Do **not** send. |
| 4 | `.\idealpos-table-capture.ps1 -Step 02-add-A -TableCode 5` | |
| 5 | | **Send round 1** to the kitchen, the way staff normally do. |
| 6 | `.\idealpos-table-capture.ps1 -Step 03-send-R1 -TableCode 5` | |
| 7 | | **Re-open Table 5 and add item B** (qty 1). Do **not** send. |
| 8 | `.\idealpos-table-capture.ps1 -Step 04-add-B -TableCode 5` | |
| 9 | | **Send round 2.** |
| 10 | `.\idealpos-table-capture.ps1 -Step 05-send-R2 -TableCode 5` | |
| 11 | | **Close Table 5** normally (finish/pay as staff would). |
| 12 | `.\idealpos-table-capture.ps1 -Step 06-close -TableCode 5` | |

`-NewRun` appears **only on step 0**. Every later step joins the same run, so
the log deltas chain correctly. If you forget it, the steps still work but may
attach to yesterday's run directory — check the `run=` value printed by each
capture matches.

### Collect two physical facts the database cannot tell us

- After step 5: **keep the round-1 KOT.** Note whether it contains item A only.
- After step 9: **keep the round-2 KOT.** Note whether it contains item B
  **only**, or repeats item A.

Item B repeating item A would mean IdealPOS's own native send re-prints the
whole sale — which would settle question 7 in a way that changes the product
design, so capture it precisely. Photograph both dockets.

---

## 4. Analysis (offline, can be done later or off-site)

```
.\idealpos-table-capture-diff.ps1 `
  -RunRoot C:\ProgramData\Verdura\evidence\idealpos-table-capture\run-<stamp> `
  -All -OutFile table5-two-round-report.txt
```

The tool compares each consecutive pair on natural keys and prints only what
changed, plus the log bytes that action produced. It orders steps by capture
time, not by name.

**Control established 2026-09-04:** two captures 18 seconds apart across a
genuinely idle system produced *zero* data change in all 13 datasets and three
lines of POSServer heartbeat. So any row delta the report shows tomorrow is
attributable to the operator's action, not to background churn.

### What each delta is being asked

| Pair | Question it answers | Vendor Q |
| --- | --- | --- |
| `00-baseline → 01-open` | Where does an open table sale materialise — `IPSTransaction`, `POSServer`, both, neither? Under what `Code`/`Map`? Does `TableMapSetups` row 5 leave `Status 0`? Does `TableActivity` gain a row at open, or only later? | 1, 5 |
| `01-open → 02-add-A` | What does adding a PLU write? Is `Col4` the price **IdealPOS resolved** (compare to `ipstx.PriceConfig`), confirming we need not be the price authority? | 10, 11 |
| `02-add-A → 03-send-R1` | Which rows flip `Printed`? Does `OrderedTime` set at add or at send? What does `Printing.log` show? | 7, 8, 9 |
| `03-send-R1 → 04-add-B` | **Does round 2 append to the same sale ID, or create a second sale?** This is the load-bearing one. | 6 |
| `04-add-B → 05-send-R2` | Does the second send touch **only** the new line's `Printed`, or re-flip round 1? Cross-check against the physical KOT. | 7, 8, 15 |
| `05-send-R2 → 06-close` | Does the `PendingSales` row vanish? Does a `Transactions`/`TransactionsLine` row appear? Does `TransactionReference` gain its **first ever row**? Does *any* identifier survive the close? | 5, 13 |

Record answers into the vendor package's evidence appendix as **observed**
facts, clearly separated from anything the vendor confirms as **supported**.

---

## 4a. Read-model follow-up this run must unblock

`Reconciliation.SelectTableSale` matches a POSServer candidate on
`Code == requestedTable && Pos == 1`. It **does not look at `Map`**.

Tonight's measurement showed `Map` is exactly the column that separates a real
table-map sale from a takeaway or web ticket: ticket `343` and the `WBORD` web
rows all sit at `Map 0`, while the table map itself is `Map 1`. Observed ticket
numbers include **32**, so ticket numbers and table numbers occupy overlapping
ranges in principle. A takeaway ticket numbered 1–19 would therefore satisfy
`SelectTableSale` and be treated as that table's sale — attaching a Verdura
order to the wrong party's bill, which is the exact failure that class exists
to prevent.

Tightening the match to require `Map == 1` is the obvious fix, and it is
**deliberately not being made tonight**, because we have never observed an open
table sale and so cannot yet assert which `Map` one carries. The `01-open`
capture settles it:

- If the open Table 5 sale appears in POSServer at `Map 1` → add `Map == 1` to
  the match, with `ConfirmsRequestedTable` rejecting anything else.
- If it appears at some other `Map`, or does not appear in POSServer at all →
  the current cross-store reconciliation rests on a false premise and needs
  redesign, not a patch.

Either way, do not ship a change to this matching logic until the capture says
which. Note also that `POSServer.PendingSales` currently holds `ID 99408,
Code '0', Map 1, POS 1` with zero lines — check in `01-open` whether that row
is rewritten in place when a table opens, or whether a new row is inserted
alongside it. That distinction decides whether a stored POSServer ID is ever
meaningful, and `PosServerReadRepository` already assumes it is not.

---

## 5. Abort and rollback

**Abort if:** a real customer needs Table 5; the kitchen is not expecting the
dockets; a capture reports `query error(s)`; or the diff report warns that the
IdealPOS process set changed between steps (a component restarted, and
in-memory conclusions across that boundary are unsafe).

**Rollback:** the only artefact is one ordinary Table 5 sale. If you abort
mid-sequence, close or void it through the normal till workflow exactly as
staff would for a mistaken order. There is nothing else to undo — the capture
tooling wrote nothing. The evidence directory can be deleted or kept; a
partial run is still worth analysing for the steps it did complete.

**If the sale must be voided rather than paid,** capture a `06-void` step
instead of `06-close` and label it plainly. Void and close are different
lifecycle paths and must not be recorded as the same evidence.

---

## 6. After the run

1. Run the diff, read the report.
2. Update evidence items in the vendor package with what was observed —
   including anything that contradicts a current assumption, which is the
   most valuable outcome the run can produce.
3. Send the vendor package. It must go from an account authorised on this
   installation; this engineering environment has no authenticated Idealpos
   support channel. Until Idealpos answers, no observed behaviour here is
   approved for production use.
