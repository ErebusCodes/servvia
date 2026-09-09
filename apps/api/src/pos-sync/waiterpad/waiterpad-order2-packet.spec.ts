/**
 * Order2 codec tests.
 *
 * THE FIXTURES ARE SYNTHETIC ON PURPOSE. The shape below was derived from 42
 * genuine packets in Front's `Ideal Handheld` log, but those packets are real
 * customer orders carrying a real device identifier, and raw evidence stays off
 * Git. So the values here are invented and the STRUCTURE is the assertion.
 *
 * The real packets are checked separately and byte-for-byte by
 * `scripts/verify-order2-roundtrip.mjs`, which reads the ignored evidence tree
 * and reported 42/42 on 2026-09-09. That script proves the shape is right; this
 * suite stops it drifting.
 */
import {
  assertOrder2ReplaySafe,
  NATIVE_PRICE_SENTINEL_TEXT,
  ORDER2_CANONICAL_SHAPE,
  serialiseOrder2,
  validateOrder2,
  WaiterPadOrder2Error,
  type Order2Line,
  type Order2Packet,
} from './waiterpad-order2-packet';

const DEVICE = {
  localAddress: '10.0.0.9',
  deviceId: 'TESTDEVICE0000000000000000000000',
  pocketPad: 'Version 9.9.99',
  deviceModel: 'Test Tablet',
  deviceOs: 'TestOS 1.0',
};

const stock = (over: Partial<Extract<Order2Line, { kind: 'stockItem' }>> = {}) =>
  ({
    kind: 'stockItem' as const,
    stockItem: '219',
    description: 'TEST ITEM',
    quantity: 1,
    pricing: { mode: 'explicit', amount: '18.00' },
    ...over,
  }) as Order2Line;

const packet = (over: Partial<Order2Packet> = {}): Order2Packet => ({
  map: 1,
  location: 1,
  posTerminal: '901',
  table: 10,
  clerk: '108',
  guests: 0,
  skipKitchen: false,
  kitchenOnly: false,
  voidMode: false,
  total: '18',
  device: DEVICE,
  checksum: '1024185259',
  lines: [stock()],
  ...over,
});

describe('the canonical Order2 shape', () => {
  it('is Order2, not the VariPad ORDER file format', () => {
    expect(ORDER2_CANONICAL_SHAPE.orderType).toBe('Order2');
    expect(serialiseOrder2(packet())).toContain('<Order Type="Order2">');
  });

  it('emits the twenty header fields in the observed order', () => {
    const xml = serialiseOrder2(packet());
    const seen = ORDER2_CANONICAL_SHAPE.headerOrder.map((t) =>
      xml.indexOf(`<${t}>`) >= 0 ? xml.indexOf(`<${t}>`) : xml.indexOf(`<${t} `),
    );
    expect(seen.every((i) => i >= 0)).toBe(true);
    expect([...seen].sort((a, b) => a - b)).toEqual(seen);
  });

  it('uses the double-quoted UTF-8 declaration the client sends', () => {
    expect(serialiseOrder2(packet()).split('\n')[0]).toBe(
      '<?xml version="1.0" encoding="UTF-8" ?>',
    );
  });

  it('stamps Index="0" on every item, and never enumerates', () => {
    const xml = serialiseOrder2(
      packet({ lines: [stock(), stock({ stockItem: '251' }), stock({ stockItem: '249' })] }),
    );
    expect(xml.match(/<OrderItem Index="0">/g)).toHaveLength(3);
    expect(xml).not.toContain('Index="1"');
  });

  it('self-closes SalesCaption with the leading space', () => {
    expect(serialiseOrder2(packet())).toContain('<SalesCaption />');
  });
});

describe('item lines', () => {
  it('gives a StockItem line a TaxString, defaulting to 1', () => {
    const xml = serialiseOrder2(packet());
    expect(xml).toContain('<Type>StockItem</Type>');
    expect(xml).toContain('<TaxString>1</TaxString>');
  });

  it('gives a Text line no TaxString, but keeps the indent slot', () => {
    const xml = serialiseOrder2(
      packet({ lines: [stock(), { kind: 'text', description: 'Fries on the side' }] }),
    );
    const textItem = xml.split('<OrderItem Index="0">')[2];
    expect(textItem).toContain('<Type>Text</Type>');
    expect(textItem).not.toContain('TaxString');
    // PriceLevel, then a whitespace-only line, then the close.
    expect(textItem).toMatch(/<PriceLevel>0<\/PriceLevel>\n {32}\n {28}<\/OrderItem>/);
  });

  it('sends a Text line as StockItem "#", quantity 0, price 0.00', () => {
    const xml = serialiseOrder2(
      packet({ lines: [stock(), { kind: 'text', description: 'no onions' }] }),
    );
    expect(xml).toContain('<StockItem>#</StockItem>');
    expect(xml).toContain('<Quantity>0</Quantity>');
    expect(xml).toContain('<Price>0.00</Price>');
  });

  it('defaults Seat and PriceLevel to 0, as every observed item had', () => {
    const xml = serialiseOrder2(packet());
    expect(xml).toContain('<Seat>0</Seat>');
    expect(xml).toContain('<PriceLevel>0</PriceLevel>');
  });

  it('preserves leading whitespace in a description, which marks a modifier', () => {
    const xml = serialiseOrder2(packet({ lines: [stock({ description: '   WITH HASHEW' })] }));
    expect(xml).toContain('<Description>   WITH HASHEW</Description>');
  });

  it('escapes XML the way the client does', () => {
    const xml = serialiseOrder2(
      packet({ lines: [stock({ description: "Emerson's Hazed & Confused" })] }),
    );
    expect(xml).toContain('<Description>Emerson&apos;s Hazed &amp; Confused</Description>');
  });
});

