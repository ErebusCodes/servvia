# Servvia PRD — Volume 05: CRM and Loyalty

> **Status:** Normative Servvia domain volume under [`product-requirements.md`](product-requirements.md) ("SPRD"), which wins on any conflict. Conventions, invariants (INV-n) and cross-cutting decisions (DEC-X-n) are in [`00-overview-and-conventions.md`](00-overview-and-conventions.md). Version label **v5.1 (Servvia)**. Last updated 2026-10-05.
> **Provenance:** Servvia baseline (SPRD §1, §7 RES-1 to RES-5, §13, Part B row C, §16, §17, §20; ADR 0001; ADR 0002) and verified repository state for CURRENT statements; domain mechanisms adapted from the Verdura v5.2 PRD volume 05 as **non-authoritative source material**; enterprise hardening derived from SPRD Part B.
> **Scope state:** SPRD §13 defers "CRM and loyalty" beyond the first pilot. The owner decided on 2026-10-05 that customer profiles with order history, preferences and consent, loyalty points and rewards, campaigns, segmentation, feedback, privacy tooling and multi-venue behaviour belong to Servvia's long-term target product (DEC-X-1 inclusion resolved; KitchenOS L225–L230, L244, L459–L465, L598). Those capabilities are labelled `TARGET CAPABILITY — FUTURE DELIVERY`: not committed current delivery scope; phase and order DEC-X-17; business and privacy policy stay with their decisions (DEC-CRM-n, P4 = DEC-X-4, P5 = DEC-X-5). Stored value, memberships and customer self-service are not KitchenOS-described and stay `FUTURE`. Committed scope is limited to reservation guest data, transactional reservation email and guest personal-data protection. **Owner inclusion of these capabilities never implies marketing consent or any lawful basis for processing a customer's data** (CRM-1).
> **Acceptance:** **NORMATIVE BASELINE ACCEPTED 2026-10-05** (SERVVIA PRD NORMATIVE BASELINE ACCEPTED; record in volume 00 §00.1.3). This volume is a normative refinement of [`product-requirements.md`](product-requirements.md), which wins on any conflict. Acceptance does not commit future-delivery capabilities to a release, select open policy values, approve production or release, or certify compliance.

## 05.1 Purpose, scope and state

**Purpose.** Define how Servvia holds, protects and (when committed) uses information about the people a venue serves: the contact details needed to fulfil a transaction, an optional customer profile, consent to marketing, communication preferences, loyalty value, stored value, memberships, campaigns and feedback.

**Governing separation.** Five concepts are distinct objects with distinct lawful purposes and lifecycles, and none implies another:

| Concept | What it is | Created by | Never implies |
|---|---|---|---|
| Transactional contact | Contact details captured to fulfil one reservation or order and send its transactional messages | The transaction itself (RES-1; online ordering if O-18 commits it) | A profile, a loyalty membership, marketing consent |
| Customer profile | An organization-scoped record of a known customer assembled from linked sources | An explicit trigger under DEC-CRM-1 | Marketing consent, loyalty membership |
| Loyalty membership | A customer's enrolment in a loyalty program under accepted terms, with a value ledger | Explicit enrolment by the customer | Marketing consent |
| Marketing consent | A per-purpose, per-channel, evidenced grant or withdrawal by the customer | An explicit consent action with evidence | Anything else; it is withdrawn independently |
| Communication preference | Channel, frequency and language choices for communications already permitted | The customer, or staff on the customer's instruction | Consent; a preference can only narrow what consent allows |

**State labelling rule for this volume.** Capabilities the owner approved on 2026-10-05 (profiles and identity resolution, order history, preferences and consent, loyalty, segmentation and campaigns, customer behaviour analytics, feedback, privacy tooling, multi-venue behaviour) are `TARGET CAPABILITY — FUTURE DELIVERY`, with their policy gates appended. Verdura-mined candidates that KitchenOS does not describe (stored value and gift cards, memberships, customer self-service portal and wallet passes) stay `FUTURE` and need a scope decision before planning.

| Capability | State | Basis |
|---|---|---|
| Reservation guest contact: name, email, phone, occasion, special requests, per-guest dietary preferences | CURRENT (Nest `reservations`; Prisma `Reservation`, `ReservationGuest`) | S (RES-1); repository |
| Transactional reservation email (confirmation, cancellation, daily summary) | CURRENT (Nest `email`) | S (RES-2, RES-5) |
| Customer contact on orders | None: orders carry no customer contact today (party size only) | Repository; O-18 |
| Guest personal-data access control and audit | TARGET (venue scoping CURRENT in Nest through venue access grants; audit of personal-data reads and exports not implemented) | S (Part B row C) |
| Personal-data retention, deletion and anonymisation | OWNER DECISION REQUIRED | S (Part B row C); DEC-X-4 |
| Formal privacy-regime obligations (subject access, correction, notification) | OWNER DECISION REQUIRED | DEC-X-5 |
| Customer profile, identity resolution, merge and unmerge | TARGET CAPABILITY — FUTURE DELIVERY; policy DEC-CRM-1, DEC-CRM-2 | S (§13)+K(L227) |
| Customer order history (from Core orders through explicit identity links) | TARGET CAPABILITY — FUTURE DELIVERY; policy DEC-CRM-1 | K(L227) |
| Marketing consent, communication preferences, suppression | TARGET CAPABILITY — FUTURE DELIVERY; policy DEC-CRM-3, P4/P5 (no marketing communication and no consent capture exists in Servvia today) | S (§13)+K(L229, L462) |
| Profile-level dietary and allergen notes | TARGET CAPABILITY — FUTURE DELIVERY; policy DEC-CRM-4, DEC-CRM-5 | S (§13)+K(L207, L227); MENU-2 for item allergens |
| Loyalty programs, accounts and value ledger | TARGET CAPABILITY — FUTURE DELIVERY; policy DEC-CRM-6 to DEC-CRM-8 | S (§13)+K(L228) |
| Segmentation and campaigns | TARGET CAPABILITY — FUTURE DELIVERY; policy DEC-CRM-3, DEC-CRM-12, DEC-CRM-13 | S (§13)+K(L229) |
| Customer behaviour analytics and profiling segmentation | TARGET CAPABILITY — FUTURE DELIVERY; consent or lawful-basis rule P4/P5 | K(L598)+E |
| Stored value and gift cards | FUTURE; tender path ARCHITECTURE DECISION REQUIRED (DEC-CRM-10) | V(05 §3.5); D |
| Memberships and subscriptions | FUTURE; recurring billing ARCHITECTURE DECISION REQUIRED (DEC-CRM-11) | V(05 §3.3); D |
| Feedback capture and closed loop | TARGET CAPABILITY — FUTURE DELIVERY; policy DEC-CRM-14 | V(05 §3.6)+K(L230) |
| Privacy tooling: subject access, correction, erasure by anonymisation, data portability export | TARGET CAPABILITY — FUTURE DELIVERY; policy P4/P5, DEC-CRM-17 | K(L244, L461–L464)+E |
| Multi-venue customer, consent and loyalty behaviour within one organization | TARGET CAPABILITY — FUTURE DELIVERY | K(L343–L346, L602)+S (INV-2) |
| Customer self-service (portal, wallet passes) | FUTURE (not KitchenOS-described) | V(05 §9); DEC-CRM-16 |
| Cross-organization or cross-brand customer sharing | Not permitted (INV-2) | S |

**Out of scope of this volume** (owned elsewhere): the reservation lifecycle and availability (02, RES-1 to RES-4); pricing, promotions and tax (Core D1, D11; 02 and 07); payments, tenders and settlement (SPRD §6, §17; 07); notification delivery infrastructure (00.7; 09); staff accounts and roles (09); cohort and lifetime-value analytics (08).

## 05.2 Actors and surfaces

