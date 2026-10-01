import { describe, expect, it } from 'vitest';
import {
  SUPPORTED_TAX_PROFILE,
  isSupportedTaxProfile,
  dollarsToCents,
  containedGstCents,
  lineTotalCents,
  computeCartTotals,
  allocateByLargestRemainder,
  seatBreakdownFor,
  type BillingLine,
} from './billing';

function line(seat: number, unitDollars: number, qty = 1, modifierDeltaDollars: number[] = []): BillingLine {
  return { seat, unitDollars, qty, modifierDeltaDollars };
}

describe('isSupportedTaxProfile', () => {
  it('accepts exactly the NZ GST-inclusive profile', () => {
    expect(isSupportedTaxProfile(SUPPORTED_TAX_PROFILE)).toBe(true);
    expect(
      isSupportedTaxProfile({ currency: 'NZD', taxJurisdiction: 'NZ_GST', pricesIncludeTax: true }),
    ).toBe(true);
  });

  it('rejects a GST-exclusive venue configuration', () => {
    expect(
      isSupportedTaxProfile({ currency: 'NZD', taxJurisdiction: 'NZ_GST', pricesIncludeTax: false }),
    ).toBe(false);
  });

  it('rejects a non-NZ jurisdiction', () => {
    expect(
      isSupportedTaxProfile({ currency: 'AUD', taxJurisdiction: 'AU_GST', pricesIncludeTax: true }),
    ).toBe(false);
  });

  it('rejects null/undefined (not-yet-loaded or failed fetch)', () => {
    expect(isSupportedTaxProfile(null)).toBe(false);
    expect(isSupportedTaxProfile(undefined)).toBe(false);
  });
});

describe('dollarsToCents', () => {
  it('rounds cleanly and rejects non-finite input', () => {
    expect(dollarsToCents(12.5)).toBe(1250);
    expect(dollarsToCents(9.999)).toBe(1000);
    expect(dollarsToCents(Number.NaN)).toBe(0);
    expect(dollarsToCents(Number.POSITIVE_INFINITY)).toBe(0);
  });

  it('is stable for a cents-derived dollar value (float dust from priceDeltaCents/100)', () => {
    // 250 / 100 in double precision can carry float dust; must still round to exactly 250.
    expect(dollarsToCents(250 / 100)).toBe(250);
    expect(dollarsToCents(1 / 3 * 3)).toBe(100); // 0.9999999999999999 * 100 rounds to 100
  });
});

describe('containedGstCents — 3/23 extraction, disclosure only', () => {
  it('matches DL-072s worked example: $70.00 gross contains $9.13 GST', () => {
    expect(containedGstCents(7000)).toBe(913); // 7000*3/23 = 913.04... -> 913
  });

  it('is zero for a zero or negative amount', () => {
    expect(containedGstCents(0)).toBe(0);
    expect(containedGstCents(-100)).toBe(0);
  });
});

describe('lineTotalCents', () => {
  it('computes unit + modifiers, times quantity', () => {
    expect(lineTotalCents(line(1, 10, 2, [1.5, 0.5]))).toBe(2400); // (10+1.5+0.5)*2 = 24.00
  });

  it('treats a zero-priced item as a valid free line, not an error', () => {
    expect(lineTotalCents(line(0, 0, 3))).toBe(0);
  });

  it('never produces a negative line total from a malformed quantity', () => {
    expect(lineTotalCents(line(1, 10, -5))).toBe(0);
  });
});

