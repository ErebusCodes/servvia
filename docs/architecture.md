# Servvia — Solution Architecture

> **Current authority, 2026-09-28:** [ADR 0001: Servvia is the operational POS](./adr/0001-servvia-is-the-operational-pos.md) (DL-115).
> - The 2026-08-15 IdealPOS-authority banner below is superseded.
> - Servvia Core owns orders, table sessions, checks, payments, settlement and kitchen tickets, and PostgreSQL is authoritative.
> - IdealPOS is legacy integration only.
> - Migration plan and status: [`docs/migration/`](./migration/README.md).

> **Normative operating-model decision — 2026-08-15:** Architecture must implement the [Target Operating Model](./target-operating-model.md). Servvia durably records and fans out each order version; the outbound-only venue connector must accept the Idealpos command before KDS/KOT release. Idealpos is authoritative for POS/in-person EFTPOS; Servvia owns routing for Servvia-originated KDS/KOT; verified online payments map to an Idealpos `PREPAID / ONLINE` tender. Independent acknowledgements must never be collapsed into one “synced” flag.

> **Assessment alignment — 2026-08-15:** This document describes the target architecture, not the fully deployed system. The current repository has a working NestJS/PostgreSQL/Redis foundation and real menu, reservation, order and KDS paths, but the separate edge connector, printer service, real Idealpos adapter, durable offline queue, provider acknowledgement chain, reconciliation queue, database-enforced tenancy and enterprise audit service are not implemented. Direct cloud-to-LAN printer access and direct restaurant-agent access to shared cloud Redis must not be treated as the production trust boundary. The authoritative current-state and release gates are in [mvp.md](./mvp.md).

**Recommended architecture correction:** use an outbound-only, mutually authenticated edge connector; expose a scoped command/event API rather than Redis to venue agents; model `Queued`, `Delivered`, `Acknowledged` and `Confirmed` separately; store idempotency results durably; and fail unsupported provider capabilities explicitly.

