/**
 * Architecture guard for the temporary legacy external-POS boundary.
 *
 * Canonical order code may reach IdealPOS only through
 * `legacy-external-pos/`. A direct import from `pos-sync/` or `connector/`
 * would put external-POS transport decisions back into order creation, which
 * is the coupling ADR 0001 removes.
 */
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

const ORDERS_DIR = join(__dirname, '..', 'orders');
const FORBIDDEN = [/from '\.\.\/pos-sync\//, /from '\.\.\/connector\//];

function productionSources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return productionSources(path);
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts') ? [path] : [];
  });
}

describe('legacy external-POS boundary', () => {
  it('orders/ production code does not import pos-sync/ or connector/', () => {
    const offenders = productionSources(ORDERS_DIR).flatMap((file) =>
      readFileSync(file, 'utf8')
        .split('\n')
        .filter((line) => FORBIDDEN.some((pattern) => pattern.test(line)))
        .map((line) => `${file.slice(ORDERS_DIR.length + 1)}: ${line.trim()}`),
    );

    expect(offenders).toEqual([]);
  });
});
