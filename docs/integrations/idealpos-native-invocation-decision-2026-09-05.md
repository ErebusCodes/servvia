# Native invocation — decision document

**Written:** 2026-09-05, after the live Table 5 two-round capture closed.
**Method:** offline only. Re-reading already-extracted decompiles and string
dumps plus the committed capture evidence. **No IdealPOS process, database,
COM object, socket or file was touched.** Nothing was invoked.

**The objective, stated narrowly:**

> Find the supported path by which an external application can reproduce
> `PLU entry → TABLE MAP → Table N → native pricing → append later round →
> new-lines-only KOT`, while obtaining enough causal identity/idempotency
> evidence for Verdura to know that a particular submitted round produced a
> particular native line delta.

**Verdict unchanged:** `NOT PRODUCTION READY — native IdealPOS two-round
behavior is proven, but Verdura still lacks a supported native invocation path
and causal reconciliation/idempotency mechanism.`

---

## 1. The architecture, corrected by today's evidence

The live run showed something the static analysis had not: **`IPSTransaction`
(SQL Server) `PendingSales` never changed at any step**, while POSServer gained
and repeatedly re-created the sale. Re-reading `IPS.exe` explains it.

```
IPS.exe  ── native table sale ──┐
   GetSingleTableToServerMessage(LineCount=…)
   SendTableDatatoServer   →  ~TABLEDATA   ┐
   SendNewlinesToServer    →  ~NEWLINES    ├──►  POSServerClient  ──►  POSServer (SQL)
   SetPrintedFlags  … WHERE Code=…         ┘   (a downstream representation)
   ~SENDSTAT (table status)                ┘
```

Supporting strings, verbatim:

```
0x002bd7a0  GetSingleTableToServerMessage LineCount=
0x002bd860  ~TABLEDATA
0x00317b4c  ~NEWLINES
0x0031613c  SendTableDatatoServer
0x003160f4  SendNewlinesToServer
0x0036a410  SetPrintedFlags - could not find PendingSaleLines with Code=
0x002bd51c  SELECT Count(Code) AS TotalWebOrders FROM PendingSales WHERE Code LIKE 'WB*'
```

Three consequences, each grade-marked:

1. **POSServer behaves as a downstream/native table-state representation in
   this observed workflow, and `IPS.exe` demonstrably serialises native table
   data to POSServer. `POSServer.PendingSales.ID` is therefore unsuitable as
   durable identity. The authoritative upstream store/mechanism is not yet
   proved.**
   **STRONGLY SUGGESTED** for the representation claim; the ID finding itself is
   **PROVED**. `IPS.exe` serialises a whole table
   (`GetSingleTableToServerMessage LineCount=`) and pushes it as `~TABLEDATA`,
   with a separate `~NEWLINES` path for incremental lines. That matches the
   observed behaviour from the other end: the sale re-appearing under four
   surrogate IDs with byte-identical content and frozen `DateModified` — a
   representation rewritten wholesale by a producer whose own store we have not
   observed.

2. **The inspected `IPS.exe` SQL syntax is consistent with Jet/Access semantics
   and makes an Access-backed upstream store a strong candidate, but the actual
   authoritative pending-sale store has not yet been demonstrated.**
   **SUGGESTED.** `WHERE Code LIKE 'WB*'` is Jet/Access wildcard syntax, not
   T-SQL (`%`). `SetPrintedFlags` operates on `PendingSaleLines WHERE Code=` —
   keyed by **Code**, not by a surrogate ID. The SQL-Server
   `IPSTransaction.PendingSales` we captured is a different store and stayed
   inert all day. What none of that shows is *which* store the strings are
   executed against, or whether the pending sale is durably stored at all before
   it reaches POSServer.

3. **`Printed` is set upstream by `Code`, before the row reaches POSServer.**
   **STRONGLY SUGGESTED**, and it explains the live observation that every
   POSServer line arrived already `Printed=True` with zero printer-log bytes.
   Which store carries that upstream write is part of the open question in (2).

**This reframes the integration target.** Reading durable identity from
POSServer was never going to work — not because the ID churns alone (that is a
symptom), but because **POSServer holds a rewritten representation produced by
the native engine**. Any supported path must enter the native IdealPOS
table-sale engine/workflow rather than writing POSServer directly. Whether that
supported entry point is `IPS.exe` itself, a handheld subsystem, VariPad, or
another vendor-supported interface remains unresolved.

## 2. Candidate reassessment against the observed workflow

**Nothing below was invoked.** This is a paper comparison of already-decompiled
contracts against the field-level result captured this afternoon.

### 2.1 Field-for-field

Observed POSServer result (the downstream representation) as the reference:

