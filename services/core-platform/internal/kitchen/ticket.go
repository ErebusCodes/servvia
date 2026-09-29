// Package kitchen is Servvia Core's kitchen-ticket domain (ADR 0001, Phase
// D4).
//
// A Ticket is what one kitchen station is expected to prepare for one order
// round, projected from the round's `order.round_submitted` outbox event. It
// is not the order: kitchen progress lives here and never in orders.Status,
// and nothing in this package changes an order. Nor is it a KDS screen's
// state: a display reads tickets and asks for transitions; the server decides.
//
// The package holds the rules, the routing seam and the application service.
// Persistence and the outbox projector are in kitchen/pgstore, transport in
// kitchen/kitchenapi. There is no printer, device or external-POS dependency.
package kitchen

import (
	"errors"
	"regexp"
	"strconv"
	"time"
)

// Status is a ticket's kitchen progress.
type Status string

const (
	StatusNew          Status = "new"
	StatusAcknowledged Status = "acknowledged"
	StatusPreparing    Status = "preparing"
	StatusReady        Status = "ready"
	StatusCompleted    Status = "completed"
	StatusRecalled     Status = "recalled"
)

// transitions: forward through the stages (acknowledging is optional), a
// completed (bumped) ticket may be recalled to the screen, and a recalled
// ticket goes back to work or is bumped again. There is no cancellation:
// voiding kitchen work needs order cancellation, which does not exist yet.
var transitions = map[Status][]Status{
	StatusNew:          {StatusAcknowledged, StatusPreparing},
	StatusAcknowledged: {StatusPreparing},
	StatusPreparing:    {StatusReady},
	StatusReady:        {StatusCompleted},
	StatusCompleted:    {StatusRecalled},
	StatusRecalled:     {StatusPreparing, StatusReady, StatusCompleted},
}

// Valid reports whether s is a ticket status.
func (s Status) Valid() bool {
	_, ok := transitions[s]
	return ok
}

// CanBecome reports whether a ticket in s may move to next.
func (s Status) CanBecome(next Status) bool {
	for _, n := range transitions[s] {
		if n == next {
			return true
		}
	}
	return false
}

// Active reports whether the ticket is still on the kitchen's screen.
func (s Status) Active() bool { return s.Valid() && s != StatusCompleted }

// ActiveStatuses are the statuses a kitchen screen shows by default.
var ActiveStatuses = []Status{StatusNew, StatusAcknowledged, StatusPreparing, StatusReady, StatusRecalled}

// Ticket is one station's work for one order round.
type Ticket struct {
	ID      string
	VenueID string
	OrderID string
	RoundID string
	Station string
	Status  Status
	// Version increments on every change. A change names the version it read.
	Version       int
	SourceEventID string
	// Display snapshots taken at projection.
	RoundSequence     int
	TableNumber       *string
	TakeawayReference *string
	OrderSource       string
	Lines             []Line
	AcknowledgedAt    *time.Time
	PreparingAt       *time.Time
	ReadyAt           *time.Time
	CompletedAt       *time.Time
	RecalledAt        *time.Time
	CreatedAt         time.Time
	UpdatedAt         time.Time
}

// Modifier is one resolved modifier as ordered (no price: the kitchen needs
// what to make, not what it costs).
type Modifier struct {
	GroupName  string `json:"groupName"`
	OptionName string `json:"optionName"`
}

// Line is one order line on a ticket: a snapshot of what was ordered.
type Line struct {
	ID          string
	OrderItemID string
	Position    int
	Title       string
	Quantity    int64
	Modifiers   []Modifier
	Notes       *string
	Seat        *int
}

// Actor is who changes a ticket: a staff member, or a KDS device identity.
type Actor struct {
	ID   string
	Kind string
	Role string
}

var stationPattern = regexp.MustCompile(`^[a-z0-9_-]{1,40}$`)

// ValidStation reports whether name is a well-formed station (the database
// enforces the same pattern).
func ValidStation(name string) bool { return stationPattern.MatchString(name) }

// Errors. The transport maps each to its contract response
// (contracts/openapi/kitchen-tickets.yaml).
var (
	ErrTicketNotFound = errors.New("Kitchen ticket not found")
	ErrWritesDisabled = errors.New("Kitchen ticket changes are disabled on this instance")
)

// ValidationError is a malformed request.
type ValidationError struct{ Message string }

func (e *ValidationError) Error() string { return e.Message }

func invalid(msg string) error { return &ValidationError{Message: msg} }

// TransitionError: the ticket's status does not allow the requested move.
type TransitionError struct{ From, To Status }

func (e *TransitionError) Error() string {
	return "A " + string(e.From) + " kitchen ticket cannot become " + string(e.To)
}

// VersionConflictError: the ticket changed since the caller read it.
type VersionConflictError struct{ Current int }

func (e *VersionConflictError) Error() string {
	return "Kitchen ticket was changed by someone else (now version " + strconv.Itoa(e.Current) + ")"
}
