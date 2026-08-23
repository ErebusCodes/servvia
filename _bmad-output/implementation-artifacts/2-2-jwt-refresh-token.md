---
baseline_commit: 24db171
---

# Story 2.2: JWT issuance — access token + HttpOnly refresh cookie

Status: done

> **Enterprise conformance addendum — 2026-08-15:** Sessions must preserve organization, venue and actor/device scope. Browser access tokens remain memory-only; refresh rotation/revocation and device lifecycle are required. Venue connectors use separate revocable installation identities and mutual authentication—not staff JWTs. See [`docs/target-operating-model.md`](../../docs/target-operating-model.md).

## Story

As a developer,
I want an `AuthService` that signs access tokens (15-min JWT) and refresh tokens (7-day JWT in HttpOnly cookie), a `JwtStrategy` that validates Bearer tokens, and a `JwtAuthGuard` ready for use,
so that Story 2-3 (login/refresh/logout endpoints) can call `AuthService` directly and protect routes with `@UseGuards(JwtAuthGuard)`.

## Acceptance Criteria

1. `@nestjs/jwt`, `@nestjs/passport`, `passport`, `passport-jwt`, `@types/passport-jwt`, `cookie-parser`, `@types/cookie-parser` are installed in `backend/` workspace.
2. `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` are required in the Joi validation schema in `app.module.ts`. `JWT_ACCESS_EXPIRY` defaults to `'15m'`, `JWT_REFRESH_EXPIRY` defaults to `'7d'`.
3. `JwtPayload` interface is defined at `backend/src/auth/interfaces/jwt-payload.interface.ts` with `sub: string`, `email: string`, `role: StaffRole`.
4. `AuthService` (at `backend/src/auth/auth.service.ts`) exposes:
   - `signAccessToken(staff: Staff): string` — signs a JWT using `JWT_ACCESS_SECRET` with payload `{ sub: staff.id, email: staff.email, role: staff.role }` and expiry from `JWT_ACCESS_EXPIRY`.
   - `signRefreshToken(staff: Staff): string` — signs a JWT using `JWT_REFRESH_SECRET` with payload `{ sub: staff.id }` and expiry from `JWT_REFRESH_EXPIRY`.
   - `setRefreshCookie(res: Response, token: string): void` — calls `res.cookie('refresh_token', token, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict', path: '/api/auth/refresh', maxAge: 7 * 24 * 60 * 60 * 1000 })`.
5. `JwtStrategy` at `backend/src/auth/strategies/jwt.strategy.ts` extends `PassportStrategy(Strategy, 'jwt')`, extracts Bearer token from `Authorization` header, validates against `JWT_ACCESS_SECRET`, and returns the full `JwtPayload` from `validate()`.
6. `JwtAuthGuard` at `backend/src/auth/guards/jwt-auth.guard.ts` extends `AuthGuard('jwt')` — no other logic.
7. `AuthModule` imports `JwtModule.registerAsync` (using `ConfigService`), `PassportModule`; provides `AuthService`, `JwtStrategy`, `JwtAuthGuard`; exports `AuthService` and `JwtAuthGuard`.
8. `cookieParser()` middleware is applied in `main.ts` before `app.listen`.
9. Unit tests in `backend/src/auth/auth.service.spec.ts`: mock `JwtService`; at least 6 tests covering:
   - `signAccessToken` returns a string and encodes `sub`, `email`, `role` in payload
   - `signAccessToken` does NOT return the same value when called twice (sanity: non-empty string)
   - `signRefreshToken` returns a string with `sub` in payload
   - `setRefreshCookie` calls `res.cookie` with `httpOnly: true`
   - `setRefreshCookie` calls `res.cookie` with `sameSite: 'strict'`
   - `setRefreshCookie` calls `res.cookie` with `path: '/api/auth/refresh'`
10. `npm run typecheck`, `npm run lint`, `npm test` all pass with zero errors.

## Tasks / Subtasks

- [x] Task 1 — Install packages (AC: 1)
  - [x] `npm install @nestjs/jwt @nestjs/passport passport passport-jwt cookie-parser --workspace=backend`
  - [x] `npm install --save-dev @types/passport-jwt @types/cookie-parser --workspace=backend`
  - [x] Confirm all packages appear in `backend/package.json`

- [x] Task 2 — Env validation (AC: 2)
  - [x] In `backend/src/app.module.ts`, add to the Joi schema:
    ```typescript
    JWT_ACCESS_SECRET: Joi.string().required(),
    JWT_REFRESH_SECRET: Joi.string().required(),
    JWT_ACCESS_EXPIRY: Joi.string().default('15m'),
    JWT_REFRESH_EXPIRY: Joi.string().default('7d'),
    ```
  - [x] Add the same four vars to `backend/.env.example` (use placeholder values, e.g. `JWT_ACCESS_SECRET=change-me-access`)

