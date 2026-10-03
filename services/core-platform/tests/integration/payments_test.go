package integration

// Payments and settlement (Phase D6) against real PostgreSQL: partial and
// split tender, server-authoritative balances, holds against overpayment,
// settlement exactly once, uncertain outcomes and reconciliation,
// idempotency and concurrency, the check-void interaction, visits with
// several checks and later rounds, isolation, domain independence, the
// database invariants of migration 20261003000000_payments_settlement, and
// both trust paths of the API.

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
	devicestore "servvia/services/core-platform/internal/devices/pgstore"
	"servvia/services/core-platform/internal/health"
	"servvia/services/core-platform/internal/identity"
	"servvia/services/core-platform/internal/kitchen"
	"servvia/services/core-platform/internal/menu"
	"servvia/services/core-platform/internal/payments"
	"servvia/services/core-platform/internal/payments/paymentsapi"
	paymentstore "servvia/services/core-platform/internal/payments/pgstore"
	"servvia/services/core-platform/internal/platform/postgres"
	"servvia/services/core-platform/internal/ratelimit"
	"servvia/services/core-platform/internal/server"
	shiftstore "servvia/services/core-platform/internal/shifts/pgstore"
	"servvia/services/core-platform/internal/venues"
	"servvia/services/core-platform/tests/testsupport"
)

type paymentsHarness struct {
	checksHarness
	payments *payments.Service
	devices  *devices.Service
}

// serviceAdapterID is the adapter identity of results reported through the
// service directly (the HTTP route takes it from the authenticated device).
const serviceAdapterID = "adapter-device-under-test"

// enrollDevice enrolls a device at the fixture venue and returns its id and
// credential.
func (h paymentsHarness) enrollDevice(t *testing.T, kind devices.Kind, venueID string) (string, string) {
	t.Helper()
	d, credential, created, err := h.devices.Enroll(context.Background(), devices.Scope{OrganizationID: h.f.Org, VenueID: venueID},
		devices.Actor{StaffID: h.f.Owner, Email: "owner@example.test", Role: "owner"}, kind, string(kind)+" under test", key())
	if err != nil || !created || credential == "" {
		t.Fatalf("enroll %s: %v", kind, err)
	}
	return d.ID, credential
}

func paymentsSetup(t *testing.T) paymentsHarness {
	h := checksSetup(t)
	pool, err := postgres.NewPool(context.Background(), postgres.Options{URL: testsupport.DisposableDatabaseURL(t), MaxConns: 40})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	return paymentsHarness{checksHarness: h,
		payments: payments.NewService(paymentstore.New(pool, func(err error) { t.Errorf("audit: %v", err) }, shiftstore.Ledger{}), true),
		devices:  devices.NewService(devicestore.New(pool), true, devicestore.NewID)}
}

func (h paymentsHarness) payScope() payments.Scope {
	return payments.Scope{OrganizationID: h.f.Org, VenueID: h.f.Venue}
}

// tender builds an initiate command for a card payment in NZD.
func (h paymentsHarness) tender(checkID string, amount int64) payments.InitiateCommand {
	return payments.InitiateCommand{Scope: h.payScope(), CheckID: checkID, AmountCents: amount, Currency: "NZD",
		TenderType: payments.TenderCard, IdempotencyKey: key(),
		Actor: payments.Staff{StaffID: h.f.Cashier, Email: "cashier@example.test", Role: "cashier"}}
}

func (h paymentsHarness) pay(t *testing.T, checkID string, amount int64) payments.Payment {
	t.Helper()
	p, created, err := h.payments.Initiate(context.Background(), h.tender(checkID, amount))
	if err != nil || !created || p.Status != payments.StatusPending {
		t.Fatalf("initiate %d: %+v %v", amount, p, err)
	}
	return p
}

// report is the trusted adapter reporting a result.
func (h paymentsHarness) report(paymentID string, outcome payments.Status) (payments.Payment, bool, error) {
	ref := "txn-" + paymentID[:8]
	return h.payments.RecordResult(context.Background(), payments.ResultCommand{Scope: h.payScope(), PaymentID: paymentID,
		Outcome: outcome, Reference: &ref, Actor: payments.Adapter{ID: serviceAdapterID}})
}

func (h paymentsHarness) mustReport(t *testing.T, paymentID string, outcome payments.Status) payments.Payment {
	t.Helper()
	p, _, err := h.report(paymentID, outcome)
	if err != nil {
		t.Fatalf("report %s: %v", outcome, err)
	}
	return p
}

