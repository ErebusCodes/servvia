# Table 5 two-round live capture — result

**Run:** `run-20260905-125814`
**Evidence:** `C:\ProgramData\Verdura\evidence\idealpos-table-capture\run-20260905-125814\`
**Date:** 2026-09-05, 12:58–14:09 NZST. Venue in service; other tables operating.
**Method:** SELECT-only capture harness (`0b2f50a`), plus three ad-hoc read-only
SELECTs and one `netstat`. **No DB write, no protocol traffic, no COM
instantiation, no UI automation, no deploy, no push.** Every IdealPOS action
was performed by a human operator on the till.

**Verdict:** `NOT PRODUCTION READY — native IdealPOS behavior is now proven to
support the required two-round same-table / new-lines-only KOT workflow, but
Verdura still lacks a locally identified supported native write path and causal
native identity/idempotency mechanism to invoke and reconcile that workflow
safely.`

---

## 1. Steps captured

| Step | Time | Human action |
| --- | --- | --- |
| `00-baseline` | 12:58:14 | — |
| `00b-select-only` | 13:02:11 | selected Table 5 (no occupy) |
| `00c-clean-preadd` | 13:11:54 | — |
| `01-add-A-unassigned` | 13:14:37 | added PLU 23 on sale-entry screen, no table |
| `02-send-R1-table5` | 13:18:03 | TABLE MAP → Table 5 (~13:16) |
| `02b-concurrent-observation` | 13:34:22 | — (other-table activity observed) |
| `03-pre-recall` | 13:38:11 | — |
| `03b-recalled` | 14:02:56 | Table Map → Table 5 → Details |
| `04-add-B-unsent` | 14:06:14 | POS → added PLU 511 ×2, not sent |
| `05-send-R2` | 14:08:41 | normal save/send back to Table 5 (14:07) |

Zero query failures in every step. All 8 IdealPOS processes healthy with
unchanged PIDs throughout.

**Test items:** A = PLU `23` Lemon slice, qty 1, $1.50, PrintPend1.
B = PLU `511` MUHALLEBI, qty 2, $6.00 each, PrintPend1. Chosen by staff.

## 2. The native workflow, as staff actually perform it

Corrected on site — there is no pre-occupy step:

```
sale-entry screen → enter items → TABLE MAP → select table   (creates/updates the sale)
later:  Table Map → select table → Details → POS → add items → TABLE MAP → select table
```

## 3. Final state of the Table 5 sale

```
POSServer.PendingSales
  ID=99724  Code='5'  Map=1  POS=1  ClerkID=1  DateModified=13:16:52
  Customer/Status/Label/OrderDate/ReadyForPayment = NULL

POSServer.PendingSaleLines
  Line 1  Col0=SI  Col1='              23'  Col2='Lemon slice'  Col3=1  Col4=1.5
          Col5=1  Col6=1  Printed=True  SeatNumber=0  ClerkID=1  OrderedTime=13:16:49
  Line 2  Col0=SI  Col1='             511'  Col2='MUHALLEBI'    Col3=1  Col4=6
          Col5=1  Col6=1  Printed=True  SeatNumber=0  ClerkID=1  OrderedTime=14:07:37
  Line 3  Col0=SI  Col1='             511'  Col2='MUHALLEBI'    Col3=1  Col4=6
          Col5=1  Col6=1  Printed=True  SeatNumber=0  ClerkID=1  OrderedTime=14:07:37
