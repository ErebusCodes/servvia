# Servvia — MVP Definition and Readiness Baseline

> **Normative MVP decision — 2026-08-15:** Build the MVP to the [Target Operating Model](./target-operating-model.md): Idealpos-first handoff for ordinary in-person orders, Servvia-owned KDS/KOT fan-out after durable connector acceptance, existing Idealpos-integrated EFTPOS for default payment, and optional verified online prepayment mapped to `PREPAID / ONLINE`. Servvia retains all cross-system identifiers and independent delivery/payment states.

**Original Date:** 2026-06-18

**Assessment Revision:** 2026-08-15

**Status:** Controlled prototype; not approved for production or real-money operation

**Strategic Authority:** Verdura PRD v5.2, especially Volumes 00, 02 and 09 and the Idealpos appendix

---

## 1. Purpose

This document defines the smallest credible Servvia MVP, records the verified state of the current repository, and establishes the gates for a supervised design-partner pilot.

It supersedes the previous checklist wherever that checklist marked simulated, disconnected, or non-existent capability as complete. A feature is not complete merely because its UI exists, a database row is created, or a mock adapter returns success.

Servvia is a **provider-neutral operational control and reconciliation layer for multi-location restaurant groups operating heterogeneous provider ecosystems**. It is not a POS replacement, payment processor, restaurant website, or collection of dashboard mock-ups.

## 2. Non-Negotiable MVP Principles

1. **Never fake success.** A provider operation is `Unsupported`, `Manual`, `Queued`, `Delivered`, `Acknowledged`, `Confirmed`, or in an explicit failure state. A fabricated external ID is never synchronization.
2. **The POS owns fiscal truth.** Servvia may quote a price and control operational workflow, but the configured POS or payment provider owns accepted totals, tax, rounding, payment, refund, receipt, and settlement facts after acknowledgement.
3. **The server owns validation.** Prices, payment state, tenancy, permissions, mappings, transitions, and idempotency are never trusted to a browser or device.
4. **Tenant and venue scope are enforced at every boundary.** UI visibility is not authorization.
5. **Externally acknowledged facts are corrected through explicit compensating actions, not silent edits.**
6. **Phase gates are real.** Prototype modules outside the active phase cannot be counted toward MVP completion.

## 3. MVP Goal

Prove with one committed design partner that Servvia can safely control and observe a high-value cross-system restaurant workflow:

1. ingest or capture an order using a provider-neutral canonical model;
2. validate item, modifier, order-type, venue, and provider mappings;
3. hand the order to a real configured POS through a secure connector;
4. distinguish delivery, acknowledgement, confirmation, rejection, timeout, and conflict;
5. show the same truthful state to operations staff;
6. propagate an availability change to at least two real channels and report each acknowledgement independently;
7. recover from network interruption without losing or duplicating an order; and
8. produce attributable audit and reconciliation evidence.

The existing menu, reservation, kiosk, Order Tablet, KDS, and admin workflows support this goal, but do not replace the integration and reconciliation proof.

## 4. Target Customer and Buying Outcome

**Initial customer:** a multi-location or multi-brand restaurant group with central operations or technology ownership, material manual reconciliation, and at least two POS, ordering, delivery, payment, accounting, or workforce ecosystems.

**Primary buyer:** owner, COO, operations leader, or restaurant-technology leader.

**MVP must demonstrate:**

- fewer lost, duplicated, stuck, or mismatched orders;
- faster detection and resolution of integration failures;
- less manual re-entry across providers;
- truthful, attributable recovery actions;
- safer provider migration or coexistence; and
- measurable reduction in preventable leakage or operational labour.

A single restaurant using `NullAdapter` is useful for product testing, but does not validate the enterprise buying thesis.

## 5. Status Vocabulary

| Status | Meaning |
| --- | --- |
| **Verified** | Real implementation, persistent state, relevant automated tests, and no known critical gap in the stated scope |
| **Implemented** | Real code path exists, but production or end-to-end evidence remains incomplete |
| **Partial** | Some required layers are real while another is missing, disconnected, or unsafe |
| **Prototype** | UI or workflow demonstration backed wholly or partly by mock/local state |
| **Not implemented** | Required capability is absent |
| **Blocked** | Requires a provider decision, credential, hardware, design-partner environment, or declared dependency |

## 6. Verified Current State

### 6.1 Backend and platform

