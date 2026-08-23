import { Request } from 'express';
import { Staff, StaffRole } from '@prisma/client';
import { TabletDevicesAdminController } from './tablet-devices-admin.controller';
import { TabletAuthService } from './tablet-auth.service';

function reqWithStaff(user: Partial<Staff>): Request & { user: Staff } {
  return { user } as unknown as Request & { user: Staff };
}

const staffActor: Partial<Staff> = {
  id: 'staff-1',
  email: 'manager@verdura.co.nz',
  role: StaffRole.manager,
  organizationId: 'org-1',
};

describe('TabletDevicesAdminController', () => {
  let controller: TabletDevicesAdminController;
  let mockTabletAuthService: {
    createEnrollment: jest.Mock;
    listDevices: jest.Mock;
    revokeDevice: jest.Mock;
  };

  beforeEach(() => {
    mockTabletAuthService = {
      createEnrollment: jest.fn(),
      listDevices: jest.fn(),
      revokeDevice: jest.fn(),
    };
    controller = new TabletDevicesAdminController(mockTabletAuthService as unknown as TabletAuthService);
  });

  it('createEnrollment scopes to the caller organization and the route venueId, attributing to the real staff actor', async () => {
    mockTabletAuthService.createEnrollment.mockResolvedValue({
      enrollmentId: 'enr-1',
      bootstrapToken: 'enr-1.code',
      expiresAt: new Date('2026-01-01T00:00:00Z'),
    });

    await controller.createEnrollment('venue-1', { label: 'Front counter' }, reqWithStaff(staffActor));

    expect(mockTabletAuthService.createEnrollment).toHaveBeenCalledWith('org-1', 'venue-1', 'Front counter', {
      id: 'staff-1',
      email: 'manager@verdura.co.nz',
      role: StaffRole.manager,
    });
  });

  it('listDevices scopes to the caller organization and the route venueId only', async () => {
    mockTabletAuthService.listDevices.mockResolvedValue([]);
    await controller.listDevices('venue-1', reqWithStaff(staffActor));
    expect(mockTabletAuthService.listDevices).toHaveBeenCalledWith('org-1', 'venue-1');
  });

  it('revokeDevice scopes to organization + venue + device, attributed to the real staff actor, and returns a truthful ack', async () => {
    mockTabletAuthService.revokeDevice.mockResolvedValue(undefined);

    const result = await controller.revokeDevice('venue-1', 'device-1', reqWithStaff(staffActor));

    expect(mockTabletAuthService.revokeDevice).toHaveBeenCalledWith('device-1', 'org-1', 'venue-1', {
      id: 'staff-1',
      email: 'manager@verdura.co.nz',
      role: StaffRole.manager,
    });
    expect(result).toEqual({ revoked: true });
  });
});