| Observed field | Value seen | VariPad `WPPacket` | WaiterPad protocol | `IKM.API` `IOrder`/`IItem` |
| --- | --- | --- | --- | --- |
| `PendingSales.Code` | `'5'` | **`<Table>`** ✓ | `Table` (ORDER packet) ✓ | `IOrder.Code` (docket only) |
| `PendingSales.Map` | `1` | **absent** ✗ | `Map` present in `ips.exe` log (`Table <n> and Map <m>`), not in the packet we can see | **absent** ✗ |
| `PendingSales.POS` | `1` | absent | absent | `IOrder.POS` |
| `PendingSales.ClerkID` | `1` | **`<Clerk>`** ✓ | `Clerk` ✓ | `IOrder.Server` (string) |
| `PendingSaleLines.Col1` (PLU) | `23` / `511` | **`<StockItem>`** ✓ | `StockItem` ✓ | `IItem.StockCode` ✓ |
| `Col2` (description) | `Lemon slice` | `<Description>` ✓ | ✓ | `IItem.ItemDescription` ✓ |
| `Col3` (qty) | `1` | **`<Quantity>`** ✓ | ✓ | `IItem.Quantity` ✓ |
| `Col4` (price) | `1.5` / `6` | **`<Price>-9999</Price>`** — sentinel ✓✓ | ✓ | `IItem.SaleAmount` (mandatory, unused in-assembly) |
| `Col5` | `1` | `<PriceLevel>1</PriceLevel>` — **plausible, unconfirmed** | ✓ | — |
| `Col6` | `1` (ours) / `0` (Table 10) | absent | absent | — |
| `SeatNumber` | `0` | **`<Seat>`** ✓ | ✓ | `IItem.Seat` ✓ |
| `Line` (ordinal) | `1,2,3` | `<OrderItem Index="">` — **always empty string** ✗ | — | `IItem.Line` ✓ |
| **`OrderedTime`** (round key) | `13:16:49` / `14:07:37` | **absent** ✗ | **absent** ✗ | **absent** ✗ |
| `Printed` | `True` on arrival | absent | absent | — |
| `TableMapSetups.GuestsSaved` | `1` | `<Guests>` — hardcoded `0` ✗ | ✓ | `IOrder.Adults`/`Children` |
| **causal external reference** | **none exists** | `<DeviceID>` (empty in adapter) | `DeviceID` + `Checksum` | `identifier` GUID (sender-generated) |

### 2.2 Six required properties

| Property | VariPad file drop | WaiterPad TCP | `IKM.API` |
| --- | --- | --- | --- |
| table number | ✅ `<Table>` | ✅ | ⚠️ `IOrder.Code`, docket-side only |
| round / order identifier | ❌ none | ❌ none | ⚠️ sender-generated GUID, echoed only |
| PLU + quantity | ✅ | ✅ | ✅ |
| native-price sentinel | ✅ **`-9999`** | ✅ same packet shape | ⚠️ `SaleAmount` mandatory, no sentinel seen |
| acknowledgement / correlation ID | ❌ file-consumption only | ⚠️ **ACK/NAK only** (`parsing ORDER but HandheldProcessing set - sending NAK back`) | ⚠️ `OrderAck{id, discarded}` — echoes the sender's own GUID |
| append / reorder semantics | ❌ not expressed | ❓ unresolved — see §2.3 | ⚠️ `POSOrderOperation{DeleteLine, ReplaceLine}` exists but is **never read** in the assembly |

### 2.3 The sharpest unresolved risk: append vs replace

Today's native UI path **appends** and preserves prior lines byte-for-byte,
including their `OrderedTime`, and prints only the new round. **PROVED.**

But `IPS.exe`'s handheld ingress routine contains:

```
DELETE * FROM PendingSaleLines WHERE Code='…'
DELETE * FROM PendingSales     WHERE Code='…'
…
Handheld Order successfully added to Pending Sales.
```

Two readings, and we cannot distinguish them offline:

- **(a)** the handheld packet carries only the new round, and the delete is
  scoped/staged such that prior lines are re-written unchanged — matching the
  native UI; or
- **(b)** the handheld packet must carry the **entire** table sale, and the
  delete-then-insert **flattens `OrderedTime` across all lines** — which would
  destroy round partitioning *and*, if `Printed` resets, **reprint the whole
  table on every round**.

**Reading (b) is a correctness catastrophe for a restaurant** — the kitchen
would receive the full table again on each round. This is now the single most
important question to put to the vendor, and it is **not answerable without
either documentation or an authorised test**.

Note this cuts against the natural assumption that the handheld path is "the
same thing staff do". It may not be.

### 2.4 Ranking

**B. `VariPad.dll`'s file drop is the closest structural match to the observed
workflow** — and it is the only candidate that carries a *native-price
sentinel*, which is precisely the property the observed workflow depends on
(IdealPOS resolved `1.5000`/`6.0000` itself, no price supplied by anyone).

It is closest on: table number, PLU, quantity, price sentinel, clerk, seat.
It fails on: no round identifier, no `OrderedTime`, no line ordinal
(`Index` is always `""`), no `Map`, no acknowledgement carrying native
identity, and **no expressed append semantics**.

