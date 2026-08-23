import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { UnauthorizedException } from '@nestjs/common';
import { StaffRole } from '@prisma/client';
import { JwtStrategy } from './jwt.strategy';

const mockConfigService = {
  getOrThrow: jest.fn().mockReturnValue('test-access-secret'),
};

describe('JwtStrategy', () => {
  let strategy: JwtStrategy;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockConfigService.getOrThrow.mockReturnValue('test-access-secret');
    const module: TestingModule = await Test.createTestingModule({
      providers: [JwtStrategy, { provide: ConfigService, useValue: mockConfigService }],
    }).compile();
    strategy = module.get<JwtStrategy>(JwtStrategy);
  });

  const staffPayload = {
    sub: 'staff-uuid',
    email: 'owner@verdura.co.nz',
    role: StaffRole.owner,
    organizationId: 'org-uuid',
  };

  it('maps a valid staff payload to {id, email, role, organizationId}', () => {
    const result = strategy.validate(staffPayload);
    expect(result).toEqual({
      id: 'staff-uuid',
      email: 'owner@verdura.co.nz',
      role: StaffRole.owner,
      organizationId: 'org-uuid',
      venueId: undefined,
      kind: undefined,
    });
  });

  it('passes through venueId/kind for a KDS device payload', () => {
    const result = strategy.validate({
      ...staffPayload,
      sub: 'kds-device:venue-1',
      role: StaffRole.kitchen,
      venueId: 'venue-1',
      kind: 'kds_device',
    });
    expect(result).toMatchObject({ venueId: 'venue-1', kind: 'kds_device' });
  });

  it('throws UnauthorizedException when sub is missing', () => {
    expect(() =>
      strategy.validate({ ...staffPayload, sub: undefined as unknown as string }),
    ).toThrow(UnauthorizedException);
  });

  it('throws UnauthorizedException when role is missing', () => {
    expect(() =>
      strategy.validate({ ...staffPayload, role: undefined as unknown as StaffRole }),
    ).toThrow(UnauthorizedException);
  });

  it('throws UnauthorizedException when organizationId is missing (rejects legacy pre-fix tokens)', () => {
    const legacyPayload = { ...staffPayload };
    delete (legacyPayload as { organizationId?: string }).organizationId;
    expect(() => strategy.validate(legacyPayload)).toThrow(UnauthorizedException);
  });

  it('does not treat a hard-coded magic string as a valid payload', () => {
    // Nothing resembling the old "Bearer kiosk-kds-bypass-token" shortcut
    // exists in this strategy — validate() only ever receives an
    // HS256-verified payload from passport-jwt, and any payload missing
    // the required claims is rejected regardless of its content.
    expect(() =>
      strategy.validate({ sub: 'kiosk-kds-bypass-token' } as unknown as typeof staffPayload),
    ).toThrow(UnauthorizedException);
  });
});
