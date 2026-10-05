# Servvia PRD corpus — change log, v5.1 (Servvia)

> **Record, not authority.** Material, decision-relevant changes only. The label "v5.1" was named by the owner for this Servvia corpus; it is not a continuation of the Verdura document series (see DEC-X-14).

## 2026-10-05 — Tier-2 ratification applied; normative PRD baseline accepted

**Orchestrator verdicts:** KitchenOS assimilation ACCEPTED; final blocker analysis ACCEPTED; O-20, O-21, DEC-OPS-25, DEC-FIN-19 and DEC-WFM-19 ratified as Tier 2 (orchestrator authority, not owner decisions); normative acceptance instructed subject to verification. **Result: SERVVIA PRD NORMATIVE BASELINE ACCEPTED.**

| Change | Where |
|---|---|
| O-20 decided: named staff authentication distinct from device identity; personal staff PIN for the MVP (not permanent architecture); elevation bound to staff, device, venue and application; scope intersection; least privilege; distinct step-up; short-lived, no silent refresh; ends on exit or logout; revocation and lost-device semantics; platform-secure storage; no offline elevation; audited; Guest Mode never receives staff credentials; Windows POS not covered. Session values are P2 policy; DL-081 20 min / 5 min are transitional defaults | SPRD WT-5, §14, §32; 00 §00.10.6; 02 OPS-41; 06; 09 ADMIN-14 |
| O-21 decided: explicit canonical provenance (application, device, mode, actor class, actor or guest session, venue, channel, transaction, correlation, causation, idempotency); per-round, immutable, replay-preserving, server-established; assistance recorded only where an assisted workflow exists; system actors never borrow staff identity; `waiter_tablet` = application family, `order_tablet` readable but not emitted by native clients; no destructive migration. Guest Mode menu display policy stays open (P9) | SPRD WT-6, §14, §32, §33; 00 INV-5, §00.10.6; 02 OPS-2, OPS-40, OPS-69, WF-OPS-4 |
| DEC-OPS-25, DEC-FIN-19, DEC-WFM-19 marked APPROVED — TIER 2 (mechanism only) | 00 §00.10.4; 02; 07; 06 |
| O-19 reclassified: BASELINE ACCEPTED FOR PLANNING — OWNER MAY REVISE THROUGH CONTROLLED CHANGE; owner confirmation pending before release acceptance; no value changed | SPRD §14, §19, §27; README C-9; 00 §00.6 |
| P5, P6, P10 recorded as downstream gates (not acceptance blockers, not owner-approved); DEC-OPS-3 reclassified: no overbooking is authoritative (RES-3), an override is an optional FUTURE decision | PRD_ALIGNMENT §7; 02 DEC-OPS-3 |
| Normative acceptance recorded: every volume's acceptance line, 00 §00.1.2 authority column, new 00 §00.1.3 record, README "Normative corpus baseline", SPRD header; new tag `[ORCH-T2-2026-10-05]` | 00–09; README; SPRD |
| Control plane: authority table, mismatch rows (staff PINs, order provenance), §7 (open decisions 25, all Tier 3; implementation blockers incl. O-20 and O-21), §9 | PRD_ALIGNMENT |

**Not changed:** every numeric target (99.5 % unchanged; KitchenOS figures not adopted); P3 and P11; CARD3; Windows POS freeze; exactly four Android apps; Nest, Admin Console and external POS remain TRANSITIONAL; DL-117 NOT approved; P5, P6, P10 and O-19 are not owner-approved; BMAD paused.

## 2026-10-05 — KitchenOS capability assimilation; PRD acceptance reopened and reassessed

**Owner decision:** every genuine product capability in KitchenOS belongs to Servvia's long-term product. The earlier conclusion "acceptance gate satisfied" (entry below) is **SUPERSEDED**; status became `PRD ACCEPTANCE REOPENED — KITCHENOS CAPABILITY ASSIMILATION REQUIRED`, and the assimilation below was performed. KitchenOS is capability evidence only (sha256 `b8560431…9790d`); its architecture, numbers, compliance assertions, phases and commercial plans were not adopted.

