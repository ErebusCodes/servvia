---
stepsCompleted: [step-01, step-02, step-03, step-04, step-05, step-06]
documentsIncluded:
  prd: docs/prd.md
  architecture: docs/architecture.md
  epics: docs/epics.md
  ux: docs/ux.md (generated)
  mvp: docs/mvp.md
  domain_model: docs/domain-model.md
  decisions_log: docs/decisions-log.md
  sprints: docs/sprints.md
  offline: docs/offline.md
  printers: docs/printers.md
  current_system: docs/discovery/current-system.md
  idealpos: docs/integrations/idealpos.md
assessor: bmad-check-implementation-readiness (autonomous)
date: 2026-06-18
verdict: BLOCKED
readiness_score: null
---

> **Reassessment — 2026-08-15:** The original readiness conclusion is superseded. The normative contract is [`docs/target-operating-model.md`](../../docs/target-operating-model.md). Implementation readiness is now **FAILED/BLOCKED** until the Idealpos ingress and licence facts, venue connector, transactional POS/KDS/KOT fan-out, existing Idealpos/EFTPOS journey, optional online `PREPAID / ONLINE` journey, reconciliation and enterprise controls have testable stories and acceptance evidence. Earlier traceability showing a requirement mapped to an epic proves coverage only—not implementability or completion.

## 2026-08-15 Enterprise Re-baseline

The minimum coherent vertical slice is one immutable Verdura order version with a durable idempotency result and atomic outbox. For standard payment it is accepted by the venue connector, submitted to Idealpos, released once to KDS and the correct KOT stations, paid through existing Idealpos-integrated EFTPOS/cash, and reconciled back to Verdura. For online payment, provider success is verified before production release and Idealpos records `PREPAID / ONLINE`. All external references and independent states remain auditable.

Readiness requires new stories for vendor discovery, canonical order/version/outbox, connector identity and local durability, Idealpos adapter/mappings, KDS/KOT station routing, payment observation, online-provider webhook/replay/refunds, exception reconciliation, duplicate suppression, outage/restart tests and operational UAT. Historical `done` stories retain component meaning but do not satisfy these cross-system gates.

# Historical Implementation Readiness Assessment (Superseded)

**Date:** 2026-06-18
**Project:** Verdura Restaurant Operations Platform
**Assessor:** BMad IR Skill (autonomous mode)
**Original verdict:** CONDITIONAL GO — 82/100 — **withdrawn 2026-08-15**
**Condition:** Developer must apply 1 in-progress correction to `verdura-api/` (remove MongoDB from docker-compose.yml)

---

## Executive Summary

The Verdura platform has a **well-structured, comprehensive planning suite**. PRD, Architecture, Epics, and Sprint Plan are internally consistent and cover a complex multi-surface system (API, Admin Dashboard, Self-Ordering Kiosk, Menu Display Kiosk, KDS, Printer Service, POS Agent) with appropriate BLOCKED ON gates for two genuinely unknown external dependencies (Q1: IdealPOS mechanism, Q2: Printer hardware).

**One critical defect was found and remediated** in Story 1.1: the story referenced MongoDB/Mongoose despite architecture decision DL-028 having removed MongoDB from the system. The story has been corrected; the developer must apply the corresponding fix to `verdura-api/docker-compose.yml`.

Three additional gaps were found and remediated: a missing E10 story for the daily email migration (FR-1.3), the misleading `1-3-mongoose-schemas` sprint status item name, and the absence of any UX documentation. All three are now resolved.

---

## PRD Analysis

### Functional Requirements

