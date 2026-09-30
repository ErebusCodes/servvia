// Package pgstore implements shifts.Repository on the Prisma-managed "Shift"
// and "CashMovement" tables (migration 20261004000000_shifts_cash), and the
// Ledger a cash payment uses inside its own transaction.
//
// Invariants rest on the database: at most one open shift per (venue, staff)
// is the partial unique index "Shift_one_open_per_staff"; one movement per
// payment is unique; the close facts and variance are CHECK constraints. The
// shift row lock (FOR UPDATE) orders a close against cash tenders: a tender
// holds it while it records its movement, and a close holds it while it
// counts the movements.
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

	"servvia/services/core-platform/internal/realtime"
	realtimestore "servvia/services/core-platform/internal/realtime/pgstore"
	"servvia/services/core-platform/internal/shifts"
)

type Store struct{ pool *pgxpool.Pool }

func New(pool *pgxpool.Pool) *Store { return &Store{pool: pool} }

var _ shifts.Repository = (*Store)(nil)

const (
	pgUniqueViolation     = "23505"
	pgForeignKeyViolation = "23503"
	openKeyIndex          = "Shift_venueId_openRequestKey_key"
	oneOpenIndex          = "Shift_one_open_per_staff"
	maxList               = 200
)

// shiftSelect reads shifts with their movement totals.
const shiftSelect = `SELECT s.id, s."venueId", s."staffId", s.status::text, s.currency, s."openingFloatCents",
       s."terminalId", s."openRequestKey", s.version,
       COALESCE((SELECT sum(m."amountCents") FROM "CashMovement" m WHERE m."shiftId" = s.id AND m.kind = 'cash_sale'), 0),
       COALESCE((SELECT sum(m."amountCents") FROM "CashMovement" m WHERE m."shiftId" = s.id AND m.kind = 'cash_refund'), 0),
       (SELECT count(*) FROM "CashMovement" m WHERE m."shiftId" = s.id),
       s."openedAt", s."closedAt", s."closedByStaffId", s."countedCashCents", s."expectedCashCents", s."varianceCents",
       s."createdAt", s."updatedAt"
FROM "Shift" s`

type querier interface {
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
}

func scanShift(row pgx.CollectableRow) (shifts.Shift, error) {
	var s shifts.Shift
	var status string
	err := row.Scan(&s.ID, &s.VenueID, &s.StaffID, &status, &s.Currency, &s.OpeningFloatCents, &s.TerminalID, &s.OpenRequestKey, &s.Version,
		&s.CashSalesCents, &s.CashRefundsCents, &s.MovementCount, &s.OpenedAt, &s.ClosedAt, &s.ClosedByStaffID, &s.CountedCashCents,
		&s.ExpectedCashCents, &s.VarianceCents, &s.CreatedAt, &s.UpdatedAt)
	s.Status = shifts.Status(status)
	return s, err
}

func one(ctx context.Context, q querier, sql string, args ...any) (shifts.Shift, error) {
	rows, err := q.Query(ctx, sql, args...)
	if err != nil {
		return shifts.Shift{}, fmt.Errorf("query shift: %w", err)
	}
	s, err := pgx.CollectExactlyOneRow(rows, scanShift)
	if errors.Is(err, pgx.ErrNoRows) {
		return shifts.Shift{}, shifts.ErrShiftNotFound
	}
	if err != nil {
		return shifts.Shift{}, fmt.Errorf("read shift: %w", err)
	}
	return s, nil
}

func (st *Store) FindByKey(ctx context.Context, venueID, key string) (shifts.Shift, bool, error) {
	s, err := one(ctx, st.pool, shiftSelect+` WHERE s."venueId" = $1 AND s."openRequestKey" = $2`, venueID, key)
	if errors.Is(err, shifts.ErrShiftNotFound) {
		return shifts.Shift{}, false, nil
	}
	return s, err == nil, err
}

func (st *Store) Get(ctx context.Context, venueID, shiftID string) (shifts.Shift, error) {
	return one(ctx, st.pool, shiftSelect+` WHERE s."venueId" = $1 AND s.id = $2`, venueID, shiftID)
}

func (st *Store) List(ctx context.Context, venueID string, f shifts.Filter) ([]shifts.Shift, error) {
	rows, err := st.pool.Query(ctx, shiftSelect+` WHERE s."venueId" = $1 AND ($2 = '' OR s.status::text = $2)
		AND ($3 = '' OR s."staffId" = $3) ORDER BY s."openedAt" DESC, s.id DESC LIMIT $4`,
		venueID, string(f.Status), f.StaffID, maxList)
	if err != nil {
		return nil, fmt.Errorf("query shifts: %w", err)
	}
	return pgx.CollectRows(rows, scanShift)
}

