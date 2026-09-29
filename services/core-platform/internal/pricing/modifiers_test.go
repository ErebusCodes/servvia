package pricing

import (
	"errors"
	"reflect"
	"testing"
)

// The column is parsed as tolerantly as Nest's parseModifierGroups: malformed
// entries are skipped, never fatal.
func TestParseModifierGroupsIsTolerant(t *testing.T) {
	raw := `[
	  null, 7, "x", [],
	  {"name":"no id"},
	  {"id":"g1","name":"Sauce","options":[
	     null,
	     {"id":"o1","name":"Aioli","priceDeltaCents":100},
	     {"id":"o2","name":"no price"},
	     {"id":"o3","name":"string price","priceDeltaCents":"100"},
	     {"id":"o4","name":"Unavailable","priceDeltaCents":0,"isAvailable":false},
	     {"id":"o5","name":"Truthy but not false","priceDeltaCents":0,"isAvailable":0},
	     {"id":"o6","name":"Half cent","priceDeltaCents":12.5}]},
	  {"id":"g2","name":"Defaults","required":"yes","options":"not an array"},
	  {"id":"g3","name":"Explicit","required":true,"minSelections":2,"maxSelections":1.5,"options":[]}
	]`
	got := ParseModifierGroups([]byte(raw))
	want := []ModifierGroup{
		{ID: "g1", Name: "Sauce", MinSelections: 0, MaxSelections: 4, Options: []ModifierOption{
			{ID: "o1", Name: "Aioli", IsAvailable: true, PriceDeltaCents: 100, WholeCents: true},
			{ID: "o4", Name: "Unavailable", IsAvailable: false, WholeCents: true},
			{ID: "o5", Name: "Truthy but not false", IsAvailable: true, WholeCents: true},
			{ID: "o6", Name: "Half cent", IsAvailable: true},
		}},
		{ID: "g2", Name: "Defaults", Required: false, MinSelections: 0, MaxSelections: 0},
		{ID: "g3", Name: "Explicit", Required: true, MinSelections: 2, MaxSelections: 1.5},
	}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("got  %+v\nwant %+v", got, want)
	}
	for _, notArray := range []string{`{}`, `null`, `"[]"`, ``, `{"id":"g"}`} {
		if g := ParseModifierGroups([]byte(notArray)); len(g) != 0 {
			t.Errorf("%q parsed to %+v", notArray, g)
		}
	}
}

func TestSelectionCountRules(t *testing.T) {
	groups := `[{"id":"g","name":"Sides","required":true,"minSelections":2,"maxSelections":3,"options":[
	  {"id":"a","name":"A","priceDeltaCents":1},{"id":"b","name":"B","priceDeltaCents":2},
	  {"id":"c","name":"C","priceDeltaCents":3},{"id":"d","name":"D","priceDeltaCents":4}]},
	  {"id":"opt","name":"Optional","minSelections":2,"options":[
	  {"id":"x","name":"X","priceDeltaCents":10},{"id":"y","name":"Y","priceDeltaCents":20}]}]`
	cat := map[string]CatalogItem{"i": {ID: "i", Title: "Plate", PriceCents: 1000, IsAvailable: true, ModifierGroups: []byte(groups)}}
	price := func(mods ...ModifierSelection) (int64, error) {
		lines, _, err := PriceLines(cat, []LineRequest{line("i", 1, mods...)})
		if err != nil {
			return 0, err
		}
		return lines[0].UnitPriceCents, nil
	}
	msg := func(err error) string {
		var pe *Error
		if errors.As(err, &pe) {
			return pe.Message
		}
		return ""
	}

	if _, err := price(sel("g", "a")); msg(err) != `"Sides" requires at least 2 selection(s)` {
		t.Errorf("min: %v", err)
	}
	if _, err := price(sel("g", "a"), sel("g", "b"), sel("g", "c"), sel("g", "d")); msg(err) != `"Sides" allows at most 3 selection(s)` {
		t.Errorf("max: %v", err)
	}
	// An optional group's minimum only applies once something is chosen from it.
	if p, err := price(sel("g", "a"), sel("g", "b")); err != nil || p != 1003 {
		t.Errorf("optional untouched: %d %v", p, err)
	}
	if _, err := price(sel("g", "a"), sel("g", "b"), sel("opt", "x")); msg(err) != `"Optional" requires at least 2 selection(s)` {
		t.Errorf("optional min: %v", err)
	}
	if p, err := price(sel("opt", "y"), sel("g", "c"), sel("opt", "x"), sel("g", "a")); err != nil || p != 1034 {
		t.Errorf("all: %d %v", p, err)
	}
}

func TestFractionalDeltaIsACatalogFaultOnlyWhenSelected(t *testing.T) {
	groups := `[{"id":"g","name":"G","options":[{"id":"ok","name":"Ok","priceDeltaCents":100},
	  {"id":"half","name":"Half","priceDeltaCents":0.5},{"id":"huge","name":"Huge","priceDeltaCents":1e12}]}]`
	cat := map[string]CatalogItem{"i": {ID: "i", Title: "T", PriceCents: 1000, IsAvailable: true, ModifierGroups: []byte(groups)}}
	if lines, _, err := PriceLines(cat, []LineRequest{line("i", 1, sel("g", "ok"))}); err != nil || lines[0].UnitPriceCents != 1100 {
		t.Fatalf("unselected corrupt options must not matter: %v", err)
	}
	for _, option := range []string{"half", "huge"} {
		_, _, err := PriceLines(cat, []LineRequest{line("i", 1, sel("g", option))})
		var pe *Error
		if !errors.As(err, &pe) || pe.Kind != KindCatalogInvalid {
			t.Errorf("%s: err = %v", option, err)
		}
	}
	// Group rules are still reported first, as Nest would.
	_, _, err := PriceLines(cat, []LineRequest{line("i", 1, sel("g", "half"), sel("g", "ok"), sel("g", "huge"), sel("g", "half"))})
	var pe *Error
	if !errors.As(err, &pe) || pe.Message != "Duplicate modifier option selected" {
		t.Errorf("err = %v", err)
	}
}

func TestDuplicateGroupIDsBehaveLikeNest(t *testing.T) {
	// Two groups share an id: lookups find the first, and both groups see the
	// same selections (Nest keys its per-group count by id).
	groups := `[{"id":"g","name":"First","maxSelections":1,"options":[{"id":"a","name":"A","priceDeltaCents":5}]},
	            {"id":"g","name":"Second","required":true,"options":[{"id":"b","name":"B","priceDeltaCents":7}]}]`
	cat := map[string]CatalogItem{"i": {ID: "i", Title: "T", PriceCents: 0, IsAvailable: true, ModifierGroups: []byte(groups)}}
	lines, _, err := PriceLines(cat, []LineRequest{line("i", 1, sel("g", "a"))})
	if err != nil || lines[0].UnitPriceCents != 5 || lines[0].Modifiers[0].ModifierGroupName != "First" {
		t.Fatalf("lines = %+v err = %v", lines, err)
	}
	if _, _, err := PriceLines(cat, []LineRequest{line("i", 1, sel("g", "b"))}); err == nil {
		t.Error("an option of the second same-id group is unknown to Nest's Array.find")
	}
}

func TestJSNumberFormatting(t *testing.T) {
	for f, want := range map[float64]string{0: "0", 1: "1", 2.5: "2.5", -3: "-3", 1e21: "1e+21", 0.1: "0.1"} {
		if got := jsNumber(f); got != want {
			t.Errorf("jsNumber(%v) = %q, want %q", f, got, want)
		}
	}
}
