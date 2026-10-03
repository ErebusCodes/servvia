package integration

// Refunds, reversals and settlement revocation (Phase D9) against real
// PostgreSQL: the settle -> refund -> revoke -> pay -> settle again
// lifecycle with its history, refundable capacity under races, uncertain
// refunds, multi-payment checks, cash refunds under shifts (and against a
// shift close), reversals, voiding after full neutralization, visit
// completeness, the adapter trust boundary, and the database invariants of
// migration 20261006000000_refunds_reversals.

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
	"servvia/services/core-platform/internal/devices/devicesapi"
	"servvia/services/core-platform/internal/health"
	"servvia/services/core-platform/internal/identity"
	"servvia/services/core-platform/internal/menu"
	"servvia/services/core-platform/internal/payments"
	paymentstore "servvia/services/core-platform/internal/payments/pgstore"
	"servvia/services/core-platform/internal/platform/postgres"
	"servvia/services/core-platform/internal/ratelimit"
	"servvia/services/core-platform/internal/refunds"
	"servvia/services/core-platform/internal/refunds/refundsapi"
	"servvia/services/core-platform/internal/server"
	"servvia/services/core-platform/internal/shifts"
	shiftstore "servvia/services/core-platform/internal/shifts/pgstore"
	"servvia/services/core-platform/internal/venues"
	"servvia/services/core-platform/tests/testsupport"
)

type refundsHarness struct {
	shiftsHarness
	refunds *refunds.Service
}

func refundsSetup(t *testing.T) refundsHarness {
	h := shiftsSetup(t)
	pool, err := postgres.NewPool(context.Background(), postgres.Options{URL: testsupport.DisposableDatabaseURL(t), MaxConns: 40})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	store := paymentstore.New(pool, func(err error) { t.Errorf("audit: %v", err) }, shiftstore.Ledger{})
	return refundsHarness{shiftsHarness: h, refunds: refunds.NewService(store.Adjustments(), true)}
}

// The refund actor: refunds need owner, admin or manager.
func (h refundsHarness) owner() refunds.Staff {
	return refunds.Staff{StaffID: h.f.Owner, Email: "owner@example.test", Role: "owner"}
}

func (h refundsHarness) refundCmd(paymentID string, amount int64) refunds.RefundCommand {
	return refunds.RefundCommand{Scope: refunds.Scope{OrganizationID: h.f.Org, VenueID: h.f.Venue}, PaymentID: paymentID,
		AmountCents: amount, Currency: "NZD", Reason: "wrong dish", IdempotencyKey: key(), Actor: h.owner()}
}

func (h refundsHarness) refund(t *testing.T, paymentID string, amount int64) refunds.Adjustment {
	t.Helper()
	a, created, err := h.refunds.Refund(context.Background(), h.refundCmd(paymentID, amount))
	if err != nil || !created {
		t.Fatalf("refund %d: %v", amount, err)
	}
	return a
}

func (h refundsHarness) refundResult(id string, outcome payments.Status) (refunds.Adjustment, bool, error) {
	return h.refunds.RecordResult(context.Background(), refunds.ResultCommand{Scope: refunds.Scope{OrganizationID: h.f.Org,
		VenueID: h.f.Venue}, AdjustmentID: id, Outcome: outcome, DeviceID: serviceAdapterID})
}

func (h refundsHarness) mustRefundResult(t *testing.T, id string, outcome payments.Status) refunds.Adjustment {
	t.Helper()
	a, _, err := h.refundResult(id, outcome)
	if err != nil {
		t.Fatalf("refund result %s: %v", outcome, err)
	}
	return a
}

// settledByCard bills a visit (2549) and settles it with one card payment.
func (h refundsHarness) settledByCard(t *testing.T, table string) (checks.Check, payments.Payment, string) {
	t.Helper()
	c, session := h.billedCheck(t, table)
	p := h.pay(t, c.ID, c.TotalCents)
	h.mustReport(t, p.ID, payments.StatusSucceeded)
	return c, p, session
}

func (h refundsHarness) history(t *testing.T, checkID string) string {
	t.Helper()
	s, _ := h.summary(t, checkID)
	if s.Settlement == nil {
		return ""
	}
	var parts []string
	for _, e := range s.Settlement.History {
		parts = append(parts, string(e.Status)+"#"+string(rune('0'+e.Cycle)))
	}
	return strings.Join(parts, ",")
}

