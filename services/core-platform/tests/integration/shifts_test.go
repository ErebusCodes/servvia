package integration

// Shifts and cash (Phase D7) against real PostgreSQL: opening and the
// one-open-shift-per-staff rule, cash tender (atomic payment + movement +
// settlement), split tender with card, expected cash and variance, the close
// versus tender race in both orders, idempotency and concurrency, isolation,
// independence from other domains, the database invariants of migration
// 20261004000000_shifts_cash, and the API end to end.

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

	"servvia/services/core-platform/internal/devices"
	"servvia/services/core-platform/internal/health"
	"servvia/services/core-platform/internal/identity"
	"servvia/services/core-platform/internal/menu"
	"servvia/services/core-platform/internal/payments"
	"servvia/services/core-platform/internal/payments/paymentsapi"
	"servvia/services/core-platform/internal/platform/postgres"
	"servvia/services/core-platform/internal/ratelimit"
	"servvia/services/core-platform/internal/server"
	"servvia/services/core-platform/internal/shifts"
	shiftstore "servvia/services/core-platform/internal/shifts/pgstore"
	"servvia/services/core-platform/internal/shifts/shiftsapi"
	"servvia/services/core-platform/internal/venues"
	"servvia/services/core-platform/tests/testsupport"
)

type shiftsHarness struct {
	paymentsHarness
	shifts *shifts.Service
}

func shiftsSetup(t *testing.T) shiftsHarness {
	h := paymentsSetup(t)
	pool, err := postgres.NewPool(context.Background(), postgres.Options{URL: testsupport.DisposableDatabaseURL(t), MaxConns: 40})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	return shiftsHarness{paymentsHarness: h, shifts: shifts.NewService(shiftstore.New(pool), true)}
}

func (h shiftsHarness) shiftScope() shifts.Scope {
	return shifts.Scope{OrganizationID: h.f.Org, VenueID: h.f.Venue, Currency: "NZD"}
}

func (h shiftsHarness) cashierActor() shifts.Actor {
	return shifts.Actor{StaffID: h.f.Cashier, Email: "cashier@example.test", Role: "cashier"}
}

func (h shiftsHarness) openShift(t *testing.T, float int64) shifts.Shift {
	t.Helper()
	s, created, err := h.shifts.Open(context.Background(), shifts.OpenCommand{Scope: h.shiftScope(), OpeningFloatCents: float,
		RequestKey: key(), Actor: h.cashierActor()})
	if err != nil || !created {
		t.Fatalf("open shift: %v", err)
	}
	return s
}

func (h shiftsHarness) shift(t *testing.T, id string) shifts.Shift {
	t.Helper()
	s, err := h.shifts.Get(context.Background(), h.shiftScope(), shifts.Actor{Role: "owner"}, id)
	if err != nil {
		t.Fatal(err)
	}
	return s
}

// cash tenders cash as the cashier (the harness's tender actor).
func (h shiftsHarness) cash(checkID string, amount int64) (payments.Payment, bool, error) {
	cmd := h.tender(checkID, amount)
	cmd.TenderType = payments.TenderCash
	return h.payments.Initiate(context.Background(), cmd)
}

func (h shiftsHarness) closeShift(s shifts.Shift, counted int64) (shifts.Shift, bool, error) {
	return h.shifts.Close(context.Background(), shifts.CloseCommand{Scope: h.shiftScope(), ShiftID: s.ID,
		ExpectedVersion: s.Version, CountedCashCents: counted, Actor: h.cashierActor()})
}

// every succeeded cash payment has exactly one movement, on a shift, for its
// amount; no movement lacks its payment.
func (h shiftsHarness) cashIsAccounted(t *testing.T) {
	t.Helper()
	if n := h.count(t, `SELECT count(*) FROM "CheckPayment" p LEFT JOIN "CashMovement" m ON m."paymentId" = p.id
		WHERE p."venueId" = $1 AND p."tenderType" = 'cash' AND (m.id IS NULL OR m."amountCents" <> p."amountCents" OR p.status <> 'succeeded')`,
		h.f.Venue); n != 0 {
		t.Errorf("%d cash payments without a matching movement", n)
	}
	if n := h.count(t, `SELECT count(*) FROM "CashMovement" m JOIN "CheckPayment" p ON p.id = m."paymentId"
		WHERE m."venueId" = $1 AND p."tenderType" <> 'cash'`, h.f.Venue); n != 0 {
		t.Errorf("%d movements for non-cash payments", n)
	}
}

