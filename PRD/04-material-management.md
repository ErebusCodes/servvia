# Servvia PRD — Volume 04: Material Management

> **Status:** Normative Servvia domain volume, version label **v5.1 (Servvia)**, last updated 2026-10-05.
> **Authority:** subordinate to [`product-requirements.md`](product-requirements.md) ("SPRD"), which wins on any conflict, and to [`00-overview-and-conventions.md`](00-overview-and-conventions.md), whose invariants (INV-n), labels and decision register apply here without restatement.
> **Committed scope:** none in current delivery. SPRD §13 defers material management and procurement beyond the first pilot. **Inclusion is resolved:** the owner decided on 2026-10-05 that inventory, procurement, receiving, reordering, transfers, counts, adjustments, waste, costing, traceability and food-safety records belong to Servvia's long-term target product (DEC-X-1; SPRD O-9 inclusion resolved). Requirements here are therefore `TARGET CAPABILITY — FUTURE DELIVERY` unless stated otherwise: owner-approved destination, not a release commitment. Their delivery phase and order are DEC-X-17; the Core package boundary is the residual DEC-X-13 decision; none may be planned before DEC-X-17 places it.
> **Provenance:** Servvia baseline (SPRD PR-1, PR-3, PR-9, AVL-1, MENU-6, NFR-OFF, EDGE-1; Part B; Part C) plus enterprise hardening. Domain mechanisms were adapted from the Verdura v5.2 PRD volume 04 and consolidated §6.2.2–6.2.3 as **non-authoritative source material**; Verdura's numeric movement codes are replaced by named movement types. The classification matrix is held outside the repository as handoff evidence (2026-10-05). Owner-approved KitchenOS capabilities (basis `K(Lnnn)`, volume 00 §00.3) are translated into Servvia-native requirements; KitchenOS architecture, vendors, numbers and compliance assertions are not adopted.
> **No regulatory claims.** Quality, temperature and recall records are operational evidence. Servvia does not claim conformance with any food-safety or accounting regime (DEC-X-5, DEC-MAT-13).
> **Acceptance:** **NORMATIVE BASELINE ACCEPTED 2026-10-05** (SERVVIA PRD NORMATIVE BASELINE ACCEPTED; record in volume 00 §00.1.3). This volume is a normative refinement of [`product-requirements.md`](product-requirements.md), which wins on any conflict. Acceptance does not commit future-delivery capabilities to a release, select open policy values, approve production or release, or certify compliance.

## 04.1 Purpose, scope and state

**Purpose.** Material management gives a venue controlled truth about what it holds, where, in what condition, at what value, and where it went. Every physical change is a typed, immutable stock movement; on-hand is the sum of movements; corrections are linked reversals. Combined with recipe explosion (volume 03), it yields theoretical consumption and the variance against counts.

**Labelling rule.** Capabilities SPRD §13 deferred and the owner approved on 2026-10-05 (KitchenOS L201–L207, L246, L302–L304, L316–L318, L471–L472, L595) are `TARGET CAPABILITY — FUTURE DELIVERY` at capability and requirement level. Verdura-mined capabilities that KitchenOS does not describe stay `FUTURE` (04.14).

| Capability | State | Basis |
|---|---|---|
| Inventory domain in the approved structure | Inclusion resolved (SPRD O-9, DEC-X-1, owner 2026-10-05): `TARGET CAPABILITY — FUTURE DELIVERY`; Go Core on PostgreSQL decided; residual package name and boundary `ARCHITECTURE DECISION REQUIRED` (DEC-X-13) | S (SPRD §13, O-9, §30.3)+K(L201–L207) |
| Item master (materials), units and conversions | `TARGET CAPABILITY — FUTURE DELIVERY` | V(04 §3.1) + INV-7+K(L302) |
| Suppliers, supplier items, price lists | `TARGET CAPABILITY — FUTURE DELIVERY` (procurement); contracts `FUTURE` (04.14) | V(04 §3.2)+K(L204, L317) |
| Stock sites, storage locations, bins | `TARGET CAPABILITY — FUTURE DELIVERY`; depth DEC-MAT-20 | V(04 §3.3)+K(L203) |
| Stock quantities, statuses, movements, reversals, automatic sales deduction | `TARGET CAPABILITY — FUTURE DELIVERY` | V(04 §2, §3.7)+K(L203, L303) |
| Purchasing: requisition → purchase order → receipt → invoice match | `TARGET CAPABILITY — FUTURE DELIVERY` (procurement); invoice-to-payables hand-off depends on volume 07 (finance sub-ledger stays DEFERRED) | V(04 §3.5–3.8, §3.13)+K(L204, L317) |
| Receiving, transfers, adjustments | `TARGET CAPABILITY — FUTURE DELIVERY` | V(04 WF-M3, WF-M5)+K(L203, L204) |
| Counts (cycle, physical), waste declarations | `TARGET CAPABILITY — FUTURE DELIVERY` | V(04 §3.9–3.10)+K(L203, L205) |
| Batches, expiry, FEFO | `TARGET CAPABILITY — FUTURE DELIVERY` | V(04 §3.4, WF-M4)+K(L203, L471) |
| Quality inspection, temperature records, recall and traceability | `TARGET CAPABILITY — FUTURE DELIVERY`; regime content by jurisdiction pack (INV-22, P5); record policy DEC-MAT-13 | V(04 §3.11)+K(L471–L472) |
| Food-safety and health-and-safety checklists and records (monitoring points, corrective actions, sign-off) | `TARGET CAPABILITY — FUTURE DELIVERY`; regime content by jurisdiction pack (INV-22, P5); policy DEC-MAT-13 | K(L246, L471–L472)+E |
| Valuation and cost | `TARGET CAPABILITY — FUTURE DELIVERY`; method `OWNER DECISION REQUIRED` (DEC-MAT-3) | V(04 §3.13)+K(L205, L223) |
| Reorder (par levels, reorder points) and automated reorder proposals | `TARGET CAPABILITY — FUTURE DELIVERY`; recommendations or assisted action only; autonomous purchase commitments DEC-MAT-17 and DEC-X-19 | V(04 §3.1, WF-M2)+K(L204, L318, L595) |
| Low-stock alerts from venue-configured thresholds | `TARGET CAPABILITY — FUTURE DELIVERY` | K(L304)+E |
| Stock-driven availability ("86") linked to AVL-1 | `TARGET CAPABILITY — FUTURE DELIVERY`; policy DEC-MAT-8; AVL-1 manual availability is `TARGET` in volume 02 | S (AVL-1) + V(04 §5.5)+K(L203) |
| Storeroom device surface and its offline behaviour | `ARCHITECTURE DECISION REQUIRED` (DEC-MAT-9) | S (SPRD §4, §32) |
| Any materials behaviour on the Windows POS | `DEFERRED — PENDING USER POS ANALYSIS REPORT` | S (SPRD §12) |

**Current reality:** nothing in this domain exists in Nest, Go Core, Prisma or any client. The Nest `MenuItem.posProductCode` and `PosProductIdentity` fields are external-POS identity (`TRANSITIONAL`, retiring per SPRD §34.2) and are not a material or stock-item master.

## 04.2 Actors and surfaces

