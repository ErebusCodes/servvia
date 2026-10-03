import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';
import { allRoutes } from './route-inventory.testing-spec';

/**
 * Story 2.4 (NFR-SEC-1, NFR-AUD): administrators sign in by name. The shared
 * Admin Console PIN, which minted an owner/admin session for whoever knew it,
 * is removed, and must not come back through code, configuration or the
 * contracts that Go Core is built against.
 */
const SRC = join(__dirname, '..');
const CONTRACTS = join(__dirname, '..', '..', '..', '..', 'contracts');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return name.endsWith('.ts') && !name.endsWith('spec.ts') ? [path] : [];
  });
}

describe('no shared admin PIN (Story 2.4)', () => {
  it('serves no PIN sign-in route', () => {
    const pinRoutes = allRoutes()
      .filter((r) => /admin-?pin/i.test(r.path))
      .map((r) => `${r.route} ${r.path}`);
    expect(pinRoutes).toEqual([]);
    expect(allRoutes().map((r) => r.path)).toEqual(
      expect.arrayContaining(['auth/login', 'auth/credential-setup']),
    );
  });

  it('reads the old configuration only to refuse it', () => {
    const readers = sourceFiles(SRC)
      .filter((file) => /ADMIN_CONSOLE_(PIN|EMAIL)/.test(readFileSync(file, 'utf8')))
      .map((file) => relative(SRC, file));
    expect(readers).toEqual([join('config', 'environment.validation.ts')]);
  });

  it('documents no PIN sign-in and no PIN-issued token in the contracts', () => {
    const openapi = readFileSync(join(CONTRACTS, 'openapi', 'identity-and-devices.yaml'), 'utf8');
    expect(openapi).not.toMatch(/^\s{2}\/auth\/admin-pin:/m);
    expect(openapi).not.toMatch(/AdminPinLoginRequest/);
    expect(openapi).toMatch(/^\s{2}\/auth\/credential-setup:/m);

    const claims = JSON.parse(
      readFileSync(join(CONTRACTS, 'schemas', 'auth-token-claims.schema.json'), 'utf8'),
    ) as unknown;
    const issuers = JSON.stringify(claims).match(/"x-issued-by":\[[^\]]*\]/g) ?? [];
    expect(issuers.join(' ')).not.toMatch(/admin-pin/);
  });
});
