package testsupport

import (
	"context"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// PricingFixture names the rows SeedPricingFixture creates. Every item
// exercises one pricing rule; see the comments in SeedPricingFixture.
type PricingFixture struct {
	Org          string
	Venue        string // NZD, NZ_GST, prices include tax: the verified profile
	TaxlessVenue string // prices exclude tax: no verified rule, totals refuse
	OtherOrg     string

	Plain, Override, OnHere, OffHere, Off, Deleted, OtherOrgItem string
	Burger, NoGroups, Messy, Fraction                            string
	Penny, Four, Twelve, Odd, Big                                string

	// Burger's groups and options.
	Size, Small, Large                             string
	Extras, Cheese, Bacon, Pickles, Truffle, Sauce string
	// Messy's usable group (no min/max given) and its option; Fraction's
	// half-cent option.
	MessyGroup, MessyOption, FractionGroup, HalfCent string
}

// SeedPricingFixture inserts a pricing catalog and removes it when the test
// ends. With org == "" it creates its own organization and staff; otherwise
// the rows go into org, created by staffID (the parity suite uses the seeded
// organization so the seeded owner can place orders). Use only on a
// disposable database.
func SeedPricingFixture(t *testing.T, ctx context.Context, db *pgxpool.Pool, org, staffID string) PricingFixture {
	t.Helper()
	must := func(sql string, args ...any) {
		t.Helper()
		if _, err := db.Exec(ctx, sql, args...); err != nil {
			t.Fatalf("seed: %v\n%s", err, sql)
		}
	}
	f := PricingFixture{Org: org, Venue: UUID(), TaxlessVenue: UUID(), OtherOrg: UUID()}
	for _, id := range []*string{&f.Plain, &f.Override, &f.OnHere, &f.OffHere, &f.Off, &f.Deleted, &f.OtherOrgItem,
		&f.Burger, &f.NoGroups, &f.Messy, &f.Fraction, &f.Penny, &f.Four, &f.Twelve, &f.Odd, &f.Big,
		&f.Size, &f.Small, &f.Large, &f.Extras, &f.Cheese, &f.Bacon, &f.Pickles, &f.Truffle, &f.Sauce,
		&f.MessyGroup, &f.MessyOption, &f.FractionGroup, &f.HalfCent} {
		*id = UUID()
	}
	ownOrg := org == ""
	if ownOrg {
		f.Org, staffID = UUID(), UUID()
	}
	otherStaff := UUID()
	orgs := []string{f.OtherOrg}
	if ownOrg {
		orgs = append(orgs, f.Org)
	}
	for _, o := range orgs {
		must(`INSERT INTO "Organization"(id,name,slug,"billingEmail","updatedAt") VALUES($1,'Pricing Fixture',$1,'billing@example.test',now())`, o)
	}
	staff := `INSERT INTO "Staff"(id,"organizationId",email,name,"passwordHash",role,"updatedAt") VALUES($1,$2,$1||'@example.test','Fixture','x','owner',now())`
	if ownOrg {
		must(staff, staffID, f.Org)
	}
	must(staff, otherStaff, f.OtherOrg)
	venue := `INSERT INTO "Venue"(id,"organizationId",name,slug,address,"operatingHours","seatingCapacity","pricesIncludeTax","updatedAt")
		VALUES($1,$2,'Pricing Fixture',$1,'{}','{}',40,$3,now())`
	must(venue, f.Venue, f.Org, true)
	must(venue, f.TaxlessVenue, f.Org, false)
	// The staff member the fixture acts as holds both venues, also in a
	// caller's organization (the parity suite's seeded owner): staff act only
	// in granted venues, in Core and in the Nest API (Stories 2.2 and 2.10).
	GrantVenueAccess(t, ctx, db, staffID, []string{staffID}, []string{f.Venue, f.TaxlessVenue})

	cat, otherCat := UUID(), UUID()
	category := `INSERT INTO "Category"(id,"organizationId",name,"isActive","visibleChannels","createdById","updatedAt")
		VALUES($1,$2,$3,true,'{order_tablet,customer_website,window_display}',$4,now())`
	must(category, cat, f.Org, "Pricing Mains", staffID)
	must(category, otherCat, f.OtherOrg, "Other", otherStaff)

	burgerGroups := `[
	 {"id":"` + f.Size + `","name":"Size","required":true,"minSelections":1,"maxSelections":1,"options":[
	   {"id":"` + f.Small + `","name":"Small","priceDeltaCents":0,"isAvailable":true,"sortOrder":0},
	   {"id":"` + f.Large + `","name":"Large","priceDeltaCents":250,"isAvailable":true,"sortOrder":1}]},
	 {"id":"` + f.Extras + `","name":"Extras","required":false,"minSelections":0,"maxSelections":2,"options":[
	   {"id":"` + f.Cheese + `","name":"Cheese","priceDeltaCents":150,"isAvailable":true},
	   {"id":"` + f.Bacon + `","name":"Bacon","priceDeltaCents":300,"isAvailable":true},
	   {"id":"` + f.Pickles + `","name":"Pickles","priceDeltaCents":0,"isAvailable":true},
	   {"id":"` + f.Truffle + `","name":"Truffle","priceDeltaCents":900,"isAvailable":false},
	   {"id":"` + f.Sauce + `","name":"No sauce","priceDeltaCents":-50,"isAvailable":true}]}]`
	// Tolerated junk around one usable group whose min/max are left to the defaults.
	messyGroups := `[null, 7, {"name":"no id"},
	 {"id":"` + f.MessyGroup + `","name":"Sauce","options":[
	   {"id":"` + UUID() + `","name":"no price"},
	   {"id":"` + f.MessyOption + `","name":"Aioli","priceDeltaCents":120},
	   {"id":"` + UUID() + `","name":"string price","priceDeltaCents":"99"}]}]`
	fractionGroups := `[{"id":"` + f.FractionGroup + `","name":"Glaze","options":[
	   {"id":"` + f.HalfCent + `","name":"Half cent","priceDeltaCents":12.5}]}]`

	item := `INSERT INTO "MenuItem"(id,"organizationId","categoryId",title,description,"priceCents","nutritionalDetails",
		"modifierGroups","isAvailable","visibleChannels","createdById","deletedAt","updatedAt")
		VALUES($1,$2,$3,$4,'fixture',$5,'{}',$6,$7,'{order_tablet,customer_website,window_display}',$8,$9,now())`
	var live *time.Time
	deleted := time.Now().UTC()
	for _, it := range []struct {
		id, title string
		price     int
		groups    string
		available bool
		deleted   *time.Time
	}{
		{f.Plain, "Flat White", 550, `[]`, true, live},
		{f.Override, "Lamb", 1000, `[]`, true, live},      // overridden to 1250 at Venue
		{f.OnHere, "Special", 2200, `[]`, false, live},    // re-enabled at Venue
		{f.OffHere, "Fish", 2600, `[]`, true, live},       // disabled at Venue
		{f.Off, "Soup", 900, `[]`, false, live},           // unavailable everywhere
		{f.Deleted, "Deleted", 900, `[]`, true, &deleted}, // soft-deleted: not found
		{f.Burger, "Burger", 1800, burgerGroups, true, live},
		{f.NoGroups, "Chips", 700, `[]`, true, live},
		{f.Messy, "Messy", 1000, messyGroups, true, live},
		{f.Fraction, "Glazed", 1000, fractionGroups, true, live},
		{f.Penny, "Penny", 1, `[]`, true, live},    // GST 0.13 -> 0
		{f.Four, "Four", 4, `[]`, true, live},      // GST 0.52 -> 1
		{f.Twelve, "Twelve", 12, `[]`, true, live}, // GST 1.57 -> 2
		{f.Odd, "Odd", 1999, `[]`, true, live},     // GST 260.74 -> 261
		{f.Big, "Big", 99999, `[]`, true, live},    // GST 13043.35 -> 13043
	} {
		must(item, it.id, f.Org, cat, it.title, it.price, it.groups, it.available, staffID, it.deleted)
	}
	must(item, f.OtherOrgItem, f.OtherOrg, otherCat, "Other org", 100, `[]`, true, otherStaff, live)

	override := `INSERT INTO "MenuItemVenueOverride"(id,"menuItemId","venueId","priceCents","isAvailable","updatedAt") VALUES($1,$2,$3,$4,$5,now())`
	must(override, UUID(), f.Override, f.Venue, 1250, nil)
	must(override, UUID(), f.OnHere, f.Venue, nil, true)
	must(override, UUID(), f.OffHere, f.Venue, nil, false)

	t.Cleanup(func() {
		ctx := context.Background()
		venues := []string{f.Venue, f.TaxlessVenue}
		// Staff and organizations are removed only if this fixture created
		// them; the parity suite's seeded owner and organization stay.
		for _, q := range []struct {
			sql  string
			args []any
		}{
			{`DELETE FROM "MenuItemVenueOverride" WHERE "venueId" = ANY($1)`, []any{venues}},
			{`DELETE FROM "MenuItem" WHERE "categoryId" = ANY($1)`, []any{[]string{cat, otherCat}}},
			{`DELETE FROM "Category" WHERE id = ANY($1)`, []any{[]string{cat, otherCat}}},
			{`DELETE FROM "VenueAccess" WHERE "venueId" = ANY($1)`, []any{venues}},
			{`DELETE FROM "Venue" WHERE id = ANY($1)`, []any{venues}},
			{`DELETE FROM "Staff" WHERE id = $1`, []any{otherStaff}},
			{`DELETE FROM "Organization" WHERE id = $1`, []any{f.OtherOrg}},
		} {
			if _, err := db.Exec(ctx, q.sql, q.args...); err != nil {
				t.Errorf("cleanup: %v", err)
			}
		}
		if ownOrg {
			for _, q := range []string{`DELETE FROM "Staff" WHERE "organizationId" = $1`, `DELETE FROM "Organization" WHERE id = $1`} {
				if _, err := db.Exec(ctx, q, f.Org); err != nil {
					t.Errorf("cleanup: %v", err)
				}
			}
		}
	})
	return f
}
