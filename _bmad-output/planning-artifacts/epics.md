---
stepsCompleted: [1, 2, 3, 4]
inputDocuments:
  - PRD/README.md
  - PRD/product-requirements.md
  - fileRestructure.md
  - docs/adr/0001-servvia-is-the-operational-pos.md
  - docs/adr/0002-reduced-first-pilot.md
  - docs/audits/production-readiness-2026-12.md
workflow: bmad-create-epics-and-stories (BMAD 6.12.0)
generated: 2026-10-03
baselineCommit: abd4de8
notes: >-
  Brownfield. No starter template. No UX design contract exists: docs/ux.md
  is reference evidence only (PRD README, R-1). The PRD has no PRD.md or
  Architecture.md under planning_artifacts. Per the pinned persistent facts,
  the PRD document is PRD/product-requirements.md and the Architecture
  document is fileRestructure.md with ADR 0001 and ADR 0002. The audit is
  evidence and backlog input, never requirements authority.
---

# servvia - Epic Breakdown

## Overview

This document provides the complete epic and story breakdown for servvia. It decomposes the requirements from the PRD (`PRD/product-requirements.md`, approved 2026-10-03) and the architecture requirements (`fileRestructure.md`, ADR 0001, ADR 0002) into implementable stories. Sequencing evidence comes from the adopted production-readiness audit (`docs/audits/production-readiness-2026-12.md`). No UX design contract exists.

**Planning rules applied:**
- **Unresolved items stay BLOCKED.** This covers every OWNER TARGET REQUIRED (OTR) and OWNER DECISION REQUIRED (ODR) item, the open decisions in PRD section 14, R-3 and PENDING USER POS ANALYSIS REPORT. A story that needs one says `Status: BLOCKED` and names it. No target, provider behaviour or Windows POS behaviour is invented.
- **Scope follows ADR 0002 (accepted).** The reduced first pilot requires integrated card (PILOT-CARD-3). Settlement goes through the transitional web Order Tablet in Staff Mode. Guest Mode, the Windows POS and the cash drawer are not part of the first pilot. Kitchen printing is conditional on the venue.
- **The audit's P0-09 description is superseded.** It described a web cashier plus an external-card tender; Epic 9 and Epic 10 replace it.
- **Order** follows the audit's dependency sequence: P0-02 → P0-03 → P0-04 → P0-05/P0-06 → P0-07 → P0-08 → P0-10 → …, with security and backups interleaved.
- **Story status values:**
  - `READY`: implementable now;
  - `BLOCKED: <item>`: an owner decision or target is missing;
  - `NEEDS AUTHORIZATION: <action>`: needs a separately authorised production, remote or infrastructure action;
  - `DEFERRED (ADR 0002)`: not part of the first pilot.

## Requirements Inventory

### Functional Requirements

Each ID is kept from the PRD. The text is condensed; the PRD wording governs.

- ORD-1: Every accepted order is durably recorded by Core before kitchen release. One transaction persists the round, snapshot, idempotency key, kitchen tickets and domain events.
- ORD-2: Core validates venue, table session, menu availability, modifiers and price, and computes tax and totals server-side.
- ORD-3: A repeated submission with the same idempotency key returns the original result and creates no duplicate.
- ORD-4: Unvalidatable menu data (unknown, unavailable or invalid item or option; stale price; unsupported tax) is refused with a stable, specific error and creates no order.
- ORD-5: An order carries its table session, source and line/modifier context. Ordering does not open or modify a check; a check is created separately over unbilled lines.
- KIT-1: Servvia owns line-level KDS and KOT routing using the station configuration effective at submission.
- KIT-2: The KDS and each printer have independent delivery states; neither implies payment success.
- KIT-3: Orders appear on the KDS in real time (target under 3 s, inherited; confirmation pending O-19).
- KIT-4: A KDS ticket shows order ID, table, time, items with quantities and modifiers, and notes. Staff advance its states.
- KIT-5: Ready alert (visual and audible); age colour-coding with a configurable threshold.
- KIT-6: The KDS keeps showing received tickets during a backend outage and reconnects automatically.
- PAY-1: In-person flow. Preparation may begin before payment; the check shows unpaid until a payment is recorded. Card goes through Venue Edge, or cash within a shift.
- PAY-2: Online/prepaid flow, verified server-side before release.
- PAY-3: Amount and currency equal the server total. One provider payment creates at most one order. Signed webhook replay is idempotent. Missing provider configuration fails closed.
- PAY-4: Payment implementation is provider-neutral; provider fields live in adapter metadata.
- PAY-5: No raw card data enters Servvia.
- PAY-6: An uncertain terminal or printer outcome is reconciled before any retry that could duplicate. An online payment that succeeded is never charged again.
- PAY-7: Partial and full refunds.
- REC-1: Receipts. Content and NZ obligations are open (O-5). Order print content is defined.
- MENU-1: Category and item CRUD from the Admin Console only.
- MENU-2: Nutrition and allergens; allergens shown on ordering surfaces.
- MENU-3: Item images with server-side content validation and a size limit; efficient web format.
- MENU-4: Venue-scoped or organization-shared items with venue overrides.
- MENU-5: Modifier groups with required, minimum and maximum rules; identifier-based (PR-6).
- MENU-6: The availability toggle takes effect immediately on every customer-facing surface.
- AVL-1: An 86 propagates to Servvia channels with recovery actions (channels open: O-17).
- TBL-1: Table configuration per venue.
- STF-1: Staff management: add and remove staff, assign roles, reset credentials.
- VEN-1: Venue settings and a multi-venue switcher.
- ADM-1: Admin views of reservations and live orders.
- ADM-2: Printer management, job queue, retry, reprint and test print.
- ADM-3: Daily-email settings.
- RES-1: Online reservations, with lifecycle and collision-checked references.
- RES-2: Reservation emails.
- RES-3: Slot capacity without overbooking under concurrency.
- RES-4: Calendar sync and reservation card payment (open: O-16).
- RES-5: Daily reservation summary email.
- RPT-1: Sales and reservation reports, with CSV export, venue-scoped.
- RPT-2: The minimum service-day reporting needed to close a day at the pilot (open: O-6).
- WT-1: One Waiter Tablet application with Staff Mode and Guest Mode; no separate customer tablet.
- WT-2: Staff Mode: staff-operated ordering at the table.
- WT-3: Guest Mode: customer-operated table ordering; UX undefined.
- WT-4: Guest Mode never grants staff-authorised functionality; enforced by trusted backend controls.
- WT-5: Entering Staff Mode requires staff authorisation (native mechanism open: O-20).
- WT-6: Consolidation removes no order-origin information (mode recording open: O-21).
- KSK-1: Touch-first kiosk browse, cart, table and submit.
- KSK-2: Confirmation screen and idle return.
- KSK-3: Touch targets of at least 48 px; no hover; kiosk readability.
- KSK-4: Restricted offline; submission requires durable acceptance; no card data queued.
- KSK-5: A staff PIN unlocks a kiosk management overlay.
- WD-1: Entrance menu display: read-only, auto-refresh, last menu while offline.
- WEB-1: The public site keeps its journeys (visual refinement open: O-14).
- WEB-2: The public site reads the live menu and availability and creates reservations through Servvia APIs.
- WEB-3: No administration route on the public site.
- WEB-4: Brand, design and accessibility for the public web.
- WEB-5: Public online ordering scope open (O-18).
- EDGE-1: Venue Edge owns local hardware and resilience; it is never a source of business truth.
- EDGE-2: Outbound-only authentication, revocable venue-bound identity, encrypted storage, and a durable leased idempotent queue with `unknown` and expiry.
- EDGE-3: The queue survives restarts; no loss or duplication on internet loss; health is visible.
- PRT-1: Named printers, station routing, once-per-station KOT, explicit and attributed reprints, acknowledgement distinct from delivery.
- PRT-2: Print retry with backoff, then `failed` with an alert; job log; order accepted when the printer is unreachable.
- PRT-3: Print protocol and hardware open (O-4); latency validated on venue hardware.

### NonFunctional Requirements

