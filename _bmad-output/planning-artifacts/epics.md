---
stepsCompleted: [1, 2, 3, 4]
inputDocuments:
  - PRD/product-requirements.md
  - PRD/README.md
  - PRD/00-overview-and-conventions.md
  - PRD/01-home.md to PRD/09-administration.md (consulted per requirement ID)
  - docs/adr/0001-servvia-is-the-operational-pos.md
  - docs/adr/0002-reduced-first-pilot.md
planningInputs:
  - docs/checkpoints/2026-10-05/bmad-reconciliation-sprint-change-proposal.md (frozen planning target; record of the Tier-2 decisions D-1 and D-3; O-10 and O-13 are recorded in the normative PRD; not requirements authority)
  - docs/audits/production-readiness-2026-12.md (evidence and sequencing input only)
workflow: bmad-create-epics-and-stories (BMAD 6.12.0); re-anchored by bmad-correct-course (Story 14.2)
generated: 2026-10-03
baselineCommit: abd4de8
reanchored: 2026-10-05
reanchorBaseline: e303ea6
notes: >-
  Brownfield. No starter template. No UX design contract exists: docs/ux.md
  is reference evidence only (PRD README, R-1). Re-anchored 2026-10-05
  (Story 14.2): the PRD document is PRD/product-requirements.md with
  PRD/README.md and the normative volumes PRD/00 to PRD/09; the Architecture
  document is PRD/product-requirements.md Part C (sections 28 to 36) with
  ADR 0001 and ADR 0002. fileRestructure.md is retired (consolidated into
  Part C) and is no input. docs/planning/ is never a requirements input. The
  audit is evidence and backlog input, never requirements authority.
---

# servvia - Epic Breakdown

## Overview

This document provides the complete epic and story breakdown for servvia. It decomposes the requirements from the PRD (`PRD/product-requirements.md`, approved 2026-10-03, with the normative volumes `PRD/00`–`PRD/09`, baseline accepted 2026-10-05) and the architecture requirements (`PRD/product-requirements.md` Part C, ADR 0001, ADR 0002) into implementable stories. Sequencing evidence comes from the adopted production-readiness audit (`docs/audits/production-readiness-2026-12.md`). No UX design contract exists.