| Actor (Servvia role) | Interest | Surface |
|---|---|---|
| Owner, admin | Configuration, policies, valuation, approvals, all reports | Admin Console |
| Manager | Requisitions, purchase orders, receiving, counts, adjustments, waste approval | Admin Console; storeroom surface per DEC-MAT-9 |
| Kitchen | Receiving deliveries, waste declaration, count execution, production picks | Storeroom surface per DEC-MAT-9 |
| Viewer | Read-only stock and reports | Admin Console |
| Candidate domain roles (purchaser, storekeeper, finance) | Separation of purchasing, receiving and invoice verification | Role model DEC-X-2; not facts |
| System actor (Core worker) | Sales consumption posting, expiry status changes, reorder proposals, reconciliation checks | Core workers |
| Supplier (external) | Receives purchase orders; sends invoices | Adapter only (INV-19); no supplier portal (FUTURE) |
| Venue Edge | Barcode scanners and sensors as local hardware (SPRD §30.4) | DEC-MAT-9, DEC-MAT-22 |

The four permanent Android applications (SPRD §32) contain no storeroom function today; adding one, or a new application, is DEC-MAT-9 and needs Part C controlled change (SPRD §28). The Windows POS is not a materials surface (SPRD §12).

## 04.3 Domain model and ownership

```text
Material (1) ── (N) MaterialUnit (versioned conversion to base unit)     Material (N) ── (1) Category (tree)
Material (N) ── (N) SupplierItem (supplier code, pack, lead time)       Supplier (1) ── (N) PriceList ── (N) PriceListLine
Supplier (1) ── (N) Contract (FUTURE)
Venue (1) ── (N) StockSite ── (N) StorageLocation ── (0..N) Bin
StockQuant = Material × Batch? × StorageLocation (× Bin) × StockStatus → quantity (projection of movements)
Batch (N) ── (1) Material ; Batch ── Receipt or ProductionOutput ; Batch ── expiry
StockMovement (typed, immutable) (1) ── (N) MovementLine ; MovementLine ── reversal link
Reservation ──> source (production order, event, manual) ── (N) ReservationLine
Requisition (1) ── (N) RequisitionLine → PurchaseOrder (1) ── (N) PurchaseOrderLine (versioned)
PurchaseOrder (1) ── (N) GoodsReceipt (1) ── (N) ReceiptLine ── Batch ; ReceiptLine ── Discrepancy
SupplierInvoice (1) ── (N) InvoiceLine ── match ── PurchaseOrderLine + ReceiptLine → MatchResult or InvoiceException
Transfer (two-step) ── TransferOut movement ── IN_TRANSIT ── TransferIn movement
CountSession (cycle or physical) ── (N) CountLine → CountAdjustment movement
WasteDeclaration → Waste, Spoilage or Damage movement
Inspection ── Batch ; TemperatureRecord ── StorageLocation ; RecallCase ── (N) Batch ── trace
ReorderRule (material × stock site) ; ReorderProposal → Requisition draft
CostLayer or AverageCost (per DEC-MAT-3) ; ValuationSnapshot ; PriceObservation
```

**Design rules.**
- **On-hand is a ledger.** A StockQuant is a projection: its quantity always equals the sum of posted movement-line deltas for its coordinates. A movement is the only way to change it.
- **Master data is organization-scoped; stock is venue-scoped.** A material is defined once per organization; quants, sites, counts, receipts and reorder rules belong to one venue (INV-2).
- **Value follows the movement.** Each movement line records its value effect at posting under the valuation method in force (DEC-MAT-3); value is never recomputed in place.
- **Materials never decide prices or availability.** They inform AVL-1 (volume 02) and costing (volume 03); they never alter orders.

| Entity group | Canonical owner (target) | Current state |
|---|---|---|
| Material, MaterialUnit, Category, SupplierItem | Not yet created (O-9, DEC-X-13) | None |
| Supplier, PriceList, Contract | Not yet created (DEC-X-13); supplier contact data under volume 09 governance | None |
| StockSite, StorageLocation, Bin | Not yet created (DEC-X-13); venue from Core `internal/venues/` | None |
| StockMovement, StockQuant, Batch, Reservation | Not yet created (DEC-X-13) | None |
| Requisition, PurchaseOrder, GoodsReceipt, SupplierInvoice | Not yet created (DEC-X-13); payables hand-off to volume 07 | None |
| CountSession, WasteDeclaration, Inspection, TemperatureRecord, RecallCase | Not yet created (DEC-X-13) | None |
| Approvals, number series, notifications | Shared platform capabilities (00.7) | FUTURE / TARGET per 00.7 |

## 04.4 Business objects and lifecycles

### 04.4.1 Material

| Field | Rule |
|---|---|
| Number, name | Number from a series (INV-9); name unique per organization |
| Type | `raw`, `prepared` (output of volume 03 production), `packaging`, `consumable`, `resale` (sold as-is, typically one-to-one with a menu item); type supplies policy defaults |
| Category | Tree node; inherits count frequency and approval defaults (INV-17) |
| Base unit and alternative units | Purchase, stock and recipe units with explicit conversion factors to the base unit (INV-7) |
| Flags | Batch-managed; expiry-managed (implies batch-managed); storage class (for example ambient, chilled, frozen as configured names); allergen profile (feeds volume 03 RCP-24); nutrition data (feeds RCP-25) |
| Status | `active → blocked → active`; `active → obsolete`; never deleted while referenced (INV-11) |

**Conversion versioning.** A conversion is effective-dated data. Changing a conversion creates a new version effective from a stated instant; posted movements keep the conversion version they used. A conversion that has been used is never edited in place (INV-7, INV-11).

### 04.4.2 Supplier, supplier item and price list

- **Supplier:** identity, contacts (Personal data, INV-18), payment terms, delivery days and cut-offs, minimum order, certifications with expiry dates, status `active`, `on_hold`, `inactive`.
- **SupplierItem:** supplier code, pack definition (a unit with conversion), lead time, preferred flag.
- **PriceList:** validity window, currency (INV-6, DEC-X-11), lines with optional quantity breaks; lifecycle `draft → pending_approval (if configured) → active → expired`; activation shows the difference against the current list; overlapping active lists for the same supplier item are refused.
- **Contract (FUTURE):** fixed or capped prices for a period and venue set; a contract price takes precedence over a list price when a purchase order line is priced.

### 04.4.3 Stock topology

StockSite (for example main store, bar, cool room; names are configuration) → StorageLocation → optional Bin. Each location may declare a storage class; put-away of a material whose class differs requires a reason (audited). Depth and segregation rules are DEC-MAT-20.

### 04.4.4 Stock statuses and availability

| Status | Meaning | In available-to-promise |
|---|---|---|
| `available` | Usable stock | Yes, less active reservations |
| `quarantine` | Awaiting inspection or decision | No |
| `blocked` | Not usable (expired per rule, failed inspection, recall) | No |
| `in_transit` | Between transfer out and transfer in; belongs to no location's availability | No |

**Available-to-promise (ATP)** for a material at a stock site = `available` quantity − quantity held by active reservations. Whether reservations are modelled as a separate commitment ledger or as a status partition of quants is DEC-MAT-11; the ATP definition is fixed either way, and a reservation never exceeds `available` quantity.

### 04.4.5 Movement types

Movement types are configuration-extensible named definitions. Each definition fixes: quantity sign, source and target status, whether it creates a batch, whether a reason is mandatory, its value rule, its permission, and whether approval may be required (DEC-MAT-7). Baseline catalogue:

| Movement type | Effect | Reason | Typical source |
|---|---|---|---|
| `receipt_po` | + `available` against a purchase order line | No | Goods receipt |
| `receipt_quarantine` | + `quarantine` (inspection first) | No | Goods receipt |
| `receipt_unplanned` | + `available` without a purchase order | Yes; permission | Goods receipt |
| `quarantine_release` | `quarantine` → `available` | No | Inspection pass |
| `status_block` / `status_unblock` | `available` ↔ `blocked` | Yes | Expiry rule, inspection, recall, manual |
| `return_to_supplier` | − against a receipt | Yes | Return |
| `issue_sales_consumption` | − theoretical consumption from Core order facts | System | Volume 03 explosion or resale mapping |
| `issue_internal` | − to an internal use (for example staff meal), per configured purposes | Yes | Manual |
| `issue_to_production` | − inputs to a production order | No | Volume 03 posting |
| `production_output` | + prepared material, creates batch | No | Volume 03 posting |
| `location_move` | Location or bin change, value-neutral | No | Put-away, pick |
| `transfer_out` / `transfer_in` | Two-step move between stock sites or venues via `in_transit` | No | Transfer |
| `waste` / `spoilage` / `damage` | − with reason code, value attributed | Yes | Waste declaration |
| `count_adjustment` | ± count variance | System (count reference) | Count posting |
| `manual_adjustment` | ± permissioned correction | Yes; approval configurable | Manual |
| `reversal` | Mirror of a posted movement, linked both ways | Yes | Correction |

**Invariants:** a posted movement is immutable; it is corrected only by a `reversal` (or, for business events, by the compensating type) carrying actor and reason (PR-9, INV-11). A reversal of a reversal is refused; a second correction is a new movement. Every movement records actor class (INV-3), venue, timestamps, source document, correlation ID (INV-5), and conversion and valuation versions used.

### 04.4.6 Batch

Batch number (rule-generated or supplier reference), material, origin (receipt line or production output), received or produced date, expiry date where expiry-managed, input batches (production lineage, volume 03 RCP-36), status by quant. **Invariants:** a batch-managed material cannot move without a batch; expiry passing changes status per the expiry rule (DEC-MAT-12) and raises a task.

### 04.4.7 Requisition and purchase order

- **Requisition:** lines (material, quantity in purchase unit, required date, stock site, suggested supplier, source `manual`, `order_guide`, `reorder`, `production`, `event`, `forecast`); `draft → submitted → approved | rejected → converted → closed`.
- **Purchase order:** supplier, stock site, delivery window, terms; lines with price provenance `contract`, `price_list`, `quotation` or `manual` (a manual price is flagged); `draft → approved → sent → partially_received → received → closed`, `cancelled` before any receipt. A change after `sent` creates a new version with a recorded difference. Transmission to the supplier is an adapter command with a delivery state; "sent" means the adapter confirmed hand-off, not supplier acceptance (INV-14).

### 04.4.8 Goods receipt and discrepancy

Against a purchase order, or unplanned with permission. Lines: received quantity (with accepted, short, over), batch and expiry where flagged, optional inspection hand-off, attachments (delivery docket image; media per O-8). Discrepancies (`short`, `over`, `damaged`, `substituted`) are records with an optional supplier-claim. Posting: one transaction creating the movement(s), batches, purchase order status update and an invoice expectation. Receipt tolerances are DEC-MAT-5.

### 04.4.9 Supplier invoice and three-way match

Invoice header and lines → match against purchase order price and quantity and received quantity → `matched` (within tolerance, DEC-MAT-4) or `exception` (`price`, `quantity`, `tax`, `no_receipt`, `duplicate`). An exception is resolved by an explicit action (accept price variance, request credit, link missing receipt, reject) with actor and reason. A matched invoice is handed to payables (volume 07). Duplicate detection uses supplier, supplier invoice number and amount.

### 04.4.10 Transfer

`draft → dispatched (transfer_out posted) → received (transfer_in posted) → closed`; a receipt short of the dispatched quantity creates a transit discrepancy resolved by an explicit posting (damage in transit, miscount return). Inter-venue transfers stay within one organization (INV-2). Valuation of inter-venue transfers is DEC-MAT-18.

### 04.4.11 Count session

| Field | Rule |
|---|---|
| Kind | `cycle` (subset by category, location or value class) or `physical` (full scope) |
| Mode | Blind (system quantity hidden from counters) by default |
| Snapshot instant | System quantity per line is taken at the snapshot instant |
| Freeze mode | Movements blocked in scope, or movements allowed and the variance computed against the snapshot plus movements after it (DEC-MAT-6) |
| State | `scheduled → counting → review → approved → posted`; `cancelled` before posting |
| Recount | Required when variance exceeds the configured rule (DEC-MAT-6); recount by a different user where configured |

Variance per line = counted quantity − system quantity at the snapshot adjusted per freeze mode. Posting creates `count_adjustment` movements valued at the method in force.

### 04.4.12 Waste declaration

Material, batch where managed, quantity and unit, flow (`waste`, `spoilage`, `damage`), reason code from a per-flow catalogue (configuration), optional photo, optional reference (production order, recipe, station). Value attributed at posting. Approval above a configured threshold (DEC-MAT-7).

### 04.4.13 Quality, temperature and recall

- **Inspection:** triggered by material, supplier or receipt; attributes as configured; result `pass`, `conditional`, `fail`; `fail` moves the batch to `quarantine` or `blocked` per rule and raises a task.
- **TemperatureRecord:** manual or sensor-fed (DEC-MAT-22) reading per storage location or delivery; an out-of-range reading raises a corrective-action task. Ranges are configuration.
- **RecallCase:** `open → isolated → investigating → closed`. Opening identifies supplier batch references; trace resolves internal batches (receipts, production outputs, transfers). Isolation sets every affected quant to `blocked`, overriding other statuses, in one transaction. Forward trace lists production outputs, transfers, and the sales exposure window (items whose recipes in force used the material during the period the batch was on hand; theoretical, labelled as such). Closure requires disposal or return postings and a recorded sign-off by an authorised user (DEC-MAT-14).

### 04.4.14 Reorder rule and proposal

Per material and stock site: par level, minimum, maximum, reorder point, safety stock, lead time (values are configuration). A scheduled job computes need = target − (available + on order − reserved) and produces proposals grouped by preferred supplier. Proposals become requisition drafts; automatic purchase orders are DEC-MAT-17.

### 04.4.15 Valuation

Method per DEC-MAT-3 (for example FIFO cost layers, moving average, standard cost). Each value-bearing movement line stores unit cost and value at posting. Revaluation (standard cost change, landed-cost correction) is an explicit valuation document, never an edit. A valuation snapshot per period and stock site is immutable and is the hand-off to volume 07. Landed-cost composition is DEC-MAT-19.

## 04.5 Requirements

