package pricing

import (
	"errors"
	"math"
	"math/rand/v2"
	"reflect"
	"testing"
)

func ptr[T any](v T) *T { return &v }

const (
	sizeGroup   = "11111111-1111-4111-8111-111111111111"
	small       = "11111111-1111-4111-8111-000000000001"
	large       = "11111111-1111-4111-8111-000000000002"
	extrasGroup = "22222222-2222-4222-8222-222222222222"
	cheese      = "22222222-2222-4222-8222-000000000001"
	bacon       = "22222222-2222-4222-8222-000000000002"
	free        = "22222222-2222-4222-8222-000000000003"
	soldOut     = "22222222-2222-4222-8222-000000000004"
	noSauce     = "22222222-2222-4222-8222-000000000005"
)

// burgerGroups is a required single-choice Size group and an optional Extras
// group allowing two, including a zero delta, a negative delta and an
// unavailable option.
const burgerGroups = `[
 {"id":"` + sizeGroup + `","name":"Size","required":true,"minSelections":1,"maxSelections":1,"options":[
   {"id":"` + small + `","name":"Small","priceDeltaCents":0,"isAvailable":true},
   {"id":"` + large + `","name":"Large","priceDeltaCents":250,"isAvailable":true}]},
 {"id":"` + extrasGroup + `","name":"Extras","required":false,"minSelections":0,"maxSelections":2,"options":[
   {"id":"` + cheese + `","name":"Cheese","priceDeltaCents":150},
   {"id":"` + bacon + `","name":"Bacon","priceDeltaCents":300,"isAvailable":true},
   {"id":"` + free + `","name":"Pickles","priceDeltaCents":0},
   {"id":"` + soldOut + `","name":"Truffle","priceDeltaCents":900,"isAvailable":false},
   {"id":"` + noSauce + `","name":"No sauce","priceDeltaCents":-50}]}]`

func catalog() map[string]CatalogItem {
	return map[string]CatalogItem{
		"plain":    {ID: "plain", Title: "Flat White", CategoryName: "Coffee", PriceCents: 550, IsAvailable: true, ModifierGroups: []byte(`[]`)},
		"override": {ID: "override", Title: "Lamb", CategoryName: "Mains", PriceCents: 1000, IsAvailable: true, Override: &VenueOverride{PriceCents: ptr[int64](1250)}},
		"burger":   {ID: "burger", Title: "Burger", CategoryName: "Mains", PriceCents: 1800, IsAvailable: true, ModifierGroups: []byte(burgerGroups)},
		"off":      {ID: "off", Title: "Soup", CategoryName: "Starters", PriceCents: 900, IsAvailable: false},
		"offHere":  {ID: "offHere", Title: "Fish", CategoryName: "Mains", PriceCents: 2600, IsAvailable: true, Override: &VenueOverride{IsAvailable: ptr(false)}},
		"onHere":   {ID: "onHere", Title: "Special", CategoryName: "Mains", PriceCents: 2200, IsAvailable: false, Override: &VenueOverride{IsAvailable: ptr(true)}},
		"nullOver": {ID: "nullOver", Title: "Tea", CategoryName: "Drinks", PriceCents: 450, IsAvailable: true, Override: &VenueOverride{}},
	}
}

func line(id string, qty int64, mods ...ModifierSelection) LineRequest {
	return LineRequest{MenuItemID: id, Quantity: qty, Modifiers: mods}
}

func sel(group, option string) ModifierSelection {
	return ModifierSelection{ModifierGroupID: group, OptionID: option}
}

