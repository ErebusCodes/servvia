package pgstore

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"servvia/services/core-platform/internal/kitchen"
	"servvia/services/core-platform/internal/realtime"
	realtimestore "servvia/services/core-platform/internal/realtime/pgstore"
)

// RoundSubmitted is the outbox event type the projector consumes (written by
// orders/pgstore in the round's transaction).
const RoundSubmitted = "order.round_submitted"

// Projector turns order.round_submitted outbox events into kitchen tickets.
//
// Each event is handled in one transaction: the event row is claimed with
// FOR UPDATE SKIP LOCKED (so concurrent workers take different events), its
// tickets and lines are written, and processedAt is stamped. A crash before
// commit leaves the event unprocessed for the next attempt. Should two
// projections of one round ever run (a manual Reproject, a lost lock), the
// unique indexes on (roundId, station) and orderItemId let the second write
// nothing.
//
// A failure is recorded on the event under the same lock: attempts, the
// error, and a backed-off availableAt. After MaxAttempts, or at once for an
// event that can never succeed, failedAt parks it for an operator.
type Projector struct {
	pool   *pgxpool.Pool
	router kitchen.Router
	logger *slog.Logger

	MaxAttempts int
	BaseBackoff time.Duration
	MaxBackoff  time.Duration
}

func NewProjector(pool *pgxpool.Pool, router kitchen.Router, logger *slog.Logger) *Projector {
	return &Projector{pool: pool, router: router, logger: logger,
		MaxAttempts: 10, BaseBackoff: time.Second, MaxBackoff: 5 * time.Minute}
}

// permanentError is an event that no retry can project.
type permanentError struct{ msg string }

func (e permanentError) Error() string { return e.msg }

func permanent(format string, args ...any) error { return permanentError{fmt.Sprintf(format, args...)} }

type roundSubmitted struct {
	OrderID string `json:"orderId"`
	RoundID string `json:"roundId"`
}

// Next claims and handles one due event. It reports false when none is due.
// A projection failure is recorded on the event and is not returned; the
// error is for failures to reach or update the database.
func (p *Projector) Next(ctx context.Context) (bool, error) {
	handled := false
	err := pgx.BeginFunc(ctx, p.pool, func(tx pgx.Tx) error {
		var id, venueID string
		var payload []byte
		var attempts int
		// availableAt is timestamp(3), so a default of now() is stored
		// rounded, up to half a millisecond later; compare at the same
		// precision so an event is never "not yet due" right after its write.
		err := tx.QueryRow(ctx, `SELECT id, "venueId", payload, attempts FROM "OutboxEvent"
			WHERE "eventType" = $1 AND "processedAt" IS NULL AND "failedAt" IS NULL AND "availableAt" <= LOCALTIMESTAMP(3)
			ORDER BY "availableAt", "createdAt", id LIMIT 1 FOR UPDATE SKIP LOCKED`, RoundSubmitted).
			Scan(&id, &venueID, &payload, &attempts)
		if errors.Is(err, pgx.ErrNoRows) {
			return nil
		}
		if err != nil {
			return fmt.Errorf("claim outbox event: %w", err)
		}
		handled = true

		// The projection runs in a savepoint, so a failure can be recorded
		// while the event is still locked by this transaction.
		projErr := pgx.BeginFunc(ctx, tx, func(sp pgx.Tx) error { return p.project(ctx, sp, id, venueID, payload) })
		if projErr == nil {
			_, err := tx.Exec(ctx, `UPDATE "OutboxEvent" SET "processedAt" = now() WHERE id = $1`, id)
			return err
		}
		if ctx.Err() != nil {
			return ctx.Err() // shutting down: leave the event as it was
		}
		return p.recordFailure(ctx, tx, id, attempts, projErr)
	})
	return handled, err
}