> **Technology standard — 2026-09-01:** [§10](#10--technology-standard-current-mvp-and-approved-target-architecture) is the canonical Servvia technology ownership standard. It separates the **current MVP implementation** (NestJS/Node, Prisma, React+Vite, .NET connector) from the **approved target architecture** (React+TypeScript web, Kotlin/Android native devices, **Go** Core Platform and Venue/Edge, **Python** AI/Data/Analytics, narrow C#/.NET Windows-IdealPOS adapter, PostgreSQL, Google Cloud Storage, Docker). Sections 1–9 of this document describe the current-MVP shape of the system; where they name a technology, read §10 for whether that technology is the long-term owner. No new implementation may create a second long-term owner for an existing capability (§10.11).

**Phase 4 Output**
**Date:** 2026-06-18

> Diagrams use ASCII/text notation. Phase 0 findings are cited where they constrain decisions.
> Every required decision from the master prompt (Hosting Boundary, Media Storage, Data Store Split) is resolved explicitly below.

---

## 1 — System Context Diagram

```
╔══════════════════════════════════════════════════════════════════════════════════╗
║                          VERDURA PLATFORM — SYSTEM CONTEXT                      ║
╚══════════════════════════════════════════════════════════════════════════════════╝

  PUBLIC INTERNET                          RESTAURANT LAN (on-premise)
  ───────────────                          ───────────────────────────

  [Customer]                               [Kitchen Staff]
      │ browses verdura.co.nz                  │ views orders
      ▼                                        ▼
  ┌──────────────────┐                    ┌──────────────┐
  │  Customer Website│                    │     KDS      │
  │  (frozen layout) │                    │  (browser)   │
  └────────┬─────────┘                    └──────┬───────┘
           │ REST through NestJS API              │ WebSocket
           │                                      │
  [Diner at kiosk]                                │
      │ orders via touchscreen                    │
      ▼                                           │
  ┌──────────────────┐  REST/WS   ┌───────────────┴────────────────────────────┐
  │ Self-Order Kiosk │───────────►│                                            │
  └──────────────────┘            │          VERDURA API (NestJS)              │
                                  │          api.verdura.co.nz                 │
  [Passerby outside]              │          (cloud-hosted, multi-instance)    │
      │ views menu display         │                                            │
      ▼                           └──┬──────────┬──────────┬──────────┬────────┘
  ┌──────────────────┐              │           │          │          │
  │ Menu Display     │──────────────┘           │          │          │
  │     Kiosk        │  REST (read-only)         │          │          │
  └──────────────────┘                          │          │          │
                                                │          │          │
  [Admin / Manager]                             │          │          │
      │ manages the platform                    │          │          │
      ▼                                         ▼          ▼          ▼
  ┌──────────────────┐                    ┌──────────────────────┐ ┌────────────┐
  │  Admin Dashboard │──── REST/JWT ─────►│ PostgreSQL           │ │   Redis    │
  │admin.verdura.co.nz                    │  (Local Docker)      │ │  (Cache /  │
  └──────────────────┘                    └──────────────────────┘ │ Queue/PubSub│
                                                                    └────────────┘
                                                │
                          ┌─────────────────────┼──────────────────────┐
                          ▼                     ▼                      ▼
                   ┌─────────────┐      ┌──────────────┐     ┌───────────────┐
                   │  Object     │      │   Email       │     │  Google       │
                   │  Storage    │      │  Provider     │     │  Calendar API │
                   │ (Local disk │      │ (Resend/SG)   │     │               │
                   │  Storage)   │      └──────────────┘     └───────────────┘
                   └─────────────┘

  ON-PREMISE (restaurant LAN)
  ────────────────────────────
  ┌───────────────────────────────────────────────────────────────────┐
  │  LOCAL GATEWAY HOST (Windows or Linux PC on restaurant LAN)       │
  │                                                                   │
  │  ┌──────────────────────┐    ┌──────────────────────────────┐    │
  │  │   Printer Service    │    │      IdealPOS Agent          │    │
  │  │   (Node.js process)  │    │  (Node.js / Windows service) │    │
  │  │                      │    │  BLOCKED ON: Q1              │    │
  │  │  polls Redis queue   │    │  polls Redis queue           │    │
  │  └────────┬─────────────┘    └──────────────┬───────────────┘    │
  │           │                                  │                    │
  │           ▼                                  ▼                    │
  │  ┌────────────────┐              ┌──────────────────────┐        │
  │  │ Kitchen Printer│              │   IdealPOS software  │        │
  │  │  POS Printer   │              │   (Windows, local)   │        │
  │  │  Bar Printer   │              └──────────────────────┘        │
  │  └────────────────┘                                               │
  └───────────────────────────────────────────────────────────────────┘
```

---

## 2 — Component Diagram

```
╔══════════════════════════════════════════════════════════════╗
║              VERDURA API — INTERNAL COMPONENTS               ║
╚══════════════════════════════════════════════════════════════╝

  ┌─────────────────────────────────────────────────────────────┐
  │  NestJS Application (verdura-api)                           │
  │                                                             │
  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  │
  │  │ Auth Module  │  │ Venues Module│  │  Menu Module     │  │
  │  │ JWT / RBAC   │  │ Org / Venue  │  │  Category /      │  │
  │  │ TOTP         │  │ Tables /     │  │  MenuItem /       │  │
  │  │ Rate limit   │  │ FloorPlans   │  │  Modifiers        │  │
  │  └──────────────┘  └──────────────┘  └──────────────────┘  │
  │                                                             │
  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  │
  │  │ Reservations │  │ Orders Module│  │  Kiosk Module    │  │
  │  │ Module       │  │ Order CRUD   │  │  Public menu API  │  │
  │  │ Booking flow │  │ Status FSM   │  │  Order submit     │  │
  │  │ Calendar sync│  │ KDS feed     │  │  Table select     │  │
  │  └──────────────┘  └──────────────┘  └──────────────────┘  │
  │                                                             │
  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  │
  │  │ Printer      │  │  POS Sync    │  │  Reporting       │  │
  │  │ Module       │  │  Module      │  │  Module          │  │
  │  │ Job dispatch │  │  Adapter     │  │  Sales / Covers  │  │
  │  │ Retry queue  │  │  registry    │  │  CSV export      │  │
  │  └──────────────┘  └──────────────┘  └──────────────────┘  │
  │                                                             │
  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  │
  │  │ Staff Module │  │ Media Module │  │  Audit Module    │  │
  │  │ User CRUD    │  │ Upload /     │  │  AuditLog writes │  │
  │  │ VenueAccess  │  │ Optimize /   │  │  Interceptor     │  │
  │  │ Password mgmt│  │ Object store │  │  Search / export │  │
  │  └──────────────┘  └──────────────┘  └──────────────────┘  │
  │                                                             │
  │  ┌─────────────────────────────────────────────────────┐    │
  │  │  WebSocket Gateway (Socket.io)                      │    │
  │  │  Rooms: venue:{venueId}:kds  venue:{venueId}:orders │    │
  │  │  Redis adapter for multi-instance pub/sub           │    │
  │  └─────────────────────────────────────────────────────┘    │
  │                                                             │
  │  ┌─────────────────────────────────────────────────────┐    │
  │  │  Background Workers (BullMQ on Redis)               │    │
  │  │  Queues: print-jobs | pos-sync | emails | calendar  │    │
  │  └─────────────────────────────────────────────────────┘    │
  │                                                             │
  │  ┌──────────────────────────────────────────────────────┐    │
  │  │ Prisma ORM → Local PostgreSQL                        │    │
  │  │ All 18 entities — JSONB for MenuItem nutritional,     │    │
  │  │ modifierGroups, OrderItem selectedModifiers,          │    │
  │  │ AuditLog before/after, POSSyncRecord payloads         │    │
  │  └──────────────────────────────────────────────────────┘    │
  └─────────────────────────────────────────────────────────────┘
```

---

## 3 — Deployment Diagram

### Single-Restaurant Mode (Verdura Auckland — current)

```
  CLOUD (e.g. AWS / Render / Railway)
  ─────────────────────────────────────────────────────────────────────────
  verdura.co.nz          ┌──────────────────────────────────────────────┐
  (CDN / static host)    │  api.verdura.co.nz                           │
  ┌───────────────┐      │  ┌──────────────────┐  ┌──────────────────┐  │
  │ Customer Site │      │  │  API Container   │  │  API Container   │  │
  │ (frozen SPA)  │      │  │  (NestJS)        │  │  (NestJS)        │  │
  │ Static files  │      │  └────────┬─────────┘  └────────┬─────────┘  │
  │ Served by CDN │      │           └────────────┬─────────┘            │
  └───────────────┘      │                        ▼                      │
                         │               ┌──────────────────┐            │
  admin.verdura.co.nz    │               │  Redis (managed) │            │
  ┌───────────────┐      │               └──────────────────┘            │
  │ Admin SPA     │      │                                                │
  │ (React/TS)    │      │  ┌──────────────┐   ┌───────────────────┐    │
  │ (React/TS)    │      │  ┌──────────────────────────────────────┐    │
  │ Static files  │      │  │ PostgreSQL (Docker, persistent volume)│    │
  │ Served by CDN │      │  └──────────────────────────────────────┘    │
  └───────────────┘      │                                               │
                         │                                               │
  ┌───────────────┐      │                   │  Object Storage     │    │
  │ Kiosk SPA     │      │                   │  (S3 / GCS bucket)  │    │
  │ Kiosk SPA     │      │                   │  Object Storage     │    │
  │ (Self-order + │      │                   │  (Local media volume)│   │
  └───────────────┘      └──────────────────────────────────────────────┘

  RESTAURANT LAN (on-premise, Auckland)
  ─────────────────────────────────────────────────────────────────────────
  ┌──────────────────────────────────────────────────────────────────────┐
  │  Local Gateway PC (always-on, connected to internet + printer LAN)  │
  │                                                                      │
  │  ┌───────────────────────────┐   ┌────────────────────────────────┐ │
  │  │  Printer Service          │   │  IdealPOS Agent                │ │
  │  │  verdura-printer-service  │   │  verdura-pos-agent             │ │
  │  │  (Node.js, PM2 managed)   │   │  BLOCKED ON: Q1               │ │
  │  │                           │   │  (Node.js, PM2 managed)       │ │
  │  │  • Polls Redis print queue│   │  • Polls Redis pos-sync queue │ │
  │  │  • ESC/POS over TCP       │   │  • Calls IdealPOS adapter     │ │
  │  │  • Reports job status     │   │  • Reports sync status        │ │
  │  └──────────┬────────────────┘   └────────────────────────────────┘ │
  │             │                                                        │
  │             ▼                                                        │
  │  ┌──────────────────┐  ┌──────────────┐  ┌────────────────────┐    │
  │  │  Kitchen Printer │  │  POS Printer │  │  IdealPOS (Windows)│    │
  │  │  TCP/ESC/POS     │  │  TCP/ESC/POS │  │  BLOCKED ON: Q1    │    │
  │  └──────────────────┘  └──────────────┘  └────────────────────┘    │
  │                                                                      │
  │  Browser devices (on LAN, also accessible via cloud):               │
  │  • Self-Ordering Kiosk tablet → kiosk.verdura.co.nz                │
  │  • Menu Display Kiosk screen → kiosk.verdura.co.nz/display         │
  │  • KDS kitchen screen → kiosk.verdura.co.nz/kds                    │
  └──────────────────────────────────────────────────────────────────────┘
```

### Multi-Restaurant SaaS Mode (future)

```
  CLOUD
  ──────────────────────────────────────────────────────────────
  ┌──────────────────────────────────────────────────────────┐
  │  API cluster (shared, multi-tenant)                      │
  │  All tenants scoped by organizationId / venueId          │
  │  PostgreSQL: row-level venueId WHERE clauses             │
  │  All entities venueId-scoped in local PostgreSQL          │
  └──────────────────────────────────────────────────────────┘

  PER-VENUE ON-PREMISE (each restaurant location)
  ────────────────────────────────────────────────
  Venue A Local Gateway ──► Shared cloud API (venueId=A)
  Venue B Local Gateway ──► Shared cloud API (venueId=B)
  Venue C Local Gateway ──► Shared cloud API (venueId=C)

  Each gateway runs its own isolated Printer Service + IdealPOS Agent,
  connecting to that venue's physical hardware only.
  Redis queues are namespaced by venueId: print-jobs:{venueId}
```

---

## 4 — Service Responsibilities

### 4.1 Customer Website
- **Hosting:** Static CDN (Netlify / Vercel / Cloudfront + S3). `verdura.co.nz`
- **Runtime:** Browser only. Configured to call the NestJS API through the same-origin development/host proxy.
- **Frozen Layout:** Visual and structural layout remains frozen (zero changes to visual `src/` elements), except for removing the `/admin/daily-email` route from `App.jsx`, implementing dynamic API-driven menu data integration, and removing all Airtable references.
- **Backend dependency:** Connects dynamically to NestJS for live categories, menu items, availability, and reservations. NestJS persists operational records through Prisma to local PostgreSQL.
- **Build:** `npm run build` in `verdura_v1.2/`. Output: `dist/`. Deployed to static host.

### 4.2 Admin Dashboard
- **Hosting:** Static CDN at `admin.verdura.co.nz` (separate origin, separate CDN distribution from public site).
- **Tech:** React 18, TypeScript, Vite, Tailwind CSS, TanStack Query, Zustand, React Router v6.
- **Auth:** JWT (short-lived access token, 15 min) + refresh token (HttpOnly cookie, 7 days). All routes server-guarded: the CDN returns a login redirect for unauthenticated requests via Edge Function / middleware, before any dashboard bundle loads.
- **Responsibilities:** Menu management, reservation management, order management, staff management, printer configuration, reporting, audit log, venue settings, daily email settings (replacing the extracted `/admin/daily-email` page).
- **RBAC enforcement:** API layer rejects tokens lacking the required role — UI hiding alone is never the security boundary.
- **Repo:** New repository: `verdura-admin`.

### 4.3 Entrance Kiosk (Menu Display)
- **Hosting:** Static CDN. Path: `kiosk.verdura.co.nz/display`
- **Tech:** React 18, TypeScript, Vite, Tailwind CSS.
- **Auth:** None (public read-only). API endpoint `/api/kiosk/menu` is unauthenticated but rate-limited and read-only.
- **Responsibilities:** Display full menu including item images, descriptions, pricing, dietary/allergen info, and availability. Allow customers to browse categories and menu items.
- **Strictly read-only:** No cart, ordering, or payment. Hits menu API only.
- **Repo:** `verdura-kiosk` (shared with ordering kiosk — different routes/views).

### 4.4 Ordering Kiosk (Self-Service Ordering)
- **Hosting:** Static CDN. Path: `kiosk.verdura.co.nz/order` (or `/`)
- **Tech:** React 18, TypeScript, Vite, Tailwind CSS, Zustand (cart state), IndexedDB (offline queue).
- **Auth:** None for browsing/ordering. Staff PIN required for kiosk management overlay.
- **Responsibilities:** Browse menu, add items to cart, place orders, make payments directly at the kiosk.
- **Order Submission Workflow:** The API atomically stores the immutable order/version, idempotency result and transactional outbox. It delivers the POS command to the venue connector; after durable connector acceptance it releases independent KDS and station-KOT commands. In-person payment subsequently occurs through Idealpos/EFTPOS. Online-paid orders are verified first and submitted with `PREPAID / ONLINE` tender context.
- **Repo:** `verdura-kiosk` (shared with entrance kiosk).


### 4.5 Kitchen Display System (KDS)
- **Hosting:** Static CDN. Path: `kiosk.verdura.co.nz/kds`
- **Tech:** React 18, TypeScript, Vite, Tailwind CSS, Socket.io client.
- **Auth:** Venue-scoped token issued by staff PIN entry on first load (no full login flow). The token grants read+status-update access to orders for a specific venue only.
- **Responsibilities:** Real-time order display via WebSocket. Status transitions: pending → preparing → ready. Visual/audible alerts. Age-based colour coding.
- **Repo:** `verdura-kiosk` (shared — separate route).

### 4.6 Verdura API
- **Hosting:** Cloud container (Docker). `api.verdura.co.nz`. Multi-instance behind load balancer.
- **Tech:** NestJS (Node.js), TypeScript, Prisma (PostgreSQL), BullMQ (Redis queues), Socket.io (WebSocket gateway with Redis adapter).
- **Responsibilities:**
  - Auth: JWT issuance, refresh, TOTP validation, rate limiting
  - All CRUD operations for every entity in the domain model
  - Business logic: reservation capacity enforcement, dual payment workflow, immutable order versioning, station routing, transactional outbox and reconciliation
  - WebSocket gateway: delivers acknowledged, replay-safe order events to venue-scoped KDS/admin rooms
  - Media: receives image uploads, triggers optimisation, returns object storage URL
  - Background workers: print retry, POS sync retry, email delivery, calendar sync
  - Health check endpoint
- **Database access:**
  - Local PostgreSQL via Prisma: all domain entities, including JSONB columns for MenuItems, PrinterJobs, and AuditLogs.
  - Prisma uses the local Docker connection from `apps/api/.env`; Compose host mode overrides the hostname to `postgres` inside the Docker network.
- **Queue workers (BullMQ):**
  - `print-jobs` queue: read by on-premise Printer Service
  - `pos-sync` queue: read by on-premise IdealPOS Agent
  - `email` queue: processed in-cloud (email provider API call)
  - `calendar` queue: processed in-cloud (Google Calendar API call)
- **Repo:** `verdura-api`.

### 4.7 Printer Service
- **Hosting:** On-premise (local gateway PC at each restaurant). Node.js process, managed by PM2.
- **Tech:** Node.js/TypeScript edge runtime with a durable encrypted local queue and outbound mutually authenticated connector session; printer protocol library confirmed against Q2 hardware.
- **Responsibilities:**
  - Receive scoped station-print commands through the connector command API; do not connect to shared cloud Redis
  - Connect to physical printers via TCP/IP (or USB/Windows shared — `BLOCKED ON: Q2`)
  - Render print job payload to ESC/POS bytes and dispatch
  - Update job status (printing → printed / failed) via API callback
  - Retry on failure (up to `maxAttempts` configured per printer)
  - Report printer online/offline status to API on each poll cycle
- **Network requirement:** LAN access to physical printers and outbound HTTPS/TLS to Verdura; no inbound public port and no shared cloud Redis credential.
- **Configuration:** `venueId`, Redis connection string, printer configs (host:port per printer) — stored in `.env` on the gateway device.
- **Repo:** `verdura-printer-service`.

### 4.8 IdealPOS Agent
`BLOCKED ON: Q1 — integration mechanism unknown`

- **Hosting:** On-premise (local gateway PC, same host as Printer Service or separate).
- **Tech:** Node.js/TypeScript connector using a durable encrypted local queue and pluggable, vendor-approved Idealpos adapter.
- **Responsibilities:**
  - Receive venue-scoped POS commands through the outbound connector session and persist before acknowledging acceptance
  - Execute the configured adapter (ApiAdapter / SqlAdapter / OdbcAdapter / CsvAdapter — Phase 5)
  - Report sync result (posOrderId, error) back to API via callback
  - Retry on failure
- **Network requirement:** LAN access to Idealpos and outbound mutually authenticated HTTPS/TLS to Verdura; no direct public exposure of Idealpos and no cloud Redis credential.
- **Repo:** `verdura-pos-agent` (or integrated into `verdura-printer-service` as a second worker process if they share the same gateway host).

---

## 5 — Required Decision: Public/Admin Hosting Boundary

**Decision: Option 1 — Separate subdomain (selected)**

The Admin Dashboard is deployed at `admin.verdura.co.nz`, completely decoupled from `verdura.co.nz`.

**Justification:**
- The frozen public site and the admin dashboard have entirely different build pipelines, deployment cadences, and security postures. Keeping them on separate origins means a deploy of the admin dashboard can never accidentally break the public site.
- The public site CDN configuration (caching rules, headers, redirects) remains untouched.
- Blast radius containment: an incident on the admin domain (compromised session, misconfigured header) cannot cascade to the public domain.
- Option 2 (sub-path routing) would require either: (a) changing the public site's hosting config (violates the freeze spirit), or (b) a reverse proxy in front of both that adds operational complexity with no benefit over Option 1.

**Implementation specifics:**

```
verdura.co.nz          → Public site CDN (static, no auth)
admin.verdura.co.nz    → Admin Dashboard CDN
api.verdura.co.nz      → API load balancer
kiosk.verdura.co.nz    → Kiosk/KDS CDN
```

**RBAC enforcement chain:**
1. DNS resolves `admin.verdura.co.nz` to the admin CDN
2. CDN Edge Function checks for a valid session cookie; unauthenticated requests receive a 302 to `/login` — no dashboard bundle is served
3. After login, API issues a short-lived JWT (15 min) stored in `Authorization` header for API calls, plus a `HttpOnly Secure SameSite=Strict` refresh token cookie
4. Every API endpoint checks the JWT's `role` claim server-side via NestJS `@Roles()` guard before executing any handler
5. The role claim is authoritative — the UI may hide buttons, but the API enforces the boundary independently

**No security-through-obscurity:** The admin subdomain is not a secret. Unauthenticated visitors get a login page, not a 404. URL knowledge confers no access.

**IP allowlisting (optional hardening):** If Verdura staff operate exclusively from a known IP range (office/VPN), the CDN or API load balancer can enforce IP allowlisting as an additional layer. Not a primary control; not required for launch.

---

## 6 — Required Decision: Media Storage & Optimization

**Decision: Persistent local media volume**

### Current MVP Implementation

The design below (S3/CDN, `sharp` optimization, org/item-scoped keys) is the target state, not what's built yet. Today there are two separate, intentionally unmerged image paths — do not consolidate them:

1. **Static default/catalogue images** — `apps/admin-console/public/menu-images/`, git-tracked, referenced as a site-relative path: `MenuItem.imageUrl = "/menu-images/<filename>"`. Bundled into every frontend build (Vite copies `public/` into `dist/` at build time); each frontend serves its own copy from its own build output. This is the canonical source — `dist/menu-images/` is disposable, regenerated output and must never be edited or referenced directly.
2. **Runtime admin uploads** — handled by `MediaService`/`MediaController` (`apps/api/src/media/`), stored on local disk at `apps/api/storage/menu-items/<uuid>.<ext>` (path configurable via `MEDIA_STORAGE_PATH`), served at runtime via `GET /media/menu-items/<file>` (registered in `main.ts`, outside the `/api` prefix). `MenuItem.imageUrl` stores the resulting absolute URL. Used when an admin uploads/replaces a photo from the Edit Item panel in Menu Management.

Both shapes are accepted by the same `imageUrl` field — see `apps/api/src/menu/dto/image-url.pattern.ts` (absolute `http(s)://` URL, or a site-relative `/...` path).

**2026-08-17 update:** a concrete implementation of the GCS-backed design below is live — two real buckets (`verdura-media-originals-d3794338b2` private, `verdura-media-public-d3794338b2` public-read-approved-only) in `australia-southeast1`, project `project-10bd9c5c-d379-4338-8b2`. All 46 canonical menu-item photographs have been migrated; `MenuItem.imageUrl` for 38 items now points directly at a public GCS URL. See `_bmad-output/implementation-artifacts/2026-08-17-gcs-media-architecture.md` for the full record, including a real signing defect found and fixed against actual GCS (plain ADC cannot sign V4 URLs — the provider now signs via service-account impersonation). It differs from the sketch immediately below in two ways: uploads use a short-lived **signed URL the client PUTs to directly** (never a multipart POST proxied through the API), and the `sharp`-based resize/variant pipeline described below is **not yet implemented** — recorded as deferred work, not silently dropped. The two paths described immediately above (static default images, `MediaService` runtime uploads) remain implemented exactly as documented for anything not yet migrated — path 1's local files for the 46 migrated menu items have been removed (they were exact triplicated duplicates of what's now in GCS); path 2 (`MediaService`, admin photo uploads) is unaffected and unchanged.

