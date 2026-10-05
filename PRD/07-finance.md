# Servvia PRD — Volume 07: Finance

> **Status:** Normative Servvia domain volume, version label **v5.1 (Servvia)**, last updated 2026-10-05.
> **Authority:** subordinate to [`product-requirements.md`](product-requirements.md) ("SPRD"), which wins on any conflict, and to the conventions, invariants (INV-n) and cross-cutting decisions (DEC-X-n) of [`00-overview-and-conventions.md`](00-overview-and-conventions.md).
> **Provenance:** Servvia baseline (SPRD §1, §5, §6, §11, §13, §17; ADR 0001; ADR 0002; decisions log), verified Core reality for CURRENT and implemented-state statements (`docs/migration/` D5, D6, D7, D9, D10, D11; `contracts/openapi/` checks, payments, shifts, refunds), and enterprise hardening (SPRD Part B). Ledger, period and accounting-boundary mechanisms were mined from the Verdura v5.2 PRD Volume 07 as **non-authoritative source material**; the per-item classification is held in the 2026-10-05 handoff evidence (`matrix-07-finance.md`).
> **KitchenOS (owner decision 2026-10-05, DEC-X-1):** the finance capabilities KitchenOS describes (bill splitting and merging, card, cash and digital-wallet payments, split payments, a real-time P&L view, accounting-software integration, tax reporting) are owner-approved long-term capabilities, labelled `TARGET CAPABILITY — FUTURE DELIVERY` unless SPRD already commits them; delivery phase is DEC-X-17. KitchenOS vendors, the UK-only tax framing and its compliance assertions are not adopted (00.3, INV-22). Servvia's own ledger, payables and receivables are not KitchenOS-described and stay DEFERRED.
> **Superseded source thesis:** Verdura's "the POS is the fiscal authority and Finance only ingests POS facts" does not apply. **Servvia Core owns** checks, payments, tenders, settlement, refunds, reversals, settlement revocation, shifts and cash (SPRD §1, §5). Card success comes only from the trusted payment adapter through Venue Edge (CARD3, ADR 0002); this volume does not redesign that path.
> **Windows POS:** cashier screens, payment UX, shift and cash-management workflows on the POS are **PENDING USER POS ANALYSIS REPORT** (SPRD §12). This volume specifies the Core financial domain only.
> **Acceptance:** **NORMATIVE BASELINE ACCEPTED 2026-10-05** (SERVVIA PRD NORMATIVE BASELINE ACCEPTED; record in volume 00 §00.1.3). This volume is a normative refinement of [`product-requirements.md`](product-requirements.md), which wins on any conflict. Acceptance does not commit future-delivery capabilities to a release, select open policy values, approve production or release, or certify compliance.

## 07.1 Purpose, scope and state

Finance in Servvia has two layers:

1. **The financial core of the service day** (committed scope): the obligation (check), its satisfaction (payments, settlement), its correction (refunds, reversals, revocation), cash accountability (shifts), financial completeness of the visit, the money effect of promotions and tax, and reconciliation of those facts against providers and counted cash (SPRD §6, §11, §17).
2. **The accounting layer** (deferred): ledger, journals, periods, payables, receivables, bank reconciliation and accounting-system exchange. SPRD §13 defers the finance sub-ledger. This volume defines its mechanisms so that the financial core produces facts an accounting layer can later consume without rework, and exposes every accounting policy as an owner decision. **Exception (owner 2026-10-05):** exchange with an external accounting system (FIN-48) is an owner-approved target capability; whether Servvia also keeps its own ledger stays open (DEC-FIN-1).
3. **Owner-approved finance capabilities not yet committed** (`TARGET CAPABILITY — FUTURE DELIVERY`, DEC-X-1; phase DEC-X-17): check split, line move and merge (FIN-5, FIN-51), wallet tenders (FIN-52), the operational P&L view (FIN-53, metrics in volume 08), jurisdiction tax reporting (FIN-54), accounting integration (FIN-48) and multi-location finance (DEC-FIN-17). Their business policies stay with their own decisions.

Implemented Core phases are **tested on disposable databases only, not applied to production and used by no client** (00.4.3). They are labelled `TARGET` with "implemented in Core, not in production".

| Capability | State | Basis |
|---|---|---|
| Checks over a visit's unbilled lines; void (D5) | TARGET (implemented in Core, not in production) | S (ORD-5, SPRD §5) |
| Card tender with result only from the trusted payment adapter device (D6, D8) | TARGET (implemented in Core, not in production) | S (PAY-1, PAY-4, PAY-6, ADR 0002) |
| Several tenders per check (split tender, FIN-55) | TARGET (implemented in Core, not in production) | S (PAY-1, §17.3)+K(L439) |
| Wallet tenders: card-present through the trusted adapter (CARD3), online through the online payment provider (FIN-52) | TARGET CAPABILITY — FUTURE DELIVERY; provider O-3, online scope O-18 | K(L220, L438) |
| Cash tender within a shift (D7) | TARGET (implemented in Core, not in production) | S (PAY-1, SPRD §11) |
| Settlement, revocation and re-settlement (D6, D9) | TARGET (implemented in Core, not in production) | S (§17.2) |
| Refunds and adapter-originated reversals (D9) | TARGET (implemented in Core, not in production) | S (PAY-7, §17.2) |
| Visit close gated on financial completeness (D10) | TARGET (implemented in Core, not in production) | S (SPRD §11) |
| Promotion discount effect, frozen snapshot (D11) | TARGET (implemented in Core, not in production) | S (PR-3, ORD-2) |
| Tax and totals computed by Core (NZ GST-inclusive profile) | TARGET (implemented in Core, not in production); fail-closed for other profiles | S (ORD-2, ORD-4, PR-5) |
| Online or prepaid payment verification (PAY-2, PAY-3) | TARGET where online payment is enabled (scope O-18); not implemented in Core | S |
| Reconciliation: payments vs provider, cash vs shift, reconciliation queue | TARGET; uncertain-outcome resolution path implemented in Core, queue not built | S (§17.10, §17.12) |
| Receipts and tax invoices | OWNER DECISION REQUIRED (O-5); no receipt package in Core | S (REC-1) |
| Business date and day close | Business date: TARGET (rule decided, P3, 00.10.5; not in Core). Day-close rules: OWNER DECISION REQUIRED (O-6, DEC-FIN-10) | S+A+D |
| Tips, gratuities, service charges | OWNER DECISION REQUIRED (DEC-FIN-6, DEC-FIN-7); not modelled | D |
| Split checks, line transfer and check merge (FIN-5, FIN-51) | TARGET CAPABILITY — FUTURE DELIVERY; mechanism DEC-FIN-19, policy DEC-FIN-15; Windows POS UX PENDING USER POS ANALYSIS REPORT (P12) | D+K(L18, L198) |
| Comps, check-time manual discounts | FUTURE; POS behaviour PENDING USER POS ANALYSIS REPORT | D |
| Operational P&L view (FIN-53; metrics in volume 08) | TARGET CAPABILITY — FUTURE DELIVERY; depends on volumes 03 and 06 | K(L219, L325) |
| Jurisdiction tax reporting from stored tax (FIN-54) | TARGET CAPABILITY — FUTURE DELIVERY; tax policy DEC-FIN-3, regimes DEC-X-5, pack validation P5 | K(L222, L455) |
| Multi-location finance views across venues | TARGET CAPABILITY — FUTURE DELIVERY; legal-entity and consolidation structure DEC-FIN-17 | K(L343–346) |
| Cash movements beyond sale and refund (paid-in, paid-out, drops, change, denominations) | FUTURE; POS behaviour PENDING USER POS ANALYSIS REPORT | V(07 §3.7)+D |
| Chargebacks and disputes | FUTURE | D |
| Ledger, journals, posting rules, accounting periods and close | DEFERRED (SPRD §13 finance sub-ledger) | V(07 §3.1–3.4)+D |
| Payables, receivables, payment runs, dunning, house accounts | DEFERRED (SPRD §13) | V(07 §3.5–3.6) |
| Bank feeds, takings and bank reconciliation, provider payouts and fees | DEFERRED (SPRD §13) | V(07 §3.7) |
| Accounting-system export adapters (FIN-48) | TARGET CAPABILITY — FUTURE DELIVERY; own ledger alongside it DEC-FIN-1 | V(07 §3.9)+S (INV-19)+K(L221, L444–447) |
| Nest legacy financial paths: kiosk card intent, "Close Table" without money, unused reservation `Payment` model, external-POS payment observation | TRANSITIONAL (retire, SPRD §34.2) | S |

