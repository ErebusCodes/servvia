package integration

// Checks (Phase D5) against real PostgreSQL: billing a visit with several
// orders and a takeaway order, server-authoritative money and tax, menu
// changes, idempotency, concurrency (identical creates, competing creates,
// creates racing rounds, voids), isolation, domain independence (orders,
// kitchen, sessions, payments, external POS), the database invariants of
// migration 20261002000000_checks, and the API end to end.

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"

	"servvia/services/core-platform/internal/checks"
	"servvia/services/core-platform/internal/checks/checksapi"
	checkstore "servvia/services/core-platform/internal/checks/pgstore"
	"servvia/services/core-platform/internal/health"
	"servvia/services/core-platform/internal/identity"
	"servvia/services/core-platform/internal/kitchen"
	"servvia/services/core-platform/internal/menu"
	"servvia/services/core-platform/internal/orders"
	"servvia/services/core-platform/internal/platform/postgres"
	"servvia/services/core-platform/internal/pricing"
	"servvia/services/core-platform/internal/ratelimit"
	"servvia/services/core-platform/internal/server"
	"servvia/services/core-platform/internal/venues"
	"servvia/services/core-platform/tests/testsupport"
)

type checksHarness struct {
	kitchenHarness
	checks *checks.Service
}

func checksSetup(t *testing.T) checksHarness {
	h := kitchenSetup(t)
	pool, err := postgres.NewPool(context.Background(), postgres.Options{URL: testsupport.DisposableDatabaseURL(t), MaxConns: 40})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	return checksHarness{kitchenHarness: h,
		checks: checks.NewService(checkstore.New(pool, func(err error) { t.Errorf("audit: %v", err) }), true)}
}

func (h checksHarness) checkScope() checks.Scope {
	return checks.Scope{OrganizationID: h.f.Org, Venue: pricing.Venue{ID: h.f.Venue, OrganizationID: h.f.Org, Tax: pricing.NZGSTInclusive}}
}

func (h checksHarness) cashier() checks.Actor {
	return checks.Actor{StaffID: h.f.Cashier, Email: "cashier@example.test", Role: "cashier"}
}

func (h checksHarness) forSession(session string) checks.CreateCommand {
	return checks.CreateCommand{Scope: h.checkScope(), TableSessionID: &session, IdempotencyKey: key(), Actor: h.cashier()}
}

func (h checksHarness) forOrders(ids ...string) checks.CreateCommand {
	return checks.CreateCommand{Scope: h.checkScope(), OrderIDs: ids, IdempotencyKey: key(), Actor: h.cashier()}
}

func (h checksHarness) round(t *testing.T, orderID string, lines ...orders.LineInput) orders.Order {
	t.Helper()
	o, _, err := h.orders.SubmitRound(context.Background(), orders.RoundCommand{Scope: h.scope(), OrderID: orderID,
		RequestKey: key(), Lines: lines, Actor: h.waiter()})
	if err != nil {
		t.Fatal(err)
	}
	return o
}

// kitchenState is every ticket's status and version, to prove checks leave
// kitchen work alone.
func (h checksHarness) kitchenState(t *testing.T) string {
	t.Helper()
	var s string
	if err := h.writer.QueryRow(context.Background(), `SELECT coalesce(string_agg(id || status::text || version, ',' ORDER BY id), '')
		FROM "KitchenTicket" WHERE "venueId" = $1`, h.f.Venue).Scan(&s); err != nil {
		t.Fatal(err)
	}
	return s
}

