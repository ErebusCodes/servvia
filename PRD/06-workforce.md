# Servvia PRD — Volume 06: Workforce

> **Status:** Normative Servvia domain volume under [`product-requirements.md`](product-requirements.md) ("SPRD"), which wins on any conflict. Conventions, invariants (INV-n) and cross-cutting decisions (DEC-X-n) are in [`00-overview-and-conventions.md`](00-overview-and-conventions.md). Version label **v5.1 (Servvia)**. Last updated 2026-10-05.
> **Provenance:** Servvia baseline (SPRD §1, §5, §7 STF-1, §11, §13, §14 O-2 and O-20, §16, §17, Part B rows C and M; ADR 0001; ADR 0002; DL-081) and verified repository state (Nest `staff`, `auth`, `tablet`; Prisma `Staff`, `VenueAccess`; Core D7 shifts and cash, D8 devices) for CURRENT statements; domain mechanisms adapted from the Verdura v5.2 PRD volume 06 and its consolidated joiner-mover-leaver workflow as **non-authoritative source material**; enterprise hardening derived from SPRD Part B.
> **Scope state:** SPRD §13 defers "workforce" and "enterprise SSO/SCIM" beyond the first pilot. The owner decided on 2026-10-05 that workforce capabilities (employee records, scheduling and rostering, attendance and breaks, timesheets, payroll export and payroll calculation through jurisdiction packs or provider adapters, certifications and training, joiner-mover-leaver, performance analytics, AI staffing recommendations) belong to Servvia's long-term target product (DEC-X-1 inclusion resolved; SPRD §13; KitchenOS L209–L215, L305–L308, L320–L323, L566–L567, L596). They are labelled `TARGET CAPABILITY — FUTURE DELIVERY`: not committed current delivery scope; phase and order DEC-X-17. Leave management (`DEFERRED`), tip pooling and performance notes (`FUTURE`) are not KitchenOS-described and keep their prior states; enterprise SSO/SCIM stays `DEFERRED`. Servvia makes no wage-law, tax or employment-law compliance claim for any jurisdiction (DEC-X-5). Committed current scope is limited to staff management (STF-1, owned by 09) and staff attribution in records. Shifts and cash (D7) belong to 07 Finance and 02 Operations and are referenced here only to keep them distinct from rostered work and attendance.
> **Acceptance:** **NORMATIVE BASELINE ACCEPTED 2026-10-05** (SERVVIA PRD NORMATIVE BASELINE ACCEPTED; record in volume 00 §00.1.3). This volume is a normative refinement of [`product-requirements.md`](product-requirements.md), which wins on any conflict. Acceptance does not commit future-delivery capabilities to a release, select open policy values, approve production or release, or certify compliance.

## 06.1 Purpose, scope and state

**Purpose.** Define the employment-side record of the people who work in a venue — who is employed, in which positions and venues, when they are rostered, when they actually worked, which time is approved, what leave they take, which certifications and training they hold — and how approved time becomes payroll: an export to an external payroll provider, or payroll calculation only through a validated jurisdiction payroll pack or a payroll-provider adapter (WFM-29).

**Governing separation.** Three layers are distinct and owned separately:

| Layer | What it is | Owner | State |
|---|---|---|---|
| (a) Operational access identity | The named staff account used to sign in: role, venue grants, password, optional TOTP, tablet-elevation PIN, sessions and tokens | 09 Administration (identity); SPRD STF-1 | TRANSITIONAL (Nest `staff`, `auth`, `tablet`); Core verifies credentials (O-2) |
| (b) Actor attribution | The staff identifier recorded on orders, rounds, checks, payments, shifts, cash movements, devices and audit (INV-5) | Each owning domain | TARGET in Core (implemented, not in production); CURRENT in Nest records |
| (c) Employment record | Employee, employment periods, positions, rosters, attendance, timesheets, leave, certifications, training, payroll export and payroll runs | Workforce (this volume) | TARGET CAPABILITY — FUTURE DELIVERY (owner 2026-10-05; leave DEFERRED) |

A staff account is not an employee, and an employee is not a staff account. An owner, a contractor or a support user can hold an account with no employment record; an employee (for example a dishwasher) can be employed without any account. They are linked only by an explicit, audited link (WFM-1).

**Distinct "shift" concepts.** The Core `Shift` (D7) is a **cash-accountability session** of one staff member at a venue (opening float, cash sales, count, variance). It is not rostered work and not attendance. Workforce uses **RosteredShift** for planned work and **AttendanceEvent** for recorded work; neither is inferred from the other (WFM-4).

| Capability | State | Basis |
|---|---|---|
| Staff accounts: add, remove (deactivate), assign role, reset credentials | TRANSITIONAL (Nest `staff`; Prisma `Staff` with one organization-level role among owner, admin, manager, cashier, kitchen, viewer; soft deletion) | S (STF-1); repository; detail in 09 |
| Venue grants | TRANSITIONAL (Nest `VenueAccess`, enforced by the venue access guard); Core staff venue-scope enforcement is a known gap that must be fixed (O-2) | S (§16.3, O-2) |
| Tablet staff elevation by personal PIN; manager step-up | TRANSITIONAL (DL-081: per-staff PIN, Argon2id, separate from the password, set by admin or manager; web Order Tablet). Native mechanism decided (O-20, 2026-10-05, 00.10.6): named staff authentication distinct from device identity, personal staff PIN for the MVP; implementation incomplete | S (DL-081, O-20, WT-5) |
| KDS per-venue PIN | TRANSITIONAL (Nest `KDS_VENUE_PINS`, one identity per venue); superseded by D8 `Device(kind=kds)`; O-13 | S (O-13); repository |
| Staff attribution on canonical records | TARGET (Core D2–D11, implemented, not in production) | S (§5, INV-5) |
| Cash shifts (open, cash sale, close with count and variance) | TARGET (Core D7, implemented, not in production); owned by 07 and 02 | S (§1, §11) |
| Employee records, positions, venue assignments, certifications | TARGET CAPABILITY — FUTURE DELIVERY | S (§13)+K(L209, L305, L567) |
| Training records (role-specific assignments and completions) | TARGET CAPABILITY — FUTURE DELIVERY | K(L566–L567) |
| Rostering, availability, swaps and open shifts | TARGET CAPABILITY — FUTURE DELIVERY | S (§13)+K(L211, L307, L321, L413) |
| Attendance (clock in/out, breaks) and timesheets | TARGET CAPABILITY — FUTURE DELIVERY; clock surface and method ARCHITECTURE DECISION REQUIRED (DEC-WFM-4) | S (§13)+K(L213, L308) |
| Leave | DEFERRED (SPRD §13; not KitchenOS-described) | S (§13) |
| Payroll export | TARGET CAPABILITY — FUTURE DELIVERY | S (§13)+K(L214, L322) |
| Payroll calculation (gross-to-net, statutory outputs) | TARGET CAPABILITY — FUTURE DELIVERY, only through a validated jurisdiction payroll pack or a payroll-provider adapter; mechanism ARCHITECTURE DECISION REQUIRED (DEC-WFM-19); applicability P5 | K(L214, L322)+S (INV-22) |
| Joiner-mover-leaver linkage to access | TARGET CAPABILITY — FUTURE DELIVERY (manual staff deactivation is CURRENT via STF-1); automation DEC-X-12 | S (§13)+K(L209, L212); DEC-X-12 |
| SSO and SCIM provisioning | DEFERRED | S (§13); DEC-X-12 |
| Configurable labour-rule mechanism (scheduling constraints) | TARGET CAPABILITY — FUTURE DELIVERY; rule content OWNER DECISION REQUIRED | K(L211); DEC-WFM-3, DEC-X-5 |
| Performance analytics and workforce reporting | TARGET CAPABILITY — FUTURE DELIVERY; metrics with volume 08 | K(L215, L323, L421) |
| Performance notes, goals and recognition | FUTURE | V(06 §3.6); DEC-WFM-15 |
| Tip pooling and distribution | FUTURE; OWNER DECISION REQUIRED | DEC-WFM-16 |
| AI staffing predictions and recommendations (WFM-46) | TARGET CAPABILITY — FUTURE DELIVERY; recommendation or assisted action only (INV-21); autonomy DEC-X-19 | V(06 §2)+K(L211, L321, L596) |

