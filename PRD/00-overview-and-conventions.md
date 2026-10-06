# Servvia PRD — Volume 00: Overview and Conventions

> **Status:** Normative Servvia corpus volume, version label **v5.1 (Servvia)**, last updated 2026-10-05.
> **Authority:** subordinate to [`product-requirements.md`](product-requirements.md) ("SPRD"), which wins on any conflict. This volume defines the conventions, cross-domain invariants and decision register that domain volumes 01–09 inherit.
> **Provenance:** Servvia baseline (SPRD, ADR 0001, ADR 0002, decisions log) plus enterprise hardening. Domain knowledge in volumes 01–09 was mined from the Verdura v5.2 PRD as **non-authoritative source material** (section 00.3).
> **Acceptance:** **NORMATIVE BASELINE ACCEPTED 2026-10-05** (SERVVIA PRD NORMATIVE BASELINE ACCEPTED; record in volume 00 §00.1.3). This volume is a normative refinement of [`product-requirements.md`](product-requirements.md), which wins on any conflict. Acceptance does not commit future-delivery capabilities to a release, select open policy values, approve production or release, or certify compliance.

## 00.1 The PRD corpus and its authority

### 00.1.1 Authority hierarchy

When sources disagree, the higher source wins:

1. explicit Servvia owner decisions;
2. [`product-requirements.md`](product-requirements.md) (requirements, architecture and repository structure: Parts A, B and C);
3. accepted Servvia ADRs and decisions-log entries;
4. verified Servvia repository reality, for CURRENT-state statements only;
5. this corpus (volumes 00–09);
6. source material (the Verdura v5.2 PRD) and historical evidence;
7. planning output (BMAD and `docs/planning/`), which is never requirements authority.

Implementation reality never redefines a TARGET requirement; it states only what currently exists. A domain volume refines SPRD; it does not override it. A domain volume that needs to change an SPRD requirement records a decision (section 00.10) instead.

**Direct architectural conflicts.** An accepted ADR controls a conflicting statement in volumes 00–09 unless a later controlled decision (recorded in SPRD or in the decision register, section 00.10) explicitly supersedes it. If supersession is ambiguous, work stops and the conflict is escalated. Conflicting normative sources are never reconciled silently.

### 00.1.2 Document map

| Document | Role | Authority |
|---|---|---|
| [`product-requirements.md`](product-requirements.md) | Consolidated requirements, Enterprise Quality Bar (Part B), architecture and repository structure (Part C) | **Normative authority** |
| [`README.md`](README.md) | Sources, provenance, conflicts and approval record of SPRD | Normative companion of SPRD |
| `00-overview-and-conventions.md` (this volume) | Conventions, cross-domain invariants, shared platform capabilities, decision register | Normative refinement under SPRD (baseline accepted 2026-10-05) |
| [`01-home.md`](01-home.md) | Operational home, notifications, tasks, command search | Normative refinement under SPRD (baseline accepted 2026-10-05) |
| [`02-operations.md`](02-operations.md) | Service day: reservations, tables and visits, ordering, kitchen, availability, devices in service | Normative refinement under SPRD (baseline accepted 2026-10-05) |
| [`03-recipe-and-production.md`](03-recipe-and-production.md) | Recipes, yield, production and costing | Normative refinement under SPRD (baseline accepted 2026-10-05) |
| [`04-material-management.md`](04-material-management.md) | Materials, stock, movements, procurement, counts, waste | Normative refinement under SPRD (baseline accepted 2026-10-05) |
| [`05-crm-and-loyalty.md`](05-crm-and-loyalty.md) | Customer identity, consent, loyalty, gift value, feedback | Normative refinement under SPRD (baseline accepted 2026-10-05) |
| [`06-workforce.md`](06-workforce.md) | Employment records, scheduling, attendance, payroll export | Normative refinement under SPRD (baseline accepted 2026-10-05) |
| [`07-finance.md`](07-finance.md) | Financial records, settlement, cash, reconciliation, ledger and accounting boundary | Normative refinement under SPRD (baseline accepted 2026-10-05) |
| [`08-reports-and-bi.md`](08-reports-and-bi.md) | Metric semantics, reports, analytical separation | Normative refinement under SPRD (baseline accepted 2026-10-05) |
| [`09-administration.md`](09-administration.md) | Organization, venues, identity and access, devices, integrations, configuration, audit, operations tooling | Normative refinement under SPRD (baseline accepted 2026-10-05) |
| [`CONSOLIDATED_PRD.md`](CONSOLIDATED_PRD.md) | Derived consolidated view of the corpus | **Derived, not authority** |
| [`fileStructure.MD`](fileStructure.MD) | Derived repository and capability-structure reference | **Derived, not authority** |
| [`PRD_ALIGNMENT.md`](PRD_ALIGNMENT.md) | Corpus control plane: alignment, gaps, decisions, readiness | **Control document, not authority** |
| [`CHANGELOG-v5.1.md`](CHANGELOG-v5.1.md) | Decision-oriented change history of the corpus | Record, not authority |

### 00.1.3 Normative baseline acceptance record

**SERVVIA PRD NORMATIVE BASELINE ACCEPTED — 2026-10-05.**

- **What is accepted:** volumes 00–09 as normative refinements of SPRD, which remains the higher authority (00.1.1). The requirements baseline is authoritative even though the downstream decisions and implementation work identified in the volumes and in [`PRD_ALIGNMENT.md`](PRD_ALIGNMENT.md) §7 remain.
- **Decision provenance:**
  - owner-approved product direction: the SPRD baseline approval (2026-10-03), P3 and P11 (00.10.5), and the KitchenOS capability scope (DEC-X-1);
  - orchestrator Tier-2 architecture ratification: the register in 00.10.4, the contracts in 00.10.6 (O-20, O-21, DEC-OPS-25, DEC-FIN-19, DEC-WFM-19) and in 00.10.7 (O-10, O-13). These are not owner decisions;
  - acceptance recorded on orchestrator instruction after verification.
- **Retained gates, not owner-approved:** P5 (before production or any compliance commitment), P6 (before pilot enablement of the affected financial controls), P10 (before relevant production use), O-19 owner confirmation (before release acceptance), and the other open decisions with their gates.
- **Acceptance does not mean:** commitment of `TARGET CAPABILITY — FUTURE DELIVERY` items to any release; selection of open policy values; completed implementation; production, release or deployment approval; certified compliance; or approval of DL-117 (not approved).
- State labels keep their meaning after acceptance: FUTURE, DEFERRED, TRANSITIONAL, OWNER DECISION REQUIRED, ARCHITECTURE DECISION REQUIRED and `DECISION RESOLVED — IMPLEMENTATION BLOCKER` items are accepted as such, not as committed delivery.

## 00.2 Product definition

- **Servvia is the operational POS and restaurant platform** (SPRD §1, ADR 0001). Servvia Core (Go, PostgreSQL) records the service day and owns canonical restaurant state: tables and visits, orders and rounds, kitchen tickets, checks, payments, settlement, refunds, shifts and cash, devices and terminals, promotions, tax, rounding and totals, audit and domain events.
- **Servvia is not middleware** around another POS and not a provider-neutral reconciliation layer. External POS integration (IdealPOS) exists only as **TRANSITIONAL** legacy surfaces in the NestJS API, scheduled for retirement (SPRD §34.2). It is never target architecture.
- **Domain breadth (owner decision 2026-10-05).** The owner has decided that every genuine product capability of the KitchenOS capability set belongs in Servvia's long-term product: multi-channel ordering and service, kitchen and production, inventory and procurement, workforce including payroll capability, finance, CRM and loyalty, analytics and AI, multi-location and franchise operation, compliance capability, an integration ecosystem, platform extensibility, and onboarding and support (DEC-X-1 inclusion resolved). These capabilities are labelled `TARGET CAPABILITY — FUTURE DELIVERY` unless SPRD already commits them. Their delivery phase is DEC-X-17. KitchenOS architecture, vendors, numbers, schedules, GTM and compliance assertions are **not** adopted.
- **Delivery sequence:** first usable product, then the reduced first pilot (ADR 0002), then release acceptance and a separately approved production cutover (SPRD §11). Section 00.9 states the current governance state.

