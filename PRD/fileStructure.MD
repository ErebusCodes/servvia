# Servvia structure reference (derived)

> **Status:** DERIVED REFERENCE, not an authority. It restates, for orientation, the repository structure governed by [`product-requirements.md`](product-requirements.md) Part C (sections 28–36) and the capability map of the domain volumes (00–09). If anything here disagrees with Part C or a domain volume, **they win** and this file must be corrected. Last derived 2026-10-05.

## 1. Repository structure (from SPRD Part C)

Convention: **deployable artifact type first, platform second** (SPRD §30.1). States use SPRD §34.1 vocabulary.

```
servvia/
├── apps/                                  deployable clients: apps/<platform>/<application>/
│   ├── web/
│   │   ├── admin-console/                 IMPLEMENTED IN TARGET LOCATION; also hosts the
│   │   │                                  TRANSITIONAL Order Tablet (VITE_APP_MODE=tablet)
│   │   │                                  and KDS (VITE_APP_MODE=kds) build modes
│   │   ├── customer-website/              IMPLEMENTED IN TARGET LOCATION (mostly JavaScript)
│   │   └── landing-page/                  STRUCTURAL SCAFFOLD ONLY
│   ├── windows/
│   │   └── pos-terminal/                  STRUCTURAL SCAFFOLD ONLY — FROZEN
│   │                                      (PENDING USER POS ANALYSIS REPORT; SPRD §12, §31)
│   ├── android/                           exactly four permanent applications (SPRD §32)
│   │   ├── waiter-tablet/                 Staff Mode + Guest Mode — STRUCTURAL SCAFFOLD ONLY
│   │   ├── kds/                           STRUCTURAL SCAFFOLD ONLY
│   │   ├── kiosk/                         STRUCTURAL SCAFFOLD ONLY (no current web kiosk)
│   │   └── window-display/                STRUCTURAL SCAFFOLD ONLY (no current signage client)
│   └── api/                               TRANSITIONAL NestJS API (exception: a backend under apps/);
│                                          Prisma migration authority in apps/api/prisma/
├── services/
│   ├── core-platform/                     Go Servvia Core — canonical backend; D1–D13 implemented,
│   │                                      not in production, no client switched (SPRD §30.3)
│   └── venue-edge/                        Go Venue Edge — STRUCTURAL SCAFFOLD ONLY (SPRD §30.4)
├── packages/                              reusable libraries only when genuinely shared (none yet)
├── contracts/                             openapi/, events/, realtime/, schemas/
├── data/                                  analytics/, forecasting/, ai/, pipelines/ — NOT YET CREATED
├── database/                              final migration-ownership target (Prisma stays authority)
├── infrastructure/                        docker/, local-dev/, … (current infra still at docker/,
│                                          docker-compose.yml, windows-deploy/, local-postgres/)
├── tooling/                               scripts/, ci/, … (current tooling still at scripts/)
├── docs/                                  architecture, adr, migration, operations, …
└── PRD/                                   requirements and architecture authority (this folder)
```

**Not present and not to be recreated:**

| Path | State | Reference |
|---|---|---|
| `apps/android/order-tablet/` | REMOVED (placeholder); no permanent Android order tablet — customer table ordering is Waiter Tablet Guest Mode | SPRD §32, §34.3, CC-3 |
| `apps/kitchen-display/`, `apps/order-tablet/`, `apps/window-display/` | REMOVED 2026-10-05 by owner decision; not evidence of native parity | SPRD §34.3, CC-4 |
| `web/`, `desktop/`, `android/` (top level), `android/core/`, `android/models/`, `android/build-logic/` | REMOVED (obsolete Stage 2 scaffold) | SPRD §34.3, CC-2 |
| `apps/idealpos-bridge*/`, `apps/idealpos-harness/`, `apps/venue-connector/` | RETIRE (legacy external-POS tooling; deleted from the working tree) | SPRD §34.2 |

## 2. Capability map (from volumes 01–09)

Domain → capability areas → primary surfaces. State is summarised; the domain volume is authoritative for detail. `TPC` = TARGET CAPABILITY — FUTURE DELIVERY (owner-approved long-term scope, DEC-X-1; delivery phase DEC-X-17; not committed current delivery).

