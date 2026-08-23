# Inventory Foundation Implementation Plan

> **Operational integration requirement — 2026-08-15:** When this deferred plan resumes, consumption must originate from the immutable Verdura order version defined by the [Target Operating Model](../../target-operating-model.md), not from Idealpos imports or mutable KDS tickets. Reversals, voids and refunds must retain links to both Verdura and Idealpos transaction references so inventory and financial reconciliation remain explainable.

> **Phase-gate notice — 2026-08-15:** This is a historical/prototype plan for a later-phase capability. PRD v5.2 permits Material Management only after Phase 1A operational control is proven and voluntary count discipline/customer demand are established. Current inventory UI/state is not an enterprise stock ledger and must not be represented as production inventory capability. Current authority: [../../mvp.md](../../mvp.md).

**Recommendation:** pause production expansion of this plan until payment/POS truthfulness, edge delivery, availability fan-out, reconciliation, tenancy and audit P0/P1 gates are closed. When resumed, require immutable material documents, reversal-only corrections, decimal quantities/UoM conversion, transactional posting, tenant-aware constraints, batch/expiry lineage and reconciliation to order consumption.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the mutable `onHand`-on-item stock model in `admin-frontend/src/pages/inventory/` with a movement-based ledger (on-hand computed from `StockMovement` history, never stored), and break the 3,110-line `InventoryPage.tsx` monolith into a typed, modular structure — without changing any visible behavior of the existing "inventory" tab and its dialogs (zero regression).

**Architecture:** Pure ledger functions (`computeOnHand`, `computeBatchQuantities`, `applyMovement`) operate on an immutable `StockMovement[]` array. A `useInventoryLedger()` hook owns `movements[]` + `itemMaster[]` in React state and exposes memoized computed items (on-hand, status, days-left derived, not stored). Dialogs call ledger mutators instead of `setItems(prev => ...)`. The 9 modal dialogs and the main table are extracted from the monolithic JSX into their own files; `InventoryPage.tsx` becomes an orchestrating shell.

**Tech Stack:** React 18 + TypeScript (strict), Vite, Tailwind CSS. No test framework installed (`vitest`/`jest` absent from `admin-frontend/package.json`) — verification is `tsc --noEmit` (or `npm run typecheck`) plus manual pass through the dev server, per the design spec's own verification section.

## Global Constraints

