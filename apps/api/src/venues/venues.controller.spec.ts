import { Test, TestingModule } from '@nestjs/testing';
import { VenuesController } from './venues.controller';
import { VenuesService } from './venues.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { ForbiddenException } from '@nestjs/common';
import { StaffRole, Staff } from '@prisma/client';
import { Request } from 'express';
import { AuthenticatedUser } from '../auth/interfaces/jwt-payload.interface';
import { PrismaService } from '../prisma/prisma.service';

const mockPrisma = {
  tabletDevice: {
    findUnique: jest.fn(),
  },
};

const mockVenuesService = {
  create: jest.fn(),
  findAll: jest.fn(),
  findOne: jest.fn(),
  getTaxConfig: jest.fn(),
  update: jest.fn(),
  remove: jest.fn(),
};

describe('VenuesController', () => {
  let controller: VenuesController;

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
      controllers: [VenuesController],
      providers: [
        { provide: VenuesService, useValue: mockVenuesService },
        // TabletTokenActiveGuard is now part of getTaxConfig's guard chain;
        // it only touches Prisma for tablet_* kind tokens, but still needs
        // a resolvable PrismaService to construct via Nest's DI.
        { provide: PrismaService, useValue: mockPrisma },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<VenuesController>(VenuesController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('create', () => {
    it('should delegate to VenuesService.create with organizationId', async () => {
      const dto = {
        name: 'Verdura Auckland',
        slug: 'auckland',
        address: {},
        operatingHours: {},
        seatingCapacity: 80,
      };
      mockVenuesService.create.mockResolvedValue({ id: 'venue-1', ...dto });

      const result = await controller.create(dto, mockReq);
      expect(result.id).toBe('venue-1');
      expect(mockVenuesService.create).toHaveBeenCalledWith('org-1', dto);
    });
  });

  describe('findAll', () => {
    it('should delegate to VenuesService.findAll with organizationId', async () => {
      const list = [{ id: '1' }, { id: '2' }];
      mockVenuesService.findAll.mockResolvedValue(list);

      const result = await controller.findAll(mockReq);
      expect(result).toEqual(list);
      expect(mockVenuesService.findAll).toHaveBeenCalledWith('org-1');
    });
  });

  describe('findOne', () => {
    it('should delegate to VenuesService.findOne with id and organizationId', async () => {
      const venue = { id: 'venue-1', organizationId: 'org-1' };
      mockVenuesService.findOne.mockResolvedValue(venue);

      const result = await controller.findOne('venue-1', mockReq);
      expect(result).toEqual(venue);
      expect(mockVenuesService.findOne).toHaveBeenCalledWith('venue-1', 'org-1');
    });
  });

  describe('getTaxConfig', () => {
    it('should delegate to VenuesService.getTaxConfig with id and organizationId', async () => {
      const taxConfig = {
        currency: 'NZD',
        locale: 'en-NZ',
        taxJurisdiction: 'NZ_GST',
        pricesIncludeTax: true,
      };
      mockVenuesService.getTaxConfig.mockResolvedValue(taxConfig);

      const result = await controller.getTaxConfig('venue-1', mockReq);
      expect(result).toEqual(taxConfig);
      expect(mockVenuesService.getTaxConfig).toHaveBeenCalledWith('venue-1', 'org-1');
    });

    // Regression coverage: getTaxConfig previously never called
    // resolveVenueScope at all, so any device-kind token already permitted
    // by @Roles (kds_device, and now tablet_device/tablet_staff/
    // tablet_manager — story 15-1/DL-081) could read another venue's tax
    // config just by changing the path param. Found and closed during
    // story 15-1's independent review of every Order Tablet-reachable
    // endpoint, not merely a hypothetical risk.
    describe('device-token venue scoping', () => {
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

      it('allows an unelevated tablet device token to read its own venue’s tax config', async () => {
        mockVenuesService.getTaxConfig.mockResolvedValue({
          currency: 'NZD',
          locale: 'en-NZ',
          taxJurisdiction: 'NZ_GST',
          pricesIncludeTax: true,
        });
        await controller.getTaxConfig('venue-1', tabletDeviceReq);
        expect(mockVenuesService.getTaxConfig).toHaveBeenCalledWith('venue-1', 'org-1');
      });

      it('rejects a tablet device token reading a different venue’s tax config', async () => {
        await expect(
          controller.getTaxConfig('someone-elses-venue', tabletDeviceReq),
        ).rejects.toThrow(ForbiddenException);
        expect(mockVenuesService.getTaxConfig).not.toHaveBeenCalled();
      });
    });
  });

  describe('update', () => {
    it('should delegate to VenuesService.update with id, organizationId, and dto', async () => {
      const dto = { name: 'Updated' };
      mockVenuesService.update.mockResolvedValue({ id: 'venue-1', ...dto });

      const result = await controller.update('venue-1', dto, mockReq);
      expect(result.name).toBe('Updated');
      expect(mockVenuesService.update).toHaveBeenCalledWith('venue-1', 'org-1', dto);
    });
  });

  describe('remove', () => {
    it('should delegate to VenuesService.remove with id and organizationId', async () => {
      const deleted = { id: 'venue-1' };
      mockVenuesService.remove.mockResolvedValue(deleted);

      const result = await controller.remove('venue-1', mockReq);
      expect(result).toEqual(deleted);
      expect(mockVenuesService.remove).toHaveBeenCalledWith('venue-1', 'org-1');
    });
  });
});