describe('computeCartTotals — core arithmetic', () => {
  it('empty order: everything is zero', () => {
    const totals = computeCartTotals([]);
    expect(totals).toMatchObject({
      subtotalCents: 0,
      discountCents: 0,
      payableCents: 0,
      containedGstCents: 0,
    });
    expect(totals.seatBreakdown).toEqual([]);
  });

  it('one GST-inclusive item: total equals price, no service charge, GST disclosed not added', () => {
    // Matches DL-072's worked example item.
    const totals = computeCartTotals([line(1, 70)]);
    expect(totals.subtotalCents).toBe(7000);
    expect(totals.discountCents).toBe(0);
    expect(totals.payableCents).toBe(7000); // NOT 7000 + service + gst
    expect(totals.containedGstCents).toBe(913);
  });

  it('regression: the old formula (10% service + additive 15% GST) must not reappear', () => {
    const totals = computeCartTotals([line(1, 70)]);
    const oldBuggyTotal = 70 * 100 + 70 * 100 * 0.10 + 70 * 100 * 0.15; // = 8750 cents
    expect(totals.payableCents).not.toBe(oldBuggyTotal);
    expect(totals.payableCents).toBe(7000);
  });

  it('multiple items sum correctly', () => {
    const totals = computeCartTotals([line(1, 12.5), line(1, 8.25, 2)]);
    // 12.50 + (8.25*2) = 29.00
    expect(totals.subtotalCents).toBe(2900);
    expect(totals.payableCents).toBe(2900);
  });

  it('modifier price additions are included in the line and the total', () => {
    const totals = computeCartTotals([line(1, 15, 1, [2.5, 1])]);
    expect(totals.subtotalCents).toBe(1850); // 15 + 2.5 + 1
  });

  it('quantity greater than one multiplies the full unit (base + modifiers)', () => {
    const totals = computeCartTotals([line(1, 10, 3, [1])]);
    expect(totals.subtotalCents).toBe(3300); // (10+1)*3
  });

  it('decimal-cent rounding boundary: modifier delta from priceDeltaCents/100 rounds correctly', () => {
    // 333 cents / 100 = 3.33 dollars exactly representable; total must be exact.
    const totals = computeCartTotals([line(1, 9.99, 1, [3.33])]);
    expect(totals.subtotalCents).toBe(1332);
  });

  it('zero-priced item contributes nothing but does not error', () => {
    const totals = computeCartTotals([line(1, 0), line(1, 10)]);
    expect(totals.subtotalCents).toBe(1000);
  });
});

describe('computeCartTotals — discount handling', () => {
  it('a valid discount reduces the taxable/payable base and the disclosed GST with it', () => {
    // sub = 100.00, 10% discount = 10.00, payable = 90.00, GST-in-90 = 90*3/23 = 11.7391... -> 1174
    const totals = computeCartTotals([line(1, 100)], { kind: 'percent', percent: 0.1 });
    expect(totals.subtotalCents).toBe(10000);
    expect(totals.discountCents).toBe(1000);
    expect(totals.payableCents).toBe(9000);
    expect(totals.containedGstCents).toBe(1174);
  });

  it('a discount can never produce a negative payable amount, even if misconfigured above 100%', () => {
    const totals = computeCartTotals([line(1, 10)], { kind: 'percent', percent: 1.5 });
    expect(totals.discountCents).toBe(1000); // clamped to the subtotal
    expect(totals.payableCents).toBe(0);
  });

  it('no discount leaves the subtotal untouched', () => {
    const totals = computeCartTotals([line(1, 10)], { kind: 'none' });
    expect(totals.discountCents).toBe(0);
    expect(totals.payableCents).toBe(1000);
  });
});

describe('computeCartTotals — whole-table and per-seat consistency', () => {
  it('the whole-table payable total equals subtotal minus discount — never inflated by GST disclosure', () => {
    const lines = [line(1, 25.5), line(2, 40), line(0, 5)];
    const totals = computeCartTotals(lines);
    const expectedSubtotal = 2550 + 4000 + 500;
    expect(totals.subtotalCents).toBe(expectedSubtotal);
    expect(totals.payableCents).toBe(expectedSubtotal); // GST never added
  });

  it('per-seat subtotals sum to the table subtotal, and per-seat payables sum to the table payable', () => {
    const lines = [line(1, 10), line(1, 5), line(2, 20), line(0, 3)];
    const totals = computeCartTotals(lines, { kind: 'percent', percent: 0.1 });
    const seatSubtotalSum = totals.seatBreakdown.reduce((a, s) => a + s.subtotalCents, 0);
    const seatPayableSum = totals.seatBreakdown.reduce((a, s) => a + s.payableCents, 0);
    expect(seatSubtotalSum).toBe(totals.subtotalCents);
    expect(seatPayableSum).toBe(totals.payableCents);
  });

  it('multiple seats each get their own correct breakdown', () => {
    const lines = [line(1, 30), line(2, 20), line(3, 10)];
    const totals = computeCartTotals(lines);
    expect(seatBreakdownFor(totals, 1).subtotalCents).toBe(3000);
    expect(seatBreakdownFor(totals, 2).subtotalCents).toBe(2000);
    expect(seatBreakdownFor(totals, 3).subtotalCents).toBe(1000);
  });

  it('a seat with no cart lines returns an explicit zero breakdown, not undefined', () => {
    const totals = computeCartTotals([line(1, 10)]);
    expect(seatBreakdownFor(totals, 7)).toEqual({
      seat: 7,
      subtotalCents: 0,
      discountCents: 0,
      payableCents: 0,
      containedGstCents: 0,
    });
  });

  it('per-seat contained-GST shares sum exactly to the table-level rounded contained GST', () => {
    // Chosen so naive independent per-seat rounding would NOT sum to the table figure.
    const lines = [line(1, 33.33), line(2, 11.11), line(3, 7.77)];
    const totals = computeCartTotals(lines);
    const seatGstSum = totals.seatBreakdown.reduce((a, s) => a + s.containedGstCents, 0);
    expect(seatGstSum).toBe(totals.containedGstCents);
  });

  it('per-seat discount shares sum exactly to the table-level discount under an uneven split', () => {
    const lines = [line(1, 17), line(2, 23), line(3, 5)];
    const totals = computeCartTotals(lines, { kind: 'percent', percent: 0.1 });
    const seatDiscountSum = totals.seatBreakdown.reduce((a, s) => a + s.discountCents, 0);
    expect(seatDiscountSum).toBe(totals.discountCents);
  });
});