- NFR-PERF: Inherited latency targets (owner confirmation pending: O-19; section 19 OTR rows).
- NFR-SEC-1: Separate admin origin, server-side authentication before the admin bundle, server-side RBAC per endpoint.
- NFR-SEC-2: Password hashing, TLS 1.2 or higher, input validation, parameterised queries, no unsafe HTML, login rate limit.
- NFR-SEC-3: Tenant and venue scope at every boundary, taken from the verified credential; cross-tenant tests for REST, WebSockets, files and jobs; venue-scoped, revocable devices.
- NFR-AUD: Every pilot-critical mutation emits an append-only, correlated audit record; searchable; at least 90 days.
- NFR-REL: 99.5% monthly uptime (inherited; O-19); daily backups retained 30 days; restore rehearsed against declared RPO/RTO (OTR); real health checks; retry and DLQ.
- NFR-RT: WebSocket event notification; clients refetch over HTTP and resynchronise after reconnect.
- NFR-OFF: Core consistent under retries; durable Edge commands; clients survive network loss without corrupting the record.
- NFR-A11Y: Admin Console WCAG 2.1 AA.
- NFR-DATA: PostgreSQL for all operational data; media in GCS.
- PR-1 to PR-10: binding principles (canonical PostgreSQL behind Core; thin clients; server validation; never fake success; integer money; identifier modifiers; one long-term owner (PR-7); build before cleanup; compensating actions; no invented requirements).
- QB-A to QB-U, QB-AB to QB-AH: the Enterprise Quality Bar (PRD section 15). Values marked OTR or ODR stay BLOCKED (QB-O RPO/RTO; QB-P retention; QB-S remediation timelines; QB-AD standards).
- SEC-16.1 to SEC-16.14: the security standard (PRD section 16), including 16.3 venue isolation, 16.5 revocation on live connections, and 16.12 realtime fail-closed.
- INT-17.x: data and financial integrity (PRD section 17).
- RES-18.x: reliability and resilience (PRD section 18).
- PERF-19: performance and scalability (PRD section 19). OTR values stay BLOCKED.
- OBS-20: observability (PRD section 20).
- TEST-21: test quality (PRD section 21).
- UX-22: UX and product quality (PRD section 22).
- A11Y-23: accessibility per surface (PRD section 23). OTR rows stay BLOCKED.
- REL-24: release and production readiness (PRD section 24).
- DEF-25: the defect severity policy (PRD section 25). Severity definitions are ODR, so BLOCKED.
- DOD-26: Definition of Done input (PRD section 26). It applies to every story below.
- MAT-27: the NFR matrix (PRD section 27).

### Additional Requirements

From the architecture (`fileRestructure.md`, ADR 0001, ADR 0002) and the adopted audit (evidence):
- **No starter template.** This is a brownfield monorepo; the layout is fixed by `fileRestructure.md` (CC-2). Code goes to its owner path (QB-U).
- **Ownership.** Go Core (`services/core-platform`) owns canonical transactional state. PostgreSQL is canonical. Prisma (`apps/api/prisma`) stays the only migration authority; published migrations are never rewritten.
- **Contracts.** `contracts/` (OpenAPI, events, realtime schemas) versions every API and event change (QB-T).
- **Transitional overlap (PR-7).** NestJS may issue staff and device credentials and serve non-transactional administration during the first pilot (O-2 decided). Core enforces transactional authorization, venue scope and financial roles.
- **Fixed Android targets.** Exactly four: `waiter-tablet` (Staff and Guest Mode), `kds`, `kiosk`, `window-display`. No customer or order-tablet target. Native apps are not part of the first pilot.
- **Windows POS.** `apps/windows/pos-terminal` is the permanent target; its behaviour is frozen pending the owner POS analysis report.
- **ADR 0002.** The reduced first pilot needs integrated card (trusted adapter; D6 unchanged; no staff-recorded card tender) and Staff Mode settlement on the web Order Tablet (transitional; DL-087 partially superseded for Staff Mode only; DL-087 tests changed deliberately). The cash drawer, Guest Mode and the Windows POS are excluded; kitchen printing is conditional.
- **Audit backlog evidence** (planning estimates, not commitments): P0-01 to P0-19 and P1-01 to P1-07 (audit section 8). The P0-09 description is superseded by ADR 0002.
- **Known code defects** (audit sections 3–7, code-proven at `54dcfc0`):
  - realtime revocation fails open (`realtimeapi/handler.go:350-354, 244, 386-389`);
  - staff venue scope is not enforced (`identity/scope.go`; `VenueAccess` is unused in Core);
  - broken Nest `start:prod`;
  - every `NODE_ENV` guard defaults open;
  - an unauthenticated file-write endpoint;
  - shared-PIN admin sign-in;
  - no refresh-token revocation;
  - Nest socket.io CORS `*`;
  - KDS kitchen-role cancel;
  - email HTML injection;
  - the kiosk GST overcharge;
  - CI red (2 lint errors; Venue Connector 3 of 502 tests); no Go CI job; `main` unprotected.

### UX Design Requirements

No UX design contract exists, so there are no UX-DRs. UX and accessibility are carried as NFRs (UX-22, A11Y-23, NFR-A11Y, WEB-4, KSK-3).

### FR Coverage Map

- ORD-1: Epic 5 (Story 5.2). Core path exists (REPO); the client cutover is in Epic 5.
- ORD-2: Epic 5 (Story 5.2).
- ORD-3: Epic 5 (Story 5.2).
- ORD-4: Epic 5 (Story 5.2).
- ORD-5: Epic 5 (Story 5.2); Epic 9 (Story 9.2).
- KIT-1: Epic 6 (Story 6.1); multi-station data routing in Epic 12 (Story 12.7).
- KIT-2: Epic 6 (Story 6.2).
- KIT-3: Epic 6 (Story 6.1). The target needs O-19 confirmation.
- KIT-4: Epic 6 (Story 6.1).
- KIT-5: Epic 6 (Story 6.3).
- KIT-6: Epic 6 (Story 6.2).
- PAY-1: Epic 9 (cash); Epic 10 (card).
- PAY-2: Epic 13 (Story 13.6), BLOCKED: O-18. The kiosk is turned off by Story 12.5.
- PAY-3: Epic 10 (Story 10.2); Epic 12 (Story 12.5, kiosk).
- PAY-4: Epic 10 (Story 10.1).
- PAY-5: Epic 10 (Stories 10.1 and 10.3).
- PAY-6: Epic 10 (Story 10.3).
- PAY-7: Epic 9 (Story 9.5, cash); Epic 10 (Story 10.4, card).
- REC-1: Epic 11 (Story 11.1), BLOCKED: O-5.
- MENU-1 to MENU-6: Epic 13 (Story 13.3). Existing transitional Nest capability is preserved; Core ownership is O-7/O-8.
- AVL-1: Epic 13 (Story 13.3), BLOCKED: O-17.
- TBL-1: Epic 8 (Story 8.2).
- STF-1: Epic 8 (Story 8.1).
- VEN-1: Epic 8 (Story 8.2).
- ADM-1: Epic 13 (Story 13.3).
- ADM-2: Epic 11 (Story 11.3), depending on O-4.
- ADM-3: Epic 13 (Story 13.3).
- RES-1 to RES-3, RES-5: Epic 13 (Story 13.4). RES-3's overbooking defect is in Story 13.4.
- RES-4: Epic 13 (Story 13.4), BLOCKED: O-16.
- RPT-1: Epic 13 (Story 13.5).
- RPT-2: Epic 11 (Story 11.2), BLOCKED: O-6.
- WT-1 to WT-6: Epic 5 (Story 5.1, Guest Mode off, honouring WT-4); Epic 13 (Story 13.2, Guest Mode on Core and native app), BLOCKED: O-20, O-21.
- KSK-1 to KSK-5: Epic 12 (Story 12.5, kiosk off for the pilot); Epic 13 (Story 13.7, native kiosk) DEFERRED.
- WD-1: Epic 13 (Story 13.7) DEFERRED.
- WEB-1 to WEB-5: Epic 2 (Story 2.7, email escaping, WEB-2-adjacent); Epic 13 (Story 13.6). WEB-1 is blocked on O-14 and WEB-5 on O-18.
- EDGE-1 to EDGE-3: Epic 10 (Story 10.5).
- PRT-1 to PRT-3: Epic 11 (Story 11.3), depending on O-4 and the venue's kitchen-printing requirement.

NFR coverage:
- Security: Epics 1–2.
- Data, backup and recovery: Epic 3.
- Environment, deployment and TLS: Epic 4.
- Observability, release, runbooks, E2E and defect policy: Epic 12.
- Every story carries DOD-26.

## Epic List

### Epic 1: Trustworthy build, CI and production start
Engineers and operators can trust that what passes CI is what runs, that production refuses unsafe defaults, and that the Go Core is tested on every change.
**FRs covered:** (enabler for all). NFRs: TEST-21, QB-Q, QB-R, QB-S, REL-24. Audit P0-02, P0-03.

### Epic 2: Secure access to staff, devices and realtime
Staff, devices and realtime subscribers can act only within their verified identity, role and venue. Revoked or unverifiable credentials are refused immediately.
**FRs covered:** WT-4 (backend enforcement), WEB-3 (admin isolation). NFRs: NFR-SEC-1, 2 and 3, SEC-16.x, QB-B, QB-D. Audit P0-04, P0-19 (part).

