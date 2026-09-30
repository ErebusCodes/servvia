// Package pgstore implements payments.Repository on the Prisma-managed
// "CheckPayment", "CheckPaymentTransition" and "CheckSettlement" tables
// (migration 20261003000000_payments_settlement).
//
// Every write locks the check row first (FOR UPDATE), then the payment (a
// result) or the tendering staff member's shift (cash): one lock order, so
// writes serialize per check without deadlocks, and the available amount is
// computed under that lock.
// (venueId, idempotencyKey) is unique; a settlement is unique per check;
// history is append-only (unique (paymentId, sequence)). Nothing here writes
// orders, kitchen tickets, table sessions or check lines.
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

	"servvia/services/core-platform/internal/payments"
)

type Store struct {
	pool   *pgxpool.Pool
	onFail func(error) // best-effort audit failures
	cash   CashLedger
}

// CashLedger is the shift side of a cash payment (shifts/pgstore.Ledger),
// called inside the payment's transaction after the check is locked. The
// payments domain keeps tender, balance and settlement; the ledger decides
// which shift accounts for the cash and records the movement. Lock order is
// always check, then shift.
type CashLedger interface {
	LockOpenShift(ctx context.Context, tx pgx.Tx, venueID, staffID string) (shiftID string, found bool, err error)
	RecordCashSale(ctx context.Context, tx pgx.Tx, venueID, shiftID, paymentID, staffID string, amountCents int64) error
	// RecordCashRefund records cash paid out for a refund (Phase D9) on a
	// locked open shift.
	RecordCashRefund(ctx context.Context, tx pgx.Tx, venueID, shiftID, adjustmentID, staffID string, amountCents int64) error
}

// New returns the store. cash may be nil, and then cash tender is refused
// (ErrNoOpenShift): no shift can account for it.
func New(pool *pgxpool.Pool, auditFailed func(error), cash CashLedger) *Store {
	return &Store{pool: pool, onFail: auditFailed, cash: cash}
}

var _ payments.Repository = (*Store)(nil)

const (
	pgUniqueViolation     = "23505"
	pgForeignKeyViolation = "23503"
	idempotencyIndex      = "CheckPayment_venueId_idempotencyKey_key"
)

const paymentColumns = `id, "venueId", "checkId", "amountCents", currency, "tenderType"::text, status::text, version,
       "idempotencyKey", "requestedByStaffId",
       (SELECT m."shiftId" FROM "CashMovement" m WHERE m."paymentId" = "CheckPayment".id), "resultReference",
       "resolvedAt", "createdAt", "updatedAt", ` + adjustmentSums

// adjustmentSums are a payment's returned (succeeded) and reserved (pending,
// uncertain) adjustment amounts; the enclosing row is "CheckPayment".
const adjustmentSums = `COALESCE((SELECT sum(a."amountCents") FROM "PaymentAdjustment" a
         WHERE a."paymentId" = "CheckPayment".id AND a.status = 'succeeded'), 0),
       COALESCE((SELECT sum(a."amountCents") FROM "PaymentAdjustment" a
         WHERE a."paymentId" = "CheckPayment".id AND a.status IN ('pending', 'uncertain')), 0)`

type querier interface {
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
}

func scanPayment(row pgx.CollectableRow) (payments.Payment, error) {
	var p payments.Payment
	var tender, status string
	err := row.Scan(&p.ID, &p.VenueID, &p.CheckID, &p.AmountCents, &p.Currency, &tender, &status, &p.Version,
		&p.IdempotencyKey, &p.RequestedByStaffID, &p.ShiftID, &p.ResultReference, &p.ResolvedAt, &p.CreatedAt, &p.UpdatedAt,
		&p.ReturnedCents, &p.ReservedCents)
	p.TenderType, p.Status = payments.TenderType(tender), payments.Status(status)
	return p, err
}

