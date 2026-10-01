# PRD: Servvia requirements source

> **Status:** Baseline draft, created 2026-10-01 under change record CC-1 of [`fileRestructure.md`](../fileRestructure.md). **Awaiting owner review.**
> **Purpose:** `PRD/` is the authoritative product and requirements source material from which the fresh official BMAD planning is generated. It is documentation and planning infrastructure, not runtime or product code.
> **Architecture authority:** [`fileRestructure.md`](../fileRestructure.md). Where a source document conflicts with it, `fileRestructure.md` wins and the requirement is carried forward in technology-neutral form.

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
| **[FR]** | `fileRestructure.md` | **AUTHORITY** (architecture and ownership) | Product surfaces, technologies, ownership, transitional mapping |
| **[P2]** | `docs/product-requirements.md` (Step 2 baseline, 2026-10-01) | **CURRENT SOURCE** | The backbone of the consolidated PRD: definition, principles, actors, surfaces, domain, capability state, milestones, open items |
| **[TOM]** | `docs/target-operating-model.md` (revised 2026-09-30) | **CURRENT SOURCE** (it declares itself normative) | Order invariant, in-person and online flows, kitchen routing, identifiers and states, failure policy, edge constraints, release acceptance |
| **[ADR]** | `docs/adr/0001-servvia-is-the-operational-pos.md` | **CURRENT SOURCE** (accepted decision) | Ownership of canonical state; distinct domain concepts |
| **[DL]** | `docs/decisions-log.md` (decisions in force) | **CURRENT SOURCE** | Money and modifier contract (A, B); truthfulness; ownership rule; open payment-terminal and receipt obligations |
| **[OLD]** | `docs/prd.md` (June 2026 PRD) | **SUPERSEDED IN PART** | Functional and non-functional requirements carried forward only where they do not conflict with [FR], [TOM] or [ADR]. Stack-specific wording (NestJS, Prisma, BullMQ, browser-based devices, Service Worker) is superseded by [FR]. The original IDs (FR-x.y, NFR-x.y) are kept as provenance |
| **[MVP]** | `docs/mvp.md` (2026-08-15 assessment, 2026-09-30 header) | **SUPERSEDED IN PART** | The principles and pilot acceptance criteria that are consistent with "Servvia is the POS" are carried forward. Its multi-POS integration buying thesis is not (conflict C-1) |
| **[BR]** | `PRODUCT.md` | **CURRENT SOURCE** (public web brand) | Customer website and landing page users, purpose, principles, accessibility |
| **[DS]** | `DESIGN.md` | **CURRENT SOURCE** (public web design system) | Referenced for web visual requirements; values are not duplicated |
| **[REPO]** | The repository: implemented Servvia Core behaviour and tests | **EVIDENCE** of existing capability | Referenced so that proven behaviour (idempotency, locking, transactional events, audit, workers, tenant-scoped tests) is required and not rebuilt. Never a source of new product requirements |
| **[OWNER-QB-2026-10-01]** | The owner's enterprise-quality instruction of 2026-10-01 | **CURRENT SOURCE** (owner instruction) | Part B: the Enterprise Quality Bar, security, integrity, reliability, performance dimensions, observability, testing, UX, accessibility, release gates, defect policy, DoD input, NFR matrix. It does not set numbers: missing targets are **OWNER TARGET REQUIRED** and unapproved policies are **OWNER DECISION REQUIRED** |
| — | `docs/ux.md`, `docs/offline.md`, `docs/printers.md`, `docs/domain-model.md`, `docs/architecture.md`, `docs/source-of-truth-and-environments.md` | **REFERENCE, not consolidated** | Self-described as target designs or inferred UX (2026-06/08). Only their headers and normative banners were inspected. Their detail is design material for later stories, not requirements. Consolidating them is a follow-up (open item R-1) |
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
| C-3 | [OLD] FR-6.8: "no authentication required to view the KDS". The implemented Core (D8 device credentials, KDS realtime authorization) and [MVP] 9.6 require authenticated, revocable KDS devices. | **Owner decision** (O-13). The consolidated PRD keeps authenticated devices as the default. |
| C-4 | [OLD] FR-1.1 and NFR-8: public website frozen pixel-for-pixel. [DS]: "refined with Apple-inspired precision; layouts, navigation, responsive behaviour and customer workflows remain unchanged". | **Owner decision** (O-14). The consolidated PRD keeps journeys and layouts stable and leaves visual refinement per [DS] open. |
| C-5 | Naming. [OLD] describes "Verdura", a restaurant in Auckland. [BR] describes "Servvia's Middleterrean dining identity" for the public site. [FR] and [P2] use Servvia as the product/platform name. | **Owner decision** (O-15): the venue brand versus the platform name for public web surfaces. |
| C-6 | [OLD] FR-2.7, 2.8 and 2.12 (reservation Google Calendar sync; Stripe Checkout for reservation payments) are not reflected in [TOM] or [FR]. | Carried forward as SHOULD and marked open (O-16). |
| C-7 | [MVP] 9.3 "86 propagates to at least two real configured channels": under [ADR] the channels are Servvia's own surfaces, not external systems. | Carried forward as availability propagation to Servvia channels. The exact channels and targets are **open** (O-17). |
| C-8 | [BR] mentions "menu pre-orders" on the public site, and [OLD] FR-2.3 has pre-selected items on reservations. [TOM] section 4 defines an online/prepaid order flow. Whether public web online ordering is in scope is not stated anywhere. | **Open** (O-18). |
| C-9 | The numeric targets inherited into Part B (API P95 under 200 ms, order submission P95 under 500 ms, KDS under 3 s, print under 3 s, Admin load under 2 s, kiosk navigation under 1 s, 99.5% availability) come from `[OLD]`, which is **superseded in part**. They were set for the NestJS stack and a single venue. | Kept with provenance, as instructed. **Owner to confirm** they remain the approved targets for the Go Core architecture (O-19). |

## Open items for this baseline

- **R-1:** Consolidate requirement-level content from `docs/ux.md`, `docs/offline.md` and `docs/printers.md`, or confirm they remain design references only.
- **R-2:** Owner review of the source classifications above.
- **R-3:** Set every **OWNER TARGET REQUIRED** value and decide every **OWNER DECISION REQUIRED** policy in Part B. The list is in `product-requirements.md` sections 15–27.
