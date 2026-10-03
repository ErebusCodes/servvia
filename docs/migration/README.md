# Servvia-native POS migration

This directory holds the plan and status for [ADR 0001: Servvia is the operational POS](../adr/0001-servvia-is-the-operational-pos.md).
The migration is a strangler migration: each capability moves to its target owner only when a replacement is tested. Nothing is rewritten wholesale, and nothing old is deleted until its replacement is proven.

| Document | Contents |
|---|---|
| [idealpos-retirement.md](idealpos-retirement.md) | Every IdealPOS dependency and the safe order for retiring them |
| [naming-inventory.md](naming-inventory.md) | Remaining "Verdura" identifiers, classified by rename safety |
| [`../../contracts/`](../../contracts/README.md) | Frozen interface contracts at the migration boundaries |

## Standing rules

1. **One schema-migration authority.** Prisma (`apps/api/prisma/migrations`) is the only migration authority until a cutover is explicitly approved. Go may connect, read and write through the approved schema, but it may not create migrations.
2. **No second permanent owner** for any capability (DL-105). Any overlap needs a source owner, a target owner, cutover criteria, retirement criteria and a bounded period.
3. **Contracts before replacement.** A capability moves to Go only after its contract is pinned in `contracts/` and the same contract tests pass against both implementations.
4. **Additive schema changes.** Add, backfill, validate, switch reads and writes, observe, then remove later. Historical migrations are never edited.
5. **Production operations need approval every time.** That covers the migration baseline, data changes, deploys, service changes and identifier renames.

## Phases and status

| Phase | Scope | Status |
|---|---|---|
| **Stabilisation track** (separate from restructuring) | Kiosk checkout (CSRF 403, missing idempotency key, additive GST, no refund); KDS `kitchen` role can create and cancel orders; CI workflow deleted; production migration baseline; stuck `claimed` connector commands; connector admin routes accept device tokens; anonymous logout audit; native-round recovery timezone dependence; `start:prod` / Docker entry point broken (see below) | **Open.** The baseline needs explicit approval before it is run in production. |
| **A: decision and contracts** | ADR 0001, supersession records, `contracts/` | **Done** (2026-09-28) |
| **B: decouple legacy POS from order creation** | `apps/api/src/legacy-external-pos/` | **Done** (2026-09-28). See below. |
| **C: minimal Go Core** | `services/core-platform` (go1.27.1): config, structured logs, request/correlation IDs, timeouts, graceful shutdown, `/health`, `/ready`, read-only Postgres pool, Nest token verification, channel menu read | **Done** (2026-09-28). At parity with Nest; **no callers switched**. See [its README](../../services/core-platform/README.md) for the gaps that block switching. |
| **D1: Go platform parity, venue foundation, pricing authority** | HTTP compatibility gaps (rate limit, CORS, ETag, routing, CSRF cookie); organization/venue read model and `GET /api/venues/{id}/tax-config`; `internal/pricing` | **Done** (2026-09-28). At parity with Nest; **no callers switched**, no schema change. See below. |
| **D2: tables and first-class TableSession** | Additive Prisma migration `20260929000000_table_sessions`; Go `internal/tables`; table-session API (`contracts/openapi/table-sessions.yaml`) | **Done** (2026-09-29). Migration tested on disposable databases only; **not applied to production**, no caller switched. See below. |
| **D3: canonical order core** | Additive migration `20260930000000_canonical_orders`; Go `internal/orders`; canonical order API (`contracts/openapi/servvia-orders.yaml`); temporary Nest occupancy bridge | **Done** (2026-09-29). Migration tested on disposable databases only; **not applied to production**; no client switched. See below. |
| **D4: kitchen tickets** | Additive migration `20261001000000_kitchen_tickets`; Go `internal/kitchen`; outbox projector for `order.round_submitted`; kitchen API (`contracts/openapi/kitchen-tickets.yaml`) | **Done** (2026-09-29). Migration tested on disposable databases only; **not applied to production**; no client or printer switched. See below and [d4-kitchen-tickets.md](d4-kitchen-tickets.md). |
| **D5: canonical check** | Additive migration `20261002000000_checks`; Go `internal/checks`; check API (`contracts/openapi/checks.yaml`) | **Done** (2026-09-29). Migration tested on disposable databases only; **not applied to production**; no client switched. See below and [d5-checks.md](d5-checks.md). |
| **D6: canonical payment and settlement** | Additive migration `20261003000000_payments_settlement`; Go `internal/payments`; payments API with a separate adapter trust path (`contracts/openapi/payments.yaml`) | **Done** (2026-09-29). Migration tested on disposable databases only; **not applied to production**; no client, kiosk or device switched. See below and [d6-payments-settlement.md](d6-payments-settlement.md). |
| **D7: canonical shifts and cash** | Additive migration `20261004000000_shifts_cash`; Go `internal/shifts`; cash tender in `internal/payments`; shifts API (`contracts/openapi/shifts.yaml`) | **Done** (2026-09-29). Migration tested on disposable databases only; **not applied to production**; no client switched, no hardware. See below and [d7-shifts-cash.md](d7-shifts-cash.md). |
| **D8: canonical devices and terminals** | Additive migration `20261005000000_devices_terminals`; Go `internal/devices`; per-venue device authentication of the payment adapter; devices API (`contracts/openapi/devices.yaml`) | **Done** (2026-09-29). Migration tested on disposable databases only; **not applied to production**; no client or device switched, no hardware. See below and [d8-devices-terminals.md](d8-devices-terminals.md). |
| **D9: refunds, reversals, settlement revocation** | Additive migration `20261006000000_refunds_reversals`; Go `internal/refunds` (store beside payments); settlement lifecycle; cash refunds under shifts; refunds API (`contracts/openapi/refunds.yaml`) | **Done** (2026-09-29). Migration tested on disposable databases only; **not applied to production**; no client, adapter or provider switched. See below and [d9-refunds-reversals.md](d9-refunds-reversals.md). |
| **D10: visit (table session) close** | The D2 close gated on the D9 financial-completeness rule, executed in Core (`internal/tables/pgstore`); global lock order; state-based idempotent close; closed visits refuse new orders, rounds and checks | **Done** (2026-09-29). **No schema change.** Tested on disposable databases only; not deployed; no client switched. See below and [d10-visit-close.md](d10-visit-close.md). |
| **D11: canonical promotions** | Additive migration `20261007000000_promotions`; Go `internal/promotions` (eligibility) with the discount math in `internal/pricing`; promotions applied at order/round time with a frozen `AppliedPromotion` snapshot; checks copy accepted discounts; promotions API (`contracts/openapi/promotions.yaml`) | **Done** (2026-09-30). Migration tested on disposable databases only; **not applied to production**; no client switched. See below and [d11-promotions.md](d11-promotions.md). |
| **D12: canonical realtime** | Additive migration `20261008000000_realtime_events`; Go `internal/realtime` (envelope, catalog, grants, hub), `realtime/pgstore` (same-transaction `Record`, gap-free tail), `realtime/realtimeapi` (WebSocket `GET /api/realtime`); every domain records its facts in its own transactions; contracts `contracts/realtime/servvia-realtime.{md,schema.json}` and `contracts/events/catalog.md` | **Done** (2026-09-30). Migration tested on disposable databases only; **not applied to production**; no client switched; Nest Socket.IO untouched. See below and [d12-realtime.md](d12-realtime.md). |
| **D13: generic outbox and workers** | Additive migration `20261009000000_domain_events`; Go `internal/events` (fact, envelope, catalog, consumer registry), `events/pgstore` (same-transaction `Record`, gap-free tail, prune), `internal/workers` (claims, leases, retry, dead letters, backlog) and `GET /api/admin/workers`; the kitchen projector becomes the `kitchen_projector` consumer; realtime tails `DomainEvent` | **Done** (2026-09-30). Migration tested on disposable databases only; **not applied to production**; no client switched; `OutboxEvent` and `RealtimeEvent` kept (no longer written). See below and [d13-outbox-workers.md](d13-outbox-workers.md). |
| E: clients | Android foundation, then KDS, Waiter Tablet (Staff Mode and Guest Mode; CC-3), Kiosk, Window Display; Windows POS once Go has TableSession, Orders, Checks, Payments and Settlement; admin-console restructure | Not started |
| F: Venue Edge | Port the reusable parts of `apps/venue-connector` to `services/venue-edge` (Go) | Not started |
| G: IdealPOS retirement | [idealpos-retirement.md](idealpos-retirement.md) | Not started |