## 00.3 Source governance (Verdura)

- The Verdura v5.2 PRD (`/Users/sarwarkhan/Documents/Sarwar/verdura_v3/PRD/`, repository `ErebusCodes/verdura`) was mined on 2026-10-05 as **domain evidence only**. It is not Servvia authority.
- Every meaningful Verdura capability was classified before use: `ADOPT`, `ADAPT`, `TRANSITIONAL`, `SUPERSEDED`, `OUT OF SCOPE`, `OWNER DECISION REQUIRED` or `ARCHITECTURE DECISION REQUIRED`. The per-volume migration matrices are kept as non-authoritative evidence outside the repository (handoff artifacts of 2026-10-05).
- **Superseded Verdura thesis (never Servvia target):** provider-neutral control layer beside the POS; "the POS finalizes the fiscal sale, tax and payment" (Verdura D1); provider neutrality as the product boundary (D6); POS-returned totals as authoritative; kitchen release only after POS acceptance; the POS-handoff hot path; on-premises POS connectors as target; multi-POS buyer thesis; Verdura phase gates; browser-based device targets; a separate customer order-tablet application.
- **KitchenOS (owner-approved capability source, 2026-10-05).** `/Users/sarwarkhan/Documents/Obsidian Vault/Restaurant/KitchenOS.md` (17,745 bytes, sha256 `b8560431…790d`) is evidence of approved **capabilities** only. Its technology stack (Node/Express, Firebase/Firestore, MongoDB, NextAuth, Socket.IO, AWS S3, Vercel), vendor choices, numeric targets, week-based phases, UK-only framing, POS-partnership strategy and compliance claims are translated, recorded as decisions or rejected. The KitchenOS → Servvia traceability matrix is non-authoritative evidence held with the 2026-10-05 artifacts.
- **Adopted Verdura doctrine** that already matches Servvia: never fake success (PR-4); corrections are compensating records, never edits (PR-9); a reservation is not a sale until it creates a chargeable order (section 02).

## 00.4 Conventions

### 00.4.1 Normative language

**MUST**, **SHOULD** and **MAY** have their RFC 2119 meanings. Prose without these words is explanatory.

### 00.4.2 Identifiers

| Kind | Format | Rule |
|---|---|---|
| SPRD requirements | `PR-`, `ORD-`, `KIT-`, `PAY-`, `REC-`, `MENU-`, `AVL-`, `TBL-`, `STF-`, `VEN-`, `ADM-`, `RES-`, `RPT-`, `WT-`, `KSK-`, `WD-`, `WEB-`, `EDGE-`, `PRT-`, `NFR-` | Defined only in SPRD; volumes cite them |
| SPRD open decisions | `O-1` … `O-21` | Defined only in SPRD §14 |
| Cross-domain invariants | `INV-n` | Defined only in this volume (00.5) |
| Domain requirements | `HOME-n`, `OPS-n`, `RCP-n`, `MAT-n`, `CRM-n`, `WFM-n`, `FIN-n`, `BI-n`, `ADMIN-n` | One prefix per volume (01–09) |
| Acceptance criteria | `AC-<prefix>-n` | Per volume |
| Decisions | `DEC-X-n` (cross-cutting, this volume); `DEC-<prefix>-n` (domain) | Registered in 00.10 |

Identifiers are never reused or renumbered once published; a withdrawn item is marked `WITHDRAWN` with a reason.

### 00.4.3 State labels

| Label | Meaning |
|---|---|
| `CURRENT` | Implemented and in use today (state which component) |
| `TRANSITIONAL` | Implemented today by a component that will be replaced and retired (PR-7, PR-8) |
| `TARGET` | Committed Servvia scope (SPRD) or an enterprise mechanism necessarily implied by committed scope; not yet (fully) implemented |
| `TARGET CAPABILITY — FUTURE DELIVERY` | Owner-approved long-term Servvia product capability (owner decision of 2026-10-05 on the KitchenOS capability set; DEC-X-1), not yet in committed current delivery scope. Its delivery phase and order are DEC-X-17; its business policies stay with their own decisions. It is not implemented and is not a release commitment |
| `FUTURE` | Candidate capability mined as domain evidence but **not** owner-approved (outside the KitchenOS capability set); needs a scope decision before planning |
| `DEFERRED` | Explicitly deferred by SPRD §13, or frozen (Windows POS: PENDING USER POS ANALYSIS REPORT) |
| `REMOVED` | Deliberately removed (record when and why) |
| `OWNER DECISION REQUIRED` | Cannot be specified until a Tier-3 owner decision is made |
| `ARCHITECTURE DECISION REQUIRED` | Cannot be specified until a Tier-2 architecture/product decision is made |

**Core implementation note:** Go Core phases D1–D13 are implemented and tested on disposable databases, but **not applied to production and used by no client**. Requirements they satisfy are labelled `TARGET` with the note "implemented in Core, not in production", never `CURRENT`.

### 00.4.4 Basis codes

`S` Servvia baseline (SPRD, ADR, decisions log) · `A` approved Servvia decision · `K` owner-approved KitchenOS capability (with source line, for example `K(L203)`) · `V` adapted Verdura domain evidence (with volume and section) · `E` enterprise-hardening requirement derived from SPRD Part B · `D` open decision. Codes combine, for example `S+E` or `V(04 §4.3)+E`.

### 00.4.5 Decision tiers

- **Tier 2:** architecture or product-structure decisions resolved through the project's decision orchestration, then recorded by controlled change (SPRD §28).
- **Tier 3:** owner decisions (business policy, commercial scope, legal and compliance posture, targets).
- **Tier 1:** a reversible implementation default (for example an initial routing-rule precedence or a reporting topology). It must satisfy the governing Tier-2 invariant and may change without a product decision.
- **Tier-2 boundary:** a Tier-2 decision fixes the mechanism (state model, ownership, identity class, persistence, delivery semantics, authorization mechanism). It never fixes business policy (who may act, when approval is needed, thresholds, tax, tips, revenue definitions, allergen lists, business-day cut-off, jurisdictional rules); that stays Tier 3 and is enforced as configuration.
- **Readiness classification `DECISION RESOLVED — IMPLEMENTATION BLOCKER`:** a decision that existing authority or an approved resolution has settled, but whose implementation is incomplete and blocks a milestone. It is not an open decision and stays tracked in readiness until the implementation is complete.
- An open decision never blocks unrelated requirements. A requirement that depends on one is labelled with the decision and is not planned until it is resolved (SPRD README, "Approval", item 3).

### 00.4.6 Domain volume template

Every domain volume uses sections NN.1–NN.14: purpose, scope and state; actors and surfaces; domain model and ownership; business objects and lifecycles; requirements; workflows and failure paths; security, authorization and audit; data governance; reliability, scalability and observability; UX and accessibility; acceptance criteria; KPIs and metric definitions; open decisions; future and deferred capabilities.

## 00.5 Cross-domain invariants

These apply to every domain. Volumes reference them and do not restate them.

