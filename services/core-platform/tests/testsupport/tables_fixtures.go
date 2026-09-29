package testsupport

import (
	"context"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
)

// TablesFixture names the rows SeedTablesFixture creates.
type TablesFixture struct {
	Org, Venue, OtherVenue  string
	OtherOrg, OtherOrgVenue string
	// Staff members of Org: an owner and a cashier (a waiter).
	Owner, Cashier string
	// Tables of Venue.
	TableA, TableB, Inactive, Busy string
	// BusyOrder is the legacy active order occupying Busy.
	BusyOrder string
	// A table of OtherVenue (same organization) and of OtherOrgVenue.
	OtherVenueTable, OtherOrgTable string
}

// SeedTablesFixture inserts two organizations, their venues and tables, and a
// legacy active order, and removes them (and every table session and audit
// row written against them) when the test ends. Disposable databases only.
func SeedTablesFixture(t *testing.T, ctx context.Context, db *pgxpool.Pool) TablesFixture {
	t.Helper()
	f := TablesFixture{Org: UUID(), Venue: UUID(), OtherVenue: UUID(), OtherOrg: UUID(), OtherOrgVenue: UUID(),
		Owner: UUID(), Cashier: UUID(), TableA: UUID(), TableB: UUID(), Inactive: UUID(), Busy: UUID(),
		BusyOrder: "ORD-FIXTURE-" + UUID()[:8], OtherVenueTable: UUID(), OtherOrgTable: UUID()}
	otherOrgStaff := UUID()
	must := func(sql string, args ...any) {
		t.Helper()
		if _, err := db.Exec(ctx, sql, args...); err != nil {
			t.Fatalf("seed: %v\n%s", err, sql)
		}
	}
	for _, o := range []string{f.Org, f.OtherOrg} {
		must(`INSERT INTO "Organization"(id,name,slug,"billingEmail","updatedAt") VALUES($1,'Tables Fixture',$1,'billing@example.test',now())`, o)
	}
	staff := `INSERT INTO "Staff"(id,"organizationId",email,name,"passwordHash",role,"updatedAt") VALUES($1,$2,$1||'@example.test','Fixture','x',$3,now())`
	must(staff, f.Owner, f.Org, "owner")
	must(staff, f.Cashier, f.Org, "cashier")
	must(staff, otherOrgStaff, f.OtherOrg, "owner")
	venue := `INSERT INTO "Venue"(id,"organizationId",name,slug,address,"operatingHours","seatingCapacity","updatedAt")
		VALUES($1,$2,'Tables Fixture',$1,'{}','{}',40,now())`
	must(venue, f.Venue, f.Org)
	must(venue, f.OtherVenue, f.Org)
	must(venue, f.OtherOrgVenue, f.OtherOrg)
	table := `INSERT INTO "Table"(id,"venueId","tableNumber",capacity,"isActive","sortOrder","updatedAt") VALUES($1,$2,$3,4,$4,$5,now())`
	must(table, f.TableA, f.Venue, "1", true, 1)
	must(table, f.TableB, f.Venue, "2", true, 2)
	must(table, f.Inactive, f.Venue, "3", false, 3)
	must(table, f.Busy, f.Venue, "4", true, 4)
	must(table, f.OtherVenueTable, f.OtherVenue, "1", true, 1)
	must(table, f.OtherOrgTable, f.OtherOrgVenue, "1", true, 1)
	// The legacy order path's occupancy: an active order on Busy.
	must(`INSERT INTO "Order"(id,"venueId","tableId","tableNumber",status,"subtotalCents","totalCents","idempotencyKey","updatedAt")
		VALUES($1,$2,$3,'4','confirmed',1000,1000,$1,now())`, f.BusyOrder, f.Venue, f.Busy)

	t.Cleanup(func() {
		ctx := context.Background()
		venues := []string{f.Venue, f.OtherVenue, f.OtherOrgVenue}
		orgs := []string{f.Org, f.OtherOrg}
		for _, q := range []struct {
			sql string
			ids []string
		}{
			{`DELETE FROM "TableSession" WHERE "tableId" IN (SELECT id FROM "Table" WHERE "venueId" = ANY($1))`, venues},
			{`DELETE FROM "AuditLog" WHERE "organizationId" = ANY($1)`, orgs},
			{`DELETE FROM "Order" WHERE "venueId" = ANY($1)`, venues},
			{`DELETE FROM "Table" WHERE "venueId" = ANY($1)`, venues},
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