| Change | Where |
|---|---|
| New state `TARGET CAPABILITY — FUTURE DELIVERY` (owner-approved long-term scope, not committed current delivery); FUTURE redefined as a non-approved candidate; basis code `K(Lnnn)` | 00 §00.4 |
| INV-21 (AI control model: prediction, recommendation, assisted, autonomous; autonomous high-impact action forbidden until DEC-X-19) and INV-22 (jurisdiction and locale packs; no regulatory output without a validated pack) | 00 §00.5 |
| DEC-X-1 split: inclusion RESOLVED; delivery phasing and order is new DEC-X-17. New DEC-X-18 (commercial platform capabilities), DEC-X-19 (autonomous AI) | 00 §00.10 |
| SPRD: additive header note and tag `[OWNER-KOS-2026-10-05]`; §13 long-term target scope bullet; O-9 and O-18 inclusion resolved; O-16 calendar-sync inclusion resolved (card payments open). No SPRD requirement, number or decision text removed | SPRD |
| 145 requirements relabelled from FUTURE/DEFERRED and 6 from OWNER DECISION REQUIRED to the new state; 37 requirements, 39 acceptance criteria, 8 decisions added (DEC-OPS-24, DEC-ADMIN-24 Tier 3; DEC-OPS-25, DEC-FIN-19, DEC-WFM-19 Tier 2, not approved) | 01–09 |
| WFM-29 rewritten: payroll calculation only through a validated jurisdiction pack or accepted provider adapter (DEC-WFM-19); no shipped jurisdiction rules; no compliance claim | 06 |
| Not KitchenOS-described, therefore unchanged: visit merge and split, catering, command search, central kitchen, stored value, memberships, leave (DEFERRED), tip pooling, performance notes | 01–06 |
| Stale labels corrected: BI-5, BI-8, BI-14; DEC-X-16 rows in 08; ADMIN-21, ADMIN-49, CRM-41 wording; the P7 gate row now cites DEC-X-9 for RPO/RTO | 05, 08, 09, PRD_ALIGNMENT |
| Control plane: §5 source governance, §6 counts, §7 reassessed gate (open 29, none blocking acceptance) | PRD_ALIGNMENT |
| Capability map re-derived | fileStructure.MD |

**Not changed:** P3 and P11 rules; the Tier-2 register; approved numbers (99.5 % availability; O-19 open; no KitchenOS number adopted); CARD3; Windows POS freeze; exactly four Android apps; DL-117 not approved; volumes remain PROPOSED; BMAD paused.

## 2026-10-05 — Owner decisions P3 and P11 recorded; acceptance gate satisfied (conclusion superseded by the KitchenOS entry above)

| Change | Where |
|---|---|
| P3 business-day rule recorded: effective-dated venue boundary in venue time zone; organization default with venue override; no universal hour; prospective changes only; deterministic assignment independent of day close; UTC preserved; DST reproducible; consistent use across orders, checks, shifts, settlements, reports and exports. DEC-X-3 resolved; INV-8 updated | 00 §00.10.5, INV-8 |
| FIN-31 corrected: business-date assignment is deterministic and never rewritten (previously "immutable once that business date is closed", which tied assignment to close). FIN-32, WF-FIN-8, AC-FIN-33 and the DayClose object no longer wait on DEC-X-3; close rules stay O-6 / DEC-FIN-10 | 07 |
| P11 recorded: headline operational sales measure is Net Sales (incl. GST), meaning finalized billed sales less discounts/comps and refunds/returns, with refunds on their own business date; sales are separate from tenders, settlement and accounting revenue; components separately reportable. DEC-BI-1 resolved; DEC-BI-3 resolved for refunds and returns | 00 §00.10.5; 08 BI-3, BI-7, BI-18, BI-21, 08.12 |
| Residual reporting and close details listed individually under the pilot-reporting gate: DEC-FIN-10, DEC-BI-2, DEC-BI-4, DEC-BI-11 | 07, 08, PRD_ALIGNMENT §7 |
| Acceptance gate satisfied: 22 open decisions, all Tier 3, each with a later gate | PRD_ALIGNMENT §7 |

**Not changed:** accounting revenue recognition (DEC-FIN-2) and day-close rules (O-6) remain open; SPRD; approved numbers (O-19 open); CARD3; Windows POS freeze; DL-117 not approved; O-20 and O-21 open; volumes remain PROPOSED.

## 2026-10-05 — Tier-2 approval recorded; acceptance gate narrowed to P3 and P11

**Orchestrator verdict:** ACCEPT. All 26 Tier-2 decisions are approved or resolved at the mechanism level. Unresolved decisions: 20, all Tier 3.