// whileTableLocked runs fn while a separate transaction holds table in
// EXCLUSIVE mode (reads allowed, writes wait), releasing it after 300ms so
// that every concurrent writer in fn has reached the lock first.
func (h paymentsHarness) whileTableLocked(t *testing.T, table string, fn func()) {
	t.Helper()
	ctx := context.Background()
	tx, err := h.writer.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Exec(ctx, `LOCK TABLE "`+table+`" IN EXCLUSIVE MODE`); err != nil {
		t.Fatal(err)
	}
	done := make(chan struct{})
	go func() { fn(); close(done) }()
	time.Sleep(300 * time.Millisecond)
	if err := tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	<-done
}

func (h paymentsHarness) summary(t *testing.T, checkID string) (payments.Summary, payments.Balance) {
	t.Helper()
	s, err := h.payments.Summary(context.Background(), h.payScope(), checkID)
	if err != nil {
		t.Fatal(err)
	}
	return s, payments.ComputeBalance(s.TotalCents, s.Payments)
}

// billedCheck opens a visit, orders Odd (1999) and Plain (550), and bills it:
// a check of 2549.
func (h paymentsHarness) billedCheck(t *testing.T, table string) (checks.Check, string) {
	t.Helper()
	s := h.openSession(t, table)
	if _, _, err := h.orders.Create(context.Background(), h.dineIn(s.ID, line(h.f.Odd, 1), line(h.f.Plain, 1))); err != nil {
		t.Fatal(err)
	}
	c, _, err := h.checks.Create(context.Background(), h.forSession(s.ID))
	if err != nil || c.TotalCents != 2549 {
		t.Fatalf("check: %+v %v", c, err)
	}
	return c, s.ID
}

