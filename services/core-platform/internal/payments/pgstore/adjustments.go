package pgstore

// The refunds repository (refunds.Repository, Phase D9) lives beside the
// payment store on purpose: a return of money changes the check's effective
// paid amount and may revoke its settlement, so it must run in the same
// transaction as, and with the same helpers and lock order as, payments:
// check, then payment, then (cash) the paying staff member's shift. The
// refund rules stay in package refunds; nothing here duplicates the balance
// or settlement algorithm.

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"servvia/services/core-platform/internal/payments"
	"servvia/services/core-platform/internal/refunds"
)

// AdjustmentStore implements refunds.Repository.
type AdjustmentStore struct{ *Store }

// Adjustments returns the refunds repository over the same pool, audit hook
// and cash ledger as the payment store.
func (st *Store) Adjustments() AdjustmentStore { return AdjustmentStore{st} }

var _ refunds.Repository = AdjustmentStore{}

const adjustmentIdempotencyIndex = "PaymentAdjustment_venueId_idempotencyKey_key"

const adjustmentSelect = `SELECT a.id, a."venueId", a."paymentId", p."checkId", a.kind::text, a."amountCents", a.currency,
       p."tenderType"::text, a.status::text, a.version, a."idempotencyKey", a.reason, a."requestedByStaffId", a."originDeviceId",
       (SELECT m."shiftId" FROM "CashMovement" m WHERE m."adjustmentId" = a.id), a."resultReference", a."resolvedAt",
       a."createdAt", a."updatedAt"
FROM "PaymentAdjustment" a JOIN "CheckPayment" p ON p.id = a."paymentId"`

func scanAdjustment(row pgx.CollectableRow) (refunds.Adjustment, error) {
	var a refunds.Adjustment
	var kind, tender, status string
	err := row.Scan(&a.ID, &a.VenueID, &a.PaymentID, &a.CheckID, &kind, &a.AmountCents, &a.Currency, &tender, &status, &a.Version,
		&a.IdempotencyKey, &a.Reason, &a.RequestedByStaffID, &a.OriginDeviceID, &a.ShiftID, &a.ResultReference, &a.ResolvedAt,
		&a.CreatedAt, &a.UpdatedAt)
	a.Kind, a.TenderType, a.Status = refunds.Kind(kind), payments.TenderType(tender), payments.Status(status)
	return a, err
}