| ID | Invariant | Basis |
|---|---|---|
| INV-1 | **Single canonical owner.** Each capability and each business object has exactly one canonical owner (a Go Core domain package in the target architecture, PostgreSQL as the record). Transitional overlap follows PR-7. No client, edge process or external system owns canonical state. | S (PR-1, PR-7, SPRD §29) |
| INV-2 | **Tenancy and scope.** Every business object belongs to exactly one organization; venue-scoped objects also belong to exactly one venue. Scope is taken from the verified credential, never from client-supplied identifiers, and is enforced at every boundary (REST, realtime, files, jobs, exports). Cross-organization access does not exist. | S (NFR-SEC-3, §16.3) |
| INV-3 | **Identity classes stay distinct:** human staff (named staff account), customer/guest, device (D8 credential, venue-bound), service/integration, and system (worker or scheduled process). Each action records which class acted. A device identity never acquires human authority without an explicit, audited elevation (WT-4, WT-5). | S (§16.4–16.6, WT-4/5) |
| INV-4 | **Authorization is deny-by-default and server-side**, composed of role permissions and venue grants, checked per request and per realtime subscription. Client visibility is never the control (PR-3, §16.2). Privileged and financially significant actions support step-up confirmation and separation of duties as configurable mechanisms; their thresholds are policy (DEC-X-7). | S+E |
| INV-5 | **Provenance.** Every order, financial record and operational mutation records actor identity, device identity, application identity, operating mode (O-21, decided; contract in 00.10.6), source channel, correlation ID and timestamps (SPRD §5, WT-6). | S |
| INV-6 | **Money** is stored as integer minor units with an ISO 4217 currency code. Rounding, tax and totals are computed only by Core (PR-3, PR-5, ORD-2). A client-displayed amount before server computation is labelled as an estimate. Multi-currency within one organization is a decision (DEC-X-11). | S |
| INV-7 | **Quantities** are decimals with an explicit unit of measure. Unit conversions are explicit, versioned data; there is no implicit conversion. | V(00 §0.4)+E |
| INV-8 | **Time and business date.** Instants are stored in UTC, preserved exactly, and displayed in the venue's time zone (VEN-1). Every record's business (trading) date is assigned deterministically from its event instant, the venue time zone and the venue's effective-dated trading-day boundary (organization default, optional venue override), per the owner rule in 00.10.5 (P3). Assignment never depends on day close and is never rewritten. Reports state their time basis. | S+A (P3, 2026-10-05) |
| INV-9 | **Identifiers.** Records carry an opaque, server-generated identifier (format per `contracts/`) and, where people use them, a human-readable number from a collision-checked, gap-controlled series per object type and scope. | S (§5) + V(00 §0.4) |
| INV-10 | **Lifecycles** are explicit state machines with enumerated transitions. An illegal transition is refused with a stable error code and changes nothing. Concurrent writes to the same aggregate are serialised by version compare-and-set or row locks (Part B row I). | S |
| INV-11 | **Immutable history.** Posted, financial, issued or acknowledged records are never edited or deleted; they are corrected by linked compensating records (reversal, credit, adjustment) that carry actor and reason (PR-9). Master data is deactivated, not deleted, while referenced. Erasure of personal data follows the privacy decision (DEC-X-4) without breaking financial integrity. | S+V(00 D4) |
| INV-12 | **Idempotency.** Every externally retried command carries an idempotency key; a retry returns the original result and duplicates nothing (ORD-3, Part B row J). | S |
| INV-13 | **Events.** A state change, its audit record and its domain event commit in one transaction (Part B row K). Consumers are idempotent and at-least-once; realtime is a notification to refetch (NFR-RT). No consumer infers success from delivery alone. | S |
| INV-14 | **Truthful state.** No surface reports success it has not confirmed. Pending, failed, uncertain and offline states are explicit and recoverable (PR-4, PAY-6). | S |
| INV-15 | **Audit.** Every security-sensitive, financially significant and configuration mutation emits an append-only, attributable, correlated audit record with before and after values, retained at least 90 days (NFR-AUD). Tamper-evidence beyond append-only storage is a decision (DEC-X-6). | S+D |
| INV-16 | **Errors** use stable, documented codes; messages are safe (no stack traces, internal identifiers or secrets) and actionable for the user (§16.16, Part B row N). | S |
| INV-17 | **Configuration** is data, inherited organization → venue with explicit, audited overrides; validated before activation; versioned with effective dates where history matters. Venue behaviour is never hard-coded. | E |
| INV-18 | **Data classification.** Every stored field belongs to one class: Public, Internal, Confidential, Personal (customer or employee), Financial, or Secret. The class governs access, logging, export, retention and masking. No Secret or card data is ever stored in Servvia (PAY-5, §16.7). | E |
| INV-19 | **Integration boundary.** External providers (payment, delivery, accounting, payroll, messaging, legacy POS) sit behind adapters. Adapter facts never overwrite Core canonical state, except trusted payment results through the payment adapter (CARD3, ADR 0002, PAY-3). Provider identifiers stay in adapter metadata (PAY-4). | S |
| INV-20 | **Mechanism versus policy.** The corpus specifies mechanisms (approvals, reasons, limits, audit, reversals). Business policy values (thresholds, rates, periods, permissions per role, legal posture) are configuration or open decisions, never invented. | E |
| INV-21 | **AI control model.** AI capabilities are classified as **prediction** (forecast or estimate), **recommendation** (a proposed action), **assisted action** (a human confirms each action before it is committed through the normal authorized path) or **autonomous action**. Predictions and recommendations show their evidence, time basis and confidence or known limitations, are labelled as AI output, and never become canonical operational or financial truth on their own. Every AI-initiated or AI-assisted change is attributed to the confirming human and to the AI source (INV-5). No autonomous action may change prices, financial records, payroll, staff permissions, canonical inventory or compliance declarations without a separately approved control model (DEC-X-19). AI processing stays outside the transaction path (`data/`, SPRD §4) and data sent to AI providers is minimised (INV-18). | K(L141, L236, L594–598)+E |
| INV-22 | **Jurisdiction and locale readiness.** Tax profiles, payroll rules, compliance record formats, receipt and invoice content, currencies, locales, languages, date and number formats and integration differences are configuration and adapters (jurisdiction packs) selected per organization or venue, never hard-coded behaviour. A jurisdiction, regime or locale is **supported** only when its pack is implemented and validated (P5 for regulatory packs); the corpus never claims compliance by specification. | K(L111–116, L243, L452–472)+E |

## 00.6 Enterprise quality framework

- **SPRD Part B is the quality bar** (sections 15–27): security standard (§16), data and financial integrity (§17), reliability (§18), performance (§19), observability (§20), test quality (§21), UX (§22), accessibility (§23), release readiness (§24), defect policy (§25), definition of done (§26) and the NFR matrix (§27). Volumes do not restate it.
- **Each domain volume applies it concretely** in its sections NN.7–NN.12: the domain's authorization matrix and separation-of-duties points, data classes and retention dependencies, failure modes and recovery, capacity dimensions, observability signals, UX states and accessibility targets, and acceptance criteria covering the failure paths listed in 00.4.6.
- **Approved quantitative targets** (SPRD §19 and §27) are preserved exactly and are the **planning baseline** under **O-19** (BASELINE ACCEPTED FOR PLANNING — OWNER MAY REVISE THROUGH CONTROLLED CHANGE; owner confirmation remains pending before release acceptance; no value is owner-confirmed): API read P95 under 200 ms; order submission P95 under 500 ms; KDS propagation under 3 s; print under 3 s on venue hardware; availability ("86") propagation p95 under 30 s; Admin Console initial load under 2 s on 10 Mbps; kiosk navigation under 1 s; 99.5% monthly availability; daily backups retained 30 days; audit retained at least 90 days; bcrypt cost at least 12 or Argon2id; TLS 1.2 or higher; login limit of 10 attempts per IP per 15 minutes; WCAG 2.1 AA for the Admin Console and Customer Website; kiosk targets 48 × 48 px and 4.5:1 contrast at 600 mm.
- **No new numbers.** A target that is needed but not approved is written as an owner-target decision. Numbers found only in Verdura or KitchenOS are recorded as proposals and never adopted silently. In particular the KitchenOS figures (500–2000 and 2000+ orders per hour per location, 99.9% uptime, under 1% error rate, "zero data loss", three-month ROI) are **not** Servvia targets: capacity and error-rate figures are candidates for P7 (DEC-X-8, O-19); 99.9% does not replace the approved 99.5%; "zero data loss" is not an absolute guarantee (Servvia commits to no loss of committed or acknowledged work, §18.7 and EDGE-3, within the RPO of P7); ROI is a business aspiration.
- **No compliance claims.** The corpus specifies the security and data capabilities that applicable regimes would require; whether a regime applies is DEC-X-5.