// 1, 3, 5, 11, 12, 13: a visit with two orders (and a later round) is billed
// on one check from the orders' snapshots, and nothing else changes.
func TestCheckBillsAVisitWithSeveralOrders(t *testing.T) {
	h := checksSetup(t)
	ctx := context.Background()
	s := h.openSession(t, h.f.TableA)
	a, _, err := h.orders.Create(ctx, h.dineIn(s.ID, line(h.f.Burger, 1, [2]string{h.f.Size, h.f.Large}), line(h.f.Plain, 2)))
	if err != nil {
		t.Fatal(err)
	}
	guest := h.dineIn(s.ID, line(h.f.Odd, 1))
	guest.Source = orders.SourceOrderTablet
	b, _, err := h.orders.Create(ctx, guest)
	if err != nil {
		t.Fatal(err)
	}
	a = h.round(t, a.ID, line(h.f.Plain, 1))
	h.drain(t) // kitchen tickets exist and are being worked
	tk := h.tickets(t)[0]
	if _, _, err := h.kitchen.Transition(ctx, kitchen.TransitionCommand{VenueID: h.f.Venue, TicketID: tk.ID,
		To: kitchen.StatusPreparing, ExpectedVersion: 1, Actor: kds}); err != nil {
		t.Fatal(err)
	}
	kitchenBefore := h.kitchenState(t)
	paymentsBefore := h.count(t, `SELECT count(*) FROM "Payment"`)

	c, created, err := h.checks.Create(ctx, h.forSession(s.ID))
	if err != nil || !created {
		t.Fatalf("create: %v", err)
	}
	// 2050 + 2 x 550 + 550 (round 2) + 1999 = 5699; GST round(5699 x 3/23) = 743.
	if c.Status != checks.StatusOpen || *c.TableSessionID != s.ID || c.Currency != "NZD" || c.SubtotalCents != 5699 ||
		c.TaxCents != 743 || c.TotalCents != 5699 || c.TaxCents != pricing.NZGSTContainedCents(c.SubtotalCents) ||
		c.Version != 1 || *c.CreatedByStaffID != h.f.Cashier || len(c.Lines) != 4 {
		t.Fatalf("check %+v", c)
	}
	// Lines in ordering order: order A's round 1, its round 2, then order B.
	want := []struct {
		order, item string
		unit, total int64
	}{{a.ID, a.Lines[0].ID, 2050, 2050}, {a.ID, a.Lines[1].ID, 550, 1100}, {a.ID, a.Lines[2].ID, 550, 550}, {b.ID, b.Lines[0].ID, 1999, 1999}}
	for i, w := range want {
		l := c.Lines[i]
		if l.OrderID != w.order || l.OrderItemID != w.item || l.UnitPriceCents != w.unit || l.LineTotalCents != w.total || l.Position != i+1 {
			t.Errorf("line %d: %+v", i, l)
		}
	}
	if c.Lines[0].Modifiers[0].OptionName != "Large" || c.Lines[0].Modifiers[0].PriceDeltaCents != 250 {
		t.Errorf("modifier snapshot %+v", c.Lines[0].Modifiers)
	}
	// The obligation equals what the orders accepted.
	if c.SubtotalCents != a.TotalCents+b.TotalCents {
		t.Errorf("check %d != orders %d + %d", c.SubtotalCents, a.TotalCents, b.TotalCents)
	}

	// Nothing outside the check changed, and nothing legacy was created.
	if h.kitchenState(t) != kitchenBefore {
		t.Error("check creation changed kitchen tickets")
	}
	for _, c2 := range []struct {
		what string
		sql  string
		args []any
		want int
	}{
		{"orders still confirmed", `SELECT count(*) FROM "Order" WHERE id = ANY($1) AND status = 'confirmed' AND "completedAt" IS NULL`, []any{[]string{a.ID, b.ID}}, 2},
		{"session still open", `SELECT count(*) FROM "TableSession" WHERE id = $1 AND status = 'open' AND version = 1`, []any{s.ID}, 1},
		{"audit", `SELECT count(*) FROM "AuditLog" WHERE "resourceId" = $1 AND action = 'CHECK_CREATED' AND resource = 'check' AND "actorId" = $2`, []any{c.ID, h.f.Cashier}, 1},
		{"no payment", `SELECT count(*) FROM "Payment"`, nil, paymentsBefore},
		{"no payment observation", `SELECT count(*) FROM "PaymentObservation" WHERE "orderId" = ANY($1)`, []any{[]string{a.ID, b.ID}}, 0},
		{"no POS sync record", `SELECT count(*) FROM "POSSyncRecord" WHERE "orderId" = ANY($1)`, []any{[]string{a.ID, b.ID}}, 0},
		{"no printer job", `SELECT count(*) FROM "PrinterJob" WHERE "orderId" = ANY($1)`, []any{[]string{a.ID, b.ID}}, 0},
		{"no connector command", `SELECT count(*) FROM "ConnectorCommand" WHERE "venueId" = $1`, []any{h.f.Venue}, 0},
		{"no legacy outbox rows", `SELECT count(*) FROM "OutboxEvent" WHERE "venueId" = $1`, []any{h.f.Venue}, 0},
		{"no work deliveries for check facts", `SELECT count(*) FROM "EventDelivery" d JOIN "DomainEvent" e ON e.id = d."eventId"
			WHERE e."venueId" = $1 AND e."aggregateType" = 'check'`, []any{h.f.Venue}, 0},
	} {
		if got := h.count(t, c2.sql, c2.args...); got != c2.want {
			t.Errorf("%s: %d", c2.what, got)
		}
	}

	// 14: the visit may have more checks. Everything is billed now...
	var conflict error
	if _, _, conflict = h.checks.Create(ctx, h.forSession(s.ID)); !errors.Is(conflict, checks.ErrNothingToBill) {
		t.Errorf("second check with nothing new: %v", conflict)
	}
	// ...until a guest orders more: a second open check on the same visit.
	h.round(t, b.ID, line(h.f.Plain, 3))
	second, _, err := h.checks.Create(ctx, h.forSession(s.ID))
	if err != nil || len(second.Lines) != 1 || second.SubtotalCents != 1650 || second.Lines[0].OrderID != b.ID {
		t.Fatalf("second check: %+v %v", second, err)
	}
	list, err := h.checks.List(ctx, h.checkScope(), checks.Filter{TableSessionID: s.ID})
	if err != nil || len(list) != 2 {
		t.Errorf("checks of the visit: %d %v", len(list), err)
	}
}

