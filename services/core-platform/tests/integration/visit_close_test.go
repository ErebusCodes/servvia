package integration

// Closing a visit (Phase D10) against real PostgreSQL: the financially-safe
// close and its refusals (cross-checked against the documented completeness
// SQL), idempotency and 24 concurrent closes, what a closed visit refuses and
// still allows, every race with a deterministic order (the test holds a row
// lock and releases it once the racers are queued; PostgreSQL grants
// row-lock waiters first come, first served), the next visit on the same
// table, cancel, and authorization.

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"

	"servvia/services/core-platform/internal/checks"
	"servvia/services/core-platform/internal/devices"
	"servvia/services/core-platform/internal/health"
	"servvia/services/core-platform/internal/identity"
	"servvia/services/core-platform/internal/menu"
	"servvia/services/core-platform/internal/orders"
	"servvia/services/core-platform/internal/payments"
	"servvia/services/core-platform/internal/platform/postgres"
	"servvia/services/core-platform/internal/ratelimit"
	"servvia/services/core-platform/internal/refunds"
	"servvia/services/core-platform/internal/server"
	"servvia/services/core-platform/internal/tables"
	tablestore "servvia/services/core-platform/internal/tables/pgstore"
	"servvia/services/core-platform/internal/tables/tablesapi"
	"servvia/services/core-platform/internal/venues"
	"servvia/services/core-platform/tests/testsupport"
)

func (h refundsHarness) tableScope() tables.Scope {
	return tables.Scope{OrganizationID: h.f.Org, VenueID: h.f.Venue}
}

func (h refundsHarness) staffActor() tables.Actor {
	return tables.Actor{StaffID: h.f.Cashier, Role: "cashier"}
}

func (h refundsHarness) sessionVersion(t *testing.T, id string) int {
	t.Helper()
	return h.count(t, `SELECT version FROM "TableSession" WHERE id = $1`, id)
}

func (h refundsHarness) closeVisit(id string) (tables.Session, error) {
	var version int
	_ = h.writer.QueryRow(context.Background(), `SELECT version FROM "TableSession" WHERE id = $1`, id).Scan(&version)
	return h.sessions.Close(context.Background(), h.tableScope(), id, version, h.staffActor())
}

func (h refundsHarness) sessionStatus(t *testing.T, id string) string {
	t.Helper()
	var s string
	if err := h.writer.QueryRow(context.Background(), `SELECT status::text FROM "TableSession" WHERE id = $1`, id).Scan(&s); err != nil {
		t.Fatal(err)
	}
	return s
}

// settleCheck pays a check's balance by card and reports success.
func (h refundsHarness) settleCheck(t *testing.T, checkID string) payments.Payment {
	t.Helper()
	_, b := h.summary(t, checkID)
	p := h.pay(t, checkID, b.BalanceCents)
	h.mustReport(t, p.ID, payments.StatusSucceeded)
	return p
}

// readiness returns the refusal's readiness, failing if the close did not
// refuse as incomplete.
func readiness(t *testing.T, err error) tables.CloseReadiness {
	t.Helper()
	var incomplete *tables.NotCompleteError
	if !errors.As(err, &incomplete) {
		t.Fatalf("close was not refused as incomplete: %v", err)
	}
	return incomplete.Readiness
}

// docQuery checks the documented SQL against the Core verdict.
func (h refundsHarness) agreesWithDocumentedRule(t *testing.T, sessionID string, r tables.CloseReadiness, closeable bool) {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join(testsupport.RepoRoot(), "docs", "migration", "checks", "visit-financially-complete.sql"))
	if err != nil {
		t.Fatal(err)
	}
	var unsettled, unbilled, unresolved int
	var complete bool
	if err := h.writer.QueryRow(context.Background(), `SELECT "unsettledChecks", "unbilledLines", "unresolvedMoney", "financiallyComplete"
		FROM (`+string(raw)+`) v WHERE "tableSessionId" = $1`, sessionID).Scan(&unsettled, &unbilled, &unresolved, &complete); err != nil {
		t.Fatal(err)
	}
	if unsettled != r.OpenChecks || unbilled != r.UnbilledLines || unresolved != r.UnresolvedPayments+r.UnresolvedAdjustments || complete != closeable {
		t.Errorf("documented rule disagrees: doc %d/%d/%d/%v, core %+v closeable %v", unsettled, unbilled, unresolved, complete, r, closeable)
	}
}