- [x] Task 3 — JwtPayload interface (AC: 3)
  - [x] Create `backend/src/auth/interfaces/jwt-payload.interface.ts`:
    ```typescript
    import { StaffRole } from '@prisma/client';

    export interface JwtPayload {
      sub: string;
      email: string;
      role: StaffRole;
      iat?: number;
      exp?: number;
    }
    ```

- [x] Task 4 — AuthService (TDD) (AC: 4, 9)
  - [x] Write failing tests first in `backend/src/auth/auth.service.spec.ts`:
    ```typescript
    import { Test, TestingModule } from '@nestjs/testing';
    import { JwtService } from '@nestjs/jwt';
    import { Response } from 'express';
    import { AuthService } from './auth.service';
    import { StaffRole } from '@prisma/client';
    import { Staff } from '@prisma/client';

    const mockJwtService = {
      sign: jest.fn(),
    };

    const fakeStaff: Staff = {
      id: 'staff-uuid',
      organizationId: 'org-uuid',
      email: 'owner@verdura.co.nz',
      name: 'Owner',
      passwordHash: 'hash',
      role: StaffRole.owner,
      isActive: true,
      totpSecret: null,
      isTotpEnabled: false,
      lastLoginAt: null,
      lastLoginIp: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
    };

    describe('AuthService', () => {
      let service: AuthService;

      beforeEach(async () => {
        jest.clearAllMocks();
        mockJwtService.sign.mockReturnValue('signed-token');
        const module: TestingModule = await Test.createTestingModule({
          providers: [
            AuthService,
            { provide: JwtService, useValue: mockJwtService },
          ],
        }).compile();
        service = module.get<AuthService>(AuthService);
      });

      it('signAccessToken calls JwtService.sign with sub, email, role', () => {
        service.signAccessToken(fakeStaff);
        expect(mockJwtService.sign).toHaveBeenCalledWith(
          { sub: fakeStaff.id, email: fakeStaff.email, role: fakeStaff.role },
          expect.any(Object),
        );
      });

      it('signAccessToken returns the signed token string', () => {
        const result = service.signAccessToken(fakeStaff);
        expect(typeof result).toBe('string');
        expect(result).toBe('signed-token');
      });

      it('signRefreshToken calls JwtService.sign with sub only', () => {
        service.signRefreshToken(fakeStaff);
        expect(mockJwtService.sign).toHaveBeenCalledWith(
          { sub: fakeStaff.id },
          expect.any(Object),
        );
      });

      it('setRefreshCookie sets httpOnly cookie', () => {
        const mockRes = { cookie: jest.fn() } as unknown as Response;
        service.setRefreshCookie(mockRes, 'refresh-token-value');
        expect(mockRes.cookie).toHaveBeenCalledWith(
          'refresh_token',
          'refresh-token-value',
          expect.objectContaining({ httpOnly: true }),
        );
      });

      it('setRefreshCookie uses sameSite strict', () => {
        const mockRes = { cookie: jest.fn() } as unknown as Response;
        service.setRefreshCookie(mockRes, 'refresh-token-value');
        expect(mockRes.cookie).toHaveBeenCalledWith(
          'refresh_token',
          'refresh-token-value',
          expect.objectContaining({ sameSite: 'strict' }),
        );
      });

      it('setRefreshCookie scopes cookie to /api/auth/refresh', () => {
        const mockRes = { cookie: jest.fn() } as unknown as Response;
        service.setRefreshCookie(mockRes, 'refresh-token-value');
        expect(mockRes.cookie).toHaveBeenCalledWith(
          'refresh_token',
          'refresh-token-value',
          expect.objectContaining({ path: '/api/auth/refresh' }),
        );
      });
    });
    ```
  - [x] Run tests → expect FAIL (module not found)
  - [x] Create `backend/src/auth/auth.service.ts`:
    ```typescript
    import { Injectable } from '@nestjs/common';
    import { JwtService } from '@nestjs/jwt';
    import { ConfigService } from '@nestjs/config';
    import { Staff } from '@prisma/client';
    import { Response } from 'express';
    import { JwtPayload } from './interfaces/jwt-payload.interface';

    @Injectable()
    export class AuthService {
      constructor(
        private readonly jwt: JwtService,
        private readonly config: ConfigService,
      ) {}

      signAccessToken(staff: Staff): string {
        const payload: Omit<JwtPayload, 'iat' | 'exp'> = {
          sub: staff.id,
          email: staff.email,
          role: staff.role,
        };
        return this.jwt.sign(payload, {
          secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
          expiresIn: this.config.get<string>('JWT_ACCESS_EXPIRY', '15m'),
        });
      }

      signRefreshToken(staff: Staff): string {
        return this.jwt.sign(
          { sub: staff.id },
          {
            secret: this.config.getOrThrow<string>('JWT_REFRESH_SECRET'),
            expiresIn: this.config.get<string>('JWT_REFRESH_EXPIRY', '7d'),
          },
        );
      }

      setRefreshCookie(res: Response, token: string): void {
        res.cookie('refresh_token', token, {
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: 'strict',
          path: '/api/auth/refresh',
          maxAge: 7 * 24 * 60 * 60 * 1000,
        });
      }
    }
    ```
  - [x] Run tests → expect 6 tests PASS