### Object Storage (target state)

Images live in an S3 bucket (or GCS equivalent). The database (`MenuItem.imageUrl`) stores only the resulting CDN URL — never raw binary data.

```
Upload flow:
  Admin Dashboard
      │ multipart POST /api/admin/media/upload
      ▼
  Verdura API (Media Module)
      │ 1. Validate file type (magic bytes — not just extension)
      │ 2. Validate max size (10 MB hard limit)
      │ 3. Process with sharp:
      │    - Resize to max 1200×1200px (preserve aspect ratio)
      │    - Convert to .webp (quality: 85)
      │    - Generate thumbnail variant: 400×400px .webp
      │ 4. Upload both variants to S3:
      │    - s3://verdura-media/{orgId}/menu/{itemId}/full.webp
      │    - s3://verdura-media/{orgId}/menu/{itemId}/thumb.webp
      │ 5. Return CDN URLs (CloudFront / GCS CDN in front of bucket)
      ▼
  MenuItem.imageUrl = "https://media.verdura.co.nz/menu/{itemId}/full.webp"
  MenuItem.imageThumbnailUrl = "https://media.verdura.co.nz/menu/{itemId}/thumb.webp"
```

**Why sharp:** Pure Node.js native addon, no external service dependency, processes images in the API container. Alternative considered: Cloudinary (external SaaS) — simpler but adds vendor dependency and cost scaling. sharp keeps processing in-house with no per-transform cost.

