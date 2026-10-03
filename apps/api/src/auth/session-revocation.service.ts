import { Inject, Injectable } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.constants';

/**
 * Redis key prefix of a revoked staff login session (Story 2.5). Shared with
 * the Go Core (services/core-platform/internal/identity/staffsession.go,
 * RevokedSessionKeyPrefix), which reads the same keys: one logout ends the
 * session in both services.
 */
export const REVOKED_SESSION_KEY_PREFIX = 'auth:revoked-session:';

/**
 * Revocation of staff login sessions. Every access and refresh token of a
 * login session carries the same `sid`; logout revokes it, and every use of
 * a staff-session token checks it. Errors propagate: a caller that cannot
 * check a revocation must fail closed, never treat the session as live.
 */
@Injectable()
export class SessionRevocationService {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  /** Revokes a session for `ttlSeconds`, the longest remaining token lifetime. */
  async revoke(sessionId: string, ttlSeconds: number): Promise<void> {
    await this.redis.set(
      REVOKED_SESSION_KEY_PREFIX + sessionId,
      '1',
      'EX',
      Math.max(1, Math.ceil(ttlSeconds)),
    );
  }

  async isRevoked(sessionId: string): Promise<boolean> {
    return (await this.redis.exists(REVOKED_SESSION_KEY_PREFIX + sessionId)) > 0;
  }
}
