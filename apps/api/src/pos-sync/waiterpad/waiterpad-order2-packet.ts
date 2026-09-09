/**
 * The `Order2` packet — the wire form the LIVE handheld actually sends.
 *
 * WHY THIS FILE EXISTS SEPARATELY FROM `waiterpad-order-packet.ts`.
 *
 * That module builds `<Order Type="ORDER">` from `VariPad.dll`'s
 * `ImportVariPadOrderFile`. On 2026-09-09 Front's own listener log showed 42
 * genuine packets from the venue iPad, and they are NOT that shape. VariPad is
 * a FILE IMPORT format; the socket protocol is a different, larger envelope.
 * The differences are not cosmetic — five of them would each be rejected or
 * silently misread:
 *
 *   | thing          | VariPad builder      | live Order2                    |
 *   |----------------|----------------------|--------------------------------|
 *   | Order Type     | `"ORDER"`            | `"Order2"`                     |
 *   | Index attr     | `Index=""`           | `Index="0"` on EVERY item      |
 *   | Price          | sentinel `-9999`     | a REAL price, e.g. `18.00`     |
 *   | PriceLevel     | required 1..6        | always `0` (builder REJECTS 0) |
 *   | item `<Type>`  | absent               | `StockItem` or `Text`          |
 *   | `<TaxString>`  | absent               | present, but ONLY on StockItem |
 *   | modifiers      | `<Instruction>` child| a SIBLING `Type=Text` item     |
 *   | 15 header tags | absent               | Map..DeviceOS, fixed order     |
 *
 * The old module is left untouched and unused rather than edited, because it
 * remains an accurate record of the VariPad file format and something may still
 * import it. Nothing here changes it.
 *
 * PURE. This module builds a string. It opens nothing and sends nothing.
 * The route is still gated shut; see `waiterpad-gate.ts`.
 *
 * EVIDENCE. `LIVE_ORDER2_PACKET_EVIDENCE`, and the derived structural summary
 * in `ORDER2_CANONICAL_SHAPE` below. Field order, the `Index="0"` constant, the
 * TaxString-only-on-StockItem rule and the self-closing `<SalesCaption />` were
 * each confirmed identical across all 42 packets / 412 items.
 */

import { escapeXmlText } from './waiterpad-xml';

export class WaiterPadOrder2Error extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WaiterPadOrder2Error';
  }
}

/**
 * The canonical shape, recorded as data so tests can assert against it rather
 * than against a hand-copied literal.
 *
 * `headerOrder` is the exact emission order observed in every genuine packet.
 * The receiver's tolerance to a DIFFERENT order is NOT SHOWN, so we reproduce
 * it exactly rather than assume XML element order is free.
 */
export const ORDER2_CANONICAL_SHAPE = {
  orderType: 'Order2',
  xmlDeclaration: '<?xml version="1.0" encoding="UTF-8" ?>',
  itemIndexAttribute: '0',
  headerOrder: [
    'Map',
    'Location',
    'POSTerminal',
    'Table',
    'Clerk',
    'Guests',
    'SkipKitchen',
    'KitchenOnly',
    'VoidMode',
    'Total',
    'CashAmount',
    'PointsAmount',
    'SalesCaption',
    'PrintReceipt',
    'LocalAddress',
    'DeviceID',
    'PocketPad',
    'DeviceModel',
    'DeviceOS',
    'Checksum',
  ],
  stockItemFieldOrder: [
    'Type',
    'StockItem',
    'Description',
    'Quantity',
    'Price',
    'Seat',
    'PriceLevel',
    'TaxString',
  ],
  /** A Text line carries no TaxString. Confirmed: 314 StockItem, 314 TaxString. */
  textFieldOrder: ['Type', 'StockItem', 'Description', 'Quantity', 'Price', 'Seat', 'PriceLevel'],
  /** The literal `<StockItem>` a Text line carries. */
  textStockItemPlaceholder: '#',
} as const;

/** Identity the device asserts on every packet. All five were constant. */
export interface WaiterPadDeviceIdentity {
  readonly localAddress: string;
  readonly deviceId: string;
  readonly pocketPad: string;
  readonly deviceModel: string;
  readonly deviceOs: string;
}

