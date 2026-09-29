package venues

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Store reads organizations and venues. PostgresStore is the production
// implementation. found=false means no such row, never an error.
type Store interface {
	// Venue returns a venue by id, active or not (the NestJS order path's
	// resolveVenue does not check isActive either).
	Venue(ctx context.Context, venueID string) (v Venue, found bool, err error)
	// VenueInOrganization returns a venue only if it belongs to the
	// organization: the tenancy rule every staff-facing venue read applies.
	VenueInOrganization(ctx context.Context, venueID, organizationID string) (v Venue, found bool, err error)
	Organization(ctx context.Context, organizationID string) (o Organization, found bool, err error)
}

// PostgresStore queries the Prisma-managed tables directly, read-only.
type PostgresStore struct{ pool *pgxpool.Pool }

func NewPostgresStore(pool *pgxpool.Pool) *PostgresStore { return &PostgresStore{pool: pool} }

// venueColumns never includes posAdapterType or posConfig; see package doc.
const venueColumns = `id, "organizationId", name, slug, timezone, "isActive",
       currency, locale, "taxJurisdiction", "pricesIncludeTax"`

func (s *PostgresStore) Venue(ctx context.Context, venueID string) (Venue, bool, error) {
	return s.venue(ctx, `SELECT `+venueColumns+` FROM "Venue" WHERE id = $1`, venueID)
}

func (s *PostgresStore) VenueInOrganization(ctx context.Context, venueID, organizationID string) (Venue, bool, error) {
	return s.venue(ctx, `SELECT `+venueColumns+` FROM "Venue" WHERE id = $1 AND "organizationId" = $2`,
		venueID, organizationID)
}

func (s *PostgresStore) venue(ctx context.Context, sql string, args ...any) (Venue, bool, error) {
	var v Venue
	err := s.pool.QueryRow(ctx, sql, args...).Scan(&v.ID, &v.OrganizationID, &v.Name, &v.Slug, &v.Timezone,
		&v.IsActive, &v.Tax.Currency, &v.Tax.Locale, &v.Tax.TaxJurisdiction, &v.Tax.PricesIncludeTax)
	if errors.Is(err, pgx.ErrNoRows) {
		return Venue{}, false, nil
	}
	if err != nil {
		return Venue{}, false, fmt.Errorf("load venue: %w", err)
	}
	return v, true, nil
}

func (s *PostgresStore) Organization(ctx context.Context, organizationID string) (Organization, bool, error) {
	var o Organization
	err := s.pool.QueryRow(ctx, `SELECT id, name, slug, "isActive" FROM "Organization" WHERE id = $1`, organizationID).
		Scan(&o.ID, &o.Name, &o.Slug, &o.IsActive)
	if errors.Is(err, pgx.ErrNoRows) {
		return Organization{}, false, nil
	}
	if err != nil {
		return Organization{}, false, fmt.Errorf("load organization: %w", err)
	}
	return o, true, nil
}
