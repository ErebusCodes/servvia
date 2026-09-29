package shifts

import (
	"context"
	"errors"
	"testing"
)

func i64(n int64) *int64 { return &n }

func TestExpectedCash(t *testing.T) {
	if ExpectedCash(5000, 2549, 0) != 7549 || ExpectedCash(5000, 2549, 500) != 7049 {
		t.Error("expected cash is float plus cash sales less cash refunds")
	}
	open := Shift{OpeningFloatCents: 5000, CashSalesCents: 100}
	if open.Expected() != 5100 {
		t.Error("an open shift's expected cash is live")
	}
	closed := Shift{OpeningFloatCents: 5000, CashSalesCents: 999, ExpectedCashCents: i64(5100)}
	if closed.Expected() != 5100 {
		t.Error("a closed shift's expected cash is the stored figure")
	}
}

func TestDecideClose(t *testing.T) {
	open := Shift{Status: StatusOpen, Version: 2}
	if changed, err := DecideClose(open, 2, 100); !changed || err != nil {
		t.Errorf("close: %v %v", changed, err)
	}
	var conflict *VersionConflictError
	if _, err := DecideClose(open, 1, 100); !errors.As(err, &conflict) || conflict.Current != 2 {
		t.Errorf("stale: %v", err)
	}
	closed := Shift{Status: StatusClosed, Version: 3, CountedCashCents: i64(100)}
	if changed, err := DecideClose(closed, 2, 100); changed || err != nil {
		t.Errorf("repeated close with the same count: %v %v", changed, err)
	}
	var notOpen *NotOpenError
	if _, err := DecideClose(closed, 3, 101); !errors.As(err, &notOpen) {
		t.Errorf("a different count for a closed shift: %v", err)
	}
}

func TestAccess(t *testing.T) {
	mine := Shift{StaffID: "cashier-1"}
	for role, want := range map[string]bool{"owner": true, "admin": true, "manager": true, "cashier": false} {
		a := Actor{StaffID: "someone-else", Role: role}
		if a.MayAccess(mine) != want {
			t.Errorf("%s on another's shift: %v", role, !want)
		}
	}
	if !(Actor{StaffID: "cashier-1", Role: "cashier"}).MayAccess(mine) {
		t.Error("a cashier may access their own shift")
	}
}

type recordingRepo struct {
	filter *Filter
	shift  Shift
}

func (r recordingRepo) FindByKey(context.Context, string, string) (Shift, bool, error) {
	return r.shift, r.shift.ID != "", nil
}
func (r recordingRepo) Get(context.Context, string, string) (Shift, error) { return r.shift, nil }
func (r recordingRepo) List(_ context.Context, _ string, f Filter) ([]Shift, error) {
	*r.filter = f
	return nil, nil
}
func (recordingRepo) Open(context.Context, OpenCommand) (Shift, error) { return Shift{ID: "new"}, nil }
func (recordingRepo) Close(context.Context, CloseCommand) (Shift, bool, error) {
	return Shift{}, true, nil
}

func TestService(t *testing.T) {
	ctx := context.Background()
	var seen Filter
	cashier := Actor{StaffID: "cashier-1", Role: "cashier"}
	svc := NewService(recordingRepo{filter: &seen}, true)
	if _, err := svc.List(ctx, Scope{}, cashier, Filter{StaffID: "someone-else"}); err != nil || seen.StaffID != "cashier-1" {
		t.Errorf("a cashier lists only their own shifts: %+v %v", seen, err)
	}
	manager := Actor{StaffID: "m", Role: "manager"}
	if _, err := svc.List(ctx, Scope{}, manager, Filter{StaffID: "cashier-1"}); err != nil || seen.StaffID != "cashier-1" {
		t.Errorf("a manager filters freely: %+v %v", seen, err)
	}
	var invalidErr *ValidationError
	for name, cmd := range map[string]OpenCommand{
		"short key":      {RequestKey: "short", Actor: cashier},
		"negative float": {RequestKey: "key-0123456789abcdef", OpeningFloatCents: -1, Actor: cashier},
		"huge float":     {RequestKey: "key-0123456789abcdef", OpeningFloatCents: MaxCents + 1, Actor: cashier},
	} {
		if _, _, err := svc.Open(ctx, cmd); !errors.As(err, &invalidErr) {
			t.Errorf("%s: %v", name, err)
		}
	}
	for name, cmd := range map[string]CloseCommand{
		"no version":     {CountedCashCents: 1, Actor: cashier},
		"negative count": {ExpectedVersion: 1, CountedCashCents: -1, Actor: cashier},
	} {
		if _, _, err := svc.Close(ctx, cmd); !errors.As(err, &invalidErr) {
			t.Errorf("%s: %v", name, err)
		}
	}
	// Replays: the same staff and float return the shift; anything else
	// conflicts.
	existing := Shift{ID: "s1", StaffID: "cashier-1", OpeningFloatCents: 500}
	replaying := NewService(recordingRepo{filter: &seen, shift: existing}, true)
	if s, created, err := replaying.Open(ctx, OpenCommand{RequestKey: "key-0123456789abcdef", OpeningFloatCents: 500, Actor: cashier}); err != nil || created || s.ID != "s1" {
		t.Errorf("replay: %v %v %v", s.ID, created, err)
	}
	var conflict *IdempotencyConflictError
	if _, _, err := replaying.Open(ctx, OpenCommand{RequestKey: "key-0123456789abcdef", OpeningFloatCents: 600, Actor: cashier}); !errors.As(err, &conflict) {
		t.Errorf("different float: %v", err)
	}
	// A cashier cannot close another's shift: it is not found for them.
	other := NewService(recordingRepo{filter: &seen, shift: Shift{ID: "s2", StaffID: "cashier-2"}}, true)
	if _, _, err := other.Close(ctx, CloseCommand{ShiftID: "s2", ExpectedVersion: 1, Actor: cashier}); !errors.Is(err, ErrShiftNotFound) {
		t.Errorf("closing another's shift: %v", err)
	}
	if _, _, err := NewService(recordingRepo{filter: &seen}, false).Open(ctx, OpenCommand{RequestKey: "key-0123456789abcdef", Actor: cashier}); !errors.Is(err, ErrWritesDisabled) {
		t.Errorf("read-only: %v", err)
	}
}
