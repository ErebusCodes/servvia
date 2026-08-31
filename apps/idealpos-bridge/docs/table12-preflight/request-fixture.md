# Table 12 controlled-experiment request fixture

Version-controlled template for the ONE controlled order tomorrow's session
submits. Values marked `<<VERIFY-ON-WINDOWS>>` cannot be determined from
this macOS preflight — they require the real Idealpos database/UI and must
be confirmed (Phase 0 of the runbook) before this fixture is filled in and
sent.

## Why placeholders, not invented PLUs

No product code, table Caption/Code, or price in this file is real. Every
`101002`-style code that appears anywhere in this repo's `README.md` /
`examples/` is a documentation example, not a value observed on any real
Idealpos install this session had access to. Do not submit this fixture
until every `<<VERIFY-ON-WINDOWS>>` placeholder below has been replaced
with a value read directly from the target machine's own `TableMapSetups`
and `GetIpsStockItemsDic()`/stock-item table (see `evidence-queries.sql`
and `GET /api/tables` / `GET /api/products`).

## The exact request

```http
POST /api/orders HTTP/1.1
Host: <<BRIDGE_HOST>>:<<BRIDGE_PORT>>
Authorization: Bearer <<BRIDGE_API_KEY>>
Content-Type: application/json

{
  "externalOrderId": "VERDURA-TABLE12-PREFLIGHT-<<ISO8601-TIMESTAMP>>",
  "table": "<<VERIFY-ON-WINDOWS: TableMapSetups.Caption for the table you intend to test — see table-assignment-review.md for why this may NOT be the literal string \"12\">>",
  "items": [
    {
      "productCode": "<<VERIFY-ON-WINDOWS: a real StockItem code from GET /api/products>>",
      "quantity": 1
    }
  ],
  "notes": "VERDURA CONTROLLED INTEGRATION TEST — table12-preflight-2026-08-19 — DO NOT FULFILL — void/cancel via Idealpos UI after evidence capture"
}
```

### Field-by-field rationale

| Field | Value | Why |
|---|---|---|
| `externalOrderId` | `VERDURA-TABLE12-PREFLIGHT-<timestamp>` | Unique per attempt. Also the bridge's own idempotency key (`Orders/OrderStateStore.cs` primary key) — reusing it is the Phase 6/replay test, not the first submission. |
| `table` | placeholder | **Do not assume `"12"` is correct.** The bridge validates this against `TableMapSetups.Caption` (a string), but the table-assignment strategies write it into `WebOrder` fields whose relationship to `PendingSales.Code` (expected to share `TableMapSetups.Code`'s — an *integer* — identifier space per this repo's own investigation comments) is the whole open question this experiment exists to resolve. Run `evidence-queries.sql`'s `0a_table_lookup.sql` first and use whatever value that returns for `Caption`. |
| `items[0].productCode` | placeholder | Must be a code that exists in `GetIpsStockItemsDic()` on the target machine right now — validated bridge-side (`OrderValidator.cs`) and will be rejected (400) otherwise. Use a low-value/disposable test item if the venue's menu has one; otherwise any real item is fine since this order is never fulfilled or paid. |
| `items[0].quantity` | `1` | Smallest quantity; nothing about this experiment needs more. |
| `notes` | fixed test-marker string | Unmistakable in the Idealpos UI/DB that this is a controlled test, not a real customer order — include this exact string (or your own equally unambiguous marker) every time. |
| (absent) payment | — | No payment field exists in this API at all (`Orders/OrderModels.cs`'s `OrderRequest` has no payment-related property) — there is structurally nothing to omit. Confirmed by reading the full request DTO. |

## Expected response-state progression

Poll `GET /api/orders/{externalOrderId}` or subscribe to `GET /ws/orders`
(`Authorization` header, or `?api_key=` for the WebSocket handshake only).
Expected states, in order, each with what it does and does NOT prove (see
`README.md` "Order lifecycle" for the authoritative table):

1. **`201` immediate response**, `status: "submitted_to_idealpos"`. Proves
   only that `LocalDataHelper.InsertOrders()` did not throw — NOT that a row
   exists yet, NOT that Idealpos will process it. (Confirmed 2026-08-19:
   the real method returns `void`, so this is genuinely the ceiling of what
   this step alone can prove.)
2. **`pending_idealpos_processing`** — `WebPendingOrder` row confirmed
   present (`Processed=0`). This is the first REAL evidence a row exists.
3. **`processed`** — `WebPendingOrder.Processed` confirmed flipped to `1`.
   This is REAL evidence native Idealpos consumed the row. Does NOT yet
   prove table assignment.
4. **`assigned_to_table`**, `tableMatchesRequest: true|false` — a
   `PendingSales` row was found and correlated (via `Reference`, or the
   unfiltered-recent fallback — see `evidence-queries.sql`).
   `tableMatchesRequest: true` means `PendingSales.Code` equals the
   `table` you requested — check this field explicitly, don't infer it
   from the state name alone.
5. Then confirm **in the real Idealpos UI** (not just the API) that Table
   12 (or whichever table you tested) shows active with the submitted item.

### Possible non-happy-path outcomes — do not treat these the same

- **`400 validation_failed`** — table or productCode placeholder wasn't
  replaced with a real value, or wasn't verified fresh. Fix the fixture,
  don't retry blindly.
- **`200` with `"duplicate": true`** — same `externalOrderId` submitted
  twice. Expected and safe on the Phase 6 replay step; unexpected on the
  FIRST submission (means you reused an id from a previous run — pick a
  fresh timestamp).
- **`502 idealpos_submission_failed`** — `InsertOrders()` itself threw.
  Real, confirmed failure. Check `detail` in the response and the bridge's
  own log file before retrying with a NEW `externalOrderId`.
- **`status: "uncertain"`** (only reachable after ~`OrderStaleTimeoutMinutes`,
  default 15 min) — the watcher stopped waiting without proof either way.
  Read `lastError` on the status response: it states exactly which stage
  was last confirmed (e.g. "WebPendingOrder.Processed=1 was confirmed").
  **Never** resubmit under a new `externalOrderId` after an `uncertain`
  result without first checking the Idealpos UI/DB directly for a
  duplicate — see `evidence-queries.sql`'s duplicate-detection query.
- **`status: "rejected"`** — the `WebPendingOrder` row disappeared before
  `Processed=1`. Per this bridge's own investigation, this matches a
  confirmed native corrupted-record cleanup path, not a business rejection
  — worth a fresh look at the row's shape/encoding if it happens.
