import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';
import { GUARDS_METADATA, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { JwtAuthGuard } from './guards/jwt-auth.guard';

/**
 * Test-only inventory of the API's HTTP routes, read from Nest's own
 * metadata, shared by the architecture tests that hold every JWT route to a
 * rule (token-scope, venue-scope). Not a `.spec.ts` file, so Jest does not
 * run it on its own; excluded from the build like every spec.
 */
const SRC = join(__dirname, '..');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return name.endsWith('.ts') && !name.endsWith('spec.ts') ? [path] : [];
  });
}

/** Source files declaring a controller, whatever they are named. */
export function controllerSourceFiles(): string[] {
  return sourceFiles(SRC).filter((file) => /@Controller\(/.test(readFileSync(file, 'utf8')));
}

/** Source files that authenticate a JWT some other way than JwtAuthGuard. */
export function filesUsingPassportGuardDirectly(): string[] {
  return sourceFiles(SRC)
    .filter((file) => /AuthGuard\(\s*['"]jwt['"]\s*\)/.test(readFileSync(file, 'utf8')))
    .map((file) => relative(SRC, file))
    .filter((file) => file !== join('auth', 'guards', 'jwt-auth.guard.ts'));
}

export interface Route {
  route: string;
  guards: unknown[];
  /** Metadata by key, the handler's own taking precedence over its class's. */
  meta: (key: string) => unknown;
}

function handlerNames(controller: new (...args: unknown[]) => unknown): Map<string, unknown> {
  // Walk the prototype chain, so a handler inherited from a base class is
  // checked too; the most derived definition wins.
  const handlers = new Map<string, unknown>();
  let prototype = controller.prototype as Record<string, unknown> | null;
  while (prototype && prototype !== Object.prototype) {
    for (const name of Object.getOwnPropertyNames(prototype)) {
      if (name === 'constructor' || handlers.has(name)) continue;
      const handler = prototype[name];
      if (typeof handler === 'function') handlers.set(name, handler);
    }
    prototype = Object.getPrototypeOf(prototype) as Record<string, unknown> | null;
  }
  return handlers;
}

export function allRoutes(): Route[] {
  const routes: Route[] = [];
  for (const file of controllerSourceFiles()) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const exported = require(file) as Record<string, unknown>;
    for (const candidate of Object.values(exported)) {
      if (typeof candidate !== 'function') continue;
      const controller = candidate as new (...args: unknown[]) => unknown;
      if (Reflect.getMetadata(PATH_METADATA, controller) === undefined) continue;
      const classGuards = (Reflect.getMetadata(GUARDS_METADATA, controller) ?? []) as unknown[];
      for (const [name, handler] of handlerNames(controller)) {
        if (Reflect.getMetadata(METHOD_METADATA, handler as object) === undefined) continue;
        routes.push({
          route: `${controller.name}.${name}`,
          guards: [
            ...classGuards,
            ...((Reflect.getMetadata(GUARDS_METADATA, handler as object) ?? []) as unknown[]),
          ],
          meta: (key): unknown =>
            (Reflect.getMetadata(key, handler as object) as unknown) ??
            (Reflect.getMetadata(key, controller) as unknown),
        });
      }
    }
  }
  return routes;
}

export function jwtRoutes(): Route[] {
  return allRoutes().filter((r) => r.guards.includes(JwtAuthGuard));
}
