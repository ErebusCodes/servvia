import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { TabletTokenActiveGuard } from './tablet-token-active.guard';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthenticatedUser } from '../interfaces/jwt-payload.interface';

const mockPrisma = {
  tabletDevice: {
    findUnique: jest.fn(),
  },
};

function contextFor(user: AuthenticatedUser | undefined): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ user }),
    }),
  } as unknown as ExecutionContext;
}

describe('TabletTokenActiveGuard', () => {
  let guard: TabletTokenActiveGuard;

  beforeEach(() => {
    jest.clearAllMocks();
    guard = new TabletTokenActiveGuard(mockPrisma as unknown as PrismaService);
  });

  // Regression coverage: found live against the real dev API/Postgres —
  // GET /venues/:venueId/tables kept honouring a revoked device's bare
  // token (200, full table list) because TablesController.findAll had no
  // revocation re-check at all, the same class of gap
  // OrdersController's staff-tier routes were already fixed for.
  it('rejects a tablet_device token whose device has been revoked', async () => {
    mockPrisma.tabletDevice.findUnique.mockResolvedValue({ id: 'device-1', status: 'revoked' });
    const user: AuthenticatedUser = {
      id: 'tablet-device:device-1',
      email: 'tablet-device+device-1@verdura.internal',
      role: 'viewer',
      organizationId: 'org-1',
      venueId: 'venue-1',
      kind: 'tablet_device',
      deviceId: 'device-1',
    };

    await expect(guard.canActivate(contextFor(user))).rejects.toThrow(UnauthorizedException);
  });

  it('rejects a tablet_staff token whose underlying device has been revoked', async () => {
    mockPrisma.tabletDevice.findUnique.mockResolvedValue({ id: 'device-1', status: 'revoked' });
    const user: AuthenticatedUser = {
      id: 'staff-1',
      email: 'staff@verdura.co.nz',
      role: 'admin',
      organizationId: 'org-1',
      venueId: 'venue-1',
      kind: 'tablet_staff',
      deviceId: 'device-1',
    };

    await expect(guard.canActivate(contextFor(user))).rejects.toThrow(UnauthorizedException);
  });

  it('rejects when the device row no longer exists at all', async () => {
    mockPrisma.tabletDevice.findUnique.mockResolvedValue(null);
    const user: AuthenticatedUser = {
      id: 'tablet-device:device-1',
      email: 'tablet-device+device-1@verdura.internal',
      role: 'viewer',
      organizationId: 'org-1',
      venueId: 'venue-1',
      kind: 'tablet_device',
      deviceId: 'device-1',
    };

    await expect(guard.canActivate(contextFor(user))).rejects.toThrow(UnauthorizedException);
  });

  it('allows a tablet_device token whose device is still active', async () => {
    mockPrisma.tabletDevice.findUnique.mockResolvedValue({ id: 'device-1', status: 'active' });
    const user: AuthenticatedUser = {
      id: 'tablet-device:device-1',
      email: 'tablet-device+device-1@verdura.internal',
      role: 'viewer',
      organizationId: 'org-1',
      venueId: 'venue-1',
      kind: 'tablet_device',
      deviceId: 'device-1',
    };

    await expect(guard.canActivate(contextFor(user))).resolves.toBe(true);
  });

  it('is a no-op for a plain staff token (no deviceId claim)', async () => {
    const user: AuthenticatedUser = {
      id: 'staff-1',
      email: 'staff@verdura.co.nz',
      role: 'admin',
      organizationId: 'org-1',
    };

    await expect(guard.canActivate(contextFor(user))).resolves.toBe(true);
    expect(mockPrisma.tabletDevice.findUnique).not.toHaveBeenCalled();
  });

  it('is a no-op for a kds_device token (no deviceId claim tied to a TabletDevice row)', async () => {
    const user: AuthenticatedUser = {
      id: 'kds-device:venue-1',
      email: 'kds-device+venue-1@verdura.internal',
      role: 'kitchen',
      organizationId: 'org-1',
      venueId: 'venue-1',
      kind: 'kds_device',
    };

    await expect(guard.canActivate(contextFor(user))).resolves.toBe(true);
    expect(mockPrisma.tabletDevice.findUnique).not.toHaveBeenCalled();
  });
});