### Phase B result

`OrdersService` no longer imports anything from `pos-sync/` or `connector/`. `legacy-external-pos-boundary.spec.ts` enforces this. Five IdealPOS responsibilities moved, unchanged, into the temporary `LegacyExternalPosHandoff`:

- strategy decision and refusal
- `Order.posSyncStatus` initial value
- `POSSyncRecord` outbox row
- KOT suppression for Bridge venues
- dispatch stop on cancel

The response shape is unchanged. The `posSyncRecord` relation is still included, through `LEGACY_EXTERNAL_POS_ORDER_INCLUDE`.

**One deliberate behaviour change.** A venue with `posAdapterType = none` no longer consults `IDEALPOS_POS_STRATEGY`. Before, a misconfigured native IdealPOS route refused orders even at venues with no external POS. External-POS venues are refused exactly as before.

### Phase C result

- **Tests.** Go runs contract, PostgreSQL integration and Nest-vs-Go parity suites.
- **Menu parity.** On a disposable database holding the published canonical menu plus edge-case fixtures, 48 requests matched Nest exactly: 6 venue cases × 4 channels × 2 URL forms, compared on status, body and security headers.
- **Token parity.** Real tokens of all five kinds issued by the running Nest API verify in Go. Nest's auth layer and Go's return the same responses for 10 valid, tampered, expired and malformed tokens.
- **Schema.** Nothing changed and no Go migrations exist. The Go pool is read-only by construction.

### Phase D1 result

