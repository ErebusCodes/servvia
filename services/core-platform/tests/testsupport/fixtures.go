package testsupport

import (
	"context"
	"crypto/rand"
	"fmt"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

// UUID returns a random v4 UUID for fixtures.
func UUID() string {
	var b [16]byte
	_, _ = rand.Read(b[:])
	b[6], b[8] = b[6]&0x0f|0x40, b[8]&0x3f|0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}

// MenuFixture names the rows SeedMenuFixture creates. Each item exercises one
// channel-menu rule; see the field comments in SeedMenuFixture.
type MenuFixture struct {
	Venue         string // active venue with overrides
	InactiveVenue string // Venue.isActive = false: menu is 404

	VisibleCat     string // active, visible on every channel
	TabletOnlyCat  string // visible on order_tablet only
	InactiveCat    string // Category.isActive = false
	DeletedOnlyCat string // its only item is soft-deleted, so it is dropped

	Price              string // price overridden at the venue (1000 -> 1500)
	ReEnabled          string // unavailable by default, re-enabled by override
	DisabledByOverride string // available by default, disabled by override
	CatGated           string // visible everywhere, but its category is tablet-only
	InInactiveCategory string // never shown
	Deleted            string // deletedAt set: never shown
	Unpublished        string // visibleChannels = []: never shown
	WithPLU            string // has posProductCode, which must not reach the wire
	OtherOrgItem       string // belongs to another organization
}

type exec interface {
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
}

// SeedMenuFixture inserts an isolated organization (plus a second one that
// must never leak) with every case the channel-menu resolver distinguishes,
// and removes it all when the test ends. Use only on a disposable database.
func SeedMenuFixture(t *testing.T, ctx context.Context, db *pgxpool.Pool) MenuFixture {
	t.Helper()
	f := MenuFixture{
		Venue: UUID(), InactiveVenue: UUID(),
		VisibleCat: UUID(), TabletOnlyCat: UUID(), InactiveCat: UUID(), DeletedOnlyCat: UUID(),
		Price: UUID(), ReEnabled: UUID(), DisabledByOverride: UUID(), CatGated: UUID(), InInactiveCategory: UUID(),
		Deleted: UUID(), Unpublished: UUID(), WithPLU: UUID(), OtherOrgItem: UUID(),
	}
	org, otherOrg, staff, otherStaff, otherCat := UUID(), UUID(), UUID(), UUID(), UUID()
	all := `{order_tablet,customer_website,window_display}`
	must := func(e exec, sql string, args ...any) {
		t.Helper()
		if _, err := e.Exec(ctx, sql, args...); err != nil {
			t.Fatalf("seed: %v\n%s", err, sql)
		}
	}

	for _, o := range []string{org, otherOrg} {
		must(db, `INSERT INTO "Organization"(id,name,slug,"billingEmail","updatedAt") VALUES($1,'Fixture Org',$1,'billing@example.test',now())`, o)
	}
	must(db, `INSERT INTO "Staff"(id,"organizationId",email,name,"passwordHash",role,"updatedAt") VALUES($1,$2,$1||'@example.test','Fixture','x','owner',now())`, staff, org)
	must(db, `INSERT INTO "Staff"(id,"organizationId",email,name,"passwordHash",role,"updatedAt") VALUES($1,$2,$1||'@example.test','Fixture','x','owner',now())`, otherStaff, otherOrg)
	for _, v := range []struct {
		id     string
		active bool
	}{{f.Venue, true}, {f.InactiveVenue, false}} {
		must(db, `INSERT INTO "Venue"(id,"organizationId",name,slug,address,"operatingHours","seatingCapacity","isActive","updatedAt")
			VALUES($1,$2,'Fixture Venue',$1,'{}','{}',40,$3,now())`, v.id, org, v.active)
	}

	cat := `INSERT INTO "Category"(id,"organizationId",name,"sortOrder","isActive","visibleChannels","createdById","updatedAt")
		VALUES($1,$2,$3,$4,$5,$6::"MenuChannel"[],$7,now())`
	must(db, cat, f.VisibleCat, org, "Mains", 1, true, all, staff)
	must(db, cat, f.TabletOnlyCat, org, "Staff meals", 0, true, `{order_tablet}`, staff)
	must(db, cat, f.InactiveCat, org, "Retired", 2, false, all, staff)
	must(db, cat, f.DeletedOnlyCat, org, "Emptied", 3, true, all, staff)
	must(db, cat, otherCat, otherOrg, "Other org", 0, true, all, otherStaff)

	item := `INSERT INTO "MenuItem"(id,"organizationId","categoryId",title,description,"priceCents","nutritionalDetails",
		"modifierGroups","isAvailable","sortOrder","visibleChannels","createdById","deletedAt","posProductCode","updatedAt")
		VALUES($1,$2,$3,$4,'desc',$5,'{"calories":1}',$6,$7,$8,$9::"MenuChannel"[],$10,$11,$12,now())`
	noMods := `[]`
	mods := `[{"id":"` + UUID() + `","name":"Size","required":true,"minSelections":1,"maxSelections":1,"options":[{"id":"` +
		UUID() + `","name":"Large","priceDeltaCents":200,"isAvailable":true,"sortOrder":0}]}]`
	var none *time.Time
	deletedAt := time.Now().UTC()
	var noPLU *string
	plu := "PLU-" + f.WithPLU[:8]
	must(db, item, f.Price, org, f.VisibleCat, "Priced", 1000, mods, true, 1, all, staff, none, noPLU)
	must(db, item, f.ReEnabled, org, f.VisibleCat, "ReEnabled", 1100, noMods, false, 2, all, staff, none, noPLU)
	must(db, item, f.DisabledByOverride, org, f.VisibleCat, "Disabled", 1200, noMods, true, 3, all, staff, none, noPLU)
	must(db, item, f.CatGated, org, f.TabletOnlyCat, "CategoryGated", 900, noMods, true, 0, all, staff, none, noPLU)
	must(db, item, f.InInactiveCategory, org, f.InactiveCat, "InInactiveCategory", 900, noMods, true, 0, all, staff, none, noPLU)
	must(db, item, f.Deleted, org, f.DeletedOnlyCat, "Deleted", 900, noMods, true, 0, all, staff, &deletedAt, noPLU)
	must(db, item, f.Unpublished, org, f.VisibleCat, "Unpublished", 900, noMods, true, 0, `{}`, staff, none, noPLU)
	must(db, item, f.WithPLU, org, f.VisibleCat, "WithPLU", 800, noMods, true, 4, all, staff, none, &plu)
	must(db, item, f.OtherOrgItem, otherOrg, otherCat, "OtherOrg", 700, noMods, true, 0, all, otherStaff, none, noPLU)

	override := `INSERT INTO "MenuItemVenueOverride"(id,"menuItemId","venueId","priceCents","isAvailable","updatedAt") VALUES($1,$2,$3,$4,$5,now())`
	must(db, override, UUID(), f.Price, f.Venue, 1500, nil)
	must(db, override, UUID(), f.ReEnabled, f.Venue, nil, true)
	must(db, override, UUID(), f.DisabledByOverride, f.Venue, nil, false)
	GrantVenueAccess(t, ctx, db, staff, []string{staff}, []string{f.Venue, f.InactiveVenue})

	t.Cleanup(func() {
		ctx := context.Background()
		venues, orgs := []string{f.Venue, f.InactiveVenue}, []string{org, otherOrg}
		for _, q := range []struct {
			sql string
			ids []string
		}{
			{`DELETE FROM "MenuItemVenueOverride" WHERE "venueId" = ANY($1)`, venues},
			{`DELETE FROM "MenuItem" WHERE "organizationId" = ANY($1)`, orgs},
			{`DELETE FROM "Category" WHERE "organizationId" = ANY($1)`, orgs},
			{`DELETE FROM "VenueAccess" WHERE "venueId" = ANY($1)`, venues},
			{`DELETE FROM "Venue" WHERE id = ANY($1)`, venues},
			{`DELETE FROM "Staff" WHERE "organizationId" = ANY($1)`, orgs},
			{`DELETE FROM "Organization" WHERE id = ANY($1)`, orgs},
		} {
			if _, err := db.Exec(ctx, q.sql, q.ids); err != nil {
				t.Errorf("cleanup: %v", err)
			}
		}
	})
	return f
}
