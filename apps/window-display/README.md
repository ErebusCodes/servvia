# Window Display

**Status: transitional — not yet boundary-compliant. Read this before touching this app.**

## Intended responsibility

Read-only digital signage for walk-in customers: menu presentation and promotions. It must never provide cart creation, order creation/submission, checkout, payment initiation, table/seat ordering, or an Idealpos transaction handoff.

## Current reality

This app was moved here unchanged from the old `kiosk-frontend` directory (2026-08-17 restructure — see `_bmad-output/implementation-artifacts/2026-08-17-repository-restructure.md`). It is **not** read-only today:

| Route | What it does | Compliant? |
|---|---|---|
| `/` (default) | `KioskWindowSignagePage` — read-only signage/promos | Yes |
| `/menu`, `/about`, `/contact` | Read-only pages aliased directly from `apps/web/customer-website/src` | Yes |
| `/book` | Reservation booking page, same alias | Borderline — not ordering, but not pure signage either |
| `/tables` | `TableSelectionPage` — table/order-type selection | **No — reachable transactional route** |
| `/order` | `KioskOrderPage` — cart construction, modifiers, `@stripe/terminal-js` payment, order submission | **No — reachable transactional route** |
| `/kds` (and default when `VITE_APP_MODE=kds`) | `KdsPage` — a second, untested Kitchen Display implementation | **No — duplicate of the canonical `apps/kitchen-display`** |

**Do not treat this as read-only in code, documentation, or product claims until the items below are resolved.**

## Why the ordering routes weren't removed here

This app looked like it might be live, payment-capable, customer-facing code. Retiring or relocating it inside a bulk structural-migration pass, without dedicated testing or confirmation that it's safe to touch, was judged too risky — see the decision record linked above. Removing it is explicitly deferred to its own story (`_bmad-output/implementation-artifacts/deferred-work.md`), which must first confirm whether this flow is actually relied on in the live venue setup.

## Development

```bash
npm run dev:window-display     # port 5174
npm run build:window-display
```

## Allowed dependencies

Repo-root `shared/` (menu data, kiosk config) and, via a pre-existing cross-app alias, `apps/web/customer-website/src` (Menu/BookTable/About/Contact pages — a carry-over from before this app existed under `apps/`, not a pattern to extend). Do not add new dependencies on `apps/web/admin-console` or `apps/api` internals beyond the existing REST/WebSocket API calls.

## Prohibited (once compliant)

Cart state, checkout, payment initiation, table/seat ordering, Idealpos handoff, and any second Kitchen Display implementation — see the table above for what currently violates this.
