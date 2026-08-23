---
baseline_commit: b95fc0d
---

# Story 5.2: Reservation Status FSM API

Status: done

> **Enterprise conformance addendum — 2026-08-15:** Reservation state, operational order state, Idealpos state, payment state and kitchen state are separate finite-state machines linked by events; no reservation transition may imply payment capture, POS confirmation or production release. See [`docs/target-operating-model.md`](../../docs/target-operating-model.md).

## Story

As a restaurant administrator,
I want reservation status to follow a validated state machine via a dedicated API endpoint,
so that reservations can only transition through legal states (pending → confirmed → seated → completed, with cancellation and no-show branches) and the system maintains a reliable audit trail.

## Acceptance Criteria

1. **New status transition endpoint:**
   - `PATCH /api/admin/reservations/:id/status` — transitions a reservation's status; JWT + manager+ RBAC required (same guards as all other reservation endpoints).
   - Body: `{ "status": "<new_status>" }` validated by `TransitionReservationDto`.
   - Returns 200 + the updated reservation record.
   - Returns 404 if reservation not found or belongs to a different org.
   - Returns 409 if the requested transition is invalid per the FSM table.

2. **FSM transition table (enforce exactly this):**

   | From | Allowed transitions |
   |------|---------------------|
   | `pending` | `confirmed`, `cancelled` |
   | `confirmed` | `seated`, `cancelled`, `no_show` |
   | `seated` | `completed` |
   | `completed` | _(terminal — no transitions)_ |
   | `cancelled` | _(terminal — no transitions)_ |
   | `no_show` | _(terminal — no transitions)_ |

   Any transition not in the table above must be rejected with `ConflictException` (`409`) and a descriptive message: `"Invalid status transition from <old> to <new>"`.

