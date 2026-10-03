import { readdirSync, statSync } from 'fs';
import { join } from 'path';
import { GUARDS_METADATA, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { StaffSessionOnlyGuard } from './guards/staff-session-only.guard';
import { TabletTokenActiveGuard } from './guards/tablet-token-active.guard';
import { TabletDeviceGuard } from '../tablet/guards/tablet-device.guard';
import { ManagerStepUpGuard } from '../tablet/guards/manager-step-up.guard';

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

function controllerFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return controllerFiles(path);
    return name.endsWith('.controller.ts') ? [path] : [];
  });
}

interface Route {
  route: string;
  guards: unknown[];
}

function jwtRoutes(): Route[] {
  const routes: Route[] = [];
  for (const file of controllerFiles(join(__dirname, '..'))) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const exported = require(file) as Record<string, unknown>;
    for (const candidate of Object.values(exported)) {
      if (typeof candidate !== 'function') continue;
      const controller = candidate as new (...args: unknown[]) => unknown;
      if (Reflect.getMetadata(PATH_METADATA, controller) === undefined) continue;
      const classGuards = (Reflect.getMetadata(GUARDS_METADATA, controller) ?? []) as unknown[];
      const prototype = controller.prototype as Record<string, unknown>;
      for (const name of Object.getOwnPropertyNames(prototype)) {
        const handler = prototype[name];
        if (name === 'constructor' || typeof handler !== 'function') continue;
        if (Reflect.getMetadata(METHOD_METADATA, handler) === undefined) continue;
        const guards = [
          ...classGuards,
          ...((Reflect.getMetadata(GUARDS_METADATA, handler) ?? []) as unknown[]),
        ];
        if (guards.includes(JwtAuthGuard)) {
          routes.push({ route: `${controller.name}.${name}`, guards });
        }
      }
    }
  }
  return routes;
}

describe('token scope of every JWT route (Story 2.9)', () => {
  const routes = jwtRoutes();

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
