# Servvia PRD — Consolidated view (GENERATED)

> **Status:** DERIVED, GENERATED VIEW — **not an authority and not editable.** It is regenerated deterministically from [`product-requirements.md`](product-requirements.md) and volumes 00–09 by `generate_consolidated.py` (kept with the 2026-10-05 hardening evidence). Any edit made here is lost on regeneration; change the source volume instead. On any difference, the source wins.

> **Source fingerprints (sha256, first 16 hex):** `product-requirements.md` 0e918cab5e5732ca; `00-overview-and-conventions.md` 7f34a273db444db1; `01-home.md` 71a61a16ead55623; `02-operations.md` abaf8f15cbcd1ef3; `03-recipe-and-production.md` 571ce13d4fcf356c; `04-material-management.md` 64ab7072cae6c3d6; `05-crm-and-loyalty.md` b3d1dcb6ef700b80; `06-workforce.md` 6de1f7a0ae292e3c; `07-finance.md` 95beae6e6396ced0; `08-reports-and-bi.md` c04c2fde9e8616a3; `09-administration.md` e22f41721a60b879

## 1. Authority and corpus map

Authority order: owner decisions → `product-requirements.md` → accepted ADRs and decisions → verified repository reality (CURRENT claims) → volumes 00–09 → source material (Verdura v5.2, non-authoritative) → planning output (never authority). See [00 §00.1](00-overview-and-conventions.md).

## 2. Cross-domain invariants (from volume 00)

