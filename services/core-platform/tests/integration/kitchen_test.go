package integration

// Kitchen tickets (Phase D4, run as the D13 kitchen_projector consumer)
// against real PostgreSQL: projection of order.round_submitted, idempotency
// under redelivery and concurrent workers, bounded retry and dead letters,
// the legacy outbox drain, ticket transitions under concurrency, the
// database invariants of migration 20261001000000_kitchen_tickets, and the
// API end to end.

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"servvia/services/core-platform/internal/events"
	eventstore "servvia/services/core-platform/internal/events/pgstore"
	"servvia/services/core-platform/internal/health"
	"servvia/services/core-platform/internal/identity"
	"servvia/services/core-platform/internal/kitchen"
	"servvia/services/core-platform/internal/kitchen/kitchenapi"
	kitchenstore "servvia/services/core-platform/internal/kitchen/pgstore"
	"servvia/services/core-platform/internal/menu"
	"servvia/services/core-platform/internal/orders"
	"servvia/services/core-platform/internal/platform/postgres"
	"servvia/services/core-platform/internal/ratelimit"
	"servvia/services/core-platform/internal/server"
	"servvia/services/core-platform/internal/venues"
	"servvia/services/core-platform/internal/workers"
	"servvia/services/core-platform/tests/testsupport"
)

type kitchenHarness struct {
	ordersHarness
	projector *kitchenstore.Projector
	// worker runs the kitchen_projector consumer (Phase D13), the path of
	// every new round; projector's own loop only drains legacy OutboxEvent rows.
	worker  *workers.Worker
	kitchen *kitchen.Service
	kpool   *pgxpool.Pool
}

func kitchenSetup(t *testing.T) kitchenHarness {
	h := ordersSetup(t)
	pool, err := postgres.NewPool(context.Background(), postgres.Options{URL: testsupport.DisposableDatabaseURL(t), MaxConns: 40})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	p := kitchenstore.NewProjector(pool, kitchen.SingleStation{Name: kitchen.DefaultStation}, logger)
	p.BaseBackoff, p.MaxBackoff = time.Millisecond, 5*time.Millisecond
	w := workers.New(pool, events.KitchenProjector, p, logger)
	w.BaseBackoff, w.MaxBackoff = time.Millisecond, 5*time.Millisecond
	return kitchenHarness{ordersHarness: h, projector: p, worker: w, kitchen: kitchen.NewService(kitchenstore.New(pool), true), kpool: pool}
}

// drain projects every due round: the kitchen_projector deliveries, then any
// legacy OutboxEvent rows (including other fixtures' leftovers).
func (h kitchenHarness) drain(t *testing.T) {
	t.Helper()
	if _, err := h.worker.Drain(context.Background(), 10_000); err != nil {
		t.Fatal(err)
	}
	if _, err := h.projector.Drain(context.Background(), 10_000); err != nil {
		t.Fatal(err)
	}
}

func (h kitchenHarness) tickets(t *testing.T, statuses ...kitchen.Status) []kitchen.Ticket {
	t.Helper()
	ts, err := h.kitchen.List(context.Background(), h.f.Venue, kitchen.Filter{Statuses: statuses})
	if err != nil {
		t.Fatal(err)
	}
	return ts
}

// event is the order.round_submitted domain event of round sequence of an order.
func (h kitchenHarness) event(t *testing.T, orderID string, sequence int) string {
	t.Helper()
	var id string
	if err := h.writer.QueryRow(context.Background(), `SELECT id FROM "DomainEvent"
		WHERE "aggregateId" = $1 AND "eventType" = 'order.round_submitted' AND (payload->>'sequence')::int = $2`, orderID, sequence).Scan(&id); err != nil {
		t.Fatal(err)
	}
	return id
}

// delivery is the kitchen_projector delivery of an event.
func (h kitchenHarness) delivery(t *testing.T, eventID string) string {
	t.Helper()
	var id string
	if err := h.writer.QueryRow(context.Background(), `SELECT id FROM "EventDelivery" WHERE "eventId" = $1 AND consumer = 'kitchen_projector'`,
		eventID).Scan(&id); err != nil {
		t.Fatal(err)
	}
	return id
}