| Actor | CRM interaction | State |
|---|---|---|
| Public website guest | Supplies transactional contact when booking; would grant or withdraw consent and enrol in loyalty | Contact CURRENT; consent and enrolment TARGET CAPABILITY — FUTURE DELIVERY |
| Customer at a table (Waiter Tablet Guest Mode) | No access to any profile. Self-identification for loyalty is a decision (DEC-CRM-16) | FUTURE (customer self-identification is self-service, DEC-CRM-16) |
| Kiosk customer | As Guest Mode | FUTURE (DEC-CRM-16) |
| Waiter (Waiter Tablet Staff Mode) | Reads minimal dietary and allergen flags of an identified customer; attaches a loyalty member to a visit | TARGET CAPABILITY — FUTURE DELIVERY |
| Cashier | Loyalty identification and redemption at settlement. Windows POS behaviour is **DEFERRED — PENDING USER POS ANALYSIS REPORT**; no CRM function is added to the transitional web Order Tablet settlement surface (ADR 0002 item 8) unless decided | DEFERRED |
| Manager | Reservation guest data (ADM-1); feedback triage; loyalty adjustment requests and approvals within policy | Reservations CURRENT; rest TARGET CAPABILITY — FUTURE DELIVERY |
| Owner, admin | Program configuration; privacy requests; exports; merges | TARGET CAPABILITY — FUTURE DELIVERY |
| Candidate roles (marketer, privacy officer, finance) | Role model is DEC-X-2; not facts | OWNER DECISION REQUIRED |
| Data subject (any customer) | Requests access, correction, erasure or withdrawal through a venue channel | Handling OWNER DECISION REQUIRED (DEC-X-4, DEC-X-5, DEC-CRM-17) |
| System (workers) | Earn posting, expiry, retention sweeps, campaign sending | TARGET CAPABILITY — FUTURE DELIVERY (retention periods P4) |
| External providers | Messaging (DEC-X-15), billing (DEC-CRM-11), review platforms (DEC-CRM-14), behind adapters (INV-19) | Messaging and review platforms TARGET CAPABILITY — FUTURE DELIVERY; billing FUTURE |

| Surface | CRM role | State |
|---|---|---|
| Customer Website | Booking journey captures transactional contact (CURRENT). Consent capture, loyalty enrolment and preference management would be added here | Contact CURRENT; rest TARGET CAPABILITY — FUTURE DELIVERY |
| Admin Console | Reservation guest views (ADM-1, CURRENT); future CRM workspaces (customers, order history, consent, loyalty, stored value, campaigns, feedback, privacy requests) | TARGET CAPABILITY — FUTURE DELIVERY (stored value FUTURE) |
| Waiter Tablet, Staff Mode | Minimal operational customer context (CRM-15) | TARGET CAPABILITY — FUTURE DELIVERY |
| Waiter Tablet, Guest Mode; Kiosk | No profile data is ever displayed (CRM-15, WT-4) | Rule TARGET |
| KDS; printed tickets | Order-line notes only; never profile data (CRM-15) | Rule TARGET |
| Window Display | No personal data of any kind | Rule TARGET |
| Windows POS | DEFERRED — PENDING USER POS ANALYSIS REPORT | DEFERRED |
| Venue Edge | No CRM role. Stored-value scanning hardware, if ever needed, is an EDGE-1 device decided with DEC-CRM-10 | FUTURE |
| Data and analytics (`data/`) | Receives pseudonymised data only, per 08 and DEC-X-16; customer behaviour analytics under CRM-43 | TARGET CAPABILITY — FUTURE DELIVERY |

## 05.3 Domain model and ownership

```text
Reservation (02) 1 ─ 1 TransactionalContact ─ N ReservationGuest (dietary preferences)
Order (02, if O-18) 0..1 ─ TransactionalContact
CustomerProfile 1 ─ N IdentityLink ──> TransactionalContact | LoyaltyAccount | StoredValuePurchase | FeedbackItem
CustomerProfile 1 ─ N ProfileAttribute (value, source, asserted_at, verification)
CustomerProfile 1 ─ N ConsentRecord (purpose × channel; append-only)
CustomerProfile 1 ─ N CommunicationPreference
CustomerProfile 0..1 ─ DietaryNote (restricted)
ContactPoint (normalised email or phone) 1 ─ N SuppressionEntry
MergeEvent: CustomerProfile(source) → CustomerProfile(survivor); UnmergeEvent reverses one MergeEvent
LoyaltyProgram 1 ─ N ProgramVersion (rules, tiers, terms version, effective dates)
LoyaltyAccount (program × customer) 1 ─ N LoyaltyLedgerEntry ──> Check / CheckLine / Refund (07)
StoredValueInstrument 1 ─ N StoredValueTransaction ──> Check payment (07); liability summary → 07
MembershipPlan 1 ─ N Membership 1 ─ N BenefitUsage
Segment (rule version) 1 ─ N SegmentSnapshot ; Campaign 1 ─ N CampaignSend ; Attribution ──> Check (read-only)
FeedbackItem ──> Visit / Reservation (optional) ; 0..1 Task (01)
PrivacyRequest (access | correction | erasure | withdrawal) ──> CustomerProfile / TransactionalContact
```

| Entity | Canonical owner (target) | Current state |
|---|---|---|
| TransactionalContact (reservation) | Reservations domain; Core owner is O-7. Today Nest `reservations` | CURRENT (TRANSITIONAL in Nest) |
| TransactionalContact (order) | Core `internal/orders/` if O-18 commits online ordering | Not created |
| CustomerProfile, IdentityLink, ProfileAttribute, MergeEvent | Core CRM package — not in Part C §30.3; DEC-X-13 | Not created |
| ConsentRecord, CommunicationPreference, SuppressionEntry | Core CRM package (DEC-X-13); consumed by Core `notifications` (not created) | Not created |
| DietaryNote | Core CRM package (DEC-X-13) | Not created (reservation-level dietary preferences exist in Nest) |
| LoyaltyProgram, LoyaltyAccount, LoyaltyLedgerEntry | Core loyalty package (DEC-X-13) | Not created |
| StoredValueInstrument, StoredValueTransaction | Core; liability reporting with 07 (DEC-X-13, DEC-CRM-10) | Not created |
| MembershipPlan, Membership | Core (DEC-X-13, DEC-CRM-11) | Not created |
| Segment, Campaign, CampaignSend, Attribution | Core CRM package; delivery through Core `notifications` | Not created |
| FeedbackItem | Core CRM package; tasks in 01 | Not created |
| PrivacyRequest | Core CRM package, with 09 audit | Not created |

Discount application, tender, settlement and refunds stay with Core `internal/promotions/`, `internal/checks/` and `internal/payments/` (SPRD §30.3). CRM objects reference those records; they never compute or alter a price, total or payment (PR-2, PR-3, INV-6).

## 05.4 Business objects and lifecycles

### 05.4.1 TransactionalContact

- **Fields:** name, email, phone (as captured by the booking journey, RES-1), occasion, special requests; per-guest dietary preferences on `ReservationGuest`; the purpose ("reservation fulfilment" or "order fulfilment"); venue; capture surface; capture time.
- **Lifecycle:** follows its parent transaction. It becomes eligible for retention processing when the parent reaches a terminal state (reservation completed, cancelled or no-show), under DEC-X-4.
- **Invariants:** used only to fulfil the transaction and send its transactional messages (RES-2, RES-5); never added to a marketing audience; never creates a profile except under DEC-CRM-1 (CRM-1, CRM-10).

### 05.4.2 CustomerProfile, IdentityLink and ProfileAttribute

- **CustomerProfile:** organization-scoped (INV-2); status `active → merged | anonymised`; created-by actor and trigger; home venue (optional, informational).
- **ProfileAttribute:** each value (name, email, phone, birthday if collected, language) carries its source, assertion time and verification state (`unverified`, `verified` with method). A conflicting assertion is recorded alongside; the displayed value follows a configured source precedence (DEC-CRM-2). Attributes are never overwritten without a retained prior assertion (INV-11 applied to provenance).
- **IdentityLink:** profile ↔ source record (transactional contact, loyalty account, stored-value purchase, feedback item) with link method (`verified-key`, `staff-confirmed`, `merge`), actor, time, and state `active → detached`.
- **Lifecycle:** `active → merged` (terminal pointer to the survivor) or `active → anonymised` (terminal). A merged profile is retained as a tombstone resolving to its survivor for the unmerge window.

### 05.4.3 ConsentRecord, CommunicationPreference and SuppressionEntry

