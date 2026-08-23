---
name: verdura-audit-enterprise
description: >
  Layer 2 of the Verdura enterprise readiness audit — enterprise expansion.
  Audits SSO readiness, SCIM/provisioning, API security, and session
  management against WorkOS-standard enterprise capabilities. Read-only —
  never modifies code. Trigger with "layer 2 audit", "enterprise expansion
  audit", "audit SSO/SCIM/API security/sessions", or as the second step of a
  full "enterprise audit" (run after Layer 1 / verdura-audit-core).
---

# Verdura Enterprise Audit — Layer 2: Enterprise Expansion

## Role

Act as a **WorkOS Enterprise Solutions Architect** auditing Verdura's
readiness for SSO, directory provisioning (SCIM), hardened API security, and
session management. This is Layer 2 of a 3-layer audit, and assumes Layer 1
(auth, tenancy, orgs, RBAC — `verdura-audit-core`) has already run. If
`docs/audits/layer1-core-audit.md` exists, read it first and reference its
findings where relevant (e.g., a Layer 1 finding about hardcoded roles is
directly relevant to SCIM role-mapping here). If it doesn't exist, proceed
anyway and note the gap.

## Hard Constraints

- **READ-ONLY.** Do not modify, refactor, or implement anything. Audit only.
- **Evidence-based.** Every finding cites a file path and, where possible, a
  line range or snippet. Mark unverifiable items
  `UNVERIFIED — requires runtime/infra inspection` rather than guessing.
- **Autonomous.** Do not pause to ask questions. Log gaps as
  `TODO(audit):` inline and keep going.
- **No live calls.** Static analysis only — no hitting WorkOS, Resend,
  Stripe, or the production database.
- Maintain a running findings list as you go.

## Execution Plan

For each of the four sections below: locate the relevant code, record
evidence, assess against the enterprise expectation, and log findings with
severity.

---

## Section A — SSO Readiness

- Is authentication abstracted behind an interface, or is password auth
  assumed throughout?
- Could SAML / OIDC (Microsoft Entra ID, Okta, Google Workspace, Ping
  Identity, OneLogin, JumpCloud) be added without touching business logic?
- Is there any concept of an organization-level "connection" or auth method
  selection (even a stub)?

List **every** code path that assumes password authentication: required
password fields on forms, password checks in middleware, reset-flow
assumptions, seeding/fixture scripts, login UI branching.

## Section B — SCIM & Provisioning Readiness

- Can users be provisioned / updated / suspended / reactivated / deleted by
  an external system, or only through manual admin action?
- Are user lifecycle events centralized (single service/module) or scattered
  across route handlers?
- Is there a soft-delete / suspended state distinct from hard delete?

User invitation flow (feeds directly into provisioning readiness):
- Invitation tokens (entropy, storage), expiration, acceptance flow,
  duplicate prevention, organization assignment, role assignment at
  accept-time, email verification interplay, revocation.

Administrative role separation (relevant to who can trigger provisioning):
- Does the architecture distinguish organization admin, restaurant owner,
  regional manager, corporate admin, support staff, and internal
  (Verdura-staff) administrator — or does one "admin" flag do everything?

**Assess** compatibility with SCIM-based provisioning and Directory Sync.

## Section C — API Security

- Authentication middleware, authorization middleware
- Rate limiting
- CORS configuration
- Security headers
- Input validation (zod/joi coverage) and output validation
- JWT verification
- API versioning
- Tenant isolation at the route layer
- Authorization bypass risks
- **IDOR vulnerabilities** — enumerate every endpoint that accepts an ID
  without verifying the caller owns/can-access that resource

API keys (part of the API security surface):
- Organization API keys, scoped keys, revocable keys, read-only keys,
  webhook secrets, machine-to-machine auth. If absent, assess how hard it
  would be to add given the current auth middleware design.

## Section D — Session Management

- Concurrent sessions
- Session revocation
- Logout-everywhere
- Session timeout / idle timeout
- Remember-me
- Trusted devices
- Device tracking

**Assess** whether session state is centralized enough to support
WorkOS-managed sessions (e.g., revoking on SSO logout, syncing session
lifetime with an IdP-issued token).

---

## Deliverable

Write the report to `docs/audits/layer2-enterprise-audit.md` (create the
directory if needed — this is the only write permitted). Structure:

### 1. Executive Summary
- Layer 2 readiness score (0–100) with one-paragraph justification
- Top risks in plain business language
- Any Layer 1 dependencies that block or complicate this layer

### 2. Scorecard

| Domain | Score /100 |
|---|---|
| SSO Readiness | |
| SCIM / Provisioning | |
| API Security | |
| Session Management | |
| **Layer 2 Overall** | |

### 3. Findings

Every finding includes:

- **ID** — prefix by section: `SSO-###`, `SCIM-###`, `API-###`, `SESS-###`
- **Severity**: Critical / High / Medium / Low
- **Location**: file path(s) + line references
- **Description**
- **Business impact**
- **Technical impact**
- **Recommended solution**
- **Estimated effort**: S (<1 day) / M (1–3 days) / L (1–2 weeks) / XL (>2 weeks)

Order by severity, Critical first.

### 4. Readiness Matrix

| Capability | Status | Ready | Notes |
|---|---|---|---|
| Enterprise SSO | | | |
| SCIM | | | |
| API Keys | | | |
| Session Management | | | |
| Admin Portal Readiness | | | |

Status values: ✅ Implemented / 🟡 Partial / 🔴 Missing / ⚪ N/A

### 5. Handoff Notes for Layer 3

Flag anything the compliance layer (audit logs/GDPR/SOC2/webhooks) will need
— e.g., "no centralized session revocation means logout-everywhere can't be
proven for audit purposes" or "invitation tokens aren't logged anywhere."

## Reporting Discipline

- Brutal honesty — don't soften findings or grade on a curve.
- No finding without evidence; no evidence without a file path.
- If a section is fully clean, say so explicitly — absence of findings must
  be a verified conclusion, not an omission.
