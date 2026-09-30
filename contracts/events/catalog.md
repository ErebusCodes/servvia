# Canonical fact catalog

**NEW SERVVIA-NATIVE (Phase D12).** This is the single definition of each canonical Servvia fact: its name, meaning and fields.

Two delivery mechanisms carry facts. Neither is the definition.

- **Realtime** (`RealtimeEvent`): every fact below, delivered to WebSocket subscribers. Protocol: [`../realtime/servvia-realtime.md`](../realtime/servvia-realtime.md). Payload schemas: [`../realtime/servvia-realtime.schema.json`](../realtime/servvia-realtime.schema.json).
- **Outbox** (`OutboxEvent`, D3/D4): only `order.round_submitted`, for the kitchen projector. Its payload has the same fields as the realtime payload, plus the projector's input (`venueId` and `lines[]`). Its progress columns (`processedAt`, `attempts`, `availableAt`, `failedAt`) belong to that one consumer. Nothing else reads or writes them.

Every fact is recorded **in the transaction of the change it announces**. A replayed request, a refused request or a no-op change records nothing, the same rule as for AuditLog.

AuditLog is not a fact source: it is staff accountability, not an event bus.

| Fact | Aggregate (`version`) | Recorded when | Payload | Streams |
|---|---|---|---|---|
| `table_session.opened` | table_session (yes) | A visit is opened at a table | `tableSessionId, tableId, tableNumber, status, covers` | operations |
| `table_session.closed` | table_session (yes) | A visit is closed; financially complete (D10) | same | operations |
| `table_session.cancelled` | table_session (yes) | A visit opened in error is cancelled | same | operations |
| `order.created` | order (null) | An order is accepted; its round 1 exists | `orderId, roundId, tableSessionId, tableNumber, takeawayReference, serviceMode, source, status` | operations |
| `order.round_submitted` | order (null) | A round is accepted, **including round 1** | `orderId, roundId, sequence, tableSessionId, serviceMode, source` | operations |
| `kitchen_ticket.created` | kitchen_ticket (1) | The projector creates a ticket for a round's station. A re-projection creates no fact. | `ticketId, orderId, roundId, roundSequence, station, status, tableNumber, takeawayReference` | kitchen, operations |
| `kitchen_ticket.transitioned` | kitchen_ticket (yes) | A ticket changes status | `ticketId, orderId, station, from, to` | kitchen, operations |
| `check.created` | check (1) | Lines are billed | `checkId, tableSessionId, orderIds, status, currency, subtotalCents, discountCents, totalCents` | financial |
| `check.voided` | check (yes) | An open check is voided | `checkId, tableSessionId, status` | financial |
| `check.settled` | check (yes) | Successful payments cover the total (D6); again after a revocation (next cycle) | `checkId, tableSessionId, status, settlementId, cycle` | financial |
| `check.settlement_revoked` | check (yes) | Money returned leaves the check owing (D9). **The visit is not reopened.** | `checkId, tableSessionId, status, settlementId, cycle` | financial |
| `payment.created` | payment (yes) | A tender is initiated (card: pending; cash: succeeded) | `paymentId, checkId, status, tenderType, amountCents, currency` | financial |
| `payment.status_changed` | payment (yes) | The adapter reports a result | `paymentId, checkId, status, from` | financial |
| `refund.created` | refund (yes) | A refund is requested (card: pending; cash: succeeded) | `refundId, paymentId, checkId, status, amountCents, currency` | financial |
| `refund.status_changed` | refund (yes) | The adapter reports a card refund's result | `refundId, paymentId, checkId, status, from` | financial |
| `reversal.recorded` | reversal (yes) | The adapter reports a provider reversal (final when recorded) | `reversalId, paymentId, checkId, status, amountCents, currency` | financial |
| `shift.opened` | shift (1) | A staff member opens a cash shift | `shiftId, status, terminalId` | financial |
| `shift.closed` | shift (yes) | A shift is counted and closed. Cash figures are read over HTTP. | `shiftId, status, terminalId` | financial |
| `promotion.created` | promotion (yes) | A promotion is configured (inactive) | `promotionId, status` | operations |
| `promotion.updated` | promotion (yes) | Its terms change. The terms themselves are read over HTTP. | `promotionId, status` | operations |
| `promotion.activated` | promotion (yes) | It becomes applicable | `promotionId, status` | operations |
| `promotion.disabled` | promotion (yes) | It stops applying to new orders | `promotionId, status` | operations |

Deliberately not facts (yet): table-session covers changes, device and terminal administration (no operational subscriber), D8 credential rotation (never published), and order status changes by the NestJS path (Nest's own `orderUpdate`).
