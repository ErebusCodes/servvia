import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { UnauthorizedException } from '@nestjs/common';
import { Response } from 'express';
import { AuthService } from './auth.service';
import { StaffService } from '../staff/staff.service';
import { AuditLogService } from '../audit/audit.service';
import { SessionRevocationService } from './session-revocation.service';
import { StaffRole, Staff } from '@prisma/client';

const mockJwtService = {
  sign: jest.fn(),
  verify: jest.fn(),
};

const mockConfigService = {
  getOrThrow: jest.fn((key: string) => `test-${key}`),
  get: jest.fn((key: string, def: string) => def),
};

const mockStaffService = {
  findByEmail: jest.fn(),
  findById: jest.fn(),
  verifyPassword: jest.fn(),
};

const mockAuditLogService = {
  logAuthEvent: jest.fn(),
};

const mockRevocations = {
  revoke: jest.fn(),
  isRevoked: jest.fn(),
};

const fakeStaff: Staff = {
  id: 'staff-uuid',
  organizationId: 'org-uuid',
  email: 'owner@verdura.co.nz',
  name: 'Owner',
  passwordHash: 'hash',
  role: StaffRole.owner,
  isActive: true,
  totpSecret: null,
  isTotpEnabled: false,
  lastLoginAt: null,
  lastLoginIp: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  pinHash: null,
  pinSetAt: null,
  deletedAt: null,
};

