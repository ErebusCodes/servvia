# D13 implementation note: generic outbox and workers

Status: **done** 2026-09-30. Disposable databases only; the migration is **not applied to production**. No client is switched. Not committed.

## CURRENT (audited 2026-09-30)

| Mechanism | Owner | Durability | Consumer model | Retry | Lease / claim | Status | D13 action |
|---|---|---|---|---|---|---|---|
| `OutboxEvent` (D3/D4), `order.round_submitted` | Go orders → kitchen projector | Row in the round's transaction | **One** consumer; its progress (`processedAt`, `attempts`, `availableAt`, `failedAt`, `lastError`) is **on the event row** | Exponential 1 s → 5 min, park after 10 | Row lock, `FOR UPDATE SKIP LOCKED`, no lease | Canonical, but single-consumer | **Converge.** New rounds use the generic model; the legacy projector only drains existing rows; the table is retired later. |
| `RealtimeEvent` (D12) | Go, every domain | Row in the change's transaction | Broadcast: every instance tails it with an in-memory `(txId, sequence)` cursor; no progress stored | None needed (no durable delivery) | None | Canonical fact log, transport-named | **Generalise.** Its shape becomes `DomainEvent`; realtime reads that. `RealtimeEvent` is no longer written (kept until an approved drop). |
| BullMQ `emails` | Nest | Redis | BullMQ worker | BullMQ | BullMQ | Transitional | Unchanged; a future canonical notification consumer |
| BullMQ `print-jobs` + `PrinterJob` | Nest | Row + Redis | Timer sweep, claim columns | `attemptCount` | `dispatchClaimId` / `dispatchClaimExpiresAt` | Transitional (Venue Edge phase) | Unchanged; not ported |
| `KdsDeliveryRecord` | Nest | Row | Timer sweep → Socket.IO | Budget, exhausted | Claim columns | Legacy (superseded by D4 plus D12) | Unchanged |
| IdealPOS (legacy): BullMQ `pos-sync`, `POSSyncRecord`, dispatcher and native-round tracking | Nest | Row + Redis | Sweeps | Budgets | Claim columns | Legacy (ADR 0001) | Never enters the canonical event system; retired per [idealpos-retirement.md](idealpos-retirement.md) |
| `ConnectorCommand` | Nest | Row | Venue agent pulls | `claimAttemptCount`, TTL | `leaseExpiresAt` | Legacy (ADR 0001) | A command is not an event; never part of the event system |
| Calendar sync (`CalendarSyncStatus`) | Nest | Row | — | — | — | Transitional | Unchanged |

## Decisions