- [x] Task 5 — JwtStrategy (AC: 5)
  - [x] Create `backend/src/auth/strategies/jwt.strategy.ts`:
    ```typescript
    import { Injectable } from '@nestjs/common';
    import { PassportStrategy } from '@nestjs/passport';
    import { ExtractJwt, Strategy } from 'passport-jwt';
    import { ConfigService } from '@nestjs/config';
    import { JwtPayload } from '../interfaces/jwt-payload.interface';

    @Injectable()
    export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
      constructor(config: ConfigService) {
        super({
          jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
          ignoreExpiration: false,
          secretOrKey: config.getOrThrow<string>('JWT_ACCESS_SECRET'),
        });
      }

      validate(payload: JwtPayload): JwtPayload {
        return payload;
      }
    }
    ```

- [x] Task 6 — JwtAuthGuard (AC: 6)
  - [x] Create `backend/src/auth/guards/jwt-auth.guard.ts`:
    ```typescript
    import { Injectable } from '@nestjs/common';
    import { AuthGuard } from '@nestjs/passport';

    @Injectable()
    export class JwtAuthGuard extends AuthGuard('jwt') {}
    ```

- [x] Task 7 — Wire AuthModule (AC: 7)
  - [x] Replace content of `backend/src/auth/auth.module.ts`:
    ```typescript
    import { Module } from '@nestjs/common';
    import { JwtModule } from '@nestjs/jwt';
    import { PassportModule } from '@nestjs/passport';
    import { ConfigService } from '@nestjs/config';
    import { AuthService } from './auth.service';
    import { JwtStrategy } from './strategies/jwt.strategy';
    import { JwtAuthGuard } from './guards/jwt-auth.guard';

    @Module({
      imports: [
        PassportModule,
        JwtModule.registerAsync({
          inject: [ConfigService],
          useFactory: (config: ConfigService) => ({
            secret: config.getOrThrow<string>('JWT_ACCESS_SECRET'),
            signOptions: {
              expiresIn: config.get<string>('JWT_ACCESS_EXPIRY', '15m'),
            },
          }),
        }),
      ],
      providers: [AuthService, JwtStrategy, JwtAuthGuard],
      exports: [AuthService, JwtAuthGuard],
    })
    export class AuthModule {}
    ```

- [x] Task 8 — cookieParser middleware (AC: 8)
  - [x] In `backend/src/main.ts`, add before `app.setGlobalPrefix`:
    ```typescript
    import cookieParser from 'cookie-parser';
    // ...
    app.use(cookieParser());
    ```

### Review Findings

