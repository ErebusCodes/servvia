/**
 * The pricing invariant for the WaiterPad / native route.
 *
 * THE PRODUCTION ACCEPTANCE REQUIREMENT, restated as code: a dine-in order sent
 * over this route must result in the NATIVE IdealPOS price, never a price
 * Verdura computed.
 *
 * THE MECHANISM WE RELY ON. `IPS.exe` compares the submitted `<Price>` against
 * the constant -9999. On equality it looks the item up and substitutes
 * `StockItems.Price<PriceLevel>` from its own catalogue. On INEQUALITY it
 * branches past the substitution, so any other number becomes the line price
 * verbatim. There is no third behaviour and no warning.
 *
 * That asymmetry is the whole reason this module exists. Sending a price is
 * not a hint the POS may ignore — it is a silent override that would put a
 * Verdura-calculated figure on a customer's bill and into the venue's takings.
 * The failure is invisible at submission time and only shows up in the day's
 * reconciliation.
 *
 * THREE INDEPENDENT GUARDS, because one is not enough for a money invariant:
 *
 *   1. STRUCTURAL — `WaiterPadOrderLine` has no price field. A caller working
 *      in TypeScript cannot express a price.
 *   2. BOUNDARY — `assertNoSuppliedPrice` rejects any object that carries a
 *      price-shaped property, for data arriving as `unknown` from JSON, a
 *      queue, a DTO or a test.
 *   3. OUTPUT — `serialiseOrderPacket` re-reads its own output and refuses to
 *      return a document containing any `<Price>` other than the sentinel.
 *
 * AND ONE THING WE REFUSE TO DO. Nothing here converts a Verdura price into a
 * sentinel "for convenience". Silently dropping a supplied price would hide a
 * caller bug that means someone believed they were setting a price. The right
 * response to a supplied price is a loud refusal.
 */

import { NATIVE_PRICE_SENTINEL } from './waiterpad-evidence';

export class WaiterPadPriceInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WaiterPadPriceInvariantError';
  }
}

/**
 * Property names that would mean "Verdura is setting the price".
 *
 * Deliberately broad, and matched case-insensitively: this list is a net for
 * mistakes, and a false positive costs a caller one rename while a false
 * negative costs a venue money. `priceLevel` is explicitly NOT here — it is a
 * required input that selects which native column resolves the sentinel.
 */
const FORBIDDEN_PRICE_KEYS: readonly string[] = [
  'price',
  'unitprice',
  'unitpricecents',
  'saleamount',
  'saleprice',
  'amount',
  'total',
  'linetotal',
  'extendedprice',
  'cost',
  'pricepaid',
  'expectedunitpricecents',
];

const ALLOWED_PRICE_ADJACENT_KEYS: readonly string[] = ['pricelevel'];

/**
 * Refuse any line object carrying a caller-supplied sale price.
 *
 * Accepts `unknown` on purpose: the dangerous case is untyped data crossing a
 * boundary, which is exactly where the structural guard cannot help.
 */
export function assertNoSuppliedPrice(line: unknown, where = 'line'): void {
  if (line === null || typeof line !== 'object') {
    throw new WaiterPadPriceInvariantError(`${where} must be an object`);
  }
  for (const key of Object.keys(line)) {
    const normalised = key.toLowerCase();
    if (ALLOWED_PRICE_ADJACENT_KEYS.includes(normalised)) continue;
    if (FORBIDDEN_PRICE_KEYS.includes(normalised)) {
      throw new WaiterPadPriceInvariantError(
        `${where} carries a caller-supplied price ('${key}'). WaiterPad submissions ` +
          `must send the sentinel ${NATIVE_PRICE_SENTINEL} so IdealPOS resolves the ` +
          'native price from StockItems.Price<PriceLevel>. A numeric price on this ' +
          'route is a silent override, not a hint.',
      );
    }
  }
}

/**
 * The only price value this route may ever put on the wire.
 *
 * A function rather than a re-export so that every call site reads as a
 * deliberate decision, and so the invariant has one greppable name.
 */
export function wirePriceForNativeResolution(): typeof NATIVE_PRICE_SENTINEL {
  return NATIVE_PRICE_SENTINEL;
}

/**
 * A price we LEARNED from the POS, as distinct from one we chose.
 *
 * The distinction is the point. `resolvedFrom: 'readback'` is the only
 * provenance that means IdealPOS told us the number. There is deliberately no
 * variant for "derived from the submission" or "assumed from the catalogue",
 * because an ACK carries no price and neither does any other response — the
 * six response bodies contain no data at all beyond their type.
 */
export interface NativeResolvedPrice {
  readonly resolvedFrom: 'readback';
  /** As rendered by the POS in the readback, before any parsing to a number. */
  readonly rawValue: string;
  /** Parsed major units (e.g. 1.5 for $1.50). Null when unparseable. */
  readonly value: number | null;
  readonly observedAt: Date;
}

/**
 * Interpret a `<Price>` value from a readback response.
 *
 * Returns `value: null` rather than throwing on an unparseable figure: a price
 * we cannot read is a fact to record and escalate, not a reason to discard the
 * whole readback of a table that may have food on it.
 */
export function nativeResolvedPriceFromReadback(
  rawValue: string,
  observedAt: Date,
): NativeResolvedPrice {
  const trimmed = rawValue.trim();
  const parsed = /^-?\d+(\.\d+)?$/.test(trimmed) ? Number(trimmed) : NaN;
  return {
    resolvedFrom: 'readback',
    rawValue,
    value: Number.isFinite(parsed) ? parsed : null,
    observedAt,
  };
}

/**
 * Did the POS actually resolve the sentinel?
 *
 * A readback still showing -9999 would mean the substitution did not happen —
 * the item was not found, or a code path we have not traced was taken. That is
 * a hard stop, never a rounding detail.
 */
export function readbackPriceLooksUnresolved(price: NativeResolvedPrice): boolean {
  return price.value === NATIVE_PRICE_SENTINEL;
}
