---
baseline_commit: e7f488d
---

# Story 2.5: Rate Limiting

Status: done

> **Enterprise conformance addendum — 2026-08-15:** Rate limits must be organization/venue/device aware and cover public order/payment creation, connector pairing/command polling, retries, refunds and reprints without disrupting kitchen service. Idempotency is mandatory and is not replaced by rate limiting. See [`docs/target-operating-model.md`](../../docs/target-operating-model.md).

## Story

As a developer,  
I want production-ready rate limiting on authentication and public-facing endpoints,  
so that they are protected from brute-force attacks, token abuse, and denial-of-service patterns.

## Acceptance Criteria

1. Implement a `@RateLimit()` decorator allowing custom thresholds (limit/windowSeconds).
2. Implement `RateLimitGuard` using Redis (`ioredis`) for sliding window rate limiting.
3. Apply `RateLimitGuard` to protect `AuthController` routes (`login`, `refresh`, `logout`).
4. Return HTTP 429 (`Too Many Requests`) with a consistent error response when limits are exceeded.
5. Set `Retry-After` header specifying remaining seconds of the lockout when 429 is returned.
6. Gracefully fail-open (allow request) if Redis service is down or connection errors occur.
7. Safely extract client IP from `X-Forwarded-For` header to support reverse proxy environments.
8. Create comprehensive unit tests covering:
   - Success under threshold.
   - HTTP 429 and Retry-After header when threshold is exceeded.
   - Redis store failures (fail-open safety).
   - X-Forwarded-For parsing.
   - Default configurations.
9. Verify all code changes by running `npm run typecheck`, `npm run lint`, and `npm test` without errors.

## Tasks / Subtasks

- [x] Task 1 — Create Global RedisModule (AC: 2)
  - [x] Create `backend/src/redis/redis.module.ts` exposing `REDIS_CLIENT` provider
  - [x] Register `RedisModule` in `backend/src/app.module.ts`
- [x] Task 2 — Create RateLimit Decorator & Options (AC: 1)
  - [x] Create `backend/src/auth/decorators/rate-limit.decorator.ts`
- [x] Task 3 — Implement RateLimitGuard (AC: 2, 4, 5, 6, 7)
  - [x] Create `backend/src/auth/guards/rate-limit.guard.ts`
  - [x] Implement IP proxy parsing and fail-open store error handling
  - [x] Implement sliding window ZSET script with Retry-After calculation
- [x] Task 4 — Apply RateLimitGuard to AuthController (AC: 3)
  - [x] Annotate `AuthController` class with `@UseGuards(RateLimitGuard)`
- [x] Task 5 — Add Unit Tests (AC: 8)
  - [x] Create `backend/src/auth/guards/rate-limit.guard.spec.ts`
  - [x] Implement test scenarios for thresholds, errors, and headers
- [x] Task 6 — Typecheck, Lint, and Test (AC: 9)
  - [x] Run `npm run typecheck --workspace=backend`
  - [x] Run `npm run lint --workspace=backend`
  - [x] Run `npm test --workspace=backend`

## Dev Notes

### Default Policy
Verdura authentication rate limit policy:
* Limit: 10 attempts
* Window: 15 minutes (900 seconds)
* Key: `rate-limit:<ip>:<method>:<path>`

### References