// withHistory reads the payments a query finds, then their transitions.
func withHistory(ctx context.Context, q querier, sql string, args ...any) ([]payments.Payment, error) {
	rows, err := q.Query(ctx, sql, args...)
	if err != nil {
		return nil, fmt.Errorf("query payments: %w", err)
	}
	found, err := pgx.CollectRows(rows, scanPayment)
	if err != nil || len(found) == 0 {
		return found, err
	}
	ids := make([]string, len(found))
	index := make(map[string]int, len(found))
	for i, p := range found {
		ids[i], index[p.ID] = p.ID, i
	}
	rows, err = q.Query(ctx, `SELECT "paymentId", sequence, "fromStatus"::text, "toStatus"::text, "actorId", "actorKind",
		"resultReference", at FROM "CheckPaymentTransition" WHERE "paymentId" = ANY($1) ORDER BY "paymentId", sequence`, ids)
	if err != nil {
		return nil, fmt.Errorf("query payment history: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var paymentID, to string
		var from *string
		var tr payments.Transition
		if err := rows.Scan(&paymentID, &tr.Sequence, &from, &to, &tr.ActorID, &tr.ActorKind, &tr.ResultReference, &tr.At); err != nil {
			return nil, fmt.Errorf("read payment history: %w", err)
		}
		tr.To = payments.Status(to)
		if from != nil {
			f := payments.Status(*from)
			tr.From = &f
		}
		p := &found[index[paymentID]]
		p.Transitions = append(p.Transitions, tr)
	}
	return found, rows.Err()
}

func one(ctx context.Context, q querier, sql string, args ...any) (payments.Payment, error) {
	found, err := withHistory(ctx, q, sql, args...)
	if err != nil {
		return payments.Payment{}, err
	}
	if len(found) == 0 {
		return payments.Payment{}, payments.ErrPaymentNotFound
	}
	return found[0], nil
}

func (st *Store) FindByKey(ctx context.Context, venueID, key string) (payments.Payment, string, bool, error) {
	var fingerprint string
	err := st.pool.QueryRow(ctx, `SELECT "requestFingerprint" FROM "CheckPayment" WHERE "venueId" = $1 AND "idempotencyKey" = $2`,
		venueID, key).Scan(&fingerprint)
	if errors.Is(err, pgx.ErrNoRows) {
		return payments.Payment{}, "", false, nil
	}
	if err != nil {
		return payments.Payment{}, "", false, fmt.Errorf("find payment by key: %w", err)
	}
	p, err := one(ctx, st.pool, `SELECT `+paymentColumns+` FROM "CheckPayment" WHERE "venueId" = $1 AND "idempotencyKey" = $2`, venueID, key)
	return p, fingerprint, err == nil, err
}

func (st *Store) Get(ctx context.Context, venueID, paymentID string) (payments.Payment, error) {
	return one(ctx, st.pool, `SELECT `+paymentColumns+` FROM "CheckPayment" WHERE "venueId" = $1 AND id = $2`, venueID, paymentID)
}

func (st *Store) Summary(ctx context.Context, venueID, checkID string) (payments.Summary, error) {
	s := payments.Summary{CheckID: checkID}
	err := st.pool.QueryRow(ctx, `SELECT status::text, currency, "totalCents" FROM "Check" WHERE "venueId" = $1 AND id = $2`,
		venueID, checkID).Scan(&s.CheckStatus, &s.Currency, &s.TotalCents)
	if errors.Is(err, pgx.ErrNoRows) {
		return payments.Summary{}, payments.ErrCheckNotFound
	}
	if err != nil {
		return payments.Summary{}, fmt.Errorf("load check: %w", err)
	}
	if s.Payments, err = withHistory(ctx, st.pool, `SELECT `+paymentColumns+` FROM "CheckPayment"
		WHERE "checkId" = $1 ORDER BY "createdAt", id`, checkID); err != nil {
		return payments.Summary{}, err
	}
	var set payments.Settlement
	var status string
	err = st.pool.QueryRow(ctx, `SELECT id, "checkId", "amountCents", currency, "settlingPaymentId", "actorId", "actorKind", "settledAt",
		status::text, cycle, "revokedAt" FROM "CheckSettlement" WHERE "checkId" = $1`, checkID).
		Scan(&set.ID, &set.CheckID, &set.AmountCents, &set.Currency, &set.SettlingPaymentID, &set.ActorID, &set.ActorKind, &set.SettledAt,
			&status, &set.Cycle, &set.RevokedAt)
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		return s, nil
	case err != nil:
		return payments.Summary{}, fmt.Errorf("load settlement: %w", err)
	}
	set.Status = payments.SettlementStatus(status)
	rows, err := st.pool.Query(ctx, `SELECT sequence, "toStatus"::text, cycle, "amountCents", "paymentId", "adjustmentId", "actorId",
		"actorKind", at FROM "CheckSettlementTransition" WHERE "settlementId" = $1 ORDER BY sequence`, set.ID)
	if err != nil {
		return payments.Summary{}, fmt.Errorf("load settlement history: %w", err)
	}
	set.History, err = pgx.CollectRows(rows, func(r pgx.CollectableRow) (payments.SettlementEvent, error) {
		var e payments.SettlementEvent
		var to string
		err := r.Scan(&e.Sequence, &to, &e.Cycle, &e.AmountCents, &e.PaymentID, &e.AdjustmentID, &e.ActorID, &e.ActorKind, &e.At)
		e.Status = payments.SettlementStatus(to)
		return e, err
	})
	if err != nil {
		return payments.Summary{}, fmt.Errorf("read settlement history: %w", err)
	}
	s.Settlement = &set
	return s, nil
}

