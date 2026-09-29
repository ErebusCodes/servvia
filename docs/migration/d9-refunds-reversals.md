# D9 implementation note: refunds, reversals and settlement revocation

Status: implemented 2026-09-29, tested against disposable databases only. Not applied to production; no client, adapter or provider is switched. The results are in [README.md](README.md#phase-d9-result).

## CURRENT (audited 2026-09-29)

| Where | What exists | D9 classification |
|---|---|---|
| NestJS API | **No refund or reversal code.** No Stripe refund call; the kiosk has no refund path (a card charged before a failed order is never returned: the stabilisation finding). Cancelling an order touches no money. | Nothing to port. |
| Legacy reservation `Payment` | `refundedAt`, `refundedById`, `refundAmountCents`, `refundReason`: never written by code. | Legacy, untouched. |
| `PaymentObservation` | `reversed` / `refunded` observation states for IdealPOS (fixture writer only). | External observation, not canonical. Not read. |
| Admin console | The "Refunded" badge is derived from `Order.status = cancelled`; it has no data behind it. | Unbacked presentation; not changed (no client cutover). |
| RBAC | `ManagerStepUpGuard` reserves manager step-up for "void/refund/discount". | Refund authority: owner, admin, manager. Not cashier. |
| D6 `CheckSettlement` | One row per check (`UNIQUE(checkId)`, `UNIQUE(settlingPaymentId)`); the check becomes `settled`. | Extended additively (below); no constraint dropped. |
| D7 `CashMovement` | `cash_sale` only; `paymentId` required and unique. | Gains `cash_refund`, linked to the refund. |

## Decisions

| Concept | Decision |
|---|---|
| **Refund vs reversal** | They have **different authority**, so both kinds are kept on one engine. A **refund** is requested by staff (card: the adapter reports the result; cash: staff hand the cash back under their shift). A **reversal** is originated by a trusted `payment_adapter` device when the provider reversed or cancelled an earlier card tender; there is no staff endpoint for it. One model, **`PaymentAdjustment`**, has `kind` = `refund` or `reversal`, so capacity, balance and settlement logic exist once and reporting can still tell them apart. |
| Adjustment | Payment, kind, amount (> 0), currency (= the payment's), status, version, idempotency key and request fingerprint, reason (refunds), requested-by staff (refunds), originating device (reversals), result reference (metadata only), resolvedAt. It always references one payment, never a check vaguely. |
| Status | The D6 state machine, reused: `pending` → `succeeded` \| `failed` \| `uncertain`; `uncertain` → `succeeded` \| `failed`. Final states are final: a conflicting result is 409, never last-write-wins. Uncertain is never retried or failed automatically. Card refunds start `pending`. Cash refunds and reversals are `succeeded` at creation: the staff member has handed the cash back, or the provider reports a fact. |
| History | `PaymentAdjustmentTransition`, append-only, with actor id and kind (staff or payment_adapter). `AuditLog` is written only for staff actors. |
| Refundable capacity | Per payment: `amount − Σ(adjustments succeeded, pending, uncertain)`. It is decided under the check row lock, then the payment row lock (the D6 order), and it applies only to a succeeded payment. Pending and uncertain adjustments **reserve** capacity, and a failed one releases it. |
| Effective paid | `Σ succeeded payments − Σ succeeded adjustments` (`payments.ComputeBalance`, extended once and used everywhere). Pending and uncertain adjustments are not money returned. D6 payment holds are unchanged. |
| **Settlement lifecycle** | `CheckSettlement` stays **the one current-settlement row per check** (no constraint dropped). It gains `status` (`settled`/`revoked`), `cycle`, `revokedAt` and `version`. New **`CheckSettlementTransition`**, append-only, records every `settled` and `revoked` event: its cycle, amount, triggering payment or adjustment, actor, and time. Existing settlements get their `settled` transition backfilled from their own row: the same fact, not a fabricated one. |
| Revocation | In the transaction of a succeeded adjustment: if the check is `settled` and effective paid < total, the settlement row becomes `revoked`, a `revoked` transition is appended, and the check returns to `open`. No table session changes. |
| Re-settlement | D6's `settleIfPaid`, extended: a success that makes effective paid equal the total on an `open` check either creates the settlement (cycle 1) or moves the existing revoked row to `settled`, with cycle + 1 and the new settling payment, plus a `settled` transition. It runs under the check lock, so it happens once per cycle. |
| Check status | `open` ⇄ `settled` as the balance changes; `voided` stays terminal. The status is the current projection; settlement transitions are the history. |
| Check void | **Now allowed after full neutralization:** no pending or uncertain payment, no pending or uncertain adjustment, and effective paid = 0 (every succeeded tender fully returned). Otherwise `CHECK_HAS_PAYMENTS`, as before. All rows are kept. It is checked under the check lock, which every money operation takes. |
| Cash refund | Only for a succeeded **cash** payment, by owner, admin or manager, under the actor's **open shift** (which may differ from the sale's shift; the sale's shift is never rewritten). One transaction: lock check → lock payment → capacity → lock shift → adjustment (succeeded) → transition → `CashMovement(cash_refund)` → revoke settlement if needed → audit. |
| CashMovement | Kind `cash_refund` added. The movement references the payment (`cash_sale`) **or** the adjustment (`cash_refund`), enforced by CHECK. The amount stays positive and the kind gives the direction. Expected cash = float + cash sales − cash refunds. Card refunds never touch cash. |
| Shift close vs cash refund | D7's lock: the refund holds the shift row `FOR UPDATE` while it records the movement, and the close takes the same lock. |
| Trust boundary | Staff: request refunds (`POST /payments/{id}/refunds`) and read. Adapter device of the payment's venue (D8): `POST /api/internal/payment-adapter/venues/{venueId}/refunds/{refundId}/result`, and `POST .../payments/{paymentId}/reversals`. KDS, POS, tablet, other-venue, revoked devices and staff JWTs are refused. |
| Visit completeness | The D6 query is extended: it is also not complete while any payment or adjustment of the visit's checks is pending or uncertain. |
| Not done | Provider SDKs, chargebacks/disputes, receipts, visit close, paid-in/paid-out, clients. |
