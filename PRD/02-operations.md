# Servvia PRD — Volume 02: Operations

> **Status:** Normative Servvia domain volume, version label **v5.1 (Servvia)**, last updated 2026-10-05.
> **Authority:** subordinate to [`product-requirements.md`](product-requirements.md) ("SPRD"), which wins on any conflict, and to [`00-overview-and-conventions.md`](00-overview-and-conventions.md) (conventions, INV-1 to INV-22, DEC-X decisions). This volume refines SPRD §5–§9, §11–§13, §17–§18 and Part C for the service day; it does not override them.
> **Provenance:** Servvia baseline (SPRD, ADR 0001, ADR 0002, decisions log), verified repository state of 2026-10-05 for CURRENT and TRANSITIONAL labels (Go Core D2–D13 migration notes, `contracts/`, Prisma schema), enterprise hardening derived from SPRD Part B, and adapted domain mechanisms mined from Verdura v5.2 Volume 02 and Appendix A (non-authoritative source material; classification matrix kept as handoff evidence). Verdura's POS-handoff thesis, IdealPOS connector, POS-authoritative totals and browser device targets are **superseded** and appear here only as TRANSITIONAL legacy or as explicit exclusions.
> **Windows POS:** frozen. Nothing in this volume defines POS screens, cashier UX, POS workflows, POS hardware or POS offline behaviour (SPRD §12, §31).
> **Acceptance:** **NORMATIVE BASELINE ACCEPTED 2026-10-05** (SERVVIA PRD NORMATIVE BASELINE ACCEPTED; record in volume 00 §00.1.3). This volume is a normative refinement of [`product-requirements.md`](product-requirements.md), which wins on any conflict. Acceptance does not commit future-delivery capabilities to a release, select open policy values, approve production or release, or certify compliance.

## 02.1 Purpose, scope and state

**Purpose.** Operations owns the live service day: who is coming (reservations), who is here (tables and visits), what they asked for (orders and rounds), what the kitchen must make (kitchen tickets, KDS, KOT printing), what cannot be sold (availability, "86"), and how staff see and recover every failure. Operations hands the financial obligation to Finance at the check boundary.

**Boundaries.**

| Neighbour | Owns | Operations' relationship |
|---|---|---|
| 07 Finance | Check rules, payment, settlement, refunds, reversals, shifts and cash, financial reconciliation | Operations covers only the operational touchpoints: requesting a check over unbilled lines, initiating payment from a service surface, showing uncertain outcomes, and the visit-close gate (02.4.4) |
| 09 Administration | Menu administration (MENU-1 to MENU-5), table configuration UI (TBL-1), printers (ADM-2), devices and terminals (D8), staff and roles (STF-1), venue settings (VEN-1), venue operating profiles (dine-in, QSR/takeaway, hybrid; server-enforced capability enablement, DEC-ADMIN-10) | Operations consumes the configuration; it defines the runtime behaviour. Operating profiles are defined in 09 and only referenced here (OPS-89) |
| 01 Home | Operational home, notifications, tasks | Operations produces the exception items (02.4.12) that 01 surfaces |
| 08 Reports and BI | Metric semantics and reports (RPT-1, RPT-2) | 02.12 defines operational metric inputs only |
| 03 / 04 | Recipes, stock | Stock-driven availability and consumption emission are TARGET CAPABILITY — FUTURE DELIVERY dependencies (02.14) |
| 05 CRM | Guest identity and consent | Reservation guest data is transactional identity only; it implies no marketing consent |
| 06 Workforce | Rosters and employment | Server assignment to tables and service areas (OPS-90) uses 06 roster periods where Workforce exists; staff-to-station assignment is FUTURE (02.14) |

**State.**