// 1, 2, 8, 19, 21-26, 37-39 and balance A: the full lifecycle, with history.
func TestSettleRefundResettleLifecycle(t *testing.T) {
	h := refundsSetup(t)
	ctx := context.Background()
	c, p, session := h.settledByCard(t, h.f.TableA)
	h.drain(t)
	kitchenBefore := h.kitchenState(t)
	var orderBefore string
	_ = h.writer.QueryRow(ctx, `SELECT string_agg(id || status::text || "totalCents" || "updatedAt", ',') FROM "Order" WHERE "tableSessionId" = $1`, session).Scan(&orderBefore)
	firstSettlement, _ := h.summary(t, c.ID)
	if firstSettlement.CheckStatus != "settled" || h.history(t, c.ID) != "settled#1" {
		t.Fatalf("settled: %s %s", firstSettlement.CheckStatus, h.history(t, c.ID))
	}

	r := h.refund(t, p.ID, 1000)
	if r.Status != payments.StatusPending || r.Kind != refunds.KindRefund || r.TenderType != payments.TenderCard || len(r.Transitions) != 1 {
		t.Fatalf("card refund starts pending: %+v", r)
	}
	// Pending: nothing returned yet; the check stays settled; 1000 reserved.
	if s, b := h.summary(t, c.ID); s.CheckStatus != "settled" || b.PaidCents != 2549 || s.Payments[0].RefundableCents() != 1549 {
		t.Errorf("pending refund: %s paid %d refundable %d", s.CheckStatus, b.PaidCents, s.Payments[0].RefundableCents())
	}
	h.mustRefundResult(t, r.ID, payments.StatusSucceeded)
	// A: effective paid 1549, owes 1000, settlement revoked, check open.
	s, b := h.summary(t, c.ID)
	if s.CheckStatus != "open" || b.PaidCents != 1549 || b.ReturnedCents != 1000 || b.BalanceCents != 1000 ||
		s.Settlement.Status != payments.SettlementRevoked || s.Settlement.RevokedAt == nil || h.history(t, c.ID) != "settled#1,revoked#1" {
		t.Fatalf("revoked: %s %+v %+v %s", s.CheckStatus, b, s.Settlement, h.history(t, c.ID))
	}
	// The original settlement fact is still there.
	if s.Settlement.History[0].PaymentID == nil || *s.Settlement.History[0].PaymentID != p.ID || *s.Settlement.History[1].AdjustmentID != r.ID {
		t.Errorf("history causes %+v", s.Settlement.History)
	}

	// Pay the 1000 again: settled again, cycle 2, one settlement row.
	p2 := h.pay(t, c.ID, 1000)
	h.mustReport(t, p2.ID, payments.StatusSucceeded)
	s, b = h.summary(t, c.ID)
	if s.CheckStatus != "settled" || b.PaidCents != 2549 || s.Settlement.Status != payments.SettlementSettled || s.Settlement.Cycle != 2 ||
		s.Settlement.SettlingPaymentID != p2.ID || h.history(t, c.ID) != "settled#1,revoked#1,settled#2" ||
		h.count(t, `SELECT count(*) FROM "CheckSettlement" WHERE "checkId" = $1`, c.ID) != 1 {
		t.Fatalf("re-settled: %s %+v %s", s.CheckStatus, s.Settlement, h.history(t, c.ID))
	}
	// 2: more partial refunds, up to the payment's amount; then no more.
	r2 := h.refund(t, p.ID, 1549)
	var exceeds *refunds.ExceedsRefundableError
	if _, _, err := h.refunds.Refund(ctx, h.refundCmd(p.ID, 1)); !errors.As(err, &exceeds) || exceeds.RefundableCents != 0 {
		t.Errorf("beyond the payment: %v", err)
	}
	h.mustRefundResult(t, r2.ID, payments.StatusSucceeded)
	if s, b := h.summary(t, c.ID); s.CheckStatus != "open" || b.PaidCents != 1000 || s.Payments[0].ReturnedCents != 2549 ||
		h.history(t, c.ID) != "settled#1,revoked#1,settled#2,revoked#2" {
		t.Errorf("second revocation: %s %+v %s", s.CheckStatus, b, h.history(t, c.ID))
	}

	// Nothing but money changed; nothing legacy was created.
	var orderAfter string
	_ = h.writer.QueryRow(ctx, `SELECT string_agg(id || status::text || "totalCents" || "updatedAt", ',') FROM "Order" WHERE "tableSessionId" = $1`, session).Scan(&orderAfter)
	if orderAfter != orderBefore || h.kitchenState(t) != kitchenBefore ||
		h.count(t, `SELECT count(*) FROM "TableSession" WHERE id = $1 AND status = 'open' AND version = 1`, session) != 1 ||
		h.count(t, `SELECT count(*) FROM "PaymentObservation" o JOIN "Order" r ON r.id = o."orderId" WHERE r."tableSessionId" = $1`, session) != 0 ||
		h.count(t, `SELECT count(*) FROM "POSSyncRecord" x JOIN "Order" r ON r.id = x."orderId" WHERE r."tableSessionId" = $1`, session) != 0 ||
		h.count(t, `SELECT count(*) FROM "ConnectorCommand" WHERE "venueId" = $1`, h.f.Venue) != 0 {
		t.Error("a refund changed orders, kitchen or the session, or created legacy state")
	}
	if n := h.count(t, `SELECT count(*) FROM "AuditLog" WHERE "resourceId" = ANY($1) AND action = 'REFUND_REQUESTED' AND "actorId" = $2`,
		[]string{r.ID, r2.ID}, h.f.Owner); n != 2 {
		t.Errorf("refund audits: %d", n)
	}
}

