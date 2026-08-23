# Story 3.3: Admin Dashboard — Venue Settings Page

Status: done

> **Enterprise conformance addendum — 2026-08-15:** Venue Settings must expose capabilities and verified status—not raw secrets—including connector heartbeat/version/queue age, Idealpos adapter/tender mappings, EFTPOS/online-provider mode, preparation stations, emergency policy and configuration validation. Unsupported capability cannot appear enabled. See [`docs/target-operating-model.md`](../../docs/target-operating-model.md).

## Story

As a restaurant administrator,
I want a Venue Settings page on the Admin Dashboard,
so that I can view and update the venue's name, address, timezone, operating hours, and seating capacity.

## Acceptance Criteria

1. **Route and Navigation:**
   - Expose a `/venue` route in `admin-frontend/src/App.tsx`.
   - Add a navigation layout or sidebar link in the Admin Dashboard to allow accessing Venue Settings.
   - Restrict access to `owner` or `admin` roles. (If the user is a `manager`, the page can be view-only or hidden, but wait! The API only allows `owner` and `admin` to update venues. Managers can read it.)

2. **Form Layout and UI:**
   - Present a clean, well-spaced form with the following editable inputs:
     - **Name** (text input, required)
     - **Slug** (text input, required, disabled or editable with caution)
     - **Seating Capacity** (number input, required, minimum 0)
     - **Email** (email input, optional)
     - **Phone** (text input, optional)
     - **Timezone** (select dropdown with timezone options like `Pacific/Auckland`, etc.)
     - **Currency** (select dropdown with options like `NZD`, etc.)
     - **Address** (sub-fields for `street`, `city`, `country`)
     - **Operating Hours** (open/close hour inputs for each day of the week, e.g. Mon-Sun)

3. **API Integration & State:**
   - Fetch the active venue (since we seed a default one, we can fetch all venues using `GET /api/venues` and take the first one, or use a hardcoded/known venue ID once fetched).
   - Use TanStack Query (`useQuery` and `useMutation`) to load and update the venue.
   - Send updates to `PATCH /api/venues/:id`.
   - Display loading states, validation error messages, and success notifications (toast or status text).

4. **Build Quality:**
   - The `admin` workspace must compile cleanly: `npm run typecheck` or building should pass with zero TypeScript and linter errors.

## Tasks / Subtasks

- [x] Task 1 — Design & Scaffold Venue Settings Page
  - [x] Create `VenueSettingsPage.tsx` under `admin-frontend/src/pages/settings/`.
  - [x] Add Route definition and update sidebar/navigation in `App.tsx` or layouts.

- [x] Task 2 — Implement Form UI and State
  - [x] Use Tailwind CSS for a premium, responsive form layout.
  - [x] Bind inputs to React state or React Hook Form.

- [x] Task 3 — Integrate API Endpoints
  - [x] Fetch the Auckland venue details on mount using `GET /api/venues`.
  - [x] Submit edits to `PATCH /api/venues/:id`.
  - [x] Handle validation errors and successful saves.

- [x] Task 4 — Verify Build & Run Tests
  - [x] Run typecheck and lint inside the `admin` workspace.
  - [x] Verify that building the admin dashboard succeeds.

## Dev Notes

### Multi-Tenancy Scoping
The API automatically scopes all queries by the authenticated user's `organizationId`. Thus, calling `GET /api/venues` returns only the venues belonging to the logged-in user's organization.

## Dev Agent Record

### Agent Model Used

gemini-2.5-pro (orchestrator: Antigravity)

### Debug Log References

- Admin build verification

### Completion Notes List

- Designed and built a highly polished, responsive Venue Settings form.
- Integrates with TanStack Query and verifies user role for view-only/edit permission.
- 100% build, typecheck, and linter clean.

### File List

- `admin-frontend/src/pages/settings/VenueSettingsPage.tsx`
- `admin-frontend/src/components/layout/AdminLayout.tsx`
- `admin-frontend/src/pages/dashboard/DashboardPage.tsx`
- `admin-frontend/src/App.tsx`