| Capability | Status | Assessment |
| --- | --- | --- |
| NestJS, PostgreSQL/Prisma, Redis/BullMQ, Socket.io and Docker development stack | **Implemented** | Coherent foundation with startup validation and health checking |
| JWT authentication, refresh cookie and coarse role guard | **Implemented** | Suitable baseline; not the permission-code/FGA model required for enterprise rollout |
| KDS device authentication and venue-scoped WebSocket access | **Implemented** | Signed device token and venue-room checks exist |
| Organization and venue scoping | **Partial** | Principal queries are commonly organization-scoped; database isolation and staff venue-grant enforcement are incomplete |
| Venues, tables and menu CRUD | **Implemented** | Real persistence and admin API wiring exist |
| Order creation, server-side repricing and order FSM | **Implemented** | Strong core path; payment, idempotency, numbering and POS confirmation remain unsafe/incomplete |
| Reservation CRUD, capacity check, FSM and email queue | **Implemented** | Real persistence; simultaneous bookings can race because capacity check and insert are not serialized |
| Audit logging | **Partial** | Useful log table exists; it is not append-only/tamper-evident or universal |
| Structured API v1 contract | **Not implemented** | No documented versioning, stable domain error envelope, cursor pagination, or universal idempotency |

### 6.2 Applications

| Capability | Status | Assessment |
| --- | --- | --- |
| Customer menu | **Implemented** | Reads the backend-resolved menu |
| Public reservation journey | **Implemented** | Calls the backend and persists reservations |
| Kiosk menu, table selection, cart and order submission | **Partial** | Real order persistence; real-money verification is unsafe |
| KDS live feed and state transitions | **Implemented** | Real REST/WebSocket path with venue-scoped device authentication |
| Admin authentication | **Implemented** | Named staff sign-in with self-set passwords (Stories 2.4, 8.1); the shared admin PIN is removed; no SSO |
| Admin orders, reservations, menu and table management | **Implemented/Partial** | Principal paths use backend APIs; enterprise controls remain absent |
| Order Tablet submission and status updates | **Implemented** | Current version calls backend order endpoints |
| Dashboard, reports, inventory, payments, staff, audit and integration surfaces | **Prototype/Partial** | Significant mock, simulated, or local state remains |

### 6.3 Integrations and edge operations

| Capability | Status | Assessment |
| --- | --- | --- |
| Stripe PaymentIntent creation | **Partial — release blocker** | Request is bounded/rate-limited and provider failures now fail closed; creation still begins from a client cart total |
| Stripe verification on order creation | **Partial — release blocker** | Provider status, amount and currency are now verified against the server-repriced order; durable intent uniqueness/replay prevention is still missing |
| Stripe webhook reconciliation | **Not implemented** | No signed webhook lifecycle or provider reconciliation path |
| POSSyncRecord persistence | **Implemented** | Database record is created for configured adapters |
| BullMQ POS dispatch | **Not implemented** | Order creation does not add records to the POS queue |
| Real Idealpos adapter (vendor-supported) | **Not implemented/Blocked** | Provider contract, environment and acceptance evidence are required (DL-064) |
| Idealpos API-less interim adapter (Windows Connector + POS Bridge) | **Proposed architecture only — not implemented, unproven** | Local installation inspection (2026-08-16) confirms capability, not availability; gated by live discovery and tracer bullet story `9-2` before any production use (`docs/integrations/idealpos.md` §12–§21) |
| Current non-null POS processor | **Unsafe simulation** | Fabricates an Idealpos ID and marks success; must never run in production |
| PrinterJob persistence | **Implemented** | Order creation writes queued records |
| BullMQ print dispatch | **Not implemented** | Order creation does not add print jobs to BullMQ |
| Venue printer service and durable local queue | **Not implemented** | No production on-premises agent exists in this repository |
| Cloud-to-LAN printing | **Invalid for production** | Cloud backend cannot be expected to connect to private venue printers |
| Availability fan-out and acknowledgement | **Not implemented — core Phase 1A gap** | Local availability exists; real write-back and reconciliation do not |
| Edge pairing, installation identity, durable queue and heartbeat | **Not implemented** | Required for on-premises Idealpos and printing reliability |

## 7. Critical Findings and Required Remediation

### F-01 — Payment verification remains incomplete

