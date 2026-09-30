// Package pgstore records canonical realtime facts in the Prisma-managed
// "RealtimeEvent" table (migration 20261008000000_realtime_events) and tails
// it for delivery.
//
// Record runs INSIDE a domain transaction: the fact commits with the change
// or not at all. Delivery (Dispatcher) happens after commit, from the
// table, so a WebSocket failure can never roll a change back and a crash
// between commit and publish loses nothing that was committed.
//
// The table is a delivery log, not a queue. Nothing marks a row consumed;
// each process keeps its own in-memory cursor. Tailing is gap-free: a row
// is read only once its writing transaction is older than the snapshot's
// xmin (every transaction that could still commit a lower cursor position
// has finished), in (txId, sequence) order. D4's OutboxEvent and its
// kitchen-projector progress columns are not used here.
package pgstore

import (
	"context"
	"crypto/rand"
	"errors"
	"fmt"
	"log/slog"
	"math"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"servvia/services/core-platform/internal/realtime"
)

// ErrUnknownVenue: the fact names a venue that does not exist. It fails the
// caller's transaction; a fact is never silently dropped.
var ErrUnknownVenue = errors.New("realtime: unknown venue")

// Record writes fact f for venueID in the caller's transaction and returns
// the event id. The organization is the venue's, read by the insert itself:
// never taken from a request.
func Record(ctx context.Context, tx pgx.Tx, venueID string, f realtime.Fact) (string, error) {
	payload, err := f.Encode()
	if err != nil {
		return "", fmt.Errorf("%w: %s", err, f.Type)
	}
	id := NewID()
	tag, err := tx.Exec(ctx, `INSERT INTO "RealtimeEvent"
		(id, "organizationId", "venueId", "eventType", "aggregateType", "aggregateId", "aggregateVersion", payload)
		SELECT $1, v."organizationId", v.id, $3, $4, $5, $6, $7 FROM "Venue" v WHERE v.id = $2`,
		id, venueID, f.Type, f.AggregateType, f.AggregateID, f.Version, payload)
	if err != nil {
		return "", fmt.Errorf("record realtime event %s: %w", f.Type, err)
	}
	if tag.RowsAffected() != 1 {
		return "", ErrUnknownVenue
	}
	return id, nil
}

// cursor is a position in (txId, sequence) order.
type cursor struct{ tx, seq int64 }

// Log reads committed events in delivery order.
type Log struct{ pool *pgxpool.Pool }

func NewLog(pool *pgxpool.Pool) *Log { return &Log{pool: pool} }

// horizon is the cursor from which a starting process delivers: every
// transaction older than the current xmin has finished and is treated as
// already delivered (a subscriber connecting now refetches over HTTP
// anyway); transactions still running will be delivered when they commit.
func (l *Log) horizon(ctx context.Context) (cursor, error) {
	var xmin int64
	err := l.pool.QueryRow(ctx, `SELECT pg_snapshot_xmin(pg_current_snapshot())::text::bigint`).Scan(&xmin)
	return cursor{tx: xmin - 1, seq: math.MaxInt64}, err
}

// next returns up to limit events after c that are safe to deliver.
func (l *Log) next(ctx context.Context, c cursor, limit int) ([]realtime.Event, cursor, error) {
	rows, err := l.pool.Query(ctx, `SELECT id, "txId", sequence, "organizationId", "venueId", "eventType", "aggregateType",
		       "aggregateId", "aggregateVersion", payload, "occurredAt"
		FROM "RealtimeEvent"
		WHERE ("txId", sequence) > ($1, $2) AND "txId" < pg_snapshot_xmin(pg_current_snapshot())::text::bigint
		ORDER BY "txId", sequence LIMIT $3`, c.tx, c.seq, limit)
	if err != nil {
		return nil, c, fmt.Errorf("read realtime events: %w", err)
	}
	defer rows.Close()
	var out []realtime.Event
	for rows.Next() {
		var e realtime.Event
		var tx, seq int64
		if err := rows.Scan(&e.ID, &tx, &seq, &e.OrganizationID, &e.VenueID, &e.Type, &e.AggregateType, &e.AggregateID,
			&e.Version, &e.Payload, &e.OccurredAt); err != nil {
			return nil, c, fmt.Errorf("scan realtime event: %w", err)
		}
		out = append(out, e)
		c = cursor{tx: tx, seq: seq}
	}
	return out, c, rows.Err()
}

