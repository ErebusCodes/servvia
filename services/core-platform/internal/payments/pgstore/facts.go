package pgstore

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"

	"servvia/services/core-platform/internal/events"
	eventstore "servvia/services/core-platform/internal/events/pgstore"
	"servvia/services/core-platform/internal/payments"
)

// Realtime facts of money (Phase D12), recorded in the transaction that
// made the change. Each reads back the row it announces, as written in this
// transaction, so every path (card, cash, adapter result, refund, reversal)
// announces through one rule. Payloads are operational only: identifiers,
// statuses, amounts and currency. Never a provider or result reference,
// card data, a device credential or a staff identity.

// paymentFact announces a payment's creation (from == nil) or a status change.
func paymentFact(ctx context.Context, tx pgx.Tx, paymentID string, from *payments.Status) error {
	var venueID, checkID, currency, tender, status string
	var amount int64
	var version int
	if err := tx.QueryRow(ctx, `SELECT "venueId", "checkId", currency, "tenderType"::text, status::text, "amountCents", version
		FROM "CheckPayment" WHERE id = $1`, paymentID).Scan(&venueID, &checkID, &currency, &tender, &status, &amount, &version); err != nil {
		return fmt.Errorf("read payment for its event: %w", err)
	}
	f := events.Fact{AggregateType: "payment", AggregateID: paymentID, Version: events.V(version),
		Payload: map[string]any{"paymentId": paymentID, "checkId": checkID, "status": status}}
	if from == nil {
		f.Type = "payment.created"
		f.Payload["tenderType"], f.Payload["amountCents"], f.Payload["currency"] = tender, amount, currency
	} else {
		f.Type = "payment.status_changed"
		f.Payload["from"] = *from
	}
	_, err := eventstore.Record(ctx, tx, venueID, f)
	return err
}

// adjustmentFact announces a return of money: a refund's creation or status
// change, or a reversal (final when recorded).
func adjustmentFact(ctx context.Context, tx pgx.Tx, adjustmentID string, from *payments.Status) error {
	var venueID, paymentID, checkID, kind, currency, status string
	var amount int64
	var version int
	if err := tx.QueryRow(ctx, `SELECT a."venueId", a."paymentId", p."checkId", a.kind::text, a.currency, a.status::text,
		a."amountCents", a.version FROM "PaymentAdjustment" a JOIN "CheckPayment" p ON p.id = a."paymentId" WHERE a.id = $1`,
		adjustmentID).Scan(&venueID, &paymentID, &checkID, &kind, &currency, &status, &amount, &version); err != nil {
		return fmt.Errorf("read adjustment for its event: %w", err)
	}
	payload := map[string]any{"paymentId": paymentID, "checkId": checkID, "status": status}
	var f events.Fact
	switch {
	case kind == "reversal" && from == nil:
		payload["reversalId"], payload["amountCents"], payload["currency"] = adjustmentID, amount, currency
		f = events.Fact{Type: "reversal.recorded", AggregateType: "reversal"}
	case kind == "reversal":
		return nil // unreachable: a reversal is final when recorded
	case from == nil:
		payload["refundId"], payload["amountCents"], payload["currency"] = adjustmentID, amount, currency
		f = events.Fact{Type: "refund.created", AggregateType: "refund"}
	default:
		payload["refundId"], payload["from"] = adjustmentID, *from
		f = events.Fact{Type: "refund.status_changed", AggregateType: "refund"}
	}
	f.AggregateID, f.Version, f.Payload = adjustmentID, events.V(version), payload
	_, err := eventstore.Record(ctx, tx, venueID, f)
	return err
}

// settlementFact announces that a check was settled or that its settlement
// was revoked (the check owes again), after the check row changed.
func settlementFact(ctx context.Context, tx pgx.Tx, checkID, eventType, settlementID string, cycle int) error {
	var venueID, status string
	var version int
	var sessionID *string
	if err := tx.QueryRow(ctx, `SELECT "venueId", status::text, version, "tableSessionId" FROM "Check" WHERE id = $1`, checkID).
		Scan(&venueID, &status, &version, &sessionID); err != nil {
		return fmt.Errorf("read check for its event: %w", err)
	}
	_, err := eventstore.Record(ctx, tx, venueID, events.Fact{Type: eventType, AggregateType: "check", AggregateID: checkID,
		Version: events.V(version), Payload: map[string]any{"checkId": checkID, "tableSessionId": sessionID, "status": status,
			"settlementId": settlementID, "cycle": cycle}})
	return err
}