## 00.7 Shared platform capabilities

Specified once; domains consume them and do not re-implement them.

| Capability | Provides | Owner (target) | State |
|---|---|---|---|
| Tenancy and scoping | Organization and venue scope from the verified credential (INV-2) | Core `identity`, `venues`, `organizations` | TARGET (Core venue access implemented, not in production); CURRENT in Nest (VenueAccessGuard) |
| Authorization | Roles, permissions, venue grants, step-up, separation of duties (INV-4) | Core `identity` | TARGET; CURRENT (transitional) in Nest; role model extension DEC-X-2 |
| Audit | Append-only attributable audit records (INV-15) | Core `audit` (not yet a package) | CURRENT in Nest (staff/device/system actors); TARGET in Core |
| Domain events and workers | Durable facts, at-least-once consumers, dead letters (INV-13) | Core `events`, `workers` (D13) | TARGET (implemented in Core, not in production) |
| Realtime | Venue-scoped WebSocket notifications (NFR-RT). Each committed domain (orders, kitchen, inventory levels, staff notifications, dashboards) publishes through Core audiences; no domain introduces its own realtime transport (K(L370–378)) | Core `realtime` (D12) | TARGET (implemented in Core, not in production); TRANSITIONAL Nest Socket.IO |
| Approvals | Configurable approval steps (condition → approver set → decision, with SoD) used by finance, materials, workforce and refunds | Core (no package yet; DEC-X-13) | FUTURE; thresholds DEC-X-7 |
| Number series | Gap-controlled human numbers per object type and scope (INV-9) | Core | TARGET where SPRD needs references (orders, bookings); others FUTURE |
| Notifications | Event → rule → in-app, email or push delivery with delivery state | Core `notifications` (not created); email in Nest today | CURRENT (Nest email); TARGET/FUTURE otherwise; channels DEC-X-15 |
| Attachments and media | Validated, scanned, access-controlled files bound to records; media in GCS (MENU-3, NFR-DATA) | Media ownership O-8 | CURRENT (Nest MediaAsset); TARGET owner per O-8 |
| Integration adapters | Provider adapters with idempotency, retry, dead letter and reconciliation (INV-19) | Core adapters; Venue Edge for venue hardware | TARGET (payment adapter path implemented in Core); FUTURE for others |
| Search | Scoped command and record search | Core | FUTURE |
| Scheduled jobs | Recurring work (reports, sweeps, expiries) with visible failures | Core `workers` | TARGET |
| AI layer | Predictions, recommendations and assisted actions under INV-21 (forecasting, inventory, staffing, pricing, operational and customer insights) | `data/` (Python) with Core-owned facts; outputs never canonical | TARGET CAPABILITY — FUTURE DELIVERY |
| Integration framework | Adapter lifecycle for delivery marketplaces, accounting systems, payment providers (CARD3 boundary), communications and other non-POS services: credentials, scopes, idempotency, retry, dead letter, reconciliation and visible failure (INV-19) | Core adapters (service identities, DEC-ADMIN-21) | TARGET (payment adapter); TARGET CAPABILITY — FUTURE DELIVERY (others) |
| External API platform | Versioned external APIs (OpenAPI in `contracts/`), events and webhooks, scoped credentials, per-tenant rate limits, idempotency, audit, documentation and a sandbox; a public marketplace is DEC-X-18 | Core | TARGET CAPABILITY — FUTURE DELIVERY |
| Jurisdiction packs | Tax, payroll, compliance-record, receipt and locale packs per INV-22 | Core configuration and adapters | TARGET CAPABILITY — FUTURE DELIVERY (NZ GST profile implemented in Core) |
| Onboarding and guidance | Guided organization and venue setup with configuration validation, contextual help and role-specific guidance | Admin Console over Core | TARGET CAPABILITY — FUTURE DELIVERY |

## 00.8 Release readiness

"Implemented" is not "production ready" (SPRD §24). Every capability in this corpus inherits the fifteen release gates of SPRD §24 with explicit evidence, the defect policy of §25 (severity levels: OWNER DECISION REQUIRED) and the definition-of-done rule of §26. In addition, a domain capability is release-ready only when:

1. its acceptance criteria (NN.11), including failure, retry, concurrency and authorization cases, pass in CI or recorded rehearsal;
2. its open decisions that affect the shipped behaviour are resolved;
3. its runbooks (deploy, rollback, incident, restore, end-of-day where applicable; Part B row AF) exist;
4. its observability signals (NN.9) are live and alertable;
5. any known residual risk is recorded with an explicit acceptance by the owner. The corpus does not create any other approval role;
6. its documentation set exists: API reference (from `contracts/`), data-model and deployment documentation, security procedures and role-specific user guidance (K(L520–534));
7. security testing appropriate to its exposure has been performed, including penetration testing before production exposure of new external surfaces; its cadence is owner policy (P5/P7) (K(L543–544)).

## 00.9 Pilot and go-live governance

- **Reduced first pilot** (ADR 0002, accepted 2026-10-03): integrated card terminal through Venue Edge (card success only from the trusted payment adapter: **CARD3**, the D6 integrated-card architecture), receipt printing, kitchen printing if the venue requires it; cash-drawer hardware, Guest Mode and the Windows POS are excluded; settlement through the transitional web Order Tablet in Staff Mode. CARD3 is not changed by this corpus; any payment-architecture change is a Tier-2 or Tier-3 decision.
- **Production cutover** is a separately approved operational action requiring release-acceptance evidence (SPRD §11).
- **The 11 October 2026 milestone (draft DL-117) is NOT approved.** It is neither withdrawn nor guaranteed. No requirement in this corpus depends on it.

## 00.10 Decision register

### 00.10.1 Decisions inherited from SPRD

O-1 to O-21 (SPRD §14) remain authoritative and open unless SPRD records them as decided (O-2 decided 2026-10-03; O-11 superseded; O-20 and O-21 decided 2026-10-05 by Tier-2 ratification, contracts in 00.10.6; O-10 and O-13 decided 2026-10-05 by Tier-2 ratification, contracts in 00.10.7; O-19 reclassified as a planning baseline, owner confirmation pending before release acceptance). Of particular cross-domain weight: O-4 (hardware), O-7 (reservations in Core), O-8 (media ownership), O-9 (inventory domain), O-10 (Android toolchain; decided), O-13 (KDS authentication; decided), O-17 (availability channels), O-19 (targets confirmation, a release-acceptance gate), and every OWNER DECISION REQUIRED / OWNER TARGET REQUIRED item of Part B.

### 00.10.2 Cross-cutting decisions (this corpus)