| ID | Requirement | Priority | State | Basis |
|---|---|---|---|---|
| MAT-1 | A material is defined once per organization with type, category, base unit, alternative units, flags and status (04.4.1); materials referenced by any record are deactivated, never deleted. | MUST | TARGET CAPABILITY — FUTURE DELIVERY | V(04 §3.1) + S (INV-11)+K(L302) |
| MAT-2 | Unit conversions are explicit, effective-dated data per material; a used conversion is never edited in place; every movement records the conversion version applied; a quantity with no conversion path to the base unit is refused. | MUST | TARGET CAPABILITY — FUTURE DELIVERY | S (INV-7) + V(04 §3.1)+K(L302) |
| MAT-3 | Expiry-managed implies batch-managed; a movement of a batch-managed material without a batch is refused. | MUST | TARGET CAPABILITY — FUTURE DELIVERY | V(04 §3.1, consolidated §6.2.2)+K(L203) |
| MAT-4 | Suppliers, supplier items and price lists follow 04.4.2; overlapping active price lists for the same supplier item are refused; activation shows the difference against the current list and is audited. | MUST | TARGET CAPABILITY — FUTURE DELIVERY | V(04 §3.2, WF-M11)+K(L204, L317) |
| MAT-5 | Stock topology is venue → stock site → storage location → optional bin; every quant has exactly one venue (INV-2). | MUST | TARGET CAPABILITY — FUTURE DELIVERY | V(04 §3.3)+K(L203) |
| MAT-6 | Every change to stock is a posted, typed, immutable movement document; no API updates a quant directly. | MUST | TARGET CAPABILITY — FUTURE DELIVERY | V(04 §3.7) + S (PR-9)+K(L203, L303) |
| MAT-7 | For every quant, quantity equals the sum of posted movement-line deltas for its coordinates; a scheduled reconciliation verifies this and raises an alert on any mismatch. | MUST | TARGET CAPABILITY — FUTURE DELIVERY | E+K(L203, L303) |
| MAT-8 | Movement types are configurable definitions fixing sign, statuses, batch creation, reason requirement, value rule, permission and approval eligibility (04.4.5); a movement that violates its type definition is refused. | MUST | TARGET CAPABILITY — FUTURE DELIVERY | V(04 §3.7, §5.10)+K(L203, L303) |
| MAT-9 | A posted movement is corrected only by a linked reversal or a compensating movement carrying actor and reason; the original and its reversal link to each other; reversing a reversal is refused. | MUST | TARGET CAPABILITY — FUTURE DELIVERY | S (PR-9, INV-11) + V(04 §3.7)+K(L203, L303) |
| MAT-10 | Posting a movement is one transaction that locks or version-checks every affected quant, evaluates the negative-stock policy against the resulting quantities, and commits the document, quant deltas, value effects, audit record and domain event together (Part B rows I and K). Locks are acquired in a deterministic order. | MUST | TARGET CAPABILITY — FUTURE DELIVERY | S (INV-10, INV-13) + E+K(L203, L303) |
| MAT-11 | Every movement command carries an idempotency key; a retry returns the original document and posts nothing new (INV-12). | MUST | TARGET CAPABILITY — FUTURE DELIVERY | S (INV-12)+K(L203, L303) |
| MAT-12 | Negative stock is governed by an explicit policy per movement type and venue (DEC-MAT-2). Where a movement would make `available` negative and the policy forbids it, the movement is refused with a stable error; where the policy allows it, the movement posts and the negative quant is flagged and reported. | MUST | TARGET CAPABILITY — FUTURE DELIVERY; policy DEC-MAT-2 | V(04 §3.7) + D+K(L203, L303) |
| MAT-13 | Sales consumption is never refused because stock is short: an order already accepted by Core is a fact. Depending on DEC-MAT-2, `issue_sales_consumption` either posts negative with a flag or is parked for review; it is never discarded. | MUST | TARGET CAPABILITY — FUTURE DELIVERY; policy DEC-MAT-2 | S (ORD-1) + E + D+K(L203, L303) |
| MAT-14 | `issue_sales_consumption` is posted only by the Core consumer of order facts (volume 03 RCP-19 for recipe items; a one-to-one mapping for `resale` materials per DEC-RCP-3), idempotent per source key, at the granularity set by DEC-MAT-10. | MUST | TARGET CAPABILITY — FUTURE DELIVERY | V(04 WF-M6) + S (INV-12, INV-13)+K(L203, L303) |
| MAT-15 | ATP is computed as in 04.4.4 and exposed per material and stock site; `quarantine`, `blocked` and `in_transit` quantities are never in ATP. | MUST | TARGET CAPABILITY — FUTURE DELIVERY | V(04 §2, §3.12)+K(L203, L303) |
| MAT-16 | A reservation never exceeds ATP at creation; a request beyond ATP returns the shortfall per line and reserves nothing. Reservations expire per configuration and release with notification to the source owner. | MUST | TARGET CAPABILITY — FUTURE DELIVERY; policy DEC-MAT-11 | V(04 §3.12) + D (DEC-MAT-11)+K(L203, L303) |
| MAT-17 | Requisitions and purchase orders follow 04.4.7; each purchase order line records price provenance; a manual price is flagged. | MUST | TARGET CAPABILITY — FUTURE DELIVERY | V(04 §3.5–3.6)+K(L204, L317) |
| MAT-18 | Requisition, purchase order and price list approvals use the shared approval mechanism (00.7); separation of duties (creator differs from approver, approver differs from receiver) applies above configured thresholds (DEC-MAT-7, DEC-X-7). | MUST | TARGET CAPABILITY — FUTURE DELIVERY | V(04 §6) + S (INV-4) + D+K(L204, L317) |
| MAT-19 | Purchase order transmission is an adapter command with explicit delivery state; a failed or uncertain transmission is visible and retried without duplicate orders (INV-14, INV-19). | MUST | TARGET CAPABILITY — FUTURE DELIVERY | S (INV-14, INV-19) + E+K(L204, L317) |
| MAT-20 | A goods receipt posts receipts, batches, purchase order status and invoice expectation in one transaction; batch and expiry are mandatory where flagged; out-of-tolerance quantities (DEC-MAT-5) require acknowledgment before posting. | MUST | TARGET CAPABILITY — FUTURE DELIVERY | V(04 §3.8, WF-M3)+K(L204, L317) |
| MAT-21 | Receipt discrepancies are recorded as typed records with optional supplier claim and are never absorbed silently. | MUST | TARGET CAPABILITY — FUTURE DELIVERY | V(04 §3.8)+K(L204, L317) |
| MAT-22 | Supplier invoices are matched three ways (04.4.9) within tolerances set by DEC-MAT-4; exceptions require an explicit resolution with actor and reason; overrides beyond tolerance require a dedicated permission; duplicates are detected. | MUST | TARGET CAPABILITY — FUTURE DELIVERY; policy DEC-MAT-4 | V(04 §3.13, WF-M9) + D+K(L204, L317) |
| MAT-23 | A matched invoice is handed to volume 07 through a defined interface; materials never post accounting entries itself. | MUST | TARGET CAPABILITY — FUTURE DELIVERY | S (INV-1) + E+K(L204, L317) |
| MAT-24 | Inter-site and inter-venue transfers are two-step via `in_transit` (04.4.10); transit discrepancies are resolved by explicit postings. | MUST | TARGET CAPABILITY — FUTURE DELIVERY | V(04 WF-M5)+K(L203, L343–L346) |
| MAT-25 | Manual adjustments require a reason code; approval is configurable by value and type (DEC-MAT-7); creator differs from approver where approval applies. | MUST | TARGET CAPABILITY — FUTURE DELIVERY | V(04 §5.5, §6) + D+K(L203) |
| MAT-26 | Counts follow 04.4.11: blind by default, snapshot-based variance, configured freeze mode, recount rule, approval, and posting as `count_adjustment` movements. | MUST | TARGET CAPABILITY — FUTURE DELIVERY; policy DEC-MAT-6 | V(04 §3.9, WF-M7) + D (DEC-MAT-6)+K(L203) |
| MAT-27 | Waste, spoilage and damage are declared with reason codes and value attribution (04.4.12); approval above threshold. | MUST | TARGET CAPABILITY — FUTURE DELIVERY | V(04 §3.10, WF-M8)+K(L205) |
| MAT-28 | Expiry handling applies the configured rule (DEC-MAT-12) when an expiry passes, changes status by a `status_block` movement (system actor), and raises a task; the job is idempotent. | MUST | TARGET CAPABILITY — FUTURE DELIVERY; policy DEC-MAT-12 | V(04 §3.4) + D+K(L205, L471) |
| MAT-29 | Picking for production, transfers and events proposes batches in first-expiry-first-out order for expiry-managed materials; a different choice requires a reason and is audited. | SHOULD | TARGET CAPABILITY — FUTURE DELIVERY | V(04 WF-M4)+K(L205) |
| MAT-30 | Inspection results change batch status per configured rule (`fail` never leaves stock `available`). | MUST | TARGET CAPABILITY — FUTURE DELIVERY; policy DEC-MAT-13 | V(04 §3.11) + D (DEC-MAT-13)+K(L471) |
| MAT-31 | Opening and isolating a recall case sets every affected quant to `blocked` in one transaction, overriding other statuses, and records time to isolation. | MUST | TARGET CAPABILITY — FUTURE DELIVERY | V(04 §3.11, WF-M10)+K(L471) |
| MAT-32 | Batch trace is available backward (to receipt, supplier and input batches) and forward (to production outputs, transfers, current quants and the sales exposure window, labelled theoretical). | MUST | TARGET CAPABILITY — FUTURE DELIVERY | V(04 §5.5) + E+K(L471) |
| MAT-33 | A recall may recommend availability changes for affected menu items; the change itself is an AVL-1 action by an authorised user unless DEC-MAT-8 permits automation. | SHOULD | TARGET CAPABILITY — FUTURE DELIVERY; policy DEC-MAT-8 | S (AVL-1) + V(04 WF-M10) + D+K(L471) |
| MAT-34 | Temperature records and out-of-range tasks are stored per location; sensor ingestion, if adopted, passes through Venue Edge or an adapter (DEC-MAT-22), never directly into PostgreSQL. | MAY | TARGET CAPABILITY — FUTURE DELIVERY; policy DEC-MAT-13, DEC-MAT-22 | V(04 §3.11) + S (EDGE-1, PR-1)+K(L472) |
| MAT-35 | Reorder rules and proposals follow 04.4.14; proposals never send purchase orders unless DEC-MAT-17 allows automation. | SHOULD | TARGET CAPABILITY — FUTURE DELIVERY; policy DEC-MAT-17 | V(04 WF-M2) + D+K(L204, L318) |
| MAT-36 | Each value-bearing movement line stores unit cost and value under the method in force (DEC-MAT-3); revaluation is an explicit document; period valuation snapshots are immutable. | MUST | TARGET CAPABILITY — FUTURE DELIVERY; policy DEC-MAT-3 | V(04 §3.13) + S (INV-11) + D+K(L205, L223) |
| MAT-37 | Price observations (price list, purchase order, invoice) are recorded per material and supplier over time and are immutable. | SHOULD | TARGET CAPABILITY — FUTURE DELIVERY | V(04 §3.13)+K(L204, L205) |
| MAT-38 | Material cost changes emit a domain event consumed by volume 03 costing (RCP-28). | SHOULD | TARGET CAPABILITY — FUTURE DELIVERY | V(04 WF-M11)+K(L205) |
| MAT-39 | Stock-driven availability: when ATP of a material falls below a configured threshold, menu items whose recipes in force need it are flagged; whether flags are recommendations or automatic AVL-1 changes is DEC-MAT-8. Any automatic change uses AVL-1 propagation with per-channel state and is reversible by an authorised user. | MAY | TARGET CAPABILITY — FUTURE DELIVERY; policy DEC-MAT-8 | S (AVL-1, MENU-6) + V(04 §5.5) + D+K(L203) |
| MAT-40 | Storeroom capture (receiving, counts, waste) on a device may save drafts locally, but posting requires durable acceptance by Core; the idempotency key is created with the draft so replay after reconnection posts once. The surface and any wider offline capability are DEC-MAT-9. | MUST | ARCHITECTURE DECISION REQUIRED | S (KSK-4 pattern, NFR-OFF, INV-12) + D |
| MAT-41 | Human document numbers come from collision-checked series per document type and venue (INV-9). | MUST | TARGET CAPABILITY — FUTURE DELIVERY | S (INV-9)+K(L203) |
| MAT-42 | Every master-data change, configuration change, movement, approval, override, status change and recall action is audited with before and after values (INV-15). | MUST | TARGET CAPABILITY — FUTURE DELIVERY | S (NFR-AUD)+K(L203, L247) |
| MAT-43 | Configuration (movement types, reason catalogues, units, policies, tolerances, rules) inherits organization → venue with audited overrides and is validated before activation (INV-17). | MUST | TARGET CAPABILITY — FUTURE DELIVERY | S (INV-17)+K(L203) |
| MAT-44 | Theoretical-versus-actual variance per material and count interval is computed from `issue_sales_consumption` and counts as defined in 04.12. | SHOULD | TARGET CAPABILITY — FUTURE DELIVERY | V(04 WF-M6)+K(L205) |
| MAT-45 | Each material and stock site can carry a venue-configured low-stock threshold (in an explicit unit, INV-7; configuration, no default supplied by Servvia; it may differ from the reorder point of 04.4.14). When ATP (MAT-15) falls to or below the threshold, Core raises one low-stock alert per crossing (idempotent per material, stock site and crossing), delivered through the notification capability (00.7, DEC-X-15) to the roles configured for the venue and shown on the operational home (volume 01); the alert clears when ATP rises above the threshold. The alert states that it is derived from theoretical stock and shows its as-of time; it never changes availability (MAT-39) and never creates a purchase document (MAT-35, MAT-47). If evaluation lags, the as-of time shows the lag; a failed notification delivery is visible and retryable (INV-14). Threshold changes are audited (MAT-42). | SHOULD | TARGET CAPABILITY — FUTURE DELIVERY | K(L304)+S (INV-14)+E |
| MAT-46 | A venue can operate configurable food-safety and health-and-safety checklists: versioned templates (INV-17) of monitoring points (for example a temperature reading at a storage location, a hygiene or cleaning check, a receiving check), each with pass criteria or an expected range, a frequency or trigger, and the corrective action required on failure. Instances are generated per venue and business date (INV-8). Each completed item records result or value, actor, device, time and optional evidence attachment (O-8); temperature items create TemperatureRecords (MAT-34). A failed or out-of-range item requires a recorded corrective action and raises a task; a checklist is closed by sign-off of an authorised user, who differs from the completer where configured (DEC-X-7). Completed records are append-only and corrected only by linked correction records (INV-11); a missed or overdue instance is recorded as missed and never back-filled silently. Regime-specific content (monitoring points, critical limits, record formats, retention) is supplied only by a jurisdiction pack (INV-22) whose activation requires validation evidence (P5); without one, templates are venue-defined. These records are operational evidence; Servvia makes no claim that using them satisfies any food-safety, HACCP or health-and-safety regime (DEC-X-5, DEC-MAT-13). Capture surface and offline drafts follow DEC-MAT-9 and MAT-40. | SHOULD | TARGET CAPABILITY — FUTURE DELIVERY; policy DEC-MAT-13; regime content P5 | K(L246, L471–L472)+S (INV-11, INV-22)+E+D |
| MAT-47 | Reorder proposals (MAT-35) and any AI-derived inventory optimisation (for example forecast-driven par levels or order quantities) are predictions or recommendations under INV-21, or assisted actions in which an authorised user confirms each requisition or purchase order through the normal approval path (MAT-18). No proposal becomes a purchase commitment transmitted to a supplier without that human confirmation; autonomous purchase commitments are not authorised unless DEC-MAT-17 permits them within limits and DEC-X-19 approves a control model for that action class. AI-derived proposals show their evidence, time basis and confidence or known limitations, are labelled as AI output, and record the confirming user and the AI source (INV-5, INV-21). If the forecasting source is unavailable, rule-based proposals continue and AI proposals are shown as unavailable, not as zero need. | MUST | TARGET CAPABILITY — FUTURE DELIVERY; policy DEC-MAT-17, DEC-X-19 | K(L204, L318, L595)+S (INV-21)+D |

