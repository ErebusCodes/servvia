/**
 * The WaiterPad ORDER packet — construction and deterministic serialisation.
 *
 * PURE. This module builds a string. It opens nothing, sends nothing, and
 * imports nothing that can.
 *
 * PROVENANCE OF THE ENVELOPE. The element set and their order are taken from
 * `VariPad.dll`'s `ImportVariPadOrderFile`, which is first-party Idealpos code
 * that EMITS this exact packet — the strongest available specification of the
 * request shape, because it is the vendor's own writer rather than our reading
 * of the vendor's reader. Cross-checked against the elements `IPS.exe` is
 * observed to dereference while parsing an order.
 *
 * THE PRICE RULE, MADE STRUCTURAL. `<Price>` is always the sentinel -9999, and
 * `WaiterPadOrderLine` has no price field at all — a caller cannot supply one
 * because there is nowhere to put it. The runtime guards in
 * `waiterpad-price.ts` exist for the boundary where untyped data arrives.
 * Together: unrepresentable in the type system, rejected at the boundary,
 * asserted at serialisation.
 */

import { NATIVE_PRICE_SENTINEL } from './waiterpad-evidence';
import { assertNoSuppliedPrice } from './waiterpad-price';
import type { WaiterPadChecksum } from './waiterpad-checksum';
import { escapeXmlText } from './waiterpad-xml';

export class WaiterPadPacketError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WaiterPadPacketError';
  }
}

/**
 * One line of an order.
 *
 * NOTE WHAT IS ABSENT AND WHY:
 *
 * `price` — deliberately not a field. See the module comment.
 *
 * `seat` — `VariPad` emits `<Seat>`, but no read of it was observed on the
 * receiver's order path, so it is emitted with the vendor's own constant and
 * is not caller-controllable. Making it settable would imply we know it works.
 *
 * `index` — `VariPad` always emits `Index=""`. Whether the receiver reads the
 * attribute is NOT SHOWN, so we reproduce the vendor's behaviour exactly
 * rather than inventing an ordinal.
 */
export interface WaiterPadOrderLine {
  /** The native PLU / stock code. Non-empty; the receiver looks it up. */
  readonly stockItem: string;
  /** Whole units. The receiver's handling of values above 1 is NOT SHOWN. */
  readonly quantity: number;
  /** Human-readable description carried alongside the PLU. */
  readonly description: string;
  /**
   * Selects which native price column resolves the sentinel:
   * `StockItems.Price<priceLevel>`. This is the ONLY pricing input we supply.
   */
  readonly priceLevel: number;
  /**
   * An instruction or condiment line. The protocol expresses modifiers as
   * sibling lines rather than as fields, so this rides on its own line.
   */
  readonly instruction?: string;
}

export interface WaiterPadOrderPacket {
  /** Bare table number. Table 0 is not addressable. */
  readonly table: number;
  /** Native clerk code. */
  readonly clerk: string;
  /** Covers. The receiver falls back to DefaultCovers; VariPad always sends 0. */
  readonly guests: number;
  /** Stable device identity. Also the key of the receiver's duplicate guard. */
  readonly deviceId: string;
  /**
   * The duplicate-guard value. Optional ON THE WIRE — an absent or empty
   * checksum makes the receiver skip the guard entirely — but this codec
   * requires one, because sending without it silently discards our only
   * replay protection. Obtaining one is currently impossible by design; see
   * `waiterpad-checksum.ts`.
   */
  readonly checksum: WaiterPadChecksum;
  readonly lines: readonly WaiterPadOrderLine[];
}

/** Upper bounds chosen to be obviously safe rather than protocol-derived. */
const LIMITS = {
  maxTable: 9999,
  maxLines: 200,
  maxQuantity: 999,
  maxPriceLevel: 6,
  maxTextLength: 200,
} as const;

function requireInteger(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new WaiterPadPacketError(`${field} must be an integer`);
  }
  return value;
}

function requireText(value: unknown, field: string, allowEmpty = false): string {
  if (typeof value !== 'string') {
    throw new WaiterPadPacketError(`${field} must be a string`);
  }
  if (!allowEmpty && value.trim() === '') {
    throw new WaiterPadPacketError(`${field} must not be empty`);
  }
  if (value.length > LIMITS.maxTextLength) {
    throw new WaiterPadPacketError(`${field} exceeds ${LIMITS.maxTextLength} characters`);
  }
  // Control characters have no meaning here and are a framing hazard: the
  // receiver scans a byte stream for '</WPPacket>'.
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(value)) {
    throw new WaiterPadPacketError(`${field} contains control characters`);
  }
  return value;
}

/**
 * Validate a packet completely, before anything is serialised.
 *
 * Throws on the first problem. Callers get a refusal, never a repaired packet:
 * quietly fixing a malformed order is how a wrong thing reaches a kitchen.
 */
