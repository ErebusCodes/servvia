# Servvia Core Platform (Go)

This is the Go service that will own Servvia's canonical restaurant state ([ADR 0001](../../docs/adr/0001-servvia-is-the-operational-pos.md)). It runs **alongside** the NestJS API (`apps/api`) during the strangler migration and takes over one capability at a time. It serves **no production traffic** yet.

| | |
|---|---|
| Go | **go1.27.1** (`go.mod`). Use the repo-local toolchain; see below. |
| Owns today | Health and readiness probes. At parity with Nest, **not yet serving callers**: the channel menu read `GET /api/menu/venues/{venueId}/channel/{channel}` and the venue tax configuration `GET /api/venues/{id}/tax-config`. Internally: the organization/venue read model and the canonical pricing authority (`internal/pricing`). **New Servvia-native (no Nest equivalent):** table sessions (`contracts/openapi/table-sessions.yaml`), the canonical order core (`contracts/openapi/servvia-orders.yaml`) kitchen tickets (`contracts/openapi/kitchen-tickets.yaml`, projected from `order.round_submitted` by the `kitchen_projector` worker), checks (`contracts/openapi/checks.yaml`), payments and settlement (`contracts/openapi/payments.yaml`), shifts and cash accountability (`contracts/openapi/shifts.yaml`), devices and terminals (`contracts/openapi/devices.yaml`), refunds and reversals (`contracts/openapi/refunds.yaml`), promotions (`contracts/openapi/promotions.yaml`, applied through orders) canonical realtime (`GET /api/realtime`, `contracts/realtime/servvia-realtime.md`) and the generic domain-event log and workers (`contracts/events/README.md`, backlog at `GET /api/admin/workers`), the capabilities that write |
| Database | The Prisma-managed schema, session `TimeZone=UTC`. **Read-only by default** (`default_transaction_read_only=on`). With `SERVVIA_CORE_DB_READ_ONLY=false` the pool is read-write for table sessions, canonical orders, kitchen tickets, checks, payments, refunds, shifts, devices and terminals, and promotions, and the workers run; otherwise they answer 503 and reads still work. Prisma remains the only migration authority; this service has no migrations. |
| Auth | Verifies Nest-issued access tokens: HS256, `JWT_ACCESS_SECRET`, no leeway, `sub`, `role` and `organizationId` required. Ports `resolveVenueScope`, `RolesGuard` and `TabletTokenActiveGuard`. See `contracts/schemas/auth-token-claims.schema.json`. |
| Redis | The **same** Redis as the Nest API, for the rate limiter only. Both services run Nest's Lua script on the same keys, so a client has one budget whichever service answers. |

## Layout

