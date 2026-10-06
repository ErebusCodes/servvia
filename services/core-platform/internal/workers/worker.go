// Package workers is Servvia Core's generic worker runtime (Phase D13): it
// processes one work consumer's EventDelivery rows at least once, safely
// across any number of processes.
//
// Claiming is PostgreSQL's, never process memory's:
//
//  1. Claim a batch: UPDATE ... WHERE id IN (SELECT ... FOR UPDATE SKIP
//     LOCKED LIMIT n) for pending, due rows whose lease is absent or
//     expired, setting this worker's lease and counting the attempt.
//     Concurrent workers take different rows; nobody waits.
//  2. Process each delivery in its own transaction: lock the row again and
//     VALIDATE THE LEASE (still pending, still this worker's, not expired).
//     A delivery taken over after an expired lease is abandoned, not run
//     twice. The consumer's handler runs in that transaction, and success
//     is recorded in it, so a handler that writes only to PostgreSQL has
//     exactly-once effects even though delivery is at least once.
//  3. On error the handler's writes roll back; the failure is recorded (only
//     while the lease is still ours) with bounded exponential backoff, or as
//     failed (a dead letter) after MaxAttempts or a Permanent error.
//
// A crashed worker's lease simply expires and the delivery becomes
// claimable again. Business behaviour lives in the handler (the consumer's
// package), never here. No ordering is promised.
package workers

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"servvia/services/core-platform/internal/events"
	eventstore "servvia/services/core-platform/internal/events/pgstore"
)

// Handler is a work consumer's behaviour. It runs inside the delivery's
// transaction: its writes commit together with the delivery's success, or
// not at all. It must be idempotent by event id (delivery is at least once).
type Handler interface {
	Handle(ctx context.Context, tx pgx.Tx, e events.Event) error
}

// HandlerFunc adapts a function to Handler.
type HandlerFunc func(ctx context.Context, tx pgx.Tx, e events.Event) error

func (f HandlerFunc) Handle(ctx context.Context, tx pgx.Tx, e events.Event) error {
	return f(ctx, tx, e)
}

// permanentError marks an error no retry can fix.
type permanentError struct{ err error }

func (p permanentError) Error() string { return p.err.Error() }
func (p permanentError) Unwrap() error { return p.err }

// Permanent wraps err so the delivery fails at once instead of retrying.
func Permanent(err error) error { return permanentError{err} }

// IsPermanent reports whether err (or anything it wraps) is permanent.
func IsPermanent(err error) bool {
	var p permanentError
	return errors.As(err, &p)
}

// Worker processes one consumer's deliveries.
type Worker struct {
	pool     *pgxpool.Pool
	consumer events.Consumer
	handler  Handler
	logger   *slog.Logger
	// ID is this worker's lease identity: unique per process and worker.
	ID string

	Batch       int
	Lease       time.Duration
	MaxAttempts int
	BaseBackoff time.Duration
	MaxBackoff  time.Duration
}

// New returns a worker with the D4-proven defaults: batches of 20, a
// 1-minute lease, 10 attempts, backoff 1 s doubling to 5 min.
func New(pool *pgxpool.Pool, consumer events.Consumer, handler Handler, logger *slog.Logger) *Worker {
	host, _ := os.Hostname()
	return &Worker{pool: pool, consumer: consumer, handler: handler, logger: logger,
		ID:    fmt.Sprintf("%s:%d:%s", host, os.Getpid(), eventstore.NewID()[:8]),
		Batch: 20, Lease: time.Minute, MaxAttempts: 10, BaseBackoff: time.Second, MaxBackoff: 5 * time.Minute}
}

// Backoff is the delay before attempt n+1 after n failed attempts:
// BaseBackoff doubled per attempt, capped at MaxBackoff.
func (w *Worker) Backoff(attempts int) time.Duration {
	d := w.BaseBackoff
	for i := 1; i < attempts && d < w.MaxBackoff; i++ {
		d *= 2
	}
	return min(d, w.MaxBackoff)
}

type claimed struct {
	id, eventID string
	attempts    int
}

// claim leases up to Batch due deliveries to this worker.
func (w *Worker) claim(ctx context.Context) ([]claimed, error) {
	rows, err := w.pool.Query(ctx, `UPDATE "EventDelivery" d
		SET "leaseOwner" = $2, "leaseExpiresAt" = now() + $3::interval, attempts = d.attempts + 1, "updatedAt" = now()
		WHERE d.id IN (
			SELECT id FROM "EventDelivery"
			-- timestamp(3) columns: a default of now() is stored rounded, up to
			-- half a millisecond later, so compare at the same precision (D4).
			WHERE consumer = $1 AND status = 'pending' AND "availableAt" <= LOCALTIMESTAMP(3)
			  AND ("leaseExpiresAt" IS NULL OR "leaseExpiresAt" < now())
			ORDER BY "availableAt", id
			LIMIT $4
			FOR UPDATE SKIP LOCKED)
		RETURNING d.id, d."eventId", d.attempts`,
		string(w.consumer), w.ID, fmt.Sprintf("%d milliseconds", w.Lease.Milliseconds()), w.Batch)
	if err != nil {
		return nil, fmt.Errorf("claim deliveries: %w", err)
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (claimed, error) {
		var c claimed
		return c, r.Scan(&c.id, &c.eventID, &c.attempts)
	})
}

