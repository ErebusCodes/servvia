# Servvia PRD — Volume 09: Administration

> **Authority / status:** Normative Servvia domain volume under [`product-requirements.md`](product-requirements.md) ("SPRD"), which wins on any conflict, and under the conventions and invariants of [`00-overview-and-conventions.md`](00-overview-and-conventions.md). Version label **v5.1 (Servvia)**. Last updated 2026-10-05.
> **Provenance:** Servvia baseline (SPRD §1, §3, §7 STF-1, VEN-1, ADM-1 to ADM-3, MENU-1 to MENU-6, §9 EDGE-2/3, PRT-1 to PRT-3, §10 NFR-SEC/NFR-AUD/NFR-REL, §14 O-2, O-8, O-13, O-20, O-21, Part B §15 rows C/D/M/O/P/R/AG, §16, §18, §20, Part C §30.3, §34), Core D8 (devices and terminals; implemented, not in production), DL-081 (current web tablet identity), DL-105 and DL-115 (ownership), plus enterprise hardening (basis `E`). Mechanisms for separation of duties, session revocation, audit search, support access, edge pairing and restore governance were adapted from the Verdura v5.2 Administration volume as non-authoritative source material (00.3). Verdura's POS connection registry, capability matrices, sync scorecards and on-premises POS connector are superseded. Owner-approved KitchenOS capabilities (basis `K`, owner decision 2026-10-05, DEC-X-1) add venue operating profiles, franchise and group operation, integration framework administration, the external API platform with sandbox, MFA, IP allowlisting, encryption at rest, point-in-time recovery, guided onboarding, contextual help, jurisdiction-pack administration and privacy-request tooling as `TARGET CAPABILITY — FUTURE DELIVERY` (09.5.8); their delivery phase is DEC-X-17.
> **Principle:** administrative power is constrained and auditable. Every administrative mutation is server-authorized, scoped, validated, attributable and recoverable by a further audited action; none is silent.
> **Acceptance:** **NORMATIVE BASELINE ACCEPTED 2026-10-05** (SERVVIA PRD NORMATIVE BASELINE ACCEPTED; record in volume 00 §00.1.3). This volume is a normative refinement of [`product-requirements.md`](product-requirements.md), which wins on any conflict. Acceptance does not commit future-delivery capabilities to a release, select open policy values, approve production or release, or certify compliance.

SPRD already defines ADM-1 (reservation and live-order views), ADM-2 (printer management) and ADM-3 (daily-email settings). This volume cites them and adds `ADMIN-` requirements; it does not redefine them.

## 09.1 Purpose, scope and state

Administration is how an organization structures itself in Servvia, grants and removes access, enrols and revokes devices, configures venues, observes platform health and proves who did what. It covers: organization and venue hierarchy; configuration and its history; staff accounts and credentials; roles, permissions, step-up and separation of duties; devices, terminals and Venue Edge identity; printers; the administration boundary of menu and media; integration credentials; audit search and export; support access; system monitoring; backup and restore visibility; capability controls; daily email; personal-data requests. Employment records (volume 06), financial policy (volume 07) and menu semantics (volume 02) are out of this volume's scope except at their administrative boundary.

| Capability | State | Basis |
|---|---|---|
| Organization and venue records, venue access grants | CURRENT in Nest (VenueAccessGuard); Core `venues` read side implemented, not in production; Core `organizations` not created | S (00.7, §30.3) |
| Venue settings (VEN-1) | TRANSITIONAL (Nest) → TARGET (Core) | S |
| Intermediate hierarchy levels (brand, region) | OWNER DECISION REQUIRED (DEC-ADMIN-1) | V(09 §3.1)+D |
| Franchise and group operation: centralized configuration with venue overrides, group-scoped administration, cross-location rollout (ADMIN-63) | TARGET CAPABILITY — FUTURE DELIVERY; hierarchy levels DEC-ADMIN-1 (inclusion resolved) | K(L52, L343–346, L603–604)+E |
| Venue operating profiles (dine-in, QSR/takeaway, hybrid) as server-enforced capability enablement (ADMIN-62) | TARGET CAPABILITY — FUTURE DELIVERY (mechanism DEC-ADMIN-10 approved) | K(L13–29, L187)+A |
| Guided organization and venue onboarding with readiness checks (ADMIN-69); contextual help and role-specific guidance (ADMIN-70) | TARGET CAPABILITY — FUTURE DELIVERY; self-service tenant sign-up DEC-X-18 | K(L294, L556–568) |
| Jurisdiction-pack administration (tax, payroll, compliance record formats, locale) (ADMIN-71) | TARGET CAPABILITY — FUTURE DELIVERY; regulatory activation gated on validation evidence (P5) | K(L243, L452–472)+E (INV-22) |
| Configuration inheritance, validation, versioning, effective dates (INV-17) | TARGET | E |
| Staff accounts: named sign-in, staff PIN, governed owner bootstrap, session revocation (STF-1) | TRANSITIONAL in Nest; Core verifies staff credentials (implemented, not in production) | S (STF-1, O-2, DL-081) |
| Credential issuance | TRANSITIONAL in Nest by decision O-2; target owner Core `identity` | A (O-2) |
| Staff venue-scope enforcement in Core | TARGET; known gap that must be fixed (O-2, §16.3) | S |
| Roles owner, admin, manager, cashier, kitchen, viewer | CURRENT (Nest; Core enforces on its routes, not in production) | S |
| Domain roles and custom roles | OWNER DECISION REQUIRED (DEC-X-2, DEC-ADMIN-2) | D |
| Manager step-up on the web Order Tablet | TRANSITIONAL (Nest, DL-081) | S |
| Step-up and separation of duties for Admin Console privileged actions | TARGET (mechanism); catalogue and thresholds DEC-ADMIN-4, DEC-X-7 | S+E (INV-4) |
| MFA | TARGET CAPABILITY — FUTURE DELIVERY; required roles and methods OWNER DECISION REQUIRED (DEC-ADMIN-3, P2) | V(09 §3.2)+K(L550)+D |
| IP allowlisting for administrative access (ADMIN-66) | TARGET CAPABILITY — FUTURE DELIVERY | K(L552) |
| Encryption at rest for canonical stores, backups and exports (ADMIN-67) | TARGET CAPABILITY — FUTURE DELIVERY (Venue Edge encrypted local storage is TARGET under EDGE-2) | K(L540–541)+S (EDGE-2, row R) |
| Device registry and lifecycle (D8: enrol, rotate, revoke; kinds `pos_terminal`, `order_tablet`, `kds`, `payment_adapter`); terminals | TARGET (implemented in Core, not in production) | S (§16.6, D8) |
| Web tablet enrollment and device identity (`TabletEnrollment`, `TabletDevice`) | TRANSITIONAL (Nest, DL-081); retires when the Android Waiter Tablet migrates | S (§33) |
| KDS authentication (venue PIN, no per-device identity) | TRANSITIONAL; target per O-13 | S |
| Staff Mode authorisation on the native Waiter Tablet | TARGET (O-20 decided 2026-10-05, 00.10.6; implementation incomplete) | S |
| Venue Edge identity and pairing | TARGET (EDGE-2); mechanism ARCHITECTURE DECISION REQUIRED (DEC-ADMIN-12) | S |
| Printer administration (ADM-2, PRT-*) | TRANSITIONAL (Nest `Printer` configuration; legacy connector dispatch to retire); TARGET through Venue Edge | S (§30.4, §34.2) |
| Menu administration (MENU-1 to MENU-6) | TRANSITIONAL (Nest); Core menu read partly implemented | S (volume 02) |
| Media (MENU-3) | CURRENT (Nest `MediaAsset`, GCS); Core ownership O-8 | S |
| Payment adapter credential (CARD3) | TARGET (Core D6/D8, not in production) | S (ADR 0002) |
| Legacy external-POS connector administration | TRANSITIONAL, RETIRE LATER (§34.2) | S |
| Outbound API keys and webhooks for third parties; external API sandbox and developer documentation (ADMIN-49, ADMIN-65) | TARGET CAPABILITY — FUTURE DELIVERY (inclusion resolved by DEC-X-1); public marketplace or partner programme OWNER DECISION REQUIRED (DEC-ADMIN-24) | V(09 §3.8)+K(L8, L103, L156, L360–369) |
| Integration framework administration for delivery marketplaces, accounting, payment and communications providers (ADMIN-64) | TARGET (payment adapter, CARD3); TARGET CAPABILITY — FUTURE DELIVERY (others) | K(L100, L339–342, L424–448)+S (INV-19) |
| Audit records | CURRENT in Nest (staff, device, system actors); TARGET in Core `audit` (package not created) | S (00.7) |
| Audit search and export (NFR-AUD) | TARGET | S |
| Support access (authorized and audited, row AG) | TARGET | S |
| System monitoring (§20: health, worker backlog, Edge heartbeat, dead letters) | TARGET; Core organization-scoped worker backlog implemented, not in production | S |
| Backup and restore visibility | TARGET; RPO/RTO DEC-X-9 | S |
| Point-in-time recovery of the canonical database (ADMIN-68) | TARGET CAPABILITY — FUTURE DELIVERY; RPO/RTO DEC-X-9 (P7) | K(L495)+S (rows O, P) |
| Daily-email settings (ADM-3) in the Admin Console | TARGET (WEB-3); email sending CURRENT in Nest | S |
| Personal-data export and erasure requests | TARGET CAPABILITY — FUTURE DELIVERY; obligations and policy OWNER DECISION REQUIRED (DEC-X-4, DEC-X-5; P4, P5) | K(L244, L459–465)+D |
| SSO and SCIM | DEFERRED (SPRD §13, DEC-X-12) | S |
| Access reviews, fine-grained object overrides, venue cloning, sandbox organizations | FUTURE | V(09 §3.3–3.4, §9) |

## 09.2 Actors and surfaces

| Actor | Administrative reach | Basis |
|---|---|---|
| Owner | Everything in the organization, including other owners' grants subject to last-owner protection (ADMIN-24) | SPRD §3 |
| Admin (platform administrator of the organization) | Venues, users, roles, configuration, devices, printers within granted scope | SPRD §3 |
| Manager | Venue-level administration permitted by role (current: device enrolment and tablet PINs within venue grants; DL-081, D8) | SPRD §3; DEC-ADMIN-2 |
| Cashier | Reads terminals (D8); no administration | D8 |
| Kitchen, Viewer | No administration | DEC-X-2 |
| Servvia platform operator | Platform health and, under support access, a customer organization's administration surfaces | Row AG; DEC-ADMIN-19 |
| Device identities (D8 credential, tablet token, KDS token, Venue Edge) | **None.** Refused on every administration route | D8, DL-081, INV-3 |
| System (workers, schedulers) | Executes approved scheduled changes, retention jobs, delivery retries; acts as `system` actor in audit | INV-3 |

