import { Test, TestingModule } from '@nestjs/testing';
import { AuditLogService } from './audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { StaffRole, Prisma } from '@prisma/client';

const mockPrisma = {
  auditLog: {
    create: jest.fn(),
  },
};

describe('AuditLogService', () => {
  let service: AuditLogService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [AuditLogService, { provide: PrismaService, useValue: mockPrisma }],
    }).compile();

    service = module.get<AuditLogService>(AuditLogService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('logAuthEvent() should insert an audit log record into database', async () => {
    const dto = {
      organizationId: 'org-123',
      actorId: 'staff-456',
      actorEmail: 'owner@test.com',
      actorRole: StaffRole.owner,
      action: 'login',
      resource: 'auth',
      ipAddress: '127.0.0.1',
      userAgent: 'Mozilla/5.0',
    };

    mockPrisma.auditLog.create.mockResolvedValue({ id: 'log-789', ...dto, timestamp: new Date() });

    const result = await service.logAuthEvent(dto);

    expect(result.id).toBe('log-789');
    expect(mockPrisma.auditLog.create).toHaveBeenCalledWith({
      data: {
        organizationId: 'org-123',
        venueId: null,
        actorId: 'staff-456',
        actorEmail: 'owner@test.com',
        actorRole: StaffRole.owner,
        action: 'login',
        resource: 'auth',
        resourceId: null,
        before: Prisma.DbNull,
        after: Prisma.DbNull,
        ipAddress: '127.0.0.1',
        userAgent: 'Mozilla/5.0',
      },
    });
  });
});