// 1-4: a shift opens with its float; one open shift per staff member, by the
// database, while several staff may be open at once.
func TestShiftOpenAndCardinality(t *testing.T) {
	h := shiftsSetup(t)
	ctx := context.Background()
	cmd := shifts.OpenCommand{Scope: h.shiftScope(), OpeningFloatCents: 20000, RequestKey: key(), Actor: h.cashierActor()}
	s, created, err := h.shifts.Open(ctx, cmd)
	if err != nil || !created || s.Status != shifts.StatusOpen || s.OpeningFloatCents != 20000 || s.StaffID != h.f.Cashier ||
		s.Currency != "NZD" || s.Version != 1 || s.Expected() != 20000 || s.CashSalesCents != 0 {
		t.Fatalf("open: %+v %v", s, err)
	}
	if n := h.count(t, `SELECT count(*) FROM "Shift" WHERE id = $1 AND "openingFloatCents" = 20000`, s.ID); n != 1 {
		t.Error("float not persisted")
	}
	if n := h.count(t, `SELECT count(*) FROM "AuditLog" WHERE "resourceId" = $1 AND action = 'SHIFT_OPENED' AND resource = 'shift'`, s.ID); n != 1 {
		t.Errorf("open audit: %d", n)
	}
	if again, created, err := h.shifts.Open(ctx, cmd); err != nil || created || again.ID != s.ID {
		t.Errorf("replay: %v %v", created, err)
	}
	other := cmd
	other.OpeningFloatCents = 1
	var conflict *shifts.IdempotencyConflictError
	if _, _, err := h.shifts.Open(ctx, other); !errors.As(err, &conflict) {
		t.Errorf("key reuse: %v", err)
	}
	var already *shifts.AlreadyOpenError
	if _, _, err := h.shifts.Open(ctx, shifts.OpenCommand{Scope: h.shiftScope(), RequestKey: key(), Actor: h.cashierActor()}); !errors.As(err, &already) || already.ShiftID != s.ID {
		t.Errorf("second open shift: %v", err)
	}
	// Another staff member at the same venue: allowed, no venue-wide cap.
	if _, _, err := h.shifts.Open(ctx, shifts.OpenCommand{Scope: h.shiftScope(), OpeningFloatCents: 0, RequestKey: key(),
		Actor: shifts.Actor{StaffID: h.f.Owner, Role: "owner"}}); err != nil {
		t.Errorf("a second staff member's shift: %v", err)
	}

	// 24 concurrent opens, each with its own key, by a staff member with no
	// open shift, while inserts into Shift are held: one wins, by the index.
	if _, _, err := h.closeShift(s, 20000); err != nil {
		t.Fatal(err)
	}
	const n = 24
	errs := make([]error, n)
	h.whileTableLocked(t, "Shift", func() {
		race(n, func(i int) {
			_, _, errs[i] = h.shifts.Open(ctx, shifts.OpenCommand{Scope: h.shiftScope(), OpeningFloatCents: int64(i), RequestKey: key(), Actor: h.cashierActor()})
		})
	})
	won := 0
	for i, err := range errs {
		switch {
		case err == nil:
			won++
		case !errors.As(err, &already):
			t.Fatalf("open %d: %v", i, err)
		}
	}
	if won != 1 || h.count(t, `SELECT count(*) FROM "Shift" WHERE "venueId" = $1 AND "staffId" = $2 AND status = 'open'`, h.f.Venue, h.f.Cashier) != 1 {
		t.Errorf("%d concurrent opens won", won)
	}
}