- [ ] [Review][Decision] validate() never checks isActive/deletedAt — deactivated/soft-deleted staff can use unexpired access tokens (up to 15 min). Decision: keep stateless (accept risk, document) vs. add DB lookup in validate(). [jwt.strategy.ts]
- [ ] [Review][Decision] sameSite:'strict' may block refresh cookie on cross-origin navigations (OAuth, TOTP redirect, email magic-link). Schema has totpSecret — if TOTP flows are planned, 'lax' is more appropriate. Decision: keep 'strict' vs. change to 'lax'. [auth.service.ts]
- [ ] [Review][Patch] JWT algorithm not pinned — add `algorithms: ['HS256']` to JwtStrategy super() options to prevent algorithm confusion attacks [api/src/auth/strategies/jwt.strategy.ts]
- [ ] [Review][Patch] `secure` flag reads `process.env.NODE_ENV` directly bypassing ConfigService — use `config.get<string>('NODE_ENV') === 'production'` [api/src/auth/auth.service.ts:38]
- [ ] [Review][Patch] Cookie `maxAge` hardcoded to 7 days but `JWT_REFRESH_EXPIRY` is configurable — derive maxAge from config to keep them in sync [api/src/auth/auth.service.ts:42]
- [ ] [Review][Patch] Joi schema missing `.min(32)` on JWT secrets — short secrets silently accepted, making HS256 brute-forceable [api/src/app.module.ts]
- [ ] [Review][Patch] `JWT_ACCESS_EXPIRY` and `JWT_REFRESH_EXPIRY` not in Joi schema — misconfiguration silently falls through to hardcoded defaults [api/src/app.module.ts]
- [ ] [Review][Patch] `JWT_REFRESH_EXPIRY` missing from `test-setup.ts` — `signRefreshToken` may resolve expiry as undefined in test runs not using the real ConfigModule [api/src/test-setup.ts]
- [ ] [Review][Patch] No test for `secure: true` production branch — regression (removing secure flag) would go undetected [api/src/auth/auth.service.spec.ts]
- [ ] [Review][Patch] `validate()` has no runtime shape guard — malformed tokens with missing `sub`/`role` pass TypeScript types silently; add UnauthorizedException check [api/src/auth/strategies/jwt.strategy.ts:18]
- [x] [Review][Defer] No CSRF token mechanism — sameSite:strict provides partial protection; full CSRF out of scope for 2-2 — deferred
- [x] [Review][Defer] `JwtStrategy` not exported from AuthModule — low risk (Passport registers it by side-effect); only affects direct injection which isn't needed yet — deferred

- [x] Task 9 — Final verification and commit (AC: 10)
  - [x] `npm run typecheck` → zero errors
  - [x] `npm run lint` → zero errors
  - [x] `npm test` → all tests pass (29 total: 6 new + 23 existing)
  - [x] `git add backend/src/auth/ backend/src/app.module.ts backend/src/main.ts backend/package.json backend/.env.example backend/src/prisma/prisma.service.ts backend/tsconfig.json backend/src/test-setup.ts`
  - [x] `git commit -m "feat(api): add AuthService (JWT issuance), JwtStrategy, JwtAuthGuard"` → a1dbc62

## Dev Notes

### Context from Story 2-1

- `StaffService.findByEmail()` and `StaffService.verifyPassword()` are already implemented in `backend/src/staff/staff.service.ts`. Story 2-3 (login endpoint) will import `StaffModule` into `AuthModule` to use them — **do NOT add StaffModule import in this story**.
- Established patterns: `PrismaModule` is `@Global()`, `ConfigModule` is `isGlobal: true` — submodules do not need to import either.
- Test pattern: mock collaborators via `useValue` in `Test.createTestingModule`, call `jest.clearAllMocks()` in `beforeEach`.

### Unstaged working-tree changes to commit alongside this story

Two files were modified during story 2-1 review but not yet committed:
- **`backend/src/prisma/prisma.service.ts`** — `onModuleInit` now swallows connection errors with a `console.warn` so the server starts even if Supabase is unreachable. Include this file in the commit.
- **`backend/tsconfig.json`** — adds `"strictPropertyInitialization": false`. **This is required** for `JwtStrategy` to compile: the Passport `Strategy` superclass assigns the `name` property via the decorator, not the constructor, which TS strict mode flags without this flag.

### JWT design decisions

- **Stateless refresh tokens** — the refresh token is a signed JWT (not a random opaque string stored in DB). The `Staff` model has no `refreshTokenHash` column. Logout in E2-S3 works by clearing the cookie client-side and is sufficient for MVP.
- **Two secrets** — `JWT_ACCESS_SECRET` for access tokens, `JWT_REFRESH_SECRET` for refresh tokens. Using a single secret would allow a refresh token to be submitted as a Bearer access token; separate secrets prevent this class of attack.
- **`AuthService.signAccessToken` passes `secret` and `expiresIn` explicitly** — not relying on JwtModule-level defaults, because the refresh token uses a different secret. Both `sign()` calls are explicit.
- **`JwtModule.registerAsync` default** — JwtModule is configured with `JWT_ACCESS_SECRET` as the module-level default. `JwtStrategy` also reads this same secret via `ConfigService`. This is intentional — the module default is used for any implicit `JwtService.sign()` callers; explicit overrides (as in `signRefreshToken`) always win.
- **Cookie `path: '/api/auth/refresh'`** — scopes the refresh cookie so browsers only send it to the refresh endpoint. The logout endpoint in E2-S3 clears it with `res.clearCookie('refresh_token', { path: '/api/auth/refresh' })`.
- **Cookie `secure: process.env.NODE_ENV === 'production'`** — allows cookie to work over HTTP in local dev; enforces HTTPS in production.

### Token payload

