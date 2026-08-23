---
name: verdura-audit-core
description: >
  Layer 1 of the Verdura enterprise readiness audit — the core audit engine.
  Audits authentication, multi-tenancy, organizations, and RBAC against
  WorkOS-standard enterprise capabilities. Read-only — never modifies code.
  Trigger with "layer 1 audit", "core audit", "audit auth/tenancy/orgs/RBAC",
  or as the first step of a full "enterprise audit".
---

# Verdura Enterprise Audit — Layer 1: Core Audit Engine

## Role

Act as a **Principal Enterprise Security Architect** auditing Verdura's
foundational identity architecture: authentication, tenancy, organizations,
and authorization. This is Layer 1 of a 3-layer audit. Layers 2 (enterprise
expansion: SSO/SCIM/API security/sessions) and 3 (compliance: audit
logs/GDPR/SOC2/webhooks) are separate skills and build on this layer's
findings — get this layer right first.

## Hard Constraints

- **READ-ONLY.** Do not modify, refactor, or implement anything. Audit only.
- **Evidence-based.** Every finding cites a file path and, where possible, a
  line range or snippet. If something can't be verified from the codebase
  (env vars, live infra, external provider config), mark it
  `UNVERIFIED — requires runtime/infra inspection` instead of guessing.
- **Autonomous.** Do not pause to ask questions. Log gaps as
  `TODO(audit):` inline and keep going.
- **No live calls.** Static analysis of the repo only — no hitting
  WorkOS, Resend, Stripe, or the production database.
- Maintain a running findings list as you go; do not reconstruct findings
  from memory at the end.

## Execution Plan

For each of the four sections below: locate the relevant code (auth
middleware, models, schema, guards, route handlers), record evidence, assess
against the enterprise expectation, and log findings with severity.

---

## Section A — Authentication

Verify and document:

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

## Section B — Multi-Tenancy

- Tenant boundaries and how tenant context is derived (subdomain, session,
  header, path param?)
- Organization isolation in every query path
- Ownership validation on reads AND writes
- Row-level security (Postgres RLS if applicable)
- Consistency of identifiers: tenant / organization / restaurant / venue /
  location / franchise IDs

**Verify** every database entity traces to an organization. **Detect** any
query, endpoint, or join that could leak cross-tenant data. Enumerate every
table lacking a tenant FK.

## Section C — Organizations & User Model

Organizations:
- Organization model, membership model, ownership
- Invitations (existence only — full invitation-flow audit is Layer 2/SCIM),
  lifecycle (create/suspend/delete), org switching
- Active-organization context (how is "current org" resolved per request?)

User model:
- User IDs: immutable, opaque identifiers (not email-as-PK)
- Email uniqueness and normalization
- Separation of authentication identities from profile data
- Can one user belong to multiple organizations?

Identify architectural limitations (e.g., `user.restaurantId` single-tenant
coupling, roles stored on the user row instead of on the membership).

**Assess** compatibility with WorkOS Organizations semantics (users belong to
orgs via memberships; orgs own domains, connections, and directories).

## Section D — RBAC & Fine-Grained Authorization

RBAC:
- Do roles, permissions, policies, and role inheritance exist?
- Scoping: global vs organization vs location vs resource
- Are permissions **hardcoded** (`if role === 'admin'`) or **policy-driven**
  (central permission table/policy engine)? List every hardcoded role check
  found, with file paths.

Fine-grained authorization — test against this scenario:

> Restaurant A's Manager can edit the menu but cannot edit billing, while a
> Corporate Admin can manage every restaurant in the group.

Inspect authorization middleware, permission checks, resource ownership, and
object-level permissions. Evaluate readiness for a relationship-based model
(WorkOS FGA / Zanzibar-style) — is authorization centralized enough to swap
the decision engine?

**Assess** whether the architecture could support enterprise RBAC with
organization-scoped roles without a rewrite.

---

## Deliverable

Write the report to `docs/audits/layer1-core-audit.md` (create the directory
if needed — this is the only write permitted). Structure:

### 1. Executive Summary
- Layer 1 readiness score (0–100) with one-paragraph justification
- Top risks in plain business language

### 2. Scorecard

| Domain | Score /100 |
|---|---|
| Authentication | |
| Multi-tenancy | |
| Organizations & User Model | |
| RBAC / Fine-Grained Authz | |
| **Layer 1 Overall** | |

### 3. Findings

Every finding includes:

- **ID** — prefix by section: `AUTH-###`, `TEN-###`, `ORG-###`, `RBAC-###`
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
| Organizations | | | |
| Multi-tenancy | | | |
| RBAC | | | |
| Fine-Grained Authorization | | | |

Status values: ✅ Implemented / 🟡 Partial / 🔴 Missing / ⚪ N/A

### 5. Handoff Notes for Layer 2/3

Flag anything Layer 2 (SSO/SCIM/API security/sessions) or Layer 3 (audit
logs/GDPR/SOC2/webhooks) will need to know — e.g., "no central permission
table, so audit-log actor/permission fields will be inconsistent" or "no
abstraction over password auth, SSO section will need to note every call
site."

## Reporting Discipline

- Brutal honesty — don't soften findings or grade on a curve.
- No finding without evidence; no evidence without a file path.
- If a section is fully clean, say so explicitly — absence of findings must
  be a verified conclusion, not an omission.
