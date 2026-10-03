import { ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { StaffRole } from '@prisma/client';
import { Request } from 'express';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { RateLimitGuard } from '../auth/guards/rate-limit.guard';
import { AuthenticatedUser } from '../auth/interfaces/jwt-payload.interface';
import { REDIS_CLIENT } from '../redis/redis.constants';
import { ROLES_KEY } from '../auth/decorators/roles.decorator';
import { PrismaService } from '../prisma/prisma.service';

const mockOrdersService = {
  findAll: jest.fn(),
  findOne: jest.fn(),
  updateStatus: jest.fn(),
  create: jest.fn(),
};

function reqWith(user: AuthenticatedUser): Request & { user: AuthenticatedUser } {
  return { user } as unknown as Request & { user: AuthenticatedUser };
}

const staffUser: AuthenticatedUser = {
  id: 'staff-1',
  email: 'staff@verdura.co.nz',
  role: StaffRole.admin,
  organizationId: 'org-1',
};

const kdsUser: AuthenticatedUser = {
  id: 'kds-device:venue-1',
  email: 'kds-device+venue-1@verdura.internal',
  role: StaffRole.kitchen,
  organizationId: 'org-1',
  venueId: 'venue-1',
  kind: 'kds_device',
};

describe('OrdersController venue scoping', () => {
  let controller: OrdersController;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [OrdersController],
      providers: [
        { provide: OrdersService, useValue: mockOrdersService },
        { provide: RateLimitGuard, useValue: { canActivate: () => true } },
        { provide: REDIS_CLIENT, useValue: { eval: jest.fn() } },
        // TabletTokenActiveGuard (story 15-1, DL-081) is now part of this
        // controller's guard chain; it only touches Prisma for tablet_*
        // kind tokens (none of this file's fixtures are), but still needs
        // a resolvable PrismaService to construct via Nest's DI.
        { provide: PrismaService, useValue: { tabletDevice: { findUnique: jest.fn() } } },
      ],
    }).compile();
    controller = module.get<OrdersController>(OrdersController);
  });

  describe('findAll', () => {
    it('lets a staff token query any venueId within its organization', () => {
      void controller.findAll(reqWith(staffUser), 'venue-99', undefined);
      expect(mockOrdersService.findAll).toHaveBeenCalledWith('org-1', 'venue-99', false);
    });

    it('forces a kds_device token onto its own venueId when none is requested', () => {
      void controller.findAll(reqWith(kdsUser), undefined, 'true');
      expect(mockOrdersService.findAll).toHaveBeenCalledWith('org-1', 'venue-1', true);
    });

    it('allows a kds_device token to explicitly request its own venueId', () => {
      void controller.findAll(reqWith(kdsUser), 'venue-1', undefined);
      expect(mockOrdersService.findAll).toHaveBeenCalledWith('org-1', 'venue-1', false);
    });

    it('rejects a kds_device token requesting a different venueId', () => {
      expect(() => controller.findAll(reqWith(kdsUser), 'someone-elses-venue', undefined)).toThrow(
        ForbiddenException,
      );
      expect(mockOrdersService.findAll).not.toHaveBeenCalled();
    });
  });

  describe('findOne', () => {
    it('does not scope by venue for a staff token', () => {
      void controller.findOne(reqWith(staffUser), 'order-1');
      expect(mockOrdersService.findOne).toHaveBeenCalledWith('order-1', 'org-1', undefined);
    });

    it('scopes to the device venue for a kds_device token', () => {
      void controller.findOne(reqWith(kdsUser), 'order-1');
      expect(mockOrdersService.findOne).toHaveBeenCalledWith('order-1', 'org-1', 'venue-1');
    });
  });

  describe('updateStatus', () => {
    it('scopes the update to the device venue for a kds_device token', () => {
      void controller.updateStatus(reqWith(kdsUser), 'order-1', { status: 'preparing' } as never);
      expect(mockOrdersService.updateStatus).toHaveBeenCalledWith(
        'order-1',
        'org-1',
        { status: 'preparing' },
        // Story 12.15: a KDS screen is audited as a device, never as a Staff row.
        { actorType: 'device', deviceKind: 'kds_device', actorRole: kdsUser.role },
        'venue-1',
      );
    });

    it('does not scope the update for a staff token', () => {
      void controller.updateStatus(reqWith(staffUser), 'order-1', { status: 'preparing' } as never);
      expect(mockOrdersService.updateStatus).toHaveBeenCalledWith(
        'order-1',
        'org-1',
        { status: 'preparing' },
        {
          actorType: 'staff',
          actorId: staffUser.id,
          actorEmail: staffUser.email,
          actorRole: staffUser.role,
        },
        undefined,
      );
    });
  });
});

// Story 2.7: the kitchen role (KDS venue-PIN token) cannot create or cancel orders.
describe('OrdersController kitchen-role least privilege', () => {
  let controller: OrdersController;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [OrdersController],
      providers: [
        { provide: OrdersService, useValue: mockOrdersService },
        { provide: RateLimitGuard, useValue: { canActivate: () => true } },
        { provide: REDIS_CLIENT, useValue: { eval: jest.fn() } },
        { provide: PrismaService, useValue: { tabletDevice: { findUnique: jest.fn() } } },
      ],
    }).compile();
    controller = module.get<OrdersController>(OrdersController);
  });

  it('does not grant the kitchen role order creation', () => {
    const handler = Object.getOwnPropertyDescriptor(OrdersController.prototype, 'createStaffOrder')
      ?.value as object;
    const roles = Reflect.getMetadata(ROLES_KEY, handler) as StaffRole[];
    expect(roles).not.toContain(StaffRole.kitchen);
    expect(roles).toEqual(
      expect.arrayContaining([StaffRole.admin, StaffRole.manager, StaffRole.cashier]),
    );
  });

  it.each(['cancelled', 'pending', 'confirmed'])(
    'refuses a kitchen token setting %s (403), before the service',
    (status) => {
      expect(() =>
        controller.updateStatus(reqWith(kdsUser), 'order-1', { status } as never),
      ).toThrow(ForbiddenException);
      expect(mockOrdersService.updateStatus).not.toHaveBeenCalled();
    },
  );

  it.each(['preparing', 'ready', 'completed'])(
    'lets a kitchen token advance preparation to %s',
    (status) => {
      void controller.updateStatus(reqWith(kdsUser), 'order-1', { status } as never);
      expect(mockOrdersService.updateStatus).toHaveBeenCalledTimes(1);
    },
  );

  it('lets a cashier cancel', () => {
    void controller.updateStatus(reqWith({ ...staffUser, role: StaffRole.cashier }), 'order-1', {
      status: 'cancelled',
    } as never);
    expect(mockOrdersService.updateStatus).toHaveBeenCalledTimes(1);
  });
});
