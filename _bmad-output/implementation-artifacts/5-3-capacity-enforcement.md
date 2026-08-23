---
baseline_commit: 4782f44
---

# Story 5.3: Reservation Capacity Enforcement

Status: done

> **Enterprise conformance addendum — 2026-08-15:** Capacity enforcement must be transactional/concurrency-safe and venue/timezone scoped. It is independent of Idealpos/payment/KDS state, while reservation pre-orders still pass the canonical order acceptance boundary. See [`docs/target-operating-model.md`](../../docs/target-operating-model.md).

## Story

As a restaurant administrator,
I want the reservation system to enforce configurable per-slot capacity limits,
so that the venue never gets double-booked beyond its seating capacity for a given date and time.

## Acceptance Criteria

1. **Capacity check on create (existing implementation — verify correctness):**
   - `POST /api/admin/reservations` rejects with 409 `ConflictException` when `currentCovers + dto.partySize > venue.coversPerSlot`.
   - `currentCovers` = sum of `partySize` for all reservations with status `pending`, `confirmed`, or `seated` for the same `venueId`, `reservationDate`, `reservationTime`.
   - `cancelled`, `completed`, and `no_show` reservations are excluded from the count.
   - Exact equality (`currentCovers + dto.partySize === venue.coversPerSlot`) is allowed (strict `>` only).
   - `409` message: `"Seating capacity exceeded for this time slot"`.

2. **coversPerSlot is configurable per venue:**
   - `Venue.coversPerSlot` defaults to `20` in the Prisma schema.
   - Updatable via the existing `PATCH /api/admin/venues/:id` endpoint (VenueService already supports this).
   - No new endpoints needed — venue settings page (E3-S3) already exposes this field.

3. **Test coverage (primary task — add missing edge cases to existing spec):**
   - Existing test at line 92 of `reservations.service.spec.ts` covers the over-capacity case.
   - Add to `describe('create')`:
     a. Booking allowed when `currentCovers + partySize === coversPerSlot` (exactly full → passes strict `>`)
     b. Booking allowed when slot has remaining capacity (confirms `findMany` is called with correct filter)
     c. Verify `findMany` is called with `status: { in: ['pending', 'confirmed', 'seated'] }` for the correct `venueId`, `reservationDate`, `reservationTime`
     d. Booking allowed when no existing reservations (the default `[]` mock case — already covered by the existing `creates a reservation` test, no change needed)

4. **Build quality:**
   - `npm run test --workspace=backend -- --testPathPattern='reservations'` passes all suites.
   - `npx eslint "src/reservations/**/*.ts"` clean (no new errors).

## Tasks / Subtasks

- [x] Task 1 — Verify existing implementation is correct
  - [x] Read `backend/src/reservations/reservations.service.ts` `create()` method to confirm AC1 exactly
  - [x] Confirm `ReservationStatus.pending`, `confirmed`, `seated` are the active statuses used
  - [x] Confirm strict `>` (not `>=`) in the capacity comparison

- [x] Task 2 — Add edge-case tests to `reservations.service.spec.ts`
  - [x] Add test: booking passes when `currentCovers + partySize === coversPerSlot` (boundary allowed)
  - [x] Add test: booking passes when slot has remaining capacity and verify `findMany` query shape
  - [x] Add test: `findMany` called with correct `status: { in: activeStatusList }` filter and correct `venueId`/`reservationDate`/`reservationTime`
  - [x] Existing capacity test at line 92 preserved untouched

- [x] Task 3 — Run verification
  - [x] `npm run test --workspace=backend -- --testPathPattern='reservations'` — 30/30 pass
  - [x] `npx eslint "src/reservations/**/*.ts"` — clean

## Dev Notes

### Critical context: implementation is pre-done in E5-S1

The capacity enforcement logic is **already implemented** in `ReservationsService.create()` (committed in `4782f44`). Do NOT rewrite or move this code. This story's work is test-completeness only.

### Existing implementation (DO NOT CHANGE)

```typescript
// backend/src/reservations/reservations.service.ts — create() method (existing)
async create(organizationId: string, dto: CreateReservationDto): Promise<Reservation> {
  const venue = await this.prisma.venue.findFirst({
    where: { id: dto.venueId, organizationId },
  });
  if (!venue) throw new NotFoundException('Venue not found');

  const activeStatusList = [
    ReservationStatus.pending,
    ReservationStatus.confirmed,
    ReservationStatus.seated,
  ];

  const currentReservations = await this.prisma.reservation.findMany({
    where: {
      venueId: dto.venueId,
      reservationDate: dto.reservationDate,
      reservationTime: dto.reservationTime,
      status: { in: activeStatusList },
    },
  });

  const currentCovers = currentReservations.reduce((sum, r) => sum + r.partySize, 0);
  const coversLimit = venue.coversPerSlot;
  if (currentCovers + dto.partySize > coversLimit) {
    throw new ConflictException('Seating capacity exceeded for this time slot');
  }
  // ... booking ref generation and create() follow
}
```