**Out of scope of this volume:** authentication, sessions, credential storage, role and permission administration, device enrolment (09); cash and shift accounting (07); service-day staff assignment to sections and stations (02); labour analytics metric definitions (08); gross-to-net payroll calculation, tax or statutory filing other than through a validated jurisdiction payroll pack or payroll-provider adapter (WFM-29, DEC-WFM-19); disbursement of wages (DEC-X-18).

## 06.2 Actors and surfaces

| Actor | Workforce interaction | State |
|---|---|---|
| Owner, admin | Employee records, positions, rule configuration, payroll export and payroll runs, access reviews | TARGET CAPABILITY — FUTURE DELIVERY (staff accounts TRANSITIONAL) |
| Manager | Rosters (including accepting AI staffing recommendations), swap and leave approvals, attendance exceptions, timesheet approval within scope | TARGET CAPABILITY — FUTURE DELIVERY (leave DEFERRED) |
| Staff member as employee (cashier, waiter, kitchen) | Own roster, availability, clock in/out, own timesheet, training, leave requests | TARGET CAPABILITY — FUTURE DELIVERY (leave DEFERRED; self-service surface DEC-WFM-14) |
| Candidate roles (HR, payroll, finance, shift manager) | Role model DEC-X-2; not facts | OWNER DECISION REQUIRED |
| Device | Hosts a clock surface; never clocks anyone without staff authentication (INV-3) | TARGET CAPABILITY — FUTURE DELIVERY (surface DEC-WFM-4) |
| System | Rule evaluation, reminders, timesheet assembly, export transmission, payroll run submission through the decided path | TARGET CAPABILITY — FUTURE DELIVERY |
| Payroll or HR provider | Receives exports; may calculate payroll through a provider adapter (DEC-WFM-19); may supply leave balances; behind adapters (INV-19) | TARGET CAPABILITY — FUTURE DELIVERY (leave balances DEFERRED) |

| Surface | Workforce role | State |
|---|---|---|
| Admin Console | Employee directory, rosters, attendance review, timesheets, training, leave, payroll export and payroll runs, rule configuration | TARGET CAPABILITY — FUTURE DELIVERY (leave DEFERRED) |
| Waiter Tablet (Staff Mode) | Candidate clock surface (DEC-WFM-4) | TARGET CAPABILITY — FUTURE DELIVERY; surface ARCHITECTURE DECISION REQUIRED (DEC-WFM-4) |
| Waiter Tablet (Guest Mode), Kiosk, Window Display, Customer Website | No workforce function; never display employee data | Rule TARGET |
| KDS | Candidate clock surface for kitchen staff only if DEC-WFM-4 selects it; requires staff authentication beyond the device identity | TARGET CAPABILITY — FUTURE DELIVERY; surface ARCHITECTURE DECISION REQUIRED (DEC-WFM-4) |
| Windows POS | Any clock or staff function: DEFERRED — PENDING USER POS ANALYSIS REPORT | DEFERRED |
| Employee self-service (mobile or web) | No such application exists; adding an application is a Part C change (§28, §32) | FUTURE (DEC-WFM-14) |
| Venue Edge | No workforce role except buffering clock events for a venue device if DEC-WFM-6 selects it (EDGE-2 queue semantics) | FUTURE |

## 06.3 Domain model and ownership

```text
Staff account (09) 0..1 ─ 0..1 Employee            (explicit EmployeeAccountLink, audited)
Employee 1 ─ N EmploymentPeriod (type, start, end, end reason)
Employee 1 ─ N PositionAssignment (Position × Venue × effective from/to)
Position 1 ─ N CertificationRequirement ; Employee 1 ─ N Certification (type, number, issuer, expiry, evidence)
Employee 1 ─ N AvailabilityStatement ; Employee 1 ─ N EmployeeDocument (restricted)
Roster (Venue × period, versioned) 1 ─ N RosteredShift (Position, station ref, start, end, planned breaks; assignee or open)
RosteredShift 0..N ─ SwapRequest / OpenShiftClaim
LabourRule (type, parameters, outcome: block | warn, scope, version) ─ N RuleEvaluation (subject, result, override)
Employee 1 ─ N AttendanceEvent (clock-in, clock-out, break-start, break-end; device, method, raw times)
Timesheet (Employee × PayPeriod) 1 ─ N TimesheetLine (derived) 1 ─ N TimesheetAdjustment (linked correction)
Timesheet 0..N ─ ExceptionFlag
LeaveType ; Employee 1 ─ N LeaveRequest ──> RosteredShift conflicts ; TimesheetLine
PayPeriodCalendar 1 ─ N PayrollExportBatch 1 ─ N PayrollExport (full | delta, immutable snapshot)
PayPeriodCalendar 1 ─ N PayrollRun (full | delta; pack or adapter path; immutable when finalised) ── corrects ──> PayrollRun
TrainingItem (versioned) ─ N TrainingRequirement (Position) ; Employee 1 ─ N TrainingAssignment 1 ─ 0..1 TrainingCompletion
EmploymentLifecycleEvent (joiner | mover | leaver) ─ N AccessReviewTask (09)
Core Shift (D7, cash) ── Staff account   [separate; referenced, never inferred]
```

| Entity | Canonical owner (target) | Current state |
|---|---|---|
| Staff account, role, venue grant, PIN, sessions | Core `internal/identity/` and `internal/staff/` (Part C §30.3; `internal/staff/` not created). Today Nest `staff`, `auth`, `tablet` | TRANSITIONAL |
| Employee, EmploymentPeriod, PositionAssignment, Position, Certification, EmployeeDocument | Core: `internal/staff/` or a separate workforce package (DEC-WFM-1, DEC-X-13) | Not created |
| Roster, RosteredShift, SwapRequest, AvailabilityStatement | Core workforce package (DEC-WFM-1) | Not created |
| AttendanceEvent, Timesheet, TimesheetAdjustment, ExceptionFlag | Core workforce package | Not created |
| LeaveType, LeaveRequest | Core workforce package; balances may be provider-sourced | Not created |
| LabourRule, RuleEvaluation | Core workforce package; uses shared configuration (INV-17) | Not created |
| PayrollExportBatch, PayrollExport | Core workforce package; provider adapter (INV-19) | Not created |
| PayrollRun | Core workforce package; calculation through a jurisdiction payroll pack (INV-22) or a provider adapter (INV-19), DEC-WFM-19 | Not created |
| TrainingItem, TrainingRequirement, TrainingAssignment, TrainingCompletion | Core workforce package | Not created |
| AccessReviewTask | 09 (identity), raised by workforce events; tasks shown in 01 | Not created |
| Shift, CashMovement (D7) | Core `internal/shifts/`, `internal/cash-management/`; 07 | TARGET (implemented, not in production) |
| Document storage | Media and attachments capability (00.7; O-8) | Not created for this use |

## 06.4 Business objects and lifecycles

### 06.4.1 Employee and employment

- **Employee:** organization-scoped (INV-2); legal and preferred name; work contact; employee number from a gap-controlled series (INV-9); status derived from employment periods (`active`, `on-leave`, `ended`); optional link to one staff account.
- **EmploymentPeriod:** employment type label (configurable list; no legal categories are defined by Servvia), start, end, end reason. Rehire creates a new period; history is retained.
- **PositionAssignment:** position × venue × effective from/to. A change is a new assignment closing the previous one; nothing is overwritten.
- **Fields collected beyond these** (date of birth or age band, right-to-work or visa information, emergency contact, documents): DEC-WFM-2. Nothing is collected without that decision (Part B row C).
- **Lifecycle:** `draft → active → ended`; `ended → active` only through a new EmploymentPeriod. An employee is never deleted while referenced; personal data erasure follows DEC-X-4 (WFM-5).

### 06.4.2 Certification

