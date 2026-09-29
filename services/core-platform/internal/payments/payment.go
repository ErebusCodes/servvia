// Package payments is Servvia Core's payment and settlement domain (ADR 0001,
// Phase D6).
//
// A Payment is a tender against one check: money offered toward the
// obligation. A Settlement is the durable fact that a check's obligation was
// satisfied: its successful payments cover its total. Neither is the check
// (the obligation), an order, a kitchen ticket, a table session or any
// provider's state. There is no Stripe, EFTPOS, IdealPOS or observation
// concept here: a payment adapter (Venue Edge, later) drives a payment
// through the provider-neutral result operation.
//
// Trust: staff initiate a payment; only the trusted adapter reports how it
// ended. Persistence is behind Repository (payments/pgstore); transport is
// payments/paymentsapi.
package payments

import "time"

// Status is a payment's lifecycle.
//
//	pending   -> succeeded | failed | uncertain
//	uncertain -> succeeded | failed   (reconciliation)
//
// succeeded and failed are final. uncertain means the tender was submitted
// but no reliable result came back: it is never retried, never failed
// automatically and never settles; only reconciliation leaves it.
type Status string

const (
	StatusPending   Status = "pending"
	StatusSucceeded Status = "succeeded"
	StatusFailed    Status = "failed"
	StatusUncertain Status = "uncertain"
)

// Final reports whether no further result can change the payment.
func (s Status) Final() bool { return s == StatusSucceeded || s == StatusFailed }

// Holds reports whether the payment's amount is (or may be) money that has
// moved, and so is unavailable to other payments.
func (s Status) Holds() bool {
	return s == StatusPending || s == StatusUncertain || s == StatusSucceeded
}

// Outcome is a result a trusted adapter may report.
func (s Status) Outcome() bool {
	return s == StatusSucceeded || s == StatusFailed || s == StatusUncertain
}

// DecideResult is the result rule applied to the locked payment:
// changed=false with no error when the payment already has that status (a
// retried report is not a conflict).
func DecideResult(current, outcome Status) (bool, error) {
	if !outcome.Outcome() {
		return false, invalid("outcome must be one of succeeded, failed, uncertain")
	}
	switch {
	case current == outcome:
		return false, nil
	case current.Final():
		return false, &AlreadyResolvedError{Status: current}
	}
	return true, nil // pending -> any outcome; uncertain -> succeeded | failed
}

// TenderType is how a payment is tendered.
//
//	card: initiated by staff (pending); only the trusted payment adapter
//	      reports its result.
//	cash: accepted by staff under their own open shift (Phase D7); succeeded
//	      at once, with its cash movement, in one transaction. There is no
//	      adapter result for physical cash, and no change: the amount
//	      tendered is the amount applied.
type TenderType string

const (
	TenderCard TenderType = "card"
	TenderCash TenderType = "cash"
)

// Payment is one tender.
type Payment struct {
	ID                 string
	VenueID            string
	CheckID            string
	AmountCents        int64
	Currency           string
	TenderType         TenderType
	Status             Status
	Version            int
	IdempotencyKey     string
	RequestedByStaffID *string
	// ShiftID is the shift a cash payment is accounted to (nil for card).
	ShiftID         *string
	ResultReference *string
	ResolvedAt      *time.Time
	// Phase D9: money returned from this payment (succeeded refunds and
	// reversals), and money reserved by refunds whose outcome is not known
	// yet (pending, uncertain). Computed from the adjustment rows.
	ReturnedCents int64
	ReservedCents int64
	Transitions   []Transition
	CreatedAt     time.Time
	UpdatedAt     time.Time
}

// RefundableCents is what may still be returned from the payment: nothing
// unless it succeeded; otherwise its amount less what was returned and what
// unresolved returns reserve.
func (p Payment) RefundableCents() int64 {
	if p.Status != StatusSucceeded {
		return 0
	}
	return p.AmountCents - p.ReturnedCents - p.ReservedCents
}

// NetCents is what the payment still contributes to its check: its amount
// less money returned, once it succeeded.
func (p Payment) NetCents() int64 {
	if p.Status != StatusSucceeded {
		return 0
	}
	return p.AmountCents - p.ReturnedCents
}

// Transition is one entry of a payment's history.
type Transition struct {
	Sequence        int
	From            *Status
	To              Status
	ActorID         string
	ActorKind       string
	ResultReference *string
	At              time.Time
}

// Settlement is the fact that a check's obligation was satisfied.
type Settlement struct {
	ID                string
	CheckID           string
	AmountCents       int64
	Currency          string
	SettlingPaymentID string
	ActorID           string
	ActorKind         string
	SettledAt         time.Time
	// Phase D9: the current state (settled or revoked), the cycle (1, 2, ...
	// each time the check settles again), and every event.
	Status    SettlementStatus
	Cycle     int
	RevokedAt *time.Time
	History   []SettlementEvent
}

// SettlementStatus is the current state of a check's settlement.
type SettlementStatus string

const (
	SettlementSettled SettlementStatus = "settled"
	SettlementRevoked SettlementStatus = "revoked"
)

// SettlementEvent is one settled or revoked event: a settled event names the
// payment that completed the obligation, a revoked event the adjustment that
// reopened it.
type SettlementEvent struct {
	Sequence     int
	Status       SettlementStatus
	Cycle        int
	AmountCents  int64
	PaymentID    *string
	AdjustmentID *string
	ActorID      string
	ActorKind    string
	At           time.Time
}

// Summary is a check's financial position: its obligation and payments.
type Summary struct {
	CheckID     string
	CheckStatus string
	Currency    string
	TotalCents  int64
	Payments    []Payment
	Settlement  *Settlement
}

// Balance is computed from the payments, never from a client.
type Balance struct {
	// PaidCents: the effective amount paid: succeeded payments less money
	// returned from them (succeeded refunds and reversals).
	PaidCents int64
	// ReturnedCents: money returned from succeeded payments.
	ReturnedCents int64
	// HeldCents: pending and uncertain payments, money that may be moving.
	HeldCents int64
	// BalanceCents: what is still owed (total - paid).
	BalanceCents int64
	// AvailableCents: what a new payment may be for (total - paid - held).
	AvailableCents int64
}

// ComputeBalance applies the balance rule to a total and its payments.
func ComputeBalance(totalCents int64, payments []Payment) Balance {
	var b Balance
	for _, p := range payments {
		switch {
		case p.Status == StatusSucceeded:
			b.PaidCents += p.NetCents()
			b.ReturnedCents += p.ReturnedCents
		case p.Status.Holds():
			b.HeldCents += p.AmountCents
		}
	}
	b.BalanceCents = totalCents - b.PaidCents
	b.AvailableCents = b.BalanceCents - b.HeldCents
	return b
}

// Bounds shared with orders and checks.
const (
	MinKeyLength       = 16
	MaxKeyLength       = 255
	MaxReferenceLength = 255
)
