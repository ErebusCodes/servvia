package pricing

import (
	"errors"
	"math"
	"math/rand/v2"
	"reflect"
	"testing"
)

func priced(totals ...int64) []PricedLine {
	out := make([]PricedLine, len(totals))
	for i, t := range totals {
		out[i] = PricedLine{UnitPriceCents: t, Quantity: 1, LineTotalCents: t}
	}
	return out
}

func all(n int) []bool {
	b := make([]bool, n)
	for i := range b {
		b[i] = true
	}
	return b
}

// Money vectors A, B and D of Phase D11, pinned to the cent: the discount,
// then the GST contained in the discounted total (NZ GST, 3/23).
func TestDiscountMoneyVectors(t *testing.T) {
	cases := []struct {
		name                        string
		lines                       []int64
		eligible                    []bool
		bp                          int64
		wantEligible, wantDiscount  int64
		wantLines                   []int64
		wantTax, wantTotal, wantNet int64
	}{
		// A: 10 % of 1000 is 100; GST in 900 is 117.39 -> 117.
		{"A 10% of 1000", []int64{1000}, all(1), 1000, 1000, 100, []int64{100}, 117, 900, 783},
		// B: 10 % of 1005 is 100.5 -> 101 (half up); GST in 904 is 117.91 -> 118.
		{"B half cent rounds up", []int64{1005}, all(1), 1000, 1005, 101, []int64{101}, 118, 904, 786},
		// B: 12.5 % of 1004 is 125.5 -> 126.
		{"B 12.5% of 1004", []int64{1004}, all(1), 1250, 1004, 126, []int64{126}, 115, 878, 763},
		// B: 33.33 % of 333 is 110.9889 -> 111 (nearest, not truncated).
		{"B 33.33% of 333", []int64{333}, all(1), 3333, 333, 111, []int64{111}, 29, 222, 193},
		// B: 10 % of 1004 is 100.4 -> 100 (below the half rounds down).
		{"B below half rounds down", []int64{1004}, all(1), 1000, 1004, 100, []int64{100}, 118, 904, 786},
		// D: two ineligible lines and one eligible: only 1800 is discounted.
		{"D only eligible lines", []int64{550, 700, 1800}, []bool{false, false, true}, 5000, 1800, 900, []int64{0, 0, 900}, 280, 2150, 1870},
		// Rounded once on the eligible subtotal, then allocated: 10 % of 1000
		// over 333+333+334 is 100 = 33+33+34, not 33+33+33.
		{"allocation by largest remainder", []int64{333, 333, 334}, all(3), 1000, 1000, 100, []int64{33, 33, 34}, 117, 900, 783},
		// Equal remainders: the earlier line gets the cent.
		{"ties go to the earlier line", []int64{1, 1, 1}, all(3), 5000, 3, 2, []int64{1, 1, 0}, 0, 1, 1},
		// 100 % discounts every eligible cent and no more.
		{"100% of the eligible lines", []int64{550, 1800}, []bool{true, false}, 10000, 550, 550, []int64{550, 0}, 235, 1800, 1565},
		// A line with no positive total is never discounted.
		{"non-positive lines are ineligible", []int64{0, -50, 1000}, all(3), 1000, 1000, 100, []int64{0, 0, 100}, 111, 850, 739},
		// Nothing eligible: no discount.
		{"nothing eligible", []int64{550}, []bool{false}, 1000, 0, 0, []int64{0}, 72, 550, 478},
	}
	for _, c := range cases {
		lines := priced(c.lines...)
		res, err := ApplyPercentage(lines, c.eligible, c.bp)
		if err != nil {
			t.Fatalf("%s: %v", c.name, err)
		}
		if res.EligibleSubtotalCents != c.wantEligible || res.DiscountCents != c.wantDiscount || !reflect.DeepEqual(res.LineDiscounts, c.wantLines) {
			t.Errorf("%s: %+v", c.name, res)
		}
		var subtotal int64
		for _, l := range c.lines {
			subtotal += l
		}
		tot, err := ComputeDiscountedTotals("v", NZGSTInclusive, subtotal, res.DiscountCents)
		if err != nil {
			t.Fatalf("%s: %v", c.name, err)
		}
		if tot.SubtotalCents != subtotal || tot.DiscountCents != c.wantDiscount || tot.TaxCents != c.wantTax ||
			tot.TotalCents != c.wantTotal || tot.NetCents != c.wantNet {
			t.Errorf("%s: totals %+v", c.name, tot)
		}
	}
}

