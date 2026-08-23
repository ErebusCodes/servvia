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

@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly logger = new Logger(RateLimitGuard.name);

  constructor(
    private readonly reflector: Reflector,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

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
      // Execute the Lua script atomically on Redis
      const result = (await this.redis.eval(
        LUA_LIMIT_SCRIPT,
        1,
        key,
        now.toString(),
        windowMs.toString(),
        limit.toString(),
        uniqueMember,
        windowSeconds.toString(),
      )) as [number, number, number?];

      if (!result || result.length < 2) {
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
