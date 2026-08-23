# Verdura Restaurant Operations Platform — Product Requirements Document

> **Normative product decision — 2026-08-15:** All requirements inherit the [Target Operating Model](./target-operating-model.md). Verdura is the customer and operational experience layer; Idealpos is the core POS transaction and in-person-payment system. Ordinary orders are submitted to Idealpos before existing EFTPOS payment and routed to Verdura KDS/KOT after durable connector acceptance. Optional online payment is verified by Verdura and recorded in Idealpos against `PREPAID / ONLINE`. Contrary legacy sequencing below is superseded.

> **Strategic status — 2026-08-15:** This June 2026 PRD is retained as the original single-restaurant specification. It is **superseded for strategy and phasing by Verdura PRD v5.2** and complemented by [mvp.md](./mvp.md), the verified current-state/readiness baseline. Requirements below remain useful only where they do not conflict with provider neutrality, POS fiscal authority, the never-fake-success rule, or the Phase 1A gate.

## 2026-08-15 Assessment and Product Correction

The current implementation has a credible menu, reservation, order and KDS foundation, but is not a production-grade realization of this PRD:

- kiosk payment is not verified server-side and can fall back to fabricated Stripe responses;
- the POS processor fabricates Idealpos success instead of recording acknowledgement and confirmation;
- print and POS database jobs are not fed into their BullMQ queues;
- required on-premises connector/printer agents and durable offline queues do not exist;
- availability-control fan-out and reconciliation are absent;
- staff authorization is coarse and venue grants are not comprehensively enforced;
- audit is neither universal nor tamper-evident;
- reservation capacity and order numbering have concurrency risks; and
- several administration/reporting surfaces remain prototypes.

**Corrected priority:** prove one real provider-neutral handoff and availability workflow with truthful states, idempotent recovery and measurable reconciliation reduction before expanding downstream modules.

