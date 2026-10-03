<!--
EVIDENCE SNAPSHOT. NOT REQUIREMENTS AUTHORITY.
-->
> **EVIDENCE SNAPSHOT: historical input, not requirements authority.**
>
> **What this is:**
> - The "Step 2" requirements draft of 2026-10-01, preserved as the `[P2]` source evidence cited by [`PRD/product-requirements.md`](../PRD/product-requirements.md).
> - Snapshot taken 2026-10-03 from the untracked working-tree file as inspected on 2026-10-01.
> - Source file SHA-256 (everything below the horizontal rule): `348eaae46b30659c6b2cf3cf396cd5db2c3f748c2099046c023821698efe3570`, 23,961 bytes, last modified 2026-10-01 13:44.
> - The content below the rule is **unchanged**. It is not updated to current decisions.
>
> **Authority:**
> - The authoritative requirements are [`PRD/README.md`](../PRD/README.md) and [`PRD/product-requirements.md`](../PRD/product-requirements.md).
> - Architecture authority is [`fileRestructure.md`](../fileRestructure.md).
> - Nothing in this snapshot overrides `PRD/`, `fileRestructure.md`, accepted ADRs or later decisions.
>
> **Known superseded statements below:**
> - repository layout (e.g. relocating `apps/*` into `web/*`), superseded by CC-2;
> - a separate Customer Order Tablet application, superseded by CC-3;
> - O-11, superseded by CC-1.
>
> **Broken links below:** links to `docs/planning/` point to planning output that is not part of this baseline.

---

# Servvia product requirements (PRD)

> **Status:** New PRD, authored from scratch on 2026-10-01. Draft for owner review.
> **Inputs (only these):**
> - [`fileRestructure.md`](../fileRestructure.md), the approved repository structure and architecture;
> - the actual repository and Stage 2 scaffold, inspected read-only;
> - implemented Servvia Core behaviour and `contracts/`.
>
> **Not inputs:** `_bmad/`, `_bmad-output/` and earlier planning documents. They were not read.
> **Planning set:** [`docs/planning/`](planning/README.md) (epics, backlog, pilot milestone, definition of done).

Status words used throughout:

| Word | Meaning |
|---|---|
| **IMPLEMENTED** | Exists and is tested, in its owning component. |
| **PARTIALLY IMPLEMENTED** | Some of it exists in its owning component. |
| **TRANSITIONAL** | Works today, but in a component that is not its permanent owner (mostly the NestJS API and the current React apps). |
| **NOT IMPLEMENTED** | Does not exist anywhere. |
| **BLOCKED ON USER REQUIREMENTS** | Cannot be specified until the owner supplies requirements. |
| **RETIRE LATER** | Legacy; removed once its callers are migrated. |

---

## 1. Product definition

Servvia is a restaurant operating platform in which **Servvia itself is the operational point of sale**. It records a venue's service day: tables and visits, orders, kitchen work, bills, payments, refunds, cash shifts and promotions. It serves the staff and customer devices that create and act on that record.

There is no external POS. Servvia owns the transactional record from the first order of the day to the last payment.

## 2. Product principles

1. **One canonical record.** PostgreSQL is authoritative. Go Core (`services/core-platform`) owns canonical transactional restaurant state. There is no second canonical backend.
2. **Clients consume contracts.** Every client uses Servvia APIs and realtime contracts (`contracts/`). No client owns canonical pricing or writes to PostgreSQL directly.
3. **Server-side pricing authority.** Prices, modifiers, tax and discounts are computed by Core, never trusted from a client.
4. **Facts, not commands, between components.** A committed change records a domain event in the same transaction (D13). Realtime and background workers consume those events.
5. **Build before cleanup.** A legacy component retires only after its replacement is implemented, its callers are migrated, and the behaviour is proven. Repository relocation never blocks missing product functionality.
6. **Requirements before design.** Behaviour that the owner has not specified is not invented. Windows POS behaviour waits for the POS analysis report.

## 3. Users and actors