Following the 2026-08-15 status-report review, real server modes now retrieve the PaymentIntent, require `succeeded`, and verify NZD amount against the server-repriced order. Missing configuration and Stripe errors fail closed; fabricated token fallbacks were removed. The PaymentIntent is not yet stored uniquely on the order and signed webhook reconciliation is absent, so replay and asynchronous provider changes remain release blockers.

Required remediation:

- calculate checkout totals exclusively on the server;
- persist a payment record linked uniquely to the order;
- retain the implemented status/currency/amount verification and add required metadata binding;
- reject reused or mismatched intents;
- implement signed Stripe webhooks and reconciliation;
- retain fail-closed production Stripe configuration; and
- add automated provider failure, mismatch and replay tests.

### F-02 — POS synchronization violates the truthfulness doctrine

The current processor invents an `IDEAL-*` identifier and marks the record synchronized. Replace it with `Unsupported` or `Manual` until a genuine adapter and acknowledgement contract exist.

### F-03 — The defining Phase 1A availability wedge is absent

Servvia can update local availability, but cannot fan out an 86 action to real ordering channels, track acknowledgements independently, expose partial failure, or reconcile provider truth.

### F-04 — Print delivery has a producer gap and an invalid deployment boundary

PrinterJob rows are persisted but not placed on BullMQ. The backend worker attempts direct TCP printing from the cloud process. Production requires an outbound-only venue edge service with durable local queueing and explicit acknowledgement.

### F-05 — Enterprise authorization is not implemented

Current roles are coarse and staff access is organization-wide in the primary scope helper. Permission codes, venue grants, separation of duties, object overrides, expiry and access reviews remain incomplete.

### F-06 — Tenancy is primarily an application convention

Organization predicates exist in major services, but data-layer enforcement, brand/region hierarchy, tenant-aware constraints and adversarial isolation tests are missing.

### F-07 — Audit evidence is incomplete

The AuditLog table lacks append-only database enforcement, hash chaining, correlation IDs, nightly verification, signed exports and universal mutation coverage.

### F-08 — Concurrency and idempotency can cause duplicates or conflicts

Reservation capacity is checked before insertion without serialization. Order numbers are allocated by reading and incrementing the latest order. POST endpoints lack the documented universal `Idempotency-Key` behavior.

### F-09 — Prototype screens can be mistaken for completed capability

Pilot-visible mock surfaces must carry an unmistakable prototype label or be disabled behind phase gates.

### F-10 — Implementation has drifted from the documented API contract

The current API uses `/api` and framework errors rather than `/api/v1`, stable domain codes, action subresources, cursor pagination, permission scopes and signed webhooks.

## 8. MVP Scope

### 8.1 Required for the design-partner pilot

- canonical order capture with immutable price snapshot;
- real provider mapping validation;
- real POS handoff through a secure adapter or edge connector;
- distinct delivery, acknowledgement, confirmation, rejection and conflict states;
- reconciliation queue for failed, stuck and mismatched orders;
- one real multi-channel availability-control workflow;
- authenticated Order Hub and KDS with venue-scoped access;
- idempotent submission and offline replay;
- real payment verification whenever payment is enabled;
- append-only audit evidence for pilot-critical mutations;
- integration health, queue-age and failure alerts; and
- measured outcomes against a pre-pilot baseline.

### 8.2 Supporting scope worth retaining

- persistent menus, tables and venue configuration;
- public reservations and operational reservation management;
- customer/kiosk menu browsing;
- staff Order Tablet;
- transactional reservation email;
- containerized local development; and
- health checks and automated unit tests.

### 8.3 Explicitly deferred until phase gates are met

- full Material Management, Recipe and Production;
- procurement and supplier intelligence;
- Finance and accounting subledger;
- Reports and BI forecasting;
- CRM and Loyalty;
- Workforce;
- enterprise SSO/SCIM and formal access-review campaigns; and
- any module implemented primarily as an attractive mock rather than a validated buying outcome.

Prototype screens may remain for discovery, but are not production scope and cannot contribute to MVP completion.

## 9. Pilot Acceptance Criteria

### 9.1 Order and POS handoff