// 4-7, 18: capacity under a forced race, and idempotency.
func TestRefundCapacityAndIdempotency(t *testing.T) {
	h := refundsSetup(t)
	ctx := context.Background()
	_, p, _ := h.settledByCard(t, h.f.TableA)
	// 16 refunds of 1500 each (own keys) against 2549, inserts held so all
	// read the capacity first: one wins.
	errs := make([]error, 16)
	h.whileTableLocked(t, "PaymentAdjustment", func() {
		race(16, func(i int) { _, _, errs[i] = h.refunds.Refund(ctx, h.refundCmd(p.ID, 1500)) })
	})
	won := 0
	for i, err := range errs {
		var exceeds *refunds.ExceedsRefundableError
		switch {
		case err == nil:
			won++
		case !errors.As(err, &exceeds):
			t.Fatalf("refund %d: %v", i, err)
		}
	}
	if won != 1 || h.count(t, `SELECT COALESCE(sum("amountCents"), 0) FROM "PaymentAdjustment" WHERE "paymentId" = $1`, p.ID) != 1500 {
		t.Errorf("%d refunds won", won)
	}
	// The response was lost: the retry returns the same refund.
	cmd := h.refundCmd(p.ID, 500)
	first, _, err := h.refunds.Refund(ctx, cmd)
	if err != nil {
		t.Fatal(err)
	}
	if again, created, err := h.refunds.Refund(ctx, cmd); err != nil || created || again.ID != first.ID {
		t.Errorf("retry: %v %v", created, err)
	}
	other := cmd
	other.AmountCents = 499
	var conflict *refunds.IdempotencyConflictError
	if _, _, err := h.refunds.Refund(ctx, other); !errors.As(err, &conflict) || conflict.ID != first.ID {
		t.Errorf("key reuse: %v", err)
	}
	// 24 identical requests at once: one refund.
	twin := h.refundCmd(p.ID, 10)
	ids, rerrs := make([]string, 24), make([]error, 24)
	race(24, func(i int) {
		var a refunds.Adjustment
		a, _, rerrs[i] = h.refunds.Refund(ctx, twin)
		ids[i] = a.ID
	})
	for i := range ids {
		if rerrs[i] != nil || ids[i] != ids[0] {
			t.Fatalf("caller %d: %v", i, rerrs[i])
		}
	}
	if n := h.count(t, `SELECT count(*) FROM "PaymentAdjustment" WHERE "paymentId" = $1`, p.ID); n != 3 {
		t.Errorf("refunds: %d", n)
	}
}

// 14-17, 20, 27 and balances C, D: uncertain refunds reserve, reconcile once,
// and a failure releases.
func TestUncertainRefund(t *testing.T) {
	h := refundsSetup(t)
	ctx := context.Background()
	c, p, _ := h.settledByCard(t, h.f.TableA)
	r := h.refund(t, p.ID, 800)
	h.mustRefundResult(t, r.ID, payments.StatusUncertain)
	s, b := h.summary(t, c.ID)
	if s.CheckStatus != "settled" || b.PaidCents != 2549 || s.Payments[0].RefundableCents() != 1749 {
		t.Errorf("uncertain: %s paid %d refundable %d", s.CheckStatus, b.PaidCents, s.Payments[0].RefundableCents())
	}
	var exceeds *refunds.ExceedsRefundableError
	if _, _, err := h.refunds.Refund(ctx, h.refundCmd(p.ID, 1750)); !errors.As(err, &exceeds) || exceeds.RefundableCents != 1749 {
		t.Errorf("the uncertain 800 is not reserved: %v", err)
	}
	// Reconciled as succeeded by 8 retries at once: one change, one revocation.
	errs := make([]error, 8)
	changed := make([]bool, 8)
	race(8, func(i int) { _, changed[i], errs[i] = h.refundResult(r.ID, payments.StatusSucceeded) })
	writers := 0
	for i, err := range errs {
		if err != nil {
			t.Fatal(err)
		}
		if changed[i] {
			writers++
		}
	}
	if writers != 1 || h.history(t, c.ID) != "settled#1,revoked#1" ||
		h.count(t, `SELECT count(*) FROM "PaymentAdjustmentTransition" WHERE "adjustmentId" = $1`, r.ID) != 3 {
		t.Errorf("%d writers; history %s", writers, h.history(t, c.ID))
	}
	var resolved *payments.AlreadyResolvedError
	if _, _, err := h.refundResult(r.ID, payments.StatusFailed); !errors.As(err, &resolved) {
		t.Errorf("a final refund changed its result: %v", err)
	}

	// Uncertain then failed: nothing returned, capacity released, no revocation.
	c2, p2, _ := h.settledByCard(t, h.f.TableB)
	r2 := h.refund(t, p2.ID, 800)
	h.mustRefundResult(t, r2.ID, payments.StatusUncertain)
	h.mustRefundResult(t, r2.ID, payments.StatusFailed)
	if s, b := h.summary(t, c2.ID); s.CheckStatus != "settled" || b.PaidCents != 2549 || s.Payments[0].RefundableCents() != 2549 ||
		h.history(t, c2.ID) != "settled#1" {
		t.Errorf("failed refund: %s paid %d refundable %d %s", s.CheckStatus, b.PaidCents, s.Payments[0].RefundableCents(), h.history(t, c2.ID))
	}
}

