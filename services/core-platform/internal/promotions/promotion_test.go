package promotions

import (
	"errors"
	"reflect"
	"strings"
	"testing"
	"time"

	"servvia/services/core-platform/internal/pricing"
)

var (
	venue = pricing.Venue{ID: "v1", OrganizationID: "o1", Tax: pricing.NZGSTInclusive}
	noon  = time.Date(2026, 10, 1, 12, 0, 0, 0, time.UTC)
)

func at(t time.Time) *time.Time { return &t }

func active(terms Terms) Promotion {
	return Promotion{ID: "p1", VenueID: "v1", Terms: terms, Status: StatusActive, Version: 3}
}

func tenPercent() Terms {
	return Terms{Name: "Ten", Kind: KindPercentage, BasisPoints: 1000, Target: TargetAllItems}
}

// lines: a 1000 main (category mains, item burger), a 550 coffee (category
// drinks, item flat-white), a 700 side (category mains, item chips).
func lines() []pricing.PricedLine {
	return []pricing.PricedLine{
		{MenuItemID: "burger", CategoryID: "mains", UnitPriceCents: 1000, Quantity: 1, LineTotalCents: 1000},
		{MenuItemID: "flat-white", CategoryID: "drinks", UnitPriceCents: 550, Quantity: 1, LineTotalCents: 550},
		{MenuItemID: "chips", CategoryID: "mains", UnitPriceCents: 350, Quantity: 2, LineTotalCents: 700},
	}
}

func TestNormalize(t *testing.T) {
	n, err := Terms{Name: "  Happy hour ", Kind: KindPercentage, BasisPoints: 2000, Target: TargetCategories,
		CategoryIDs: []string{" b", "a", "b"}, StartsAt: at(noon.In(time.FixedZone("NZDT", 13*3600)).Add(123456 * time.Nanosecond))}.Normalize()
	if err != nil {
		t.Fatal(err)
	}
	if n.Name != "Happy hour" || !reflect.DeepEqual(n.CategoryIDs, []string{"a", "b"}) || n.StartsAt.Location() != time.UTC ||
		!n.StartsAt.Equal(noon) || len(n.MenuItemIDs) != 0 {
		t.Errorf("normalized %+v", n)
	}
	many := make([]string, 201)
	for i := range many {
		many[i] = strings.Repeat("x", i+1)
	}
	for name, terms := range map[string]Terms{
		"empty name":                {Kind: KindPercentage, BasisPoints: 1, Target: TargetAllItems},
		"long name":                 {Name: strings.Repeat("n", 81), Kind: KindPercentage, BasisPoints: 1, Target: TargetAllItems},
		"fixed amount":              {Name: "x", Kind: "fixed_amount", BasisPoints: 1, Target: TargetAllItems},
		"0 bp":                      {Name: "x", Kind: KindPercentage, BasisPoints: 0, Target: TargetAllItems},
		"over 100%":                 {Name: "x", Kind: KindPercentage, BasisPoints: 10001, Target: TargetAllItems},
		"unknown target":            {Name: "x", Kind: KindPercentage, BasisPoints: 1, Target: "order"},
		"all items with a list":     {Name: "x", Kind: KindPercentage, BasisPoints: 1, Target: TargetAllItems, MenuItemIDs: []string{"a"}},
		"categories without a list": {Name: "x", Kind: KindPercentage, BasisPoints: 1, Target: TargetCategories},
		"categories with items":     {Name: "x", Kind: KindPercentage, BasisPoints: 1, Target: TargetCategories, CategoryIDs: []string{"a"}, MenuItemIDs: []string{"b"}},
		"items without a list":      {Name: "x", Kind: KindPercentage, BasisPoints: 1, Target: TargetMenuItems},
		"blank id":                  {Name: "x", Kind: KindPercentage, BasisPoints: 1, Target: TargetMenuItems, MenuItemIDs: []string{" "}},
		"201 ids":                   {Name: "x", Kind: KindPercentage, BasisPoints: 1, Target: TargetMenuItems, MenuItemIDs: many},
		"empty window":              {Name: "x", Kind: KindPercentage, BasisPoints: 1, Target: TargetAllItems, StartsAt: at(noon), EndsAt: at(noon)},
	} {
		var v *ValidationError
		if _, err := terms.Normalize(); !errors.As(err, &v) {
			t.Errorf("%s: %v", name, err)
		}
	}
}

func TestEvaluateAppliesServerSideEligibility(t *testing.T) {
	cases := []struct {
		name         string
		terms        Terms
		wantEligible []bool
		wantLines    []int64
		wantDiscount int64
	}{
		// 10 % of 2250 = 225, allocated 100 / 55 / 70.
		{"all items", tenPercent(), []bool{true, true, true}, []int64{100, 55, 70}, 225},
		// Category mains only: 20 % of 1700 = 340 -> 200 / 0 / 140.
		{"category", Terms{Name: "Mains", Kind: KindPercentage, BasisPoints: 2000, Target: TargetCategories, CategoryIDs: []string{"mains"}},
			[]bool{true, false, true}, []int64{200, 0, 140}, 340},
		// One menu item: 50 % of 550 = 275.
		{"menu item", Terms{Name: "Coffee", Kind: KindPercentage, BasisPoints: 5000, Target: TargetMenuItems, MenuItemIDs: []string{"flat-white"}},
			[]bool{false, true, false}, []int64{0, 275, 0}, 275},
	}
	for _, c := range cases {
		app, err := Evaluate(active(c.terms), venue, noon, lines())
		if err != nil {
			t.Fatalf("%s: %v", c.name, err)
		}
		if !reflect.DeepEqual(app.Eligible, c.wantEligible) || !reflect.DeepEqual(app.LineDiscounts, c.wantLines) ||
			app.DiscountCents != c.wantDiscount || app.Version != 3 || app.PromotionID != "p1" || app.Currency != "NZD" ||
			!app.EvaluatedAt.Equal(noon) {
			t.Errorf("%s: %+v", c.name, app)
		}
	}
}

