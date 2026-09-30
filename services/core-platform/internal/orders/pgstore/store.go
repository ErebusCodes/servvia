// Package pgstore implements orders.Repository on the Prisma-managed "Order",
// "OrderItem", "OrderRound" and "OutboxEvent" tables (migrations up to
// 20260930000000_canonical_orders).
//
// It writes only canonical columns. Legacy external-POS columns keep their
// defaults, and no delivery rows (external POS, KDS, printer) are created:
// kitchen hand-off is the outbox event, consumed from Phase D4.
//
// Invariants rest on the database, not on reads before writes:
// (venueId, idempotencyKey) and (orderId, requestKey) are unique indexes; an
// order's table equals its session's table by composite foreign key. A
// session may hold any number of orders: occupancy is the session's. A
// create holds its session FOR SHARE, and a round holds its session FOR
// SHARE and then its order FOR UPDATE (the global lock order TableSession ->
// Order -> Check, Phase D10), so a session cannot close under a create or a
// round, and concurrent rounds are numbered and totalled one at a time.
//
// A submission with a promotion (Phase D11) then holds the promotion FOR
// SHARE and requires the version it was evaluated at, still active: a
// concurrent change (which locks it FOR UPDATE and bumps the version) either
// commits first, and the order is refused with promotions.ErrChanged, or
// waits for the order. An order never mixes two configurations. The
// snapshot (AppliedPromotion) and the lines' shares are written in the same
// transaction; the order's totals are gross, discount, and the GST
// contained in the discounted total.
package pgstore

import (
	"context"
	"crypto/rand"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"servvia/services/core-platform/internal/orders"
	"servvia/services/core-platform/internal/pricing"
	"servvia/services/core-platform/internal/promotions"
	"servvia/services/core-platform/internal/realtime"
	realtimestore "servvia/services/core-platform/internal/realtime/pgstore"
)

type Store struct {
	pool   *pgxpool.Pool
	onFail func(error) // best-effort audit failures; logging is the caller's
}

// New returns the store. auditFailed is called when a best-effort audit write
// fails (it never changes an outcome).
func New(pool *pgxpool.Pool, auditFailed func(error)) *Store {
	return &Store{pool: pool, onFail: auditFailed}
}

var _ orders.Repository = (*Store)(nil)

const (
	pgUniqueViolation     = "23505"
	pgForeignKeyViolation = "23503"

	idempotencyIndex   = "Order_venueId_idempotencyKey_key"
	roundKeyIndex      = "OrderRound_orderId_requestKey_key"
	roundSubmittedType = "order.round_submitted"
)

