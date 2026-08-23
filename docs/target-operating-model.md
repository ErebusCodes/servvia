# Verdura Target Operating Model

**Decision date:** 2026-08-15  
**Status:** Normative — governs implementation  
**Scope:** Verdura-originated staff-tablet, customer-tablet, kiosk and online orders

This document is the authoritative cross-cutting contract for order, POS, payment and kitchen fulfilment behaviour. If an older plan, example or requirement conflicts with it, this document wins.

## 1. System responsibilities

| System | Authoritative responsibility |
| --- | --- |
| Verdura | Customer and staff ordering experience; reservations; operational order state; menu orchestration; KDS/KOT routing; inventory, CRM and analytics; cross-system traceability |
| Idealpos | Core POS transaction, table/tender representation and in-person EFTPOS payment record |
| Existing Idealpos-integrated EFTPOS | Default card-present payment path for orders paid in person |
| Stripe or approved Verifone online service | Optional online/prepayment authorization, capture, refund and settlement truth |
| On-premise Verdura Connector | Durable, authenticated translation and delivery between Verdura and the venue's Idealpos and printer environment; never an independent source of business truth |

Verdura remains the system of engagement and operational orchestration. Idealpos remains the system of record for the POS transaction and in-person payment. Payment providers remain authoritative for their own payment events.

## 2. Non-negotiable order invariant

Every accepted Verdura-originated order must be durably recorded by Verdura and offered to the on-premise connector before kitchen fulfilment is released. The connector must durably accept the POS command before Verdura treats the handoff as accepted. KDS and KOT delivery then fan out from the same immutable order version.

“Simultaneous” means durable independent fan-out—not three best-effort calls from a tablet. A single database transaction must persist the order, its immutable commercial snapshot, its idempotency key and outbox commands for POS, KDS and each preparation-station KOT destination.

## 3. Standard in-person payment flow

1. Staff or customer submits an order through Verdura.
2. Verdura validates venue, table, menu availability, modifiers, tax and price; creates the operational order and immutable line snapshot.
3. Verdura creates durable POS, KDS and station-specific KOT outbox commands.
4. The on-premise connector durably accepts the command and submits the transaction to Idealpos.
5. Verdura releases the same order version to KDS and the applicable KOT printers according to preparation-station routing.
6. Idealpos returns its transaction reference; Verdura stores it against the order.
7. Staff completes payment through Idealpos and its existing integrated EFTPOS workflow (or another Idealpos tender such as cash).
8. Idealpos remains authoritative for the POS and in-person payment; the connector reports payment/tender facts to Verdura for reconciliation and operational visibility.

Kitchen preparation may begin before in-person payment because this is the intentional restaurant workflow. The UI must show the payment as pending at Idealpos and must never represent connector acceptance as payment success.

## 4. Optional online/prepaid flow

1. Customer submits an order and chooses online payment in Verdura.
2. Verdura validates and records a pending order with an immutable price snapshot and idempotency key.
3. Verdura initiates payment through the configured provider and verifies the result server-side, including provider status, currency, amount, merchant/venue binding and replay protection.
4. After verified success, Verdura records the payment reference and creates durable POS, KDS and station-specific KOT outbox commands.
5. The connector submits the order to Idealpos using the configured `PREPAID / ONLINE` tender mapping.
6. Verdura releases the paid order to KDS/KOT, stores the Idealpos transaction reference and reconciles provider amount, Verdura amount and Idealpos amount.

Unless a separately approved “prepare before payment” policy exists, failed, cancelled or abandoned online payments must not release production to KDS/KOT. No raw card data may enter Verdura.

## 5. Kitchen routing ownership

Verdura owns KDS and KOT routing for Verdura-originated orders. Routing is line-level and based on the versioned preparation-station configuration effective when the order is submitted. One order may therefore generate multiple station tickets.

Idealpos must not also print kitchen tickets for those imported orders unless an explicitly tested deduplication arrangement exists. Idealpos-originated orders may continue to use Idealpos routing. Every transaction carries an `orderSource` so ownership is unambiguous.

**2026-08-16 addendum:** whether Idealpos kitchen printing can be selectively suppressed for API-less-adapter-originated orders is an open, blocking live-discovery item (`docs/integrations/idealpos.md` §18, DL-067). No production pilot may allow both Verdura and Idealpos to independently print the same KOT. If suppression is not possible, the fallback of Idealpos owning physical KOT for API-less orders (with Verdura suppressing its own print commands) requires an explicit, separate architecture/TOM decision and end-to-end duplicate-prevention evidence — it is not adopted by default and is not adopted by this document.

## 6. Required identifiers and states

