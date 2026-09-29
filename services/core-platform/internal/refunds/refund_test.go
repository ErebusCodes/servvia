package refunds

import (
	"context"
	"errors"
	"testing"

	"servvia/services/core-platform/internal/payments"
)

// Pinned balance calculations: returns lower the effective paid amount only
// once they succeed; unresolved returns reserve refundable capacity.
func TestBalanceWithReturns(t *testing.T) {
	succeeded := func(amount, returned, reserved int64) payments.Payment {
		return payments.Payment{AmountCents: amount, Status: payments.StatusSucceeded, ReturnedCents: returned, ReservedCents: reserved}
	}
	// A: paid 5000, refund 1000 succeeded -> effective 4000, owes 1000.
	if b := payments.ComputeBalance(5000, []payments.Payment{succeeded(5000, 1000, 0)}); b.PaidCents != 4000 || b.BalanceCents != 1000 || b.ReturnedCents != 1000 {
		t.Errorf("A: %+v", b)
	}
	// B: card 3000 + cash 2000, cash refund 500 -> effective 4500, owes 500.
	if b := payments.ComputeBalance(5000, []payments.Payment{succeeded(3000, 0, 0), succeeded(2000, 500, 0)}); b.PaidCents != 4500 || b.BalanceCents != 500 {
		t.Errorf("B: %+v", b)
	}
	// C: paid 2000, refund 800 pending -> refundable 1200, effective still 2000.
	c := succeeded(2000, 0, 800)
	if c.RefundableCents() != 1200 || payments.ComputeBalance(2000, []payments.Payment{c}).PaidCents != 2000 {
		t.Errorf("C: refundable %d", c.RefundableCents())
	}
	// D: the 800 is reserved while uncertain as well (same accounting).
	if d := succeeded(2000, 1200, 800); d.RefundableCents() != 0 || d.NetCents() != 800 {
		t.Errorf("D: refundable %d net %d", d.RefundableCents(), d.NetCents())
	}
	// Failed or pending payments return nothing and are refundable for nothing.
	if (payments.Payment{AmountCents: 100, Status: payments.StatusPending}).RefundableCents() != 0 {
		t.Error("an unsucceeded payment is refundable")
	}
}

func TestFingerprint(t *testing.T) {
	a := Fingerprint("v", "p", KindRefund, 100, "NZD", "wrong item")
	for name, other := range map[string]string{
		"amount":   Fingerprint("v", "p", KindRefund, 101, "NZD", "wrong item"),
		"payment":  Fingerprint("v", "q", KindRefund, 100, "NZD", "wrong item"),
		"kind":     Fingerprint("v", "p", KindReversal, 100, "NZD", "wrong item"),
		"reason":   Fingerprint("v", "p", KindRefund, 100, "NZD", "other"),
		"currency": Fingerprint("v", "p", KindRefund, 100, "AUD", "wrong item"),
	} {
		if other == a {
			t.Errorf("%s does not change the fingerprint", name)
		}
	}
}

type fakeRepo struct {
	t        *testing.T
	existing *Adjustment
	stored   string
	audits   *[]string
}

func (f fakeRepo) FindByKey(context.Context, string, string) (Adjustment, string, bool, error) {
	if f.existing != nil {
		return *f.existing, f.stored, true, nil
	}
	return Adjustment{}, "", false, nil
}
func (fakeRepo) Get(context.Context, string, string) (Adjustment, error) { return Adjustment{}, nil }
func (fakeRepo) ListForPayment(context.Context, string, string) ([]Adjustment, error) {
	return nil, nil
}
func (f fakeRepo) Create(_ context.Context, n NewAdjustment) (Adjustment, error) {
	if f.existing != nil {
		f.t.Error("a replay reached Create")
	}
	return Adjustment{ID: "new", Kind: n.Kind}, nil
}
func (f fakeRepo) RecordResult(context.Context, ResultCommand) (Adjustment, bool, error) {
	return Adjustment{}, true, nil
}
func (f fakeRepo) Audit(_ context.Context, _ Scope, _ Staff, action, _ string, _ map[string]any) {
	if f.audits != nil {
		*f.audits = append(*f.audits, action)
	}
}

func TestService(t *testing.T) {
	ctx := context.Background()
	svc := NewService(fakeRepo{t: t}, true)
	ok := RefundCommand{PaymentID: "p", AmountCents: 100, Currency: "NZD", Reason: "wrong item", IdempotencyKey: "key-0123456789abcdef"}
	var invalidErr *ValidationError
	for name, mutate := range map[string]func(*RefundCommand){
		"zero amount": func(c *RefundCommand) { c.AmountCents = 0 },
		"currency":    func(c *RefundCommand) { c.Currency = "nzd" },
		"short key":   func(c *RefundCommand) { c.IdempotencyKey = "short" },
		"no reason":   func(c *RefundCommand) { c.Reason = "  " },
	} {
		cmd := ok
		mutate(&cmd)
		if _, _, err := svc.Refund(ctx, cmd); !errors.As(err, &invalidErr) {
			t.Errorf("%s: %v", name, err)
		}
	}
	for name, cmd := range map[string]ResultCommand{
		"pending is not a result": {Outcome: payments.StatusPending, DeviceID: "d"},
		"no device":               {Outcome: payments.StatusFailed},
	} {
		if _, _, err := svc.RecordResult(ctx, cmd); !errors.As(err, &invalidErr) {
			t.Errorf("%s: %v", name, err)
		}
	}
	if _, _, err := svc.Reverse(ctx, ReversalCommand{PaymentID: "p", AmountCents: 1, Currency: "NZD", IdempotencyKey: "key-0123456789abcdef"}); !errors.As(err, &invalidErr) {
		t.Errorf("a reversal without a device: %v", err)
	}
	a, created, err := svc.Refund(ctx, ok)
	if err != nil || !created || a.Kind != KindRefund {
		t.Errorf("refund: %v", err)
	}

	// Replay and conflict are decided by the fingerprint.
	var audits []string
	existing := Adjustment{ID: "r1"}
	fp := Fingerprint("", "p", KindRefund, 100, "NZD", "wrong item")
	replaying := NewService(fakeRepo{t: t, existing: &existing, stored: fp, audits: &audits}, true)
	if got, created, err := replaying.Refund(ctx, ok); err != nil || created || got.ID != "r1" {
		t.Errorf("replay: %v %v", created, err)
	}
	other := ok
	other.AmountCents = 99
	var conflict *IdempotencyConflictError
	if _, _, err := replaying.Refund(ctx, other); !errors.As(err, &conflict) || conflict.ID != "r1" {
		t.Errorf("conflict: %v", err)
	}
	if len(audits) != 2 {
		t.Errorf("audits %v", audits)
	}
	if _, _, err := NewService(fakeRepo{t: t}, false).Refund(ctx, ok); !errors.Is(err, ErrWritesDisabled) {
		t.Errorf("read-only: %v", err)
	}
}
