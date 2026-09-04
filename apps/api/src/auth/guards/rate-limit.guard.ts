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
 *  - The Lua script is atomic server-side, so a retry after a client-side
 *    timeout can at worst consume a second slot of the caller's own budget.
 *    That errs toward MORE limiting, never less.
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
        throw lastTransient ?? new Error('Redis returned no rate-limit response');
      }

      if (result.length < 2) {
        throw new Error('Redis returned an invalid rate-limit response');
      }

      const isRateLimited = result[0] === 1;
      const oldestTime = result[2] ?? 0;

      if (isRateLimited) {
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
      this.logger.error(
        `RateLimitGuard error (failing closed): ${err instanceof Error ? err.message : String(err)}`,
      );
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
