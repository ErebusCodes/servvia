# Servvia: consolidated product requirements

> **Status:** Baseline draft (CC-1), 2026-10-01; amended by CC-3 (tablet application consolidation), 2026-10-02. Further changes 2026-10-03: source provenance reconciled (README "Provenance status"); production cutover rule; kitchen printing at the pilot made conditional on venue requirement; O-2 decided (transitional credential issuance); ORD-4 and ORD-5 reworded to canonical Core semantics; PRT-1 source repaired. **APPROVED 2026-10-03 as the normative requirements baseline** (owner gate A; meaning and limits in [README.md](README.md) "Approval"). Amended the same day through controlled change by accepted ADR 0002 (sections 8 and 11). **Amended 2026-10-05 by owner decision:** the former `fileRestructure.md` was consolidated into Part C (sections 28–36) and deleted, and the legacy `apps/kitchen-display/`, `apps/order-tablet/` and `apps/window-display/` directories were removed (section 34.3). **Further owner decision 2026-10-05 (KitchenOS capability scope):** the KitchenOS product capability set is part of Servvia's long-term target product (section 13); delivery phasing remains open (DEC-X-17 in volume 00). **Tier-2 ratification 2026-10-05** `[ORCH-T2-2026-10-05]`: O-20 and O-21 decided (architecture; not owner decisions); O-19 reclassified as a planning baseline without owner confirmation. O-10 (Android engineering baseline) and O-13 (KDS device authentication) recorded as decided the same day through the same Tier-2 ratification (section 14; volume 00 §00.10.7). Volumes 00–09 accepted as the normative corpus baseline under this document (volume 00 §00.1.3).
> **Architecture authority:** this document. Part C (sections 28–36) holds the repository structure, ownership and transition rules formerly in `fileRestructure.md`.
> **Sources and conflicts:** [README.md](README.md). Each requirement carries its source tag:
> - `[FR]`: the former `fileRestructure.md` (change records CC-1 to CC-4), consolidated into Part C on 2026-10-05 and deleted; `[FR §…]` citations resolve through the mapping in section 36.2
> - `[P2]`: `docs/product-requirements.md`, the 2026-10-01 Step 2 draft, kept as a bannered evidence snapshot (not authority)
> - `[TOM]`: `docs/target-operating-model.md`, as in the accepted baseline (2026-08-15, superseded in part by ADR 0001). Its §1–3 do not govern. Only its retained truthful-state and durable-outbox principles, and its non-IdealPOS rules, are cited
> - `[ADR]`: `docs/adr/0001-servvia-is-the-operational-pos.md`, with its Decision item number where given (for example `[ADR 7]`)
> - `[ADR2]`: `docs/adr/0002-reduced-first-pilot.md` (accepted 2026-10-03), with its Decision item number
> - `[DL]`: `docs/decisions-log.md`, with its entry number where given (for example `[DL-115]`)
> - `[MIG]`: `docs/migration/README.md`, "Decisions recorded 2026-09-29" (A, B)
> - `[OLD]`: `docs/prd.md`, with its original ID
> - `[MVP]`: `docs/mvp.md` (2026-08-15 assessment, as in the accepted baseline), with its original section
> - `[DECISION-2026-10-03]`: the governance decisions of 2026-10-03, approved through the project's decision orchestration: the production-cutover rule (section 11), O-2 (transitional credential issuance), ORD-4 and ORD-5 rewording, and PRT-1 source repair. Recorded in [README.md](README.md) "Provenance status". It is not attributed to any older document
> - `†` after a tag (none remain as of 2026-10-03): provenance unresolved; see the provenance status in [README.md](README.md)
> - `[BR]`: `PRODUCT.md`
> - `[DS]`: `DESIGN.md`
> - `[REPO]`: implemented Servvia Core behaviour, observed in the repository (evidence of existing capability, referenced rather than rebuilt)
> - `[OWNER-QB-2026-10-01]`: the owner's enterprise-quality instruction of 2026-10-01 (Part B). It is not attributed to any older document.
> - `[OWNER-KOS-2026-10-05]`: the owner's decision of 2026-10-05 that every genuine product capability described in KitchenOS (`/Users/sarwarkhan/Documents/Obsidian Vault/Restaurant/KitchenOS.md`) belongs in Servvia's long-term target product. It approves capabilities only, not KitchenOS architecture, vendors, numbers, schedules, GTM or compliance assertions.
> - `[ORCH-T2-2026-10-05]`: the orchestrator's Tier-2 architecture ratification of 2026-10-05 (O-20, O-21; volume 00 §00.10.6; O-10, O-13; volume 00 §00.10.7) and its reclassification of O-19 as a planning baseline. It is **not** an owner decision and approves no business policy, numeric value or compliance position.
> - `[OWNER-2026-10-05]`: the owner's decisions of 2026-10-05: removal of the legacy application directories (section 34.3) and consolidation of `fileRestructure.md` into Part C. It is not attributed to any older document.
> - `[OWNER-CC-3-2026-10-02]`: the owner's tablet-consolidation decision of 2026-10-02 (change record CC-3, section 36.2). It is not attributed to any older document.
>
> Requirements carried from `[OLD]` are restated without its superseded stack.
>
> **Structure:**
> - **Part A, functional requirements (sections 1–14).** Consolidated from sources; no new requirements, except the owner's CC-3 decision (WT-1 to WT-6, tagged `[OWNER-CC-3-2026-10-02]`).
> - **Part B, Enterprise Quality Bar and non-functional requirements (sections 15–27).** The owner's quality instruction, tied to Servvia's architecture.
>   - Every numeric target in Part B is either inherited, with its source, or marked **OWNER TARGET REQUIRED**.
>   - Policy details that are not yet approved are marked **OWNER DECISION REQUIRED**.
> - **Part C, architecture, repository structure and transition (sections 28–36).** Consolidated from the former `fileRestructure.md` (owner decision 2026-10-05); no new product requirements.
> **Windows POS:** detailed behaviour is **PENDING USER POS ANALYSIS REPORT** (section 12).

## 1. Product definition

- **Servvia is the operational POS** and restaurant platform. Servvia Core records the service day: tables and visits, orders and rounds, kitchen tickets, checks, payments, settlement, refunds, shifts and cash, devices and terminals, promotions, tax, rounding and totals, audit and domain events. `[P2 §1] [ADR 1]`
- **There is no external POS.** No canonical concept is shaped around another POS product. `[ADR] [FR]`
- **It serves single-venue and multi-venue operators.** A second venue must be onboardable through configuration, without code changes. `[OLD BG-7] [P2 §7]`

## 2. Principles (binding)

| ID | Principle | Source |
|---|---|---|
| PR-1 | **PostgreSQL holds the canonical record**, behind Go Core. No client or edge process writes it directly. | `[ADR 2] [FR]` |
| PR-2 | **Clients are presentation and input only.** No client owns business rules or pricing. | `[ADR 5–6] [P2 §2]` |
| PR-3 | **The server owns validation:** price, tax, totals, payment state, tenancy, permissions, transitions, idempotency. | `[MVP §2] [ADR 5]` |
| PR-4 | **Never fake success.** No surface reports a payment, kitchen delivery or print it has not confirmed. Delivery states are explicit and independent. | `[MVP §2] [TOM §6–7]` |
| PR-5 | **Money is stored as integer minor units.** A fractional modifier price is invalid data. | `[MIG A]` |
| PR-6 | **The modifier contract is identifier-based.** Clients send product, modifier-group and option IDs, never names. | `[MIG B]` |
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
| Waiter | Staff-operated ordering at the table (Waiter Tablet, Staff Mode) | `[FR] [P2 §3] [OWNER-CC-3-2026-10-02]` |
| Kitchen staff | Incoming work in real time; advance it with minimal interaction | `[OLD P4]` |
| Platform administrator | Venues, users, roles, configuration, devices, printers | `[OLD P6]` |
| Customer at a table tablet | Customer-operated table ordering (Waiter Tablet, Guest Mode) | `[FR] [P2 §3] [OWNER-CC-3-2026-10-02]` |
| Kiosk customer | Self-service ordering, touch-first, no training | `[OLD P1] [P2 §3]` |
| Public website guest | Discover the venue, explore the menu, contact, reserve (and pre-order; open O-18) on mobile and desktop | `[BR] [OLD P1]` |

