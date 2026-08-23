---
baseline_commit: 8cc793ce7c22b5c104ee5b6e4ab35440f4252580
---

# Story 4.3: Admin Dashboard — Category Management Page

Status: done

> **Enterprise conformance addendum — 2026-08-15:** Admin UX must keep menu taxonomy separate from operational station routing, display mapping completeness and prevent a cosmetic reorder from changing historical or in-flight KOT routing. See [`docs/target-operating-model.md`](../../docs/target-operating-model.md).

## Story

As a restaurant administrator,
I want a Category Management page on the Admin Dashboard,
so that I can create, edit, delete, and reorder menu categories.

## Acceptance Criteria

1. **Route and Navigation:**
   - Expose the Menu Management page exclusively at `/menu-management` in `admin-frontend/src/App.tsx`.
   - Add a "Categories" navigation link in `AdminLayout.tsx` under a "Menu" group.
   - All roles (owner, admin, manager) can perform CRUD on categories (matches API RBAC).

2. **Category List UI:**
   - Display a list of all categories ordered by `sortOrder` ascending.
   - Columns: Name, Description, Active Status, Sort Order, Actions.
   - Provide "Move Up" / "Move Down" buttons to reorder categories (swap sortOrder with adjacent).
   - "Move Up" disabled on first row; "Move Down" disabled on last row.

3. **CRUD Modals:**
   - "Add Category" button opens a modal with fields: Name (required), Description (optional), Image URL (optional), Sort Order (int, default 0), Is Active (bool, default true).
   - "Edit" button per row opens a pre-filled edit modal with the same fields.
   - "Delete" button per row opens a confirmation dialog before deleting.

4. **API Integration & State:**
   - Fetch categories via `GET /api/admin/menu/categories`.
   - Create via `POST /api/admin/menu/categories`, update via `PATCH /api/admin/menu/categories/:id`, delete via `DELETE /api/admin/menu/categories/:id`.
   - Invalidate the categories query key after each mutation to keep UI in sync.
   - Show inline error messages from API responses on mutation failure.

5. **Build Quality:**
   - Clean `npm run typecheck` and `npm run lint` in the `admin` workspace.

## Tasks / Subtasks

- [x] Task 1 — Create CategoryManagementPage and wire routing/navigation
  - [x] Create `admin-frontend/src/pages/menu/CategoryManagementPage.tsx`
  - [x] Add `/menu-management` route in `App.tsx`
  - [x] Add "Categories" nav link in `AdminLayout.tsx`

- [x] Task 2 — Implement category list with reorder controls
  - [x] Render categories table sorted by sortOrder
  - [x] Implement Move Up / Move Down via two sequential PATCH calls swapping sortOrder values

- [x] Task 3 — Implement Add / Edit / Delete modals
  - [x] Add Category modal with all fields
  - [x] Edit Category modal pre-populated from row data
  - [x] Delete confirmation dialog

- [x] Task 4 — Verify build quality
  - [x] `npm run typecheck` passes in admin workspace
  - [x] `npm run lint` passes in admin workspace

## Dev Notes

- Follow the `TableManagementPage` pattern exactly: TanStack Query for data fetching, Tailwind CSS styling, modal state with local `useState`.
- API base path: `/api/admin/menu/categories` (all category endpoints require JWT + manager+ role).
- Category shape from API: `{ id, organizationId, name, description, imageUrl, sortOrder, isActive, createdAt, updatedAt, createdById }`.
- No role-based read-only banner needed — manager+ can always write (unlike tables where managers are view-only).
- For reorder: sort the categories list by `sortOrder` ascending before rendering. Move Up/Down swap the `sortOrder` values of the target row and its neighbour via two PATCH calls fired sequentially; invalidate the query after both complete.
- The `api` client is at `admin-frontend/src/lib/api.ts` — use `api.get/post/patch/delete`.
- No unit tests needed for frontend pages (consistent with existing pattern — no test files exist for other admin pages).

## Dev Agent Record

### Agent Model Used
claude-sonnet-4-6

### Completion Notes List

