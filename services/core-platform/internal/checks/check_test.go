package checks

import (
	"context"
	"errors"
	"testing"

	"servvia/services/core-platform/internal/pricing"
)

func ptr(s string) *string { return &s }

func TestFingerprintIsTheRequestIdentity(t *testing.T) {
	a := Fingerprint("v", nil, []string{"ORD-2", "ORD-1", "ORD-2"})
	if a != Fingerprint("v", nil, []string{"ORD-1", "ORD-2"}) {
		t.Error("order and duplicates of orderIds must not matter")
	}
	for name, other := range map[string]string{
		"another order set": Fingerprint("v", nil, []string{"ORD-1"}),
		"another venue":     Fingerprint("w", nil, []string{"ORD-1", "ORD-2"}),
		"a session":         Fingerprint("v", ptr("ORD-1"), nil),
	} {
		if other == a {
			t.Errorf("%s has the same fingerprint", name)
		}
	}
	if Fingerprint("v", ptr("s1"), nil) == Fingerprint("v", ptr("s2"), nil) {
		t.Error("sessions collide")
	}
}

func TestDecideVoid(t *testing.T) {
	open := Check{Status: StatusOpen, Version: 2}
	if changed, err := DecideVoid(open, 2); !changed || err != nil {
		t.Errorf("void: %v %v", changed, err)
	}
	var conflict *VersionConflictError
	if _, err := DecideVoid(open, 1); !errors.As(err, &conflict) || conflict.Current != 2 {
		t.Errorf("stale: %v", err)
	}
	if changed, err := DecideVoid(Check{Status: StatusVoided, Version: 3}, 2); changed || err != nil {
		t.Errorf("already voided is a no-op: %v %v", changed, err)
	}
}

// unreachable fails any repository use: validation must refuse first.
type unreachable struct{ t *testing.T }

func (u unreachable) FindByKey(context.Context, string, string) (Check, string, bool, error) {
	u.t.Error("repository reached")
	return Check{}, "", false, nil
}
func (u unreachable) Get(context.Context, string, string) (Check, error) { return Check{}, nil }
func (u unreachable) List(context.Context, string, Filter) ([]Check, error) {
	u.t.Error("repository reached")
	return nil, nil
}
func (u unreachable) Create(context.Context, NewCheck) (Check, error) {
	u.t.Error("repository reached")
	return Check{}, nil
}
func (u unreachable) Void(context.Context, VoidCommand) (Check, bool, error) {
	u.t.Error("repository reached")
	return Check{}, false, nil
}
func (unreachable) Audit(context.Context, Scope, Actor, string, string, map[string]any) {}

func TestValidation(t *testing.T) {
	svc := NewService(unreachable{t}, true)
	ctx := context.Background()
	key := "key-0123456789abcdef"
	many := make([]string, MaxOrders+1)
	for i := range many {
		many[i] = "ORD"
	}
	var invalidErr *ValidationError
	for name, cmd := range map[string]CreateCommand{
		"short key":        {OrderIDs: []string{"ORD-1"}, IdempotencyKey: "short"},
		"neither":          {IdempotencyKey: key},
		"both":             {TableSessionID: ptr("s"), OrderIDs: []string{"ORD-1"}, IdempotencyKey: key},
		"empty session id": {TableSessionID: ptr(" "), IdempotencyKey: key},
		"empty order id":   {OrderIDs: []string{""}, IdempotencyKey: key},
		"too many orders":  {OrderIDs: many, IdempotencyKey: key},
	} {
		if _, _, err := svc.Create(ctx, cmd); !errors.As(err, &invalidErr) {
			t.Errorf("%s: %v", name, err)
		}
	}
	for name, cmd := range map[string]VoidCommand{
		"no version":  {Reason: "wrong table"},
		"no reason":   {ExpectedVersion: 1, Reason: "  "},
		"long reason": {ExpectedVersion: 1, Reason: string(make([]rune, MaxVoidReason+1))},
	} {
		if _, _, err := svc.Void(ctx, cmd); !errors.As(err, &invalidErr) {
			t.Errorf("%s: %v", name, err)
		}
	}
	if _, err := svc.List(ctx, Scope{}, Filter{Statuses: []Status{"paid"}}); !errors.As(err, &invalidErr) {
		t.Errorf("paid is not a check status: %v", err)
	}
	readOnly := NewService(unreachable{t}, false)
	if _, _, err := readOnly.Create(ctx, CreateCommand{OrderIDs: []string{"ORD-1"}, IdempotencyKey: key}); !errors.Is(err, ErrWritesDisabled) {
		t.Errorf("read-only create: %v", err)
	}
	if _, _, err := readOnly.Void(ctx, VoidCommand{ExpectedVersion: 1, Reason: "x"}); !errors.Is(err, ErrWritesDisabled) {
		t.Errorf("read-only void: %v", err)
	}
}

// replayRepo holds one existing check under a key.
type replayRepo struct {
	unreachable
	existing    Check
	fingerprint string
	audits      *[]string
}

func (r replayRepo) FindByKey(context.Context, string, string) (Check, string, bool, error) {
	return r.existing, r.fingerprint, true, nil
}
func (r replayRepo) Audit(_ context.Context, _ Scope, _ Actor, action, _ string, _ map[string]any) {
	*r.audits = append(*r.audits, action)
}

func TestReplayAndConflictAreDecidedByFingerprint(t *testing.T) {
	var audits []string
	scope := Scope{Venue: pricing.Venue{ID: "v"}}
	existing := Check{ID: "chk-1"}
	svc := NewService(replayRepo{unreachable{t}, existing, Fingerprint("v", nil, []string{"ORD-1"}), &audits}, true)
	key := "key-0123456789abcdef"

	c, created, err := svc.Create(context.Background(), CreateCommand{Scope: scope, OrderIDs: []string{"ORD-1", "ORD-1"}, IdempotencyKey: key})
	if err != nil || created || c.ID != "chk-1" {
		t.Errorf("replay: %v %v %v", c.ID, created, err)
	}
	var conflict *IdempotencyConflictError
	if _, _, err := svc.Create(context.Background(), CreateCommand{Scope: scope, OrderIDs: []string{"ORD-2"}, IdempotencyKey: key}); !errors.As(err, &conflict) || conflict.CheckID != "chk-1" {
		t.Errorf("conflict: %v", err)
	}
	if len(audits) != 2 || audits[0] != "CHECK_IDEMPOTENT_REPLAY" || audits[1] != "CHECK_IDEMPOTENCY_CONFLICT" {
		t.Errorf("audits %v", audits)
	}
}
