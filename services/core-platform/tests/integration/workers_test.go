package integration

// Generic domain events and workers (Phase D13) against real PostgreSQL:
// events commit with their change, per-consumer progress, exclusive claims,
// SKIP LOCKED, leases (expiry, no early theft, lost-lease abandonment),
// bounded backoff and dead letters, shutdown release, recovery, backlog and
// pruning. Numbers refer to the D13 required tests.

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/jackc/pgx/v5"

	"servvia/services/core-platform/internal/events"
	eventstore "servvia/services/core-platform/internal/events/pgstore"
	"servvia/services/core-platform/internal/health"
	"servvia/services/core-platform/internal/identity"
	"servvia/services/core-platform/internal/menu"
	"servvia/services/core-platform/internal/orders"
	"servvia/services/core-platform/internal/ratelimit"
	"servvia/services/core-platform/internal/server"
	"servvia/services/core-platform/internal/venues"
	"servvia/services/core-platform/internal/workers"
	"servvia/services/core-platform/internal/workers/workersapi"
	"servvia/services/core-platform/tests/testsupport"
)

var quiet = slog.New(slog.NewTextHandler(io.Discard, nil))

// fact records one canonical fact at the fixture venue in its own
// transaction and returns the event id.
func (h kitchenHarness) fact(t *testing.T, typ, aggregate string) string {
	t.Helper()
	var id string
	err := pgx.BeginFunc(context.Background(), h.writer, func(tx pgx.Tx) error {
		var err error
		agg := testsupport.UUID()
		id, err = eventstore.Record(context.Background(), tx, h.f.Venue, events.Fact{Type: typ, AggregateType: aggregate,
			AggregateID: agg, Version: events.V(1), Payload: map[string]any{"shiftId": agg, "status": "open"}})
		return err
	})
	if err != nil {
		t.Fatal(err)
	}
	return id
}

// deliverTo adds a pending delivery of an event for a test consumer, as the
// registry's fan-out would for a subscribed consumer.
func (h kitchenHarness) deliverTo(t *testing.T, eventID string, consumer events.Consumer) string {
	t.Helper()
	id := testsupport.UUID()
	if _, err := h.writer.Exec(context.Background(), `INSERT INTO "EventDelivery" (id, "eventId", consumer) VALUES ($1, $2, $3)`,
		id, eventID, string(consumer)); err != nil {
		t.Fatal(err)
	}
	return id
}

type deliveryRow struct {
	Status   string
	Attempts int
	Owner    *string
	Error    *string
	DueIn    float64 // seconds until availableAt
}

func (h kitchenHarness) row(t *testing.T, id string) deliveryRow {
	t.Helper()
	var r deliveryRow
	if err := h.writer.QueryRow(context.Background(), `SELECT status::text, attempts, "leaseOwner", "lastError",
		EXTRACT(EPOCH FROM "availableAt" - LOCALTIMESTAMP)::float8 FROM "EventDelivery" WHERE id = $1`, id).
		Scan(&r.Status, &r.Attempts, &r.Owner, &r.Error, &r.DueIn); err != nil {
		t.Fatal(err)
	}
	return r
}

func (h kitchenHarness) newWorker(consumer events.Consumer, handler workers.HandlerFunc) *workers.Worker {
	w := workers.New(h.kpool, consumer, handler, quiet)
	w.BaseBackoff, w.MaxBackoff = time.Millisecond, 5*time.Millisecond
	return w
}

