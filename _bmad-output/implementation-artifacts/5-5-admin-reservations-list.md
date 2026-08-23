---
baseline_commit: 61d69877afb11548ecb515bcb3ee8fbb4fab7753
---

# Story 5.5: Admin Dashboard — Reservations List Page

Status: done

> **Enterprise conformance addendum — 2026-08-15:** Reservation UI must keep booking state separate from linked order, Idealpos, payment and kitchen states. If a pre-order exists, show both external references and route staff to the canonical reconciliation view rather than permitting duplicate manual submission. See [`docs/target-operating-model.md`](../../docs/target-operating-model.md).

## Story

As a restaurant administrator,
I want a Reservations page on the Admin Dashboard,
so that I can search, filter, view, create, edit, delete, and manually transition guest reservations.

## Acceptance Criteria

1. **Route and Navigation:**
   - Expose a `/reservations` route in `admin-frontend/src/App.tsx`.
   - Ensure the "Reservations" navigation link in `AdminLayout.tsx` points to `/reservations` and is accessible by authorized roles (owner, admin, manager).

2. **Filters and Search:**
   - Filter reservations by date (defaults to empty/all dates).
   - Filter reservations by status (options: All statuses, pending, confirmed, seated, completed, cancelled, no show).
   - Filter reservations by venueId (dropdown dynamically populated from `/api/venues`).
   - Search query matches guestName, bookingRef, guestEmail.

3. **Status Transitions:**
   - Expose quick status transition action buttons directly in the reservation rows:
     - `pending` -> Confirm -> `confirmed`
     - `confirmed` -> Seat -> `seated`
     - `seated` -> Complete -> `completed`
     - `pending`/`confirmed` -> Cancel -> `cancelled`
   - Actions call the `PATCH /api/admin/reservations/:id/status` endpoint.

4. **Creation and Modification Modals:**
   - "New Reservation" opens a modal to manually book guests (Name, Email, Phone, Party Size, Date, Time, Table assignment, Occasion, Special Requests).
   - "Edit" opens a modal prefilled to edit reservation fields (calls `PATCH /api/admin/reservations/:id`).
   - "Delete" opens a confirmation dialog before calling `DELETE /api/admin/reservations/:id`.

5. **Build Quality:**
   - Clean `npm run typecheck` and `npm run lint` in the `admin` workspace.
   - Clean `npm run lint` in the `api` workspace.
   - All NestJS unit & integration tests pass with 100% green coverage (`npm run test --workspace=backend`).

## Tasks / Subtasks

- [x] Task 1 — Backend: Add query parameters to ReservationsController.findAll
  - [x] Add optional `date`, `status`, `search` query parameters.
  - [x] Delegate to `ReservationsService.findAll` with a filters object.

- [x] Task 2 — Backend: Implement query filter logic in ReservationsService.findAll
  - [x] Query database using `venueId`, `reservationDate`, `status`, and OR case-insensitive `guestName`/`guestEmail`/`bookingRef` searches.
  - [x] Maintain backwards-compatibility for existing tests/service invocations.

- [x] Task 3 — Backend: Implement tests
  - [x] Test `findAll` query filtering in `reservations.service.spec.ts`.
  - [x] Test `findAll` delegation in `reservations.controller.spec.ts`.
  - [x] Run `npm run test --workspace=backend` and verify all tests pass.

- [x] Task 4 — Frontend: Create ReservationsPage
  - [x] Query venues (`/api/venues`) and tables (`/api/tables`).
  - [x] Implement table of reservations with responsive layout.
  - [x] Implement status badge styling, action button logic, and search/filter bar.
  - [x] Build Add/Edit/Delete modals.

- [x] Task 5 — Frontend: Wire Routing and Navigation
  - [x] Add `/reservations` route to `admin-frontend/src/App.tsx`.
  - [x] Ensure routing works correctly with `AdminLayout.tsx`.
  - [x] Run typecheck and lint to verify build quality.

## Dev Agent Record

### Agent Model Used
Gemini 3.5 Flash (Medium) (2026-06-22)

### Completion Notes List
- Updated `ReservationsService.findAll` and `ReservationsController.findAll` to accept query params (`venueId`, `date`, `status`, `search`).
- Typings resolved to `Prisma.ReservationWhereInput` to fix ESLint unsafe member access warnings.
- Wrote Jest unit tests for the updated service and controller query filtering methods.
- Built interactive and responsive `ReservationsPage.tsx` under `admin-frontend/src/pages/reservations/` featuring all filters, debounced searching, quick status actions, and full CRUD.
- Registered `/reservations` path in `admin-frontend/src/App.tsx`.
- Formatted and resolved lint issues in the entire `api` and `admin` workspaces.

### File List
- `admin-frontend/src/pages/reservations/ReservationsPage.tsx` (NEW)
- `admin-frontend/src/App.tsx` (UPDATE)
- `backend/src/reservations/reservations.service.ts` (UPDATE)
- `backend/src/reservations/reservations.controller.ts` (UPDATE)
- `backend/src/reservations/reservations.service.spec.ts` (UPDATE)
- `backend/src/reservations/reservations.controller.spec.ts` (UPDATE)
- `backend/src/email/email.service.ts` (UPDATE)
