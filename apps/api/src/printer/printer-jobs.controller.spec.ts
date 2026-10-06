import { ForbiddenException } from '@nestjs/common';
import { StaffRole } from '@prisma/client';
import { Request } from 'express';
import { AuthenticatedUser } from '../auth/interfaces/jwt-payload.interface';
import { PrinterJobsController } from './printer-jobs.controller';
import { PrinterJobsService } from './printer-jobs.service';

const venueId = 'venue-1';

function requestAs(user: Partial<AuthenticatedUser>) {
  return {
    user: { organizationId: 'org-1', venueId, ...user } as AuthenticatedUser,
  } as Request & { user: AuthenticatedUser };
}

describe('PrinterJobsController — who requests a reprint (Story 12.15)', () => {
  const service = {
    requestReprint: jest.fn().mockResolvedValue({ id: 'job-2' }),
    retryDispatch: jest.fn().mockResolvedValue({ id: 'job-1' }),
  };
  const controller = new PrinterJobsController(service as unknown as PrinterJobsService);

  beforeEach(() => jest.clearAllMocks());

  it('names the staff member of a staff session, with no device', async () => {
    await controller.requestReprint(
      requestAs({ id: 'staff-1', email: 's@example.test', role: StaffRole.manager, kind: 'staff' }),
      'printer-1',
      'job-1',
    );
    expect(service.requestReprint).toHaveBeenCalledWith('printer-1', 'job-1', 'org-1', undefined, {
      id: 'staff-1',
      email: 's@example.test',
      role: StaffRole.manager,
      deviceKind: undefined,
      deviceId: undefined,
    });
  });

  it.each(['tablet_staff', 'tablet_manager'] as const)(
    'names the staff member and the tablet they acted through (%s)',
    async (kind) => {
      await controller.retryDispatch(
        requestAs({
          id: 'staff-2',
          email: 'c@example.test',
          role: StaffRole.cashier,
          kind,
          deviceId: 'tablet-1',
        }),
        'printer-1',
        'job-1',
      );
      expect(service.retryDispatch).toHaveBeenCalledWith('printer-1', 'job-1', 'org-1', venueId, {
        id: 'staff-2',
        email: 'c@example.test',
        role: StaffRole.cashier,
        deviceKind: 'tablet_device',
        deviceId: 'tablet-1',
      });
    },
  );

  it.each([
    { kind: 'kds_device' as const, role: StaffRole.kitchen },
    { kind: 'tablet_device' as const, role: StaffRole.viewer, deviceId: 'tablet-1' },
  ])('refuses a device credential, which names no staff member ($kind)', (user) => {
    expect(() =>
      controller.requestReprint(
        requestAs({ id: `device:${venueId}`, email: 'd@verdura.internal', ...user }),
        'printer-1',
        'job-1',
      ),
    ).toThrow(ForbiddenException);
    expect(service.requestReprint).not.toHaveBeenCalled();
  });
});
