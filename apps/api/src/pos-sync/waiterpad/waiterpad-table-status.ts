/**
 * REQUESTTABLESTATUS — the native readback, and the field it does not have.
 *
 * WHY THIS MATTERS MORE THAN ITS SIZE SUGGESTS. It is the only WaiterPad verb
 * that reads rather than writes, the only place a native RESOLVED price is
 * ever visible to us, and therefore the only foundation available for
 * recovering from an ambiguous submission. Every response body on the order
 * path is a bare type with no data in it.
 *
 * THE MISSING FIELD, AND WHAT IT COSTS. The builder emits exactly seven
 * elements per line: Index, StockItem, Description, Quantity, Price,
 * SeatNumber, PriceLevel. It does NOT emit `OrderedTime`, and `OrderedTime` is
 * the only field the live Table 5 capture found that partitions a sale's lines
 * into the rounds that produced them. It does not emit `Printed` either.
 *
 * So a readback answers "what is on this table now" and can never answer
 * "which round put it there". Two rounds that ordered the same item are
 * indistinguishable in this response. That is not a limitation to work around
 * with a heuristic — it is the reason reconciliation policy is unimplemented
 * in `waiterpad-round-state.ts`.
 *
 * PURE. Builds a request string and parses a response string. Sends nothing.
 * Nothing in this module may be transmitted tonight.
 */

import { nativeResolvedPriceFromReadback, type NativeResolvedPrice } from './waiterpad-price';
import {
  childNamed,
  childrenNamed,
  escapeXmlText,
  parseWaiterPadXml,
  WaiterPadXmlError,
  type XmlElement,
} from './waiterpad-xml';

export class WaiterPadTableStatusError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WaiterPadTableStatusError';
  }
}

/**
 * Build a REQUESTTABLESTATUS request.
 *
 * Returns a string. It is the caller's responsibility — gated, and not
 * available tonight — to ever put it on a wire.
 */
export function serialiseTableStatusRequest(params: {
  readonly table: number;
  readonly deviceId: string;
}): string {
  if (!Number.isInteger(params.table) || params.table < 1) {
    throw new WaiterPadTableStatusError('table must be a positive integer');
  }
  if (typeof params.deviceId !== 'string' || params.deviceId.trim() === '') {
    throw new WaiterPadTableStatusError('deviceId must be a non-empty string');
  }
  return [
    `<?xml version='1.0' encoding='utf-8' ?>`,
    '<WPPacket>',
    `  <WPType>REQUESTTABLESTATUS</WPType>`,
    `  <Table>${params.table}</Table>`,
    `  <DeviceID>${escapeXmlText(params.deviceId)}</DeviceID>`,
    '</WPPacket>',
  ].join('\n');
}

/** One line as the POS reports it. Field-for-field with the builder's output. */
export interface NativeTableLine {
  /** The line ordinal the POS reports. The only per-line handle that exists. */
  readonly index: string;
  readonly stockItem: string;
  readonly description: string;
  readonly quantity: string;
  /** The RESOLVED native price — the acceptance evidence we actually need. */
  readonly price: NativeResolvedPrice;
  readonly seatNumber: string;
  readonly priceLevel: string;
}

/**
 * A table's line set as read back.
 *
 * `roundIdentityAvailable` is a literal `false` rather than a comment, so that
 * any future code trying to partition rounds from a readback has to confront
 * the type rather than a docstring.
 */
export interface NativeTableStatus {
  readonly table: number;
  readonly lines: readonly NativeTableLine[];
  readonly observedAt: Date;
  /**
   * Always false. The response carries no OrderedTime and no Printed flag, so
   * lines cannot be attributed to the round that created them.
   */
  readonly roundIdentityAvailable: false;
  /** Fields the contract proves are absent, named so callers cannot look for them. */
  readonly absentFields: readonly ['OrderedTime', 'Printed'];
}

export type TableStatusParse =
  | { readonly ok: true; readonly status: NativeTableStatus }
  | {
      readonly ok: false;
      readonly reason: 'not_xml' | 'wrong_root' | 'malformed_line';
      readonly detail: string;
    };

function requiredChildText(el: XmlElement, name: string): string {
  const child = childNamed(el, name);
  if (!child) {
    throw new WaiterPadTableStatusError(`<OrderItem> is missing <${name}>`);
  }
  return child.text;
}

/**
 * Parse a REQUESTTABLESTATUS response.
 *
 * Fail-closed on a malformed line rather than skipping it: a readback missing
 * one line silently would understate what is on a table, and understating is
 * the direction that causes a duplicate submission.
 */
export function parseTableStatusResponse(input: string, observedAt: Date): TableStatusParse {
  let root: XmlElement;
  try {
    root = parseWaiterPadXml(input);
  } catch (err) {
    return {
      ok: false,
      reason: 'not_xml',
      detail: err instanceof WaiterPadXmlError ? err.message : 'unparseable document',
    };
  }

  if (root.name !== 'WPPacket') {
    return { ok: false, reason: 'wrong_root', detail: `root element was '${root.name}'` };
  }

  // The order elements may sit at the root or under a container; accept either
  // rather than asserting a nesting we have not observed a real response for.
  const containers: XmlElement[] = [root, ...root.children.filter((c) => c.name !== 'OrderItem')];
  const itemElements: XmlElement[] = [];
  for (const container of containers) {
    itemElements.push(...childrenNamed(container, 'OrderItem'));
  }

  const tableText =
    childNamed(root, 'Table')?.text ??
    root.children.map((c) => childNamed(c, 'Table')?.text).find((t) => t !== undefined) ??
    '';
  const table = /^\d+$/.test(tableText.trim()) ? Number(tableText.trim()) : NaN;
  if (!Number.isInteger(table)) {
    return { ok: false, reason: 'malformed_line', detail: `unreadable <Table>: '${tableText}'` };
  }

  const lines: NativeTableLine[] = [];
  try {
    for (const item of itemElements) {
      lines.push({
        index: item.attributes['Index'] ?? requiredChildText(item, 'Index'),
        stockItem: requiredChildText(item, 'StockItem').trim(),
        description: requiredChildText(item, 'Description').trim(),
        quantity: requiredChildText(item, 'Quantity').trim(),
        price: nativeResolvedPriceFromReadback(requiredChildText(item, 'Price'), observedAt),
        seatNumber: requiredChildText(item, 'SeatNumber').trim(),
        priceLevel: requiredChildText(item, 'PriceLevel').trim(),
      });
    }
  } catch (err) {
    return {
      ok: false,
      reason: 'malformed_line',
      detail: err instanceof Error ? err.message : 'malformed <OrderItem>',
    };
  }

  return {
    ok: true,
    status: {
      table,
      lines,
      observedAt,
      roundIdentityAvailable: false,
      absentFields: ['OrderedTime', 'Printed'],
    },
  };
}