func (st *Store) Open(ctx context.Context, cmd shifts.OpenCommand) (shifts.Shift, error) {
	id := newID()
	err := pgx.BeginFunc(ctx, st.pool, func(tx pgx.Tx) error {
		if cmd.TerminalID != nil {
			// Held FOR SHARE: a terminal disable (FOR UPDATE) waits for this
			// open, and an open after a disable sees it disabled.
			var status string
			err := tx.QueryRow(ctx, `SELECT status::text FROM "Terminal" WHERE id = $1 AND "venueId" = $2 FOR SHARE`,
				*cmd.TerminalID, cmd.Scope.VenueID).Scan(&status)
			if errors.Is(err, pgx.ErrNoRows) {
				return shifts.ErrTerminalNotFound
			}
			if err != nil {
				return fmt.Errorf("load terminal: %w", err)
			}
			if status != "active" {
				return shifts.ErrTerminalDisabled
			}
		}
		if _, err := tx.Exec(ctx, `INSERT INTO "Shift" (id, "venueId", "staffId", currency, "openingFloatCents", "terminalId",
			"openRequestKey", "updatedAt") VALUES ($1, $2, $3, $4, $5, $6, $7, now())`,
			id, cmd.Scope.VenueID, cmd.Actor.StaffID, cmd.Scope.Currency, cmd.OpeningFloatCents, cmd.TerminalID, cmd.RequestKey); err != nil {
			return err
		}
		if err := shiftFact(ctx, tx, cmd.Scope.VenueID, "shift.opened", id, 1, "open", cmd.TerminalID); err != nil {
			return err
		}
		return audit(ctx, tx, cmd.Scope, cmd.Actor, "SHIFT_OPENED", id, nil, map[string]any{
			"shiftId": id, "staffId": cmd.Actor.StaffID, "openingFloatCents": cmd.OpeningFloatCents, "currency": cmd.Scope.Currency,
			"terminalId": cmd.TerminalID})
	})
	var pgErr *pgconn.PgError
	switch {
	case err == nil:
		return st.Get(ctx, cmd.Scope.VenueID, id)
	case errors.As(err, &pgErr) && pgErr.Code == pgUniqueViolation && pgErr.ConstraintName == openKeyIndex:
		return shifts.Shift{}, shifts.ErrDuplicateKey
	case errors.As(err, &pgErr) && pgErr.Code == pgUniqueViolation && pgErr.ConstraintName == oneOpenIndex:
		// The same key may have won this race: that is a replay, not a
		// second shift.
		if _, found, ferr := st.FindByKey(ctx, cmd.Scope.VenueID, cmd.RequestKey); ferr == nil && found {
			return shifts.Shift{}, shifts.ErrDuplicateKey
		}
		var openID string
		_ = st.pool.QueryRow(ctx, `SELECT id FROM "Shift" WHERE "venueId" = $1 AND "staffId" = $2 AND status = 'open'`,
			cmd.Scope.VenueID, cmd.Actor.StaffID).Scan(&openID)
		return shifts.Shift{}, &shifts.AlreadyOpenError{ShiftID: openID}
	case errors.As(err, &pgErr) && pgErr.Code == pgForeignKeyViolation:
		return shifts.Shift{}, shifts.ErrUnknownActor
	}
	return shifts.Shift{}, err
}

func (st *Store) Close(ctx context.Context, cmd shifts.CloseCommand) (shifts.Shift, bool, error) {
	var result shifts.Shift
	var changed bool
	err := pgx.BeginFunc(ctx, st.pool, func(tx pgx.Tx) error {
		// Lock first, then read the totals: no cash movement can be added to
		// this shift until the transaction ends.
		if _, err := tx.Exec(ctx, `SELECT 1 FROM "Shift" WHERE "venueId" = $1 AND id = $2 FOR UPDATE`, cmd.Scope.VenueID, cmd.ShiftID); err != nil {
			return fmt.Errorf("lock shift: %w", err)
		}
		before, err := one(ctx, tx, shiftSelect+` WHERE s."venueId" = $1 AND s.id = $2`, cmd.Scope.VenueID, cmd.ShiftID)
		if err != nil {
			return err
		}
		if changed, err = shifts.DecideClose(before, cmd.ExpectedVersion, cmd.CountedCashCents); err != nil || !changed {
			result = before
			return err
		}
		expected := shifts.ExpectedCash(before.OpeningFloatCents, before.CashSalesCents, before.CashRefundsCents)
		variance := cmd.CountedCashCents - expected
		tag, err := tx.Exec(ctx, `UPDATE "Shift" SET status = 'closed', "closedAt" = now(), "closedByStaffId" = $3,
			"countedCashCents" = $4, "expectedCashCents" = $5, "varianceCents" = $6, version = version + 1, "updatedAt" = now()
			WHERE id = $1 AND version = $2 AND status = 'open'`,
			cmd.ShiftID, cmd.ExpectedVersion, cmd.Actor.StaffID, cmd.CountedCashCents, expected, variance)
		if err != nil {
			return fmt.Errorf("close shift: %w", err)
		}
		if tag.RowsAffected() != 1 {
			return &shifts.VersionConflictError{Current: before.Version} // unreachable under the lock
		}
		if result, err = one(ctx, tx, shiftSelect+` WHERE s.id = $1`, cmd.ShiftID); err != nil {
			return err
		}
		if err := shiftFact(ctx, tx, cmd.Scope.VenueID, "shift.closed", result.ID, result.Version, string(result.Status), result.TerminalID); err != nil {
			return err
		}
		return audit(ctx, tx, cmd.Scope, cmd.Actor, "SHIFT_CLOSED", cmd.ShiftID,
			map[string]any{"status": before.Status, "version": before.Version},
			map[string]any{"status": result.Status, "version": result.Version, "openingFloatCents": before.OpeningFloatCents,
				"cashSalesCents": before.CashSalesCents, "cashRefundsCents": before.CashRefundsCents, "expectedCashCents": expected, "countedCashCents": cmd.CountedCashCents,
				"varianceCents": variance})
	})
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == pgForeignKeyViolation {
		return shifts.Shift{}, false, shifts.ErrUnknownActor
	}
	if err != nil {
		return shifts.Shift{}, false, err
	}
	return result, changed, nil
}