Every order must retain:

- `verduraOrderId` and human-readable order number;
- immutable `orderVersion` and `idempotencyKey`;
- `orderSource` (`VERDURA_STAFF_TABLET`, `VERDURA_CUSTOMER_TABLET`, `VERDURA_KIOSK`, `VERDURA_ONLINE`, or `IDEALPOS_POS`);
- `idealposTransactionId`, connector installation ID and POS timestamps;
- payment provider, provider transaction ID, method, tender code and payment timestamps;
- POS, KDS and per-printer delivery status, attempts and acknowledgements;
- correlation ID, actor/device identity and audit timestamps.

POS delivery uses `QUEUED`, `CONNECTOR_ACCEPTED`, `POS_SUBMITTED`, `POS_CONFIRMED`, `FAILED`, `UNCERTAIN`, `MANUAL` and `NOT_APPLICABLE`. Payment uses `NOT_REQUIRED_YET`, `PENDING`, `AUTHORIZED`, `CAPTURED`, `FAILED`, `CANCELLED`, `REFUND_PENDING`, `PARTIALLY_REFUNDED` and `REFUNDED`. KDS/KOT use independent delivery states; neither implies POS or payment success.

## 7. Failure and reconciliation policy

- No fabricated provider, Idealpos, KDS or printer success is permitted.
- Retries reuse the same durable idempotency key and immutable order version.
- An uncertain POS outcome is reconciled before resubmission to prevent duplicate sales.
- Connector unavailable before durable acceptance: show a blocking POS-handoff error, unless an authorized offline-emergency mode is active.
- Idealpos failure after connector acceptance: retain the command locally, display `POS_PENDING`/`POS_FAILED`, alert staff and reconcile; never silently lose or duplicate it.
- KDS failure and KOT failure are visible separately. KDS is the operational fallback for a printer failure, not proof that a ticket printed.
- Online payment success followed by POS failure remains a paid order requiring urgent POS reconciliation; it must not be charged again.
- In-person payment status must be imported or reconciled from Idealpos; Verdura must not infer it from order preparation state.

## 8. Provider and connector constraints

- The Idealpos mechanism must be vendor-supported or explicitly approved in writing. Preference order: supported ecommerce/web-order interface, approved reseller module, documented API/import, then a controlled last-resort adapter. Direct database writes are prohibited without written vendor approval and recovery testing.
- **2026-08-16 addendum:** the currently documented realization of the "controlled last-resort adapter" is a proposed, unproven, Verdura-managed API-less interim adapter — a Windows Connector service paired with a separate interactive Idealpos POS Bridge UI-automation process (`docs/integrations/idealpos.md` §13–§18). It must never be represented as vendor-supported unless Idealpos or its reseller gives written approval for UI-automation-based order entry; absent that, it is disclosed to the venue operator as Verdura's own engineering risk. It is gated by live discovery and a non-production tracer bullet (story `9-2`) before any production use, and remains subordinate in preference order to a vendor-supported interface becoming available. **Scope note:** the "prohibited without written vendor approval" database-writes line above is the general, conditional principle governing any adapter type, including a hypothetical future SqlAdapter/OdbcAdapter (`docs/integrations/idealpos.md` §5.2–§5.3, DL-035) that could in principle be approved with recovery testing. It is distinct from, and does not soften, the Idealpos POS Bridge's own **unconditional** prohibition (`idealpos.md` §14.2) on direct database access under any circumstance — the Bridge is UI-automation-only by design and is never itself a candidate for a future database-write exception.
- The perpetual Idealpos licence does not prove entitlement to integration modules, Idealpos Online, upgrades, APIs or support; these must be commercially confirmed.
- Existing Oolio Pay/Verifone terminals remain the default Idealpos-integrated in-person path.
- Stripe remains the MVP online-payment default unless an approved New Zealand Verifone/Oolio ecommerce product supplies sandbox access, tokenisation/hosted capture, signed webhooks, idempotency, refunds, settlement reconciliation and acceptable commercial terms.
- Payment implementation must remain provider-neutral; provider-specific fields belong in adapter metadata, not the canonical order model.
- The connector uses outbound-only mutually authenticated communication, a revocable venue-bound identity, encrypted local storage and a durable local queue. It must not receive direct access to shared cloud Redis or expose Idealpos to the public internet.

## 9. Release acceptance

No POS-connected pilot is complete until tests demonstrate correct mapping, stable transaction references, no duplicate POS sales, no duplicate KOTs, ordered replay after restart/outage, station routing, payment/tender reconciliation, partial/full refunds, connector revocation, audit correlation and staff-visible recovery for every failure state.

