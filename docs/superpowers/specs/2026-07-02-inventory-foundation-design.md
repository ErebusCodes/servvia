# Inventory Foundation — Ledger Data Model & Code Structure

> **Operational integration requirement — 2026-08-15:** The ledger design must consume immutable, versioned Verdura order lines from the [Target Operating Model](../../target-operating-model.md). Preparation, payment, POS confirmation, void/refund and inventory consumption are separate events; corrections use linked reversals and retain the Verdura/Idealpos correlation chain.

> **Design status — 2026-08-15:** This specification is a deferred target design, not an implemented or verified stock ledger. Inventory is beyond the active Phase 1A scope under PRD v5.2. Current authority: [../../mvp.md](../../mvp.md).

**Required design review before resumption:** verify tenant and venue keys, decimal/UoM semantics, immutable postings, reversal linkage, concurrent stock allocation, negative-stock policy, valuation method/versioning, batch/expiry traceability, audit correlation and reconciliation with canonical order consumption.

## Context

The user requested a complete enterprise-grade rewrite of the Inventory module (`admin-frontend/src/pages/inventory/`), modeled on systems like Toast, MarketMan, Restaurant365, and Crunchtime. The full request spans purchase orders, goods receiving (PO-based and ad-hoc), stock adjustments, waste/scrap management, expired-batch tracking, recipe/BOM consumption, theoretical-vs-actual variance, multi-stage stocktakes, supplier management, multi-venue transfers, an enterprise data grid, reporting, and an AI assistant — under a strict zero-regression policy against the current implementation, and frontend-only (no backend/DB changes).

This is too large for a single spec. It has been decomposed into 9 sequenced sub-projects, each to be brainstormed, spec'd, and built independently:

1. **Foundation** (this spec) — ledger/movement data model, types, folder structure
2. Page shell — Command Bar, Operations Inbox, KPI Summary, tab navigation
3. Purchasing & receiving — PO lifecycle, Receive-Against-PO, Quick Receive
4. Adjustments, waste & expiry — dedicated workflows, batch/expiry tracking
5. Recipes & variance — BOM, recipe consumption, theoretical vs. actual
6. Stocktake
7. Suppliers & transfers
8. Reporting, right sidebar & AI assistant
9. Enterprise data grid — bulk actions, grouping, virtualization

Later sub-projects build on the data model this one establishes.

## Baseline (audited before design)

Current implementation, all frontend-only mock state, no backend:

- `InventoryPage.tsx` — 3,110 lines, single file, dashboard-centric. Already has: dashboard KPIs, inventory table with search/filter/sort/pagination/density, category/supplier/venue/status/stock-level/expiry/batch filters, CSV export, create/edit/delete item, receive stock, purchase orders (basic), stocktakes (basic), adjustments, waste, expiry handling, batch tracking, activity feed, undo-last-action, AI assistant panel, tabs for inventory/orders/suppliers/movements/recipes/stocktakes.
- `types.ts` — 92 lines. `InventoryItem.onHand` is a **mutable stored field**, not derived. `StockMovement.type` is a partial, inconsistent enum (`'Received' | 'Consumed' | 'Waste' | 'Adjustment' | 'Transfer' | 'RECEIVE' | 'SALE' | 'TRANSFER' | 'ADJUSTMENT' | 'SCRAP' | 'EXPIRED' | 'RETURN'` — mixes past-tense display labels and code-style constants). `PurchaseOrder.status` is `'Draft' | 'Sent' | 'Received' | 'Cancelled'` — missing Approved/Partially Received/Fully Received/Closed.
- `mockData.ts` — 483 lines, single-venue (`venue: 'All Venues'` on every item, no real multi-venue data despite a venue filter existing in the UI).
- No test framework configured in `admin-frontend` (`package.json` scripts: `dev`, `build` (`tsc -b && vite build`), `preview`). Verification elsewhere in this codebase is manual + typecheck.
- Venue naming already exists elsewhere in the app and should be reused for consistency: Reports (`AdvancedFiltersPanel.tsx`, `ReportsPage.tsx`, `mockData.ts`) and Reservations (`reservation.store.ts`) both reference venues `verdura` (Verdura — Downtown), `v2` (Verdura — Marina), `v3` (Verdura — Airport).

## Goals

1. Establish the movement-based ledger as the single source of truth for stock quantities — on-hand is *computed*, never stored/edited directly.
2. Define the full type model (movement types, PO lifecycle, venues, batches, transfers, recipes, stocktakes) needed by all 8 later sub-projects.
3. Break the 3,110-line monolith into focused modules.
4. Cut the existing Inventory tab and its dialogs over to the new model, proving it works end-to-end.
5. Zero regression: every feature listed in "Baseline" above must keep working identically.

## Non-goals (deferred to later sub-projects)

- New UI workflows (Command Bar, Operations Inbox, PO lifecycle UI, Quick Receive, dedicated Waste workspace, Stocktake wizard, Supplier detail views, Transfers UI, Reports/analytics, AI assistant improvements, enterprise data grid features like virtualization/grouping/bulk actions).
- Pre-creating empty folders for those future sub-projects. Each creates its own directory when it starts building.
- Recipe consumption automation (BOM exists as a type but auto-deduction on order completion is sub-project 5).
- Real backend/API integration (explicitly out of scope per the original request — frontend-only, local mock state).

## Design

### Folder structure

