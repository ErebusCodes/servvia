# Events: starting inventory

> **Phase D12:** the canonical facts are now defined once in
> [`catalog.md`](catalog.md).
> **Phase D13:** they are stored in Servvia Core's generic event log,
> `DomainEvent`, with per-consumer progress in `EventDelivery`; see
> [below](#servvia-core-domain-events-and-workers-phase-d13). The inventory
> that follows describes the NestJS-era mechanisms, which remain as they are,
> and the D3/D4 outbox, which is now legacy.

**Servvia currently has no event bus.** A search of `apps/api/src` for `EventEmitter`, `@OnEvent`, `kafka`,
`nats` and `pubsub` found nothing. `apps/api/package.json` has no event-emitter, Kafka or NATS dependency.

Asynchronous work happens in three ways:
- **BullMQ job queues on Redis.** The queues are `emails`, `print-jobs` and `pos-sync` (`apps/api/src/queue/processors/`). These are internal work queues, not published events.
- **One Socket.IO push channel.** See [`../realtime/orders-socket.md`](../realtime/orders-socket.md).
- **Durable outbox-style tables.** A row is written in the same transaction as the business change, and a timer-driven dispatcher later claims it with a compare-and-set and delivers it.

Those outbox tables are the **de facto domain events** today. Future event contracts should start from this inventory.

| Table (Prisma model) | Written when | Status enum (Source) | Dispatcher (Source) | Delivers to |
|---|---|---|---|---|
| `PrinterJob` (`apps/api/prisma/schema.prisma:978`) | An order needs a kitchen or receipt ticket | `PrintJobStatus`: `queued, printing (unused legacy), accepted, dispatching, delivered, printed, manual, uncertain, failed, cancelled, connector_dispatched` (`schema.prisma:142-161`) | `apps/api/src/printer/printer-dispatcher.service.ts` (`sweepDispatch` `:135`, `sweepReconcile` `:424`; env `PRINTER_DISPATCH_*` `:86-90`), plus the BullMQ `print-jobs` processor `apps/api/src/queue/processors/print-jobs.processor.ts` | A network printer directly, or a `ConnectorCommand` of type `printer.print_kot.v1` via the venue agent |
| `KdsDeliveryRecord` (`schema.prisma:1323`) | Every order, created in the order-creation transaction (`apps/api/src/orders/orders.service.ts:1820-1834`) | `KdsDeliveryStatus`: `queued, pushed, cancelled, exhausted` (`schema.prisma:174-179`) | `apps/api/src/orders/kds-dispatcher.service.ts` (`sweepDispatch` `:120`; env `KDS_DISPATCH_*` `:52-56`) | Socket.IO `orderUpdate` to `venue:{id}:orders` and `venue:{id}:kds`. There is no acknowledgement. |
| `POSSyncRecord` **(legacy IdealPOS)** (`schema.prisma:1035`) | Order created for a venue with a POS adapter configured | `POSSyncStatus`: `not_synced, queued_for_connector, submitted_awaiting_confirmation, synced, failed, not_applicable, unsupported, owned_by_native, cancelled` (`schema.prisma:37-…`) | `apps/api/src/pos-sync/pos-sync-dispatcher.service.ts` (`sweep` `:139`, BullMQ `pos-sync`) and `apps/api/src/pos-sync/idealpos-order-dispatcher.service.ts` (`sweepDispatch` `:272`, `sweepReconcile` `:720`) | A `ConnectorCommand` (`idealpos.submit_order.v1` or `idealpos.native_table_round.v1`) to the venue agent. It is legacy under `docs/adr/0001-servvia-is-the-operational-pos.md`. |
| `ConnectorCommand` (`schema.prisma:1538`) | Created by a producer through `ConnectorCommandService.createCommand` | `ConnectorCommandStatus`: `pending, claimed, accepted, succeeded, failed, expired, unknown, cancelled` (`schema.prisma:245-254`) | Pulled by the agent through `POST /api/connector/commands/poll`. Timeouts are handled by `apps/api/src/connector/connector-command-sweeper.service.ts` → `ConnectorCommandService.sweep()` | The venue agent (HTTPS pull). See [`../schemas/connector-command-state-machine.md`](../schemas/connector-command-state-machine.md) and [`../openapi/connector-protocol.yaml`](../openapi/connector-protocol.yaml). |

The four tables share these patterns:
- **Claims:** a compare-and-set on the row, with a lease (`dispatchClaimId`/`dispatchClaimExpiresAt`, or `claimedByInstallationId`/`leaseExpiresAt`).
- **Budgets:** a bounded attempt budget with a terminal "exhausted" or "expired" state.
- **Honest statuses:** no status claims more than the evidence supports. For example, `pushed` and `delivered` do not mean received, and `accepted` does not mean executed.
- **Timers:** each dispatcher runs on a `setInterval` that is disabled under `NODE_ENV=test`.

The audit log (`AuditLog`, `action` strings such as `CONNECTOR_COMMAND_*` and `UPDATE_ORDER_STATUS`) is the other durable record of state changes. It is written best-effort and has no dispatcher. Each row names its actor truthfully (Story 12.15): `actorType` is `staff` (a named staff member, with the device they acted through if any), `device` (`deviceKind`, plus `deviceId` when a device record exists; a KDS venue-PIN screen has none) or `system` (`systemActor`). A database CHECK constraint enforces each shape, and rows are immutable (a trigger rejects UPDATE; foreign keys restrict deletion of the staff member, venue and organization they name).

## Servvia Core outbox (`OutboxEvent`, Phases D3 and D4) — legacy since D13

> **Since D13 nothing writes `OutboxEvent`.** New rounds are recorded in
> `DomainEvent` and delivered to the `kitchen_projector` work consumer. The
> legacy projector loop below only drains rows written before D13; the table
> is retired (with approval) once none is left unprocessed. It is described
> here as it was.

The first canonical event table. It has no IdealPOS, connector or KDS transport fields. A row is written in the same transaction as the change it announces.

| Event type | Written by | Payload | Consumer |
|---|---|---|---|
| `order.round_submitted` | `services/core-platform/internal/orders/pgstore`, in each order creation (round 1) and each further round | `orderId`, `roundId`, `sequence`, `venueId`, `tableSessionId`, `serviceMode`, `source`, `lines[]` (`lineId`, `menuItemId`, `title`, `quantity`, `modifiers`, `notes`, `seat`) | The kitchen projector (`internal/kitchen/pgstore.Projector`, Phase D4). It turns the round into one `KitchenTicket` per station (see [`../openapi/kitchen-tickets.yaml`](../openapi/kitchen-tickets.yaml)). |

How the projector consumes an event:
- **Reads canonical rows.** The payload only names the round. The projector reads the `Order`, `OrderRound` and `OrderItem` rows, so a consumer never trusts a stale snapshot.
- **Claim and project.** In one transaction it claims the row with `FOR UPDATE SKIP LOCKED`, writes the tickets, and stamps `processedAt`. Concurrent workers take different events.
- **Idempotency.** It comes from unique indexes: `KitchenTicket (roundId, station)` and `KitchenTicketLine (orderItemId)`. Re-projecting an event writes nothing new.
- **Retry.** Each failure adds 1 to `attempts`, records `lastError`, and moves `availableAt` forward with exponential backoff (1 s doubling, capped at 5 min).
- **Parking.** After 10 attempts, or at once for an event that can never succeed (for example, its round no longer exists), `failedAt` parks the event for an operator. It is never dropped.

**Limitation: the outbox is not a multi-consumer bus.** `processedAt`, `attempts`, `availableAt` and `failedAt` are the progress of the **one** consumer of `order.round_submitted`, the kitchen projector.
- **No exactly-once delivery.** The guarantee is "at least once, and idempotent by unique keys".
- **A second consumer** of an existing event type must not reuse those columns. It needs its own per-consumer progress record, added additively.
- **Other event types** are not claimed by the projector.
- **D5 checks and D6 payments and settlements write no outbox event.** Nothing consumes one yet, and PostgreSQL is the source of truth for them. Since D12 they record realtime facts (`catalog.md`) in a separate log, `RealtimeEvent`, which has no consumer-progress columns: each Core instance tails it with its own in-memory cursor. It is not a second use of `OutboxEvent`.

## Servvia Core domain events and workers (Phase D13)

One durable fact log with independent consumers. Decisions and audit: [`../../docs/migration/d13-outbox-workers.md`](../../docs/migration/d13-outbox-workers.md). Migration: `apps/api/prisma/migrations/20261009000000_domain_events`.

- **`DomainEvent`** is the fact (envelope and catalog in [`catalog.md`](catalog.md)). It is written by `events/pgstore.Record` **in the transaction of the change**, organization and venue derived from `Venue`. It carries **no consumer progress**.
- **`EventDelivery`** is one consumer's progress on one event: `status` (`pending`, `succeeded`, `failed`), `attempts`, `availableAt`, `leaseOwner` / `leaseExpiresAt`, `lastError`, `succeededAt` / `failedAt`. One row per (event, consumer) (unique), created with the event for every consumer subscribed to its type (`internal/events`). One consumer's success never marks another's.
- **Work consumers** run in `internal/workers`. Claim: `FOR UPDATE SKIP LOCKED`, then a lease (default 1 min) and `attempts + 1`. Processing re-locks the delivery, **checks the lease is still this worker's**, runs the handler in the same transaction and marks success. A crashed worker's lease expires and the delivery is claimed again. Failure: backoff `min(1 s × 2^(attempts−1), 5 min)`; a permanent error or 10 attempts → `failed` (dead letter, kept and inspectable, `workers.Retry` resets it explicitly). Shutdown releases in-flight deliveries.
- **Delivery is at least once**; a handler must be idempotent by `eventId` or by unique keys. No ordering is promised.
- **Broadcast readers** (the realtime dispatcher) tail `DomainEvent` in commit-safe `(txId, sequence)` order with an in-memory cursor. They have no delivery rows.
- **Retention:** an event older than `SERVVIA_CORE_EVENT_RETENTION` (7 days) is pruned only when every delivery succeeded.
- **Backlog:** `GET /api/admin/workers` (owner or admin, staff login) returns per consumer pending, retrying, leased and failed counts and the oldest pending age, for the organization of the verified token only (across its venues). No payloads, errors or ids.

| Consumer | Subscribes to | Handler | Idempotency |
|---|---|---|---|
| `kitchen_projector` | `order.round_submitted` | `internal/kitchen/pgstore.Projector.Handle` (D4 projection logic) | `KitchenTicket (roundId, station)`, `KitchenTicketLine (orderItemId)`; `sourceEventId` is the event id |

**Not events.** `KdsDeliveryRecord`, printer jobs and BullMQ queues are unchanged and are not consumers.
