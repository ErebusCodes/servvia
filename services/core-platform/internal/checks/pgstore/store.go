// Package pgstore implements checks.Repository on the Prisma-managed "Check"
// and "CheckLine" tables (migration 20261002000000_checks).
//
// Invariants rest on the database, not on reads before writes:
// (venueId, idempotencyKey) is unique; an order line is on at most one
// standing check (partial unique index on CheckLine.orderItemId where
// voidedAt is null); a line's order is its order line's order (composite
// foreign key). A create locks the billed orders FOR UPDATE in id order, the
// lock a new round takes, so a concurrent round is either wholly on the
// check or wholly left for a later one, and two creates over the same orders
// bill each line once. Nothing here writes orders, rounds, kitchen tickets or
// table sessions.
package pgstore

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	coreaudit "servvia/services/core-platform/internal/audit"
	"servvia/services/core-platform/internal/checks"
	"servvia/services/core-platform/internal/events"
	eventstore "servvia/services/core-platform/internal/events/pgstore"
	"servvia/services/core-platform/internal/orders"
	"servvia/services/core-platform/internal/pricing"
)

type Store struct {
	pool   *pgxpool.Pool
	onFail func(error) // best-effort audit failures
}

func New(pool *pgxpool.Pool, auditFailed func(error)) *Store {
	return &Store{pool: pool, onFail: auditFailed}
}

var _ checks.Repository = (*Store)(nil)

const (
	pgUniqueViolation     = "23505"
	pgForeignKeyViolation = "23503"
	idempotencyIndex      = "Check_venueId_idempotencyKey_key"
	maxList               = 200
)

const checkColumns = `id, "venueId", "tableSessionId", status::text, currency, "subtotalCents", "discountCents", "taxCents", "totalCents",
       version, "idempotencyKey", "createdByStaffId", "voidedByStaffId", "voidReason", "voidedAt", "createdAt", "updatedAt"`

type querier interface {
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
}

func scanCheck(row pgx.CollectableRow) (checks.Check, error) {
	var c checks.Check
	var status string
	err := row.Scan(&c.ID, &c.VenueID, &c.TableSessionID, &status, &c.Currency, &c.SubtotalCents, &c.DiscountCents, &c.TaxCents, &c.TotalCents,
		&c.Version, &c.IdempotencyKey, &c.CreatedByStaffID, &c.VoidedByStaffID, &c.VoidReason, &c.VoidedAt, &c.CreatedAt, &c.UpdatedAt)
	c.Status = checks.Status(status)
	return c, err
}