| Change | Where |
|---|---|
| Approved Tier-2 register added (invariant, policy left open, reversible Tier-1 default) | 00 §00.10.4 |
| Decision rows of the 24 newly approved items, and DEC-HOME-1 (consolidated into DEC-BI-8), marked APPROVED — TIER 2 | 00, 01, 02, 07, 08, 09 |
| 15 requirements gated only on approved decisions moved from ARCHITECTURE DECISION REQUIRED to TARGET; remaining policy noted (HOME-22, OPS-10, OPS-21, OPS-23, OPS-31–35, OPS-45, FIN-22, BI-14, ADMIN-7, ADMIN-10, ADMIN-40) | 01, 02, 07, 08, 09 |
| OPS-46 relabelled OWNER DECISION REQUIRED (it depends on DEC-OPS-10, which is Tier 3 in package P9) | 02 |
| DEC-RCP-5 reclassified as a compliance/configuration decision required before relevant production use; RCP-1 keeps the mechanism and states that no list is fixed by the PRD | 03 |
| Acceptance gate: only P3 and P11 block PRD acceptance; P1 and P10 do not; P6 is pilot-gated | PRD_ALIGNMENT §7 |

**Not changed:** SPRD; approved numbers (O-19 open); CARD3; Windows POS freeze; DL-117 not approved; volumes remain PROPOSED.

## 2026-10-05 — Tier-2 decision-boundary correction

**Orchestrator verdict:** decision audit accepted. Tier-2 recommendations must not decide Tier-3 policy. Volumes 00–09 remain PROPOSED; BMAD remains paused.

| Change | Why |
|---|---|
| Volume 00: Tier-1 default and Tier-2 boundary defined; new readiness classification `DECISION RESOLVED — IMPLEMENTATION BLOCKER` | Mechanism versus policy; resolved but unbuilt items stay visible without counting as open decisions |
| OPS-51 and DEC-OPS-12: AVL-1 applies whenever a Window Display represents availability; general content keeps the 60 s refresh; AVL-1 not weakened | Conceptual resolution accepted |
| DEC-ADMIN-22 marked approved at architecture level; implementation incomplete | Orchestrator approval |
| Tier-2 docket (review evidence) rewritten as invariant / policy left open / Tier-1 default. Void, cancel and comp permissions, step-up and thresholds, and comp semantics moved to P6. Routing precedence, reporting topology, guest-session lifetimes and Venue Edge pairing details demoted to Tier-1 defaults. Print evidence model no longer implies printers can always confirm completion. Email-first notification rollout removed from architecture | No silent business policy |
| PRD_ALIGNMENT §7 restructured into the acceptance gate (A–E); unresolved decisions 44 | Clear separation of approval, acceptance, pilot and deferred decisions |

**Proposed SPRD amendment (not applied):** WD-1 wording, so that availability on window displays follows AVL-1. It needs controlled change of the approved SPRD.

**Not changed:** SPRD text and numbers; CARD3; Windows POS freeze; DL-117 not approved.

## 2026-10-05 — Decision audit and acceptance-gate corrections

**Orchestrator verdict:** corpus accepted as a review candidate, not as normative. Volumes 00–09 remain PROPOSED and BMAD remains paused.

**Decision audit:** 178 decisions were reclassified, leaving 46 unresolved:
- 10 already decided;
- 5 Tier 1;
- 2 derived requirements;
- 59 duplicates;
- 56 future/deferred (non-blocking);
- 26 Tier 2, with resolutions recommended but not approved;
- 18 Tier 3;
- 2 Tier 3 blocked by the POS analysis.

The Tier-3 items are grouped into 13 owner packages (PRD_ALIGNMENT §7).

**Narrow corrections:**

| Change | Why |
|---|---|
| DEC-X-10 recorded as WITHDRAWN instead of an unexplained gap | A reserved identifier must not look like a broken reference |
| DEC-X-13 reframed: Core ownership of any committed domain is already decided (INV-1, SPRD §29); only Part C package naming remains, at commitment | Prevents reopening the canonical architecture as an owner question |
| ADMIN-33, AC-ADMIN-8, AC-ADMIN-15 and DEC-ADMIN-22: revocation closes live connections by the revocation event itself; the 60 s periodic re-check is a CURRENT deficiency, not a permitted delay | The requirement drives implementation; it must not legitimise a gap |
| PRD_ALIGNMENT §4, §7, §9 updated with the audit, the pilot-blocking set and the owner docket | Control-plane accuracy |

**Not changed:** SPRD; approved numbers (O-19 still open); CARD3; Windows POS freeze; DL-117 not approved.

