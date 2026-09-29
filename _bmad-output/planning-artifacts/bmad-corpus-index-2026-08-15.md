# Verdura BMAD Corpus Index — 2026-08-15

**Status:** Normative navigation document. This is the single entry point for the authority hierarchy, terminology/status glossary, requirement traceability matrix, top-down review guide, and the consolidated log of decisions still requiring user or vendor confirmation. It does not duplicate the content of the documents it indexes — read it first, then follow the links.

**Produced by:** the 2026-08-15 BMAD documentation-coherence pass (this pass). Prior passes already corrected `docs/mvp.md`, `docs/prd.md`, `docs/architecture.md`, `docs/domain-model.md`, `docs/decisions-log.md` (DL-060–063), `docs/integrations/idealpos.md`, `docs/printers.md`, `docs/offline.md`, `docs/ux.md`, `docs/sprints.md`, `docs/discovery/current-system.md`, `docs/audits/enterprise-readiness-audit.md`, `sprint-status.yaml`, `deferred-work.md`, and all four `_bmad-output/planning-artifacts/` reports with 2026-08-15 correction banners pointing to `docs/target-operating-model.md`. This pass's specific contributions are listed in §6.

---

## 1. Authority Hierarchy

```
docs/target-operating-model.md   (normative — governs implementation; decision date 2026-08-15)
  → docs/mvp.md                  (current-state baseline, status vocabulary, release gates)
    → docs/prd.md                (requirements — superseded where they conflict with the TOM)
      → docs/architecture.md     (trust boundaries, component/deployment design)
        → docs/domain-model.md   (canonical entity/state shapes — target, not yet all implemented)
          → docs/epics.md        (delivery sequencing — corrected 2026-08-15, this pass)
            → _bmad-output/implementation-artifacts/*.md   (vertically-sliced stories)
              → sprint-status.yaml   (per-story status; single source of truth for "what's actually done")
                → _bmad-output/planning-artifacts/*.md     (readiness/launch-gate verdicts)
```

Every document in this tree carries a 2026-08-15 banner pointing upward to `target-operating-model.md`. Where a lower-layer document conflicts with a higher one, the higher layer wins — this has been enforced, not just declared, as of this pass (see §6 for what was corrected and why).

`docs/decisions-log.md` sits alongside this hierarchy as the append-only record of *why* — every non-obvious choice, including supersessions, is logged there by ID (`DL-NNN`). When in doubt about whether a claim is current, check whether a later `DL-` entry supersedes it.

Historical/provenance-only documents (do not treat as current authority): `docs/discovery/current-system.md`, `AUDIT_REPORT.md`, `AUDIT_REPORT_V2.md`, `_bmad-output/planning-artifacts/implementation-readiness-report-2026-06-18.md`'s pre-2026-08-15 body, `docs/superpowers/**`. Each now carries an explicit superseded/historical banner.

## 2. Terminology and Status Glossary

