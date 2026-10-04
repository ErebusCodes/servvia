---
title: 'Story 12.5: Kiosk off in production until fixed'
type: 'bugfix'
created: '2026-10-04'
status: 'done'
baseline_revision: 'a4a4190f8ff27864386485a76405c6a00125a680'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-12-context.md'
warnings: ['oversized']
deferred: []
---

<intent-contract>

## Intent

**Problem:** In production the public kiosk order and payment routes are live. The kiosk client adds 15% to GST-inclusive prices, and `POST /api/kiosk/stripe/create-payment-intent` creates a Stripe PaymentIntent for any amount the caller chooses. Either can reach guests (audit P0-19 and section 4.10; PAY-3, KSK-4). "Kiosk off for the pilot" is already authoritative.

**Approach:** Under production configuration, the three kiosk order and payment mutation entry points answer as if the route does not exist (404). The refusal happens before rate limiting, body validation and any service, database or Stripe work. Development and test behaviour, the kiosk menu and table reads, and the KDS PIN exchange stay exactly as they are.

## Boundaries & Constraints

**Always:**
- The entry points covered are `POST /api/kiosk/orders`, `POST /api/kiosk/stripe/connection-token` and `POST /api/kiosk/stripe/create-payment-intent`.
- "Production" is decided on every request from validated configuration (`ConfigService` `NODE_ENV`). It fails closed: any value other than exactly `development` or `test`, including an unset value, counts as production (`apps/api/src/config/runtime-environment.ts`, Stories 1.5 and 2.3).
- The production response is a plain 404 Not Found, as for a route that does not exist. Its body names no kiosk, Stripe, configuration or environment detail.
- In development and test, the three routes keep their current behaviour, including rate limiting, validation, Stripe calls and status codes.
- These routes are unchanged in production: `GET /api/kiosk/venues/:venueId/tables`, `GET /api/kiosk/venues/:venueId/menu` and `POST /api/kiosk/kds/auth`.
- `contracts/openapi/orders.yaml` documents the production 404 for the three routes.
- The existing CSRF middleware still runs first. A production POST that carries neither a CSRF pair nor a Bearer header keeps its existing 403. The 404 applies to every request that gets past CSRF, as in Story 2.3.

**Never:**
- Do not fix the GST calculation or the Stripe flow. "Fix the kiosk properly" is P2 scope.
- Do not change any client (`apps/window-display`, the admin console or the customer website).
- Do not add a flag or setting that re-enables these routes in production.
- Do not change `CsrfMiddleware`, `RateLimitGuard`, the KDS auth controller or service, `KioskController`, `OrdersService`, the Prisma schema or migrations, or Go Core.
- Do not delete, skip or weaken any existing test.
- Do not answer with 403, 410 or 503, or with a message that reveals that the route was disabled.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| PROD_ORDER | `NODE_ENV=production`; `POST /api/kiosk/orders` with a valid body | 404. The orders service, Prisma and Stripe are never called. | No 201, 400, 409 or 503 |
| PROD_INTENT | production; `POST .../create-payment-intent` with `{amountCents: 5000}` | 404. No PaymentIntent is created. | — |
| PROD_TOKEN | production; `POST .../connection-token` | 404. No connection token is created. | — |
| PROD_BAD_BODY | production; an empty or invalid body on any of the three | 404, not 400 | — |
| PROD_RATE | production; requests beyond the route's rate limit, or the rate-limit store unavailable | 404 every time. The rate-limit store is never consulted. | No 429 or 503 |
| PROD_UNSET_ENV | `NODE_ENV` unset or not `development`/`test` | Same as production | — |
| DEV_TEST | `NODE_ENV` is `development` or `test` | Current behaviour: the rate limit is applied, then validation, then the service. | Unchanged |
| PROD_READS | production; kiosk tables, menu, KDS PIN exchange | Reach their handlers as today | Unchanged |

</intent-contract>

## Code Map

