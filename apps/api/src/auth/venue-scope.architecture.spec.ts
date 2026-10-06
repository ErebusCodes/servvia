import { TabletTokenActiveGuard } from './guards/tablet-token-active.guard';
import { TabletDeviceGuard } from '../tablet/guards/tablet-device.guard';
import { ManagerStepUpGuard } from '../tablet/guards/manager-step-up.guard';
import { VenueAccessGuard } from './venue-access/venue-access.guard';
import {
  ORGANIZATION_SCOPE_KEY,
  VENUE_SCOPE_KEY,
  VenueScopeSource,
} from './venue-access/venue-scope.decorator';
import { jwtRoutes } from './route-inventory.testing-spec';

/**
 * Story 2.10 (SEC-16.3, PRD section 16 item 3): staff act only in venues
 * they have been granted, in the Nest API as in Core. Every route that
 * accepts a JWT states where its venue comes from (@VenueScope) or that it
 * acts on organization-level data (@OrganizationScope, with a reason), and
 * runs VenueAccessGuard after every other guard, so a new route cannot
 * reach venue data on organization membership alone.
 */
describe('venue scope of every JWT route (Story 2.10)', () => {
  const routes = jwtRoutes();

  it('finds the JWT routes it is meant to check', () => {
    expect(routes.length).toBeGreaterThan(50);
  });

  it('every JWT route runs VenueAccessGuard', () => {
    expect(routes.filter((r) => !r.guards.includes(VenueAccessGuard)).map((r) => r.route)).toEqual(
      [],
    );
  });

  it('every JWT route declares its venue or why it has none', () => {
    const undeclared = routes
      .filter((r) => r.meta(VENUE_SCOPE_KEY) === undefined && !r.meta(ORGANIZATION_SCOPE_KEY))
      .map((r) => r.route);
    expect(undeclared).toEqual([]);
  });

  it('checks venue access only after the device re-check, as Core does', () => {
    const misordered = routes
      .filter((r) => {
        const venue = r.guards.indexOf(VenueAccessGuard);
        return [TabletTokenActiveGuard, TabletDeviceGuard, ManagerStepUpGuard].some(
          (guard) => r.guards.includes(guard) && r.guards.indexOf(guard) > venue,
        );
      })
      .map((r) => r.route);
    expect(misordered).toEqual([]);
  });

  it('keeps the organization-level routes to the reviewed list', () => {
    const organizationLevel = routes
      .filter((r) => r.meta(VENUE_SCOPE_KEY) === undefined)
      .map((r) => r.route.split('.')[0])
      .filter((controller, i, all) => all.indexOf(controller) === i)
      .sort();
    expect(organizationLevel).toEqual([
      'CategoriesController',
      'MediaController',
      'MenuItemsController',
      'PosCatalogController',
      'StaffController',
      'TabletAuthController',
      'VenuesController',
    ]);
  });

  it('scopes the routes that reach a venue, its orders and its devices', () => {
    const scoped = new Map(
      routes.map((r) => [r.route, r.meta(VENUE_SCOPE_KEY) as VenueScopeSource | undefined]),
    );
    expect(scoped.get('VenuesController.getTaxConfig')).toEqual({ param: 'id' });
    expect(scoped.get('VenuesController.findAll')).toEqual({ list: true });
    expect(scoped.get('OrdersController.findAll')).toEqual({ query: 'venueId', optional: true });
    expect(scoped.get('OrdersController.createStaffOrder')).toEqual({ body: 'venueId' });
    expect(scoped.get('OrdersController.updateStatus')).toEqual({ resource: 'order' });
    expect(scoped.get('TablesController.findAll')).toEqual({ param: 'venueId' });
    expect(scoped.get('ConnectorAdminController.createEnrollment')).toEqual({ param: 'venueId' });
    expect(scoped.get('TabletOrdersController.createRestrictedOrder')).toEqual({ token: true });
  });
});