- Frontend-only. No backend/API/DB changes. Scope is limited to `admin-frontend/src/pages/inventory/`.
- Reuse existing venue IDs/names — do not invent new ones: `verdura` (Verdura — Downtown), `v2` (Verdura — Marina), `v3` (Verdura — Airport). Source of truth: `admin-frontend/src/pages/reports/mockData.ts:6-8`.
- No test framework exists in `admin-frontend`. Every task's verification step is `npm run typecheck` (`tsc --noEmit`) and/or a manual check via `npm run dev`, never an automated test command.
- **The codebase does not currently pass `tsc --noEmit`.** Confirmed 2026-07-03: 215 errors, all inside `admin-frontend/src/pages/inventory/InventoryPage.tsx`. Root cause: `types.ts` was already edited toward the new movement-type enum (`RECEIVE_PO` | `RECEIVE_ADHOC` | ... ) and an expanded `PurchaseOrder` shape (with `items: PurchaseOrderItem[]`) by a prior abandoned attempt, but `InventoryPage.tsx` still uses the old string literals (`'Consumed'`, `'Waste'`, `'RECEIVE'`, `'ADJUSTMENT'`, etc.) and constructs POs without `items`. There is also a real bug: the Receive Stock dialog references `receiveStockDraft`/`setReceiveStockDraft`, which don't exist — the actual state is named `receiveGoodsDraft`/`setReceiveGoodsDraft` (undeclared-variable errors TS2304/TS2552 at lines 2830-2876). **Do not treat "keep tsc error count from growing" as the bar.** `tsc --noEmit` is only required to pass cleanly as the exit criterion of Task 11 (final cutover). Earlier tasks build new, isolated files that type-check on their own; they are not required to bring the still-untouched `InventoryPage.tsx` back to green.
- `admin-frontend/src/pages/inventory/hooks/useInventoryState.ts` (992 lines) is dead code — grep confirms nothing imports `useInventoryState`. It was an earlier abandoned attempt at extracting state (models 11 tabs and PO-receiving/transfer features the live 6-tab UI doesn't expose) and still has the same mutable-`onHand` bug this plan fixes. Per user decision, delete it outright in Task 11 rather than mining it — its logic isn't reliable reference material since it was never wired up or manually verified.
- Do not pre-create empty folders for later Inventory sub-projects (Page shell, Purchasing, Adjustments, Recipes, Stocktake, Suppliers, Reporting, Data grid). Each of those creates its own directory when its own plan starts.
- The design spec's dialog list (`dialogs/AdjustmentDialog.tsx`, `WasteDialog.tsx`, `HistoryDialog.tsx`, etc.) omits one dialog the live baseline actually has: the "Mark Expired" flow (`expiryDraft` state, `handleExpirySubmit` handler, `isExpiryOpen` flag — all present in `InventoryPage.tsx` today but never rendered). This plan adds `dialogs/ExpiryDialog.tsx` as a 10th dialog file to preserve that baseline feature — zero-regression (spec Goal 5) overrides the spec's dialog list being one short.
- Two currently-dead UI triggers get wired up, not newly invented: `AdjustmentDialog`, `WasteDialog`, `ExpiryDialog`, and `HistoryDialog` all already have working "open" buttons in the row action menu (`InventoryPage.tsx:1844-1905`, `setIsAdjustmentOpen(true)` etc.) that currently do nothing because no dialog JSX exists to read those flags. Building these dialogs completes existing (broken) intent; it is not new scope.
- Commit after each task.

## Target File Structure

```
admin-frontend/src/pages/inventory/
  types/
    venue.ts
    batch.ts
    item.ts
    movement.ts
    purchaseOrder.ts
    supplier.ts
    recipe.ts
    stocktake.ts
    transfer.ts
    index.ts                     (barrel export; replaces types.ts)
  mock/
    generateInventoryData.ts     (multi-venue mock generator; replaces mockData.ts)
  ledger/
    computeOnHand.ts
    computeBatchQuantities.ts
    applyMovement.ts
  hooks/
    useInventoryLedger.ts        (replaces the dead useInventoryState.ts)
  dialogs/
    NewItemDialog.tsx
    EditItemDialog.tsx
    ReceiveStockDialog.tsx
    PurchaseOrderDialog.tsx
    StocktakeDialog.tsx
    AdjustmentDialog.tsx
    WasteDialog.tsx
    ExpiryDialog.tsx
    DeleteConfirmDialog.tsx
    HistoryDialog.tsx
  components/
    Icon.tsx
    InventoryTable.tsx
  InventoryPage.tsx              (shell: same 6 tabs as today — inventory/orders/suppliers/movements/recipes/stocktakes)
```

`types.ts`, `mockData.ts`, and `hooks/useInventoryState.ts` are deleted in Task 11 once nothing imports them.

---

### Task 1: Types module

**Files:**
- Create: `admin-frontend/src/pages/inventory/types/venue.ts`
- Create: `admin-frontend/src/pages/inventory/types/batch.ts`
- Create: `admin-frontend/src/pages/inventory/types/item.ts`
- Create: `admin-frontend/src/pages/inventory/types/movement.ts`
- Create: `admin-frontend/src/pages/inventory/types/purchaseOrder.ts`
- Create: `admin-frontend/src/pages/inventory/types/supplier.ts`
- Create: `admin-frontend/src/pages/inventory/types/recipe.ts`
- Create: `admin-frontend/src/pages/inventory/types/stocktake.ts`
- Create: `admin-frontend/src/pages/inventory/types/transfer.ts`
- Create: `admin-frontend/src/pages/inventory/types/index.ts`
- Delete: `admin-frontend/src/pages/inventory/types.ts` (its content is superseded by the files above)

**Interfaces:**
- Produces: `Venue`, `VENUES`, `InventoryBatch`, `InventoryItem`, `InventoryItemStatus`, `ComputedInventoryItem`, `MovementType`, `AdjustmentReason`, `WasteReason`, `ExpiryActionType`, `StockMovement`, `PurchaseOrderItem`, `PurchaseOrder`, `SupplierPriceTrend`, `Supplier`, `Recipe`, `RecipeIngredient`, `StocktakeRecord`, `InventoryTransferItem`, `InventoryTransfer` — all re-exported from `types/index.ts`. Every later task imports types via `from '../types'` or `from './types'` (resolves to `types/index.ts`).

- [ ] **Step 1: Delete the old `types.ts` and create `types/venue.ts`**

Delete `admin-frontend/src/pages/inventory/types.ts` first (a file and a same-named directory can't coexist as import targets — deleting it first avoids ambiguous resolution while you build the folder).

```ts
// admin-frontend/src/pages/inventory/types/venue.ts
export interface Venue {
  id: string;
  name: string;
}

export const VENUES: Venue[] = [
  { id: 'verdura', name: 'Verdura — Downtown' },
  { id: 'v2', name: 'Verdura — Marina' },
  { id: 'v3', name: 'Verdura — Airport' },
];
```

- [ ] **Step 2: Create `types/batch.ts`**

`quantity` is dropped — batch quantities are now derived via `computeBatchQuantities` (Task 2), never stored. `status` ('Expired' | 'Expiring Today' | ...) is dropped for the same reason — it's computed from `expiryDate` at render time.

```ts
// admin-frontend/src/pages/inventory/types/batch.ts
export interface InventoryBatch {
  id: string;
  batchNumber: string;
  supplier: string;
  receivedDate: string; // YYYY-MM-DD
  expiryDate: string;   // YYYY-MM-DD
}
```

- [ ] **Step 3: Create `types/item.ts`**

`onHand`, `daysLeft`, `status`, `updated`, top-level `expiryDate`/`batchNumber`/`expiredQty`, and the theoretical-vs-actual fields (`expectedStock`/`actualStock`/`wasteStock`/`varianceQty`/`varianceCost`) are all dropped from the stored type — they're derived. `venue: string` becomes `venueIds: string[]` (an item is master data shared across whichever venues carry it; on-hand is computed per `(itemId, venueId)` pair, not stored per venue). `avgUsage` stays as stored master data (a forecasting parameter, not ledger-derived — computing real usage rate from `SALE_CONSUMPTION` history is out of scope, per the spec's non-goals).

```ts
// admin-frontend/src/pages/inventory/types/item.ts
import { InventoryBatch } from './batch';

export interface InventoryItem {
  id: string;
  name: string;
  sku: string;
  category: string;
  supplier: string;
  venueIds: string[];
  min: number;
  max: number;
  unit: string;
  cost: number;
  avgUsage: number;
  image?: string;
  batches: InventoryBatch[];
}

export type InventoryItemStatus = 'Zero Stock' | 'Low Stock' | 'Healthy' | 'Critical' | 'Out of Stock' | 'Expired';

// What the UI actually renders: master data + values computed from the ledger.
export interface ComputedInventoryItem extends InventoryItem {
  onHand: number;
  daysLeft: number;
  status: InventoryItemStatus;
  nearestBatchNumber?: string;
  nearestExpiry?: string;
  expiredQty: number;
}
```

- [ ] **Step 4: Create `types/movement.ts`**

Matches the spec's target shape: `{ id, itemId, venueId, type, quantity (signed), batchId?, reason?, reference?, user, timestamp, notes? }`, plus `unit`/`value` kept from the current baseline (needed by the Movements tab and KPI cards — `value` is the cost impact captured at the time of the movement, since `item.cost` can drift later and the ledger is an audit trail). `date`/`time` collapse into one ISO `timestamp` string. `itemName` (a display convenience in the old shape) is dropped — display code looks up the item by `itemId` instead, so movements stay correct if an item is renamed.

```ts
// admin-frontend/src/pages/inventory/types/movement.ts
export type MovementType =
  | 'RECEIVE_PO'
  | 'RECEIVE_ADHOC'
  | 'TRANSFER_IN'
  | 'TRANSFER_OUT'
  | 'SALE_CONSUMPTION'
  | 'RECIPE_CONSUMPTION'
  | 'STOCK_ADJUSTMENT'
  | 'SCRAP'
  | 'EXPIRED'
  | 'RETURN'
  | 'STOCKTAKE'
  | 'PURCHASE_RETURN'
  | 'SUPPLIER_CREDIT';

export type AdjustmentReason =
  | 'Physical Count'
  | 'Found Stock'
  | 'Lost Stock'
  | 'Supplier Error'
  | 'Manual Correction'
  | 'Damage'
  | 'Theft'
  | 'Unknown'
  | 'Other';

export type WasteReason =
  | 'Prep Waste'
  | 'Cooking Waste'
  | 'Expired'
  | 'Spoiled'
  | 'Damaged'
  | 'Kitchen Error'
  | 'Customer Return'
  | 'Overproduction'
  | 'Accidental Waste'
  | 'Staff Meal';

export type ExpiryActionType = 'Dispose' | 'Return to Supplier' | 'Discount' | 'Donate';

export interface StockMovement {
  id: string;
  itemId: string;
  venueId: string;
  type: MovementType;
  quantity: number; // signed: positive = into stock, negative = out of stock
  unit: string;
  value: number;    // signed cost impact: quantity * unit cost at time of movement
  batchId?: string;
  reason?: AdjustmentReason | WasteReason | string;
  reference?: string; // PO number, transfer number, etc.
  user: string;
  timestamp: string; // ISO 8601
  notes?: string;
}
```

- [ ] **Step 5: Create `types/purchaseOrder.ts`, `types/supplier.ts`, `types/recipe.ts`, `types/stocktake.ts`, `types/transfer.ts`**

These five are **not** part of the ledger rewrite (sub-projects 3/5/6/7 own their respective workflows) — copy them out of the deleted `types.ts` verbatim, just split into their own files, with barrel re-exports.

```ts
// admin-frontend/src/pages/inventory/types/purchaseOrder.ts
export interface PurchaseOrderItem {
  productId: string;
  name: string;
  expectedQty: number;
  receivedQty: number;
  rejectedQty: number;
  damagedQty: number;
  unit: string;
  cost: number;
}

export interface PurchaseOrder {
  id: string;
  orderNumber: string;
  supplier: string;
  itemsCount: number;
  totalAmount: number;
  status: 'Draft' | 'Approved' | 'Sent' | 'Partially Received' | 'Fully Received' | 'Cancelled' | 'Closed';
  orderDate: string;
  deliveryDate: string;
  items: PurchaseOrderItem[];
  supplierInvoice?: string;
  deliveryNotes?: string;
}
```

```ts
// admin-frontend/src/pages/inventory/types/supplier.ts
export interface SupplierPriceTrend {
  month: string;
  changePercent: number;
}

export interface Supplier {
  id: string;
  name: string;
  onTimeRate: number;
  leadTimeDays: number;
  trend: 'up' | 'down' | 'stable';
  contact: string;
  phone: string;
  email: string;
  category: string;
  purchaseOrdersCount?: number;
  receivingHistoryCount?: number;
  averageDeliveryTime?: number;
  priceTrends?: SupplierPriceTrend[];
  deliveryAccuracy?: number;
  lateDeliveries?: number;
  outstandingOrders?: number;
  preferred?: boolean;
}
```

```ts
// admin-frontend/src/pages/inventory/types/recipe.ts
export interface RecipeIngredient {
  productId: string;
  name: string;
  quantity: number;
  unit: string;
}

export interface Recipe {
  id: string;
  name: string;
  category: string;
  ingredientsCount: number;
  costPerPortion: number;
  margin: number;
  sellingPrice: number;
  ingredients: RecipeIngredient[];
}
```

```ts
// admin-frontend/src/pages/inventory/types/stocktake.ts
export interface StocktakeRecord {
  id: string;
  date: string;
  itemsAudited: number;
  discrepancyCount: number;
  accuracyPercent: number;
  status: 'Completed' | 'In Progress';
  varianceCost?: number;
  area?: string;
  category?: string;
}
```

```ts
// admin-frontend/src/pages/inventory/types/transfer.ts
export interface InventoryTransferItem {
  productId: string;
  name: string;
  quantity: number;
  unit: string;
  cost: number;
}

export interface InventoryTransfer {
  id: string;
  transferNumber: string;
  fromVenue: string;
  toVenue: string;
  items: InventoryTransferItem[];
  status: 'Pending' | 'Received' | 'Rejected';
  date: string;
  notes?: string;
}
```

- [ ] **Step 6: Create the barrel `types/index.ts`**

```ts
// admin-frontend/src/pages/inventory/types/index.ts
export * from './venue';
export * from './batch';
export * from './item';
export * from './movement';
export * from './purchaseOrder';
export * from './supplier';
export * from './recipe';
export * from './stocktake';
export * from './transfer';
```

- [ ] **Step 7: Verify and commit**

Run: `cd admin-frontend && npx tsc --noEmit 2>&1 | grep -c "types/"` — expect `0` (no errors originating inside the new `types/` folder itself; errors in `InventoryPage.tsx`/`mockData.ts`/`hooks/useInventoryState.ts` from the removed `onHand` field are expected and are resolved in later tasks).

```bash
git add admin-frontend/src/pages/inventory/types admin-frontend/src/pages/inventory/types.ts
git commit -m "inventory: replace types.ts with movement-ledger type module"
```

---

### Task 2: Ledger pure functions

**Files:**
- Create: `admin-frontend/src/pages/inventory/ledger/computeOnHand.ts`
- Create: `admin-frontend/src/pages/inventory/ledger/computeBatchQuantities.ts`
- Create: `admin-frontend/src/pages/inventory/ledger/applyMovement.ts`

**Interfaces:**
- Consumes: `StockMovement` from `../types` (Task 1)
- Produces: `computeOnHand(movements, itemId, venueId?) => number`, `computeBatchQuantities(movements, itemId, venueId?) => Record<string, number>`, `applyMovement(movements, newMovement) => StockMovement[]` — all consumed by Task 4's hook and Tasks 6-9's dialogs.

- [ ] **Step 1: Write `computeOnHand.ts`**

Omitting `venueId` aggregates across all venues (the "All Venues" view).

```ts
// admin-frontend/src/pages/inventory/ledger/computeOnHand.ts
import { StockMovement } from '../types';

export function computeOnHand(movements: StockMovement[], itemId: string, venueId?: string): number {
  return movements.reduce((sum, m) => {
    if (m.itemId !== itemId) return sum;
    if (venueId && m.venueId !== venueId) return sum;
    return sum + m.quantity;
  }, 0);
}
```

- [ ] **Step 2: Write `computeBatchQuantities.ts`**

```ts
// admin-frontend/src/pages/inventory/ledger/computeBatchQuantities.ts
import { StockMovement } from '../types';

export function computeBatchQuantities(
  movements: StockMovement[],
  itemId: string,
  venueId?: string
): Record<string, number> {
  const result: Record<string, number> = {};
  for (const m of movements) {
    if (m.itemId !== itemId) continue;
    if (venueId && m.venueId !== venueId) continue;
    if (!m.batchId) continue;
    result[m.batchId] = (result[m.batchId] ?? 0) + m.quantity;
  }
  return result;
}
```

- [ ] **Step 3: Write `applyMovement.ts`**

Pure, prepends the new movement — matches the "most recent first" ordering every mutator in the current codebase already uses (e.g. `setStockMovements(prev => [newMovement, ...prev])`). No validation here; validation (e.g. "can't scrap more than on-hand") happens in the hook/dialog before calling this, per the spec's Error Handling section.

```ts
// admin-frontend/src/pages/inventory/ledger/applyMovement.ts
import { StockMovement } from '../types';

export function applyMovement(movements: StockMovement[], newMovement: StockMovement): StockMovement[] {
  return [newMovement, ...movements];
}
```

- [ ] **Step 4: Manual verification (no test framework — verify via a throwaway script)**

Create a scratch file, run it, then delete it — this is not committed.

```bash
cat > /tmp/ledger-check.mjs << 'EOF'
// Inline reimplementation for a quick manual sanity check (TS can't run directly via node here).
function computeOnHand(movements, itemId, venueId) {
  return movements.reduce((sum, m) => {
    if (m.itemId !== itemId) return sum;
    if (venueId && m.venueId !== venueId) return sum;
    return sum + m.quantity;
  }, 0);
}
const movements = [
  { itemId: 'i1', venueId: 'verdura', quantity: 50 },
  { itemId: 'i1', venueId: 'verdura', quantity: -12 },
  { itemId: 'i1', venueId: 'v2', quantity: 20 },
];
console.assert(computeOnHand(movements, 'i1') === 58, 'aggregate on-hand should be 58, got ' + computeOnHand(movements, 'i1'));
console.assert(computeOnHand(movements, 'i1', 'verdura') === 38, 'verdura on-hand should be 38, got ' + computeOnHand(movements, 'i1', 'verdura'));
console.log('ledger sanity check passed');
EOF
node /tmp/ledger-check.mjs
rm /tmp/ledger-check.mjs
```

Run: `cd admin-frontend && npx tsc --noEmit 2>&1 | grep "ledger/"` — expect no output (empty = clean).

- [ ] **Step 5: Commit**

```bash
git add admin-frontend/src/pages/inventory/ledger
git commit -m "inventory: add pure ledger functions (computeOnHand, computeBatchQuantities, applyMovement)"
```

---

### Task 3: Multi-venue mock data generator

**Files:**
- Create: `admin-frontend/src/pages/inventory/mock/generateInventoryData.ts`
- Delete: `admin-frontend/src/pages/inventory/mockData.ts` (superseded; nothing imports it yet at this point in the plan except the not-yet-cutover `InventoryPage.tsx` and the doomed `useInventoryState.ts` — both get fixed/deleted in Task 11)

**Interfaces:**
- Consumes: types from `../types` (Task 1), nothing from the ledger (the generator emits raw `StockMovement[]`; on-hand is derived by whoever reads it).
- Produces: `generateInventoryData(): { items: InventoryItem[]; movements: StockMovement[]; purchaseOrders: PurchaseOrder[]; suppliers: Supplier[]; recipes: Recipe[]; stocktakes: StocktakeRecord[]; transfers: InventoryTransfer[] }` — consumed by Task 4's hook.

- [ ] **Step 1: Write the generator**

Ports the current `mockData.ts` catalog (24 items across 8 categories, per the spec's baseline) but assigns each item to 1-3 of the 3 real venues and emits an initial `RECEIVE_ADHOC` movement per `(item, venue)` pair instead of a stored `onHand` — so on-hand is real ledger output from the very first render, not a placeholder.

```ts
// admin-frontend/src/pages/inventory/mock/generateInventoryData.ts
import { VENUES } from '../types/venue';
import {
  InventoryItem, StockMovement, PurchaseOrder, Supplier, Recipe, StocktakeRecord, InventoryTransfer
} from '../types';

const CATALOG: Array<{
  name: string; sku: string; category: string; supplier: string;
  unit: string; cost: number; min: number; max: number; avgUsage: number;
  venueIds: string[]; startingQty: Record<string, number>;
}> = [
  { name: 'Chicken Breast', sku: 'MEAT-101', category: 'Raw Meat', supplier: 'Fresh Foods Ltd', unit: 'kg', cost: 12.5, min: 20, max: 100, avgUsage: 8,
    venueIds: ['verdura', 'v2', 'v3'], startingQty: { verdura: 45, v2: 22, v3: 15 } },
  { name: 'Beef Tenderloin', sku: 'MEAT-102', category: 'Raw Meat', supplier: 'Fresh Foods Ltd', unit: 'kg', cost: 34.0, min: 10, max: 40, avgUsage: 3,
    venueIds: ['verdura', 'v2'], startingQty: { verdura: 18, v2: 6 } },
  { name: 'Olive Oil (Extra Virgin)', sku: 'OIL-201', category: 'Oils & Fats', supplier: 'Mediterra Imports', unit: 'L', cost: 9.0, min: 15, max: 50, avgUsage: 4,
    venueIds: ['verdura', 'v2', 'v3'], startingQty: { verdura: 30, v2: 12, v3: 9 } },
  { name: 'Sourdough Loaf', sku: 'BAK-301', category: 'Bakery', supplier: 'Artisan Bakehouse', unit: 'loaves', cost: 3.2, min: 20, max: 60, avgUsage: 15,
    venueIds: ['verdura', 'v2', 'v3'], startingQty: { verdura: 25, v2: 14, v3: 0 } },
  { name: 'Feta Cheese', sku: 'DAI-401', category: 'Dairy', supplier: 'Highland Dairy Co', unit: 'kg', cost: 11.0, min: 8, max: 30, avgUsage: 3,
    venueIds: ['verdura', 'v3'], startingQty: { verdura: 12, v3: 4 } },
  { name: 'Heavy Cream', sku: 'DAI-402', category: 'Dairy', supplier: 'Highland Dairy Co', unit: 'L', cost: 4.5, min: 12, max: 40, avgUsage: 6,
    venueIds: ['verdura', 'v2', 'v3'], startingQty: { verdura: 20, v2: 10, v3: 8 } },
  { name: 'Roma Tomatoes', sku: 'VEG-501', category: 'Vegetables', supplier: 'Green Valley Produce', unit: 'kg', cost: 3.1, min: 25, max: 80, avgUsage: 12,
    venueIds: ['verdura', 'v2', 'v3'], startingQty: { verdura: 40, v2: 18, v3: 10 } },
  { name: 'Baby Spinach', sku: 'VEG-502', category: 'Vegetables', supplier: 'Green Valley Produce', unit: 'kg', cost: 6.4, min: 10, max: 35, avgUsage: 5,
    venueIds: ['verdura', 'v2'], startingQty: { verdura: 14, v2: 3 } },
  { name: 'Basmati Rice', sku: 'DRY-601', category: 'Dry Goods', supplier: 'Pacific Wholesale', unit: 'kg', cost: 2.8, min: 40, max: 150, avgUsage: 10,
    venueIds: ['verdura', 'v2', 'v3'], startingQty: { verdura: 60, v2: 35, v3: 20 } },
  { name: 'All-Purpose Flour', sku: 'DRY-602', category: 'Dry Goods', supplier: 'Pacific Wholesale', unit: 'kg', cost: 1.9, min: 30, max: 100, avgUsage: 9,
    venueIds: ['verdura', 'v2', 'v3'], startingQty: { verdura: 40, v2: 20, v3: 12 } },
  { name: 'Sparkling Water', sku: 'BEV-701', category: 'Beverages', supplier: 'AquaSource', unit: 'bottles', cost: 1.1, min: 60, max: 240, avgUsage: 35,
    venueIds: ['verdura', 'v2', 'v3'], startingQty: { verdura: 120, v2: 80, v3: 40 } },
  { name: 'House Red Wine', sku: 'BEV-702', category: 'Beverages', supplier: 'Vintner Direct', unit: 'bottles', cost: 8.5, min: 24, max: 96, avgUsage: 6,
    venueIds: ['verdura', 'v2'], startingQty: { verdura: 30, v2: 10 } },
  { name: 'Takeout Containers (16oz)', sku: 'PKG-801', category: 'Packaging', supplier: 'EcoPack Supply', unit: 'units', cost: 0.22, min: 200, max: 1000, avgUsage: 90,
    venueIds: ['verdura', 'v2', 'v3'], startingQty: { verdura: 400, v2: 250, v3: 150 } },
  { name: 'Paper Napkins', sku: 'PKG-802', category: 'Packaging', supplier: 'EcoPack Supply', unit: 'packs', cost: 1.4, min: 30, max: 120, avgUsage: 8,
    venueIds: ['verdura', 'v2', 'v3'], startingQty: { verdura: 45, v2: 22, v3: 10 } },
];

function seedItems(): InventoryItem[] {
  return CATALOG.map((c, idx) => ({
    id: `inv-${idx + 1}`,
    name: c.name,
    sku: c.sku,
    category: c.category,
    supplier: c.supplier,
    venueIds: c.venueIds,
    min: c.min,
    max: c.max,
    unit: c.unit,
    cost: c.cost,
    avgUsage: c.avgUsage,
    batches: [],
  }));
}

function seedMovements(items: InventoryItem[]): StockMovement[] {
  const movements: StockMovement[] = [];
  let seq = 0;
  items.forEach((item, idx) => {
    const catalog = CATALOG[idx];
    item.venueIds.forEach(venueId => {
      const qty = catalog.startingQty[venueId] ?? 0;
      if (qty <= 0) return;
      seq += 1;
      const batchId = `b-seed-${item.id}-${venueId}`;
      movements.push({
        id: `mov-seed-${seq}`,
        itemId: item.id,
        venueId,
        type: 'RECEIVE_ADHOC',
        quantity: qty,
        unit: item.unit,
        value: qty * item.cost,
        batchId,
        reference: 'INITIAL-STOCK',
        user: 'System',
        timestamp: '2026-06-25T08:00:00.000Z',
        notes: 'Opening balance (mock seed)',
      });
      item.batches.push({
        id: batchId,
        batchNumber: `BAT-SEED-${item.sku}-${venueId.toUpperCase()}`,
        supplier: item.supplier,
        receivedDate: '2026-06-25',
        expiryDate: '2026-07-20',
      });
    });
  });
  return movements;
}

const suppliers: Supplier[] = [
  { id: 'sup-1', name: 'Fresh Foods Ltd', onTimeRate: 96, leadTimeDays: 2, trend: 'up', contact: 'Dana Ruiz', phone: '555-0101', email: 'dana@freshfoods.example', category: 'Raw Meat', preferred: true },
  { id: 'sup-2', name: 'Mediterra Imports', onTimeRate: 91, leadTimeDays: 5, trend: 'stable', contact: 'Marco Lin', phone: '555-0102', email: 'marco@mediterra.example', category: 'Oils & Fats' },
  { id: 'sup-3', name: 'Artisan Bakehouse', onTimeRate: 98, leadTimeDays: 1, trend: 'up', contact: 'Priya Shah', phone: '555-0103', email: 'priya@bakehouse.example', category: 'Bakery', preferred: true },
  { id: 'sup-4', name: 'Highland Dairy Co', onTimeRate: 89, leadTimeDays: 3, trend: 'down', contact: 'Tom Reyes', phone: '555-0104', email: 'tom@highlanddairy.example', category: 'Dairy' },
  { id: 'sup-5', name: 'Green Valley Produce', onTimeRate: 94, leadTimeDays: 1, trend: 'stable', contact: 'Nia Okafor', phone: '555-0105', email: 'nia@greenvalley.example', category: 'Vegetables' },
  { id: 'sup-6', name: 'Pacific Wholesale', onTimeRate: 97, leadTimeDays: 4, trend: 'up', contact: 'Ben Sato', phone: '555-0106', email: 'ben@pacificws.example', category: 'Dry Goods', preferred: true },
  { id: 'sup-7', name: 'AquaSource', onTimeRate: 99, leadTimeDays: 2, trend: 'stable', contact: 'Ella Novak', phone: '555-0107', email: 'ella@aquasource.example', category: 'Beverages' },
  { id: 'sup-8', name: 'Vintner Direct', onTimeRate: 93, leadTimeDays: 6, trend: 'down', contact: 'Hugo Ferrer', phone: '555-0108', email: 'hugo@vintnerdirect.example', category: 'Beverages' },
  { id: 'sup-9', name: 'EcoPack Supply', onTimeRate: 95, leadTimeDays: 3, trend: 'up', contact: 'Wren Adler', phone: '555-0109', email: 'wren@ecopack.example', category: 'Packaging' },
];

const recipes: Recipe[] = [
  { id: 'rec-1', name: 'Grilled Chicken Bowl', category: 'Mains', ingredientsCount: 3, costPerPortion: 6.4, margin: 62, sellingPrice: 16.5,
    ingredients: [
      { productId: 'inv-1', name: 'Chicken Breast', quantity: 0.2, unit: 'kg' },
      { productId: 'inv-9', name: 'Basmati Rice', quantity: 0.15, unit: 'kg' },
      { productId: 'inv-7', name: 'Roma Tomatoes', quantity: 0.1, unit: 'kg' },
    ] },
  { id: 'rec-2', name: 'Caprese Sandwich', category: 'Sandwiches', ingredientsCount: 3, costPerPortion: 4.1, margin: 58, sellingPrice: 9.75,
    ingredients: [
      { productId: 'inv-4', name: 'Sourdough Loaf', quantity: 0.25, unit: 'loaves' },
      { productId: 'inv-5', name: 'Feta Cheese', quantity: 0.06, unit: 'kg' },
      { productId: 'inv-7', name: 'Roma Tomatoes', quantity: 0.08, unit: 'kg' },
    ] },
];

const purchaseOrders: PurchaseOrder[] = [
  { id: 'po-1', orderNumber: 'PO-2026-001', supplier: 'Fresh Foods Ltd', itemsCount: 2, totalAmount: 1240.0, status: 'Sent',
    orderDate: '2026-06-28', deliveryDate: '2026-07-05',
    items: [
      { productId: 'inv-1', name: 'Chicken Breast', expectedQty: 60, receivedQty: 0, rejectedQty: 0, damagedQty: 0, unit: 'kg', cost: 12.5 },
      { productId: 'inv-2', name: 'Beef Tenderloin', expectedQty: 20, receivedQty: 0, rejectedQty: 0, damagedQty: 0, unit: 'kg', cost: 34.0 },
    ] },
];

const stocktakes: StocktakeRecord[] = [
  { id: 'stk-seed-1', date: '2026-06-20', itemsAudited: 14, discrepancyCount: 2, accuracyPercent: 85.7, status: 'Completed', varianceCost: -18.4, area: 'Main Kitchen', category: 'All' },
];

const transfers: InventoryTransfer[] = [];

export function generateInventoryData() {
  const items = seedItems();
  const movements = seedMovements(items);
  return { items, movements, purchaseOrders, suppliers, recipes, stocktakes, transfers };
}
```

- [ ] **Step 2: Verify**

Run: `cd admin-frontend && npx tsc --noEmit 2>&1 | grep "mock/"` — expect no output.

Manual spot-check (throwaway, same pattern as Task 2 Step 4): confirm `generateInventoryData().items.length === 14` and `generateInventoryData().movements.length` equals the count of non-zero `startingQty` entries across the catalog (33).

- [ ] **Step 3: Commit**

```bash
git add admin-frontend/src/pages/inventory/mock admin-frontend/src/pages/inventory/mockData.ts
git commit -m "inventory: add multi-venue mock data generator, remove single-venue mockData.ts"
```

---

### Task 4: `useInventoryLedger` hook

**Files:**
- Create: `admin-frontend/src/pages/inventory/hooks/useInventoryLedger.ts`

**Interfaces:**
- Consumes: `generateInventoryData` (Task 3), `computeOnHand`/`computeBatchQuantities`/`applyMovement` (Task 2), types (Task 1)
- Produces: the hook's full return shape (below) — consumed by Task 11's `InventoryPage.tsx` cutover and indirectly by every dialog (Tasks 6-9), which receive mutator callbacks as props rather than importing the hook directly.

- [ ] **Step 1: Write the hook**

Design notes baked into the code below:
- `computedItems` exposes aggregate (all-venue) `onHand` — matches the baseline's default "All Venues" view. Venue-specific on-hand for the venue filter dropdown is computed on demand by the caller via the exported `computeOnHandForVenue` passthrough, not pre-computed for every venue (avoids recomputing N items × 3 venues on every render when the UI only needs one venue at a time).
- `status`/`daysLeft`/`nearestExpiry`/`nearestBatchNumber`/`expiredQty` are derived in the same `useMemo` pass that computes `onHand`, replacing the manual recomputation that used to happen inline after every mutation in the old handlers.
- "Undo last movement" replaces the old "undo last action" (which snapshotted/restored full item arrays). Since on-hand is derived, undo only needs to remove the movement(s) just appended — the computed on-hand reverts automatically. It tracks the count of movements appended by the last action (most mutators append 1; PO receiving and stocktake finalize can append several).

```ts
// admin-frontend/src/pages/inventory/hooks/useInventoryLedger.ts
import { useState, useMemo, useCallback } from 'react';
import {
  InventoryItem, ComputedInventoryItem, StockMovement, InventoryBatch,
  PurchaseOrder, PurchaseOrderItem, Supplier, Recipe, StocktakeRecord, InventoryTransfer,
  AdjustmentReason, WasteReason, ExpiryActionType,
} from '../types';
import { generateInventoryData } from '../mock/generateInventoryData';
import { computeOnHand } from '../ledger/computeOnHand';
import { computeBatchQuantities } from '../ledger/computeBatchQuantities';
import { applyMovement } from '../ledger/applyMovement';

const TODAY = () => new Date().toISOString().substring(0, 10);
const NOW = () => new Date().toISOString();

export function useInventoryLedger() {
  const seed = useState(() => generateInventoryData())[0];

  const [itemMaster, setItemMaster] = useState<InventoryItem[]>(seed.items);
  const [movements, setMovements] = useState<StockMovement[]>(seed.movements);
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>(seed.purchaseOrders);
  const [suppliers, setSuppliers] = useState<Supplier[]>(seed.suppliers);
  const [recipes] = useState<Recipe[]>(seed.recipes);
  const [stocktakes, setStocktakes] = useState<StocktakeRecord[]>(seed.stocktakes);
  const [transfers, setTransfers] = useState<InventoryTransfer[]>(seed.transfers);

  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);
  const showToast = useCallback((message: string, type: 'success' | 'error' | 'info' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  }, []);

  const [activityFeed, setActivityFeed] = useState<{ id: string; text: string; time: string }[]>([]);
  const addActivity = useCallback((text: string) => {
    setActivityFeed(prev => [{ id: `act-${Date.now()}-${Math.random()}`, text, time: 'Just now' }, ...prev.slice(0, 19)]);
  }, []);

  const [lastMovementCount, setLastMovementCount] = useState(0);

  const computedItems: ComputedInventoryItem[] = useMemo(() => {
    return itemMaster.map(item => {
      const onHand = computeOnHand(movements, item.id);
      const batchQty = computeBatchQuantities(movements, item.id);
      const activeBatches = item.batches
        .map(b => ({ batch: b, qty: batchQty[b.id] ?? 0 }))
        .filter(x => x.qty > 0)
        .sort((a, b) => new Date(a.batch.expiryDate).getTime() - new Date(b.batch.expiryDate).getTime());

      const nearest = activeBatches[0];
      const nowMs = Date.now();
      const isExpired = nearest ? new Date(nearest.batch.expiryDate).getTime() < nowMs : false;

      let status: ComputedInventoryItem['status'] = 'Healthy';
      if (onHand === 0) status = 'Zero Stock';
      else if (isExpired) status = 'Expired';
      else if (onHand < item.min) status = 'Low Stock';

      const expiredQty = activeBatches
        .filter(x => new Date(x.batch.expiryDate).getTime() < nowMs)
        .reduce((sum, x) => sum + x.qty, 0);

      return {
        ...item,
        onHand,
        status,
        daysLeft: item.avgUsage > 0 ? Math.ceil(onHand / item.avgUsage) : 99,
        nearestBatchNumber: nearest?.batch.batchNumber,
        nearestExpiry: nearest?.batch.expiryDate,
        expiredQty,
      };
    });
  }, [itemMaster, movements]);

  const computeOnHandForVenue = useCallback(
    (itemId: string, venueId?: string) => computeOnHand(movements, itemId, venueId),
    [movements]
  );

  const appendMovements = useCallback((newMovements: StockMovement[]) => {
    setMovements(prev => newMovements.reduce((acc, m) => applyMovement(acc, m), prev));
    setLastMovementCount(newMovements.length);
  }, []);

  const undoLastMovements = useCallback(() => {
    if (lastMovementCount === 0) return;
    setMovements(prev => prev.slice(lastMovementCount));
    setLastMovementCount(0);
    showToast('Last action undone.', 'info');
  }, [lastMovementCount, showToast]);

  // ── Item master CRUD (no ledger involvement — these don't move stock) ────
  const addNewItem = useCallback((draft: Omit<InventoryItem, 'id' | 'batches'> & { openingQty?: number; venueId?: string }) => {
    const id = `inv-${Date.now()}`;
    const item: InventoryItem = {
      id,
      name: draft.name,
      sku: draft.sku,
      category: draft.category,
      supplier: draft.supplier,
      venueIds: draft.venueIds,
      min: draft.min,
      max: draft.max,
      unit: draft.unit,
      cost: draft.cost,
      avgUsage: draft.avgUsage,
      batches: [],
    };
    setItemMaster(prev => [item, ...prev]);

    if (draft.openingQty && draft.openingQty > 0 && draft.venueId) {
      const batchId = `b-new-${Date.now()}`;
      item.batches.push({
        id: batchId,
        batchNumber: `BAT-INIT-${Date.now().toString().slice(-4)}`,
        supplier: draft.supplier,
        receivedDate: TODAY(),
        expiryDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().substring(0, 10),
      });
      appendMovements([{
        id: `mov-${Date.now()}`,
        itemId: id,
        venueId: draft.venueId,
        type: 'RECEIVE_ADHOC',
        quantity: draft.openingQty,
        unit: draft.unit,
        value: draft.openingQty * draft.cost,
        batchId,
        user: 'Manager',
        timestamp: NOW(),
        notes: 'Opening balance on item creation',
      }]);
    }
    showToast(`Created item ${draft.name}`, 'success');
    addActivity(`Created new item ${draft.name} (${draft.sku})`);
  }, [appendMovements, showToast, addActivity]);

  const updateItem = useCallback((updated: InventoryItem) => {
    setItemMaster(prev => prev.map(i => i.id === updated.id ? updated : i));
    showToast(`Updated item ${updated.name}`, 'success');
  }, [showToast]);

  const deleteItem = useCallback((id: string) => {
    const item = itemMaster.find(i => i.id === id);
    if (!item) return;
    setItemMaster(prev => prev.filter(i => i.id !== id));
    showToast(`Deleted item ${item.name}`, 'info');
    addActivity(`Deleted inventory item ${item.name}`);
  }, [itemMaster, showToast, addActivity]);

  // ── Ledger mutators ───────────────────────────────────────────────────────
  const receiveStock = useCallback((params: {
    itemId: string; venueId: string; quantity: number; cost: number;
    batchNumber?: string; expiryDate?: string; reference?: string; poId?: string;
  }) => {
    const item = itemMaster.find(i => i.id === params.itemId);
    if (!item) return;
    const batchId = `b-rec-${Date.now()}`;
    const batchNumber = params.batchNumber || `BAT-${Date.now().toString().slice(-4)}`;
    setItemMaster(prev => prev.map(i => i.id === item.id
      ? { ...i, batches: [...i.batches, {
          id: batchId, batchNumber, supplier: item.supplier,
          receivedDate: TODAY(), expiryDate: params.expiryDate || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().substring(0, 10),
        }] }
      : i));
    appendMovements([{
      id: `mov-${Date.now()}`,
      itemId: params.itemId,
      venueId: params.venueId,
      type: params.poId ? 'RECEIVE_PO' : 'RECEIVE_ADHOC',
      quantity: params.quantity,
      unit: item.unit,
      value: params.quantity * params.cost,
      batchId,
      reference: params.reference,
      user: 'Manager',
      timestamp: NOW(),
    }]);
    if (params.poId) {
      setPurchaseOrders(prev => prev.map(po => po.id === params.poId
        ? { ...po, items: po.items.map(li => li.productId === params.itemId ? { ...li, receivedQty: li.receivedQty + params.quantity } : li) }
        : po));
    }
    showToast(`Received ${params.quantity} ${item.unit} of ${item.name}`, 'success');
    addActivity(`Received ${params.quantity} ${item.unit} of ${item.name}`);
  }, [itemMaster, appendMovements, showToast, addActivity]);

  const adjustStock = useCallback((itemId: string, venueId: string, qtyDelta: number, reason: AdjustmentReason, notes: string) => {
    const item = itemMaster.find(i => i.id === itemId);
    if (!item) return;
    const currentOnHand = computeOnHand(movements, itemId, venueId);
    if (currentOnHand + qtyDelta < 0) {
      showToast('Adjustment cannot cause stock to fall below zero.', 'error');
      return;
    }
    appendMovements([{
      id: `mov-${Date.now()}`,
      itemId, venueId, type: 'STOCK_ADJUSTMENT',
      quantity: qtyDelta, unit: item.unit, value: qtyDelta * item.cost,
      reason, notes, user: 'Manager', timestamp: NOW(),
    }]);
    showToast(`Adjusted ${item.name} by ${qtyDelta >= 0 ? '+' : ''}${qtyDelta}`, 'success');
    addActivity(`Adjusted ${item.name} ${qtyDelta >= 0 ? '+' : ''}${qtyDelta} (${reason})`);
  }, [itemMaster, movements, appendMovements, showToast, addActivity]);

  const recordWaste = useCallback((itemId: string, venueId: string, quantity: number, reason: WasteReason, notes: string) => {
    const item = itemMaster.find(i => i.id === itemId);
    if (!item) return;
    const currentOnHand = computeOnHand(movements, itemId, venueId);
    if (currentOnHand < quantity) {
      showToast('Waste quantity exceeds current stock level.', 'error');
      return;
    }
    appendMovements([{
      id: `mov-${Date.now()}`,
      itemId, venueId, type: 'SCRAP',
      quantity: -quantity, unit: item.unit, value: -quantity * item.cost,
      reason, notes, user: 'Manager', timestamp: NOW(),
    }]);
    showToast(`Logged ${quantity} ${item.unit} waste for ${item.name}`, 'success');
    addActivity(`Wasted ${quantity} ${item.unit} of ${item.name} (${reason})`);
  }, [itemMaster, movements, appendMovements, showToast, addActivity]);

  const markExpired = useCallback((itemId: string, venueId: string, batchId: string, quantity: number, actionType: ExpiryActionType, notes: string) => {
    const item = itemMaster.find(i => i.id === itemId);
    if (!item) return;
    const currentOnHand = computeOnHand(movements, itemId, venueId);
    const qty = Math.min(quantity, currentOnHand);
    if (qty <= 0) return;
    const movType = actionType === 'Return to Supplier' ? 'RETURN' : 'EXPIRED';
    appendMovements([{
      id: `mov-${Date.now()}`,
      itemId, venueId, type: movType,
      quantity: -qty, unit: item.unit, value: -qty * item.cost,
      batchId: batchId || undefined,
      reason: `Expiry Action: ${actionType}`, notes, user: 'Manager', timestamp: NOW(),
    }]);
    showToast(`Processed expiry: ${actionType} for ${qty} ${item.unit}`, 'success');
    addActivity(`Expired batch action: ${actionType} for ${item.name}`);
  }, [itemMaster, movements, appendMovements, showToast, addActivity]);

  const createPurchaseOrder = useCallback((supplierName: string, itemsList: { productId: string; quantity: number; cost: number }[], notes?: string) => {
    const poItems: PurchaseOrderItem[] = itemsList.map(it => {
      const match = itemMaster.find(i => i.id === it.productId);
      return { productId: it.productId, name: match ? match.name : 'Unknown Item', expectedQty: it.quantity, receivedQty: 0, rejectedQty: 0, damagedQty: 0, unit: match ? match.unit : 'units', cost: it.cost };
    });
    const total = poItems.reduce((sum, i) => sum + i.expectedQty * i.cost, 0);
    const orderNumber = `PO-2026-${String(purchaseOrders.length + 1).padStart(3, '0')}`;
    setPurchaseOrders(prev => [{
      id: `po-${Date.now()}`, orderNumber, supplier: supplierName,
      itemsCount: poItems.length, totalAmount: total, status: 'Sent',
      orderDate: TODAY(), deliveryDate: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().substring(0, 10),
      items: poItems, deliveryNotes: notes,
    }, ...prev]);
    showToast(`Created Purchase Order ${orderNumber}`, 'success');
    addActivity(`Created Purchase Order ${orderNumber} for ${supplierName}`);
  }, [itemMaster, purchaseOrders.length, showToast, addActivity]);

  const finalizeStocktake = useCallback((physicalCounts: Record<string, number>, venueId: string, area: string, category: string, counterName: string) => {
    const newMovements: StockMovement[] = [];
    let discrepancies = 0;
    let totalAudited = 0;
    let netVarianceCost = 0;

    Object.entries(physicalCounts).forEach(([itemId, physicalQty]) => {
      const item = itemMaster.find(i => i.id === itemId);
      if (!item) return;
      totalAudited++;
      const expected = computeOnHand(movements, itemId, venueId);
      const diff = physicalQty - expected;
      if (diff === 0) return;
      discrepancies++;
      netVarianceCost += diff * item.cost;
      newMovements.push({
        id: `mov-${Date.now()}-${Math.random()}`,
        itemId, venueId, type: 'STOCKTAKE',
        quantity: diff, unit: item.unit, value: diff * item.cost,
        reason: 'Physical Count Discrepancy',
        notes: `Stocktake audit in ${area}`,
        user: counterName || 'Manager', timestamp: NOW(),
      });
    });

    if (newMovements.length > 0) appendMovements(newMovements);

    const accuracy = totalAudited > 0 ? Number(((totalAudited - discrepancies) / totalAudited * 100).toFixed(1)) : 100;
    setStocktakes(prev => [{
      id: `stk-${Date.now()}`, date: TODAY(), itemsAudited: totalAudited,
      discrepancyCount: discrepancies, accuracyPercent: accuracy, status: 'Completed',
      varianceCost: netVarianceCost, area, category,
    }, ...prev]);
    showToast(`Stocktake completed in ${area}. Accuracy: ${accuracy}%`, 'success');
    addActivity(`Completed Stocktake in ${area} by ${counterName || 'Manager'} (${discrepancies} variances)`);
  }, [itemMaster, movements, appendMovements, showToast, addActivity]);

  const togglePreferredSupplier = useCallback((supplierId: string) => {
    setSuppliers(prev => prev.map(s => s.id === supplierId ? { ...s, preferred: !s.preferred } : s));
  }, []);

  return {
    items: computedItems,
    movements,
    purchaseOrders,
    suppliers,
    recipes,
    stocktakes,
    transfers,
    activityFeed,
    toast,
    setToast,
    computeOnHandForVenue,
    addNewItem,
    updateItem,
    deleteItem,
    receiveStock,
    adjustStock,
    recordWaste,
    markExpired,
    createPurchaseOrder,
    finalizeStocktake,
    togglePreferredSupplier,
    undoLastMovements,
    canUndo: lastMovementCount > 0,
    showToast,
  };
}
```

- [ ] **Step 2: Verify**

Run: `cd admin-frontend && npx tsc --noEmit 2>&1 | grep "hooks/useInventoryLedger"` — expect no output.

- [ ] **Step 3: Commit**

```bash
git add admin-frontend/src/pages/inventory/hooks/useInventoryLedger.ts
git commit -m "inventory: add useInventoryLedger hook (ledger-backed state, replaces mutable onHand)"
```

---

### Task 5: Extract `components/Icon.tsx`

**Files:**
- Create: `admin-frontend/src/pages/inventory/components/Icon.tsx`
- Modify: `admin-frontend/src/pages/inventory/InventoryPage.tsx:1-158` (remove the inline `Icon` function and its `IconProps` interface; add an import)

**Interfaces:**
- Produces: `Icon` component with `{ name: string; className?: string; size?: number }` props — consumed by every dialog file (Tasks 6-9) and the extracted table (Task 10).

- [ ] **Step 1: Move the Icon component verbatim**

Cut lines 1-158 of `InventoryPage.tsx` (the `IconProps` interface and `Icon` function, everything up to but not including `const categories = [...]`) into the new file, changing only the export style:

```ts
// admin-frontend/src/pages/inventory/components/Icon.tsx
import React from 'react';

interface IconProps {
  name: string;
  className?: string;
  size?: number;
}

export function Icon({ name, className = 'w-4 h-4', size = 16 }: IconProps) {
  // ... verbatim body from InventoryPage.tsx:14-157 (all 19 `case` branches:
  // plus, receive, order, stocktake, export, search, filter, arrow-up, arrow-down,
  // clock, alert, trash, truck, assistant, check, cross, chevron-down, cart) ...
}
```

- [ ] **Step 2: Update `InventoryPage.tsx`**

Replace the removed block with:

```tsx
import { Icon } from './components/Icon';
```

- [ ] **Step 3: Verify**

Run: `cd admin-frontend && npx tsc --noEmit 2>&1 | grep "components/Icon"` — expect no output.

- [ ] **Step 4: Commit**

```bash
git add admin-frontend/src/pages/inventory/components/Icon.tsx admin-frontend/src/pages/inventory/InventoryPage.tsx
git commit -m "inventory: extract Icon component"
```

---

### Task 6: Item CRUD dialogs (NewItemDialog, EditItemDialog, DeleteConfirmDialog)

**Files:**
- Create: `admin-frontend/src/pages/inventory/dialogs/NewItemDialog.tsx`
- Create: `admin-frontend/src/pages/inventory/dialogs/EditItemDialog.tsx`
- Create: `admin-frontend/src/pages/inventory/dialogs/DeleteConfirmDialog.tsx`

**Interfaces:**
- Consumes: `Icon` (Task 5), `InventoryItem`/`Venue`/`VENUES` (Task 1)
- Produces: three dialog components, wired into `InventoryPage.tsx` in Task 11. None call ledger mutators directly except through `onSubmit`/`onConfirm` props the parent supplies (`addNewItem`/`updateItem`/`deleteItem` from Task 4's hook) — keeps dialogs presentation-only and testable in isolation.

These three ports the existing `InventoryPage.tsx:2506-2658` (New Item), `:2661-2809` (Edit Item), `:2998-3031` (Delete Confirm) modals, adapted from local `useState`/inline handlers to props. Behavior, copy, and markup are unchanged — only `venue` (single select of 'All Venues'/'Main Kitchen'/'Bar Lounge', which don't match the real venue IDs used elsewhere in the app) becomes a multi-select over `VENUES` (`venueIds: string[]`) plus an "Opening Qty" + "Opening Venue" pair for `NewItemDialog` (the old dialog had an `onHand` field directly on the draft; on-hand is no longer settable directly, so entering an opening quantity now creates a `RECEIVE_ADHOC` movement via the hook, matching how `addNewItem` in Task 4 handles `openingQty`/`venueId`).

- [ ] **Step 1: Write `NewItemDialog.tsx`**

```tsx
// admin-frontend/src/pages/inventory/dialogs/NewItemDialog.tsx
import React, { useState } from 'react';
import { Icon } from '../components/Icon';
import { VENUES } from '../types/venue';
import { InventoryItem } from '../types';

const categories = ['Raw Meat', 'Oils & Fats', 'Bakery', 'Dairy', 'Vegetables', 'Dry Goods', 'Beverages', 'Packaging'];

export interface NewItemDraft {
  name: string; sku: string; category: string; supplier: string;
  venueIds: string[]; min: number; max: number; unit: string; cost: number;
  avgUsage: number; openingQty: number; openingVenueId: string;
}

interface NewItemDialogProps {
  suppliers: { id: string; name: string }[];
  onSubmit: (draft: NewItemDraft) => void;
  onClose: () => void;
}

const DEFAULT_DRAFT: NewItemDraft = {
  name: '', sku: '', category: 'Raw Meat', supplier: 'Fresh Foods Ltd',
  venueIds: ['verdura'], min: 10, max: 50, unit: 'kg', cost: 10.0,
  avgUsage: 1, openingQty: 0, openingVenueId: 'verdura',
};

export function NewItemDialog({ suppliers, onSubmit, onClose }: NewItemDialogProps) {
  const [draft, setDraft] = useState<NewItemDraft>(DEFAULT_DRAFT);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(draft);
  };

  const toggleVenue = (venueId: string) => {
    setDraft(d => ({
      ...d,
      venueIds: d.venueIds.includes(venueId) ? d.venueIds.filter(v => v !== venueId) : [...d.venueIds, venueId],
    }));
  };

  return (
    <div className="fixed inset-0 bg-gray-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fadeIn">
      <div className="bg-white border border-gray-200 rounded-xl shadow-xl max-w-md w-full overflow-hidden animate-slideUp">
        <div className="p-4 border-b border-gray-200 flex justify-between items-center bg-gray-50/50">
          <h3 className="text-sm font-black text-gray-900 uppercase tracking-wide">New Inventory Item</h3>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-200 text-gray-400 hover:text-gray-600 transition-colors">
            <Icon name="cross" size={16} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 flex flex-col gap-3 text-xs">
          <div className="flex flex-col gap-1">
            <label className="font-bold text-gray-400 uppercase tracking-wider">Item Name</label>
            <input type="text" required value={draft.name} onChange={e => setDraft(d => ({ ...d, name: e.target.value }))}
              placeholder="e.g. Fresh Cilantro" className="w-full h-8 px-2.5 border border-gray-300 rounded focus:outline-none focus:border-emerald-500" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <label className="font-bold text-gray-400 uppercase tracking-wider">SKU</label>
              <input type="text" required value={draft.sku} onChange={e => setDraft(d => ({ ...d, sku: e.target.value.toUpperCase() }))}
                placeholder="e.g. VEG-201" className="w-full h-8 px-2.5 border border-gray-300 rounded focus:outline-none focus:border-emerald-500 uppercase font-mono" />
            </div>
            <div className="flex flex-col gap-1">
              <label className="font-bold text-gray-400 uppercase tracking-wider">Unit</label>
              <input type="text" required value={draft.unit} onChange={e => setDraft(d => ({ ...d, unit: e.target.value }))}
                placeholder="e.g. kg, bottles, cases" className="w-full h-8 px-2.5 border border-gray-300 rounded focus:outline-none focus:border-emerald-500" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <label className="font-bold text-gray-400 uppercase tracking-wider">Category</label>
              <select value={draft.category} onChange={e => setDraft(d => ({ ...d, category: e.target.value }))}
                className="w-full h-8 px-2.5 border border-gray-300 rounded focus:outline-none focus:border-emerald-500 cursor-pointer">
                {categories.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="font-bold text-gray-400 uppercase tracking-wider">Supplier</label>
              <select value={draft.supplier} onChange={e => setDraft(d => ({ ...d, supplier: e.target.value }))}
                className="w-full h-8 px-2.5 border border-gray-300 rounded focus:outline-none focus:border-emerald-500 cursor-pointer">
                {suppliers.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
              </select>
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <label className="font-bold text-gray-400 uppercase tracking-wider">Venues Carrying This Item</label>
            <div className="flex gap-2 flex-wrap">
              {VENUES.map(v => (
                <button key={v.id} type="button" onClick={() => toggleVenue(v.id)}
                  className={`px-2.5 py-1 rounded border text-[11px] font-semibold transition-colors ${
                    draft.venueIds.includes(v.id) ? 'bg-emerald-600 border-emerald-600 text-white' : 'border-gray-300 text-gray-600 hover:bg-gray-50'
                  }`}>
                  {v.name}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="flex flex-col gap-1">
              <label className="font-bold text-gray-400 uppercase tracking-wider">Min Level</label>
              <input type="number" min={0} value={draft.min} onChange={e => setDraft(d => ({ ...d, min: Number(e.target.value) }))}
                className="w-full h-8 px-2.5 border border-gray-300 rounded focus:outline-none focus:border-emerald-500" />
            </div>
            <div className="flex flex-col gap-1">
              <label className="font-bold text-gray-400 uppercase tracking-wider">Max Level</label>
              <input type="number" min={0} value={draft.max} onChange={e => setDraft(d => ({ ...d, max: Number(e.target.value) }))}
                className="w-full h-8 px-2.5 border border-gray-300 rounded focus:outline-none focus:border-emerald-500" />
            </div>
            <div className="flex flex-col gap-1">
              <label className="font-bold text-gray-400 uppercase tracking-wider">Unit Cost ($)</label>
              <input type="number" step="0.01" min={0} value={draft.cost} onChange={e => setDraft(d => ({ ...d, cost: Number(e.target.value) }))}
                className="w-full h-8 px-2.5 border border-gray-300 rounded focus:outline-none focus:border-emerald-500" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 pt-2 border-t border-gray-100">
            <div className="flex flex-col gap-1">
              <label className="font-bold text-gray-400 uppercase tracking-wider">Opening Qty (optional)</label>
              <input type="number" min={0} value={draft.openingQty} onChange={e => setDraft(d => ({ ...d, openingQty: Number(e.target.value) }))}
                className="w-full h-8 px-2.5 border border-gray-300 rounded focus:outline-none focus:border-emerald-500" />
            </div>
            <div className="flex flex-col gap-1">
              <label className="font-bold text-gray-400 uppercase tracking-wider">Opening Venue</label>
              <select value={draft.openingVenueId} onChange={e => setDraft(d => ({ ...d, openingVenueId: e.target.value }))}
                className="w-full h-8 px-2.5 border border-gray-300 rounded focus:outline-none focus:border-emerald-500 cursor-pointer">
                {VENUES.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
              </select>
            </div>
          </div>

          <div className="flex gap-2 justify-end border-t border-gray-100 pt-3 mt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 border border-gray-300 rounded text-gray-600 font-semibold hover:bg-gray-50 transition-colors">Cancel</button>
            <button type="submit" className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded font-bold transition-colors">Add Item</button>
          </div>
        </form>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Write `EditItemDialog.tsx`**

Same structure as `NewItemDialog`, but takes `item: InventoryItem` (no `onHand`/opening-qty fields — on-hand isn't editable here, matching the ledger rule) and an `onSubmit: (updated: InventoryItem) => void` prop. Port `InventoryPage.tsx:2661-2809` field-for-field (Name, SKU, Unit, Category, Supplier, Min, Max, Cost — same inputs as `NewItemDialog` minus On Hand), replacing the single "Venue" select with the same `VENUES` multi-select toggle pattern as Step 1, bound to `item.venueIds`.

- [ ] **Step 3: Write `DeleteConfirmDialog.tsx`**

Port `InventoryPage.tsx:2998-3031` verbatim as a props-driven component:

```tsx
// admin-frontend/src/pages/inventory/dialogs/DeleteConfirmDialog.tsx
import React from 'react';
import { Icon } from '../components/Icon';

interface DeleteConfirmDialogProps {
  itemName: string;
  onConfirm: () => void;
  onClose: () => void;
}

export function DeleteConfirmDialog({ itemName, onConfirm, onClose }: DeleteConfirmDialogProps) {
  return (
    <div className="fixed inset-0 bg-gray-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fadeIn">
      <div className="bg-white border border-gray-200 rounded-xl shadow-xl max-w-sm w-full overflow-hidden animate-slideUp">
        <div className="p-4 flex gap-3.5 items-start">
          <div className="w-10 h-10 rounded-full bg-red-50 text-red-600 flex items-center justify-center shrink-0">
            <Icon name="trash" size={20} />
          </div>
          <div className="flex flex-col gap-1.5">
            <h3 className="text-sm font-black text-gray-900 uppercase tracking-wide">Delete Item?</h3>
            <p className="text-xs text-gray-500 leading-normal">
              Are you sure you want to delete <b className="text-gray-800">"{itemName}"</b>? This will remove it from the active inventory database permanently. This action cannot be undone.
            </p>
          </div>
        </div>
        <div className="px-4 py-3 bg-gray-50 border-t border-gray-100 flex gap-2 justify-end text-xs">
          <button type="button" onClick={onClose} className="px-3.5 py-1.5 border border-gray-300 rounded text-gray-600 font-semibold hover:bg-gray-50 transition-colors">Keep Item</button>
          <button onClick={onConfirm} className="px-3.5 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded font-bold transition-colors">Delete permanently</button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Verify and commit**

Run: `cd admin-frontend && npx tsc --noEmit 2>&1 | grep "dialogs/"` — expect no output (these three files aren't imported anywhere yet, so they type-check in isolation).

```bash
git add admin-frontend/src/pages/inventory/dialogs/NewItemDialog.tsx admin-frontend/src/pages/inventory/dialogs/EditItemDialog.tsx admin-frontend/src/pages/inventory/dialogs/DeleteConfirmDialog.tsx
git commit -m "inventory: extract item CRUD dialogs (New/Edit/Delete), multi-venue aware"
```

---

### Task 7: Stock-movement dialogs (ReceiveStockDialog, AdjustmentDialog, WasteDialog, ExpiryDialog)

**Files:**
- Create: `admin-frontend/src/pages/inventory/dialogs/ReceiveStockDialog.tsx`
- Create: `admin-frontend/src/pages/inventory/dialogs/AdjustmentDialog.tsx`
- Create: `admin-frontend/src/pages/inventory/dialogs/WasteDialog.tsx`
- Create: `admin-frontend/src/pages/inventory/dialogs/ExpiryDialog.tsx`

**Interfaces:**
- Consumes: `Icon` (Task 5), `VENUES` (Task 1), `AdjustmentReason`/`WasteReason`/`ExpiryActionType` (Task 1), `ComputedInventoryItem` (Task 1)
- Produces: four dialogs whose `onSubmit` props map 1:1 to Task 4's hook mutators (`receiveStock`, `adjustStock`, `recordWaste`, `markExpired`).

- [ ] **Step 1: Write `ReceiveStockDialog.tsx`**

Fixes the pre-existing `receiveStockDraft`/`receiveGoodsDraft` naming bug (`InventoryPage.tsx:2830-2876`, confirmed via `tsc --noEmit` TS2304/TS2552 errors) by giving the dialog its own correctly-named internal state. Adds a required Venue select (the old dialog had no venue field at all, since the baseline had no real multi-venue model).

```tsx
// admin-frontend/src/pages/inventory/dialogs/ReceiveStockDialog.tsx
import React, { useState } from 'react';
import { Icon } from '../components/Icon';
import { VENUES } from '../types/venue';
import { ComputedInventoryItem } from '../types';

interface ReceiveStockDraft {
  itemId: string; venueId: string; quantity: number; cost: number; batchNumber: string; expiryDate: string;
}

interface ReceiveStockDialogProps {
  items: ComputedInventoryItem[];
  initialItemId?: string;
  onSubmit: (draft: ReceiveStockDraft) => void;
  onClose: () => void;
}

export function ReceiveStockDialog({ items, initialItemId, onSubmit, onClose }: ReceiveStockDialogProps) {
  const initial = items.find(i => i.id === initialItemId);
  const [draft, setDraft] = useState<ReceiveStockDraft>({
    itemId: initialItemId || '', venueId: initial?.venueIds[0] || VENUES[0].id,
    quantity: 1, cost: initial?.cost || 0, batchNumber: '', expiryDate: '',
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft.itemId || draft.quantity <= 0) return;
    onSubmit(draft);
  };

  return (
    <div className="fixed inset-0 bg-gray-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fadeIn">
      <div className="bg-white border border-gray-200 rounded-xl shadow-xl max-w-md w-full overflow-hidden animate-slideUp">
        <div className="p-4 border-b border-gray-200 flex justify-between items-center bg-gray-50/50">
          <h3 className="text-sm font-black text-gray-900 uppercase tracking-wide">Receive Stock Shipment</h3>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-200 text-gray-400 hover:text-gray-600 transition-colors"><Icon name="cross" size={16} /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-4 flex flex-col gap-3 text-xs">
          <div className="flex flex-col gap-1">
            <label className="font-bold text-gray-400 uppercase tracking-wider">Select Item</label>
            <select required value={draft.itemId} onChange={e => {
                const matched = items.find(i => i.id === e.target.value);
                setDraft(d => ({ ...d, itemId: e.target.value, cost: matched ? matched.cost : 0, venueId: matched?.venueIds[0] || d.venueId }));
              }}
              className="w-full h-8 px-2.5 border border-gray-300 rounded focus:outline-none focus:border-emerald-500 cursor-pointer">
              <option value="" disabled>-- Select Inventory Item --</option>
              {items.map(item => <option key={item.id} value={item.id}>{item.name} ({item.sku})</option>)}
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label className="font-bold text-gray-400 uppercase tracking-wider">Venue</label>
            <select required value={draft.venueId} onChange={e => setDraft(d => ({ ...d, venueId: e.target.value }))}
              className="w-full h-8 px-2.5 border border-gray-300 rounded focus:outline-none focus:border-emerald-500 cursor-pointer">
              {VENUES.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <label className="font-bold text-gray-400 uppercase tracking-wider">Receive Qty</label>
              <input type="number" required min={1} value={draft.quantity || ''} onChange={e => setDraft(d => ({ ...d, quantity: Number(e.target.value) }))}
                placeholder="e.g. 50" className="w-full h-8 px-2.5 border border-gray-300 rounded focus:outline-none focus:border-emerald-500" />
            </div>
            <div className="flex flex-col gap-1">
              <label className="font-bold text-gray-400 uppercase tracking-wider">Actual Unit Cost ($)</label>
              <input type="number" step="0.01" required min={0} value={draft.cost || ''} onChange={e => setDraft(d => ({ ...d, cost: Number(e.target.value) }))}
                className="w-full h-8 px-2.5 border border-gray-300 rounded focus:outline-none focus:border-emerald-500" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <label className="font-bold text-gray-400 uppercase tracking-wider">Batch Number (optional)</label>
              <input type="text" value={draft.batchNumber} onChange={e => setDraft(d => ({ ...d, batchNumber: e.target.value }))}
                className="w-full h-8 px-2.5 border border-gray-300 rounded focus:outline-none focus:border-emerald-500" />
            </div>
            <div className="flex flex-col gap-1">
              <label className="font-bold text-gray-400 uppercase tracking-wider">Expiry Date</label>
              <input type="date" value={draft.expiryDate} onChange={e => setDraft(d => ({ ...d, expiryDate: e.target.value }))}
                className="w-full h-8 px-2.5 border border-gray-300 rounded focus:outline-none focus:border-emerald-500" />
            </div>
          </div>

          <div className="flex gap-2 justify-end border-t border-gray-100 pt-3 mt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 border border-gray-300 rounded text-gray-600 font-semibold hover:bg-gray-50 transition-colors">Cancel</button>
            <button type="submit" className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded font-bold transition-colors">Record Receipt</button>
          </div>
        </form>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Write `AdjustmentDialog.tsx`**

New file (the trigger at `InventoryPage.tsx:1844-1859` has existed with no dialog behind it). Follows the same visual pattern as Step 1, form fields: read-only item name (from `initialItemId`), Venue select, signed Quantity Delta input, `AdjustmentReason` select (`'Physical Count' | 'Found Stock' | 'Lost Stock' | 'Supplier Error' | 'Manual Correction' | 'Damage' | 'Theft' | 'Unknown' | 'Other'`), Notes textarea. `onSubmit: (itemId: string, venueId: string, qtyDelta: number, reason: AdjustmentReason, notes: string) => void`.

- [ ] **Step 3: Write `WasteDialog.tsx`**

New file (trigger at `InventoryPage.tsx:1860-1875`). Same pattern: item name, Venue select, Quantity (positive, capped client-side at current on-hand for that venue — pass `currentOnHand: number` as a prop so the input can show "Max: N" and the dialog can disable submit past it, mirroring the hook's own guard), `WasteReason` select (`'Prep Waste' | 'Cooking Waste' | 'Expired' | 'Spoiled' | 'Damaged' | 'Kitchen Error' | 'Customer Return' | 'Overproduction' | 'Accidental Waste' | 'Staff Meal'`), Notes. `onSubmit: (itemId: string, venueId: string, quantity: number, reason: WasteReason, notes: string) => void`.

- [ ] **Step 4: Write `ExpiryDialog.tsx`**

New file (trigger at `InventoryPage.tsx:1879-1894`, `expiryDraft`/`handleExpirySubmit` in the current handlers section). Fields: item name, Venue select, Batch select (populated from the item's `batches` where `computeBatchQuantities` > 0 for that venue — pass `batches: { id: string; batchNumber: string; qty: number }[]` as a prop), Quantity (defaults to the selected batch's qty), `ExpiryActionType` select (`'Dispose' | 'Return to Supplier' | 'Discount' | 'Donate'`), Notes. `onSubmit: (itemId: string, venueId: string, batchId: string, quantity: number, actionType: ExpiryActionType, notes: string) => void`.

- [ ] **Step 5: Verify and commit**

Run: `cd admin-frontend && npx tsc --noEmit 2>&1 | grep "dialogs/"` — expect no new errors from these four files.

```bash
git add admin-frontend/src/pages/inventory/dialogs/ReceiveStockDialog.tsx admin-frontend/src/pages/inventory/dialogs/AdjustmentDialog.tsx admin-frontend/src/pages/inventory/dialogs/WasteDialog.tsx admin-frontend/src/pages/inventory/dialogs/ExpiryDialog.tsx
git commit -m "inventory: add stock-movement dialogs (Receive/Adjust/Waste/Expiry), fix receiveStockDraft bug"
```

---

### Task 8: PurchaseOrderDialog + StocktakeDialog

**Files:**
- Create: `admin-frontend/src/pages/inventory/dialogs/PurchaseOrderDialog.tsx`
- Create: `admin-frontend/src/pages/inventory/dialogs/StocktakeDialog.tsx`

**Interfaces:**
- Consumes: `Icon` (Task 5), `ComputedInventoryItem`/`Supplier` (Task 1)
- Produces: two dialogs consumed in Task 11.

- [ ] **Step 1: Write `PurchaseOrderDialog.tsx`**

Ports `InventoryPage.tsx:2901-2995`. Fixes the pre-existing `tsc` error at `InventoryPage.tsx:769` (`Property 'items' is missing in type ... required in type 'PurchaseOrder'`) by having `onSubmit` pass the full line-item list (`{ productId, quantity, cost }[]`) the hook's `createPurchaseOrder` (Task 4) already expects — same UI and prefill-from-low-stock behavior as the original (`items.filter(i => i.supplier === supName && i.onHand < i.min)`), just reading `onHand` off `ComputedInventoryItem` instead of the old stored field (name unchanged, so the JSX body is otherwise unaffected).

```tsx
// admin-frontend/src/pages/inventory/dialogs/PurchaseOrderDialog.tsx
import React, { useState } from 'react';
import { Icon } from '../components/Icon';
import { ComputedInventoryItem, Supplier } from '../types';

interface POLineDraft { productId: string; name: string; quantity: number; unit: string; estimatedCost: number; }

interface PurchaseOrderDialogProps {
  items: ComputedInventoryItem[];
  suppliers: Supplier[];
  onSubmit: (supplierName: string, itemsList: { productId: string; quantity: number; cost: number }[], notes?: string) => void;
  onClose: () => void;
}

export function PurchaseOrderDialog({ items, suppliers, onSubmit, onClose }: PurchaseOrderDialogProps) {
  const [supplier, setSupplier] = useState(suppliers[0]?.name || '');
  const [lines, setLines] = useState<POLineDraft[]>(() => {
    const low = items.filter(i => i.supplier === (suppliers[0]?.name || '') && i.onHand < i.min);
    return low.length > 0
      ? low.map(i => ({ productId: i.id, name: i.name, quantity: i.max - i.onHand, unit: i.unit, estimatedCost: i.cost }))
      : [];
  });

  const handleSupplierChange = (supName: string) => {
    setSupplier(supName);
    const low = items.filter(i => i.supplier === supName && i.onHand < i.min);
    setLines(low.map(i => ({ productId: i.id, name: i.name, quantity: i.max - i.onHand, unit: i.unit, estimatedCost: i.cost })));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (lines.length === 0) return;
    onSubmit(supplier, lines.map(l => ({ productId: l.productId, quantity: l.quantity, cost: l.estimatedCost })));
  };

  const total = lines.reduce((sum, l) => sum + l.quantity * l.estimatedCost, 0);

  return (
    <div className="fixed inset-0 bg-gray-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fadeIn">
      <div className="bg-white border border-gray-200 rounded-xl shadow-xl max-w-md w-full overflow-hidden animate-slideUp">
        <div className="p-4 border-b border-gray-200 flex justify-between items-center bg-gray-50/50">
          <h3 className="text-sm font-black text-gray-900 uppercase tracking-wide">Create Purchase Order</h3>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-200 text-gray-400 hover:text-gray-600 transition-colors"><Icon name="cross" size={16} /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-4 flex flex-col gap-3 text-xs">
          <div className="flex flex-col gap-1">
            <label className="font-bold text-gray-400 uppercase tracking-wider">Select Supplier</label>
            <select value={supplier} onChange={e => handleSupplierChange(e.target.value)}
              className="w-full h-8 px-2.5 border border-gray-300 rounded focus:outline-none focus:border-emerald-500 cursor-pointer">
              {suppliers.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
            </select>
          </div>

          <div className="flex flex-col gap-2.5 mt-2">
            <span className="font-bold text-gray-400 uppercase tracking-wider">Items in Order</span>
            {lines.length === 0 ? (
              <p className="text-gray-400 italic">No items from this supplier are currently below minimum stock.</p>
            ) : (
              <div className="max-h-[160px] overflow-y-auto border border-gray-200 rounded divide-y divide-gray-100">
                {lines.map((it, idx) => (
                  <div key={it.productId} className="p-2 bg-gray-50/50 flex justify-between items-center gap-2">
                    <div className="flex flex-col min-w-0">
                      <span className="font-bold text-gray-900 truncate">{it.name}</span>
                      <span className="text-[10px] text-gray-400 font-medium">Est. Unit Cost: ${it.estimatedCost.toFixed(2)}</span>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <input type="number" min={1} value={it.quantity} onChange={e => {
                          const val = Number(e.target.value);
                          setLines(prev => prev.map((l, i) => i === idx ? { ...l, quantity: val } : l));
                        }} className="w-14 h-7 text-right border border-gray-300 rounded px-1" />
                      <span className="text-[10px] text-gray-500 font-semibold">{it.unit}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="p-3 bg-emerald-50 border border-emerald-100 rounded flex justify-between items-baseline font-semibold text-emerald-800">
            <span>Est. Order Total</span>
            <span className="text-sm font-black">${total.toFixed(2)}</span>
          </div>

          <div className="flex gap-2 justify-end border-t border-gray-100 pt-3 mt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 border border-gray-300 rounded text-gray-600 font-semibold hover:bg-gray-50 transition-colors">Cancel</button>
            <button type="submit" disabled={lines.length === 0} className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded font-bold transition-colors">Send Order</button>
          </div>
        </form>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Write `StocktakeDialog.tsx`**

Ports `InventoryPage.tsx:3034-3107`, but fixes the pre-existing fake submit (the original hardcoded `itemsAudited: 128, discrepancyCount: 0, accuracyPercent: 100.0` regardless of what was typed, and the physical-count `<input>` used `defaultValue` with no `onChange`, so nothing typed was ever captured). This dialog wires real controlled inputs and passes the actual counts to `onSubmit`, matching what the spec's Design section commits Foundation to ("StocktakeDialog → appends STOCKTAKE movements for each counted item's variance").

```tsx
// admin-frontend/src/pages/inventory/dialogs/StocktakeDialog.tsx
import React, { useState } from 'react';
import { Icon } from '../components/Icon';
import { VENUES } from '../types/venue';
import { ComputedInventoryItem } from '../types';

interface StocktakeDialogProps {
  items: ComputedInventoryItem[];
  onSubmit: (physicalCounts: Record<string, number>, venueId: string, area: string, category: string, counterName: string) => void;
  onClose: () => void;
}

export function StocktakeDialog({ items, onSubmit, onClose }: StocktakeDialogProps) {
  const [venueId, setVenueId] = useState(VENUES[0].id);
  const [area, setArea] = useState('Main Kitchen');
  const [counterName, setCounterName] = useState('');
  const [counts, setCounts] = useState<Record<string, number>>(() =>
    Object.fromEntries(items.slice(0, 5).map(i => [i.id, i.onHand]))
  );

  const handleSubmit = () => {
    onSubmit(counts, venueId, area, 'All', counterName || 'Manager');
  };

  return (
    <div className="fixed inset-0 bg-gray-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fadeIn">
      <div className="bg-white border border-gray-200 rounded-xl shadow-xl max-w-lg w-full overflow-hidden animate-slideUp">
        <div className="p-4 border-b border-gray-200 flex justify-between items-center bg-gray-50/50">
          <h3 className="text-sm font-black text-gray-900 uppercase tracking-wide">Record Stocktake Audits</h3>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-200 text-gray-400 hover:text-gray-600 transition-colors"><Icon name="cross" size={16} /></button>
        </div>
        <div className="p-4 flex flex-col gap-3.5 text-xs">
          <span className="font-semibold text-gray-500 leading-normal">Compare actual physical counts with system counts to identify variances.</span>

          <div className="grid grid-cols-3 gap-3">
            <div className="flex flex-col gap-1">
              <label className="font-bold text-gray-400 uppercase tracking-wider">Venue</label>
              <select value={venueId} onChange={e => setVenueId(e.target.value)} className="w-full h-8 px-2.5 border border-gray-300 rounded focus:outline-none focus:border-emerald-500 cursor-pointer">
                {VENUES.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="font-bold text-gray-400 uppercase tracking-wider">Area</label>
              <input type="text" value={area} onChange={e => setArea(e.target.value)} className="w-full h-8 px-2.5 border border-gray-300 rounded focus:outline-none focus:border-emerald-500" />
            </div>
            <div className="flex flex-col gap-1">
              <label className="font-bold text-gray-400 uppercase tracking-wider">Counted By</label>
              <input type="text" value={counterName} onChange={e => setCounterName(e.target.value)} placeholder="Your name" className="w-full h-8 px-2.5 border border-gray-300 rounded focus:outline-none focus:border-emerald-500" />
            </div>
          </div>

          <div className="max-h-[220px] overflow-y-auto border border-gray-200 rounded divide-y divide-gray-100">
            {items.slice(0, 5).map(item => (
              <div key={item.id} className="p-3 bg-gray-50/50 flex justify-between items-center gap-4">
                <div className="flex flex-col min-w-0">
                  <span className="font-bold text-gray-900 truncate">{item.name}</span>
                  <span className="text-[10px] text-gray-400">SKU: {item.sku} | Unit: {item.unit}</span>
                </div>
                <div className="flex items-center gap-4 shrink-0">
                  <div className="flex flex-col items-end">
                    <span className="text-[10px] text-gray-400">System Count</span>
                    <span className="font-bold text-gray-700">{item.onHand}</span>
                  </div>
                  <div className="flex flex-col items-end">
                    <span className="text-[10px] text-emerald-700 font-bold">Physical Count</span>
                    <input type="number" value={counts[item.id] ?? item.onHand}
                      onChange={e => setCounts(prev => ({ ...prev, [item.id]: Number(e.target.value) }))}
                      className="w-16 h-8 text-right border border-gray-300 rounded px-1.5 focus:outline-none focus:border-emerald-500" />
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="flex gap-2 justify-end border-t border-gray-100 pt-3 mt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 border border-gray-300 rounded text-gray-600 font-semibold hover:bg-gray-50 transition-colors">Cancel</button>
            <button onClick={handleSubmit} className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded font-bold transition-colors">Submit Audit</button>
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Verify and commit**

Run: `cd admin-frontend && npx tsc --noEmit 2>&1 | grep "dialogs/PurchaseOrderDialog\|dialogs/StocktakeDialog"` — expect no output.

```bash
git add admin-frontend/src/pages/inventory/dialogs/PurchaseOrderDialog.tsx admin-frontend/src/pages/inventory/dialogs/StocktakeDialog.tsx
git commit -m "inventory: extract PurchaseOrderDialog and StocktakeDialog, fix hardcoded fake stocktake submit"
```

---

### Task 9: `HistoryDialog`

**Files:**
- Create: `admin-frontend/src/pages/inventory/dialogs/HistoryDialog.tsx`

**Interfaces:**
- Consumes: `Icon` (Task 5), `StockMovement` (Task 1)
- Produces: one dialog, consumed in Task 11.

New file — the trigger (`InventoryPage.tsx:1895-1905`, "View History" row menu item, `setSelectedHistoryItemId`/`setIsHistoryOpen`) has always existed with nothing rendering behind it.

- [ ] **Step 1: Write the dialog**

```tsx
// admin-frontend/src/pages/inventory/dialogs/HistoryDialog.tsx
import React from 'react';
import { Icon } from '../components/Icon';
import { StockMovement } from '../types';
import { VENUES } from '../types/venue';

interface HistoryDialogProps {
  itemName: string;
  movements: StockMovement[]; // pre-filtered to this item by the caller
  onClose: () => void;
}

export function HistoryDialog({ itemName, movements, onClose }: HistoryDialogProps) {
  const venueName = (id: string) => VENUES.find(v => v.id === id)?.name || id;

  return (
    <div className="fixed inset-0 bg-gray-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fadeIn">
      <div className="bg-white border border-gray-200 rounded-xl shadow-xl max-w-lg w-full overflow-hidden animate-slideUp">
        <div className="p-4 border-b border-gray-200 flex justify-between items-center bg-gray-50/50">
          <h3 className="text-sm font-black text-gray-900 uppercase tracking-wide">Movement History: {itemName}</h3>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-200 text-gray-400 hover:text-gray-600 transition-colors"><Icon name="cross" size={16} /></button>
        </div>
        <div className="p-4">
          {movements.length === 0 ? (
            <p className="text-xs text-gray-400 italic py-6 text-center">No movements recorded for this item yet.</p>
          ) : (
            <div className="max-h-[360px] overflow-y-auto border border-gray-200 rounded divide-y divide-gray-100">
              {movements.map(m => (
                <div key={m.id} className="p-3 flex justify-between items-center gap-3 text-xs">
                  <div className="flex flex-col min-w-0">
                    <span className="font-bold text-gray-900">{m.type.replace(/_/g, ' ')}</span>
                    <span className="text-[10px] text-gray-400">{new Date(m.timestamp).toLocaleString()} · {venueName(m.venueId)} · {m.user}</span>
                    {m.notes && <span className="text-[10px] text-gray-400 italic">{m.notes}</span>}
                  </div>
                  <div className="flex flex-col items-end shrink-0">
                    <span className={`font-bold ${m.quantity >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{m.quantity >= 0 ? '+' : ''}{m.quantity} {m.unit}</span>
                    <span className="text-[10px] text-gray-400 font-mono">${m.value.toFixed(2)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify and commit**

Run: `cd admin-frontend && npx tsc --noEmit 2>&1 | grep "dialogs/HistoryDialog"` — expect no output.

```bash
git add admin-frontend/src/pages/inventory/dialogs/HistoryDialog.tsx
git commit -m "inventory: add HistoryDialog (wires up previously-dead 'View History' trigger)"
```

---

### Task 10: Extract `components/InventoryTable.tsx`

**Files:**
- Create: `admin-frontend/src/pages/inventory/components/InventoryTable.tsx`

**Interfaces:**
- Consumes: `Icon` (Task 5), `ComputedInventoryItem` (Task 1)
- Produces: one table component scoped to the "inventory" tab only — `InventoryPage.tsx:1624-1948` (the other 5 tabs' smaller tables at `:1952-2105` stay inline in `InventoryPage.tsx`; per the spec's Goal 4, only "the existing Inventory tab and its dialogs" cut over in Foundation — restructuring the rest is sub-project 2's job).

- [ ] **Step 1: Move the table**

Cut `InventoryPage.tsx:1624-1948` (the `<table>` for `tab === 'inventory'`, including its row action dropdown menu at `:1820-1934`) into the new file as a props-driven component. Convert every reference the way this table currently is written:

- `paginatedItems` (prop, `ComputedInventoryItem[]`)
- `selectedRows`/`toggleSelectRow`/`toggleSelectAll` (props, unchanged signatures)
- `sortField`/`sortDirection`/`handleSort` (props, unchanged signatures)
- `activeRowMenuId`/`setActiveRowMenuId` (props, unchanged — the row menu's open/close state stays lifted to the parent since only one row menu can be open at a time across renders)
- Row menu action buttons: replace the six inline `onClick` handlers (`setIsReceiveStockOpen(true)` etc., `InventoryPage.tsx:1826-1929`) with six callback props: `onReceiveStock(item)`, `onAdjustStock(item)`, `onRecordWaste(item)`, `onMarkExpired(item)`, `onViewHistory(item)`, `onDuplicate(item)`, `onDelete(item)` — the parent (Task 11) owns opening the right dialog with the right prefilled draft.
- Every `item.onHand`, `item.status`, `item.batches`, `item.expiryDate` reference in the row markup: `onHand`/`status` are unchanged field names on `ComputedInventoryItem` (Task 1), so those JSX expressions don't need to change. `item.expiryDate`/`item.batchNumber` (old top-level singular fields, now removed) become `item.nearestExpiry`/`item.nearestBatchNumber` (Task 4's hook already computes these).

```tsx
// admin-frontend/src/pages/inventory/components/InventoryTable.tsx
import React from 'react';
import { Icon } from './Icon';
import { ComputedInventoryItem } from '../types';

interface InventoryTableProps {
  paginatedItems: ComputedInventoryItem[];
  selectedRows: Set<string>;
  toggleSelectRow: (id: string) => void;
  toggleSelectAll: (visibleIds: string[]) => void;
  sortField: string;
  sortDirection: 'asc' | 'desc';
  handleSort: (field: string) => void;
  density: 'comfortable' | 'compact';
  activeRowMenuId: string | null;
  setActiveRowMenuId: (id: string | null) => void;
  onReceiveStock: (item: ComputedInventoryItem) => void;
  onAdjustStock: (item: ComputedInventoryItem) => void;
  onRecordWaste: (item: ComputedInventoryItem) => void;
  onMarkExpired: (item: ComputedInventoryItem) => void;
  onViewHistory: (item: ComputedInventoryItem) => void;
  onEdit: (item: ComputedInventoryItem) => void;
  onDuplicate: (item: ComputedInventoryItem) => void;
  onDelete: (item: ComputedInventoryItem) => void;
}

export function InventoryTable(props: InventoryTableProps) {
  // Verbatim body of InventoryPage.tsx:1624-1948, with the adaptations described
  // in Task 10 Step 1 applied: props instead of closures, nearestExpiry/nearestBatchNumber
  // instead of the removed top-level expiryDate/batchNumber fields, and the six
  // row-menu actions calling the props above instead of setIsXOpen(true) directly.
}
```

- [ ] **Step 2: Update `InventoryPage.tsx`**

Remove lines 1624-1948, replace with:

```tsx
<InventoryTable
  paginatedItems={paginatedItems}
  selectedRows={selectedRows}
  toggleSelectRow={toggleSelectRow}
  toggleSelectAll={toggleSelectAll}
  sortField={sortField}
  sortDirection={sortDirection}
  handleSort={handleSort}
  density={density}
  activeRowMenuId={activeRowMenuId}
  setActiveRowMenuId={setActiveRowMenuId}
  onReceiveStock={openReceiveStockFor}
  onAdjustStock={openAdjustmentFor}
  onRecordWaste={openWasteFor}
  onMarkExpired={openExpiryFor}
  onViewHistory={openHistoryFor}
  onEdit={openEditFor}
  onDuplicate={handleDuplicateItem}
  onDelete={openDeleteConfirmFor}
/>
```

(The seven `open*For` callbacks are added to `InventoryPage.tsx` in Task 11 alongside the rest of the cutover — this task only needs the table to compile standalone against the prop interface above; wiring happens next.)

- [ ] **Step 3: Verify and commit**

Run: `cd admin-frontend && npx tsc --noEmit 2>&1 | grep "components/InventoryTable"` — expect no output (errors from `InventoryPage.tsx` calling `<InventoryTable>` with not-yet-defined `open*For` callbacks are expected until Task 11; don't chase those here).

```bash
git add admin-frontend/src/pages/inventory/components/InventoryTable.tsx admin-frontend/src/pages/inventory/InventoryPage.tsx
git commit -m "inventory: extract InventoryTable component from the inventory-tab table"
```

---

### Task 11: Cut over `InventoryPage.tsx`, delete legacy files, final verification

**Files:**
- Modify: `admin-frontend/src/pages/inventory/InventoryPage.tsx` (wholesale rewrite of the state/handlers sections; tab bodies for orders/suppliers/movements/recipes/stocktakes stay structurally the same, re-pointed at hook data)
- Delete: `admin-frontend/src/pages/inventory/hooks/useInventoryState.ts` (dead code, confirmed unused)

**Interfaces:**
- Consumes: everything from Tasks 1-10.
- Produces: the finished Foundation cutover — the exit criterion for this whole plan.

- [ ] **Step 1: Replace local state with the hook**

Delete `InventoryPage.tsx`'s local `useState` calls for `items`, `purchaseOrders`, `suppliers`, `stockMovements`, `recipes`, `stocktakes` (`:164-169`), the `toast`/`showToast`/`activityFeed`/`addActivity` block (`:172-184`), and every inline handler in the "Handlers" section (`:303-819`: `handleAddNewItem`, `handleSaveEditItem`, `consumeFromItemBatches`, `handleReceiveStock`, `handleAdjustmentSubmit`, `handleWasteSubmit`, `handleExpirySubmit`, `handleCreatePurchaseOrder`, `handleDeleteItem`, `handleUndo` — all superseded by Task 4's hook). Keep `handleSort`, `toggleSelectRow`, `toggleSelectAll`, `handleDuplicateItem`, `handleBulkDelete`, `handleBulkUpdateSupplier`, `exportCSV` — these are UI-only concerns (sorting, selection, CSV formatting) that don't touch the ledger, so they stay as local logic reading from `items` (now the hook's `computedItems`).

Add at the top of the component body:

```tsx
const ledger = useInventoryLedger();
const { items, purchaseOrders, suppliers, movements: stockMovements, recipes, stocktakes, activityFeed, toast, setToast } = ledger;
```

- [ ] **Step 2: Fix the filtered/sorted datasets section (`:819-1002`)**

- `filteredItems` (`:820-888`): `item.venue === venueFilter` → `item.venueIds.includes(venueFilter)`; `item.expiryDate` → `item.nearestExpiry`; these are the only two field renames needed — `onHand`, `status`, `min`, `batches` are unchanged names on `ComputedInventoryItem`.
- `filteredMovements` (`:913-932`): `mov.itemName` → look up via `items.find(i => i.id === mov.itemId)?.name ?? mov.itemId`; `mov.date` → `mov.timestamp.substring(0, 10)`.
- `todaysReceiptsValue`/`todaysWasteValue`/`todaysAdjustmentsCount` (`:977-993`): drop the old dual-comparison (`m.type === 'Received' || m.type === 'RECEIVE'`) — these were guarding against the very type mismatch that's been the source of the 215 `tsc` errors. Use the new enum directly: `m.type === 'RECEIVE_PO' || m.type === 'RECEIVE_ADHOC'`, `m.type === 'SCRAP'`, `m.type === 'STOCK_ADJUSTMENT'`. Replace the hardcoded `'2026-07-02'` date-string comparisons with `new Date(m.timestamp).toDateString() === new Date().toDateString()`.
- `expiredItemsCount` (`:995-1001`): `item.status === 'Expired'` alone is now sufficient (already accounts for expiry — drop the redundant second `item.expiryDate` check, since `status` computation in the hook already folds that in).

- [ ] **Step 3: Wire dialogs**

Add local UI-only state for which dialog is open and its prefilled target (this replaces the nine separate `isXOpen`/`xDraft` state pairs with one, since only one dialog can be open at a time):

```tsx
type ActiveDialog =
  | { kind: 'new' } | { kind: 'edit'; item: ComputedInventoryItem }
  | { kind: 'receive'; itemId?: string } | { kind: 'po' }
  | { kind: 'stocktake' } | { kind: 'adjust'; item: ComputedInventoryItem }
  | { kind: 'waste'; item: ComputedInventoryItem } | { kind: 'expiry'; item: ComputedInventoryItem }
  | { kind: 'delete'; item: ComputedInventoryItem } | { kind: 'history'; item: ComputedInventoryItem }
  | null;

const [activeDialog, setActiveDialog] = useState<ActiveDialog>(null);
```

Render each dialog conditionally at the bottom of the JSX (replacing `InventoryPage.tsx:2505-3107` wholesale):

```tsx
{activeDialog?.kind === 'new' && (
  <NewItemDialog suppliers={suppliers} onClose={() => setActiveDialog(null)}
    onSubmit={draft => { ledger.addNewItem({ ...draft, venueId: draft.openingVenueId, openingQty: draft.openingQty }); setActiveDialog(null); }} />
)}
{activeDialog?.kind === 'edit' && (
  <EditItemDialog item={activeDialog.item} suppliers={suppliers} onClose={() => setActiveDialog(null)}
    onSubmit={updated => { ledger.updateItem(updated); setActiveDialog(null); }} />
)}
{activeDialog?.kind === 'receive' && (
  <ReceiveStockDialog items={items} initialItemId={activeDialog.itemId} onClose={() => setActiveDialog(null)}
    onSubmit={draft => { ledger.receiveStock(draft); setActiveDialog(null); }} />
)}
{activeDialog?.kind === 'po' && (
  <PurchaseOrderDialog items={items} suppliers={suppliers} onClose={() => setActiveDialog(null)}
    onSubmit={(supplierName, itemsList, notes) => { ledger.createPurchaseOrder(supplierName, itemsList, notes); setActiveDialog(null); }} />
)}
{activeDialog?.kind === 'stocktake' && (
  <StocktakeDialog items={items} onClose={() => setActiveDialog(null)}
    onSubmit={(counts, venueId, area, category, counter) => { ledger.finalizeStocktake(counts, venueId, area, category, counter); setActiveDialog(null); }} />
)}
{activeDialog?.kind === 'adjust' && (
  <AdjustmentDialog item={activeDialog.item} onClose={() => setActiveDialog(null)}
    onSubmit={(itemId, venueId, delta, reason, notes) => { ledger.adjustStock(itemId, venueId, delta, reason, notes); setActiveDialog(null); }} />
)}
{activeDialog?.kind === 'waste' && (
  <WasteDialog item={activeDialog.item} currentOnHand={activeDialog.item.onHand} onClose={() => setActiveDialog(null)}
    onSubmit={(itemId, venueId, qty, reason, notes) => { ledger.recordWaste(itemId, venueId, qty, reason, notes); setActiveDialog(null); }} />
)}
{activeDialog?.kind === 'expiry' && (
  <ExpiryDialog item={activeDialog.item} onClose={() => setActiveDialog(null)}
    onSubmit={(itemId, venueId, batchId, qty, action, notes) => { ledger.markExpired(itemId, venueId, batchId, qty, action, notes); setActiveDialog(null); }} />
)}
{activeDialog?.kind === 'delete' && (
  <DeleteConfirmDialog itemName={activeDialog.item.name} onClose={() => setActiveDialog(null)}
    onConfirm={() => { ledger.deleteItem(activeDialog.item.id); setActiveDialog(null); }} />
)}
{activeDialog?.kind === 'history' && (
  <HistoryDialog itemName={activeDialog.item.name}
    movements={stockMovements.filter(m => m.itemId === activeDialog.item.id)}
    onClose={() => setActiveDialog(null)} />
)}
```

Wire the seven `InventoryTable` callback props (Task 10 Step 2) to `setActiveDialog`:

```tsx
onReceiveStock={item => setActiveDialog({ kind: 'receive', itemId: item.id })}
onAdjustStock={item => setActiveDialog({ kind: 'adjust', item })}
onRecordWaste={item => setActiveDialog({ kind: 'waste', item })}
onMarkExpired={item => setActiveDialog({ kind: 'expiry', item })}
onViewHistory={item => setActiveDialog({ kind: 'history', item })}
onEdit={item => setActiveDialog({ kind: 'edit', item })}
onDelete={item => setActiveDialog({ kind: 'delete', item })}
```

And the header action buttons (`InventoryPage.tsx:1018-1049`, `setIsNewItemOpen(true)` etc.): `onClick={() => setActiveDialog({ kind: 'new' })}`, `{ kind: 'receive' }`, `{ kind: 'po' }`, `{ kind: 'stocktake' }`.

- [ ] **Step 4: Fix the other 5 tabs' field references**

`orders`/`suppliers`/`movements`/`recipes`/`stocktakes` tables (`InventoryPage.tsx:1952-2105`, unmoved) keep their structure but need the same `mov.itemName`→lookup and `mov.date`→`timestamp` fixes as Step 2's `filteredMovements`, and the movements-tab `typeBg` color logic (`:2032-2035`, checks `'Consumed'`/`'Waste'`/`'Received'`) updated to the real enum: `SCRAP`/`EXPIRED` → red, `RECEIVE_PO`/`RECEIVE_ADHOC`/`RETURN` → emerald, `STOCK_ADJUSTMENT`/`STOCKTAKE` → amber, everything else → blue (this was already dead code doing string comparisons against values that don't exist in the type — this fix makes the color-coding actually work, which is a bug fix, not a behavior change, since it currently always falls through to the blue default).

The `orders` tab's PO status check at `:1968` (`po.status === 'Received'`) → `po.status === 'Fully Received'` (matches the real `PurchaseOrder.status` union from Task 1).

- [ ] **Step 5: Undo button**

Replace the old `handleUndo`/`lastAction` (`:453-461`, removed in Step 1) call site with `ledger.undoLastMovements`, and gate its visibility on `ledger.canUndo` instead of `lastAction !== null`.

- [ ] **Step 6: Delete dead code**

```bash
rm admin-frontend/src/pages/inventory/hooks/useInventoryState.ts
```

- [ ] **Step 7: Full verification**

Run: `cd admin-frontend && npx tsc --noEmit` — expect **zero errors**. This is the plan's exit criterion; do not consider this task done with any remaining errors.

Run: `cd admin-frontend && npm run dev`, open the Inventory page, and manually walk every item from the spec's Baseline + Verification sections:

1. Search, and every filter (category/supplier/venue/status/stock-level/expiry/batch) — confirm each narrows the list correctly.
2. Sort every sortable column, both directions.
3. Pagination and page-size selector.
4. Density toggle (comfortable/compact).
5. CSV export downloads with correct rows.
6. Create item (with and without an opening quantity) → appears in table with correct on-hand.
7. Edit item → changes persist.
8. Delete item (with confirm dialog) → removed from table.
9. Receive stock (via header button and via row-menu prefill) → on-hand increases by the right amount for the right venue; switching the venue filter shows the change only for that venue, and "All Venues" shows the aggregate.
10. Create PO → appears in Orders tab with correct total.
11. Adjust stock (both positive and negative delta; confirm negative-below-zero is rejected with a toast) → on-hand updates, Movements tab shows a `STOCK_ADJUSTMENT` entry.
12. Record waste (confirm waste-exceeds-stock is rejected) → on-hand decreases, Movements tab shows `SCRAP`.
13. Mark expired → on-hand decreases, correct movement type (`EXPIRED` or `RETURN` depending on action chosen).
14. View History → shows the movements just created for that item, most recent first.
15. Stocktake → typed physical counts actually produce `STOCKTAKE` movements sized to the real variance (not the old hardcoded 128/0/100%).
16. Undo immediately after any single mutation above → the movement disappears and on-hand reverts.
17. Multi-venue spot-check (spec's explicit requirement): pick an item stocked at 2+ venues, confirm the venue filter shows different on-hand per venue and "All Venues" sums them correctly.

- [ ] **Step 8: Commit**

```bash
git add -A admin-frontend/src/pages/inventory
git commit -m "inventory: cut InventoryPage.tsx over to the ledger model, delete dead useInventoryState.ts"
```

---

## Self-Review

**Spec coverage:**
- Goal 1 (ledger as source of truth, on-hand computed) — Tasks 2, 4.
- Goal 2 (full type model) — Task 1.
- Goal 3 (break up the monolith) — Tasks 5-10.
- Goal 4 (cut the inventory tab + dialogs over, prove it end-to-end) — Task 11.
- Goal 5 (zero regression) — Task 11 Step 7 manual pass, sourced directly from the spec's own Baseline list.
- Non-goals respected: no Command Bar/Operations Inbox/PO-lifecycle-UI/Quick-Receive/Stocktake-wizard/Supplier-detail/Transfers-UI/Reports/AI-assistant/data-grid work anywhere in this plan; no folders pre-created for sub-projects 2-9; recipe auto-consumption on order completion untouched (`simulateRecipeSales`-equivalent isn't ported — it only existed in the dead `useInventoryState.ts`, and there's no live UI trigger for it, so nothing regresses by not porting it).
- Baseline's "duplicate expiry fields" cleanup — done in Task 1 Step 3 (`InventoryBatch` no longer has top-level `expiryDate`/`batchNumber` duplication on `InventoryItem`; only `batches[]` remains).
- PO line items non-goal — flagged as already-contradicted by the current `types.ts` (Global Constraints); Task 8 Step 1 makes the dialog match the type that already exists rather than reverting it, to avoid re-breaking what's already there.

**Placeholder scan:** No TBD/TODO markers. Task 10's `InventoryTable` body and Task 6/11's field lists reference exact source line ranges instead of reproducing ~1,700 lines of unchanged JSX verbatim — each such reference states precisely what changes (field renames, prop wiring) and what doesn't, which is the accurate instruction for a move-and-adapt step at this scale.

**Type consistency check:** `ComputedInventoryItem` (Task 1) → `onHand`/`status`/`daysLeft`/`nearestExpiry`/`nearestBatchNumber`/`expiredQty` — matches the hook's `computedItems` mapping (Task 4) field-for-field, matches every dialog prop referencing an item (Tasks 6-9), matches `InventoryTable`'s prop type (Task 10), matches Task 11's filter/sort adaptations. `StockMovement.itemId`/`venueId`/`timestamp` (Task 1) → matches every mutator in Task 4, every dialog's `onSubmit` signature (Tasks 7-8), and Task 11's `filteredMovements`/History dialog usage. `AdjustmentReason`/`WasteReason`/`ExpiryActionType` (Task 1) → match `adjustStock`/`recordWaste`/`markExpired` hook signatures (Task 4) and the corresponding dialog `onSubmit` signatures (Task 7).
