# Servvia: consolidated product requirements

> **Status:** Baseline draft (CC-1), 2026-10-01. **Awaiting owner review.**
> **Architecture authority:** [`fileRestructure.md`](../fileRestructure.md).
> **Sources and conflicts:** [README.md](README.md). Each requirement carries its source tag:
> - `[FR]`: `fileRestructure.md`
> - `[P2]`: `docs/product-requirements.md`
> - `[TOM]`: `docs/target-operating-model.md`
> - `[ADR]`: `docs/adr/0001-servvia-is-the-operational-pos.md`
> - `[DL]`: `docs/decisions-log.md`
> - `[OLD]`: `docs/prd.md`, with its original ID
> - `[MVP]`: `docs/mvp.md`, with its original section
> - `[BR]`: `PRODUCT.md`
> - `[DS]`: `DESIGN.md`
> - `[REPO]`: implemented Servvia Core behaviour, observed in the repository (evidence of existing capability, referenced rather than rebuilt)
> - `[OWNER-QB-2026-10-01]`: the owner's enterprise-quality instruction of 2026-10-01 (Part B). It is not attributed to any older document.
>
> Requirements carried from `[OLD]` are restated without its superseded stack.
>
> **Structure:**
> - **Part A, functional requirements (sections 1–14).** Consolidated from sources; no new requirements.
> - **Part B, Enterprise Quality Bar and non-functional requirements (sections 15–27).** The owner's quality instruction, tied to Servvia's architecture.
>   - Every numeric target in Part B is either inherited, with its source, or marked **OWNER TARGET REQUIRED**.
>   - Policy details that are not yet approved are marked **OWNER DECISION REQUIRED**.
> **Windows POS:** detailed behaviour is **PENDING USER POS ANALYSIS REPORT** (section 12).

## 1. Product definition

- **Servvia is the operational POS** and restaurant platform. Servvia Core records the service day: tables and visits, orders and rounds, kitchen tickets, checks, payments, settlement, refunds, shifts and cash, devices and terminals, promotions, tax, rounding and totals, audit and domain events. `[P2 §1] [TOM §1] [ADR]`
- **There is no external POS.** No canonical concept is shaped around another POS product. `[ADR] [FR]`
- **It serves single-venue and multi-venue operators.** A second venue must be onboardable through configuration, without code changes. `[OLD BG-7] [P2 §7]`

## 2. Principles (binding)

| ID | Principle | Source |
|---|---|---|
| PR-1 | **PostgreSQL holds the canonical record**, behind Go Core. No client or edge process writes it directly. | `[TOM §1] [ADR] [FR]` |
| PR-2 | **Clients are presentation and input only.** No client owns business rules or pricing. | `[TOM §1] [P2 §2]` |
| PR-3 | **The server owns validation:** price, tax, totals, payment state, tenancy, permissions, transitions, idempotency. | `[MVP §2] [TOM §3]` |
| PR-4 | **Never fake success.** No surface reports a payment, kitchen delivery or print it has not confirmed. Delivery states are explicit and independent. | `[MVP §2] [DL] [TOM §6–7]` |
| PR-5 | **Money is stored as integer minor units.** A fractional modifier price is invalid data. | `[DL A]` |
| PR-6 | **The modifier contract is identifier-based.** Clients send product, modifier-group and option IDs, never names. | `[DL B]` |
| PR-7 | **One long-term owner per capability.** Temporary overlap needs a source owner, a target owner, cutover and retirement criteria, and a bounded period. | `[DL]` |
| PR-8 | **Build before cleanup:** replacement → callers migrated → behaviour proven → legacy retired. | `[P2 §2] [FR]` |
| PR-9 | **Externally acknowledged facts are corrected by explicit compensating actions,** never by silent edits. | `[MVP §2]` |
| PR-10 | **No requirement is invented.** Behaviour not specified by the owner is not designed. | `[P2 §2]` |

## 3. Users and actors

| Actor | Needs | Source |
|---|---|---|
| Owner | All financial data, platform configuration, staff access, reports | `[OLD P2] [P2 §3]` |
| Manager / front of house | Reservations, live orders, tables, menu changes; supervision. POS manager functions are pending the POS report | `[OLD P3] [P2 §3]` |
| POS staff / cashier | Run payments and service at the main terminal. Workflow pending the POS report | `[OLD P5] [P2 §3]` |
| Waiter | Staff-operated ordering at the table (Waiter Tablet) | `[FR] [P2 §3]` |
| Kitchen staff | Incoming work in real time; advance it with minimal interaction | `[OLD P4]` |
| Platform administrator | Venues, users, roles, configuration, devices, printers | `[OLD P6]` |
| Customer at a table tablet | Customer-operated table ordering | `[FR] [P2 §3]` |
| Kiosk customer | Self-service ordering, touch-first, no training | `[OLD P1] [P2 §3]` |
| Public website guest | Discover the venue, explore the menu, contact, reserve (and pre-order; open O-18) on mobile and desktop | `[BR] [OLD P1]` |

## 4. Product surfaces

| Surface | Location | Technology | Role | Source |
|---|---|---|---|---|
| Go Core | `services/core-platform/` | Go | Canonical state, REST, realtime, events, workers | `[FR]` |
| Windows POS | `desktop/pos-terminal/` | C# / .NET | Main POS terminal. **Pending POS report** | `[FR]` |
| Waiter Tablet | `android/apps/waiter-tablet/` | Kotlin | Staff-operated mobile POS (predecessor: web staff Order Tablet) | `[FR]` |
| Customer Order Tablet | `android/apps/order-tablet/` | Kotlin | Customer-operated table ordering (new) | `[FR]` |
| Kiosk | `android/apps/kiosk/` | Kotlin | Customer self-service ordering | `[FR]` |
| KDS | `android/apps/kds/` | Kotlin | Kitchen display (transitional of record: admin-console KDS mode) | `[FR]` |
| Window Display | `android/apps/window-display/` | Kotlin | Promotions and signage; also the entrance menu display (`[OLD FR-5]`) | `[FR] [OLD FR-5]` |
| Admin Console | `web/admin-console/` | React + TypeScript | Administration and oversight | `[FR]` |
| Customer Website | `web/customer-website/` | React + TypeScript | Public site | `[FR] [BR]` |
| Landing Page | `web/landing-page/` | React + TypeScript | Public landing page (requirements not yet defined) | `[FR]` |
| Venue Edge | `services/venue-edge/` | Go | Venue hardware and local resilience | `[FR] [TOM §1]` |
| Analytics / AI | `data/` | Python | Outside the transaction path | `[FR]` |

