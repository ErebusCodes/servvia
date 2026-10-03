import { HttpException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { AuthenticatedUser, JwtPayload } from '../interfaces/jwt-payload.interface';
import { StaffService } from '../../staff/staff.service';
import { SessionRevocationService } from '../session-revocation.service';
import {
  STAFF_SESSION_ENDED_MESSAGE,
  isStaffSessionKind,
  isStaffSubjectKind,
} from '../staff-session';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  private readonly logger = new Logger(JwtStrategy.name);

  constructor(
    config: ConfigService,
    private readonly staffService: StaffService,
    private readonly revocations: SessionRevocationService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('JWT_ACCESS_SECRET'),
      algorithms: ['HS256'],
    });
  }

  async validate(payload: JwtPayload): Promise<AuthenticatedUser> {
    if (!payload.sub || !payload.role || !payload.organizationId) {
      throw new UnauthorizedException('Malformed token payload');
    }
    // Only the signed payload (verified above via HS256 + JWT_ACCESS_SECRET) can reach
    // this point — there is no static/magic-string shortcut into this shape.
    if (isStaffSubjectKind(payload.kind)) {
      await this.assertStaffSessionLive(payload);
    }
    return {
      id: payload.sub,
      email: payload.email,
      role: payload.role,
      organizationId: payload.organizationId,
      venueId: payload.venueId,
      kind: payload.kind,
      deviceId: payload.deviceId,
      actingStaffId: payload.actingStaffId,
      sessionId: payload.sid,
    };
  }

  /**
   * Story 2.5: a valid signature is not enough. The staff member must still
   * be active (not deactivated, not deleted, in an active organization) and
   * a login session must carry a `sid` that logout has not revoked. A check
   * that cannot be made fails closed (500), never grants access.
   */
  private async assertStaffSessionLive(payload: JwtPayload): Promise<void> {
    try {
      if (isStaffSessionKind(payload.kind)) {
        if (!payload.sid || (await this.revocations.isRevoked(payload.sid))) {
          throw new UnauthorizedException(STAFF_SESSION_ENDED_MESSAGE);
        }
      }
      const staff = await this.staffService.findById(payload.sub);
      if (!staff || !staff.isActive) {
        throw new UnauthorizedException(STAFF_SESSION_ENDED_MESSAGE);
      }
    } catch (err) {
      if (err instanceof HttpException) {
        if (err instanceof UnauthorizedException) {
          this.logger.warn(
            `staff_session_refused staff_id=${payload.sub} kind=${payload.kind ?? 'staff_session'} role=${payload.role}`,
          );
        }
        throw err;
      }
      this.logger.error(`Staff session check failed: ${(err as Error).message}`);
      throw new Error('Staff session check failed');
    }
  }
}
