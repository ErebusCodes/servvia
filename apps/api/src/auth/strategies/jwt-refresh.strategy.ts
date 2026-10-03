import { HttpException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { Staff } from '@prisma/client';
import { isUUID } from 'class-validator';
import { StaffService } from '../../staff/staff.service';
import { SessionRevocationService } from '../session-revocation.service';
import { STAFF_SESSION_ENDED_MESSAGE } from '../staff-session';

/** The refreshing staff member and the login session the refresh token belongs to. */
export type StaffWithSession = Staff & { sessionId: string };

@Injectable()
export class JwtRefreshStrategy extends PassportStrategy(Strategy, 'jwt-refresh') {
  private readonly logger = new Logger(JwtRefreshStrategy.name);

  constructor(
    config: ConfigService,
    private readonly staffService: StaffService,
    private readonly revocations: SessionRevocationService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        (req: Request) =>
          (req?.cookies as Record<string, string> | undefined)?.['refresh_token'] ?? null,
      ]),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('JWT_REFRESH_SECRET'),
      algorithms: ['HS256'],
    });
  }

  async validate(payload: { sub: string; sid?: string }): Promise<StaffWithSession> {
    if (!payload?.sub || typeof payload.sub !== 'string') {
      throw new UnauthorizedException(STAFF_SESSION_ENDED_MESSAGE);
    }
    // Validate UUID to prevent unnecessary DB queries or syntax errors
    if (!isUUID(payload.sub)) {
      throw new UnauthorizedException(STAFF_SESSION_ENDED_MESSAGE);
    }
    // Story 2.5: a refresh token without a session ID cannot be revoked (it
    // predates session IDs), and a revoked session cannot be refreshed. A
    // revocation check that cannot be made fails closed (500).
    if (!payload.sid || typeof payload.sid !== 'string') {
      throw new UnauthorizedException(STAFF_SESSION_ENDED_MESSAGE);
    }
    let revoked: boolean;
    try {
      revoked = await this.revocations.isRevoked(payload.sid);
    } catch (err) {
      if (err instanceof HttpException) throw err;
      this.logger.error(`Session revocation check failed: ${(err as Error).message}`);
      throw new Error('Session revocation check failed');
    }
    if (revoked) {
      throw new UnauthorizedException(STAFF_SESSION_ENDED_MESSAGE);
    }
    const staff = await this.staffService.findById(payload.sub);
    if (!staff || !staff.isActive) {
      throw new UnauthorizedException(STAFF_SESSION_ENDED_MESSAGE);
    }
    return { ...staff, sessionId: payload.sid };
  }
}
