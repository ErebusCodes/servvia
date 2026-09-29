---
name: verdura-audit-compliance
description: >
  Layer 3 of the Verdura enterprise readiness audit — the compliance layer.
  Audits audit logging, GDPR readiness, SOC 2 readiness, and webhook
  architecture, then synthesizes all three layers into a final enterprise
  readiness verdict. Read-only — never modifies code. Trigger with "layer 3
  audit", "compliance audit", "audit logs/GDPR/SOC2/webhooks", "final
  enterprise verdict", or as the third step of a full "enterprise audit" (run
  after Layers 1 and 2).
---

# Verdura Enterprise Audit — Layer 3: Compliance Layer

## Role

Act as a **Principal Compliance & Security Architect** auditing Verdura's
audit logging, GDPR posture, SOC 2 readiness, and webhook architecture — then
synthesizing all three audit layers into one final enterprise-readiness
verdict. This is Layer 3 of a 3-layer audit and assumes Layers 1
(`verdura-audit-core`) and 2 (`verdura-audit-enterprise`) have already run.

Before starting, check for and read:
- `docs/audits/layer1-core-audit.md`
- `docs/audits/layer2-enterprise-audit.md`

If either is missing, proceed with this layer's own audit anyway and note
the gap — do not block on it.

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
evidence, assess against the enterprise/compliance expectation, and log
findings with severity. Then synthesize.

---

## Section A — Audit Logging

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

## Section B — GDPR Readiness

- Data subject access requests: is there a code path to export a user's
  personal data?
- Right to erasure: is there a code path to delete/anonymize a user's
  personal data, including cascading effects on related records?
- Consent: is consent tracked anywhere (marketing emails, cookies, data
  processing)?
- Data minimization: is PII stored beyond what's needed (e.g., raw card
  data, unredacted logs)?
- Data residency: any indication of where data is hosted / whether it can be
  region-pinned for EU customers?
- Third-party processors: are subprocessors (email, payments, hosting)
  identifiable from the codebase/config for a Data Processing Agreement?

## Section C — SOC 2 Readiness

Map current architecture against SOC 2 Trust Services Criteria at a
high level (Security, Availability, Processing Integrity, Confidentiality,
Privacy) using evidence gathered across all three layers:

- Access control evidence (draws on Layer 1 RBAC/tenancy findings)
- Change management: is there CI, code review enforcement, protected
  branches (inspect repo and CI configs)?
- Logging & monitoring evidence (this layer's Section A)
- Encryption at rest / in transit (inspect DB config, TLS enforcement)
- Vendor/subprocessor management (this layer's Section B)
- Incident response: does any runbook, on-call doc, or incident process
  exist in the repo?

This section is necessarily broader than pure code inspection — mark
infra/process items `UNVERIFIED — requires runtime/infra inspection` rather
than guessing, but still list them as open items in the roadmap.

## Section D — Webhook Architecture

- Inbound webhook signature verification
- Outbound webhook signing
- Retry logic
- Idempotency (duplicate delivery handling)
- Event versioning
- Replay protection

---

## Deliverable

Write two files (both writes are permitted, this is the only skill that
produces the master report):

### File 1: `docs/audits/layer3-compliance-audit.md`

Same structure as Layers 1–2:

1. **Executive Summary** — Layer 3 readiness score (0–100) + top risks
2. **Scorecard**

   | Domain | Score /100 |
   |---|---|
   | Audit Logging | |
   | GDPR Readiness | |
   | SOC 2 Readiness | |
   | Webhook Architecture | |
   | **Layer 3 Overall** | |

3. **Findings** — IDs prefixed `AUDIT-###`, `GDPR-###`, `SOC2-###`, `WH-###`,
   each with Severity / Location / Description / Business impact / Technical
   impact / Recommended solution / Estimated effort (S/M/L/XL). Critical
   first.
4. **Readiness Matrix**

   | Capability | Status | Ready | Notes |
   |---|---|---|---|
   | Audit Logs | | | |
   | GDPR | | | |
   | SOC 2 | | | |
   | Webhooks | | | |

### File 2: `docs/audits/enterprise-readiness-final-report.md`

The master synthesis, combining this layer's findings with Layers 1 and 2
(read from their report files if present; if a layer report is missing,
state that explicitly and score based on available evidence only):

1. **Executive Summary** — overall enterprise readiness score (0–100)
   blending all three layers, top 5 risks across the whole audit in plain
   business language
2. **Consolidated Security Scorecard**

   | Domain | Score /100 |
   |---|---|
   | Authentication | |
   | Authorization | |
   | Identity | |
   | Tenant isolation | |
   | SSO/SCIM Readiness | |
   | API Security | |
   | Auditability | |
   | Compliance (GDPR/SOC2) | |
   | **Overall** | |

3. **Full Enterprise Readiness Matrix** — merge the matrices from all three
   layer reports into one table
4. **Critical & High Findings Digest** — pull every Critical/High finding
   from all three layers into one prioritized list (reference original IDs)
5. **Remediation Roadmap** — phase the Critical/High findings from all three
   layers:
   - Phase 1: blockers before any enterprise customer
   - Phase 2: pre-SSO
   - Phase 3: pre-SCIM / pre-compliance-certification
6. **Final Verdict** — choose exactly one:
   - ✅ Enterprise Ready
   - 🟢 Minor Improvements Needed
   - 🟡 Significant Architectural Work Required
   - 🔴 Not Enterprise Ready

## Reporting Discipline

- Brutal honesty — don't soften findings or grade on a curve.
- No finding without evidence; no evidence without a file path.
- If a section is fully clean, say so explicitly — absence of findings must
  be a verified conclusion, not an omission.
- The final verdict must be traceable to specific findings, not a vibe.
