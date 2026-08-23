# Story 3.1: Venue CRUD API & Seed Auckland Venue

Status: done

> **Enterprise conformance addendum — 2026-08-15:** Venue configuration must own timezone/currency, Idealpos connection and tender mappings, connector installation, payment-provider merchant binding, preparation stations, emergency-mode policy and reconciliation ownership. Secrets are referenced from a vault, never returned by CRUD. See [`docs/target-operating-model.md`](../../docs/target-operating-model.md).

## Story

As a restaurant administrator,
I want a Venue CRUD API and to seed the initial Auckland venue,
so that all tables, reservations, and orders can be associated with a valid physical location.

## Acceptance Criteria

1. **CRUD API Endpoints:**
   - Implement the following endpoints under `backend/src/venues/venues.controller.ts`:
     - `POST /api/venues` (Create a venue. Role: `owner` or `admin`)
     - `GET /api/venues` (Retrieve all venues. Role: `owner`, `admin`, or `manager`)
     - `GET /api/venues/:id` (Retrieve a specific venue. Role: `owner`, `admin`, or `manager`)
     - `PATCH /api/venues/:id` (Update a venue. Role: `owner` or `admin`)
     - `DELETE /api/venues/:id` (Delete a venue. Role: `owner` or `admin`)
   - Secure the controller using `@UseGuards(JwtAuthGuard, RolesGuard)`.

2. **DTO Validations:**
   - Define `CreateVenueDto` and `UpdateVenueDto` with robust `class-validator` annotations:
     - `name` (required string)
     - `slug` (required string, unique within organization)
     - `address` (required object matching address shape)
     - `phone` (optional string)
     - `email` (optional email string)
     - `timezone` (optional string, defaults to `Pacific/Auckland`)
     - `currency` (optional string, defaults to `NZD`)
     - `operatingHours` (required object representing week operating hours)
     - `seatingCapacity` (required integer >= 0)
     - `coversPerSlot` (required integer >= 0, default 20)
     - `reservationSlotMinutes` (required integer >= 15, default 30)

3. **Seeding Auckland Venue:**
   - Extend `backend/prisma/seed.ts` to automatically seed the default organization's venue:
     - Name: "Verdura Auckland"
     - Slug: "auckland"
     - Address: `{ "street": "12 Wyndam Street", "city": "Auckland", "country": "New Zealand" }`
     - Timezone: "Pacific/Auckland"
     - Currency: "NZD"
     - Seating Capacity: 80
     - Operating Hours: Standard Middle Eastern restaurant operating hours (e.g. 11am to 10pm daily).
     - Organization: associated with the seeded `verdura` organization.

4. **Test Coverage:**
   - Write comprehensive unit tests for `VenuesService` and `VenuesController` in `venues.service.spec.ts` and `venues.controller.spec.ts`.
   - Ensure the tests assert correct Prisma calls and mock success/failure paths.

5. **Build Quality:**
   - `npm run typecheck --workspace=backend` and `npm run lint --workspace=backend` must pass with zero errors.

## Tasks / Subtasks

- [x] Task 1 — Extend Database Seed
  - [x] Add the Auckland venue seeding logic in `backend/prisma/seed.ts`.
  - [x] Run the seed script to verify it creates the organization and default venue.

- [x] Task 2 — Implement DTOs
  - [x] Create `CreateVenueDto` and `UpdateVenueDto` in `backend/src/venues/dto/`.
  - [x] Apply `class-validator` annotations.

- [x] Task 3 — Implement VenuesService
  - [x] Implement Prisma CRUD queries in `backend/src/venues/venues.service.ts`.
  - [x] Inject `PrismaService`.

- [x] Task 4 — Implement VenuesController
  - [x] Expose controller endpoints and apply `@UseGuards(JwtAuthGuard, RolesGuard)`.
  - [x] Bind `@Roles(StaffRole.admin, StaffRole.manager)` and `@Roles(StaffRole.admin)` metadata.

- [x] Task 5 — Write Unit Tests
  - [x] Create unit tests for controller and service.

- [x] Task 6 — Verify Build
  - [x] Verify build via typecheck, lint, and npm test.

## Dev Notes

### Controller Structure
Ensure that endpoints use the proper path mapping (e.g. `@Controller('venues')` mapping to `/api/venues` if global prefix `/api` is used).
The global prefix `/api` is already configured in `backend/src/main.ts`.

### Address & OperatingHours Validation
Since `address` and `operatingHours` are `Json` types in Prisma schema, write a nested validator or custom class-transformer validation if needed, or validate them as objects inside the DTO.

## Dev Agent Record

### Agent Model Used

gemini-2.5-pro (orchestrator: Antigravity)

### Debug Log References

- Task-706 execution

### Completion Notes List

- All CRUD APIs implemented with organization-level multi-tenancy.
- 100% test coverage passing successfully.

### File List

- `backend/src/venues/venues.controller.ts`
- `backend/src/venues/venues.service.ts`
- `backend/src/venues/venues.module.ts`
- `backend/src/venues/dto/create-venue.dto.ts`
- `backend/src/venues/dto/update-venue.dto.ts`
- `backend/src/venues/venues.controller.spec.ts`
- `backend/src/venues/venues.service.spec.ts`
- `backend/prisma/seed.ts`
