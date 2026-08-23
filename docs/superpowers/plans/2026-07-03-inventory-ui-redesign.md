# Inventory Page — Pixel-Match UI Redesign Implementation Plan

> **Operational integration requirement — 2026-08-15:** Future production UI must consume canonical Verdura order/consumption events governed by the [Target Operating Model](../../target-operating-model.md), show reconciliation exceptions against Idealpos, and never infer stock movement from a payment, KDS or print status. Historical mock-data instructions remain prototype-only.

> **Prototype classification — 2026-08-15:** This pixel-match plan is a design artifact, not proof of a working Material Management domain. The current inventory surface contains mock/local behavior and is outside the active Phase 1A gate. Current authority: [../../mvp.md](../../mvp.md).

**Recommendation:** retain the visual work for discovery, label it `Prototype`, and prevent simulated counts, postings, valuations or sync badges from appearing authoritative. Resume implementation only after the inventory domain, posting invariants, permissions, audit and phase-gate evidence are approved.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild `admin-frontend/src/pages/inventory/InventoryPage.tsx` to pixel-match the reference screenshot at `/home/cyrus/Documents/inventory.png` — command bar, two metrics rows, 11-tab bar, filter bar, inventory table, pagination, and a 5-widget right sidebar — decomposed into focused components, with all 11 tabs wired to real (not placeholder) functionality, on top of the current (pre-Foundation) data model.

**Architecture:** `InventoryPage.tsx` stays the sole owner of state (`useState`/`useMemo` — no new store), decomposed into ~20 presentational components under `pages/inventory/components/` that receive data + callbacks as props. A new `utils/inventoryStatus.ts` becomes the single source of truth for stock-status/days-left/expiry derivation (replacing two currently-inconsistent inline copies), which both the new UI and the future Foundation ledger rewrite can sit behind. `mockData.ts` is extended (not replaced) to 128 realistic items plus richer PO/movement/waste data.

**Tech Stack:** React 18 + TypeScript (strict), Vite, Tailwind CSS. No test framework installed in `admin-frontend` — verification is `tsc --noEmit` (`npm run typecheck`) plus a manual pass via `npm run dev`, per this codebase's existing convention (see `docs/superpowers/plans/2026-07-03-inventory-foundation.md`, which uses the same approach).

## Global Constraints

- Frontend-only. No backend/API/DB changes. Scope is `admin-frontend/src/pages/inventory/`.
- Reuse existing venue IDs — do not invent new ones: `verdura` (Verdura — Downtown), `v2` (Verdura — Marina), `v3` (Verdura — Airport), plus the existing free-text venue labels already in use (`All Venues`, `Main Kitchen`, `Bar Lounge`).
- No test framework exists in `admin-frontend`. Every task's verification step is `npm run typecheck` (`tsc --noEmit`, run from `admin-frontend/`) and a manual check via `npm run dev`, never an automated test command.
- **Baseline correction vs. the design spec:** `InventoryItem['status']` in `types.ts:25` already includes `'Critical'` and `'Out of Stock'` in its union — the design spec's claim that `Critical` needs to be *added* was based on an imprecise earlier scan. The real gap isn't a missing type, it's that the current code never *consistently derives* Critical (see next bullet). No type change needed for this.
- **Known bugs in the current code, to be fixed as part of this redesign (documented here so no task "silently" changes behavior):**
  1. The top-bar "Receive Stock" button (`InventoryPage.tsx:1028`, `setIsReceiveStockOpen(true)`) opens a modal that references an undeclared `receiveStockDraft`/`setReceiveStockDraft` (lines 2830-2876) — a `ReferenceError` today. Fixed in Task 12 by routing both the top-bar button and row-level "Receive Stock" through the one real, working `receiveGoodsDraft`/`setReceiveGoodsDraft`/`handleReceiveStock` state (declared `:254`, submit handler `:429`).
  2. Two conflicting definitions of "Critical" stock coexist: the KPI-card/sidebar `stockLevelFilter === 'critical'` branch (`:841`) means `onHand === 0`, while the table row's own badge logic (`:1685-1688`) means `onHand > 0 && onHand <= min * 0.25` — a *different*, non-zero condition. Task 1's `getStockStatus()` adopts the row-badge's fractional definition as canonical (it's the one that actually produces a "Critical" label anywhere today) and gives Zero Stock its own bucket, used consistently everywhere after this plan.
  3. (Fixed in Task 10, `InventoryFilters`) The Movements-tab type filter's dropdown options (`RECEIVE`, `SALE`, `TRANSFER`, `ADJUSTMENT`, plus 3 "(Legacy)" options, `:1528-1537`) don't match the real `StockMovement['type']` union (`RECEIVE_PO | RECEIVE_ADHOC | TRANSFER_IN | TRANSFER_OUT | SALE_CONSUMPTION | RECIPE_CONSUMPTION | STOCK_ADJUSTMENT | SCRAP | EXPIRED | RETURN | STOCKTAKE | PURCHASE_RETURN | SUPPLIER_CREDIT`) — selecting most of them yields zero results. Fixed in Task 10 by regenerating the dropdown options from the real union.
  4. Sorting the table by the "Value" column header is a no-op (`InventoryItem` has no `value` field; `item[sortField as keyof InventoryItem]` reads `undefined`). Fixed in Task 8 by computing value in the sort comparator instead of via property lookup.
  5. Sidebar Widget 1 rows 3–6 (Expiring Soon/High Waste/Price Increase/Overdue Deliveries), all of Widget 2 (Stock Coverage), and most of Widget 3 (Waste Tracking) are hardcoded strings with no `onClick` — not derived from `items`/`stockMovements` state. Widget 3's hardcoded "$186.40" also silently disagrees with the KPI grid's *computed* `todaysWasteValue` for the same concept. Fixed across Tasks 4-5 (metrics rows) and Task 15 (sidebar widgets) by deriving every one of these from the same underlying data.
  6. `initialTransfers`/`InventoryTransfer` (`mockData.ts:705-731`) is a fully dead export, never imported by `InventoryPage.tsx`. It's a well-formed, purpose-built transfer-record shape (`fromVenue`/`toVenue`/`items`/`status: 'Pending'|'Received'|'Rejected'`) — a better fit for a dedicated Transfers tab than repurposing the generic `StockMovement` log. Task 14 wires it up (extended with more sample data, not replaced) as the real data source for the new Transfers tab and `TransferStockDialog`.
  7. Two independent, duplicated copies of the same `categories` array literal exist (`InventoryPage.tsx:5` and `mockData.ts:363`). Task 2 removes the page-level copy in favor of one export from `mockData.ts`.
  8. **`isAdjustmentOpen`, `isWasteOpen`, `isExpiryOpen`, and `isHistoryOpen` are all declared (`:207-210`) and correctly *set* by the row-menu's "Adjust Stock"/"Record Waste"/"Mark Expired"/"View History" buttons, but none of the 4 has a corresponding modal anywhere in the JSX** (confirmed: only 6 `MODAL:` blocks exist in the file — New Item, Edit Item, Receive Stock, Purchase Order, Delete Confirm, Stocktake — and grepping `isAdjustmentOpen`/`isWasteOpen`/`isExpiryOpen`/`isHistoryOpen` finds no usage outside their own `useState` line). Clicking any of these 4 row-menu items today silently does nothing. This is dead UI, not a working feature to preserve as-is — Task 18 builds the 4 missing dialogs (their submit handlers `handleAdjustmentSubmit`/`handleWasteSubmit`/`handleExpirySubmit` already exist and work, `:532-739`; only the modal JSX is missing).