| Actor | Uses | Needs |
|---|---|---|
| Venue owner / admin | Admin Console | Configure the venue, menu, tables, staff, devices and promotions; see the operational and financial record. |
| Manager | Windows POS, Admin Console | Supervise service. Manager functions on the POS are **pending the POS analysis report**. |
| POS staff | Windows POS | Run the service day at the main terminal. Workflow **pending the POS analysis report**. |
| Waiter | Waiter Tablet | Take orders at the table (staff-operated mobile POS). |
| Kitchen staff | KDS (and kitchen printers via Venue Edge) | See and progress kitchen work. |
| Customer at a table tablet | Customer Order Tablet | Order at the table without staff (customer-operated). |
| Kiosk customer | Kiosk | Order and pay in self-service. |
| Public website customer | Customer Website, Landing Page | Learn about the venue, see the menu, make reservations. |
| Venue device (non-human) | Venue Edge | Printers, cash drawer, payment terminal, driven by Servvia. |

## 4. Product surfaces

| Surface | Location | Technology | Role | Status |
|---|---|---|---|---|
| Go Core | `services/core-platform/` | Go | Canonical transactional state, REST APIs, realtime, events, workers | PARTIALLY IMPLEMENTED (section 8) |
| Windows POS | `desktop/pos-terminal/` | C# / .NET / Windows | Main POS terminal | Scaffold only; **BLOCKED ON USER REQUIREMENTS** (POS analysis report) |
| Waiter Tablet | `android/apps/waiter-tablet/` | Kotlin / Android | Staff-operated mobile POS / waiter ordering | NOT IMPLEMENTED. Transitional predecessor: web staff "Order Tablet" in `apps/admin-console` |
| Customer Order Tablet | `android/apps/order-tablet/` | Kotlin / Android | Customer-operated table ordering | NOT IMPLEMENTED (new application; no predecessor) |
| Kiosk | `android/apps/kiosk/` | Kotlin / Android | Customer self-service ordering | NOT IMPLEMENTED natively. Transitional: `apps/window-display` `KioskOrderPage` |
| KDS | `android/apps/kds/` | Kotlin / Android | Kitchen display | NOT IMPLEMENTED natively. Transitional of record: `apps/admin-console` KDS mode |
| Window Display | `android/apps/window-display/` | Kotlin / Android | Promotions / digital signage | NOT IMPLEMENTED natively. Transitional: `apps/window-display` |
| Admin Console | `web/admin-console/` (today `apps/admin-console/`) | React + TypeScript | Venue administration and oversight | TRANSITIONAL (runs on NestJS; several pages use mock data) |
| Customer Website | `web/customer-website/` (today `apps/customer-website/`) | React + TypeScript | Public site: menu, reservations, contact | TRANSITIONAL (runs on NestJS; mostly JavaScript) |
| Landing Page | `web/landing-page/` | React + TypeScript | Public landing page | NOT IMPLEMENTED |
| Venue Edge | `services/venue-edge/` | Go | Venue hardware orchestration | Scaffold only; NOT IMPLEMENTED |
| Analytics / AI | `data/` | Python | Analytics, forecasting, AI; outside the transaction path | NOT IMPLEMENTED |

## 5. Canonical domain model

Owned by Go Core. Names follow the implemented code and `contracts/`.