// 2: a takeaway order is billed without any table session.
func TestTakeawayCheckHasNoSession(t *testing.T) {
	h := checksSetup(t)
	ctx := context.Background()
	o, _, err := h.orders.Create(ctx, orders.CreateCommand{Scope: h.scope(), Source: orders.SourcePOSTerminal,
		ServiceMode: orders.ServiceTakeaway, IdempotencyKey: key(), Actor: orders.Actor{StaffID: h.f.Owner, Role: "owner"},
		Lines: []orders.LineInput{line(h.f.Odd, 2)}})
	if err != nil {
		t.Fatal(err)
	}
	sessions := h.count(t, `SELECT count(*) FROM "TableSession"`)
	c, _, err := h.checks.Create(ctx, h.forOrders(o.ID))
	if err != nil || c.TableSessionID != nil || c.SubtotalCents != 3998 || c.TaxCents != o.TaxCents || c.TotalCents != o.TotalCents {
		t.Fatalf("takeaway check %+v %v", c, err)
	}
	if h.count(t, `SELECT count(*) FROM "TableSession"`) != sessions {
		t.Error("a table session was fabricated")
	}
	// A takeaway and a table order are not one bill.
	d, _, err := h.orders.Create(ctx, h.dineIn(h.openSession(t, h.f.TableB).ID, line(h.f.Plain, 1)))
	if err != nil {
		t.Fatal(err)
	}
	o2, _, err := h.orders.Create(ctx, orders.CreateCommand{Scope: h.scope(), Source: orders.SourcePOSTerminal,
		ServiceMode: orders.ServiceTakeaway, IdempotencyKey: key(), Actor: orders.Actor{StaffID: h.f.Owner, Role: "owner"},
		Lines: []orders.LineInput{line(h.f.Plain, 1)}})
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err := h.checks.Create(ctx, h.forOrders(o2.ID, d.ID)); !errors.Is(err, checks.ErrMixedVisits) {
		t.Errorf("takeaway with table order: %v", err)
	}
	e, _, err := h.orders.Create(ctx, h.dineIn(h.openSession(t, h.f.TableC).ID, line(h.f.Plain, 1)))
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err := h.checks.Create(ctx, h.forOrders(d.ID, e.ID)); !errors.Is(err, checks.ErrMixedVisits) {
		t.Errorf("two visits: %v", err)
	}
}

// 4: menu price changes after ordering never change what is owed.
func TestMenuChangesDoNotChangeTheObligation(t *testing.T) {
	h := checksSetup(t)
	ctx := context.Background()
	o, _, err := h.orders.Create(ctx, h.dineIn(h.openSession(t, h.f.TableA).ID, line(h.f.Burger, 1, [2]string{h.f.Size, h.f.Large})))
	if err != nil {
		t.Fatal(err)
	}
	// The burger and its Large option both get dearer after the order.
	if _, err := h.writer.Exec(ctx, `UPDATE "MenuItem" SET "priceCents" = 9999,
		"modifierGroups" = regexp_replace("modifierGroups"::text, '"priceDeltaCents": 250', '"priceDeltaCents": 999')::jsonb
		WHERE id = $1`, h.f.Burger); err != nil {
		t.Fatal(err)
	}
	if n := h.count(t, `SELECT count(*) FROM "MenuItem" WHERE id = $1 AND "modifierGroups"::text LIKE '%999%'`, h.f.Burger); n != 1 {
		t.Fatal("the option price did not change")
	}
	c, _, err := h.checks.Create(ctx, h.forOrders(o.ID))
	if err != nil || c.SubtotalCents != 2050 || c.Lines[0].UnitPriceCents != 2050 || c.Lines[0].Modifiers[0].PriceDeltaCents != 250 {
		t.Fatalf("billed at the accepted price: %+v %v", c, err)
	}
	if _, err := h.writer.Exec(ctx, `UPDATE "MenuItem" SET "priceCents" = 1 WHERE id = $1`, h.f.Burger); err != nil {
		t.Fatal(err)
	}
	again, err := h.checks.Get(ctx, h.checkScope(), c.ID)
	if err != nil || again.SubtotalCents != 2050 || again.Lines[0].LineTotalCents != 2050 {
		t.Errorf("the check changed with the menu: %+v %v", again, err)
	}
}