```

`Col1`/`Col2` are space-padded — any matching logic must trim.

## 4. Physical KOT evidence — operator-observed, recorded separately from `Printed`

| | Round 1 | Round 2 |
| --- | --- | --- |
| Docket count | **1** | **1** |
| Table shown | Table 5 | Table 5 |
| Contents | 1 × Lemon slice | **2 × MUHALLEBI only** |
| Prior round repeated | — | **No** |
| Duplicate | **No** | **No** |

**In both rounds `IPSPrinterServer.LOG` and `Printing.log` recorded 0 bytes**,
while `Printed=True` was written for every line at creation. The physical
dockets are the *only* evidence that anything was emitted. This is the live
confirmation of the static finding: **`Printed=True` is written by the sale
path, not by the printer path.**

## 5. Final native-control result

- **Round 1:** Table 5, 1 × Lemon slice, one physical KOT.
- **Round 2:** the **same** native Table 5 sale, 2 × MUHALLEBI **appended**, one
  new physical KOT containing **only Round 2 items**.
- **Prior Lemon line preserved and not reprinted** — same line ordinal, same
  `Col4`, same `Printed`, same `OrderedTime`, byte-for-byte.
- **No duplicate KOT observed.**
- **POSServer surrogate sale ID changed repeatedly and is unsuitable as a
  durable causal anchor.**
- **No observed native field binds the sale or round to an external Verdura
  identity.**

## 6. Findings, graded

### PROVED

1. **The native table sale first exists only at TABLE MAP → table selection.**
   Adding items on the sale-entry screen wrote **nothing** to any of the 13
   datasets — no sale, no line, no sequence. Confirmed twice: before the table
   existed (`01-add-A-unassigned`) and while it already existed
   (`04-add-B-unsent`). **An unsent round has no durable native representation.**
2. **Selecting a table, and recalling it via Details, write nothing.** Three
   consecutive idle captures and the recall step all showed zero structural
   change.
3. **The sale is created in POSServer only.** `ipstx.PendingSales` (47) and
   `ipstx.PendingSaleLines` (332) never changed at any step.
4. **`Code = '5'`** — the bare table number — and **`Map = 1`** for a table-map
   sale, against `Map = 0` for the web/takeaway rows including Verdura's
   `WBORD`.
5. **`POS = 1` on the sale**, directly observed, although the operating till
   header reads POS 2 and every `Transactions` row is POS 2. IdealposBridge's
   `SelectTableSale` filter `row.Pos != 1 → skip` is therefore **correct**.
   (`ClerkID` and `LocationSold` also held `1`; their semantics are not
   established and they are **not** evidence for this.)
6. **Round 2 appends to the same sale.** One sale, lines 1–3.
7. **Round 1's line survived byte-for-byte** across the Round 2 send.
8. **Send acts only on new lines** — in the DB fields and, per §4, in the
   physical docket.
9. **Quantity 2 is represented as two qty-1 lines**, not `Col3=2`. `Col4=6.00`
   per line.
10. **`TableMapSetups` is keyed `Code`(map) / `ItemType` / `ItemIndex`.** Table 5
    is `1 / 3 / 5`; the 19 real tables are `ItemType 3`, `ItemIndex 1..19`.
    **`Caption` is empty for every table row** — `ItemIndex` is the identifier,
    not `Caption`.
11. **No causal correlation field exists** anywhere in what was captured.
    Nothing in `PendingSales`, `PendingSaleLines`, `TableMapSetups`,
    `TableActivity` or `~SENDSTAT` references an external order.
12. **`TableActivity` gained no row at any step**, including table open. It is
    written at some other point.
13. **`TransactionsLine` `TypeID=21`: `Text` is literally `"Table {Code}"`** —
    40/40 historical instances agree. The two fields are internally consistent.

### STRONGLY SUGGESTED

14. **The sale is delete-and-rewritten rather than updated in place.** It was
    represented under four IDs — `99719 → 99721 → 99723 → 99724` — with
    identical content and identical `DateModified`/`OrderedTime` each time,
    including once with **no Table 5 action at all**. The exact mechanism is
    **not established**, and no claim is made that any particular other-table
    activity caused it.
15. **IdealPOS is price authority in the native path.** `Col4` matched the
    configured Level-1 price exactly for both PLUs (`1.5000`, `6.0000`) with no
    price supplied by anyone. Untested under external input, because no
    external write was attempted.
16. **`~SENDSTAT` structure.** Observed sequence:
    ```
    R1  ~SENDSTAT 1 5 [05 Sep 2026 13:16:53] 8 010
    04  ~SENDSTAT 1 5 [05 Sep 2026 13:16:53] 8 010 4
    04  ~SENDSTAT 1 5 [05 Sep 2026 13:16:53] 2 010 4
    R2  ~SENDSTAT 1 5 [05 Sep 2026 13:16:53] 2 010 [05 Sep 2026 14:07:37] 4
    R2  ~SENDSTAT 1 5 [05 Sep 2026 13:16:53] 8 010 [05 Sep 2026 14:07:37] 4
    ```
    Map `1`, table `5`, the table `StartTime`, a digit tracking
    `TableMapSetups.Status` exactly (8/2/8), then `010`, then — once Round 2
    exists — a second timestamp equal to Round 2's `OrderedTime`, then `4`.
    `010` and the trailing `4` are **not decoded**.
17. **`TableMapSetups.Status`**: `0` idle → `8` on send → `2` when the sale is
    opened at POS → `8` on the next send. `Amount` stayed `0.0000` throughout
    despite a $13.50 sale. `GuestsSaved` was `1` while the UI displayed "4
    Covers".

### NOT ESTABLISHED / withdrawn

18. **That `Code`+`Map`+`POS`+`DateModified`+`OrderedTime` constitute a durable
    or causal identifier.** They are useful **reconciliation observations**. A
    second legitimate Table 5 sale could reproduce every one of those
    dimensions. Do not treat them as identity.
19. **The origin of three concurrent `Transactions` rows.** Cons `90746`
    (`Table 18`, $28.75), `90747` (`Table 18`, $45.00) and `90748`
    (`Table 10`, $21.00) each appeared within one second of one of our actions
    and contain **none of our items**. Our Table 5 sends produced no
    identifiable `Transactions` row. **Unrelated to our items; origin otherwise
    unresolved.** Not pursued further, and nothing depends on it.
20. **`#90746` displayed on the unassigned sale screen.** It existed in no
    dataset at the time it was displayed, and the value was subsequently
    consumed by an unrelated transaction. Not called a sale, docket or
    transaction ID.