- **ConsentRecord** (append-only): profile or contact point; purpose (taxonomy DEC-CRM-3, for example marketing email, marketing SMS, profiling for personalisation, loyalty terms); channel; action `grant | withdraw`; evidence — capture surface, venue, consent wording version, presented language, actor identity class (customer, staff on instruction, import), staff actor if any, correlation ID, timestamp, and for imports the import batch and its declared lawful source.
- **Effective consent** for (purpose, channel) is the latest record. No record means **not granted**. There is no "assumed" or "implied" state.
- **CommunicationPreference:** channel ranking, frequency ceiling, quiet hours, language. It can only restrict sends permitted by consent.
- **SuppressionEntry:** contact point; reason (`withdrawal`, `hard-bounce`, `complaint`, `staff-request`, `erasure`); time; source. Suppression applies across profiles that share the contact point.

### 05.4.4 DietaryNote

- **Fields:** structured allergens from the fixed MENU-2 allergen list; structured dietary preferences; optional free text (DEC-CRM-5); source (customer-stated, staff-recorded on instruction); last confirmed time.
- **Rules:** advisory customer context only. It never replaces the order-level allergen or dietary declaration made for a specific order, and it never alters menu allergen data (MENU-2). Servvia makes no food-safety claim from it.
- **Classification:** Personal with restricted access; whether it forms a distinct sensitive class is DEC-CRM-4.

### 05.4.5 MergeEvent and UnmergeEvent

- **MergeEvent:** source profile, survivor, field-level survivor choices, re-pointed links and ledgers (by identifier), actor, reason, time, correlation ID. State `applied → reversed`.
- **UnmergeEvent:** reverses exactly one applied MergeEvent within the configured window (DEC-CRM-2); restores the source profile and its original links; ledger ownership is restored by compensating re-point records, never by editing entries.

### 05.4.6 Loyalty

- **LoyaltyProgram / ProgramVersion:** program type (points, visits or tiers; DEC-CRM-6), earn rules, redemption catalogue, tier thresholds, expiry rule, terms version, scope (organization or venue set), effective-from. A new version applies only to events after its effective time; it is never retroactive.
- **LoyaltyAccount:** program × customer; state `pending-terms → active → suspended → closed`; current tier with effective dates; enrolment evidence (terms version accepted, surface, time).
- **LoyaltyLedgerEntry** (append-only): type `earn | redeem | adjust | expire | reverse`; signed quantity in program units (decimal with explicit unit, INV-7); referenced record (check, check line, refund, reward, approval); rule and program version applied; idempotency key; actor and identity class; reason (mandatory for `adjust`); time; correlation ID.
- **Invariants:** balance equals the sum of entries and is derived, never stored as an editable field (a cached projection is permitted if rebuilt from entries); one `earn` per (account, check, rule version); a `reverse` references exactly one prior entry and cannot exceed it; entries are never edited or deleted (INV-11).

### 05.4.7 Stored value (gift cards)

- **StoredValueInstrument:** code verifier (the full code is a bearer credential: stored only as a verifier, shown once at issue, displayed masked thereafter), product, currency (INV-6), scope (organization or venue set), state `issued → active → depleted | expired | blocked | cancelled`, expiry date if policy allows (DEC-CRM-9).
- **StoredValueTransaction** (append-only): `issue | load | redeem | reverse | adjust | expire`; integer minor units; referenced sale or check payment; actor; reason; approval reference for `adjust`.
- **Invariants:** balance equals the sum of transactions and never goes below zero; redemption is bounded by balance and by the check's outstanding amount; issue for value is itself a sale recorded by Core (07); liability is reported to 07 and never posted by this domain.

### 05.4.8 Memberships

- **MembershipPlan:** price, billing cycle, benefits (each benefit is either a Core promotion reference or a counted entitlement), venue scope, terms version.
- **Membership:** state `pending → active → past-due → cancelled | expired`; billing reference held in adapter metadata only (PAY-4, PAY-5); benefit-usage ledger (append-only). Recurring billing architecture is DEC-CRM-11.

### 05.4.9 Segments and campaigns

- **Segment:** versioned rule tree over profile attributes, behaviour derived from Core records (visits, settled checks, items, venue), loyalty state. Effective consent is an implicit, non-removable filter for any marketing purpose.
- **Campaign:** purpose (must map to a consent purpose), channel, template version, schedule (one-off or trigger), optional control group; state `draft → scheduled → sending → sent → closed`, plus `paused` and `cancelled`.
- **CampaignSend:** one per recipient per campaign; state `planned → suppressed(reason) | handed-to-provider → delivered | bounced | failed`; idempotency key (campaign, recipient, send number).
- **Attribution:** a read-only match of later settled checks to sends within a configured window and method (DEC-CRM-13). It never modifies any financial record.

### 05.4.10 FeedbackItem

Source (in-venue QR, email survey, review platform via adapter), venue, ratings, text, optional link to a visit or reservation, state `new → triaged → actioned → closed`, assigned manager, response record. A configured rule may create a task in the operational home (01); the threshold is DEC-CRM-14.

### 05.4.11 PrivacyRequest

Type `access | correction | erasure | withdrawal`; subject reference; requester verification evidence (method DEC-CRM-17); state `received → verified → in-progress → completed | refused(reason)`; handler; due date (period DEC-X-5); output reference (export package or anonymisation record). Every transition is audited (INV-15).

## 05.5 Requirements