## 5. Domain and system of record

- **The canonical concepts are distinct:**
  - an Order is what was requested;
  - a TableSession is the visit;
  - a KitchenTicket is what the kitchen must prepare;
  - a Check is the obligation;
  - Payment and Settlement record it being satisfied.

  Shift, Terminal and Device complete the set. `[ADR] [P2 §5]`
- **What every order retains:** its Servvia identifier and human-readable number, immutable version, idempotency key, source channel, actor and device identity, correlation ID and audit timestamps. `[TOM §6]`
- **What every payment retains:** provider, provider transaction ID, method and timestamps. `[TOM §6]`
- **During the transition:** NestJS still serves administration and legacy order paths. Each domain moves to Core and its Nest path retires (PR-7, PR-8). `[P2 §6] [FR]`

## 6. Ordering, kitchen and payment requirements

| ID | Requirement | Priority | Source |
|---|---|---|---|
| ORD-1 | **Every accepted order is durably recorded by Core before kitchen fulfilment is released.** One transaction persists the round, its immutable commercial snapshot, its idempotency key, the kitchen tickets and their domain events. | MUST | `[TOM §2] [OLD FR-4.5–4.6]` |
| ORD-2 | Core validates venue, table session, menu availability, modifiers and price, and computes tax and totals server-side. | MUST | `[TOM §3]` |
| ORD-3 | A repeated submission with the same idempotency key returns the original result and creates no duplicate. | MUST | `[MVP 9.1] [TOM §7]` |
| ORD-4 | Missing menu or station configuration blocks submission with a stable error and a reconciliation task. | MUST | `[MVP 9.1]` |
| ORD-5 | An order carries its table, source and line/modifier context, and opens or joins a check. | MUST | `[OLD FR-4.8] [TOM §3]` |
| KIT-1 | **Servvia owns KDS and KOT routing.** Routing is line-level, using the station configuration effective at submission; one round may produce several station tickets. | MUST | `[TOM §5] [OLD FR-4.7] [MVP 9.5]` |
| KIT-2 | KDS and each printer have independent delivery states; neither implies payment success. | MUST | `[TOM §6]` |
| KIT-3 | Orders appear on the KDS in real time (target under 3 s from submission). | MUST | `[OLD FR-6.2, NFR-1.4]` |
| KIT-4 | A KDS ticket shows order ID, table, time, items with quantities and modifiers, and notes. Staff advance it through its states. | MUST | `[OLD FR-6.3–6.4]` |
| KIT-5 | A visual and audible alert when an order is ready; age colour-coding with a configurable threshold. | SHOULD | `[OLD FR-6.5–6.6]` |
| KIT-6 | The KDS keeps showing received tickets during a backend outage and reconnects automatically. | MUST | `[OLD FR-6.9, NFR-4.3]` |
| PAY-1 | **In-person flow:** kitchen preparation may begin before payment; the check shows unpaid until a payment is recorded. Payment is by card (through Venue Edge) or by cash within a shift. | MUST | `[TOM §3] [MVP 9.2]` |
| PAY-2 | **Online/prepaid flow:** a pending order with an immutable price snapshot. Payment is verified server-side (status, currency, amount, merchant/venue binding, replay protection) before release to KDS/KOT. A failed, cancelled or abandoned payment releases nothing unless an approved "prepare before payment" policy exists. | MUST (where online payment is enabled) | `[TOM §4] [OLD FR-4.16] [MVP 9.2]` |
| PAY-3 | Payment amount and currency equal the server-computed total. One provider payment cannot create more than one order. Signed webhook replay is idempotent. Missing provider configuration fails closed in production. | MUST | `[MVP 9.2]` |
| PAY-4 | Payment implementation is provider-neutral. Provider-specific fields live in adapter metadata. | MUST | `[TOM §8] [P2 §18]` |
| PAY-5 | No raw card data enters Servvia. | MUST | `[TOM §4] [OLD FR-4.9]` |
| PAY-6 | An uncertain terminal or printer outcome is reconciled before any retry that could duplicate a charge or ticket. An online payment that succeeds before a later failure is never charged again. | MUST | `[TOM §7]` |
| PAY-7 | Partial and full refunds. | MUST | `[TOM §9] [P2 §8]` |
| REC-1 | Receipts: content and NZ receipt and tax-invoice obligations are **open** (O-5). Print content for orders includes order ID, table, items with modifiers, instructions, time and venue. | MUST | `[DL] [OLD FR-8.10]` |

## 7. Administration, menu, reservations and reporting