type querier interface {
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

const orderColumns = `id, "venueId", "tableSessionId", "tableId", "tableNumber", "serviceMode"::text, source::text,
       status::text, notes, "takeawayReference", "idempotencyKey", "subtotalCents", "discountCents", "taxCents",
       "totalCents", "createdAt", "updatedAt"`

func (st *Store) FindByKey(ctx context.Context, venueID, key string) (orders.Order, bool, error) {
	o, err := load(ctx, st.pool, `SELECT `+orderColumns+` FROM "Order" WHERE "venueId" = $1 AND "idempotencyKey" = $2`, venueID, key)
	if errors.Is(err, orders.ErrOrderNotFound) {
		return orders.Order{}, false, nil
	}
	return o, err == nil, err
}

func (st *Store) Get(ctx context.Context, venueID, orderID string) (orders.Order, error) {
	return load(ctx, st.pool, `SELECT `+orderColumns+` FROM "Order" WHERE "venueId" = $1 AND id = $2`, venueID, orderID)
}

// load reads one order with its rounds and lines.
func load(ctx context.Context, q querier, sql string, args ...any) (orders.Order, error) {
	var o orders.Order
	var mode, source, status string
	err := q.QueryRow(ctx, sql, args...).Scan(&o.ID, &o.VenueID, &o.TableSessionID, &o.TableID, &o.TableNumber,
		&mode, &source, &status, &o.Notes, &o.TakeawayReference, &o.IdempotencyKey,
		&o.SubtotalCents, &o.DiscountCents, &o.TaxCents, &o.TotalCents, &o.CreatedAt, &o.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return orders.Order{}, orders.ErrOrderNotFound
	}
	if err != nil {
		return orders.Order{}, fmt.Errorf("load order: %w", err)
	}
	o.ServiceMode, o.Source, o.Status = orders.ServiceMode(mode), orders.Source(source), orders.Status(status)

	rows, err := q.Query(ctx, `SELECT id, sequence, "requestKey", "submittedByStaffId", "submittedAt"
		FROM "OrderRound" WHERE "orderId" = $1 ORDER BY sequence`, o.ID)
	if err != nil {
		return orders.Order{}, fmt.Errorf("load rounds: %w", err)
	}
	o.Rounds, err = pgx.CollectRows(rows, func(r pgx.CollectableRow) (orders.Round, error) {
		var rd orders.Round
		return rd, r.Scan(&rd.ID, &rd.Sequence, &rd.RequestKey, &rd.SubmittedByStaffID, &rd.SubmittedAt)
	})
	if err != nil {
		return orders.Order{}, fmt.Errorf("read rounds: %w", err)
	}

	// Lines in submission order: by round, then by id, which this store mints
	// in request order within a round (lineID). Lines of the NestJS path
	// have no round and come first.
	rows, err = q.Query(ctx, `SELECT i.id, i."roundId", i."menuItemId", i."menuItemTitle", i."menuItemCategory",
		       i."unitPriceCents", i.quantity, i."lineTotalCents", i."discountCents", i."appliedPromotionId",
		       i."selectedModifiers", i.notes, i.seat
		FROM "OrderItem" i LEFT JOIN "OrderRound" r ON r.id = i."roundId"
		WHERE i."orderId" = $1 ORDER BY r.sequence NULLS FIRST, i.id`, o.ID)
	if err != nil {
		return orders.Order{}, fmt.Errorf("load lines: %w", err)
	}
	o.Lines, err = pgx.CollectRows(rows, func(r pgx.CollectableRow) (orders.Line, error) {
		var l orders.Line
		var mods []byte
		if err := r.Scan(&l.ID, &l.RoundID, &l.MenuItemID, &l.MenuItemTitle, &l.MenuItemCategory,
			&l.UnitPriceCents, &l.Quantity, &l.LineTotalCents, &l.DiscountCents, &l.AppliedPromotionID, &mods, &l.Notes, &l.Seat); err != nil {
			return l, err
		}
		l.Modifiers = decodeModifiers(mods)
		return l, nil
	})
	if err != nil {
		return orders.Order{}, fmt.Errorf("read lines: %w", err)
	}

	rows, err = q.Query(ctx, `SELECT a.id, a."roundId", a."promotionId", a."promotionVersion", a.name, a.kind::text,
		       a."basisPoints", a.target::text, a.currency, a."eligibleSubtotalCents", a."discountCents", a."appliedAt"
		FROM "AppliedPromotion" a JOIN "OrderRound" r ON r.id = a."roundId"
		WHERE a."orderId" = $1 ORDER BY r.sequence`, o.ID)
	if err != nil {
		return orders.Order{}, fmt.Errorf("load applied promotions: %w", err)
	}
	o.Promotions, err = pgx.CollectRows(rows, func(r pgx.CollectableRow) (orders.AppliedPromotion, error) {
		var a orders.AppliedPromotion
		return a, r.Scan(&a.ID, &a.RoundID, &a.PromotionID, &a.PromotionVersion, &a.Name, &a.Kind, &a.BasisPoints,
			&a.Target, &a.Currency, &a.EligibleSubtotalCents, &a.DiscountCents, &a.AppliedAt)
	})
	if err != nil {
		return orders.Order{}, fmt.Errorf("read applied promotions: %w", err)
	}
	return o, nil
}

// storedModifier reads the selectedModifiers snapshot tolerantly: rows the
// NestJS kiosk path wrote have null ids.
type storedModifier struct {
	ModifierGroupID   *string `json:"modifierGroupId"`
	ModifierGroupName *string `json:"modifierGroupName"`
	OptionID          *string `json:"optionId"`
	OptionName        string  `json:"optionName"`
	PriceDeltaCents   float64 `json:"priceDeltaCents"`
}

func decodeModifiers(raw []byte) []pricing.PricedModifier {
	var stored []storedModifier
	_ = json.Unmarshal(raw, &stored)
	out := make([]pricing.PricedModifier, 0, len(stored))
	for _, m := range stored {
		out = append(out, pricing.PricedModifier{ModifierGroupID: deref(m.ModifierGroupID), ModifierGroupName: deref(m.ModifierGroupName),
			OptionID: deref(m.OptionID), OptionName: m.OptionName, PriceDeltaCents: int64(m.PriceDeltaCents)})
	}
	return out
}

func deref(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

func (st *Store) Create(ctx context.Context, n orders.NewOrder) (orders.Order, error) {
	cmd := n.Command
	venueID := cmd.Scope.Venue.ID
	var orderID string
	err := pgx.BeginFunc(ctx, st.pool, func(tx pgx.Tx) error {
		var tableID, tableNumber *string
		if cmd.ServiceMode == orders.ServiceDineIn {
			var status, tid, number string
			err := tx.QueryRow(ctx, `SELECT s.status::text, s."tableId", t."tableNumber"
				FROM "TableSession" s JOIN "Table" t ON t.id = s."tableId"
				WHERE s.id = $1 AND t."venueId" = $2 FOR SHARE OF s`, *cmd.TableSessionID, venueID).Scan(&status, &tid, &number)
			if errors.Is(err, pgx.ErrNoRows) {
				return orders.ErrTableSessionNotFound
			}
			if err != nil {
				return fmt.Errorf("load table session: %w", err)
			}
			if status != "open" {
				return &orders.SessionNotOpenError{Status: status}
			}
			// The table comes from the session, never from the client.
			tableID, tableNumber = &tid, &number
		}
		if err := lockPromotion(ctx, tx, venueID, n.Promotion); err != nil {
			return err
		}

		var seq int64
		if err := tx.QueryRow(ctx, `SELECT nextval('"Order_ORD6_seq"')`).Scan(&seq); err != nil {
			return fmt.Errorf("mint order id: %w", err)
		}
		orderID = "ORD-" + strconv.FormatInt(seq, 10)
		var takeaway *string
		if cmd.ServiceMode == orders.ServiceTakeaway {
			if err := tx.QueryRow(ctx, `SELECT nextval('"TakeawayReference_seq"')`).Scan(&seq); err != nil {
				return fmt.Errorf("mint takeaway reference: %w", err)
			}
			ref := fmt.Sprintf("TA-%06d", seq)
			takeaway = &ref
		}

		q := n.Quote
		if _, err := tx.Exec(ctx, `INSERT INTO "Order"
			(id, "venueId", "tableId", "tableNumber", "tableSessionId", status, "subtotalCents", "discountCents", "taxCents",
			 "totalCents", notes, source, "serviceMode", "takeawayReference", "idempotencyKey", "confirmedAt", "updatedAt")
			VALUES ($1, $2, $3, $4, $5, 'confirmed', $6, $7, $8, $9, $10, $11::"OrderSource", $12::"ServiceMode", $13, $14, now(), now())`,
			orderID, venueID, tableID, tableNumber, cmd.TableSessionID, q.SubtotalCents, q.DiscountCents, q.TaxCents, q.TotalCents,
			orders.NormalizeNotes(cmd.Notes), string(cmd.Source), string(cmd.ServiceMode), takeaway, cmd.IdempotencyKey); err != nil {
			return err
		}
		roundID, err := insertRound(ctx, tx, orderID, 1, cmd.IdempotencyKey, cmd.Actor.StaffID)
		if err != nil {
			return err
		}
		appliedID, err := insertApplied(ctx, tx, venueID, orderID, roundID, n.Promotion)
		if err != nil {
			return err
		}
		lines, err := insertLines(ctx, tx, orderID, roundID, q.Lines, cmd.Lines, n.Promotion, appliedID)
		if err != nil {
			return err
		}
		if err := outbox(ctx, tx, venueID, orderID, roundID, 1, cmd.TableSessionID, cmd.Source, cmd.ServiceMode, lines); err != nil {
			return err
		}
		if _, err := realtimestore.Record(ctx, tx, venueID, realtime.Fact{Type: "order.created", AggregateType: "order",
			AggregateID: orderID, Payload: map[string]any{"orderId": orderID, "roundId": roundID, "tableSessionId": cmd.TableSessionID,
				"tableNumber": tableNumber, "takeawayReference": takeaway, "serviceMode": cmd.ServiceMode, "source": cmd.Source,
				"status": orders.StatusConfirmed}}); err != nil {
			return err
		}
		if err := roundFact(ctx, tx, venueID, orderID, roundID, 1, cmd.TableSessionID, cmd.Source, cmd.ServiceMode); err != nil {
			return err
		}
		return audit(ctx, tx, cmd.Scope, cmd.Actor, "CREATE_ORDER", orderID, map[string]any{
			"orderId": orderID, "totalCents": q.TotalCents, "discountCents": q.DiscountCents, "source": cmd.Source,
			"serviceMode": cmd.ServiceMode, "tableSessionId": cmd.TableSessionID, "roundId": roundID,
			"promotion": promotionAudit(n.Promotion, appliedID),
		})
	})
	if err != nil {
		return orders.Order{}, st.mapCreateError(ctx, err, cmd)
	}
	return st.Get(ctx, venueID, orderID)
}

func (st *Store) mapCreateError(ctx context.Context, err error, cmd orders.CreateCommand) error {
	var pgErr *pgconn.PgError
	if !errors.As(err, &pgErr) {
		return err
	}
	switch {
	case pgErr.Code == pgUniqueViolation && pgErr.ConstraintName == idempotencyIndex:
		return orders.ErrDuplicateKey
	case pgErr.Code == pgForeignKeyViolation && pgErr.ConstraintName == "AppliedPromotion_promotionId_venueId_fkey":
		return promotions.ErrPromotionNotFound
	case pgErr.Code == pgForeignKeyViolation && (pgErr.ConstraintName == "OrderRound_submittedByStaffId_fkey" ||
		pgErr.ConstraintName == "AuditLog_actorId_fkey"):
		return orders.ErrUnknownActor
	}
	return err
}

func (st *Store) AddRound(ctx context.Context, n orders.NewRound) (orders.Order, error) {
	cmd := n.Command
	venueID := cmd.Scope.Venue.ID
	err := pgx.BeginFunc(ctx, st.pool, func(tx pgx.Tx) error {
		// Lock order (Phase D10): the session FOR SHARE, then the order FOR
		// UPDATE, as every operation that adds to a visit does (TableSession
		// -> Order -> Check). A close holds the session FOR UPDATE, so a
		// round either commits before it (and the close counts the round) or
		// sees the session closed and is refused.
		var sessionID *string
		err := tx.QueryRow(ctx, `SELECT "tableSessionId" FROM "Order" WHERE id = $1 AND "venueId" = $2`,
			cmd.OrderID, venueID).Scan(&sessionID)
		if errors.Is(err, pgx.ErrNoRows) {
			return orders.ErrOrderNotFound
		}
		if err != nil {
			return fmt.Errorf("find order: %w", err)
		}
		if sessionID == nil {
			return orders.ErrNotTableService
		}
		var sessionStatus string
		if err := tx.QueryRow(ctx, `SELECT status::text FROM "TableSession" WHERE id = $1 FOR SHARE`, *sessionID).Scan(&sessionStatus); err != nil {
			return fmt.Errorf("load table session: %w", err)
		}
		if sessionStatus != "open" {
			return &orders.SessionNotOpenError{Status: sessionStatus}
		}
		var status, mode, source string
		if err := tx.QueryRow(ctx, `SELECT status::text, "serviceMode"::text, source::text FROM "Order"
			WHERE id = $1 FOR UPDATE`, cmd.OrderID).Scan(&status, &mode, &source); err != nil {
			return fmt.Errorf("lock order: %w", err)
		}
		if orders.ServiceMode(mode) != orders.ServiceDineIn {
			return orders.ErrNotTableService
		}
		if s := orders.Status(status); !s.Active() {
			return &orders.OrderNotActiveError{Status: s}
		}
		if err := lockPromotion(ctx, tx, venueID, n.Promotion); err != nil {
			return err
		}

		var sequence int
		if err := tx.QueryRow(ctx, `SELECT COALESCE(max(sequence), 0) + 1 FROM "OrderRound" WHERE "orderId" = $1`,
			cmd.OrderID).Scan(&sequence); err != nil {
			return fmt.Errorf("number round: %w", err)
		}
		roundID, err := insertRound(ctx, tx, cmd.OrderID, sequence, cmd.RequestKey, cmd.Actor.StaffID)
		if err != nil {
			return err
		}
		appliedID, err := insertApplied(ctx, tx, venueID, cmd.OrderID, roundID, n.Promotion)
		if err != nil {
			return err
		}
		lines, err := insertLines(ctx, tx, cmd.OrderID, roundID, n.Lines, cmd.Lines, n.Promotion, appliedID)
		if err != nil {
			return err
		}
		// Totals over every line of every round, computed under the lock:
		// each round's accepted discounts are summed, never re-evaluated.
		var subtotal, discount int64
		if err := tx.QueryRow(ctx, `SELECT COALESCE(sum("lineTotalCents"), 0), COALESCE(sum("discountCents"), 0)
			FROM "OrderItem" WHERE "orderId" = $1`, cmd.OrderID).Scan(&subtotal, &discount); err != nil {
			return fmt.Errorf("sum order lines: %w", err)
		}
		totals, err := n.TotalsFor(subtotal, discount)
		if err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `UPDATE "Order" SET "subtotalCents" = $2, "discountCents" = $3, "taxCents" = $4,
			"totalCents" = $5, "updatedAt" = now() WHERE id = $1`,
			cmd.OrderID, totals.SubtotalCents, totals.DiscountCents, totals.TaxCents, totals.TotalCents); err != nil {
			return fmt.Errorf("update order totals: %w", err)
		}
		if err := outbox(ctx, tx, venueID, cmd.OrderID, roundID, sequence, sessionID, orders.Source(source), orders.ServiceDineIn, lines); err != nil {
			return err
		}
		if err := roundFact(ctx, tx, venueID, cmd.OrderID, roundID, sequence, sessionID, orders.Source(source), orders.ServiceDineIn); err != nil {
			return err
		}
		return audit(ctx, tx, cmd.Scope, cmd.Actor, "ORDER_ROUND_SUBMITTED", cmd.OrderID, map[string]any{
			"orderId": cmd.OrderID, "roundId": roundID, "sequence": sequence, "totalCents": totals.TotalCents,
			"discountCents": totals.DiscountCents, "promotion": promotionAudit(n.Promotion, appliedID),
		})
	})
	var pgErr *pgconn.PgError
	switch {
	case err == nil:
		return st.Get(ctx, venueID, cmd.OrderID)
	case errors.As(err, &pgErr) && pgErr.Code == pgUniqueViolation && pgErr.ConstraintName == roundKeyIndex:
		return orders.Order{}, orders.ErrDuplicateRoundKey
	case errors.As(err, &pgErr) && pgErr.Code == pgForeignKeyViolation && pgErr.ConstraintName == "AppliedPromotion_promotionId_venueId_fkey":
		return orders.Order{}, promotions.ErrPromotionNotFound
	case errors.As(err, &pgErr) && pgErr.Code == pgForeignKeyViolation:
		return orders.Order{}, orders.ErrUnknownActor
	}
	return orders.Order{}, err
}

func insertRound(ctx context.Context, tx pgx.Tx, orderID string, sequence int, key, staffID string) (string, error) {
	id := newUUID()
	_, err := tx.Exec(ctx, `INSERT INTO "OrderRound" (id, "orderId", sequence, "requestKey", "submittedByStaffId")
		VALUES ($1, $2, $3, $4, $5)`, id, orderID, sequence, key, staffID)
	return id, err
}

// lockPromotion holds an evaluated promotion FOR SHARE and requires it
// unchanged since evaluation: same venue, same version, still active. Every
// change bumps the version, so an equal version means the order commits
// exactly the configuration it was priced with. No promotion: nothing.
func lockPromotion(ctx context.Context, tx pgx.Tx, venueID string, app *promotions.Application) error {
	if app == nil {
		return nil
	}
	var version int
	var status string
	err := tx.QueryRow(ctx, `SELECT version, status::text FROM "Promotion" WHERE id = $1 AND "venueId" = $2 FOR SHARE`,
		app.PromotionID, venueID).Scan(&version, &status)
	if errors.Is(err, pgx.ErrNoRows) {
		return promotions.ErrPromotionNotFound
	}
	if err != nil {
		return fmt.Errorf("lock promotion: %w", err)
	}
	if version != app.Version || promotions.Status(status) != promotions.StatusActive {
		return promotions.ErrChanged
	}
	return nil
}

// insertApplied writes the round's promotion snapshot and returns its id.
func insertApplied(ctx context.Context, tx pgx.Tx, venueID, orderID, roundID string, app *promotions.Application) (*string, error) {
	if app == nil {
		return nil, nil
	}
	id := newUUID()
	if _, err := tx.Exec(ctx, `INSERT INTO "AppliedPromotion"
		(id, "venueId", "orderId", "roundId", "promotionId", "promotionVersion", name, kind, "basisPoints", target, currency,
		 "eligibleSubtotalCents", "discountCents", "appliedAt")
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8::"PromotionKind", $9, $10::"PromotionTarget", $11, $12, $13, $14)`,
		id, venueID, orderID, roundID, app.PromotionID, app.Version, app.Name, string(app.Kind), app.BasisPoints,
		string(app.Target), app.Currency, app.EligibleSubtotalCents, app.DiscountCents, app.EvaluatedAt); err != nil {
		return nil, fmt.Errorf("insert applied promotion: %w", err)
	}
	return &id, nil
}

func promotionAudit(app *promotions.Application, appliedID *string) map[string]any {
	if app == nil {
		return nil
	}
	return map[string]any{"appliedPromotionId": appliedID, "promotionId": app.PromotionID, "version": app.Version,
		"basisPoints": app.BasisPoints, "eligibleSubtotalCents": app.EligibleSubtotalCents, "discountCents": app.DiscountCents}
}

// insertLines writes the priced lines with the client's notes and seats, and
// each eligible line's share of the promotion. priced[i] is the price of
// inputs[i]; app, when set, was evaluated on exactly these lines.
func insertLines(ctx context.Context, tx pgx.Tx, orderID, roundID string, priced []pricing.PricedLine, inputs []orders.LineInput,
	app *promotions.Application, appliedID *string) ([]map[string]any, error) {
	now := time.Now()
	var event []map[string]any
	for i, p := range priced {
		var discount int64
		var applied *string
		if app != nil && app.Eligible[i] {
			discount, applied = app.LineDiscounts[i], appliedID
		}
		mods := p.Modifiers
		if mods == nil {
			mods = []pricing.PricedModifier{}
		}
		modsJSON, _ := json.Marshal(mods)
		notes, seat := orders.NormalizeNotes(inputs[i].Notes), orders.NormalizeSeat(inputs[i].Seat)
		id := lineID(now, i)
		if _, err := tx.Exec(ctx, `INSERT INTO "OrderItem"
			(id, "orderId", "roundId", "menuItemId", "menuItemTitle", "menuItemCategory", "unitPriceCents", quantity,
			 "lineTotalCents", "discountCents", "appliedPromotionId", "selectedModifiers", notes, seat)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
			id, orderID, roundID, p.MenuItemID, p.MenuItemTitle, p.MenuItemCategory, p.UnitPriceCents, p.Quantity,
			p.LineTotalCents, discount, applied, modsJSON, notes, seat); err != nil {
			return nil, fmt.Errorf("insert order line: %w", err)
		}
		event = append(event, map[string]any{"lineId": id, "menuItemId": p.MenuItemID, "title": p.MenuItemTitle,
			"quantity": p.Quantity, "modifiers": mods, "notes": notes, "seat": seat})
	}
	return event, nil
}

// outbox records that a round of requested items exists, for the kitchen
// (Phase D4) to turn into a KitchenTicket. Same transaction as the round.
func outbox(ctx context.Context, tx pgx.Tx, venueID, orderID, roundID string, sequence int, sessionID *string,
	source orders.Source, mode orders.ServiceMode, lines []map[string]any) error {
	payload, _ := json.Marshal(map[string]any{
		"orderId": orderID, "roundId": roundID, "sequence": sequence, "venueId": venueID,
		"tableSessionId": sessionID, "serviceMode": mode, "source": source, "lines": lines,
	})
	_, err := tx.Exec(ctx, `INSERT INTO "OutboxEvent" (id, "venueId", "aggregateType", "aggregateId", "eventType", payload)
		VALUES ($1, $2, 'order', $3, $4, $5)`, newUUID(), venueID, orderID, roundSubmittedType, payload)
	if err != nil {
		return fmt.Errorf("write outbox event: %w", err)
	}
	return nil
}

// roundFact records order.round_submitted for realtime subscribers (Phase
// D12): the same fact as the outbox event above (contracts/events/catalog.md),
// with the same field names, minus the projector's lines. A subscriber that
// needs the lines refetches the order.
func roundFact(ctx context.Context, tx pgx.Tx, venueID, orderID, roundID string, sequence int, sessionID *string,
	source orders.Source, mode orders.ServiceMode) error {
	_, err := realtimestore.Record(ctx, tx, venueID, realtime.Fact{Type: "order.round_submitted", AggregateType: "order",
		AggregateID: orderID, Payload: map[string]any{"orderId": orderID, "roundId": roundID, "sequence": sequence,
			"tableSessionId": sessionID, "serviceMode": mode, "source": source}})
	return err
}

func audit(ctx context.Context, tx pgx.Tx, sc orders.Scope, a orders.Actor, action, orderID string, after map[string]any) error {
	body, _ := json.Marshal(after)
	_, err := tx.Exec(ctx, `INSERT INTO "AuditLog"
		(id, "organizationId", "venueId", "actorId", "actorEmail", "actorRole", action, resource, "resourceId", after)
		VALUES ($1, $2, $3, $4, $5, $6::"StaffRole", $7, 'order', $8, $9)`,
		newUUID(), sc.OrganizationID, sc.Venue.ID, a.StaffID, a.Email, a.Role, action, orderID, body)
	return err
}

// Audit writes a best-effort audit row outside any transaction.
func (st *Store) Audit(ctx context.Context, sc orders.Scope, a orders.Actor, action, orderID string, detail map[string]any) {
	err := pgx.BeginFunc(ctx, st.pool, func(tx pgx.Tx) error { return audit(ctx, tx, sc, a, action, orderID, detail) })
	if err != nil && st.onFail != nil {
		st.onFail(fmt.Errorf("audit %s for %s: %w", action, orderID, err))
	}
}

func newUUID() string {
	var b [16]byte
	_, _ = rand.Read(b[:])
	b[6], b[8] = b[6]&0x0f|0x40, b[8]&0x3f|0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}

// lineID is a UUIDv7 whose timestamp is the round's and whose first random
// field is the line's position, so a round's lines sort in request order.
func lineID(t time.Time, position int) string {
	var b [16]byte
	_, _ = rand.Read(b[:])
	ms := uint64(t.UnixMilli())
	b[0], b[1], b[2], b[3], b[4], b[5] = byte(ms>>40), byte(ms>>32), byte(ms>>24), byte(ms>>16), byte(ms>>8), byte(ms)
	binary.BigEndian.PutUint16(b[6:8], 0x7000|uint16(position&0x0fff))
	b[8] = b[8]&0x3f | 0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}