## 4. Product surfaces

This is the single canonical application inventory. Platform technologies are in section 29; repository ownership in section 30.

| Surface | Location | Technology | Role | Current state | Source |
|---|---|---|---|---|---|
| Go Core | `services/core-platform/` | Go | Canonical state, REST, realtime, events, workers | TARGET + PARTIALLY IMPLEMENTED: domains D1–D13 with tests; no client switched to it; not deployed | `[FR]` |
| Windows POS | `apps/windows/pos-terminal/` | C# / .NET | Main POS terminal. **Pending POS report** | TARGET + STRUCTURAL SCAFFOLD ONLY; frozen (section 31) | `[FR]` |
| Waiter Tablet | `apps/android/waiter-tablet/` | Kotlin | The single tablet ordering application: **Staff Mode** (staff-operated mobile POS) and **Guest Mode** (customer-operated table ordering). Predecessor and reference: the web Order Tablet, which already has both modes. The separate Customer Order Tablet was merged into it by CC-3 (section 8) | TARGET + STRUCTURAL SCAFFOLD ONLY. Transitional predecessor: the Admin Console Order Tablet build mode (section 34.2) | `[FR] [OWNER-CC-3-2026-10-02]` |
| Kiosk | `apps/android/kiosk/` | Kotlin | Customer self-service ordering | TARGET + STRUCTURAL SCAFFOLD ONLY. No current client: the web kiosk was removed on 2026-10-05 (section 34.3) | `[FR]` |
| KDS | `apps/android/kds/` | Kotlin | Kitchen display | TARGET + STRUCTURAL SCAFFOLD ONLY. Transitional KDS of record: the Admin Console KDS build mode (section 34.2) | `[FR]` |
| Window Display | `apps/android/window-display/` | Kotlin | Promotions and signage; also the entrance menu display (`[OLD FR-5]`) | TARGET + STRUCTURAL SCAFFOLD ONLY. No current client: the React window display was removed on 2026-10-05 (section 34.3) | `[FR] [OLD FR-5]` |
| Admin Console | `apps/web/admin-console/` | React + TypeScript | Administration and oversight | TARGET + IMPLEMENTED IN TARGET LOCATION. Calls Nest; also hosts the transitional Order Tablet and KDS build modes | `[FR]` |
| Customer Website | `apps/web/customer-website/` | React + TypeScript | Public site | TARGET + IMPLEMENTED IN TARGET LOCATION. Mostly JavaScript; incremental TypeScript migration, no wholesale rewrite first; calls Nest | `[FR] [BR]` |
| Landing Page | `apps/web/landing-page/` | React + TypeScript | Public landing page (requirements not yet defined) | TARGET + STRUCTURAL SCAFFOLD ONLY; its own application boundary (public-home content may be reused) | `[FR]` |
| Venue Edge | `services/venue-edge/` | Go | Venue hardware and local resilience | TARGET + STRUCTURAL SCAFFOLD ONLY (section 30.4) | `[FR] [ADR 7]` |
| Analytics / AI | `data/` | Python | Outside the transaction path | TARGET + NOT YET CREATED | `[FR]` |

**There are exactly four permanent Android applications** (Waiter Tablet, Kiosk, KDS, Window Display; section 32). There is no permanent `apps/android/order-tablet/`; customer-operated table ordering is the Waiter Tablet's Guest Mode (WT-1, WT-3).

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
| ORD-2 | Core validates venue, table session, menu availability, modifiers and price, and computes tax and totals server-side. | MUST | `[ADR 5] [MVP §2]` |
| ORD-3 | A repeated submission with the same idempotency key returns the original result and creates no duplicate. | MUST | `[MVP 9.1] [TOM §7]` |
| ORD-4 | An order submission that references menu data Core cannot validate (an unknown, unavailable or invalid item or option, a stale price, or an unsupported tax configuration) is refused with a stable, specific error and creates no order. | MUST | `[ADR 5] [MVP §2] [REPO] [DECISION-2026-10-03]` |
| ORD-5 | An order carries its table session (visit), source and line/modifier context. Ordering does not open or modify a check. A check is created separately over the visit's unbilled lines. | MUST | `[OLD FR-4.8] [ADR 4] [REPO] [DECISION-2026-10-03]` |
| KIT-1 | **Servvia owns KDS and KOT routing.** Routing is line-level, using the station configuration effective at submission; one round may produce several station tickets. | MUST | `[TOM §5] [OLD FR-4.7] [MVP 9.5]` |
| KIT-2 | KDS and each printer have independent delivery states; neither implies payment success. | MUST | `[TOM §6]` |
| KIT-3 | Orders appear on the KDS in real time (target under 3 s from submission). | MUST | `[OLD FR-6.2, NFR-1.4]` |
| KIT-4 | A KDS ticket shows order ID, table, time, items with quantities and modifiers, and notes. Staff advance it through its states. | MUST | `[OLD FR-6.3–6.4]` |
| KIT-5 | A visual and audible alert when an order is ready; age colour-coding with a configurable threshold. | SHOULD | `[OLD FR-6.5–6.6]` |
| KIT-6 | The KDS keeps showing received tickets during a backend outage and reconnects automatically. | MUST | `[OLD FR-6.9, NFR-4.3]` |
| PAY-1 | **In-person flow:** kitchen preparation may begin before payment; the check shows unpaid until a payment is recorded. Payment is by card (through Venue Edge) or by cash within a shift. | MUST | `[ADR 4] [ADR 7] [REPO]` |
| PAY-2 | **Online/prepaid flow:** a pending order with an immutable price snapshot. Payment is verified server-side (status, currency, amount, merchant/venue binding, replay protection) before release to KDS/KOT. A failed, cancelled or abandoned payment releases nothing unless an approved "prepare before payment" policy exists. | MUST (where online payment is enabled) | `[TOM §4] [OLD FR-4.16] [MVP 9.2]` |
| PAY-3 | Payment amount and currency equal the server-computed total. One provider payment cannot create more than one order. Signed webhook replay is idempotent. Missing provider configuration fails closed in production. | MUST | `[MVP 9.2]` |
| PAY-4 | Payment implementation is provider-neutral. Provider-specific fields live in adapter metadata. | MUST | `[TOM §8] [P2 §18]` |
| PAY-5 | No raw card data enters Servvia. | MUST | `[TOM §4] [OLD FR-4.9]` |
| PAY-6 | An uncertain terminal or printer outcome is reconciled before any retry that could duplicate a charge or ticket. An online payment that succeeds before a later failure is never charged again. | MUST | `[TOM §7] [ADR 7]` |
| PAY-7 | Partial and full refunds. | MUST | `[TOM §9] [P2 §8]` |
| REC-1 | Receipts: content and NZ receipt and tax-invoice obligations are **open** (O-5). Print content for orders includes order ID, table, items with modifiers, instructions, time and venue. | MUST | `[DL] [OLD FR-8.10]` |

## 7. Administration, menu, reservations and reporting