**Known transitional defect (stabilisation track, not ported):** the Nest kiosk card path can capture a card before a failed amount check and never refunds it (D6 audit). Canonical Core records every tender before money can move (FIN-11).

## 07.2 Actors and surfaces

| Actor (INV-3 class) | Financial capability | Basis |
|---|---|---|
| Owner (staff) | All financial data; every Core financial action; refunds; voids; promotions | S (SPRD §3) |
| Admin (staff) | As owner for financial actions in Core today | S [REPO] |
| Manager (staff) | Create checks and tenders, void checks, refund, close any shift at the venue, manage promotions | S [REPO] |
| Cashier (staff) | Create checks, tender card and cash, open and close own shift, read payments; **no** refunds or voids | S [REPO] |
| Waiter (staff, on a staff-elevated tablet) | Financial actions only within the elevated staff identity's role (O-20); an unelevated `tablet_device` is refused | S (WT-4, WT-5, SPRD §32) |
| Kitchen, viewer (staff roles) | No financial action (refused) | S [REPO] |
| Customer, guest, Guest Mode | No settlement capability; never staff authority (WT-4, ADR 0002) | S |
| Trusted payment adapter (device kind `payment_adapter`, venue-bound, D8) | Report card payment and card refund results; originate reversals | S (CARD3, ADR 0002) |
| Venue Edge (device) | Hosts the payment terminal and future cash drawer (EDGE-1); never a source of business truth | S |
| System workers (D13) | Reconciliation sweeps, scheduled reports, future posting (no human authority) | S+E |
| External accountant, finance role | Candidate roles only (DEC-X-2) | V(07 §6)+D |

| Surface | Financial role | State |
|---|---|---|
| Web Order Tablet, Staff Mode (Admin Console build mode) | Temporary settlement surface of the reduced first pilot, within the minimum settlement boundary of ADR 0002 item 8 | TRANSITIONAL |
| Waiter Tablet, Staff Mode (Android) | Staff-operated settlement where O-1 permits, under staff authorization per O-20 (00.10.6); Guest Mode never settles | TARGET (scaffold) |
| Windows POS | Main terminal for payments, shifts and cash | DEFERRED (PENDING USER POS ANALYSIS REPORT) |
| Admin Console | Financial oversight: checks, payments, refunds, shifts, reconciliation queue, day close, reports (volume 08) | TARGET; financial views today call Nest |
| Kiosk (Android) | Customer card payment flow is not defined; KSK-4 forbids storing or queueing card data | TARGET (scaffold); payment flow D |
| Customer Website | Online or prepaid payment only if O-18 enables it (PAY-2) | OWNER DECISION REQUIRED (O-18) |

## 07.3 Domain model and ownership

```text
TableSession (visit, internal/tables)
  └─(N) Order ─(N) Round ─(N) OrderItem [immutable priced snapshot, discountCents, appliedPromotionId]
                    └─(0..1) AppliedPromotion [frozen promotion snapshot]
Check (internal/checks) ─(N) CheckLine [copy of OrderItem snapshot; billed at most once while standing]
  ├─(N) CheckPayment (internal/payments) [tender: card or cash] ─(N) CheckPaymentTransition
  │       └─(N) PaymentAdjustment (internal/refunds → internal/payments) [refund or reversal]
  │               └─(N) PaymentAdjustmentTransition
  └─(0..1 current) CheckSettlement [status settled/revoked, cycle] ─(N) CheckSettlementTransition
Shift (internal/shifts) ─(N) CashMovement [cash_sale → payment, cash_refund → adjustment]
Shift ─(0..1) Terminal (internal/devices today, D8)
Device payment_adapter (D8) → reports results for its venue only
AuditLog (staff actors, same transaction)

Not yet created (TARGET): Receipt, ReconciliationItem, BusinessDate assignment and DayClose, ProviderSettlementRecord
TARGET CAPABILITY — FUTURE DELIVERY: check split/move/merge records (mechanism DEC-FIN-19), ExportBatch (FIN-48),
          tax report runs (FIN-54)
DEFERRED: LedgerAccount, JournalEntry, JournalLine, AccountingPeriod, PostingRule, PostingException,
          PayableInvoice, PaymentRun, ReceivableInvoice, BankTransaction
```

| Entity | Canonical owner | State |
|---|---|---|
| Check, CheckLine | Core `internal/checks/` | Implemented, not in production |
| CheckPayment, transitions, CheckSettlement, settlement transitions | Core `internal/payments/` | Implemented, not in production |
| PaymentAdjustment and transitions | Core `internal/refunds/` today; target `internal/payments/` (consolidate later, behaviour unchanged, SPRD §30.3) | Implemented, not in production |
| Shift, CashMovement | Core `internal/shifts/`; target also `internal/cash-management/` | Implemented (partial), not in production |
| AppliedPromotion, discount fields | Core `internal/orders/`, `internal/promotions/`, pricing in `internal/pricing/` | Implemented, not in production |
| Tax computation | Core `internal/pricing/` (target split `internal/menu/taxes/`); never a second implementation | Implemented, not in production |
| Receipt | Core `internal/receipts/` (not created) | TARGET; content O-5 |
| ReconciliationItem, DayClose | No package (DEC-X-13) | TARGET / OWNER DECISION REQUIRED |
| Ledger, periods, payables, receivables, bank | No package (DEC-X-13) | DEFERRED |
| Nest legacy financial paths | `apps/api/` | TRANSITIONAL, retire |

## 07.4 Business objects and lifecycles

### 07.4.1 Check

- **Fields that matter:** venue, optional table session, status, currency, subtotal (gross, GST-inclusive), discount, total, contained tax, version, idempotency key and request fingerprint, created-by, void reason and actor.
- **Lifecycle:** `open` → `settled` (balance reaches zero by succeeded money) → `open` (settlement revoked by a succeeded adjustment) → `settled` (next cycle). `open` → `voided` (terminal), allowed only when no payment or adjustment is pending or uncertain and effective paid is zero.
- **Invariants:** total = subtotal − discount, and subtotal and discount equal the sums of the lines (§17.2); tax is the Core-computed contained tax of the total; an order line is on at most one standing (non-voided) check (partial unique index); a check never re-evaluates prices or promotions; later rounds are never appended (INV-10, INV-11).

### 07.4.2 Payment (tender)