// Ledger is the shift side of a cash payment, used inside the payment's
// transaction (payments/pgstore): the payments domain decides the tender,
// balance and settlement; this decides which shift accounts for the cash and
// records the movement.
type Ledger struct{}

// LockOpenShift locks the staff member's open shift at the venue FOR UPDATE
// and returns it. found=false when there is none, including when a close
// committed while this waited (the status predicate is re-checked on the
// locked row).
func (Ledger) LockOpenShift(ctx context.Context, tx pgx.Tx, venueID, staffID string) (string, bool, error) {
	var id string
	err := tx.QueryRow(ctx, `SELECT id FROM "Shift" WHERE "venueId" = $1 AND "staffId" = $2 AND status = 'open' FOR UPDATE`,
		venueID, staffID).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", false, nil
	}
	if err != nil {
		return "", false, fmt.Errorf("lock open shift: %w", err)
	}
	return id, true, nil
}

// RecordCashSale records a cash payment's movement on a locked open shift.
// RecordCashRefund records cash paid out for a refund (Phase D9) on a locked
// open shift: the shift that physically pays it back, which need not be the
// sale's.
func (Ledger) RecordCashRefund(ctx context.Context, tx pgx.Tx, venueID, shiftID, adjustmentID, staffID string, amountCents int64) error {
	_, err := tx.Exec(ctx, `INSERT INTO "CashMovement" (id, "venueId", "shiftId", kind, "amountCents", "adjustmentId", "actorStaffId")
		VALUES ($1, $2, $3, 'cash_refund', $4, $5, $6)`, newID(), venueID, shiftID, amountCents, adjustmentID, staffID)
	if err != nil {
		return fmt.Errorf("record cash refund movement: %w", err)
	}
	return nil
}

func (Ledger) RecordCashSale(ctx context.Context, tx pgx.Tx, venueID, shiftID, paymentID, staffID string, amountCents int64) error {
	_, err := tx.Exec(ctx, `INSERT INTO "CashMovement" (id, "venueId", "shiftId", kind, "amountCents", "paymentId", "actorStaffId")
		VALUES ($1, $2, $3, 'cash_sale', $4, $5, $6)`, newID(), venueID, shiftID, amountCents, paymentID, staffID)
	if err != nil {
		return fmt.Errorf("record cash movement: %w", err)
	}
	return nil
}

func audit(ctx context.Context, tx pgx.Tx, sc shifts.Scope, a shifts.Actor, action, shiftID string, before, after map[string]any) error {
	var beforeJSON []byte
	if before != nil {
		beforeJSON, _ = json.Marshal(before)
	}
	afterJSON, _ := json.Marshal(after)
	_, err := tx.Exec(ctx, `INSERT INTO "AuditLog"
		(id, "organizationId", "venueId", "actorId", "actorEmail", "actorRole", action, resource, "resourceId", before, after)
		VALUES ($1, $2, $3, $4, $5, $6::"StaffRole", $7, 'shift', $8, $9, $10)`,
		newID(), sc.OrganizationID, sc.VenueID, a.StaffID, a.Email, a.Role, action, shiftID, beforeJSON, afterJSON)
	return err
}

// newID is a random v4 UUID, the form of every Prisma @default(uuid()) id.
func newID() string {
	var b [16]byte
	_, _ = rand.Read(b[:])
	b[6], b[8] = b[6]&0x0f|0x40, b[8]&0x3f|0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}

// shiftFact records a shift fact in its transaction (Phase D12). Identity and
// status only: cash figures are read over HTTP by those allowed to.
func shiftFact(ctx context.Context, tx pgx.Tx, venueID, eventType, shiftID string, version int, status string, terminalID *string) error {
	_, err := realtimestore.Record(ctx, tx, venueID, realtime.Fact{Type: eventType, AggregateType: "shift", AggregateID: shiftID,
		Version: realtime.V(version), Payload: map[string]any{"shiftId": shiftID, "status": status, "terminalId": terminalID}})
	return err
}
