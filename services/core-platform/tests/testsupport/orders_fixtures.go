package testsupport

import (
	"context"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
)

// OrdersFixture is an organization with staff, the pricing catalog of
// SeedPricingFixture, and tables at its NZ venue.
type OrdersFixture struct {
	PricingFixture
	Owner, Cashier string
	// Tables of Venue (tableNumber "1".."3") and of TaxlessVenue.
	TableA, TableB, TableC, TaxlessTable string
	// A second category of the organization, "Drinks", with one item, Soda
	// (400), published on no channel: promotion eligibility by category
	// (Phase D11). Every other item is in the pricing fixture's category,
	// PricingCategory.
	Drinks, Soda, PricingCategory string
}

// SeedOrdersFixture creates the rows and removes them, with every order,
// round, line, outbox event, audit row and table session written against
// them, when the test ends. Disposable databases only.
func SeedOrdersFixture(t *testing.T, ctx context.Context, db *pgxpool.Pool) OrdersFixture {
	t.Helper()
	must := func(sql string, args ...any) {
		t.Helper()
		if _, err := db.Exec(ctx, sql, args...); err != nil {
			t.Fatalf("seed: %v\n%s", err, sql)
		}
	}
	org, owner, cashier := UUID(), UUID(), UUID()
	must(`INSERT INTO "Organization"(id,name,slug,"billingEmail","updatedAt") VALUES($1,'Orders Fixture',$1,'billing@example.test',now())`, org)
	staff := `INSERT INTO "Staff"(id,"organizationId",email,name,"passwordHash",role,"updatedAt") VALUES($1,$2,$1||'@example.test','Fixture','x',$3,now())`
	must(staff, owner, org, "owner")
	must(staff, cashier, org, "cashier")
	t.Cleanup(func() {
		for _, q := range []string{`DELETE FROM "Staff" WHERE "organizationId" = $1`, `DELETE FROM "Organization" WHERE id = $1`} {
			if _, err := db.Exec(context.Background(), q, org); err != nil {
				t.Errorf("cleanup: %v", err)
			}
		}
	})

	f := OrdersFixture{PricingFixture: SeedPricingFixture(t, ctx, db, org, owner), Owner: owner, Cashier: cashier,
		TableA: UUID(), TableB: UUID(), TableC: UUID(), TaxlessTable: UUID(), Drinks: UUID(), Soda: UUID()}
	if err := db.QueryRow(ctx, `SELECT "categoryId" FROM "MenuItem" WHERE id = $1`, f.Plain).Scan(&f.PricingCategory); err != nil {
		t.Fatal(err)
	}
	must(`INSERT INTO "Category"(id,"organizationId",name,"isActive","createdById","updatedAt") VALUES($1,$2,'Drinks',true,$3,now())`, f.Drinks, org, owner)
	must(`INSERT INTO "MenuItem"(id,"organizationId","categoryId",title,description,"priceCents","nutritionalDetails","createdById","updatedAt")
		VALUES($1,$2,$3,'Soda','fixture',400,'{}',$4,now())`, f.Soda, org, f.Drinks, owner)
	table := `INSERT INTO "Table"(id,"venueId","tableNumber",capacity,"sortOrder","updatedAt") VALUES($1,$2,$3,4,$4,now())`
	must(table, f.TableA, f.Venue, "1", 1)
	must(table, f.TableB, f.Venue, "2", 2)
	must(table, f.TableC, f.Venue, "3", 3)
	must(table, f.TaxlessTable, f.TaxlessVenue, "1", 1)

	// Registered last, so it runs first: everything that references the
	// venues, tables and staff above.
	t.Cleanup(func() {
		ctx := context.Background()
		venues := []string{f.Venue, f.TaxlessVenue}
		for _, q := range []struct {
			sql  string
			args []any
		}{
			// Payment history restricts deletes: cash movements, shifts,
			// settlements, transitions and payments go first, then checks
			// (lines cascade), then orders.
			{`DELETE FROM "CashMovement" WHERE "venueId" = ANY($1)`, []any{venues}},
			{`DELETE FROM "CheckSettlementTransition" WHERE "settlementId" IN (SELECT s.id FROM "CheckSettlement" s JOIN "Check" c ON c.id = s."checkId" WHERE c."venueId" = ANY($1))`, []any{venues}},
			{`DELETE FROM "PaymentAdjustmentTransition" WHERE "adjustmentId" IN (SELECT id FROM "PaymentAdjustment" WHERE "venueId" = ANY($1))`, []any{venues}},
			{`DELETE FROM "PaymentAdjustment" WHERE "venueId" = ANY($1)`, []any{venues}},
			{`DELETE FROM "Shift" WHERE "venueId" = ANY($1)`, []any{venues}},
			{`DELETE FROM "Terminal" WHERE "venueId" = ANY($1)`, []any{venues}},
			{`DELETE FROM "Device" WHERE "venueId" = ANY($1)`, []any{venues}},
			{`DELETE FROM "CheckSettlement" WHERE "checkId" IN (SELECT id FROM "Check" WHERE "venueId" = ANY($1))`, []any{venues}},
			{`DELETE FROM "CheckPaymentTransition" WHERE "paymentId" IN (SELECT id FROM "CheckPayment" WHERE "venueId" = ANY($1))`, []any{venues}},
			{`DELETE FROM "CheckPayment" WHERE "venueId" = ANY($1)`, []any{venues}},
			{`DELETE FROM "Check" WHERE "venueId" = ANY($1)`, []any{venues}}, // lines cascade; checks restrict order deletes
			{`DELETE FROM "Order" WHERE "venueId" = ANY($1)`, []any{venues}}, // rounds, lines and applied promotions cascade
			{`DELETE FROM "Promotion" WHERE "venueId" = ANY($1)`, []any{venues}},
			{`DELETE FROM "MenuItem" WHERE id = $1`, []any{f.Soda}},
			{`DELETE FROM "Category" WHERE id = $1`, []any{f.Drinks}},
			{`DELETE FROM "OutboxEvent" WHERE "venueId" = ANY($1)`, []any{venues}},
			{`DELETE FROM "RealtimeEvent" WHERE "venueId" = ANY($1)`, []any{venues}},
			{`DELETE FROM "DomainEvent" WHERE "venueId" = ANY($1)`, []any{venues}}, // deliveries cascade
			{`DELETE FROM "AuditLog" WHERE "organizationId" = $1`, []any{org}},
			{`DELETE FROM "TableSession" WHERE "tableId" IN (SELECT id FROM "Table" WHERE "venueId" = ANY($1))`, []any{venues}},
			{`DELETE FROM "Table" WHERE "venueId" = ANY($1)`, []any{venues}},
		} {
			if _, err := db.Exec(ctx, q.sql, q.args...); err != nil {
				t.Errorf("cleanup: %v", err)
			}
		}
	})
	return f
}