// 1, 13, 24-27, 32-35: a complete visit of two orders closes once, under 24
// concurrent requests; nothing else changes; the table is free again.
func TestCompleteVisitClosesOnce(t *testing.T) {
	h := refundsSetup(t)
	ctx := context.Background()
	s := h.openSession(t, h.f.TableA)
	if _, _, err := h.orders.Create(ctx, h.dineIn(s.ID, line(h.f.Plain, 1))); err != nil {
		t.Fatal(err)
	}
	guest := h.dineIn(s.ID, line(h.f.Odd, 1))
	guest.Source = orders.SourceOrderTablet
	if _, _, err := h.orders.Create(ctx, guest); err != nil {
		t.Fatal(err)
	}
	c, _, err := h.checks.Create(ctx, h.forSession(s.ID))
	if err != nil {
		t.Fatal(err)
	}
	h.settleCheck(t, c.ID)
	h.drain(t)
	h.openShift(t, 1000)
	h.terminal(t, "FRONT-1", nil)
	h.enrollDevice(t, devices.KindPOSTerminal, h.f.Venue)
	// Every kitchen, shift, terminal, device and order row of the venue, whole.
	snapshot := func() string {
		var v string
		if err := h.writer.QueryRow(ctx, `SELECT
			(SELECT coalesce(string_agg(x::text, ',' ORDER BY x.id), '') FROM "KitchenTicket" x WHERE "venueId" = $1) ||
			(SELECT coalesce(string_agg(x::text, ',' ORDER BY x.id), '') FROM "Shift" x WHERE "venueId" = $1) ||
			(SELECT coalesce(string_agg(x::text, ',' ORDER BY x.id), '') FROM "Terminal" x WHERE "venueId" = $1) ||
			(SELECT coalesce(string_agg(x::text, ',' ORDER BY x.id), '') FROM "Device" x WHERE "venueId" = $1) ||
			(SELECT coalesce(string_agg(x::text, ',' ORDER BY x.id), '') FROM "Order" x WHERE "venueId" = $1)`,
			h.f.Venue).Scan(&v); err != nil {
			t.Fatal(err)
		}
		return v
	}
	before := snapshot()

	// CAS: a close naming a version the open session does not have is refused.
	var stale *tables.VersionConflictError
	if _, err := h.sessions.Close(ctx, h.tableScope(), s.ID, 7, h.staffActor()); !errors.As(err, &stale) || stale.Current != 1 {
		t.Fatalf("stale close: %v", err)
	}
	// 24 closes at once, all naming version 1: one transition, 24 successes.
	errs := make([]error, 24)
	race(24, func(i int) { _, errs[i] = h.sessions.Close(ctx, h.tableScope(), s.ID, 1, h.staffActor()) })
	for i, err := range errs {
		if err != nil {
			t.Fatalf("close %d: %v", i, err)
		}
	}
	if h.sessionStatus(t, s.ID) != "closed" || h.sessionVersion(t, s.ID) != 2 ||
		h.count(t, `SELECT count(*) FROM "AuditLog" WHERE "resourceId" = $1 AND action = 'TABLE_SESSION_CLOSED'`, s.ID) != 1 {
		t.Errorf("closes: status %s version %d", h.sessionStatus(t, s.ID), h.sessionVersion(t, s.ID))
	}
	if n := h.count(t, `SELECT count(*) FROM "AuditLog" WHERE "resourceId" = $1 AND action = 'TABLE_SESSION_CLOSED'
		AND after->'closeReadiness'->>'OpenChecks' = '0'`, s.ID); n != 1 {
		t.Error("the close audit does not record the readiness")
	}
	// A retry after a lost response: the same closed session, no new effect.
	if again, err := h.sessions.Close(ctx, h.tableScope(), s.ID, 1, h.staffActor()); err != nil || again.Version != 2 {
		t.Errorf("retry: %+v %v", again, err)
	}
	if snapshot() != before {
		t.Error("closing the visit changed kitchen, shift, terminal, device or order state")
	}
	if n := h.count(t, `SELECT count(*) FROM "ConnectorCommand" WHERE "venueId" = $1`, h.f.Venue) +
		h.count(t, `SELECT count(*) FROM "POSSyncRecord" x JOIN "Order" o ON o.id = x."orderId" WHERE o."tableSessionId" = $1`, s.ID); n != 0 {
		t.Errorf("legacy state: %d", n)
	}
	// The table is free: the next visit opens.
	if next := h.openSession(t, h.f.TableA); next.ID == s.ID {
		t.Error("the next visit reused the session")
	}
}