// withLines reads the checks a query finds, then their lines in one query.
func withLines(ctx context.Context, q querier, sql string, args ...any) ([]checks.Check, error) {
	rows, err := q.Query(ctx, sql, args...)
	if err != nil {
		return nil, fmt.Errorf("query checks: %w", err)
	}
	found, err := pgx.CollectRows(rows, scanCheck)
	if err != nil || len(found) == 0 {
		return found, err
	}
	ids := make([]string, len(found))
	index := make(map[string]int, len(found))
	for i, c := range found {
		ids[i], index[c.ID] = c.ID, i
	}
	rows, err = q.Query(ctx, `SELECT "checkId", id, "orderId", "orderItemId", position, title, quantity,
		"unitPriceCents", "lineTotalCents", "discountCents", modifiers FROM "CheckLine" WHERE "checkId" = ANY($1) ORDER BY "checkId", position`, ids)
	if err != nil {
		return nil, fmt.Errorf("query check lines: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var checkID string
		var l checks.Line
		var mods []byte
		if err := rows.Scan(&checkID, &l.ID, &l.OrderID, &l.OrderItemID, &l.Position, &l.Title, &l.Quantity,
			&l.UnitPriceCents, &l.LineTotalCents, &l.DiscountCents, &mods); err != nil {
			return nil, fmt.Errorf("read check line: %w", err)
		}
		l.Modifiers = []pricing.PricedModifier{}
		_ = json.Unmarshal(mods, &l.Modifiers)
		c := &found[index[checkID]]
		c.Lines = append(c.Lines, l)
	}
	return found, rows.Err()
}

func one(ctx context.Context, q querier, sql string, args ...any) (checks.Check, error) {
	found, err := withLines(ctx, q, sql, args...)
	if err != nil {
		return checks.Check{}, err
	}
	if len(found) == 0 {
		return checks.Check{}, checks.ErrCheckNotFound
	}
	return found[0], nil
}

func (st *Store) FindByKey(ctx context.Context, venueID, key string) (checks.Check, string, bool, error) {
	var fingerprint string
	err := st.pool.QueryRow(ctx, `SELECT "requestFingerprint" FROM "Check" WHERE "venueId" = $1 AND "idempotencyKey" = $2`,
		venueID, key).Scan(&fingerprint)
	if errors.Is(err, pgx.ErrNoRows) {
		return checks.Check{}, "", false, nil
	}
	if err != nil {
		return checks.Check{}, "", false, fmt.Errorf("find check by key: %w", err)
	}
	c, err := one(ctx, st.pool, `SELECT `+checkColumns+` FROM "Check" WHERE "venueId" = $1 AND "idempotencyKey" = $2`, venueID, key)
	return c, fingerprint, err == nil, err
}

func (st *Store) Get(ctx context.Context, venueID, checkID string) (checks.Check, error) {
	return one(ctx, st.pool, `SELECT `+checkColumns+` FROM "Check" WHERE "venueId" = $1 AND id = $2`, venueID, checkID)
}

// List returns the newest matching checks first, at most maxList.
func (st *Store) List(ctx context.Context, venueID string, f checks.Filter) ([]checks.Check, error) {
	statuses := make([]string, len(f.Statuses))
	for i, s := range f.Statuses {
		statuses[i] = string(s)
	}
	return withLines(ctx, st.pool, `SELECT `+checkColumns+` FROM "Check"
		WHERE "venueId" = $1 AND status::text = ANY($2) AND ($3 = '' OR "tableSessionId" = $3)
		ORDER BY "createdAt" DESC, id DESC LIMIT $4`, venueID, statuses, f.TableSessionID, maxList)
}

type billedOrder struct {
	id        string
	sessionID *string
	source    string
	status    string
}

type billableLine struct {
	id, orderID, title                            string
	quantity, unitCents, lineCents, discountCents int64
	modifiers                                     []byte
}

func (st *Store) Create(ctx context.Context, n checks.NewCheck) (checks.Check, error) {
	cmd := n.Command
	venueID := cmd.Scope.Venue.ID
	var checkID string
	err := pgx.BeginFunc(ctx, st.pool, func(tx pgx.Tx) error {
		orderIDs, err := st.orderIDs(ctx, tx, cmd)
		if err != nil {
			return err
		}
		// Lock order (Phase D10): the visit's session first (FOR SHARE, and
		// it must be open), then the orders. A closed visit takes no new
		// check; a close in progress (FOR UPDATE) waits for this one, and
		// counts it. Orders without a session (takeaway) have none to lock.
		if err := lockOpenSessions(ctx, tx, venueID, orderIDs); err != nil {
			return err
		}
		// Lock the orders, in id order, with the lock a new round takes.
		rows, err := tx.Query(ctx, `SELECT id, "tableSessionId", source::text, status::text FROM "Order"
			WHERE "venueId" = $1 AND id = ANY($2) ORDER BY id FOR UPDATE`, venueID, orderIDs)
		if err != nil {
			return fmt.Errorf("lock orders: %w", err)
		}
		locked, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (billedOrder, error) {
			var o billedOrder
			return o, r.Scan(&o.id, &o.sessionID, &o.source, &o.status)
		})
		if err != nil {
			return fmt.Errorf("read orders: %w", err)
		}
		// A request with this key that committed while this one waited for
		// the order locks has billed these lines: it is a replay (or a key
		// conflict), decided by the caller, never "nothing to bill".
		var taken bool
		if err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM "Check" WHERE "venueId" = $1 AND "idempotencyKey" = $2)`,
			venueID, cmd.IdempotencyKey).Scan(&taken); err != nil {
			return fmt.Errorf("check idempotency key: %w", err)
		}
		if taken {
			return checks.ErrDuplicateKey
		}
		sessionID, err := checkOrders(cmd, orderIDs, locked)
		if err != nil {
			return err
		}

		// Every round line of these orders that no standing check holds, in
		// the order it was ordered, with its accepted discount (D11): the
		// snapshot, never a promotion looked up now.
		rows, err = tx.Query(ctx, `SELECT i.id, i."orderId", i."menuItemTitle", i.quantity, i."unitPriceCents",
			i."lineTotalCents", i."discountCents", i."selectedModifiers"
			FROM "OrderItem" i JOIN "OrderRound" r ON r.id = i."roundId" JOIN "Order" o ON o.id = i."orderId"
			WHERE i."orderId" = ANY($1)
			  AND NOT EXISTS (SELECT 1 FROM "CheckLine" c WHERE c."orderItemId" = i.id AND c."voidedAt" IS NULL)
			ORDER BY o."createdAt", o.id, r.sequence, i.id`, orderIDs)
		if err != nil {
			return fmt.Errorf("load billable lines: %w", err)
		}
		lines, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (billableLine, error) {
			var l billableLine
			return l, r.Scan(&l.id, &l.orderID, &l.title, &l.quantity, &l.unitCents, &l.lineCents, &l.discountCents, &l.modifiers)
		})
		if err != nil {
			return fmt.Errorf("read billable lines: %w", err)
		}
		if len(lines) == 0 {
			return checks.ErrNothingToBill
		}
		var subtotal, discount int64
		for _, l := range lines {
			subtotal += l.lineCents // each is an int column; the sum of 10^5 of them cannot overflow int64
			discount += l.discountCents
		}
		totals, err := n.TotalsFor(subtotal, discount)
		if err != nil {
			return err
		}

		checkID = newID()
		if _, err := tx.Exec(ctx, `INSERT INTO "Check"
			(id, "venueId", "tableSessionId", currency, "subtotalCents", "discountCents", "taxCents", "totalCents", "idempotencyKey",
			 "requestFingerprint", "createdByStaffId", "updatedAt")
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now())`,
			checkID, venueID, sessionID, n.Currency, totals.SubtotalCents, totals.DiscountCents, totals.TaxCents, totals.TotalCents,
			cmd.IdempotencyKey, n.Fingerprint, cmd.Actor.StaffID); err != nil {
			return err
		}
		billed := make([]string, 0, len(locked))
		for i, l := range lines {
			if _, err := tx.Exec(ctx, `INSERT INTO "CheckLine"
				(id, "checkId", "orderId", "orderItemId", position, title, quantity, "unitPriceCents", "lineTotalCents",
				 "discountCents", modifiers)
				VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
				newID(), checkID, l.orderID, l.id, i+1, l.title, l.quantity, l.unitCents, l.lineCents, l.discountCents, l.modifiers); err != nil {
				return fmt.Errorf("insert check line: %w", err)
			}
			if len(billed) == 0 || billed[len(billed)-1] != l.orderID {
				billed = append(billed, l.orderID)
			}
		}
		if _, err := eventstore.Record(ctx, tx, venueID, events.Fact{Type: "check.created", AggregateType: "check",
			AggregateID: checkID, Version: events.V(1), Payload: map[string]any{"checkId": checkID, "tableSessionId": sessionID,
				"orderIds": billed, "status": checks.StatusOpen, "currency": n.Currency, "subtotalCents": totals.SubtotalCents,
				"discountCents": totals.DiscountCents, "totalCents": totals.TotalCents}}); err != nil {
			return err
		}
		return audit(ctx, tx, cmd.Scope, cmd.Actor, "CHECK_CREATED", checkID, nil, map[string]any{
			"checkId": checkID, "tableSessionId": sessionID, "orderIds": billed, "lineCount": len(lines),
			"subtotalCents": totals.SubtotalCents, "discountCents": totals.DiscountCents, "taxCents": totals.TaxCents,
			"totalCents": totals.TotalCents,
			"currency":   n.Currency,
		})
	})
	var pgErr *pgconn.PgError
	switch {
	case err == nil:
		return st.Get(ctx, venueID, checkID)
	case errors.Is(err, checks.ErrDuplicateKey):
		return checks.Check{}, err
	case errors.As(err, &pgErr) && pgErr.Code == pgUniqueViolation && pgErr.ConstraintName == idempotencyIndex:
		return checks.Check{}, checks.ErrDuplicateKey
	case errors.As(err, &pgErr) && pgErr.Code == pgForeignKeyViolation &&
		(pgErr.ConstraintName == "Check_createdByStaffId_fkey" || pgErr.ConstraintName == "AuditLog_actorId_fkey"):
		return checks.Check{}, checks.ErrUnknownActor
	}
	return checks.Check{}, err
}