### Epic 3: Recoverable production data
Operators can bring the production database to a known migration baseline, and can recover it from tested backups.
**FRs covered:** (enabler). NFRs: NFR-REL (backup), QB-O, QB-P, QB-Q, INT-17.x. Audit P0-05, P0-12.

### Epic 4: Staging environment and Core deployment
The team can run Core and the transitional Nest side by side in a staging environment that mirrors the venue host, with TLS on the LAN.
**FRs covered:** (enabler). NFRs: QB-E, QB-R, REL-24. Audit P0-06.

### Epic 5: Staff ordering on Core from the Order Tablet
Waitstaff take orders through the web Order Tablet in Staff Mode, against Servvia Core.
**FRs covered:** ORD-1 to ORD-5, WT-1, WT-2, WT-4, WT-6. Audit P0-07, P1-01.

### Epic 6: Kitchen on Core
Kitchen staff see and advance Core kitchen tickets in real time, and keep working through an outage.
**FRs covered:** KIT-1 to KIT-6. Audit P0-08.

### Epic 7: Order lifecycle
Managers can cancel or void orders with authorisation. Orders complete truthfully, and pending payments resolve.
**FRs covered:** ORD-1 (lifecycle), PR-9. Audit P0-10.

### Epic 8: Real venue and staff setup
Owners configure the real venue, tables, tax and named staff with roles and venue grants, without seed scripts.
**FRs covered:** STF-1, VEN-1, TBL-1. Audit P0-11.

### Epic 9: Cash settlement from the Order Tablet Staff Mode
Authorised staff bill a visit, take cash under their shift, refund, and close the visit. Core stays authoritative throughout.
**FRs covered:** PAY-1 (cash), PAY-7 (cash), ORD-5. ADR 0002 item 8. Audit P0-09 (superseded scope).

### Epic 10: Integrated card payments through Venue Edge
Staff take card payments whose success comes only from a trusted, certified terminal integration.
**FRs covered:** PAY-1 (card), PAY-3 to PAY-7, EDGE-1 to EDGE-3. ADR 0002 item 2. Provider-specific work is BLOCKED on O-3.

### Epic 11: Receipts, printing and day close
Guests get a compliant receipt, the kitchen gets tickets on paper where needed, and managers can close a service day.
**FRs covered:** REC-1, RPT-2, PRT-1 to PRT-3, ADM-2. BLOCKED on O-5, O-6 and O-4.

### Epic 12: Operational readiness and release acceptance
Operators detect, diagnose and recover failures, and the release is proven by the PRD section 11 acceptance tests.
**FRs covered:** KIT-1 (multi-station), KSK (kiosk off). NFRs: OBS-20, REL-24, DEF-25, QB-AF, QB-AG, PERF-19. Audit P0-13, P0-15 to P0-19, P1-02 to P1-07.

### Epic 13: Deferred and blocked product scope (placeholders)
This records the remaining product scope so nothing is lost. Each story stays BLOCKED or DEFERRED until its decision is made.
**FRs covered:** MENU-1 to MENU-6, AVL-1, ADM-1, ADM-3, RES-1 to RES-5, RPT-1, WT-3, WT-5 (native), KSK-1 to KSK-5 (native), WD-1, WEB-1 to WEB-5, PAY-2.

## Epic 1: Trustworthy build, CI and production start

Engineers and operators can trust that what passes CI is what runs, that production refuses unsafe defaults, and that the Go Core is tested on every change. Audit P0-02 and P0-03.

### Story 1.1: API lint passes so the API CI job runs to completion

As an engineer,
I want the two `no-unnecessary-type-assertion` lint errors fixed,
So that the API job's typecheck and unit stages run in CI instead of stopping at lint.

**Acceptance Criteria:**

**Given** `apps/api/src/orders/orders.service.spec.ts:477,497`
**When** the redundant type assertions are removed without weakening any test assertion
**Then** `npm run lint`, typecheck and the unit suite for `apps/api` pass locally
**And** no lint rule is disabled or relaxed to get there.

- Traceability: TEST-21, QB-S; audit P0-02, CI evidence in section 3.4.
- Depends on: none.
- Status: READY

### Story 1.2: Go Core CI job with real PostgreSQL and Redis

As an engineer,
I want every change to run the Go Core build, vet, unit, race and database integration suites in CI,
So that Core regressions are caught before merge.

**Acceptance Criteria:**

**Given** `.github/workflows/ci.yml`
**When** a Go job is added using the module's toolchain version, with module checksums verified (`-mod=readonly`)
**Then** it runs `go vet`, `go build`, and `go test -race` with `SERVVIA_CORE_TEST_DATABASE_URL` and `SERVVIA_CORE_TEST_REDIS_ADDR` pointing at service containers
**And** the database version matches the documented production major version (PostgreSQL 18). The mismatch with the existing PG16 API job is recorded as a finding, not silently changed
**And** migrations are applied from `apps/api/prisma/migrations` (the Prisma authority) before the suites run
**And** the optional parity suite runs only when its Nest URL is configured, and is skipped explicitly otherwise.

- Traceability: TEST-21, QB-I, QB-K; audit P0-02.
- Depends on: none.
- Status: READY. Validating on GitHub needs a push (NEEDS AUTHORIZATION: push). Local validation runs with the same commands against disposable containers.

### Story 1.3: Venue Connector CI job made truthful

As an engineer,
I want the 3 failing Venue Connector .NET tests either fixed or the job formally retired with the legacy code,
So that CI is green without hiding failures.

**Acceptance Criteria:**

**Given** the Venue Connector job's 3 failing tests of 502
**When** they are diagnosed
**Then** either the defects are fixed and the job passes, or the job is retired only as part of an approved legacy-retirement checkpoint (PR-8)
**And** the job is never set to "continue on error", and its tests are never skipped to obtain green.

- Traceability: TEST-21, PR-8; audit P0-02.
- Depends on: none.
- Status: READY (fix path). The retirement path is BLOCKED: approval of the external-POS cleanup checkpoint (the C workstream).

### Story 1.4: Nest production start runs the built entry point

As an operator,
I want `start:prod`, the backend Dockerfile and `docker/start-backend.mjs` to run the file the build actually emits,
So that the production service starts.

**Acceptance Criteria:**

**Given** `nest build` emits `dist/src/main.js` because `tsconfig.json` has no `rootDir` or `include`
**When** the build configuration is corrected so the emitted entry matches the start command (or the start command is corrected to the emitted path)
**Then** a clean build followed by `start:prod` boots the API against a disposable database and answers its health endpoint
**And** a test or CI check fails if the start path and the emitted entry diverge again.

- Traceability: QB-Q, REL-24; audit P0-03.
- Depends on: none.
- Status: READY

### Story 1.5: Production configuration fails closed

As an operator,
I want the API to refuse to start in production with missing or development-default configuration,
So that development guards can never be open in production.

**Acceptance Criteria:**

**Given** `NODE_ENV` currently defaults to `development` (`app.module.ts:30`), and every production guard keys on it
**When** the environment is unset or invalid
**Then** startup fails with a clear error instead of defaulting to development
**And** in production, default JWT and service secrets, PIN 108, 3-digit PINs, fixture routes, simulated printers and Table-19 mode are refused at startup, each proven by a test
**And** Docker Compose development settings remain explicit and development-only
**And** the Node version is pinned (engines and CI).

- Traceability: QB-R, SEC-16.7, NFR-SEC-2; audit P0-03, section 4.2.
- Depends on: Story 1.4.
- Status: READY

### Story 1.6: Protect the main branch

As the owner,
I want `main` protected with required CI checks,
So that unreviewed or failing changes cannot reach the release line.

**Acceptance Criteria:**

**Given** `main` is unprotected
**When** branch protection is configured with the CI jobs from Stories 1.1 to 1.3 as required checks
**Then** a direct push or a failing pull request is refused.

- Traceability: QB-Q, REL-24; audit P0-02.
- Depends on: Stories 1.1 to 1.3.
- Status: NEEDS AUTHORIZATION: GitHub repository administration (a remote change).

## Epic 2: Secure access to staff, devices and realtime

Staff, devices and realtime subscribers act only within their verified identity, role and venue. Revoked or unverifiable credentials are refused immediately. Audit P0-04.

### Story 2.1: Realtime credential revocation fails closed

As a venue operator,
I want a tablet or KDS whose credential cannot be verified to be refused or disconnected,
So that a revoked device can never keep receiving venue events.

**Acceptance Criteria:**

**Given** a tablet token (`tablet_device`, `tablet_staff` or `tablet_manager`) and a device-active lookup that returns an error
**When** the client subscribes
**Then** the connection is closed with the existing contract code `INTERNAL` (1011) and is not admitted.