/**
 * A sold line.
 *
 * `price` IS REQUIRED AND IS A DECIMAL STRING. This is the uncomfortable part
 * of the real protocol and it is deliberately not smoothed over: the genuine
 * client sends a real money amount, formatted to two decimal places, and there
 * is no sentinel anywhere in 412 observed items. Whether the receiver TRUSTS
 * this value or re-resolves it from `StockItems` is NOT SHOWN — see
 * `WAITERPAD-PRICE-001`. A caller that guesses wrong mis-charges a customer,
 * so the type makes the caller state the amount explicitly rather than letting
 * a default slip through.
 */
export interface Order2StockLine {
  readonly kind: 'stockItem';
  readonly stockItem: string;
  readonly description: string;
  readonly quantity: number;
  /** Decimal string, exactly 2dp, e.g. `"18.00"`. Not a number: see above. */
  readonly price: string;
  /** Constant 0 in all 412 observed items. Non-zero is UNVERIFIED. */
  readonly seat?: number;
  /** Constant 0 in all 412 observed items. */
  readonly priceLevel?: number;
  /** Constant "1" in all 314 observed StockItem lines. */
  readonly taxString?: string;
}

/**
 * A free-text / kitchen-instruction line.
 *
 * This is how the real protocol expresses a modifier: not as a child of the
 * item it modifies, but as the NEXT SIBLING item, with `Quantity` 0 and
 * `Price` `0.00`. Order is therefore load-bearing — the kitchen docket indents
 * a Text line under the StockItem line above it.
 */
export interface Order2TextLine {
  readonly kind: 'text';
  readonly description: string;
  readonly seat?: number;
  readonly priceLevel?: number;
}

export type Order2Line = Order2StockLine | Order2TextLine;

export interface Order2Packet {
  readonly map: number;
  readonly location: number;
  readonly posTerminal: string;
  readonly table: number;
  readonly clerk: string;
  readonly guests: number;
  readonly skipKitchen: boolean;
  readonly kitchenOnly: boolean;
  readonly voidMode: boolean;
  /** Decimal string. The client sends a trimmed value, e.g. `75`, `40.5`. */
  readonly total: string;
  readonly device: WaiterPadDeviceIdentity;
  /**
   * The duplicate-guard value, as a decimal string (it is a signed 32-bit
   * integer on the wire and both signs occur).
   *
   * `null` means "emit `<Checksum></Checksum>` empty". That is a REAL and
   * DANGEROUS option: the receiver skips `IsDuplicateHandheldOrder2` entirely
   * when the node is empty, so an empty checksum removes the only receiver-side
   * replay protection there is. It is representable because the algorithm is
   * unknown (`WAITERPAD-CHECKSUM-001`) and pretending otherwise would be worse,
   * but `assertOrder2ReplaySafe` refuses it.
   */
  readonly checksum: string | null;
  readonly lines: readonly Order2Line[];
}

const LIMITS = {
  maxTable: 9999,
  maxLines: 200,
  maxQuantity: 999,
  maxTextLength: 200,
} as const;

const DECIMAL_2DP = /^\d+\.\d{2}$/;
const DECIMAL_LOOSE = /^\d+(\.\d{1,2})?$/;
const INT32 = /^-?\d{1,10}$/;

function text(value: unknown, field: string, allowEmpty = false): string {
  if (typeof value !== 'string') {
    throw new WaiterPadOrder2Error(`${field} must be a string`);
  }
  if (!allowEmpty && value.trim() === '') {
    throw new WaiterPadOrder2Error(`${field} must not be empty`);
  }
  if (value.length > LIMITS.maxTextLength) {
    throw new WaiterPadOrder2Error(`${field} exceeds ${LIMITS.maxTextLength} characters`);
  }
  // The receiver scans a byte stream for '</WPPacket>' and parses on socket-read
  // boundaries, so a stray control character is a framing hazard, not cosmetic.
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) {
      throw new WaiterPadOrder2Error(`${field} contains control characters`);
    }
  }
  return value;
}

function int(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new WaiterPadOrder2Error(`${field} must be an integer`);
  }
  return value;
}