// 28, 30-32 and balance B: a refund returns money from the chosen payment only.
func TestRefundOnMultiPaymentCheck(t *testing.T) {
	h := refundsSetup(t)
	c, _ := h.billedCheck(t, h.f.TableA)
	h.openShift(t, 0) // the cashier's shift takes the cash sale
	card := h.pay(t, c.ID, 1549)
	h.mustReport(t, card.ID, payments.StatusSucceeded)
	cash, _, err := h.cash(c.ID, 1000)
	if err != nil {
		t.Fatal(err)
	}
	if s, _ := h.summary(t, c.ID); s.CheckStatus != "settled" {
		t.Fatalf("not settled: %s", s.CheckStatus)
	}
	// The owner pays cash back from their own open shift.
	ownerShift, _, err := h.shifts.Open(context.Background(), shifts.OpenCommand{Scope: h.shiftScope(), OpeningFloatCents: 2000,
		RequestKey: key(), Actor: shifts.Actor{StaffID: h.f.Owner, Role: "owner"}})
	if err != nil {
		t.Fatal(err)
	}
	r := h.refund(t, cash.ID, 500)
	s, b := h.summary(t, c.ID)
	if r.Status != payments.StatusSucceeded || r.ShiftID == nil || *r.ShiftID != ownerShift.ID || s.CheckStatus != "open" ||
		b.PaidCents != 2049 || b.BalanceCents != 500 {
		t.Fatalf("cash refund: %+v; %s %+v", r, s.CheckStatus, b)
	}
	for _, sp := range s.Payments {
		if sp.ID == card.ID && (sp.ReturnedCents != 0 || sp.RefundableCents() != 1549) {
			t.Errorf("the card payment was touched: %+v", sp)
		}
	}
	// Expected cash: the owner's shift paid 500 out; the sale shift is untouched.
	if got := h.shift(t, ownerShift.ID); got.CashRefundsCents != 500 || got.Expected() != 1500 {
		t.Errorf("owner shift %+v", got)
	}
	if n := h.count(t, `SELECT count(*) FROM "CashMovement" WHERE "adjustmentId" = $1 AND kind = 'cash_refund' AND "amountCents" = 500 AND "shiftId" = $2`,
		r.ID, ownerShift.ID); n != 1 {
		t.Errorf("cash refund movements: %d", n)
	}
	// A card refund never touches cash.
	cr := h.refund(t, card.ID, 100)
	h.mustRefundResult(t, cr.ID, payments.StatusSucceeded)
	if got := h.shift(t, ownerShift.ID); got.Expected() != 1500 {
		t.Errorf("a card refund changed cash: %d", got.Expected())
	}
	if n := h.count(t, `SELECT count(*) FROM "AuditLog" WHERE "resourceId" = $1 AND action IN ('CASH_REFUND_SUCCEEDED', 'SETTLEMENT_REVOKED')`, r.ID); n != 2 {
		t.Errorf("cash refund audits: %d", n)
	}
}

// 29, 33, 35: cash refunds need an open shift of the refunding staff member;
// retries pay out once; a closed shift pays nothing.
func TestCashRefundShiftRules(t *testing.T) {
	h := refundsSetup(t)
	ctx := context.Background()
	c, _ := h.billedCheck(t, h.f.TableA)
	h.openShift(t, 0)
	cash, _, err := h.cash(c.ID, c.TotalCents)
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err := h.refunds.Refund(ctx, h.refundCmd(cash.ID, 100)); !errors.Is(err, refunds.ErrNoOpenShift) {
		t.Errorf("a cash refund without the refunder's shift: %v", err)
	}
	if n := h.count(t, `SELECT count(*) FROM "PaymentAdjustment" WHERE "paymentId" = $1`, cash.ID); n != 0 {
		t.Errorf("a refused cash refund wrote %d rows", n)
	}
	ownerShift, _, err := h.shifts.Open(ctx, shifts.OpenCommand{Scope: h.shiftScope(), OpeningFloatCents: 1000, RequestKey: key(),
		Actor: shifts.Actor{StaffID: h.f.Owner, Role: "owner"}})
	if err != nil {
		t.Fatal(err)
	}
	cmd := h.refundCmd(cash.ID, 300)
	r, _, err := h.refunds.Refund(ctx, cmd)
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 3; i++ {
		if again, created, err := h.refunds.Refund(ctx, cmd); err != nil || created || again.ID != r.ID {
			t.Errorf("retry: %v %v", created, err)
		}
	}
	if n := h.count(t, `SELECT count(*) FROM "CashMovement" WHERE "adjustmentId" = $1`, r.ID); n != 1 {
		t.Errorf("movements: %d", n)
	}
	if _, _, err := h.shifts.Close(ctx, shifts.CloseCommand{Scope: h.shiftScope(), ShiftID: ownerShift.ID, ExpectedVersion: 1,
		CountedCashCents: 700, Actor: shifts.Actor{StaffID: h.f.Owner, Role: "owner"}}); err != nil {
		t.Fatal(err)
	}
	if closed := h.shift(t, ownerShift.ID); *closed.ExpectedCashCents != 700 || *closed.VarianceCents != 0 {
		t.Errorf("close: expected %d variance %d", *closed.ExpectedCashCents, *closed.VarianceCents)
	}
	if _, _, err := h.refunds.Refund(ctx, h.refundCmd(cash.ID, 100)); !errors.Is(err, refunds.ErrNoOpenShift) {
		t.Errorf("a cash refund after the shift closed: %v", err)
	}
}