// reproject runs the consumer's handler on an event again, directly: the
// equivalent of a duplicate delivery.
func (h kitchenHarness) reproject(ctx context.Context, eventID string) error {
	return pgx.BeginFunc(ctx, h.kpool, func(tx pgx.Tx) error {
		e, err := eventstore.Get(ctx, tx, eventID)
		if err != nil {
			return err
		}
		return h.projector.Handle(ctx, tx, e)
	})
}

var kds = kitchen.Actor{ID: "kds-device:venue", Kind: "kds_device", Role: "kitchen"}

// A round becomes one ticket with snapshot lines; the order is untouched and
// no legacy delivery row appears.
func TestRoundProjectsToKitchenTicket(t *testing.T) {
	h := kitchenSetup(t)
	ctx := context.Background()
	notes := "no onions"
	s := h.openSession(t, h.f.TableA)
	o, _, err := h.orders.Create(ctx, h.dineIn(s.ID, line(h.f.Burger, 2, [2]string{h.f.Size, h.f.Large}),
		orders.LineInput{MenuItemID: h.f.Plain, Quantity: 1, Notes: &notes, Seat: ptrInt(3)}))
	if err != nil {
		t.Fatal(err)
	}
	if n := len(h.tickets(t)); n != 0 {
		t.Fatalf("a ticket exists before projection: %d", n)
	}
	h.drain(t)

	ts := h.tickets(t)
	if len(ts) != 1 {
		t.Fatalf("tickets: %+v", ts)
	}
	tk := ts[0]
	if tk.OrderID != o.ID || tk.RoundID != o.Rounds[0].ID || tk.RoundSequence != 1 || tk.Station != "kitchen" ||
		tk.Status != kitchen.StatusNew || tk.Version != 1 || *tk.TableNumber != "1" || tk.TakeawayReference != nil ||
		tk.OrderSource != "waiter_tablet" || tk.SourceEventID != h.event(t, o.ID, 1) || len(tk.Lines) != 2 {
		t.Fatalf("ticket %+v", tk)
	}
	l0, l1 := tk.Lines[0], tk.Lines[1]
	if l0.OrderItemID != o.Lines[0].ID || l0.Position != 1 || l0.Title != o.Lines[0].MenuItemTitle || l0.Quantity != 2 ||
		len(l0.Modifiers) != 1 || l0.Modifiers[0] != (kitchen.Modifier{GroupName: "Size", OptionName: "Large"}) ||
		l1.Position != 2 || *l1.Notes != notes || *l1.Seat != 3 || len(l1.Modifiers) != 0 {
		t.Errorf("lines %+v", tk.Lines)
	}
	for _, c := range []struct {
		what string
		sql  string
		want int
	}{
		{"delivered once to the kitchen projector", `SELECT count(*) FROM "EventDelivery" d JOIN "DomainEvent" e ON e.id = d."eventId"
			WHERE e."aggregateId" = $1 AND d.consumer = 'kitchen_projector' AND d.status = 'succeeded' AND d.attempts = 1 AND d."leaseOwner" IS NULL`, 1},
		{"no legacy outbox row (D13)", `SELECT count(*) FROM "OutboxEvent" WHERE "aggregateId" = $1`, 0},
		{"order still confirmed", `SELECT count(*) FROM "Order" WHERE id = $1 AND status = 'confirmed' AND "preparingAt" IS NULL`, 1},
		{"no printer job", `SELECT count(*) FROM "PrinterJob" WHERE "orderId" = $1`, 0},
		{"no KDS delivery record", `SELECT count(*) FROM "KdsDeliveryRecord" WHERE "orderId" = $1`, 0},
	} {
		if got := h.count(t, c.sql, o.ID); got != c.want {
			t.Errorf("%s: %d", c.what, got)
		}
	}

	// A further round is a further ticket.
	o, _, err = h.orders.SubmitRound(ctx, orders.RoundCommand{Scope: h.scope(), OrderID: o.ID, RequestKey: key(),
		Lines: []orders.LineInput{line(h.f.Plain, 4)}, Actor: h.waiter()})
	if err != nil {
		t.Fatal(err)
	}
	h.drain(t)
	ts = h.tickets(t)
	if len(ts) != 2 || ts[1].RoundSequence != 2 || ts[1].RoundID != o.Rounds[1].ID || len(ts[1].Lines) != 1 || ts[1].Lines[0].Quantity != 4 {
		t.Errorf("round 2 ticket: %+v", ts)
	}

	// A takeaway order carries its reference instead of a table.
	take, _, err := h.orders.Create(ctx, orders.CreateCommand{Scope: h.scope(), Source: orders.SourcePOSTerminal,
		ServiceMode: orders.ServiceTakeaway, IdempotencyKey: key(), Actor: orders.Actor{StaffID: h.f.Owner, Role: "owner"},
		Lines: []orders.LineInput{line(h.f.Plain, 1)}})
	if err != nil {
		t.Fatal(err)
	}
	h.drain(t)
	ts = h.tickets(t)
	if last := ts[len(ts)-1]; last.OrderID != take.ID || last.TableNumber != nil || *last.TakeawayReference != *take.TakeawayReference ||
		last.OrderSource != "pos_terminal" {
		t.Errorf("takeaway ticket %+v", last)
	}
}