Type (configurable), identifier, issuer, issue and expiry dates, evidence document reference, verification state (`unverified`, `verified` by actor and time). Expiry generates reminders at configured offsets (Verdura offsets 30, 14 and 3 days are proposed only, DEC-WFM-3). When a position requires a certification and the rule is configured as blocking, an employee without a current certification is ineligible for that position from the expiry instant.

### 06.4.3 Roster and RosteredShift

- **Roster:** venue × period; state `draft → published → locked`; each publish creates a version with a diff from the previous version. `locked` follows the pay period close for that period and admits no further change except through timesheet adjustments.
- **RosteredShift:** position, optional station reference (KIT-1 station configuration), planned start and end (UTC, displayed in venue time, INV-8), planned breaks, assignee or `open`, rule-evaluation result, notes. States `planned → published → (swapped | cancelled) → completed`.
- **Invariants:** an employee cannot hold overlapping rostered shifts; publish is atomic for the whole roster version; edits are serialised by version compare-and-set (INV-10).

### 06.4.4 LabourRule and RuleEvaluation

- **LabourRule:** a typed rule with parameters, scope (organization, venue, position), outcome `block` or `warn`, version and effective dates. Candidate types (mechanism only): minimum gap between rostered shifts, maximum hours per day or per period, required certification per position, break entitlement by shift length, time-window restrictions for an employee attribute, maximum hours for an employee attribute. **No parameter value, and no decision that a rule applies, is supplied by Servvia** (DEC-WFM-3, DEC-X-5).
- **RuleEvaluation:** rule version, subject (roster version, swap, timesheet), result, evidence, and for a `warn` the acknowledging actor and reason; for an override of a `block` (only if configuration permits overrides) the overriding actor, reason and approval. Every evaluation is stored.

### 06.4.5 AttendanceEvent

Type `clock-in | clock-out | break-start | break-end`; employee; venue; source device identity (D8) and surface; authentication method; device-captured time and server-received time; offline flag; idempotency key; optional rostered-shift match; optional location or photo evidence only if DEC-WFM-5 enables it. Append-only: events are never edited or deleted; corrections are TimesheetAdjustments (INV-11).

### 06.4.6 Timesheet

- **Timesheet:** employee × pay period; state `open → submitted → approved → exported → locked`; `approved → open` only by an explicit reopen that records actor and reason and is refused once `exported` (after export, corrections go to a delta export).
- **TimesheetLine:** derived from attendance events and rostered shifts: worked intervals, breaks, raw and rounded times (rounding rule version shown), leave portions, classification tags (configurable labels the payroll provider prices; Servvia attaches no monetary meaning).
- **TimesheetAdjustment:** linked correction of a line (add, remove or change an interval) with actor, reason, time, and approval state; visible to the employee.
- **ExceptionFlag:** `missed-punch`, `unrostered-work`, `long-break`, `early-or-late` (threshold), `missing-break` (rule), each requiring a resolution (`accept`, `adjust`, `reject`) with reason before approval.

### 06.4.7 LeaveRequest

Leave type (configurable taxonomy aligned to the payroll provider), dates and portions, state `requested → approved | declined | withdrawn → taken`, roster conflicts at decision time, balance display with its source (`provider` with as-of time, or `none`). Servvia does not calculate entitlements or accruals.

### 06.4.8 PayrollExportBatch and PayrollExport

- **Batch:** pay period × venue set; completeness check (every employee with an active period is accounted for by an approved timesheet, approved leave, or an explicit zero confirmation); state `open → ready → exported → closed`.
- **PayrollExport:** `full` or `delta` (linked to the export it corrects); immutable content snapshot with checksum; mapping version; transmission state `generated → delivered → acknowledged | failed`; provider acknowledgement reference in adapter metadata.

### 06.4.9 EmploymentLifecycleEvent

`joiner`, `mover` (position or venue change) or `leaver`, with effective time and actor. Each raises AccessReviewTasks in 09 for the linked staff account (06.6.8). The event never edits the staff account directly unless DEC-X-12 automation is approved.

### 06.4.10 PayrollRun (TARGET CAPABILITY — FUTURE DELIVERY; mechanism DEC-WFM-19)

- **PayrollRun:** pay period × venue set × employee set; inputs reference locked, approved timesheets and the employees' pay-related tier (DEC-WFM-9); calculation path `pack` (jurisdiction payroll pack identifier and validated version, INV-22) or `adapter` (provider and adapter version; provider references in adapter metadata, INV-19); type `full` or `delta` (linked to the run it corrects).
- **Lifecycle:** `draft → calculated → approved → finalised`; `draft` or `calculated → discarded`. Approval is by a different user than the preparer (separation of duties; thresholds DEC-X-7). A `finalised` run is immutable; any correction is a new `delta` run (INV-11). A provider outcome that is uncertain stays `unknown` until reconciled and is never re-submitted blindly (INV-14).
- **Guard:** a run cannot be created for an employee whose jurisdiction has neither an active validated payroll pack nor an active provider adapter accepted under DEC-WFM-19 (WFM-29). Disbursement of wages is outside this object (DEC-X-18).

### 06.4.11 Training records (TARGET CAPABILITY — FUTURE DELIVERY)

TrainingItem (name, version, optional content reference; content hosting and channels are product choices); TrainingRequirement (position × item, due offset); TrainingAssignment (employee × item version, due date, source `position` or `individual`); TrainingCompletion (time, method, evidence, verifier where configured; append-only). A training item may be configured to satisfy a certification requirement (06.4.2).

## 06.5 Requirements