// 34: cash refund versus the paying shift's close, in both orders (forced).
func TestCashRefundRacingShiftClose(t *testing.T) {
	for _, refundFirst := range []bool{true, false} {
		t.Run(map[bool]string{true: "refund queued first", false: "close queued first"}[refundFirst], func(t *testing.T) {
			h := refundsSetup(t)
			ctx := context.Background()
			c, _ := h.billedCheck(t, h.f.TableA)
			h.openShift(t, 0)
			cash, _, err := h.cash(c.ID, c.TotalCents)
			if err != nil {
				t.Fatal(err)
			}
			owner := shifts.Actor{StaffID: h.f.Owner, Role: "owner"}
			s, _, err := h.shifts.Open(ctx, shifts.OpenCommand{Scope: h.shiftScope(), OpeningFloatCents: 1000, RequestKey: key(), Actor: owner})
			if err != nil {
				t.Fatal(err)
			}
			tx, err := h.writer.Begin(ctx)
			if err != nil {
				t.Fatal(err)
			}
			if _, err := tx.Exec(ctx, `SELECT 1 FROM "Shift" WHERE id = $1 FOR UPDATE`, s.ID); err != nil {
				t.Fatal(err)
			}
			var refundErr, closeErr error
			var closed shifts.Shift
			refunding, closing := make(chan struct{}), make(chan struct{})
			startRefund := func() {
				go func() { _, _, refundErr = h.refunds.Refund(ctx, h.refundCmd(cash.ID, 400)); close(refunding) }()
			}
			startClose := func() {
				go func() {
					closed, _, closeErr = h.shifts.Close(ctx, shifts.CloseCommand{Scope: h.shiftScope(), ShiftID: s.ID, ExpectedVersion: 1,
						CountedCashCents: 600, Actor: owner})
					close(closing)
				}()
			}
			if refundFirst {
				startRefund()
				time.Sleep(150 * time.Millisecond)
				startClose()
			} else {
				startClose()
				time.Sleep(150 * time.Millisecond)
				startRefund()
			}
			time.Sleep(150 * time.Millisecond)
			if err := tx.Commit(ctx); err != nil {
				t.Fatal(err)
			}
			<-refunding
			<-closing
			if closeErr != nil {
				t.Fatalf("close: %v", closeErr)
			}
			if refundFirst {
				if refundErr != nil || closed.CashRefundsCents != 400 || *closed.ExpectedCashCents != 600 || *closed.VarianceCents != 0 {
					t.Errorf("refund first: %v; %+v", refundErr, closed)
				}
			} else {
				if !errors.Is(refundErr, refunds.ErrNoOpenShift) || *closed.ExpectedCashCents != 1000 ||
					h.count(t, `SELECT count(*) FROM "PaymentAdjustment" WHERE "paymentId" = $1`, cash.ID) != 0 {
					t.Errorf("close first: %v; %+v", refundErr, closed)
				}
			}
			if n := h.count(t, `SELECT count(*) FROM "Shift" s WHERE s.id = $1 AND s."expectedCashCents" = s."openingFloatCents"
				+ COALESCE((SELECT sum("amountCents") FROM "CashMovement" WHERE "shiftId" = s.id AND kind = 'cash_sale'), 0)
				- COALESCE((SELECT sum("amountCents") FROM "CashMovement" WHERE "shiftId" = s.id AND kind = 'cash_refund'), 0)`, s.ID); n != 1 {
				t.Error("close facts disagree with the movements")
			}
			if n := h.count(t, `SELECT count(*) FROM "PaymentAdjustment" a LEFT JOIN "CashMovement" m ON m."adjustmentId" = a.id
				JOIN "CheckPayment" p ON p.id = a."paymentId" WHERE p."tenderType" = 'cash' AND a.status = 'succeeded' AND m.id IS NULL
				AND a."venueId" = $1`, h.f.Venue); n != 0 {
				t.Error("a succeeded cash refund without its movement")
			}
		})
	}
}