// Several orders on one visit each get their own tickets.
func TestMultipleOrdersPerSessionGetSeparateTickets(t *testing.T) {
	h := kitchenSetup(t)
	ctx := context.Background()
	s := h.openSession(t, h.f.TableB)
	a, _, err := h.orders.Create(ctx, h.dineIn(s.ID, line(h.f.Plain, 1)))
	if err != nil {
		t.Fatal(err)
	}
	guest := h.dineIn(s.ID, line(h.f.Burger, 1, [2]string{h.f.Size, h.f.Large}))
	guest.Source = orders.SourceOrderTablet
	b, _, err := h.orders.Create(ctx, guest)
	if err != nil {
		t.Fatal(err)
	}
	h.drain(t)
	ts := h.tickets(t)
	if len(ts) != 2 || ts[0].OrderID != a.ID || ts[1].OrderID != b.ID || ts[1].OrderSource != "order_tablet" ||
		*ts[0].TableNumber != "2" || *ts[1].TableNumber != "2" {
		t.Errorf("tickets %+v", ts)
	}
}

// D13 15-17: duplicate handling and redelivery never duplicate kitchen work.
func TestProjectionIsIdempotent(t *testing.T) {
	h := kitchenSetup(t)
	ctx := context.Background()
	o, _, err := h.orders.Create(ctx, h.dineIn(h.openSession(t, h.f.TableA).ID, line(h.f.Plain, 1), line(h.f.Burger, 1, [2]string{h.f.Size, h.f.Large})))
	if err != nil {
		t.Fatal(err)
	}
	h.drain(t)
	ev := h.event(t, o.ID, 1)
	for i := 0; i < 3; i++ {
		if err := h.reproject(ctx, ev); err != nil {
			t.Fatal(err)
		}
	}
	// As if the success had been lost: the same delivery is due again.
	if _, err := h.writer.Exec(ctx, `UPDATE "EventDelivery" SET status = 'pending', "succeededAt" = NULL WHERE id = $1`, h.delivery(t, ev)); err != nil {
		t.Fatal(err)
	}
	h.drain(t)
	if n := h.count(t, `SELECT count(*) FROM "KitchenTicket" WHERE "orderId" = $1`, o.ID); n != 1 {
		t.Errorf("tickets: %d", n)
	}
	if n := h.count(t, `SELECT count(*) FROM "KitchenTicketLine" l JOIN "KitchenTicket" k ON k.id = l."ticketId" WHERE k."orderId" = $1`, o.ID); n != 2 {
		t.Errorf("lines: %d", n)
	}
	if n := h.count(t, `SELECT count(*) FROM "EventDelivery" WHERE id = $1 AND status = 'succeeded' AND attempts = 2`, h.delivery(t, ev)); n != 1 {
		t.Error("the redelivery was not recorded once")
	}
	// A partially projected ticket (a line lost) is completed, not duplicated.
	if _, err := h.writer.Exec(ctx, `DELETE FROM "KitchenTicketLine" WHERE "orderItemId" = $1`, o.Lines[1].ID); err != nil {
		t.Fatal(err)
	}
	if err := h.reproject(ctx, ev); err != nil {
		t.Fatal(err)
	}
	if ts := h.tickets(t); len(ts) != 1 || len(ts[0].Lines) != 2 || ts[0].Lines[1].OrderItemID != o.Lines[1].ID {
		t.Errorf("repaired ticket %+v", ts)
	}
}

