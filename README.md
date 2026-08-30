# Verdura Restaurant Operations Platform

![Node.js](https://img.shields.io/badge/Node.js-20.x_LTS-339933?logo=node.js&logoColor=white)
![NestJS](https://img.shields.io/badge/NestJS-11-E0234E?logo=nestjs&logoColor=white)
![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=white)

**Document Version:** 1.1.0  
**Effective Date:** June 19, 2026  
**Classification:** Internal Technical Documentation

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Architecture & Tech Stack](#2-architecture--tech-stack)
3. [Project Structure](#3-project-structure)
4. [Configuration](#4-configuration)
5. [Getting Started](#5-getting-started)
6. [Usage & Workflow Execution](#6-usage--workflow-execution)
7. [Contributing Guidelines](#7-contributing-guidelines)
8. [License](#8-license)

---

## 1. Project Overview

Verdura is an enterprise-grade restaurant operations and management platform built to orchestrate and scale hospitality workflows. Originally designed as a localized customer website for a Middle Eastern restaurant in Dunedin, New Zealand, the platform has been re-engineered into a highly scalable, multi-tenant Software-as-a-Service (SaaS) architecture.

### 1.1 The Business Challenge

Modern hospitality businesses suffer from fragmentation across customer-facing ordering, internal reservation management, kitchen routing, and Point-of-Sale (POS) systems. This lack of integration leads to:

- Reservation data leakage between systems
- Printing latency causing kitchen delays
- High commission overheads from third-party delivery apps
- Zero real-time operational visibility for management

### 1.2 The Verdura Solution

Verdura solves these operational inefficiencies by unifying all key operational surfaces into a single, cohesive ecosystem managed by a performant cloud API:

| Surface | Description |
|---|---|
| **Customer Booking Engine** | A seamless 5-step reservation wizard featuring guest dietary preferences and Stripe-integrated down payments |
| **Self-Ordering Kiosk** | A responsive touchscreen interface capturing order details and table numbers inside the restaurant, reducing staff overhead |
| **Kitchen Display System (KDS)** | A real-time, low-latency kitchen queue pushing orders to cooks via WebSockets |
| **Admin Dashboard** | A centralized control panel for managers to configure venues, manage menus, track payments, review audit logs, and coordinate staffing |
| **On-Premise Agents** | Pluggable, locally-hosted background services/processes handling automated printer routing (ESC/POS) and Idealpos order handoff, via either a supported, vendor-approved interface, or, alternatively, a controlled, non-database UI-driven adapter — never a direct write to the Idealpos database (see `docs/integrations/idealpos.md`) |

---

## 2. Architecture & Tech Stack

Verdura utilizes a modern web architecture divided into two main layers: a high-performance **NestJS (Node.js)** backend API and a **React 18** frontend client ecosystem, unified in a monorepo setup via NPM Workspaces.

### 2.1 System Context Diagram

The following diagram illustrates the network boundaries and integration points between the public internet, cloud services, and the restaurant's Local Area Network (LAN):

```
+----------------------------------------------------------------------------------+
|                          VERDURA PLATFORM — SYSTEM CONTEXT                       |
+----------------------------------------------------------------------------------+

  PUBLIC INTERNET                          RESTAURANT LAN (On-Premise)
  ───────────────                          ───────────────────────────

  [Customer]                               [Kitchen Staff]
      │ browses                                │ views orders
      ▼                                        ▼
  +──────────────────+                    +──────────────+
  |  Customer Site   |                    |     KDS      |
  |  (React SPA)     |                    |  (React SPA) |
  +────────┬─────────+                    +──────┬───────+
           │ REST via Verdura API proxy           │ WebSocket
           │                                     │
  [Diner at Kiosk]                               │
      │ orders via touchscreen                   │
      ▼                                          │
  +──────────────────+   REST / WS   +───────────┴────────────────────────────+
  | Self-Order Kiosk |──────────────►|                                        |
  +──────────────────+               |          VERDURA API (NestJS)          |
                                     |          (api.verdura.co.nz)           |
  [Passerby outside]                 |                                        |
      │ views menu display           +──┬──────────┬──────────┬──────────┬────+
      ▼                                 │          │          │          │
  +──────────────────+                  │          │          │          │
  |   Menu Display   |──────────────────┘          │          │          │
  |      Kiosk       |  REST (read-only)           │          │          │
  +──────────────────+                             │          │          │
                                                   ▼          ▼          ▼
  [Admin / Manager]                       +────────────────+ +──────────+
      │ manages platform                  | PostgreSQL     | |  Redis   |
      ▼                                   | (Local Docker) | |  (Queue  |
  +──────────────────+                    +────────────────+ | & PubSub)|
  | Admin Dashboard  |─── REST / JWT ────────────────────────+ +────────+
  | (admin.verdura)  |
  +──────────────────+                    +──────────────+ +──────────+
                                          | Local Media  | | Optional |
                                          | Volume       | | Email    |
                                          +──────────────+ +──────────+

  ON-PREMISE (Restaurant LAN Gateway Host)
  ────────────────────────────────────────────────────────────────────────────
  +--------------------------------------------------------------------------+
  |  Local Gateway (outbound-only, mutually authenticated connector session  |
  |  to Verdura -- never a direct shared cloud Redis credential)             |
  |                                                                          |
  |  +--------------------------+          +------------------------------+  |
  |  |     Printer Service      |          |     Verdura Connector        |  |
  |  |  (Node.js / PM2)         |          |  Windows Service, proposed   |  |
  |  |  - TCP ESC/POS Output    |          |  as .NET 8 for the Idealpos  |  |
  |  |                          |          |  API-less path -- see        |  |
  |  |                          |          |  docs/integrations/          |  |
  |  |                          |          |  idealpos.md sections 13-21  |  |
  |  +------------┬-------------+          +--------------┬---------------+  |
  |               │                                       │ secured local IPC|
  |               ▼                                       ▼                  |
  |  +--------------------------+          +------------------------------+  |
  |  | Physical LAN Printers    |          | Idealpos POS Bridge          |  |
  |  |                          |          | (separate interactive        |  |
  |  |                          |          |  process; drives the Idealpos|  |
  |  |                          |          |  UI -- never a direct DB     |  |
  |  |                          |          |  write; NOT implemented,     |  |
  |  |                          |          |  proposed/unproven)          |  |
  |  +--------------------------+          +------------------------------+  |
  +--------------------------------------------------------------------------+
  ```

  This diagram shows the **proposed** target architecture for the on-premise Idealpos side, not a built or deployed system. A vendor-supported Idealpos interface (ecommerce/Online/Doshii/SDK) remains preferred over the Windows Connector + POS Bridge shown above whenever it is commercially and technically confirmed available -- see `docs/integrations/idealpos.md` section 13.

### 2.2 Core Technical Specifications

| Component | Technical Stack | Responsibility |
|---|---|---|
| **API Backend** | NestJS 11, TypeScript 5, Prisma ORM, BullMQ, Socket.io, `ioredis`, `sharp` | Business logic, authentication, RBAC, WebSockets, background job distribution, media optimization |
| **Data Layer** | Local PostgreSQL 16, Prisma ORM | Relational domain models, flexible metadata via `JSONB`, transaction compliance |
| **Task & Event Queue** | Redis, BullMQ | Asynchronous printing jobs, transactional emails, calendar synchronization, POS records |
| **Admin Frontend** | React 18, TypeScript, Vite, Tailwind CSS, TanStack Query, Zustand | Back-office management, configurations, live operations feeds, operational reports |
| **Customer Frontends** | React 18, JavaScript, Vite, Tailwind CSS, Stripe SDK | Reservation booking engine, informational landing pages |
| **Kiosk & KDS** | React 18, TypeScript, Vite, Tailwind CSS, Zustand, IndexedDB | Self-ordering interface, outer window menu looping, kitchen ticket monitoring |
| **Local Services** | Node.js 20 LTS, PM2, `node-escpos` | LAN hardware printing integration, local POS software syncing |

---

## 3. Project Structure

Verdura is structured as a monorepo utilizing NPM Workspaces to coordinate development across the core API layer and all client interfaces.

```
.
├── backend/                             # NestJS API Backend (TypeScript)
│   ├── prisma/                      # Database Schema and Migrations
│   │   ├── migrations/              # PostgreSQL schema migrations
│   │   └── schema.prisma            # Prisma schema models (18+ entities)
│   ├── src/                         # Backend Application Source Code
│   │   ├── audit/                   # Security audit logs
│   │   ├── auth/                    # JWT, RBAC, and TOTP authentication
│   │   ├── kiosk-frontend/                   # Public kiosk read/write controllers
│   │   ├── menu/                    # Category, item, and modifier CRUD
│   │   ├── orders/                  # Order lifecycle and status FSM
│   │   ├── pos-sync/                # POS agent sync job dispatchers
│   │   ├── printer/                 # ESC/POS printer queue controllers
│   │   ├── queue/                   # Redis BullMQ config
│   │   ├── reservations/            # Table booking engine & calendar worker
│   │   ├── main.ts                  # NestJS application entrypoint
│   │   └── app.module.ts            # Root dependency injection container
│   ├── package.json                 # Backend dependencies & run scripts
│   └── tsconfig.json                # TypeScript settings for Backend
├── customer-frontend/                        # Customer-Facing React App (JS / CSS)
│   ├── src/
│   │   ├── components/              # Reusable UI Blocks (Shadcn, custom)
│   │   │   ├── reservation/         # 5-Step Booking Wizard
│   │   │   └── ui/                  # Atom level components
│   │   ├── pages/                   # Top-level Page Views
│   │   │   ├── About.jsx
│   │   │   ├── AdminDailyEmail.jsx  # Reservation daily digests
│   │   │   ├── BookTable.jsx        # Table booking page
│   │   │   ├── Home.jsx
│   │   │   └── Menu.jsx             # Customer menu viewer
│   │   ├── App.jsx                  # Main routing config
│   │   └── main.jsx                 # Vite application entrypoint
│   ├── package.json
│   └── tailwind.config.js
├── docs/                            # Technical Architecture & Logs
│   ├── architecture.md              # System design details
│   ├── prd.md                       # Product requirements document
│   └── decisions-log.md             # Key architecture decisions
├── package.json                     # Root configuration for NPM Workspaces
└── README.md
```

### 3.1 Key File Reference

| File | Purpose |
|---|---|
| [`backend/prisma/schema.prisma`](backend/prisma/schema.prisma) | Database schema — all 18+ entity models and their relations |
| [`backend/src/app.module.ts`](backend/src/app.module.ts) | Root NestJS module — dependency injection container |
| [`backend/src/main.ts`](backend/src/main.ts) | API server entrypoint — port binding, Swagger, CORS config |
| [`customer-frontend/src/App.jsx`](customer-frontend/src/App.jsx) | Frontend router — all page-level route definitions |
| [`package.json`](package.json) | Monorepo root — workspace definitions and shared scripts |

---

## 4. Configuration

Each workspace has a tracked `.env.example`. Real `.env` and `.env.local`
files are per-machine and gitignored. `npm run dev` creates missing files from
the examples and never overwrites existing ones.

### 4.1 Backend (`backend/.env`)

| Variable | Description | Example |
|---|---|---|
| `DATABASE_URL` | Local PostgreSQL connection used by Prisma | `postgresql://verdura:verdura_local_dev_only@127.0.0.1:5434/verdura_dev` |
| `REDIS_HOST` | Host address of Redis instance | `127.0.0.1` |
| `REDIS_PORT` | Networking port for Redis connection | `6379` |
| `PORT` | Listening port for NestJS server | `3000` |
| `JWT_ACCESS_SECRET` | Secret key for signing access tokens | `change-me-in-production` |
| `JWT_REFRESH_SECRET` | Secret key for signing refresh tokens | `change-me-in-production` |
| `JWT_ACCESS_EXPIRY` | Short-term token expiration window | `15m` |
| `JWT_REFRESH_EXPIRY` | Long-term refresh cookie validation window | `7d` |

### 4.2 Frontends

| Variable | Description | Example |
|---|---|---|
| `VITE_API_URL` | Optional API origin; leave empty to use the Vite/nginx proxy | empty |
| `VITE_VENUE_ID` | Venue used by customer, kiosk, admin and tablet | `10000000-0000-4000-8000-000000000001` |

Never put secrets in `VITE_` variables: they are bundled into browser code.

### 4.3 Media Storage

**Google Cloud Storage is Verdura's canonical media provider — not Google Drive.** Menu-item photographs, promotional imagery, and video are designed to live in GCS; Google Drive is never used for production application media. Full design and current status: `_bmad-output/implementation-artifacts/2026-08-17-gcs-media-architecture.md`.

**Provisioned and live as of 2026-08-17** — two buckets in `australia-southeast1`, project `project-10bd9c5c-d379-4338-8b2`:

| Bucket | Purpose | Anonymous access |
|---|---|---:|
| `verdura-media-originals-d3794338b2` | Private originals — every upload lands here first | Never (public access prevention enforced) |
| `verdura-media-public-d3794338b2` | Approved public delivery — only content that has completed approval | Read-only (`roles/storage.objectViewer` for `allUsers`, granted deliberately and narrowly — see the architecture doc for the exact authorization and verification) |

All 46 canonical menu-item photographs are migrated and live at `https://storage.googleapis.com/verdura-media-public-d3794338b2/venues/<venueId>/menu-items/<mediaId>/original/<filename>`, referenced directly from `MenuItem.imageUrl`. Local development (`npm run dev`) still defaults to `MEDIA_STORAGE_PROVIDER=local` for *new* uploads through the `MediaAsset` pipeline — nothing needs GCP credentials just to run the app; already-migrated images render by the browser fetching the public GCS URL directly, independent of the API's own provider configuration.

**Admin Console upload flow:** `MenuManagementPage`'s item image picker uploads through the full MediaAsset pipeline — `request-upload` (signed PUT target, server-generated object key) → direct browser PUT to the private originals bucket → `finalize` (server re-verifies size/checksum against the real object) → `publish` (explicit, separately-audited server-side copy into the public bucket) → `associate-menu-item` (atomic, verified write of the resulting public URL onto an *existing* `MenuItem`; a brand-new item instead carries the already-verified delivery URL into its create payload, since there is no `MenuItem` row yet to associate against). The browser never receives a bucket name, a credential, or write access to the public bucket. See `apps/admin-console/src/lib/mediaAssets.ts` for the client-side state machine and `apps/api/src/media/media-assets.service.ts` for the server-side transitions.

| Variable | Required | Description | Example |
|---|---|---|---|
| `MEDIA_STORAGE_PROVIDER` | No (default `local`) | `local` needs no GCP credentials — uploads go through the API onto local disk, safe for every developer machine. Setting `gcs` is an operator/environment decision, not something these commits configure; the backend refuses to start unless all four GCS variables below are present and non-blank | `local` |
| `GCP_PROJECT_ID` / `GOOGLE_CLOUD_PROJECT` | Only when `MEDIA_STORAGE_PROVIDER=gcs` | The target GCP project. Either name works — Cloud Run/GKE set `GOOGLE_CLOUD_PROJECT` automatically | `project-10bd9c5c-d379-4338-8b2` |
| `GCS_MEDIA_BUCKET` | Only when `MEDIA_STORAGE_PROVIDER=gcs` | The private originals bucket new uploads go to. Validated at boot — the backend refuses to start if this is unset or blank while `MEDIA_STORAGE_PROVIDER=gcs`, rather than substituting a local-style default bucket name | `verdura-media-originals-d3794338b2` |
| `GCS_MEDIA_PUBLIC_BUCKET` | Only when `MEDIA_STORAGE_PROVIDER=gcs` | The separate public-delivery bucket the explicit publish transition copies an approved asset into — never the same value as `GCS_MEDIA_BUCKET`. Same boot-time validation | `verdura-media-public-d3794338b2` |
| `GCS_SERVICE_ACCOUNT_EMAIL` | Only when `MEDIA_STORAGE_PROVIDER=gcs` | The service account `GcsStorageProvider` always signs as, via impersonation — required, signing cannot work without it (plain ADC has no private key; see the architecture doc's "real defect found" section). Validated at boot alongside the other three | `verdura-media-api@project-10bd9c5c-d379-4338-8b2.iam.gserviceaccount.com` |
| `GCS_MEDIA_PUBLIC_BASE_URL` | No | Public base URL for the approved-delivery surface, if one exists. Private originals never use this | empty |
| `GCS_SIGNED_URL_TTL_SECONDS` | No (default `900`) | How long a signed upload/delivery URL stays valid | `900` |

No `.env` value is committed by these changes, no service-account key file belongs in this repository, and Application Default Credentials (plus service-account impersonation) is the only intended credential mechanism. Whoever runs the app with `MEDIA_STORAGE_PROVIDER=gcs` locally needs `roles/iam.serviceAccountTokenCreator` on `GCS_SERVICE_ACCOUNT_EMAIL`, granted via `gcloud iam service-accounts add-iam-policy-binding`. Which provider a given environment actually runs is an operator/environment decision — these commits do not prove, configure, or claim that any particular local or production environment currently has `MEDIA_STORAGE_PROVIDER=gcs` set.

**Local development behavior:** `npm run dev` needs zero new setup, zero GCP credentials, and zero new local services — the local `MediaAsset` pipeline emulates both buckets with two directories (`apps/api/storage-assets/` private, `apps/api/storage-assets-public/` public) and serves the public one back over real HTTP at `/api/media-assets/public/:key` (unauthenticated, exactly like a real public bucket's anonymous GET; the private root has no serving route at all). The legacy direct-to-disk `MediaController`/`MediaService` (`POST /api/admin/media/:folder`) is unchanged but now has **zero remaining consumers** in this repository — deprecated in place (see its doc comment), left registered rather than deleted.

**Reassociation tooling:** `apps/api/prisma/scripts/reassociate-orphaned-menu-item-media.ts` repairs a `MenuItem.imageUrl` that has regressed to a stale local path, by checksum-matching it (via the committed migration manifest, `_bmad-output/implementation-artifacts/2026-08-17-gcs-media-migration-manifest.csv`) against an existing `approved`/`public` `MediaAsset`. Dry-run by default; `--apply` is required to write. Checksum-based, idempotent, compare-and-swap protected against concurrent edits, and makes no cloud request of any kind.

**Security model:** short-lived signed upload URLs only (never a proxied file body through the API for GCS uploads); Application Default Credentials + service-account impersonation only — no service-account JSON key is ever created, read, or written to this repository; every object key is server-generated from the venue ID and a server-generated media ID, never client-supplied; checksums are verified exactly (SHA-256, embedded as required upload metadata, verified byte-for-byte on finalize, and again on the public copy after publish) before an asset is approved or published; private originals are never anonymously public — proven by a real anonymous-access test, not assumed; `MenuItem.imageUrl` is only ever written from an asset that is both `approved` and `visibility:public`, enforced server-side in `associateWithMenuItem`, never trusted from client input.

**Troubleshooting:**

| Symptom | Cause | Fix |
|---|---|---|
| `MEDIA_STORAGE_PROVIDER=gcs requires <VARIABLE> to be set` (backend fails to boot, naming exactly one of `GCP_PROJECT_ID`/`GOOGLE_CLOUD_PROJECT`, `GCS_SERVICE_ACCOUNT_EMAIL`, `GCS_MEDIA_BUCKET`, or `GCS_MEDIA_PUBLIC_BUCKET`) | `MEDIA_STORAGE_PROVIDER=gcs` set with that variable missing or blank | Set the named variable, or unset `MEDIA_STORAGE_PROVIDER` to fall back to `local` |
| App boots but GCS calls fail against a bucket that doesn't exist | `GCS_MEDIA_BUCKET`/`GCS_MEDIA_PUBLIC_BUCKET` is set but names a bucket that was never actually provisioned in GCS — boot-time validation only checks the variable is set, not that the bucket exists | Confirm the bucket exists — see the architecture doc's provisioning steps — or correct the variable to the real bucket name |
| `Cannot sign data without client_email` | Plain ADC (no impersonation) was used to sign — see the architecture doc's "real defect found" section | Ensure `GCS_SERVICE_ACCOUNT_EMAIL` is set and the caller holds `roles/iam.serviceAccountTokenCreator` on it |
| `IAM Service Account Credentials API has not been used in project ... before or it is disabled` | `iamcredentials.googleapis.com` not enabled, or enabled less than a few minutes ago (propagation delay — observed and resolved during the original migration) | `gcloud services enable iamcredentials.googleapis.com`; wait a minute and retry |
| A GCS upload fails with a permissions error | No service account/ADC configured, or the bucket doesn't exist | Run `gcloud auth application-default login`; confirm the bucket exists — see the architecture doc's provisioning steps |
| `MediaAsset must be approved before it can be published` / `... published before it can be associated with a menu item` | Called `publish`/`associate-menu-item` out of order, or on an asset that failed finalize verification | Expected fail-closed behavior — re-run `finalize` first and confirm `status:"approved"` before calling `publish` |

---

## 5. Getting Started

Follow these steps to configure, build, and run the platform in your local development environment.

### 5.1 Prerequisites

Ensure the following tools are installed on your host system:

| Tool | Version | Notes |
|---|---|---|
| **Node.js** | `20.x` LTS or higher | Required for both API and frontend |
| **NPM** | `10.x` or higher | Used for monorepo workspace management |
| **Docker & Docker Compose** | Latest stable | Used to run local PostgreSQL and Redis instances |

### 5.2 Installation

**1. Clone the repository and install all workspace dependencies:**

```bash
git clone https://github.com/ErebusCodes/verdura_MVP.git
cd verdura_MVP
npm install
```

**2. Start everything:**

```bash
npm run dev
```

That's it — on both macOS and Windows this single command (`scripts/dev.mjs`) automatically:

- checks Docker is installed and running (installs nothing else natively — no Homebrew services, no Windows services, no Memurai);
- starts PostgreSQL (port `5434`) and Redis (port `6379`) via the root `docker-compose.yml`, waiting until both are healthy;
- creates all missing workspace `.env` files from `.env.example` files;
- verifies the Prisma connection and applies any pending migrations (`prisma migrate deploy`);
- checks whether the database is empty and runs the canonical seed **exactly once** if so — an already-populated database is never reseeded or overwritten;
- starts the backend and every frontend (customer, admin, kiosk, kitchen display, order tablet).

The defaults are sufficient for non-payment local development. Email is a
no-op without its provider key. Kiosk payment is **not production-ready**:
the current backend does not yet perform the complete server-side payment
verification and reconciliation required by `docs/mvp.md`. Do not enable
real-money operation until those P0 gates are closed.

For a Windows POS/Kiosk host that runs the application itself in Docker:

```text
git clone <repository-url>
cd verdura
npm install
docker compose --profile host up --build -d
```

The `host` profile builds the API and five frontends (including KDS), applies migrations and
seeds only a completely empty database. Normal restarts preserve PostgreSQL,
Redis and uploaded-media volumes. Use either this host profile or `npm run
dev`; do not run both simultaneously because they expose the same ports.

Other useful commands, all cross-platform:

| Command | What it does |
|---|---|
| `npm run db:start` | Start PostgreSQL + Redis via Docker only (no app servers) |
| `npm run db:stop` | Stop them (data preserved) |
| `npm run db:status` | Show container health |
| `npm run db:migrate` | Apply pending Prisma migrations (`prisma migrate deploy`) |
| `npm run db:seed` | Re-run the canonical seed (idempotent — safe to run anytime) |
| `npm run db:local:reset` | Destructively reset only the configured local development database, migrate, seed and verify canonical counts |
| `npm run validate:menu` | Validate canonical menu counts, uniqueness and reservation formatting |

### 5.3 Troubleshooting

| Symptom | Likely Cause | Fix |
|---|---|---|
| `[dev] Docker was not found on PATH` / `not running` | Docker Desktop not installed or not started | Install/start Docker Desktop, then re-run `npm run dev` |
| `ECONNREFUSED` on API startup | Redis or Postgres container not healthy yet | `npm run db:status`; check `docker compose logs` |
| Menu/admin dashboard shows no data or venue ID mismatch | Database is stale/empty or frontend venue configuration differs from the seeded venue | For disposable local development data, run `npm run db:local:reset`; otherwise inspect with `npm run db:status` before changing data |
| Prisma migration errors | Local DB out of sync with `backend/prisma/migrations/` | `npm run db:migrate` |
| `VITE_*` variable undefined at runtime | Workspace `.env` missing | Re-run `npm run dev` to create it from the tracked example |
| Printer jobs not processing | Production venue printer agent is not implemented in this repository | Treat printing as unsupported until the edge-agent acceptance gates in `docs/mvp.md` pass |

---

## 6. Usage & Workflow Execution

The project supports concurrent development of all surfaces from the repository root.

### 6.1 Development Scripts

All scripts are executed from the workspace root unless otherwise noted:

| Command | Description |
|---|---|
| `npm run dev` | Starts Docker Postgres/Redis, applies migrations, seeds if empty, then launches the API and every frontend dev server concurrently |
| `npm run dev:backend` | Starts only the NestJS backend in watch mode |
| `npm run dev:customer-frontend` | Starts only the customer frontend in watch mode |
| `npm run lint:backend` | Runs ESLint across the backend workspace |
| `npm run lint:customer-frontend` | Runs ESLint across the frontend workspace |
| `npm run typecheck --workspace=backend` | Type-checks backend TypeScript without emitting files |

### 6.2 Application URLs

This is the locked, permanent local service/port map — see
`scripts/dev-lock.mjs`'s `CANONICAL_PORTS`, the single source of truth every
port below is generated from. Do not change these port assignments without
an explicit new decision; see that file's own doc comment.

| Surface | Local URL | Notes |
|---|---|---|
| Customer Frontend | `http://localhost:5173` | Booking engine, menu, landing pages |
| Window Display | `http://localhost:5174` | Promotional display / in-venue self-order kiosk |
| Kitchen Display (KDS) | `http://localhost:5175` | Development-only KDS view. Local admin/owner PIN: `108` |
| Order Tablet | `http://localhost:5176` | Staff/customer in-venue ordering (device PIN stage). Local admin/owner PIN: `108` |
| Admin Console | `http://localhost:5177` | Menu and operations management. Local admin/owner PIN: `108` |
| NestJS API | `http://localhost:3000` | REST & WebSocket server |

Order Tablet device enrollment is a separate stage from the admin/owner PIN
above — see `apps/order-tablet/README.md`. Production must always be
configured with a real, non-default PIN; `108` is rejected outright in
production (`NODE_ENV=production`) regardless of configuration.

---

## 6.3 Source of Truth and Production Deployment

GitHub `main` is the authoritative tracked source of truth for all Verdura application code. The Mac environment is the synchronized development/review environment, and the Windows host (`DESKTOP-SOKKOQ7`) acts as the primary production-facing work/integration surface, which must never diverge from `main`.

A standing session protocol (SOP) governs all implementation, secure SSH access, synchronization, safety constraints, and session-close verification invariants. See the canonical environment governance document [`docs/source-of-truth-and-environments.md`](docs/source-of-truth-and-environments.md) for the full operating policy and session protocol, and [`docs/windows-production-deployment.md`](docs/windows-production-deployment.md) for the current physical layout and service settings on the Windows host.

---

## 7. Contributing Guidelines

We enforce rigorous code standards to ensure quality, security, and maintainability.

### 7.1 Branching Strategy

- **`main` is protected.** Direct pushes are blocked — all changes go through pull requests.
- **Branch naming:** Use `feature/` or `bugfix/` prefixes (e.g., `feature/kds-websockets`, `bugfix/stripe-webhook-retry`).
- **Every PR must pass:** TypeScript compilation, ESLint validation, and all test suites before review.
- **Peer review:** At least one senior developer approval is required before merging.

### 7.2 Commit Message Convention

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <short summary>

feat(reservations): add dietary preference inheritance for group bookings
fix(printer): handle ESC/POS timeout on dropped TCP connection
chore(backend): upgrade Prisma to 5.x
```

Valid types: `feat`, `fix`, `chore`, `refactor`, `docs`, `test`, `perf`.

Use scope to indicate which package was changed:

```
feat(auth): add refresh token rotation
fix(backend): correct Joi validation for JWT_SECRET
chore(deps): upgrade NestJS to 11.x
feat(admin-frontend): scaffold verdura-admin-frontend vite app
```

Scopes: `backend`, `admin-frontend`, `kiosk-frontend`, `kds`, `customer-frontend`, `prisma`, `infra`.

### 7.3 Coding Standards

- **TypeScript:** All backend changes must be strictly typed. `any` assertions are not permitted.
- **Linting:** Run lint checks before committing:
  ```bash
  npm run lint:backend
  npm run lint:customer-frontend
  ```
- **Security controls:**
  - All API routes must implement guards validating role-based claims.
  - Database interactions must use Prisma's parameterized query interface — never raw string interpolation.
  - Access tokens must never be logged, exposed in client consoles, or stored in `localStorage`.

### 7.4 NUL-byte source integrity guard

A file-writing tool once embedded literal `0x00` (NUL) bytes into a committed `.ts` file in place of plain spaces — `git diff` silently rendered the file as binary instead of a normal text diff, so the corruption wasn't visible until an explicit byte-level check caught it. `npm run check:nul-bytes` (`scripts/check-no-nul-bytes.mjs`) guards against a recurrence: it byte-scans every git-tracked text/source file (never binary assets like menu images, which legitimately contain NUL bytes as normal content) and fails if any contains one. It runs in CI as part of the "Root scripts" job on every push; run it locally the same way before a commit if you've had any AI-assisted or programmatic file-writing tool touch source files.

**Working policy while this remains a known risk with AI-assisted authoring:** don't let a subagent/tool's raw file-write be the last step before a commit touches critical source. Either have the authoring session's own reviewer re-read the file (not just the diff summary) before staging it, or run `npm run check:nul-bytes` immediately after any subagent-created or -modified file and before relying on it further.

---

## 8. License

This repository is **UNLICENSED** and proprietary. All source code, assets, database schemas, and documentation are the sole property of Verdura. Unauthorized copying, distribution, modification, or runtime hosting of this code is strictly prohibited.

**Copyright © 2026 Verdura. All rights reserved.**
# verdura_MVP