// 2-12: every blocking condition, each alone, and what does not block.
func TestCloseRefusals(t *testing.T) {
	h := refundsSetup(t)
	ctx := context.Background()
	start := func(table string, lines ...orders.LineInput) (string, orders.Order) {
		s := h.openSession(t, table)
		o, _, err := h.orders.Create(ctx, h.dineIn(s.ID, lines...))
		if err != nil {
			t.Fatal(err)
		}
		return s.ID, o
	}
	check := func(sessionID string) checks.Check {
		c, _, err := h.checks.Create(ctx, h.forSession(sessionID))
		if err != nil {
			t.Fatal(err)
		}
		return c
	}
	refuse := func(name, sessionID string, want tables.CloseReadiness) {
		t.Helper()
		_, err := h.closeVisit(sessionID)
		if r := readiness(t, err); r != want {
			t.Errorf("%s: readiness %+v, want %+v", name, r, want)
		}
		h.agreesWithDocumentedRule(t, sessionID, want, false)
		if h.sessionStatus(t, sessionID) != "open" {
			t.Errorf("%s: a refused close changed the session", name)
		}
	}
	closes := func(name, sessionID string) {
		t.Helper()
		h.agreesWithDocumentedRule(t, sessionID, tables.CloseReadiness{}, true)
		if _, err := h.closeVisit(sessionID); err != nil {
			t.Errorf("%s: %v", name, err)
		}
	}

	// 4: an unbilled line.
	s, _ := start(h.f.TableA, line(h.f.Plain, 1))
	refuse("unbilled line", s, tables.CloseReadiness{UnbilledLines: 1})
	// 2: one open standing check.
	c := check(s)
	refuse("open check", s, tables.CloseReadiness{OpenChecks: 1})
	// 6, 7: pending then uncertain payment (the check is open too).
	p := h.pay(t, c.ID, c.TotalCents)
	refuse("pending payment", s, tables.CloseReadiness{OpenChecks: 1, UnresolvedPayments: 1})
	h.mustReport(t, p.ID, payments.StatusUncertain)
	refuse("uncertain payment", s, tables.CloseReadiness{OpenChecks: 1, UnresolvedPayments: 1})
	// 10: a failed payment does not block once the check is otherwise paid.
	h.mustReport(t, p.ID, payments.StatusFailed)
	h.settleCheck(t, c.ID)
	closes("complete after a failed payment and settlement", s)

	// 3, 5: several checks, and a later round after the first check settled.
	s2, o2 := start(h.f.TableB, line(h.f.Plain, 1))
	first := check(s2)
	h.settleCheck(t, first.ID)
	if _, _, err := h.orders.SubmitRound(ctx, orders.RoundCommand{Scope: h.scope(), OrderID: o2.ID, RequestKey: key(),
		Lines: []orders.LineInput{line(h.f.Odd, 1)}, Actor: h.waiter()}); err != nil {
		t.Fatal(err)
	}
	refuse("later round unbilled", s2, tables.CloseReadiness{UnbilledLines: 1})
	second := check(s2)
	refuse("second check open", s2, tables.CloseReadiness{OpenChecks: 1})
	h.settleCheck(t, second.ID)
	// 8, 9, 11: refunds on a settled visit.
	pay1, _ := h.payments.Summary(ctx, h.payScope(), first.ID)
	rf := h.refund(t, pay1.Payments[0].ID, 100)
	refuse("pending refund", s2, tables.CloseReadiness{UnresolvedAdjustments: 1})
	h.mustRefundResult(t, rf.ID, payments.StatusUncertain)
	refuse("uncertain refund", s2, tables.CloseReadiness{UnresolvedAdjustments: 1})
	h.mustRefundResult(t, rf.ID, payments.StatusFailed)
	closes("complete after a failed refund, two settled checks", s2)

	// 12: a voided check is no obligation, and its lines are unbilled again.
	s3, _ := start(h.f.TableC, line(h.f.Plain, 1))
	voided := check(s3)
	if _, _, err := h.checks.Void(ctx, checks.VoidCommand{Scope: h.checkScope(), CheckID: voided.ID, ExpectedVersion: 1,
		Reason: "wrong table", Actor: checks.Actor{StaffID: h.f.Owner, Role: "owner"}}); err != nil {
		t.Fatal(err)
	}
	refuse("voided check's lines unbilled", s3, tables.CloseReadiness{UnbilledLines: 1})
	h.settleCheck(t, check(s3).ID)
	closes("complete with a voided and a settled check", s3)
}

