import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac } from 'crypto';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.constants';
import { logSecurityEvent } from '../observability/security-events';

/** Sign-in attempts allowed per account within the window (Story 2.4, NFR-SEC-2). */
export const LOGIN_ACCOUNT_ATTEMPT_LIMIT = 10;
export const LOGIN_ACCOUNT_WINDOW_SECONDS = 15 * 60;

// Reserves one attempt atomically: the first attempt opens a fixed window,
// and an attempt over the limit is refused without extending it. Concurrent
// attempts therefore cannot overshoot the limit.
const RESERVE_ATTEMPT_SCRIPT = `
  local count = redis.call('INCR', KEYS[1])
  if count == 1 then
    redis.call('EXPIRE', KEYS[1], ARGV[1])
  end
  return count
`;

/**
 * A stable pseudonym for a sign-in email, so neither Redis nor the logs hold
 * the address: an HMAC under the server's access-token secret, separated from
 * every other use of that key, of the normalized email. Without the secret
 * it cannot be reversed by guessing addresses.
 */
export function accountFingerprint(email: string, secret: string): string {
  return createHmac('sha256', secret)
    .update(`login-account:${email.trim().toLowerCase()}`)
    .digest('hex')
    .slice(0, 32);
}

/**
 * Per-account sign-in throttling (Story 2.4), on top of the per-address limit
 * of RateLimitGuard: an attacker spreading guesses across many addresses still
 * gets only LOGIN_ACCOUNT_ATTEMPT_LIMIT tries per account per window.
 *
 * Every email is throttled alike, whether or not an account has it, and the
 * refusal is the same 429 the address limit gives, so the throttle reveals
 * nothing about which accounts exist. A successful sign-in clears the
 * account's count. When Redis cannot answer, sign-in fails closed (503), as
 * RateLimitGuard already does on this route.
 */
@Injectable()
export class LoginThrottleService {
  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly config: ConfigService,
  ) {}

  fingerprint(email: string): string {
    return accountFingerprint(email, this.config.getOrThrow<string>('JWT_ACCESS_SECRET'));
  }

  private key(email: string): string {
    return `login-account:${this.fingerprint(email)}`;
  }

  /** Reserves an attempt for this email, or refuses it (429) when the limit is spent. */
  async reserveAttempt(email: string): Promise<void> {
    let count: number;
    try {
      count = Number(
        await this.redis.eval(
          RESERVE_ATTEMPT_SCRIPT,
          1,
          this.key(email),
          String(LOGIN_ACCOUNT_WINDOW_SECONDS),
        ),
      );
    } catch (err) {
      logSecurityEvent(
        'login_throttle_unavailable',
        'sign-in throttle unavailable, failing closed',
        {
          error: err instanceof Error ? err.message : String(err),
        },
      );
      throw new ServiceUnavailableException('Authentication is temporarily unavailable.');
    }
    if (!Number.isFinite(count)) {
      logSecurityEvent(
        'login_throttle_unavailable',
        'sign-in throttle unavailable, failing closed',
        {
          error: 'invalid reply',
        },
      );
      throw new ServiceUnavailableException('Authentication is temporarily unavailable.');
    }
    if (count > LOGIN_ACCOUNT_ATTEMPT_LIMIT) {
      logSecurityEvent('login_throttled', 'sign-in attempts over the per-account limit', {
        account: this.fingerprint(email),
      });
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          message: 'Too many requests, please try again later.',
          error: 'Too Many Requests',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  /** Clears the account's count after a successful sign-in. */
  async clear(email: string): Promise<void> {
    try {
      await this.redis.del(this.key(email));
    } catch (err) {
      // The sign-in already succeeded; a count left behind only expires later.
      logSecurityEvent('login_throttle_unavailable', 'sign-in throttle count not cleared', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