| ID | Requirement | Priority | Source |
|---|---|---|---|
| MENU-1 | CRUD for categories (name, sort order, active) and items (title, description, integer-cent price, category, sub-category, availability, spicy flag, sort order), from the Admin Console only. | MUST | `[OLD FR-3.1–3.2]` |
| MENU-2 | Structured nutrition and allergens per item: calories, protein, carbohydrates, fat; allergens from a fixed list. Allergens are shown during browsing on ordering surfaces. | MUST | `[OLD FR-3.3, FR-4.15]` |
| MENU-3 | Item images: upload, replace, remove. Server-side type validation (content, not extension) and a maximum upload size (default 10 MB). Conversion to an efficient web format. | MUST (conversion SHOULD) | `[OLD FR-3.4–3.5, NFR-2.13]` |
| MENU-4 | Items are venue-scoped, or shared across an organization with venue overrides (price, availability). | MUST | `[OLD FR-3.7]` |
| MENU-5 | Modifier groups with required flag, minimum and maximum selections, and options with price deltas (identifier-based, PR-6). | SHOULD | `[OLD FR-3.8] [DL B]` |
| MENU-6 | **The availability toggle takes effect immediately on every customer-facing surface,** with no rebuild or cache flush. Historical orders stay intact. | MUST | `[OLD FR-3.9–3.10]` |
| AVL-1 | An availability change ("86") propagates to Servvia channels. Each channel shows its own state, partial failure creates a recovery action, and propagation p95 is under 30 s. The exact channels are open (O-17). | MUST (pilot) | `[MVP 9.3]` |
| TBL-1 | Table configuration per venue: number, name, seating capacity. | MUST | `[OLD FR-7.8]` |
| STF-1 | Staff management: add and remove staff, assign roles, reset credentials. | MUST | `[OLD FR-7.12] [P2 §9]` |
| VEN-1 | Venue settings: name, address, timezone, operating hours, capacity. A multi-venue switcher for users with access to several venues. | MUST | `[OLD FR-7.13, FR-7.16]` |
| ADM-1 | Admin Console views: reservations (list, filter, search, confirm, cancel, no-show) and live orders with status. | MUST | `[OLD FR-7.5–7.6]` |
| ADM-2 | Printer management: add, remove, test, monitor; view the job queue; retry failed jobs; reprint any job; a test print per printer. | MUST | `[OLD FR-7.10, FR-8.6, FR-8.8]` |
| ADM-3 | Daily-email settings: recipient, schedule, manual send. | MUST | `[OLD FR-7.14]` |
| RES-1 | Online reservations through the existing booking journey. Fields as currently captured. Server-generated, collision-checked booking reference. Lifecycle: pending → confirmed → seated → completed / cancelled / no-show. Venue-scoped. | MUST | `[OLD FR-2.1–2.5, 2.14]` |
| RES-2 | Confirmation and cancellation emails to the guest and to a configured venue address. | MUST | `[OLD FR-2.6]` |
| RES-3 | Capacity limits per time slot from venue settings, enforced without overbooking under concurrency. | SHOULD (concurrency MUST for pilot) | `[OLD FR-2.13] [MVP 9.7]` |
| RES-4 | Calendar sync and card payment for reservations. | SHOULD; **open** (O-16) | `[OLD FR-2.7–2.8, 2.12]` |
| RES-5 | A daily reservation summary email at a configured time. | SHOULD | `[OLD FR-2.11]` |
| RPT-1 | Daily sales (revenue, order count, average order value, top items); reservation report (covers, no-show rate, lead time); weekly and monthly summaries; CSV export; venue-scoped. | SHOULD (venue scope MUST) | `[OLD FR-10, FR-7.11]` |
| RPT-2 | The service-day reporting minimum needed to close a day at the pilot is **open** (O-6). | MUST (pilot) | `[P2 §11]` |

## 8. Customer-facing devices and web

| ID | Requirement | Priority | Source |
|---|---|---|---|
| KSK-1 | The kiosk is touch-first: browse by category with photos and descriptions, a cart, table selection, then submit. | MUST | `[OLD FR-4.2–4.4]` |
| KSK-2 | A confirmation screen (reference, estimated wait). Return home after a configurable idle timeout (default 3 minutes). | MUST | `[OLD FR-4.11–4.12]` |
| KSK-3 | Touch targets of at least 48 px; no hover-dependent interactions; contrast and readability at kiosk distance. | MUST | `[OLD FR-4.13–4.14, NFR-5.2]` |
| KSK-4 | **Restricted offline:** a non-payment draft may be preserved, but submission requires durable acceptance by Core (or Venue Edge). Otherwise the order is blocked and explained. No card data is stored or queued. | MUST | `[OLD FR-4.9, NFR-4.1]` |
| KSK-5 | A staff PIN unlocks a kiosk management overlay without exposing administration. | SHOULD | `[OLD FR-4.17]` |
| WD-1 | Entrance menu display: read-only; full menu with images, prices, dietary information and availability; auto-refresh (default 60 s); no ordering; promotional banner configurable from Admin; shows the last menu while offline; locked-down kiosk mode. | MUST (banner and lockdown SHOULD) | `[OLD FR-5.1–5.7]` |
| WEB-1 | The public site keeps its established journeys (`/`, `/menu`, `/book`, `/about`, `/contact`). The handling of visual refinement versus a pixel freeze is **open** (O-14). | MUST | `[OLD FR-1.1, NFR-8] [DS] [BR]` |
| WEB-2 | The public site reads the live menu and availability, and creates reservations through Servvia APIs. No static or local fallbacks. | MUST | `[OLD FR-1.2, NFR-8.3]` |
| WEB-3 | No administration route is served from the public site. The daily-email administration moves to the Admin Console. | MUST | `[OLD FR-1.3–1.4, NFR-9.2]` |
| WEB-4 | Brand and design follow `[BR]` and `[DS]`. Accessibility: WCAG 2.1 AA contrast and keyboard support, visible focus, reduced motion, touch targets of at least 44 px, body text of at least 16 px. | MUST | `[BR] [DS]` |
| WEB-5 | Public online ordering or pre-ordering scope is **open** (O-18). | — | `[BR] [OLD FR-2.3] [TOM §4]` |

## 9. Venue Edge and hardware

| ID | Requirement | Priority | Source |
|---|---|---|---|
| EDGE-1 | **Venue Edge owns local hardware and resilience:** printers, payment terminals, cash drawers, customer displays, offline command queue, sync, retry and diagnostics. It is never an independent source of business truth. | MUST | `[TOM §1] [P2 §17]` |
| EDGE-2 | Outbound-only authenticated communication. A revocable, venue-bound identity. Encrypted local storage. A durable local queue with leases, idempotent reports, an explicit `unknown` outcome, and expiry. No direct database or shared Redis access. | MUST | `[TOM §8] [MVP 9.4]` |
| EDGE-3 | The local queue survives process and machine restart. Internet loss loses or duplicates nothing. Reconnect preserves order and idempotency. Heartbeat, versions, queue depth and oldest age are visible. | MUST | `[MVP 9.4]` |
| PRT-1 | Multiple named printers per venue with role, connection and paper width. Station routing per KIT-1. Each KOT prints once per station; reprints are explicit and attributed. Printed acknowledgement is distinct from command delivery. | MUST | `[OLD FR-8.1–8.2] [MVP 9.5]` |
| PRT-2 | Failed jobs retry with backoff to a configurable maximum, then enter `failed` with an Admin alert. Each job is logged (ID, order, printer, attempts, status, times, error). If the printer is unreachable, the order is still accepted and the job queued. | MUST | `[OLD FR-8.4–8.7, FR-4.10]` |
| PRT-3 | Print protocol and hardware are **open** (O-4). Latency is validated on real venue hardware (target under 3 s). | MUST | `[OLD FR-8.9, NFR-1.3] [MVP 9.5]` |

## 10. Non-functional requirements