- `apps/api/src/orders/orders.controller.ts:59-79` -- the three kiosk mutation handlers. Each has `@UseGuards(RateLimitGuard)` and `@RateLimit`, and calls `OrdersService.create`, `createConnectionToken` or `createPaymentIntent`. The refusal must come before `RateLimitGuard` (Redis `eval`) and before the global `ValidationPipe` (`main.ts:135`).
- `apps/api/src/orders/orders.service.ts:967-1003` -- the Stripe calls (`requireStripeKey`). This code must not be reached in production. Read-only.
- `apps/api/src/config/runtime-environment.ts` -- `isNonProductionRuntime` and `isProductionRuntime`. Reuse them; do not reimplement.
- `apps/api/src/media/providers/local-media-availability.ts` and `local-media-upload.controller.ts:39-41` -- the precedent (Story 2.3): unavailable outside dev/test means 404 (`new NotFoundException()`), decided per request from `ConfigService`.
- `apps/api/src/common/middleware/csrf.middleware.ts` -- runs before guards for every route. In production, a POST with no CSRF pair and no Bearer header still gets the existing 403. The 404 is observed once a request is past CSRF, as in Story 2.3's verification. Read-only.
- `apps/api/src/auth/guards/rate-limit.guard.ts` -- Redis-backed. Fails closed with 503 when the store is unavailable. Read-only.
- `apps/api/src/kiosk/kiosk.controller.ts`, `apps/api/src/auth/kds-auth.controller.ts` -- protected surfaces. Do not change them.
- `apps/api/src/orders/orders.controller.spec.ts` -- the TestingModule pattern with `RateLimitGuard` and `REDIS_CLIENT` providers.
- `apps/api/test/orders.integration-spec.ts` -- exercises `/api/kiosk/orders` under `NODE_ENV=test`. It must keep passing unchanged.
- `contracts/openapi/orders.yaml:73-276` -- the three kiosk paths.

## Tasks & Acceptance

**Execution:**
- `apps/api/src/orders/` (kiosk handlers and their wiring) -- make the three entry points unavailable under production configuration, ahead of rate limiting, validation and the service. Reuse `runtime-environment.ts`. Any new helper stays inside `apps/api/src`; its name and shape are the implementer's choice. -- This is the story's behaviour.
- `apps/api/src/orders/kiosk-production-availability.spec.ts` (new) -- HTTP-level tests: a Nest testing application with supertest, the real `OrdersController`, `KioskController` and `KdsAuthController`, the real `RateLimitGuard`, mocked `REDIS_CLIENT` `eval`, `OrdersService`, `KdsAuthService` and `PrismaService`, and a `ConfigService` holding `NODE_ENV`. Cover every matrix row. The test titles must contain these strings exactly (the draft objective requires them):
  - "in production, POST /api/kiosk/orders answers 404 before rate limiting and the service"
  - "in production, POST /api/kiosk/stripe/create-payment-intent answers 404 before rate limiting and the service"
  - "in production, POST /api/kiosk/stripe/connection-token answers 404 before rate limiting and the service"
  - "in production, an invalid body still answers 404"
  - "in production, an unavailable rate-limit store does not change the 404"
  - "an unset or unrecognised NODE_ENV is treated as production"
  - "in development and test, the kiosk order and payment routes keep their behaviour"
  - "in production, kiosk menu and table reads and the KDS PIN exchange are unchanged"

  -- This is the proof at the outermost surface.
- `apps/api/src/orders/orders.controller.spec.ts` -- touch this file only if the new production gate's dependencies stop its existing TestingModule from compiling. In that case, add the missing provider (for example `ConfigService` with `NODE_ENV=test`). Change nothing else, and do not remove, skip or weaken any test. -- An approved expectation change.
- `contracts/openapi/orders.yaml` -- add a production 404 response and a note to each of the three paths. -- QB-N/T: documented error contracts.

**Acceptance Criteria:**
- Given production configuration, when a request that gets past CSRF reaches any of the three entry points, then the response is 404, the `OrdersService` method is never called, Redis `eval` is never called, and no Prisma or Stripe call happens.
- Given production configuration, when a kiosk tables read, a kiosk menu read or a KDS PIN exchange is requested, then each reaches its handler as before.
- Given development or test configuration, when the three entry points are requested, then the rate limiter is consulted and the matching `OrdersService` method is called, exactly as on the baseline.
- Given the existing API unit suite, when it runs, then it passes with no test removed or skipped.

## Design Notes

Evidence for 404: Story 2.3 (approved AC "it does not exist (404)", commit `fe3e98b`) set this convention for unauthenticated public routes that are unavailable outside dev/test. `localMediaRoutesAvailable` and two controllers implement it. The kiosk routes are of the same class: public, `security: []`, and CSRF-gated only.

