import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { Response, Request } from 'express';
import { StaffRole, Staff } from '@prisma/client';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { RateLimitGuard } from './guards/rate-limit.guard';
import { JwtRefreshGuard } from './guards/jwt-refresh.guard';
import { StaffWithSession } from './strategies/jwt-refresh.strategy';

const fakeStaff: Staff = {
  id: 'd866a2e8-460d-4560-bf65-f48bf2b61404',
  organizationId: '99999999-9999-9999-9999-999999999999',
  email: 'owner@verdura.co.nz',
  name: 'Owner',
  passwordHash: '$argon2id$hash',
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

const mockAuthService = {
  validateLogin: jest.fn(),
  validateAdminPin: jest.fn(),
  signAccessToken: jest.fn().mockReturnValue('access-token'),
  signRefreshToken: jest.fn().mockReturnValue('refresh-token'),
  newSessionId: jest.fn().mockReturnValue('session-uuid'),
  setRefreshCookie: jest.fn(),
  clearRefreshCookie: jest.fn(),
  logLoginSuccess: jest.fn(),
  logout: jest.fn(),
};

const mockRes = {
  cookie: jest.fn(),
  clearCookie: jest.fn(),
} as unknown as Response;

describe('AuthController', () => {
  let controller: AuthController;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockAuthService.signAccessToken.mockReturnValue('access-token');
    mockAuthService.signRefreshToken.mockReturnValue('refresh-token');
    mockAuthService.newSessionId.mockReturnValue('session-uuid');
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [{ provide: AuthService, useValue: mockAuthService }],
    })
      .overrideGuard(RateLimitGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(JwtRefreshGuard)
      .useValue({ canActivate: () => true })
      .compile();
    controller = module.get<AuthController>(AuthController);
  });

  describe('login', () => {
    it('returns accessToken and user on valid credentials', async () => {
      mockAuthService.validateLogin.mockResolvedValue(fakeStaff);

      const result = await controller.login(
        { email: 'owner@verdura.co.nz', password: 'correct' },
        mockRes,
      );

      expect(result.accessToken).toBe('access-token');
      expect(result.user).toEqual({
        id: fakeStaff.id,
        email: fakeStaff.email,
        name: fakeStaff.name,
        role: fakeStaff.role,
      });
      expect(mockAuthService.setRefreshCookie).toHaveBeenCalledWith(mockRes, 'refresh-token');
    });

    it('binds the access and refresh tokens to one new login session (Story 2.5)', async () => {
      mockAuthService.validateLogin.mockResolvedValue(fakeStaff);
      await controller.login({ email: 'owner@verdura.co.nz', password: 'correct' }, mockRes);
      expect(mockAuthService.signAccessToken).toHaveBeenCalledWith(fakeStaff, 'session-uuid');
      expect(mockAuthService.signRefreshToken).toHaveBeenCalledWith(fakeStaff, 'session-uuid');
    });

    it('throws UnauthorizedException on non-existent email', async () => {
      mockAuthService.validateLogin.mockRejectedValue(
        new UnauthorizedException('Invalid credentials'),
      );

      await expect(
        controller.login({ email: 'nobody@verdura.co.nz', password: 'any' }, mockRes),
      ).rejects.toThrow(new UnauthorizedException('Invalid credentials'));
    });

    it('throws UnauthorizedException on wrong password', async () => {
      mockAuthService.validateLogin.mockRejectedValue(
        new UnauthorizedException('Invalid credentials'),
      );

      await expect(
        controller.login({ email: 'owner@verdura.co.nz', password: 'wrong' }, mockRes),
      ).rejects.toThrow(new UnauthorizedException('Invalid credentials'));
    });

    it('throws UnauthorizedException on inactive account', async () => {
      mockAuthService.validateLogin.mockRejectedValue(
        new UnauthorizedException('Invalid credentials'),
      );

      await expect(
        controller.login({ email: 'inactive@verdura.co.nz', password: 'correct' }, mockRes),
      ).rejects.toThrow(new UnauthorizedException('Invalid credentials'));
    });
  });

  describe('refresh', () => {
    it('returns a new accessToken in the same session, using req.user from the guard', () => {
      const user = { ...fakeStaff, sessionId: 'session-uuid' };
      const req = { user } as Request & { user: StaffWithSession };
      const result = controller.refresh(req);
      expect(result.accessToken).toBe('access-token');
      expect(mockAuthService.signAccessToken).toHaveBeenCalledWith(user, 'session-uuid');
    });
  });

  describe('admin PIN login', () => {
    it('mints the normal staff session for a valid admin PIN', async () => {
      mockAuthService.validateAdminPin.mockResolvedValue(fakeStaff);

      const result = await controller.loginWithAdminPin({ pin: '108' }, mockRes);

      expect(mockAuthService.validateAdminPin).toHaveBeenCalledWith('108', undefined, undefined);
      expect(mockAuthService.signAccessToken).toHaveBeenCalledWith(fakeStaff, 'session-uuid');
      expect(mockAuthService.signRefreshToken).toHaveBeenCalledWith(fakeStaff, 'session-uuid');
      expect(mockAuthService.setRefreshCookie).toHaveBeenCalledWith(mockRes, 'refresh-token');
      expect(result.user.role).toBe(StaffRole.owner);
    });

    it('does not mint tokens for an invalid PIN', async () => {
      mockAuthService.validateAdminPin.mockRejectedValue(new UnauthorizedException('Invalid PIN'));

      await expect(controller.loginWithAdminPin({ pin: '999' }, mockRes)).rejects.toThrow(
        UnauthorizedException,
      );
      expect(mockAuthService.signAccessToken).not.toHaveBeenCalled();
      expect(mockAuthService.setRefreshCookie).not.toHaveBeenCalled();
    });
  });

  describe('logout', () => {
    it('delegates cookie clearing to authService', async () => {
      const logoutRes = { clearCookie: jest.fn() } as unknown as Response;
      await controller.logout(logoutRes);
      expect(mockAuthService.clearRefreshCookie).toHaveBeenCalledWith(logoutRes);
    });

    it('passes the refresh cookie and the bearer access token to logout', async () => {
      const logoutRes = { clearCookie: jest.fn() } as unknown as Response;
      const req = {
        cookies: { refresh_token: 'refresh-token-val' },
        headers: { authorization: 'Bearer access-token-val', 'user-agent': 'Mozilla' },
        ip: '1.2.3.4',
      } as unknown as Request;
      await controller.logout(logoutRes, req);
      expect(mockAuthService.logout).toHaveBeenCalledWith(
        'refresh-token-val',
        'access-token-val',
        '1.2.3.4',
        'Mozilla',
      );
    });
  });
});