- **HTTP compatibility.** The four Phase C gaps are closed, plus Nest's `csrf_token` cookie, which Phase C had not listed. The rate limiter uses Nest's Lua script, key and member format on the same Redis, so a client has one budget across both services. Parity proves this by alternating 120 requests between the services. The remaining header-level differences are listed in the [core-platform README](../../services/core-platform/README.md#before-any-caller-is-switched-to-go).
- **Organization and venue.** `internal/venues` reads Organization and Venue without `posAdapterType` or `posConfig`. `GET /api/venues/{id}/tax-config` is ported with its guards and pinned in `contracts/openapi/venues-read.yaml`. 63 requests (12 callers × 5 venue cases, plus 3 revoked-tablet requests) matched Nest byte for byte. The admin venue CRUD is not ported, because its responses carry the legacy columns.
- **Pricing.** `internal/pricing` is pure: integer cents, venue overrides, strict ID-based modifiers, the stale-price check, NZ GST `gross × 3/23` contained (never added), and the amount bounds of the integer columns. `pricing/pgcatalog` loads the catalog in one statement. 42 cases were run against real Nest staff orders: 17 priced to the same cent on every line and total, 23 were rejected with the identical status and body, and 2 are the documented differences below. GST agrees with Nest's `Math.round` on every integer from -50,000 to 50,000 and on 200,000 random amounts up to the column limit.
- **Guard.** `tests/architecture` fails if any Go Core code token or import names an IdealPOS or external-POS concept.
- **Not changed.** Schema, Prisma migrations, Nest code, clients, proxy routing, deployment and production.

#### Pricing differences found (reported, not silently resolved)

| Case | Nest | Go | Classification |
|---|---|---|---|
| A selected option's stored `priceDeltaCents` is fractional (e.g. 12.5) | Accepts the order and persists the unit price truncated (1000 + 12.5 is stored as 1012). The line's modifier snapshot keeps 12.5, so the line no longer adds up. | Refuses with `KindCatalogInvalid`. | Nest defect, reachable only through a direct database write or import: `ModifierOptionDto` enforces `@IsInt @Min(0)`. **Needs a decision** before Go serves orders. |
| Any amount beyond PostgreSQL `integer` (e.g. 30,000 × $999.99) | 500 at persistence | Refuses with `KindAmountOutOfRange` before persistence | Same outcome class. Go fails earlier and says why. |
| Negative stored `priceDeltaCents` | Priced as a discount | Same, at parity | Ambiguity: authoring forbids negatives (`@Min(0)`), pricing accepts them. Go keeps Nest's behaviour until decided. |

#### Deliberately not ported

- **Kiosk name-based modifier matching** (`resolveModifiers` non-strict branch, used only by the public `POST /kiosk/orders`). It prices by display name, ignores option availability and group rules, and keeps unknown names at a zero price. Go Core has one modifier contract, the strict ID-based one. The Android kiosk (Phase E) must send ids. Until then the kiosk path stays in Nest.
- **Admin venue CRUD** (`GET/POST/PATCH/DELETE /venues`): its responses expose `posAdapterType` and `posConfig`.

#### Findings recorded during D1, not fixed (outside the batch)

- `apps/api/src/venues/venues.service.ts` `getTaxConfig` / `findOne`: for a device token, `resolveVenueScope` can return `undefined` if a token ever lacked `venueId`. Prisma then drops the id filter and returns the organization's first venue. No issued token lacks `venueId` today.
- CSRF: `Authorization: bearer x` (lowercase scheme) is not exempt, while Passport accepts a lowercase scheme. A client that sends one gets 403 on unsafe methods.
- The rate-limit key contains the raw path, so `/API/...`, `/api/.../` and `%5F` spellings of one route each get a separate 120/min budget (both services, at parity).
- `ModifierOptionDto` forbids negative deltas, but existing rows are never re-validated; see the table above.

### Decisions recorded 2026-09-29

- **A. Money is integer minor units; a fractional modifier price is invalid data.** Servvia Core refuses it (`pricing.KindCatalogInvalid`) and does not reproduce Nest's truncation. Existing rows are never altered, rounded or truncated automatically. [`checks/fractional-modifier-prices.sql`](checks/fractional-modifier-prices.sql) is a read-only query that lists them, and a Go integration test proves it finds them. It found **0** rows in the seeded catalog. **Production has not been checked**; that needs access and approval. A database constraint on modifier prices may be proposed only after the production check comes back clean, as its own approved migration.
- **B. The permanent modifier contract is identifier-based.** Every future client (Android kiosk, Order Tablet, Waiter Tablet, Windows POS) submits product, modifier-group and option ids, quantities and notes. The legacy kiosk's name-based matching is not ported. The current browser kiosk stays on the Nest path, unchanged, until its Kotlin replacement reaches parity.

### Phase D2 result

**Before D2**, a table's "visit" was whichever order was active on it:
- occupancy meant an order in `pending`..`ready` with that `Order.tableId` or `tableNumber`;
- the Order Tablet's "Close Table" completed or cancelled that order;
- covers lived on each order (`Order.guests`);
- "one active order per table" was enforced by a `FOR UPDATE` lock on the Table row plus a re-check, not by a constraint;
- no transfer or merge existed.

**D2 adds the visit as its own concept, additively:**

- **Schema.** `TableSession` (id, tableId, status open/closed/cancelled, covers, openedByStaffId, openRequestKey, version, openedAt, closedAt, createdAt, updatedAt). Hand-written invariants in the migration:
  - a partial unique index (at most one open session per table);
  - CHECKs on covers 1..99, version ≥ 1, `closedAt` set exactly when the session is not open, and key length 16..255.

  No existing table or column changed. The table starts empty: historical orders keep `Order.tableId` / `guests`, and no sessions are fabricated for them.
- **Go.** `internal/tables` holds the rules and the service; `tables/pgstore` holds transactions, locking, compare-and-swap and the audit log; `tables/tablesapi` holds the HTTP layer. Seven venue-scoped endpoints: list open, open, active-for-table, get, update covers, close, cancel.
- **Concurrency.**
  - The index is the enforcement. With it dropped, 24 concurrent opens all succeeded; with it, exactly one wins, every time.
  - Changes lock the row and require the version the client read. A stale version gets 409 `VERSION_CONFLICT`, never an overwrite.
- **Idempotency.** Opening reuses the Order pattern: a client key, unique per table in the database. A retry returns the original session (200). 24 concurrent retries of one request produce one session.
- **Authorization.** Staff identities only (a staff login, or a tablet elevated by a staff/manager PIN) with role owner/admin/manager/cashier, plus the tablet revocation check, venue scope and organization isolation. KDS devices, customer-mode tablets, the kiosk, and the kitchen/viewer roles are refused. This deliberately does not copy Nest's `STAFF_ORDER_ROLES`, which includes `kitchen` (see the stabilisation track).
- **Writes are opt-in.** The service writes only with `SERVVIA_CORE_DB_READ_ONLY=false`. Otherwise changes answer 503 `TABLE_SESSION_WRITES_DISABLED` and reads still work.

#### Temporary duplication and guards (removed in D3)

- **Covers.** `TableSession.covers` is the canonical visit-level count. `Order.guests` stays for legacy clients, and nothing copies one into the other.
- **Legacy occupancy guard.** Go refuses to open a session on a table with an active Nest order (409 `TABLE_HAS_ACTIVE_ORDER`). The reverse is **not** guarded: Nest's order path does not know about sessions. Before any client opens sessions, the Nest order path must either check for an open session or be replaced by Go orders (D3).
- **`Order.tableSessionId` deliberately deferred to D3.** Adding it now would put a new field in every Nest order response with nothing to populate it. D3 adds it, nullable, together with the Go order path that fills it.

#### Not implemented, by design

- **Transfer.** It does not exist today. Intended semantics: move an open session to a free table in one transaction, keeping the session id, bumping the version, and relying on the partial index for the target. Orders follow through `tableSessionId` once D3 adds it.
- **Merge.** It does not exist today. It needs a product decision (one session absorbing another's orders, versus a linked group) and belongs with Check split and merge.
- **Staff assignment beyond `openedByStaffId`.** There is no waiter-ownership concept today to preserve.

#### Deployment sequence (each step needs its own approval)

1. Back up the production database.
2. `npx prisma migrate deploy` from `apps/api`. The migration is additive and moves no data. Rollback SQL is in the migration's header.
3. Nothing else changes: Nest ignores the table, and no client calls the API.
4. Only after D3 (or a Nest-side guard) and an explicit decision, run a Go instance with `SERVVIA_CORE_DB_READ_ONLY=false` and route the table-session paths to it.

### Phase D3 result

- **Schema** (migration `20260930000000_canonical_orders`, additive, and no historical row changes):
  - **`Order.tableSessionId`**, nullable and indexed, with a *composite* foreign key `(tableSessionId, tableId)` → `TableSession(id, tableId)`. By database constraint, an order's table is its session's table. The table is derived from the session, never taken from the client.
  - **CHECK:** a session order is dine-in.
  - **`OrderRound`** (per-order `sequence` and `requestKey`, both unique) and **`OrderItem.roundId`**.
  - **`OutboxEvent`:** a generic table, whose only event today is `order.round_submitted`.
  - **`OrderSource`** gains `pos_terminal`, `waiter_tablet`, `order_tablet` and `customer_web` (`kiosk` already existed). `staff` and `online` remain for migration compatibility only and are never written by Servvia Core.
- **No limit on orders per visit.** A draft of this phase added a partial unique index allowing one active order per session. It was removed before D3 was finalized: it only restated the legacy Nest rule "one table, one active order". In the canonical model occupancy belongs to the session (one open session per table), and a visit may hold several orders (a staff order plus a guest's Order Tablet order, separate ordering flows, multi-party ordering). Accidental duplicates are prevented by idempotency keys, not by a cap. Tests prove one session holds several orders, each with its own rounds, including 24 created concurrently.
- **Go** (`internal/orders`, `orders/pgstore`, `orders/ordersapi`):
  - **Pricing:** the D1 pricing package, unchanged.
  - **Modifiers:** identifier-based only.
  - **Idempotency:** the `(venueId, idempotencyKey)` unique index is shared with Nest. A replay is decided before pricing, and a unique-violation race is recovered by re-reading the winner. The fingerprint covers venue, source, service mode, session, order notes and per-line product, quantity, options, notes and seat, but never prices.
  - **Rounds:** numbered under a lock on the order; the order's totals are recomputed over every round.
  - **Per create or round, one transaction:** the order and round, the lines, one outbox event and one audit row. Replays and key conflicts are audited best-effort, as in Nest.
  - **Orders start `confirmed`.** No `preparing`/`ready` transitions yet. Kitchen progress is KitchenTicket's work (D4), which does not write `Order.status`.
  - **No cancellation or completion in D3:** they need KitchenTicket and Check semantics.
- **Authorization:** as for table sessions (staff only; owner, admin, manager or cashier; not `kitchen`). The declared source must fit the caller: a staff login submits `pos_terminal`, a staff tablet `waiter_tablet` or `order_tablet`. `kiosk` and `customer_web` await customer authentication.
- **A native order has no IdealPOS state.** A test proves it: no `POSSyncRecord`, `NativeTableRound`, `KdsDeliveryRecord`, `PrinterJob`, payment observation or connector command. The order is only canonical rows: Order, OrderRound, OrderItem, OutboxEvent and AuditLog.

#### Temporary Nest occupancy bridge

`apps/api/src/orders/table-session-occupancy.ts`: the Nest order path refuses a table order (kiosk or staff) while the table has an open Servvia session. It checks twice: once as a pre-check, and once inside its transaction under the same `Table` row lock that the Go session open takes `FOR SHARE`. Together with the Go-side guard (no session on a table with a session-less Nest order), a table is occupied by one model or the other, never both. A live race test with 20 races per run exercises both arrival orders against the running Nest API. **Delete when table order creation has moved to Servvia Core.**

#### Legacy `posSyncStatus` default

The default of `Order.posSyncStatus` is now `not_applicable`, so Servvia Core never names the column.
- **Verified:** the only Nest runtime writer of `Order` rows (`OrdersService.persistOrder`, used by the staff, tablet and kiosk paths) always sets it explicitly. No other runtime or script writes orders.
- **Test fixtures:** some integration fixtures omit it; the full Nest integration suite passes with the new default.

This is a temporary compatibility detail, and the column is to be removed with the external-POS code.

#### Differences from the NestJS order path (deliberate, documented)

| Behaviour | Nest | Servvia Core |
|---|---|---|
| Order totals after a round | Round lines are added; the order's totals stay at round 1 | Recomputed over every round (a correction, not parity) |
| Orders per table | One active order per table | Several orders per visit; the session is the occupancy |
| `kitchen` role or KDS token ordering | Allowed | Refused (403) |
| Another organization's venue | 403 `Venue does not belong to your organization` | 404 `Venue not found` |
| Replay status | 201 | 200 (201 only when this request created it) |
| Replay after the menu changed | Items are re-resolved first, so a now-unavailable item turns a replay into 409 | The replay is decided before pricing, so the original order is returned |
| Fingerprint | Excludes notes and seats | Includes them |
| Conflict bodies | `{message, error, statusCode}` | The same, plus `code` (and `orderId`) |

Parity on generic behaviour, live against Nest, all identical:
- 21 order requests: 6 priced to the cent, 15 refused with the same status and body;
- replay and key reuse;
- the shared key namespace, in both directions;
- organization and venue isolation.

### Phase D4 result

The CURRENT → canonical mapping and the design are in [d4-kitchen-tickets.md](d4-kitchen-tickets.md).

- **Schema** (migration `20261001000000_kitchen_tickets`, additive; no historical row changes):
  - `KitchenTicket`: one per round per station. `(roundId, station)` is unique. A composite foreign key `(roundId, orderId)` → `OrderRound(id, orderId)` makes a ticket's order its round's order.
  - `KitchenTicketLine`: `orderItemId` is unique, so an order line is on exactly one ticket.
  - `KitchenTicketTransition`: history, unique per `(ticketId, version)`.
  - `KitchenTicketStatus` enum.
  - `OutboxEvent` gains `attempts`, `lastError`, `availableAt` and `failedAt`, plus a partial index for due events.
  - Hand-written CHECKs: station format, version, quantity, position, and "a status has its stage timestamp".
  - No tickets are fabricated for history.
- **Kitchen state is separate from order state.** Nothing in D4 writes `Order.status`. A test proves the order is still `confirmed` after its ticket is completed and recalled.
- **Projection** (`kitchen/pgstore.Projector`, in the Go API process, only when writes are enabled):
  - One transaction per event: claim `FOR UPDATE SKIP LOCKED`, write tickets and lines, stamp `processedAt`.
  - The projector reads canonical order rows; the payload only names the round.
  - **Idempotency is the unique indexes.** 8 draining workers racing 16 re-projectors over 30 orders produce exactly 30 tickets and 60 lines, with every event processed once and never marked failed. Re-projecting, or un-stamping `processedAt` as if a commit were lost, writes nothing new. A ticket missing a line is completed rather than duplicated.
  - **Bounded retry.** Exponential backoff (1 s doubling, capped at 5 min), recorded on the event under its lock. The event is parked (`failedAt`) after 10 attempts, or at once if it can never succeed. A failing event does not block the events behind it. A parked event is released by clearing `failedAt`.
- **Routing is server-side.** It uses `kitchen.Router`, which is `SingleStation{"kitchen"}` today, because the repository holds no product-to-station data. The ticket key already includes the station.
- **Transitions:**
  - The path is `new → (acknowledged) → preparing → ready → completed`, then `completed → recalled → preparing | ready | completed`.
  - The row is locked and a stale version is 409 `VERSION_CONFLICT`. Asking for the current status returns 200 unchanged, so retries are safe. 24 concurrent screens produce one write.
  - There is no cancellation: it needs order cancellation, which does not exist yet.
- **Authorization:**
  - Allowed: a KDS device token or a staff identity, with role owner, admin, manager, cashier or kitchen.
  - Refused: an unelevated customer tablet and the viewer role.
  - Device tokens are pinned to their venue, and the venue must be in the caller's organization.
  - A KDS token still cannot place orders on Go (403).
- **History is not AuditLog.** A KDS device has no Staff row, and `AuditLog.actorId` requires one. Every change is in `KitchenTicketTransition` with the token subject, kind and role.
- **End to end** (local binary, disposable database, real Nest-issued tokens): an owner token placed a takeaway order on Go, and the projector produced its ticket within the 200 ms poll. A KDS token from `POST /api/kiosk/kds/auth` listed the ticket and moved it to `preparing`. The order stayed `confirmed`, with no `PrinterJob`. SIGTERM stopped the projector and the server cleanly.
- **Not changed:**
  - The React KDS screens, `KdsDeliveryRecord`, `PrinterJob` and printers
  - The Nest order path, which writes no outbox event, so its orders get no tickets
  - Realtime, Check and Payment
  - Production

#### Remaining debt (recorded, not done in D4)

- **Realtime:** tickets are polled. There is no socket event yet.
- **Line-level kitchen state:** today's UIs track it in memory only.
- **Void and cancel:** voiding or cancelling kitchen work needs order and line cancellation.
- **Routing data:** a data-driven router needs a product/category → station model.
- **Tickets for Nest-path orders:** they appear only once order creation moves to Go.
- **Operator tooling:** there is none for parked outbox events (SQL for now).
- **Two kitchen models during the migration:** `Order.status` driven by the legacy KDS, and `KitchenTicket` driven by Go. No client uses the second yet. Switching the KDS (Phase E) retires the first for Go orders.

### Phase D5 result

The audit of the current financial flow and the design are in [d5-checks.md](d5-checks.md).

- **What a check is.** A check is a financial obligation. It is not an order, a kitchen ticket, a payment or a settlement, and it is never inferred from their states. Its statuses are `open` and `voided`; paid, closed and settled wait for D6.
- **Schema** (migration `20261002000000_checks`, additive; no historical rows and no fabricated checks):
  - `Check` has `(venueId, idempotencyKey)` unique and no uniqueness on the table session, so split bills stay possible.
  - `CheckLine` is a copy of the order line's accepted snapshot.
  - A partial unique index `CheckLine(orderItemId) WHERE voidedAt IS NULL` means an order line is on at most one standing check.
  - A composite foreign key `(orderItemId, orderId)` → `OrderItem(id, orderId)`.
  - RESTRICT on orders, order lines and sessions a check bills.
  - CHECKs: total = gross, void fields set exactly when voided, currency format, key length, positive quantities and positions.
- **Money:**
  - A request names a table session or orders, never an amount. Amounts a client sends are ignored.
  - Lines copy the accepted unit and line totals. A menu price change before or after billing changes nothing.
  - Tax is `pricing.ComputeTotals` on the check subtotal. A one-order check equals its order's totals.
- **Visits:**
  - A visit with several orders (staff and Order Tablet, across rounds) is billed on one check.
  - A later round is billed on a second check of the same visit.
  - Takeaway is billed without a session, and none is fabricated.
  - Mixed visits, and table orders mixed with takeaway, are refused.
  - Only Servvia Core orders can be billed. Legacy orders keep their own flows.
- **Idempotency** is database-backed:
  - A replay returns the check (200). This holds even after new rounds arrive.
  - The same key with a different request is 409 `IDEMPOTENCY_CONFLICT`, and nothing is created.
  - 24 concurrent identical creates produce one check. Losers that waited on the order locks re-read the key under the lock and replay, rather than reporting "nothing to bill".
- **Concurrency:**
  - A create locks the orders `FOR UPDATE` in id order, the lock a new round takes.
  - 12 competing creates over one visit produce one check with every line once.
  - In 15 rounds each raced against a create, no round was split across checks, and in the end every line was billed exactly once.
- **Void** (admin, manager and owner only):
  - It needs the version and a reason, and it is idempotent: 12 concurrent voids produce one write and one audit row.
  - It releases the lines so they can be billed again.
  - It changes no order, kitchen ticket or table session.
  - D6 must refuse to void a check that has payments.
- **Audit.** `CHECK_CREATED` and `CHECK_VOIDED` are written in the transaction, with `resource = 'check'`. Replays and key conflicts are best-effort. There is no outbox event.
- **Authorization:**
  - Staff only. Create and read: owner, admin, manager, cashier. Void: owner, admin, manager.
  - Refused (403): KDS devices, the kitchen and viewer roles, and customer tablets.
  - Organization and venue isolation as for orders.
- **Independence**, checked by tests: kitchen tickets' status and version are unchanged; orders stay `confirmed`; sessions stay `open` at version 1. No `Payment`, `PaymentObservation`, `POSSyncRecord`, `PrinterJob` or `ConnectorCommand` row is created.
- **Not changed:**
  - Every client
  - The Nest order, kiosk Stripe and Close Table flows
  - The unused `Payment` model
  - Production

#### Rule for D6

A check is a snapshot of the lines it bills. Rounds submitted later are not on it. Before payment is taken for a visit, D6 must account for lines on no standing check (bill them on another check, or refuse to settle the visit), and must not treat one check as the whole visit.

### Phase D6 result

The audit, model decisions and trust boundary are in [d6-payments-settlement.md](d6-payments-settlement.md).

- **Model:**
  - `CheckPayment` is a provider-neutral tender. A check can have many.
  - `CheckPaymentTransition` is the append-only history.
  - `CheckSettlement` is the durable fact, exactly once per check.
  - A check becomes `settled` in the same transaction as its settlement.
  - The legacy reservation `Payment` model is untouched and marked legacy, with a retirement path. There is no PaymentAttempt model, and the reason is in the note.
- **Tender type is `card` only.** Cash depends on shifts and cash drawers.
- **States:**
  - `pending` → `succeeded` | `failed` | `uncertain`, and `uncertain` → `succeeded` | `failed`.
  - `uncertain` holds its amount, never settles, and is never retried or failed automatically.
  - A different result for a final payment is refused (409).
- **Balance** is computed on the server under the check's row lock: paid = succeeded; held = pending + uncertain; available = total − paid − held.
- **Overpayment** is impossible:
  - A tender must fit the available amount.
  - In a deterministic race test (the test holds the payment table so every tender reaches its balance read before any can insert), 16 tenders for the final balance produce exactly one payment.
  - With the row lock removed, the same test fails with two winners. That proves the lock is what enforces it.
  - 12 concurrent success reports make one write and one settlement. Two halves succeeding together settle once.
- **Idempotency:**
  - A retry after a lost response, before or after the result, returns the original payment and never tenders twice.
  - The same key with a different request is 409.
  - 24 concurrent identical tenders produce one payment.
- **Check void:**
  - A voided check takes no payment.
  - A check with a `pending`, `uncertain` or `succeeded` payment cannot be voided (`CHECK_HAS_PAYMENTS`), and neither can a settled one (`CHECK_NOT_OPEN`).
  - Failed-only payments do not block a void.
  - The guard runs under the same row lock payments are initiated under.
- **Visits:**
  - Settling one check does not complete the visit or close its session.
  - A later round is never absorbed into a settled check.
  - [`checks/visit-financially-complete.sql`](checks/visit-financially-complete.sql) is the invariant the future close-visit workflow must enforce, and a test proves it: complete only when every standing check is settled **and** no round line is unbilled.
- **Trust boundary:**
  - Staff (owner, admin, manager, cashier) initiate tenders and read.
  - Only the payment adapter reports results, on `/api/internal/payment-adapter/...` with its own secret (constant-time compare). The route is absent unless `SERVVIA_CORE_PAYMENT_ADAPTER_TOKEN` is set. *(Superseded in D8: the route now authenticates a per-venue `payment_adapter` device, and the global secret is retired.)*
  - Staff JWTs, including the owner's, and KDS tokens get 401 on that route. The adapter secret gets 401 on staff routes.
  - KDS devices, the kitchen and viewer roles, and customer tablets are refused.
- **Audit:**
  - Staff actions go in `AuditLog`: `PAYMENT_CREATED` in the transaction, replays and conflicts best-effort.
  - Every status change goes in `CheckPaymentTransition`, with actor id and kind.
  - The settlement row is the settlement's own record. There is no fake staff actor for adapter results.
  - There is no outbox event, and the D4 outbox is untouched.
- **Independence:** orders (status, totals, `updatedAt`), kitchen tickets and the table session are unchanged by payments and settlement. No `PaymentObservation`, `POSSyncRecord`, legacy `Payment` or `ConnectorCommand` row is created.
- **Not changed:**
  - The kiosk Stripe flow, and its charge-before-order defect (stabilisation track)
  - Every client
  - Production

#### Still to do in later phases

- **Refunds and reversals:** their own records. Settlement revocation would then relax the settlement index to "one unrevoked settlement".
- **Cash tender and change:** belongs with shifts and cash.
- **Per-venue adapter identities:** belong with devices and Venue Edge.
- **Reconciliation tooling** for payments that stay uncertain.
- **Close-visit workflow:** use the invariant query above.

### Phase D7 result

The audit (no shift, till, drawer or cash-up concept existed) and the decisions are in [d7-shifts-cash.md](d7-shifts-cash.md).

- **Model:**
  - A `Shift` is owned by one staff member at one venue. It records the opening float and, at close, the count, the expected cash and the variance, which never change afterwards.
  - Each successful cash payment is exactly one `CashMovement` of kind `cash_sale`.
  - Tender type `cash` is added.
  - Nothing is fabricated for history: card payments need no shift.
  - There is no terminal, drawer or hardware. A terminal or drawer link is an additive column for the devices phase.
- **Cardinality.** A partial unique index allows at most one open shift per (venue, staff). Several staff may be open at once.
  - Under a forced race (inserts held), 24 concurrent opens produce exactly one open shift.
  - With the index dropped, the same test fails: all 24 open.
- **Cash tender.** `POST /checks/{id}/payments` with `tenderType: cash` is **succeeded at once**. One transaction does all of this, all or nothing: lock the check, then the tendering staff member's open shift (shifts' `Ledger`), then write the payment, its history, the movement, a `CASH_PAYMENT` audit row and any settlement.
  - Without an open shift it is 409 `NO_OPEN_SHIFT`, and nothing is written.
  - The D6 balance, hold and settlement code is shared: the settlement helper is used by both card results and cash.
- **The card boundary is unchanged.** Card starts `pending`, and only the adapter reports a result. The adapter route cannot change a cash payment: reporting `failed` on one is 409.
- **Expected cash** is the opening float plus cash sales, computed on the server. Card payments in any status never change it (tested for pending, uncertain, succeeded and failed). Variance = counted − expected, and a CHECK constraint enforces it.
- **Close versus cash, forced in both orders.** The test holds the shift row, and the two callers queue in a known order:
  - When the tender is first, it is wholly on the shift before it closes, and the close counts it.
  - When the close is first, the tender is refused and writes nothing.
  - With the shift lock removed, the close-first case accepts cash onto a closing shift, and the stored close disagrees with the movements. The test fails, which proves the lock is what protects this.
- **Idempotency and concurrency:**
  - A lost-response retry returns the original payment, with no second movement.
  - The same key used for card is 409.
  - 24 identical cash tenders produce one payment and one movement.
  - 16 cash tenders for the final balance, with inserts held, produce one winner and one settlement.
- **Split tender.** Cash and card on one check settle exactly once. Cash that pays in full settles the check, with actor kind `staff`.
- **Authorization:**
  - Open your own shift, and tender cash: owner, admin, manager, cashier.
  - Read and close: the shift's owner. Owner, admin and manager may act on any shift at the venue; for a cashier, another's shift is 404.
  - Refused: KDS, kitchen, viewer, customer tablets.
- **Audit.** `SHIFT_OPENED`, `SHIFT_CLOSED` and `CASH_PAYMENT` are written in their transactions. Cash payments keep the D6 transition history.
- **Independence.** Orders, kitchen tickets and table sessions are untouched. Closing a shift settles or closes nothing else. No IdealPOS, POS sync, connector or observation state is created.
- **Not done:**
  - Paid-in/paid-out: no requirement in the repository, and no client may post ledger entries.
  - Change-giving: tendered = applied.
  - Drawer hardware, terminals, X/Z reports, business day, payroll, refunds, clients.

### Phase D8 result

The audit and the decisions are in [d8-devices-terminals.md](d8-devices-terminals.md).

- **Registries:**
  - `Device` is the **permanent** device registry. Kinds: `pos_terminal`, `order_tablet`, `kds`, `payment_adapter`. A kind says what the installation is and grants no staff role.
  - `TabletDevice`/`TabletEnrollment` (Order Tablet) and the KDS PIN are **transitional**. They are untouched and keep serving current clients, and retire when the Android Order Tablet and KDS migrate. The connector tables stay transitional until Venue Edge.
- **Credentials:**
  - Opaque `sdv1.<deviceId>.<secret>`, with 256 random bits.
  - Only `sha256(secret)` is stored, and a CHECK allows only a digest in that column.
  - Compared in constant time. An unknown device costs the same as a wrong secret.
  - Returned only by enrollment (201) and rotation. Never in list or get responses, logs, audit rows or URLs, and responses carry `Cache-Control: no-store`.
  - Every request loads the device, so revocation and rotation take effect immediately.
- **Payment adapter.** The D6 global secret `SERVVIA_CORE_PAYMENT_ADAPTER_TOKEN` is **removed**. Nothing used it, so there is no compatibility path, and setting it now has no effect (tested). The result route accepts only an active `payment_adapter` device registered at the path's venue, and the result and settlement are attributed to the device. Refused:
  - staff JWTs (owner included) and malformed credentials: 401
  - revoked devices and pre-rotation credentials: 401
  - KDS, POS and Order Tablet devices: 403
  - another venue's adapter: 403
- **Terminals:**
  - A logical POS station. Many per venue; the code is unique per venue.
  - Optionally bound to one active `pos_terminal` device of the same venue, and a device binds at most one terminal. The database enforces kind and venue through a composite foreign key plus a CHECK, including the MATCH SIMPLE null gap.
  - Disable is final and idempotent.
- **Shift terminal.** `Shift.terminalId` is optional, with a composite foreign key to the same venue. A new shift may name only an **active** terminal, checked under `FOR SHARE`, which a disable waits for. Existing shifts keep NULL, and disabling a terminal does not rewrite history. D7's one-open-shift-per-staff rule is unchanged; there is no per-terminal rule.
- **Administration.** Owner, admin or manager from a **staff login session** only: never a tablet (even elevated), never a device. Cashiers may read terminals. KDS and kitchen are refused. A device credential on any staff route is 401.
- **Audit.** `DEVICE_ENROLLED`, `DEVICE_CREDENTIAL_ROTATED`, `DEVICE_REVOKED`, `TERMINAL_CREATED`, `TERMINAL_DISABLED`, `TERMINAL_DEVICE_BOUND` and `TERMINAL_DEVICE_UNBOUND`, in their transactions. Tests prove neither a secret nor a verifier appears in `AuditLog`.
- **Proven by mutation:**
  - The kind check, the venue check, the terminal-code index and the enrollment-key index each fail their tests when removed.
  - Races are forced (inserts held), so the indexes, not timing, decide.
- **Not done:**
  - Hardware of any kind; printers
  - Venue Edge, and KDS/tablet migration
  - A device-JWT exchange (opaque credentials suffice)
  - Waiter-tablet, kiosk, window-display and venue-edge kinds (added when those phases need them)

### Phase D9 result

The audit and the decisions are in [d9-refunds-reversals.md](d9-refunds-reversals.md).

- **Model:**
  - `PaymentAdjustment` has kind `refund` (staff) or `reversal` (the payment adapter device), always against one payment.
  - `PaymentAdjustmentTransition` is its append-only history.
  - Statuses and results reuse the D6 state machine (`payments.DecideResult`).
  - Card refunds start `pending`. Cash refunds and reversals are `succeeded` at creation.
  - There is no provider SDK; the result reference is metadata.
- **Capacity.** Per payment: amount − (succeeded + pending + uncertain returns). It is decided under the check, then payment, row locks, and pending or uncertain returns **reserve**. In a forced race (inserts held), 16 refunds of 1500 against 2549 produce exactly one; with the locks removed, all 16 win. The locks are what protects this.
- **Effective paid** is succeeded payments − succeeded returns. It is computed once, in `payments.ComputeBalance`, and used by the balance, settlement, summary and visit query. Failed, pending and uncertain returns are not money returned.
- **Settlement lifecycle.** This is additive, and **no constraint is dropped**:
  - `CheckSettlement` remains the single current row per check, with new `status` (`settled`/`revoked`), `cycle`, `revokedAt` and `version`.
  - `CheckSettlementTransition` records every `settled` and `revoked` event, with its cause (payment or adjustment) and actor.
  - The migration backfills each existing settlement's own `settled` event from its row. This was verified on a real D8 → D9 upgrade.
- **Revocation and re-settlement.**
  - A succeeded return that leaves a settled check owing revokes the settlement and reopens the check, in the same transaction. A later payment settles it again (cycle + 1).
  - Tested end to end: `settled#1, revoked#1, settled#2, revoked#2`, with one settlement row.
  - 8 concurrent result retries produce one change and one revocation.
  - Sessions, orders and kitchen tickets are untouched.
- **Uncertain refunds** reserve their amount, are never retried or failed automatically, and reconcile once. A conflicting final result is 409, and a failure releases the capacity.
- **Cash refunds** are for a succeeded cash payment. The refunding staff member (owner, admin or manager) must have an open shift, which may differ from the sale's shift; the sale's shift is not rewritten. It is one transaction: the adjustment, its transition, a `CashMovement(cash_refund)` (positive, kind gives direction), any revocation, and `CASH_REFUND_SUCCEEDED` / `SETTLEMENT_REVOKED` audit.
  - Expected cash = float + cash sales − cash refunds. Card refunds never touch cash.
  - Refund versus shift close is forced in both orders: the refund is wholly counted, or refused with nothing written. With the shift lock removed, the test fails.
- **Reversals** are card only and capacity-checked, and they revoke settlement exactly like refunds. There is **no staff endpoint**, and the kind stays distinguishable in reporting.
- **Check void.** A check may now be voided once no payment or return is pending or uncertain **and** effective paid = 0 (every succeeded tender fully returned). All history is kept. Otherwise `CHECK_HAS_PAYMENTS`; a settled check is `CHECK_NOT_OPEN`.
- **Trust boundary:**
  - Refunds are requested and read by owner, admin and manager. Refused: cashier, kitchen, KDS, customer tablets, and devices on staff routes.
  - Refund results and reversals come only from the venue's active `payment_adapter` device. Refused: staff JWTs, KDS, POS and tablet devices, other venues' adapters, and revoked adapters.
- **Visit completeness.** The query also requires no pending or uncertain payment, refund or reversal. A test shows a pending, then uncertain, refund keeps the visit incomplete until it resolves.
- **Not done:** provider SDKs, chargebacks, receipts, visit close, paid-in/paid-out, clients.

### Phase D10 result

The audit and the decisions are in [d10-visit-close.md](d10-visit-close.md).

- **One close.** `POST /venues/{venueId}/table-sessions/{sessionId}/close` (D2) is the only close. It now refuses with 409 `VISIT_NOT_FINANCIALLY_COMPLETE` and a `readiness` of four counts (open checks, unbilled lines, unresolved payments, unresolved adjustments) unless all are 0. The rule is executed in Core (`tables/pgstore.closeReadiness`) under lock in the close's own transaction; `checks/visit-financially-complete.sql` stays as the read-only documentation and a test proves the two agree on every case. Kitchen state and `Order.status` are not consulted.
- **Idempotent by state.** Closing a closed session returns 200 unchanged (no second transition, no second audit); 24 concurrent closes produce one transition and one `TABLE_SESSION_CLOSED` audit, which now records the readiness. A stale version on an open session is still 409 `VERSION_CONFLICT`. Cancel of a cancelled session is likewise 200.
- **Global lock order: TableSession → Order → Check → CheckPayment → Shift.** Round submit now locks its session before its order (it was the reverse); check create locks the sessions of its orders `FOR SHARE` (open required) on both paths. Close holds the session `FOR UPDATE` and the visit's checks `FOR SHARE`. Money work never locks a session.
- **After close:** new orders, rounds and checks for the visit are 409 `TABLE_SESSION_NOT_OPEN`. Payment results, refunds, reversals, re-settlement and voids of its checks still apply and never reopen the session (tested: a post-close refund reopens the check, re-settlement makes cycle 2, the session stays closed at its version).
- **Races, forced in both orders** (the test holds the session or check row and releases it once both requests are queued): close vs order, round, check by session, check by order, final payment result, reversal and refund request. Every outcome is either "obligation first, close refused and counts it" or "close first, obligation refused" (or, for money, "close first, correction applies, session stays closed"). Next open on the same table waits for an in-flight close and succeeds after commit, or gets `TABLE_SESSION_ALREADY_OPEN` if the close rolls back.
- **Mutations (all caught, all restored):** round without the session lock; check-by-order without `lockOpenSessions`; order create without the session lock; both check-create session guards removed; close without the checks `FOR SHARE`; the `TableSession_one_open_per_table` index dropped (disposable DB, recreated). Removing only the session path's open check in check create is **not** caught, because `lockOpenSessions` covers the same orders: defence in depth, recorded rather than hidden.
- **Cancel** still refuses a session with any order (`TABLE_SESSION_HAS_ORDERS`), so it cannot bypass close.
- **Tests changed to D10 semantics:** D2 close retry (now 200), D2 concurrent change test, and two D3 tests that closed a session with unbilled orders (now refused; they use a fixture `endVisit` to reach "ended").
- **Not done:** a `table_session.closed` event (candidate for the realtime phase), clients, promotions, workers.

### Phase D11 result

The audit and the decisions are in [d11-promotions.md](d11-promotions.md).

- **Promotion is canonical Servvia state.** Each promotion belongs to one venue. It is a percentage in basis points (1..10000) and targets all items, some categories or some menu items (ids checked against the organization). It has an optional UTC window `[startsAt, endsAt)` and a status of `inactive` (at creation) or `active`. It uses version CAS and is never deleted. Fixed amounts, codes, stacking, BOGO, loyalty, vouchers, organization-wide promotions and recurring local-time windows are **deferred**: nothing requires them.
- **The server owns eligibility and the amount.** A client names `promotionId` on an order create or a round, and nothing else. A `discountCents` on the request or on a line is refused with 400. Pricing (D1) computes the discount: basis points of the submission's eligible subtotal, rounded half up once, allocated by largest remainder. It also computes GST, the contained 3/23 of the **discounted** total. There is no second pricing engine and no "calculate discount" endpoint.
- **Snapshots.** `AppliedPromotion` (at most one per round) freezes the promotion id, version, name, rate, target, eligible subtotal and discount. Each discounted `OrderItem` carries its share. `Order.discountCents` is the sum of the line shares, and `totalCents = subtotalCents - discountCents`. A check copies each line's `discountCents` and never looks up a promotion. Refunds are unchanged: they never reprice.
- **Concurrency.** The order's transaction locks the promotion `FOR SHARE` at the evaluated version (lock order: TableSession → Order → Promotion). A change that commits first gets the order refused with 409 `PROMOTION_CHANGED`. This was proven by holding the row mid-change and by 30 orders racing 6 updates: 27 committed, 3 were refused, and every snapshot matches exactly one version from the audit history. Concurrent same-version updates produce one winner.
- **Idempotency.** `promotionId` is part of the order and round fingerprints. The fingerprint of a request without a promotion is unchanged: a test recomputes the pre-D11 formula. A replay returns the stored discount without re-evaluating, even after the promotion was disabled.
- **Schema.** The migration is additive. The one exception is that D5's `Check_total_is_gross` is replaced by `Check_total_is_discounted_gross`, which is identical for every existing row. The D10 → D11 upgrade was rehearsed on a seeded D10 database (Nest order with a negative line, Go orders, open, voided and settled checks): money was byte-identical before and after, and no drift.
- **Mutations (all caught, all restored by checksum):** dropping the version check in the promotion lock, bypassing category eligibility, and truncating instead of rounding half up.
- **Test changed:** D5 `TestCheckSchemaInvariants` expects the renamed constraint (the same row is refused).
- **Not done:** Admin Console screens; promotion events (candidate facts listed in the contract); check-time manual discounts or comps; removing the customer website's client-side `VERDURA10` (at that client's cutover).

### Phase D12 result

The audit and the decisions are in [d12-realtime.md](d12-realtime.md).

- **Transport.** Raw WebSocket at `GET /api/realtime` from Go Core, using `github.com/coder/websocket` v1.8.15 (MIT, no dependencies). There is no Socket.IO in Go. The Nest `orderUpdate` gateway is unchanged; [orders-socket.md](../../contracts/realtime/orders-socket.md) is now marked legacy and frozen.
- **Durable publication.** Every canonical change records its fact in `RealtimeEvent` **inside its own transaction**: table sessions, orders and rounds, the kitchen projector and ticket transitions, checks, payments (via `transition()`), settlements, refunds and reversals, shifts and promotions. The organization and venue are derived from `Venue` by the insert. A fact that cannot be recorded fails the change. The log is not a queue: each instance tails it with an in-memory `(txId, sequence)` cursor, bounded by the snapshot `xmin`, so a late-committing transaction is never skipped. It is pruned after 24 h.
- **D4 untouched.** `OutboxEvent` and its projector progress columns are unchanged and never read by realtime. `order.round_submitted` has one definition (`contracts/events/catalog.md`), and the realtime payload equals the outbox payload's shared fields (tested).
- **Least privilege.** The server grants streams (kitchen, operations, financial). KDS tokens and D8 `kds` devices get kitchen only. Viewer, customer tablets and D8 `order_tablet`/`pos_terminal`/`payment_adapter` credentials are refused. Venue and organization isolation is enforced at subscribe time (pinned tokens, organization check) and at fan-out (venue **and** organization). After `subscribed`, any client message closes the socket (1008).
- **Lifetime.** Expired tokens (4401 `TOKEN_EXPIRED`) and revoked tablets or devices (re-checked every 60 s) are cut off. Connections outlive the HTTP server's read and write timeouts (deadlines are cleared on upgrade; tested). Draining refuses upgrades (503), closes subscribers with 1001, and leaks no goroutines.
- **Backpressure.** Each connection buffers 256 events. A stalled subscriber is closed with 4008 `SLOW_CONSUMER` while writes and other subscribers continue (tested with a 3,000-fact burst).
- **Mutations (all caught, all restored by checksum):** accepting a pinned token's forged venue; dropping the organization check in fan-out; tailing without the `xmin` horizon (the late commit was then skipped); letting an unrecordable fact pass; giving the KDS the financial stream.
- **Found and fixed while testing:** an unanswered subscribe must be refused with `BAD_REQUEST` and 4400. It was not, because cancelling a WebSocket read's context closes the socket, so the first message is now read with a timer.
- **Not done:** client cutover, a Socket.IO bridge, replay cursors, Redis fan-out (not needed: the database log already fans out), device-administration facts. D13 generalises workers and the outbox.

### Phase D13 result

The audit and the decisions are in [d13-outbox-workers.md](d13-outbox-workers.md).

- **One fact log, per-consumer progress.** Every canonical change records its fact in `DomainEvent` inside its own transaction (the D12 catalog and envelope, unchanged), plus one `EventDelivery` per subscribed work consumer. Progress (status, attempts, `availableAt`, lease, error, outcome) is on the delivery, never on the event. One consumer's success, failure or dead letter never touches another's (tested).
- **Workers.** `internal/workers` claims with `FOR UPDATE SKIP LOCKED` and a lease, re-validates the lease when processing, runs the handler in the delivery's transaction, and backs off exponentially (1 s to 5 min). A permanent error or the tenth attempt makes the delivery `failed`: kept, inspectable, explicitly retryable, never deleted. Shutdown releases in-flight deliveries. Delivery is at least once.
- **D4 converged.** Orders no longer write `OutboxEvent`. The D4 projection logic runs as the `kitchen_projector` consumer; the legacy loop only drains rows written before D13 (tested). Both are idempotent on the same unique keys, and a ticket's `sourceEventId` is now the domain event id.
- **D12 preserved.** The realtime dispatcher tails `DomainEvent` with the same xmin-bounded cursor; the protocol, grants and envelope are unchanged, and all D12 tests pass. `RealtimeEvent` is no longer written and is kept until an approved drop.
- **Operations.** `GET /api/admin/workers` (owner or admin) returns counts per consumer and the oldest pending age for the caller's organization only: no payloads or errors. Retention: 7 days (`SERVVIA_CORE_EVENT_RETENTION`), and never while a delivery is pending or failed.
- **Out of the event system:** `KdsDeliveryRecord`, printer jobs, the BullMQ queues and the legacy integration's tables. The architecture guard now also scans `internal/events` and `internal/workers`.
- **Mutations (all caught, all restored by checksum):** removing `SKIP LOCKED` from the claim (the locked-row test blocks and times out); removing lease validation at processing (a worker whose lease was taken over ran the delivery again).
- **Found and fixed while testing:** the lease check read `leaseExpiresAt > now()` into a boolean, so a delivery completed by another worker (lease cleared) failed with a scan error instead of the explicit lease-lost path; the expression is now NULL-safe. The Go parity cleanup did not remove the facts Go's writes recorded for its fixture venues, which the kitchen worker would later dead-letter; it now does.
- **Not done:** a retry endpoint (the function exists; exposing it is an operator-console decision), further business consumers (notifications, printing, analytics arrive with their phases), dropping `OutboxEvent` and `RealtimeEvent`, client cutover.

## Known finding: API production entry point (resolved 2026-10-03)

`apps/api/scripts/connector-command-harness.ts` (committed 2026-08-24) is inside the API's TypeScript build scope, so `nest build` emits `dist/src/main.js`. `npm run start:prod`, the backend Dockerfile's `CMD` and `docker/start-backend.mjs` all ran `node dist/main`, which did not exist. **Resolved (Story 1.4):** `start:prod` now runs the emitted `dist/src/main`. The build output is unchanged, and the Dockerfile and `start-backend.mjs` delegate to `start:prod`. CI runs `scripts/check-api-entry.mjs` after the build, and it fails if they diverge again. How the Windows host starts `VerduraAPI` is configured on the host and remains NOT VERIFIED; check it before the next deployment.

## Known environment finding (not yet addressed)

The native-round recovery sweep compares Prisma `timestamp without time zone` columns against `now()` in SQL. On a Postgres session whose `TimeZone` is not UTC, it misjudges age: 9 of the 16 tests in `native-round-recovery.integration-spec.ts` fail on a `Pacific/Auckland` cluster and pass on UTC. The repo's Docker Postgres runs in UTC. The Dunedin host's native Postgres 18 timezone has not been verified. Check it before relying on native-round recovery there.