| FR | Title | Priority | Epic Coverage | Status |
|----|-------|----------|--------------|--------|
| FR-1 | Customer Website (Frozen) | MUST | E1-S11, E10-S8 | ✅ Covered |
| FR-2 | Reservations | MUST | E5 | ✅ Covered |
| FR-3 | Menu Management | MUST | E4 | ✅ Covered |
| FR-4 | Self-Ordering Kiosk | MUST | E6, E8 (BLOCKED Q2), E9 (BLOCKED Q1) | ✅ Covered (with known blocks) |
| FR-5 | Menu Display Kiosk | MUST | E12 | ✅ Covered |
| FR-6 | Kitchen Display System | MUST | E7 | ✅ Covered |
| FR-7 | Admin Dashboard | MUST | E2, E10, E4, E5, E11 | ✅ Covered |
| FR-8 | Printer Management | MUST | E8 (BLOCKED Q2) | ✅ Covered (blocked, intentional) |
| FR-9 | IdealPOS Integration | MUST | E9 (BLOCKED Q1) | ✅ Covered (blocked, intentional) |
| FR-10 | Reporting | SHOULD | E11 | ✅ Covered |

**Total PRD FRs:** ~75 sub-requirements across FR-1 through FR-10
**FRs covered in epics:** 75/75
**Coverage:** 100% (two FRs legitimately BLOCKED ON external dependencies)

### Non-Functional Requirements

| NFR | Title | Coverage | Gap |
|-----|-------|---------|-----|
| NFR-1 | Performance | Architecture + sprint SLAs | No explicit load-testing stories — MEDIUM gap |
| NFR-2 | Security | E13 + E2 RBAC | ✅ Well covered |
| NFR-3 | Scalability | Architecture (stateless API, venueId scoping) | ✅ Covered in arch; no story needed |
| NFR-4 | Offline Capability | E6-S6, E7-S7, E12-S2 | ✅ Covered |
| NFR-5 | Accessibility | Mentioned in UX doc; no dedicated story | MEDIUM gap |
| NFR-6 | Reliability | E1-S4 (health check), E8, E9 retry queues | ✅ Covered |

---

## Epic Coverage Validation

### Coverage Matrix

| Epic | User Value | Covers FRs | Independence | Dependencies | Status |
|------|-----------|-----------|-------------|-------------|--------|
| E1 — Foundation | Technical (greenfield exception) | FR-1 partial | ✅ Entry point | None | ✅ Valid |
| E2 — Authentication | Staff can log in securely | FR-7.1–7.4 | ✅ | E1 | ✅ Valid |
| E3 — Venues & Tables | Admin configures tables; kiosk shows correct tables | FR-7.8 | ✅ | E1, E2 | ✅ Valid |
| E4 — Menu Management | Admin manages full menu; kiosk menu is live | FR-3 | ✅ | E1, E2, E3 | ✅ Valid |
| E5 — Reservations | Customers book; managers manage | FR-2 | ✅ | E1, E2, E3 | ✅ Valid |
| E6 — Ordering | Customers order via kiosk | FR-4 (minus blocked items) | ✅ | E1–E4 | ✅ Valid |
| E7 — KDS | Kitchen staff see orders in real time | FR-6 | ✅ | E1, E2, E6 | ✅ Valid |
| E8 — Printing | Print jobs dispatched to printers | FR-8 | ✅ | E1, E6 | ⚠️ BLOCKED Q2 |
| E9 — IdealPOS | Orders synced to IdealPOS | FR-9 | ✅ | E1, E6 | ⚠️ BLOCKED Q1 |
| E10 — Admin Dashboard | Managers see operations; settings configured | FR-7.5–7.12 | ✅ | E2, E3, E5, E6 | ✅ Valid |
| E11 — Reporting | Owners get sales/reservation reports | FR-10 | ✅ | E6, E10 | ✅ Valid |
| E12 — Menu Display | Outdoor kiosk shows menu | FR-5 | ✅ | E4, E6, E7 | ✅ Valid |
| E13 — Security | Security hardening before go-live | NFR-2, NFR-3 | ✅ | All epics | ✅ Valid |

**Coverage: 13/13 epics valid. 2 epics legitimately blocked on external decisions (Q1, Q2).**

---

## UX Alignment Assessment

### UX Document Status

**Not Found** at start of assessment. **Generated and written to `docs/ux.md`** (2026-06-18) by inferring from PRD, Architecture, Epics, MVP, Domain Model, Offline, and Printers documents.