- **Fields:** check, amount (> 0), currency (= the check's), tender type (`card`, `cash`), status, version, idempotency key and fingerprint, requested-by staff, opaque result reference (adapter metadata only), resolved-at, shift (cash).
- **Lifecycle:** card: `pending` → `succeeded` / `failed` / `uncertain`; `uncertain` → `succeeded` / `failed`. Cash: `succeeded` at creation (staff accepting physical cash is the result). `succeeded` and `failed` are final.
- **Balance (computed by Core under the check lock):** paid = Σ succeeded payments; held = Σ pending and uncertain payments; effective paid = paid − Σ succeeded adjustments; balance = total − effective paid; available = total − effective paid − held (the D6 hold rule, using the D9 effective-paid figure).
- **Invariants:** a new tender must fit `available`; `uncertain` is never failed automatically, never retried and never settles (PAY-6, §17.12); every transition is appended to the payment's history with actor and actor kind.

### 07.4.3 Settlement

- **Fields:** check, cycle, amount, settling payment or adjustment, status (`settled`, `revoked`), actor, time, version.
- **Lifecycle:** created `settled` (cycle 1) in the transaction of the success that brings effective paid to the total; `settled` → `revoked` in the transaction of a succeeded adjustment that brings effective paid below the total; `revoked` → `settled` with cycle + 1.
- **Invariants:** one current settlement row per check; one settlement per check cycle (§17.2); every settled and revoked event is an append-only transition. A zero-total check cannot settle (D11 refuses promotions that would create one).

### 07.4.4 Adjustment (refund or reversal)

- **Fields:** payment, kind (`refund`: staff-requested; `reversal`: adapter-originated), amount (> 0), currency (= the payment's), status, version, idempotency key and fingerprint, reason (refund), requested-by staff (refund), originating device (reversal), result reference, resolved-at.
- **Lifecycle:** the payment state machine. Card refund starts `pending`; cash refund and reversal are `succeeded` at creation.
- **Invariants:** refundable capacity per payment = amount − Σ adjustments in `succeeded`, `pending` or `uncertain`; applies only to a succeeded payment; decided under the check lock then the payment lock; failed adjustments release capacity; refunds never exceed the captured amount (§17.2). A refund never reprices.

### 07.4.5 Shift and cash movement

- **Shift fields:** venue, responsible staff, status (`open`, `closed`), currency, opening float (≥ 0), optional terminal, open request key, version; at close: counted, expected and variance, closer, time.
- **Lifecycle:** `open` → `closed`. At most one open shift per (venue, staff).
- **Cash movement:** kind `cash_sale` (references the payment) or `cash_refund` (references the adjustment), positive amount, staff actor. Expected cash = opening float + Σ cash sales − Σ cash refunds. Variance = counted − expected, enforced by a database check and stored, never taken from a client and never recomputed afterwards. Card money never touches a shift.

### 07.4.6 Visit financial completeness

A visit (TableSession) may close only when four counts are zero: open standing checks, unbilled accepted round lines of non-cancelled orders, unresolved (pending or uncertain) payments, unresolved adjustments (D10). Kitchen state and order status are not consulted. After close, existing checks remain correctable (payment results, refunds, reversals, re-settlement, voids); the session is never reopened by money.

### 07.4.7 Applied promotion

A frozen snapshot per round (promotion id and version, name, kind, basis points, eligible subtotal, discount), with the discount allocated to eligible lines by largest remainder. Contained GST is computed on the discounted total. Nothing reads the live promotion after acceptance (INV-11).

### 07.4.8 Target objects not yet built

- **ReconciliationItem:** type (payment-vs-provider mismatch, stuck or uncertain outcome beyond age, cash variance, missing provider record, unexpected provider record), source references, amount and currency, venue, business date, opened-at, assigned owner, state `open` → `resolved` (resolution type, reason, actor, linked compensating record if any) or `open` → `accepted` (difference accepted with reason under DEC-X-7 authority). Items are never deleted.
- **DayClose:** venue, business date, state `open` → `closing` → `closed`, readiness snapshot, frozen summary reference, actor. Rules: DEC-FIN-10 and O-6; business date per P3 (00.10.5), independent of close.
- **Receipt:** reproduces the Core-recorded amounts of a check, its payments and tax; reprints are marked copies and audited; content per O-5.

### 07.4.9 Deferred accounting objects (mechanisms only)

- **JournalEntry:** lines (account, venue dimension, debit or credit in minor units, currency), source (`system` with a source-record reference, or `manual` with creator, memo and attachments), period. Lifecycle `draft` → `posted`; a posted entry is immutable and is corrected only by a linked reversing entry (INV-11).
- **AccountingPeriod:** `open` → `closing` (authorised adjustments only) → `closed` (postings refused); a late correction posts to the next open period with a cross-reference visible on both.
- **PostingRule:** versioned, effective-dated mapping from a Core financial fact class to accounts; an unmapped fact goes to a posting-exception queue, never to a default account.

## 07.5 Requirements

| ID | Requirement | Priority | State | Basis |
|---|---|---|---|---|
| FIN-1 | A check bills only accepted round lines of Servvia Core orders of one visit (or of explicitly named orders) that no standing check holds, copying each line's immutable priced snapshot including its discount. A request names entities, never amounts. Nest-path orders are never billed by Core. | MUST | TARGET (implemented in Core, not in production) | S (ORD-5) |
| FIN-2 | Check subtotal, discount, total and contained tax are computed by Core pricing only (INV-6); a check never reprices or re-evaluates promotions. A client-displayed amount before Core computation is labelled as an estimate. | MUST | TARGET (implemented in Core, not in production) | S (PR-3, ORD-2) |
| FIN-3 | A visit may have several checks. Later rounds are never appended to an existing check; they stay unbilled until a new check bills them. Settling one check settles nothing else. | MUST | TARGET (implemented in Core, not in production) | S [REPO] |
| FIN-4 | A check void requires a reason and an authorised role (FIN-34), and is refused (`CHECK_HAS_PAYMENTS`) unless no payment or adjustment is pending or uncertain and effective paid is zero. A void releases the check's lines and deletes nothing. | MUST | TARGET (implemented in Core, not in production) | S [REPO] |
| FIN-5 | Splitting a check (by line, seat, equal share or amount) and moving lines between checks are not in committed delivery scope. Until specified, a check is paid in full by one or more tenders within `available`. | MAY | TARGET CAPABILITY — FUTURE DELIVERY; mechanism DEC-FIN-19; policy DEC-FIN-15; Windows POS UX PENDING USER POS ANALYSIS REPORT (P12) | D+K(L18, L198) |
| FIN-6 | A card tender is created `pending` by an authorised staff identity; its result (`succeeded`, `failed`, `uncertain`) is accepted only from the trusted `payment_adapter` device of the same venue (CARD3). No staff route can mark a payment succeeded; adapter credentials are refused on staff routes and staff credentials on adapter routes. | MUST | TARGET (implemented in Core, not in production) | S (PAY-1, PAY-4, ADR 0002) |
| FIN-7 | A new tender is refused unless its amount fits `available` and its currency equals the check's, decided under the check row lock; money that may be moving is held, so concurrent tenders cannot overpay. | MUST | TARGET (implemented in Core, not in production) | S (PAY-3, §17.3) |
| FIN-8 | An uncertain payment or adjustment is held explicitly, reserves capacity, never settles, is never retried and never becomes failed automatically. It leaves `uncertain` only through a trusted reconciliation result, or through the manual resolution path of DEC-FIN-11 once decided. | MUST | TARGET (adapter path implemented in Core, not in production; manual path OWNER DECISION REQUIRED) | S (PAY-6, §17.12)+D |
| FIN-9 | `succeeded` and `failed` are final. A conflicting later result is refused (409) and changes nothing; a repeated identical result is idempotent. | MUST | TARGET (implemented in Core, not in production) | S (INV-10, INV-12) |
| FIN-10 | Every payment retains provider, provider transaction reference (in adapter metadata), method and timestamps; no raw card data or provider secret enters Servvia records, logs or events. | MUST | TARGET | S (SPRD §5, PAY-4, PAY-5, INV-18) |
| FIN-11 | No surface moves customer money before Core has recorded the tender. A transitional path that does (Nest kiosk card intent) is retired or corrected before production cutover. | MUST | TARGET; Nest kiosk path TRANSITIONAL | S (PR-4, §17.5)+E |
| FIN-12 | Where online or prepaid payment is enabled, Core verifies status, currency, amount, merchant and venue binding and replay before release to the kitchen; one provider payment creates at most one order; missing provider configuration fails closed in production. | MUST (where enabled) | TARGET (not implemented in Core; scope O-18) | S (PAY-2, PAY-3) |
| FIN-13 | A cash tender is accepted only under the tendering staff member's open shift at the venue (otherwise `NO_OPEN_SHIFT`) and is recorded `succeeded` together with its cash movement, settlement (if paid in full) and audit in one transaction. | MUST | TARGET (implemented in Core, not in production) | S (PAY-1, §17.1) |
| FIN-14 | A staff member has at most one open shift per venue; the opening float is a non-negative integer amount in the venue currency; an optional terminal must be active at the venue. | MUST | TARGET (implemented in Core, not in production) | S [REPO] |
| FIN-15 | Shift close records the counted cash; Core computes expected cash and variance under the shift lock and stores them immutably. After close no cash is accounted to the shift. Closing a shift closes nothing else. | MUST | TARGET (implemented in Core, not in production) | S (§17.10) |
| FIN-16 | A shift variance outside a configured tolerance is flagged at close, requires a reason, and opens a reconciliation item (FIN-29); manager acknowledgement is configurable. The tolerance and acknowledgement rule are policy. | SHOULD | OWNER DECISION REQUIRED (DEC-FIN-8) | V(07 §3.7)+E+D |
| FIN-17 | Cash movements other than sale and refund (paid-in, paid-out, safe drop, float top-up, change given on over-tender) are typed, positive-amount, reason-bearing movements on a shift that enter the expected-cash formula; denomination counts, blind counts and witnessed counts are optional count modes. None is built; today tendered equals applied (no change). | MAY | FUTURE (DEC-FIN-9; POS behaviour PENDING USER POS ANALYSIS REPORT) | V(07 §3.7)+D |
| FIN-18 | A refund is requested by an authorised staff identity against exactly one succeeded payment, with a reason, and is refused when it exceeds the payment's refundable capacity (`EXCEEDS_REFUNDABLE`). Pending and uncertain adjustments reserve capacity. | MUST | TARGET (implemented in Core, not in production) | S (PAY-7, §17.2) |
| FIN-19 | A card refund's result comes only from the trusted payment adapter. A cash refund is recorded under the refunding staff member's open shift as a `cash_refund` movement and never rewrites the original sale's shift. A refund returns money to the tender of the payment it references; any cross-tender refund is policy. | MUST | TARGET (implemented in Core, not in production); cross-tender OWNER DECISION REQUIRED (DEC-FIN-18) | S [REPO]+D |
| FIN-20 | A reversal is originated only by the trusted payment adapter device when the provider reversed or cancelled a card tender; there is no staff endpoint for it. Refunds and reversals stay distinguishable in every report. | MUST | TARGET (implemented in Core, not in production) | S [REPO] |
| FIN-21 | A succeeded adjustment that brings effective paid below the total revokes the current settlement and reopens the check in the same transaction; a later success that restores it re-settles with the next cycle. Every settled and revoked event is an append-only transition. | MUST | TARGET (implemented in Core, not in production) | S (§17.2, §17.5) |
| FIN-22 | A refund identifies which lines and quantities it returns, so that item-level sales, tax attribution and future stock effects are reportable. Today refunds are amount-only against a payment. | SHOULD | TARGET (mechanism approved 2026-10-05: DEC-FIN-5; GST attribution of refunds is P6) | E+D |
| FIN-23 | Chargebacks and disputes are FUTURE adapter-originated adjustments with their own dispute lifecycle and evidence, never edits of the original payment. | MAY | FUTURE (DEC-FIN-16; O-3) | E+D |
| FIN-24 | A visit closes only when financially complete (07.4.6); a refusal returns `VISIT_NOT_FINANCIALLY_COMPLETE` with the four counts; close of a closed visit is idempotent. Post-visit financial corrections remain possible and never reopen the visit. | MUST | TARGET (implemented in Core, not in production) | S (SPRD §11) [REPO] |
| FIN-25 | A promotion discount is computed by Core before tax, frozen in the round's applied-promotion snapshot and copied to check lines; contained tax is computed on the discounted total. A promotion that changed since the client read it is refused (`PROMOTION_CHANGED`); a replay returns the stored snapshot. | MUST | TARGET (implemented in Core, not in production) | S (PR-3, ORD-3) |
| FIN-26 | Comps, complimentary checks, zero-total checks and check-time manual discounts are not supported; a client-side discount is never accepted (`discountCents` from a client is refused). Their introduction is policy with step-up and approval (FIN-35). | MUST (refusal); MAY (feature) | TARGET (refusal implemented in Core); feature OWNER DECISION REQUIRED (DEC-FIN-13) | S+D |
| FIN-27 | Tax is computed only by Core from the venue's tax configuration; an unsupported tax profile fails closed (ORD-4). Each record retains the tax amount computed when it was accepted; a later configuration change never alters a recorded amount. Tax rules beyond the implemented NZ GST-inclusive profile are policy. | MUST | TARGET (implemented in Core for the NZ profile, not in production); further rules OWNER DECISION REQUIRED (DEC-FIN-3) | S (ORD-2, ORD-4, §17.7) |
| FIN-28 | Receipts and tax invoices reproduce Core-recorded amounts and never recompute them; reprints are marked as copies and attributed; content and NZ obligations follow O-5. | MUST | OWNER DECISION REQUIRED (O-5) | S (REC-1, PR-4) |
| FIN-29 | Core maintains a reconciliation queue of failed, stuck and mismatched financial items (07.4.8): uncertain payments or adjustments older than a configured age, card payments and adjustments without a matching provider record, provider records without a matching Core record, and shift variances (FIN-16). Items are resolved only with reason and actor, by a trusted result or a compensating record; they are never deleted. | MUST | TARGET (not built; thresholds DEC-FIN-12) | S (§17.10, NFR-REL) |
| FIN-30 | Card payments and adjustments are reconciled against the provider's records per venue and business date; the provider record source and format depend on O-3. A mismatch creates a reconciliation item and never edits the Core payment. | MUST | TARGET (not built; O-3) | S (§17.10, SPRD §11 "payment reconciliation") |
| FIN-31 | Every financial record is assigned exactly one venue business date, derived deterministically from its committed instant, the venue time zone and the trading-day boundary in force (INV-8, P3). The assignment is stored and is never rewritten: boundary changes are prospective, and day close does not assign or change business dates. | MUST | TARGET (rule decided by owner, P3, 2026-10-05) | S (INV-8)+E |
| FIN-32 | Day close is an explicit, audited operation per venue and business date. It reports open shifts, open checks, unbilled lines, open visits, unresolved payments and adjustments and open reconciliation items; produces a frozen day summary (RPT-2); and treats later corrections as post-close adjustments that never alter the frozen summary. Whether exceptions block close or are acknowledged is policy. | MUST (pilot, per RPT-2) | TARGET (mechanism; independent of business-date assignment per P3); close rules OWNER DECISION REQUIRED (O-6, DEC-FIN-10) | S (RPT-2, Part B row AF)+V(07 §4 WF-F5)+E |
| FIN-33 | Tips, gratuities and service charges are not modelled and no surface may add them client-side. If introduced, they are Core-computed, separately identified amounts (never folded into line prices), with stated tax treatment and, for tips, a recorded recipient basis for later distribution. | MUST (prohibition); MAY (feature) | OWNER DECISION REQUIRED (DEC-FIN-6, DEC-FIN-7) | S (PR-3)+V(CONSOLIDATED §open questions)+D |
| FIN-34 | Core enforces the financial authorization matrix of 07.7 per request, from the verified credential, deny-by-default. Kitchen, viewer, KDS devices, unelevated tablets, Guest Mode and customers are refused every financial action. | MUST | TARGET (implemented in Core, not in production) | S (INV-4, NFR-SEC-1, WT-4) |
| FIN-35 | Void, refund, comp or discount, manual uncertain resolution, variance acceptance and reconciliation acceptance support step-up confirmation by a second authorised staff identity and separation of duties (requester ≠ approver above a threshold), as configurable mechanisms. Thresholds are policy. | MUST (mechanism) | TARGET (Core mechanism not built; Nest manager step-up TRANSITIONAL); thresholds OWNER DECISION REQUIRED (DEC-X-7) | S (INV-4)+V(07 §6)+E |
| FIN-36 | Every staff financial mutation writes an audit record in the same transaction (INV-15); adapter results are recorded in the append-only transition histories with the device identity, never as an invented staff actor. Idempotent replays and key conflicts are recorded. Audit is searchable by actor, entity, date and action. | MUST | TARGET (implemented in Core, not in production; search not built in Core) | S (NFR-AUD, §17.11) |
| FIN-37 | Every externally retried financial command carries an idempotency key and request fingerprint; a replay returns the original result, and the same key with a different request is refused (`IDEMPOTENCY_CONFLICT`). Visit close is state-idempotent. | MUST | TARGET (implemented in Core, not in production) | S (INV-12, §17.4, §17.9) |
| FIN-38 | Financial writes follow one global lock order (TableSession → Order → Promotion → Check → Payment → Shift) and version compare-and-set; concurrency is proven by tests on real PostgreSQL. | MUST | TARGET (implemented in Core, not in production) | S (Part B row I) [REPO] |
| FIN-39 | Each financial write path can be disabled by configuration and then refuses with a stable code (`CHECK_WRITES_DISABLED`, `PAYMENT_WRITES_DISABLED`, `REFUND_WRITES_DISABLED`, `SHIFT_WRITES_DISABLED`) without partial effects. | MUST | TARGET (implemented in Core, not in production) | S [REPO] |
| FIN-40 | Financial facts (check created and voided, payment resolved, settlement settled and revoked, adjustment resolved, shift closed) are published as durable domain events (INV-13) once a consumer exists (reconciliation, reporting, accounting export). No consumer infers money movement from event delivery alone. | SHOULD | TARGET (no financial events today: no consumer) | S (INV-13)+E |
| FIN-41 | The accounting system of record (Servvia ledger, external accounting system fed by export, or both) is decided before any ledger or export work; every financial surface then shows which system is authoritative for accounting balances. | MUST (before ledger work) | OWNER DECISION REQUIRED (DEC-FIN-1) | V(07 §1)+D |
| FIN-42 | If a ledger is built: every journal entry balances per currency (Σ debits = Σ credits); a posted entry is immutable; a correction is a linked reversing entry; posting is refused into a closed period. | MUST (if built) | DEFERRED (SPRD §13) | V(07 §3.3)+E |
| FIN-43 | If a ledger is built: system entries are derived from Core financial facts by versioned, effective-dated posting rules; each posted line references its source records; an unmapped fact enters a posting-exception queue and is replayed after the rule is fixed, never posted to a default account. | MUST (if built) | DEFERRED (SPRD §13) | V(07 §3.4, WF-F3)+E |
| FIN-44 | If a ledger is built: a manual entry's creator cannot post it above the DEC-X-7 threshold; an organization with a single finance user needs a second authorised actor. | MUST (if built) | DEFERRED (SPRD §13; thresholds DEC-X-7) | V(07 §3.3, §6)+E |
| FIN-45 | If a ledger is built: accounting periods follow `open` → `closing` → `closed` with a close checklist whose items reference evidence (day closes, reconciliation queue empty or accepted, posting exceptions resolved); a late document posts to the next open period with a cross-reference. | MUST (if built) | DEFERRED (SPRD §13) | V(07 §3.2, WF-F5) |
| FIN-46 | Chart of accounts, posting-rule content, revenue-recognition basis for accounting, period calendar and valuation methods are owner or accountant policy and are never defaulted by Servvia. | MUST | OWNER DECISION REQUIRED (DEC-FIN-2) | S (INV-20)+D |
| FIN-47 | Payables, receivables (catering, events, house accounts), payment runs, dunning, supplier statement reconciliation, bank feeds, takings and bank reconciliation, and provider payout and fee recognition are deferred accounting capabilities. | MAY | DEFERRED (SPRD §13) | V(07 §3.5–3.7) |
| FIN-48 | Accounting-system exchange is an outbound adapter (INV-19) fed from Core financial facts or ledger entries: per-document delivery state (`queued` → `sent` → `accepted` / `rejected` with reason), idempotent delivery, bounded retry, dead letter, and a balance-drift report. External acknowledgements never overwrite Core facts. | MUST (if built) | TARGET CAPABILITY — FUTURE DELIVERY (inclusion DEC-X-1, owner 2026-10-05); whether Servvia also keeps its own ledger DEC-FIN-1 | V(07 §3.9, WF-F6)+S (INV-19)+K(L221, L444–447) |
| FIN-49 | Financial records are classified Financial (INV-18); provider references are Confidential adapter metadata; staff identities on records are Personal (employee). Personal-data erasure never deletes or alters a financial record (it pseudonymises the personal link, DEC-X-4). | MUST | TARGET | S (INV-11, INV-18)+E |
| FIN-50 | Financial records are retained for an owner-decided period that is not shorter than any statutory obligation (DEC-X-5); until decided, no financial record is deleted. | MUST | OWNER DECISION REQUIRED (DEC-FIN-14) | S (Part B row P)+D |
| FIN-51 | Check merge: an authorised staff identity can combine the standing checks of one visit, or of several open visits of the same venue, into one check. A merge is an explicit, audited, idempotent Core operation recorded as linked compensating records (INV-11): no recorded check total, line snapshot, payment, adjustment or settlement is edited, and each source check remains traceable to the merged result. A merge is refused with a stable code, changing nothing, when any source check has a pending or uncertain payment or adjustment, belongs to another venue, or changed since the request was prepared (version mismatch). Succeeded payments already recorded on a source check stay attributed to their original payment records. Which checks may be merged, by which roles, and with which step-up are policy; the Core mechanism is DEC-FIN-19. | MAY | TARGET CAPABILITY — FUTURE DELIVERY; mechanism DEC-FIN-19; policy DEC-FIN-15 (DEC-X-7 for step-up); Windows POS UX PENDING USER POS ANALYSIS REPORT (P12) | K(L18, L198)+S (INV-10, INV-11, INV-12)+D |
| FIN-52 | Wallet tenders: card-present digital wallets are accepted only through the trusted payment adapter (CARD3, unchanged), whose reported result is the only source of success; online wallets are accepted only through the online payment provider under the verification rules of PAY-2 and PAY-3 (FIN-12). Each payment records its tender type and the payment method reported by the adapter or provider (including the wallet kind, where reported), in adapter metadata where provider-specific (PAY-4). No wallet credential, device token or card data enters Servvia records, logs or events (PAY-5, INV-18). Wallet tenders follow the same lifecycle, uncertainty, refund and reconciliation rules as other tenders (FIN-6–FIN-9, FIN-18–FIN-21, FIN-29–FIN-30). | MAY | TARGET CAPABILITY — FUTURE DELIVERY; provider O-3; online scope O-18 | K(L220, L438)+S (PAY-2–PAY-5, ADR 0002) |
| FIN-53 | Operational P&L: permitted roles can view a near-real-time operational profit view per venue and business date (and per group of granted venues) derived from Core sales measured per P11 (00.10.5), recipe cost of items sold (volume 03) and labour cost (volume 06), using the metric definitions of volume 08 (BI-38). The view is labelled **operational**, states its time basis, as-of instant and each component's basis, and is never presented as, or reconciled to, an accounting P&L (accounting policy DEC-FIN-2; system of record DEC-FIN-1). A component whose source domain or data is unavailable is shown as unavailable, never as zero. It writes no canonical state and posts nothing. | MAY | TARGET CAPABILITY — FUTURE DELIVERY; depends on volumes 03 and 06; GST basis of the view DEC-BI-2 (with DEC-FIN-4) | K(L219, L325)+S (P11, BI-23)+D |
| FIN-54 | Jurisdiction tax reporting: permitted roles can produce tax summaries and return-supporting data per venue (or organization) and period from the tax amounts Core stored on each record (FIN-27, BI-4), in the structure a jurisdiction pack defines (INV-22). Tax is never recomputed for a report; refund and reversal effects follow DEC-FIN-4. Each report run records its parameters, pack version and data watermark and is reproducible (BI-7). Submission to a tax authority happens only through a regulatory adapter whose pack is implemented and validated (P5); without one, the report is produced for human review and Servvia submits nothing. A submission's state is explicit (`queued` → `sent` → `accepted` / `rejected` with reason) and never reported as accepted without the authority's acknowledgement (INV-14). Servvia makes no compliance claim (DEC-X-5). | MAY | TARGET CAPABILITY — FUTURE DELIVERY; tax policy DEC-FIN-3, DEC-FIN-4; regimes DEC-X-5; pack validation P5 | K(L222, L455)+S (INV-22, ORD-2)+D |
| FIN-55 | Split tender: a check may be satisfied by several payments of the same or different tender types (card, cash and, once FIN-52 exists, wallets), each created within `available` under the check lock (FIN-7). The check settles in the transaction in which effective paid reaches the total. Each payment keeps its own lifecycle and refundable capacity, and a refund applies to exactly one payment (FIN-18). | MUST | TARGET (implemented in Core, not in production: D6/D7 balance and hold rule, 07.4.2) | S (PAY-1, §17.3) [REPO]+K(L439) |

## 07.6 Workflows and failure paths

**WF-FIN-1 Bill a visit.** (1) Staff requests a check for the visit with an idempotency key. (2) Core locks the session (`FOR SHARE`, open required), then the orders, selects unbilled accepted lines, copies their snapshots, computes totals and tax, writes the check, lines and audit in one transaction. **Failures:** nothing unbilled → `NOTHING_TO_BILL`; visit closed → `TABLE_SESSION_NOT_OPEN`; Nest-path order → `ORDER_NOT_CANONICAL`; concurrent round → the round is wholly on the check or wholly left unbilled; lost response → replay with the same key returns the same check; same key, different request → `IDEMPOTENCY_CONFLICT`.

**WF-FIN-2 Card tender.** (1) Staff creates a `pending` card payment within `available`. (2) Core instructs the trusted adapter through Venue Edge (EDGE-2 local queue, explicit `unknown`). (3) The adapter reports `succeeded`, `failed` or `uncertain`. (4) On success, Core updates the balance and settles if paid in full in the same transaction. **Failures:** terminal timeout or lost result → `uncertain`; the amount stays held; staff see "outcome unknown — do not retake payment" (INV-14); no retry until reconciled (PAY-6). Adapter offline → payment stays `pending`, visible with age; the check cannot be voided (`CHECK_HAS_PAYMENTS`). Wrong venue or revoked adapter → refused. Conflicting late result after a final state → 409, recorded for investigation.

**WF-FIN-3 Resolve an uncertain outcome.** (1) The reconciliation sweep lists uncertain items by age. (2) The adapter queries the provider and reports the definitive result on the same payment. (3) If the provider cannot answer, the item enters the reconciliation queue for the manual path (DEC-FIN-11). **Never:** retake the payment while the first is uncertain; mark it failed to free capacity.

**WF-FIN-4 Cash tender and shift.** (1) Cashier opens a shift with a float. (2) Cash tender: lock check → lock the tendering staff's open shift → write succeeded payment, cash movement, settlement if complete, audit. (3) Close: lock shift, compute expected, store counted, expected and variance. **Failures:** no open shift → `NO_OPEN_SHIFT`; close and tender race → whichever commits first wins deterministically, the other sees the result; client-sent variance is ignored; variance outside tolerance → reason and reconciliation item (FIN-16, once decided).

**WF-FIN-5 Refund.** (1) An authorised staff member requests a refund of a succeeded payment with a reason, within capacity, with step-up where configured (FIN-35). (2) Card: `pending` → adapter result. Cash: succeeded under the refunder's open shift with a `cash_refund` movement. (3) If effective paid drops below the total, the settlement is revoked and the check reopens. **Failures:** capacity exceeded → `EXCEEDS_REFUNDABLE` with the remaining capacity; payment not succeeded → `PAYMENT_NOT_REFUNDABLE`; adapter uncertain → capacity stays reserved, queue item after the configured age; concurrent refunds → capacity decided under locks, never exceeded.

**WF-FIN-6 Provider reversal.** The adapter reports a provider-side reversal of a card tender; Core records a succeeded reversal within capacity and revokes settlement if needed. A reversal beyond capacity is refused and creates a reconciliation item (money moved outside Core's expectation).

**WF-FIN-7 Close the visit.** Staff requests close; Core locks the session `FOR UPDATE`, then the visit's checks `FOR SHARE`, evaluates the four counts, and closes or refuses with the counts. Payment results and refunds in flight commit first and are seen.

**WF-FIN-8 Day close** (close rules OWNER DECISION REQUIRED: O-6, DEC-FIN-10; business date per P3). (1) A manager starts close for a venue and business date. (2) Core computes readiness: open shifts, open checks and visits, unbilled lines, unresolved money, open reconciliation items. (3) Per policy, exceptions block or are acknowledged with reason. (4) Core freezes the day summary (volume 08, BI-21) and records the close. (5) A later correction dated to a closed day is reported as a post-close adjustment on its own business date, with a cross-reference to the closed day. **Failure:** concurrent close attempts → one wins by version; a close interrupted mid-way leaves the day `closing`, retryable, never half-frozen.

**WF-FIN-9 Provider reconciliation** (TARGET, O-3). (1) Provider settlement records for a venue and business date are ingested by the adapter. (2) Core matches them to card payments and adjustments by provider reference and amount. (3) Unmatched on either side → reconciliation items. (4) A venue-day is reconciled when no item remains open. **Failure:** provider file missing or late → the venue-day stays unreconciled and visible with age; duplicate ingestion → idempotent by provider record identity.

**WF-FIN-10 Ledger posting** (DEFERRED). Core financial facts → posting rules → balanced system entries with source references; unmapped facts → posting-exception queue → rule fix (versioned) → replay. No manual "fudge" entry substitutes for a missing rule.

## 07.7 Security, authorization and audit

**Authorization matrix (Core today, implemented, not in production).** Rows marked D need policy.

| Action | Owner | Admin | Manager | Cashier | Waiter (elevated tablet) | Kitchen / viewer / KDS / Guest Mode / customer | Adapter device |
|---|---|---|---|---|---|---|---|
| Create and read checks | Yes | Yes | Yes | Yes | Per elevated role (O-20) | No | No |
| Void check | Yes | Yes | Yes | No | Manager elevation only | No | No |
| Create card or cash tender | Yes | Yes | Yes | Yes | Per elevated role (O-20) | No | No |
| Report card payment or refund result; originate reversal | No | No | No | No | No | No | Own venue only |
| Request refund | Yes | Yes | Yes | No | Manager elevation only | No | No |
| Open own shift | Yes | Yes | Yes | Yes | D | No | No |
| Close or read any shift at the venue | Yes | Yes | Yes | Own only | D | No | No |
| Manage promotions | Yes | Yes | Yes | Read | No | No | No |
| Resolve reconciliation items, accept differences | D (DEC-X-7) | D | D | No | No | No | No |
| Day close | D (DEC-FIN-10) | D | D | No | No | No | No |
| Split, move lines between or merge checks (FIN-5, FIN-51; TARGET CAPABILITY — FUTURE DELIVERY) | D (DEC-FIN-15) | D | D | D | D (O-20) | No | No |
| View operational P&L; produce tax reports; operate accounting export (FIN-53, FIN-54, FIN-48; TARGET CAPABILITY — FUTURE DELIVERY) | D (DEC-X-2) | D | D | No | No | No | No |

- **Venue scope** comes from the verified credential (INV-2); the known gap in Core staff venue-scope enforcement must be fixed before production (SPRD O-2, §16 item 3). A resource of another organization answers 404.
- **Separation of duties** (FIN-35, FIN-44): requester ≠ approver for thresholded voids, refunds, comps, acceptances and manual postings; values per DEC-X-7.
- **Audit events:** `CHECK_CREATED`, `CHECK_VOIDED`, `PAYMENT_CREATED`, `CASH_PAYMENT`, `SHIFT_OPENED`, `SHIFT_CLOSED`, refund creation, `TABLE_SESSION_CLOSED` with readiness summary, `PROMOTION_*`, plus idempotent-replay and key-conflict records; adapter outcomes in transition histories. Tamper evidence beyond append-only storage: DEC-X-6.
- **Device trust:** adapter routes accept only an active, venue-bound `payment_adapter` device credential; revocation takes effect immediately (SPRD §16 items 5–6).
- **No financial data in telemetry** beyond identifiers and amounts needed for operations; no provider secrets or card data (SPRD §20 item 9).

## 07.8 Data governance

| Data | Class (INV-18) | Owner | Retention | Correction |
|---|---|---|---|---|
| Checks, lines, payments, adjustments, settlements, transitions | Financial | Core | DEC-FIN-14 (≥ statutory, DEC-X-5); never deleted meanwhile | Compensating records only (INV-11) |
| Shifts and cash movements | Financial | Core | DEC-FIN-14 | Never edited; variance stored at close |
| Adapter result references, provider transaction identifiers | Confidential (adapter metadata) | Core payments | With the payment | Never overwritten after a final state |
| Staff identity on financial records | Personal (employee) | Core identity | With the record; erasure pseudonymises (DEC-X-4) | — |
| Audit records | Financial / Internal | Core audit | ≥ 90 days (NFR-AUD); longer per DEC-FIN-14 | Append-only |
| Reconciliation items, day-close summaries | Financial | Core (no package, DEC-X-13) | DEC-FIN-14 | Resolution records, never deletion |
| Card data | Never stored (PAY-5) | — | — | — |

- **Money:** integer minor units with ISO 4217 currency; one currency per check, payment and shift; multi-currency per DEC-X-11.
- **Historical correction:** a report reproduces history from immutable records plus compensating records (volume 08, BI-7).

## 07.9 Reliability, scalability and observability

- **Atomicity:** each financial transition, its history, audit and (when built) event commit together (§17.1, INV-13).
- **Outage behaviour:** Core unavailable → no surface may record or claim payment success; Venue Edge holds terminal commands in its durable queue with explicit `unknown` (EDGE-2, EDGE-3); adapter results replay idempotently after reconnect.
- **Signals (alertable, SPRD §18 item 11, §20):** count and oldest age of `pending` and `uncertain` payments and adjustments; reconciliation queue depth and oldest age; unreconciled venue-days; settlement revocations; shift variances outside tolerance; idempotency conflicts; adapter heartbeat and result latency; financial write-path disablement. **Alert thresholds: OWNER TARGET REQUIRED (DEC-FIN-12).**
- **Capacity:** financial throughput at peak is part of DEC-X-8; no figure is set here.
- **Runbooks before production (Part B row AF):** uncertain-payment resolution, adapter outage, end-of-day and day close, shift variance investigation, refund failure.

## 07.10 UX and accessibility

- Every financial screen on a staff surface shows `pending`, `uncertain`, `failed`, `succeeded`, `settled`, `revoked` and `voided` states distinctly and truthfully (SPRD §22, INV-14); `uncertain` carries an explicit "do not retake payment" instruction and its age.
- Destructive or financially significant actions (void, refund, close shift, close day, accept difference) require explicit confirmation stating amount, currency and effect (SPRD §22).
- Amounts shown before Core computation are labelled as estimates (INV-6); error messages map the stable codes of 07.5 to actionable text (INV-16).
- Admin Console financial views meet WCAG 2.1 AA (NFR-A11Y). Waiter Tablet: OWNER TARGET REQUIRED (SPRD §23). Windows POS: PENDING USER POS ANALYSIS REPORT.

## 07.11 Acceptance criteria

| ID | Scenario | Expected result |
|---|---|---|
| AC-FIN-1 | Create a check for a visit with two rounds | One check holding every unbilled line; totals equal the sum of line snapshots; tax is the Core-computed contained tax; one audit record |
| AC-FIN-2 | Two concurrent check requests for the same visit | Each line on at most one standing check; the second bills only what remains or returns `NOTHING_TO_BILL` |
| AC-FIN-3 | Replay check creation with the same key; then same key with a different body | Same check returned, no new rows; then `IDEMPOTENCY_CONFLICT` with the holding check id |
| AC-FIN-4 | Round submitted concurrently with check creation | The round is wholly on the check or wholly unbilled; never split |
| AC-FIN-5 | Staff credential calls the adapter result route; adapter credential calls a staff route | Both refused; no state change |
| AC-FIN-6 | Adapter of venue B reports a result for a venue A payment; revoked adapter reports | Refused; payment unchanged |
| AC-FIN-7 | Two concurrent tenders whose sum exceeds the total | One accepted; the other `AMOUNT_EXCEEDS_AVAILABLE`; overpayment impossible even if both would succeed |
| AC-FIN-8 | Adapter reports `uncertain` | Payment held; check not settled; no automatic retry or failure; staff surface shows the uncertain state |
| AC-FIN-9 | Uncertain payment later reported `succeeded` and the check is paid in full | Payment succeeded; settlement cycle 1 created in the same transaction; check `settled` |
| AC-FIN-10 | A `failed` result arrives after `succeeded` | 409; payment stays succeeded; conflict observable |
| AC-FIN-11 | Void a check with a pending, uncertain or succeeded payment | `CHECK_HAS_PAYMENTS`; check unchanged |
| AC-FIN-12 | Cash tender by a cashier without an open shift | `NO_OPEN_SHIFT`; no payment row |
| AC-FIN-13 | Shift close races a cash tender (lock held in test) | Either the tender is counted in expected cash or it is refused after close; never lost |
| AC-FIN-14 | Close a shift with a client-supplied variance | Variance ignored; stored variance = counted − expected computed by Core |
| AC-FIN-15 | Refund larger than refundable capacity | `EXCEEDS_REFUNDABLE` with remaining capacity; no adjustment |
| AC-FIN-16 | Two concurrent refunds that together exceed capacity | One succeeds or reserves; the other refused; capacity never exceeded |
| AC-FIN-17 | Cashier requests a refund | Refused (role) |
| AC-FIN-18 | Cash refund by a manager whose shift differs from the sale's shift | `cash_refund` on the manager's open shift; sale's shift unchanged |
| AC-FIN-19 | Refund of a settled check | Settlement revoked, check `open`, revocation transition appended; a new tender re-settles with cycle 2 |
| AC-FIN-20 | Staff attempts to create a reversal | No route; refused |
| AC-FIN-21 | Close a visit with an unbilled line, an open check or an uncertain payment | `VISIT_NOT_FINANCIALLY_COMPLETE` with the four counts; visit open |
| AC-FIN-22 | Close an already closed visit; refund after visit close | 200 unchanged, no second audit; refund allowed, visit stays closed |
| AC-FIN-23 | Promotion changed between client read and submission | `PROMOTION_CHANGED`; no order; retry with fresh data succeeds |
| AC-FIN-24 | Discounted round | Contained tax computed on the discounted total; check copies line discounts; a later promotion edit changes nothing recorded |
| AC-FIN-25 | Client sends `discountCents` | Refused |
| AC-FIN-26 | Venue configured with an unsupported tax profile | Order and check creation fail closed with a stable code |
| AC-FIN-27 | Transaction fails after the payment row is written (fault injection) | No payment, transition, settlement, movement or audit persists |
| AC-FIN-28 | Write path disabled by configuration | Stable `*_WRITES_DISABLED` code; no partial effect |
| AC-FIN-29 | KDS device, viewer, kitchen role, unelevated tablet or Guest Mode calls any financial route | Refused; nothing recorded except security logging |
| AC-FIN-30 | Uncertain payment older than the configured age (DEC-FIN-12) | Reconciliation item created once; alert raised; item visible in the queue with age (TARGET) |
| AC-FIN-31 | Provider record with no Core payment, and Core card payment with no provider record | One reconciliation item each; no Core payment edited (TARGET, O-3) |
| AC-FIN-32 | Audit search for a refund by actor and date | The refund's audit record is found with correlation id, before and after values |
| AC-FIN-33 | Day close (once O-6 and DEC-FIN-10 are decided) with an open shift | Behaviour per policy: blocked, or acknowledged with reason; frozen summary unaffected by later corrections |
| AC-FIN-34 | Merge two open checks of a visit; repeat with the same key; then attempt a merge where one source check holds an uncertain payment (FIN-51, once DEC-FIN-19 is decided) | Merged check traceable to both sources by linked records; no recorded total, line snapshot or payment edited; replay returns the same result; the uncertain case is refused with a stable code and changes nothing |
| AC-FIN-35 | Card-present wallet tender reported `succeeded` by the trusted adapter; staff route attempts to mark a wallet tender succeeded (FIN-52) | Adapter result accepted with tender type and reported wallet method recorded, no wallet credential or token stored; staff attempt refused as in AC-FIN-5 |
| AC-FIN-36 | Operational P&L for a venue and business date where labour cost is not available (FIN-53) | View labelled operational with as-of and time basis; labour component shown as unavailable, not zero; sales component equals the P11 measure stated by volume 08 for the same scope |
| AC-FIN-37 | Tax report requested for a venue whose jurisdiction pack is not validated, then submission attempted (FIN-54) | Report produced from stored tax only (equals Σ stored tax for the scope); submission refused, nothing sent, state stays unsubmitted |
| AC-FIN-38 | A check paid by one cash and one card tender, card reported `succeeded` last (FIN-55) | Settlement created in the transaction of the card success; each payment refundable only up to its own capacity |

## 07.12 KPIs and metric definitions

Financial metric semantics used in reports are defined once in volume 08 (08.12); this table defines finance-control indicators.

| KPI | Definition | Target |
|---|---|---|
| Duplicate charges | Count of provider captures that correspond to more than one Core payment for the same tender intent, or Core succeeded payments without a provider record after reconciliation | Zero (release acceptance, SPRD §11 "no duplicate charges") |
| Uncertain exposure | Count and amount of payments and adjustments currently `uncertain`; oldest age | OWNER TARGET REQUIRED (DEC-FIN-12) |
| Reconciliation backlog | Open reconciliation items by type; oldest age | OWNER TARGET REQUIRED (DEC-FIN-12) |
| Unreconciled venue-days | Count of venue business dates with at least one open reconciliation item or without provider records, by age | OWNER TARGET REQUIRED (DEC-FIN-12); proposed (Verdura evidence): none older than 3 days |
| Cash variance | Σ variance and Σ absolute variance of shifts closed per venue business date; count of shifts outside tolerance | OWNER TARGET REQUIRED (DEC-FIN-8) |
| Settlement revocations | Count of revoked transitions per venue business date | Monitoring only; OWNER TARGET REQUIRED |
| Refund ratio | Σ succeeded refund amounts ÷ Σ succeeded payment amounts, same venue and business-date range (08.12 attribution) | Monitoring only; OWNER TARGET REQUIRED |
| Posting exceptions (if ledger built) | Count and median age of unmapped facts | OWNER TARGET REQUIRED; proposed (Verdura evidence): zero at period close |
| Close duration (if ledger built) | Business days from period end to `closed` | OWNER TARGET REQUIRED |

## 07.13 Open decisions

| ID | Decision | Why it matters | Options evidenced | Blocks | Tier |
|---|---|---|---|---|---|
| DEC-FIN-1 | Accounting system of record: Servvia ledger, external accounting system fed by export, or both with one declared authoritative. **Note (owner 2026-10-05, DEC-X-1):** external accounting-system integration is in scope (FIN-48, `TARGET CAPABILITY — FUTURE DELIVERY`); whether Servvia also keeps its own ledger, and which system is authoritative for accounting balances, remains open | Determines whether a ledger is built beside the export adapter | Verdura native and mirror modes (evidence); KitchenOS accounting integration (K(L221, L444–447)) | FIN-41–FIN-45; FIN-48 only for its source (Core facts or ledger entries) | 3 — integration inclusion resolved; ledger question open |
| DEC-FIN-2 | Chart of accounts, posting-rule content, accounting revenue-recognition basis, period calendar, valuation | Accounting policy must not be invented | Verdura hospitality chart template (evidence only) | Any posting | 3 |
| DEC-FIN-3 | Tax policy beyond the NZ GST-inclusive profile: other profiles, zero-rated or exempt items, effective-dated rate changes, rounding level (check vs line) confirmation | Correct tax (SPRD §11 release acceptance) | Core implements contained GST on the check total, fail-closed otherwise | New tax profiles; multi-jurisdiction | 3 |
| DEC-FIN-4 | GST attribution of partial and full refunds and reversals (pro-rata of contained GST, line-based, or as computed by an accountant rule) | Tax reporting after refunds | None in Core (refund is amount-only) | Tax-exclusive net figures after refunds (08.12) | 3 |
| DEC-FIN-5 | Item-level refund linkage (lines and quantities) versus amount-only refunds | Item sales, tax and future stock effects of refunds | D9 amount-only design | FIN-22 | **APPROVED — TIER 2** (2026-10-05; mechanism only, see 00.10.4; was: 2) |
| DEC-FIN-6 | Tips and gratuities: supported or not; capture (terminal prompt via adapter, cash); tax treatment; ownership, distribution and pooling; payroll export | Money owed to staff; labour-law exposure | Verdura open question on tip pooling; no Servvia model | FIN-33; volume 06 payroll export | 3 |
| DEC-FIN-7 | Service charges: supported or not; automatic rules; taxability; disclosure | Pricing correctness; customer disclosure | Retired customer-website client-side service charge (fiction) | FIN-33 | 3 |
| DEC-FIN-8 | Cash variance tolerance, reason requirement and manager acknowledgement | Cash control | Verdura variance thresholds (evidence) | FIN-16 | 3 |
| DEC-FIN-9 | Cash-management scope: paid-in and paid-out, drops, change on over-tender, denominations, blind and witnessed counts, drawer versus staff accountability | Cash control; depends on POS report and cash drawer (O-4) | D7 staff-owned shift, no change | FIN-17 | 3 |
| DEC-FIN-10 | Day close: who closes; blocking versus acknowledged exceptions; reopening; frozen summary content (with O-6) | End-of-day discipline; reports | Verdura period close pattern (evidence) | FIN-32; BI-21 | 3 — open under O-6 (pilot gate); business-date part resolved by P3 |
| DEC-FIN-11 | Manual resolution of uncertain outcomes when the provider cannot answer: evidence required, roles, separation of duties | Prevents permanent holds without inviting fraud | D6 principle: only explicit resolution leaves uncertain | FIN-8 manual path | **APPROVED — TIER 2** (2026-10-05; mechanism only, see 00.10.4; was: 2) |
| DEC-FIN-12 | Reconciliation parameters: provider record source and format (with O-3), matching keys, age thresholds for stuck items, alert thresholds, acceptance authority | Reconciliation cannot run without them | SPRD §17.10; Verdura "3 days" (proposed only) | FIN-29, FIN-30, 07.9 alerts | 3 |
| DEC-FIN-13 | Comps, complimentary and zero-total checks, check-time manual discounts, and their authority | Revenue leakage control | Nest reserves manager step-up for discount; D11 defers manual discounts | FIN-26 | 3 |
| DEC-FIN-14 | Financial record retention period (with DEC-X-5 statutory obligations) | Records must not be deleted early or kept indefinitely by accident | Part B row P | FIN-50; archival jobs | 3 |
| DEC-FIN-15 | Split checks and line transfer between checks (and, with FIN-51, check merge): which modes are offered and with which authority. **Note:** inclusion resolved by DEC-X-1 (owner 2026-10-05); Core mechanism DEC-FIN-19; Windows POS UX stays P12 | Common service need; POS behaviour pending report | D5 permits several checks per visit | FIN-5, FIN-51 | 3 — inclusion resolved; policy open (P12) |
| DEC-FIN-16 | Chargebacks and disputes: modelling, evidence, authority | Provider-initiated money movement after settlement | Not in D9 | FIN-23 | 3 |
| DEC-FIN-17 | Group-level finance across several venues or legal entities (consolidation, inter-venue cash). **Note:** multi-location finance inclusion resolved by DEC-X-1 (owner 2026-10-05); the legal-entity and consolidation structure remains open | Multi-venue operators (SPRD §1) | Verdura multi-entity roadmap (evidence); KitchenOS multi-location support (K(L343–346)) | Multi-entity accounting and consolidation | 3 — inclusion resolved; structure open |
| DEC-FIN-18 | Cross-tender refunds (for example cash refund of a card payment) | Fraud and reconciliation risk | D9 binds refunds to the payment's tender | FIN-19 exception | 3 |
| DEC-FIN-19 | Core mechanism for check split, line move and merge: how the operations are represented (for example void-and-rebill of unpaid checks, explicit line-transfer and merge transitions with history), which check and payment states permit them, and how succeeded payments on source checks are carried | Split and merge must preserve immutable financial history (INV-11) and the one-standing-check-per-line invariant | D5 standing-check rule; DEC-OPS-1 compensating-record pattern; DEC-OPS-5 (visit merge and split scope) | FIN-5, FIN-51 | **APPROVED — TIER 2** (orchestrator ratification 2026-10-05; mechanism only, 00.10.4) |

Inherited and referenced, not duplicated: O-3 (provider and terminal), O-4 (cash drawer hardware), O-5 (receipts and tax invoices), O-6 (minimum service-day reports), O-18 (online payment scope), O-20 (Staff Mode authorisation), DEC-X-2 (finance and accountant roles), DEC-X-3 (business date), DEC-X-5 (compliance regimes, including payment-card scope of the trusted adapter), DEC-X-6 (tamper evidence), DEC-X-7 (approval and SoD thresholds), DEC-X-11 (currency), DEC-X-13 (Core packages for reconciliation, day close, ledger).

## 07.14 Future and deferred capabilities

| Capability | State | Gate |
|---|---|---|
| Ledger, journals, posting rules, periods and close (FIN-42–FIN-45) | DEFERRED (SPRD §13) | DEC-X-1, DEC-FIN-1, DEC-FIN-2, DEC-X-13 |
| Payables, payment runs, supplier statements (depends on volume 04 procurement) | DEFERRED | DEC-X-1 |
| Receivables, house accounts, catering and event invoicing, dunning | DEFERRED | DEC-X-1 |
| Bank feeds, takings and bank reconciliation, provider payout and fee recognition | DEFERRED | DEC-X-1, O-3 |
| Accounting-system export adapters (FIN-48) | TARGET CAPABILITY — FUTURE DELIVERY (owner 2026-10-05) | DEC-X-17; DEC-FIN-1 (own ledger alongside, and authoritative system) |
| Check split, line move and merge (FIN-5, FIN-51) | TARGET CAPABILITY — FUTURE DELIVERY | DEC-X-17; DEC-FIN-19 (mechanism); DEC-FIN-15 (policy); Windows POS UX P12 |
| Wallet tenders (FIN-52) | TARGET CAPABILITY — FUTURE DELIVERY | DEC-X-17; O-3; O-18 (online) |
| Operational P&L view (FIN-53, BI-38) | TARGET CAPABILITY — FUTURE DELIVERY | DEC-X-17; volumes 03 and 06 live; DEC-BI-2 |
| Multi-location finance views | TARGET CAPABILITY — FUTURE DELIVERY | DEC-X-17; DEC-FIN-17 (legal-entity and consolidation structure) |
| Stored-value and gift-card liability (volume 05) | FUTURE | DEC-X-1 |
| Stock valuation and cost of goods postings (volumes 03, 04) | DEFERRED | O-9, DEC-X-1 |
| Labour accrual postings and tip distribution export (volume 06) | DEFERRED | DEC-FIN-6 |
| Jurisdiction tax reporting (FIN-54): summaries and return-supporting data from stored tax; submission only through a validated regulatory adapter | TARGET CAPABILITY — FUTURE DELIVERY | DEC-X-17; DEC-FIN-3, DEC-FIN-4, DEC-X-5; pack validation P5 |
| Budgeting, cash-flow forecasting, multi-entity consolidation, fixed assets, franchise royalties, open-banking payment initiation | FUTURE (Verdura roadmap evidence; not owner-approved) | DEC-X-1 scope decision; consolidation also DEC-FIN-17 |
| Comps, cash movements beyond sale and refund, chargebacks | FUTURE | DEC-FIN-9, -13, -16; POS report |
