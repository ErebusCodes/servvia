import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { UnauthorizedException } from '@nestjs/common';
import { Staff, StaffRole } from '@prisma/client';
import { JwtStrategy } from './jwt.strategy';
import { StaffService } from '../../staff/staff.service';
import { StaffSessionService } from '../staff-session.service';
import { JwtPayload } from '../interfaces/jwt-payload.interface';
import { StaffSessionVerifier } from '../staff-session-verifier.service';

const mockConfigService = {
  getOrThrow: jest.fn().mockReturnValue('test-access-secret'),
};

const activeStaff = { id: 'staff-uuid', isActive: true, role: StaffRole.owner } as Staff;

const mockStaffService = {
  findById: jest.fn(),
};

const mockSessions = {
  isLive: jest.fn(),
};

const ENDED = new UnauthorizedException('Session expired or account deactivated');

describe('JwtStrategy', () => {
  let strategy: JwtStrategy;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockConfigService.getOrThrow.mockReturnValue('test-access-secret');
    mockStaffService.findById.mockResolvedValue(activeStaff);
    mockSessions.isLive.mockResolvedValue(true);
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        JwtStrategy,
        StaffSessionVerifier,
        { provide: ConfigService, useValue: mockConfigService },
        { provide: StaffService, useValue: mockStaffService },
        { provide: StaffSessionService, useValue: mockSessions },
      ],
    }).compile();
    strategy = module.get<JwtStrategy>(JwtStrategy);
  });

  const staffPayload: JwtPayload = {
    sub: 'staff-uuid',
    email: 'owner@verdura.co.nz',
    role: StaffRole.owner,
    organizationId: 'org-uuid',
    sid: 'session-uuid',
  };

  const tabletStaffPayload: JwtPayload = {
    ...staffPayload,
    sid: undefined,
    role: StaffRole.cashier,
    venueId: 'venue-1',
    kind: 'tablet_staff',
    deviceId: 'device-1',
  };

  it('maps a valid staff payload to {id, email, role, organizationId, sessionId}', async () => {
    const result = await strategy.validate(staffPayload);
    expect(result).toEqual({
      id: 'staff-uuid',
      email: 'owner@verdura.co.nz',
      role: StaffRole.owner,
      organizationId: 'org-uuid',
      venueId: undefined,
      kind: undefined,
      sessionId: 'session-uuid',
    });
    expect(mockStaffService.findById).toHaveBeenCalledWith('staff-uuid');
    expect(mockSessions.isLive).toHaveBeenCalledWith('session-uuid', 'staff-uuid');
  });

  it('passes through venueId/kind for a KDS device payload without any staff check', async () => {
    const result = await strategy.validate({
      ...staffPayload,
      sid: undefined,
      sub: 'kds-device:venue-1',
      role: StaffRole.kitchen,
      venueId: 'venue-1',
      kind: 'kds_device',
    });
    expect(result).toMatchObject({ venueId: 'venue-1', kind: 'kds_device' });
    expect(mockStaffService.findById).not.toHaveBeenCalled();
    expect(mockSessions.isLive).not.toHaveBeenCalled();
  });

  it('does not re-check an unelevated tablet device as staff', async () => {
    await strategy.validate({
      ...tabletStaffPayload,
      sub: 'tablet-device:device-1',
      role: StaffRole.viewer,
      kind: 'tablet_device',
    });
    expect(mockStaffService.findById).not.toHaveBeenCalled();
  });

  describe('Story 2.5: deactivation, logout and lookup failure', () => {
    it('refuses a staff session whose staff member is deactivated', async () => {
      mockStaffService.findById.mockResolvedValue({ ...activeStaff, isActive: false });
      await expect(strategy.validate(staffPayload)).rejects.toThrow(ENDED);
    });

    it('refuses a staff session whose staff member is deleted or unknown', async () => {
      mockStaffService.findById.mockResolvedValue(null);
      await expect(strategy.validate(staffPayload)).rejects.toThrow(ENDED);
    });

    it('refuses an elevated tablet token whose staff member is deactivated', async () => {
      mockStaffService.findById.mockResolvedValue({ ...activeStaff, isActive: false });
      await expect(strategy.validate(tabletStaffPayload)).rejects.toThrow(ENDED);
      expect(mockSessions.isLive).not.toHaveBeenCalled();
    });

    it('admits an elevated tablet token of an active staff member', async () => {
      mockStaffService.findById.mockResolvedValue({ ...activeStaff, role: StaffRole.cashier });
      await expect(strategy.validate(tabletStaffPayload)).resolves.toMatchObject({
        kind: 'tablet_staff',
      });
    });

    it('refuses a token minted before the staff member’s role changed (Story 2.8)', async () => {
      mockStaffService.findById.mockResolvedValue({ ...activeStaff, role: StaffRole.manager });
      await expect(strategy.validate(staffPayload)).rejects.toThrow(ENDED);
    });

    it('refuses a logged-out, revoked or expired session (no live session row)', async () => {
      mockSessions.isLive.mockResolvedValue(false);
      await expect(strategy.validate(staffPayload)).rejects.toThrow(ENDED);
    });

    it('refuses a staff session without a session id (cannot be revoked)', async () => {
      await expect(strategy.validate({ ...staffPayload, sid: undefined })).rejects.toThrow(ENDED);
      await expect(
        strategy.validate({ ...staffPayload, sid: undefined, kind: 'staff' }),
      ).rejects.toThrow(ENDED);
    });

    it('fails closed (not 401, not access) when the revocation cannot be checked', async () => {
      mockSessions.isLive.mockRejectedValue(new Error('connection refused'));
      const result = strategy.validate(staffPayload);
      await expect(result).rejects.toThrow('Staff session check failed');
      await expect(result).rejects.not.toBeInstanceOf(UnauthorizedException);
    });

    it('fails closed when the staff member cannot be looked up', async () => {
      mockStaffService.findById.mockRejectedValue(new Error('connection refused'));
      await expect(strategy.validate(staffPayload)).rejects.toThrow('Staff session check failed');
    });
  });

  it('throws UnauthorizedException when sub is missing', async () => {
    await expect(
      strategy.validate({ ...staffPayload, sub: undefined as unknown as string }),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('throws UnauthorizedException when role is missing', async () => {
    await expect(
      strategy.validate({ ...staffPayload, role: undefined as unknown as StaffRole }),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('throws UnauthorizedException when organizationId is missing (rejects legacy pre-fix tokens)', async () => {
    const legacyPayload = { ...staffPayload };
    delete (legacyPayload as { organizationId?: string }).organizationId;
    await expect(strategy.validate(legacyPayload)).rejects.toThrow(UnauthorizedException);
  });

  it('does not treat a hard-coded magic string as a valid payload', async () => {
    // Nothing resembling the old "Bearer kiosk-kds-bypass-token" shortcut
    // exists in this strategy — validate() only ever receives an
    // HS256-verified payload from passport-jwt, and any payload missing
    // the required claims is rejected regardless of its content.
    await expect(
      strategy.validate({ sub: 'kiosk-kds-bypass-token' } as unknown as JwtPayload),
    ).rejects.toThrow(UnauthorizedException);
  });
});