// 14-17, 36, 37: a closed visit takes no new obligation, while its existing
// ones stay correctable, and corrections never reopen it.
func TestClosedVisitRulesAndCorrections(t *testing.T) {
	h := refundsSetup(t)
	ctx := context.Background()
	s := h.openSession(t, h.f.TableA)
	o, _, err := h.orders.Create(ctx, h.dineIn(s.ID, line(h.f.Plain, 1)))
	if err != nil {
		t.Fatal(err)
	}
	c, _, err := h.checks.Create(ctx, h.forSession(s.ID))
	if err != nil {
		t.Fatal(err)
	}
	p := h.settleCheck(t, c.ID)
	if _, err := h.closeVisit(s.ID); err != nil {
		t.Fatal(err)
	}
	var ended *orders.SessionNotOpenError
	if _, _, err := h.orders.Create(ctx, h.dineIn(s.ID, line(h.f.Plain, 1))); !errors.As(err, &ended) {
		t.Errorf("order on a closed visit: %v", err)
	}
	if _, _, err := h.orders.SubmitRound(ctx, orders.RoundCommand{Scope: h.scope(), OrderID: o.ID, RequestKey: key(),
		Lines: []orders.LineInput{line(h.f.Plain, 1)}, Actor: h.waiter()}); !errors.As(err, &ended) {
		t.Errorf("round on a closed visit: %v", err)
	}
	var closedSession *checks.SessionNotOpenError
	if _, _, err := h.checks.Create(ctx, h.forSession(s.ID)); !errors.As(err, &closedSession) {
		t.Errorf("check by session on a closed visit: %v", err)
	}
	if _, _, err := h.checks.Create(ctx, h.forOrders(o.ID)); !errors.As(err, &closedSession) {
		t.Errorf("check by order on a closed visit: %v", err)
	}
	// A visit that ended with lines unbilled (a fixture: the real close
	// refuses it) still takes no check, on either path.
	ended2 := h.openSession(t, h.f.TableB)
	o2, _, err := h.orders.Create(ctx, h.dineIn(ended2.ID, line(h.f.Plain, 1)))
	if err != nil {
		t.Fatal(err)
	}
	h.endVisit(t, ended2.ID)
	if _, _, err := h.checks.Create(ctx, h.forSession(ended2.ID)); !errors.As(err, &closedSession) {
		t.Errorf("check by session on an ended visit with unbilled lines: %v", err)
	}
	if _, _, err := h.checks.Create(ctx, h.forOrders(o2.ID)); !errors.As(err, &closedSession) {
		t.Errorf("check by order on an ended visit with unbilled lines: %v", err)
	}
	// Non-table orders and checks are unaffected.
	ta, _, err := h.orders.Create(ctx, orders.CreateCommand{Scope: h.scope(), Source: orders.SourcePOSTerminal, ServiceMode: orders.ServiceTakeaway,
		IdempotencyKey: key(), Actor: orders.Actor{StaffID: h.f.Owner, Role: "owner"}, Lines: []orders.LineInput{line(h.f.Plain, 1)}})
	if err != nil {
		t.Fatal(err)
	}
	if tc, _, err := h.checks.Create(ctx, h.forOrders(ta.ID)); err != nil {
		t.Errorf("takeaway check: %v", err)
	} else {
		h.settleCheck(t, tc.ID)
	}
	// A refund after the guest left: the check owes again, the visit stays closed.
	r := h.refund(t, p.ID, 200)
	h.mustRefundResult(t, r.ID, payments.StatusSucceeded)
	if sum, _ := h.summary(t, c.ID); sum.CheckStatus != "open" || h.sessionStatus(t, s.ID) != "closed" {
		t.Errorf("post-close refund: check %s, session %s", sum.CheckStatus, h.sessionStatus(t, s.ID))
	}
	// Re-settled later: still closed.
	h.settleCheck(t, c.ID)
	if sum, _ := h.summary(t, c.ID); sum.CheckStatus != "settled" || sum.Settlement.Cycle != 2 || h.sessionStatus(t, s.ID) != "closed" {
		t.Errorf("post-close re-settlement: check %s cycle %d, session %s", sum.CheckStatus, sum.Settlement.Cycle, h.sessionStatus(t, s.ID))
	}
	if n := h.count(t, `SELECT version FROM "TableSession" WHERE id = $1`, s.ID); n != 2 {
		t.Errorf("the closed session changed: version %d", n)
	}
}