| ID | Requirement | Priority | Source |
|---|---|---|---|
| MENU-1 | CRUD for categories (name, sort order, active) and items (title, description, integer-cent price, category, sub-category, availability, spicy flag, sort order), from the Admin Console only. | MUST | `[OLD FR-3.1–3.2]` |
| MENU-2 | Structured nutrition and allergens per item: calories, protein, carbohydrates, fat; allergens from a fixed list. Allergens are shown during browsing on ordering surfaces. | MUST | `[OLD FR-3.3, FR-4.15]` |
| MENU-3 | Item images: upload, replace, remove. Server-side type validation (content, not extension) and a maximum upload size (default 10 MB). Conversion to an efficient web format. | MUST (conversion SHOULD) | `[OLD FR-3.4–3.5, NFR-2.13]` |
| MENU-4 | Items are venue-scoped, or shared across an organization with venue overrides (price, availability). | MUST | `[OLD FR-3.7]` |
| MENU-5 | Modifier groups with required flag, minimum and maximum selections, and options with price deltas (identifier-based, PR-6). | SHOULD | `[OLD FR-3.8] [MIG B]` |
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

**Waiter Tablet (CC-3).** One tablet application with two operating modes. Both modes share one context: venue → service area → table → visit (table session) → menu → order → kitchen and service workflow. Where staff and guest experiences differ, the difference is mode-specific presentation, permissions or workflow, never a separate application.

| ID | Requirement | Priority | Source |
|---|---|---|---|
| WT-1 | **The Waiter Tablet is one application** (`apps/android/waiter-tablet/`) with a **Staff Mode** and a **Guest Mode** over the same venue, table, visit and order context. No separate customer tablet application exists. | MUST | `[OWNER-CC-3-2026-10-02] [FR]` |
| WT-2 | **Staff Mode** is the former Waiter Tablet scope: staff-operated ordering at the table (staff-operated mobile POS). Its behaviour is defined by the other requirements of this document; CC-3 adds none. | MUST | `[FR] [P2 §3] [OWNER-CC-3-2026-10-02]` |
| WT-3 | **Guest Mode** is the former Customer Order Tablet scope: customer-operated table ordering, associated with the same table and visit as Staff Mode. Guest self-ordering stays in scope. Its UX and detailed features are **not yet defined**, as before CC-3. | MUST | `[FR] [P2 §3] [OWNER-CC-3-2026-10-02]` |
| WT-4 | **Guest Mode never grants access to staff-authorised functionality.** It is a restricted operating context, enforced by trusted application and backend controls, not by user-interface visibility alone (PR-3). | MUST | `[OWNER-CC-3-2026-10-02] [DL]` |
| WT-5 | **Entering Staff Mode requires successful staff authorisation,** enforced by the same trusted controls (WT-4); a customer cannot switch the tablet into Staff Mode. The native mechanism is **decided** (O-20): named staff authentication distinct from device identity (volume 00 §00.10.6). | MUST | `[OWNER-CC-3-2026-10-02] [DL]` `[ORCH-T2-2026-10-05]` |
| WT-6 | **Consolidation removes no order-origin information.** Every order still retains its source channel, actor and device identity (section 5). Each order and round also records its operating mode (Staff Mode or Guest Mode), established server-side from the verified credential (O-21, **decided**; volume 00 §00.10.6). | MUST | `[TOM §6] [OWNER-CC-3-2026-10-02]` `[ORCH-T2-2026-10-05]` |

**Requirements mapping (CC-3).** Nothing was removed; each former requirement has a new home:

| Former requirement (before CC-3) | Now |
|---|---|
| Actor "Customer at a table tablet: customer-operated table ordering" `[FR] [P2 §3]` | Same actor row (section 3), served by **Waiter Tablet → Guest Mode** (WT-3) |
| Surface "Customer Order Tablet, `apps/android/order-tablet/`, Kotlin, customer-operated table ordering (new)" `[FR]` | **Waiter Tablet → Guest Mode** (section 4, WT-1, WT-3). The path `apps/android/order-tablet/` is removed |
| "Its UX and features are not defined" (former `fileRestructure.md` 4.1) | Kept: Guest Mode UX is not yet defined (WT-3) |
| Accessibility "Customer Order Tablet: OWNER TARGET REQUIRED" (section 23) | Waiter Tablet (both modes): **OWNER TARGET REQUIRED** (section 23) |
| Actor "Waiter: staff-operated ordering at the table (Waiter Tablet)" `[FR] [P2 §3]` | **Waiter Tablet → Staff Mode** (WT-2) |
| Surface "Waiter Tablet: staff-operated mobile POS (predecessor: web staff Order Tablet)" `[FR]` | **Waiter Tablet → Staff Mode** (section 4, WT-2). The web Order Tablet is now the predecessor of both modes |
| O-1 "Is the Waiter Tablet required for the pilot venue?" | Unchanged; it now covers both modes |

**Reduced first pilot (ADR 0002).** Guest Mode is excluded from the first pilot and retained in the product architecture; WT-1 to WT-6, O-20 and O-21 are unchanged by ADR 0002 (O-20 and O-21 were later decided by Tier-2 ratification on 2026-10-05). For the reduced first pilot, the web Order Tablet's Staff Mode is the temporary settlement surface, within the minimum settlement boundary and retirement rule of ADR 0002 item 8. Guest Mode never receives settlement capability. `[ADR2 4, 8]`

**Kiosk, window display and public web.**

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
| EDGE-1 | **Venue Edge owns local hardware and resilience:** printers, payment terminals, cash drawers, customer displays, offline command queue, sync, retry and diagnostics. It is never an independent source of business truth. | MUST | `[ADR 7] [P2 §17]` |
| EDGE-2 | Outbound-only authenticated communication. A revocable, venue-bound identity. Encrypted local storage. A durable local queue with leases, idempotent reports, an explicit `unknown` outcome, and expiry. No direct database or shared Redis access. | MUST | `[TOM §8] [ADR 2] [ADR 7] [MVP 9.4]` |
| EDGE-3 | The local queue survives process and machine restart. Internet loss loses or duplicates nothing. Reconnect preserves order and idempotency. Heartbeat, versions, queue depth and oldest age are visible. | MUST | `[MVP 9.4]` |
| PRT-1 | Multiple named printers per venue with role, connection and paper width. Station routing per KIT-1. Each KOT prints once per station; reprints are explicit and attributed (NFR-AUD). Printed acknowledgement is distinct from command delivery. | MUST | `[OLD FR-8.1–8.2, FR-8.6] [MVP 9.5] [TOM §6]` |
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
  - staff sign-in. Every transactional request is authorized by Go Core, which verifies the credential and enforces roles and venue access. Credentials may be issued by the transitional NestJS identity service (O-2);
  - visit open;
  - orders and rounds;
  - kitchen tickets on the KDS;
  - check;
  - cash settlement;
  - visit close;
  - shift open and close;
  - refund.

  `[P2 §10]`
- **FIRST INDEPENDENT SERVVIA PILOT:** a real venue runs its service days on Servvia, with no external POS, in production, with venue hardware: an **integrated card terminal through Venue Edge** (card success only from the trusted payment adapter), receipt printing, and kitchen printing **if the venue requires it**. `[P2 §11]` `[ADR2 2]` Whether the pilot venue requires kitchen printing is not yet established; hardware and protocol detail stay with O-4. **Reduced first pilot** (ADR 0002, accepted 2026-10-03): cash-drawer hardware, Guest Mode and the Windows POS are not part of the first pilot, and settlement is performed through the transitional web Order Tablet in Staff Mode. `[ADR2 1, 3, 4, 8]`
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

  `[TOM §9]` (the acceptance list above)

  **Production cutover:** a live venue must not be moved onto Servvia merely because a calendar target exists. Production cutover is a separately approved operational action, and it requires evidence that the applicable release-acceptance criteria above have been met. `[DECISION-2026-10-03]`
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

