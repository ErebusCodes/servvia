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
        actorType: 'staff',
        actorId: 'staff-456',
        actorEmail: 'owner@test.com',
        actorRole: StaffRole.owner,
        deviceKind: null,
        deviceId: null,
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

  describe('Story 12.15: device and system actors', () => {
    it('records a device actor without any staff identity', async () => {
      mockPrisma.auditLog.create.mockResolvedValue({ id: 'log-1' });
      await service.logAuthEvent({
        organizationId: 'org-1',
        venueId: 'venue-1',
        actorType: 'device',
        deviceKind: 'kds_device',
        actorRole: StaffRole.kitchen,
        action: 'UPDATE_ORDER_STATUS',
        resource: 'order',
        resourceId: 'order-1',
      });
      const { data } = mockPrisma.auditLog.create.mock.calls[0][0] as {
        data: Record<string, unknown>;
      };
      expect(data).toMatchObject({
        actorType: 'device',
        deviceKind: 'kds_device',
        deviceId: null,
        actorRole: StaffRole.kitchen,
      });
      expect(data).not.toHaveProperty('actorId');
      expect(data).not.toHaveProperty('actorEmail');
      expect(data).not.toHaveProperty('systemActor');
    });

    it('records a system actor by name only', async () => {
      mockPrisma.auditLog.create.mockResolvedValue({ id: 'log-2' });
      await service.logAuthEvent({
        organizationId: 'org-1',
        actorType: 'system',
        systemActor: 'connector-command-sweep',
        action: 'CONNECTOR_COMMAND_MARKED_UNKNOWN',
        resource: 'connector_command',
      });
      const { data } = mockPrisma.auditLog.create.mock.calls[0][0] as {
        data: Record<string, unknown>;
      };
      expect(data).toMatchObject({ actorType: 'system', systemActor: 'connector-command-sweep' });
      for (const key of ['actorId', 'actorEmail', 'actorRole', 'deviceKind', 'deviceId']) {
        expect(data).not.toHaveProperty(key);
      }
    });

    it('records a staff member acting through a tablet with both identities', async () => {
      mockPrisma.auditLog.create.mockResolvedValue({ id: 'log-3' });
      await service.logAuthEvent({
        organizationId: 'org-1',
        actorId: 'staff-1',
        actorEmail: 'waiter@example.test',
        actorRole: StaffRole.cashier,
        deviceKind: 'tablet_device',
        deviceId: 'device-1',
        action: 'CREATE_ORDER',
        resource: 'order',
      });
      const { data } = mockPrisma.auditLog.create.mock.calls[0][0] as {
        data: Record<string, unknown>;
      };
      expect(data).toMatchObject({
        actorType: 'staff',
        actorId: 'staff-1',
        deviceKind: 'tablet_device',
        deviceId: 'device-1',
      });
    });
  });
});
