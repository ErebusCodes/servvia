package promotions

import (
	"errors"
	"strconv"
)

// Errors. Each transport maps them to its contract response
// (contracts/openapi/promotions.yaml, servvia-orders.yaml).
var (
	// ErrPromotionNotFound: no such promotion at this venue. A promotion of
	// another venue or organization is indistinguishable from none.
	ErrPromotionNotFound = errors.New("Promotion not found")
	// ErrChanged: the promotion changed (or was deactivated) between the
	// evaluation of an order and its commit. Nothing was written; retrying
	// evaluates the current promotion.
	ErrChanged        = errors.New("The promotion changed while this order was being placed; review it and retry")
	ErrUnknownActor   = errors.New("Unknown staff identity")
	ErrWritesDisabled = errors.New("Promotion changes are disabled on this instance")
	// ErrDuplicateKey: a create key was taken concurrently (repository).
	ErrDuplicateKey = errors.New("idempotency key already used")
)

// ValidationError is a malformed request.
type ValidationError struct{ Message string }

func (e *ValidationError) Error() string { return e.Message }

func invalid(msg string) error { return &ValidationError{Message: msg} }

// IdempotencyConflictError: the create key was used for other terms.
type IdempotencyConflictError struct {
	Key         string
	PromotionID string
}

func (e *IdempotencyConflictError) Error() string {
	return `idempotencyKey "` + e.Key + `" was already used to create a different promotion`
}

// VersionConflictError: the promotion changed since the caller read it.
type VersionConflictError struct{ Current int }

func (e *VersionConflictError) Error() string {
	return "Promotion was changed by someone else (current version " + strconv.Itoa(e.Current) + ")"
}

// Reason says why a promotion cannot apply to a submission.
type Reason string

const (
	ReasonInactive        Reason = "inactive"
	ReasonNotStarted      Reason = "not_started"
	ReasonEnded           Reason = "ended"
	ReasonNoEligibleItems Reason = "no_eligible_items"
	// ReasonZeroTotal: the discount would leave nothing to pay for the
	// submission. A zero check cannot be settled (payments are positive), so
	// the promotion is refused rather than strand the visit.
	ReasonZeroTotal Reason = "total_would_be_zero"
)

var reasonText = map[Reason]string{
	ReasonInactive:        "The promotion is not active",
	ReasonNotStarted:      "The promotion has not started yet",
	ReasonEnded:           "The promotion has ended",
	ReasonNoEligibleItems: "No item in this submission is eligible for the promotion",
	ReasonZeroTotal:       "The promotion would reduce this submission to nothing to pay",
}

// NotApplicableError: the promotion exists at this venue but cannot apply
// to this submission now.
type NotApplicableError struct{ Reason Reason }

func (e *NotApplicableError) Error() string { return reasonText[e.Reason] }