Stories that need any of these are **BLOCKED** until the report exists. The Windows POS structural boundary is in section 31. `[P2 §24] [FR §5]`

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

- **Long-term target product scope (owner decision 2026-10-05)** `[OWNER-KOS-2026-10-05]`:
  - **Included in the long-term target product:** every genuine product capability of the KitchenOS capability set:
    - multi-channel ordering and service, including phone, online, kiosk and delivery-marketplace channels, table zones, server assignment, courses, queues and waitlists, and bill split and merge;
    - kitchen and production;
    - inventory and procurement;
    - workforce, including scheduling, attendance and payroll capability through jurisdiction packs or provider adapters;
    - finance, including wallets, operational P&L, accounting integration and tax reporting by jurisdiction pack;
    - CRM and loyalty;
    - analytics, forecasting and AI under the control model of volume 00 INV-21;
    - multi-location and franchise operation;
    - compliance capability by jurisdiction pack;
    - an integration ecosystem, external APIs and webhooks;
    - onboarding and support.

    This includes the domains deferred above (material, recipe and production, procurement, CRM and loyalty, workforce, BI forecasting).
  - **Not changed:** these capabilities are **not** part of the first pilot. The pilot exclusions and ADR 0002 stand. Their delivery phase and order are open (volume 00 DEC-X-17), and no implementation is authorized by this decision.
  - **Not approved by it:**
    - KitchenOS technology, vendors, numeric targets, schedules, GTM, financing and compliance assertions;
    - Servvia's own finance sub-ledger, enterprise SSO/SCIM and the floor-plan editor, which KitchenOS does not describe and which remain deferred.
  - Each domain volume (01–09) labels these capabilities `TARGET CAPABILITY — FUTURE DELIVERY`.

## 14. Open owner decisions

O-1 to O-11 come from `[P2 §24]`. O-12 to O-18 come from the conflicts in [README.md](README.md). O-20 and O-21 come from CC-3 (section 8).

| ID | Decision |
|---|---|
| O-1 | Is the Waiter Tablet required for the pilot venue? |
| O-2 | **Decided 2026-10-03 (transitional architecture, PR-7)** `[DECISION-2026-10-03]`. **What Nest may do:** NestJS may temporarily issue staff and device credentials and continue non-transactional administration during the first pilot. **What Go Core stays authoritative for:** transactional authorization, credential verification at transactional boundaries, venue access and scoping, financial role enforcement, and transactional state. **Ownership:** the target owner of credential issuance is Go Core. **Retirement:** the overlap ends when Core provides the replacement credential issuance and the applicable clients have migrated and passed acceptance. **Guest credentials** never acquire Staff authority (WT-4, WT-5). Application mode, actor identity and provenance stay separate concepts. **Not waived:** the missing enforcement of staff venue scope in Core remains a security gap that must be fixed (section 16, item 3). |
| O-3 | In-person card provider and terminal (also open in `[DL]`) |
| O-4 | Pilot printers, cash drawer and KDS hardware; print protocol |
| O-5 | Receipt content and NZ receipt and tax-invoice obligations (also open in `[DL]`) |
| O-6 | Minimum service-day reports for the pilot |
| O-7 | Reservations ownership in Core (no domain in the approved structure) |
| O-8 | Media ownership in Core (no package in the approved structure) |
| O-9 | Inventory (no domain in the approved structure) **Inclusion resolved 2026-10-05** `[OWNER-KOS-2026-10-05]`: inventory is in the long-term target product; its Core domain follows Part C change control when committed (volume 00 DEC-X-13, DEC-X-17). |
| O-10 | Android SDK and Gradle decisions **Decided 2026-10-05 (Tier-2 ratification, not an owner decision)** `[ORCH-T2-2026-10-05]`: native Kotlin Android engineering baseline (Kotlin 2.x / K2, pinned Gradle wrapper, Kotlin DSL, Jetpack Compose / Material 3, JDK 17, version catalog with dependency verification and locking, Hilt, coroutines / Flow, OkHttp, kotlinx.serialization, Room, DataStore, Android Keystore, the supported testing and quality stack, signing isolated from source and ordinary CI logs). Exact versions are selected from authoritative compatibility information and reproducibly pinned when the baseline is first built; the rule is not "always newest stable", and upgrades are controlled changes. `minSdk` derives from approved venue hardware and is never below API 26 without a new architecture decision. Contract: volume 00 §00.10.7. Implementation not started. |
| O-11 | Superseded by CC-1: the fresh official BMAD is installed after `PRD/` approval |
| O-12 | Commercial target customer for Servvia as the POS (C-1) |
| O-13 | KDS device authentication versus the old "no-auth KDS" requirement (C-3) **Decided 2026-10-05 (Tier-2 ratification, not an owner decision)** `[ORCH-T2-2026-10-05]`: ordinary KDS operation uses a per-device, venue-bound D8 device identity, distinct from staff identity, with no human login; the old "no-auth KDS" requirement is not adopted; the Nest venue PIN stays TRANSITIONAL (ADMIN-38) and is not canonical. Contract: volume 00 §00.10.7. Implementation incomplete. |
| O-14 | Public site: pixel freeze versus `[DS]` visual refinement (C-4) |
| O-15 | Brand naming on public web surfaces: venue brand or Servvia (C-5) |
| O-16 | Reservation calendar sync and reservation card payments (C-6) **Calendar sync inclusion resolved 2026-10-05** `[OWNER-KOS-2026-10-05]` (provider is an adapter choice); reservation card payments remain open. |
| O-17 | Which Servvia channels count for availability propagation (C-7) |
| O-18 | Public web online ordering or pre-ordering scope (C-8) **Inclusion resolved 2026-10-05** `[OWNER-KOS-2026-10-05]`: online ordering is in the long-term target product; scope details (pre-ordering, payment flow, channels) and delivery phase remain open. |
| O-19 | Confirm the inherited numeric performance and availability targets for the Go Core architecture (C-9; section 19) **Reclassified 2026-10-05** `[ORCH-T2-2026-10-05]`: **BASELINE ACCEPTED FOR PLANNING — OWNER MAY REVISE THROUGH CONTROLLED CHANGE.** Owner confirmation remains pending before release acceptance; the values are not owner-confirmed and none is changed. |
| O-20 | Waiter Tablet: the staff authorisation mechanism for entering Staff Mode in the native application (WT-5). Reference only: `[DL]` DL-081 approved device identity, a restricted customer mode, named staff elevation by personal PIN and manager step-up for the current web Order Tablet; whether that model carries over to the native application is not decided **Decided 2026-10-05 (Tier-2 ratification, not an owner decision)** `[ORCH-T2-2026-10-05]`: named staff authentication distinct from device identity; for the MVP the mechanism is the personal staff PIN of the DL-081 model, which is not the permanent architecture. Lifetimes, PIN length, lockout and second-factor policy stay governed policy (P2). Contract: volume 00 §00.10.6. Implementation incomplete. |
| O-21 | Waiter Tablet: whether and how an order records Staff Mode versus Guest Mode (WT-6), and the future meaning and names of the existing `OrderSource.waiter_tablet`, `OrderSource.order_tablet`, `DeviceKind.order_tablet` and `MenuChannel.order_tablet` values (section 33) **Decided 2026-10-05 (Tier-2 ratification)** `[ORCH-T2-2026-10-05]`: explicit canonical provenance model (volume 00 §00.10.6); `waiter_tablet` is the Waiter Tablet application family in both modes, distinguished by recorded operating mode; `order_tablet` stays readable for compatibility and history and is not emitted by native clients; no destructive enum or schema change. Guest Mode menu-channel display policy is not part of this decision (P9). Implementation incomplete. |

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
| T | Compatibility and upgrade | APIs and events are versioned through `contracts/`. Breaking changes are explicit and coordinated with clients and Venue Edge. Edge and device upgrade, revocation and compatibility are managed. | `[OWNER-QB-2026-10-01]` `[MVP P2] [FR]` |
| U | Maintainability | Code lives in its owner location (Part C, section 30). One long-term owner per capability (PR-7). Architecture guard tests stay green. | `[OWNER-QB-2026-10-01]` `[FR] [DL] [REPO]` |
| V–AA | Testing (automated, integration, contract, end-to-end, load and performance, security) | Section 21. | `[OWNER-QB-2026-10-01]` |
| AB | Accessibility | Section 23. | `[OWNER-QB-2026-10-01]` |
| AC | UX quality | Section 22. | `[OWNER-QB-2026-10-01]` |
| AD | Visual consistency | Public web follows `[DS]`. A consistent design language across each product family (Android: a shared design system lives in `packages/android/` once genuinely shared, section 32; Admin Console). Product-family design standards: **OWNER DECISION REQUIRED**. | `[OWNER-QB-2026-10-01]` `[DS] [FR]` |
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
7. **Deterministic pricing authority:** the same inputs always produce the same server-computed price, tax and totals. `[ADR 5]`
8. **Integer minor-unit money** (PR-5). `[MIG A]`
9. **Safe retry semantics:** a retry reuses the same key and version, and never duplicates a charge, ticket or refund. `[TOM §7]`
10. **Reconciliation capability:**
    - payments against the provider;
    - cash against the shift;
    - a reconciliation queue for failed, stuck or mismatched items.

    `[TOM §7] [MVP 8.1]`