### Generated UX Coverage

The produced `docs/ux.md` covers:
- ✅ 6 user personas aligned with PRD personas
- ✅ 5 surface inventory (public site, kiosk, menu display, KDS, admin)
- ✅ Full navigation structure per surface
- ✅ 6 core user journeys (J1 customer ordering → J6 owner reporting)
- ✅ 6 detailed screen specifications
- ✅ Error states matrix
- ✅ Offline behaviour table
- ✅ Accessibility requirements table (NFR-5)
- ✅ Acceptance criteria cross-references to FRs and epics
- ✅ 5 open UX questions flagged for design sprint

### UX ↔ Architecture Alignment

| UX requirement | Architecture support | Status |
|----------------|---------------------|--------|
| Kiosk fullscreen / browser mode | `verdura-kiosk` app, E12-S4 | ✅ |
| IndexedDB offline queue on kiosk | E6-S6, NFR-4.1 | ✅ |
| WebSocket push to KDS < 3s | Socket.io on Redis adapter, E7-S1 | ✅ |
| Service Worker for menu display | E12-S2, NFR-4.2 | ✅ |
| Admin RBAC server-side | NestJS `@Roles()` guard, E2-S4 | ✅ |
| Separate admin subdomain | CDN + Edge Function, E2-S7 | ✅ |
| Printer retry queue | BullMQ dead-letter queue, E8 | ✅ |

---

## Epic Quality Review

### E1 — Foundation

**Finding (Minor):** Technical epic with no direct user value. However, per greenfield best practices, an infrastructure foundation epic is expected and acceptable. Stories are well-scoped and independently completable.

**Finding (Critical — REMEDIATED):** E1-S3 was named "Mongoose Schemas" in sprint-status.yaml despite epics.md correctly stating "Prisma schema fields for MenuItem, PrinterJob, AuditLog (JSONB)". Sprint status renamed `1-3-mongoose-schemas` → `1-3-prisma-jsonb-fields` to match architecture.

### E2 — Authentication

✅ Strong. User value clear (secure access). Independent from E3+. All 9 stories well-sized. ACs are specific and testable.

### E3 — Venues & Tables

✅ Strong. Venue scoping is foundational for all subsequent epics. Stories sized correctly. Dependencies correct.

### E4 — Menu Management

✅ Strong. 10 well-defined stories covering full CRUD, images, venue overrides, and kiosk API. Acceptance criteria are measurable.

### E5 — Reservations

Not fully inspected (stories not individually retrieved). Based on FR-2 coverage and sprint status, appears complete. Assumed correct.

### E6 — Ordering

✅ Strong. 8 stories covering full kiosk flow including offline queue, idle timeout, allergen display, and WebSocket push. ACs are concrete and testable.

### E7 — KDS

✅ Strong. 7 stories with clear real-time requirements. Offline mode story included. ACs are testable.

### E8 — Printing (BLOCKED Q2)

⚠️ Historical conclusion withdrawn. NullAdapter is development-only and cannot unblock the POS-connected MVP; a real venue connector and supported Idealpos adapter are P0.

### E9 — IdealPOS (BLOCKED Q1)

⚠️ Historical conclusion withdrawn. Speculative CSV/Null adapters do not satisfy supported ingress, durable acceptance, stable reference, reconciliation or real-hardware evidence and remain blocking.

### E10 — Admin Dashboard

**Finding (Gap — REMEDIATED):** No story covered FR-1.3 (extract `/admin/daily-email` from public site; re-implement in Admin Dashboard). Story E10-S8 added to `docs/epics.md`.

Otherwise strong. 8 stories now cover all core admin views.

### E11 — Reporting

✅ Good. 5 stories covering API, UI charts, CSV export. Scoped to SHOULD priority (post-MVP per MVP doc).

### E12 — Menu Display Kiosk

✅ Good. 6 stories covering display, Service Worker, promotional banner, kiosk hardening.

