package tables

import (
	"context"
	"errors"
	"strings"
	"testing"
)

func TestCoversBounds(t *testing.T) {
	for covers, ok := range map[int]bool{-1: false, 0: false, 1: true, 12: true, 99: true, 100: false} {
		if err := ValidateCovers(covers); (err == nil) != ok {
			t.Errorf("covers %d: err = %v", covers, err)
		}
	}
	var v *ValidationError
	if !errors.As(ValidateCovers(0), &v) || v.Message != "covers must be an integer between 1 and 99" {
		t.Errorf("message %v", ValidateCovers(0))
	}
}

func TestRequestKeyBounds(t *testing.T) {
	for key, ok := range map[string]bool{
		"": false, strings.Repeat("k", 15): false, strings.Repeat("k", 16): true,
		strings.Repeat("k", 255): true, strings.Repeat("k", 256): false,
		// Characters, not bytes, as PostgreSQL's char_length counts them.
		strings.Repeat("é", 16): true, strings.Repeat("é", 255): true,
	} {
		if err := ValidateRequestKey(key); (err == nil) != ok {
			t.Errorf("key of %d runes: err = %v", len([]rune(key)), err)
		}
	}
}

func TestLifecycle(t *testing.T) {
	for from, allowed := range map[Status][]Status{
		StatusOpen:      {StatusClosed, StatusCancelled},
		StatusClosed:    nil,
		StatusCancelled: nil,
	} {
		for _, to := range []Status{StatusOpen, StatusClosed, StatusCancelled} {
			want := false
			for _, a := range allowed {
				want = want || a == to
			}
			if got := from.CanBecome(to); got != want {
				t.Errorf("%s -> %s = %v, want %v", from, to, got, want)
			}
		}
	}
}

func TestCheckChange(t *testing.T) {
	open := Session{Status: StatusOpen, Version: 3}
	if err := open.CheckChange(3); err != nil {
		t.Errorf("current version: %v", err)
	}
	var stale *VersionConflictError
	if err := open.CheckChange(2); !errors.As(err, &stale) || stale.Current != 3 {
		t.Errorf("stale version: %v", err)
	}
	var ended *NotOpenError
	closed := Session{Status: StatusClosed, Version: 4}
	if err := closed.CheckChange(4); !errors.As(err, &ended) || ended.Status != StatusClosed {
		t.Errorf("closed session: %v", err)
	}
	// An ended session is reported as ended even with a stale version.
	if err := closed.CheckChange(1); !errors.As(err, &ended) {
		t.Errorf("closed and stale: %v", err)
	}
}

func TestCloseReadiness(t *testing.T) {
	if !(CloseReadiness{}).Closeable() {
		t.Error("nothing outstanding must be closeable")
	}
	for _, r := range []CloseReadiness{{OpenChecks: 1}, {UnbilledLines: 1}, {UnresolvedPayments: 1}, {UnresolvedAdjustments: 1}} {
		if r.Closeable() {
			t.Errorf("%+v must not be closeable", r)
		}
	}
}

func TestIdempotentEnd(t *testing.T) {
	st := func(s Status) *Status { return &s }
	for _, c := range []struct {
		session Status
		to      *Status
		want    bool
	}{
		{StatusClosed, st(StatusClosed), true},
		{StatusCancelled, st(StatusCancelled), true},
		{StatusClosed, st(StatusCancelled), false},
		{StatusCancelled, st(StatusClosed), false},
		{StatusOpen, st(StatusClosed), false},
		{StatusOpen, st(StatusOpen), false},
		{StatusClosed, nil, false}, // a covers update is never a retry
	} {
		if got := (Session{Status: c.session}).IdempotentEnd(c.to); got != c.want {
			t.Errorf("%s, to %v: %v", c.session, c.to, got)
		}
	}
}

// recordingRepo fails the test if the service reaches it when it should not.
type recordingRepo struct {
	Repository
	t      *testing.T
	called bool
}

func (r *recordingRepo) Open(context.Context, OpenCommand) (Session, bool, error) {
	r.called = true
	return Session{ID: "s"}, true, nil
}

func (r *recordingRepo) Change(context.Context, ChangeCommand) (Session, error) {
	r.called = true
	return Session{ID: "s"}, nil
}

func TestServiceValidatesBeforeTouchingTheRepository(t *testing.T) {
	ctx, sc, a := context.Background(), Scope{}, Actor{}
	key := strings.Repeat("k", 16)
	for name, call := range map[string]func(*Service) error{
		"open, covers 0": func(s *Service) error { _, _, err := s.Open(ctx, OpenCommand{Covers: 0, RequestKey: key}); return err },
		"open, short key": func(s *Service) error {
			_, _, err := s.Open(ctx, OpenCommand{Covers: 2, RequestKey: "short"})
			return err
		},
		"covers 100":         func(s *Service) error { _, err := s.UpdateCovers(ctx, sc, "s", 1, 100, a); return err },
		"covers, version 0":  func(s *Service) error { _, err := s.UpdateCovers(ctx, sc, "s", 0, 2, a); return err },
		"close, version 0":   func(s *Service) error { _, err := s.Close(ctx, sc, "s", 0, a); return err },
		"cancel, version -1": func(s *Service) error { _, err := s.Cancel(ctx, sc, "s", -1, a); return err },
	} {
		repo := &recordingRepo{t: t}
		var v *ValidationError
		if err := call(NewService(repo, true)); !errors.As(err, &v) || repo.called {
			t.Errorf("%s: err = %v, repository called = %v", name, err, repo.called)
		}
	}
}

func TestServiceRefusesChangesOnAReadOnlyInstance(t *testing.T) {
	ctx, a := context.Background(), Actor{}
	repo := &recordingRepo{t: t}
	svc := NewService(repo, false)
	if _, _, err := svc.Open(ctx, OpenCommand{Covers: 2, RequestKey: strings.Repeat("k", 16)}); !errors.Is(err, ErrWritesDisabled) {
		t.Errorf("open: %v", err)
	}
	if _, err := svc.UpdateCovers(ctx, Scope{}, "s", 1, 2, a); !errors.Is(err, ErrWritesDisabled) {
		t.Errorf("covers: %v", err)
	}
	if _, err := svc.Close(ctx, Scope{}, "s", 1, a); !errors.Is(err, ErrWritesDisabled) {
		t.Errorf("close: %v", err)
	}
	if repo.called {
		t.Error("a read-only instance must not reach the repository for a change")
	}
	svc = NewService(repo, true)
	if _, err := svc.Cancel(ctx, Scope{}, "s", 1, a); err != nil || !repo.called {
		t.Errorf("writable: %v", err)
	}
}