| ID | Decision | Affects | Why it matters | Evidence / options | Blocks | Tier |
|---|---|---|---|---|---|---|
| DEC-X-1 | **Inclusion RESOLVED — owner decision 2026-10-05:** every genuine product capability of the KitchenOS capability set (ordering and service, kitchen and production, inventory and procurement, workforce, finance, CRM and loyalty, analytics and BI, AI, multi-location and franchise, compliance capability, integrations, platform extensibility, onboarding and support) is part of Servvia's long-term target product. Not decided by it: delivery phase and order (DEC-X-17), business policies, architecture beyond approved Servvia architecture | 01–09 | Domains are no longer speculative | KitchenOS (`/Users/sarwarkhan/Documents/Obsidian Vault/Restaurant/KitchenOS.md`, sha256 b8560431…) | Nothing (resolved) | **RESOLVED (inclusion), owner 2026-10-05** |
| DEC-X-2 | Role model: extend Servvia roles (owner, admin, manager, cashier, kitchen, viewer) with domain roles (for example chef, purchaser, storekeeper, finance, marketer, HR) or keep roles coarse with permissions | 01–09 | Least privilege and SoD depend on it | Verdura role templates (evidence) | Domain permission matrices beyond current roles | 3 |
| DEC-X-3 | Business-date (trading-day) boundary and its configuration per venue | 02, 07, 08 | Daily totals, close, reports and shifts depend on it | Midnight vs configured cut-off | Day-close and daily reports | **RESOLVED — owner decision P3, 2026-10-05** (rule in 00.10.5; was: 3) |
| DEC-X-4 | Personal-data retention, deletion and anonymisation policy (customer and employee) | 05, 06, 08, 09 | Part B row C is OWNER DECISION REQUIRED | — | Retention jobs; erasure workflow | 3 |
| DEC-X-5 | Which formal compliance regimes apply (privacy legislation, payment-card standards for the trusted-adapter scope, employment, tax and accounting rules) | 05–07, 09 | The corpus must not claim compliance | Venue is in New Zealand (GST); obligations not established | Compliance attestations; some retention values | 3 |
| DEC-X-6 | Audit tamper evidence beyond append-only storage (for example hash chaining with periodic verification) | 07, 09 | Fraud resistance and audit trust | Verdura evidence: per-organization-day hash chain | Nothing in the first pilot | **APPROVED — TIER 2** (2026-10-05; mechanism only, see 00.10.4; was: 2) |
| DEC-X-7 | Approval and separation-of-duties thresholds (refunds, voids, discounts, write-offs, purchase approvals, manual journal posting) | 02, 04, 06, 07 | Mechanisms exist; values are policy | Verdura SoD rules (creator ≠ approver above threshold) as evidence | Enabling the affected approvals in production | 3 |
| DEC-X-8 | Capacity targets: venues, devices, concurrent users, throughput, history volume (SPRD §19 OWNER TARGET REQUIRED) | all | Scalability cannot be validated without targets | — | Load acceptance (§24 gate 9) | 3 |
| DEC-X-9 | RPO and RTO; any availability above 99.5% | all | Part B row O | — | DR acceptance | 3 |
| DEC-X-10 | WITHDRAWN — identifier reserved during drafting and never assigned to a decision; kept so that later identifiers are not renumbered (00.4.2) | — | — | — | Nothing | — |
| DEC-X-11 | Currencies and locales: single currency per organization or multi-currency; languages and localisation | all | Money (INV-6) and UX | — | Multi-currency and translations | 3 |
| DEC-X-12 | Enterprise identity federation (SSO, SCIM) timing (SPRD §13 deferred) | 06, 09 | Joiner-mover-leaver automation | Verdura evidence: SCIM deprovisioning | Federated sign-in | 3 |
| DEC-X-13 | Core ownership of newly committed domains (inventory/materials, recipes, procurement, CRM, workforce, finance ledger, approvals, notifications, reporting, reservations O-7, media O-8). **Ownership is already decided:** any domain that becomes committed scope is a Go Core domain on PostgreSQL (INV-1, SPRD §29); no separate canonical backend is an option. Residual: the Part C package name and boundary, recorded by controlled change (SPRD §28) when the domain is committed; scope and timing are DEC-X-1 | 03–09 | Avoids reopening the canonical architecture | Part C §30.3 | Nothing beyond DEC-X-1 | Decided (residual Tier 1) |
| DEC-X-14 | Corpus versioning: the owner-named label "v5.1" for this Servvia corpus versus the Verdura v5.2 source it was mined from | governance | Avoid confusing two product lineages | Recorded truthfully in the changelog | Nothing | 2 |
| DEC-X-15 | Notification channels and providers (in-app, email, push, SMS) | 01, 05, 06, 09 | Delivery guarantees and consent | Email via Nest today | Push/SMS delivery | **APPROVED — TIER 2** (2026-10-05; mechanism only, see 00.10.4; was: 2) |
| DEC-X-16 | Analytical data separation (reporting replica, warehouse or in-database reporting) | 08 | Reporting load must not degrade transactions | — | Large-volume BI | **APPROVED — TIER 2** (2026-10-05; mechanism only, see 00.10.4; was: 2) |
| DEC-X-17 | Delivery phasing and order of the owner-approved target capabilities (split from DEC-X-1): which capabilities enter committed current delivery scope, in what order, gated on what readiness evidence. KitchenOS week-based phases are not adopted | 01–09 | Separates product destination from delivery commitment | KitchenOS phases (evidence only); Servvia dependency and readiness order | Planning of any TARGET CAPABILITY — FUTURE DELIVERY item | 3 |
| DEC-X-18 | Commercial platform capabilities: self-service tenant sign-up, Servvia subscription billing of customers, white-label offering, embedded financial services, referral programme, partner or developer marketplace | 09 | These are business and commercial choices (KitchenOS GTM, investment and add-on material), not product requirements | KitchenOS L55, L84–89, L585–606 (evidence) | Any implementation of those capabilities | 3 |
| DEC-X-19 | Whether any autonomous AI action is ever permitted, for which action classes, with which control model (limits, approval, rollback, audit) | 03–08 | INV-21 forbids autonomous high-impact changes until decided | KitchenOS AI features (evidence) | Autonomous AI actions only; prediction, recommendation and assisted action are unaffected | 3 |


### 00.10.3 Domain decision index

Domain volumes register their decisions as `DEC-<prefix>-n` in their section NN.13. [`PRD_ALIGNMENT.md`](PRD_ALIGNMENT.md) holds the consolidated index with tiers and blocking status.


### 00.10.4 Approved Tier-2 decisions (2026-10-05)

Approved by the orchestrator on 2026-10-05 (DEC-ADMIN-22 and DEC-OPS-12 earlier the same day). **The approval covers only the architecture and mechanism invariant.** It does not approve: Tier-1 defaults as fixed architecture (they are reversible); Tier-3 business policy or thresholds; rollout priority; jurisdiction-specific policy; or commitment of future domains. Each domain volume's decision row points here.

