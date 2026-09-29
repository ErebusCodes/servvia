// Package refunds is Servvia Core's return-of-money domain (ADR 0001, Phase
// D9): refunds and reversals against a payment.
//
// An Adjustment returns money from one payment. Two kinds share one engine
// (capacity, balance, settlement), because they differ only in who may
// originate them:
//
//	refund:   requested by staff. Card: pending until the payment adapter
//	          reports the result. Cash: handed back by staff under their open
//	          shift, succeeded at once with a cash_refund movement.
//	reversal: reported by the payment adapter device when the provider
//	          reversed or cancelled an earlier card tender; succeeded at once.
//	          There is no staff operation for it.
//
// Statuses are the payment statuses (payments.Status and DecideResult):
// pending -> succeeded | failed | uncertain, uncertain -> succeeded |
// failed. Uncertain is never retried or failed automatically, and reserves
// its amount.
//
// Payments owns payment, balance and settlement; checks owns the obligation;
// shifts owns cash accountability. This package holds the rules and the
// service; its Repository is implemented next to the payment store
// (payments/pgstore.AdjustmentStore), because a return of money changes
// payment balance and settlement in the same transaction.
package refunds

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"strconv"
	"strings"
	"time"

	"servvia/services/core-platform/internal/payments"
)

// Kind is who originated a return of money.
type Kind string

const (
	KindRefund   Kind = "refund"
	KindReversal Kind = "reversal"
)

// Adjustment is one return of money from one payment.
type Adjustment struct {
	ID                 string
	VenueID            string
	PaymentID          string
	CheckID            string
	Kind               Kind
	AmountCents        int64
	Currency           string
	TenderType         payments.TenderType
	Status             payments.Status
	Version            int
	IdempotencyKey     string
	Reason             *string
	RequestedByStaffID *string
	OriginDeviceID     *string
	// ShiftID is the shift a cash refund was paid out of.
	ShiftID         *string
	ResultReference *string
	ResolvedAt      *time.Time
	Transitions     []payments.Transition
	CreatedAt       time.Time
	UpdatedAt       time.Time
}

// Bounds.
const (
	MinKeyLength       = 16
	MaxKeyLength       = 255
	MaxReasonLength    = 500
	MaxReferenceLength = 255
)

// Fingerprint identifies a request semantically.
func Fingerprint(venueID, paymentID string, kind Kind, amount int64, currency string, reason string) string {
	sum := sha256.Sum256([]byte(strings.Join([]string{"adjustment/v1", venueID, paymentID, string(kind),
		strconv.FormatInt(amount, 10), currency, reason}, "\x00")))
	return hex.EncodeToString(sum[:])
}

// Errors. The transport maps each to its contract response
// (contracts/openapi/refunds.yaml).
var (
	ErrAdjustmentNotFound = errors.New("Refund not found")
	ErrPaymentNotFound    = errors.New("Payment not found")
	ErrUnknownActor       = errors.New("Unknown staff identity")
	ErrWritesDisabled     = errors.New("Refund changes are disabled on this instance")
	// ErrNoOpenShift: cash is handed back only by staff with an open shift,
	// which accounts for it.
	ErrNoOpenShift = errors.New("A cash refund needs an open shift at this venue for the staff member paying it out")
	// ErrNotReversible: only a succeeded card payment can be reversed by its
	// provider.
	ErrNotReversible = errors.New("Only a succeeded card payment can be reversed")
	// ErrNotAwaitingResult: the adapter reports results of card refunds only; a
	// cash refund or a reversal has no pending result.
	ErrNotAwaitingResult = errors.New("This return of money does not await an adapter result")
	// ErrDuplicateKey: a Repository's (venueId, idempotencyKey) was taken
	// concurrently.
	ErrDuplicateKey = errors.New("idempotency key already used")
)

// ValidationError is a malformed request.
type ValidationError struct{ Message string }

func (e *ValidationError) Error() string { return e.Message }

func invalid(msg string) error { return &ValidationError{Message: msg} }

// IdempotencyConflictError: the key was already used for another request.
type IdempotencyConflictError struct{ Key, ID string }

func (e *IdempotencyConflictError) Error() string {
	return `idempotencyKey "` + e.Key + `" was already used for a different return of money`
}

// PaymentNotRefundableError: the payment has not succeeded.
type PaymentNotRefundableError struct{ Status payments.Status }

func (e *PaymentNotRefundableError) Error() string {
	return "Payment is " + string(e.Status) + "; only a succeeded payment can return money"
}

// CurrencyMismatchError: a return is in the payment's currency.
type CurrencyMismatchError struct{ PaymentCurrency string }

func (e *CurrencyMismatchError) Error() string {
	return "Refund currency must be the payment's currency, " + e.PaymentCurrency
}

// ExceedsRefundableError: more than the payment has left to return, once
// earlier and unresolved returns are counted.
type ExceedsRefundableError struct{ RefundableCents int64 }

func (e *ExceedsRefundableError) Error() string {
	return "Amount exceeds what this payment can still return (" + strconv.FormatInt(e.RefundableCents, 10) + " cents)"
}