// 6, 7: replay returns the check; the same key for another request conflicts
// and creates nothing.
func TestCheckIdempotency(t *testing.T) {
	h := checksSetup(t)
	ctx := context.Background()
	s := h.openSession(t, h.f.TableA)
	o, _, err := h.orders.Create(ctx, h.dineIn(s.ID, line(h.f.Plain, 1)))
	if err != nil {
		t.Fatal(err)
	}
	cmd := h.forSession(s.ID)
	c, created, err := h.checks.Create(ctx, cmd)
	if err != nil || !created {
		t.Fatal(err)
	}
	// A round after the check: a replay still returns the original check,
	// not a new one over the new lines.
	h.round(t, o.ID, line(h.f.Plain, 1))
	again, created, err := h.checks.Create(ctx, cmd)
	if err != nil || created || again.ID != c.ID || again.SubtotalCents != c.SubtotalCents {
		t.Errorf("replay: %+v %v %v", again, created, err)
	}
	other := cmd
	other.TableSessionID, other.OrderIDs = nil, []string{o.ID}
	var conflict *checks.IdempotencyConflictError
	if _, _, err := h.checks.Create(ctx, other); !errors.As(err, &conflict) || conflict.CheckID != c.ID {
		t.Errorf("key reuse: %v", err)
	}
	if n := h.count(t, `SELECT count(*) FROM "Check" WHERE "venueId" = $1`, h.f.Venue); n != 1 {
		t.Errorf("checks: %d", n)
	}
	if n := h.count(t, `SELECT count(*) FROM "AuditLog" WHERE "resourceId" = $1 AND action IN ('CHECK_IDEMPOTENT_REPLAY', 'CHECK_IDEMPOTENCY_CONFLICT')`, c.ID); n != 2 {
		t.Errorf("replay and conflict audits: %d", n)
	}
}

// 8: 24 identical creates at once make one check; every caller gets it.
func TestConcurrentIdenticalCheckCreates(t *testing.T) {
	h := checksSetup(t)
	s := h.openSession(t, h.f.TableA)
	if _, _, err := h.orders.Create(context.Background(), h.dineIn(s.ID, line(h.f.Plain, 1), line(h.f.Odd, 1))); err != nil {
		t.Fatal(err)
	}
	cmd := h.forSession(s.ID)
	const n = 24
	ids, created, errs := make([]string, n), make([]bool, n), make([]error, n)
	race(n, func(i int) {
		var c checks.Check
		c, created[i], errs[i] = h.checks.Create(context.Background(), cmd)
		ids[i] = c.ID
	})
	creators := 0
	for i := range ids {
		if errs[i] != nil || ids[i] != ids[0] {
			t.Fatalf("caller %d: %q %v", i, ids[i], errs[i])
		}
		if created[i] {
			creators++
		}
	}
	if creators != 1 || h.count(t, `SELECT count(*) FROM "Check" WHERE "venueId" = $1`, h.f.Venue) != 1 ||
		h.count(t, `SELECT count(*) FROM "CheckLine" l JOIN "Check" c ON c.id = l."checkId" WHERE c."venueId" = $1`, h.f.Venue) != 2 {
		t.Errorf("%d creators; want one check with two lines", creators)
	}
}

// Same key, different requests, at once: one check; the others conflict.
func TestConcurrentConflictingCheckCreates(t *testing.T) {
	h := checksSetup(t)
	ctx := context.Background()
	var orderIDs []string
	for _, table := range []string{h.f.TableA, h.f.TableB} {
		o, _, err := h.orders.Create(ctx, h.dineIn(h.openSession(t, table).ID, line(h.f.Plain, 1)))
		if err != nil {
			t.Fatal(err)
		}
		orderIDs = append(orderIDs, o.ID)
	}
	k := key()
	const n = 16
	ids, errs := make([]string, n), make([]error, n)
	race(n, func(i int) {
		cmd := h.forOrders(orderIDs[i%2])
		cmd.IdempotencyKey = k
		var c checks.Check
		c, _, errs[i] = h.checks.Create(ctx, cmd)
		ids[i] = c.ID
	})
	var winner string
	conflicts := 0
	for i := range errs {
		var conflict *checks.IdempotencyConflictError
		switch {
		case errs[i] == nil && (winner == "" || winner == ids[i]):
			winner = ids[i]
		case errors.As(errs[i], &conflict):
			conflicts++
		default:
			t.Fatalf("caller %d: %q %v", i, ids[i], errs[i])
		}
	}
	if conflicts != n/2 || h.count(t, `SELECT count(*) FROM "Check" WHERE "venueId" = $1`, h.f.Venue) != 1 {
		t.Errorf("%d conflicts; want exactly one check", conflicts)
	}
}