**Surfaces.** Administration lives in the **Admin Console** only (NFR-SEC-1: separate origin, server-side authentication before the bundle loads). No administration route is served from the Customer Website (WEB-3), the Android applications or the Kiosk management overlay (KSK-5 exposes no administration). Windows POS administration is not defined (SPRD §12, frozen).

## 09.3 Domain model and ownership

```text
Organization (tenant root)
  ├─ Venue (VEN-1 settings, status) ── VenueConfiguration (versioned, inherits from OrganizationConfiguration)
  ├─ StaffAccount ── Credential (password hash, staff PIN hash) ── Session (N)
  │     └─ RoleAssignment (role) ── VenueGrant (N)
  ├─ Role ── Permission (server-defined codes)          [custom roles: DEC-ADMIN-2]
  ├─ SoDRule (action pair × condition)                  [thresholds: DEC-X-7]
  ├─ Device (kind, venue, status, credential verifier) ── Terminal (0..1, pos_terminal only)
  ├─ VenueEdgeInstallation (venue-bound identity)       [DEC-ADMIN-12]
  ├─ Printer (role, connection, paper width) ── PrintJob (N)   [ADM-2, PRT-*]
  ├─ IntegrationConnection (adapter, scope, secret reference, status)
  ├─ AuditRecord (append-only)
  ├─ SupportAccessGrant (operator, scope, window)
  ├─ CapabilitySetting (organization or venue)          [DEC-ADMIN-10]
  ├─ OperatingProfile (named capability-setting bundle)  [ADMIN-62; TARGET CAPABILITY — FUTURE DELIVERY]
  ├─ ConfigurationRollout (setting version × venue set × per-venue outcome)   [ADMIN-63; TARGET CAPABILITY — FUTURE DELIVERY]
  ├─ NetworkAccessPolicy (organization allowlist)       [ADMIN-66; TARGET CAPABILITY — FUTURE DELIVERY]
  ├─ JurisdictionPackActivation (pack, version, scope, validation evidence)   [ADMIN-71; TARGET CAPABILITY — FUTURE DELIVERY]
  ├─ DailyEmailSetting (ADM-3)
  └─ DataRequest (export or erasure)                    [DEC-X-4]
```

| Object | Canonical owner (target, SPRD §30.3) | Current |
|---|---|---|
| Organization | Core `organizations` (not created) | Nest / Prisma |
| Venue, VenueConfiguration | Core `venues` | Nest admin; Core read side (D1) |
| StaffAccount, Credential, Session, RoleAssignment, VenueGrant, Role, Permission | Core `identity` (`auth`, `users`, `roles`, `permissions`, `sessions`) | Nest issues and administers (O-2); Core verifies |
| Device, device credential | Core `devices`; authentication material in `identity/devices` | Core D8 (not in production); Nest `TabletDevice` and KDS PIN (transitional) |
| Terminal | Core `terminals` (inside `devices` today) | Core D8 |
| VenueEdgeInstallation | Core `devices` registry plus Venue Edge `registration` module (§30.4) | Not created |
| Printer, PrintJob | Venue Edge for hardware and queue (EDGE-1); configuration owner DEC-ADMIN-20 | Nest `Printer` (transport configuration) |
| IntegrationConnection | Core adapters (INV-19) | Payment adapter as a D8 device; legacy external-POS in Nest (to retire) |
| AuditRecord | Core `audit` (not created) | Nest audit |
| SupportAccessGrant, SoDRule, CapabilitySetting, DataRequest | Core `identity` or a new package: DEC-X-13 | Not created |
| OperatingProfile, ConfigurationRollout | Core `venues` / `organizations` configuration (package boundary DEC-X-13 residual) | Not created |
| NetworkAccessPolicy | Core `identity` | Not created |
| JurisdictionPackActivation | Core configuration and adapters (INV-22; package boundary DEC-X-13 residual) | Not created; NZ GST profile implemented in Core (00.7) |
| DailyEmailSetting | Core `notifications` or reporting (DEC-X-13) | Nest email |
| Menu, media | Volume 02; media ownership O-8 | Nest |

## 09.4 Business objects and lifecycles

### 09.4.1 Organization and Venue

- **Organization** is the tenant root (INV-2). It holds organization-level configuration defaults and at least one active owner (ADMIN-24).
- **Venue** fields (VEN-1) plus `status`. Proposed lifecycle (mechanism; exact states DEC-ADMIN-11):

```text
onboarding ──activate──> active ──suspend──> suspended ──resume──> active
active / suspended ──close──> closed   (final; data retained)
```

Invariants: a venue in `onboarding` or `suspended` accepts administration but refuses new transactional commands with a stable error; `closed` refuses both, keeps all records (INV-11), and frees nothing that history references. A venue is never deleted through administration.

### 09.4.2 Configuration (INV-17)

Each setting has a registry definition: key, level (organization or venue), type, validation rule, default, whether it is effective-dated, whether a change is privileged (DEC-ADMIN-4).

```text
draft ──validate──> valid ──activate (now or effectiveFrom)──> active ──superseded by next version──> superseded
draft ──validate──> invalid (refused; nothing applied)
scheduled (effectiveFrom in the future) ──cancel──> cancelled
```

Invariants: the effective value is the venue override if present, else the organization value, else the default, and the UI shows which applies. A change creates a new version (never edits a version). A transaction uses the version effective at its own time (KIT-1 "station configuration effective at submission" is an instance). Reverting is a new version.

### 09.4.3 StaffAccount, Credential and Session

```text
invited ──first sign-in──> active ──deactivate──> deactivated ──reactivate──> active
```

- Deactivation revokes every session and every derived elevation (tablet staff or manager elevation) at once (§16.5) and snapshots the account's grants into the audit record.
- Credentials: password (NFR-SEC-2 hashing), optional staff PIN for tablet elevation (DL-081: distinct from and not derived from the password, hashed, set only by an authorized administrator). Neither is ever displayed or exported.
- Sessions: `active → revoked | expired`. Lifetime and idle rules DEC-ADMIN-6.
- The `invited` state is proposed (Verdura evidence); whether Servvia issues invitations or administrator-set initial credentials is part of DEC-ADMIN-6.

### 09.4.4 Role, VenueGrant and SoDRule

- A staff account has one role (current model) and one or more venue grants; organization-wide access is an explicit grant, not an absence of grants.
- Permission codes are defined by the server; roles are compositions of codes. Custom roles DEC-ADMIN-2.
- An SoDRule names two actions (or initiate/approve of one action) and a condition; it is evaluated at action time against the actors recorded on the object. Values are DEC-X-7.

### 09.4.5 Device and Terminal (D8)

```text
Device:   (enrol) active ──rotate──> active (new credential; old stops at once) ──revoke──> revoked (final)
Terminal: (create) active ──disable──> disabled (final);  bind / unbind pos_terminal device while active
```

Invariants (D8, implemented in Core): the credential is returned once, at enrolment and rotation only, and is never present in list or get responses, logs, audit rows or URLs; only a digest is stored; the venue comes from the stored device, never from the caller; a device's kind never grants staff authority; a terminal binds at most one active `pos_terminal` device of the same venue; disabling a terminal does not alter historical shifts; enrolment replay with the same request key returns the device without a credential.

### 09.4.6 VenueEdgeInstallation

Proposed (EDGE-2 mechanism; detail DEC-ADMIN-12): `pairing → active → degraded → offline`, any state `→ revoked` (final). A pairing secret is single-use and expiring; the installation's identity is venue-bound, revocable and outbound-only; revocation stops command claims and reports while preserving history. Heartbeat, versions, queue depth and oldest age are reported (EDGE-3).

### 09.4.7 AuditRecord

Append-only (INV-15): actor class and identity, acting-on-behalf identity where applicable (tablet `actingStaffId`, support operator), action, entity type and identifier, organization, venue, before and after, reason where captured, correlation id, timestamp, request origin metadata appropriate to its class (INV-18). No administrative function edits or deletes an audit record.

### 09.4.8 SupportAccessGrant

```text
requested ──authorize──> active (window start) ──expire / end──> ended
requested ──decline──> declined
```

The operator always acts under their own identity; the grant records scope (organization, venues, read-only or read-write), reason, window and authorizer. Enablement model DEC-ADMIN-7.

### 09.4.9 DataRequest

`received → verified → in_progress → completed | rejected (reason)`. Mechanism only; obligations, deadlines and erasure rules are DEC-X-4 and DEC-X-5. Erasure never deletes financial records; it anonymises personal fields where policy allows (INV-11).

### 09.4.10 ConfigurationRollout (TARGET CAPABILITY — FUTURE DELIVERY)

```text
draft ──preview (affected venues)──> previewed ──confirm──> applying ──> completed | completed_with_failures
applying: per venue  pending ──> applied | refused (validation error, locked or venue not eligible)
```

A rollout is a set of ordinary configuration versions (09.4.2), one per target venue, each validated and applied on its own. Its overall outcome is derived from the per-venue outcomes and never reported as complete while a venue is `pending` or `refused` (INV-14).

### 09.4.11 JurisdictionPackActivation (TARGET CAPABILITY — FUTURE DELIVERY)

```text
available ──attach validation evidence──> validated ──activate (scope, effectiveFrom)──> active ──superseded by next version──> superseded
active ──deactivate (reason)──> inactive
```

Regulatory packs (tax, payroll, statutory record formats) cannot leave `available` without validation evidence (P5); locale-only packs follow the same lifecycle with evidence of their own acceptance tests. Activation is effective-dated (DEC-ADMIN-9); records keep the pack version in force at their own time.

## 09.5 Requirements

### 09.5.1 Organization, venues and configuration

