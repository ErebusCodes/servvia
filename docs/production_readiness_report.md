# Verdura Production Readiness Report

> **Readiness target — 2026-08-15:** Production assessment is now measured against the [Target Operating Model](./target-operating-model.md), including Idealpos-first in-person flow, verified online-prepaid tender mapping, connector-before-kitchen acceptance, station-correct KOT fan-out, duplicate suppression and three-way payment/order reconciliation.

**Original report date:** 2026-06-21

**Reassessment date:** 2026-08-15

**Status:** NOT PRODUCTION-READY

**Approved operating classification:** Controlled prototype; suitable for demonstrations and restricted non-payment testing

---

## 1. Correction Notice

This report supersedes the former `98/100 PRODUCTION-READY` assessment. That conclusion counted simulated integrations and isolated code paths as completed production capability. Direct source verification shows material release blockers.

The authoritative detailed baseline and acceptance criteria are in [mvp.md](./mvp.md).

## 2. Executive Verdict

Verdura has a credible technical foundation and a functioning menu, reservation, order and KDS spine. It is not approved for real-money kiosk operation, real POS synchronization, production kitchen printing, or enterprise multi-location rollout.

| Operating scenario | Verdict |
| --- | --- |
| Product demonstration using non-production data | **Approved with prototype labels** |
| Internal venue workflow trial with payment/POS disabled | **Conditionally acceptable** |
| Supervised design-partner pilot | **Blocked pending P0 closure** |
| Real-money kiosk deployment | **Not approved** |
| POS-connected production operation | **Not approved** |
| Enterprise multi-location rollout | **Not approved** |

## 3. Verified Strengths

- NestJS/PostgreSQL/Redis/Docker development foundation exists.
- Environment validation and database startup checks fail closed.
- JWT authentication, refresh cookies, Argon2 passwords, CORS, CSRF middleware and rate limiting provide a useful baseline.
- Previous hard-coded authentication bypass has been removed and admin route protection restored.
- Server-side order repricing avoids trusting submitted base prices.
- Order and reservation finite-state transitions exist.
- Menu, reservation, table, order, KDS and Order Tablet paths have real backend integration.
- WebSocket venue-room authorization exists for KDS devices.
- Automated unit test baseline on 2026-08-15: 279 backend tests and 30 admin frontend tests passed.

## 4. Release Blockers

### P0-1 — Online payment lifecycle remains incomplete

The server now retrieves Stripe PaymentIntents and checks success, amount and NZD currency, with provider failures failing closed. Durable one-payment-to-one-order enforcement, signed webhook processing, refund lifecycle and settlement reconciliation are still incomplete. In-person payment must instead be reported from Idealpos and must not be inferred from kitchen state.

**Gate:** disable real-money checkout or implement server-authoritative checkout, unique payment linkage, provider retrieval, signed webhooks and replay-safe reconciliation.

### P0-2 — POS success is fabricated

The non-null POS worker delays briefly, invents an Idealpos ID and marks synchronization successful.

**Gate:** report `Unsupported`/`Manual` until a genuine provider adapter records delivery, acknowledgement and confirmation separately.

### P0-3 — Edge connector is absent

There is no paired, revocable, venue/provider-bound edge installation with outbound TLS, local durable queue, heartbeat, capability probe or offline replay evidence.

**Gate:** implement and pass pairing, revocation, restart, duplicate, outage and reconnect tests.

### P0-4 — Printing is not deliverable in production

Order creation persists PrinterJob rows but does not enqueue BullMQ jobs. The cloud worker cannot reliably reach private venue printers and mocks unsupported connection types.

**Gate:** implement venue-edge printing, durable local retries and real hardware acknowledgement—or explicitly exclude printing from the pilot.

### P0-5 — Agreed Idealpos-first operating flow is not implemented

The product requires standard orders to be durably accepted by the connector for Idealpos submission before KDS/KOT release, followed by existing Idealpos/EFTPOS payment. Online-paid orders require `PREPAID / ONLINE` tender mapping and both external references. The current code does not implement this orchestration or its transactional outbox.

**Gate:** pass both end-to-end payment journeys on the actual Idealpos installation, EFTPOS path, KDS and preparation-station printers without duplicate transactions or tickets.

**2026-08-16 addendum:** a proposed, unproven, Verdura-managed API-less interim adapter (Windows Connector + interactive Idealpos POS Bridge) is now specified in `docs/integrations/idealpos.md` §13–§18 as an alternative to a vendor-supported interface, in response to newly recorded local Idealpos installation evidence (§12). This is architecture, not evidence of a working connection — it does not close this gate, and is itself gated by live discovery and a non-production tracer bullet (story `9-2`) before any production commitment.

### P0-6 — Idempotency and concurrency are unsafe

Universal `Idempotency-Key` behavior is absent. Order numbering uses read-then-increment. Reservation capacity check and insertion are not serialized.

**Gate:** add durable idempotency results, database-backed number series and transactionally safe capacity allocation.

### P0-6 — Venue authorization and tenant isolation are incomplete

Staff authorization is based on coarse roles and is generally organization-wide. `VenueAccess` is not comprehensively enforced. Tenant isolation depends primarily on query discipline.

**Gate:** enforce venue grants at REST, WebSocket, file and background-job boundaries and pass adversarial cross-tenant tests.

## 5. Enterprise Readiness Gaps

- no permission-code RBAC/FGA or separation-of-duties engine;
- no SSO/SCIM, joiner-mover-leaver automation or access reviews;
- no database-enforced tenant context or brand/region hierarchy;
- no universal append-only, hash-chained audit service;
- no signed webhook consumer lifecycle or API-key management;
- no capability matrix, reconciliation queue or integration incident model;
- no verified backup restoration evidence or declared measured RPO/RTO;
- no production evidence for outage, replay, load or concurrency behavior; and
- significant mock/simulated state remains in non-core admin surfaces.

## 6. Validation Position

Passing unit tests confirms useful component behavior, not production readiness. Production approval requires:

- database integration tests against PostgreSQL and Redis;
- critical browser/device end-to-end journeys;
- Stripe webhook and replay tests;
- simultaneous order and reservation tests;
- provider timeout, rejection and price-conflict tests;
- edge restart and offline replay tests;
- real printer hardware tests;
- cross-tenant authorization tests; and
- backup restoration and rollback drills.

Full build/type-check verification was not rerun during the 2026-08-15 assessment because the supplied project directory was initially read-only. This is an assessment limitation, not a product defect.

## 7. Corrected Readiness Assessment

| Area | Indicative maturity |
| --- | ---: |
| Product strategy | 8/10 |
| Core backend foundation | 6/10 |
| Menu/reservation/order/KDS workflow | 6/10 |
| Real payment and provider integration | 2/10 |
| Enterprise identity, tenancy and audit | 3/10 |
| Operational/deployment readiness | 4/10 |
| Overall against PRD v5.2 Phase 1A | approximately 45% |

These figures are directional decision aids, not earned compliance scores.

## 8. Recommendation

Do not launch the current build with real payments or configured POS adapters.

Concentrate the next delivery milestone on:

1. verified payment or explicit payment disablement;
2. idempotent canonical order handoff;
3. one genuine provider/edge acknowledgement path;
4. multi-channel availability propagation;
5. reconciliation, queue health and incident visibility;
6. venue and tenant isolation;
7. correlated append-only audit evidence; and
8. controlled outage/replay testing with one design partner.

Only after these gates pass should Verdura seek production approval or expand later-phase enterprise modules.