## 04.6 Workflows and failure paths

**WF-MAT-1 Onboard a material.** Create (form, template, or from a price-list line); set type and category (defaults inherit); define base and alternative units, confirming each conversion; set flags; link supplier items. Failure: duplicate name → refused; conversion with zero or negative factor → refused.

**WF-MAT-2 Reorder → requisition → purchase order.**
1. Reorder job produces proposals (MAT-35); job is idempotent per run key.
2. User edits and submits requisition; approval per DEC-MAT-7.
3. Convert to purchase orders per supplier; price provenance resolved contract → price list → quotation → manual (flagged).
4. Approve (separation of duties) and send through the adapter.
- Failure: adapter timeout → transmission `unknown`, reconciled before retry (INV-14, PAY-6 pattern); supplier minimum unmet → warning; manual price above tolerance → approval required.

**WF-MAT-3 Receive.**
1. Select expected delivery; lines prefilled from purchase order.
2. Confirm quantities, capture batch and expiry where flagged, inspection hand-off where configured, attach docket image.
3. Post (MAT-20); `receipt_quarantine` where inspection comes first.
- Failure: out-of-tolerance quantity → acknowledgment; device loses connection → draft retained locally, posting deferred until Core accepts (MAT-40), unsynced state visible; concurrent receipt of the same purchase order line on two devices → both post serially; the second evaluates over-receipt tolerance against the updated received quantity; retry of the same draft → same document (MAT-11).

