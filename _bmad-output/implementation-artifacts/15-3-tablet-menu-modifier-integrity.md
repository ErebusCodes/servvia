---
baseline_commit: HEAD@2026-08-18 (Story 15-1 independent review + real browser validation session)
epic: E15
tracer_bullet: false
production_story: true
---

# Story 15.3: Order Tablet authoritative modifiers, promotions and order-line integrity

Status: done

## Story

As a Verdura staff member and guest ordering on the Order Tablet,
I want every selectable modifier, option, price adjustment and promotion to be backed by
authoritative server data and independently revalidated by the API,
so that what the tablet displays and what the venue actually charges and persists always agree.

## Governing sources (read before changing anything here)

- `docs/epics.md` E15-S3 (line 424): "Replace `getModifierGroupsForItem`'s hardcoded
  category-substring-matched modifiers with real `MenuItem`/modifier-group configuration
  (extend the existing but currently untyped `modifierGroups` JSON field, per E4-S5's own
  already-flagged gap — coordinate with, do not duplicate, that story). Remove the hardcoded
  promo-code toggle; either implement a real backend-validated promo/discount entity or remove
  the UI element entirely until one exists."
- `_bmad-output/implementation-artifacts/15-4-tablet-idempotent-submission-truthful-totals.md`
  §"Defect found, reproduced, and deliberately NOT fixed" — the exact $0.50-displayed/$0.00-persisted
  defect this story closes, root-caused to `OrdersService.resolveModifiers`
  (`apps/api/src/orders/orders.service.ts:1000-1031`) silently zeroing any submitted modifier
  when `MenuItem.modifierGroups` is empty (true for every real seeded item, since no authoring
  UI has ever existed). Explicitly assigned to E15-S3, severity P0.
- `_bmad-output/planning-artifacts/2026-08-18-october-11-recovery-plan.md` Track A row for
  15-3: "Keep promo UI hidden until a real entity exists, per this story's own AC."
- `docs/domain-model.md` — `ModifierGroup`/`ModifierOption`/`SelectedModifier` interfaces are
  already documented there; this story implements that existing contract, it does not invent a
  new one.
- `docs/decisions-log.md` DL-017 (modifiers embedded in `MenuItem`, not a top-level entity) and
  DL-072 (Verdura owns provisional commercial pricing/discounts; integer-cent GST-inclusive
  billing) — both respected, neither reopened, by this story.

## Scope boundary (read before the rest of this file)

**Owns:** a typed, ID-based `MenuItem.modifierGroups` contract; backend-independent validation
of every modifier selection on the staff/tablet order-creation path; server-authoritative
pricing and an explicit stale-price conflict instead of silent repricing; a minimal modifier
authoring surface in Menu Management (none existed); removal of the fictional `VERDURA10`
Order Tablet toggle (no authoritative promotion model exists to validate it against).

**Does not own / explicitly out of scope:** Idealpos PLU mapping or submission (15-5), EFTPOS
(15-6), KOT dispatch/printing (15-8), reconciliation (15-10), a loyalty/CRM promotion platform,
Admin Console authentication, resolving Window Display's legacy ordering flow (its own separate
hardcoded modifier catalogue and legacy name-based order submission are preserved untouched —
see Dev Agent Record), any schema migration (the JSON field already exists per DL-017).

## Acceptance Criteria

1. The API response the Order Tablet consumes provides, per orderable item: stable item id,
   stable modifier-group id, stable modifier-option id, display name, integer-cent price
   adjustment, required/optional, min/max selections, active/available state, deterministic
   display order — sourced from real `MenuItem.modifierGroups` data, never inferred from
   category/subcategory/title substrings.
2. The Order Tablet's `getModifierGroupsForItem` category-substring inference is deleted; every
   modifier the tablet can display and add to cart is sourced from real backend data with real
   ids.
3. The client submits modifier-group id + option id (never a trusted price) on the staff/tablet
   order-creation path; the backend independently resolves name and price from current
   authoritative data and rejects (not silently zeroes) anything it cannot identify — required
   groups, min/max selections, duplicate options, cross-group/cross-item ids, and
   inactive/unavailable options are all independently backend-validated.