// 1, 2, 21, 22: a change and its fact commit together; a rollback leaves
// neither; scope is server-derived; payloads carry no secrets.
func TestDomainEventsCommitWithTheirChange(t *testing.T) {
	h := kitchenSetup(t)
	ctx := context.Background()
	o, _, err := h.orders.Create(ctx, h.dineIn(h.openSession(t, h.f.TableA).ID, line(h.f.Plain, 1)))
	if err != nil {
		t.Fatal(err)
	}
	if n := h.count(t, `SELECT count(*) FROM "DomainEvent" WHERE "aggregateId" = $1 AND "venueId" = $2 AND "organizationId" = $3`,
		o.ID, h.f.Venue, h.f.Org); n != 2 {
		t.Errorf("order facts with derived scope: %d", n)
	}
	// Rolled back with its change: a canonical write that fails after its
	// fact was recorded (a closed visit refuses the order) leaves nothing.
	s := h.openSession(t, h.f.TableB)
	h.endVisit(t, s.ID)
	before := h.count(t, `SELECT count(*) FROM "DomainEvent" WHERE "venueId" = $1`, h.f.Venue)
	if _, _, err := h.orders.Create(ctx, h.dineIn(s.ID, line(h.f.Plain, 1))); err == nil {
		t.Fatal("an order on a closed visit")
	}
	tx, _ := h.writer.Begin(ctx)
	if _, err := eventstore.Record(ctx, tx, h.f.Venue, events.Fact{Type: "shift.opened", AggregateType: "shift", AggregateID: "rolled-back"}); err != nil {
		t.Fatal(err)
	}
	_ = tx.Rollback(ctx)
	if after := h.count(t, `SELECT count(*) FROM "DomainEvent" WHERE "venueId" = $1`, h.f.Venue); after != before {
		t.Errorf("a rolled-back change left %d facts", after-before)
	}
	if n := h.count(t, `SELECT count(*) FROM "EventDelivery" d JOIN "DomainEvent" e ON e.id = d."eventId" WHERE e."aggregateId" = 'rolled-back'`); n != 0 {
		t.Error("a rolled-back delivery exists")
	}
	// 22: no event payload of the venue carries a secret-like field.
	rows, _ := h.writer.Query(ctx, `SELECT payload::text FROM "DomainEvent" WHERE "venueId" = $1`, h.f.Venue)
	payloads, _ := pgx.CollectRows(rows, pgx.RowTo[string])
	forbidden := map[string]bool{"reference": true, "resultReference": true, "providerReference": true, "credential": true,
		"secret": true, "token": true, "password": true, "passwordHash": true, "cardNumber": true, "pan": true}
	for _, p := range payloads {
		var keys map[string]any
		_ = json.Unmarshal([]byte(p), &keys)
		for k := range keys {
			if forbidden[k] || strings.Contains(strings.ToLower(k), "secret") || strings.Contains(strings.ToLower(k), "credential") {
				t.Errorf("payload carries %q: %s", k, p)
			}
		}
	}
}

// 3, 4, 18: one event, two independent consumers; one's outcome never
// touches the other's; realtime has no delivery at all.
func TestConsumersAreIndependent(t *testing.T) {
	h := kitchenSetup(t)
	ctx := context.Background()
	o, _, err := h.orders.Create(ctx, h.dineIn(h.openSession(t, h.f.TableA).ID, line(h.f.Plain, 1)))
	if err != nil {
		t.Fatal(err)
	}
	ev := h.event(t, o.ID, 1)
	kitchenDelivery := h.delivery(t, ev)
	other := h.deliverTo(t, ev, "audit_mirror")

	h.drain(t) // the kitchen projector only
	if r := h.row(t, kitchenDelivery); r.Status != "succeeded" || r.Attempts != 1 {
		t.Errorf("kitchen delivery %+v", r)
	}
	if r := h.row(t, other); r.Status != "pending" || r.Attempts != 0 || r.Owner != nil {
		t.Errorf("the kitchen's success touched another consumer: %+v", r)
	}
	// The other consumer fails; the kitchen's outcome stands.
	failing := h.newWorker("audit_mirror", func(context.Context, pgx.Tx, events.Event) error { return errors.New("mirror down") })
	if _, _, err := failing.RunOnce(ctx); err != nil {
		t.Fatal(err)
	}
	if r := h.row(t, other); r.Status != "pending" || r.Attempts != 1 || r.Error == nil {
		t.Errorf("other consumer after failure %+v", r)
	}
	if r := h.row(t, kitchenDelivery); r.Status != "succeeded" || r.Attempts != 1 {
		t.Errorf("another consumer's failure touched the kitchen: %+v", r)
	}
	if n := h.count(t, `SELECT count(*) FROM "KitchenTicket" WHERE "orderId" = $1`, o.ID); n != 1 {
		t.Errorf("tickets %d", n)
	}
	if n := h.count(t, `SELECT count(*) FROM "EventDelivery" WHERE "eventId" = $1`, ev); n != 2 {
		t.Errorf("deliveries of the event: %d (realtime has none)", n)
	}
}

// 5, 9 and the 32-worker race: one delivery, thirty-two workers, one execution.
func TestClaimsAreExclusive(t *testing.T) {
	h := kitchenSetup(t)
	ctx := context.Background()
	d := h.deliverTo(t, h.fact(t, "shift.opened", "shift"), "race_consumer")
	var runs atomic.Int32
	handler := workers.HandlerFunc(func(context.Context, pgx.Tx, events.Event) error {
		runs.Add(1)
		time.Sleep(50 * time.Millisecond)
		return nil
	})
	race(32, func(int) {
		_, _, _ = h.newWorker("race_consumer", handler).RunOnce(ctx)
	})
	if r := h.row(t, d); runs.Load() != 1 || r.Status != "succeeded" || r.Attempts != 1 || r.Owner != nil {
		t.Errorf("%d executions, delivery %+v", runs.Load(), r)
	}
	// Many events across consumers: each delivery runs exactly once.
	var ids []string
	for i := 0; i < 20; i++ {
		ev := h.fact(t, "shift.opened", "shift")
		ids = append(ids, h.deliverTo(t, ev, "many_a"), h.deliverTo(t, ev, "many_b"))
	}
	counts := sync.Map{}
	count := workers.HandlerFunc(func(_ context.Context, _ pgx.Tx, e events.Event) error {
		v, _ := counts.LoadOrStore(e.ID, new(atomic.Int32))
		v.(*atomic.Int32).Add(1)
		return nil
	})
	race(16, func(i int) {
		c := events.Consumer("many_a")
		if i%2 == 1 {
			c = "many_b"
		}
		_, _ = h.newWorker(c, count).Drain(ctx, 1000)
	})
	for _, id := range ids {
		if r := h.row(t, id); r.Status != "succeeded" || r.Attempts != 1 {
			t.Errorf("delivery %s %+v", id, r)
		}
	}
	counts.Range(func(k, v any) bool {
		if n := v.(*atomic.Int32).Load(); n != 2 {
			t.Errorf("event %v handled %d times, want once per consumer", k, n)
		}
		return true
	})
}