The only counter-example is the older 403 `assertNonProduction` in `payment-observation-fixture-injection.controller.ts` (Story 15-6, pre-BMAD). That route is behind staff authentication and a role check, so it is a different situation: an authenticated admin route, where concealment adds nothing.

## Verification

**Commands:**
- `npm test --workspace=apps/api -- kiosk-production-availability orders.controller kiosk.controller` -- expected: all pass.
- `npm test --workspace=apps/api` -- expected: the full unit suite passes.
- `npm run lint --workspace=apps/api && npm run typecheck --workspace=apps/api` -- expected: exit 0.

## Review Triage Log

### 2026-10-04 — Review pass
- verdicts: 19 findings — high 0, medium 0, low 9, false 10, maybe-false 0
- findings:
  - `low` `reject` (blind-hunter) The production 404 body `{statusCode:404,message:'Not Found'}` differs from Nest's unknown-route 404 (`Cannot POST /api/kiosk/orders`), so the route can be told apart — real, but the intent requires a body that "names no kiosk ... detail", which the router's body would break; the bare `NotFoundException` follows the Story 2.3 precedent the spec names. Excluded by the intent.
  - `low` `patch` (blind-hunter) "Never 400 ... whatever the body" is wrong for malformed JSON: the body parser answers 400 before any guard — verified in a scratch run (malformed JSON gets 400 on the kiosk routes and equally on an unknown `/api/kiosk` path, so it matches a missing route and reaches no service). Patched: the three OpenAPI 404 descriptions now cover well-formed bodies and say a malformed or oversized body is refused by the shared body parser, as for any path.
  - `false` `reject` (blind-hunter) Global guards, interceptors or middleware could run first — `main.ts` and `app.module.ts` register no `APP_GUARD`/`APP_INTERCEPTOR`; the only global middleware is RequestContext, SecurityHeaders and CSRF, and CSRF ordering was confirmed in a scratch run (403 without a CSRF pair or Bearer header, 404 after it, Redis and the service untouched).
  - `low` `patch` (blind-hunter) `x-source` line ranges for the three paths are stale, and the guard references have no range. Patched: the handler, rate-limit and guard `x-source` lines now point at the current lines.
  - `false` `reject` (blind-hunter) Staging loses kiosk — this is intended: the intent says any `NODE_ENV` other than exactly `development` or `test` counts as production.
  - `low` `reject` (blind-hunter) The kiosk client is not given an "unavailable" state — the intent forbids changing any client ("Do not change any client"). Excluded by the intent.
  - `false` `reject` (blind-hunter) The `ConfigService` stub `{ get: () => 'test' }` in `orders.controller.spec.ts` is too broad — no other guard on `OrdersController` (JwtAuth, Roles, TabletTokenActive, VenueAccess, RateLimit) reads `ConfigService`, so nothing else receives `'test'`; the stub is the objective's approved expectation change.
  - `false` `reject` (blind-hunter) The production example breaks `NestError` — `NestError` requires only `statusCode` and `message`; `error` is optional, so both examples are valid.
  - `false` `reject` (blind-hunter) `NODE_ENV` may not be validated and the helper has no unit test — `environment.validation.ts:11` makes `NODE_ENV` required in the Joi schema; the helper is the shared `isNonProductionRuntime`, already covered by its own tests, and the guard is proved over HTTP.
  - `false` `reject` (blind-hunter) The story record is half updated — the workflow finalisation writes the run result and status; the frontmatter state at review time is the expected in-review state.
  - `false` `reject` (blind-hunter) Other entry points reach the same service methods — verification-gap and edge-case layers both searched: no other caller of `create`, `createPaymentIntent` or `createConnectionToken`; other HTTP methods on these paths still get the router's own 404.
  - `low` `reject` (edge-case-hunter) The 404 body differs from a truly missing route — same claim and same reasoning as the first row; excluded by the intent's no-kiosk-detail clause.
  - `low` `patch` (edge-case-hunter) `x-source` points at the wrong lines — same as the stale-range row; patched with it.
  - `low` `patch` (intent-alignment) Body parsing runs before the guard, so malformed or oversized JSON gets 400/413 in production — grouped with the malformed-JSON row; the behaviour equals a missing route and is kept, and the contract wording was patched.
  - `false` `reject` (intent-alignment) CSRF ordering is asserted, not exercised — the CSRF middleware is unchanged and applies to every route before guards; a scratch run through the real `CsrfMiddleware` showed 403 without a CSRF pair or Bearer header and 404 with either, on all three routes.
  - `false` `reject` (intent-alignment) The tests stub `ConfigService` instead of the validated pipeline — the guard reads `ConfigService` per request, `ConfigModule` is global (`app.module.ts`), and `NODE_ENV` is Joi-required; the stub only injects the value under test.
  - `low` `reject` (intent-alignment) The disabled route can be told apart by body shape (reading R3b) — same as the first row; the auditor itself notes R3b conflicts with the intent's body rule.
  - `low` `patch` (intent-alignment) The OpenAPI "never 400" promise is stronger than the code — grouped with the malformed-JSON row; patched.
  - `false` `reject` (intent-alignment) `apps/api/test/orders.integration-spec.ts` could break if its `NODE_ENV` is not development or test — Jest sets `NODE_ENV=test` when it is unset, and `integration-setup.ts` only fills absent keys; any other value would be a production-like environment where the intent requires 404.

