// Package pgstore implements kitchen.Repository and the outbox projector on
// the Prisma-managed "KitchenTicket", "KitchenTicketLine",
// "KitchenTicketTransition" and "OutboxEvent" tables (migration
// 20261001000000_kitchen_tickets).
//
// Invariants rest on the database, not on reads before writes: one ticket per
// (roundId, station) and one ticket line per order line are unique indexes, a
// ticket's order is its round's order by composite foreign key, and a
// transition locks the ticket row and updates with the version in the
// predicate. Nothing here writes "Order": kitchen progress is not order state.
package pgstore

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"servvia/services/core-platform/internal/events"
	eventstore "servvia/services/core-platform/internal/events/pgstore"
	"servvia/services/core-platform/internal/kitchen"
)

type Store struct{ pool *pgxpool.Pool }

func New(pool *pgxpool.Pool) *Store { return &Store{pool: pool} }

var _ kitchen.Repository = (*Store)(nil)

// maxList bounds one listing: the newest tickets matching the filter, returned
// oldest first (the order a kitchen works in).
const maxList = 500

const ticketColumns = `id, "venueId", "orderId", "roundId", station, status::text, version, "sourceEventId",
       "roundSequence", "tableNumber", "takeawayReference", "orderSource"::text,
       "acknowledgedAt", "preparingAt", "readyAt", "completedAt", "recalledAt", "createdAt", "updatedAt"`

// stageColumn is the timestamp a status stamps when reached. Constant
// identifiers only; never built from input.
var stageColumn = map[kitchen.Status]string{
	kitchen.StatusAcknowledged: `"acknowledgedAt"`,
	kitchen.StatusPreparing:    `"preparingAt"`,
	kitchen.StatusReady:        `"readyAt"`,
	kitchen.StatusCompleted:    `"completedAt"`,
	kitchen.StatusRecalled:     `"recalledAt"`,
}

type querier interface {
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
}

func scanTicket(row pgx.CollectableRow) (kitchen.Ticket, error) {
	var t kitchen.Ticket
	var status string
	err := row.Scan(&t.ID, &t.VenueID, &t.OrderID, &t.RoundID, &t.Station, &status, &t.Version, &t.SourceEventID,
		&t.RoundSequence, &t.TableNumber, &t.TakeawayReference, &t.OrderSource,
		&t.AcknowledgedAt, &t.PreparingAt, &t.ReadyAt, &t.CompletedAt, &t.RecalledAt, &t.CreatedAt, &t.UpdatedAt)
	t.Status = kitchen.Status(status)
	return t, err
}