// 6: a delivery locked by another transaction is skipped, not waited for.
func TestSkipLockedLetsLaterWorkProceed(t *testing.T) {
	h := kitchenSetup(t)
	ctx := context.Background()
	locked := h.deliverTo(t, h.fact(t, "shift.opened", "shift"), "skip_consumer")
	free := h.deliverTo(t, h.fact(t, "shift.opened", "shift"), "skip_consumer")
	tx, err := h.writer.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `SELECT 1 FROM "EventDelivery" WHERE id = $1 FOR UPDATE`, locked); err != nil {
		t.Fatal(err)
	}
	start := time.Now()
	w := h.newWorker("skip_consumer", func(context.Context, pgx.Tx, events.Event) error { return nil })
	if n, claimed, err := w.RunOnce(ctx); err != nil || n != 1 || claimed != 1 {
		t.Fatalf("processed %d of %d: %v", n, claimed, err)
	}
	if time.Since(start) > 2*time.Second || h.row(t, free).Status != "succeeded" || h.row(t, locked).Status != "pending" {
		t.Error("the free delivery waited or the locked one was taken")
	}
}

// 7, 8 and the lease-expiry race: a live lease is never stolen; an expired
// one (a crashed worker) is claimed again, by exactly one worker.
func TestLeases(t *testing.T) {
	h := kitchenSetup(t)
	ctx := context.Background()
	d := h.deliverTo(t, h.fact(t, "shift.opened", "shift"), "lease_consumer")
	if _, err := h.writer.Exec(ctx, `UPDATE "EventDelivery" SET "leaseOwner" = 'crashed-worker', attempts = 1,
		"leaseExpiresAt" = LOCALTIMESTAMP + interval '1 hour' WHERE id = $1`, d); err != nil {
		t.Fatal(err)
	}
	var runs atomic.Int32
	handler := workers.HandlerFunc(func(context.Context, pgx.Tx, events.Event) error { runs.Add(1); return nil })
	if _, claimed, _ := h.newWorker("lease_consumer", handler).RunOnce(ctx); claimed != 0 || runs.Load() != 0 {
		t.Fatal("a live lease was stolen")
	}
	if _, err := h.writer.Exec(ctx, `UPDATE "EventDelivery" SET "leaseExpiresAt" = LOCALTIMESTAMP - interval '1 second' WHERE id = $1`, d); err != nil {
		t.Fatal(err)
	}
	race(8, func(int) { _, _, _ = h.newWorker("lease_consumer", handler).RunOnce(ctx) })
	if r := h.row(t, d); runs.Load() != 1 || r.Status != "succeeded" || r.Attempts != 2 {
		t.Errorf("after the lease expired: %d runs, %+v", runs.Load(), r)
	}
}