// errLeaseLost: another worker took the delivery over after our lease
// expired, or it is no longer pending. Nothing is done.
var errLeaseLost = errors.New("workers: lease lost")

// process runs the handler for one claimed delivery.
func (w *Worker) process(ctx context.Context, c claimed) (bool, error) {
	var handled error
	err := pgx.BeginFunc(ctx, w.pool, func(tx pgx.Tx) error {
		var owner *string
		var status string
		var live bool
		if err := tx.QueryRow(ctx, `SELECT status::text, "leaseOwner", COALESCE("leaseExpiresAt" > now(), false)
			FROM "EventDelivery" WHERE id = $1 FOR UPDATE`, c.id).Scan(&status, &owner, &live); err != nil {
			return fmt.Errorf("lock delivery: %w", err)
		}
		if status != "pending" || owner == nil || *owner != w.ID || !live {
			return errLeaseLost
		}
		e, err := eventstore.Get(ctx, tx, c.eventID)
		if err != nil {
			return fmt.Errorf("load event: %w", err)
		}
		if handled = w.handler.Handle(ctx, tx, e); handled != nil {
			return handled
		}
		_, err = tx.Exec(ctx, `UPDATE "EventDelivery" SET status = 'succeeded', "succeededAt" = now(),
			"leaseOwner" = NULL, "leaseExpiresAt" = NULL, "lastError" = NULL, "updatedAt" = now() WHERE id = $1`, c.id)
		return err
	})
	switch {
	case err == nil:
		w.logger.Debug("event delivered", "eventId", c.eventID, "consumer", w.consumer, "attempt", c.attempts, "result", "succeeded")
		return true, nil
	case errors.Is(err, errLeaseLost):
		w.logger.Info("delivery abandoned: lease lost", "eventId", c.eventID, "consumer", w.consumer, "attempt", c.attempts)
		return false, nil
	case ctx.Err() != nil:
		// Shutting down mid-delivery: the handler's writes rolled back.
		// Give the delivery back at once rather than let the lease run out.
		w.release(c)
		return false, ctx.Err()
	case handled != nil:
		return false, w.fail(c, handled)
	default:
		return false, w.fail(c, err)
	}
}

// fail records a failed attempt, only while the lease is still ours.
func (w *Worker) fail(c claimed, cause error) error {
	failed := IsPermanent(cause) || c.attempts >= w.MaxAttempts
	msg := cause.Error()
	if len(msg) > 2000 {
		msg = msg[:2000]
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	var err error
	if failed {
		_, err = w.pool.Exec(ctx, `UPDATE "EventDelivery" SET status = 'failed', "failedAt" = now(), "lastError" = $3,
			"leaseOwner" = NULL, "leaseExpiresAt" = NULL, "updatedAt" = now()
			WHERE id = $1 AND "leaseOwner" = $2 AND status = 'pending'`, c.id, w.ID, msg)
	} else {
		_, err = w.pool.Exec(ctx, `UPDATE "EventDelivery" SET "availableAt" = now() + $4::interval, "lastError" = $3,
			"leaseOwner" = NULL, "leaseExpiresAt" = NULL, "updatedAt" = now()
			WHERE id = $1 AND "leaseOwner" = $2 AND status = 'pending'`,
			c.id, w.ID, msg, fmt.Sprintf("%d milliseconds", w.Backoff(c.attempts).Milliseconds()))
	}
	result := "retry"
	if failed {
		result = "failed"
	}
	w.logger.Warn("event delivery failed", "eventId", c.eventID, "consumer", w.consumer, "attempt", c.attempts,
		"result", result, "error", cause)
	return err
}

// release gives a claimed delivery back without counting a failure.
func (w *Worker) release(c claimed) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_, _ = w.pool.Exec(ctx, `UPDATE "EventDelivery" SET "leaseOwner" = NULL, "leaseExpiresAt" = NULL,
		attempts = GREATEST(attempts - 1, 0), "updatedAt" = now()
		WHERE id = $1 AND "leaseOwner" = $2 AND status = 'pending'`, c.id, w.ID)
}

// RunOnce claims one batch and processes it. It returns how many
// deliveries succeeded and how many were claimed.
func (w *Worker) RunOnce(ctx context.Context) (succeeded, claimedN int, err error) {
	batch, err := w.claim(ctx)
	if err != nil {
		return 0, 0, err
	}
	for i, c := range batch {
		ok, err := w.process(ctx, c)
		if ctx.Err() != nil {
			for _, rest := range batch[i+1:] {
				w.release(rest)
			}
			return succeeded, len(batch), ctx.Err()
		}
		if err != nil {
			w.logger.Warn("recording a delivery failure failed", "eventId", c.eventID, "consumer", w.consumer, "error", err)
		}
		if ok {
			succeeded++
		}
	}
	return succeeded, len(batch), nil
}

