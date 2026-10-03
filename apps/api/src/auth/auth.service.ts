import { Injectable, OnModuleInit, UnauthorizedException, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as argon2 from 'argon2';
import { Staff, StaffRole } from '@prisma/client';
import { Response } from 'express';
import { randomUUID } from 'node:crypto';
import ms from 'ms';
import { JwtPayload } from './interfaces/jwt-payload.interface';
import { StaffService } from '../staff/staff.service';
import { AuditLogService } from '../audit/audit.service';
import { safeCompare } from '../common/utils/safe-compare';
import { assertPinNotInsecureDefault } from './utils/insecure-default-pin.util';
import { isProductionRuntime } from '../config/runtime-environment';
import { SessionRevocationService } from './session-revocation.service';
import { isStaffSessionKind } from './staff-session';

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
    private readonly revocations: SessionRevocationService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.dummyHash = await argon2.hash('__dummy__', { type: argon2.argon2id });
  }

  private getCookieOptions() {
    return {
      httpOnly: true,
      secure: isProductionRuntime(this.config.get<string>('NODE_ENV')),
      sameSite: 'strict' as const,
      // Story 2.5: /api/auth, not /api/auth/refresh, so the browser also sends
      // the cookie to POST /api/auth/logout, which revokes its session.
      path: '/api/auth',
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

  /**
   * A new login session ID (Story 2.5). Every access and refresh token of
   * the session carries it as `sid`; logout revokes it.
   */
  newSessionId(): string {
    return randomUUID();
  }

  signAccessToken(staff: Staff, sessionId: string): string {
    const payload: Omit<JwtPayload, 'iat' | 'exp'> = {
      sub: staff.id,
      email: staff.email,
      role: staff.role,
      organizationId: staff.organizationId,
      sid: sessionId,
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

  signRefreshToken(staff: Staff, sessionId: string): string {
    return this.jwt.sign(
      { sub: staff.id, sid: sessionId },
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

  /**
   * Ends a login session (Story 2.5): its `sid` is revoked in Redis for the
   * longest token lifetime of the session, so its refresh and access tokens
   * are refused by Nest and by the Go Core. The session is named by the
   * refresh cookie, or failing that by the caller's staff access token. A
   * revocation that cannot be written fails (500) rather than reporting a
   * logout that did not happen.
   */
  async logout(
    refreshToken: string | undefined,
    accessToken: string | undefined,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<void> {
    const session = this.sessionOf(refreshToken, accessToken);
    if (!session) {
      this.logger.warn('Anonymous logout: no valid refresh or access token provided');
      return;
    }
    const refreshExpiry = this.config.get<string>('JWT_REFRESH_EXPIRY', '7d');
    await this.revocations.revoke(session.sessionId, ms(refreshExpiry as ms.StringValue) / 1000);
    const staff = await this.staffService.findById(session.staffId);
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
      this.logger.warn(`Logout: staff record not found for id: ${session.staffId}`);
    }
  }

  private sessionOf(
    refreshToken: string | undefined,
    accessToken: string | undefined,
  ): { staffId: string; sessionId: string } | null {
    if (refreshToken) {
      try {
        const payload = this.jwt.verify<{ sub: string; sid?: string }>(refreshToken, {
          secret: this.config.getOrThrow<string>('JWT_REFRESH_SECRET'),
          algorithms: ['HS256'],
        });
        if (payload.sub && payload.sid) return { staffId: payload.sub, sessionId: payload.sid };
      } catch (err) {
        this.logger.warn(`Logout: invalid or expired refresh token: ${(err as Error).message}`);
      }
    }
    if (accessToken) {
      try {
        const payload = this.jwt.verify<JwtPayload>(accessToken, {
          secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
          algorithms: ['HS256'],
        });
        if (isStaffSessionKind(payload.kind) && payload.sub && payload.sid) {
          return { staffId: payload.sub, sessionId: payload.sid };
        }
      } catch (err) {
        this.logger.warn(`Logout: invalid or expired access token: ${(err as Error).message}`);
      }
    }
    return null;
  }
}