// 5-7, 9, 10, 16, 17, 24, 25, 28: cash needs an open shift, and then is one
// succeeded payment and one movement, in the check's balance.
func TestCashTender(t *testing.T) {
	h := shiftsSetup(t)
	ctx := context.Background()
	card, _ := h.billedCheck(t, h.f.TableB)
	historical := h.pay(t, card.ID, 100) // a card payment from before any shift
	c, sessionID := h.billedCheck(t, h.f.TableA)
	kitchenBefore := h.kitchenState(t)

	if _, _, err := h.cash(c.ID, 1000); !errors.Is(err, payments.ErrNoOpenShift) {
		t.Errorf("cash without a shift: %v", err)
	}
	if n := h.count(t, `SELECT count(*) FROM "CheckPayment" WHERE "checkId" = $1`, c.ID); n != 0 {
		t.Errorf("a refused cash tender left %d payments", n)
	}
	s := h.openShift(t, 10000)
	var exceeds *payments.AmountExceedsAvailableError
	if _, _, err := h.cash(c.ID, 2550); !errors.As(err, &exceeds) || exceeds.AvailableCents != 2549 {
		t.Errorf("cash beyond the balance: %v", err)
	}
	p, created, err := h.cash(c.ID, 1000)
	if err != nil || !created || p.Status != payments.StatusSucceeded || p.TenderType != payments.TenderCash || p.ShiftID == nil ||
		*p.ShiftID != s.ID || p.ResolvedAt == nil || len(p.Transitions) != 1 || p.Transitions[0].To != payments.StatusSucceeded {
		t.Fatalf("cash: %+v %v", p, err)
	}
	if n := h.count(t, `SELECT count(*) FROM "CashMovement" WHERE "paymentId" = $1 AND "shiftId" = $2 AND kind = 'cash_sale'
		AND "amountCents" = 1000 AND "actorStaffId" = $3`, p.ID, s.ID, h.f.Cashier); n != 1 {
		t.Errorf("movements: %d", n)
	}
	sum, b := h.summary(t, c.ID)
	if b.PaidCents != 1000 || b.BalanceCents != 1549 || sum.CheckStatus != "open" || sum.Settlement != nil {
		t.Errorf("partial cash: %+v", b)
	}
	if got := h.shift(t, s.ID); got.CashSalesCents != 1000 || got.Expected() != 11000 || got.MovementCount != 1 {
		t.Errorf("shift %+v", got)
	}
	if n := h.count(t, `SELECT count(*) FROM "AuditLog" WHERE "resourceId" = $1 AND action = 'CASH_PAYMENT'`, p.ID); n != 1 {
		t.Errorf("cash audit: %d", n)
	}
	// The historical card payment needs no shift.
	if got, _ := h.payments.Get(ctx, h.payScope(), historical.ID); got.ShiftID != nil {
		t.Error("a card payment has a shift")
	}
	h.cashIsAccounted(t)
	if h.kitchenState(t) != kitchenBefore ||
		h.count(t, `SELECT count(*) FROM "TableSession" WHERE id = $1 AND status = 'open' AND version = 1`, sessionID) != 1 ||
		h.count(t, `SELECT count(*) FROM "Order" WHERE "tableSessionId" = $1 AND status = 'confirmed'`, sessionID) != 1 ||
		h.count(t, `SELECT count(*) FROM "PaymentObservation" o JOIN "Order" r ON r.id = o."orderId" WHERE r."tableSessionId" = $1`, sessionID) != 0 ||
		h.count(t, `SELECT count(*) FROM "POSSyncRecord" p JOIN "Order" r ON r.id = p."orderId" WHERE r."tableSessionId" = $1`, sessionID) != 0 ||
		h.count(t, `SELECT count(*) FROM "ConnectorCommand" WHERE "venueId" = $1`, h.f.Venue) != 0 {
		t.Error("cash touched another domain or created legacy state")
	}
}