**Re-anchoring (2026-10-05, Story 14.2, `bmad-correct-course`).** This plan was generated on 2026-10-03 from the pre-normative PRD and the now-retired `fileRestructure.md`. It is re-anchored to the normative PRD. The change analysis and every story disposition (keep, rewrite, split, supersede, merge, defer) are those of the accepted sprint change proposal (`docs/checkpoints/2026-10-05/bmad-reconciliation-sprint-change-proposal.md`, revision 2 plus its section 17 decisions), which is the frozen planning target and not requirements authority. Every requirement a story cites resolves to SPRD, a normative volume, an accepted ADR or an accepted controlled decision; planning evidence explains sequencing only. Historical statements below that describe the 2026-10-03 state (for example the audit's defect list) are kept as history.

**Planning rules applied:**
- **Unresolved items stay BLOCKED.** This covers every OWNER TARGET REQUIRED (OTR) and OWNER DECISION REQUIRED (ODR) item, the decisions still open in PRD section 14 and volume 00 section 00.10, R-3 and PENDING USER POS ANALYSIS REPORT. A story that needs one says `Status: BLOCKED` and names it. No target, provider behaviour or Windows POS behaviour is invented. Open owner and policy gates: O-1; the business parts of O-3, O-4, O-5 and O-6; pilot venue and timing (P13); P6; P2 and other configuration values; P5; P10; O-19 owner confirmation. DL-117 is NOT approved and dates nothing.
- **Decided, not implemented.** O-10, O-13 (SPRD §14; volume 00 §00.10.7), O-20, O-21 (volume 00 §00.10.6), DEC-ADMIN-22, DEC-OPS-21, P3 and P11 (§00.10.5) and the approved Tier-2 register (§00.10.4: DEC-OPS-1, DEC-OPS-4, DEC-FIN-11) are binding architecture. A story is never marked done because its architecture is decided; implementation status comes only from verified repository evidence.
- **Orchestrator Tier-2 decisions (2026-10-05).** **O-10** (the Android engineering baseline; exact versions pinned only in Story 17.1) and **O-13** (per-device, venue-bound D8 KDS identity; no human login) are recorded as decided in SPRD §14 with contracts in volume 00 §00.10.7. **D-1** (first pilot: transitional web KDS on canonical Core; permanent target `apps/android/kds`; no permanent web KDS) and **D-3** (the pilot web KDS authenticates to Core with the O-13 per-device, venue-bound D8 credential; the Nest venue PIN is not the canonical model) are sequencing and transitional decisions recorded in the sprint change proposal §9 and §17, with their architectural consequences in volume 00 §00.10.7.
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
- WT-5: Entering Staff Mode requires staff authorisation (native mechanism decided: O-20, volume 00 §00.10.6; implementation incomplete).
- WT-6: Consolidation removes no order-origin information (provenance model decided: O-21, volume 00 §00.10.6; implementation incomplete).
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

### Normative-corpus requirements used by the re-anchored plan (2026-10-05)

Each ID is defined in the normative corpus; the corpus wording governs.

- INV-3 (identity classes; device and system actors are first-class) and INV-5 (full provenance): volume 00 §00.5.
- INV-8 (business date), with P3 (effective-dated venue trading-day boundary; volume 00 §00.10.5) and FIN-31 (volume 07).
- P11 (headline Net Sales including GST; volume 00 §00.10.5) with BI-3 and BI-7 (volume 08).
- DEC-OPS-21 (device and system audit attribution; volumes 00, 02), DEC-X-6 (volume 00).
- DEC-ADMIN-22 (event-triggered revocation of live connections) and ADMIN-33 (volume 09); ADMIN-38 keeps the Nest venue PIN TRANSITIONAL (volume 09).
- O-20 and O-21 contracts (volume 00 §00.10.6); OPS-2 (volume 02).
- DEC-OPS-1 (cancel, void, comp), DEC-OPS-4 (line-level routing effective at submission), DEC-FIN-11 (uncertain-payment resolution): approved Tier-2 register, volume 00 §00.10.4.
- DEC-OPS-13 (additional device kinds; volume 02); DEC-X-17 (phasing of TARGET CAPABILITY — FUTURE DELIVERY; volume 00).
- DEC-FIN-10 (day-close rules; open, pilot-reporting gate with O-6).

### Additional Requirements

From the architecture (`PRD/product-requirements.md` Part C, ADR 0001, ADR 0002), the orchestrator Tier-2 decisions and the adopted audit (evidence):
- **No starter template.** This is a brownfield monorepo; the layout is fixed by SPRD Part C (sections 28–34; `fileRestructure.md` is retired and consolidated there). Code goes to its owner path (QB-U).
- **D-1 (Tier 2).** The first pilot uses the transitional web KDS migrated to canonical Go Core. The permanent destination is `apps/android/kds`. Replacement sequence: Core authoritative for KDS state; web KDS consumes Core, not Nest; native KDS on the same contracts; native parity proven; callers and venue operation migrate; web KDS retires (PR-8, SPRD §34). There is no permanent web KDS, and no web-KDS-only feature becomes a requirement.
- **D-3 (Tier 2).** The transitional pilot web KDS authenticates to Core with a per-device, venue-bound D8 credential (enrollment and bootstrap, credential handling appropriate to its deployment, Core HTTP and realtime authorization, revocation, venue binding, audit and O-21 provenance attribution). Ordinary KDS operation needs no human login. The Nest venue-PIN `kds_device` token is not the canonical pilot model.
- **O-10 (Tier 2).** The native Android baseline: Kotlin 2.x (K2), pinned Gradle wrapper, a supported stable mutually compatible AGP set, Kotlin DSL, Compose / Material 3, JDK 17, one version catalog, dependency verification and locking, Hilt, coroutines / Flow, OkHttp, kotlinx.serialization, Room, DataStore, Android Keystore (StrongBox opportunistic, not required), the supported test and quality stack, and an isolated signing pipeline. Exact versions are selected and pinned in Story 17.1 only; planning pins nothing and never means "always newest". `minSdk` comes from approved venue hardware and is never below API 26 without a new architecture decision.
- **Ownership.** Go Core (`services/core-platform`) owns canonical transactional state. PostgreSQL is canonical. Prisma (`apps/api/prisma`) stays the only migration authority; published migrations are never rewritten.
- **Contracts.** `contracts/` (OpenAPI, events, realtime schemas) versions every API and event change (QB-T).
- **Transitional overlap (PR-7).** NestJS may issue staff and device credentials and serve non-transactional administration during the first pilot (O-2 decided). Core enforces transactional authorization, venue scope and financial roles.
- **Fixed Android targets.** Exactly four: `apps/android/waiter-tablet` (Staff and Guest Mode), `apps/android/kds`, `apps/android/kiosk`, `apps/android/window-display` (SPRD §32). No customer, order-tablet or fifth target. Native apps are not part of the first pilot (ADR 0002; D-1); they are permanent target architecture on the post-pilot track (Epics 17–19).
- **Venue Edge and CARD3.** `services/venue-edge` owns local hardware and is never a source of business truth. The first-pilot card path is CARD3 only: a trusted adapter through Venue Edge, with results reported only by a `payment_adapter` D8 identity.
- **Windows POS.** `apps/windows/pos-terminal` is the permanent target; its behaviour is frozen pending the owner POS analysis report.
- **ADR 0002.** The reduced first pilot needs integrated card (trusted adapter; D6 unchanged; no staff-recorded card tender) and Staff Mode settlement on the web Order Tablet (transitional; DL-087 partially superseded for Staff Mode only; DL-087 tests changed deliberately). The cash drawer, Guest Mode and the Windows POS are excluded; kitchen printing is conditional.
- **Audit backlog evidence** (planning estimates, not commitments): P0-01 to P0-19 and P1-01 to P1-07 (audit section 8). The P0-09 description is superseded by ADR 0002.
- **Known code defects** (historical, as of 2026-10-03; audit sections 3–7, code-proven at `54dcfc0`; several are fixed in the accepted lineage, see the sprint change proposal §3):
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
- ORD-5: Epic 5 (Story 5.2); Epic 9 (Story 9.2); O-21 provenance persistence in Epic 15 (Stories 15.2a and 15.2d).
- KIT-1: Epic 16 (Story 16.2, line-level routing per DEC-OPS-4; supersedes Story 12.7); consumed by Epic 6 (pilot, D-1) and Epic 18 (native).
- KIT-2: Epic 6 (Story 6.2); Epic 18 (native).
- KIT-3: Epic 6 (Story 6.1, transitional web KDS on Core per D-1); Epic 18 (Story 18.1, native). The target is an O-19 planning baseline; owner confirmation is needed before release acceptance.
- KIT-4: Epic 6 (Story 6.1); Epic 15 (Story 15.5, D8 `kds` credential on Core kitchen routes); Epic 18 (Story 18.1).
- KIT-5: Epic 6 (Story 6.3); Epic 18 (Story 18.3).
- KIT-6: Epic 6 (Story 6.2); Epic 18 (Story 18.2).
- PAY-1: Epic 9 (cash); Epic 10 (card).
- PAY-2: Epic 13 (Story 13.6), BLOCKED: O-18. The kiosk is turned off by Story 12.5.
- PAY-3: Epic 10 (Story 10.2); Epic 12 (Story 12.5, kiosk).
- PAY-4: Epic 10 (Story 10.1).
- PAY-5: Epic 10 (Stories 10.1 and 10.3).
- PAY-6: Epic 10 (Story 10.3); Epic 16 (Story 16.4, manual uncertain-payment resolution per DEC-FIN-11).
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
- RPT-1: Epic 13 (Story 13.5, breadth DEFERRED); the P11 headline computation is Epic 16 (Story 16.5).
- RPT-2: Epic 11 (Story 11.2), content BLOCKED: O-6 / DEC-FIN-10; depends on Epic 16 (Stories 16.1 P3 and 16.5 P11).
- WT-1 to WT-6: Epic 5 (Story 5.1, Guest Mode off, honouring WT-4); Epic 15 (Stories 15.2a and 15.3, O-21 provenance and server-derived application identity); Epic 19 (native Waiter Tablet Staff Mode, O-20); Epic 13 (Story 13.2, Guest Mode) DEFERRED (ADR 0002 item 4; P9). O-20 and O-21 are decided; implementation is incomplete.
- KSK-1 to KSK-5: Epic 12 (Story 12.5, kiosk off for the pilot; done); Epic 13 (Story 13.7, native kiosk) DEFERRED until after Epic 17.
- WD-1: Epic 13 (Story 13.7) DEFERRED.
- WEB-1 to WEB-5: Epic 2 (Story 2.7, email escaping, WEB-2-adjacent); Epic 13 (Story 13.6). WEB-1 is blocked on O-14 and WEB-5 on O-18.
- EDGE-1 to EDGE-3: Epic 10 (Story 10.5a foundation; Story 10.5b outbound card command lease).
- PRT-1 to PRT-3: Epic 11 (Story 11.3), depending on O-4 and the venue's kitchen-printing requirement.

- INV-3, INV-5, DEC-OPS-21, DEC-ADMIN-22, O-20, O-21: Epic 15.
- INV-8 / P3, P11, DEC-OPS-1, DEC-OPS-4, DEC-FIN-11: Epic 16.

NFR coverage:
- Security: Epics 1–2; Epic 15 (audit actors, provenance, revocation, device credentials).
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
Kitchen staff see and advance Core kitchen tickets in real time, and keep working through an outage. Under D-1 the first-pilot surface is the transitional web KDS moved off Nest onto Core, authenticated per D-3; it retires through Epic 18.
**FRs covered:** KIT-2 to KIT-6 (KIT-1 routing in Epic 16). D-1, D-3. Audit P0-08.

### Order lifecycle (formerly numbered 7; superseded 2026-10-05)
Its two stories are rewritten into Epic 16 (Stories 16.3 and 16.4), citing the approved DEC-OPS-1 and DEC-FIN-11. The original text is kept below as a superseded record.

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
**FRs covered:** MENU-1 to MENU-6, AVL-1, ADM-1, ADM-3, RES-1 to RES-5, RPT-1 (breadth), WT-3, KSK-1 to KSK-5 (native), WD-1, WEB-1 to WEB-5, PAY-2. WT-5 (native Staff Mode) moves to Epic 19.

### Epic 14: Baseline integration and planning re-anchor (Wave A)
One integrated baseline holds the accepted engineering lineage, the legacy cleanup and the normative PRD, and BMAD planning consumes the normative PRD instead of retired or stale sources.
**Covers:** SPRD §28, §35, §36; volume 00 §00.1.1; PR-7. Planning and configuration only.

### Epic 15: Canonical identity, provenance and audit (Wave B)
Every pilot-critical action is attributable to a truthful actor (staff, device or system), every order carries its full provenance, revocation takes effect on live connections, and Core kitchen routes accept per-device KDS credentials.
**Covers:** INV-3, INV-5, DEC-OPS-21, DEC-ADMIN-22, ADMIN-33, O-20, O-21, D-3, NFR-SEC-3, NFR-AUD, WT-5, WT-6.

### Epic 16: Service-day correctness (Wave C)
Orders, payments and reports land on the correct business date, kitchen lines route to the right stations, and cancel, void, comp and uncertain payments follow the approved append-only architecture.
**Covers:** INV-8 / P3, FIN-31, P11 (BI-3, BI-7), KIT-1 / DEC-OPS-4, DEC-OPS-1, DEC-FIN-11, PAY-6, PR-9, VEN-1 (with Story 8.2).

### Epic 17: Native Android platform foundation (post-pilot track)
The four native applications share one approved engineering baseline (O-10), secure device enrollment and credential storage, and a Core realtime client.
**Covers:** SPRD §29, §32; O-10; D8; O-13 architecture; O-20 §8; NFR-RT.

### Epic 18: Native Android KDS (post-pilot; permanent KDS replacement)
The kitchen runs on `apps/android/kds`, the permanent KDS, which replaces the transitional web KDS after parity is proven (D-1 steps 3–6). It is not a first-pilot blocker under D-1.
**Covers:** KIT-2 to KIT-6, D-1, O-13 architecture, PR-8, SPRD §34.

### Epic 19: Native Waiter Tablet Staff Mode (post-pilot; primary transitional-retirement target)
Waitstaff use the native `apps/android/waiter-tablet` in Staff Mode, with O-20 staff elevation and O-21 provenance, replacing the transitional web Order Tablet and its ADR 0002 settlement exception.
**Covers:** WT-1, WT-2, WT-4, WT-5, WT-6, O-20, O-21, ADR 0002 item 8 retirement rule, PR-8.

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
- Finding resolved (2026-10-04): the API integration job now also runs on PostgreSQL 18, the production major version (18.6). Every Nest integration suite in this batch ran locally on PostgreSQL 18.4.
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
- Delivery: DONE. Fix path accepted (frozen objective `story-1-3-venue-connector-ci-job-made-truthful` v1; integrated in `ff3e4d7`). Tracking corrected 2026-10-05.

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
- Status: NEEDS AUTHORIZATION: GitHub repository administration (a remote change). Sequenced after Wave A (Epic 14).

### Story 1.7: Native-round-recovery integration tests run truthfully in CI

Recorded 2026-10-05 from its accepted story spec (`spec-1-7-native-round-recovery-ci-truthfulness.md`), which governs.

- Traceability: SPRD §21 (TEST-21), SPRD §24.
- Status: DONE. Accepted (frozen objective `story-1-7-native-round-recovery-ci-truthfulness` v1; integrated in `38bea30`).

### Story 1.8: Native-round-recovery tests refuse a DATABASE_URL host query override

Recorded 2026-10-05 from its accepted story spec (`spec-1-8-native-round-recovery-host-override-safety.md`), which governs.

- Traceability: SPRD §16, SPRD §21 (TEST-21).
- Depends on: Story 1.7.
- Status: DONE. Accepted (frozen objective `story-1-8-native-round-recovery-host-override-safety` v1; integrated in `38bea30`).

### Story 1.9: Test-harness loopback binding

As an engineer,
I want every API test request to target exactly the loopback endpoint its in-process test server is bound to,
So that evaluator and CI verdicts on integration tests cannot be corrupted by a wildcard/IPv4 port collision with an unrelated local process.

**Acceptance Criteria:**

**Given** the integrated baseline, where API test servers bind a wildcard address while requests target `127.0.0.1` (a measured intermittent failure on `38bea30`)
**When** the story is implemented under a frozen objective
**Then** every test server binds the explicit loopback endpoint that its requests target, with no production networking change
**And** every existing test still runs and passes at its re-measured floor, and the Story 1.7 recovery suite and Story 1.8 fail-safe pass unchanged.

- Traceability: SPRD §21 (TEST-21: deterministic tests on disposable environments), SPRD §24 (tests passing with explicit evidence), SPRD §16 (fail closed).
- Depends on: Stories 14.1 and 14.2 (Wave A).
- Status: DONE. Accepted by the orchestrator on 2026-10-06 (objective `story-1-9-test-harness-loopback-binding` v1, sha256 `dd4483c8…af77704`, anchor `fc064b5`, baseline `e42edeb`; candidate `f9110b7`, governed evaluator PASS / CANDIDATE_READY_FOR_ACCEPTANCE at iteration 1, evaluation record `d814065d…`, ledger integrity `374fde09…`; integrated in `963bd4c`). The TAP correction residual stays open: no correction occurred.

### Story 1.10: CI asserts the native-round-recovery suite executes

As an engineer,
I want CI to fail when the native-round-recovery suite is skipped instead of executed,
So that a green API integration job proves those tests actually ran.

**Acceptance Criteria:**

**Given** the API integration CI job can report green while the recovery suite falls back to a skip (Story 1.7 recorded deferral)
**When** the job runs
**Then** it fails unless the recovery tests executed; no test is weakened or skipped to obtain green.

- Traceability: SPRD §21 (TEST-21), SPRD §24.
- Depends on: Story 1.9.
- Status: DEFERRED (keep). Not started. It is not scheduled to follow Story 1.9 automatically: it needs its own orchestrator authorization (Story 1.9 is only its technical prerequisite).

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
- Finding (2026-10-03): the Admin Console's only sign-in was the shared-PIN gate (`AdminPinGate`), and the API had no staff-creation endpoint; the existing provisioning scripts are not governed (hard-coded organization and venue, password from the environment, no audit). Disabling the PIN in production first would have locked the Admin Console out.
- Implementation (2026-10-04): the shared PIN is removed everywhere, not kept as a fallback: `POST /api/auth/admin-pin` no longer exists (404, tested), the Admin Console signs in only through `POST /api/auth/login` with email and password, and a production host that still sets `ADMIN_CONSOLE_PIN` refuses to start. Sign-in keeps the per-address limit and adds a per-account limit (10 attempts per 15 minutes, every email alike, the same 429), so neither the limit nor any refusal reveals which accounts exist; unknown, wrong-password and deactivated sign-ins get one identical 401; logs and Redis hold an HMAC pseudonym of the address, never the address. Sessions, logout and revocation are Story 2.8's. Governed bootstrap: `npm run staff:issue-setup-code --workspace=apps/api -- <email>` issues an existing, active owner or admin a single-use setup code (Story 8.1), audited as the system actor `staff-credential-bootstrap`; it creates no account and changes no role or password. Cutover: before deploying, confirm an owner or admin can sign in by name (or issue them a code), then remove `ADMIN_CONSOLE_PIN` and `ADMIN_CONSOLE_EMAIL` from the host.
- Status: DONE (production cutover NEEDS AUTHORIZATION with the deployment).

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

### Story 2.9: Device and tablet credentials reach only the routes made for them

As an owner,
I want a PIN-elevated tablet or a KDS screen to reach only the routes built for devices,
So that a 4-digit PIN on a shared device can never administer the venue.

**Acceptance Criteria:**

**Given** ten administration controllers (menu items and categories, media and media assets, reservations, POS catalogue, connector and connector-command administration, payment observation and its fixtures) and the venue and table writes accepted any signed JWT whose role claim passed, with no device re-check (found in the 2026-10-04 review of Story 12.15), so a tablet elevated with an owner's or admin's PIN, whose token carries that role, could administer them, and kept doing so after the device was revoked
**When** every JWT route must declare whether it is staff-session-only or device-capable with a device re-check
**Then** the administration routes refuse every device and tablet credential (403), the device routes still work and stop when the device is revoked, and an architecture test fails if any JWT route declares neither.

- Traceability: SEC-16.1 (least privilege), NFR-SEC-1; Story 2.4 (attributable administration); Story 12.15 review finding.
- Depends on: none.
- Implementation (2026-10-04): StaffSessionOnlyGuard on the ten controllers and on the venue and table routes that are not used by tablets (the tablet keeps the table list and venue tax configuration, both with TabletTokenActiveGuard). The Order Tablet and KDS frontends call none of the closed routes. `token-scope.architecture.spec.ts` checks every route of every controller (46 routes were unscoped before; none now).
- Status: DONE

### Story 2.10: Staff venue access is enforced by the Nest API too

As an owner,
I want the API the venue's clients use today to refuse a staff request for a venue the staff member has not been granted, as Core does,
So that venue scoping does not depend on which service serves the request.

**Acceptance Criteria:**

**Given** Core enforces `VenueAccess` (Story 2.2) but the Nest API, which production clients use, checked only the organization, so any staff member, owner included, reached every venue of their organization (found by the 2026-10-04 live parity run: Nest 200 where Core 403)
**When** a staff principal (a staff session, or an elevated `tablet_staff`/`tablet_manager` token) requests a venue-scoped route or joins a venue's Socket.IO rooms
**Then** an own-organization venue without a grant is refused with Core's 403 body before any domain work and logged as `venue_access_denied`; another organization's venue keeps the route's own 404; a lookup that fails is a 500, never access; lists across venues narrow to the granted venues; and a revoked grant applies on the next request of the same session.

**And** device identities (KDS, an unelevated tablet) stay pinned to their token's venue, and an elevated tablet also needs its staff member's grant there
**And** the rule applies to every staff role, owner and admin included, because the PRD records no exception
**And** whoever creates a venue is granted it in the same transaction
**And** an architecture test fails if any JWT route neither declares where its venue comes from nor states why it is organization-level, or checks venue access before the device re-check.

- Traceability: SEC-16.3, NFR-SEC-3, PRD section 16 item 3; Story 2.2 (Core); 2026-10-04 parity finding.
- Depends on: Story 2.2.
- Implementation (2026-10-04): `VenueAccessGuard` with `@VenueScope` (path, query, body, a record's venue, the tablet token's venue, or a list) and `@OrganizationScope(reason)`, applying Core's decision (`internal/identity/venueaccess.go`); the Socket.IO `joinVenue` check and its periodic re-check; `venue-scope.architecture.spec.ts`; integration test `venue-access.integration-spec.ts`. Organization-level by declaration: the menu catalogue, the POS catalogue, the legacy media library, staff accounts (grants checked by the service), venue creation and tablet lock.
- Status: DONE

### Story 2.11: A real installation's first owner comes only from a governed bootstrap

As an owner,
I want no ordinary seed or script to be able to create, reset or restore a named owner on a real installation,
So that an owner's credential is known only to that owner.

**Acceptance Criteria:**

**Given** `prisma/seed.ts` resets the seeded owner's password and restores a deleted owner on every run, with no production guard and no audit, and `scripts/provisioning/create-owner-staff.mjs` created the production owner with an operator-chosen password (2026-10-04 review)
**When** the three concerns are separated
**Then** development and test seeding refuses `NODE_ENV=production` and any production-looking database with no override, and says when it resets the development owner; a real installation's first owner is created only by `npm run staff:bootstrap-owner`, which refuses while the organization has an active owner, gives the account no usable password, grants every venue of the organization, and prints a single-use setup code, all committed with system-actor audit records under the per-organization owner lock; credential recovery stays `npm run staff:issue-setup-code` (Story 2.4).

**And** the operator-password script is retired (it refuses to run)
**And** concurrent bootstrap runs for one organization create exactly one owner.

- Traceability: NFR-SEC-1, NFR-AUD; Stories 2.4 and 8.1; 2026-10-04 review finding.
- Depends on: Stories 2.4, 8.1 and 2.10.
- Implementation (2026-10-04): `src/config/seed-guard.ts`, `src/staff/owner-bootstrap.ts`, `scripts/provisioning/bootstrap-first-owner.ts`; integration test `owner-bootstrap.integration-spec.ts` (the race test fails 3 of 3 runs without the lock).
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
- Depends on: Story 2.2; Story 15.3 (application identity derived by Core).
- Status: READY after Story 15.3.
- Re-anchored 2026-10-05 (REWRITE): O-20 and O-21 are decided (volume 00 §00.10.6) and are no longer open. The web tablet keeps the DL-081 elevation model as a transitional surface (O-2) and carries the application identity Core derives from its verified credential (Story 15.3). Guest Mode stays off for the first pilot (ADR 0002 item 4).

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

- Traceability: ORD-1 to ORD-5, WT-6, PR-2, PR-3; O-21 (volume 00 §00.10.6).
- Depends on: Stories 5.1, 4.2 and 3.1; Stories 15.2a and 15.3 (the tablet's switch to Core writes O-21 provenance).
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

Re-anchored 2026-10-05 under **D-1**: the first-pilot KDS is the transitional web KDS (Admin Console KDS build mode) moved off Nest onto Core kitchen tickets and the Core realtime kitchen audience, authenticated with a per-device, venue-bound D8 `kds` credential (**D-3**, Story 15.5). It keeps only the KIT-2 to KIT-6 behaviour; no web-KDS-only feature becomes a requirement. It is transitional and retires through Epic 18 (PR-8, SPRD §34). The permanent KDS is `apps/android/kds`.

### Story 6.1: KDS reads and advances Core kitchen tickets with an authenticated device

As kitchen staff,
I want the KDS to show Core tickets (order, table, time, items, modifiers, notes) and advance their states,
So that the kitchen works from the canonical record.

**Acceptance Criteria:**

**Given** a per-device, venue-bound D8 `kds` credential enrolled into the KDS browser installation (D-3), and no human login for ordinary operation
**When** tickets are created by a Core round
**Then** the transitional web KDS reads them from Core HTTP and the Core realtime kitchen audience (not Nest or socket.io) with the KIT-4 fields, and advances them through valid transitions only, attributed to the device actor
**And** cross-venue access and a revoked device are refused over HTTP and realtime.

- Traceability: KIT-3, KIT-4, NFR-SEC-3, INV-3; D-1, D-3; O-13 architecture.
- Depends on: Stories 2.1, 2.2, 5.2, 15.5, 15.7 and 16.2.
- Status: READY after its dependencies. Re-anchored 2026-10-05 (REWRITE): O-13 is decided as architecture (per-device D8 identity) and D-3 replaces the Nest venue-PIN token for pilot venues; the browser credential handling covers only what this transitional surface needs.

### Story 6.2: KDS surfaces delivery failures and survives backend outages

As kitchen staff,
I want visible failure states and a persisted ticket cache,
So that an outage never silently hides work.

**Acceptance Criteria:**

**Given** a backend outage or a realtime failure
**When** it occurs
**Then** received tickets remain visible from a persisted cache, the outage is shown, reconnection is automatic, and state is refetched (KIT-6)
**And** silent failures in `KitchenDisplayPage.tsx:427-477` are replaced by visible states (PR-4).

- Traceability: KIT-2, KIT-6, PR-4; audit P1-01; D-1 (transitional web KDS on Core).
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

## Order lifecycle (formerly numbered 7) — superseded 2026-10-05

Superseded record, not tracked. Both items are rewritten into Epic 16 (7.1 → Story 16.3 citing DEC-OPS-1; 7.2 → Story 16.4 citing DEC-FIN-11). The original text is kept unchanged below.

Managers cancel or void orders with authorisation. Orders complete truthfully, and pending payments resolve. Audit P0-10.

#### Former item 7.1 (superseded by 16.3): Manager-authorised order cancel and void in Core

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

#### Former item 7.2 (superseded by 16.4): Order completion and pending-payment resolution

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

### Story 8.3: Staff integrity under concurrency

As an owner,
I want a tablet PIN to identify at most one person in each venue, and every staff change to be decided on current state,
So that concurrent administration can neither make a PIN ambiguous nor act on authority that has just been removed.

**Acceptance Criteria:**

**Given** PIN uniqueness was a check-then-write outside any transaction, a later venue grant could make two people's PINs equal in a venue unchecked (PINs are salted hashes, so a grant cannot compare them), and staff changes read the staff member before their transaction (2026-10-04 review)
**When** these changes run concurrently
**Then** within every venue where a PIN elevates a tablet it identifies at most one staff member: a PIN is enrolled per venue (`VenueAccess.pinEnrolledAt`) only where it was checked unique, under per-venue locks, inactive staff included; a new grant starts unenrolled; elevation considers enrolled PINs only; someone else's PIN is enrolled only in venues the actor holds; and every staff change locks the actor's and the staff member's rows and decides from their current role, status and grants.

**And** concurrent same-PIN assignments in a venue leave exactly one holder; concurrent grants and PIN changes keep the invariant; the last-owner guard still holds
**And** a refusal names nobody.

- Traceability: STF-1, NFR-SEC-1, NFR-AUD; Stories 2.2, 8.1 and 2.10; 2026-10-04 review findings.
- Depends on: Story 8.1.
- Implementation (2026-10-04): migration `20261014000000_tablet_pin_venue_enrollment` (backfills existing PIN holders' grants as enrolled); `src/staff/staff-locks.ts`; `StaffService.setTabletPin`; `StaffAdministrationService` (lockForChange); `TabletAuthService` match; integration test `staff-integrity.integration-spec.ts` (each race fails without its lock). The direct-write staff script `prisma/scripts/create-venue-staff-account.ts` is retired.
- Status: DONE

### Story 8.2: Venue, tax and table settings from real data

As an owner,
I want venue settings (name, address, timezone, hours, capacity, tax) and tables configured from real data,
So that pricing and service use the real venue.

**Acceptance Criteria:**

**Given** venue settings are mock (`INITIAL_VENUES`)
**When** an owner edits them
**Then** they persist to the canonical record and are audited; tax uses the verified NZ GST-inclusive profile only, with other profiles failing closed.

- Traceability: VEN-1, TBL-1; audit P0-11; P3 (volume 00 §00.10.5: the venue trading-day boundary configuration lives in these settings).
- Depends on: Story 8.1.
- Status: READY. Re-anchored 2026-10-05 (REORDER): sequenced in Wave C, before Story 16.1, and includes the P3 boundary configuration (organization default plus venue override, prospective changes only).

## Epic 9: Cash settlement from the Order Tablet Staff Mode

Authorised staff bill a visit, take cash under their shift, refund, and close the visit. ADR 0002 item 8; DL-118.

Re-anchored 2026-10-05: Stories 9.1 to 9.6 additionally depend on Story 15.2d (O-21 provenance on checks, payments and refunds) and Story 16.1 (P3 business date). Settlement on the web Order Tablet is the transitional ADR 0002 exception; it retires through Story 19.3.

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

Re-anchored 2026-10-05: CARD3 is the only first-pilot card path. Story 10.5 is split into 10.5a (Venue Edge foundation) and 10.5b (outbound Core → Edge card command lease); nothing dispatches pending card payments to an adapter today. CARD3 track order: 10.1 → 10.5a → 10.5b → 10.2 → 10.3 → 10.4, then 10.6 after the O-3 business choice.

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

### Story 10.5a: Venue Edge service foundation (identity, durable queue, diagnostics)

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
- Status: READY. Re-anchored 2026-10-05 (SPLIT): the card command lease moved to Story 10.5b.

### Story 10.5b: Core to Venue Edge card command lease

As a venue operator,
I want Venue Edge to lease pending card commands from Core over an outbound-only connection,
So that card payments created in Core actually reach the trusted terminal adapter, exactly once.

**Acceptance Criteria:**

**Given** Core holds pending card payments and Venue Edge connects outbound only (EDGE-2)
**When** Edge leases pending card commands with idempotency
**Then** each command is delivered at most once per lease, survives Edge and Core restarts, and its result returns only through the existing trusted adapter result route (a `payment_adapter` D8 identity)
**And** an expired lease or an uncertain outcome is never retried in a way that could duplicate a charge (PAY-6).

- Traceability: EDGE-2, EDGE-3, PAY-1, PAY-6; ADR 0002 item 2 (CARD3).
- Depends on: Story 10.5a.
- Status: READY after its dependency.

### Story 10.6: Provider-specific terminal adapter and certification

As the owner,
I want the selected provider's terminal integrated and certified behind the contract,
So that the pilot can take real cards.

**Acceptance Criteria:**

**Given** a selected provider
**When** the adapter is implemented behind Story 10.1's contract
**Then** it passes the provider's certification, plus failure-injection tests through Venue Edge.

- Traceability: PAY-1, PAY-3, PAY-4; ADR 0002 item 2.
- Depends on: Stories 10.3, 10.4, 10.5a and 10.5b.
- Status: BLOCKED: O-3 business part (card provider, acquirer, terminal, commercial terms). The trusted-adapter mechanism is decided (CARD3).

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

**Given** a service day whose records carry a P3 business date
**When** the day is closed
**Then** the report contains exactly the decided O-6 minimum, computed from the Core read models with the P11 metric definitions, and payments reported separately from sales.

- Traceability: RPT-2; P3, P11 (volume 00 §00.10.5); DEC-FIN-10.
- Depends on: Stories 9.3, 16.1 and 16.5.
- Status: BLOCKED: O-6 business part / DEC-FIN-10 (content). Re-anchored 2026-10-05 (REWRITE): the business date and the sales measure are decided; only the report content remains open.

### Story 11.3: Receipt and (conditional) kitchen printing through Venue Edge

As a venue operator,
I want receipt printing, and kitchen printing if the venue requires it, through Venue Edge,
So that print delivery is truthful and recoverable.

**Acceptance Criteria:**

**Given** Venue Edge (Story 10.5a)
**When** print jobs are issued
**Then** PRT-1 to PRT-3 and ADM-2 hold, with delivery separate from acknowledgement and explicit, attributed reprints.

- Traceability: PRT-1 to PRT-3, ADM-2, KIT-2.
- Depends on: Stories 10.5a and 11.1.
- Status: BLOCKED: O-4 business part (hardware purchase; whether the venue requires kitchen printing), O-5 business/legal part. The print-job mechanism (Venue Edge, independent delivery states) is decided.

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
- Progress (2026-10-04): Nest now assigns and echoes `X-Request-Id` and `X-Correlation-Id` by Core's rules and attaches both to its security events. Nest does not call Core today, so there is nothing to forward yet. Remaining: Core metrics, and request IDs on Nest's other (non-security) logs.
- Status: READY

### Story 12.3a: Core database statement timeout and lock timeout

Recorded 2026-10-05 (SPLIT of the former Story 12.3) from its accepted story spec (`spec-12-3a-core-database-timeouts.md`), which governs.

- Traceability: RES-18.x, QB-F; audit P1-03.
- Status: DONE. Accepted (frozen objective `story-12-3a-core-database-timeouts` v1; integrated in `8a4d3ab`). Timeout values come from operator configuration, not invented targets.

### Story 12.3b: Device-route rate limits and dead-letter replay

As an operator,
I want device-route rate limits and an audited dead-letter replay,
So that stuck work is bounded and recoverable.

**Acceptance Criteria:**

**Given** Core has neither (database timeouts are delivered by Story 12.3a)
**When** they are added
**Then** each is tested, including a replay that is idempotent and audited.

- Traceability: RES-18.x, QB-F; audit P1-03.
- Depends on: none.
- Status: READY. Specific limits come from configuration, not invented targets. Re-anchored 2026-10-05 (SPLIT remainder of the former Story 12.3).

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
- Delivery: DONE. Accepted (frozen objective `story-12-5-kiosk-off-in-production` v1; integrated in `e575658`). Tracking corrected 2026-10-05.

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

#### Former item 12.7 (superseded 2026-10-05 by 16.2; not tracked): Data-driven station routing

As kitchen staff,
I want lines routed to configured stations,
So that multi-station kitchens get the right tickets.

**Acceptance Criteria:**

**Given** a single-station router
**When** station configuration exists
**Then** routing follows it, using the configuration effective at submission.

- Traceability: KIT-1; audit P1-07.
- Depends on: Story 6.1.
- Status (historical): DEFERRED. Superseded 2026-10-05: re-scoped to DEC-OPS-4 (line-level routing effective at submission) as Story 16.2, which is on the first-pilot critical path.

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

**Given** the O-19 planning-baseline targets
**When** the test runs in staging
**Then** results are reported against them.

- Traceability: PERF-19, NFR-PERF; audit P1-06.
- Depends on: Story 4.2.
- Status: READY after its dependency, to run against the O-19 planning baseline (SPRD §14: BASELINE ACCEPTED FOR PLANNING). Release acceptance still needs O-19 owner confirmation; the section 19 OTR rows stay BLOCKED and no number is invented. Re-anchored 2026-10-05 (gate wording).

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
- Foundation (2026-10-04, unblocked part): the Nest API emits security events as JSON lines in Core's shape from a fixed taxonomy (`apps/api/src/observability/security-events.ts`; sign-in, session, credential-setup and rate-limit refusals and failures), with every field redacted in-process before it is written (secret-named fields, JWTs, Bearer/Basic values, setup codes, email addresses, control characters; tested unit and end to end), each carrying the request and correlation IDs (Story 12.2). AuditLog is unchanged and no refusal writes to it. Contract and what remains: `docs/runbooks/security-events.md`.
- Status: BLOCKED for the rest: the durable sink and its cost, retention beyond the 90-day floor (owner decisions, Tier 3), and NSSM stdout rotation on the host (deployment, needs authorization).

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
- Follow-up (2026-10-04 review): printer reprint and retry and native-round resolution recorded a staff member acting through an elevated tablet without the tablet; they now record it, and refuse a device credential (which names no staff member) before changing anything.
- Status: DONE

#### Former item 12.16 (merged 2026-10-05 into 15.2, now 15.2c; not tracked): Device-originated orders without a synthetic staff creator

As an owner,
I want kiosk and unelevated-tablet orders attributed to the device or channel that created them,
So that no order names a fabricated staff member as its creator.

**Acceptance Criteria:**

**Given** `Order.createdById` is a required foreign key to Staff, so kiosk orders use a synthetic `kiosk-system+<org>` Staff row and restricted tablet orders a synthetic `tablet-device+<deviceId>` Staff row (found in Story 12.15; their audit rows inherit that actor)
**When** the order creator is modelled like the audit actor (staff, device or system)
**Then** new kiosk and tablet orders name their real origin, existing rows are left unchanged, and no new synthetic Staff row is created.

- Traceability: NFR-AUD; Story 12.15 finding.
- Depends on: Story 12.15.
- Status (historical): READY. Merged 2026-10-05: a device-originated order creator is a special case of O-21 provenance, delivered by Story 15.2c (split 2026-10-06).

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

**Given** decisions O-20 and O-21 (decided 2026-10-05, volume 00 §00.10.6) and DEC-OPS-8
**When** Guest Mode is scheduled after the first pilot
**Then** a Core guest path is designed from them; native Staff Mode authorisation is delivered by Epic 19.

- Status: DEFERRED (ADR 0002 item 4); Guest Mode menu-channel and display policy is open under P9. Re-anchored 2026-10-05 (SPLIT / DEFER): no longer blocked by O-20 or O-21; native Staff Mode moved to Epic 19, and Guest Mode becomes an Epic 19 follow-on.

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
- Status: DEFERRED (RPT-1 breadth; DEC-BI residuals). The mock Reports page is handled by Story 12.6. Re-anchored 2026-10-05 (SPLIT): the P11 headline sales computation moved to Story 16.5.

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

**Given** the approved Android baseline (O-10) proven by Epics 17 and 18
**When** the native kiosk and window display are scheduled
**Then** native stories are written for `apps/android/kiosk` and `apps/android/window-display`, with their device kinds added additively (DEC-OPS-13).

- Traceability: KSK-1 to KSK-5, WD-1; DEC-OPS-13.
- Status: DEFERRED until after Epic 17; display policy open under P9. Re-anchored 2026-10-05 (SPLIT / DEFER): O-10 is decided, so this is no longer blocked by it; neither app is a first-pilot surface.

## Epic 14: Baseline integration and planning re-anchor (Wave A)

One integrated baseline holds the accepted engineering lineage, the legacy cleanup and the normative PRD, and BMAD planning consumes the normative PRD instead of retired or stale sources. Added 2026-10-05 (sprint change proposal §5). Planning and configuration only; no runtime change.

### Story 14.1: Integrate the normative PRD into the accepted lineage and retire fileRestructure.md

As the orchestrator,
I want one integrated baseline that holds the accepted lineage, the legacy cleanup and the normative PRD corpus,
So that every later story is planned and evaluated against a single authoritative baseline.

**Acceptance Criteria:**

**Given** the cleanup tip `354ea1b` and the accepted normative PRD corpus
**When** the corpus is integrated byte-exact and `fileRestructure.md` is removed (consolidated into SPRD Part C)
**Then** current-state references point to `PRD/product-requirements.md`, while historical and frozen evidence is not rewritten
**And** exactly four Android application directories exist and the three removed legacy application directories are absent.

- Traceability: SPRD §28, §36; PRD README "Normative corpus baseline"; PR-7.
- Status: DONE. Wave A commit `5ee6474` on `integration/normative-prd-baseline` (2026-10-05).

### Story 14.2: Re-anchor BMAD configuration and active planning to the normative PRD

As the orchestrator,
I want BMAD configuration, the active epics, the epic contexts and sprint tracking to consume the normative PRD,
So that no planning workflow uses the retired `fileRestructure.md`, `docs/planning/` or stale planning as requirements authority.

**Acceptance Criteria:**

**Given** `_bmad/custom/*.toml` and the active planning artifacts name `fileRestructure.md` as the architecture input
**When** they are re-anchored
**Then** every active BMAD input resolves to SPRD, the normative volumes, accepted ADRs or accepted controlled decisions, and none names `fileRestructure.md` or `docs/planning/` as an input
**And** sprint tracking shows accepted stories as done, Story 1.9 as not frozen and Story 1.10 as deferred
**And** frozen objectives and accepted story specs are unchanged (hashes), and no runtime, migration, contract or CI file changes.

- Traceability: SPRD §28, §35; volume 00 §00.1.1.
- Depends on: Story 14.1.
- Status: DONE. Accepted 2026-10-05: implementation `0d1e334`, followed by the governance closure that recorded O-10 and O-13 in the normative PRD and made the authority rule explicit.

## Epic 15: Canonical identity, provenance and audit (Wave B)

Every pilot-critical action is attributable to a truthful actor, every order and round carries its canonical provenance, revocation takes effect on live connections, and Core kitchen routes accept per-device KDS credentials. O-20, O-21, DEC-ADMIN-22, DEC-OPS-21 and the O-13 architecture (with D-3) are decided; their implementation is missing or partial.

**Reconciled 2026-10-06 against the accepted lineage (`dff753a`).** Code audit; evidence in each story's "Current state" line.
- **Already implemented, not repeated here:** Core staff venue scope (`identity/venueaccess.go`; Epic 2); fail-closed realtime admission (`realtime/realtimeapi/handler.go`); the periodic 60 s realtime re-check of tablet status, staff session and D8 `kds` credential; D8 enroll / rotate / revoke with venue binding (`devices/`); realtime admission of a D8 `kds` device to the kitchen audience (`realtime/authorization.go`); the `AuditLog` actor shape (staff / device / system, CHECK `AuditLog_actor_shape_check`, migration `20261010000000_audit_actor_types`); venue-scoped idempotency keys on orders, rounds, checks and payments, with replay returning the original.
- **Authorization and provenance stay separate.** Stories that derive provenance never widen authorization, and stories that change authorization record no new provenance.
- **Transitional credentials gain no capability** (ADMIN-38). The Nest tablet and KDS-PIN tokens are not extended. Application identity is derived by Core from the already-verified credential kind (15.3). Native clients receive Core-issued credentials with Epics 17–19.
- **Not in Epic 15:**
  - Windows POS authentication (PENDING USER POS ANALYSIS REPORT);
  - Android implementation (Epics 17–19);
  - the web KDS migration (6.1);
  - account-level PIN lockout for native Staff Mode, a mechanism of Core-owned O-20 elevation (Story 19.1; values P2), which is not added to the transitional Nest tablet (ADMIN-38).

**Order (dependency graph):**
1. **Foundations, independent:** 15.1 (audit actor model) ‖ 15.3 (server-derived principal) ‖ 15.4a (Core push-close) ‖ 15.7 (D8 bootstrap).
2. 15.1 → 15.5 (kitchen routes accept D8 `kds`).
3. 15.3 → 15.2a (order and round provenance) → 15.2b (event metadata); 15.2a → 15.2d (check, payment and refund provenance).
4. 15.2c (Nest device-originated orders without synthetic staff) is independent of 15.1: it uses the existing Nest audit-actor helper (`apps/api/src/audit/audit-actor.ts`), which already records device and system actors. *(Corrected 2026-10-06 at Story 15.1 objective preparation; the former edge 15.1 → 15.2c was false.)*
5. 15.4a → 15.4b (Nest revocations signal push-close).
6. **Consumers later:** 6.1 (transitional web KDS: 15.5, 15.7, 16.2); 5.1 and 5.2 (15.3, 15.2a); Epics 9 and 16 (15.2a, 15.2d); 17.2 and 19.x (15.3, 15.5, 15.7).

### Story 15.1: Core audit records device and system actors truthfully

As an auditor,
I want every Core audit record to name its real actor class (staff, device or system),
So that no device or system action is attributed to a staff member and a staff action records the device it was taken on.

**Acceptance Criteria:**

**Given** the existing `AuditLog` actor shape (staff, device, system; enforced by `AuditLog_actor_shape_check`) and Core's eight staff-only audit writers
**When** Core records an audited mutation
**Then** every Core audit writer records the actor through one Core audit-actor model that can express staff, device and system actors in the shape the CHECK constraint enforces
**And** a staff action taken through a tablet records the staff actor together with the tablet's device kind and device id (today the device is dropped)
**And** results reported by a D8 `payment_adapter` device (payment result, refund result, reversal) stay in the append-only transition histories with the device identity, as FIN-36 requires; Story 15.1 adds no AuditLog row for them and invents no staff actor
**And** a device or system action can never write a staff identity, and no synthetic staff row is created (negative tests).

- Current state (2026-10-06): Core `INSERT INTO "AuditLog"` at `orders/pgstore/store.go:492`, `checks/pgstore/store.go:453`, `payments/pgstore/store.go:520`, `payments/pgstore/adjustments.go:310`, `shifts/pgstore/store.go:259`, `tables/pgstore/store.go:371`, `promotions/pgstore/store.go:215`, `devices/pgstore/store.go:368` write only `actorId`/`actorEmail`/`actorRole` (staff). `OnTablet` (`orders/ordersapi/handler.go:252`) is not persisted. Payment-adapter results write no AuditLog row; they are recorded as transitions with the device id and actor kind `payment_adapter` (`payments/pgstore/store.go:345`, `payments/pgstore/adjustments.go:197, 366`), which satisfies FIN-36 (corrected 2026-10-06 at objective preparation).
- Allowed surfaces (conceptual): Core audit writers and a shared Core audit-actor type under `services/core-platform/internal/**`; their unit and integration tests. No schema change (the schema already supports the shape); no Nest, contract or client change.
- Acceptance evidence: integration tests on PostgreSQL per writer, for a staff actor and for staff-through-tablet; a negative test that a device or system actor cannot produce a staff-shaped row; the existing audit tests keep passing. (The former "device-actor row for each payment-adapter result route" was removed 2026-10-06: it conflicts with FIN-36, volume 07.)
- Traceability: INV-3, DEC-OPS-21, DEC-X-6, NFR-AUD, FIN-36; O-21 item 4 (volume 00 §00.10.6).
- Depends on: none (Story 14.1 done).
- Status: READY. **Recommended first Epic 15 story.**

### Story 15.3: Core derives application identity, operating mode and actor class from the verified credential

As a security reviewer,
I want Core to establish the caller's application identity, operating mode and actor class from the verified credential alone,
So that provenance and staff authority never rest on what a client declares.

**Acceptance Criteria:**

**Given** the credential kinds Core already verifies (staff session JWT, Nest `tablet_device` / `tablet_staff` / `tablet_manager` and `kds_device` JWTs, D8 device credentials)
**When** an authenticated request reaches Core
**Then** Core resolves one server-side principal carrying application identity, operating mode, actor class, actor identity, device identity and venue, derived only from the verified credential
**And** a client-declared application identity or mode is never trusted. In particular, the order source a tablet declares is checked against the derived application identity, not merely against `StaffMaySubmit`
**And** the transitional Nest tokens are not changed (ADMIN-38), and no authorization rule is widened.

- Current state (2026-10-06): no application-identity claim exists (`identity/token.go:65-75`; Nest `jwt-payload.interface.ts:16-29`). Actor class is partly inferred from the token kind (`identity/guards.go:104-154`; `realtime/realtimeapi/handler.go:372-384`). `OrderSource` is client-declared, gated only by `StaffMaySubmit` (`orders/order.go:49-54`).
- Open at objective preparation: the application-identity values for the transitional web surfaces. O-21 fixes `waiter_tablet` for the native family and keeps `order_tablet` readable. If a value is not already defined by the PRD (section 33, O-21) it is escalated, not invented.
- Allowed surfaces (conceptual): `services/core-platform/internal/identity/**` and the call sites that read the principal; their tests. No Nest or client change.
- Acceptance evidence: a table-driven test over every credential kind covering application identity, mode and actor class; a negative test that a mismatched declared source is refused; the existing guard and venue-scope tests unchanged.
- Traceability: O-21 items 1 and 7, O-20 items 1–3 (volume 00 §00.10.6), INV-3, OPS-2, WT-4, WT-6; ADMIN-38.
- Depends on: none.
- Status: READY (application-identity values for transitional surfaces confirmed at objective preparation). Re-scoped 2026-10-06: it no longer adds a claim to Nest-issued tokens (ADMIN-38), and PIN lockout moved to native Staff Mode elevation (19.1).

### Story 15.2a: O-21 order and round provenance persistence

As an owner,
I want every order and every round to record where, by whom and in which mode it was entered,
So that consolidation removes no order-origin information (WT-6).

**Acceptance Criteria:**

**Given** orders carry only a client-declared source and rounds only a submitting staff id
**When** O-21 provenance is persisted additively on orders and rounds (application identity, device id, operating mode, actor class, actor or guest-session id, correlation id, with the idempotency context already stored), from the 15.3 principal
**Then** a mixed-mode visit records each round's own provenance, an idempotent replay from a different credential returns the original provenance, and a client-declared mode is ignored
**And** `order_tablet` stays readable, published migrations are untouched, and no enum is changed destructively.

- Current state (2026-10-06): `Order.source` (client-declared), `OrderRound.submittedByStaffId`; no device, application, mode, actor class or correlation fields (`prisma/schema.prisma` Order :989-1085, OrderRound :1181). A replay returns the stored original (`orders/service.go:212-221, 287-305`), but a different actor's replay is only logged.
- Allowed surfaces (conceptual): one additive Prisma migration on Order and OrderRound; Core orders domain and store; `contracts/openapi` order contract (additive). No client change.
- Acceptance evidence: migration from zero and upgrade; integration tests for a mixed-mode visit, a cross-credential replay and an ignored declared mode; contract tests.
- Traceability: O-21 items 1, 2, 6, 7, 8 (volume 00 §00.10.6); INV-5; OPS-2; WT-6; ORD-3.
- Depends on: Story 15.3.
- Status: READY after its dependency. (SPLIT 2026-10-06 of the former Story 15.2.)

### Story 15.2b: Domain events carry actor, correlation and causation

As an operator,
I want durable domain events to carry the identity, correlation and causation needed for downstream attribution,
So that consumers never reconstruct Staff versus Guest Mode or the actor from a payload value.

**Acceptance Criteria:**

**Given** `DomainEvent` holds no actor, correlation or causation (`events/event.go:23-46`; `events/pgstore/store.go:40-62`)
**When** an event is written in the same transaction as its round, order or transition
**Then** it carries the actor class and identity, the correlation id and the causation id of the originating request; the realtime envelope extends additively, and existing consumers keep working.

- Allowed surfaces (conceptual): Core events package and its writers; `contracts/realtime` (additive); an additive migration.
- Acceptance evidence: projector and realtime tests read the metadata; a replay keeps the original metadata; contract tests.
- Traceability: O-21 item 5 (volume 00 §00.10.6); INV-5; NFR-AUD.
- Depends on: Story 15.2a.
- Status: READY after its dependency. (SPLIT of the former Story 15.2.)

### Story 15.2c: Device-originated orders carry no synthetic staff creator (transitional Nest paths)

As an owner,
I want kiosk and unelevated-tablet orders attributed to the device that created them,
So that no order or audit row names a fabricated staff member.

**Acceptance Criteria:**

**Given** Nest attributes kiosk orders to a synthetic `kiosk-system+<org>` staff row (`orders/orders.service.ts:1038-1053`) and restricted tablet orders to a synthetic `tablet-device+<deviceId>` staff row (`tablet/tablet-auth.service.ts:103-118`)
**When** such orders are created
**Then** they and their audit rows name the device (or system) actor through the existing Nest audit-actor helper; existing rows are left unchanged, and no new synthetic staff row is created.

- Allowed surfaces (conceptual): the two Nest creation paths and their tests. No Core change; no new capability on the transitional tablet (ADMIN-38: an attribution correction only).
- Traceability: INV-3, NFR-AUD, DEC-OPS-21; former Story 12.16.
- Depends on: none (the Nest helper already supports device and system actors). The kiosk stays off in production (12.5).
- Status: READY. (Formerly 12.16, merged into 15.2 and now its own slice.)

### Story 15.2d: Check, payment and refund provenance

As an auditor,
I want checks, payments and refunds to record the same canonical provenance as orders and rounds,
So that financial actions are attributable to application, device, mode and actor.

**Acceptance Criteria:**

**Given** checks, payments and refunds record only staff ids (plus `originDeviceId` on adjustments)
**When** they are created
**Then** they record O-21 provenance from the 15.3 principal, additively, and replays keep the original.

- Traceability: O-21 item 2 (volume 00 §00.10.6); INV-5; PAY-3.
- Depends on: Story 15.2a.
- Status: READY after its dependency. Needed before Epic 9 switches the web tablet's settlement to Core. (SPLIT of the former Story 15.2.)

### Story 15.4a: Core closes live realtime connections when a credential is revoked

As a security reviewer,
I want a revocation to close the affected live Core realtime connections as a consequence of the revocation itself,
So that revoked authority does not survive on an open socket.

**Acceptance Criteria:**

**Given** Core ends subscriptions only on slow consumers or shutdown (`realtime/hub.go:15-19`), and has no revocation signal (no NOTIFY or bus)
**When** a revocation is committed
**Then** a revocation signal emitted in the revoking transaction reaches the realtime hub, which closes every affected connection
**And** a D8 device revoked through Core (`devices/pgstore/store.go:179`) closes that device's sockets end to end
**And** the periodic revalidation stays as defence in depth and also covers venue grants, which are checked today only at subscription time (`realtimeapi/handler.go:404-415`).

- Out of scope: the transitional Nest socket.io gateway (`orders.gateway.ts`).
- The signal mechanism is a Tier-1 choice at objective preparation. A shorter polling interval is not acceptable as the mechanism (DEC-ADMIN-22).
- Acceptance evidence: integration tests showing a device revocation closing its socket by event, without waiting for the re-check; a grant revocation closing a staff socket through the safety net; close latency measured and reported, with no invented numeric bound (P7).
- Traceability: DEC-ADMIN-22, ADMIN-33, SPRD §16 items 5 and 12, NFR-SEC-3; O-20 item 7; O-13 architecture item 4.
- Depends on: none (Story 15.1 recommended first, for the audit of revocation-driven events).
- Status: READY. Required before release acceptance. (SPLIT 2026-10-06 of the former Story 15.4: Core side.)

### Story 15.4b: Nest revocations signal Core push-close

As a security reviewer,
I want revocations that Nest performs to close the affected Core realtime connections too,
So that staff sessions, staff accounts, venue grants and tablet devices revoked in Nest stop working immediately on live connections.

**Acceptance Criteria:**

**Given** the Nest revocation paths:
- staff session revoke and logout (`auth/staff-session.service.ts:55-78`, `auth/auth.service.ts:228`);
- role change, deactivate, remove and credential reset (`staff/staff-administration.service.ts`);
- credential setup (`staff/credential-setup.service.ts:149`);
- venue-grant removal (`staff-administration.service.ts:292-313`);
- tablet-device revocation (`tablet/tablet-auth.service.ts:232-256`);

**When** any of them commits
**Then** it emits the 15.4a revocation signal in the same transaction, and Core closes the affected connections.

- Allowed surfaces (conceptual): those Nest revocation paths and their tests. This is not new capability on transitional credentials: it propagates the existing revocations (DEC-ADMIN-22).
- Acceptance evidence: one integration test per revocation path showing the affected Core realtime connection closed by the signal, without waiting for the periodic re-check.
- Traceability: DEC-ADMIN-22, ADMIN-33, SPRD §16 item 5, NFR-SEC-3; O-20 item 7 (volume 00 §00.10.6).
- Depends on: Story 15.4a.
- Status: READY after its dependency. Required before release acceptance. (SPLIT of the former Story 15.4: Nest side.)

### Story 15.5: Core kitchen routes accept per-device D8 kds credentials

As kitchen staff,
I want the KDS to authenticate to Core as a per-device, venue-bound device,
So that the pilot KDS needs no human login and every kitchen action is attributable and revocable.

**Acceptance Criteria:**

**Given** Core kitchen ticket routes accept only JWTs (`kitchenCallers`, `server/server.go:137-149`: Nest `kds_device` JWT or staff), while realtime already admits a D8 `kds` device
**When** the device-authorization chain is added to the kitchen ticket read and transition routes
**Then** an active D8 `kds` device reads and transitions its own venue's tickets, attributed to the device actor (transition history and audit through 15.1)
**And** a revoked device and a device registered at another venue are refused; staff access is unchanged; the Nest `kds_device` JWT remains accepted only as the transitional path until 6.1 migrates the web KDS.

- Allowed surfaces (conceptual): Core server wiring for kitchen routes, the kitchen API and their tests; `contracts/openapi/kitchen-tickets.yaml` (additive security scheme).
- Traceability: INV-3, NFR-SEC-3, KIT-4; O-13 architecture and D-3 (volume 00 §00.10.7); O-21 item 4.
- Depends on: Story 15.1.
- Status: READY after its dependency. Credential rotation cadence: P2 configuration (open).

### Story 15.7: D8 single-use enrollment redemption (device bootstrap)

As a venue administrator,
I want to enroll a device with a single-use, short-lived enrollment that the device itself redeems,
So that a device credential is never handed through an administrator's browser and nothing ships pre-provisioned.

**Acceptance Criteria:**

**Given** D8 enrollment returns the device credential to the enrolling administrator (`devices/service.go:137-176`; there is no redemption route)
**When** an administrator creates an enrollment and the device redeems it once
**Then** the first credential is issued only on redemption; a second redemption, an expired enrollment and a redemption for another venue are refused; enrollment and redemption are audited.

- Open at objective preparation: the bootstrap mechanism and the enrollment lifetime are Tier-1 mechanics (volume 00 §00.10.7, O-13 item 3); the lifetime is configuration (P2), never an invented value.
- Allowed surfaces (conceptual): Core devices domain, store, API and tests; `contracts/openapi/devices.yaml` (additive); one additive migration if needed.
- Traceability: O-13 architecture items 1, 3 and 7 and D-3 (volume 00 §00.10.7); SPRD §16 item 6.
- Depends on: none.
- Status: READY. Needed by 6.1 (the transitional web KDS) and 17.2 (native devices).

## Epic 16: Service-day correctness (Wave C)

Orders, payments and reports land on the correct business date, kitchen lines route to the right stations, and cancel, void, comp and uncertain payments follow the approved append-only architecture. P3, P11, DEC-OPS-1, DEC-OPS-4 and DEC-FIN-11 are decided; their implementation is missing. Story 8.2 (venue settings, including the P3 boundary configuration) precedes Story 16.1.

### Story 16.1: P3 business date

As a manager,
I want every service-day record assigned to the venue's business date deterministically,
So that trading days, reports and day close agree across midnight and DST.

**Acceptance Criteria:**

**Given** an effective-dated venue trading-day boundary (organization default plus venue override; changes are prospective only)
**When** orders, rounds, checks, payments, refunds and shifts are recorded
**Then** each receives its business date deterministically while UTC timestamps are preserved
**And** property tests across DST transitions pass, and a boundary change never rewrites historical business dates.

- Traceability: P3 (volume 00 §00.10.5), INV-8, FIN-31, VEN-1.
- Depends on: Stories 8.2 and 15.2a (shared migration window).
- Status: READY after its dependencies.

### Story 16.2: Line-level station routing

As kitchen staff,
I want each order line routed to its configured station using the configuration in effect at submission,
So that multi-station kitchens receive exactly their tickets.

**Acceptance Criteria:**

**Given** a single kitchen station today
**When** a station configuration model exists and a round is submitted
**Then** routing is line-level and effective at submission, and one round can produce several station tickets
**And** a later configuration change does not re-route already-submitted lines.

- Traceability: KIT-1, DEC-OPS-4 (volume 00 §00.10.4), PRT-1.
- Depends on: Story 14.1.
- Status: READY. Supersedes former item 12.7.

### Story 16.3: Cancel, void and comp in Core

As a manager,
I want to cancel, void or comp with a reason under configured authority,
So that mistakes are corrected by explicit, linked, append-only compensating actions.

**Acceptance Criteria:**

**Given** the approved DEC-OPS-1 architecture
**When** an authorised, venue-granted role cancels, voids or comps an order, line or check
**Then** Core records an append-only, linked compensating action with audit and domain events in one transaction, and cancels related kitchen tickets where applicable
**And** billed or paid items are never silently voided (PR-9), with tests for authorization, idempotency, concurrency and refusal paths; permission thresholds are configuration supplied before pilot enablement (P6), never invented.

- Traceability: DEC-OPS-1 (volume 00 §00.10.4), PR-9, INT-17.1.
- Depends on: Stories 15.1 and 15.2a.
- Status: READY after its dependencies. Pilot enablement BLOCKED: P6 values. Rewrites former item 7.1.

### Story 16.4: Order completion and uncertain-payment resolution

As a manager,
I want orders to complete truthfully and uncertain payments to have an explicit, evidenced resolution path,
So that visits can close and nothing stays pending forever.

**Acceptance Criteria:**

**Given** payments can be pending or uncertain and block visit close
**When** an authorised role records a resolution through the append-only manual resolution route, with provider evidence and step-up authorisation
**Then** the payment leaves `uncertain` only through that route or reconciliation, a contradicting provider fact goes to reconciliation, and the visit-close invariants hold.

- Traceability: DEC-FIN-11 (volume 00 §00.10.4), PAY-6, INT-17.x.
- Depends on: Story 16.3.
- Status: READY after its dependency. Rewrites former item 7.2.

### Story 16.5: P11 operational sales computation

As an owner,
I want the headline sales measure computed in Core per business date,
So that the pilot's sales figures follow the decided definition.

**Acceptance Criteria:**

**Given** the P11 definitions (headline Net Sales including GST; billed basis less discounts and comps; refunds on their own business date)
**When** the Core read model computes Gross Sales, Discounts/Comps, Net Sales including GST, GST, Net Sales excluding GST and Refunds/Returns per business date
**Then** fixtures reproduce the metric definitions exactly, refunds land on their own business date, and tenders are reported separately from sales.

- Traceability: P11 (volume 00 §00.10.5), BI-3, BI-7; volume 08 metric definitions.
- Depends on: Story 16.1.
- Status: READY after its dependency. Report content beyond the headline stays with O-6 / DEC-FIN-10 and the DEC-BI residuals.

## Epic 17: Native Android platform foundation (post-pilot track)

The four native applications share one approved engineering baseline (O-10), secure device enrollment and credential storage, and a Core realtime client. This is permanent target architecture, off the first-pilot critical path (ADR 0002; D-1; O-1 open). O-10 is approved; no version is pinned by planning.

### Story 17.1: Android engineering baseline per O-10

As an Android engineer,
I want one reproducible Android build baseline for the four applications,
So that every native app is built, verified and tested the same way.

**Acceptance Criteria:**

**Given** the four application scaffolds under `apps/android/` and the approved O-10 baseline
**When** the baseline is created
**Then** it uses Kotlin 2.x (K2), a pinned Gradle wrapper, Kotlin DSL, Compose / Material 3, JDK 17, one version catalog, dependency verification and locking, and the approved library, test and quality stack, with a required CI job that has no `continue-on-error`
**And** the story records official compatibility and release evidence and pins one supported, stable, mutually compatible Kotlin / Gradle / AGP / Compose / JDK / SDK set (never "always newest"; no alpha, beta or RC)
**And** `minSdk` follows approved venue hardware and is not below API 26, release signing stays outside the repository and CI, no fifth application exists, and no product UI is built.

- Traceability: O-10 (Tier-2 decision), SPRD §29, §32.
- Depends on: Story 14.2.
- Status: READY (post-pilot track). Gradle root and build-logic placement are settled within O-10 in this story. Hardware-derived `minSdk` input: O-4 business part.

### Story 17.2: Native device enrollment, secure credential storage and Core realtime client

As a venue device,
I want to enroll once, store my device credential securely and keep a Core realtime subscription,
So that native apps authenticate as revocable, venue-bound devices and stay current.

**Acceptance Criteria:**

**Given** the Core D8 enrollment routes and the realtime contract
**When** a native app enrolls with a single-use, short-lived enrollment
**Then** its credential material is protected by the Android Keystore (hardware-backed or StrongBox where available; StrongBox is not required), no reusable staff secret is stored on the device, and the realtime client authorizes at subscribe, deduplicates by event id, drops stale versions, backs off and refetches over HTTP
**And** revocation fails closed, and re-enrollment never reuses a credential.

- Traceability: D8, O-13 architecture, O-20 §8 (volume 00 §00.10.6), NFR-RT, `contracts/realtime`.
- Depends on: Stories 17.1, 15.3, 15.5 and 15.7.
- Status: READY after its dependencies. Shared code moves to `packages/android` only when a second app consumes it.

## Epic 18: Native Android KDS (post-pilot; permanent KDS replacement)

The kitchen runs on `apps/android/kds`, the permanent KDS. It is the first native surface, a time-boxed platform pathfinder on the lowest-risk surface, and replaces the transitional web KDS after parity (D-1 steps 3–6). It is not a first-pilot blocker under D-1.

### Story 18.1: Native KDS tickets and transitions on Core with a D8 identity

As kitchen staff,
I want the native KDS to show and advance Core kitchen tickets as an enrolled device,
So that the permanent KDS works from the canonical record.

**Acceptance Criteria:**

**Given** an enrolled `kds` device (Story 17.2) and Core kitchen routes accepting it (Story 15.5)
**When** tickets are created by a Core round
**Then** they appear in real time with the KIT-4 fields and advance through valid transitions only, attributed to the device actor; cross-venue and revoked devices are refused.

- Traceability: KIT-3, KIT-4; D-1; O-13 architecture.
- Depends on: Stories 17.2, 15.5 and 16.2.
- Status: READY after its dependencies.

### Story 18.2: Native KDS outage cache and reconnect

As kitchen staff,
I want received tickets to stay visible during an outage and the KDS to resynchronise on reconnect,
So that an outage never silently hides work.

**Acceptance Criteria:**

**Given** a backend or realtime outage
**When** it occurs and recovers
**Then** received tickets remain visible from the local cache, the outage is shown, reconnection is automatic, and state is refetched and deduplicated.

- Traceability: KIT-2, KIT-6, PR-4.
- Depends on: Story 18.1.
- Status: READY after its dependency.

### Story 18.3: Native KDS ready alert and age colours

As kitchen staff,
I want a visual and audible ready alert and age colouring,
So that late orders stand out.

**Acceptance Criteria:**

**Given** a venue-configured age threshold
**When** a ticket ages past it or an order becomes ready
**Then** colour and alert behave per KIT-5.

- Traceability: KIT-5.
- Depends on: Story 18.1.
- Status: READY after its dependency. The threshold is venue configuration, not an invented target.

### Story 18.4: Native KDS parity proof, venue migration and web KDS retirement

As the owner,
I want the native KDS proven at parity before venues move and the web KDS retires,
So that the transitional surface is removed without loss of function, security or reliability.

**Acceptance Criteria:**

**Given** the native KDS and the transitional web KDS on the same Core contracts
**When** functional, security, reliability and operational parity is proven and venues migrate
**Then** the web KDS build mode retires through a legacy-retirement checkpoint (PR-8, SPRD §34), and no web-KDS-only feature is imported.

- Traceability: D-1 steps 4–6, PR-8, SPRD §34.
- Depends on: Stories 18.1 to 18.3 and Epic 6.
- Status: READY after its dependencies. Venue migration and retirement need separate operational authorization.

## Epic 19: Native Waiter Tablet Staff Mode (post-pilot; primary transitional-retirement target)

Waitstaff use `apps/android/waiter-tablet` in Staff Mode. It replaces the transitional web Order Tablet, the DL-081 Nest tablet identity and the ADR 0002 settlement exception, and reuses the foundation proven by Epic 18 (it may start once Story 17.2 is proven, without waiting for Story 18.4). Whether it is required for the first pilot is O-1 (open; ADR 0002 default is no). Guest Mode (Story 13.2) is a follow-on.

### Story 19.1: Native Staff Mode elevation per O-20

As a waiter,
I want to enter Staff Mode on the native tablet with my own staff authentication, separate from the device identity,
So that staff authority is personal, short-lived and revocable.

**Acceptance Criteria:**

**Given** the O-20 contract (named staff authentication distinct from device identity; the MVP mechanism is the personal staff PIN)
**When** a staff member elevates on an enrolled tablet
**Then** Core verifies the elevation, the elevated authority is short-lived and server-revocable, it ends on leaving Staff Mode, and no reusable staff secret is stored on the device
**And** a configurable account-level PIN lockout exists (moved from the former Story 15.3; it is not added to the transitional Nest tablet, ADMIN-38); lifetimes, PIN length, lockout and second-factor values come from P2 configuration, never invented.

- Traceability: O-20 (volume 00 §00.10.6), WT-2, WT-4, WT-5.
- Depends on: Stories 17.2 and 15.3.
- Status: READY after its dependencies.

### Story 19.2: Native Staff Mode ordering on Core with O-21 provenance

As a waiter,
I want to open visits and submit orders and rounds from the native tablet,
So that the kitchen and billing work from the canonical record with full provenance.

**Acceptance Criteria:**

**Given** an elevated native Staff Mode tablet
**When** orders and rounds are submitted
**Then** Core records them idempotently with O-21 provenance (application `waiter-tablet`, device, Staff Mode, staff actor), the native client never emits `order_tablet`, and Core totals and stable errors are shown.

- Traceability: ORD-1 to ORD-5, WT-1, WT-2, WT-6; O-21 (volume 00 §00.10.6).
- Depends on: Stories 19.1 and 15.2a.
- Status: READY after its dependencies.

### Story 19.3: Native settlement parity and web-tablet settlement retirement

As the owner,
I want native Staff Mode settlement at parity with the web Order Tablet before the web settlement exception retires,
So that the ADR 0002 transitional settlement surface is removed safely.

**Acceptance Criteria:**

**Given** Epic 9 settlement on Core and the native Staff Mode tablet
**When** settlement parity is proven
**Then** web-tablet settlement retires under the ADR 0002 item 8 retirement rule and a legacy-retirement checkpoint (PR-8).

- Traceability: ADR 0002 item 8, PR-8, PAY-1, PAY-7.
- Depends on: Stories 19.2 and Epic 9.
- Status: READY after its dependencies. Retirement needs separate operational authorization.

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

## Readiness Gate Record (bmad-sprint-planning, 2026-10-05, re-anchoring)

**Verdict: CONCERNS.** Tracking was regenerated under the Story 14.2 authorization; the concerns are surfaced for orchestrator review, not resolved here.

**Inputs.** BMAD configuration (`_bmad/custom/*.toml`, 11 files) loads `PRD/product-requirements.md`, `PRD/README.md`, `PRD/00-overview-and-conventions.md`, ADR 0001 and ADR 0002; the domain volumes 01–09 are consulted per requirement ID. `fileRestructure.md`, `docs/planning/` and the derived or control PRD documents are not inputs.

**Implementable as recorded:** Epics 1–6, 8–10, 12 and 14–19. Every story cites SPRD, a normative volume, an accepted ADR or an accepted controlled decision, and carries explicit BLOCKED, NEEDS AUTHORIZATION or DEFERRED markers where a gate applies. Epic 11 and Epic 13 remain BLOCKED or DEFERRED placeholders (O-4, O-5 and O-6 business parts; O-7, O-14 to O-18; P9; the POS report); no developer has to invent anything, and they cannot start.

**Concerns:**
1. **Decision recording.** D-1, D-3, O-10 and the O-13 architecture are orchestrator Tier-2 decisions recorded only in the checkpoint sprint change proposal (§9, §12, §17). SPRD section 14 still lists O-10 and O-13 without a decision tag. Recording them in SPRD (or the decisions log) is a controlled-change follow-up outside Story 14.2. **Resolved 2026-10-05 (governance closure):** O-10 and O-13 are recorded as decided in SPRD §14 with contracts in volume 00 §00.10.7; D-1 and D-3 stay in the proposal, with their consequences referenced in §00.10.7.
2. **Authority ordering.** Volume 00 §00.1.1 places accepted ADRs and decisions-log entries above volumes 00–09, while the Story 14.2 instruction places the volumes above ADRs. BMAD configuration escalates any genuine ADR-versus-volume conflict instead of resolving it; none is known. **Resolved 2026-10-05 (governance closure):** the orchestrator set the rule. Externally: owner decision, then the normative corpus under its own governance, then accepted controlled decision records, then verified repository reality (implementation state only), then BMAD planning, then history. Inside the corpus, volume 00 §00.1.1 governs: an accepted ADR controls a conflicting volume statement unless a later controlled decision explicitly supersedes it, and ambiguous supersession stops and escalates. The contradictory Story 14.2 wording is removed from the BMAD configuration.
3. **No UX design contract** for the client epics (5, 6, 9, 18, 19). They rely on existing screens and the SPRD UX and accessibility requirements; new UX needs its own design input.
4. **Owner and policy values remain absent:** P2 (session, PIN, lockout, credential rotation), P6 (financial-control values), section 19 OTR rows, alert thresholds, retention and defect severity. The affected stories mark them as configuration or BLOCKED.
5. **Epic contexts** exist only for Epics 1 and 12 (recompiled 2026-10-05). Contexts for Epics 15–19 must be compiled and committed before their first story is prepared.
6. **Enabler epics** (1–4, 14–17) deliberately bend the "user value, not technical layers" principle; each is phrased in operator or owner value.
7. **Separately authorised actions** (push, GitHub administration, production database, infrastructure, venue access, retirement checkpoints) remain marked NEEDS AUTHORIZATION.

## Readiness record for item 1.9 (2026-10-05, re-anchoring)

Story 1.9 stays **REWRITE — NOT FROZEN** and is **not authorized**. This record lists the preconditions of the sprint change proposal §15 against the re-anchored state. It freezes nothing.

**Satisfied by Wave A and Story 14.2:**
- **Integrated baseline:** `integration/normative-prd-baseline` (Wave A `5ee6474`, checkpoint `e303ea6`). The objective's `baseline` must be the full id of the Story 14.2 commit (or a later orchestrator-chosen tip on this branch), never `38bea30`.
- **Requirement inputs:** the story's requirements resolve to SPRD §21 (deterministic tests on disposable environments), §24 (tests passing with explicit evidence) and §16 (fail closed), and to Story 1.9 in this plan. The stale draft's claim that the story is "recorded only in its story spec (epics.md is not edited)" no longer holds and must not be reused.
- **Epic context:** `_bmad-output/implementation-artifacts/epic-1-context.md` is recompiled and committed with Story 14.2; a regenerated objective binds its new sha256 through `inputs.epicContext`.
- **BMAD configuration:** `bmad-build-auto` and `bmad-spec` load the normative PRD and cannot use `fileRestructure.md` as authority; the evaluator-contract facts are unchanged.
- **Defect surface still present at the tip (static, read-only):** `apps/api` declares `supertest` `^6.3.4` (lockfile 6.3.4); `apps/api/test/connector-command-harness.integration-spec.ts:171` is `await app.listen(0);`; 25 `apps/api` files import Supertest.

**Remaining before the objective can be regenerated and frozen:**
1. **Story spec:** `spec-1-9-test-harness-loopback-binding.md` exists only as local, unpublished evidence. It must be re-validated against the integrated tip (paths, line 171, dependency delta, unit and integration floors) and placed at `_bmad-output/implementation-artifacts/` by the freeze operation; its intent contract is what `inputs.storySpec` hashes.
2. **Baseline re-measurement on the integrated tip:** unit and integration floors, the only allowed skips, lint and typecheck, the native-round-recovery suite hash, and the Supertest-file inventory, on disposable PostgreSQL 18 and Redis in UTC. The `354ea1b` lockfile removed 158 packages, so the supertest 7.3.1 dependency delta (supertest, superagent, formidable) is recomputed against it.
3. **Required-file generation source:** the endpoint-check REQUIRED list and the objective fields are regenerated mechanically by `gen-fragment-1-9.mjs` and `gen-objective-1-9.mjs` (local evidence, `handoff-artifacts/2026-10-05-story-1-9-PAUSED-not-frozen`), never hand-typed. Both generators must first be revised: they hard-code the `38bea30` baseline guard, a session-specific scratch path, and requirement references that cite the pre-re-anchoring plan. The 2026-10-05 draft objective (sha256 `1e5872…648b`) is stale and is not reused.
4. **Evaluator dependencies:** decide dependency provisioning. The evaluator links one operator-supplied `node_modules`; the proposal is `npm ci --ignore-scripts` from the candidate's approved lockfile in a disposable export plus a supertest runtime-resolution check (`provision.sh`, prepared, never run). Record the Node qualification (`.nvmrc` pins 22; the accepted validation used Node 24 as baseline-identical debt) and the Go and PostgreSQL toolchain paths the `evaluator_tools:` line will name.
5. **Reproduction:** show that the flake, or its mechanism (wildcard bind versus `127.0.0.1` request), is still demonstrable on the integrated tip.
6. **Orchestrator freeze decision:** the orchestrator reviews the regenerated draft, its `validate` output and sha256, and freezes it by committing the draft unchanged with the spec on the draft's baseline (objectives README).

Story 1.10 stays DEFERRED behind Story 1.9.