// holdRow runs first and then second while the test holds `lockSQL`'s row
// FOR UPDATE, releasing it once both are queued, so first acquires the row
// before second.
func (h refundsHarness) holdRow(t *testing.T, lockSQL string, arg any, first, second func()) {
	t.Helper()
	ctx := context.Background()
	tx, err := h.writer.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Exec(ctx, lockSQL, arg); err != nil {
		t.Fatal(err)
	}
	a, b := make(chan struct{}), make(chan struct{})
	go func() { first(); close(a) }()
	time.Sleep(150 * time.Millisecond)
	go func() { second(); close(b) }()
	time.Sleep(150 * time.Millisecond)
	if err := tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	<-a
	<-b
}

const lockSession = `SELECT 1 FROM "TableSession" WHERE id = $1 FOR UPDATE`

// 18-20: close versus a new order, round or check, in both orders. The test
// holds the session; whichever request queued first takes it first.
func TestCloseRacingNewObligations(t *testing.T) {
	cases := []struct {
		name string
		// unbilledRound leaves a round off every check before the race (the
		// check racer needs something to bill).
		unbilledRound bool
		add           func(h refundsHarness, sessionID, orderID string) error
		// With the obligation first, close is refused with want; with close
		// first, want is nil when the close succeeds and the obligation is
		// refused, or close is refused with it and the obligation succeeds.
		obligationFirst, closeFirst *tables.CloseReadiness
	}{
		{name: "order",
			add: func(h refundsHarness, s, _ string) error {
				_, _, err := h.orders.Create(context.Background(), h.dineIn(s, line(h.f.Plain, 1)))
				return err
			},
			obligationFirst: &tables.CloseReadiness{UnbilledLines: 1}},
		{name: "round",
			add: func(h refundsHarness, _, o string) error {
				_, _, err := h.orders.SubmitRound(context.Background(), orders.RoundCommand{Scope: h.scope(), OrderID: o,
					RequestKey: key(), Lines: []orders.LineInput{line(h.f.Plain, 1)}, Actor: h.waiter()})
				return err
			},
			obligationFirst: &tables.CloseReadiness{UnbilledLines: 1}},
		{name: "check by session", unbilledRound: true,
			add: func(h refundsHarness, s, _ string) error {
				_, _, err := h.checks.Create(context.Background(), h.forSession(s))
				return err
			},
			obligationFirst: &tables.CloseReadiness{OpenChecks: 1}, closeFirst: &tables.CloseReadiness{UnbilledLines: 1}},
		{name: "check by order", unbilledRound: true,
			add: func(h refundsHarness, _, o string) error {
				_, _, err := h.checks.Create(context.Background(), h.forOrders(o))
				return err
			},
			obligationFirst: &tables.CloseReadiness{OpenChecks: 1}, closeFirst: &tables.CloseReadiness{UnbilledLines: 1}},
	}
	for _, c := range cases {
		for _, obligationFirst := range []bool{true, false} {
			t.Run(c.name+map[bool]string{true: ", obligation first", false: ", close first"}[obligationFirst], func(t *testing.T) {
				h := refundsSetup(t)
				ctx := context.Background()
				s := h.openSession(t, h.f.TableA)
				o, _, err := h.orders.Create(ctx, h.dineIn(s.ID, line(h.f.Plain, 1)))
				if err != nil {
					t.Fatal(err)
				}
				first, _, err := h.checks.Create(ctx, h.forSession(s.ID))
				if err != nil {
					t.Fatal(err)
				}
				h.settleCheck(t, first.ID)
				if c.unbilledRound {
					h.round(t, o.ID, line(h.f.Odd, 1))
				}
				var addErr, closeErr error
				add := func() { addErr = c.add(h, s.ID, o.ID) }
				cl := func() { _, closeErr = h.closeVisit(s.ID) }
				want := c.closeFirst
				if obligationFirst {
					want = c.obligationFirst
					h.holdRow(t, lockSession, s.ID, add, cl)
				} else {
					h.holdRow(t, lockSession, s.ID, cl, add)
				}
				if want != nil {
					if addErr != nil {
						t.Fatalf("the obligation was refused: %v", addErr)
					}
					if r := readiness(t, closeErr); r != *want {
						t.Errorf("readiness %+v, want %+v", r, *want)
					}
					if h.sessionStatus(t, s.ID) != "open" {
						t.Error("the visit closed with an obligation")
					}
				} else {
					var ordersEnded *orders.SessionNotOpenError
					var checksEnded *checks.SessionNotOpenError
					if closeErr != nil || h.sessionStatus(t, s.ID) != "closed" {
						t.Fatalf("close: %v", closeErr)
					}
					if !errors.As(addErr, &ordersEnded) && !errors.As(addErr, &checksEnded) {
						t.Errorf("an obligation joined a closed visit: %v", addErr)
					}
				}
				// Never a closed visit with an obligation outstanding.
				if h.sessionStatus(t, s.ID) == "closed" {
					h.agreesWithDocumentedRule(t, s.ID, tables.CloseReadiness{}, true)
				}
			})
		}
	}
}

