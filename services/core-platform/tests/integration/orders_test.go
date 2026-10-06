package integration

// Canonical orders (Phase D3) against real PostgreSQL: the no-IdealPOS order,
// orders on table sessions, rounds, idempotency, the database invariants of
// migration 20260930000000_canonical_orders, and concurrency.

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"servvia/services/core-platform/internal/health"
	"servvia/services/core-platform/internal/identity"
	"servvia/services/core-platform/internal/menu"
	"servvia/services/core-platform/internal/orders"
	"servvia/services/core-platform/internal/orders/ordersapi"
	orderstore "servvia/services/core-platform/internal/orders/pgstore"
	"servvia/services/core-platform/internal/platform/postgres"
	"servvia/services/core-platform/internal/pricing"
	"servvia/services/core-platform/internal/pricing/pgcatalog"
	"servvia/services/core-platform/internal/ratelimit"
	"servvia/services/core-platform/internal/server"
	"servvia/services/core-platform/internal/tables"
	tablestore "servvia/services/core-platform/internal/tables/pgstore"
	"servvia/services/core-platform/internal/tables/tablesapi"
	"servvia/services/core-platform/internal/venues"
	"servvia/services/core-platform/tests/testsupport"
)

type ordersHarness struct {
	f        testsupport.OrdersFixture
	writer   *pgxpool.Pool
	orders   *orders.Service
	sessions *tables.Service
}