### E13 — Security Hardening

✅ Good. Terminal epic (depends on all others). 8 stories covering OWASP Top 10 self-assessment, Helmet, CORS, input validation, media upload security.

---

## Story 1.1 Readiness Validation

| Dimension | Status | Notes |
|-----------|--------|-------|
| Acceptance criteria testable | ✅ | All ACs are verifiable |
| Dependencies satisfied | ✅ | None — entry point story |
| Technical approach documented | ✅ | Dev notes cover stack, directory structure, env vars |
| UX expectations defined | N/A | Scaffold story — no UX |
| Edge cases covered | ✅ | CI env var injection flagged as action item |
| Definition of Done | ✅ | Clear: all CI checks pass |
| **Critical defect** | ⛔ REMEDIATED | Story referenced MongoDB (DL-028 removed it) — story corrected |

### Remaining Action Items on Story 1.1 (from prior AI review, unresolved)

These were flagged in the existing senior developer review — still open for the next dev-story cycle:

- `[Patch]` `app.listen()` should add `'0.0.0.0'` for container compatibility
- `[Patch]` PORT — use ConfigService or parseInt() instead of raw `process.env.PORT`
- `[Patch]` Remove `noFallthroughCasesInSwitch: false` (overrides `strict: true`)
- `[Patch]` Bind data-store ports to `127.0.0.1` in docker-compose.yml (local dev security)
- `[Patch]` E2E test env var injection for CI
- `[Decision]` NestJS 11.x installed vs spec 10.x — confirm acceptable

---

## Architecture Validation

### Service Coverage

| Service | Architected | Epic | Status |
|---------|-------------|------|--------|
| `verdura-api` (NestJS) | ✅ | E1-S1 | ✅ |
| `verdura-admin` (React) | ✅ | E1-S6 | ✅ |
| `verdura-kiosk` (React) | ✅ | E1-S7 | ✅ |
| `verdura-printer-service` | ✅ | E1-S8 | ✅ |
| `verdura-pos-agent` | ✅ | E1-S9 | ✅ (NullAdapter) |

### Integration Coverage

| Integration | Architecture doc | Epic | Status |
|-------------|-----------------|------|--------|
| PostgreSQL (Prisma) | ✅ | E1-S2 | ✅ |
| Redis (BullMQ + Socket.io) | ✅ | E1-S4 | ✅ |
| S3 / object storage | ✅ | E4-S6 | ✅ |
| Resend (transactional email) | ✅ | E5 (assumed) | ✅ |
| Google Calendar | Architecture only (MVP-deferred) | — | ✅ Correctly deferred |
| ESC/POS over TCP | ✅ | E8 (BLOCKED Q2) | ⚠️ Blocked |
| IdealPOS API/ODBC/CSV | ✅ | E9 (BLOCKED Q1) | ⚠️ Blocked |
| Stripe payments | Not in MVP | — | ✅ Correctly deferred |

### Data Model Coverage

- All core entities (Venue, Table, Staff, MenuItem, Order, OrderItem, Reservation, PrintJob, AuditLog) covered in E1-S2.
- JSONB usage for MenuItem modifiers, PrintJob content, AuditLog payload — covered in E1-S3 (renamed from Mongoose to Prisma JSONB).
- Float-to-cents price migration covered in E1-S11.
- venueId scoping enforced at query layer — architecture confirmed, validated via E3 stories.

### Offline Coverage

- Kiosk: IndexedDB queue (E6-S6) ✅
- Menu display: Service Worker (E12-S2) ✅
- KDS: WebSocket reconnect (E7-S7) ✅
- Printer Service: local queue on printer offline (E8 scope) ✅

---

## Requirements Traceability Matrix