// Reversals: adapter-originated, card only, capacity-checked, revoke too.
func TestReversal(t *testing.T) {
	h := refundsSetup(t)
	ctx := context.Background()
	c, p, _ := h.settledByCard(t, h.f.TableA)
	adapterID, _ := h.enrollDevice(t, devices.KindPaymentAdapter, h.f.Venue)
	rev := refunds.ReversalCommand{Scope: refunds.Scope{OrganizationID: h.f.Org, VenueID: h.f.Venue}, PaymentID: p.ID,
		AmountCents: 2549, Currency: "NZD", IdempotencyKey: key(), DeviceID: adapterID}
	a, created, err := h.refunds.Reverse(ctx, rev)
	if err != nil || !created || a.Kind != refunds.KindReversal || a.Status != payments.StatusSucceeded || a.OriginDeviceID == nil ||
		*a.OriginDeviceID != adapterID || a.RequestedByStaffID != nil {
		t.Fatalf("reversal: %+v %v", a, err)
	}
	if again, created, err := h.refunds.Reverse(ctx, rev); err != nil || created || again.ID != a.ID {
		t.Errorf("reversal replay: %v %v", created, err)
	}
	s, b := h.summary(t, c.ID)
	if s.CheckStatus != "open" || b.PaidCents != 0 || h.history(t, c.ID) != "settled#1,revoked#1" ||
		s.Settlement.History[1].ActorKind != payments.AdapterKind {
		t.Errorf("reversal revocation: %s %+v %s", s.CheckStatus, b, h.history(t, c.ID))
	}
	more := rev
	more.IdempotencyKey, more.AmountCents = key(), 1
	var exceeds *refunds.ExceedsRefundableError
	if _, _, err := h.refunds.Reverse(ctx, more); !errors.As(err, &exceeds) {
		t.Errorf("reversing beyond the payment: %v", err)
	}
	// Cash cannot be reversed by a provider.
	c2, _ := h.billedCheck(t, h.f.TableB)
	h.openShift(t, 0)
	cash, _, err := h.cash(c2.ID, 100)
	if err != nil {
		t.Fatal(err)
	}
	cashRev := rev
	cashRev.PaymentID, cashRev.IdempotencyKey, cashRev.AmountCents = cash.ID, key(), 100
	if _, _, err := h.refunds.Reverse(ctx, cashRev); !errors.Is(err, refunds.ErrNotReversible) {
		t.Errorf("reversing cash: %v", err)
	}
	// Refunds and reversals stay distinguishable.
	if n := h.count(t, `SELECT count(*) FROM "PaymentAdjustment" WHERE "paymentId" = $1 AND kind = 'reversal'`, p.ID); n != 1 {
		t.Errorf("reversals: %d", n)
	}
}

// 40: a check may be voided only once its exposure is fully neutralized.
func TestVoidAfterFullRefund(t *testing.T) {
	h := refundsSetup(t)
	ctx := context.Background()
	c, p, _ := h.settledByCard(t, h.f.TableA)
	void := func() error {
		cur, err := h.checks.Get(ctx, h.checkScope(), c.ID)
		if err != nil {
			return err
		}
		_, _, err = h.checks.Void(ctx, checks.VoidCommand{Scope: h.checkScope(), CheckID: c.ID, ExpectedVersion: cur.Version,
			Reason: "voided after refund", Actor: checks.Actor{StaffID: h.f.Owner, Role: "owner"}})
		return err
	}
	var notOpen *checks.NotOpenError
	if err := void(); !errors.As(err, &notOpen) {
		t.Errorf("void of a settled check: %v", err)
	}
	r := h.refund(t, p.ID, 1000)
	h.mustRefundResult(t, r.ID, payments.StatusSucceeded)
	if err := void(); !errors.Is(err, checks.ErrCheckHasPayments) {
		t.Errorf("void with 1549 not returned: %v", err)
	}
	pending := h.refund(t, p.ID, 1549)
	if err := void(); !errors.Is(err, checks.ErrCheckHasPayments) {
		t.Errorf("void with a pending refund: %v", err)
	}
	h.mustRefundResult(t, pending.ID, payments.StatusSucceeded)
	if err := void(); err != nil {
		t.Fatalf("void after full refund: %v", err)
	}
	got, _ := h.checks.Get(ctx, h.checkScope(), c.ID)
	if got.Status != checks.StatusVoided || h.count(t, `SELECT count(*) FROM "CheckPayment" WHERE "checkId" = $1`, c.ID) != 1 ||
		h.count(t, `SELECT count(*) FROM "PaymentAdjustment" WHERE "paymentId" = $1`, p.ID) != 2 || h.history(t, c.ID) != "settled#1,revoked#1" {
		t.Errorf("history after void: %s", h.history(t, c.ID))
	}
}

// Visit completeness: unresolved returns of money keep a visit incomplete.
func TestVisitIncompleteWhileRefundUnresolved(t *testing.T) {
	h := refundsSetup(t)
	ctx := context.Background()
	raw, err := os.ReadFile(filepath.Join(testsupport.RepoRoot(), "docs", "migration", "checks", "visit-financially-complete.sql"))
	if err != nil {
		t.Fatal(err)
	}
	complete := func(session string) (bool, int) {
		var ok bool
		var unresolved int
		if err := h.writer.QueryRow(ctx, `SELECT "financiallyComplete", "unresolvedMoney" FROM (`+string(raw)+`) v WHERE "tableSessionId" = $1`, session).
			Scan(&ok, &unresolved); err != nil {
			t.Fatal(err)
		}
		return ok, unresolved
	}
	_, p, session := h.settledByCard(t, h.f.TableA)
	if ok, _ := complete(session); !ok {
		t.Fatal("a settled visit is not complete")
	}
	r := h.refund(t, p.ID, 100)
	if ok, n := complete(session); ok || n != 1 {
		t.Errorf("pending refund: complete %v unresolved %d", ok, n)
	}
	h.mustRefundResult(t, r.ID, payments.StatusUncertain)
	if ok, _ := complete(session); ok {
		t.Error("an uncertain refund left the visit complete")
	}
	h.mustRefundResult(t, r.ID, payments.StatusFailed)
	if ok, _ := complete(session); !ok {
		t.Error("a failed refund left the visit incomplete")
	}
}

