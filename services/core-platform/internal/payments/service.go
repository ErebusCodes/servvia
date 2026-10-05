package payments

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"regexp"
	"strconv"
	"strings"

	"servvia/services/core-platform/internal/audit"
)

// Scope is the tenancy of every operation.
type Scope struct {
	OrganizationID string
	VenueID        string
}

// Staff is the staff member initiating a tender.
type Staff struct {
	StaffID string
	Email   string
	Role    string
	// Device is the device the staff member acted through, from the
	// verified credential (audit.DeviceOf); the zero value is none.
	Device audit.Device
}

// Adapter is the trusted payment adapter reporting a result: a registered
// payment_adapter device (Phase D8), identified by its device id. It is never
// a staff member, and no staff identity can act as one.
type Adapter struct {
	ID string
}

// AdapterKind is the actor kind recorded for adapter results.
const AdapterKind = "payment_adapter"

// InitiateCommand tenders an amount against a check. The amount is a
// proposal: the server checks it against the check's status, currency and
// available amount.
type InitiateCommand struct {
	Scope          Scope
	CheckID        string
	AmountCents    int64
	Currency       string
	TenderType     TenderType
	IdempotencyKey string
	Actor          Staff
}

// ResultCommand reports how a tender ended.
type ResultCommand struct {
	Scope     Scope
	PaymentID string
	Outcome   Status
	Reference *string
	Actor     Adapter
}

// NewPayment is a validated initiate ready to persist.
type NewPayment struct {
	Command     InitiateCommand
	Fingerprint string
}

// Repository persists payments.
//
// Initiate is one transaction under the check's row lock: require it open and
// in the payment's currency, require the amount to fit the available amount
// (ComputeBalance), write the payment, its first transition and an AuditLog
// row. A card payment is written pending. A cash payment additionally locks
// the tendering staff member's open shift (ErrNoOpenShift without one), is
// written succeeded with its cash movement, and settles the check when it
// pays the balance, all in the same transaction. It returns ErrDuplicateKey
// when the key was taken concurrently, including by a request it waited for.
//
// RecordResult locks the check, then the payment, applies DecideResult, and
// on a change writes the status and a transition; when a success makes the
// paid amount equal the total, it writes the CheckSettlement and moves the
// check to settled in the same transaction.
type Repository interface {
	FindByKey(ctx context.Context, venueID, key string) (Payment, string, bool, error)
	Get(ctx context.Context, venueID, paymentID string) (Payment, error)
	Summary(ctx context.Context, venueID, checkID string) (Summary, error)
	Initiate(ctx context.Context, n NewPayment) (Payment, error)
	RecordResult(ctx context.Context, cmd ResultCommand) (Payment, bool, error)
	// Audit records an outcome that changes nothing. Best effort.
	Audit(ctx context.Context, scope Scope, actor Staff, action, paymentID string, detail map[string]any)
}

// Fingerprint identifies an initiate request semantically.
func Fingerprint(venueID, checkID string, amount int64, currency string, tender TenderType) string {
	sum := sha256.Sum256([]byte(strings.Join([]string{"payment/v1", venueID, checkID,
		strconv.FormatInt(amount, 10), currency, string(tender)}, "\x00")))
	return hex.EncodeToString(sum[:])
}

type Service struct {
	repo          Repository
	writesEnabled bool
}

func NewService(repo Repository, writesEnabled bool) *Service {
	return &Service{repo: repo, writesEnabled: writesEnabled}
}

func (s *Service) Get(ctx context.Context, scope Scope, paymentID string) (Payment, error) {
	return s.repo.Get(ctx, scope.VenueID, paymentID)
}

func (s *Service) Summary(ctx context.Context, scope Scope, checkID string) (Summary, error) {
	return s.repo.Summary(ctx, scope.VenueID, checkID)
}

var currencyPattern = regexp.MustCompile(`^[A-Z]{3}$`)