```
Servvia
├── 01 Home ................................ Admin Console
│   ├── Operational home (role- and scope-aware)        TARGET
│   ├── Exceptions and alerts                            TARGET
│   ├── Notifications and tasks                          TARGET / FUTURE
│   ├── AI insight display, cross-domain tiles           TPC
│   └── Command search                                   FUTURE
├── 02 Operations .......................... Waiter Tablet, KDS, Kiosk, Window Display,
│   │                                         Admin Console (transitional Order Tablet/KDS modes),
│   │                                         Customer Website (reservations), Windows POS (frozen)
│   ├── Reservations                                     CURRENT (Nest) → TARGET (O-7); calendar sync TPC
│   ├── Tables and visits (table sessions)               TARGET (Core D2, D10); visit merge/split FUTURE
│   ├── Orders and rounds                                TRANSITIONAL (Nest) → TARGET (Core D3)
│   ├── Kitchen tickets, KDS, kitchen printing           TRANSITIONAL → TARGET (Core D4, Venue Edge)
│   ├── Availability ("86")                              TARGET (AVL-1, O-17); stock-driven 86 TPC
│   ├── Kiosk ordering and window display                TARGET (no current client)
│   ├── Phone, online and delivery-marketplace channels,
│   │   waitlist and queue, courses, expo, priority      TPC
│   └── Catering and events                              FUTURE
├── 03 Recipe and Production ............... Admin Console (back office), KDS (production)
│   ├── Allergen and nutrition data (MENU-2)             TARGET
│   ├── Recipes, yield, production, costing,
│   │   allergen alerts and labels                       TPC
│   └── Central kitchen                                  FUTURE
├── 04 Material Management ................. Admin Console, venue devices
│   └── Materials, stock, movements, procurement,
│       counts, waste, batches, low-stock alerts,
│       food-safety checklists                           TPC (O-9 inclusion resolved)
├── 05 CRM and Loyalty ..................... Admin Console, ordering surfaces
│   ├── Guest data protection (reservation contacts)     TARGET
│   ├── Profiles, consent, loyalty, campaigns,
│   │   feedback, segmentation, privacy tooling          TPC
│   └── Stored value, memberships                        FUTURE
├── 06 Workforce ........................... Admin Console
│   ├── Staff accounts and access (with 09)              CURRENT (Nest) → TARGET (Core)
│   ├── Employment records, scheduling, attendance,
│   │   payroll export and payroll (validated packs or
│   │   adapters only), training, AI staffing            TPC
│   └── Leave                                            DEFERRED (SPRD §13)
├── 07 Finance ............................. Waiter Tablet (Staff Mode), Windows POS (frozen),
│   │                                         Admin Console
│   ├── Checks, payments, settlement, refunds            TARGET (Core D5, D6, D9)
│   ├── Shifts and cash                                  TARGET (Core D7)
│   ├── Reconciliation                                   TARGET
│   ├── Check split and merge, wallets, operational P&L,
│   │   accounting integration, jurisdiction tax output  TPC
│   └── Ledger, AP/AR, bank reconciliation               DEFERRED (SPRD §13)
├── 08 Reports and BI ...................... Admin Console, scheduled email
│   ├── Service-day and venue reports (RPT-1, RPT-2)     CURRENT (basic, Nest) → TARGET (P11 headline)
│   └── Custom and scheduled reports, forecasting,
│       benchmarking, AI insights                        TPC
└── 09 Administration ...................... Admin Console
    ├── Organization, venues, configuration              CURRENT (Nest) → TARGET
    ├── Staff identity, roles, venue grants              CURRENT (Nest) → TARGET
    ├── Devices, terminals, printers                     TRANSITIONAL / TARGET (Core D8)
    ├── Menu and media administration                    CURRENT (Nest)
    ├── Integrations (payment adapter; legacy POS)       TARGET / TRANSITIONAL (to retire)
    ├── Audit search and export                          TARGET
    ├── Operating profiles, franchise and group, integration
    │   framework, external API and sandbox, MFA, IP allowlist,
    │   encryption at rest, point-in-time recovery, onboarding,
    │   help, jurisdiction packs                          TPC
    └── SSO/SCIM                                         DEFERRED (SPRD §13)
```

No capability above adds an Android application; the four permanent Android apps are unchanged (SPRD §32).

## 3. How to keep this file correct

Change SPRD Part C or the domain volume first, then re-derive this file. A difference between this file and its sources is a defect in this file.
