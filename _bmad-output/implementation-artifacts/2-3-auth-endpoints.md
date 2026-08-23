---
baseline_commit: bf72929
---

# Story 2.3: Login / Refresh / Logout Endpoints

Status: done

> **Enterprise conformance addendum — 2026-08-15:** Authentication completion requires refresh-token rotation/reuse detection, revocation, venue-grant enforcement and audit correlation. Connector pairing/revocation is a separate machine-identity flow. Existing endpoint completion does not approve POS/payment production use. See [`docs/target-operating-model.md`](../../docs/target-operating-model.md).

## Story

As a developer,
I want `POST /api/auth/login`, `POST /api/auth/refresh`, and `POST /api/auth/logout` endpoints wired into the NestJS API,
so that the Admin Dashboard can authenticate staff, silently extend sessions via the HttpOnly refresh cookie, and cleanly terminate sessions.

## Acceptance Criteria

1. `POST /api/auth/login` accepts `{ email, password }` JSON body, validates it (non-empty strings), looks up staff by email, verifies the Argon2id hash, checks `isActive`, and on success returns `200 { accessToken, user: { id, email, name, role } }` with the refresh cookie set; returns `401` with `{ message: 'Invalid credentials' }` for any failure (not found, wrong password, inactive — all same message to prevent email enumeration).
2. `POST /api/auth/refresh` reads the `refresh_token` cookie, validates it as a JWT against `JWT_REFRESH_SECRET` (HS256), re-checks `isActive` via a DB lookup, and returns `200 { accessToken }` with a new access token; returns `401` if the cookie is missing, invalid, expired, or the staff is no longer active.
3. `POST /api/auth/logout` clears the `refresh_token` cookie (same path/options as set) and returns `204`; requires no authentication (idempotent — clearing a missing cookie is not an error).
4. `LoginDto` uses `class-validator` decorators (`@IsEmail`, `@IsString`, `@IsNotEmpty`) and `ValidationPipe` (global, `whitelist: true`) rejects malformed bodies with `400`.
5. `class-validator` and `class-transformer` are installed in the `backend/` workspace.
6. `ValidationPipe({ whitelist: true })` is applied globally in `main.ts`.
7. `JwtRefreshStrategy` (`'jwt-refresh'`) extracts the token from `req.cookies['refresh_token']`, validates against `JWT_REFRESH_SECRET` with algorithm pinned to HS256, and throws `UnauthorizedException` if the staff record cannot be found or `isActive` is false.
8. `JwtRefreshGuard` extends `AuthGuard('jwt-refresh')` and is used on the refresh endpoint.
9. `StaffService.findById(id: string): Promise<Staff | null>` is added and tested.
10. `AuthModule` imports `StaffModule`; `AuthController`, `JwtRefreshStrategy`, `JwtRefreshGuard` are registered in `AuthModule`.
11. Unit tests in `auth.controller.spec.ts` cover: login happy path, login wrong password, login inactive staff, refresh happy path, refresh missing cookie, logout returns 204.
12. `npm run typecheck`, `npm run lint`, `npm test` all pass with zero errors.

## Tasks / Subtasks

- [x] Task 1 — Install packages (AC: 5)
  - [x] `npm install class-validator class-transformer --workspace=backend`
  - [x] Verify both appear in `backend/package.json` dependencies

- [x] Task 2 — Global ValidationPipe in main.ts (AC: 6)
  - [x] In `backend/src/main.ts`, add `import { ValidationPipe } from '@nestjs/common'` and `app.useGlobalPipes(new ValidationPipe({ whitelist: true }))` before `app.listen`

- [x] Task 3 — LoginDto (AC: 4)
  - [x] Create `backend/src/auth/dto/login.dto.ts`
  - [x] Fields: `@IsEmail() email: string`, `@IsString() @IsNotEmpty() password: string`

