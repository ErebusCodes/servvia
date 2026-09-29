package kitchen

import (
	"context"
	"strings"
)

// Filter selects tickets of one venue.
type Filter struct {
	// Station is optional; empty means every station.
	Station string
	// Statuses to include; empty means ActiveStatuses.
	Statuses []Status
}

// TransitionCommand moves a ticket to To, having read ExpectedVersion.
type TransitionCommand struct {
	VenueID         string
	TicketID        string
	To              Status
	ExpectedVersion int
	Actor           Actor
}

// Repository persists tickets. Transition must lock the ticket, apply
// Decide under the lock, and on a change bump the version, stamp the stage
// and record a KitchenTicketTransition in the same transaction.
type Repository interface {
	List(ctx context.Context, venueID string, f Filter) ([]Ticket, error)
	Get(ctx context.Context, venueID, ticketID string) (Ticket, error)
	Transition(ctx context.Context, cmd TransitionCommand) (Ticket, bool, error)
}

// Decide is the transition rule applied to the locked ticket: changed=false
// with no error when the ticket is already in the requested status (a retry
// of a transition that succeeded is not a conflict).
func Decide(t Ticket, cmd TransitionCommand) (changed bool, err error) {
	if t.Status == cmd.To {
		return false, nil
	}
	if t.Version != cmd.ExpectedVersion {
		return false, &VersionConflictError{Current: t.Version}
	}
	if !t.Status.CanBecome(cmd.To) {
		return false, &TransitionError{From: t.Status, To: cmd.To}
	}
	return true, nil
}

// Service is the kitchen application service.
type Service struct {
	repo          Repository
	writesEnabled bool
}

func NewService(repo Repository, writesEnabled bool) *Service {
	return &Service{repo: repo, writesEnabled: writesEnabled}
}

// List returns a venue's tickets, oldest first.
func (s *Service) List(ctx context.Context, venueID string, f Filter) ([]Ticket, error) {
	if f.Station != "" && !ValidStation(f.Station) {
		return nil, invalid("station must be 1 to 40 characters of a-z, 0-9, _ or -")
	}
	for _, st := range f.Statuses {
		if !st.Valid() {
			return nil, invalid("status must be one of new, acknowledged, preparing, ready, completed, recalled")
		}
	}
	if len(f.Statuses) == 0 {
		f.Statuses = ActiveStatuses
	}
	return s.repo.List(ctx, venueID, f)
}

func (s *Service) Get(ctx context.Context, venueID, ticketID string) (Ticket, error) {
	return s.repo.Get(ctx, venueID, ticketID)
}

// Transition moves a ticket. changed=false means it was already in the
// requested status and nothing was written.
func (s *Service) Transition(ctx context.Context, cmd TransitionCommand) (Ticket, bool, error) {
	if !cmd.To.Valid() || cmd.To == StatusNew {
		return Ticket{}, false, invalid("to must be one of acknowledged, preparing, ready, completed, recalled")
	}
	if cmd.ExpectedVersion < 1 {
		return Ticket{}, false, invalid("version must be a positive integer")
	}
	if strings.TrimSpace(cmd.Actor.ID) == "" {
		return Ticket{}, false, invalid("actor is required")
	}
	if !s.writesEnabled {
		return Ticket{}, false, ErrWritesDisabled
	}
	return s.repo.Transition(ctx, cmd)
}