| ID | Requirement | Priority | State | Basis |
|---|---|---|---|---|
| WFM-1 | Operational access identity (09), actor attribution and employment records are separate. An Employee links to at most one staff account and a staff account to at most one Employee, only through an explicit link that records actor and time. Creating, changing or ending one never silently creates, changes or deactivates the other (06.6.8 is the only coupling). | MUST | TARGET | S (STF-1, INV-3)+V(06 §3.1)+E |
| WFM-2 | Staff management (STF-1: add and remove staff, assign roles, reset credentials) remains owned by 09 and is the only way to grant or remove system access. Workforce consumes it and never stores credentials, PINs or role assignments. | MUST | TRANSITIONAL (Nest `staff`); TARGET Core | S (STF-1, O-2) |
| WFM-3 | Deactivating a staff account or ending employment never removes or rewrites the staff identifier recorded on historical orders, checks, payments, shifts, cash movements, devices or audit records; accounts referenced by records are deactivated, not deleted (INV-5, INV-11). | MUST | TARGET (Nest uses soft deletion today) | S (§5, PR-9) |
| WFM-4 | A Core cash Shift (D7) is not attendance or rostered work. No workforce calculation reads cash-shift open or close as worked time, and no cash-shift operation requires or creates attendance, unless DEC-WFM-18 decides a link. | MUST | TARGET | S (D7)+E |
| WFM-5 | Erasure of an employee's personal data (after the DEC-X-4 period) anonymises personal fields and documents while keeping identifiers, attribution, approved timesheet totals and export snapshots consistent. | MUST | OWNER DECISION REQUIRED | S (Part B row C, INV-11)+D (DEC-X-4) |
| WFM-6 | Employee records are organization-scoped, numbered from a gap-controlled series, hold employment periods with history, and are never deleted while referenced. Fields beyond 06.4.1 require DEC-WFM-2. | MUST | TARGET CAPABILITY — FUTURE DELIVERY | V(06 §3.1)+S (INV-2, INV-9)+K(L209, L305) |
| WFM-7 | Position assignments carry venue and effective dates; a change closes the previous assignment and opens a new one. Venue assignment for rostering is distinct from the venue grant that permits system access. | MUST | TARGET CAPABILITY — FUTURE DELIVERY | V(06 §2, §3.1)+E+K(L209, L212) |
| WFM-8 | Employee data is accessed in tiers: directory (name, position, venue), roster-relevant (availability, eligibility outcome), personal (contact, documents, date of birth if collected), pay-related (provider references, rates if stored). A roster permission never reveals personal or pay-related tiers. Every read of personal or pay-related tiers outside the employee's own record is audited. | MUST | TARGET CAPABILITY — FUTURE DELIVERY | V(06 §6)+S (Part B row C)+E+K(L209, L548) |
| WFM-9 | Employee documents are stored as restricted attachments (00.7 attachments, O-8), validated and access-controlled, never in logs, with retention per DEC-X-4. Which documents are held is DEC-WFM-2. | MUST | TARGET CAPABILITY — FUTURE DELIVERY; policy DEC-WFM-2 | V(06 §3.1)+S (MENU-3 validation pattern)+D+K(L209) |
| WFM-10 | Certifications carry type, expiry and evidence; expiry reminders run at configured offsets; a blocking certification rule makes the employee ineligible for the position from the expiry instant until a current certification is recorded and verified. | SHOULD | TARGET CAPABILITY — FUTURE DELIVERY; policy DEC-WFM-3 | V(06 §3.1, WF-W6)+D (DEC-WFM-3)+K(L567) |
| WFM-11 | Rosters follow `draft → published → locked`; publish creates a versioned snapshot with a diff and notifies affected employees of their changes; locked rosters change only through timesheet adjustments. | MUST | TARGET CAPABILITY — FUTURE DELIVERY | V(06 §3.2, WF-W1)+K(L211, L307, L321) |
| WFM-12 | Roster edits are serialised by version compare-and-set; publish of a roster version is atomic; overlapping rostered shifts for one employee are rejected by the database. | MUST | TARGET CAPABILITY — FUTURE DELIVERY | S (INV-10, Part B row I)+K(L211, L307) |
| WFM-13 | Labour rules are configurable, typed, parameterised and versioned (06.4.4). They are evaluated at roster publish, at swap or claim approval and at timesheet approval; every evaluation is stored. `block` outcomes prevent the action; `warn` outcomes require an acknowledged reason. | MUST | TARGET CAPABILITY — FUTURE DELIVERY; policy DEC-WFM-3 | V(06 §3.7)+E+K(L211) |
| WFM-14 | Servvia ships no jurisdiction-specific labour rule values, rates, rest periods, age limits or visa limits. Any rule template is inactive until an authorised organization user confirms its parameters, and the confirmation is audited. | MUST | TARGET CAPABILITY — FUTURE DELIVERY; policy DEC-WFM-3, P5 | E (INV-20)+V(06 §3.7)+D (DEC-X-5)+K(L211) |
| WFM-15 | Employee availability statements are considered at roster time with the outcome (`block` or `warn`) set by configuration. | SHOULD | TARGET CAPABILITY — FUTURE DELIVERY | V(06 §3.1, §5.3)+K(L211) |
| WFM-16 | Swaps and open-shift claims are offered only to employees eligible under position, certification and rule evaluation; acceptance re-evaluates rules for the claimant; approval follows DEC-WFM-13; the result is audited and both parties are notified. | SHOULD | TARGET CAPABILITY — FUTURE DELIVERY; policy DEC-WFM-13 | V(06 WF-W2)+K(L211, L413) |
| WFM-17 | Labour-cost previews appear only if DEC-WFM-9 approves rate storage; they are labelled indicative and visible only with the pay-related tier. | MAY | TARGET CAPABILITY — FUTURE DELIVERY; policy DEC-WFM-9 | V(06 §2)+D+K(L215, L219) |
| WFM-18 | Attendance events are append-only, idempotent on a client-supplied key, and record device-captured and server-received times, source device identity, surface and authentication method. | MUST | TARGET CAPABILITY — FUTURE DELIVERY | V(06 §3.3)+S (INV-12, INV-5)+K(L213, L308) |
| WFM-19 | A clock action is attributed to a named employee only after staff authentication through trusted controls (INV-3, WT-5 pattern). A device credential alone never records attendance for a person. The method (for example reuse of the DL-081 elevation PIN, a separate clock PIN, or a badge) is DEC-WFM-4. | MUST | TARGET CAPABILITY — FUTURE DELIVERY; policy DEC-WFM-4 | S (INV-3, DL-081)+D+K(L213, L308) |
| WFM-20 | Clocking is hosted on an existing permanent surface selected by DEC-WFM-4; a new application requires a Part C change (§28, §32). Windows POS clocking is DEFERRED — PENDING USER POS ANALYSIS REPORT. | MUST | ARCHITECTURE DECISION REQUIRED | S (§28, §31, §32)+D |
| WFM-21 | Offline clocking is permitted only on a surface with a durable local queue meeting EDGE-2/EDGE-3 semantics (no loss, no duplication, ordered replay, explicit unknown state). Offline-captured events are flagged and keep both times; whether offline clocking is enabled is DEC-WFM-6. | MUST | ARCHITECTURE DECISION REQUIRED | S (EDGE-2, EDGE-3, NFR-OFF)+V(06 WF-W3) |
| WFM-22 | Time rounding, if configured, is applied only to derived timesheet lines; raw event times are retained and shown beside rounded values with the rule version. | MUST | TARGET CAPABILITY — FUTURE DELIVERY; policy DEC-WFM-7 | V(06 §3.3)+D (DEC-WFM-7)+K(L213) |
| WFM-23 | Exception flags (06.4.6) are raised from attendance and rules with configurable thresholds and must each be resolved with a reason before the timesheet can be approved. | MUST | TARGET CAPABILITY — FUTURE DELIVERY; policy DEC-WFM-7 | V(06 §3.3, WF-W3)+D (DEC-WFM-7)+K(L213) |
| WFM-24 | Location capture, geofencing, photographs and biometrics are not collected unless DEC-WFM-5 approves them. If approved, they are purpose-limited to attendance verification, disclosed to employees before use, retained per DEC-X-4, and never used for other purposes. Biometric templates are never stored by Servvia unless that decision explicitly says so. | MUST | OWNER DECISION REQUIRED | V(06 §3.3, §9)+S (Part B row C)+D |
| WFM-25 | Timesheets follow 06.4.6. Corrections are TimesheetAdjustments linked to the line they correct, with actor, reason and time, visible to the employee; attendance events are never edited. | MUST | TARGET CAPABILITY — FUTURE DELIVERY | V(06 §3.3)+S (PR-9, INV-11)+K(L213) |
| WFM-26 | A timesheet cannot be approved by the employee it belongs to, nor by anyone whose own adjustments on it await approval. Approval requires the approval permission at the timesheet's venue; additional thresholds follow DEC-WFM-11 and DEC-X-7. | MUST | TARGET CAPABILITY — FUTURE DELIVERY; policy DEC-WFM-11 | V(06 §6)+S (INV-4)+D+K(L213) |
| WFM-27 | Employees can view their own timesheet before approval and attach a dispute comment; a disputed line cannot be approved without a recorded resolution. | SHOULD | TARGET CAPABILITY — FUTURE DELIVERY | V(06 WF-W3)+K(L213) |
| WFM-28 | Leave requests follow 06.4.7; approval shows roster conflicts; approved leave blocks rostering for the period and contributes timesheet lines. Servvia does not calculate leave entitlements; balances are shown only with their source and as-of time. | SHOULD | DEFERRED (SPRD §13; not KitchenOS-described) | V(06 §3.5, WF-W5) |
| WFM-29 | Payroll calculation (gross-to-net, tax and deduction calculation, statutory payroll outputs) is an owner-approved capability that Servvia delivers only through (a) a jurisdiction payroll pack that is implemented and validated for that jurisdiction (INV-22; activation requires validation evidence, P5) or (b) a payroll-provider adapter (INV-19) whose provider certification or validation evidence is accepted under DEC-WFM-19 and P5. Servvia never performs statutory payroll calculation or filing for a jurisdiction whose pack is not implemented and validated, ships no jurisdiction's wage, tax or employment rules by specification, and claims no compliance with any jurisdiction's law (DEC-X-5). Where neither path is active for an employee's jurisdiction, Servvia's payroll responsibility ends at the validated export of approved time and leave (WFM-30 to WFM-33). Results are immutable payroll runs (06.4.10) recording the pack or adapter version, inputs and outputs; corrections are delta runs linked to the run they correct, never edits (INV-11). Disbursement of wages is not part of this capability (DEC-X-18). | MUST | TARGET CAPABILITY — FUTURE DELIVERY; mechanism DEC-WFM-19; policy P5 (DEC-X-5), DEC-WFM-8, DEC-WFM-9 | V(06 §1)+E+K(L214, L322)+S (INV-19, INV-22)+D |
| WFM-30 | A payroll export batch runs a completeness check and cannot produce an export containing unapproved timesheets; missing employees block the batch unless explicitly zero-confirmed by an authorised user. | MUST | TARGET CAPABILITY — FUTURE DELIVERY | V(06 §3.4, WF-W4)+K(L214, L322) |
| WFM-31 | Exports are immutable snapshots with checksum and mapping version; transmission is idempotent per export; failures are visible and retryable; acknowledgements are recorded. Exporting locks the included timesheets. | MUST | TARGET CAPABILITY — FUTURE DELIVERY | V(06 §3.4)+S (INV-12, INV-14)+K(L214, L322) |
| WFM-32 | Corrections after export are delivered as a delta export linked to the original; an export is never regenerated in place. | MUST | TARGET CAPABILITY — FUTURE DELIVERY | V(06 §3.4)+S (PR-9)+K(L214, L322) |
| WFM-33 | Export mappings (fields, format, transport) are versioned configuration per provider; providers sit behind adapters (INV-19); provider choice is DEC-WFM-8. | MUST | TARGET CAPABILITY — FUTURE DELIVERY; policy DEC-WFM-8 | V(06 §5.9)+S (INV-19)+K(L214, L322) |
| WFM-34 | Joiner: creating an employee may propose a staff account, role and venue grants derived from the position; the proposal takes effect only by an authorised 09 action, unless DEC-X-12 automation is approved. | SHOULD | TARGET CAPABILITY — FUTURE DELIVERY; policy DEC-WFM-12 | V(CONSOLIDATED WF-5)+D+K(L209, L212) |
| WFM-35 | Mover: a position or venue change raises an access-review task for the linked account; grants are never expanded automatically; automatic removal of grants for venues no longer assigned is DEC-WFM-12. | MUST | TARGET CAPABILITY — FUTURE DELIVERY; policy DEC-WFM-12 | V(CONSOLIDATED WF-5)+S (§16.1)+D+K(L209, L212) |
| WFM-36 | Leaver: ending employment raises an immediate deprovisioning task for the linked account (deactivate, revoke sessions and refresh tokens including live realtime connections, end tablet elevations, clear the tablet-elevation PIN, remove venue grants) executed through 09. Deprovisioning is never delayed by an open cash shift; the open shift is flagged to a manager for close under D7 rules. Maximum time from employment end to access removal: OWNER TARGET REQUIRED (DEC-WFM-17). | MUST | TARGET CAPABILITY — FUTURE DELIVERY; policy DEC-WFM-12, DEC-WFM-17 | V(CONSOLIDATED WF-5)+S (§16.5, D7)+D+K(L209, L212) |
| WFM-37 | A periodic access review lists linked accounts whose employment has ended, unlinked active accounts, and grants for venues outside current assignments. | SHOULD | TARGET CAPABILITY — FUTURE DELIVERY | E+V(CONSOLIDATED WF-5)+K(L209, L212) |
| WFM-38 | Federated sign-in and SCIM provisioning are DEFERRED (DEC-X-12); until then JML is task-driven and audited (WFM-34 to WFM-36). | MUST | DEFERRED | S (§13) |
| WFM-39 | Every change to employee records, positions, certifications, rule configuration, rule overrides, rosters (publish), adjustments, approvals, exports and links is audited with before and after values (personal values masked per DEC-X-4) (INV-15). | MUST | TARGET CAPABILITY — FUTURE DELIVERY | S (NFR-AUD, INV-15)+K(L209, L551) |
| WFM-40 | An employee reading or acting on their own records does so as their staff account (human staff identity class); an employee without a staff account has no self-service. The self-service surface is DEC-WFM-14. | MUST | FUTURE | S (INV-3)+D |
| WFM-41 | Operations (02) may read the published roster to show who is rostered today; this is information only and never grants system access or venue grants. | MAY | FUTURE | V(06 §1)+S (INV-4) |
| WFM-42 | Employee personal data never appears in logs, telemetry, error responses or domain-event payloads; events carry identifiers only (§20.9). | MUST | TARGET | S (§20.9, Part B row C) |
| WFM-43 | Performance notes, goals and recognition are not provided unless DEC-WFM-15 commits them; if committed, manager-only notes are a restricted tier. | MAY | TARGET CAPABILITY — FUTURE DELIVERY (performance analytics and reporting); notes, goals and recognition remain FUTURE (DEC-WFM-15) | V(06 §3.6)+D+K(L215, L323, L421) |
| WFM-44 | Tip pooling or distribution calculations are not provided unless DEC-WFM-16 commits them. | MUST | FUTURE | V(06 §9)+D |
| WFM-45 | Organizations can configure training items (versioned; optional content reference or attachment) and assign them as required training per position (with a due offset from position assignment) or to individual employees. Completions (employee, item version, time, method, evidence, verifier where verification is configured) are append-only and corrected only by linked records (INV-11). A training item may be configured to satisfy a position's certification requirement (06.4.2): a verified completion then records or renews that certification with its expiry. Overdue required training raises reminders at configured offsets and, only where configured as blocking (as for certifications, WFM-10), makes the employee ineligible for the position. Training records are Personal (employee) data under WFM-8 tiers and are audited (WFM-39). Which training each position requires is organization configuration; Servvia makes no claim that training content or records satisfy any statutory training obligation (DEC-X-5). | SHOULD | TARGET CAPABILITY — FUTURE DELIVERY | K(L566–L567)+S (INV-11)+E |
| WFM-46 | Servvia may provide AI staffing predictions (expected labour demand per venue, position and time window, derived from volume 08 demand forecasts) and recommendations (proposed rostered shifts or staffing levels for a draft roster). They are labelled as AI output with evidence, time basis and confidence or known limitations (INV-21) and are visible only to users with roster edit permission. A recommendation enters a draft roster only when a manager accepts it (assisted action); accepted shifts are ordinary draft changes subject to WFM-12 and to full labour-rule evaluation at publish (WFM-13), and record the accepting manager and the AI source (INV-5). AI never publishes a roster, assigns or removes an employee, approves a swap, timesheet or leave, or changes pay or permissions; any autonomous staffing action requires a DEC-X-19 control model. Inputs exclude personal and pay-related tiers other than eligibility and availability outcomes, and data sent to any AI provider is minimised (INV-18). If the AI service is unavailable or its forecast is stale, rostering continues without recommendations and the staleness is shown. | SHOULD | TARGET CAPABILITY — FUTURE DELIVERY; autonomy DEC-X-19 | K(L211, L321, L596)+S (INV-21)+D |