## 2026-10-05 — Enterprise PRD hardening pass (corpus created)

**State before:** the fourteen corpus files existed as empty placeholders (0 bytes). [`product-requirements.md`](product-requirements.md) (SPRD) was the only requirements document. Earlier the same day, the former `fileRestructure.md` had been consolidated into SPRD Part C by owner decision.

**Source governance:**
- The populated Verdura v5.2 PRD (repository `ErebusCodes/verdura`; working copy with three uncommitted PRD changes; every file SHA-256-hashed before use) was mined as **non-authoritative domain evidence**, by owner and orchestrator decision.
- 684 source rows were classified before use: ADOPT, ADAPT, TRANSITIONAL, SUPERSEDED, OUT OF SCOPE, OWNER DECISION REQUIRED or ARCHITECTURE DECISION REQUIRED. The migration matrices are kept as evidence outside the repository.
- Verdura's product thesis is recorded as superseded in volume 00 §00.3 and was not carried forward: a provider-neutral layer beside the POS; the POS as fiscal authority; POS hand-off; phase gates; browser device targets; a separate customer order tablet.

**What changed and why:**

| Change | Why | Where |
|---|---|---|
| Created conventions, twenty cross-domain invariants, a shared-capability map, release-readiness rules and a cross-cutting decision register | One authoritative set of invariants instead of per-volume repetition | 00 |
| Created nine domain volumes (Home through Administration) on a fourteen-section enterprise template: state, ownership, lifecycles, requirements, failure paths, security, data, reliability, UX, acceptance criteria, metric definitions, decisions | The owner asked for complete domain definitions at enterprise quality | 01–09 |
| Labelled every capability CURRENT, TRANSITIONAL, TARGET, FUTURE, DEFERRED, REMOVED or decision-dependent; Core D1–D13 recorded as "implemented in Core, not in production" | Never present a target as implemented, or debt as target | 00.4.3, all volumes |
| Deferred domains (recipe, materials, CRM, workforce, finance sub-ledger, BI forecasting) documented in depth as FUTURE/DEFERRED, with scope as DEC-X-1 | SPRD §13 defers them; the owner wants their models defined | 03–08 |
| Separated mechanism from policy throughout: thresholds, rates, retention, tax, labour, accounting, business-date and negative-stock rules exposed as decisions | No invented business policy (INV-20) | all volumes |
| Strengthened security, separation of duties, provenance, idempotency, concurrency, failure paths, observability and data classification per domain | Enterprise quality bar (SPRD Part B) applied concretely | NN.7–NN.11 |
| Added a metric catalogue with unambiguous definitions (ordered, billed, settled and collected bases; GST-inclusive or exclusive) | Every KPI must be reproducible | 08.12 |
| Recorded verified current-state gaps as decisions, not silent fixes: no order cancel/void in Core; single kitchen station; Core audit requires a staff actor; no kiosk channel or device kind; allergen list enforced only client-side; revocation latency of 60 s versus SPRD "immediately"; WD-1 refresh versus AVL-1 | Truthful current state; Tier-2 escalation | 02, 03, 09; PRD_ALIGNMENT §4 |
| `CONSOLIDATED_PRD.md` made a generated, non-editable view with source fingerprints | Prevent dual authority | CONSOLIDATED_PRD |
| `fileStructure.MD` made a derived reference of SPRD Part C plus a capability map; no fifth Android app; removed directories listed as removed | Prevent resurrecting deleted structure or a second architecture authority | fileStructure.MD |
| `PRD_ALIGNMENT.md` created as the corpus control plane | Alignment, gaps, decisions and readiness in one place, with no requirement text | PRD_ALIGNMENT |

**Not changed:**
- SPRD requirements, IDs, decisions O-1 to O-21, and approved numbers. The SPRD numbers are restated only in 00.6, and O-19 still gates them.
- CARD3 (the trusted payment adapter, D6 integrated card).
- The Windows POS freeze (no POS screens, workflows, hardware or offline behaviour defined).
- DL-117 remains not approved.
- No Verdura-only number was adopted; such figures appear only as "proposed (Verdura evidence)" under owner-target decisions.

**Decisions exposed, not made:** 178 (15 cross-cutting, 163 domain): 48 Tier 2, 121 Tier 3, 9 split.

**Acceptance state:** volumes 00–09 are PROPOSED pending review and owner acceptance; SPRD alone remains normative until then.