// 11, 14, 15, 26: cash and card on one check settle once; card, whatever its
// status, never changes the shift's cash.
func TestCashAndCardSplitTender(t *testing.T) {
	h := shiftsSetup(t)
	c, _ := h.billedCheck(t, h.f.TableA)
	s := h.openShift(t, 5000)
	if _, _, err := h.cash(c.ID, 1000); err != nil {
		t.Fatal(err)
	}
	card := h.pay(t, c.ID, 1549)
	for _, step := range []payments.Status{payments.StatusPending, payments.StatusUncertain, payments.StatusSucceeded} {
		if step != payments.StatusPending {
			h.mustReport(t, card.ID, step)
		}
		if got := h.shift(t, s.ID); got.Expected() != 6000 || got.CashSalesCents != 1000 {
			t.Errorf("card %s changed expected cash: %+v", step, got)
		}
	}
	sum, _ := h.summary(t, c.ID)
	if sum.CheckStatus != "settled" || sum.Settlement == nil || sum.Settlement.SettlingPaymentID != card.ID ||
		h.count(t, `SELECT count(*) FROM "CheckSettlement" WHERE "checkId" = $1`, c.ID) != 1 {
		t.Errorf("split settlement: %+v", sum)
	}
	// A failed card elsewhere changes nothing either.
	other, _ := h.billedCheck(t, h.f.TableB)
	h.mustReport(t, h.pay(t, other.ID, 2549).ID, payments.StatusFailed)
	// Cash that pays in full settles, by staff.
	cashOnly, _ := h.billedCheck(t, h.f.TableC)
	p, _, err := h.cash(cashOnly.ID, 2549)
	if err != nil {
		t.Fatal(err)
	}
	sum, _ = h.summary(t, cashOnly.ID)
	if sum.CheckStatus != "settled" || sum.Settlement.SettlingPaymentID != p.ID || sum.Settlement.ActorKind != "staff" {
		t.Errorf("cash settlement: %+v", sum.Settlement)
	}
	if got := h.shift(t, s.ID); got.Expected() != 5000+1000+2549 {
		t.Errorf("expected cash %d", got.Expected())
	}
	h.cashIsAccounted(t)
}

// 8, 12, 13: retries, identical races and the final balance.
func TestCashIdempotencyAndConcurrency(t *testing.T) {
	h := shiftsSetup(t)
	ctx := context.Background()
	c, _ := h.billedCheck(t, h.f.TableA)
	s := h.openShift(t, 0)
	cmd := h.tender(c.ID, 500)
	cmd.TenderType = payments.TenderCash
	p, _, err := h.payments.Initiate(ctx, cmd)
	if err != nil {
		t.Fatal(err)
	}
	// The response was lost: the retry returns the payment, no second movement.
	if again, created, err := h.payments.Initiate(ctx, cmd); err != nil || created || again.ID != p.ID {
		t.Errorf("retry: %v %v", created, err)
	}
	asCard := cmd
	asCard.TenderType = payments.TenderCard
	var conflict *payments.IdempotencyConflictError
	if _, _, err := h.payments.Initiate(ctx, asCard); !errors.As(err, &conflict) {
		t.Errorf("same key as card: %v", err)
	}
	// 24 identical cash tenders at once: one payment, one movement.
	twin := h.tender(c.ID, 700)
	twin.TenderType = payments.TenderCash
	ids, errs := make([]string, 24), make([]error, 24)
	race(24, func(i int) {
		var q payments.Payment
		q, _, errs[i] = h.payments.Initiate(ctx, twin)
		ids[i] = q.ID
	})
	for i := range ids {
		if errs[i] != nil || ids[i] != ids[0] {
			t.Fatalf("caller %d: %v", i, errs[i])
		}
	}
	if n := h.count(t, `SELECT count(*) FROM "CashMovement" WHERE "shiftId" = $1`, s.ID); n != 2 {
		t.Errorf("movements: %d", n)
	}
	// Remaining 1349: 16 cash tenders for it, each its own key, while inserts
	// are held so all reach their balance read: one wins.
	errs = make([]error, 16)
	h.whileTableLocked(t, "CheckPayment", func() {
		race(16, func(i int) { _, _, errs[i] = h.cash(c.ID, 1349) })
	})
	won := 0
	for i, err := range errs {
		// A loser sees the amount already taken, or (once the winner has
		// settled the check) a check that is no longer open.
		var exceeds *payments.AmountExceedsAvailableError
		var notOpen *payments.CheckNotOpenError
		switch {
		case err == nil:
			won++
		case !errors.As(err, &exceeds) && !errors.As(err, &notOpen):
			t.Fatalf("tender %d: %v", i, err)
		}
	}
	sum, b := h.summary(t, c.ID)
	if won != 1 || b.PaidCents != 2549 || sum.CheckStatus != "settled" || h.shift(t, s.ID).CashSalesCents != 2549 ||
		h.count(t, `SELECT count(*) FROM "CheckSettlement" WHERE "checkId" = $1`, c.ID) != 1 {
		t.Errorf("%d won; paid %d, %s", won, b.PaidCents, sum.CheckStatus)
	}
	var notOpen *payments.CheckNotOpenError
	if _, _, err := h.cash(c.ID, 1); !errors.As(err, &notOpen) || notOpen.Status != "settled" {
		t.Errorf("cash on a settled check: %v", err)
	}
	h.cashIsAccounted(t)
}