// A worker whose lease ran out while it was busy does not run a delivery
// another worker has since taken over (lease validation at processing).
// Deterministic: worker A claims two deliveries and is held inside the first
// handler call; meanwhile the other delivery's lease expires and worker B
// claims it and is still working on it. A then continues and must abandon
// it: running it would execute the handler twice concurrently.
func TestLostLeaseIsAbandoned(t *testing.T) {
	h := kitchenSetup(t)
	ctx := context.Background()
	d1 := h.deliverTo(t, h.fact(t, "shift.opened", "shift"), "slow_consumer")
	d2 := h.deliverTo(t, h.fact(t, "shift.opened", "shift"), "slow_consumer")
	var mu sync.Mutex
	runs := map[string]int{}
	held := make(chan string, 1)
	release := make(chan struct{})
	var holding atomic.Bool
	handler := workers.HandlerFunc(func(_ context.Context, _ pgx.Tx, e events.Event) error {
		mu.Lock()
		runs[e.ID]++
		mu.Unlock()
		if holding.CompareAndSwap(false, true) { // A's first call
			held <- e.ID
			<-release
		}
		return nil
	})
	a := h.newWorker("slow_consumer", handler)
	a.Batch = 2
	type result struct{ succeeded, claimed int }
	done := make(chan result, 1)
	go func() {
		s, c, err := a.RunOnce(ctx)
		if err != nil {
			t.Error(err)
		}
		done <- result{s, c}
	}()
	heldEvent := <-held
	var other, otherEvent string
	if err := h.writer.QueryRow(ctx, `SELECT id, "eventId" FROM "EventDelivery" WHERE id = ANY($1) AND "eventId" <> $2`,
		[]string{d1, d2}, heldEvent).Scan(&other, &otherEvent); err != nil {
		t.Fatal(err)
	}
	if r := h.row(t, other); r.Owner == nil || *r.Owner != a.ID {
		t.Fatalf("A does not hold the other delivery: %+v", r)
	}
	// A's lease runs out; B (represented by its lease) claims the delivery
	// and is mid-way through it.
	if _, err := h.writer.Exec(ctx, `UPDATE "EventDelivery" SET "leaseOwner" = 'worker-b',
		"leaseExpiresAt" = LOCALTIMESTAMP + interval '1 hour', attempts = attempts + 1 WHERE id = $1`, other); err != nil {
		t.Fatal(err)
	}
	close(release)
	res := <-done
	if res.claimed != 2 || res.succeeded != 1 {
		t.Errorf("A: %+v", res)
	}
	if runs[otherEvent] != 0 || runs[heldEvent] != 1 {
		t.Errorf("A ran a delivery it no longer owns: %v", runs)
	}
	if r := h.row(t, other); r.Status != "pending" || r.Owner == nil || *r.Owner != "worker-b" || r.Error != nil {
		t.Errorf("B's delivery disturbed: %+v", r)
	}
	if r := h.row(t, map[bool]string{true: d1, false: d2}[other == d2]); r.Status != "succeeded" {
		t.Errorf("A's own delivery: %+v", r)
	}
}

// 10-14: failures back off exponentially up to the cap, a permanent error or
// the attempt limit fails the delivery (a dead letter), and a failure never
// blocks the next delivery.
func TestRetryBackoffAndDeadLetters(t *testing.T) {
	h := kitchenSetup(t)
	ctx := context.Background()
	d := h.deliverTo(t, h.fact(t, "shift.opened", "shift"), "flaky_consumer")
	w := h.newWorker("flaky_consumer", func(context.Context, pgx.Tx, events.Event) error { return errors.New("downstream unavailable") })
	w.BaseBackoff, w.MaxBackoff, w.MaxAttempts = 10*time.Second, 40*time.Second, 5
	for i, want := range []float64{10, 20, 40, 40} { // capped at 40
		if _, _, err := w.RunOnce(ctx); err != nil {
			t.Fatal(err)
		}
		r := h.row(t, d)
		if r.Status != "pending" || r.Attempts != i+1 || r.DueIn < want-2 || r.DueIn > want+1 || r.Owner != nil ||
			!strings.Contains(*r.Error, "downstream unavailable") {
			t.Fatalf("attempt %d: %+v (want due in %.0fs)", i+1, r, want)
		}
		if _, err := h.writer.Exec(ctx, `UPDATE "EventDelivery" SET "availableAt" = LOCALTIMESTAMP WHERE id = $1`, d); err != nil {
			t.Fatal(err)
		}
	}
	if _, _, err := w.RunOnce(ctx); err != nil {
		t.Fatal(err)
	}
	if r := h.row(t, d); r.Status != "failed" || r.Attempts != 5 {
		t.Fatalf("after the limit: %+v", r)
	}
	if _, claimed, _ := w.RunOnce(ctx); claimed != 0 {
		t.Error("a dead letter was claimed")
	}
	if got := w.Backoff(1); got != 10*time.Second || w.Backoff(3) != 40*time.Second || w.Backoff(30) != 40*time.Second {
		t.Errorf("backoff %s", got)
	}

	// A permanent error fails at once, and the delivery behind it proceeds.
	bad := h.deliverTo(t, h.fact(t, "shift.opened", "shift"), "picky_consumer")
	time.Sleep(5 * time.Millisecond)
	good := h.deliverTo(t, h.fact(t, "shift.opened", "shift"), "picky_consumer")
	var badEvent string
	_ = h.writer.QueryRow(ctx, `SELECT "eventId" FROM "EventDelivery" WHERE id = $1`, bad).Scan(&badEvent)
	picky := h.newWorker("picky_consumer", func(_ context.Context, _ pgx.Tx, e events.Event) error {
		if e.ID == badEvent {
			return workers.Permanent(errors.New("cannot ever handle this"))
		}
		return nil
	})
	if _, err := picky.Drain(ctx, 10); err != nil {
		t.Fatal(err)
	}
	if r := h.row(t, bad); r.Status != "failed" || r.Attempts != 1 {
		t.Errorf("permanent: %+v", r)
	}
	if r := h.row(t, good); r.Status != "succeeded" {
		t.Errorf("the next delivery was blocked: %+v", r)
	}
	// Recovery is explicit, and only for dead letters.
	if err := workers.Retry(ctx, h.kpool, bad); err != nil {
		t.Fatal(err)
	}
	if r := h.row(t, bad); r.Status != "pending" || r.Attempts != 0 || r.Error == nil {
		t.Errorf("retried: %+v", r)
	}
	if err := workers.Retry(ctx, h.kpool, good); !errors.Is(err, workers.ErrNotFailed) {
		t.Errorf("retry of a success: %v", err)
	}
}