3. **Audit field updates on specific transitions:**
   - `confirmed` → set `confirmedAt = new Date()`
   - `cancelled` → set `cancelledAt = new Date()`, `cancelledBy = req.user.sub` (the requesting staff member's UUID)
   - All other transitions → no audit field changes

4. **Tenant isolation:**
   - Use `findOne(id, organizationId)` (inherited from E5-S1 service) to scope the lookup before transitioning. Reject with 404 if the reservation doesn't belong to the org.

5. **DTO validation:**
   - `TransitionReservationDto`: single field `status: ReservationStatus`, decorated with `@IsEnum(ReservationStatus)` (no `@IsOptional()` — status is required for this endpoint).

6. **Test coverage:**
   - Service `transition()` spec:
     - Valid transition sets new status and returns updated record
     - `confirmed` transition sets `confirmedAt`
     - `cancelled` transition sets `cancelledAt` and `cancelledBy` to the staff UUID
     - Invalid transition (e.g., `completed → pending`) throws `ConflictException`
     - Terminal state transition (e.g., `cancelled → confirmed`) throws `ConflictException`
     - Reservation not found throws `NotFoundException`
   - Controller spec:
     - `transitionStatus` endpoint is defined and delegates to `service.transition(id, organizationId, newStatus, staffId)`
     - Guards still active (overrideGuard pattern from existing controller spec)
   - All existing E5-S1 tests continue passing (do not break `update()` or other methods).

7. **Build quality:**
   - `npm run test` green (all suites including existing E5-S1 tests).
   - `npm run lint` clean in `backend/` workspace.
   - `npm run build` clean.

## Tasks / Subtasks

- [x] Task 1 — Add `transition()` service method
  - [x] Add private `validateStatusTransition(from, to): boolean` method to `ReservationsService`
  - [x] Add public `transition(id, organizationId, newStatus, staffId): Promise<Reservation>` method
  - [x] Call `findOne(id, organizationId)` to scope and guard
  - [x] Validate transition via `validateStatusTransition()`; throw `ConflictException` on invalid
  - [x] Build `updateData` object: set `status`, conditionally set `confirmedAt`, `cancelledAt`, `cancelledBy`
  - [x] Call `prisma.reservation.update({ where: { id }, data: updateData })`

- [x] Task 2 — Add `TransitionReservationDto`
  - [x] Create `backend/src/reservations/dto/transition-reservation.dto.ts`
  - [x] Single field: `@IsEnum(ReservationStatus) status: ReservationStatus`

- [x] Task 3 — Add controller endpoint
  - [x] Add `@Patch(':id/status')` handler to `ReservationsController`
  - [x] Extract `req.user.id` as `staffId` and pass to `service.transition()` (Staff type uses `.id`; JWT strategy maps sub→id)
  - [x] Use `@ParseUUIDPipe` on `:id`

- [x] Task 4 — Tests
  - [x] Add `transition()` tests to `backend/src/reservations/reservations.service.spec.ts`
  - [x] Add `transitionStatus()` tests to `backend/src/reservations/reservations.controller.spec.ts`
  - [x] Run `npm run test` and verify all pass

- [x] Task 5 — Build quality
  - [x] `npm run lint` clean (reservations-specific; workspace has pre-existing errors in orders/main.ts)
  - [x] `npm run build` clean

## Dev Notes

### What this story adds — and what it does NOT change

E5-S1 delivered: module, service CRUD, controller CRUD, DTOs, tests. Do NOT touch any existing service methods (`create`, `findAll`, `findOne`, `update`, `remove`) or their tests. Add alongside, not on top of.

E5-S2 adds exactly:
- 1 new DTO file: `transition-reservation.dto.ts`
- 1 new private method in service: `validateStatusTransition()`
- 1 new public method in service: `transition()`
- 1 new controller handler: `PATCH /:id/status`
- New tests in both spec files

### Important: the dev already wrote this — it was removed from E5-S1

During E5-S1 code review, the FSM logic was removed because it's E5-S2 scope. The dev agent that implemented E5-S1 had already written `validateStatusTransition()` and FSM logic in `update()` — it was correct code in the wrong place. Now put it in the right place:
- New dedicated `transition()` method (not inside `update()`)
- New dedicated endpoint `PATCH /:id/status` (not on the existing `PATCH /:id`)
- New DTO `TransitionReservationDto` (not `UpdateReservationDto`)

### FSM implementation

```ts
// In ReservationsService

private validateStatusTransition(
  oldStatus: ReservationStatus,
  newStatus: ReservationStatus,
): boolean {
  const allowedTransitions: Record<ReservationStatus, ReservationStatus[]> = {
    [ReservationStatus.pending]:   [ReservationStatus.confirmed, ReservationStatus.cancelled],
    [ReservationStatus.confirmed]: [ReservationStatus.seated, ReservationStatus.cancelled, ReservationStatus.no_show],
    [ReservationStatus.seated]:    [ReservationStatus.completed],
    [ReservationStatus.completed]: [],
    [ReservationStatus.cancelled]: [],
    [ReservationStatus.no_show]:   [],
  };
  return (allowedTransitions[oldStatus] ?? []).includes(newStatus);
}

async transition(
  id: string,
  organizationId: string,
  newStatus: ReservationStatus,
  staffId: string,
): Promise<Reservation> {
  const reservation = await this.findOne(id, organizationId); // throws 404 if not found

  if (!this.validateStatusTransition(reservation.status, newStatus)) {
    throw new ConflictException(
      `Invalid status transition from ${reservation.status} to ${newStatus}`,
    );
  }

  const updateData: Partial<{
    status: ReservationStatus;
    confirmedAt: Date;
    cancelledAt: Date;
    cancelledBy: string;
  }> = { status: newStatus };

  if (newStatus === ReservationStatus.confirmed) {
    updateData.confirmedAt = new Date();
  } else if (newStatus === ReservationStatus.cancelled) {
    updateData.cancelledAt = new Date();
    updateData.cancelledBy = staffId;
  }

  return this.prisma.reservation.update({
    where: { id },
    data: updateData,
  });
}
```

**Why not wrap in try/catch for P2025?** `findOne()` already guards existence before the update. The P2025 window is extremely narrow and the existing pattern in the codebase (categories) doesn't wrap updates either when pre-guarded by findOne.

### TransitionReservationDto

```ts
// backend/src/reservations/dto/transition-reservation.dto.ts
import { IsEnum } from 'class-validator';
import { ReservationStatus } from '@prisma/client';

export class TransitionReservationDto {
  @IsEnum(ReservationStatus)
  status: ReservationStatus;
}
```

### Controller endpoint

```ts
// Add to ReservationsController, after @Patch(':id') update handler

@Patch(':id/status')
transitionStatus(
  @Req() req: Request & { user: Staff },
  @Param('id', ParseUUIDPipe) id: string,
  @Body() dto: TransitionReservationDto,
) {
  return this.reservationsService.transition(id, req.user.organizationId, dto.status, req.user.id);
}
```

**Routing note:** NestJS correctly distinguishes `PATCH /reservations/:id` from `PATCH /reservations/:id/status` because the latter requires a literal `/status` path segment. No ordering issue.

**`req.user.id` vs `req.user.sub`:** The JWT payload stores the staff UUID in `sub`. The `Staff` Prisma type has `id`. When the JWT is decoded and attached as `req.user`, the `Staff` object's `id` field is what the controller should use for `staffId` (the JWT strategy maps `sub` → `id`). Check `backend/src/auth/strategies/jwt.strategy.ts` — if `payload.sub` maps to `user.sub` rather than `user.id`, use `req.user.sub`. The existing E5-S1 controller uses `req.user.organizationId` which confirms the full Staff object is available; use `req.user.id` for staffId.

### Imports to add in service

```ts
// Already imported in service from E5-S1 — no new imports needed:
// ConflictException, Injectable, NotFoundException from '@nestjs/common'
// PrismaClientKnownRequestError from '@prisma/client/runtime/library'
// Reservation, ReservationStatus from '@prisma/client'
// PrismaService, CreateReservationDto, UpdateReservationDto
```

### Imports to add in controller

```ts
// Add to existing imports in reservations.controller.ts:
import { TransitionReservationDto } from './dto/transition-reservation.dto';
```

### ReservationStatus enum (from Prisma schema — confirmed)

```
pending | confirmed | seated | completed | cancelled | no_show
```

### Prisma Reservation model — audit fields for E5-S2

```
confirmedAt   DateTime?
cancelledAt   DateTime?
cancelledBy   String?     // store staffId (UUID) for admin cancellations
status        ReservationStatus @default(pending)
```

### `cancelledBy` value

Use the authenticated staff member's UUID (`req.user.id`), not a hardcoded string like `'admin'`. This captures WHO cancelled for audit purposes and supports future admin-facing audit logs (E13).

### Test patterns to follow

Mirror the existing E5-S1 spec patterns exactly:

```ts
// Service spec — mock setup already established:
const mockPrisma = {
  venue: { findFirst: jest.fn() },
  reservation: {
    findFirst: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
};

// Controller spec — guard override pattern already established:
.overrideGuard(JwtAuthGuard).useValue({ canActivate: () => true })
.overrideGuard(RolesGuard).useValue({ canActivate: () => true })
```

Add tests to existing `describe` blocks in the spec files — do NOT create new spec files.

### Service spec — transition() tests to add

```ts
describe('transition', () => {
  it('transitions status from pending to confirmed and sets confirmedAt', async () => {
    mockPrisma.reservation.findFirst.mockResolvedValue({ ...mockReservation, status: 'pending' });
    const updated = { ...mockReservation, status: 'confirmed', confirmedAt: new Date() };
    mockPrisma.reservation.update.mockResolvedValue(updated);

    const result = await service.transition('res-uuid', orgId, ReservationStatus.confirmed, 'staff-uuid');

    expect(result.status).toBe('confirmed');
    expect(mockPrisma.reservation.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'res-uuid' },
        data: expect.objectContaining({ status: 'confirmed', confirmedAt: expect.any(Date) }),
      }),
    );
  });

  it('transitions to cancelled and sets cancelledAt and cancelledBy', async () => {
    mockPrisma.reservation.findFirst.mockResolvedValue({ ...mockReservation, status: 'confirmed' });
    mockPrisma.reservation.update.mockResolvedValue({ ...mockReservation, status: 'cancelled' });

    await service.transition('res-uuid', orgId, ReservationStatus.cancelled, 'staff-uuid');

    expect(mockPrisma.reservation.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'cancelled',
          cancelledAt: expect.any(Date),
          cancelledBy: 'staff-uuid',
        }),
      }),
    );
  });

  it('throws ConflictException on invalid transition (completed → pending)', async () => {
    mockPrisma.reservation.findFirst.mockResolvedValue({ ...mockReservation, status: 'completed' });

    await expect(
      service.transition('res-uuid', orgId, ReservationStatus.pending, 'staff-uuid'),
    ).rejects.toThrow(ConflictException);
  });

  it('throws ConflictException when transitioning from terminal state (cancelled → confirmed)', async () => {
    mockPrisma.reservation.findFirst.mockResolvedValue({ ...mockReservation, status: 'cancelled' });

    await expect(
      service.transition('res-uuid', orgId, ReservationStatus.confirmed, 'staff-uuid'),
    ).rejects.toThrow(ConflictException);
  });

  it('throws NotFoundException when reservation not found', async () => {
    mockPrisma.reservation.findFirst.mockResolvedValue(null);

    await expect(
      service.transition('bad-id', orgId, ReservationStatus.confirmed, 'staff-uuid'),
    ).rejects.toThrow(NotFoundException);
  });

  it('transitions from pending to cancelled without setting confirmedAt', async () => {
    mockPrisma.reservation.findFirst.mockResolvedValue({ ...mockReservation, status: 'pending' });
    mockPrisma.reservation.update.mockResolvedValue({ ...mockReservation, status: 'cancelled' });

    await service.transition('res-uuid', orgId, ReservationStatus.cancelled, 'staff-uuid');

    const callArg = mockPrisma.reservation.update.mock.calls[0][0];
    expect(callArg.data.confirmedAt).toBeUndefined();
  });
});
```

Import `ReservationStatus` from `@prisma/client` in the service spec (add to existing imports at top of file).

### Controller spec — transitionStatus() test to add

```ts
describe('transitionStatus', () => {
  it('delegates to service.transition with id, organizationId, status, and staffId', async () => {
    const dto = { status: ReservationStatus.confirmed };
    const expected = { id: 'r1', status: 'confirmed' };
    mockService.transition = jest.fn().mockResolvedValue(expected);

    const result = await controller.transitionStatus(mockReq, 'r1', dto);

    expect(mockService.transition).toHaveBeenCalledWith('r1', 'org-uuid', 'confirmed', mockStaff.id);
    expect(result).toEqual(expected);
  });
});
```

Also add `transition: jest.fn()` to `mockService` in the controller spec setup.

### Files changed in E5-S1 (do NOT regress)

- `backend/src/reservations/reservations.module.ts` — no changes needed
- `backend/src/reservations/reservations.service.ts` — ADD methods, do not modify existing
- `backend/src/reservations/reservations.controller.ts` — ADD endpoint, do not modify existing
- `backend/src/reservations/dto/create-reservation.dto.ts` — no changes needed
- `backend/src/reservations/dto/update-reservation.dto.ts` — no changes needed
- `backend/src/reservations/reservations.service.spec.ts` — ADD tests to existing `describe` blocks
- `backend/src/reservations/reservations.controller.spec.ts` — ADD tests to existing `describe` blocks
- NEW: `backend/src/reservations/dto/transition-reservation.dto.ts`

### No AppModule changes needed

`ReservationsModule` is already registered in `AppModule`. No new module wiring required.

### Pre-existing lint errors (not your responsibility)

`backend/src/main.ts` and `backend/src/orders/orders.service.ts` have pre-existing lint errors. Do not fix them. Run `eslint "src/reservations/**/*.ts"` to confirm your files are clean rather than running the workspace-wide lint which will report those pre-existing errors.

However: `npm run lint` is an AC (AC 7). The workspace-wide lint currently fails due to pre-existing errors in other files. For AC 7, confirm reservations-specific lint is clean and note the pre-existing failures in the Dev Agent Record.

Actually, check `backend/src/main.ts` and `backend/src/orders/orders.service.ts` lint errors — they may already be tracked. The CI check is `npm run lint` on the workspace, so if this was already broken before E5-S1, it was already broken. Document in completion notes.

## Dev Agent Record

### Agent Model Used
claude-sonnet-4-6 (code review pass, 2026-06-21)

### Completion Notes List
- All 5 E5-S2 files implemented and verified: transition-reservation.dto.ts (NEW), reservations.service.ts (transition + validateStatusTransition added), reservations.controller.ts (PATCH :id/status added), service spec (8 transition tests added), controller spec (transitionStatus delegation test added)
- 27/27 tests pass (service spec + controller spec, covering all 6 required transition scenarios)
- Lint clean on `src/reservations/**/*.ts` (eslint direct); workspace-wide lint has pre-existing errors in backend/src/orders/orders.service.ts and backend/src/main.ts — not introduced by E5-S2
- FSM table exactly matches AC2: pending→{confirmed,cancelled}; confirmed→{seated,cancelled,no_show}; seated→{completed}; terminal states: completed/cancelled/no_show
- `req.user.id` used for staffId (Staff Prisma type; JWT strategy maps sub→id — consistent with E5-S1 controller pattern)
- Code review: PASS — zero bugs, zero findings

### File List
- `backend/src/reservations/dto/transition-reservation.dto.ts` (NEW)
- `backend/src/reservations/reservations.service.ts` (UPDATE — add `validateStatusTransition`, `transition`)
- `backend/src/reservations/reservations.controller.ts` (UPDATE — add `transitionStatus` handler)
- `backend/src/reservations/reservations.service.spec.ts` (UPDATE — add transition tests)
- `backend/src/reservations/reservations.controller.spec.ts` (UPDATE — add transitionStatus test)

## Change Log

- 2026-06-21: Story created for E5-S2 (Reservation Status FSM API).
- 2026-06-21: Story closed — all 5 files implemented; 27/27 tests pass; lint clean; code review PASS. (bmad-code-review)