describe('pricing is an explicit choice, never a default', () => {
  it('requires a 2dp decimal string in explicit mode', () => {
    const p = (amount: string) =>
      packet({ lines: [stock({ pricing: { mode: 'explicit', amount } })] });
    expect(() => validateOrder2(p('18'))).toThrow(/2dp decimal string/);
    expect(() => validateOrder2(p('18.5'))).toThrow();
    expect(() => validateOrder2(p('18.00'))).not.toThrow();
  });

  it('carries an explicit amount through verbatim, and the till believes it', () => {
    const xml = serialiseOrder2(
      packet({ lines: [stock({ pricing: { mode: 'explicit', amount: '27.50' } })] }),
    );
    expect(xml).toContain('<Price>27.50</Price>');
    expect(xml).not.toContain('-9999');
  });

  // The receiver compares the incoming price against -9999.0 (0x474698) with
  // __vbaFpCmpCy and, only on equality, re-reads it from StockItems."Price"&N.
  it('emits the -9999 sentinel in nativeResolved mode', () => {
    const xml = serialiseOrder2(
      packet({ lines: [stock({ pricing: { mode: 'nativeResolved', priceLevel: 1 } })] }),
    );
    expect(xml).toContain(`<Price>${NATIVE_PRICE_SENTINEL_TEXT}</Price>`);
    expect(xml).toContain('<PriceLevel>1</PriceLevel>');
  });

  it('requires a price level of 1..6 in nativeResolved mode, because it is a column name', () => {
    const at = (priceLevel: number) =>
      packet({ lines: [stock({ pricing: { mode: 'nativeResolved', priceLevel } })] });
    expect(() => validateOrder2(at(0))).toThrow(/Price0 is not a column/);
    expect(() => validateOrder2(at(7))).toThrow(/between 1 and 6/);
    expect(() => validateOrder2(at(1))).not.toThrow();
    expect(() => validateOrder2(at(6))).not.toThrow();
  });

  it('refuses the sentinel smuggled in as an explicit amount', () => {
    expect(() =>
      validateOrder2(
        packet({ lines: [stock({ pricing: { mode: 'explicit', amount: '-9999' } })] }),
      ),
    ).toThrow();
  });

  it('keeps PriceLevel 0 in explicit mode, reproducing the venue iPad', () => {
    const xml = serialiseOrder2(
      packet({ lines: [stock({ pricing: { mode: 'explicit', amount: '3.00' } })] }),
    );
    expect(xml).toContain('<PriceLevel>0</PriceLevel>');
  });
});

describe('refusals', () => {
  it('refuses table 0, which is not addressable', () => {
    expect(() => validateOrder2(packet({ table: 0 }))).toThrow(/not addressable/);
  });

  it('refuses an empty order', () => {
    expect(() => validateOrder2(packet({ lines: [] }))).toThrow(/at least one line/);
  });

  it('refuses an order that begins with a text line', () => {
    expect(() =>
      validateOrder2(packet({ lines: [{ kind: 'text', description: 'orphan' }] })),
    ).toThrow(/may not begin with a text line/);
  });

  it('refuses control characters, which are a framing hazard', () => {
    // Built rather than typed, so no control byte sits in this source file.
    const withNul = `a${String.fromCharCode(0)}b`;
    expect(() => validateOrder2(packet({ lines: [stock({ description: withNul })] }))).toThrow(
      /control characters/,
    );
    const withDel = `a${String.fromCharCode(0x7f)}b`;
    expect(() => validateOrder2(packet({ lines: [stock({ description: withDel })] }))).toThrow(
      /control characters/,
    );
  });

  // The receiver string-compares the token and imposes no format. Our only
  // constraint is that it cannot terminate the SQL literal it is interpolated
  // into, so quotes and control characters are refused and letters are not.
  it('refuses a checksum that could break out of the receiver SQL literal', () => {
    expect(() => validateOrder2(packet({ checksum: "a'b" }))).toThrow(/unescaped/);
    expect(() => validateOrder2(packet({ checksum: 'a;b' }))).toThrow();
    expect(() => validateOrder2(packet({ checksum: '' }))).toThrow();
  });

  it('accepts a negative integer, as the venue iPad sends', () => {
    expect(() => validateOrder2(packet({ checksum: '-1395186882' }))).not.toThrow();
  });

  it('accepts an opaque hex token, as Verdura sends', () => {
    expect(() =>
      validateOrder2(packet({ checksum: '0123456789abcdef0123456789abcdef' })),
    ).not.toThrow();
  });
});

describe('the replay gate is separate from the format gate', () => {
  it('lets a null checksum SERIALISE, because the wire allows it', () => {
    const xml = serialiseOrder2(packet({ checksum: null }));
    expect(xml).toContain('<Checksum></Checksum>');
  });

  it('but refuses to call it replay-safe', () => {
    expect(() => assertOrder2ReplaySafe(packet({ checksum: null }))).toThrow(WaiterPadOrder2Error);
    expect(() => assertOrder2ReplaySafe(packet({ checksum: null }))).toThrow(
      /WAITERPAD-CHECKSUM-001/,
    );
  });

  it('accepts a packet that carries one', () => {
    expect(() => assertOrder2ReplaySafe(packet())).not.toThrow();
  });
});

describe('determinism', () => {
  it('produces byte-identical output for the same input', () => {
    const p = packet({
      lines: [
        stock(),
        { kind: 'text', description: '  extra sauce' },
        stock({ pricing: { mode: 'explicit', amount: '3.00' } }),
      ],
    });
    expect(serialiseOrder2(p)).toBe(serialiseOrder2(p));
  });
});