func (p *Projector) recordFailure(ctx context.Context, tx pgx.Tx, id string, attempts int, cause error) error {
	attempts++
	var perm permanentError
	park := errors.As(cause, &perm) || attempts >= p.MaxAttempts
	backoff := p.BaseBackoff << min(attempts-1, 30)
	if backoff <= 0 || backoff > p.MaxBackoff {
		backoff = p.MaxBackoff
	}
	msg := cause.Error()
	if len(msg) > 2000 {
		msg = msg[:2000]
	}
	_, err := tx.Exec(ctx, `UPDATE "OutboxEvent" SET attempts = $2, "lastError" = $3,
		"availableAt" = now() + make_interval(secs => $4), "failedAt" = CASE WHEN $5 THEN now() END WHERE id = $1`,
		id, attempts, msg, backoff.Seconds(), park)
	if err != nil {
		return fmt.Errorf("record outbox failure: %w", err)
	}
	if park {
		p.logger.ErrorContext(ctx, "kitchen projection parked", "event_id", id, "attempts", attempts, "error", cause)
	} else {
		p.logger.WarnContext(ctx, "kitchen projection failed; will retry", "event_id", id, "attempts", attempts,
			"retry_in", backoff.String(), "error", cause)
	}
	return nil
}

// Drain handles due events until none is left or max have been handled.
func (p *Projector) Drain(ctx context.Context, max int) (int, error) {
	n := 0
	for n < max {
		handled, err := p.Next(ctx)
		if err != nil || !handled {
			return n, err
		}
		n++
	}
	return n, nil
}