// orderIDs resolves the orders a create names: every order of the session
// that is not cancelled, or the listed orders (sorted, without duplicates).
func (st *Store) orderIDs(ctx context.Context, tx pgx.Tx, cmd checks.CreateCommand) ([]string, error) {
	venueID := cmd.Scope.Venue.ID
	if cmd.TableSessionID == nil {
		ids := map[string]bool{}
		var out []string
		for _, id := range cmd.OrderIDs {
			if !ids[id] {
				ids[id] = true
				out = append(out, id)
			}
		}
		return out, nil
	}
	// The session is held FOR SHARE, as an order create holds it, and must
	// be open (Phase D10).
	var status string
	if err := tx.QueryRow(ctx, `SELECT s.status::text FROM "TableSession" s JOIN "Table" t ON t.id = s."tableId"
		WHERE s.id = $1 AND t."venueId" = $2 FOR SHARE OF s`, *cmd.TableSessionID, venueID).Scan(&status); errors.Is(err, pgx.ErrNoRows) {
		return nil, checks.ErrTableSessionNotFound
	} else if err != nil {
		return nil, fmt.Errorf("load table session: %w", err)
	}
	if status != "open" {
		return nil, &checks.SessionNotOpenError{Status: status}
	}
	rows, err := tx.Query(ctx, `SELECT id FROM "Order" WHERE "tableSessionId" = $1 AND "venueId" = $2 AND status <> 'cancelled'
		ORDER BY id`, *cmd.TableSessionID, venueID)
	if err != nil {
		return nil, fmt.Errorf("list session orders: %w", err)
	}
	ids, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if err != nil {
		return nil, fmt.Errorf("read session orders: %w", err)
	}
	if len(ids) == 0 {
		return nil, checks.ErrNothingToBill
	}
	return ids, nil
}