## 06.6 Workflows and failure paths

### 06.6.1 Staff access today (TRANSITIONAL; reference to 09)

1. An owner, admin or manager adds a staff account with a role and venue grants in the Admin Console (Nest `staff`); credentials are issued by Nest (O-2) and verified by Core at transactional boundaries.
2. A tablet-elevation PIN is set by an authorised admin or manager (DL-081); it is separate from the password and stored as an Argon2id hash.
3. Removal deactivates the account (soft deletion) and must revoke sessions immediately, including live realtime connections (§16.5). Attribution on historical records is kept (WFM-3).
4. **Known gap:** Core enforcement of staff venue scope is missing and must be fixed (O-2, §16.3). Workforce adds no requirement that depends on it being absent.

### 06.6.2 Employee onboarding (TARGET CAPABILITY — FUTURE DELIVERY)

1. An authorised user creates an Employee with an EmploymentPeriod and PositionAssignments; employee number allocated from the series.
2. Required certifications per position are listed as missing; rostering into a blocking position is refused until recorded.
3. A joiner event raises an optional account proposal (WFM-34). Linking to an existing account requires confirmation that it is the same person.
4. **Duplicate:** a retried create with the same idempotency key returns the original employee (INV-12).

### 06.6.3 Roster build and publish (TARGET CAPABILITY — FUTURE DELIVERY)

