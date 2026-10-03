# ADR 0002: Reduced first pilot

- **Status:** **Accepted, 2026-10-03.** Owner gates C (PILOT-CARD-3, integrated card required) and D (accept), decided under the owner's delegation to engineering judgment and recorded through the project's decision orchestration. Proposed earlier the same day (commit `27e4178`).
- **Decisions-log entry:** [DL-118](../decisions-log.md)
- **Relates to:** [ADR 0001](0001-servvia-is-the-operational-pos.md); `PRD/product-requirements.md` sections 4, 8, 11 and 14 (amended by this ADR in sections 8 and 11); the production-readiness audit `docs/audits/production-readiness-2026-12.md`.

## Context

The 31 December 2026 objective is a **staging release candidate**, not a production-complete broad POS. The first independent Servvia pilot in PRD section 11 requires:
- an integrated card terminal through Venue Edge;
- receipt printing, and kitchen printing if the venue requires it;
- a cash drawer.

The main POS terminal is the Windows POS, whose detail is pending the POS analysis report (PRD section 12). The audit's expected-effort figures put the full scope far beyond the available capacity, so the first pilot is reduced.

Product scope is reduced; the quality bar is not.

| Decision | Resolution |
|---|---|
| Settlement surface (H4) | Web Order Tablet in Staff Mode, transitional (item 8) |
| Credential issuance at the pilot (O-2) | Transitional NestJS issuance under PR-7 (item 9; PRD section 14) |
| Card-payment model (H5) | **H5-A: integrated, adapter-verified card required for the first pilot** (item 2) |

## Decision

For the **first pilot only**. Product architecture and long-term scope are unchanged.

1. **Windows POS:** not part of the first pilot. It stays the permanent main POS terminal target (`apps/windows/pos-terminal/`). Its detail stays PENDING USER POS ANALYSIS REPORT.
2. **Card payments: integrated card required (PILOT-CARD-3, H5-A).** Card acceptance at the first pilot goes only through the trusted Venue Edge payment-adapter path (ADR 0001 item 7; PAY-1). The first pilot waits until that capability exists and is certified.
   - **Trust model unchanged.** Card success comes only from the trusted adapter. No staff endpoint can mark a card payment as succeeded (D6).
   - **No exception is introduced:** no staff-recorded external-card tender, no tender-model or Prisma exception for the pilot.
   - **Still required:** idempotency, reconciliation, refunds and reversals, audit, and explicit uncertain and failure states (PAY-1 to PAY-7; PRD Part B).
   - **Dependency:** provider and terminal selection, O-3, is an open owner decision. Card stories that need provider-specific behaviour are BLOCKED until O-3 is decided. The provider-neutral adapter boundary (PAY-4) can be built first.
   - **Rationale:** Servvia is built as an enterprise operational POS. A pilot-specific staff-attested card-success exception would weaken the transactional trust boundary that D6 established. Schedule pressure does not justify weakening the payment trust model, so the pilot waits for the production-grade path.
3. **Cash-drawer hardware:** not part of the first pilot. Cash is still accounted within a shift (Core D7 has no drawer hardware).
4. **Guest Mode:** excluded from the first pilot and retained in the product architecture.
   - WT-1 to WT-6 are unchanged. The Android Waiter Tablet stays one application with Staff Mode and Guest Mode.
   - O-20 and O-21 stay open.
   - No Core Guest Mode implementation is required for the first pilot.
5. **KDS:** part of the first pilot (KIT-1 to KIT-6).
6. **Kitchen printing:** required only if the venue requires it (PRD section 11). Whether the pilot venue requires it is not established. Hardware and protocol stay with O-4. Receipt printing stays required (PRD section 11); receipt content stays with O-5.
7. **Quality controls stay mandatory and are not reduced by any scope reduction:**
   - security;
   - data integrity;
   - idempotency;
   - reconciliation;
   - backups and recovery;
   - monitoring;
   - audit;
   - failure handling and staff-visible recovery;
   - rollback;
   - testing.

   This includes PRD section 11 release acceptance in full, and PRD Part B.
8. **Settlement surface (H4).** For the reduced first pilot, the existing **web Order Tablet in Staff Mode** (`apps/web/admin-console`, `VITE_APP_MODE=tablet`) is the **temporary staff settlement surface**.
   - **Staff Mode:** it may initiate and record only the minimum settlement workflow (next section), through Servvia Core APIs. Core's financial guards and the elevated staff member's own role decide what is permitted.
   - **Guest Mode:** it never receives settlement capability. It may not initiate, record or view settlement (WT-4).
   - **Transitional only.** The web Order Tablet does not become a canonical backend. Servvia Core stays authoritative for price, tax, totals, payment state and settlement (ADR 0001 items 1, 2 and 5). The tablet only submits requests and shows Core's results.
   - **Permanent targets are unchanged:**
     - the Windows POS stays the permanent main POS terminal;
     - the native Android Waiter Tablet stays the permanent waiter and mobile target;
     - the web Order Tablet stays transitional;
     - no separate web cashier application is created.
   - **Retirement rule (PR-7, PR-8):** the capability is removed when **both** of these hold:
     - an owner-approved permanent settlement surface (the Windows POS terminal, or the native Waiter Tablet in Staff Mode) supports the same workflow against Core and has passed PRD section 11 release acceptance for it;
     - the venue has cut over to it under the production-cutover rule (PRD section 11).
   - **Supersession (DL-118):** this partially supersedes the historical rule DL-087 (2026-08-20: "the Order Tablet never processes payment"), for Staff Mode only. Guest Mode stays under the no-payment rule.
     - DL-087 has no entry of its own in `docs/decisions-log.md`. It is recorded in code and tests, which implementation must change deliberately, never silently:
       - `apps/api/test/tablet-auth.integration-spec.ts`;
       - `apps/web/admin-console/src/pages/order-tablet/OrderTabletPage.test.tsx`;
       - `apps/api/src/payment-observation/payment-observation.constants.ts`;
       - `apps/web/admin-console/src/pages/payments/PaymentsPage.tsx`.
     - It is also recorded in the removed earlier planning output.