21. **`Col3 > 1` behaviour.** The native UI split qty 2 into two qty-1 lines, so
    the `Col4` unit-vs-extended ambiguity was **sidestepped structurally, not
    answered**. No row with `Col3 > 1` was produced.

## 7. The two questions that decide the integration

### Q10 — reconciliation

> **Enough for deterministic native line-delta reconstruction inside this
> observed Table 5 sale: yes.**
> **Enough for deterministic causal reconciliation to a Verdura round: no.**

The line set is fully reconstructible and cleanly partitionable by
`OrderedTime`. What is missing is any field tying either partition to a Verdura
order or round.

### `OrderedTime` — what it is, and what it is not

**`OrderedTime` is an observed native round-partitioning field. It is not an
idempotency key.** It partitions a sale's lines into the rounds the native UI
displays (13:16:49 and 14:07:37 here, matching the "Ordered 01:16pm" and
"Ordered 02:07pm" sections). It carries no external reference, is not unique,
and must never be used to deduplicate a submission.

## 8. What this does and does not change

**It does** establish, from live evidence rather than inference, the exact
native semantics a supported integration would have to reproduce: create at
table assignment, append on subsequent sends, leave prior lines untouched,
emit one KOT per round containing only that round's items.

**It does not** show that Verdura can invoke any of it. Every action was a human
on the till. The two blockers are unchanged and now sharper:

1. **No locally identified supported native write path.** See
   [`idealpos-native-ingress-2026-09-05.md`](../integrations/idealpos-native-ingress-2026-09-05.md)
   — `IKM.API` is not an ingress; the Ideal Handheld / WaiterPad family remains
   a `locally identified native ingress candidate` with unproved support status.
2. **No causal native identity or idempotency mechanism.** Finding 11 makes this
   concrete: there is no field to correlate on, and finding 14 disqualifies the
   one surrogate that looked usable.

**Table 5 was left open** with both rounds sent, for normal staff handling. No
close, pay, void, delete, cancel or transfer was performed. Table 10 — live
customer activity throughout — was read-only and never touched.

---

<!-- ─────────────────────────────────────────────────────────────────────── -->
> ## POST-TEST CLEANUP — NOT EVIDENCE
>
> **This section is outside the experiment. It records an operator action taken
> after the run closed, for accounting hygiene. It is not a capture step, it is
> not part of `run-20260905-125814`, and it changes no finding, grade or verdict
> above.**
>
> After `05-send-R2` (captured 14:08:41) and after all analysis was complete,
> the operator deleted/voided the Table 5 test sale — 1 × Lemon slice and
> 2 × MUHALLEBI, total $13.50 — through the **normal authorized IdealPOS staff
> workflow**, and confirmed Table 5 returned to **Ready**.
>
> Deliberately **not** done: no capture step was taken of the cleanup, and no
> diff was run against post-cleanup state. Folding cleanup into the evidence
> chain would blur operator housekeeping with test observation, which is the
> exact confusion this run's step discipline exists to prevent.
>
> The findings above rest entirely on the ten snapshots taken between 12:58:14
> and 14:08:41, which are immutable on disk and committed. The live native
> experiment is **closed**.
<!-- ─────────────────────────────────────────────────────────────────────── -->
