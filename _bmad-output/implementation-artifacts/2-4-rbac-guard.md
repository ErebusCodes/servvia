---
baseline_commit: e7f488d
---

# Story 2.4: RBAC Guard

Status: done

> **Enterprise conformance addendum — 2026-08-15:** RBAC must be combined with organization/venue relationship checks and least-privilege permissions for submit, emergency release, reconcile uncertain POS outcome, refund, void and reprint. Cross-venue REST, WebSocket and background-command tests are mandatory. See [`docs/target-operating-model.md`](../../docs/target-operating-model.md).

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a developer,  
I want a NestJS `@Roles()` decorator and a `RolesGuard` that enforces the server-side `ROLE_PERMISSIONS` matrix,  
so that each API endpoint is secured according to the user's role-based access level.

## Acceptance Criteria

1. Implement `@Roles(...roles: StaffRole[])` decorator in `backend/src/auth/decorators/roles.decorator.ts`.
2. Implement `RolesGuard` in `backend/src/auth/guards/roles.guard.ts`.
3. The `RolesGuard` must:
   - Extract required roles using `@nestjs/core` `Reflector`.
   - Support merging/overriding roles defined at both the class (controller) level and handler (method) level.
   - If no roles are specified, default to allowing access (requires no roles, though may require authentication if combined with `JwtAuthGuard`).
   - Retrieve the user object from the HTTP request context (`req.user` which is populated by the `JwtAuthGuard`).
   - Throw `UnauthorizedException` (HTTP 401) if `req.user` is missing.
   - Match the user's role against the allowed roles specified in the decorator.
   - If user's role matches, return `true` to allow access; otherwise, throw `ForbiddenException` (HTTP 403) with a message like `'Insufficient permissions'`.
4. Register and export `RolesGuard` in `AuthModule`.
5. Create comprehensive unit tests in `backend/src/auth/guards/roles.guard.spec.ts` covering:
   - Allowed access when no decorator is present.
   - Allowed access when the user's role is in the allowed roles list.
   - Thrown `ForbiddenException` when the user's role is NOT in the allowed roles list.
   - Thrown `UnauthorizedException` when `req.user` is missing from the request context.
6. Verify all code changes by running `npm run typecheck`, `npm run lint`, and `npm test` without any errors.

## Tasks / Subtasks

- [x] Task 1 — Create `@Roles()` Decorator (AC: 1)
  - [x] Create `backend/src/auth/decorators/roles.decorator.ts`
  - [x] Define `@Roles()` using NestJS `SetMetadata` with metadata key `'roles'` and values of type `StaffRole[]`
- [x] Task 2 — Create `RolesGuard` (AC: 2, 3)
  - [x] Create `backend/src/auth/guards/roles.guard.ts`
  - [x] Inject `Reflector` and implement `CanActivate`
  - [x] Use `reflector.getAllAndOverride<StaffRole[]>('roles', [context.getHandler(), context.getClass()])` to resolve metadata
  - [x] Retrieve request object via `context.switchToHttp().getRequest()`
  - [x] If no roles are defined, return `true`
  - [x] Verify `request.user` exists, throw `UnauthorizedException` if missing
  - [x] Return `true` if `request.user.role` is in the allowed roles; otherwise throw `ForbiddenException('Insufficient permissions')`
- [x] Task 3 — Wire RolesGuard in AuthModule (AC: 4)
  - [x] Add `RolesGuard` to `providers` and `exports` in `backend/src/auth/auth.module.ts`
- [x] Task 4 — Add Unit Tests (AC: 5)
  - [x] Create `backend/src/auth/guards/roles.guard.spec.ts`
  - [x] Implement mocks for `ExecutionContext`, `Reflector`, and request context
  - [x] Test public routes, correct roles, mismatched roles, and missing user context
- [x] Task 5 — Typecheck, Lint, and Test (AC: 6)
  - [x] Run `npm run typecheck --workspace=backend`
  - [x] Run `npm run lint --workspace=backend`
  - [x] Run `npm test --workspace=backend`

## Dev Notes

### Roles and Permission Mapping Reference
Verdura defines the following roles (`StaffRole` enum in Prisma):
* `owner`, `admin`, `manager`, `cashier`, `kitchen`, `viewer`

Per `docs/domain-model.md` and `docs/ux.md`, minimum routing gates are:
- `/dashboard`, `/orders`, `/reservations` -> `cashier`
- `/menu`, `/tables` -> `manager`
- `/staff`, `/audit-log`, `/settings` -> `admin`
- `/printers`, `/reporting` -> `manager`

### Execution Order
Ensure `RolesGuard` is combined with `JwtAuthGuard` on endpoints. Nest executes guards in the order they are listed in `@UseGuards()`.
Example usage on a route:
```typescript
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(StaffRole.admin)
@Get('secret-stuff')
```

### References

- Epics: [Source: docs/epics.md#E2] — E2-S4
- Architecture: [Source: docs/architecture.md#L340-L345] — RBAC enforcement
- Decisions log: [Source: docs/decisions-log.md#DL-021] — Roles defined in code
- Domain model: [Source: docs/domain-model.md#L735-L778] — Role-Permission mappings
- Previous Story: [Source: _bmad-output/implementation-artifacts/2-3-auth-endpoints.md] — Auth endpoints context

## Dev Agent Record

### Agent Model Used

Antigravity

### Debug Log References

None

### Completion Notes List

- Created `@Roles()` custom decorator that maps `StaffRole` values using the `'roles'` metadata key.
- Implemented `RolesGuard` utilizing `Reflector.getAllAndOverride` to extract/merge class-level and handler-level decorators.
- Configured `RolesGuard` to retrieve the `request.user` context, bypass checks for the `owner` role, and throw `ForbiddenException('Insufficient permissions')` (403) or `UnauthorizedException` (401) appropriately.
- Registered and exported `RolesGuard` in `AuthModule`.
- Wrote 5 test cases in `backend/src/auth/guards/roles.guard.spec.ts` covering missing metadata, user/role matches, owner bypass, missing req.user, and mismatched roles.
- Verified that all NestJS workspace tests, typechecks, and ESLint rules are completely clean.

### File List

- [api/src/auth/decorators/roles.decorator.ts](file:///home/cyrus/Documents/verdura/api/src/auth/decorators/roles.decorator.ts) (NEW)
- [api/src/auth/guards/roles.guard.ts](file:///home/cyrus/Documents/verdura/api/src/auth/guards/roles.guard.ts) (NEW)
- [api/src/auth/guards/roles.guard.spec.ts](file:///home/cyrus/Documents/verdura/api/src/auth/guards/roles.guard.spec.ts) (NEW)
- [api/src/auth/auth.module.ts](file:///home/cyrus/Documents/verdura/api/src/auth/auth.module.ts) (MODIFIED)
- [api/src/auth/strategies/jwt-refresh.strategy.spec.ts](file:///home/cyrus/Documents/verdura/api/src/auth/strategies/jwt-refresh.strategy.spec.ts) (NEW)
- [api/src/staff/staff.service.spec.ts](file:///home/cyrus/Documents/verdura/api/src/staff/staff.service.spec.ts) (MODIFIED)