```
admin-frontend/src/pages/inventory/
  types/
    venue.ts
    item.ts
    movement.ts
    purchaseOrder.ts
    supplier.ts
    recipe.ts
    stocktake.ts
    batch.ts
    transfer.ts
    index.ts            (barrel export)
  mock/
    generateInventoryData.ts   (realistic multi-venue mock generator)
  ledger/
    computeOnHand.ts           (derive on-hand qty from movements)
    computeBatchQuantities.ts  (derive per-batch qty from movements)
    applyMovement.ts           (append a movement; pure, returns new array)
  hooks/
    useInventoryLedger.ts      (owns movements[] + item master data; exposes computed items)
  dialogs/
    NewItemDialog.tsx
    EditItemDialog.tsx
    ReceiveStockDialog.tsx
    PurchaseOrderDialog.tsx
    StocktakeDialog.tsx
    AdjustmentDialog.tsx
    WasteDialog.tsx
    DeleteConfirmDialog.tsx
    HistoryDialog.tsx
  components/
    Icon.tsx
    InventoryTable.tsx
  InventoryPage.tsx      (thin shell; same tabs as today: inventory/orders/suppliers/movements/recipes/stocktakes)
```

### Data model — the ledger

`StockMovement` gets the full movement-type enum:

```
RECEIVE_PO | RECEIVE_ADHOC | TRANSFER_IN | TRANSFER_OUT | SALE_CONSUMPTION |
RECIPE_CONSUMPTION | STOCK_ADJUSTMENT | SCRAP | EXPIRED | RETURN |
STOCKTAKE | PURCHASE_RETURN | SUPPLIER_CREDIT
```

Each movement: `{ id, itemId, venueId, type, quantity (signed), batchId?, reason?, reference?, user, timestamp, notes? }`.

`InventoryItem` becomes master data only: `{ id, name, sku, category, supplier, venueId(s), min, max, unit, cost, image? }`. **`onHand` is removed as a stored field.** On-hand for `(itemId, venueId)` is computed by summing signed movement quantities:

- Positive: `RECEIVE_PO`, `RECEIVE_ADHOC`, `TRANSFER_IN`, `RETURN` (into stock), `STOCK_ADJUSTMENT` when reason is Found Stock, `STOCKTAKE` when count is higher than expected.
- Negative: `SALE_CONSUMPTION`, `RECIPE_CONSUMPTION`, `TRANSFER_OUT`, `SCRAP`, `EXPIRED`, `PURCHASE_RETURN`, `STOCK_ADJUSTMENT` when reason is Lost Stock/Damage/Theft, `STOCKTAKE` when count is lower than expected.

Batch quantities are derived the same way, scoped by `batchId`.

`PurchaseOrder.status` expands to: `Draft | Approved | Sent | Partially Received | Fully Received | Cancelled | Closed`.

`Venue { id, name }` — reuses `verdura`/`v2`/`v3` IDs and Downtown/Marina/Airport names from Reports/Reservations. Mock data generates real per-venue stock levels (movements scoped to specific venues) instead of the current single `'All Venues'` placeholder. The existing "All Venues" filter option becomes a real aggregate-across-venues view rather than the only option.

`Transfer` type is added now (`{ id, itemId, fromVenueId, toVenueId, quantity, status, requestedAt, receivedAt? }`) — fields only, no UI. Building the transfer workflow is sub-project 7.

### Data flow

`useInventoryLedger()` owns `movements: StockMovement[]` and `itemMaster: InventoryItem[]` in React state. The table's item list is computed via `useMemo`, joining master data with `computeOnHand(movements, itemId, venueId)`.

Existing dialogs currently mutate item state directly (e.g. `setItems(prev => prev.map(...))`). They're rewired to call `applyMovement(movements, newMovement)` instead:

- `AdjustmentDialog` → appends `STOCK_ADJUSTMENT` with the selected reason (Physical Count, Found Stock, Lost Stock, Supplier Error, Manual Correction, Damage, Theft, Unknown, Other — already exist in the current dialog, per earlier grep of `'Supplier Error'` etc.).
- `WasteDialog` → appends `SCRAP` (or `EXPIRED` for the expiry flow).
- `ReceiveStockDialog` → appends `RECEIVE_ADHOC` (PO-linked receiving comes in sub-project 3; for now this dialog has no PO to receive against, matching current behavior).
- `PurchaseOrderDialog` (create) → creates a `PurchaseOrder` record only; no movement until received (unchanged from today, since current PO creation doesn't receive stock either).
- `StocktakeDialog` → appends `STOCKTAKE` movements for each counted item's variance.

"Undo last action" currently snapshots/restores full item arrays. It's simplified to remove the movement(s) just appended by the last action, since on-hand is now derived — removing the movement automatically reverts the computed quantity.

### Error handling

All validation is local/synchronous (no backend calls). Preserve existing validation (e.g. can't scrap more than on-hand, quantity must be non-negative) but check against **computed** on-hand rather than the old stale `item.onHand` field.

### Verification (zero-regression)

No test framework exists on this page or elsewhere in `admin-frontend`. Verification:

1. `tsc -b` passes with no type errors.
2. Manual pass through every feature listed in "Baseline," using the dev server, confirming identical behavior pre/post cutover: search, all filters (category/supplier/venue/status/stock-level/expiry/batch), sort, pagination, density toggle, CSV export, create/edit/delete item, receive stock, create PO, stocktake, adjustment, waste, expiry handling, batch display, activity feed, undo.
3. Multi-venue spot-check: confirm on-hand differs correctly per venue and the "All Venues" aggregate view sums correctly across venues.

## Open questions / risks

- The current `InventoryItem` has both `expiryDate`/`batchNumber` (singular, top-level) and `batches: InventoryBatch[]` (array) — likely legacy duplication. Foundation will consolidate onto the `batches` array only, removing the top-level singular fields, since the array form already supersedes them in the existing code (grep showed both used in mock data). This is a small cleanup, not a new feature.
- `PurchaseOrder` currently has no line items (`itemsCount: number` only, no actual item breakdown). Foundation will not add PO line items yet — that's sub-project 3's job — but will leave the type open to extension (no line-items array added prematurely).