1. A manager creates or copies a draft roster for a venue and period and adds rostered shifts.
2. Rules evaluate continuously in draft (advisory) and authoritatively at publish.
3. Publish: under the roster version lock, evaluate all rules; any `block` refuses publish with the list of violations; `warn` results require acknowledgement. On success, commit the version, evaluations, audit and event in one transaction (INV-13), then notify affected employees.
4. **Concurrency:** a concurrent edit fails the version check; the publisher reloads.
5. **Notification failure:** publish stands; failed notifications are visible and retryable (INV-14).
6. **Post-publish change:** creates a new version, re-evaluates, re-notifies only affected employees with the diff.

### 06.6.4 Swap and open-shift claim (TARGET CAPABILITY — FUTURE DELIVERY)

1. An employee offers a shift; eligible employees (position, certification, rules) see it; ineligible employees do not.
2. A claim re-evaluates rules for the claimant at claim time; approval per DEC-WFM-13.
3. **Race:** two claims on one shift — the first committed wins under the shift row lock; the second receives a refusal.

### 06.6.5 Clock in, breaks and clock out (TARGET CAPABILITY — FUTURE DELIVERY; surface and method ARCHITECTURE DECISION REQUIRED)

1. On the clock surface, the employee authenticates as themselves (WFM-19).
2. The surface submits the event with an idempotency key; Core stores it, matches it to a rostered shift if any, and raises exceptions (early, late, unrostered).
3. **Duplicate tap or retry:** same key returns the original event.
4. **Offline (only if enabled, DEC-WFM-6):** the event is queued durably with device time; on reconnect it replays in order; the server records receipt time and the offline flag; an event whose authentication cannot be validated after the fact is held as an exception, never auto-accepted.
5. **Clock-out missing at period end:** a `missed-punch` exception blocks approval until resolved.
6. **Device revoked mid-shift:** further events from that device are refused (§16.6); the employee clocks out on another surface; the gap becomes an exception.

### 06.6.6 Timesheet review and approval (TARGET CAPABILITY — FUTURE DELIVERY)

1. At period end, timesheets assemble lines from events, rostered shifts and approved leave.
2. Each exception is resolved (`accept`, `adjust`, `reject`) with a reason; adjustments are linked records.
3. The employee may review and dispute (WFM-27).
4. An authorised approver other than the employee approves (WFM-26); rule evaluation at approval is stored.
5. **Concurrency:** an adjustment committed after the approver loaded the timesheet invalidates the approval attempt (version check).

### 06.6.7 Payroll export (TARGET CAPABILITY — FUTURE DELIVERY)

1. A batch opens for the period and venue set; completeness check lists blockers.
2. When ready, an export snapshot is generated with checksum and mapping version; included timesheets lock.
3. Transmission through the provider adapter is idempotent per export; state moves to `delivered`, then `acknowledged` if the provider confirms.
4. **Failure — provider unavailable or rejects:** state `failed` with the provider's reason, visible and retryable; no regeneration of content (WFM-31).
5. **Post-export correction:** an adjustment on a locked timesheet produces a delta export linked to the original (WFM-32).

### 06.6.8 Joiner, mover, leaver (TARGET CAPABILITY — FUTURE DELIVERY; manual STF-1 deactivation CURRENT)

1. A lifecycle event commits with the employment change and emits a domain event.
2. The identity consumer (09) creates AccessReviewTasks: proposal for joiner; review for mover; deprovision for leaver.
3. Leaver deprovisioning executes the full revocation set (WFM-36) on confirmation by an authorised 09 user, or automatically if DEC-X-12 approves automation. Task age is monitored against DEC-WFM-17.
4. **Failure — consumer down:** the event is redelivered (INV-13); the task's absence after the threshold alerts (06.9).
5. **Ended employee with an open cash shift:** the account is still deprovisioned; the shift is flagged to a manager, who closes it under D7 (close by manager for any shift at the venue).

### 06.6.9 Leave (DEFERRED)

Request → approver sees roster conflicts → decision recorded with reason → approved leave blocks rostering and contributes timesheet lines → notification. A provider-sourced balance shows its as-of time; a provider outage shows the balance as unavailable, not zero.

### 06.6.10 Payroll run (TARGET CAPABILITY — FUTURE DELIVERY; mechanism DEC-WFM-19)

1. An authorised user opens a run for a pay period and venue set over locked, approved timesheets.
2. Core checks, per employee, that an active validated jurisdiction payroll pack or an accepted provider adapter covers the employee's jurisdiction; employees without one are excluded with the reason and remain covered by the payroll export (WFM-29); if none is covered, the run is refused.
3. Calculation runs through the pack or the adapter; the run becomes `calculated` with inputs, outputs and versions recorded.
4. A different authorised user approves; the run is `finalised` and immutable.
5. **Failure — adapter timeout or uncertain provider result:** state `unknown`, reconciled with the provider before any resubmission (INV-14); no duplicate run is created.
6. **Correction:** a later timesheet adjustment produces a `delta` run linked to the finalised run; the original is unchanged.

## 06.7 Security, authorization and audit

- **Authorization** follows INV-4. Permissions below are mechanisms; mapping to Servvia roles or candidate roles is DEC-X-2. Fixed constraints: devices never hold workforce permissions (they host authenticated staff actions only); Guest Mode, kiosk and public surfaces have none; personal and pay-related tiers are separate from roster permissions (WFM-8).

| Permission (mechanism) | Covers | Constraint |
|---|---|---|
| Employee directory view | Name, position, venue | Venue scope |
| Employee personal view / edit | Personal tier, documents | Audited reads (WFM-8) |
| Pay-related view | Provider references, rates if stored | Restricted; audited |
| Roster edit / publish | 06.6.3 | Venue scope |
| Swap and leave approval | 06.6.4, 06.6.9 | Venue scope; not own requests |
| Attendance exception resolution; timesheet approval | 06.6.6 | Not own timesheet (WFM-26) |
| Payroll export prepare / transmit | 06.6.7 | Separable (SHOULD) |
| Rule configuration and template confirmation | 06.4.4 | Audited; step-up confirmation |
| Employee–account link | WFM-1 | Audited |
| Own records | Own roster, attendance, timesheet, leave | Staff account required (WFM-40) |

- **Separation of duties:** no self-approval of timesheets, leave or swaps; export preparation and transmission separable; rule overrides require approval by a different person where configured (DEC-X-7).
- **Authentication for clocking** is staff authentication (WFM-19), subject to the §16.4 rate limits and lockouts that 09 defines for PIN entry.
- **Audit:** WFM-39; plus access to restricted tiers; plus every deprovisioning action and its timing.

## 06.8 Data governance

| Data | Class (INV-18) | Access | Retention |
|---|---|---|---|
| Employee identity and work contact | Personal (employee) | Directory or personal tier | DEC-X-4 |
| Date of birth or age band, right-to-work, emergency contact (if collected, DEC-WFM-2) | Personal (employee), restricted | Personal tier | DEC-X-4, DEC-X-5 |
| Employee documents | Personal (employee), restricted | Personal tier | DEC-X-4 |
| Certifications | Personal (employee) | Directory (status) and personal tier (evidence) | DEC-X-4 |
| Attendance events and timesheets | Personal (employee) + Internal | Manager scope; own records | DEC-X-4 and DEC-X-5 (employment record-keeping) |
| Location, photo or biometric evidence (only if DEC-WFM-5) | Personal (employee), restricted | Attendance exception resolution only | Shortest decided period (DEC-X-4) |
| Pay references and rates (only if DEC-WFM-9) | Financial + Personal | Pay-related tier | DEC-X-4, DEC-X-5 |
| Payroll export snapshots | Financial + Personal | Export permission | DEC-X-5 |
| Rule configuration and evaluations | Internal | Configuration permission | DEC-X-4 |

- **Ownership:** the organization owns its employee data; Servvia processes it on its behalf (DEC-X-5).
- **Minimisation:** only fields used by a committed capability are collected (Part B row C).
- **Corrections:** employee attributes by new versions with history; time by adjustments; exports by delta (INV-11).
- **Ended employees:** records retained for the decided period and then anonymised (WFM-5); attribution identifiers remain.
- **Analytics:** 08 receives aggregates or pseudonymised identifiers.

