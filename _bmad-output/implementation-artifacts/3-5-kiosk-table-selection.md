---
baseline_commit: 5ceea8c
---

# Story 3.5: Kiosk Table Selection

Status: done

> **Enterprise conformance addendum — 2026-08-15:** Only active, venue-correct, Idealpos-mapped tables may be offered for workflows requiring POS handoff. The server revalidates mapping at submission; client selection never establishes authority. See [`docs/target-operating-model.md`](../../docs/target-operating-model.md).

## Story

As a kiosk customer,
I want to select my table from a grid of active tables,
so that my order is correctly associated with my table number.

## Acceptance Criteria

1. **Table Selection View:**
   - Display a visual grid of active tables fetched from `GET /api/kiosk/tables` (or query tables by venue).
   - Display table numbers and highlight table capacity.
   - Restrict selection to active tables (`isActive: true`).

2. **State Management:**
   - Store the selected table in the kiosk Zustand state.
   - Allow modifying or clearing the selection.

3. **API Integration:**
   - Fetch the active tables for the venue from the API.

4. **Build Quality:**
   - Zero linter or typescript errors.

## Tasks / Subtasks

- [x] Task 1 — Implement Table Selection View
  - [x] Fetch tables from `/api/kiosk/venues/:venueId/tables` (public endpoint, no auth).
  - [x] Render grid of active tables.
  - [x] Bind table selection to state.

## Dev Notes

### Blocker
~~This story is currently blocked because the `kiosk` frontend workspace (`1-7-scaffold-verdura-kiosk`) has not yet been scaffolded.~~
Blocker resolved — Story 1.7 completed 2026-06-20.

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6 (orchestrator: Claude Code)

### Debug Log References

### Completion Notes List

- Created public API endpoint `GET /api/kiosk/venues/:venueId/tables` in KioskController — no auth guard, returns only `isActive: true` tables ordered by sortOrder
- KioskModule updated to import PrismaModule and register KioskController
- Kiosk frontend: Table type, Zustand store (selectedTable + setSelectedTable + clearSelection), fetch API client using native fetch (no axios dep needed)
- TableSelectionPage: TanStack Query for data fetching, 3-col responsive grid, tap-to-select/deselect, "Start Order" CTA (navigation deferred to next story)
- VITE_VENUE_ID env var drives which venue's tables are shown; renders config error if unset
- App.tsx updated with BrowserRouter + route to TableSelectionPage
- .env.example updated with VITE_VENUE_ID
- typecheck ✅ lint ✅ build ✅ (204KB bundle, 2.73s) — API build ✅

### File List

- `backend/src/kiosk/kiosk.controller.ts` — new: public GET /kiosk/venues/:venueId/tables
- `backend/src/kiosk/kiosk.module.ts` — modified: registered KioskController + PrismaModule
- `kiosk-frontend/src/types/table.ts` — new: Table interface
- `kiosk-frontend/src/store/kiosk.store.ts` — new: Zustand kiosk store
- `kiosk-frontend/src/api/tables.ts` — new: fetchActiveTables()
- `kiosk-frontend/src/pages/TableSelectionPage.tsx` — new: table selection UI
- `kiosk-frontend/src/App.tsx` — modified: BrowserRouter + route
- `kiosk-frontend/.env.example` — modified: added VITE_VENUE_ID

## Change Log

- 2026-06-20: Story 3.5 implemented — public kiosk tables API, Zustand store, TanStack Query fetch, responsive table grid. typecheck + lint + build all pass. (claude-sonnet-4-6 via bmad-dev-story)
- 2026-06-20: Code review patches applied — ParseUUIDPipe on venueId, removed isActive from select, fixed VITE_VENUE_ID type (string|undefined), added empty-table state, disabled Start Order stub button, removed unused deps (axios, react-hook-form, zod, @hookform/resolvers). All gates pass. (claude-sonnet-4-6 via bmad-code-review)
