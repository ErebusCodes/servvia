# Inventory Page — Pixel-Match UI Redesign

> **Operational integration requirement — 2026-08-15:** Any production version must display inventory consequences from canonical Verdura order events governed by the [Target Operating Model](../../target-operating-model.md), expose Idealpos reconciliation exceptions where relevant and never present payment, print or KDS acknowledgement as proof of inventory posting.

> **Design status — 2026-08-15:** This document specifies a prototype presentation layer. It does not establish inventory accuracy, posting integrity, reconciliation, authorization or production readiness. Current authority: [../../mvp.md](../../mvp.md).

**UX recommendation:** visibly label prototype data; never show a successful posting/sync state without backend confirmation; distinguish drafts from immutable material documents; expose reversal lineage and conflicts; and defer production activation until the Material Management phase gate and domain acceptance tests pass.

## Context

The user supplied a reference screenshot (`/home/cyrus/Documents/inventory.png`) of a target Inventory page design and asked for a faithful, near-pixel reproduction inside the existing Verdura admin app, frontend-only, with zero regression of current functionality.

This overlaps with work already anticipated by the existing 9-sub-project Inventory rewrite plan (`docs/superpowers/specs/2026-07-02-inventory-foundation-design.md`), which explicitly scoped "Page shell — Command Bar, Operations Inbox, KPI Summary, tab navigation" as sub-project 2 and "Reporting, right sidebar & AI assistant" as sub-project 8 — both sequenced *after* sub-project 1 (Foundation: the movement-based ledger data model), specifically so the new UI would sit on the new data model. That Foundation plan exists (`docs/superpowers/plans/2026-07-03-inventory-foundation.md`) but has not been executed yet (a git worktree at `.worktrees/inventory-foundation` holds work in progress).

**Explicit decision (user, this session):** build the UI redesign now, directly on top of the current `InventoryPage.tsx` / `mockData.ts` / `types.ts`, rather than waiting for Foundation to land. The ledger refactor will be redone/rebased against this new structure later. This is a deliberate reordering of the original 9-sub-project sequence, not an oversight.

## Baseline (audited)

- `InventoryPage.tsx` — 3,110 lines, single file. Already has: 6 tabs (`inventory/orders/suppliers/movements/recipes/stocktakes`), a 5-button action bar (New Item/Receive Stock/Purchase Order/Stocktake/Export), an 11-card KPI grid, a right sidebar (Alerts/Stock Coverage/Waste Tracking/Supplier Performance), search/filter/sort/pagination/density on the inventory table. State is local `useState`/`useMemo`, no store.
- `mockData.ts` — 731 lines, 43 inventory items. Status values in use: `Healthy | Low Stock | Zero Stock` (no `Critical` tier).
- `hooks/useInventoryState.ts` — 992 lines, dead code (unused anywhere). The Foundation plan already slates it for deletion as unreliable (same mutable-onHand bug). Not reused here either.
- No shared UI component library exists anywhere in the app (`src/components` only has `auth/ProtectedRoute.tsx` and `layout/AdminLayout.tsx`). Every page hand-rolls Tailwind directly. `MenuManagementPage.tsx` + `menu.store.ts` show a newer pattern (Zustand store + named local subcomponents) but that pattern is not used by Inventory today.
- Design tokens exist in `tailwind.config.ts` / `src/index.css`: brand green (`--green-600`/`--color-primary`), status colors (success/warning/danger/info, each with subtle bg/border variants), radius scale (4–16px + full), shadow scale (xs–xl), spacing scale, Inter font, tabular numerals.
- No icon package installed; icons are hand-authored inline SVGs per file.
- `AdminLayout.tsx` provides the sidebar nav, page title/breadcrumb, and a `<main>` wrapper around `<Outlet />` — **not modified by this work**. Each page owns its own content container.

## Reference image inventory (what must appear)

Top to bottom, left to right, as shown in `/home/cyrus/Documents/inventory.png`:

