package menu

import (
	"encoding/json"
	"testing"
)

// These cases mirror apps/api/src/menu/channel-menu-resolver.spec.ts. The
// store has already applied the per-row visibility filters, so the resolver's
// own rules are the category gate, overrides, availability and empty
// categories.

func ptr[T any](v T) *T { return &v }

func item(id, category string, price int, available bool) Item {
	return Item{
		ID: id, CategoryID: category, Title: id, PriceCents: price, IsAvailable: available,
		NutritionalDetails: json.RawMessage(`{}`), ModifierGroups: json.RawMessage(`[]`),
		VisibleChannels: []string{"order_tablet", "customer_website", "window_display"},
	}
}

func ids[T any](xs []T, id func(T) string) []string {
	out := make([]string, 0, len(xs))
	for _, x := range xs {
		out = append(out, id(x))
	}
	return out
}

func itemIDs(r Response) []string { return ids(r.MenuItems, func(i Item) string { return i.ID }) }
func categoryIDs(r Response) []string {
	return ids(r.Categories, func(c Category) string { return c.ID })
}

func equal(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

func TestOrderTabletKeepsUnavailableItemsCustomerChannelsDropThem(t *testing.T) {
	snap := Snapshot{
		Categories: []Category{{ID: "mains"}},
		Items:      []Item{item("a", "mains", 1000, true), item("b", "mains", 1200, false)},
	}
	if got := itemIDs(Resolve(snap, ChannelOrderTablet)); !equal(got, []string{"a", "b"}) {
		t.Fatalf("order_tablet = %v", got)
	}
	for _, c := range []Channel{ChannelCustomerWebsite, ChannelWindowDisplay} {
		if got := itemIDs(Resolve(snap, c)); !equal(got, []string{"a"}) {
			t.Fatalf("%s = %v", c, got)
		}
	}
}

func TestOverrideReEnablesThenAvailabilityPolicyApplies(t *testing.T) {
	snap := Snapshot{
		Categories: []Category{{ID: "mains"}},
		Items:      []Item{item("a", "mains", 1000, false), item("b", "mains", 1000, true)},
		Overrides: []Override{
			{MenuItemID: "a", IsAvailable: ptr(true)},
			{MenuItemID: "b", IsAvailable: ptr(false)},
		},
	}
	if got := itemIDs(Resolve(snap, ChannelCustomerWebsite)); !equal(got, []string{"a"}) {
		t.Fatalf("customer_website = %v", got)
	}
	r := Resolve(snap, ChannelOrderTablet)
	if !r.MenuItems[0].IsAvailable || r.MenuItems[1].IsAvailable {
		t.Fatalf("merged availability must be reported: %+v", r.MenuItems)
	}
}

func TestMergesVenuePriceOverride(t *testing.T) {
	snap := Snapshot{
		Categories: []Category{{ID: "mains"}},
		Items:      []Item{item("a", "mains", 1000, true), item("b", "mains", 2000, true)},
		Overrides:  []Override{{MenuItemID: "a", PriceCents: ptr(1500)}, {MenuItemID: "b"}},
	}
	r := Resolve(snap, ChannelOrderTablet)
	if r.MenuItems[0].PriceCents != 1500 || r.MenuItems[1].PriceCents != 2000 {
		t.Fatalf("prices = %d, %d", r.MenuItems[0].PriceCents, r.MenuItems[1].PriceCents)
	}
}

func TestCategoryVisibilityGatesItems(t *testing.T) {
	// Item "b" is visible on the channel but its category is not in the
	// channel's category set, so it must not appear.
	snap := Snapshot{
		Categories: []Category{{ID: "mains"}},
		Items:      []Item{item("a", "mains", 1000, true), item("b", "hidden", 1000, true)},
	}
	if got := itemIDs(Resolve(snap, ChannelWindowDisplay)); !equal(got, []string{"a"}) {
		t.Fatalf("items = %v", got)
	}
}

func TestDropsCategoriesWithNothingLeft(t *testing.T) {
	snap := Snapshot{
		Categories: []Category{{ID: "mains"}, {ID: "desserts"}, {ID: "empty"}},
		Items:      []Item{item("a", "mains", 1000, true), item("b", "desserts", 800, false)},
	}
	if got := categoryIDs(Resolve(snap, ChannelCustomerWebsite)); !equal(got, []string{"mains"}) {
		t.Fatalf("customer_website categories = %v", got)
	}
	if got := categoryIDs(Resolve(snap, ChannelOrderTablet)); !equal(got, []string{"mains", "desserts"}) {
		t.Fatalf("order_tablet categories = %v", got)
	}
}

func TestPreservesStoreOrderAndEncodesEmptyArrays(t *testing.T) {
	snap := Snapshot{
		Categories: []Category{{ID: "c2"}, {ID: "c1"}},
		Items:      []Item{item("z", "c2", 1, true), item("y", "c1", 1, true)},
	}
	if got := itemIDs(Resolve(snap, ChannelOrderTablet)); !equal(got, []string{"z", "y"}) {
		t.Fatalf("order = %v", got)
	}
	body, _ := json.Marshal(Resolve(Snapshot{}, ChannelOrderTablet))
	if string(body) != `{"categories":[],"menuItems":[]}` {
		t.Fatalf("empty menu = %s", body)
	}
}

func TestParseChannel(t *testing.T) {
	for _, c := range []string{"order_tablet", "customer_website", "window_display"} {
		if _, ok := ParseChannel(c); !ok {
			t.Errorf("%s must be valid", c)
		}
	}
	for _, c := range []string{"", "kiosk", "ORDER_TABLET"} {
		if _, ok := ParseChannel(c); ok {
			t.Errorf("%q must be invalid", c)
		}
	}
}