- Existing *working* dialogs not touched by this plan (New Item, Edit Item, Purchase Order, Stocktake, Delete Confirm — roughly 500 of the file's 3,110 lines) stay inline in `InventoryPage.tsx` as pure relocation with no behavior change. They aren't part of the reference screenshot, and the "no monolithic file" goal is already met by extracting the ~2,200 lines of card/table/tab/sidebar JSX this plan moves out, plus the 4 new dialogs Task 18 adds as their own files. Full extraction of the remaining 5 working dialogs is optional future follow-up, not part of this plan.
- Commit after each task.

## File Structure

```
admin-frontend/src/pages/inventory/
  InventoryPage.tsx                       (shell: state + composition; shrinks from 3,110 to ~1,900 lines)
  types.ts                                (unchanged — Critical/Out of Stock already present)
  mockData.ts                             (extended: 60 → 128 items, richer POs/movements/waste/AI data)
  utils/
    inventoryStatus.ts                    (NEW — single source of truth for status/days-left/expiry derivation)
    operationsInbox.ts                    (NEW — single source of truth for the 7 Operations Inbox figures, shared by MetricsInbox, OperationsInboxDetailed, AlertsTab)
  components/
    Sparkline.tsx                         (NEW — tiny inline SVG line chart)
    CommandBar.tsx                        (NEW — 8-button action bar)
    MetricsInbox.tsx                      (NEW — Operations Inbox row, 7 cards)
    MetricsKPI.tsx                        (NEW — KPI/sparkline row, 7 cards)
    InventoryTabs.tsx                     (NEW — 11-tab bar)
    InventoryFilters.tsx                  (NEW — search, 5 dropdowns, quick chips, density)
    InventoryTable.tsx                    (NEW — extracted inventory table)
    MovementsTable.tsx                    (NEW — shared, filterable log table; powers Movements tab (all types) and Waste tab (SCRAP only))
    Pagination.tsx                        (NEW — extracted pagination controls)
    tabs/
      ReceivingTab.tsx                    (NEW — POs awaiting receipt)
      WasteTab.tsx                        (NEW — MovementsTable filtered to SCRAP)
      TransfersTab.tsx                    (NEW — reads the `transfers: InventoryTransfer[]` state, wiring up the currently-dead `initialTransfers` export)
      ReportsTab.tsx                      (NEW)
      AlertsTab.tsx                       (NEW)
    dialogs/
      TransferStockDialog.tsx             (NEW)
      AdjustmentDialog.tsx                (NEW — the existing "Adjust Stock" row-menu button has never had a modal to open; Task 18 builds it)
      WasteDialog.tsx                     (NEW — same gap for "Record Waste")
      ExpiryDialog.tsx                    (NEW — same gap for "Mark Expired")
      HistoryDialog.tsx                   (NEW — same gap for "View History")
    sidebar/
      OperationsInboxDetailed.tsx         (NEW)
      StockCoverageCard.tsx               (NEW)
      AIAssistantCard.tsx                 (NEW)
      WasteTrackingCard.tsx               (NEW)
      SupplierPerformanceCard.tsx         (NEW — extracted, logic unchanged)
```

---

### Task 1: Status derivation helpers (`utils/inventoryStatus.ts`)

**Files:**
- Create: `admin-frontend/src/pages/inventory/utils/inventoryStatus.ts`

**Interfaces:**
- Consumes: `InventoryItem` from `../types` (fields: `onHand`, `min`, `status`, `expiryDate`, `daysLeft`).
- Produces (used by nearly every later task):
  - `type StockStatus = 'Healthy' | 'Low Stock' | 'Critical' | 'Zero Stock' | 'Expired'`
  - `getStockStatus(item: InventoryItem, today?: Date): StockStatus`
  - `getStatusBadgeStyle(status: StockStatus): { bg: string; label: string; iconName: 'check' | 'alert' | 'cross' | 'clock' }`
  - `getDaysLeftBadgeClass(daysLeft: number): string`
  - `getExpiryInfo(item: InventoryItem, today?: Date): { text: string; className: string } | null`
  - `isReceivable(po: PurchaseOrder): boolean` — `po.status === 'Sent' || po.status === 'Partially Received'`
  - `getAvailable(item: InventoryItem): number` — deterministic `onHand - reserved`, used by both Task 11's `InventoryTable` (rendering) and its sort comparator, so sorting by the new "Available" column isn't another silent no-op like the pre-existing Value-column bug this plan fixes.

- [ ] **Step 1: Write the helpers module**

```typescript
// admin-frontend/src/pages/inventory/utils/inventoryStatus.ts
import type { InventoryItem, PurchaseOrder } from '../types';

export type StockStatus = 'Healthy' | 'Low Stock' | 'Critical' | 'Zero Stock' | 'Expired';

const DEFAULT_TODAY = () => new Date();

/**
 * Single source of truth for stock status. Resolves the pre-existing
 * inconsistency between the old KPI-card definition of "critical"
 * (onHand === 0) and the old table-badge definition (onHand <= min * 0.25):
 * this adopts the fractional definition and gives zero-stock its own bucket.
 */
export function getStockStatus(item: InventoryItem, today: Date = DEFAULT_TODAY()): StockStatus {
  const isExpired =
    item.status === 'Expired' ||
    (!!item.expiryDate && new Date(item.expiryDate).getTime() < today.getTime());
  if (isExpired) return 'Expired';
  if (item.onHand === 0) return 'Zero Stock';
  if (item.onHand <= item.min * 0.25) return 'Critical';
  if (item.onHand < item.min) return 'Low Stock';
  return 'Healthy';
}

export function getStatusBadgeStyle(status: StockStatus): {
  bg: string;
  label: string;
  iconName: 'check' | 'alert' | 'cross' | 'clock';
} {
  switch (status) {
    case 'Expired':
      return { bg: 'bg-red-50 text-red-700 border border-red-200', label: 'Expired', iconName: 'clock' };
    case 'Zero Stock':
      return { bg: 'bg-gray-100 text-gray-700 border border-gray-200', label: 'Zero Stock', iconName: 'cross' };
    case 'Critical':
      return { bg: 'bg-red-50 text-red-700 border border-red-200 animate-pulse', label: 'Critical', iconName: 'alert' };
    case 'Low Stock':
      return { bg: 'bg-amber-50 text-amber-700 border border-amber-100', label: 'Low Stock', iconName: 'alert' };
    case 'Healthy':
    default:
      return { bg: 'bg-emerald-50 text-emerald-700 border border-emerald-100', label: 'Healthy', iconName: 'check' };
  }
}

export function getDaysLeftBadgeClass(daysLeft: number): string {
  if (daysLeft === 0) return 'bg-red-50 text-red-700';
  if (daysLeft <= 2) return 'bg-amber-50 text-amber-700';
  return 'bg-emerald-50 text-emerald-700';
}

export function getExpiryInfo(
  item: InventoryItem,
  today: Date = DEFAULT_TODAY()
): { text: string; className: string } | null {
  if (!item.expiryDate) return null;
  const diffDays = Math.ceil((new Date(item.expiryDate).getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

  if (diffDays < 0) {
    return { text: `Expired (${item.expiryDate})`, className: 'text-red-700 bg-red-50 border-red-200 font-bold' };
  }
  if (diffDays === 0) {
    return { text: 'Expires Today', className: 'text-orange-700 bg-orange-50 border-orange-200 font-bold animate-pulse' };
  }
  if (diffDays <= 3) {
    return { text: `Expires Soon (${diffDays}d)`, className: 'text-yellow-800 bg-yellow-50 border-yellow-200 font-semibold' };
  }
  return { text: `Exp: ${item.expiryDate}`, className: 'text-gray-400 bg-gray-50 border-gray-200' };
}

export function isReceivable(po: PurchaseOrder): boolean {
  return po.status === 'Sent' || po.status === 'Partially Received';
}

/**
 * "Available" has no backing field in InventoryItem. This derives a stable,
 * deterministic 0-40% "reserved" fraction from the item's id (same item always
 * shows the same Available value), so the new Available column has a value at
 * all without requiring a data-model change to the 128 mock items.
 */
export function getAvailable(item: InventoryItem): number {
  let hash = 0;
  for (let i = 0; i < item.id.length; i++) hash = (hash * 31 + item.id.charCodeAt(i)) >>> 0;
  const reservedFraction = (hash % 40) / 100;
  return Math.round(item.onHand * (1 - reservedFraction));
}
```

- [ ] **Step 2: Typecheck**

Run: `cd admin-frontend && npm run typecheck`
Expected: no new errors attributable to `utils/inventoryStatus.ts` (the pre-existing 168 baseline errors — confirmed by running the typecheck at the start of Task 2, see that task's header — are untouched by this task and are not this task's concern; this file is new/isolated and must itself compile clean).

- [ ] **Step 3: Commit**

```bash
git add admin-frontend/src/pages/inventory/utils/inventoryStatus.ts
git commit -m "inventory: add single-source-of-truth status derivation helpers"
```

---

### Task 2: Baseline cleanup — delete dead code, fix pre-existing type errors

Confirmed by running `cd admin-frontend && npm run typecheck` before this plan started: **168 pre-existing errors**, none introduced by this plan. `npm run typecheck | grep "error TS" | sed -E 's/\(.*//' | sort | uniq -c` shows: 116 in `hooks/useInventoryState.ts` (confirmed dead — `grep -rn "useInventoryState" src` finds only its own definition), 46 in `InventoryPage.tsx`, 6 in `mockData.ts`. This task removes the dead file and fixes 43 of the 46 `InventoryPage.tsx` errors (all except 3 that live inside the Stock-Movements-tab block Task 13 replaces wholesale — patching them now would be immediately overwritten). The 6 `mockData.ts` errors are fixed in Task 3 (that generator loop is rewritten there anyway).

**Files:**
- Delete: `admin-frontend/src/pages/inventory/hooks/useInventoryState.ts`
- Modify: `admin-frontend/src/pages/inventory/InventoryPage.tsx` (multiple line ranges, listed per step below)

**Interfaces:** none new — pure bug fixes, no signature changes.

- [ ] **Step 1: Delete the dead hook file**

```bash
rm admin-frontend/src/pages/inventory/hooks/useInventoryState.ts
rmdir admin-frontend/src/pages/inventory/hooks 2>/dev/null || true
```

- [ ] **Step 2: Fix `handleReceiveStock`'s missing `targetItem` guard (fixes 11 errors: lines 462,467,469,480,481,485,486,492,496,503,508,509,512,522 collapse to two guard additions)**

In `InventoryPage.tsx`, find:
```typescript
    receiveGoodsDraft.lines.forEach(line => {
      const itemIndex = updatedItems.findIndex(i => i.id === line.productId);
      if (itemIndex === -1) return;
      const targetItem = updatedItems[itemIndex];
      const prevStock = targetItem.onHand;
```
Replace with:
```typescript
    receiveGoodsDraft.lines.forEach(line => {
      const itemIndex = updatedItems.findIndex(i => i.id === line.productId);
      if (itemIndex === -1) return;
      const targetItem = updatedItems[itemIndex];
      if (!targetItem) return;
      const prevStock = targetItem.onHand;
```

Then find (a few lines later, still in the same forEach):
```typescript
      let nearestBatchNum = targetItem.batchNumber;
      let nearestExpiry = targetItem.expiryDate;
      const activeBatches = updatedBatches.filter(b => b.quantity > 0);
      if (activeBatches.length > 0) {
        activeBatches.sort((a, b) => new Date(a.expiryDate).getTime() - new Date(b.expiryDate).getTime());
        nearestBatchNum = activeBatches[0].batchNumber;
        nearestExpiry = activeBatches[0].expiryDate;
        if (new Date(nearestExpiry).getTime() < new Date().setHours(0,0,0,0)) {
          newStatus = 'Expired';
        }
      }
```
Replace with:
```typescript
      let nearestBatchNum = targetItem.batchNumber;
      let nearestExpiry = targetItem.expiryDate;
      const activeBatches = updatedBatches.filter(b => b.quantity > 0);
      const nearestActiveBatch = activeBatches.length > 0
        ? [...activeBatches].sort((a, b) => new Date(a.expiryDate).getTime() - new Date(b.expiryDate).getTime())[0]
        : undefined;
      if (nearestActiveBatch) {
        nearestBatchNum = nearestActiveBatch.batchNumber;
        nearestExpiry = nearestActiveBatch.expiryDate;
        if (new Date(nearestExpiry).getTime() < new Date().setHours(0,0,0,0)) {
          newStatus = 'Expired';
        }
      }
```

- [ ] **Step 3: Fix the invalid `'RECEIVE'` movement type in the same function**

Find:
```typescript
        itemName: targetItem.name,
        productId: targetItem.id,
        type: 'RECEIVE',
        quantity: line.quantity,
```
Replace with:
```typescript
        itemName: targetItem.name,
        productId: targetItem.id,
        type: 'RECEIVE_ADHOC',
        quantity: line.quantity,
```

- [ ] **Step 4: Fix `handleAdjustmentSubmit`'s unguarded last-batch index access and invalid movement type**

Find:
```typescript
    } else if (adjustmentDraft.adjustedQty > 0) {
      if (updatedBatches.length > 0) {
        updatedBatches[updatedBatches.length - 1].quantity += adjustmentDraft.adjustedQty;
      } else {
```
Replace with:
```typescript
    } else if (adjustmentDraft.adjustedQty > 0) {
      const lastBatch = updatedBatches[updatedBatches.length - 1];
      if (lastBatch) {
        lastBatch.quantity += adjustmentDraft.adjustedQty;
      } else {
```

Find:
```typescript
      itemName: targetItem.name,
      productId: targetItem.id,
      type: 'ADJUSTMENT',
      quantity: adjustmentDraft.adjustedQty,
```
Replace with:
```typescript
      itemName: targetItem.name,
      productId: targetItem.id,
      type: 'STOCK_ADJUSTMENT',
      quantity: adjustmentDraft.adjustedQty,
```

- [ ] **Step 5: Fix `handleExpirySubmit`'s unguarded batch index access**

Find:
```typescript
    if (expiryDraft.batchId) {
      const idx = updatedBatches.findIndex(b => b.id === expiryDraft.batchId);
      if (idx !== -1) {
        const b = updatedBatches[idx];
        expiredBatchNo = b.batchNumber;
        updatedBatches[idx] = { ...b, quantity: Math.max(0, b.quantity - qtyToExpire) };
      }
    } else {
```
Replace with:
```typescript
    if (expiryDraft.batchId) {
      const idx = updatedBatches.findIndex(b => b.id === expiryDraft.batchId);
      const b = idx !== -1 ? updatedBatches[idx] : undefined;
      if (b) {
        expiredBatchNo = b.batchNumber;
        updatedBatches[idx] = { ...b, quantity: Math.max(0, b.quantity - qtyToExpire) };
      }
    } else {
```

- [ ] **Step 6: Fix `handleCreatePurchaseOrder`'s missing `items` field**

Find:
```typescript
    const total = poDraft.items.reduce((sum, item) => sum + (item.quantity * item.estimatedCost), 0);
    const newPO: PurchaseOrder = {
      id: `po-${Date.now()}`,
      orderNumber: `PO-2026-${String(purchaseOrders.length + 1).padStart(3, '0')}`,
      supplier: poDraft.supplier,
      itemsCount: poDraft.items.length,
      totalAmount: total,
      status: 'Sent',
      orderDate: new Date().toISOString().substring(0, 10),
      deliveryDate: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().substring(0, 10)
    };
```
Replace with:
```typescript
    const total = poDraft.items.reduce((sum, item) => sum + (item.quantity * item.estimatedCost), 0);
    const newPO: PurchaseOrder = {
      id: `po-${Date.now()}`,
      orderNumber: `PO-2026-${String(purchaseOrders.length + 1).padStart(3, '0')}`,
      supplier: poDraft.supplier,
      itemsCount: poDraft.items.length,
      totalAmount: total,
      status: 'Sent',
      orderDate: new Date().toISOString().substring(0, 10),
      deliveryDate: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().substring(0, 10),
      items: poDraft.items.map(it => ({
        productId: '',
        name: it.name,
        expectedQty: it.quantity,
        receivedQty: 0,
        rejectedQty: 0,
        damagedQty: 0,
        unit: it.unit,
        cost: it.estimatedCost
      }))
    };
```

- [ ] **Step 7: Fix the two boolean-coercion errors in `filteredItems`**

Find:
```typescript
        if (statusFilter === 'Expired') matchesStatus = item.status === 'Expired' || (item.expiryDate && new Date(item.expiryDate).getTime() < todayTime);
```
Replace with:
```typescript
        if (statusFilter === 'Expired') matchesStatus = item.status === 'Expired' || !!(item.expiryDate && new Date(item.expiryDate).getTime() < todayTime);
```

Find:
```typescript
      let matchesBatch = true;
      const hasBatches = item.batches && item.batches.length > 0;
```
Replace with:
```typescript
      let matchesBatch = true;
      const hasBatches = !!(item.batches && item.batches.length > 0);
```

- [ ] **Step 8: Fix the three invalid movement-type literals in the KPI `useMemo`s**

Find:
```typescript
  const todaysReceiptsValue = useMemo(() => {
    return stockMovements
      .filter(m => (m.type === 'Received' || m.type === 'RECEIVE') && m.date === '2026-07-02')
      .reduce((sum, m) => sum + m.value, 0);
  }, [stockMovements]);

  const todaysWasteValue = useMemo(() => {
    return stockMovements
      .filter(m => (m.type === 'Waste' || m.type === 'SCRAP') && m.date === '2026-07-02')
      .reduce((sum, m) => sum + Math.abs(m.value), 0);
  }, [stockMovements]);

  const todaysAdjustmentsCount = useMemo(() => {
    return stockMovements
      .filter(m => (m.type === 'Adjustment' || m.type === 'ADJUSTMENT') && m.date === '2026-07-02')
      .length;
  }, [stockMovements]);
```
Replace with:
```typescript
  const todaysReceiptsValue = useMemo(() => {
    return stockMovements
      .filter(m => (m.type === 'RECEIVE_PO' || m.type === 'RECEIVE_ADHOC') && m.date === '2026-07-02')
      .reduce((sum, m) => sum + m.value, 0);
  }, [stockMovements]);

  const todaysWasteValue = useMemo(() => {
    return stockMovements
      .filter(m => m.type === 'SCRAP' && m.date === '2026-07-02')
      .reduce((sum, m) => sum + Math.abs(m.value), 0);
  }, [stockMovements]);

  const todaysAdjustmentsCount = useMemo(() => {
    return stockMovements
      .filter(m => m.type === 'STOCK_ADJUSTMENT' && m.date === '2026-07-02')
      .length;
  }, [stockMovements]);
```

- [ ] **Step 9: Fix the unguarded `batches[0]` access in the row-menu's "Mark Expired" click handler**

Find:
```typescript
                                            setExpiryDraft({
                                              itemId: item.id,
                                              batchId: item.batches && item.batches.length > 0 ? item.batches[0].id : '',
                                              quantity: item.onHand,
                                              notes: ''
                                            });
```
Replace with:
```typescript
                                            setExpiryDraft({
                                              itemId: item.id,
                                              batchId: item.batches?.[0]?.id ?? '',
                                              quantity: item.onHand,
                                              notes: ''
                                            });
```

- [ ] **Step 10: Fix the invalid `'Received'` PurchaseOrder status comparison in the Orders tab**

Find:
```typescript
                    let statusBg = 'bg-blue-50 text-blue-700';
                    if (po.status === 'Received') statusBg = 'bg-emerald-50 text-emerald-700';
                    if (po.status === 'Cancelled') statusBg = 'bg-gray-100 text-gray-500';
```
Replace with:
```typescript
                    let statusBg = 'bg-blue-50 text-blue-700';
                    if (po.status === 'Fully Received') statusBg = 'bg-emerald-50 text-emerald-700';
                    if (po.status === 'Cancelled') statusBg = 'bg-gray-100 text-gray-500';
```

- [ ] **Step 11: Rewrite the broken "Receive Stock" modal to use the real `receiveGoodsDraft` state instead of the undeclared `receiveStockDraft`**

This modal (guarded by `isReceiveStockOpen`) is reached two ways today: the top action bar (`setIsReceiveStockOpen(true)` with no draft set) and each row's "⋮ → Receive Stock" menu item (which correctly populates `receiveGoodsDraft` first, `:1828-1837`). Both paths render the same modal, which currently references a variable that was never declared — a guaranteed `ReferenceError` on open. Since `onSubmit={handleReceiveStock}` (unchanged) already reads `receiveGoodsDraft` correctly, only the form's *fields* need rewriting to match that shape (`supplier`, `referenceNumber`, `deliveryDate`, `notes`, `lines: [{ productId, quantity, cost, ... }]`).

Find the entire form body:
```jsx
            <form onSubmit={handleReceiveStock} className="p-4 flex flex-col gap-3 text-xs">
              <div className="flex flex-col gap-1">
                <label className="font-bold text-gray-400 uppercase tracking-wider">Select Item</label>
                <select 
                  required
                  value={receiveStockDraft.itemId} 
                  onChange={e => {
                    const matchedItem = items.find(i => i.id === e.target.value);
                    setReceiveStockDraft(d => ({
                      ...d,
                      itemId: e.target.value,
                      cost: matchedItem ? matchedItem.cost : 0,
                      supplier: matchedItem ? matchedItem.supplier : ''
                    }));
                  }}
                  className="w-full h-8 px-2.5 border border-gray-300 rounded focus:outline-none focus:border-emerald-500 cursor-pointer"
                >
                  <option value="" disabled>-- Select Inventory Item --</option>
                  {items.map(item => <option key={item.id} value={item.id}>{item.name} ({item.sku})</option>)}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1">
                  <label className="font-bold text-gray-400 uppercase tracking-wider">Receive Qty</label>
                  <input 
                    type="number" 
                    required
                    min={1}
                    value={receiveStockDraft.quantity || ''} 
                    onChange={e => setReceiveStockDraft(d => ({ ...d, quantity: Number(e.target.value) }))}
                    placeholder="e.g. 50" 
                    className="w-full h-8 px-2.5 border border-gray-300 rounded focus:outline-none focus:border-emerald-500"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="font-bold text-gray-400 uppercase tracking-wider">Actual Unit Cost ($)</label>
                  <input 
                    type="number" 
                    step="0.01" 
                    required
                    min={0}
                    value={receiveStockDraft.cost || ''} 
                    onChange={e => setReceiveStockDraft(d => ({ ...d, cost: Number(e.target.value) }))}
                    className="w-full h-8 px-2.5 border border-gray-300 rounded focus:outline-none focus:border-emerald-500"
                  />
                </div>
              </div>

              {receiveStockDraft.supplier && (
                <div className="p-2.5 bg-gray-50 border border-gray-200 rounded font-semibold text-gray-500 text-[11px]">
                  Supplier logged: <b className="text-gray-700">{receiveStockDraft.supplier}</b>
                </div>
              )}

              <div className="flex gap-2 justify-end border-t border-gray-100 pt-3 mt-2">
```
Replace with:
```jsx
            <form onSubmit={handleReceiveStock} className="p-4 flex flex-col gap-3 text-xs">
              <div className="flex flex-col gap-1">
                <label className="font-bold text-gray-400 uppercase tracking-wider">Select Item</label>
                <select
                  required
                  value={receiveGoodsDraft.lines[0]?.productId ?? ''}
                  onChange={e => {
                    const matchedItem = items.find(i => i.id === e.target.value);
                    setReceiveGoodsDraft(d => ({
                      ...d,
                      supplier: matchedItem ? matchedItem.supplier : d.supplier,
                      lines: [{
                        ...d.lines[0],
                        productId: e.target.value,
                        unit: matchedItem ? matchedItem.unit : d.lines[0]?.unit ?? '',
                        cost: matchedItem ? matchedItem.cost : d.lines[0]?.cost ?? 0
                      }]
                    }));
                  }}
                  className="w-full h-8 px-2.5 border border-gray-300 rounded focus:outline-none focus:border-emerald-500 cursor-pointer"
                >
                  <option value="" disabled>-- Select Inventory Item --</option>
                  {items.map(item => <option key={item.id} value={item.id}>{item.name} ({item.sku})</option>)}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1">
                  <label className="font-bold text-gray-400 uppercase tracking-wider">Receive Qty</label>
                  <input
                    type="number"
                    required
                    min={1}
                    value={receiveGoodsDraft.lines[0]?.quantity || ''}
                    onChange={e => setReceiveGoodsDraft(d => ({
                      ...d,
                      lines: [{ ...d.lines[0], quantity: Number(e.target.value) }]
                    }))}
                    placeholder="e.g. 50"
                    className="w-full h-8 px-2.5 border border-gray-300 rounded focus:outline-none focus:border-emerald-500"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="font-bold text-gray-400 uppercase tracking-wider">Actual Unit Cost ($)</label>
                  <input
                    type="number"
                    step="0.01"
                    required
                    min={0}
                    value={receiveGoodsDraft.lines[0]?.cost || ''}
                    onChange={e => setReceiveGoodsDraft(d => ({
                      ...d,
                      lines: [{ ...d.lines[0], cost: Number(e.target.value) }]
                    }))}
                    className="w-full h-8 px-2.5 border border-gray-300 rounded focus:outline-none focus:border-emerald-500"
                  />
                </div>
              </div>

              {receiveGoodsDraft.supplier && (
                <div className="p-2.5 bg-gray-50 border border-gray-200 rounded font-semibold text-gray-500 text-[11px]">
                  Supplier logged: <b className="text-gray-700">{receiveGoodsDraft.supplier}</b>
                </div>
              )}

              <div className="flex gap-2 justify-end border-t border-gray-100 pt-3 mt-2">
```

- [ ] **Step 12: Typecheck**

Run: `cd admin-frontend && npm run typecheck`
Expected: error count drops from 168 to 3 (all 3 remaining are the Stock-Movements-tab `mov.type === 'Consumed'/'Waste'/'Received'` comparisons, fixed by Task 13 replacing that block) plus `mockData.ts`'s 6 (fixed by Task 3). Confirm with:
```bash
npm run typecheck 2>&1 | grep -c "error TS"
```
Expected output: `9`

- [ ] **Step 13: Manual smoke check**

Run: `npm run dev`, open the Inventory page, click the top-bar "Receive Stock" button, select any item, enter a quantity and cost, submit — confirm no console error and the item's On Hand increases. Then open a row's "⋮ → Receive Stock" menu item and confirm it still pre-fills the item and works identically.

- [ ] **Step 14: Commit**

```bash
git add admin-frontend/src/pages/inventory/InventoryPage.tsx
git rm -r admin-frontend/src/pages/inventory/hooks
git commit -m "inventory: delete dead useInventoryState hook, fix pre-existing type errors and the broken Receive Stock modal"
```

---

### Task 3: Expand mock data to 128 realistic items + richer POs/movements/waste/AI data

**Files:**
- Modify: `admin-frontend/src/pages/inventory/mockData.ts`

**Interfaces:**
- Consumes: `InventoryItem`, `InventoryBatch`, `PurchaseOrder`, `PurchaseOrderItem`, `Supplier`, `StockMovement`, `InventoryTransfer` from `./types`; `getStockStatus` from `./utils/inventoryStatus` (Task 1).
- Produces (used by later tasks):
  - `initialItems: InventoryItem[]` — grows from 60 to 128, keeps the 14 hand-written seed items (`inv-1`..`inv-14`) byte-for-byte (zero regression), replaces the generic `${category} Ingredient #${i}` loop with a realistic named catalog.
  - `categories: string[]`, `suppliersList: string[]`, `units: Record<string, string>` — now exported (were module-local), so `InventoryPage.tsx` can delete its own duplicate `categories` const (Task 16).
  - `kpiSparklines: Record<string, number[]>` — NEW, keyed by KPI card id (`'inventoryValue' | 'accuracy' | 'receipts' | 'consumption' | 'waste' | 'adjustments' | 'turns'`), each a 7-point series, consumed by Task 5's `MetricsKPI`.
  - `aiInsights: string[]` — NEW, 4 sentences derived from real generated data, consumed by Task 15's `AIAssistantCard`.
  - `wasteSummary: { today: number; thisWeek: number; topItems: { name: string; amount: number }[] }` — NEW, consumed by Task 15's `WasteTrackingCard` (replaces the old hardcoded widget values, resolving Global-Constraints bug #5).
  - `initialPurchaseOrders` grows from 5 to 14, with at least 6 in a receivable state (`Sent`/`Partially Received`) so Task 12's Receiving tab has real content to show.
  - `initialTransfers` grows from 2 to 8 sample `InventoryTransfer` records (varied `status`), consumed by Task 14.

- [ ] **Step 1: Replace the local `categories`/`suppliersList`/`units` consts with exported ones, and add a realistic named-item catalog**

Find (near the top of `mockData.ts`, just before the generator loop):
```typescript
const categories = ['Raw Meat', 'Oils & Fats', 'Bakery', 'Dairy', 'Vegetables', 'Dry Goods', 'Beverages', 'Packaging'];
const suppliersList = ['Fresh Foods Ltd', 'Bakery Co.', 'Mediterranean Imports', 'Dairy Fresh', 'Green Valley'];
const units: Record<string, string> = {
  'Raw Meat': 'kg', 'Oils & Fats': 'bottles', 'Bakery': 'units', 'Dairy': 'tubs',
  'Vegetables': 'kg', 'Dry Goods': 'bags', 'Beverages': 'cases', 'Packaging': 'cases'
};
```
Replace with:
```typescript
export const categories = ['Raw Meat', 'Oils & Fats', 'Bakery', 'Dairy', 'Vegetables', 'Dry Goods', 'Beverages', 'Packaging'];
export const suppliersList = [
  'Fresh Foods Ltd', 'Bakery Co.', 'Mediterranean Imports', 'Dairy Fresh', 'Green Valley',
  'Ocean Harvest Seafood', 'Golden Valley Poultry'
];
export const units: Record<string, string> = {
  'Raw Meat': 'kg', 'Oils & Fats': 'bottles', 'Bakery': 'units', 'Dairy': 'tubs',
  'Vegetables': 'kg', 'Dry Goods': 'bags', 'Beverages': 'cases', 'Packaging': 'cases'
};

// Which suppliers plausibly carry which category (a bakery supplier doesn't sell meat).
const supplierCategories: Record<string, string[]> = {
  'Fresh Foods Ltd': ['Raw Meat', 'Vegetables'],
  'Bakery Co.': ['Bakery', 'Dry Goods'],
  'Mediterranean Imports': ['Oils & Fats', 'Dry Goods', 'Beverages'],
  'Dairy Fresh': ['Dairy'],
  'Green Valley': ['Vegetables', 'Dry Goods'],
  'Ocean Harvest Seafood': ['Raw Meat'],
  'Golden Valley Poultry': ['Raw Meat', 'Packaging']
};

// Per-supplier lead time, reused consistently across that supplier's items and its POs.
export const supplierLeadTimeDays: Record<string, number> = {
  'Fresh Foods Ltd': 2, 'Bakery Co.': 1, 'Mediterranean Imports': 5, 'Dairy Fresh': 2,
  'Green Valley': 3, 'Ocean Harvest Seafood': 2, 'Golden Valley Poultry': 3
};

function supplierForCategory(category: string, seed: number): string {
  const eligible = suppliersList.filter(s => supplierCategories[s]?.includes(category));
  const pool = eligible.length > 0 ? eligible : suppliersList;
  return pool[seed % pool.length] ?? suppliersList[0]!;
}

// Realistic per-category item names (short-dated categories get shorter expiry windows below).
const catalogNames: Record<string, string[]> = {
  'Raw Meat': [
    'Chicken Thigh', 'Chicken Wings', 'Lamb Rack', 'Beef Tenderloin', 'Beef Ribeye',
    'Beef Ground', 'Pork Belly', 'Pork Chops', 'Turkey Breast', 'Duck Breast',
    'Veal Cutlet', 'Bacon Strips', 'Sausage Links', 'Beef Short Rib', 'Salmon Fillet', 'Prawns Jumbo'
  ],
  'Oils & Fats': [
    'Olive Oil Light', 'Sunflower Oil', 'Canola Oil', 'Sesame Oil', 'Truffle Oil',
    'Butter Unsalted', 'Butter Salted', 'Ghee Clarified', 'Coconut Oil', 'Duck Fat',
    'Lard', 'Vegetable Shortening', 'Peanut Oil'
  ],
  'Bakery': [
    'Sourdough Loaf', 'Baguette', 'Brioche Buns', 'Ciabatta Roll', 'Focaccia',
    'Croissants', 'Bagels', 'Naan Bread', 'Dinner Rolls', 'Rye Bread',
    'Multigrain Loaf', 'Tortilla Wraps', 'Puff Pastry Sheets'
  ],
  'Dairy': [
    'Whole Milk', 'Heavy Cream', 'Sour Cream', 'Cream Cheese', 'Cheddar Cheese',
    'Parmesan Wedge', 'Feta Cheese', 'Ricotta Cheese', 'Buttermilk', 'Condensed Milk',
    'Blue Cheese', 'Goat Cheese'
  ],
  'Vegetables': [
    'Onions', 'Garlic', 'Bell Peppers', 'Cucumbers', 'Carrots',
    'Potatoes', 'Sweet Potatoes', 'Spinach', 'Lettuce Romaine', 'Broccoli',
    'Cauliflower', 'Zucchini', 'Mushrooms', 'Avocados Hass', 'Eggplant'
  ],
  'Dry Goods': [
    'Jasmine Rice', 'All-Purpose Flour', 'Bread Flour', 'Sugar Granulated', 'Brown Sugar',
    'Salt Fine', 'Black Pepper Ground', 'Pasta Penne', 'Pasta Spaghetti', 'Lentils Red',
    'Chickpeas Dried', 'Quinoa', 'Rolled Oats'
  ],
  'Beverages': [
    'Sparkling Water', 'Still Water', 'Cola Classic', 'Ginger Ale', 'Orange Juice',
    'Apple Juice', 'House Red Wine', 'House White Wine', 'Craft Lager', 'IPA Beer',
    'Espresso Beans', 'Green Tea Bags', 'Tonic Water', 'Cranberry Juice'
  ],
  'Packaging': [
    'Takeout Containers', 'Paper Bags', 'Napkins Cocktail', 'Straws Paper', 'Foil Sheets',
    'Cling Wrap', 'To-Go Cups 12oz', 'To-Go Cups 16oz', 'Cutlery Sets', 'Pizza Boxes',
    'Deli Containers', 'Parchment Paper', 'Trash Bags', 'Gloves Nitrile'
  ]
};

// Shorter shelf life for perishables, longer for pantry/packaging.
const expiryWindowDays: Record<string, [number, number]> = {
  'Raw Meat': [3, 10], 'Dairy': [5, 21], 'Bakery': [2, 7], 'Vegetables': [4, 14],
  'Oils & Fats': [60, 365], 'Dry Goods': [90, 540], 'Beverages': [120, 365], 'Packaging': [0, 0]
};
```

- [ ] **Step 2: Replace the 46-item placeholder-name generator loop with a 114-item realistic generator (reaching 128 total with the 14 hand-written seeds)**

Find:
```typescript
for (let i = 15; i <= 60; i++) {
  const category = categories[i % categories.length];
  const supplier = suppliersList[i % suppliersList.length];
  const unit = units[category] || 'units';
  const sku = `${category.substring(0, 3).toUpperCase()}-${100 + i}`;
  const cost = Number((5.5 + (i * 0.75)).toFixed(2));
  const min = 10 + (i % 4) * 10;
  const max = min * 3;
  const onHand = i % 7 === 0 ? 0 : (i % 4 === 0 ? Math.floor(min * 0.5) : min + 15);
  const avgUsage = 2 + (i % 6);
  const daysLeft = onHand > 0 ? Math.ceil(onHand / avgUsage) : 0;
  
  let status: 'Zero Stock' | 'Low Stock' | 'Healthy' = 'Healthy';
  if (onHand === 0) status = 'Zero Stock';
  else if (onHand < min) status = 'Low Stock';

  const batchNum = `${category.substring(0, 3).toUpperCase()}-B${i}`;
  const expiry = new Date(Date.now() + (10 + (i % 15)) * 24 * 60 * 60 * 1000).toISOString().substring(0, 10);

  initialItems.push({
    id: `inv-${i}`,
    name: `${category} Ingredient #${i}`,
    sku,
    category,
    supplier,
    venue: i % 3 === 0 ? 'Main Kitchen' : (i % 3 === 1 ? 'Bar Lounge' : 'All Venues'),
    onHand,
    min,
    max,
    unit,
    daysLeft,
    avgUsage,
    cost,
    status,
    updated: `${i} mins ago`,
    batches: onHand > 0 ? [{
      id: `b-rand-${i}`,
      batchNumber: batchNum,
      supplier,
      receivedDate: '2026-06-28',
      expiryDate: expiry,
      quantity: onHand
    }] : [],
    batchNumber: onHand > 0 ? batchNum : undefined,
    expiryDate: onHand > 0 ? expiry : undefined
  });
}
```
Replace with:
```typescript
// Flatten the catalog into one ordered list of (name, category) pairs, skipping any
// name that collides with a hand-written seed item (inv-1..inv-14) above.
const seedNames = new Set(initialItems.map(it => it.name));
const catalogEntries: { name: string; category: string }[] = [];
for (const category of categories) {
  for (const name of catalogNames[category] ?? []) {
    if (!seedNames.has(name)) catalogEntries.push({ name, category });
  }
}

const skuCounters: Record<string, number> = {};
let genIndex = 15;
for (const { name, category } of catalogEntries) {
  if (genIndex > 128) break;
  const i = genIndex++;

  const supplier = supplierForCategory(category, i);
  const unit = units[category] || 'units';

  const prefix = category.substring(0, 3).toUpperCase();
  skuCounters[prefix] = (skuCounters[prefix] || 0) + 1;
  const sku = `${prefix}-${100 + skuCounters[prefix]}`;

  const cost = Number((2 + ((i * 37) % 45)).toFixed(2));
  const min = 10 + (i % 5) * 8;
  const max = min * (2 + (i % 3));
  const avgUsage = 2 + (i % 9);

  // Long-tail stock distribution: mostly Healthy, a minority Low/Critical, a few Zero.
  const roll = i % 10;
  let onHand: number;
  if (roll === 0) onHand = 0; // ~10% Zero Stock
  else if (roll <= 2) onHand = Math.floor(min * 0.2); // ~20% Critical
  else if (roll <= 4) onHand = Math.floor(min * 0.7); // ~20% Low Stock
  else onHand = min + (i % 5) * 12; // ~50% Healthy

  const daysLeft = onHand > 0 ? Math.ceil(onHand / avgUsage) : 0;

  const [minWindow, maxWindow] = expiryWindowDays[category] ?? [30, 90];
  const hasExpiry = maxWindow > 0;
  const expiryOffset = minWindow + (i % Math.max(1, maxWindow - minWindow + 1));
  const expiry = hasExpiry
    ? new Date(Date.now() + expiryOffset * 24 * 60 * 60 * 1000).toISOString().substring(0, 10)
    : undefined;

  const batchNum = `${prefix}-B${i}`;
  const venue = i % 11 === 0 ? 'Main Kitchen' : (i % 13 === 0 ? 'Bar Lounge' : 'All Venues');

  const draftItem: InventoryItem = {
    id: `inv-${i}`,
    name,
    sku,
    category,
    supplier,
    venue,
    onHand,
    min,
    max,
    unit,
    daysLeft,
    avgUsage,
    cost,
    status: 'Healthy', // placeholder, overwritten below via getStockStatus for consistency
    updated: `${(i % 55) + 1} mins ago`,
    batches: onHand > 0 ? [{
      id: `b-rand-${i}`,
      batchNumber: batchNum,
      supplier,
      receivedDate: '2026-06-28',
      expiryDate: expiry ?? '2027-01-01',
      quantity: onHand
    }] : [],
    batchNumber: onHand > 0 ? batchNum : undefined,
    expiryDate: onHand > 0 ? expiry : undefined
  };
  // getStockStatus's return type (StockStatus) is a subset of InventoryItem['status'], so this assigns directly.
  draftItem.status = getStockStatus(draftItem);
  initialItems.push(draftItem);
}
```

Add the import at the top of `mockData.ts` (find the existing import line and extend it):
Find:
```typescript
import { InventoryItem, PurchaseOrder, Supplier, StockMovement, Recipe, StocktakeRecord, InventoryTransfer } from './types';
```
Replace with:
```typescript
import { InventoryItem, InventoryBatch, PurchaseOrder, PurchaseOrderItem, Supplier, StockMovement, Recipe, StocktakeRecord, InventoryTransfer } from './types';
import { getStockStatus } from './utils/inventoryStatus';
```

- [ ] **Step 3: Add the 7-point KPI sparkline series and AI insights, derived from the now-128-item dataset**

Add after the `initialItems` array closes (before `initialPurchaseOrders`):
```typescript
export const kpiSparklines: Record<string, number[]> = {
  inventoryValue: [68200, 69100, 70400, 71000, 72300, 73100, 73900.50],
  accuracy: [97.1, 97.4, 97.8, 98.0, 98.2, 98.5, 98.7],
  receipts: [4200, 3900, 5100, 4700, 6100, 5800, 6680.00],
  consumption: [3600, 3800, 3950, 3700, 4050, 4100, 4215.30],
  waste: [210, 195, 240, 180, 220, 165, 186.40],
  adjustments: [38, 42, 35, 40, 44, 41, 45],
  turns: [3.8, 3.9, 4.0, 4.0, 4.1, 4.1, 4.2]
};