**Given** an admitted tablet subscription
**When** the periodic re-check's lookup returns an error
**Then** the connection is closed with `INTERNAL` (1011).

**Given** a KDS device credential that was admitted
**When** the periodic re-check returns an error other than unauthenticated, wrong kind or wrong venue
**Then** the connection is closed with `INTERNAL` (1011). Admission stays fail-closed, as today.

**Given** a revoked or unknown tablet or KDS credential
**When** it subscribes or is re-checked
**Then** the connection is closed with 4401 `UNAUTHENTICATED`, unchanged.

**Given** an active credential
**When** periodic re-checks succeed
**Then** the connection stays open.

**And** tests cover {active, revoked, lookup error} × {admission, re-check} × {tablet, KDS} and assert exact close codes. A transient failure must never produce 4401: the web client wipes its enrollment on 401-class failures (P1-01)
**And** failures are logged with `h.logger.WarnContext` including `request_id` (and `correlation_id` where present), mirroring `identity/guards.go:69-70`. No token is ever logged
**And** the realtime contract (`contracts/realtime/servvia-realtime.md`) needs no new code. Its prose is updated to state fail-closed behaviour.

- Traceability: SEC-16.5, SEC-16.12, NFR-SEC-3, QB-B; audit section 4.3, P0-04.
- PRODUCT DECISION DEPENDENCY: NONE.
- Depends on: none.
- Status: READY

### Story 2.2: Staff venue access is enforced by Core

As an owner,
I want Core to refuse any staff request for a venue the staff member has not been granted,
So that staff can act only in explicitly granted venues.

**Acceptance Criteria:**

**Given** a staff principal (a staff session, or an elevated `tablet_staff` or `tablet_manager` token) and a venue-scoped Core route or realtime subscription for venue V
**When** no `VenueAccess(staffId, V)` grant exists
**Then** Core refuses with 403 (REST) or `FORBIDDEN` 4403 (realtime) before any domain work, and the refusal is audit-logged.

**Given** a grant exists
**When** the same request is made
**Then** it proceeds unchanged.

**Given** the grant lookup fails
**When** any request needs it
**Then** Core fails closed with an internal error, never access.

**And** device-scoped kinds stay pinned to their token venue (existing `ResolveVenueScope` behaviour), and an elevated tablet also requires the staff member's grant for the device's venue
**And** the policy applies to every staff role, including owner and admin, because the PRD records no exception
**And** tests prove cross-venue denial for REST, realtime, and every financial route (checks, payments, shifts, refunds)
**And** development seeds create explicit grants for seeded staff. No production data change is made (production is documented empty; the baseline is Epic 3).

- Traceability: SEC-16.3, NFR-SEC-3, QB-D, MVP 9.6 (via PRD section 11 pilot acceptance); audit section 4.8; ADR 0002 item 9.
- PRODUCT DECISION DEPENDENCY: NONE for the rule as written.
- Depends on: none.
- Status: READY

### Story 2.3: Remove the unauthenticated local file-write endpoint from production builds

As an operator,
I want `PUT /api/admin/media-assets/local-dev-upload/:key` unreachable outside explicit local development, with a safe path check,
So that no unauthenticated client can write files.

**Acceptance Criteria:**

**Given** a production configuration
**When** the route is requested
**Then** it does not exist (404), independent of `NODE_ENV` defaults
**And** in development, the path check uses a separator-terminated prefix and a size limit, with negative tests for traversal and oversize bodies.

- Traceability: SEC-16.8, QB-B; audit section 4.1.
- Depends on: Story 1.5.
- Status: READY

### Story 2.4: Named staff sign-in replaces the shared admin PIN

As an owner,
I want Admin Console sign-in tied to named staff credentials,
So that every administrative action is attributable.

**Acceptance Criteria:**

**Given** `ADMIN_CONSOLE_PIN` grants an owner/admin JWT
**When** named staff login (existing Nest `POST login`, O-2 transitional) is the only Admin Console path
**Then** the shared-PIN endpoint is removed or disabled in production, with a negative test
**And** login is rate-limited (NFR-SEC-2) and audited (NFR-AUD).

- Traceability: NFR-SEC-1, NFR-AUD, QB-M; audit section 4.5.
- Depends on: Story 8.1 (staff accounts can be created) or a governed onboarding script.
- Status: BLOCKED until Story 8.1. Finding (2026-10-03): the Admin Console's only sign-in is the shared-PIN gate (`AdminPinGate`), and the API has no staff-creation endpoint; the existing provisioning scripts are not governed (hard-coded organization and venue, password from the environment, no audit). Disabling the PIN in production first would lock the Admin Console out. This story also needs an Admin Console named sign-in screen.

### Story 2.5: Token revocation and active-staff re-checks

As an owner,
I want deactivated staff and revoked sessions to lose access promptly,
So that a leaked or stale token cannot be used for 7 days.

**Acceptance Criteria:**

**Given** a refresh token or access token for staff who are deactivated or logged out
**When** it is used against Nest or Core
**Then** it is refused. Refresh tokens are revocable, and Core re-checks `isActive` (failing closed on lookup error)
**And** tests cover deactivation, logout and lookup failure.

- Traceability: SEC-16.4, SEC-16.5; audit section 4.7.
- Depends on: Story 2.2.
- Status: READY

### Story 2.6: Transitional socket.io authentication and CORS hardening

As an operator,
I want the transitional Nest socket.io gateway restricted to configured origins and re-checking credentials,
So that the legacy realtime path is not the weak link until clients move to Core realtime.

**Acceptance Criteria:**

**Given** socket.io accepts CORS `*` and authenticates only at connect
**When** the origin is not allow-listed, or the credential expires or is revoked
**Then** the connection is refused or closed, with tests.

- Traceability: SEC-16.9, SEC-16.12; audit section 4.4.
- Depends on: Story 2.5.
- Status: READY

### Story 2.7: Kitchen role cannot create or cancel orders; reservation email is escaped

As an owner,
I want the KDS venue-PIN token limited to kitchen actions, and guest-supplied text escaped in emails,
So that a kitchen screen cannot alter orders and email cannot be injected.

**Acceptance Criteria:**

**Given** a kitchen-role token
**When** it calls order create or cancel
**Then** it is refused (403), with tests.

**Given** a reservation with HTML in its name
**When** emails are sent
**Then** the HTML is escaped, with a test.

- Traceability: least privilege SEC-16.1; NFR-SEC-2; audit sections 4.6 and 4.9.
- Depends on: none.
- Status: READY

### Story 2.8: Durable staff sessions in PostgreSQL

As an owner,
I want a logout, credential reset or removal of authority to stay in force even if a cache is lost,
So that a revoked session can never become valid again for the rest of its life.

**Acceptance Criteria:**

