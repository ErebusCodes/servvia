import { ForbiddenException } from '@nestjs/common';
import { PaymentObservationFixtureInjectionController } from './payment-observation-fixture-injection.controller';

describe('PaymentObservationFixtureInjectionController (production fail-closed gate)', () => {
  let service: any;

  beforeEach(() => {
    service = {
      recordObservation: jest.fn().mockResolvedValue({ outcome: 'applied', eventId: 'evt-1' }),
    };
  });

  function controllerWithNodeEnv(nodeEnv: string | undefined) {
    const config = { get: jest.fn().mockReturnValue(nodeEnv) };
    return new PaymentObservationFixtureInjectionController(service, config as any);
  }

  it('rejects every call in production, before touching the service', async () => {
    const controller = controllerWithNodeEnv('production');
    await expect(
      controller.injectObservation(
        { user: { organizationId: 'org-1', role: 'admin' } } as any,
        'order-1',
        { schemaVersion: 1, observationId: 'obs-1', state: 'paid' },
      ),
    ).rejects.toThrow(ForbiddenException);
    expect(service.recordObservation).not.toHaveBeenCalled();
  });

  it('allows the call through in a non-production environment (development/test)', async () => {
    const controller = controllerWithNodeEnv('test');
    await controller.injectObservation(
      { user: { organizationId: 'org-1', role: 'admin' } } as any,
      'order-1',
      { schemaVersion: 1, observationId: 'obs-1', state: 'paid' },
    );
    expect(service.recordObservation).toHaveBeenCalledTimes(1);
  });

  it('rejects a device-kind identity even with an admin-shaped role claim', async () => {
    const controller = controllerWithNodeEnv('test');
    await expect(
      controller.injectObservation(
        { user: { organizationId: 'org-1', role: 'admin', kind: 'tablet_manager' } } as any,
        'order-1',
        { schemaVersion: 1, observationId: 'obs-1', state: 'paid' },
      ),
    ).rejects.toThrow(ForbiddenException);
    expect(service.recordObservation).not.toHaveBeenCalled();
  });
});
