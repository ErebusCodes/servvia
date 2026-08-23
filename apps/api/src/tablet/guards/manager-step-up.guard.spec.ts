import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { StaffRole } from '@prisma/client';
import { ManagerStepUpGuard } from './manager-step-up.guard';
import { TabletAuthService } from '../tablet-auth.service';
import { PrismaService } from '../../prisma/prisma.service';

function contextWithUser(user: unknown): ExecutionContext {
  return { switchToHttp: () => ({ getRequest: () => ({ user }) }) } as unknown as ExecutionContext;
}

describe('ManagerStepUpGuard', () => {
  let assertDeviceActive: jest.Mock;
  let findUnique: jest.Mock;
  let guard: ManagerStepUpGuard;

  beforeEach(() => {
    assertDeviceActive = jest.fn().mockResolvedValue({ id: 'device-1', status: 'active' });
    findUnique = jest
      .fn()
      .mockResolvedValue({ id: 'mgr-1', isActive: true, deletedAt: null, role: StaffRole.manager });
    guard = new ManagerStepUpGuard(
      { assertDeviceActive } as unknown as TabletAuthService,
      { staff: { findUnique } } as unknown as PrismaService,
    );
  });

  it('rejects a bare tablet_device token', async () => {
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

  it('rejects ordinary staff elevation — tablet_staff never implies manager authority', async () => {
    await expect(
      guard.canActivate(
        contextWithUser({ id: 'staff-1', kind: 'tablet_staff', deviceId: 'device-1' }),
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it('accepts a tablet_manager token for a still-active manager', async () => {
    await expect(
      guard.canActivate(
        contextWithUser({ id: 'mgr-1', kind: 'tablet_manager', deviceId: 'device-1' }),
      ),
    ).resolves.toBe(true);
  });

  it('rejects if the manager role has since been changed to a non-manager role', async () => {
    findUnique.mockResolvedValue({
      id: 'mgr-1',
      isActive: true,
      deletedAt: null,
      role: StaffRole.cashier,
    });
    await expect(
      guard.canActivate(
        contextWithUser({ id: 'mgr-1', kind: 'tablet_manager', deviceId: 'device-1' }),
      ),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('rejects if the underlying device has since been revoked', async () => {
    assertDeviceActive.mockRejectedValue(new UnauthorizedException('revoked'));
    await expect(
      guard.canActivate(
        contextWithUser({ id: 'mgr-1', kind: 'tablet_manager', deviceId: 'device-1' }),
      ),
    ).rejects.toThrow(UnauthorizedException);
  });
});