| ID | Requirement | Source |
|---|---|---|
| NFR-PERF | Read API P95 under 200 ms; order submission P95 under 500 ms (excluding printing); Admin initial load under 2 s on 10 Mbps; kiosk navigation under 1 s. | `[OLD NFR-1]` |
| NFR-SEC-1 | Admin served from an origin separate from the public site. Server-side authentication before any admin bundle loads. RBAC enforced per endpoint server-side. | `[OLD NFR-2.1–2.3, 2.6, NFR-9]` |
| NFR-SEC-2 | Passwords hashed with bcrypt (cost of at least 12) or Argon2id. TLS 1.2 or higher. Input validation on every endpoint. Parameterised queries. No unsafe HTML. Login rate limit (10 attempts per IP per 15 minutes). Secrets never committed. | `[OLD NFR-2.4–2.12]` |
| NFR-SEC-3 | **Tenant and venue scope at every boundary,** taken from the verified credential. Cross-tenant tests cover REST, WebSockets, files and background jobs. Device credentials are venue-scoped and revocable, including on live realtime connections. | `[MVP 2, 9.6] [P2 §7, §14]` |
| NFR-AUD | **Every pilot-critical mutation emits an append-only, correlated audit record** (actor, action, before and after, time). Searchable by actor, entity, date and action. Retained for at least 90 days. | `[OLD NFR-7] [MVP 9.6] [P2 §14]` |
| NFR-REL | Target uptime 99.5% a month. Daily backups retained 30 days, with restore rehearsed against declared RPO/RTO. Health checks reflect real dependencies. Retry and dead-letter handling with admin alerting. Alerts on stuck orders, edge heartbeat, dead-letter age, payment reconciliation and API errors. | `[OLD NFR-6] [MVP 9.7]` |
| NFR-RT | Realtime: event notification over WebSocket; clients refetch details over HTTP and resynchronise after reconnect. | `[P2 §15]` |
| NFR-OFF | **Product-level offline:** Core stays consistent under retries; Edge keeps durable local commands; clients survive network loss without corrupting the record. Per-client offline behaviour beyond KSK-4, KIT-6 and WD-1 is open; for the Windows POS it is pending the POS report. | `[P2 §16] [OLD NFR-4]` |
| NFR-A11Y | Admin Console meets WCAG 2.1 AA, including screen-reader support. | `[OLD NFR-5.1, 5.3]` |
| NFR-DATA | All operational data lives in PostgreSQL; media in Google Cloud Storage. No third-party database adapters or duplicate maintenance processes. | `[OLD NFR-10.2–10.3] [FR]` |

## 11. Milestones and acceptance

- **First usable product** (staging, entirely on Go Core, no Nest transactional path):
  - staff sign-in;
  - visit open;
  - orders and rounds;
  - kitchen tickets on the KDS;
  - check;
  - cash settlement;
  - visit close;
  - shift open and close;
  - refund.

  `[P2 §10]`
- **FIRST INDEPENDENT SERVVIA PILOT:** a real venue runs its service days on Servvia, with no external POS, in production, with venue hardware: card terminal, receipt and kitchen printing, cash drawer. `[P2 §11]`
- **Release acceptance (no venue go-live without these):**
  - correct pricing and tax;
  - no duplicate charges;
  - no duplicate KOTs;
  - ordered replay after restart or outage;
  - station routing;
  - payment reconciliation;
  - partial and full refunds;
  - device revocation;
  - audit correlation;
  - staff-visible recovery for every failure state.

  Moving a live venue onto Servvia is a separate operations decision. `[TOM §9]`
- **Pilot acceptance criteria** are the consistent subset of `[MVP]` sections 9.1, 9.2, 9.4, 9.5, 9.6 and 9.7, as restated in ORD, PAY, EDGE, PRT and NFR above. Section 9.3 is restated as AVL-1. `[MVP §9]`
- **Engineering:** unit, database-integration and critical device-journey tests in CI; concurrency tests show no overbooking or number collision; queue-failure, provider-timeout, Redis-outage and reconnect tests pass. `[MVP 9.7] [P2 §23]`

## 12. OPEN REQUIREMENTS — PENDING USER POS ANALYSIS REPORT

**Not specified and must not be invented:**
- Windows POS screens
- workflows
- navigation
- table behaviour
- order-entry behaviour
- manager functions
- payments UX
- receipts (POS behaviour)
- shifts
- cash management
- hardware behaviour
- offline behaviour

Stories that need any of these are **BLOCKED** until the report exists. `[P2 §24] [FR §5]`

## 13. Deferred and non-goals

- **Not in the first pilot:**
  - external-POS integration;
  - Python in the transaction path;
  - native Android apps (unless O-1 says otherwise);
  - rewriting working React apps;
  - moving migrations to `database/`;
  - cosmetic restructuring;
  - Kubernetes or multi-region.

  `[P2 §13]`
- **Deferred until later phase gates:**
  - material, recipe and production management;
  - procurement;
  - finance subledger;
  - BI forecasting;
  - CRM and loyalty;
  - workforce;
  - enterprise SSO/SCIM;
  - floor-plan editor.

  `[MVP 8.3] [OLD FR-7.9]`
- **Inventory** has no domain in the approved structure (O-9).

## 14. Open owner decisions

O-1 to O-11 come from `[P2 §24]`. O-12 to O-18 come from the conflicts in [README.md](README.md).

| ID | Decision |
|---|---|
| O-1 | Is the Waiter Tablet required for the pilot venue? |
| O-2 | May Nest serve non-transactional administration at pilot time? |
| O-3 | In-person card provider and terminal (also open in `[DL]`) |
| O-4 | Pilot printers, cash drawer and KDS hardware; print protocol |
| O-5 | Receipt content and NZ receipt and tax-invoice obligations (also open in `[DL]`) |
| O-6 | Minimum service-day reports for the pilot |
| O-7 | Reservations ownership in Core (no domain in the approved structure) |
| O-8 | Media ownership in Core (no package in the approved structure) |
| O-9 | Inventory (no domain in the approved structure) |
| O-10 | Android SDK and Gradle decisions |
| O-11 | Superseded by CC-1: the fresh official BMAD is installed after `PRD/` approval |
| O-12 | Commercial target customer for Servvia as the POS (C-1) |
| O-13 | KDS device authentication versus the old "no-auth KDS" requirement (C-3) |
| O-14 | Public site: pixel freeze versus `[DS]` visual refinement (C-4) |
| O-15 | Brand naming on public web surfaces: venue brand or Servvia (C-5) |
| O-16 | Reservation calendar sync and reservation card payments (C-6) |
| O-17 | Which Servvia channels count for availability propagation (C-7) |
| O-18 | Public web online ordering or pre-ordering scope (C-8) |
| O-19 | Confirm the inherited numeric performance and availability targets for the Go Core architecture (C-9; section 19) |

---

