/**
 * Order packet construction — validation, the price invariant, and byte-for-byte
 * determinism.
 */
import { checksumFromObservedEvidence } from './waiterpad-checksum';
import { NATIVE_PRICE_SENTINEL } from './waiterpad-evidence';
import {
  serialiseOrderPacket,
  validateOrderPacket,
  WaiterPadPacketError,
  type WaiterPadOrderLine,
  type WaiterPadOrderPacket,
} from './waiterpad-order-packet';
import { WaiterPadPriceInvariantError } from './waiterpad-price';
import { childNamed, childrenNamed, parseWaiterPadXml } from './waiterpad-xml';

// A checksum admitted only via the observed-evidence door, which is how tests
// are expected to obtain one. No generator exists.
const CHECKSUM = checksumFromObservedEvidence('OBSERVED-TEST-VECTOR-0001');

const line = (over: Partial<WaiterPadOrderLine> = {}): WaiterPadOrderLine => ({
  stockItem: '23',
  description: 'Lemon slice',
  quantity: 1,
  priceLevel: 1,
  ...over,
});

const packet = (over: Partial<WaiterPadOrderPacket> = {}): WaiterPadOrderPacket => ({
  table: 5,
  clerk: '1',
  guests: 0,
  deviceId: 'VERDURA-TEST-DEVICE',
  checksum: CHECKSUM,
  lines: [line()],
  ...over,
});

describe('validateOrderPacket', () => {
  it('accepts a well-formed packet', () => {
    expect(() => validateOrderPacket(packet())).not.toThrow();
  });

  it('refuses table 0, which is not addressable', () => {
    expect(() => validateOrderPacket(packet({ table: 0 }))).toThrow(/not addressable/);
  });

  it('refuses a negative or non-integer table', () => {
    expect(() => validateOrderPacket(packet({ table: -1 }))).toThrow(WaiterPadPacketError);
    expect(() => validateOrderPacket(packet({ table: 5.5 }))).toThrow(/must be an integer/);
  });

  it('refuses an empty line set, because the receiver discards it silently', () => {
    expect(() => validateOrderPacket(packet({ lines: [] }))).toThrow(/silently discards/);
  });

  it('refuses a missing or empty checksum, because the guard would be skipped', () => {
    expect(() =>
      validateOrderPacket(packet({ checksum: '' as unknown as typeof CHECKSUM })),
    ).toThrow(/skip its duplicate guard/);
    expect(() =>
      validateOrderPacket(packet({ checksum: undefined as unknown as typeof CHECKSUM })),
    ).toThrow(/checksum is required/);
  });

  it('refuses an empty clerk, deviceId, stockItem or description', () => {
    expect(() => validateOrderPacket(packet({ clerk: '  ' }))).toThrow(/clerk/);
    expect(() => validateOrderPacket(packet({ deviceId: '' }))).toThrow(/deviceId/);
    expect(() => validateOrderPacket(packet({ lines: [line({ stockItem: '' })] }))).toThrow(
      /stockItem/,
    );
    expect(() => validateOrderPacket(packet({ lines: [line({ description: '' })] }))).toThrow(
      /description/,
    );
  });

  it('refuses control characters, which are a framing hazard', () => {
    expect(() =>
      validateOrderPacket(packet({ lines: [line({ description: 'a\u0000b' })] })),
    ).toThrow(/control characters/);
    expect(() => validateOrderPacket(packet({ lines: [line({ description: 'a\nb' })] }))).toThrow(
      /control characters/,
    );
  });

  it('constrains priceLevel to the native Price<N> columns', () => {
    expect(() => validateOrderPacket(packet({ lines: [line({ priceLevel: 0 })] }))).toThrow(
      /priceLevel/,
    );
    expect(() => validateOrderPacket(packet({ lines: [line({ priceLevel: 7 })] }))).toThrow(
      /priceLevel/,
    );
    expect(() => validateOrderPacket(packet({ lines: [line({ priceLevel: 6 })] }))).not.toThrow();
  });

  it('constrains quantity', () => {
    expect(() => validateOrderPacket(packet({ lines: [line({ quantity: 0 })] }))).toThrow(
      /quantity/,
    );
    expect(() => validateOrderPacket(packet({ lines: [line({ quantity: 1.5 })] }))).toThrow(
      /must be an integer/,
    );
  });
});

