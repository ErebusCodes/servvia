// Package pgstore implements promotions.Repository on the Prisma-managed
// "Promotion" table (migration 20261007000000_promotions).
//
// Invariants rest on the database: (venueId, createRequestKey) is unique;
// the CHECKs bound the name, rate, window, key and target lists. A change
// locks the promotion FOR UPDATE and bumps its version; an order committing
// the promotion holds it FOR SHARE (orders/pgstore), so the two serialize
// and an order never commits against a version it did not evaluate.
// Nothing is ever deleted.
package pgstore

import (
	"context"
	"crypto/rand"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	coreaudit "servvia/services/core-platform/internal/audit"
	"servvia/services/core-platform/internal/events"
	eventstore "servvia/services/core-platform/internal/events/pgstore"
	"servvia/services/core-platform/internal/promotions"
)

type Store struct{ pool *pgxpool.Pool }

func New(pool *pgxpool.Pool) *Store { return &Store{pool: pool} }

var _ promotions.Repository = (*Store)(nil)

const (
	pgUniqueViolation     = "23505"
	pgForeignKeyViolation = "23503"
	keyIndex              = "Promotion_venueId_createRequestKey_key"
	maxList               = 200
)

const columns = `id, "venueId", name, kind::text, "basisPoints", target::text, "categoryIds", "menuItemIds", status::text,
       "startsAt", "endsAt", version, "createRequestKey", "createdByStaffId", "updatedByStaffId", "createdAt", "updatedAt"`

type querier interface {
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
}

func scan(row pgx.CollectableRow) (promotions.Promotion, error) {
	var p promotions.Promotion
	var kind, target, status string
	err := row.Scan(&p.ID, &p.VenueID, &p.Name, &kind, &p.BasisPoints, &target, &p.CategoryIDs, &p.MenuItemIDs, &status,
		&p.StartsAt, &p.EndsAt, &p.Version, &p.CreateRequestKey, &p.CreatedByStaffID, &p.UpdatedByStaffID, &p.CreatedAt, &p.UpdatedAt)
	p.Kind, p.Target, p.Status = promotions.Kind(kind), promotions.Target(target), promotions.Status(status)
	if p.CategoryIDs == nil {
		p.CategoryIDs = []string{}
	}
	if p.MenuItemIDs == nil {
		p.MenuItemIDs = []string{}
	}
	return p, err
}

func one(ctx context.Context, q querier, sql string, args ...any) (promotions.Promotion, error) {
	rows, err := q.Query(ctx, sql, args...)
	if err != nil {
		return promotions.Promotion{}, fmt.Errorf("query promotion: %w", err)
	}
	p, err := pgx.CollectExactlyOneRow(rows, scan)
	if errors.Is(err, pgx.ErrNoRows) {
		return promotions.Promotion{}, promotions.ErrPromotionNotFound
	}
	if err != nil {
		return promotions.Promotion{}, fmt.Errorf("read promotion: %w", err)
	}
	return p, nil
}

func (st *Store) FindByKey(ctx context.Context, venueID, key string) (promotions.Promotion, string, bool, error) {
	var fingerprint string
	err := st.pool.QueryRow(ctx, `SELECT "requestFingerprint" FROM "Promotion" WHERE "venueId" = $1 AND "createRequestKey" = $2`,
		venueID, key).Scan(&fingerprint)
	if errors.Is(err, pgx.ErrNoRows) {
		return promotions.Promotion{}, "", false, nil
	}
	if err != nil {
		return promotions.Promotion{}, "", false, fmt.Errorf("find promotion by key: %w", err)
	}
	p, err := one(ctx, st.pool, `SELECT `+columns+` FROM "Promotion" WHERE "venueId" = $1 AND "createRequestKey" = $2`, venueID, key)
	return p, fingerprint, err == nil, err
}

func (st *Store) Get(ctx context.Context, venueID, id string) (promotions.Promotion, error) {
	return one(ctx, st.pool, `SELECT `+columns+` FROM "Promotion" WHERE "venueId" = $1 AND id = $2`, venueID, id)
}