/** Validate completely before serialising. Callers get a refusal, never a repair. */
export function validateOrder2(packet: Order2Packet): void {
  const table = int(packet.table, 'table');
  if (table < 1 || table > LIMITS.maxTable) {
    throw new WaiterPadOrder2Error(
      `table must be between 1 and ${LIMITS.maxTable}; table 0 is not addressable`,
    );
  }

  int(packet.map, 'map');
  int(packet.location, 'location');
  text(packet.posTerminal, 'posTerminal');
  text(packet.clerk, 'clerk');

  const guests = int(packet.guests, 'guests');
  if (guests < 0) throw new WaiterPadOrder2Error('guests must not be negative');

  if (!DECIMAL_LOOSE.test(packet.total)) {
    throw new WaiterPadOrder2Error(
      `total must be a non-negative decimal string, got ${packet.total}`,
    );
  }

  text(packet.device?.localAddress, 'device.localAddress');
  text(packet.device?.deviceId, 'device.deviceId');
  text(packet.device?.pocketPad, 'device.pocketPad');
  text(packet.device?.deviceModel, 'device.deviceModel');
  text(packet.device?.deviceOs, 'device.deviceOs');

  if (packet.checksum !== null && !INT32.test(packet.checksum)) {
    throw new WaiterPadOrder2Error(
      'checksum must be a signed decimal integer string, or null to emit an empty node',
    );
  }

  // The runtime guard is deliberately applied to the raw property rather than
  // to `lines`: narrowing a `readonly Order2Line[]` through `Array.isArray`
  // widens its ELEMENTS to `any`, which silently disables every type check in
  // the loop below.
  if (!Array.isArray(packet.lines)) {
    throw new WaiterPadOrder2Error('lines must be an array');
  }
  const lines: readonly Order2Line[] = packet.lines;
  if (lines.length === 0) {
    throw new WaiterPadOrder2Error('an order must carry at least one line');
  }
  if (lines.length > LIMITS.maxLines) {
    throw new WaiterPadOrder2Error(`an order may not carry more than ${LIMITS.maxLines} lines`);
  }

  lines.forEach((line: Order2Line, idx: number) => {
    const where = `lines[${idx}]`;
    if (line.kind === 'stockItem') {
      text(line.stockItem, `${where}.stockItem`);
      text(line.description, `${where}.description`);
      const qty = int(line.quantity, `${where}.quantity`);
      if (qty < 1 || qty > LIMITS.maxQuantity) {
        throw new WaiterPadOrder2Error(
          `${where}.quantity must be between 1 and ${LIMITS.maxQuantity}`,
        );
      }
      if (!DECIMAL_2DP.test(line.price)) {
        throw new WaiterPadOrder2Error(
          `${where}.price must be a 2dp decimal string such as "18.00", got ${String(line.price)}`,
        );
      }
    } else if (line.kind === 'text') {
      text(line.description, `${where}.description`);
    } else {
      throw new WaiterPadOrder2Error(`${where}.kind must be 'stockItem' or 'text'`);
    }

    if (line.seat !== undefined) {
      const seat = int(line.seat, `${where}.seat`);
      if (seat < 0) throw new WaiterPadOrder2Error(`${where}.seat must not be negative`);
    }
    if (line.priceLevel !== undefined) {
      const pl = int(line.priceLevel, `${where}.priceLevel`);
      if (pl < 0) throw new WaiterPadOrder2Error(`${where}.priceLevel must not be negative`);
    }
  });

  // A Text line first has nothing to attach to. The kitchen docket renders a
  // Text line indented UNDER the StockItem above it, so a leading Text line
  // would print as a modifier of nothing.
  if (lines[0].kind === 'text') {
    throw new WaiterPadOrder2Error(
      'an order may not begin with a text line: text lines render as modifiers ' +
        'of the stock item that precedes them',
    );
  }
}

/**
 * Refuse to send anything whose replay behaviour we cannot reason about.
 *
 * Separate from `validateOrder2` because it is a POLICY gate, not a format one:
 * the packet below is perfectly well-formed and the receiver would take it.
 */
export function assertOrder2ReplaySafe(packet: Order2Packet): void {
  if (packet.checksum === null) {
    throw new WaiterPadOrder2Error(
      'refusing an Order2 with an empty <Checksum>: the receiver skips ' +
        'IsDuplicateHandheldOrder2 entirely when the node is empty, which ' +
        'removes the only receiver-side replay protection. See ' +
        'WAITERPAD-CHECKSUM-001.',
    );
  }
}

const IND_PACKET = '      ';
const IND_ORDER = '        ';
const IND_FIELD = '          ';
const IND_ITEM_FIELD = '                                ';
const IND_ITEM_CLOSE = '                            ';

