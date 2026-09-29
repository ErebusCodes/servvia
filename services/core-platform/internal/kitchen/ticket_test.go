package kitchen

import (
	"context"
	"errors"
	"testing"
)

func TestTransitions(t *testing.T) {
	all := []Status{StatusNew, StatusAcknowledged, StatusPreparing, StatusReady, StatusCompleted, StatusRecalled}
	allowed := map[[2]Status]bool{
		{StatusNew, StatusAcknowledged}:       true,
		{StatusNew, StatusPreparing}:          true,
		{StatusAcknowledged, StatusPreparing}: true,
		{StatusPreparing, StatusReady}:        true,
		{StatusReady, StatusCompleted}:        true,
		{StatusCompleted, StatusRecalled}:     true,
		{StatusRecalled, StatusPreparing}:     true,
		{StatusRecalled, StatusReady}:         true,
		{StatusRecalled, StatusCompleted}:     true,
	}
	for _, from := range all {
		for _, to := range all {
			if got := from.CanBecome(to); got != allowed[[2]Status{from, to}] {
				t.Errorf("%s -> %s: %v", from, to, got)
			}
		}
	}
	// Nothing returns to new, and there is no cancellation.
	for _, from := range all {
		if from.CanBecome(StatusNew) || from.CanBecome("cancelled") {
			t.Errorf("%s may become new or cancelled", from)
		}
	}
	if Status("cancelled").Valid() || StatusCompleted.Active() || !StatusRecalled.Active() {
		t.Error("validity or activity wrong")
	}
}

func TestDecide(t *testing.T) {
	ticket := Ticket{Status: StatusPreparing, Version: 3}
	cmd := func(to Status, version int) TransitionCommand {
		return TransitionCommand{To: to, ExpectedVersion: version}
	}

	if changed, err := Decide(ticket, cmd(StatusReady, 3)); !changed || err != nil {
		t.Errorf("allowed move: %v %v", changed, err)
	}
	// Asking for the current status is a no-op, whatever version was read:
	// a retried transition that already succeeded.
	if changed, err := Decide(ticket, cmd(StatusPreparing, 2)); changed || err != nil {
		t.Errorf("same status: %v %v", changed, err)
	}
	var version *VersionConflictError
	if _, err := Decide(ticket, cmd(StatusReady, 2)); !errors.As(err, &version) || version.Current != 3 {
		t.Errorf("stale version: %v", err)
	}
	var transition *TransitionError
	if _, err := Decide(ticket, cmd(StatusCompleted, 3)); !errors.As(err, &transition) || transition.From != StatusPreparing {
		t.Errorf("skipping ready: %v", err)
	}
}

func TestValidStation(t *testing.T) {
	for _, ok := range []string{"kitchen", "bar", "cold_2", "pass-1"} {
		if !ValidStation(ok) {
			t.Errorf("%q refused", ok)
		}
	}
	for _, bad := range []string{"", "Kitchen", "hot kitchen", "a/b", "abcdefghijklmnopqrstuvwxyzabcdefghijklmno"} {
		if ValidStation(bad) {
			t.Errorf("%q accepted", bad)
		}
	}
	if (SingleStation{Name: DefaultStation}).Station(RouteLine{MenuItemID: "x", Category: "Desserts"}) != "kitchen" {
		t.Error("single station routes elsewhere")
	}
}

type recordingRepo struct{ filter *Filter }

func (r recordingRepo) List(_ context.Context, _ string, f Filter) ([]Ticket, error) {
	*r.filter = f
	return nil, nil
}
func (recordingRepo) Get(context.Context, string, string) (Ticket, error) { return Ticket{}, nil }
func (recordingRepo) Transition(context.Context, TransitionCommand) (Ticket, bool, error) {
	return Ticket{}, true, nil
}

func TestServiceValidation(t *testing.T) {
	var seen Filter
	svc := NewService(recordingRepo{&seen}, true)
	ctx := context.Background()
	var invalidErr *ValidationError

	if _, err := svc.List(ctx, "v", Filter{}); err != nil || len(seen.Statuses) != len(ActiveStatuses) {
		t.Errorf("default filter: %v %+v", err, seen)
	}
	if _, err := svc.List(ctx, "v", Filter{Statuses: []Status{"cooking"}}); !errors.As(err, &invalidErr) {
		t.Errorf("unknown status: %v", err)
	}
	if _, err := svc.List(ctx, "v", Filter{Station: "Hot Line"}); !errors.As(err, &invalidErr) {
		t.Errorf("bad station: %v", err)
	}

	actor := Actor{ID: "kds-device:v", Kind: "kds_device", Role: "kitchen"}
	for name, cmd := range map[string]TransitionCommand{
		"to new":       {To: StatusNew, ExpectedVersion: 1, Actor: actor},
		"unknown":      {To: "cooking", ExpectedVersion: 1, Actor: actor},
		"zero version": {To: StatusReady, Actor: actor},
		"no actor":     {To: StatusReady, ExpectedVersion: 1},
	} {
		if _, _, err := svc.Transition(ctx, cmd); !errors.As(err, &invalidErr) {
			t.Errorf("%s: %v", name, err)
		}
	}
	readOnly := NewService(recordingRepo{&seen}, false)
	if _, _, err := readOnly.Transition(ctx, TransitionCommand{To: StatusReady, ExpectedVersion: 1, Actor: actor}); !errors.Is(err, ErrWritesDisabled) {
		t.Errorf("read-only: %v", err)
	}
	if _, err := readOnly.List(ctx, "v", Filter{}); err != nil {
		t.Errorf("reads work read-only: %v", err)
	}
}