// List returns the newest matching promotions first, at most maxList.
func (st *Store) List(ctx context.Context, venueID string, f promotions.Filter) ([]promotions.Promotion, error) {
	statuses := make([]string, len(f.Statuses))
	for i, s := range f.Statuses {
		statuses[i] = string(s)
	}
	rows, err := st.pool.Query(ctx, `SELECT `+columns+` FROM "Promotion"
		WHERE "venueId" = $1 AND (cardinality($2::text[]) = 0 OR status::text = ANY($2))
		ORDER BY "createdAt" DESC, id DESC LIMIT $3`, venueID, statuses, maxList)
	if err != nil {
		return nil, fmt.Errorf("query promotions: %w", err)
	}
	return pgx.CollectRows(rows, scan)
}

func (st *Store) Create(ctx context.Context, n promotions.NewPromotion) (promotions.Promotion, error) {
	id := newID()
	t := n.Terms
	err := pgx.BeginFunc(ctx, st.pool, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `INSERT INTO "Promotion"
			(id, "venueId", name, kind, "basisPoints", target, "categoryIds", "menuItemIds", "startsAt", "endsAt",
			 "createRequestKey", "requestFingerprint", "createdByStaffId", "updatedAt")
			VALUES ($1, $2, $3, $4::"PromotionKind", $5, $6::"PromotionTarget", $7, $8, $9, $10, $11, $12, $13, now())`,
			id, n.Scope.VenueID, t.Name, string(t.Kind), t.BasisPoints, string(t.Target), t.CategoryIDs, t.MenuItemIDs,
			t.StartsAt, t.EndsAt, n.Key, n.Fingerprint, n.Actor.StaffID); err != nil {
			return err
		}
		if err := promotionFact(ctx, tx, n.Scope.VenueID, promotions.ActionCreated, id, promotions.StatusInactive, 1); err != nil {
			return err
		}
		return audit(ctx, tx, n.Scope, n.Actor, promotions.ActionCreated, id, nil, snapshot(promotions.Promotion{
			ID: id, Terms: t, Status: promotions.StatusInactive, Version: 1}))
	})
	var pgErr *pgconn.PgError
	switch {
	case err == nil:
		return st.Get(ctx, n.Scope.VenueID, id)
	case errors.As(err, &pgErr) && pgErr.Code == pgUniqueViolation && pgErr.ConstraintName == keyIndex:
		return promotions.Promotion{}, promotions.ErrDuplicateKey
	case errors.As(err, &pgErr) && pgErr.Code == pgForeignKeyViolation:
		return promotions.Promotion{}, promotions.ErrUnknownActor
	}
	return promotions.Promotion{}, err
}

func (st *Store) Change(ctx context.Context, c promotions.Change, decide func(promotions.Promotion) (promotions.Decision, error)) (promotions.Promotion, bool, error) {
	changed := false
	err := pgx.BeginFunc(ctx, st.pool, func(tx pgx.Tx) error {
		p, err := one(ctx, tx, `SELECT `+columns+` FROM "Promotion" WHERE "venueId" = $1 AND id = $2 FOR UPDATE`,
			c.Scope.VenueID, c.PromotionID)
		if err != nil {
			return err
		}
		d, err := decide(p)
		if err != nil || !d.Changed {
			return err
		}
		n := d.Next
		// The version in the WHERE clause is belt and braces: the row is
		// locked, so it cannot have moved since it was read.
		tag, err := tx.Exec(ctx, `UPDATE "Promotion" SET name = $3, "basisPoints" = $4, target = $5::"PromotionTarget",
			"categoryIds" = $6, "menuItemIds" = $7, "startsAt" = $8, "endsAt" = $9, status = $10::"PromotionStatus",
			version = version + 1, "updatedByStaffId" = $11, "updatedAt" = now()
			WHERE id = $1 AND version = $2`,
			p.ID, p.Version, n.Name, n.BasisPoints, string(n.Target), n.CategoryIDs, n.MenuItemIDs, n.StartsAt, n.EndsAt,
			string(n.Status), c.Actor.StaffID)
		if err != nil {
			return fmt.Errorf("update promotion: %w", err)
		}
		if tag.RowsAffected() != 1 {
			return &promotions.VersionConflictError{Current: p.Version}
		}
		changed = true
		n.Version = p.Version + 1
		if err := promotionFact(ctx, tx, c.Scope.VenueID, d.Action, p.ID, n.Status, n.Version); err != nil {
			return err
		}
		return audit(ctx, tx, c.Scope, c.Actor, d.Action, p.ID, snapshot(p), snapshot(n))
	})
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == pgForeignKeyViolation {
		return promotions.Promotion{}, false, promotions.ErrUnknownActor
	}
	if err != nil {
		return promotions.Promotion{}, false, err
	}
	p, err := st.Get(ctx, c.Scope.VenueID, c.PromotionID)
	return p, changed, err
}

