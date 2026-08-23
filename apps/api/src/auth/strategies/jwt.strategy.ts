import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { AuthenticatedUser, JwtPayload } from '../interfaces/jwt-payload.interface';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(config: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('JWT_ACCESS_SECRET'),
      algorithms: ['HS256'],
    });
  }

  validate(payload: JwtPayload): AuthenticatedUser {
    // Known tradeoff: no DB lookup here — deactivated staff can use tokens until expiry
    // (max JWT_ACCESS_EXPIRY, default 15 min). If instant revocation is ever needed,
    // add a Redis denylist checked here rather than a DB call on every request.
    if (!payload.sub || !payload.role || !payload.organizationId) {
      throw new UnauthorizedException('Malformed token payload');
    }
    // Only the signed payload (verified above via HS256 + JWT_ACCESS_SECRET) can reach
    // this point — there is no static/magic-string shortcut into this shape.
    return {
      id: payload.sub,
      email: payload.email,
      role: payload.role,
      organizationId: payload.organizationId,
      venueId: payload.venueId,
      kind: payload.kind,
      deviceId: payload.deviceId,
      actingStaffId: payload.actingStaffId,
    };
  }
}