type lockedCheck struct {
	status, currency string
	total            int64
}

// lockCheck holds the check row FOR UPDATE for the rest of the transaction.
func lockCheck(ctx context.Context, tx pgx.Tx, venueID, checkID string) (lockedCheck, error) {
	var c lockedCheck
	err := tx.QueryRow(ctx, `SELECT status::text, currency, "totalCents" FROM "Check" WHERE "venueId" = $1 AND id = $2 FOR UPDATE`,
		venueID, checkID).Scan(&c.status, &c.currency, &c.total)
	if errors.Is(err, pgx.ErrNoRows) {
		return c, payments.ErrCheckNotFound
	}
	if err != nil {
		return c, fmt.Errorf("lock check: %w", err)
	}
	return c, nil
}

// balance reads a locked check's payments and applies the balance rule.
func balance(ctx context.Context, tx pgx.Tx, checkID string, total int64) (payments.Balance, error) {
	rows, err := tx.Query(ctx, `SELECT status::text, "amountCents", `+adjustmentSums+` FROM "CheckPayment" WHERE "checkId" = $1`, checkID)
	if err != nil {
		return payments.Balance{}, fmt.Errorf("load payments: %w", err)
	}
	list, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (payments.Payment, error) {
		var p payments.Payment
		var status string
		err := r.Scan(&status, &p.AmountCents, &p.ReturnedCents, &p.ReservedCents)
		p.Status = payments.Status(status)
		return p, err
	})
	if err != nil {
		return payments.Balance{}, fmt.Errorf("read payments: %w", err)
	}
	return payments.ComputeBalance(total, list), nil
}