| ID | Requirement | Priority | State | Basis |
|---|---|---|---|---|
| ADMIN-1 | The committed hierarchy is organization → venue. Intermediate levels (brand, region) and legal-entity attachment are not created until DEC-ADMIN-1 decides them; reporting groupings do not substitute for them. | MUST | TARGET (levels: OWNER DECISION REQUIRED) | S (SPRD §1) + V(09 §3.1)+D |
| ADMIN-2 | An authorized administrator can create and onboard an additional venue entirely through administration and configuration, with no code change or deployment (SPRD §1). | MUST | TARGET | S |
| ADMIN-3 | VEN-1 settings are validated server-side before saving (for example a valid IANA time zone, non-overlapping operating hours, non-negative capacity); an invalid change is refused with field-level stable errors and nothing is applied. | MUST | TRANSITIONAL (Nest) → TARGET | S (VEN-1) + E (INV-16) |
| ADMIN-4 | Venues have an explicit status lifecycle (09.4.1). A non-active venue refuses new transactional commands with a stable error; no venue is deleted through administration. | SHOULD | OWNER DECISION REQUIRED (DEC-ADMIN-11) | V(09 §3.1)+E (INV-11) |
| ADMIN-5 | Configuration follows INV-17: every setting has a registry definition (level, type, validation, default); the effective value and its origin (default, organization, venue override) are visible; overrides can be removed to restore inheritance. | MUST | TARGET | E |
| ADMIN-6 | Every configuration change creates an immutable version with actor, time, before and after, and reason where the setting requires one; history is viewable per setting; revert creates a new version. | MUST | TARGET | E (INV-11, INV-15) |
| ADMIN-7 | Settings designated effective-dated (DEC-ADMIN-9) accept a future `effectiveFrom`; transactions and reports use the version effective at their own time; a scheduled change can be cancelled before it takes effect; activation by the scheduler is audited as a `system` action. | MUST | TARGET (mechanism approved 2026-10-05: DEC-ADMIN-9; the setting list is a Tier-1 default) | E + S (KIT-1) |
| ADMIN-8 | Concurrent edits to the same setting or object use version compare-and-set; the second writer receives a conflict and the current version, never a silent overwrite. | MUST | TARGET | S (INV-10) |
| ADMIN-9 | Changes that affect live service (tax configuration, station routing, printer roles, operating hours during an open business day, capability settings) show the affected venues and objects before confirmation, and are privileged actions (ADMIN-27). | MUST | TARGET | E |
| ADMIN-10 | Per-venue capability enablement (for example Guest Mode, kitchen printing, online ordering under O-18) is audited configuration evaluated server-side; a disabled capability is refused by the server, not merely hidden. Verdura module phase-gates are not used. | SHOULD | TARGET (mechanism approved 2026-10-05: DEC-ADMIN-10) | V(09 §3.1)+S (PR-3) |

### 09.5.2 Staff accounts and credentials

| ID | Requirement | Priority | State | Basis |
|---|---|---|---|---|
| ADMIN-11 | Every human uses a named staff account; shared staff logins are not issued. Actions are attributed to the named account, including on tablets after elevation (DL-081). | MUST | TRANSITIONAL (Nest) → TARGET | S (STF-1, INV-3, INV-5) |
| ADMIN-12 | The first owner of an organization is created only through a governed bootstrap procedure (operator-run, audited, not reachable from any public or unauthenticated endpoint); further owners are granted by an existing owner. | MUST | TRANSITIONAL (Nest governed bootstrap) → TARGET | S (STF-1) + E |
| ADMIN-13 | Credential reset (STF-1) never reveals the existing credential, requires the holder to set a new one, and revokes the account's existing sessions and derived elevations. | MUST | TRANSITIONAL (Nest) → TARGET | S (STF-1, §16.5) |
| ADMIN-14 | A staff PIN for tablet elevation is set only by an authorized administrator, is distinct from and not derived from the login password, is stored only as a slow hash, is never displayed after entry, and its verification is rate-limited and timing-safe. The native Waiter Tablet uses this personal-PIN model for the MVP (O-20, 00.10.6); the PIN is not the permanent architecture. | MUST | TRANSITIONAL (Nest, DL-081); native TARGET (O-20; implementation incomplete) | S (DL-081, O-20) |
| ADMIN-15 | Deactivating an account, removing a venue grant or changing a role takes effect on the account's next request and on its live realtime connections (§16.5, §16.12), including tablet elevations derived from the account. The D12 fail-open defect is corrected before production (§16.12). | MUST | TARGET | S |
| ADMIN-16 | An administrator can list a staff account's active sessions (start, last activity, client type) and revoke one or all; a user can sign out of their own sessions. | MUST | TARGET | S (§16.4–16.5) |
| ADMIN-17 | Password hashing, TLS and login rate limiting follow NFR-SEC-2 and §16.4. Password composition, session idle and absolute lifetimes, concurrent-session limits, PIN length and lockout are configuration values set by DEC-ADMIN-6. | MUST | TARGET (values: OWNER DECISION REQUIRED) | S+D |
| ADMIN-18 | Credential issuance follows O-2: Nest may issue staff and device credentials during the transition; Go Core verifies every credential at transactional boundaries and enforces roles and venue access; issuance moves to Core `identity` before the overlap ends. | MUST | TRANSITIONAL (decided, O-2) | A (O-2) |
| ADMIN-19 | Go Core enforces staff venue scope from the verified credential on every staff route and realtime subscription before production (the gap named in O-2). | MUST | TARGET | S (O-2, §16.3) |
| ADMIN-20 | Multi-factor authentication for owner, admin or other roles, and its methods, is decided by DEC-ADMIN-3; if required, it is enforced server-side at sign-in and at step-up. | SHOULD | TARGET CAPABILITY — FUTURE DELIVERY; policy DEC-ADMIN-3 (P2) | V(09 §3.2)+K(L550)+D |
| ADMIN-21 | Offboarding is deactivation of the staff account (ADMIN-15). Employment records and their lifecycle belong to volume 06; the link between an employment record and a staff account (WFM-34 to WFM-37) never makes HR data an authentication source. | MUST | TARGET (link TARGET CAPABILITY — FUTURE DELIVERY; automation DEC-X-12) | S (STF-1) + V(09 WF-A3) |

### 09.5.3 Roles, permissions, step-up and separation of duties

| ID | Requirement | Priority | State | Basis |
|---|---|---|---|---|
| ADMIN-22 | Authorization is composed of the account's role permissions and venue grants and enforced server-side per request and per realtime subscription (INV-4). Current roles are owner, admin, manager, cashier, kitchen and viewer; additional or custom roles are DEC-X-2 and DEC-ADMIN-2. | MUST | CURRENT (Nest) / TARGET (Core) | S |
| ADMIN-23 | No self-escalation: an administrator cannot grant a role, permission or venue grant they do not themselves hold, and cannot change their own role or grants. | MUST | TARGET | V(09 §6 hard rules)+E |
| ADMIN-24 | An organization always has at least one active owner: demoting, deactivating or removing the last active owner is refused with a stable error. | MUST | TARGET | E |
| ADMIN-25 | Every grant, role change and venue-grant change is audited with before and after (§16.13). | MUST | CURRENT (Nest audit) / TARGET | S |
| ADMIN-26 | An effective-access view shows, for a staff account, its role, venue grants, effective permissions, active sessions and staff PIN status (set or not set, never the value). | SHOULD | TARGET | E |
| ADMIN-27 | Privileged administrative actions (catalogue DEC-ADMIN-4; at minimum owner and admin grants, credential resets, device enrolment and revocation, payment adapter credential rotation, audit export, support-access authorization, effective-dated tax or routing changes) require a step-up re-verification of the acting staff member within the same session (mechanism DEC-ADMIN-5). | MUST | TARGET (catalogue: OWNER DECISION REQUIRED) | S+E (INV-4) |
| ADMIN-28 | Separation of duties is a configurable mechanism: an SoD rule names the initiating and approving actions and a condition; when it applies, the approving actor must differ from the initiating actor; enforcement is at action time on the server; overrides are not available. Rule values are DEC-X-7 (financial) and DEC-ADMIN-4 (administrative). | MUST (mechanism) | TARGET | S+E (INV-4, DEC-X-7) |
| ADMIN-29 | Destructive administrative actions require explicit confirmation naming the object and consequence, capture a reason, and state when they are irreversible (device revocation and terminal disable are final per D8). Referenced master data is deactivated, not deleted (INV-11). | MUST | TARGET | S (§22) + E |
| ADMIN-30 | Administrative create and enrol commands carry an idempotency key; a replay returns the original result and never re-issues a secret (D8 behaviour). | MUST | TARGET (implemented in Core for D8) | S (INV-12) |
| ADMIN-31 | The tablet manager step-up (DL-081) records both the acting staff identity and the approving manager identity on every action it authorizes. | MUST | TRANSITIONAL (Nest) | S (DL-081, INV-5) |

### 09.5.4 Devices, terminals, Venue Edge and printers

| ID | Requirement | Priority | State | Basis |
|---|---|---|---|---|
| ADMIN-32 | Devices are enrolled, listed, rotated and revoked through the Core device registry (D8; `contracts/openapi/devices.yaml`), with the D8 invariants of 09.4.5. Device administration accepts only a staff login session of an authorized role (current: owner, admin, manager) and refuses tablet, KDS and device credentials. | MUST | TARGET (implemented in Core, not in production) | S (§16.6, D8) |
| ADMIN-33 | Revoking or rotating a device credential takes effect on the device's next request and closes its live realtime connections (§16.5). Closure is triggered by the revocation itself (push-close), not by a periodic timer; periodic revalidation is only a safety net. The current Core realtime re-check every 60 s is a CURRENT deficiency against this target, not a permitted delay. The closure mechanism is DEC-ADMIN-22. | MUST | TARGET | S |
| ADMIN-34 | New device kinds (Waiter Tablet distinct from `order_tablet`, kiosk, window display, Venue Edge) are added additively when their applications need an identity; kind naming follows O-21. A device kind never grants staff authority (INV-3, WT-4). | MUST | TARGET | S (D8, §33, O-21) |
| ADMIN-35 | Terminals are created, disabled (final), and bound to or unbound from a `pos_terminal` device of the same venue (D8); cashiers may read terminals. Windows POS behaviour at a terminal is not defined here (SPRD §12). | MUST | TARGET (implemented in Core, not in production) | S (D8) |
| ADMIN-36 | The device registry shows, per device, kind, venue, status, created and revoked by, last credential rotation, and, where the application reports them, last seen time and application version. | SHOULD | TARGET | S (row AG, row T) |
| ADMIN-37 | Payment adapter devices are administered as D8 `payment_adapter` devices, one per venue. No administrative function records, alters or overrides a card payment result; card success comes only from the trusted adapter (CARD3, PAY-3). | MUST | TARGET | S (ADR 0002, INV-19) |
| ADMIN-38 | The web tablet enrollment (`TabletEnrollment`, `TabletDevice`) and the KDS venue PIN remain TRANSITIONAL; no new capability is added to them (DL-105 ownership rule). In production the KDS venue PIN refuses the checked-in insecure default (DL-081). KDS device authentication is decided by O-13. | MUST | TRANSITIONAL | S (DL-081, O-13, §33) |
| ADMIN-39 | No administrative setting can grant Guest Mode staff authority or let a guest enter Staff Mode (WT-4, WT-5). | MUST | TARGET | S |
| ADMIN-40 | A Venue Edge installation is paired using a single-use, expiring pairing secret issued by an authorized administrator, receives a revocable venue-bound identity (EDGE-2), and can be revoked; revocation stops new commands and reports and preserves history. | MUST | TARGET (mechanism approved 2026-10-05: DEC-ADMIN-12) | S (EDGE-2) + V(09 WF-A5A) |
| ADMIN-41 | The Venue Edge administration view shows heartbeat, versions, queue depth and oldest queued age (EDGE-3), last successful hardware operation per device class, and version-compatibility state. | MUST | TARGET | S (EDGE-3, row T) |
| ADMIN-42 | Remote administration of Venue Edge is limited to declared configuration and declared diagnostic commands, each authorized and audited; it never provides remote desktop or arbitrary code execution. | MUST | TARGET | V(09 §3.7)+E |
| ADMIN-43 | Printer administration satisfies ADM-2 and PRT-1 to PRT-3: printer role, connection and paper width are validated; test prints, retries and reprints are attributed and audited; job states shown are those reported by the print path, never assumed (PR-4). | MUST | TRANSITIONAL (Nest configuration) → TARGET (Venue Edge; DEC-ADMIN-20) | S |

