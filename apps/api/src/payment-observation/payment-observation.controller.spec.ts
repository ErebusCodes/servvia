import { ForbiddenException } from '@nestjs/common';
import { PaymentObservationController } from './payment-observation.controller';

describe('PaymentObservationController (identity/kind guard)', () => {
  let service: any;
  let controller: PaymentObservationController;

  beforeEach(() => {
    service = {
      listForVenue: jest.fn().mockResolvedValue([]),
      getForOrder: jest.fn().mockResolvedValue({ state: 'not_observed' }),
      acknowledge: jest.fn().mockResolvedValue({ acknowledged: true }),
    };
    controller = new PaymentObservationController(service);
  });

  function req(user: Record<string, unknown>) {
    return { user } as any;
  }

  const DENIED_KINDS = ['kds_device', 'tablet_device', 'tablet_staff', 'tablet_manager'];

  describe.each(DENIED_KINDS)('kind=%s is denied on every route', (kind) => {
    it('listForVenue throws Forbidden', async () => {
      await expect(
        controller.listForVenue(
          req({ kind, organizationId: 'org-1', venueId: 'venue-1', role: 'manager' }),
          'venue-1',
        ),
      ).rejects.toThrow(ForbiddenException);
      expect(service.listForVenue).not.toHaveBeenCalled();
    });

    it('getForOrder throws Forbidden', async () => {
      await expect(
        controller.getForOrder(
          req({ kind, organizationId: 'org-1', venueId: 'venue-1', role: 'manager' }),
          'order-1',
        ),
      ).rejects.toThrow(ForbiddenException);
      expect(service.getForOrder).not.toHaveBeenCalled();
    });

    it('acknowledge throws Forbidden even with a manager-shaped role claim', async () => {
      await expect(
        controller.acknowledge(
          req({ kind, organizationId: 'org-1', venueId: 'venue-1', role: 'manager' }),
          'proj-1',
          { note: 'looks fine' },
        ),
      ).rejects.toThrow(ForbiddenException);
      expect(service.acknowledge).not.toHaveBeenCalled();
    });
  });

  it('a genuine staff session (kind undefined) is allowed through to the service', async () => {
    await controller.listForVenue(req({ organizationId: 'org-1', role: 'manager' }), 'venue-1');
    expect(service.listForVenue).toHaveBeenCalledWith('venue-1', 'org-1', undefined);

    await controller.getForOrder(req({ organizationId: 'org-1', role: 'cashier' }), 'order-1');
    expect(service.getForOrder).toHaveBeenCalledWith('order-1', 'org-1', undefined);

    await controller.acknowledge(
      req({ organizationId: 'org-1', id: 'staff-1', role: 'manager' }),
      'proj-1',
      {
        note: 'reviewed',
      },
    );
    expect(service.acknowledge).toHaveBeenCalledWith(
      'proj-1',
      'org-1',
      undefined,
      'staff-1',
      'reviewed',
    );
  });

  it('acknowledge rejects a blank note before ever calling the service', async () => {
    await expect(
      controller.acknowledge(
        req({ organizationId: 'org-1', id: 'staff-1', role: 'manager' }),
        'proj-1',
        { note: '  ' },
      ),
    ).rejects.toThrow(/review note is required/i);
    expect(service.acknowledge).not.toHaveBeenCalled();
  });
});