// 18-20: close stores the count and the server's expected cash and
// variance; a stale version conflicts; a closed shift takes no cash.
func TestShiftClose(t *testing.T) {
	h := shiftsSetup(t)
	c, _ := h.billedCheck(t, h.f.TableA)
	s := h.openShift(t, 5000)
	if _, _, err := h.cash(c.ID, 1549); err != nil {
		t.Fatal(err)
	}
	stale := s
	stale.Version = 7
	var conflict *shifts.VersionConflictError
	if _, _, err := h.closeShift(stale, 7000); !errors.As(err, &conflict) || conflict.Current != 1 {
		t.Errorf("stale close: %v", err)
	}
	closed, changed, err := h.closeShift(s, 6500)
	if err != nil || !changed || closed.Status != shifts.StatusClosed || *closed.ExpectedCashCents != 6549 ||
		*closed.CountedCashCents != 6500 || *closed.VarianceCents != -49 || closed.ClosedAt == nil ||
		*closed.ClosedByStaffID != h.f.Cashier || closed.Version != 2 {
		t.Fatalf("close: %+v %v", closed, err)
	}
	if n := h.count(t, `SELECT count(*) FROM "AuditLog" WHERE "resourceId" = $1 AND action = 'SHIFT_CLOSED'`, s.ID); n != 1 {
		t.Errorf("close audit: %d", n)
	}
	if again, changed, err := h.closeShift(s, 6500); err != nil || changed || again.Version != 2 {
		t.Errorf("repeated close: %v %v", changed, err)
	}
	var notOpen *shifts.NotOpenError
	if _, _, err := h.closeShift(closed, 6600); !errors.As(err, &notOpen) {
		t.Errorf("recount of a closed shift: %v", err)
	}
	if _, _, err := h.cash(c.ID, 100); !errors.Is(err, payments.ErrNoOpenShift) {
		t.Errorf("cash after close: %v", err)
	}
	// Closing the shift settled or closed nothing else.
	if sum, b := h.summary(t, c.ID); sum.CheckStatus != "open" || b.BalanceCents != 1000 {
		t.Errorf("close touched the check: %s %d", sum.CheckStatus, b.BalanceCents)
	}
	if h.shift(t, s.ID).Expected() != 6549 {
		t.Error("the stored expected cash changed")
	}
}