**Replace flow:** On image replace, the old S3 objects are deleted and new ones uploaded to the same key paths, which immediately invalidates CDN cache for those URLs.

**Remove flow:** `imageUrl` and `imageThumbnailUrl` set to `null` on the MenuItem; S3 objects deleted.

### CRUD Endpoints (behind admin auth)

```
POST   /api/admin/media/upload          → upload + optimize, returns URLs
DELETE /api/admin/media/:itemId/image   → delete S3 objects, nullify MenuItem.imageUrl
```

All endpoints require `Authorization: Bearer <admin-jwt>` with role `manager` or higher.

### Live Menu Pipeline (Overriding Tension T-01)

All customer-facing experiences must reflect the same live menu data and availability from the PostgreSQL-backed NestJS API. There are no manual exports or static JSON/localStorage runtime fallbacks.

---

## 7 — Consolidated Data Store & Airtable Removal

**Decision: Consolidated relational core & Airtable Removal (Selected)**

The database layer is one local **PostgreSQL database** accessed through Prisma. All polymorphic and flexible schema fields are stored in PostgreSQL `jsonb` columns.

All applications query operational data through NestJS and save records exclusively to local PostgreSQL. No alternate database, browser-storage fallback, or manual export/import path is used.


### PostgreSQL (via Prisma)