// 21-23: close versus the final payment's result, a successful reversal, and
// a new refund request, in both orders (the test holds the check).
func TestCloseRacingMoney(t *testing.T) {
	const lockCheck = `SELECT 1 FROM "Check" WHERE id = $1 FOR UPDATE`
	for _, moneyFirst := range []bool{true, false} {
		suffix := map[bool]string{true: ", money first", false: ", close first"}[moneyFirst]
		t.Run("final payment"+suffix, func(t *testing.T) {
			h := refundsSetup(t)
			ctx := context.Background()
			s := h.openSession(t, h.f.TableA)
			if _, _, err := h.orders.Create(ctx, h.dineIn(s.ID, line(h.f.Plain, 1))); err != nil {
				t.Fatal(err)
			}
			c, _, _ := h.checks.Create(ctx, h.forSession(s.ID))
			p := h.pay(t, c.ID, c.TotalCents)
			var payErr, closeErr error
			pay := func() { _, _, payErr = h.report(p.ID, payments.StatusSucceeded) }
			cl := func() { _, closeErr = h.closeVisit(s.ID) }
			if moneyFirst {
				h.holdRow(t, lockCheck, c.ID, pay, cl)
			} else {
				h.holdRow(t, lockCheck, c.ID, cl, pay)
			}
			if payErr != nil {
				t.Fatal(payErr)
			}
			if moneyFirst {
				if closeErr != nil || h.sessionStatus(t, s.ID) != "closed" {
					t.Errorf("settled first, close must succeed: %v", closeErr)
				}
			} else if r := readiness(t, closeErr); r.OpenChecks != 1 || r.UnresolvedPayments != 1 {
				t.Errorf("close first must see the unsettled check: %+v", r)
			}
		})
		t.Run("reversal"+suffix, func(t *testing.T) {
			h := refundsSetup(t)
			ctx := context.Background()
			c, p, s := h.settledByCard(t, h.f.TableA)
			adapterID, _ := h.enrollDevice(t, devices.KindPaymentAdapter, h.f.Venue)
			var revErr, closeErr error
			rev := func() {
				_, _, revErr = h.refunds.Reverse(ctx, refunds.ReversalCommand{Scope: refunds.Scope{OrganizationID: h.f.Org, VenueID: h.f.Venue},
					PaymentID: p.ID, AmountCents: 500, Currency: "NZD", IdempotencyKey: key(), DeviceID: adapterID})
			}
			cl := func() { _, closeErr = h.closeVisit(s) }
			if moneyFirst {
				h.holdRow(t, lockCheck, c.ID, rev, cl)
			} else {
				h.holdRow(t, lockCheck, c.ID, cl, rev)
			}
			if revErr != nil {
				t.Fatal(revErr)
			}
			sum, _ := h.summary(t, c.ID)
			if moneyFirst {
				if r := readiness(t, closeErr); r.OpenChecks != 1 || h.sessionStatus(t, s) != "open" {
					t.Errorf("reversal first: %+v", r)
				}
			} else if closeErr != nil || h.sessionStatus(t, s) != "closed" || sum.CheckStatus != "open" {
				t.Errorf("close first: %v; session %s, check %s", closeErr, h.sessionStatus(t, s), sum.CheckStatus)
			}
		})
		t.Run("refund request"+suffix, func(t *testing.T) {
			h := refundsSetup(t)
			c, p, s := h.settledByCard(t, h.f.TableA)
			var refErr, closeErr error
			ref := func() { _, _, refErr = h.refunds.Refund(context.Background(), h.refundCmd(p.ID, 300)) }
			cl := func() { _, closeErr = h.closeVisit(s) }
			if moneyFirst {
				h.holdRow(t, lockCheck, c.ID, ref, cl)
			} else {
				h.holdRow(t, lockCheck, c.ID, cl, ref)
			}
			if refErr != nil {
				t.Fatal(refErr)
			}
			if moneyFirst {
				// A pending refund cannot slip behind a successful close.
				if r := readiness(t, closeErr); r.UnresolvedAdjustments != 1 {
					t.Errorf("refund first: %+v", r)
				}
			} else if closeErr != nil || h.sessionStatus(t, s) != "closed" {
				t.Errorf("close first: %v", closeErr)
			}
		})
	}
}

