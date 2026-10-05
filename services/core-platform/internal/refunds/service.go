package refunds

import (
	"context"
	"errors"
	"regexp"
	"strings"

	"servvia/services/core-platform/internal/audit"
	"servvia/services/core-platform/internal/payments"
)

// Scope is the tenancy of every operation.
type Scope struct {
	OrganizationID string
	VenueID        string
}

// Staff is a staff member requesting a refund.
type Staff struct {
	StaffID string
	Email   string
	Role    string
	// Device is the device the staff member acted through, from the
	// verified credential (audit.DeviceOf); the zero value is none.
	Device audit.Device
}

// RefundCommand asks to return an amount of a payment. The amount is a
// proposal; the server checks it against the payment's refundable amount.
type RefundCommand struct {
	Scope          Scope
	PaymentID      string
	AmountCents    int64
	Currency       string
	Reason         string
	IdempotencyKey string
	Actor          Staff
}

// ReversalCommand is the payment adapter reporting that its provider
// reversed an amount of a card payment.
type ReversalCommand struct {
	Scope          Scope
	PaymentID      string
	AmountCents    int64
	Currency       string
	Reference      *string
	IdempotencyKey string
	DeviceID       string
}

// ResultCommand is the payment adapter reporting a card refund's result.
type ResultCommand struct {
	Scope        Scope
	AdjustmentID string
	Outcome      payments.Status
	Reference    *string
	DeviceID     string
}

// NewAdjustment is a validated request ready to persist.
type NewAdjustment struct {
	Scope          Scope
	PaymentID      string
	Kind           Kind
	AmountCents    int64
	Currency       string
	Reason         *string
	Reference      *string
	IdempotencyKey string
	Fingerprint    string
	Staff          *Staff
	DeviceID       *string
}

// Repository persists adjustments. Every operation is one transaction that
// locks the check, then the payment (the D6 order): capacity, effective
// balance and settlement are decided under those locks.
//
// Create requires the payment succeeded and in the same currency, and the
// amount within its refundable amount. A card refund is written pending. A
// cash refund also locks the staff member's open shift (ErrNoOpenShift) and
// is written succeeded with its cash_refund movement. A reversal (card
// only, ErrNotReversible) is written succeeded. A succeeded adjustment may
// revoke the check's settlement in the same transaction. A taken key is
// ErrDuplicateKey, including one taken while this request waited for the
// locks.
//
// RecordResult applies payments.DecideResult to a pending or uncertain card
// refund; a success may revoke the settlement.
type Repository interface {
	FindByKey(ctx context.Context, venueID, key string) (Adjustment, string, bool, error)
	Get(ctx context.Context, venueID, id string) (Adjustment, error)
	ListForPayment(ctx context.Context, venueID, paymentID string) ([]Adjustment, error)
	Create(ctx context.Context, n NewAdjustment) (Adjustment, error)
	RecordResult(ctx context.Context, cmd ResultCommand) (Adjustment, bool, error)
	// Audit records a staff outcome that changes nothing. Best effort.
	Audit(ctx context.Context, scope Scope, actor Staff, action, id string, detail map[string]any)
}

type Service struct {
	repo          Repository
	writesEnabled bool
}

func NewService(repo Repository, writesEnabled bool) *Service {
	return &Service{repo: repo, writesEnabled: writesEnabled}
}

var currencyPattern = regexp.MustCompile(`^[A-Z]{3}$`)

func validate(amount int64, currency, key string) error {
	switch n := len([]rune(key)); {
	case n < MinKeyLength || n > MaxKeyLength:
		return invalid("idempotencyKey must be a string of 16 to 255 characters")
	case amount < 1:
		return invalid("amountCents must be a positive integer")
	case !currencyPattern.MatchString(currency):
		return invalid("currency must be an ISO 4217 code such as NZD")
	}
	return nil
}

func validReference(ref *string) error {
	if ref != nil && (strings.TrimSpace(*ref) == "" || len([]rune(*ref)) > MaxReferenceLength) {
		return invalid("reference must be a string of 1 to 255 characters")
	}
	return nil
}