- [ ] A canonical order is submitted with a unique idempotency key.
- [ ] For in-person payment, connector durable acceptance and Idealpos submission occur before the existing Idealpos/EFTPOS payment workflow; payment remains pending until reported by Idealpos.
- [ ] Connector acceptance is the default boundary before KDS/KOT release, and the same immutable order version reaches all destinations.
- [ ] Repeating the request returns the original result and creates no duplicate order or POS sale.
- [ ] Missing mappings block handoff with a stable error and reconciliation task.
- [ ] Delivery, acknowledgement and confirmation timestamps are independently recorded.
- [ ] POS authoritative totals, tax, rounding, receipt and payment state are stored without overwriting Servvia's original quote.
- [ ] Price mismatch follows an explicitly approved conflict policy.
- [ ] No production path can report a simulated provider operation as successful.

### 9.2 Payment

- [ ] Existing Idealpos-integrated EFTPOS/cash is the default in-person path; Servvia never treats preparation or POS handoff as payment success.
- [ ] PaymentIntent amount and currency equal the server-computed total.
- [ ] Payment status is verified server-side before confirming a prepaid order.
- [ ] Verified online payments are mapped to the configured Idealpos `PREPAID / ONLINE` tender, and both provider transaction references are retained.
- [ ] One PaymentIntent cannot create more than one order.
- [ ] Signed webhook replay is idempotent.
- [ ] Missing or failing Stripe configuration fails closed in production.
- [ ] If these criteria are unmet, real-money kiosk checkout is disabled.

### 9.3 Availability control

- [ ] One 86 action reaches at least two real configured channels.
- [ ] Each channel independently displays `Pending`, `Confirmed`, `Failed`, `Conflict`, `Unsupported`, or `Manual`.
- [ ] Partial failure creates an attributable recovery action.
- [ ] Propagation target p95 is below 30 seconds.

### 9.4 Edge and offline recovery

- [ ] Connector uses outbound-only TLS and a revocable, venue/provider-bound identity.
- [ ] Local durable queue survives process and machine restart.
- [ ] Internet loss does not lose or duplicate commands.
- [ ] Reconnect preserves command order and idempotency.
- [ ] Heartbeat, versions, queue depth and oldest queued age are visible.

### 9.5 Printing

- [ ] Order creation produces a consumable print command.
- [ ] Each order line is routed once to the preparation station configuration captured with that order version.
- [ ] Idealpos does not duplicate Servvia-originated KOT printing.
- [ ] Venue edge service prints on the real kitchen printer.
- [ ] Printed acknowledgement is distinct from command delivery.
- [ ] Offline retries are durable and visible.
- [ ] End-to-end latency is validated on actual venue hardware.

### 9.6 Security, tenancy and audit

- [ ] Staff access is restricted to explicitly granted venues.
- [ ] Cross-tenant tests cover REST, WebSockets, files and background jobs.
- [ ] Every pilot-critical mutation emits an append-only, correlated audit event.
- [ ] Production secrets are externally managed and none are committed.
- [ ] Access-token revocation risk and KDS device lifecycle are documented and tested.

### 9.7 Reliability and operations

- [ ] Unit, database integration and critical browser/device journeys run in CI.
- [ ] Concurrent booking and order tests show no overbooking or number collision.
- [ ] Queue failure, provider timeout, Redis outage and reconnect tests pass.
- [ ] Backup restoration is rehearsed against declared RPO/RTO.
- [ ] Monitoring alerts on stuck orders, connector heartbeat, DLQ age, payment reconciliation and API errors.

## 10. Prioritized Delivery Plan

### P0 — Before any real-money or POS-connected pilot

1. Establish the supported Idealpos order-ingress contract, mappings, transaction reference and `PREPAID / ONLINE` tender with Idealpos/Oolio or the reseller — or, if pursuing the API-less interim adapter instead, complete live Windows discovery (`docs/discovery/idealpos-live-discovery-checklist.md`) and the non-production tracer bullet (story `9-2`) before any production commitment (`docs/integrations/idealpos.md` §21, DL-068).
2. Implement the venue connector, its durable acceptance boundary and transactional fan-out to POS, KDS and station KOT jobs.
3. Implement Stripe verification, webhook reconciliation and replay protection, or disable optional online checkout while retaining Idealpos/EFTPOS in-person payment.
4. Remove fabricated POS and printer success from production paths.
5. Implement database-backed idempotency and concurrency-safe order numbering.
6. Serialize reservation capacity enforcement and enforce venue/tenant access.

### P1 — Before supervised design-partner go-live