export function validateOrderPacket(packet: WaiterPadOrderPacket): void {
  const table = requireInteger(packet.table, 'table');
  if (table < 1 || table > LIMITS.maxTable) {
    throw new WaiterPadPacketError(
      `table must be between 1 and ${LIMITS.maxTable}; table 0 is not addressable`,
    );
  }

  requireText(packet.clerk, 'clerk');
  requireText(packet.deviceId, 'deviceId');

  const guests = requireInteger(packet.guests, 'guests');
  if (guests < 0) throw new WaiterPadPacketError('guests must not be negative');

  if (typeof packet.checksum !== 'string' || packet.checksum.length === 0) {
    throw new WaiterPadPacketError(
      'checksum is required: an absent or empty <Checksum> makes the receiver ' +
        'skip its duplicate guard entirely',
    );
  }

  const lines: readonly WaiterPadOrderLine[] = packet.lines;
  if (!Array.isArray(lines) || lines.length === 0) {
    // The receiver silently DISCARDS an ORDER with no <OrderItem, which would
    // be indistinguishable from acceptance at the wire.
    throw new WaiterPadPacketError(
      'an order must carry at least one line; the receiver silently discards ' +
        'an ORDER packet containing no items',
    );
  }
  if (lines.length > LIMITS.maxLines) {
    throw new WaiterPadPacketError(`an order may not carry more than ${LIMITS.maxLines} lines`);
  }

  lines.forEach((line: WaiterPadOrderLine, idx: number) => {
    const where = `lines[${idx}]`;
    assertNoSuppliedPrice(line, where);

    requireText(line.stockItem, `${where}.stockItem`);
    requireText(line.description, `${where}.description`);

    const qty = requireInteger(line.quantity, `${where}.quantity`);
    if (qty < 1 || qty > LIMITS.maxQuantity) {
      throw new WaiterPadPacketError(
        `${where}.quantity must be between 1 and ${LIMITS.maxQuantity}`,
      );
    }

    const level = requireInteger(line.priceLevel, `${where}.priceLevel`);
    if (level < 1 || level > LIMITS.maxPriceLevel) {
      throw new WaiterPadPacketError(
        `${where}.priceLevel must be between 1 and ${LIMITS.maxPriceLevel}; it selects ` +
          'the native StockItems.Price<N> column',
      );
    }

    if (line.instruction !== undefined) {
      requireText(line.instruction, `${where}.instruction`);
    }
  });
}

/**
 * Serialise to the wire form.
 *
 * DETERMINISTIC BY CONSTRUCTION: fixed element order, fixed indentation, no
 * timestamps, no ids, no map iteration, no locale-sensitive formatting. The
 * same packet always produces byte-identical output — which is what makes a
 * checksum over the body meaningful, and what makes golden-file tests possible.
 *
 * Numbers are rendered with `String(n)` over validated integers, so there is no
 * decimal-separator exposure. (The receiver's own parse is culture-sensitive;
 * emitting only integers keeps us clear of it.)
 */
export function serialiseOrderPacket(packet: WaiterPadOrderPacket): string {
  validateOrderPacket(packet);

  const t = (name: string, value: string): string =>
    `      <${name}>${escapeXmlText(value)}</${name}>`;

  const lines: string[] = [];
  lines.push(`<?xml version='1.0' encoding='utf-8' ?>`);
  lines.push('<WPPacket>');
  lines.push(`  <Order Type="ORDER">`);
  lines.push(`    <Table>${packet.table}</Table>`);
  lines.push(`    <Clerk>${escapeXmlText(packet.clerk)}</Clerk>`);
  lines.push(`    <Guests>${packet.guests}</Guests>`);
  lines.push(`    <DeviceID>${escapeXmlText(packet.deviceId)}</DeviceID>`);
  lines.push(`    <Checksum>${escapeXmlText(packet.checksum)}</Checksum>`);

  for (const line of packet.lines) {
    // `Index=""` reproduces VariPad exactly; see WaiterPadOrderLine.
    lines.push(`    <OrderItem Index="">`);
    lines.push(t('StockItem', line.stockItem));
    lines.push(t('Description', line.description));
    lines.push(`      <Quantity>${line.quantity}</Quantity>`);
    // The sentinel, always. Never a Verdura-computed price.
    lines.push(`      <Price>${NATIVE_PRICE_SENTINEL}</Price>`);
    lines.push(`      <Seat>0</Seat>`);
    lines.push(`      <PriceLevel>${line.priceLevel}</PriceLevel>`);
    if (line.instruction !== undefined) {
      lines.push(t('Instruction', line.instruction));
    }
    lines.push(`    </OrderItem>`);
  }

  lines.push(`  </Order>`);
  lines.push('</WPPacket>');

  const out = lines.join('\n');

  // Belt and braces. If any future edit ever puts another number in a <Price>,
  // this fails loudly at the last possible moment rather than on a till.
  const prices = out.match(/<Price>([^<]*)<\/Price>/g) ?? [];
  for (const p of prices) {
    if (p !== `<Price>${NATIVE_PRICE_SENTINEL}</Price>`) {
      throw new WaiterPadPacketError(
        `serialisation produced a non-sentinel price (${p}); WaiterPad submissions ` +
          'must let IdealPOS resolve the native price',
      );
    }
  }
  return out;
}