// Many orders, eight independent workers draining and sixteen duplicate
// handlings racing them: every round has exactly one ticket, every line
// one ticket line, and every delivery was claimed exactly once.
func TestConcurrentWorkersProjectEachRoundOnce(t *testing.T) {
	h := kitchenSetup(t)
	ctx := context.Background()
	const orderCount = 30
	var evs []string
	for i := 0; i < orderCount; i++ {
		o, _, err := h.orders.Create(ctx, orders.CreateCommand{Scope: h.scope(), Source: orders.SourcePOSTerminal,
			ServiceMode: orders.ServiceTakeaway, IdempotencyKey: key(), Actor: orders.Actor{StaffID: h.f.Owner, Role: "owner"},
			Lines: []orders.LineInput{line(h.f.Plain, 1), line(h.f.Plain, 2)}})
		if err != nil {
			t.Fatal(err)
		}
		evs = append(evs, h.event(t, o.ID, 1))
	}
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	errs := make([]error, 24)
	race(24, func(i int) {
		if i < 8 {
			_, errs[i] = workers.New(h.kpool, events.KitchenProjector, h.projector, logger).Drain(ctx, 10_000)
			return
		}
		for j := i; j < len(evs); j += 16 {
			if err := h.reproject(ctx, evs[j]); err != nil {
				errs[i] = err
				return
			}
		}
	})
	for i, err := range errs {
		if err != nil {
			t.Fatalf("worker %d: %v", i, err)
		}
	}
	h.drain(t)
	for what, c := range map[string]struct {
		sql  string
		want int
	}{
		"tickets":      {`SELECT count(*) FROM "KitchenTicket" WHERE "venueId" = $1`, orderCount},
		"ticket lines": {`SELECT count(*) FROM "KitchenTicketLine" l JOIN "KitchenTicket" k ON k.id = l."ticketId" WHERE k."venueId" = $1`, 2 * orderCount},
		"claimed once, succeeded, never failed": {`SELECT count(*) FROM "EventDelivery" d JOIN "DomainEvent" e ON e.id = d."eventId"
			WHERE e."venueId" = $1 AND d.consumer = 'kitchen_projector' AND d.status = 'succeeded' AND d.attempts = 1 AND d."lastError" IS NULL`, orderCount},
	} {
		if got := h.count(t, c.sql, h.f.Venue); got != c.want {
			t.Errorf("%s: %d, want %d", what, got, c.want)
		}
	}
}