# Part B: Enterprise Quality Bar and non-functional requirements

## 15. Enterprise Quality Bar

`[OWNER-QB-2026-10-01]`

**Binding rule:** every production capability must meet **all applicable** quality dimensions below before it is considered complete.
- **"Implemented" is not "production ready"** (section 24).
- **Comparable bar:** a mature commercial platform, not an MVP prototype.

**Windows POS:** the bar applies once the POS analysis report has supplied its requirements. It is **not** permission to invent POS requirements now (section 12).

| | Dimension | Servvia requirement | Source |
|---|---|---|---|
| A | Correctness and data integrity | Canonical state changes only through Go Core domain services. Invariants are enforced in the database (unique indexes, checks, version compare-and-set), not only in code. Server pricing is authoritative (section 17). | `[OWNER-QB-2026-10-01]` `[ADR] [REPO]` |
| B | Security | The security standard in section 16 applies to every surface, API, realtime channel, worker and Venue Edge. | `[OWNER-QB-2026-10-01]` `[OLD NFR-2] [MVP 9.6]` |
| C | Privacy and sensitive data | Collect only what a capability needs. No card data enters Servvia (PAY-5). No secrets, credentials or provider references in events, logs, telemetry or error responses. Guest personal data (reservations, contact) is access-controlled and audited. Retention and deletion policy for personal data: **OWNER DECISION REQUIRED**. | `[OWNER-QB-2026-10-01]` `[TOM §4] [P2 §14]` |
| D | Authorization and tenant isolation | Deny by default. Scope comes from the verified credential, never from client-supplied identifiers. Organization- and venue-scoped access is tested for every list or aggregate endpoint, realtime channel, file and background job. | `[OWNER-QB-2026-10-01]` `[MVP 9.6] [P2 §7] [REPO]` |
| E | Reliability and availability | Availability target (section 19). Health and readiness reflect real dependencies. No single client action can corrupt canonical state. | `[OWNER-QB-2026-10-01]` `[OLD NFR-6]` |
| F | Resilience and graceful degradation | Dependency failures degrade explicitly and visibly; nothing fails silently or fabricates success (PR-4). Section 18. | `[OWNER-QB-2026-10-01]` `[TOM §7] [MVP §2]` |
| G | Performance and responsiveness | Measured against the dimensions in section 19, with inherited targets kept and missing ones owner-set. | `[OWNER-QB-2026-10-01]` `[OLD NFR-1]` |
| H | Scalability and capacity | Capacity is planned for venues, devices, concurrent users and throughput (section 19). Adding a venue is configuration, not code. | `[OWNER-QB-2026-10-01]` `[OLD BG-7, NFR-3]` |
| I | Concurrency safety | Concurrent commands on the same aggregate are serialised by row locks or version checks. Proven with concurrency tests on real PostgreSQL. | `[OWNER-QB-2026-10-01]` `[REPO]` |
| J | Idempotency | Every externally retried command carries an idempotency key. A retry returns the original result and duplicates nothing (ORD-3). | `[OWNER-QB-2026-10-01]` `[TOM §7] [MVP 9.1] [REPO]` |
| K | Transaction integrity | A change, its audit record and its domain event commit in one transaction or not at all. | `[OWNER-QB-2026-10-01]` `[TOM §2] [REPO]` |
| L | Observability | Section 20. | `[OWNER-QB-2026-10-01]` |
| M | Auditability | Every security-sensitive and financially significant mutation is attributable, correlated, append-only, searchable and retained (NFR-AUD). | `[OWNER-QB-2026-10-01]` `[OLD NFR-7] [MVP 9.6]` |
| N | Error handling | Stable, documented error contracts. Safe messages with no sensitive leakage. Every failure state is visible to staff with a recovery path. | `[OWNER-QB-2026-10-01]` `[TOM §9]` |
| O | Disaster recovery and restore | Restore is rehearsed against declared RPO/RTO. **RPO/RTO values: OWNER TARGET REQUIRED.** | `[OWNER-QB-2026-10-01]` `[MVP 9.7]` |
| P | Backup and data retention | Daily backups retained 30 days (inherited). Audit retained at least 90 days (inherited). Other retention periods: **OWNER DECISION REQUIRED**. | `[OWNER-QB-2026-10-01]` `[OLD NFR-6.2, NFR-7.4]` |
| Q | Deployment and rollback safety | Every release is reversible or has a documented forward-fix path. Migrations follow the published-migration rules (never renamed or rewritten; ordered). A schema change is deployed so that running code stays correct. | `[OWNER-QB-2026-10-01]` `[FR rules 9–10]` |
| R | Configuration and secrets | One documented configuration contract per service. Production refuses development defaults. Secrets are externally managed and never committed or logged. | `[OWNER-QB-2026-10-01]` `[OLD NFR-2.12] [MVP 9.6]` |
| S | Dependency and supply chain | Dependencies are pinned through lockfiles and module checksums, and scanned for known vulnerabilities. Vulnerability remediation timelines: **OWNER DECISION REQUIRED**. | `[OWNER-QB-2026-10-01]` |
| T | Compatibility and upgrade | APIs and events are versioned through `contracts/`. Breaking changes are explicit and coordinated with clients and Venue Edge. Edge and device upgrade, revocation and compatibility are managed. | `[OWNER-QB-2026-10-01]` `[MVP P2] [DL]` |
| U | Maintainability | Code lives in its `fileRestructure.md` owner. One long-term owner per capability (PR-7). Architecture guard tests stay green. | `[OWNER-QB-2026-10-01]` `[FR] [DL] [REPO]` |
| V–AA | Testing (automated, integration, contract, end-to-end, load and performance, security) | Section 21. | `[OWNER-QB-2026-10-01]` |
| AB | Accessibility | Section 23. | `[OWNER-QB-2026-10-01]` |
| AC | UX quality | Section 22. | `[OWNER-QB-2026-10-01]` |
| AD | Visual consistency | Public web follows `[DS]`. A consistent design language across each product family (Android `core/design-system`, Admin Console). Product-family design standards: **OWNER DECISION REQUIRED**. | `[OWNER-QB-2026-10-01]` `[DS] [FR]` |
| AE | Device, offline and reconnect | Defined per surface in sections 8, 9 and 18. Windows POS: **PENDING USER POS ANALYSIS REPORT**. | `[OWNER-QB-2026-10-01]` |
| AF | Operational documentation | Runbooks for deploy, rollback, incident, restore, end of day and Edge installation exist before production. | `[OWNER-QB-2026-10-01]` `[MVP P2]` |
| AG | Support and diagnostics | Staff-visible recovery for every failure state. Edge and device diagnostics (heartbeat, versions, queue depth, oldest age). Support access is itself authorized and audited. | `[OWNER-QB-2026-10-01]` `[TOM §9] [MVP 9.4]` |
| AH | Release acceptance | Section 24, including the go-live tests in section 11. | `[OWNER-QB-2026-10-01]` `[TOM §9]` |