// 1-5, 20, 21, 24, 25: split tender settles a check exactly once and changes
// nothing outside payments.
func TestSplitTenderSettlesOnce(t *testing.T) {
	h := paymentsSetup(t)
	ctx := context.Background()
	c, sessionID := h.billedCheck(t, h.f.TableA)
	h.drain(t)
	if _, _, err := h.kitchen.Transition(ctx, kitchen.TransitionCommand{VenueID: h.f.Venue, TicketID: h.tickets(t)[0].ID,
		To: kitchen.StatusPreparing, ExpectedVersion: 1, Actor: kds}); err != nil {
		t.Fatal(err)
	}
	kitchenBefore := h.kitchenState(t)
	var orderBefore string
	if err := h.writer.QueryRow(ctx, `SELECT string_agg(id || status::text || "totalCents" || "updatedAt", ',') FROM "Order" WHERE "tableSessionId" = $1`,
		sessionID).Scan(&orderBefore); err != nil {
		t.Fatal(err)
	}

	first := h.pay(t, c.ID, 1000)
	if s, b := h.summary(t, c.ID); b.PaidCents != 0 || b.HeldCents != 1000 || b.AvailableCents != 1549 || s.Settlement != nil {
		t.Errorf("pending holds its amount: %+v", b)
	}
	first = h.mustReport(t, first.ID, payments.StatusSucceeded)
	if first.Status != payments.StatusSucceeded || first.ResolvedAt == nil || *first.ResultReference == "" {
		t.Errorf("first payment %+v", first)
	}
	s, b := h.summary(t, c.ID)
	if b.PaidCents != 1000 || b.BalanceCents != 1549 || s.CheckStatus != "open" || s.Settlement != nil {
		t.Fatalf("partial payment: %+v %+v", s, b)
	}

	second := h.pay(t, c.ID, 1549)
	h.mustReport(t, second.ID, payments.StatusSucceeded)
	s, b = h.summary(t, c.ID)
	if b.PaidCents != 2549 || b.BalanceCents != 0 || s.CheckStatus != "settled" || s.Settlement == nil ||
		s.Settlement.SettlingPaymentID != second.ID || s.Settlement.AmountCents != 2549 || s.Settlement.Currency != "NZD" ||
		s.Settlement.ActorKind != payments.AdapterKind {
		t.Fatalf("settlement: %+v %+v", s, b)
	}
	// Settled exactly once: a repeated report changes nothing.
	if _, changed, err := h.report(second.ID, payments.StatusSucceeded); changed || err != nil {
		t.Errorf("repeated report: %v %v", changed, err)
	}
	if n := h.count(t, `SELECT count(*) FROM "CheckSettlement" WHERE "checkId" = $1`, c.ID); n != 1 {
		t.Errorf("settlements: %d", n)
	}
	var checkAfter checks.Check
	if checkAfter, _ = h.checks.Get(ctx, h.checkScope(), c.ID); checkAfter.Status != checks.StatusSettled || checkAfter.Version != 2 ||
		checkAfter.TotalCents != c.TotalCents || len(checkAfter.Lines) != len(c.Lines) {
		t.Errorf("settled check %+v", checkAfter)
	}
	// A settled check takes no payment and cannot be voided.
	var notOpen *payments.CheckNotOpenError
	if _, _, err := h.payments.Initiate(ctx, h.tender(c.ID, 1)); !errors.As(err, &notOpen) || notOpen.Status != "settled" {
		t.Errorf("payment on a settled check: %v", err)
	}
	var checkNotOpen *checks.NotOpenError
	if _, _, err := h.checks.Void(ctx, checks.VoidCommand{Scope: h.checkScope(), CheckID: c.ID, ExpectedVersion: 2, Reason: "x",
		Actor: checks.Actor{StaffID: h.f.Owner, Role: "owner"}}); !errors.As(err, &checkNotOpen) {
		t.Errorf("void of a settled check: %v", err)
	}

	// Nothing else changed, and nothing legacy was needed or created.
	var orderAfter string
	_ = h.writer.QueryRow(ctx, `SELECT string_agg(id || status::text || "totalCents" || "updatedAt", ',') FROM "Order" WHERE "tableSessionId" = $1`,
		sessionID).Scan(&orderAfter)
	if orderAfter != orderBefore || h.kitchenState(t) != kitchenBefore {
		t.Error("payments changed orders or kitchen tickets")
	}
	for _, x := range []struct {
		what string
		sql  string
		want int
	}{
		{"session still open", `SELECT count(*) FROM "TableSession" WHERE id = $1 AND status = 'open' AND version = 1`, 1},
		{"no payment observation", `SELECT count(*) FROM "PaymentObservation" o JOIN "Order" r ON r.id = o."orderId" WHERE r."tableSessionId" = $1`, 0},
		{"no POS sync record", `SELECT count(*) FROM "POSSyncRecord" p JOIN "Order" r ON r.id = p."orderId" WHERE r."tableSessionId" = $1`, 0},
		{"no legacy reservation payment", `SELECT count(*) FROM "Payment" WHERE "venueId" = (SELECT "venueId" FROM "Check" WHERE "tableSessionId" = $1 LIMIT 1)`, 0},
	} {
		if got := h.count(t, x.sql, sessionID); got != x.want {
			t.Errorf("%s: %d", x.what, got)
		}
	}
	if n := h.count(t, `SELECT count(*) FROM "ConnectorCommand" WHERE "venueId" = $1`, h.f.Venue); n != 0 {
		t.Errorf("connector commands: %d", n)
	}
	// History: creation and result for each payment, staff audit for each.
	for _, p := range []payments.Payment{first, second} {
		got, _ := h.payments.Get(ctx, h.payScope(), p.ID)
		if len(got.Transitions) != 2 || got.Transitions[0].From != nil || got.Transitions[0].ActorKind != "staff" ||
			*got.Transitions[1].From != payments.StatusPending || got.Transitions[1].To != payments.StatusSucceeded ||
			got.Transitions[1].ActorKind != payments.AdapterKind {
			t.Errorf("history of %s: %+v", p.ID, got.Transitions)
		}
		if n := h.count(t, `SELECT count(*) FROM "AuditLog" WHERE "resourceId" = $1 AND action = 'PAYMENT_CREATED' AND "actorId" = $2`, p.ID, h.f.Cashier); n != 1 {
			t.Errorf("audit of %s: %d", p.ID, n)
		}
	}
}

// 6, 17: amounts beyond what is available, and other currencies, are refused.
func TestPaymentAmountAndCurrencyRules(t *testing.T) {
	h := paymentsSetup(t)
	ctx := context.Background()
	c, _ := h.billedCheck(t, h.f.TableA)
	var exceeds *payments.AmountExceedsAvailableError
	if _, _, err := h.payments.Initiate(ctx, h.tender(c.ID, 2550)); !errors.As(err, &exceeds) || exceeds.AvailableCents != 2549 {
		t.Errorf("beyond the total: %v", err)
	}
	h.pay(t, c.ID, 2000)
	// The pending 2000 is held: only 549 is available, whatever a client thinks.
	if _, _, err := h.payments.Initiate(ctx, h.tender(c.ID, 550)); !errors.As(err, &exceeds) || exceeds.AvailableCents != 549 {
		t.Errorf("beyond the available amount: %v", err)
	}
	cmd := h.tender(c.ID, 100)
	cmd.Currency = "AUD"
	var mismatch *payments.CurrencyMismatchError
	if _, _, err := h.payments.Initiate(ctx, cmd); !errors.As(err, &mismatch) || mismatch.CheckCurrency != "NZD" {
		t.Errorf("currency: %v", err)
	}
	if n := h.count(t, `SELECT count(*) FROM "CheckPayment" WHERE "checkId" = $1`, c.ID); n != 1 {
		t.Errorf("refused payments were written: %d", n)
	}
}

