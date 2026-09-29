package payments

import (
	"errors"
	"strconv"
)

// Errors. The transport maps each to its contract response
// (contracts/openapi/payments.yaml).
var (
	ErrPaymentNotFound = errors.New("Payment not found")
	ErrCheckNotFound   = errors.New("Check not found")
	ErrUnknownActor    = errors.New("Unknown staff identity")
	// ErrNoOpenShift: cash is accepted only by staff with an open shift at
	// the venue, which accounts for it.
	ErrNoOpenShift    = errors.New("Cash can only be accepted by staff with an open shift at this venue")
	ErrWritesDisabled = errors.New("Payment changes are disabled on this instance")
	// ErrDuplicateKey: a Repository's (venueId, idempotencyKey) was taken
	// concurrently.
	ErrDuplicateKey = errors.New("idempotency key already used")
)

// ValidationError is a malformed request.
type ValidationError struct{ Message string }

func (e *ValidationError) Error() string { return e.Message }

func invalid(msg string) error { return &ValidationError{Message: msg} }

// IdempotencyConflictError: the key already initiated a different payment.
type IdempotencyConflictError struct {
	Key       string
	PaymentID string
}

func (e *IdempotencyConflictError) Error() string {
	return `idempotencyKey "` + e.Key + `" was already used to initiate a different payment`
}

// CheckNotOpenError: the check is voided or settled and takes no payment.
type CheckNotOpenError struct{ Status string }

func (e *CheckNotOpenError) Error() string { return "Check is " + e.Status + ", not open" }

// CurrencyMismatchError: a tender must be in the check's currency.
type CurrencyMismatchError struct{ CheckCurrency string }

func (e *CurrencyMismatchError) Error() string {
	return "Payment currency must be the check's currency, " + e.CheckCurrency
}

// AmountExceedsAvailableError: the amount is more than the check has left to
// pay once succeeded and in-flight payments are counted.
type AmountExceedsAvailableError struct{ AvailableCents int64 }

func (e *AmountExceedsAvailableError) Error() string {
	return "Payment amount exceeds the check's available amount (" + strconv.FormatInt(e.AvailableCents, 10) + " cents)"
}

// AlreadyResolvedError: the payment already has a final result, and a
// different one was reported.
type AlreadyResolvedError struct{ Status Status }

func (e *AlreadyResolvedError) Error() string {
	return "Payment is already " + string(e.Status) + "; a different result cannot replace it"
}
