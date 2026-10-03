import { HttpException, Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { Staff } from '@prisma/client';
import { isUUID } from 'class-validator';
import { StaffService } from '../../staff/staff.service';
import { StaffSessionService } from '../staff-session.service';
import { STAFF_SESSION_ENDED_MESSAGE } from '../staff-session';
import { logSecurityEvent } from '../../observability/security-events';

/** The refreshing staff member and the login session the refresh token belongs to. */
export type StaffWithSession = Staff & { sessionId: string };

@Injectable()
export class JwtRefreshStrategy extends PassportStrategy(Strategy, 'jwt-refresh') {
  constructor(
    config: ConfigService,
    private readonly staffService: StaffService,
    private readonly sessions: StaffSessionService,
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
    // Stories 2.5 and 2.8: a refresh token without a session ID cannot be
    // revoked (it predates session IDs), and a session whose row is revoked,
    // expired or missing cannot be refreshed. A check that cannot be made
    // fails closed (500).
    if (!payload.sid || typeof payload.sid !== 'string' || !isUUID(payload.sid)) {
      throw new UnauthorizedException(STAFF_SESSION_ENDED_MESSAGE);
    }
    let live: boolean;
    try {
      live = await this.sessions.isLive(payload.sid, payload.sub);
    } catch (err) {
      if (err instanceof HttpException) throw err;
      logSecurityEvent(
        'staff_session_check_failed',
        'refresh session check failed, failing closed',
        {
          staff_id: payload.sub,
          error: (err as Error).message,
        },
      );
      throw new Error('Session check failed');
    }
    const staff = live ? await this.staffService.findById(payload.sub) : null;
    if (!live || !staff || !staff.isActive) {
      logSecurityEvent(
        'staff_session_refused',
        'refresh refused: session ended or staff inactive',
        {
          staff_id: payload.sub,
          kind: 'refresh',
        },
      );
      throw new UnauthorizedException(STAFF_SESSION_ENDED_MESSAGE);
    }
    return { ...staff, sessionId: payload.sid };
  }
}
