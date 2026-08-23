# Admin Console

## Responsibility

Venue configuration, operational administration, menu/catalogue management, staff, reservations, table management, payments visibility, reporting, and integration tooling. Not a customer ordering surface.

**This package also contains the source for two other product surfaces, built as separate deployable targets from the same code** (see below) — this is a deliberate transitional architecture, not an oversight. See `_bmad-output/implementation-artifacts/2026-08-17-repository-restructure.md` for the full reasoning.

## Device-mode builds

| Mode | Command | Renders | Auth |
|---|---|---|---|
| Default (admin) | `npm run dev:admin-console` / `build:admin-console` | Full admin app (`AdminPortalApp`) | Staff JWT session |
| `VITE_APP_MODE=kds` | `npm run dev:kitchen-display` / `build:kitchen-display` | `KitchenDisplayPage` standalone — see `apps/kitchen-display/README.md` | Device PIN (`KdsPinGate`) |
| `VITE_APP_MODE=tablet` | `npm run dev:order-tablet` / `build:order-tablet` | `OrderTabletPage` standalone — see `apps/order-tablet/README.md` | Device PIN (`KdsPinGate`) |

`OrderTabletPage.tsx` and `KitchenDisplayPage.tsx` are also reachable as ordinary routes (`/order-tablet`, `/kitchen-display`) inside the full admin app when embedded that way is useful — they are not duplicated, just rendered from two entry points.

## Why Order Tablet and Kitchen Display live here instead of their own `apps/` package

Every dependency they need (`shared/orders.ts`, `shared/tables.ts`, `store/menu.store.ts`, `store/reservation.store.ts`, `store/auth.store.ts`, `components/TableMap.tsx`) is also used by other Admin Console pages (`MenuManagementPage`, `ReservationsPage`, `TableManagementPage`). Splitting them out now would mean either duplicating live-order/auth state (a real drift risk) or a genuine shared-package extraction — the latter is real future work, gated on Story 15.1's still-blocked tablet authentication-model decision, and deliberately not attempted in a structural-migration pass. Full reasoning in the decision record linked above.

## Development

```bash
npm run dev:admin-console
```

## Build / test / lint / typecheck

```bash
npm run build --workspace=apps/admin-console
npm run test --workspace=apps/admin-console      # Vitest
npm run lint --workspace=apps/admin-console
npm run typecheck --workspace=apps/admin-console
```

## Prohibited

Must not be treated as, or confused with, a customer-facing ordering surface — Order Tablet's device-mode build is staff/configured-customer in-venue ordering only, gated by device PIN, never exposed as the default admin route.

## Current limitations

- Order Tablet's total calculation has a known, unfixed billing defect (fabricated service charge, additive GST on a GST-inclusive price) — owned by Stories 15-4/15-5/15-6, see `docs/decisions-log.md` DL-072.
- Story 15.1's tablet authentication-model decision remains blocked — see `_bmad-output/implementation-artifacts/15-1-tablet-venue-and-auth-decision.md`.
- No automated tests exist for `OrderTabletPage.tsx` (tracked as story `15-11`, backlog).