/**
 * Serialise to the exact wire form the venue iPad emits.
 *
 * DETERMINISTIC: fixed element order, fixed indentation, no timestamps, no ids,
 * no locale-sensitive number formatting (every numeric field is already a
 * validated integer or a checked decimal STRING, so `toFixed`/`toLocaleString`
 * never run and a comma decimal separator cannot appear).
 *
 * The odd indentation is not a style choice — it reproduces the client's own
 * output, which the round-trip test asserts byte-for-byte against real packets.
 */
export function serialiseOrder2(packet: Order2Packet): string {
  validateOrder2(packet);

  const bool = (b: boolean): string => (b ? 'True' : 'False');
  const f = (name: string, value: string): string => `${IND_FIELD}<${name}>${value}</${name}>`;
  const esc = escapeXmlText;

  const out: string[] = [];
  out.push(ORDER2_CANONICAL_SHAPE.xmlDeclaration);
  out.push(`${IND_PACKET}<WPPacket>`);
  out.push(`${IND_ORDER}<Order Type="${ORDER2_CANONICAL_SHAPE.orderType}">`);
  out.push(f('Map', String(packet.map)));
  out.push(f('Location', String(packet.location)));
  out.push(f('POSTerminal', esc(packet.posTerminal)));
  out.push(f('Table', String(packet.table)));
  out.push(f('Clerk', esc(packet.clerk)));
  out.push(f('Guests', String(packet.guests)));
  out.push(f('SkipKitchen', packet.skipKitchen ? '1' : '0'));
  out.push(f('KitchenOnly', packet.kitchenOnly ? '1' : '0'));
  out.push(f('VoidMode', bool(packet.voidMode)));
  out.push(f('Total', packet.total));
  out.push(f('CashAmount', '0'));
  out.push(f('PointsAmount', '0'));
  // Self-closing with a leading space, exactly as observed in all 42 packets.
  out.push(`${IND_FIELD}<SalesCaption />`);
  out.push(f('PrintReceipt', 'False'));
  out.push(f('LocalAddress', esc(packet.device.localAddress)));
  out.push(f('DeviceID', esc(packet.device.deviceId)));
  out.push(f('PocketPad', esc(packet.device.pocketPad)));
  out.push(f('DeviceModel', esc(packet.device.deviceModel)));
  out.push(f('DeviceOS', esc(packet.device.deviceOs)));
  out.push(f('Checksum', packet.checksum ?? ''));

  // Items. The client opens the FIRST item on its own line and then runs each
  // subsequent `</OrderItem><OrderItem ...>` together without a line break.
  const idx = ORDER2_CANONICAL_SHAPE.itemIndexAttribute;
  const chunks: string[] = [];
  for (const line of packet.lines) {
    const body: string[] = [];
    const isStock = line.kind === 'stockItem';
    body.push(`${IND_ITEM_FIELD}<Type>${isStock ? 'StockItem' : 'Text'}</Type>`);
    body.push(
      `${IND_ITEM_FIELD}<StockItem>${
        isStock ? esc(line.stockItem) : ORDER2_CANONICAL_SHAPE.textStockItemPlaceholder
      }</StockItem>`,
    );
    body.push(`${IND_ITEM_FIELD}<Description>${esc(line.description)}</Description>`);
    body.push(`${IND_ITEM_FIELD}<Quantity>${isStock ? line.quantity : 0}</Quantity>`);
    body.push(`${IND_ITEM_FIELD}<Price>${isStock ? line.price : '0.00'}</Price>`);
    body.push(`${IND_ITEM_FIELD}<Seat>${line.seat ?? 0}</Seat>`);
    body.push(`${IND_ITEM_FIELD}<PriceLevel>${line.priceLevel ?? 0}</PriceLevel>`);
    if (isStock) {
      const ts = line.taxString ?? '1';
      body.push(`${IND_ITEM_FIELD}<TaxString>${esc(ts)}</TaxString>`);
    } else {
      // A Text line carries no <TaxString>, but the client still emits the
      // INDENT for the slot — a whitespace-only line — before closing the item.
      // Reproduced exactly: the receiver parses on socket-read boundaries and
      // we do not get to assume it is whitespace-insensitive.
      body.push(IND_ITEM_FIELD);
    }
    chunks.push(`<OrderItem Index="${idx}">\n${body.join('\n')}\n${IND_ITEM_CLOSE}</OrderItem>`);
  }
  out.push(`${IND_FIELD}${chunks.join('')}`);

  out.push(`${IND_ORDER}</Order>`);
  out.push(`${IND_PACKET}</WPPacket>`);
  return out.join('\n');
}