- Epics: [Source: docs/epics.md#E2] — E2-S5
- PRD: [Source: docs/prd.md#FR-7.3] — rate limiting
- Architecture: [Source: docs/architecture.md#L460-L466] — rate-limited public APIs

## Dev Agent Record

### Agent Model Used

Antigravity

### Debug Log References

None

### Completion Notes List

- Created a global `RedisModule` exposing `REDIS_CLIENT` provider for sharing `ioredis` instances.
- Implemented `@RateLimit()` custom decorator supporting custom thresholds.
- Created `RateLimitGuard` using Redis pipeline sorted sets (ZSET) to implement robust sliding window rate limiting.
- Handled `X-Forwarded-For` header proxy parsing, lockout duration `Retry-After` header calculation, and database store failure fail-open design.
- Applied the guard at class level to `AuthController` to protect all auth routes.
- Added unit tests for `RateLimitGuard` covering successes, lockouts, fail-open scenarios, proxy header extraction, and default configuration fallback.
- Fixed `AuthController` unit tests by mocking `RateLimitGuard` with `.overrideGuard()`.

### File List

- [api/src/redis/redis.module.ts](file:///home/cyrus/Documents/verdura/api/src/redis/redis.module.ts) (NEW)
- [api/src/auth/decorators/rate-limit.decorator.ts](file:///home/cyrus/Documents/verdura/api/src/auth/decorators/rate-limit.decorator.ts) (NEW)
- [api/src/auth/guards/rate-limit.guard.ts](file:///home/cyrus/Documents/verdura/api/src/auth/guards/rate-limit.guard.ts) (NEW)
- [api/src/auth/guards/rate-limit.guard.spec.ts](file:///home/cyrus/Documents/verdura/api/src/auth/guards/rate-limit.guard.spec.ts) (NEW)
- [api/src/auth/auth.module.ts](file:///home/cyrus/Documents/verdura/api/src/auth/auth.module.ts) (MODIFIED)
- [api/src/auth/auth.controller.ts](file:///home/cyrus/Documents/verdura/api/src/auth/auth.controller.ts) (MODIFIED)
- [api/src/auth/auth.controller.spec.ts](file:///home/cyrus/Documents/verdura/api/src/auth/auth.controller.spec.ts) (MODIFIED)
- [api/src/app.module.ts](file:///home/cyrus/Documents/verdura/api/src/app.module.ts) (MODIFIED)

### Review Findings

- [x] [Review][Decision] XFF leftmost IP trusted in production without proxy validation — `getClientIp()` uses `xForwardedFor.split(',')[0]` with no proxy allowlist or CIDR check; any client can send `X-Forwarded-For: 1.2.3.4` to rotate IPs and bypass rate limiting. Fix requires deployment decision: (A) use Express `trust proxy` + rely on `request.ip`, (B) validate XFF against a known proxy CIDR allowlist, or (C) trust rightmost non-internal IP. [api/src/auth/guards/rate-limit.guard.ts:143]
- [x] [Review][Patch] `ZREMRANGEBYSCORE` lower bound should be `'-inf'` not `0` — a score below 0 (clock skew, test injection) is never pruned; canonical pattern is `-inf` [api/src/auth/guards/rate-limit.guard.ts:26]
- [x] [Review][Patch] Redis module has no error event listener — unhandled `error` events from ioredis crash Node.js process [api/src/redis/redis.module.ts:19]
- [x] [Review][Patch] `onApplicationShutdown` does not catch `redis.quit()` rejection — use `.quit().catch(() => this.redis.disconnect())` [api/src/redis/redis.module.ts:30]
- [x] [Review][Patch] `getRequest` undefined path throws 400 with plain string body, not structured `{ statusCode, message, error }` [api/src/auth/guards/rate-limit.guard.ts:75]
- [x] [Review][Patch] Missing unit tests: XFF array form of header, `result.length < 2` fail-open path, `socket` null/undefined fallback, `oldestTime === 0` Retry-After default branch [api/src/auth/guards/rate-limit.guard.spec.ts]
- [x] [Review][Defer] `routeId` uses `request.path` not route template — affects future parameterized routes [api/src/auth/guards/rate-limit.guard.ts:80] — deferred, pre-existing
- [x] [Review][Defer] Redis Cluster atomicity not guaranteed — Lua script is safe on standalone Redis only; undocumented single-node assumption [api/src/auth/guards/rate-limit.guard.ts] — deferred, pre-existing
- [x] [Review][Defer] IP-extraction failures (null socket, closed connection) collapse into shared `127.0.0.1` rate-limit bucket [api/src/auth/guards/rate-limit.guard.ts:154] — deferred, pre-existing
- [x] [Review][Defer] IPv6/dual-stack creates two distinct rate-limit buckets for the same physical client (`::ffff:203.0.113.1` vs `203.0.113.1`) [api/src/auth/guards/rate-limit.guard.ts:81] — deferred, pre-existing
- [x] [Review][Defer] Fail-open on Redis error disables rate limiting entirely — explicit design trade-off required by AC 6; address with Redis HA or circuit-breaker if risk changes [api/src/auth/guards/rate-limit.guard.ts] — deferred, pre-existing
