// Story 15-4 — Order Tablet provisional billing calculation.
//
// This is the single deterministic calculation boundary for the tablet's
// cart/table/seat totals. It replaces the previous component-local
// arithmetic that computed in floating-point dollars and fabricated a 10%
// "service charge" while additively double-counting GST on an already
// GST-inclusive price (see docs/decisions-log.md DL-072).
//
// Governing rules (DL-072):
//   - Menu prices at the single supported venue (NZ, NZD, NZ_GST,
//     pricesIncludeTax=true) are GST-inclusive. The payable total is the
//     sum of GST-inclusive item/modifier prices, less any valid discount —
//     GST is never added on top.
//   - The GST *contained* within a GST-inclusive amount is disclosed as
//     `amount * 3 / 23` (the standard NZ 15%-rate extraction formula). This
//     is disclosure information only and must never be added to the total.
//   - This remains Verdura's *provisional* figure until story 15-5 obtains
//     Idealpos's authoritative total.
//
// Scope boundary: this module does not implement or authorize a promotion
// system (that remains E15-S3's scope) — it only computes correct,
// non-negative arithmetic around whatever discount input the caller
// supplies. It does not implement a multi-jurisdiction tax engine —
// `isSupportedTaxProfile` exists specifically so callers can fail safely
// instead of silently applying NZ GST rules to an incompatible venue.

export interface TaxProfile {
  currency: string;
  taxJurisdiction: string;
  pricesIncludeTax: boolean;
}

/**
 * The only venue tax configuration this module's arithmetic is correct
 * for. Matches the NZ venue defaults established by story 15-1 (DL-072):
 * `Venue.currency`/`taxJurisdiction`/`pricesIncludeTax`.
 */
export const SUPPORTED_TAX_PROFILE: TaxProfile = {
  currency: 'NZD',
  taxJurisdiction: 'NZ_GST',
  pricesIncludeTax: true,
};

export function isSupportedTaxProfile(profile: TaxProfile | null | undefined): boolean {
  if (!profile) return false;
  return (
    profile.currency === SUPPORTED_TAX_PROFILE.currency &&
    profile.taxJurisdiction === SUPPORTED_TAX_PROFILE.taxJurisdiction &&
    profile.pricesIncludeTax === SUPPORTED_TAX_PROFILE.pricesIncludeTax
  );
}

/** NZ 15%-rate GST-inclusive extraction: contained GST = gross × 3 / 23 (DL-072). */
const GST_NUMERATOR = 3;
const GST_DENOMINATOR = 23;

/**
 * Converts a dollar amount (as used throughout the existing tablet cart
 * state — `TabletCartItem.unit`/`mods[].delta`) to integer cents, rounding
 * once at this boundary so no float drift accumulates across later integer
 * arithmetic.
 */
export function dollarsToCents(dollars: number): number {
  if (!Number.isFinite(dollars)) return 0;
  return Math.round(dollars * 100);
}

export function centsToDollars(cents: number): number {
  return cents / 100;
}

export function formatCents(cents: number): string {
  return '$' + (cents / 100).toFixed(2);
}

/** Contained GST of a GST-inclusive amount, for disclosure only — never added to the amount. */
export function containedGstCents(grossCents: number): number {
  if (!Number.isFinite(grossCents) || grossCents <= 0) return 0;
  return Math.round((grossCents * GST_NUMERATOR) / GST_DENOMINATOR);
}

export interface BillingLine {
  /** 0 = shared/table-level line, 1..N = seat number. */
  seat: number;
  /** Base unit price in dollars (pre-existing TabletCartItem.unit convention). */
  unitDollars: number;
  /** Per-modifier price deltas in dollars (pre-existing TabletCartItem.mods[].delta convention). */
  modifierDeltaDollars: number[];
  qty: number;
}

export function lineUnitCents(line: BillingLine): number {
  const modDeltaCents = line.modifierDeltaDollars.reduce((sum, d) => sum + dollarsToCents(d), 0);
  return dollarsToCents(line.unitDollars) + modDeltaCents;
}

export function lineTotalCents(line: BillingLine): number {
  return lineUnitCents(line) * Math.max(0, Math.trunc(line.qty) || 0);
}

export type DiscountInput =
  | { kind: 'none' }
  | { kind: 'percent'; percent: number };