// 20 and cancellation: a worker stopped mid-delivery rolls the handler's
// writes back and releases the delivery at once (no lease to wait out, no
// attempt counted).
func TestShutdownReleasesTheDelivery(t *testing.T) {
	h := kitchenSetup(t)
	d := h.deliverTo(t, h.fact(t, "shift.opened", "shift"), "stop_consumer")
	started := make(chan struct{})
	w := h.newWorker("stop_consumer", func(ctx context.Context, tx pgx.Tx, _ events.Event) error {
		if _, err := tx.Exec(ctx, `UPDATE "Venue" SET "updatedAt" = now() WHERE id = $1`, h.f.Venue); err != nil {
			return err
		}
		close(started)
		<-ctx.Done()
		return ctx.Err()
	})
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() { defer close(done); w.Run(ctx, 10*time.Millisecond) }()
	<-started
	cancel()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("the worker did not stop")
	}
	if r := h.row(t, d); r.Status != "pending" || r.Owner != nil || r.Attempts != 0 {
		t.Errorf("after shutdown: %+v", r)
	}
	ok := h.newWorker("stop_consumer", func(context.Context, pgx.Tx, events.Event) error { return nil })
	if n, _, err := ok.RunOnce(context.Background()); err != nil || n != 1 {
		t.Errorf("redelivery after restart: %d %v", n, err)
	}
}

// Observability and retention: the backlog counts per consumer (no
// payloads), and pruning keeps any event a consumer still needs.
func TestBacklogAndPruning(t *testing.T) {
	h := kitchenSetup(t)
	ctx := context.Background()
	for _, state := range []string{
		`status = 'pending'`,
		`status = 'pending', "availableAt" = LOCALTIMESTAMP + interval '1 hour'`,
		`status = 'pending', "leaseOwner" = 'w', "leaseExpiresAt" = LOCALTIMESTAMP + interval '1 hour'`,
		`status = 'failed', "failedAt" = now()`,
	} {
		d := h.deliverTo(t, h.fact(t, "shift.opened", "shift"), "backlog_consumer")
		if _, err := h.writer.Exec(ctx, `UPDATE "EventDelivery" SET `+state+`, "createdAt" = LOCALTIMESTAMP - interval '1 minute' WHERE id = $1`, d); err != nil {
			t.Fatal(err)
		}
	}
	all, err := workers.Backlogs(ctx, h.kpool, h.f.Org)
	if err != nil {
		t.Fatal(err)
	}
	var b *workers.Backlog
	sawKitchen := false
	for i := range all {
		sawKitchen = sawKitchen || all[i].Consumer == string(events.KitchenProjector)
		if all[i].Consumer == "backlog_consumer" {
			b = &all[i]
		}
	}
	if b == nil || b.Pending != 1 || b.Retrying != 1 || b.Leased != 1 || b.Failed != 1 || b.OldestPendingSeconds < 55 || !sawKitchen {
		t.Errorf("backlog %+v (kitchen listed %v)", b, sawKitchen)
	}

	log := eventstore.NewLog(h.kpool)
	old := func(consumerStatus string) string {
		e := h.fact(t, "shift.opened", "shift")
		if consumerStatus != "" {
			d := h.deliverTo(t, e, "prune_consumer")
			if _, err := h.writer.Exec(ctx, `UPDATE "EventDelivery" SET status = $2::"EventDeliveryStatus",
				"succeededAt" = CASE WHEN $2 = 'succeeded' THEN now() END, "failedAt" = CASE WHEN $2 = 'failed' THEN now() END WHERE id = $1`,
				d, consumerStatus); err != nil {
				t.Fatal(err)
			}
		}
		if _, err := h.writer.Exec(ctx, `UPDATE "DomainEvent" SET "occurredAt" = now() - interval '8 days' WHERE id = $1`, e); err != nil {
			t.Fatal(err)
		}
		return e
	}
	done, none, failed, pending := old("succeeded"), old(""), old("failed"), old("pending")
	fresh := h.fact(t, "shift.opened", "shift")
	if _, err := log.Prune(ctx, 7*24*time.Hour, 1000); err != nil {
		t.Fatal(err)
	}
	for id, want := range map[string]int{done: 0, none: 0, failed: 1, pending: 1, fresh: 1} {
		if n := h.count(t, `SELECT count(*) FROM "DomainEvent" WHERE id = $1`, id); n != want {
			t.Errorf("event %s: %d after prune, want %d", id, n, want)
		}
	}
}