// Prune deletes events older than retention, at most batch at a time. The
// log is not canonical: pruning loses no state, only stale announcements.
func (l *Log) Prune(ctx context.Context, retention time.Duration, batch int) (int64, error) {
	tag, err := l.pool.Exec(ctx, `DELETE FROM "RealtimeEvent" WHERE id IN (
		SELECT id FROM "RealtimeEvent" WHERE "occurredAt" < now() - $1::interval ORDER BY "occurredAt" LIMIT $2)`,
		fmt.Sprintf("%d milliseconds", retention.Milliseconds()), batch)
	if err != nil {
		return 0, fmt.Errorf("prune realtime events: %w", err)
	}
	return tag.RowsAffected(), nil
}

// Publisher receives events in delivery order (realtime.Hub).
type Publisher interface{ Publish(realtime.Event) }

// Dispatcher tails the log and hands each event to the publisher. One per
// process; every instance runs its own and serves its own subscribers.
type Dispatcher struct {
	log       *Log
	pub       Publisher
	logger    *slog.Logger
	interval  time.Duration
	retention time.Duration
	prune     bool
	cur       cursor
	started   bool
}

// NewDispatcher polls every interval. With prune, it also deletes events
// older than retention (only where the pool may write).
func NewDispatcher(log *Log, pub Publisher, logger *slog.Logger, interval, retention time.Duration, prune bool) *Dispatcher {
	return &Dispatcher{log: log, pub: pub, logger: logger, interval: interval, retention: retention, prune: prune}
}

// Start fixes the delivery horizon: only events committed from now on are
// delivered.
func (d *Dispatcher) Start(ctx context.Context) error {
	c, err := d.log.horizon(ctx)
	if err != nil {
		return fmt.Errorf("realtime horizon: %w", err)
	}
	d.cur, d.started = c, true
	return nil
}

// Poll delivers every event that is safe to deliver now and returns how
// many it delivered.
func (d *Dispatcher) Poll(ctx context.Context) (int, error) {
	if !d.started {
		if err := d.Start(ctx); err != nil {
			return 0, err
		}
	}
	total := 0
	for {
		events, next, err := d.log.next(ctx, d.cur, 500)
		if err != nil {
			return total, err
		}
		for _, e := range events {
			d.pub.Publish(e)
		}
		d.cur = next
		total += len(events)
		if len(events) < 500 {
			return total, nil
		}
	}
}

// Run polls until ctx is cancelled. A failed poll is logged and retried on
// the next tick; it never affects canonical writes.
func (d *Dispatcher) Run(ctx context.Context) {
	ticker := time.NewTicker(d.interval)
	defer ticker.Stop()
	lastPrune := time.Time{}
	for {
		if _, err := d.Poll(ctx); err != nil && ctx.Err() == nil {
			d.logger.Warn("realtime dispatch failed", "error", err)
		}
		if d.prune && time.Since(lastPrune) > 10*time.Minute {
			if n, err := d.log.Prune(ctx, d.retention, 5000); err != nil && ctx.Err() == nil {
				d.logger.Warn("realtime prune failed", "error", err)
			} else if n > 0 {
				d.logger.Info("realtime events pruned", "count", n)
			}
			lastPrune = time.Now()
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

// NewID is a random (v4) UUID: the envelope's eventId.
func NewID() string {
	var b [16]byte
	_, _ = rand.Read(b[:])
	b[6], b[8] = b[6]&0x0f|0x40, b[8]&0x3f|0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}