// 7: tenders racing for the final balance cannot overpay, and concurrent
// results settle once.
func TestConcurrentFinalPaymentsCannotOverpay(t *testing.T) {
	h := paymentsSetup(t)
	ctx := context.Background()
	c, _ := h.billedCheck(t, h.f.TableA)
	h.mustReport(t, h.pay(t, c.ID, 549).ID, payments.StatusSucceeded)

	// 16 staff try to take the remaining 2000 at once, each with its own key.
	// While they start, the test holds CheckPayment EXCLUSIVE: reads pass,
	// inserts wait. So every tender reaches its balance read before any can
	// insert, and only the check row lock can stop them all from winning.
	const n = 16
	ids, errs := make([]string, n), make([]error, n)
	h.whileTableLocked(t, "CheckPayment", func() {
		race(n, func(i int) {
			var p payments.Payment
			p, _, errs[i] = h.payments.Initiate(ctx, h.tender(c.ID, 2000))
			ids[i] = p.ID
		})
	})
	var winner string
	for i, err := range errs {
		var exceeds *payments.AmountExceedsAvailableError
		switch {
		case err == nil && winner == "":
			winner = ids[i]
		case err == nil:
			t.Fatalf("two tenders for the final balance: %s and %s", winner, ids[i])
		case !errors.As(err, &exceeds) || exceeds.AvailableCents != 0:
			t.Fatalf("caller %d: %v", i, err)
		}
	}
	// The adapter reports the success from 12 retries at once: one change,
	// one settlement.
	changed := make([]bool, 12)
	errs = make([]error, 12)
	race(12, func(i int) { _, changed[i], errs[i] = h.report(winner, payments.StatusSucceeded) })
	writers := 0
	for i := range errs {
		if errs[i] != nil {
			t.Fatalf("report %d: %v", i, errs[i])
		}
		if changed[i] {
			writers++
		}
	}
	s, b := h.summary(t, c.ID)
	if writers != 1 || b.PaidCents != 2549 || s.CheckStatus != "settled" ||
		h.count(t, `SELECT count(*) FROM "CheckSettlement" WHERE "checkId" = $1`, c.ID) != 1 ||
		h.count(t, `SELECT count(*) FROM "CheckPaymentTransition" WHERE "paymentId" = $1`, winner) != 2 {
		t.Errorf("%d writers; %+v %+v", writers, b, s.Settlement)
	}

	// Two halves racing to succeed together settle once too.
	c2, _ := h.billedCheck(t, h.f.TableB)
	a, bb := h.pay(t, c2.ID, 1274), h.pay(t, c2.ID, 1275)
	race(2, func(i int) {
		id := a.ID
		if i == 1 {
			id = bb.ID
		}
		if _, _, err := h.report(id, payments.StatusSucceeded); err != nil {
			t.Errorf("report: %v", err)
		}
	})
	if s, b := h.summary(t, c2.ID); b.PaidCents != 2549 || s.CheckStatus != "settled" || s.Settlement == nil {
		t.Errorf("halves: %+v %+v", b, s)
	}
}

// 8, 9: voided checks take no payment; a check with money that may have
// moved cannot be voided.
func TestCheckVoidAndPayments(t *testing.T) {
	h := paymentsSetup(t)
	ctx := context.Background()
	owner := checks.Actor{StaffID: h.f.Owner, Email: "owner@example.test", Role: "owner"}
	void := func(c checks.Check) error {
		cur, err := h.checks.Get(ctx, h.checkScope(), c.ID)
		if err != nil {
			return err
		}
		_, _, err = h.checks.Void(ctx, checks.VoidCommand{Scope: h.checkScope(), CheckID: c.ID, ExpectedVersion: cur.Version,
			Reason: "wrong table", Actor: owner})
		return err
	}

	voided, _ := h.billedCheck(t, h.f.TableA)
	if err := void(voided); err != nil {
		t.Fatal(err)
	}
	var notOpen *payments.CheckNotOpenError
	if _, _, err := h.payments.Initiate(ctx, h.tender(voided.ID, 100)); !errors.As(err, &notOpen) || notOpen.Status != "voided" {
		t.Errorf("payment on a voided check: %v", err)
	}

	c, _ := h.billedCheck(t, h.f.TableB)
	p := h.pay(t, c.ID, 500)
	for _, step := range []payments.Status{payments.StatusPending, payments.StatusUncertain, payments.StatusSucceeded} {
		if step != payments.StatusPending {
			h.mustReport(t, p.ID, step)
		}
		if err := void(c); !errors.Is(err, checks.ErrCheckHasPayments) {
			t.Errorf("void with a %s payment: %v", step, err)
		}
	}

	// Failed payments alone: no money moved, the check may be voided.
	onlyFailed, _ := h.billedCheck(t, h.f.TableC)
	h.mustReport(t, h.pay(t, onlyFailed.ID, 800).ID, payments.StatusFailed)
	if err := void(onlyFailed); err != nil {
		t.Errorf("void with only failed payments: %v", err)
	}
}