```
Access JWT payload:  { sub: staffId, email, role, iat, exp }
Refresh JWT payload: { sub: staffId, iat, exp }
```

`JwtStrategy.validate()` returns the full payload as the request user object — downstream handlers (E2-S3, E2-S4 RBAC guard) read `req.user.role` and `req.user.sub`.

### File structure

```
api/src/auth/
  auth.module.ts               UPDATE (empty shell → wired module)
  auth.service.ts              NEW
  auth.service.spec.ts         NEW
  interfaces/
    jwt-payload.interface.ts   NEW
  strategies/
    jwt.strategy.ts            NEW
  guards/
    jwt-auth.guard.ts          NEW
api/src/main.ts                UPDATE (add cookieParser)
api/src/app.module.ts          UPDATE (add JWT vars to Joi schema)
api/.env.example               UPDATE (add JWT vars)
api/src/prisma/prisma.service.ts  UPDATE (already modified — commit now)
api/tsconfig.json              UPDATE (already modified — commit now)
```

### Testing standards

- Unit tests only — no integration or e2e in this story.
- `JwtService` is mocked; do not use a real JWT library in tests.
- `JwtStrategy` has no unit test in this story — it is a thin Passport adapter. Covered by e2e tests in a later story.

### What story 2-3 will consume from this story

- `AuthService.signAccessToken()` — called after successful login
- `AuthService.signRefreshToken()` — called after successful login
- `AuthService.setRefreshCookie()` — called after successful login
- `JwtAuthGuard` — applied to the `/api/auth/refresh` endpoint
- `JwtPayload` interface — used as `@Req() req` user type

### References

- JWT strategy: [Source: docs/architecture.md#Section 9 Security Architecture Summary]
- Token parameters: [Source: docs/architecture.md#Section 4.2 Admin Dashboard]
- Epic story list: [Source: docs/epics.md#E2 Authentication]
- NestJS 11 target: [Source: docs/architecture.md#Section 10 Technology Stack Summary]

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

- `expiresIn` type mismatch: `@nestjs/jwt` v11 types `expiresIn` as `ms.StringValue`, not plain `string`. ESLint's `no-unnecessary-type-assertion` rule flagged the initial cast as unneeded after auto-fix removed it; typecheck still passed, confirming the types are compatible without explicit assertion.
- `app.module.spec.ts` crashed on import due to Joi validation running at module load time with no env vars set. Fixed by adding `backend/src/test-setup.ts` (sets minimal env vars) and wiring it via `setupFiles` in Jest config.
- `unbound-method` lint error on `expect(mockRes.cookie)`: fixed by capturing `jest.fn()` in a named `cookieFn` constant and asserting on that directly.

### Completion Notes List

- All 9 tasks completed. 13 files changed (6 new, 7 updated). Commit: a1dbc62.
- AuthService: `signAccessToken` (15-min JWT, payload: sub/email/role), `signRefreshToken` (7-day JWT, payload: sub), `setRefreshCookie` (HttpOnly, SameSite=Strict, path=/api/auth/refresh).
- JwtStrategy: extracts Bearer token from Authorization header, validates against JWT_ACCESS_SECRET, returns full JwtPayload as `req.user`.
- JwtAuthGuard: thin wrapper on AuthGuard('jwt') — ready for `@UseGuards(JwtAuthGuard)` on any endpoint.
- AuthModule: wired with JwtModule.registerAsync + PassportModule; exports AuthService and JwtAuthGuard.
- 6 new unit tests (all green). 29/29 total tests pass. Zero typecheck/lint errors.
- Also committed: PrismaService graceful startup (swallows DB conn error on boot) and `strictPropertyInitialization: false` in tsconfig (required for Passport strategy compilation).

### File List

- `backend/src/auth/auth.module.ts` — updated (was empty shell, now wired)
- `backend/src/auth/auth.service.ts` — new
- `backend/src/auth/auth.service.spec.ts` — new
- `backend/src/auth/interfaces/jwt-payload.interface.ts` — new
- `backend/src/auth/strategies/jwt.strategy.ts` — new
- `backend/src/auth/guards/jwt-auth.guard.ts` — new
- `backend/src/main.ts` — updated (cookieParser middleware)
- `backend/src/app.module.ts` — updated (JWT vars in Joi schema)
- `backend/.env.example` — updated (JWT vars added)
- `backend/package.json` — updated (new deps + Jest setupFiles)
- `backend/src/test-setup.ts` — new (Jest env var setup)
- `backend/src/prisma/prisma.service.ts` — updated (graceful startup)
- `backend/tsconfig.json` — updated (strictPropertyInitialization: false)