### 09.5.5 Menu, media and integrations

| ID | Requirement | Priority | State | Basis |
|---|---|---|---|---|
| ADMIN-44 | Menu administration (MENU-1 to MENU-6, AVL-1) is performed only in the Admin Console under server-side permissions; its semantics, channels and availability behaviour are defined in volume 02. Changes are audited (§16.13) and, where DEC-ADMIN-9 designates, effective-dated. | MUST | TRANSITIONAL (Nest) → TARGET | S |
| ADMIN-45 | Media administration follows MENU-3 (content-type validation, size limit default 10 MB, conversion SHOULD); files are stored in GCS (NFR-DATA), access-controlled by organization and venue, and a removed image does not alter historical order snapshots. Media ownership in Core is O-8. | MUST | CURRENT (Nest `MediaAsset`) | S |
| ADMIN-46 | An integration registry lists each configured adapter connection (for example payment adapter, email provider) with scope, status, last success, last failure and credential age. Secrets are referenced, never displayed after creation (§16.7, row R). | SHOULD | TARGET (payment adapter); TARGET CAPABILITY — FUTURE DELIVERY (others; ADMIN-64) | S+E (INV-19)+K(L339–342, L424–448) |
| ADMIN-47 | Rotating an integration credential issues a new credential and invalidates the old one per D8 semantics; an overlap window for providers that need one is DEC-ADMIN-13. | MUST | TARGET | S (§16.5) |
| ADMIN-48 | Legacy external-POS connector administration in Nest and the Admin Console receives no new capability, is restricted to owner and admin, stays audited, and retires per SPRD §34.2 (sequence DEC-ADMIN-18). | MUST | TRANSITIONAL | S (§34.2, DL-116) |
| ADMIN-49 | Third-party API keys and outbound webhooks (inclusion resolved, DEC-ADMIN-14; delivery DEC-X-17): keys belong to a service identity (INV-3) with least-privilege scopes and venue binding; webhook deliveries are signed, retried with bounded backoff, paused after sustained failure with notification to administrators, and never silently dropped. | MAY | TARGET CAPABILITY — FUTURE DELIVERY (inclusion resolved by DEC-X-1; marketplace DEC-ADMIN-24) | V(09 §3.8)+K(L8, L103, L156, L360–369) |

### 09.5.6 Audit, support, monitoring and recovery

| ID | Requirement | Priority | State | Basis |
|---|---|---|---|---|
| ADMIN-50 | Audit search filters by actor, entity, action, date range (NFR-AUD), venue and correlation id, and shows before and after values; results are scoped to the searcher's organization and venues (INV-2). | MUST | TARGET | S (NFR-AUD) |
| ADMIN-51 | No administrative function modifies or deletes an audit record. Audit retention is at least 90 days (NFR-AUD); longer retention and tamper evidence are DEC-ADMIN-15 and DEC-X-6. | MUST | CURRENT (Nest append-only) / TARGET | S |
| ADMIN-52 | Audit export produces a filtered extract; the export itself is a privileged action, audited with its filter and requester; personal data in the extract follows the requester's permissions. Format and integrity signing are DEC-ADMIN-15. | SHOULD | TARGET | V(09 §3.5)+S |
| ADMIN-53 | Support access by a Servvia platform operator to a customer organization is explicitly authorized, scoped, time-bounded, performed under the operator's own identity (never by using customer staff credentials), audited per action, and visible to the organization's owners and admins while active. | MUST | TARGET (enablement model: DEC-ADMIN-7) | S (row AG) + V(09 §3.11) |
| ADMIN-54 | A monitoring view shows liveness and readiness, worker backlog (depth, oldest pending age), dead letters, realtime subscriber and slow-consumer counts, Venue Edge heartbeat, notification delivery failures and API error rates: organization-scoped for customer administrators, platform-level for platform operators (§20.4). | MUST | TARGET | S (§18.11, §20.3–20.5) |
| ADMIN-55 | Dead-lettered work can be retried or discarded by an authorized operator (§18.5); retry is idempotent; discard requires a reason; both are audited and the originating exception resolves accordingly (volume 01). | MUST | TARGET | S (§18.5) |
| ADMIN-56 | A read-only recovery-posture view shows the last successful backup time, backup retention (30 days, row P), the last restore rehearsal date and result, and the declared RPO and RTO once set (DEC-X-9). | SHOULD | TARGET | S (row O, row P) |
| ADMIN-57 | Restore is an operational procedure run under a runbook (row AF), not a self-service function. A restore request is recorded with scope, requester, authorizer and outcome and is audited; tenant-scoped restore feasibility is DEC-ADMIN-23. | MUST | TARGET | S (row AF) + V(09 §3.10) |

### 09.5.7 Daily email, data requests and deferred identity

| ID | Requirement | Priority | State | Basis |
|---|---|---|---|---|
| ADMIN-58 | Daily-email settings (ADM-3) are administered in the Admin Console only (WEB-3): recipient addresses validated, schedule expressed in the venue time zone, manual send attributed; the send result (delivered to the provider, failed) is shown truthfully. | MUST | TARGET | S (ADM-3, WEB-3, PR-4) |
| ADMIN-59 | Personal-data export and erasure requests are recorded, identity-verified, authorized, executed and audited through the DataRequest lifecycle (09.4.9); erasure preserves financial integrity (INV-11). Obligations, deadlines and scope are DEC-X-4 and DEC-X-5. | SHOULD | TARGET CAPABILITY — FUTURE DELIVERY; policy P4/P5 (DEC-X-4, DEC-X-5, DEC-ADMIN-16) | D+E+K(L244, L459–465) |
| ADMIN-60 | Enterprise SSO and SCIM provisioning are deferred (SPRD §13, DEC-X-12). Until decided, Servvia named local accounts are the sole staff identity source. | MUST | DEFERRED | S |
| ADMIN-61 | Periodic access reviews, expiring object-level permission overrides and venue cloning from a template are not committed. | MAY | FUTURE | V(09 §3.3–3.4, WF-A8) |

### 09.5.8 Owner-approved target capabilities (KitchenOS, 2026-10-05)

These capabilities are owner-approved for Servvia's long-term product (DEC-X-1) and are not in committed current delivery scope; their phase is DEC-X-17. None is implemented. Windows POS behaviour is not defined by any of them (SPRD §12).