**Story/epic status** (from `sprint-status.yaml`'s own header — the single authoritative definition, repeated here for convenience):

| Status | Meaning |
| --- | --- |
| `backlog` | Story exists in `epics.md` but no story file created yet |
| `ready-for-dev` | Story file created, awaiting dev-story execution |
| `in-progress` | dev-story is actively running |
| `done` | dev-story + code-review complete, **and** every condition in `mvp.md` §13 / this section's "done" clause below is met |
| `skipped` | Intentionally deferred |
| `blocked` | Cannot proceed without discovery, authority or dependency (see §5) |
| `superseded` | An earlier decision or document that a later one has explicitly replaced |

**A story may be marked `done` only when** (per `mvp.md` §13, restated for this index): real implementation exists; required automated tests pass; required integration/hardware evidence exists where applicable; security and tenancy acceptance criteria pass; documentation/migration impacts are complete; and no mock, `NullAdapter`, fabricated external ID, queued database row, or successful socket write is being treated as external confirmation. **A component/story `done` status never by itself means production-, POS-, payment-, KDS- or KOT-ready** — that is a separate, higher-order judgment made in the `_bmad-output/planning-artifacts/` reports and `mvp.md` §9's pilot acceptance criteria.

**Evidence-tier vocabulary** (from `mvp.md` §5 — do not collapse these into one another):

| Term | Meaning |
| --- | --- |
| **Verified** | Real implementation, persistent state, relevant automated tests, no known critical gap in stated scope |
| **Implemented** | Real code path exists, but production/end-to-end evidence is incomplete |
| **Partial** | Some required layers are real; another is missing, disconnected, or unsafe |
| **Prototype** | UI/workflow demonstration backed wholly or partly by mock/local state |
| **Not implemented** | Required capability is absent |
| **Blocked** | Requires a provider decision, credential, hardware, design-partner environment, or declared dependency |

Also keep distinct (per this task's own instructions, not previously consolidated anywhere): **Documented** (a spec exists) ≠ **Implemented** (code exists) ≠ **Unit tested** ≠ **Integration tested** ≠ **Venue tested** (real hardware/real Idealpos) ≠ **Production approved** (a dated, signed launch-gate decision — see `final-launch-approval.md`). No single percentage collapses these; none of the documents in this corpus should be read as awarding one.

**Canonical state machines** (target shape — see `domain-model.md`, not all fields exist in the current Prisma schema yet):
- POS delivery: `QUEUED → CONNECTOR_ACCEPTED → POS_SUBMITTED → POS_CONFIRMED`, or `FAILED` / `UNCERTAIN` / `MANUAL` / `NOT_APPLICABLE`.
- Payment: `NOT_REQUIRED_YET → PENDING → AUTHORIZED → CAPTURED`, or `FAILED` / `CANCELLED` / `REFUND_PENDING` / `PARTIALLY_REFUNDED` / `REFUNDED`.
- Printer job (as of story 8-1): `queued → delivered → printed`, or `manual` / `failed` / `cancelled`. `delivered` ≠ `printed` — see story 8-1.
- These are **independent** — a KDS or POS state must never be inferred from another destination's state (target-operating-model.md §6–§7).

## 3. Traceability Matrix — P0 Requirements

Every row: requirement → architecture mechanism → story → acceptance criteria → verification method → status/dependency.

| Requirement | Architecture | Story | Acceptance criteria | Verification | Status / dependency |
| --- | --- | --- | --- | --- | --- |
| Database-enforced order idempotency + unique payment reference | `architecture.md` §4.6 (Orders Module); `domain-model.md` Order entity | `6-1-order-idempotency-and-payment-linkage` | Story 6-1 ACs 1–7 | Concurrency test (AC5), migration run log | `ready-for-dev`, no blocker |
| Venue connector: mTLS, revocable venue-bound identity, durable local queue, persist-before-ack | `architecture.md` §4.7–4.8 (corrected); target-operating-model.md §8 | `2-9-internal-service-auth` | Story 2-9 ACs 1–10 | Pair/rotate/revoke/replay/outage integration tests (story 2-9 DoD) | `backlog` (story filed), no external blocker for the identity/transport layer itself |
| Idealpos ingress mechanism, licence entitlement, mappings, stable transaction reference | `docs/integrations/idealpos.md` §2–§7 | E9-S3–S7 (per-adapter stories, not yet filed) | To be defined once DL-064 resolves | Vendor-confirmed mapping export; real-Idealpos integration test | `blocked` — DL-064 |
| No fabricated Idealpos "synced" status | `docs/integrations/idealpos.md` §8 (corrected worker logic) | `9-1-pos-sync-truthful-states` | Story 9-1 ACs 1–6 | Test: no code path reaches `synced` without real adapter confirmation | `ready-for-dev`, independent of DL-064 |
| No fabricated printer "printed" status | `docs/printers.md` §5–§7 | `8-1-printer-truthful-states` | Story 8-1 ACs 1–5 | Test: USB/share/local never reach `printed`; TCP write reaches `delivered` only | `ready-for-dev`, no blocker |
| Preparation-station, line-level KDS/KOT routing | `docs/printers.md` §11 | E8-S9 (not yet filed) | To be defined | Routing-version snapshot test | `blocked` — depends on story 8-1 landing first, then Q2 hardware confirmation for real dispatch |
| Standard Idealpos/EFTPOS journey (in-person default) | target-operating-model.md §3 | Not yet filed (depends on DL-064 + story 2-9 + story 9-1) | To be defined | Real-venue E2E test | `blocked` — DL-064 |
| Optional online `PREPAID / ONLINE` journey | target-operating-model.md §4 | E6-S9 (not yet filed) | To be defined | Webhook + reconciliation test | `blocked` — depends on story 6-1 landing first; provider decision per DL-062 |
| Kiosk order creation venue-bound (not open `venueId`) | `orders.gateway.ts`'s existing KDS device-token pattern, extended | E6-S10 (not yet story-filed) | To be defined | Cross-venue rejection test | `backlog` — tracked in `deferred-work.md` |
| RLS real or explicitly removed | `docker-compose.yml`, `backend/prisma/migrations/20260618000001_enable_rls_all_tables` | Not yet filed | To be defined | Cross-tenant query test as non-owner role | `backlog` — tracked in `deferred-work.md` |
| Historic credential rotation confirmed | N/A (external action) | N/A | Confirmation from Supabase project holder | Manual verification | `blocked` — external, P0, independent of code |
| CI/CD pipeline (lint/typecheck/test/migration-diff gate) | — | `1-5-ci-pipeline` | Existing epics.md E1 AC | CI run on a trial PR | `backlog` |

Full enterprise-control and reconciliation-workflow traceability (audit, backup/DR, observability, separation of duties) is carried in `mvp.md` §9.6–9.7 and the `enterprise-security-observability-and-dr` gate in `sprint-status.yaml`; not restated here to avoid duplication.

## 4. Top-Down Human Review Order

For a reviewer inspecting this documentation pass efficiently, in order:

1. **`docs/target-operating-model.md`** — read in full first (94 lines). Everything else is downstream of this.
2. **This index** (`bmad-corpus-index-2026-08-15.md`) — orientation, glossary, traceability.
3. **`docs/decisions-log.md`**, 2026-08-15 section (DL-060–064) — the specific decisions this pass made or corrected, including the DL-046 supersession and the new DL-064 vendor-discovery record.
4. **`docs/epics.md`**, the banners at top plus E6, E8, E9 sections — see exactly what was corrected (NullAdapter-marks-synced removed) and why.
5. **The three new tracer-bullet stories**: `6-1-order-idempotency-and-payment-linkage.md`, `8-1-printer-truthful-states.md`, `9-1-pos-sync-truthful-states.md`, alongside the pre-existing `2-9-internal-service-auth.md` — these four are the highest-priority, no-external-blocker implementation work.
6. **`sprint-status.yaml`** — confirm the new stories are registered and the `enterprise_delivery_gates` block is coherent with what you just read.
7. **`deferred-work.md`**, the new "2026-08-15 target-operating-model conformance audit" section — concrete code-level findings not yet story-filed.
8. **`docs/integrations/idealpos.md`, `docs/offline.md`, `docs/printers.md`** — spot-check the shared-cloud-Redis-to-edge correction (search each for "connector command" — should appear consistently; search for "Redis (cloud)" — should return nothing describing an on-premise agent's connection).
9. **`_bmad-output/planning-artifacts/final-launch-approval.md`** — confirm the launch-gate verdict is consistent with everything above.
10. Root `AUDIT_REPORT.md` / `AUDIT_REPORT_V2.md` — only if historical provenance is needed; both now carry superseded banners.

## 5. Decision Log — Everything Still Requiring User or Vendor Confirmation

Consolidated from `docs/decisions-log.md`, `docs/prd.md`'s `BLOCKED ON` markers, and `docs/integrations/idealpos.md` §11. Each is `BLOCKED` or `UNVERIFIED` until resolved externally — none may be guessed or defaulted in code.

| ID | Question | Owner | Status |
| --- | --- | --- | --- |
| **DL-064 / Q1** | Idealpos version/build, licence/module entitlement, supported order-ingress mechanism, table/PLU/modifier/tax/tender mappings, stable transaction reference, duplicate-KOT suppression capability | Venue owner + Idealpos/Oolio/reseller | `BLOCKED` |
| **Q2** | Printer hardware model/protocol, TCP port confirmation, USB device-path format, DLE EOT status-polling support, paper width | Venue owner (on-site audit) | `BLOCKED` |
| **Q5 (resolved)** | Default in-person payment path | Resolved — target-operating-model.md §3: existing Idealpos-integrated EFTPOS/cash | `RESOLVED` |
| **Q6** | Production hosting provider/DNS control for `admin.`/`api.`/`kiosk.` subdomains | Platform/DevOps owner | `UNVERIFIED` |
| **Verifone/Oolio ecommerce gate** | Is an NZ Verifone/Oolio online-payment product available with sandbox, tokenised capture, signed webhooks, idempotency, refunds, settlement reconciliation, on acceptable commercial terms? | Product/commercial owner | `UNVERIFIED` — Stripe remains MVP default per DL-062 until this resolves |
| **Historic credential rotation** | Have the Supabase `service_role` key and DB password (once present in `backend/.env.direct`/`.env.pooler.bak`, now removed from HEAD but recoverable from git history) been rotated? | Supabase project holder | `UNVERIFIED` — treat as P0 regardless of documentation status |

## 6. What This Pass Changed

- `docs/decisions-log.md`: superseded DL-046 (NullAdapter-marks-synced framing); added DL-064 (formal Idealpos vendor-discovery decision record with owner/evidence/options/consequences/fail-safe/blocking-stories/status fields).
- `docs/integrations/idealpos.md`: fixed the §8 worker snippet to explicitly special-case `none`/NullAdapter → `not_applicable` instead of inheriting `synced` from a generic success boolean; corrected the agent-startup and health-check language away from direct cloud-Redis connection to the connector command/event API.
- `docs/offline.md`, `docs/printers.md`: corrected remaining "connects to Redis (cloud)" language (O1/O2 outage descriptions, §7 offline queue) to the connector-command-API model already used elsewhere in the same documents — this was an internal inconsistency, not just a stale-vs-current gap.
- `docs/epics.md`: corrected E1-S9, E8, E9 to remove the NullAdapter-marks-synced acceptance criterion and cross-reference the new tracer-bullet stories; added E6-S10 stub for kiosk venue-binding; flagged E6-S1's idempotency-key slice explicitly.
- Created three new story files: `6-1-order-idempotency-and-payment-linkage.md`, `8-1-printer-truthful-states.md`, `9-1-pos-sync-truthful-states.md` — each a complete, independently-testable, no-external-blocker vertical slice with the full required story structure (intent, business value, in/out of scope, dependencies, inputs/outputs, happy/failure paths, security/tenancy, observability/audit, migration, testable acceptance criteria, DoD, required evidence).
- `sprint-status.yaml`: registered the three new stories as `ready-for-dev`; added the `order-payment-idempotency-and-truthful-provider-state` enterprise delivery gate.
- `deferred-work.md`: added a dated section capturing code-level findings (RLS-zero-policies, docker-compose default secrets, historic credential exposure, missing staff controller, mock admin pages, concurrency races, broken links, stale root audits, lint failures) verified against current source but not yet story-filed — with evidence, impact, owner and priority per finding, per the deferred-work-discipline requirement.
- `docs/discovery/current-system.md`: fixed one broken absolute `file://` link pointing at a different machine's filesystem.
- Root `AUDIT_REPORT.md` and `AUDIT_REPORT_V2.md`: added superseded banners; `AUDIT_REPORT_V2.md`'s banner also corrects its one stale finding (the `apiClient.js` reservation-fabrication bug, since fixed and replaced by `reservations.js`).
- This index (`bmad-corpus-index-2026-08-15.md`): created as the single authority-hierarchy/glossary/traceability/review-guide/decision-log entry point, satisfying those deliverables without duplicating content already correct elsewhere in the corpus.

**Deliberately left untouched:** the three `_bmad-output/implementation-artifacts/*.md` story files with broken absolute-path links (`2-4-rbac-guard.md`, `2-5-rate-limiting.md`, `2-6-admin-login-page.md`) — preserved as historical evidence per the "preserve historical evidence, but clearly label it superseded when it conflicts with current authority" instruction; these links are cosmetic staleness, not a conflict with current authority, and are logged in `deferred-work.md` for a future editorial pass rather than edited here. Individual "done" story files (e.g. `5-3-capacity-enforcement.md`) were also left untouched — the concurrency-race gap they don't cover is captured in `deferred-work.md` instead of retroactively editing historical review records, consistent with not rewriting provenance.
