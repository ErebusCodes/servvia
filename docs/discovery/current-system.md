# Verdura — Current System Discovery

> **Discovery requirement — 2026-08-15:** Re-discovery must establish the facts needed by the [Target Operating Model](../target-operating-model.md): installed Idealpos version/build and licence modules, supported order-ingress mechanism, table/item/modifier/tender mappings, stable transaction reference, existing Oolio Pay/Verifone configuration, KOT hardware/stations, duplicate-print controls and how Idealpos payment/tender changes can be observed. None may be inferred from the perpetual licence alone.

> **Local installation evidence and live-discovery package — 2026-08-16:** a read-only, non-executed copy of an Idealpos Windows installation was safely inspected (filenames, PE headers, .NET assembly metadata, licence text only — no execution, decompilation, or database/credential access). Findings are recorded in [`../integrations/idealpos.md` §12](../integrations/idealpos.md#12--2026-08-16-local-installation-evidence-idealpos-solutions-copy) and confirm capability (Windows/.NET Framework 4.6.1/32-bit components, ecommerce/online/transaction code paths) but not licence entitlement, version, or a working integration. The bounded live-Windows discovery checklist required to actually answer this section's questions against a real running system is [`idealpos-live-discovery-checklist.md`](./idealpos-live-discovery-checklist.md) — status **not started**.

> **Historical baseline — reassessed 2026-08-15:** This file records discovery of the earlier `verdura_v1.2` system and is not a description of the current repository. The current system now includes separate customer, admin, kiosk and tablet frontends plus a NestJS backend. Admin authentication is active; menu, reservations, tables, orders, KDS and Order Tablet have real API paths. Major remaining gaps are verified Stripe payment, genuine POS/edge acknowledgement, print delivery, availability fan-out, enterprise authorization, tamper-evident audit, idempotency and concurrency safety. See [../mvp.md](../mvp.md) for the current baseline.

**Recommendation:** retain the findings below as provenance, but do not use their old file paths, integration assumptions or `[CONFIRMED]` labels as present-tense evidence without re-verification.

**Phase 1 Output (Updated)**  
**Date:** 2026-06-18  
**Audited repo:** `verdura_v1.2` (local, `main` branch)  

---

## Known Features `[CONFIRMED]`

Every claim in this section has direct evidence in the repository. File paths and line numbers are cited.

### Customer Website (Public, Frozen)

**Routes registered** (`src/App.jsx:40–49`):
* `/` — Home page (`src/pages/Home.jsx`)
* `/menu` — Menu page (`src/pages/Menu.jsx`)
* `/book` — Table booking / reservations (`src/pages/BookTable.jsx`)
* `/about` — About page (`src/pages/About.jsx`)
* `/contact` — Contact page (`src/pages/Contact.jsx`)
* `/login` — Login page (`src/pages/Login.jsx`)
* `/admin/daily-email` — Admin email settings page (`src/pages/AdminDailyEmail.jsx`)

**Navigation and layout components** (`src/components/`):
* `Navbar.jsx` — shared navigation bar
* `Footer.jsx` — shared footer
* `SectionDivider.jsx` — decorative divider
* `DishModal.jsx` — modal for displaying dish details on the Menu page
* `DrinksMenu.jsx` — drinks menu display component

**Reservation flow** (`src/components/reservation/`):
Multi-step booking wizard with five steps:
1. `Step1Details.jsx` — date, time, guest count
2. `Step2Guests.jsx` — guest details (name, email, phone, occasion, dietary preferences)
3. `Step3Menu.jsx` — optional pre-selection of menu items
4. `Step4Review.jsx` — booking summary and cancellation policy acceptance
5. `Step5Payment.jsx` — payment method selection (card / pay at restaurant / bank transfer)
* `StepProgress.jsx` — step indicator UI
* `ReservationSummary.jsx` — summary display
* `CancelBar.jsx` — cancellation UI

**Data storage mechanism** (`src/api/apiClient.js`):
All primary reservation data is stored and managed in local **PostgreSQL** through Prisma and the NestJS API. The schema is initialized from `backend/prisma/migrations/`; frontends do not write operational records directly or fall back to localStorage.
* **Transient UX Caching:** Used in `BookTable.jsx` (legacy `verdura_v1.2/src/pages/BookTable.jsx`, not present in this repository) under key `verdura_reservation_draft` to cache active booking selections across step navigations and page refreshes.

**Authentication mechanism** (`src/lib/AuthContext.jsx`):
Authentication is provided by the NestJS JWT/refresh-cookie API and the frontend auth stores.

**Menu data** (`src/api/categories.json`, `src/api/menuItems.json`):
Static JSON files bundled at build time. Four categories:
* Temptations (starters/salads)
* The Feast (mains)
* Sides
* Drinks

66+ menu items confirmed. All `image_url` fields are `null`. Prices are stored as JavaScript floats (e.g. `18.5`, `6.5`).

**Admin page embedded in public frontend** (`src/pages/AdminDailyEmail.jsx`):
Integrated with NestJS reservation and email endpoints:
* `dailyReservationSummary` edge function (sends reservation summary email logs).
* `backfillCalendarEvents` and `syncCalendarDescriptions` edge functions (syncs calendar event status queues).
* Email log table (queries database logs from the `email_logs` table).

---

## Unknown Features `[UNKNOWN]`

These items are described in the brief as existing in production but have **zero evidence** in this repository.

### Self-Ordering Kiosk
* `[UNKNOWN]` — No kiosk component, page, route, or service exists in this repository.

### Kitchen Printer Integration
* `[UNKNOWN]` — No ESC/POS or network printing libraries exist in the web package.

### POS Printer Integration
* `[UNKNOWN]` — No local printer dispatch code exists.

### IdealPOS Integration
* `[UNKNOWN]` — No POS database driver, API gateway client, or file import logic exists in this repository.

---

## Technical Risks

### Risk 1 — IdealPOS Integration Architecture (High)
The POS system is local on the Auckland LAN. A cloud-hosted application requires an on-premise gateway agent to safely route transactions to the POS.

### Risk 2 — Admin Page Security (Medium)
The route `/admin/daily-email` must be extracted from the public site to prevent client-side authorization bypasses.

### Risk 3 — Float Pricing Migration (Low-Medium)
Static menu prices are floats. They must be multiplied by 100 and rounded to integers to prevent precision loss during database imports.