| Concept | Meaning | Core status |
|---|---|---|
| Organization | The tenant. Owns venues, staff and configuration. | Read model IMPLEMENTED; administration NOT IMPLEMENTED in Core |
| Venue | A restaurant site. Carries tax configuration (NZ GST-inclusive is the verified profile). | Read IMPLEMENTED; administration TRANSITIONAL (Nest) |
| Menu (categories, items, modifiers, channel visibility) | What can be sold, on which channel | Channel read IMPLEMENTED; administration TRANSITIONAL (Nest) |
| Table | A physical table at a venue | Configuration TRANSITIONAL (Nest) |
| Table session (visit) | One party's occupancy of a table, from open to financially complete close | IMPLEMENTED (D2, D10) |
| Order and round | An order and its successive rounds of requested items, priced by Core | IMPLEMENTED (D3) |
| Kitchen ticket | Kitchen work projected from a submitted round, per station | IMPLEMENTED (D4) |
| Check | The bill: a financial obligation over priced lines | IMPLEMENTED (D5); split and allocation NOT IMPLEMENTED |
| Payment and settlement | Tenders against a check; provider-neutral result state | IMPLEMENTED (D6) |
| Shift and cash | Cash accountability: float, cash movements, count, variance | IMPLEMENTED (D7) |
| Device, terminal | Enrolled device credentials; logical POS terminals | IMPLEMENTED (D8) |
| Refund, reversal | Money returned against a payment | IMPLEMENTED (D9) |
| Promotion | Configured price promotions applied by Core pricing | IMPLEMENTED (D11) |
| Domain event, delivery | The durable fact log and per-consumer work progress | IMPLEMENTED (D12, D13) |
| Staff member, role, permission | Who may do what | NOT IMPLEMENTED in Core (see section 9) |
| Receipt | The customer-facing record of a settled check | NOT IMPLEMENTED |
| Reservation | A booked table time | TRANSITIONAL (Nest); Core ownership is an open requirement (section 24) |
| Audit record | Who changed what, when | Written by Core stores; viewing TRANSITIONAL (Nest) |

## 6. System-of-record rules

1. **PostgreSQL holds the record.** Go Core is the only writer of canonical transactional tables for the domains in section 5 that are IMPLEMENTED in Core.
2. **Clients never write the database.** They call Core APIs.
3. **The client is never trusted for a price, a total or tax.**
4. **Every canonical change records its domain event in the same transaction.** No change is committed without its fact.
5. **Prisma (`apps/api/prisma/`) is the migration authority during the transition.** `database/` is the final ownership boundary, and published migrations are never renamed or rewritten.
6. **During the transition NestJS still writes several tables.** Two cases:
   - non-transactional administration (menu, tables, venues, staff PINs, media, reservations);
   - legacy order paths.

   A domain moves to Core by: Core API implemented → callers migrated → Nest path retired. Two writers of the same canonical domain must not remain after a client has migrated.

## 7. Multi-tenant ownership

- **Tenancy hierarchy:** organization → venues. Every canonical row is scoped to an organization and a venue.
- **Scope comes from the verified credential, never from a client-supplied identifier:**
  - staff login sessions are organization-wide;
  - device and tablet credentials are venue-scoped.
- **No tenant can read another tenant's data or operational metadata.** Every endpoint that aggregates data is tested for cross-tenant isolation (for example, the D13 worker backlog is organization-scoped).

## 8. Existing implemented capability

**Go Core, IMPLEMENTED and tested** (unit, contract, architecture, PostgreSQL integration, race, and parity with Nest where applicable). These are **not** rebuilt:

| Phase | Capability | API (prefix `/api`) |
|---|---|---|
| D1 | Health, readiness; channel menu read; venue tax configuration | `/health`, `/ready`, `GET menu/venues/{venueId}/channel/{channel}`, `GET venues/{id}/tax-config` |
| D2, D10 | Table sessions: open, read, list, update, close (financially complete), cancel | `…/tables/{tableId}/sessions`, `…/table-sessions…` |
| D3 | Orders and rounds with server pricing (modifiers, GST, discounts) | `POST …/orders`, `GET …/orders/{orderId}`, `POST …/orders/{orderId}/rounds` |
| D4 | Kitchen tickets: projection, list, read, transitions | `…/kitchen-tickets…` |
| D5 | Checks: create, read, void | `…/checks…` |
| D6 | Payments and settlement; provider-neutral payment-adapter result endpoints | `POST …/checks/{checkId}/payments`, `GET …/payments/{paymentId}`, `/api/internal/payment-adapter/…` |
| D7 | Shifts and cash: open, read, close | `…/shifts…` |
| D8 | Devices (credential enrol, revoke, rotate) and terminals (create, bind, unbind, disable) | `…/devices…`, `…/terminals…` |
| D9 | Refunds and reversals | `POST …/payments/{paymentId}/refunds`, `GET …/refunds/{refundId}`, adapter endpoints |
| D11 | Promotions: create, update, activate, deactivate | `…/promotions…` |
| D12 | Realtime WebSocket delivery of canonical facts by audience | `/api/realtime` |
| D13 | Durable domain events, per-consumer workers, organization-scoped worker backlog | `GET /api/admin/workers` |