| ID | Approved invariant (Tier 2) | Policy left open (Tier 3 → package) | Tier-1 default (reversible, non-binding) |
|---|---|---|---|
| DEC-OPS-1 | Finalized financial history and the accepted round snapshot are never mutated (INV-11). Cancellation, line void and comp are explicit, append-only records or transitions linked to their target, carrying actor, device, reason, authorization evidence and idempotency key. A paid order is corrected only through refund or reversal, never by rewriting the payment. Kitchen cancellation is an explicit ticket transition with its own audit, and printers receive an explicit void notice. Dependent effects (tickets, unbilled lines, checks) are defined and never silent. Servvia supports policy-controlled authorization and step-up for void, cancel and comp, evaluated on lifecycle state, role and configured financial-control policy. | Which actions are permitted at which lifecycle state, which roles may perform or approve them, when step-up or separation of duties applies, thresholds, and the accounting/business semantics of a comp → **P6** (DEC-X-7; absorbs FIN-13 authority) | — |
| DEC-OPS-4 | Stations are explicit venue-scoped records. Every submitted line resolves to an explicit destination through a configurable, deterministic routing-rule model; the resolved destination is persisted on the line at submission (historical truth, KIT-1). Routing configuration is versioned and effective-dated. A deterministic fallback destination always exists, so no line is dropped. Reassignment is an explicit, audited transition. | Which routing rules a venue uses → venue configuration (no owner package needed) | Initial rule precedence: product rule → category rule → venue default station |
| DEC-OPS-7 | Order, kitchen and payment lifecycles are independent state machines. Aggregate or projected statuses are derived from canonical subordinate state, never stored as a conflated status. | None | Order states `open`, `closed`, `cancelled` |
| DEC-OPS-8 | A Core-issued guest credential class distinct from staff (INV-3). It never carries staff authority (WT-4). It is short-lived, least-privilege, scoped to its guest workflow, and expiring. Replay and idempotency controls apply. Provenance records device, guest session, mode and channel. Guest Mode, kiosk and customer web may differ in scope and lifetime mechanics while sharing these invariants. | O-20 (Staff Mode authorization), O-21 (mode provenance), customer accounts (DEC-X-1 scope) → unchanged SPRD items / **P1** | Guest Mode: visit-scoped session; kiosk: per-transaction session; web: cart/order-scoped session |
| DEC-OPS-14 | Core is the single canonical availability owner. Availability is venue-scoped and can be represented per item and per modifier option. Each change retains actor, reason, time and provenance. Delivery state per relevant channel is observable. AVL-1 (p95 under 30 s) remains the target. Supporting option granularity does not oblige venues to manage options manually. | Which channels count (O-17) → **P9**; channel-specific availability → FUTURE | — |
| DEC-OPS-16 | Core holds the authoritative print-job state, and printer configuration has one canonical owner. Venue Edge performs venue-local delivery. Jobs are idempotent with duplicate suppression. Evidence is modelled truthfully: `queued`, `dispatched`, `transport-acknowledged` (where supported), `confirmed` (only where hardware or protocol can prove completion), `uncertain`, `failed`. No `printed` fact is fabricated without device evidence. Reprints are explicit, attributed and linked. | Kitchen printing per venue (O-4, ADR 0002) → **P13** | Printer configuration administered in Core and synced to Edge; Nest configuration migrates, then retires |
| DEC-FIN-5 | Refunds are amount-based against a payment (D9 capacity invariant) with optional line attribution for current committed scope. Later committed domains (inventory, tax allocation, accounting) may extend refunds with line, tax or stock allocation without rewriting historical payment or refund truth. Sufficiency for those future domains is not asserted. | GST attribution of refunds (DEC-FIN-4) → **P6** | — |
| DEC-FIN-11 | No fabricated success. An uncertain payment leaves that state only through a trusted adapter or provider result, or through an append-only manual resolution carrying explicit provider evidence, actor, reason and provenance under an authorization/step-up mechanism. A contradicting later fact goes to reconciliation. No automatic re-charge because local state is uncertain. | Who may resolve, step-up and separation-of-duties thresholds → **P6** | — |
| DEC-BI-8 | Nest is transitional; Core on PostgreSQL is the target canonical platform. Each capability and period has a recorded source attribution (Nest or Core) with a cutover point, and reporting reads each from its attributed source only. Overlapping sources are never double-counted. Provenance identifies source and period. Transitional reporting creates no additional canonical operational store and no backfill of Nest data into Core. The mechanism retires when the Nest path retires. | None | Per-venue, per-capability designation record |
| DEC-ADMIN-12 | Venue Edge has its own device or service identity: one-time enrolment or pairing, rotating credential, venue scope, least privilege, audit and provenance, revocation (DEC-ADMIN-22). It is separate from the payment-adapter identity; CARD3 is unchanged. No Venue Edge UX is defined here. | None | D8 device kind `venue_edge` with a single-use pairing code; mutual TLS as an upgrade path |
| DEC-ADMIN-22 | Revocation is persisted with its audit. Subsequent authorization checks observe the revoked state; stale cached grants never authorize. In-flight operations resolve atomically and truthfully. Active realtime connections are closed as a consequence of the revocation. Periodic revalidation is defence in depth only. Re-authentication is required. No numeric SLA. | A latency bound, if the owner ever wants one → **P7** | — |
| DEC-OPS-12 | Whenever a Window Display represents availability or orderability, AVL-1 applies with its approved 30 s target. General signage and content refresh may keep the separate 60 s behaviour. AVL-1 is not weakened. | Whether any display is configured signage-only → venue configuration; O-17 → **P9** | Realtime notify-then-refetch for availability; 60 s periodic refresh for other content |
| DEC-HOME-3 | A fixed severity scale with orthogonal category tags. Each exception class maps to a severity through configuration with defaults. | Escalation timings → **P7** | `CRITICAL`, `WARNING`, `INFO`; categories operational, financial, security, data |
| DEC-X-6 | Audit history is append-only from application behaviour, transactionally coupled to material changes where required, and not updatable or deletable by ordinary actors. Its integrity can be independently checked. The enforcing mechanism may be any with equivalent or stronger guarantees. | Hash chaining and WORM/object-lock as compliance-driven escalations → **P5** | Database privileges with no UPDATE/DELETE for the application role; recommended (not required) controls: daily per-organization digest and checksummed exports |
| DEC-X-15 | An authoritative notification record exists per notification. Channels are adapters. Channel delivery state is observable. Retries, idempotency, preferences and consent apply where relevant. Channel rollout order is product scope, not architecture. | Channel rollout (email, push, SMS) → product scope; not an owner action now | — |
| DEC-X-16 | Reporting and analytical load never compromise transactional correctness or service-day targets. Derived reporting data preserves lineage to canonical operational truth. Operational and analytical concerns separate as measured scale requires. | Capacity targets → **P7** | Bounded read-only queries plus event-built projections; reporting replica, then analytical store, only as measured scale requires |
| DEC-OPS-2 | A visit can reference the reservation it fulfils. Reservation canonical ownership follows O-7. | O-7 → SPRD | Nullable reservation reference set at seating |
| DEC-OPS-5 | Moving a visit preserves its identity and history (version, audit). | Merge and split scope → **P1** (deferred) | — |
| DEC-OPS-6 | Service areas, if configured, are first-class venue-scoped records. No behaviour depends on them unless configured. | None | Optional |
| DEC-OPS-11 | Clients never show a state transition as applied before Core accepts it. Retained content during outage is labelled with its last-sync time (KIT-6). No payment or settlement offline. | Any broader offline capability → product scope | KDS: no queued transitions in the first native release; Waiter Tablet: non-payment drafts only |
| DEC-ADMIN-5 | Step-up is fresh authentication of the acting named identity, bound to session and action class, and audited. Device contexts use the device-appropriate elevation (DL-081 today; the native Waiter Tablet follows O-20, 00.10.6). | Validity window, factors required → **P2** | Re-authentication with the account credential; second factor where enabled |
| DEC-ADMIN-9 | Settings that change financial or routing truth are effective-dated and versioned, so history is reproducible. | None | Effective-dated: tax configuration, prices, station routing, availability schedules, printer routing |
| DEC-ADMIN-10 | Per-venue capability enablement is server-enforced configuration (INV-17), checked at Core boundaries and audited, never UI hiding alone. | Which capabilities each venue enables → venue configuration | — |
| DEC-ADMIN-19 | Servvia platform operators are a separate identity realm from customer organizations. Their access to tenant data happens only through audited support-access grants. | Support-access policy → **P2** | — |
| DEC-ADMIN-21 | Service and integration principals are a distinct identity class (INV-3): scoped, rotatable, revocable, audited, and distinguishable from devices. | Rotation cadence → **P2** | D8-style opaque credentials in a separate kind |
| DEC-ADMIN-23 | No in-place partial restore that rewrites a shared database. Recovery of one tenant's data goes through audited compensating changes in Core (INV-11). | RPO/RTO → **P7** | Point-in-time restore into an isolated environment, then corrections through Core |


