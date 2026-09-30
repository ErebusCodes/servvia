# D12 implementation note: canonical realtime

Status: implemented 2026-09-30, tested against disposable databases only. Additive migration `20261008000000_realtime_events`, **not applied to production**. No client is switched. The results are in [README.md](README.md#phase-d12-result).

## CURRENT (audited 2026-09-30)

| Area | Behaviour | Problem |
|---|---|---|
| Nest `OrdersGateway` (`apps/api/src/orders/orders.gateway.ts`) | The only realtime channel: Socket.IO on `/socket.io/`, `cors: '*'`, JWT from `handshake.auth.token` or Bearer. One client message, `joinVenue {venueId}` (client-chosen, org-checked); one server event, `orderUpdate`. | Single process, no Redis adapter. At most once, no replay, no ordering. |
| `orderUpdate` payload | The **full Prisma `Order` row** plus relations that differ per emit site (5 sites: kiosk/staff create, `updateStatus`, the KDS re-push sweep, 11 IdealPOS dispatcher call sites). Sent to `venue:{id}:orders` **and** `venue:{id}:kds`, and every socket is in both rooms, so each event arrives twice. | KDS screens and viewer-role tablets receive prices, `idempotencyKey`, `paymentProviderTransactionId` and IdealPOS sync state. The payload can be `null`. |
| Auth | The JWT is verified once at connect. `kds_device` is pinned to its venue. **Tablet tokens are not pinned** (any venue of the org). **Roles are never checked.** No revocation check and no expiry after connect (tablet tokens live 30 days). | Least privilege is missing. |
| Clients | Admin Console `useLiveOrders` (Order Tablet, Orders, Kitchen pages) and window-display `KdsPage` use socket.io-client 4.8. They join `VITE_VENUE_ID`, **refetch over HTTP on every connect**, and upsert the whole object by `id`. The Order Tablet reads `posSyncRecord.strategy`. | Coupled to the Prisma shape. Stale token on reconnect. |
| Go Core | No realtime. `OutboxEvent` (D3/D4) has one fact, `order.round_submitted`. Its `processedAt`, `attempts`, `availableAt` and `failedAt` columns are **the kitchen projector's** progress. D5–D11 write no events. | — |
| Redis | Used for the rate limiter and BullMQ only. No pub/sub. | — |

**Worth keeping:** HTTP refetch on connect (the resync model), the organization check, and KDS pinned to its venue.

**Must go:** full mutable rows as events, client-chosen broad rooms, doubled delivery, and role-blind fan-out.

## Decisions

| Concept | Decision |
|---|---|
| Transport | **Raw WebSocket** (RFC 6455) at `GET /api/realtime`, served by Go Core. This is the architecture's choice (§3.7 "Realtime: WebSockets"; Kotlin and C# clients). Library: `github.com/coder/websocket` (MIT, no dependencies; the successor that `golang.org/x/net/websocket` recommends). **No Socket.IO in Go.** The Nest gateway stays exactly as it is for existing clients until each client's own cutover, when it moves to this contract plus HTTP refetch. Socket.IO's handshake, rooms and `orderUpdate` shape are not reproduced (no bridge). |
| Truth | PostgreSQL. An event says *what changed* and *what to refetch*. It is never a resource representation, never replayable history, and never a command. |
| Durability | New table `RealtimeEvent`, written **in the same transaction** as the canonical change (both commit or neither). It is a delivery log that every Core instance tails, **not a queue**: there is no per-row processed flag and no consumer state in the database. Each instance keeps its own in-memory cursor `(txId, sequence)` and reads only rows whose writing transaction is older than the current snapshot's `xmin`. Rows therefore become visible in a safe, gap-free order even though sequences are allocated before commit. Rows older than the retention (24 h) are pruned. |
| D4 outbox | Untouched. `OutboxEvent.processedAt` and its sibling columns stay the kitchen projector's alone. `order.round_submitted` is **one fact** with one definition (`contracts/events/catalog.md`). The outbox row carries the projector's extra input (`lines`); the realtime row carries the reference fields. Same name, same meaning, same fields where they overlap. |
| Envelope | `eventId` (uuid), `eventType`, `occurredAt`, `organizationId`, `venueId`, `aggregateType`, `aggregateId`, `version` (post-change aggregate version, or null), and `payload` (bounded ids, statuses and summary amounts). Organization and venue are derived from the `Venue` row in the insert itself. |
| Facts | `table_session.opened|closed|cancelled`, `order.created`, `order.round_submitted`, `kitchen_ticket.created|transitioned`, `check.created|voided|settled|settlement_revoked`, `payment.created|status_changed`, `refund.created|status_changed`, `reversal.recorded`, `shift.opened|closed`, `promotion.created|updated|activated|disabled`. Not published: devices and terminals (no operational subscriber), `table_session.updated` (covers or notes; not needed), and AuditLog (never read as a bus). |
| Streams | Three server-assigned audiences, which the client cannot choose. **kitchen**: `kitchen_ticket.*`. **operations**: `table_session.*`, `order.*`, `kitchen_ticket.*`, `promotion.*` (status and version only). **financial**: `check.*`, `payment.*`, `refund.*`, `reversal.*`, `shift.*`. |
| Authorization | One venue per connection. Credential in the `Authorization` header, or in the first `subscribe` message (browsers). Owner, admin, manager and cashier staff (session or elevated tablet): operations and financial. Kitchen staff, a `kds_device` JWT, or a D8 `kds` device credential: kitchen only. Refused: viewer, an unelevated `tablet_device` (customer mode), and D8 `order_tablet`, `pos_terminal` and `payment_adapter` credentials (a device kind grants no staff authority). The venue must be in the caller's organization, and device-scoped tokens are pinned to their own venue. A forged `venueId` is refused, never "corrected". Tablet and device credentials are re-checked every 60 s, and every connection closes when its token expires. |
| Delivery | At most once per connection, and at least once across reconnects **only via HTTP refetch**. Duplicates are possible; deduplicate by `eventId`. No global order. Per aggregate, `version` is monotonic where present, so a subscriber drops a stale one. No replay: reconnect → authenticate → subscribe → refetch. |
| Backpressure | 256 events buffered per connection. When the buffer is full the connection is closed (4008 `SLOW_CONSUMER`); the client reconnects and refetches. The dispatcher never blocks on a subscriber, and writers never touch the hub. |
| Shutdown | On draining: `/ready` fails, the upgrade path refuses new connections, existing ones are closed with 1001 `going away`, then the dispatcher stops. |
| Redis | Not used. The database log already fans out to every instance. |
| Schema | Additive migration `20261008000000_realtime_events`: one table, no FK to Venue (delivery log; derived ids; pruned). |