1. Implement one real provider adapter and edge installation lifecycle.
2. Deliver the multi-channel availability wedge.
3. Build reconciliation queue, retry/DLQ controls and incident visibility.
4. Complete venue-edge printing or formally exclude it from pilot scope.
5. Make pilot-critical audit events append-only and correlated.
6. Add end-to-end, outage, replay and concurrency tests.
7. Establish customer-value metrics, not merely technical activity metrics.

### P2 — Before multi-location enterprise rollout

1. Introduce permission-code RBAC/FGA, separation of duties and access reviews.
2. Enforce tenant isolation at the data/repository layer.
3. Version the API and implement stable error, pagination and webhook contracts.
4. Add connector rollout, upgrade, revocation and compatibility management.
5. Implement signed audit exports, retention and hash-chain verification.
6. Complete disaster-recovery exercises and operational runbooks.

## 11. Success Metrics

Capture a pre-pilot baseline and report:

- manual reconciliation hours per venue-week;
- count and value of lost, duplicated, stuck or mismatched orders detected;
- median and p95 integration incident resolution time;
- exceptions resolved without manual data re-entry;
- order handoff acknowledgement and confirmation rates;
- oldest queued command during trading;
- 86 propagation p50/p95 and per-channel success;
- duplicate-order rate after retry/reconnect;
- KDS routing latency p95;
- print latency and failure rate when printing is in scope; and
- audit-event coverage and integrity verification.

Connector count, dashboard visits and raw event volume are diagnostic metrics, not buying outcomes.

## 12. Verification Baseline

Assessment performed against repository state on 2026-08-15.

- Backend unit tests: **279 passed across 34 suites**.
- Admin frontend tests: **30 passed across 6 files**.
- Corrected historical findings include restored admin route protection, removal of the hard-coded JWT bypass, removal of tracked sensitive environment variants, and real menu/reservation/Order Tablet API wiring.
- Full build/type-check verification was not rerun because the supplied project directory was initially read-only. This is not classified as a product defect.
- Existing uncommitted application and image changes were not modified.

### 12.1 Claude status report reconciliation

`VERDURA_MVP_STATUS_REPORT.md` dated 2026-08-14 was reviewed as evidence, not instructions. Material claims were rechecked against current source. This update applied the supported, non-destructive fixes:

- corrected the kiosk `useMemo` hook-order crash;
- made Docker copy all shared assets and made `VITE_VENUE_ID` a build argument;
- added an nginx `/media/` proxy;
- fixed live category icon lookup and drinks-category matching;
- added an honest reservation-menu failure state;
- repaired and exposed the canonical menu validation command;
- moved the admin access token from localStorage to memory-only state;
- rate-limited public kiosk reads/order/payment setup and rejected inactive venues;
- validated payment-intent request bounds and made Stripe fail closed;
- added real Stripe status/amount/currency verification before order confirmation;
- validated that an explicitly selected reservation table belongs to the venue;
- corrected README setup, local hostnames, reset guidance and payment/printing claims; and
- added repository hygiene ignores without deleting user files or rewriting Git history.

Still open from that report: PaymentIntent replay prevention and webhooks, POS/print queue producers and edge agents, cookie-based kiosk configuration, mock admin surfaces, database indexes/RLS decision, refresh-token revocation, comprehensive role/venue UI gating, audit coverage, E2E tests, asset optimization/case cleanup, and external credential rotation.

Passing unit tests do not establish pilot readiness. Section 9 requires integration, hardware, concurrency, outage and reconciliation evidence.

## 13. MVP Definition of Done

The Servvia MVP is complete only when:

- [ ] every P0 item is closed;
- [ ] every enabled provider and payment path fails closed and never fabricates success;
- [ ] Phase 1A order and availability workflows pass all pilot acceptance criteria;
- [ ] tenancy, venue access, idempotency and audit controls cover every pilot-critical path;
- [ ] one design partner completes controlled outage and replay tests in a representative environment;
- [ ] operational runbooks, monitoring, backup restoration and rollback are verified;
- [ ] prototype/deferred modules are visibly gated;
- [ ] pilot metrics show reduced reconciliation effort, incident time or preventable leakage; and
- [ ] the design partner and Servvia jointly sign the go-live readiness record.

Until then, the correct external description is:

> **Servvia is a controlled operational prototype with a functioning menu, reservation, order and KDS foundation. It is progressing toward a provider-neutral design-partner MVP and is not yet approved for production payment or POS-connected operation.**
