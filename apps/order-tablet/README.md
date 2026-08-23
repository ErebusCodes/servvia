# Order Tablet — build-target boundary

**This directory has no source of its own.** It documents a deployable identity, not a separate codebase.

## What Order Tablet is

The staff/customer in-venue ordering surface: table and seat selection, menu and modifier selection, cart construction, provisional billing presentation, order submission, and (per `docs/target-operating-model.md`) the eventual Idealpos/EFTPOS/KDS/KOT handoff. It is the only Verdura application authorised to construct and submit orders.

## Where the code actually lives

`apps/admin-console/src/pages/order-tablet/OrderTabletPage.tsx`, built in a dedicated device mode:

```bash
# from the repository root
npm run dev:order-tablet     # VITE_APP_MODE=tablet, port 5177
npm run build:order-tablet
```

`OrderTabletPage.tsx` and its dependencies (`shared/orders.ts`, `shared/tables.ts`, `store/menu.store.ts`, `store/reservation.store.ts`, `store/auth.store.ts`, `components/TableMap.tsx`) are **not exclusive to Order Tablet** — every one of them is also used by other Admin Console pages (`MenuManagementPage`, `ReservationsPage`, `TableManagementPage`, and Kitchen Display's `shared/orders.ts`). Extracting Order Tablet into a fully independent `apps/` package with its own `package.json` would require either duplicating that shared state (a real drift risk for live order data) or a genuine shared-package extraction — out of scope for this structural migration. See the repository structure decision record (`_bmad-output/implementation-artifacts/2026-08-17-repository-restructure.md`) for the full reasoning and the deferred extraction story.

## Current status

- **Not production-verified.** Zero automated test files exist for `OrderTabletPage.tsx` today (tracked in `_bmad-output/implementation-artifacts/sprint-status.yaml`, story `15-11`).
- **Story 15.1 (`_bmad-output/implementation-artifacts/15-1-tablet-venue-and-auth-decision.md`) is blocked** on an unresolved product/security decision about the tablet's authentication model (shared device PIN vs. per-staff JWT vs. hybrid). This restructuring did not make or influence that decision.
- **A known billing defect exists** in the tablet's total calculation (fabricated service charge; additive GST on a GST-inclusive price) — owned by stories `15-4`/`15-5`/`15-6`, unchanged by this migration.
- Idealpos/EFTPOS/KDS/KOT handoff for tablet-submitted orders is **not implemented**.
- A separate, older self-service ordering flow still exists in `apps/window-display` (`KioskOrderPage`/`TableSelectionPage`) — it is **not** the canonical Order Tablet and is not merged with it. See `apps/window-display/README.md`.

## Prohibited here

Nothing — this directory has no code to constrain. The behavioral boundary (Order Tablet is the only app permitted to submit orders) is enforced by what `apps/admin-console`'s device-mode entry point renders, not by anything in this directory.