| Capability | State | Basis |
|---|---|---|
| Reservations (RES-1 to RES-3, RES-5; ADM-1) | TRANSITIONAL (Nest `reservations` module, Customer Website, Admin Console); Core owner open (O-7) | S |
| Reservation calendar sync and card payment (RES-4) | Calendar sync: TARGET CAPABILITY — FUTURE DELIVERY (O-16 inclusion resolved 2026-10-05; provider is an adapter choice). Reservation card payment: OWNER DECISION REQUIRED (O-16). Nest carries transitional fields | S+K(L145) |
| Waitlist and walk-in queue | TARGET CAPABILITY — FUTURE DELIVERY (policy DEC-OPS-23 residual, paging channels DEC-X-15) | V(02 §3.9, §5.9)+K(L25, L231) |
| Table configuration (TBL-1) | TRANSITIONAL (Nest `tables`); Core reads tables | S |
| Visit (TableSession) open, covers, close, cancel | TARGET (implemented in Core D2 and D10, not in production) | S |
| Visit transfer, merge, split | Transfer: TARGET (mechanism approved 2026-10-05: DEC-OPS-5). Visit merge and split: FUTURE (not KitchenOS-described; bill split and merge are volume 07) | S+V(02 §3.8)+A |
| Orders and rounds (ORD-1 to ORD-5) | TARGET (implemented in Core D3, D11, not in production); TRANSITIONAL Nest order paths serve all clients | S |
| Order and line cancellation, void, comp | ARCHITECTURE DECISION REQUIRED (none in Core; DEC-OPS-1) | S+D |
| Waiter Tablet Staff Mode (WT-1, WT-2, WT-5) | TARGET (Android scaffold only); TRANSITIONAL web Order Tablet (Admin Console `VITE_APP_MODE=tablet`) | S |
| Waiter Tablet Guest Mode (WT-3, WT-4) | TARGET (UX not defined; excluded from the first pilot by ADR 0002); Core guest order path not built (decisions O-21 and DEC-OPS-8 resolved; implementation incomplete) | S |
| Kiosk (KSK-1 to KSK-5) | TARGET (Android scaffold only); no current client since 2026-10-05; Nest `POST /api/kiosk/orders` TRANSITIONAL | S |
| Window Display / entrance menu (WD-1) | TARGET (Android scaffold only); no current client since 2026-10-05 (SPRD §34.3) | S |
| Kitchen tickets and KDS (KIT-1 to KIT-6) | TARGET (implemented in Core D4, not in production); TRANSITIONAL web KDS (Admin Console `VITE_APP_MODE=kds`) on Nest `Order.status` | S |
| Station routing | TARGET; Core routes to a single station `kitchen` today; data model ARCHITECTURE DECISION REQUIRED (DEC-OPS-4) | S+D |
| KOT printing (PRT-1 to PRT-3) | TARGET via Venue Edge (scaffold only); TRANSITIONAL Nest `Printer` / `PrinterJob`; required at the pilot only if the venue requires it (SPRD §11) | S |
| Availability "86" (MENU-6, AVL-1) | TRANSITIONAL (Nest menu availability and channel menu); per-channel propagation state TARGET; channels open (O-17) | S |
| Auto-86 (sell-through counter, scheduled restore) | FUTURE | V(02 §3.6) |
| Stock-driven 86 | TARGET CAPABILITY — FUTURE DELIVERY (depends on 03 and 04; O-9 inclusion resolved) | V(02 §3.6)+K(L203) |
| Check request and payment initiation (operational touchpoints) | TARGET (implemented in Core D5–D7, D9, not in production); rules in 07 | S |
| Realtime operational views (NFR-RT) | TARGET (Core D12, not in production); TRANSITIONAL Nest Socket.IO `orderUpdate` | S |
| Operational exception and recovery queue | TARGET (SPRD §15 row N, §17.10, §18.5, AVL-1, PRT-2); not created | S+E |
| Public web ordering or pre-ordering (WEB-5) | TARGET CAPABILITY — FUTURE DELIVERY (inclusion resolved in O-18; scope details, payment flow and channels open under O-18) | S+K(L195) |
| Phone orders (staff-entered channel) | TARGET CAPABILITY — FUTURE DELIVERY (OPS-88; policy DEC-OPS-24) | S (§13)+K(L195) |
| Counter and walk-in takeaway ordering (QSR) on Waiter Tablet Staff Mode and kiosk | TARGET CAPABILITY — FUTURE DELIVERY (OPS-89; takeaway mechanics TARGET, OPS-29; throughput DEC-X-8; operating profile in 09) | S (§13, OPS-29)+K(L21–27) |
| Server assignment to tables and service areas | TARGET CAPABILITY — FUTURE DELIVERY (OPS-90) | S (§13)+K(L196) |
| Order modification after acceptance (new round or compensating void) | TARGET (OPS-91; new rounds implemented in Core; compensating removals per DEC-OPS-1, not implemented) | S+A+K(L315) |
| Courses, fire and hold, expo, ticket priority, new-ticket audible alert | TARGET CAPABILITY — FUTURE DELIVERY (OPS-60, OPS-92, OPS-93; policy DEC-OPS-18) | V(02 §3.7)+K(L16, L197, L403, L406) |
| Delivery aggregators, channel pause, courier handoff | TARGET CAPABILITY — FUTURE DELIVERY (delivery model DEC-OPS-25; each sub-capability's policy open) | V(02 §3.10)+K(L27, L195, L426–433) |
| Catering and events | FUTURE (not described by KitchenOS; see DEC-OPS-23) | V(02 §3.11) |
| Signage playlists beyond WD-1, interactive window reservation | FUTURE | V(02 §3.13) |
| Staff operations: checklists | TARGET CAPABILITY — FUTURE DELIVERY (policy open) | V(02 §3.14)+K(L246) |
| Staff operations: handover notes, incident log, station assignment | FUTURE | V(02 §3.14) |
| Windows POS operational workflows | DEFERRED (PENDING USER POS ANALYSIS REPORT) | S |
| External-POS (IdealPOS) handoff, sync and connector surfaces | TRANSITIONAL (Nest, RETIRE LATER, SPRD §34.2); never target | S |

## 02.2 Actors and surfaces

**Actors** (Servvia roles are owner, admin, manager, cashier, kitchen, viewer; any extension is DEC-X-2).

| Actor | Identity class (INV-3) | Operational needs |
|---|---|---|
| Owner, admin | Human staff | Configuration, oversight, exception resolution, all operational actions in their venues |
| Manager | Human staff | Reservations, visits, live orders, availability, corrections with step-up (02.7) |
| Cashier | Human staff | Visits, orders and rounds, check request, payment initiation |
| Waiter (staff operating the Waiter Tablet in Staff Mode) | Human staff via an elevated tablet | Visit-scoped ordering; role mapping per DEC-X-2 |
| Kitchen staff | Human staff, or the KDS device | Advance kitchen tickets; never place orders |
| Viewer | Human staff | Read-only views where granted |
| Guest at a table tablet (Guest Mode) | Device / guest session (never staff) | Customer-operated table ordering (WT-3); UX not defined |
| Kiosk customer | Device / guest session | Self-service ordering (KSK-1) |
| Public website guest | Anonymous or guest | Menu, reservations (WEB-2); ordering open (O-18) |
| Devices | D8 device credential (`pos_terminal`, `order_tablet`, `kds`, `payment_adapter`) | Venue-bound, revocable; a device kind grants no staff authority |
| Venue Edge | Venue-bound edge identity (EDGE-2) | Printer and payment-terminal execution; reports outcomes |
| System | Worker or projector (D13, D4) | Kitchen projection, realtime fan-out, sweeps |

**Surfaces.**

| Surface | Operational role | State |
|---|---|---|
| Waiter Tablet (`apps/android/waiter-tablet/`) | Staff Mode ordering and visit management; Guest Mode customer ordering on the same visit | TARGET; web Order Tablet TRANSITIONAL predecessor and first-pilot settlement surface (ADR 0002 item 8) |
| KDS (`apps/android/kds/`) | Kitchen ticket display and progression | TARGET; Admin Console KDS mode TRANSITIONAL |
| Kiosk (`apps/android/kiosk/`) | Customer self-service ordering | TARGET; no current client |
| Window Display (`apps/android/window-display/`) | Entrance menu display, promotions and signage (read-only) | TARGET; no current client |
| Admin Console | Reservations and live orders (ADM-1), printers (ADM-2), menu and availability, exception queue | TARGET + implemented on Nest |
| Customer Website | Menu, booking journey (WEB-1, WEB-2) | TARGET + implemented on Nest |
| Windows POS | Main terminal | DEFERRED (frozen) |
| Venue Edge | Printers, payment terminals, local queue (EDGE-1 to EDGE-3) | TARGET; scaffold only |

## 02.3 Domain model and ownership

```text
Organization 1─N Venue 1─N Table 1─N TableSession (visit; at most one open per table)
Venue 1─N Reservation 0..1─0..1 TableSession            (link model: DEC-OPS-2)
TableSession 1─N Order (dine_in)        Order (takeaway) has no TableSession
Order 1─N OrderRound 1─N OrderItem (modifier options by ID; seat; notes; commercial snapshot)
OrderRound 0..1─1 AppliedPromotion (frozen snapshot, D11)
OrderRound ─► OutboxEvent order.round_submitted ─► KitchenTicket (one per round per station)
KitchenTicket 1─N KitchenTicketLine (one per OrderItem)   KitchenTicket 1─N KitchenTicketTransition
KitchenTicket ─► PrintJob (per station printer; owner DEC-OPS-16) ─► Venue Edge command
TableSession / Order ─► Check 1─N CheckLine (an OrderItem on at most one standing check) ─► Payment   [07]
MenuItem 1─N AvailabilityChange 1─N ChannelPropagation (per O-17 channel)
Any operational entity 0..N─1 OperationalException
Every canonical change ─► AuditLog + RealtimeEvent (same transaction)
```

| Entity | Meaning | Canonical owner (target) | Today |
|---|---|---|---|
| Table | Physical table: number, name, capacity (TBL-1) | Core `internal/tables` | Nest `tables` (TRANSITIONAL); Core reads |
| Service area | The "service area" level of the SPRD §8 context | Not decided (DEC-OPS-6) | Not created |
| TableSession | The visit: status, covers, opened-by, version, timestamps | Core `internal/tables` | Implemented in Core (D2, D10), not in production |
| Reservation | Booking: reference, guest, party, slot, status | Core package not in Part C (O-7, DEC-X-13) | Nest `reservations` (TRANSITIONAL) |
| WaitlistEntry | Walk-in queue entry | Not created | TARGET CAPABILITY — FUTURE DELIVERY |
| ServerAssignment | Staff assigned to a visit, table or service area for a period (OPS-90) | Core (package per DEC-X-13 when committed) | Not created; TARGET CAPABILITY — FUTURE DELIVERY |
| Order, OrderRound, OrderItem | What was requested, by round, with immutable commercial snapshot | Core `internal/orders` | Implemented in Core (D3); Nest `orders` TRANSITIONAL |
| AppliedPromotion | Frozen promotion evaluation per round | Core `internal/promotions` + `internal/pricing` | Implemented in Core (D11) |
| KitchenTicket, KitchenTicketLine, KitchenTicketTransition | What the kitchen must prepare, per station; progress history | Core `internal/kitchen` | Implemented in Core (D4); Nest `Order.status` + `KdsDeliveryRecord` TRANSITIONAL |
| Station | Kitchen production point | Core `internal/kitchen` | A fixed string `kitchen` (no station data) |
| Printer, PrintJob | Physical printer configuration; one KOT/receipt print attempt lineage | Configuration: Core (DEC-OPS-16); execution: Venue Edge | Nest `Printer`, `PrinterJob` (TRANSITIONAL) |
| Item availability | Whether a menu item can be sold at a venue | Core `internal/menu` (availability) | Nest menu (`isAvailable`, venue override) TRANSITIONAL; Core menu read partial |
| AvailabilityChange, ChannelPropagation | The audited 86/restore fact and its per-channel delivery state | Core `internal/menu` (DEC-OPS-14) | Not created |
| Check, Payment | Obligation and its satisfaction | Core `internal/checks`, `internal/payments` | Implemented in Core (D5, D6); rules in 07 |
| OperationalException | A staff-visible item needing recovery | Core (package per DEC-X-13) | Not created |
| Device, Terminal | Enrolled hardware and logical terminal | Core `internal/devices` (09) | Implemented in Core (D8) |

## 02.4 Business objects and lifecycles

### 02.4.1 Reservation

- **Fields that matter:** server-generated, collision-checked booking reference (RES-1, INV-9); venue; guest contact (Personal class); party size; date and time slot in venue time (INV-8); occasion and special requests (may contain health or dietary information, 02.8); source; status; status timestamps and actor.
- **Lifecycle (RES-1):** `pending → confirmed → seated → completed`; `pending` or `confirmed → cancelled`; `confirmed → no_show`. Every other transition is refused (INV-10).
- **Invariants:**
  - A reservation is not a sale (OPS-6). It creates no order, check, payment or kitchen work.
  - Capacity is enforced per slot without overbooking under concurrency (RES-3).
  - **TRANSITIONAL fields.** The Nest `Reservation` row also carries `menuSelections`, `menuTotal`, `paymentMethod`, `paymentStatus`, a provider payment-intent reference and calendar-sync state. These are not orders and not financial records of the target model; their disposition is DEC-OPS-20 with O-16 and O-18.

### 02.4.2 Waitlist entry (TARGET CAPABILITY — FUTURE DELIVERY)

Party name, size, quoted wait, contact for notification, status `waiting → notified → seated | abandoned | removed`, link to the visit opened on seating. Owner-approved capability (DEC-X-1, K(L25, L231)); not in committed current delivery scope; delivery phase DEC-X-17 (02.14).

### 02.4.3 Table

TBL-1 fields. **Occupancy is derived, never stored:** a table is occupied exactly when it has an open TableSession. Verdura's stored table states (`Seated`, `Ordered`, `MainsFired`, `BillRequested`, `Dirty`…) are not adopted as canonical state; display derivations from visit, order, kitchen and check state are FUTURE.

### 02.4.4 TableSession (visit)

- **Fields:** id, table, status, covers, opened-by staff, open request key, version, opened, closed and updated timestamps.
- **Lifecycle:** `open → closed` (financially complete) or `open → cancelled` (opened in error, no orders). Both terminal.
- **Invariants (implemented in Core, not in production):**
  - at most one open session per table (partial unique index);
  - a session order is dine-in, and an order's table is its session's table (composite foreign key; the table is never taken from the client);
  - cancel is refused once any order exists;
  - close requires financial completeness: zero standing open checks, zero unbilled round lines of non-cancelled orders, zero pending or uncertain payments, zero pending or uncertain refunds and reversals; kitchen state is not consulted; refusal returns `VISIT_NOT_FINANCIALLY_COMPLETE` with the four counts;
  - close and cancel are idempotent by state; a stale version on an open session is `VERSION_CONFLICT`;
  - after close, new orders, rounds and checks are refused (`TABLE_SESSION_NOT_OPEN`); payment results, refunds, reversals, re-settlement and check voids still apply and never reopen the visit;
  - global lock order TableSession → Order → Check → CheckPayment → Shift (OPS-76).

### 02.4.5 Order and round

- **Order fields:** opaque id and human-readable number (SPRD §5), venue, table session (dine-in) or none (takeaway), service mode `dine_in` or `takeaway`, source channel, status, totals (integer minor units, INV-6), idempotency key, provenance (02.4.6), version, timestamps.
- **Round fields:** per-order sequence and request key (both unique), lines with product, quantity, modifier option IDs (PR-6), seat, notes, priced snapshot, applied promotion snapshot.
- **Lifecycle in Core today:** an order is created `confirmed` and has no further transitions; completion and cancellation do not exist (DEC-OPS-1, DEC-OPS-7). The legacy Nest `OrderStatus` chain (`pending → confirmed → preparing → ready → completed`, `cancelled`) is TRANSITIONAL and is driven by the legacy KDS.
- **Invariants:** ORD-1 to ORD-5. Totals are recomputed over every round. The idempotency fingerprint covers venue, source, service mode, session, notes and per-line product, quantity, options, notes and seat, and never prices; a replay is decided before pricing and returns the original even if the menu has since changed. A visit may hold several orders; accidental duplicates are prevented by idempotency keys, not by a cap.

### 02.4.6 Order provenance

| Concept (SPRD §32) | Recorded as | State |
|---|---|---|
| Source channel | `pos_terminal`, `waiter_tablet`, `order_tablet`, `kiosk`, `customer_web` (Core); `staff`, `online` legacy only, never written by Core | TARGET (Core); TRANSITIONAL (Nest) |
| Application identity | The calling application (for example `waiter-tablet`) | TARGET; recording mechanism not yet in contracts (OPS-2) |
| Operating mode | Staff Mode or Guest Mode | TARGET (O-21 decided 2026-10-05, 00.10.6; established server-side from the verified credential, recorded per round; implementation incomplete) |
| Actor | Staff identity, or device / guest-session identity, with identity class (INV-3) | TARGET |
| Device | D8 device or tablet identity | TARGET |
| Correlation | Request and correlation IDs (SPRD §20.1) | TARGET |

**Source-to-credential binding (Core, implemented):** a staff login may declare `pos_terminal`; a staff-elevated tablet may declare `waiter_tablet` or `order_tablet`; `kiosk` and `customer_web` are refused until a customer credential model exists (DEC-OPS-8). The meaning of the two tablet sources is decided by O-21 (00.10.6, SPRD §33): `waiter_tablet` is the Waiter Tablet family in both modes; `order_tablet` stays readable but is not emitted by native clients.

### 02.4.7 Kitchen ticket

- **Creation:** projected from the durable `order.round_submitted` event, one ticket per round per station, one ticket line per order line; lines snapshot title, quantity, modifiers, notes and seat so a ticket survives menu changes.
- **Lifecycle (Core D4):** `new → acknowledged → preparing → ready → completed` (acknowledged optional); `completed → recalled → preparing / ready / completed`. Kitchen state never writes `Order.status`.
- **Invariants:** version compare-and-set (`VERSION_CONFLICT`); a request for the current status returns unchanged; every change appends a `KitchenTicketTransition` with the token subject, kind and role; projection is idempotent through unique keys `(roundId, station)` and `(orderItemId)`; projection retries with bounded backoff and parks the event after its attempt limit.
- **Missing:** ticket and line cancellation (depends on DEC-OPS-1); line-level status (UIs hold it in memory today).

### 02.4.8 Print job (KOT)

- **Semantic states (target, adapted from the transitional Nest `PrintJobStatus`):** `queued → dispatching → delivered → printed`, with exits `failed`, `uncertain`, `manual`, `cancelled`.
  - `delivered` means the transport accepted the bytes; it is not evidence of printing.
  - `printed` requires a device acknowledgement where the hardware supports one (O-4).
  - `uncertain` (interrupted dispatch) is never retried automatically; it is resolved by an explicit, attributed reprint or dismissal (PAY-6 by analogy, PRT-1).
  - `manual` means no trusted automated path exists; staff handle it.
- **Invariants:** each KOT prints once per station; reprints are explicit, attributed new attempts linked to the original (PRT-1); bounded retry then `failed` with an Admin alert (PRT-2). The legacy `connector_dispatched` value belongs to the external-POS connector path and retires with it.

### 02.4.9 Availability change

- **Item availability** is a venue-effective flag (organization value with venue override, MENU-4). An AvailabilityChange records item, action (86 or restore), scope (venue; channel-scoped 86 per DEC-OPS-14), actor, device, reason (DEC-OPS-15), time and correlation.
- **ChannelPropagation** per in-scope channel (O-17): `pending → confirmed` or `pending → failed → (retry) pending`; a `failed` propagation opens an OperationalException (AVL-1).
- **Channel display policy (TRANSITIONAL, Nest channel menu):** `order_tablet` returns 86'd items flagged unavailable for dimmed display; `customer_website` and `window_display` omit them. Kiosk has no menu channel value today (DEC-OPS-9). Guest Mode display policy is not decided by O-21 (provenance only); it is open under P9 and needed only when Guest Mode is built.

### 02.4.10 Check (operational touchpoint; rules in 07)

`open → settled` or `open → voided`. A check is created over a visit's or orders' unbilled lines; the request names the session or orders, never an amount. An order line is on at most one standing check; several checks per visit allow split bills.

### 02.4.11 Payment (operational touchpoint; rules in 07)

`pending → succeeded / failed / uncertain` (and `uncertain → succeeded / failed` on reconciliation). Card outcomes come only from the trusted payment adapter via Venue Edge (CARD3, ADR 0002); cash requires an open shift (`NO_OPEN_SHIFT`).

### 02.4.12 Operational exception

- **Fields:** kind, venue, linked entity (type and id), cause key, first detected, last observed, state, allowed actions, assignee (optional), resolver, resolution note, resolution time, correlation.
- **Lifecycle:** `open → acknowledged → resolved`, or `open / acknowledged → dismissed` (reason required). An item auto-resolves only when Core verifies the underlying state is resolved.
- **Kinds (minimum):** parked kitchen projection event; print job `failed`, `uncertain` or `manual`; availability propagation `failed`; Venue Edge offline or queue age beyond threshold; realtime publication failure surfaced by health; legacy external-POS item while TRANSITIONAL. Payment and cash reconciliation items are 07's and are linked, not duplicated.
- **Invariant:** one open item per (cause key, linked entity); severity scale and ageing thresholds are DEC-OPS-17.

## 02.5 Requirements

SPRD requirements are cited, not restated. "Implemented in Core" means tested on disposable databases, not in production, used by no client (00.4.3).

### 02.5.1 Ownership, channels and provenance

| ID | Requirement | Priority | State | Basis |
|---|---|---|---|---|
| OPS-1 | Every operational surface reads and writes service-day state only through `contracts/` APIs. No aggregate is written by both the Nest and Core paths except through a documented temporary bridge with retirement criteria (for example the D3 table-occupancy bridge). | MUST | TARGET | S (PR-1, PR-7, §34.2)+E |
| OPS-2 | Every order and round records source channel, application identity, actor identity and identity class, device identity and correlation ID (INV-5). Operating mode, actor class and actor or guest-session identity are recorded per order and per round, established server-side, as specified by O-21 (00.10.6); retries and replays keep the original provenance. Application identity is carried in the order contract before any Android client is switched. | MUST | TARGET | S (§5, WT-6, §32)+E |
| OPS-3 | Core refuses a declared source channel that the verified credential is not entitled to (02.4.6), with a stable error and no order. | MUST | TARGET (implemented in Core) | S (D3) |
| OPS-4 | The source-channel set is closed and versioned in `contracts/`. A new channel (delivery aggregator, catering, reservation pre-order, public web) requires a contract change and its scope decision. | MUST | TARGET | E+D (DEC-X-1, O-18) |
| OPS-5 | No target operational state, field or step depends on an external POS: no "awaiting POS" state, no POS handoff, no POS-returned totals and no kitchen release gated on POS acceptance. Kitchen release follows ORD-1 with PAY-1 or PAY-2. | MUST | TARGET | S (ADR 0001, §1) |

### 02.5.2 Reservations

| ID | Requirement | Priority | State | Basis |
|---|---|---|---|---|
| OPS-6 | A reservation is not a sale. Creating, confirming, seating, completing, cancelling or no-showing a reservation creates no order, check, payment, kitchen ticket or print job. A chargeable obligation arises only when a Core order is created (on the seated visit, or through a pre-order or deposit flow only if approved under O-16 or O-18). | MUST | TARGET | S (00.3)+V(02 §3.9, A.4) |
| OPS-7 | The RES-1 lifecycle is enforced server-side as an explicit state machine. Each transition records actor, identity class, time and, for cancellation and no-show, the reason; an illegal transition is refused with a stable code and changes nothing. | MUST | TRANSITIONAL (Nest); TARGET (Core, O-7) | S (RES-1, INV-10)+E |
| OPS-8 | Reservation capacity (RES-3) is enforced for every booking path (Customer Website, Admin Console, staff entry) by one server-side check under a lock or constraint, proven by a concurrency test with no overbooking. Whether staff may exceed capacity is DEC-OPS-3; if allowed, the override requires a permitted role, a reason and an audit record. | MUST | TRANSITIONAL (Nest) | S (RES-3)+V(02 §3.9)+D |
| OPS-9 | Reservation changes (party size, slot) re-run the capacity check and use version compare-and-set; a concurrent change returns a conflict, never a silent overwrite. | MUST | TARGET | S (RES-3, INV-10)+E |
| OPS-10 | Seating a reservation links it to the visit opened for its table; a visit may exist without a reservation (walk-in). The link model and the Core reservation owner are decided together (DEC-OPS-2, O-7). | SHOULD | TARGET (mechanism approved 2026-10-05: DEC-OPS-2; reservation ownership O-7 open) | S (RES-1)+V(02 §3.8–3.9)+D |
| OPS-11 | The transitional reservation fields `menuSelections`, `menuTotal`, `paymentStatus` and the provider payment-intent reference are not orders and not financial records. No new behaviour is built on them; any approved pre-order or deposit flow creates a Core order (and, through 07, check and payment). | MUST | TRANSITIONAL | S (O-16, O-18)+V(A.4)+D (DEC-OPS-20) |
| OPS-12 | Each reservation records its source from a closed set; today Customer Website and staff entry through the Admin Console. Third-party platform, telephone-integration and window-display sources are FUTURE. | SHOULD | TRANSITIONAL | V(02 §3.9)+E |
| OPS-13 | Reservation emails (RES-2, RES-5) have an explicit delivery state visible to staff; a failed send is shown and retryable, never reported as sent. | SHOULD | TRANSITIONAL (Nest email) | S (RES-2, PR-4)+E |
| OPS-14 | Marking no-show is a manual staff action (ADM-1). An automated no-show sweep, reminders and no-show fees are FUTURE; fees depend on O-16. | SHOULD | TRANSITIONAL | S (ADM-1)+V(02 WF-O6) |

### 02.5.3 Tables and visits

| ID | Requirement | Priority | State | Basis |
|---|---|---|---|---|
| OPS-15 | Table occupancy is derived from the open TableSession; no separately stored table status can disagree with it. | MUST | TARGET (implemented in Core) | S (D2, D3) |
| OPS-16 | Opening a visit is idempotent by request key; concurrent opens on one table yield exactly one open session and a stable conflict for the others. | MUST | TARGET (implemented in Core) | S (D2)+E |
| OPS-17 | Covers are recorded on the visit and changed with version compare-and-set. `Order.guests` is legacy only. | MUST | TARGET (implemented in Core) | S (D2) |
| OPS-18 | Closing a visit applies the financial-completeness rule (02.4.4). On refusal the surface shows which of the four obligations block close and offers the operational next step (request check, resolve payment, view exception). The client never asserts readiness. | MUST | TARGET (implemented in Core; UX not built) | S (D10, §15 row N) |
| OPS-19 | Cancelling a visit is allowed only while it has no orders. | MUST | TARGET (implemented in Core) | S (D2, D10) |
| OPS-20 | A closed visit refuses new orders, rounds and checks; post-close financial corrections apply without reopening it. | MUST | TARGET (implemented in Core) | S (D10) |
| OPS-21 | Moving a visit to another table, merging visits and splitting a visit are not available until DEC-OPS-5 is decided. When built, each preserves the session identity or explicit lineage, takes the session locks in the global order, is idempotent and audited, and never moves billed or settled money silently. | MUST (mechanism) | TARGET (mechanism approved 2026-10-05: DEC-OPS-5); visit merge and split: FUTURE (not described by KitchenOS, whose bill split and merge are FIN-5 and FIN-51 in volume 07) | S (D2 notes)+V(02 §3.8)+D |
| OPS-22 | During transition a table is occupied by exactly one model: the Nest order path refuses a table order while a Core session is open, and Core refuses to open a session while a session-less Nest order is active. The bridge is deleted when table order creation moves to Core. | MUST | TRANSITIONAL | S (D3 bridge, PR-7) |
| OPS-23 | Whether "service area" (SPRD §8) is a first-class entity with tables assigned to it is decided before any floor or section view is built (DEC-OPS-6). The floor-plan editor stays deferred (SPRD §13). | SHOULD | TARGET (mechanism approved 2026-10-05: DEC-OPS-6) | S (§8, §13)+D |

### 02.5.4 Ordering

| ID | Requirement | Priority | State | Basis |
|---|---|---|---|---|
| OPS-24 | Order creation and round submission follow ORD-1 to ORD-5. A visit may hold several orders and each order several rounds; each round is an immutable commercial snapshot, and order totals are recomputed server-side over all rounds. | MUST | TARGET (implemented in Core) | S (ORD-1–5, D3) |
| OPS-25 | A client generates one idempotency key per user submit intent and reuses it on every retry of that intent, including after an app restart while the draft is preserved. A changed draft uses a new key. Reusing a key with different content returns `IDEMPOTENCY_CONFLICT` and changes nothing. | MUST | TARGET | S (ORD-3, INV-12)+E |
| OPS-26 | Any amount a client shows before Core's response is labelled an estimate; after acceptance the client shows only Core-returned amounts (INV-6). | MUST | TARGET | S (PR-3, ORD-2) |
| OPS-27 | When submission is refused for menu reasons (ORD-4: unavailable item, invalid option, stale price, unsupported tax configuration), the client refetches the menu, marks the affected lines and requires the user to change the draft; it never resubmits altered content automatically. | MUST | TARGET | S (ORD-4)+E |
| OPS-28 | Lines carry modifier option IDs (PR-6), optional seat and notes. Courses, fire and hold, and per-course pacing are FUTURE (DEC-OPS-18). | MUST (IDs, seat, notes) | TARGET (implemented in Core) | S (PR-6, D3)+V(02 §3.2) |
| OPS-29 | Takeaway orders have no visit, carry `serviceMode = takeaway` and follow the same idempotency, pricing and kitchen rules. Their billing and closure follow 07. | MUST | TARGET (implemented in Core) | S (D3) |
| OPS-30 | Allergens are shown during browsing on every ordering surface (MENU-2): both Waiter Tablet modes and the kiosk. An explicit allergen acknowledgement at ordering or at the KDS is DEC-OPS-19. | MUST (display) | TARGET | S (MENU-2)+V(02 §3.7)+D |
| OPS-31 | When an order is complete, and how order status relates to kitchen and check state in Core, is decided before any client shows an order lifecycle beyond `confirmed` (DEC-OPS-7). Kitchen progress is never written to the order. | MUST | TARGET (mechanism approved 2026-10-05: DEC-OPS-7) | S (D3, D4)+D |

### 02.5.5 Corrections, cancellation and manager authorization

| ID | Requirement | Priority | State | Basis |
|---|---|---|---|---|
| OPS-32 | **Core has no order cancellation, line void or comp today.** Until the mechanism approved in DEC-OPS-1 (2026-10-05) is implemented, no Core-switched client offers them, and this gap is shown truthfully in release readiness. | MUST | TARGET (mechanism approved 2026-10-05: DEC-OPS-1; not implemented) | S (D3, D4 debt) |
| OPS-33 | When built, a cancellation or void is a linked compensating record (target order, round or line; quantity; reason; actor; approver where required; time; correlation). The round snapshot is never edited or deleted (PR-9, INV-11). | MUST | TARGET (mechanism approved 2026-10-05: DEC-OPS-1) | S (PR-9)+V(02 §3.2)+D |
| OPS-34 | A void defines its effect on each dependent: kitchen ticket lines (shown as voided; a cancellation KOT where printing applies), unbilled-line counts for visit close, and billed lines (a standing check must be voided or credited first, per 07). No dependent changes silently. | MUST | TARGET (mechanism approved 2026-10-05: DEC-OPS-1) | S (D10, KIT-2)+E+D |
| OPS-35 | Corrections after kitchen release, comps and manual discounts support step-up authorization by a permitted role and separation of duties (requester ≠ approver) as configurable mechanisms; which actions require them and above which values is DEC-X-7; which roles may approve is DEC-X-2. | MUST (mechanism) | TARGET (mechanism approved 2026-10-05: DEC-OPS-1; policy open: P6 via DEC-X-7, P2 via DEC-X-2) | S (INV-4)+V(02 §6)+D |
| OPS-36 | The legacy Nest cancellation (order `cancelled` from any non-terminal status; the `kitchen` role and KDS device token may create and cancel orders) is TRANSITIONAL and a recorded defect; it is not carried into Core, where kitchen credentials cannot place orders. | MUST | TRANSITIONAL | S (stabilisation track, D4) |
| OPS-37 | Discounts in Core exist only as promotions evaluated by the server (D11); a client never sends a discount amount. Manual discount and comp scope is 07 with DEC-OPS-1. | MUST | TARGET (implemented in Core) | S (D11) |

### 02.5.6 Waiter Tablet operational behaviour

| ID | Requirement | Priority | State | Basis |
|---|---|---|---|---|
| OPS-38 | Staff Mode and Guest Mode operate on the same venue, table, visit and order context (WT-1). Staff Mode writes require a staff-elevated tablet credential; an unelevated tablet credential is a device identity refused by staff-only routes. | MUST | TARGET (Core enforcement implemented) | S (WT-1, WT-4, §32) |
| OPS-39 | Guest Mode cannot, by server-side refusal regardless of user interface: open, close, cancel or transfer a visit; request or void a check; initiate or record payment or settlement; transition kitchen tickets; change availability; read other visits, the financial realtime stream or staff data. | MUST | TARGET | S (WT-4, ADR2 8)+E |
| OPS-40 | A Core guest order path records provenance per O-21 (00.10.6) and authenticates with the DEC-OPS-8 guest credential; it never carries staff authority. Until it is built, the Nest `POST /api/tablet/orders` guest path (legacy source `staff`, per-device system actor) is TRANSITIONAL. | MUST | TARGET (decisions O-21 and DEC-OPS-8 resolved; implementation incomplete; Guest Mode excluded from the first pilot) | S (§33, O-21, WT-4) |
| OPS-41 | Entering Staff Mode requires staff authorization (WT-5; native mechanism O-20, decided 2026-10-05, 00.10.6). Leaving Staff Mode ends the staff elevation server-side at once, so no staff authority survives into Guest Mode. | MUST | TARGET | S (WT-4, WT-5)+E |
| OPS-42 | In the reduced first pilot, Guest Mode is excluded and the web Order Tablet in Staff Mode is the temporary settlement surface within ADR 0002 item 8. | MUST | TRANSITIONAL | S (ADR2 4, 8) |
| OPS-43 | The Waiter Tablet never shows an order or round as submitted until Core has accepted it. A pending draft may be kept locally and retried with its original key (OPS-25); further offline behaviour is DEC-OPS-11. | MUST | TARGET | S (PR-4, NFR-OFF)+D |

### 02.5.7 Kiosk

| ID | Requirement | Priority | State | Basis |
|---|---|---|---|---|
| OPS-44 | Kiosk ordering follows KSK-1 to KSK-5. Each kiosk venue is configured for one payment flow per order type: pay later at the venue (PAY-1) or prepaid (PAY-2: no kitchen release before verified payment). Which flows are offered is DEC-OPS-9. | MUST | OWNER DECISION REQUIRED | S (KSK, PAY-1, PAY-2)+D |
| OPS-45 | Kiosk submission to Core requires a kiosk credential model (DEC-OPS-8) and a D8 device kind for the kiosk (DEC-OPS-13). Core refuses `kiosk` source today. | MUST | TARGET (mechanism approved 2026-10-05: DEC-OPS-8; device kind per DEC-OPS-13, already decided) | S (D3, D8)+D |
| OPS-46 | A kiosk order that names a table is bound to that table's open visit or handled as DEC-OPS-10 decides; a kiosk never opens or closes a visit implicitly without that decision. | MUST | OWNER DECISION REQUIRED (DEC-OPS-10, package P9; kiosk is outside the reduced pilot) | S (KSK-1, D3)+D |
| OPS-47 | The kiosk idle reset (KSK-2) discards the unsubmitted cart and any entered personal data from the device; a submitted order's confirmation is shown only after Core (or Venue Edge) durable acceptance (KSK-4). | MUST | TARGET | S (KSK-2, KSK-4)+E |
| OPS-48 | The Nest kiosk checkout defects recorded in the stabilisation track (CSRF refusal, missing idempotency key, additive GST, no refund) are not carried into the target kiosk path. | MUST | TRANSITIONAL | S (migration README) |

### 02.5.8 Window Display

| ID | Requirement | Priority | State | Basis |
|---|---|---|---|---|
| OPS-49 | The Window Display implements WD-1 read-only, from the `window_display` menu channel, never offering ordering. There is no current client (removed 2026-10-05); decommissioning the installed legacy service is a separate operational action. | MUST | TARGET | S (WD-1, §34.3) |
| OPS-50 | The Window Display shows its offline or stale state and the age of its last successful refresh in the Admin Console device view; offline it shows the last menu (WD-1) and never presents stale content as current to staff. | SHOULD | TARGET | S (WD-1, PR-4)+V(02 §3.13) |
| OPS-51 | Whenever a Window Display represents availability or orderability, an availability change reaches it within the AVL-1 target (p95 under 30 s), by notification rather than by the periodic refresh alone; the WD-1 60 s auto-refresh continues to govern general menu and signage content and serves as a fallback. A display configured to show no availability is outside AVL-1. AVL-1 is not weakened. | MUST | TARGET (Tier-2 conceptual resolution accepted 2026-10-05; WD-1 wording amendment proposed by controlled change) | S (WD-1, AVL-1)+A |

### 02.5.9 Kitchen and KDS

| ID | Requirement | Priority | State | Basis |
|---|---|---|---|---|
| OPS-52 | Kitchen tickets are produced only by projection of the durable `order.round_submitted` event committed with the round (ORD-1); projection is idempotent and retried with bounded backoff; a parked event becomes an OperationalException with an authorized, audited release action (today only SQL exists). | MUST | TARGET (projection implemented in Core; tooling not built) | S (ORD-1, D4, §18.5) |
| OPS-53 | Station routing (KIT-1) uses venue-scoped, effective-dated, audited station configuration held as data. The configuration version effective at round submission, not at projection, determines the stations; the ticket records it. Core routes to the single station `kitchen` until DEC-OPS-4 provides the model. | MUST | TARGET (single station implemented) | S (KIT-1, D4)+E+D |
| OPS-54 | A line whose product resolves to no active station goes to the venue's configured default station and raises an OperationalException; a line is never dropped. | MUST | TARGET | S (KIT-1, PR-4)+E |
| OPS-55 | Ticket transitions follow 02.4.7 with version compare-and-set; an attempt on a stale version returns `VERSION_CONFLICT` and the KDS refetches instead of overwriting. | MUST | TARGET (implemented in Core) | S (D4, KIT-4) |
| OPS-56 | KDS realtime uses the kitchen stream (D12): authorize at subscribe, refetch over HTTP on connect and reconnect, deduplicate by event ID, drop stale versions, reconnect and refetch after a slow-consumer close. KDS propagation is under 3 s from submission (KIT-3; O-19). | MUST | TARGET (implemented in Core) | S (KIT-3, NFR-RT, D12) |
| OPS-57 | During a backend or network outage the KDS keeps showing received tickets (KIT-6), shows an offline indicator with the time of last successful sync, and reconnects automatically. Whether ticket transitions may be queued offline is DEC-OPS-11; if allowed, replay uses the recorded version and surfaces every conflict instead of overwriting. | MUST | TARGET | S (KIT-6)+V(02 WF-O5)+D |
| OPS-58 | Ticket age colouring and the ready alert (KIT-5) use venue-configured thresholds; no default threshold is set by this volume. | SHOULD | TARGET | S (KIT-5) |
| OPS-59 | For each order path, a venue's kitchen runs on one kitchen model: the legacy `Order.status` KDS for Nest-path orders, or KitchenTicket for Core orders. Switching the KDS to Core retires the legacy model for Core orders (PR-8). | MUST | TRANSITIONAL | S (D4 debt, §34.2) |
| OPS-60 | Expo readiness across stations, ticket priority (rush), course firing and allergen acknowledgement taps are not in committed delivery scope (DEC-OPS-18, DEC-OPS-19). | MAY | TARGET CAPABILITY — FUTURE DELIVERY; policy DEC-OPS-18 (expo readiness, priority, course firing). Allergen acknowledgement taps: policy DEC-OPS-19 | V(02 §3.7, §5.4)+K(L16, L197, L403) |

### 02.5.10 KOT printing

| ID | Requirement | Priority | State | Basis |
|---|---|---|---|---|
| OPS-61 | KOT print jobs derive from kitchen tickets per station-to-printer mapping (PRT-1). The canonical job record and status live in Core; Venue Edge holds the delivery command in its durable queue and reports outcomes idempotently (EDGE-1, EDGE-2). The configuration model is DEC-OPS-16 (with O-4). | MUST | TARGET | S (PRT-1, EDGE-1, EDGE-2)+D |
| OPS-62 | Print status follows 02.4.8: `delivered` is not `printed`; `uncertain` is never auto-retried; a reprint is an explicit, attributed, linked new attempt. | MUST | TARGET; semantics TRANSITIONAL in Nest | S (PRT-1, PR-4, PAY-6) |
| OPS-63 | An unreachable printer never blocks order acceptance; the job is queued (PRT-2), the kitchen sees the KDS independently (KIT-2), and terminal failure raises an Admin alert and an OperationalException. | MUST | TARGET | S (PRT-2, KIT-2) |
| OPS-64 | A reprinted KOT is distinguishable from the original on paper, so the kitchen does not prepare it twice. | SHOULD | TARGET | E (release acceptance "no duplicate KOTs") |
| OPS-65 | The legacy printer connector dispatch (`connector_dispatched`, connector commands) is TRANSITIONAL and retires with the external-POS surfaces. | MUST | TRANSITIONAL | S (§34.2) |

### 02.5.11 Availability ("86")

| ID | Requirement | Priority | State | Basis |
|---|---|---|---|---|
| OPS-66 | An 86 or restore by a permitted user commits an AvailabilityChange (02.4.9) and takes effect for Core order validation in the same transaction (MENU-6, ORD-4). Who may 86 is DEC-X-2. | MUST | TARGET | S (MENU-6, ORD-4)+V(02 §3.6) |
| OPS-67 | Every in-scope channel (O-17) carries its own propagation state; a channel not confirmed within the AVL-1 target becomes `failed`, raises an OperationalException and is retried; there is no silent partial 86. Propagation p95 is under 30 s (AVL-1). | MUST | TARGET | S (AVL-1)+V(02 §3.6) |
| OPS-68 | An order submitted with an item that became unavailable after the client loaded the menu is refused (ORD-4) with the affected lines identified; orders accepted before the 86 are unaffected and their kitchen work continues (MENU-6). | MUST | TARGET (refusal implemented in Core) | S (ORD-4, MENU-6) |
| OPS-69 | Staff ordering surfaces show 86'd items as unavailable and not orderable; customer-facing surfaces omit them. Guest Mode display policy is open under P9 (O-21 decided provenance only). | MUST | TRANSITIONAL (Nest channel policy) | S (§33, MENU-6) |
| OPS-70 | Restore is manual. Scheduled restore, sell-through counters, modifier-option 86 and stock-driven 86 are FUTURE (DEC-OPS-14; stock-driven depends on O-9). | MAY | Stock-driven 86: TARGET CAPABILITY — FUTURE DELIVERY (depends on 03 and 04; O-9 inclusion resolved). Scheduled restore, sell-through counters, modifier-option 86: FUTURE (DEC-OPS-14) | V(02 §3.6, WF-O4)+K(L203) |

### 02.5.12 Check and payment touchpoints (rules in 07)

| ID | Requirement | Priority | State | Basis |
|---|---|---|---|---|
| OPS-71 | An operational surface requests a check for a visit or for named orders; Core bills only unbilled lines and returns the check. Ordering never opens a check (ORD-5). Several checks per visit are allowed. | MUST | TARGET (implemented in Core) | S (ORD-5, D5) |
| OPS-72 | Card payment is initiated from a permitted staff surface and is `pending` until the trusted payment adapter reports through Venue Edge; the surface shows `uncertain` as uncertain and offers no retry that could duplicate a charge until reconciled (PAY-6). Cash requires an open shift. | MUST | TARGET (implemented in Core) | S (PAY-1, PAY-6, CARD3, D6, D7) |
| OPS-73 | Guest Mode, KDS, Window Display and kiosks without an approved payment flow never initiate payment or settlement. | MUST | TARGET | S (ADR2 8, WT-4) |
| OPS-74 | Order, kitchen, print, check and payment states are shown independently; none is inferred from another (KIT-2, PR-4). | MUST | TARGET | S |

### 02.5.13 Concurrency and multi-device consistency

| ID | Requirement | Priority | State | Basis |
|---|---|---|---|---|
| OPS-75 | Every mutable operational aggregate (TableSession, Order, KitchenTicket, Reservation, item availability, PrintJob, OperationalException) is changed under version compare-and-set or row lock. On `VERSION_CONFLICT` the client refetches and re-presents; it retries automatically only when the request is state-idempotent. | MUST | TARGET (Core aggregates implemented; others not) | S (§15 row I, INV-10) |
| OPS-76 | Any new operational command that touches several aggregates takes locks in the global order TableSession → Order → Check → CheckPayment → Shift, and new aggregates are placed into that order by an explicit design record. | MUST | TARGET | S (D10)+E |
| OPS-77 | Multi-device views converge through realtime notification plus HTTP refetch; no client treats a realtime payload as the resource or as success of a command. | MUST | TARGET (implemented in Core) | S (NFR-RT, INV-13, D12) |
| OPS-78 | Realtime authorization fails closed (SPRD §16.12); the known D12 fail-open defect and the transitional Socket.IO defects (unpinned tablet tokens, no role checks, doubled delivery) are fixed or retired before production use. | MUST | TARGET | S (§16.12, D12 notes) |

### 02.5.14 Operational exceptions and recovery

| ID | Requirement | Priority | State | Basis |
|---|---|---|---|---|
| OPS-79 | Core maintains, per venue, an operational exception queue (02.4.12) covering every failure kind listed there, visible to permitted staff in the Admin Console and surfaced by 01. | MUST | TARGET | S (§15 row N, §17.10, §18.5, AVL-1, PRT-2)+V(02 §3.12, A.10)+E |
| OPS-80 | Exceptions are deduplicated per cause and entity, auto-resolve only on verified resolution, and require a note for manual resolve or dismiss; every state change is audited. | MUST | TARGET | E (INV-15) |
| OPS-81 | Payment-against-provider and cash-against-shift reconciliation items are owned by 07; the operational queue links to them and never duplicates or resolves them. | MUST | TARGET | S (§17.10) |
| OPS-82 | Every failure state named in this volume has a staff-visible recovery path (retry, reprint, release, resolve, escalate) and no failure is only in logs. | MUST | TARGET | S (§11 release acceptance, §15 row AG) |

### 02.5.15 Channels beyond the venue, staff operations, legacy

| ID | Requirement | Priority | State | Basis |
|---|---|---|---|---|
| OPS-83 | Public web ordering or pre-ordering is not built until O-18 is decided; if approved, it follows PAY-2 and creates Core orders with source `customer_web`. | MUST | TARGET CAPABILITY — FUTURE DELIVERY (inclusion resolved in O-18, owner 2026-10-05; scope details, payment flow and channels remain open under O-18) | S (WEB-5, O-18, PAY-2)+K(L195) |
| OPS-84 | Third-party delivery aggregators, if committed, attach through adapters (INV-19): aggregator orders become Core orders with their own source channel, adapter facts never overwrite canonical state, and every inbound payload is idempotent on provider order identity. | MAY | TARGET CAPABILITY — FUTURE DELIVERY; delivery model DEC-OPS-25 | V(02 §3.1–3.2, WF-O2)+S (INV-19)+K(L27, L195, L426–433) |
| OPS-85 | Delivery channel pause and throttle, courier handoff, catering events, waitlist, staff checklists, handover notes and incident logs are not in committed delivery scope (02.14). | MAY | TARGET CAPABILITY — FUTURE DELIVERY for waitlist and queue, delivery channel pause and throttle, courier handoff and staff checklists (each sub-capability's policy stays open: DEC-OPS-23, DEC-OPS-25, DEC-X-15). Catering events, handover notes and incident logs: FUTURE (not described by KitchenOS) | V(02 §3.9–3.14)+K(L25, L27, L231, L246) |
| OPS-86 | The Nest external-POS surfaces (`legacy-external-pos`, `pos-sync`, `connector`, `payment-observation`, printer connector dispatch) are TRANSITIONAL. No new operational behaviour depends on them; a Core order carries no legacy integration state; they retire after their callers (web Order Tablet, Nest order creation) migrate (PR-8). | MUST | TRANSITIONAL | S (§34.2, D3) |
| OPS-87 | Windows POS operational workflows (table behaviour, order entry, manager functions, payment UX, shifts and cash UX, offline) are not specified here. | — | DEFERRED | S (§12) |

### 02.5.16 Owner-approved service capabilities (KitchenOS capability set, 2026-10-05)

None of these requirements defines Windows POS screens, cashier UX, terminal workflows, hardware or offline behaviour; any Windows POS involvement is DEFERRED (OPS-87, SPRD §12).

| ID | Requirement | Priority | State | Basis |
|---|---|---|---|---|
| OPS-88 | **Phone orders.** Staff-entered telephone orders are a distinct source channel in the closed, versioned channel set (OPS-4), added by contract change; they are never recorded under another channel's value. A phone order is entered by an authenticated staff member on a permitted staff ordering surface and records the entering staff identity, device identity and application identity (OPS-2); a kiosk, Guest Mode or public-web credential cannot declare the phone channel (OPS-3). Submission is idempotent under OPS-25. Fulfilment type is takeaway (collection), delivery or dine-in: a dine-in phone order binds only to an existing open visit and never opens one implicitly; delivery depends on the delivery fulfilment model (DEC-OPS-25). Caller contact details are Personal data used as transactional identity only and imply no marketing consent (02.8, 05). Kitchen release follows ORD-1 with PAY-1 or PAY-2 as configured; which fulfilment types and payment flows a venue offers for phone orders is DEC-OPS-24. | MUST (when delivered) | TARGET CAPABILITY — FUTURE DELIVERY; policy DEC-OPS-24 | S (§13, OPS-4, ORD-3)+K(L195)+D |
| OPS-89 | **Counter and walk-in takeaway ordering.** Counter and walk-in takeaway orders are taken only on permanent surfaces: the Waiter Tablet in Staff Mode (staff-entered) and the kiosk (customer self-service, OPS-44 to OPS-47). No counter behaviour is specified for the Windows POS, which is frozen (SPRD §12, §31). A counter order is a takeaway order under OPS-29 (no visit), carries its true source channel and actor, and gives the customer a human-readable order reference for collection (INV-9). Kitchen release follows ORD-1 with PAY-1 or PAY-2 as the venue configures. Whether a venue runs counter ordering is enabled by its venue operating profile (dine-in, QSR/takeaway or hybrid), defined and server-enforced in 09 (DEC-ADMIN-10), never by client configuration alone. The QSR throughput the venue must sustain is a capacity target to be set under DEC-X-8 (OWNER TARGET REQUIRED); load acceptance at that throughput validates the approved order-submission target (NFR-PERF; O-19). Collection-status display and queue management are 02.14 items. | MUST (when delivered) | TARGET CAPABILITY — FUTURE DELIVERY (takeaway order mechanics TARGET, OPS-29); capacity DEC-X-8 | S (§13, OPS-29, KSK-1)+K(L21–27)+A (DEC-ADMIN-10)+D |
| OPS-90 | **Server assignment.** Permitted staff (DEC-X-2) can assign one or more staff members to a visit, a table or a service area (DEC-OPS-6) for a visit or for a service period. An assignment is a venue-scoped record with assignee, scope, effective start and end, assigner and, for a change, a reason; every create, change and end is versioned and audited with before and after values (INV-10, INV-15), and a visit's assignment history is preserved, never overwritten. Assignments drive notification routing (01; for example the KIT-5 ready alert to the assigned server) and service reporting (08). An assignment never grants or removes authorization, which stays with roles and venue grants (INV-4). An unassigned visit is valid: its notifications go to the venue's configured fallback audience and are never dropped because no one is assigned. A service period is a staffing period, linked to 06 rosters where Workforce exists; it is not the cash Shift of 07. | MUST (when delivered) | TARGET CAPABILITY — FUTURE DELIVERY | S (§8, §13)+K(L196)+A (DEC-OPS-6) |
| OPS-91 | **Order modification after acceptance.** An accepted round is never edited. After Core accepts a round, a change is expressed only as a new round on the same order (additions, OPS-24) or as a compensating cancellation or line void under DEC-OPS-1 (removals and quantity reductions), or both; a substitution is a void plus a new round. The original round snapshot, its kitchen ticket lines and its print history stay intact, and the compensating record links to them (OPS-33, OPS-34). Before acceptance only the client draft changes, and a changed draft uses a new idempotency key (OPS-25). In Guest Mode a guest may at most add rounds, and only once the guest order path exists (OPS-40); cancellation, void and comp are refused server-side (WT-4, OPS-39). Orders from external channels change only through the same records; an adapter fact never edits a round (INV-19). Until DEC-OPS-1 is implemented, removals are unavailable in Core (OPS-32). | MUST | TARGET (new rounds implemented in Core; compensating removals: mechanism approved 2026-10-05, DEC-OPS-1, not implemented) | S (PR-9, WT-4, ORD-1)+A (DEC-OPS-1)+K(L315) |
| OPS-92 | **Ticket priority.** A kitchen ticket carries a priority whose level set and meaning are DEC-OPS-18. Setting or changing priority, including by direct manipulation on the KDS, is an explicit, versioned ticket change by a permitted role (DEC-X-2) that records actor, identity class, device, previous and new value and reason, and is audited; it changes neither ticket status nor order state (OPS-74). A concurrent change follows OPS-55 (`VERSION_CONFLICT`, refetch). Priority is shown on every KDS displaying the ticket and is distinguishable without colour alone (a text label, symbol or position in addition to colour, following the WCAG "use of colour" rule; the KDS conformance target stays OWNER TARGET REQUIRED, SPRD §23). Moving a ticket or line to another station for priority routing is a reassignment under DEC-OPS-4: explicit, audited and never dropping a line. | MUST (when delivered) | TARGET CAPABILITY — FUTURE DELIVERY; policy DEC-OPS-18 | S (KIT-4, §23)+K(L197, L403, L405)+A (DEC-OPS-4)+D |
| OPS-93 | **New-ticket audible alert.** Each station's KDS can play a configurable audible alert when a new ticket for that station arrives, alongside the KIT-5 ready alert. Enablement and sound per station are venue configuration (INV-17), audited when changed; this volume sets no default. The alert sounds once per ticket on the device's first display of it; tickets first seen through refetch after a reconnect raise one combined alert, and tickets already shown never re-alert. Sound is never the only signal: the ticket is always shown. A KDS whose audio is muted or unavailable shows that state on screen. | SHOULD | TARGET CAPABILITY — FUTURE DELIVERY | S (KIT-5, KIT-6)+K(L406) |

## 02.6 Workflows and failure paths

**WF-OPS-1 Online reservation.** (1) Guest submits the booking journey (WEB-1, WEB-2). (2) Server validates and runs the capacity check under lock (OPS-8). (3) Booking reference generated; status `pending` or `confirmed` per venue configuration; RES-2 emails queued with visible delivery state (OPS-13). *Failures:* slot full under concurrency → refused with a stable code and alternatives if offered; duplicate submit → the same booking (idempotency key; INV-12); email failure → reservation stands, staff see failed delivery. No order, check or kitchen work is created (OPS-6).

**WF-OPS-2 Arrival and seating.** (1) Staff opens a visit on a table (request key, covers). (2) For a reservation, staff marks it `seated` and the link is recorded (OPS-10, after DEC-OPS-2). *Failures:* table already open → `TABLE_SESSION_ALREADY_OPEN`, the surface shows the existing visit; a legacy Nest order on the table → refused by the occupancy bridge (OPS-22); lost response → retry with the same request key returns the same session.

**WF-OPS-3 Staff ordering (Waiter Tablet Staff Mode).** (1) Staff selects visit, builds draft from the staff channel menu (86'd items dimmed). (2) Submit with idempotency key; Core validates, prices, persists round, ticket event, audit and realtime fact in one transaction (ORD-1). (3) Client shows Core totals. (4) Further rounds repeat. *Failures:* timeout or lost response → retry with the same key returns the original (OPS-25); ORD-4 refusal → refetch menu and mark lines (OPS-27); visit closed in a concurrent action → `TABLE_SESSION_NOT_OPEN`, draft kept; promotion changed mid-submit → `PROMOTION_CHANGED`, re-evaluate; network loss → draft kept, never shown as sent (OPS-43); credential revoked → refused, re-authorize.

**WF-OPS-4 Guest Mode ordering.** Customer-operated ordering on the same visit (WT-3). Every staff-authorised action is refused server-side (OPS-39). Its decisions are resolved (O-21, DEC-OPS-8) but the Core path is not built (OPS-40); its UX is not defined. Excluded from the first pilot.

**WF-OPS-5 Kiosk ordering.** (1) Browse, cart, optional table (KSK-1). (2) Submit requires durable acceptance (KSK-4); with a prepaid flow, kitchen release waits for verified payment (PAY-2). (3) Confirmation with reference (KSK-2). *Failures:* Core unreachable → order blocked and explained, draft kept without card data (KSK-4); payment failed or abandoned → nothing released (PAY-2); idle → reset clears cart and personal data (OPS-47). Blocked on DEC-OPS-8, DEC-OPS-9, DEC-OPS-10, DEC-OPS-13.

**WF-OPS-6 Kitchen execution.** (1) Projector claims `order.round_submitted`, writes tickets per station and stamps the event. (2) KDS receives `kitchen_ticket.created`, refetches. (3) Kitchen advances the ticket with its version; recall reopens a completed ticket. *Failures:* projection error → bounded retry, then parked → OperationalException → authorized release (OPS-52); concurrent bump from two screens → one write, the other `VERSION_CONFLICT` → refetch; backend outage → KDS keeps tickets, shows offline and last-sync time, reconnects and refetches (OPS-57); slow consumer → closed, reconnect and refetch.

**WF-OPS-7 KOT printing.** (1) Core creates a print job per station printer. (2) Venue Edge leases the command from its durable queue and dispatches. (3) Edge reports `delivered` or `printed` idempotently. *Failures:* printer unreachable → bounded retry, then `failed`, Admin alert, exception (OPS-63); Edge restarted mid-dispatch → `uncertain`, never auto-resent; staff reprint explicitly (OPS-62); internet loss at the venue → Edge queue holds commands; reconnect preserves order and idempotency (EDGE-3).

**WF-OPS-8 86 and restore.** (1) Permitted user marks the item unavailable with a reason. (2) Core commits the change; new submissions with the item are refused immediately. (3) Per-channel propagation runs; states shown per channel. (4) Restore reverses it with its own record. *Failures:* a channel unconfirmed within the target → `failed`, exception, retry; partial success is displayed per channel, never as complete (OPS-67).

**WF-OPS-9 Check, payment and visit close.** (1) Staff requests a check for the visit (OPS-71). (2) Staff initiates card (adapter via Edge) or cash (open shift) payment (OPS-72). (3) Check settles per 07. (4) Staff closes the visit. *Failures:* new round after check → billed on a second check; close with unbilled lines or open checks → refused with counts (OPS-18); uncertain card result → visit cannot close until reconciled (07); no open shift for cash → `NO_OPEN_SHIFT`; refund after close → applies, visit stays closed (OPS-20).

**WF-OPS-10 Correction.** Not available in Core (OPS-32). After DEC-OPS-1: request (reason) → step-up if policy requires (OPS-35) → compensating record → kitchen, print and billing effects per OPS-34 → audit and realtime fact.

**WF-OPS-11 Exception handling.** (1) Core detects a failure and opens or refreshes the exception for its cause. (2) Staff acknowledges and takes an allowed action. (3) Core verifies the underlying state and resolves, or staff resolve or dismiss with a note. *Failures:* action fails → exception stays open with the new error; duplicate detection → same item updated, not a new one.

**WF-OPS-12 Surface cutover from Nest to Core.** Per surface: replacement built → client switched for one venue → behaviour proven against acceptance criteria → legacy path retired (PR-8). During cutover each aggregate has one writer (OPS-1, OPS-22, OPS-59); production cutover needs separate approval (SPRD §11).

## 02.7 Security, authorization and audit

**Authorization matrix (target).** "Core" marks behaviour implemented in Core; "DEC" marks a decision.

| Action | Owner / admin / manager / cashier | Kitchen staff | Viewer | KDS device | Staff-elevated tablet | Unelevated tablet (Guest Mode) | Kiosk | Public web | Payment adapter / Venue Edge |
|---|---|---|---|---|---|---|---|---|---|
| Open, update, close, cancel visit | Allowed (Core) | Refused | Refused | Refused | Allowed (Core) | Refused | DEC-OPS-10 | Refused | Refused |
| Create order or round | Allowed (Core) | Refused (Core) | Refused | Refused (Core) | Allowed (Core) | DEC-OPS-8 / O-21 | DEC-OPS-8 | O-18 | Refused |
| Transition kitchen ticket | Allowed (Core) | Allowed (Core) | Refused (Core) | Allowed (Core) | Allowed (Core) | Refused (Core) | Refused | Refused | Refused |
| Request or void check; initiate payment | Per 07 | Refused | Refused | Refused | Per 07 | Refused | DEC-OPS-9 | O-18 | Report results only |
| 86 / restore | DEC-X-2 | DEC-X-2 | Refused | DEC-X-2 | DEC-X-2 | Refused | Refused | Refused | Refused |
| Reservations manage | DEC-X-2 (Nest roles today) | Refused | Read if granted | Refused | DEC-X-2 | Refused | Refused | Create own booking | Refused |
| Correction, comp, capacity override | Step-up per DEC-X-7 | Refused | Refused | Refused | Step-up per DEC-X-7 | Refused | Refused | Refused | Refused |
| Exception resolve or dismiss | DEC-X-2 | Kitchen kinds per DEC-X-2 | Refused | Refused | Refused | Refused | Refused | Refused | Refused |
| Enter phone order (OPS-88) | DEC-X-2 | Refused | Refused | Refused | DEC-X-2 | Refused | Refused | Refused | Refused |
| Assign or change server assignment (OPS-90) | DEC-X-2 | Refused | Refused | Refused | DEC-X-2 | Refused | Refused | Refused | Refused |
| Set or change ticket priority (OPS-92) | DEC-X-2 | DEC-X-2 | Refused | DEC-X-2 | DEC-X-2 | Refused | Refused | Refused | Refused |
| Realtime stream | Operations and financial (Core) | Kitchen (Core) | Refused (Core) | Kitchen (Core) | Operations and financial (Core) | Refused (Core) | DEC-OPS-8 | Refused | Refused |

**Controls.**
- Scope comes from the verified credential (INV-2); device credentials are pinned to their venue; a forged venue is refused, never corrected.
- Step-up and separation of duties apply as mechanisms at: post-release corrections and comps (OPS-35), capacity override (OPS-8), exception dismissal of kinds DEC-OPS-17 marks as financial-impacting. Thresholds are DEC-X-7.
- Guest Mode restrictions are enforced by credentials and server routes, never by hidden UI (WT-4, OPS-39).
- Kiosk and Waiter Tablet store no card data and no staff secrets beyond the device credential (PAY-5, §16.7).

**Audit.** Every operational mutation emits an append-only, correlated audit record (NFR-AUD, INV-15): visit open, covers change, close (with readiness), cancel; order create, round submit, replay and key conflict; kitchen transitions; print job create, reprint, dismiss; availability change and propagation result; reservation transitions and overrides; corrections and approvals; exception transitions; Staff Mode elevation and exit; when delivered, server assignment create, change and end (OPS-90), ticket priority changes and priority reassignments (OPS-92) and KDS alert configuration changes (OPS-93). **Gap:** Core `AuditLog` requires a staff actor, so device actions are recorded only in `KitchenTicketTransition`; Core audit must attribute device and system actors (INV-3) before KDS, kiosk and Edge actions are production-auditable (DEC-OPS-21, owned with 09).

## 02.8 Data governance

| Data | Class (INV-18) | Owner | Retention | Notes |
|---|---|---|---|---|
| Reservation guest name, email, phone | Personal | Reservations (O-7) | DEC-X-4 | Transactional identity only; no marketing consent implied (05) |
| Reservation occasion, special requests; order and line notes | Personal where they describe a person (for example dietary or health needs) | Reservations / Orders | DEC-X-4 | Shown only to roles that need them; excluded from telemetry |
| Phone-order caller contact and delivery address (OPS-88, DEC-OPS-25) | Personal | Orders | DEC-X-4 | Transactional identity only; no marketing consent implied (05); excluded from telemetry |
| Server assignments (OPS-90) | Internal (staff identity: Personal, employee) | Core (DEC-X-13) | DEC-X-4 for actor data | Used for routing and reporting, never for authorization |
| Orders, rounds, snapshots, applied promotions | Financial | Core orders | Financial retention per DEC-X-5 / 07 | Immutable; corrected by compensating records |
| Kitchen tickets and transitions | Internal | Core kitchen | Owner decision (DEC-X-4 for actor data) | Snapshot survives menu changes |
| Print job payloads | Internal (may contain notes: Personal) | Core / Venue Edge | Owner decision | Edge local storage encrypted (EDGE-2) |
| Availability changes | Internal | Core menu | Owner decision | Needed for 86 history and metrics |
| Device and actor identifiers | Internal | Core identity / devices | Audit ≥ 90 days (NFR-AUD) | |
| Realtime event log | Internal | Core realtime | Pruned after 24 h (implementation) | Not a history or audit source |

- **Corrections** are compensating records (INV-11); master data (tables, stations, printers) is deactivated while referenced, not deleted.
- **Exports** of reservation lists or order data respect venue scope and are audited.
- **No secrets, card data or provider references** in events, logs or exception payloads (Part B row C).

## 02.9 Reliability, scalability and observability

**Failure behaviour.**

| Dependency down | Behaviour |
|---|---|
| Core API unreachable | Ordering surfaces keep drafts and block submission with an explanation (KSK-4, OPS-43); KDS keeps tickets (KIT-6); Window Display shows last menu (WD-1) |
| PostgreSQL | Writes refused; readiness fails; no partial state (§18.8) |
| Kitchen projector backlog | Tickets delayed, backlog age visible; parked events become exceptions |
| Realtime | Clients reconnect and refetch; propagation targets measured |
| Venue Edge or printer | Orders accepted; print jobs queued; exceptions raised (OPS-63) |
| Payment adapter | Payment `pending` or `uncertain`; visit cannot close until resolved |
| Email provider | Reservation stands; delivery failure visible |

**Signals (SPRD §20).** Order submit latency and error rate per source; idempotent replay and conflict counts; projector backlog depth, oldest age, retries, parked count; ticket state ages per station; realtime subscribers per stream, slow-consumer closes, reconnect rate; print job state counts and oldest queued; Edge heartbeat, queue depth and oldest age; availability propagation latency per channel and failure count; visit-close refusals by blocking count; open exceptions by kind and oldest age; reservation capacity conflicts.

**Targets.** Order submission P95 < 500 ms; read API P95 < 200 ms; KDS propagation < 3 s; print < 3 s on venue hardware; 86 propagation p95 < 30 s; kiosk navigation < 1 s; 99.5% monthly availability (SPRD §19; O-19). Capacity (concurrent devices per venue, peak orders, reconnect storms) is DEC-X-8; general realtime propagation and backlog targets are SPRD §19 OWNER TARGET REQUIRED; alert thresholds DEC-OPS-17.

## 02.10 UX and accessibility

- Every operational screen provides the SPRD §22 states. Operation-specific truthful states: draft vs submitted vs accepted order; per-channel 86 state; KDS offline with last-sync time; print `delivered` vs `printed` vs `uncertain`; payment `pending` and `uncertain`; visit close refused with the blocking counts; Staff Mode vs Guest Mode clearly indicated.
- Destructive and financial actions (close visit, void, cancel, reprint, dismiss exception) need confirmation and show their consequence.
- Accessibility targets (SPRD §23): Admin Console WCAG 2.1 AA; Customer Website WCAG 2.1 AA with 44 px targets and 16 px body text; kiosk 48 × 48 px targets and 4.5:1 contrast readable at 600 mm; Waiter Tablet (both modes), KDS and Window Display: OWNER TARGET REQUIRED.
- Ticket priority is distinguishable without colour alone, and audible alerts are never the only signal (OPS-92, OPS-93).
- Guest Mode UX is not defined (WT-3). Windows POS UX is frozen.
- Verdura evidence of a sub-5-second 86 action at peak is recorded only as proposed (02.12), not adopted.

## 02.11 Acceptance criteria

| ID | Scenario | Expected result | Covers |
|---|---|---|---|
| AC-OPS-1 | 20 concurrent bookings for the last seats of a slot, across website and Admin | Capacity never exceeded; losers get a stable refusal | OPS-8, RES-3 |
| AC-OPS-2 | Reservation confirmed, seated and completed with no order | No order, check, payment, ticket or print job exists | OPS-6 |
| AC-OPS-3 | Illegal reservation transition (`completed → confirmed`) | Refused with stable code; no change; no audit of a change | OPS-7 |
| AC-OPS-4 | Two staff open a visit on one table concurrently | One open session; other gets `TABLE_SESSION_ALREADY_OPEN` | OPS-16 |
| AC-OPS-5 | Close a visit with one unbilled round and one uncertain payment | 409 `VISIT_NOT_FINANCIALLY_COMPLETE` with counts; UI shows both blockers | OPS-18 |
| AC-OPS-6 | Close a closed visit (retry after lost response) | 200, unchanged, one audit record total | OPS-18 |
| AC-OPS-7 | Close races a round submit (forced both orders) | Either round commits and close refuses, or close commits and round gets `TABLE_SESSION_NOT_OPEN` | OPS-20, OPS-76 |
| AC-OPS-8 | Refund after visit close | Refund applies; visit stays closed at its version | OPS-20 |
| AC-OPS-9 | Order submit retried with the same key after a timeout | One order, one round, one ticket event; replay returns original | OPS-25, ORD-3 |
| AC-OPS-10 | Same key, different lines | `IDEMPOTENCY_CONFLICT`; nothing created | OPS-25 |
| AC-OPS-11 | Item 86'd after the tablet loaded the menu, then submitted | Refused with the line identified; no order; client marks the line | OPS-27, OPS-68 |
| AC-OPS-12 | Item 86'd after an order containing it was accepted | Accepted order and its tickets unchanged | OPS-68, MENU-6 |
| AC-OPS-13 | Kitchen credential or KDS device tries to create an order on Core | 403; no order | OPS-36, OPS-38 |
| AC-OPS-14 | Unelevated tablet credential tries to close a visit, request a check, initiate payment, transition a ticket | Each refused server-side | OPS-39, WT-4 |
| AC-OPS-15 | Tablet leaves Staff Mode, then replays a staff request with the old elevation | Refused | OPS-41 |
| AC-OPS-16 | Declared source `kiosk` from a staff login | Refused; no order | OPS-3 |
| AC-OPS-17 | Projector fails on an event repeatedly | Bounded retries; parked; exception opened; authorized release reprojects with no duplicate ticket | OPS-52 |
| AC-OPS-18 | 8 projectors race 16 re-projections | Exactly one ticket per round and station, one line per order line | OPS-52 |
| AC-OPS-19 | Station configuration changes between round submit and projection | Ticket uses the configuration effective at submit and records its version | OPS-53 |
| AC-OPS-20 | Product with no station mapping | Routed to the default station; exception raised; no line lost | OPS-54 |
| AC-OPS-21 | Two KDS screens bump the same ticket | One transition; the other gets `VERSION_CONFLICT` and refetches | OPS-55 |
| AC-OPS-22 | Backend unreachable for a period during service | KDS keeps tickets, shows offline with last sync; on reconnect refetches and shows tickets created meanwhile | OPS-57, KIT-6 |
| AC-OPS-23 | KDS consumer too slow | Connection closed `SLOW_CONSUMER`; client reconnects and refetches; no ticket missed | OPS-56 |
| AC-OPS-24 | Revoked KDS device on a live connection | Connection closed at revalidation; no further events | OPS-78, §16.5 |
| AC-OPS-25 | Printer offline during an order | Order accepted; job queued; after retries `failed`, Admin alert and exception | OPS-63, PRT-2 |
| AC-OPS-26 | Venue Edge restarts during dispatch | Job `uncertain`; not auto-resent; reprint is attributed and marked as a reprint | OPS-62, OPS-64 |
| AC-OPS-27 | Duplicate Edge outcome report | Idempotent; one state change | OPS-61, EDGE-2 |
| AC-OPS-28 | 86 with one channel failing to confirm | That channel `failed` with exception and retry; others confirmed; no "all confirmed" display | OPS-67 |
| AC-OPS-29 | 86 propagation measured under load | p95 under 30 s across in-scope channels | OPS-67, AVL-1 |
| AC-OPS-30 | Card payment adapter reports `uncertain` | Surface shows uncertain; no retry offered until reconciled; visit close refused | OPS-72, PAY-6 |
| AC-OPS-31 | Cash payment with no open shift | `NO_OPEN_SHIFT`; nothing recorded | OPS-72 |
| AC-OPS-32 | Guest Mode credential requests payment initiation | Refused | OPS-73 |
| AC-OPS-33 | Same failure detected repeatedly | One open exception, last-observed updated | OPS-80 |
| AC-OPS-34 | Exception dismissed without a note | Refused | OPS-80 |
| AC-OPS-35 | Every mutation in 02.7 audit list performed once | One correlated audit record each, actor class correct (device actors included once DEC-OPS-21 is met) | 02.7, NFR-AUD |
| AC-OPS-36 | Cross-venue access attempt on visit, order, ticket, realtime and reservation endpoints | Refused with no data leakage | INV-2, NFR-SEC-3 |
| AC-OPS-37 | Core order inspected for legacy integration state | None present | OPS-86 |
| AC-OPS-38 | Table with an active Nest order; Core open attempted, and the reverse | Each refused by the bridge | OPS-22 |
| AC-OPS-39 | Order submission latency under the owner-set load profile | P95 under 500 ms (O-19) | NFR-PERF |
| AC-OPS-40 | Kiosk idle with a filled cart and entered name | Reset clears cart and personal data on device | OPS-47 |
| AC-OPS-41 | Staff enters a phone order, the response is lost, and the client retries with the same key | One order with the phone source channel and the entering staff, device and application identity recorded; the replay returns the original | OPS-88, OPS-25 |
| AC-OPS-42 | Phone channel declared by a kiosk or Guest Mode credential; dine-in phone order naming a table with no open visit | Each refused with a stable code; no order created and no visit opened | OPS-88, OPS-3 |
| AC-OPS-43 | Counter takeaway order from Waiter Tablet Staff Mode at a venue whose operating profile does not enable counter ordering, then at one that does | First refused server-side; second creates a takeaway order with no visit and a human-readable collection reference | OPS-89, DEC-ADMIN-10 |
| AC-OPS-44 | Server reassigned on a visit, then a ready alert fires; a second visit has no assignment | Change audited with before and after values; alert routed to the new assignee; unassigned visit's alert goes to the fallback audience; no authorization changed | OPS-90 |
| AC-OPS-45 | A client tries to change the quantity of a line in an accepted round; a Guest Mode credential tries to void a line | Edit refused (only a linked void plus new round is possible); round snapshot unchanged; Guest Mode void refused | OPS-91 |
| AC-OPS-46 | Two users change one ticket's priority concurrently; the KDS is checked in greyscale | One change applies, the other gets `VERSION_CONFLICT`; the change is audited; priority remains distinguishable without colour | OPS-92 |
| AC-OPS-47 | New tickets arrive at a station with the alert enabled, including several during an outage | One alert per new ticket; one combined alert after reconnect; no re-alert on refetch of shown tickets; muted audio shown on screen | OPS-93 |

## 02.12 KPIs and metric definitions

| Metric | Definition | Target |
|---|---|---|
| Order submission latency | Time from Core receiving an order or round request to its committed response, per source, excluding printing | P95 < 500 ms (SPRD §19; O-19) |
| KDS propagation | Round commit to ticket visible on the station's KDS | < 3 s (KIT-3; O-19) |
| Print latency | Round commit to `printed` (or `delivered` where no acknowledgement exists) on venue hardware | < 3 s (PRT-3; O-4) |
| 86 propagation | AvailabilityChange commit to `confirmed` per in-scope channel | p95 < 30 s (AVL-1) |
| False success | Count of states shown as successful without confirmation (order, print, payment, propagation) | None permitted (PR-4) |
| Duplicate orders / KOTs | Orders or KOTs created more than once for one intent | None permitted (§11 release acceptance) |
| Kitchen prep time | Ticket `acknowledged` (or `new`) to `ready`, per station | OWNER TARGET REQUIRED (DEC-OPS-22) |
| Delayed tickets | Share of tickets exceeding the venue's KIT-5 age threshold | OWNER TARGET REQUIRED (DEC-OPS-22) |
| Visit close blocked | Close attempts refused, by blocking count type | Monitoring only |
| Exception age | Oldest open operational exception per kind | OWNER TARGET REQUIRED (DEC-OPS-17) |
| Projector backlog | Depth and oldest pending age of `order.round_submitted` | OWNER TARGET REQUIRED (SPRD §19) |
| Covers, table turn, no-show rate | As defined by RPT-1 in 08 | Reporting only |

**Verdura numbers recorded as proposed evidence, not adopted:** KDS p95 under 2 s from POS acceptance; order ingestion success above 99.9%; mapping completeness 100% before outbound go-live (superseded concept); Display Window suppression under 60 s; 86 operable in under 5 seconds at peak. Any adoption is DEC-OPS-22.

## 02.13 Open decisions

| ID | Decision | Why it matters | Options evidenced | Blocks | Tier |
|---|---|---|---|---|---|
| DEC-OPS-1 | Order cancellation, line void and comp model in Core: before kitchen release, after release, after billing; kitchen, print and check effects | Core has none; corrections are a release-acceptance need | Compensating void record per line (Verdura reversal doctrine); check void first then line void (D5 rules) | OPS-32 to OPS-35, WF-OPS-10 | **APPROVED — TIER 2** (2026-10-05; mechanism only, see 00.10.4; was: 2 (policy values via DEC-X-7: 3)) |
| DEC-OPS-2 | Reservation ↔ visit link and reservation owner in Core (with O-7) | Seating, covers and no-show metrics | Reservation id on TableSession; link table; Nest `Reservation.tableId` today | OPS-10 | **APPROVED — TIER 2** (2026-10-05; mechanism only, see 00.10.4; was: 2) |
| DEC-OPS-3 | May staff exceed reservation capacity, and with what control | RES-3 says no overbooking | Never; permitted role with reason and audit (Verdura) | OPS-8 override | 3 — **not an acceptance blocker:** authoritative behaviour is no overbooking (SPRD RES-3, OPS-8). A staff override is an optional FUTURE capability and policy decision |
| DEC-OPS-4 | Station routing data model: product or category → station, default station, multi-station lines, effective dating | KIT-1 needs data; Core has a single station | Category default plus item override (Verdura routing hint); ticket key already per station | OPS-53, OPS-54 | **APPROVED — TIER 2** (2026-10-05; mechanism only, see 00.10.4; was: 2) |
| DEC-OPS-5 | Visit transfer, merge and split semantics and scope | Common service actions; money must not move silently | D2 intended transfer (keep id, bump version); Verdura lineage merge/split | OPS-21 | **APPROVED — TIER 2** (2026-10-05; mechanism only, see 00.10.4; was: 2 (scope 3)) |
| DEC-OPS-6 | Service area as a first-class entity | SPRD §8 context names it; TBL-1 does not | Area on Table; separate entity; none | OPS-23 | **APPROVED — TIER 2** (2026-10-05; mechanism only, see 00.10.4; was: 2) |
| DEC-OPS-7 | Order lifecycle in Core beyond `confirmed` (completion, relation to kitchen and check) | Clients and reports need one meaning | Order completes when billed and settled; when all tickets complete; no order status beyond confirmed | OPS-31 | **APPROVED — TIER 2** (2026-10-05; mechanism only, see 00.10.4; was: 2) |
| DEC-OPS-8 | Customer credential model for Guest Mode, kiosk and public web submission to Core (with O-2, O-20, O-21) | Core refuses these sources today | Device credential plus guest session; DL-081 web tablet model | OPS-40, OPS-45, Guest and kiosk paths | **APPROVED — TIER 2** (2026-10-05; mechanism only, see 00.10.4; was: 2) |
| DEC-OPS-9 | Kiosk payment flow and kiosk menu channel | KSK has no payment rule; `MenuChannel` has no kiosk value | Pay at counter (PAY-1); prepaid (PAY-2); both per order type | OPS-44 | 3 (channel: 2) |
| DEC-OPS-10 | Kiosk table orders: join open visit, open visit, or takeaway only | Visit integrity and close gate | Bind to open visit; refuse if none | OPS-46 | 2 |
| DEC-OPS-11 | Per-client offline behaviour for the Waiter Tablet and KDS (NFR-OFF) | Service continuity vs truthful state | Drafts only; queued KDS transitions with version replay (Verdura) | OPS-43, OPS-57 | **APPROVED — TIER 2** (2026-10-05; mechanism only, see 00.10.4; was: 2) |
| DEC-OPS-12 | Window Display and AVL-1: **conceptually resolved 2026-10-05 (Tier 2 accepted)** — AVL-1 applies whenever the display represents availability; general content keeps the 60 s refresh (OPS-51). Residual: whether a venue configures signage-only displays (venue configuration) and the O-17 channel list | WD-1 refresh versus AVL-1 p95 under 30 s | Notification for availability; 60 s refresh for other content | OPS-51 | 2 (resolved); O-17 remains 3 |
| DEC-OPS-13 | D8 device kinds for kiosk and window display (with O-21 naming) | Device identity and revocation for those apps | New kinds; reuse existing | OPS-45, OPS-49 | 2 |
| DEC-OPS-14 | 86 granularity (item, modifier option, channel-scoped) and the Core write owner for availability | AVL-1 per-channel states need a model | Venue-level item 86 only (today); channel-scoped (Verdura) | OPS-66, OPS-70 | **APPROVED — TIER 2** (2026-10-05; mechanism only, see 00.10.4; was: 2) |
| DEC-OPS-15 | Availability reason codes and whether a reason is mandatory | Audit quality vs speed at peak | Fixed list; configurable list; optional | OPS-66 | 3 |
| DEC-OPS-16 | Print job record and station-to-printer mapping model (with O-4) | PRT-1 routing and Edge contract | Core job, Edge command (this volume's default); Edge-only queue | OPS-61 | **APPROVED — TIER 2** (2026-10-05; mechanism only, see 00.10.4; was: 2) |
| DEC-OPS-17 | Exception severity scale, ageing thresholds, alert routing, and which dismissals need step-up | Alertability (§18.11) | Verdura CRITICAL/WARNING streams | OPS-79, alerts | 3 |
| DEC-OPS-18 | Courses, fire and hold, expo and rush priority scope. **Note (2026-10-05):** inclusion of courses, expo and ticket priority is resolved by DEC-X-1 (owner 2026-10-05; phasing DEC-X-17); open residual: priority levels, pacing and firing policy | Kitchen pacing | Verdura course and expo model | OPS-28, OPS-60, OPS-92 | 3 |
| DEC-OPS-19 | Allergen acknowledgement at ordering or KDS | Guest safety posture; no regulatory claim | Verdura audited tap-acknowledge | OPS-30 | 3 |
| DEC-OPS-20 | Disposition of transitional reservation pre-order and payment fields (with O-16, O-18) | Avoid a hidden second order model | Retire; migrate to Core pre-orders | OPS-11 | 3 |
| DEC-OPS-21 | Core audit attribution for device and system actors | KDS, kiosk, Edge actions must be auditable (INV-3) | Actor-class column; separate device audit | 02.7, AC-OPS-35 | 2 (with 09) |
| DEC-OPS-22 | Operational targets: prep time, delayed-ticket share, adoption of any Verdura evidence number | KPIs need owner targets | Verdura figures (02.12) as evidence only | 02.12 targets | 3 |
| DEC-OPS-23 | Which FUTURE operations capabilities are committed (waitlist, delivery aggregators, catering, signage playlists, interactive window reservation, staff operations, auto-86) (under DEC-X-1). **Inclusion RESOLVED by DEC-X-1 (owner 2026-10-05)** for the KitchenOS-described capabilities: waitlist and queue, online ordering (details O-18), delivery aggregators with channel pause, throttle and courier handoff, staff checklists, stock-driven 86, plus phone and counter channels, server assignment, courses, expo and priority; their phasing is DEC-X-17 and each sub-capability's policy stays open. **Still open (FUTURE, not KitchenOS-described):** catering events, visit merge and split, signage playlists, interactive window reservation, handover notes, incident log, station assignment, sell-through and scheduled-restore auto-86, modifier-option 86 | Scope control | Verdura roadmap (evidence); KitchenOS (evidence) | 02.14 planning of the FUTURE items | 3 (residual FUTURE items); inclusion resolved |
| DEC-OPS-24 | Phone-order policy: which fulfilment types (collection, delivery, dine-in on an open visit) and payment flows (pay later under PAY-1, prepaid under PAY-2) a venue offers for phone orders, and which caller details are required (data minimisation) | Release timing, payment risk and personal data | Pay later; prepaid; per fulfilment type | OPS-88 | 3 |
| DEC-OPS-25 | Delivery fulfilment model in Core: a delivery service mode beside `dine_in` and `takeaway`, delivery address and contact as Personal data, dispatch and courier-handoff states as an independent lifecycle (DEC-OPS-7), shared by phone, online and aggregator channels | Delivery orders need one model across channels | New service mode plus fulfilment record; adapter-only metadata | OPS-84, OPS-85, OPS-88 | **APPROVED — TIER 2** (orchestrator ratification 2026-10-05; mechanism only, 00.10.4) |

## 02.14 Future and deferred capabilities

| Capability | State | Dependency |
|---|---|---|
| Walk-in waitlist and paging; pickup order-status board (queue) | TARGET CAPABILITY — FUTURE DELIVERY (K(L25, L199, L231)) | DEC-X-17; queue and paging policy open; notification channels DEC-X-15 |
| Phone orders (OPS-88) | TARGET CAPABILITY — FUTURE DELIVERY (K(L195)) | DEC-X-17, DEC-OPS-24, DEC-OPS-25 (delivery) |
| Counter and walk-in takeaway ordering on Waiter Tablet Staff Mode and kiosk (OPS-89) | TARGET CAPABILITY — FUTURE DELIVERY (K(L21–27)) | DEC-X-17, DEC-X-8 (QSR throughput), operating profile in 09, kiosk decisions DEC-OPS-8 to DEC-OPS-10 |
| Server assignment (OPS-90) | TARGET CAPABILITY — FUTURE DELIVERY (K(L196)) | DEC-X-17, DEC-X-2, 06 rosters |
| Reservation reminders, automated no-show sweep, no-show fees, deposits, calendar sync | Calendar sync: TARGET CAPABILITY — FUTURE DELIVERY (O-16 inclusion resolved); others FUTURE / OWNER DECISION REQUIRED | O-16, DEC-OPS-20, DEC-X-17 |
| Third-party reservation platforms; interactive window-display reservation (would change WD-1 "no ordering" scope) | FUTURE | DEC-OPS-23, owner change to WD-1 |
| Visit merge and split; derived table service states; floor plan | Visit merge and split: FUTURE (not KitchenOS-described; bill split and merge are volume 07). Derived table service states: FUTURE. Floor-plan editor: DEFERRED (SPRD §13) | DEC-OPS-5 (mechanism), DEC-X-17 |
| Courses, fire and hold, expo, rush and ticket priority (OPS-60, OPS-92); new-ticket audible alert (OPS-93); allergen acknowledgement | Courses, firing, expo, priority and alert: TARGET CAPABILITY — FUTURE DELIVERY (K(L16, L197, L403, L405, L406)). Allergen acknowledgement: policy DEC-OPS-19 | DEC-X-17, DEC-OPS-18, DEC-OPS-19 |
| Auto-86 by sell-through counter, scheduled restore, modifier-option 86 | FUTURE | DEC-OPS-14 |
| Stock-driven 86; consumption emission per closed line | TARGET CAPABILITY — FUTURE DELIVERY (K(L203)) | 03, 04 (O-9 inclusion resolved), DEC-X-17 |
| Lost-sales estimate for 86 periods | FUTURE | 08 |
| Delivery aggregator channels, channel pause and throttle, courier handoff | TARGET CAPABILITY — FUTURE DELIVERY (K(L27, L195, L426–433)) | DEC-X-17, DEC-OPS-25, INV-19 adapters; each sub-capability's policy open |
| Catering and events (quote, function sheet, staged payments) | FUTURE (not described by KitchenOS; see DEC-OPS-23) | DEC-X-17, 07 receivables (deferred); policy open |
| Signage playlists, item-bound promotional slides suppressed on 86 | FUTURE | DEC-OPS-23, WD-1 |
| Staff operations: checklists | TARGET CAPABILITY — FUTURE DELIVERY (K(L246)) | DEC-X-17, 04 food-safety records, 06 Workforce; policy open |
| Staff operations: handover notes, incident log, station assignment | FUTURE | 06 Workforce, DEC-OPS-23 |
| Prep-time prediction and load-aware routing | FUTURE | 08 BI forecasting |
| Public web ordering or pre-ordering | TARGET CAPABILITY — FUTURE DELIVERY (inclusion resolved in O-18; K(L195)) | O-18 (scope details, payment flow, channels), DEC-X-17 |
| Windows POS operational workflows | DEFERRED | POS analysis report (SPRD §12) |
| External-POS handoff, IdealPOS connector, POS-authoritative totals, mapping workspace | Not a Servvia capability (TRANSITIONAL legacy only, retiring) | SPRD §34.2 |