describe('single calculation source — why UI group headers must call seatBreakdownFor/seatGrand directly', () => {
  it('regression (independent review, 2026-08-19): a raw per-line sum for one seat diverges from seatBreakdownFor once a discount is active — proves OrderTabletPage.tsx\'s cartGroups/enquiryGroups fix is necessary, not cosmetic', () => {
    const lines = [line(1, 17), line(1, 8), line(2, 23), line(0, 5)];
    const totals = computeCartTotals(lines, { kind: 'percent', percent: 0.1 });

    // What OrderTabletPage.tsx's group-header total used to compute for
    // seat 1, before this fix: a plain sum of that seat's own line totals,
    // with no awareness of the table-level discount at all.
    const rawSeat1Sum = lines
      .filter((l) => l.seat === 1)
      .reduce((a, l) => a + lineTotalCents(l), 0);

    // What billing.ts's own seat reconciliation — and, after this fix,
    // OrderTabletPage.tsx's seatGrand() — actually returns: the seat's
    // proportional share of the table-level discount already applied.
    const actualSeat1Payable = seatBreakdownFor(totals, 1).payableCents;

    expect(rawSeat1Sum).toBe(2500); // 17+8 = 25.00, discount-unaware
    expect(actualSeat1Payable).toBeLessThan(rawSeat1Sum); // discount correctly applied
    expect(rawSeat1Sum).not.toBe(actualSeat1Payable);

    // The seat breakdown remains the source of truth: all seats' payables
    // still sum exactly to the table-level payable.
    const seatPayableSum = totals.seatBreakdown.reduce((a, s) => a + s.payableCents, 0);
    expect(seatPayableSum).toBe(totals.payableCents);
  });
});

describe('allocateByLargestRemainder', () => {
  it('distributes a whole total across weights summing exactly to the total', () => {
    const result = allocateByLargestRemainder([1, 1, 1], 100);
    expect(result.reduce((a, b) => a + b, 0)).toBe(100);
    // 100/3 = 33.33 each -> floors [33,33,33] leave a remainder of 1 cent,
    // awarded to the first index on an equal-fraction tie (order-stable).
    expect(result).toEqual([34, 33, 33]);
  });

  it('returns all zeros when the total is zero', () => {
    expect(allocateByLargestRemainder([5, 3, 2], 0)).toEqual([0, 0, 0]);
  });

  it('returns all zeros when weights are empty or sum to zero', () => {
    expect(allocateByLargestRemainder([], 100)).toEqual([]);
    expect(allocateByLargestRemainder([0, 0], 50)).toEqual([0, 0]);
  });

  it('is deterministic across repeated calls with the same input', () => {
    const weights = [17, 23, 5, 41];
    const a = allocateByLargestRemainder(weights, 999);
    const b = allocateByLargestRemainder(weights, 999);
    expect(a).toEqual(b);
    expect(a.reduce((x, y) => x + y, 0)).toBe(999);
  });
});

describe('reload/recalculation consistency', () => {
  it('computing totals twice from the same cart input is byte-for-byte identical', () => {
    const lines = [line(1, 12.99, 2, [1.5]), line(2, 8.25)];
    const first = computeCartTotals(lines, { kind: 'percent', percent: 0.1 });
    const second = computeCartTotals(lines, { kind: 'percent', percent: 0.1 });
    expect(second).toEqual(first);
  });
});