**WF-MAT-4 Put-away and picking.** Proposal by storage class and location rules; FEFO for expiry-managed (MAT-29); deviations recorded with reason; confirmation posts `location_move`.

**WF-MAT-5 Two-step transfer.** `transfer_out` at source moves stock to `in_transit`; `transfer_in` at destination makes it `available`. Failure: shortfall at destination → transit discrepancy, resolved by explicit posting; destination never receives more than dispatched.

**WF-MAT-6 Sales consumption.**
1. Volume 03 consumer (or resale mapping) produces material quantities for a source fact.
2. `issue_sales_consumption` posts (MAT-14) under the negative-stock rule for this type (MAT-13).
3. Compensating Core facts post linked reversals (RCP-22).
- Failure: posting conflict on a hot quant → retry with backoff within the same idempotency key; persistent failure → dead letter and alert (INV-13); materials package unavailable → event redelivered; nothing is lost.

**WF-MAT-7 Count.**
1. Schedule (cycle by rule, or physical) creates sessions with snapshot instant.
2. Counters record blind counts; variance beyond rule forces recount.
3. Review by value; approve; post `count_adjustment`.
- Failure: movement in scope during a blocking freeze → refused with a count-in-progress error naming the session; consumption from sales during a freeze → never refused (MAT-13), included in the post-snapshot adjustment; two counters submit the same line → last confirmed count per counter retained, conflict shown for review; approval rejected → session returns to `review`.

**WF-MAT-8 Waste declaration.** Material, quantity, reason, optional photo → posts immediately or waits for approval above threshold. Failure: batch missing for batch-managed material → refused.

**WF-MAT-9 Invoice match.** Capture → match → `matched` → payables hand-off, or `exception` → explicit resolution. Failure: duplicate → `duplicate` exception, never two hand-offs; hand-off failure → retried idempotently, visible.

**WF-MAT-10 Recall.** Open with supplier batch references → trace → isolate (MAT-31) → notifications to authorised users → availability recommendations (MAT-33) → disposal or return postings → closure with sign-off. Failure: a supplier batch reference resolves to no internal batch → case records "no exposure found" with the search evidence; isolation transaction failure → nothing is half-blocked; retry.

**WF-MAT-11 Expiry.** Scheduled job finds expired batches → `status_block` or quarantine per rule (MAT-28) → task. Job interruption → idempotent rerun.

## 04.7 Security, authorization and audit

- Deny by default; scope from the verified credential (INV-2, INV-4). Device identities may capture drafts only on the surface approved by DEC-MAT-9 and only with a staff actor (INV-3); Guest Mode and customer surfaces have no access.
- **Authorization matrix (mechanism; domain roles DEC-X-2; thresholds DEC-X-7 and DEC-MAT-7):**

| Action | owner / admin | manager | kitchen | cashier | viewer |
|---|---|---|---|---|---|
| Maintain materials, units, suppliers | Allow | Configurable | Deny | Deny | Deny |
| Activate price list | Allow | Configurable (approval) | Deny | Deny | Deny |
| Create requisition | Allow | Allow | Configurable | Deny | Deny |
| Approve requisition or purchase order | Allow | Configurable (threshold) | Deny | Deny | Deny |
| Post goods receipt | Allow | Allow | Configurable | Deny | Deny |
| Post transfer, location move | Allow | Allow | Configurable | Deny | Deny |
| Declare waste | Allow | Allow | Allow | Deny | Deny |
| Execute count | Allow | Allow | Allow | Deny | Deny |
| Approve count, adjustment, waste above threshold | Allow | Configurable | Deny | Deny | Deny |
| Resolve invoice exception; override tolerance | Allow | Configurable (dedicated permission) | Deny | Deny | Deny |
| Open, isolate, close recall | Allow | Configurable (DEC-MAT-14) | Deny | Deny | Deny |
| Reverse movement | Allow | Configurable | Deny | Deny | Deny |
| View stock values and costs | Allow | Configurable | Configurable | Deny | Configurable |

- **Separation of duties** (mechanism): purchase order creator ≠ approver ≠ receipt poster above threshold; adjustment creator ≠ approver; count executor ≠ count approver; tolerance override always records actor and reason.
- **Audit (MAT-42)** includes denied attempts at privileged actions.

## 04.8 Data governance

| Data | Class (INV-18) | Owner | Retention | Correction |
|---|---|---|---|---|
| Materials, units, categories | Internal | Organization | Life of record; deactivated, not deleted | New version or deactivation |
| Supplier records | Confidential; contact persons Personal | Organization | DEC-MAT-16, DEC-X-4 | Edit with audit (master data) |
| Prices, costs, valuation | Financial / Confidential | Organization | DEC-MAT-16 (with DEC-X-5) | New price list, revaluation document |
| Movements, receipts, counts, waste | Internal; value fields Financial | Venue | DEC-MAT-16 | Reversal |
| Supplier invoices | Financial | Organization | DEC-MAT-16 (with DEC-X-5) | Credit or exception resolution |
| Quality, temperature, recall records | Internal | Venue | DEC-MAT-16 (with DEC-MAT-13) | Linked correction record |
| Attachments (dockets, photos, certificates) | Per content; default Confidential | Organization | DEC-MAT-16; media per O-8 | Supersede, never overwrite |

- Personal data of supplier contacts follows DEC-X-4. No bank details of suppliers are held here; supplier payment details belong to volume 07 governance.
- Exports of stock and cost data are permission-checked and audited.

## 04.9 Reliability, scalability and observability

- **Contention:** sales consumption concentrates writes on frequently used quants. MAT-10 serialises them; aggregation per period (DEC-MAT-10) is the evidenced lever if contention exceeds capacity targets (DEC-X-8). Consumption posting is asynchronous and never on the order submission path (ORD-1).
- **Consistency:** MAT-7 ledger reconciliation; any mismatch is an alert and a release-blocking defect class (SPRD §25 policy pending).
- **Recovery:** event consumers are at-least-once and idempotent; adapters (supplier transmission, invoice capture) use durable commands with explicit `unknown` state (INV-14, INV-19); scheduled jobs (expiry, reorder, reconciliation) are idempotent per run key.
- **Signals:** consumption backlog depth and oldest age; parked consumption; negative quants count and age; ledger reconciliation result; transmission failures; invoice exceptions by type and age; recall isolation duration; expiry job lag; count sessions overdue. Thresholds: OWNER TARGET REQUIRED (DEC-MAT-21).