// 21: close and cash tender racing, in both orders, with the order forced:
// the test holds the shift row, the two callers queue behind it in a known
// order (PostgreSQL grants row-lock waiters first come, first served), and
// the row is released.
func TestShiftCloseRacingCashTender(t *testing.T) {
	for _, tenderFirst := range []bool{true, false} {
		name := map[bool]string{true: "tender queued first", false: "close queued first"}[tenderFirst]
		t.Run(name, func(t *testing.T) {
			h := shiftsSetup(t)
			ctx := context.Background()
			c, _ := h.billedCheck(t, h.f.TableA)
			s := h.openShift(t, 1000)

			tx, err := h.writer.Begin(ctx)
			if err != nil {
				t.Fatal(err)
			}
			if _, err := tx.Exec(ctx, `SELECT 1 FROM "Shift" WHERE id = $1 FOR UPDATE`, s.ID); err != nil {
				t.Fatal(err)
			}
			var cashErr, closeErr error
			var closed shifts.Shift
			tender := make(chan struct{})
			closing := make(chan struct{})
			startTender := func() { go func() { _, _, cashErr = h.cash(c.ID, 2549); close(tender) }() }
			startClose := func() { go func() { closed, _, closeErr = h.closeShift(s, 3549); close(closing) }() }
			if tenderFirst {
				startTender()
				time.Sleep(150 * time.Millisecond)
				startClose()
			} else {
				startClose()
				time.Sleep(150 * time.Millisecond)
				startTender()
			}
			time.Sleep(150 * time.Millisecond)
			if err := tx.Commit(ctx); err != nil {
				t.Fatal(err)
			}
			<-tender
			<-closing
			if closeErr != nil {
				t.Fatalf("close: %v", closeErr)
			}
			if tenderFirst {
				// Accounted wholly to the shift before it closed.
				if cashErr != nil || closed.CashSalesCents != 2549 || *closed.ExpectedCashCents != 3549 || *closed.VarianceCents != 0 {
					t.Errorf("tender first: %v; closed %+v", cashErr, closed)
				}
			} else {
				// Refused: the shift closed first, and nothing was written.
				if !errors.Is(cashErr, payments.ErrNoOpenShift) || *closed.ExpectedCashCents != 1000 ||
					h.count(t, `SELECT count(*) FROM "CheckPayment" WHERE "checkId" = $1`, c.ID) != 0 {
					t.Errorf("close first: %v; closed %+v", cashErr, closed)
				}
			}
			// Either way: the stored close matches the movements exactly.
			if n := h.count(t, `SELECT count(*) FROM "Shift" s WHERE s.id = $1 AND s."expectedCashCents" =
				s."openingFloatCents" + COALESCE((SELECT sum("amountCents") FROM "CashMovement" WHERE "shiftId" = s.id), 0)`, s.ID); n != 1 {
				t.Error("close facts disagree with the movements")
			}
			h.cashIsAccounted(t)
		})
	}
}

// 23 and access: another venue, and a cashier on another's shift.
func TestShiftIsolationAndAccess(t *testing.T) {
	h := shiftsSetup(t)
	ctx := context.Background()
	s := h.openShift(t, 100)
	ownerShift, _, err := h.shifts.Open(ctx, shifts.OpenCommand{Scope: h.shiftScope(), RequestKey: key(),
		Actor: shifts.Actor{StaffID: h.f.Owner, Role: "owner"}})
	if err != nil {
		t.Fatal(err)
	}
	other := h.shiftScope()
	other.VenueID = h.f.TaxlessVenue
	if _, err := h.shifts.Get(ctx, other, shifts.Actor{Role: "owner"}, s.ID); !errors.Is(err, shifts.ErrShiftNotFound) {
		t.Errorf("another venue: %v", err)
	}
	if _, err := h.shifts.Get(ctx, h.shiftScope(), h.cashierActor(), ownerShift.ID); !errors.Is(err, shifts.ErrShiftNotFound) {
		t.Errorf("a cashier reads another's shift: %v", err)
	}
	if _, _, err := h.shifts.Close(ctx, shifts.CloseCommand{Scope: h.shiftScope(), ShiftID: ownerShift.ID, ExpectedVersion: 1,
		Actor: h.cashierActor()}); !errors.Is(err, shifts.ErrShiftNotFound) {
		t.Errorf("a cashier closes another's shift: %v", err)
	}
	list, err := h.shifts.List(ctx, h.shiftScope(), h.cashierActor(), shifts.Filter{})
	if err != nil || len(list) != 1 || list[0].ID != s.ID {
		t.Errorf("a cashier's list: %+v %v", list, err)
	}
	// A manager (the owner here) may close the cashier's shift.
	if _, _, err := h.shifts.Close(ctx, shifts.CloseCommand{Scope: h.shiftScope(), ShiftID: s.ID, ExpectedVersion: 1,
		CountedCashCents: 100, Actor: shifts.Actor{StaffID: h.f.Owner, Role: "owner"}}); err != nil {
		t.Errorf("supervisor close: %v", err)
	}
	// Cash at another venue finds no shift there.
	c, _ := h.billedCheck(t, h.f.TableA)
	cmd := h.tender(c.ID, 100)
	cmd.TenderType = payments.TenderCash
	cmd.Scope.VenueID = h.f.TaxlessVenue
	if _, _, err := h.payments.Initiate(ctx, cmd); !errors.Is(err, payments.ErrCheckNotFound) {
		t.Errorf("cash at another venue: %v", err)
	}
}