| ID | Invariant |
|---|---|
| INV-1 | **Single canonical owner.** Each capability and each business object has exactly one canonical owner (a Go Core domain package in the target architecture, PostgreSQL as the record). |
| INV-2 | **Tenancy and scope.** Every business object belongs to exactly one organization; |
| INV-3 | **Identity classes stay distinct:** human staff (named staff account), customer/guest, device (D8 credential, venue-bound), service/integration, and system (worker or scheduled process). |
| INV-4 | **Authorization is deny-by-default and server-side**, composed of role permissions and venue grants, checked per request and per realtime subscription. |
| INV-5 | **Provenance.** Every order, financial record and operational mutation records actor identity, device identity, application identity, operating mode (O-21, decided; |
| INV-6 | **Money** is stored as integer minor units with an ISO 4217 currency code. |
| INV-7 | **Quantities** are decimals with an explicit unit of measure. |
| INV-8 | **Time and business date.** Instants are stored in UTC, preserved exactly, and displayed in the venue's time zone (VEN-1). |
| INV-9 | **Identifiers.** Records carry an opaque, server-generated identifier (format per `contracts/`) and, where people use them, a human-readable number from a collision-checked, gap-controlled series per object type and sco… |
| INV-10 | **Lifecycles** are explicit state machines with enumerated transitions. |
| INV-11 | **Immutable history.** Posted, financial, issued or acknowledged records are never edited or deleted; |
| INV-12 | **Idempotency.** Every externally retried command carries an idempotency key; |
| INV-13 | **Events.** A state change, its audit record and its domain event commit in one transaction (Part B row K). |
| INV-14 | **Truthful state.** No surface reports success it has not confirmed. |
| INV-15 | **Audit.** Every security-sensitive, financially significant and configuration mutation emits an append-only, attributable, correlated audit record with before and after values, retained at least 90 days (NFR-AUD). |
| INV-16 | **Errors** use stable, documented codes; |
| INV-17 | **Configuration** is data, inherited organization → venue with explicit, audited overrides; |
| INV-18 | **Data classification.** Every stored field belongs to one class: Public, Internal, Confidential, Personal (customer or employee), Financial, or Secret. |
| INV-19 | **Integration boundary.** External providers (payment, delivery, accounting, payroll, messaging, legacy POS) sit behind adapters. |
| INV-20 | **Mechanism versus policy.** The corpus specifies mechanisms (approvals, reasons, limits, audit, reversals). |
| INV-21 | **AI control model.** AI capabilities are classified as **prediction** (forecast or estimate), **recommendation** (a proposed action), **assisted action** (a human confirms each action before it is committed through the… |
| INV-22 | **Jurisdiction and locale readiness.** Tax profiles, payroll rules, compliance record formats, receipt and invoice content, currencies, locales, languages, date and number formats and integration differences are configu… |

## 3. Domain volumes

### Servvia PRD — Volume 01: Home

Source: [`01-home.md`](01-home.md).

**Requirements (28)** — ID | requirement (first sentence) | priority | state

| ID | Requirement | Priority | State |
|---|---|---|---|
| HOME-1 | Home is the Admin Console's default landing view after sign-in for every role granted Admin Console access. | MUST | TARGET |
| HOME-2 | Home shows the context it is scoped to (organization name and either one selected venue or "all venues I can access") and changes it only through the VEN-1 venue switcher. | MUST | TARGET |
| HOME-3 | Every Home element (tile, count, list row, notification, search result) is authorized with the same permission as its source record. | MUST | TARGET |
| HOME-4 | Home presents an exception queue drawn from the catalogue in 01.4.5, ordered by severity then age, filtered to the user's scope and to the classes their role may act on or view (DEC-HOME-2). | MUST | TARGET |
| HOME-5 | Every exception item, health signal and KPI tile links to the owning record or surface (drill-down). | MUST | TARGET |
| HOME-6 | An exception item is resolved only by the resolution of its source condition (01.4.1). | MUST | TARGET |
| HOME-7 | Authorized users can acknowledge and claim an exception item. | MUST | TARGET |
| HOME-8 | Recurrences of the same condition are coalesced by `dedupeKey` into one open item with an occurrence count and first/last seen times. | MUST | TARGET |
| HOME-9 | Every tile and list shows its `asOf` time in the venue time zone (INV-8) and its freshness state (01.4.4). | MUST | TARGET |
| HOME-10 | Home uses Core realtime notifications to refetch over HTTP (NFR-RT). | MUST | TARGET |
| HOME-11 | A health summary shows, for the user's scope: Venue Edge heartbeat, version, queue depth and oldest queued age per venue (EDGE-3); | MUST | TARGET |
| HOME-12 | KPI tiles display only metrics defined in volume 08, cite the metric definition, state the business-date basis (INV-8, DEC-X-3) and mark values for an open business day as provisional. | SHOULD | TARGET |
| HOME-13 | A multi-venue rollup aggregates only metrics whose volume 08 definition is additive across venues, and refuses to sum amounts in different currencies (INV-6, DEC-X-11). | SHOULD | TARGET |
| HOME-14 | In-app notifications are created for exception items and configured events, with per-recipient delivery state (01.4.2). | MUST | TARGET |
| HOME-15 | Categories designated mandatory (DEC-HOME-6) cannot be muted or disabled by a recipient; | MUST | OWNER DECISION REQUIRED (category list) |
| HOME-16 | Categories requiring acknowledgement record who acknowledged and when. | SHOULD | FUTURE |
| HOME-17 | Notification delivery over email or other channels retries with bounded backoff (§18.3); | MUST | TARGET |
| HOME-18 | Notification content carries only what the audience needs: no secrets, credentials, card data, provider references or unnecessary personal data (§20.9, INV-18). | MUST | TARGET |
| HOME-19 | A system follow-up task is created when an exception class is configured to require an owner. | SHOULD | TARGET |
| HOME-20 | Manual tasks, due dates, checklists, recurring tasks and escalation chains are not committed (DEC-HOME-5). | MAY | FUTURE |
| HOME-21 | Every Home screen element provides the SPRD §22 states (loading, empty, error, retry, offline or degraded, permission denied) at tile level, so one failing source never blocks the rest of Home. | MUST | TARGET |
| HOME-22 | During the transition Home sources each fact from the system that is the system of record for that venue and capability at that time (Nest or Core), labels nothing as live that comes from a system not serving the venue,… | MUST | TARGET (mechanism approved 2026-10-05: DEC-BI-8, which consolidates DEC-HOME-1) |
| HOME-23 | Home's initial render meets the Admin Console initial-load target (under 2 s on 10 Mbps, NFR-PERF; | MUST | TARGET |
| HOME-24 | Acknowledgement, claim, task cancellation, preference changes to mandatory-adjacent categories and support-operator views of Home emit audit records (INV-15). | MUST | TARGET |
| HOME-25 | Command search (scoped search over records, pages and actions) and command execution from a palette are not committed. | MAY | FUTURE |
| HOME-26 | Personal layout customization is not committed (DEC-HOME-10); | MAY | FUTURE |
| HOME-27 | Home displays AI output only as labelled insights. | SHOULD | TARGET CAPABILITY — FUTURE DELIVERY |
| HOME-28 | Finance-summary tiles and cross-domain tiles (for example sales against labour, food cost, stock or loyalty measures) appear on Home only for metrics defined in volume 08's metric catalogue (08.12), cite that definition… | SHOULD | TARGET CAPABILITY — FUTURE DELIVERY (the P11 headline tile for RPT-1 metrics is… |

**Open decisions (10)** — ID | decision | tier

| ID | Decision | Tier |
|---|---|---|
| DEC-HOME-1 | Which system sources each Home fact per venue during the Nest-to-Core transition, and how Home knows which system is the venue's system of record | Consolidated into DEC-BI-8 — **APPROVED — TIER 2** (2026-10-05; see 00.10.4) |
| DEC-HOME-2 | Which exception classes, tiles and actions each role sees on Home; | 3 |
| DEC-HOME-3 | Severity taxonomy for exceptions and notifications and the mapping of each exception class to a severity | **APPROVED — TIER 2** (2026-10-05; mechanism only, see 00.10.4; was: 2) |
| DEC-HOME-4 | Freshness thresholds (`live` / `delayed` / `stale`) per tile class | 3 |
| DEC-HOME-5 | Whether manual tasks, due dates, checklists, recurring tasks and escalation are committed scope, and the owning Core package (DEC-X-13) | 3 |
| DEC-HOME-6 | Mandatory (non-mutable) notification categories, acknowledgement requirement, escalation recipients and timing | 3 |
| DEC-HOME-7 | Retention of notifications, deliveries, exception attention history and tasks | 3 |
| DEC-HOME-8 | Targets for the Home metrics in 01.12 | 3 |
| DEC-HOME-9 | Organization-level rollup ownership while Core `organizations` does not exist | 2 |
| DEC-HOME-10 | Whether users may customize Home layout, and limits (pinned tiles that cannot be removed) | 3 |

### Servvia PRD — Volume 02: Operations

Source: [`02-operations.md`](02-operations.md).

**Requirements (93)** — ID | requirement (first sentence) | priority | state

| ID | Requirement | Priority | State |
|---|---|---|---|
| OPS-1 | Every operational surface reads and writes service-day state only through `contracts/` APIs. | MUST | TARGET |
| OPS-2 | Every order and round records source channel, application identity, actor identity and identity class, device identity and correlation ID (INV-5). | MUST | TARGET |
| OPS-3 | Core refuses a declared source channel that the verified credential is not entitled to (02.4.6), with a stable error and no order. | MUST | TARGET (implemented in Core) |
| OPS-4 | The source-channel set is closed and versioned in `contracts/`. | MUST | TARGET |
| OPS-5 | No target operational state, field or step depends on an external POS: no "awaiting POS" state, no POS handoff, no POS-returned totals and no kitchen release gated on POS acceptance. | MUST | TARGET |
| OPS-6 | A reservation is not a sale. | MUST | TARGET |
| OPS-7 | The RES-1 lifecycle is enforced server-side as an explicit state machine. | MUST | TRANSITIONAL (Nest); |
| OPS-8 | Reservation capacity (RES-3) is enforced for every booking path (Customer Website, Admin Console, staff entry) by one server-side check under a lock or constraint, proven by a concurrency test with no overbooking. | MUST | TRANSITIONAL (Nest) |
| OPS-9 | Reservation changes (party size, slot) re-run the capacity check and use version compare-and-set; | MUST | TARGET |
| OPS-10 | Seating a reservation links it to the visit opened for its table; | SHOULD | TARGET (mechanism approved 2026-10-05: DEC-OPS-2; |
| OPS-11 | The transitional reservation fields `menuSelections`, `menuTotal`, `paymentStatus` and the provider payment-intent reference are not orders and not financial records. | MUST | TRANSITIONAL |
| OPS-12 | Each reservation records its source from a closed set; | SHOULD | TRANSITIONAL |
| OPS-13 | Reservation emails (RES-2, RES-5) have an explicit delivery state visible to staff; | SHOULD | TRANSITIONAL (Nest email) |
| OPS-14 | Marking no-show is a manual staff action (ADM-1). | SHOULD | TRANSITIONAL |
| OPS-15 | Table occupancy is derived from the open TableSession; | MUST | TARGET (implemented in Core) |
| OPS-16 | Opening a visit is idempotent by request key; | MUST | TARGET (implemented in Core) |
| OPS-17 | Covers are recorded on the visit and changed with version compare-and-set. | MUST | TARGET (implemented in Core) |
| OPS-18 | Closing a visit applies the financial-completeness rule (02.4.4). | MUST | TARGET (implemented in Core; |
| OPS-19 | Cancelling a visit is allowed only while it has no orders. | MUST | TARGET (implemented in Core) |
| OPS-20 | A closed visit refuses new orders, rounds and checks; | MUST | TARGET (implemented in Core) |
| OPS-21 | Moving a visit to another table, merging visits and splitting a visit are not available until DEC-OPS-5 is decided. | MUST (mechanism) | TARGET (mechanism approved 2026-10-05: DEC-OPS-5); |
| OPS-22 | During transition a table is occupied by exactly one model: the Nest order path refuses a table order while a Core session is open, and Core refuses to open a session while a session-less Nest order is active. | MUST | TRANSITIONAL |
| OPS-23 | Whether "service area" (SPRD §8) is a first-class entity with tables assigned to it is decided before any floor or section view is built (DEC-OPS-6). | SHOULD | TARGET (mechanism approved 2026-10-05: DEC-OPS-6) |
| OPS-24 | Order creation and round submission follow ORD-1 to ORD-5. | MUST | TARGET (implemented in Core) |
| OPS-25 | A client generates one idempotency key per user submit intent and reuses it on every retry of that intent, including after an app restart while the draft is preserved. | MUST | TARGET |
| OPS-26 | Any amount a client shows before Core's response is labelled an estimate; | MUST | TARGET |
| OPS-27 | When submission is refused for menu reasons (ORD-4: unavailable item, invalid option, stale price, unsupported tax configuration), the client refetches the menu, marks the affected lines and requires the user to change… | MUST | TARGET |
| OPS-28 | Lines carry modifier option IDs (PR-6), optional seat and notes. | MUST (IDs, seat, notes) | TARGET (implemented in Core) |
| OPS-29 | Takeaway orders have no visit, carry `serviceMode = takeaway` and follow the same idempotency, pricing and kitchen rules. | MUST | TARGET (implemented in Core) |
| OPS-30 | Allergens are shown during browsing on every ordering surface (MENU-2): both Waiter Tablet modes and the kiosk. | MUST (display) | TARGET |
| OPS-31 | When an order is complete, and how order status relates to kitchen and check state in Core, is decided before any client shows an order lifecycle beyond `confirmed` (DEC-OPS-7). | MUST | TARGET (mechanism approved 2026-10-05: DEC-OPS-7) |
| OPS-32 | **Core has no order cancellation, line void or comp today.** Until the mechanism approved in DEC-OPS-1 (2026-10-05) is implemented, no Core-switched client offers them, and this gap is shown truthfully in release readin… | MUST | TARGET (mechanism approved 2026-10-05: DEC-OPS-1; |
| OPS-33 | When built, a cancellation or void is a linked compensating record (target order, round or line; | MUST | TARGET (mechanism approved 2026-10-05: DEC-OPS-1) |
| OPS-34 | A void defines its effect on each dependent: kitchen ticket lines (shown as voided; | MUST | TARGET (mechanism approved 2026-10-05: DEC-OPS-1) |
| OPS-35 | Corrections after kitchen release, comps and manual discounts support step-up authorization by a permitted role and separation of duties (requester ≠ approver) as configurable mechanisms; | MUST (mechanism) | TARGET (mechanism approved 2026-10-05: DEC-OPS-1; |
| OPS-36 | The legacy Nest cancellation (order `cancelled` from any non-terminal status; | MUST | TRANSITIONAL |
| OPS-37 | Discounts in Core exist only as promotions evaluated by the server (D11); | MUST | TARGET (implemented in Core) |
| OPS-38 | Staff Mode and Guest Mode operate on the same venue, table, visit and order context (WT-1). | MUST | TARGET (Core enforcement implemented) |
| OPS-39 | Guest Mode cannot, by server-side refusal regardless of user interface: open, close, cancel or transfer a visit; | MUST | TARGET |
| OPS-40 | A Core guest order path records provenance per O-21 (00.10.6) and authenticates with the DEC-OPS-8 guest credential; | MUST | TARGET (decisions O-21 and DEC-OPS-8 resolved; |
| OPS-41 | Entering Staff Mode requires staff authorization (WT-5; | MUST | TARGET |
| OPS-42 | In the reduced first pilot, Guest Mode is excluded and the web Order Tablet in Staff Mode is the temporary settlement surface within ADR 0002 item 8. | MUST | TRANSITIONAL |
| OPS-43 | The Waiter Tablet never shows an order or round as submitted until Core has accepted it. | MUST | TARGET |
| OPS-44 | Kiosk ordering follows KSK-1 to KSK-5. | MUST | OWNER DECISION REQUIRED |
| OPS-45 | Kiosk submission to Core requires a kiosk credential model (DEC-OPS-8) and a D8 device kind for the kiosk (DEC-OPS-13). | MUST | TARGET (mechanism approved 2026-10-05: DEC-OPS-8; |
| OPS-46 | A kiosk order that names a table is bound to that table's open visit or handled as DEC-OPS-10 decides; | MUST | OWNER DECISION REQUIRED (DEC-OPS-10, package P9; |
| OPS-47 | The kiosk idle reset (KSK-2) discards the unsubmitted cart and any entered personal data from the device; | MUST | TARGET |
| OPS-48 | The Nest kiosk checkout defects recorded in the stabilisation track (CSRF refusal, missing idempotency key, additive GST, no refund) are not carried into the target kiosk path. | MUST | TRANSITIONAL |
| OPS-49 | The Window Display implements WD-1 read-only, from the `window_display` menu channel, never offering ordering. | MUST | TARGET |
| OPS-50 | The Window Display shows its offline or stale state and the age of its last successful refresh in the Admin Console device view; | SHOULD | TARGET |
| OPS-51 | Whenever a Window Display represents availability or orderability, an availability change reaches it within the AVL-1 target (p95 under 30 s), by notification rather than by the periodic refresh alone; | MUST | TARGET (Tier-2 conceptual resolution accepted 2026-10-05; |
| OPS-52 | Kitchen tickets are produced only by projection of the durable `order.round_submitted` event committed with the round (ORD-1); | MUST | TARGET (projection implemented in Core; |
| OPS-53 | Station routing (KIT-1) uses venue-scoped, effective-dated, audited station configuration held as data. | MUST | TARGET (single station implemented) |
| OPS-54 | A line whose product resolves to no active station goes to the venue's configured default station and raises an OperationalException; | MUST | TARGET |
| OPS-55 | Ticket transitions follow 02.4.7 with version compare-and-set; | MUST | TARGET (implemented in Core) |
| OPS-56 | KDS realtime uses the kitchen stream (D12): authorize at subscribe, refetch over HTTP on connect and reconnect, deduplicate by event ID, drop stale versions, reconnect and refetch after a slow-consumer close. | MUST | TARGET (implemented in Core) |
| OPS-57 | During a backend or network outage the KDS keeps showing received tickets (KIT-6), shows an offline indicator with the time of last successful sync, and reconnects automatically. | MUST | TARGET |
| OPS-58 | Ticket age colouring and the ready alert (KIT-5) use venue-configured thresholds; | SHOULD | TARGET |
| OPS-59 | For each order path, a venue's kitchen runs on one kitchen model: the legacy `Order.status` KDS for Nest-path orders, or KitchenTicket for Core orders. | MUST | TRANSITIONAL |
| OPS-60 | Expo readiness across stations, ticket priority (rush), course firing and allergen acknowledgement taps are not in committed delivery scope (DEC-OPS-18, DEC-OPS-19). | MAY | TARGET CAPABILITY — FUTURE DELIVERY; |
| OPS-61 | KOT print jobs derive from kitchen tickets per station-to-printer mapping (PRT-1). | MUST | TARGET |
| OPS-62 | Print status follows 02.4.8: `delivered` is not `printed`; | MUST | TARGET; |
| OPS-63 | An unreachable printer never blocks order acceptance; | MUST | TARGET |
| OPS-64 | A reprinted KOT is distinguishable from the original on paper, so the kitchen does not prepare it twice. | SHOULD | TARGET |
| OPS-65 | The legacy printer connector dispatch (`connector_dispatched`, connector commands) is TRANSITIONAL and retires with the external-POS surfaces. | MUST | TRANSITIONAL |
| OPS-66 | An 86 or restore by a permitted user commits an AvailabilityChange (02.4.9) and takes effect for Core order validation in the same transaction (MENU-6, ORD-4). | MUST | TARGET |
| OPS-67 | Every in-scope channel (O-17) carries its own propagation state; | MUST | TARGET |
| OPS-68 | An order submitted with an item that became unavailable after the client loaded the menu is refused (ORD-4) with the affected lines identified; | MUST | TARGET (refusal implemented in Core) |
| OPS-69 | Staff ordering surfaces show 86'd items as unavailable and not orderable; | MUST | TRANSITIONAL (Nest channel policy) |
| OPS-70 | Restore is manual. | MAY | Stock-driven 86: TARGET CAPABILITY — FUTURE DELIVERY (depends on 03 and 04; |
| OPS-71 | An operational surface requests a check for a visit or for named orders; | MUST | TARGET (implemented in Core) |
| OPS-72 | Card payment is initiated from a permitted staff surface and is `pending` until the trusted payment adapter reports through Venue Edge; | MUST | TARGET (implemented in Core) |
| OPS-73 | Guest Mode, KDS, Window Display and kiosks without an approved payment flow never initiate payment or settlement. | MUST | TARGET |
| OPS-74 | Order, kitchen, print, check and payment states are shown independently; | MUST | TARGET |
| OPS-75 | Every mutable operational aggregate (TableSession, Order, KitchenTicket, Reservation, item availability, PrintJob, OperationalException) is changed under version compare-and-set or row lock. | MUST | TARGET (Core aggregates implemented; |
| OPS-76 | Any new operational command that touches several aggregates takes locks in the global order TableSession → Order → Check → CheckPayment → Shift, and new aggregates are placed into that order by an explicit design record. | MUST | TARGET |
| OPS-77 | Multi-device views converge through realtime notification plus HTTP refetch; | MUST | TARGET (implemented in Core) |
| OPS-78 | Realtime authorization fails closed (SPRD §16.12); | MUST | TARGET |
| OPS-79 | Core maintains, per venue, an operational exception queue (02.4.12) covering every failure kind listed there, visible to permitted staff in the Admin Console and surfaced by 01. | MUST | TARGET |
| OPS-80 | Exceptions are deduplicated per cause and entity, auto-resolve only on verified resolution, and require a note for manual resolve or dismiss; | MUST | TARGET |
| OPS-81 | Payment-against-provider and cash-against-shift reconciliation items are owned by 07; | MUST | TARGET |
| OPS-82 | Every failure state named in this volume has a staff-visible recovery path (retry, reprint, release, resolve, escalate) and no failure is only in logs. | MUST | TARGET |
| OPS-83 | Public web ordering or pre-ordering is not built until O-18 is decided; | MUST | TARGET CAPABILITY — FUTURE DELIVERY (inclusion resolved in O-18, owner 2026-10-… |
| OPS-84 | Third-party delivery aggregators, if committed, attach through adapters (INV-19): aggregator orders become Core orders with their own source channel, adapter facts never overwrite canonical state, and every inbound payl… | MAY | TARGET CAPABILITY — FUTURE DELIVERY; |
| OPS-85 | Delivery channel pause and throttle, courier handoff, catering events, waitlist, staff checklists, handover notes and incident logs are not in committed delivery scope (02.14). | MAY | TARGET CAPABILITY — FUTURE DELIVERY for waitlist and queue, delivery channel pa… |
| OPS-86 | The Nest external-POS surfaces (`legacy-external-pos`, `pos-sync`, `connector`, `payment-observation`, printer connector dispatch) are TRANSITIONAL. | MUST | TRANSITIONAL |
| OPS-87 | Windows POS operational workflows (table behaviour, order entry, manager functions, payment UX, shifts and cash UX, offline) are not specified here. | — | DEFERRED |
| OPS-88 | **Phone orders.** Staff-entered telephone orders are a distinct source channel in the closed, versioned channel set (OPS-4), added by contract change; | MUST (when delivered) | TARGET CAPABILITY — FUTURE DELIVERY; |
| OPS-89 | **Counter and walk-in takeaway ordering.** Counter and walk-in takeaway orders are taken only on permanent surfaces: the Waiter Tablet in Staff Mode (staff-entered) and the kiosk (customer self-service, OPS-44 to OPS-47… | MUST (when delivered) | TARGET CAPABILITY — FUTURE DELIVERY (takeaway order mechanics TARGET, OPS-29); |
| OPS-90 | **Server assignment.** Permitted staff (DEC-X-2) can assign one or more staff members to a visit, a table or a service area (DEC-OPS-6) for a visit or for a service period. | MUST (when delivered) | TARGET CAPABILITY — FUTURE DELIVERY |
| OPS-91 | **Order modification after acceptance.** An accepted round is never edited. | MUST | TARGET (new rounds implemented in Core; |
| OPS-92 | **Ticket priority.** A kitchen ticket carries a priority whose level set and meaning are DEC-OPS-18. | MUST (when delivered) | TARGET CAPABILITY — FUTURE DELIVERY; |
| OPS-93 | **New-ticket audible alert.** Each station's KDS can play a configurable audible alert when a new ticket for that station arrives, alongside the KIT-5 ready alert. | SHOULD | TARGET CAPABILITY — FUTURE DELIVERY |

**Open decisions (25)** — ID | decision | tier

| ID | Decision | Tier |
|---|---|---|
| DEC-OPS-1 | Order cancellation, line void and comp model in Core: before kitchen release, after release, after billing; | **APPROVED — TIER 2** (2026-10-05; mechanism only, see 00.10.4; was: 2 (policy values via DEC-X-7: 3)) |
| DEC-OPS-2 | Reservation ↔ visit link and reservation owner in Core (with O-7) | **APPROVED — TIER 2** (2026-10-05; mechanism only, see 00.10.4; was: 2) |
| DEC-OPS-3 | May staff exceed reservation capacity, and with what control | 3 — **not an acceptance blocker:** authoritative behaviour is no overbooking (SPRD RES-3, OPS-8). A staff override is an optional FUTURE capability and policy decision |
| DEC-OPS-4 | Station routing data model: product or category → station, default station, multi-station lines, effective dating | **APPROVED — TIER 2** (2026-10-05; mechanism only, see 00.10.4; was: 2) |
| DEC-OPS-5 | Visit transfer, merge and split semantics and scope | **APPROVED — TIER 2** (2026-10-05; mechanism only, see 00.10.4; was: 2 (scope 3)) |
| DEC-OPS-6 | Service area as a first-class entity | **APPROVED — TIER 2** (2026-10-05; mechanism only, see 00.10.4; was: 2) |
| DEC-OPS-7 | Order lifecycle in Core beyond `confirmed` (completion, relation to kitchen and check) | **APPROVED — TIER 2** (2026-10-05; mechanism only, see 00.10.4; was: 2) |
| DEC-OPS-8 | Customer credential model for Guest Mode, kiosk and public web submission to Core (with O-2, O-20, O-21) | **APPROVED — TIER 2** (2026-10-05; mechanism only, see 00.10.4; was: 2) |
| DEC-OPS-9 | Kiosk payment flow and kiosk menu channel | 3 (channel: 2) |
| DEC-OPS-10 | Kiosk table orders: join open visit, open visit, or takeaway only | 2 |
| DEC-OPS-11 | Per-client offline behaviour for the Waiter Tablet and KDS (NFR-OFF) | **APPROVED — TIER 2** (2026-10-05; mechanism only, see 00.10.4; was: 2) |
| DEC-OPS-12 | Window Display and AVL-1: **conceptually resolved 2026-10-05 (Tier 2 accepted)** — AVL-1 applies whenever the display represents availability; | 2 (resolved); O-17 remains 3 |
| DEC-OPS-13 | D8 device kinds for kiosk and window display (with O-21 naming) | 2 |
| DEC-OPS-14 | 86 granularity (item, modifier option, channel-scoped) and the Core write owner for availability | **APPROVED — TIER 2** (2026-10-05; mechanism only, see 00.10.4; was: 2) |
| DEC-OPS-15 | Availability reason codes and whether a reason is mandatory | 3 |
| DEC-OPS-16 | Print job record and station-to-printer mapping model (with O-4) | **APPROVED — TIER 2** (2026-10-05; mechanism only, see 00.10.4; was: 2) |
| DEC-OPS-17 | Exception severity scale, ageing thresholds, alert routing, and which dismissals need step-up | 3 |
| DEC-OPS-18 | Courses, fire and hold, expo and rush priority scope. | 3 |
| DEC-OPS-19 | Allergen acknowledgement at ordering or KDS | 3 |
| DEC-OPS-20 | Disposition of transitional reservation pre-order and payment fields (with O-16, O-18) | 3 |
| DEC-OPS-21 | Core audit attribution for device and system actors | 2 (with 09) |
| DEC-OPS-22 | Operational targets: prep time, delayed-ticket share, adoption of any Verdura evidence number | 3 |
| DEC-OPS-23 | Which FUTURE operations capabilities are committed (waitlist, delivery aggregators, catering, signage playlists, interactive window reservation, staff operations, auto-86) (under DEC-X-1). | 3 (residual FUTURE items); inclusion resolved |
| DEC-OPS-24 | Phone-order policy: which fulfilment types (collection, delivery, dine-in on an open visit) and payment flows (pay later under PAY-1, prepaid under PAY-2) a venue offers for phone orders, and which caller details are re… | 3 |
| DEC-OPS-25 | Delivery fulfilment model in Core: a delivery service mode beside `dine_in` and `takeaway`, delivery address and contact as Personal data, dispatch and courier-handoff states as an independent lifecycle (DEC-OPS-7), sha… | **APPROVED — TIER 2** (orchestrator ratification 2026-10-05; mechanism only, 00.10.4) |

### Servvia PRD — Volume 03: Recipe and Production

Source: [`03-recipe-and-production.md`](03-recipe-and-production.md).

**Requirements (45)** — ID | requirement (first sentence) | priority | state

| ID | Requirement | Priority | State |
|---|---|---|---|
| RCP-1 | A menu item's allergens are a set of identifiers from one controlled allergen list. | MUST | TARGET (mechanism); |
| RCP-2 | Nutrition values (calories, protein, carbohydrates, fat) are stored as typed decimals with explicit units per declared serving. | MUST | TARGET |
| RCP-3 | Allergen and nutrition data are returned with the item by every menu read that serves an ordering or display surface (Waiter Tablet both modes, Kiosk, Customer Website, Window Display WD-1), and changes take effect on t… | MUST | TARGET |
| RCP-4 | Every change to an item's allergen or nutrition declaration emits an audit record with actor, before and after values and correlation ID (INV-15). | MUST | TARGET |
| RCP-5 | The declaration in force for an item at any past instant within the audit retention period can be reconstructed. | SHOULD | TARGET |
| RCP-6 | Surfaces present allergen data as venue-declared information. | MUST | TARGET |
| RCP-7 | "Not declared" and "declared free of listed allergens" are distinct states in storage, API and every display. | MUST | TARGET |
| RCP-8 | A recipe has a type (`dish`, `prep`, `component`), an output definition, lines and optional method steps, and belongs to one organization. | MUST | TARGET CAPABILITY — FUTURE DELIVERY |
| RCP-9 | Recipe versions follow the lifecycle of 03.4.2. | MUST | TARGET CAPABILITY — FUTURE DELIVERY |
| RCP-10 | Every derived fact (explosion, cost snapshot, production order, yield record) records the recipe version and loss-factor versions it used, so the same inputs reproduce the same result. | MUST | TARGET CAPABILITY — FUTURE DELIVERY |
| RCP-11 | A recipe line references a material or a sub-recipe with a decimal quantity and explicit unit, an optional loss-factor override and an optional `approximate` flag. | MUST | TARGET CAPABILITY — FUTURE DELIVERY |
| RCP-12 | Activation is refused if it would create a cycle in the sub-recipe graph, evaluated over all versions in force at the new version's effective time and after. | MUST | TARGET CAPABILITY — FUTURE DELIVERY |
| RCP-13 | Sub-recipe nesting depth is bounded by a configured limit; | MUST | TARGET CAPABILITY — FUTURE DELIVERY; |
| RCP-14 | Every line unit must convert to the material's base unit through explicit conversion data (volume 04); | MUST | TARGET CAPABILITY — FUTURE DELIVERY |
| RCP-15 | Scaling a recipe (production planning, portion multiples) is linear in output quantity; | SHOULD | TARGET CAPABILITY — FUTURE DELIVERY |
| RCP-16 | Loss factors are versioned with effective dates and resolved line override → material → category. | MUST | TARGET CAPABILITY — FUTURE DELIVERY |
| RCP-17 | A menu item links to at most one `dish` recipe in force per scope at any instant; | MUST | TARGET CAPABILITY — FUTURE DELIVERY |
| RCP-18 | Modifier deltas are keyed by modifier option identifiers (PR-6) and support add, remove, scale and substitute. | MUST | TARGET CAPABILITY — FUTURE DELIVERY |
| RCP-19 | Sales consumption is computed by a Core consumer of durable order facts (D13 pattern) when the trigger fact of DEC-RCP-2 commits; | MUST | TARGET CAPABILITY — FUTURE DELIVERY; |
| RCP-20 | Explosion resolves link, recipe version, modifier deltas and loss factors as in force at the source fact's business instant, not at processing time. | MUST | TARGET CAPABILITY — FUTURE DELIVERY |
| RCP-21 | Explosion is idempotent per source key: redelivery of the same fact returns the existing result and posts nothing new. | MUST | TARGET CAPABILITY — FUTURE DELIVERY |
| RCP-22 | When a source line is cancelled, voided or otherwise compensated in Core (semantics per DEC-RCP-2), the linked explosion is reversed by a linked reversal movement; | MUST | TARGET CAPABILITY — FUTURE DELIVERY; |
| RCP-23 | A sold item with no recipe link in force is recorded as `unmapped` with its quantity, and handled per DEC-RCP-3; | MUST | TARGET CAPABILITY — FUTURE DELIVERY; |
| RCP-24 | Once a menu item is linked, its computed allergen set is the union of its ingredients' allergen profiles through all sub-recipes and modifier deltas. | MUST | TARGET CAPABILITY — FUTURE DELIVERY |
| RCP-25 | Computed nutrition per serving is derived from material nutrition data through sub-recipes and loss factors, with a completeness indicator. | SHOULD | TARGET CAPABILITY — FUTURE DELIVERY; |
| RCP-26 | Recipe cost rolls up recursively through sub-recipes on the basis set by DEC-RCP-4 and is recorded as an immutable cost snapshot (03.4.5). | MUST | TARGET CAPABILITY — FUTURE DELIVERY; |
| RCP-27 | Margin per item and channel is derived from the Core-computed price and the current cost snapshot, on the tax basis set by DEC-RCP-4. | SHOULD | TARGET CAPABILITY — FUTURE DELIVERY; |
| RCP-28 | An activated material cost change recomputes affected cost snapshots through the dependency graph and raises an alert ranked by margin impact, with acknowledgment recorded. | SHOULD | TARGET CAPABILITY — FUTURE DELIVERY |
| RCP-29 | A what-if cost simulation (price, portion, substitution) never writes canonical state. | MUST | TARGET CAPABILITY — FUTURE DELIVERY |
| RCP-30 | Production orders follow 03.4.7; | MUST | TARGET CAPABILITY — FUTURE DELIVERY |
| RCP-31 | Where reservations are enabled (DEC-MAT-11), reserving a production order checks available-to-promise and returns a shortfall list instead of reserving a partial or negative quantity. | MUST | TARGET CAPABILITY — FUTURE DELIVERY; |
| RCP-32 | Posting a completed production order atomically records the issue of inputs and the output receipt in volume 04, creates the output batch with expiry from the shelf-life rule, releases any reservation and writes yield r… | MUST | TARGET CAPABILITY — FUTURE DELIVERY |
| RCP-33 | Completing without confirming actuals posts the plan as actuals with an `unverified` flag that stays on the record and is reported. | MUST | TARGET CAPABILITY — FUTURE DELIVERY |
| RCP-34 | A posted production order is corrected only by a linked reversal production document carrying actor and reason. | MUST | TARGET CAPABILITY — FUTURE DELIVERY |
| RCP-35 | Production and preparation waste is declared through volume 04 waste movements with a reason and a reference to the recipe or production order. | MUST | TARGET CAPABILITY — FUTURE DELIVERY |
| RCP-36 | A production output batch records the input batches consumed where inputs are batch-managed, enabling backward and forward trace (volume 04 recall). | MUST | TARGET CAPABILITY — FUTURE DELIVERY |
| RCP-37 | A production run groups orders, aggregates inputs, and splits outputs to destination venues by two-step transfers, keeping lineage. | MAY | FUTURE |
| RCP-38 | Recipe version activation and production posting can require approval through the shared approval mechanism (00.7) with separation of duties; | MUST | TARGET CAPABILITY — FUTURE DELIVERY; |
| RCP-39 | Recipe import (spreadsheet or document) produces drafts only; | MUST | FUTURE |
| RCP-40 | Before activation, a where-used impact preview lists affected menu items, parent recipes, open production orders and the cost change. | SHOULD | TARGET CAPABILITY — FUTURE DELIVERY |
| RCP-41 | Recipes, lines' materials and loss factors referenced by in-force records are deactivated, never deleted (INV-11). | MUST | TARGET CAPABILITY — FUTURE DELIVERY |
| RCP-42 | Concurrent activations of versions of the same recipe are serialised; | MUST | TARGET CAPABILITY — FUTURE DELIVERY |
| RCP-43 | Coverage is reported per venue and period as defined in 03.12. | SHOULD | TARGET CAPABILITY — FUTURE DELIVERY |
| RCP-44 | Core raises an allergen alert, as a persisted, attributed record shown on the relevant staff surface, when (a) an item's manually declared allergen set lacks an allergen computed from its recipe in force (RCP-24), shown… | MUST | TARGET CAPABILITY — FUTURE DELIVERY; |
| RCP-45 | An authorised user can generate an allergen label for a menu item, or for a prepared-material batch produced under RCP-32, from the allergen declaration in force at generation time (for a batch: the allergen set of the… | SHOULD | TARGET CAPABILITY — FUTURE DELIVERY; |

**Open decisions (18)** — ID | decision | tier

| ID | Decision | Tier |
|---|---|---|
| DEC-RCP-1 | Sequencing of recipe scope relative to materials (volume 04, O-9). | 3 (under DEC-X-17) |
| DEC-RCP-2 | Consumption trigger fact and compensation semantics | 2 |
| DEC-RCP-3 | Handling of unmapped sold items | 3 |
| DEC-RCP-4 | Costing basis and margin tax basis | 3 |
| DEC-RCP-5 | Allergen list governance and presentation | 3 — **COMPLIANCE/CONFIGURATION DECISION, required before relevant production use** (not a PRD-acceptance blocker; no list is fixed by the PRD) |
| DEC-RCP-6 | Dietary tags (for example vegetarian, vegan, gluten-free) beyond MENU-1 spicy flag | 3 |
| DEC-RCP-7 | Which recipe and production actions require approval, and thresholds (within DEC-X-7) | 3 |
| DEC-RCP-8 | Maximum sub-recipe nesting depth | 2 |
| DEC-RCP-9 | Production input over-consumption tolerance | 3 |
| DEC-RCP-10 | Shelf-life rules for prepared outputs and who maintains them | 3 |
| DEC-RCP-11 | Organization-shared recipes and declarations with venue variants | 2 |
| DEC-RCP-12 | Assisted recipe drafting (spreadsheet, document, AI) | 3 |
| DEC-RCP-13 | Precedence of computed versus declared nutrition; | 3 |
| DEC-RCP-14 | Multi-venue batch production (central kitchen) scope. | 3 |
| DEC-RCP-15 | Retention of recipe versions, cost snapshots, explosion, production and declaration history | 3 |
| DEC-RCP-16 | Visibility of costs and margins to kitchen and manager roles | 3 |
| DEC-RCP-17 | Kitchen-side surface for production and method steps; | 2 |
| DEC-RCP-18 | Targets for the 03.12 metrics and the production posting-age alert | 3 |

### Servvia PRD — Volume 04: Material Management

Source: [`04-material-management.md`](04-material-management.md).

**Requirements (47)** — ID | requirement (first sentence) | priority | state

| ID | Requirement | Priority | State |
|---|---|---|---|
| MAT-1 | A material is defined once per organization with type, category, base unit, alternative units, flags and status (04.4.1); | MUST | TARGET CAPABILITY — FUTURE DELIVERY |
| MAT-2 | Unit conversions are explicit, effective-dated data per material; | MUST | TARGET CAPABILITY — FUTURE DELIVERY |
| MAT-3 | Expiry-managed implies batch-managed; | MUST | TARGET CAPABILITY — FUTURE DELIVERY |
| MAT-4 | Suppliers, supplier items and price lists follow 04.4.2; | MUST | TARGET CAPABILITY — FUTURE DELIVERY |
| MAT-5 | Stock topology is venue → stock site → storage location → optional bin; | MUST | TARGET CAPABILITY — FUTURE DELIVERY |
| MAT-6 | Every change to stock is a posted, typed, immutable movement document; | MUST | TARGET CAPABILITY — FUTURE DELIVERY |
| MAT-7 | For every quant, quantity equals the sum of posted movement-line deltas for its coordinates; | MUST | TARGET CAPABILITY — FUTURE DELIVERY |
| MAT-8 | Movement types are configurable definitions fixing sign, statuses, batch creation, reason requirement, value rule, permission and approval eligibility (04.4.5); | MUST | TARGET CAPABILITY — FUTURE DELIVERY |
| MAT-9 | A posted movement is corrected only by a linked reversal or a compensating movement carrying actor and reason; | MUST | TARGET CAPABILITY — FUTURE DELIVERY |
| MAT-10 | Posting a movement is one transaction that locks or version-checks every affected quant, evaluates the negative-stock policy against the resulting quantities, and commits the document, quant deltas, value effects, audit… | MUST | TARGET CAPABILITY — FUTURE DELIVERY |
| MAT-11 | Every movement command carries an idempotency key; | MUST | TARGET CAPABILITY — FUTURE DELIVERY |
| MAT-12 | Negative stock is governed by an explicit policy per movement type and venue (DEC-MAT-2). | MUST | TARGET CAPABILITY — FUTURE DELIVERY; |
| MAT-13 | Sales consumption is never refused because stock is short: an order already accepted by Core is a fact. | MUST | TARGET CAPABILITY — FUTURE DELIVERY; |
| MAT-14 | `issue_sales_consumption` is posted only by the Core consumer of order facts (volume 03 RCP-19 for recipe items; | MUST | TARGET CAPABILITY — FUTURE DELIVERY |
| MAT-15 | ATP is computed as in 04.4.4 and exposed per material and stock site; | MUST | TARGET CAPABILITY — FUTURE DELIVERY |
| MAT-16 | A reservation never exceeds ATP at creation; | MUST | TARGET CAPABILITY — FUTURE DELIVERY; |
| MAT-17 | Requisitions and purchase orders follow 04.4.7; | MUST | TARGET CAPABILITY — FUTURE DELIVERY |
| MAT-18 | Requisition, purchase order and price list approvals use the shared approval mechanism (00.7); | MUST | TARGET CAPABILITY — FUTURE DELIVERY |
| MAT-19 | Purchase order transmission is an adapter command with explicit delivery state; | MUST | TARGET CAPABILITY — FUTURE DELIVERY |
| MAT-20 | A goods receipt posts receipts, batches, purchase order status and invoice expectation in one transaction; | MUST | TARGET CAPABILITY — FUTURE DELIVERY |
| MAT-21 | Receipt discrepancies are recorded as typed records with optional supplier claim and are never absorbed silently. | MUST | TARGET CAPABILITY — FUTURE DELIVERY |
| MAT-22 | Supplier invoices are matched three ways (04.4.9) within tolerances set by DEC-MAT-4; | MUST | TARGET CAPABILITY — FUTURE DELIVERY; |
| MAT-23 | A matched invoice is handed to volume 07 through a defined interface; | MUST | TARGET CAPABILITY — FUTURE DELIVERY |
| MAT-24 | Inter-site and inter-venue transfers are two-step via `in_transit` (04.4.10); | MUST | TARGET CAPABILITY — FUTURE DELIVERY |
| MAT-25 | Manual adjustments require a reason code; | MUST | TARGET CAPABILITY — FUTURE DELIVERY |
| MAT-26 | Counts follow 04.4.11: blind by default, snapshot-based variance, configured freeze mode, recount rule, approval, and posting as `count_adjustment` movements. | MUST | TARGET CAPABILITY — FUTURE DELIVERY; |
| MAT-27 | Waste, spoilage and damage are declared with reason codes and value attribution (04.4.12); | MUST | TARGET CAPABILITY — FUTURE DELIVERY |
| MAT-28 | Expiry handling applies the configured rule (DEC-MAT-12) when an expiry passes, changes status by a `status_block` movement (system actor), and raises a task; | MUST | TARGET CAPABILITY — FUTURE DELIVERY; |
| MAT-29 | Picking for production, transfers and events proposes batches in first-expiry-first-out order for expiry-managed materials; | SHOULD | TARGET CAPABILITY — FUTURE DELIVERY |
| MAT-30 | Inspection results change batch status per configured rule (`fail` never leaves stock `available`). | MUST | TARGET CAPABILITY — FUTURE DELIVERY; |
| MAT-31 | Opening and isolating a recall case sets every affected quant to `blocked` in one transaction, overriding other statuses, and records time to isolation. | MUST | TARGET CAPABILITY — FUTURE DELIVERY |
| MAT-32 | Batch trace is available backward (to receipt, supplier and input batches) and forward (to production outputs, transfers, current quants and the sales exposure window, labelled theoretical). | MUST | TARGET CAPABILITY — FUTURE DELIVERY |
| MAT-33 | A recall may recommend availability changes for affected menu items; | SHOULD | TARGET CAPABILITY — FUTURE DELIVERY; |
| MAT-34 | Temperature records and out-of-range tasks are stored per location; | MAY | TARGET CAPABILITY — FUTURE DELIVERY; |
| MAT-35 | Reorder rules and proposals follow 04.4.14; | SHOULD | TARGET CAPABILITY — FUTURE DELIVERY; |
| MAT-36 | Each value-bearing movement line stores unit cost and value under the method in force (DEC-MAT-3); | MUST | TARGET CAPABILITY — FUTURE DELIVERY; |
| MAT-37 | Price observations (price list, purchase order, invoice) are recorded per material and supplier over time and are immutable. | SHOULD | TARGET CAPABILITY — FUTURE DELIVERY |
| MAT-38 | Material cost changes emit a domain event consumed by volume 03 costing (RCP-28). | SHOULD | TARGET CAPABILITY — FUTURE DELIVERY |
| MAT-39 | Stock-driven availability: when ATP of a material falls below a configured threshold, menu items whose recipes in force need it are flagged; | MAY | TARGET CAPABILITY — FUTURE DELIVERY; |
| MAT-40 | Storeroom capture (receiving, counts, waste) on a device may save drafts locally, but posting requires durable acceptance by Core; | MUST | ARCHITECTURE DECISION REQUIRED |
| MAT-41 | Human document numbers come from collision-checked series per document type and venue (INV-9). | MUST | TARGET CAPABILITY — FUTURE DELIVERY |
| MAT-42 | Every master-data change, configuration change, movement, approval, override, status change and recall action is audited with before and after values (INV-15). | MUST | TARGET CAPABILITY — FUTURE DELIVERY |
| MAT-43 | Configuration (movement types, reason catalogues, units, policies, tolerances, rules) inherits organization → venue with audited overrides and is validated before activation (INV-17). | MUST | TARGET CAPABILITY — FUTURE DELIVERY |
| MAT-44 | Theoretical-versus-actual variance per material and count interval is computed from `issue_sales_consumption` and counts as defined in 04.12. | SHOULD | TARGET CAPABILITY — FUTURE DELIVERY |
| MAT-45 | Each material and stock site can carry a venue-configured low-stock threshold (in an explicit unit, INV-7; | SHOULD | TARGET CAPABILITY — FUTURE DELIVERY |
| MAT-46 | A venue can operate configurable food-safety and health-and-safety checklists: versioned templates (INV-17) of monitoring points (for example a temperature reading at a storage location, a hygiene or cleaning check, a r… | SHOULD | TARGET CAPABILITY — FUTURE DELIVERY; |
| MAT-47 | Reorder proposals (MAT-35) and any AI-derived inventory optimisation (for example forecast-driven par levels or order quantities) are predictions or recommendations under INV-21, or assisted actions in which an authoris… | MUST | TARGET CAPABILITY — FUTURE DELIVERY; |

**Open decisions (22)** — ID | decision | tier

| ID | Decision | Tier |
|---|---|---|
| DEC-MAT-1 | First materials slice. | 3 (under DEC-X-17) |
| DEC-MAT-2 | Negative-stock policy per movement type and venue | 3 |
| DEC-MAT-3 | Valuation method (per material type or organization) | 3 |
| DEC-MAT-4 | Three-way match tolerances and override authority | 3 |
| DEC-MAT-5 | Receipt over and short tolerances | 3 |
| DEC-MAT-6 | Count freeze mode, recount rule and count schedule | 3 |
| DEC-MAT-7 | Which materials actions require approval and their thresholds (within DEC-X-7) | 3 |
| DEC-MAT-8 | Stock-driven availability: recommendation or automatic AVL-1 change; | 3 |
| DEC-MAT-9 | Storeroom capture surface and its offline behaviour | 2 |
| DEC-MAT-10 | Granularity of sales consumption posting | 2 |
| DEC-MAT-11 | Whether reservations exist, and their representation | 2 |
| DEC-MAT-12 | Expiry rule | 3 |
| DEC-MAT-13 | Quality, food-safety and health-and-safety record policy and any applicable regime (with DEC-X-5). | 3 |
| DEC-MAT-14 | Recall authority, notification recipients and closure sign-off | 3 |
| DEC-MAT-15 | Supplier integration channels and invoice capture | 2 |
| DEC-MAT-16 | Retention for movements, invoices, quality and recall records, attachments | 3 |
| DEC-MAT-17 | Reorder automation. | 3 |
| DEC-MAT-18 | Valuation of inter-venue transfers | 3 |
| DEC-MAT-19 | Landed-cost composition | 3 |
| DEC-MAT-20 | Storage topology depth and storage-class segregation enforcement | 2 |
| DEC-MAT-21 | Targets for 04.9 alert thresholds and 04.12 metrics | 3 |
| DEC-MAT-22 | Temperature sensor ingestion path | 2 |

### Servvia PRD — Volume 05: CRM and Loyalty

Source: [`05-crm-and-loyalty.md`](05-crm-and-loyalty.md).

**Requirements (43)** — ID | requirement (first sentence) | priority | state

| ID | Requirement | Priority | State |
|---|---|---|---|
| CRM-1 | Transactional contact, customer profile, loyalty membership, marketing consent and communication preference are separate objects (05.1). | MUST | TARGET |
| CRM-2 | Reservation guest personal data (contact, occasion, special requests, dietary preferences) is readable and writable only by staff with the reservation permission at that venue (INV-2, INV-4). | MUST | TARGET (venue scoping CURRENT in Nest; |
| CRM-3 | Transactional messages (RES-2, RES-5) contain only content needed for the transaction. | MUST | TARGET |
| CRM-4 | No marketing communication is sent unless the recipient has effective consent for that purpose and channel at the moment of hand-off to the provider. | MUST | TARGET CAPABILITY — FUTURE DELIVERY; |
| CRM-5 | Every consent grant and withdrawal is an append-only ConsentRecord carrying the evidence listed in 05.4.3, including the consent wording version shown. | MUST | TARGET CAPABILITY — FUTURE DELIVERY; |
| CRM-6 | A withdrawal is available on every surface where the corresponding consent can be granted and through every marketing message, and requires no more steps than granting. | MUST | TARGET CAPABILITY — FUTURE DELIVERY; |
| CRM-7 | Communication preferences can only narrow permitted sends (channel, frequency ceiling, quiet hours, language); | MUST | TARGET CAPABILITY — FUTURE DELIVERY |
| CRM-8 | Hard bounces, complaints, withdrawals and erasures create SuppressionEntries on the contact point, enforced at send time across all profiles sharing it. | MUST | TARGET CAPABILITY — FUTURE DELIVERY |
| CRM-9 | A customer profile is organization-scoped. | MUST | TARGET CAPABILITY — FUTURE DELIVERY; |
| CRM-10 | A profile is created only by a trigger permitted under DEC-CRM-1 (for example loyalty enrolment or explicit customer account creation). | MUST | TARGET CAPABILITY — FUTURE DELIVERY; |
| CRM-11 | Identity resolution links a source record to a profile automatically only on an exact match of a verified key defined by DEC-CRM-2. | MUST | TARGET CAPABILITY — FUTURE DELIVERY; |
| CRM-12 | A merge requires the merge permission, field-level survivor choices and a reason. | MUST | TARGET CAPABILITY — FUTURE DELIVERY; |
| CRM-13 | An unmerge reverses exactly one MergeEvent within the configured window (DEC-CRM-2) using compensating records. | MUST | TARGET CAPABILITY — FUTURE DELIVERY; |
| CRM-14 | Profile dietary and allergen notes use the fixed MENU-2 allergen list plus structured dietary preferences; | MUST | TARGET CAPABILITY — FUTURE DELIVERY; |
| CRM-15 | Surface exposure: Guest Mode, Kiosk, Customer Website (other than the customer's own authenticated view, if DEC-CRM-16 permits) and Window Display never display any profile data. | MUST | TARGET (as a constraint on any surface that gains customer data) |
| CRM-16 | Loyalty enrolment is an explicit customer action recording the accepted terms version, surface and time. | MUST | TARGET CAPABILITY — FUTURE DELIVERY |
| CRM-17 | The loyalty ledger is append-only. | MUST | TARGET CAPABILITY — FUTURE DELIVERY |
| CRM-18 | Earn is posted from Core settlement of a check (D6 settlement) for a check linked to an active loyalty account, by an idempotent consumer of the settlement event (INV-13). | MUST | TARGET CAPABILITY — FUTURE DELIVERY; |
| CRM-19 | A refund, reversal or settlement revocation of an earned check (Core D9) posts a compensating `reverse` entry proportional to the refunded basis under DEC-CRM-6. | MUST | TARGET CAPABILITY — FUTURE DELIVERY; |
| CRM-20 | Redemption is idempotent, validated server-side against balance, program rules and fraud controls, and serialised per account (row lock or version compare-and-set, INV-10). | MUST | TARGET CAPABILITY — FUTURE DELIVERY |
| CRM-21 | The monetary effect of a redemption on a check is computed only by Core pricing (as a promotion/discount through D11 or as a tender, per DEC-CRM-8), never by a client or by the loyalty domain. | MUST | ARCHITECTURE DECISION REQUIRED |
| CRM-22 | Manual loyalty adjustments carry a reason code, actor and reference; | MUST | TARGET CAPABILITY — FUTURE DELIVERY; |
| CRM-23 | Expiry is applied by a scheduled worker under the program version's rule, posting `expire` entries; | MUST | TARGET CAPABILITY — FUTURE DELIVERY; |
| CRM-24 | Tier changes are recorded with effective dates and the program version and evidence that triggered them; | SHOULD | TARGET CAPABILITY — FUTURE DELIVERY |
| CRM-25 | Fraud and abuse controls are configurable mechanisms: per-account and per-device earn and redemption velocity limits, anomaly flags with a review queue, account suspension, and blocking of stored-value instruments after… | MUST | TARGET CAPABILITY — FUTURE DELIVERY; |
| CRM-26 | Loyalty and stored-value program configuration is versioned with effective dates, validated before activation and audited with before and after values (INV-17, INV-15). | MUST | TARGET CAPABILITY — FUTURE DELIVERY (loyalty configuration; |
| CRM-27 | Stored value is held as append-only transactions in integer minor units with a non-negative balance enforced in the database. | MUST | FUTURE |
| CRM-28 | Redeeming stored value against a check requires a Core tender or settlement path decided under DEC-CRM-10. | MUST | ARCHITECTURE DECISION REQUIRED |
| CRM-29 | Memberships hold no card data (PAY-5); | MUST | FUTURE |
| CRM-30 | A segment evaluated for a send is snapshotted (rule version, evaluation time, member identifiers) and the snapshot is retained with the campaign. | SHOULD | TARGET CAPABILITY — FUTURE DELIVERY |
| CRM-31 | Campaign sending is resumable and idempotent per recipient: a provider failure mid-send resumes without duplicate delivery; | MUST | TARGET CAPABILITY — FUTURE DELIVERY; |
| CRM-32 | Campaign attribution is a read-only derived measure using a configured window and method (DEC-CRM-13); | MUST | TARGET CAPABILITY — FUTURE DELIVERY; |
| CRM-33 | Feedback items are venue-scoped, may link to a visit or reservation, follow the 05.4.10 lifecycle, and can create a task in the operational home (01) by a configured rule. | SHOULD | TARGET CAPABILITY — FUTURE DELIVERY; |
| CRM-34 | Multi-venue behaviour: profiles, consent and loyalty accounts are organization-scoped; | MUST | TARGET CAPABILITY — FUTURE DELIVERY; |
| CRM-35 | A subject-access export assembles all personal data held about a verified subject (profile, attributes with provenance, consent history, transactional contacts, loyalty and stored-value ledgers, feedback) in a machine-r… | MUST | TARGET CAPABILITY — FUTURE DELIVERY; |
| CRM-36 | Erasure is performed by anonymisation: personal fields are replaced irreversibly, identity links are detached, contact points are suppressed, and financial, ledger and audit records keep their integrity with personal re… | MUST | TARGET CAPABILITY — FUTURE DELIVERY; |
| CRM-37 | Retention is enforced by scheduled sweeps per data category using periods set by DEC-X-4; | MUST | OWNER DECISION REQUIRED |
| CRM-38 | Personal data does not appear in logs, telemetry, error responses or domain-event payloads; | MUST | TARGET |
| CRM-39 | Exports of customer lists or reservation guest data require a dedicated export permission, record the purpose, the scope and the row count in the audit record, and are produced only from server-side scoped queries (INV-… | MUST | TARGET (reservation export) / TARGET CAPABILITY — FUTURE DELIVERY (CRM export) |
| CRM-40 | A customer acting through a self-service surface acts as the customer identity class (INV-3) and can read or change only their own data; | MUST | FUTURE |
| CRM-41 | Customer contact captured for online or pre-ordering (inclusion resolved by owner decision 2026-10-05; | MUST | TARGET CAPABILITY — FUTURE DELIVERY; |
| CRM-42 | A customer's order history is a read-only projection of Core orders, checks, refunds and visits that are linked to the customer's profile by an explicit identity link (05.4.2): a verified-key link from the order's trans… | SHOULD | TARGET CAPABILITY — FUTURE DELIVERY; |
| CRM-43 | Customer behaviour analytics and segmentation that profile identified customers (for example visit frequency or spend bands, inferred preferences, churn or lifetime-value predictions) run only for customers and purposes… | MUST | TARGET CAPABILITY — FUTURE DELIVERY; |

**Open decisions (18)** — ID | decision | tier

| ID | Decision | Tier |
|---|---|---|
| DEC-CRM-1 | **Inclusion resolved by DEC-X-1 (owner 2026-10-05):** customer profiles with order history are in the long-term target product. | 3 |
| DEC-CRM-2 | Identity-resolution policy: verified keys for auto-link, attribute source precedence, unmerge window, handling of two loyalty accounts in one program on merge | 3 |
| DEC-CRM-3 | Consent purpose and channel taxonomy; | 3 |
| DEC-CRM-4 | Classification and visibility of dietary and allergen notes: Personal-restricted or a sensitive sub-class; | 3 |
| DEC-CRM-5 | Whether free-text staff notes on profiles are permitted, and content rules | 3 |
| DEC-CRM-6 | Loyalty program model and economics: points, visits or tiers; | 3 |
| DEC-CRM-7 | Accounting treatment of loyalty value (liability or none) and its reporting to 07 | 3 |
| DEC-CRM-8 | How a loyalty redemption affects a check in Core: a D11 promotion/discount application or a tender | 2 |
| DEC-CRM-9 | Whether to offer stored value; | 3 |
| DEC-CRM-10 | Stored value as a Core tender (new tender type, settlement rules, refund-to-stored-value) without changing CARD3 | 2 |
| DEC-CRM-11 | Memberships: scope (3) and recurring billing architecture through a provider adapter (2) | 3 / 2 |
| DEC-CRM-12 | Frequency ceilings, quiet hours, sender identities per organization or venue (channels and providers are DEC-X-15) | 3 |
| DEC-CRM-13 | Attribution window and match methods | 3 |
| DEC-CRM-14 | Feedback sources, review-platform integrations and the negative-feedback task rule | 3 |
| DEC-CRM-15 | Fraud and abuse thresholds: velocity limits, code-lookup limits, staff self-dealing rule scope, suspension policy | 3 |
| DEC-CRM-16 | Customer self-service: authenticated portal, Guest Mode or kiosk self-identification, wallet passes; | 3 / 2 |
| DEC-CRM-17 | Privacy-request handling: responsible role, requester-verification method, response periods | 3 |
| DEC-CRM-18 | CRM and loyalty KPI targets and the withdrawal-to-suppression latency target | 3 |

### Servvia PRD — Volume 06: Workforce

Source: [`06-workforce.md`](06-workforce.md).

**Requirements (46)** — ID | requirement (first sentence) | priority | state

| ID | Requirement | Priority | State |
|---|---|---|---|
| WFM-1 | Operational access identity (09), actor attribution and employment records are separate. | MUST | TARGET |
| WFM-2 | Staff management (STF-1: add and remove staff, assign roles, reset credentials) remains owned by 09 and is the only way to grant or remove system access. | MUST | TRANSITIONAL (Nest `staff`); |
| WFM-3 | Deactivating a staff account or ending employment never removes or rewrites the staff identifier recorded on historical orders, checks, payments, shifts, cash movements, devices or audit records; | MUST | TARGET (Nest uses soft deletion today) |
| WFM-4 | A Core cash Shift (D7) is not attendance or rostered work. | MUST | TARGET |
| WFM-5 | Erasure of an employee's personal data (after the DEC-X-4 period) anonymises personal fields and documents while keeping identifiers, attribution, approved timesheet totals and export snapshots consistent. | MUST | OWNER DECISION REQUIRED |
| WFM-6 | Employee records are organization-scoped, numbered from a gap-controlled series, hold employment periods with history, and are never deleted while referenced. | MUST | TARGET CAPABILITY — FUTURE DELIVERY |
| WFM-7 | Position assignments carry venue and effective dates; | MUST | TARGET CAPABILITY — FUTURE DELIVERY |
| WFM-8 | Employee data is accessed in tiers: directory (name, position, venue), roster-relevant (availability, eligibility outcome), personal (contact, documents, date of birth if collected), pay-related (provider references, ra… | MUST | TARGET CAPABILITY — FUTURE DELIVERY |
| WFM-9 | Employee documents are stored as restricted attachments (00.7 attachments, O-8), validated and access-controlled, never in logs, with retention per DEC-X-4. | MUST | TARGET CAPABILITY — FUTURE DELIVERY; |
| WFM-10 | Certifications carry type, expiry and evidence; | SHOULD | TARGET CAPABILITY — FUTURE DELIVERY; |
| WFM-11 | Rosters follow `draft → published → locked`; | MUST | TARGET CAPABILITY — FUTURE DELIVERY |
| WFM-12 | Roster edits are serialised by version compare-and-set; | MUST | TARGET CAPABILITY — FUTURE DELIVERY |
| WFM-13 | Labour rules are configurable, typed, parameterised and versioned (06.4.4). | MUST | TARGET CAPABILITY — FUTURE DELIVERY; |
| WFM-14 | Servvia ships no jurisdiction-specific labour rule values, rates, rest periods, age limits or visa limits. | MUST | TARGET CAPABILITY — FUTURE DELIVERY; |
| WFM-15 | Employee availability statements are considered at roster time with the outcome (`block` or `warn`) set by configuration. | SHOULD | TARGET CAPABILITY — FUTURE DELIVERY |
| WFM-16 | Swaps and open-shift claims are offered only to employees eligible under position, certification and rule evaluation; | SHOULD | TARGET CAPABILITY — FUTURE DELIVERY; |
| WFM-17 | Labour-cost previews appear only if DEC-WFM-9 approves rate storage; | MAY | TARGET CAPABILITY — FUTURE DELIVERY; |
| WFM-18 | Attendance events are append-only, idempotent on a client-supplied key, and record device-captured and server-received times, source device identity, surface and authentication method. | MUST | TARGET CAPABILITY — FUTURE DELIVERY |
| WFM-19 | A clock action is attributed to a named employee only after staff authentication through trusted controls (INV-3, WT-5 pattern). | MUST | TARGET CAPABILITY — FUTURE DELIVERY; |
| WFM-20 | Clocking is hosted on an existing permanent surface selected by DEC-WFM-4; | MUST | ARCHITECTURE DECISION REQUIRED |
| WFM-21 | Offline clocking is permitted only on a surface with a durable local queue meeting EDGE-2/EDGE-3 semantics (no loss, no duplication, ordered replay, explicit unknown state). | MUST | ARCHITECTURE DECISION REQUIRED |
| WFM-22 | Time rounding, if configured, is applied only to derived timesheet lines; | MUST | TARGET CAPABILITY — FUTURE DELIVERY; |
| WFM-23 | Exception flags (06.4.6) are raised from attendance and rules with configurable thresholds and must each be resolved with a reason before the timesheet can be approved. | MUST | TARGET CAPABILITY — FUTURE DELIVERY; |
| WFM-24 | Location capture, geofencing, photographs and biometrics are not collected unless DEC-WFM-5 approves them. | MUST | OWNER DECISION REQUIRED |
| WFM-25 | Timesheets follow 06.4.6. | MUST | TARGET CAPABILITY — FUTURE DELIVERY |
| WFM-26 | A timesheet cannot be approved by the employee it belongs to, nor by anyone whose own adjustments on it await approval. | MUST | TARGET CAPABILITY — FUTURE DELIVERY; |
| WFM-27 | Employees can view their own timesheet before approval and attach a dispute comment; | SHOULD | TARGET CAPABILITY — FUTURE DELIVERY |
| WFM-28 | Leave requests follow 06.4.7; | SHOULD | DEFERRED (SPRD §13; |
| WFM-29 | Payroll calculation (gross-to-net, tax and deduction calculation, statutory payroll outputs) is an owner-approved capability that Servvia delivers only through (a) a jurisdiction payroll pack that is implemented and val… | MUST | TARGET CAPABILITY — FUTURE DELIVERY; |
| WFM-30 | A payroll export batch runs a completeness check and cannot produce an export containing unapproved timesheets; | MUST | TARGET CAPABILITY — FUTURE DELIVERY |
| WFM-31 | Exports are immutable snapshots with checksum and mapping version; | MUST | TARGET CAPABILITY — FUTURE DELIVERY |
| WFM-32 | Corrections after export are delivered as a delta export linked to the original; | MUST | TARGET CAPABILITY — FUTURE DELIVERY |
| WFM-33 | Export mappings (fields, format, transport) are versioned configuration per provider; | MUST | TARGET CAPABILITY — FUTURE DELIVERY; |
| WFM-34 | Joiner: creating an employee may propose a staff account, role and venue grants derived from the position; | SHOULD | TARGET CAPABILITY — FUTURE DELIVERY; |
| WFM-35 | Mover: a position or venue change raises an access-review task for the linked account; | MUST | TARGET CAPABILITY — FUTURE DELIVERY; |
| WFM-36 | Leaver: ending employment raises an immediate deprovisioning task for the linked account (deactivate, revoke sessions and refresh tokens including live realtime connections, end tablet elevations, clear the tablet-eleva… | MUST | TARGET CAPABILITY — FUTURE DELIVERY; |
| WFM-37 | A periodic access review lists linked accounts whose employment has ended, unlinked active accounts, and grants for venues outside current assignments. | SHOULD | TARGET CAPABILITY — FUTURE DELIVERY |
| WFM-38 | Federated sign-in and SCIM provisioning are DEFERRED (DEC-X-12); | MUST | DEFERRED |
| WFM-39 | Every change to employee records, positions, certifications, rule configuration, rule overrides, rosters (publish), adjustments, approvals, exports and links is audited with before and after values (personal values mask… | MUST | TARGET CAPABILITY — FUTURE DELIVERY |
| WFM-40 | An employee reading or acting on their own records does so as their staff account (human staff identity class); | MUST | FUTURE |
| WFM-41 | Operations (02) may read the published roster to show who is rostered today; | MAY | FUTURE |
| WFM-42 | Employee personal data never appears in logs, telemetry, error responses or domain-event payloads; | MUST | TARGET |
| WFM-43 | Performance notes, goals and recognition are not provided unless DEC-WFM-15 commits them; | MAY | TARGET CAPABILITY — FUTURE DELIVERY (performance analytics and reporting); |
| WFM-44 | Tip pooling or distribution calculations are not provided unless DEC-WFM-16 commits them. | MUST | FUTURE |
| WFM-45 | Organizations can configure training items (versioned; | SHOULD | TARGET CAPABILITY — FUTURE DELIVERY |
| WFM-46 | Servvia may provide AI staffing predictions (expected labour demand per venue, position and time window, derived from volume 08 demand forecasts) and recommendations (proposed rostered shifts or staffing levels for a dr… | SHOULD | TARGET CAPABILITY — FUTURE DELIVERY; |

**Open decisions (19)** — ID | decision | tier

| ID | Decision | Tier |
|---|---|---|
| DEC-WFM-1 | Core ownership of employment records: within `internal/staff/` or a separate workforce package (under DEC-X-13) | 2 |
| DEC-WFM-2 | Employee record scope: which personal fields and documents are collected (date of birth or age band, right-to-work, emergency contact, contracts) | 3 |
| DEC-WFM-3 | Labour rule set: rule types enabled, parameters, block or warn, override policy, who confirms templates, reminder offsets | 3 |
| DEC-WFM-4 | Clock surface and staff authentication method (reuse DL-081 PIN, separate clock PIN, badge) and any new device kind | 2 |
| DEC-WFM-5 | Location, geofencing, photograph or biometric verification for clocking | 3 |
| DEC-WFM-6 | Offline clocking and its queue host (client or Venue Edge) | 2 |
| DEC-WFM-7 | Time rounding rules and exception thresholds | 3 |
| DEC-WFM-8 | Pay-period calendars; | 3 / 2 |
| DEC-WFM-9 | Whether pay rates or indicative rates are stored, and labour-cost previews | 3 |
| DEC-WFM-10 | Leave types and balance source (provider or none) | 3 |
| DEC-WFM-11 | Timesheet approval policy: approver scope, multi-step approval, thresholds (with DEC-X-7) | 3 |
| DEC-WFM-12 | JML policy: automatic grant removal on mover, account proposal rules, linking criteria | 3 |
| DEC-WFM-13 | Swap and open-shift claim policy (first claim, manager pick, auto-approval) | 3 |
| DEC-WFM-14 | Employee self-service surface (Admin Console view, Waiter Tablet Staff Mode, or a new application through Part C change) | 2 / 3 |
| DEC-WFM-15 | Performance notes, goals and recognition. | 3 |
| DEC-WFM-16 | Tip pooling and distribution | 3 |
| DEC-WFM-17 | Workforce KPI targets, leaver deprovisioning time and clock latency targets | 3 |
| DEC-WFM-18 | Whether opening a cash shift (D7) should require or check attendance | 3 |
| DEC-WFM-19 | Payroll calculation mechanism: an in-house calculation engine driven by jurisdiction payroll packs, payroll-provider adapters, or both; | **APPROVED — TIER 2** (orchestrator ratification 2026-10-05; mechanism only, 00.10.4); applicability and validation evidence: P5 |

### Servvia PRD — Volume 07: Finance

Source: [`07-finance.md`](07-finance.md).

**Requirements (55)** — ID | requirement (first sentence) | priority | state

| ID | Requirement | Priority | State |
|---|---|---|---|
| FIN-1 | A check bills only accepted round lines of Servvia Core orders of one visit (or of explicitly named orders) that no standing check holds, copying each line's immutable priced snapshot including its discount. | MUST | TARGET (implemented in Core, not in production) |
| FIN-2 | Check subtotal, discount, total and contained tax are computed by Core pricing only (INV-6); | MUST | TARGET (implemented in Core, not in production) |
| FIN-3 | A visit may have several checks. | MUST | TARGET (implemented in Core, not in production) |
| FIN-4 | A check void requires a reason and an authorised role (FIN-34), and is refused (`CHECK_HAS_PAYMENTS`) unless no payment or adjustment is pending or uncertain and effective paid is zero. | MUST | TARGET (implemented in Core, not in production) |
| FIN-5 | Splitting a check (by line, seat, equal share or amount) and moving lines between checks are not in committed delivery scope. | MAY | TARGET CAPABILITY — FUTURE DELIVERY; |
| FIN-6 | A card tender is created `pending` by an authorised staff identity; | MUST | TARGET (implemented in Core, not in production) |
| FIN-7 | A new tender is refused unless its amount fits `available` and its currency equals the check's, decided under the check row lock; | MUST | TARGET (implemented in Core, not in production) |
| FIN-8 | An uncertain payment or adjustment is held explicitly, reserves capacity, never settles, is never retried and never becomes failed automatically. | MUST | TARGET (adapter path implemented in Core, not in production; |
| FIN-9 | `succeeded` and `failed` are final. | MUST | TARGET (implemented in Core, not in production) |
| FIN-10 | Every payment retains provider, provider transaction reference (in adapter metadata), method and timestamps; | MUST | TARGET |
| FIN-11 | No surface moves customer money before Core has recorded the tender. | MUST | TARGET; |
| FIN-12 | Where online or prepaid payment is enabled, Core verifies status, currency, amount, merchant and venue binding and replay before release to the kitchen; | MUST (where enabled) | TARGET (not implemented in Core; |
| FIN-13 | A cash tender is accepted only under the tendering staff member's open shift at the venue (otherwise `NO_OPEN_SHIFT`) and is recorded `succeeded` together with its cash movement, settlement (if paid in full) and audit i… | MUST | TARGET (implemented in Core, not in production) |
| FIN-14 | A staff member has at most one open shift per venue; | MUST | TARGET (implemented in Core, not in production) |
| FIN-15 | Shift close records the counted cash; | MUST | TARGET (implemented in Core, not in production) |
| FIN-16 | A shift variance outside a configured tolerance is flagged at close, requires a reason, and opens a reconciliation item (FIN-29); | SHOULD | OWNER DECISION REQUIRED (DEC-FIN-8) |
| FIN-17 | Cash movements other than sale and refund (paid-in, paid-out, safe drop, float top-up, change given on over-tender) are typed, positive-amount, reason-bearing movements on a shift that enter the expected-cash formula; | MAY | FUTURE (DEC-FIN-9; |
| FIN-18 | A refund is requested by an authorised staff identity against exactly one succeeded payment, with a reason, and is refused when it exceeds the payment's refundable capacity (`EXCEEDS_REFUNDABLE`). | MUST | TARGET (implemented in Core, not in production) |
| FIN-19 | A card refund's result comes only from the trusted payment adapter. | MUST | TARGET (implemented in Core, not in production); |
| FIN-20 | A reversal is originated only by the trusted payment adapter device when the provider reversed or cancelled a card tender; | MUST | TARGET (implemented in Core, not in production) |
| FIN-21 | A succeeded adjustment that brings effective paid below the total revokes the current settlement and reopens the check in the same transaction; | MUST | TARGET (implemented in Core, not in production) |
| FIN-22 | A refund identifies which lines and quantities it returns, so that item-level sales, tax attribution and future stock effects are reportable. | SHOULD | TARGET (mechanism approved 2026-10-05: DEC-FIN-5; |
| FIN-23 | Chargebacks and disputes are FUTURE adapter-originated adjustments with their own dispute lifecycle and evidence, never edits of the original payment. | MAY | FUTURE (DEC-FIN-16; |
| FIN-24 | A visit closes only when financially complete (07.4.6); | MUST | TARGET (implemented in Core, not in production) |
| FIN-25 | A promotion discount is computed by Core before tax, frozen in the round's applied-promotion snapshot and copied to check lines; | MUST | TARGET (implemented in Core, not in production) |
| FIN-26 | Comps, complimentary checks, zero-total checks and check-time manual discounts are not supported; | MUST (refusal); MAY (feature) | TARGET (refusal implemented in Core); |
| FIN-27 | Tax is computed only by Core from the venue's tax configuration; | MUST | TARGET (implemented in Core for the NZ profile, not in production); |
| FIN-28 | Receipts and tax invoices reproduce Core-recorded amounts and never recompute them; | MUST | OWNER DECISION REQUIRED (O-5) |
| FIN-29 | Core maintains a reconciliation queue of failed, stuck and mismatched financial items (07.4.8): uncertain payments or adjustments older than a configured age, card payments and adjustments without a matching provider re… | MUST | TARGET (not built; |
| FIN-30 | Card payments and adjustments are reconciled against the provider's records per venue and business date; | MUST | TARGET (not built; |
| FIN-31 | Every financial record is assigned exactly one venue business date, derived deterministically from its committed instant, the venue time zone and the trading-day boundary in force (INV-8, P3). | MUST | TARGET (rule decided by owner, P3, 2026-10-05) |
| FIN-32 | Day close is an explicit, audited operation per venue and business date. | MUST (pilot, per RPT-2) | TARGET (mechanism; |
| FIN-33 | Tips, gratuities and service charges are not modelled and no surface may add them client-side. | MUST (prohibition); MAY (feature) | OWNER DECISION REQUIRED (DEC-FIN-6, DEC-FIN-7) |
| FIN-34 | Core enforces the financial authorization matrix of 07.7 per request, from the verified credential, deny-by-default. | MUST | TARGET (implemented in Core, not in production) |
| FIN-35 | Void, refund, comp or discount, manual uncertain resolution, variance acceptance and reconciliation acceptance support step-up confirmation by a second authorised staff identity and separation of duties (requester ≠ app… | MUST (mechanism) | TARGET (Core mechanism not built; |
| FIN-36 | Every staff financial mutation writes an audit record in the same transaction (INV-15); | MUST | TARGET (implemented in Core, not in production; |
| FIN-37 | Every externally retried financial command carries an idempotency key and request fingerprint; | MUST | TARGET (implemented in Core, not in production) |
| FIN-38 | Financial writes follow one global lock order (TableSession → Order → Promotion → Check → Payment → Shift) and version compare-and-set; | MUST | TARGET (implemented in Core, not in production) |
| FIN-39 | Each financial write path can be disabled by configuration and then refuses with a stable code (`CHECK_WRITES_DISABLED`, `PAYMENT_WRITES_DISABLED`, `REFUND_WRITES_DISABLED`, `SHIFT_WRITES_DISABLED`) without partial effe… | MUST | TARGET (implemented in Core, not in production) |
| FIN-40 | Financial facts (check created and voided, payment resolved, settlement settled and revoked, adjustment resolved, shift closed) are published as durable domain events (INV-13) once a consumer exists (reconciliation, rep… | SHOULD | TARGET (no financial events today: no consumer) |
| FIN-41 | The accounting system of record (Servvia ledger, external accounting system fed by export, or both) is decided before any ledger or export work; | MUST (before ledger work) | OWNER DECISION REQUIRED (DEC-FIN-1) |
| FIN-42 | If a ledger is built: every journal entry balances per currency (Σ debits = Σ credits); | MUST (if built) | DEFERRED (SPRD §13) |
| FIN-43 | If a ledger is built: system entries are derived from Core financial facts by versioned, effective-dated posting rules; | MUST (if built) | DEFERRED (SPRD §13) |
| FIN-44 | If a ledger is built: a manual entry's creator cannot post it above the DEC-X-7 threshold; | MUST (if built) | DEFERRED (SPRD §13; |
| FIN-45 | If a ledger is built: accounting periods follow `open` → `closing` → `closed` with a close checklist whose items reference evidence (day closes, reconciliation queue empty or accepted, posting exceptions resolved); | MUST (if built) | DEFERRED (SPRD §13) |
| FIN-46 | Chart of accounts, posting-rule content, revenue-recognition basis for accounting, period calendar and valuation methods are owner or accountant policy and are never defaulted by Servvia. | MUST | OWNER DECISION REQUIRED (DEC-FIN-2) |
| FIN-47 | Payables, receivables (catering, events, house accounts), payment runs, dunning, supplier statement reconciliation, bank feeds, takings and bank reconciliation, and provider payout and fee recognition are deferred accou… | MAY | DEFERRED (SPRD §13) |
| FIN-48 | Accounting-system exchange is an outbound adapter (INV-19) fed from Core financial facts or ledger entries: per-document delivery state (`queued` → `sent` → `accepted` / `rejected` with reason), idempotent delivery, bou… | MUST (if built) | TARGET CAPABILITY — FUTURE DELIVERY (inclusion DEC-X-1, owner 2026-10-05); |
| FIN-49 | Financial records are classified Financial (INV-18); | MUST | TARGET |
| FIN-50 | Financial records are retained for an owner-decided period that is not shorter than any statutory obligation (DEC-X-5); | MUST | OWNER DECISION REQUIRED (DEC-FIN-14) |
| FIN-51 | Check merge: an authorised staff identity can combine the standing checks of one visit, or of several open visits of the same venue, into one check. | MAY | TARGET CAPABILITY — FUTURE DELIVERY; |
| FIN-52 | Wallet tenders: card-present digital wallets are accepted only through the trusted payment adapter (CARD3, unchanged), whose reported result is the only source of success; | MAY | TARGET CAPABILITY — FUTURE DELIVERY; |
| FIN-53 | Operational P&L: permitted roles can view a near-real-time operational profit view per venue and business date (and per group of granted venues) derived from Core sales measured per P11 (00.10.5), recipe cost of items s… | MAY | TARGET CAPABILITY — FUTURE DELIVERY; |
| FIN-54 | Jurisdiction tax reporting: permitted roles can produce tax summaries and return-supporting data per venue (or organization) and period from the tax amounts Core stored on each record (FIN-27, BI-4), in the structure a… | MAY | TARGET CAPABILITY — FUTURE DELIVERY; |
| FIN-55 | Split tender: a check may be satisfied by several payments of the same or different tender types (card, cash and, once FIN-52 exists, wallets), each created within `available` under the check lock (FIN-7). | MUST | TARGET (implemented in Core, not in production: D6/D7 balance and hold rule, 07… |

**Open decisions (19)** — ID | decision | tier

| ID | Decision | Tier |
|---|---|---|
| DEC-FIN-1 | Accounting system of record: Servvia ledger, external accounting system fed by export, or both with one declared authoritative. | 3 — integration inclusion resolved; ledger question open |
| DEC-FIN-2 | Chart of accounts, posting-rule content, accounting revenue-recognition basis, period calendar, valuation | 3 |
| DEC-FIN-3 | Tax policy beyond the NZ GST-inclusive profile: other profiles, zero-rated or exempt items, effective-dated rate changes, rounding level (check vs line) confirmation | 3 |
| DEC-FIN-4 | GST attribution of partial and full refunds and reversals (pro-rata of contained GST, line-based, or as computed by an accountant rule) | 3 |
| DEC-FIN-5 | Item-level refund linkage (lines and quantities) versus amount-only refunds | **APPROVED — TIER 2** (2026-10-05; mechanism only, see 00.10.4; was: 2) |
| DEC-FIN-6 | Tips and gratuities: supported or not; | 3 |
| DEC-FIN-7 | Service charges: supported or not; | 3 |
| DEC-FIN-8 | Cash variance tolerance, reason requirement and manager acknowledgement | 3 |
| DEC-FIN-9 | Cash-management scope: paid-in and paid-out, drops, change on over-tender, denominations, blind and witnessed counts, drawer versus staff accountability | 3 |
| DEC-FIN-10 | Day close: who closes; | 3 — open under O-6 (pilot gate); business-date part resolved by P3 |
| DEC-FIN-11 | Manual resolution of uncertain outcomes when the provider cannot answer: evidence required, roles, separation of duties | **APPROVED — TIER 2** (2026-10-05; mechanism only, see 00.10.4; was: 2) |
| DEC-FIN-12 | Reconciliation parameters: provider record source and format (with O-3), matching keys, age thresholds for stuck items, alert thresholds, acceptance authority | 3 |
| DEC-FIN-13 | Comps, complimentary and zero-total checks, check-time manual discounts, and their authority | 3 |
| DEC-FIN-14 | Financial record retention period (with DEC-X-5 statutory obligations) | 3 |
| DEC-FIN-15 | Split checks and line transfer between checks (and, with FIN-51, check merge): which modes are offered and with which authority. | 3 — inclusion resolved; policy open (P12) |
| DEC-FIN-16 | Chargebacks and disputes: modelling, evidence, authority | 3 |
| DEC-FIN-17 | Group-level finance across several venues or legal entities (consolidation, inter-venue cash). | 3 — inclusion resolved; structure open |
| DEC-FIN-18 | Cross-tender refunds (for example cash refund of a card payment) | 3 |
| DEC-FIN-19 | Core mechanism for check split, line move and merge: how the operations are represented (for example void-and-rebill of unpaid checks, explicit line-transfer and merge transitions with history), which check and payment… | **APPROVED — TIER 2** (orchestrator ratification 2026-10-05; mechanism only, 00.10.4) |

### Servvia PRD — Volume 08: Reports and BI

Source: [`08-reports-and-bi.md`](08-reports-and-bi.md).

**Requirements (39)** — ID | requirement (first sentence) | priority | state

| ID | Requirement | Priority | State |
|---|---|---|---|
| BI-1 | Every reported figure references a catalogued metric definition (08.12) with name, plain-language definition, formula over Core records, basis, time basis, inclusions and exclusions, and version. | MUST | TARGET |
| BI-2 | A metric definition change creates a new effective-dated version; | MUST | TARGET |
| BI-3 | Revenue is never shown unqualified: every revenue or sales figure states its basis (ordered, billed, settled or collected), whether it is GST-inclusive or GST-exclusive, and whether discounts and refunds are deducted, u… | MUST | TARGET (headline decided by owner, P11, 2026-10-05) |
| BI-4 | Figures are computed from canonical records only, never from client-reported totals. | MUST | TARGET |
| BI-5 | During the transition, every report states its source system (Nest legacy path or Core). | MUST | TRANSITIONAL; |
| BI-6 | Every financial aggregate is drillable to the contributing records (orders, round lines, checks, payments, adjustments, shifts), filtered to the viewer's scope; | MUST (financial); SHOULD (operational) | TARGET |
| BI-7 | Reports support two views of the past: **as reported** (records committed up to a stated watermark) and **as corrected** (including later compensating records). | MUST | TARGET (refunds and returns are attributed to their own business date, P11; |
| BI-8 | Periods are venue business dates under the owner P3 rule (00.10.5; | MUST | TARGET (boundary rule decided by owner, P3, 2026-10-05) |
| BI-9 | Every report shows its data freshness (as-of instant). | MUST (display) | TARGET; |
| BI-10 | Report access is deny-by-default and combines role permission with venue grants from the verified credential (INV-2, INV-4). | MUST | TARGET (Nest venue guard CURRENT, TRANSITIONAL) |
| BI-11 | Tenant and venue isolation applies to report queries, drill-downs, exports, scheduled runs and emails; | MUST | TARGET |
| BI-12 | Exports (CSV for RPT-1; | MUST | TARGET |
| BI-13 | Exports and emails contain the minimum data needed: no card data, secrets or provider references; | MUST | TARGET; |
| BI-14 | Report queries never breach the transactional targets of SPRD §19 (order submission P95 under 500 ms, API read P95 under 200 ms). | MUST | TARGET (mechanism approved 2026-10-05: DEC-X-16; |
| BI-15 | Report and export endpoints paginate; | MUST | TARGET; |
| BI-16 | Daily email (ADM-3): configurable recipients, schedule and manual send; | MUST | TRANSITIONAL settings in Nest; |
| BI-17 | Daily reservation summary email at a configured time (RES-5), under BI-16 delivery rules and BI-13 minimisation. | SHOULD | TARGET |
| BI-18 | Daily sales report (RPT-1): Net Sales (incl. | SHOULD (venue scope MUST) | TARGET |
| BI-19 | Reservation report (RPT-1): covers, no-show rate and lead time per venue and date, with the definitions of 08.12. | SHOULD (venue scope MUST) | TARGET; |
| BI-20 | Weekly and monthly summaries (RPT-1) aggregate business dates; | SHOULD | TARGET |
| BI-21 | Service-day report for day close (RPT-2): the minimum content is decided in O-6. | MUST (pilot) | TARGET (mechanism); |
| BI-22 | Operational metrics are available to authorised staff and operators: KDS acknowledgement and preparation times, ticket propagation latency, "86" propagation per channel, pending and uncertain payment age, reconciliation… | MUST (signals named in SPRD §18.11, §20); SHOULD (others) | TARGET |
| BI-23 | Reporting and analytics are read-only: no report, export, schedule or `data/` workload writes canonical state; | MUST | TARGET |
| BI-24 | Money in reports uses the venue currency with ISO 4217 code; | MUST | TARGET |
| BI-25 | No production report contains mock, sample or hard-coded data; | MUST | TARGET (mock rows TRANSITIONAL) |
| BI-26 | Email subject and header values are validated (no control characters or header injection) before send; | MUST | TARGET |
| BI-27 | Generalised scheduled reports (any report, cadence, recipients, format) with the BI-16 delivery mechanism. | MAY | TARGET CAPABILITY — FUTURE DELIVERY |
| BI-28 | Custom reports, saved views and sharing: a share widens audience, never access (each viewer sees their own scope); | MAY | TARGET CAPABILITY — FUTURE DELIVERY |
| BI-29 | Multi-venue executive dashboard and venue comparison over catalogued metrics. | MAY | TARGET CAPABILITY — FUTURE DELIVERY; |
| BI-30 | Cross-domain composites (food cost %, labour %, prime cost, waste value, sales per labour hour) once their source domains exist. | MAY | TARGET CAPABILITY — FUTURE DELIVERY (depends on volumes 03, 04, 06) |
| BI-31 | Budgets and budget-versus-actual. | MAY | FUTURE |
| BI-32 | Demand forecasting. | MAY | TARGET CAPABILITY — FUTURE DELIVERY; |
| BI-33 | Anomaly detection and AI narratives: every claim cites the records it rests on and unexplained residue is stated; | MAY | TARGET CAPABILITY — FUTURE DELIVERY |
| BI-34 | Report views that show financial data, every export and every schedule change are audited (INV-15). | MUST (exports, schedules); viewing per DEC-BI-10 | TARGET |
| BI-35 | AI insights: anomaly and performance insights (predictions) and improvement suggestions (recommendations), classified per INV-21, are shown to permitted roles within their venue scope (BI-10). | MAY | TARGET CAPABILITY — FUTURE DELIVERY; |
| BI-36 | Pricing recommendations: Servvia may recommend menu price changes (recommendation per INV-21) showing the item and venue, the proposed change, the expected effect with its evidence and time basis, and confidence or limi… | MAY | TARGET CAPABILITY — FUTURE DELIVERY; |
| BI-37 | Inventory and workforce analytics: inventory turnover, waste value, labour cost percentage and sales per labour hour per venue and period, computed from the canonical records of volumes 03, 04 and 06 and the P11 sales m… | MAY | TARGET CAPABILITY — FUTURE DELIVERY (depends on volumes 03, 04, 06) |
| BI-38 | Operational P&L view (with FIN-53): per venue and business date, and for granted venue groups, the P11 sales measure less recipe cost of items sold (volume 03) and labour cost (volume 06), with each component's definiti… | MAY | TARGET CAPABILITY — FUTURE DELIVERY (depends on volumes 03, 06) |
| BI-39 | Customer behaviour analytics (with volume 05): visit frequency, spend and preference patterns and segmentation are computed only from customers linked to Core orders by an explicit identity link, and any analysis that p… | MAY | TARGET CAPABILITY — FUTURE DELIVERY; |

**Open decisions (13)** — ID | decision | tier

| ID | Decision | Tier |
|---|---|---|
| DEC-BI-1 | Which variant RPT-1 "revenue" and AOV use: basis (ordered, billed, settled, collected), GST-inclusive or exclusive, before or after refunds | **RESOLVED — owner decision P11, 2026-10-05** (00.10.5; was: 3) |
| DEC-BI-2 | Metric catalogue sign-off, including denominators (no-show, AOV), top-items N and tie-break, week start day, and who approves metric changes | 3 — open under the pilot-reporting gate (headline decided by P11) |
| DEC-BI-3 | Correction attribution: refunds, reversals and voids dated by when they happen or attributed back to the original sale date; | Resolved for refunds and returns by P11 (own business date; original sale not rewritten). Other corrections fall under DEC-BI-2 |
| DEC-BI-4 | Covers for dine-in: capture a guest count on the visit (schema change) or report reservation covers only | 3 (schema Tier 2) — open under the pilot-reporting gate |
| DEC-BI-5 | Freshness classes and targets; | 3 |
| DEC-BI-6 | Export formats beyond CSV, synchronous row limit, maximum range, file expiry, retention of email snapshots and report runs | 3 |
| DEC-BI-7 | Personal data in reports and exports; | 3 |
| DEC-BI-8 | Pilot reporting during the transition: whether Nest-path orders and payments are included, and how labelled | **APPROVED — TIER 2** (2026-10-05; mechanism only, see 00.10.4; was: 2) |
| DEC-BI-9 | Reporting read model: direct queries on Core tables versus projections built from D13 events (within DEC-X-16 and DEC-X-13) | 2 |
| DEC-BI-10 | Report access by role (cashier, viewer, kitchen) and whether plain viewing of financial reports is audited | 3 |
| DEC-BI-11 | Daily email content and trigger (fixed time versus after day close) | 3 — trigger timing open under the pilot-reporting gate; an unclosed business day is always labelled provisional (INV-14, P3) |
| DEC-BI-12 | KDS timing targets and which KDS metrics are reported | 3 |
| DEC-BI-13 | Multi-venue and group reporting scope, consolidation and currency. | 3 — inclusion resolved; consolidation and currency open |

### Servvia PRD — Volume 09: Administration

Source: [`09-administration.md`](09-administration.md).

**Requirements (71)** — ID | requirement (first sentence) | priority | state

| ID | Requirement | Priority | State |
|---|---|---|---|
| ADMIN-1 | The committed hierarchy is organization → venue. | MUST | TARGET (levels: OWNER DECISION REQUIRED) |
| ADMIN-2 | An authorized administrator can create and onboard an additional venue entirely through administration and configuration, with no code change or deployment (SPRD §1). | MUST | TARGET |
| ADMIN-3 | VEN-1 settings are validated server-side before saving (for example a valid IANA time zone, non-overlapping operating hours, non-negative capacity); | MUST | TRANSITIONAL (Nest) → TARGET |
| ADMIN-4 | Venues have an explicit status lifecycle (09.4.1). | SHOULD | OWNER DECISION REQUIRED (DEC-ADMIN-11) |
| ADMIN-5 | Configuration follows INV-17: every setting has a registry definition (level, type, validation, default); | MUST | TARGET |
| ADMIN-6 | Every configuration change creates an immutable version with actor, time, before and after, and reason where the setting requires one; | MUST | TARGET |
| ADMIN-7 | Settings designated effective-dated (DEC-ADMIN-9) accept a future `effectiveFrom`; | MUST | TARGET (mechanism approved 2026-10-05: DEC-ADMIN-9; |
| ADMIN-8 | Concurrent edits to the same setting or object use version compare-and-set; | MUST | TARGET |
| ADMIN-9 | Changes that affect live service (tax configuration, station routing, printer roles, operating hours during an open business day, capability settings) show the affected venues and objects before confirmation, and are pr… | MUST | TARGET |
| ADMIN-10 | Per-venue capability enablement (for example Guest Mode, kitchen printing, online ordering under O-18) is audited configuration evaluated server-side; | SHOULD | TARGET (mechanism approved 2026-10-05: DEC-ADMIN-10) |
| ADMIN-11 | Every human uses a named staff account; | MUST | TRANSITIONAL (Nest) → TARGET |
| ADMIN-12 | The first owner of an organization is created only through a governed bootstrap procedure (operator-run, audited, not reachable from any public or unauthenticated endpoint); | MUST | TRANSITIONAL (Nest governed bootstrap) → TARGET |
| ADMIN-13 | Credential reset (STF-1) never reveals the existing credential, requires the holder to set a new one, and revokes the account's existing sessions and derived elevations. | MUST | TRANSITIONAL (Nest) → TARGET |
| ADMIN-14 | A staff PIN for tablet elevation is set only by an authorized administrator, is distinct from and not derived from the login password, is stored only as a slow hash, is never displayed after entry, and its verification… | MUST | TRANSITIONAL (Nest, DL-081); |
| ADMIN-15 | Deactivating an account, removing a venue grant or changing a role takes effect on the account's next request and on its live realtime connections (§16.5, §16.12), including tablet elevations derived from the account. | MUST | TARGET |
| ADMIN-16 | An administrator can list a staff account's active sessions (start, last activity, client type) and revoke one or all; | MUST | TARGET |
| ADMIN-17 | Password hashing, TLS and login rate limiting follow NFR-SEC-2 and §16.4. | MUST | TARGET (values: OWNER DECISION REQUIRED) |
| ADMIN-18 | Credential issuance follows O-2: Nest may issue staff and device credentials during the transition; | MUST | TRANSITIONAL (decided, O-2) |
| ADMIN-19 | Go Core enforces staff venue scope from the verified credential on every staff route and realtime subscription before production (the gap named in O-2). | MUST | TARGET |
| ADMIN-20 | Multi-factor authentication for owner, admin or other roles, and its methods, is decided by DEC-ADMIN-3; | SHOULD | TARGET CAPABILITY — FUTURE DELIVERY; |
| ADMIN-21 | Offboarding is deactivation of the staff account (ADMIN-15). | MUST | TARGET (link TARGET CAPABILITY — FUTURE DELIVERY; |
| ADMIN-22 | Authorization is composed of the account's role permissions and venue grants and enforced server-side per request and per realtime subscription (INV-4). | MUST | CURRENT (Nest) / TARGET (Core) |
| ADMIN-23 | No self-escalation: an administrator cannot grant a role, permission or venue grant they do not themselves hold, and cannot change their own role or grants. | MUST | TARGET |
| ADMIN-24 | An organization always has at least one active owner: demoting, deactivating or removing the last active owner is refused with a stable error. | MUST | TARGET |
| ADMIN-25 | Every grant, role change and venue-grant change is audited with before and after (§16.13). | MUST | CURRENT (Nest audit) / TARGET |
| ADMIN-26 | An effective-access view shows, for a staff account, its role, venue grants, effective permissions, active sessions and staff PIN status (set or not set, never the value). | SHOULD | TARGET |
| ADMIN-27 | Privileged administrative actions (catalogue DEC-ADMIN-4; | MUST | TARGET (catalogue: OWNER DECISION REQUIRED) |
| ADMIN-28 | Separation of duties is a configurable mechanism: an SoD rule names the initiating and approving actions and a condition; | MUST (mechanism) | TARGET |
| ADMIN-29 | Destructive administrative actions require explicit confirmation naming the object and consequence, capture a reason, and state when they are irreversible (device revocation and terminal disable are final per D8). | MUST | TARGET |
| ADMIN-30 | Administrative create and enrol commands carry an idempotency key; | MUST | TARGET (implemented in Core for D8) |
| ADMIN-31 | The tablet manager step-up (DL-081) records both the acting staff identity and the approving manager identity on every action it authorizes. | MUST | TRANSITIONAL (Nest) |
| ADMIN-32 | Devices are enrolled, listed, rotated and revoked through the Core device registry (D8; | MUST | TARGET (implemented in Core, not in production) |
| ADMIN-33 | Revoking or rotating a device credential takes effect on the device's next request and closes its live realtime connections (§16.5). | MUST | TARGET |
| ADMIN-34 | New device kinds (Waiter Tablet distinct from `order_tablet`, kiosk, window display, Venue Edge) are added additively when their applications need an identity; | MUST | TARGET |
| ADMIN-35 | Terminals are created, disabled (final), and bound to or unbound from a `pos_terminal` device of the same venue (D8); | MUST | TARGET (implemented in Core, not in production) |
| ADMIN-36 | The device registry shows, per device, kind, venue, status, created and revoked by, last credential rotation, and, where the application reports them, last seen time and application version. | SHOULD | TARGET |
| ADMIN-37 | Payment adapter devices are administered as D8 `payment_adapter` devices, one per venue. | MUST | TARGET |
| ADMIN-38 | The web tablet enrollment (`TabletEnrollment`, `TabletDevice`) and the KDS venue PIN remain TRANSITIONAL; | MUST | TRANSITIONAL |
| ADMIN-39 | No administrative setting can grant Guest Mode staff authority or let a guest enter Staff Mode (WT-4, WT-5). | MUST | TARGET |
| ADMIN-40 | A Venue Edge installation is paired using a single-use, expiring pairing secret issued by an authorized administrator, receives a revocable venue-bound identity (EDGE-2), and can be revoked; | MUST | TARGET (mechanism approved 2026-10-05: DEC-ADMIN-12) |
| ADMIN-41 | The Venue Edge administration view shows heartbeat, versions, queue depth and oldest queued age (EDGE-3), last successful hardware operation per device class, and version-compatibility state. | MUST | TARGET |
| ADMIN-42 | Remote administration of Venue Edge is limited to declared configuration and declared diagnostic commands, each authorized and audited; | MUST | TARGET |
| ADMIN-43 | Printer administration satisfies ADM-2 and PRT-1 to PRT-3: printer role, connection and paper width are validated; | MUST | TRANSITIONAL (Nest configuration) → TARGET (Venue Edge; |
| ADMIN-44 | Menu administration (MENU-1 to MENU-6, AVL-1) is performed only in the Admin Console under server-side permissions; | MUST | TRANSITIONAL (Nest) → TARGET |
| ADMIN-45 | Media administration follows MENU-3 (content-type validation, size limit default 10 MB, conversion SHOULD); | MUST | CURRENT (Nest `MediaAsset`) |
| ADMIN-46 | An integration registry lists each configured adapter connection (for example payment adapter, email provider) with scope, status, last success, last failure and credential age. | SHOULD | TARGET (payment adapter); |
| ADMIN-47 | Rotating an integration credential issues a new credential and invalidates the old one per D8 semantics; | MUST | TARGET |
| ADMIN-48 | Legacy external-POS connector administration in Nest and the Admin Console receives no new capability, is restricted to owner and admin, stays audited, and retires per SPRD §34.2 (sequence DEC-ADMIN-18). | MUST | TRANSITIONAL |
| ADMIN-49 | Third-party API keys and outbound webhooks (inclusion resolved, DEC-ADMIN-14; | MAY | TARGET CAPABILITY — FUTURE DELIVERY (inclusion resolved by DEC-X-1; |
| ADMIN-50 | Audit search filters by actor, entity, action, date range (NFR-AUD), venue and correlation id, and shows before and after values; | MUST | TARGET |
| ADMIN-51 | No administrative function modifies or deletes an audit record. | MUST | CURRENT (Nest append-only) / TARGET |
| ADMIN-52 | Audit export produces a filtered extract; | SHOULD | TARGET |
| ADMIN-53 | Support access by a Servvia platform operator to a customer organization is explicitly authorized, scoped, time-bounded, performed under the operator's own identity (never by using customer staff credentials), audited p… | MUST | TARGET (enablement model: DEC-ADMIN-7) |
| ADMIN-54 | A monitoring view shows liveness and readiness, worker backlog (depth, oldest pending age), dead letters, realtime subscriber and slow-consumer counts, Venue Edge heartbeat, notification delivery failures and API error… | MUST | TARGET |
| ADMIN-55 | Dead-lettered work can be retried or discarded by an authorized operator (§18.5); | MUST | TARGET |
| ADMIN-56 | A read-only recovery-posture view shows the last successful backup time, backup retention (30 days, row P), the last restore rehearsal date and result, and the declared RPO and RTO once set (DEC-X-9). | SHOULD | TARGET |
| ADMIN-57 | Restore is an operational procedure run under a runbook (row AF), not a self-service function. | MUST | TARGET |
| ADMIN-58 | Daily-email settings (ADM-3) are administered in the Admin Console only (WEB-3): recipient addresses validated, schedule expressed in the venue time zone, manual send attributed; | MUST | TARGET |
| ADMIN-59 | Personal-data export and erasure requests are recorded, identity-verified, authorized, executed and audited through the DataRequest lifecycle (09.4.9); | SHOULD | TARGET CAPABILITY — FUTURE DELIVERY; |
| ADMIN-60 | Enterprise SSO and SCIM provisioning are deferred (SPRD §13, DEC-X-12). | MUST | DEFERRED |
| ADMIN-61 | Periodic access reviews, expiring object-level permission overrides and venue cloning from a template are not committed. | MAY | FUTURE |
| ADMIN-62 | **Venue operating profiles.** An authorized administrator assigns each venue an operating profile (dine-in, QSR/takeaway or hybrid). | SHOULD | TARGET CAPABILITY — FUTURE DELIVERY (mechanism DEC-ADMIN-10 approved) |
| ADMIN-63 | **Franchise and group operation.** Group administrators can define configuration once at the organization level (or at an intermediate level once DEC-ADMIN-1 decides one) and roll it out to selected venues (Configuratio… | SHOULD | TARGET CAPABILITY — FUTURE DELIVERY; |
| ADMIN-64 | **Integration framework administration.** Owners and admins (DEC-ADMIN-2) connect, scope (organization or venue), test, pause and disconnect adapter connections for delivery marketplaces, accounting systems, payment pro… | SHOULD | TARGET (payment adapter, CARD3); |
| ADMIN-65 | **External API sandbox and developer documentation.** When the external API platform (ADMIN-49, 00.7) is delivered, it provides a sandbox environment isolated from production: sandbox credentials never authorize product… | MAY | TARGET CAPABILITY — FUTURE DELIVERY; |
| ADMIN-66 | **IP allowlisting.** An organization owner may enable an optional network restriction that limits Admin Console and administrative API access to configured address ranges. | MAY | TARGET CAPABILITY — FUTURE DELIVERY |
| ADMIN-67 | **Encryption at rest.** Canonical data stores, backups and administrative and reporting exports are encrypted at rest, with keys held in externally managed key storage (row R), never in source control, configuration fil… | SHOULD | TARGET CAPABILITY — FUTURE DELIVERY |
| ADMIN-68 | **Point-in-time recovery.** The canonical PostgreSQL database supports recovery to a chosen point in time within the declared recovery window, in addition to daily backups retained 30 days (row P). | SHOULD | TARGET CAPABILITY — FUTURE DELIVERY; |
| ADMIN-69 | **Guided onboarding.** Authorized administrators set up an organization and its venues through a guided sequence (organization settings, venues and VEN-1 settings, operating profile, tables, menu, tax and jurisdiction p… | SHOULD | TARGET CAPABILITY — FUTURE DELIVERY; |
| ADMIN-70 | **Contextual help and role-specific guidance.** The Admin Console and device applications provide help in context of the current screen and role (for example what a setting does, its effective origin and its consequence… | MAY | TARGET CAPABILITY — FUTURE DELIVERY |
| ADMIN-71 | **Jurisdiction-pack administration.** Authorized administrators view available jurisdiction packs (tax, payroll, compliance record formats, receipt and invoice content, locale) and activate a pack version for an organiz… | SHOULD | TARGET CAPABILITY — FUTURE DELIVERY; |

**Open decisions (24)** — ID | decision | tier

| ID | Decision | Tier |
|---|---|---|
| DEC-ADMIN-1 | Whether hierarchy levels between organization and venue (brand, region) and legal-entity attachment are needed | 3 — **franchise and group operation inclusion RESOLVED by DEC-X-1 (owner 2026-10-05)**; levels, legal-entity attachment and franchise structure (one organization versus related organizations) remain open; phasing DEC-X-17 |
| DEC-ADMIN-2 | Default permissions per current role, permitted manager administration, and whether custom roles exist (refines DEC-X-2) | 3 |
| DEC-ADMIN-3 | Whether MFA is required, for which roles, and methods | 3 — **MFA capability inclusion RESOLVED by DEC-X-1 (owner 2026-10-05, K(L550))**; required roles and methods remain open (P2); phasing DEC-X-17 |
| DEC-ADMIN-4 | Catalogue of privileged administrative actions requiring step-up, and administrative SoD rules (dual control) | 3 |
| DEC-ADMIN-5 | Step-up mechanism for Admin Console sessions (password re-entry, staff PIN, second factor) and its validity window | **APPROVED — TIER 2** (2026-10-05; mechanism only, see 00.10.4; was: 2) |
| DEC-ADMIN-6 | Session and credential policy values: idle and absolute session lifetimes, concurrent sessions, password composition, PIN length and lockout, invitation versus administrator-set initial credentials | 3 |
| DEC-ADMIN-7 | Support-access model: who may authorize, default off or on, maximum window, read-only versus read-write, emergency access | 3 |
| DEC-ADMIN-8 | Owner recovery and break-glass accounts | 3 |
| DEC-ADMIN-9 | Which settings are effective-dated, and whether future-dated scheduling is available for them | **APPROVED — TIER 2** (2026-10-05; mechanism only, see 00.10.4; was: 2) |
| DEC-ADMIN-10 | Per-venue capability enablement model (which capabilities, server enforcement point) replacing Verdura module gates | **APPROVED — TIER 2** (2026-10-05; mechanism only, see 00.10.4; was: 2) |
| DEC-ADMIN-11 | Venue lifecycle states and the handling of closed-venue data | 3 |
| DEC-ADMIN-12 | Venue Edge pairing and identity: D8 device kind versus separate installation registry; | **APPROVED — TIER 2** (2026-10-05; mechanism only, see 00.10.4; was: 2) |
| DEC-ADMIN-13 | Credential rotation cadence and overlap windows for devices and integrations | 3 |
| DEC-ADMIN-14 | Whether third-party API keys and outbound webhooks are committed scope | 3 — **inclusion RESOLVED by DEC-X-1 (owner 2026-10-05, K(L8, L360–369))**: external API keys, webhooks and a developer sandbox are TARGET CAPABILITY — FUTURE DELIVERY; phasing DEC-X-17; a public marketplace or partner programme is split to DEC-ADMIN-24 |
| DEC-ADMIN-15 | Audit export format and integrity signing, who may export, retention beyond 90 days, audit search latency target | 3 |
| DEC-ADMIN-16 | Who executes personal-data requests, with what verification and deadlines (under DEC-X-4, DEC-X-5) | 3 |
| DEC-ADMIN-17 | Whether periodic access reviews are committed, cadence and reviewers | 3 |
| DEC-ADMIN-18 | Retirement sequence of legacy external-POS administration (Nest and Admin Console) | 2 |
| DEC-ADMIN-19 | Platform operator identity and role: how Servvia staff are represented (separate operator realm versus organization accounts) | **APPROVED — TIER 2** (2026-10-05; mechanism only, see 00.10.4; was: 2) |
| DEC-ADMIN-20 | Printer configuration ownership during the move from Nest `Printer` to Venue Edge (with O-4) | 2 |
| DEC-ADMIN-21 | Service and integration identity model (INV-3 service class): representation, scopes, rotation | **APPROVED — TIER 2** (2026-10-05; mechanism only, see 00.10.4; was: 2) |
| DEC-ADMIN-22 | **APPROVED 2026-10-05 at architecture level (Tier 2).** Mechanism that closes live realtime connections when a credential or grant is revoked (target: push-close triggered by the revocation event, with periodic revalida… | 2 (approved; implementation incomplete — DECISION RESOLVED, IMPLEMENTATION BLOCKER) |
| DEC-ADMIN-23 | Feasibility and procedure of tenant-scoped restore in a shared database | **APPROVED — TIER 2** (2026-10-05; mechanism only, see 00.10.4; was: 2) |
| DEC-ADMIN-24 | Whether Servvia operates a public integration marketplace or partner programme (listing, partner certification, revenue terms, developer community), and on what terms | 3 |

## 4. Cross-cutting decisions (from volume 00)

| ID | Decision | Tier |
|---|---|---|
| DEC-X-1 | **Inclusion RESOLVED — owner decision 2026-10-05:** every genuine product capability of the KitchenOS capability set (ordering and service, kitchen and production, inventory and procurement, workforce, finance, CRM and… | **RESOLVED (inclusion), owner 2026-10-05** |
| DEC-X-2 | Role model: extend Servvia roles (owner, admin, manager, cashier, kitchen, viewer) with domain roles (for example chef, purchaser, storekeeper, finance, marketer, HR) or keep roles coarse with permissions | 3 |
| DEC-X-3 | Business-date (trading-day) boundary and its configuration per venue | **RESOLVED — owner decision P3, 2026-10-05** (rule in 00.10.5; was: 3) |
| DEC-X-4 | Personal-data retention, deletion and anonymisation policy (customer and employee) | 3 |
| DEC-X-5 | Which formal compliance regimes apply (privacy legislation, payment-card standards for the trusted-adapter scope, employment, tax and accounting rules) | 3 |
| DEC-X-6 | Audit tamper evidence beyond append-only storage (for example hash chaining with periodic verification) | **APPROVED — TIER 2** (2026-10-05; mechanism only, see 00.10.4; was: 2) |
| DEC-X-7 | Approval and separation-of-duties thresholds (refunds, voids, discounts, write-offs, purchase approvals, manual journal posting) | 3 |
| DEC-X-8 | Capacity targets: venues, devices, concurrent users, throughput, history volume (SPRD §19 OWNER TARGET REQUIRED) | 3 |
| DEC-X-9 | RPO and RTO; | 3 |
| DEC-X-10 | WITHDRAWN — identifier reserved during drafting and never assigned to a decision; | — |
| DEC-X-11 | Currencies and locales: single currency per organization or multi-currency; | 3 |
| DEC-X-12 | Enterprise identity federation (SSO, SCIM) timing (SPRD §13 deferred) | 3 |
| DEC-X-13 | Core ownership of newly committed domains (inventory/materials, recipes, procurement, CRM, workforce, finance ledger, approvals, notifications, reporting, reservations O-7, media O-8). | Decided (residual Tier 1) |
| DEC-X-14 | Corpus versioning: the owner-named label "v5.1" for this Servvia corpus versus the Verdura v5.2 source it was mined from | 2 |
| DEC-X-15 | Notification channels and providers (in-app, email, push, SMS) | **APPROVED — TIER 2** (2026-10-05; mechanism only, see 00.10.4; was: 2) |
| DEC-X-16 | Analytical data separation (reporting replica, warehouse or in-database reporting) | **APPROVED — TIER 2** (2026-10-05; mechanism only, see 00.10.4; was: 2) |
| DEC-X-17 | Delivery phasing and order of the owner-approved target capabilities (split from DEC-X-1): which capabilities enter committed current delivery scope, in what order, gated on what readiness evidence. | 3 |
| DEC-X-18 | Commercial platform capabilities: self-service tenant sign-up, Servvia subscription billing of customers, white-label offering, embedded financial services, referral programme, partner or developer marketplace | 3 |
| DEC-X-19 | Whether any autonomous AI action is ever permitted, for which action classes, with which control model (limits, approval, rollback, audit) | 3 |
| DEC-X-6 | Audit history is append-only from application behaviour, transactionally coupled to material changes where required, and not updatable or deletable by ordinary actors. | Database privileges with no UPDATE/DELETE for the application role; recommended (not required) controls: daily per-organization digest and checksummed exports |
| DEC-X-15 | An authoritative notification record exists per notification. | — |
| DEC-X-16 | Reporting and analytical load never compromise transactional correctness or service-day targets. | Bounded read-only queries plus event-built projections; reporting replica, then analytical store, only as measured scale requires |

