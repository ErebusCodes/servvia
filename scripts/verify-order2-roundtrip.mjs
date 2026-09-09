/**
 * Offline round-trip check: does our Order2 serialiser reproduce the packets
 * the venue iPad actually sent, byte for byte?
 *
 * WHY IT LIVES HERE AND NOT IN THE TEST SUITE. The inputs are raw Front
 * evidence — real customer orders and a real device identifier — and raw
 * evidence must stay off Git. So the vectors are read from the ignored
 * evidence tree at run time, and the committed Jest suite uses synthetic
 * fixtures in the same proven shape instead. This script is the thing that
 * proves the shape is right; the suite is the thing that keeps it right.
 *
 * USAGE
 *   node scripts/verify-order2-roundtrip.mjs [vectors.json]
 *
 * Default input:
 *   .tmp-back-evidence/20260909-124209/derived/order2-vectors.json
 * produced by the extractor described in PROVENANCE-2.txt. Each element is
 *   { log, stamp, checksum, body }
 * where `body` is the verbatim packet as the Ideal Handheld listener logged it.
 *
 * EXIT CODES
 *   0  every vector reproduced exactly
 *   1  at least one mismatch (the first few diffs are printed)
 *   2  vectors file missing — this is SKIPPED, not failed, because a clean
 *      checkout has no evidence tree and that is the normal state.
 */

import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const DEFAULT_VECTORS = resolve(
  process.cwd(),
  '.tmp-back-evidence/20260909-124209/derived/order2-vectors.json',
);

const vectorsPath = process.argv[2] ? resolve(process.argv[2]) : DEFAULT_VECTORS;

if (!existsSync(vectorsPath)) {
  console.log(`SKIP: no vectors at ${vectorsPath}`);
  console.log('This is expected on a clean checkout; raw evidence is not committed.');
  process.exit(2);
}

// The serialiser is TypeScript; compile it on the fly via ts-node's register
// hook, which the api workspace already depends on.
const require = createRequire(import.meta.url);
require('ts-node').register({
  transpileOnly: true,
  compilerOptions: { module: 'commonjs', target: 'es2020' },
});
const { serialiseOrder2 } = require(
  resolve(process.cwd(), 'apps/api/src/pos-sync/waiterpad/waiterpad-order2-packet.ts'),
);

const unescapeXml = (s) =>
  s
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&amp;/g, '&');

/**
 * `trim: false` for free-text fields. Descriptions genuinely carry leading and
 * trailing spaces — the client uses leading spaces to mark a modifier line on
 * the kitchen docket — so trimming them silently changes the packet.
 */
const pick = (body, tag, { trim = true } = {}) => {
  const m = body.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
  if (!m) return '';
  const raw = trim ? m[1].trim() : m[1];
  return unescapeXml(raw);
};

/** Rebuild an Order2Packet from a genuine logged body. */
function toPacket(body) {
  const items = body.match(/<OrderItem\b[\s\S]*?<\/OrderItem>/g) ?? [];
  const lines = items.map((it) => {
    const type = pick(it, 'Type');
    const common = {
      description: pick(it, 'Description', { trim: false }),
      seat: Number(pick(it, 'Seat')),
      priceLevel: Number(pick(it, 'PriceLevel')),
    };
    if (type === 'Text') return { kind: 'text', ...common };
    return {
      kind: 'stockItem',
      stockItem: pick(it, 'StockItem'),
      quantity: Number(pick(it, 'Quantity')),
      // Captured packets always carry a real amount, never the sentinel.
      pricing: {
        mode: 'explicit',
        amount: pick(it, 'Price'),
        priceLevel: Number(pick(it, 'PriceLevel')),
      },
      taxString: pick(it, 'TaxString'),
      ...common,
    };
  });
  return {
    map: Number(pick(body, 'Map')),
    location: Number(pick(body, 'Location')),
    posTerminal: pick(body, 'POSTerminal'),
    table: Number(pick(body, 'Table')),
    clerk: pick(body, 'Clerk'),
    guests: Number(pick(body, 'Guests')),
    skipKitchen: pick(body, 'SkipKitchen') === '1',
    kitchenOnly: pick(body, 'KitchenOnly') === '1',
    voidMode: pick(body, 'VoidMode') === 'True',
    total: pick(body, 'Total'),
    device: {
      localAddress: pick(body, 'LocalAddress'),
      deviceId: pick(body, 'DeviceID'),
      pocketPad: pick(body, 'PocketPad'),
      deviceModel: pick(body, 'DeviceModel'),
      deviceOs: pick(body, 'DeviceOS'),
    },
    checksum: pick(body, 'Checksum'),
    lines,
  };
}

function firstDiff(a, b) {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i += 1) {
    if (a[i] !== b[i]) return i;
  }
  return a.length === b.length ? -1 : n;
}

const vectors = JSON.parse(readFileSync(vectorsPath, 'utf8'));
let ok = 0;
const failures = [];

for (const v of vectors) {
  const expected = v.body.replace(/\r\n/g, '\n').trimEnd();
  let actual;
  try {
    actual = serialiseOrder2(toPacket(expected)).trimEnd();
  } catch (err) {
    failures.push({ v, reason: `threw: ${err.message}` });
    continue;
  }
  if (actual === expected) {
    ok += 1;
  } else {
    const i = firstDiff(expected, actual);
    failures.push({
      v,
      reason: `byte ${i}`,
      exp: JSON.stringify(expected.slice(Math.max(0, i - 60), i + 60)),
      act: JSON.stringify(actual.slice(Math.max(0, i - 60), i + 60)),
    });
  }
}

console.log(`Order2 round-trip: ${ok}/${vectors.length} reproduced byte-for-byte`);
for (const f of failures.slice(0, 5)) {
  console.log(`\nFAIL ${f.v.stamp} checksum=${f.v.checksum} (${f.reason})`);
  if (f.exp) {
    console.log(`  expected …${f.exp}`);
    console.log(`  actual   …${f.act}`);
  }
}
if (failures.length > 5) console.log(`\n… and ${failures.length - 5} more`);
process.exit(failures.length === 0 ? 0 : 1);
