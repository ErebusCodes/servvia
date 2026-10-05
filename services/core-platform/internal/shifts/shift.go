// Package shifts is Servvia Core's cash-accountability domain (ADR 0001,
// Phase D7).
//
// A Shift is a bounded period in which one staff member is accountable for
// the physical cash taken at one venue: an opening float, the cash sales
// recorded against it (CashMovement), and at close the count, the expected
// cash and the variance. It is not a table session, a check, a payment, a
// terminal or a cash drawer; there is no hardware here. Payments (package
// payments) own tender, balance and settlement; this package owns which
// shift a cash tender is accounted to and what the shift expects in cash.
//
// Persistence is behind Repository (shifts/pgstore, which also provides the
// Ledger used inside a cash payment's transaction); transport is
// shifts/shiftsapi.
package shifts

import (
	"errors"
	"strconv"
	"time"

	"servvia/services/core-platform/internal/audit"
	"servvia/services/core-platform/internal/identity"
)

// Status is a shift's lifecycle: open, then closed (final).
type Status string

const (
	StatusOpen   Status = "open"
	StatusClosed Status = "closed"
)

// MovementKind is the kind of a cash movement. cash_sale is cash accepted as
// a check payment; it adds to the shift's cash. cash_refund (Phase D9) is
// cash handed back for a refund; it takes from it.
type MovementKind string

const (
	KindCashSale   MovementKind = "cash_sale"
	KindCashRefund MovementKind = "cash_refund"
)

// Shift is one accountable cash period.
type Shift struct {
	ID                string
	VenueID           string
	StaffID           string
	Status            Status
	Currency          string
	OpeningFloatCents int64
	// TerminalID is the POS terminal the shift is worked from, if any
	// (Phase D8). Accountability stays with the staff member.
	TerminalID     *string
	OpenRequestKey string
	Version        int
	// CashSalesCents, CashRefundsCents and MovementCount summarize the
	// shift's movements.
	CashSalesCents   int64
	CashRefundsCents int64
	MovementCount    int
	OpenedAt         time.Time
	// Close facts, set exactly when closed and never changed after.
	ClosedAt          *time.Time
	ClosedByStaffID   *string
	CountedCashCents  *int64
	ExpectedCashCents *int64
	VarianceCents     *int64
	CreatedAt         time.Time
	UpdatedAt         time.Time
}

// ExpectedCash is the cash a shift should hold: its opening float plus its
// cash sales less the cash it paid back for refunds. Card payments and card
// refunds never enter it, whatever their status.
func ExpectedCash(openingFloatCents, cashSalesCents, cashRefundsCents int64) int64 {
	return openingFloatCents + cashSalesCents - cashRefundsCents
}

// Expected returns the shift's expected cash: the stored figure once closed,
// the live one while open.
func (s Shift) Expected() int64 {
	if s.ExpectedCashCents != nil {
		return *s.ExpectedCashCents
	}
	return ExpectedCash(s.OpeningFloatCents, s.CashSalesCents, s.CashRefundsCents)
}

// DecideClose is the close rule applied to the locked shift. changed=false
// with no error when it is already closed with the same count (a retried
// close); a different count for a closed shift, or a stale version, is an
// error.
func DecideClose(s Shift, expectedVersion int, countedCents int64) (bool, error) {
	if s.Status == StatusClosed {
		if s.CountedCashCents != nil && *s.CountedCashCents == countedCents {
			return false, nil
		}
		return false, &NotOpenError{Status: s.Status}
	}
	if s.Version != expectedVersion {
		return false, &VersionConflictError{Current: s.Version}
	}
	return true, nil
}

// Actor is the staff member acting.
type Actor struct {
	StaffID string
	Email   string
	Role    string
	// Device is the device the staff member acted through, from the
	// verified credential (audit.DeviceOf); the zero value is none.
	Device audit.Device
}

// Supervises reports whether the actor may read and close any shift at the
// venue (owner, admin, manager). Others act on their own shifts only.
func (a Actor) Supervises() bool {
	return a.Role == identity.RoleOwner || a.Role == identity.RoleAdmin || a.Role == identity.RoleManager
}

// MayAccess reports whether the actor may read or close the shift.
func (a Actor) MayAccess(s Shift) bool { return a.Supervises() || s.StaffID == a.StaffID }

// Bounds.
const (
	MinKeyLength = 16
	MaxKeyLength = 255
	// MaxCents is the PostgreSQL integer bound of the amount columns.
	MaxCents = 2147483647
)

// Errors. The transport maps each to its contract response
// (contracts/openapi/shifts.yaml).
var (
	ErrShiftNotFound = errors.New("Shift not found")
	// ErrTerminalNotFound: no such terminal at this venue.
	ErrTerminalNotFound = errors.New("Terminal not found")
	// ErrTerminalDisabled: a disabled terminal cannot be chosen for a new
	// shift (past shifts keep it).
	ErrTerminalDisabled = errors.New("Terminal is disabled")
	ErrUnknownActor     = errors.New("Unknown staff identity")
	ErrWritesDisabled   = errors.New("Shift changes are disabled on this instance")
	// ErrDuplicateKey: a Repository's (venueId, openRequestKey) was taken
	// concurrently.
	ErrDuplicateKey = errors.New("open request key already used")
)

// ValidationError is a malformed request.
type ValidationError struct{ Message string }

func (e *ValidationError) Error() string { return e.Message }

func invalid(msg string) error { return &ValidationError{Message: msg} }

// AlreadyOpenError: the staff member already has an open shift at the venue.
type AlreadyOpenError struct{ ShiftID string }

func (e *AlreadyOpenError) Error() string { return "You already have an open shift at this venue" }

// IdempotencyConflictError: the key already opened a different shift.
type IdempotencyConflictError struct {
	Key     string
	ShiftID string
}

func (e *IdempotencyConflictError) Error() string {
	return `idempotencyKey "` + e.Key + `" was already used to open a different shift`
}

// NotOpenError: the shift is closed.
type NotOpenError struct{ Status Status }

func (e *NotOpenError) Error() string { return "Shift is " + string(e.Status) + ", not open" }

// VersionConflictError: the shift changed since the caller read it.
type VersionConflictError struct{ Current int }

func (e *VersionConflictError) Error() string {
	return "Shift was changed by someone else (now version " + strconv.Itoa(e.Current) + ")"
}