// GST is contained in the DISCOUNTED total, never taken from the gross and
// left unchanged: 2000 less 10 % is 1800, whose GST is 234.78 -> 235 (the
// gross 2000 would give 261).
func TestDiscountReducesTheGST(t *testing.T) {
	tot, err := ComputeDiscountedTotals("v", NZGSTInclusive, 2000, 200)
	if err != nil || tot.TaxCents != 235 || tot.TotalCents != 1800 || tot.NetCents != 1565 || NZGSTContainedCents(2000) != 261 {
		t.Fatalf("%+v %v", tot, err)
	}
	if plain, _ := ComputeTotals("v", NZGSTInclusive, 2000); plain.DiscountCents != 0 || plain.TotalCents != 2000 {
		t.Errorf("no discount: %+v", plain)
	}
}

func TestDiscountBounds(t *testing.T) {
	outOfRange := func(err error) bool {
		var pe *Error
		return errors.As(err, &pe) && pe.Kind == KindAmountOutOfRange
	}
	for name, err := range map[string]error{
		"discount above subtotal": func() error { _, err := ComputeDiscountedTotals("v", NZGSTInclusive, 100, 101); return err }(),
		"negative discount":       func() error { _, err := ComputeDiscountedTotals("v", NZGSTInclusive, 100, -1); return err }(),
		"0 basis points":          func() error { _, err := ApplyPercentage(priced(100), all(1), 0); return err }(),
		"over 100%":               func() error { _, err := ApplyPercentage(priced(100), all(1), 10001); return err }(),
		"eligibility length":      func() error { _, err := ApplyPercentage(priced(100), all(2), 1000); return err }(),
		"overflowing subtotal":    func() error { _, err := ApplyPercentage(priced(math.MaxInt64, 1), all(2), 1000); return err }(),
		"overflowing product":     func() error { _, err := PercentOf(math.MaxInt64/2, 10000); return err }(),
		"negative amount":         func() error { _, err := PercentOf(-1, 100); return err }(),
		"allocate over the total": func() error { _, err := Allocate(4, []int64{1, 2}); return err }(),
		"allocate zero weight":    func() error { _, err := Allocate(0, []int64{1, 0}); return err }(),
	} {
		if !outOfRange(err) {
			t.Errorf("%s: %v", name, err)
		}
	}
	// A discounted total never falls below zero, even at 100 %.
	if tot, err := ComputeDiscountedTotals("v", NZGSTInclusive, 100, 100); err != nil || tot.TotalCents != 0 || tot.TaxCents != 0 {
		t.Errorf("full discount: %+v %v", tot, err)
	}
	// The discount of an unsupported tax profile is refused like its total.
	if _, err := ComputeDiscountedTotals("v", TaxProfile{Currency: "NZD", TaxJurisdiction: "NZ_GST"}, 100, 10); err == nil {
		t.Error("unsupported tax profile accepted")
	}
}

// Allocation invariants over random inputs: the shares sum exactly to the
// discount, no share exceeds its line, and none is negative.
func TestAllocationInvariants(t *testing.T) {
	r := rand.New(rand.NewPCG(11, 11))
	for range 20000 {
		n := 1 + r.IntN(8)
		weights := make([]int64, n)
		var total int64
		for i := range weights {
			weights[i] = 1 + r.Int64N(MaxAmountCents/8)
			total += weights[i]
		}
		amount := r.Int64N(total + 1)
		shares, err := Allocate(amount, weights)
		if err != nil {
			t.Fatal(err)
		}
		var sum int64
		for i, s := range shares {
			if s < 0 || s > weights[i] {
				t.Fatalf("share %d of %d for %v / %d", s, weights[i], weights, amount)
			}
			sum += s
		}
		if sum != amount {
			t.Fatalf("shares %v sum to %d, want %d", shares, sum, amount)
		}
	}
}