| ID | Requirement | Priority | State | Basis |
|---|---|---|---|---|
| ADMIN-62 | **Venue operating profiles.** An authorized administrator assigns each venue an operating profile (dine-in, QSR/takeaway or hybrid). A profile is a named, versioned bundle of capability settings under the approved DEC-ADMIN-10 mechanism (for example table service and visits, counter and walk-in takeaway ordering, kiosk ordering, queue display, courses, delivery channels); individual settings remain overridable per venue with audit (INV-17), and the server enforces the effective capability set, never the profile label or UI hiding. Changing a venue's profile or a profile's contents is a privileged, audited configuration change that previews the affected capabilities and venues (ADMIN-9) and is effective-dated where DEC-ADMIN-9 applies. A capability disabled by the change refuses new commands with a stable error; records created under the previous profile are never altered or invalidated. Which capabilities each profile enables by default is venue configuration; volume 02 consumes the effective capability set. Profiles never define Windows POS behaviour (frozen, SPRD §12). | SHOULD | TARGET CAPABILITY — FUTURE DELIVERY (mechanism DEC-ADMIN-10 approved) | K(L13–29, L187)+A (DEC-ADMIN-10)+E (INV-17) |
| ADMIN-63 | **Franchise and group operation.** Group administrators can define configuration once at the organization level (or at an intermediate level once DEC-ADMIN-1 decides one) and roll it out to selected venues (ConfigurationRollout, 09.4.10). Venue overrides remain explicit and audited (INV-17) unless the higher level designates a setting as locked; a locked setting cannot be overridden by a venue-scoped administrator. Group-scoped administration roles act only within their granted venues (INV-2, INV-4); role defaults are DEC-X-2 and DEC-ADMIN-2. A rollout previews the affected venues (ADMIN-9), applies per venue, and reports each venue's outcome; a refused venue never counts as applied and never blocks other venues silently. No legal-entity, franchisor/franchisee or royalty structure is assumed: whether a franchise network is one organization with intermediate levels or several organizations with a defined relationship is DEC-ADMIN-1 (inclusion resolved), and until decided no cross-organization access exists (INV-2). Cross-location reporting belongs to volume 08. | SHOULD | TARGET CAPABILITY — FUTURE DELIVERY; hierarchy levels DEC-ADMIN-1 | K(L52, L343–346, L603–604)+E (INV-17) |
| ADMIN-64 | **Integration framework administration.** Owners and admins (DEC-ADMIN-2) connect, scope (organization or venue), test, pause and disconnect adapter connections for delivery marketplaces, accounting systems, payment providers and communications providers through the integration registry (ADMIN-46). Each connection authenticates as a service identity (DEC-ADMIN-21) whose secret is referenced, shown once and rotatable (ADMIN-47); connect, scope change, credential rotation and disconnect are privileged, audited actions (ADMIN-27). Per connection the registry shows health (last success, last failure and error class), pending, failed and dead-lettered exchanges, and reconciliation status (matched, mismatched, awaiting); a failure raises a Home exception (volume 01) and is never reported as success (INV-14). Disconnecting stops new exchanges, keeps in-flight and failed items visible for reconciliation, and deletes no record received through the connection. Adapter facts never overwrite Core canonical state except trusted payment results through the payment adapter (INV-19); the CARD3 boundary and the D8 `payment_adapter` model (ADMIN-37) are unchanged. Provider choice is an adapter choice; no provider is required by this requirement. | SHOULD | TARGET (payment adapter, CARD3); TARGET CAPABILITY — FUTURE DELIVERY (other providers) | K(L100, L339–342, L424–448)+S (INV-19, ADR 0002) |
| ADMIN-65 | **External API sandbox and developer documentation.** When the external API platform (ADMIN-49, 00.7) is delivered, it provides a sandbox environment isolated from production: sandbox credentials never authorize production data or operations and production credentials are refused by the sandbox; sandbox data is synthetic or explicitly created there, never copied production personal or financial data. Developer documentation is generated from the versioned contracts in `contracts/` (OpenAPI, events), states versioning and deprecation, error codes (INV-16), idempotency (INV-12), rate limits per tenant (values: OWNER TARGET REQUIRED, DEC-X-8) and webhook signing. A public marketplace, partner certification or developer programme is not part of this requirement (DEC-ADMIN-24, DEC-X-18). | MAY | TARGET CAPABILITY — FUTURE DELIVERY; marketplace DEC-ADMIN-24 | K(L8, L103, L156, L360–369) |
| ADMIN-66 | **IP allowlisting.** An organization owner may enable an optional network restriction that limits Admin Console and administrative API access to configured address ranges. The policy is organization configuration, validated, versioned and audited (INV-17); enabling or changing it is a privileged action (ADMIN-27) that warns and requires explicit confirmation when the acting session's own address would be excluded. A refused request returns a stable error and is counted in monitoring; device, guest and service identities are not governed by it unless separately designated. Recovery from a lock-out follows the governed break-glass procedure (DEC-ADMIN-8); there is no in-product bypass. Whether organizations enable it, and with which ranges, is organization configuration. | MAY | TARGET CAPABILITY — FUTURE DELIVERY | K(L552)+E |
| ADMIN-67 | **Encryption at rest.** Canonical data stores, backups and administrative and reporting exports are encrypted at rest, with keys held in externally managed key storage (row R), never in source control, configuration files or logs. Keys are rotatable without data loss or service interruption, and rotation and key access are audited; the rotation cadence is owner policy (OWNER TARGET REQUIRED; P5). The KitchenOS term "end-to-end encryption" is satisfied in Servvia by TLS 1.2 or higher in transit (NFR-SEC-2) plus encryption at rest; no client-to-client end-to-end encryption is implied. Venue Edge encrypted local storage stays under EDGE-2. Customer-managed keys remain FUTURE (09.14). | SHOULD | TARGET CAPABILITY — FUTURE DELIVERY | K(L540–541)+S (NFR-SEC-2, EDGE-2, row R) |
| ADMIN-68 | **Point-in-time recovery.** The canonical PostgreSQL database supports recovery to a chosen point in time within the declared recovery window, in addition to daily backups retained 30 days (row P). Recovery follows ADMIN-57 and DEC-ADMIN-23: restore into an isolated environment, verify, then correct tenant data through audited Core compensating changes; no in-place partial restore of the shared database. The recovery window, RPO and RTO are DEC-X-9 (P7); point-in-time recovery is rehearsed under the restore runbook (row AF) and the last rehearsal and the available recovery window are shown in the recovery-posture view (ADMIN-56). It does not imply "zero data loss" (00.6). | SHOULD | TARGET CAPABILITY — FUTURE DELIVERY; RPO/RTO DEC-X-9 (P7) | K(L495)+S (rows O, P, AF) |
| ADMIN-69 | **Guided onboarding.** Authorized administrators set up an organization and its venues through a guided sequence (organization settings, venues and VEN-1 settings, operating profile, tables, menu, tax and jurisdiction packs, devices, printers, staff and grants) built on the ordinary administrative commands, so every step is validated, idempotent and audited exactly as when done directly (ADMIN-2, ADMIN-30). Readiness checks list, per venue, each missing or invalid configuration that would prevent a capability from working, and venue activation (ADMIN-4) is refused while a check designated blocking fails, naming the check. Progress can be left and resumed without partial configuration being applied. Self-service tenant sign-up is not part of this requirement (DEC-X-18); the first owner is still created by the governed bootstrap (ADMIN-12). | SHOULD | TARGET CAPABILITY — FUTURE DELIVERY; self-service sign-up DEC-X-18 | K(L294, L556–560)+S (SPRD §1) |
| ADMIN-70 | **Contextual help and role-specific guidance.** The Admin Console and device applications provide help in context of the current screen and role (for example what a setting does, its effective origin and its consequences), and role-specific guidance for administrators, managers, kitchen, front-of-house and other staff. Help content never exposes data or actions beyond the viewer's permissions and never replaces server-side validation. Delivery channels (video, live chat, forums, training content) are product choices, not requirements. User documentation per role is a release-readiness item (00.8). | MAY | TARGET CAPABILITY — FUTURE DELIVERY | K(L558–568)+S (00.8) |
| ADMIN-71 | **Jurisdiction-pack administration.** Authorized administrators view available jurisdiction packs (tax, payroll, compliance record formats, receipt and invoice content, locale) and activate a pack version for an organization or venue through the JurisdictionPackActivation lifecycle (09.4.11), effective-dated (DEC-ADMIN-9) and audited as a privileged action (ADMIN-27). A regulatory pack cannot be activated without its recorded validation evidence (P5); an unvalidated pack is shown as unavailable, and the product never states that a jurisdiction is supported or compliant on the strength of configuration alone (INV-22, 00.6). Records keep the pack version in force at their own time; changing packs never rewrites history. The currently implemented NZ GST tax profile is managed through the same registry when it is delivered. | SHOULD | TARGET CAPABILITY — FUTURE DELIVERY; regulatory activation gated on P5 | K(L243, L452–472)+E (INV-22) |

## 09.6 Workflows and failure paths

**WF-ADMIN-1 Onboard a venue.** An owner or admin creates the venue (status `onboarding`, ADMIN-4), completes VEN-1 settings (ADMIN-3), tables (TBL-1), menu overrides (MENU-4), printers (ADMIN-43), devices (ADMIN-32) and staff grants, then activates. Validation failures refuse the step with field errors; nothing is half-applied. Duplicate submission with the same idempotency key returns the original venue (ADMIN-30).

**WF-ADMIN-2 Grant access.** An administrator selects a staff account, role and venue grants. The server refuses any grant beyond the administrator's own (ADMIN-23) and any change that would leave no active owner (ADMIN-24). Privileged grants require step-up (ADMIN-27). The change is audited (ADMIN-25) and effective on the next request and on live connections (ADMIN-15). Concurrent edits conflict on version (ADMIN-8).

**WF-ADMIN-3 Offboard a person.** An administrator deactivates the account (step-up for owner or admin accounts). All sessions, tablet elevations and realtime connections end (ADMIN-15); the grant snapshot is audited. Devices the person enrolled are unaffected (device identity is not personal). If the person was the last owner, deactivation is refused until another owner exists.

**WF-ADMIN-4 Credential reset.** Reset issues a one-time path for the holder to set a new credential (ADMIN-13), revokes existing sessions and is audited. A staff PIN reset clears the PIN and requires a new one to be set by an authorized administrator (ADMIN-14).

**WF-ADMIN-5 Lost or stolen device.** A manager revokes the device (ADMIN-32, final, confirmation per ADMIN-29). The device's next request and its realtime connection are refused (ADMIN-33). Orders already accepted by Core are unaffected. Re-enrolling the replacement issues a new device record and credential. For a web tablet still on Nest, the transitional revocation applies (ADMIN-38).

**WF-ADMIN-6 Rotate a payment adapter credential.** An owner or admin rotates the venue's `payment_adapter` credential with step-up (ADMIN-27, ADMIN-47). The new credential is shown once and installed on the adapter host; the old one stops at once. **Failure path:** if the new credential is not installed, card results are refused and appear as uncertain or failed payments for reconciliation (PAY-6); the administrator sees the adapter's authentication failures in monitoring (ADMIN-54). No manual card success is possible (ADMIN-37).

**WF-ADMIN-7 Pair Venue Edge.** An administrator issues a pairing secret (single-use, expiring), the installer enters it on the Edge host, the Edge establishes outbound authenticated communication and receives its venue-bound identity (ADMIN-40). Go-live checks are heartbeat, durable-queue restart, idempotent replay after reconnect, and a controlled print or payment round trip on venue hardware (EDGE-3, PRT-3). **Failure paths:** expired or reused pairing secret is refused; missed heartbeat moves the installation to `degraded` then `offline` and raises a Home exception (volume 01); an incompatible version disables only the affected capability and is shown, never guessed.

**WF-ADMIN-8 Effective-dated configuration change.** An administrator prepares a change with `effectiveFrom` (ADMIN-7), sees affected objects (ADMIN-9), confirms with step-up where privileged. The scheduler activates it at the effective time as a `system` action. **Failure path:** if the scheduler is unavailable at the effective time, the change is activated on recovery and the gap is shown; transactions in the gap used the previous version, which is recorded on them.

**WF-ADMIN-9 Handle a dead letter.** An authorized operator opens the dead letter from monitoring or Home, inspects the safe summary and correlation id, then retries (idempotent) or discards with a reason (ADMIN-55). Repeated failure returns it to the dead-letter state with an incremented attempt count.

**WF-ADMIN-10 Support session.** A platform operator requests access with scope and reason; it is authorized per DEC-ADMIN-7; while active, a banner is visible to the organization's owners and admins and every action is audited under the operator's identity (ADMIN-53). Expiry ends access immediately, including live connections.

**WF-ADMIN-11 Audit investigation and export.** An owner searches by correlation id to reconstruct a sequence (ADMIN-50), then exports a filtered extract with step-up (ADMIN-52); the export is audited.

**WF-ADMIN-12 Restore request.** A restore is requested with scope and reason, authorized by an owner, executed by operations under the restore runbook, verified, and closed with outcome (ADMIN-57). Committed financial records restored from backup are reconciled before service resumes (§17.10).

**WF-ADMIN-13 Owner recovery.** If all owners are locked out, recovery follows the governed procedure of DEC-ADMIN-8 (operator-run, identity-verified, audited, visible to the organization afterward); no in-product path bypasses it.