// Different keys over the same visit at once: every line is billed exactly
// once; the losers find nothing left to bill.
func TestCompetingCheckCreatesNeverDoubleBill(t *testing.T) {
	h := checksSetup(t)
	ctx := context.Background()
	s := h.openSession(t, h.f.TableA)
	for i := 0; i < 3; i++ {
		if _, _, err := h.orders.Create(ctx, h.dineIn(s.ID, line(h.f.Plain, 1), line(h.f.Odd, 1))); err != nil {
			t.Fatal(err)
		}
	}
	const n = 12
	errs := make([]error, n)
	race(n, func(i int) { _, _, errs[i] = h.checks.Create(ctx, h.forSession(s.ID)) })
	made := 0
	for i, err := range errs {
		switch {
		case err == nil:
			made++
		case !errors.Is(err, checks.ErrNothingToBill):
			t.Fatalf("caller %d: %v", i, err)
		}
	}
	if made != 1 || h.count(t, `SELECT count(*) FROM "CheckLine" l JOIN "Check" c ON c.id = l."checkId" WHERE c."venueId" = $1`, h.f.Venue) != 6 {
		t.Errorf("%d checks made; want one check holding all six lines", made)
	}
}

// Checks created while rounds arrive: a round is wholly on a check or wholly
// left over, and in the end every line is billed exactly once.
func TestCheckCreationRacingRounds(t *testing.T) {
	h := checksSetup(t)
	ctx := context.Background()
	s := h.openSession(t, h.f.TableA)
	o, _, err := h.orders.Create(ctx, h.dineIn(s.ID, line(h.f.Plain, 1)))
	if err != nil {
		t.Fatal(err)
	}
	var billed atomic.Int64
	for i := 0; i < 15; i++ {
		race(2, func(j int) {
			if j == 0 {
				h.round(t, o.ID, line(h.f.Plain, 1), line(h.f.Odd, 1))
				return
			}
			if _, _, err := h.checks.Create(ctx, h.forSession(s.ID)); err == nil {
				billed.Add(1)
			} else if !errors.Is(err, checks.ErrNothingToBill) {
				t.Errorf("create: %v", err)
			}
		})
	}
	if _, _, err := h.checks.Create(ctx, h.forSession(s.ID)); err != nil && !errors.Is(err, checks.ErrNothingToBill) {
		t.Fatal(err)
	}
	final, err := h.orders.Get(ctx, h.scope(), o.ID)
	if err != nil {
		t.Fatal(err)
	}
	// Each round's two lines are on the same check.
	if n := h.count(t, `SELECT count(*) FROM (SELECT i."roundId" FROM "CheckLine" l JOIN "OrderItem" i ON i.id = l."orderItemId"
		WHERE l."orderId" = $1 GROUP BY i."roundId" HAVING count(DISTINCT l."checkId") > 1) split`, o.ID); n != 0 {
		t.Errorf("%d rounds split across checks", n)
	}
	var sum int64
	if err := h.writer.QueryRow(ctx, `SELECT coalesce(sum("subtotalCents"), 0) FROM "Check" WHERE "tableSessionId" = $1 AND status = 'open'`, s.ID).Scan(&sum); err != nil {
		t.Fatal(err)
	}
	if lines := h.count(t, `SELECT count(*) FROM "CheckLine" WHERE "orderId" = $1`, o.ID); lines != len(final.Lines) || sum != final.TotalCents {
		t.Errorf("billed %d of %d lines, %d of %d cents (%d checks during the race)", lines, len(final.Lines), sum, final.TotalCents, billed.Load())
	}
}

