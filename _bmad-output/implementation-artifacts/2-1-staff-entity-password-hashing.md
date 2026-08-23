---
baseline_commit: 3d75ec1
---

# Story 2.1: Staff entity, password hashing (Argon2id), seed owner account

Status: in-progress

> **Enterprise conformance addendum — 2026-08-15:** Staff identity must be organization- and venue-scoped and suitable for attributing order submission, emergency-mode activation, retry/reconcile, reprint, void and refund actions. Password hashing alone does not complete the enterprise control. See [`docs/target-operating-model.md`](../../docs/target-operating-model.md).

## Story

As a developer,
I want a `StaffService` with Argon2id password hashing and a seed script that creates an owner account,
so that E2-S2 (JWT login) has a verified staff record to authenticate against.

## Acceptance Criteria

1. `argon2` package installed in `backend/` workspace.
2. `StaffModule` exists at `backend/src/staff/`; it exports `StaffService`.
3. `StaffService` exposes:
   - `create(dto: CreateStaffDto): Promise<Staff>` — hashes password with Argon2id, persists via PrismaService, returns the created record
   - `findByEmail(email: string): Promise<Staff | null>` — case-insensitive lookup
   - `verifyPassword(hash: string, plain: string): Promise<boolean>` — delegates to argon2.verify
4. `CreateStaffDto` has: `organizationId: string`, `email: string`, `name: string`, `password: string`, `role: StaffRole`.
5. Unit tests in `staff.service.spec.ts`: mock PrismaService; test create (assert password is hashed, not stored plain), findByEmail (found and not-found), verifyPassword (correct and wrong password). At least 5 tests.
6. A seed script at `backend/prisma/seed.ts` that:
   - Creates one `Organization` (name: `"Verdura"`, slug: `"verdura"`, billingEmail from `SEED_BILLING_EMAIL` env var or `"admin@verdura.co.nz"`)
   - Creates one `Staff` record with `role: 'owner'`, email from `SEED_OWNER_EMAIL` env var (default `"owner@verdura.co.nz"`), password from `SEED_OWNER_PASSWORD` env var (required — fail with clear message if missing)
   - Is idempotent: uses `upsert` so re-running does not create duplicates
7. `package.json` `scripts` adds `"seed": "ts-node prisma/seed.ts"`.
8. `npm run typecheck` and `npm run lint` pass with zero errors; `npm test` passes.

## Tasks / Subtasks

- [ ] Task 1 — Install argon2
  - [ ] `npm install argon2 --workspace=backend`
  - [ ] Confirm `argon2` in `backend/package.json` dependencies

- [ ] Task 2 — CreateStaffDto
  - [ ] Create `backend/src/staff/dto/create-staff.dto.ts`:
    ```typescript
    import { StaffRole } from '@prisma/client';

    export class CreateStaffDto {
      organizationId: string;
      email: string;
      name: string;
      password: string;
      role: StaffRole;
    }
    ```

- [ ] Task 3 — StaffService (TDD)
  - [ ] Write failing tests first in `backend/src/staff/staff.service.spec.ts`:
    ```typescript
    import { Test, TestingModule } from '@nestjs/testing';
    import * as argon2 from 'argon2';
    import { StaffService } from './staff.service';
    import { PrismaService } from '../prisma/prisma.service';
    import { StaffRole } from '@prisma/client';

    const mockPrisma = {
      staff: {
        create: jest.fn(),
        findFirst: jest.fn(),
      },
    };

    describe('StaffService', () => {
      let service: StaffService;

      beforeEach(async () => {
        jest.clearAllMocks();
        const module: TestingModule = await Test.createTestingModule({
          providers: [
            StaffService,
            { provide: PrismaService, useValue: mockPrisma },
          ],
        }).compile();
        service = module.get<StaffService>(StaffService);
      });

      it('should be defined', () => {
        expect(service).toBeDefined();
      });

      it('create() hashes the password before storing', async () => {
        const plainPassword = 'hunter2';
        mockPrisma.staff.create.mockImplementation(async ({ data }: any) =>
          ({ id: '1', ...data }),
        );
        const result = await service.create({
          organizationId: 'org-1',
          email: 'owner@test.com',
          name: 'Owner',
          password: plainPassword,
          role: StaffRole.owner,
        });
        expect(result.passwordHash).not.toBe(plainPassword);
        expect(await argon2.verify(result.passwordHash, plainPassword)).toBe(true);
      });

      it('create() does not store plaintext password', async () => {
        mockPrisma.staff.create.mockImplementation(async ({ data }: any) =>
          ({ id: '1', ...data }),
        );
        const result = await service.create({
          organizationId: 'org-1',
          email: 'owner@test.com',
          name: 'Owner',
          password: 'secret',
          role: StaffRole.owner,
        });
        expect(result.passwordHash).not.toBe('secret');
      });

      it('findByEmail() returns staff when found', async () => {
        const fakeStaff = { id: '1', email: 'owner@test.com' };
        mockPrisma.staff.findFirst.mockResolvedValue(fakeStaff);
        const result = await service.findByEmail('owner@test.com');
        expect(result).toEqual(fakeStaff);
      });

      it('findByEmail() returns null when not found', async () => {
        mockPrisma.staff.findFirst.mockResolvedValue(null);
        const result = await service.findByEmail('nobody@test.com');
        expect(result).toBeNull();
      });

      it('verifyPassword() returns true for correct password', async () => {
        const hash = await argon2.hash('correct', { type: argon2.argon2id });
        expect(await service.verifyPassword(hash, 'correct')).toBe(true);
      });

      it('verifyPassword() returns false for wrong password', async () => {
        const hash = await argon2.hash('correct', { type: argon2.argon2id });
        expect(await service.verifyPassword(hash, 'wrong')).toBe(false);
      });
    });
    ```
  - [ ] Run tests → expect FAIL (module not found)
  - [ ] Create `backend/src/staff/staff.service.ts`:
    ```typescript
    import { Injectable } from '@nestjs/common';
    import * as argon2 from 'argon2';
    import { Staff } from '@prisma/client';
    import { PrismaService } from '../prisma/prisma.service';
    import { CreateStaffDto } from './dto/create-staff.dto';

    @Injectable()
    export class StaffService {
      constructor(private readonly prisma: PrismaService) {}

      async create(dto: CreateStaffDto): Promise<Staff> {
        const passwordHash = await argon2.hash(dto.password, { type: argon2.argon2id });
        return this.prisma.staff.create({
          data: {
            organizationId: dto.organizationId,
            email: dto.email.toLowerCase(),
            name: dto.name,
            passwordHash,
            role: dto.role,
          },
        });
      }

      async findByEmail(email: string): Promise<Staff | null> {
        return this.prisma.staff.findFirst({
          where: { email: email.toLowerCase(), deletedAt: null },
        });
      }

      async verifyPassword(hash: string, plain: string): Promise<boolean> {
        return argon2.verify(hash, plain);
      }
    }
    ```
  - [ ] Run tests → expect 7 tests PASS