The following workflows describe TARGET CAPABILITY — FUTURE DELIVERY items (09.5.8).

**WF-ADMIN-14 Cross-location configuration rollout.** A group administrator prepares a configuration version at the organization level (ADMIN-63), selects target venues, previews affected venues and objects (ADMIN-9), and confirms with step-up where privileged. Each venue's version is validated and applied independently and audited. **Failure paths:** a venue whose override conflicts with a locked setting, or whose validation fails, is `refused` with the reason; the rollout ends `completed_with_failures` and lists the venues to fix; a venue outside the administrator's grants is refused, never silently skipped; a scheduler outage defers effective-dated activation as in WF-ADMIN-8.

**WF-ADMIN-15 Connect and disconnect an integration.** An owner or admin selects a provider adapter, sets scope, creates the service identity (secret shown once), runs a connection test and activates (ADMIN-64), all with step-up and audit. **Failure paths:** a failed test leaves the connection inactive with the error class shown; sustained exchange failure pauses the connection, raises a Home exception and leaves items in reconciliation; disconnect stops new exchanges and keeps every received record and open reconciliation item.

**WF-ADMIN-16 Change the IP allowlist.** An owner edits the allowlist (ADMIN-66) with step-up; if the acting session's address would be excluded the change requires explicit confirmation. **Failure path:** if all administrators are locked out, recovery follows DEC-ADMIN-8 (WF-ADMIN-13).

**WF-ADMIN-17 Activate a jurisdiction pack.** An administrator selects a pack version, attaches or confirms its validation evidence, sets scope and effective date, and activates with step-up (ADMIN-71). **Failure path:** a regulatory pack without validation evidence is refused and stays unavailable; the venue keeps its current pack.

## 09.7 Security, authorization and audit

**Authorization matrix.** Per-role defaults beyond current evidence are policy (INV-20, DEC-ADMIN-2). "Current" states verified enforcement; "Target rule" states the mechanism every role assignment must respect.

| Capability | Current evidence | Target rule | Step-up | Audit |
|---|---|---|---|---|
| Organization settings | Nest (role rule not re-verified here) | Owner, admin | Yes (DEC-ADMIN-4) | Yes |
| Venue create, settings, status | Nest (role rule not re-verified here) | Owner, admin; manager for settings of granted venues if DEC-ADMIN-2 allows | Status changes yes | Yes |
| Staff accounts, roles, grants | Nest (role rule not re-verified here) | No self-escalation (ADMIN-23); last-owner protection (ADMIN-24) | Owner and admin grants yes | Yes |
| Staff PIN set or reset | Nest `POST /api/admin/staff/:id/tablet-pin` (admin, manager; DL-081) | Same, within venue grants | DEC-ADMIN-4 | Yes |
| Device enrol, rotate, revoke | Core D8 (owner, admin, manager; staff login session only) | Same | Payment adapter yes | Yes (D8 audit codes) |
| Terminal administration | Core D8 (owner, admin, manager manage; cashier read) | Same | No | Yes |
| Web tablet enrollment | Nest (owner, admin, manager; staff session only) | TRANSITIONAL | — | Yes |
| Printer administration | Nest (role rule not re-verified here) | Owner, admin, manager | No | Yes (reprints attributed, PRT-1) |
| Menu and media | Nest (role rule not re-verified here) | Per volume 02 | No | Yes |
| Integration credentials | Core D8 for payment adapter | Owner, admin | Yes | Yes |
| Audit search | Nest audit records (search surface not re-verified here) | Owner, admin (others DEC-ADMIN-2) | No | Searches by support operators audited |
| Audit export | — | Owner, admin | Yes | Yes |
| Monitoring, dead-letter actions | Core worker backlog (organization-scoped) | Owner, admin; platform operator | Discard yes | Yes |
| Support access authorization | — | Owner (DEC-ADMIN-7) | Yes | Yes |
| Daily-email settings | Nest (location and role rule not re-verified here) | Owner, admin, manager (DEC-ADMIN-2) | No | Yes |
| Operating profiles (ADMIN-62; future delivery) | — | Owner, admin (DEC-ADMIN-2) | Yes (affects live service) | Yes |
| Group configuration and rollout (ADMIN-63; future delivery) | — | Group-scoped administrators within their grants; locked settings at the higher level only | Where privileged | Yes, per venue |
| Integration connections (ADMIN-64; future delivery beyond payment adapter) | Core D8 for payment adapter | Owner, admin | Yes | Yes |
| External API keys and sandbox credentials (ADMIN-49, ADMIN-65; future delivery) | — | Owner, admin | Yes | Yes |
| IP allowlist (ADMIN-66; future delivery) | — | Owner | Yes | Yes |
| Jurisdiction-pack activation (ADMIN-71; future delivery) | — | Owner, admin (DEC-ADMIN-2) | Yes | Yes |

**Controls.**
- Deny by default; server-side on every route and subscription (§16.2). Device and tablet credentials never reach administration routes (D8, DL-081).
- Scope from the verified credential only (§16.3, ADMIN-19). Cross-organization administration does not exist except platform operators under support access (ADMIN-53).
- Secrets: device and integration credentials are shown once and never logged (§16.7, D8); staff PINs and passwords are never retrievable.
- Revocation on live connections: SPRD §16.5 requires immediate effect. The current Core realtime contract re-checks tablet and device credentials periodically; the acceptable latency or a push-close on revocation is DEC-ADMIN-22.
- Rate limiting on sign-in (NFR-SEC-2), PIN verification and pairing-secret redemption (§16.10).
- Audit (INV-15, §16.13): authentication events, permission and grant changes, device enrolment, rotation and revocation, configuration changes, support access, audit export, dead-letter actions, restore requests, data requests. D8 audit codes (`DEVICE_ENROLLED`, `DEVICE_REVOKED`, `DEVICE_CREDENTIAL_ROTATED`, `TERMINAL_*`) are current Core behaviour.

## 09.8 Data governance

| Data | Class (INV-18) | Owner | Retention |
|---|---|---|---|
| Organization and venue settings | Internal | Core `organizations`, `venues` | Life of the organization; versions per DEC-ADMIN-9 |
| Staff account profile (name, email, role, grants) | Personal (employee) | Core `identity` | DEC-X-4 after deactivation |
| Password and PIN hashes | Secret-derived (verifiers only) | Core `identity` | Deleted or invalidated on deactivation per DEC-X-4; never exported |
| Device and integration credential digests | Secret-derived (verifiers only) | Core `devices` | Life of the device record |
| Session records | Internal; Personal where they include network metadata | Core `identity` | DEC-ADMIN-6 |
| Audit records | Internal; Personal where they name people | Core `audit` | At least 90 days (NFR-AUD); longer DEC-ADMIN-15 |
| Support access records | Internal | Core | As audit |
| Data requests | Personal | DEC-X-13 | DEC-X-4 |
| Integration exchange and reconciliation records (ADMIN-64; future delivery) | Internal; Financial or Personal per payload | Core adapters | DEC-X-4 for personal data; financial records per INV-11 |
| Network access policy (ADMIN-66; future delivery) | Internal | Core `identity` | Life of the organization; versions per INV-17 |

- Corrections: configuration is corrected by a new version; grants by a new grant change; audit is never corrected (a mistaken action is reversed by a further audited action).
- Exports from administration (audit, access listings) are privileged and audited and include personal data only within the exporter's permission.
- Deactivated staff accounts remain referenced by history (orders, audit, shifts); erasure, if required by DEC-X-4, replaces personal fields with a stable pseudonym and keeps the identifier.

## 09.9 Reliability, scalability and observability

- Administrative changes are single transactions with their audit record and domain event (INV-13, Part B row K); a failure leaves no partial configuration.
- Revocation paths (account, device, Edge, support grant) are tested under live realtime connections and concurrent requests.
- Scheduled configuration activation, retention jobs and email sends run as Core workers with visible failures and dead letters (§18.5).
- Capacity dimensions (staff accounts, devices and Edge installations per venue, venues per organization, audit volume) are DEC-X-8; no number is set here.
- Admin Console initial load under 2 s on 10 Mbps applies (NFR-PERF; O-19). Audit search latency target: OWNER TARGET REQUIRED (DEC-ADMIN-15).
- Signals (§20): sign-in failures and lockouts; step-up failures; grant changes per day; device revocations and authentication failures by kind; Edge heartbeat age per venue; pairing failures; dead-letter count and oldest age; support sessions active; audit write failures (a failed audit write fails the mutation, Part B row K). Alert thresholds: §20.7 OWNER TARGET REQUIRED.
- Additional signals once the 09.5.8 capabilities are delivered: allowlist refusals per organization; integration connection failures, paused connections and reconciliation backlog per connection; rollout outcomes with refused venues; encryption-key rotation and key-access events; age of the last point-in-time recovery rehearsal; jurisdiction-pack activations and refusals.

## 09.10 UX and accessibility

- WCAG 2.1 AA including screen-reader support (NFR-A11Y). All §22 states, with explicit confirmation for destructive and privileged actions (ADMIN-29) and step-up prompts that name the action being authorized.
- One-time secrets (device and integration credentials, pairing secrets) are shown once with a clear statement that they cannot be shown again, a copy control, and no automatic logging or screenshots by the application.
- Effective configuration shows its origin (default, organization, venue) and pending scheduled changes with their effective time in the venue time zone.
- Irreversible states (revoked device, disabled terminal, closed venue) are labelled as final; actions that cannot apply are absent with an explanation, not merely disabled.
- Support-access banner is persistent and announced to assistive technology while active.

## 09.11 Acceptance criteria

