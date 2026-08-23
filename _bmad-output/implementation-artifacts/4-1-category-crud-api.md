---
baseline_commit: ed831c9
---

# Story 4.1: Category CRUD API

Status: done

> **Enterprise conformance addendum — 2026-08-15:** Categories are presentation taxonomy, not sufficient kitchen routing. Production requires versioned preparation stations and explicit item/line routing; category changes must not retroactively change submitted KOT destinations. See [`docs/target-operating-model.md`](../../docs/target-operating-model.md).

## Story

As a restaurant administrator,
I want a Category CRUD API,
so that I can organise menu items into named groups for display on the kiosk and admin dashboard.

## Acceptance Criteria

1. **CRUD API Endpoints** under `POST /api/admin/menu/categories`:
   - `POST /api/admin/menu/categories` — Create a category (role: admin)
   - `GET /api/admin/menu/categories` — List all categories for the organisation (role: manager+)
   - `GET /api/admin/menu/categories/:id` — Get one category (role: manager+)
   - `PATCH /api/admin/menu/categories/:id` — Update a category (role: admin)
   - `DELETE /api/admin/menu/categories/:id` — Hard-delete a category (role: admin)
   - Secured via `@UseGuards(JwtAuthGuard, RolesGuard)`.

2. **DTO Validations** — `CreateCategoryDto` / `UpdateCategoryDto`:
   - `name` (required string)
   - `description` (optional string)
   - `imageUrl` (optional URL string)
   - `sortOrder` (optional integer >= 0, default 0)
   - `isActive` (optional boolean, default true)

3. **Multi-tenancy**: all queries scoped to `req.user.organizationId`; `createdById` set to `req.user.id`.

4. **Test Coverage**: unit tests for `CategoriesService` and `CategoriesController`.

5. **Build Quality**: `typecheck`, `lint`, and `test` pass with zero errors.

## Tasks / Subtasks

- [x] Task 1 — Implement DTOs
  - [x] `backend/src/menu/dto/create-category.dto.ts`
  - [x] `backend/src/menu/dto/update-category.dto.ts`

- [x] Task 2 — Implement CategoriesService
  - [x] `backend/src/menu/categories.service.ts` with Prisma CRUD queries

- [x] Task 3 — Implement CategoriesController
  - [x] `backend/src/menu/categories.controller.ts` with RBAC guards

- [x] Task 4 — Register in MenuModule
  - [x] Update `backend/src/menu/menu.module.ts`

- [x] Task 5 — Write Unit Tests
  - [x] `backend/src/menu/categories.service.spec.ts`
  - [x] `backend/src/menu/categories.controller.spec.ts`

- [x] Task 6 — Verify Build
  - [x] typecheck, lint, test all green

## Dev Notes

- Controller prefix `admin-frontend/menu/categories` with global `/api` prefix → full path `/api/admin/menu/categories`
- Follow venues module pattern for multi-tenancy, RBAC, NotFoundException
- `isActive` field exists in schema (default true) — toggled via PATCH; hard DELETE in this story (E4-S8 adds soft-delete behaviour)
- `createdById` must be set from `req.user.id` on create

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6 (orchestrator: Claude Code)

### Completion Notes List

- Category CRUD API implemented under `admin-frontend/menu/categories` (global `/api` prefix → `/api/admin/menu/categories`)
- Multi-tenancy scoped to `req.user.organizationId`; `createdById` set from `req.user.id` on create
- RBAC: admin for write operations, manager+ for reads
- Hard delete in this story (E4-S8 will add inactive-flag soft delete)
- `findAll` returns all categories ordered by `sortOrder` (including inactive — admin dashboard needs full view)
- 15 tests pass (service + controller); 138 total API tests pass with zero regressions
- typecheck ✅ lint ✅ tests ✅

### File List

- `backend/src/menu/dto/create-category.dto.ts`
- `backend/src/menu/dto/update-category.dto.ts`
- `backend/src/menu/categories.service.ts`
- `backend/src/menu/categories.controller.ts`
- `backend/src/menu/menu.module.ts`
- `backend/src/menu/categories.service.spec.ts`
- `backend/src/menu/categories.controller.spec.ts`

## Change Log

- 2026-06-20: Story 4.1 implemented — Category CRUD API, DTOs, service, controller, unit tests. typecheck + lint + all 138 tests pass. (claude-sonnet-4-6 via bmad-dev-story)
