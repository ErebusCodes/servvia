import {
  Injectable,
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Inject,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import Redis from 'ioredis';
import { Request, Response } from 'express';
import { RATE_LIMIT_KEY, RateLimitOptions } from '../decorators/rate-limit.decorator';
import { REDIS_CLIENT } from '../../redis/redis.constants';
import { logSecurityEvent } from '../../observability/security-events';

const LUA_LIMIT_SCRIPT = `
  local key = KEYS[1]
  local now = tonumber(ARGV[1])
  local windowMs = tonumber(ARGV[2])
  local limit = tonumber(ARGV[3])
  local uniqueMember = ARGV[4]
  local windowSeconds = tonumber(ARGV[5])

  local oldestTimestamp = now - windowMs
  redis.call('ZREMRANGEBYSCORE', key, '-inf', oldestTimestamp)
  local count = redis.call('ZCARD', key)

  if count < limit then
    redis.call('ZADD', key, now, uniqueMember)
    redis.call('EXPIRE', key, windowSeconds)
    return {0, count + 1}
  else
    local oldestResult = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
    local oldestTime = 0
    if oldestResult and #oldestResult >= 2 then
      oldestTime = tonumber(oldestResult[2])
    end
    return {1, count, oldestTime}
  end
`;

/**
 * Redis is single-threaded, and this deployment shares one Redis with BullMQ
 * (`bull:emails`, `bull:print-jobs`, `bull:pos-sync`). BullMQ's Lua scripts
 * occasionally block the server long enough to exceed the client's 1500 ms
 * `commandTimeout` — the slow log on 2026-09-04 held an entry of 1,501,581 us
 * against that exact 1500 ms budget, plus a 336 ms block six seconds before a
 * connector 503. When that happens this guard fails closed and a perfectly
 * legitimate, authenticated request is rejected with 503.
 *
 * Measured impact before this retry: roughly 0.7% of connector polls (four in
 * fifty minutes at a five-second poll interval). Rare, transient, and
 * self-recovering via the connector's backoff — but it is still a real
 * rejection of a valid request on the order path.
 *
 * ONE bounded retry removes the single-blip case without weakening anything:
 *
 *  - It only ever retries a TIMEOUT/connection fault, never a `429`. A real
 *    rate-limit decision is an `HttpException` and is rethrown untouched.
 *  - If Redis cannot answer twice, the guard still fails closed with 503. The
 *    gate is never opened on error.
 *
 * RETRY IDEMPOTENCY — the exact server-side semantics, since this is the one
 * thing that could silently corrupt the count:
 *
 * The retry re-sends `now` and `uniqueMember` UNCHANGED (they are computed
 * once, outside the loop). Consider the dangerous interleaving: the first
 * `EVAL` commits server-side, the reply is lost, and the retry runs.
 *
 *   1. First EVAL: `ZCARD` = N, N < limit, so `ZADD key <now> <member M>`
 *      adds M. Cardinality N+1. The reply never reaches the client.
 *   2. Retry: `ZREMRANGEBYSCORE key -inf (now - windowMs)` cannot evict M,
 *      because M's score is exactly `now` and `now - windowMs < now` for any
 *      positive window. `ZCARD` therefore returns N+1 — M is counted.
 *   3. `ZADD key <now> <M>` runs again. A ZSET member is unique by value:
 *      re-adding an existing member UPDATES its score rather than inserting a
 *      second element, and the score here is byte-identical. **Cardinality
 *      stays N+1.**
 *
 * So the retry consumes NO additional slot — it is exactly idempotent against
 * the ZSET, not merely "conservative". The earlier claim in this comment that
 * it could "at worst consume a second slot" was wrong, and contradicted the
 * deliberate reuse of `uniqueMember` a few lines below.
 *
 * One real divergence remains and is harmless: step 3 returns `{0, count + 1}`
 * where `count` already included M, so the returned counter over-reports by
 * one. Nothing reads it — the guard uses only `result[0]` (the verdict) and
 * `result[2]` (the oldest score, for `Retry-After`) — so it cannot affect a
 * decision. It is left alone rather than "fixed", because changing the script's
 * return shape is a wire change for zero behavioural gain.
 *
 * If instead the first EVAL never reached Redis, the retry is simply the first
 * execution and adds M once. Either way the caller is charged exactly one slot.
 */
const TRANSIENT_RETRY_ATTEMPTS = 1;
const TRANSIENT_RETRY_DELAY_MS = 50;

/**
 * A fault worth one retry: the command never got a verdict from Redis. Matches
 * ioredis's timeout and connection-fault shapes. Anything else — a Lua error,
 * a wrong-type error, a malformed reply — is a real failure and is not
 * retried, because retrying it would just fail identically.
 */
export function isTransientRedisFault(err: unknown): boolean {
  if (err instanceof HttpException) return false;
  const name = err instanceof Error ? err.name : '';
  const message = err instanceof Error ? err.message : String(err);
  return (
    /command timed out/i.test(message) ||
    /connection is closed/i.test(message) ||
    /stream isn'?t writeable/i.test(message) ||
    name === 'MaxRetriesPerRequestError'
  );
}

@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly logger = new Logger(RateLimitGuard.name);

  constructor(
    private readonly reflector: Reflector,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  private async sleep(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') {
      return true;
    }

    const handler = context.getHandler();
    const classContext = context.getClass();

    const metadata = this.reflector.getAllAndOverride<RateLimitOptions>(RATE_LIMIT_KEY, [
      handler,
      classContext,
    ]);

    // Parse and validate options
    const limit = metadata?.limit && metadata.limit > 0 ? metadata.limit : 10;
    const windowSeconds =
      metadata?.windowSeconds && metadata.windowSeconds > 0 ? metadata.windowSeconds : 900;

    const request = context.switchToHttp().getRequest<Request | undefined>();
    if (!request) {
      throw new HttpException(
        { statusCode: HttpStatus.BAD_REQUEST, message: 'Bad Request', error: 'Bad Request' },
        HttpStatus.BAD_REQUEST,
      );
    }

    const ip = request.ip ?? request.socket?.remoteAddress ?? '127.0.0.1';
    const routeId = `${request.method}:${request.path}`;
    const key = `rate-limit:${ip}:${routeId}`;

    const now = Date.now();
    const windowMs = windowSeconds * 1000;
    const uniqueMember = `${now}-${Math.random().toString(36).substring(2, 9)}`;

    try {
      // Execute the Lua script atomically on Redis, retrying ONLY a transient
      // fault where Redis never returned a verdict. See isTransientRedisFault.
      let result: [number, number, number?] | undefined;
      let lastTransient: unknown;

      for (let attempt = 0; attempt <= TRANSIENT_RETRY_ATTEMPTS; attempt++) {
        try {
          result = (await this.redis.eval(
            LUA_LIMIT_SCRIPT,
            1,
            key,
            // Recompute nothing: reusing `now` and `uniqueMember` keeps the
            // retry addressing the same window as the original attempt.
            now.toString(),
            windowMs.toString(),
            limit.toString(),
            uniqueMember,
            windowSeconds.toString(),
          )) as [number, number, number?];
          break;
        } catch (attemptErr) {
          if (!isTransientRedisFault(attemptErr) || attempt === TRANSIENT_RETRY_ATTEMPTS) {
            throw attemptErr;
          }
          lastTransient = attemptErr;
          this.logger.warn(
            `Rate-limit backend timed out (attempt ${attempt + 1}/${TRANSIENT_RETRY_ATTEMPTS + 1}), retrying: ` +
              `${attemptErr instanceof Error ? attemptErr.message : String(attemptErr)}`,
          );
          await this.sleep(TRANSIENT_RETRY_DELAY_MS);
        }
      }

      if (!result) {
        // The retained fault is `unknown` - a driver may reject with a string
        // or an object as easily as with an Error. Rethrowing it raw means an
        // upstream handler reading `err.message` gets `undefined` and logs a
        // rate-limit outage as an empty line, so a non-Error is wrapped with
        // its original value kept as the cause.
        throw asError(lastTransient) ?? new Error('Redis returned no rate-limit response');
      }

      if (result.length < 2) {
        throw new Error('Redis returned an invalid rate-limit response');
      }

      const isRateLimited = result[0] === 1;
      const oldestTime = result[2] ?? 0;

      if (isRateLimited) {
        logSecurityEvent('rate_limit_exceeded', 'request over the per-address limit', {
          route: routeId,
          client_ip: ip,
          limit,
          window_seconds: windowSeconds,
        });
        let retryAfterSeconds = windowSeconds;
        if (oldestTime > 0) {
          const timeToWaitMs = oldestTime + windowMs - now;
          retryAfterSeconds = Math.max(1, Math.ceil(timeToWaitMs / 1000));
        }

        const response = context.switchToHttp().getResponse<Response | undefined>();
        if (response && typeof response.setHeader === 'function') {
          response.setHeader('Retry-After', retryAfterSeconds.toString());
        }

        throw new HttpException(
          {
            statusCode: HttpStatus.TOO_MANY_REQUESTS,
            message: 'Too many requests, please try again later.',
            error: 'Too Many Requests',
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }

      return true;
    } catch (err) {
      if (err instanceof HttpException) {
        throw err;
      }
      logSecurityEvent('rate_limit_unavailable', 'rate limit unavailable, failing closed', {
        route: routeId,
        error: err instanceof Error ? err.message : String(err),
      });
      throw new HttpException(
        {
          statusCode: HttpStatus.SERVICE_UNAVAILABLE,
          message: 'Authentication is temporarily unavailable.',
          error: 'Service Unavailable',
        },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }
}

/**
 * A caught value as something throwable.
 *
 * Returns `undefined` for `undefined`/`null` so a caller can fall back to its
 * own message, and preserves the original value as `cause` rather than
 * flattening it into a string - the raw value is what a support engineer wants
 * when a driver rejects with something odd.
 */
function asError(value: unknown): Error | undefined {
  if (value === undefined || value === null) return undefined;
  if (value instanceof Error) return value;
  // The original value is kept as `cause` by assignment rather than through
  // the two-argument Error constructor, which this build's lib target does not
  // declare. The raw value is what a support engineer wants when a driver
  // rejects with something odd, so it is preserved rather than flattened away.
  const wrapped = new Error(`Rate-limit backend failed: ${describe(value)}`);
  (wrapped as Error & { cause?: unknown }).cause = value;
  return wrapped;
}

/**
 * A caught value as readable text.
 *
 * Objects go through JSON rather than `String()`, which would render them
 * "[object Object]" and tell a support engineer nothing. JSON can itself throw
 * - a circular structure, a BigInt - so the tag is the last resort.
 */
function describe(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return value.toString();
  }
  if (typeof value === 'symbol') return value.toString();
  if (typeof value === 'function') return 'a function';
  try {
    return JSON.stringify(value) ?? Object.prototype.toString.call(value);
  } catch {
    return Object.prototype.toString.call(value);
  }
}
