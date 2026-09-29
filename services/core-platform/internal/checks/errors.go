package checks

import (
	"errors"
	"strconv"
)

// Errors. The transport maps each to its contract response
// (contracts/openapi/checks.yaml).
var (
	ErrCheckNotFound        = errors.New("Check not found")
	ErrOrderNotFound        = errors.New("Order not found")
	ErrTableSessionNotFound = errors.New("Table session not found")
	// ErrNothingToBill: every line of the requested orders is already on a
	// check that stands (or there are no lines).
	ErrNothingToBill = errors.New("Every line of these orders is already on an open check")
	// ErrMixedVisits: one check bills one visit, or orders without a table.
	ErrMixedVisits = errors.New("A check cannot combine orders of different table sessions, or table and non-table orders")
	// ErrLegacyOrder: orders of the NestJS path are billed by its own flow
	// until order creation moves to Servvia Core.
	ErrLegacyOrder  = errors.New("Only Servvia Core orders can be billed on a check")
	ErrUnknownActor = errors.New("Unknown staff identity")
	// ErrCheckHasPayments: money is exposed on the check (a payment or a
	// refund is unresolved, or a succeeded payment still has money not
	// returned), so it cannot be voided. Refund or reverse every tender
	// first (Phase D9).
	ErrCheckHasPayments = errors.New("Check has payments that are unresolved or not fully returned and cannot be voided")
	ErrWritesDisabled   = errors.New("Check changes are disabled on this instance")
	// ErrDuplicateKey: a Repository's (venueId, idempotencyKey) was taken
	// concurrently.
	ErrDuplicateKey = errors.New("idempotency key already used")
)

// ValidationError is a malformed request.
type ValidationError struct{ Message string }

func (e *ValidationError) Error() string { return e.Message }

func invalid(msg string) error { return &ValidationError{Message: msg} }

// IdempotencyConflictError: the key already created a check for a different
// request.
type IdempotencyConflictError struct {
	Key     string
	CheckID string
}

func (e *IdempotencyConflictError) Error() string {
	return `idempotencyKey "` + e.Key + `" was already used to create a different check`
}

// OrderNotBillableError: the order was cancelled.
type OrderNotBillableError struct{ OrderID, Status string }

func (e *OrderNotBillableError) Error() string {
	return "Order " + e.OrderID + " is " + e.Status + " and cannot be billed"
}

// SessionNotOpenError: the visit (table session) ended; it takes no new
// check (Phase D10). Existing checks stay payable and refundable.
type SessionNotOpenError struct{ Status string }

func (e *SessionNotOpenError) Error() string { return "Table session is " + e.Status + ", not open" }

// NotOpenError: the check is voided and cannot change.
type NotOpenError struct{ Status Status }

func (e *NotOpenError) Error() string { return "Check is " + string(e.Status) + ", not open" }

// VersionConflictError: the check changed since the caller read it.
type VersionConflictError struct{ Current int }

func (e *VersionConflictError) Error() string {
	return "Check was changed by someone else (now version " + strconv.Itoa(e.Current) + ")"
}
