# Verdura BMAD Production Readiness Report

**Original report:** 2026-06-21

**Reassessment:** 2026-08-15

**Status:** **NOT PRODUCTION-READY**

**Operating classification:** Controlled prototype

## Executive assessment

Verdura has a credible API, authentication, menu, reservation, order-tablet and KDS foundation. It does not yet implement the enterprise operating model in [`docs/target-operating-model.md`](../../docs/target-operating-model.md). The previous 100/100 report is withdrawn because its evidence did not demonstrate the actual venue boundary or truthful external-system outcomes.

## Confirmed strengths

- NestJS, PostgreSQL, Redis and multi-frontend foundation builds successfully.
- Server-side order repricing and finite-state checks exist.
- Authentication, refresh-cookie, Argon2, rate-limiting and venue-scoped KDS controls provide a useful baseline.
- Stripe creation now fails closed in real server modes and order creation verifies provider status, NZD currency and server-computed amount.
- Menu, reservation, table, order and KDS paths are substantially API-backed.

These strengths do not constitute POS, payment, printing or enterprise launch approval.

## P0 blockers

1. **Idealpos contract unknown:** installed build, perpetual-licence integration entitlements, supported ingress, item/table/modifier/tax mappings, tender behavior and stable reference are not proven.
2. **Venue connector absent:** no paired, revocable, outbound-mTLS installation with encrypted local durable queue, heartbeat, acceptance and replay evidence.
3. **Required sequencing absent:** ordinary orders must be durably accepted for Idealpos before normal KDS/KOT release, then paid through existing Idealpos/EFTPOS or cash.
4. **Kitchen delivery incomplete:** no proven preparation-station routing, edge printer delivery, device acknowledgement or duplicate suppression against Idealpos printing.
5. **Online payment lifecycle incomplete:** durable one-payment/one-order enforcement, signed webhooks, refunds and settlement reconciliation remain incomplete; online success must map to Idealpos `PREPAID / ONLINE`.
6. **Transactional delivery incomplete:** order/version, idempotency result and POS/KDS/KOT outbox commands are not atomically committed and independently acknowledged.
7. **Reconciliation incomplete:** uncertain POS results, paid-online/POS-failed cases, tender/amount differences, retries, voids and refunds lack a controlled case workflow.
8. **Enterprise controls incomplete:** venue grants, database tenancy constraints, universal correlated audit, separation of duties, secret lifecycle, observability and backup/restore proof remain insufficient.

## Target acceptance journeys

### Standard in-person

Verdura submission → immutable order/outbox → connector durable acceptance → Idealpos transaction + KDS/KOT fan-out → existing Idealpos-integrated EFTPOS/cash → Idealpos payment fact returned to Verdura.

Kitchen may prepare before in-person payment by explicit business policy. POS handoff, kitchen state and payment state remain independent.

### Optional online/prepaid

Verdura pending order → server-verified Stripe or approved Verifone payment → Idealpos `PREPAID / ONLINE` + KDS/KOT fan-out → retain provider and Idealpos references → reconcile provider, Verdura and Idealpos totals.

Production must not begin on failed/abandoned online payment unless a separately approved policy exists.

## Minimum evidence pack

- Vendor/reseller confirmation and sanitized configuration/mapping export.
- Real Idealpos/EFTPOS and online-payment end-to-end test results.
- Real KDS and each preparation-station printer result.
- Duplicate/restart/outage/reconnect/uncertain-outcome/refund tests.
- Reconciliation report showing Verdura, provider and Idealpos references/totals.
- Connector security, tenant isolation and revocation tests.
- Monitoring, incident ownership, rollback and backup-restore rehearsal.

## Recommendation

Continue controlled development and non-production demonstrations. Do not enable live POS-connected or real-money operation until the P0 blockers are closed and the launch-gate document is reissued with dated evidence.