1. **Command bar**: 7 primary buttons (Receive Goods, Quick Receive, Purchase Order, Stock Adjustment, Record Waste, Stocktake, Transfer Stock) + a "More" dropdown.
2. **Operations Inbox** row: 7 cards (POs to Receive, Deliveries Today, Critical Stock, Expiring Soon, Stocktakes Due, High Waste (7d), Variances), each with an icon, headline number, optional secondary badge (e.g. "2 overdue"), and a "View ... →" link. A "Customize" control sits top-right of the row.
3. **KPI/sparkline row**: 7 cards (Inventory Value, Inventory Accuracy, Today's Receipts, Today's Consumption, Today's Waste, Today's Adjustments, Inventory Turns (30d)), each with a value, a small trend delta ("↑ 2.4% vs last 7 days"), and a mini sparkline.
4. **Tab bar**: 11 tabs — Inventory, Purchase Orders, Receiving, Movements, Waste, Stocktake, Recipes, Suppliers, Transfers, Reports, Alerts.
5. **Filter bar**: search input, 5 dropdowns (Categories, Suppliers, Venues, Statuses, Stock Levels), quick-filter chips (All Items, Low Stock, Zero Stock, Expiring Soon, Overdue, Clear all), density toggle (list/grid icon pair) + a settings gear icon.
6. **Inventory table**: checkbox column, Item (icon avatar + name), SKU, Category, Supplier, Venue, On Hand, Available, Unit, Stock Level (badge: Healthy/Low/Critical/Zero Stock), Expiry (date + relative days, red when urgent), Avg Daily Use, Cost, Value, Actions (kebab menu).
7. **Pagination footer**: "Showing 1 to 10 of 128 items", page number controls, page-size dropdown ("10 / page").
8. **Right sidebar**, top to bottom: Operations Inbox (Detailed) — list of the same 7 metrics with values; Stock Coverage (Days) — 4 category rows with colored progress bars (Meat/Vegetables/Dairy/Dry Goods); AI Inventory Assistant — 4 short insight lines with a "View all insights →" link; Waste Tracking (Today) — today's total, this-week total, top-3 wasted items with $ amounts. (Supplier Performance is not visible in the 1024px-tall screenshot; kept as a 5th widget below the fold for parity with current functionality.)

## Goals

1. Reproduce every section above with matching structure, order, and approximate spacing/sizing, built from existing Verdura tokens (no new color/radius/shadow system) — the screenshot is the highest-priority acceptance criterion; iterate past "looks close" until a side-by-side comparison shows only negligible differences.
2. Decompose `InventoryPage.tsx` into focused, independently-readable subcomponents — no new 3,000-line file.
3. Preserve every current capability — each must end up either unchanged, improved, or relocated, never dropped. No dead/placeholder UI unless there is genuinely no existing functionality or design reference to build from (see Tabs below — in practice this ends up applying to none of the 11 tabs).
4. Stay frontend-only: local state + mock data, no backend/API/store-persistence changes.
5. Keep the UI layer decoupled from how item quantities/status are computed, so the upcoming Foundation ledger rewrite can swap the data layer underneath with minimal component changes (see Foundation compatibility below).

## Non-goals