func TestPriceOrderAmounts(t *testing.T) {
	cases := []struct {
		name               string
		lines              []LineRequest
		units, totals      []int64
		subtotal, tax, net int64
		mods               [][]string
	}{
		{"normal product", []LineRequest{line("plain", 1)}, []int64{550}, []int64{550}, 550, 72, 478, nil},
		{"venue price override", []LineRequest{line("override", 1)}, []int64{1250}, []int64{1250}, 1250, 163, 1087, nil},
		{"override row with no values", []LineRequest{line("nullOver", 1)}, []int64{450}, []int64{450}, 450, 59, 391, nil},
		{"availability re-enabled by override", []LineRequest{line("onHere", 1)}, []int64{2200}, []int64{2200}, 2200, 287, 1913, nil},
		{"one modifier", []LineRequest{line("burger", 1, sel(sizeGroup, large))}, []int64{2050}, []int64{2050}, 2050, 267, 1783,
			[][]string{{large}}},
		{"multiple modifiers across groups", []LineRequest{line("burger", 1, sel(extrasGroup, bacon), sel(sizeGroup, large), sel(extrasGroup, cheese))},
			[]int64{2500}, []int64{2500}, 2500, 326, 2174, [][]string{{bacon, cheese, large}}},
		{"zero delta", []LineRequest{line("burger", 1, sel(sizeGroup, small), sel(extrasGroup, free))}, []int64{1800}, []int64{1800}, 1800, 235, 1565,
			[][]string{{small, free}}},
		{"negative delta", []LineRequest{line("burger", 1, sel(sizeGroup, small), sel(extrasGroup, noSauce))}, []int64{1750}, []int64{1750}, 1750, 228, 1522,
			[][]string{{small, noSauce}}},
		{"quantity > 1", []LineRequest{line("burger", 3, sel(sizeGroup, large)), line("plain", 2)}, []int64{2050, 550}, []int64{6150, 1100},
			7250, 946, 6304, [][]string{{large}, nil}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			q, err := PriceOrder("venue", NZGSTInclusive, catalog(), c.lines)
			if err != nil {
				t.Fatal(err)
			}
			for i, l := range q.Lines {
				if l.UnitPriceCents != c.units[i] || l.LineTotalCents != c.totals[i] {
					t.Errorf("line %d = %s, want unit %d total %d", i, l, c.units[i], c.totals[i])
				}
				if l.UnitPriceCents != l.BasePriceCents+l.ModifiersCents {
					t.Errorf("line %d: unit %d != base %d + modifiers %d", i, l.UnitPriceCents, l.BasePriceCents, l.ModifiersCents)
				}
				var ids []string
				for _, m := range l.Modifiers {
					ids = append(ids, m.OptionID)
				}
				if c.mods != nil && !reflect.DeepEqual(ids, c.mods[i]) {
					t.Errorf("line %d modifiers %v, want %v", i, ids, c.mods[i])
				}
			}
			want := Totals{SubtotalCents: c.subtotal, TaxCents: c.tax, NetCents: c.net, TotalCents: c.subtotal}
			if q.Totals != want {
				t.Errorf("totals %+v, want %+v", q.Totals, want)
			}
		})
	}
}

func TestResolvedModifierSnapshot(t *testing.T) {
	q, err := PriceOrder("v", NZGSTInclusive, catalog(), []LineRequest{line("burger", 1, sel(sizeGroup, large), sel(extrasGroup, noSauce))})
	if err != nil {
		t.Fatal(err)
	}
	want := []PricedModifier{
		{ModifierGroupID: sizeGroup, ModifierGroupName: "Size", OptionID: large, OptionName: "Large", PriceDeltaCents: 250},
		{ModifierGroupID: extrasGroup, ModifierGroupName: "Extras", OptionID: noSauce, OptionName: "No sauce", PriceDeltaCents: -50},
	}
	if !reflect.DeepEqual(q.Lines[0].Modifiers, want) {
		t.Errorf("modifiers = %+v", q.Lines[0].Modifiers)
	}
	if l := q.Lines[0]; l.MenuItemTitle != "Burger" || l.MenuItemCategory != "Mains" || l.BasePriceCents != 1800 || l.ModifiersCents != 200 {
		t.Errorf("line = %+v", l)
	}
}