- [x] Task 4 — StaffService.findById (AC: 9)
  - [x] Add `async findById(id: string): Promise<Staff | null>` to `backend/src/staff/staff.service.ts`
  - [x] Filters `deletedAt: null` (soft-deleted staff can't refresh)
  - [x] Add unit test in `backend/src/staff/staff.service.spec.ts`

- [x] Task 5 — JwtRefreshStrategy + JwtRefreshGuard (AC: 7, 8)
  - [x] Create `backend/src/auth/strategies/jwt-refresh.strategy.ts` (see Dev Notes for full spec)
  - [x] Create `backend/src/auth/guards/jwt-refresh.guard.ts`

- [x] Task 6 — AuthController (AC: 1, 2, 3)
  - [x] Create `backend/src/auth/auth.controller.ts` with `@Controller('auth')` (prefix `api` is global)
  - [x] `login()`: find → verify → active check → sign tokens → set cookie → return user DTO
  - [x] `refresh()`: protected by JwtRefreshGuard; sign new access token; return `{ accessToken }`
  - [x] `logout()`: `res.clearCookie(...)` → HttpCode(204)

- [x] Task 7 — Wire AuthModule (AC: 10)
  - [x] Add `StaffModule` to `AuthModule` imports
  - [x] Add `AuthController` to `AuthModule` controllers
  - [x] Add `JwtRefreshStrategy`, `JwtRefreshGuard` to `AuthModule` providers

- [x] Task 8 — Unit tests for AuthController (AC: 11)
  - [x] Create `backend/src/auth/auth.controller.spec.ts` (see Dev Notes for test cases)

- [x] Task 9 — Typecheck, lint, test (AC: 12)
  - [x] `npm run typecheck --workspace=backend`
  - [x] `npm run lint --workspace=backend`
  - [x] `npm test --workspace=backend`

## Dev Notes

### Existing Codebase — What to Build On

**`backend/src/auth/auth.service.ts`** (DO NOT CHANGE SIGNATURES):
- `signAccessToken(staff: Staff): string` — signs access JWT
- `signRefreshToken(staff: Staff): string` — signs refresh JWT
- `setRefreshCookie(res: Response, token: string): void` — sets `refresh_token` cookie with `httpOnly`, `sameSite: 'lax'`, `path: '/api/auth/refresh'`, `maxAge` derived from `JWT_REFRESH_EXPIRY`

**`backend/src/staff/staff.service.ts`** (EXTEND, don't break existing methods):
- `findByEmail(email: string): Promise<Staff | null>` — already exists, use for login
- `verifyPassword(hash: string, plain: string): Promise<boolean>` — already exists, use for login
- ADD: `findById(id: string): Promise<Staff | null>` — for refresh strategy

**`backend/src/main.ts`** (current state):
```typescript
import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.use(cookieParser());             // ← already present
  app.setGlobalPrefix('api');          // ← already present — routes are /api/auth/*
  await app.listen(parseInt(process.env.PORT ?? '3000', 10), '0.0.0.0');
}
void bootstrap();
```
Add `ValidationPipe` here; do NOT add a second `cookieParser()` call.

**`backend/src/prisma/prisma.module.ts`**: `@Global()` — `PrismaService` is injectable everywhere without importing PrismaModule.

**`backend/src/staff/staff.module.ts`**: exports `StaffService`. Import `StaffModule` into `AuthModule` to access `StaffService`.

### Route Paths

Global prefix is `api` → `@Controller('auth')` → routes at `/api/auth/*`:
- `/api/auth/login`
- `/api/auth/refresh`
- `/api/auth/logout`

The refresh cookie `path` is already set to `/api/auth/refresh` by `setRefreshCookie()`. When clearing in logout, use the SAME path: `res.clearCookie('refresh_token', { path: '/api/auth/refresh' })`.

### JwtRefreshStrategy — Full Spec

```typescript
// backend/src/auth/strategies/jwt-refresh.strategy.ts
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { StaffService } from '../../staff/staff.service';
import { Staff } from '@prisma/client';

@Injectable()
export class JwtRefreshStrategy extends PassportStrategy(Strategy, 'jwt-refresh') {
  constructor(config: ConfigService, private readonly staff: StaffService) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        (req: Request) => (req?.cookies as Record<string, string>)['refresh_token'] ?? null,
      ]),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('JWT_REFRESH_SECRET'),
      algorithms: ['HS256'],
    });
  }

  async validate(payload: { sub: string }): Promise<Staff> {
    const staff = await this.staff.findById(payload.sub);
    if (!staff || !staff.isActive) {
      throw new UnauthorizedException('Session expired or account deactivated');
    }
    return staff;
  }
}
```

### AuthController — Full Spec

```typescript
// backend/src/auth/auth.controller.ts
import {
  Controller, Post, Body, Res, Req, HttpCode, UseGuards,
} from '@nestjs/common';
import { Response, Request } from 'express';
import { AuthService } from './auth.service';
import { StaffService } from '../staff/staff.service';
import { JwtRefreshGuard } from './guards/jwt-refresh.guard';
import { LoginDto } from './dto/login.dto';
import { Staff } from '@prisma/client';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly staffService: StaffService,
  ) {}

  @Post('login')
  async login(@Body() dto: LoginDto, @Res({ passthrough: true }) res: Response) {
    const staff = await this.staffService.findByEmail(dto.email);
    const valid =
      staff != null && (await this.staffService.verifyPassword(staff.passwordHash, dto.password));
    if (!valid || !staff?.isActive) {
      // Unified 401 — same message for not-found, wrong password, inactive
      throw new UnauthorizedException('Invalid credentials');
    }
    const accessToken = this.authService.signAccessToken(staff);
    const refreshToken = this.authService.signRefreshToken(staff);
    this.authService.setRefreshCookie(res, refreshToken);
    return {
      accessToken,
      user: { id: staff.id, email: staff.email, name: staff.name, role: staff.role },
    };
  }

  @Post('refresh')
  @UseGuards(JwtRefreshGuard)
  async refresh(@Req() req: Request & { user: Staff }) {
    const accessToken = this.authService.signAccessToken(req.user);
    return { accessToken };
  }

  @Post('logout')
  @HttpCode(204)
  logout(@Res({ passthrough: true }) res: Response) {
    res.clearCookie('refresh_token', { path: '/api/auth/refresh' });
  }
}
```

**Important:** Use `@Res({ passthrough: true })` — NOT `@Res()` alone — so NestJS interceptors still run and the response lifecycle is not bypassed.

**Security note on login:** The timing attack surface is minimal — `verifyPassword` is called only when staff exists. However, the 401 message must be identical for all failure modes to prevent email enumeration. Never return `"User not found"` vs `"Wrong password"`.

### LoginDto

```typescript
// backend/src/auth/dto/login.dto.ts
import { IsEmail, IsNotEmpty, IsString } from 'class-validator';

export class LoginDto {
  @IsEmail()
  email!: string;

  @IsString()
  @IsNotEmpty()
  password!: string;
}
```

### StaffService.findById Addition

```typescript
async findById(id: string): Promise<Staff | null> {
  return this.prisma.staff.findFirst({
    where: { id, deletedAt: null },
  });
}
```

### AuthModule — Updated Wiring

```typescript
@Module({
  imports: [
    StaffModule,           // ← ADD
    PassportModule,
    JwtModule.registerAsync({ ... }),  // unchanged
  ],
  controllers: [AuthController],        // ← ADD
  providers: [AuthService, JwtStrategy, JwtRefreshStrategy, JwtAuthGuard, JwtRefreshGuard],  // ADD two
  exports: [AuthService, JwtAuthGuard],
})
export class AuthModule {}
```

### Test Cases for auth.controller.spec.ts

Mock `AuthService` and `StaffService`. For `refresh`, mock the guard using `jest.mock` or `overrideGuard`.

Required tests (minimum):
1. `login` — happy path: returns `{ accessToken, user }` and calls `setRefreshCookie`
2. `login` — wrong password: `verifyPassword` returns false → throws 401
3. `login` — staff not found: `findByEmail` returns null → throws 401
4. `login` — inactive staff: staff found, password correct, but `isActive: false` → throws 401
5. `refresh` — happy path: guard passes staff as `req.user`, returns `{ accessToken }`
6. `logout` — calls `clearCookie` and returns 204

**Pattern for mocking JwtRefreshGuard in controller tests:**
```typescript
// In the module setup, override the guard:
.overrideGuard(JwtRefreshGuard).useValue({ canActivate: () => true })
```
Then set `req.user = fakeStaff` on the mock request object.

### From Deferred Work Doc — Apply in This Story

- "No global ValidationPipe in main.ts — address when adding routes (E2+)" → Task 2 above.

### Project Structure Notes

New files follow existing auth module patterns:
```
api/src/auth/
  dto/
    login.dto.ts           ← NEW
  guards/
    jwt-auth.guard.ts      (existing)
    jwt-refresh.guard.ts   ← NEW
  interfaces/
    jwt-payload.interface.ts (existing)
  strategies/
    jwt.strategy.ts        (existing)
    jwt-refresh.strategy.ts ← NEW
  auth.controller.ts       ← NEW
  auth.controller.spec.ts  ← NEW
  auth.module.ts           ← MODIFY
  auth.service.ts          (no change)
  auth.service.spec.ts     (no change)

api/src/staff/
  staff.service.ts         ← MODIFY (add findById)
  staff.service.spec.ts    ← MODIFY (add findById test)

api/src/main.ts            ← MODIFY (add ValidationPipe)
```

### References

- Epics file: [Source: docs/epics.md#E2] — E2-S3 spec
- Architecture: [Source: docs/architecture.md#L241-L347] — JWT flow, cookie policy, class-validator
- Deferred work: [Source: _bmad-output/implementation-artifacts/deferred-work.md] — ValidationPipe, CSRF note
- Story 2-2 artifact: [Source: _bmad-output/implementation-artifacts/2-2-jwt-refresh-token.md] — AuthService API
- Existing: `backend/src/auth/auth.service.ts`, `backend/src/staff/staff.service.ts`, `backend/src/main.ts`

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

None — clean implementation, no debugging required.

### Completion Notes List

- Installed class-validator ^0.15.1 and class-transformer ^0.5.1 in api workspace
- Added global ValidationPipe({ whitelist: true }) to main.ts (resolves deferred item from 1-1 code review)
- LoginDto uses @IsEmail + @IsString + @IsNotEmpty decorators
- StaffService.findById() filters deletedAt: null to exclude soft-deleted staff
- JwtRefreshStrategy reads refresh_token from req.cookies, validates against JWT_REFRESH_SECRET (HS256), re-checks isActive via DB; Passport registers it by side-effect so no export needed
- AuthController uses @Res({ passthrough: true }) on login/logout to keep NestJS interceptor lifecycle intact
- Login unified 401 message prevents email enumeration — same message for not-found, wrong password, inactive
- Refresh is one-way (new access token only, existing cookie preserved) — rotation deferred to 2-5 when Redis token store is available
- ESLint auto-fixed one prettier formatting issue in auth.controller.ts (excessively long return type inline)
- 40 tests passing across 9 suites; 9 new tests in auth.controller.spec.ts, 2 new in staff.service.spec.ts

### File List

- backend/src/auth/dto/login.dto.ts (NEW)
- backend/src/auth/strategies/jwt-refresh.strategy.ts (NEW)
- backend/src/auth/guards/jwt-refresh.guard.ts (NEW)
- backend/src/auth/auth.controller.ts (NEW)
- backend/src/auth/auth.controller.spec.ts (NEW)
- backend/src/auth/auth.module.ts (MODIFIED — added StaffModule, AuthController, JwtRefreshStrategy, JwtRefreshGuard)
- backend/src/staff/staff.service.ts (MODIFIED — added findById)
- backend/src/staff/staff.service.spec.ts (MODIFIED — added 2 findById tests)
- backend/src/main.ts (MODIFIED — added ValidationPipe)
- backend/package.json (MODIFIED — class-validator, class-transformer added)

### Review Findings

- [x] [Review][Patch] Login endpoint success status defaults to 201 instead of 200 [api/src/auth/auth.controller.ts:30]
- [x] [Review][Patch] Refresh endpoint success status defaults to 201 instead of 200 [api/src/auth/auth.controller.ts:52]
- [x] [Review][Patch] Missing unit test for "refresh missing cookie" scenario [api/src/auth/auth.controller.spec.ts:118]
- [x] [Review][Patch] Timing-attack email enumeration on login [api/src/auth/auth.controller.ts:31]
- [x] [Review][Patch] Prisma filter bypass when payload.sub is missing or undefined [api/src/auth/strategies/jwt-refresh.strategy.ts:26]
- [x] [Review][Patch] Crash (500) on malformed UUID queries in StaffService.findById [api/src/staff/staff.service.ts:30]
- [x] [Review][Patch] Crash (500) on empty, null, or invalid passwordHash in argon2 verify [api/src/staff/staff.service.ts:36]
- [x] [Review][Patch] Incomplete cookie options on logout prevent clearance [api/src/auth/auth.controller.ts:58]
- [x] [Review][Patch] ValidationPipe lacks transform: true in main.ts [api/src/main.ts:8]
- [x] [Review][Patch] Redundant guard override in auth.controller.spec.ts [api/src/auth/auth.controller.spec.ts:60]
- [x] [Review][Patch] Incomplete anti-enumeration unit test coverage [api/src/auth/auth.controller.spec.ts:100]
- [x] [Review][Patch] Manual promise catch in unit tests is error-prone [api/src/auth/auth.controller.spec.ts:115]
- [x] [Review][Patch] PORT environment variable non-numeric check [api/src/main.ts:8]
- [x] [Review][Patch] Missing email normalization (trimming/lowercase) [api/src/auth/dto/login.dto.ts:3]
- [x] [Review][Defer] Owner staff record is soft-deleted before the seed script is executed [api/prisma/seed.ts:22] — deferred, pre-existing
- [x] [Review][Defer] Broken anchor link in Table of Contents of README.md [README.md] — deferred, pre-existing
- [x] [Review][Defer] Lack of Swagger OpenAPI decorators on AuthController [api/src/auth/auth.controller.ts] — deferred, pre-existing

