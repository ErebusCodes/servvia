# PRD: Servvia requirements source

> **Status:** **APPROVED 2026-10-03 as the normative requirements baseline** (owner gate A; see "Approval" below). Created 2026-10-01 under change record CC-1 of the former `fileRestructure.md`. **Amended 2026-10-05 (owner decision):** `fileRestructure.md` was consolidated into `product-requirements.md` Part C and deleted. **Normative corpus baseline 2026-10-05:** volumes 00–09 accepted under SPRD (see "Normative corpus baseline" below).
> **Purpose:** `PRD/` is the authoritative product and requirements source material from which the fresh official BMAD planning is generated. It is documentation and planning infrastructure, not runtime or product code.
> **Architecture authority:** [`product-requirements.md` Part C](product-requirements.md#part-c-architecture-repository-structure-and-transition) (sections 28–36), which consolidated the former `fileRestructure.md` on 2026-10-05. Where a source document conflicts with it, Part C wins and the requirement is carried forward in technology-neutral form.

## What the baseline contains

The authoritative PRD baseline includes **both**:
- **functional requirements:** Part A, sections 1–14 of `product-requirements.md`;
- **non-functional and enterprise-quality requirements:** Part B, the Enterprise Quality Bar, sections 15–27.

**Future BMAD planning must not omit non-functional requirements because they are cross-cutting.** Depending on the official BMAD workflow, each must appear as one of:
- acceptance criteria;
- dedicated stories;
- technical enablers;
- release gates.

The BMAD Definition of Done and story acceptance standards derive from the Enterprise Quality Bar. **A story is not DONE solely because code exists** (section 26). `[OWNER-QB-2026-10-01]`

## Contents

| File | Role |
|---|---|
| [product-requirements.md](product-requirements.md) | The consolidated current product requirements. Every requirement carries a source tag. |
| README.md (this file) | Source index, provenance, source classification, open conflicts |

**Nothing else is a PRD input.** In particular:
- `docs/planning/` is planning **output**, not an input;
- the old BMAD material (`_bmad/`, `_bmad-output/`) was removed on 2026-10-01 and was not used.

## Source index and provenance

The source documents were inspected in the working tree on 2026-10-01. None was moved, deleted or rewritten.

| Tag | Source | Classification | How it was used |
|---|---|---|---|
| **[FR]** | the former `fileRestructure.md`, consolidated into `product-requirements.md` Part C and deleted on 2026-10-05 (mapping: section 36.2) | **AUTHORITY** (architecture and ownership), now Part C | Product surfaces, technologies, ownership, transitional mapping |
| **[P2]** | `docs/product-requirements.md` (Step 2 draft, 2026-10-01; kept as a bannered **evidence snapshot**, body unchanged, SHA-256 `348eaae4…`) | **SOURCE EVIDENCE, not authority** (corrected 2026-10-03; earlier this row said CURRENT SOURCE) | The backbone of the consolidated PRD: definition, principles, actors, surfaces, domain, capability state, milestones, open items |
| **[TOM]** | `docs/target-operating-model.md` (accepted-baseline version: 2026-08-15, superseded in part by ADR 0001 on 2026-09-28). Corrected 2026-10-03: an unaccepted 2026-09-30 revision was previously named here | **SUPERSEDED IN PART.** §1–3 do not govern; the truthful-state and durable-outbox principles and the non-IdealPOS rules still apply | Order invariant, in-person and online flows, kitchen routing, identifiers and states, failure policy, edge constraints, release acceptance |
| **[ADR]** | `docs/adr/0001-servvia-is-the-operational-pos.md` (cited by Decision item, e.g. `[ADR 7]`) | **CURRENT SOURCE** (accepted decision) | Ownership of canonical state; distinct domain concepts; server pricing; Venue Edge scope |
| **[ADR2]** | `docs/adr/0002-reduced-first-pilot.md` (accepted 2026-10-03; cited by Decision item, e.g. `[ADR2 2]`) | **CURRENT SOURCE** (accepted decision) | Reduced first pilot scope; integrated card required; transitional Staff Mode settlement surface |
| **[DL]** | `docs/decisions-log.md` (accepted full log, cited by entry, e.g. `[DL-115]`). Corrected 2026-10-03: an unaccepted "decisions in force" rewrite was previously named here | **CURRENT SOURCE** for entries in force | Ownership rule (DL-105); DL-115; DL-081 (tablet model, reference); open payment-terminal and receipt obligations |
| **[MIG]** | `docs/migration/README.md`, "Decisions recorded 2026-09-29" | **CURRENT SOURCE** (recorded decisions A and B) | Money and modifier contract (A, B). These were previously tagged `[DL A]`/`[DL B]`, but they are not in the decisions log |
| **[OLD]** | `docs/prd.md` (June 2026 PRD) | **SUPERSEDED IN PART** | Functional and non-functional requirements carried forward only where they do not conflict with [FR], [TOM] or [ADR]. Stack-specific wording (NestJS, Prisma, BullMQ, browser-based devices, Service Worker) is superseded by [FR]. The original IDs (FR-x.y, NFR-x.y) are kept as provenance |
| **[MVP]** | `docs/mvp.md` (accepted-baseline version: 2026-08-15 assessment). Corrected 2026-10-03: an unaccepted "2026-09-30 header" revision was previously named here | **SUPERSEDED IN PART** | The principles and pilot acceptance criteria that are consistent with "Servvia is the POS" are carried forward. Its multi-POS integration buying thesis is not (conflict C-1) |
| **[BR]** | `PRODUCT.md` | **CURRENT SOURCE** (public web brand) | Customer website and landing page users, purpose, principles, accessibility |
| **[DS]** | `DESIGN.md` | **CURRENT SOURCE** (public web design system) | Referenced for web visual requirements; values are not duplicated |
| **[REPO]** | The repository: implemented Servvia Core behaviour and tests | **EVIDENCE** of existing capability | Referenced so that proven behaviour (idempotency, locking, transactional events, audit, workers, tenant-scoped tests) is required and not rebuilt. Never a source of new product requirements |
| **[OWNER-QB-2026-10-01]** | The owner's enterprise-quality instruction of 2026-10-01 | **CURRENT SOURCE** (owner instruction) | Part B: the Enterprise Quality Bar, security, integrity, reliability, performance dimensions, observability, testing, UX, accessibility, release gates, defect policy, DoD input, NFR matrix. It does not set numbers: missing targets are **OWNER TARGET REQUIRED** and unapproved policies are **OWNER DECISION REQUIRED** |
| — | `docs/ux.md`, `docs/offline.md`, `docs/printers.md`, `docs/domain-model.md`, `docs/architecture.md`, `docs/source-of-truth-and-environments.md` | **REFERENCE, not consolidated** | Self-described as target designs or inferred UX (2026-06/08). Only their headers and normative banners were inspected. Their detail is design material for later stories, not requirements. **Classified 2026-10-03 (R-1): design and reference evidence, not requirements authority.** Any normative rule they contain must be represented in an authoritative requirement or decision before implementation depends on it |
| — | `docs/epics.md`, `docs/sprints.md` | **NOT A SOURCE** | Earlier planning output |
| — | `docs/planning/` | **NOT A SOURCE** | Planning output (CC-1) |

## Supersession

**No source document has been retired yet.** After this `PRD/` baseline is approved, the owner decides whether each of `docs/product-requirements.md`, `docs/prd.md` and `docs/mvp.md` is:
- marked superseded by `PRD/`;
- archived; or
- kept as history.

## Open conflicts between sources

The consolidated PRD does not resolve these silently. Each is either an owner decision or resolved by the stated authority.

| ID | Conflict | Current handling |
|---|---|---|
| C-1 | [MVP] defines the MVP buyer and goal as cross-system integration for multi-POS restaurant groups (provider mapping, ingestion from other POS). [ADR], [TOM] and [FR] make Servvia the POS, with no external POS. | Resolved by [ADR]/[FR]: the integration wedge is **not** carried forward. The commercial target customer for Servvia-as-POS is **open** (O-12). |
| C-2 | [OLD] specifies browser-based kiosk, entrance display and KDS, plus a NestJS/Prisma/BullMQ stack. [FR] fixes Kotlin/Android devices and Go Core. | Resolved by [FR]. Behavioural requirements are carried forward technology-neutral; the current web apps are transitional. |
| C-3 | [OLD] FR-6.8: "no authentication required to view the KDS". The implemented Core (D8 device credentials, KDS realtime authorization) and [MVP] 9.6 require authenticated, revocable KDS devices. | **Owner decision** (O-13). The consolidated PRD keeps authenticated devices as the default. **Resolved 2026-10-05** `[ORCH-T2-2026-10-05]`: O-13 decided (Tier 2, not an owner decision) — per-device, venue-bound D8 KDS identity; the old no-auth requirement is not adopted (volume 00 §00.10.7). |
| C-4 | [OLD] FR-1.1 and NFR-8: public website frozen pixel-for-pixel. [DS]: "refined with Apple-inspired precision; layouts, navigation, responsive behaviour and customer workflows remain unchanged". | **Owner decision** (O-14). The consolidated PRD keeps journeys and layouts stable and leaves visual refinement per [DS] open. |
| C-5 | Naming. [OLD] describes "Verdura", a restaurant in Auckland. [BR] describes "Servvia's Middleterrean dining identity" for the public site. [FR] and [P2] use Servvia as the product/platform name. | **Owner decision** (O-15): the venue brand versus the platform name for public web surfaces. |
| C-6 | [OLD] FR-2.7, 2.8 and 2.12 (reservation Google Calendar sync; Stripe Checkout for reservation payments) are not reflected in [TOM] or [FR]. | Carried forward as SHOULD and marked open (O-16). |
| C-7 | [MVP] 9.3 "86 propagates to at least two real configured channels": under [ADR] the channels are Servvia's own surfaces, not external systems. | Carried forward as availability propagation to Servvia channels. The exact channels and targets are **open** (O-17). |
| C-8 | [BR] mentions "menu pre-orders" on the public site, and [OLD] FR-2.3 has pre-selected items on reservations. [TOM] section 4 defines an online/prepaid order flow. Whether public web online ordering is in scope is not stated anywhere. | **Open** (O-18). |
| C-9 | The numeric targets inherited into Part B (API P95 under 200 ms, order submission P95 under 500 ms, KDS under 3 s, print under 3 s, Admin load under 2 s, kiosk navigation under 1 s, 99.5% availability) come from `[OLD]`, which is **superseded in part**. They were set for the NestJS stack and a single venue. | Kept with provenance, as instructed. **Owner to confirm** they remain the approved targets for the Go Core architecture (O-19). *2026-10-05: O-19 reclassified as BASELINE ACCEPTED FOR PLANNING — OWNER MAY REVISE THROUGH CONTROLLED CHANGE; owner confirmation still pending before release acceptance.* |

## Open items for this baseline

- **R-1:** *Decided for now (2026-10-03):* `docs/ux.md`, `docs/offline.md` and `docs/printers.md` remain design and reference evidence only. They are not consolidated.
- **R-2:** Owner review of the source classifications above.
- **R-3:** Set every **OWNER TARGET REQUIRED** value and decide every **OWNER DECISION REQUIRED** policy in Part B. The list is in `product-requirements.md` sections 15–27.

## Provenance status (2026-10-03)

Source citations were reconciled against the accepted baseline (`54dcfc0`, plus the CC-3 working changes).
- Citations that named unaccepted revisions of `[TOM]`, `[DL]` or `[MVP]` were retagged only where an accepted source carries the same meaning (ADR 0001 items, `[MIG]`, `[FR]`, `[REPO]`, `[DECISION-2026-10-03]`). No requirement text was changed to make a citation fit.
- No unaccepted revision is cited as authority.

**Resolved 2026-10-03 by Tier-2 governance decision** (`[DECISION-2026-10-03]`; no `†` remains):

| Requirement | Was | Resolution |
|---|---|---|
| ORD-4 | `[MVP 9.1]†`: legacy POS-handoff wording ("missing menu or station configuration … reconciliation task") | **Reworded** to Core's actual validation behaviour: refused with a stable, specific error; no order created. Sources `[ADR 5] [MVP §2] [REPO]` (typed pricing errors in `services/core-platform/internal/pricing/errors.go`; every venue routes to the default station, so "missing station configuration" cannot occur). POS mapping and the "reconciliation task" are removed as legacy |
| ORD-5 | `[TOM §3]†`: "opens or joins a check" | **Reworded** to canonical semantics: ordering does not open or modify a check; a check is created separately over the visit's unbilled lines. Sources `[ADR 4] [REPO]` (`docs/migration/d5-checks.md`) |
| PRT-1 | `[MVP 9.5]†`: "reprints … attributed" unsourced | **Kept.** Attribution follows from NFR-AUD and section 17 traceability `[TOM §6]`; explicit reprints from `[OLD FR-8.6]`. Source repaired; no new behaviour |

**Not yet accepted:** the `[P2]` evidence snapshot exists in the working tree but is not committed. Its 36 content citations become valid source evidence when it is committed.

**Production-cutover rule (section 11):** sourced to `[DECISION-2026-10-03]` and the owner's approval of this baseline. It does **not** depend on the separate, still unapproved decision about the 11 October 2026 milestone (draft DL-117), which is not a source of this PRD.

**O-2:** decided 2026-10-03 (transitional credential issuance under PR-7). See the O-2 row in `product-requirements.md` section 14.

## Approval (2026-10-03)

**Decision:** APPROVE PRD BASELINE (owner gate A). The owner delegated this decision to engineering judgment, and it was recorded through the project's decision orchestration on 2026-10-03.

What the approval means:
1. `PRD/README.md` and `PRD/product-requirements.md` are the **normative requirements authority** for Servvia planning and implementation.
2. **Every open item stays unresolved.** That covers each OWNER DECISION REQUIRED and OWNER TARGET REQUIRED item, the open decisions in section 14 of `product-requirements.md`, R-3, and the PENDING USER POS ANALYSIS REPORT freeze. This approval decides none of them.
3. **Any story that depends on an unresolved item is BLOCKED** until that item is decided through controlled change.
4. **Architecture authority remains `fileRestructure.md`.** *Amended 2026-10-05 (owner decision): architecture authority is now Part C of `product-requirements.md`, into which `fileRestructure.md` was consolidated before it was deleted.* Accepted ADRs and decisions-log entries may amend or supersede specific requirements, but only through recorded, cross-referenced controlled change.
5. **Historical documents are evidence only**, never requirements authority. This includes the `[P2]` snapshot and the legacy `docs/` planning material.
6. This approval does not itself accept ADR 0002 or adopt the production-readiness audit. Those are separate decisions.

## Normative corpus baseline (2026-10-05)

**SERVVIA PRD NORMATIVE BASELINE ACCEPTED** on 2026-10-05.

- **Scope:** volumes 00–09 become normative refinements of `product-requirements.md` (SPRD), which still wins on any conflict. `CONSOLIDATED_PRD.md` and `fileStructure.MD` remain derived; `PRD_ALIGNMENT.md` remains a control document; the changelog remains a record.
- **Decision provenance:**
  - owner-approved product direction: the 2026-10-03 baseline approval above, P3 and P11, and the KitchenOS capability scope (`[OWNER-KOS-2026-10-05]`);
  - orchestrator Tier-2 architecture ratification (`[ORCH-T2-2026-10-05]`): the 26 decisions of volume 00 §00.10.4, then O-20, O-21, DEC-OPS-25, DEC-FIN-19 and DEC-WFM-19, then O-10 and O-13 (volume 00 §00.10.7);
  - acceptance recorded on orchestrator instruction after verification (volume 00 §00.1.3). It is not attributed to the owner.
- **Retained downstream gates (not owner-approved):** P5 compliance posture (before production or any compliance commitment); P6 financial control values (before pilot enablement of the affected controls); P10 guest-safety configuration (before relevant production use); O-19 owner confirmation (before release acceptance); and every other open item listed in `PRD_ALIGNMENT.md` §7.
- **It does not mean:** that future-delivery capabilities are committed to a release, that policy values are selected, that implementation is complete, that production or release is approved, that any compliance regime is certified, or that DL-117 is approved (it is not).