func TestPriceOrderFailures(t *testing.T) {
	cases := []struct {
		name  string
		tax   TaxProfile
		lines []LineRequest
		kind  Kind
		msg   string
	}{
		{"unknown item", NZGSTInclusive, []LineRequest{line("nope", 1)}, KindInvalidRequest, "MenuItem with ID nope not found"},
		{"unavailable item", NZGSTInclusive, []LineRequest{line("off", 1)}, KindUnavailable, `Menu item "Soup" is currently unavailable`},
		{"unavailable at this venue", NZGSTInclusive, []LineRequest{line("offHere", 1)}, KindUnavailable, `Menu item "Fish" is currently unavailable`},
		{"first failing line wins", NZGSTInclusive, []LineRequest{line("plain", 1), line("off", 1), line("nope", 1)}, KindUnavailable, `Menu item "Soup" is currently unavailable`},
		{"no lines", NZGSTInclusive, nil, KindInvalidRequest, "An order must contain at least one item"},
		{"selection without ids", NZGSTInclusive, []LineRequest{line("burger", 1, sel(sizeGroup, ""))}, KindInvalidRequest,
			"Each selected modifier must specify modifierGroupId and optionId"},
		{"modifier on an item without groups", NZGSTInclusive, []LineRequest{line("plain", 1, sel(sizeGroup, large))}, KindInvalidRequest,
			"This item has no configurable options"},
		{"unknown group", NZGSTInclusive, []LineRequest{line("burger", 1, sel("x", large))}, KindInvalidRequest, "Unknown modifier group for this item"},
		{"option of another group", NZGSTInclusive, []LineRequest{line("burger", 1, sel(sizeGroup, cheese))}, KindInvalidRequest,
			"Unknown modifier option for this item"},
		{"unavailable option", NZGSTInclusive, []LineRequest{line("burger", 1, sel(sizeGroup, small), sel(extrasGroup, soldOut))}, KindUnavailable,
			`"Truffle" is no longer available`},
		{"duplicate option", NZGSTInclusive, []LineRequest{line("burger", 1, sel(sizeGroup, small), sel(sizeGroup, small))}, KindInvalidRequest,
			"Duplicate modifier option selected"},
		{"missing required group", NZGSTInclusive, []LineRequest{line("burger", 1, sel(extrasGroup, cheese))}, KindInvalidRequest,
			`"Size" requires a selection`},
		{"too many in group", NZGSTInclusive, []LineRequest{line("burger", 1, sel(sizeGroup, small), sel(sizeGroup, large))}, KindInvalidRequest,
			`"Size" allows at most 1 selection(s)`},
		{"unsupported tax: exclusive prices", TaxProfile{"NZD", "NZ_GST", false}, []LineRequest{line("plain", 1)}, KindUnsupportedTax,
			"Venue v has an unsupported tax configuration for total calculation (currency=NZD, taxJurisdiction=NZ_GST, pricesIncludeTax=false) — refusing to guess a payable total."},
		{"unsupported tax: other currency", TaxProfile{"AUD", "NZ_GST", true}, []LineRequest{line("plain", 1)}, KindUnsupportedTax,
			"Venue v has an unsupported tax configuration for total calculation (currency=AUD, taxJurisdiction=NZ_GST, pricesIncludeTax=true) — refusing to guess a payable total."},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			_, err := PriceOrder("v", c.tax, catalog(), c.lines)
			var pe *Error
			if !errors.As(err, &pe) || pe.Kind != c.kind || pe.Message != c.msg {
				t.Fatalf("err = %#v, want kind %d %q", err, c.kind, c.msg)
			}
		})
	}
}

func TestExpectedPriceIsCheckedNeverUsed(t *testing.T) {
	lines := []LineRequest{line("plain", 2), line("burger", 1, sel(sizeGroup, large)), line("override", 1)}
	lines[0].ExpectedUnitPriceCents = ptr[int64](550)  // current: no conflict
	lines[1].ExpectedUnitPriceCents = ptr[int64](1800) // stale: 2050 now
	lines[2].ExpectedUnitPriceCents = ptr[int64](1000) // item price, but the venue override (1250) wins

	_, err := PriceOrder("v", NZGSTInclusive, catalog(), lines)
	var pe *Error
	if !errors.As(err, &pe) || pe.Kind != KindStalePrice || pe.Message != StalePriceMessage {
		t.Fatalf("err = %v", err)
	}
	want := []PriceConflict{
		{MenuItemID: "burger", MenuItemTitle: "Burger", ExpectedUnitPriceCents: 1800, AuthoritativeUnitPriceCents: 2050},
		{MenuItemID: "override", MenuItemTitle: "Lamb", ExpectedUnitPriceCents: 1000, AuthoritativeUnitPriceCents: 1250},
	}
	if !reflect.DeepEqual(pe.Conflicts, want) {
		t.Errorf("conflicts = %+v", pe.Conflicts)
	}

	// A matching expectation changes nothing: the server price is the price.
	lines[1].ExpectedUnitPriceCents, lines[2].ExpectedUnitPriceCents = ptr[int64](2050), ptr[int64](1250)
	q, err := PriceOrder("v", NZGSTInclusive, catalog(), lines)
	if err != nil || q.TotalCents != 1100+2050+1250 {
		t.Fatalf("q = %+v, err = %v", q, err)
	}
}