| Concept | Decision |
|---|---|
| Event model | **`DomainEvent`**: one durable canonical fact per change, written in the change's transaction, organization and venue derived from `Venue`. It has the D12 envelope and catalog (`contracts/events/catalog.md`): no second naming system, no synonyms. It is not canonical state: it guarantees that the state can be observed asynchronously. |
| Consumer progress | **`EventDelivery`**: one row per (event, work consumer), created in the same transaction as the event for every consumer subscribed to its type. Status, attempts, `availableAt`, lease, error and outcome belong to the delivery, **never to the event**. One consumer's success never marks another's. |
| Two kinds of consumer | **Work consumers** (at-least-once, exactly one worker at a time, durable progress): `kitchen_projector`. **Broadcast readers** (every instance, no durable progress): the realtime dispatcher, which tails `DomainEvent`. Realtime has no delivery rows, so its progress cannot be shared with the kitchen's. |
| Registry | `internal/events`: consumer identities and their subscriptions, currently only `kitchen_projector` → `order.round_submitted`. No speculative business workers. |
| Claiming | Claim: `UPDATE … WHERE id IN (SELECT … FOR UPDATE SKIP LOCKED LIMIT n)` sets `leaseOwner` and `leaseExpiresAt` and increments `attempts`. Only pending, due and unleased (or lease-expired) rows are claimed. Processing then locks the delivery again, **validates that the lease is still this worker's**, runs the handler in the same transaction, and marks success. A crash leaves the lease to expire; the delivery is then claimable again. |
| Retry | Failure: `availableAt = now + min(1 s × 2^(attempts−1), 5 min)`, the lease is cleared, and `lastError` is recorded. A permanent error, or attempts ≥ 10, → `failed` (dead letter, inspectable, never deleted). A failed delivery blocks nothing else. Recovery: `Retry` resets a failed delivery to pending (attempts 0), explicitly. There is no "mark succeeded". |
| Ordering | None promised, globally or per aggregate. The kitchen projector needs none (each round is independent and idempotent). |
| Idempotency | Delivery is at least once. `eventId` is the dedupe identity. The kitchen projector is idempotent by `KitchenTicket (roundId, station)` and `KitchenTicketLine (orderItemId)`, with the event id recorded as `sourceEventId`. |
| D4 | Orders stop writing `OutboxEvent`. The kitchen projection logic is shared: the generic `kitchen_projector` consumer projects new rounds, and the legacy projector drains only pre-D13 rows. Both are idempotent on the same unique keys, so an overlap writes nothing twice. Historical progress is untouched. Retirement: remove the legacy projector once no unprocessed `OutboxEvent` rows remain anywhere, then drop the table with approval. |
| D12 | The realtime dispatcher tails `DomainEvent` with the same xmin-bounded cursor. The protocol, authorization and envelope are unchanged. `RealtimeEvent` is deprecated in place (not dropped). |
| Retention | A `DomainEvent` is pruned after the retention (7 days) only when none of its deliveries is pending or failed. |
| Observability | A backlog per consumer (pending, retrying, leased, failed, oldest pending age) at `GET /api/admin/workers` (owner or admin, staff login), counting only the caller's organization (from the verified token, across its venues). It shows no payloads. Logs carry `eventId`, consumer, attempt and result. |
| Schema | Additive migration `20261009000000_domain_events`: `DomainEvent`, `EventDelivery`, `EventDeliveryStatus`. Nothing is dropped, and no history is fabricated. |

## Verification (2026-09-30, disposable local PostgreSQL and Redis)

| Gate | Result |
|---|---|
| Prisma | `format` (no change), `validate`, `generate`; from-zero `migrate deploy`; D12 → D13 upgrade; `migrate diff` against the schema exits 0 (no drift) on both |
| Go | `gofmt -l` clean, `go vet ./...`, `go build ./...`, `go test -race -count=1 ./...` (unit, architecture, contract, integration incl. every D4 kitchen and D12 realtime test) pass |
| Worker tests (`tests/integration/workers_test.go`) | Fact commits and rolls back with its change; consumers independent; exclusive claims under concurrency; SKIP LOCKED; lease expiry and takeover; lost lease abandoned; retry, backoff and dead letter; shutdown release; backlog and pruning; backlog endpoint auth; no legacy integration or command concept in events |
| Mutations | `SKIP LOCKED` removed → caught (the locked-row test blocks); lease validation removed → caught (`TestLostLeaseIsAbandoned`). Restored by checksum. |
| Nest | typecheck, build, unit (1,910 tests), integration on a fresh migrated and seeded database (310 passed, 5 skipped: same as D12) |
| Parity | live Nest vs Go, 9 suites pass; the suite now leaves no `DomainEvent` rows |
| Contracts | 135 schemas compile; `npm run test:dev-scripts` 80/80 |
| Real-binary smoke | Facts recorded with the session, order and round; no new `OutboxEvent`; the kitchen worker delivered once and the ticket's `sourceEventId` is the event id; a second consumer's delivery stayed pending; an unprojectable round became a `failed` delivery with its error; backlog endpoint counts only, 401 without a token; realtime frames unchanged; SIGTERM shut down cleanly with no leases left; all rows removed |
