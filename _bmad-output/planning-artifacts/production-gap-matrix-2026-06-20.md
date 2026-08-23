# Production Gap Remediation — Verdura Restaurant Operations Platform

> **Enterprise re-baseline — 2026-08-15:** This matrix inherits [`docs/target-operating-model.md`](../../docs/target-operating-model.md). The former “Stripe Terminal kiosk first” assumption is superseded: existing Idealpos-integrated EFTPOS/cash is the default in-person path after Verdura submits the order to Idealpos and releases KDS/KOT following durable connector acceptance. Online Stripe or approved Verifone is optional and maps to Idealpos `PREPAID / ONLINE` after server verification.

## Operating-model gaps added to the critical path

| Gap | Required outcome | Priority |
| --- | --- | --- |
| Idealpos commercial/technical discovery | Build/licence/modules, supported ingress, mappings, stable reference and payment observation confirmed | P0 |
| Canonical order and transactional outbox | One immutable version/idempotency result atomically creates POS, KDS and station-KOT commands | P0 |
| Enterprise venue connector | Outbound mTLS, revocable installation identity, encrypted durable local queue, heartbeat and replay | P0 |
| Standard payment journey | Verdura → Idealpos → KDS/KOT → existing EFTPOS/cash → payment fact reconciled | P0 |
| Online prepaid journey | Verified provider payment → Idealpos `PREPAID / ONLINE` → KDS/KOT; both references retained | P0 when enabled |
| Kitchen ownership/deduplication | Verdura routes Verdura-originated KDS/KOT; Idealpos duplicate tickets prevented | P0 |
| Exception and reconciliation casework | Uncertain POS, paid/POS-failed, amount/tender mismatch, refund, void and reprint resolution | P0 |
| Enterprise proof | Tenant isolation, audit correlation, observability, outage/restart, backup/restore and real-hardware UAT | P0/P1 |

**Date:** 2026-06-20
**Verdict:** ❌ NOT READY FOR PRODUCTION
**Confidence:** High

---

## Deliverable 1 — Security Remediation Report

### Finding

`customer-frontend/src/App.jsx` (the customer-facing public website) registered an admin-only
route `/admin/daily-email` inside a `ProtectedRoute` wrapper. The route component
`./pages/AdminDailyEmail` no longer existed on disk (file deleted without removing
the registration), meaning any visit to `/admin/daily-email` would crash the React
bundle at runtime with a module-not-found error.