func ordersSetup(t *testing.T) ordersHarness {
	url := testsupport.DisposableDatabaseURL(t)
	ctx := context.Background()
	writer, err := pgxpool.New(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(writer.Close)
	f := testsupport.SeedOrdersFixture(t, ctx, writer)
	pool, err := postgres.NewPool(ctx, postgres.Options{URL: url, MaxConns: 40, ReadOnly: false})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	return ordersHarness{f: f, writer: writer,
		orders:   orders.NewService(orderstore.New(pool, func(err error) { t.Errorf("audit: %v", err) }), pgcatalog.New(pool), true),
		sessions: tables.NewService(tablestore.New(pool), true)}
}

func (h ordersHarness) scope() orders.Scope {
	return orders.Scope{OrganizationID: h.f.Org, Venue: pricing.Venue{ID: h.f.Venue, OrganizationID: h.f.Org, Tax: pricing.NZGSTInclusive}}
}

func (h ordersHarness) waiter() orders.Actor {
	return orders.Actor{StaffID: h.f.Cashier, Email: "waiter@example.test", Role: "cashier", OnTablet: true}
}

func (h ordersHarness) openSession(t *testing.T, table string) tables.Session {
	t.Helper()
	s, _, err := h.sessions.Open(context.Background(), tables.OpenCommand{
		Scope: tables.Scope{OrganizationID: h.f.Org, VenueID: h.f.Venue}, TableID: table, Covers: 2, RequestKey: key(),
		Actor: tables.Actor{StaffID: h.f.Cashier, Role: "cashier"}})
	if err != nil {
		t.Fatal(err)
	}
	return s
}

func (h ordersHarness) dineIn(session string, lines ...orders.LineInput) orders.CreateCommand {
	return orders.CreateCommand{Scope: h.scope(), Source: orders.SourceWaiterTablet, ServiceMode: orders.ServiceDineIn,
		TableSessionID: &session, Lines: lines, IdempotencyKey: key(), Actor: h.waiter()}
}

func line(item string, qty int64, mods ...[2]string) orders.LineInput {
	l := orders.LineInput{MenuItemID: item, Quantity: qty}
	for _, m := range mods {
		l.Modifiers = append(l.Modifiers, pricing.ModifierSelection{ModifierGroupID: m[0], OptionID: m[1]})
	}
	return l
}

// endVisit marks a session closed directly, as a fixture: it reaches the
// "visit ended" state without billing and paying (Phase D10 gates the real
// close on financial completeness; see visit_close_test.go).
func (h ordersHarness) endVisit(t *testing.T, sessionID string) {
	t.Helper()
	if _, err := h.writer.Exec(context.Background(), `UPDATE "TableSession" SET status = 'closed', "closedAt" = now(),
		version = version + 1, "updatedAt" = now() WHERE id = $1 AND status = 'open'`, sessionID); err != nil {
		t.Fatal(err)
	}
}

func (h ordersHarness) count(t *testing.T, sql string, args ...any) int {
	t.Helper()
	var n int
	if err := h.writer.QueryRow(context.Background(), sql, args...).Scan(&n); err != nil {
		t.Fatalf("%s: %v", sql, err)
	}
	return n
}

// §27/§29: a canonical order with no table and zero external-POS state.
func TestNativeOrderExistsWithoutAnyExternalPOSState(t *testing.T) {
	h := ordersSetup(t)
	ctx := context.Background()
	notes := "no onions"
	cmd := orders.CreateCommand{Scope: h.scope(), Source: orders.SourcePOSTerminal, ServiceMode: orders.ServiceTakeaway,
		IdempotencyKey: key(), Actor: orders.Actor{StaffID: h.f.Owner, Role: "owner"},
		Lines: []orders.LineInput{line(h.f.Burger, 2, [2]string{h.f.Size, h.f.Large}), {MenuItemID: h.f.Plain, Quantity: 1, Notes: &notes, Seat: ptrInt(1)}}}
	o, created, err := h.orders.Create(ctx, cmd)
	if err != nil || !created {
		t.Fatalf("create: %v", err)
	}
	// 2 x (1800 + 250) + 550 = 4650, GST contained: round(4650 x 3/23) = 607.
	if o.SubtotalCents != 4650 || o.TaxCents != 607 || o.TotalCents != 4650 || o.Status != orders.StatusConfirmed ||
		o.TableSessionID != nil || o.TableID != nil || o.TakeawayReference == nil || len(o.Rounds) != 1 || len(o.Lines) != 2 {
		t.Fatalf("order %+v", o)
	}
	if o.Lines[0].MenuItemID != h.f.Burger || o.Lines[1].Notes == nil || *o.Lines[1].Notes != notes || *o.Lines[1].Seat != 1 ||
		o.Lines[0].Modifiers[0].OptionName != "Large" || *o.Lines[0].RoundID != o.Rounds[0].ID {
		t.Errorf("lines in request order with snapshots: %+v", o.Lines)
	}

	// Everything is canonical Servvia state, and nothing external exists.
	for _, c := range []struct {
		what string
		sql  string
		want int
	}{
		{"the order", `SELECT count(*) FROM "Order" WHERE id = $1 AND source = 'pos_terminal' AND "posSyncStatus" = 'not_applicable'`, 1},
		{"round 1", `SELECT count(*) FROM "OrderRound" WHERE "orderId" = $1 AND sequence = 1`, 1},
		{"lines", `SELECT count(*) FROM "OrderItem" WHERE "orderId" = $1 AND "roundId" IS NOT NULL AND "nativeRoundId" IS NULL`, 2},
		{"round event with a pending kitchen delivery", `SELECT count(*) FROM "DomainEvent" e JOIN "EventDelivery" d ON d."eventId" = e.id
			WHERE e."aggregateId" = $1 AND e."eventType" = 'order.round_submitted' AND d.consumer = 'kitchen_projector' AND d.status = 'pending'`, 1},
		{"no legacy outbox row (D13)", `SELECT count(*) FROM "OutboxEvent" WHERE "aggregateId" = $1`, 0},
		{"audit", `SELECT count(*) FROM "AuditLog" WHERE "resourceId" = $1 AND action = 'CREATE_ORDER'`, 1},
		{"no POSSyncRecord", `SELECT count(*) FROM "POSSyncRecord" WHERE "orderId" = $1`, 0},
		{"no native round", `SELECT count(*) FROM "NativeTableRound" WHERE "orderId" = $1`, 0},
		{"no KDS delivery row", `SELECT count(*) FROM "KdsDeliveryRecord" WHERE "orderId" = $1`, 0},
		{"no printer job", `SELECT count(*) FROM "PrinterJob" WHERE "orderId" = $1`, 0},
		{"no payment observation", `SELECT count(*) FROM "PaymentObservation" WHERE "orderId" = $1`, 0},
	} {
		if got := h.count(t, c.sql, o.ID); got != c.want {
			t.Errorf("%s: %d, want %d", c.what, got, c.want)
		}
	}
	if n := h.count(t, `SELECT count(*) FROM "ConnectorCommand" WHERE payload::text LIKE '%' || $1 || '%'`, o.ID); n != 0 {
		t.Errorf("connector commands mention the order: %d", n)
	}
	var payload map[string]any
	var raw []byte
	_ = h.writer.QueryRow(ctx, `SELECT payload FROM "DomainEvent" WHERE "aggregateId" = $1 AND "eventType" = 'order.round_submitted'`, o.ID).Scan(&raw)
	_ = json.Unmarshal(raw, &payload)
	// The event names the round; consumers read its lines from the rows.
	if payload["orderId"] != o.ID || payload["roundId"] != o.Rounds[0].ID || payload["sequence"] != 1.0 ||
		payload["source"] != "pos_terminal" || payload["lines"] != nil {
		t.Errorf("round event payload %v", payload)
	}
}

func ptrInt(n int) *int { return &n }

// §28: an order on a table session, end to end.
func TestOrderOnTableSession(t *testing.T) {
	h := ordersSetup(t)
	ctx := context.Background()
	s := h.openSession(t, h.f.TableA)

	cmd := h.dineIn(s.ID, line(h.f.Burger, 1, [2]string{h.f.Size, h.f.Small}))
	o, created, err := h.orders.Create(ctx, cmd)
	if err != nil || !created {
		t.Fatalf("create: %v", err)
	}
	// The table is derived from the session.
	if *o.TableSessionID != s.ID || *o.TableID != h.f.TableA || *o.TableNumber != "1" || o.ServiceMode != orders.ServiceDineIn {
		t.Errorf("table binding %+v", o)
	}
	// A retry returns the same order; a different request with the key is refused.
	if again, created, err := h.orders.Create(ctx, cmd); err != nil || created || again.ID != o.ID {
		t.Errorf("retry: %v %v", created, err)
	}
	conflicting := cmd
	conflicting.Lines = []orders.LineInput{line(h.f.Plain, 1)}
	var idem *orders.IdempotencyConflictError
	if _, _, err := h.orders.Create(ctx, conflicting); !errors.As(err, &idem) || idem.OrderID != o.ID {
		t.Errorf("conflicting retry: %v", err)
	}
	if n := h.count(t, `SELECT count(*) FROM "Order" WHERE "tableSessionId" = $1`, s.ID); n != 1 {
		t.Errorf("%d orders on the session", n)
	}
	// Round 2 attaches to the order; totals cover both rounds.
	rk := key()
	o2, created, err := h.orders.SubmitRound(ctx, orders.RoundCommand{Scope: h.scope(), OrderID: o.ID, RequestKey: rk,
		Lines: []orders.LineInput{line(h.f.Plain, 2)}, Actor: h.waiter()})
	if err != nil || !created || len(o2.Rounds) != 2 || o2.Rounds[1].Sequence != 2 || len(o2.Lines) != 2 ||
		*o2.Lines[1].RoundID != o2.Rounds[1].ID {
		t.Fatalf("round 2: %+v %v", o2, err)
	}
	// 1800 + 2 x 550 = 2900; GST round(2900 x 3/23) = 378.
	if o2.SubtotalCents != 2900 || o2.TaxCents != 378 || o2.TotalCents != 2900 {
		t.Errorf("totals over both rounds %d/%d/%d", o2.SubtotalCents, o2.TaxCents, o2.TotalCents)
	}
	if again, created, err := h.orders.SubmitRound(ctx, orders.RoundCommand{Scope: h.scope(), OrderID: o.ID, RequestKey: rk,
		Lines: []orders.LineInput{line(h.f.Plain, 2)}, Actor: h.waiter()}); err != nil || created || len(again.Rounds) != 2 {
		t.Errorf("round retry: %v %v", created, err)
	}
	var roundConflict *orders.RoundConflictError
	if _, _, err := h.orders.SubmitRound(ctx, orders.RoundCommand{Scope: h.scope(), OrderID: o.ID, RequestKey: rk,
		Lines: []orders.LineInput{line(h.f.Plain, 3)}, Actor: h.waiter()}); !errors.As(err, &roundConflict) {
		t.Errorf("round conflict: %v", err)
	}
	if n := h.count(t, `SELECT count(*) FROM "DomainEvent" WHERE "aggregateId" = $1 AND "eventType" = 'order.round_submitted'`, o.ID); n != 2 {
		t.Errorf("%d round events, want one per round", n)
	}

	// A visit with orders cannot be cancelled, only closed.
	if _, err := h.sessions.Cancel(ctx, tables.Scope{OrganizationID: h.f.Org, VenueID: h.f.Venue}, s.ID, 1, tables.Actor{StaffID: h.f.Cashier, Role: "cashier"}); !errors.Is(err, tables.ErrSessionHasOrders) {
		t.Errorf("cancel with orders: %v", err)
	}
	// Since Phase D10 a visit with unbilled rounds cannot close...
	var incomplete *tables.NotCompleteError
	if _, err := h.sessions.Close(ctx, tables.Scope{OrganizationID: h.f.Org, VenueID: h.f.Venue}, s.ID, 1, tables.Actor{StaffID: h.f.Cashier, Role: "cashier"}); !errors.As(err, &incomplete) || incomplete.Readiness.UnbilledLines != 2 {
		t.Fatalf("close with unbilled rounds: %v", err)
	}
	// ...so this test ends the visit directly (the gated close is tested in
	// visit_close_test.go). After the visit ends: no new orders or rounds.
	h.endVisit(t, s.ID)
	var ended *orders.SessionNotOpenError
	if _, _, err := h.orders.Create(ctx, h.dineIn(s.ID, line(h.f.Plain, 1))); !errors.As(err, &ended) || ended.Status != "closed" {
		t.Errorf("order on a closed session: %v", err)
	}
	if _, _, err := h.orders.SubmitRound(ctx, orders.RoundCommand{Scope: h.scope(), OrderID: o.ID, RequestKey: key(),
		Lines: []orders.LineInput{line(h.f.Plain, 1)}, Actor: h.waiter()}); !errors.As(err, &ended) {
		t.Errorf("round on a closed session: %v", err)
	}
	// The table can be seated again: a session-bound order is not legacy occupancy.
	if _, _, err := h.sessions.Open(ctx, tables.OpenCommand{Scope: tables.Scope{OrganizationID: h.f.Org, VenueID: h.f.Venue},
		TableID: h.f.TableA, Covers: 3, RequestKey: key(), Actor: tables.Actor{StaffID: h.f.Cashier, Role: "cashier"}}); err != nil {
		t.Errorf("reseat after close: %v", err)
	}
	// Scope: another venue's session or order does not exist for this venue.
	other := h.scope()
	other.Venue.ID = h.f.TaxlessVenue
	if _, err := h.orders.Get(ctx, other, o.ID); !errors.Is(err, orders.ErrOrderNotFound) {
		t.Errorf("order through another venue: %v", err)
	}
	if _, _, err := h.orders.Create(ctx, orders.CreateCommand{Scope: other, Source: orders.SourceWaiterTablet, ServiceMode: orders.ServiceDineIn,
		TableSessionID: &s.ID, Lines: []orders.LineInput{line(h.f.Plain, 1)}, IdempotencyKey: key(), Actor: h.waiter()}); !errors.Is(err, orders.ErrTableSessionNotFound) {
		t.Errorf("session through another venue: %v", err)
	}
	// Takeaway orders take no rounds.
	ta, _, err := h.orders.Create(ctx, orders.CreateCommand{Scope: h.scope(), Source: orders.SourcePOSTerminal, ServiceMode: orders.ServiceTakeaway,
		Lines: []orders.LineInput{line(h.f.Plain, 1)}, IdempotencyKey: key(), Actor: orders.Actor{StaffID: h.f.Owner, Role: "owner"}})
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err := h.orders.SubmitRound(ctx, orders.RoundCommand{Scope: h.scope(), OrderID: ta.ID, RequestKey: key(),
		Lines: []orders.LineInput{line(h.f.Plain, 1)}, Actor: h.waiter()}); !errors.Is(err, orders.ErrNotTableService) {
		t.Errorf("round on takeaway: %v", err)
	}
}

func TestOrderSchemaInvariants(t *testing.T) {
	h := ordersSetup(t)
	ctx := context.Background()
	s := h.openSession(t, h.f.TableA)
	insert := func(table, session, mode, status string) error {
		id := "ORD-T-" + testsupport.UUID()[:8]
		_, err := h.writer.Exec(ctx, `INSERT INTO "Order"(id,"venueId","tableId","tableSessionId","serviceMode",status,"subtotalCents","totalCents","idempotencyKey","updatedAt")
			VALUES($1,$2,$3,$4,$5::"ServiceMode",$6::"OrderStatus",0,0,$1,now())`, id, h.f.Venue, table, session, mode, status)
		return err
	}
	if err := insert(h.f.TableA, s.ID, "dine_in", "confirmed"); err != nil {
		t.Fatalf("valid session order: %v", err)
	}
	for _, c := range []struct {
		name, code, constraint string
		err                    error
	}{
		{"order on another table than its session's", "23503", "Order_tableSessionId_tableId_fkey", insert(h.f.TableB, s.ID, "dine_in", "completed")},
		{"session order that is not dine-in", "23514", "Order_table_session_is_dine_in", insert(h.f.TableA, s.ID, "takeaway", "cancelled")},
	} {
		if code, constraint := pgCode(c.err); code != c.code || constraint != c.constraint {
			t.Errorf("%s: %s %s (%v)", c.name, code, constraint, c.err)
		}
	}
	// A visit may hold several orders, active or not: occupancy is the
	// session's, so the database sets no per-session order limit.
	for _, status := range []string{"pending", "confirmed", "completed"} {
		if err := insert(h.f.TableA, s.ID, "dine_in", status); err != nil {
			t.Errorf("a further %s order on the session: %v", status, err)
		}
	}
	var orderID string
	_ = h.writer.QueryRow(ctx, `SELECT id FROM "Order" WHERE "tableSessionId" = $1 AND status = 'confirmed'`, s.ID).Scan(&orderID)
	round := func(seq int, k string) error {
		_, err := h.writer.Exec(ctx, `INSERT INTO "OrderRound"(id,"orderId",sequence,"requestKey") VALUES($1,$2,$3,$4)`, testsupport.UUID(), orderID, seq, k)
		return err
	}
	k := key()
	if err := round(1, k); err != nil {
		t.Fatal(err)
	}
	for _, c := range []struct {
		name, code, constraint string
		err                    error
	}{
		{"duplicate sequence", "23505", "OrderRound_orderId_sequence_key", round(1, key())},
		{"duplicate round key", "23505", "OrderRound_orderId_requestKey_key", round(2, k)},
		{"sequence 0", "23514", "OrderRound_sequence_positive", round(0, key())},
		{"short round key", "23514", "OrderRound_request_key_length", round(3, "short")},
	} {
		if code, constraint := pgCode(c.err); code != c.code || constraint != c.constraint {
			t.Errorf("%s: %s %s (%v)", c.name, code, constraint, c.err)
		}
	}
	// A session with orders cannot be deleted from under them.
	if _, err := h.writer.Exec(ctx, `DELETE FROM "TableSession" WHERE id = $1`, s.ID); err == nil {
		t.Error("deleting a session with orders must fail")
	}
}

func race(n int, do func(i int)) {
	var wg sync.WaitGroup
	start := make(chan struct{})
	for i := 0; i < n; i++ {
		wg.Add(1)
		go func(i int) { defer wg.Done(); <-start; do(i) }(i)
	}
	close(start)
	wg.Wait()
}

// 24 identical creates at once: one order, every caller gets it.
func TestConcurrentIdenticalCreatesMakeOneOrder(t *testing.T) {
	h := ordersSetup(t)
	cmd := h.dineIn(h.openSession(t, h.f.TableA).ID, line(h.f.Burger, 1, [2]string{h.f.Size, h.f.Large}))
	const n = 24
	ids, created, errs := make([]string, n), make([]bool, n), make([]error, n)
	race(n, func(i int) {
		var o orders.Order
		o, created[i], errs[i] = h.orders.Create(context.Background(), cmd)
		ids[i] = o.ID
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
	if creators != 1 || h.count(t, `SELECT count(*) FROM "Order" WHERE "idempotencyKey" = $1`, cmd.IdempotencyKey) != 1 ||
		h.count(t, `SELECT count(*) FROM "OrderItem" WHERE "orderId" = $1`, ids[0]) != 1 {
		t.Errorf("%d creators; want exactly one order with one line", creators)
	}
}

// Same key, two different carts, at once: exactly one order; callers with
// the winner's cart get it back, the others a deterministic conflict.
func TestConcurrentConflictingCreatesHaveOneWinner(t *testing.T) {
	h := ordersSetup(t)
	session := h.openSession(t, h.f.TableA).ID
	a := h.dineIn(session, line(h.f.Plain, 1))
	b := a
	b.Lines = []orders.LineInput{line(h.f.Odd, 1)}
	const n = 24
	ids, errs := make([]string, n), make([]error, n)
	race(n, func(i int) {
		cmd := map[bool]orders.CreateCommand{true: a, false: b}[i%2 == 0]
		o, _, err := h.orders.Create(context.Background(), cmd)
		ids[i], errs[i] = o.ID, err
	})
	var winner string
	_ = h.writer.QueryRow(context.Background(), `SELECT id FROM "Order" WHERE "idempotencyKey" = $1`, a.IdempotencyKey).Scan(&winner)
	var winnerItem string
	_ = h.writer.QueryRow(context.Background(), `SELECT "menuItemId" FROM "OrderItem" WHERE "orderId" = $1`, winner).Scan(&winnerItem)
	for i := range ids {
		sameCart := (i%2 == 0) == (winnerItem == h.f.Plain)
		var conflict *orders.IdempotencyConflictError
		switch {
		case sameCart && (errs[i] != nil || ids[i] != winner):
			t.Errorf("caller %d with the winning cart: %q %v", i, ids[i], errs[i])
		case !sameCart && (!errors.As(errs[i], &conflict) || conflict.OrderID != winner):
			t.Errorf("caller %d with the other cart: %v", i, errs[i])
		}
	}
	if n := h.count(t, `SELECT count(*) FROM "Order" WHERE "idempotencyKey" = $1`, a.IdempotencyKey); n != 1 {
		t.Errorf("%d orders for one key", n)
	}
}

// One visit, several canonical orders: e.g. the waiter's order and a guest's
// Order Tablet order, each with its own rounds and totals. Not a
// client-specific model: both are the same Order type.
func TestMultipleOrdersPerSession(t *testing.T) {
	h := ordersSetup(t)
	ctx := context.Background()
	s := h.openSession(t, h.f.TableA)

	waiter, _, err := h.orders.Create(ctx, h.dineIn(s.ID, line(h.f.Burger, 1, [2]string{h.f.Size, h.f.Large})))
	if err != nil {
		t.Fatal(err)
	}
	guestCmd := h.dineIn(s.ID, line(h.f.Plain, 2))
	guestCmd.Source = orders.SourceOrderTablet
	guest, created, err := h.orders.Create(ctx, guestCmd)
	if err != nil || !created || guest.ID == waiter.ID {
		t.Fatalf("second order on the visit: %+v %v", guest, err)
	}
	for _, o := range []orders.Order{waiter, guest} {
		if *o.TableSessionID != s.ID || *o.TableID != h.f.TableA || o.Status != orders.StatusConfirmed {
			t.Errorf("order %s binding %+v", o.ID, o)
		}
	}
	// Rounds stay with their own order.
	for _, c := range []struct {
		order  string
		item   string
		wantTo int64
	}{{waiter.ID, h.f.Plain, 2050 + 550}, {guest.ID, h.f.Odd, 1100 + 1999}} {
		o, _, err := h.orders.SubmitRound(ctx, orders.RoundCommand{Scope: h.scope(), OrderID: c.order, RequestKey: key(),
			Lines: []orders.LineInput{line(c.item, 1)}, Actor: h.waiter()})
		if err != nil || len(o.Rounds) != 2 || o.TotalCents != c.wantTo {
			t.Errorf("round on %s: %+v %v", c.order, o, err)
		}
	}
	if n := h.count(t, `SELECT count(*) FROM "Order" WHERE "tableSessionId" = $1`, s.ID); n != 2 {
		t.Errorf("%d orders on the visit, want 2", n)
	}
	// Idempotency still tells them apart: replaying the guest's request
	// returns the guest's order, never a third.
	if again, created, err := h.orders.Create(ctx, guestCmd); err != nil || created || again.ID != guest.ID {
		t.Errorf("guest replay: %v %v", created, err)
	}

	// 24 distinct orders at once on one open session: all accepted. Nothing
	// caps orders per visit; duplicates are what idempotency keys prevent.
	const n = 24
	errs := make([]error, n)
	race(n, func(i int) {
		_, _, errs[i] = h.orders.Create(ctx, h.dineIn(s.ID, line(h.f.Penny, 1)))
	})
	for i, err := range errs {
		if err != nil {
			t.Errorf("concurrent order %d: %v", i, err)
		}
	}
	if got := h.count(t, `SELECT count(*) FROM "Order" WHERE "tableSessionId" = $1`, s.ID); got != 2+n {
		t.Errorf("%d orders on the visit, want %d", got, 2+n)
	}
}

// 24 rounds at once: all land, numbered 2..25 without gaps, totals exact.
func TestConcurrentRoundsAreNumberedAndTotalledExactly(t *testing.T) {
	h := ordersSetup(t)
	ctx := context.Background()
	o, _, err := h.orders.Create(ctx, h.dineIn(h.openSession(t, h.f.TableA).ID, line(h.f.Plain, 1)))
	if err != nil {
		t.Fatal(err)
	}
	const n = 24
	errs := make([]error, n)
	race(n, func(i int) {
		_, _, errs[i] = h.orders.SubmitRound(ctx, orders.RoundCommand{Scope: h.scope(), OrderID: o.ID, RequestKey: key(),
			Lines: []orders.LineInput{line(h.f.Four, int64(i+1))}, Actor: h.waiter()})
	})
	for i, err := range errs {
		if err != nil {
			t.Errorf("round %d: %v", i, err)
		}
	}
	final, err := h.orders.Get(ctx, h.scope(), o.ID)
	if err != nil {
		t.Fatal(err)
	}
	for i, r := range final.Rounds {
		if r.Sequence != i+1 {
			t.Fatalf("round sequences %v", final.Rounds)
		}
	}
	// 550 + 4 x (1 + 2 + ... + 24) = 550 + 1200 = 1750; GST round(1750 x 3/23) = 228.
	if len(final.Rounds) != n+1 || final.SubtotalCents != 1750 || final.TotalCents != 1750 || final.TaxCents != 228 {
		t.Errorf("%d rounds, totals %d/%d/%d", len(final.Rounds), final.SubtotalCents, final.TaxCents, final.TotalCents)
	}
	if got := h.count(t, `SELECT count(*) FROM "DomainEvent" WHERE "aggregateId" = $1 AND "eventType" = 'order.round_submitted'`, o.ID); got != n+1 {
		t.Errorf("%d round events", got)
	}
	// The same round request many times at once: one round.
	rk := key()
	race(n, func(i int) {
		_, _, errs[i] = h.orders.SubmitRound(ctx, orders.RoundCommand{Scope: h.scope(), OrderID: o.ID, RequestKey: rk,
			Lines: []orders.LineInput{line(h.f.Penny, 1)}, Actor: h.waiter()})
	})
	for i, err := range errs {
		if err != nil {
			t.Errorf("retry %d: %v", i, err)
		}
	}
	if got := h.count(t, `SELECT count(*) FROM "OrderRound" WHERE "orderId" = $1 AND "requestKey" = $2`, o.ID, rk); got != 1 {
		t.Errorf("%d rounds for one key", got)
	}
}

// An order and the session's close race: never an order created on a
// session after it closed.
func TestCreateVersusSessionClose(t *testing.T) {
	h := ordersSetup(t)
	ctx := context.Background()
	sc := tables.Scope{OrganizationID: h.f.Org, VenueID: h.f.Venue}
	actor := tables.Actor{StaffID: h.f.Cashier, Role: "cashier"}
	created, refused := 0, 0
	for round := 0; round < 20; round++ {
		s := h.openSession(t, h.f.TableB)
		var createErr, closeErr error
		race(2, func(i int) {
			if i == 0 {
				_, _, createErr = h.orders.Create(ctx, h.dineIn(s.ID, line(h.f.Plain, 1)))
			} else {
				// Vary when the close lands, so both orders of events occur.
				time.Sleep(time.Duration(round%5) * 2 * time.Millisecond)
				_, closeErr = h.sessions.Close(ctx, sc, s.ID, 1, actor)
			}
		})
		// Phase D10: either the order commits first and the close, which
		// counts its unbilled lines, is refused; or the close commits first
		// (the visit is still empty, so complete) and the order is refused.
		var ended *orders.SessionNotOpenError
		var incomplete *tables.NotCompleteError
		switch {
		case createErr == nil:
			created++
			if !errors.As(closeErr, &incomplete) || incomplete.Readiness.UnbilledLines != 1 ||
				h.count(t, `SELECT count(*) FROM "TableSession" WHERE id = $1 AND status = 'open'`, s.ID) != 1 {
				t.Errorf("round %d: order won but close: %v", round, closeErr)
			}
			h.endVisit(t, s.ID) // free the table for the next round
		case errors.As(createErr, &ended):
			refused++
			if closeErr != nil || h.count(t, `SELECT count(*) FROM "Order" WHERE "tableSessionId" = $1`, s.ID) != 0 {
				t.Errorf("round %d: close won (%v), yet an order exists", round, closeErr)
			}
		default:
			t.Errorf("round %d create: %v", round, createErr)
		}
	}
	t.Logf("create won %d times, close won %d times", created, refused)
}

// The order API end to end on the real database, validated against
// contracts/openapi/servvia-orders.yaml.
func TestOrderAPIAgainstPostgres(t *testing.T) {
	h := ordersSetup(t)
	url := testsupport.DisposableDatabaseURL(t)
	pool, err := postgres.NewPool(context.Background(), postgres.Options{URL: url, MaxConns: 8})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	const secret = "integration-secret-0123456789abcdef"
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	venueStore := venues.NewPostgresStore(pool)
	routes := server.Routes(server.Deps{
		Logger: logger, Health: health.New(pool, time.Second),
		Menu:          menu.NewHandler(menu.NewPostgresStore(pool), logger),
		Venues:        venues.NewHandler(venueStore, logger),
		TableSessions: tablesapi.NewHandler(tables.NewService(tablestore.New(pool), true), venueStore, logger),
		Orders:        ordersapi.NewHandler(h.orders, venueStore, logger),
		Verifier:      identity.NewVerifier(secret), TabletDevices: identity.NewPostgresTabletDevices(pool), VenueGrants: identity.NewPostgresVenueGrants(pool), StaffSessions: admitStaff,
		RateLimiter: ratelimit.New(admitAll{}, 0, logger),
	})
	token, _ := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"sub": h.f.Cashier, "email": "waiter@example.test", "role": "cashier", "organizationId": h.f.Org,
		"sid": testsupport.UUID(), "exp": time.Now().Add(time.Minute).Unix(),
	}).SignedString([]byte(secret))
	call := func(method, path string, body any) (int, map[string]any, []byte) {
		raw, _ := json.Marshal(body)
		req := httptest.NewRequest(method, "/api/venues/"+h.f.Venue+path, strings.NewReader(string(raw)))
		req.Header.Set("Authorization", "Bearer "+token)
		rec := httptest.NewRecorder()
		routes.ServeHTTP(rec, req)
		var m map[string]any
		_ = json.Unmarshal(rec.Body.Bytes(), &m)
		return rec.Code, m, rec.Body.Bytes()
	}
	schema := func(name string) func([]byte) {
		s := testsupport.Schema(t, "openapi/servvia-orders.yaml", "/components/schemas/"+name)
		return func(b []byte) { t.Helper(); testsupport.Validate(t, s, b) }
	}
	order, stale, coded := schema("Order"), schema("StalePriceError"), schema("CodedError")

	status, session, body := call("POST", "/tables/"+h.f.TableC+"/sessions", map[string]any{"covers": 4, "idempotencyKey": key()})
	if status != 201 {
		t.Fatalf("open session: %d %s", status, body)
	}
	create := map[string]any{"source": "pos_terminal", "serviceMode": "dine_in", "tableSessionId": session["id"],
		"idempotencyKey": key(), "items": []map[string]any{
			{"menuItemId": h.f.Burger, "quantity": 1, "expectedUnitPriceCents": 2050,
				"selectedModifiers": []map[string]any{{"modifierGroupId": h.f.Size, "optionId": h.f.Large}}},
			{"menuItemId": h.f.Plain, "quantity": 2, "notes": "oat milk", "seat": 2}}}
	status, created, body := call("POST", "/orders", create)
	if status != 201 || created["tableId"] != h.f.TableC || created["tableNumber"] != "3" || created["totalCents"] != 3150.0 {
		t.Fatalf("create: %d %s", status, body)
	}
	order(body)
	if status, again, body := call("POST", "/orders", create); status != 200 || again["id"] != created["id"] {
		t.Errorf("replay: %d %s", status, body)
	}
	id := created["id"].(string)
	status, rounded, body := call("POST", "/orders/"+id+"/rounds", map[string]any{"idempotencyKey": key(),
		"items": []map[string]any{{"menuItemId": h.f.Odd, "quantity": 1}}})
	if status != 201 || len(rounded["rounds"].([]any)) != 2 || rounded["totalCents"] != 5149.0 {
		t.Fatalf("round: %d %s", status, body)
	}
	order(body)
	if status, got, body := call("GET", "/orders/"+id, nil); status != 200 || got["totalCents"] != 5149.0 {
		t.Errorf("get: %d %s", status, body)
	}

	create["idempotencyKey"] = key()
	create["items"].([]map[string]any)[0]["expectedUnitPriceCents"] = 1800
	status, _, body = call("POST", "/orders", create)
	if status != 409 {
		t.Fatalf("stale price: %d %s", status, body)
	}
	stale(body)
	delete(create["items"].([]map[string]any)[0], "expectedUnitPriceCents")
	// A second, different order on the same visit is accepted.
	create["idempotencyKey"] = key()
	status, second, body := call("POST", "/orders", create)
	if status != 201 || second["id"] == id || second["tableSessionId"] != session["id"] {
		t.Errorf("second order on the visit: %d %s", status, body)
	}
	order(body)
	var conflict map[string]any
	create["serviceMode"], create["tableSessionId"] = "takeaway", nil
	delete(create, "tableSessionId")
	create["idempotencyKey"] = created["idempotencyKey"]
	status, conflict, body = call("POST", "/orders", create)
	if status != 409 || conflict["code"] != "IDEMPOTENCY_CONFLICT" || conflict["orderId"] != id {
		t.Errorf("key reuse: %d %s", status, body)
	}
	coded(body)
}