## 06.9 Reliability, scalability and observability

- **Hot-path isolation:** workforce processing never blocks ordering, kitchen, payment or settlement. A clock action is a small, idempotent write; its latency target is OWNER TARGET REQUIRED (DEC-WFM-17).
- **Capacity dimensions** (DEC-X-8): employees per organization, rostered shifts per venue per period, attendance events at shift change peaks, export batch size.
- **Signals:** attendance write errors; offline-queue depth and oldest age on clock surfaces (if enabled); unresolved exceptions by age; timesheets not approved at period close; export failures and unacknowledged exports by age; rule-evaluation failures; leaver deprovisioning tasks open and oldest age; certification expiries in the next window. Alert thresholds: OWNER TARGET REQUIRED (§20.7).
- **Recovery:** timesheet lines are re-derivable from events and adjustments; exports are reproducible from snapshots; a re-derivation compare runs before batch close and blocks on divergence.

## 06.10 UX and accessibility

- Admin Console workforce workspaces meet WCAG 2.1 AA (NFR-A11Y). Clock surfaces on Android follow the targets set for their application (§23, OWNER TARGET REQUIRED).
- A clock action shows explicit confirmation including the recorded time and whether it is pending sync (INV-14); it never shows success before Core acceptance or durable local queueing.
- Raw versus rounded time, rule warnings and exceptions are visible with reasons; corrections show history.
- Every screen provides the §22 states; destructive or significant actions (publish, approve, export, end employment) require confirmation with consequence text.
- Employees see their own data in plain language; restricted tiers are visibly absent for users without access rather than shown empty.

## 06.11 Acceptance criteria

| ID | Criterion | Covers |
|---|---|---|
| AC-WFM-1 | Given an employee with no staff account, then they cannot sign in to any surface, and creating the employee created no account, role or grant. | WFM-1 (invariant) |
| AC-WFM-2 | Given a staff account linked to an employee, when the account is deactivated through 09, then the employee record is unchanged except for a recorded link status, and historical records keep the staff identifier. | WFM-1, WFM-3 |
| AC-WFM-3 | Given a cash shift opened and closed by a staff member, then no attendance event or timesheet line results. | WFM-4 |
| AC-WFM-4 | Given a user with roster permission only, when they request an employee's personal or pay-related fields, then the server refuses or omits them. | WFM-8 (authz) |
| AC-WFM-5 | Given a roster violating a `block` rule, when published, then publish is refused with the violations and no version, notification or event is created. | WFM-13 (invalid) |
| AC-WFM-6 | Given two managers editing one draft roster, then the second save fails the version check and no change is lost silently. | WFM-12 (concurrency) |
| AC-WFM-7 | Given a rule template with no confirmed parameters, then it never evaluates and cannot block or warn. | WFM-14 |
| AC-WFM-8 | Given a clock-in submitted twice with the same key, then exactly one attendance event exists. | WFM-18 (duplicate) |
| AC-WFM-9 | Given a device credential without staff authentication, when it submits an attendance event for an employee, then the server refuses it. | WFM-19 (authz) |
| AC-WFM-10 | Given offline clocking is enabled and the device loses connectivity, when it reconnects, then queued events replay in order with offline flags and both times, with no loss or duplication. | WFM-21 (recovery) |
| AC-WFM-11 | Given rounding is configured, then the timesheet shows raw and rounded times and the raw event is unchanged. | WFM-22 |
| AC-WFM-12 | Given an unresolved `missed-punch` exception, when approval is attempted, then it is refused. | WFM-23 |
| AC-WFM-13 | Given a manager attempts to approve their own timesheet, then approval is refused and the attempt is audited. | WFM-26 (SoD) |
| AC-WFM-14 | Given an approved timesheet is corrected, then the original line remains, a linked adjustment carries actor and reason, and the employee can see it. | WFM-25 |
| AC-WFM-15 | Given a batch with an employee lacking an approved timesheet and no zero confirmation, then export generation is refused with the blocker listed. | WFM-30 |
| AC-WFM-16 | Given the provider rejects a transmission, then the export is `failed` with the reason, retry re-sends the same snapshot (same checksum), and no second export is created. | WFM-31 (dependency failure, retry) |
| AC-WFM-17 | Given a correction to an exported timesheet, then a delta export linked to the original is generated and the original is unchanged. | WFM-32 |
| AC-WFM-18 | Given an employee is ended, then a deprovisioning task is created; on execution the linked account's sessions, live realtime connections, tablet elevation, PIN and grants are revoked, and the audit records the time from employment end to completion. | WFM-36 (audit, observability) |
| AC-WFM-19 | Given an ended employee with an open cash shift, then deprovisioning still completes and a manager-visible flag for the open shift exists. | WFM-36 (failure path) |
| AC-WFM-20 | Given the lifecycle consumer is down when an employee is ended, then after recovery exactly one deprovisioning task exists, and an alert fired while it was missing beyond the threshold. | WFM-36 (dependency failure) |
| AC-WFM-21 | Given location capture is not approved, then no clock request stores location data even if a client sends it. | WFM-24 (privacy) |
| AC-WFM-22 | Given any workforce domain event or log line, then it contains identifiers only and no personal data. | WFM-42 |
| AC-WFM-23 | Given an employee whose jurisdiction has no active validated payroll pack and no accepted provider adapter, when a payroll run is requested, then the employee is excluded with the reason (or the run is refused if none is covered) and only the export path is offered; given a finalised run, when a covered timesheet is later corrected, then a linked delta run is produced and the finalised run is unchanged; the preparer cannot approve their own run. | WFM-29 (invalid, correction, SoD) |
| AC-WFM-24 | Given a position requiring a training item configured to satisfy a certification, when an employee's completion is verified, then an append-only completion and a renewed certification with expiry exist; when required training becomes overdue and is configured as blocking, then rostering the employee into that position is refused. | WFM-45 |
| AC-WFM-25 | Given AI staffing recommendations for a draft roster, then they are labelled with evidence, time basis and confidence; none enters the roster until a manager accepts it; an accepted shift records the manager and AI source and is evaluated against labour rules at publish; no AI path can publish a roster or change pay or permissions; with the AI service down, rostering works and shows recommendations as unavailable. | WFM-46 (INV-21, failure path) |

## 06.12 KPIs and metric definitions

| KPI | Definition | Target |
|---|---|---|
| Schedule adherence | 1 − (Σ absolute difference between rostered and worked minutes ÷ Σ rostered minutes), per venue and period | OWNER TARGET REQUIRED (DEC-WFM-17) |
| Timesheet exception rate | Exceptions raised ÷ attendance events, by type | OWNER TARGET REQUIRED |
| Exception resolution time | Median time from raise to resolution | OWNER TARGET REQUIRED |
| On-time approval rate | Timesheets approved by the period-close instant ÷ timesheets in the period | OWNER TARGET REQUIRED |
| Export rejection rate | Provider-rejected exports ÷ transmitted exports; delta exports ÷ full exports | Verdura "zero rejections per batch": proposed (Verdura evidence) — OWNER TARGET REQUIRED |
| Certification currency | Employees in positions requiring a certification who hold a current one ÷ such employees | OWNER TARGET REQUIRED |
| Leaver deprovisioning time | Time from employment end (effective time) to completion of access removal, maximum and P95 | OWNER TARGET REQUIRED (WFM-36) |
| Orphaned-access count | Active accounts linked to ended employments at the review instant | OWNER TARGET REQUIRED |
| Open-shift fill rate; swap fill time | Open shifts filled before start ÷ open shifts; median offer-to-fill time | OWNER TARGET REQUIRED |
| Labour cost percentage | Indicative labour cost ÷ net sales from Core, per venue and business date; only if DEC-WFM-9 approves rates; always labelled indicative | OWNER TARGET REQUIRED |

## 06.13 Open decisions

