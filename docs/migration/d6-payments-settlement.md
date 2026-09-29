# D6 implementation note: payment and settlement

Status: implemented 2026-09-29, tested against disposable databases only. Not applied to production; no client, kiosk or payment device is switched. The results are in [README.md](README.md#phase-d6-result).

## CURRENT (audited 2026-09-29; the full financial audit is in [d5-checks.md](d5-checks.md))

| Path | What exists | D6 decision |
|---|---|---|
| Prisma `Payment` (+ `PaymentMethod`, `PaymentStatus`) | A reservation deposit (`reservationId @unique`, Stripe charge fields, refund fields). No runtime code reads or writes it. | **Legacy, not evolved.** Its one-per-reservation shape, Stripe columns and enum names do not fit a check payment. The canonical model is **`CheckPayment`**, with its own enums. `Payment` is documented as legacy, with a retirement path: drop it, or remap it to `ReservationPayment`, in a separately approved migration once reservation deposits are designed. No table is renamed. |
| Kiosk Stripe Terminal | `create-payment-intent` takes the client's amount. `kiosk/orders` verifies the intent succeeded for the server total, then stores `paymentProviderTransactionId`. **Defect:** a card charged before a failed amount check is never refunded. | Not ported, not fixed (stabilisation track). The lesson for the canonical model: the amount is validated **before** tender, and every tender is recorded, so money can never move with no record of it. |
| `PaymentObservation` | Observes IdealPOS/EFTPOS state (fixture writer only). | Not canonical truth. Not read by D6. |
| Refunds | None. Cancelling an order touches no payment. | Not implemented: no canonical semantics yet. The schema keeps every payment row, so a later refund/reversal can reference the payments it reverses. |
| Internal trust | `ServiceTokenGuard`: a Bearer service secret, constant-time compare, fail closed. | Same pattern for the payment-adapter result path, with **its own** secret. |
| Uncertain outcomes | Native rounds: `unresolved` is never auto-retried or auto-discarded; only an explicit resolution leaves it. | Same principle for `uncertain`. None of the native-round/IdealPOS concepts are ported. |
| D5 `Check` | `open` / `voided`, snapshot lines. | It gains `settled`. Void is refused while money may have moved. |

## Canonical model

| Concept | Decision |
|---|---|
| **`CheckPayment`** | One tender against one check: amount (> 0), currency (= the check's), tender type, status, version, idempotency key with a request fingerprint, requested-by staff, an optional opaque result reference (adapter metadata, never identity), and resolvedAt. There is no uniqueness on `checkId`: a check can have many payments. |
| Tender types | `card` only. **Cash is deferred.** Cash accountability needs Shift/cash-drawer ownership, which does not exist yet, and cash over-tender (change) is not modelled. The enum gains `cash` additively in that phase. |
| Status | `pending` (initiated, awaiting a result) → `succeeded` \| `failed` \| `uncertain`; `uncertain` → `succeeded` \| `failed` (reconciliation). `succeeded` and `failed` are final: a reversal will be its own record, never an edit. **Uncertain never becomes failed automatically, is never retried, and never settles.** |
| PaymentAttempt | **Omitted.** One payment is one tender instruction to one device. A retry after a definitive failure is a new payment with a new key. An unclear outcome is reconciled on the same payment, so an attempts table would add nothing today. |
| History | `CheckPaymentTransition`: every status change (including creation) with actor id and kind, and the result reference. The D4 kitchen reasoning applies: the adapter is not a Staff row, so `AuditLog` cannot hold it. |
| **Settlement** | Option A: a **`CheckSettlement`** entity, a durable fact. It records the check, the amount settled, the payment whose success completed it, the actor and the time. `UNIQUE(checkId)` means exactly once. It is written in the same transaction as the settling payment's success, which also moves the check to `settled`. A future reversal adds its own revocation record (and relaxes the index to "one unrevoked settlement"); nothing is deleted. |
| Balance | `paid` = sum of `succeeded` payments. `held` = sum of `pending` + `uncertain`. `balance` = total − paid. **`available` = total − paid − held.** A new payment must fit `available`, checked under the check's row lock. Money that may already be moving is held, so two concurrent tenders can never overpay, even if both succeed. |
| Overpayment | Refused at creation (`AMOUNT_EXCEEDS_AVAILABLE`). Because of the hold, a success can never exceed the total. |
| Check void | Refused while any payment is `pending`, `uncertain` or `succeeded` (`CHECK_HAS_PAYMENTS`). A check with only `failed` payments may be voided, because no money moved. A settled check cannot be voided. |
| Visit | Settling one check changes nothing about its table session or the visit's other checks. There is no visit settlement or automatic close in D6. **Invariant for the future close-visit workflow**, provided as a read-only query with a test ([`checks/visit-financially-complete.sql`](checks/visit-financially-complete.sql)): a visit is financially complete only when every standing check is `settled` **and** no accepted round line of its orders is outside a standing check. |
| Later rounds | They are never added to an existing check (D5), settled or not. They stay unbilled until a new check bills them, and they keep the visit incomplete. |
| Audit | Staff actions go in `AuditLog`, in the transaction (`PAYMENT_CREATED`, plus best-effort `PAYMENT_IDEMPOTENT_REPLAY` / `PAYMENT_IDEMPOTENCY_CONFLICT`). Every transition goes in `CheckPaymentTransition`, and settlement is its own row. Adapter results are not written to `AuditLog`, because there is no staff actor and no fake staff actor is invented. |
| Outbox | No payment events: nothing consumes them. The D4 outbox is untouched. |

## Trust boundary

| Who | May | Path |
|---|---|---|
| Staff: owner, admin, manager, cashier | Initiate a tender (`pending`); read payments and the balance | `POST/GET /api/venues/{venueId}/checks/{checkId}/payments`, `GET /api/venues/{venueId}/payments/{paymentId}` (staff JWT) |
| Trusted payment adapter (Venue Edge, later) | Report a result: `succeeded`, `failed` or `uncertain`, and reconcile `uncertain` | `POST /api/internal/payment-adapter/venues/{venueId}/payments/{paymentId}/result`, authenticated by `SERVVIA_CORE_PAYMENT_ADAPTER_TOKEN` (Bearer, constant-time). **The route does not exist unless the secret is configured.** Staff JWTs are not accepted there, and adapter tokens are not accepted on staff routes. **Superseded in Phase D8:** the global secret is retired; the route authenticates a per-venue `payment_adapter` Device ([d8-devices-terminals.md](d8-devices-terminals.md)). |
| KDS, kitchen, viewer, customer tablets | Nothing financial | Refused (403) |

No staff endpoint can mark a payment as succeeded.
