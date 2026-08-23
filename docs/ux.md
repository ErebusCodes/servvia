# Verdura — UX Design Document

> **Normative UX decision — 2026-08-15:** UX must implement the [Target Operating Model](./target-operating-model.md). Staff/customer tablets distinguish POS handoff, kitchen routing and payment. In-person orders show Idealpos/EFTPOS payment pending after submission; online orders do not reach production before verified payment by default. Admin exception views expose independent Idealpos, payment-provider, KDS and per-KOT states and references.

> **UX alignment — 2026-08-15:** This document mixes implemented surfaces with target flows. Real API-backed paths now exist for menu, reservations, tables, orders, KDS and Order Tablet; dashboard, reports, inventory, payments, staff, audit and integration areas still include prototype or simulated state. Every pilot-visible surface must label prototypes and expose truthful provider state. `Synced` may only mean confirmed by the provider, never locally queued or simulated.

**Recommendation:** prioritize exception ownership over dashboard breadth; show per-channel `Pending`, `Delivered`, `Acknowledged`, `Confirmed`, `Failed`, `Conflict`, `Unsupported` and `Manual`; label pre-POS money as a quote; make offline uncertainty visible; require accessible large-target recovery actions; and gate deferred modules with their unlock condition.


**Version:** 1.0 (inferred from PRD, Architecture, Epics, MVP, Domain Model)
**Date:** 2026-06-18
**Status:** Inferred — no wireframes produced. Establishes UX contracts for implementation.

---

## 1 — User Personas

| ID | Persona | Primary Surface | Tech Comfort |
|----|---------|----------------|-------------|
| P1 | Restaurant Customer (walk-in / reservation) | Self-Ordering Kiosk | Low — no training |
| P2 | Restaurant Owner | Admin Dashboard (all areas) | Medium |
| P3 | Manager / Front-of-House Manager | Admin Dashboard (all areas except billing) | Medium |
| P4 | Kitchen Staff | KDS (`/kds`) | Low — glance-and-tap |
| P5 | Cashier | Admin Dashboard (orders view) | Low–Medium |
| P6 | Administrator / Platform Admin | Admin Dashboard (system settings) | High |

---

## 2 — Surface Inventory

| Surface | URL | Auth Required | Repo |
|---------|-----|--------------|------|
| Public Website (frozen) | `verdura.co.nz` | No | `verdura_v1.2` |
| Self-Ordering Kiosk | `kiosk.verdura.co.nz` | No (venue-scoped) | `verdura-kiosk` |
| Menu Display Kiosk | `kiosk.verdura.co.nz/display` | No | `verdura-kiosk` |
| Kitchen Display System | `kiosk.verdura.co.nz/kds` | Staff PIN | `verdura-kiosk` |
| Admin Dashboard | `admin.verdura.co.nz` | JWT (role-based) | `verdura-admin` |

---

## 3 — Navigation Structure

### 3.1 Self-Ordering Kiosk (`kiosk.verdura.co.nz`)

```
/ (home splash)
  └── /menu (browsing — default entry)
        ├── /menu/:categoryId
        │     └── item detail overlay
        ├── /cart (cart review + table selection)
        └── /confirm/:orderId (order confirmation)
```

- Fullscreen; hides browser chrome
- No back/forward browser navigation — app-internal only
- Idle timeout 3 min → returns to `/menu`
- Staff PIN overlay (accessed via hidden 5-tap on corner): reboot display, clear cart

### 3.2 Menu Display Kiosk (`kiosk.verdura.co.nz/display`)

```
/display (read-only, auto-refreshes every 60s)
  └── Promotional banner (configurable from admin)
  └── Category panels with items and prices
```

- No user interaction; kiosk mode hardened
- Offline: serves last-cached data silently

### 3.3 Kitchen Display System (`kiosk.verdura.co.nz/kds`)

```
/kds (PIN entry on first load)
  └── Order card grid (real-time WebSocket)
        └── Tap card → advance status (pending → preparing → ready)
```

- No traditional navigation
- PIN required for venue-scoped token; no full staff login

### 3.4 Admin Dashboard (`admin.verdura.co.nz`)

```
/login
/dashboard (home — summary)
/orders (live order list)
  └── /orders/:id
/reservations
  └── /reservations/:id
/menu
  ├── /menu-management
  └── /menu/items
       └── /menu/items/new
       └── /menu/items/:id/edit
/tables
/staff
  └── /staff/new
  └── /staff/:id/edit
/printers
  └── /printers/:id (job queue, test print)
/reporting
  └── /reporting/sales
  └── /reporting/reservations
  └── /reporting/export
/audit-log
/settings
  ├── /venue
  ├── /settings/daily-email
  └── /settings/integrations
```

