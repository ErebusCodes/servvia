# Servvia checkpoint — 2026-10-05 (project paused)

> **PLANNING / EXECUTION-STATE EVIDENCE — NOT REQUIREMENTS AUTHORITY.** Requirements authority is [`PRD/product-requirements.md`](../../../PRD/product-requirements.md) (SPRD) and the normative volumes [`PRD/00`](../../../PRD/00-overview-and-conventions.md)–`PRD/09`. This document records where the project stands so work can resume safely.

**NO NEW WORK SHOULD BEGIN UNTIL THE OWNER RETURNS AND AUTHORIZES RESUMPTION.**

## Files in this checkpoint

| File | Content |
|---|---|
| `README.md` (this) | Current state, decisions, gaps, gates, BMAD state, publication state |
| [`bmad-reconciliation-sprint-change-proposal.md`](bmad-reconciliation-sprint-change-proposal.md) | Frozen BMAD reconciliation target (revision 2 + §17 decisions + §18 checkpoint state) |
| [`proposed-sprint-status-v2.yaml`](proposed-sprint-status-v2.yaml) | Proposed sprint status for Story 14.2 to apply (not active) |
| [`excluded-local-work-inventory.md`](excluded-local-work-inventory.md) | Local work deliberately not published, with its classification |

## 1. Current authoritative state

- **Normative PRD baseline accepted (2026-10-05).** SPRD plus volumes 00–09; the acceptance record is in `PRD/00-overview-and-conventions.md` §00.1.3 and `PRD/README.md`. Supporting documents:
  - `PRD/CONSOLIDATED_PRD.md` and `PRD/fileStructure.MD` are derived;
  - `PRD/PRD_ALIGNMENT.md` is the control plane;
  - `PRD/CHANGELOG-v5.1.md` is the record.
- **Wave A completed.** Commit `5ee6474` integrated the normative PRD onto the accepted lineage and retired `fileRestructure.md`. Its content lives in SPRD Part C, sections 28–36.
- **Accepted engineering lineage on this branch:** Core D1–D13 (implemented, not in production); the evaluator and governance tooling; Stories 1.1–1.5, 1.3, 1.7, 1.8, 2.1–2.11, 8.1, 8.3, 12.3a, 12.5, 12.14 and 12.15; Core staff venue-scope enforcement; fail-closed realtime credential verification; legacy-app retirement.
- **Canonical architecture:**
  - Servvia is the operational POS.
  - Go Core (`services/core-platform`) is the canonical backend over canonical PostgreSQL.
  - Redis is non-canonical.
  - Clients are presentation only.
  - NestJS (`apps/api`) is transitional.
  - External-POS components are transitional and retire.
- **Android: exactly four permanent apps.** `apps/android/{waiter-tablet,kds,kiosk,window-display}`, all README scaffolds today. The Waiter Tablet has Staff Mode and Guest Mode. There is no order-tablet or customer-tablet app.
- **Windows POS** (`apps/windows/pos-terminal`) is a client; its behaviour is frozen pending the owner's POS analysis report.
- **CARD3:** first-pilot card payments go only through the trusted Venue Edge payment adapter.
- **Transitional surfaces:**
  - the Admin Console web Order Tablet (Staff Mode is the temporary pilot settlement surface, ADR 0002);
  - the Admin Console web KDS mode (pilot KDS once moved onto Core, D-1).

## 2. Decisions resolved

| Decision | Result |
|---|---|
| P3 | Effective-dated venue business day (`PRD/00` §00.10.5) |
| P11 | Headline operational sales = Net Sales (incl. GST) (`PRD/00` §00.10.5) |
| O-20 | Native Staff Mode: named staff authentication distinct from device identity; personal PIN for the MVP (`PRD/00` §00.10.6) |
| O-21 | Canonical provenance model: application, device, mode, actor class, actor or guest session, venue, channel, correlation, causation, idempotency (`PRD/00` §00.10.6) |
| DEC-ADMIN-22 | Revocation closes live connections by the revocation event itself (architecture approved) |
| Tier-2 register | 26 decisions (`PRD/00` §00.10.4), plus DEC-OPS-25, DEC-FIN-19 and DEC-WFM-19 |
| D-1 (Tier 2) | The first pilot uses the transitional web KDS migrated to Core; `apps/android/kds` is the permanent target and replaces it later |
| O-10 (Tier 2) | Android baseline: Kotlin 2.x/K2, pinned Gradle and AGP, Kotlin DSL, Compose/M3, JDK 17, version catalog with verification and locking, Hilt, coroutines/Flow, OkHttp, kotlinx.serialization, Room, DataStore, Android Keystore. Versions are pinned and verified in Story 17.1. `minSdk` ≥ 26 |
| D-3 (Tier 2) | The pilot web KDS authenticates to Core with a per-device, venue-bound D8 credential; no human login for ordinary KDS operation |
| KitchenOS scope | Owner-approved long-term capability scope (`TARGET CAPABILITY — FUTURE DELIVERY`); delivery phasing is DEC-X-17 |