**Production gate:** no payment or POS-connected deployment until all P0 criteria in [mvp.md](./mvp.md#10-prioritized-delivery-plan) are closed.
**Phase 2 Output**
**Date:** 2026-06-18
**Status:** Draft — open items marked `BLOCKED ON` or `[UNKNOWN]`

---

## Executive Summary

Verdura is a Middle Eastern restaurant in Auckland, New Zealand. The current stack is React/Vite frontends backed by NestJS, Prisma, local PostgreSQL, Redis, and Docker Compose. Operational records are accessed through the NestJS API; localStorage is not an operational data source.

This PRD defines the full requirements for transforming Verdura into a production-grade restaurant operations platform. The work is **additive only**: the existing customer-facing website is frozen pixel-for-pixel and behaviour-for-behaviour. All new capability (Admin Dashboard, Self-Ordering Kiosk, Menu Display Kiosk, Kitchen Display, Printer Service, IdealPOS Agent) is built as new, independent surfaces that share a new backend API.

The target architecture supports both a **single-restaurant** deployment (current Verdura) and a **multi-restaurant SaaS** model (future expansion). All requirements below apply to both modes unless explicitly noted as single-restaurant-only.

---

## Business Goals

| # | Goal | Metric |
|---|------|--------|
| BG-1 | Connect the application to a unified production API and queue system | Zero reservation data loss events after go-live |
| BG-2 | Enable self-service ordering at the table via kiosk | Orders submitted via kiosk with no staff assistance |
| BG-3 | Automate kitchen and POS printing on order submission | Print latency < 3 seconds from order submit to receipt at printer |
| BG-4 | Provide real-time operational visibility to managers | Dashboard reflects order status within 5 seconds of state change |
| BG-5 | Maintain and manage menu content from an admin interface | Zero manual file edits required to update menu items |
| BG-6 | Preserve the existing customer experience without interruption | Zero customer-visible regressions to the public site during rollout |
| BG-7 | Enable multi-venue expansion under a single platform | Second venue onboardable without code changes, only configuration |
| BG-8 | Maintain accurate records for reporting and compliance | Daily/weekly/monthly sales and reservation reports available on demand |

---

## User Personas

### P1 — Restaurant Customer
**Who:** Walk-in diner or online reservation holder.
**Needs:** Browse menu, make a reservation, submit a self-service order at the kiosk, see their order status.
**Tech comfort:** Low — must work on a touchscreen with no training.
**Touchpoints:** Public website (frozen), Self-Ordering Kiosk, Menu Display Kiosk.

### P2 — Restaurant Owner
**Who:** Verdura business owner. Has full access to all platform features.
**Needs:** See all financial data, configure the platform, manage staff access, view reports.
**Tech comfort:** Medium.
**Touchpoints:** Admin Dashboard (all areas).

### P3 — Manager / Front-of-House Manager
**Who:** Senior staff member running daily operations.
**Needs:** View and manage reservations, monitor live orders, manage table assignments, push menu changes.
**Tech comfort:** Medium.
**Touchpoints:** Admin Dashboard (reservations, orders, tables, menu management).

### P4 — Kitchen Staff
**Who:** Cooks and kitchen hands.
**Needs:** See incoming orders in real time, mark orders as preparing/ready, no admin access needed.
**Tech comfort:** Low — must work on a mounted screen with minimal interaction.
**Touchpoints:** Kitchen Display System (KDS).

### P5 — Cashier / Front Counter Staff
**Who:** Staff handling payments and POS interaction.
**Needs:** See orders coming through, confirm payment, manage the POS printer queue.
**Tech comfort:** Low–medium.
**Touchpoints:** POS terminal (IdealPOS), Admin Dashboard (orders view, limited).

### P6 — Administrator / Platform Admin
**Who:** Technical owner of the platform. Could be the owner or an IT admin.
**Needs:** Manage venues, users, roles, permissions, system config, integrations, printer setup.
**Tech comfort:** High.
**Touchpoints:** Admin Dashboard (all areas including system settings).

---

## Functional Requirements

### FR-1 — Customer Website (Dynamic Menu Pipeline)

> **Frontend Exception:** The customer-facing website dynamically queries live menu data and availability through the NestJS API.

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-1.1 | The public website (`/`, `/menu`, `/book`, `/about`, `/contact`) remains visually and structurally unchanged — no styling, copy, or UI modifications. | MUST |
| FR-1.2 | The site fetches menu categories and items dynamically from the NestJS API at runtime. Updates made via the Admin Dashboard must reflect immediately with no manual exports, builds, or cache flushes required. | MUST |
| FR-1.3 | The `/admin/daily-email` route and `AdminDailyEmail` component must be **extracted** from the public frontend and re-implemented in the new Admin Dashboard. This is the **sole permitted change** to `App.jsx`. See Tension T-02. | MUST |
| FR-1.4 | After extraction of the admin route, `App.jsx` must have no remaining admin routes. The frozen site serves only the five public routes. | MUST |

**Menu Pipeline Integration (Replaced Tension T-01):**
All customer-facing experiences must reflect the same live menu data and availability state from the PostgreSQL-backed NestJS API. Static JSON and localStorage runtime fallbacks are removed.

**Tension T-02 — Admin route extraction:**

Removing `/admin/daily-email` from `App.jsx` is technically a change to the frozen frontend. It is treated as a **security fix** not a feature change, and is the minimum viable change required to comply with the Public/Admin Hosting Separation requirement. The extracted functionality must be fully replicated in the new Admin Dashboard before this removal is made.

---

### FR-2 — Reservations

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-2.1 | Customers can make a table reservation online via the existing booking flow (5-step wizard). | MUST |
| FR-2.2 | Reservation data is persisted in local PostgreSQL through Prisma and NestJS. | MUST |
| FR-2.3 | Reservation fields: guest name, email, phone, party size, date, time, occasion, dietary preferences (multi-select), special requests, pre-selected menu items and their total, payment method, payment status, booking reference, status. | MUST |
| FR-2.4 | Booking reference is server-generated in the format `VR-NNNN` (4-digit random, collision-checked). | MUST |
| FR-2.5 | Reservation status lifecycle: `pending` → `confirmed` → `seated` → `completed` / `cancelled` / `no_show`. | MUST |
| FR-2.6 | On confirmation, a transactional email is sent to the customer and to `bookings.verdura@gmail.com` (or configured owner address). | MUST |
| FR-2.7 | On confirmation, a Google Calendar event is created for the reservation via direct synchronous API calls to the Google Calendar API, and the `calendar_event_id` is stored on the reservation record. No Airtable sync or intermediate queue is permitted. | SHOULD |
| FR-2.8 | On cancellation, the customer receives a cancellation email and the Google Calendar event is deleted/updated via direct synchronous API calls. | SHOULD |
| FR-2.9 | Managers can view, filter, and update all reservations from the Admin Dashboard. | MUST |
| FR-2.10 | Managers can manually confirm, cancel, or mark reservations as no-show from the dashboard. | MUST |
| FR-2.11 | A daily reservation summary email is sent automatically at midnight NZT to a configured recipient. | SHOULD |
| FR-2.12 | Payment integration: card payments via Stripe Checkout; bank transfer and pay-at-restaurant remain as manual-confirmation flows. `BLOCKED ON: Q5 — whether Stripe was previously live` | SHOULD |
| FR-2.13 | The reservation system enforces capacity limits per time slot based on configurable venue settings (covers per hour, tables available). | SHOULD |
| FR-2.14 | Reservations are scoped to a `venueId` to support multi-venue operation. | MUST |

---

### FR-3 — Menu Management (Admin Portal)

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-3.1 | Administrators can create, read, update, and delete menu categories. Fields: name, sort order, active/inactive. | MUST |
| FR-3.2 | Administrators can create, read, update, and delete menu items centrally from the Admin Dashboard only. Fields: title, description, price (cents as integer), category, sub-category, isAvailable, is_spicy, sort_order. All updates (name, price, availability, image, modifiers) sync instantly to the customer website and all kiosks. | MUST |
| FR-3.3 | Each menu item includes a structured `nutritionalDetails` object with sub-fields: calories (kcal), protein (g), carbohydrates (g), fat (g), and allergens (array of enum values: gluten, dairy, eggs, fish, shellfish, tree-nuts, peanuts, sesame, soy, sulphites). | MUST |
| FR-3.4 | Menu item images: upload, replace, and remove via the Admin Dashboard. Images are stored in the persistent local media volume; PostgreSQL stores the resulting `imageUrl`. | MUST |
| FR-3.5 | On image upload, the platform resizes and converts to `.webp` format before storing. Original file is not retained. | SHOULD |
| FR-3.6 | All menu management endpoints (`POST/GET/PUT/DELETE /api/admin/menu/items`, `/api/admin/menu/categories`) require admin authentication and enforce RBAC. | MUST |
| FR-3.7 | Menu items carry a `venueId` or are shared across venues via an `organizationId` flag, to support multi-venue operation with venue-specific overrides (price, availability). | MUST |
| FR-3.8 | Modifiers/add-ons (e.g. "choice of side", "protein choice") are supported as a `modifierGroups` array on a menu item, each with `name`, `required` (bool), `min_selections`, `max_selections`, and `options[]` (name, price_delta_cents). | SHOULD |
| FR-3.9 | **Availability Toggle:** Every menu item has an availability toggle (`isAvailable` boolean). Setting it to `ON` makes it visible on all customer-facing surfaces. Setting it to `OFF` hides it from the public website, Entrance Kiosk, and Ordering Kiosk immediately. No rebuild or cache flush is permitted. | MUST |
| FR-3.10 | Historical orders referencing the item must remain intact when availability is toggled `OFF` or if an item is soft-deleted. | MUST |
| FR-3.11 | Bulk import of existing menu data from `menuItems.json` / `categories.json` via a one-time migration script. Prices converted from float (dollars) to integer (cents) during import. | MUST |


### FR-4 — Ordering Kiosk (Self-Service Ordering)

`BLOCKED ON: Q1 — IdealPOS integration details`
`BLOCKED ON: Q2 — Printer hardware interface`

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-4.1 | The kiosk is a browser-based touchscreen application, fullscreen, running on a dedicated device inside the restaurant. | MUST |
| FR-4.2 | Customers browse the full menu, organised by category and sub-category, with photos and descriptions. | MUST |
| FR-4.3 | Customers add items to a cart, adjust quantities, and remove items before checkout. | MUST |
| FR-4.4 | Customers select a table number before submitting the order. Table numbers are configurable per venue. | MUST |
| FR-4.5 | Submission atomically saves the order, immutable line/price/tax snapshot, idempotency result and outbox commands for Idealpos, KDS and each routed KOT station. | MUST |
| FR-4.6 | The venue connector must durably accept the Idealpos command before the normal kitchen-release boundary. KDS and station-specific KOT delivery then proceed independently from the same order version. `BLOCKED ON: Q1/Q2` | MUST |
| FR-4.7 | Verdura routes each line to its configured preparation station and creates one replay-safe KOT job per destination. It must not create a duplicate Idealpos kitchen ticket. `BLOCKED ON: Q2` | MUST |
| FR-4.8 | The connector submits the order to Idealpos with its table, source, line/modifier and tender context; Verdura stores the returned Idealpos transaction reference. Existing Idealpos-integrated EFTPOS is the default in-person payment path. `BLOCKED ON: Q1` | MUST |
| FR-4.9 | **Restricted Offline Behavior:** The client may preserve a non-payment order draft, but normal submission and kitchen release require durable connector acceptance. If that boundary is unavailable, block and explain the order unless an authorized emergency mode is active. Never store raw card data or defer capture of reusable card credentials. | MUST |
| FR-4.10 | If the printer is unreachable, the order is still submitted and the print job is queued for retry. | MUST |
| FR-4.11 | The kiosk displays a clear confirmation screen (order reference, estimated wait) after successful submission. | MUST |
| FR-4.12 | The kiosk returns to the home/menu screen automatically after a configurable idle timeout (default: 3 minutes). | MUST |
| FR-4.13 | The kiosk UI is optimised for a touchscreen: minimum 48px touch targets, no hover-dependent interactions. | MUST |
| FR-4.14 | The kiosk supports accessibility requirements: sufficient contrast, readable fonts at kiosk viewing distance. | MUST |
| FR-4.15 | Allergen information (from `nutritionalDetails`) is displayed per item during browsing. | MUST |
| FR-4.16 | **Dual payment model:** For standard in-person payment, submit to Idealpos and route production before staff completes payment through Idealpos and existing EFTPOS/cash tender. For optional online payment, Verdura records a pending order, verifies provider amount/currency/status server-side, then releases Idealpos/KDS/KOT and maps the POS transaction to `PREPAID / ONLINE`. Preserve both external references and an auditable payment lifecycle. | MUST |
| FR-4.17 | A staff PIN or admin code can unlock a kiosk management overlay (reboot, back to menu, clear queue) without exposing the admin dashboard. | SHOULD |

---

### FR-5 — Entrance Kiosk (Menu Display)

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-5.1 | A read-only, browser-based display running on a dedicated screen outside the restaurant entrance. | MUST |
| FR-5.2 | Displays the full menu (item images, descriptions, pricing, dietary info, and availability) pulled from the central menu API. | MUST |
| FR-5.3 | Auto-refreshes menu content on a configurable interval (default: 60 seconds) without requiring manual intervention. | MUST |
| FR-5.4 | Does not accept any user input for ordering or checkout. No cart, no order submission, and no payment functionality. Customers can only browse categories and menu items. | MUST |
| FR-5.5 | Displays a "Today's Specials" or promotional banner configurable from the Admin Dashboard. | SHOULD |
| FR-5.6 | Operates in offline mode: if the backend is unreachable, displays the last successfully fetched menu data. | MUST |
| FR-5.7 | Kiosk mode: hides browser chrome, disables right-click and keyboard shortcuts. | SHOULD |


---

### FR-6 — Kitchen Display System (KDS)

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-6.1 | A browser-based display mounted in the kitchen, showing live incoming orders. | MUST |
| FR-6.2 | Orders appear on the KDS in real time (< 3 seconds from submission) via WebSocket push. | MUST |
| FR-6.3 | Each order card shows: order ID, table number, timestamp, item list with quantities and modifiers, and special notes. | MUST |
| FR-6.4 | Kitchen staff can move an order through status stages by tapping: `pending` → `preparing` → `ready`. | MUST |
| FR-6.5 | When an order is marked `ready`, a visual and audible alert fires. | SHOULD |
| FR-6.6 | Orders are colour-coded by age: new (green), aging (amber at configurable threshold, default 10 min), overdue (red). | SHOULD |
| FR-6.7 | The KDS can be filtered by category (e.g. grill, pizza, kitchen) if printers are categorised — maps to FR-8. | SHOULD |
| FR-6.8 | No authentication required to view the KDS (it is a trusted, staff-only LAN device), but a PIN is required to access any configuration. | MUST |
| FR-6.9 | Operates in offline mode: if the backend is unreachable, continues to display previously received orders. Reconnects automatically. | MUST |

---

### FR-7 — Admin Dashboard

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-7.1 | Deployed at a separate subdomain (`admin.verdura.co.nz` or equivalent) — never co-hosted with the public site. | MUST |
| FR-7.2 | All routes require authenticated session with valid admin-role JWT. Unauthenticated requests are rejected at the server before any dashboard code loads. | MUST |
| FR-7.3 | Login via email + password. MFA (TOTP) optional, recommended for owner/admin roles. | MUST |
| FR-7.4 | Role-based access: Owner sees everything; Manager cannot access billing/SaaS settings; Kitchen Staff only sees KDS-adjacent views; Cashier sees orders view. | MUST |
| FR-7.5 | **Reservations view:** List, filter (date, status, party size), search (name, booking ref, email), approve/cancel/no-show. | MUST |
| FR-7.6 | **Orders view:** Live order list with status, table, items, timestamps. Ability to manually update order status. | MUST |
| FR-7.7 | **Menu Management:** Full CRUD on categories and menu items (see FR-3). | MUST |
| FR-7.8 | **Table Management:** Configure table numbers, table names, seating capacity per venue. | MUST |
| FR-7.9 | **Floor Plan:** Visual floor map editor (optional for MVP — see FR-8 scope). | WONT (MVP) |
| FR-7.10 | **Printer Management:** Add, remove, test, and monitor printers. View print job queue and retry failed jobs. | MUST |
| FR-7.11 | **Reporting:** Daily/weekly/monthly sales, reservation counts, cover counts, average order value, top-selling items. | SHOULD |
| FR-7.12 | **Staff Management:** Add/remove staff accounts, assign roles, reset passwords. | MUST |
| FR-7.13 | **Venue Settings:** Venue name, address, timezone, operating hours, capacity, IdealPOS config. | MUST |
| FR-7.14 | **Daily Email Settings:** Configure recipient, schedule, and manual send — replicating and replacing the current `/admin/daily-email` functionality. | MUST |
| FR-7.15 | **Audit Log:** Searchable log of all admin actions (who changed what, when). Retention: 90 days minimum. | MUST |
| FR-7.16 | **Multi-venue switcher:** Users with access to multiple venues can switch context from a top-level selector. | MUST |

---

### FR-8 — Printer Management

`BLOCKED ON: Q2 — Printer hardware and protocol unknown`

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-8.1 | The system supports multiple named printers per venue: Kitchen, POS, Bar, Dessert (and any additional). | MUST |
| FR-8.2 | Each printer is configured with: name, type (`kitchen`\|`pos`\|`bar`\|`dessert`\|`custom`), connection type (`tcp`\|`usb`\|`network`), host/IP, port, paper width. | MUST |
| FR-8.3 | Print jobs are queued in the backend. A Printer Service (running on-premise or in the cloud, depending on Q2) polls or receives push and dispatches to the physical printer. `BLOCKED ON: Q2` | MUST |
| FR-8.4 | Failed print jobs are retried up to a configurable maximum (default: 3 attempts) with exponential backoff. | MUST |
| FR-8.5 | After max retries, the print job enters `failed` status and an alert appears in the Admin Dashboard. | MUST |
| FR-8.6 | Administrators can manually reprint any job from the dashboard. | MUST |
| FR-8.7 | Each print job is logged with: job ID, order ID, printer name, attempt count, status, timestamps, error message if failed. | MUST |
| FR-8.8 | A test print can be triggered per printer from the Admin Dashboard. | MUST |
| FR-8.9 | ESC/POS is the default print protocol. Other protocols (PCL, raw text) configurable per printer. `BLOCKED ON: Q2` | MUST |
| FR-8.10 | Print job content for order receipts includes: order ID, table number, item list with quantities, modifiers, special instructions, timestamp, venue name. | MUST |

---

### FR-9 — IdealPOS Integration

`BLOCKED ON: Q1 — Integration mechanism entirely unknown`

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-9.1 | Orders submitted via the Self-Ordering Kiosk are synced to IdealPOS, including the selected table number. `BLOCKED ON: Q1` | MUST |
| FR-9.2 | The integration is implemented via a pluggable adapter pattern — the active adapter is configurable per venue without code changes. `BLOCKED ON: Q1` | MUST |
| FR-9.3 | Sync status is tracked per order: `not_synced` \| `synced` \| `failed`. Failed syncs are visible in the Admin Dashboard and retryable manually. | MUST |
| FR-9.4 | If the connector cannot durably accept the order, normal kitchen release is blocked unless an authorized emergency mode is active. If Idealpos fails after connector acceptance, the local command remains durable, its uncertain/failed state is visible and reconciliation precedes any retry that could duplicate the sale. | MUST |
| FR-9.5 | The adapter interface is defined in Phase 5 (Integration Strategy). The specific implementation depends on Q1. | — |

---

### FR-10 — Reporting

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-10.1 | Daily sales report: total revenue, order count, average order value, top 10 items by quantity. | SHOULD |
| FR-10.2 | Reservation report: covers by date, no-show rate, lead time distribution. | SHOULD |
| FR-10.3 | Weekly and monthly summaries of the above. | SHOULD |
| FR-10.4 | Reports are available in the Admin Dashboard and exportable as CSV. | SHOULD |
| FR-10.5 | Reports are scoped by venue for multi-venue operators. | MUST |

---

## Non-Functional Requirements

### NFR-1 — Performance

| ID | Requirement |
|----|-------------|
| NFR-1.1 | API response time P95 < 200ms for read endpoints under normal load. |
| NFR-1.2 | Order submission (POST /api/orders) P95 < 500ms end-to-end (excluding printer latency). |
| NFR-1.3 | Print job dispatched and received at printer < 3 seconds from order submission. `BLOCKED ON: Q2` |
| NFR-1.4 | KDS order appearance < 3 seconds from order submission (WebSocket push). |
| NFR-1.5 | Admin Dashboard initial load < 2 seconds on a 10 Mbps connection. |
| NFR-1.6 | Kiosk menu browse < 1 second per page navigation. |

### NFR-2 — Security

| ID | Requirement |
|----|-------------|
| NFR-2.1 | Admin Dashboard accessible only at a separate domain/subdomain from the public site. |
| NFR-2.2 | All admin routes require a valid, server-issued JWT with admin-role claim. Client-side routing alone is never the security boundary. |
| NFR-2.3 | No security-through-obscurity: an unguessable admin URL is not a substitute for authentication. |
| NFR-2.4 | Passwords hashed using bcrypt (min cost factor 12) or Argon2id. Never stored in plaintext. |
| NFR-2.5 | All API traffic over HTTPS/TLS 1.2+. |
| NFR-2.6 | RBAC enforced at the API layer — roles are checked server-side per endpoint, not just in the UI. |
| NFR-2.7 | Input validation and sanitisation on all API endpoints (NestJS class-validator + class-transformer). |
| NFR-2.8 | SQL injection: prevented by Prisma's parameterised queries. No raw string interpolation in queries. |
| NFR-2.9 | XSS: React's built-in escaping for all user-supplied content rendered in the UI. No `dangerouslySetInnerHTML` with unvalidated input. |
| NFR-2.10 | Rate limiting on auth endpoints: max 10 login attempts per IP per 15 minutes. |
| NFR-2.11 | IP allowlisting optional hardening for admin subdomain (configurable, not a primary control). |
| NFR-2.12 | Secrets (DB credentials, API keys, Stripe keys) stored in environment variables / secrets manager — never committed to the repository. |
| NFR-2.13 | Media upload: file type validated server-side (magic bytes, not just extension). Maximum upload size enforced (default: 10 MB). |

### NFR-3 — Scalability

| ID | Requirement |
|----|-------------|
| NFR-3.1 | Architecture supports horizontal scaling of the API tier (stateless NestJS services behind a load balancer). |
| NFR-3.2 | Multi-venue data isolation enforced at the query layer via `venueId` scoping on all tenant-specific entities. |
| NFR-3.3 | Database connection pooling via Prisma (default pool size: 10, configurable). |
| NFR-3.4 | Redis used for: session/JWT caching, print job queue (Bull/BullMQ), WebSocket pub/sub (for KDS real-time), and rate limiting counters. |

### NFR-4 — Offline Capability

| ID | Requirement |
|----|-------------|
| NFR-4.1 | Self-Ordering Kiosk: Offline queueing is restricted. If order submission fails *after* successful payment, order details can be queued in IndexedDB and retried. If payment infrastructure is down, card checkout is disabled and customer falls back to pay-at-counter; no local card details or tokens are stored or queued. |
| NFR-4.2 | Menu Display Kiosk: serves last-fetched menu from a local cache (Service Worker + Cache API) during outages. |
| NFR-4.3 | KDS: displays previously received orders during backend outage; new orders are accepted when connection restores. |
| NFR-4.4 | Printer Service: queues print jobs locally when printer is offline; processes queue on reconnection. |
| NFR-4.5 | Admin Dashboard: read-only cached views of critical data (today's reservations, active orders) available during brief outages. Full editing requires connectivity. |

### NFR-5 — Accessibility

| ID | Requirement |
|----|-------------|
| NFR-5.1 | Admin Dashboard meets WCAG 2.1 AA. |
| NFR-5.2 | Self-Ordering Kiosk: minimum 48×48px touch targets, 4.5:1 contrast ratio, readable at 600mm viewing distance. |
| NFR-5.3 | Screen-reader support for Admin Dashboard (ARIA labels, semantic HTML). |

### NFR-6 — Reliability

| ID | Requirement |
|----|-------------|
| NFR-6.1 | API service target uptime: 99.5% monthly (excluding planned maintenance windows). |
| NFR-6.2 | Database backups: automated daily backups with 30-day retention. |
| NFR-6.3 | Print job retry mechanism with dead-letter queue and admin alerting (see FR-8.4–8.5). |
| NFR-6.4 | IdealPOS sync retry with dead-letter queue and admin alerting (see FR-9.3–9.4). |
| NFR-6.5 | Health check endpoint (`GET /health`) returning service status, DB connectivity, Redis connectivity, and printer service status. |

### NFR-7 — Audit Logging

| ID | Requirement |
|----|-------------|
| NFR-7.1 | All admin actions are logged: actor (userId + email), action (entity + verb), before/after state, timestamp. |
| NFR-7.2 | Audit log is append-only — no update or delete operations permitted. |
| NFR-7.3 | Audit log is searchable by actor, entity type, date range, and action type from the Admin Dashboard. |
| NFR-7.4 | Minimum retention: 90 days. |
| NFR-7.5 | Audit log is stored in PostgreSQL (flexible schema stored in JSONB columns for before/after state snapshots). |

### NFR-8 — Frontend Freeze Compliance (Modified)

| ID | Requirement |
|----|-------------|
| NFR-8.1 | Customer-facing layouts remain visually stable while operational data is routed through the NestJS API. |
| NFR-8.2 | Build configuration changes must remain minimal and support the shared macOS/Windows workflow. |
| NFR-8.3 | The customer website fetches menu items and creates reservations through the NestJS API. |
| NFR-8.4 | Any new backend API endpoint that the customer site could call is designed to be backwards-compatible with the existing mock's response shapes. |
| NFR-8.5 | All new development work lives in new repositories or new subdirectories not under the frozen `src/` directory. |

### NFR-9 — Public/Admin Hosting Separation

| ID | Requirement |
|----|-------------|
| NFR-9.1 | The Admin Dashboard is deployed to a fully separate origin from `verdura.co.nz` (preferred: `admin.verdura.co.nz`). |
| NFR-9.2 | No admin route, admin component, or admin API key is served by the same origin as the public site. |
| NFR-9.3 | Unauthenticated requests to the admin domain are redirected to the login page by the server — no dashboard bundle is served to unauthenticated users. |
| NFR-9.4 | RBAC is enforced server-side: the API rejects requests from tokens that lack the required role, regardless of which frontend made the request. |
| NFR-9.5 | `BLOCKED ON: Q6 — production hosting environment unknown` — the specific subdomain/DNS setup requires confirmation of the hosting provider and DNS control. |

### NFR-10 — Airtable Migration & Data Source Consolidation

| ID | Requirement |
|----|-------------|
| NFR-10.1 | All Airtable data sources, synchronization logic, and simulation timers must be completely removed from all applications (including `verdura_v1.2` frontend and Deno edge functions). |
| NFR-10.2 | All menu data, categories, configurations, and operational records must live in local PostgreSQL; uploaded files use the persistent local media volume. |
| NFR-10.3 | No third-party database adapters or duplicate maintenance processes (Airtable sync, manual exports) are allowed in the production platform. |