11. **Traceability** from each user or device action to the resulting state (actor and device identity, correlation ID). `[TOM §6]`
12. **Uncertain external outcomes** (terminal or provider) are held explicitly as uncertain and reconciled before any retry (PAY-6). `[TOM §7–8] [ADR 7]`

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
| API read latency | P95 under 200 ms under normal load | `[OLD NFR-1.1]` | Inherited; planning baseline (O-19); owner confirmation pending before release acceptance (C-9) |
| Order submission latency | P95 under 500 ms end to end, excluding printing | `[OLD NFR-1.2]` | Inherited; planning baseline (O-19); owner confirmation pending before release acceptance (C-9) |
| Kitchen-ticket propagation to the KDS | under 3 s from submission | `[OLD FR-6.2, NFR-1.4]` | Inherited; planning baseline (O-19); owner confirmation pending before release acceptance (C-9) |
| Print latency | under 3 s from submission to printer, validated on venue hardware | `[OLD NFR-1.3] [MVP 9.5]` | Inherited; planning baseline (O-19); hardware open (O-4) |
| Availability ("86") propagation | p95 under 30 s | `[MVP 9.3]` | Inherited |
| Admin Console initial load | under 2 s on 10 Mbps | `[OLD NFR-1.5]` | Inherited; planning baseline (O-19); owner confirmation pending before release acceptance (C-9) |
| Kiosk navigation | under 1 s per page | `[OLD NFR-1.6]` | Inherited; planning baseline (O-19); owner confirmation pending before release acceptance (C-9) |
| Service availability | 99.5% a month, excluding planned maintenance | `[OLD NFR-6.1]` | Inherited; planning baseline (O-19); owner confirmation pending before release acceptance (C-9) |
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
| Waiter Tablet (Staff Mode and Guest Mode), KDS, Window Display (Android) | **OWNER TARGET REQUIRED** | — |
| Windows POS | **OWNER TARGET REQUIRED**; detail **PENDING USER POS ANALYSIS REPORT** | — |

## 24. Release and production readiness

`[OWNER-QB-2026-10-01]`

**"Implemented" is not "production ready".** A production capability must satisfy every applicable gate, each with **explicit release evidence** (test reports, review records, rehearsal logs) rather than informal confidence:

1. architecture compliance (Part C ownership, no second canonical owner);
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
| Availability and reliability | Service availability | 99.5% a month | `[OLD NFR-6.1]` | Uptime measurement in production | Planning baseline (O-19); owner confirmation pending before release acceptance (C-9) |
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

---

# Part C: Architecture, repository structure and transition

Part C consolidates the former `fileRestructure.md` (change records CC-1 to CC-4), which the owner retired on 2026-10-05. It fixes **where Servvia code belongs**, which component owns what, and how transitional code is replaced and retired. It adds no product requirements. The application inventory is section 4; Part C does not repeat it.

## 28. Authority and change control

`[FR §1, §9] [OWNER-2026-10-05]`

- **This document is the architecture and repository-structure authority.** Implementation follows Part C. There is no separate structure document.
- **Purpose:** architectural ownership must not drift between sessions or contributors; every piece of work has one agreed home; existing code moves toward that home deliberately, not reinterpreted each time.
- **A genuine architectural change is made here first,** through owner-approved controlled change, before implementation diverges from the agreed structure. Ownership boundaries are never changed silently during implementation.
- **Internal names that do not alter ownership need no redesign.** For example, the `<domain>api` (transport) and `pgstore` (persistence) subpackage convention inside a Core domain package is an internal naming choice, and the file names shown for a target package record ownership, not required file names.
- **Product requirements may change implementation details without changing the ownership model.**
- **Change history:** section 36.

## 29. Architectural invariants and platform technologies

`[FR §2] [ADR 1–2]`

**Invariants** (restating PR-1 and PR-2 at the architecture level):
1. **Servvia is the operational POS.** There is no external POS in the target architecture.
2. **PostgreSQL is authoritative.**
3. **Go Core owns canonical transactional restaurant state** (`services/core-platform/`). There is no second canonical backend and no competing canonical implementation.
4. **Clients use Servvia APIs and contracts** (`contracts/`).
5. **No client owns canonical pricing or writes PostgreSQL directly.**
6. **The Windows POS is a client**, not a parallel backend.

**Platform technologies** (client applications and their technologies are in section 4):

| Area | Technology |
|---|---|
| Core POS platform; REST/API; realtime/WebSocket services | Go (`services/core-platform/`) |
| Venue Edge and hardware orchestration | Go (`services/venue-edge/`) |
| Future venue device apps | Kotlin / Android |
| AI, analytics and forecasting | Python (`data/`), outside the transaction path |
| Transactional database | PostgreSQL |
| Cache and coordination | Redis |
| Realtime communication | WebSockets |
| Media and promotional assets | Google Cloud Storage (NFR-DATA) |
| Deployment and infrastructure | Docker / containers |

## 30. Repository structure and ownership

`[FR §3, §4, §4.1, §4.2] [CC-2]`

### 30.1 Monorepo convention

**Deployable artifact type first, platform second.**

