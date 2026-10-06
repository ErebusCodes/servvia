# Epic 15 Context: Canonical identity, provenance and audit (Wave B)

<!-- Generated from planning artifacts. Regenerate with compile-epic-context if planning docs change. -->
<!-- Compiled 2026-10-06 (Story 15.1 objective preparation) from epics.md Epic 15 as reconciled against dff753a and corrected at Story 15.1 preparation; architecture authority is PRD/product-requirements.md Part C. -->

## Goal

Every pilot-critical action is attributable to a truthful actor, every order and round carries its canonical provenance, revocation takes effect on live connections, and Core kitchen routes accept per-device KDS credentials. O-20, O-21, DEC-ADMIN-22, DEC-OPS-21 and the O-13 architecture (with D-3) are decided; their implementation is missing or partial. Authorization and provenance stay separate: stories that derive provenance never widen authorization, and stories that change authorization record no new provenance.

## Stories

- Story 15.1: Core audit records device and system actors truthfully
- Story 15.3: Core derives application identity, operating mode and actor class from the verified credential
- Story 15.2a: O-21 order and round provenance persistence
- Story 15.2b: Domain events carry actor, correlation and causation
- Story 15.2c: Device-originated orders carry no synthetic staff creator (transitional Nest paths)
- Story 15.2d: Check, payment and refund provenance
- Story 15.4a: Core closes live realtime connections when a credential is revoked
- Story 15.4b: Nest revocations signal Core push-close
- Story 15.5: Core kitchen routes accept per-device D8 kds credentials
- Story 15.7: D8 single-use enrollment redemption (device bootstrap)

## Requirements & Constraints

- **Identity classes stay distinct (INV-3):** human staff, customer or guest, device (D8 credential, venue-bound), service or integration, and system (worker or scheduled process). Each action records which class acted. A device identity never acts as a staff member, and a system or worker action never borrows or fabricates a staff identity (O-21 item 4, volume 00 §00.10.6; DEC-OPS-21).
- **Audit (INV-15, NFR-AUD, DEC-X-6):** every security-sensitive, financially significant and configuration mutation emits an append-only, attributable audit record with before and after values, in the transaction of the change where required. Audit provenance identifies actor, actor class and the device where applicable. Every staff financial mutation writes an audit record in the same transaction; payment-adapter results are recorded in the append-only transition histories with the device identity, never as an invented staff actor (FIN-36, volume 07).
- **The existing audit store is reused.** The `AuditLog` actor shape (staff, device, system; CHECK `AuditLog_actor_shape_check`; update rejected by `AuditLog_immutable`) exists since migration `20261010000000_audit_actor_types`. No second transactional audit system is created, and no synthetic Staff row is created for a device or a process.
- **Transitional credentials gain no capability (ADMIN-38).** The Nest tablet and KDS-PIN tokens are not extended. Application identity, mode and actor class are derived by Core from the already-verified credential kind (15.3), never from what a client declares.
- **Provenance (O-21):** orders, rounds, checks, payments, refunds and domain events record application identity, device, operating mode, actor class and identity, and correlation, additively; `order_tablet` stays readable; published migrations are never rewritten and enums are never changed destructively.
- **Revocation (DEC-ADMIN-22, ADMIN-33, NFR-SEC-3):** revoking a credential closes its live realtime connections promptly; this is required before release acceptance.
- **Tests** run on disposable PostgreSQL and Redis, are deterministic, and check behaviour and invariants; no test is deleted, skipped or weakened to make a suite pass.

## Technical Decisions

- Go Core (`services/core-platform`) is the only owner of canonical transactional state and PostgreSQL is authoritative. Prisma (`apps/api/prisma`) stays the only migration authority. The target Core package for audit is `internal/audit/` (Part C §30.3).
- Core's audit writers today record only the staff columns of `AuditLog`; a staff member acting through a PIN-elevated tablet is recorded without the tablet (Story 15.1). Nest already records the truthful actor through `apps/api/src/audit/audit-actor.ts` (tablet staff: staff plus `tablet_device` and its id; unelevated tablet and KDS PIN: device).
- Kitchen transitions are recorded in `KitchenTicketTransition`; payment, refund and reversal results reported by the `payment_adapter` device are recorded in their transition histories with the device id (FIN-36).
- Not in Epic 15: Windows POS authentication (PENDING USER POS ANALYSIS REPORT), Android implementation (Epics 17–19), the web KDS migration (6.1), and native Staff Mode PIN lockout (19.1).

## Cross-Story Dependencies

- Foundations, independent: 15.1 ‖ 15.3 ‖ 15.4a ‖ 15.7.
- 15.1 → 15.5 (kitchen routes accept D8 `kds`, attributed to the device actor through the 15.1 model).
- 15.3 → 15.2a → 15.2b; 15.2a → 15.2d.
- 15.2c is independent of 15.1: it changes the Nest creation paths and uses the existing Nest audit-actor helper.
- 15.4a → 15.4b.
- Consumers later: 6.1 (15.5, 15.7, 16.2); 5.1 and 5.2 (15.3, 15.2a); Epics 9 and 16 (15.2a, 15.2d; 16.3 also depends on 15.1); 17.2 and 19.x (15.3, 15.5, 15.7).