## 16. Security standard

`[OWNER-QB-2026-10-01]` Applies wherever relevant. No specific security product is prescribed.

1. **Least privilege** for users, devices, services, workers and Venue Edge.
2. **Deny-by-default authorization**, enforced server-side for every endpoint and realtime subscription. Client-side routing is never the security boundary. `[OLD NFR-2.2, 2.6] [REPO]`
3. **Strict organization and venue isolation**, with the scope taken from the verified credential. `[MVP 9.6] [P2 §7]`
4. **Secure authentication and session lifecycle:**
   - expiry and refresh;
   - logout;
   - passwords hashed with bcrypt (cost of at least 12) or Argon2id;
   - login attempts rate-limited to 10 per IP per 15 minutes.

   `[OLD NFR-2.4, 2.10]`
5. **Rotation and revocation of credentials.** Revoked credentials stop working immediately, including on live connections. `[MVP 9.6] [REPO]`
6. **Device identity and revocation:** venue-bound device credentials, rotatable and revocable (Core D8). Venue Edge has a revocable venue-bound identity. `[REPO] [TOM §8]`
7. **Secrets** are externally managed and never in source control, logs, telemetry or error responses. `[OLD NFR-2.12]`
8. **Input validation** on every endpoint and message; **output encoding** where content is rendered. `[OLD NFR-2.7, 2.9]`
9. **CSRF and CORS protections** where browsers are clients; no wildcard credentials. `[REPO]`
10. **Rate limiting and abuse resistance** on authentication and other abuse-prone endpoints. `[OLD NFR-2.10] [REPO]`
11. **Replay and idempotency protection** for commands, provider webhooks and Edge reports. `[MVP 9.2] [TOM §8]`
12. **Secure WebSocket authorization:**
    - authorization at subscribe time;
    - periodic revalidation;
    - **fail closed** when a credential cannot be verified.

    The known D12 fail-open defect must be corrected before production. `[REPO]`
13. **Audit logging** of security-sensitive operations: authentication, permission changes, device enrolment and revocation, configuration changes. `[OLD NFR-7.1]`
14. **Dependency vulnerability management** (section 15, row S).
15. **Secure production configuration:** TLS 1.2 or higher; production refuses development defaults; separate admin origin. `[OLD NFR-2.5, NFR-9]`
16. **Safe error responses** with no stack traces, internal identifiers or sensitive data.

## 17. Data and financial integrity

`[OWNER-QB-2026-10-01]` These requirements cover orders, checks, payments, refunds, settlements, shifts and cash.

**Proven Core behaviour, referenced and not rebuilt:**
- idempotency keys per command;
- version compare-and-set and row locks;
- unique-index invariants;
- the audit record and domain event written in the same transaction;
- the provider-neutral payment result state machine;
- refund capacity checks;
- shift count and variance.

`[REPO]`

1. **Atomic state transitions.** Every financial transition is one transaction with its audit and event. `[TOM §2] [REPO]`
2. **Explicit invariants**, documented per aggregate and enforced in the database where expressible. For example:
   - a check's total equals the sum of its lines;
   - refunds never exceed the captured amount;
   - one settlement per check cycle.

   `[REPO]`
3. **Concurrency safety** (section 15, row I).
4. **Idempotent command handling** (section 15, row J).
5. **Immutable evidence:** order commercial snapshots and financial records are never edited; they are corrected only by compensating records (PR-9). `[TOM §2] [MVP §2]`
6. **No silent loss of committed operations.** Committed events are delivered at least once to each consumer; failures are dead-lettered and visible. `[REPO]`
7. **Deterministic pricing authority:** the same inputs always produce the same server-computed price, tax and totals. `[TOM §3]`
8. **Integer minor-unit money** (PR-5). `[DL A]`
9. **Safe retry semantics:** a retry reuses the same key and version, and never duplicates a charge, ticket or refund. `[TOM §7]`
10. **Reconciliation capability:**
    - payments against the provider;
    - cash against the shift;
    - a reconciliation queue for failed, stuck or mismatched items.

    `[TOM §7] [MVP 8.1]`
11. **Traceability** from each user or device action to the resulting state (actor and device identity, correlation ID). `[TOM §6]`
12. **Uncertain external outcomes** (terminal or provider) are held explicitly as uncertain and reconciled before any retry (PAY-6). `[TOM §7–8]`

## 18. Reliability and resilience

`[OWNER-QB-2026-10-01]`

1. **Controlled startup and shutdown.** Services report not-ready until dependencies are ready. On shutdown they stop accepting work, drain in-flight requests and realtime connections, and release worker leases. `[REPO]`
2. **Dependency failure handling.** A failure of the database, Redis, a provider, a printer or the network is detected and surfaced, never masked.
3. **Bounded retries:** retry with bounded backoff and an attempt limit where appropriate (workers, Edge, print). `[OLD FR-8.4] [REPO]`
4. **Redelivery safety:** events and queued commands are safe to redeliver (idempotent consumers and leases). `[REPO]`
5. **Final failure is visible:** dead-lettered or failed work is visible and retryable by an authorized operator. `[OLD FR-8.5] [REPO]`
6. **Reconnect:** realtime clients and Venue Edge reconnect and resynchronise without loss or duplication. `[MVP 9.4] [P2 §15]`
7. **Recovery after restart:** process and device restarts lose no committed or locally acknowledged work. `[MVP 9.4]`
8. **No corruption after interrupted operations.** An interrupted transaction leaves no partial state. `[TOM §2]`
9. **Venue and network degradation** is handled per surface (KSK-4, KIT-6, WD-1, EDGE-3). Windows POS: **PENDING USER POS ANALYSIS REPORT**.
10. **Health and readiness checks** reflect real dependencies. `[OLD NFR-6.5]`
11. **Production alertability:** alerts for stuck orders, Edge heartbeat, dead-letter age, payment reconciliation and API errors. `[MVP 9.7]`

## 19. Performance and scalability

