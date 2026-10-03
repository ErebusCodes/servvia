import { basename } from 'path';
import { StaffSessionOnlyGuard } from './guards/staff-session-only.guard';
import { TabletTokenActiveGuard } from './guards/tablet-token-active.guard';
import { TabletDeviceGuard } from '../tablet/guards/tablet-device.guard';
import { ManagerStepUpGuard } from '../tablet/guards/manager-step-up.guard';
import {
  controllerSourceFiles,
  filesUsingPassportGuardDirectly,
  jwtRoutes,
} from './route-inventory.testing-spec';

/**
 * Story 2.9 (SEC-16.1, least privilege): every route that accepts a signed
 * JWT states which credentials it is for. Either it is administration, open
 * only to a genuine staff login session (StaffSessionOnlyGuard), or it is
 * meant for devices too and re-checks the device (TabletTokenActiveGuard,
 * TabletDeviceGuard, ManagerStepUpGuard). A route with neither would let a
 * PIN-elevated tablet, or a KDS screen, use whatever its role claim allows,
 * with no device revocation check: the gap this story closed on ten
 * administration controllers and the venue and table writes. A new
 * controller cannot reopen it silently.
 */
const DEVICE_SCOPE_GUARDS = [TabletTokenActiveGuard, TabletDeviceGuard, ManagerStepUpGuard];

describe('token scope of every JWT route (Story 2.9)', () => {
  const routes = jwtRoutes();

  it('sees every controller: each lives in a *.controller.ts file', () => {
    const misnamed = controllerSourceFiles().filter((f) => !basename(f).endsWith('.controller.ts'));
    expect(misnamed).toEqual([]);
  });

  it('every route authenticating a JWT does so through JwtAuthGuard', () => {
    expect(filesUsingPassportGuardDirectly()).toEqual([]);
  });

  it('finds the JWT routes it is meant to check', () => {
    expect(routes.length).toBeGreaterThan(50);
    expect(routes.map((r) => r.route)).toEqual(
      expect.arrayContaining(['StaffController.create', 'OrdersController.updateStatus']),
    );
  });

  it('every JWT route is either staff-session-only or re-checks the device', () => {
    const unscoped = routes
      .filter(
        (r) =>
          !r.guards.includes(StaffSessionOnlyGuard) &&
          !DEVICE_SCOPE_GUARDS.some((guard) => r.guards.includes(guard)),
      )
      .map((r) => r.route);
    expect(unscoped).toEqual([]);
  });

  it('closes the administration routes a PIN-elevated tablet could reach', () => {
    const staffOnly = new Set(
      routes.filter((r) => r.guards.includes(StaffSessionOnlyGuard)).map((r) => r.route),
    );
    for (const route of [
      'MenuItemsController.create',
      'CategoriesController.create',
      'MediaAssetsController.requestUpload',
      'ConnectorAdminController.createEnrollment',
      'VenuesController.update',
      'VenuesController.remove',
      'TablesController.create',
      'TablesController.remove',
    ]) {
      expect(staffOnly).toContain(route);
    }
  });
});
