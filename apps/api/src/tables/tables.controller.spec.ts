import { ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { TablesController } from './tables.controller';
import { TablesService } from './tables.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { StaffRole, Staff } from '@prisma/client';
import { Request } from 'express';
import { AuthenticatedUser } from '../auth/interfaces/jwt-payload.interface';
import { PrismaService } from '../prisma/prisma.service';

const mockTablesService = {
  create: jest.fn(),
  findAll: jest.fn(),
  findOne: jest.fn(),
  update: jest.fn(),
  remove: jest.fn(),
};

describe('TablesController', () => {
  let controller: TablesController;

  const mockUser = {
    id: 'user-1',
    organizationId: 'org-1',
    role: StaffRole.admin,
  } as Staff;

  const mockReq = {
    user: mockUser,
  } as unknown as Request & { user: Staff };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [TablesController],
      providers: [
        { provide: TablesService, useValue: mockTablesService },
        // TabletTokenActiveGuard (story 15-1, DL-081) is now part of this
        // controller's guard chain; it only touches Prisma for tablet_*
        // kind tokens (none of this file's fixtures are), but still needs
        // a resolvable PrismaService to construct via Nest's DI.
        { provide: PrismaService, useValue: { tabletDevice: { findUnique: jest.fn() } } },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<TablesController>(TablesController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('create', () => {
    it('should delegate to TablesService.create with organizationId and venueId', async () => {
      const dto = { tableNumber: '1', capacity: 2 };
      mockTablesService.create.mockResolvedValue({ id: 'table-1', venueId: 'venue-1', ...dto });

      const result = await controller.create('venue-1', dto, mockReq);
      expect(result.id).toBe('table-1');
      expect(mockTablesService.create).toHaveBeenCalledWith('org-1', 'venue-1', dto);
    });
  });

  describe('findAll', () => {
    it('should delegate to TablesService.findAll with organizationId and venueId', async () => {
      const list = [{ id: '1' }, { id: '2' }];
      mockTablesService.findAll.mockResolvedValue(list);

      const result = await controller.findAll('venue-1', mockReq);
      expect(result).toEqual(list);
      expect(mockTablesService.findAll).toHaveBeenCalledWith('org-1', 'venue-1');
    });
  });

  describe('findOne', () => {
    it('should delegate to TablesService.findOne with id, venueId, and organizationId', async () => {
      const table = { id: 'table-1', venueId: 'venue-1' };
      mockTablesService.findOne.mockResolvedValue(table);

      const result = await controller.findOne('venue-1', 'table-1', mockReq);
      expect(result).toEqual(table);
      expect(mockTablesService.findOne).toHaveBeenCalledWith('table-1', 'venue-1', 'org-1');
    });
  });

  describe('update', () => {
    it('should delegate to TablesService.update with id, venueId, organizationId, and dto', async () => {
      const dto = { capacity: 6 };
      mockTablesService.update.mockResolvedValue({ id: 'table-1', venueId: 'venue-1', ...dto });

      const result = await controller.update('venue-1', 'table-1', dto, mockReq);
      expect(result.capacity).toBe(6);
      expect(mockTablesService.update).toHaveBeenCalledWith('table-1', 'venue-1', 'org-1', dto);
    });
  });

  describe('remove', () => {
    it('should delegate to TablesService.remove with id, venueId, and organizationId', async () => {
      const deleted = { id: 'table-1', venueId: 'venue-1' };
      mockTablesService.remove.mockResolvedValue(deleted);

      const result = await controller.remove('venue-1', 'table-1', mockReq);
      expect(result).toEqual(deleted);
      expect(mockTablesService.remove).toHaveBeenCalledWith('table-1', 'venue-1', 'org-1');
    });
  });

  describe('kds_device venue scoping', () => {
    const kdsUser: AuthenticatedUser = {
      id: 'kds-device:venue-1',
      email: 'kds-device+venue-1@verdura.internal',
      role: StaffRole.kitchen,
      organizationId: 'org-1',
      venueId: 'venue-1',
      kind: 'kds_device',
    };
    const kdsReq = { user: kdsUser } as unknown as Request & { user: AuthenticatedUser };

    it('allows a device token to read tables for its own venue', async () => {
      mockTablesService.findAll.mockResolvedValue([]);
      await controller.findAll('venue-1', kdsReq);
      expect(mockTablesService.findAll).toHaveBeenCalledWith('org-1', 'venue-1');
    });

    it('rejects a device token reading tables for a different venue', async () => {
      await expect(controller.findAll('someone-elses-venue', kdsReq)).rejects.toThrow(
        ForbiddenException,
      );
      expect(mockTablesService.findAll).not.toHaveBeenCalled();
    });
  });

  // Regression coverage: an unelevated standalone Order Tablet's bare
  // device token (role viewer, kind tablet_device — story 15-1/DL-081) was
  // not in this endpoint's @Roles list at all, so the restricted-mode floor
  // screen could never resolve table numbers to real backend Table ids —
  // found via real browser validation, not merely a hypothetical gap.
  describe('tablet_device venue scoping', () => {
    const tabletDeviceUser: AuthenticatedUser = {
      id: 'tablet-device:device-1',
      email: 'tablet-device+device-1@verdura.internal',
      role: StaffRole.viewer,
      organizationId: 'org-1',
      venueId: 'venue-1',
      kind: 'tablet_device',
      deviceId: 'device-1',
    };
    const tabletDeviceReq = {
      user: tabletDeviceUser,
    } as unknown as Request & { user: AuthenticatedUser };

    it('allows an unelevated tablet device token to read tables for its own venue', async () => {
      mockTablesService.findAll.mockResolvedValue([]);
      await controller.findAll('venue-1', tabletDeviceReq);
      expect(mockTablesService.findAll).toHaveBeenCalledWith('org-1', 'venue-1');
    });

    it('rejects a tablet device token reading tables for a different venue', async () => {
      await expect(controller.findAll('someone-elses-venue', tabletDeviceReq)).rejects.toThrow(
        ForbiddenException,
      );
      expect(mockTablesService.findAll).not.toHaveBeenCalled();
    });
  });
});