- Reconciling with the Foundation ledger refactor now — deferred, will be redone later against this new structure. This spec just avoids making that harder (see Foundation compatibility).
- Introducing a Zustand store or reviving `useInventoryState.ts` — state stays local to `InventoryPage`, passed down via props, matching today's architecture (lower risk, avoids collision with the future ledger hook).
- Supplier Performance widget redesign — kept as-is (already exists in current sidebar), just repositioned as the 5th widget.
- Pixel-exact color matching where it would conflict with existing Verdura tokens (e.g. the image's exact greens/grays are approximated via `--color-primary`/gray scale, not hand-picked hex values).
- A real backend-worthy Transfers *system* (approvals, in-transit tracking) — the Transfers tab and dialog are real, working, frontend-only mock-state features (see Tabs below), just not a full workflow engine.

## Design

### Component structure

```
admin-frontend/src/pages/inventory/
  InventoryPage.tsx                 (shell: owns all state, composes below)
  components/
    CommandBar.tsx                  (7 action buttons + More dropdown)
    MetricsInbox.tsx                (Operations Inbox card row, 7 cards + Customize)
    MetricsKPI.tsx                  (KPI/sparkline card row, 7 cards)
    Sparkline.tsx                   (tiny inline SVG line chart, shared by MetricsKPI + widgets)
    InventoryTabs.tsx               (11-tab bar)
    InventoryFilters.tsx            (search, 5 dropdowns, quick chips, density toggle)
    InventoryTable.tsx              (table incl. status badges, expiry formatting, row actions)
    MovementsTable.tsx              (shared log table: item, qty, type, cost, date, user, note — filtered by movement type; powers Movements, Waste, and Transfers tabs)
    Pagination.tsx                  (page controls + page-size dropdown)
    tabs/
      ReceivingTab.tsx              (POs with status Sent/Partially Received, "Receive" row action opens ReceiveStockDialog)
      WasteTab.tsx                  (MovementsTable filtered to Waste/SCRAP + "Record Waste" entry point)
      TransfersTab.tsx              (MovementsTable filtered to Transfer/TRANSFER + "Transfer Stock" entry point)
      ReportsTab.tsx                (derived analytics: value-by-category, waste-by-category, low-stock breakdown tables, computed via useMemo from the same item/movement arrays)
      AlertsTab.tsx                 (full list version of the Operations Inbox — every critical-stock/expiring/overdue-PO/high-waste/variance item, not just the top N)
    dialogs/
      TransferStockDialog.tsx       (item, from-venue, to-venue, qty — writes a Transfer movement to local state)
    sidebar/
      OperationsInboxDetailed.tsx
      StockCoverageCard.tsx
      AIAssistantCard.tsx
      WasteTrackingCard.tsx
      SupplierPerformanceCard.tsx
  mock/
    (existing mockData.ts extended, not replaced — see Data section)
```

Each component takes plain props (data + callbacks); `InventoryPage.tsx` keeps owning `useState`/`useMemo` for tab, filters, search, selection, dialogs, sort, pagination — same state shape as today, just no longer inlined into one render tree. Existing dialogs (New Item, Edit, Receive Stock, Purchase Order, Stocktake, Adjustment, Waste, Expiry, Delete Confirm, History) are extracted into their own files only if doing so is needed to keep `InventoryPage.tsx` under a reasonable size; not a hard requirement of this spec.

### Tabs

Expand from 6 to 11, in the image's order: `Inventory, Purchase Orders, Receiving, Movements, Waste, Stocktake, Recipes, Suppliers, Transfers, Reports, Alerts`. No tab is a dead placeholder — every one is wired to either existing content or content genuinely derivable from existing data/patterns:

- **Inventory, Purchase Orders, Suppliers, Movements, Recipes, Stocktake** — the 6 that already work; content unchanged, re-skinned to match the new table/card visual language.
- **Receiving** — new but real: table of Purchase Orders in a receivable state (`Sent`/`Partially Received`), each row's action opens the existing `ReceiveStockDialog` pre-filled for that PO. Reuses PO data and the existing receive dialog; no new domain concept.
- **Waste** — new but real: `MovementsTable` filtered to waste-type movements (the movement-type union already includes `Waste`/`SCRAP`), same columns/sort/filter pattern as the Movements tab, with the "Record Waste" dialog reachable from the tab header.
- **Transfers** — new but real: `MovementsTable` filtered to transfer-type movements (already in the union as `Transfer`/`TRANSFER`), plus a new `TransferStockDialog` (item, from-venue, to-venue, quantity) that appends a Transfer movement to local mock state — same pattern as the existing Adjustment/Waste dialogs (local state mutation, no backend).
- **Reports** — new but real: a small set of analytics views computed via `useMemo` from the same 128-item array — inventory value by category, waste $ by category (7/30-day), low-stock/critical breakdown by venue. Distinct from the separate top-level Reports nav page (which is store-wide, not inventory-specific).
- **Alerts** — new but real: the full-list version of what the Operations Inbox card row already summarizes (all critical-stock items, all expiring-soon items, all overdue POs, all high-waste items, all variances), reusing the same derived-alerts computation the Operations Inbox row uses, just unpaginated/untruncated with per-row action links.

### Command bar mapping

Image button → current equivalent:
- Receive Goods → existing "Receive Stock" (renamed)
- Quick Receive → new, opens same Receive Stock dialog pre-set to non-PO mode (no new dialog needed)
- Purchase Order → existing
- Stock Adjustment → existing (currently only reachable via row menu) — promoted to top bar
- Record Waste → existing (currently only reachable via row menu) — promoted to top bar
- Stocktake → existing
- Transfer Stock → opens the new `TransferStockDialog` (real, working, local-state-only — see Tabs above)
- More (dropdown) → New Item, Export (both existing, demoted from top-level)

### Data changes (`mockData.ts`)

- Expand inventory items from 43 → 128 to match the image's pagination ("Showing 1 to 10 of 128 items", 13 pages), generated by extending the existing item-shape pattern (not a new generator/model), with realistic variety rather than repeated/templated rows:
  - Category pool (Produce, Meat, Seafood, Dairy, Bakery, Pantry/Dry Goods, Beverages, Cleaning/Disposables) each with plausible item names, not generic "Item 1..128".
  - Supplier pool of ~8–10 named suppliers, each linked to a plausible subset of categories (a bakery supplier doesn't sell meat), with per-supplier lead-time-days used consistently across that supplier's items and its Purchase Orders.
  - SKUs following the existing prefix convention seen in the image (`VEG-219`, `MEAT-101`, `DAIRY-021`, etc.) — category-prefixed, sequential per category, no collisions.
  - Stock levels distributed across `Healthy/Low/Critical/Zero Stock` in a realistic long-tail (most items Healthy, a minority Low/Critical, a few Zero), not evenly split.
  - Expiry dates spread realistically by category (produce/dairy short-dated, pantry/dry-goods long-dated, some items with no expiry).
  - Costs/units plausible per category (e.g. produce in kg, dairy in tubs/liters, dry goods in bags), avg-daily-use consistent with on-hand/days-left math already used by the current status logic.
  - Venue field mostly `All Venues` (matches the image's pattern) with a realistic minority assigned to a specific venue (`verdura`/`v2`/`v3`) or kitchen, matching the image's one non-"All Venues" row.
- Add `Critical` to the stock-level status union (between `Low Stock` and `Zero Stock`), with a red badge style consistent with the existing danger token.
- Add a `sparkline: number[]` field (or sibling lookup) feeding the 7 KPI cards, with trend directions that agree with the card's stated delta (e.g. a rising sparkline where the card says "↑ 2.4%").
- Add an `aiInsights: string[]` (or similar) feeding the AI Assistant widget, derived from/consistent with the actual generated data (e.g. an insight naming a real Critical-status item, not a fabricated one).
- Extend waste data with today/this-week totals and a top-3 "most wasted items" breakdown for `WasteTrackingCard`, consistent with the new Waste tab's movement log (same items, same $ figures).
- Add enough Purchase Order records (varied statuses: Draft/Approved/Sent/Partially Received/Fully Received) to populate both the existing Purchase Orders tab and the new Receiving tab's "awaiting receipt" filter meaningfully (not just 1–2 rows).
- Reuse existing venue IDs (`verdura`/`v2`/`v3`) — no new venues invented.

### Foundation compatibility (data isolation)

To keep this redesign from hard-coding assumptions that would conflict with the upcoming ledger rewrite: all "computed" values that the Foundation plan intends to derive from a movement ledger instead of storing directly — on-hand quantity, stock-level status, days-left/expiry urgency — stay behind the same small set of pure helper functions that exist today conceptually (e.g. a `getStockStatus(item)` / `getDaysLeft(item)` style boundary), rather than being recalculated ad hoc inline inside each new component. Components consume the *result* of these helpers via props, never read `item.onHand` and re-derive status themselves. This means when Foundation later swaps the helpers' internals to read from `StockMovement[]` instead of a stored field, the UI components in this redesign don't need to change — only the helper implementations and the data passed in do.

### Visual language

Reuse existing tokens throughout: `--color-primary`/green for primary actions and healthy status, existing amber/red/blue subtle-bg badge pattern for Low/Critical/Zero/info states, `rounded-xl`/`rounded-lg` card radii, existing shadow-sm card elevation, existing `text-[10px]/[11px]` uppercase micro-label style for card headers (matches "OPERATIONS INBOX", "STOCK COVERAGE (DAYS)" etc. in the image). No new component library is introduced beyond the page-local components listed above — consistent with current app-wide practice of no shared `components/ui`.

## Verification

- `npm run typecheck` (`tsc --noEmit`) clean within `admin-frontend`.
- Manual pass via `npm run dev`: every command-bar button opens a real, working dialog; all 11 tabs render real content (no dead/placeholder panels); search/filter/sort/pagination/density behave identically to current behavior on the Inventory tab; existing 6 tabs' content unchanged or improved, never lost; right sidebar shows all 5 widgets; responsive behavior at the app's existing breakpoints doesn't break the left nav/app shell.
- Side-by-side pixel comparison against `/home/cyrus/Documents/inventory.png` for the Inventory tab specifically (the only tab the image documents) — not a one-pass "looks close" check. Iterate on spacing/sizing/typography/badge styling until the diff is negligible: card heights, gaps, font sizes, badge shapes, icon sizing, table row height/padding, and sidebar widths should all visually match, not just "be in the right place."
