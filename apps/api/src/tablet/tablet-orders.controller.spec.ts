import { Request } from 'express';
import { StaffRole } from '@prisma/client';
import { TabletOrdersController } from './tablet-orders.controller';
import { OrdersService } from '../orders/orders.service';
import { TabletAuthService } from './tablet-auth.service';
import { AuthenticatedUser } from '../auth/interfaces/jwt-payload.interface';
import { CreateTabletOrderDto } from './dto/create-tablet-order.dto';

function reqWith(user: AuthenticatedUser): Request & { user: AuthenticatedUser } {
  return { user } as unknown as Request & { user: AuthenticatedUser };
}

const deviceUser: AuthenticatedUser = {
  id: 'tablet-device:device-1',
  email: 'tablet-device+device-1@verdura.internal',
  role: StaffRole.viewer,
  organizationId: 'org-1',
  venueId: 'venue-1',
  kind: 'tablet_device',
  deviceId: 'device-1',
};

const managerUser: AuthenticatedUser = {
  id: 'staff-manager-1',
  email: 'manager@verdura.co.nz',
  role: StaffRole.manager,
  organizationId: 'org-1',
  venueId: 'venue-1',
  kind: 'tablet_manager',
  deviceId: 'device-1',
  actingStaffId: 'staff-elevated-1',
};

describe('TabletOrdersController', () => {
  let controller: TabletOrdersController;
  let mockOrdersService: { findAll: jest.Mock; createStaffOrder: jest.Mock };
  let mockTabletAuthService: { resolveDeviceSystemActor: jest.Mock };

  beforeEach(() => {
    mockOrdersService = { findAll: jest.fn(), createStaffOrder: jest.fn() };
    mockTabletAuthService = { resolveDeviceSystemActor: jest.fn() };
    controller = new TabletOrdersController(
      mockOrdersService as unknown as OrdersService,
      mockTabletAuthService as unknown as TabletAuthService,
    );
  });

  describe('listRestrictedOrders', () => {
    it('scopes a device token to its own venue', async () => {
      mockOrdersService.findAll.mockResolvedValue([]);
      await controller.listRestrictedOrders(reqWith(deviceUser), 'true');
      expect(mockOrdersService.findAll).toHaveBeenCalledWith('org-1', 'venue-1', true);
    });

    it('defaults activeOnly to false when not supplied', async () => {
      mockOrdersService.findAll.mockResolvedValue([]);
      await controller.listRestrictedOrders(reqWith(deviceUser), undefined);
      expect(mockOrdersService.findAll).toHaveBeenCalledWith('org-1', 'venue-1', false);
    });
  });

  describe('createRestrictedOrder', () => {
    it('attributes the order to the resolved per-device system actor, never a fabricated staff identity', async () => {
      const systemActor = {
        id: 'sys-actor-1',
        email: 'tablet-device+device-1@verdura.internal',
        role: StaffRole.viewer,
      };
      mockTabletAuthService.resolveDeviceSystemActor.mockResolvedValue(systemActor);
      mockOrdersService.createStaffOrder.mockResolvedValue({ id: 'ORD-600001' });

      const dto: CreateTabletOrderDto = {
        tableId: 'table-1',
        serviceMode: 'dine_in',
        items: [{ menuItemId: 'item-1', quantity: 1 }] as CreateTabletOrderDto['items'],
        notes: undefined,
        idempotencyKey: 'idem-key-1234567890',
      };

      await controller.createRestrictedOrder(reqWith(deviceUser), dto);

      expect(mockTabletAuthService.resolveDeviceSystemActor).toHaveBeenCalledWith(
        'org-1',
        'device-1',
      );
      expect(mockOrdersService.createStaffOrder).toHaveBeenCalledWith(
        {
          venueId: 'venue-1',
          tableId: 'table-1',
          serviceMode: 'dine_in',
          items: dto.items,
          notes: undefined,
          idempotencyKey: 'idem-key-1234567890',
        },
        'org-1',
        {
          id: 'sys-actor-1',
          email: 'tablet-device+device-1@verdura.internal',
          role: StaffRole.viewer,
        },
      );
    });

    it('never uses the device token venueId as the actor identity — venueId always comes from the token, not the DTO', async () => {
      mockTabletAuthService.resolveDeviceSystemActor.mockResolvedValue({
        id: 'sys-actor-1',
        email: 'x',
        role: StaffRole.viewer,
      });
      mockOrdersService.createStaffOrder.mockResolvedValue({ id: 'ORD-600002' });

      const dto: CreateTabletOrderDto = {
        serviceMode: 'takeaway',
        items: [] as CreateTabletOrderDto['items'],
        idempotencyKey: 'idem-key-takeaway-0000001',
      };

      await controller.createRestrictedOrder(reqWith(deviceUser), dto);

      const call = mockOrdersService.createStaffOrder.mock.calls[0][0];
      expect(call.venueId).toBe('venue-1');
      expect(call.tableId).toBeUndefined();
      expect(call.serviceMode).toBe('takeaway');
    });
  });

  describe('managerAuthorizationTestHook', () => {
    it('returns the manager-stepped-up identity from the request, including the acting staff id', () => {
      const result = controller.managerAuthorizationTestHook(reqWith(managerUser));
      expect(result).toEqual({
        authorized: true,
        managerId: 'staff-manager-1',
        actingStaffId: 'staff-elevated-1',
        deviceId: 'device-1',
        venueId: 'venue-1',
      });
    });
  });
});
