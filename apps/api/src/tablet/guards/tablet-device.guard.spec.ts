import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { TabletDeviceGuard } from './tablet-device.guard';
import { TabletAuthService } from '../tablet-auth.service';

function contextWithUser(user: unknown): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
}

describe('TabletDeviceGuard', () => {
  let assertDeviceActive: jest.Mock;
  let guard: TabletDeviceGuard;

  beforeEach(() => {
    assertDeviceActive = jest.fn().mockResolvedValue({ id: 'device-1', status: 'active' });
    guard = new TabletDeviceGuard({ assertDeviceActive } as unknown as TabletAuthService);
  });

  it('rejects a request with no user at all', async () => {
    await expect(guard.canActivate(contextWithUser(undefined))).rejects.toThrow(ForbiddenException);
  });

  it('rejects a plain staff token (no tablet kind)', async () => {
    await expect(
      guard.canActivate(contextWithUser({ id: 's1', kind: undefined, deviceId: undefined })),
    ).rejects.toThrow(ForbiddenException);
  });

  it('rejects a kds_device token — a KDS terminal is not an Order Tablet device', async () => {
    await expect(
      guard.canActivate(contextWithUser({ id: 'kds-1', kind: 'kds_device', deviceId: 'device-1' })),
    ).rejects.toThrow(ForbiddenException);
  });

  it('accepts a tablet_device token and re-checks device activity', async () => {
    await expect(
      guard.canActivate(
        contextWithUser({
          id: 'tablet-device:device-1',
          kind: 'tablet_device',
          deviceId: 'device-1',
        }),
      ),
    ).resolves.toBe(true);
    expect(assertDeviceActive).toHaveBeenCalledWith('device-1');
  });

  it('accepts a tablet_staff token (elevation implies device-tier authority too)', async () => {
    await expect(
      guard.canActivate(
        contextWithUser({ id: 'staff-1', kind: 'tablet_staff', deviceId: 'device-1' }),
      ),
    ).resolves.toBe(true);
  });

  it('propagates a revoked-device rejection from the service', async () => {
    assertDeviceActive.mockRejectedValue(new UnauthorizedException('revoked'));
    await expect(
      guard.canActivate(
        contextWithUser({
          id: 'tablet-device:device-1',
          kind: 'tablet_device',
          deviceId: 'device-1',
        }),
      ),
    ).rejects.toThrow(UnauthorizedException);
  });
});