// 10, 11, 16: a retry after a lost response returns the original payment;
// a key reused for another tender conflicts.
func TestPaymentIdempotency(t *testing.T) {
	h := paymentsSetup(t)
	ctx := context.Background()
	c, _ := h.billedCheck(t, h.f.TableA)
	cmd := h.tender(c.ID, 1000)
	p, created, err := h.payments.Initiate(ctx, cmd)
	if err != nil || !created {
		t.Fatal(err)
	}
	// The response was lost; the client retries, before and after the
	// terminal answered.
	for _, when := range []string{"before the result", "after the result"} {
		again, created, err := h.payments.Initiate(ctx, cmd)
		if err != nil || created || again.ID != p.ID {
			t.Errorf("retry %s: %+v %v %v", when, again, created, err)
		}
		if when == "before the result" {
			h.mustReport(t, p.ID, payments.StatusSucceeded)
		}
	}
	if _, b := h.summary(t, c.ID); b.PaidCents != 1000 {
		t.Errorf("paid %d: a retry tendered twice", b.PaidCents)
	}
	other := cmd
	other.AmountCents = 999
	var conflict *payments.IdempotencyConflictError
	if _, _, err := h.payments.Initiate(ctx, other); !errors.As(err, &conflict) || conflict.PaymentID != p.ID {
		t.Errorf("key reuse: %v", err)
	}
	if n := h.count(t, `SELECT count(*) FROM "CheckPayment" WHERE "checkId" = $1`, c.ID); n != 1 {
		t.Errorf("payments: %d", n)
	}
	if n := h.count(t, `SELECT count(*) FROM "AuditLog" WHERE "resourceId" = $1 AND action IN ('PAYMENT_IDEMPOTENT_REPLAY', 'PAYMENT_IDEMPOTENCY_CONFLICT')`, p.ID); n != 3 {
		t.Errorf("replay and conflict audits: %d", n)
	}
}