## 04.10 UX and accessibility

- Admin Console: WCAG 2.1 AA (NFR-A11Y). Storeroom surface targets follow the surface chosen in DEC-MAT-9 (Android targets are SPRD §23 OWNER TARGET REQUIRED).
- Capture flows (receiving, counting, waste) minimise entry: prefilled lines, unit shown with every quantity, scan where hardware exists (Venue Edge), never a free-text unit.
- Truthful states (INV-14): draft, unsynced, pending approval, posted, reversed, parked, transmission unknown; negative and blocked stock visibly marked; blind counts never reveal system quantity.
- Destructive or value-significant actions (reversal, adjustment, recall closure, tolerance override) require confirmation and a reason (SPRD §22).

## 04.11 Acceptance criteria

| ID | Scenario | Expected result | Covers |
|---|---|---|---|
| AC-MAT-1 | Post a receipt against a purchase order with batch and expiry | Movement, batch, quant delta, purchase order status, invoice expectation, audit and event commit together | MAT-20, MAT-10 |
| AC-MAT-2 | Same receipt command retried with the same idempotency key after a timeout | Original document returned; nothing posted twice | MAT-11 |
| AC-MAT-3 | Receipt of a batch-managed material without batch | Refused with stable error; nothing posted | MAT-3 |
| AC-MAT-4 | Attempt to edit a posted movement through any API | Refused; only reversal is offered | MAT-6, MAT-9 |
| AC-MAT-5 | Reverse a movement, then attempt to reverse the reversal | First succeeds with two-way links and reason; second refused | MAT-9 |
| AC-MAT-6 | Two concurrent issues against the same quant whose combined quantity exceeds `available`, negative stock forbidden for that type | Exactly one posts; the other is refused; quant never negative | MAT-10, MAT-12 |
| AC-MAT-7 | Sales consumption exceeds `available` | Not refused; posted negative with flag or parked per DEC-MAT-2; never discarded | MAT-13 |
| AC-MAT-8 | Same order fact delivered twice | One `issue_sales_consumption` | MAT-14 |
| AC-MAT-9 | Ledger reconciliation after concurrent load test | Every quant equals the sum of its movements; a seeded mismatch raises an alert | MAT-7 |
| AC-MAT-10 | Reservation request beyond ATP | Shortfall per line returned; nothing reserved | MAT-16 |
| AC-MAT-11 | Transfer out, then receive less than dispatched | `in_transit` excluded from both sites' ATP; transit discrepancy created; resolution posts explicitly | MAT-24 |
| AC-MAT-12 | Blind count with variance beyond rule | System quantity hidden; recount forced; posting creates `count_adjustment` valued at method in force | MAT-26 |
| AC-MAT-13 | Manual adjustment above threshold created and approved by the same user | Approval refused (separation of duties) | MAT-25 |
| AC-MAT-14 | Kitchen credential attempts purchase order approval; credential of another organization reads stock | Both refused server-side; denied privileged attempt audited | 04.7, INV-2 |
| AC-MAT-15 | Invoice with price outside tolerance; same invoice captured twice | Price exception requiring explicit resolution; duplicate exception; one payables hand-off at most | MAT-22 |
| AC-MAT-16 | Purchase order transmission adapter times out | State `unknown`; reconciled before retry; supplier never receives two orders for one version | MAT-19 |
| AC-MAT-17 | Recall opened on a supplier batch used in a production output that was transferred | All affected quants at both venues `blocked` in one transaction; trace shows receipt, production, transfer and labelled sales exposure window; time to isolation recorded | MAT-31, MAT-32 |
| AC-MAT-18 | Expiry job run twice for the same day | Each expired batch blocked once; one task each | MAT-28 |
| AC-MAT-19 | Storeroom device captures a receipt offline, reconnects, replays twice | One posted receipt; unsynced indicator shown until Core acceptance | MAT-40 |
| AC-MAT-20 | Change a conversion used by posted movements | New version effective from stated instant; historical movements keep the old version | MAT-2 |
| AC-MAT-21 | Consumption worker stopped, backlog accumulates, restarted | Backlog drains without loss or duplicates; backlog alert fired at configured threshold | 04.9 |
| AC-MAT-22 | Stock-driven availability enabled as recommendation | Flag shown on affected items; no AVL-1 change without user action | MAT-39 |
| AC-MAT-23 | ATP of a material falls below its venue-configured low-stock threshold, the evaluation reruns, then ATP recovers | One alert per crossing to the configured roles with an as-of time; no duplicate on rerun; alert clears on recovery; no availability or purchase document changed | MAT-45 |
| AC-MAT-24 | A checklist temperature item is recorded out of range; the completer attempts sign-off where separation is configured; an instance passes its due time unfinished | Corrective action required and task raised; same-user sign-off refused; overdue instance recorded as missed; completed records cannot be edited, only corrected by linked record | MAT-46 |
| AC-MAT-25 | Reorder job and an AI optimisation produce proposals; nobody confirms them | No purchase order is transmitted; AI proposals carry evidence, time basis and confidence labels; a confirmed proposal records the confirming user and AI source | MAT-47, MAT-35 |

## 04.12 KPIs and metric definitions

| Metric | Definition | Target |
|---|---|---|
| Inventory accuracy (value-weighted) | 1 − (Σ absolute counted-minus-system value variance ÷ Σ system value) over count lines posted in the period | Proposed (Verdura evidence) above 97 % — OWNER TARGET REQUIRED (DEC-MAT-21) |
| Theoretical-versus-actual variance | Per material, stock site and count interval: theoretical consumption = Σ `issue_sales_consumption` quantity; actual usage = opening counted quantity + Σ signed quantities of all other non-count movements in the interval − closing counted quantity, sign-adjusted so usage is positive; variance = (actual usage − theoretical consumption) ÷ theoretical consumption, also valued at the method in force | OWNER TARGET REQUIRED (DEC-MAT-21) |
| Count compliance | Count sessions posted by their due date ÷ count sessions due in the period | OWNER TARGET REQUIRED (DEC-MAT-21) |
| Waste value share | Value of waste, spoilage and damage movements ÷ value of receipts in the period | OWNER TARGET REQUIRED (DEC-MAT-21) |
| Expired stock value | Value of stock moved to `blocked` by the expiry rule in the period | OWNER TARGET REQUIRED (DEC-MAT-21) |
| Receiving exception rate | Receipts with at least one discrepancy ÷ receipts | OWNER TARGET REQUIRED (DEC-MAT-21) |
| Time to receive | Median time from receipt start to posting per delivery | Proposed (Verdura evidence) under 4 minutes — OWNER TARGET REQUIRED (DEC-MAT-21) |
| Three-way auto-match rate | Invoices `matched` without manual resolution ÷ invoices captured | Proposed (Verdura evidence) above 85 % — OWNER TARGET REQUIRED (DEC-MAT-21) |
| Exception ageing | Age distribution of open invoice exceptions | OWNER TARGET REQUIRED (DEC-MAT-21) |
| Recall time to isolation | Time from recall case open to isolation committed | Proposed (Verdura evidence) under 15 minutes — OWNER TARGET REQUIRED (DEC-MAT-21) |
| Stockout frequency | Count of material-site intervals with ATP at or below zero while a linked menu item was available | OWNER TARGET REQUIRED (DEC-MAT-21) |

