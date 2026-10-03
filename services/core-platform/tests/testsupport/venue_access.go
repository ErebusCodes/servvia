package testsupport

import (
	"context"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
)

// GrantVenueAccess gives each staff member a VenueAccess grant for each
// venue, as Servvia Core requires for any venue-scoped staff request (PRD
// section 16 item 3). The grants' foreign keys are ON DELETE RESTRICT, so a
// fixture that deletes its venues must delete "VenueAccess" for them first
// (each fixture's cleanup does). The cleanup registered here also removes
// the grants, for callers whose venues outlive the test.
func GrantVenueAccess(t *testing.T, ctx context.Context, db *pgxpool.Pool, grantedBy string, staffIDs, venueIDs []string) {
	t.Helper()
	for _, s := range staffIDs {
		for _, v := range venueIDs {
			if _, err := db.Exec(ctx, `INSERT INTO "VenueAccess"(id,"staffId","venueId","grantedById") VALUES($1,$2,$3,$4)`,
				UUID(), s, v, grantedBy); err != nil {
				t.Fatalf("grant venue access: %v", err)
			}
		}
	}
	t.Cleanup(func() {
		if _, err := db.Exec(context.Background(), `DELETE FROM "VenueAccess" WHERE "staffId" = ANY($1) AND "venueId" = ANY($2)`,
			staffIDs, venueIDs); err != nil {
			t.Errorf("cleanup venue access: %v", err)
		}
	})
}