// Initiate tenders an amount, or returns the payment this key already
// initiated for the same request (created=false): a retry after a lost
// response never tenders twice, and a cash retry never records a second
// movement. The same key with a different request (including another tender
// type) is *IdempotencyConflictError.
func (s *Service) Initiate(ctx context.Context, cmd InitiateCommand) (Payment, bool, error) {
	switch n := len([]rune(cmd.IdempotencyKey)); {
	case n < MinKeyLength || n > MaxKeyLength:
		return Payment{}, false, invalid("idempotencyKey must be a string of 16 to 255 characters")
	case cmd.AmountCents < 1:
		return Payment{}, false, invalid("amountCents must be a positive integer")
	case !currencyPattern.MatchString(cmd.Currency):
		return Payment{}, false, invalid("currency must be an ISO 4217 code such as NZD")
	case cmd.TenderType != TenderCard && cmd.TenderType != TenderCash:
		return Payment{}, false, invalid("tenderType must be one of card, cash")
	case strings.TrimSpace(cmd.CheckID) == "":
		return Payment{}, false, ErrCheckNotFound
	}
	if !s.writesEnabled {
		return Payment{}, false, ErrWritesDisabled
	}
	fp := Fingerprint(cmd.Scope.VenueID, cmd.CheckID, cmd.AmountCents, cmd.Currency, cmd.TenderType)
	if existing, stored, found, err := s.repo.FindByKey(ctx, cmd.Scope.VenueID, cmd.IdempotencyKey); err != nil {
		return Payment{}, false, err
	} else if found {
		return s.replay(ctx, cmd, existing, stored, fp)
	}
	p, err := s.repo.Initiate(ctx, NewPayment{Command: cmd, Fingerprint: fp})
	if errors.Is(err, ErrDuplicateKey) {
		existing, stored, found, ferr := s.repo.FindByKey(ctx, cmd.Scope.VenueID, cmd.IdempotencyKey)
		if ferr != nil || !found {
			return Payment{}, false, errors.Join(err, ferr)
		}
		return s.replay(ctx, cmd, existing, stored, fp)
	}
	if err != nil {
		return Payment{}, false, err
	}
	return p, true, nil
}

func (s *Service) replay(ctx context.Context, cmd InitiateCommand, existing Payment, stored, fp string) (Payment, bool, error) {
	if stored == fp {
		s.repo.Audit(ctx, cmd.Scope, cmd.Actor, "PAYMENT_IDEMPOTENT_REPLAY", existing.ID,
			map[string]any{"idempotencyKey": cmd.IdempotencyKey})
		return existing, false, nil
	}
	s.repo.Audit(ctx, cmd.Scope, cmd.Actor, "PAYMENT_IDEMPOTENCY_CONFLICT", existing.ID,
		map[string]any{"idempotencyKey": cmd.IdempotencyKey, "reason": "same idempotencyKey, different request"})
	return Payment{}, false, &IdempotencyConflictError{Key: cmd.IdempotencyKey, PaymentID: existing.ID}
}

// RecordResult applies a trusted adapter's result. changed=false means the
// payment already had that status (a retried report).
func (s *Service) RecordResult(ctx context.Context, cmd ResultCommand) (Payment, bool, error) {
	if !cmd.Outcome.Outcome() {
		return Payment{}, false, invalid("outcome must be one of succeeded, failed, uncertain")
	}
	if cmd.Reference != nil && (strings.TrimSpace(*cmd.Reference) == "" || len([]rune(*cmd.Reference)) > MaxReferenceLength) {
		return Payment{}, false, invalid("reference must be a string of 1 to 255 characters")
	}
	if strings.TrimSpace(cmd.Actor.ID) == "" {
		return Payment{}, false, invalid("adapter identity is required")
	}
	if !s.writesEnabled {
		return Payment{}, false, ErrWritesDisabled
	}
	return s.repo.RecordResult(ctx, cmd)
}