func TestStalePriceIsCheckedBeforeTax(t *testing.T) {
	l := line("plain", 1)
	l.ExpectedUnitPriceCents = ptr[int64](1)
	_, err := PriceOrder("v", TaxProfile{"AUD", "GST", true}, catalog(), []LineRequest{l})
	var pe *Error
	if !errors.As(err, &pe) || pe.Kind != KindStalePrice {
		t.Fatalf("err = %v, want stale price first", err)
	}
}

// The GST rule is DL-072's, retained by ADR 0001: prices include GST, GST is
// gross × 3/23 rounded to the nearest cent, and it is never added on top.
func TestNZGSTIsContainedNotAdded(t *testing.T) {
	cases := map[int64]int64{
		0: 0, 1: 0, 3: 0, 4: 1, 8: 1, 11: 1, 12: 2, 23: 3, 100: 13, 115: 15, 1000: 130, 1150: 150, 1999: 261,
		99999: 13043, -1: 0, -4: -1, -12: -2, -23: -3, MaxAmountCents: 280106563,
	}
	for gross, want := range cases {
		if got := NZGSTContainedCents(gross); got != want {
			t.Errorf("GST in %d = %d, want %d", gross, got, want)
		}
		totals, err := ComputeTotals("v", NZGSTInclusive, gross)
		if err != nil || totals.TotalCents != gross || totals.NetCents+totals.TaxCents != gross {
			t.Errorf("totals(%d) = %+v, %v: total must equal gross", gross, totals, err)
		}
	}
}

// jsRound is Nest's Math.round(subtotal * 3 / 23) in IEEE doubles.
func jsRound(n int64) int64 { return int64(math.Floor(float64(n)*3/23 + 0.5)) }

func TestNZGSTMatchesNestRoundingEverywhere(t *testing.T) {
	for n := int64(-50000); n <= 50000; n++ {
		if got, want := NZGSTContainedCents(n), jsRound(n); got != want {
			t.Fatalf("GST in %d = %d, Nest gives %d", n, got, want)
		}
	}
	r := rand.New(rand.NewPCG(1, 2))
	for range 200000 {
		n := r.Int64N(2*MaxAmountCents+1) - MaxAmountCents
		if got, want := NZGSTContainedCents(n), jsRound(n); got != want {
			t.Fatalf("GST in %d = %d, Nest gives %d", n, got, want)
		}
	}
	if got := NZGSTContainedCents(math.MaxInt64); got <= 0 {
		t.Errorf("no overflow expected, got %d", got)
	}
}

func TestAmountBounds(t *testing.T) {
	big := map[string]CatalogItem{"big": {ID: "big", Title: "Big", PriceCents: MaxAmountCents, IsAvailable: true}}
	if _, err := PriceOrder("v", NZGSTInclusive, big, []LineRequest{line("big", 1)}); err != nil {
		t.Fatalf("the largest persistable amount must price: %v", err)
	}
	for name, lines := range map[string][]LineRequest{
		"line total beyond the column": {line("big", 2)},
		"subtotal beyond the column":   {line("big", 1), line("big", 1)},
		"int64 overflow":               {line("big", math.MaxInt64)},
	} {
		_, err := PriceOrder("v", NZGSTInclusive, big, lines)
		var pe *Error
		if !errors.As(err, &pe) || pe.Kind != KindAmountOutOfRange {
			t.Errorf("%s: err = %v", name, err)
		}
	}
	if _, err := PriceOrder("v", NZGSTInclusive, catalog(), []LineRequest{line("plain", 0)}); err == nil {
		t.Error("quantity 0 must be refused")
	}
}
