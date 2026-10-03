# ADR 0002: Reduced first pilot (DRAFT)

- **Status:** **Proposed. NOT ACCEPTED.**
  - The whole ADR takes effect only when it is accepted. Wording an item as a decision does not put it in force.
  - Until then, `PRD/product-requirements.md` section 11 stands as written, and nothing here is a requirement.
  - One substantive decision is still BLOCKED: H5 (card-payment model).
- **Date:** 2026-10-03 (draft; revised the same day for H4 and O-2)
- **Relates to:** [ADR 0001](0001-servvia-is-the-operational-pos.md); `PRD/product-requirements.md` sections 4, 8, 11 and 14; the production-readiness audit `docs/audits/production-readiness-2026-12.md` (PREPARED, NOT ADOPTED).

## Context

The 31 December 2026 objective is a **staging release candidate**, not a production-complete broad POS. The first independent Servvia pilot in PRD section 11 requires:
- an integrated card terminal through Venue Edge;
- receipt printing, and kitchen printing if the venue requires it;
- a cash drawer.

The main POS terminal is the Windows POS, whose detail is pending the POS analysis report (PRD section 12). The audit's expected-effort figures put this scope far beyond the available capacity, so the strategic direction is a reduced first pilot.

The reduced pilot needs three further decisions:

| Decision | Status |
|---|---|
| Settlement surface (H4) | Resolved as an architecture decision: item 8 |
| Credential issuance at the pilot (O-2) | Resolved in PRD section 14: item 9 |
| Card-payment model (H5) | **BLOCKED** |

## Proposed decision (applies only if accepted)

For the **first pilot only**. Product architecture and long-term scope are unchanged.

1. **Windows POS:** deferred from the first pilot. It stays the permanent main POS terminal target (`apps/windows/pos-terminal/`). Its detail stays PENDING USER POS ANALYSIS REPORT.
2. **Integrated card terminal through Venue Edge:** deferred from the first pilot, unless H5 selects it. It stays the target in-person card path (ADR 0001 item 7; PAY-1).
3. **Cash-drawer hardware:** deferred from the first pilot. Cash is still accounted within a shift (Core D7 has no drawer hardware).
4. **Guest Mode:** excluded from the first pilot and retained in the product architecture.
   - WT-1 to WT-6 are unchanged. The Android Waiter Tablet stays one application with Staff Mode and Guest Mode.
   - O-20 and O-21 stay open.
   - No Core Guest Mode implementation is required for the first pilot.
5. **KDS:** stays part of the first pilot (KIT-1 to KIT-6).
6. **Kitchen printing:** required only if the venue requires it (PRD section 11). Whether the pilot venue requires it is not established. Hardware and protocol stay with O-4.
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
   - **Supersession, on acceptance:** a decisions-log entry partially supersedes the historical rule DL-087 (2026-08-20: "the Order Tablet never processes payment"), for Staff Mode only. Guest Mode stays under the no-payment rule.
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
| See whether the check is covered and settled (`CheckSettlement`) | D6 | ADR 0001 item 4 |
| Cash refund (admin or manager, under the actor's open shift) | D9 | PAY-7 |
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

**Tender paths:**
- **Cash** is currently the only fully approved tender path for the reduced pilot.
- Every **card** tender, card refund and card reconciliation step waits for H5. The integrated card terminal stays deferred unless H5 selects it.

## Blocked (no decision is made or implied here)

| ID | Blocked question | Why it blocks | Evidence |
|---|---|---|---|
| **H5** | **Card at the first pilot.** The owner selects one: PILOT-CARD-1, cash-only, with card deferred and H5 left open for later; PILOT-CARD-2 (H5-B), a standalone terminal whose card payments are recorded in Servvia by authorised staff; or PILOT-CARD-3 (H5-A), an integrated, adapter-verified terminal required before the pilot | (B) changes the Core tender model (`TenderType`), the Prisma schema, the rule that "no staff endpoint can mark a payment as succeeded", reconciliation, refunds, and audit and event semantics. (A) needs Venue Edge, a payment adapter and provider certification | `services/core-platform/internal/payments/payment.go`; `docs/migration/d6-payments-settlement.md`; `contracts/openapi/payments.yaml`; PAY-1, PAY-6 |

## Requirement changes this ADR would need on acceptance (not applied)

| Change | Items |
|---|---|
| **Amend** | PRD section 11 "FIRST INDEPENDENT SERVVIA PILOT": integrated card terminal deferred unless H5 selects it; cash drawer deferred; Windows POS not required |
| **Waive for the first pilot** | EDGE-1 to EDGE-3 (hardware and terminal scope); PRT-1 to PRT-3, ADM-2 and the MVP 9.5 printing acceptance where the venue does not require kitchen printing |
| **Add (H4)** | The decisions-log entry partially superseding DL-087 (Staff Mode only). A PRD section 8 note that the web Order Tablet's Staff Mode is the temporary settlement surface for the reduced pilot. No new PRD section 4 surface; no `fileRestructure.md` structural change |
| **Depends on the pilot-card choice** | PILOT-CARD-1: the section 11 amendment states that tenders at the first pilot are cash within a shift, with card added only by a later controlled H5 decision. PILOT-CARD-2: PAY-1, PAY-6, and new external-card reconciliation, correction and refund rules. PILOT-CARD-3: no payment-requirement change; card waits for integration before the pilot |
| **Already applied in the PRD** (2026-10-03) | O-2 decision; section 11 staff sign-in wording |
| **No change** | PRD section 11 release acceptance; Part B; WT-1 to WT-6; ORD, KIT, PAY-2 to PAY-5 and PAY-7 |
