# Kitchen Display — build-target boundary

**This directory has no source of its own.** It documents a deployable identity, not a separate codebase.

## What Kitchen Display is

The kitchen-facing fulfilment queue: receives submitted orders, presents them as tickets grouped by preparation station, and tracks new/preparing/ready/completed state. Read/update only — it never originates or submits orders.

## Where the code actually lives

`apps/web/admin-console/src/pages/kitchen/KitchenDisplayPage.tsx`, built in a dedicated device mode:

```bash
# from the repository root
npm run dev:kitchen-display     # VITE_APP_MODE=kds, port 5175
npm run build:kitchen-display
```

This is the **canonical** KDS implementation, selected over the alternative embedded in `apps/window-display/src/pages/KdsPage.tsx` because it has automated test coverage (`apps/web/admin-console/src/store/kdsDeviceAuth.store.test.ts`) and is the implementation the repository's own scripts have actually wired up. The embedded `apps/window-display` copy has not been deleted or merged — it is flagged as a likely-duplicate pending a feature-by-feature comparison. See the repository structure decision record (`_bmad-output/implementation-artifacts/2026-08-17-repository-restructure.md`) and `_bmad-output/implementation-artifacts/deferred-work.md` for that follow-up.

`KitchenDisplayPage.tsx` shares `shared/orders.ts` and `shared/menu/menuData.js` with other Admin Console pages (`OrdersPage`, and Order Tablet) — the same non-extractability reasoning documented in `apps/order-tablet/README.md` applies here.

## Current status

- Renders real order data via `shared/orders.ts`'s `useLiveOrders`/`useLiveOrderStatusMutation` hooks against the live backend API — this is real, wired functionality, not a mock.
- Device access is gated by `KdsPinGate` (shared venue-scoped PIN, not full staff login) — unchanged by this migration.
- Production kitchen-printer (KOT) delivery and Idealpos-side kitchen printing coordination are **not implemented** — see `docs/target-operating-model.md` §5 and the 2026-08-16 addendum there.
- No live-hardware or live-kitchen validation has been performed as part of this restructuring.

## Prohibited here

Order creation, order submission, cart/checkout state, payment initiation, or any Idealpos/EFTPOS handoff — none of that exists in `KitchenDisplayPage.tsx`, and none should be added to it.