All entities in the system (`Organization`, `Venue`, `Table`, `FloorPlan`, `Staff`, `VenueAccess`, `Reservation`, `ReservationMenuSelection`, `Payment`, `Order`, `OrderItem`, `POSSyncRecord`, `Category`, `MenuItem`, `MenuItemVenueOverride`, `Printer`, `PrinterJob`, `AuditLog`) are stored in the same PostgreSQL database instance.

### Rationale for Consolidating to Local PostgreSQL

1. **Transactional Integrity & ACID Compliance:**
   - Relational entities (`Reservation`, `Payment`, `Order`) require strong consistency and ACID guarantees. PostgreSQL enforces these constraints natively via foreign key mappings and database-level checks.

2. **Polymorphic Data via JSONB:**
   - **MenuItem:** `nutritionalDetails` and `modifierGroups` contain nested arrays. PostgreSQL `jsonb` columns store these structures efficiently, allowing indexes and querying without normalizing the fields into separate tables or introducing MongoDB.
   - **AuditLog:** Stores polymorphic state changes (`before`/`after` snapshots). Stored as a `jsonb` object to accommodate varying schemas per entity type.
   - **PrinterJob:** Ephemeral printing payloads are stored as base64-encoded strings directly in a PostgreSQL text/bytea column. Since these are cleaned up frequently, database bloat is easily mitigated via BullMQ's automatic job removal settings.

