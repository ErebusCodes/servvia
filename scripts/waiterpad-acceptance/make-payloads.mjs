/**
 * Generate the two acceptance-test payloads through the real codec.
 *
 * The order payload is built by `serialiseOrder2`, not by a literal, so the
 * bytes on the wire are the bytes the application would send. That is the
 * point of the exercise: a hand-written literal would prove nothing about the
 * codec.
 *
 * Usage: node scripts/waiterpad-acceptance/make-payloads.mjs <outDir>
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';

const outDir = process.argv[2];
if (!outDir) {
  console.error('usage: node make-payloads.mjs <outDir>');
  process.exit(2);
}
mkdirSync(outDir, { recursive: true });

const require = createRequire(import.meta.url);
require('ts-node').register({
  transpileOnly: true,
  compilerOptions: { module: 'commonjs', target: 'es2020' },
});
const { serialiseOrder2 } = require(
  resolve(process.cwd(), 'apps/api/src/pos-sync/waiterpad/waiterpad-order2-packet.ts'),
);

/** Back's address. The receiver logs it but does not appear to route on it. */
const LOCAL_ADDRESS = '192.168.1.250';
/**
 * Verdura's own identity. Deliberately NOT the venue iPad's DeviceID and NOT
 * the phantom `undefined`: borrowing either would bypass the licence gate the
 * till uses to protect itself, and would produce evidence that does not
 * describe production. Verdura needs its own seat either way.
 */
const DEVICE_ID = 'VERDURA-ACCEPT-20260909-0001';

const test = [
  '<?xml version="1.0" encoding="UTF-8" ?>',
  '                        <WPPacket>',
  '                            <Command Type="Test">',
  `                                <LocalAddress>${LOCAL_ADDRESS}</LocalAddress>`,
  `                                <DeviceID>${DEVICE_ID}</DeviceID>`,
  '                                <MachineDescription />',
  '                                <WPType>Protocol2</WPType>',
  '                                <Table>0</Table>',
  '                                <RootMenuCode></RootMenuCode>',
  '                            </Command>',
  '                        </WPPacket>',
].join('\n');

const orderCommon = {
  map: 1,
  location: 1,
  posTerminal: '901',
  // Table 99 so no real customer's bill can be touched.
  table: 99,
  clerk: '108',
  guests: 0,
  // 1 so the kitchen does not fire if this lands. UNOBSERVED in all 42 genuine
  // packets, which are always 0 — whether it is honoured is part of the test.
  skipKitchen: true,
  kitchenOnly: false,
  voidMode: false,
  total: '3',
  device: {
    localAddress: LOCAL_ADDRESS,
    deviceId: DEVICE_ID,
    pocketPad: 'Verdura 0.1.0',
    deviceModel: 'Verdura Back',
    deviceOs: 'Windows',
  },
  // Non-empty so the receiver does NOT skip IsDuplicateHandheldOrder2. The
  // value is not a real vendor checksum — the algorithm is unknown
  // (WAITERPAD-CHECKSUM-001) — but an empty node would disable the guard.
  checksum: '1',
};

const item = (pricing) => ({
  kind: 'stockItem',
  stockItem: '251',
  description: 'Coke No Sugar  -- can 330ml',
  quantity: 1,
  pricing,
});

/**
 * THE PRODUCTION PATH. `-9999` makes the receiver resolve the price from
 * StockItems.Price1 rather than believing us, which is what keeps "Verdura
 * never sets a price" true against the real wire format. Static analysis says
 * it is honoured; step J of the runbook is where that becomes a live fact.
 */
const order = serialiseOrder2({
  ...orderCommon,
  lines: [item({ mode: 'nativeResolved', priceLevel: 1 })],
});

/** The iPad's path, for comparison only. The till takes this amount verbatim. */
const orderExplicit = serialiseOrder2({
  ...orderCommon,
  lines: [item({ mode: 'explicit', amount: '3.00' })],
});

writeFileSync(join(outDir, 'test.payload'), test, 'utf8');
writeFileSync(join(outDir, 'order.payload'), order, 'utf8');
writeFileSync(join(outDir, 'order-explicit.payload'), orderExplicit, 'utf8');
console.log(`test.payload           ${Buffer.byteLength(test)} bytes`);
console.log(`order.payload          ${Buffer.byteLength(order)} bytes  (sentinel -9999)`);
console.log(`order-explicit.payload ${Buffer.byteLength(orderExplicit)} bytes  (explicit 3.00)`);
console.log(`
-> ${outDir}`);