```
cmd/api/                 entry point: config, pool, routes, graceful shutdown
internal/config/         environment configuration
internal/platform/httpx/ request/correlation IDs, access log, panic recovery, Nest security headers, Nest error bodies;
                         Express-compatible router, CORS, CSRF cookie, weak ETag / 304 (router.go, nestcompat.go)
internal/platform/postgres/  read-only pgx pool
internal/ratelimit/      Redis sliding-window limiter shared with Nest's RateLimitGuard
internal/health/         /health (liveness) and /ready (PostgreSQL ping, draining on shutdown)
internal/identity/       access-token verification, venue scope, roles, tablet revocation, Authenticate middleware
internal/venues/         organization and venue read model (no external-POS columns), tax-config handler
internal/pricing/        pure price authority: lines, modifiers, expected-price check, discount math (percent, allocation), NZ GST, integer cents
internal/pricing/pgcatalog/  loads the pricing catalog from PostgreSQL
internal/tables/         table-session rules and service (no HTTP, no SQL)
internal/tables/pgstore/ transactions, row locks, version CAS, audit log
internal/tables/tablesapi/  table-session HTTP API
internal/orders/         canonical order rules, fingerprint, service (no HTTP, no SQL)
internal/orders/pgstore/ order/round/line/audit transactions (facts via events/pgstore)
internal/orders/ordersapi/  canonical order HTTP API
internal/kitchen/        kitchen-ticket rules, transitions, routing seam, service (no HTTP, no SQL)
internal/kitchen/pgstore/  ticket store (row lock, version CAS, transition history) and the projector (kitchen_projector consumer; drains legacy OutboxEvent)
internal/kitchen/kitchenapi/  kitchen-ticket HTTP API
internal/checks/         check rules (financial obligation), fingerprint, service (no HTTP, no SQL)
internal/checks/pgstore/ check transactions: order locks, standing-line uniqueness, void, audit log
internal/checks/checksapi/  check HTTP API
internal/payments/       payment and settlement rules: result state machine, balance, fingerprint, service (no HTTP, no SQL)
internal/payments/pgstore/  check-then-payment row locks, holds, settlement, transition history, audit log
internal/payments/paymentsapi/  payment HTTP API: staff routes and the adapter-only result route
internal/shifts/         shift rules: expected cash, close decision, access (no HTTP, no SQL, no hardware)
internal/shifts/pgstore/ shift store (open index, close under the shift lock) and the cash Ledger used inside a cash payment's transaction
internal/shifts/shiftsapi/  shift HTTP API
internal/devices/        device registry and terminals: credentials (opaque, sha256 verifier), kinds, authentication, service
internal/devices/pgstore/ device and terminal store (row locks, version checks, audit)
internal/devices/devicesapi/  device/terminal HTTP API and the device-credential middleware (payment adapter route)
internal/refunds/        refund/reversal rules, fingerprint, service (repository: payments/pgstore.AdjustmentStore, same transactions as payments)
internal/refunds/refundsapi/  refund HTTP API: staff routes and the payment-adapter device routes
internal/promotions/     promotion rules: terms, eligibility (venue, status, window, target), admin service (no HTTP, no SQL, no money math)
internal/promotions/pgstore/ promotion store (version CAS under FOR UPDATE, audit); orders lock a promotion FOR SHARE at the evaluated version
internal/promotions/promotionsapi/  promotion administration HTTP API
internal/events/         canonical domain events: fact, envelope, catalog, work-consumer registry and subscriptions (no HTTP, no SQL)
internal/events/pgstore/ DomainEvent + EventDelivery: Record (inside each domain transaction), gap-free log tail, retention prune
internal/workers/        generic worker runtime: SKIP LOCKED claims, leases, lease validation, backoff, dead letters, backlog, retry
internal/workers/workersapi/  worker backlog HTTP API (GET /api/admin/workers)
internal/realtime/       realtime rules: stream grants by identity and audiences per fact, in-process fan-out hub (no HTTP, no SQL, no WebSocket)
internal/realtime/pgstore/ dispatcher: tails the domain event log and publishes to the hub
internal/realtime/realtimeapi/  WebSocket transport: authentication before subscription, streaming, backpressure, drain
internal/menu/           channel menu: store (SQL), resolver (rules), handler (HTTP)
internal/server/         route table
tests/architecture/      guard: no IdealPOS / external-POS concept in cmd/ or internal/
tests/contract/          Go output validated against contracts/
tests/integration/       real PostgreSQL and Redis (disposable)
tests/parity/            the running Nest API compared with Go, request by request
```

## Configuration

| Variable | Default | Notes |
|---|---|---|
| `DATABASE_URL` | required | Same variable as the Nest API |
| `JWT_ACCESS_SECRET` | required, at least 32 characters | Same secret as the Nest API. Production refuses the checked-in defaults. |
| `NODE_ENV` | `development` | `production` turns on the insecure-secret refusal |
| `SERVVIA_CORE_HTTP_ADDR` | `127.0.0.1:3100` | |
| `SERVVIA_CORE_DB_READ_ONLY` | `true` | `false` enables the approved writes: table sessions (D2), canonical orders (D3), kitchen tickets (D4), checks (D5), payments (D6), shifts (D7), devices and terminals (D8), refunds (D9), the financially-safe visit close (D10) and promotions (D11), and starts the kitchen projector. Routing clients to them needs its own approval. |
| `SERVVIA_CORE_DB_MAX_CONNS` | `10` | |
| `SERVVIA_CORE_READ_HEADER_TIMEOUT` / `_READ_TIMEOUT` / `_WRITE_TIMEOUT` / `_IDLE_TIMEOUT` | `5s` / `15s` / `30s` / `120s` | |
| `SERVVIA_CORE_SHUTDOWN_TIMEOUT` / `_READINESS_TIMEOUT` | `20s` / `2s` | |
| `SERVVIA_CORE_LOG_LEVEL` | `info` | JSON logs to stdout |
| `SERVVIA_CORE_REALTIME_POLL_INTERVAL` | `250ms` | How often the realtime dispatcher tails `DomainEvent`. The dispatcher also runs read-only. |
| `SERVVIA_CORE_EVENT_RETENTION` | `168h` (7 days) | How long a `DomainEvent` is kept. It is pruned only when every delivery succeeded, and only when writes are enabled. |
| `SERVVIA_CORE_KITCHEN_POLL_INTERVAL` | `1s` | How often the `kitchen_projector` worker claims due deliveries, and the legacy projector drains pre-D13 `OutboxEvent` rows (writes enabled only) |
| `REDIS_HOST` / `REDIS_PORT` | `127.0.0.1` / `6379` | Same variables as the Nest API. Must be the **same** Redis, or clients get two rate-limit budgets. |
| `TRUST_PROXY_HOPS` | `0` | Same as the Nest API (Express `trust proxy`). Decides the client IP in rate-limit keys, so it must match Nest's. A non-integer is refused at startup. |

