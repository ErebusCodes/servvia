import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { StaffRole } from '@prisma/client';
import { TabletStaffGuard } from './tablet-staff.guard';
import { TabletAuthService } from '../tablet-auth.service';
import { PrismaService } from '../../prisma/prisma.service';

function contextWithUser(user: unknown): ExecutionContext {
  return { switchToHttp: () => ({ getRequest: () => ({ user }) }) } as unknown as ExecutionContext;
}

describe('TabletStaffGuard', () => {
  let assertDeviceActive: jest.Mock;
  let findUnique: jest.Mock;
  let guard: TabletStaffGuard;

  beforeEach(() => {
    assertDeviceActive = jest.fn().mockResolvedValue({ id: 'device-1', status: 'active' });
    findUnique = jest.fn().mockResolvedValue({
      id: 'staff-1',
      isActive: true,
      deletedAt: null,
      role: StaffRole.cashier,
    });
    guard = new TabletStaffGuard(
      { assertDeviceActive } as unknown as TabletAuthService,
      { staff: { findUnique } } as unknown as PrismaService,
    );
  });

  it('rejects a bare tablet_device token — device-only never implies staff authority', async () => {
    await expect(
      guard.canActivate(
        contextWithUser({
          id: 'tablet-device:device-1',
          kind: 'tablet_device',
          deviceId: 'device-1',
        }),
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it('accepts a tablet_staff token for a still-active staff member', async () => {
    await expect(
      guard.canActivate(
        contextWithUser({ id: 'staff-1', kind: 'tablet_staff', deviceId: 'device-1' }),
      ),
    ).resolves.toBe(true);
  });

  it('accepts a tablet_manager token too (manager implies staff-tier authority)', async () => {
    await expect(
      guard.canActivate(
        contextWithUser({ id: 'mgr-1', kind: 'tablet_manager', deviceId: 'device-1' }),
      ),
    ).resolves.toBe(true);
  });

  it('rejects when the staff member has since been deactivated', async () => {
    findUnique.mockResolvedValue({
      id: 'staff-1',
      isActive: false,
      deletedAt: null,
      role: StaffRole.cashier,
    });
    await expect(
      guard.canActivate(
        contextWithUser({ id: 'staff-1', kind: 'tablet_staff', deviceId: 'device-1' }),
      ),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('rejects when the underlying device has been revoked since elevation', async () => {
    assertDeviceActive.mockRejectedValue(new UnauthorizedException('revoked'));
    await expect(
      guard.canActivate(
        contextWithUser({ id: 'staff-1', kind: 'tablet_staff', deviceId: 'device-1' }),
      ),
    ).rejects.toThrow(UnauthorizedException);
  });
});
