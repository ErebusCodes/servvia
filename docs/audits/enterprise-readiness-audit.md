---
name: verdura-enterprise-audit
description: >
  Perform a comprehensive enterprise identity & security readiness audit of the
  Verdura codebase against WorkOS-standard enterprise capabilities (AuthKit,
  Organizations, SSO, SCIM, RBAC, FGA, Audit Logs). Read-only — never modifies
  code. Trigger with "enterprise audit", "WorkOS readiness", "security audit",
  "is Verdura enterprise ready", or "identity architecture review".
---

# Verdura Enterprise Identity & Security Audit (WorkOS Standard)

> **Audit scope addition — 2026-08-15:** Every audit must test the identities, grants and immutable audit correlation required by the [Target Operating Model](../target-operating-model.md): customer/staff device, venue-bound connector, Idealpos transaction, payment-provider transaction, KDS delivery and each KOT delivery. It must flag shared connector credentials, cross-venue commands, missing actor attribution, fabricated acknowledgement, unapproved emergency-mode activation or payment/POS references that cannot be reconciled.

> **Document classification — 2026-08-15:** The material below is an audit procedure/agent brief, not a completed audit report. It must not be cited as proof of enterprise readiness. Static assessment found a sound custom JWT/Argon2 baseline and improved route/device protection, but only coarse roles, organization-wide staff scope, no enforced permission-code/FGA model, no SSO/SCIM, no access reviews or separation-of-duties engine, no database-enforced tenant isolation, and no tamper-evident universal audit service.

## Current Readiness Summary

| Control area | Current assessment | Recommendation |
| --- | --- | --- |
| Authentication | Partial | Retain the fail-closed JWT baseline; add session inventory/revocation, MFA policy and an IdP abstraction before enterprise rollout |
| Venue authorization | Insufficient | Enforce `VenueAccess` for staff at API, WebSocket and job boundaries |
| Permissions | Insufficient | Replace coarse-role-only decisions with permission codes, venue scopes, FGA expiry and SoD checks |
| Tenant isolation | Partial | Add mandatory tenant context/repository enforcement, tenant-aware constraints and adversarial tests |
| Audit | Partial | Centralize writes; add correlation IDs, append-only controls, hash-chain verification and signed export |
| Enterprise lifecycle | Not implemented | Design SSO/SCIM, JML, access reviews and break-glass controls after the design-partner MVP gate |

**Release position:** not enterprise-ready. The immediate priority is reliable venue and tenant isolation on pilot-critical workflows, not premature WorkOS integration. See [../mvp.md](../mvp.md).

## Role

Act as a **Principal Enterprise Security Architect** and **WorkOS Enterprise
Solutions Architect** auditing Verdura for enterprise readiness.

Verdura is intended to become a global enterprise restaurant operating system
serving independent restaurants, multi-location businesses, franchise groups,
hotel chains, stadiums, airports, and enterprise hospitality companies. The
purpose of this audit is to surface architectural weaknesses **before**
enterprise customers are onboarded.

## Hard Constraints

- **READ-ONLY.** Do NOT modify, refactor, or implement anything. Audit only.
- **Evidence-based.** Every finding MUST cite a file path and, where possible,
  a line range or code snippet. No speculation. If something cannot be
  verified from the codebase, mark it `UNVERIFIED — requires runtime/infra
  inspection` rather than guessing.
- **Autonomous execution.** Do not pause to ask questions. If a section cannot
  be assessed (e.g., missing env vars, external provider config, live
  infrastructure), note it inline with a `TODO(audit):` comment in the report
  and continue.
- **No live calls.** Never hit external APIs (WorkOS, Resend, Stripe, etc.)
  or the production database. Static analysis of the repo only.

## Execution Plan

Work through the sections below in order. For each section:

1. Locate the relevant code (grep/glob for auth middleware, models, schema,
   route handlers, guards, etc.).
2. Record evidence (file paths, snippets).
3. Assess against the enterprise expectation.
4. Log findings with severity.

Maintain a running findings list as you go — do not wait until the end to
write findings from memory.

---

## Section 1 — Authentication

Inspect the authentication system. Verify and document:

- Authentication provider (custom, NextAuth, Supabase Auth, Clerk, etc.)
- Session management strategy (JWT vs server sessions, storage)
- JWT handling: signing algorithm, secret management, expiry, claims
- Refresh token rotation and revocation
- Cookie security: `HttpOnly`, `Secure`, `SameSite`, scoping
- CSRF protection
- Session expiration and idle timeout
- Password policies (length, complexity, hashing algorithm + cost factor)
- MFA readiness (schema/flow hooks even if unimplemented)
- OAuth readiness (abstraction over providers)
- Passkey/WebAuthn readiness
- Email verification flow
- Password reset architecture (token generation, expiry, single-use)
- Device/session tracking

**Assess:** Could WorkOS AuthKit replace the current auth layer without a
major rewrite? Identify every coupling point that would block it.

## Section 2 — Multi-Tenancy

Determine whether the application is genuinely multi-tenant.

- Tenant boundaries and how tenant context is derived (subdomain, session,
  header, path param?)
- Organization isolation in every query path
- Ownership validation on reads AND writes
- Row-level security (Postgres RLS if applicable)
- Consistency of tenant identifiers: tenant / organization / restaurant /
  venue / location / franchise IDs

**Verify** that every database entity traces to an organization. **Detect**
any query, endpoint, or join that could leak cross-tenant data. Enumerate
every table lacking a tenant FK.

## Section 3 — Organizations

Determine whether organizations are first-class entities.

- Organization model, membership model, ownership
- Invitations, lifecycle (create/suspend/delete), org switching
- Active-organization context (how is "current org" resolved per request?)

**Assess** compatibility with WorkOS Organizations semantics (users belong to
orgs via memberships; orgs own domains, connections, and directories).

## Section 4 — User Model

- User IDs: immutable, opaque identifiers (not email-as-PK)
- Email uniqueness and normalization
- Separation of authentication identities from profile data
- User metadata storage
- Organization memberships: can one user belong to multiple orgs?

Identify architectural limitations (e.g., `user.restaurantId` single-tenant
coupling, roles stored on the user row instead of on the membership).

## Section 5 — Role-Based Access Control

- Does RBAC exist? Roles, permissions, policies, inheritance?
- Scoping: global vs organization vs location vs resource
- Are permissions **hardcoded** (string checks, `if role === 'admin'`) or
  **policy-driven** (central permission table/policy engine)?

**Assess** whether the architecture could support enterprise RBAC with
organization-scoped roles without rewrites. List every hardcoded role check
found, with file paths.

## Section 6 — Fine-Grained Authorization

Test the architecture against this scenario:

> Restaurant A's Manager can edit the menu but cannot edit billing, while a
> Corporate Admin can manage every restaurant in the group.

Inspect authorization middleware, permission checks, resource ownership, and
object-level permissions. Evaluate readiness for a relationship-based model
(WorkOS FGA / Zanzibar-style) — is authorization centralized enough to swap
the decision engine?

## Section 7 — SSO Readiness

- Is authentication abstracted behind an interface, or is password auth
  assumed throughout?
- Could SAML / OIDC (Entra ID, Okta, Google Workspace, Ping, OneLogin,
  JumpCloud) be added without touching business logic?

List **every** code path that assumes password authentication (password
fields on required forms, password checks in middleware, reset-flow
assumptions, seeding scripts).

## Section 8 — SCIM Readiness

- Can users be provisioned / updated / suspended / reactivated / deleted by
  an external system?
- Are user lifecycle events centralized (single service/module) or scattered
  across route handlers?
- Is there a soft-delete / suspended state distinct from hard delete?

Evaluate compatibility with SCIM-based provisioning and Directory Sync.

## Section 9 — Audit Logging

For each sensitive action below, determine whether an immutable audit record
is generated:

login, logout, password reset, reservation created, reservation cancelled,
menu changed, inventory modified, stock adjustment, order cancelled, payment
refunded, kitchen override, role changed, permission changed, organization
updated, user invited, user deleted.

Where audit records exist, evaluate: timestamp accuracy, actor, affected
resource, originating IP, user agent, tenant, metadata, immutability
(append-only? can rows be updated/deleted?), and export capability.

Produce a coverage table: action → logged (Y/N) → fields captured → gaps.

## Section 10 — API Security

Authentication middleware, authorization middleware, rate limiting, CORS
configuration, security headers, input validation (zod/joi coverage), output
validation, JWT verification, API versioning, tenant isolation at the route
layer, authorization bypass risks, and **IDOR vulnerabilities** (enumerate
every endpoint that accepts an ID without verifying ownership).