func (st *Store) Initiate(ctx context.Context, n payments.NewPayment) (payments.Payment, error) {
	cmd := n.Command
	venueID := cmd.Scope.VenueID
	id := newID()
	err := pgx.BeginFunc(ctx, st.pool, func(tx pgx.Tx) error {
		c, err := lockCheck(ctx, tx, venueID, cmd.CheckID)
		if err != nil {
			return err
		}
		// A request with this key that committed while this one waited for
		// the check lock is a replay (or a key conflict), decided by the
		// caller; never "amount exceeds available".
		var taken bool
		if err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM "CheckPayment" WHERE "venueId" = $1 AND "idempotencyKey" = $2)`,
			venueID, cmd.IdempotencyKey).Scan(&taken); err != nil {
			return fmt.Errorf("check idempotency key: %w", err)
		}
		if taken {
			return payments.ErrDuplicateKey
		}
		if c.status != "open" {
			return &payments.CheckNotOpenError{Status: c.status}
		}
		if cmd.Currency != c.currency {
			return &payments.CurrencyMismatchError{CheckCurrency: c.currency}
		}
		b, err := balance(ctx, tx, cmd.CheckID, c.total)
		if err != nil {
			return err
		}
		if cmd.AmountCents > b.AvailableCents {
			return &payments.AmountExceedsAvailableError{AvailableCents: max(b.AvailableCents, 0)}
		}
		if cmd.TenderType == payments.TenderCash {
			return st.tenderCash(ctx, tx, n, id, c, b)
		}
		if _, err := tx.Exec(ctx, `INSERT INTO "CheckPayment"
			(id, "venueId", "checkId", "amountCents", currency, "tenderType", "idempotencyKey", "requestFingerprint",
			 "requestedByStaffId", "updatedAt")
			VALUES ($1, $2, $3, $4, $5, $6::"TenderType", $7, $8, $9, now())`,
			id, venueID, cmd.CheckID, cmd.AmountCents, cmd.Currency, string(cmd.TenderType), cmd.IdempotencyKey,
			n.Fingerprint, cmd.Actor.StaffID); err != nil {
			return err
		}
		if err := transition(ctx, tx, id, 1, nil, payments.StatusPending, cmd.Actor.StaffID, "staff", nil); err != nil {
			return err
		}
		return audit(ctx, tx, cmd.Scope, cmd.Actor, "PAYMENT_CREATED", id, map[string]any{
			"paymentId": id, "checkId": cmd.CheckID, "amountCents": cmd.AmountCents, "currency": cmd.Currency,
			"tenderType": cmd.TenderType, "status": payments.StatusPending,
			"checkTotalCents": c.total, "availableCentsBefore": b.AvailableCents,
		})
	})
	var pgErr *pgconn.PgError
	switch {
	case err == nil:
		return st.Get(ctx, venueID, id)
	case errors.Is(err, payments.ErrDuplicateKey):
		return payments.Payment{}, err
	case errors.As(err, &pgErr) && pgErr.Code == pgUniqueViolation && pgErr.ConstraintName == idempotencyIndex:
		return payments.Payment{}, payments.ErrDuplicateKey
	case errors.As(err, &pgErr) && pgErr.Code == pgForeignKeyViolation &&
		(pgErr.ConstraintName == "CheckPayment_requestedByStaffId_fkey" || pgErr.ConstraintName == "AuditLog_actorId_fkey"):
		return payments.Payment{}, payments.ErrUnknownActor
	}
	return payments.Payment{}, err
}

func (st *Store) RecordResult(ctx context.Context, cmd payments.ResultCommand) (payments.Payment, bool, error) {
	venueID := cmd.Scope.VenueID
	var changed bool
	err := pgx.BeginFunc(ctx, st.pool, func(tx pgx.Tx) error {
		var checkID string
		err := tx.QueryRow(ctx, `SELECT "checkId" FROM "CheckPayment" WHERE "venueId" = $1 AND id = $2`, venueID, cmd.PaymentID).Scan(&checkID)
		if errors.Is(err, pgx.ErrNoRows) {
			return payments.ErrPaymentNotFound
		}
		if err != nil {
			return fmt.Errorf("find payment: %w", err)
		}
		// Lock order: the check, then the payment.
		c, err := lockCheck(ctx, tx, venueID, checkID)
		if err != nil {
			return err
		}
		var current string
		var version int
		if err := tx.QueryRow(ctx, `SELECT status::text, version FROM "CheckPayment" WHERE id = $1 FOR UPDATE`, cmd.PaymentID).
			Scan(&current, &version); err != nil {
			return fmt.Errorf("lock payment: %w", err)
		}
		from := payments.Status(current)
		if changed, err = payments.DecideResult(from, cmd.Outcome); err != nil || !changed {
			return err
		}
		if _, err := tx.Exec(ctx, `UPDATE "CheckPayment" SET status = $2::"CheckPaymentStatus", version = version + 1,
			"resultReference" = COALESCE($3, "resultReference"),
			"resolvedAt" = CASE WHEN $2 IN ('succeeded', 'failed') THEN now() END, "updatedAt" = now()
			WHERE id = $1 AND version = $4`, cmd.PaymentID, string(cmd.Outcome), cmd.Reference, version); err != nil {
			return fmt.Errorf("record payment result: %w", err)
		}
		var sequence int
		if err := tx.QueryRow(ctx, `SELECT max(sequence) + 1 FROM "CheckPaymentTransition" WHERE "paymentId" = $1`,
			cmd.PaymentID).Scan(&sequence); err != nil {
			return fmt.Errorf("number payment transition: %w", err)
		}
		if err := transition(ctx, tx, cmd.PaymentID, sequence, &from, cmd.Outcome, cmd.Actor.ID, payments.AdapterKind, cmd.Reference); err != nil {
			return err
		}
		if cmd.Outcome != payments.StatusSucceeded {
			return nil
		}
		return settleIfPaid(ctx, tx, checkID, c, cmd.PaymentID, cmd.Actor.ID, payments.AdapterKind)
	})
	if err != nil {
		return payments.Payment{}, false, err
	}
	p, err := st.Get(ctx, venueID, cmd.PaymentID)
	return p, changed, err
}

// tenderCash is the cash branch of Initiate, inside its transaction with the
// check locked and the amount already checked against the available amount.
// It locks the tendering staff member's open shift, writes the payment as
// succeeded (staff accepting the cash is the result), its history, the cash
// movement and the audit row, and settles the check if this pays it: all or
// nothing.
func (st *Store) tenderCash(ctx context.Context, tx pgx.Tx, n payments.NewPayment, id string, c lockedCheck, b payments.Balance) error {
	cmd := n.Command
	venueID := cmd.Scope.VenueID
	if st.cash == nil {
		return payments.ErrNoOpenShift
	}
	shiftID, found, err := st.cash.LockOpenShift(ctx, tx, venueID, cmd.Actor.StaffID)
	if err != nil {
		return err
	}
	if !found {
		return payments.ErrNoOpenShift
	}
	if _, err := tx.Exec(ctx, `INSERT INTO "CheckPayment"
		(id, "venueId", "checkId", "amountCents", currency, "tenderType", status, "idempotencyKey", "requestFingerprint",
		 "requestedByStaffId", "resolvedAt", "updatedAt")
		VALUES ($1, $2, $3, $4, $5, 'cash', 'succeeded', $6, $7, $8, now(), now())`,
		id, venueID, cmd.CheckID, cmd.AmountCents, cmd.Currency, cmd.IdempotencyKey, n.Fingerprint, cmd.Actor.StaffID); err != nil {
		return err
	}
	if err := transition(ctx, tx, id, 1, nil, payments.StatusSucceeded, cmd.Actor.StaffID, "staff", nil); err != nil {
		return err
	}
	if err := st.cash.RecordCashSale(ctx, tx, venueID, shiftID, id, cmd.Actor.StaffID, cmd.AmountCents); err != nil {
		return err
	}
	if err := audit(ctx, tx, cmd.Scope, cmd.Actor, "CASH_PAYMENT", id, map[string]any{
		"paymentId": id, "checkId": cmd.CheckID, "shiftId": shiftID, "amountCents": cmd.AmountCents, "currency": cmd.Currency,
		"tenderType": payments.TenderCash, "status": payments.StatusSucceeded,
		"checkTotalCents": c.total, "availableCentsBefore": b.AvailableCents,
	}); err != nil {
		return err
	}
	return settleIfPaid(ctx, tx, cmd.CheckID, c, id, cmd.Actor.StaffID, "staff")
}

// settleIfPaid records the settlement when the check's effective paid
// amount (succeeded payments less money returned) now equals its total: in
// the transaction of the success that completed it, which also moves the
// check to settled. Holds make overpayment impossible, so equality is the
// only case. The first time it creates the check's settlement (cycle 1);
// after a revocation it settles the same row again (cycle + 1). Either way a
// settled transition is appended. Used by card results and cash.
func settleIfPaid(ctx context.Context, tx pgx.Tx, checkID string, c lockedCheck, paymentID, actorID, actorKind string) error {
	b, err := balance(ctx, tx, checkID, c.total)
	if err != nil {
		return err
	}
	if b.BalanceCents != 0 || c.status != "open" {
		return nil
	}
	var settlementID string
	var cycle int
	err = tx.QueryRow(ctx, `SELECT id, cycle FROM "CheckSettlement" WHERE "checkId" = $1 FOR UPDATE`, checkID).Scan(&settlementID, &cycle)
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		settlementID, cycle = newID(), 1
		if _, err := tx.Exec(ctx, `INSERT INTO "CheckSettlement"
			(id, "checkId", "amountCents", currency, "settlingPaymentId", "actorId", "actorKind")
			VALUES ($1, $2, $3, $4, $5, $6, $7)`, settlementID, checkID, c.total, c.currency, paymentID, actorID, actorKind); err != nil {
			return fmt.Errorf("record settlement: %w", err)
		}
	case err != nil:
		return fmt.Errorf("lock settlement: %w", err)
	default:
		// Settled again after a revocation: the same row, the next cycle.
		cycle++
		if _, err := tx.Exec(ctx, `UPDATE "CheckSettlement" SET status = 'settled', cycle = $2, "amountCents" = $3,
			"settlingPaymentId" = $4, "actorId" = $5, "actorKind" = $6, "settledAt" = now(), "revokedAt" = NULL,
			version = version + 1 WHERE id = $1 AND status = 'revoked'`,
			settlementID, cycle, c.total, paymentID, actorID, actorKind); err != nil {
			return fmt.Errorf("record settlement: %w", err)
		}
	}
	if err := settlementEvent(ctx, tx, settlementID, payments.SettlementSettled, cycle, c.total, &paymentID, nil, actorID, actorKind); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `UPDATE "Check" SET status = 'settled', version = version + 1, "updatedAt" = now()
		WHERE id = $1 AND status = 'open'`, checkID); err != nil {
		return fmt.Errorf("settle check: %w", err)
	}
	return settlementFact(ctx, tx, checkID, "check.settled", settlementID, cycle)
}

// revokeIfOwing is the other half: after money was returned (a succeeded
// adjustment), a settled check whose effective paid amount is now below its
// total owes again. Its settlement becomes revoked (the row and every past
// event are kept), a revoked transition is appended, and the check is open
// again. Nothing else changes: no table session, order or kitchen state.
// Called under the check's row lock; reports whether it revoked.
func revokeIfOwing(ctx context.Context, tx pgx.Tx, checkID string, c lockedCheck, adjustmentID, actorID, actorKind string) (bool, error) {
	b, err := balance(ctx, tx, checkID, c.total)
	if err != nil {
		return false, err
	}
	if b.BalanceCents <= 0 || c.status != "settled" {
		return false, nil
	}
	var settlementID string
	var cycle int
	if err := tx.QueryRow(ctx, `SELECT id, cycle FROM "CheckSettlement" WHERE "checkId" = $1 AND status = 'settled' FOR UPDATE`,
		checkID).Scan(&settlementID, &cycle); err != nil {
		return false, fmt.Errorf("lock settlement: %w", err)
	}
	if _, err := tx.Exec(ctx, `UPDATE "CheckSettlement" SET status = 'revoked', "revokedAt" = now(), version = version + 1
		WHERE id = $1`, settlementID); err != nil {
		return false, fmt.Errorf("revoke settlement: %w", err)
	}
	if err := settlementEvent(ctx, tx, settlementID, payments.SettlementRevoked, cycle, c.total, nil, &adjustmentID, actorID, actorKind); err != nil {
		return false, err
	}
	if _, err := tx.Exec(ctx, `UPDATE "Check" SET status = 'open', version = version + 1, "updatedAt" = now()
		WHERE id = $1 AND status = 'settled'`, checkID); err != nil {
		return false, fmt.Errorf("reopen check: %w", err)
	}
	return true, settlementFact(ctx, tx, checkID, "check.settlement_revoked", settlementID, cycle)
}

func settlementEvent(ctx context.Context, tx pgx.Tx, settlementID string, status payments.SettlementStatus, cycle int, amount int64,
	paymentID, adjustmentID *string, actorID, actorKind string) error {
	_, err := tx.Exec(ctx, `INSERT INTO "CheckSettlementTransition"
		(id, "settlementId", sequence, "toStatus", cycle, "amountCents", "paymentId", "adjustmentId", "actorId", "actorKind")
		VALUES ($1, $2, (SELECT COALESCE(max(sequence), 0) + 1 FROM "CheckSettlementTransition" WHERE "settlementId" = $2),
		        $3::"CheckSettlementStatus", $4, $5, $6, $7, $8, $9)`,
		newID(), settlementID, string(status), cycle, amount, paymentID, adjustmentID, actorID, actorKind)
	if err != nil {
		return fmt.Errorf("record settlement event: %w", err)
	}
	return nil
}

func transition(ctx context.Context, tx pgx.Tx, paymentID string, sequence int, from *payments.Status, to payments.Status,
	actorID, actorKind string, reference *string) error {
	var fromText *string
	if from != nil {
		f := string(*from)
		fromText = &f
	}
	_, err := tx.Exec(ctx, `INSERT INTO "CheckPaymentTransition"
		(id, "paymentId", "fromStatus", "toStatus", sequence, "actorId", "actorKind", "resultReference")
		VALUES ($1, $2, $3::"CheckPaymentStatus", $4::"CheckPaymentStatus", $5, $6, $7, $8)`,
		newID(), paymentID, fromText, string(to), sequence, actorID, actorKind, reference)
	if err != nil {
		return fmt.Errorf("record payment transition: %w", err)
	}
	// Every payment creation and status change is a realtime fact (D12).
	return paymentFact(ctx, tx, paymentID, from)
}

// audit records a staff financial action in the existing AuditLog, in the
// action's transaction. Adapter results are recorded as transitions instead:
// an adapter is not a staff member.
func audit(ctx context.Context, tx pgx.Tx, sc payments.Scope, a payments.Staff, action, paymentID string, after map[string]any) error {
	body, _ := json.Marshal(after)
	_, err := tx.Exec(ctx, `INSERT INTO "AuditLog"
		(id, "organizationId", "venueId", "actorId", "actorEmail", "actorRole", action, resource, "resourceId", after)
		VALUES ($1, $2, $3, $4, $5, $6::"StaffRole", $7, 'payment', $8, $9)`,
		newID(), sc.OrganizationID, sc.VenueID, a.StaffID, a.Email, a.Role, action, paymentID, body)
	return err
}

// Audit writes a best-effort audit row outside any transaction.
func (st *Store) Audit(ctx context.Context, sc payments.Scope, a payments.Staff, action, paymentID string, detail map[string]any) {
	err := pgx.BeginFunc(ctx, st.pool, func(tx pgx.Tx) error { return audit(ctx, tx, sc, a, action, paymentID, detail) })
	if err != nil && st.onFail != nil {
		st.onFail(fmt.Errorf("audit %s for %s: %w", action, paymentID, err))
	}
}

// newID is a random v4 UUID, the form of every Prisma @default(uuid()) id.
func newID() string {
	var b [16]byte
	_, _ = rand.Read(b[:])
	b[6], b[8] = b[6]&0x0f|0x40, b[8]&0x3f|0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}