On SIGINT or SIGTERM the service marks `/ready` as draining, refuses new realtime upgrades and closes open realtime connections with 1001, stops accepting connections and waits for in-flight requests up to the shutdown timeout. Then it stops the workers and the realtime dispatcher. A delivery being handled at that moment rolls back and its lease is released, so it is delivered again later (at least once).

## Toolchain

The toolchain lives in the git-ignored `scratchpad/toolchains/go`. `scratchpad/toolchains/goenv.sh` pins `GOROOT`, `GOPATH`, `GOCACHE`, `HOME` (so telemetry stays local) and `GOTOOLCHAIN=local` inside that directory, so nothing is written outside the repository.

```sh
. scratchpad/toolchains/goenv.sh
cd services/core-platform
gofmt -l . && go vet ./... && go test ./...
```

## Test layers

- **Unit and contract** (`go test ./...`) need nothing external. The contract tests validate Go's responses and token claims against `contracts/`.
- **Integration** needs a disposable local database with the Prisma schema:

  ```sh
  DATABASE_URL=<disposable> npx prisma migrate deploy        # in apps/api
  SERVVIA_CORE_TEST_DATABASE_URL=<disposable> go test ./tests/integration/
  ```

  The helper refuses non-local hosts and database names that look like production. The suite seeds and removes its own fixtures. Run it with a UTC server timezone. Set `SERVVIA_CORE_TEST_REDIS_ADDR=127.0.0.1:<port>` (a disposable local Redis) to include the limiter suite.
- **Parity** runs the real Nest API against the same disposable database:
  1. Migrate the database, then run `npm run seed` in `apps/api` with a `SEED_OWNER_PASSWORD`.
  2. Publish the seeded menu: `ORG_ID=<org> npx ts-node -r tsconfig-paths/register prisma/scripts/backfill-channel-visibility.ts --apply`.
  3. Build the API and start it from a directory **without** a `.env` file, with `DATABASE_URL`, the JWT secrets, `INTERNAL_SERVICE_TOKEN`, Redis and `KDS_VENUE_PINS`. The entry point is `apps/api/dist/src/main.js`.
  4. Run `go test ./tests/parity/` with the `SERVVIA_CORE_PARITY_*` variables listed at the top of `tests/parity/parity_test.go`, plus `SERVVIA_CORE_TEST_REDIS_ADDR` set to the Nest API's Redis.

  The pricing suite places real takeaway staff orders through Nest (`POST /api/admin/orders`) in two fixture venues and deletes them afterwards.

## Before any caller is switched to Go

The four HTTP gaps Phase C listed are closed (Phase D1), and parity covers them:

| Nest behaviour | Go |
|---|---|
| `RateLimitGuard`, Redis, 120 per 60 s per IP, method and raw path | Same script, key and member format on the same Redis: one shared budget, proven by alternating 120 requests between the services. Same 429 body and `Retry-After`; fails closed with the same 503. |
| CORS delegate (fixed allow-list, credentials, preflight 204) | `httpx.CORS`, same list; nothing widened |
| Express weak `ETag`, `If-None-Match` / 304 | `httpx.ETag`: byte-identical bodies give identical tags, so a validator from either service revalidates on the other |
| Case-insensitive literals, optional trailing slash, parameter decoding | `httpx.Router` (no routing library) |
| `CsrfMiddleware` (found in D1, not in the Phase C list) | `httpx.CSRF`: issues the same `csrf_token` cookie, enforces the same unsafe-method check |

Known, accepted differences (none changes a status code, JSON body or budget):

- A 204 preflight has no `Content-Length: 0`; Go's HTTP server never sends it on a 204 (RFC 9110 §8.6).
- A request-target with a **malformed** escape (`%ZZ`, a truncated `%A`) is refused by Go's HTTP server with a plain-text 400 before any handler runs. Nest answers 400 JSON `Failed to decode param`. Well-formed escapes of invalid UTF-8 get Nest's exact JSON body.
- No `X-Powered-By: Express`. Go adds `X-Request-Id` and `X-Correlation-Id`.
- `/ready` checks PostgreSQL only. A Redis outage shows up as 503 on rate-limited routes, as in Nest, not as unreadiness.

Switching a caller still needs its own approval: proxy routing, deployment and monitoring are not part of this service.
