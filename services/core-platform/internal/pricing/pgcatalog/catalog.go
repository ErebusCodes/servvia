// Package pgcatalog loads pricing.CatalogItem values from the Prisma-managed
// menu tables. It is the only database code pricing depends on, kept out of
// the pure pricing package.
package pgcatalog

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"servvia/services/core-platform/internal/pricing"
)

// Catalog implements pricing.Catalog.
type Catalog struct{ pool *pgxpool.Pool }

func New(pool *pgxpool.Pool) *Catalog { return &Catalog{pool: pool} }

// itemsSQL is Nest's per-line lookup (menuItem.findFirst where id,
// organizationId and deletedAt IS NULL, including the category; then
// menuItemVenueOverride.findUnique on (menuItemId, venueId)) as one statement,
// so every line of a request is priced from the same snapshot.
const itemsSQL = `
SELECT m.id, m.title, m."categoryId", c.name, m."priceCents", m."isAvailable", m."modifierGroups",
       o."priceCents", o."isAvailable"
FROM "MenuItem" m
JOIN "Category" c ON c.id = m."categoryId"
LEFT JOIN "MenuItemVenueOverride" o ON o."menuItemId" = m.id AND o."venueId" = $2
WHERE m."organizationId" = $1 AND m."deletedAt" IS NULL AND m.id = ANY($3)`

func (c *Catalog) Items(ctx context.Context, organizationID, venueID string, ids []string) (map[string]pricing.CatalogItem, error) {
	rows, err := c.pool.Query(ctx, itemsSQL, organizationID, venueID, ids)
	if err != nil {
		return nil, fmt.Errorf("query pricing catalog: %w", err)
	}
	items, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (pricing.CatalogItem, error) {
		var it pricing.CatalogItem
		var overridePrice *int64
		var overrideAvailable *bool
		err := row.Scan(&it.ID, &it.Title, &it.CategoryID, &it.CategoryName, &it.PriceCents, &it.IsAvailable, &it.ModifierGroups,
			&overridePrice, &overrideAvailable)
		if overridePrice != nil || overrideAvailable != nil {
			it.Override = &pricing.VenueOverride{PriceCents: overridePrice, IsAvailable: overrideAvailable}
		}
		return it, err
	})
	if err != nil {
		return nil, fmt.Errorf("read pricing catalog: %w", err)
	}
	catalog := make(map[string]pricing.CatalogItem, len(items))
	for _, it := range items {
		catalog[it.ID] = it
	}
	return catalog, nil
}