`[OWNER-QB-2026-10-01]` Every dimension must be measured. **Inherited targets are kept with their source; no other number is chosen here.** Explicit performance-validation work must exist in the backlog before production release.

| Dimension | Approved target | Source | Status |
|---|---|---|---|
| API read latency | P95 under 200 ms under normal load | `[OLD NFR-1.1]` | Inherited; owner to confirm (C-9) |
| Order submission latency | P95 under 500 ms end to end, excluding printing | `[OLD NFR-1.2]` | Inherited; owner to confirm (C-9) |
| Kitchen-ticket propagation to the KDS | under 3 s from submission | `[OLD FR-6.2, NFR-1.4]` | Inherited; owner to confirm (C-9) |
| Print latency | under 3 s from submission to printer, validated on venue hardware | `[OLD NFR-1.3] [MVP 9.5]` | Inherited; hardware open (O-4) |
| Availability ("86") propagation | p95 under 30 s | `[MVP 9.3]` | Inherited |
| Admin Console initial load | under 2 s on 10 Mbps | `[OLD NFR-1.5]` | Inherited; owner to confirm (C-9) |
| Kiosk navigation | under 1 s per page | `[OLD NFR-1.6]` | Inherited; owner to confirm (C-9) |
| Service availability | 99.5% a month, excluding planned maintenance | `[OLD NFR-6.1]` | Inherited; owner to confirm (C-9) |
| General realtime propagation (other events) | — | — | **OWNER TARGET REQUIRED** |
| Menu and query performance (public menu, channel menu) | — | — | **OWNER TARGET REQUIRED** |
| Concurrent users and devices per venue | — | — | **OWNER TARGET REQUIRED** |
| Venue count | — | — | **OWNER TARGET REQUIRED** |
| Transaction throughput (orders and payments at peak) | — | — | **OWNER TARGET REQUIRED** |
| Database query behaviour (slow-query budget, plan regressions) | — | — | **OWNER TARGET REQUIRED** |
| Memory and CPU utilisation per service | — | — | **OWNER TARGET REQUIRED** |
| Reconnect storms (many devices reconnecting at once) | — | — | **OWNER TARGET REQUIRED** |
| Event and worker backlog (oldest pending age, depth) | — | — | **OWNER TARGET REQUIRED** |
| Android app responsiveness | — | — | **OWNER TARGET REQUIRED** |
| Windows POS responsiveness | — | — | **OWNER TARGET REQUIRED**; behaviour **PENDING USER POS ANALYSIS REPORT** |
| Website performance (public site, landing page) | — | — | **OWNER TARGET REQUIRED** |

## 20. Observability

`[OWNER-QB-2026-10-01]`

1. **Structured logs** with request and correlation IDs propagated across Core, workers, realtime and Venue Edge. Core already emits request IDs and an access log. `[REPO] [TOM §6]`
2. **Event traceability** from a command to its domain events, deliveries and device effects (correlation IDs). `[TOM §6]`
3. **Metrics:** latency and errors per endpoint; realtime subscribers and slow-consumer closes; database pool and query health; queue and backlog depth and oldest age; worker success, retry and dead-letter rates. `[MVP 9.4, 9.7] [REPO]`
4. **Service and worker health:** liveness, readiness and worker backlog are exposed. Core's organization-scoped worker backlog exists; a platform-level operator view is required. `[REPO]`
5. **Device and Edge diagnostics:** heartbeat, versions, queue depth, oldest queued age. `[MVP 9.4]`
6. **Audit events** (NFR-AUD).
7. **Actionable alerts** for critical production signals (section 18, item 11). **Alert thresholds: OWNER TARGET REQUIRED.**
8. **Dashboards** for critical production signals.
9. **No sensitive information in telemetry:** no secrets, card data, credentials or unnecessary personal data.

## 21. Test quality

`[OWNER-QB-2026-10-01]`

- **Tests validate behaviour and invariants, not coverage.** No coverage percentage is set; none is approved.
- **Tests are deterministic where practical.**
- **Database and integration tests run on disposable environments.** For Go Core: disposable PostgreSQL in UTC, as Core already does. `[REPO]`

| Test type | Required for | Notes |
|---|---|---|
| Unit | every component | `[REPO]` (Core packages) |
| Integration | services and clients against real dependencies | |
| PostgreSQL integration | Core and any database-touching code | `[REPO]`; disposable, UTC |
| Contract | every API, event and realtime contract in `contracts/` | `[REPO]` (Core contract tests) |
| Concurrency | every aggregate with concurrent commands; race detector for Go | `[REPO] [MVP 9.7]` |
| Realtime | subscription authorization, delivery, reconnect, slow consumers | `[REPO]` |
| Failure and recovery | provider timeout, queue failure, Redis outage, reconnect, restart, dead letters | `[MVP 9.7] [REPO]` |
| Security | authorization matrices, tenant isolation, revocation, injection and abuse cases | `[MVP 9.6]` |
| End-to-end | critical device and browser journeys | `[MVP 9.7]` |
| Device and hardware integration | Venue Edge with real printers, drawers and terminals | `[MVP 9.5]` |
| Performance and load | the section 19 dimensions | `[OWNER-QB-2026-10-01]` |
| Migration | from zero, upgrade from the previous release, drift check | `[REPO]` |
| Upgrade and rollback | service, client and Edge version compatibility | `[OWNER-QB-2026-10-01]` |
| Smoke | every deployment | `[OWNER-QB-2026-10-01]` |
| Acceptance | milestone and go-live criteria (section 11) | `[TOM §9]` |

## 22. UX and product quality

`[OWNER-QB-2026-10-01]`

**User-facing applications must be:**
- intuitive, fast, consistent and responsive;
- accessible and predictable;
- forgiving of recoverable mistakes;
- explicit about destructive and financial actions;
- clear when an operation is pending, failed, uncertain or offline;
- keyboard- or touch-appropriate for their device;
- visually coherent across the product family.

**Production-critical workflows contain no prototype or mock behaviour.** A feature is not complete because its UI exists. `[MVP §1]`

**Every applicable screen provides these states:**
- loading;
- empty;
- validation;
- error;
- retry and recovery;
- offline or degraded;
- permission denied;
- confirmation for destructive or financially significant operations;
- clear success feedback.

KDS and printer delivery states are shown truthfully (KIT-2, PR-4).

**Windows POS:** detailed UX is **PENDING USER POS ANALYSIS REPORT**. No screens or workflows are defined here.

## 23. Accessibility