9. **Credential issuance (O-2; decided in PRD section 14).** NestJS may temporarily issue staff and device credentials during the first pilot, under PR-7.
   - **Go Core stays authoritative for:**
     - transactional authorization;
     - credential verification at transactional boundaries;
     - venue access and scoping;
     - financial role enforcement;
     - transactional state.
   - **Guest credentials** never acquire Staff authority.
   - **Not waived:** the missing enforcement of staff venue scope in Core remains a security gap that must be fixed (PRD section 16, item 3).

## Minimum settlement boundary (for item 8)

This is derived from existing Core capability and approved requirements only. It is not a POS workflow design.

**Chain:** TableSession → Order → Check → Payment → Settlement → Shift.

**Prerequisite:** only Servvia Core orders can be billed (`docs/migration/d5-checks.md`). Staff Mode ordering must therefore run on Core first.

**Authority:** a Staff Mode request carries the elevated staff member's identity and role. Core's existing financial guards (staff identity, active tablet device, role) apply unchanged:
- checks, payments and shifts: owner, admin, manager, cashier;
- check void and refunds: owner, admin, manager.

| Capability | Core basis | Requirement basis |
|---|---|---|
| Open own shift (with opening float) and close it (counted cash; expected and variance are computed by Core) | D7 shifts API | PRD section 11 "shift open and close" |
| Bill the visit: create a check over the visit's unbilled lines (later rounds stay unbilled until a further check bills them) | D5 `POST …/checks` | PRD section 11 "check"; ORD-5; ADR 0001 item 4 |
| View the payable check, its payments and balance | D5 and D6 reads | PR-4 truthful state |
| Record a **cash** tender (succeeds at once, under the actor's open shift) | D6 and D7 | PAY-1 (cash within a shift); PRD section 11 "cash settlement" |
| Initiate an **integrated card** tender (stays `pending` until the trusted adapter reports `succeeded`, `failed` or `uncertain`) | D6 payment initiation; adapter result path | PAY-1 (card through Venue Edge); PAY-6. Needs the integrated adapter (item 2) |
| See whether the check is covered and settled (`CheckSettlement`) | D6 | ADR 0001 item 4 |
| Cash refund (admin or manager, under the actor's open shift); card refund through the adapter | D9 | PAY-7 |
| Void an open check that has no payments (admin or manager) | D5 and D6 | Existing D5/D6 rule |
| Close the visit when its close invariants hold | D2 and D10 | PRD section 11 "visit close" |

**Not included** (no approved requirement mandates them for this surface):
- manager workflows beyond the existing role checks;
- split or transfer of checks;
- receipt UX (O-5);
- day-close UX (O-6);
- drawer UX;
- POS navigation;
- hardware behaviour.

## Consequences

**For the pilot:**
- **The pilot waits for integrated card.** It cannot start until:
  - O-3 is decided;
  - the Venue Edge payment adapter is built and certified;
  - PRD section 11 release acceptance passes, including payment reconciliation and refunds.
- **The December target is unaffected.** It is a staging release candidate, and card was never part of it.
- **Audit estimates are unchanged.** Integrated card plus certification is costed in the audit at 80/140/260 hours plus calendar time (section 12), and that effort now sits on the pilot path. These are planning estimates, not commitments.

**Requirement changes made by this ADR** (applied to `PRD/product-requirements.md` with this acceptance):

| Change | Items |
|---|---|
| **Amend** | Section 11 "FIRST INDEPENDENT SERVVIA PILOT": cash drawer, Guest Mode and the Windows POS are not part of the first pilot; the integrated card terminal stays required; settlement goes through the transitional web Order Tablet in Staff Mode |
| **Add** | A section 8 note on Guest Mode exclusion and the Staff Mode settlement surface. No new section 4 surface; no `fileRestructure.md` structural change |
| **Defer for the first pilot** | The cash-drawer and customer-display parts of EDGE-1. The KOT-specific parts of PRT-1 (station routing, once per station) and the MVP 9.5 kitchen-printing acceptance, only where the venue does not require kitchen printing. PRT-1 to PRT-3 otherwise apply to the receipt printer |
| **No change** | PAY-1 to PAY-7; EDGE-2, EDGE-3; section 11 release acceptance; Part B; WT-1 to WT-6; ORD and KIT |