// The backlog endpoint: owners/admins from a staff session only, scoped to
// the token's organization (across all of its venues); counts only, never
// payloads, errors or ids. Organization A never sees organization B's worker
// state, and nothing in the request can change the scope.
func TestWorkerBacklogEndpoint(t *testing.T) {
	h := kitchenSetup(t)
	ctx := context.Background()
	const secret = "integration-secret-0123456789abcdef"
	const probeConsumer = "tenant_probe"
	orgA, orgB := testsupport.UUID(), testsupport.UUID()
	venueA1, venueA2, venueB := testsupport.UUID(), testsupport.UUID(), testsupport.UUID()
	t.Cleanup(func() {
		// Deliveries cascade with their events.
		_, _ = h.writer.Exec(context.Background(), `DELETE FROM "DomainEvent" WHERE "organizationId" = ANY($1)`, []string{orgA, orgB})
	})

	// Explicit UTC instants: the counts must not depend on the writer
	// session's timezone.
	states := map[string]string{
		"pending":  `status = 'pending', "availableAt" = (now() AT TIME ZONE 'UTC') - interval '1 second'`,
		"retrying": `status = 'pending', "availableAt" = (now() AT TIME ZONE 'UTC') + interval '1 hour'`,
		"leased": `status = 'pending', "availableAt" = (now() AT TIME ZONE 'UTC') - interval '1 second',
			"leaseOwner" = 'probe-worker', "leaseExpiresAt" = (now() AT TIME ZONE 'UTC') + interval '1 hour'`,
		"failed": `status = 'failed', "failedAt" = (now() AT TIME ZONE 'UTC'), "lastError" = 'tenant-probe-error-text'`,
	}
	var secrets []string // ids that must never appear in a response
	seed := func(org, venue, state string) {
		t.Helper()
		eventID, deliveryID := testsupport.UUID(), testsupport.UUID()
		if _, err := h.writer.Exec(ctx, `INSERT INTO "DomainEvent" (id, "organizationId", "venueId", "eventType", "aggregateType",
			"aggregateId", "aggregateVersion", payload) VALUES ($1, $2, $3, 'shift.opened', 'shift', $4, 1, '{"probe":"tenant-probe-payload"}')`,
			eventID, org, venue, testsupport.UUID()); err != nil {
			t.Fatal(err)
		}
		if _, err := h.writer.Exec(ctx, `INSERT INTO "EventDelivery" (id, "eventId", consumer) VALUES ($1, $2, $3)`,
			deliveryID, eventID, probeConsumer); err != nil {
			t.Fatal(err)
		}
		if _, err := h.writer.Exec(ctx, `UPDATE "EventDelivery" SET `+states[state]+`,
			"createdAt" = (now() AT TIME ZONE 'UTC') - interval '1 minute' WHERE id = $1`, deliveryID); err != nil {
			t.Fatal(err)
		}
		secrets = append(secrets, eventID, deliveryID)
	}
	// Organization A: two venues, counted together. Organization B: larger
	// numbers, so any leak shows up in A's counts.
	for _, s := range []struct{ org, venue, state string }{
		{orgA, venueA1, "pending"}, {orgA, venueA1, "pending"}, {orgA, venueA1, "failed"},
		{orgA, venueA2, "pending"}, {orgA, venueA2, "retrying"},
		{orgB, venueB, "pending"}, {orgB, venueB, "pending"}, {orgB, venueB, "pending"}, {orgB, venueB, "pending"}, {orgB, venueB, "pending"},
		{orgB, venueB, "retrying"}, {orgB, venueB, "retrying"}, {orgB, venueB, "leased"},
		{orgB, venueB, "failed"}, {orgB, venueB, "failed"}, {orgB, venueB, "failed"},
	} {
		seed(s.org, s.venue, s.state)
	}

	routes := server.Routes(server.Deps{Logger: quiet, Health: health.New(h.kpool, time.Second),
		Menu: menu.NewHandler(menu.NewPostgresStore(h.kpool), quiet), Venues: venues.NewHandler(venues.NewPostgresStore(h.kpool), quiet),
		Verifier: identity.NewVerifier(secret), TabletDevices: identity.NewPostgresTabletDevices(h.kpool), VenueGrants: identity.NewPostgresVenueGrants(h.kpool),
		RateLimiter: ratelimit.New(admitAll{}, 0, quiet), Workers: workersapi.NewHandler(h.kpool, quiet)})
	sign := func(c jwt.MapClaims) string {
		c["exp"] = time.Now().Add(time.Minute).Unix()
		s, _ := jwt.NewWithClaims(jwt.SigningMethodHS256, c).SignedString([]byte(secret))
		return s
	}
	staff := func(role, org string) string {
		return sign(jwt.MapClaims{"sub": testsupport.UUID(), "role": role, "organizationId": org})
	}
	get := func(tok, query string) (int, string) {
		req := httptest.NewRequest("GET", "/api/admin/workers"+query, nil)
		if tok != "" {
			req.Header.Set("Authorization", "Bearer "+tok)
		}
		rec := httptest.NewRecorder()
		routes.ServeHTTP(rec, req)
		return rec.Code, rec.Body.String()
	}
	type counts struct{ Pending, Retrying, Leased, Failed int }
	probe := func(t *testing.T, body string) (counts, bool) {
		t.Helper()
		var got struct {
			Consumers []workers.Backlog `json:"consumers"`
		}
		if err := json.Unmarshal([]byte(body), &got); err != nil {
			t.Fatalf("backlog body %s: %v", body, err)
		}
		var c counts
		found, kitchenListed := false, false
		for _, b := range got.Consumers {
			kitchenListed = kitchenListed || b.Consumer == string(events.KitchenProjector)
			if b.Consumer == probeConsumer {
				found, c = true, counts{b.Pending, b.Retrying, b.Leased, b.Failed}
				if b.OldestPendingSeconds < 55 {
					t.Errorf("oldest pending %.0fs, want about 60s", b.OldestPendingSeconds)
				}
			}
		}
		if !kitchenListed {
			t.Errorf("registered consumers must be listed even when empty: %s", body)
		}
		return c, found
	}
	// noData: no event content, error text, lease owner or id, in any
	// response. noFields: a backlog body carries no field beyond counts.
	noData := func(t *testing.T, body string) {
		t.Helper()
		for _, bad := range append([]string{"tenant-probe-payload", "tenant-probe-error-text", "probe-worker",
			orgA, orgB, venueA1, venueA2, venueB}, secrets...) {
			if strings.Contains(body, bad) {
				t.Errorf("response exposes %q: %s", bad, body)
			}
		}
	}
	noLeak := func(t *testing.T, body string) {
		t.Helper()
		noData(t, body)
		for _, field := range []string{"payload", "lastError", "eventId", "leaseOwner", "organizationId", "venueId"} {
			if strings.Contains(body, field) {
				t.Errorf("backlog body carries %q: %s", field, body)
			}
		}
	}

	wantA, wantB := counts{Pending: 3, Retrying: 1, Leased: 0, Failed: 1}, counts{Pending: 5, Retrying: 2, Leased: 1, Failed: 3}
	for name, c := range map[string]struct {
		tok, query string
		want       counts
	}{
		"owner of A":                  {staff("owner", orgA), "", wantA},
		"admin of A":                  {staff("admin", orgA), "", wantA},
		"owner of B":                  {staff("owner", orgB), "", wantB},
		"admin of B":                  {staff("admin", orgB), "", wantB},
		"admin of A asking for B":     {staff("admin", orgA), "?organizationId=" + orgB + "&venueId=" + venueB, wantA},
		"admin of A naming B's venue": {sign(jwt.MapClaims{"sub": testsupport.UUID(), "role": "admin", "organizationId": orgA, "venueId": venueB}), "", wantA},
	} {
		t.Run(name, func(t *testing.T) {
			status, body := get(c.tok, c.query)
			if status != 200 {
				t.Fatalf("%d %s", status, body)
			}
			got, found := probe(t, body)
			if !found || got != c.want {
				t.Errorf("counts %+v (found %v), want %+v", got, found, c.want)
			}
			noLeak(t, body)
		})
	}

	// An organization with no deliveries sees zeros only.
	status, body := get(staff("owner", testsupport.UUID()), "")
	if got, found := probe(t, body); status != 200 || found || got != (counts{}) {
		t.Errorf("empty organization: %d %s", status, body)
	}

	for name, c := range map[string]struct {
		tok  string
		want int
	}{
		"manager":         {staff("manager", orgA), 403},
		"cashier":         {staff("cashier", orgA), 403},
		"kitchen":         {staff("kitchen", orgA), 403},
		"KDS device":      {sign(jwt.MapClaims{"sub": "kds-device:x", "role": "kitchen", "organizationId": orgA, "venueId": venueA1, "kind": "kds_device"}), 403},
		"tablet as admin": {sign(jwt.MapClaims{"sub": testsupport.UUID(), "role": "admin", "organizationId": orgA, "venueId": venueA1, "kind": "tablet_manager", "deviceId": testsupport.UUID()}), 403},
		"no organization": {sign(jwt.MapClaims{"sub": testsupport.UUID(), "role": "owner"}), 401},
		"bad signature":   {staff("owner", orgA) + "x", 401},
		"unauthenticated": {"", 401},
	} {
		if status, body := get(c.tok, ""); status != c.want {
			t.Errorf("%s: %d %s", name, status, body)
		} else {
			noData(t, body)
		}
	}

	// The package function refuses to run unscoped.
	if _, err := workers.Backlogs(ctx, h.kpool, ""); err == nil {
		t.Error("an unscoped backlog was served")
	}
}