// lockOpenSessions holds, FOR SHARE and in id order, the table sessions of
// the named orders, and requires each open: a closed visit takes no new
// obligation (Phase D10). Orders of another venue are skipped here and
// reported as not found by the order lock that follows.
func lockOpenSessions(ctx context.Context, tx pgx.Tx, venueID string, orderIDs []string) error {
	rows, err := tx.Query(ctx, `SELECT s.status::text FROM "TableSession" s
		WHERE s.id IN (SELECT DISTINCT o."tableSessionId" FROM "Order" o WHERE o.id = ANY($1) AND o."venueId" = $2)
		ORDER BY s.id FOR SHARE`, orderIDs, venueID)
	if err != nil {
		return fmt.Errorf("lock table sessions: %w", err)
	}
	statuses, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if err != nil {
		return fmt.Errorf("read table sessions: %w", err)
	}
	for _, s := range statuses {
		if s != "open" {
			return &checks.SessionNotOpenError{Status: s}
		}
	}
	return nil
}

// checkOrders validates the locked orders and returns the visit they share.
func checkOrders(cmd checks.CreateCommand, requested []string, locked []billedOrder) (*string, error) {
	if len(locked) != len(requested) {
		return nil, checks.ErrOrderNotFound
	}
	var session *string
	for i, o := range locked {
		if !orders.Source(o.source).Canonical() {
			return nil, checks.ErrLegacyOrder
		}
		if o.status == string(orders.StatusCancelled) {
			return nil, &checks.OrderNotBillableError{OrderID: o.id, Status: o.status}
		}
		if i == 0 {
			session = o.sessionID
		} else if (session == nil) != (o.sessionID == nil) || (session != nil && *session != *o.sessionID) {
			return nil, checks.ErrMixedVisits
		}
	}
	if cmd.TableSessionID != nil {
		session = cmd.TableSessionID
	}
	return session, nil
}