| Kind of code | Location |
|---|---|
| Deployable client application | `apps/<platform>/<application>/` (platforms: `web`, `windows`, `android`) |
| Backend or long-running service | `services/<service>/` |
| Reusable library or shared module | `packages/<scope>/<package>/` |
| Cross-language contract | `contracts/` (`openapi/`, `events/`, `realtime/`, `schemas/`) |
| Data, ML or analytics workload | `data/` (`analytics/`, `forecasting/`, `ai/`, `pipelines/`) |
| Database ownership and migration target | `database/` (`migrations/`, `seeds/`, `fixtures/`, `docs/`) |
| Deployment and runtime infrastructure | `infrastructure/` (`docker/`, `kubernetes/`, `terraform/`, `monitoring/`, `dashboards/`, `secrets/`, `local-dev/`) |
| Development, CI, codegen and scripts | `tooling/` (`scripts/`, `codegen/`, `generators/`, `test-fixtures/`, `test-tools/`, `ci/`, `deployment/`) |
| Documentation | `docs/` (`architecture/`, `adr/`, `api/`, `android/`, `windows-pos/`, `admin-console/`, `edge/`, `operations/`, `migration/`) |
| Authoritative product requirements and architecture | `PRD/` (documentation, not runtime code) |
| CI workflows; build entry point | `.github/`; a root `Makefile` (not yet created; root `package.json` scripts are the current entry point) |

The listed sub-areas record **structural ownership**. They are not an instruction that each must exist now.

### 30.2 Structural rules

1. **The structure in this section is the agreed target and is authoritative for where new implementation belongs.** It is not redesigned during implementation because another arrangement looks cleaner.
2. **One canonical backend.** Canonical transactional state has one owner, `services/core-platform/` (Go).
3. **Services stay under `services/`.** Go Core and Venue Edge are never placed under `apps/`.
4. **Migrate, don't rewrite for relocation.** Existing implementation moves into the target structure when practical; it is not rewritten because its path differs. New implementation goes directly into the correct target location.
5. **Transitional code may remain temporarily** while its callers migrate (section 34), but it never redefines the target architecture.
6. **No duplicate implementations** merely because a target folder exists.
7. **Only create directories that establish real project or application boundaries, or that imminent implementation needs.** No meaningless empty directories; the target lists are ownership, not a scaffolding checklist.
8. **`packages/` holds reusable code only.** It is never deployed independently; a package is created only when multiple consumers genuinely share code; it is never a catch-all `shared/`. Platform-scoped packages (`packages/web/`, `packages/android/`, `packages/dotnet/`, `packages/go/`) appear only when real shared consumers justify them, and no placeholders are created in advance.
9. **Independently deployable applications do not depend directly on another application's source tree.** Genuinely shared code is extracted into a justified package once the real shared boundary is known.
10. **Migrations:** Prisma (`apps/api/prisma/`) is the migration authority during the transition; `database/` is the final ownership target. Nothing moves until an explicitly approved migration-authority task, which is not permission to rewrite migration history. **Published migrations are never moved, renamed or rewritten.** `services/core-platform/cmd/migrate/` is a future location only if migration ownership is explicitly changed; no competing Go migration system is created.
11. **Transitional exception:** `apps/api/` (NestJS) is a backend under `apps/` today. It is transitional, is not moved, and retires as its callers migrate to Go Core.
12. **Root items outside the structure:** `.claude/` (repository-local development and agent configuration) stays at the root and is not product architecture; `tableMap.svg` is unrelated; planning-tool output is governed by section 35.

### 30.3 Servvia Core package ownership

Target packages under `services/core-platform/` (`cmd/api/`; domain packages under `internal/`; infrastructure under `platform/`; tests under `tests/`):

| Target package | Owns | Current state |
|---|---|---|
| `internal/identity/` (`auth`, `users`, `roles`, `permissions`, `sessions`) | Authentication, tokens, guards, venue scope | Partially implemented (one flat package) |
| `internal/identity/devices/` | Device authentication identity: credentials, authentication material, device-session identity, verification, revocation | Inside `internal/devices/` today; mapped in during implementation, not duplicated |
| `internal/devices/` | The enrolled device registry and lifecycle: registration, state, capabilities, venue assignment, management | Partially implemented (D8) |
| `internal/terminals/` | The logical POS terminal / workstation | Terminal records inside `internal/devices/` today (D8) |
| `internal/organizations/`, `internal/venues/` | Tenancy | Organizations not created; venues implemented (read side) |
| `internal/menu/` (`products`, `categories`, `modifiers`, `availability`) | Menu | Partially implemented (channel menu read) |
| `internal/menu/pricing/`, `internal/menu/taxes/`, `internal/discounts/` | Pricing, tax and discounts. **Server pricing authority stays in Go Core throughout any migration** | Combined in `internal/pricing/` today; split only when those capabilities are next implemented or migrated, never rewritten for conformity |
| `internal/tables/`, `internal/orders/`, `internal/checks/`, `internal/kitchen/` | Table sessions; orders and rounds; checks; kitchen tickets, stations and routing | Implemented (checks: no split or allocation yet) |
| `internal/payments/` | Payments, methods, payment state, settlement, **refunds**, reversal or void where financially applicable | Implemented; refunds still in `internal/refunds/` (consolidate later; behaviour unchanged) |
| `internal/shifts/`, `internal/cash-management/` | Shifts and cash | Partially implemented (`internal/shifts/`) |
| `internal/promotions/`, `internal/events/`, `internal/workers/`, `internal/realtime/`, `internal/health/` | Promotions; durable domain events and in-process workers (D13); realtime (D12, reads the D13 log); health | Implemented |
| `internal/{receipts, staff, idempotency, audit, notifications}/` | As named | Not created as packages |
| `platform/{postgres, redis, queue, websocket, security, observability, config, clock}/` | Infrastructure adapters | Postgres, config and Redis rate limiting exist in old locations (`internal/platform/postgres/`, `internal/config/`, `internal/ratelimit/`); move only when dependency safety permits; the rest not created |
| `tests/` | Tests | Normal Go conventions: unit tests beside packages; `tests/{integration, contract, architecture, parity, testsupport}/` are valid; concurrency tests may live in integration or package tests. Working tests are not relocated to match a diagram |

- **D13 events and workers are valid, current Core implementations.** They are not moved into a separate worker service for layout. A separate worker process, if one is ever genuinely needed, becomes its own `services/<service>/`.
- **Implementation-support packages** (`internal/server/` HTTP routing, `internal/platform/httpx/` HTTP helpers) are details of Core, not subsystems; they stay while they serve Core.

### 30.4 Venue Edge module ownership

`services/venue-edge/` (Go; `cmd/agent/`, `internal/`, `tests/`) owns, under EDGE-1 to EDGE-3: registration, device registry, payment terminal, receipt printer, kitchen printer, cash drawer, customer display, barcode scanner, local cache, local database, command queue, sync, retry, recovery, heartbeat, remote configuration, updates and diagnostics. **State: structural scaffold only.** Printing and payment-terminal transport depend on it. The deleted .NET venue connector was external-POS tooling and is not its basis.

## 31. Windows POS structural freeze

`[FR §5]`

| Frozen item | Value |
|---|---|
| Location | `apps/windows/pos-terminal/` |
| Technology | C# / .NET / Windows |
| Structural boundary | Four solution folders, `Servvia.Pos.App`, `Servvia.Pos.Features`, `Servvia.Pos.Infrastructure` and `Servvia.Pos.Devices`, in `Servvia.Pos.sln`. No feature breakdown inside them is agreed |

Everything else about the Windows POS is **PENDING USER POS ANALYSIS REPORT** (section 12). Nothing may be designed or implemented ahead of that report. The deleted .NET external-POS projects (`apps/venue-connector/`, `apps/idealpos-bridge*/`, `apps/idealpos-harness/`) are **not** a basis for POS design.

## 32. Android applications

`[FR §4.1] [OWNER-CC-3-2026-10-02] [OWNER-2026-10-05]`

**The permanent Android applications are exactly four:**