`[OWNER-QB-2026-10-01]` Accessibility is a production requirement for every user-facing surface. It covers:
- semantic structure;
- keyboard access where applicable;
- screen-reader compatibility where applicable;
- sufficient contrast;
- visible focus;
- scalable text;
- understandable error feedback;
- touch targets suited to touch devices.

| Surface | Approved conformance and targets | Source |
|---|---|---|
| Admin Console | WCAG 2.1 AA, including screen-reader support | `[OLD NFR-5.1, 5.3]` |
| Customer Website | WCAG 2.1 AA contrast and keyboard; visible focus; reduced motion; touch targets of at least 44 px; body text of at least 16 px | `[BR] [DS]` |
| Kiosk | touch targets of at least 48×48 px; contrast of at least 4.5:1; readable at 600 mm | `[OLD NFR-5.2]` |
| Landing Page | **OWNER TARGET REQUIRED** | — |
| Waiter Tablet, Customer Order Tablet, KDS, Window Display (Android) | **OWNER TARGET REQUIRED** | — |
| Windows POS | **OWNER TARGET REQUIRED**; detail **PENDING USER POS ANALYSIS REPORT** | — |

## 24. Release and production readiness

`[OWNER-QB-2026-10-01]`

**"Implemented" is not "production ready".** A production capability must satisfy every applicable gate, each with **explicit release evidence** (test reports, review records, rehearsal logs) rather than informal confidence:

1. architecture compliance (`fileRestructure.md` ownership, no second canonical owner);
2. security review;
3. tests passing (section 21);
4. migrations verified (from zero, upgrade, drift);
5. rollback and recovery verified;
6. observability present (section 20);
7. operational documentation present (section 15, row AF);
8. secrets and configuration verified;
9. load and performance acceptance (section 19);
10. failure-mode testing;
11. data-integrity validation (section 17);
12. UX acceptance (section 22);
13. accessibility acceptance (section 23);
14. pilot and go-live acceptance (section 11, `[TOM §9]`);
15. no unresolved release-blocking defects (section 25).

## 25. Defect severity and release-blocking policy

`[OWNER-QB-2026-10-01]`

- **Production readiness requires a defined defect-severity and release-blocking policy.**
- **The policy must at least distinguish release-blocking from non-blocking defects.**
- **Severity levels, definitions and response expectations: OWNER DECISION REQUIRED.**

## 26. Definition of Done input for BMAD

`[OWNER-QB-2026-10-01]`

- **The fresh BMAD setup must derive its Definition of Done and story acceptance standards from this Enterprise Quality Bar** (sections 15–25).
- **A story is not DONE solely because code exists.** The applicable quality obligations are part of completion.
- **Non-functional requirements must not be omitted** because they are cross-cutting. Depending on the official BMAD workflow, they appear as one of:
  - acceptance criteria;
  - dedicated stories;
  - technical enablers;
  - release gates.

## 27. Non-functional requirements matrix

| Quality dimension | Requirement | Current approved target | Source | Validation method | Status / open decision |
|---|---|---|---|---|---|
| Security | Section 16 standard on every surface and channel | bcrypt cost of at least 12 or Argon2id; TLS 1.2 or higher; login limited to 10 per IP per 15 minutes | `[OLD NFR-2]` `[OWNER-QB-2026-10-01]` | Security review, security tests | Vulnerability remediation timelines: OWNER DECISION REQUIRED |
| Tenant isolation | Scope from the verified credential; deny by default | — (binary requirement) | `[MVP 9.6] [P2 §7]` | Cross-tenant tests on REST, WebSocket, files, jobs | Required for every list or aggregate endpoint |
| Data integrity | Section 17 invariants, atomicity, idempotency | — (binary requirement) | `[TOM] [DL] [REPO]` | PostgreSQL integration and concurrency tests; reconciliation rehearsal | Invariant catalogue per aggregate to be documented |
| Availability and reliability | Service availability | 99.5% a month | `[OLD NFR-6.1]` | Uptime measurement in production | Owner to confirm (C-9) |
| Performance | Section 19 dimensions | Inherited figures in section 19 | `[OLD NFR-1] [MVP 9.3]` | Load and performance tests before release | Missing targets: OWNER TARGET REQUIRED |
| Scalability | Venues, devices, users, throughput | — | `[OWNER-QB-2026-10-01]` | Load tests at the owner-set capacity | OWNER TARGET REQUIRED |
| Realtime | KDS propagation; general event propagation; fail-closed authorization | KDS under 3 s | `[OLD FR-6.2]` `[OWNER-QB-2026-10-01]` | Realtime tests; latency measurement | General propagation: OWNER TARGET REQUIRED |
| Recovery | Restart, reconnect and disaster recovery | RPO/RTO not set | `[MVP 9.7]` | Restore rehearsal; restart and reconnect tests | RPO/RTO: OWNER TARGET REQUIRED |
| Observability | Logs, correlation, metrics, health, alerts, dashboards | — | `[OWNER-QB-2026-10-01]` `[MVP 9.7]` | Alert drills; dashboard review | Alert thresholds: OWNER TARGET REQUIRED |
| Audit | Append-only, correlated, searchable | Retained at least 90 days | `[OLD NFR-7.4] [MVP 9.6]` | Audit coverage tests | — |
| Testing | Section 21 test pyramid | No coverage % (none approved) | `[OWNER-QB-2026-10-01]` | CI evidence per component | — |
| Accessibility | Section 23 | WCAG 2.1 AA (Admin Console, Customer Website); kiosk 48 px, 4.5:1 | `[OLD NFR-5] [BR]` | Accessibility audit and acceptance | Other surfaces: OWNER TARGET REQUIRED |
| UX | Section 22 states; no mock data in critical flows | — | `[OWNER-QB-2026-10-01]` `[MVP §1]` | UX acceptance per surface | Windows POS: PENDING USER POS ANALYSIS REPORT |
| Deployment safety | Reversible releases; migration rules | — | `[FR]` `[OWNER-QB-2026-10-01]` | Rollback rehearsal; migration tests | — |
| Backup and restore | Daily backups; restore rehearsed | Retained 30 days | `[OLD NFR-6.2] [MVP 9.7]` | Restore rehearsal | Other retention: OWNER DECISION REQUIRED |
| Device and Edge reliability | Durable local queue; no loss or duplication; diagnostics | Print under 3 s on venue hardware | `[TOM §8] [MVP 9.4–9.5] [OLD NFR-1.3]` | Hardware integration tests; outage drills | Hardware open (O-4) |
