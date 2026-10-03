# Servvia repository structure (source of truth)

> **Status:** APPROVED — Stage 1 complete; authoritative repository structure. Change records CC-1, CC-2 and CC-3 are APPROVED (section 9.1).
>
> **Authority:** once approved, this document is the authoritative source for where Servvia code belongs. Implementation follows it; it is changed only through [Architecture Change Control](#9-architecture-change-control).
> **Evidence basis:** read-only inspection on 2026-10-01 of commit `a005642` plus the uncommitted working tree (which contains the prepared D13 Checkpoint A and an uncommitted, partial external-POS cleanup).

---

## 1. Purpose

This document fixes the intended structure of the Servvia repository so that:

- architectural ownership stops drifting between sessions and contributors;
- every new piece of work has one agreed home;
- existing code is moved toward that home deliberately, not reinterpreted each time.

The work proceeds in three stages (section 10): **structure → scaffold → implementation**. This document is Stage 1 only.

---

## 2. Governing technology architecture

| Area | Technology |
|---|---|
| Servvia Core POS Platform | Go |
| REST/API services | Go |
| Realtime/WebSocket services | Go |
| Venue Edge / Hardware Orchestration | Go |
| Main POS Terminal | C# / .NET / Windows |
| Waiter Tablet (Staff Mode and Guest Mode; CC-3) | Kotlin / Android |
| Customer Kiosk | Kotlin / Android |
| Kitchen Display System (KDS) | Kotlin / Android |
| Window Display / Promotions | Kotlin / Android |
| Future Venue Device Apps | Kotlin / Android |
| Landing Page | React + TypeScript |
| Admin Console | React + TypeScript |
| Customer Website | React + TypeScript |
| AI / Analytics / Forecasting | Python |
| Transactional Database | PostgreSQL |
| Cache / Coordination | Redis |
| Realtime Communication | WebSockets |
| Media / Promotional Assets | Google Cloud Storage |
| Deployment / Infrastructure | Docker / Containers |

### Architectural invariants

- **Servvia is the operational POS.** There is no external POS in the target architecture.
- **PostgreSQL is authoritative.**
- **Go owns canonical transactional restaurant state** (`services/core-platform`).
- **Clients use Servvia APIs and contracts** (`contracts/`).
- **No client directly owns canonical pricing or directly mutates PostgreSQL.**

---

## 3. Target repository structure

This is the agreed target. It records **structural ownership**: which part of the system owns which kind of code. It is **not** an instruction that every listed directory must exist now (see rules 13–15).

The tree follows the monorepo convention of section 4.2 (CC-2): **deployable artifact type first, platform second.**

The tree establishes architectural ownership and the important project boundaries. It does **not** prohibit small internal implementation-support packages inside a component. For example, `services/core-platform/internal/server/` (HTTP routing) and `services/core-platform/internal/platform/httpx/` (HTTP helpers) are implementation details of `services/core-platform/`, not a separate architectural subsystem.

```
servvia/
│
├── apps/                         deployable client applications: apps/<platform>/<application>/
│   ├── web/
│   │   ├── admin-console/
│   │   ├── customer-website/
│   │   └── landing-page/
│   │
│   ├── windows/
│   │   └── pos-terminal/
│   │
│   └── android/
│       ├── waiter-tablet/
│       ├── kiosk/
│       ├── kds/
│       └── window-display/
│
├── services/                     backend / long-running services: services/<service>/
│   ├── core-platform/
│   │   ├── cmd/
│   │   │   ├── api/
│   │   │   │   └── main.go
│   │   │   └── migrate/
│   │   │       └── main.go
│   │   │
│   │   ├── internal/
│   │   │   ├── identity/
│   │   │   │   ├── auth/
│   │   │   │   ├── users/
│   │   │   │   ├── roles/
│   │   │   │   ├── permissions/
│   │   │   │   ├── sessions/
│   │   │   │   └── devices/
│   │   │   │
│   │   │   ├── organizations/
│   │   │   ├── venues/
│   │   │   │
│   │   │   ├── menu/
│   │   │   │   ├── products/
│   │   │   │   ├── categories/
│   │   │   │   ├── modifiers/
│   │   │   │   ├── pricing/
│   │   │   │   ├── taxes/
│   │   │   │   └── availability/
│   │   │   │
│   │   │   ├── tables/
│   │   │   │   ├── table.go
│   │   │   │   ├── session.go
│   │   │   │   ├── service.go
│   │   │   │   ├── repository.go
│   │   │   │   └── events.go
│   │   │   │
│   │   │   ├── orders/
│   │   │   │   ├── order.go
│   │   │   │   ├── line.go
│   │   │   │   ├── modifier.go
│   │   │   │   ├── round.go
│   │   │   │   ├── source.go
│   │   │   │   ├── status.go
│   │   │   │   ├── service.go
│   │   │   │   ├── repository.go
│   │   │   │   ├── events.go
│   │   │   │   └── errors.go
│   │   │   │
│   │   │   ├── checks/
│   │   │   │   ├── check.go
│   │   │   │   ├── item.go
│   │   │   │   ├── split.go
│   │   │   │   ├── allocation.go
│   │   │   │   ├── status.go
│   │   │   │   ├── service.go
│   │   │   │   └── repository.go
│   │   │   │
│   │   │   ├── payments/
│   │   │   │   ├── payment.go
│   │   │   │   ├── method.go
│   │   │   │   ├── settlement.go
│   │   │   │   ├── refund.go
│   │   │   │   ├── void.go
│   │   │   │   ├── service.go
│   │   │   │   └── repository.go
│   │   │   │
│   │   │   ├── kitchen/
│   │   │   │   ├── ticket.go
│   │   │   │   ├── ticket_line.go
│   │   │   │   ├── station.go
│   │   │   │   ├── routing.go
│   │   │   │   ├── service.go
│   │   │   │   └── events.go
│   │   │   │
│   │   │   ├── discounts/
│   │   │   ├── receipts/
│   │   │   ├── shifts/
│   │   │   ├── cash-management/
│   │   │   ├── staff/
│   │   │   ├── terminals/
│   │   │   ├── devices/
│   │   │   ├── promotions/
│   │   │   ├── idempotency/
│   │   │   ├── audit/
│   │   │   ├── events/
│   │   │   ├── workers/
│   │   │   ├── notifications/
│   │   │   ├── realtime/
│   │   │   └── health/
│   │   │
│   │   ├── platform/
│   │   │   ├── postgres/
│   │   │   ├── redis/
│   │   │   ├── queue/
│   │   │   ├── websocket/
│   │   │   ├── security/
│   │   │   ├── observability/
│   │   │   ├── config/
│   │   │   └── clock/
│   │   │
│   │   ├── tests/
│   │   │   ├── unit/
│   │   │   ├── integration/
│   │   │   ├── contract/
│   │   │   └── concurrency/
│   │   │
│   │   ├── go.mod
│   │   └── go.sum
│   │
│   └── venue-edge/
│       ├── cmd/
│       │   └── agent/
│       │       └── main.go
│       ├── internal/
│       │   ├── registration/
│       │   ├── device-registry/
│       │   ├── payment-terminal/
│       │   ├── receipt-printer/
│       │   ├── kitchen-printer/
│       │   ├── cash-drawer/
│       │   ├── customer-display/
│       │   ├── barcode-scanner/
│       │   ├── local-cache/
│       │   ├── local-database/
│       │   ├── command-queue/
│       │   ├── sync/
│       │   ├── retry/
│       │   ├── recovery/
│       │   ├── heartbeat/
│       │   ├── remote-config/
│       │   ├── updates/
│       │   └── diagnostics/
│       ├── tests/
│       ├── go.mod
│       └── go.sum
│
├── packages/                     reusable libraries only, created when multiple consumers genuinely share code
│
├── contracts/
│   ├── openapi/
│   ├── events/
│   ├── realtime/
│   └── schemas/
│
├── data/
│   ├── analytics/
│   ├── forecasting/
│   ├── ai/
│   └── pipelines/
│
├── database/
│   ├── migrations/
│   ├── seeds/
│   ├── fixtures/
│   └── docs/
│
├── infrastructure/
│   ├── docker/
│   ├── kubernetes/
│   ├── terraform/
│   ├── monitoring/
│   ├── dashboards/
│   ├── secrets/
│   └── local-dev/
│
├── tooling/
│   ├── scripts/
│   ├── codegen/
│   ├── generators/
│   ├── test-fixtures/
│   ├── test-tools/
│   ├── ci/
│   └── deployment/
│
├── docs/
│   ├── architecture/
│   ├── adr/
│   ├── api/
│   ├── android/
│   ├── windows-pos/
│   ├── admin-console/
│   ├── edge/
│   ├── operations/
│   └── migration/
│
├── PRD/
│
├── .github/
├── .gitignore
├── Makefile
└── README.md
```

---

## 4. Structural rules

1. **This structure is the agreed target repository structure.**
2. **It is authoritative for where new implementation belongs.**
3. **Do not redesign this structure during implementation** simply because another arrangement appears cleaner.
4. **Do not create a second canonical backend.** Canonical transactional state has one owner: `services/core-platform` (Go).
5. **Migrate, don't rewrite for relocation.** Existing implementation is moved into the target structure when practical, not rewritten solely because its current path differs.
6. **New implementation goes directly into the correct target location.**
7. **Transitional code may remain temporarily** while its callers migrate, but it must not redefine the target architecture.
8. **PostgreSQL remains authoritative.**
9. **Prisma is currently the migration authority** during the transition (`apps/api/prisma/`). Moving migration ownership or location to `database/` is a separate migration task. It is not permission to rewrite migration history.
10. **Published migrations are never renamed or rewritten.**
11. **`services/core-platform/internal/events/` and `services/core-platform/internal/workers/` are valid, current Core implementations** (Phase D13).
    - Working D13 functionality is **not** moved into a separate worker service merely for layout.
    - A separate worker process, if one ever becomes genuinely necessary, would be its own `services/<service>/` (section 4.2).
12. **Do not create duplicate implementations** merely because a target folder exists.
13. **The target tree is structural ownership.** It is not an instruction that every listed subdirectory must exist immediately.
14. **Stage 2 scaffolding must avoid hundreds of meaningless empty directories.**
15. **Only create directories that establish real project or application boundaries, or that imminent implementation requires.**

### 4.1 Frozen ownership decisions

These meanings are fixed. They are part of the agreed structure and change only through [Architecture Change Control](#9-architecture-change-control).

**Android applications**

| Target | Meaning |
|---|---|
| `apps/android/waiter-tablet/` | **The single tablet ordering application (CC-3).** One app with two operating modes over the same venue, table, visit and order context: **Staff Mode** (staff-operated mobile POS / waiter ordering) and **Guest Mode** (customer-operated table ordering, a restricted context with no staff permissions). **The current web "Order Tablet" is its predecessor and reference implementation** for both modes. Guest Mode UX and features are not defined by this document. No separate customer tablet application exists (section 8.F). |
| `apps/android/kiosk/` | Customer self-service ordering. |
| `apps/android/window-display/` | Promotions and digital signage. |
| `apps/android/kds/` | Kitchen display. |

**Core device ownership**

| Target | Owns |
|---|---|
| `services/core-platform/internal/identity/devices/` | Device authentication identity: credentials, authentication material, device-session identity, verification and revocation. |
| `services/core-platform/internal/devices/` | The enrolled operational device registry and lifecycle: registration, state, capabilities, venue assignment, device management. |
| `services/core-platform/internal/terminals/` | The logical POS terminal / workstation domain. |

Current device code is mapped into these boundaries during implementation, not duplicated during scaffolding.

**Core payments**
- `services/core-platform/internal/payments/` owns:
  - refunds;
  - settlement;
  - payment methods and payment state;
  - payment reversal or void, where financially applicable.

**Core pricing**
- `internal/menu/pricing/` and `internal/menu/taxes/` own pricing and tax.
- `internal/discounts/` owns discounts.
- Server pricing authority stays in Go Core throughout any migration.

**Core tests:** normal Go conventions apply.
- Package unit tests may stay beside their implementation.
- `tests/integration/`, `tests/contract/`, `tests/architecture/`, `tests/parity/` and `tests/testsupport/` are all valid.
- Concurrency tests may stay inside integration or package tests where that is logical.
- The `tests/unit/` and `tests/concurrency/` labels in the tree describe ownership. They are not a requirement to relocate working tests.

**Migrations**
- `apps/api/prisma/` (Prisma) remains the migration authority during the transition.
- `database/` is the final structural ownership target.
- Nothing moves until an explicitly approved migration-authority task.
- `services/core-platform/cmd/migrate/` is a future location **only if** migration ownership is explicitly changed. It is not scaffolded or implemented before then, and no competing Go migration system is created.
- Published migrations are never moved, renamed or rewritten (rule 10).

**Web**
- `apps/web/landing-page/` is its own React + TypeScript application boundary. Public-home content now in `apps/web/customer-website/` may later be reused or moved into it. Its product requirements are not defined here.
- `apps/web/customer-website/` is React + TypeScript. The current JavaScript implementation migrates to TypeScript incrementally; no wholesale rewrite is required before the app is moved or used.

**Product requirements (CC-1)**
- `PRD/` is the authoritative product and requirements source material used to generate BMAD planning.
- It is documentation and planning infrastructure, not runtime or product code.
- `docs/planning/` is planning **output**. It is not a PRD input source.

**Transitional KDS**
- The `apps/web/admin-console` KDS mode (`VITE_APP_MODE=kds`) is the **transitional web KDS of record**.
- The `apps/window-display` `KdsPage` is a duplicate transitional implementation, to retire once safe.
- The permanent target is `apps/android/kds/`.

### 4.2 Monorepo convention (CC-2)

The convention is **deployable artifact type first, platform second.**

| Kind of code | Location |
|---|---|
| Deployable client application | `apps/<platform>/<application>/` (platforms: `web`, `windows`, `android`) |
| Backend or long-running service | `services/<service>/` |
| Reusable library or shared module | `packages/<scope>/<package>/` |
| Cross-language contract | `contracts/` |
| Data, ML or analytics workload | `data/` |
| Database ownership and migration target | `database/` |
| Deployment and runtime infrastructure | `infrastructure/` |
| Development, CI, codegen and scripts | `tooling/` |
| Documentation | `docs/` |
| Authoritative product requirements | `PRD/` |

**Examples:**
- `apps/web/admin-console/`, `apps/web/customer-website/`, `apps/web/landing-page/`;
- `apps/windows/pos-terminal/`;
- `apps/android/{waiter-tablet, kiosk, kds, window-display}/`;
- `services/core-platform/`, `services/venue-edge/`.

**Rules:**
- **Services stay under `services/`.** Go Core and Venue Edge are never placed under `apps/`.
- **`packages/` holds reusable code only:**
  - it is never deployed independently;
  - a package is created only when **multiple consumers genuinely share code**;
  - it is never a catch-all `shared/` dumping ground;
  - platform-scoped packages may later live under `packages/web/`, `packages/android/`, `packages/dotnet/` or `packages/go/`, only if real shared consumers justify it;
  - no subtrees are defined in advance and no placeholders are created for hypothetical libraries.
- **Transitional exception:** `apps/api/` (NestJS) is a backend but sits under `apps/` today. It is transitional, is not moved, and retires as its callers migrate to Go Core.
- **Migration state (2026-10-01):**
  - The Admin Console and Customer Website now live at `apps/web/admin-console/` and `apps/web/customer-website/`.
  - `apps/window-display/`, `apps/order-tablet/` and `apps/kitchen-display/` remain transitional current implementations at their current paths; their permanent successors are under `apps/android/` (section 4.1).

---

## 5. Windows POS freeze

Only two things are frozen at this stage:

| Frozen item | Value |
|---|---|
| Location | `apps/windows/pos-terminal/` |
| Technology | C# / .NET / Windows |

- **Agreed structural boundary:** four solution folders, `Servvia.Pos.App`, `Servvia.Pos.Features`, `Servvia.Pos.Infrastructure` and `Servvia.Pos.Devices`, inside `Servvia.Pos.sln`. No feature breakdown inside them is agreed yet.
- **Detailed requirements: PENDING USER POS ANALYSIS REPORT.**
- **Requirements are not yet defined.** A detailed POS analysis report will be supplied later by the owner. That report becomes the requirements basis for:
  - POS features, workflows, screens and navigation;
  - manager functions;
  - payment UX;
  - table workflow and order-entry behaviour;
  - receipt behaviour;
  - shift and cash behaviour;
  - hardware behaviour;
  - offline behaviour.
- **Nothing may be invented ahead of that report.** None of the requirements above may be designed or implemented before it arrives.
- **Not a basis for POS design:** the deleted `apps/venue-connector/`, `apps/idealpos-bridge*/` and `apps/idealpos-harness/` .NET projects (present at `a005642`) were external-POS integration tooling.

---

## 6. Current → target mapping

Legend:
- **KEEP:** stays where it is.
- **MOVE:** relocate without rewriting.
- **MOVE/REFACTOR LATER:** relocate when dependency safety permits; never in Stage 2 for visual conformity.
- **MIGRATE:** callers move to a new owner, then the old code retires.
- **BUILD:** new implementation.
- **RETIRE:** delete once its callers and replacement allow.

| Current path | Target | Disposition |
|---|---|---|
| `services/core-platform/` | `services/core-platform/` | **KEEP.** Permanent target component; already contains substantial implementation (section 7.2). |
| `apps/web/admin-console/` | `apps/web/admin-console/` | **KEEP: TARGET + IMPLEMENTED IN TARGET LOCATION** (moved from `apps/admin-console/` under CC-2, without rewrite). Also hosts the transitional staff Order Tablet and the transitional KDS of record (build modes). |
| `apps/web/admin-console/src/pages/order-tablet/` (built with `VITE_APP_MODE=tablet`; documented by `apps/order-tablet/README.md`) | `apps/android/waiter-tablet/` | **TRANSITIONAL.** The current Order Tablet (with `Staff mode` and `Guest mode`) is the predecessor and reference implementation of the **Waiter Tablet** in both modes (CC-3). |
| `apps/order-tablet/` | none (README only; describes the Order Tablet build mode) | **TRANSITIONAL.** Retires with the web Order Tablet. |
| none (planned Customer Order Tablet, formerly `apps/android/order-tablet/`) | `apps/android/waiter-tablet/` (Guest Mode) | **MERGED (CC-3).** Customer-operated table ordering is Waiter Tablet Guest Mode. The `apps/android/order-tablet/` scaffold is removed. |
| `apps/web/admin-console` KDS mode (`VITE_APP_MODE=kds`, `KitchenDisplayPage`) | `apps/android/kds/` | **TRANSITIONAL.** The web KDS of record. |
| `apps/window-display/src/pages/KdsPage.tsx` | none | **RETIRE LATER.** Duplicate transitional KDS; retire once safe. |
| `apps/kitchen-display/` | `apps/android/kds/` | **TRANSITIONAL.** README only; documents the KDS build mode. Its permanent successor is the native KDS. |
| `apps/window-display/` (signage) | `apps/android/window-display/` | **TRANSITIONAL** React implementation of promotions and signage. |
| `apps/window-display/src/pages/KioskOrderPage.tsx` | `apps/android/kiosk/` | **TRANSITIONAL.** Kiosk ordering inside window-display is transitional only. |
| `apps/web/customer-website/` | `apps/web/customer-website/` | **KEEP: TARGET + IMPLEMENTED IN TARGET LOCATION** (moved from `apps/customer-website/` under CC-2, without rewrite). Incremental TypeScript migration continues. |
| public-home content in `apps/web/customer-website/` | `apps/web/landing-page/` | **MOVE LATER, optional.** May be reused when the landing page is built. |
| `apps/api/` (NestJS) | Go Core (`services/core-platform/`) | **TRANSITIONAL, MIGRATE.** Canonical transactional ownership continues moving to Go Core. Prisma remains here during migration. |
| `apps/api/prisma/` | `database/` | **Migration authority during the transition.** No movement until an explicitly approved migration-authority task (section 4.1). |
| `apps/api/src/{legacy-external-pos, pos-sync, connector, payment-observation}` and the connector-dispatch part of `apps/api/src/printer` | none | **RETIRE LATER.** External-POS surfaces, still live in Nest. Retire only per replacement and caller safety. |
| `apps/idealpos-bridge/`, `apps/idealpos-bridge-ci/`, `apps/idealpos-harness/`, `apps/venue-connector/` | none | **RETIRE.** Legacy external-POS projects; not target architecture. Present at `a005642`; deleted only in the uncommitted working tree. |
| `contracts/` | `contracts/` | **KEEP.** Already target-aligned. |
| `docker/`, `docker-compose.yml`, `windows-deploy/` | `infrastructure/` | **Existing infrastructure.** Organise under `infrastructure/` where useful. |
| `local-postgres/` | `infrastructure/local-dev/` | **MOVE LATER.** Not during Stage 2 if moving it would break tooling. |
| `scripts/` | `tooling/scripts/` | **Existing tooling.** Organise under `tooling/` where useful. |
| `find_css_rules.py` | `tooling/scripts/` | **MOVE LATER** if still useful. |
| `shared/` | decomposed by owner | **Not a permanent catch-all.** Decompose as each caller migrates: seed and fixture material to `database/`, web-specific config to the owning web app, tooling data to `tooling/`, runtime data or config to the owning service or app. Not mass-moved in Stage 2. |
| `docs/` | `docs/` | **KEEP** and reorganise incrementally. |
| none | `PRD/` | **BUILD (CC-1).** Authoritative requirements source for BMAD planning. Consolidated from existing documents with provenance; the source documents stay where they are until a separate supersession decision. |
| `docs/product-requirements.md`, `docs/prd.md`, `docs/mvp.md`, `docs/target-operating-model.md`, `PRODUCT.md`, `DESIGN.md` | source material for `PRD/` | **KEEP for now.** Inspected as source material; not moved, deleted or rewritten. Whether each is superseded is decided after `PRD/` review. |
| `docs/planning/` | `docs/planning/` | **KEEP.** Planning output; not a PRD input source. |
| `DESIGN.md`, `PRODUCT.md` | under `docs/` | **MOVE LATER.** The exact sub-location is chosen during the docs reorganisation. |
| `.github/` | `.github/` | **KEEP.** |
| `web/`, `desktop/`, `android/` (obsolete Stage 2 scaffold) | `apps/web/`, `apps/windows/`, `apps/android/` | **REMOVED** in the CC-2 migration (section 8.D). Their scaffold READMEs were migrated to the new paths. |
| `packages/` | `packages/` | **TARGET BOUNDARY CREATED, NO SHARED PACKAGES YET.** README only; packages are created only when genuinely shared (section 4.2). |
| `.claude/` | repository root | **KEEP.** Repository-local development and agent configuration; not product architecture. |
| `_bmad/`, `_bmad-output/` | none (not mapped) | **OUT OF SCOPE.** Governed solely by section 8.C. |
| `tableMap.svg` | none | Unrelated; untouched. |

**Not yet implemented at all:**
- `services/venue-edge/`
- `apps/windows/pos-terminal/`
- `apps/android/` (every app, including the Waiter Tablet in both modes)
- `apps/web/landing-page/`
- `data/`

---

## 7. Implementation status

Statuses:
- **TARGET + IMPLEMENTED**
- **TARGET + IMPLEMENTED IN TARGET LOCATION** (moved into its permanent path)
- **TARGET + STRUCTURAL SCAFFOLD ONLY** (README boundary; no product code)
- **TARGET BOUNDARY CREATED** (boundary exists; nothing inside it yet)
- **TARGET + PARTIALLY IMPLEMENTED**
- **TARGET + EXISTS IN OLD LOCATION**
- **TARGET + NOT YET CREATED**
- **TRANSITIONAL**
- **RETIRE LATER**

### 7.1 Major areas

| Target area | Current path | Target path | Technology | Status | Real code? | Action | Important dependency |
|---|---|---|---|---|---|---|---|
| Core POS platform (REST, realtime, events, workers) | `services/core-platform/` (module `servvia/services/core-platform`) | same | Go | TARGET + PARTIALLY IMPLEMENTED | Yes: domains D1–D13 with unit, contract, architecture, PostgreSQL integration and parity tests | KEEP / BUILD | No client calls it yet; no container image or deployment route exists; Nest still serves every client |
| Venue Edge | none | `services/venue-edge/` | Go | TARGET + STRUCTURAL SCAFFOLD ONLY | No | BUILD | Printing and payment-terminal transport depend on it. The deleted `.NET` venue-connector was external-POS tooling, not its basis |
| Separate worker processes | none | `services/<service>/` (only if ever needed) | Go | Not planned | No | BUILD only if a separate process is genuinely needed (rule 11) | D13 workers already run in-process in `internal/workers/` |
| Main POS Terminal | none | `apps/windows/pos-terminal/` | C# / .NET / Windows | TARGET + STRUCTURAL SCAFFOLD ONLY | No | BUILD (after the POS report) | Section 5 freeze |
| Waiter Tablet (Staff Mode and Guest Mode) | web Order Tablet in `apps/web/admin-console/src/pages/order-tablet/` (`VITE_APP_MODE=tablet`; documented by `apps/order-tablet/README.md`) | `apps/android/waiter-tablet/` | Kotlin / Android | TRANSITIONAL (web predecessor); target path: TARGET + STRUCTURAL SCAFFOLD ONLY | Web only | BUILD native, MIGRATE callers | The current web page talks to Nest, including external-POS native rounds |
| Customer Kiosk | `apps/window-display/src/pages/KioskOrderPage.tsx` | `apps/android/kiosk/` | Kotlin / Android | TRANSITIONAL (web); target path: TARGET + STRUCTURAL SCAFFOLD ONLY | Web only | BUILD native | Nest `POST /api/kiosk/orders` |
| KDS | of record: `apps/web/admin-console` KDS mode (`KitchenDisplayPage.tsx`); duplicate: `apps/window-display/src/pages/KdsPage.tsx` | `apps/android/kds/` | Kotlin / Android | TRANSITIONAL (web); the duplicate is RETIRE LATER; target path: TARGET + STRUCTURAL SCAFFOLD ONLY | Web only | BUILD native; retire the duplicate once safe | Go kitchen tickets (D4) exist; the web KDS pages use Nest |
| Window Display / Promotions | `apps/window-display/` (signage page) | `apps/android/window-display/` | Kotlin / Android | TRANSITIONAL (React); target path: TARGET + STRUCTURAL SCAFFOLD ONLY | Web only | BUILD native | GCS media via the Nest `media` module |
| Android shared code | none | `packages/android/` (only when genuinely shared, section 4.2) | Kotlin | TARGET + NOT YET CREATED (`packages/` boundary exists; no Android package yet) | No | BUILD only when shared | `contracts/` |
| Landing Page | none as a separate project | `apps/web/landing-page/` | React + TypeScript | TARGET + STRUCTURAL SCAFFOLD ONLY | No | BUILD (own application boundary) | `apps/web/customer-website` public-home content may be reused |
| Admin Console | `apps/web/admin-console/` (77 TS/TSX, 13 JS/JSX files) | `apps/web/admin-console/` | React + TypeScript | TARGET + IMPLEMENTED IN TARGET LOCATION | Yes | KEEP / EVOLVE | Calls Nest; also hosts the staff Order Tablet and KDS build modes |
| Customer Website | `apps/web/customer-website/` (2 TS/TSX, 88 JS/JSX files) | `apps/web/customer-website/` | React + TypeScript | TARGET + IMPLEMENTED IN TARGET LOCATION | Yes, mostly JavaScript | KEEP / EVOLVE + INCREMENTAL TYPESCRIPT MIGRATION | Calls Nest |
| AI / Analytics / Forecasting | none (no Python product code in the repository) | `data/` | Python | TARGET + NOT YET CREATED | No | BUILD | PostgreSQL read access model to be defined |
| Contracts | `contracts/{openapi, events, realtime, schemas}` | same | OpenAPI / JSON Schema / Markdown | TARGET + IMPLEMENTED | Yes | KEEP | Holds both Servvia Core contracts and still-served transitional Nest contracts |
| Database migrations and seeds | `apps/api/prisma/` (schema, 41 migrations, seed), `local-postgres/`, `shared/menu/` | `database/` | PostgreSQL / Prisma | TARGET + EXISTS IN OLD LOCATION | Yes | MIGRATE only after an approved migration-authority task | Stage 2 may create the `database/` boundary but must not copy, move or duplicate Prisma schema or migrations |
| Migration command | none | `services/core-platform/cmd/migrate/` | Go | Future location only if migration ownership changes | No | Not scaffolded or implemented | Prisma is the migration authority |
| Infrastructure | `docker/` (Nest backend and frontend Dockerfiles, nginx), `docker-compose.yml`, `windows-deploy/`, `local-postgres/` | `infrastructure/` | Docker / Compose / PowerShell | TARGET + EXISTS IN OLD LOCATION | Yes | MOVE where useful | No Go Core image exists; `kubernetes/`, `terraform/`, `monitoring/`, `dashboards/`, `secrets/` do not exist |
| Tooling | `scripts/`, `shared/local-dev.mjs`, `find_css_rules.py` | `tooling/` | Node.js / Python | TARGET + EXISTS IN OLD LOCATION | Yes | MOVE where useful | CI calls `scripts/*.test.mjs` |
| CI | `.github/workflows/ci.yml` | `.github/` | GitHub Actions | TARGET + IMPLEMENTED | Yes | KEEP | Currently red on `main` (API lint and .NET connector tests), unrelated to this document |
| Documentation | `docs/` (flat files plus `adr/`, `migration/`, `runbooks/`, `audits/`, `audit/`), `DESIGN.md`, `PRODUCT.md` | `docs/{architecture, adr, api, android, windows-pos, admin-console, edge, operations, migration}` | Markdown | TARGET + PARTIALLY IMPLEMENTED | Yes | KEEP / reorganise incrementally | `adr/` and `migration/` already match |
| Product requirements source | `PRD/` | `PRD/` | Markdown | TARGET + PARTIALLY IMPLEMENTED (CC-1 approved; PRD content awaiting owner review) | Documentation | BUILD | Input to the fresh official BMAD install, which happens only after `PRD/` is approved |
| Build entry point | none | `Makefile` | Make | TARGET + NOT YET CREATED | No | BUILD | Root `package.json` scripts are the current entry point |
| Transitional NestJS API | `apps/api/` (modules: audit, auth, email, health, kiosk, media, menu, orders, prisma, queue, redis, reporting, reservations, staff, tables, tablet, venues, …) | Go Core | TypeScript / NestJS | TRANSITIONAL | Yes | MIGRATE callers to Go, then RETIRE | Serves every current client; owns auth, staff, media (GCS), reservations and email today |
| External-POS surfaces in Nest | `apps/api/src/{legacy-external-pos, pos-sync, connector, payment-observation}`, printer connector dispatch | none | TypeScript | RETIRE LATER | Yes, live | RETIRE per caller safety | The web staff Order Tablet and order creation still call them |
| Legacy external-POS projects | `apps/idealpos-bridge*/`, `apps/idealpos-harness/`, `apps/venue-connector/` | none | C# / .NET | RETIRE LATER | At `a005642` yes; deleted in the uncommitted working tree | RETIRE | Any host-installed services are a separate production decision |

### 7.2 Core internals: current package → target package

The current Go convention is a domain package plus a transport subpackage (`<domain>api`) and a persistence subpackage (`pgstore`). The file names in the target tree record ownership; they do not require renaming these subpackages (section 9).

| Target | Current | Status | Action |
|---|---|---|---|
| `internal/identity/` | `internal/identity/` (tokens, guards, venue scope; one flat package) | TARGET + PARTIALLY IMPLEMENTED | KEEP / BUILD |
| `internal/identity/devices/` (device authentication identity) | device-credential authentication inside `internal/devices/` | TARGET + EXISTS IN OLD LOCATION | Map into the boundary during implementation; no duplication |
| `internal/devices/` (device registry and lifecycle) | `internal/devices/` | TARGET + PARTIALLY IMPLEMENTED | KEEP / BUILD |
| `internal/terminals/` (logical POS terminal) | terminal records inside `internal/devices/` (D8) | TARGET + EXISTS IN OLD LOCATION | Map into the boundary during implementation; no duplication |
| `internal/organizations/` | none | TARGET + NOT YET CREATED | BUILD |
| `internal/venues/` | `internal/venues/` | TARGET + IMPLEMENTED (read side) | KEEP |
| `internal/menu/` | `internal/menu/` (channel menu read) | TARGET + PARTIALLY IMPLEMENTED | KEEP / BUILD |
| `internal/menu/pricing/`, `internal/menu/taxes/`, `internal/discounts/` | `internal/pricing/` (pricing, tax, modifiers, discount, money, `pgcatalog`) | TARGET + EXISTS IN OLD LOCATION | MOVE/REFACTOR LATER, only when implementing or migrating those capabilities; working pricing logic is not rewritten for conformity; server pricing authority stays unchanged |
| `internal/tables/` | `internal/tables/` (table sessions) | TARGET + IMPLEMENTED | KEEP |
| `internal/orders/` | `internal/orders/` (orders and rounds) | TARGET + IMPLEMENTED | KEEP |
| `internal/checks/` | `internal/checks/` | TARGET + IMPLEMENTED (no split or allocation yet) | KEEP / BUILD |
| `internal/payments/` | `internal/payments/` | TARGET + IMPLEMENTED | KEEP |
| `internal/payments/` (refunds) | `internal/refunds/` | TARGET + EXISTS IN OLD LOCATION | MOVE/CONSOLIDATE LATER; not in Stage 2; refund behaviour unchanged |
| `internal/kitchen/` | `internal/kitchen/` (tickets, routing, projector) | TARGET + IMPLEMENTED | KEEP |
| `internal/shifts/`, `internal/cash-management/` | `internal/shifts/` (shifts and cash) | TARGET + PARTIALLY IMPLEMENTED | KEEP / BUILD |
| `internal/promotions/` | `internal/promotions/` | TARGET + IMPLEMENTED | KEEP |
| `internal/events/` | `internal/events/` (D13) | TARGET + IMPLEMENTED | KEEP |
| `internal/workers/` | `internal/workers/` (D13) | TARGET + IMPLEMENTED | KEEP |
| `internal/realtime/` | `internal/realtime/` (D12, reads the D13 log) | TARGET + IMPLEMENTED | KEEP |
| `internal/health/` | `internal/health/` | TARGET + IMPLEMENTED | KEEP |
| `internal/{receipts, staff, idempotency, audit, notifications}/` | none as packages | TARGET + NOT YET CREATED | BUILD |
| `platform/postgres/` | `internal/platform/postgres/` | TARGET + EXISTS IN OLD LOCATION | MOVE/REFACTOR LATER when dependency safety permits |
| `platform/config/` | `internal/config/` | TARGET + EXISTS IN OLD LOCATION | MOVE/REFACTOR LATER when dependency safety permits |
| `platform/redis/`, `platform/security/` | Redis rate limiting in `internal/ratelimit/` | TARGET + EXISTS IN OLD LOCATION | MOVE/REFACTOR LATER when dependency safety permits |
| `platform/{websocket, queue, observability, clock}/` | none as packages | TARGET + NOT YET CREATED | BUILD when needed |
| implementation support (not a subsystem) | `internal/server/` (HTTP routing), `internal/platform/httpx/` (HTTP helpers) | Implementation detail of Core | KEEP while they serve Core; not moved for visual conformity |
| `cmd/api/` | `cmd/api/` | TARGET + IMPLEMENTED | KEEP |
| `cmd/migrate/` | none | Future location only if migration ownership changes | Not scaffolded or implemented |
| `tests/` | `tests/{integration, contract, architecture, parity, testsupport}/`; unit tests beside packages | TARGET + IMPLEMENTED (layout valid per section 4.1) | KEEP; tests are not relocated to match the diagram |

---

### 7.3 Target location state (after the CC-2 migration, 2026-10-01)

| Target path | State |
|---|---|
| `apps/web/admin-console/` | TARGET + IMPLEMENTED IN TARGET LOCATION |
| `apps/web/customer-website/` | TARGET + IMPLEMENTED IN TARGET LOCATION |
| `apps/web/landing-page/` | TARGET + STRUCTURAL SCAFFOLD ONLY |
| `apps/windows/pos-terminal/` | TARGET + STRUCTURAL SCAFFOLD ONLY (detail: PENDING USER POS ANALYSIS REPORT) |
| `apps/android/{waiter-tablet, kiosk, kds, window-display}/` | TARGET + STRUCTURAL SCAFFOLD ONLY |
| `services/core-platform/` | TARGET + PARTIALLY IMPLEMENTED (section 7.1) |
| `services/venue-edge/` | TARGET + STRUCTURAL SCAFFOLD ONLY |
| `packages/` | TARGET BOUNDARY CREATED, NO SHARED PACKAGES YET |
| `apps/api/`, `apps/window-display/`, `apps/order-tablet/`, `apps/kitchen-display/` | TRANSITIONAL current implementations (not moved) |

---

## 8. Known implementation-location differences

After this revision there are no unresolved questions that would force Stage 2 to redesign a top-level ownership boundary.

### 8.A Resolved current-vs-target differences

| # | Difference | Resolution |
|---|---|---|
| 1 | Target `services/core-platform/platform/`; current `internal/platform/` (plus `internal/config/`, `internal/ratelimit/`) | The target stays `platform/`; the current location stays for now. MOVE/REFACTOR LATER when dependency safety permits. Not moved in Stage 2 for visual conformity; no duplicate implementations. |
| 2 | Device ownership | Fixed in section 4.1: `identity/devices` = authentication identity, `devices` = registry and lifecycle, `terminals` = logical POS terminal. Current `internal/devices/` code is mapped into these during implementation, not duplicated. |
| 3 | Pricing, tax and discounts combined in `internal/pricing/` | Target ownership as agreed (`menu/pricing`, `menu/taxes`, `discounts`). The current package remains operational; split or move only when implementing or migrating those capabilities. Server pricing authority unchanged. |
| 4 | `internal/refunds/` separate from `internal/payments/` | `payments/` owns refunds. MOVE/CONSOLIDATE LATER; not in Stage 2; refund behaviour unchanged. |
| 5 | `internal/server/` and `internal/platform/httpx/` not pictured | Implementation-support packages of Core, permitted by section 3. KEEP while they serve Core. |
| 6 | Go test layout vs `tests/unit` and `tests/concurrency` | Normal Go conventions (section 4.1). Existing layout is valid; tests are not moved in Stage 2. |
| 7 | `cmd/migrate/` vs Prisma authority | Prisma remains authority. `cmd/migrate/` only if migration ownership is explicitly changed; no competing Go migration system. |
| 8 | Web "Order Tablet" (`Staff mode` and `Guest mode`) | Predecessor and reference implementation of `apps/android/waiter-tablet/`, in both Staff Mode and Guest Mode. The separately planned customer application `apps/android/order-tablet/` was merged into Waiter Tablet Guest Mode and removed (CC-3, section 8.F). |
| 9 | Two web KDS implementations | `apps/web/admin-console` KDS mode is the transitional KDS of record; `apps/window-display` `KdsPage` is a duplicate to retire once safe. Target `apps/android/kds/`. |
| 10 | Kiosk ordering inside `apps/window-display` | Transitional only. Permanent split: `apps/android/kiosk/` (self-service ordering) and `apps/android/window-display/` (promotions and signage). |
| 11 | Customer website mostly JavaScript | MOVE/EVOLVE + INCREMENTAL TYPESCRIPT MIGRATION; no wholesale rewrite required first. |
| 12 | No landing-page project | `apps/web/landing-page/` is its own React + TypeScript application boundary; customer-website public-home content may be reused later. |
| 13 | Prisma location vs `database/` | Prisma remains authority. Stage 2 may create the `database/` boundary but must not copy, move or duplicate Prisma schema or migrations. |
| 14 | Nest socket.io realtime alongside Go WebSocket realtime | Nest realtime is transitional and retires with its Nest callers. |
| 15 | Root items outside the target tree | Dispositions fixed in section 6 (`.claude/` KEEP; `find_css_rules.py` and `local-postgres/` MOVE LATER; `DESIGN.md`/`PRODUCT.md` under `docs/` later; `_bmad/`, `_bmad-output/` ignored (section 8.C); `shared/` decomposed by owner; `tableMap.svg` untouched). |

| 16 | Deployable apps split across `web/`, `desktop/` and `android/` top-level folders (Stage 2 scaffold) | CC-2: every deployable client lives under `apps/<platform>/<application>/`; backends under `services/`; reusable code under `packages/` (section 4.2). Migrated on 2026-10-01 (section 8.D). |

### 8.B Non-architectural migration decisions that can be made later

These do not change any ownership boundary and do not block Stage 2:

- **When** each MOVE/REFACTOR LATER or MOVE/CONSOLIDATE LATER happens (`internal/platform/`, `internal/config/`, `internal/ratelimit/`, `internal/pricing/`, `internal/refunds/`). Decide case by case, when the capability is next implemented or migrated.
- **The order and pace** of the customer-website TypeScript migration.
- **Which public-home content**, if any, is reused for the landing page.
- **The exact docs sub-locations:**
  - for `DESIGN.md` and `PRODUCT.md`;
  - for audit and historical material (`docs/audit/` and `docs/audits/`).
  - Documentation consolidation is an incremental docs task. Audit material is documentation, not runtime architecture, and reports are not duplicated to fill target folders.
- **How `shared/` is decomposed**, caller by caller.
- **Where the Android Gradle root and shared build logic live** within `apps/android/` (or a `packages/android/` build module). Decided with the Android SDK and Gradle decisions, when Android work starts.
- **When the duplicate `KdsPage` and the web staff Order Tablet** are retired, governed by caller and replacement safety.

### 8.C BMAD and the PRD (amended by CC-1)

This is the single disposition of BMAD material. It overrides every other mention.

**Old BMAD: removed.**
- On 2026-10-01, at the owner's instruction (Step 1), the old setup was deleted:
  - `_bmad/`;
  - `_bmad-output/`;
  - the old `.claude/skills/bmad-*` skills.
- It is not restored or recovered (from git history, backups or scratchpads), and it is not used as a source of requirements, architecture or planning.
- Its deletions are committed in the requirements and BMAD-reset checkpoint (B1), not in the legacy cleanup checkpoint (C).

**Requirements source.** `PRD/` (section 4.1).

**Fresh BMAD.**
- The current official BMad Method is installed only **after `PRD/` has been reviewed and approved**.
- Its runtime and output locations are whatever the official installer creates.
- It is planning infrastructure, not product architecture.
- Its planning is generated from `PRD/` plus this document.

### 8.D Obsolete Stage 2 scaffold paths (CC-2): removed

The Stage 2 scaffold created `web/`, `desktop/` and `android/` (README files only). In the CC-2 migration of 2026-10-01 they were **removed**, after their relevant README content was migrated:

| Removed obsolete scaffold path | Replaced by |
|---|---|
| `web/landing-page/` (removed obsolete scaffold) | `apps/web/landing-page/` |
| `web/admin-console/`, `web/customer-website/` (removed obsolete scaffold placeholders) | the real applications at `apps/web/admin-console/` and `apps/web/customer-website/` |
| `desktop/pos-terminal/` (removed obsolete scaffold) | `apps/windows/pos-terminal/` |
| `android/apps/<application>/` (removed obsolete scaffold) | `apps/android/<application>/` |
| `android/core/`, `android/models/`, `android/build-logic/` (removed obsolete scaffold) | not recreated; shared Android code goes to `packages/android/` only when genuinely shared |

### 8.E Architectural debt: cross-application source coupling

**Recorded during the CC-2 migration (2026-10-01). Not refactored.**

**The coupling.** `apps/window-display/` compiles directly against source in `apps/web/customer-website/`:
- the Vite alias `@` points to `../web/customer-website/src` (`apps/window-display/vite.config.ts`);
- the TypeScript `paths` and `include` entries reference that tree (`apps/window-display/tsconfig.json`);
- the Tailwind content globs scan it (`apps/window-display/tailwind.config.ts`).

**Rules for resolving it:**
- **Independently deployable applications should not permanently depend directly on another application's source tree.**
- **Genuinely shared code is eventually extracted into a justified package** under `packages/<scope>/<package>/` (section 4.2).
- **No package is created until the actual shared boundary has been identified.** That means knowing which modules both applications really use.
- **The coupling remains temporarily** to preserve working behaviour. Resolving it is a scoped task when either application is next changed in this area, or when `apps/window-display/` is replaced by its native successors. It is not a broad restructuring task.

### 8.F Waiter Tablet: one application, two modes (CC-3)

**Decided 2026-10-02 by the owner (CC-3).** The Waiter Tablet is the single tablet ordering application. The formerly separate Customer Order Tablet is its **Guest Mode**. Requirements: `PRD/product-requirements.md` section 8 (WT-1 to WT-6, with the requirements mapping).

**Four concepts stay separate:**

| Concept | Values | Meaning |
|---|---|---|
| Application identity | `waiter-tablet` | The one Android tablet ordering app, `apps/android/waiter-tablet/` |
| Operating mode | Staff Mode, Guest Mode | Who is operating the tablet now, and therefore its presentation, permissions and available actions |
| Actor | Staff identity, or the device / guest-session identity | Who performed an action on the tablet |
| Order provenance | `OrderSource` values, actor and device identity | Where and by whom an order was entered. Consolidation removes none of this information (PRD WT-6); whether the mode is recorded, and the future meaning of the existing values, is open (PRD O-21) |

**Security boundary.** Guest Mode never grants access to staff-authorised functionality, and entering Staff Mode requires successful staff authorisation, enforced by trusted application and backend controls rather than user-interface visibility alone (PRD WT-4, WT-5). The native mechanism is open (PRD O-20). Existing evidence: DL-081 (approved model of the current web Order Tablet) and Servvia Core, where an unelevated tablet token (kind `tablet_device`) is a device identity refused by `identity.RequireStaff`, and only an elevated tablet (`tablet_staff`, `tablet_manager`) counts as staff.

**Remaining `order_tablet` terminology (kept; migration not performed).** These values are live data, contracts or code, so they are recorded as terminology debt rather than renamed:

| Occurrence | Classification | What it means today | Status |
|---|---|---|---|
| `DeviceKind.order_tablet` (Prisma, `internal/devices`, `contracts/openapi/devices.yaml`) | Physical device classification | The tablet installation, regardless of mode. Effectively the Waiter Tablet device | KEEP for compatibility. The D8 plan to add a separate waiter-tablet kind later, and any rename, are decided with PRD O-21 |
| `MenuChannel.order_tablet` (Prisma, `internal/menu`, Nest menu, admin console, `contracts/openapi/menu-read.yaml`) | Menu channel classification | The tablet's menu channel; shows unavailable ("86'd") items dimmed (staff policy) | KEEP. Whether Guest Mode keeps this channel and its policy is decided with PRD O-21 |
| `OrderSource.waiter_tablet` and `OrderSource.order_tablet` (Prisma, `internal/orders`, `contracts/openapi/servvia-orders.yaml`, `kitchen-tickets.yaml`) | Order-source / audit classification | Two canonical tablet sources with no documented difference in meaning. Servvia Core accepts **both only from a staff-elevated tablet** (`StaffMaySubmit`); neither is defined as Guest Mode. Guest-mode orders currently go through Nest `POST /api/tablet/orders` with legacy source `staff`, attributed to a per-device system actor | KEEP both. Their meaning is decided with PRD O-21 before any guest order path in Core is built |
| `TabletDevice` / `TabletEnrollment` ("Order Tablet identity") | Transitional device identity (Nest) | Current web tablets | TRANSITIONAL; retires when the Android Waiter Tablet migrates |
| `apps/order-tablet/`, `src/pages/order-tablet/`, `OrderTabletPage`, `npm run dev:order-tablet` / `build:order-tablet`, `VITE_APP_MODE=tablet`, `/order-tablet` route, browser storage key `verdura-order-tablet-pending-submission-v*` | Legacy application terminology (current web predecessor) | The working transitional web tablet | KEEP until the web Order Tablet retires (section 6); not renamed |
| Historical documents (`docs/integrations/*order-tablet*`, `docs/decisions-log.md`, `docs/epics.md`, checkpoints, archives, migration SQL comments) | Historical documentation | Records of past decisions | Not rewritten |

---

## 9. Architecture Change Control

- **Implementation follows `fileRestructure.md`.**
- **If a genuine architectural change becomes necessary, update and review `fileRestructure.md` first.**
- **Only after the document is approved may implementation diverge from the existing structure.**
- **Do not silently change repository ownership boundaries during implementation.**
- **Internal file names that do not alter architectural ownership do not require redesign of the whole structure.** For example, the current `<domain>api` and `pgstore` subpackage convention inside a Core domain package is an internal naming choice.
- **Product requirements may change implementation details without changing the architectural ownership model.**

### 9.1 Change records

| ID | Date | Change | Status |
|---|---|---|---|
| CC-1 | 2026-10-01 | Adds the top-level `PRD/` boundary (authoritative requirements source for BMAD planning; documentation, not runtime code). Classifies `docs/planning/` as planning output, not a PRD input. Records the removal of the old BMAD setup and the order: `PRD/` approved → fresh official BMAD install (section 8.C). | **APPROVED** (2026-10-01) |
| CC-2 | 2026-10-01 | **Reason:** adopt a unified enterprise monorepo convention, deployable artifact type first and platform second (section 4.2). **Effect:** eliminates duplicate and ambiguous top-level app paths; makes `apps/` the single home for deployable clients (`apps/web/`, `apps/windows/`, `apps/android/`); keeps backend runtimes under `services/`; introduces `packages/` for genuinely reusable libraries; keeps `contracts/`, `data/`, `database/`, `infrastructure/`, `tooling/`, `docs/` and `PRD/` as separate concerns. The Stage 2 `web/`, `desktop/` and `android/` scaffold becomes obsolete (section 8.D). Migration executed 2026-10-01: the Admin Console and Customer Website moved to `apps/web/`; the scaffold moved to `apps/web/landing-page/`, `apps/windows/pos-terminal/` and `apps/android/*`; `packages/` created; the obsolete `web/`, `desktop/` and `android/` were removed. | **APPROVED** (2026-10-01) |
| CC-3 | 2026-10-02 | **Tablet application consolidation.** **Reason:** the existing Order Tablet already serves staff and guests as `Staff mode` and `Guest mode` of one table and order experience, so two Android tablet products would duplicate one operational context. **Effect:** `apps/android/waiter-tablet/` becomes the single tablet ordering application, with **Staff Mode** (staff-operated ordering, formerly the Waiter Tablet scope) and **Guest Mode** (customer-operated table ordering, formerly the separate Customer Order Tablet). **Guest self-ordering stays in scope as Guest Mode; it is not removed from the product.** Guest Mode UX and detailed features remain undefined, as before. The `apps/android/order-tablet/` scaffold is removed and no `customer-tablet` application is created. Guest Mode never grants access to staff-authorised functionality; entering Staff Mode requires successful staff authorisation (mechanism open, PRD O-20). Existing order-origin data is kept and no database or schema value changes (open, PRD O-21). Requirements: PRD section 8 (WT-1 to WT-6, with a mapping); terminology debt: section 8.F. Supersedes the separate Customer Order Tablet entry of section 4.1. | **APPROVED** (2026-10-02, owner decision) |

---

## 10. Implementation sequence

**STAGE 1: Structure source of truth.** Create and review `fileRestructure.md`.

**STAGE 2: Project scaffold.**
- Create the approved structural and application boundaries based on `fileRestructure.md`.
- Do not implement product behaviour yet, unless it is needed for buildable skeletons.

**STAGE 3: Implementation.** Implement the actual Servvia product step by step inside the approved structure. For every implementation stage:

1. identify the target path from `fileRestructure.md`;
2. inspect the existing implementation;
3. KEEP / MOVE / MIGRATE / BUILD as appropriate;
4. implement;
5. test;
6. update documentation;
7. proceed to the next capability.

Do not redesign the overall repository structure during Stage 3.
