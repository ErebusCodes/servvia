# Verdura — Epic Breakdown

> **Normative delivery decision — 2026-08-15:** Epics must be delivered in accordance with the [Target Operating Model](./target-operating-model.md). The critical vertical slice is one Verdura-originated order durably accepted by the connector, created in Idealpos, routed once to KDS and the correct KOT stations, paid through existing Idealpos/EFTPOS or an optional verified online provider, and reconciled using both external references.

> **Delivery re-baseline — 2026-08-15:** The sequence below predates the provider-neutral v5.2 strategy and overstates completion where UI, database scaffolding or a NullAdapter exists without real integration evidence. The active delivery order is now: **P0 payment/idempotency/tenancy truthfulness → P1 real edge/POS handoff and availability acknowledgement → reconciliation/observability/audit → enterprise controls**. Inventory and other later-phase work must not displace Phase 1A proof. See [mvp.md](./mvp.md), Sections 9–10.

**Completion rule:** an epic is complete only when its real cross-service journey passes automated integration, concurrency, outage and replay tests in a representative environment. Mock screens and fabricated provider responses count as prototypes, not completion.

**Phase 9 Output**
**Date:** 2026-06-18

---

## E1 — Foundation

**Goal:** Establish all repositories, infrastructure, CI/CD, and shared tooling before any product work begins.

**Stories:**
- E1-S1: Scaffold `verdura-api` (NestJS, TypeScript, Docker Compose with PostgreSQL + Redis)
- E1-S2: Prisma schema for all PostgreSQL entities; initial migration
- E1-S3: Prisma schema fields for MenuItem, PrinterJob, AuditLog (JSONB)
- E1-S4: BullMQ setup with named queues; health check endpoint
- E1-S5: GitHub Actions CI pipeline (lint, typecheck, test on PR)
- E1-S6: Scaffold `verdura-admin` (React 18, TypeScript, Vite, Tailwind, TanStack Query, Zustand)
- E1-S7: Scaffold `verdura-kiosk` (React 18, TypeScript, Vite, Tailwind, Zustand)
- E1-S8: Scaffold `verdura-printer-service` (Node.js, TypeScript, BullMQ worker)
- E1-S9: Scaffold `verdura-pos-agent` (Node.js, TypeScript, BullMQ worker, NullAdapter — NullAdapter reports `not_applicable`/`unsupported`, never `synced`; see DL-064)
- E1-S10: Docker Compose for local development (all services)
- E1-S11: Data migration script — seed PostgreSQL from `menuItems.json` and `categories.json` (float→cents conversion)

**Acceptance Criteria:**
- All repos scaffold and run locally with `docker-compose up`
- `GET /health` returns 200 with DB and Redis status
- CI passes on a trivial PR to each repo
- Migration script runs without error; MenuItem count in PostgreSQL matches JSON source

**Dependencies:** None — this is the entry point.
**Definition of Done:** All services running locally; CI green; migration script validated.

---

## E2 — Authentication

**Goal:** Secure, RBAC-enforced authentication for the Admin Dashboard and internal service-to-service calls.

**Stories:**
- E2-S1: Staff entity, password hashing (Argon2id), seed owner account
- E2-S2: JWT issuance (15-min access token) + HttpOnly refresh cookie (7-day)
- E2-S3: `POST /api/auth/login`, `POST /api/auth/refresh`, `POST /api/auth/logout`
- E2-S4: NestJS `@Roles()` guard — enforces ROLE_PERMISSIONS matrix per endpoint
- E2-S5: Rate limiting on auth endpoints (10 attempts / 15 min / IP)
- E2-S6: Admin Dashboard login page (email + password form, error states)
- E2-S7: Edge Function / CDN middleware — unauthenticated requests to `admin.verdura.co.nz` → redirect to `/login`
- E2-S8: Audit log on login, login_failed, logout, password_changed events
- E2-S9: Internal service auth (Printer Service + POS Agent authenticate to API via service token) — **superseded by story `2-9` (Enterprise Venue Connector Identity), done 2026-08-16**; the shared `INTERNAL_SERVICE_TOKEN` guard this story originally described remains in place, unmigrated, as transitional scaffolding — see story 2-9's own file.
- E2-S10: Connector command & acceptance protocol — story `2-10`, **done 2026-08-16**. Durable command envelope, claim/accept/truthful-report state machine, and a real durable-connector proof harness (persist-before-ack, proven via real process kills) for the authenticated connector identity story 2-9 established. Transport decision: `docs/decisions-log.md` DL-070 (authenticated HTTPS polling, not a persistent session). Implements no real command type — only a synthetic `connector.self_test.v1` self-test — and implements no Idealpos/EFTPOS/printer contact of any kind. Unblocks story 9-2's and Epic 15's E15-S5/S6/S7's connector-command-protocol dependency only; their other blocking dependencies (live Windows discovery, DL-064, DL-067) are unaffected.

**Acceptance Criteria:**
- Unauthenticated GET to any `/api/admin/*` endpoint returns 401
- Admin Dashboard bundle is not served to unauthenticated requests (verified by curl)
- Role `kitchen` cannot call `DELETE /api/admin/menu/items/:id` — returns 403
- Login fails after 11th attempt within 15 minutes — returns 429