func adjustmentsWithHistory(ctx context.Context, q querier, sql string, args ...any) ([]refunds.Adjustment, error) {
	rows, err := q.Query(ctx, sql, args...)
	if err != nil {
		return nil, fmt.Errorf("query refunds: %w", err)
	}
	found, err := pgx.CollectRows(rows, scanAdjustment)
	if err != nil || len(found) == 0 {
		return found, err
	}
	ids := make([]string, len(found))
	index := make(map[string]int, len(found))
	for i, a := range found {
		ids[i], index[a.ID] = a.ID, i
	}
	rows, err = q.Query(ctx, `SELECT "adjustmentId", sequence, "fromStatus"::text, "toStatus"::text, "actorId", "actorKind",
		"resultReference", at FROM "PaymentAdjustmentTransition" WHERE "adjustmentId" = ANY($1) ORDER BY "adjustmentId", sequence`, ids)
	if err != nil {
		return nil, fmt.Errorf("query refund history: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var id, to string
		var from *string
		var tr payments.Transition
		if err := rows.Scan(&id, &tr.Sequence, &from, &to, &tr.ActorID, &tr.ActorKind, &tr.ResultReference, &tr.At); err != nil {
			return nil, fmt.Errorf("read refund history: %w", err)
		}
		tr.To = payments.Status(to)
		if from != nil {
			f := payments.Status(*from)
			tr.From = &f
		}
		found[index[id]].Transitions = append(found[index[id]].Transitions, tr)
	}
	return found, rows.Err()
}

func oneAdjustment(ctx context.Context, q querier, sql string, args ...any) (refunds.Adjustment, error) {
	found, err := adjustmentsWithHistory(ctx, q, sql, args...)
	if err != nil {
		return refunds.Adjustment{}, err
	}
	if len(found) == 0 {
		return refunds.Adjustment{}, refunds.ErrAdjustmentNotFound
	}
	return found[0], nil
}

func (s AdjustmentStore) FindByKey(ctx context.Context, venueID, key string) (refunds.Adjustment, string, bool, error) {
	var fingerprint string
	err := s.pool.QueryRow(ctx, `SELECT "requestFingerprint" FROM "PaymentAdjustment" WHERE "venueId" = $1 AND "idempotencyKey" = $2`,
		venueID, key).Scan(&fingerprint)
	if errors.Is(err, pgx.ErrNoRows) {
		return refunds.Adjustment{}, "", false, nil
	}
	if err != nil {
		return refunds.Adjustment{}, "", false, fmt.Errorf("find refund by key: %w", err)
	}
	a, err := oneAdjustment(ctx, s.pool, adjustmentSelect+` WHERE a."venueId" = $1 AND a."idempotencyKey" = $2`, venueID, key)
	return a, fingerprint, err == nil, err
}

func (s AdjustmentStore) Get(ctx context.Context, venueID, id string) (refunds.Adjustment, error) {
	return oneAdjustment(ctx, s.pool, adjustmentSelect+` WHERE a."venueId" = $1 AND a.id = $2`, venueID, id)
}

func (s AdjustmentStore) ListForPayment(ctx context.Context, venueID, paymentID string) ([]refunds.Adjustment, error) {
	var found bool
	if err := s.pool.QueryRow(ctx, `SELECT true FROM "CheckPayment" WHERE "venueId" = $1 AND id = $2`, venueID, paymentID).
		Scan(&found); errors.Is(err, pgx.ErrNoRows) {
		return nil, refunds.ErrPaymentNotFound
	} else if err != nil {
		return nil, fmt.Errorf("find payment: %w", err)
	}
	return adjustmentsWithHistory(ctx, s.pool, adjustmentSelect+` WHERE a."venueId" = $1 AND a."paymentId" = $2
		ORDER BY a."createdAt", a.id`, venueID, paymentID)
}

// lockedPayment is a payment read under its row lock, with its returns.
type lockedPayment struct {
	checkID, currency string
	status            payments.Status
	tender            payments.TenderType
	payments.Payment
}

// lockPaymentOfCheck locks a payment's check, then the payment (the D6
// order), and reads what returning money from it needs.
func lockPaymentOfCheck(ctx context.Context, tx pgx.Tx, venueID, paymentID string) (lockedCheck, lockedPayment, error) {
	var checkID string
	err := tx.QueryRow(ctx, `SELECT "checkId" FROM "CheckPayment" WHERE "venueId" = $1 AND id = $2`, venueID, paymentID).Scan(&checkID)
	if errors.Is(err, pgx.ErrNoRows) {
		return lockedCheck{}, lockedPayment{}, refunds.ErrPaymentNotFound
	}
	if err != nil {
		return lockedCheck{}, lockedPayment{}, fmt.Errorf("find payment: %w", err)
	}
	c, err := lockCheck(ctx, tx, venueID, checkID)
	if err != nil {
		return lockedCheck{}, lockedPayment{}, err
	}
	if _, err := tx.Exec(ctx, `SELECT 1 FROM "CheckPayment" WHERE id = $1 FOR UPDATE`, paymentID); err != nil {
		return lockedCheck{}, lockedPayment{}, fmt.Errorf("lock payment: %w", err)
	}
	var p lockedPayment
	var status, tender string
	// Read after the lock: adjustments of a payment are only written under it.
	err = tx.QueryRow(ctx, `SELECT "checkId", currency, status::text, "tenderType"::text, "amountCents", `+adjustmentSums+`
		FROM "CheckPayment" WHERE id = $1`, paymentID).
		Scan(&p.checkID, &p.currency, &status, &tender, &p.AmountCents, &p.ReturnedCents, &p.ReservedCents)
	if err != nil {
		return lockedCheck{}, lockedPayment{}, fmt.Errorf("read payment: %w", err)
	}
	p.status, p.tender = payments.Status(status), payments.TenderType(tender)
	p.Payment.Status = p.status
	return c, p, nil
}

func (s AdjustmentStore) Create(ctx context.Context, n refunds.NewAdjustment) (refunds.Adjustment, error) {
	venueID := n.Scope.VenueID
	id := newID()
	err := pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		c, p, err := lockPaymentOfCheck(ctx, tx, venueID, n.PaymentID)
		if err != nil {
			return err
		}
		var taken bool
		if err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM "PaymentAdjustment" WHERE "venueId" = $1 AND "idempotencyKey" = $2)`,
			venueID, n.IdempotencyKey).Scan(&taken); err != nil {
			return fmt.Errorf("check idempotency key: %w", err)
		}
		if taken {
			return refunds.ErrDuplicateKey // decided by the caller: a replay or a key conflict
		}
		switch {
		case p.status != payments.StatusSucceeded:
			return &refunds.PaymentNotRefundableError{Status: p.status}
		case n.Kind == refunds.KindReversal && p.tender != payments.TenderCard:
			return refunds.ErrNotReversible
		case n.Currency != p.currency:
			return &refunds.CurrencyMismatchError{PaymentCurrency: p.currency}
		case n.AmountCents > p.RefundableCents():
			return &refunds.ExceedsRefundableError{RefundableCents: max(p.RefundableCents(), 0)}
		}
		switch {
		case n.Kind == refunds.KindReversal:
			return s.insertSucceeded(ctx, tx, n, id, p.checkID, c, *n.DeviceID, payments.AdapterKind, nil)
		case p.tender == payments.TenderCash:
			if s.cash == nil {
				return refunds.ErrNoOpenShift
			}
			shiftID, found, err := s.cash.LockOpenShift(ctx, tx, venueID, n.Staff.StaffID)
			if err != nil {
				return err
			}
			if !found {
				return refunds.ErrNoOpenShift
			}
			return s.insertSucceeded(ctx, tx, n, id, p.checkID, c, n.Staff.StaffID, "staff", &shiftID)
		default: // a card refund: the adapter will report how it ended
			if err := insertAdjustment(ctx, tx, n, id, payments.StatusPending); err != nil {
				return err
			}
			if err := adjustmentTransition(ctx, tx, id, 1, nil, payments.StatusPending, n.Staff.StaffID, "staff", nil); err != nil {
				return err
			}
			return staffAudit(ctx, tx, n.Scope, *n.Staff, "REFUND_REQUESTED", id, adjustmentDetail(n, id, payments.StatusPending, p))
		}
	})
	var pgErr *pgconn.PgError
	switch {
	case err == nil:
		return s.Get(ctx, venueID, id)
	case errors.Is(err, refunds.ErrDuplicateKey):
		return refunds.Adjustment{}, err
	case errors.As(err, &pgErr) && pgErr.Code == pgUniqueViolation && pgErr.ConstraintName == adjustmentIdempotencyIndex:
		return refunds.Adjustment{}, refunds.ErrDuplicateKey
	case errors.As(err, &pgErr) && pgErr.Code == pgForeignKeyViolation &&
		(pgErr.ConstraintName == "PaymentAdjustment_requestedByStaffId_fkey" || pgErr.ConstraintName == "AuditLog_actorId_fkey"):
		return refunds.Adjustment{}, refunds.ErrUnknownActor
	}
	return refunds.Adjustment{}, err
}

// insertSucceeded writes an adjustment that is final at creation (a cash
// refund, a reversal), its history, the cash movement (cash), the audit
// (staff), and revokes the settlement if the check now owes.
func (s AdjustmentStore) insertSucceeded(ctx context.Context, tx pgx.Tx, n refunds.NewAdjustment, id, checkID string, c lockedCheck,
	actorID, actorKind string, shiftID *string) error {
	if err := insertAdjustment(ctx, tx, n, id, payments.StatusSucceeded); err != nil {
		return err
	}
	if err := adjustmentTransition(ctx, tx, id, 1, nil, payments.StatusSucceeded, actorID, actorKind, n.Reference); err != nil {
		return err
	}
	if shiftID != nil {
		if err := s.cash.RecordCashRefund(ctx, tx, n.Scope.VenueID, *shiftID, id, actorID, n.AmountCents); err != nil {
			return err
		}
	}
	revoked, err := revokeIfOwing(ctx, tx, checkID, c, id, actorID, actorKind)
	if err != nil {
		return err
	}
	if n.Staff == nil {
		return nil // a reversal: its history is the transitions (no staff actor)
	}
	detail := map[string]any{"refundId": id, "paymentId": n.PaymentID, "amountCents": n.AmountCents, "currency": n.Currency,
		"shiftId": shiftID, "reason": n.Reason, "settlementRevoked": revoked}
	if err := staffAudit(ctx, tx, n.Scope, *n.Staff, "CASH_REFUND_SUCCEEDED", id, detail); err != nil {
		return err
	}
	if revoked {
		return staffAudit(ctx, tx, n.Scope, *n.Staff, "SETTLEMENT_REVOKED", id, map[string]any{"refundId": id, "paymentId": n.PaymentID})
	}
	return nil
}

func insertAdjustment(ctx context.Context, tx pgx.Tx, n refunds.NewAdjustment, id string, status payments.Status) error {
	var staffID *string
	if n.Staff != nil {
		staffID = &n.Staff.StaffID
	}
	_, err := tx.Exec(ctx, `INSERT INTO "PaymentAdjustment"
		(id, "venueId", "paymentId", kind, "amountCents", currency, status, "idempotencyKey", "requestFingerprint", reason,
		 "requestedByStaffId", "originDeviceId", "resultReference", "resolvedAt", "updatedAt")
		VALUES ($1, $2, $3, $4::"PaymentAdjustmentKind", $5, $6, $7::"CheckPaymentStatus", $8, $9, $10, $11, $12, $13,
		        CASE WHEN $7 IN ('succeeded', 'failed') THEN now() END, now())`,
		id, n.Scope.VenueID, n.PaymentID, string(n.Kind), n.AmountCents, n.Currency, string(status), n.IdempotencyKey, n.Fingerprint,
		n.Reason, staffID, n.DeviceID, n.Reference)
	return err
}

func adjustmentTransition(ctx context.Context, tx pgx.Tx, id string, sequence int, from *payments.Status, to payments.Status,
	actorID, actorKind string, reference *string) error {
	var fromText *string
	if from != nil {
		f := string(*from)
		fromText = &f
	}
	_, err := tx.Exec(ctx, `INSERT INTO "PaymentAdjustmentTransition"
		(id, "adjustmentId", "fromStatus", "toStatus", sequence, "actorId", "actorKind", "resultReference")
		VALUES ($1, $2, $3::"CheckPaymentStatus", $4::"CheckPaymentStatus", $5, $6, $7, $8)`,
		newID(), id, fromText, string(to), sequence, actorID, actorKind, reference)
	if err != nil {
		return fmt.Errorf("record refund transition: %w", err)
	}
	return nil
}

func adjustmentDetail(n refunds.NewAdjustment, id string, status payments.Status, p lockedPayment) map[string]any {
	return map[string]any{"refundId": id, "paymentId": n.PaymentID, "kind": n.Kind, "amountCents": n.AmountCents,
		"currency": n.Currency, "status": status, "reason": n.Reason, "refundableCentsBefore": p.RefundableCents()}
}

// staffAudit writes an AuditLog row for a staff action, in its transaction.
func staffAudit(ctx context.Context, tx pgx.Tx, sc refunds.Scope, a refunds.Staff, action, id string, after map[string]any) error {
	body, _ := json.Marshal(after)
	_, err := tx.Exec(ctx, `INSERT INTO "AuditLog"
		(id, "organizationId", "venueId", "actorId", "actorEmail", "actorRole", action, resource, "resourceId", after)
		VALUES ($1, $2, $3, $4, $5, $6::"StaffRole", $7, 'refund', $8, $9)`,
		newID(), sc.OrganizationID, sc.VenueID, a.StaffID, a.Email, a.Role, action, id, body)
	return err
}

func (s AdjustmentStore) Audit(ctx context.Context, sc refunds.Scope, a refunds.Staff, action, id string, detail map[string]any) {
	err := pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error { return staffAudit(ctx, tx, sc, a, action, id, detail) })
	if err != nil && s.onFail != nil {
		s.onFail(fmt.Errorf("audit %s for %s: %w", action, id, err))
	}
}

func (s AdjustmentStore) RecordResult(ctx context.Context, cmd refunds.ResultCommand) (refunds.Adjustment, bool, error) {
	venueID := cmd.Scope.VenueID
	var changed bool
	err := pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		var paymentID string
		err := tx.QueryRow(ctx, `SELECT "paymentId" FROM "PaymentAdjustment" WHERE "venueId" = $1 AND id = $2`, venueID, cmd.AdjustmentID).
			Scan(&paymentID)
		if errors.Is(err, pgx.ErrNoRows) {
			return refunds.ErrAdjustmentNotFound
		}
		if err != nil {
			return fmt.Errorf("find refund: %w", err)
		}
		c, p, err := lockPaymentOfCheck(ctx, tx, venueID, paymentID)
		if err != nil {
			return err
		}
		var kind, tender, current string
		var version int
		if err := tx.QueryRow(ctx, `SELECT a.kind::text, p."tenderType"::text, a.status::text, a.version
			FROM "PaymentAdjustment" a JOIN "CheckPayment" p ON p.id = a."paymentId" WHERE a.id = $1 FOR UPDATE OF a`, cmd.AdjustmentID).
			Scan(&kind, &tender, &current, &version); err != nil {
			return fmt.Errorf("lock refund: %w", err)
		}
		if refunds.Kind(kind) != refunds.KindRefund || payments.TenderType(tender) != payments.TenderCard {
			return refunds.ErrNotAwaitingResult
		}
		from := payments.Status(current)
		if changed, err = payments.DecideResult(from, cmd.Outcome); err != nil || !changed {
			return err
		}
		if _, err := tx.Exec(ctx, `UPDATE "PaymentAdjustment" SET status = $2::"CheckPaymentStatus", version = version + 1,
			"resultReference" = COALESCE($3, "resultReference"),
			"resolvedAt" = CASE WHEN $2 IN ('succeeded', 'failed') THEN now() END, "updatedAt" = now()
			WHERE id = $1 AND version = $4`, cmd.AdjustmentID, string(cmd.Outcome), cmd.Reference, version); err != nil {
			return fmt.Errorf("record refund result: %w", err)
		}
		var sequence int
		if err := tx.QueryRow(ctx, `SELECT max(sequence) + 1 FROM "PaymentAdjustmentTransition" WHERE "adjustmentId" = $1`,
			cmd.AdjustmentID).Scan(&sequence); err != nil {
			return fmt.Errorf("number refund transition: %w", err)
		}
		if err := adjustmentTransition(ctx, tx, cmd.AdjustmentID, sequence, &from, cmd.Outcome, cmd.DeviceID, payments.AdapterKind, cmd.Reference); err != nil {
			return err
		}
		if cmd.Outcome != payments.StatusSucceeded {
			return nil
		}
		_, err = revokeIfOwing(ctx, tx, p.checkID, c, cmd.AdjustmentID, cmd.DeviceID, payments.AdapterKind)
		return err
	})
	if err != nil {
		return refunds.Adjustment{}, false, err
	}
	a, err := s.Get(ctx, venueID, cmd.AdjustmentID)
	return a, changed, err
}