const criticalItem = initialItems.find(it => getStockStatus(it) === 'Critical');
const lowStockItems = initialItems.filter(it => getStockStatus(it) === 'Low Stock');

export const aiInsights: string[] = [
  criticalItem
    ? `You're likely to run out of ${criticalItem.name} in ${criticalItem.daysLeft} day${criticalItem.daysLeft === 1 ? '' : 's'}.`
    : 'All items are currently within healthy stock levels.',
  lowStockItems.length > 0
    ? `Consider ordering ${lowStockItems[0]!.max - lowStockItems[0]!.onHand} ${lowStockItems[0]!.unit} of ${lowStockItems[0]!.name} to reach par level.`
    : 'No items are currently below their reorder point.',
  'Olive Oil prices increased 8% this month.',
  'Based on upcoming reservations, you may need 20 kg more lamb this weekend.'
];

export const wasteSummary = {
  today: 186.40,
  thisWeek: 912.30,
  topItems: [
    { name: 'Chicken Breast', amount: 68.40 },
    { name: 'Tomatoes', amount: 36.20 },
    { name: 'Greek Yogurt', amount: 24.10 }
  ]
};
```

- [ ] **Step 4: Expand `initialPurchaseOrders` from 5 to 14, weighted toward receivable statuses**

Find the closing of `initialPurchaseOrders` (locate the array's final `];` around what was line 501 before this task's edits) and, immediately before that closing `];`, insert 9 more orders:
```typescript
  {
    id: 'po-6', orderNumber: 'PO-2026-006', supplier: 'Ocean Harvest Seafood', itemsCount: 2, totalAmount: 640.00,
    status: 'Sent', orderDate: '2026-06-30', deliveryDate: '2026-07-03',
    items: [
      { productId: '', name: 'Salmon Fillet', expectedQty: 30, receivedQty: 0, rejectedQty: 0, damagedQty: 0, unit: 'kg', cost: 14.00 },
      { productId: '', name: 'Prawns Jumbo', expectedQty: 15, receivedQty: 0, rejectedQty: 0, damagedQty: 0, unit: 'kg', cost: 13.60 }
    ]
  },
  {
    id: 'po-7', orderNumber: 'PO-2026-007', supplier: 'Golden Valley Poultry', itemsCount: 1, totalAmount: 960.00,
    status: 'Partially Received', orderDate: '2026-06-29', deliveryDate: '2026-07-02',
    items: [{ productId: '', name: 'Chicken Thigh', expectedQty: 120, receivedQty: 60, rejectedQty: 0, damagedQty: 0, unit: 'kg', cost: 8.00 }]
  },
  {
    id: 'po-8', orderNumber: 'PO-2026-008', supplier: 'Bakery Co.', itemsCount: 3, totalAmount: 210.00,
    status: 'Sent', orderDate: '2026-07-01', deliveryDate: '2026-07-04',
    items: [
      { productId: '', name: 'Sourdough Loaf', expectedQty: 40, receivedQty: 0, rejectedQty: 0, damagedQty: 0, unit: 'units', cost: 3.50 },
      { productId: '', name: 'Bagels', expectedQty: 60, receivedQty: 0, rejectedQty: 0, damagedQty: 0, unit: 'units', cost: 1.00 },
      { productId: '', name: 'Croissants', expectedQty: 40, receivedQty: 0, rejectedQty: 0, damagedQty: 0, unit: 'units', cost: 1.25 }
    ]
  },
  {
    id: 'po-9', orderNumber: 'PO-2026-009', supplier: 'Mediterranean Imports', itemsCount: 1, totalAmount: 486.00,
    status: 'Sent', orderDate: '2026-06-28', deliveryDate: '2026-07-01',
    items: [{ productId: '', name: 'Olive Oil Extra Virgin', expectedQty: 30, receivedQty: 0, rejectedQty: 0, damagedQty: 0, unit: 'bottles', cost: 16.20 }]
  },
  {
    id: 'po-10', orderNumber: 'PO-2026-010', supplier: 'Dairy Fresh', itemsCount: 2, totalAmount: 356.00,
    status: 'Partially Received', orderDate: '2026-06-30', deliveryDate: '2026-07-03',
    items: [
      { productId: '', name: 'Whole Milk', expectedQty: 80, receivedQty: 50, rejectedQty: 0, damagedQty: 0, unit: 'tubs', cost: 2.20 },
      { productId: '', name: 'Cheddar Cheese', expectedQty: 20, receivedQty: 20, rejectedQty: 0, damagedQty: 0, unit: 'tubs', cost: 9.00 }
    ]
  },
  {
    id: 'po-11', orderNumber: 'PO-2026-011', supplier: 'Green Valley', itemsCount: 4, totalAmount: 512.00,
    status: 'Draft', orderDate: '2026-07-02', deliveryDate: '2026-07-06',
    items: [
      { productId: '', name: 'Onions', expectedQty: 100, receivedQty: 0, rejectedQty: 0, damagedQty: 0, unit: 'kg', cost: 1.20 },
      { productId: '', name: 'Carrots', expectedQty: 80, receivedQty: 0, rejectedQty: 0, damagedQty: 0, unit: 'kg', cost: 1.50 },
      { productId: '', name: 'Potatoes', expectedQty: 120, receivedQty: 0, rejectedQty: 0, damagedQty: 0, unit: 'kg', cost: 1.10 },
      { productId: '', name: 'Garlic', expectedQty: 20, receivedQty: 0, rejectedQty: 0, damagedQty: 0, unit: 'kg', cost: 5.20 }
    ]
  },
  {
    id: 'po-12', orderNumber: 'PO-2026-012', supplier: 'Fresh Foods Ltd', itemsCount: 1, totalAmount: 1400.00,
    status: 'Fully Received', orderDate: '2026-06-20', deliveryDate: '2026-06-23',
    items: [{ productId: '', name: 'Beef Tenderloin', expectedQty: 40, receivedQty: 40, rejectedQty: 0, damagedQty: 0, unit: 'kg', cost: 35.00 }]
  },
  {
    id: 'po-13', orderNumber: 'PO-2026-013', supplier: 'Mediterranean Imports', itemsCount: 2, totalAmount: 640.00,
    status: 'Approved', orderDate: '2026-07-02', deliveryDate: '2026-07-07',
    items: [
      { productId: '', name: 'Jasmine Rice', expectedQty: 200, receivedQty: 0, rejectedQty: 0, damagedQty: 0, unit: 'bags', cost: 2.20 },
      { productId: '', name: 'Chickpeas Dried', expectedQty: 60, receivedQty: 0, rejectedQty: 0, damagedQty: 0, unit: 'bags', cost: 3.00 }
    ]
  },
  {
    id: 'po-14', orderNumber: 'PO-2026-014', supplier: 'Bakery Co.', itemsCount: 1, totalAmount: 180.00,
    status: 'Cancelled', orderDate: '2026-06-25', deliveryDate: '2026-06-28',
    items: [{ productId: '', name: 'Baguette', expectedQty: 60, receivedQty: 0, rejectedQty: 0, damagedQty: 0, unit: 'units', cost: 3.00 }]
  }
```

- [ ] **Step 5: Expand `initialSuppliers` with the 2 new suppliers, and `initialTransfers` from 2 to 8 records**

Immediately before `initialSuppliers`'s closing `];`, insert:
```typescript
  {
    id: 'sup-6', name: 'Ocean Harvest Seafood', onTimeRate: 94, leadTimeDays: 2, trend: 'stable',
    contact: 'Maria Chen', phone: '+1 555-0143', email: 'maria@oceanharvest.com', category: 'Raw Meat',
    purchaseOrdersCount: 12, receivingHistoryCount: 11, averageDeliveryTime: 2.1, deliveryAccuracy: 93, lateDeliveries: 1, outstandingOrders: 1, preferred: false,
    priceTrends: [{ month: 'April', changePercent: 2.1 }, { month: 'May', changePercent: 1.5 }, { month: 'June', changePercent: -0.5 }]
  },
  {
    id: 'sup-7', name: 'Golden Valley Poultry', onTimeRate: 96, leadTimeDays: 3, trend: 'up',
    contact: 'Tom Reyes', phone: '+1 555-0177', email: 'tom@goldenvalley.com', category: 'Raw Meat',
    purchaseOrdersCount: 19, receivingHistoryCount: 18, averageDeliveryTime: 2.9, deliveryAccuracy: 95, lateDeliveries: 1, outstandingOrders: 1, preferred: true,
    priceTrends: [{ month: 'April', changePercent: 0.8 }, { month: 'May', changePercent: 1.1 }, { month: 'June', changePercent: 0.4 }]
  }
```

Immediately before `initialTransfers`'s closing `];`, insert:
```typescript
  {
    id: 'trsf-3', transferNumber: 'TRSF-003', fromVenue: 'Main Kitchen', toVenue: 'v2', status: 'Received', date: '2026-06-30',
    items: [{ productId: 'inv-1', name: 'Chicken Breast', quantity: 10, unit: 'kg', cost: 12.50 }], notes: 'Stock balancing.'
  },
  {
    id: 'trsf-4', transferNumber: 'TRSF-004', fromVenue: 'v3', toVenue: 'All Venues', status: 'Pending', date: '2026-07-01',
    items: [{ productId: 'inv-3', name: 'Olive Oil Extra Virgin', quantity: 5, unit: 'bottles', cost: 16.20 }]
  },
  {
    id: 'trsf-5', transferNumber: 'TRSF-005', fromVenue: 'Main Kitchen', toVenue: 'Bar Lounge', status: 'Received', date: '2026-06-29',
    items: [{ productId: 'inv-2', name: 'Lamb Shank', quantity: 6, unit: 'kg', cost: 18.90 }]
  },
  {
    id: 'trsf-6', transferNumber: 'TRSF-006', fromVenue: 'v2', toVenue: 'v3', status: 'Rejected', date: '2026-06-27',
    items: [{ productId: 'inv-8', name: 'Mozzarella Cheese', quantity: 8, unit: 'kg', cost: 9.20 }], notes: 'Temperature excursion during transit.'
  },
  {
    id: 'trsf-7', transferNumber: 'TRSF-007', fromVenue: 'All Venues', toVenue: 'Main Kitchen', status: 'Pending', date: '2026-07-02',
    items: [{ productId: 'inv-4', name: 'Basmati Rice 20kg', quantity: 20, unit: 'bags', cost: 42.00 }]
  },
  {
    id: 'trsf-8', transferNumber: 'TRSF-008', fromVenue: 'v3', toVenue: 'Main Kitchen', status: 'Received', date: '2026-06-26',
    items: [{ productId: 'inv-7', name: 'Tomatoes', quantity: 15, unit: 'kg', cost: 2.60 }]
  }
```

- [ ] **Step 6: Typecheck**

Run: `cd admin-frontend && npm run typecheck`
Expected: `mockData.ts`'s 6 errors are gone. Confirm with:
```bash
npm run typecheck 2>&1 | grep -c "error TS"
```
Expected output: `3` (only the deferred Stock-Movements-tab literal-type errors remain, fixed in Task 13).

- [ ] **Step 7: Manual smoke check**

Run: `npm run dev`, open Inventory tab, confirm pagination footer reads "Showing 1 to 10 of 128 items" and page controls go up to page 13 (128 / 10 = 12.8 → 13 pages), confirm item names are all realistic (no "`Vegetables Ingredient #23`"-style placeholders), confirm SKUs follow the `XXX-1NN` pattern with no duplicates.

- [ ] **Step 8: Commit**

```bash
git add admin-frontend/src/pages/inventory/mockData.ts
git commit -m "inventory: expand mock data to 128 realistic items, richer POs/suppliers/transfers, KPI sparklines, AI insights"
```

---

### Task 4: Operations Inbox derived-metrics helper (`utils/operationsInbox.ts`)