describe('AuthService', () => {
  let service: AuthService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockJwtService.sign.mockReturnValue('signed-token');
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: JwtService, useValue: mockJwtService },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: StaffService, useValue: mockStaffService },
        { provide: AuditLogService, useValue: mockAuditLogService },
        { provide: SessionRevocationService, useValue: mockRevocations },
      ],
    }).compile();
    service = module.get<AuthService>(AuthService);
  });

  it('signAccessToken calls JwtService.sign with sub, email, role, organizationId, sid', () => {
    service.signAccessToken(fakeStaff, 'session-uuid');
    expect(mockJwtService.sign).toHaveBeenCalledWith(
      {
        sub: fakeStaff.id,
        email: fakeStaff.email,
        role: fakeStaff.role,
        organizationId: fakeStaff.organizationId,
        sid: 'session-uuid',
      },
      expect.any(Object),
    );
  });

  it('signAccessToken returns the signed token string', () => {
    const result = service.signAccessToken(fakeStaff, 'session-uuid');
    expect(typeof result).toBe('string');
    expect(result).toBe('signed-token');
  });

  it('signKdsDeviceToken signs a venue-scoped kitchen-role payload, not a staff identity', () => {
    service.signKdsDeviceToken('venue-uuid', 'org-uuid');
    expect(mockJwtService.sign).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: 'org-uuid',
        venueId: 'venue-uuid',
        role: StaffRole.kitchen,
        kind: 'kds_device',
      }),
      expect.any(Object),
    );
    const [signedPayload] = mockJwtService.sign.mock.calls[0] as [Record<string, unknown>];
    expect(signedPayload.sub).not.toBe(fakeStaff.id);
  });

  it('signKdsDeviceToken uses KDS_TOKEN_EXPIRY, not the staff access-token expiry', () => {
    service.signKdsDeviceToken('venue-uuid', 'org-uuid');
    expect(mockJwtService.sign).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ expiresIn: '12h' }),
    );
  });

  it('verifyAccessToken returns the decoded payload for a valid token', () => {
    const payload = { sub: 'staff-uuid', organizationId: 'org-uuid', role: StaffRole.owner };
    mockJwtService.verify.mockReturnValue(payload);
    expect(service.verifyAccessToken('some-token')).toEqual(payload);
  });

  it('verifyAccessToken throws UnauthorizedException for an invalid/expired token', () => {
    mockJwtService.verify.mockImplementation(() => {
      throw new Error('jwt expired');
    });
    expect(() => service.verifyAccessToken('bad-token')).toThrow(UnauthorizedException);
  });

  it('signRefreshToken calls JwtService.sign with sub and the session id only', () => {
    service.signRefreshToken(fakeStaff, 'session-uuid');
    expect(mockJwtService.sign).toHaveBeenCalledWith(
      { sub: fakeStaff.id, sid: 'session-uuid' },
      expect.any(Object),
    );
  });

  it('newSessionId returns a fresh UUID each time', () => {
    const a = service.newSessionId();
    expect(a).toMatch(/^[0-9a-f-]{36}$/);
    expect(service.newSessionId()).not.toBe(a);
  });

  it('setRefreshCookie sets httpOnly cookie', () => {
    const cookieFn = jest.fn();
    const mockRes = { cookie: cookieFn } as unknown as Response;
    service.setRefreshCookie(mockRes, 'refresh-token-value');
    expect(cookieFn).toHaveBeenCalledWith(
      'refresh_token',
      'refresh-token-value',
      expect.objectContaining({ httpOnly: true }),
    );
  });

  it('setRefreshCookie uses sameSite strict', () => {
    const cookieFn = jest.fn();
    const mockRes = { cookie: cookieFn } as unknown as Response;
    service.setRefreshCookie(mockRes, 'refresh-token-value');
    expect(cookieFn).toHaveBeenCalledWith(
      'refresh_token',
      'refresh-token-value',
      expect.objectContaining({ sameSite: 'strict' }),
    );
  });

  it('setRefreshCookie scopes cookie to /api/auth, so logout receives it', () => {
    const cookieFn = jest.fn();
    const mockRes = { cookie: cookieFn } as unknown as Response;
    service.setRefreshCookie(mockRes, 'refresh-token-value');
    expect(cookieFn).toHaveBeenCalledWith(
      'refresh_token',
      'refresh-token-value',
      expect.objectContaining({ path: '/api/auth' }),
    );
  });

  it('setRefreshCookie sets secure:true when NODE_ENV is production', () => {
    mockConfigService.get.mockImplementation((key: string, def: string): string => {
      if (key === 'NODE_ENV') return 'production';
      return def;
    });
    const cookieFn = jest.fn();
    const mockRes = { cookie: cookieFn } as unknown as Response;
    service.setRefreshCookie(mockRes, 'refresh-token-value');
    expect(cookieFn).toHaveBeenCalledWith(
      'refresh_token',
      'refresh-token-value',
      expect.objectContaining({ secure: true }),
    );
  });

  it('setRefreshCookie derives maxAge from JWT_REFRESH_EXPIRY', () => {
    mockConfigService.get.mockImplementation((key: string, def: string): string => {
      if (key === 'JWT_REFRESH_EXPIRY') return '7d';
      return def;
    });
    const cookieFn = jest.fn();
    const mockRes = { cookie: cookieFn } as unknown as Response;
    service.setRefreshCookie(mockRes, 'refresh-token-value');
    expect(cookieFn).toHaveBeenCalledWith(
      'refresh_token',
      'refresh-token-value',
      expect.objectContaining({ maxAge: 7 * 24 * 60 * 60 * 1000 }),
    );
  });

  it('clearRefreshCookie calls res.clearCookie scoped to /api/auth', () => {
    const clearCookieFn = jest.fn();
    const mockRes = { clearCookie: clearCookieFn } as unknown as Response;
    service.clearRefreshCookie(mockRes);
    expect(clearCookieFn).toHaveBeenCalledWith(
      'refresh_token',
      expect.objectContaining({ path: '/api/auth' }),
    );
  });

  describe('validateLogin', () => {
    it('returns staff on valid credentials', async () => {
      mockStaffService.findByEmail.mockResolvedValue(fakeStaff);
      mockStaffService.verifyPassword.mockResolvedValue(true);
      const result = await service.validateLogin('owner@verdura.co.nz', 'correct');
      expect(result).toBe(fakeStaff);
    });

    it('throws UnauthorizedException when email is not found', async () => {
      mockStaffService.findByEmail.mockResolvedValue(null);
      mockStaffService.verifyPassword.mockResolvedValue(false);
      await expect(service.validateLogin('nobody@verdura.co.nz', 'any')).rejects.toThrow(
        UnauthorizedException,
      );
      expect(mockStaffService.verifyPassword).toHaveBeenCalled();
    });

    it('throws UnauthorizedException when password is wrong', async () => {
      mockStaffService.findByEmail.mockResolvedValue(fakeStaff);
      mockStaffService.verifyPassword.mockResolvedValue(false);
      await expect(service.validateLogin('owner@verdura.co.nz', 'wrong')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('throws UnauthorizedException when staff is inactive', async () => {
      mockStaffService.findByEmail.mockResolvedValue({ ...fakeStaff, isActive: false });
      mockStaffService.verifyPassword.mockResolvedValue(true);
      await expect(service.validateLogin('owner@verdura.co.nz', 'correct')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('uses the same error message for all failure modes', async () => {
      mockStaffService.findByEmail.mockResolvedValue(null);
      mockStaffService.verifyPassword.mockResolvedValue(false);
      await expect(service.validateLogin('nobody@verdura.co.nz', 'any')).rejects.toThrow(
        new UnauthorizedException('Invalid credentials'),
      );
    });
  });

  describe('validateAdminPin', () => {
    beforeEach(() => {
      mockConfigService.get.mockImplementation((key: string, def: string): string => {
        if (key === 'ADMIN_CONSOLE_PIN') return '108';
        if (key === 'ADMIN_CONSOLE_EMAIL') return 'owner@verdura.co.nz';
        return def;
      });
    });

    it('returns the configured active owner for PIN 108 and audits the login', async () => {
      mockStaffService.findByEmail.mockResolvedValue(fakeStaff);

      await expect(service.validateAdminPin('108', '1.2.3.4', 'Mozilla')).resolves.toBe(fakeStaff);
      expect(mockStaffService.findByEmail).toHaveBeenCalledWith('owner@verdura.co.nz');
      expect(mockAuditLogService.logAuthEvent).toHaveBeenCalledWith(
        expect.objectContaining({ actorId: fakeStaff.id, action: 'login', resource: 'auth' }),
      );
    });

    it('rejects an incorrect PIN before looking up an account', async () => {
      await expect(service.validateAdminPin('999')).rejects.toThrow(
        new UnauthorizedException('Invalid PIN'),
      );
      expect(mockStaffService.findByEmail).not.toHaveBeenCalled();
    });

    it('fails closed when PIN login is not configured', async () => {
      mockConfigService.get.mockImplementation((_key: string, def: string): string => def);
      await expect(service.validateAdminPin('108')).rejects.toThrow(UnauthorizedException);
    });

    it('rejects a configured non-admin account', async () => {
      mockStaffService.findByEmail.mockResolvedValue({ ...fakeStaff, role: StaffRole.cashier });
      await expect(service.validateAdminPin('108')).rejects.toThrow(UnauthorizedException);
    });

    it('fails closed in production when the configured PIN is still the insecure checked-in default ("108")', async () => {
      const previousEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      try {
        await expect(service.validateAdminPin('108')).rejects.toThrow();
        expect(mockStaffService.findByEmail).not.toHaveBeenCalled();
      } finally {
        process.env.NODE_ENV = previousEnv;
      }
    });
  });

  describe('auditing', () => {
    it('validateLogin logs failure to DB when staff exists but password wrong', async () => {
      mockStaffService.findByEmail.mockResolvedValue(fakeStaff);
      mockStaffService.verifyPassword.mockResolvedValue(false);
      await expect(
        service.validateLogin('owner@verdura.co.nz', 'wrong', '1.2.3.4', 'Mozilla'),
      ).rejects.toThrow(UnauthorizedException);
      expect(mockAuditLogService.logAuthEvent).toHaveBeenCalledWith({
        organizationId: fakeStaff.organizationId,
        actorId: fakeStaff.id,
        actorEmail: fakeStaff.email,
        actorRole: fakeStaff.role,
        action: 'login_failed',
        resource: 'auth',
        ipAddress: '1.2.3.4',
        userAgent: 'Mozilla',
      });
    });

    it('validateLogin logs warning to console (not DB) when email not found', async () => {
      mockStaffService.findByEmail.mockResolvedValue(null);
      mockStaffService.verifyPassword.mockResolvedValue(false);
      await expect(
        service.validateLogin('nobody@verdura.co.nz', 'any', '1.2.3.4', 'Mozilla'),
      ).rejects.toThrow(UnauthorizedException);
      expect(mockAuditLogService.logAuthEvent).not.toHaveBeenCalled();
    });

    it('logLoginSuccess creates audit log record', async () => {
      await service.logLoginSuccess(fakeStaff, '1.2.3.4', 'Mozilla');
      expect(mockAuditLogService.logAuthEvent).toHaveBeenCalledWith({
        organizationId: fakeStaff.organizationId,
        actorId: fakeStaff.id,
        actorEmail: fakeStaff.email,
        actorRole: fakeStaff.role,
        action: 'login',
        resource: 'auth',
        ipAddress: '1.2.3.4',
        userAgent: 'Mozilla',
      });
    });

    it('logout creates audit log record when token is valid', async () => {
      mockJwtService.verify.mockReturnValue({ sub: 'staff-uuid', sid: 'session-uuid' });
      mockStaffService.findById.mockResolvedValue(fakeStaff);
      await service.logout('refresh-token-val', undefined, '1.2.3.4', 'Mozilla');
      expect(mockAuditLogService.logAuthEvent).toHaveBeenCalledWith({
        organizationId: fakeStaff.organizationId,
        actorId: fakeStaff.id,
        actorEmail: fakeStaff.email,
        actorRole: fakeStaff.role,
        action: 'logout',
        resource: 'auth',
        ipAddress: '1.2.3.4',
        userAgent: 'Mozilla',
      });
    });

    it('logout logs warning and skips DB write when token invalid', async () => {
      mockJwtService.verify.mockImplementation(() => {
        throw new Error('invalid token');
      });
      await service.logout('invalid-token-val', 'invalid-access-val', '1.2.3.4', 'Mozilla');
      expect(mockAuditLogService.logAuthEvent).not.toHaveBeenCalled();
      expect(mockRevocations.revoke).not.toHaveBeenCalled();
    });

    it('logout revokes the refresh token session for the refresh lifetime (Story 2.5)', async () => {
      mockJwtService.verify.mockReturnValue({ sub: 'staff-uuid', sid: 'session-uuid' });
      mockStaffService.findById.mockResolvedValue(fakeStaff);
      await service.logout('refresh-token-val', undefined);
      expect(mockJwtService.verify).toHaveBeenCalledWith('refresh-token-val', {
        secret: 'test-JWT_REFRESH_SECRET',
        algorithms: ['HS256'],
      });
      expect(mockRevocations.revoke).toHaveBeenCalledWith('session-uuid', 7 * 24 * 60 * 60);
    });

    it('logout falls back to the staff access token when there is no refresh cookie', async () => {
      mockJwtService.verify.mockReturnValue({
        sub: 'staff-uuid',
        role: StaffRole.owner,
        organizationId: 'org-uuid',
        sid: 'session-uuid',
      });
      mockStaffService.findById.mockResolvedValue(fakeStaff);
      await service.logout(undefined, 'access-token-val');
      expect(mockJwtService.verify).toHaveBeenCalledWith('access-token-val', {
        secret: 'test-JWT_ACCESS_SECRET',
        algorithms: ['HS256'],
      });
      expect(mockRevocations.revoke).toHaveBeenCalledWith('session-uuid', 7 * 24 * 60 * 60);
    });

    it('logout does not treat a device token as a staff session', async () => {
      mockJwtService.verify.mockReturnValue({
        sub: 'kds-device:venue-uuid',
        role: StaffRole.kitchen,
        organizationId: 'org-uuid',
        kind: 'kds_device',
        sid: 'session-uuid',
      });
      await service.logout(undefined, 'kds-token-val');
      expect(mockRevocations.revoke).not.toHaveBeenCalled();
    });

    it('logout without a session id (a token from before session ids) revokes nothing', async () => {
      mockJwtService.verify.mockReturnValue({ sub: 'staff-uuid' });
      await service.logout('legacy-refresh-token', undefined);
      expect(mockRevocations.revoke).not.toHaveBeenCalled();
    });

    it('logout fails, without auditing, when the revocation cannot be written', async () => {
      mockJwtService.verify.mockReturnValue({ sub: 'staff-uuid', sid: 'session-uuid' });
      mockRevocations.revoke.mockRejectedValueOnce(new Error('Command timed out'));
      await expect(service.logout('refresh-token-val', undefined)).rejects.toThrow(
        'Command timed out',
      );
      expect(mockAuditLogService.logAuthEvent).not.toHaveBeenCalled();
    });
  });
});
