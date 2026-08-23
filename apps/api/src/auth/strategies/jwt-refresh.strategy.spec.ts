import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { UnauthorizedException } from '@nestjs/common';
import { StaffRole, Staff } from '@prisma/client';
import { JwtRefreshStrategy } from './jwt-refresh.strategy';
import { StaffService } from '../../staff/staff.service';

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

const mockConfigService = {
  getOrThrow: jest.fn().mockReturnValue('test-refresh-secret'),
};

const mockStaffService = {
  findById: jest.fn(),
};

describe('JwtRefreshStrategy', () => {
  let strategy: JwtRefreshStrategy;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        JwtRefreshStrategy,
        { provide: ConfigService, useValue: mockConfigService },
        { provide: StaffService, useValue: mockStaffService },
      ],
    }).compile();
    strategy = module.get<JwtRefreshStrategy>(JwtRefreshStrategy);
  });

  it('validate() returns staff when found and active', async () => {
    mockStaffService.findById.mockResolvedValue(fakeStaff);
    const result = await strategy.validate({ sub: fakeStaff.id });
    expect(result).toBe(fakeStaff);
    expect(mockStaffService.findById).toHaveBeenCalledWith(fakeStaff.id);
  });

  it('validate() throws UnauthorizedException when staff is not found', async () => {
    mockStaffService.findById.mockResolvedValue(null);
    await expect(
      strategy.validate({ sub: 'd866a2e8-460d-4560-bf65-f48bf2b61404' }),
    ).rejects.toThrow(new UnauthorizedException('Session expired or account deactivated'));
  });

  it('validate() throws UnauthorizedException when staff is inactive', async () => {
    mockStaffService.findById.mockResolvedValue({ ...fakeStaff, isActive: false });
    await expect(strategy.validate({ sub: fakeStaff.id })).rejects.toThrow(
      new UnauthorizedException('Session expired or account deactivated'),
    );
  });

  it('validate() throws UnauthorizedException when sub is missing', async () => {
    await expect(strategy.validate({ sub: undefined as unknown as string })).rejects.toThrow(
      new UnauthorizedException('Session expired or account deactivated'),
    );
  });

  it('validate() throws UnauthorizedException when sub is malformed (non-UUID)', async () => {
    await expect(strategy.validate({ sub: 'invalid-uuid-format' })).rejects.toThrow(
      new UnauthorizedException('Session expired or account deactivated'),
    );
  });
});