// withLines reads the tickets a query finds, then their lines in one query.
func withLines(ctx context.Context, q querier, sql string, args ...any) ([]kitchen.Ticket, error) {
	rows, err := q.Query(ctx, sql, args...)
	if err != nil {
		return nil, fmt.Errorf("query kitchen tickets: %w", err)
	}
	tickets, err := pgx.CollectRows(rows, scanTicket)
	if err != nil {
		return nil, fmt.Errorf("read kitchen tickets: %w", err)
	}
	if len(tickets) == 0 {
		return tickets, nil
	}
	ids := make([]string, len(tickets))
	index := make(map[string]int, len(tickets))
	for i, t := range tickets {
		ids[i], index[t.ID] = t.ID, i
	}
	rows, err = q.Query(ctx, `SELECT "ticketId", id, "orderItemId", position, title, quantity, modifiers, notes, seat
		FROM "KitchenTicketLine" WHERE "ticketId" = ANY($1) ORDER BY "ticketId", position`, ids)
	if err != nil {
		return nil, fmt.Errorf("query kitchen ticket lines: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var ticketID string
		var l kitchen.Line
		var mods []byte
		if err := rows.Scan(&ticketID, &l.ID, &l.OrderItemID, &l.Position, &l.Title, &l.Quantity, &mods, &l.Notes, &l.Seat); err != nil {
			return nil, fmt.Errorf("read kitchen ticket line: %w", err)
		}
		l.Modifiers = []kitchen.Modifier{}
		_ = json.Unmarshal(mods, &l.Modifiers)
		t := &tickets[index[ticketID]]
		t.Lines = append(t.Lines, l)
	}
	return tickets, rows.Err()
}

func one(ctx context.Context, q querier, sql string, args ...any) (kitchen.Ticket, error) {
	tickets, err := withLines(ctx, q, sql, args...)
	if err != nil {
		return kitchen.Ticket{}, err
	}
	if len(tickets) == 0 {
		return kitchen.Ticket{}, kitchen.ErrTicketNotFound
	}
	return tickets[0], nil
}

func (st *Store) List(ctx context.Context, venueID string, f kitchen.Filter) ([]kitchen.Ticket, error) {
	statuses := make([]string, len(f.Statuses))
	for i, s := range f.Statuses {
		statuses[i] = string(s)
	}
	return withLines(ctx, st.pool, `SELECT * FROM (
		SELECT `+ticketColumns+` FROM "KitchenTicket"
		WHERE "venueId" = $1 AND status::text = ANY($2) AND ($3 = '' OR station = $3)
		ORDER BY "createdAt" DESC, id DESC LIMIT $4) newest
		ORDER BY "createdAt", id`, venueID, statuses, f.Station, maxList)
}

func (st *Store) Get(ctx context.Context, venueID, ticketID string) (kitchen.Ticket, error) {
	return one(ctx, st.pool, `SELECT `+ticketColumns+` FROM "KitchenTicket" WHERE "venueId" = $1 AND id = $2`, venueID, ticketID)
}

func (st *Store) Transition(ctx context.Context, cmd kitchen.TransitionCommand) (kitchen.Ticket, bool, error) {
	var result kitchen.Ticket
	var changed bool
	err := pgx.BeginFunc(ctx, st.pool, func(tx pgx.Tx) error {
		before, err := one(ctx, tx, `SELECT `+ticketColumns+` FROM "KitchenTicket" WHERE "venueId" = $1 AND id = $2 FOR UPDATE`,
			cmd.VenueID, cmd.TicketID)
		if err != nil {
			return err
		}
		if changed, err = kitchen.Decide(before, cmd); err != nil || !changed {
			result = before
			return err
		}
		tag, err := tx.Exec(ctx, `UPDATE "KitchenTicket" SET status = $3::"KitchenTicketStatus", `+stageColumn[cmd.To]+` = now(),
			version = version + 1, "updatedAt" = now() WHERE id = $1 AND version = $2`,
			cmd.TicketID, cmd.ExpectedVersion, string(cmd.To))
		if err != nil {
			return fmt.Errorf("update kitchen ticket: %w", err)
		}
		if tag.RowsAffected() != 1 {
			// Unreachable while the row is locked; kept so a lost lock can
			// never turn into a silent overwrite.
			return &kitchen.VersionConflictError{Current: before.Version}
		}
		if _, err := tx.Exec(ctx, `INSERT INTO "KitchenTicketTransition"
			(id, "ticketId", "fromStatus", "toStatus", version, "actorId", "actorKind", "actorRole")
			VALUES ($1, $2, $3::"KitchenTicketStatus", $4::"KitchenTicketStatus", $5, $6, $7, $8::"StaffRole")`,
			newID(), cmd.TicketID, string(before.Status), string(cmd.To), before.Version+1,
			cmd.Actor.ID, cmd.Actor.Kind, cmd.Actor.Role); err != nil {
			return fmt.Errorf("record kitchen ticket transition: %w", err)
		}
		result, err = one(ctx, tx, `SELECT `+ticketColumns+` FROM "KitchenTicket" WHERE id = $1`, cmd.TicketID)
		if err != nil {
			return err
		}
		_, err = eventstore.Record(ctx, tx, cmd.VenueID, events.Fact{Type: "kitchen_ticket.transitioned",
			AggregateType: "kitchen_ticket", AggregateID: result.ID, Version: events.V(result.Version), Payload: map[string]any{
				"ticketId": result.ID, "orderId": result.OrderID, "station": result.Station, "from": before.Status, "to": result.Status}})
		return err
	})
	if err != nil {
		return kitchen.Ticket{}, false, err
	}
	return result, changed, nil
}

// newID is a random v4 UUID, the form of every Prisma @default(uuid()) id.
func newID() string {
	var b [16]byte
	_, _ = rand.Read(b[:])
	b[6], b[8] = b[6]&0x0f|0x40, b[8]&0x3f|0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}