**Limits of what exists today:**
- **No client calls Go Core yet.** Every client uses NestJS.
- **Go Core cannot be deployed yet:** there is no container image and no routing.
- **Writes are off by default** (`SERVVIA_CORE_DB_READ_ONLY=true`).
- **Go Core verifies Nest-issued access tokens.** It does not issue them.
- **D13 is prepared but uncommitted** (Checkpoint A).

**TRANSITIONAL capability that works today on NestJS and the React apps:**
- **Authentication:** named staff sign-in (email and password, set by the staff member with a single-use setup code; the shared admin PIN is removed, Story 2.4), refresh, logout, KDS PIN, tablet device enrolment and tokens.
- **Administration:** venue, menu (categories and items), tables, staff list and tablet PIN, media upload to Google Cloud Storage.
- **Reservations:** public availability and booking; admin management.
- **Order paths:** kiosk ordering with card-present payment (Stripe Terminal), staff tablet ordering, admin orders, a Socket.IO order gateway, and the KDS dispatcher.
- **Email** and **audit log viewing**.

## 9. Missing capability

| Capability | Owner (target) | Status |
|---|---|---|
| Go Core deployable: image, configuration contract, routing, readiness against migration version, staging | Core + infrastructure | NOT IMPLEMENTED |
| Clients calling Core for transactional work | each client | NOT IMPLEMENTED |
| Authentication issued by Core (login, sessions, device sessions) | `internal/identity/` | NOT IMPLEMENTED (TRANSITIONAL in Nest) |
| Staff management: create, edit, deactivate, roles, PINs | `internal/staff/`, `identity/` | NOT IMPLEMENTED (Nest has list and tablet PIN only; the Admin staff page uses mock data) |
| Venue, menu and table administration APIs in Core | `venues/`, `menu/`, `tables/` | NOT IMPLEMENTED in Core (TRANSITIONAL in Nest) |
| Collection reads for orders, checks, payments and shifts (lists by venue, time and status) | Core | NOT IMPLEMENTED (only reads by ID exist) |
| Check split and allocation | `checks/` | NOT IMPLEMENTED |
| Receipts (document content for a settled check) | `internal/receipts/` | NOT IMPLEMENTED |
| Service-day reporting (sales and tender summaries) | Core, Admin Console | NOT IMPLEMENTED (Admin dashboard and reports use mock data) |
| Venue Edge: enrolment, command channel, printers, cash drawer, payment terminal, health | `services/venue-edge/` | NOT IMPLEMENTED |
| Print domain in Core (print jobs and routing) | Core | NOT IMPLEMENTED. No real print transport has ever existed in this repository |
| Card payment provider adapter | Venue Edge | NOT IMPLEMENTED; provider choice open |
| Windows POS | `desktop/pos-terminal/` | BLOCKED ON USER REQUIREMENTS |
| Native Android applications and shared Android platform | `android/` | NOT IMPLEMENTED |
| Landing page | `web/landing-page/` | NOT IMPLEMENTED |
| Analytics and AI | `data/` | NOT IMPLEMENTED |
| Inventory | not in the approved structure | NOT IMPLEMENTED (Admin page uses mock data); open requirement |

## 10. First usable product

**Definition:** in a staging environment, one venue completes an end-to-end service-day loop **entirely on Go Core**, using real Servvia clients and **no NestJS transactional path and no external-POS path**.

The loop covers:
1. A staff member signs in.
2. A visit is opened.
3. Orders and rounds are placed.
4. Kitchen tickets appear and progress on the KDS.
5. A check is produced.
6. Cash payment settles it.
7. The visit closes.
8. A shift opens and closes with a cash count.

A refund can be taken.

**Not part of the first usable product:** card payments, printing and cash-drawer hardware. Those are pilot prerequisites.

The POS client's part of this loop is **Requires POS Analysis Report**. Detail is in [`planning/pilot-milestone.md`](planning/pilot-milestone.md).

## 11. Pilot venue: FIRST INDEPENDENT SERVVIA PILOT

**Definition:** a real venue performs its required service-day operations **using Servvia as the operational POS, without relying on an external POS**, in production, with venue hardware.