// D13 10-14: a failing delivery is retried with backoff, then fails (a dead
// letter); it never blocks the deliveries behind it, and it projects once
// its cause is fixed and an operator retries it.
func TestProjectionFailureRetriesThenParks(t *testing.T) {
	h := kitchenSetup(t)
	ctx := context.Background()
	h.worker.MaxAttempts = 3
	bad, _, err := h.orders.Create(ctx, h.dineIn(h.openSession(t, h.f.TableA).ID, line(h.f.Plain, 1)))
	if err != nil {
		t.Fatal(err)
	}
	// A transient fault on this round only: a trigger on the disposable
	// database, removed when the test ends.
	fn := "d4_fault_" + strings.ReplaceAll(testsupport.UUID(), "-", "")
	for _, sql := range []string{
		`CREATE FUNCTION ` + fn + `() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
		   IF NEW."roundId" = '` + bad.Rounds[0].ID + `' THEN RAISE EXCEPTION 'injected kitchen fault'; END IF;
		   RETURN NEW; END $$`,
		`CREATE TRIGGER ` + fn + ` BEFORE INSERT ON "KitchenTicket" FOR EACH ROW EXECUTE FUNCTION ` + fn + `()`,
	} {
		if _, err := h.writer.Exec(ctx, sql); err != nil {
			t.Fatal(err)
		}
	}
	dropped := false
	drop := func() {
		if !dropped {
			dropped = true
			_, _ = h.writer.Exec(context.Background(), `DROP TRIGGER IF EXISTS `+fn+` ON "KitchenTicket"`)
			_, _ = h.writer.Exec(context.Background(), `DROP FUNCTION IF EXISTS `+fn+`()`)
		}
	}
	t.Cleanup(drop)
	good, _, err := h.orders.Create(ctx, h.dineIn(h.openSession(t, h.f.TableB).ID, line(h.f.Plain, 1)))
	if err != nil {
		t.Fatal(err)
	}

	// First pass with a long backoff: one attempt, and the delivery is not due.
	h.worker.BaseBackoff, h.worker.MaxBackoff = time.Hour, time.Hour
	h.drain(t)
	d := h.delivery(t, h.event(t, bad.ID, 1))
	var attempts int
	var lastError *string
	var backoff float64
	if err := h.writer.QueryRow(ctx, `SELECT attempts, "lastError", EXTRACT(EPOCH FROM "availableAt" - LOCALTIMESTAMP)
		FROM "EventDelivery" WHERE id = $1 AND status = 'pending' AND "leaseOwner" IS NULL`, d).Scan(&attempts, &lastError, &backoff); err != nil {
		t.Fatal(err)
	}
	if attempts != 1 || lastError == nil || !strings.Contains(*lastError, "injected kitchen fault") || backoff < 3500 || backoff > 3600 {
		t.Errorf("first failure recorded: attempts %d, error %v, backed off %.0fs", attempts, lastError, backoff)
	}
	if n := h.count(t, `SELECT count(*) FROM "KitchenTicket" WHERE "orderId" = $1`, good.ID); n != 1 {
		t.Errorf("the next delivery was blocked: %d tickets", n)
	}

	// Then short backoffs until the attempt limit fails it.
	h.worker.BaseBackoff, h.worker.MaxBackoff = time.Millisecond, 5*time.Millisecond
	if _, err := h.writer.Exec(ctx, `UPDATE "EventDelivery" SET "availableAt" = LOCALTIMESTAMP WHERE id = $1`, d); err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(5 * time.Second)
	for h.count(t, `SELECT count(*) FROM "EventDelivery" WHERE id = $1 AND status = 'failed'`, d) == 0 {
		if time.Now().After(deadline) {
			t.Fatal("the delivery never failed")
		}
		time.Sleep(10 * time.Millisecond)
		h.drain(t)
	}
	if n := h.count(t, `SELECT attempts FROM "EventDelivery" WHERE id = $1 AND "failedAt" IS NOT NULL AND "succeededAt" IS NULL`, d); n != 3 {
		t.Errorf("failed after %d attempts", n)
	}
	h.drain(t) // a failed delivery is not retried
	if n := h.count(t, `SELECT attempts FROM "EventDelivery" WHERE id = $1`, d); n != 3 {
		t.Errorf("failed delivery retried: %d attempts", n)
	}
	if err := workers.Retry(ctx, h.kpool, h.delivery(t, h.event(t, good.ID, 1))); !errors.Is(err, workers.ErrNotFailed) {
		t.Errorf("retrying a succeeded delivery: %v", err)
	}

	// Fixed and retried by an operator: it projects.
	drop()
	if err := workers.Retry(ctx, h.kpool, d); err != nil {
		t.Fatal(err)
	}
	h.drain(t)
	if n := h.count(t, `SELECT count(*) FROM "KitchenTicket" WHERE "orderId" = $1`, bad.ID); n != 1 {
		t.Errorf("retried delivery: %d tickets", n)
	}

	// An event that can never succeed (its round does not exist) fails at once.
	var ghost string
	if err := pgx.BeginFunc(ctx, h.writer, func(tx pgx.Tx) error {
		var err error
		ghost, err = eventstore.Record(ctx, tx, h.f.Venue, events.Fact{Type: "order.round_submitted", AggregateType: "order",
			AggregateID: "ORD-missing", Payload: map[string]any{"orderId": "ORD-missing", "roundId": "nope", "sequence": 1}})
		return err
	}); err != nil {
		t.Fatal(err)
	}
	h.drain(t)
	if n := h.count(t, `SELECT count(*) FROM "EventDelivery" WHERE "eventId" = $1 AND attempts = 1 AND status = 'failed'`, ghost); n != 1 {
		t.Errorf("unprojectable event not failed at once")
	}
}