// Refund asks to return money from a payment, or returns the refund this key
// already requested for the same request (created=false): a retry after a
// lost response never asks the provider twice or pays cash out twice.
func (s *Service) Refund(ctx context.Context, cmd RefundCommand) (Adjustment, bool, error) {
	if err := validate(cmd.AmountCents, cmd.Currency, cmd.IdempotencyKey); err != nil {
		return Adjustment{}, false, err
	}
	reason := strings.TrimSpace(cmd.Reason)
	if reason == "" || len([]rune(reason)) > MaxReasonLength {
		return Adjustment{}, false, invalid("reason must be a string of 1 to 500 characters")
	}
	actor := cmd.Actor
	return s.create(ctx, NewAdjustment{Scope: cmd.Scope, PaymentID: cmd.PaymentID, Kind: KindRefund, AmountCents: cmd.AmountCents,
		Currency: cmd.Currency, Reason: &reason, IdempotencyKey: cmd.IdempotencyKey,
		Fingerprint: Fingerprint(cmd.Scope.VenueID, cmd.PaymentID, KindRefund, cmd.AmountCents, cmd.Currency, reason), Staff: &actor})
}

// Reverse records a provider reversal reported by the payment adapter device,
// or returns the one this key already recorded.
func (s *Service) Reverse(ctx context.Context, cmd ReversalCommand) (Adjustment, bool, error) {
	if err := validate(cmd.AmountCents, cmd.Currency, cmd.IdempotencyKey); err != nil {
		return Adjustment{}, false, err
	}
	if err := validReference(cmd.Reference); err != nil {
		return Adjustment{}, false, err
	}
	if strings.TrimSpace(cmd.DeviceID) == "" {
		return Adjustment{}, false, invalid("adapter identity is required")
	}
	device := cmd.DeviceID
	return s.create(ctx, NewAdjustment{Scope: cmd.Scope, PaymentID: cmd.PaymentID, Kind: KindReversal, AmountCents: cmd.AmountCents,
		Currency: cmd.Currency, Reference: cmd.Reference, IdempotencyKey: cmd.IdempotencyKey,
		Fingerprint: Fingerprint(cmd.Scope.VenueID, cmd.PaymentID, KindReversal, cmd.AmountCents, cmd.Currency, ""), DeviceID: &device})
}

func (s *Service) create(ctx context.Context, n NewAdjustment) (Adjustment, bool, error) {
	if !s.writesEnabled {
		return Adjustment{}, false, ErrWritesDisabled
	}
	if existing, stored, found, err := s.repo.FindByKey(ctx, n.Scope.VenueID, n.IdempotencyKey); err != nil {
		return Adjustment{}, false, err
	} else if found {
		return s.replay(ctx, n, existing, stored)
	}
	a, err := s.repo.Create(ctx, n)
	if errors.Is(err, ErrDuplicateKey) {
		existing, stored, found, ferr := s.repo.FindByKey(ctx, n.Scope.VenueID, n.IdempotencyKey)
		if ferr != nil || !found {
			return Adjustment{}, false, errors.Join(err, ferr)
		}
		return s.replay(ctx, n, existing, stored)
	}
	if err != nil {
		return Adjustment{}, false, err
	}
	return a, true, nil
}

func (s *Service) replay(ctx context.Context, n NewAdjustment, existing Adjustment, stored string) (Adjustment, bool, error) {
	if stored == n.Fingerprint {
		if n.Staff != nil {
			s.repo.Audit(ctx, n.Scope, *n.Staff, "REFUND_IDEMPOTENT_REPLAY", existing.ID, map[string]any{"idempotencyKey": n.IdempotencyKey})
		}
		return existing, false, nil
	}
	if n.Staff != nil {
		s.repo.Audit(ctx, n.Scope, *n.Staff, "REFUND_IDEMPOTENCY_CONFLICT", existing.ID,
			map[string]any{"idempotencyKey": n.IdempotencyKey, "reason": "same idempotencyKey, different request"})
	}
	return Adjustment{}, false, &IdempotencyConflictError{Key: n.IdempotencyKey, ID: existing.ID}
}

// RecordResult applies the payment adapter's result for a card refund.
// changed=false when it already had that outcome.
func (s *Service) RecordResult(ctx context.Context, cmd ResultCommand) (Adjustment, bool, error) {
	if !cmd.Outcome.Outcome() {
		return Adjustment{}, false, invalid("outcome must be one of succeeded, failed, uncertain")
	}
	if err := validReference(cmd.Reference); err != nil {
		return Adjustment{}, false, err
	}
	if strings.TrimSpace(cmd.DeviceID) == "" {
		return Adjustment{}, false, invalid("adapter identity is required")
	}
	if !s.writesEnabled {
		return Adjustment{}, false, ErrWritesDisabled
	}
	return s.repo.RecordResult(ctx, cmd)
}

func (s *Service) Get(ctx context.Context, scope Scope, id string) (Adjustment, error) {
	return s.repo.Get(ctx, scope.VenueID, id)
}

func (s *Service) ListForPayment(ctx context.Context, scope Scope, paymentID string) ([]Adjustment, error) {
	return s.repo.ListForPayment(ctx, scope.VenueID, paymentID)
}