3. **Eliminating Cross-Store Risks:**
   - Storing orders in PostgreSQL and menus in MongoDB creates application-layer overhead to validate menu item references. Moving all tables to a single PostgreSQL schema enables database-level referential integrity checks.

4. **Zero Impact on Frontend Freeze:**
   - The public website booking flow calls NestJS, keeping validation and persistence in one backend boundary.

5. **ORM Choice: Prisma:**
   - Prisma acts as the database client for the NestJS backend, mapping model shapes and generating typescript types. Type assertions are used to enforce type safety on PostgreSQL `jsonb` structures.

---

## 8 — Phase 0 Constraints on Architecture

| Phase 0 Finding | Architectural Impact |
|-----------------|---------------------|
| No backend exists (DL-001) | Entire API is greenfield. No migration of existing backend logic. |
| IdealPOS integration unknown (DL-002) | IdealPOS Agent is designed as a pluggable on-premise process. Architecture does not assume a specific adapter. |
| Stack is JavaScript not TypeScript (DL-003) | Frozen public site stays in JS. All new services (api, admin, kiosk) in TypeScript. |
| Admin route in public frontend (DL-004) | Admin Dashboard is a fully separate application at a separate domain. The extracted `/admin/daily-email` functionality is re-implemented there. |
| Menu data is static JSON (DL-005) | Menu module imports the existing JSON as seed data via migration script. No structural change to the frozen site. |
| Pricing is floats in existing data (DL-007) | Migration script multiplies prices by 100 and rounds to nearest integer before seeding PostgreSQL. |

---

## 9 — Security Architecture Summary

```
Public internet
    │
    ├── verdura.co.nz (CDN) ────────────────► Static files. No auth required. Queries live
    │                                          menu items & writes reservations through NestJS.
    │
    ├── admin.verdura.co.nz (CDN + Edge) ───► Edge Function checks session cookie.
    │       │                                  Unauthenticated → 302 to /login.
    │       │                                  Authenticated → serve SPA bundle.
    │       └── → api.verdura.co.nz ─────────► JWT verified on every request.
    │                                          RBAC guard checks role per endpoint.
    │                                          Rate limiting on auth endpoints.
    │
    ├── kiosk.verdura.co.nz (CDN) ──────────► Public routes: /display, /order
    │       │                                  No auth for browsing/ordering.
    │       │                                  /kds: venue-scoped PIN token.
    │       └── → api.verdura.co.nz ─────────► Kiosk endpoints: rate-limited,
    │                                          read-only menu + write-only orders.
    │                                          No admin data accessible.
    │
    └── api.verdura.co.nz (load balancer) ──► HTTPS/TLS 1.2+ only.
                                              CORS: whitelist of known origins.
                                              Helmet.js security headers.
                                              Input validation (class-validator).
                                              SQL injection: Prisma parameterised queries.
                                              Secrets in env vars / secrets manager.
```

---

## 10 — Technology Standard: Current MVP and Approved Target Architecture

> **Normative — 2026-09-01.** This section is the source of truth for which technology owns which
> capability at Verdura. It distinguishes what is **built today (Current MVP)** from what is
> **approved as the destination (Target)**. A technology listed under Current MVP is not, by that
> fact alone, the permanent owner of its capability. Where this section and any other document
> disagree on technology ownership, this section governs.

### 10.1 Purpose

- State the approved **target** owner for each capability domain.
- State honestly what the **current MVP** actually runs, without implying it is the destination.
- Define the **migration ownership boundaries** that move current implementations to the target.
- Record which technologies are **permitted exceptions**, and which must **not** be introduced.

### 10.2 Current MVP architecture (current implementation — not automatically the target)

This is what exists and runs today. Label these **CURRENT IMPLEMENTATION** in any downstream
document; do not restate them as permanent target ownership.

| Layer | Current implementation | Version target | Target disposition |
|-------|-----------------------|----------------|--------------------|
| API framework | NestJS | 11.x | **Migrates to Go Core Platform** (§10.3.C, §10.5) |
| API language | TypeScript (Node.js) | 5.x | Migrates to Go for platform services |
| PostgreSQL ORM | Prisma | 5.x | Retires with the Node services it serves |
| Queue / workers | BullMQ | 5.x | Migrates with the owning service |
| WebSocket | Socket.io | 4.x | Migrates with the owning service |
| Redis client | ioredis | 5.x | Redis itself remains; client follows the owning service |
| Image processing | sharp | 0.33.x | Follows the owning service |
| Admin frontend | React 18, TypeScript, Vite, Tailwind, TanStack Query, Zustand | latest stable | **Target-aligned** — stays React + TypeScript |
| Kiosk / KDS / Order Tablet / Window Display frontends | React 18, TypeScript, Vite, Tailwind, Zustand | latest stable | **Target-aligned** as web apps; native device surfaces move to Kotlin/Android only at a justified boundary (§10.6.B) |
| Customer website | React 18, JavaScript, Vite | latest stable | Stays React/TypeScript; Next.js permitted only per §10.7 |
| On-premise services | Node.js 20 LTS, PM2 | LTS | **Migrates to Go Venue/Edge** (§10.3.D) |
| Venue connector / IdealPOS bridge | C# / .NET 8 | 8.x | **Narrows** to the Windows/IdealPOS adapter only (§10.6.C) |
| Database | PostgreSQL | 16.x | **Target-aligned** |
| Cache / queue broker | Redis | 7.x | **Target-aligned** |
| Containerisation | Docker + Docker Compose | 24.x | **Target-aligned** (§10.9) |
| CI/CD | Automated CI | — | Target-aligned |
| Email | Resend (primary) / SendGrid (fallback) | — | Target-aligned |
| Media storage | Google Cloud Storage (see §6) | — | **Target-aligned** |
| Payments | Stripe | — | Target-aligned |