| ID | Scenario | Expected result |
|---|---|---|
| AC-ADMIN-1 | Happy path: an admin onboards venue B through administration only | Venue B is created, configured and activated with no deployment; every step is audited |
| AC-ADMIN-2 | Invalid configuration: VEN-1 time zone "Mars/Base" | Refused with a field-level stable error; no change applied; no audit record of a change |
| AC-ADMIN-3 | Inheritance: organization default exists and venue B overrides it; override removed | Effective value shows its origin at each step; after removal venue B uses the organization value; both changes versioned |
| AC-ADMIN-4 | Effective dating: a routing change scheduled for 05:00 venue time | Tickets submitted before 05:00 route by the old version, after by the new; activation audited as `system` |
| AC-ADMIN-5 | Concurrency: two admins edit the same setting from the same version | One succeeds; the other receives a version conflict and the current value |
| AC-ADMIN-6 | Self-escalation: a manager attempts to grant themselves or another user the owner role | Refused; no change; attempt recorded in audit as refused where security-sensitive |
| AC-ADMIN-7 | Last owner: the only active owner is demoted or deactivated | Refused with a stable error |
| AC-ADMIN-8 | Deactivation: an active manager with an open admin session, a tablet elevation and a realtime connection is deactivated | Next request refused on every surface; realtime connection closed as a consequence of the revocation event (not by the periodic re-check); closure latency is measured and reported; audit holds the grant snapshot |
| AC-ADMIN-9 | Credential reset | Existing credential never shown; existing sessions revoked; holder must set a new credential; audited |
| AC-ADMIN-10 | Staff PIN equal to the account's password | Refused at set time (DL-081) |
| AC-ADMIN-11 | Step-up missing: an admin attempts a catalogued privileged action without step-up | Refused with a stable step-up-required error; after successful step-up the action completes and both are audited |
| AC-ADMIN-12 | SoD: the same staff member initiates and approves an action covered by an enabled SoD rule | Approval refused at action time; a different authorized approver succeeds |
| AC-ADMIN-13 | Device enrolment replay: the same request key is submitted twice | One device; the second response contains no credential |
| AC-ADMIN-14 | Device credential secrecy | Credential appears only in the enrolment or rotation response; absent from list, get, logs, audit and URLs (tested) |
| AC-ADMIN-15 | Device revoke under load: a revoked KDS device has an open realtime connection and an in-flight request | In-flight request completes or fails atomically; subsequent requests refused; connection closed as a consequence of the revocation event (not by the periodic re-check); closure latency is measured and reported |
| AC-ADMIN-16 | Wrong identity class: a tablet token or D8 device credential calls a device administration route | Refused; no change |
| AC-ADMIN-17 | Cross-venue: a manager with a grant to venue A enrols a device in venue B | Refused; Core venue scope from the credential (ADMIN-19) |
| AC-ADMIN-18 | Cross-organization: any administration request naming another organization's object | Refused as not found or forbidden per contract; no data leaked |
| AC-ADMIN-19 | Terminal binding: bind a `kds` device or another venue's `pos_terminal` device | Refused by the server and by the database constraint (D8) |
| AC-ADMIN-20 | Payment adapter rotation not installed | Adapter results are refused; payments surface as uncertain or failed for reconciliation; no administrator can mark a card payment successful |
| AC-ADMIN-21 | Venue Edge pairing secret reused or expired | Refused; no identity issued; attempt audited and rate-limited |
| AC-ADMIN-22 | Venue Edge heartbeat stops | Installation shows `degraded` then `offline` with last heartbeat time; a Home exception is raised (volume 01) |
| AC-ADMIN-23 | Printer test print to an unreachable printer | Job shows failed after retries per PRT-2 with error; never shown as printed |
| AC-ADMIN-24 | Dead letter retry and discard | Retry is idempotent (no duplicate effect); discard requires a reason; both audited; originating exception resolves |
| AC-ADMIN-25 | Audit search by correlation id | Returns every record of the sequence within the searcher's scope with before and after values |
| AC-ADMIN-26 | Audit immutability | No API or UI path edits or deletes an audit record (tested); retention at least 90 days |
| AC-ADMIN-27 | Audit export | Requires step-up; extract matches the filter; the export is itself audited |
| AC-ADMIN-28 | Support access | Without an active grant the operator is refused; with a grant the banner is visible to owners and admins; actions audited under the operator identity; expiry ends access immediately |
| AC-ADMIN-29 | Daily email manual send fails at the provider | Result shown as failed with a safe error; no "sent" message; audited |
| AC-ADMIN-30 | Legacy surface: a request for a new external-POS connector configuration | No such capability exists beyond the current transitional surface; access limited to owner and admin and audited |
| AC-ADMIN-31 | Observability: repeated device authentication failures for one venue | Visible per kind and venue in monitoring with correlation ids; no credentials in logs |
| AC-ADMIN-32 | Accessibility | Admin flows pass WCAG 2.1 AA audit, including step-up dialogs and one-time secret display |
| AC-ADMIN-33 | Operating profile (ADMIN-62): venue B changes from dine-in to a QSR/takeaway profile that disables table service | The change previews affected capabilities and requires step-up; afterwards a table-visit command for venue B is refused by the server with a stable error, while takeaway ordering succeeds; earlier visits and orders are unchanged; the change is versioned and audited |
| AC-ADMIN-34 | Group rollout (ADMIN-63): a setting is rolled out to venues A, B and C; C has a conflicting override of a setting that is not locked, and B fails validation | A is applied; B is refused with its validation error; C keeps its explicit override and is reported as such; the rollout ends `completed_with_failures`, never "complete"; a venue-scoped administrator of A cannot override a locked setting |
| AC-ADMIN-35 | Integration failure and disconnect (ADMIN-64): an accounting adapter's exchanges fail repeatedly, then it is disconnected | The registry shows last failure and error class; the connection is paused and a Home exception is raised; after disconnect no new exchanges occur, every received record and open reconciliation item remains, and both actions are audited; no Core canonical record was changed by the adapter |
| AC-ADMIN-36 | Sandbox isolation (ADMIN-65) | A sandbox credential calling a production endpoint and a production credential calling the sandbox are both refused; no production personal or financial data is present in the sandbox |
| AC-ADMIN-37 | MFA (ADMIN-20): policy requires a second factor for the owner role | An owner sign-in or step-up without the second factor is refused server-side; with it the sign-in succeeds; both are audited |
| AC-ADMIN-38 | IP allowlist (ADMIN-66): the allowlist is enabled and an admin signs in from an address outside it | Refused with a stable error, counted in monitoring and audited; a change that would exclude the acting owner's own address requires explicit confirmation; lock-out recovery is only through DEC-ADMIN-8 |
| AC-ADMIN-39 | Encryption at rest (ADMIN-67) | Database storage, backups and exports are verified encrypted at rest; a key rotation completes without data loss or service interruption and is audited; no key material appears in logs or configuration files |
| AC-ADMIN-40 | Point-in-time recovery (ADMIN-68): a rehearsal recovers to a chosen point in an isolated environment | The recovered state matches the chosen point within the declared RPO; the shared production database is not rewritten; the rehearsal result appears in the recovery-posture view |
| AC-ADMIN-41 | Guided onboarding (ADMIN-69): venue D has no tax configuration and no active jurisdiction pack | Activation is refused naming the failed blocking readiness check; steps already completed remain valid and audited; resuming the guide continues from the first incomplete step |
| AC-ADMIN-42 | Jurisdiction pack (ADMIN-71): activation of a regulatory pack without validation evidence | Refused; the pack is shown as unavailable; no "supported" or "compliant" state is displayed; existing records keep their pack version |

## 09.12 KPIs and metric definitions

| Metric | Definition | Target |
|---|---|---|
| Deprovisioning latency | Time from the deactivation command's commit to the last request accepted for that account on any surface, per deactivation | OWNER TARGET REQUIRED (DEC-ADMIN-6). Verdura evidence "same day; minutes with SCIM" is proposed only |
| Revocation effectiveness | Time from device or credential revocation commit to the last accepted request or open realtime connection for that credential | Bound per DEC-ADMIN-22; SPRD §16.5 "immediately" |
| Self-escalation and last-owner violations | Count of committed grants violating ADMIN-23 or ADMIN-24 | Zero by construction (verification metric) |
| Privileged actions without step-up | Count of committed catalogued privileged actions lacking a step-up record | Zero by construction |
| Standing SoD conflicts | Count of objects where initiator equals approver under an enabled SoD rule | Zero by construction |
| Credential age | Age since last rotation per device kind and integration connection | Rotation cadence DEC-ADMIN-13 |
| Dead-letter oldest age | Oldest unresolved dead letter per organization | OWNER TARGET REQUIRED (§20.7) |
| Edge heartbeat availability | Share of operating-hour minutes with a heartbeat within threshold, per venue | OWNER TARGET REQUIRED (§20.7) |
| Support access exposure | Support sessions and total active minutes per organization per month | Informational |
| Audit coverage | Share of catalogued security-sensitive and configuration mutations with a matching audit record in test suites | Every catalogued mutation (§16.13; binary) |

## 09.13 Open decisions