**Ratified 2026-10-05 (orchestrator, second batch; mechanism only):**
- **DEC-OPS-25:** delivery fulfilment is a service mode with a dispatch and fulfilment lifecycle distinct from kitchen preparation, payment and the general order lifecycle; transitions are append-only and audited. Policy left open: phone-order policy (DEC-OPS-24), delivery zones, fees and channel terms; provider integrations and dispatch UX are not defined. Tier-1 default: one fulfilment record shared by phone, online and aggregator channels.
- **DEC-FIN-19:** check split, line move and merge are explicit, audited transitions that preserve payment and provenance history; historical payment truth is never rewritten. Policy left open: which states and roles permit them (DEC-FIN-15, P6); Windows POS UX pending the POS analysis (P12); no accounting or tax policy is added.
- **DEC-WFM-19:** payroll-related regulatory output is produced only through a validated jurisdiction pack (INV-22) or an explicitly accepted provider adapter (INV-19). Generic workforce data and export capability is separate and makes no payroll or legal compliance claim. Policy left open: applicability and validation evidence (P5).

### 00.10.5 Owner decisions recorded (2026-10-05)

**P3 — Business (trading) day** (resolves DEC-X-3; normative product rule):
1. Each venue has an effective-dated business (trading) day boundary, expressed in the venue's configured time zone.
2. A venue inherits an organization-level default boundary unless it has an explicit venue override.
3. Servvia prescribes no universal cut-off hour.
4. Boundary changes are prospective only. They take effect from a scheduled future business date and never rewrite historical business-date assignments.
5. Business-date assignment is deterministic from the event timestamp, the venue time zone and the effective trading-day-boundary configuration.
6. Business-date assignment does not depend on a person performing day close.
7. Operational day close is a separate lifecycle and control. It finalizes and freezes the operational close report according to the applicable close rules. Later permitted corrections are explicit and append-only. It never changes historical transaction business dates.
8. Exact UTC timestamps are preserved independently of business-date assignment.
9. Time-zone and daylight-saving handling preserves deterministic historical reproduction.
10. Orders and checks, shifts, settlements, operational reports and downstream exports use these business-date semantics consistently.

*Not decided by P3:* the close rules themselves (who closes, blocking versus acknowledged exceptions, reopening, frozen content) remain O-6 / DEC-FIN-10.

**P11 — Operational sales metric** (resolves DEC-BI-1; normative operational-reporting rule):
1. The primary headline operational sales measure is **Net Sales (incl. GST)**: finalized billed sales, less discounts/comps, less refunds/returns. Refunds and returns are recognized in the business day in which they occur.
2. The headline is **not** defined by tender received, settlement timing, payment-provider settlement, cash movement or formal accounting revenue recognition. Payments and tenders are a separate reconciliation and reporting dimension.
3. Servvia preserves, and makes separately reportable where applicable: Gross Sales; Discounts/Comps; Net Sales incl. GST; GST; Net Sales excl. GST; Refunds/Returns; Tips; Service Charges; Payments/Tenders.
4. A refund or return is reported on the business date on which the correction occurs. The original sale's business date is never rewritten.

*Not decided by P11:* formal accounting revenue recognition (DEC-FIN-2). Remaining metric-catalogue details (DEC-BI-2) and dine-in covers (DEC-BI-4) stay open under their reporting gate.

### 00.10.6 Ratified identity and provenance contracts (O-20, O-21; 2026-10-05)

Ratified by the orchestrator as Tier-2 architecture on 2026-10-05 (SPRD `[ORCH-T2-2026-10-05]`). They are **not** owner decisions. Both are `DECISION RESOLVED — IMPLEMENTATION BLOCKER`: the decisions are made; native Waiter Tablet authentication and Core provenance persistence are not yet built.