// D13 D4 compatibility: legacy OutboxEvent rows written before D13 are
// still drained, and a round projected by both paths is projected once.
func TestLegacyOutboxIsDrained(t *testing.T) {
	h := kitchenSetup(t)
	ctx := context.Background()
	o, _, err := h.orders.Create(ctx, h.dineIn(h.openSession(t, h.f.TableA).ID, line(h.f.Plain, 1), line(h.f.Plain, 2)))
	if err != nil {
		t.Fatal(err)
	}
	h.drain(t)
	// A pre-D13 row for the same round, and one for a round that is gone.
	legacy, missing := testsupport.UUID(), testsupport.UUID()
	for _, row := range [][2]string{{legacy, `{"orderId":"` + o.ID + `","roundId":"` + o.Rounds[0].ID + `","sequence":1}`},
		{missing, `{"orderId":"ORD-gone","roundId":"gone"}`}} {
		if _, err := h.writer.Exec(ctx, `INSERT INTO "OutboxEvent" (id, "venueId", "aggregateType", "aggregateId", "eventType", payload)
			VALUES ($1, $2, 'order', 'legacy', 'order.round_submitted', $3)`, row[0], h.f.Venue, row[1]); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := h.projector.Drain(ctx, 100); err != nil {
		t.Fatal(err)
	}
	if n := h.count(t, `SELECT count(*) FROM "KitchenTicketLine" l JOIN "KitchenTicket" k ON k.id = l."ticketId" WHERE k."orderId" = $1`, o.ID); n != 2 {
		t.Errorf("double projection wrote %d lines", n)
	}
	if n := h.count(t, `SELECT count(*) FROM "OutboxEvent" WHERE id = $1 AND "processedAt" IS NOT NULL`, legacy); n != 1 {
		t.Error("the legacy row was not drained")
	}
	if n := h.count(t, `SELECT count(*) FROM "OutboxEvent" WHERE id = $1 AND attempts = 1 AND "failedAt" IS NOT NULL`, missing); n != 1 {
		t.Error("an unprojectable legacy row was not parked at once")
	}
}

// Concurrent kitchen screens moving one ticket: one write per real change,
// a gapless history, and the order never changes.
func TestConcurrentTicketTransitions(t *testing.T) {
	h := kitchenSetup(t)
	ctx := context.Background()
	o, _, err := h.orders.Create(ctx, h.dineIn(h.openSession(t, h.f.TableA).ID, line(h.f.Plain, 1)))
	if err != nil {
		t.Fatal(err)
	}
	h.drain(t)
	id := h.tickets(t)[0].ID
	move := func(to kitchen.Status, version int) (kitchen.Ticket, bool, error) {
		return h.kitchen.Transition(ctx, kitchen.TransitionCommand{VenueID: h.f.Venue, TicketID: id, To: to, ExpectedVersion: version, Actor: kds})
	}

	// 24 screens start the same ticket: one change, 23 no-op successes.
	changed := make([]bool, 24)
	errs := make([]error, 24)
	race(24, func(i int) { _, changed[i], errs[i] = move(kitchen.StatusPreparing, 1) })
	writers := 0
	for i := range errs {
		if errs[i] != nil {
			t.Fatalf("screen %d: %v", i, errs[i])
		}
		if changed[i] {
			writers++
		}
	}
	if writers != 1 {
		t.Errorf("%d writers", writers)
	}

	// Racing screens asking for the same next status: again one change, and
	// every caller gets the moved ticket.
	race(12, func(i int) { _, changed[i], errs[i] = move(kitchen.StatusReady, 2) })
	writers = 0
	for i := 0; i < 12; i++ {
		if errs[i] != nil {
			t.Fatalf("screen %d: %v", i, errs[i])
		}
		if changed[i] {
			writers++
		}
	}
	if writers != 1 {
		t.Errorf("ready: %d writers", writers)
	}
	// A screen that read an older version and asks for something else is
	// refused, never applied over the newer state.
	var conflict *kitchen.VersionConflictError
	if _, _, err := move(kitchen.StatusCompleted, 2); !errors.As(err, &conflict) || conflict.Current != 3 {
		t.Errorf("stale screen: %v", err)
	}
	for _, step := range []struct {
		to      kitchen.Status
		version int
	}{{kitchen.StatusCompleted, 3}, {kitchen.StatusRecalled, 4}, {kitchen.StatusReady, 5}, {kitchen.StatusCompleted, 6}} {
		if _, _, err := move(step.to, step.version); err != nil {
			t.Fatalf("%s: %v", step.to, err)
		}
	}
	tk, err := h.kitchen.Get(ctx, h.f.Venue, id)
	if err != nil {
		t.Fatal(err)
	}
	if tk.Status != kitchen.StatusCompleted || tk.Version != 7 || tk.PreparingAt == nil || tk.ReadyAt == nil ||
		tk.CompletedAt == nil || tk.RecalledAt == nil || tk.AcknowledgedAt != nil {
		t.Errorf("ticket %+v", tk)
	}
	if n := h.count(t, `SELECT count(*) FROM "KitchenTicketTransition" WHERE "ticketId" = $1
		AND version BETWEEN 2 AND 7 AND "actorId" = 'kds-device:venue' AND "actorKind" = 'kds_device'`, id); n != 6 {
		t.Errorf("history rows: %d", n)
	}
	if n := h.count(t, `SELECT count(*) FROM "Order" WHERE id = $1 AND status = 'confirmed'`, o.ID); n != 1 {
		t.Error("kitchen progress changed the order")
	}
	if len(h.tickets(t)) != 0 || len(h.tickets(t, kitchen.StatusCompleted)) != 1 {
		t.Error("a completed ticket is not active")
	}
}

func TestKitchenSchemaInvariants(t *testing.T) {
	h := kitchenSetup(t)
	ctx := context.Background()
	a, _, err := h.orders.Create(ctx, h.dineIn(h.openSession(t, h.f.TableA).ID, line(h.f.Plain, 1)))
	if err != nil {
		t.Fatal(err)
	}
	b, _, err := h.orders.Create(ctx, h.dineIn(h.openSession(t, h.f.TableB).ID, line(h.f.Plain, 1)))
	if err != nil {
		t.Fatal(err)
	}
	h.drain(t)
	ticketA := h.tickets(t)[0]

	insert := func(orderID, roundID, station, status string, extra string) error {
		_, err := h.writer.Exec(ctx, `INSERT INTO "KitchenTicket" (id, "venueId", "orderId", "roundId", station, status,
			"sourceEventId", "roundSequence", "orderSource", "updatedAt"`+extra+`)
			VALUES ($1, $2, $3, $4, $5, $6::"KitchenTicketStatus", 'e', 1, 'pos_terminal', now()`+
			strings.Repeat(", now()", strings.Count(extra, ","))+`)`,
			testsupport.UUID(), h.f.Venue, orderID, roundID, station, status)
		return err
	}
	addLine := func(ticketID, itemID string, position, quantity int) error {
		_, err := h.writer.Exec(ctx, `INSERT INTO "KitchenTicketLine" (id, "ticketId", "orderItemId", position, title, quantity)
			VALUES ($1, $2, $3, $4, 't', $5)`, testsupport.UUID(), ticketID, itemID, position, quantity)
		return err
	}
	for _, c := range []struct {
		name, code, constraint string
		err                    error
	}{
		{"second ticket for a round and station", "23505", "KitchenTicket_roundId_station_key", insert(a.ID, a.Rounds[0].ID, "kitchen", "new", "")},
		{"ticket naming another order's round", "23503", "KitchenTicket_roundId_orderId_fkey", insert(a.ID, b.Rounds[0].ID, "bar", "new", "")},
		{"station format", "23514", "KitchenTicket_station_format", insert(a.ID, a.Rounds[0].ID, "Hot Line", "new", "")},
		{"ready without readyAt", "23514", "KitchenTicket_stage_stamped", insert(a.ID, a.Rounds[0].ID, "bar", "ready", "")},
		{"order line on two tickets", "23505", "KitchenTicketLine_orderItemId_key", addLine(ticketA.ID, a.Lines[0].ID, 9, 1)},
		{"zero quantity", "23514", "KitchenTicketLine_quantity_positive", addLine(ticketA.ID, b.Lines[0].ID, 9, 0)},
	} {
		if code, constraint := pgCode(c.err); code != c.code || constraint != c.constraint {
			t.Errorf("%s: %s %s (%v)", c.name, code, constraint, c.err)
		}
	}
	if err := insert(a.ID, a.Rounds[0].ID, "bar", "ready", `, "readyAt"`); err != nil {
		t.Errorf("a stamped ready ticket on another station: %v", err)
	}
}

func TestKitchenAPIAgainstPostgres(t *testing.T) {
	h := kitchenSetup(t)
	ctx := context.Background()
	pool, err := postgres.NewPool(ctx, postgres.Options{URL: testsupport.DisposableDatabaseURL(t), MaxConns: 8})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	o, _, err := h.orders.Create(ctx, h.dineIn(h.openSession(t, h.f.TableC).ID, line(h.f.Burger, 1, [2]string{h.f.Size, h.f.Large})))
	if err != nil {
		t.Fatal(err)
	}
	h.drain(t)

	const secret = "integration-secret-0123456789abcdef"
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	venueStore := venues.NewPostgresStore(pool)
	routes := server.Routes(server.Deps{
		Logger: logger, Health: health.New(pool, time.Second),
		Menu:     menu.NewHandler(menu.NewPostgresStore(pool), logger),
		Venues:   venues.NewHandler(venueStore, logger),
		Kitchen:  kitchenapi.NewHandler(h.kitchen, venueStore, logger),
		Verifier: identity.NewVerifier(secret), TabletDevices: identity.NewPostgresTabletDevices(pool),
		RateLimiter: ratelimit.New(admitAll{}, 0, logger),
	})
	// A KDS device token, as POST /api/kiosk/kds/auth issues it.
	token, _ := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"sub": "kds-device:" + h.f.Venue, "role": "kitchen", "organizationId": h.f.Org, "venueId": h.f.Venue,
		"kind": "kds_device", "exp": time.Now().Add(time.Minute).Unix(),
	}).SignedString([]byte(secret))
	call := func(method, path string, body any) (int, []byte) {
		raw, _ := json.Marshal(body)
		req := httptest.NewRequest(method, "/api/venues/"+h.f.Venue+"/kitchen-tickets"+path, strings.NewReader(string(raw)))
		req.Header.Set("Authorization", "Bearer "+token)
		rec := httptest.NewRecorder()
		routes.ServeHTTP(rec, req)
		return rec.Code, rec.Body.Bytes()
	}
	ticketSchema := testsupport.Schema(t, "openapi/kitchen-tickets.yaml", "/components/schemas/KitchenTicket")

	status, body := call("GET", "", nil)
	var list []map[string]any
	_ = json.Unmarshal(body, &list)
	if status != 200 || len(list) != 1 || list[0]["orderId"] != o.ID {
		t.Fatalf("list: %d %s", status, body)
	}
	raw, _ := json.Marshal(list[0])
	testsupport.Validate(t, ticketSchema, raw)
	id := list[0]["id"].(string)

	status, body = call("POST", "/"+id+"/transitions", map[string]any{"to": "acknowledged", "version": 1})
	var moved map[string]any
	_ = json.Unmarshal(body, &moved)
	if status != 200 || moved["status"] != "acknowledged" || moved["acknowledgedAt"] == nil {
		t.Fatalf("acknowledge: %d %s", status, body)
	}
	testsupport.Validate(t, ticketSchema, body)
	if status, body := call("POST", "/"+id+"/transitions", map[string]any{"to": "ready", "version": 2}); status != 409 {
		t.Errorf("skip preparing: %d %s", status, body)
	}
	if status, body := call("GET", "?station=bar", nil); status != 200 || string(body) != "[]" {
		t.Errorf("other station: %d %s", status, body)
	}
	var actorKind string
	if err := h.writer.QueryRow(ctx, `SELECT "actorKind" FROM "KitchenTicketTransition" WHERE "ticketId" = $1`, id).Scan(&actorKind); err != nil ||
		actorKind != "kds_device" {
		t.Errorf("history: %q %v", actorKind, err)
	}
}