- [ ] Task 4 — StaffModule
  - [ ] Create `backend/src/staff/staff.module.ts`:
    ```typescript
    import { Module } from '@nestjs/common';
    import { StaffService } from './staff.service';

    @Module({
      providers: [StaffService],
      exports: [StaffService],
    })
    export class StaffModule {}
    ```
  - [ ] Add `StaffModule` to imports in `backend/src/app.module.ts`

- [ ] Task 5 — Seed script
  - [ ] Create `backend/prisma/seed.ts`:
    ```typescript
    import { PrismaClient, StaffRole } from '@prisma/client';
    import * as argon2 from 'argon2';

    const prisma = new PrismaClient();

    async function main() {
      const seedPassword = process.env.SEED_OWNER_PASSWORD;
      if (!seedPassword) throw new Error('SEED_OWNER_PASSWORD env var is required');

      const billingEmail = process.env.SEED_BILLING_EMAIL ?? 'admin@verdura.co.nz';
      const ownerEmail = (process.env.SEED_OWNER_EMAIL ?? 'owner@verdura.co.nz').toLowerCase();

      const org = await prisma.organization.upsert({
        where: { slug: 'verdura' },
        create: { name: 'Verdura', slug: 'verdura', billingEmail },
        update: {},
      });

      const passwordHash = await argon2.hash(seedPassword, { type: argon2.argon2id });

      await prisma.staff.upsert({
        where: { email: ownerEmail },
        create: {
          organizationId: org.id,
          email: ownerEmail,
          name: 'Owner',
          passwordHash,
          role: StaffRole.owner,
        },
        update: { passwordHash },
      });

      console.log(`Seeded org "${org.name}" and owner account "${ownerEmail}"`);
    }

    main()
      .catch((e) => { console.error(e); process.exit(1); })
      .finally(() => prisma.$disconnect());
    ```
  - [ ] Add to `backend/package.json` scripts:
    ```json
    "seed": "ts-node -r tsconfig-paths/register prisma/seed.ts"
    ```
  - [ ] Add to `backend/.env.example`:
    ```
    # ── Seed (prisma/seed.ts) ──────────────────────────────────────────────────
    SEED_OWNER_EMAIL=owner@verdura.co.nz
    SEED_OWNER_PASSWORD=change-me-in-production
    SEED_BILLING_EMAIL=admin@verdura.co.nz
    ```

- [ ] Task 6 — Final verification and commit
  - [ ] `npm run typecheck` → zero errors
  - [ ] `npm run lint` → zero errors
  - [ ] `npm test` → all tests pass (expect 7 new tests + 16 existing = 23 total)
  - [ ] `git add backend/src/staff/ backend/src/app.module.ts backend/package.json backend/.env.example backend/prisma/seed.ts`
  - [ ] `git commit -m "feat(api): add StaffService (Argon2id), StaffModule, seed script"`

## Dev Notes

**Argon2id** is the recommended variant (not Argon2i or Argon2d). The `argon2` npm package defaults to `argon2i` — must pass `{ type: argon2.argon2id }` explicitly to both `hash()` and implicitly to `verify()` (verify auto-detects the variant from the hash string).

**PrismaModule is @Global** — StaffModule does not need to import it; PrismaService is available everywhere.

**Seed is not a test** — do not run it in CI or spec files. It requires a live DATABASE_URL pointing at Supabase. Run manually: `SEED_OWNER_PASSWORD=... npm run seed`.

**Case-insensitive email:** stored and queried as `email.toLowerCase()`. Do not rely on Postgres `ILIKE` — normalize at the application layer for consistency.