**O-20 — Native Waiter Tablet Staff Mode authorization.** Architectural invariant: **named staff authentication distinct from device identity.**
1. The Waiter Tablet installation has a venue-bound device identity (D8). Device identity conveys no staff authority (INV-3, WT-4).
2. Entering Staff Mode requires authentication of a named staff actor. For the MVP the approved mechanism is the personal staff PIN of the model evidenced by the transitional DL-081 implementation (ADMIN-14). The PIN is not the permanent architecture: stronger mechanisms may replace or supplement it without changing this model.
3. A staff elevation is bound to staff identity, device identity, venue and application identity. Its effective venue scope is the intersection of the device's venue scope and the staff member's venue grants.
4. Authorization follows least privilege (the staff member's role permissions). Manager or privileged authorization is a distinct step-up (DEC-ADMIN-5) where policy requires it; roles, thresholds and mandatory step-up situations are policy (P2, P6).
5. Staff elevation is short-lived. Idle and absolute lifetimes, step-up lifetime, PIN length, lockout values and second-factor policy are governed policy (P2), not architecture constants. The DL-081 values (staff elevation 20 minutes, manager step-up 5 minutes) are transitional current defaults only.
6. Staff authority is never silently refreshed: re-authentication follows the governed session policy.
7. Leaving Staff Mode or logging out ends the active elevation server-side at once (OPS-41). Revoking the staff account, a venue grant or the device invalidates every affected authorization, including live realtime connections, with the approved revocation semantics (DEC-ADMIN-22, ADMIN-33). A lost or stolen tablet is handled by device revocation, which invalidates elevations bound to it.
8. Staff secrets are verified server-side and stored only as specified by the security architecture (SPRD §16, ADMIN-14). Credential material kept on the device uses platform-secure storage.
9. No offline Staff Mode elevation is approved; without connectivity, elevation fails closed until a separate architecture decision.
10. Elevation, step-up, exit, logout and refusal events are audited with staff, device, application, venue and correlation context.
11. Guest Mode never receives staff credentials; guest authentication follows DEC-OPS-8.
12. This contract does not define Windows POS authentication (PENDING USER POS ANALYSIS REPORT).

**O-21 — Canonical provenance model.** Provenance is explicit and never inferred from a single source value. Provenance and authorization are separate concerns.
1. **Dimensions:** application identity; device identity; operating mode; actor class (staff, guest, device, service, system); actor identity or guest-session identity where applicable; venue; source or origin channel; transaction context (order, round, check); correlation, causation and idempotency context.
2. **Transactional provenance:** at the immutable creation boundary of a transactional action, enough provenance is persisted to reconstruct where and by whom it originated. For orders and rounds this includes, as applicable: venue, order or check link, source channel, application identity, device identity, operating mode, actor class, actor identity or guest-session identity, correlation context and idempotency context. Provenance is recorded **per round**, because one visit or order may contain rounds from different modes or actors. Original provenance is never overwritten.
3. **Assistance or delegation:** the model can represent an assisted or delegated action, but an assisting-staff reference is recorded only when an actual assisted workflow exists; otherwise it is absent. No assisted-order workflow is defined by this contract.
4. **Audit provenance:** each mutating action identifies actor, actor class, device where applicable, application, mode, venue, action, reason where required, and before/after or linked correction evidence. Audit stays append-oriented (DEC-X-6). Device, service and system actors are first-class (resolves the mechanism of DEC-OPS-21); a system or worker action never borrows or fabricates a staff identity.
5. **Event provenance:** durable event metadata carries the identity, correlation and causation needed for downstream attribution. Consumers never reconstruct Staff versus Guest Mode from a source value.
6. **Replay and idempotency:** an idempotent retry or event replay preserves the original provenance; it never re-attributes to the retrying transport, worker or current user.
7. **Server authority:** operating mode and actor class are established from the verified server-side credential or session. A client-declared mode is never trusted.
8. **Compatibility values (SPRD §33):** `waiter_tablet` is the native Waiter Tablet application or surface family; Staff and Guest Mode are distinguished by operating mode, not by separate application identity. The legacy `order_tablet` values stay readable for compatibility and history; native clients do not emit new `order_tablet` provenance. No destructive enum or schema migration is made; any additive cleanup is implementation planning.
9. **Not decided here:** Guest Mode menu-channel and display policy (P9) and Guest Mode UX (WT-3, undefined).

### 00.10.7 Ratified Android baseline and KDS device identity (O-10, O-13; 2026-10-05)

Ratified by the orchestrator as Tier-2 architecture on 2026-10-05 (SPRD `[ORCH-T2-2026-10-05]`). They are **not** owner decisions and approve no business policy or numeric value. Both are `DECISION RESOLVED — IMPLEMENTATION BLOCKER`: the decisions are made; the native Android baseline and Core acceptance of per-device KDS credentials are not yet built.

**O-10 — Android engineering baseline** (the four applications of SPRD §32).
1. **Stack:** native Kotlin (Kotlin 2.x, K2 generation); a pinned Gradle wrapper; Kotlin DSL build scripts; Jetpack Compose with Material 3; JDK 17 baseline.
2. **Build integrity:** one version catalog; Gradle dependency verification and dependency locking. Convention and build logic are introduced as justified; shared runtime modules are extracted only on genuine cross-app reuse (SPRD §32).
3. **Libraries:** Hilt; Kotlin coroutines and Flow; OkHttp for HTTP and WebSocket; kotlinx.serialization; contract-derived clients where appropriate; Room; DataStore; Android Keystore for protected device-credential material.
4. **Quality:** the supported Android testing and quality stack (unit, coroutine/Flow, HTTP mock-server, Robolectric, Compose UI, managed-device or instrumented and contract tests; Android Lint, ktlint/Spotless, detekt); required Android CI verification never uses continue-on-error.
5. **Release signing** is isolated from source control and ordinary CI logs, in a separately authorized release pipeline.
6. **Version governance:** when the baseline is first built, a supported, stable, mutually compatible Kotlin / Gradle / Android Gradle Plugin / Compose / JDK / SDK set is selected from authoritative compatibility and release information and reproducibly pinned. The architecture does not mean "always newest stable". Later upgrades are controlled changes. No exact version is fixed by this contract.
7. **SDK governance:** `minSdk` derives from approved venue hardware and must not fall below API 26 without a new architecture decision. `compileSdk` and `targetSdk` follow the supported toolchain and the selected distribution requirements. The distribution channel is an owner or release choice.
8. **Credential storage:** the Android Keystore is the invariant. Hardware-backed or StrongBox protection is used where supported and appropriate; StrongBox is not a universal device-compatibility requirement. No reusable staff secret is stored on a device (00.10.6, O-20 item 8).

**O-13 — KDS device authentication.**
1. Ordinary KDS operation uses a per-device, venue-bound D8 device identity and credential. No human login is required for ordinary KDS operation. The old "no-auth KDS" requirement (SPRD README C-3) is not adopted.
2. Device identity is distinct from staff identity (INV-3) and conveys no staff authority.
3. Enrollment, bootstrap, secure storage and recovery are implementation mechanics. The credential-rotation mechanism is engineering-level; its cadence is configurable policy (P2).
4. Revocation invalidates authorization, including live realtime connections (DEC-ADMIN-22). A lost or stolen device is handled by revocation; recovery is revocation followed by fresh enrollment, never credential reuse.
5. Realtime subscription authorization uses the device identity.
6. Audit and provenance identify the device or system actor (DEC-OPS-21; 00.10.6, O-21 item 4).
7. Venue reassignment requires revocation and re-enrollment, consistent with venue-bound identity; there is no in-place venue move.
8. Privileged KDS administration remains an Admin Console concern under staff authorization unless a later approved requirement creates an on-device privileged operation.
9. The Nest venue PIN (`KDS_VENUE_PINS`) stays TRANSITIONAL (ADMIN-38) and is not the canonical model.

**Transitional consequences (orchestrator Tier-2 decisions D-1 and D-3, 2026-10-05; sequencing records in `docs/checkpoints/2026-10-05/`).** The first-pilot KDS is the transitional web KDS migrated to canonical Core; the permanent KDS is `apps/android/kds`, and the web KDS retires after native parity under PR-8 (SPRD §34) (D-1). The transitional web KDS authenticates to Core with the per-device, venue-bound identity of O-13, not the Nest venue PIN (D-3).

**Supersession of earlier wording.** ADR 0002 Decision item 4 ("O-20 and O-21 stay open") and SPRD README conflict C-3 (KDS authentication as an open owner decision) recorded the state on 2026-10-03. They are explicitly superseded on those points by SPRD §14 and sections 00.10.6 and 00.10.7. ADR 0002 is otherwise unchanged and remains in force; its text is retained unchanged as historical decision context, following the ADR convention (`docs/adr/README.md`).

## 00.11 Current versus target by domain

| Domain | CURRENT / TRANSITIONAL today | Committed TARGET | TARGET CAPABILITY — FUTURE DELIVERY (owner-approved 2026-10-05) |
|---|---|---|---|
| 01 Home | Admin Console navigation; no operational home | Role-aware home for committed capabilities (exceptions, health, tasks) | AI insight display, cross-domain tiles (command search stays FUTURE: not KitchenOS-described) |
| 02 Operations | Nest orders, KDS mode, Order Tablet mode, reservations, menu; Core D2–D4, D10, D11 not in production | SPRD §6–§9 on Core | Phone, online and delivery-marketplace channels; waitlist and queues; courses, priority and expo; server assignment; reservation calendar sync (visit merge and split, and catering, stay FUTURE). Windows POS workflows stay frozen |
| 03 Recipe and production | Nothing | Allergen and nutrition data (MENU-2) | Recipes, yield, production, costing, allergen alerts and labels |
| 04 Material management | Nothing | — | Stock, consumption, procurement, receiving, reordering, transfers, counts, waste, traceability, food-safety records |
| 05 CRM and loyalty | Reservation guest data in Nest | Guest data protection | Profiles and history, consent, loyalty and rewards, campaigns, feedback, segmentation, privacy tooling |
| 06 Workforce | Staff accounts, roles, venue grants, staff PINs (Nest; Core verifies) | STF-1; shifts and cash in Core (D7) | Scheduling and optimization, attendance and breaks, payroll capability, performance, training |
| 07 Finance | Nest legacy payment flows; Core D5–D7, D9 not in production | Checks, payments, settlement, refunds, shifts and cash, reconciliation | Split and merge of checks, wallets, operational P&L, accounting integration, tax reporting per jurisdiction pack, multi-location finance |
| 08 Reports and BI | Nest reporting (basic), daily email | RPT-1, RPT-2, operational metrics (P11 headline) | Custom reports, benchmarking, forecasting and AI insights, business KPIs |
| 09 Administration | Nest staff, venue, menu, media and printer admin; Core D8 not in production | VEN-1, STF-1, ADM-1/2/3, device lifecycle, audit search | Operating profiles, franchise and group operation, integration framework, external API platform, MFA, IP allowlisting, encryption at rest, point-in-time recovery, guided onboarding |