4. A menu item with no configured modifier catalog accepts zero submitted modifiers for that
   item on the strict (staff/tablet) path — explicit rejection, never silent
   storage-at-zero.
5. If the authoritative price for a line has changed between menu load and submission, the
   request fails with an explicit `409` conflict carrying the authoritative repriced line(s) —
   no order is silently created at a different amount than what was reviewed, and the tablet
   can recover without losing the cart.
6. Idempotent replay of an already-accepted request returns the original persisted result
   unchanged, even if menu/modifier data has since changed — never re-priced against a later
   menu version.
7. Persisted order-item snapshots capture modifier-group id/name, option id/name, and price
   adjustment at order time (matching `domain-model.md`'s `SelectedModifier`), sufficient for
   KDS display and later Idealpos-mapping work without needing this story to touch either.
8. The fictional `VERDURA10` promo toggle is removed from the Order Tablet; no client-side
   discount of any kind is applied without backend authority. `billing.ts`'s generic,
   already-tested `DiscountInput` arithmetic is preserved for a future authoritative promotion
   source, not deleted.
9. A minimal, real, authorized modifier-authoring path exists in Menu Management (none existed
   before this story) — modifier groups/options are never invented via migration or seed data;
   any modifier data used for verification is authored through this real path and is disposable
   local-dev configuration, not presented as historical menu fact.
10. Story 15-1's device/customer/staff/manager authorization boundaries and Story 15-4's
    integer-cent, GST-inclusive, no-fabricated-service-charge billing behavior are unchanged and
    independently reverified, not merely assumed.
11. Window Display's separate, pre-existing, legacy modifier catalogue and name-based order
    submission continue to work exactly as before — untouched, not migrated, not broken as a
    side effect of this story's stricter tablet/staff-only contract.
12. Real standalone-tablet browser validation (not only the embedded Admin Console route) is
    completed, matching the actual defect this story closes.

## Dev Agent Record

### Summary

All 12 acceptance criteria met. The exact $0.50-displayed/$0.00-persisted defect from Story
15-4 is closed and covered by a dedicated regression test; every modifier the Order Tablet can
display or submit now comes from real, ID-based `MenuItem.modifierGroups` data, independently
revalidated server-side; the fictional `VERDURA10` toggle is removed (no authoritative
promotion model exists to validate it against, per the story's own conditional AC); Story
15-1's auth boundaries and Story 15-4's billing/idempotency behavior are unchanged and
re-verified live. No schema migration was needed (`modifierGroups` was already a JSON column
per DL-017). No staging, commit, push, or deploy action was taken.

### No schema migration; data authored, not invented

`modifierGroups` remains a JSON column on `MenuItem` (DL-017, not reopened). Existing menu
items keep `modifierGroups: []` untouched — nothing was fabricated. One real modifier group
("Sauce": required, min 1/max 1, options "Toum Garlic Paste" +$0.50 and "No Sauce" $0.00) was
authored on "Battata Harra" through the new Menu Management authoring UI (§ below) for
real-browser validation, disclosed here as disposable local-dev configuration, not historical
menu fact.

### Backend: strict ID-based modifier contract

- New `ModifierGroupDto`/`ModifierOptionDto` (`apps/api/src/menu/dto/modifier-group.dto.ts`)
  validate the JSON structure at the menu-authoring trust boundary: non-empty options,
  `maxSelections >= minSelections`, `required ⇒ minSelections >= 1`. Wired into
  `create-menu-item.dto.ts`/`update-menu-item.dto.ts` via `@ValidateNested`.
- `MenuItemsService.normalizeModifierGroups` assigns `crypto.randomUUID()` to any group/option
  submitted without an id (new entry) and preserves a client-supplied id (edit to an existing
  entry) — this is what makes group/option identity stable across edits. Applied
  unconditionally on create; on update, applied only when the request actually includes
  `modifierGroups`, so an unrelated PATCH never silently wipes existing modifier data.
- `OrdersService.resolveModifiers` gained a `strict: boolean` parameter. The kiosk/Window
  Display path (`OrdersService.create`) calls with `strict:false` — today's exact legacy
  behavior, byte-for-byte unchanged, since Window Display has its own separate hardcoded
  catalogue and submits the old `{name, priceDeltaCents}` shape and is explicitly out of this
  story's scope. The staff/tablet path (`OrdersService.createStaffOrder`, shared by
  `POST /api/admin/orders` and `POST /api/tablet/orders`) calls with `strict:true`, which:
  resolves `modifierGroupId`/`optionId` against the item's real, current `modifierGroups`;
  rejects unknown/cross-group/cross-item ids (400); rejects a deactivated (`isAvailable:false`)
  option distinctly as a `409` conflict rather than "never existed" (this is the live
  stale/deactivated-option path exercised in real-browser validation); rejects duplicate
  option ids within one line (400); enforces each group's `required`/`minSelections`/
  `maxSelections` (400, actionable message naming the group); and rejects any submitted
  selection against an item with zero configured groups (400) — replacing the prior silent
  zero-price fallback for this path only. Price is always the DB-read `option.priceDeltaCents`
  at request time, never client-supplied (the global `ValidationPipe({whitelist:true})` already
  strips a forged `priceDeltaCents`/`name` from an ID-based submission regardless).
- Persisted/returned modifier snapshot shape is now
  `{modifierGroupId, modifierGroupName, optionId, optionName, priceDeltaCents}`, matching
  `docs/domain-model.md`'s documented `SelectedModifier` contract exactly.
- **Stale-price conflict (guardrail 8):** `CreateOrderItemDto` gained an optional
  `expectedUnitPriceCents`, sent only by the strict/tablet path. `OrdersService.checkExpectedPrices`
  runs only for genuinely new (non-replay) submissions, after the idempotent-match check has
  already run and found no match — if the authoritative freshly-resolved price differs from
  what the tablet displayed, the whole request fails with a `409 ConflictException` carrying
  the authoritative line(s); no partial order is created, and the cart is never silently
  resubmitted at a different price.
- **Idempotent replay after a menu change (guardrail 7):** `itemsFingerprint` and
  `ordersMatchForReplay` were made price-independent (key on
  `menuItemId:quantity:[sorted optionId-or-name]` only). A genuine retry of an
  already-accepted request — even after the option's price has since changed — returns the
  original persisted result unchanged, verified by a dedicated integration test that mutates
  the option's price via `PATCH` between the original submission and the replay and asserts
  the original `subtotalCents` is returned untouched.
- `KitchenDisplayPage.tsx` and `apps/admin-console/src/shared/orders.ts` (`LiveOrderModifier`)
  updated to read `optionName` from the new snapshot shape (both correctly rendered "Toum
  Garlic Paste" live on the KDS ticket for order ORD-600004 during browser validation).

### Frontend: Order Tablet

- `getModifierGroupsForItem` (the category-substring-matched fiction) deleted outright; every
  call site now reads `item.modifierGroups` from real backend data.
- The customizer modal validates required/min/max client-side (UX only — backend
  independently re-validates); disables and visibly greys out unavailable options; shows a
  clear "Complete required selections" state and blocks "Add" until satisfied.
- `buildOrderItemsPayload` sends only `{modifierGroupId, optionId}` per selection (never a
  name or price) plus `expectedUnitPriceCents` per line.
- On a `409` stale-price/stale-option conflict, the tablet surfaces a clear, specific,
  non-silent message (verified live: "\"Toum Garlic Paste\" is no longer available") and keeps
  the cart intact for review/resubmission rather than silently resending or dropping it.
- All 4 `VERDURA10` render sites removed (order screen, payment screen ×2, print-bill dialog);
  `promoApplied` state deleted; `computeCartTotals` always called with `{kind:'none'}`;
  `billing.ts`'s generic `DiscountInput` arithmetic left in place, unused, for a future real
  promotion source.

### Frontend: minimal modifier-authoring UI (Menu Management)

No authoring UI existed before this story (confirmed: zero `modifierGroups` references
anywhere in `apps/admin-console/src` at the start of this story). Added a "Modifier groups"
section to the existing item edit drawer: add/remove group (name, required toggle, min/max),
add/remove option within a group (name, price in dollars, available toggle). A real React
controlled-input decimal-typing bug was found live while authoring test data (a price
`<input type="number">` whose `value` was derived via `.toFixed(2)` on every keystroke ate
in-progress decimal typing, e.g. "0.5" collapsed to "0.01") — fixed by switching to
`defaultValue`+`onBlur` (commit-on-blur), verified by re-entering and re-persisting "$0.50" and
"$0.00" live against Postgres.

### Real-browser validation (standalone Order Tablet, not only the embedded route)

Full journey completed against a real local Postgres, using the API (port 3000),
admin-console (5176), and standalone Order Tablet (`VITE_APP_MODE=tablet`, 5177) dev servers:
authored the real "Sauce" modifier group on "Battata Harra" via Menu Management → enrolled a
disposable device ("Story 15-3 validation tablet") and elevated to staff (PIN 6284) → added
"Battata Harra" with "Toum Garlic Paste" (+$0.50, the exact quantity/option from the closed
defect) → sent to kitchen → confirmed via direct Postgres query that `unitPriceCents: 1300`
and `selectedModifiers` correctly persisted the real group/option ids, names, and the $0.50
delta (order ORD-600004) → confirmed the KDS ticket correctly rendered "Battata Harra / Toum
Garlic Paste" → re-verified Story 15-1's staff-elevation regression live (PIN 6284 → "Owner"
shown, Lock button present) → **deactivated "Toum Garlic Paste" live via Menu Management, then
attempted to add it from the tablet on a fresh table (its stale client-side cache still showed
it as available/pre-selected) and confirmed the backend correctly returned `409` on
`POST /api/admin/orders`, with the tablet surfacing "\"Toum Garlic Paste\" is no longer
available" and the cart recoverable (no order silently created, no crash)** → confirmed no
`VERDURA10`/promo UI anywhere (order screen aside, payment screen, print-bill dialog, verified
via full page-text extraction) → confirmed console and network were clean throughout (no
uncaught errors, no failed non-409 requests) → reconciled disposable test data: "Toum Garlic
Paste" restored to available, "Story 15-3 validation tablet" device revoked (left revoked, not
deleted, per this codebase's established convention).

A separate, pre-existing, explicitly out-of-scope discrepancy was reconfirmed with fresh live
evidence during this validation and deliberately not touched: order ORD-600004 persisted with
`totalCents: 1495` via `OrdersService.computeTotals`'s additive-15%-GST calculation, while the
tablet correctly displayed `$13.00` throughout via `billing.ts`'s DL-072-correct contained-GST
convention. This is DL-072's already-documented gap, restated with new evidence — see
deferred-work.md.

### Independent review (second pass)

Traced "Battata Harra" end-to-end (authoring → tablet selection → API validation → persistence
→ KDS render) and confirmed each layer reads the same real ids. Attempted forging a
`modifierGroupId`/`optionId` pair not belonging to the item on the strict path (rejected 400,
covered by `orders.service.spec.ts`'s "option from wrong group"/"unknown group" tests) and a
forged `priceDeltaCents` alongside a valid id pair (silently stripped by `ValidationPipe`,
price always re-derived server-side — covered by the "forged-price-ignored" test). Confirmed
zero remaining references to `getModifierGroupsForItem` or category/title-substring modifier
inference anywhere in `apps/admin-console/src` (the separate, distinct `getItemPriceInfo`
title-substring *price-variant* inference is unrelated to modifiers and was correctly left
untouched — see deferred-work.md). Confirmed Story 15-1's staff elevation and Story 15-4's
integer-cent/contained-GST/idempotency test suites remain unmodified and green. No unresolved
P0/P1 finding remains in this story's own scope.

### Test results (all green before browser validation)

- `apps/api`: unit `npx jest` — 538/538 pass (net new: 14 modifier-validation tests in
  `orders.service.spec.ts`'s "createStaffOrder modifier validation (Story 15-3)" block,
  including the exact $0.50 defect regression; 6 in `menu-items.service.spec.ts`'s "modifier
  group authoring" block; 2 pre-existing idempotency tests updated for the new snapshot shape).
  Integration (real Postgres, via `npm run test:integration`, Redis rate-limit keys flushed
  first): new `menu-modifiers.integration-spec.ts` 10/10; `orders.integration-spec.ts` 23/23;
  `tablet-auth.integration-spec.ts` 33/33; `menu.integration-spec.ts` 5/5 — each verified
  passing 100% in isolation (the shared suite's pre-existing login rate-limit cascading-429
  fragility, and `connector-command-harness.integration-spec.ts`'s pre-existing missing-`ts-node`
  failure, are both documented, unrelated, pre-existing gaps, not introduced or fixed here).
  `tsc --noEmit` clean, `eslint` clean on touched files, `npm run build` green.
- `apps/admin-console`: `npm test` 100/100 pass (net new: 5 tests in `OrderTabletPage.test.tsx`'s
  "Story 15-3 authoritative modifiers" block, including the defect-regression payload
  assertion; `menu.store.test.ts` fixtures updated for the new `modifierGroups` field).
  `tsc --noEmit` clean, `eslint` clean on touched files. All 3 builds green (admin-console
  default, `VITE_APP_MODE=tablet`, `VITE_APP_MODE=kds`).
- Real-browser: full journey above, console/network clean, no regressions observed in Story
  15-1 auth or Story 15-4 billing behavior.

### Residual dependencies (not this story's scope)

E15-S5 (Idealpos handoff, receiving/reconciling Idealpos's authoritative total) and E15-S6
(EFTPOS/cash charging the Idealpos-authoritative amount) remain blocked on DL-064, unaffected
by this story. E15-S8 (bill settlement/closure, real printing) remains backlog. The
`computeTotals` additive-GST-vs-tablet-contained-GST discrepancy remains open, tracked under
DL-072, explicitly out of this story's scope per guardrail 9.

## File List

**New:**
- `apps/api/src/menu/dto/modifier-group.dto.ts`
- `apps/api/test/menu-modifiers.integration-spec.ts`

**Modified (backend):**
- `apps/api/src/menu/dto/create-menu-item.dto.ts`
- `apps/api/src/menu/dto/update-menu-item.dto.ts`
- `apps/api/src/menu/menu-items.service.ts`
- `apps/api/src/orders/dto/create-order.dto.ts`
- `apps/api/src/orders/orders.service.ts`
- `apps/api/src/orders/orders.service.spec.ts`
- `apps/api/src/menu/menu-items.service.spec.ts`

**Modified (frontend):**
- `apps/admin-console/src/store/menu.store.ts`
- `apps/admin-console/src/store/menu.store.test.ts`
- `apps/admin-console/src/pages/menu/MenuManagementPage.tsx`
- `apps/admin-console/src/pages/order-tablet/OrderTabletPage.tsx`
- `apps/admin-console/src/pages/order-tablet/OrderTabletPage.test.tsx`
- `apps/admin-console/src/shared/orders.ts`
- `apps/admin-console/src/pages/kitchen/KitchenDisplayPage.tsx`

## Change Log

- 2026-08-19: story created (`in-progress`), scope and acceptance criteria established from
  `docs/epics.md` E15-S3, the recovery plan, and Story 15-4's deferred P0 finding.
- 2026-08-19: implementation complete (backend strict modifier validation, stale-price
  conflict, price-independent idempotency, menu-authoring UI, Order Tablet migrated off
  fictional modifiers/promo); all automated tests green (538 backend unit + 4 integration
  suites + 100 frontend); real-browser validation complete on the standalone tablet including
  the stale/deactivated-option `409` scenario; independent second-pass review found no
  unresolved P0/P1; deferred-work.md updated (2 findings resolved, 5 new findings recorded);
  disposable test data reconciled (device revoked, test option restored to available). Status
  moved to `done`.