// Drain processes until nothing is due (for tests and tooling).
func (w *Worker) Drain(ctx context.Context, max int) (int, error) {
	total := 0
	for total < max {
		n, claimedN, err := w.RunOnce(ctx)
		total += n
		if err != nil || claimedN == 0 {
			return total, err
		}
	}
	return total, nil
}

// Run processes until ctx is cancelled, sleeping interval when idle. A
// cancelled context stops it after the current delivery (which rolls back
// and is released).
func (w *Worker) Run(ctx context.Context, interval time.Duration) {
	for {
		_, claimedN, err := w.RunOnce(ctx)
		if err != nil && ctx.Err() == nil {
			w.logger.Warn("worker batch failed", "consumer", w.consumer, "error", err)
		}
		if claimedN > 0 && err == nil {
			continue // more may be due
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(interval):
		}
	}
}

// --- inspection and recovery ---------------------------------------------------

// Backlog summarises one consumer's deliveries. It never carries payloads.
type Backlog struct {
	Consumer string `json:"consumer"`
	// Pending: due now and not leased.
	Pending int `json:"pending"`
	// Retrying: pending with a future availableAt (backing off).
	Retrying int `json:"retrying"`
	// Leased: claimed by a live worker.
	Leased int `json:"leased"`
	// Failed: dead letters waiting for an operator.
	Failed int `json:"failed"`
	// OldestPendingSeconds is the age of the oldest pending delivery.
	OldestPendingSeconds float64 `json:"oldestPendingSeconds"`
}

// Backlogs reports every registered consumer (including ones with nothing)
// for one organization: only deliveries of that organization's events are
// counted, across all of its venues. The caller supplies the organization
// from a verified principal, never from the request.
func Backlogs(ctx context.Context, pool *pgxpool.Pool, organizationID string) ([]Backlog, error) {
	if organizationID == "" {
		return nil, errors.New("workers: backlog needs an organization")
	}
	rows, err := pool.Query(ctx, `SELECT d.consumer,
		count(*) FILTER (WHERE d.status = 'pending' AND d."availableAt" <= LOCALTIMESTAMP(3) AND (d."leaseExpiresAt" IS NULL OR d."leaseExpiresAt" < now())),
		count(*) FILTER (WHERE d.status = 'pending' AND d."availableAt" > LOCALTIMESTAMP(3) AND d."leaseOwner" IS NULL),
		count(*) FILTER (WHERE d.status = 'pending' AND d."leaseExpiresAt" >= now()),
		count(*) FILTER (WHERE d.status = 'failed'),
		COALESCE(EXTRACT(EPOCH FROM now() - min(d."createdAt") FILTER (WHERE d.status = 'pending')), 0)::float8
		FROM "EventDelivery" d JOIN "DomainEvent" e ON e.id = d."eventId"
		WHERE e."organizationId" = $1
		GROUP BY d.consumer`, organizationID)
	if err != nil {
		return nil, fmt.Errorf("read backlog: %w", err)
	}
	found, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (Backlog, error) {
		var b Backlog
		return b, r.Scan(&b.Consumer, &b.Pending, &b.Retrying, &b.Leased, &b.Failed, &b.OldestPendingSeconds)
	})
	if err != nil {
		return nil, err
	}
	out := []Backlog{}
	seen := map[string]bool{}
	for _, b := range found {
		out, seen[b.Consumer] = append(out, b), true
	}
	for _, c := range events.Consumers() {
		if !seen[string(c)] {
			out = append(out, Backlog{Consumer: string(c)})
		}
	}
	return out, nil
}

// ErrNotFailed: Retry applies to failed deliveries only.
var ErrNotFailed = errors.New("workers: delivery is not failed")

// Retry returns a failed delivery (a dead letter) to pending, due now, with
// its attempts reset; lastError is kept for the record. There is
// deliberately no way to mark a delivery succeeded by hand.
//
// Retry is keyed by delivery id alone and has no HTTP route. Any future
// retry API must apply the same tenant boundary as Backlogs: resolve the
// delivery through its DomainEvent and refuse one outside the caller's
// organization.
func Retry(ctx context.Context, pool *pgxpool.Pool, deliveryID string) error {
	tag, err := pool.Exec(ctx, `UPDATE "EventDelivery" SET status = 'pending', "failedAt" = NULL, attempts = 0,
		"availableAt" = now(), "updatedAt" = now() WHERE id = $1 AND status = 'failed'`, deliveryID)
	if err != nil {
		return fmt.Errorf("retry delivery: %w", err)
	}
	if tag.RowsAffected() != 1 {
		return ErrNotFailed
	}
	return nil
}