**Explicitly:** the current MVP is **not yet identical** to the approved target architecture below.
Node/TypeScript core services and the current breadth of .NET venue orchestration are the
*current* implementation of capabilities the target standard assigns to **Go**.

### 10.3 Approved target architecture

**A. React + TypeScript — Web applications.**
Admin Console, KDS, Order Tablet, Window Display, Kiosk, Customer Website. Vite is the standard
build tool for the operational apps.

**B. Kotlin + Android — Native device applications.**
The standard for **new** native device surfaces.

**C. Go — Core Platform.**
Transactional business services; orders; venue state; table/order lifecycle orchestration;
staff/authorization orchestration where appropriate; menu/platform APIs; connector command
orchestration; device/venue configuration; event publication; platform services.

**D. Go — Venue / Edge.**
Cloud-to-venue communication; local durable command handling; synchronization; retries;
telemetry; edge state; platform-independent venue orchestration.

**E. Python — AI / Data / Analytics.**
Analytics, data pipelines, forecasting, optimization, machine learning, AI, anomaly detection,
menu intelligence, kitchen analytics, demand prediction.

**F. C# / .NET — Windows / IdealPOS integration boundary.**
Narrow by design; see §10.6.C.

**G. PostgreSQL — Transactional source of truth.**

**H. Google Cloud Storage — Media storage.** (Consistent with §6.)

**I. Docker — Infrastructure / packaging / deployment standard.** (See §10.9.)

**J. Next.js — permitted exception within the React/TypeScript web domain**, public website only.
(See §10.7.)

**K. Kubernetes — later-stage deployment option only.** Not an MVP requirement and not part of
the application architecture. (See §10.9.)

### 10.4 Technology ownership matrix

| Domain / capability | Target owner | Current implementation | Status |
|---------------------|--------------|------------------------|--------|
| Web applications (admin, KDS, tablet, window, kiosk, website) | **React + TypeScript** | React + TypeScript + Vite | Aligned |
| Native device applications | **Kotlin + Android** | Web-based device surfaces (React) | Migrate only at a justified boundary (§10.6.B) |
| Core Platform: orders, venue state, table/order lifecycle, staff/authorization orchestration, menu/platform APIs, connector command orchestration, device/venue configuration, event publication | **Go** | NestJS / Node.js + TypeScript + Prisma | Migration required (§10.5) |
| Venue / Edge: cloud-to-venue comms, durable local command handling, sync, retries, telemetry, edge state | **Go** | Node.js/PM2 on-premise services + .NET venue-connector | Migration required (§10.5) |
| IdealPOS / Windows adapter: vendor SDK, Webit, IPS/POSServer, Windows APIs, UI Automation, interactive terminal agent | **C# / .NET** | C# / .NET 8 connector + tracer | Aligned, but must **narrow** to this boundary |
| AI / Data / Analytics: pipelines, forecasting, optimization, ML, anomaly detection, menu intelligence, kitchen analytics, demand prediction | **Python** | Not yet implemented | Target technology, first-class — not "optional/future" |
| Transactional source of truth | **PostgreSQL** | PostgreSQL 16 | Aligned |
| Media storage | **Google Cloud Storage** | GCS (§6) | Aligned |
| Packaging / deployment | **Docker** | Docker + Compose | Aligned |
| Public website SSR/SEO | React/TS, **Next.js permitted exception** | React + Vite | Exception only where justified (§10.7) |
| Cluster orchestration | **Kubernetes — later-stage option** | Not used | Not required for MVP |

Go and Python are recorded as **first-class target technologies**, not optional or speculative.

### 10.5 Migration policy

Go progressively replaces equivalent Node and .NET platform functionality at **defined
boundaries**. Kotlin/Android progressively takes over native device surfaces at defined
boundaries. Migration never proceeds by accretion.

**Every migration must record, before work starts:**

1. **Current owner** — the exact service/capability being replaced.
2. **New owner** — the Go (or Kotlin) component that takes ownership.
3. **Cutover** — how traffic/responsibility moves, and how it is verified.
4. **Retirement condition** — the explicit criterion under which the old implementation is
   deleted, and the bounded period in which that must happen.

**Permanent duplicate implementations are prohibited.** See §10.11.

Migration is capability-by-capability. There is no big-bang rewrite, and no requirement to
migrate a capability that is working and in scope until its boundary is defined.

### 10.6 Platform boundaries

**A. Go Core Platform vs Python intelligence.**

> **Go owns transactional truth. Python derives intelligence.**

Python must **not** become a second transactional backend. Python does **not** own: create order;
close table; payment lifecycle; staff transactional state; venue transactional truth; POS command
truth; or transactional menu/order source-of-truth operations. Python services **consume**
authoritative platform data and events and **produce derived outputs** (forecasts, scores,
recommendations, anomaly signals, analytics datasets).

**B. Kotlin/Android vs existing web device surfaces.**

Kotlin + Android is the standard for **new** native device applications. Existing React-based
device apps (KDS, Order Tablet, Window Display, Kiosk) **remain valid** and require no immediate
rewrite. Migrate a surface to native Android where it materially improves device control,
reliability, kiosk behaviour, offline operation, peripheral access, lifecycle management, or
deployment/device management — and only with a defined migration boundary per §10.5.

**C. Go Venue/Edge vs C#/.NET Windows adapter.**