| ID | Decision | Why it matters | Options evidenced | Blocks | Tier |
|---|---|---|---|---|---|
| DEC-ADMIN-1 | Whether hierarchy levels between organization and venue (brand, region) and legal-entity attachment are needed | Multi-brand groups, reporting rollups, finance mapping | Verdura evidence: group → brand → region → venue, legal entities at any level; current Servvia: organization → venue; KitchenOS franchise and multi-location operation (K(L52, L343–346, L603–604)) | ADMIN-1 levels, ADMIN-63 structure | 3 — **franchise and group operation inclusion RESOLVED by DEC-X-1 (owner 2026-10-05)**; levels, legal-entity attachment and franchise structure (one organization versus related organizations) remain open; phasing DEC-X-17 |
| DEC-ADMIN-2 | Default permissions per current role, permitted manager administration, and whether custom roles exist (refines DEC-X-2) | Least privilege | Current enforcement (09.7); Verdura role templates and IT_ADMIN profile (evidence) | Authorization matrix defaults | 3 |
| DEC-ADMIN-3 | Whether MFA is required, for which roles, and methods | Account takeover resistance for owners and admins | Verdura evidence: TOTP and WebAuthn, policy by role | ADMIN-20 | 3 — **MFA capability inclusion RESOLVED by DEC-X-1 (owner 2026-10-05, K(L550))**; required roles and methods remain open (P2); phasing DEC-X-17 |
| DEC-ADMIN-4 | Catalogue of privileged administrative actions requiring step-up, and administrative SoD rules (dual control) | ADMIN-27, ADMIN-28 | Minimum list in ADMIN-27; Verdura dual-logged audit export | Enabling step-up per action | 3 |
| DEC-ADMIN-5 | Step-up mechanism for Admin Console sessions (password re-entry, staff PIN, second factor) and its validity window | Privileged action assurance | DL-081 manager step-up by PIN on tablets (evidence) | ADMIN-27 implementation | **APPROVED — TIER 2** (2026-10-05; mechanism only, see 00.10.4; was: 2) |
| DEC-ADMIN-6 | Session and credential policy values: idle and absolute session lifetimes, concurrent sessions, password composition, PIN length and lockout, invitation versus administrator-set initial credentials | §16.4 requires expiry; values are policy | Current Nest values (evidence only) | ADMIN-17, deprovisioning metric | 3 |
| DEC-ADMIN-7 | Support-access model: who may authorize, default off or on, maximum window, read-only versus read-write, emergency access | Customer trust and row AG | Verdura evidence: customer-enabled, time-boxed, badged | ADMIN-53 | 3 |
| DEC-ADMIN-8 | Owner recovery and break-glass accounts | Lock-out of all owners | Verdura evidence: pre-designated break-glass accounts that alert loudly | WF-ADMIN-13 | 3 |
| DEC-ADMIN-9 | Which settings are effective-dated, and whether future-dated scheduling is available for them | ADMIN-7 scope | Tax configuration and station routing are strong candidates (KIT-1) | ADMIN-7, ADMIN-44 | **APPROVED — TIER 2** (2026-10-05; mechanism only, see 00.10.4; was: 2) |
| DEC-ADMIN-10 | Per-venue capability enablement model (which capabilities, server enforcement point) replacing Verdura module gates | ADMIN-10; Guest Mode exclusion from the pilot; kitchen printing per venue | Verdura module phase-gates (superseded) | ADMIN-10 | **APPROVED — TIER 2** (2026-10-05; mechanism only, see 00.10.4; was: 2) |
| DEC-ADMIN-11 | Venue lifecycle states and the handling of closed-venue data | ADMIN-4 | Verdura evidence: onboarding, active, suspended, closed | ADMIN-4 | 3 |
| DEC-ADMIN-12 | Venue Edge pairing and identity: D8 device kind versus separate installation registry; pairing secret lifetime; certificate or opaque credential | EDGE-2 identity | D8 opaque credentials; Verdura one-time pairing token and installation identity | ADMIN-40 | **APPROVED — TIER 2** (2026-10-05; mechanism only, see 00.10.4; was: 2) |
| DEC-ADMIN-13 | Credential rotation cadence and overlap windows for devices and integrations | Credential hygiene versus availability | D8 rotates with immediate invalidation | ADMIN-47, credential-age metric | 3 |
| DEC-ADMIN-14 | Whether third-party API keys and outbound webhooks are committed scope | Partner integrations | Verdura API key and webhook model | ADMIN-49 | 3 — **inclusion RESOLVED by DEC-X-1 (owner 2026-10-05, K(L8, L360–369))**: external API keys, webhooks and a developer sandbox are TARGET CAPABILITY — FUTURE DELIVERY; phasing DEC-X-17; a public marketplace or partner programme is split to DEC-ADMIN-24 |
| DEC-ADMIN-15 | Audit export format and integrity signing, who may export, retention beyond 90 days, audit search latency target | Investigations and evidence | Verdura signed exports; DEC-X-6 hash chaining | ADMIN-51, ADMIN-52 | 3 |
| DEC-ADMIN-16 | Who executes personal-data requests, with what verification and deadlines (under DEC-X-4, DEC-X-5) | Privacy obligations not established | — | ADMIN-59 | 3 |
| DEC-ADMIN-17 | Whether periodic access reviews are committed, cadence and reviewers | Standing access hygiene | Verdura access-review campaigns | ADMIN-61 | 3 |
| DEC-ADMIN-18 | Retirement sequence of legacy external-POS administration (Nest and Admin Console) | PR-8 and §34.2 | Retire after the web Order Tablet and order creation stop calling it | ADMIN-48 completion | 2 |
| DEC-ADMIN-19 | Platform operator identity and role: how Servvia staff are represented (separate operator realm versus organization accounts) | Support and platform monitoring must not use customer identities | Row AG; §20.4 platform view | ADMIN-53, ADMIN-54 platform scope | **APPROVED — TIER 2** (2026-10-05; mechanism only, see 00.10.4; was: 2) |
| DEC-ADMIN-20 | Printer configuration ownership during the move from Nest `Printer` to Venue Edge (with O-4) | Single owner per capability (PR-7) | Nest configuration; Venue Edge printer module (§30.4) | ADMIN-43 target | 2 |
| DEC-ADMIN-21 | Service and integration identity model (INV-3 service class): representation, scopes, rotation | API keys, adapters other than payment | D8 `payment_adapter` device pattern | ADMIN-46, ADMIN-49 | **APPROVED — TIER 2** (2026-10-05; mechanism only, see 00.10.4; was: 2) |
| DEC-ADMIN-22 | **APPROVED 2026-10-05 at architecture level (Tier 2).** Mechanism that closes live realtime connections when a credential or grant is revoked (target: push-close triggered by the revocation event, with periodic revalidation only as a safety net). The current Core re-check every 60 s is a CURRENT deficiency against SPRD §16.5, not an acceptable bound | §16.5 requires revoked credentials to stop working immediately, including on live connections | Push notification from the revocation transaction to the realtime hub; shorter revalidation alone (rejected as the target: it legitimises a delay) | ADMIN-15, ADMIN-33, AC-ADMIN-8, AC-ADMIN-15 | 2 (approved; implementation incomplete — DECISION RESOLVED, IMPLEMENTATION BLOCKER) |
| DEC-ADMIN-23 | Feasibility and procedure of tenant-scoped restore in a shared database | Restoring one organization without affecting others | Point-in-time restore to an isolated environment then selective repair | ADMIN-57 tenant scope, ADMIN-68 | **APPROVED — TIER 2** (2026-10-05; mechanism only, see 00.10.4; was: 2) |
| DEC-ADMIN-24 | Whether Servvia operates a public integration marketplace or partner programme (listing, partner certification, revenue terms, developer community), and on what terms | A marketplace is a commercial and governance commitment beyond the external API platform; it links to the commercial platform choices of DEC-X-18 | KitchenOS developer marketplace and partner strategy (K(L8, L98–103, L156)), evidence only; none | Any marketplace or partner-programme implementation; not ADMIN-49 or ADMIN-65 | 3 |
| O-2, O-8, O-13, O-20, O-21 | Referenced SPRD decisions (credential issuance, media ownership, KDS authentication, Staff Mode authorisation, tablet kind naming) | — | — | As cited | — |
| DEC-X-1, DEC-X-2, DEC-X-4, DEC-X-5, DEC-X-6, DEC-X-7, DEC-X-8, DEC-X-9, DEC-X-11, DEC-X-12, DEC-X-13, DEC-X-17, DEC-X-18 | Referenced cross-cutting decisions (DEC-X-1 inclusion resolved; DEC-X-17 phasing of 09.5.8; DEC-X-18 self-service sign-up and commercial platform choices) | — | — | As cited | — |

## 09.14 Future and deferred capabilities

| Capability | State | Condition |
|---|---|---|
| SSO (SAML or OIDC) and SCIM provisioning and deprovisioning, IdP group to role mapping, break-glass local owners | DEFERRED | SPRD §13; DEC-X-12 |
| Access-review campaigns with certify or revoke per grant | FUTURE | DEC-ADMIN-17 |
| Expiring object-level permission overrides | FUTURE | DEC-ADMIN-2; must expire and be audited |
| Approval workflow designer shared by domains | FUTURE | 00.7 Approvals; DEC-X-13; DEC-X-7 |
| Venue cloning from a template venue with diff review | FUTURE | Scope decision; ADMIN-2 must hold without it |
| Third-party API keys, outbound webhooks, event catalogue for partners, developer sandbox and documentation (ADMIN-49, ADMIN-65) | TARGET CAPABILITY — FUTURE DELIVERY | Inclusion resolved (DEC-X-1, DEC-ADMIN-14); DEC-ADMIN-21 service identities; phasing DEC-X-17 |
| Public integration marketplace, partner certification or developer programme | OWNER DECISION REQUIRED | DEC-ADMIN-24; DEC-X-18 |
| Self-service tenant sign-up | OWNER DECISION REQUIRED | DEC-X-18; guided onboarding (ADMIN-69) does not depend on it |
| Venue operating profiles (ADMIN-62) | TARGET CAPABILITY — FUTURE DELIVERY | DEC-ADMIN-10 mechanism approved; profile contents are venue configuration; phasing DEC-X-17 |
| Franchise and group operation with cross-location rollout (ADMIN-63) | TARGET CAPABILITY — FUTURE DELIVERY | Inclusion resolved (DEC-X-1); hierarchy levels and franchise structure DEC-ADMIN-1; phasing DEC-X-17 |
| Integration framework for delivery marketplaces, accounting, payment and communications providers (ADMIN-64) | TARGET CAPABILITY — FUTURE DELIVERY (payment adapter is TARGET) | INV-19; DEC-ADMIN-21; phasing DEC-X-17 |
| MFA (ADMIN-20) | TARGET CAPABILITY — FUTURE DELIVERY | Required roles and methods DEC-ADMIN-3 (P2) |
| IP allowlisting (ADMIN-66) | TARGET CAPABILITY — FUTURE DELIVERY | Break-glass DEC-ADMIN-8 |
| Encryption at rest with key rotation (ADMIN-67) | TARGET CAPABILITY — FUTURE DELIVERY | Rotation cadence owner policy (P5) |
| Point-in-time recovery (ADMIN-68) | TARGET CAPABILITY — FUTURE DELIVERY | RPO/RTO DEC-X-9 (P7); DEC-ADMIN-23 |
| Guided onboarding with readiness checks (ADMIN-69); contextual help and role-specific guidance (ADMIN-70) | TARGET CAPABILITY — FUTURE DELIVERY | Phasing DEC-X-17; help channels are product choices |
| Jurisdiction-pack administration (ADMIN-71) | TARGET CAPABILITY — FUTURE DELIVERY | INV-22; regulatory activation gated on validation evidence (P5) |
| Personal-data export, erasure and portability requests (ADMIN-59) | TARGET CAPABILITY — FUTURE DELIVERY | Obligations and policy DEC-X-4, DEC-X-5, DEC-ADMIN-16 (P4, P5) |
| Audit hash chaining and verification | ARCHITECTURE DECISION REQUIRED | DEC-X-6 |
| Audit streaming to a customer security platform | FUTURE | Customer demand; DEC-ADMIN-15 |
| Customer-managed encryption keys, data residency options, sandbox organizations for customer testing or training (distinct from the developer API sandbox of ADMIN-65) | FUTURE | Not described by KitchenOS; owner commercial decision (O-12) |
| Anomaly detection on administrative actions | FUTURE | Volume 08; `data/` outside the transaction path |
| Compliance programme evidence surfaces | FUTURE | DEC-X-5; no compliance claim is made |
| Organization-wide data export packs | FUTURE | DEC-X-4; RPT-1 CSV export is separate |
| Integration connection registry, capability matrix and sync scorecards for external POS providers; on-premises POS edge connector | SUPERSEDED | Servvia is the POS (ADR 0001, DL-116); Venue Edge pairing (ADMIN-40) adapts only the identity and pairing mechanism |