export const NO_DISCOUNT: DiscountInput = { kind: 'none' };

export interface SeatBreakdown {
  seat: number;
  subtotalCents: number;
  discountCents: number;
  payableCents: number;
  containedGstCents: number;
}

export interface CartTotals {
  subtotalCents: number;
  discountCents: number;
  /** Provisional payable total — GST-inclusive, GST not added on top. */
  payableCents: number;
  /** GST already contained within payableCents — disclosure only. */
  containedGstCents: number;
  seatBreakdown: SeatBreakdown[];
}

/**
 * Apportions an already-rounded `total` across `weights` (proportional
 * shares) as whole cents that sum EXACTLY to `total` — the largest-remainder
 * method. Each share's naive independently-rounded figure can over/undershoot
 * the table-level rounded total by a cent or two when summed; this
 * reconciles seat-level figures against the table-level one deterministically
 * (ties broken by input order) rather than leaving an unexplained penny gap.
 */
export function allocateByLargestRemainder(weights: number[], total: number): number[] {
  const n = weights.length;
  if (n === 0) return [];
  const weightSum = weights.reduce((a, b) => a + b, 0);
  if (weightSum <= 0 || total === 0) return weights.map(() => 0);

  const raw = weights.map((w) => (Math.max(0, w) / weightSum) * total);
  const floors = raw.map((r) => Math.floor(r));
  const allocated = floors.reduce((a, b) => a + b, 0);
  const remainder = total - allocated;

  const order = raw
    .map((r, i) => ({ i, frac: r - Math.floor(r) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);

  const result = [...floors];
  for (let k = 0; k < remainder; k++) {
    const idx = order[k % n]!.i;
    result[idx] = (result[idx] ?? 0) + 1;
  }
  return result;
}

/**
 * The single deterministic calculation boundary for the tablet's cart: no
 * service charge, GST disclosed not added, discount clamped to never
 * produce a negative payable amount, and per-seat figures reconciled
 * against the table-level rounded totals via largest-remainder allocation.
 */
export function computeCartTotals(lines: BillingLine[], discount: DiscountInput = NO_DISCOUNT): CartTotals {
  const subtotalCents = lines.reduce((a, l) => a + lineTotalCents(l), 0);

  let discountCents = 0;
  if (discount.kind === 'percent' && Number.isFinite(discount.percent) && discount.percent > 0) {
    discountCents = Math.round(subtotalCents * discount.percent);
  }
  // Never produce a negative payable amount, regardless of the discount input.
  discountCents = Math.min(Math.max(0, discountCents), Math.max(0, subtotalCents));

  const payableCents = subtotalCents - discountCents;
  const totalContainedGstCents = containedGstCents(payableCents);

  const seats = Array.from(new Set(lines.map((l) => l.seat))).sort((a, b) => a - b);
  const seatSubtotals = seats.map((seat) =>
    lines.filter((l) => l.seat === seat).reduce((a, l) => a + lineTotalCents(l), 0),
  );
  const seatDiscounts = allocateByLargestRemainder(seatSubtotals, discountCents);
  const seatPayables = seats.map((_, i) => (seatSubtotals[i] ?? 0) - (seatDiscounts[i] ?? 0));
  const seatGstShares = allocateByLargestRemainder(seatPayables, totalContainedGstCents);

  const seatBreakdown: SeatBreakdown[] = seats.map((seat, i) => ({
    seat,
    subtotalCents: seatSubtotals[i] ?? 0,
    discountCents: seatDiscounts[i] ?? 0,
    payableCents: seatPayables[i] ?? 0,
    containedGstCents: seatGstShares[i] ?? 0,
  }));

  return {
    subtotalCents,
    discountCents,
    payableCents,
    containedGstCents: totalContainedGstCents,
    seatBreakdown,
  };
}

/** Zero-value breakdown for a seat with no cart lines (e.g. an empty configured seat). */
export function emptySeatBreakdown(seat: number): SeatBreakdown {
  return { seat, subtotalCents: 0, discountCents: 0, payableCents: 0, containedGstCents: 0 };
}

export function seatBreakdownFor(totals: CartTotals, seat: number): SeatBreakdown {
  return totals.seatBreakdown.find((s) => s.seat === seat) ?? emptySeatBreakdown(seat);
}
