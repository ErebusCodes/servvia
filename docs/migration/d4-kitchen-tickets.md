# D4 implementation note: kitchen tickets

Status: implemented 2026-09-29, tested against disposable databases only. Not applied to production, and no client or printer switched. The results are in [README.md](README.md#phase-d4-result).

## CURRENT (legacy NestJS path, audited 2026-09-29)

| Concern | Where | What it does |
|---|---|---|
| Kitchen state | `Order.status` (`OrderStatus`) | The KDS moves the whole order along the linear `pending → confirmed → preparing → ready → completed` chain, with `cancelled` from any non-terminal status (`orders.service.ts` `validateOrderStatusTransition`). There is no way back, so recall is impossible. |
| KDS mutation | `PATCH /api/admin/orders/:id/status` | Roles admin, manager, cashier, kitchen (owner implied), so a `kds_device` token can change `Order.status` and can also cancel. |
| Per-item state | none | `OrderItem` has no status. Both KDS UIs (`apps/window-display/src/pages/KdsPage.tsx`, `apps/web/admin-console/src/pages/kitchen/KitchenDisplayPage.tsx`) hold item readiness only in React memory. |
| Kitchen hand-off | `orders.service.ts` order transaction | Writes one `KdsDeliveryRecord` per order (a push backstop, swept every 5 s) and one `PrinterJob` per active `Printer`. The printer jobs are suppressed when IdealPOS prints the KOT. |
| Routing | none | No station, course or prep model. `Category` and `MenuItem` have no kitchen or printer field. Every active printer gets the whole order. The admin-console "station" is a client-side regex on item names, for display only. |
| Realtime | `orderUpdate` socket event | Carries the whole `Order` row. There are no item or ticket events. |
| Servvia Core (D3) | `OutboxEvent` `order.round_submitted` | Written in the round's transaction and never consumed. `processedAt` is always null. |

## Canonical (D4)

| Concept | Canonical owner | Notes |
|---|---|---|
| What the kitchen must prepare | `KitchenTicket` (one per round per station) and `KitchenTicketLine` (one per order line) | Projected from `order.round_submitted`. Snapshots of the line (title, quantity, modifiers, notes, seat), so a ticket survives menu changes. |
| Kitchen progress | `KitchenTicket.status`: `new → acknowledged → preparing → ready → completed`, and `completed → recalled → preparing / ready / completed` | **Separate from `Order.status`.** D4 never writes `Order.status`. |
| Kitchen history | `KitchenTicketTransition` | Records every change with the actor. It is not `AuditLog`, because `AuditLog.actorId` must be a Staff row and a KDS device is not one. |
| Routing | `kitchen.Router`, server-side | Today `SingleStation{"kitchen"}`: the repository holds no product→station data, and legacy sends everything everywhere. The ticket key is `(roundId, station)`, so adding a data-driven router later changes no schema. |
| Projection | `kitchen/pgstore.Projector` (in the Go API process, only when writes are enabled) | See the guarantees below. |

### Guarantees

- **One transaction per event.** It claims the event (`FOR UPDATE SKIP LOCKED`), writes the tickets and lines, and stamps `processedAt`. A crash leaves the event unprocessed, and it is projected again later.
- **Idempotency is in the database.** `UNIQUE (roundId, station)` on the ticket and `UNIQUE (orderItemId)` on the line. With `ON CONFLICT DO NOTHING`, a replay or a concurrent projection of the same round creates no second ticket and no second line.
- **Bounded retry.** A failure is recorded on the event: `attempts`, `lastError`, and `availableAt` with exponential backoff. After the attempt limit, `failedAt` parks the event, which is never silently dropped.

### Out of scope, unchanged

These are not done in D4 and the legacy code is untouched:

- Physical printers, `PrinterJob`, `KdsDeliveryRecord` and the current React KDS
- Realtime ticket events
- Line-level status, void and cancellation
- Check and Payment
- Tickets for orders created by the Nest path, which writes no outbox event
