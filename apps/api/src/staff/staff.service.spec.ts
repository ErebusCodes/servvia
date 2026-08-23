import { Test, TestingModule } from '@nestjs/testing';
import * as argon2 from 'argon2';
import { StaffService } from './staff.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService } from '../audit/audit.service';
import { StaffRole, Staff } from '@prisma/client';

/** Isolates the one genuinely-untyped `jest.Mock` access this file needs to
 * a single well-justified spot rather than scattering `as` casts. */
function firstCallArg(mockFn: jest.Mock): Record<string, unknown> {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return
  return mockFn.mock.calls[0][0];
}

const mockPrisma = {
  staff: {
    create: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
  },
};

const mockAuditLogService = {
  logAuthEvent: jest.fn(),
};

describe('StaffService', () => {
  let service: StaffService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StaffService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AuditLogService, useValue: mockAuditLogService },
      ],
    }).compile();
    service = module.get<StaffService>(StaffService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('create() hashes the password before storing', async () => {
    const plainPassword = 'hunter2';
    mockPrisma.staff.create.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
      Promise.resolve({ id: '1', ...data }),
    );
    const result = await service.create({
      organizationId: 'org-1',
      email: 'owner@test.com',
      name: 'Owner',
      password: plainPassword,
      role: StaffRole.owner,
    });
    expect(result.passwordHash).not.toBe(plainPassword);
    expect(await argon2.verify(result.passwordHash, plainPassword)).toBe(true);
  });

  it('create() does not store plaintext password', async () => {
    mockPrisma.staff.create.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
      Promise.resolve({ id: '1', ...data }),
    );
    const result = await service.create({
      organizationId: 'org-1',
      email: 'owner@test.com',
      name: 'Owner',
      password: 'secret',
      role: StaffRole.owner,
    });
    expect(result.passwordHash).not.toBe('secret');
  });

  it('findByEmail() returns staff when found', async () => {
    const fakeStaff = { id: '1', email: 'owner@test.com', organization: { isActive: true } };
    mockPrisma.staff.findFirst.mockResolvedValue(fakeStaff);
    const result = await service.findByEmail('owner@test.com');
    expect(result).toEqual(fakeStaff);
  });

  it('findByEmail() returns null when not found', async () => {
    mockPrisma.staff.findFirst.mockResolvedValue(null);
    const result = await service.findByEmail('nobody@test.com');
    expect(result).toBeNull();
  });

  it('findById() returns staff when found', async () => {
    const fakeStaff = {
      id: 'd866a2e8-460d-4560-bf65-f48bf2b61404',
      email: 'owner@test.com',
      organization: { isActive: true },
    };
    mockPrisma.staff.findFirst.mockResolvedValue(fakeStaff);
    const result = await service.findById('d866a2e8-460d-4560-bf65-f48bf2b61404');
    expect(result).toEqual(fakeStaff);
    expect(mockPrisma.staff.findFirst).toHaveBeenCalledWith({
      where: { id: 'd866a2e8-460d-4560-bf65-f48bf2b61404', deletedAt: null },
      include: { organization: true },
    });
  });

  it('findById() returns null when not found', async () => {
    mockPrisma.staff.findFirst.mockResolvedValue(null);
    const result = await service.findById('00000000-0000-0000-0000-000000000000');
    expect(result).toBeNull();
  });

  it('verifyPassword() returns true for correct password', async () => {
    const hash = await argon2.hash('correct', { type: argon2.argon2id });
    expect(await service.verifyPassword(hash, 'correct')).toBe(true);
  });

  it('verifyPassword() returns false for incorrect password', async () => {
    const hash = await argon2.hash('correct', { type: argon2.argon2id });
    expect(await service.verifyPassword(hash, 'wrong')).toBe(false);
  });

  it('findById() returns null on malformed UUID or invalid input', async () => {
    expect(await service.findById('not-a-uuid')).toBeNull();
    expect(await service.findById(undefined as unknown as string)).toBeNull();
    expect(await service.findById(null as unknown as string)).toBeNull();
  });

  it('verifyPassword() returns false on invalid hash or non-string inputs', async () => {
    expect(await service.verifyPassword('invalid-hash', 'any')).toBe(false);
    expect(await service.verifyPassword(undefined as unknown as string, 'any')).toBe(false);
    expect(await service.verifyPassword('$argon2id$hash', undefined as unknown as string)).toBe(
      false,
    );
  });

  it('findById() returns null when organization is deactivated', async () => {
    const fakeStaff = {
      id: 'd866a2e8-460d-4560-bf65-f48bf2b61404',
      email: 'owner@test.com',
      organizationId: 'org-1',
      organization: { isActive: false },
    };
    mockPrisma.staff.findFirst.mockResolvedValue(fakeStaff);
    const result = await service.findById('d866a2e8-460d-4560-bf65-f48bf2b61404');
    expect(result).toBeNull();
  });

  it('findByEmail() returns null when organization is deactivated', async () => {
    const fakeStaff = {
      id: '1',
      email: 'owner@test.com',
      organizationId: 'org-1',
      organization: { isActive: false },
    };
    mockPrisma.staff.findFirst.mockResolvedValue(fakeStaff);
    const result = await service.findByEmail('owner@test.com');
    expect(result).toBeNull();
  });

  describe('updatePassword()', () => {
    const fakeStaff = {
      id: 'd866a2e8-460d-4560-bf65-f48bf2b61404',
      email: 'owner@test.com',
      passwordHash: 'old-hash',
      organizationId: 'org-1',
      organization: { isActive: true },
      role: StaffRole.owner,
    };

    it('updates password and logs audit event', async () => {
      mockPrisma.staff.findFirst.mockResolvedValue(fakeStaff);
      mockPrisma.staff.update.mockResolvedValue({ ...fakeStaff, passwordHash: 'new-hash' });
      jest.spyOn(service, 'verifyPassword').mockResolvedValue(true);

      const result = await service.updatePassword(
        fakeStaff.id,
        { currentPassword: 'old', newPassword: 'new' },
        fakeStaff as unknown as Staff,
        '1.2.3.4',
        'Mozilla',
      );

      expect(result.passwordHash).toBe('new-hash');
      expect(mockPrisma.staff.update).toHaveBeenCalled();
      expect(mockAuditLogService.logAuthEvent).toHaveBeenCalledWith({
        organizationId: fakeStaff.organizationId,
        actorId: fakeStaff.id,
        actorEmail: fakeStaff.email,
        actorRole: fakeStaff.role,
        action: 'password_changed',
        resource: 'staff',
        resourceId: fakeStaff.id,
        ipAddress: '1.2.3.4',
        userAgent: 'Mozilla',
      });
    });
  });

  describe('setTabletPin()', () => {
    const staff = {
      id: 'staff-1',
      organizationId: 'org-1',
      email: 'server@test.com',
      passwordHash: 'irrelevant-hash-placeholder',
      role: StaffRole.cashier,
    };
    const actor = {
      id: 'admin-1',
      organizationId: 'org-1',
      email: 'admin@test.com',
      role: StaffRole.admin,
    } as Staff;

    it('throws NotFoundException for a staff member outside the caller organization', async () => {
      mockPrisma.staff.findFirst.mockResolvedValue(null);
      await expect(service.setTabletPin('staff-1', 'org-1', '4242', actor)).rejects.toThrow(
        'Staff member not found',
      );
    });

    it('rejects a PIN identical to the staff member’s login password', async () => {
      mockPrisma.staff.findFirst.mockResolvedValue(staff);
      jest.spyOn(service, 'verifyPassword').mockResolvedValue(true);
      await expect(
        service.setTabletPin('staff-1', 'org-1', 'their-password', actor),
      ).rejects.toThrow('must not be the same as this staff member’s login password');
      expect(mockPrisma.staff.update).not.toHaveBeenCalled();
    });

    it('hashes and stores a valid PIN, and logs an audit event without ever including the plaintext', async () => {
      mockPrisma.staff.findFirst.mockResolvedValue(staff);
      jest.spyOn(service, 'verifyPassword').mockResolvedValue(false);
      mockPrisma.staff.update.mockResolvedValue({ ...staff, pinHash: 'hashed' });

      await service.setTabletPin('staff-1', 'org-1', '4242', actor);

      const data = firstCallArg(mockPrisma.staff.update).data as Record<string, unknown>;
      expect(data.pinHash).not.toBe('4242');
      expect(await argon2.verify(data.pinHash as string, '4242')).toBe(true);
      expect(data.pinSetAt).toBeInstanceOf(Date);

      const auditCall = firstCallArg(mockAuditLogService.logAuthEvent);
      expect(JSON.stringify(auditCall)).not.toContain('4242');
      expect(auditCall.action).toBe('TABLET_STAFF_PIN_SET');
    });
  });

  describe('listForOrganization()', () => {
    it('never returns pinHash or passwordHash', async () => {
      mockPrisma.staff.findMany.mockResolvedValue([
        {
          id: 's1',
          name: 'Alex',
          email: 'alex@x.com',
          role: StaffRole.cashier,
          isActive: true,
          pinHash: 'some-hash',
          passwordHash: 'some-other-hash',
        },
      ]);
      const result = await service.listForOrganization('org-1');
      expect(result).toEqual([
        {
          id: 's1',
          name: 'Alex',
          email: 'alex@x.com',
          role: StaffRole.cashier,
          isActive: true,
          hasTabletPin: true,
        },
      ]);
      expect(JSON.stringify(result)).not.toContain('some-hash');
      expect(JSON.stringify(result)).not.toContain('some-other-hash');
    });
  });
});
