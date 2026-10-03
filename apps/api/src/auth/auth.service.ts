import { Injectable, OnModuleInit, UnauthorizedException, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as argon2 from 'argon2';
import { Staff, StaffRole } from '@prisma/client';
import { Response } from 'express';
import ms from 'ms';
import { JwtPayload } from './interfaces/jwt-payload.interface';
import { StaffService } from '../staff/staff.service';
import { AuditLogService } from '../audit/audit.service';
import { safeCompare } from '../common/utils/safe-compare';
import { assertPinNotInsecureDefault } from './utils/insecure-default-pin.util';
import { isProductionRuntime } from '../config/runtime-environment';

@Injectable()
export class AuthService implements OnModuleInit {
  private readonly logger = new Logger(AuthService.name);
  // Pre-computed at startup; used in validateLogin to normalize timing when
  // email is not found, preventing user enumeration via response latency.
  private dummyHash!: string;

  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly staffService: StaffService,
    private readonly auditLogService: AuditLogService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.dummyHash = await argon2.hash('__dummy__', { type: argon2.argon2id });
  }

  private getCookieOptions() {
    return {
      httpOnly: true,
      secure: isProductionRuntime(this.config.get<string>('NODE_ENV')),
      sameSite: 'strict' as const,
      path: '/api/auth/refresh',
    };
  }

  async validateLogin(
    email: string,
    password: string,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<Staff> {
    const staff = await this.staffService.findByEmail(email);
    // Always verify against a hash regardless of whether staff was found.
    // This normalises response time and prevents email enumeration via timing.
    const fallbackDummyHash =
      this.dummyHash ??
      '$argon2id$v=19$m=65536,t=3,p=4$ny2DnHXAff2D5lmWycbuTw$LxRCa+qjRHgy6Uj9tsonUQ0Xx+6lH//N/p/0bMoRGmk';
    const hashToVerify = staff?.passwordHash ?? fallbackDummyHash;
    const valid = await this.staffService.verifyPassword(hashToVerify, password);
    if (!valid || !staff || !staff.isActive) {
      if (staff) {
        await this.auditLogService.logAuthEvent({
          organizationId: staff.organizationId,
          actorId: staff.id,
          actorEmail: staff.email,
          actorRole: staff.role,
          action: 'login_failed',
          resource: 'auth',
          ipAddress,
          userAgent,
        });
      } else {
        this.logger.warn(`Anonymous login failure: email: ${email}`);
      }
      throw new UnauthorizedException('Invalid credentials');
    }
    return staff;
  }

  async validateAdminPin(pin: string, ipAddress?: string, userAgent?: string): Promise<Staff> {
    const configuredPin = this.config.get<string>('ADMIN_CONSOLE_PIN');
    const configuredEmail = this.config.get<string>('ADMIN_CONSOLE_EMAIL');

    if (!configuredPin || !configuredEmail) {
      this.logger.warn('Admin console PIN login failed');
      throw new UnauthorizedException('Invalid PIN');
    }

    assertPinNotInsecureDefault(configuredPin, 'ADMIN_CONSOLE_PIN');

    if (!safeCompare(pin, configuredPin)) {
      this.logger.warn('Admin console PIN login failed');
      throw new UnauthorizedException('Invalid PIN');
    }

    const staff = await this.staffService.findByEmail(configuredEmail);
    if (
      !staff ||
      !staff.isActive ||
      (staff.role !== StaffRole.owner && staff.role !== StaffRole.admin)
    ) {
      this.logger.warn('Admin console PIN account is unavailable or lacks an admin role');
      throw new UnauthorizedException('Invalid PIN');
    }

    await this.auditLogService.logAuthEvent({
      organizationId: staff.organizationId,
      actorId: staff.id,
      actorEmail: staff.email,
      actorRole: staff.role,
      action: 'login',
      resource: 'auth',
      ipAddress,
      userAgent,
    });
    return staff;
  }

  signAccessToken(staff: Staff): string {
    const payload: Omit<JwtPayload, 'iat' | 'exp'> = {
      sub: staff.id,
      email: staff.email,
      role: staff.role,
      organizationId: staff.organizationId,
    };
    return this.jwt.sign(payload, {
      secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
      expiresIn: this.config.get('JWT_ACCESS_EXPIRY', '15m'),
    });
  }

  /**
   * Mints a venue-scoped device token for an unattended KDS/kitchen-display
   * terminal. Signed with the same secret/strategy as staff access tokens
   * (so JwtAuthGuard validates it identically), but `kind: 'kds_device'` +
   * `venueId` let downstream handlers restrict it to that single venue —
   * unlike a staff token, it must never grant organization-wide access.
   */
  signKdsDeviceToken(venueId: string, organizationId: string): string {
    const payload: Omit<JwtPayload, 'iat' | 'exp'> = {
      sub: `kds-device:${venueId}`,
      email: `kds-device+${venueId}@verdura.internal`,
      role: StaffRole.kitchen,
      organizationId,
      venueId,
      kind: 'kds_device',
    };
    return this.jwt.sign(payload, {
      secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
      expiresIn: this.config.get('KDS_TOKEN_EXPIRY', '12h'),
    });
  }

  /**
   * Verifies a signed access token (staff or KDS device) outside the HTTP
   * request/Passport pipeline — used by the WebSocket gateway, which has no
   * guard chain of its own, so it must authenticate the handshake itself
   * using the same secret/algorithm as JwtStrategy.
   */
  verifyAccessToken(token: string): JwtPayload {
    try {
      return this.jwt.verify<JwtPayload>(token, {
        secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
  }

  signRefreshToken(staff: Staff): string {
    return this.jwt.sign(
      { sub: staff.id },
      {
        secret: this.config.getOrThrow<string>('JWT_REFRESH_SECRET'),
        expiresIn: this.config.get('JWT_REFRESH_EXPIRY', '7d'),
      },
    );
  }

  setRefreshCookie(res: Response, token: string): void {
    const expiry = this.config.get<string>('JWT_REFRESH_EXPIRY', '7d');
    const maxAge = ms(expiry as ms.StringValue);
    res.cookie('refresh_token', token, {
      ...this.getCookieOptions(),
      maxAge,
    });
  }

  clearRefreshCookie(res: Response): void {
    res.clearCookie('refresh_token', this.getCookieOptions());
  }

  async logLoginSuccess(staff: Staff, ipAddress?: string, userAgent?: string): Promise<void> {
    await this.auditLogService.logAuthEvent({
      organizationId: staff.organizationId,
      actorId: staff.id,
      actorEmail: staff.email,
      actorRole: staff.role,
      action: 'login',
      resource: 'auth',
      ipAddress,
      userAgent,
    });
  }

  async logout(token: string | undefined, ipAddress?: string, userAgent?: string): Promise<void> {
    if (!token) {
      this.logger.warn('Anonymous logout: no refresh token provided');
      return;
    }
    try {
      const payload = this.jwt.verify<{ sub: string }>(token, {
        secret: this.config.getOrThrow<string>('JWT_REFRESH_SECRET'),
      });
      const staffId = payload.sub;
      const staff = await this.staffService.findById(staffId);
      if (staff) {
        await this.auditLogService.logAuthEvent({
          organizationId: staff.organizationId,
          actorId: staff.id,
          actorEmail: staff.email,
          actorRole: staff.role,
          action: 'logout',
          resource: 'auth',
          ipAddress,
          userAgent,
        });
      } else {
        this.logger.warn(`Anonymous logout: staff record not found for id: ${staffId}`);
      }
    } catch (err) {
      this.logger.warn(
        `Anonymous logout: invalid or expired refresh token: ${(err as Error).message}`,
      );
    }
  }
}