func TestRefundSchemaInvariants(t *testing.T) {
	h := refundsSetup(t)
	ctx := context.Background()
	_, p, _ := h.settledByCard(t, h.f.TableA)
	r := h.refund(t, p.ID, 100)
	insert := func(kind string, staff, device any, reason any) error {
		_, err := h.writer.Exec(ctx, `INSERT INTO "PaymentAdjustment" (id, "venueId", "paymentId", kind, "amountCents", currency,
			"idempotencyKey", "requestFingerprint", reason, "requestedByStaffId", "originDeviceId", "updatedAt")
			VALUES ($1, $2, $3, $4::"PaymentAdjustmentKind", 1, 'NZD', $5, 'f', $6, $7, $8, now())`,
			testsupport.UUID(), h.f.Venue, p.ID, kind, key(), reason, staff, device)
		return err
	}
	var settlementID string
	_ = h.writer.QueryRow(ctx, `SELECT id FROM "CheckSettlement" WHERE "settlingPaymentId" = $1`, p.ID).Scan(&settlementID)
	_, causeless := h.writer.Exec(ctx, `INSERT INTO "CheckSettlementTransition" (id, "settlementId", sequence, "toStatus", cycle,
		"amountCents", "actorId", "actorKind") VALUES ($1, $2, 99, 'revoked', 1, 1, 'x', 'x')`, testsupport.UUID(), settlementID)
	_, orphanMovement := h.writer.Exec(ctx, `INSERT INTO "CashMovement" (id, "venueId", "shiftId", kind, "amountCents", "actorStaffId")
		VALUES ($1, $2, 'none', 'cash_sale', 1, $3)`, testsupport.UUID(), h.f.Venue, h.f.Owner)
	_, deleteRefund := h.writer.Exec(ctx, `DELETE FROM "PaymentAdjustment" WHERE id = $1`, r.ID)
	_, deleteSettlement := h.writer.Exec(ctx, `DELETE FROM "CheckSettlement" WHERE id = $1`, settlementID)
	for _, x := range []struct {
		name, code, constraint string
		err                    error
	}{
		{"a refund without staff", "23514", "PaymentAdjustment_origin", insert("refund", nil, nil, "x")},
		{"a refund without a reason", "23514", "PaymentAdjustment_origin", insert("refund", h.f.Owner, nil, nil)},
		{"a reversal from staff", "23514", "PaymentAdjustment_origin", insert("reversal", h.f.Owner, nil, nil)},
		{"a revoked event without its refund", "23514", "CheckSettlementTransition_cause", causeless},
		{"a movement of nothing", "23514", "CashMovement_source", orphanMovement},
		{"deleting a refund with history", "23001", "PaymentAdjustmentTransition_adjustmentId_fkey", deleteRefund},
		{"deleting a settlement with history", "23001", "CheckSettlementTransition_settlementId_fkey", deleteSettlement},
	} {
		if code, constraint := pgCode(x.err); code != x.code || constraint != x.constraint {
			t.Errorf("%s: %s %s (%v)", x.name, code, constraint, x.err)
		}
	}
}

