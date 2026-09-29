# D5 implementation note: checks

Status: implemented 2026-09-29, tested against disposable databases only. Not applied to production, and no client is switched. The results are in [README.md](README.md#phase-d5-result).

## CURRENT financial flow (NestJS, audited 2026-09-29)

| Step | Where | What exists |
|---|---|---|
| Order totals | `orders.service.ts` `resolveOrderItems`, `computeTotals` | Unit price = override or menu price, plus modifier deltas. Line = unit × quantity. Subtotal = the sum of the lines. `taxCents = round(subtotal × 3/23)`, `totalCents = subtotal` (NZ GST contained, DL-072; other profiles fail closed with 422). The only money columns are `subtotalCents`, `taxCents` and `totalCents`: no discount, tip, service charge or rounding. |
| Checkout / intent | kiosk only: `kiosk/stripe/*`, `verifyKioskPayment` | Stripe Terminal. The kiosk order is persisted with `paymentProviderTransactionId` once the intent succeeded for the server total. Staff and tablet orders carry no payment. |
| `Payment` model | `schema.prisma` | Tied to `Reservation`, and never read or written by code. |
| Payment observation | `PaymentObservation*` | Observes IdealPOS / EFTPOS (fixture-only writer). It is not a Servvia payment. |
| Bill / receipt | none | No Bill, Check, Invoice, Receipt or Tab model, and no receipt renderer. The Order Tablet "Bill" modal only displays the provisional total. |
| Close Table | `OrderTabletPage.tsx` | Moves each order to `completed` or `cancelled`. The reason ("Paid externally", "Complimentary"…) is not stored, and no money is recorded. |
| External POS payable | WaiterPad path | Sends no prices (`Total '0'`); "the till recomputes the bill". |
| Refund / cancel | none | No refund path. Cancelling an order touches no payment state. |
| Financial RBAC | `payment-observation.controller.ts`, `manager-step-up.guard.ts` | View: admin, manager, cashier. Acknowledge: admin, manager. Tablet and KDS identities are refused. Manager step-up is reserved for void, refund and discount. |

**Worth preserving (generic):**
- Integer cents.
- Server-computed totals.
- GST contained, computed on the subtotal (`pricing.ComputeTotals`).
- Fail-closed tax profiles.
- The priced order-line snapshot.

**Legacy transport, not ported:**
- IdealPOS payable totals, POS sync and payment observation
- The Stripe intent, `paymentProviderTransactionId` and EFTPOS state
- The unused Reservation `Payment` model

**Waits for D6:** tender, payment attempts, refunds, paid, settled and closed.

## Canonical (D5)

| Concept | Decision | Why |
|---|---|---|
| `Check` | One financial obligation: venue, optional table session, status, currency, subtotal/tax/total, version, idempotency key and request fingerprint, created by, void fields | The smallest model that later payment, settlement and receipts can reference. |
| `CheckLine` | A copy of an order line's accepted snapshot: title, quantity, unit and line totals, priced modifiers | Menu changes never alter an obligation, and nothing is re-priced. |
| Creation | `POST /checks` with **either** `tableSessionId` (every non-cancelled order of the visit) **or** `orderIds`, plus `idempotencyKey`. It bills every round line of those orders that no standing check holds. | Requests name entities, never money. Several orders per visit work, and takeaway needs no session. |
| Several checks per visit | Allowed: no unique rule on `(tableSessionId)` | Split bills can come later without a schema change. |
| Double billing | Partial unique index `CheckLine(orderItemId) WHERE voidedAt IS NULL`, plus locks on the orders (`FOR UPDATE`, the lock a round takes) | An order line is billed at most once. A concurrent round is wholly on the check or wholly left over. |
| Tax | `pricing.ComputeTotals` on the check subtotal | There is no second tax implementation. |
| Status | `open`, `voided` | No paid, closed or settled until D6 defines them. |
| Void | Only an `open` check, with a reason, by admin or manager. It releases the check's lines. | It is safe before Payment exists, because no money can be attached. It changes no order, ticket or session. D6 must refuse to void a check that has payments. |
| Later rounds | Not added to an existing check. They stay unbilled, and a further `POST /checks` bills them. | No workflow needs "append to check" today. **Rule for D6:** a check is a snapshot. Before taking payment for a visit, D6 must look for unbilled round lines (lines on no standing check) and must not treat one check as the whole visit. |
| Audit | `AuditLog` in the same transaction: `CHECK_CREATED`, `CHECK_VOIDED`. Replays and key conflicts are best-effort, as for orders. | Every check actor is a staff member, so the existing log fits. |
| Outbox | No event | D6 reads checks from PostgreSQL. An event without a consumer would be ceremony. |
| Authorization | Staff identities only. Create and read: owner, admin, manager, cashier. Void: owner, admin, manager. | This follows the repository's financial RBAC. KDS devices, the kitchen and viewer roles, and customer tablets are refused. |
| Legacy orders | Only Servvia Core orders (canonical `source`) can be billed | Nest-path orders are paid through their own (IdealPOS/Stripe) flows, and billing them here would create a second obligation. |

## Outbox note (D4 limitation, documented rather than redesigned)

`OutboxEvent.processedAt`, `attempts`, `availableAt` and `failedAt` belong to its **single consumer**, the kitchen projector. It claims only `order.round_submitted`. The outbox is not a multi-consumer, exactly-once bus. A second consumer of the same event type needs its own per-consumer progress record first. See [`contracts/events/README.md`](../../contracts/events/README.md).