## 3. Verified implementation gaps (resolved architecture, not open decisions)

- DEC-ADMIN-22 push-close on revocation. Only the 60-second re-check exists.
- O-21 provenance persistence. Core stores only `source` and the per-round staff ID; events carry no actor, correlation or causation.
- O-20 native implementation. No application-identity claim; no native client; tablet credentials are still issued by Nest under O-2.
- Core kitchen HTTP routes do not accept D8 `kds` device credentials (Story 15.5).
- Core audit writers record staff actors only (DEC-OPS-21).
- P3 business-date assignment: none.
- P11 sales computation and reporting: none.
- Kitchen line-level routing (KIT-1): a single `kitchen` station only.
- Venue Edge: README only.
- Core → Venue Edge card dispatch: none.
- Clients: the web Order Tablet and web KDS still call Nest.
- Android and Windows apps: scaffolds only.

## 4. Pending owner and policy gates

- **Owner (Tier 3):**
  - O-1 (native Waiter Tablet at the pilot);
  - the owner portions of O-3 (card provider, terminal, terms), O-4 (pilot hardware; whether kitchen printing is needed), O-5 (receipt and NZ tax-invoice content), O-6 (pilot close reports);
  - pilot venue and timing.
- **Policy values:** P6 (financial controls), P2 (session, PIN and lockout values).
- **Production gates:** P5 (compliance), P10 (allergen list and acknowledgement).
- **Release gate:** O-19. The inherited targets are the planning baseline; owner confirmation is still required before release acceptance.
- **DL-117 (11 October 2026 milestone) is NOT approved.**

## 5. BMAD state

- The corrected reconciliation (revision 2) is frozen: [`bmad-reconciliation-sprint-change-proposal.md`](bmad-reconciliation-sprint-change-proposal.md).
- **Wave A: completed** (`5ee6474`).
- **Story 14.2 (BMAD re-anchoring): NEXT, NOT STARTED.** It needs fresh authorization. Until it runs, `_bmad/custom/*.toml`, the epic contexts and `_bmad-output/planning-artifacts/epics.md` still name the retired `fileRestructure.md`; that is expected and is not authority.
- **Story 1.9: REWRITE, NOT FROZEN.** The objective may be frozen only after the preconditions in the proposal's §15.
- **Story 1.10: DEFERRED.**

## 6. Publication state (2026-10-05)

- **Branch:** `integration/normative-prd-baseline` on `origin`, pushed without force.
- **Commits on top of `354ea1b`:**
  - `5ee6474` (Wave A);
  - the checkpoint-documentation commit that adds this folder;
  - one follow-up commit recording the pull-request number.
- **Pull request:** open against `main`, **not merged**, no auto-merge.
- **`main`:** not moved (local and remote `main` stay at `a005642`).
- **Validation:** see the pull-request description. In summary:
  - dev-scripts 84/84;
  - evaluator 115/115;
  - Go architecture guard ok;
  - YAML parse ok;
  - PRD manifest 16/16;
  - secret scan reviewed (all findings are test fixtures).
- **No deployment or production action.**

## 7. Resume instruction

**NO NEW WORK SHOULD BEGIN UNTIL THE OWNER RETURNS AND AUTHORIZES RESUMPTION.**

On resumption, the proposed next step is Story 14.2 (BMAD re-anchoring). It requires fresh owner/orchestrator authorization. Merging this branch to `main` is a separate decision.