// Void: only by version, idempotent, releases the lines, touches nothing else.
func TestVoidReleasesLinesOnly(t *testing.T) {
	h := checksSetup(t)
	ctx := context.Background()
	s := h.openSession(t, h.f.TableA)
	o, _, err := h.orders.Create(ctx, h.dineIn(s.ID, line(h.f.Plain, 2)))
	if err != nil {
		t.Fatal(err)
	}
	h.drain(t)
	kitchenBefore := h.kitchenState(t)
	c, _, err := h.checks.Create(ctx, h.forSession(s.ID))
	if err != nil {
		t.Fatal(err)
	}
	manager := checks.Actor{StaffID: h.f.Owner, Email: "owner@example.test", Role: "owner"}
	void := func(version int) (checks.Check, bool, error) {
		return h.checks.Void(ctx, checks.VoidCommand{Scope: h.checkScope(), CheckID: c.ID, ExpectedVersion: version,
			Reason: "rang up the wrong table", Actor: manager})
	}
	var conflict *checks.VersionConflictError
	if _, _, err := void(2); !errors.As(err, &conflict) || conflict.Current != 1 {
		t.Errorf("stale version: %v", err)
	}
	const n = 12
	changed, errs := make([]bool, n), make([]error, n)
	race(n, func(i int) { _, changed[i], errs[i] = void(1) })
	writers := 0
	for i := range errs {
		if errs[i] != nil {
			t.Fatalf("void %d: %v", i, errs[i])
		}
		if changed[i] {
			writers++
		}
	}
	voided, err := h.checks.Get(ctx, h.checkScope(), c.ID)
	if err != nil || writers != 1 || voided.Status != checks.StatusVoided || voided.Version != 2 || voided.VoidedAt == nil ||
		*voided.VoidReason != "rang up the wrong table" || *voided.VoidedByStaffID != h.f.Owner {
		t.Fatalf("voided %+v (%d writers) %v", voided, writers, err)
	}
	if n := h.count(t, `SELECT count(*) FROM "AuditLog" WHERE "resourceId" = $1 AND action = 'CHECK_VOIDED'`, c.ID); n != 1 {
		t.Errorf("void audits: %d", n)
	}
	// The order lines may be billed again; the order, session and kitchen
	// are untouched.
	again, _, err := h.checks.Create(ctx, h.forSession(s.ID))
	if err != nil || again.SubtotalCents != c.SubtotalCents || again.Lines[0].OrderItemID != o.Lines[0].ID {
		t.Errorf("rebill: %+v %v", again, err)
	}
	if h.kitchenState(t) != kitchenBefore ||
		h.count(t, `SELECT count(*) FROM "Order" WHERE id = $1 AND status = 'confirmed'`, o.ID) != 1 ||
		h.count(t, `SELECT count(*) FROM "TableSession" WHERE id = $1 AND status = 'open'`, s.ID) != 1 {
		t.Error("void changed another domain")
	}
	if open, err := h.checks.List(ctx, h.checkScope(), checks.Filter{}); err != nil || len(open) != 1 || open[0].ID != again.ID {
		t.Errorf("open checks: %+v %v", open, err)
	}
}

// 9 and billing boundaries: other venues, unknown and legacy orders.
func TestCheckIsolationAndBoundaries(t *testing.T) {
	h := checksSetup(t)
	ctx := context.Background()
	s := h.openSession(t, h.f.TableA)
	o, _, err := h.orders.Create(ctx, h.dineIn(s.ID, line(h.f.Plain, 1)))
	if err != nil {
		t.Fatal(err)
	}
	c, _, err := h.checks.Create(ctx, h.forOrders(o.ID))
	if err != nil {
		t.Fatal(err)
	}
	other := h.checkScope()
	other.Venue.ID = h.f.TaxlessVenue
	if _, err := h.checks.Get(ctx, other, c.ID); !errors.Is(err, checks.ErrCheckNotFound) {
		t.Errorf("another venue reads the check: %v", err)
	}
	cmd := h.forOrders(o.ID)
	cmd.Scope = other
	if _, _, err := h.checks.Create(ctx, cmd); !errors.Is(err, checks.ErrOrderNotFound) {
		t.Errorf("another venue bills the order: %v", err)
	}
	cmd = h.forSession(s.ID)
	cmd.Scope = other
	if _, _, err := h.checks.Create(ctx, cmd); !errors.Is(err, checks.ErrTableSessionNotFound) {
		t.Errorf("another venue bills the session: %v", err)
	}
	if _, _, err := h.checks.Create(ctx, h.forOrders(o.ID, "ORD-does-not-exist")); !errors.Is(err, checks.ErrOrderNotFound) {
		t.Errorf("unknown order: %v", err)
	}
	legacy, _, err := h.orders.Create(ctx, h.dineIn(h.openSession(t, h.f.TableB).ID, line(h.f.Plain, 1)))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := h.writer.Exec(ctx, `UPDATE "Order" SET source = 'staff' WHERE id = $1`, legacy.ID); err != nil {
		t.Fatal(err)
	}
	if _, _, err := h.checks.Create(ctx, h.forOrders(legacy.ID)); !errors.Is(err, checks.ErrLegacyOrder) {
		t.Errorf("legacy order: %v", err)
	}
	if _, err := h.writer.Exec(ctx, `UPDATE "Order" SET source = 'waiter_tablet', status = 'cancelled' WHERE id = $1`, legacy.ID); err != nil {
		t.Fatal(err)
	}
	var notBillable *checks.OrderNotBillableError
	if _, _, err := h.checks.Create(ctx, h.forOrders(legacy.ID)); !errors.As(err, &notBillable) {
		t.Errorf("cancelled order: %v", err)
	}
}