RBAC gates per route:

| Route prefix | Minimum role |
|---|---|
| `/dashboard`, `/orders`, `/reservations` | cashier |
| `/menu`, `/tables` | manager |
| `/staff`, `/audit-log`, `/settings` | admin |
| `/printers`, `/reporting` | manager |

---

## 4 — User Journeys

### J1 — Customer Self-Orders at Kiosk

```
Enter restaurant → approach kiosk → kiosk shows menu splash
→ Browse categories → select item → view item detail → Add to cart
→ Continue browsing OR view cart
→ Cart: review items, adjust quantities
→ Select table number (grid of active tables)
→ Choose "Pay through Idealpos/EFTPOS" or "Pay online" when enabled
→ In person: Submit → connector accepts Idealpos handoff → KDS/KOT released → confirmation shows "Payment at POS pending"
→ Online: provider payment verified → Idealpos PREPAID/ONLINE + KDS/KOT released → paid confirmation
→ [optional] Idle 3 min → returns to splash
```

**Offline path:** A draft may be retained locally, but the UI must not confirm submission or release production until the connector has durably accepted it, unless authorized emergency mode is visibly active.

### J2 — Manager Reviews and Acts on Reservations

```
Login → Dashboard home (today summary)
→ Reservations → filter by date/status
→ Select reservation → view detail
→ Confirm / Cancel / Mark No-Show
→ Email sent automatically on status change
```

### J3 — Kitchen Staff Processes an Order

```
Order submitted → connector durably accepts Idealpos command → KDS receives the same immutable order version (< 3s target)
→ Audio alert fires → order card appears (green — new)
→ Staff taps card → status → "Preparing" (card turns neutral)
→ After 10 min: card turns amber
→ Staff taps → "Ready" → visual + audio alert fires
→ Admin Dashboard live orders view reflects status change
```

### J4 — Admin Manages Menu

```
Login (admin/manager role) → Menu → Categories
→ Create/edit/reorder category
→ Menu Items → select category → item list
→ New item → fill form (title, description, price, nutritional details, allergens, modifiers)
→ Upload image → stored as webp → URL saved
→ Save → item appears on kiosk within 60 seconds
```

### J5 — Admin Configures Printer

```
Login → Printers → Add Printer
→ Enter: name, type (kitchen/pos/bar/dessert), connection (TCP), IP, port, paper width
→ Test Print → result shown in UI
→ On order submission → print job queued → dispatched within 3 seconds
→ On failure → retry (up to 3x, exponential backoff) → alert in dashboard on final failure
→ Manually reprint from job queue
```

### J6 — Owner Reviews Daily Reports

```
Login (owner) → Reporting → Sales
→ Select date range → chart + table rendered
→ Top 10 items by quantity
→ Export CSV → download
```

---

## 5 — Key Screen Specifications

### 5.1 Self-Ordering Kiosk — Menu Browse

- **Layout:** Category pills/tabs at top; item grid below (2–3 columns)
- **Item card:** Image (webp), name, price, allergen icons, "Add" button
- **Touch targets:** Minimum 48×48px (NFR-5.2)
- **Contrast:** Minimum 4.5:1 (NFR-5.2)
- **Item detail overlay:** Full description, modifier groups (required/optional selectors), quantity control, "Add to Cart"
- **Allergen display:** Icon row from `nutritionalDetails.allergens` array

### 5.2 Self-Ordering Kiosk — Cart & Checkout

- **Cart:** Item list, quantity ±, remove, subtotal
- **Table selection:** Grid of active table numbers (from `GET /api/kiosk/tables`)
- **Submit button:** Disabled until table selected
- **Confirmation screen:** Order reference (`VR-NNNN`), estimated wait time, "Start New Order" button

### 5.3 Kitchen Display System

- **Order card:** Order ID, table #, timestamp, items (with quantities, modifiers, notes)
- **Age indicator:** Green (0–10 min), Amber (10–20 min), Red (20+ min) — thresholds configurable
- **Status button:** Single large tap target per card — advances to next status
- **"Ready" state:** Visual flash + browser audio API alert
- **Offline banner:** Shown when WebSocket disconnected; auto-reconnect in background

### 5.4 Admin Dashboard — Login

- **Fields:** Email, Password
- **Error states:** Invalid credentials (generic message — no username enumeration), account locked after 10 attempts (429 shown as "Too many attempts, try again in 15 minutes")
- **No "forgot password" on MVP** — admin resets via CLI

### 5.5 Admin Dashboard — Live Orders