WaiterPad TCP is the same packet family with a live ACK/NAK and a native
`DeviceID`+`Checksum` duplicate guard (`Exiting.  DUPLICATE ORDER!`) — a better
*idempotency* story, a worse *accessibility* story (licence-gated at
`DataArrival`, entitlement unknown).

`IKM.API` remains **not an ingress at all** and is not a candidate.

**None is promoted. All remain `locally identified native ingress candidate`.**

---

## 3. A. What exact supported interface information is still missing

1. **Is there a supported external order-entry interface at all**, and if so
   which: Ideal Handheld/WaiterPad TCP, the VariPad file drop, or something not
   present on this installation?
2. **Licence entitlement.** `HandheldLicences` / `Handheld / eCommerce Only`
   gate `WaiterPad_DataArrival`. Does this venue hold it? What does it cost?
3. **Append semantics — §2.3.** Does a second handheld order for an open table
   *append* new lines, or *replace* the whole sale? Does `OrderedTime` survive?
   Does `Printed` survive, so only new lines print?
4. **Is `Price = -9999` the documented "POS determines price" sentinel**, and is
   supplying a real price ever required or honoured?
5. **Does any response carry a native sale identifier or line identifiers?**
   Everything found locally is ACK/NAK or an echo of the sender's own key.
6. **Is there a supported read-back interface** to fetch a table's current line
   set with `OrderedTime` and `Printed`, so a submitted round can be reconciled
   against a native delta?
7. **Where is the authoritative pending sale held** (§1) — `ips.mdb`, or
   somewhere else entirely? — and is any supported interface offered over it, or
   is it strictly internal?
8. **The exact `Map` value** an external submission must supply for the table
   map, and whether it is ever anything but `1`.
9. **`~SENDSTAT` / `~TABLEDATA` / `~NEWLINES`** — are these documented, and is
   POSServer's protocol supported for third-party consumption?

## 4. B. Which local candidate most closely matches

**`VariPad.dll`'s file drop**, on structural match and on the price sentinel.
See §2.4. WaiterPad TCP is the same packet family with better idempotency
primitives and a licence gate. Neither is promoted; neither was invoked.

## 5. C. What can be implemented safely before vendor confirmation

All of the following are vendor-independent, additive, and cannot cause a
native side effect.

1. **The `OrderRound` domain model** — already committed
   (`apps/api/src/orders/rounds/order-round.model.ts`, 49 tests). Today's
   evidence *validates* its shape: rounds partition by time, prior rounds are
   immutable, only new lines are sent.
2. **The Prisma migration steps 1–4** from the implementable design (create
   `OrderRound`, the `nativeSale*` columns, nullable `OrderItem.orderRoundId`,
   the partial unique index and payload-freeze trigger, the backfill, and
   service-layer writes) — every one is reversible and behaviour-neutral while
   each session still has exactly one round.
3. **Tablet round-state UI** built on server-issued round identity, per the
   tablet design. It changes only Verdura-side behaviour.
4. **A `nativeSaleMap` column and `Map`-aware reconciliation *reads***, since
   `Map=1` vs `Map=0` is now proved to separate table sales from web tickets.
5. **Recording native observation as tiered evidence** (`correlated` /
   `causal`), with today's fields — `Code`, `Map`, `OrderedTime`, line ordinal —
   stored as **reconstruction evidence only**.
6. **Extending the read-only capture harness** to cover the candidate upstream
   store(s), so a future authorised run can establish where the sale actually
   lives. Read-only, offline-buildable.

## 6. D. What must remain blocked until vendor confirmation

1. **Any external write to IdealPOS by any mechanism** — WaiterPad socket,
   VariPad file drop, COM, or direct DB. No exceptions.
2. **Migration step 5** — relaxing `POSSyncRecord.orderId @unique`. It is the
   point of no return and admits more than one delivery per order; it must not
   land before the append mechanism is confirmed supported.
3. **Any path to `synced`.** Fail-closed stands. No causal identity exists;
   finding 11 of the live run proves no correlating field exists anywhere in the
   native model.
4. **Using `PendingSales.ID` as native sale identity.** Disproved today — four
   IDs for one sale, once with no action on the table.
5. **Treating `Code` + `Map` + `OrderedTime` as causal Verdura identity.** They
   are native reconstruction evidence. A second legitimate Table 5 sale would
   reproduce all three.
6. **Promoting WaiterPad or VariPad to `vendor-supported integration surface`.**
7. **Any change to `SelectTableSale`.** Its `Pos != 1` filter is vindicated and
   its `Map` omission is a demonstrated defect — but fail-closed makes it
   non-confirming either way, so there is no reason to edit live matching logic
   on one capture.

---

## 7. The one-line summary

We now know exactly what the native workflow does, and exactly which fields it
does and does not expose. **The blocker is no longer "what does IdealPOS do" —
it is "what is Verdura permitted to call, and what will it get back".** Both
halves of that are vendor questions, and §3 is the list.