The prerequisites are grouped in [`planning/pilot-milestone.md`](planning/pilot-milestone.md):
- architectural and platform;
- application;
- venue hardware;
- operational readiness.

**Pilot requirements in summary:**
- The first usable product, running in production.
- Card payment through a provider adapter on Venue Edge.
- Receipt printing and, if the venue requires it, kitchen printing via Venue Edge.
- Cash drawer.
- Admin Console able to configure the pilot venue against Core.
- Service-day reporting sufficient to close the day.
- Backups, monitoring and an operational runbook.

## 12. Post-pilot functionality

- Waiter Tablet, unless the pilot venue requires it (section 24).
- Customer Order Tablet, native Kiosk and native Window Display.
- Native KDS.
- Check split and allocation, unless the POS report requires them for the pilot.
- Landing Page and the customer-website TypeScript migration.
- Analytics, forecasting and AI.
- Multi-venue operations at scale.
- Relocating `apps/*` into `web/*`.

## 13. Non-goals for the first pilot

- Any external-POS integration.
- Python in the transaction path.
- Native Android applications, unless the pilot venue requires the Waiter Tablet.
- Rewriting working React applications.
- Moving migrations to `database/`.
- Cosmetic repository restructuring.
- Kubernetes or multi-region infrastructure.

## 14. Security and audit expectations

- **Authentication on every non-public endpoint.**
  - Role checks are explicit.
  - Device credentials are venue-scoped and revocable.
  - A revoked device loses access, **including on live realtime connections**. The D12 realtime handler currently fails open on lookup errors; this is a scheduled correction.
- **Tenant isolation** is tested for every aggregate or list endpoint.
- **No secrets, card data or provider credentials** in events, logs or payloads.
- **Every canonical mutation writes an audit record** with actor, venue and time. Core stores already do this.
- **Card data never touches Servvia.** The provider and terminal own card handling.
- **Production and cloud-storage actions** require explicit owner approval.

## 15. Realtime expectations

- **Clients learn about changes** over the Go WebSocket contract (`contracts/realtime/servvia-realtime*`). An event says what changed; clients refetch the details over HTTP.
- **Audiences:** operations, kitchen and financial streams. Authorization is per identity.
- **Delivery:** at most once per connection. A reconnecting client resynchronises over HTTP.
- **Transitional:** the Nest Socket.IO order gateway retires once its clients have migrated.

## 16. Offline and resilience expectations (product level)

- **Core** stays consistent under retries: idempotency keys and version checks are already implemented.
- **Venue Edge** keeps local command durability, so a hardware command is not lost across restarts.
- **Clients** handle network loss without corrupting the record.
- **What each client may do while offline**, especially the Windows POS, is **pending the POS analysis report** (POS) and later product decisions (other clients). Offline behaviour is not invented here.

## 17. Hardware and Venue Edge responsibilities

Venue Edge is the only Servvia component that talks to venue hardware. At planning level it owns:
- local hardware orchestration;
- printer communication (receipts, kitchen);
- cash drawer;
- payment terminal integration;
- local command durability;
- retry and recovery;
- health;
- diagnostics;
- configuration.

Vendors and protocols are not chosen here. They are open requirements (section 24).

## 18. Payments responsibility boundary

- **Core owns:**
  - the financial record (checks, payments, settlement, refunds, reversals);
  - the provider-neutral payment state machine.
- **A payment adapter on Venue Edge owns:**
  - the conversation with the card terminal and provider;
  - reporting results to Core through the internal adapter endpoints.
- **Clients never decide** whether a payment succeeded.
- **Cash payments** are recorded in Core against a shift.
- **Transitional:** the kiosk's Stripe Terminal flow (via Nest) remains until the kiosk migrates.

## 19. Media responsibility

- Promotional and menu media are stored in Google Cloud Storage.
- Upload and administration are **TRANSITIONAL in Nest** (`apps/api` media module).
- Core ownership of media is an open requirement: the approved Core structure has no media package (section 24).
- GCS actions in production require owner approval.

## 20. Reporting and analytics direction