Other Verdura evidence figures recorded as proposed only: minimum viable material created in 60 seconds or less; waste declaration in about 10 seconds. **Proposed (Verdura evidence) — OWNER TARGET REQUIRED (DEC-MAT-21).**

## 04.13 Open decisions

| ID | Decision | Why it matters | Options evidenced | Blocks | Tier |
|---|---|---|---|---|---|
| DEC-MAT-1 | First materials slice. **Inclusion of the domain is resolved (O-9, DEC-X-1, owner 2026-10-05)**; the first slice and its order are part of delivery phasing DEC-X-17 and are decided there | Delivery sequence and entry burden | Counts, waste and resale items only; plus receiving; full procurement; with or without recipes (DEC-RCP-1) | Planning of MAT-1 onwards | 3 (under DEC-X-17) |
| DEC-MAT-2 | Negative-stock policy per movement type and venue | Data truth versus operational flow; sales consumption cannot be refused | Forbid for manual movements and allow-and-flag for sales; allow everywhere with flag; park sales consumption for review | MAT-12, MAT-13 | 3 |
| DEC-MAT-3 | Valuation method (per material type or organization) | Stock value, cost of goods, recipe costing and finance hand-off | FIFO layers, moving average, standard cost, last price; aligned with volume 07 accounting policy and DEC-RCP-4 | MAT-36, RCP-26 | 3 |
| DEC-MAT-4 | Three-way match tolerances and override authority | Payables control | Percentage or amount per line and invoice; dedicated override permission | MAT-22 | 3 |
| DEC-MAT-5 | Receipt over and short tolerances | Receiving control | Per material, category or supplier | MAT-20 | 3 |
| DEC-MAT-6 | Count freeze mode, recount rule and count schedule | Accuracy versus service disruption | Blocking freeze; snapshot with post-snapshot movements; recount by value or percentage; ABC-driven frequency | MAT-26 | 3 |
| DEC-MAT-7 | Which materials actions require approval and their thresholds (within DEC-X-7) | Control versus burden | Requisition, purchase order, price list, adjustment, waste, count, reversal by value | MAT-18, MAT-25, MAT-27 | 3 |
| DEC-MAT-8 | Stock-driven availability: recommendation or automatic AVL-1 change; thresholds; recall-driven availability | Theoretical stock can be wrong; automatic 86 affects sales on every channel (O-17) | Recommendation only; automatic with reversal; disabled | MAT-33, MAT-39 | 3 |
| DEC-MAT-9 | Storeroom capture surface and its offline behaviour | No permanent application has a storeroom function; Part C fixes four Android apps | Admin Console on a tablet browser; a Waiter Tablet Staff Mode function; a KDS function for waste; a new application (Part C change) | MAT-40, WF-MAT-3, WF-MAT-7, WF-MAT-8 | 2 |
| DEC-MAT-10 | Granularity of sales consumption posting | Contention and traceability | Per order line; per round; aggregated per material and period with lineage retained | MAT-14 | 2 |
| DEC-MAT-11 | Whether reservations exist, and their representation | Production and events need holds; complexity | No reservations; commitment ledger; status partition of quants | MAT-16, RCP-31 | 2 |
| DEC-MAT-12 | Expiry rule | Food waste versus risk | Block on expiry; quarantine for review; distinguish use-by and best-before | MAT-28 | 3 |
| DEC-MAT-13 | Quality, food-safety and health-and-safety record policy and any applicable regime (with DEC-X-5). **Inclusion of the capability is resolved by DEC-X-1 (owner 2026-10-05)**; still open: which checklists and monitoring points a venue must run, frequencies, sign-off authority, retention, and which regime packs apply (P5) | Avoids regulatory claims; defines retention | Inspections and temperature records as operational evidence; venue-defined checklists; regime-specific checklists from a validated jurisdiction pack (INV-22) | MAT-30, MAT-34, MAT-46 | 3 |
| DEC-MAT-14 | Recall authority, notification recipients and closure sign-off | Critical-path control | Owner only; owner or admin; manager with owner sign-off | MAT-31 | 3 |
| DEC-MAT-15 | Supplier integration channels and invoice capture | Adapter scope and external data handling | Email document; supplier API; e-invoicing network; capture assisted in `data/` | MAT-19, MAT-22 | 2 |
| DEC-MAT-16 | Retention for movements, invoices, quality and recall records, attachments | Storage and legal exposure (with DEC-X-5) | Fixed periods per class; life of organization | Retention jobs | 3 |
| DEC-MAT-17 | Reorder automation. Automated reorder proposals are owner-approved as a capability (DEC-X-1); proposals are recommendations or assisted actions (MAT-47). Any autonomous purchase commitment additionally needs a DEC-X-19 control model | Purchasing control | Proposals only; automatic requisition drafts; automatic purchase orders within limits | MAT-35, MAT-47 | 3 |
| DEC-MAT-18 | Valuation of inter-venue transfers | Venue profitability and finance entries | At source cost; at standard; at agreed transfer price | MAT-24 valuation | 3 |
| DEC-MAT-19 | Landed-cost composition | Cost accuracy | Price only; price plus freight and surcharges allocated by value, quantity or weight | MAT-36 | 3 |
| DEC-MAT-20 | Storage topology depth and storage-class segregation enforcement | Complexity versus control | Site only; site and location; with bins; enforce or warn on class mismatch | MAT-5 | 2 |
| DEC-MAT-21 | Targets for 04.9 alert thresholds and 04.12 metrics | No approved targets exist | Verdura evidence figures (proposed only) | Alerting; release acceptance | 3 |
| DEC-MAT-22 | Temperature sensor ingestion path | Hardware belongs to Venue Edge (EDGE-1) | Manual only; Venue Edge sensor module; external sensor service adapter | MAT-34 | 2 |

Inventory domain inclusion is resolved (O-9, DEC-X-1, 2026-10-05); delivery phasing DEC-X-17; package placement DEC-X-13; roles DEC-X-2; approval thresholds DEC-X-7; autonomous AI actions DEC-X-19; consumption trigger DEC-RCP-2; unmapped items DEC-RCP-3; jurisdiction packs INV-22.

## 04.14 Future and deferred capabilities

| Capability | State | Precondition |
|---|---|---|
| MAT-1 to MAT-39, MAT-41 to MAT-47 | TARGET CAPABILITY — FUTURE DELIVERY (owner 2026-10-05; O-9 and DEC-X-1 inclusion resolved) | DEC-X-17 (with DEC-MAT-1), DEC-X-13 residual package decision |
| Storeroom capture surface and offline drafts (MAT-40) | ARCHITECTURE DECISION REQUIRED | DEC-MAT-9 |
| Requests for quotation and quotation comparison | FUTURE | Procurement committed |
| Contracts and contract compliance | FUTURE | Procurement committed |
| Supplier portal (confirmations, advance shipping notices, claims) | FUTURE | DEC-MAT-15 |
| Demand forecasting feeding reorder proposals | TARGET CAPABILITY — FUTURE DELIVERY (AI inventory optimisation, K L595; recommendation or assisted action, MAT-47); forecasting owned by volume 08 | Consumption history; DEC-X-17 |
| Supplier performance scorecards and price-variance analysis | FUTURE; analytics owned by volume 08 | Receipts and invoices in use |
| Multi-echelon planning (central kitchen to satellites) | FUTURE | DEC-RCP-14 |
| Consignment and vendor-managed inventory | FUTURE | Owner demand |
| Barcode label printing and scanning everywhere | FUTURE | Venue Edge scanner and printer modules (SPRD §30.4) |
| Windows POS stock functions | DEFERRED — PENDING USER POS ANALYSIS REPORT | SPRD §12 |