| Application | Meaning |
|---|---|
| `apps/android/waiter-tablet/` | The single tablet ordering application (WT-1 to WT-6): **Staff Mode** (staff-operated mobile POS) and **Guest Mode** (customer-operated table ordering; UX not yet defined). The web Order Tablet is its predecessor and reference |
| `apps/android/kds/` | Kitchen display |
| `apps/android/kiosk/` | Customer self-service ordering |
| `apps/android/window-display/` | Promotions and digital signage, including the entrance menu display (WD-1) |

- **There is no permanent `apps/android/order-tablet/`** and no separate customer or Guest Mode application. Guest Mode is a mode of the Waiter Tablet.
- **Four concepts stay separate** for the Waiter Tablet:

  | Concept | Values | Meaning |
  |---|---|---|
  | Application identity | `waiter-tablet` | The one Android tablet ordering app |
  | Operating mode | Staff Mode, Guest Mode | Who is operating the tablet now, and therefore its presentation, permissions and available actions |
  | Actor | Staff identity, or the device / guest-session identity | Who performed an action on the tablet |
  | Order provenance | Order source, actor and device identity | Where, by whom and in which mode an order was entered (WT-6; O-21 decided) |

  Being a mode of the Waiter Tablet never grants Guest Mode staff authority (WT-4). Entering Staff Mode needs staff authorisation enforced by trusted application and backend controls (WT-5; native mechanism decided, O-20). Existing evidence: DL-081 (the approved model of the current web Order Tablet) and Go Core, where an unelevated tablet token (`tablet_device`) is a device identity refused by staff-only routes and only an elevated tablet (`tablet_staff`, `tablet_manager`) counts as staff.
- **Shared Android code** goes to `packages/android/` only when genuinely shared (rule 8). The old `android/core/`, `android/models/` and `android/build-logic/` scaffolds are not recreated.
- **Where the Gradle root and shared build logic live** (within `apps/android/` or as a `packages/android/` build module) is an implementation choice within the decided O-10 baseline (volume 00 §00.10.7), made when that baseline is first built and kept within the rules of this section.
- **State:** all four are structural scaffolds only; product implementation has not started (section 4).

## 33. Waiter Tablet terminology debt

`[FR §8.F] [OWNER-CC-3-2026-10-02]`

These values are live data, contracts or code. They are kept for compatibility and recorded as terminology debt rather than renamed; their meaning was decided with O-21 on 2026-10-05; nothing is renamed or removed by that decision:

| Occurrence | Classification | Meaning today | Status |
|---|---|---|---|
| `DeviceKind.order_tablet` (Prisma, Core `internal/devices`, `contracts/openapi/devices.yaml`) | Physical device classification | The tablet installation regardless of mode; effectively the Waiter Tablet device | KEEP (physical tablet kind). A distinct Waiter Tablet kind may be added additively in implementation planning (O-21); no rename |
| `MenuChannel.order_tablet` (Prisma, Core `internal/menu`, Nest menu, Admin Console, `contracts/openapi/menu-read.yaml`) | Menu channel | The tablet's menu channel; shows unavailable ("86'd") items dimmed (staff policy) | KEEP. O-21 decided provenance only; Guest Mode menu-channel and display policy remain open under P9 and are needed only when Guest Mode is built |
| `OrderSource.waiter_tablet`, `OrderSource.order_tablet` (Prisma, Core `internal/orders`, `contracts/openapi/servvia-orders.yaml`, `kitchen-tickets.yaml`) | Order source / audit | Two canonical tablet sources with no documented difference. Core accepts both only from a staff-elevated tablet; neither is defined as Guest Mode. Guest-mode orders currently go through Nest `POST /api/tablet/orders` with legacy source `staff`, attributed to a per-device system actor | KEEP both. O-21: `waiter_tablet` = Waiter Tablet application family (mode recorded separately); `order_tablet` readable for compatibility and history, not emitted by native clients; no destructive migration |
| `TabletDevice` / `TabletEnrollment` (Nest "Order Tablet identity") | Transitional device identity | Current web tablets | TRANSITIONAL; retires when the Android Waiter Tablet migrates |
| `src/pages/order-tablet/`, `OrderTabletPage`, `npm run dev:order-tablet` / `build:order-tablet`, `VITE_APP_MODE=tablet`, the `/order-tablet` route, storage key `verdura-order-tablet-pending-submission-v*` | Web predecessor terminology | The working transitional web tablet | KEEP until the web Order Tablet retires |

Historical documents that use these names are not rewritten.

## 34. Transition, migration and retirement

`[FR §6, §7, §8] [PR-7] [PR-8]`

### 34.1 Principle and vocabulary

Replacement follows PR-8: **build the replacement → migrate callers → prove the behaviour → retire the old dependency.** Temporary overlap needs a source owner, a target owner, cutover and retirement criteria, and a bounded period (PR-7).

| Term | Meaning |
|---|---|
| KEEP | Stays where it is |
| MOVE | Relocate without rewriting |
| MOVE/REFACTOR LATER | Relocate when dependency safety permits; never for visual conformity |
| MIGRATE | Callers move to a new owner, then the old code retires |
| BUILD | New implementation |
| RETIRE / RETIRE LATER | Delete once callers and replacement allow |
| TARGET + IMPLEMENTED (IN TARGET LOCATION) | Permanent component, implemented (in its permanent path) |
| TARGET + PARTIALLY IMPLEMENTED | Permanent component, partly built |
| TARGET + STRUCTURAL SCAFFOLD ONLY | README boundary; no product code |
| TARGET BOUNDARY CREATED | Boundary exists; nothing inside it yet |
| TARGET + EXISTS IN OLD LOCATION | Implemented, not yet in its target path |
| TARGET + NOT YET CREATED | Nothing exists yet |
| TRANSITIONAL | Current implementation that retires once replaced |
| REMOVED | Deleted from the repository |

### 34.2 Transitional and old-location components

| Component | Current location | Target | Disposition |
|---|---|---|---|
| NestJS API (audit, auth, email, health, kiosk, media, menu, orders, prisma, queue, redis, reporting, reservations, staff, tables, tablet, venues, …) | `apps/api/` | Go Core | **TRANSITIONAL, MIGRATE.** Serves every current client; owns auth, staff, media (GCS), reservations and email today. No client calls Go Core yet |
| Schema, migrations and seed | `apps/api/prisma/` (also `local-postgres/`, `shared/menu/`) | `database/` | **Migration authority during the transition** (rule 10). The `database/` boundary may exist, but Prisma schema and migrations are never copied, moved or duplicated before an approved migration-authority task |
| Web Order Tablet (Staff Mode and Guest Mode) | Admin Console build mode `VITE_APP_MODE=tablet` (`apps/web/admin-console/src/pages/order-tablet/`) | `apps/android/waiter-tablet/` | **TRANSITIONAL.** Talks to Nest, including external-POS native rounds. Settlement surface for the reduced first pilot (section 8, ADR 0002 item 8) |
| Web KDS of record | Admin Console build mode `VITE_APP_MODE=kds` (`KitchenDisplayPage`) | `apps/android/kds/` | **TRANSITIONAL.** Uses Nest; Go kitchen tickets (D4) exist but no client uses them |
| Nest Socket.IO realtime (`orderUpdate`) | `apps/api/` | Go Core realtime (D12) | **TRANSITIONAL;** retires with its Nest callers |
| External-POS surfaces in Nest | `apps/api/src/{legacy-external-pos, pos-sync, connector, payment-observation}` and the printer connector dispatch | none | **RETIRE LATER,** per replacement and caller safety. Still live; the web Order Tablet and order creation call them |
| Legacy external-POS .NET projects | `apps/idealpos-bridge/`, `apps/idealpos-bridge-ci/`, `apps/idealpos-harness/`, `apps/venue-connector/` | none | **RETIRE.** Not target architecture; still in commit `a005642`, deleted from the working tree. Any host-installed services are a separate production decision |
| `shared/` | repository root | decomposed by owner | **Not a permanent catch-all.** Decomposed caller by caller: seed and fixtures to `database/`, web config to the owning web app, tooling data to `tooling/`, runtime config to the owning service or app. Not mass-moved |
| `docker/`, `docker-compose.yml`, `windows-deploy/`, `local-postgres/` | repository root | `infrastructure/` (`local-postgres/` → `infrastructure/local-dev/`) | Existing infrastructure; organised under `infrastructure/` where useful, never in a way that breaks tooling. No Go Core image or deployment route exists yet |
| `scripts/`, `shared/local-dev.mjs`, `find_css_rules.py` | repository root | `tooling/` | Existing tooling; MOVE where useful (CI calls `scripts/*.test.mjs`) |
| `DESIGN.md`, `PRODUCT.md` and the flat `docs/` files | repository root, `docs/` | sub-locations under `docs/` | KEEP and reorganise incrementally; audit material is documentation and reports are not duplicated to fill target folders |
| PRD source documents (`docs/product-requirements.md`, `docs/prd.md`, `docs/mvp.md`, `docs/target-operating-model.md`, `PRODUCT.md`, `DESIGN.md`) | as is | — | KEEP as source evidence (see [README.md](README.md)); not moved, deleted or rewritten except by a separate supersession decision |
| Public-home content | `apps/web/customer-website/` | `apps/web/landing-page/` (optional) | MOVE LATER, optional; may be reused when the landing page is built |

