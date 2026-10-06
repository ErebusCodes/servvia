import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { AuthenticatedUser, JwtPayload } from '../interfaces/jwt-payload.interface';
import { StaffSessionVerifier } from '../staff-session-verifier.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    config: ConfigService,
    private readonly staffSessions: StaffSessionVerifier,
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
    // Story 2.5: a deactivated staff member or a revoked session is refused
    // (401); a check that cannot be made fails closed (500), never access.
    await this.staffSessions.assertLive(payload);
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
}