### Venue.coversPerSlot field (Prisma schema — DO NOT CHANGE)

```prisma
model Venue {
  coversPerSlot          Int  @default(20)
  reservationSlotMinutes Int  @default(30)
  // ...
}
```

### Existing test (line 92 — DO NOT MODIFY)

```typescript
it('throws ConflictException when covers count exceeds coversPerSlot', async () => {
  mockPrisma.venue.findFirst.mockResolvedValue(mockVenue);  // coversPerSlot: 20
  mockPrisma.reservation.findMany.mockResolvedValue([{ partySize: 15 }, { partySize: 4 }]);
  // currentCovers = 19; dto.partySize = 2; 19 + 2 = 21 > 20 → 409

  await expect(service.create(orgId, dto)).rejects.toThrow(ConflictException);
});
```

### Tests to add (append AFTER the existing capacity test, inside `describe('create')`)

Add these three tests immediately after line 97 (end of `describe('create')`) — before `describe('findAll')`:

```typescript
it('allows booking when partySize exactly fills remaining capacity', async () => {
  mockPrisma.venue.findFirst.mockResolvedValue({ ...mockVenue, coversPerSlot: 10 });
  mockPrisma.reservation.findMany.mockResolvedValue([{ partySize: 8 }]);
  mockPrisma.reservation.findFirst.mockResolvedValue(null);
  mockPrisma.reservation.create.mockResolvedValue(mockReservation);
  // currentCovers = 8; dto.partySize = 2; 8 + 2 = 10 === 10 → NOT > 10 → allowed

  await expect(service.create(orgId, dto)).resolves.toBeDefined();
});

it('allows booking when slot has remaining capacity', async () => {
  mockPrisma.venue.findFirst.mockResolvedValue(mockVenue);
  mockPrisma.reservation.findMany.mockResolvedValue([{ partySize: 5 }]);
  mockPrisma.reservation.findFirst.mockResolvedValue(null);
  mockPrisma.reservation.create.mockResolvedValue(mockReservation);
  // currentCovers = 5; partySize = 2; 5 + 2 = 7 ≤ 20 → allowed

  await expect(service.create(orgId, dto)).resolves.toBeDefined();
});

it('queries capacity only for matching venue, date, and time with active statuses', async () => {
  mockPrisma.venue.findFirst.mockResolvedValue(mockVenue);
  mockPrisma.reservation.findMany.mockResolvedValue([]);
  mockPrisma.reservation.findFirst.mockResolvedValue(null);
  mockPrisma.reservation.create.mockResolvedValue(mockReservation);

  await service.create(orgId, dto);

  expect(mockPrisma.reservation.findMany).toHaveBeenCalledWith({
    where: {
      venueId: dto.venueId,
      reservationDate: dto.reservationDate,
      reservationTime: dto.reservationTime,
      status: { in: [ReservationStatus.pending, ReservationStatus.confirmed, ReservationStatus.seated] },
    },
  });
});
```

### Files to change

- `backend/src/reservations/reservations.service.spec.ts` — **ADD** 3 tests inside `describe('create')` after line 97 — do NOT touch any other describe blocks or existing tests
- No service, controller, or DTO files need changes

### What NOT to do

- Do NOT add a `checkCapacity()` method to the service — it is inline in `create()` intentionally
- Do NOT add a public availability endpoint — that is out of scope for E5-S3
- Do NOT modify `coversPerSlot` defaults — the Prisma default of `20` is correct
- Do NOT touch E5-S1 or E5-S2 tests

### Active status rationale

`cancelled`, `completed`, `no_show` reservations free up capacity. Only `pending`, `confirmed`, and `seated` count as occupying a slot. This matches the business rule: a cancelled or no-show booking should allow another guest to fill the slot.

### mockVenue in spec

`mockVenue` is already defined at line 30 of the spec with `coversPerSlot: 20`. Reuse it for the new tests. For the "exactly fills" test, use a spread: `{ ...mockVenue, coversPerSlot: 10 }`.

### Import note

`ReservationStatus` is already imported at line 3 of the spec file. No new imports needed.

## Dev Agent Record

### Agent Model Used
claude-sonnet-4-6 (2026-06-21)

### Completion Notes List
- Implementation was pre-existing from E5-S1 (commit 4782f44) — no service/controller/DTO changes needed
- Added 3 edge-case tests to describe('create') in reservations.service.spec.ts: boundary-allowed, remaining-capacity, and active-status-filter verification
- 30/30 tests pass (service + controller suites); lint clean on reservations/**

### File List
- `backend/src/reservations/reservations.service.spec.ts` (UPDATE — add 3 edge-case tests inside describe('create'))

## Change Log

- 2026-06-21: Story created. Implementation pre-exists from E5-S1 (commit 4782f44). Task is test-completeness: add 3 edge-case tests to service spec. (bmad-create-story)