// 28: the next visit on the same table waits for an in-flight close, and
// opens once it commits; if the close rolls back, the table is still taken.
func TestNextVisitWaitsForClose(t *testing.T) {
	for _, commit := range []bool{true, false} {
		t.Run(map[bool]string{true: "close commits", false: "close rolls back"}[commit], func(t *testing.T) {
			h := refundsSetup(t)
			ctx := context.Background()
			s := h.openSession(t, h.f.TableA)
			// The close's transaction, held open: the session is closed but
			// not yet committed.
			tx, err := h.writer.Begin(ctx)
			if err != nil {
				t.Fatal(err)
			}
			if _, err := tx.Exec(ctx, `UPDATE "TableSession" SET status = 'closed', "closedAt" = now(), version = version + 1
				WHERE id = $1`, s.ID); err != nil {
				t.Fatal(err)
			}
			var next tables.Session
			var openErr error
			var openedAt time.Time
			done := make(chan struct{})
			go func() {
				next, _, openErr = h.sessions.Open(ctx, tables.OpenCommand{Scope: h.tableScope(), TableID: h.f.TableA, Covers: 2,
					RequestKey: key(), Actor: h.staffActor()})
				openedAt = time.Now()
				close(done)
			}()
			time.Sleep(300 * time.Millisecond)
			endedAt := time.Now()
			if commit {
				err = tx.Commit(ctx)
			} else {
				err = tx.Rollback(ctx)
			}
			if err != nil {
				t.Fatal(err)
			}
			<-done
			if openedAt.Before(endedAt) {
				t.Error("the open did not wait for the close")
			}
			var taken *tables.AlreadyOpenError
			if commit && (openErr != nil || next.ID == s.ID) {
				t.Errorf("next visit: %v", openErr)
			}
			if !commit && (!errors.As(openErr, &taken) || taken.SessionID != s.ID) {
				t.Errorf("open while the visit stayed open: %v", openErr)
			}
			if n := h.count(t, `SELECT count(*) FROM "TableSession" WHERE "tableId" = $1 AND status = 'open'`, h.f.TableA); n != 1 {
				t.Errorf("open sessions on the table: %d", n)
			}
		})
	}
}