func TestCheckSchemaInvariants(t *testing.T) {
	h := checksSetup(t)
	ctx := context.Background()
	o, _, err := h.orders.Create(ctx, h.dineIn(h.openSession(t, h.f.TableA).ID, line(h.f.Plain, 1)))
	if err != nil {
		t.Fatal(err)
	}
	p, _, err := h.orders.Create(ctx, h.dineIn(h.openSession(t, h.f.TableB).ID, line(h.f.Plain, 1)))
	if err != nil {
		t.Fatal(err)
	}
	c, _, err := h.checks.Create(ctx, h.forOrders(o.ID))
	if err != nil {
		t.Fatal(err)
	}
	insertCheck := func(total int, status, reason string, currency string) error {
		var voidedAt any
		var why any
		if status == "voided" {
			voidedAt = time.Now()
		}
		if reason != "" {
			why = reason
		}
		_, err := h.writer.Exec(ctx, `INSERT INTO "Check" (id, "venueId", status, currency, "subtotalCents", "taxCents", "totalCents",
			"idempotencyKey", "requestFingerprint", "voidedAt", "voidReason", "updatedAt")
			VALUES ($1, $2, $3::"CheckStatus", $4, 100, 13, $5, $6, 'f', $7, $8, now())`,
			testsupport.UUID(), h.f.Venue, status, currency, total, key(), voidedAt, why)
		return err
	}
	insertLine := func(orderID, itemID string, position int) error {
		_, err := h.writer.Exec(ctx, `INSERT INTO "CheckLine" (id, "checkId", "orderId", "orderItemId", position, title, quantity,
			"unitPriceCents", "lineTotalCents") VALUES ($1, $2, $3, $4, $5, 't', 1, 550, 550)`,
			testsupport.UUID(), c.ID, orderID, itemID, position)
		return err
	}
	_, deleteErr := h.writer.Exec(ctx, `DELETE FROM "Order" WHERE id = $1`, o.ID)
	for _, x := range []struct {
		name, code, constraint string
		err                    error
	}{
		{"an order line on two standing checks", "23505", "CheckLine_orderItemId_standing_key", insertLine(o.ID, o.Lines[0].ID, 2)},
		{"a line naming another order", "23503", "CheckLine_orderItemId_orderId_fkey", insertLine(o.ID, p.Lines[0].ID, 3)},
		// D11 generalised D5's rule to total = gross - discount; with no
		// discount the same row is refused, under the new name.
		{"total differs from gross", "23514", "Check_total_is_discounted_gross", insertCheck(99, "open", "", "NZD")},
		{"voided without a reason", "23514", "Check_void_fields", insertCheck(100, "voided", "", "NZD")},
		{"open with a void reason", "23514", "Check_void_fields", insertCheck(100, "open", "because", "NZD")},
		{"currency format", "23514", "Check_currency_format", insertCheck(100, "open", "", "nzd")},
		{"deleting a billed order", "23001", "CheckLine_orderId_fkey", deleteErr},
	} {
		if code, constraint := pgCode(x.err); code != x.code || constraint != x.constraint {
			t.Errorf("%s: %s %s (%v)", x.name, code, constraint, x.err)
		}
	}
	// Once its check is voided the line is released and may be held again.
	if _, err := h.writer.Exec(ctx, `UPDATE "CheckLine" SET "voidedAt" = now() WHERE "checkId" = $1`, c.ID); err != nil {
		t.Fatal(err)
	}
	if err := insertLine(o.ID, o.Lines[0].ID, 2); err != nil {
		t.Errorf("a released order line cannot be billed again: %v", err)
	}
}

