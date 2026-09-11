/**
 * THE RATE LIMIT ON THE THREE NATIVE ROUND ROUTES, ASSERTED AS METADATA.
 *
 * WHY THIS FILE EXISTS AT ALL. A `@UseGuards` line and a `@RateLimit` line are
 * two independent decorators, and either can be dropped by a refactor without
 * a single behavioural test failing: the guard's absence looks exactly like a
 * generous limit, and the decorator's absence silently falls back to the
 * guard's own default of 10 requests per 900 seconds - which on the READ route
 * would throttle a tablet's status poll to roughly one request a minute and
 * quietly reinstate the bug the readback was built to fix. Neither shows up in
 * a test that only exercises handlers, because the harness calls the
 * controller method directly and no guard runs at all.
 *
 * SO THE ASSERTIONS ARE ON THE DECORATORS THEMSELVES, which is the layer where
 * the mistake actually happens. Nest stores `@UseGuards` under `__guards__` and
 * `@RateLimit` under its own metadata key, both on the handler function.
 *
 * AND THE NUMBERS ARE ASSERTED, not merely their presence. The relationship
 * between them is the load-bearing part - the poll must be allowed an order of
 * magnitude more room than the send, because a venue's tablets share one NAT'd
 * bucket and the poll is how an escalated round reaches a waiter at all.
 */

/*
 * The decorators under test hang on the controller's prototype METHODS, which
 * is exactly the unbound reference this rule warns about - and the only way to
 * read metadata off a handler. Nothing here calls them.
 */
/* eslint-disable @typescript-eslint/unbound-method */

import { StaffRole } from '@prisma/client';

import { NativeRoundsController } from './native-rounds.controller';
import { RateLimitGuard } from '../auth/guards/rate-limit.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { TabletTokenActiveGuard } from '../auth/guards/tablet-token-active.guard';
import { RATE_LIMIT_KEY, type RateLimitOptions } from '../auth/decorators/rate-limit.decorator';
import { ROLES_KEY } from '../auth/decorators/roles.decorator';

type Handler = (...args: never[]) => unknown;

const HANDLERS: Record<string, Handler> = {
  send: NativeRoundsController.prototype.submitRound as Handler,
  read: NativeRoundsController.prototype.listRounds as Handler,
  resolve: NativeRoundsController.prototype.resolveRound as Handler,
};

const guardsOn = (handler: Handler): unknown[] =>
  (Reflect.getMetadata('__guards__', handler) as unknown[] | undefined) ?? [];

const limitOn = (handler: Handler): RateLimitOptions | undefined =>
  Reflect.getMetadata(RATE_LIMIT_KEY, handler) as RateLimitOptions | undefined;

describe('every native round route is rate limited', () => {
  it.each(Object.keys(HANDLERS))('%s carries the guard that enforces it', (name) => {
    // The decorator without the guard is metadata nothing reads.
    expect(guardsOn(HANDLERS[name])).toContain(RateLimitGuard);
  });

  it.each(Object.keys(HANDLERS))('%s declares an explicit limit, never the fallback', (name) => {
    const limit = limitOn(HANDLERS[name]);
    expect(limit).toBeDefined();
    // The guard's own default when the decorator is missing. Asserting the
    // route is not merely "limited" but limited to a number somebody chose.
    expect(limit).not.toEqual({ limit: 10, windowSeconds: 900 });
  });

  it('keeps the authentication and role guards it already had', () => {
    // The rate limiter is an ADDITION. A refactor that replaced the guard list
    // rather than extending it would leave these routes rate limited and open.
    for (const handler of Object.values(HANDLERS)) {
      const guards = guardsOn(handler);
      expect(guards).toContain(JwtAuthGuard);
      expect(guards).toContain(RolesGuard);
      expect(guards).toContain(TabletTokenActiveGuard);
    }
  });

  it('still restricts settling a bill by hand to admin and manager', () => {
    // Asserted beside the limit because both live on the same handler and a
    // decorator-list edit is how one of them gets lost.
    expect(Reflect.getMetadata(ROLES_KEY, HANDLERS.resolve)).toEqual([
      StaffRole.admin,
      StaffRole.manager,
    ]);
  });
});

describe('the poll is not throttled into breaking the tablet status loop', () => {
  /**
   * THE NUMBER THAT MATTERS. The tablet polls every 3 seconds while an order
   * is open - 20 requests a minute per device - and `RateLimitGuard` buckets
   * per client IP per route, so a venue's tablets share ONE bucket. A limit
   * chosen for a single device throttles the sixth tablet on a Friday night,
   * and a tablet that cannot poll goes on showing "waiting for the till" about
   * a round the server gave up on ten minutes ago.
   */
  const POLLS_PER_MINUTE_PER_DEVICE = 20;

  it('leaves room for a venue full of tablets, not just one', () => {
    const read = limitOn(HANDLERS.read)!;
    const devices = read.limit / ((read.windowSeconds / 60) * POLLS_PER_MINUTE_PER_DEVICE);

    // Ten is already more tablets than any venue this ships to has. The
    // assertion is a floor, not a target - raising the limit later is fine,
    // and quietly lowering it under that floor is the regression.
    expect(devices).toBeGreaterThanOrEqual(10);
  });

  it('gives the poll far more room than the send, which is the whole shape of it', () => {
    const read = limitOn(HANDLERS.read)!;
    const send = limitOn(HANDLERS.send)!;
    expect(read.windowSeconds).toBe(send.windowSeconds);
    expect(read.limit).toBeGreaterThan(send.limit * 5);
  });

  it('still bounds a runaway client rather than being effectively unlimited', () => {
    // A limit that can never be reached is a limit that protects nothing.
    for (const name of Object.keys(HANDLERS)) {
      const limit = limitOn(HANDLERS[name])!;
      expect(limit.limit).toBeLessThanOrEqual(1000);
      expect(limit.windowSeconds).toBeGreaterThan(0);
    }
  });

  it('holds the send and the resolve routes to a human pace', () => {
    // Neither is pressed by a machine. A waiter presses Send once per round; a
    // manager settles a round after walking to a till and reading a bill.
    expect(limitOn(HANDLERS.send)!.limit).toBeLessThanOrEqual(120);
    expect(limitOn(HANDLERS.resolve)!.limit).toBeLessThanOrEqual(60);
  });
});
