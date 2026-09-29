package tables

import "context"

// Scope is the tenancy every operation runs in. Repositories must match
// both: a session or table outside it does not exist for the caller.
type Scope struct {
	OrganizationID string
	VenueID        string
}

// Actor is the staff member performing a change, recorded on the session and
// in the audit log.
type Actor struct {
	StaffID string
	Email   string
	Role    string
}

// OpenCommand opens a table. RequestKey makes it idempotent: a retry with the
// same key on the same table returns the session the first attempt created.
type OpenCommand struct {
	Scope      Scope
	TableID    string
	Covers     int
	RequestKey string
	Actor      Actor
}

// ChangeCommand changes an open session that the caller read at
// ExpectedVersion: new covers, or a terminal status, never both.
type ChangeCommand struct {
	Scope           Scope
	SessionID       string
	ExpectedVersion int
	Covers          *int
	Status          *Status
	Actor           Actor
}

// Repository persists sessions. Every method is transactional and enforces
// Scope. Open must guarantee, in the database, that a table has at most one
// open session (returning *AlreadyOpenError otherwise) and that a repeated
// request key returns the original session with created=false. Change must
// lock the session, apply Session.CheckChange, and write only if the version
// is still ExpectedVersion.
type Repository interface {
	Open(ctx context.Context, cmd OpenCommand) (s Session, created bool, err error)
	Get(ctx context.Context, scope Scope, sessionID string) (Session, error)
	OpenForTable(ctx context.Context, scope Scope, tableID string) (Session, error)
	ListOpen(ctx context.Context, scope Scope) ([]Session, error)
	Change(ctx context.Context, cmd ChangeCommand) (Session, error)
}

// Service is the table-session application service.
type Service struct {
	repo          Repository
	writesEnabled bool
}

// NewService returns the service. With writesEnabled false (a read-only
// database) every change fails with ErrWritesDisabled before touching it.
func NewService(repo Repository, writesEnabled bool) *Service {
	return &Service{repo: repo, writesEnabled: writesEnabled}
}

// Open opens a session on a table, or returns the one this request key
// already opened (created=false).
func (s *Service) Open(ctx context.Context, cmd OpenCommand) (Session, bool, error) {
	if err := ValidateCovers(cmd.Covers); err != nil {
		return Session{}, false, err
	}
	if err := ValidateRequestKey(cmd.RequestKey); err != nil {
		return Session{}, false, err
	}
	if !s.writesEnabled {
		return Session{}, false, ErrWritesDisabled
	}
	return s.repo.Open(ctx, cmd)
}

func (s *Service) Get(ctx context.Context, scope Scope, sessionID string) (Session, error) {
	return s.repo.Get(ctx, scope, sessionID)
}

// OpenForTable returns the table's open session (ErrNoOpenSession if none).
func (s *Service) OpenForTable(ctx context.Context, scope Scope, tableID string) (Session, error) {
	return s.repo.OpenForTable(ctx, scope, tableID)
}

// ListOpen returns the venue's open sessions: the occupied tables.
func (s *Service) ListOpen(ctx context.Context, scope Scope) ([]Session, error) {
	return s.repo.ListOpen(ctx, scope)
}

// UpdateCovers changes the guest count of an open session.
func (s *Service) UpdateCovers(ctx context.Context, scope Scope, sessionID string, version, covers int, actor Actor) (Session, error) {
	if err := ValidateVersion(version); err != nil {
		return Session{}, err
	}
	if err := ValidateCovers(covers); err != nil {
		return Session{}, err
	}
	return s.change(ctx, ChangeCommand{Scope: scope, SessionID: sessionID, ExpectedVersion: version, Covers: &covers, Actor: actor})
}

// Close ends a visit.
func (s *Service) Close(ctx context.Context, scope Scope, sessionID string, version int, actor Actor) (Session, error) {
	return s.end(ctx, scope, sessionID, version, StatusClosed, actor)
}

// Cancel ends a session that was opened in error.
func (s *Service) Cancel(ctx context.Context, scope Scope, sessionID string, version int, actor Actor) (Session, error) {
	return s.end(ctx, scope, sessionID, version, StatusCancelled, actor)
}

func (s *Service) end(ctx context.Context, scope Scope, sessionID string, version int, to Status, actor Actor) (Session, error) {
	if err := ValidateVersion(version); err != nil {
		return Session{}, err
	}
	return s.change(ctx, ChangeCommand{Scope: scope, SessionID: sessionID, ExpectedVersion: version, Status: &to, Actor: actor})
}

func (s *Service) change(ctx context.Context, cmd ChangeCommand) (Session, error) {
	if !s.writesEnabled {
		return Session{}, ErrWritesDisabled
	}
	return s.repo.Change(ctx, cmd)
}
