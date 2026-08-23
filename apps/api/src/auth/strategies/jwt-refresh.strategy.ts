import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { Staff } from '@prisma/client';
import { isUUID } from 'class-validator';
import { StaffService } from '../../staff/staff.service';

@Injectable()
export class JwtRefreshStrategy extends PassportStrategy(Strategy, 'jwt-refresh') {
  constructor(
    config: ConfigService,
    private readonly staffService: StaffService,
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

  async validate(payload: { sub: string }): Promise<Staff> {
    if (!payload?.sub || typeof payload.sub !== 'string') {
      throw new UnauthorizedException('Session expired or account deactivated');
    }
    // Validate UUID to prevent unnecessary DB queries or syntax errors
    if (!isUUID(payload.sub)) {
      throw new UnauthorizedException('Session expired or account deactivated');
    }
    const staff = await this.staffService.findById(payload.sub);
    if (!staff || !staff.isActive) {
      throw new UnauthorizedException('Session expired or account deactivated');
    }
    return staff;
  }
}