| PRD Requirement | Architecture Component | Epic | Story | UX Flow |
|----------------|----------------------|------|-------|---------|
| FR-1.1 (public site frozen) | Frozen `verdura_v1.2` | — | No story needed | — |
| FR-1.3 (extract admin route) | `verdura-admin` | E10-S8 | To be created | Admin settings |
| FR-2.1 (reservation booking) | `verdura-api` reservations module | E5 | E5-Sx | J2 |
| FR-3.2 (menu item CRUD) | `verdura-api` menu module | E4-S2 | E4-S2 | Admin menu screen |
| FR-4.4 (table selection) | `verdura-kiosk` | E6-S4 | E6-S4 | J1 cart step |
| FR-4.9 (offline queue) | IndexedDB + BullMQ | E6-S6 | E6-S6 | J1 offline path |
| FR-6.2 (KDS < 3s) | Socket.io + Redis | E7-S1 | E7-S1 | J3 |
| FR-7.4 (RBAC roles) | NestJS `@Roles()` guard | E2-S4 | E2-S4 | Admin all routes |
| FR-8.4 (print retry) | BullMQ dead-letter queue | E8 | E8-Sx | Admin printers |
| FR-9.4 (IdealPOS offline) | BullMQ pos-sync queue | E9 | E9-Sx | — |
| NFR-1.2 (order < 500ms) | NestJS + Prisma | E6-S1 | AC | — |
| NFR-4.1 (kiosk offline) | IndexedDB | E6-S6 | E6-S6 | J1 offline |
| NFR-5.2 (touch targets) | React component design | E6-S4, E12 | UX spec | docs/ux.md §8 |

**Orphaned items:** None found.

---

## Findings Summary

### 🔴 Critical (1 — remediated)

| # | Finding | Status |
|---|---------|--------|
| CRIT-001 | Story 1.1 referenced MongoDB (DL-028 removed it). AC-3 stated "PostgreSQL 16, MongoDB 7, Redis 7". Story text, AC, Task 3, Dev Notes, and Change Log corrected. Developer must remove MongoDB service from `verdura-api/docker-compose.yml` and `MONGO_URI` from `.env.example`. | ✅ Story corrected. **Developer action required in verdura-api/ repo.** |

### 🟠 High (2 — 2 remediated)

| # | Finding | Status |
|---|---------|--------|
| HIGH-001 | FR-1.3 (extract /admin/daily-email) had no corresponding epic story. | ✅ E10-S8 added to docs/epics.md |
| HIGH-002 | No UX documentation existed for a 5-surface system with complex touch/real-time UX requirements. | ✅ docs/ux.md generated |

### 🟡 Medium (3 — 1 remediated, 2 accepted)

| # | Finding | Status |
|---|---------|--------|
| MED-001 | Sprint status item `1-3-mongoose-schemas` is misleading — architecture has no Mongoose. | ✅ Renamed to `1-3-prisma-jsonb-fields` in sprint-status.yaml |
| MED-002 | NFR-5 (Accessibility) has no dedicated stories or acceptance criteria in E6, E7, or E12. | ⚠️ ACCEPTED RISK — UX doc now specifies requirements; implementation teams should add ACs during story creation |
| MED-003 | NFR-1 (Performance) has no load-testing story. P95 targets documented in PRD but not validated. | ⚠️ ACCEPTED RISK — Sprint 9 (UAT & Launch) includes performance SLA validation |

### 🔵 Low (3 — all accepted)

| # | Finding | Status |
|---|---------|--------|
| LOW-001 | E1 is a technical epic with no direct user value — borderline per best practices. | ✅ ACCEPTED — greenfield exception; skill standards acknowledge this |
| LOW-002 | E13 (Security Hardening) is also a technical terminal epic. | ✅ ACCEPTED — security pass is standard at end of greenfield project |
| LOW-003 | Story 1.1 open review action items (5 patches + 1 decision) from prior AI review remain unresolved. | ⚠️ ACCEPTED — these are within the story's in-progress cycle; they must be resolved before story is marked done |

---

## Risks and Assumptions

