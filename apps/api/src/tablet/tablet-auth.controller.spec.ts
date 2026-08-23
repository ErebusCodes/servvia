import { Request } from 'express';
import { StaffRole } from '@prisma/client';
import { TabletAuthController } from './tablet-auth.controller';
import { TabletAuthService } from './tablet-auth.service';
import { AuthenticatedUser } from '../auth/interfaces/jwt-payload.interface';

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

const staffElevatedUser: AuthenticatedUser = {
  id: 'staff-elevated-1',
  email: 'staff@verdura.co.nz',
  role: StaffRole.kitchen,
  organizationId: 'org-1',
  venueId: 'venue-1',
  kind: 'tablet_staff',
  deviceId: 'device-1',
};

describe('TabletAuthController', () => {
  let controller: TabletAuthController;
  let mockTabletAuthService: {
    enrollDevice: jest.Mock;
    unlockDevice: jest.Mock;
    elevateStaff: jest.Mock;
    managerStepUp: jest.Mock;
    logLockEvent: jest.Mock;
  };

  beforeEach(() => {
    mockTabletAuthService = {
      enrollDevice: jest.fn(),
      unlockDevice: jest.fn(),
      elevateStaff: jest.fn(),
      managerStepUp: jest.fn(),
      logLockEvent: jest.fn(),
    };
    controller = new TabletAuthController(mockTabletAuthService as unknown as TabletAuthService);
  });

  it('enroll delegates the bootstrap token verbatim, no device/venue context required', async () => {
    mockTabletAuthService.enrollDevice.mockResolvedValue({
      deviceId: 'device-1',
      deviceToken: 'tok',
      venueId: 'venue-1',
      label: 'Tablet 1',
    });
    await controller.enroll({ bootstrapToken: 'enrollment-id.code' });
    expect(mockTabletAuthService.enrollDevice).toHaveBeenCalledWith('enrollment-id.code');
  });

  it('unlock passes the device identity from the token, never from the request body', async () => {
    mockTabletAuthService.unlockDevice.mockResolvedValue(undefined);
    const result = await controller.unlock(reqWith(deviceUser), { pin: '1234' });
    expect(mockTabletAuthService.unlockDevice).toHaveBeenCalledWith(
      { deviceId: 'device-1', organizationId: 'org-1', venueId: 'venue-1', label: '' },
      '1234',
    );
    expect(result).toEqual({ unlocked: true });
  });

  it('elevate passes the device identity from the token and the staff PIN from the body', async () => {
    mockTabletAuthService.elevateStaff.mockResolvedValue({
      token: 'staff-tok',
      staff: { id: 's1', name: 'Alex', role: StaffRole.kitchen },
    });
    await controller.elevate(reqWith(deviceUser), { staffPin: '4321' });
    expect(mockTabletAuthService.elevateStaff).toHaveBeenCalledWith(
      { deviceId: 'device-1', organizationId: 'org-1', venueId: 'venue-1', label: '' },
      '4321',
    );
  });

  describe('managerStepUp', () => {
    it('carries no actingStaffId for a bare device-token caller', async () => {
      mockTabletAuthService.managerStepUp.mockResolvedValue({
        token: 'mgr-tok',
        manager: { id: 'm1', name: 'Sam', role: StaffRole.manager },
      });
      await controller.managerStepUp(reqWith(deviceUser), { managerPin: '9999' });
      expect(mockTabletAuthService.managerStepUp).toHaveBeenCalledWith(
        { deviceId: 'device-1', organizationId: 'org-1', venueId: 'venue-1', label: '' },
        '9999',
        undefined,
      );
    });

    it('carries the elevated staff id as actingStaffId for a tablet_staff caller', async () => {
      mockTabletAuthService.managerStepUp.mockResolvedValue({
        token: 'mgr-tok',
        manager: { id: 'm1', name: 'Sam', role: StaffRole.manager },
      });
      await controller.managerStepUp(reqWith(staffElevatedUser), { managerPin: '9999' });
      expect(mockTabletAuthService.managerStepUp).toHaveBeenCalledWith(
        { deviceId: 'device-1', organizationId: 'org-1', venueId: 'venue-1', label: '' },
        '9999',
        'staff-elevated-1',
      );
    });
  });

  describe('lock', () => {
    it('attributes the lock to the elevated staff member when one is active', async () => {
      await controller.lock(reqWith(staffElevatedUser));
      expect(mockTabletAuthService.logLockEvent).toHaveBeenCalledWith(
        { deviceId: 'device-1', organizationId: 'org-1', venueId: 'venue-1', label: '' },
        'staff-elevated-1',
      );
    });

    it('attributes the lock to the device (no staffId) when only a restricted device session was active', async () => {
      await controller.lock(reqWith(deviceUser));
      expect(mockTabletAuthService.logLockEvent).toHaveBeenCalledWith(
        { deviceId: 'device-1', organizationId: 'org-1', venueId: 'venue-1', label: '' },
        undefined,
      );
    });
  });
});