// Run drains due events every interval until ctx ends.
func (p *Projector) Run(ctx context.Context, interval time.Duration) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		if _, err := p.Drain(ctx, 100); err != nil && ctx.Err() == nil {
			p.logger.ErrorContext(ctx, "kitchen projector pass failed", "error", err)
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

// Reproject projects one event again, whatever its state, and changes nothing
// on the event. It is idempotent: existing tickets and lines are kept. For
// recovery of a parked event once its cause is fixed (then clear failedAt),
// and for tests of the database's idempotency guarantees.
func (p *Projector) Reproject(ctx context.Context, eventID string) error {
	return pgx.BeginFunc(ctx, p.pool, func(tx pgx.Tx) error {
		var venueID string
		var payload []byte
		if err := tx.QueryRow(ctx, `SELECT "venueId", payload FROM "OutboxEvent" WHERE id = $1 AND "eventType" = $2`,
			eventID, RoundSubmitted).Scan(&venueID, &payload); err != nil {
			return fmt.Errorf("load outbox event: %w", err)
		}
		return p.project(ctx, tx, eventID, venueID, payload)
	})
}

type roundLine struct {
	id, menuItemID, category, title string
	quantity                        int64
	modifiers                       []byte
	notes                           *string
	seat                            *int
}

// project writes the tickets and lines of one round, reading the canonical
// order rows (the payload only names the round).
func (p *Projector) project(ctx context.Context, tx pgx.Tx, eventID, venueID string, payload []byte) error {
	var ev roundSubmitted
	if err := json.Unmarshal(payload, &ev); err != nil || ev.OrderID == "" || ev.RoundID == "" {
		return permanent("payload does not name an order and a round")
	}
	var source string
	var sequence int
	var tableNumber, takeaway *string
	err := tx.QueryRow(ctx, `SELECT o.source::text, o."tableNumber", o."takeawayReference", r.sequence
		FROM "OrderRound" r JOIN "Order" o ON o.id = r."orderId"
		WHERE r.id = $1 AND r."orderId" = $2 AND o."venueId" = $3`, ev.RoundID, ev.OrderID, venueID).
		Scan(&source, &tableNumber, &takeaway, &sequence)
	if errors.Is(err, pgx.ErrNoRows) {
		return permanent("round %s of order %s does not exist at venue %s", ev.RoundID, ev.OrderID, venueID)
	}
	if err != nil {
		return fmt.Errorf("load round: %w", err)
	}

	// Lines in submission order (orders/pgstore mints ids that sort so).
	rows, err := tx.Query(ctx, `SELECT id, "menuItemId", "menuItemCategory", "menuItemTitle", quantity,
		"selectedModifiers", notes, seat FROM "OrderItem" WHERE "roundId" = $1 ORDER BY id`, ev.RoundID)
	if err != nil {
		return fmt.Errorf("load round lines: %w", err)
	}
	lines, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (roundLine, error) {
		var l roundLine
		return l, r.Scan(&l.id, &l.menuItemID, &l.category, &l.title, &l.quantity, &l.modifiers, &l.notes, &l.seat)
	})
	if err != nil {
		return fmt.Errorf("read round lines: %w", err)
	}

	// Route on the server, keeping submission order within each station.
	var stations []string
	byStation := map[string][]roundLine{}
	for _, l := range lines {
		station := p.router.Station(kitchen.RouteLine{MenuItemID: l.menuItemID, Category: l.category})
		if !kitchen.ValidStation(station) {
			return permanent("router chose an invalid station %q for line %s", station, l.id)
		}
		if _, seen := byStation[station]; !seen {
			stations = append(stations, station)
		}
		byStation[station] = append(byStation[station], l)
	}

	for _, station := range stations {
		var ticketID string
		err := tx.QueryRow(ctx, `INSERT INTO "KitchenTicket"
			(id, "venueId", "orderId", "roundId", station, "sourceEventId", "roundSequence", "tableNumber",
			 "takeawayReference", "orderSource", "updatedAt")
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::"OrderSource", now())
			ON CONFLICT ("roundId", station) DO NOTHING RETURNING id`,
			newID(), venueID, ev.OrderID, ev.RoundID, station, eventID, sequence, tableNumber, takeaway, source).Scan(&ticketID)
		if err == nil {
			// A new ticket (not a re-projection): announce it in the same
			// transaction (Phase D12). The kitchen stream gets what a screen
			// shows, never prices.
			if _, err := realtimestore.Record(ctx, tx, venueID, realtime.Fact{Type: "kitchen_ticket.created",
				AggregateType: "kitchen_ticket", AggregateID: ticketID, Version: realtime.V(1), Payload: map[string]any{
					"ticketId": ticketID, "orderId": ev.OrderID, "roundId": ev.RoundID, "roundSequence": sequence,
					"station": station, "status": kitchen.StatusNew, "tableNumber": tableNumber, "takeawayReference": takeaway}}); err != nil {
				return err
			}
		}
		if errors.Is(err, pgx.ErrNoRows) {
			// Already projected: add only what is missing to that ticket.
			err = tx.QueryRow(ctx, `SELECT id FROM "KitchenTicket" WHERE "roundId" = $1 AND station = $2`,
				ev.RoundID, station).Scan(&ticketID)
		}
		if err != nil {
			return fmt.Errorf("write kitchen ticket: %w", err)
		}
		for i, l := range byStation[station] {
			if _, err := tx.Exec(ctx, `INSERT INTO "KitchenTicketLine"
				(id, "ticketId", "orderItemId", position, title, quantity, modifiers, notes, seat)
				VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) ON CONFLICT ("orderItemId") DO NOTHING`,
				newID(), ticketID, l.id, i+1, l.title, l.quantity, kitchenModifiers(l.modifiers), l.notes, l.seat); err != nil {
				return fmt.Errorf("write kitchen ticket line: %w", err)
			}
		}
	}
	return nil
}

// kitchenModifiers reduces an order line's modifier snapshot to what the
// kitchen needs: group and option names, no prices.
func kitchenModifiers(raw []byte) []byte {
	var stored []struct {
		ModifierGroupName *string `json:"modifierGroupName"`
		OptionName        string  `json:"optionName"`
	}
	_ = json.Unmarshal(raw, &stored)
	out := make([]kitchen.Modifier, 0, len(stored))
	for _, m := range stored {
		var group string
		if m.ModifierGroupName != nil {
			group = *m.ModifierGroupName
		}
		out = append(out, kitchen.Modifier{GroupName: group, OptionName: m.OptionName})
	}
	b, _ := json.Marshal(out)
	return b
}
