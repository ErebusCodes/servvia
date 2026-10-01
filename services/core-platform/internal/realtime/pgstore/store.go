// Package pgstore delivers canonical domain events to the realtime hub
// (Phase D12, reading the D13 event log).
//
// The dispatcher is a broadcast reader, not a work consumer: every Core
// instance tails the DomainEvent log with its own in-memory cursor and
// serves its own subscribers. It stores no progress, so realtime can never
// share or disturb another consumer's (the kitchen projector's deliveries).
package pgstore

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"servvia/services/core-platform/internal/events"
	eventstore "servvia/services/core-platform/internal/events/pgstore"
)

// Publisher receives events in delivery order (realtime.Hub).
type Publisher interface{ Publish(events.Event) }

// Dispatcher tails the event log and hands each event to the publisher. One
// per process.
type Dispatcher struct {
	log       *eventstore.Log
	pub       Publisher
	logger    *slog.Logger
	interval  time.Duration
	retention time.Duration
	prune     bool
	cur       eventstore.Cursor
	started   bool
}

// NewDispatcher polls every interval. With prune, it also deletes events
// that are older than retention and no consumer still needs (only where the
// pool may write).
func NewDispatcher(log *eventstore.Log, pub Publisher, logger *slog.Logger, interval, retention time.Duration, prune bool) *Dispatcher {
	return &Dispatcher{log: log, pub: pub, logger: logger, interval: interval, retention: retention, prune: prune}
}

// Start fixes the delivery horizon: only events committed from now on are
// delivered.
func (d *Dispatcher) Start(ctx context.Context) error {
	c, err := d.log.Horizon(ctx)
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
		batch, next, err := d.log.Next(ctx, d.cur, 500)
		if err != nil {
			return total, err
		}
		for _, e := range batch {
			d.pub.Publish(e)
		}
		d.cur = next
		total += len(batch)
		if len(batch) < 500 {
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
				d.logger.Warn("event prune failed", "error", err)
			} else if n > 0 {
				d.logger.Info("domain events pruned", "count", n)
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
