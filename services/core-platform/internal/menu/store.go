package menu

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Store reads menu data. PostgresStore is the production implementation.
type Store interface {
	// ActiveVenueOrganization returns the organization of an active venue,
	// or found=false when the venue does not exist or is inactive.
	ActiveVenueOrganization(ctx context.Context, venueID string) (organizationID string, found bool, err error)
	Snapshot(ctx context.Context, organizationID, venueID string, channel Channel) (Snapshot, error)
}

// PostgresStore queries the Prisma-managed tables directly, read-only.
type PostgresStore struct{ pool *pgxpool.Pool }

func NewPostgresStore(pool *pgxpool.Pool) *PostgresStore { return &PostgresStore{pool: pool} }

func (s *PostgresStore) ActiveVenueOrganization(ctx context.Context, venueID string) (string, bool, error) {
	var org string
	err := s.pool.QueryRow(ctx,
		`SELECT "organizationId" FROM "Venue" WHERE id = $1 AND "isActive"`, venueID).Scan(&org)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", false, nil
	}
	if err != nil {
		return "", false, fmt.Errorf("load venue: %w", err)
	}
	return org, true, nil
}

// Ordering: Nest orders by "sortOrder" only, leaving ties in whatever order
// PostgreSQL returns. `id` is added as a tie-breaker so the response is
// deterministic; that is one of the orders Nest can already produce.
const (
	categoriesSQL = `
SELECT id, name, description, "imageUrl", "sortOrder", "isActive", "visibleChannels"::text[]
FROM "Category"
WHERE "organizationId" = $1 AND "isActive" AND $2::"MenuChannel" = ANY("visibleChannels")
ORDER BY "sortOrder" ASC, id ASC`

	itemsSQL = `
SELECT id, "categoryId", "subCategory", title, description, "imageUrl", "imageThumbnailUrl",
       "priceCents", "nutritionalDetails", "modifierGroups", "isSpicy", "isAvailable",
       "isFeatured", "sortOrder", "visibleChannels"::text[]
FROM "MenuItem"
WHERE "organizationId" = $1 AND "deletedAt" IS NULL AND $2::"MenuChannel" = ANY("visibleChannels")
ORDER BY "sortOrder" ASC, id ASC`

	overridesSQL = `
SELECT "menuItemId", "priceCents", "isAvailable"
FROM "MenuItemVenueOverride"
WHERE "venueId" = $1`
)

// Snapshot reads categories, items and overrides in one read-only,
// repeatable-read transaction, so the three sets are mutually consistent
// (Nest issues them as three independent queries).
func (s *PostgresStore) Snapshot(ctx context.Context, organizationID, venueID string, channel Channel) (Snapshot, error) {
	var snap Snapshot
	err := pgx.BeginTxFunc(ctx, s.pool, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly},
		func(tx pgx.Tx) error {
			var err error
			if snap.Categories, err = queryCategories(ctx, tx, organizationID, channel); err != nil {
				return err
			}
			if snap.Items, err = queryItems(ctx, tx, organizationID, channel); err != nil {
				return err
			}
			snap.Overrides, err = queryOverrides(ctx, tx, venueID)
			return err
		})
	return snap, err
}

func queryCategories(ctx context.Context, tx pgx.Tx, org string, channel Channel) ([]Category, error) {
	rows, err := tx.Query(ctx, categoriesSQL, org, string(channel))
	if err != nil {
		return nil, fmt.Errorf("query categories: %w", err)
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (Category, error) {
		var c Category
		err := row.Scan(&c.ID, &c.Name, &c.Description, &c.ImageURL, &c.SortOrder, &c.IsActive, &c.VisibleChannels)
		return c, err
	})
}

func queryItems(ctx context.Context, tx pgx.Tx, org string, channel Channel) ([]Item, error) {
	rows, err := tx.Query(ctx, itemsSQL, org, string(channel))
	if err != nil {
		return nil, fmt.Errorf("query menu items: %w", err)
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (Item, error) {
		var it Item
		var nutritional, modifiers []byte
		err := row.Scan(&it.ID, &it.CategoryID, &it.SubCategory, &it.Title, &it.Description, &it.ImageURL,
			&it.ImageThumbnailURL, &it.PriceCents, &nutritional, &modifiers, &it.IsSpicy, &it.IsAvailable,
			&it.IsFeatured, &it.SortOrder, &it.VisibleChannels)
		it.NutritionalDetails, it.ModifierGroups = nutritional, modifiers
		return it, err
	})
}

func queryOverrides(ctx context.Context, tx pgx.Tx, venueID string) ([]Override, error) {
	rows, err := tx.Query(ctx, overridesSQL, venueID)
	if err != nil {
		return nil, fmt.Errorf("query venue overrides: %w", err)
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (Override, error) {
		var o Override
		err := row.Scan(&o.MenuItemID, &o.PriceCents, &o.IsAvailable)
		return o, err
	})
}