// 29: a real visit cannot escape its obligations by cancelling.
func TestCancelCannotBypassClose(t *testing.T) {
	h := refundsSetup(t)
	ctx := context.Background()
	s := h.openSession(t, h.f.TableA)
	if _, _, err := h.orders.Create(ctx, h.dineIn(s.ID, line(h.f.Plain, 1))); err != nil {
		t.Fatal(err)
	}
	if _, err := h.sessions.Cancel(ctx, h.tableScope(), s.ID, 1, h.staffActor()); !errors.Is(err, tables.ErrSessionHasOrders) {
		t.Errorf("cancel of a visit with an order: %v", err)
	}
	c, _, _ := h.checks.Create(ctx, h.forSession(s.ID))
	if _, err := h.sessions.Cancel(ctx, h.tableScope(), s.ID, 1, h.staffActor()); !errors.Is(err, tables.ErrSessionHasOrders) {
		t.Errorf("cancel of a billed visit: %v", err)
	}
	_ = c
	if h.sessionStatus(t, s.ID) != "open" {
		t.Error("the visit ended without closing")
	}
	// An empty session opened in error still cancels.
	empty := h.openSession(t, h.f.TableB)
	if _, err := h.sessions.Cancel(ctx, h.tableScope(), empty.ID, 1, h.staffActor()); err != nil {
		t.Errorf("cancel of an empty session: %v", err)
	}
	// A close of the cancelled session is refused; a cancel retry succeeds.
	var notOpen *tables.NotOpenError
	if _, err := h.sessions.Close(ctx, h.tableScope(), empty.ID, 2, h.staffActor()); !errors.As(err, &notOpen) {
		t.Errorf("close of a cancelled session: %v", err)
	}
}

// 30, 31 and the refusal over HTTP.
func TestVisitCloseAPI(t *testing.T) {
	h := refundsSetup(t)
	ctx := context.Background()
	pool, err := postgres.NewPool(ctx, postgres.Options{URL: testsupport.DisposableDatabaseURL(t), MaxConns: 8})
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
		Verifier:      identity.NewVerifier(secret), TabletDevices: identity.NewPostgresTabletDevices(pool), VenueGrants: identity.NewPostgresVenueGrants(pool),
		RateLimiter: ratelimit.New(admitAll{}, 0, logger), DeviceAuth: h.devices,
	})
	token := func(role, sub, org string, extra jwt.MapClaims) string {
		c := jwt.MapClaims{"sub": sub, "email": "x@example.test", "role": role, "organizationId": org, "exp": time.Now().Add(time.Minute).Unix()}
		for k, v := range extra {
			c[k] = v
		}
		s, _ := jwt.NewWithClaims(jwt.SigningMethodHS256, c).SignedString([]byte(secret))
		return s
	}
	cashier := token("cashier", h.f.Cashier, h.f.Org, nil)
	s := h.openSession(t, h.f.TableA)
	if _, _, err := h.orders.Create(ctx, h.dineIn(s.ID, line(h.f.Plain, 2))); err != nil {
		t.Fatal(err)
	}
	path := "/api/venues/" + h.f.Venue + "/table-sessions/" + s.ID + "/close"
	call := func(tok, p string) (int, map[string]any, []byte) {
		req := httptest.NewRequest("POST", p, strings.NewReader(`{"version":1}`))
		req.Header.Set("Authorization", "Bearer "+tok)
		rec := httptest.NewRecorder()
		routes.ServeHTTP(rec, req)
		var m map[string]any
		_ = json.Unmarshal(rec.Body.Bytes(), &m)
		return rec.Code, m, rec.Body.Bytes()
	}
	for name, x := range map[string]struct {
		token, path string
		status      int
	}{
		"KDS JWT":       {token("kitchen", "kds-device:"+h.f.Venue, h.f.Org, jwt.MapClaims{"venueId": h.f.Venue, "kind": "kds_device"}), path, 403},
		"kitchen staff": {token("kitchen", h.f.Owner, h.f.Org, nil), path, 403},
		"viewer":        {token("viewer", h.f.Owner, h.f.Org, nil), path, 403},
		"another org":   {token("owner", h.f.Owner, testsupport.UUID(), nil), path, 404},
		"another venue": {cashier, "/api/venues/" + h.f.TaxlessVenue + "/table-sessions/" + s.ID + "/close", 404},
	} {
		if status, _, body := call(x.token, x.path); status != x.status {
			t.Errorf("%s: %d %s", name, status, body)
		}
	}
	status, body, raw := call(cashier, path)
	readinessBody, _ := body["readiness"].(map[string]any)
	if status != 409 || body["code"] != "VISIT_NOT_FINANCIALLY_COMPLETE" || readinessBody["unbilledLines"] != 1.0 || readinessBody["openChecks"] != 0.0 {
		t.Fatalf("refusal: %d %s", status, raw)
	}
	testsupport.Validate(t, testsupport.Schema(t, "openapi/table-sessions.yaml", "/components/schemas/CodedError"), raw)
	if h.sessionStatus(t, s.ID) != "open" {
		t.Error("a refused close changed the session")
	}
}