**Given** Story 2.5 kept logout revocations in Redis, so a Redis data loss would have resurrected revoked sessions until their tokens expired
**When** sessions are recorded in the canonical database (a StaffSession row per sign-in, its id the tokens' `sid`)
**Then** Nest and Go Core refuse a token whose session is revoked, expired, missing or another staff member's, and a token minted before the staff member's role changed, reading PostgreSQL only (no cache), failing closed
**And** logout is idempotent, expired sessions are deleted after a fixed margin, and restart and cache-loss behaviour is tested.

- Traceability: SEC-16.4, SEC-16.5, PRD section 16 items 4 and 5; Story 2.5 known limit.
- Depends on: Story 2.5.
- Status: DONE

## Epic 3: Recoverable production data

Operators can bring the production database to a known migration baseline, and can recover it from tested backups. Audit P0-05 and P0-12.

### Story 3.1: Rehearse the production migration baseline on a copy

As an operator,
I want the baseline procedure (mark migrations 1–25 applied, then deploy the 16 pending) rehearsed on a schema-identical disposable database,
So that the production step is proven before anyone runs it.

**Acceptance Criteria:**

**Given** the documented production state (2026-09-12: empty, no `_prisma_migrations`, schema = migrations 1–25)
**When** the rehearsal runs on a disposable database built to that state
**Then** `migrate resolve` for 1–25 and `migrate deploy` for 26–41 succeed, and drift checks pass
**And** the fractional modifier price check and the timezone check run and are reported
**And** a runbook records each command and its rollback or forward-fix.

- Traceability: QB-Q, INT-17.x; audit P0-05.
- Depends on: none.
- Status: READY. Executing on production is NEEDS AUTHORIZATION: production database change.

### Story 3.2: Off-host backups with a scripted, rehearsed restore

As an operator,
I want nightly encrypted backups kept off the host for 30 days, plus a restore script proven by rehearsal,
So that the venue's data survives the loss of the PC.

**Acceptance Criteria:**

**Given** the current same-disk, 14-day, unencrypted `pg_dump`
**When** backups are reworked
**Then** retention is 30 days (NFR-REL), backups are encrypted and copied off-host, a failure raises an alert, and a restore script restores into a disposable database with row-count and checksum verification
**And** media and other stateful stores are inventoried, with their backup decision recorded.

- Traceability: NFR-REL, QB-O, QB-P; audit P0-12.
- Depends on: Story 3.1.
- Status: BLOCKED for the RPO/RTO acceptance thresholds (QB-O, OTR) and for retention periods beyond 30 days (QB-P, ODR). The mechanics can be built first. The off-host destination is NEEDS AUTHORIZATION: infrastructure or cost.

## Epic 4: Staging environment and Core deployment

The team runs Core and transitional Nest side by side in staging that mirrors the venue host. Audit P0-06.

### Story 4.1: Core runs as a managed Windows service with explicit configuration

As an operator,
I want Go Core packaged and run as a supervised service with a documented configuration contract and readiness checks,
So that Core can be deployed and recovered like the other services.

**Acceptance Criteria:**

**Given** Core has no deploy artefact
**When** a service definition and configuration contract are added (`DATABASE_URL`, `JWT_ACCESS_SECRET`, Redis, `SERVVIA_CORE_DB_READ_ONLY`, `TRUST_PROXY_HOPS`)
**Then** in staging the service starts, reports not-ready until dependencies are ready, drains on stop, and refuses development defaults.

- Traceability: QB-E, QB-R, RES-18.1; audit P0-06.
- Depends on: Story 1.2.
- Status: READY in staging. A production install is NEEDS AUTHORIZATION.

### Story 4.2: Staging environment mirroring the venue topology

As the team,
I want a staging environment (Nest, Core, PostgreSQL, Redis, the web clients) with request routing between Nest and Core,
So that cutover stories can be proven before the venue.

**Acceptance Criteria:**

**Given** no staging exists
**When** staging is provisioned
**Then** it reproduces the venue host layout and routes Core-owned paths to Core, and everything else to Nest
**And** LAN TLS is terminated with a documented certificate procedure.

- Traceability: REL-24, SEC-16 (TLS); audit P0-06.
- Depends on: Story 4.1.
- Status: NEEDS AUTHORIZATION: provisioning staging infrastructure.

## Epic 5: Staff ordering on Core from the Order Tablet

Waitstaff take orders through the web Order Tablet in Staff Mode against Servvia Core. Audit P0-07.

### Story 5.1: Guest Mode is off for the first pilot and Staff Mode requires elevation

As an owner,
I want the web Order Tablet to start locked, require staff elevation for Staff Mode, and expose no Guest Mode at the pilot,
So that customers cannot reach staff functions (WT-4) and the pilot scope matches ADR 0002.

**Acceptance Criteria:**

**Given** the tablet currently starts in Staff Mode while unelevated (`OrderTabletPage.tsx:359`)
**When** it loads
**Then** it starts locked and enters Staff Mode only after successful elevation. A configuration switch disables Guest Mode for the pilot
**And** Core refuses an unelevated `tablet_device` token on every staff route (existing `RequireStaff`), with tests
**And** Guest Mode code and the WT requirements are retained, not deleted.

- Traceability: WT-1, WT-2, WT-4, WT-5; ADR 0002 item 4; audit P1-01.
- Depends on: Story 2.2.
- Status: READY

### Story 5.2: Order Tablet Staff Mode submits sessions, orders and rounds to Core

As a waiter,
I want to open a visit and submit orders and rounds that Core records,
So that the kitchen and billing work from the canonical record.

**Acceptance Criteria:**

**Given** an elevated Staff Mode tablet
**When** a visit is opened and an order or round is submitted
**Then** the client calls Core table-session and order APIs with idempotency keys, displays Core's totals, and shows Core's stable errors (ORD-4)
**And** a repeated submission returns the original result (ORD-3), proven by a client and server test
**And** the order carries source, actor and device identity (WT-6); ordering opens no check (ORD-5)
**And** Core writes are enabled only in an environment that has passed the Epic 3 baseline.

- Traceability: ORD-1 to ORD-5, WT-6, PR-2, PR-3.
- Depends on: Stories 5.1, 4.2 and 3.1.
- Status: READY after its dependencies.

### Story 5.3: Order Tablet consumes Core realtime and resynchronises

As a waiter,
I want live updates from Core realtime, with a refetch after reconnect,
So that the tablet never shows stale state.

**Acceptance Criteria:**

**Given** Core realtime (`/api/realtime`)
**When** events arrive or the socket reconnects
**Then** the client refetches over HTTP (NFR-RT)
**And** a 401-class failure no longer wipes enrollment unless the device is actually revoked (P1-01).

- Traceability: NFR-RT, NFR-OFF; audit P1-01.
- Depends on: Stories 5.2 and 2.1.
- Status: READY after its dependencies.

## Epic 6: Kitchen on Core

Kitchen staff see and advance Core kitchen tickets in real time and keep working through an outage. Audit P0-08.

### Story 6.1: KDS reads and advances Core kitchen tickets with an authenticated device

As kitchen staff,
I want the KDS to show Core tickets (order, table, time, items, modifiers, notes) and advance their states,
So that the kitchen works from the canonical record.

**Acceptance Criteria:**

**Given** a D8 KDS device credential (authenticated, revocable)
**When** tickets are created by a Core round
**Then** they appear through Core realtime with the KIT-4 fields, and advance through valid transitions only
**And** cross-venue access is refused.

- Traceability: KIT-1, KIT-3, KIT-4, NFR-SEC-3.
- Depends on: Stories 2.1, 2.2 and 5.2.
- Status: READY. KDS authentication follows the PRD default (authenticated devices). O-13 asks whether that may be relaxed; this story does not relax it.

### Story 6.2: KDS surfaces delivery failures and survives backend outages

As kitchen staff,
I want visible failure states and a persisted ticket cache,
So that an outage never silently hides work.

**Acceptance Criteria:**

**Given** a backend outage or a realtime failure
**When** it occurs
**Then** received tickets remain visible from a persisted cache, the outage is shown, reconnection is automatic, and state is refetched (KIT-6)
**And** silent failures in `KitchenDisplayPage.tsx:427-477` are replaced by visible states (PR-4).

- Traceability: KIT-2, KIT-6, PR-4; audit P1-01.
- Depends on: Story 6.1.
- Status: READY after its dependency.

### Story 6.3: Ready alert and age colour-coding

As kitchen staff,
I want a visual and audible ready alert and age colouring,
So that late orders stand out.

**Acceptance Criteria:**

**Given** a configurable age threshold
**When** a ticket ages past it, or an order becomes ready
**Then** colour and alert behave per KIT-5.

- Traceability: KIT-5.
- Depends on: Story 6.1.
- Status: READY. The threshold is venue configuration, not an invented target.

## Epic 7: Order lifecycle

Managers cancel or void orders with authorisation. Orders complete truthfully, and pending payments resolve. Audit P0-10.

### Story 7.1: Manager-authorised order cancel and void in Core

As a manager,
I want to cancel or void an order or line with a reason and manager authorisation,
So that mistakes are corrected by explicit, audited compensating actions.

**Acceptance Criteria:**

**Given** an order whose status never moves past `confirmed` today
**When** a manager (owner, admin or manager role, venue-granted) cancels or voids with a reason
**Then** Core applies the transition, cancels the related kitchen tickets, and records audit and domain events in one transaction
**And** an order or line that is billed or paid cannot be silently voided (PR-9)
**And** tests cover authorization, idempotency, concurrency (row locks) and the refusal paths.

- Traceability: PR-9, INT-17.1, QB-I, QB-J, QB-K; audit P0-10.
- Depends on: Stories 2.2 and 5.2.
- Status: READY

### Story 7.2: Order completion and pending-payment resolution

As a manager,
I want orders to complete when served and billed, and pending or uncertain payments to have an explicit resolution path,
So that visits can close and nothing stays pending forever.

**Acceptance Criteria:**

**Given** D6 payments pending or uncertain block visit close
**When** a reconciliation action is recorded by an authorised role
**Then** the payment leaves `uncertain` only through reconciliation, and the visit-close invariants (D10) are respected.

- Traceability: PAY-6, INT-17.x; audit P0-10.
- Depends on: Story 7.1.
- Status: READY

## Epic 8: Real venue and staff setup

Owners configure the real venue, tables, tax and named staff, with roles and venue grants. Audit P0-11.

### Story 8.1: Staff management with roles and venue grants

As an owner,
I want to add and remove staff, assign roles, grant venues and reset credentials,
So that every person signs in as themselves with only their access.

**Acceptance Criteria:**

**Given** staff accounts can only be created by seed
**When** staff management is used (the transitional Nest administration path, per O-2)
**Then** staff, roles and `VenueAccess` grants are created and audited; PINs are unique per venue; credential reset is supported
**And** the mock Staff page (`MOCK_WORKFORCE`) is replaced.

- Traceability: STF-1, NFR-AUD; audit P0-11, P1-04.
- Depends on: Story 2.2.
- Implementation (2026-10-03): owners and admins administer staff through `/api/admin/staff` and the Admin Console Staff page (admins only below admin; nobody acts on themselves; the last active owner is kept; venues only those the actor holds). Credentials are set by the staff member with a single-use, hashed, 24-hour setup code issued at creation or reset; no administrator sees a password. Role change, deactivation, removal and reset revoke all sessions (Story 2.8); each change, its session revocation and its audit record commit in one transaction, and the last-owner guard is serialized per organization so concurrent changes cannot leave no active owner. Tablet PINs are unique per venue and only staff granted the tablet's venue can elevate; a manager can no longer set a superior's PIN.
- Status: DONE

### Story 8.2: Venue, tax and table settings from real data

As an owner,
I want venue settings (name, address, timezone, hours, capacity, tax) and tables configured from real data,
So that pricing and service use the real venue.

**Acceptance Criteria:**

**Given** venue settings are mock (`INITIAL_VENUES`)
**When** an owner edits them
**Then** they persist to the canonical record and are audited; tax uses the verified NZ GST-inclusive profile only, with other profiles failing closed.

- Traceability: VEN-1, TBL-1; audit P0-11.
- Depends on: Story 8.1.
- Status: READY

## Epic 9: Cash settlement from the Order Tablet Staff Mode

Authorised staff bill a visit, take cash under their shift, refund, and close the visit. ADR 0002 item 8; DL-118.

### Story 9.1: Staff open and close their own cash shift from Staff Mode

As a cashier,
I want to open my shift with a float and close it with a counted amount,
So that cash is accounted for, with Core computing expected cash and variance.

**Acceptance Criteria:**

**Given** an elevated staff member with role owner, admin, manager or cashier, granted for the venue
**When** they open or close their shift through Core D7
**Then** Core enforces one open shift per staff and venue, and computes expected cash and variance
**And** Guest Mode never shows these controls; a waiter-role token is refused by Core.

- Traceability: PAY-1, PRD section 11 "shift open and close"; ADR 0002 item 8.
- Depends on: Stories 5.1 and 8.1.
- Status: READY

### Story 9.2: Bill the visit and view the payable check

As a cashier,
I want to create a check over the visit's unbilled lines and see its total, payments and balance,
So that the guest is billed exactly once from the canonical record.

**Acceptance Criteria:**

**Given** a visit with unbilled Core order lines
**When** a check is created through Core D5
**Then** each line is billed at most once and later rounds stay unbilled until a further check (ORD-5)
**And** the check, its payments and its balance are displayed from Core (PR-4).

- Traceability: ORD-5, ADR 0001 item 4; ADR 0002 item 8.
- Depends on: Stories 9.1 and 5.2.
- Status: READY

### Story 9.3: Record a cash tender and observe settlement

As a cashier,
I want to record cash against the check under my open shift and see when it is settled,
So that the obligation is satisfied truthfully.

**Acceptance Criteria:**

**Given** an open check and my open shift
**When** I record cash
**Then** the payment succeeds at once under the shift, and settlement is recorded exactly once when payments cover the total
**And** idempotent replay, a closed-shift refusal and a cross-venue refusal are tested
**And** the DL-087 assertions in `tablet-auth.integration-spec.ts` and `OrderTabletPage.test.tsx` are deliberately updated for Staff Mode only, while Guest Mode no-payment tests are retained.

- Traceability: PAY-1 (cash), INT-17.x, QB-J; ADR 0002 item 8; DL-118.
- Depends on: Story 9.2.
- Status: READY

### Story 9.4: Void an unpaid check

As a manager,
I want to void an open check that has no payments, with a reason,
So that billing mistakes are corrected explicitly.

**Acceptance Criteria:**

**Given** an open check with no pending, uncertain or succeeded payments
**When** a manager voids it
**Then** its lines are released and the void is audited; a check with money attached is refused (`CHECK_HAS_PAYMENTS`).

- Traceability: PR-9; D5/D6 rules.
- Depends on: Story 9.2.
- Status: READY

### Story 9.5: Cash refund under the manager's shift

As a manager,
I want to refund part or all of a cash payment under my open shift,
So that refunds are accounted for in cash and audited.

**Acceptance Criteria:**

**Given** a succeeded cash payment
**When** a manager refunds within refundable capacity
**Then** the refund succeeds under the manager's open shift, expected cash is reduced, and over-refund is refused, with concurrency tests.

- Traceability: PAY-7; D9.
- Depends on: Story 9.3.
- Status: READY

### Story 9.6: Close the visit when it is financially complete

As a waiter or manager,
I want to close the visit only when every line is billed and every check is settled,
So that no visit closes with money outstanding.

**Acceptance Criteria:**

**Given** the D10 close invariants
**When** a close is requested
**Then** it succeeds only when complete; otherwise a stable error explains what is outstanding.

- Traceability: PRD section 11 "visit close"; D10.
- Depends on: Stories 9.3 and 9.4.
- Status: READY

## Epic 10: Integrated card payments through Venue Edge

Staff take card payments whose success comes only from a trusted, certified terminal integration. ADR 0002 item 2 (PILOT-CARD-3).

### Story 10.1: Provider-neutral payment-adapter contract

As an architect of the payment subsystem,
I want a versioned, provider-neutral adapter contract (initiate, result, uncertain, reconcile, refund and reversal) with adapter metadata isolation,
So that the chosen provider cannot contaminate canonical payment semantics.

**Acceptance Criteria:**

**Given** the existing D6/D9 adapter result paths
**When** the contract is specified in `contracts/`
**Then** it defines idempotent initiation and result keys, duplicate and late or out-of-order result handling, the `uncertain` and timeout semantics, the reconciliation inputs, and refund and reversal results. No card data is in scope (PAY-5)
**And** a terminal simulator implements the contract for tests only (never in production builds).

- Traceability: PAY-4, PAY-5, PAY-6, QB-T; ADR 0002 item 2.
- Depends on: none.
- Status: READY (provider-neutral)

### Story 10.2: Trusted adapter identity and result ingestion hardening

As a venue operator,
I want only an authenticated, venue-bound, revocable payment-adapter device to report results, with every edge case handled,
So that no staff action or forged request can mark a card payment succeeded.

**Acceptance Criteria:**

**Given** a D8 `payment_adapter` credential
**When** results arrive (duplicate, late, out of order, for another venue, or after revocation)
**Then** duplicates are idempotent, invalid transitions are refused, cross-venue and revoked reporters are refused, and every outcome is audited and emitted as a domain event
**And** a test proves no staff endpoint can set `succeeded`.

- Traceability: PAY-3, PAY-6, NFR-SEC-3, SEC-16.6; D6.
- Depends on: Stories 10.1 and 2.1.
- Status: READY

### Story 10.3: Uncertain outcomes, reconciliation and no duplicate charge

As a manager,
I want uncertain card outcomes reconciled before any retry, with reconciliation records,
So that a guest is never charged twice.

**Acceptance Criteria:**

**Given** a terminal timeout or disconnect
**When** the outcome is unknown
**Then** the payment stays `uncertain`, blocks a duplicate retry, and leaves only through reconciliation; Core and adapter restarts are covered by failure-injection tests.

- Traceability: PAY-6, RES-18.x; release acceptance "no duplicate charges, payment reconciliation".
- Depends on: Story 10.2.
- Status: READY (simulator). The provider reconciliation report format is BLOCKED: O-3.

### Story 10.4: Card refunds and reversals through the adapter

As a manager,
I want partial and full card refunds and reversals to complete only by adapter report,
So that refunds are as trustworthy as payments.

**Acceptance Criteria:**

**Given** a succeeded card payment
**When** a manager requests a refund
**Then** capacity is reserved, the refund stays pending until the adapter reports, and failures release capacity; tests cover concurrency and duplicate reports.

- Traceability: PAY-7; D9.
- Depends on: Story 10.2.
- Status: READY (simulator)

### Story 10.5: Venue Edge service foundation (identity, durable queue, diagnostics)

As a venue operator,
I want a Venue Edge service with a revocable venue identity, an encrypted durable leased queue, restart survival and visible health,
So that terminals (and printers where needed) are driven reliably.

**Acceptance Criteria:**

**Given** `services/venue-edge` (Go; scaffold only)
**When** the foundation is built per EDGE-1 to EDGE-3 and ADR 0001 item 7
**Then** it connects outbound only, keeps commands across process and machine restart without loss or duplication, and exposes heartbeat, version, queue depth and oldest age
**And** it never becomes a source of business truth.

- Traceability: EDGE-1 to EDGE-3, NFR-OFF; ADR 0001 item 7.
- Depends on: Story 10.1.
- Status: READY

### Story 10.6: Provider-specific terminal adapter and certification

As the owner,
I want the selected provider's terminal integrated and certified behind the contract,
So that the pilot can take real cards.

**Acceptance Criteria:**

**Given** a selected provider
**When** the adapter is implemented behind Story 10.1's contract
**Then** it passes the provider's certification, plus failure-injection tests through Venue Edge.

- Traceability: PAY-1, PAY-3, PAY-4; ADR 0002 item 2.
- Depends on: Stories 10.3 to 10.5.
- Status: BLOCKED: O-3 (in-person card provider and terminal).

## Epic 11: Receipts, printing and day close

Guests get compliant receipts, the kitchen gets paper tickets where needed, and managers can close a service day.

### Story 11.1: Customer receipt

As a guest,
I want a receipt that meets NZ obligations,
So that the venue can sell lawfully.

**Acceptance Criteria:**

**Given** settled checks
**When** a receipt is produced
**Then** its content meets the decided O-5 obligations.

- Traceability: REC-1.
- Depends on: Story 9.3.
- Status: BLOCKED: O-5 (receipt content and NZ tax-invoice obligations).

### Story 11.2: Minimum service-day close report

As a manager,
I want the service-day report needed to close a day,
So that the day can be reconciled and closed.

**Acceptance Criteria:**

**Given** a service day
**When** the day is closed
**Then** the report contains exactly the decided O-6 minimum.

- Traceability: RPT-2.
- Depends on: Story 9.3.
- Status: BLOCKED: O-6.

### Story 11.3: Receipt and (conditional) kitchen printing through Venue Edge

As a venue operator,
I want receipt printing, and kitchen printing if the venue requires it, through Venue Edge,
So that print delivery is truthful and recoverable.

**Acceptance Criteria:**

**Given** Venue Edge (Story 10.5)
**When** print jobs are issued
**Then** PRT-1 to PRT-3 and ADM-2 hold, with delivery separate from acknowledgement and explicit, attributed reprints.

- Traceability: PRT-1 to PRT-3, ADM-2, KIT-2.
- Depends on: Stories 10.5 and 11.1.
- Status: BLOCKED: O-4 (printers and protocol), O-5, and the venue's kitchen-printing requirement (not established).

## Epic 12: Operational readiness and release acceptance

Operators detect, diagnose and recover failures, and the release is proven by the PRD section 11 acceptance tests.

### Story 12.1: Monitoring and alerting for outages, backups, dead letters and stuck orders

As an operator,
I want alerts for service down, backup failure, dead letters and stuck orders,
So that failures are noticed before staff report them.

**Acceptance Criteria:**

**Given** the Core worker backlog and health endpoints
**When** a defined failure occurs
**Then** an alert fires with a runbook link.

- Traceability: OBS-20, QB-L, QB-AG; audit P0-13.
- Depends on: Story 4.2.
- Status: BLOCKED for alert thresholds that need owner targets (PERF-19 and OBS-20 OTR rows). The detection mechanics are READY.

### Story 12.2: Request IDs, structured logs and Core metrics

As an operator,
I want correlated structured logs across Nest and Core, and Core metrics,
So that an incident can be reconstructed.

**Acceptance Criteria:**

**Given** Nest has no request IDs
**When** a request crosses Nest and Core
**Then** both log a shared correlation ID with no secrets; Core exposes metrics.

- Traceability: OBS-20; audit P1-02.
- Depends on: none.
- Status: READY

### Story 12.3: Core database timeouts, device-route rate limits and dead-letter replay

As an operator,
I want statement and lock timeouts, device-route rate limits and an audited dead-letter replay,
So that stuck work is bounded and recoverable.

**Acceptance Criteria:**

**Given** Core has none of these
**When** they are added
**Then** each is tested, including a replay that is idempotent and audited.

- Traceability: RES-18.x, QB-F; audit P1-03.
- Depends on: none.
- Status: READY. Specific timeout values come from configuration, not invented targets.

### Story 12.4: Legacy decoupling for Servvia-native venues

As an operator,
I want IdealPOS dispatch timers behind an explicit enable flag, and `posAdapterType=none` for Servvia-native venues,
So that legacy paths cannot act on pilot orders.

**Acceptance Criteria:**

**Given** the dispatcher timers have no enable flag
**When** a flag is added (default off for native venues)
**Then** native venues create no POS sync records, with tests.

- Traceability: PR-8; audit P0-18.
- Depends on: none.
- Status: READY

### Story 12.5: Kiosk off in production until fixed

As an owner,
I want the kiosk ordering and payment path disabled in production,
So that the GST overcharge and the public, unbounded payment intent cannot reach guests.

**Acceptance Criteria:**

**Given** the kiosk adds 15% to GST-inclusive prices and has a public `create-payment-intent`
**When** production configuration is used
**Then** kiosk ordering and payment routes are disabled, with tests.

- Traceability: PAY-3, KSK-4; audit P0-19, section 4.10.
- Depends on: Story 1.5.
- Status: READY

### Story 12.6: Hide or relabel mock Admin pages

As an owner,
I want mock dashboard, report, audit and inventory pages hidden or labelled,
So that no fabricated data is presented as real (PR-4).

**Acceptance Criteria:**

**Given** the mock pages
**When** the Admin Console is built for production
**Then** they are hidden or clearly labelled as not available.

- Traceability: PR-4; audit P1-04.
- Depends on: none.
- Status: READY

### Story 12.7: Data-driven station routing

As kitchen staff,
I want lines routed to configured stations,
So that multi-station kitchens get the right tickets.

**Acceptance Criteria:**

**Given** a single-station router
**When** station configuration exists
**Then** routing follows it, using the configuration effective at submission.

- Traceability: KIT-1; audit P1-07.
- Depends on: Story 6.1.
- Status: DEFERRED. Needed only with more than one station; the venue's station set is not established.

### Story 12.8: End-to-end acceptance and failure drills

As the owner,
I want the PRD section 11 release-acceptance tests automated and failure drills rehearsed,
So that go-live readiness is proven, not asserted.

**Acceptance Criteria:**

**Given** the release-acceptance list
**When** the suite runs in staging
**Then** every item passes, with evidence: pricing and tax, no duplicate charges or KOTs, ordered replay, station routing, payment reconciliation, refunds, device revocation, audit correlation, and staff-visible recovery.

- Traceability: REL-24, PRD section 11; audit P0-15.
- Depends on: Epics 5 to 10.
- Status: READY to build incrementally. Final pass needs Story 10.6 (BLOCKED: O-3).

### Story 12.9: Runbooks and operational rehearsal

As an operator,
I want runbooks for deploy, rollback, incident, restore, end of day and Edge installation,
So that operations are repeatable.

**Acceptance Criteria:**

**Given** QB-AF
**When** each runbook is written
**Then** it is rehearsed in staging and the rehearsal is recorded.

- Traceability: QB-AF; audit P0-16.
- Depends on: Story 4.2.
- Status: READY. The end-of-day runbook is BLOCKED: O-6.

### Story 12.10: Security review and penetration test

As the owner,
I want an independent security review before production,
So that release-blocking issues are found first.

**Acceptance Criteria:**

**Given** Epics 1 and 2 are complete
**When** the review runs
**Then** findings are triaged under the defect policy.

- Traceability: SEC-16, DEF-25; audit P1-05.
- Depends on: Epic 2.
- Status: BLOCKED: DEF-25 severity definitions (ODR).

### Story 12.11: Performance and load smoke test

As the owner,
I want a load smoke test against the approved targets,
So that capacity is known.

**Acceptance Criteria:**

**Given** approved targets
**When** the test runs in staging
**Then** results are reported against them.

- Traceability: PERF-19, NFR-PERF; audit P1-06.
- Depends on: Story 4.2.
- Status: BLOCKED: O-19 (inherited targets unconfirmed) and the section 19 OTR rows.

### Story 12.12: Real-device, LAN and venue validation dry run

As the owner,
I want the pilot rehearsed on the real venue devices and LAN,
So that venue-specific problems surface before cutover.

**Acceptance Criteria:**

**Given** staging acceptance has passed
**When** the dry run executes on venue hardware
**Then** results are recorded. Cutover itself needs separate approval under the PRD section 11 production-cutover rule.

- Traceability: PRD section 11; audit P0-17.
- Depends on: Story 12.8.
- Status: NEEDS AUTHORIZATION: venue access.

### Story 12.13: Durable ingestion and retention of security and operational logs

As an operator,
I want security events and service logs shipped off the host and kept,
So that refusals such as `venue_access_denied` and `staff_session_refused` can be investigated after the fact.

**Acceptance Criteria:**

**Given** Core writes structured JSON to stdout and the Nest API writes local files under NSSM, with no rotation and no shipping (finding, 2026-10-03)
**When** a collector ingests both asynchronously, off the request path
**Then** security events reach a durable store, local files rotate, and a test proves credentials and bearer tokens are redacted before shipping
**And** no second transactional audit system is created and no request writes an AuditLog row for a refusal (AuditLog stays the business audit trail)
**And** retention is at least 90 days.

- Traceability: NFR-AUD, NFR-OBS; venue-access denial persistence (Tier 2, 2026-10-03 batch).
- Depends on: Stories 4.1, 4.2 and 12.2.
- Status: BLOCKED: retention beyond the 90-day floor and the sink's cost need owner decisions (Tier 3).

### Story 12.14: Isolated queue infrastructure for Nest integration tests

As an engineer,
I want each integration-test run to use its own Redis (or its own BullMQ prefix),
So that a stray process consuming the same queues cannot make a suite fail.

**Acceptance Criteria:**

**Given** `pos-sync-dispatcher.integration-spec.ts` failed once on 2026-10-03 because a leftover local API process (a BullMQ consumer on the shared Redis) took its jobs, and passed 20 of 20 runs in isolation
**When** the integration harness starts
**Then** it uses a dedicated Redis database or a unique queue prefix per run, and fails fast when another consumer is attached
**And** no test is deleted or disabled to achieve this.

- Traceability: TEST-21; 2026-10-03 failure classification (test infrastructure, not product behaviour).
- Depends on: none. Applies until the legacy POS sync is retired (docs/migration/idealpos-retirement.md, step 5).
- Implementation note: isolation is by construction (a unique BullMQ prefix per spec file, `QUEUE_PREFIX`; unset in production), so a foreign consumer cannot attach to a run's namespace and no fail-fast check is needed. Proven by a full run with a stale default-prefix consumer attached (it received no jobs).
- Status: DONE

### Story 12.15: Kitchen (KDS device) status changes fail on the audit actor foreign key

As a kitchen user,
I want to advance an order's preparation from the KDS,
So that the kitchen can work without errors.

**Acceptance Criteria:**

**Given** `PATCH /api/admin/orders/:id/status` with a KDS venue-PIN token answers 500, because its audit row uses the synthetic actor `kds-device:<venueId>`, which violates `AuditLog_actorId_fkey` (found while implementing Story 2.7)
**When** the audit attribution for device actors is decided
**Then** a kitchen status change succeeds and is audited with an attributable actor, with an integration test.

- Traceability: NFR-AUD, SEC-16.1; Story 2.7 finding.
- Decision (Tier 2, 2026-10-03): actor identity, device identity and provenance are separate. `AuditLog.actorType` is staff, device or system; the Staff foreign key stays for staff actors only, with a CHECK constraint per actor type and an UPDATE-rejecting trigger. No synthetic Staff row is created for a device. `AuditLog.venueId` restricts venue deletion instead of nulling history.
- Status: DONE

### Story 12.16: Device-originated orders without a synthetic staff creator

As an owner,
I want kiosk and unelevated-tablet orders attributed to the device or channel that created them,
So that no order names a fabricated staff member as its creator.

**Acceptance Criteria:**

**Given** `Order.createdById` is a required foreign key to Staff, so kiosk orders use a synthetic `kiosk-system+<org>` Staff row and restricted tablet orders a synthetic `tablet-device+<deviceId>` Staff row (found in Story 12.15; their audit rows inherit that actor)
**When** the order creator is modelled like the audit actor (staff, device or system)
**Then** new kiosk and tablet orders name their real origin, existing rows are left unchanged, and no new synthetic Staff row is created.

- Traceability: NFR-AUD; Story 12.15 finding.
- Depends on: Story 12.15.
- Status: READY

## Epic 13: Deferred and blocked product scope (placeholders)

This records the remaining product scope so nothing is lost. Each story stays BLOCKED or DEFERRED until its decision is made.

### Story 13.1: Windows POS terminal

As a cashier,
I want the Windows POS terminal,
So that the permanent main POS exists.

**Acceptance Criteria:**

**Given** the POS analysis report
**When** it exists
**Then** stories are written from it.

- Status: BLOCKED: PENDING USER POS ANALYSIS REPORT; DEFERRED (ADR 0002 item 1).

### Story 13.2: Guest Mode on Core and the native Waiter Tablet

As a guest,
I want to order from the table tablet,
So that I can self-order (WT-3).

**Acceptance Criteria:**

**Given** decisions O-20 and O-21
**When** they are made
**Then** a Core guest path and native Staff Mode authorisation are designed from them.

- Status: BLOCKED: O-20, O-21; DEFERRED (ADR 0002 item 4).

### Story 13.3: Menu, availability and admin capabilities move to their decided owner

As an owner,
I want menu, availability, live-order and daily-email administration owned by their decided long-term owner,
So that PR-7 holds.

**Acceptance Criteria:**

**Given** these capabilities work today through the transitional Nest path
**When** their ownership is decided
**Then** migration stories follow PR-8.

- Traceability: MENU-1 to MENU-6, AVL-1, ADM-1, ADM-3.
- Status: BLOCKED: O-7, O-8, O-17.

### Story 13.4: Reservations hardening and ownership

As a guest,
I want reliable reservations,
So that the venue is never overbooked.

**Acceptance Criteria:**

**Given** reservation creation has no transaction (overbooking risk)
**When** RES-3 is implemented
**Then** concurrency tests prove no overbooking.

- Traceability: RES-1 to RES-5.
- Status: The RES-3 fix is READY. Ownership is BLOCKED: O-7. RES-4 is BLOCKED: O-16.

### Story 13.5: Sales and reservation reporting

As an owner,
I want the RPT-1 reports,
So that I can see trading.

**Acceptance Criteria:**

**Given** settled Core data
**When** reports are built
**Then** they are venue-scoped and exportable.

- Traceability: RPT-1.
- Status: DEFERRED. The mock Reports page is handled by Story 12.6.

### Story 13.6: Public web and online ordering scope

As a public website guest,
I want the decided public web scope,
So that the site matches the owner's direction.

**Acceptance Criteria:**

**Given** decisions O-14, O-15 and O-18
**When** they are made
**Then** web stories are written.

- Traceability: WEB-1 to WEB-5, PAY-2.
- Status: BLOCKED: O-14, O-15, O-18.

### Story 13.7: Native kiosk and window display

As a kiosk customer,
I want the native kiosk and the entrance menu display,
So that the permanent devices replace the web runtimes.

**Acceptance Criteria:**

**Given** the Android toolchain decisions (O-10)
**When** they are made
**Then** native stories are written.

- Traceability: KSK-1 to KSK-5, WD-1.
- Status: BLOCKED: O-10; DEFERRED (native apps are P3).

## Readiness Gate Record (bmad-sprint-planning, 2026-10-03)

**Verdict: CONCERNS**

The operator authorised proceeding, so tracking was generated.

**Epics 1–10 and 12 are implementable as recorded.** They depend only on recorded decisions, or carry explicit BLOCKED and NEEDS AUTHORIZATION markers.

**Epic 11 and Epic 13 FAIL the implementability question.** Their stories depend on decisions that nothing yet records (O-4, O-5, O-6, O-7, O-8, O-10, O-14, O-15, O-16, O-17, O-18, O-20, O-21, and the POS report). They are recorded as BLOCKED placeholders, so no developer would have to invent anything; they cannot start.

**Concerns:**
1. **No UX design contract exists.** Client stories (Epics 5, 6 and 9) rely on existing screens plus PRD UX-22. Any new UX beyond the existing screens needs its own design input.
2. **Many owner targets are absent.** RPO/RTO, performance and alert thresholds, retention, and defect severity (OTR/ODR) gate Stories 3.2, 12.1, 12.10 and 12.11 in part.
3. **O-3 provider selection gates the pilot's card path** (Story 10.6), and therefore the first pilot itself (ADR 0002).
4. **Epics 1–4 are enabler epics.** The template's "user value, not technical layers" principle is bent deliberately: these are production-blocking prerequisites from the adopted audit, and each is phrased in operator or owner value.
5. **Several stories need separately authorised actions** (a push, GitHub administration, production database, infrastructure, venue access). They are marked NEEDS AUTHORIZATION.
6. **The audit's P0-09 estimate no longer matches the accepted scope.** The backlog should be re-estimated from this plan.