## Auto Run Result

Status: ready-for-dev
Blocking condition: waiting-for-objective-approval: draft _bmad-output/implementation-artifacts/objective-drafts/story-12-5-kiosk-off-in-production/v1.objective.json sha256 9c981ca56d0b9b34fd70eecbfc35150157052b7229f92e588b9974dc0f62daa0

This planning run had no objective_anchor, so nothing was implemented or committed. `loop.mjs validate` reported OBJECTIVE READY FOR FREEZE for baseline 00e64adf9bd9c40501a817bf9831225a389c7725. Freezing the objective is the orchestrator's decision.

### Build run 2026-10-04 (objective_anchor a4a4190f8ff27864386485a76405c6a00125a680)

Status: done (candidate produced; acceptance is decided by the evaluator and the orchestrator)

**Summary:** A new `KioskProductionAvailabilityGuard` runs before `RateLimitGuard` on `POST /api/kiosk/orders`, `POST /api/kiosk/stripe/connection-token` and `POST /api/kiosk/stripe/create-payment-intent`. On every request it reads `NODE_ENV` from `ConfigService` through `isNonProductionRuntime`, and anywhere other than exactly development or test it throws a bare `NotFoundException` (404 `{statusCode:404,message:'Not Found'}`). This happens before Redis, the ValidationPipe, `OrdersService`, Prisma and Stripe. Development and test, the kiosk reads and the KDS PIN exchange are unchanged.

**Files changed:**
- `apps/api/src/orders/kiosk-production-availability.guard.ts` (new): the per-request, fail-closed production guard.
- `apps/api/src/orders/orders.controller.ts`: the guard is listed first on the three kiosk mutation routes.
- `apps/api/src/orders/kiosk-production-availability.spec.ts` (new): HTTP-level tests RT-1 to RT-8 covering every matrix row.
- `apps/api/src/orders/orders.controller.spec.ts`: the approved expectation change only (a `ConfigService` provider in both TestingModules).
- `contracts/openapi/orders.yaml`: a production note and a production 404 on the three paths; current `x-source` lines.

**Review findings:** 19 findings (0 high, 0 medium, 9 low, 10 false).
- Patches applied (2 low entries): the OpenAPI wording for malformed or oversized bodies, and stale `x-source` ranges.
- Deferred: none.
- Rejected: the 404 body differing from the router's own 404 (the intent forbids a body that names the kiosk path); no kiosk client change (the intent forbids client changes); and 10 false findings, each with its refutation in the triage log.

**Follow-up review recommended:** false. Patched: high 0, medium 0, low 2.

**Verification:** run in a scratch copy of the tree with the lockfile-exact dependencies and the evaluator's test-only environment.
- Targeted (`kiosk-production-availability orders.controller kiosk.controller`): 4 suites, 37 tests passed.
- Full unit suite: 136 suites, 2120 tests passed, 0 failed, 0 skipped.
- eslint: exit 0. `tsc --noEmit`: exit 0.
- Scratch-only check (not committed) through the real `CsrfMiddleware` in production: no CSRF pair and no Bearer header gives 403; a Bearer header or a CSRF pair gives 404; Redis and the service are untouched.
- Matrix test audit: every row is covered by a test that ran and passed.

**Residual risks:**
- A malformed or oversized JSON body still gets the shared body parser's 400/413, as on any path, including a path that does not exist.
- RT-1 to RT-6 failing on the baseline was reasoned, not observed in this run. The evaluator checks it.
