package pricing

import "sort"

// Discount primitives (Phase D11). Pricing owns the money math of a
// discount; which lines are eligible and at what rate is decided by the
// caller (the promotions domain), which never computes an amount itself.
// Integers only, with checked arithmetic.

// BasisPointsWhole is 100 % in basis points.
const BasisPointsWhole = 10000

// DiscountResult is the effect of one discount on a set of priced lines.
type DiscountResult struct {
	// EligibleSubtotalCents is the sum of the eligible lines' totals.
	EligibleSubtotalCents int64
	// DiscountCents is the whole discount, the sum of LineDiscounts.
	DiscountCents int64
	// LineDiscounts has one entry per priced line, in the same order; 0 for a
	// line that is not eligible.
	LineDiscounts []int64
}

// PercentOf is basisPoints/10000 of amountCents, rounded half up to the
// cent: floor((amount × bp + 5000) / 10000). amountCents must not be
// negative and basisPoints must be 0..10000.
func PercentOf(amountCents, basisPoints int64) (int64, error) {
	if amountCents < 0 || basisPoints < 0 || basisPoints > BasisPointsWhole {
		return 0, errOutOfRange
	}
	p, ok := mulCents(amountCents, basisPoints)
	if !ok {
		return 0, errOutOfRange
	}
	p, ok = addCents(p, BasisPointsWhole/2)
	if !ok {
		return 0, errOutOfRange
	}
	return p / BasisPointsWhole, nil
}

// Allocate splits amountCents across weights in proportion, by largest
// remainder: each weight gets floor(amount × w / W), and the cents left over
// go one each to the largest remainders, the earlier position first on a
// tie. The shares sum to amountCents exactly. Weights must be positive and
// amountCents between 0 and their sum, so no share exceeds its weight.
func Allocate(amountCents int64, weights []int64) ([]int64, error) {
	var total int64
	for _, w := range weights {
		var ok bool
		if w <= 0 {
			return nil, errOutOfRange
		}
		if total, ok = addCents(total, w); !ok {
			return nil, errOutOfRange
		}
	}
	if amountCents < 0 || amountCents > total || (len(weights) == 0 && amountCents != 0) {
		return nil, errOutOfRange
	}
	shares := make([]int64, len(weights))
	remainders := make([]int64, len(weights))
	var given int64
	for i, w := range weights {
		p, ok := mulCents(amountCents, w)
		if !ok {
			return nil, errOutOfRange
		}
		shares[i], remainders[i] = p/total, p%total
		given += shares[i]
	}
	order := make([]int, len(weights))
	for i := range order {
		order[i] = i
	}
	sort.SliceStable(order, func(a, b int) bool { return remainders[order[a]] > remainders[order[b]] })
	for _, i := range order[:amountCents-given] {
		shares[i]++
	}
	return shares, nil
}

// ApplyPercentage discounts the eligible lines by basisPoints (1..10000).
// The discount is PercentOf the eligible subtotal, so the guest gets the
// rounded percentage of what they bought, not a sum of per-line roundings;
// it is then Allocated to the eligible lines by their totals. A line whose
// total is not positive is never eligible. eligible[i] says whether line i
// may be discounted.
func ApplyPercentage(lines []PricedLine, eligible []bool, basisPoints int64) (DiscountResult, error) {
	if len(eligible) != len(lines) || basisPoints < 1 || basisPoints > BasisPointsWhole {
		return DiscountResult{}, errOutOfRange
	}
	res := DiscountResult{LineDiscounts: make([]int64, len(lines))}
	var idx []int
	var weights []int64
	for i, l := range lines {
		if !eligible[i] || l.LineTotalCents <= 0 {
			continue
		}
		var ok bool
		if res.EligibleSubtotalCents, ok = addCents(res.EligibleSubtotalCents, l.LineTotalCents); !ok {
			return DiscountResult{}, errOutOfRange
		}
		idx, weights = append(idx, i), append(weights, l.LineTotalCents)
	}
	d, err := PercentOf(res.EligibleSubtotalCents, basisPoints)
	if err != nil {
		return DiscountResult{}, err
	}
	shares, err := Allocate(d, weights)
	if err != nil {
		return DiscountResult{}, err
	}
	for k, i := range idx {
		res.LineDiscounts[i] = shares[k]
	}
	res.DiscountCents = d
	return res, nil
}

// ComputeDiscountedTotals applies the venue's tax profile to a gross
// subtotal less a discount. Under GST-inclusive prices a discount reduces
// the consideration, so the GST is the part contained in the discounted
// total, never in the gross. discountCents must be 0..subtotalCents.
func ComputeDiscountedTotals(venueID string, p TaxProfile, subtotalCents, discountCents int64) (Totals, error) {
	if discountCents < 0 || discountCents > subtotalCents {
		return Totals{}, errOutOfRange
	}
	t, err := ComputeTotals(venueID, p, subtotalCents-discountCents)
	if err != nil {
		return Totals{}, err
	}
	t.SubtotalCents, t.DiscountCents = subtotalCents, discountCents
	return t, nil
}
