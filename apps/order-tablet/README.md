# Order Tablet — build-target boundary

**This directory has no source of its own.** It documents a deployable identity, not a separate codebase.

## What Order Tablet is

The staff-operated in-venue ordering surface: table and seat selection, menu and modifier selection, cart construction, provisional billing presentation, order submission, and the Idealpos/EFTPOS/KDS/KOT handoff. It is Verdura's primary, staff-mediated order-construction surface — it is **not** the only one: `apps/window-display`'s `KioskOrderPage` (`POST /api/kiosk/orders`) is a separate, real, customer-self-service ordering path with its own mandatory Stripe card-present payment step (Order Tablet has no payment step at all — that's IdealPOS/EFTPOS's job at the table). Both paths share the same backend order-persistence core (`OrdersService.persistOrder`) and therefore the same idempotency and KOT-exclusivity guarantees — see `apps/window-display/README.md`.

## Where the code actually lives

`apps/web/admin-console/src/pages/order-tablet/OrderTabletPage.tsx`, built in a dedicated device mode:

```bash
# from the repository root
npm run dev:order-tablet     # VITE_APP_MODE=tablet, port 5176
npm run build:order-tablet
```

`OrderTabletPage.tsx` and its dependencies (`shared/orders.ts`, `shared/tables.ts`, `store/menu.store.ts`, `store/reservation.store.ts`, `store/auth.store.ts`, `components/TableMap.tsx`) are **not exclusive to Order Tablet** — every one of them is also used by other Admin Console pages (`MenuManagementPage`, `ReservationsPage`, `TableManagementPage`, and Kitchen Display's `shared/orders.ts`). Extracting Order Tablet into a fully independent `apps/` package with its own `package.json` would require either duplicating that shared state (a real drift risk for live order data) or a genuine shared-package extraction — out of scope for this structural migration. See the repository structure decision record (`_bmad-output/implementation-artifacts/2026-08-17-repository-restructure.md`) for the full reasoning and the deferred extraction story.

## Current status (independently re-verified 2026-08-25 against this repo's actual code and test runs — not against any planning document)

This section previously claimed zero tests, a blocked auth decision, and an unfixed billing defect. All three claims were stale by the time this file was last edited; none of them hold against the code that actually exists on `main` today. Re-verify against the code before trusting *this* section too, the next time it goes stale.

- **Tests exist and pass.** `OrderTabletPage.test.tsx` (1,063 lines), `TabletDeviceGate.test.tsx`, and `billing.test.ts` cover the tablet UI, device-gate auth flow, and billing math. `npx vitest run` (apps/web/admin-console): 127/127 pass. `npx tsc --noEmit`: clean. `npm run build:order-tablet`: succeeds.
- **Auth is implemented**, not blocked: a hybrid model — persisted device JWT, memory-only staff-PIN-elevation JWT, memory-only manager-step-up JWT (`tabletDeviceAuth.store.ts`). PIN verification is real and server-side (Argon2id against `Staff.pinHash`, constant-time decoy compare on no-match, real-time device revocation) — never a hardcoded or client-side PIN. See `apps/api/src/tablet/tablet-auth.service.ts`.
- **The billing defect is fixed.** `billing.ts`'s `computeCartTotals()` charges no service charge and discloses GST as contained in the price, never added on top; its own top comment documents this as the fix for exactly the bug this file used to describe as current.
- **Idealpos/EFTPOS/KDS/KOT handoff is partially implemented, not "not implemented".** Real, tested-against-real-Postgres machinery exists end-to-end at the Verdura-side boundary: idempotent order persistence, `POSSyncRecord`/`ConnectorCommand` dispatch with a lease/CAS claim protocol, KOT-double-print prevention keyed on `venue.posAdapterType`, and a tablet-side status panel that polls and truthfully distinguishes "submitted to Verdura" from "sent to Idealpos" from "Idealpos confirmed" from failure (never a fabricated success state). What remains genuinely unverified — because it requires a real Windows host with IdealPOS and IdealposBridge installed, which this repository's own development environment does not have — is whether a real order has ever reached physical IdealPOS and produced a real native KOT. See `apps/venue-connector/README.md` and `docs/integrations/idealpos.md` for exactly what is and isn't proven on that side.
- A separate, real self-service ordering flow exists in `apps/window-display` (`KioskOrderPage`/`TableSelectionPage`, `POST /api/kiosk/orders`) — it is reachable in a real deployment (mounted at `/order` and `/tables`, not behind a flag), is **not** the canonical Order Tablet, and is not merged with it, but does share Order Tablet's backend safety properties (idempotency, KOT-exclusivity) via the same `OrdersService` core. See `apps/window-display/README.md`.

## Prohibited here

Nothing — this directory has no code to constrain. The behavioral boundary (Order Tablet is the only app permitted to submit orders) is enforced by what `apps/web/admin-console`'s device-mode entry point renders, not by anything in this directory.