- **Operational reporting** comes from Core's canonical record, read through APIs or read models. Service-day sales, tenders and shift cash are needed for the pilot.
- **Analytics, forecasting and AI** live in `data/` (Python):
  - they read data outside the transaction path, never as owners of state;
  - they are not a pilot blocker.

## 21. Transitional systems

| System | Current role | Successor |
|---|---|---|
| NestJS API (`apps/api/`) | Serves every client today | Go Core |
| Prisma (`apps/api/prisma/`) | Migration authority | `database/` (after an approved migration-authority task) |
| Web staff Order Tablet (`apps/admin-console`, tablet mode) | Staff ordering | Waiter Tablet |
| Web KDS of record (`apps/admin-console`, KDS mode) | Kitchen display | Native KDS |
| `apps/window-display` | Signage; also kiosk ordering and a duplicate KDS | Native Window Display and Kiosk; the duplicate KDS retires |
| `apps/admin-console`, `apps/customer-website` | Web apps | `web/admin-console`, `web/customer-website` (MOVE/EVOLVE) |
| Nest Socket.IO gateway | Order realtime | Go realtime |

## 22. Legacy retirement conditions

The rule is: **replacement implemented → callers migrated → behaviour proven → legacy retired.**

| Legacy | Retires when |
|---|---|
| External-POS surfaces in Nest: hand-off, POS sync, connector commands, payment observation, native rounds, the related Admin pages and configuration | The staff ordering surface and order creation run on Core, and no deployed venue uses them |
| Nest printer dispatcher to connector commands | Venue Edge printing is proven |
| Legacy schema (external-POS tables and columns) | The legacy code above is gone, and a migration rehearsal on a production copy passes |
| Each Nest module | Its domain is served by Core and every caller has migrated |
| Transitional web clients | Their native successor is in production at the venues that used them |
| Host-installed legacy services at a venue | The pilot is live; separate production approval |

## 23. Success criteria

- **First usable product:** the full loop in section 10 runs on Core in staging with real clients, and is repeatable from a clean database.
- **Pilot:**
  - the venue completes real service days on Servvia with no external POS;
  - every payment reconciles with the provider;
  - every shift reconciles its cash;
  - no transactional write goes through Nest.
- **Engineering:** CI runs Go integration and race tests on PostgreSQL, and the main branch is green.

## 24. Explicit open requirements

### OPEN REQUIREMENTS — PENDING POS ANALYSIS REPORT

The following are **not specified** and must not be invented. Each is defined by the owner's POS analysis report:

- POS screens
- workflows
- navigation
- table behaviour
- order-entry behaviour
- manager functions
- payments UX
- receipts
- shifts
- cash management
- hardware behaviour
- offline behaviour

### Other open requirements (owner decisions)

| # | Open requirement | Why it matters |
|---|---|---|
| O-1 | Pilot client set: is the Waiter Tablet required for the pilot venue? | Decides whether Android work is on the pilot path |
| O-2 | May NestJS still serve **non-transactional** administration (auth issuance, menu, tables, venues, media, reservations) at pilot time? | Sizes the Core work before the pilot. The recommendation is yes, temporarily, with every transactional write on Core |
| O-3 | Card payment provider and terminal for the pilot (the kiosk uses Stripe Terminal today) | Venue Edge payment adapter |
| O-4 | Pilot venue hardware: printer models and connection, cash drawer, KDS screens | Venue Edge printing and drawer |
| O-5 | Receipt content and legal requirements | Receipts in Core |
| O-6 | Minimum service-day reports for the pilot | Reporting in Core and the Admin Console |
| O-7 | Reservations ownership in Core: there is no reservations domain in the approved Core structure | Requires `fileRestructure.md` change control before implementation |
| O-8 | Media ownership in Core: there is no media package in the approved Core structure | Same |
| O-9 | Inventory: there is no inventory domain in the approved structure; the Admin page uses mock data | Same |
| O-10 | Android SDK, Gradle and minimum-device decisions | Android shared platform |
| O-11 | Where BMAD tooling should read and write planning artifacts (the repository's BMAD skills are configured from `_bmad/`, which is out of scope) | Tooling integration of `docs/planning/` |