- `CategoryManagementPage.tsx` — full CRUD: list sorted by sortOrder, Add/Edit/Delete modals, Move Up/Down reorder via sequential PATCH swaps, inline API error display.
- `CategoryFormFields` extracted as a shared sub-component to avoid duplicating form markup between Add and Edit modals.
- Route `/menu-management` wired in `App.tsx`; "Menu Management" nav link added to `AdminLayout.tsx` sidebar. Do not reintroduce `/menu/categories` as a frontend route; that path is reserved for the categories API under `/api/admin/menu/categories`.
- Typecheck and lint clean; no regressions (no backend test suite affected — frontend only).

### File List
- `admin-frontend/src/pages/menu/CategoryManagementPage.tsx`
- `admin-frontend/src/App.tsx`
- `admin-frontend/src/components/layout/AdminLayout.tsx`

### Review Findings

- [x] [Review][Defer] "Menu" group missing in AdminLayout sidebar — AC1 wording says "under a 'Menu' group"; flat nav accepted for now; deferred to a future UX story covering holistic sidebar grouping once E4-S4 and E5 add more nav links — deferred, UX backlog
- [x] [Review][Patch] Sort-swap is a no-op when two categories share the same `sortOrder` — fixed: replaced sequential value-swap with parallel Promise.all using index-based sortOrders [CategoryManagementPage.tsx:handleMoveUp/handleMoveDown]
- [x] [Review][Patch] Partial swap on network failure permanently corrupts `sortOrder` — fixed: wrapped in try/catch; on failure, re-fetches to restore UI to actual DB state [CategoryManagementPage.tsx:handleMoveUp/handleMoveDown]
- [x] [Review][Patch] Move buttons not disabled during in-flight request — fixed: added `isReordering` state; buttons disabled when `isReordering` [CategoryManagementPage.tsx:handleMoveUp/handleMoveDown]
- [x] [Review][Patch] Cancel button on Add/Edit modals does not clear `errorMsg` — fixed: cancel onClick calls `setErrorMsg(null)` in both modals [CategoryManagementPage.tsx:cancel handlers]
- [x] [Review][Patch] `parseInt("", 10)` returns NaN when sortOrder field is cleared — fixed: coerced NaN to 0 with `parseInt(...) || 0` [CategoryManagementPage.tsx:CategoryFormFields set()]
- [x] [Review][Patch] Delete confirmation shows no category name — fixed: `deleteConfirmId` replaced with `deleteConfirm: Category | null`; dialog shows `deleteConfirm.name` [CategoryManagementPage.tsx:deleteConfirm state]
- [x] [Review][Patch] Query error indistinguishable from empty list — fixed: `isError` destructured from useQuery; error banner shown above table; empty-state row suppressed when `isError` [CategoryManagementPage.tsx:render]
- [x] [Review][Patch] Column header "Sort" should be "Sort Order" (AC2) — fixed [CategoryManagementPage.tsx:table thead]
- [x] [Review][Patch] Column header "Status" should be "Active Status" (AC2) — fixed [CategoryManagementPage.tsx:table thead]
- [x] [Review][Defer] Concurrent move operations from two browser sessions can corrupt ordering — multi-user write collision; requires WebSocket or optimistic-locking at API level; out of scope for this story [CategoryManagementPage.tsx:handleMoveUp/handleMoveDown] — deferred, pre-existing
- [x] [Review][Defer] `sorted` stale-closure in move handlers — general React closures-in-event-handlers pattern; low risk given short await window [CategoryManagementPage.tsx:handleMoveUp/handleMoveDown] — deferred, pre-existing
- [x] [Review][Defer] `sorted[index]!` non-null assertion — theoretically unsafe if list shrinks between render and click; guarded by React's render/event synchronisation in practice [CategoryManagementPage.tsx:handleMoveUp/handleMoveDown] — deferred, pre-existing

## Change Log

- 2026-06-20: Story created for E4-S3 (Category Management admin page).
- 2026-06-20: Implemented. CategoryManagementPage, route, nav link. Typecheck + lint clean.
- 2026-06-21: Code review complete. 1 decision-needed, 9 patches, 3 deferred.
- 2026-06-21: All 9 patches applied. Typecheck + lint clean.