**Dependencies:** E1
**Definition of Done:** Auth flow end-to-end; RBAC tested for all roles; audit log populated.

---

## E3 — Venues & Tables

**Goal:** Venue configuration and table management — foundation for everything venue-scoped.

**Stories:**
- E3-S1: Venue CRUD API; seed Verdura Auckland venue
- E3-S2: Table CRUD API; seed tables from venue config
- E3-S3: Admin Dashboard — Venue Settings page (name, address, timezone, operating hours, capacity)
- E3-S4: Admin Dashboard — Table Management page (add/remove/activate tables, set capacity)
- E3-S5: Kiosk table selection view (grid of active tables by tableNumber)

**Acceptance Criteria:**
- `GET /api/kiosk/tables` returns only `isActive: true` tables for the venue
- Table deactivated in admin does not appear in kiosk table picker within 60 seconds
- Venue timezone setting is used for all date/time display throughout admin and kiosk

**Dependencies:** E1, E2
**Definition of Done:** Tables manageable from admin; kiosk shows correct table list.

---

## E4 — Menu Management

**Goal:** Full CRUD for menu categories and items from the Admin Dashboard, with image upload.

**Stories:**
- E4-S1: Category CRUD API (`/api/admin/menu/categories`)
- E4-S2: MenuItem CRUD API (`/api/admin/menu/items`) — behind RBAC (manager+)
- E4-S3: Admin Dashboard — Category list + create/edit/delete/reorder
- E4-S4: Admin Dashboard — MenuItem list per category with create/edit/delete
- E4-S5: MenuItem form: all fields including `nutritionalDetails` (structured, not free-text) and `modifierGroups`
- E4-S6: Media Module — `POST /api/admin/media/upload` (sharp resize → webp → S3)
- E4-S7: Image upload UI in MenuItem form (upload, replace, remove)
- E4-S8: Soft delete for MenuItems (deletedAt); inactive flag for Categories
- E4-S9: Kiosk menu API — `GET /api/kiosk/menu` returns active items grouped by category (unauthenticated, rate-limited)
- E4-S10: MenuItemVenueOverride API (price/availability per venue)
- E4-S11: Public Website Menu Integration — update customer-facing Menu page to dynamically fetch categories/items from Supabase API

**Acceptance Criteria:**
- Create a new MenuItem in admin → appears on customer website and kiosk menus instantly with no rebuild or cache flush
- Deactivate an item or toggle availability OFF → disappears from customer website, Entrance Kiosk, and Ordering Kiosk immediately
- Upload a 5MB JPEG → stored as webp at max 1200px; DB stores CDN URL not binary
- `nutritionalDetails.allergens` must be an array of valid Allergen enum values — invalid values rejected with 422
- Price stored as integer cents — submitting `18.50` → stored as `1850`

**Dependencies:** E1, E2, E3 (for venueId scoping)
**Definition of Done:** Full menu CRUD live; images uploading to S3; customer website and kiosks retrieve menu data from DB.


---

## E5 — Reservations

**Goal:** Replace the localStorage reservation system with a real persistent backend.

**Stories:**
- E5-S1: Reservation CRUD API; booking ref generation (VR-NNNN, collision-checked)
- E5-S2: Reservation status FSM API (confirm, cancel, seat, complete, no-show)
- E5-S3: Capacity enforcement (configurable covers-per-slot check on create)
- E5-S4: Email on confirmation and cancellation (Resend integration)
- E5-S5: Admin Dashboard — Reservations list (filter by date, status; search by name/ref/email)
- E5-S6: Admin Dashboard — Reservation detail + manual status update
- E5-S7: Admin Dashboard — Daily email settings page (replaces /admin/daily-email)
- E5-S8: Daily summary email (BullMQ scheduled job, midnight NZT)
- E5-S9: Remove `/admin/daily-email` from public site `App.jsx`, and permit required frontend modifications for dynamic menu integration (E4-S11) and Airtable decommission/migration (E14).
- E5-S10: Payment entity; manual confirm for bank transfer / pay-at-restaurant flows

**Acceptance Criteria:**
- Reservation created via public booking flow persists in PostgreSQL — visible in admin dashboard
- Confirm a reservation → customer confirmation email received within 30 seconds
- Two simultaneous bookings for the same slot at capacity → second booking rejected with 409
- `/admin/daily-email` route on public site returns 404 (or redirects to home)
- Public website is updated to dynamically query live menu categories, items, and availability state from the central Supabase API, replacing static JSON files and mock datasets
- All Airtable simulation timers, mock client sync hooks, and dependencies are completely decommissioned from the frontend codebase
- Admin daily email settings page accessible and functional at `admin.verdura.co.nz/settings/email`

**Dependencies:** E1, E2, E3
**Definition of Done:** Reservations in DB; emails live; admin page replaced; public route removed.

---

## E6 — Ordering (Ordering Kiosk → API → DB)

**Goal:** Verdura tablets/kiosks create an immutable operational order, obtain durable Idealpos connector acceptance, and fan out exactly once to KDS/KOT; payment follows either the existing Idealpos/EFTPOS path or optional verified online prepayment.

