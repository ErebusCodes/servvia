// Package tables is Servvia Core's table and table-session domain (ADR 0001,
// Phase D2).
//
// A Session (TableSession in the schema) is one dining visit occupying a
// table: how many guests, who opened it, when it ended. It is not an order, a
// check, a payment or kitchen state. Open means only "this table is occupied
// by this visit". Orders, rounds and checks attach to it in later phases.
//
// The package holds the rules and the application service. It has no HTTP,
// SQL or client dependency: persistence is behind Repository (implemented in
// tables/pgstore) and transport lives in tables/tablesapi.
package tables

import (
	"errors"
	"strconv"
	"time"
)

// Status is the session lifecycle: open, then closed (the visit ended) or
// cancelled (opened in error). Both end states are terminal.
type Status string

const (
	StatusOpen      Status = "open"
	StatusClosed    Status = "closed"
	StatusCancelled Status = "cancelled"
)

// CanBecome reports whether a session in s may move to next.
func (s Status) CanBecome(next Status) bool {
	return s == StatusOpen && (next == StatusClosed || next == StatusCancelled)
}

// Bounds shared with the legacy order path, so the two models agree while
// both exist: Order.guests is 1..99 (CreateStaffOrderDto) and idempotency
// keys are 16..255 characters (Order.idempotencyKey). The database enforces
// the same bounds (migration 20260929000000_table_sessions).
const (
	MinCovers     = 1
	MaxCovers     = 99
	MinRequestKey = 16
	MaxRequestKey = 255
)

// Session is one visit at one table.
type Session struct {
	ID      string
	VenueID string
	TableID string
	// TableNumber is the table's display number, read from the table.
	TableNumber string
	Status      Status
	Covers      int
	// OpenedByStaffID is nil only if that staff row was deleted since.
	OpenedByStaffID *string
	// Version increments on every change. A change must name the version it
	// read (optimistic concurrency); a stale one is refused.
	Version   int
	OpenedAt  time.Time
	ClosedAt  *time.Time
	CreatedAt time.Time
	UpdatedAt time.Time
}

// CloseReadiness is the server's verdict on whether a visit may close (Phase
// D10): the D9 financial-completeness rule, as four counts that must all be
// zero. It is computed by the repository from checks, payments, returns of
// money and order lines; the client never asserts it.
type CloseReadiness struct {
	// OpenChecks: standing checks not settled (voided checks do not count).
	OpenChecks int
	// UnbilledLines: accepted round lines of the visit's non-cancelled
	// orders on no standing check.
	UnbilledLines int
	// UnresolvedPayments: payments pending or uncertain.
	UnresolvedPayments int
	// UnresolvedAdjustments: refunds and reversals pending or uncertain.
	UnresolvedAdjustments int
}

// Closeable reports whether the visit is financially complete. Kitchen state
// and order status are deliberately not part of it.
func (r CloseReadiness) Closeable() bool {
	return r.OpenChecks == 0 && r.UnbilledLines == 0 && r.UnresolvedPayments == 0 && r.UnresolvedAdjustments == 0
}

// IdempotentEnd reports whether a change is a retry of the end state the
// session already has (close of a closed session, cancel of a cancelled
// one): it succeeds with no effect, whatever version was sent.
func (s Session) IdempotentEnd(to *Status) bool {
	return to != nil && *to != StatusOpen && s.Status == *to
}

// CheckChange decides whether a change that read expectedVersion may be
// applied to s now: the session must still be open and unchanged since.
func (s Session) CheckChange(expectedVersion int) error {
	if s.Status != StatusOpen {
		return &NotOpenError{Status: s.Status}
	}
	if s.Version != expectedVersion {
		return &VersionConflictError{Current: s.Version}
	}
	return nil
}

// ValidateCovers checks a guest count.
func ValidateCovers(covers int) error {
	if covers < MinCovers || covers > MaxCovers {
		return invalid("covers must be an integer between " + strconv.Itoa(MinCovers) + " and " + strconv.Itoa(MaxCovers))
	}
	return nil
}

// ValidateRequestKey checks an open request's idempotency key.
func ValidateRequestKey(key string) error {
	if n := len([]rune(key)); n < MinRequestKey || n > MaxRequestKey {
		return invalid("idempotencyKey must be a string of " + strconv.Itoa(MinRequestKey) + " to " +
			strconv.Itoa(MaxRequestKey) + " characters")
	}
	return nil
}

// ValidateVersion checks a version a client says it read.
func ValidateVersion(v int) error {
	if v < 1 {
		return invalid("version must be a positive integer")
	}
	return nil
}

// Errors. The transport maps each to one status and code
// (contracts/openapi/table-sessions.yaml).
var (
	// ErrTableNotFound: no such table at this venue of this organization.
	ErrTableNotFound = errors.New("Table not found")
	// ErrTableInactive: the table exists but is not in service.
	ErrTableInactive = errors.New("Table is not in service")
	// ErrSessionNotFound: no such session at this venue.
	ErrSessionNotFound = errors.New("Table session not found")
	// ErrNoOpenSession: the table exists and has no open session.
	ErrNoOpenSession = errors.New("Table has no open session")
	// ErrTableHasActiveOrder: during the migration, a table occupied by an
	// active order of the NestJS order path (one with no table session)
	// cannot also be opened as a session. Removed with the Nest-side
	// occupancy bridge once table order creation runs in Servvia Core.
	ErrTableHasActiveOrder = errors.New("Table has an active order from the legacy order path")
	// ErrSessionHasOrders: a session with orders was not opened in error, so
	// it cannot be cancelled; it is closed instead.
	ErrSessionHasOrders = errors.New("Table session has orders and cannot be cancelled; close it instead")
	// ErrUnknownActor: the caller's staff identity does not exist.
	ErrUnknownActor = errors.New("Unknown staff identity")
	// ErrWritesDisabled: this instance runs with a read-only database.
	ErrWritesDisabled = errors.New("Table session changes are disabled on this instance")
)

// ValidationError is a malformed request.
type ValidationError struct{ Message string }

func (e *ValidationError) Error() string { return e.Message }

func invalid(msg string) error { return &ValidationError{Message: msg} }

// AlreadyOpenError: the table already has an open session, SessionID.
type AlreadyOpenError struct{ SessionID string }

func (e *AlreadyOpenError) Error() string { return "Table already has an open session" }

// NotOpenError: the session has ended and cannot change.
type NotOpenError struct{ Status Status }

func (e *NotOpenError) Error() string { return "Table session is " + string(e.Status) + ", not open" }

// NotCompleteError: the visit cannot close yet; Readiness says why.
type NotCompleteError struct{ Readiness CloseReadiness }

func (e *NotCompleteError) Error() string {
	return "The visit is not financially complete: settle every check, bill every round and resolve every payment and refund first"
}

// VersionConflictError: the session changed since the caller read it.
type VersionConflictError struct{ Current int }

func (e *VersionConflictError) Error() string {
	return "Table session was changed by someone else (now version " + strconv.Itoa(e.Current) + ")"
}
