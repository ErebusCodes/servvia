// Package pgstore records canonical domain events in the Prisma-managed
// "DomainEvent" table, with one "EventDelivery" per subscribed work
// consumer (migration 20261009000000_domain_events), and reads the event log
// in commit-safe order.
//
// Record runs INSIDE a domain transaction: the fact and its deliveries
// commit with the change or not at all. Asynchronous work happens after
// commit (internal/workers for work consumers, the realtime dispatcher for
// broadcast), so no consumer failure can undo a change and a crash between
// commit and processing loses nothing that was committed.
//
// The log carries no consumer progress. Log.Next reads it gap-free: a row
// is returned only once its writing transaction is older than the
// snapshot's xmin (every transaction that could still commit a lower
// position has finished), in (txId, sequence) order.
package pgstore

import (
	"context"
	"crypto/rand"
	"errors"
	"fmt"
	"math"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"servvia/services/core-platform/internal/events"
)

// ErrUnknownVenue: the fact names a venue that does not exist. It fails the
// caller's transaction; a fact is never silently dropped.
var ErrUnknownVenue = errors.New("events: unknown venue")

// Record writes fact f for venueID, and a pending delivery for every work
// consumer subscribed to its type, in the caller's transaction. It returns
// the event id. The organization is the venue's, read by the insert itself:
// never taken from a request.
func Record(ctx context.Context, tx pgx.Tx, venueID string, f events.Fact) (string, error) {
	payload, err := f.Encode()
	if err != nil {
		return "", fmt.Errorf("%w: %s", err, f.Type)
	}
	id := NewID()
	tag, err := tx.Exec(ctx, `INSERT INTO "DomainEvent"
		(id, "organizationId", "venueId", "eventType", "aggregateType", "aggregateId", "aggregateVersion", payload)
		SELECT $1, v."organizationId", v.id, $3, $4, $5, $6, $7 FROM "Venue" v WHERE v.id = $2`,
		id, venueID, f.Type, f.AggregateType, f.AggregateID, f.Version, payload)
	if err != nil {
		return "", fmt.Errorf("record event %s: %w", f.Type, err)
	}
	if tag.RowsAffected() != 1 {
		return "", ErrUnknownVenue
	}
	for _, c := range events.ConsumersOf(f.Type) {
		if _, err := tx.Exec(ctx, `INSERT INTO "EventDelivery" (id, "eventId", consumer) VALUES ($1, $2, $3)`,
			NewID(), id, string(c)); err != nil {
			return "", fmt.Errorf("record delivery %s for %s: %w", c, f.Type, err)
		}
	}
	return id, nil
}

// Cursor is a position in the log's (txId, sequence) order.
type Cursor struct{ tx, seq int64 }

// Log reads committed events in delivery order, for broadcast readers.
type Log struct{ pool *pgxpool.Pool }

func NewLog(pool *pgxpool.Pool) *Log { return &Log{pool: pool} }

// Horizon is the cursor from which a starting reader delivers: every
// transaction older than the current xmin has finished and counts as
// already seen (a broadcast subscriber connecting now refetches over HTTP
// anyway); transactions still running are read when they commit.
func (l *Log) Horizon(ctx context.Context) (Cursor, error) {
	var xmin int64
	err := l.pool.QueryRow(ctx, `SELECT pg_snapshot_xmin(pg_current_snapshot())::text::bigint`).Scan(&xmin)
	return Cursor{tx: xmin - 1, seq: math.MaxInt64}, err
}

// Next returns up to limit events after c that are safe to deliver, and the
// cursor after them.
func (l *Log) Next(ctx context.Context, c Cursor, limit int) ([]events.Event, Cursor, error) {
	rows, err := l.pool.Query(ctx, `SELECT id, "txId", sequence, "organizationId", "venueId", "eventType", "aggregateType",
		       "aggregateId", "aggregateVersion", payload, "occurredAt"
		FROM "DomainEvent"
		WHERE ("txId", sequence) > ($1, $2) AND "txId" < pg_snapshot_xmin(pg_current_snapshot())::text::bigint
		ORDER BY "txId", sequence LIMIT $3`, c.tx, c.seq, limit)
	if err != nil {
		return nil, c, fmt.Errorf("read domain events: %w", err)
	}
	defer rows.Close()
	var out []events.Event
	for rows.Next() {
		var e events.Event
		var tx, seq int64
		if err := rows.Scan(&e.ID, &tx, &seq, &e.OrganizationID, &e.VenueID, &e.Type, &e.AggregateType, &e.AggregateID,
			&e.Version, &e.Payload, &e.OccurredAt); err != nil {
			return nil, c, fmt.Errorf("scan domain event: %w", err)
		}
		out = append(out, e)
		c = Cursor{tx: tx, seq: seq}
	}
	return out, c, rows.Err()
}

// Get reads one event (a work consumer's input).
func Get(ctx context.Context, q interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}, id string) (events.Event, error) {
	var e events.Event
	err := q.QueryRow(ctx, `SELECT id, "organizationId", "venueId", "eventType", "aggregateType", "aggregateId",
		"aggregateVersion", payload, "occurredAt" FROM "DomainEvent" WHERE id = $1`, id).
		Scan(&e.ID, &e.OrganizationID, &e.VenueID, &e.Type, &e.AggregateType, &e.AggregateID, &e.Version, &e.Payload, &e.OccurredAt)
	return e, err
}

// Prune deletes events older than retention, at most batch at a time, that
// no consumer still needs: every delivery succeeded (or there were none).
// A pending or failed delivery keeps its event. The log is not canonical
// state; pruning loses no state.
func (l *Log) Prune(ctx context.Context, retention time.Duration, batch int) (int64, error) {
	tag, err := l.pool.Exec(ctx, `DELETE FROM "DomainEvent" WHERE id IN (
		SELECT e.id FROM "DomainEvent" e
		WHERE e."occurredAt" < now() - $1::interval
		  AND NOT EXISTS (SELECT 1 FROM "EventDelivery" d WHERE d."eventId" = e.id AND d.status <> 'succeeded')
		ORDER BY e."occurredAt" LIMIT $2)`,
		fmt.Sprintf("%d milliseconds", retention.Milliseconds()), batch)
	if err != nil {
		return 0, fmt.Errorf("prune domain events: %w", err)
	}
	return tag.RowsAffected(), nil
}

// NewID is a random (v4) UUID.
func NewID() string {
	var b [16]byte
	_, _ = rand.Read(b[:])
	b[6], b[8] = b[6]&0x0f|0x40, b[8]&0x3f|0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}