func TestShiftSchemaInvariants(t *testing.T) {
	h := shiftsSetup(t)
	ctx := context.Background()
	s := h.openShift(t, 100)
	c, _ := h.billedCheck(t, h.f.TableA)
	p, _, err := h.cash(c.ID, 100)
	if err != nil {
		t.Fatal(err)
	}
	insertShift := func(status string, closed bool, variance int) error {
		var at, by, counted, expected, v any
		if closed {
			at, by, counted, expected, v = time.Now(), h.f.Owner, 100, 100, variance
		}
		_, err := h.writer.Exec(ctx, `INSERT INTO "Shift" (id, "venueId", "staffId", status, currency, "openingFloatCents",
			"openRequestKey", "closedAt", "closedByStaffId", "countedCashCents", "expectedCashCents", "varianceCents", "updatedAt")
			VALUES ($1, $2, $3, $4::"ShiftStatus", 'NZD', 0, $5, $6, $7, $8, $9, $10, now())`,
			testsupport.UUID(), h.f.Venue, h.f.Owner, status, key(), at, by, counted, expected, v)
		return err
	}
	_, secondOpen := h.writer.Exec(ctx, `INSERT INTO "Shift" (id, "venueId", "staffId", currency, "openingFloatCents", "openRequestKey", "updatedAt")
		VALUES ($1, $2, $3, 'NZD', 0, $4, now())`, testsupport.UUID(), h.f.Venue, h.f.Cashier, key())
	_, pendingCash := h.writer.Exec(ctx, `INSERT INTO "CheckPayment" (id, "venueId", "checkId", "amountCents", currency, "tenderType",
		status, "idempotencyKey", "requestFingerprint", "updatedAt") VALUES ($1, $2, $3, 1, 'NZD', 'cash', 'pending', $4, 'f', now())`,
		testsupport.UUID(), h.f.Venue, c.ID, key())
	_, secondMovement := h.writer.Exec(ctx, `INSERT INTO "CashMovement" (id, "venueId", "shiftId", kind, "amountCents", "paymentId", "actorStaffId")
		VALUES ($1, $2, $3, 'cash_sale', 100, $4, $5)`, testsupport.UUID(), h.f.Venue, s.ID, p.ID, h.f.Cashier)
	_, deleteShift := h.writer.Exec(ctx, `DELETE FROM "Shift" WHERE id = $1`, s.ID)
	_, deletePayment := h.writer.Exec(ctx, `DELETE FROM "CheckPayment" WHERE id = $1`, p.ID)
	for _, x := range []struct {
		name, code, constraint string
		err                    error
	}{
		{"a second open shift for one staff member", "23505", "Shift_one_open_per_staff", secondOpen},
		{"closed without close facts", "23514", "Shift_close_facts", insertShift("closed", false, 0)},
		{"open with close facts", "23514", "Shift_close_facts", insertShift("open", true, 0)},
		{"variance not counted - expected", "23514", "Shift_close_facts", insertShift("closed", true, 5)},
		{"a pending cash payment", "23514", "CheckPayment_non_card_is_succeeded", pendingCash},
		{"a second movement for one payment", "23505", "CashMovement_paymentId_key", secondMovement},
		{"deleting a shift with movements", "23001", "CashMovement_shiftId_fkey", deleteShift},
		{"deleting a cash payment", "23001", "CheckPaymentTransition_paymentId_fkey", deletePayment},
	} {
		if code, constraint := pgCode(x.err); code != x.code || constraint != x.constraint {
			t.Errorf("%s: %s %s (%v)", x.name, code, constraint, x.err)
		}
	}
	if err := insertShift("closed", true, 0); err != nil {
		t.Errorf("a valid closed shift: %v", err)
	}
}