> **Tracer bullet (2026-08-15):** E6-S1 is split into a first, high-risk slice — story `6-1-order-idempotency-and-payment-linkage` — that adds the database-enforced `idempotencyKey` and a uniquely-constrained payment-provider reference on `Order` before any other E6 story proceeds. Today a single successfully-charged Stripe PaymentIntent can be replayed into unlimited orders because no such constraint exists; this is a live financial-integrity gap, not a future hardening item. See `_bmad-output/implementation-artifacts/6-1-order-idempotency-and-payment-linkage.md`.

**Stories:**
- E6-S1: Idempotent Order + OrderItem submission API that atomically persists the order/version, commercial snapshot and transactional outbox commands. First slice: story 6-1 (idempotency key + unique payment reference) — must land before E6-S4 (checkout flow) is built against real payment.
- E6-S2: Order status FSM API (pending → confirmed → preparing → ready → completed / cancelled)
- E6-S3: WebSocket gateway — push order events to `venue:{venueId}:orders` room on status change
- E6-S4: Dual checkout flow — in-person: Cart → Table → Submit to Idealpos/KDS/KOT → pay through Idealpos/EFTPOS; online: Cart → Table → provider payment → verified success → submit as `PREPAID / ONLINE` and release production.
- E6-S5: Kiosk confirmation screen (order ref, estimated wait, return-to-menu button)
- E6-S6: Kiosk IndexedDB offline queue (restricted behavior: payment-succeeded queueing only; pay-at-counter fallback when payment infrastructure offline; card token/raw data storage strictly prohibited).
- E6-S7: Kiosk idle timeout (3-minute countdown → return to menu)
- E6-S8: Allergen display per menu item on kiosk (from nutritionalDetails)
- E6-S9: Provider-neutral online payment adapter, initially Stripe unless approved Verifone/Oolio ecommerce capabilities are proven; retain provider transaction, webhooks, refunds and reconciliation metadata.
- E6-S10 *(backlog, not yet story-filed)*: Venue-bind kiosk order-submission credentials the same way KDS device tokens already are (see `orders.gateway.ts`'s venue-scoped device-token pattern), replacing today's fully-open, client-supplied `venueId` on `POST kiosk/orders`. Tracked in `deferred-work.md`.

**Acceptance Criteria:**
- In-person submission creates the Verdura order, is durably accepted for Idealpos delivery and releases KDS/KOT without falsely marking payment complete.
- Online submission records a pending order but cannot release KDS/KOT until provider payment is verified by the server.
- The same idempotency key cannot create duplicate Verdura orders, Idealpos transactions or KOTs.
- WebSocket push received by open Admin Dashboard within 3 seconds of order submission
- Submit order while API unreachable *after* payment succeeds → order details queued in IndexedDB → syncs automatically on reconnect
- When payment infrastructure is unavailable, card checkout is disabled, offline warning is displayed, and flow falls back to pay-at-counter; no raw payment data or card tokens stored locally
- Idle for 3 minutes → kiosk returns to menu screen
- Order price is locked at submission time; subsequent menu price change does not affect the order record

**Dependencies:** E1, E2, E3, E4 (menu data), E3 (tables)
**Definition of Done:** Both payment journeys pass real Idealpos, EFTPOS/payment-provider, KDS, station-printer, restart, replay and reconciliation tests with both external references retained.


---

## E7 — Kitchen Display System

**Goal:** Real-time order display for kitchen staff.

**Stories:**
- E7-S1: KDS page at `/kds` — WebSocket consumer for `venue:{venueId}:orders` room
- E7-S2: Order cards with all required fields (id, table, items, modifiers, notes, timestamp)
- E7-S3: Status transition buttons (tap to advance: pending → preparing → ready)
- E7-S4: Age-based colour coding (green / amber at 10min / red at 20min), configurable thresholds
- E7-S5: Audible alert (browser audio) on new order arrival
- E7-S6: Staff PIN entry on first load for venue-scoped token (no full login required)
- E7-S7: Offline mode — display existing orders during connectivity loss; reconnect automatically

**Acceptance Criteria:**
- New order submitted → appears on KDS within 3 seconds
- Tap "Preparing" on KDS → `Order.status` updates to `preparing` in DB; Admin Dashboard reflects change
- Order older than 10 minutes with status `preparing` shows amber card
- Audio alert fires on new order (requires browser interaction to enable audio per Web Audio API rules)
- KDS continues displaying existing orders during a 30-second connectivity blip; reconnects without page reload

**Dependencies:** E1, E2, E6
**Definition of Done:** KDS live on dedicated screen; real-time updates confirmed end-to-end.

---

## E8 — Printer Service

**Goal:** Physical printers receive order tickets within 3 seconds of order submission, and every `PrinterJob` state is truthful — no local acknowledgement (socket write, log line, or queued database row) is ever represented as a printed ticket.

> **Sequencing correction (2026-08-15):** the current backend creates `PrinterJob` rows but never enqueues them to BullMQ, and its registered worker attempts a direct cloud-to-LAN TCP connection and fabricates success for non-network connection types (docs/printers.md implementation-status banner). **Story 8-1 (truthful `PrinterJob` states) is the tracer bullet for this epic and must land before E8-S1–S9** — it removes the fabrication and establishes the honest state machine that every later story builds on. See `_bmad-output/implementation-artifacts/8-1-printer-truthful-states.md`.

**Stories:**
- E8-S1: `verdura-printer-service` — outbound-only connector session consuming scoped print commands per venue (not a direct Redis poll — see DL-054 and target-operating-model.md §8)
- E8-S2: ESC/POS TCP dispatch (`escpos` + `escpos-network`) — `BLOCKED ON: Q2`
- E8-S3: Print payload generation in Verdura API (`PrintTemplateService`) — kitchen and POS ticket formats
- E8-S4: PrinterJob creation on order submit (one per target printer) as part of the transactional outbox (see story 6-1); dispatched to the connector, never a direct cloud-to-LAN socket
- E8-S5: 3-attempt fixed-delay retry logic; `failed` status + API callback after exhaustion
- E8-S6: Local encrypted durable offline queue; drain on reconnect
- E8-S7: Printer health monitor (30-second poll); status reporting to API
- E8-S8: Admin Dashboard — Printer Management page (add/edit/delete printers, online status, test print, job queue, reprint)
- E8-S9: Category-to-printer routing config (admin UI + API) — versioned preparation-station routing per target-operating-model.md §5, not a static category map

**Acceptance Criteria:**
- Submit order on kiosk → kitchen ticket prints within 3 seconds (P95 on stable LAN)
- `PrinterJob.status` distinguishes `delivered` (connector accepted/wrote to device) from `printed` (device acknowledgement received); neither is set without the evidence it names
- Disconnect printer ethernet → health monitor detects offline within 30 seconds; Admin Dashboard shows red status
- Reconnect printer → health monitor detects online within 30 seconds; failed jobs appear in dashboard for manual reprint
- Test print from Admin Dashboard produces a correctly formatted test ticket
- `BLOCKED ON: Q2` — ESC/POS specifics validated against actual printer hardware

**Dependencies:** E1, E2, E6 (order creation), story 8-1 (truthful states, must land first)
**Definition of Done:** Tickets printing on real hardware with device-path acknowledgement; retry and offline queue validated; no fabricated `printed` state reachable in code.

---

## E9 — IdealPOS Integration

**Goal:** Orders sync to IdealPOS with correct table number, and `POSSyncRecord.status` is always truthful. `BLOCKED ON: Q1` (see DL-064) for every story except the truthfulness fix.

> **Sequencing correction (2026-08-15):** the current POS-sync processor fabricates an `IDEAL-*` transaction ID and marks orders `synced` without ever contacting Idealpos, and is not even reachable from order creation (docs/integrations/idealpos.md implementation-status banner). **Story 9-1 (truthful `POSSyncRecord` states) is the tracer bullet for this epic and must land before E9-S1–S10** — it removes the fabrication and wires the honest `not_applicable`/`unsupported`/`failed` state machine. Real adapter work (E9-S3–S7) remains `BLOCKED` on DL-064 regardless. See `_bmad-output/implementation-artifacts/9-1-pos-sync-truthful-states.md`.

> **Local evidence and API-less adapter proposal (2026-08-16):** a safe, read-only inspection of a copied Idealpos Windows installation confirmed Windows/.NET Framework 4.6.1/32-bit components and ecommerce/online/transaction capability evidence (`docs/integrations/idealpos.md` §12) — this is capability evidence only, not a licensed/vendor-supported contract, and does not unblock DL-064. It also produced a fully specified, proposed (unproven) API-less interim adapter — a Windows Connector service plus a separate interactive Idealpos POS Bridge UI-automation process (`docs/integrations/idealpos.md` §13–§18) — as the concrete realization of **E9-S7 (LocalAgentAdapter)** for Idealpos specifically. A second, dedicated tracer bullet story, **`9-2-idealpos-uibridge-tracer`**, gates this specific adapter path and must pass before any of E9-S3–S7 proceeds against it; it is independent of, and does not supersede, story 9-1. Story 9-2 is currently `blocked` on live Windows discovery (`docs/discovery/idealpos-live-discovery-checklist.md`) and story 2-9. See DL-066/DL-068.

> **Outbox dispatch correction (2026-08-16):** the repository audit found the `pos-sync` queue dormant (rows created, never enqueued) and recommended "wiring the enqueue call." Direct inspection of `pos-sync.processor.ts` and `print-jobs.processor.ts` found these two dormant queues are **not** symmetric in risk: `PosSyncProcessor` makes no network call at all (a pure DB-state classifier), while `PrintJobsProcessor` opens a direct cloud-to-LAN TCP socket for `tcp`/`network` printers — the exact anti-pattern DL-054/target-operating-model.md §8 prohibit. **Story `9-3` implements only the `pos-sync` dispatch half** (safe, no connector dependency) — this is E9-S1's "dispatched to..." clause, realized for the destination that requires no connector. The print-jobs half is *not* addressed by 9-3 and remains blocked pending a connector (story 2-9 plus a printer-side component) or a separate written decision restricting it to network-free connection types. See DL-069.

**Stories:**
- E9-S1: POSSyncRecord creation on order submit as part of the transactional outbox (story 6-1); dispatched to the connector, never a bare Redis enqueue reachable by the venue agent. **Write half done (story 6-1/9-1); dispatch half done by story 9-3 for the cloud-internal pos-sync destination only — see banner above.**
- E9-S2: `verdura-pos-agent` NullAdapter active for local development only — reports `not_applicable`, never `synced` (DL-046 superseded, DL-064)
- E9-S3: ApiAdapter implementation (stubbed with `VERIFY AGAINST VENDOR DOCS` placeholders) — `BLOCKED ON: Q1`
- E9-S4: CsvAdapter implementation — `BLOCKED ON: Q1`
- E9-S5: SqlAdapter implementation (only if Q1 requires it; requires written vendor approval and recovery/upgrade testing per target-operating-model.md §8) — `BLOCKED ON: Q1`
- E9-S6: OdbcAdapter implementation (only if Q1 requires it — Windows only) — `BLOCKED ON: Q1`
- E9-S7: LocalAgentAdapter implementation — now specified as the Verdura Connector + Idealpos POS Bridge (`docs/integrations/idealpos.md` §14) — `BLOCKED ON: Q1` and additionally on story `9-2`'s tracer evidence (§19–§21)
- E9-S8: 5-attempt exponential backoff retry; `failed` status + API callback
- E9-S9: Admin Dashboard — POS sync status widget (unsynced count, failed list, retry button)
- E9-S10: Automatic retry scheduler (BullMQ repeatable job, every 5 minutes) for failed syncs

**Acceptance Criteria:**
- Submit order with `posAdapterType: none` → `POSSyncRecord.status` → `not_applicable`, never `synced`
- No code path may set `status: synced` without a real adapter's confirmed, externally-verifiable Idealpos response
- Simulate POS outage (real adapter) → sync retried 5× → `failed` status → visible in Admin Dashboard
- Dashboard "Retry" button re-enqueues the sync job → status transitions to `synced` only on real confirmation
- `BLOCKED ON: Q1` (DL-064) — real adapter acceptance criteria defined once mechanism confirmed

**Dependencies:** E1, E2, E6, story 9-1 (truthful states, must land first)
**Definition of Done:** Agent infrastructure complete and truthful in all adapter states; real adapter confirmed and tested against IdealPOS before any production `synced` status is possible.

---

## E10 — Admin Dashboard (Core)

**Goal:** Operational admin views — orders, reservations, staff management.

**Stories:**
- E10-S1: Dashboard home — today's summary (orders count, reservations count, revenue)
- E10-S2: Live orders view with WebSocket updates and manual status control
- E10-S3: Reservations list + detail (covered by E5)
- E10-S4: Staff management — create, edit, deactivate staff accounts; assign roles
- E10-S5: Audit log view — searchable by actor, entity, date range
- E10-S6: Multi-venue switcher (UI component — single venue active for MVP, wiring ready)
- E10-S7: Settings — venue configuration, operating hours, capacity
- E10-S8: Daily Email Settings — extract `/admin/daily-email` route from `verdura_v1.2/src/App.jsx` (FR-1.3); re-implement as Admin Dashboard settings page. Configure recipient address, email schedule, preview. Remove extracted route from public frontend.

**Acceptance Criteria:**
- Dashboard home loads within 2 seconds on 10 Mbps connection
- Create a staff account with role `kitchen` → can log in → cannot access menu management
- Audit log shows all admin actions from the session with actor email and timestamp
- Deactivated staff account cannot log in (401 on next login attempt)
- `/admin/daily-email` route no longer exists in the public site (`App.jsx` has no admin routes after E10-S8)
- Daily email settings page accessible only to Owner/Admin roles

**Dependencies:** E2, E3, E5, E6
**Definition of Done:** All core admin views live; RBAC validated for all roles; daily email settings migrated from public site.

---

## E11 — Reporting

**Goal:** Basic sales and reservation reporting for managers.

**Stories:**
- E11-S1: Sales report API — daily/weekly/monthly revenue, order count, average order value
- E11-S2: Top items report — top 10 items by quantity for a date range
- E11-S3: Reservation report — covers by date, no-show rate
- E11-S4: Admin Dashboard — Reports page with date picker and chart (Recharts)
- E11-S5: CSV export for all report types

**Acceptance Criteria:**
- Sales report for a date range matches sum of `Order.totalCents` for that range (confirmed via DB query)
- CSV export downloads within 5 seconds for up to 1,000 orders
- Reports scoped by `venueId` — cross-venue data never leaks

**Dependencies:** E6, E10
**Definition of Done:** Reports accurate; CSV export working; charts rendering.

---

## E12 — Menu Display Kiosk & Remaining Kiosk Features

**Goal:** Outdoor menu display kiosk and production-hardening of all kiosk surfaces.

**Stories:**
- E12-S1: Menu Display Kiosk at `/display` — category/item display, 60-second auto-refresh
- E12-S2: Service Worker caching for menu display (offline fallback)
- E12-S3: Promotional banner — admin configures "Today's Special" text/image; kiosk displays it
- E12-S4: Kiosk mode hardening — fullscreen, disable right-click, disable browser shortcuts
- E12-S5: Staff PIN management overlay on kiosk (reboot display, clear cart, return to menu)
- E12-S6: Kiosk device registration — each kiosk has a venueId + type config stored locally

**Acceptance Criteria:**
- Menu display kiosk shows correct menu after internet outage (served from Service Worker cache)
- Promotional banner configured in admin → visible on kiosk within 60 seconds
- Right-click and keyboard shortcuts are disabled on kiosk in production mode

**Dependencies:** E4, E6, E7
**Definition of Done:** Menu display live on outdoor kiosk screen; all kiosk surfaces production-hardened.

---

## E13 — Security Hardening & Compliance

**Goal:** Production security pass before go-live.

**Stories:**
- E13-S1: Security headers (Helmet.js) — CSP, HSTS, X-Frame-Options, etc.
- E13-S2: CORS whitelist — only known origins (`verdura.co.nz`, `admin.verdura.co.nz`, `kiosk.verdura.co.nz`)
- E13-S3: Input validation audit — class-validator decorators on all DTO classes
- E13-S4: Media upload security — magic-byte file type validation, 10 MB size limit
- E13-S5: Secret rotation procedure documented; all secrets in environment variables (no `.env` committed)
- E13-S6: Dependency audit (`npm audit`) — resolve critical/high CVEs
- E13-S7: Rate limiting on all public endpoints (not just auth)
- E13-S8: Penetration test checklist (OWASP Top 10 self-assessment)

**Acceptance Criteria:**
- Security headers present on all responses (verified via securityheaders.com or equivalent)
- Uploading a `.php` file disguised as `.jpg` → rejected with 422 (magic bytes detected)
- `npm audit` shows zero critical vulnerabilities
- CORS rejects requests from unlisted origins

**Dependencies:** All epics
**Definition of Done:** Security checklist passed; no open critical CVEs.

---

## E14 — Airtable Decommission & Data Source Consolidation

**Goal:** Decommission and completely remove all Airtable dependencies, synchronization configurations, and local mock/queue code from the applications, enforcing the Supabase-only operational architecture.

**Stories:**
- E14-S1: Remove Airtable simulation timers, mock client sync hooks, and mock resolvers from the frontend api client (`apiClient.js`).
- E14-S2: Clean up PostgreSQL database schemas to delete the `pending_calendar_events` table. Remove the `PendingCalendarEvents.jsx` component and all of its imports and UI widgets from the admin console.
- E14-S3: Decommission the `sync-calendar` and `getPendingCalendarEvents` Deno Edge function integrations from the Supabase workspace.
- E14-S4: Implement direct synchronous Google Calendar API integration within the NestJS API (triggered on reservation status changes in the Reservations module) if calendar sync is required, removing all asynchronous sync queues or third-party bridges.

**Acceptance Criteria:**
- `grep -i "airtable"` returns zero matches across the entire codebase (excluding architectural documentation).
- `grep -i "pending_calendar_events"` returns zero matches across the entire application codebase (including Prisma schemas, migration files, and edge functions).
- `PendingCalendarEvents.jsx` file is deleted and its dashboard page card is removed.
- Frontend and admin applications build and run with zero Airtable or calendar queue references.
- Google Calendar events (if active) are created synchronously on reservation status transitions via direct Google REST API hooks in the NestJS backend.

**Dependencies:** E1, E2, E5 (Reservations)
**Definition of Done:** Airtable and calendar queues completely excised from codebase and workspace; all operational reservation flows run directly via Supabase Postgres.

---

## E15 — Order Tablet: Idealpos/EFTPOS/KOT Production Journey

**Goal:** Take the existing Verdura Order Tablet — a real, substantial, but previously un-epiced implementation (`tablet-frontend/`, `admin-frontend/src/pages/order-tablet/OrderTabletPage.tsx`, confirmed by `_bmad-output/audits/repository-story-audit-2026-08-16.md` §7 as "the single largest unowned feature in the repository") — from its current partially-functional state to the full production journey required by 11 October 2026: `Order Tablet → Verdura backend → authenticated Windows Connector → real Idealpos order → existing EFTPOS or cash workflow → correct KDS/KOT routing → real references and reconciliation`. No story in this epic may claim Idealpos, EFTPOS, KDS or printer success without a real, externally-verifiable outcome.

> **Baseline verification (2026-08-16), grounding this epic — do not re-derive, cite this banner instead:** the following were independently re-confirmed by reading the current `OrderTabletPage.tsx` this session (not assumed from the prior audit):
> - `handlePayAll()` (line ~629) never calls Stripe, Idealpos, or any payment gateway for either `payMethod` ('card' or 'cash') — it only calls `PATCH /api/admin/orders/:id/status` with `status: 'completed'`. **An order is marked paid/completed with zero payment confirmation of any kind.**
> - `handlePrintBill()` (line ~1061) is `setPrinted(true)` + a 900ms `setTimeout` — no backend call, no `PrinterJob` created, no real printer contacted.
> - The promo-code button hardcodes a single fixed code (`VERDURA10`, −10%) as a client-side boolean toggle — no backend validation, no real promo-code entity.
> - `getModifierGroupsForItem()` (line ~83) hardcodes all modifier groups/options/prices by matching category-name substrings (`'drink'`, `'pizza'`/`'oven'`/`'flatbread'`, else a generic "Preparation: Medium Well/Well Done/Medium Rare" + "Sauces & Dips" fallback) — **not sourced from `MenuItem`/`ModifierGroup` configuration at all**, and the generic fallback is applied to every item that doesn't match a drink or pizza substring, including items (e.g. desserts, salads) for which "Medium Well" preparation is nonsensical.
> - `tableNote`/`tableNoteDraft` (line ~263) are pure `useState` — never sent to any API. Notes are lost on tablet refresh/restart and invisible to any other device or the KDS.
> - `handlePerformTransfer()` (line ~1092) honestly returns `"Table transfer isn't supported yet"` rather than faking success — the one risk item in this epic's baseline that is already truthfully handled, not silently broken.
> - The on-screen running total (`totals`, line ~386) computes `service = base * 0.10` (an undocumented 10% "service charge" with no backend counterpart anywhere) and `gst = base * 0.15`, and applies the fake promo discount to the GST base. **This is a real, additional defect beyond the brief's original concern**: the backend's actual, authoritative pricing (`OrdersService.computeTotals`, `backend/src/orders/orders.service.ts:1033-1036`, also used by the already-correct kiosk checkout) computes only `taxCents = subtotalCents * 0.15` on top of `MenuItem.priceCents` — i.e. **the existing system-wide convention (backend + kiosk) already treats `MenuItem.priceCents` as GST-exclusive and adds 15% GST on top; this is consistent, not a double-count bug**. The tablet's GST line itself matches this existing convention. The genuine defect is the fabricated 10% "service" line and the fake promo discount: neither exists in `computeTotals`, so **the total shown to staff/guest at the table before submission will not match the total the backend actually computes and stores once the order is submitted** — a billing-integrity gap distinct from (and in addition to) GST handling. Establishing GST-inclusive-vs-exclusive display policy is therefore already answered by existing convention (exclusive, +15% on top, matching NZ practice of taxes shown as a separate line at point of sale where menus are not required to show tax-inclusive final price at a POS terminal) — stories in this epic must make the tablet consistent with `computeTotals`, not invent a new convention.
> - Standalone tablet builds (`tablet-frontend/`, and `admin-frontend`'s `VITE_APP_MODE=tablet`) gate the same `OrderTabletPage` behind `KdsPinGate` — a shared, venue-wide PIN with no per-staff identity — while the embedded admin route (`/order-tablet` inside `AdminPortalApp`) gates it behind full JWT `ProtectedRoute` staff login. The same order-completing, payment-marking UI is reachable through two materially different authentication strengths depending on entry point, with different audit-actor attribution.
> - No test file exists anywhere for `OrderTabletPage.tsx` or `tablet-frontend/` (confirmed: zero `*.spec.*`/`*.test.*` files under `tablet-frontend/`).

**Stories:**
- E15-S1: Production venue auto-selection and tablet authentication decision. Auto-select the single Dunedin production venue (no venue picker for a single-venue deployment). Resolve the standalone-vs-embedded PIN/JWT authentication inconsistency above with an explicit, written decision (shared device PIN with per-staff PIN-entry logging, vs. per-staff JWT login on the tablet, vs. a hybrid) — record it in `decisions-log.md`, then make both entry points use the same mechanism. `BLOCKED ON:` a product/security decision on the identity model (not derivable from existing materials — do not silently invent).
- E15-S2: Real table/order lifecycle on the tablet — table selection and guest count already call real backend endpoints (`realTableByNumber`, `POST /api/admin/orders`); this story formalizes start/reopen/manage against the existing one-active-order-per-table FSM (`OrdersService.validateTableForOrder`) as tested acceptance criteria, since today it is real but implicit/unstoried.
- E15-S3: Menu and modifier integrity. Replace `getModifierGroupsForItem`'s hardcoded category-substring-matched modifiers with real `MenuItem`/modifier-group configuration (extend the existing but currently untyped `modifierGroups` JSON field, per E4-S5's own already-flagged gap — coordinate with, do not duplicate, that story). Remove the hardcoded promo-code toggle; either implement a real backend-validated promo/discount entity or remove the UI element entirely until one exists — a fake discount that doesn't affect the real charged amount is a billing-trust risk, not a minor cosmetic gap.
- E15-S4: Idempotent submission and truthful acceptance. `submitOrderToKitchen`'s real `POST /api/admin/orders` call already exists; this story adds an idempotency key (consistent with story 6-1's existing idempotency-key pattern) so a tablet retry after a dropped response cannot create a duplicate order, and makes the on-screen running total call (or mirror) the backend's real `computeTotals` output rather than a locally-fabricated formula (removes the fake 10% "service" line; keeps the already-correct 15% GST line) so what staff/guest see before submission matches what is actually charged after.
- E15-S5: Idealpos handoff and authoritative POS state. `BLOCKED ON: DL-064` only now — the connector command-protocol dependency (story 2-10, done) is satisfied; this story still needs a real Idealpos-order-submit command *type* built on top of story 2-10's now-proven envelope/state machine, which is itself gated on DL-064/story 9-2, not on any remaining connector-protocol work. The tablet must display `POSSyncRecord.status` truthfully (reusing story 9-1's state machine) and must never imply an Idealpos order exists before a real `synced` state is observed.
- E15-S6: EFTPOS/cash handoff and truthful payment state. Replace `handlePayAll`'s direct `status: 'completed'` transition with a real payment-confirmation gate: for `card`, the transition to `completed` must only follow a real Idealpos-reported EFTPOS transaction reference (depends on E15-S5); for `cash`, an explicit staff cash-received confirmation step recorded with actor identity, distinct from the current single unconditional "Pay" button that treats both methods identically. Display pending/approved/declined/cancelled/timed-out/unknown payment states truthfully (no default-success assumption). `BLOCKED ON:` E15-S5 for the card path; the cash path (a staff-attested confirmation step + audit record) is not blocked and can land first.
- E15-S7: KDS/KOT routing and duplicate-print prevention for tablet-originated orders. Depends on story 9-2 (Idealpos UI-bridge tracer — its connector-command-protocol dependency is satisfied by story 2-10, done; it remains blocked on live Windows discovery, unaffected) and the DL-067 KOT-suppression decision (`docs/integrations/idealpos.md` §18) — Idealpos must not independently print a kitchen ticket for a Verdura-originated order that Verdura's own KDS/KOT routing already delivered.
- E15-S8: Bill, settlement and table closure. Replace `handlePrintBill`'s local-only `setPrinted`/`setTimeout` with a real `PrinterJob`-backed bill print (reusing story 8-1's truthful-states model — a "bill printed" label may only be shown after a real, non-`queued` confirmation), and gate `handlePerformCloseTable` on the authoritative payment state from E15-S6 rather than allowing table closure before payment is genuinely confirmed.
- E15-S9: Offline, retry and recovery behaviour. The tablet has no offline queue today (network calls fail immediately, surfaced via `orderActionError` — honest but not resilient); add bounded local queuing/retry for order submission and status transitions that cannot create duplicate orders/payments/kitchen tickets on reconnect (coordinate with E6-S6, currently `NOT_STARTED`, rather than building a second, divergent offline mechanism).
- E15-S10: Reconciliation, audit and operational visibility. Every operationally significant tablet action (order submitted, payment confirmed by method, bill printed, table closed, notes added) must produce a real, queryable audit record (reusing `AuditLogService`, the same pattern story 2-9 established for connector events) and a reconciliation view tying the Verdura order, Idealpos transaction (once E15-S5 lands), payment result, KDS delivery and KOT delivery together — this is the tablet-facing half of the operating model's reconciliation requirement (`target-operating-model.md`).
- E15-S11: Tablet-specific automated test coverage. Zero test files exist for `OrderTabletPage.tsx`/`tablet-frontend/` today. Add unit coverage for cart/totals/modifier-resolution logic and integration coverage for the real API calls (`submitOrderToKitchen`, `transitionOrderStatus`) already made from this component, following this repository's established real-Postgres integration-test convention (see stories 6-1/8-1/9-1/2-9) rather than mocking the backend it's supposed to be proven against.
- E15-S12: Real Windows/Idealpos/EFTPOS/printer end-to-end acceptance test at the Dunedin venue. The only story in this epic (or this journey) that may produce `REAL_WINDOWS_CONNECTOR`/`REAL_IDEALPOS` evidence — a live staff-operated tablet completing the full chain: order → connector → Idealpos → EFTPOS/cash → KDS/KOT → real references and reconciliation. `BLOCKED ON:` every other story in this epic plus DL-064 plus real on-site access; this is the terminal gate for the 11 October production-completion rule, not a story any earlier work in this epic can substitute for.

