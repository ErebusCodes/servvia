# Story 3.4: Admin Dashboard — Table Management Page

Status: done

> **Enterprise conformance addendum — 2026-08-15:** Table management must show Idealpos mapping state, prevent unsafe deletion when referenced, version mapping changes and block order availability for unmapped required tables. It must not imply POS readiness from a Verdura-only table record. See [`docs/target-operating-model.md`](../../docs/target-operating-model.md).

## Story

As a restaurant administrator,
I want a Table Management page on the Admin Dashboard,
so that I can add, edit, activate/deactivate, and remove tables for my venue.

## Acceptance Criteria

1. **Route and Navigation:**
   - Expose a `/settings/tables` route in `admin-frontend/src/App.tsx`.
   - Add a navigation link in `AdminLayout.tsx` for "Table Management".
   - Restrict write access to `owner` or `admin` roles (managers can view-only).

2. **Table Management UI:**
   - Display a list/grid of all tables for the venue in a clean dashboard table layout.
   - Columns: Table Number, Capacity, Active Status, Sort Order, Actions.
   - Provide a "Add Table" action that opens a modal or inline form to input:
     - Table Number (required string)
     - Capacity (required integer >= 1)
     - Active Status (boolean)
     - Sort Order (integer)
   - Provide "Edit Table" action to modify existing table capacity, number, status, or sort order.
   - Provide "Delete Table" action with confirmation dialog.

3. **API Integration & State:**
   - Fetch the active venue (first venue) and query its tables via `GET /api/venues/:venueId/tables`.
   - Implement mutations for creation (`POST`), update (`PATCH`), and deletion (`DELETE`).
   - Trigger query invalidations to keep the UI in sync.
   - Handle validation errors and duplicate table number conflict exceptions.

4. **Build Quality:**
   - Clean compilation (`npm run typecheck`) and linting (`npm run lint`) inside the `admin` workspace.

## Tasks / Subtasks

- [x] Task 1 — Design & Scaffold Table Management Page
  - [x] Create `TableManagementPage.tsx` under `admin-frontend/src/pages/settings/`.
  - [x] Add Route definition and update sidebar/navigation in `App.tsx` and `AdminLayout.tsx`.

- [x] Task 2 — Implement Table List & Action Modals
  - [x] Build a responsive data table showing all tables.
  - [x] Create forms/modals for adding and editing a table.

- [x] Task 3 — Integrate Table API Mutations
  - [x] Integrate fetching of tables.
  - [x] Bind creation, updating, and deletion mutations.
  - [x] Implement error handling for backend conflict exceptions.

- [x] Task 4 — Verify Build & Run Tests
  - [x] Run typecheck and lint inside the `admin` workspace.
  - [x] Verify that building the admin dashboard succeeds.

## Dev Notes

### Multi-Tenancy Scoping
All operations must target `/api/venues/:venueId/tables` using the selected venue ID. The API scopes all requests to the logged-in user's organization.

## Dev Agent Record

### Agent Model Used

gemini-2.5-pro (orchestrator: Antigravity)

### Debug Log References

- Admin build verification

### Completion Notes List

- Designed and built a premium Table Management page with responsive Tailwind design.
- Implemented full CRUD features using modals, complete with delete confirmation and role checks.
- 100% build, typecheck, and linter clean.

### File List

- `admin-frontend/src/pages/settings/TableManagementPage.tsx`
- `admin-frontend/src/components/layout/AdminLayout.tsx`
- `admin-frontend/src/App.tsx`