// 12: 24 identical tenders at once are one payment.
func TestConcurrentIdenticalPayments(t *testing.T) {
	h := paymentsSetup(t)
	c, _ := h.billedCheck(t, h.f.TableA)
	cmd := h.tender(c.ID, 2549)
	const n = 24
	ids, created, errs := make([]string, n), make([]bool, n), make([]error, n)
	race(n, func(i int) {
		var p payments.Payment
		p, created[i], errs[i] = h.payments.Initiate(context.Background(), cmd)
		ids[i] = p.ID
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
	if creators != 1 || h.count(t, `SELECT count(*) FROM "CheckPayment" WHERE "checkId" = $1`, c.ID) != 1 {
		t.Errorf("%d creators; want one payment", creators)
	}
}

// 13, 14, 15: an uncertain payment holds its amount, never settles, and is
// resolved once by reconciliation.
func TestUncertainPaymentReconciliation(t *testing.T) {
	h := paymentsSetup(t)
	ctx := context.Background()
	c, _ := h.billedCheck(t, h.f.TableA)
	p := h.pay(t, c.ID, 2549)
	h.mustReport(t, p.ID, payments.StatusUncertain)
	s, b := h.summary(t, c.ID)
	if s.CheckStatus != "open" || s.Settlement != nil || b.PaidCents != 0 || b.HeldCents != 2549 || b.AvailableCents != 0 {
		t.Fatalf("uncertain: %+v %+v", s, b)
	}
	// Nobody may tender again meanwhile: the card may have been charged.
	var exceeds *payments.AmountExceedsAvailableError
	if _, _, err := h.payments.Initiate(ctx, h.tender(c.ID, 1)); !errors.As(err, &exceeds) {
		t.Errorf("a second tender during uncertainty: %v", err)
	}
	if _, changed, err := h.report(p.ID, payments.StatusUncertain); changed || err != nil {
		t.Errorf("repeated uncertain: %v %v", changed, err)
	}
	// Reconciled as succeeded, from several reports at once: settles once.
	errs := make([]error, 8)
	race(8, func(i int) { _, _, errs[i] = h.report(p.ID, payments.StatusSucceeded) })
	for _, err := range errs {
		if err != nil {
			t.Fatal(err)
		}
	}
	s, _ = h.summary(t, c.ID)
	if s.CheckStatus != "settled" || h.count(t, `SELECT count(*) FROM "CheckSettlement" WHERE "checkId" = $1`, c.ID) != 1 {
		t.Errorf("reconciled: %+v", s)
	}
	got, _ := h.payments.Get(ctx, h.payScope(), p.ID)
	if len(got.Transitions) != 3 || *got.Transitions[2].From != payments.StatusUncertain {
		t.Errorf("history %+v", got.Transitions)
	}
	var resolved *payments.AlreadyResolvedError
	if _, _, err := h.report(p.ID, payments.StatusFailed); !errors.As(err, &resolved) {
		t.Errorf("a final payment changed its result: %v", err)
	}

	// Reconciled as failed: nothing settles and the amount is released.
	c2, _ := h.billedCheck(t, h.f.TableB)
	q := h.pay(t, c2.ID, 2549)
	h.mustReport(t, q.ID, payments.StatusUncertain)
	h.mustReport(t, q.ID, payments.StatusFailed)
	s, b = h.summary(t, c2.ID)
	if s.CheckStatus != "open" || s.Settlement != nil || b.PaidCents != 0 || b.HeldCents != 0 || b.AvailableCents != 2549 {
		t.Errorf("uncertain then failed: %+v %+v", s, b)
	}
}

// 22, 23: one settled check does not settle the visit; a later round is not
// absorbed into it and keeps the visit incomplete until billed and paid.
func TestVisitWithSeveralChecks(t *testing.T) {
	h := paymentsSetup(t)
	ctx := context.Background()
	raw, err := os.ReadFile(filepath.Join(testsupport.RepoRoot(), "docs", "migration", "checks", "visit-financially-complete.sql"))
	if err != nil {
		t.Fatal(err)
	}
	visit := func(sessionID string) (unsettled, unbilled int, complete bool) {
		t.Helper()
		if err := h.writer.QueryRow(ctx, `SELECT "unsettledChecks", "unbilledLines", "financiallyComplete" FROM (`+string(raw)+
			`) v WHERE "tableSessionId" = $1`, sessionID).Scan(&unsettled, &unbilled, &complete); err != nil {
			t.Fatal(err)
		}
		return
	}

	s := h.openSession(t, h.f.TableA)
	a, _, err := h.orders.Create(ctx, h.dineIn(s.ID, line(h.f.Plain, 1)))
	if err != nil {
		t.Fatal(err)
	}
	guest := h.dineIn(s.ID, line(h.f.Odd, 1))
	guest.Source = "order_tablet"
	b, _, err := h.orders.Create(ctx, guest)
	if err != nil {
		t.Fatal(err)
	}
	// Two checks on one visit (split by order).
	checkA, _, err := h.checks.Create(ctx, h.forOrders(a.ID))
	if err != nil {
		t.Fatal(err)
	}
	checkB, _, err := h.checks.Create(ctx, h.forOrders(b.ID))
	if err != nil {
		t.Fatal(err)
	}
	h.mustReport(t, h.pay(t, checkA.ID, checkA.TotalCents).ID, payments.StatusSucceeded)
	if unsettled, _, complete := visit(s.ID); unsettled != 1 || complete {
		t.Errorf("one settled check completed the visit: %d unsettled, complete %v", unsettled, complete)
	}

	// A later round on order A, after its check settled.
	h.round(t, a.ID, line(h.f.Plain, 2))
	settledA, _ := h.checks.Get(ctx, h.checkScope(), checkA.ID)
	if len(settledA.Lines) != 1 || settledA.TotalCents != checkA.TotalCents {
		t.Errorf("the round was absorbed into the settled check: %+v", settledA)
	}
	h.mustReport(t, h.pay(t, checkB.ID, checkB.TotalCents).ID, payments.StatusSucceeded)
	if unsettled, unbilled, complete := visit(s.ID); unsettled != 0 || unbilled != 1 || complete {
		t.Errorf("every check settled but a round is unbilled: %d %d %v", unsettled, unbilled, complete)
	}
	// A third check bills the round; paid, the visit is complete.
	checkC, _, err := h.checks.Create(ctx, h.forSession(s.ID))
	if err != nil || checkC.TotalCents != 1100 {
		t.Fatalf("third check: %+v %v", checkC, err)
	}
	h.mustReport(t, h.pay(t, checkC.ID, checkC.TotalCents).ID, payments.StatusSucceeded)
	if unsettled, unbilled, complete := visit(s.ID); unsettled != 0 || unbilled != 0 || !complete {
		t.Errorf("visit: %d %d %v", unsettled, unbilled, complete)
	}
	// Completion is a fact to act on, not an action: the session is untouched.
	if n := h.count(t, `SELECT count(*) FROM "TableSession" WHERE id = $1 AND status = 'open' AND version = 1`, s.ID); n != 1 {
		t.Error("settlement closed the table session")
	}
}

// 19: another venue can neither see nor move a payment.
func TestPaymentIsolation(t *testing.T) {
	h := paymentsSetup(t)
	ctx := context.Background()
	c, _ := h.billedCheck(t, h.f.TableA)
	p := h.pay(t, c.ID, 100)
	other := payments.Scope{OrganizationID: h.f.Org, VenueID: h.f.TaxlessVenue}
	if _, err := h.payments.Get(ctx, other, p.ID); !errors.Is(err, payments.ErrPaymentNotFound) {
		t.Errorf("get: %v", err)
	}
	if _, err := h.payments.Summary(ctx, other, c.ID); !errors.Is(err, payments.ErrCheckNotFound) {
		t.Errorf("summary: %v", err)
	}
	cmd := h.tender(c.ID, 100)
	cmd.Scope = other
	if _, _, err := h.payments.Initiate(ctx, cmd); !errors.Is(err, payments.ErrCheckNotFound) {
		t.Errorf("initiate: %v", err)
	}
	if _, _, err := h.payments.RecordResult(ctx, payments.ResultCommand{Scope: other, PaymentID: p.ID,
		Outcome: payments.StatusSucceeded, Actor: payments.Adapter{ID: serviceAdapterID}}); !errors.Is(err, payments.ErrPaymentNotFound) {
		t.Errorf("result: %v", err)
	}
	if got, _ := h.payments.Get(ctx, h.payScope(), p.ID); got.Status != payments.StatusPending {
		t.Error("another venue moved the payment")
	}
}

func TestPaymentSchemaInvariants(t *testing.T) {
	h := paymentsSetup(t)
	ctx := context.Background()
	c, _ := h.billedCheck(t, h.f.TableA)
	p := h.pay(t, c.ID, 2549)
	h.mustReport(t, p.ID, payments.StatusSucceeded)
	insertPayment := func(amount int, status string, resolved bool) error {
		var at any
		if resolved {
			at = time.Now()
		}
		_, err := h.writer.Exec(ctx, `INSERT INTO "CheckPayment" (id, "venueId", "checkId", "amountCents", currency, "tenderType",
			status, "idempotencyKey", "requestFingerprint", "resolvedAt", "updatedAt")
			VALUES ($1, $2, $3, $4, 'NZD', 'card', $5::"CheckPaymentStatus", $6, 'f', $7, now())`,
			testsupport.UUID(), h.f.Venue, c.ID, amount, status, key(), at)
		return err
	}
	_, secondSettlement := h.writer.Exec(ctx, `INSERT INTO "CheckSettlement" (id, "checkId", "amountCents", currency, "settlingPaymentId",
		"actorId", "actorKind") VALUES ($1, $2, 1, 'NZD', $3, 'x', 'x')`, testsupport.UUID(), c.ID, p.ID)
	_, orphanTransition := h.writer.Exec(ctx, `INSERT INTO "CheckPaymentTransition" (id, "paymentId", "toStatus", sequence, "actorId", "actorKind")
		VALUES ($1, $2, 'failed', 3, 'x', 'x')`, testsupport.UUID(), p.ID)
	_, deletePayment := h.writer.Exec(ctx, `DELETE FROM "CheckPayment" WHERE id = $1`, p.ID)
	_, deleteCheck := h.writer.Exec(ctx, `DELETE FROM "Check" WHERE id = $1`, c.ID)
	for _, x := range []struct {
		name, code, constraint string
		err                    error
	}{
		{"zero amount", "23514", "CheckPayment_amount_positive", insertPayment(0, "pending", false)},
		{"final without resolvedAt", "23514", "CheckPayment_resolved_when_final", insertPayment(1, "succeeded", false)},
		{"pending with resolvedAt", "23514", "CheckPayment_resolved_when_final", insertPayment(1, "pending", true)},
		{"a second settlement", "23505", "CheckSettlement_checkId_key", secondSettlement},
		{"a later transition without a previous status", "23514", "CheckPaymentTransition_first_is_creation", orphanTransition},
		{"deleting a payment with history", "23001", "CheckPaymentTransition_paymentId_fkey", deletePayment},
		{"deleting a paid check", "23001", "CheckPayment_checkId_fkey", deleteCheck},
	} {
		if code, constraint := pgCode(x.err); code != x.code || constraint != x.constraint {
			t.Errorf("%s: %s %s (%v)", x.name, code, constraint, x.err)
		}
	}
	// Several payments per check are allowed: no one-payment-per-check rule.
	if n := h.count(t, `SELECT count(*) FROM pg_indexes WHERE tablename = 'CheckPayment' AND indexdef LIKE 'CREATE UNIQUE%' AND indexdef LIKE '%("checkId")%'`); n != 0 {
		t.Error("a unique index on CheckPayment.checkId exists")
	}
}

// 18 and the trust boundary end to end: a cashier tenders, KDS and staff
// cannot report results, the adapter does, and the check settles.
func TestPaymentAPIAgainstPostgres(t *testing.T) {
	h := paymentsSetup(t)
	ctx := context.Background()
	pool, err := postgres.NewPool(ctx, postgres.Options{URL: testsupport.DisposableDatabaseURL(t), MaxConns: 8})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	c, _ := h.billedCheck(t, h.f.TableC)
	const secret = "integration-secret-0123456789abcdef"
	_, adapter := h.enrollDevice(t, devices.KindPaymentAdapter, h.f.Venue)
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	venueStore := venues.NewPostgresStore(pool)
	routes := server.Routes(server.Deps{
		Logger: logger, Health: health.New(pool, time.Second),
		Menu:     menu.NewHandler(menu.NewPostgresStore(pool), logger),
		Venues:   venues.NewHandler(venueStore, logger),
		Payments: paymentsapi.NewHandler(h.payments, venueStore, logger),
		Verifier: identity.NewVerifier(secret), TabletDevices: identity.NewPostgresTabletDevices(pool), VenueGrants: identity.NewPostgresVenueGrants(pool),
		RateLimiter: ratelimit.New(admitAll{}, 0, logger), DeviceAuth: h.devices,
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
		req := httptest.NewRequest(method, path, strings.NewReader(string(raw)))
		req.Header.Set("Authorization", "Bearer "+tok)
		rec := httptest.NewRecorder()
		routes.ServeHTTP(rec, req)
		var m map[string]any
		_ = json.Unmarshal(rec.Body.Bytes(), &m)
		return rec.Code, m, rec.Body.Bytes()
	}
	schema := func(name string) func([]byte) {
		s := testsupport.Schema(t, "openapi/payments.yaml", "/components/schemas/"+name)
		return func(b []byte) { t.Helper(); testsupport.Validate(t, s, b) }
	}
	paymentSchema, summarySchema := schema("Payment"), schema("CheckPayments")
	venue := "/api/venues/" + h.f.Venue
	initiate := venue + "/checks/" + c.ID + "/payments"
	body := map[string]any{"amountCents": 2549, "currency": "NZD", "tenderType": "card", "idempotencyKey": key()}

	if status, _, raw := call(kdsToken, "POST", initiate, body); status != 403 {
		t.Errorf("KDS tenders: %d %s", status, raw)
	}
	status, created, raw := call(cashier, "POST", initiate, body)
	if status != 201 || created["status"] != "pending" {
		t.Fatalf("initiate: %d %s", status, raw)
	}
	paymentSchema(raw)
	if status, again, _ := call(cashier, "POST", initiate, body); status != 200 || again["id"] != created["id"] {
		t.Errorf("replay: %d", status)
	}
	result := "/api/internal/payment-adapter/venues/" + h.f.Venue + "/payments/" + created["id"].(string) + "/result"
	for name, tok := range map[string]string{"owner": owner, "cashier": cashier, "KDS": kdsToken} {
		if status, _, raw := call(tok, "POST", result, map[string]any{"outcome": "succeeded"}); status != 401 {
			t.Errorf("%s claims success: %d %s", name, status, raw)
		}
	}
	status, _, raw = call(adapter, "POST", result, map[string]any{"outcome": "uncertain", "reference": "term-42"})
	if status != 200 {
		t.Fatalf("uncertain: %d %s", status, raw)
	}
	status, summary, raw := call(cashier, "GET", initiate, nil)
	if status != 200 || summary["checkStatus"] != "open" || summary["settlement"] != nil || summary["heldCents"] != 2549.0 {
		t.Fatalf("uncertain summary: %d %s", status, raw)
	}
	summarySchema(raw)
	if status, _, raw = call(adapter, "POST", result, map[string]any{"outcome": "succeeded", "reference": "term-42"}); status != 200 {
		t.Fatalf("reconcile: %d %s", status, raw)
	}
	paymentSchema(raw)
	status, summary, raw = call(cashier, "GET", initiate, nil)
	if status != 200 || summary["checkStatus"] != "settled" || summary["balanceCents"] != 0.0 || summary["settlement"] == nil {
		t.Fatalf("settled summary: %d %s", status, raw)
	}
	summarySchema(raw)
	if status, _, raw = call(adapter, "POST", result, map[string]any{"outcome": "failed"}); status != 409 {
		t.Errorf("a final payment changed: %d %s", status, raw)
	}
	schema("CodedError")(raw)
	if status, got, raw := call(cashier, "GET", venue+"/payments/"+created["id"].(string), nil); status != 200 || len(got["history"].([]any)) != 3 {
		t.Errorf("payment history: %d %s", status, raw)
	}
}