**Acceptance Criteria (epic-level; each story above carries its own objective, testable AC per the BMAD standard):**
- No tablet action ever displays a success/completion state that the backend, Idealpos, EFTPOS, KDS or a printer has not truthfully confirmed.
- The total displayed to staff/guest before order submission equals the total the backend actually stores and (once E15-S5/S6 land) charges — no client-only fabricated line items.
- Every item, modifier and price shown on the tablet is sourced from real `MenuItem`/modifier configuration, never a hardcoded category-matched table.
- A tablet retry (network drop, app restart) cannot create a duplicate order, duplicate Idealpos transaction, duplicate kitchen ticket, or duplicate payment.
- Standalone and embedded tablet entry points use one consistent, decided authentication model with per-action audit attribution.
- Real `REAL_WINDOWS_CONNECTOR`/`REAL_IDEALPOS` evidence exists for E15-S12 before this epic (or the 11 October journey) is considered production-complete; no earlier story's mocked/simulated evidence may be presented as satisfying this requirement.

**Dependencies:** E2 (auth), E4 (menu/modifier configuration — coordinate with E4-S5), E6 (ordering — coordinate with E6-S6 offline queue), E8 (printer truthful states — story 8-1), story 2-9 (connector identity, **done**), story 2-10 (connector command protocol, **done**), story 9-1 (truthful POS-sync states, done), story 9-2 (Idealpos UI-bridge tracer, blocked on live Windows discovery only — its connector-protocol dependency is satisfied), DL-064 (Idealpos vendor/reseller discovery, blocked), DL-067 (KOT suppression decision, blocked).
**Definition of Done:** All twelve stories above pass their own real-evidence-tier gates; the epic as a whole is not "done" until E15-S12's real on-site evidence exists — per this document's own Completion Rule, mock screens and fabricated provider responses count as prototypes, not completion, and that rule applies to this epic exactly as it does to E9.