- **Real-time list:** WebSocket updates; new orders appear at top
- **Columns:** Order ref, table, items summary, status badge, timestamp, age
- **Status control:** Dropdown per row — manual override for manager
- **Filter:** By status, by date range

### 5.6 Admin Dashboard — Menu Item Form

- **Required fields:** Title, Description, Price (decimal input, stored as cents), Category, Sub-category, Is Available toggle
- **Optional:** Is Spicy toggle, Sort Order, Image upload
- **Nutritional section:** Calories, Protein, Carbs, Fat (number inputs), Allergens (multi-select from enum)
- **Modifiers section:** Add modifier group (name, required/optional, min/max selections, options list with price adjustments)
- **Validation:** Price must be positive; allergens must be from enum list

---

## 6 — Error States

| Surface | Scenario | User-facing message |
|---------|----------|---------------------|
| Kiosk | API unreachable | "We're having trouble reaching the system. Your order has been saved and will be submitted shortly." |
| Kiosk | Printer unreachable | Transparent to customer — order submitted; print queued in backend |
| Kiosk | Idle timeout | Auto-return to menu with 30-second countdown overlay |
| KDS | WebSocket disconnected | Banner: "Connection lost — displaying saved orders. Reconnecting…" |
| Admin | 401 Unauthorized | Redirect to `/login` |
| Admin | 403 Forbidden | "You don't have permission to view this page." |
| Admin | Print job failed | Alert badge on Printers nav item; job queue shows error row with retry button |
| Admin | Form validation error | Inline field-level messages; form does not submit |

---

## 7 — Offline Behaviour

| Surface | Offline mode | User impact |
|---------|-------------|-------------|
| Self-Ordering Kiosk | Restricted IndexedDB queue (Pay-at-Counter fallback or post-payment sync retry) | Pay-at-Counter instructions or "sent to kitchen" confirmation |
| Menu Display Kiosk | Service Worker cache (StaleWhileRevalidate) | Last-known menu shown; "Last updated X min ago" if stale > 10 min |
| KDS | Previously received orders displayed; new orders buffer | No new orders visible until reconnect; existing cards remain actionable |
| Admin Dashboard | Read-only cached views (TanStack Query stale data) | Full editing requires connectivity; stale indicator on lists |

---

## 8 — Accessibility Considerations

| Requirement | Target | NFR ref |
|-------------|--------|---------|
| WCAG 2.1 AA | Admin Dashboard | NFR-5.1 |
| Touch targets ≥ 48×48px | Kiosk, KDS | NFR-5.2 |
| Contrast ratio ≥ 4.5:1 | Kiosk, KDS | NFR-5.2 |
| ARIA labels, semantic HTML | Admin Dashboard | NFR-5.3 |
| Screen-reader support | Admin Dashboard | NFR-5.3 |
| Readable at 600mm distance | Kiosk | NFR-5.2 |
| No reliance on colour alone | KDS age indicator (use icon + colour) | WCAG 1.4.1 |

---

## 9 — Acceptance Criteria Cross-references

| UX requirement | FR ref | Epic ref |
|----------------|--------|---------|
| Kiosk fullscreen + no browser chrome | FR-4.1 | E12-S4 |
| Kiosk touch targets 48×48px | NFR-5.2 | E6-S4 |
| Idle timeout 3 min | FR-4.12 | E6-S7 |
| Kiosk offline queue | FR-4.9 | E6-S6 |
| KDS < 3s order appearance | FR-6.2, NFR-1.4 | E7-S1 |
| KDS age colour coding | FR-6.6 | E7-S4 |
| KDS audio alert on ready | FR-6.5 | E7-S5 |
| Admin RBAC enforced server-side | FR-7.2, NFR-2.6 | E2-S4 |
| Admin Dashboard load < 2s | NFR-1.5 | E10 AC |
| Menu display auto-refresh 60s | FR-5.3 | E12-S1 |
| Allergen display on kiosk | FR-3.3 | E6-S8 |

---

## 10 — Open UX Questions (Deferred to Design Sprint)

| # | Question | Impact |
|---|----------|--------|
| UX-Q1 | What is the idle state of the menu display kiosk between customers? (screensaver vs. static menu) | E12-S1 scope |
| UX-Q2 | Should the kiosk support multiple languages? | E6 scope |
| UX-Q3 | Is there a customer-facing order status screen post-submission? (live "your order is being prepared" view) | Not in FR; potential E6 addition |
| UX-Q4 | Floor plan editor UX (FR-7.9 WONT MVP) — wire it for post-MVP? | E3 extension |
| UX-Q5 | What is the exact promotional banner format on the menu display? (image-only, text-only, both?) | E12-S3 scope |
