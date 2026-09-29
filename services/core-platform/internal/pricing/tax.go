package pricing

import "strconv"

// TaxProfile is the part of a venue's configuration that decides how tax is
// computed. Callers build it from the venue read model (venues.TaxConfig).
type TaxProfile struct {
	Currency         string
	TaxJurisdiction  string
	PricesIncludeTax bool
}

// NZGSTInclusive is the only profile with a verified rule today (DL-072,
// retained by ADR 0001): New Zealand dollars, NZ GST, menu prices that
// already contain GST.
var NZGSTInclusive = TaxProfile{Currency: "NZD", TaxJurisdiction: "NZ_GST", PricesIncludeTax: true}

// Totals is the tax breakdown of a subtotal. With GST-inclusive prices the
// payable total contains its GST, which is never added on top. Without a
// discount the gross amount IS the payable total.
type Totals struct {
	// SubtotalCents is the sum of line totals: the gross amount.
	SubtotalCents int64
	// DiscountCents is the discount on the gross amount (Phase D11); 0 when
	// there is none.
	DiscountCents int64
	// TaxCents is the GST contained in the payable total.
	TaxCents int64
	// NetCents is the payable total less the contained tax.
	NetCents int64
	// TotalCents is what the customer pays: SubtotalCents - DiscountCents.
	TotalCents int64
}

// ComputeTotals applies the venue's tax profile to a subtotal. An
// unsupported profile fails closed (KindUnsupportedTax) rather than guessing
// whether tax is additive or contained. venueID only appears in the error.
func ComputeTotals(venueID string, p TaxProfile, subtotalCents int64) (Totals, error) {
	if p != NZGSTInclusive {
		return Totals{}, &Error{Kind: KindUnsupportedTax, Message: "Venue " + venueID +
			" has an unsupported tax configuration for total calculation (currency=" + p.Currency +
			", taxJurisdiction=" + p.TaxJurisdiction + ", pricesIncludeTax=" +
			strconv.FormatBool(p.PricesIncludeTax) + ") — refusing to guess a payable total."}
	}
	tax := NZGSTContainedCents(subtotalCents)
	return Totals{SubtotalCents: subtotalCents, TaxCents: tax, NetCents: subtotalCents - tax, TotalCents: subtotalCents}, nil
}

// NZGSTContainedCents is the GST contained in a GST-inclusive amount at 15%:
// gross × 3/23, rounded to the nearest cent. 3/23 = 0.15/1.15.
//
// Rounding: gross × 3/23 is k/23 for an integer k, which is never exactly
// half a cent (that would need an even denominator), so "nearest" has no
// ties and needs no tie rule. The result equals Nest's
// Math.round(gross * 3 / 23) for every integer, negative ones included:
// floor((6 × gross + 23) / 46) = floor(3 × gross / 23 + 1/2).
//
// Written as gross = 23q + r (0 ≤ r < 23) so no intermediate can overflow:
// 3 × gross / 23 = 3q + 3r/23.
func NZGSTContainedCents(grossCents int64) int64 {
	q := floorDiv(grossCents, 23)
	r := grossCents - 23*q
	return 3*q + floorDiv(6*r+23, 46)
}