## Section 11 — Database Security

Foreign keys, tenant ownership columns, soft delete, cascade rules, unique
constraints, indexes (especially on tenant + FK columns), organization
ownership, permission tables, audit tables, RLS policies if applicable.
Review the schema/migrations directly.

## Section 12 — Administration

Does the architecture distinguish: organization admin, restaurant owner,
regional manager, corporate admin, support staff, internal (Verdura-staff)
administrator? Are internal-admin capabilities separated from customer-facing
roles, or does one "admin" flag do everything?

## Section 13 — User Invitation Flow

Invitation tokens (entropy, storage), expiration, acceptance flow, duplicate
prevention, organization assignment, role assignment at accept-time, email
verification interplay, revocation.

## Section 14 — Session Management

Concurrent sessions, session revocation, logout-everywhere, session timeout,
idle timeout, remember-me, trusted devices, device tracking.

## Section 15 — API Keys

Is there any architecture for: organization API keys, scoped keys, revocable
keys, read-only keys, webhook secrets, machine-to-machine auth? If absent,
assess how hard it would be to add given the current auth middleware design.

## Section 16 — Webhook Architecture

Inbound webhook verification (signature checking), outbound signing, retry
logic, idempotency, event versioning, replay protection.

## Section 17 — Compliance Readiness

SOC 2, ISO 27001, GDPR (data export/deletion paths, consent), PCI DSS scope
(does Verdura touch card data or is it fully delegated to the PSP?),
restaurant/hospitality audit requirements, data retention, audit exports,
least privilege, security event logging.

## Section 18 — Code Quality (Security-Relevant)

Authentication duplication, authorization duplication, business logic mixed
with auth code, magic strings, hardcoded roles, hardcoded permissions,
hardcoded organization/restaurant IDs, technical debt hotspots, security
smells (secrets in code, disabled checks, `// TODO: add auth`).

## Section 19 — WorkOS Compatibility Verdict

For each WorkOS capability, judge integration feasibility **without a
complete rewrite**: AuthKit, Organizations, Enterprise SSO, Directory Sync
(SCIM), RBAC, Fine-Grained Authorization, Audit Logs, Admin Portal, Domain
Verification, User Management APIs.

---

## Deliverable

Write the full report to `docs/audits/enterprise-readiness-audit.md` (create
the directory if needed — this is the ONLY write permitted). Structure:

### 1. Executive Summary
- Overall enterprise readiness score (0–100) with one-paragraph justification
- Top 5 risks in plain business language

### 2. Security Scorecard

| Domain | Score /100 |
|---|---|
| Authentication | |
| Authorization | |
| Identity | |
| Tenant isolation | |
| Auditability | |
| API security | |
| Compliance | |
| **Overall** | |

### 3. Findings

Every finding must include:

- **ID** (e.g., `AUTH-001`)
- **Severity**: Critical / High / Medium / Low
- **Location**: file path(s) + line references
- **Description**
- **Business impact**
- **Technical impact**
- **Recommended solution**
- **Estimated effort**: S (<1 day) / M (1–3 days) / L (1–2 weeks) / XL (>2 weeks)

Order findings by severity, Critical first.

### 4. Enterprise Readiness Matrix

| Capability | Status | Ready | Notes |
|---|---|---|---|
| Organizations | | | |
| Multi-tenancy | | | |
| Enterprise SSO | | | |
| SCIM | | | |
| RBAC | | | |
| Fine-Grained Authorization | | | |
| Audit Logs | | | |
| MFA | | | |
| API Keys | | | |
| Session Management | | | |
| Admin Portal Readiness | | | |

Status values: ✅ Implemented / 🟡 Partial / 🔴 Missing / ⚪ N/A

### 5. Remediation Roadmap

Sequence the Critical and High findings into a phased plan (Phase 1: blockers
before any enterprise customer; Phase 2: pre-SSO; Phase 3: pre-SCIM/compliance).

### 6. Final Verdict

Choose exactly one:

- ✅ Enterprise Ready
- 🟢 Minor Improvements Needed
- 🟡 Significant Architectural Work Required
- 🔴 Not Enterprise Ready

## Reporting Discipline

- Brutal honesty. Do not soften findings or grade on a curve.
- No finding without evidence; no evidence without a file path.
- If a section is fully clean, say so explicitly — absence of findings must
  be a verified conclusion, not an omission.