| ID | Decision | Why it matters | Options evidenced | Blocks | Tier |
|---|---|---|---|---|---|
| DEC-WFM-1 | Core ownership of employment records: within `internal/staff/` or a separate workforce package (under DEC-X-13) | Keeps access identity and employment data separable | Part C §30.3 lists `internal/staff/` (not created) | Any workforce implementation | 2 |
| DEC-WFM-2 | Employee record scope: which personal fields and documents are collected (date of birth or age band, right-to-work, emergency contact, contracts) | Data minimisation and sensitivity | Verdura collects visas, contracts, youth flag (evidence) | WFM-6, WFM-9 | 3 |
| DEC-WFM-3 | Labour rule set: rule types enabled, parameters, block or warn, override policy, who confirms templates, reminder offsets | No jurisdictional rules may be invented | Verdura rule types and 30/14/3-day reminders (proposed, Verdura evidence); DEC-X-5 | WFM-10, WFM-13, WFM-14 | 3 |
| DEC-WFM-4 | Clock surface and staff authentication method (reuse DL-081 PIN, separate clock PIN, badge) and any new device kind | Buddy-punching risk; Part C app inventory; O-20 alignment | DL-081 PIN elevation; D8 device kinds additive | WFM-19, WFM-20 | 2 |
| DEC-WFM-5 | Location, geofencing, photograph or biometric verification for clocking | Privacy impact on employees | Verdura: mobile geofence, optional photo; biometrics roadmap after privacy review (evidence) | WFM-24 | 3 |
| DEC-WFM-6 | Offline clocking and its queue host (client or Venue Edge) | Integrity of attendance during outages | EDGE-2/3 semantics | WFM-21 | 2 |
| DEC-WFM-7 | Time rounding rules and exception thresholds | Pay disputes; transparency | Verdura visible-rounding policy (evidence) | WFM-22, WFM-23 | 3 |
| DEC-WFM-8 | Pay-period calendars; payroll provider(s); export format and transport | Export boundary implementation | Provider-format file or API (evidence) | WFM-30 to WFM-33 | 3 / 2 |
| DEC-WFM-9 | Whether pay rates or indicative rates are stored, and labour-cost previews | Sensitive financial data; cost control | Verdura indicative rates, restricted (evidence) | WFM-17 | 3 |
| DEC-WFM-10 | Leave types and balance source (provider or none) | Avoids entitlement calculation in Servvia | Provider-sourced balances (evidence) | WFM-28 | 3 |
| DEC-WFM-11 | Timesheet approval policy: approver scope, multi-step approval, thresholds (with DEC-X-7) | SoD and workload | Verdura: approver ≠ employee (evidence) | WFM-26 | 3 |
| DEC-WFM-12 | JML policy: automatic grant removal on mover, account proposal rules, linking criteria | Least privilege versus disruption | Verdura WF-5 (evidence); SCIM is DEC-X-12 | WFM-34 to WFM-36 | 3 |
| DEC-WFM-13 | Swap and open-shift claim policy (first claim, manager pick, auto-approval) | Fairness and control | Verdura configurable (evidence) | WFM-16 | 3 |
| DEC-WFM-14 | Employee self-service surface (Admin Console view, Waiter Tablet Staff Mode, or a new application through Part C change) | App inventory is fixed at four Android apps | §32 | WFM-40 | 2 / 3 |
| DEC-WFM-15 | Performance notes, goals and recognition. Performance analytics and reporting are owner-approved (DEC-X-1, `TARGET CAPABILITY — FUTURE DELIVERY`); notes, goals and recognition remain this decision | Scope creep into HR systems | Verdura lightweight objects (evidence) | WFM-43 (notes, goals, recognition only) | 3 |
| DEC-WFM-16 | Tip pooling and distribution | Policy and jurisdictional exposure | Verdura: out until jurisdiction review (evidence) | WFM-44 | 3 |
| DEC-WFM-17 | Workforce KPI targets, leaver deprovisioning time and clock latency targets | Acceptance and monitoring | Verdura KPI list (evidence) | 06.12; WFM-36 | 3 |
| DEC-WFM-18 | Whether opening a cash shift (D7) should require or check attendance | Coupling of finance and workforce | None evidenced | WFM-4 | 3 |
| DEC-WFM-19 | Payroll calculation mechanism: an in-house calculation engine driven by jurisdiction payroll packs, payroll-provider adapters, or both; what validation or certification evidence admits a pack or provider for a jurisdiction (applicability and acceptance with P5); how payroll runs, delta runs and provider results are reconciled | Payroll calculation is owner-approved (DEC-X-1) but statutory correctness cannot be specified by the PRD; Servvia must never calculate for a jurisdiction without validated rules | KitchenOS payroll calculation (L214, L322; capability evidence only, its UK compliance assertion not adopted); provider adapter (INV-19); jurisdiction pack (INV-22) | WFM-29, 06.4.10, 06.6.10 | **APPROVED — TIER 2** (orchestrator ratification 2026-10-05; mechanism only, 00.10.4); applicability and validation evidence: P5 |

Also referenced, not duplicated: DEC-X-1 (scope inclusion, resolved 2026-10-05), DEC-X-17 (delivery phasing), DEC-X-18 (embedded financial services), DEC-X-19 (autonomous AI actions), DEC-X-2 (roles), DEC-X-3 (business date), DEC-X-4 (retention and erasure), DEC-X-5 (regimes, including employment record-keeping), DEC-X-7 (thresholds), DEC-X-8 (capacity), DEC-X-12 (SSO and SCIM), DEC-X-13 (Core ownership), DEC-X-15 (notification channels), O-2, O-13, O-20.

## 06.14 Future and deferred capabilities

| Capability | State | Precondition |
|---|---|---|
| Employee records, positions, certifications, training records | TARGET CAPABILITY — FUTURE DELIVERY | DEC-X-17; DEC-WFM-1, DEC-WFM-2 |
| Rostering, swaps, open shifts, labour rules | TARGET CAPABILITY — FUTURE DELIVERY | DEC-X-17; DEC-WFM-3, DEC-WFM-13 |
| Attendance, breaks and timesheets | TARGET CAPABILITY — FUTURE DELIVERY | DEC-X-17; DEC-WFM-4 to DEC-WFM-7, DEC-WFM-11 |
| Leave | DEFERRED (SPRD §13; not KitchenOS-described) | DEC-WFM-10 |
| Payroll export | TARGET CAPABILITY — FUTURE DELIVERY | DEC-X-17; DEC-WFM-8 |
| Payroll calculation through jurisdiction payroll packs or provider adapters | TARGET CAPABILITY — FUTURE DELIVERY | DEC-X-17; DEC-WFM-19; validated pack or accepted adapter per jurisdiction (P5, INV-22) |
| Performance analytics and workforce reporting | TARGET CAPABILITY — FUTURE DELIVERY | DEC-X-17; volume 08 metric definitions |
| Joiner-mover-leaver tasks (WFM-34 to WFM-37) | TARGET CAPABILITY — FUTURE DELIVERY | DEC-X-17; DEC-WFM-12 |
| JML automation, SSO, SCIM | DEFERRED | DEC-X-12, DEC-WFM-12 |
| AI staffing predictions and roster recommendations (WFM-46) | TARGET CAPABILITY — FUTURE DELIVERY | DEC-X-17; 08 forecasting; autonomy DEC-X-19; Verdura unlock "suggestion acceptance > 60 %" proposed (Verdura evidence) only |
| Priced labour cost from provider rate feeds | FUTURE | DEC-WFM-9; provider API |
| Tip pooling and distribution | FUTURE | DEC-WFM-16, DEC-X-5 |
| Performance notes, goals and review cycles | FUTURE | DEC-WFM-15 |
| Jurisdiction payroll and employment packs | TARGET CAPABILITY — FUTURE DELIVERY as a mechanism (INV-22); each jurisdiction supported only once its pack is implemented and validated | DEC-X-5 (P5), DEC-WFM-19 |
| Biometric or photo clock verification | FUTURE | DEC-WFM-5 |
| Shared staff pools across venues | FUTURE | Within one organization only (INV-2); DEC-X-1 |
