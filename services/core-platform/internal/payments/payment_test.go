package payments

import (
	"context"
	"errors"
	"testing"
)

func TestDecideResult(t *testing.T) {
	all := []Status{StatusPending, StatusSucceeded, StatusFailed, StatusUncertain}
	for _, from := range all {
		for _, to := range all {
			changed, err := DecideResult(from, to)
			var resolved *AlreadyResolvedError
			var invalidErr *ValidationError
			switch {
			case to == StatusPending:
				// pending is never a result.
				if !errors.As(err, &invalidErr) {
					t.Errorf("%s -> pending: %v", from, err)
				}
			case from == to:
				if changed || err != nil {
					t.Errorf("%s -> %s is a no-op: %v %v", from, to, changed, err)
				}
			case from.Final():
				if !errors.As(err, &resolved) || resolved.Status != from {
					t.Errorf("%s -> %s must be refused: %v", from, to, err)
				}
			default: // pending -> any outcome; uncertain -> succeeded | failed
				if !changed || err != nil {
					t.Errorf("%s -> %s: %v %v", from, to, changed, err)
				}
			}
		}
	}
	// Uncertain is never turned into anything but by an explicit result.
	if StatusUncertain.Final() || !StatusUncertain.Holds() || StatusFailed.Holds() {
		t.Error("uncertain must hold its amount and stay open; failed holds nothing")
	}
}

func TestComputeBalance(t *testing.T) {
	ps := []Payment{
		{AmountCents: 1000, Status: StatusSucceeded},
		{AmountCents: 300, Status: StatusPending},
		{AmountCents: 200, Status: StatusUncertain},
		{AmountCents: 999, Status: StatusFailed},
	}
	b := ComputeBalance(2000, ps)
	if b.PaidCents != 1000 || b.HeldCents != 500 || b.BalanceCents != 1000 || b.AvailableCents != 500 {
		t.Errorf("balance %+v", b)
	}
	if b := ComputeBalance(1000, nil); b.BalanceCents != 1000 || b.AvailableCents != 1000 {
		t.Errorf("no payments %+v", b)
	}
}

func TestFingerprint(t *testing.T) {
	a := Fingerprint("v", "c", 500, "NZD", TenderCard)
	for name, other := range map[string]string{
		"amount":   Fingerprint("v", "c", 501, "NZD", TenderCard),
		"check":    Fingerprint("v", "d", 500, "NZD", TenderCard),
		"venue":    Fingerprint("w", "c", 500, "NZD", TenderCard),
		"currency": Fingerprint("v", "c", 500, "AUD", TenderCard),
	} {
		if other == a {
			t.Errorf("%s does not change the fingerprint", name)
		}
	}
}

// unreachable fails any repository use: validation must refuse first.
type unreachable struct{ t *testing.T }

func (u unreachable) FindByKey(context.Context, string, string) (Payment, string, bool, error) {
	u.t.Error("repository reached")
	return Payment{}, "", false, nil
}
func (unreachable) Get(context.Context, string, string) (Payment, error)     { return Payment{}, nil }
func (unreachable) Summary(context.Context, string, string) (Summary, error) { return Summary{}, nil }
func (u unreachable) Initiate(context.Context, NewPayment) (Payment, error) {
	u.t.Error("repository reached")
	return Payment{}, nil
}
func (u unreachable) RecordResult(context.Context, ResultCommand) (Payment, bool, error) {
	u.t.Error("repository reached")
	return Payment{}, false, nil
}
func (unreachable) Audit(context.Context, Scope, Staff, string, string, map[string]any) {}

func TestValidation(t *testing.T) {
	svc := NewService(unreachable{t}, true)
	ctx := context.Background()
	ok := InitiateCommand{CheckID: "c", AmountCents: 100, Currency: "NZD", TenderType: TenderCard, IdempotencyKey: "key-0123456789abcdef"}
	var invalidErr *ValidationError
	for name, mutate := range map[string]func(*InitiateCommand){
		"short key":   func(c *InitiateCommand) { c.IdempotencyKey = "short" },
		"zero amount": func(c *InitiateCommand) { c.AmountCents = 0 },
		"negative":    func(c *InitiateCommand) { c.AmountCents = -5 },
		"currency":    func(c *InitiateCommand) { c.Currency = "nzd" },
		"voucher":     func(c *InitiateCommand) { c.TenderType = "voucher" },
	} {
		cmd := ok
		mutate(&cmd)
		if _, _, err := svc.Initiate(ctx, cmd); !errors.As(err, &invalidErr) {
			t.Errorf("%s: %v", name, err)
		}
	}
	empty, long := "", string(make([]rune, MaxReferenceLength+1))
	for name, cmd := range map[string]ResultCommand{
		"pending is not a result": {Outcome: StatusPending, Actor: Adapter{ID: "a"}},
		"unknown outcome":         {Outcome: "declined", Actor: Adapter{ID: "a"}},
		"empty reference":         {Outcome: StatusFailed, Reference: &empty, Actor: Adapter{ID: "a"}},
		"long reference":          {Outcome: StatusFailed, Reference: &long, Actor: Adapter{ID: "a"}},
		"no adapter":              {Outcome: StatusFailed},
	} {
		if _, _, err := svc.RecordResult(ctx, cmd); !errors.As(err, &invalidErr) {
			t.Errorf("%s: %v", name, err)
		}
	}
	readOnly := NewService(unreachable{t}, false)
	if _, _, err := readOnly.Initiate(ctx, ok); !errors.Is(err, ErrWritesDisabled) {
		t.Errorf("read-only initiate: %v", err)
	}
	if _, _, err := readOnly.RecordResult(ctx, ResultCommand{Outcome: StatusFailed, Actor: Adapter{ID: "a"}}); !errors.Is(err, ErrWritesDisabled) {
		t.Errorf("read-only result: %v", err)
	}
}