| Responsibility | Owner |
|----------------|-------|
| General, platform-independent venue/edge orchestration; cloud-to-venue transport; durable command handling; sync; retries; telemetry; edge state | **Go Venue/Edge** |
| IdealPOS vendor SDK integration; Webit; IPS / POSServer integration; Windows APIs; Windows UI Automation; the interactive Windows terminal agent; other unavoidable Windows/vendor-specific adapters | **C# / .NET** |

C#/.NET must **not** become a competing general Core Platform or a general-purpose Venue/Edge
platform. It exposes a **narrow** adapter surface to the Go edge. This does not weaken the
existing outbound-only, mutually authenticated connector trust boundary (§4.8,
[target-operating-model.md](./target-operating-model.md) §8) — that constraint applies to
whichever technology implements the connector.

**D. React/TypeScript web domain.**

React + TypeScript remains the primary web standard, and the current Vite-based operational apps
remain valid. There is **no blanket migration to Next.js**.

### 10.7 Permitted exceptions

**Next.js — PERMITTED EXCEPTION, NOT GENERAL STANDARD.**

Permitted only inside the React/TypeScript web domain, for the **public customer website**, and
only where there is a demonstrated requirement for SSR, SEO, metadata generation, public
landing/location/menu pages, server rendering, or public-web performance benefits.

Do **not** migrate Admin Console, KDS, Order Tablet, or Window Display to Next.js for
consistency. Those are authenticated/operational surfaces with no SSR or SEO requirement.

**Rust — architecture exception only.** Not a standard Verdura technology. Permitted solely
through a specific, recorded architecture exception for a demonstrated native, security,
performance, or embedded requirement that Go, Kotlin, or .NET cannot meet cleanly.

**Django — conditional, inside the Python domain only.** Not automatically approved because
Python is approved. Permitted only within the Python AI/Data/Analytics domain where Django itself
is specifically justified, and never as a second general transactional backend.

### 10.8 Prohibited / non-standard technologies

| Technology | Disposition | Reason |
|------------|-------------|--------|
| **Bun** | Not part of the approved architecture | No unique ownership domain. Do not introduce it to optimize Node tooling during a migration *away* from Node-owned core services. |
| **Rust** | Not standard; architecture exception only | Permitted only for a demonstrated native/security/performance/embedded need that Go/Kotlin/.NET cannot meet cleanly (§10.7). |
| **Rails** | Do not introduce | Duplicates Core Platform responsibilities owned by Go. |
| **Laravel** | Do not introduce | Duplicates Core Platform responsibilities owned by Go. |
| **Django** | Not automatically approved | Permitted only inside the Python AI/Data/Analytics domain with specific justification; must never become a second general transactional backend (§10.7). |

### 10.9 Infrastructure standards

**Docker is the approved packaging and deployment standard.** Approved uses: local PostgreSQL;
local Redis; repeatable dev environments; CI parity; Go service packaging; Python worker/service
packaging; cloud service containers.

**Explicit exception — do not force the native IdealPOS Windows stack into Docker.** The
following stay native, where containerisation would break or complicate desktop, session, or
native integration:

- `IPS.exe`
- `POSServer`
- `IdealposService`
- Windows/IdealPOS C# adapters
- the interactive Windows UI automation agent

**Kubernetes is a LATER-SCALE DEPLOYMENT OPTION.** It is **not** required for the MVP, **not**
required for Go adoption, and **not** an application architecture standard. Adopt only when
justified by service count, autoscaling, regional deployment, workload scheduling, complex
service discovery, high-availability requirements, or operational/platform maturity.

Preferred progression: **Docker → managed container runtime → Kubernetes/GKE only when scale
justifies it.**

### 10.10 Current-to-target architecture diagram

```
                    TARGET ARCHITECTURE

            React + TypeScript Web
            (admin, KDS, tablet, window, kiosk, website)
                      |
                      v
              +-------------------+
              | Go Core Platform  |  transactional truth
              +-------------------+
                      |
        +-------------+------------------+
        v             v                  v
   PostgreSQL       Redis        Python Intelligence
   (source of      (cache/       (analytics, ML, AI,
    truth)          queue)        forecasting - derived,
                                  never transactional)
                      |
                      v
              +-------------------+
              | Go Venue / Edge   |  platform-independent
              +-------------------+  edge orchestration
                      |
                      v
         C# / .NET IdealPOS Adapter    narrow Windows/vendor
                      |                boundary only
                      v
            IPS / POSServer / Windows


   Native device apps:            Media:
   Kotlin / Android               Google Cloud Storage
        |
        v
   Go Platform APIs               Infrastructure:
                                  Docker as standard packaging
                                  Kubernetes only later, if justified
```

Current MVP differs from the diagram above at exactly three points: the Core Platform is NestJS/
Node instead of Go; Venue/Edge is Node/PM2 plus a broader .NET connector instead of Go; and
device surfaces are React web apps instead of Kotlin/Android. Python intelligence is not yet
built. Everything else is already target-aligned.

### 10.11 Architecture governance rules

> **NO NEW IMPLEMENTATION MAY CREATE A SECOND LONG-TERM OWNER FOR AN EXISTING CAPABILITY.**

Temporary migration overlap is allowed **only** when all five hold: a defined source owner; a
defined target owner; explicit cutover criteria; explicit retirement criteria; and a bounded
migration period.

**Prohibited (permanent duplicate ownership):**

- Node order service **and** Go order service, permanently.
- .NET venue orchestration **and** Go venue orchestration, permanently.
- A Go transactional service **and** a Python transactional service.

**Correct:**

- A Node capability migrated to Go, traffic cut over, the Node capability retired.
- Go Venue/Edge owns orchestration; .NET exposes a narrow IdealPOS/Windows adapter.
- Go publishes authoritative events and data; Python consumes them for analytics and AI.

Any proposal to introduce a technology not listed in §10.3, or to widen an owner beyond §10.4,
requires a recorded decision in [decisions-log.md](./decisions-log.md) referencing this section.