// MissingTargets: ids that are not categories, or not live (undeleted) menu
// items, of the organization. An id of another organization is missing.
func (st *Store) MissingTargets(ctx context.Context, organizationID string, categoryIDs, menuItemIDs []string) ([]string, error) {
	rows, err := st.pool.Query(ctx, `
		SELECT id FROM unnest($2::text[]) AS c(id)
		 WHERE NOT EXISTS (SELECT 1 FROM "Category" WHERE id = c.id AND "organizationId" = $1)
		UNION ALL
		SELECT id FROM unnest($3::text[]) AS m(id)
		 WHERE NOT EXISTS (SELECT 1 FROM "MenuItem" WHERE id = m.id AND "organizationId" = $1 AND "deletedAt" IS NULL)`,
		organizationID, categoryIDs, menuItemIDs)
	if err != nil {
		return nil, fmt.Errorf("check promotion targets: %w", err)
	}
	return pgx.CollectRows(rows, pgx.RowTo[string])
}

// snapshot is the audited form of a promotion's configuration.
func snapshot(p promotions.Promotion) map[string]any {
	return map[string]any{"promotionId": p.ID, "name": p.Name, "kind": p.Kind, "basisPoints": p.BasisPoints,
		"target": p.Target, "categoryIds": p.CategoryIDs, "menuItemIds": p.MenuItemIDs, "status": p.Status,
		"startsAt": p.StartsAt, "endsAt": p.EndsAt, "version": p.Version}
}

func audit(ctx context.Context, tx pgx.Tx, sc promotions.Scope, a promotions.Actor, action, id string, before, after map[string]any) error {
	return coreaudit.Write(ctx, tx, coreaudit.Entry{OrganizationID: sc.OrganizationID, VenueID: sc.VenueID,
		Actor: coreaudit.Staff(a.StaffID, a.Email, a.Role, coreaudit.Device{}), Action: action, Resource: "promotion", ResourceID: id,
		Before: before, After: after})
}

func newID() string {
	var b [16]byte
	_, _ = rand.Read(b[:])
	b[6], b[8] = b[6]&0x0f|0x40, b[8]&0x3f|0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}

// factOf maps each audited promotion change to its realtime fact (D12).
var factOf = map[string]string{
	promotions.ActionCreated:   "promotion.created",
	promotions.ActionUpdated:   "promotion.updated",
	promotions.ActionActivated: "promotion.activated",
	promotions.ActionDisabled:  "promotion.disabled",
}

// promotionFact records a promotion change in its transaction: identity,
// status and version only. Subscribers refetch the terms (eligibility lists
// are never pushed).
func promotionFact(ctx context.Context, tx pgx.Tx, venueID, action, id string, status promotions.Status, version int) error {
	_, err := eventstore.Record(ctx, tx, venueID, events.Fact{Type: factOf[action], AggregateType: "promotion",
		AggregateID: id, Version: events.V(version), Payload: map[string]any{"promotionId": id, "status": status}})
	return err
}