Beyond the crash risk, the existence of any `/admin/*` path on the **public domain**
violates FR-7.1 ("Admin deployed at a separate subdomain — never co-hosted with the
public site") and the E10-S8 / E5-S9 remediation requirement already recorded in
epics.md.

### Root Cause

The `/admin/daily-email` page was part of the legacy `verdura_v1.2` frontend. When
the current frontend was scaffolded the page file was dropped, but the route
registration and both imports were left in `App.jsx`. The ProtectedRoute guard
(`allowedRoles: ['admin','staff']`) prevented unauthorised access but did not fix
the domain-separation violation.

### Files Modified

| File | Change |
|------|--------|
| `customer-frontend/src/App.jsx` | Removed `import AdminDailyEmail` |
| `customer-frontend/src/App.jsx` | Removed `import ProtectedRoute` (no longer used) |
| `customer-frontend/src/App.jsx` | Removed `<Route element={<ProtectedRoute>}><Route path="/admin/daily-email" …/></Route>` block |

### Verification

- `/admin/daily-email` no longer appears in any route in `customer-frontend/src/App.jsx`.
- `ProtectedRoute` and `AdminDailyEmail` imports removed; no remaining references.
- `customer-frontend/src/components/ProtectedRoute.tsx` retained — it is the correct
  component for when the admin dashboard eventually implements client-side guards.

### Outstanding (not in this fix)

The Supabase Edge Function `customer-frontend/supabase/functions/daily-summary/index.ts`
accepts an arbitrary `recipient` address via POST body and uses
`SUPABASE_SERVICE_ROLE_KEY`. Its CORS policy is `*`. This function is deployed under
the Supabase project (not the public frontend domain) and is not directly accessible
from the public site after this fix, but it should be reviewed before production:

- Restrict `recipient` to a whitelist or remove the override entirely.
- Restrict CORS to known origins rather than `*`.
- Migrate daily summary scheduling to the NestJS API (BullMQ cron) per E5-S8.

### Domain Separation Status (Post-Fix)

| Surface | Domain | Admin routes? |
|---------|--------|---------------|
| Public website (`customer-frontend/`) | `verdura.co.nz` | ✅ None remaining |
| Admin dashboard (`admin-frontend/`) | `admin.verdura.co.nz` | ✅ Admin-only, JWT-gated |
| Kiosk (`kiosk-frontend/`) | Internal LAN / kiosk device | ✅ No admin routes |
| API (`backend/`) | `api.verdura.co.nz` | ✅ RBAC on all admin endpoints |

---

## Deliverable 2 — Core Transactional Capability Audit

### Schema Coverage

All domain models are defined in `backend/prisma/schema.prisma`:
`Organization`, `Venue`, `Table`, `FloorPlan`, `Staff`, `VenueAccess`,
`Reservation`, `ReservationGuest`, `Payment`, `Category`, `MenuItem`,
`MenuItemVenueOverride`, `Order`, `OrderItem`, `Printer`, `PrinterJob`,
`POSSyncRecord`, `AuditLog`.

The schema is ahead of the implementation. Models exist; services and controllers
for most of them do not.

---

### Capability Matrix

| Capability | Status | Existing Code | Missing | Epic/Story | Effort | Production Impact |
|-----------|--------|--------------|---------|-----------|--------|-----------------|
| **Order Submission** | ❌ Not Started | `orders/orders.module.ts` (empty shell) | Controller, Service, POST /kiosk/orders, price snapshot, order ref | E6-S1 | L | Blocks kiosk use entirely |
| **Order Lifecycle (FSM)** | ❌ Not Started | None | Status FSM API (pending→confirmed→preparing→ready→completed/cancelled), guard transitions | E6-S2 | M | Kitchen cannot manage orders |
| **WebSocket Order Events** | ❌ Not Started | None | Socket.io gateway, `venue:{id}:orders` room, push on status change | E6-S3 | M | Admin live view dead |
| **Reservation Persistence** | ❌ Not Started | `reservations/reservations.module.ts` (empty shell); legacy Edge functions deprecated | CRUD API, booking ref gen (VR-NNNN), capacity check, status FSM, direct Google Calendar API integration | E5-S1, E5-S2, E5-S3 | L | Reservations are unmigrated to central backend API |
| **Reservation Email** | ❌ Not Started | `confirm-reservation` (legacy Deno fn deprecated) | NestJS Resend integration, confirmation + cancellation emails | E5-S4 | S | No customer confirmation email |
| **Kitchen / Receipt Printing** | ⚠️ Placeholder | `printer/printer.controller.ts` — returns `{jobs:[]}` hardcoded | PrinterService, ESC/POS over TCP, BullMQ job dispatch, retry queue | E8 (BLOCKED Q2) | XL | Orders never reach kitchen printer |
| **POS Synchronisation** | ⚠️ Placeholder | `pos-sync/pos-sync.controller.ts` — returns `{records:[]}` hardcoded; NullAdapter scaffolded | Real adapter (API/CSV/ODBC/SQL), retry logic, admin widget | E9 (BLOCKED Q1) | XL | Orders never reach IdealPOS |
| **Dual Payment Orchestration** | ⚠️ Partial | Stripe server verification exists; Idealpos payment observation absent | Default Idealpos/EFTPOS or cash journey plus optional verified online provider mapped to `PREPAID / ONLINE`; retain both references and reconcile | E6-S9 + connector/reconciliation stories | Critical | Blocks live in-person and online checkout |
| **Menu Synchronisation (Supabase→Website/Kiosks)** | 🔄 Partial | Categories CRUD done (E4-S1); Menu Items in progress (E4-S2) | Public website API integration, Entrance Kiosk display screen, Ordering Kiosk display screen | E4-S3–S10, E6-S4, E6-S5 | H | Website & kiosks show stale/mock menu data |
| **Airtable Migration & Cleanup** | ❌ Not Started | Legacy Airtable mocks in `customer-frontend/src/api/apiClient.js` | Complete removal of Airtable packages, simulation timers, and configurations | E14 (new) | S | Violates single source of truth architecture |


---

### API Module Status

| Module | Controller | Service | Status |
|--------|-----------|---------|--------|
| `auth` | ✅ login, refresh, logout, me | ✅ | **Complete** |
| `venues` | ✅ full CRUD | ✅ | **Complete** |
| `tables` | ✅ full CRUD | ✅ | **Complete** |
| `menu/categories` | ✅ full CRUD | ✅ | **Complete** |
| `menu/menu-items` | ✅ full CRUD (Story 4-2, uncommitted) | ✅ | **In Progress** |
| `kiosk` | ✅ GET tables only | — | **Partial** |
| `orders` | ❌ empty shell | ❌ | **Not Started** |
| `reservations` | ❌ empty shell | ❌ | **Not Started** |
| `printer` | ⚠️ stub | ❌ | **Placeholder** |
| `pos-sync` | ⚠️ stub | ❌ | **Placeholder** |
| `reporting` | ❌ empty shell | ❌ | **Not Started** |
| `staff` | ❌ no controller | ✅ StaffService | **Partial** |
| `audit` | ❌ no controller | ✅ AuditService | **Partial** |
| `media` | ❌ no controller | ✅ MediaService | **Partial** |

---

## Deliverable 3 — MVP Launch Blocker List

The following are **hard blockers** — the system cannot serve its primary purpose (customers browse, order and pay at kiosks, website reflects live menu, kitchen receives orders) without them.

| # | Blocker | Epic/Stories | Risk |
|---|---------|-------------|------|
| B-1 | Order submission API does not exist — `POST /kiosk/orders` returns 404 | E6-S1 | Critical |
| B-2 | Reservation persistence not migrated — data lives in Supabase/localStorage only | E5-S1–S3 | Critical |
| B-3 | Kiosk menu browse, cart, and order-submit flow not implemented on Ordering Kiosk | E6-S4, E6-S5 | Critical |
| B-4 | Order status lifecycle (kitchen can't update) not implemented | E6-S2 | Critical |
| B-5 | Menu display pipeline: kiosks have no menu rendering (categories/items not consumed) | E4 remaining stories | High |
| B-6 | Kitchen Display System (KDS) not started — kitchen has no screen to see orders | E7 | High |
| B-7 | Admin Dashboard orders view not built — managers blind to live operations | E10-S2 | High |
| B-8 | Admin Dashboard reservations view not built | E10-S3/E5-S5–S6 | High |
| B-9 | `Q1` unresolved — IdealPOS integration mechanism unknown; POS stub in place | E9 | Critical (BLOCKED) |
| B-10 | `Q2` unresolved — printer hardware/protocol unknown; printer stub in place | E8 | Critical (BLOCKED) |
| B-11 | No Kiosk Payment Integration — payment processing and tracking not implemented on Ordering Kiosk | E6-S9 (new) | Critical |
| B-12 | Public Website still static — customer website does not query live menu API | E4-S11 (new) | High |
| B-13 | Airtable dependencies exist — legacy simulation logic still in frontend codebase | E14 (new) | High |


---

## Deliverable 4 — Launch-Critical Roadmap

### MVP Readiness Matrix

| Requirement | Status | Blocking Deps | Story Map | Risk | Priority |
|-------------|--------|--------------|-----------|------|----------|
| Menu CRUD API complete | 🔄 95% | — | E4-S1✅, E4-S2🔄 | Low | Now |
| Kiosk menu browse screen | ❌ | E4 complete | E4-S3, E4-S4 | High | Next |
| Kiosk cart + checkout | ❌ | Menu browse | E6-S4 | Critical | Next |
| Order submission API | ❌ | Auth, Menu | E6-S1 | Critical | Next |
| Order FSM API | ❌ | Order create | E6-S2 | Critical | Next |
| WebSocket order push | ❌ | Order FSM | E6-S3 | High | Next |
| Kiosk confirm screen | ❌ | Order submit | E6-S5 | Medium | Next |
| Kiosk Payment Integration | ❌ | Order submit | E6-S9 (new) | Critical | Next |
| Public Website Menu Integration | ❌ | Menu CRUD API | E4-S11 (new) | High | Next |
| Airtable Cleanup & Removal | ❌ | — | E14 (new) | High | Next |
| Kiosk offline queue (IndexedDB) | ❌ | Order submit | E6-S6 | Medium | Post-MVP |
| Reservation CRUD API | ❌ | Auth, Tables | E5-S1 | Critical | Next |
| Reservation FSM API | ❌ | Res. CRUD | E5-S2 | Critical | Next |
| Capacity enforcement | ❌ | Res. CRUD | E5-S3 | Medium | Next |
| Reservation confirmation email | ❌ | Res. CRUD | E5-S4 | Medium | Next |
| Admin: reservations list | ❌ | Res. API | E5-S5, E5-S6 | High | Next |
| Admin: orders live view | ❌ | Order WS | E10-S2 | High | Next |
| KDS (kitchen display) | ❌ | Order WS | E7-S1–S7 | High | Next |
| Printer dispatch | ❌ BLOCKED Q2 | Q2 decision | E8 | Critical | Blocked |
| IdealPOS sync | ❌ BLOCKED Q1 | Q1 decision | E9 | Critical | Blocked |
| Daily email (NestJS BullMQ) | ❌ | Reservation API | E5-S8 | Medium | Post-security |
| Remove legacy Supabase edge fns | ⚠️ | NestJS replacements | E5-S9 | Medium | After E5 |
| Staff management admin UI | ❌ | StaffService ✅ | E10-S4 | Medium | Next |
| Reporting | ❌ | Orders, Reservations | E11 | Low | Post-MVP |
| Entrance Kiosk (Menu Display) | ❌ | Menu API | E12 | High | Next |
| Security hardening (E13) | ❌ | All epics | E13 | High | Pre-launch |


### Minimum Stories for MVP Launch

Assuming Q1 and Q2 are resolved (or MVP ships with NullAdapter + manual printing):

**Must complete before any live customer use:**

1. E4-S2 — Menu Items CRUD API (in progress)
2. E4-S3 through E4-S5 — Kiosk menu endpoint, item images, allergen data
3. E6-S1 — Order create API
4. E6-S2 — Order status FSM
5. E6-S3 — WebSocket gateway
6. E6-S4 — Kiosk browse→cart→submit flow
7. E6-S5 — Kiosk confirmation screen
8. E5-S1 — Reservation CRUD API
9. E5-S2 — Reservation status FSM
10. E5-S3 — Capacity enforcement
11. E5-S4 — Confirmation email
12. E5-S5, E5-S6 — Admin reservations list + detail
13. E7-S1 through E7-S4 — KDS basic (display, status update, WebSocket feed, order queue)
14. E10-S2 — Admin live orders view
15. Q1 decision + E9-S2 (NullAdapter active, or real adapter)
16. Q2 decision + E8-S1–S4 (printer dispatch or manual workaround)

**Safely deferrable to post-launch:**

- E6-S6 (IndexedDB offline queue) — degrade gracefully, kiosk needs connectivity
- E6-S7 (idle timeout) — staff workaround
- E6-S8 (allergen display) — manual signage
- E5-S7, E5-S8 (daily email admin settings + BullMQ cron) — run legacy edge fn
- E5-S10 (provider-neutral payment entity) — required for optional online/prepaid flow and Idealpos payment reconciliation; online checkout may remain disabled until complete
- E10-S1 (dashboard summary) — cosmetic
- E10-S4 (staff management UI) — manage via seed/DB directly
- E10-S5 (audit log view) — logging still works
- E10-S6 (multi-venue switcher) — single venue at launch
- E11 (reporting) — export from DB manually
- E12 (menu display kiosk) — not required for ordering
- E13 (security hardening) — partial; must do CSRF and Helmet before real users

### Revised MVP Completion Estimate

| Layer | % Complete |
|-------|-----------|
| Infrastructure / Foundation (E1) | 100% |
| Authentication (E2) | 100% |
| Venues & Tables (E3) | 100% |
| Menu Management (E4) | ~20% (API partial; kiosks and website dynamic menu zero) |
| Reservations (E5) | 0% (legacy Deno Edge functions deprecated; NestJS zero) |
| Ordering / Kiosk (E6) | ~10% (table grid picker only; checkout and Stripe zero) |
| KDS (E7) | 0% |
| Printing (E8) | 5% (stub controller only; BLOCKED Q2) |
| IdealPOS (E9) | 5% (stub controller only; BLOCKED Q1) |
| Admin Dashboard (E10) | ~20% (login, venue, table settings done; mail settings and layout incomplete) |
| Reporting (E11) | 0% |
| Menu Display Kiosk (E12) | 0% |
| Security Hardening (E13) | ~20% |
| Airtable Decommission & Consolidation (E14) | 0% |
| **Overall MVP** | **~20%** |

---

## Deliverable 5 — Open Decision Recommendations

### T-01 — Menu Data Pipeline

**Decision: Dynamic API-driven (Locked)**

All customer-facing experiences (including the customer-facing website and all kiosks) must reflect the same live menu data and availability state directly from the shared Supabase-backed API.

* **Impact:** Public website will retrieve categories and menu items dynamically at runtime via the central API/Supabase database. The "static json" fallback option is decommissioned.


---

### Q1 — IdealPOS Integration

**Decision required:** Integration mechanism with IdealPOS.

**Controlled-development approach:**
- NullAdapter is permitted only for development/demo and must report `not_applicable` or `unsupported`, never POS success.
- A POS-connected pilot remains blocked until the connector and a supported Idealpos ingress are proven.
- Manual duplicate entry is an explicit emergency/manual mode with correlation and reconciliation, not the target MVP flow.

**Target production approach:**
- Confirm Idealpos build, licence/module entitlement and supported ecommerce/API/import path with Idealpos/Oolio or the reseller.
- Implement the outbound-only durable connector and approved adapter; direct database writes require written approval and recovery testing.
- Validate table, PLU, modifier, tax, standard tender and `PREPAID / ONLINE` mappings plus stable transaction/payment references.
- Prove downstream reconciliation and kitchen deduplication; an adapter swap alone is insufficient.

**Required action before decision:** Contact IdealPOS vendor or inspect the existing
IdealPOS installation at the restaurant to confirm API availability.

---

### Q2 — Printer Integration

**Decision required:** Kitchen / receipt printer hardware and protocol.

**MVP hardware strategy:**
- KDS is the fallback for printer failure, but required preparation-station KOT delivery cannot be represented as complete by browser printing.
- Identify every station, printer model/protocol and whether Idealpos currently prints imported orders; configure one owner to prevent duplicates.

**Production approach:**
- Identify printer model (Star, Epson, etc.) and confirm ESC/POS over TCP availability.
- Deliver scoped commands through the venue connector, persist locally before acknowledgement and report device-path outcomes independently.
- Cloud BullMQ may back the outbox dispatcher but is not exposed directly to the edge connector.

**Required technical validation:**
1. Confirm printer brand / network connectivity.
2. Test TCP socket to printer from a machine on the restaurant LAN.
3. Validate ESC/POS command set for that printer model.

---

### Q5 — Default Idealpos/EFTPOS and Optional Online Payments

**Decision: Existing Idealpos-integrated EFTPOS/cash is the standard in-person path; online payment is optional and provider-neutral.**

* **Standard Ordering:** Verdura submits to Idealpos, releases KDS/KOT after connector acceptance, and staff completes payment through the existing Idealpos-integrated EFTPOS/cash workflow. Verdura imports/reconciles the payment fact.
* **Online Ordering:** Stripe remains the initial default unless an approved Verifone/Oolio ecommerce service satisfies NZ merchant, sandbox, webhook, idempotency, refund and settlement requirements. Verified payment maps to Idealpos `PREPAID / ONLINE` before production release.
* **Reservations:** Stripe card payments remain deferred for reservations. The pilot will block the card payment option in the online booking wizard, relying strictly on bank transfer and pay-at-restaurant manual confirmations.


---

### Q6 — Production Hosting Architecture

| Service | Recommended Platform | Notes |
|---------|---------------------|-------|
| **API** (`verdura-api` NestJS) | Railway / Fly.io / Render | Containerised Node; needs persistent TCP to DB and Redis |
| **Database** (PostgreSQL) | Supabase Postgres or Railway Postgres | Supabase preferred — already in use for legacy; consolidation reduces ops overhead |
| **Redis** | Upstash Redis (serverless) or Railway Redis | Upstash works well with BullMQ; no persistent connection required |
| **Admin Dashboard** (`verdura-admin`) | Vercel / Netlify | Static SPA; deploy at `admin.verdura.co.nz` |
| **Public Website** (`verdura-frontend`) | Vercel / Netlify | Static SPA; `verdura.co.nz` — frozen, no backend |
| **Kiosk** (`verdura-kiosk`) | Self-hosted on kiosk device (nginx) or Vercel | Must be accessible from restaurant LAN; consider local nginx for reliability |
| **Supabase Edge Functions** | Supabase (existing) | Retain `confirm-reservation` and `sync-calendar` until NestJS equivalents ship in E5; retire after |
| **Object Storage** (menu images) | Supabase Storage or AWS S3 | E4-S6 scope |

---

## Updated Production Readiness Verdict

**Status: ❌ NOT READY — ~20% complete**

**Critical path to production (Corrected Priorities):**

1. **MenuItem CRUD API (E4-S2):** Complete MenuItem endpoints and schemas.
2. **Dynamic Website Menu Integration (E4-S11):** Transition public menu views to Central Supabase API.
3. **Reservation Migration to Supabase/NestJS (E5-S1 through E5-S6):** Implement reservation persistence, confirmation logic, and email.
4. **E5 Reservation Admin & Customer Flows:** Finalize reservation booking wizard UI and admin settings.
5. **Airtable Decommission and Cleanup (E14-S1 through E14-S4):** Decommission the `pending_calendar_events` table and excise legacy Airtable simulators.
6. **Ordering API Foundation (E6-S1):** Build kiosk order create endpoint with payment verification.
7. **Dual Payment Integration (E6-S9):** Reconcile existing Idealpos/EFTPOS in-person payments and implement optional provider-neutral online prepayment with `PREPAID / ONLINE` mapping.
8. **Kiosk Checkout Flow (E6-S4):** Wire checkout screen workflows.
9. **IdealPOS Integration (E9):** active synchronization with counter POS register.
10. **Kitchen Printing Integration (E8):** format and route physical ticket dispatch.

**Unblocked next story:** Story 4-2 (MenuItem CRUD API) — files exist uncommitted. Complete and commit, then begin E4-S11.

**Blocked items (require external decision before proceeding):**
- E9 (IdealPOS) — awaiting Q1 (on-site Auckland audit)
- E8 (Printing) — awaiting Q2 (on-site printer protocol audit)