func TestEvaluateRefusals(t *testing.T) {
	reason := func(err error) Reason {
		var na *NotApplicableError
		if errors.As(err, &na) {
			return na.Reason
		}
		return Reason("error: " + errorString(err))
	}
	inactive := active(tenPercent())
	inactive.Status = StatusInactive
	window := tenPercent()
	window.StartsAt, window.EndsAt = at(noon), at(noon.Add(time.Hour))
	drinksOnly := Terms{Name: "x", Kind: KindPercentage, BasisPoints: 1000, Target: TargetCategories, CategoryIDs: []string{"drinks"}}
	full := tenPercent()
	full.BasisPoints = 10000

	if _, err := Evaluate(Promotion{ID: "p1", VenueID: "other", Terms: tenPercent(), Status: StatusActive, Version: 1}, venue, noon, lines()); !errors.Is(err, ErrPromotionNotFound) {
		t.Errorf("another venue's promotion must look absent: %v", err)
	}
	for _, c := range []struct {
		name  string
		p     Promotion
		at    time.Time
		lines []pricing.PricedLine
		want  Reason
	}{
		{"inactive", inactive, noon, lines(), ReasonInactive},
		{"one ms before start", active(window), noon.Add(-time.Millisecond), lines(), ReasonNotStarted},
		{"at end (exclusive)", active(window), noon.Add(time.Hour), lines(), ReasonEnded},
		{"no eligible line", active(drinksOnly), noon, lines()[:1], ReasonNoEligibleItems},
		{"eligible line has no positive total", active(tenPercent()), noon, []pricing.PricedLine{{MenuItemID: "x", LineTotalCents: 0}}, ReasonNoEligibleItems},
		{"100% of everything", active(full), noon, lines(), ReasonZeroTotal},
	} {
		if _, err := Evaluate(c.p, venue, c.at, c.lines); reason(err) != c.want {
			t.Errorf("%s: %v, want %s", c.name, err, c.want)
		}
	}
	// The window's own bounds: start is inclusive, one ms before the end is in.
	for _, instant := range []time.Time{noon, noon.Add(time.Hour - time.Millisecond)} {
		if _, err := Evaluate(active(window), venue, instant, lines()); err != nil {
			t.Errorf("at %s: %v", instant, err)
		}
	}
	// 100 % of SOME lines is fine: something is still paid.
	fullMains := Terms{Name: "x", Kind: KindPercentage, BasisPoints: 10000, Target: TargetCategories, CategoryIDs: []string{"mains"}}
	if app, err := Evaluate(active(fullMains), venue, noon, lines()); err != nil || app.DiscountCents != 1700 {
		t.Errorf("100%% of mains: %+v %v", app, err)
	}
}

func errorString(err error) string {
	if err == nil {
		return "nil"
	}
	return err.Error()
}

func TestDecideStatus(t *testing.T) {
	p := active(tenPercent())
	if d, err := DecideStatus(p, 1, StatusActive, ActionActivated); err != nil || d.Changed {
		t.Errorf("activating an active promotion is a no-op whatever the version: %+v %v", d, err)
	}
	var vc *VersionConflictError
	if _, err := DecideStatus(p, 2, StatusInactive, ActionDisabled); !errors.As(err, &vc) || vc.Current != 3 {
		t.Errorf("stale version: %v", err)
	}
	if d, err := DecideStatus(p, 3, StatusInactive, ActionDisabled); err != nil || !d.Changed || d.Next.Status != StatusInactive || d.Action != ActionDisabled {
		t.Errorf("deactivate: %+v %v", d, err)
	}
}

func TestPatchApply(t *testing.T) {
	base := Terms{Name: "Mains", Kind: KindPercentage, BasisPoints: 2000, Target: TargetCategories, CategoryIDs: []string{"mains"},
		StartsAt: at(noon), EndsAt: at(noon.Add(time.Hour))}
	same := TargetCategories
	if got := (Patch{Target: &same}).Apply(base); !reflect.DeepEqual(got.CategoryIDs, []string{"mains"}) {
		t.Errorf("an unchanged target keeps its list: %+v", got)
	}
	items := TargetMenuItems
	ids := []string{"burger"}
	got, err := (Patch{Target: &items, MenuItemIDs: &ids, ClearStartsAt: true}).Apply(base).Normalize()
	if err != nil || got.Target != TargetMenuItems || len(got.CategoryIDs) != 0 || got.StartsAt != nil || got.EndsAt == nil {
		t.Errorf("retarget: %+v %v", got, err)
	}
	if _, err := (Patch{Target: &items}).Apply(base).Normalize(); err == nil {
		t.Error("a new target needs its list")
	}
}

func TestFingerprint(t *testing.T) {
	a, _ := tenPercent().Normalize()
	b := a
	b.BasisPoints = 1001
	if Fingerprint("v1", a) != Fingerprint("v1", a) || Fingerprint("v1", a) == Fingerprint("v2", a) || Fingerprint("v1", a) == Fingerprint("v1", b) {
		t.Error("fingerprint is not the request identity")
	}
	if !sameTerms(a, a) || sameTerms(a, b) {
		t.Error("sameTerms")
	}
}