// 9-13 and the security matrix: the HTTP trust boundary.
func TestRefundAPIAndTrustBoundary(t *testing.T) {
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
		Menu:     menu.NewHandler(menu.NewPostgresStore(pool), logger),
		Venues:   venues.NewHandler(venueStore, logger),
		Refunds:  refundsapi.NewHandler(h.refunds, venueStore, logger),
		Devices:  devicesapi.NewHandler(h.devices, venueStore, logger),
		Verifier: identity.NewVerifier(secret), TabletDevices: identity.NewPostgresTabletDevices(pool), VenueGrants: identity.NewPostgresVenueGrants(pool),
		RateLimiter: ratelimit.New(admitAll{}, 0, logger), DeviceAuth: h.devices,
	})
	token := func(role, sub string, extra jwt.MapClaims) string {
		c := jwt.MapClaims{"sub": sub, "email": "x@example.test", "role": role, "organizationId": h.f.Org, "exp": time.Now().Add(time.Minute).Unix()}
		for k, v := range extra {
			c[k] = v
		}
		s, _ := jwt.NewWithClaims(jwt.SigningMethodHS256, c).SignedString([]byte(secret))
		return s
	}
	owner, cashier := token("owner", h.f.Owner, nil), token("cashier", h.f.Cashier, nil)
	kdsJWT := token("kitchen", "kds-device:"+h.f.Venue, jwt.MapClaims{"venueId": h.f.Venue, "kind": "kds_device"})
	call := func(tok, path string, body any) (int, []byte) {
		raw, _ := json.Marshal(body)
		req := httptest.NewRequest("POST", path, strings.NewReader(string(raw)))
		req.Header.Set("Authorization", "Bearer "+tok)
		rec := httptest.NewRecorder()
		routes.ServeHTTP(rec, req)
		return rec.Code, rec.Body.Bytes()
	}
	c, p, _ := h.settledByCard(t, h.f.TableA)
	venue := "/api/venues/" + h.f.Venue
	refundBody := func() map[string]any {
		return map[string]any{"amountCents": 1000, "currency": "NZD", "reason": "cold dish", "idempotencyKey": key()}
	}
	for name, tok := range map[string]string{"cashier": cashier, "KDS JWT": kdsJWT} {
		if status, body := call(tok, venue+"/payments/"+p.ID+"/refunds", refundBody()); status != 403 {
			t.Errorf("%s requests a refund: %d %s", name, status, body)
		}
	}
	status, body := call(owner, venue+"/payments/"+p.ID+"/refunds", refundBody())
	if status != 201 {
		t.Fatalf("owner refund: %d %s", status, body)
	}
	schema := testsupport.Schema(t, "openapi/refunds.yaml", "/components/schemas/Refund")
	testsupport.Validate(t, schema, body)
	var r map[string]any
	_ = json.Unmarshal(body, &r)
	result := func(venueID string) string {
		return "/api/internal/payment-adapter/venues/" + venueID + "/refunds/" + r["id"].(string) + "/result"
	}
	adapterA, credA := h.enrollDevice(t, devices.KindPaymentAdapter, h.f.Venue)
	_, credB := h.enrollDevice(t, devices.KindPaymentAdapter, h.f.TaxlessVenue)
	_, kds := h.enrollDevice(t, devices.KindKDS, h.f.Venue)
	_, pos := h.enrollDevice(t, devices.KindPOSTerminal, h.f.Venue)
	_, tablet := h.enrollDevice(t, devices.KindOrderTablet, h.f.Venue)
	revokedID, revoked := h.enrollDevice(t, devices.KindPaymentAdapter, h.f.Venue)
	if _, _, err := h.devices.Revoke(ctx, h.change(revokedID, 1)); err != nil {
		t.Fatal(err)
	}
	ok := map[string]any{"outcome": "succeeded"}
	for name, x := range map[string]struct {
		token, venue string
		status       int
	}{
		"staff (owner) claims success": {owner, h.f.Venue, 401},
		"KDS JWT":                      {kdsJWT, h.f.Venue, 401},
		"revoked adapter":              {revoked, h.f.Venue, 401},
		"KDS device":                   {kds, h.f.Venue, 403},
		"POS device":                   {pos, h.f.Venue, 403},
		"Order Tablet device":          {tablet, h.f.Venue, 403},
		"adapter A at venue B":         {credA, h.f.TaxlessVenue, 403},
		"adapter B at venue A":         {credB, h.f.Venue, 403},
		"adapter B on its own venue":   {credB, h.f.TaxlessVenue, 404},
	} {
		if status, body := call(x.token, result(x.venue), ok); status != x.status {
			t.Errorf("%s: %d %s", name, status, body)
		}
	}
	if got, _ := h.refunds.Get(ctx, refunds.Scope{VenueID: h.f.Venue}, r["id"].(string)); got.Status != payments.StatusPending {
		t.Fatalf("a refused caller changed the refund: %s", got.Status)
	}
	if status, body := call(credA, result(h.f.Venue), map[string]any{"outcome": "succeeded", "reference": "rf-1"}); status != 200 {
		t.Fatalf("adapter A: %d %s", status, body)
	} else {
		testsupport.Validate(t, schema, body)
	}
	got, _ := h.refunds.Get(ctx, refunds.Scope{VenueID: h.f.Venue}, r["id"].(string))
	if last := got.Transitions[len(got.Transitions)-1]; got.Status != payments.StatusSucceeded || last.ActorID != adapterA {
		t.Errorf("refund result: %s by %s", got.Status, last.ActorID)
	}
	if s, _ := h.summary(t, c.ID); s.CheckStatus != "open" {
		t.Errorf("check after refund: %s", s.CheckStatus)
	}
	// Reversals: device only.
	reversal := map[string]any{"amountCents": 100, "currency": "NZD", "idempotencyKey": key()}
	revPath := "/api/internal/payment-adapter/venues/" + h.f.Venue + "/payments/" + p.ID + "/reversals"
	for name, tok := range map[string]string{"owner JWT": owner, "KDS device": kds} {
		if status, _ := call(tok, revPath, reversal); status != 401 && status != 403 {
			t.Errorf("%s reverses: %d", name, status)
		}
	}
	if status, body := call(credA, revPath, reversal); status != 201 {
		t.Errorf("adapter reversal: %d %s", status, body)
	}
}
