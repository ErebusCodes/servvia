package shifts

import (
	"context"
	"errors"
)

// Scope is the tenancy of every operation, with the venue's currency.
type Scope struct {
	OrganizationID string
	VenueID        string
	Currency       string
}

// OpenCommand opens the actor's own shift with an opening float, optionally
// at a terminal of the venue.
type OpenCommand struct {
	Scope             Scope
	OpeningFloatCents int64
	TerminalID        *string
	RequestKey        string
	Actor             Actor
}

// CloseCommand closes a shift with the cash counted in it.
type CloseCommand struct {
	Scope            Scope
	ShiftID          string
	ExpectedVersion  int
	CountedCashCents int64
	Actor            Actor
}

// Filter selects shifts of one venue.
type Filter struct {
	Status  Status
	StaffID string
}

// Repository persists shifts.
//
// Open inserts the shift and an AuditLog row in one transaction; a taken
// (venueId, openRequestKey) is ErrDuplicateKey and a second open shift for
// the same staff is *AlreadyOpenError (both by unique indexes). With a
// terminal, it holds the terminal FOR SHARE (a disable waits) and requires it
// active at the venue (ErrTerminalNotFound, ErrTerminalDisabled).
//
// Close locks the shift (FOR UPDATE: the lock a cash tender holds while it
// records its movement), applies DecideClose, computes expected cash from the
// movements under that lock, and stores the close facts with an AuditLog row.
type Repository interface {
	FindByKey(ctx context.Context, venueID, key string) (Shift, bool, error)
	Get(ctx context.Context, venueID, shiftID string) (Shift, error)
	List(ctx context.Context, venueID string, f Filter) ([]Shift, error)
	Open(ctx context.Context, cmd OpenCommand) (Shift, error)
	Close(ctx context.Context, cmd CloseCommand) (Shift, bool, error)
}

type Service struct {
	repo          Repository
	writesEnabled bool
}

func NewService(repo Repository, writesEnabled bool) *Service {
	return &Service{repo: repo, writesEnabled: writesEnabled}
}

// Get returns a shift the actor may see (their own, or any if they
// supervise); another staff member's shift is not found for a cashier.
func (s *Service) Get(ctx context.Context, scope Scope, actor Actor, shiftID string) (Shift, error) {
	sh, err := s.repo.Get(ctx, scope.VenueID, shiftID)
	if err != nil {
		return Shift{}, err
	}
	if !actor.MayAccess(sh) {
		return Shift{}, ErrShiftNotFound
	}
	return sh, nil
}

// List returns shifts, newest first. A staff member who does not supervise
// sees only their own.
func (s *Service) List(ctx context.Context, scope Scope, actor Actor, f Filter) ([]Shift, error) {
	if f.Status != "" && f.Status != StatusOpen && f.Status != StatusClosed {
		return nil, invalid("status must be one of open, closed")
	}
	if !actor.Supervises() {
		f.StaffID = actor.StaffID
	}
	return s.repo.List(ctx, scope.VenueID, f)
}

// Open opens the actor's shift, or returns the one this key already opened
// for the same float (created=false).
func (s *Service) Open(ctx context.Context, cmd OpenCommand) (Shift, bool, error) {
	switch n := len([]rune(cmd.RequestKey)); {
	case n < MinKeyLength || n > MaxKeyLength:
		return Shift{}, false, invalid("idempotencyKey must be a string of 16 to 255 characters")
	case cmd.OpeningFloatCents < 0 || cmd.OpeningFloatCents > MaxCents:
		return Shift{}, false, invalid("openingFloatCents must be an integer from 0 to 2147483647")
	case cmd.TerminalID != nil && *cmd.TerminalID == "":
		return Shift{}, false, invalid("terminalId must not be empty")
	}
	if !s.writesEnabled {
		return Shift{}, false, ErrWritesDisabled
	}
	if existing, found, err := s.repo.FindByKey(ctx, cmd.Scope.VenueID, cmd.RequestKey); err != nil {
		return Shift{}, false, err
	} else if found {
		return replay(cmd, existing)
	}
	sh, err := s.repo.Open(ctx, cmd)
	if errors.Is(err, ErrDuplicateKey) {
		existing, found, ferr := s.repo.FindByKey(ctx, cmd.Scope.VenueID, cmd.RequestKey)
		if ferr != nil || !found {
			return Shift{}, false, errors.Join(err, ferr)
		}
		return replay(cmd, existing)
	}
	if err != nil {
		return Shift{}, false, err
	}
	return sh, true, nil
}

func replay(cmd OpenCommand, existing Shift) (Shift, bool, error) {
	sameTerminal := (existing.TerminalID == nil) == (cmd.TerminalID == nil) &&
		(existing.TerminalID == nil || *existing.TerminalID == *cmd.TerminalID)
	if existing.StaffID == cmd.Actor.StaffID && existing.OpeningFloatCents == cmd.OpeningFloatCents && sameTerminal {
		return existing, false, nil
	}
	return Shift{}, false, &IdempotencyConflictError{Key: cmd.RequestKey, ShiftID: existing.ID}
}

// Close closes a shift the actor may close. changed=false means it was
// already closed with the same count.
func (s *Service) Close(ctx context.Context, cmd CloseCommand) (Shift, bool, error) {
	switch {
	case cmd.ExpectedVersion < 1:
		return Shift{}, false, invalid("version must be a positive integer")
	case cmd.CountedCashCents < 0 || cmd.CountedCashCents > MaxCents:
		return Shift{}, false, invalid("countedCashCents must be an integer from 0 to 2147483647")
	}
	if !s.writesEnabled {
		return Shift{}, false, ErrWritesDisabled
	}
	if _, err := s.Get(ctx, cmd.Scope, cmd.Actor, cmd.ShiftID); err != nil {
		return Shift{}, false, err // not found, or not the actor's to close
	}
	return s.repo.Close(ctx, cmd)
}
