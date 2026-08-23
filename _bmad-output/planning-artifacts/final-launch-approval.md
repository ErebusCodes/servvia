# BMAD Launch Gate Decision

**Original decision:** 2026-06-21

**Reassessment:** 2026-08-15

**Status:** **NOT APPROVED FOR PRODUCTION OR AN ON-SITE POS-CONNECTED PILOT**

**Previous approval hash:** `BMAD-VERDURA-LAUNCH-20260621-100` — **withdrawn**

## Decision

The earlier “100% ready” approval is invalid. It treated mocks, disconnected queue records, local simulations and component-level tests as production evidence. It did not prove a real Idealpos handoff, existing EFTPOS journey, online-prepaid tender mapping, venue-edge KOT delivery, durable replay, reconciliation or enterprise tenancy/audit controls.

The normative operating contract is [`docs/target-operating-model.md`](../../docs/target-operating-model.md). Verdura is the customer and operational experience layer. Idealpos remains the core POS transaction and in-person-payment system.

## Required launch evidence

- Installed Idealpos version/build, licence/module entitlement and supported order-ingress mechanism confirmed by Idealpos/Oolio or the reseller.
- Venue connector paired with revocable installation identity, outbound mutual TLS and encrypted local durable queue.
- One immutable Verdura order version durably accepted for Idealpos before normal KDS/KOT release.
- Standard journey proven: Verdura → Idealpos → KDS/station KOT → existing Idealpos-integrated EFTPOS/cash → payment reconciliation.
- Online journey proven: server-verified provider payment → Idealpos `PREPAID / ONLINE` → KDS/station KOT, retaining both transaction references.
- Transactional outbox and durable idempotency prevent duplicate Verdura orders, Idealpos sales and KOTs across retries/restarts.
- Verdura owns KDS/KOT routing for Verdura-originated orders; Idealpos duplicate kitchen printing is disabled or formally deduplicated.
- Independent, truthful POS, payment, KDS and per-printer delivery states are visible to staff.
- Uncertain POS outcomes, online-paid/POS-failed cases, voids, refunds, reprints and emergency mode have authorized recovery procedures.
- Cross-tenant/venue, connector revocation, outage/replay, backup/restore, security and real hardware tests pass with retained evidence.

## Current verdict

Demonstration with prototype labels remains acceptable. Real payments, live Idealpos handoff and production kitchen printing remain blocked until every applicable gate above is evidenced and a new dated approval is issued. No previous score, agent sign-off or simulated load result overrides this decision.