// 22, 27 and the API end to end: KDS refused everywhere; cash over HTTP;
// the card adapter route unchanged and not a cash path.
func TestShiftAPIAgainstPostgres(t *testing.T) {
	h := shiftsSetup(t)
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
		Shifts:   shiftsapi.NewHandler(h.shifts, venueStore, logger),
		Verifier: identity.NewVerifier(secret), TabletDevices: identity.NewPostgresTabletDevices(pool),
		RateLimiter: ratelimit.New(admitAll{}, 0, logger), DeviceAuth: h.devices,
	})
	token := func(c jwt.MapClaims) string {
		c["organizationId"], c["exp"] = h.f.Org, time.Now().Add(time.Minute).Unix()
		s, _ := jwt.NewWithClaims(jwt.SigningMethodHS256, c).SignedString([]byte(secret))
		return s
	}
	cashier := token(jwt.MapClaims{"sub": h.f.Cashier, "email": "cashier@example.test", "role": "cashier"})
	kitchenStaff := token(jwt.MapClaims{"sub": h.f.Owner, "email": "k@example.test", "role": "kitchen"})
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
	shiftSchema := testsupport.Schema(t, "openapi/shifts.yaml", "/components/schemas/Shift")
	paymentSchema := testsupport.Schema(t, "openapi/payments.yaml", "/components/schemas/Payment")
	venue := "/api/venues/" + h.f.Venue
	openBody := map[string]any{"openingFloatCents": 10000, "idempotencyKey": key()}
	cashBody := map[string]any{"amountCents": 1000, "currency": "NZD", "tenderType": "cash", "idempotencyKey": key()}

	for name, tok := range map[string]string{"KDS": kdsToken, "kitchen staff": kitchenStaff} {
		if status, _, raw := call(tok, "POST", venue+"/shifts", openBody); status != 403 {
			t.Errorf("%s opens a shift: %d %s", name, status, raw)
		}
		if status, _, raw := call(tok, "POST", venue+"/checks/"+c.ID+"/payments", cashBody); status != 403 {
			t.Errorf("%s tenders cash: %d %s", name, status, raw)
		}
	}
	status, opened, raw := call(cashier, "POST", venue+"/shifts", openBody)
	if status != 201 {
		t.Fatalf("open: %d %s", status, raw)
	}
	testsupport.Validate(t, shiftSchema, raw)
	status, paid, raw := call(cashier, "POST", venue+"/checks/"+c.ID+"/payments", cashBody)
	if status != 201 || paid["status"] != "succeeded" || paid["shiftId"] != opened["id"] {
		t.Fatalf("cash: %d %s", status, raw)
	}
	testsupport.Validate(t, paymentSchema, raw)
	// The adapter route is a card path: it cannot turn cash into anything.
	result := "/api/internal/payment-adapter/venues/" + h.f.Venue + "/payments/" + paid["id"].(string) + "/result"
	if status, _, raw := call(cashier, "POST", result, map[string]any{"outcome": "failed"}); status != 401 {
		t.Errorf("staff on the adapter route: %d %s", status, raw)
	}
	if status, _, raw := call(adapter, "POST", result, map[string]any{"outcome": "failed"}); status != 409 {
		t.Errorf("adapter fails a cash payment: %d %s", status, raw)
	}
	id := opened["id"].(string)
	if status, _, raw := call(kdsToken, "POST", venue+"/shifts/"+id+"/close", map[string]any{"version": 1, "countedCashCents": 11000}); status != 403 {
		t.Errorf("KDS closes: %d %s", status, raw)
	}
	status, closed, raw := call(cashier, "POST", venue+"/shifts/"+id+"/close", map[string]any{"version": 1, "countedCashCents": 10990})
	if status != 200 || closed["expectedCashCents"] != 11000.0 || closed["varianceCents"] != -10.0 || closed["status"] != "closed" {
		t.Fatalf("close: %d %s", status, raw)
	}
	testsupport.Validate(t, shiftSchema, raw)
	if status, body, raw := call(cashier, "POST", venue+"/checks/"+c.ID+"/payments",
		map[string]any{"amountCents": 1, "currency": "NZD", "tenderType": "cash", "idempotencyKey": key()}); status != 409 || body["code"] != "NO_OPEN_SHIFT" {
		t.Errorf("cash after close: %d %s", status, raw)
	}
}