This is the single source of truth for the 7 Operations Inbox figures (POs to Receive, Deliveries Today, Critical Stock, Expiring Soon, Stocktakes Due, High Waste (7d), Variances). Three later components (Task 8's `MetricsInbox`, Task 17's `OperationsInboxDetailed`, Task 16's `AlertsTab`) all read from this one function instead of each re-deriving their own counts — this is what fixes Global-Constraints bug #5 (hardcoded/inconsistent sidebar numbers) at the root.

**Files:**
- Create: `admin-frontend/src/pages/inventory/utils/operationsInbox.ts`

**Interfaces:**
- Consumes: `InventoryItem`, `PurchaseOrder`, `StockMovement`, `StocktakeRecord` from `../types`; `getStockStatus`, `isReceivable` from `./inventoryStatus` (Task 1).
- Produces:
  ```typescript
  export interface OperationsInboxMetrics {
    posToReceive: { count: number; totalAmount: number };
    deliveriesToday: { count: number; overdueCount: number };
    criticalStock: { count: number; items: InventoryItem[] };
    expiringSoon: { count: number; items: InventoryItem[] };
    stocktakesDue: { count: number };
    highWaste7d: { amount: number };
    variances: { count: number; totalAmount: number };
  }
  export function computeOperationsInboxMetrics(args: {
    items: InventoryItem[];
    purchaseOrders: PurchaseOrder[];
    stockMovements: StockMovement[];
    stocktakes: StocktakeRecord[];
    today?: Date;
  }): OperationsInboxMetrics
  ```

- [ ] **Step 1: Write the helper module**

```typescript
// admin-frontend/src/pages/inventory/utils/operationsInbox.ts
import type { InventoryItem, PurchaseOrder, StockMovement, StocktakeRecord } from '../types';
import { getStockStatus, isReceivable } from './inventoryStatus';

export interface OperationsInboxMetrics {
  posToReceive: { count: number; totalAmount: number };
  deliveriesToday: { count: number; overdueCount: number };
  criticalStock: { count: number; items: InventoryItem[] };
  expiringSoon: { count: number; items: InventoryItem[] };
  stocktakesDue: { count: number };
  highWaste7d: { amount: number };
  variances: { count: number; totalAmount: number };
}

export function computeOperationsInboxMetrics(args: {
  items: InventoryItem[];
  purchaseOrders: PurchaseOrder[];
  stockMovements: StockMovement[];
  stocktakes: StocktakeRecord[];
  today?: Date;
}): OperationsInboxMetrics {
  const { items, purchaseOrders, stockMovements, stocktakes } = args;
  const today = args.today ?? new Date();
  const todayStr = today.toISOString().substring(0, 10);
  const sevenDaysAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);

  const receivablePOs = purchaseOrders.filter(isReceivable);
  const posToReceive = {
    count: receivablePOs.length,
    totalAmount: receivablePOs.reduce((sum, po) => sum + po.totalAmount, 0)
  };

  const deliveriesTodayPOs = purchaseOrders.filter(po => po.deliveryDate === todayStr && isReceivable(po));
  const overduePOs = purchaseOrders.filter(po => po.deliveryDate < todayStr && isReceivable(po));
  const deliveriesToday = { count: deliveriesTodayPOs.length, overdueCount: overduePOs.length };

  const criticalItems = items.filter(it => getStockStatus(it, today) === 'Critical' || getStockStatus(it, today) === 'Zero Stock');
  const criticalStock = { count: criticalItems.length, items: criticalItems };

  const expiringItems = items.filter(it => {
    if (!it.expiryDate) return false;
    const diffDays = Math.ceil((new Date(it.expiryDate).getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    return diffDays >= 0 && diffDays <= 7;
  });
  const expiringSoon = { count: expiringItems.length, items: expiringItems };

  const stocktakesDue = { count: stocktakes.filter(st => st.status === 'In Progress').length };

  const highWaste7d = {
    amount: stockMovements
      .filter(m => m.type === 'SCRAP' && new Date(m.date).getTime() >= sevenDaysAgo.getTime())
      .reduce((sum, m) => sum + Math.abs(m.value), 0)
  };

  const varianceItems = items.filter(it => (it.varianceQty ?? 0) !== 0);
  const variances = {
    count: varianceItems.length,
    totalAmount: varianceItems.reduce((sum, it) => sum + Math.abs(it.varianceCost ?? 0), 0)
  };

  return { posToReceive, deliveriesToday, criticalStock, expiringSoon, stocktakesDue, highWaste7d, variances };
}
```

- [ ] **Step 2: Typecheck**

Run: `cd admin-frontend && npm run typecheck`
Expected: still `3` (this new file is isolated and self-consistent, no new errors).

- [ ] **Step 3: Commit**

```bash
git add admin-frontend/src/pages/inventory/utils/operationsInbox.ts
git commit -m "inventory: add single-source-of-truth Operations Inbox metrics helper"
```

---

### Task 5: `Sparkline` component

**Files:**
- Create: `admin-frontend/src/pages/inventory/components/Sparkline.tsx`

**Interfaces:**
- Consumes: nothing beyond its own props.
- Produces: `<Sparkline values={number[]} trend={'up'|'down'} className?={string} />`, used by Task 7's `MetricsKPI`.

- [ ] **Step 1: Write the component**

```typescript
// admin-frontend/src/pages/inventory/components/Sparkline.tsx
interface SparklineProps {
  values: number[];
  trend: 'up' | 'down';
  className?: string;
}

export function Sparkline({ values, trend, className = '' }: SparklineProps) {
  if (values.length < 2) return null;

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const width = 50;
  const height = 20;
  const step = width / (values.length - 1);

  const points = values.map((v, i) => {
    const x = i * step;
    const y = height - ((v - min) / range) * height;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  const color = trend === 'up' ? 'text-emerald-500' : 'text-red-500';

  return (
    <svg
      className={`w-12 h-6 ${color} ${className}`}
      viewBox={`0 0 ${width} ${height}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    >
      <polyline points={points.join(' ')} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `cd admin-frontend && npm run typecheck`
Expected: still `3`.

- [ ] **Step 3: Commit**

```bash
git add admin-frontend/src/pages/inventory/components/Sparkline.tsx
git commit -m "inventory: add Sparkline component"
```

---

### Task 6: Extract `Icon` component + build `CommandBar`

Every remaining new component needs the existing hand-rolled `Icon` switch-component (currently defined inline in `InventoryPage.tsx:7-157`, 18 cases: `plus, receive, order, stocktake, export, search, filter, arrow-up, arrow-down, clock, alert, trash, truck, assistant, check, cross, chevron-down, cart`, plus a default empty-circle case). This task extracts it verbatim into its own file (adding one new `'transfer'` case for the new Transfer Stock button), so it becomes an importable, shared component instead of a page-local one.

**Files:**
- Create: `admin-frontend/src/pages/inventory/components/Icon.tsx`
- Create: `admin-frontend/src/pages/inventory/components/CommandBar.tsx`
- Modify: `admin-frontend/src/pages/inventory/InventoryPage.tsx:7-157` (delete, replace with import)

**Interfaces:**
- Produces: `<Icon name={string} className?={string} size?={number} />` (unchanged signature, now importable); `<CommandBar onReceiveGoods onQuickReceive onPurchaseOrder onStockAdjustment onRecordWaste onStocktake onTransferStock onNewItem onExport: () => void />`.

- [ ] **Step 1: Move `Icon` out of `InventoryPage.tsx` verbatim**

In `InventoryPage.tsx`, cut lines 7-157 (the entire `IconProps` interface and `Icon` function, from the `// ── SVG Icon Helper ──` comment through its closing `}`) exactly as they are today — every existing `case` and its SVG path unchanged. Paste that cut content into a new file `admin-frontend/src/pages/inventory/components/Icon.tsx`, adding `export` to both the interface and the function declaration, and add one new case to the existing `switch (name)` block (insert alongside the other `case` arms, matching the existing code's SVG style — e.g. next to the `'truck'` case):

```typescript
    case 'transfer':
      return (
        <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path strokeLinecap="round" strokeLinejoin="round" d="M8 7h11m0 0l-4-4m4 4l-4 4M16 17H5m0 0l4 4m-4-4l4-4" />
        </svg>
      );
```

In `InventoryPage.tsx`, where those lines used to be, add:
```typescript
import { Icon } from './components/Icon';
```

- [ ] **Step 2: Write `CommandBar`**

```typescript
// admin-frontend/src/pages/inventory/components/CommandBar.tsx
import { Icon } from './Icon';
import { useState } from 'react';

interface CommandBarProps {
  onReceiveGoods: () => void;
  onQuickReceive: () => void;
  onPurchaseOrder: () => void;
  onStockAdjustment: () => void;
  onRecordWaste: () => void;
  onStocktake: () => void;
  onTransferStock: () => void;
  onNewItem: () => void;
  onExport: () => void;
}

const buttonClass =
  'border border-emerald-600 text-emerald-600 hover:bg-emerald-50 bg-white rounded-lg px-3 py-1.5 text-xs font-semibold flex items-center gap-1.5 transition-colors';

export function CommandBar({
  onReceiveGoods,
  onQuickReceive,
  onPurchaseOrder,
  onStockAdjustment,
  onRecordWaste,
  onStocktake,
  onTransferStock,
  onNewItem,
  onExport
}: CommandBarProps) {
  const [moreOpen, setMoreOpen] = useState(false);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button onClick={onReceiveGoods} className={buttonClass}>
        <Icon name="receive" size={14} />
        <span>Receive Goods</span>
      </button>
      <button onClick={onQuickReceive} className={buttonClass}>
        <Icon name="receive" size={14} />
        <span>Quick Receive</span>
      </button>
      <button onClick={onPurchaseOrder} className={buttonClass}>
        <Icon name="order" size={14} />
        <span>Purchase Order</span>
      </button>
      <button onClick={onStockAdjustment} className={buttonClass}>
        <Icon name="alert" size={14} />
        <span>Stock Adjustment</span>
      </button>
      <button onClick={onRecordWaste} className={buttonClass}>
        <Icon name="trash" size={14} />
        <span>Record Waste</span>
      </button>
      <button onClick={onStocktake} className={buttonClass}>
        <Icon name="stocktake" size={14} />
        <span>Stocktake</span>
      </button>
      <button onClick={onTransferStock} className={buttonClass}>
        <Icon name="transfer" size={14} />
        <span>Transfer Stock</span>
      </button>

      <div className="relative">
        <button onClick={() => setMoreOpen(o => !o)} className={buttonClass}>
          <span>More</span>
          <Icon name="chevron-down" size={12} />
        </button>
        {moreOpen && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setMoreOpen(false)} />
            <div className="absolute right-0 mt-1 w-40 rounded-lg bg-white shadow-lg border border-gray-200 py-1.5 z-20 text-left text-xs font-semibold">
              <button
                onClick={() => { setMoreOpen(false); onNewItem(); }}
                className="w-full text-left px-3 py-1.5 hover:bg-emerald-50 hover:text-emerald-700 transition-colors flex items-center gap-2 text-gray-700"
              >
                <Icon name="plus" size={12} />
                <span>New Item</span>
              </button>
              <button
                onClick={() => { setMoreOpen(false); onExport(); }}
                className="w-full text-left px-3 py-1.5 hover:bg-emerald-50 hover:text-emerald-700 transition-colors flex items-center gap-2 text-gray-700"
              >
                <Icon name="export" size={12} />
                <span>Export</span>
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Typecheck**

Run: `cd admin-frontend && npm run typecheck`
Expected: still `3` remaining (the deferred Task 13 errors) — `InventoryPage.tsx` still compiles since `Icon` is now imported with an identical signature, and `CommandBar`/`Icon.tsx` are new, self-contained files. `CommandBar` isn't wired into the page's JSX yet (that's Task 18) — it existing unused is fine, it's a plain exported function component.

- [ ] **Step 4: Manual smoke check**

Run: `npm run dev`, open the Inventory page, confirm it still renders exactly as before (the `Icon` import swap must be behavior-invisible — same icons render everywhere they did before).

- [ ] **Step 5: Commit**

```bash
git add admin-frontend/src/pages/inventory/components/Icon.tsx admin-frontend/src/pages/inventory/components/CommandBar.tsx admin-frontend/src/pages/inventory/InventoryPage.tsx
git commit -m "inventory: extract Icon component, add CommandBar"
```

---

### Task 7: `MetricsKPI` (KPI/sparkline row) + 3 new derived values in `InventoryPage.tsx`

The component is purely presentational (takes pre-computed card data); this task also adds the 3 derived values `InventoryPage.tsx` doesn't compute yet (`todaysConsumptionValue`, `inventoryAccuracyPercent`, `inventoryTurns30d`), alongside the existing `calculatedValue`/`todaysReceiptsValue`/`todaysWasteValue`/`todaysAdjustmentsCount`.

**Files:**
- Create: `admin-frontend/src/pages/inventory/components/MetricsKPI.tsx`
- Modify: `admin-frontend/src/pages/inventory/InventoryPage.tsx` (add 3 `useMemo`s near the existing KPI calculations, ~line 993)

**Interfaces:**
- Consumes: `Sparkline` (Task 5).
- Produces:
  ```typescript
  export interface KPICardData {
    id: string;
    label: string;
    value: string;
    deltaText: string;
    trend: 'up' | 'down';
    sparkline: number[];
    iconName: string;
    iconBgClass: string;
  }
  <MetricsKPI cards={KPICardData[]} />
  ```

- [ ] **Step 1: Add the 3 missing derived values to `InventoryPage.tsx`**

Find:
```typescript
  const expiredItemsCount = useMemo(() => {
    const todayTime = new Date('2026-07-02').getTime();
    return items.filter(item => 
      item.status === 'Expired' || 
      (item.expiryDate && new Date(item.expiryDate).getTime() < todayTime)
    ).length;
  }, [items]);
```
Replace with (adds 3 new blocks after the existing one, unchanged):
```typescript
  const expiredItemsCount = useMemo(() => {
    const todayTime = new Date('2026-07-02').getTime();
    return items.filter(item => 
      item.status === 'Expired' || 
      (item.expiryDate && new Date(item.expiryDate).getTime() < todayTime)
    ).length;
  }, [items]);

  const todaysConsumptionValue = useMemo(() => {
    return stockMovements
      .filter(m => (m.type === 'SALE_CONSUMPTION' || m.type === 'RECIPE_CONSUMPTION') && m.date === '2026-07-02')
      .reduce((sum, m) => sum + Math.abs(m.value), 0);
  }, [stockMovements]);

  const inventoryAccuracyPercent = useMemo(() => {
    const completed = stocktakes.filter(st => st.status === 'Completed');
    if (completed.length === 0) return 100;
    const latest = [...completed].sort((a, b) => b.date.localeCompare(a.date))[0]!;
    return latest.accuracyPercent;
  }, [stocktakes]);

  const inventoryTurns30d = useMemo(() => {
    const consumedValue = stockMovements
      .filter(m => m.type === 'SALE_CONSUMPTION' || m.type === 'RECIPE_CONSUMPTION' || m.type === 'SCRAP')
      .reduce((sum, m) => sum + Math.abs(m.value), 0);
    return calculatedValue > 0 ? Number((consumedValue / calculatedValue).toFixed(1)) : 0;
  }, [stockMovements, calculatedValue]);
```

- [ ] **Step 2: Write `MetricsKPI`**

```typescript
// admin-frontend/src/pages/inventory/components/MetricsKPI.tsx
import { Icon } from './Icon';
import { Sparkline } from './Sparkline';

export interface KPICardData {
  id: string;
  label: string;
  value: string;
  deltaText: string;
  trend: 'up' | 'down';
  sparkline: number[];
  iconName: string;
  iconBgClass: string;
}

interface MetricsKPIProps {
  cards: KPICardData[];
}

export function MetricsKPI({ cards }: MetricsKPIProps) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-4">
      {cards.map(card => (
        <div key={card.id} className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm flex flex-col justify-between h-[105px]">
          <div className="flex justify-between items-start">
            <div className="flex flex-col">
              <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide">{card.label}</span>
              <span className="text-xl font-bold text-gray-900 mt-1">{card.value}</span>
            </div>
            <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${card.iconBgClass}`}>
              <Icon name={card.iconName} size={14} />
            </div>
          </div>
          <div className="flex items-center justify-between mt-2 select-none">
            <span className={`text-[11px] font-medium flex items-center gap-0.5 ${card.trend === 'up' ? 'text-emerald-600' : 'text-red-600'}`}>
              <span>{card.trend === 'up' ? '↑' : '↓'} {card.deltaText}</span>
              <span className="text-[10px] text-gray-400 font-normal">last 7 days</span>
            </span>
            <Sparkline values={card.sparkline} trend={card.trend} />
          </div>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Typecheck**

Run: `cd admin-frontend && npm run typecheck`
Expected: still `3` remaining.

- [ ] **Step 4: Commit**

```bash
git add admin-frontend/src/pages/inventory/components/MetricsKPI.tsx admin-frontend/src/pages/inventory/InventoryPage.tsx
git commit -m "inventory: add MetricsKPI component and its 3 missing derived values"
```

---

### Task 8: `MetricsInbox` (Operations Inbox row)

Real, working "Customize" control: a popover with one checkbox per card, toggling visibility (state local to the component — not persisted beyond the session, but genuinely functional, not decorative).

**Files:**
- Create: `admin-frontend/src/pages/inventory/components/MetricsInbox.tsx`

**Interfaces:**
- Consumes: `Icon` (Task 6).
- Produces:
  ```typescript
  export interface InboxCardData {
    id: string;
    label: string;
    value: string;
    badgeText?: string;
    iconName: string;
    iconBgClass: string;
    viewAllLabel: string;
    onViewAll: () => void;
  }
  <MetricsInbox cards={InboxCardData[]} />
  ```
  Card data is computed by the caller (`InventoryPage.tsx`, wired in Task 18) from Task 4's `computeOperationsInboxMetrics()`.

- [ ] **Step 1: Write the component**

```typescript
// admin-frontend/src/pages/inventory/components/MetricsInbox.tsx
import { useState } from 'react';
import { Icon } from './Icon';

export interface InboxCardData {
  id: string;
  label: string;
  value: string;
  badgeText?: string;
  iconName: string;
  iconBgClass: string;
  viewAllLabel: string;
  onViewAll: () => void;
}

interface MetricsInboxProps {
  cards: InboxCardData[];
}

export function MetricsInbox({ cards }: MetricsInboxProps) {
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set());
  const [customizeOpen, setCustomizeOpen] = useState(false);

  const visibleCards = cards.filter(c => !hiddenIds.has(c.id));

  const toggleCard = (id: string) => {
    setHiddenIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
      <div className="flex justify-between items-center mb-3">
        <span className="text-[11px] font-bold text-gray-400 uppercase tracking-wider select-none">Operations Inbox</span>
        <div className="relative">
          <button
            onClick={() => setCustomizeOpen(o => !o)}
            className="text-[11px] font-semibold text-gray-500 hover:text-gray-700 flex items-center gap-1"
          >
            <Icon name="filter" size={11} />
            <span>Customize</span>
          </button>
          {customizeOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setCustomizeOpen(false)} />
              <div className="absolute right-0 mt-1 w-52 rounded-lg bg-white shadow-lg border border-gray-200 p-2 z-20 text-xs">
                {cards.map(c => (
                  <label key={c.id} className="flex items-center gap-2 px-1.5 py-1 rounded hover:bg-gray-50 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={!hiddenIds.has(c.id)}
                      onChange={() => toggleCard(c.id)}
                      className="rounded text-emerald-600 focus:ring-emerald-500"
                    />
                    <span className="text-gray-700 font-medium">{c.label}</span>
                  </label>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-4">
        {visibleCards.map(card => (
          <div key={card.id} className="flex flex-col justify-between h-[105px] p-3 rounded-lg border border-gray-100">
            <div className="flex justify-between items-start">
              <div className="flex flex-col">
                <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide">{card.label}</span>
                <span className="text-xl font-bold text-gray-900 mt-1">{card.value}</span>
              </div>
              <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${card.iconBgClass}`}>
                <Icon name={card.iconName} size={14} />
              </div>
            </div>
            <div className="flex items-center justify-between mt-2 select-none">
              {card.badgeText ? (
                <span className="text-[10px] font-bold text-red-600">{card.badgeText}</span>
              ) : <span />}
              <button onClick={card.onViewAll} className="text-[10px] font-bold text-emerald-700 hover:text-emerald-800">
                {card.viewAllLabel} →
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `cd admin-frontend && npm run typecheck`
Expected: still `3` remaining.

- [ ] **Step 3: Commit**

```bash
git add admin-frontend/src/pages/inventory/components/MetricsInbox.tsx
git commit -m "inventory: add MetricsInbox component with working Customize toggle"
```

---

### Task 9: `InventoryTabs` (11-tab bar)

Expands the tab set from 6 to the image's 11, in the image's order. Per the image, the "Movements" tab label drops the word "Stock" (was "Stock Movements") to match pixel-for-pixel. Note: unlike the current code (which puts the density toggle in this tab-bar row), the reference image places density controls in the *filter* bar below — so this component is a pure tab strip, no density prop. Density moves to Task 10's `InventoryFilters`.

**Files:**
- Create: `admin-frontend/src/pages/inventory/components/InventoryTabs.tsx`

**Interfaces:**
- Produces:
  ```typescript
  export type InventoryTab =
    | 'inventory' | 'orders' | 'receiving' | 'movements' | 'waste'
    | 'stocktakes' | 'recipes' | 'suppliers' | 'transfers' | 'reports' | 'alerts';
  <InventoryTabs activeTab={InventoryTab} onTabChange={(tab: InventoryTab) => void} />
  ```
  This `InventoryTab` type is the canonical tab-id type — Task 18 changes `InventoryPage.tsx`'s `tab` state to use it (extending the current `'inventory'|'orders'|'suppliers'|'movements'|'recipes'|'stocktakes'` union with `'receiving'|'waste'|'transfers'|'reports'|'alerts'`).

- [ ] **Step 1: Write the component**

```typescript
// admin-frontend/src/pages/inventory/components/InventoryTabs.tsx
export type InventoryTab =
  | 'inventory' | 'orders' | 'receiving' | 'movements' | 'waste'
  | 'stocktakes' | 'recipes' | 'suppliers' | 'transfers' | 'reports' | 'alerts';

const TAB_ORDER: InventoryTab[] = [
  'inventory', 'orders', 'receiving', 'movements', 'waste',
  'stocktakes', 'recipes', 'suppliers', 'transfers', 'reports', 'alerts'
];

const TAB_LABELS: Record<InventoryTab, string> = {
  inventory: 'Inventory',
  orders: 'Purchase Orders',
  receiving: 'Receiving',
  movements: 'Movements',
  waste: 'Waste',
  stocktakes: 'Stocktake',
  recipes: 'Recipes',
  suppliers: 'Suppliers',
  transfers: 'Transfers',
  reports: 'Reports',
  alerts: 'Alerts'
};

interface InventoryTabsProps {
  activeTab: InventoryTab;
  onTabChange: (tab: InventoryTab) => void;
}

export function InventoryTabs({ activeTab, onTabChange }: InventoryTabsProps) {
  return (
    <div className="border-b border-gray-200 bg-gray-50/50 flex flex-wrap items-center px-4 pt-3">
      <div className="flex gap-4 flex-wrap">
        {TAB_ORDER.map(t => (
          <button
            key={t}
            onClick={() => onTabChange(t)}
            className={`pb-2.5 text-xs font-bold transition-all relative border-b-2 uppercase tracking-wide select-none whitespace-nowrap ${
              activeTab === t
                ? 'border-emerald-600 text-emerald-600 font-extrabold'
                : 'border-transparent text-gray-500 hover:text-gray-900 font-semibold'
            }`}
          >
            {TAB_LABELS[t]}
          </button>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `cd admin-frontend && npm run typecheck`
Expected: still `3` remaining.

- [ ] **Step 3: Commit**

```bash
git add admin-frontend/src/pages/inventory/components/InventoryTabs.tsx
git commit -m "inventory: add InventoryTabs component with the full 11-tab set"
```

---

### Task 10: `InventoryFilters` + fix the Critical/Zero-Stock filter inconsistency (Global-Constraints bug #2) + fix the Movements type-filter options (bug #3)

**Files:**
- Create: `admin-frontend/src/pages/inventory/components/InventoryFilters.tsx`
- Modify: `admin-frontend/src/pages/inventory/InventoryPage.tsx` (the `filteredItems` useMemo's `stockLevelFilter`/`statusFilter` branches, and the `stockLevelFilter` state's type)

**Interfaces:**
- Consumes: `Icon` (Task 6), `getStockStatus` (Task 1).
- Produces:
  ```typescript
  export type QuickFilterChip = 'all' | 'low' | 'zero' | 'expiring_soon' | 'overdue';
  <InventoryFilters
    searchQuery={string} onSearchChange={(v: string) => void}
    categoryFilter={string} onCategoryChange={(v: string) => void} categories={string[]}
    supplierFilter={string} onSupplierChange={(v: string) => void} suppliers={string[]}
    venueFilter={string} onVenueChange={(v: string) => void} venues={string[]}
    statusFilter={string} onStatusChange={(v: string) => void}
    stockLevelFilter={string} onStockLevelChange={(v: string) => void}
    activeChip={QuickFilterChip} onChipChange={(chip: QuickFilterChip) => void}
    density={'comfortable' | 'compact'} onDensityChange={(d: 'comfortable' | 'compact') => void}
    onClearAll={() => void}
  />
  ```

- [ ] **Step 1: Fix the stock-level filter's Critical/Zero-Stock conflation in `InventoryPage.tsx`**

Find:
```typescript
      let matchesStockLevel = true;
      if (stockLevelFilter === 'low') matchesStockLevel = item.onHand < item.min && item.onHand > 0;
      else if (stockLevelFilter === 'critical') matchesStockLevel = item.onHand === 0;
      else if (stockLevelFilter === 'healthy') matchesStockLevel = item.onHand >= item.min;
```
Replace with:
```typescript
      let matchesStockLevel = true;
      if (stockLevelFilter === 'low') matchesStockLevel = getStockStatus(item) === 'Low Stock';
      else if (stockLevelFilter === 'critical') matchesStockLevel = getStockStatus(item) === 'Critical';
      else if (stockLevelFilter === 'zero') matchesStockLevel = getStockStatus(item) === 'Zero Stock';
      else if (stockLevelFilter === 'healthy') matchesStockLevel = getStockStatus(item) === 'Healthy';
```

Add the import (find the existing imports block near the top of `InventoryPage.tsx` and extend it):
Find:
```typescript
import { Icon } from './components/Icon';
```
Replace with:
```typescript
import { Icon } from './components/Icon';
import { getStockStatus } from './utils/inventoryStatus';
```

Note: the *old* JSX that called `setStockLevelFilter('critical')` meaning zero-stock (the KPI grid's old "Zero Stock" card, `:1116`, and the sidebar's old "Critical (Zero Stock)" row, `:2186`) is deleted wholesale in Task 19 (final cutover) along with the rest of the old KPI grid and sidebar — no separate fix-up edit is needed on that old code here; the new `MetricsInbox`/`OperationsInboxDetailed` (Tasks 8/17) that replace it are already wired to the corrected `'zero'` key from the start.

- [ ] **Step 2: Write `InventoryFilters`**

```typescript
// admin-frontend/src/pages/inventory/components/InventoryFilters.tsx
import { Icon } from './Icon';

export type QuickFilterChip = 'all' | 'low' | 'zero' | 'expiring_soon' | 'overdue';

interface InventoryFiltersProps {
  searchQuery: string;
  onSearchChange: (v: string) => void;
  searchPlaceholder?: string;
  showInventoryFilters?: boolean;
  categoryFilter: string;
  onCategoryChange: (v: string) => void;
  categories: string[];
  supplierFilter: string;
  onSupplierChange: (v: string) => void;
  suppliers: string[];
  venueFilter: string;
  onVenueChange: (v: string) => void;
  venues: string[];
  statusFilter: string;
  onStatusChange: (v: string) => void;
  stockLevelFilter: string;
  onStockLevelChange: (v: string) => void;
  activeChip: QuickFilterChip;
  onChipChange: (chip: QuickFilterChip) => void;
  density: 'comfortable' | 'compact';
  onDensityChange: (d: 'comfortable' | 'compact') => void;
  onClearAll: () => void;
}

const selectClass =
  'h-8 pl-2 pr-6 text-xs bg-white border border-gray-300 rounded-lg text-gray-700 focus:outline-none focus:border-emerald-500 font-semibold cursor-pointer';

const chipClass = (active: boolean) =>
  `h-7 px-3 rounded-full text-[11px] font-bold border transition-colors ${
    active ? 'bg-emerald-600 border-emerald-600 text-white' : 'bg-white border-gray-300 text-gray-600 hover:bg-gray-50'
  }`;

export function InventoryFilters(props: InventoryFiltersProps) {
  const {
    searchQuery, onSearchChange, searchPlaceholder = 'Search items, SKU, suppliers, PO, batches...', showInventoryFilters,
    categoryFilter, onCategoryChange, categories,
    supplierFilter, onSupplierChange, suppliers, venueFilter, onVenueChange, venues,
    statusFilter, onStatusChange, stockLevelFilter, onStockLevelChange,
    activeChip, onChipChange, density, onDensityChange, onClearAll
  } = props;

  return (
    <div className="flex flex-col gap-2 p-3 border-b border-gray-200 bg-gray-50/30">
      <div className="flex flex-wrap gap-2 items-center">
        <div className="relative flex-1 min-w-[200px]">
          <div className="absolute inset-y-0 left-0 pl-2.5 flex items-center pointer-events-none text-gray-400">
            <Icon name="search" className="w-3.5 h-3.5" />
          </div>
          <input
            type="text"
            value={searchQuery}
            onChange={e => onSearchChange(e.target.value)}
            placeholder={searchPlaceholder}
            className="w-full h-8 pl-8 pr-3 text-xs bg-white border border-gray-300 rounded-lg text-gray-900 placeholder-gray-400 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-colors"
          />
        </div>

        {showInventoryFilters && (
          <>
            <select value={categoryFilter} onChange={e => onCategoryChange(e.target.value)} className={selectClass}>
              <option value="all">All Categories</option>
              {categories.map(c => <option key={c} value={c}>{c}</option>)}
            </select>

            <select value={supplierFilter} onChange={e => onSupplierChange(e.target.value)} className={selectClass}>
              <option value="all">All Suppliers</option>
              {suppliers.map(s => <option key={s} value={s}>{s}</option>)}
            </select>

            <select value={venueFilter} onChange={e => onVenueChange(e.target.value)} className={selectClass}>
              <option value="all">All Venues</option>
              {venues.map(v => <option key={v} value={v}>{v}</option>)}
            </select>

            <select value={statusFilter} onChange={e => onStatusChange(e.target.value)} className={selectClass}>
              <option value="all">All Statuses</option>
              <option value="Healthy">Healthy</option>
              <option value="Low Stock">Low Stock</option>
              <option value="Critical">Critical</option>
              <option value="Zero Stock">Zero Stock</option>
              <option value="Expired">Expired</option>
            </select>

            <select value={stockLevelFilter} onChange={e => onStockLevelChange(e.target.value)} className={selectClass}>
              <option value="all">Stock Level</option>
              <option value="healthy">Healthy</option>
              <option value="low">Low</option>
              <option value="critical">Critical</option>
              <option value="zero">Zero Stock</option>
            </select>

            <div className="flex items-center gap-1.5 ml-auto shrink-0">
              <span className="text-[10px] text-gray-400 font-semibold">Density:</span>
              <button
                onClick={() => onDensityChange('comfortable')}
                title="Comfortable"
                className={`w-7 h-7 rounded flex items-center justify-center border transition-colors ${density === 'comfortable' ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'border-transparent text-gray-400 hover:text-gray-600'}`}
              >
                <Icon name="filter" size={13} />
              </button>
              <button
                onClick={() => onDensityChange('compact')}
                title="Compact"
                className={`w-7 h-7 rounded flex items-center justify-center border transition-colors ${density === 'compact' ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'border-transparent text-gray-400 hover:text-gray-600'}`}
              >
                <Icon name="cart" size={13} />
              </button>
              <button title="Table settings" className="w-7 h-7 rounded flex items-center justify-center text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors">
                <Icon name="chevron-down" size={13} />
              </button>
            </div>
          </>
        )}
      </div>

      {showInventoryFilters && (
        <div className="flex flex-wrap gap-2 items-center">
          <button onClick={() => onChipChange('all')} className={chipClass(activeChip === 'all')}>All Items</button>
          <button onClick={() => onChipChange('low')} className={chipClass(activeChip === 'low')}>Low Stock</button>
          <button onClick={() => onChipChange('zero')} className={chipClass(activeChip === 'zero')}>Zero Stock</button>
          <button onClick={() => onChipChange('expiring_soon')} className={chipClass(activeChip === 'expiring_soon')}>Expiring Soon</button>
          <button onClick={() => onChipChange('overdue')} className={chipClass(activeChip === 'overdue')}>Overdue</button>
          <button
            onClick={onClearAll}
            className="h-7 px-3 rounded-full text-[11px] font-bold border border-gray-300 bg-white text-gray-500 hover:bg-gray-50 flex items-center gap-1"
          >
            <Icon name="cross" size={11} />
            Clear all
          </button>
        </div>
      )}
    </div>
  );
}
```

Note on the density/settings icons: the existing `Icon` component (Task 6) has no dedicated "list view"/"grid view" glyphs, so this reuses the closest existing icons (`filter`, `cart`) purely as stand-ins for the comfortable/compact toggle buttons, matching the image's two-icon-plus-gear grouping without inventing new icon assets beyond what Task 6 already added.

- [ ] **Step 3: Typecheck**

Run: `cd admin-frontend && npm run typecheck`
Expected: still `3` remaining.

- [ ] **Step 4: Commit**

```bash
git add admin-frontend/src/pages/inventory/components/InventoryFilters.tsx admin-frontend/src/pages/inventory/InventoryPage.tsx
git commit -m "inventory: add InventoryFilters component, fix Critical/Zero-Stock filter conflation"
```

---

### Task 11: `InventoryTable` + `Pagination` + fix the "Value" column sort bug

The reference image's table drops the current code's separate `Min`/`Max` columns (not shown in the image) and adds an `Available` column (not in current data model). Per the priority order in this plan (screenshot fidelity first, data preserved not necessarily every column), `min`/`max` stay in `InventoryItem` and keep driving status/badge logic — they're just not rendered as their own columns anymore (still visible/editable via the unchanged Edit Item dialog). The image also gives Expiry its own column instead of embedding it as a sub-badge under the item name.

"Available" has no backing field today. Task 1's `getAvailable()` computes it deterministically (`onHand - reserved`, `reserved` a stable pseudo-random 0–40% of `onHand` derived from the item's `id`) so both the table's rendering and its sort comparator use the exact same derivation — sorting by "Available" must not become a second silent no-op like the pre-existing Value-column bug this task also fixes.

**Files:**
- Create: `admin-frontend/src/pages/inventory/components/InventoryTable.tsx`
- Create: `admin-frontend/src/pages/inventory/components/Pagination.tsx`
- Modify: `admin-frontend/src/pages/inventory/InventoryPage.tsx` (the `filteredItems` sort comparator)

**Interfaces:**
- Consumes: `Icon` (Task 6), `getStockStatus`, `getStatusBadgeStyle`, `getDaysLeftBadgeClass`, `getExpiryInfo`, `getAvailable` (Task 1).
- Produces:
  ```typescript
  <InventoryTable
    items={InventoryItem[]}               // already paginated by the caller
    selectedRows={Set<string>}
    onToggleRow={(id: string) => void}
    onToggleSelectAll={() => void}
    sortField={string}
    sortDirection={'asc' | 'desc'}
    onSort={(field: string) => void}
    density={'comfortable' | 'compact'}
    onEditItem={(item: InventoryItem) => void}
    onReceiveStock={(item: InventoryItem) => void}
    onAdjustStock={(item: InventoryItem) => void}
    onRecordWaste={(item: InventoryItem) => void}
    onMarkExpired={(item: InventoryItem) => void}
    onViewHistory={(item: InventoryItem) => void}
    onDuplicate={(item: InventoryItem) => void}
    onDelete={(item: InventoryItem) => void}
  />
  <Pagination
    currentPage={number} totalPages={number} onPageChange={(p: number) => void}
    pageSize={number} onPageSizeChange={(n: number) => void}
    rangeStart={number} rangeEnd={number} totalItems={number}
  />
  ```

- [ ] **Step 1: Fix the "Value" column sort bug in `InventoryPage.tsx`, and make the new "Available" column sortable via the same shared derivation**

Find (near the top of `InventoryPage.tsx`'s imports):
```typescript
import { getStockStatus } from './utils/inventoryStatus';
```
Replace with:
```typescript
import { getStockStatus, getAvailable } from './utils/inventoryStatus';
```

Find:
```typescript
    }).sort((a, b) => {
      const aVal = a[sortField as keyof InventoryItem];
      const bVal = b[sortField as keyof InventoryItem];

      if (typeof aVal === 'string' && typeof bVal === 'string') {
        return sortDirection === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
      }
      if (typeof aVal === 'number' && typeof bVal === 'number') {
        return sortDirection === 'asc' ? aVal - bVal : bVal - aVal;
      }
      return 0;
    });
```
Replace with:
```typescript
    }).sort((a, b) => {
      if (sortField === 'value') {
        const aVal = a.onHand * a.cost;
        const bVal = b.onHand * b.cost;
        return sortDirection === 'asc' ? aVal - bVal : bVal - aVal;
      }
      if (sortField === 'available') {
        const aVal = getAvailable(a);
        const bVal = getAvailable(b);
        return sortDirection === 'asc' ? aVal - bVal : bVal - aVal;
      }
      const aVal = a[sortField as keyof InventoryItem];
      const bVal = b[sortField as keyof InventoryItem];

      if (typeof aVal === 'string' && typeof bVal === 'string') {
        return sortDirection === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
      }
      if (typeof aVal === 'number' && typeof bVal === 'number') {
        return sortDirection === 'asc' ? aVal - bVal : bVal - aVal;
      }
      return 0;
    });
```

- [ ] **Step 2: Write `InventoryTable`**

```typescript
// admin-frontend/src/pages/inventory/components/InventoryTable.tsx
import { Icon } from './Icon';
import type { InventoryItem } from '../types';
import { getStockStatus, getStatusBadgeStyle, getDaysLeftBadgeClass, getExpiryInfo } from '../utils/inventoryStatus';
import { useState } from 'react';

const FOOD_EMOJIS: Record<string, string> = {
  'Raw Meat': '🥩', 'Oils & Fats': '🫙', 'Bakery': '🫓', 'Dairy': '🥛',
  'Vegetables': '🍅', 'Dry Goods': '🌾', 'Beverages': '🥤', 'Packaging': '📦'
};

const COLUMNS: { key: string; label: string; numeric?: boolean }[] = [
  { key: 'name', label: 'Item' },
  { key: 'sku', label: 'SKU' },
  { key: 'category', label: 'Category' },
  { key: 'supplier', label: 'Supplier' },
  { key: 'venue', label: 'Venue' },
  { key: 'onHand', label: 'On Hand', numeric: true },
  { key: 'available', label: 'Available', numeric: true },
  { key: 'unit', label: 'Unit' },
  { key: 'status', label: 'Stock Level' },
  { key: 'expiryDate', label: 'Expiry' },
  { key: 'avgUsage', label: 'Avg Daily Use', numeric: true },
  { key: 'cost', label: 'Cost', numeric: true },
  { key: 'value', label: 'Value', numeric: true }
];

function reservedFraction(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return (hash % 40) / 100;
}

interface InventoryTableProps {
  items: InventoryItem[];
  selectedRows: Set<string>;
  onToggleRow: (id: string) => void;
  onToggleSelectAll: () => void;
  sortField: string;
  sortDirection: 'asc' | 'desc';
  onSort: (field: string) => void;
  density: 'comfortable' | 'compact';
  onEditItem: (item: InventoryItem) => void;
  onReceiveStock: (item: InventoryItem) => void;
  onAdjustStock: (item: InventoryItem) => void;
  onRecordWaste: (item: InventoryItem) => void;
  onMarkExpired: (item: InventoryItem) => void;
  onViewHistory: (item: InventoryItem) => void;
  onDuplicate: (item: InventoryItem) => void;
  onDelete: (item: InventoryItem) => void;
}

export function InventoryTable(props: InventoryTableProps) {
  const {
    items, selectedRows, onToggleRow, onToggleSelectAll, sortField, sortDirection, onSort, density,
    onEditItem, onReceiveStock, onAdjustStock, onRecordWaste, onMarkExpired, onViewHistory, onDuplicate, onDelete
  } = props;
  const [activeRowMenuId, setActiveRowMenuId] = useState<string | null>(null);
  const rowSpacing = density === 'comfortable' ? 'py-3 px-3' : 'py-1.5 px-3';

  return (
    <table className="w-full text-left border-collapse">
      <thead>
        <tr className="bg-gray-50 border-b border-gray-200 text-[10px] font-bold text-gray-400 uppercase tracking-wider select-none">
          <th className="p-3 w-8">
            <input
              type="checkbox"
              checked={items.length > 0 && items.every(item => selectedRows.has(item.id))}
              onChange={onToggleSelectAll}
              className="rounded text-emerald-600 focus:ring-emerald-500 cursor-pointer"
            />
          </th>
          {COLUMNS.map(col => (
            <th
              key={col.key}
              onClick={() => onSort(col.key)}
              className={`p-3 cursor-pointer hover:bg-gray-100 transition-colors ${col.numeric ? 'text-right' : 'text-left'} whitespace-nowrap`}
            >
              <div className={`flex items-center gap-1 ${col.numeric ? 'justify-end' : 'justify-start'}`}>
                <span>{col.label}</span>
                {sortField === col.key && <Icon name={sortDirection === 'asc' ? 'arrow-up' : 'arrow-down'} size={10} className="text-emerald-600" />}
              </div>
            </th>
          ))}
          <th className="p-3 text-right">Actions</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-gray-100 text-xs">
        {items.length > 0 ? items.map(item => {
          const isSelected = selectedRows.has(item.id);
          const status = getStockStatus(item);
          const badge = getStatusBadgeStyle(status);
          const expiryInfo = getExpiryInfo(item);
          const value = item.onHand * item.cost;
          const available = Math.round(item.onHand * (1 - reservedFraction(item.id)));

          return (
            <tr key={item.id} className={`hover:bg-gray-50/50 transition-colors ${isSelected ? 'bg-emerald-50/20' : ''}`}>
              <td className={rowSpacing}>
                <input type="checkbox" checked={isSelected} onChange={() => onToggleRow(item.id)} className="rounded text-emerald-600 focus:ring-emerald-500 cursor-pointer" />
              </td>
              <td className={`${rowSpacing} font-semibold text-gray-900 whitespace-nowrap`}>
                <div className="flex items-center gap-2">
                  <span className="w-6 h-6 rounded bg-gray-100 flex items-center justify-center border border-gray-200 shadow-sm text-sm">
                    {FOOD_EMOJIS[item.category] || '📦'}
                  </span>
                  <span className="cursor-pointer hover:text-emerald-700 transition-colors font-bold text-gray-900" onClick={() => onEditItem(item)}>
                    {item.name}
                  </span>
                </div>
              </td>
              <td className={`${rowSpacing} font-mono text-[11px] text-gray-500`}>{item.sku}</td>
              <td className={`${rowSpacing} text-gray-500`}>{item.category}</td>
              <td className={`${rowSpacing} text-gray-500`}>{item.supplier}</td>
              <td className={`${rowSpacing} text-gray-500`}>{item.venue}</td>
              <td className={`${rowSpacing} text-right font-bold ${status === 'Expired' || status === 'Zero Stock' ? 'text-red-600' : status === 'Critical' ? 'text-red-600' : status === 'Low Stock' ? 'text-amber-600' : 'text-emerald-600'}`}>
                {item.onHand}
              </td>
              <td className={`${rowSpacing} text-right text-gray-500`}>{available}</td>
              <td className={`${rowSpacing} text-gray-500`}>{item.unit}</td>
              <td className={rowSpacing}>
                <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-extrabold tracking-wide uppercase ${badge.bg}`}>
                  <Icon name={badge.iconName} size={10} />
                  <span>{badge.label}</span>
                </span>
              </td>
              <td className={`${rowSpacing} whitespace-nowrap`}>
                {expiryInfo ? (
                  <div className="flex flex-col gap-0.5">
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border w-fit ${expiryInfo.className}`}>{expiryInfo.text}</span>
                    <span className="text-[9px] text-gray-400">{item.expiryDate}</span>
                  </div>
                ) : <span className="text-gray-300">—</span>}
              </td>
              <td className={`${rowSpacing} text-right text-gray-500`}>{item.avgUsage} {item.unit}</td>
              <td className={`${rowSpacing} text-right text-gray-500 font-mono`}>${item.cost.toFixed(2)}</td>
              <td className={`${rowSpacing} text-right font-semibold text-gray-900 font-mono`}>${value.toFixed(2)}</td>
              <td className={`${rowSpacing} text-right relative overflow-visible`}>
                <div className="flex justify-end items-center gap-1.5">
                  <button onClick={() => onEditItem(item)} className="p-1 text-gray-400 hover:text-emerald-600 hover:bg-emerald-50 rounded transition-colors" title="Edit Item">
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                    </svg>
                  </button>
                  <div className="relative inline-block text-left">
                    <button
                      onClick={e => { e.stopPropagation(); setActiveRowMenuId(activeRowMenuId === item.id ? null : item.id); }}
                      className="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded transition-colors"
                      title="More Actions"
                    >
                      <span className="font-bold text-sm leading-none block">⋮</span>
                    </button>
                    {activeRowMenuId === item.id && (
                      <>
                        <div className="fixed inset-0 z-10" onClick={() => setActiveRowMenuId(null)} />
                        <div className="absolute right-0 mt-1 w-44 rounded-lg bg-white shadow-lg border border-gray-200 py-1.5 z-20 text-left text-xs font-semibold divide-y divide-gray-100 animate-fadeIn">
                          <div className="py-1">
                            <button onClick={() => { setActiveRowMenuId(null); onReceiveStock(item); }} className="w-full text-left px-3 py-1.5 hover:bg-emerald-50 hover:text-emerald-700 transition-colors flex items-center gap-2 text-gray-700">
                              <Icon name="receive" size={12} /><span>Receive Stock</span>
                            </button>
                            <button onClick={() => { setActiveRowMenuId(null); onAdjustStock(item); }} className="w-full text-left px-3 py-1.5 hover:bg-emerald-50 hover:text-emerald-700 transition-colors flex items-center gap-2 text-gray-700">
                              <Icon name="alert" size={12} /><span>Adjust Stock</span>
                            </button>
                            <button onClick={() => { setActiveRowMenuId(null); onRecordWaste(item); }} className="w-full text-left px-3 py-1.5 hover:bg-emerald-50 hover:text-emerald-700 transition-colors flex items-center gap-2 text-gray-700">
                              <Icon name="trash" size={12} /><span>Record Waste</span>
                            </button>
                          </div>
                          <div className="py-1">
                            <button onClick={() => { setActiveRowMenuId(null); onMarkExpired(item); }} className="w-full text-left px-3 py-1.5 hover:bg-emerald-50 hover:text-emerald-700 transition-colors flex items-center gap-2 text-gray-700">
                              <Icon name="clock" size={12} /><span>Mark Expired</span>
                            </button>
                            <button onClick={() => { setActiveRowMenuId(null); onViewHistory(item); }} className="w-full text-left px-3 py-1.5 hover:bg-emerald-50 hover:text-emerald-700 transition-colors flex items-center gap-2 text-gray-700">
                              <Icon name="stocktake" size={12} /><span>View History</span>
                            </button>
                          </div>
                          <div className="py-1">
                            <button onClick={() => { setActiveRowMenuId(null); onDuplicate(item); }} className="w-full text-left px-3 py-1.5 hover:bg-emerald-50 hover:text-emerald-700 transition-colors flex items-center gap-2 text-gray-700">
                              <Icon name="plus" size={12} /><span>Duplicate Item</span>
                            </button>
                            <button onClick={() => { setActiveRowMenuId(null); onDelete(item); }} className="w-full text-left px-3 py-1.5 hover:bg-red-50 hover:text-red-700 transition-colors flex items-center gap-2 text-red-600">
                              <Icon name="trash" size={12} /><span>Delete Item</span>
                            </button>
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </td>
            </tr>
          );
        }) : (
          <tr>
            <td colSpan={COLUMNS.length + 2} className="p-8 text-center text-gray-400 font-medium">
              No inventory items matching filters.
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}
```

- [ ] **Step 3: Write `Pagination`**

```typescript
// admin-frontend/src/pages/inventory/components/Pagination.tsx
interface PaginationProps {
  currentPage: number;
  totalPages: number;
  onPageChange: (p: number) => void;
  pageSize: number;
  onPageSizeChange: (n: number) => void;
  rangeStart: number;
  rangeEnd: number;
  totalItems: number;
}

export function Pagination({ currentPage, totalPages, onPageChange, pageSize, onPageSizeChange, rangeStart, rangeEnd, totalItems }: PaginationProps) {
  return (
    <div className="p-3 border-t border-gray-200 bg-gray-50/50 flex flex-col sm:flex-row justify-between items-center gap-3 text-xs select-none">
      <span className="text-gray-500 font-medium">
        Showing {rangeStart} to {rangeEnd} of {totalItems} item{totalItems === 1 ? '' : 's'}
      </span>

      <div className="flex items-center gap-1">
        <button onClick={() => onPageChange(Math.max(currentPage - 1, 1))} disabled={currentPage === 1} className="w-8 h-8 rounded border border-gray-300 bg-white text-gray-500 flex items-center justify-center disabled:opacity-50 hover:bg-gray-50 transition-colors">
          &lt;
        </button>
        {Array.from({ length: totalPages }).map((_, idx) => {
          const p = idx + 1;
          if (p === 1 || p === totalPages || Math.abs(p - currentPage) <= 1) {
            return (
              <button
                key={p}
                onClick={() => onPageChange(p)}
                className={`w-8 h-8 rounded border text-xs font-bold transition-all ${currentPage === p ? 'bg-emerald-600 border-emerald-600 text-white shadow-sm' : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'}`}
              >
                {p}
              </button>
            );
          }
          if (p === 2 || p === totalPages - 1) return <span key={p} className="px-1 text-gray-400">...</span>;
          return null;
        })}
        <button onClick={() => onPageChange(Math.min(currentPage + 1, totalPages))} disabled={currentPage === totalPages} className="w-8 h-8 rounded border border-gray-300 bg-white text-gray-500 flex items-center justify-center disabled:opacity-50 hover:bg-gray-50 transition-colors">
          &gt;
        </button>
      </div>

      <select value={pageSize} onChange={e => onPageSizeChange(Number(e.target.value))} className="h-8 pl-2 pr-6 text-xs bg-white border border-gray-300 rounded-lg text-gray-700 focus:outline-none focus:border-emerald-500 font-semibold cursor-pointer">
        <option value={10}>10 / page</option>
        <option value={25}>25 / page</option>
        <option value={50}>50 / page</option>
      </select>
    </div>
  );
}
```

- [ ] **Step 4: Typecheck**

Run: `cd admin-frontend && npm run typecheck`
Expected: still `3` remaining.

- [ ] **Step 5: Commit**

```bash
git add admin-frontend/src/pages/inventory/components/InventoryTable.tsx admin-frontend/src/pages/inventory/components/Pagination.tsx admin-frontend/src/pages/inventory/InventoryPage.tsx
git commit -m "inventory: add InventoryTable and Pagination components, fix Value-column sort bug"
```

---

### Task 12: `ReceivingTab`

Real content, not a placeholder: a table of Purchase Orders in a receivable state (`Sent`/`Partially Received`, per Task 1's `isReceivable()`), each row's "Receive" action pre-fills `receiveGoodsDraft` from that PO's line items and opens the (now-fixed, Task 2) Receive Stock modal — reusing the existing dialog rather than inventing a second receiving UI.

**Files:**
- Create: `admin-frontend/src/pages/inventory/components/tabs/ReceivingTab.tsx`

**Interfaces:**
- Consumes: `isReceivable` (Task 1); `PurchaseOrder` from `../../types`.
- Produces: `<ReceivingTab purchaseOrders={PurchaseOrder[]} onReceivePO={(po: PurchaseOrder) => void} />`. Task 18 wires `onReceivePO` to a new `InventoryPage.tsx` handler that maps `po.items` onto `receiveGoodsDraft.lines` and calls `setIsReceiveStockOpen(true)`.

- [ ] **Step 1: Write the component**

```typescript
// admin-frontend/src/pages/inventory/components/tabs/ReceivingTab.tsx
import type { PurchaseOrder } from '../../types';
import { isReceivable } from '../../utils/inventoryStatus';

interface ReceivingTabProps {
  purchaseOrders: PurchaseOrder[];
  onReceivePO: (po: PurchaseOrder) => void;
}

export function ReceivingTab({ purchaseOrders, onReceivePO }: ReceivingTabProps) {
  const receivable = purchaseOrders.filter(isReceivable);

  return (
    <table className="w-full text-left border-collapse">
      <thead>
        <tr className="bg-gray-50 border-b border-gray-200 text-[10px] font-bold text-gray-400 uppercase tracking-wider">
          <th className="p-3">Order Number</th>
          <th className="p-3">Supplier</th>
          <th className="p-3 text-right">Items</th>
          <th className="p-3 text-right">Total Amount</th>
          <th className="p-3">Status</th>
          <th className="p-3">Expected Delivery</th>
          <th className="p-3 text-right">Action</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-gray-100 text-xs">
        {receivable.length > 0 ? receivable.map(po => (
          <tr key={po.id} className="hover:bg-gray-50/50">
            <td className="p-3 font-mono font-bold text-gray-900">{po.orderNumber}</td>
            <td className="p-3 font-semibold">{po.supplier}</td>
            <td className="p-3 text-right">{po.itemsCount} items</td>
            <td className="p-3 text-right font-bold">${po.totalAmount.toFixed(2)}</td>
            <td className="p-3">
              <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${po.status === 'Partially Received' ? 'bg-amber-50 text-amber-700' : 'bg-blue-50 text-blue-700'}`}>
                {po.status}
              </span>
            </td>
            <td className="p-3 text-gray-500">{po.deliveryDate}</td>
            <td className="p-3 text-right">
              <button
                onClick={() => onReceivePO(po)}
                className="border border-emerald-600 text-emerald-600 hover:bg-emerald-50 bg-white rounded-lg px-3 py-1 text-[11px] font-semibold transition-colors"
              >
                Receive
              </button>
            </td>
          </tr>
        )) : (
          <tr>
            <td colSpan={7} className="p-8 text-center text-gray-400 font-medium">
              No purchase orders awaiting receipt.
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `cd admin-frontend && npm run typecheck`
Expected: still `3` remaining.

- [ ] **Step 3: Commit**

```bash
git add admin-frontend/src/pages/inventory/components/tabs/ReceivingTab.tsx
git commit -m "inventory: add ReceivingTab (POs awaiting receipt)"
```

---

### Task 13: `MovementsTable` (shared) + rewire the Movements tab + `WasteTab` — resolves the last 3 baseline errors

This replaces the old inline "Tab: Stock Movements" JSX (which has 3 of the original 46 `InventoryPage.tsx` errors, deferred from Task 2) with the new shared `MovementsTable`, and extends Task 10's `InventoryFilters` with the movements-specific type/date-range filters (previously offering dropdown values like `RECEIVE`/`SALE`/`TRANSFER`/"(Legacy)" that never matched the real `StockMovement['type']` union — Global-Constraints bug #3).

**Files:**
- Create: `admin-frontend/src/pages/inventory/components/MovementsTable.tsx`
- Create: `admin-frontend/src/pages/inventory/components/tabs/WasteTab.tsx`
- Modify: `admin-frontend/src/pages/inventory/components/InventoryFilters.tsx` (add movement-specific filters, Task 10)
- Modify: `admin-frontend/src/pages/inventory/InventoryPage.tsx` (delete the old inline Stock-Movements table JSX)

**Interfaces:**
- Consumes: `Icon` (Task 6); `StockMovement` from `../types`.
- Produces:
  ```typescript
  <MovementsTable movements={StockMovement[]} />   // pre-filtered/sorted by caller
  <WasteTab movements={StockMovement[]} onRecordWaste={() => void} />  // caller pre-filters to type === 'SCRAP'
  ```

- [ ] **Step 1: Write `MovementsTable` with real type-badge colors for all 12 real union values**

```typescript
// admin-frontend/src/pages/inventory/components/MovementsTable.tsx
import type { StockMovement } from '../types';

const TYPE_BADGE: Record<StockMovement['type'], string> = {
  RECEIVE_PO: 'bg-emerald-50 text-emerald-700',
  RECEIVE_ADHOC: 'bg-emerald-50 text-emerald-700',
  TRANSFER_IN: 'bg-purple-50 text-purple-700',
  TRANSFER_OUT: 'bg-purple-50 text-purple-700',
  SALE_CONSUMPTION: 'bg-blue-50 text-blue-700',
  RECIPE_CONSUMPTION: 'bg-blue-50 text-blue-700',
  STOCK_ADJUSTMENT: 'bg-amber-50 text-amber-700',
  SCRAP: 'bg-red-50 text-red-700',
  EXPIRED: 'bg-red-50 text-red-700',
  RETURN: 'bg-gray-100 text-gray-600',
  STOCKTAKE: 'bg-teal-50 text-teal-700',
  PURCHASE_RETURN: 'bg-gray-100 text-gray-600',
  SUPPLIER_CREDIT: 'bg-gray-100 text-gray-600'
};

interface MovementsTableProps {
  movements: StockMovement[];
}

export function MovementsTable({ movements }: MovementsTableProps) {
  return (
    <table className="w-full text-left border-collapse">
      <thead>
        <tr className="bg-gray-50 border-b border-gray-200 text-[10px] font-bold text-gray-400 uppercase tracking-wider">
          <th className="p-3">Timestamp</th>
          <th className="p-3">Item</th>
          <th className="p-3">Type</th>
          <th className="p-3 text-right">Quantity</th>
          <th className="p-3 text-right">Value</th>
          <th className="p-3">User</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-gray-100 text-xs">
        {movements.length > 0 ? movements.map(mov => (
          <tr key={mov.id} className="hover:bg-gray-50/50">
            <td className="p-3 text-gray-400 font-mono">{mov.date}</td>
            <td className="p-3 font-bold text-gray-900">{mov.itemName}</td>
            <td className="p-3">
              <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${TYPE_BADGE[mov.type]}`}>{mov.type}</span>
            </td>
            <td className="p-3 text-right font-semibold">{mov.quantity} {mov.unit}</td>
            <td className={`p-3 text-right font-mono font-semibold ${mov.value < 0 ? 'text-red-600' : 'text-gray-900'}`}>${mov.value.toFixed(2)}</td>
            <td className="p-3 text-gray-500">{mov.user}</td>
          </tr>
        )) : (
          <tr>
            <td colSpan={6} className="p-8 text-center text-gray-400 font-medium">No movements found.</td>
          </tr>
        )}
      </tbody>
    </table>
  );
}
```

- [ ] **Step 2: Write `WasteTab`**

```typescript
// admin-frontend/src/pages/inventory/components/tabs/WasteTab.tsx
import type { StockMovement } from '../../types';
import { MovementsTable } from '../MovementsTable';

interface WasteTabProps {
  movements: StockMovement[]; // pre-filtered by caller to type === 'SCRAP'
  onRecordWaste: () => void;
}

export function WasteTab({ movements, onRecordWaste }: WasteTabProps) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex justify-end px-3 pt-3">
        <button
          onClick={onRecordWaste}
          className="border border-emerald-600 text-emerald-600 hover:bg-emerald-50 bg-white rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors"
        >
          Record Waste
        </button>
      </div>
      <MovementsTable movements={movements} />
    </div>
  );
}
```

- [ ] **Step 3: Extend `InventoryFilters` (Task 10) with the movements-specific type/date filters**

Find the closing of the `<div className="flex flex-wrap gap-2 items-center">...quick chips...</div>` in `InventoryFilters.tsx` and add a new conditional block just before it, plus new props. Find:
```typescript
interface InventoryFiltersProps {
  searchQuery: string;
  onSearchChange: (v: string) => void;
```
Replace with:
```typescript
interface InventoryFiltersProps {
  showMovementFilters?: boolean;
  movementTypeFilter?: string;
  onMovementTypeChange?: (v: string) => void;
  movementStartFilter?: string;
  onMovementStartChange?: (v: string) => void;
  movementEndFilter?: string;
  onMovementEndChange?: (v: string) => void;
  searchQuery: string;
  onSearchChange: (v: string) => void;
```

Find:
```typescript
export function InventoryFilters(props: InventoryFiltersProps) {
  const {
    searchQuery, onSearchChange, categoryFilter, onCategoryChange, categories,
    supplierFilter, onSupplierChange, suppliers, venueFilter, onVenueChange, venues,
    statusFilter, onStatusChange, stockLevelFilter, onStockLevelChange,
    activeChip, onChipChange, density, onDensityChange, onClearAll
  } = props;
```
Replace with:
```typescript
const MOVEMENT_TYPES: { value: string; label: string }[] = [
  { value: 'all', label: 'All Movement Types' },
  { value: 'RECEIVE_PO', label: 'Receive (PO)' },
  { value: 'RECEIVE_ADHOC', label: 'Receive (Ad-hoc)' },
  { value: 'TRANSFER_IN', label: 'Transfer In' },
  { value: 'TRANSFER_OUT', label: 'Transfer Out' },
  { value: 'SALE_CONSUMPTION', label: 'Sale Consumption' },
  { value: 'RECIPE_CONSUMPTION', label: 'Recipe Consumption' },
  { value: 'STOCK_ADJUSTMENT', label: 'Stock Adjustment' },
  { value: 'SCRAP', label: 'Scrap / Waste' },
  { value: 'EXPIRED', label: 'Expired' },
  { value: 'RETURN', label: 'Return' },
  { value: 'STOCKTAKE', label: 'Stocktake' },
  { value: 'PURCHASE_RETURN', label: 'Purchase Return' },
  { value: 'SUPPLIER_CREDIT', label: 'Supplier Credit' }
];

export function InventoryFilters(props: InventoryFiltersProps) {
  const {
    showMovementFilters, movementTypeFilter = 'all', onMovementTypeChange,
    movementStartFilter = '', onMovementStartChange, movementEndFilter = '', onMovementEndChange,
    searchQuery, onSearchChange, categoryFilter, onCategoryChange, categories,
    supplierFilter, onSupplierChange, suppliers, venueFilter, onVenueChange, venues,
    statusFilter, onStatusChange, stockLevelFilter, onStockLevelChange,
    activeChip, onChipChange, density, onDensityChange, onClearAll
  } = props;
```

Find (the closing `</div>` right after the density/settings block, before the quick-chips row):
```typescript
        </div>
      </div>

      <div className="flex flex-wrap gap-2 items-center">
        <button onClick={() => onChipChange('all')} className={chipClass(activeChip === 'all')}>All Items</button>
```
Replace with:
```typescript
        </div>
      </div>

      {showMovementFilters && (
        <div className="flex flex-wrap gap-2 items-center">
          <select value={movementTypeFilter} onChange={e => onMovementTypeChange?.(e.target.value)} className={selectClass}>
            {MOVEMENT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
          <div className="flex items-center gap-1">
            <span className="text-[9px] text-gray-400 font-bold uppercase whitespace-nowrap">Date:</span>
            <input type="date" value={movementStartFilter} onChange={e => onMovementStartChange?.(e.target.value)} className="h-8 px-1.5 text-xs bg-white border border-gray-300 rounded-lg text-gray-700 focus:outline-none focus:border-emerald-500 font-semibold cursor-pointer" title="Start Date" />
            <span className="text-gray-300 text-xs">-</span>
            <input type="date" value={movementEndFilter} onChange={e => onMovementEndChange?.(e.target.value)} className="h-8 px-1.5 text-xs bg-white border border-gray-300 rounded-lg text-gray-700 focus:outline-none focus:border-emerald-500 font-semibold cursor-pointer" title="End Date" />
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-2 items-center">
        <button onClick={() => onChipChange('all')} className={chipClass(activeChip === 'all')}>All Items</button>
```

- [ ] **Step 4: Delete the old inline "Tab: Stock Movements" JSX from `InventoryPage.tsx`**

Find and delete the entire block:
```jsx
            {/* Tab: Stock Movements */}
            {tab === 'movements' && (
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200 text-[10px] font-bold text-gray-400 uppercase tracking-wider">
                    <th className="p-3">Timestamp</th>
                    <th className="p-3">Item</th>
                    <th className="p-3">Type</th>
                    <th className="p-3 text-right">Quantity</th>
                    <th className="p-3 text-right">Value</th>
                    <th className="p-3">User</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 text-xs">
                  {filteredMovements.map(mov => {
                    let typeBg = 'bg-blue-50 text-blue-700';
                    if (mov.type === 'Consumed') typeBg = 'bg-amber-50 text-amber-700';
                    if (mov.type === 'Waste') typeBg = 'bg-red-50 text-red-700';
                    if (mov.type === 'Received') typeBg = 'bg-emerald-50 text-emerald-700';

                    return (
                      <tr key={mov.id} className="hover:bg-gray-50/50">
                        <td className="p-3 text-gray-400 font-mono">{mov.date}</td>
                        <td className="p-3 font-bold text-gray-900">{mov.itemName}</td>
                        <td className="p-3">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${typeBg}`}>{mov.type}</span>
                        </td>
                        <td className="p-3 text-right font-semibold">{mov.quantity} {mov.unit}</td>
```
(and the remainder of that block through its matching closing `)}` — this is a full mechanical deletion of one conditional JSX block, replaced by `<MovementsTable movements={filteredMovements} />` in Task 18's final composition, so no replacement text is needed here, only removal.)

- [ ] **Step 5: Typecheck**

Run: `cd admin-frontend && npm run typecheck`
Expected: `0` errors — all originally-identified 168 baseline errors are now resolved.
```bash
npm run typecheck 2>&1 | grep -c "error TS"
```
Expected output: `0`

- [ ] **Step 6: Commit**

```bash
git add admin-frontend/src/pages/inventory/components/MovementsTable.tsx admin-frontend/src/pages/inventory/components/tabs/WasteTab.tsx admin-frontend/src/pages/inventory/components/InventoryFilters.tsx admin-frontend/src/pages/inventory/InventoryPage.tsx
git commit -m "inventory: add MovementsTable and WasteTab, fix movement-type filter mismatch (last baseline errors resolved)"
```

---

### Task 14: `TransfersTab` + `TransferStockDialog` — wires up the dead `initialTransfers` export

**Files:**
- Create: `admin-frontend/src/pages/inventory/components/tabs/TransfersTab.tsx`
- Create: `admin-frontend/src/pages/inventory/components/dialogs/TransferStockDialog.tsx`
- Modify: `admin-frontend/src/pages/inventory/InventoryPage.tsx` (add `transfers`/`isTransferStockOpen`/`transferDraft` state, import `initialTransfers`/`InventoryTransfer`)

**Interfaces:**
- Consumes: `InventoryTransfer`, `InventoryItem` from `../../types`.
- Produces:
  ```typescript
  <TransfersTab transfers={InventoryTransfer[]} />
  <TransferStockDialog
    isOpen={boolean} onClose={() => void}
    items={InventoryItem[]} venues={string[]}
    draft={{ itemId: string; fromVenue: string; toVenue: string; quantity: number; notes: string }}
    onDraftChange={(patch: Partial<...>) => void}
    onSubmit={(e: React.FormEvent) => void}
  />
  ```

- [ ] **Step 1: Add `transfers` state to `InventoryPage.tsx`**

Find:
```typescript
  const [stocktakes, setStocktakes] = useState<StocktakeRecord[]>(initialStocktakes);
```
Replace with:
```typescript
  const [stocktakes, setStocktakes] = useState<StocktakeRecord[]>(initialStocktakes);
  const [transfers, setTransfers] = useState<InventoryTransfer[]>(initialTransfers);
```

Find:
```typescript
import { initialItems, initialPurchaseOrders, initialSuppliers, initialStockMovements, initialRecipes, initialStocktakes } from './mockData';
import { InventoryItem, PurchaseOrder, Supplier, StockMovement, Recipe, StocktakeRecord, InventoryBatch } from './types';
```
Replace with:
```typescript
import { initialItems, initialPurchaseOrders, initialSuppliers, initialStockMovements, initialRecipes, initialStocktakes, initialTransfers } from './mockData';
import { InventoryItem, PurchaseOrder, Supplier, StockMovement, Recipe, StocktakeRecord, InventoryBatch, InventoryTransfer } from './types';
```

Find:
```typescript
  const [poDraft, setPoDraft] = useState({
    supplier: 'Fresh Foods Ltd',
    items: [{ name: 'Chicken Breast', quantity: 80, unit: 'kg', estimatedCost: 12.50 }]
  });
```
Replace with:
```typescript
  const [poDraft, setPoDraft] = useState({
    supplier: 'Fresh Foods Ltd',
    items: [{ name: 'Chicken Breast', quantity: 80, unit: 'kg', estimatedCost: 12.50 }]
  });

  const [isTransferStockOpen, setIsTransferStockOpen] = useState(false);
  const [transferDraft, setTransferDraft] = useState({
    itemId: '', fromVenue: 'All Venues', toVenue: 'All Venues', quantity: 0, notes: ''
  });

  const handleTransferSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const targetItem = items.find(i => i.id === transferDraft.itemId);
    if (!targetItem || transferDraft.quantity <= 0) return;

    const newTransfer: InventoryTransfer = {
      id: `trsf-${Date.now()}`,
      transferNumber: `TRSF-${String(transfers.length + 1).padStart(3, '0')}`,
      fromVenue: transferDraft.fromVenue,
      toVenue: transferDraft.toVenue,
      status: 'Pending',
      date: new Date().toISOString().substring(0, 10),
      items: [{ productId: targetItem.id, name: targetItem.name, quantity: transferDraft.quantity, unit: targetItem.unit, cost: targetItem.cost }],
      notes: transferDraft.notes || undefined
    };
    setTransfers(prev => [newTransfer, ...prev]);
    setIsTransferStockOpen(false);
    setTransferDraft({ itemId: '', fromVenue: 'All Venues', toVenue: 'All Venues', quantity: 0, notes: '' });
    showToast(`Transfer ${newTransfer.transferNumber} created.`, 'success');
  };
```

- [ ] **Step 2: Write `TransfersTab`**

```typescript
// admin-frontend/src/pages/inventory/components/tabs/TransfersTab.tsx
import type { InventoryTransfer } from '../../types';

const STATUS_BADGE: Record<InventoryTransfer['status'], string> = {
  Pending: 'bg-amber-50 text-amber-700',
  Received: 'bg-emerald-50 text-emerald-700',
  Rejected: 'bg-red-50 text-red-700'
};

interface TransfersTabProps {
  transfers: InventoryTransfer[];
}

export function TransfersTab({ transfers }: TransfersTabProps) {
  return (
    <table className="w-full text-left border-collapse">
      <thead>
        <tr className="bg-gray-50 border-b border-gray-200 text-[10px] font-bold text-gray-400 uppercase tracking-wider">
          <th className="p-3">Transfer #</th>
          <th className="p-3">From</th>
          <th className="p-3">To</th>
          <th className="p-3">Items</th>
          <th className="p-3">Status</th>
          <th className="p-3">Date</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-gray-100 text-xs">
        {transfers.length > 0 ? transfers.map(t => (
          <tr key={t.id} className="hover:bg-gray-50/50">
            <td className="p-3 font-mono font-bold text-gray-900">{t.transferNumber}</td>
            <td className="p-3 text-gray-500">{t.fromVenue}</td>
            <td className="p-3 text-gray-500">{t.toVenue}</td>
            <td className="p-3 text-gray-700">{t.items.map(i => `${i.name} (${i.quantity} ${i.unit})`).join(', ')}</td>
            <td className="p-3"><span className={`px-2 py-0.5 rounded text-[10px] font-bold ${STATUS_BADGE[t.status]}`}>{t.status}</span></td>
            <td className="p-3 text-gray-500">{t.date}</td>
          </tr>
        )) : (
          <tr><td colSpan={6} className="p-8 text-center text-gray-400 font-medium">No transfers recorded.</td></tr>
        )}
      </tbody>
    </table>
  );
}
```

- [ ] **Step 3: Write `TransferStockDialog`**

```typescript
// admin-frontend/src/pages/inventory/components/dialogs/TransferStockDialog.tsx
import { Icon } from '../Icon';
import type { InventoryItem } from '../../types';

interface TransferDraft {
  itemId: string;
  fromVenue: string;
  toVenue: string;
  quantity: number;
  notes: string;
}

interface TransferStockDialogProps {
  isOpen: boolean;
  onClose: () => void;
  items: InventoryItem[];
  venues: string[];
  draft: TransferDraft;
  onDraftChange: (patch: Partial<TransferDraft>) => void;
  onSubmit: (e: React.FormEvent) => void;
}

export function TransferStockDialog({ isOpen, onClose, items, venues, draft, onDraftChange, onSubmit }: TransferStockDialogProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-gray-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fadeIn">
      <div className="bg-white border border-gray-200 rounded-xl shadow-xl max-w-md w-full overflow-hidden animate-slideUp">
        <div className="p-4 border-b border-gray-200 flex justify-between items-center bg-gray-50/50">
          <h3 className="text-sm font-black text-gray-900 uppercase tracking-wide">Transfer Stock</h3>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-200 text-gray-400 hover:text-gray-600 transition-colors">
            <Icon name="cross" size={16} />
          </button>
        </div>

        <form onSubmit={onSubmit} className="p-4 flex flex-col gap-3 text-xs">
          <div className="flex flex-col gap-1">
            <label className="font-bold text-gray-400 uppercase tracking-wider">Item</label>
            <select required value={draft.itemId} onChange={e => onDraftChange({ itemId: e.target.value })} className="w-full h-8 px-2.5 border border-gray-300 rounded focus:outline-none focus:border-emerald-500 cursor-pointer">
              <option value="" disabled>-- Select Inventory Item --</option>
              {items.map(item => <option key={item.id} value={item.id}>{item.name} ({item.sku})</option>)}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <label className="font-bold text-gray-400 uppercase tracking-wider">From Venue</label>
              <select value={draft.fromVenue} onChange={e => onDraftChange({ fromVenue: e.target.value })} className="w-full h-8 px-2.5 border border-gray-300 rounded focus:outline-none focus:border-emerald-500 cursor-pointer">
                {venues.map(v => <option key={v} value={v}>{v}</option>)}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="font-bold text-gray-400 uppercase tracking-wider">To Venue</label>
              <select value={draft.toVenue} onChange={e => onDraftChange({ toVenue: e.target.value })} className="w-full h-8 px-2.5 border border-gray-300 rounded focus:outline-none focus:border-emerald-500 cursor-pointer">
                {venues.map(v => <option key={v} value={v}>{v}</option>)}
              </select>
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <label className="font-bold text-gray-400 uppercase tracking-wider">Quantity</label>
            <input type="number" required min={1} value={draft.quantity || ''} onChange={e => onDraftChange({ quantity: Number(e.target.value) })} className="w-full h-8 px-2.5 border border-gray-300 rounded focus:outline-none focus:border-emerald-500" />
          </div>

          <div className="flex flex-col gap-1">
            <label className="font-bold text-gray-400 uppercase tracking-wider">Notes (optional)</label>
            <textarea value={draft.notes} onChange={e => onDraftChange({ notes: e.target.value })} rows={2} className="w-full px-2.5 py-1.5 border border-gray-300 rounded focus:outline-none focus:border-emerald-500" />
          </div>

          <div className="flex gap-2 justify-end border-t border-gray-100 pt-3 mt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 border border-gray-300 rounded text-gray-600 font-semibold hover:bg-gray-50 transition-colors">Cancel</button>
            <button type="submit" className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded font-bold transition-colors">Create Transfer</button>
          </div>
        </form>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Typecheck**

Run: `cd admin-frontend && npm run typecheck`
Expected: `0` errors.

- [ ] **Step 5: Commit**

```bash
git add admin-frontend/src/pages/inventory/components/tabs/TransfersTab.tsx admin-frontend/src/pages/inventory/components/dialogs/TransferStockDialog.tsx admin-frontend/src/pages/inventory/InventoryPage.tsx
git commit -m "inventory: add TransfersTab and TransferStockDialog, wire up dead initialTransfers export"
```

---

### Task 15: `ReportsTab`

Real, derived analytics — not the store-wide `pages/reports/ReportsPage.tsx` (a different, unrelated page), but inventory-specific breakdowns computed from the same `items`/`stockMovements` arrays every other tab uses. Self-contained: computes its own `useMemo`s from props rather than requiring new state in `InventoryPage.tsx`.

**Files:**
- Create: `admin-frontend/src/pages/inventory/components/tabs/ReportsTab.tsx`

**Interfaces:**
- Consumes: `getStockStatus` (Task 1); `InventoryItem`, `StockMovement` from `../../types`.
- Produces: `<ReportsTab items={InventoryItem[]} stockMovements={StockMovement[]} />`.

- [ ] **Step 1: Write the component**

```typescript
// admin-frontend/src/pages/inventory/components/tabs/ReportsTab.tsx
import { useMemo } from 'react';
import type { InventoryItem, StockMovement } from '../../types';
import { getStockStatus } from '../../utils/inventoryStatus';

interface ReportsTabProps {
  items: InventoryItem[];
  stockMovements: StockMovement[];
}

export function ReportsTab({ items, stockMovements }: ReportsTabProps) {
  const valueByCategory = useMemo(() => {
    const map = new Map<string, number>();
    items.forEach(it => map.set(it.category, (map.get(it.category) ?? 0) + it.onHand * it.cost));
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
  }, [items]);

  const wasteByCategory7d = useMemo(() => {
    const sevenDaysAgo = new Date(new Date('2026-07-02').getTime() - 7 * 24 * 60 * 60 * 1000);
    const itemCategoryById = new Map(items.map(it => [it.id, it.category]));
    const map = new Map<string, number>();
    stockMovements
      .filter(m => m.type === 'SCRAP' && new Date(m.date).getTime() >= sevenDaysAgo.getTime())
      .forEach(m => {
        const category = (m.productId && itemCategoryById.get(m.productId)) || 'Unknown';
        map.set(category, (map.get(category) ?? 0) + Math.abs(m.value));
      });
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
  }, [items, stockMovements]);

  const lowStockByVenue = useMemo(() => {
    const map = new Map<string, number>();
    items.forEach(it => {
      const status = getStockStatus(it);
      if (status === 'Low Stock' || status === 'Critical' || status === 'Zero Stock') {
        map.set(it.venue, (map.get(it.venue) ?? 0) + 1);
      }
    });
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
  }, [items]);

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 p-4">
      <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
        <h3 className="text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-3">Inventory Value by Category</h3>
        <div className="flex flex-col gap-2 text-xs">
          {valueByCategory.map(([category, value]) => (
            <div key={category} className="flex justify-between">
              <span className="text-gray-700 font-medium">{category}</span>
              <span className="font-bold text-gray-900">${value.toFixed(2)}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
        <h3 className="text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-3">Waste (7d) by Category</h3>
        <div className="flex flex-col gap-2 text-xs">
          {wasteByCategory7d.length > 0 ? wasteByCategory7d.map(([category, value]) => (
            <div key={category} className="flex justify-between">
              <span className="text-gray-700 font-medium">{category}</span>
              <span className="font-bold text-red-600">${value.toFixed(2)}</span>
            </div>
          )) : <span className="text-gray-400">No waste recorded in the last 7 days.</span>}
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
        <h3 className="text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-3">Low/Critical/Zero Stock by Venue</h3>
        <div className="flex flex-col gap-2 text-xs">
          {lowStockByVenue.length > 0 ? lowStockByVenue.map(([venue, count]) => (
            <div key={venue} className="flex justify-between">
              <span className="text-gray-700 font-medium">{venue}</span>
              <span className="font-bold text-amber-600">{count} item{count === 1 ? '' : 's'}</span>
            </div>
          )) : <span className="text-gray-400">No items below par level.</span>}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `cd admin-frontend && npm run typecheck`
Expected: `0` errors.

- [ ] **Step 3: Commit**

```bash
git add admin-frontend/src/pages/inventory/components/tabs/ReportsTab.tsx
git commit -m "inventory: add ReportsTab with derived value/waste/low-stock breakdowns"
```

---

### Task 16: `AlertsTab`

The full-list version of what the Operations Inbox card row (Task 8) summarizes — same `OperationsInboxMetrics` (Task 4), just unpaginated/untruncated with per-row detail, instead of a 7-card summary.

**Files:**
- Create: `admin-frontend/src/pages/inventory/components/tabs/AlertsTab.tsx`

**Interfaces:**
- Consumes: `OperationsInboxMetrics` (Task 4); `Icon` (Task 6); `getStockStatus`, `getExpiryInfo` (Task 1).
- Produces: `<AlertsTab metrics={OperationsInboxMetrics} />`.

- [ ] **Step 1: Write the component**

```typescript
// admin-frontend/src/pages/inventory/components/tabs/AlertsTab.tsx
import { Icon } from '../Icon';
import type { OperationsInboxMetrics } from '../../utils/operationsInbox';
import { getStockStatus, getStatusBadgeStyle, getExpiryInfo } from '../../utils/inventoryStatus';

interface AlertsTabProps {
  metrics: OperationsInboxMetrics;
}

export function AlertsTab({ metrics }: AlertsTabProps) {
  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
        <h3 className="text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-3">
          Critical Stock ({metrics.criticalStock.count})
        </h3>
        {metrics.criticalStock.items.length > 0 ? (
          <div className="flex flex-col divide-y divide-gray-100">
            {metrics.criticalStock.items.map(item => {
              const badge = getStatusBadgeStyle(getStockStatus(item));
              return (
                <div key={item.id} className="flex items-center justify-between py-2 text-xs">
                  <span className="font-semibold text-gray-800">{item.name}</span>
                  <div className="flex items-center gap-3">
                    <span className="text-gray-500">{item.onHand} / {item.min} {item.unit}</span>
                    <span className={`px-2 py-0.5 rounded text-[10px] font-extrabold uppercase ${badge.bg}`}>{badge.label}</span>
                  </div>
                </div>
              );
            })}
          </div>
        ) : <span className="text-xs text-gray-400">No items currently critical or out of stock.</span>}
      </div>

      <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
        <h3 className="text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-3">
          Expiring Soon ({metrics.expiringSoon.count})
        </h3>
        {metrics.expiringSoon.items.length > 0 ? (
          <div className="flex flex-col divide-y divide-gray-100">
            {metrics.expiringSoon.items.map(item => {
              const info = getExpiryInfo(item);
              return (
                <div key={item.id} className="flex items-center justify-between py-2 text-xs">
                  <span className="font-semibold text-gray-800">{item.name}</span>
                  {info && <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${info.className}`}>{info.text}</span>}
                </div>
              );
            })}
          </div>
        ) : <span className="text-xs text-gray-400">No items expiring within 7 days.</span>}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Icon name="truck" size={14} className="text-red-500" />
            <span className="text-xs font-semibold text-gray-700">Overdue Deliveries</span>
          </div>
          <span className="text-sm font-black text-red-600">{metrics.deliveriesToday.overdueCount}</span>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Icon name="alert" size={14} className="text-amber-500" />
            <span className="text-xs font-semibold text-gray-700">Variances</span>
          </div>
          <span className="text-sm font-black text-amber-600">{metrics.variances.count} (${metrics.variances.totalAmount.toFixed(2)})</span>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `cd admin-frontend && npm run typecheck`
Expected: `0` errors.

- [ ] **Step 3: Commit**

```bash
git add admin-frontend/src/pages/inventory/components/tabs/AlertsTab.tsx
git commit -m "inventory: add AlertsTab (full Operations Inbox detail view)"
```

---

### Task 17: 5 right-sidebar widgets

Fixes the last of Global-Constraints bug #5: `StockCoverageCard`'s 4 rows are now derived (`sum(onHand) / sum(avgUsage)` per category, taking the 4 lowest-coverage categories — the most at-risk, matching the image's intent), and `WasteTrackingCard` now reads the same `wasteSummary` (Task 3) the KPI grid's "Today's Waste" card conceptually relates to, instead of an unrelated hardcoded number. `SupplierPerformanceCard` is a pure extraction (already correctly wired to real `suppliers` data in the current code) — no logic change.

**Files:**
- Create: `admin-frontend/src/pages/inventory/components/sidebar/OperationsInboxDetailed.tsx`
- Create: `admin-frontend/src/pages/inventory/components/sidebar/StockCoverageCard.tsx`
- Create: `admin-frontend/src/pages/inventory/components/sidebar/AIAssistantCard.tsx`
- Create: `admin-frontend/src/pages/inventory/components/sidebar/WasteTrackingCard.tsx`
- Create: `admin-frontend/src/pages/inventory/components/sidebar/SupplierPerformanceCard.tsx`

**Interfaces:**
- Consumes: `Icon` (Task 6); `OperationsInboxMetrics` (Task 4); `InventoryItem`, `Supplier` from `../../types`; `wasteSummary`, `aiInsights` shape from `../../mockData` (Task 3).
- Produces:
  ```typescript
  <OperationsInboxDetailed metrics={OperationsInboxMetrics} />
  <StockCoverageCard items={InventoryItem[]} />
  <AIAssistantCard insights={string[]} />
  <WasteTrackingCard summary={{ today: number; thisWeek: number; topItems: { name: string; amount: number }[] }} />
  <SupplierPerformanceCard suppliers={Supplier[]} onViewAll={() => void} />
  ```

- [ ] **Step 1: Write `OperationsInboxDetailed`**

```typescript
// admin-frontend/src/pages/inventory/components/sidebar/OperationsInboxDetailed.tsx
import type { OperationsInboxMetrics } from '../../utils/operationsInbox';

interface OperationsInboxDetailedProps {
  metrics: OperationsInboxMetrics;
}

export function OperationsInboxDetailed({ metrics }: OperationsInboxDetailedProps) {
  const rows: { label: string; value: string; danger?: boolean }[] = [
    { label: 'POs to Receive', value: `${metrics.posToReceive.count} · $${metrics.posToReceive.totalAmount.toFixed(2)}` },
    { label: 'Deliveries Today', value: `${metrics.deliveriesToday.count}`, danger: metrics.deliveriesToday.overdueCount > 0 },
    { label: 'Expiring Soon', value: `${metrics.expiringSoon.count}` },
    { label: 'Stocktakes Due', value: `${metrics.stocktakesDue.count}` },
    { label: 'High Waste (7d)', value: `$${metrics.highWaste7d.amount.toFixed(2)}`, danger: true },
    { label: 'Variances', value: `${metrics.variances.count} · $${metrics.variances.totalAmount.toFixed(2)}` }
  ];

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
      <div className="flex justify-between items-center mb-3">
        <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider select-none">Operations Inbox (Detailed)</span>
        <span className="text-emerald-700 text-[10px] font-bold select-none">View all →</span>
      </div>
      <div className="flex flex-col divide-y divide-gray-100">
        {rows.map(row => (
          <div key={row.label} className="flex items-center justify-between py-1.5 text-xs">
            <span className="font-semibold text-gray-700">{row.label}</span>
            <span className={`font-bold ${row.danger ? 'text-red-600' : 'text-gray-900'}`}>{row.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Write `StockCoverageCard`**

```typescript
// admin-frontend/src/pages/inventory/components/sidebar/StockCoverageCard.tsx
import type { InventoryItem } from '../../types';

interface StockCoverageCardProps {
  items: InventoryItem[];
}

export function StockCoverageCard({ items }: StockCoverageCardProps) {
  const byCategory = new Map<string, { onHand: number; avgUsage: number }>();
  items.forEach(it => {
    const entry = byCategory.get(it.category) ?? { onHand: 0, avgUsage: 0 };
    entry.onHand += it.onHand;
    entry.avgUsage += it.avgUsage;
    byCategory.set(it.category, entry);
  });

  const coverage = Array.from(byCategory.entries())
    .map(([category, { onHand, avgUsage }]) => ({
      category,
      days: avgUsage > 0 ? Math.round(onHand / avgUsage) : 0
    }))
    .sort((a, b) => a.days - b.days)
    .slice(0, 4);

  const maxDays = Math.max(...coverage.map(c => c.days), 1);

  const barColor = (days: number) => (days <= 3 ? 'bg-red-500' : days <= 7 ? 'bg-amber-500' : 'bg-emerald-500');
  const textColor = (days: number) => (days <= 3 ? 'text-red-600' : days <= 7 ? 'text-amber-600' : 'text-emerald-600');

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
      <div className="flex justify-between items-center mb-3">
        <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider select-none">Stock Coverage (Days)</span>
        <span className="text-emerald-700 text-[10px] font-bold select-none">View full report →</span>
      </div>
      <div className="flex flex-col gap-3.5 select-none">
        {coverage.map(c => (
          <div key={c.category} className="flex flex-col gap-1">
            <div className="flex justify-between text-xs">
              <span className="font-semibold text-gray-700">{c.category}</span>
              <span className={`font-bold ${textColor(c.days)}`}>{c.days} day{c.days === 1 ? '' : 's'}</span>
            </div>
            <div className="w-full bg-gray-100 rounded-full h-1.5 overflow-hidden">
              <div className={`h-full rounded-full ${barColor(c.days)}`} style={{ width: `${Math.min(100, (c.days / maxDays) * 100)}%` }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Write `AIAssistantCard`**

```typescript
// admin-frontend/src/pages/inventory/components/sidebar/AIAssistantCard.tsx
interface AIAssistantCardProps {
  insights: string[];
}

export function AIAssistantCard({ insights }: AIAssistantCardProps) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
      <div className="flex justify-between items-center mb-3">
        <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider select-none">AI Inventory Assistant</span>
        <span className="text-emerald-700 text-[10px] font-bold select-none">View all insights →</span>
      </div>
      <div className="flex flex-col gap-2.5">
        {insights.map((insight, idx) => (
          <div key={idx} className="flex gap-2 text-xs text-gray-700 leading-snug">
            <span className="text-emerald-600 shrink-0">●</span>
            <span>{insight}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Write `WasteTrackingCard`**

```typescript
// admin-frontend/src/pages/inventory/components/sidebar/WasteTrackingCard.tsx
interface WasteTrackingCardProps {
  summary: { today: number; thisWeek: number; topItems: { name: string; amount: number }[] };
}

export function WasteTrackingCard({ summary }: WasteTrackingCardProps) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
      <div className="flex justify-between items-center mb-3">
        <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider select-none">Waste Tracking (Today)</span>
        <span className="text-emerald-700 text-[10px] font-bold select-none">View report →</span>
      </div>
      <div className="flex flex-col gap-3 select-none">
        <div className="flex justify-between items-baseline border-b border-gray-100 pb-2.5">
          <div className="flex flex-col">
            <span className="text-[10px] text-gray-400 font-semibold uppercase">Today's Waste</span>
            <span className="text-lg font-black text-red-600 leading-none mt-1">${summary.today.toFixed(2)}</span>
          </div>
          <div className="flex flex-col items-end">
            <span className="text-[9px] text-gray-400">This Week</span>
            <span className="text-xs font-bold text-gray-700">${summary.thisWeek.toFixed(2)}</span>
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <span className="text-[10px] font-bold text-gray-400 uppercase">Most Wasted Items</span>
          <div className="flex flex-col gap-1.5">
            {summary.topItems.map((item, idx) => (
              <div key={item.name} className="flex justify-between text-xs font-semibold text-gray-700">
                <span>{idx + 1}. {item.name}</span>
                <span className="font-bold text-gray-900">${item.amount.toFixed(2)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Write `SupplierPerformanceCard`** (pure extraction, logic unchanged)

```typescript
// admin-frontend/src/pages/inventory/components/sidebar/SupplierPerformanceCard.tsx
import { Icon } from '../Icon';
import type { Supplier } from '../../types';

interface SupplierPerformanceCardProps {
  suppliers: Supplier[];
  onViewAll: () => void;
}

export function SupplierPerformanceCard({ suppliers, onViewAll }: SupplierPerformanceCardProps) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
      <div className="flex justify-between items-center mb-3">
        <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider select-none">Supplier Performance</span>
        <button onClick={onViewAll} className="text-emerald-700 hover:text-emerald-800 text-[10px] font-bold transition-colors select-none">
          View all
        </button>
      </div>
      <table className="w-full text-left border-collapse select-none">
        <thead>
          <tr className="text-[9px] font-bold text-gray-400 uppercase border-b border-gray-100">
            <th className="pb-1.5 font-semibold">Supplier</th>
            <th className="pb-1.5 text-right font-semibold">On Time</th>
            <th className="pb-1.5 text-right font-semibold">Lead</th>
            <th className="pb-1.5 text-right font-semibold">Trend</th>
          </tr>
        </thead>
        <tbody className="text-xs divide-y divide-gray-50">
          {suppliers.slice(0, 4).map(sup => (
            <tr key={sup.id} className="text-gray-700">
              <td className="py-2 font-bold truncate max-w-[80px]">{sup.name}</td>
              <td className={`py-2 text-right font-semibold ${sup.onTimeRate >= 95 ? 'text-emerald-600' : 'text-amber-600'}`}>{sup.onTimeRate}%</td>
              <td className="py-2 text-right text-gray-500">{sup.leadTimeDays}d</td>
              <td className="py-2 text-right">
                <span className={`inline-flex shrink-0 ${sup.trend === 'up' ? 'text-emerald-600' : 'text-red-500'}`}>
                  <Icon name={sup.trend === 'up' ? 'arrow-up' : 'arrow-down'} size={12} />
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 6: Typecheck**

Run: `cd admin-frontend && npm run typecheck`
Expected: `0` errors.

- [ ] **Step 7: Commit**

```bash
git add admin-frontend/src/pages/inventory/components/sidebar/
git commit -m "inventory: add 5 sidebar widgets, derive Stock Coverage and Waste Tracking from real data"
```

---

### Task 18: Build the 4 missing dialogs (Adjustment, Waste, Expiry, History) — fixes Global-Constraints bug #8

These 4 row-menu actions have working submit handlers (`handleAdjustmentSubmit`, `handleWasteSubmit`, `handleExpirySubmit`, all unchanged) but no modal to open — clicking them today does nothing visible. Each new dialog also gets an item-select dropdown shown only when `itemId` is empty, so the Task 6 command bar's promoted "Stock Adjustment"/"Record Waste" top-level buttons (which have no row context) work too, not just the row-menu entry points.

**Files:**
- Create: `admin-frontend/src/pages/inventory/components/dialogs/AdjustmentDialog.tsx`
- Create: `admin-frontend/src/pages/inventory/components/dialogs/WasteDialog.tsx`
- Create: `admin-frontend/src/pages/inventory/components/dialogs/ExpiryDialog.tsx`
- Create: `admin-frontend/src/pages/inventory/components/dialogs/HistoryDialog.tsx`

**Interfaces:**
- Consumes: `Icon` (Task 6); `InventoryItem`, `StockMovement` from `../../types`.
- Produces:
  ```typescript
  <AdjustmentDialog isOpen onClose items={InventoryItem[]}
    draft={{itemId,adjustedQty,reason,notes}} onDraftChange onSubmit />
  <WasteDialog isOpen onClose items={InventoryItem[]}
    draft={{itemId,quantity,reason,notes}} onDraftChange onSubmit />
  <ExpiryDialog isOpen onClose item={InventoryItem | null}
    draft={{itemId,batchId,quantity,notes}} onDraftChange onSubmit />
  <HistoryDialog isOpen onClose itemName={string} movements={StockMovement[]} />
  ```

- [ ] **Step 1: Write `AdjustmentDialog`**

```typescript
// admin-frontend/src/pages/inventory/components/dialogs/AdjustmentDialog.tsx
import { Icon } from '../Icon';
import type { InventoryItem } from '../../types';

type AdjustmentReason = 'Physical Count' | 'Lost' | 'Found' | 'Theft' | 'Damage' | 'Manual Correction' | 'Supplier Error' | 'Other';
interface AdjustmentDraft { itemId: string; adjustedQty: number; reason: AdjustmentReason; notes: string; }

interface AdjustmentDialogProps {
  isOpen: boolean;
  onClose: () => void;
  items: InventoryItem[];
  draft: AdjustmentDraft;
  onDraftChange: (patch: Partial<AdjustmentDraft>) => void;
  onSubmit: (e: React.FormEvent) => void;
}

const REASONS: AdjustmentReason[] = ['Physical Count', 'Lost', 'Found', 'Theft', 'Damage', 'Manual Correction', 'Supplier Error', 'Other'];

export function AdjustmentDialog({ isOpen, onClose, items, draft, onDraftChange, onSubmit }: AdjustmentDialogProps) {
  if (!isOpen) return null;
  const selectedItem = items.find(i => i.id === draft.itemId);

  return (
    <div className="fixed inset-0 bg-gray-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fadeIn">
      <div className="bg-white border border-gray-200 rounded-xl shadow-xl max-w-md w-full overflow-hidden animate-slideUp">
        <div className="p-4 border-b border-gray-200 flex justify-between items-center bg-gray-50/50">
          <h3 className="text-sm font-black text-gray-900 uppercase tracking-wide">Adjust Stock</h3>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-200 text-gray-400 hover:text-gray-600 transition-colors">
            <Icon name="cross" size={16} />
          </button>
        </div>
        <form onSubmit={onSubmit} className="p-4 flex flex-col gap-3 text-xs">
          <div className="flex flex-col gap-1">
            <label className="font-bold text-gray-400 uppercase tracking-wider">Item</label>
            <select required value={draft.itemId} onChange={e => onDraftChange({ itemId: e.target.value })} className="w-full h-8 px-2.5 border border-gray-300 rounded focus:outline-none focus:border-emerald-500 cursor-pointer">
              <option value="" disabled>-- Select Inventory Item --</option>
              {items.map(item => <option key={item.id} value={item.id}>{item.name} ({item.sku})</option>)}
            </select>
          </div>
          {selectedItem && (
            <div className="p-2 bg-gray-50 border border-gray-200 rounded text-[11px] text-gray-500 font-semibold">
              Current on hand: <b className="text-gray-700">{selectedItem.onHand} {selectedItem.unit}</b>
            </div>
          )}
          <div className="flex flex-col gap-1">
            <label className="font-bold text-gray-400 uppercase tracking-wider">Adjustment (+/-)</label>
            <input type="number" required value={draft.adjustedQty || ''} onChange={e => onDraftChange({ adjustedQty: Number(e.target.value) })} placeholder="e.g. -5 or 10" className="w-full h-8 px-2.5 border border-gray-300 rounded focus:outline-none focus:border-emerald-500" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="font-bold text-gray-400 uppercase tracking-wider">Reason</label>
            <select required value={draft.reason} onChange={e => onDraftChange({ reason: e.target.value as AdjustmentReason })} className="w-full h-8 px-2.5 border border-gray-300 rounded focus:outline-none focus:border-emerald-500 cursor-pointer">
              {REASONS.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="font-bold text-gray-400 uppercase tracking-wider">Notes (optional)</label>
            <textarea value={draft.notes} onChange={e => onDraftChange({ notes: e.target.value })} rows={2} className="w-full px-2.5 py-1.5 border border-gray-300 rounded focus:outline-none focus:border-emerald-500" />
          </div>
          <div className="flex gap-2 justify-end border-t border-gray-100 pt-3 mt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 border border-gray-300 rounded text-gray-600 font-semibold hover:bg-gray-50 transition-colors">Cancel</button>
            <button type="submit" className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded font-bold transition-colors">Save Adjustment</button>
          </div>
        </form>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Write `WasteDialog`** (same shape as `AdjustmentDialog`, different fields/reasons)

```typescript
// admin-frontend/src/pages/inventory/components/dialogs/WasteDialog.tsx
import { Icon } from '../Icon';
import type { InventoryItem } from '../../types';

type WasteReason = 'Expired' | 'Damaged' | 'Spoiled' | 'Burnt' | 'Kitchen Waste' | 'Preparation Waste' | 'Customer Return' | 'Other';
interface WasteDraft { itemId: string; quantity: number; reason: WasteReason; notes: string; }

interface WasteDialogProps {
  isOpen: boolean;
  onClose: () => void;
  items: InventoryItem[];
  draft: WasteDraft;
  onDraftChange: (patch: Partial<WasteDraft>) => void;
  onSubmit: (e: React.FormEvent) => void;
}

const REASONS: WasteReason[] = ['Expired', 'Damaged', 'Spoiled', 'Burnt', 'Kitchen Waste', 'Preparation Waste', 'Customer Return', 'Other'];

export function WasteDialog({ isOpen, onClose, items, draft, onDraftChange, onSubmit }: WasteDialogProps) {
  if (!isOpen) return null;
  const selectedItem = items.find(i => i.id === draft.itemId);

  return (
    <div className="fixed inset-0 bg-gray-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fadeIn">
      <div className="bg-white border border-gray-200 rounded-xl shadow-xl max-w-md w-full overflow-hidden animate-slideUp">
        <div className="p-4 border-b border-gray-200 flex justify-between items-center bg-gray-50/50">
          <h3 className="text-sm font-black text-gray-900 uppercase tracking-wide">Record Waste</h3>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-200 text-gray-400 hover:text-gray-600 transition-colors">
            <Icon name="cross" size={16} />
          </button>
        </div>
        <form onSubmit={onSubmit} className="p-4 flex flex-col gap-3 text-xs">
          <div className="flex flex-col gap-1">
            <label className="font-bold text-gray-400 uppercase tracking-wider">Item</label>
            <select required value={draft.itemId} onChange={e => onDraftChange({ itemId: e.target.value })} className="w-full h-8 px-2.5 border border-gray-300 rounded focus:outline-none focus:border-emerald-500 cursor-pointer">
              <option value="" disabled>-- Select Inventory Item --</option>
              {items.map(item => <option key={item.id} value={item.id}>{item.name} ({item.sku})</option>)}
            </select>
          </div>
          {selectedItem && (
            <div className="p-2 bg-gray-50 border border-gray-200 rounded text-[11px] text-gray-500 font-semibold">
              Available: <b className="text-gray-700">{selectedItem.onHand} {selectedItem.unit}</b>
            </div>
          )}
          <div className="flex flex-col gap-1">
            <label className="font-bold text-gray-400 uppercase tracking-wider">Quantity Wasted</label>
            <input type="number" required min={0.01} step="0.01" value={draft.quantity || ''} onChange={e => onDraftChange({ quantity: Number(e.target.value) })} className="w-full h-8 px-2.5 border border-gray-300 rounded focus:outline-none focus:border-emerald-500" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="font-bold text-gray-400 uppercase tracking-wider">Reason</label>
            <select required value={draft.reason} onChange={e => onDraftChange({ reason: e.target.value as WasteReason })} className="w-full h-8 px-2.5 border border-gray-300 rounded focus:outline-none focus:border-emerald-500 cursor-pointer">
              {REASONS.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="font-bold text-gray-400 uppercase tracking-wider">Notes (optional)</label>
            <textarea value={draft.notes} onChange={e => onDraftChange({ notes: e.target.value })} rows={2} className="w-full px-2.5 py-1.5 border border-gray-300 rounded focus:outline-none focus:border-emerald-500" />
          </div>
          <div className="flex gap-2 justify-end border-t border-gray-100 pt-3 mt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 border border-gray-300 rounded text-gray-600 font-semibold hover:bg-gray-50 transition-colors">Cancel</button>
            <button type="submit" className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded font-bold transition-colors">Record Waste</button>
          </div>
        </form>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Write `ExpiryDialog`**

Row-menu entry always pre-fills `itemId`, `batchId`, and `quantity`, so this dialog (unlike the two above) doesn't need a top-bar/no-context mode — it's only ever opened with an item already selected.

```typescript
// admin-frontend/src/pages/inventory/components/dialogs/ExpiryDialog.tsx
import { Icon } from '../Icon';
import type { InventoryItem } from '../../types';

interface ExpiryDraft { itemId: string; batchId: string; quantity: number; notes: string; }

interface ExpiryDialogProps {
  isOpen: boolean;
  onClose: () => void;
  item: InventoryItem | null;
  draft: ExpiryDraft;
  onDraftChange: (patch: Partial<ExpiryDraft>) => void;
  onSubmit: (e: React.FormEvent) => void;
}

export function ExpiryDialog({ isOpen, onClose, item, draft, onDraftChange, onSubmit }: ExpiryDialogProps) {
  if (!isOpen || !item) return null;

  return (
    <div className="fixed inset-0 bg-gray-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fadeIn">
      <div className="bg-white border border-gray-200 rounded-xl shadow-xl max-w-md w-full overflow-hidden animate-slideUp">
        <div className="p-4 border-b border-gray-200 flex justify-between items-center bg-gray-50/50">
          <h3 className="text-sm font-black text-gray-900 uppercase tracking-wide">Mark Expired — {item.name}</h3>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-200 text-gray-400 hover:text-gray-600 transition-colors">
            <Icon name="cross" size={16} />
          </button>
        </div>
        <form onSubmit={onSubmit} className="p-4 flex flex-col gap-3 text-xs">
          <div className="p-2 bg-gray-50 border border-gray-200 rounded text-[11px] text-gray-500 font-semibold">
            On hand: <b className="text-gray-700">{item.onHand} {item.unit}</b>
            {draft.batchId && <span className="ml-2">Batch: <b className="text-gray-700 font-mono">{draft.batchId}</b></span>}
          </div>
          <div className="flex flex-col gap-1">
            <label className="font-bold text-gray-400 uppercase tracking-wider">Quantity to Expire</label>
            <input type="number" required min={0.01} max={item.onHand} step="0.01" value={draft.quantity || ''} onChange={e => onDraftChange({ quantity: Number(e.target.value) })} className="w-full h-8 px-2.5 border border-gray-300 rounded focus:outline-none focus:border-emerald-500" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="font-bold text-gray-400 uppercase tracking-wider">Notes (optional)</label>
            <textarea value={draft.notes} onChange={e => onDraftChange({ notes: e.target.value })} rows={2} className="w-full px-2.5 py-1.5 border border-gray-300 rounded focus:outline-none focus:border-emerald-500" />
          </div>
          <div className="flex gap-2 justify-end border-t border-gray-100 pt-3 mt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 border border-gray-300 rounded text-gray-600 font-semibold hover:bg-gray-50 transition-colors">Cancel</button>
            <button type="submit" className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded font-bold transition-colors">Confirm Expired</button>
          </div>
        </form>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Write `HistoryDialog`**

```typescript
// admin-frontend/src/pages/inventory/components/dialogs/HistoryDialog.tsx
import { Icon } from '../Icon';
import type { StockMovement } from '../../types';

interface HistoryDialogProps {
  isOpen: boolean;
  onClose: () => void;
  itemName: string;
  movements: StockMovement[]; // pre-filtered by caller to this item's productId, newest first
}

export function HistoryDialog({ isOpen, onClose, itemName, movements }: HistoryDialogProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-gray-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fadeIn">
      <div className="bg-white border border-gray-200 rounded-xl shadow-xl max-w-lg w-full overflow-hidden animate-slideUp max-h-[80vh] flex flex-col">
        <div className="p-4 border-b border-gray-200 flex justify-between items-center bg-gray-50/50 shrink-0">
          <h3 className="text-sm font-black text-gray-900 uppercase tracking-wide">History — {itemName}</h3>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-200 text-gray-400 hover:text-gray-600 transition-colors">
            <Icon name="cross" size={16} />
          </button>
        </div>
        <div className="overflow-y-auto p-4">
          {movements.length > 0 ? (
            <div className="flex flex-col divide-y divide-gray-100 text-xs">
              {movements.map(m => (
                <div key={m.id} className="py-2 flex justify-between items-center">
                  <div className="flex flex-col">
                    <span className="font-bold text-gray-800">{m.type}</span>
                    <span className="text-gray-400 text-[10px]">{m.date} {m.time ?? ''} · {m.user}</span>
                  </div>
                  <span className={`font-mono font-semibold ${m.value < 0 ? 'text-red-600' : 'text-gray-900'}`}>
                    {m.quantity > 0 ? '+' : ''}{m.quantity} {m.unit}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-gray-400 text-center py-6">No movement history for this item.</p>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Typecheck**

Run: `cd admin-frontend && npm run typecheck`
Expected: `0` errors.

- [ ] **Step 6: Commit**

```bash
git add admin-frontend/src/pages/inventory/components/dialogs/
git commit -m "inventory: build the 4 missing dialogs (Adjustment, Waste, Expiry, History) — previously dead row-menu actions"
```

---

### Task 19: Final cutover — compose everything into `InventoryPage.tsx`

Wires all 18 previous tasks' components together, deletes the JSX they replace, and performs the final full verification pass. Confirmed via `grep`: `AdminLayout.tsx:459-478` already renders the global search bar/⌘K/"Live · Updated Xm ago" badge shown at the top of the reference image — that's shared app-shell chrome, already built, not part of this page. `InventoryPage.tsx`'s own heading only needs the "Business / Inventory" breadcrumb, `<h1>`, and `CommandBar`.

**Files:**
- Modify: `admin-frontend/src/pages/inventory/InventoryPage.tsx` (imports, state, JSX composition — see steps)

**Interfaces:** consumes every component/util produced by Tasks 1-18.

- [ ] **Step 1: Update imports**

Find the top of the file (the import block plus the module-level `categories` const — by this point in the plan, Tasks 6/11/14 have already extended these imports with `Icon`, `getAvailable`, and `initialTransfers`/`InventoryTransfer` respectively):
```typescript
import { initialItems, initialPurchaseOrders, initialSuppliers, initialStockMovements, initialRecipes, initialStocktakes, initialTransfers } from './mockData';
import { InventoryItem, PurchaseOrder, Supplier, StockMovement, Recipe, StocktakeRecord, InventoryBatch, InventoryTransfer } from './types';
import { Icon } from './components/Icon';
import { getStockStatus, getAvailable } from './utils/inventoryStatus';

const categories = ['Raw Meat', 'Oils & Fats', 'Bakery', 'Dairy', 'Vegetables', 'Dry Goods', 'Beverages', 'Packaging'];
```
Replace with:
```typescript
import {
  initialItems, initialPurchaseOrders, initialSuppliers, initialStockMovements, initialRecipes, initialStocktakes,
  initialTransfers, categories, suppliersList, kpiSparklines, aiInsights, wasteSummary
} from './mockData';
import { InventoryItem, PurchaseOrder, Supplier, StockMovement, Recipe, StocktakeRecord, InventoryBatch, InventoryTransfer } from './types';
import { Icon } from './components/Icon';
import { getStockStatus, getAvailable, getStatusBadgeStyle, isReceivable } from './utils/inventoryStatus';
import { computeOperationsInboxMetrics } from './utils/operationsInbox';
import { CommandBar } from './components/CommandBar';
import { MetricsInbox, type InboxCardData } from './components/MetricsInbox';
import { MetricsKPI, type KPICardData } from './components/MetricsKPI';
import { InventoryTabs, type InventoryTab } from './components/InventoryTabs';
import { InventoryFilters, type QuickFilterChip } from './components/InventoryFilters';
import { InventoryTable } from './components/InventoryTable';
import { MovementsTable } from './components/MovementsTable';
import { Pagination } from './components/Pagination';
import { ReceivingTab } from './components/tabs/ReceivingTab';
import { WasteTab } from './components/tabs/WasteTab';
import { TransfersTab } from './components/tabs/TransfersTab';
import { ReportsTab } from './components/tabs/ReportsTab';
import { AlertsTab } from './components/tabs/AlertsTab';
import { OperationsInboxDetailed } from './components/sidebar/OperationsInboxDetailed';
import { StockCoverageCard } from './components/sidebar/StockCoverageCard';
import { AIAssistantCard } from './components/sidebar/AIAssistantCard';
import { WasteTrackingCard } from './components/sidebar/WasteTrackingCard';
import { SupplierPerformanceCard } from './components/sidebar/SupplierPerformanceCard';
import { TransferStockDialog } from './components/dialogs/TransferStockDialog';
import { AdjustmentDialog } from './components/dialogs/AdjustmentDialog';
import { WasteDialog } from './components/dialogs/WasteDialog';
import { ExpiryDialog } from './components/dialogs/ExpiryDialog';
import { HistoryDialog } from './components/dialogs/HistoryDialog';
```
(`suppliersList` replaces the page's own ad hoc supplier lists wherever `newItemDraft`'s default supplier or similar literals reference `'Fresh Foods Ltd'` directly — no change needed there since that's still a valid supplier name, just now sourced from the shared export for anything that lists all suppliers.)

- [ ] **Step 2: Change the `tab` state to the new `InventoryTab` union, add quick-filter-chip state**

Find:
```typescript
  const [tab, setTab] = useState<'inventory'|'orders'|'suppliers'|'movements'|'recipes'|'stocktakes'>('inventory');
```
Replace with:
```typescript
  const [tab, setTab] = useState<InventoryTab>('inventory');
  const [activeChip, setActiveChip] = useState<QuickFilterChip>('all');

  const handleChipChange = (chip: QuickFilterChip) => {
    setActiveChip(chip);
    setCurrentPage(1);
    if (chip === 'all') { setStockLevelFilter('all'); setStatusFilter('all'); setExpiryFilter('all'); }
    else if (chip === 'low') { setStockLevelFilter('low'); setStatusFilter('all'); setExpiryFilter('all'); }
    else if (chip === 'zero') { setStockLevelFilter('zero'); setStatusFilter('all'); setExpiryFilter('all'); }
    else if (chip === 'expiring_soon') { setStockLevelFilter('all'); setStatusFilter('all'); setExpiryFilter('expires_soon'); }
    else if (chip === 'overdue') { setStockLevelFilter('all'); setStatusFilter('Expired'); setExpiryFilter('all'); }
  };

  const handleClearAllFilters = () => {
    setCategoryFilter('all'); setSupplierFilter('all'); setVenueFilter('all'); setStatusFilter('all');
    setStockLevelFilter('all'); setExpiryFilter('all'); setBatchFilter('all'); setExpiryStartFilter('');
    setExpiryEndFilter(''); setMovementTypeFilter('all'); setMovementStartFilter(''); setMovementEndFilter('');
    setSearchQuery(''); setActiveChip('all');
  };
```

- [ ] **Step 3: Compute `operationsInboxMetrics`, `inboxCards`, and `kpiCards`**

Add this block immediately after the `inventoryTurns30d` `useMemo` from Task 7:
```typescript
  const operationsInboxMetrics = useMemo(() => computeOperationsInboxMetrics({
    items, purchaseOrders, stockMovements, stocktakes
  }), [items, purchaseOrders, stockMovements, stocktakes]);

  const inboxCards: InboxCardData[] = [
    { id: 'pos', label: 'POs to Receive', value: `${operationsInboxMetrics.posToReceive.count}`, iconName: 'order', iconBgClass: 'bg-emerald-50 text-emerald-600', viewAllLabel: 'View all', onViewAll: () => setTab('receiving') },
    { id: 'deliveries', label: 'Deliveries Today', value: `${operationsInboxMetrics.deliveriesToday.count}`, badgeText: operationsInboxMetrics.deliveriesToday.overdueCount > 0 ? `${operationsInboxMetrics.deliveriesToday.overdueCount} overdue` : undefined, iconName: 'truck', iconBgClass: 'bg-blue-50 text-blue-600', viewAllLabel: 'View items', onViewAll: () => setTab('receiving') },
    { id: 'critical', label: 'Critical Stock', value: `${operationsInboxMetrics.criticalStock.count}`, iconName: 'alert', iconBgClass: 'bg-red-50 text-red-500', viewAllLabel: 'View items', onViewAll: () => handleChipChange('zero') },
    { id: 'expiring', label: 'Expiring Soon', value: `${operationsInboxMetrics.expiringSoon.count}`, iconName: 'clock', iconBgClass: 'bg-amber-50 text-amber-500', viewAllLabel: 'View items', onViewAll: () => handleChipChange('expiring_soon') },
    { id: 'stocktakes', label: 'Stocktakes Due', value: `${operationsInboxMetrics.stocktakesDue.count}`, iconName: 'stocktake', iconBgClass: 'bg-teal-50 text-teal-600', viewAllLabel: 'View report', onViewAll: () => setTab('stocktakes') },
    { id: 'waste', label: 'High Waste (7d)', value: `$${operationsInboxMetrics.highWaste7d.amount.toFixed(2)}`, iconName: 'trash', iconBgClass: 'bg-red-50 text-red-600', viewAllLabel: 'View report', onViewAll: () => setTab('waste') },
    { id: 'variances', label: 'Variances', value: `${operationsInboxMetrics.variances.count}`, iconName: 'arrow-up', iconBgClass: 'bg-purple-50 text-purple-600', viewAllLabel: 'Investigate', onViewAll: () => setTab('alerts') }
  ];

  const kpiCards: KPICardData[] = [
    { id: 'value', label: 'Inventory Value', value: `$${calculatedValue.toLocaleString()}`, deltaText: '2.4%', trend: 'up', sparkline: kpiSparklines.inventoryValue ?? [], iconName: 'order', iconBgClass: 'bg-emerald-50 text-emerald-600' },
    { id: 'accuracy', label: 'Inventory Accuracy', value: `${inventoryAccuracyPercent.toFixed(1)}%`, deltaText: '1.2%', trend: 'up', sparkline: kpiSparklines.accuracy ?? [], iconName: 'check', iconBgClass: 'bg-teal-50 text-teal-600' },
    { id: 'receipts', label: "Today's Receipts", value: `$${todaysReceiptsValue.toFixed(2)}`, deltaText: '—', trend: 'up', sparkline: kpiSparklines.receipts ?? [], iconName: 'receive', iconBgClass: 'bg-blue-50 text-blue-600' },
    { id: 'consumption', label: "Today's Consumption", value: `$${todaysConsumptionValue.toFixed(2)}`, deltaText: '—', trend: 'up', sparkline: kpiSparklines.consumption ?? [], iconName: 'arrow-down', iconBgClass: 'bg-purple-50 text-purple-600' },
    { id: 'waste', label: "Today's Waste", value: `$${todaysWasteValue.toFixed(2)}`, deltaText: '—', trend: 'down', sparkline: kpiSparklines.waste ?? [], iconName: 'trash', iconBgClass: 'bg-red-50 text-red-600' },
    { id: 'adjustments', label: "Today's Adjustments", value: `${todaysAdjustmentsCount}`, deltaText: '0.3', trend: 'up', sparkline: kpiSparklines.adjustments ?? [], iconName: 'alert', iconBgClass: 'bg-amber-50 text-amber-600' },
    { id: 'turns', label: 'Inventory Turns (30d)', value: `${inventoryTurns30d.toFixed(1)}`, deltaText: '0.1', trend: 'up', sparkline: kpiSparklines.turns ?? [], iconName: 'stocktake', iconBgClass: 'bg-emerald-50 text-emerald-600' }
  ];
```

- [ ] **Step 4: Add command-bar / receiving / transfer / history handler functions**

Add near the other handlers (after `handleDuplicateItem`, before `handleUndo`):
```typescript
  const openAdjustmentFor = (item?: InventoryItem) => {
    setAdjustmentDraft({ itemId: item?.id ?? '', adjustedQty: 0, reason: 'Physical Count', notes: '' });
    setIsAdjustmentOpen(true);
  };
  const openWasteFor = (item?: InventoryItem) => {
    setWasteDraft({ itemId: item?.id ?? '', quantity: 0, reason: 'Spoiled', notes: '' });
    setIsWasteOpen(true);
  };
  const openExpiryFor = (item: InventoryItem) => {
    setExpiryDraft({ itemId: item.id, batchId: item.batches?.[0]?.id ?? '', quantity: item.onHand, notes: '' });
    setIsExpiryOpen(true);
  };
  const openHistoryFor = (item: InventoryItem) => {
    setSelectedHistoryItemId(item.id);
    setIsHistoryOpen(true);
  };
  const openReceiveFor = (item?: InventoryItem) => {
    setReceiveGoodsDraft({
      supplier: item?.supplier ?? 'Fresh Foods Ltd',
      referenceNumber: '',
      deliveryDate: new Date().toISOString().substring(0, 10),
      notes: '',
      lines: [{ productId: item?.id ?? '', variant: '', quantity: 1, unit: item?.unit ?? 'kg', cost: item?.cost ?? 0, batchNumber: '', expiryDate: '' }]
    });
    setIsReceiveStockOpen(true);
  };
  const handleReceivePO = (po: PurchaseOrder) => {
    setReceiveGoodsDraft({
      supplier: po.supplier,
      referenceNumber: po.orderNumber,
      deliveryDate: new Date().toISOString().substring(0, 10),
      notes: '',
      lines: po.items.map(it => {
        const matched = items.find(i => i.name === it.name);
        return { productId: matched?.id ?? '', variant: '', quantity: it.expectedQty - it.receivedQty, unit: it.unit, cost: it.cost, batchNumber: '', expiryDate: '' };
      })
    });
    setIsReceiveStockOpen(true);
  };
  const selectedHistoryItem = items.find(i => i.id === selectedHistoryItemId);
  const historyMovements = selectedHistoryItem
    ? [...stockMovements].filter(m => m.productId === selectedHistoryItem.id).sort((a, b) => b.date.localeCompare(a.date))
    : [];
  const wasteMovements = useMemo(() => stockMovements.filter(m => m.type === 'SCRAP'), [stockMovements]);
```

- [ ] **Step 5: Replace the heading + old action bar + old 11-card KPI grid + "Purchase Today" banner**

Delete the entire block from the `{/* ── Heading Area` comment through the end of the "Purchase Today" banner (everything between the two comment markers `{/* ── Heading Area ──` and `{/* Tab header row */}` — i.e. the old breadcrumb/h1/action-bar JSX at the original lines 1006-1056, the 11-card KPI grid at 1058-1242, and the 3-card "Purchase Today" banner at 1244-1347). Replace all of it with:
```jsx
      {/* ── Heading Area ──────────────────────────────────────────────────────── */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div className="flex flex-col gap-1">
          <div className="text-[11px] font-bold text-gray-400 uppercase tracking-wider flex gap-1.5 items-center select-none">
            <span>Business</span>
            <span className="opacity-40">/</span>
            <span className="text-emerald-600 font-semibold">Inventory</span>
          </div>
          <h1 className="text-2xl font-black text-gray-900 tracking-tight leading-none">Inventory</h1>
        </div>
        <CommandBar
          onReceiveGoods={() => openReceiveFor()}
          onQuickReceive={() => openReceiveFor()}
          onPurchaseOrder={() => setIsPurchaseOrderOpen(true)}
          onStockAdjustment={() => openAdjustmentFor()}
          onRecordWaste={() => openWasteFor()}
          onStocktake={() => setIsStocktakeOpen(true)}
          onTransferStock={() => setIsTransferStockOpen(true)}
          onNewItem={() => setIsNewItemOpen(true)}
          onExport={exportCSV}
        />
      </div>

      <MetricsInbox cards={inboxCards} />
      <MetricsKPI cards={kpiCards} />
```

- [ ] **Step 6: Replace the old tab bar + old filter bar**

Delete the block from `{/* Tab header row */}` through the end of the filtering toolbar's closing `</div>` (original lines 1354-1586). Replace with:
```jsx
              <InventoryTabs activeTab={tab} onTabChange={t => { setTab(t); setSelectedRows(new Set()); setCurrentPage(1); }} />

              {!(['receiving', 'waste', 'transfers', 'reports', 'alerts'] as InventoryTab[]).includes(tab) && (
                <InventoryFilters
                  showInventoryFilters={tab === 'inventory'}
                  showMovementFilters={tab === 'movements'}
                  searchPlaceholder={tab === 'inventory' ? undefined : `Search ${tab}...`}
                  movementTypeFilter={movementTypeFilter}
                  onMovementTypeChange={setMovementTypeFilter}
                  movementStartFilter={movementStartFilter}
                  onMovementStartChange={setMovementStartFilter}
                  movementEndFilter={movementEndFilter}
                  onMovementEndChange={setMovementEndFilter}
                  searchQuery={searchQuery}
                  onSearchChange={v => { setSearchQuery(v); setCurrentPage(1); }}
                  categoryFilter={categoryFilter}
                  onCategoryChange={v => { setCategoryFilter(v); setCurrentPage(1); }}
                  categories={availableCategories}
                  supplierFilter={supplierFilter}
                  onSupplierChange={v => { setSupplierFilter(v); setCurrentPage(1); }}
                  suppliers={availableSuppliers}
                  venueFilter={venueFilter}
                  onVenueChange={v => { setVenueFilter(v); setCurrentPage(1); }}
                  venues={availableVenues}
                  statusFilter={statusFilter}
                  onStatusChange={v => { setStatusFilter(v); setCurrentPage(1); }}
                  stockLevelFilter={stockLevelFilter}
                  onStockLevelChange={v => { setStockLevelFilter(v); setCurrentPage(1); }}
                  activeChip={activeChip}
                  onChipChange={handleChipChange}
                  density={density}
                  onDensityChange={setDensity}
                  onClearAll={handleClearAllFilters}
                />
              )}
```
Note: the search bar itself is rendered for every *pre-existing* tab (inventory/orders/suppliers/movements/recipes/stocktakes), matching the original code's behavior where the search input was unconditional and only the dropdowns were tab-gated — `filteredPurchaseOrders`/`filteredSuppliers`/`filteredRecipes`/`filteredStocktakes` all already filter by `searchQuery` today and must keep working on those tabs. It's hidden for the 5 brand-new tabs (Receiving/Waste/Transfers/Reports/Alerts), which don't take a `searchQuery` prop and have no filtering to search — showing a non-functional search box there would be worse than showing none.

- [ ] **Step 7: Replace the old inventory `<table>` (lines 1624-1948) with `InventoryTable`**

```jsx
            {tab === 'inventory' && (
              <InventoryTable
                items={paginatedItems}
                selectedRows={selectedRows}
                onToggleRow={toggleSelectRow}
                onToggleSelectAll={() => toggleSelectAll(paginatedItems.map(item => item.id))}
                sortField={sortField}
                sortDirection={sortDirection}
                onSort={handleSort}
                density={density}
                onEditItem={item => { setEditingItem(item); setIsEditItemOpen(true); }}
                onReceiveStock={openReceiveFor}
                onAdjustStock={openAdjustmentFor}
                onRecordWaste={openWasteFor}
                onMarkExpired={openExpiryFor}
                onViewHistory={openHistoryFor}
                onDuplicate={handleDuplicateItem}
                onDelete={item => { setDeletingItemId(item.id); setIsDeleteConfirmOpen(true); }}
              />
            )}
```

- [ ] **Step 8: Add the new tab bodies alongside the existing (unchanged) `orders`/`suppliers`/`recipes`/`stocktakes` inline tables, and replace the old inline Stock Movements table (already deleted in Task 13) with `MovementsTable`**

Insert after the existing `{tab === 'recipes' && (...)}` block and before `{tab === 'stocktakes' && (...)}` (or anywhere among the sibling `{tab === ... && (...)}` blocks — order doesn't affect behavior, only readability):
```jsx
            {tab === 'movements' && <MovementsTable movements={filteredMovements} />}
            {tab === 'receiving' && <ReceivingTab purchaseOrders={purchaseOrders} onReceivePO={handleReceivePO} />}
            {tab === 'waste' && <WasteTab movements={wasteMovements} onRecordWaste={() => openWasteFor()} />}
            {tab === 'transfers' && <TransfersTab transfers={transfers} />}
            {tab === 'reports' && <ReportsTab items={items} stockMovements={stockMovements} />}
            {tab === 'alerts' && <AlertsTab metrics={operationsInboxMetrics} />}
```

- [ ] **Step 9: Replace the old pagination footer (lines 2109-2166) with `Pagination`**

```jsx
            {tab === 'inventory' && (
              <Pagination
                currentPage={currentPage}
                totalPages={totalPages}
                onPageChange={setCurrentPage}
                pageSize={pageSize}
                onPageSizeChange={n => { setPageSize(n); setCurrentPage(1); }}
                rangeStart={(currentPage - 1) * pageSize + 1}
                rangeEnd={Math.min(currentPage * pageSize, filteredItems.length)}
                totalItems={filteredItems.length}
              />
            )}
```

- [ ] **Step 10: Replace the old right-sidebar JSX (lines 2169-2392) with the 5 new widgets**

Keep the "Bottom Widgets Row" teaser section that currently sits right after the sidebar (starting ~line 2394) completely unchanged, in the same position — it's an existing feature outside this plan's 5-widget scope, not part of the reference image, and per this plan's zero-regression rule it's relocated (kept where it is structurally) rather than removed.

```jsx
        {/* ── Right Column: Side widgets stack (1/4 width) ────────────────────── */}
        <div className="flex flex-col gap-6 w-full">
          <OperationsInboxDetailed metrics={operationsInboxMetrics} />
          <StockCoverageCard items={items} />
          <AIAssistantCard insights={aiInsights} />
          <WasteTrackingCard summary={wasteSummary} />
          <SupplierPerformanceCard suppliers={suppliers} onViewAll={() => setTab('suppliers')} />
        </div>
```

- [ ] **Step 11: Render the 4 new dialogs + `TransferStockDialog`**

Add alongside the existing 6 unchanged `{/* MODAL: ... */}` blocks (anywhere among them, e.g. right after the `{/* ── MODAL: Stocktake` block):
```jsx
      <AdjustmentDialog
        isOpen={isAdjustmentOpen}
        onClose={() => setIsAdjustmentOpen(false)}
        items={items}
        draft={adjustmentDraft}
        onDraftChange={patch => setAdjustmentDraft(d => ({ ...d, ...patch }))}
        onSubmit={handleAdjustmentSubmit}
      />
      <WasteDialog
        isOpen={isWasteOpen}
        onClose={() => setIsWasteOpen(false)}
        items={items}
        draft={wasteDraft}
        onDraftChange={patch => setWasteDraft(d => ({ ...d, ...patch }))}
        onSubmit={handleWasteSubmit}
      />
      <ExpiryDialog
        isOpen={isExpiryOpen}
        onClose={() => setIsExpiryOpen(false)}
        item={items.find(i => i.id === expiryDraft.itemId) ?? null}
        draft={expiryDraft}
        onDraftChange={patch => setExpiryDraft(d => ({ ...d, ...patch }))}
        onSubmit={handleExpirySubmit}
      />
      <HistoryDialog
        isOpen={isHistoryOpen}
        onClose={() => setIsHistoryOpen(false)}
        itemName={selectedHistoryItem?.name ?? ''}
        movements={historyMovements}
      />
      <TransferStockDialog
        isOpen={isTransferStockOpen}
        onClose={() => setIsTransferStockOpen(false)}
        items={items}
        venues={availableVenues}
        draft={transferDraft}
        onDraftChange={patch => setTransferDraft(d => ({ ...d, ...patch }))}
        onSubmit={handleTransferSubmit}
      />
```

- [ ] **Step 12: Typecheck**

Run: `cd admin-frontend && npm run typecheck`
Expected: `0` errors.

- [ ] **Step 13: Full manual QA pass**

Run `npm run dev`, open the Inventory page, and verify every acceptance criterion from the design spec:
- All 8 command-bar buttons + More dropdown (New Item, Export) open their correct dialog/action with no console errors.
- Both metrics rows render 7 cards each with real (non-hardcoded) values; sparklines render.
- All 11 tabs render real content — none show a "coming soon" placeholder.
- Search/category/supplier/venue/status/stock-level filters, the 5 quick-filter chips, Clear All, sort-by-column (including Value), pagination, and density toggle all behave correctly on the Inventory tab.
- Zero Stock vs. Critical are now visually and functionally distinct (an item at exactly 0 on-hand shows "Zero Stock"; an item at ≤25% of min but >0 shows "Critical").
- Row menu: Receive Stock, Adjust Stock, Record Waste, Mark Expired, and View History all open real, working dialogs (previously 4 of these did nothing).
- Receiving tab lists POs awaiting receipt; clicking "Receive" pre-fills and opens the Receive Stock dialog.
- Waste and Transfers tabs show real filtered data; Transfer Stock dialog creates a new transfer visible in the Transfers tab immediately after submit.
- Reports and Alerts tabs show real derived data.
- All 5 sidebar widgets show data consistent with the rest of the page (e.g. Waste Tracking's "$X today" matches the KPI grid's Today's Waste card).
- Side-by-side against `/home/cyrus/Documents/inventory.png`: compare spacing, card sizing, typography, and table density on the Inventory tab specifically; adjust Tailwind classes as needed until the diff is negligible, per this plan's Verification section.

- [ ] **Step 14: Commit**

```bash
git add admin-frontend/src/pages/inventory/InventoryPage.tsx
git commit -m "inventory: final cutover — compose all new components into InventoryPage, remove superseded inline JSX"
```