// The API end to end: a cashier bills a visit, a manager voids, a KDS device
// and the kitchen role are refused.
func TestCheckAPIAgainstPostgres(t *testing.T) {
	h := checksSetup(t)
	ctx := context.Background()
	pool, err := postgres.NewPool(ctx, postgres.Options{URL: testsupport.DisposableDatabaseURL(t), MaxConns: 8})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	s := h.openSession(t, h.f.TableC)
	for i := 0; i < 2; i++ {
		if _, _, err := h.orders.Create(ctx, h.dineIn(s.ID, line(h.f.Burger, 1, [2]string{h.f.Size, h.f.Large}))); err != nil {
			t.Fatal(err)
		}
	}
	const secret = "integration-secret-0123456789abcdef"
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	venueStore := venues.NewPostgresStore(pool)
	routes := server.Routes(server.Deps{
		Logger: logger, Health: health.New(pool, time.Second),
		Menu:     menu.NewHandler(menu.NewPostgresStore(pool), logger),
		Venues:   venues.NewHandler(venueStore, logger),
		Checks:   checksapi.NewHandler(h.checks, venueStore, logger),
		Verifier: identity.NewVerifier(secret), TabletDevices: identity.NewPostgresTabletDevices(pool), VenueGrants: identity.NewPostgresVenueGrants(pool),
		RateLimiter: ratelimit.New(admitAll{}, 0, logger),
	})
	token := func(c jwt.MapClaims) string {
		c["organizationId"], c["exp"] = h.f.Org, time.Now().Add(time.Minute).Unix()
		s, _ := jwt.NewWithClaims(jwt.SigningMethodHS256, c).SignedString([]byte(secret))
		return s
	}
	cashier := token(jwt.MapClaims{"sub": h.f.Cashier, "email": "cashier@example.test", "role": "cashier"})
	owner := token(jwt.MapClaims{"sub": h.f.Owner, "email": "owner@example.test", "role": "owner"})
	kdsToken := token(jwt.MapClaims{"sub": "kds-device:" + h.f.Venue, "role": "kitchen", "venueId": h.f.Venue, "kind": "kds_device"})
	call := func(tok, method, path string, body any) (int, map[string]any, []byte) {
		raw, _ := json.Marshal(body)
		req := httptest.NewRequest(method, "/api/venues/"+h.f.Venue+"/checks"+path, strings.NewReader(string(raw)))
		req.Header.Set("Authorization", "Bearer "+tok)
		rec := httptest.NewRecorder()
		routes.ServeHTTP(rec, req)
		var m map[string]any
		_ = json.Unmarshal(rec.Body.Bytes(), &m)
		return rec.Code, m, rec.Body.Bytes()
	}
	checkSchema := testsupport.Schema(t, "openapi/checks.yaml", "/components/schemas/Check")

	// Client money is ignored: the server decides every amount.
	create := map[string]any{"tableSessionId": s.ID, "idempotencyKey": key(), "totalCents": 1, "subtotalCents": 1}
	if status, _, body := call(kdsToken, "POST", "", create); status != 403 {
		t.Errorf("KDS creates a check: %d %s", status, body)
	}
	status, created, body := call(cashier, "POST", "", create)
	if status != 201 || created["totalCents"] != 4100.0 || created["taxCents"] != 535.0 || len(created["lines"].([]any)) != 2 {
		t.Fatalf("create: %d %s", status, body)
	}
	testsupport.Validate(t, checkSchema, body)
	if status, again, _ := call(cashier, "POST", "", create); status != 200 || again["id"] != created["id"] {
		t.Errorf("replay: %d", status)
	}
	id := created["id"].(string)
	if status, _, body := call(kdsToken, "GET", "/"+id, nil); status != 403 {
		t.Errorf("KDS reads a check: %d %s", status, body)
	}
	if status, _, body := call(cashier, "POST", "/"+id+"/void", map[string]any{"version": 1, "reason": "x"}); status != 403 {
		t.Errorf("cashier voids: %d %s", status, body)
	}
	status, voided, body := call(owner, "POST", "/"+id+"/void", map[string]any{"version": 1, "reason": "wrong table"})
	if status != 200 || voided["status"] != "voided" || voided["version"] != 2.0 {
		t.Fatalf("void: %d %s", status, body)
	}
	testsupport.Validate(t, checkSchema, body)
	status, _, body = call(cashier, "GET", "?status=voided&tableSessionId="+s.ID, nil)
	var list []map[string]any
	if err := json.Unmarshal(body, &list); status != 200 || err != nil || len(list) != 1 || list[0]["id"] != id {
		t.Errorf("list voided: %d %s", status, body)
	}
}