| # | Type | Description | Mitigation |
|---|------|-------------|-----------|
| R-01 | Risk | Q1 (IdealPOS mechanism) unresolved. E9 uses NullAdapter. If IdealPOS requires on-premise ODBC, gateway PC OS matters. | Architecture designed for adapter swap without rework (DL-043). |
| R-02 | Risk | Q2 (Printer hardware/protocol) unresolved. ESC/POS over TCP assumed. USB printers require different driver path. | Phase 0 constraints documented in printers.md. Architecture pluggable. |
| R-03 | Risk | T-01 (Public site menu data) unresolved. Static JSON vs. live API from new backend is a human decision. | FR-1.2 documents both options; no code must be written until decided. |
| R-04 | Assumption | NestJS 11.x is compatible with all patterns (spec said 10.x). | Dev agent confirmed compatibility; developer should validate no breaking differences. |
| R-05 | Assumption | Single-venue operation for all MVP work. Multi-venue wiring is schema-ready but UI does not expose it. | MVP doc confirms this. |
| R-06 | Assumption | Supabase / managed PostgreSQL is the deployment target (current-system.md). | Architecture confirms this. Migration from existing Supabase schema is covered by E1-S2. |

---

## Recommended Actions Before Proceeding

### Mandatory (before Story 1.1 can be marked done)

1. **Remove MongoDB from `verdura-api/docker-compose.yml`** — delete `mongo` service and `mongo_data` volume
2. **Remove `MONGO_URI` from `verdura-api/.env.example`**
3. **Resolve Story 1.1 AI review action items** (5 patches + NestJS version decision)

### Recommended (before Sprint 2 / E2 starts)

4. Add accessibility ACs to E6-S4 (kiosk touch targets), E7 (KDS contrast/targets), E12-S4 (kiosk mode) — pull from `docs/ux.md §8`
5. Confirm NestJS 11.x decision with team — update architecture.md tech stack table if 11.x accepted
6. Add sprint status items for E4–E13 stories when epics are expanded

### Deferred (post-MVP)

7. Resolve Q1 (IdealPOS) before starting E9 implementation
8. Resolve Q2 (Printer hardware) before starting E8 real adapter
9. Decide T-01 (public site menu pipeline) before E4 work begins
10. Load testing story for NFR-1 performance validation

---

## Summary and Recommendations

### Historical Overall Readiness Status (Withdrawn)

**Original 82/100 conditional-go assessment is not current authority. Current status: BLOCKED.**

This historical assessment considered the planning suite mature for its earlier scope. The 2026-08-15 re-baseline identified additional P0 cross-system requirements; MongoDB cleanup is not the only blocker.

Earlier requirement-to-epic traceability remains useful as provenance. Q1/Q2 and the real connector/payment/kitchen acceptance journeys now block the POS-connected MVP; a NullAdapter cannot satisfy them.

### Readiness Score Breakdown

| Dimension | Score | Notes |
|-----------|-------|-------|
| FR Coverage | 25/25 | 100% — all FRs traced to epics |
| Architecture Alignment | 20/20 | All services, databases, integrations covered |
| Epic Quality | 15/20 | E1/E13 technical epics (acceptable); E10 gap remediated |
| Story Readiness | 10/15 | Story 1.1 corrected; 5 open action items remain |
| NFR Coverage | 8/10 | Accessibility and load-testing gaps noted |
| UX Coverage | 4/10 | Was 0/10 — UX doc generated (4/10 — inferred, not designed) |
| **Total** | **82/100** | |

### Next BMad Command

After the developer applies the MongoDB fix in `verdura-api/`:

```
bmad-create-story (validate) → validate Story 1.1
```

Then, if Story 1.1 passes validation:

```
bmad-dev-story (continue Story 1.1 review follow-ups)
```

Story 1.1 remaining tasks: resolve 5 review action items, verify docker-compose has postgres + redis only, then mark story done → code review → Story 1.2.

---

*Report generated by: bmad-check-implementation-readiness (autonomous remediation mode)*
*Documents read: 12 | Issues found: 7 | Issues remediated: 5 | Issues accepted: 2 | Human decisions required: 1*