| ID | Requirement | Priority | State | Basis |
|---|---|---|---|---|
| CRM-1 | Transactional contact, customer profile, loyalty membership, marketing consent and communication preference are separate objects (05.1). No code path derives one from another: in particular, capturing transactional contact never records, implies or defaults marketing consent, and no form pre-selects a consent option. | MUST | TARGET | S (Part B row C)+E |
| CRM-2 | Reservation guest personal data (contact, occasion, special requests, dietary preferences) is readable and writable only by staff with the reservation permission at that venue (INV-2, INV-4). Bulk reads, searches by contact value, and exports are audited with actor, scope and purpose. | MUST | TARGET (venue scoping CURRENT in Nest; audit not implemented) | S (Part B row C, RES-1, NFR-AUD) |
| CRM-3 | Transactional messages (RES-2, RES-5) contain only content needed for the transaction. Adding promotional content to a transactional message requires the recipient's effective marketing consent for that channel. | MUST | TARGET | S+E |
| CRM-4 | No marketing communication is sent unless the recipient has effective consent for that purpose and channel at the moment of hand-off to the provider. List-build or segment-time consent is not sufficient. | MUST | TARGET CAPABILITY — FUTURE DELIVERY; policy DEC-CRM-3, P4/P5 | V(05 §3.1)+E+K(L229, L462) |
| CRM-5 | Every consent grant and withdrawal is an append-only ConsentRecord carrying the evidence listed in 05.4.3, including the consent wording version shown. Consent wording is versioned configuration (INV-17); its content and approval are DEC-CRM-3. | MUST | TARGET CAPABILITY — FUTURE DELIVERY; policy DEC-CRM-3, P4/P5 | V(05 §3.1, WF-C2)+E+K(L462) |
| CRM-6 | A withdrawal is available on every surface where the corresponding consent can be granted and through every marketing message, and requires no more steps than granting. A withdrawal suppresses every send not yet handed to the provider. Maximum time from withdrawal to suppression: OWNER TARGET REQUIRED (DEC-CRM-18). | MUST | TARGET CAPABILITY — FUTURE DELIVERY; policy DEC-CRM-3, DEC-CRM-18 | V(05 WF-C2)+E+D+K(L462) |
| CRM-7 | Communication preferences can only narrow permitted sends (channel, frequency ceiling, quiet hours, language); they never create permission. | MUST | TARGET CAPABILITY — FUTURE DELIVERY | E+K(L229, L462) |
| CRM-8 | Hard bounces, complaints, withdrawals and erasures create SuppressionEntries on the contact point, enforced at send time across all profiles sharing it. Removing a suppression requires a new consent record from the customer, never a staff override. | MUST | TARGET CAPABILITY — FUTURE DELIVERY | V(05 WF-C4)+E+K(L229, L462) |
| CRM-9 | A customer profile is organization-scoped. Every attribute carries source, assertion time and verification state; conflicting assertions are retained and resolved for display by configured precedence (DEC-CRM-2). | MUST | TARGET CAPABILITY — FUTURE DELIVERY; policy DEC-CRM-1, DEC-CRM-2 | V(05 §2, §3.1)+S (INV-2)+K(L227) |
| CRM-10 | A profile is created only by a trigger permitted under DEC-CRM-1 (for example loyalty enrolment or explicit customer account creation). Creating or enriching a profile from transactional contact requires that decision to permit it and to record the basis. | MUST | TARGET CAPABILITY — FUTURE DELIVERY; policy DEC-CRM-1, P4/P5 | E+D+K(L227) |
| CRM-11 | Identity resolution links a source record to a profile automatically only on an exact match of a verified key defined by DEC-CRM-2. Normalised or fuzzy matches produce review candidates only; the system never merges profiles automatically. | MUST | TARGET CAPABILITY — FUTURE DELIVERY; policy DEC-CRM-2 | V(05 WF-C1)+E+K(L227) |
| CRM-12 | A merge requires the merge permission, field-level survivor choices and a reason. It re-points identity links, loyalty accounts and stored-value ownership in one transaction with its MergeEvent, audit record and domain event (INV-13). Merging two profiles that each hold an active loyalty account in the same program follows DEC-CRM-2 and is refused if that decision is absent. | MUST | TARGET CAPABILITY — FUTURE DELIVERY; policy DEC-CRM-2 | V(05 §3.1, WF-C1)+S (Part B row K)+K(L227) |
| CRM-13 | An unmerge reverses exactly one MergeEvent within the configured window (DEC-CRM-2) using compensating records. Ledger entries posted to the survivor after the merge stay with the survivor unless explicitly re-attributed by an audited adjustment. | MUST | TARGET CAPABILITY — FUTURE DELIVERY; policy DEC-CRM-2 | V(05 §3.1)+S (INV-11)+K(L227) |
| CRM-14 | Profile dietary and allergen notes use the fixed MENU-2 allergen list plus structured dietary preferences; free text only if DEC-CRM-5 permits. Every change is audited. They are advisory and never replace an order-level declaration or alter menu data. | MUST | TARGET CAPABILITY — FUTURE DELIVERY; policy DEC-CRM-4, DEC-CRM-5 | V(05 §3.1)+S (MENU-2)+E+K(L207, L227) |
| CRM-15 | Surface exposure: Guest Mode, Kiosk, Customer Website (other than the customer's own authenticated view, if DEC-CRM-16 permits) and Window Display never display any profile data. Staff Mode displays only dietary and allergen flags and loyalty status of a customer staff explicitly identified for the visit, subject to permission. KDS and printed tickets show only notes entered on the order line (KIT-4); profile data is copied to an order only by an explicit staff action. | MUST | TARGET (as a constraint on any surface that gains customer data) | S (WT-4)+V(05 §6)+E |
| CRM-16 | Loyalty enrolment is an explicit customer action recording the accepted terms version, surface and time. Enrolment does not grant marketing consent; any consent offered alongside it is a separate, unticked choice. | MUST | TARGET CAPABILITY — FUTURE DELIVERY | V(05 §3.2)+E+K(L228) |
| CRM-17 | The loyalty ledger is append-only. Balances are derived from entries; the database rejects updates and deletes of entries and enforces one earn per (account, check, rule version). | MUST | TARGET CAPABILITY — FUTURE DELIVERY | V(05 §3.2)+S (INV-11, Part B row A)+K(L228) |
| CRM-18 | Earn is posted from Core settlement of a check (D6 settlement) for a check linked to an active loyalty account, by an idempotent consumer of the settlement event (INV-13). The earn basis (which amounts count: before or after tax, discounts, service charges, tips) and rates are DEC-CRM-6. Earn is never posted from order submission. | MUST | TARGET CAPABILITY — FUTURE DELIVERY; policy DEC-CRM-6 | S (§5, D6, D13)+V(05 WF-C3)+K(L228) |
| CRM-19 | A refund, reversal or settlement revocation of an earned check (Core D9) posts a compensating `reverse` entry proportional to the refunded basis under DEC-CRM-6. Whether a balance may go negative as a result is DEC-CRM-6; if not permitted, the shortfall is recorded as a recoverable debit flag, never silently dropped. | MUST | TARGET CAPABILITY — FUTURE DELIVERY; policy DEC-CRM-6 | S (D9, PR-9)+E+D+K(L228) |
| CRM-20 | Redemption is idempotent, validated server-side against balance, program rules and fraud controls, and serialised per account (row lock or version compare-and-set, INV-10). A failed or abandoned check payment never leaves a committed redemption without a linked check; an unused redemption is reversed by a compensating entry. | MUST | TARGET CAPABILITY — FUTURE DELIVERY | V(05 WF-C3)+S (INV-10, INV-12)+K(L228) |
| CRM-21 | The monetary effect of a redemption on a check is computed only by Core pricing (as a promotion/discount through D11 or as a tender, per DEC-CRM-8), never by a client or by the loyalty domain. | MUST | ARCHITECTURE DECISION REQUIRED | S (PR-3, ORD-2, D11)+D |
| CRM-22 | Manual loyalty adjustments carry a reason code, actor and reference; above a configured threshold they require approval by a different person (DEC-X-7). A staff member cannot adjust, earn to or redeem from an account linked to their own staff identity (DEC-CRM-15). | MUST | TARGET CAPABILITY — FUTURE DELIVERY; policy DEC-X-7, DEC-CRM-15 | V(05 §3.2, §6)+S (INV-4)+D+K(L228) |
| CRM-23 | Expiry is applied by a scheduled worker under the program version's rule, posting `expire` entries; failures are visible and retryable (00.7 scheduled jobs). Pre-expiry notices are classified as transactional or marketing by DEC-CRM-6 and obey CRM-3 or CRM-4 accordingly. | MUST | TARGET CAPABILITY — FUTURE DELIVERY; policy DEC-CRM-6 | V(05 WF-C3)+E+K(L228) |
| CRM-24 | Tier changes are recorded with effective dates and the program version and evidence that triggered them; a tier never changes without a ledger or rule event. | SHOULD | TARGET CAPABILITY — FUTURE DELIVERY | V(05 §3.2)+K(L228) |
| CRM-25 | Fraud and abuse controls are configurable mechanisms: per-account and per-device earn and redemption velocity limits, anomaly flags with a review queue, account suspension, and blocking of stored-value instruments after repeated failed code lookups. Limits and thresholds are DEC-CRM-15. | MUST | TARGET CAPABILITY — FUTURE DELIVERY; policy DEC-CRM-15 | V(05 §3.2, §3.5)+E+D+K(L228) |
| CRM-26 | Loyalty and stored-value program configuration is versioned with effective dates, validated before activation and audited with before and after values (INV-17, INV-15). | MUST | TARGET CAPABILITY — FUTURE DELIVERY (loyalty configuration; stored-value configuration stays FUTURE with CRM-27) | V(05 §5.9)+E+K(L228) |
| CRM-27 | Stored value is held as append-only transactions in integer minor units with a non-negative balance enforced in the database. Codes are stored only as verifiers and shown in full once at issue. Outstanding liability per organization, venue and currency is available to 07 at any point in time. | MUST | FUTURE | V(05 §3.5)+S (PR-5, INV-6)+E |
| CRM-28 | Redeeming stored value against a check requires a Core tender or settlement path decided under DEC-CRM-10. Until then, no surface accepts stored value as payment. The card path (CARD3, ADR 0002) is not changed by this domain. | MUST | ARCHITECTURE DECISION REQUIRED | S (ADR 0002, §6)+D |
| CRM-29 | Memberships hold no card data (PAY-5); billing references live in adapter metadata (PAY-4); past-due handling and benefit suspension are explicit states. Recurring billing is DEC-CRM-11. | MUST | FUTURE | V(05 §3.3)+S |
| CRM-30 | A segment evaluated for a send is snapshotted (rule version, evaluation time, member identifiers) and the snapshot is retained with the campaign. Reach shown to the operator is the consent-filtered count. | SHOULD | TARGET CAPABILITY — FUTURE DELIVERY | V(05 §3.4, WF-C4)+K(L229) |
| CRM-31 | Campaign sending is resumable and idempotent per recipient: a provider failure mid-send resumes without duplicate delivery; frequency ceilings and quiet hours are enforced at hand-off. Template validation (required fields, unsubscribe link, rendering) blocks scheduling on failure. | MUST | TARGET CAPABILITY — FUTURE DELIVERY; policy DEC-CRM-12 | V(05 WF-C4)+S (INV-12)+E+K(L229) |
| CRM-32 | Campaign attribution is a read-only derived measure using a configured window and method (DEC-CRM-13); it never alters orders, checks or payments. | MUST | TARGET CAPABILITY — FUTURE DELIVERY; policy DEC-CRM-13 | V(05 §3.4)+S (PR-9)+K(L229) |
| CRM-33 | Feedback items are venue-scoped, may link to a visit or reservation, follow the 05.4.10 lifecycle, and can create a task in the operational home (01) by a configured rule. | SHOULD | TARGET CAPABILITY — FUTURE DELIVERY; policy DEC-CRM-14 | V(05 §3.6, WF-C6)+K(L230) |
| CRM-34 | Multi-venue behaviour: profiles, consent and loyalty accounts are organization-scoped; staff see profile data only for customers linked to venues they hold grants for, unless an organization-wide permission is granted (DEC-X-2). Programs and stored value declare their venue scope; redemption outside scope is refused. Cross-organization sharing does not exist. | MUST | TARGET CAPABILITY — FUTURE DELIVERY; policy DEC-X-2 | S (INV-2)+V(05 §2)+K(L343–L346, L602) |
| CRM-35 | A subject-access export assembles all personal data held about a verified subject (profile, attributes with provenance, consent history, transactional contacts, loyalty and stored-value ledgers, feedback) in a machine-readable package, delivered through an access-controlled, expiring channel, with the request and delivery audited. Whether and when this is mandatory is DEC-X-5. | MUST | TARGET CAPABILITY — FUTURE DELIVERY; policy P5 (DEC-X-5), DEC-CRM-17 | V(05 WF-C2)+D (DEC-X-5)+K(L244, L463–L464) |
| CRM-36 | Erasure is performed by anonymisation: personal fields are replaced irreversibly, identity links are detached, contact points are suppressed, and financial, ledger and audit records keep their integrity with personal references removed (INV-11). Treatment of open loyalty and stored-value balances and of records under legal hold is decided with DEC-X-4 and DEC-CRM-9. | MUST | TARGET CAPABILITY — FUTURE DELIVERY; policy P4 (DEC-X-4), DEC-CRM-9 | V(05 §3.1, WF-C2)+S (INV-11)+D (DEC-X-4)+K(L244, L463) |
| CRM-37 | Retention is enforced by scheduled sweeps per data category using periods set by DEC-X-4; each run records counts processed, skipped (with reason, for example legal hold or open balance) and failed. No period is applied before it is approved. | MUST | OWNER DECISION REQUIRED | S (Part B row C, P)+D |
| CRM-38 | Personal data does not appear in logs, telemetry, error responses or domain-event payloads; events and logs carry identifiers only (§20.9, INV-16). | MUST | TARGET | S (§20.9, Part B row C) |
| CRM-39 | Exports of customer lists or reservation guest data require a dedicated export permission, record the purpose, the scope and the row count in the audit record, and are produced only from server-side scoped queries (INV-2). | MUST | TARGET (reservation export) / TARGET CAPABILITY — FUTURE DELIVERY (CRM export) | S (RPT-1 CSV, Part B row C)+E+K(L244) |
| CRM-40 | A customer acting through a self-service surface acts as the customer identity class (INV-3) and can read or change only their own data; this identity never acquires staff authority (WT-4). The surface and its authentication are DEC-CRM-16. | MUST | FUTURE | S (INV-3, WT-4)+D |
| CRM-41 | Customer contact captured for online or pre-ordering (inclusion resolved by owner decision 2026-10-05; O-18 details open) follows the same rules as reservation contact (CRM-1 to CRM-3). | MUST | TARGET CAPABILITY — FUTURE DELIVERY; details O-18 | S (O-18)+K(L195) |
| CRM-42 | A customer's order history is a read-only projection of Core orders, checks, refunds and visits that are linked to the customer's profile by an explicit identity link (05.4.2): a verified-key link from the order's transactional contact, a loyalty or profile identification recorded on the visit or check, or a staff-confirmed link; it is never inferred from name similarity alone. Permitted staff (profile view permission within CRM-34 scope) can view it; the customer can view their own history only where a self-service surface exists (CRM-40, DEC-CRM-16). The projection shows corrections (voids, refunds) as Core records them, states its as-of time, and never alters any order, check or payment. Detaching a link removes the record from the history without changing it; erasure follows CRM-36. Creating a link, recording history or showing it never records, implies or defaults marketing consent or any profiling consent (CRM-1). Bulk reads and exports of history are audited (CRM-39). | SHOULD | TARGET CAPABILITY — FUTURE DELIVERY; policy DEC-CRM-1 | K(L227)+S (PR-2, INV-2)+E |
| CRM-43 | Customer behaviour analytics and segmentation that profile identified customers (for example visit frequency or spend bands, inferred preferences, churn or lifetime-value predictions) run only for customers and purposes for which the consent or lawful-basis rule decided under P4/P5 (DEC-X-4, DEC-X-5, with the profiling purpose of DEC-CRM-3) is satisfied. Until that rule is decided, no profiling of identified customers runs; aggregate, non-identifying analytics remain available through volume 08. Predictions are AI output under INV-21 (labelled, with evidence, time basis and confidence or limitations), computed in `data/` on pseudonymised data (05.8), and never become canonical customer data. A segment built from them still applies the marketing-consent filter at send (CRM-4). Withdrawal of profiling consent excludes the customer from subsequent evaluations and removes them from derived outputs on the next run; maximum delay OWNER TARGET REQUIRED (DEC-CRM-18). | MUST | TARGET CAPABILITY — FUTURE DELIVERY; policy P4/P5, DEC-CRM-3 | K(L598)+S (INV-21)+E+D |

## 05.6 Workflows and failure paths

### 05.6.1 Reservation contact capture and use (CURRENT, hardening TARGET)

1. The guest submits the booking journey (RES-1). Core (or Nest during transition, O-7) validates and stores the reservation and its TransactionalContact atomically; the booking reference is collision-checked.
2. A confirmation email is queued (RES-2). Email delivery state is explicit; a failed send is visible to staff in the Admin Console with a retry action (INV-14). Failure does not roll back the reservation.
3. Staff reading the guest list see contact fields only at venues they hold grants for (CRM-2). A search by email or phone, a bulk read beyond a configured size, or a CSV export writes an audit record (CRM-39).
4. **Failure — duplicate submission:** a retried booking with the same idempotency key returns the original booking (INV-12); no second contact record.
5. **Failure — email provider outage:** messages stay queued with bounded retries (§18.3); after the final attempt they dead-letter with an admin alert (NFR-REL).
6. **Retention:** once the reservation is terminal, its contact becomes eligible for the DEC-X-4 sweep (CRM-37); until that decision exists, nothing is deleted or anonymised automatically.

### 05.6.2 Consent capture and withdrawal (TARGET CAPABILITY — FUTURE DELIVERY)

1. A surface displays the current wording version for a purpose and channel with no option pre-selected.
2. On the customer's action, Core writes a ConsentRecord with evidence (CRM-5) in one transaction with its audit record and event.
3. Withdrawal via link, surface or staff-on-instruction writes a `withdraw` record and a SuppressionEntry; the notifications consumer cancels unsent queued items for that recipient and purpose.
4. **Failure — withdrawal arrives while a campaign is sending:** the send-time check (CRM-4) reads effective consent under the recipient's send record; any send not yet handed to the provider is suppressed with reason `withdrawal`.
5. **Failure — provider unsubscribe webhook replayed:** idempotent on the provider event identifier (§16.11); no duplicate records.
6. **Staff-on-instruction:** recorded with the staff actor and the channel the customer used; the evidence class is visible on the record.

### 05.6.3 Identity resolution, merge and unmerge (TARGET CAPABILITY — FUTURE DELIVERY)

1. A new source record (loyalty enrolment, stored-value purchase with contact, feedback with contact) arrives.
2. Exact match on a verified key (DEC-CRM-2) appends an IdentityLink with method `verified-key`. Otherwise the record is held as a candidate in a review queue with match evidence; no link is made.
3. A permitted user reviews candidates side by side, selects field survivors, gives a reason and confirms. Core locks both profiles in a deterministic order (by identifier) to avoid deadlock, re-points links and ledgers, writes the MergeEvent, audit and event in one transaction (CRM-12).
4. **Concurrency:** a concurrent merge, edit or redemption on either profile fails the version check; the user is shown the conflict and must reload. No partial merge persists (§18.8).
5. **Unmerge** within the window applies compensating re-points (CRM-13). After the window, only manual audited correction is possible.

### 05.6.4 Loyalty earn (TARGET CAPABILITY — FUTURE DELIVERY)

1. A check with a linked loyalty account is settled (D6). The settlement domain event commits with the settlement.
2. The loyalty consumer (at-least-once, INV-13) evaluates the program version in force at settlement time and posts an `earn` entry keyed on (account, check, rule version). A redelivery hits the unique key and is a no-op.
3. Tier evaluation runs on the new balance; a tier change is recorded (CRM-24).
4. **Failure — consumer error:** retries with backoff, then dead-letter with alert; the check and settlement are unaffected. Operators can replay from dead letter (§18.5).
5. **Failure — account suspended at settlement time:** no earn; a skipped-earn record with reason is written for later review, not silently dropped.
6. **Refund (D9):** the refund event produces a `reverse` entry (CRM-19).

### 05.6.5 Loyalty redemption (TARGET CAPABILITY — FUTURE DELIVERY; Core mechanism ARCHITECTURE DECISION REQUIRED)

1. Staff identify the member on the visit (Staff Mode or the POS once specified; DEFERRED for the POS) and request a reward.
2. Core validates program rules, balance and fraud controls under a row lock on the account, posts a `redeem` entry with an idempotency key, and applies the monetary effect through the path decided by DEC-CRM-8. Both commit in one transaction.
3. **Failure — duplicate request:** same key returns the original redemption (INV-12).
4. **Failure — check voided or payment abandoned:** the void or cancellation event posts a compensating `reverse` entry (CRM-20).
5. **Failure — concurrent redemptions on one account:** the second fails the balance check after the lock; the user sees a clear refusal with the current balance.

### 05.6.6 Manual adjustment with approval (TARGET CAPABILITY — FUTURE DELIVERY)

1. A permitted user requests an adjustment with reason code and reference.
2. If above the DEC-X-7 threshold, the request enters the shared approval mechanism (00.7) and the entry is posted only on approval by a different person; otherwise it posts directly.
3. **Self-dealing:** a request on an account linked to the requester's own staff identity is refused (CRM-22).
4. Rejected or expired requests post nothing and remain in the audit trail.

### 05.6.7 Stored value lifecycle (FUTURE)

1. Issue: the sale of stored value is a Core sale (07); on its settlement the instrument is activated with an `issue` transaction; the full code is shown once.
2. Redeem: only through the DEC-CRM-10 path; idempotent; bounded by balance and the check outstanding amount; concurrent redemptions serialised on the instrument row.
3. Repeated failed code lookups from one device or staff identity beyond the DEC-CRM-15 limit block further lookups and raise a review item.
4. Expiry (only if DEC-CRM-9 permits) posts `expire` by scheduled worker; liability changes are reported to 07.

### 05.6.8 Campaign execution (TARGET CAPABILITY — FUTURE DELIVERY)

1. Build segment; preview consent-filtered reach (CRM-30).
2. Compose with a template version; validation must pass (CRM-31); schedule.
3. At send, snapshot the segment; create CampaignSends; for each, check effective consent, suppression and preference at hand-off; hand off idempotently.
4. **Failure — provider outage mid-send:** campaign moves to `paused` with visible counts; resume continues from unsent records with the same keys.
5. Delivery and bounce webhooks update send state idempotently; hard bounces create suppressions (CRM-8).

### 05.6.9 Privacy request handling (TARGET CAPABILITY — FUTURE DELIVERY; policy P4/P5, DEC-CRM-17)

1. A request is logged with requester details; the requester is verified by the DEC-CRM-17 method before any data is released or changed.
2. Access: CRM-35 export. Correction: attribute update with provenance. Erasure: CRM-36 anonymisation in one transaction per subject, with an audit record that names the request but contains no erased values.
3. **Failure — erasure blocked** by an open balance or legal hold: the request moves to `refused` or partial completion with the reason recorded and communicated, per DEC-X-4.

## 05.7 Security, authorization and audit

- **Authorization** follows INV-4. The permission set below is a mechanism; the mapping to Servvia roles (owner, admin, manager, cashier, kitchen, viewer) or candidate roles is DEC-X-2. Fixed constraints that do not depend on DEC-X-2: devices (D8 kinds) and Guest Mode never hold any CRM permission; `kitchen` and `viewer` never read profile, consent or contact data; the reservation guest-data permission is venue-scoped.

| Permission (mechanism) | Covers | Constraint |
|---|---|---|
| Reservation guest data read/edit | Transactional contact on reservations | Venue grant required (CURRENT in Nest) |
| Customer lookup (operational) | Minimal context: dietary flags, loyalty status | Staff Mode only; venue-scoped (CRM-15) |
| Profile view / edit | Full profile | Venue or organization scope (CRM-34) |
| Profile merge / unmerge | 05.6.3 | Reason mandatory |
| Consent record on instruction | Staff-recorded consent or withdrawal | Evidence class `staff-on-instruction` |
| Personal-data export; privacy request handling; erasure | CRM-35 to CRM-37, CRM-39 | Step-up confirmation (INV-4); dual audit (request and execution) |
| Loyalty configure / adjust / approve adjustment | Program versions; adjustments | Approver ≠ requester above threshold (DEC-X-7) |
| Stored value issue / adjust / block | 05.6.7 | Approval above threshold |
| Campaign create / send | 05.6.8 | Send requires a separate permission from create (SHOULD, DEC-X-2) |
| Feedback view / respond | 05.4.10 | Venue scope |

- **Separation of duties:** adjustment approver ≠ requester; staff cannot transact on loyalty or stored value linked to themselves (CRM-22); campaign creation and sending are separable.
- **Audit (INV-15):** every create, change, merge, unmerge, consent record, adjustment, approval, export, privacy action, configuration change and bulk personal-data read. Audit records contain identifiers and changed field names; for Personal fields the before and after values are stored in the audit only if DEC-X-4 permits, otherwise masked.
- **Abuse resistance (§16.10):** rate limits on code lookups, customer lookups by contact value and self-service authentication.
- **Secrets and credentials:** stored-value codes are bearer credentials stored as verifiers (CRM-27); provider credentials follow §16.7.

## 05.8 Data governance

| Data | Class (INV-18) | Access | Logged / exported | Retention |
|---|---|---|---|---|
| Transactional contact (reservation, order) | Personal | Venue-scoped reservation permission | Never in logs; export audited | DEC-X-4 |
| Reservation dietary preferences; profile DietaryNote | Personal (restricted; sensitive sub-class DEC-CRM-4) | Operational lookup permission | Never in logs; never on tickets unless copied to an order by staff | DEC-X-4 |
| Profile attributes and provenance | Personal | Profile view | Export audited | DEC-X-4 |
| ConsentRecord, SuppressionEntry | Personal (evidence) | Profile view; privacy handlers | Export audited | DEC-X-4; evidence retention may outlive the profile as a suppression-only record (decision) |
| Loyalty ledger | Personal + Financial (if value-bearing, DEC-CRM-7) | Loyalty permissions | Export audited | DEC-X-4 and 07 record-keeping |
| Stored-value transactions and liability | Financial | Stored-value permissions; 07 | Liability to 07 | 07 record-keeping (DEC-X-5) |
| Stored-value code verifier | Confidential (verifier; full code never stored) | System only | Never logged | Life of instrument |
| Campaign sends and attribution | Personal (sends); Internal (aggregates) | Campaign permissions | Aggregates to 08 | DEC-X-4 |
| Feedback text | Personal | Feedback permission | Export audited | DEC-X-4 |

- **Ownership:** organization owns its customer data; Servvia processes it on the organization's behalf. Formal controller/processor terms are DEC-X-5.
- **Minimisation:** a field is collected only when a committed capability uses it (Part B row C). Birthday, gender, and similar fields are not collected unless a decided capability needs them.
- **Corrections:** profile attributes are corrected by new assertions; ledgers by compensating entries; consent by new records (INV-11).
- **Imports:** a bulk import of customer data records batch, source and the declared lawful basis for each consent field; imported consent without evidence is stored as "not granted".
- **Analytics:** 08 receives pseudonymised identifiers; re-identification requires the CRM permission.

## 05.9 Reliability, scalability and observability

- **Hot-path isolation:** CRM processing never blocks order submission, kitchen release, payment or settlement. Earn, attribution and campaign work run in Core workers (D13). If redemption is introduced into checks (DEC-CRM-8), its latency counts toward the order and check targets of SPRD §19 (O-19).
- **Delivery semantics:** consumers are idempotent; dead letters alert (NFR-REL). Campaign sends are resumable (CRM-31).
- **Capacity dimensions** (targets DEC-X-8): profiles per organization, ledger entries per day, campaign recipients per send, send throughput per provider limit.
- **Signals:** earn-consumer lag and dead-letter count; redemption error rate by code; skipped-earn count; merge-queue size and age; consent withdrawals pending suppression and oldest age; campaign send state counts; provider error rate; retention-sweep outcomes; failed code lookups and blocked instruments. Alert thresholds: OWNER TARGET REQUIRED (§20.7).
- **Recovery:** loyalty and stored-value balances are rebuildable from their ledgers; a rebuild-and-compare check runs on schedule and alerts on divergence.

## 05.10 UX and accessibility

- Admin Console CRM workspaces meet WCAG 2.1 AA (NFR-A11Y); Customer Website consent and enrolment meet WEB-4 (44 px targets, 16 px text). Waiter Tablet and Kiosk targets: OWNER TARGET REQUIRED (§23).
- Consent controls: plain-language purpose, channel, unticked by default, withdrawal path visible, wording version identifiable.
- Staff Mode customer context shows allergen and dietary flags with a clear "customer-stated, advisory" label and last-confirmed date; it never presents profile data as an order declaration.
- Every screen provides the §22 states. Balance and redemption show pending and uncertain states explicitly (INV-14). Destructive actions (merge, erasure, adjustment, block) require confirmation with consequence text.
- Privacy-request screens show due date and verification status.

## 05.11 Acceptance criteria

| ID | Criterion | Covers |
|---|---|---|
| AC-CRM-1 | Given a reservation created through the booking journey, then no consent record exists for that contact, no profile is created (unless DEC-CRM-1 permits and records it), and no marketing audience includes the contact. | CRM-1, CRM-10 (happy, invariant) |
| AC-CRM-2 | Given a manager with a grant for venue A only, when they request reservation guest data for venue B by identifier or list filter, then the request is refused, no data is returned, and the refusal is logged. | CRM-2 (authz) |
| AC-CRM-3 | Given a staff member exports reservation guests, then an audit record contains actor, venue scope, purpose and row count, and the file contains only in-scope rows. | CRM-39 (audit) |
| AC-CRM-4 | Given a recipient withdraws consent after a campaign is scheduled but before their send is handed off, then their send ends `suppressed(withdrawal)` and the provider receives nothing for them. | CRM-4, CRM-6 (concurrency) |
| AC-CRM-5 | Given a consent form, then no option is pre-selected; submitting writes one ConsentRecord with wording version, surface, time and identity class; a replayed submission with the same key writes nothing new. | CRM-5 (happy, retry) |
| AC-CRM-6 | Given a hard bounce on an email address shared by two profiles, then both are suppressed for that channel and only a new customer consent can lift it. | CRM-8 |
| AC-CRM-7 | Given two profiles matching only on a normalised name and phone with one digit different, then no link or merge happens and a review candidate is created. | CRM-11 (invalid) |
| AC-CRM-8 | Given a merge is confirmed while another user edits the source profile, then exactly one succeeds; the other receives a version-conflict error and no partial re-pointing exists. | CRM-12 (concurrency) |
| AC-CRM-9 | Given an unmerge within the window, then the source profile, its links and its pre-merge ledger ownership are restored by compensating records, and both events are in the audit trail. | CRM-13 (recovery, audit) |
| AC-CRM-10 | Given the Waiter Tablet in Guest Mode, when any customer-lookup or profile endpoint is called with its credential, then the server refuses it regardless of client UI. | CRM-15 (authz, WT-4) |
| AC-CRM-11 | Given a KDS ticket for a visit with an identified customer holding a profile allergen note, then the ticket shows only order-line notes; the note appears only if staff explicitly added it to the order. | CRM-15 |
| AC-CRM-12 | Given a settled check linked to a loyalty account, when the settlement event is delivered twice, then exactly one earn entry exists. | CRM-18 (duplicate) |
| AC-CRM-13 | Given the earn consumer fails repeatedly, then the event dead-letters with an alert, the check and settlement are unaffected, and replay after repair posts exactly one earn. | CRM-18 (dependency failure, recovery, observability) |
| AC-CRM-14 | Given a partial refund of an earned check, then a `reverse` entry referencing the original earn is posted for the refunded basis, and the balance equals the sum of entries. | CRM-17, CRM-19 |
| AC-CRM-15 | Given two simultaneous redemptions that together exceed the balance, then exactly one succeeds and the other is refused with the current balance; no negative balance results. | CRM-20 (concurrency) |
| AC-CRM-16 | Given an attempt to update or delete a ledger entry directly in the database, then the database rejects it. | CRM-17 (invariant) |
| AC-CRM-17 | Given a manual adjustment above threshold, when the requester attempts to approve it, then approval is refused; when a different authorised user approves, exactly one entry posts. A request on the requester's own linked account is refused at creation. | CRM-22 (SoD) |
| AC-CRM-18 | Given a stored-value instrument, then the full code is returned only in the issue response and never appears in list responses, logs, audit or events. | CRM-27 (security) |
| AC-CRM-19 | Given repeated failed code lookups beyond the configured limit from one device, then further lookups are blocked and a review item is created. | CRM-25 |
| AC-CRM-20 | Given a campaign whose provider fails after half the sends, when resumed, then every recipient receives at most one message and send counts reconcile. | CRM-31 (dependency failure, retry) |
| AC-CRM-21 | Given an erasure of a subject with settled checks and an earned ledger, then personal fields are anonymised, checks and ledger totals are unchanged, contact points are suppressed, and the audit names the request without erased values. | CRM-36 (once DEC-X-4 decided) |
| AC-CRM-22 | Given any CRM domain event or log line, then it contains no email, phone, name or note text. | CRM-38 (observability, privacy) |
| AC-CRM-23 | Given a customer self-service credential, when it calls any staff endpoint, then the call is refused. | CRM-40 (authz) |
| AC-CRM-24 | Given an online order whose contact matches a profile's verified key, and a second order matching only by name, when permitted staff view the profile's order history, then only the first order appears, with its later refund and the projection's as-of time; no consent record was created by the link; a staff member without profile view permission, or without a grant for the order's venue (CRM-34), is refused. | CRM-42 (happy, invalid, authz, privacy) |
| AC-CRM-25 | Given the P4/P5 profiling rule is undecided, then no profiling segment or prediction is computed for identified customers; given it is decided and a customer withdraws profiling consent, then the next run excludes them and their derived outputs are removed, and no marketing send uses a profiling segment without the CRM-4 consent check. | CRM-43 (invariant, privacy) |

## 05.12 KPIs and metric definitions

| KPI | Definition | Target |
|---|---|---|
| Identified-check rate | Settled checks linked to a loyalty account or profile ÷ all settled checks, per venue and business date (INV-8) | OWNER TARGET REQUIRED (DEC-CRM-18) |
| Repeat-visit rate | Profiles with ≥ 2 visits in the period ÷ profiles with ≥ 1 visit in the period; visit = distinct TableSession or reservation-seated event linked to the profile | OWNER TARGET REQUIRED (DEC-CRM-18); Verdura cohort windows 30/90/180 days: proposed (Verdura evidence) |
| Consent coverage | Profiles with effective marketing consent for at least one channel ÷ active profiles | OWNER TARGET REQUIRED |
| Send-time suppression rate | Sends ending `suppressed` ÷ planned sends, by reason | OWNER TARGET REQUIRED |
| Withdrawal-to-suppression latency | Time from withdrawal record to suppression of all pending sends, P95 | OWNER TARGET REQUIRED (CRM-6) |
| Loyalty participation | Settled checks with a linked active account ÷ settled checks | OWNER TARGET REQUIRED |
| Outstanding loyalty value | Sum of balances in program units; monetary equivalent only if DEC-CRM-7 defines one | Reporting only |
| Adjustment and fraud-flag rate | Manual adjustments and anomaly flags per 1,000 ledger entries | OWNER TARGET REQUIRED |
| Stored-value outstanding liability | Sum of non-negative instrument balances per currency at an instant; reconciled to 07 | Reconciliation difference target: OWNER TARGET REQUIRED |
| Campaign attributed revenue | Settled check totals matched to sends within the DEC-CRM-13 window; incrementality only against a control group | Verdura default window 14 days: proposed (Verdura evidence) — DEC-CRM-13 |
| Feedback time-to-action | Time from `new` to `actioned` for items under the negative threshold, median | OWNER TARGET REQUIRED |
| Privacy request completion time | Time from `verified` to `completed`, per type | Legal or owner period: DEC-X-5 |

All KPIs are computed by 08 from Core records with the stated time basis; no KPI target is approved.

## 05.13 Open decisions

| ID | Decision | Why it matters | Options evidenced | Blocks | Tier |
|---|---|---|---|---|---|
| DEC-CRM-1 | **Inclusion resolved by DEC-X-1 (owner 2026-10-05):** customer profiles with order history are in the long-term target product. Still open (policy): what may create a profile (loyalty enrolment, customer account, staff creation, transactional contact), on which recorded basis, and its identity keys (email, phone, both; verification required). Inclusion never implies marketing consent | Determines lawful basis and data volume | Verdura: profile from every identified transaction (evidence); minimal: profile only on explicit enrolment | CRM-9, CRM-10, CRM-42, all profile work | 3 |
| DEC-CRM-2 | Identity-resolution policy: verified keys for auto-link, attribute source precedence, unmerge window, handling of two loyalty accounts in one program on merge | Wrong merges expose one person's data to another | Verdura: exact → fuzzy candidates → review; reversible window (evidence) | CRM-11 to CRM-13 | 3 |
| DEC-CRM-3 | Consent purpose and channel taxonomy; wording ownership and approval; confirmed (double) opt-in or single | Evidence quality; regime fit (DEC-X-5) | Verdura purposes: marketing email, marketing SMS, profiling, loyalty terms (evidence) | CRM-4 to CRM-6 | 3 |
| DEC-CRM-4 | Classification and visibility of dietary and allergen notes: Personal-restricted or a sensitive sub-class; which roles see them | Health-adjacent data; minimal exposure | Verdura: line staff see allergen context only (evidence) | CRM-14, CRM-15 | 3 |
| DEC-CRM-5 | Whether free-text staff notes on profiles are permitted, and content rules | Free text is the main source of inappropriate personal data | Structured-only; free text with review | CRM-14 | 3 |
| DEC-CRM-6 | Loyalty program model and economics: points, visits or tiers; earn basis (tax, discounts, service charges, tips); earn and burn rates; rewards; expiry; negative balances after refund; whether pre-expiry notices are transactional | Liability, margin and customer fairness | Verdura evidence only; no Servvia value | CRM-18, CRM-19, CRM-23 | 3 |
| DEC-CRM-7 | Accounting treatment of loyalty value (liability or none) and its reporting to 07 | Financial statements | Links to 07 accounting decisions | Value-bearing programs | 3 |
| DEC-CRM-8 | How a loyalty redemption affects a check in Core: a D11 promotion/discount application or a tender | Pricing authority and tax effect | D11 frozen AppliedPromotion snapshot exists; tender types are card and cash today | CRM-21 | 2 |
| DEC-CRM-9 | Whether to offer stored value; products; expiry, refundability, breakage policy and jurisdictional constraints | Financial liability; regulatory exposure (DEC-X-5) | Verdura: jurisdiction-configurable expiry (evidence) | CRM-27, CRM-36 | 3 |
| DEC-CRM-10 | Stored value as a Core tender (new tender type, settlement rules, refund-to-stored-value) without changing CARD3 | Payments architecture | Core tender types card and cash (D6, D7) | CRM-28 | 2 |
| DEC-CRM-11 | Memberships: scope (3) and recurring billing architecture through a provider adapter (2) | Recurring billing is outside the in-person card architecture | Verdura: provider-tokenised billing with dunning (evidence) | CRM-29 | 3 / 2 |
| DEC-CRM-12 | Frequency ceilings, quiet hours, sender identities per organization or venue (channels and providers are DEC-X-15) | Customer experience and deliverability | — | CRM-31 | 3 |
| DEC-CRM-13 | Attribution window and match methods | Reported ROI | Verdura default 14 days (proposed, Verdura evidence) | CRM-32 | 3 |
| DEC-CRM-14 | Feedback sources, review-platform integrations and the negative-feedback task rule | Integration scope and workload | Verdura: rating threshold creates a task (evidence) | CRM-33 | 3 |
| DEC-CRM-15 | Fraud and abuse thresholds: velocity limits, code-lookup limits, staff self-dealing rule scope, suspension policy | Abuse resistance without blocking genuine customers | Verdura heuristics (evidence) | CRM-22, CRM-25 | 3 |
| DEC-CRM-16 | Customer self-service: authenticated portal, Guest Mode or kiosk self-identification, wallet passes; customer authentication method | Introduces a customer credential class at scale | Verdura roadmap (evidence) | CRM-15, CRM-40 | 3 / 2 |
| DEC-CRM-17 | Privacy-request handling: responsible role, requester-verification method, response periods | Wrong release of personal data | Links DEC-X-4, DEC-X-5 | CRM-35, CRM-36 | 3 |
| DEC-CRM-18 | CRM and loyalty KPI targets and the withdrawal-to-suppression latency target | Acceptance and monitoring | Verdura KPI list (evidence) | 05.12 targets | 3 |

Also referenced, not duplicated: DEC-X-1 (scope inclusion, resolved 2026-10-05), DEC-X-17 (delivery phasing), DEC-X-19 (autonomous AI actions), DEC-X-2 (roles), DEC-X-4 (retention and erasure), DEC-X-5 (regimes), DEC-X-7 (approval thresholds), DEC-X-8 (capacity), DEC-X-13 (Core ownership), DEC-X-15 (channels), DEC-X-16 (analytical separation), O-7 (reservations in Core), O-18 (online ordering).

## 05.14 Future and deferred capabilities

| Capability | State | Precondition |
|---|---|---|
| Customer profile, identity resolution, merge, order history | TARGET CAPABILITY — FUTURE DELIVERY | DEC-X-17; DEC-CRM-1, DEC-CRM-2; DEC-X-13 residual package decision |
| Marketing consent, preferences, segmentation, campaigns | TARGET CAPABILITY — FUTURE DELIVERY | DEC-X-17; DEC-CRM-3, DEC-X-15, P4/P5 |
| Customer behaviour analytics and profiling (CRM-43) | TARGET CAPABILITY — FUTURE DELIVERY | DEC-X-17; P4/P5 consent or lawful-basis rule; 08 |
| Loyalty programs (points and rewards) | TARGET CAPABILITY — FUTURE DELIVERY | DEC-X-17; DEC-CRM-6 to DEC-CRM-8 |
| Stored value and gift cards | FUTURE | DEC-CRM-9, DEC-CRM-10, 07 liability reporting |
| Memberships and subscriptions | FUTURE | DEC-CRM-11 |
| Feedback capture and analysis (CRM-33), including review-platform ingestion | TARGET CAPABILITY — FUTURE DELIVERY | DEC-X-17; DEC-CRM-14 |
| Privacy tooling: subject access, erasure, portability (CRM-35, CRM-36) | TARGET CAPABILITY — FUTURE DELIVERY | DEC-X-17; P4/P5; DEC-CRM-17 |
| Customer self-service portal; wallet passes | FUTURE | DEC-CRM-16 |
| Predictive churn and next-best-action | Churn prediction: TARGET CAPABILITY — FUTURE DELIVERY under CRM-43 (prediction, INV-21); next-best-action recommendations: FUTURE | P4/P5; 08 forecasting; analytics in `data/` outside the transaction path |
| Referral programs | FUTURE | Loyalty committed; Verdura unlock "participation > 25 %" is proposed (Verdura evidence) only |
| Two-way review response publishing | FUTURE | Provider API access; DEC-CRM-14 |
| Cross-brand customer sharing | Not permitted across organizations (INV-2); within one organization it is DEC-CRM-1 scope | — |