### 34.3 Removed legacy applications (owner decision, 2026-10-05)

`[OWNER-2026-10-05] [FR CC-4]`

- **Removed by explicit owner decision:** `apps/kitchen-display/` (README only), `apps/order-tablet/` (README only) and `apps/window-display/` (the React signage app, which also carried the web Customer Kiosk `/order` and `/tables` and a duplicate KDS). The configuration that built, ran or deployed `apps/window-display/` and the deprecated local-disk media copy into it went with them. The untracked `apps/android/order-tablet/` placeholder was also removed.
- **This was not a completed replacement.** The owner intentionally overrode the PR-8 retirement gate. The native successors are structural scaffolds, and the removal is **not** evidence of native replacement or functional parity.
- **Resulting gaps until the native applications exist:**
  - no Window Display, signage or entrance menu display client (WD-1);
  - no web customer-kiosk client (the Nest `POST /api/kiosk/orders` API is unchanged).
- **Unchanged:** the Admin Console KDS and Order Tablet build modes (section 34.2).
- **Production:** the installed `VerduraWindowDisplay` service is not changed by the removal; decommissioning it is a separate operational action.
- **Earlier removals:** the obsolete Stage 2 scaffold (`web/`, `desktop/`, `android/` with `android/apps/<application>/`, `android/core/`, `android/models/`, `android/build-logic/`) was removed under CC-2 on 2026-10-01 after its README content moved to `apps/<platform>/<application>/`. The source coupling in which `apps/window-display/` compiled against `apps/web/customer-website/` source ended with the 2026-10-05 removal (rule 9 prevents its recurrence).

### 34.4 Deferred non-architectural decisions

These change no ownership boundary and are decided case by case when the capability is next implemented or migrated:
- **when** each MOVE/REFACTOR LATER or MOVE/CONSOLIDATE LATER happens (`internal/platform/`, `internal/config/`, `internal/ratelimit/`, `internal/pricing/`, `internal/refunds/`);
- the order and pace of the Customer Website's incremental TypeScript migration (no wholesale rewrite first);
- which public-home content, if any, is reused for the landing page;
- the exact `docs/` sub-locations (including `DESIGN.md`, `PRODUCT.md`, `docs/audit/` and `docs/audits/`);
- how `shared/` is decomposed;
- the Android Gradle root and build-logic placement (an implementation choice within the decided O-10 baseline, volume 00 §00.10.7);
- when the web Order Tablet and the web KDS mode retire, governed by caller and replacement safety (PR-8).

## 35. Planning infrastructure

`[FR CC-1, §8.C]`

- **`PRD/` is the authoritative requirements and architecture source** for planning. It is documentation and planning infrastructure, not runtime or product code.
- **`docs/planning/` is planning output,** not a PRD input.
- **The old BMAD setup** (`_bmad/`, `_bmad-output/`, the old `.claude/skills/bmad-*` skills) was removed on 2026-10-01 at the owner's instruction. It is not restored and is not a source of requirements, architecture or planning.
- **The fresh official BMAD method** is installed only after `PRD/` approval. Its runtime and output locations are whatever its installer creates. It is planning infrastructure, not product architecture, and its planning is generated from `PRD/`.

## 36. Implementation procedure and change history

### 36.1 Implementation procedure

The structure was set in Stage 1 (structure source of truth) and Stage 2 (scaffold of the approved boundaries, no product behaviour). **Stage 3** implements the product step by step inside the approved structure. For every capability:
1. identify the target path (Part C);
2. inspect the existing implementation;
3. KEEP, MOVE, MIGRATE or BUILD as appropriate;
4. implement;
5. test;
6. update documentation;
7. proceed to the next capability.

The overall repository structure is not redesigned during Stage 3.

### 36.2 Change records

| ID | Date | Change | Status |
|---|---|---|---|
| CC-1 | 2026-10-01 | Adds the `PRD/` boundary as the authoritative requirements source; classifies `docs/planning/` as output; records the removal of the old BMAD setup and the order "`PRD/` approved → fresh BMAD install" (section 35) | APPROVED 2026-10-01 |
| CC-2 | 2026-10-01 | Adopts the monorepo convention (section 30.1): deployable clients under `apps/<platform>/<application>/`, services under `services/`, reusable code under `packages/`. The Admin Console and Customer Website moved to `apps/web/`; the obsolete `web/`, `desktop/` and `android/` scaffold was removed | APPROVED 2026-10-01 |
| CC-3 | 2026-10-02 | Tablet consolidation: `apps/android/waiter-tablet/` is the single tablet ordering application with Staff Mode and Guest Mode; the separate Customer Order Tablet (`apps/android/order-tablet/`) is merged into Guest Mode and removed; no data or schema value changes (sections 8, 32, 33) | APPROVED 2026-10-02 (owner decision) |
| CC-4 | 2026-10-05 | Removal of `apps/kitchen-display/`, `apps/order-tablet/` and `apps/window-display/` by owner decision, overriding the replacement gate; not evidence of native parity (section 34.3) | APPROVED 2026-10-05 (owner decision) |
| — | 2026-10-05 | `fileRestructure.md` consolidated into this document (Part C) and deleted, by owner decision | APPROVED 2026-10-05 (owner decision) |
| — | 2026-10-05 | O-10 (Android engineering baseline) and O-13 (per-device, venue-bound KDS identity) recorded as decided `[ORCH-T2-2026-10-05]`; sections 32 and 34.4 point to volume 00 §00.10.7. No ownership boundary changes | RATIFIED 2026-10-05 (orchestrator Tier 2; not an owner decision) |

**Former `fileRestructure.md` section → this document** (for `[FR §…]` citations): §1 and §9 → 28; §2 → 29 (applications: 4); §3 and §4 rules → 30; §4.1 → 30.3, 32 and 35; §4.2 → 30.1–30.2; §5 → 31; §6 and §7 → 4 and 34; §8.A–8.B → 30.3 and 34.4; §8.C → 35; §8.D–8.E → 34.3; §8.F → 32–33; §9.1 → 36.2; §10 → 36.1.