describe('the price invariant — the production acceptance requirement', () => {
  it('always emits the -9999 sentinel', () => {
    const xml = serialiseOrderPacket(packet());
    expect(xml).toContain(`<Price>${NATIVE_PRICE_SENTINEL}</Price>`);
    expect(xml).toContain('<Price>-9999</Price>');
  });

  it('emits the sentinel on every line, not just the first', () => {
    const xml = serialiseOrderPacket(
      packet({ lines: [line(), line({ stockItem: '511', description: 'MUHALLEBI' })] }),
    );
    const prices = xml.match(/<Price>[^<]*<\/Price>/g) ?? [];
    expect(prices).toHaveLength(2);
    expect(new Set(prices)).toEqual(new Set(['<Price>-9999</Price>']));
  });

  it.each([
    ['price', 15],
    ['unitPrice', 15],
    ['unitPriceCents', 1500],
    ['saleAmount', 15],
    ['salePrice', 15],
    ['amount', 15],
    ['total', 15],
    ['lineTotal', 15],
    ['extendedPrice', 15],
    ['cost', 15],
    ['pricePaid', 15],
    ['expectedUnitPriceCents', 1500],
  ])('rejects a caller-supplied %s', (key, value) => {
    const rogue = { ...line(), [key]: value };
    expect(() => validateOrderPacket(packet({ lines: [rogue] }))).toThrow(
      WaiterPadPriceInvariantError,
    );
    expect(() => serialiseOrderPacket(packet({ lines: [rogue] }))).toThrow(/silent override/);
  });

  it('rejects a supplied price regardless of casing', () => {
    const rogue = { ...line(), PRICE: 15 } as unknown as WaiterPadOrderLine;
    expect(() => validateOrderPacket(packet({ lines: [rogue] }))).toThrow(
      WaiterPadPriceInvariantError,
    );
  });

  it('rejects even a price that happens to equal the sentinel, so intent stays explicit', () => {
    const rogue = { ...line(), price: NATIVE_PRICE_SENTINEL } as unknown as WaiterPadOrderLine;
    expect(() => validateOrderPacket(packet({ lines: [rogue] }))).toThrow(
      WaiterPadPriceInvariantError,
    );
  });

  it('still allows priceLevel, which is a required native input', () => {
    expect(() => validateOrderPacket(packet({ lines: [line({ priceLevel: 2 })] }))).not.toThrow();
    expect(serialiseOrderPacket(packet({ lines: [line({ priceLevel: 2 })] }))).toContain(
      '<PriceLevel>2</PriceLevel>',
    );
  });
});

describe('serialiseOrderPacket — determinism', () => {
  it('is byte-identical across repeated calls', () => {
    const p = packet({ lines: [line(), line({ stockItem: '511', description: 'MUHALLEBI' })] });
    const runs = Array.from({ length: 50 }, () => serialiseOrderPacket(p));
    expect(new Set(runs).size).toBe(1);
  });

  it('is byte-identical for structurally equal packets built independently', () => {
    expect(serialiseOrderPacket(packet())).toBe(serialiseOrderPacket(packet()));
  });

  it('does not depend on property insertion order of the input objects', () => {
    const a: WaiterPadOrderPacket = {
      table: 5,
      clerk: '1',
      guests: 0,
      deviceId: 'D',
      checksum: CHECKSUM,
      lines: [{ stockItem: '23', description: 'Lemon slice', quantity: 1, priceLevel: 1 }],
    };
    const b: WaiterPadOrderPacket = {
      lines: [{ priceLevel: 1, quantity: 1, description: 'Lemon slice', stockItem: '23' }],
      checksum: CHECKSUM,
      deviceId: 'D',
      guests: 0,
      clerk: '1',
      table: 5,
    };
    expect(serialiseOrderPacket(a)).toBe(serialiseOrderPacket(b));
  });

  it('contains no timestamp, uuid or other varying token', () => {
    const xml = serialiseOrderPacket(packet());
    expect(xml).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(xml).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/i);
  });

  it('matches the golden wire form derived from VariPad', () => {
    expect(serialiseOrderPacket(packet())).toBe(
      [
        `<?xml version='1.0' encoding='utf-8' ?>`,
        '<WPPacket>',
        '  <Order Type="ORDER">',
        '    <Table>5</Table>',
        '    <Clerk>1</Clerk>',
        '    <Guests>0</Guests>',
        '    <DeviceID>VERDURA-TEST-DEVICE</DeviceID>',
        '    <Checksum>OBSERVED-TEST-VECTOR-0001</Checksum>',
        '    <OrderItem Index="">',
        '      <StockItem>23</StockItem>',
        '      <Description>Lemon slice</Description>',
        '      <Quantity>1</Quantity>',
        '      <Price>-9999</Price>',
        '      <Seat>0</Seat>',
        '      <PriceLevel>1</PriceLevel>',
        '    </OrderItem>',
        '  </Order>',
        '</WPPacket>',
      ].join('\n'),
    );
  });

  it('emits an Instruction line only when one was supplied', () => {
    expect(serialiseOrderPacket(packet())).not.toContain('<Instruction>');
    expect(serialiseOrderPacket(packet({ lines: [line({ instruction: 'NO ICE' })] }))).toContain(
      '      <Instruction>NO ICE</Instruction>',
    );
  });

  it('escapes text so a hostile description cannot inject elements', () => {
    const xml = serialiseOrderPacket(
      packet({ lines: [line({ description: `</Description><StockItem>999` })] }),
    );
    const root = parseWaiterPadXml(xml);
    const order = childNamed(root, 'Order')!;
    const items = childrenNamed(order, 'OrderItem');
    expect(items).toHaveLength(1);
    expect(childrenNamed(items[0], 'StockItem')).toHaveLength(1);
    expect(childNamed(items[0], 'StockItem')!.text).toBe('23');
  });

  it('produces a document our own reader accepts', () => {
    const root = parseWaiterPadXml(serialiseOrderPacket(packet()));
    expect(root.name).toBe('WPPacket');
    expect(childNamed(root, 'Order')?.attributes.Type).toBe('ORDER');
  });
});