// D13 regression: canonical changes record DomainEvent facts (and the
// kitchen projector's delivery) and never write the retired D12
// RealtimeEvent table, which stays in place with its rows untouched.
func TestCanonicalChangesWriteNoRealtimeEvent(t *testing.T) {
	h := kitchenSetup(t)
	ctx := context.Background()
	legacy := testsupport.UUID()
	if _, err := h.writer.Exec(ctx, `INSERT INTO "RealtimeEvent" (id, "organizationId", "venueId", "eventType", "aggregateType",
		"aggregateId", payload) VALUES ($1, $2, $3, 'order.created', 'order', $4, '{"legacy":true}')`,
		legacy, h.f.Org, h.f.Venue, testsupport.UUID()); err != nil {
		t.Fatal(err)
	}
	snapshot := func() (int, string) {
		var n int
		var digest string
		if err := h.writer.QueryRow(ctx, `SELECT count(*), COALESCE(md5(string_agg(r::text, '|' ORDER BY r.id)), '')
			FROM "RealtimeEvent" r WHERE r."venueId" = $1`, h.f.Venue).Scan(&n, &digest); err != nil {
			t.Fatal(err)
		}
		return n, digest
	}
	beforeN, beforeDigest := snapshot()

	s := h.openSession(t, h.f.TableA)
	o, _, err := h.orders.Create(ctx, h.dineIn(s.ID, line(h.f.Plain, 1)))
	if err != nil {
		t.Fatal(err)
	}
	h.drain(t) // the kitchen_projector delivery runs: kitchen_ticket.created

	for _, c := range []struct {
		what string
		sql  string
		arg  string
		want int
	}{
		{"table_session.opened", `SELECT count(*) FROM "DomainEvent" WHERE "aggregateId" = $1 AND "eventType" = 'table_session.opened'`, s.ID, 1},
		{"order.created", `SELECT count(*) FROM "DomainEvent" WHERE "aggregateId" = $1 AND "eventType" = 'order.created'`, o.ID, 1},
		{"order.round_submitted", `SELECT count(*) FROM "DomainEvent" WHERE "aggregateId" = $1 AND "eventType" = 'order.round_submitted'`, o.ID, 1},
		{"kitchen delivery succeeded", `SELECT count(*) FROM "EventDelivery" d JOIN "DomainEvent" e ON e.id = d."eventId"
			WHERE e."aggregateId" = $1 AND e."eventType" = 'order.round_submitted' AND d.consumer = 'kitchen_projector' AND d.status = 'succeeded'`, o.ID, 1},
		{"no delivery for broadcast-only facts", `SELECT count(*) FROM "EventDelivery" d JOIN "DomainEvent" e ON e.id = d."eventId"
			WHERE e."aggregateId" = $1 AND e."eventType" = 'order.created'`, o.ID, 0},
		{"kitchen_ticket.created", `SELECT count(*) FROM "DomainEvent" WHERE "eventType" = 'kitchen_ticket.created' AND payload->>'orderId' = $1`, o.ID, 1},
		{"no legacy outbox row", `SELECT count(*) FROM "OutboxEvent" WHERE "aggregateId" = $1`, o.ID, 0},
	} {
		if n := h.count(t, c.sql, c.arg); n != c.want {
			t.Errorf("%s: %d, want %d", c.what, n, c.want)
		}
	}
	if afterN, afterDigest := snapshot(); afterN != beforeN || afterDigest != beforeDigest {
		t.Errorf("RealtimeEvent rows for the venue changed: %d -> %d", beforeN, afterN)
	}
	if n := h.count(t, `SELECT count(*) FROM "RealtimeEvent" WHERE id = $1 AND payload = '{"legacy":true}'::jsonb`, legacy); n != 1 {
		t.Error("the legacy RealtimeEvent row was altered or removed")
	}
}

// 24, 25: the event system knows no external-POS or command concept.
func TestNoExternalPOSOrCommandInEvents(t *testing.T) {
	for _, typ := range events.Types() {
		for _, bad := range []string{"connector", "possync", "pos_sync", "idealpos", "command"} {
			if strings.Contains(strings.ToLower(typ), bad) {
				t.Errorf("event type %s", typ)
			}
		}
	}
	for _, c := range events.Consumers() {
		if strings.Contains(string(c), "connector") || strings.Contains(string(c), "pos") {
			t.Errorf("consumer %s", c)
		}
	}
	_ = orders.StatusConfirmed
}
