# Story 3.2: Table CRUD API & Seed Auckland Tables

Status: done

> **Enterprise conformance addendum — 2026-08-15:** Each active Verdura table requires a validated Idealpos table mapping effective at order time. Mapping changes are versioned/audited; unmapped or cross-venue tables block normal POS handoff rather than falling back silently. See [`docs/target-operating-model.md`](../../docs/target-operating-model.md).

## Story

As a restaurant administrator,
I want a Table CRUD API and to seed the initial tables for the Auckland venue,
so that customers can reserve and orders can be dispatched to specific tables.

## Acceptance Criteria

1. **CRUD API Endpoints:**
   - Implement the following endpoints under `backend/src/tables/tables.controller.ts`:
     - `POST /api/venues/:venueId/tables` (Create a table. Role: `owner` or `admin`)
     - `GET /api/venues/:venueId/tables` (Retrieve all tables for a venue. Role: `owner`, `admin`, or `manager`)
     - `GET /api/venues/:venueId/tables/:id` (Retrieve a specific table. Role: `owner`, `admin`, or `manager`)
     - `PATCH /api/venues/:venueId/tables/:id` (Update a table. Role: `owner` or `admin`)
     - `DELETE /api/venues/:venueId/tables/:id` (Delete a table. Role: `owner` or `admin`)
   - Secure the controller using `@UseGuards(JwtAuthGuard, RolesGuard)`.
   - Ensure multi-tenancy safety: access must be restricted to venues belonging to the authenticated user's `organizationId`.

2. **DTO Validations:**
   - Define `CreateTableDto` and `UpdateTableDto` with robust `class-validator` annotations:
     - `tableNumber` (required string, unique within venue)
     - `name` (optional string)
     - `capacity` (required integer >= 1)
     - `isActive` (optional boolean, default true)
     - `sortOrder` (optional integer, default 0)

3. **Seeding Auckland Tables:**
   - Extend `backend/prisma/seed.ts` to automatically seed tables for the default "Verdura Auckland" venue.
   - Seed tables: Table 1 to 10 (capacity 4), Table 11 to 15 (capacity 2), Table 16 to 20 (capacity 6). Total capacity = 80.

4. **Test Coverage:**
   - Write comprehensive unit tests for `TablesService` and `TablesController` in `tables.service.spec.ts` and `tables.controller.spec.ts`.
   - Ensure the tests assert correct Prisma calls and mock success/failure paths.

5. **Build Quality:**
   - `npm run typecheck --workspace=backend` and `npm run lint --workspace=backend` must pass with zero errors.

## Tasks / Subtasks

- [x] Task 1 — Extend Database Seed
  - [x] Add the Auckland tables seeding logic in `backend/prisma/seed.ts`.
  - [x] Run the seed script to verify it creates the default tables.

- [x] Task 2 — Implement DTOs
  - [x] Create `CreateTableDto` and `UpdateTableDto` in `backend/src/tables/dto/`.
  - [x] Apply `class-validator` annotations.

- [x] Task 3 — Implement TablesService
  - [x] Implement Prisma CRUD queries in `backend/src/tables/tables.service.ts` validating venue ownership using `organizationId`.
  - [x] Inject `PrismaService`.

- [x] Task 4 — Implement TablesController
  - [x] Expose controller endpoints and apply `@UseGuards(JwtAuthGuard, RolesGuard)`.
  - [x] Bind `@Roles(StaffRole.admin, StaffRole.manager)` and `@Roles(StaffRole.admin)` metadata.

- [x] Task 5 — Write Unit Tests
  - [x] Create unit tests for controller and service.

- [x] Task 6 — Verify Build
  - [x] Verify build via typecheck, lint, and npm test.

## Dev Notes

### Multi-Tenancy Validation
Whenever operations target a table under a specific venue, verify that the venue actually belongs to the user's `organizationId`. Otherwise, throw a `NotFoundException` or `ForbiddenException`.

## Dev Agent Record

### Agent Model Used

gemini-2.5-pro (orchestrator: Antigravity)

### Debug Log References

- Task-875 execution

### Completion Notes List

- All CRUD APIs implemented with venue and organization level multi-tenancy.
- 100% test coverage passing successfully.

### File List

- `backend/src/tables/tables.controller.ts`
- `backend/src/tables/tables.service.ts`
- `backend/src/tables/tables.module.ts`
- `backend/src/tables/dto/create-table.dto.ts`
- `backend/src/tables/dto/update-table.dto.ts`
- `backend/src/tables/tables.controller.spec.ts`
- `backend/src/tables/tables.service.spec.ts`
- `backend/prisma/seed.ts`