func (st *Store) Void(ctx context.Context, cmd checks.VoidCommand) (checks.Check, bool, error) {
	var result checks.Check
	var changed bool
	err := pgx.BeginFunc(ctx, st.pool, func(tx pgx.Tx) error {
		before, err := one(ctx, tx, `SELECT `+checkColumns+` FROM "Check" WHERE "venueId" = $1 AND id = $2 FOR UPDATE`,
			cmd.Scope.Venue.ID, cmd.CheckID)
		if err != nil {
			return err
		}
		if changed, err = checks.DecideVoid(before, cmd.ExpectedVersion); err != nil || !changed {
			result = before
			return err
		}
		// Money is exposed while a payment or a return of money is
		// unresolved, or while any tender still has money not returned
		// (Phase D9: a check whose every succeeded tender was fully refunded
		// or reversed may be voided; its history is kept). Payments and
		// returns are written under this same row lock, so none can change
		// between this check and the void.
		var moving bool
		if err := tx.QueryRow(ctx, `SELECT
			EXISTS (SELECT 1 FROM "CheckPayment" WHERE "checkId" = $1 AND status IN ('pending', 'uncertain'))
			OR EXISTS (SELECT 1 FROM "PaymentAdjustment" a JOIN "CheckPayment" p ON p.id = a."paymentId"
			           WHERE p."checkId" = $1 AND a.status IN ('pending', 'uncertain'))
			OR COALESCE((SELECT sum(p."amountCents" - COALESCE((SELECT sum(a."amountCents") FROM "PaymentAdjustment" a
			                     WHERE a."paymentId" = p.id AND a.status = 'succeeded'), 0))
			             FROM "CheckPayment" p WHERE p."checkId" = $1 AND p.status = 'succeeded'), 0) > 0`,
			cmd.CheckID).Scan(&moving); err != nil {
			return fmt.Errorf("check payments: %w", err)
		}
		if moving {
			return checks.ErrCheckHasPayments
		}
		tag, err := tx.Exec(ctx, `UPDATE "Check" SET status = 'voided', "voidedAt" = now(), "voidedByStaffId" = $3,
			"voidReason" = $4, version = version + 1, "updatedAt" = now() WHERE id = $1 AND version = $2 AND status = 'open'`,
			cmd.CheckID, cmd.ExpectedVersion, cmd.Actor.StaffID, cmd.Reason)
		if err != nil {
			return fmt.Errorf("void check: %w", err)
		}
		if tag.RowsAffected() != 1 {
			// Unreachable while the row is locked; never a silent overwrite.
			return &checks.VersionConflictError{Current: before.Version}
		}
		// Release the lines: their order lines may be billed again.
		if _, err := tx.Exec(ctx, `UPDATE "CheckLine" SET "voidedAt" = now() WHERE "checkId" = $1 AND "voidedAt" IS NULL`,
			cmd.CheckID); err != nil {
			return fmt.Errorf("release check lines: %w", err)
		}
		result, err = one(ctx, tx, `SELECT `+checkColumns+` FROM "Check" WHERE id = $1`, cmd.CheckID)
		if err != nil {
			return err
		}
		if _, err := eventstore.Record(ctx, tx, result.VenueID, events.Fact{Type: "check.voided", AggregateType: "check",
			AggregateID: result.ID, Version: events.V(result.Version), Payload: map[string]any{"checkId": result.ID,
				"tableSessionId": result.TableSessionID, "status": result.Status}}); err != nil {
			return err
		}
		return audit(ctx, tx, cmd.Scope, checks.Actor(cmd.Actor), "CHECK_VOIDED", cmd.CheckID,
			map[string]any{"status": before.Status, "version": before.Version, "totalCents": before.TotalCents},
			map[string]any{"status": result.Status, "version": result.Version, "reason": cmd.Reason})
	})
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == pgForeignKeyViolation {
		return checks.Check{}, false, checks.ErrUnknownActor
	}
	if err != nil {
		return checks.Check{}, false, err
	}
	return result, changed, nil
}

// audit records a financial change in the existing AuditLog, in the change's
// transaction: every check actor is a staff member.
func audit(ctx context.Context, tx pgx.Tx, sc checks.Scope, a checks.Actor, action, checkID string, before, after map[string]any) error {
	return coreaudit.Write(ctx, tx, coreaudit.Entry{OrganizationID: sc.OrganizationID, VenueID: sc.Venue.ID,
		Actor: coreaudit.Staff(a.StaffID, a.Email, a.Role, a.Device), Action: action, Resource: "check", ResourceID: checkID,
		Before: before, After: after})
}

// Audit writes a best-effort audit row outside any transaction.
func (st *Store) Audit(ctx context.Context, sc checks.Scope, a checks.Actor, action, checkID string, detail map[string]any) {
	err := pgx.BeginFunc(ctx, st.pool, func(tx pgx.Tx) error { return audit(ctx, tx, sc, a, action, checkID, nil, detail) })
	if err != nil && st.onFail != nil {
		st.onFail(fmt.Errorf("audit %s for %s: %w", action, checkID, err))
	}
}

// newID is a random v4 UUID, the form of every Prisma @default(uuid()) id.
func newID() string {
	var b [16]byte
	_, _ = rand.Read(b[:])
	b[6], b[8] = b[6]&0x0f|0x40, b[8]&0x3f|0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}
