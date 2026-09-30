# Servvia

Servvia is an enterprise-grade, multi-tenant restaurant operational POS and management platform built to orchestrate and scale hospitality workflows. It covers table service, ordering, kitchen production, bills, payments, cash accountability, devices, promotions, and live operational updates.

This repository is in an active migration. Servvia Core (Go) is becoming the canonical backend of Servvia's own operational POS. It is replacing the domain logic the original NestJS API owned, and progressively removing legacy external-POS dependencies. The target system is entirely Servvia-owned: Servvia Core, Servvia-native POS and device clients, PostgreSQL and language-neutral contracts. Legacy IdealPOS compatibility remains only where the migration still requires it, and is scheduled for retirement. See [ADR 0001: Servvia is the operational POS](docs/adr/0001-servvia-is-the-operational-pos.md) and the [migration plan and phase log](docs/migration/README.md).

## Contents

1. [Current status](#current-status)
2. [Architecture](#architecture)
3. [Tenancy](#tenancy)
4. [Canonical domain model](#canonical-domain-model)
5. [Repository structure](#repository-structure)
6. [Technology](#technology)
7. [Prerequisites](#prerequisites)
8. [Getting started](#getting-started)
9. [Configuration](#configuration)
10. [Database and migrations](#database-and-migrations)
11. [Servvia Core (Go)](#servvia-core-go)
12. [Realtime](#realtime)
13. [Media](#media)
14. [Testing and CI](#testing-and-ci)
15. [Engineering rules](#engineering-rules)
16. [Legacy migration components](#legacy-migration-components)
17. [Production and environments](#production-and-environments)
18. [Security](#security)
19. [Documentation map](#documentation-map)
20. [Contributing](#contributing)
21. [License](#license)

## Current status

**Implemented in Servvia Core (Go).** Each phase has an additive Prisma migration and contracts in `contracts/`, and was tested against disposable databases. None of this serves production traffic yet, and no client has been switched to it.

| Phase | Capability |
|---|---|
| D1 | Server-authoritative pricing: lines, modifiers, NZ GST, integer cents |
| D2 | Table sessions (the visit) |
| D3 | Orders and order rounds |
| D4 | Kitchen tickets, projected from a transactional outbox |
| D5 | Checks (the financial obligation) |
| D6 | Payments and settlement |
| D7 | Shifts and cash accountability |
| D8 | Devices and terminals |
| D9 | Refunds, reversals and settlement revocation |
| D10 | Financially safe table-session close |
| D11 | Promotions with immutable applied-discount snapshots |
| D12 | Canonical realtime over WebSocket |

**Still transitional or future:**
- Generic outbox and workers (D13).
- Servvia-native clients (the Windows POS and the Android device apps; see [Target clients](#target-clients)) and client cutover. Every existing web client still talks to the NestJS API.
- Venue Edge (local hardware and resilience).
- Retirement of the legacy migration components, including the IdealPOS compatibility integration.

The remaining phases are tracked in [docs/migration/README.md](docs/migration/README.md). The migration is not complete.

The existing production estate still contains legacy components while Servvia Core and the Servvia-native clients are completed. Those compatibility components are transitional and are not part of the target Servvia architecture. See [Legacy migration components](#legacy-migration-components).

## Architecture

### Target architecture

Every surface is a client of Servvia Core. None of them owns canonical business rules.

```
  Servvia clients
  Windows POS · Waiter Tablet · Order Tablet · Kiosk · KDS · Window Display
  Admin Console · Customer Website
        |            REST (contracts/openapi)  ·  WebSocket realtime (/api/realtime)
        v
  Servvia Core (Go)  ── canonical restaurant state: orders, kitchen, checks, payments,
        |               shifts, devices, promotions, realtime
        v
  PostgreSQL  ── the single source of truth; schema owned by Prisma migrations

  Redis ── transient infrastructure (shared rate limiting)
  Venue Edge (Go, future) ── local hardware and resilience: printers, payment
                             terminals, cash drawers. Never canonical POS state.
```

| Permanent | Transitional (being retired) |
|---|---|
| Servvia Core (Go): canonical backend, REST and realtime | NestJS API (`apps/api`): serves today's clients while its domain ownership moves to Servvia Core |
| PostgreSQL: canonical state | The current React implementations of venue-device surfaces (Order Tablet, KDS, Window Display/kiosk), until the native clients replace them |
| Prisma: the sole schema migration authority | The IdealPOS compatibility integration, POS sync and `ConnectorCommand` |
| Servvia-owned clients (see [Target clients](#target-clients)) | Legacy bridge, harness and tracer tooling |
| Servvia realtime (WebSocket) | The Socket.IO `orderUpdate` channel |
| Venue Edge (future) | |

### Target clients

These are the target implementations from ADR 0001. **The native clients are not implemented yet.**

| Surface | Target implementation |
|---|---|
| Windows POS terminal | C#/.NET |
| Waiter Tablet | Kotlin/Android |
| Order Tablet | Kotlin/Android |
| Kiosk | Kotlin/Android |
| KDS | Kotlin/Android |
| Window Display | Kotlin/Android |
| Admin Console | React/TypeScript |
| Customer Website | React/TypeScript |

### How the code runs today

Today's web clients (Admin Console, Order Tablet, KDS, Window Display, Customer Website) still call the transitional NestJS API over REST and Socket.IO. Servvia Core runs beside it on the same PostgreSQL schema. It verifies the NestJS-issued access tokens (same HS256 secret) and shares Redis for one rate-limit budget per client. Its APIs are ready for clients, but no client has been switched to them yet. The technology standard is [docs/architecture.md §10](docs/architecture.md#10--technology-standard-current-mvp-and-approved-target-architecture).

## Tenancy

Canonical state is scoped **Organization → Venue**. Every venue belongs to one organization, and every canonical record belongs to one venue.

Servvia Core resolves the scope on the server for every request and realtime subscription. The venue must belong to the caller's organization, and tokens or devices pinned to a venue cannot act at another. A client never supplies its organization, and a venue it names is always checked. The multi-tenant model is built in; it does not imply that every tenant or client has been migrated.

## Canonical domain model

These are the distinctions Servvia Core enforces.

| Concept | Meaning |
|---|---|
| TableSession | A restaurant visit at a table: occupancy, from open to close |
| Order | The goods requested |
| OrderRound | One submission of items within an order (round 1 is its creation) |
| KitchenTicket | Production work for a station |
| Check | A financial obligation for accepted order lines |
| Payment | Money tendered or received against a check |
| Refund / Reversal | Money returned or corrected |
| Settlement | The current satisfaction of a check (it can be revoked by returned money) |
| Shift | A period of staff and cash accountability |
| Device | An enrolled installation's identity (POS, tablet, KDS, payment adapter) |
| Terminal | A logical POS workstation |
| Promotion | A configured offer; what an order received is frozen as an applied snapshot |
| Realtime event | A notification that canonical state changed; not storage |

Details are in the phase notes under [docs/migration/](docs/migration/README.md).

## Repository structure

| Path | Contents |
|---|---|
| `services/core-platform/` | **Servvia Core (Go)**: canonical domains, HTTP and WebSocket API, tests ([README](services/core-platform/README.md)) |
| `apps/api/` | NestJS API (transitional). Also holds **`prisma/schema.prisma` and `prisma/migrations/`**, the single migration authority for all services |
| `apps/admin-console/` | React admin console. The same source builds the **Order Tablet** and **Kitchen Display** targets (`VITE_APP_MODE`) |
| `apps/order-tablet/`, `apps/kitchen-display/` | READMEs describing those two build targets (no separate source) |
| `apps/window-display/` | React window display (signage) and in-venue kiosk ordering |
| `apps/customer-website/` | React public website: menu and table booking |
| `contracts/` | Language-neutral contracts: OpenAPI, realtime, events, JSON schemas ([README](contracts/README.md)) |
| `docs/` | Architecture, ADRs, migration phase notes, integrations, deployment and environments |
| `scripts/` | Local development orchestration, guards and checks (Node) |
| `shared/` | Configuration and data shared by the web apps |
| `docker/`, `docker-compose.yml` | Container images and the local/host compose setup |
| `local-postgres/` | Optional native local PostgreSQL helper ([README](local-postgres/README.md)) |
| `windows-deploy/` | Operational scripts for the Windows production host |
| `_bmad/`, `_bmad-output/` | Project tooling, not application code: BMAD workflow configuration (used by `.claude/skills/bmad-*`), plus retained records such as legacy production runbooks, infrastructure migration evidence, GCS media migration records and the deferred-work log |

**Legacy migration and compatibility tooling.** These are scheduled for retirement and are not part of the target Servvia POS architecture:

| Path | Contents |
|---|---|
| `apps/idealpos-bridge/`, `apps/idealpos-bridge-ci/`, `apps/idealpos-harness/` | Legacy IdealPOS compatibility bridge, its CI subset, and a harness (.NET Framework 4.8, Windows) |
| `apps/venue-connector/` | Legacy IdealPOS observation tracer (.NET 8) |

## Technology

**Target Servvia stack:**

| Technology | Role |
|---|---|
| Go (1.27.1, `services/core-platform/go.mod`) | Servvia Core: canonical backend, REST, realtime; Venue Edge (future) |
| PostgreSQL | Canonical state (`postgres:16-alpine` locally) |
| Prisma | The sole schema migration authority (5.22) |
| Redis | Transient infrastructure: rate limiting today (`redis:7-alpine` locally) |
| C#/.NET | The Windows Servvia POS terminal (future) |
| Kotlin/Android | Dedicated in-venue Servvia clients (future) |
| React/TypeScript | Admin Console and Customer Website (React 18, Vite, Tailwind CSS, Vitest) |
| WebSocket | Realtime (Go Core, `coder/websocket`) |
| Google Cloud Storage | Content media |

**Transitional stack:** the NestJS API (NestJS 11, TypeScript 5, BullMQ, Socket.IO 4, ioredis), and the React implementations of the venue-device surfaces.

**Legacy migration code:** the IdealPOS bridge and harness (.NET Framework 4.8) and the venue connector/tracer (.NET 8). They exist only for migration compatibility and are scheduled for retirement.

## Prerequisites

| Tool | Needed for |
|---|---|
| Node.js and npm (a current LTS release) | The workspaces, local orchestration, the NestJS API and the web apps |
| Docker with Docker Compose | Local PostgreSQL and Redis (`npm run dev`, `npm run db:start`) |
| Go matching `services/core-platform/go.mod` | Building and testing Servvia Core |
| .NET SDK 8 | Only to build the legacy migration tooling (the venue connector); the .NET Framework 4.8 projects build on Windows only. Not needed for Servvia Core or the web apps. |

Cloud SDKs are not needed for local development. Media defaults to local storage.

## Getting started

```bash
git clone https://github.com/ErebusCodes/servvia.git
cd servvia
npm install            # also runs `prisma generate` for apps/api
npm run dev
```

`npm run dev` (`scripts/dev.mjs`) does the following on macOS, Windows and Linux:
1. Checks that Docker is running.
2. Starts PostgreSQL (`127.0.0.1:5434`) and Redis (`127.0.0.1:6379`) from `docker-compose.yml`.
3. Creates missing workspace `.env` files from the tracked `.env.example` files. Existing files are never overwritten.
4. Applies pending Prisma migrations (`prisma migrate deploy`).
5. Seeds the database only if it is empty.
6. Starts the NestJS API and every web app.

| Surface | Local URL | Start alone |
|---|---|---|
| NestJS API | http://localhost:3000 | `npm run dev:api` |
| Customer website | http://localhost:5173 | `npm run dev:customer-website` |
| Window display | http://localhost:5174 | `npm run dev:window-display` |
| Kitchen display | http://localhost:5175 | `npm run dev:kitchen-display` |
| Order tablet | http://localhost:5176 | `npm run dev:order-tablet` |
| Admin console | http://localhost:5177 | `npm run dev:admin-console` |

The ports are fixed in `scripts/dev-lock.mjs` (`CANONICAL_PORTS`). `npm run dev:status` and `npm run dev:stop` manage a running session.

Servvia Core is not started by `npm run dev`. To run it against the same local database:

```bash
cd services/core-platform
DATABASE_URL=<your local DATABASE_URL> JWT_ACCESS_SECRET=<same value as apps/api/.env> go run ./cmd/api
# listens on 127.0.0.1:3100 and is read-only by default (see Servvia Core below)
```

**Other useful root commands:**

| Command | Effect |
|---|---|
| `npm run db:start` / `db:stop` / `db:status` | PostgreSQL and Redis containers only (data preserved) |
| `npm run db:seed` | Re-run the idempotent seed |
| `npm run db:local:reset` | **LOCAL ONLY, destructive:** drops and rebuilds the local development database, then seeds it. It refuses any non-local `DATABASE_URL`. |
| `npm run validate:menu` | Validate the canonical menu data |

## Configuration

Every workspace has a tracked `.env.example`. Real `.env` files are per machine and git-ignored. **Secrets never go in the repository or in `VITE_*` variables** (those are bundled into browser code). Use environment variables or a secret manager.

**NestJS API** (`apps/api/.env.example`, the full list):

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection (Prisma) |
| `REDIS_HOST`, `REDIS_PORT` | Redis for queues and the rate limiter |
| `PORT`, `NODE_ENV`, `TRUST_PROXY_HOPS` | HTTP port, environment, trusted proxy hops |
| `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `JWT_*_EXPIRY` | Token signing (**secret**). The access secret is shared with Go Core. |
| `INTERNAL_SERVICE_TOKEN` | Service-to-service authentication (**secret**) |
| `KDS_VENUE_PINS`, `ADMIN_CONSOLE_PIN`, `ADMIN_CONSOLE_EMAIL` | Device and console access (**secret** in production; the development defaults are refused in production) |
| `SEED_OWNER_EMAIL`, `SEED_OWNER_PASSWORD`, `SEED_BILLING_EMAIL` | Seed data (**secret** password) |
| `STRIPE_SECRET_KEY` | Stripe (**secret**; optional; payment endpoints fail closed without it) |
| `RESEND_API_KEY`, `EMAIL_FROM`, `EMAIL_BOOKINGS_BCC` | Email (optional) |
| `MEDIA_STORAGE_PROVIDER` and `MEDIA_*`, `GCS_*`, `GCP_PROJECT_ID` | Media storage. The default `local` needs no cloud credentials. |

**Servvia Core** (`services/core-platform/internal/config`; the full table is in its [README](services/core-platform/README.md#configuration)):

| Variable | Default | Purpose |
|---|---|---|
| `DATABASE_URL` | required | The same database as the NestJS API |
| `JWT_ACCESS_SECRET` | required, at least 32 characters | Verifies Nest-issued access tokens. Production refuses the checked-in defaults. |
| `SERVVIA_CORE_DB_READ_ONLY` | `true` | **Safety default.** Every canonical write answers 503 until this is set to `false`. |
| `SERVVIA_CORE_HTTP_ADDR` | `127.0.0.1:3100` | Listen address |
| `REDIS_HOST`, `REDIS_PORT` | `127.0.0.1`, `6379` | Must be the same Redis as the NestJS API (shared rate-limit budget) |
| `SERVVIA_CORE_REALTIME_POLL_INTERVAL`, `SERVVIA_CORE_REALTIME_RETENTION` | `250ms`, `24h` | Realtime log tailing and pruning |

**Web apps** (`apps/*/.env.example`): `VITE_API_URL` (leave empty to use the dev proxy) and `VITE_VENUE_ID`.

## Database and migrations

**Prisma is the sole schema migration authority.** The schema and migrations live in `apps/api/prisma/`. Go Core has no migration framework: it reads and writes the Prisma-managed schema.

**Local and disposable databases:**

```bash
npm run db:migrate                                   # apply pending migrations (prisma migrate deploy)
npm run prisma:status --workspace=apps/api           # migration status
cd apps/api && npx prisma validate && npx prisma generate
```

**Making a schema change** (run in `apps/api`, against a disposable database):
1. Edit `prisma/schema.prisma`, then create the migration:
   ```bash
   npx prisma migrate dev --name <change>
   ```
   Or write the SQL yourself: generate it with `npx prisma migrate diff`, then add any hand-authored `CHECK` constraints. Migrations are additive, and existing migrations are never edited.
2. Verify from zero on an empty database:
   ```bash
   DATABASE_URL=<empty db> npx prisma migrate deploy
   ```
3. Verify the upgrade path on a database at the previous migration.
4. Check for drift:
   ```bash
   npx prisma migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel prisma/schema.prisma --exit-code
   ```
   Exit code 0 means no drift.

**Production migrations are not an everyday command.** Every production schema change needs its own explicit approval and procedure. The phase notes in [docs/migration/](docs/migration/README.md) record, per migration, its lock behaviour and rollback.

## Servvia Core (Go)

`services/core-platform` is the canonical backend of Servvia's own POS. PostgreSQL is authoritative, and Servvia owns every piece of restaurant state:
- orders and rounds
- kitchen tickets
- checks
- payments and settlement
- shifts and cash
- devices and terminals
- promotions
- realtime

No external POS state is authoritative for any of it.

Where Servvia Core and the NestJS API overlap (tax configuration, the channel menu, access tokens, rate limiting), Servvia Core ports Nest's HTTP behaviour and proves it with parity tests. New capabilities are Servvia-native APIs specified in `contracts/openapi/`.

- **Relationship to the NestJS API.** It uses the same PostgreSQL database, verifies Nest-issued access tokens with the shared `JWT_ACCESS_SECRET`, and shares Redis only for the rate limiter. It listens on `127.0.0.1:3100` by default.
- **Read-only by default: `SERVVIA_CORE_DB_READ_ONLY=true`.** Every canonical write answers 503 until writes are enabled. Set `SERVVIA_CORE_DB_READ_ONLY=false` only on local or disposable databases. It is not a production deployment instruction: routing any production traffic to Go Core needs its own approval.
- **Graceful shutdown.** On SIGINT or SIGTERM, `/ready` reports draining and realtime connections close with 1001. In-flight requests finish within the shutdown timeout. Then the kitchen projector and the realtime dispatcher stop.
- **Probes:** `/health` (liveness) and `/ready` (PostgreSQL).
- **Guarded.** An architecture test fails the build if a legacy external-POS concept (IdealPOS, POS sync, `ConnectorCommand`) appears in the canonical packages.

Build and test details, test layers and the parity setup are in [services/core-platform/README.md](services/core-platform/README.md).

## Realtime

Servvia Core owns canonical realtime (D12): a raw WebSocket at `GET /api/realtime`.

- **PostgreSQL remains the truth.** An event says what changed and which resource to refetch over HTTP.
- **Durable publication.** Every canonical change records its fact in the same transaction, in the `RealtimeEvent` table, and delivery happens after commit. A delivery failure never affects the change. The table is a delivery log, not canonical state and not a queue.
- **One venue per connection.** The subscriber authenticates first. The server derives the organization and venue and grants the streams, so isolation is enforced by organization and venue. A kitchen display receives only kitchen-ticket facts, never financial ones.
- **Delivery is at most once per connection:**
  - Duplicates are possible; deduplicate by `eventId`.
  - There is no global ordering. Per aggregate, `version` increases.
  - On reconnect, subscribe and then refetch over HTTP. There is no replay.
  - A subscriber that falls behind is disconnected.
- **D4 outbox is separate.** The kitchen outbox (`OutboxEvent`) stays the kitchen projector's alone. Generic workers (D13) are not implemented yet.
- **Legacy Socket.IO.** The NestJS `orderUpdate` channel still serves today's web clients until each one is cut over.

Protocol and schemas: [contracts/realtime/](contracts/realtime/). Fact definitions: [contracts/events/](contracts/events/).

## Media

Restaurant content — menu photographs, promotional imagery, signage content and video — **does not live in the application repository**. It is stored in **Google Cloud Storage**, and applications reference object keys or public object URLs of the form `https://storage.googleapis.com/<bucket>/<object key>`.

- Uploads go through the API's `MediaAsset` pipeline: signed upload, server-side verification, then an explicit publish. The browser never receives a credential or a bucket name.
- Local development uses `MEDIA_STORAGE_PROVIDER=local` and needs no cloud credentials.
- Bundled application assets are fine: app icons, logos, favicons and required native resources.
- Design and operational detail: [the GCS media architecture record](_bmad-output/implementation-artifacts/2026-08-17-gcs-media-architecture.md).

## Testing and CI

| Component | Commands |
|---|---|
| Servvia Core | `cd services/core-platform && gofmt -l . && go vet ./... && go build ./... && go test ./...`, and `go test -race ./...` |
| Servvia Core integration | `SERVVIA_CORE_TEST_DATABASE_URL=<disposable local db> go test ./tests/integration/`. The helper refuses non-local hosts and production-like names. |
| Servvia Core parity with NestJS | `go test ./tests/parity/` against a running NestJS API (setup in the core README) |
| NestJS API | `npm run typecheck --workspace=apps/api`, `npm run build:api`, `npm run lint:api`, `npm test --workspace=apps/api` |
| NestJS integration | `npm run test:integration --workspace=apps/api` against a migrated, seeded disposable database. Leave `NODE_ENV` unset (Jest uses `test`), and set `SEED_OWNER_PASSWORD` to the seeded owner's password. |
| Prisma | `cd apps/api && npx prisma format && npx prisma validate && npx prisma generate`, plus the migration checks in [Database and migrations](#database-and-migrations) |
| Contracts and root scripts | `npm run test:dev-scripts` (includes the contract checker), `npm run check:nul-bytes`, `npm run check:bridge-governance` |
| Web apps | `npm run lint:admin-console` (and `:customer-website`, `:window-display`), `npm test` (every workspace with tests) |
| Legacy venue connector (.NET, migration tooling) | `dotnet build apps/venue-connector/VerduraIdealposTracer.slnx`, then `dotnet test --no-build` on the same solution |

**CI** (`.github/workflows/ci.yml`, on pushes to `main` and on pull requests) runs nine jobs:
- NestJS API: lint, typecheck, unit tests
- NestJS API: real-PostgreSQL integration tests
- Admin console (including the Order Tablet and KDS targets): lint, typecheck, unit tests, build
- Customer website: lint, typecheck, build
- Window display: lint, typecheck, build
- Root script tests, plus the NUL-byte and bridge-governance guards
- Legacy migration tooling: venue connector (.NET) build, unit and crash/replay tests
- Legacy migration tooling: venue connector (.NET) Windows-only projects build
- Legacy migration tooling: IdealPOS bridge (.NET Framework) vendor-free self-test subset

**CI does not yet run Servvia Core's Go gates.** Run the Go commands above locally. Check the latest run on GitHub rather than assuming it passes.

## Engineering rules

- **Servvia is the operational POS.** No external POS is canonical.
- PostgreSQL holds canonical state, and Servvia Core owns canonical restaurant state. Prisma owns the schema.
- Servvia clients talk to Servvia Core. They never talk directly to restaurant databases or external POS databases.
- **The server is the price authority.** Clients send identities and quantities, never amounts. No client computes a canonical financial value.
- Money is integer minor units. No floating-point money.
- Idempotency is enforced by the database (unique keys and request fingerprints). Retries are safe.
- Each concept keeps its own boundaries (the domain model above).
- The canonical Go domains contain no IdealPOS, POS-sync or `ConnectorCommand` concept. Legacy IdealPOS compatibility is temporary and removable.
- Contracts in `contracts/` are the language-neutral boundary between services and clients.
- Realtime is not canonical storage. Clients refetch canonical state over HTTP after reconnecting.
- Legacy behaviour is preserved only for the migration period.
- **No destructive or production operation** (deploy, production migration, production data change, secret rotation) without explicit approval.

## Legacy migration components

The repository still contains older integrations that support the migration and the existing production estate. They are transitional, and each has explicit retirement conditions.

| Component | Status |
|---|---|
| NestJS API (`apps/api`) | Serves today's clients. Its domain ownership moves to Servvia Core one capability at a time. Known issue: the production start command's entry point (see the known findings in [docs/migration/README.md](docs/migration/README.md)). |
| IdealPOS bridge and harness (`apps/idealpos-*`) | Legacy compatibility with an external POS, frozen |
| POS sync (`POSSyncRecord`) and `ConnectorCommand` | Legacy hand-off to the external POS through a venue agent, frozen |
| Venue connector / tracer (`apps/venue-connector`) | Legacy IdealPOS observation tooling |
| Socket.IO `orderUpdate` | Legacy realtime, frozen; replaced by `/api/realtime` at each client's cutover |
| `TabletDevice` enrollment, KDS PINs | Transitional device identities, replaced by D8 devices as clients migrate |

**IdealPOS specifically:**
- No IdealPOS concept is allowed in the canonical Go domains, and an architecture test enforces this.
- Servvia orders, and Servvia checks, payments and settlement, do not depend on IdealPOS.
- Servvia's final POS does not require IdealPOS.
- The legacy integration is retired step by step once Servvia-owned clients and cutover are ready.

See the [IdealPOS retirement map](docs/migration/idealpos-retirement.md).

Some identifiers keep the original **Verdura** name: .NET project names, Docker volumes, cloud buckets and some production hosts. They are legacy compatibility identifiers and are deliberately not renamed ([naming inventory](docs/migration/naming-inventory.md)).

## Production and environments

Servvia Core does not yet serve production traffic. As migration context: the existing production estate runs the transitional NestJS API and web applications, together with the legacy compatibility components listed above. Local development (above) and production operation are separate. Production procedures live in dedicated documents:

- [docs/source-of-truth-and-environments.md](docs/source-of-truth-and-environments.md): the source of truth, environments and the operating protocol
- [docs/windows-production-deployment.md](docs/windows-production-deployment.md): how the Windows production host actually runs
- Legacy integration runbooks: see [Documentation map](#documentation-map)

`docker-compose.yml` also defines a `host` profile, `docker compose --profile host up --build -d`. It builds and runs the API and the five web apps in containers on one machine. It is **not** how the current Windows production host runs; that host deliberately does not use it.

Production deploys, migrations, data changes and cloud changes each need explicit operational approval.

## Security

- Never commit secrets: `.env` files, JWT secrets, database passwords, API keys, service-account keys.
- Device credentials, including payment-adapter credentials, are shown once at enrollment or rotation, and Servvia stores only a verifier. Treat them as secrets.
- Never expose provider references or card data in responses, logs or realtime events.
- Venue and organization scope is always enforced on the server; client-supplied scope is never trusted.
- Operations on production databases need deliberate, explicit approval.

## Documentation map

| Document | Contents |
|---|---|
| [ADR 0001](docs/adr/0001-servvia-is-the-operational-pos.md) | **Servvia is the operational POS**: the governing decision ([all ADRs](docs/adr/README.md)) |
| [docs/migration/README.md](docs/migration/README.md) | Migration phases, per-phase results and known findings; phase notes `d4`–`d12` |
| [services/core-platform/README.md](services/core-platform/README.md) | Servvia Core: layout, configuration, toolchain, test layers, parity |
| [contracts/README.md](contracts/README.md) | Contracts index: OpenAPI, realtime, events, schemas |
| [docs/architecture.md](docs/architecture.md) | Architecture reference and the technology standard (§10) |
| [docs/source-of-truth-and-environments.md](docs/source-of-truth-and-environments.md) | Source of truth, environments, session protocol |
| [docs/windows-production-deployment.md](docs/windows-production-deployment.md) | The Windows production host |
| [docs/decisions-log.md](docs/decisions-log.md) | Decision log |
| [apps/api/README.md](apps/api/README.md) and the other `apps/*/README.md` | Component notes |

**Legacy migration and retirement documentation** (describes components that are being retired, not the Servvia architecture):

| Document | Contents |
|---|---|
| [docs/migration/idealpos-retirement.md](docs/migration/idealpos-retirement.md) | The IdealPOS retirement map |
| [docs/integrations/idealpos.md](docs/integrations/idealpos.md) | Notes on the legacy IdealPOS integration |
| `_bmad-output/implementation-artifacts/` | Retained runbooks and evidence for the legacy production integration |

## Contributing

- Work from `main`. Use `feature/…` or `fix/…` branches for pull requests.
- Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/). Use the package or domain as the scope, e.g. `feat(orders): …`, `fix(api): …`, `docs(migration): …`.
- Before a pull request, run the gates for the components you changed (see [Testing and CI](#testing-and-ci)). Run `npm run check:nul-bytes` after any tool-generated file change: it catches NUL bytes that make a source file look binary to git.

## License

UNLICENSED and proprietary. All source code, assets, database schemas and documentation are the property of Servvia. Copyright © 2026 Servvia. All rights reserved.
