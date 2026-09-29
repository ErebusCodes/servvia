package checks

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"slices"
	"strings"

	"servvia/services/core-platform/internal/pricing"
)

// Scope is the tenancy and tax context of every operation.
type Scope struct {
	OrganizationID string
	Venue          pricing.Venue
}

// Actor is the staff member acting. Checks are staff operations only.
type Actor struct {
	StaffID string
	Email   string
	Role    string
}

// CreateCommand bills orders: either every order of one table session, or
// the named orders. It names entities only; the server decides the amounts.
// Only order lines not already on a standing check are billed.
type CreateCommand struct {
	Scope          Scope
	TableSessionID *string
	OrderIDs       []string
	IdempotencyKey string
	Actor          Actor
}

// VoidCommand withdraws an open check created in error.
type VoidCommand struct {
	Scope           Scope
	CheckID         string
	ExpectedVersion int
	Reason          string
	Actor           Actor
}

// Filter selects checks of one venue.
type Filter struct {
	TableSessionID string
	// Statuses to include; empty means open only.
	Statuses []Status
}

// NewCheck is a validated create ready to persist. The repository resolves
// the orders and lines under locks and prices the check with TotalsFor.
type NewCheck struct {
	Command     CreateCommand
	Fingerprint string
	Currency    string
	TotalsFor   func(subtotalCents, discountCents int64) (pricing.Totals, error)
}

// Repository persists checks.
//
// Create is one transaction: lock the orders (FOR UPDATE, in id order, the
// lock a round takes), bill every round line of them that is not on a
// standing check, write the check, its lines and an AuditLog row. It returns
// ErrDuplicateKey when (venueId, idempotencyKey) was taken concurrently.
//
// Void locks the check, applies DecideVoid, refuses ErrCheckHasPayments
// while a payment is pending, uncertain or succeeded (checked under the same
// row lock a payment is initiated under), and on a change voids the check and
// releases its lines in the same transaction, with an AuditLog row.
type Repository interface {
	FindByKey(ctx context.Context, venueID, key string) (Check, string, bool, error)
	Get(ctx context.Context, venueID, checkID string) (Check, error)
	List(ctx context.Context, venueID string, f Filter) ([]Check, error)
	Create(ctx context.Context, n NewCheck) (Check, error)
	Void(ctx context.Context, cmd VoidCommand) (Check, bool, error)
	// Audit records an outcome that changes nothing (a replay or a refused
	// key reuse). Best effort.
	Audit(ctx context.Context, scope Scope, actor Actor, action, checkID string, detail map[string]any)
}

// Fingerprint identifies a create request semantically: venue plus either
// the session or the set of orders (order and duplicates do not matter).
// Never amounts: the server decides those.
func Fingerprint(venueID string, sessionID *string, orderIDs []string) string {
	var b strings.Builder
	b.WriteString("check/v1\x00" + venueID + "\x00")
	if sessionID != nil {
		b.WriteString("session\x00" + *sessionID)
	} else {
		ids := slices.Clone(orderIDs)
		slices.Sort(ids)
		b.WriteString("orders\x00" + strings.Join(slices.Compact(ids), "\x00"))
	}
	sum := sha256.Sum256([]byte(b.String()))
	return hex.EncodeToString(sum[:])
}

// DecideVoid is the void rule applied to the locked check: changed=false with
// no error when it is already voided (a retried void is not a conflict).
func DecideVoid(c Check, expectedVersion int) (bool, error) {
	if c.Status == StatusVoided {
		return false, nil
	}
	if c.Status != StatusOpen {
		return false, &NotOpenError{Status: c.Status}
	}
	if c.Version != expectedVersion {
		return false, &VersionConflictError{Current: c.Version}
	}
	return true, nil
}

type Service struct {
	repo          Repository
	writesEnabled bool
}

func NewService(repo Repository, writesEnabled bool) *Service {
	return &Service{repo: repo, writesEnabled: writesEnabled}
}

func (s *Service) Get(ctx context.Context, scope Scope, checkID string) (Check, error) {
	return s.repo.Get(ctx, scope.Venue.ID, checkID)
}

func (s *Service) List(ctx context.Context, scope Scope, f Filter) ([]Check, error) {
	for _, st := range f.Statuses {
		if st != StatusOpen && st != StatusVoided && st != StatusSettled {
			return nil, invalid("status must be one of open, voided, settled")
		}
	}
	if len(f.Statuses) == 0 {
		f.Statuses = []Status{StatusOpen}
	}
	return s.repo.List(ctx, scope.Venue.ID, f)
}

// Create bills orders, or returns the check this idempotency key already
// created for the same request (created=false). The same key with a
// different request is *IdempotencyConflictError and creates nothing.
func (s *Service) Create(ctx context.Context, cmd CreateCommand) (Check, bool, error) {
	if err := validateCreate(cmd); err != nil {
		return Check{}, false, err
	}
	if !s.writesEnabled {
		return Check{}, false, ErrWritesDisabled
	}
	fp := Fingerprint(cmd.Scope.Venue.ID, cmd.TableSessionID, cmd.OrderIDs)
	if existing, stored, found, err := s.repo.FindByKey(ctx, cmd.Scope.Venue.ID, cmd.IdempotencyKey); err != nil {
		return Check{}, false, err
	} else if found {
		return s.replay(ctx, cmd, existing, stored, fp)
	}
	venue := cmd.Scope.Venue
	c, err := s.repo.Create(ctx, NewCheck{Command: cmd, Fingerprint: fp, Currency: venue.Tax.Currency,
		TotalsFor: func(subtotal, discount int64) (pricing.Totals, error) {
			if !pricing.Persistable(subtotal) {
				return pricing.Totals{}, pricing.ErrAmountOutOfRange()
			}
			return pricing.ComputeDiscountedTotals(venue.ID, venue.Tax, subtotal, discount)
		}})
	if errors.Is(err, ErrDuplicateKey) {
		existing, stored, found, ferr := s.repo.FindByKey(ctx, cmd.Scope.Venue.ID, cmd.IdempotencyKey)
		if ferr != nil || !found {
			return Check{}, false, errors.Join(err, ferr)
		}
		return s.replay(ctx, cmd, existing, stored, fp)
	}
	if err != nil {
		return Check{}, false, err
	}
	return c, true, nil
}

func (s *Service) replay(ctx context.Context, cmd CreateCommand, existing Check, stored, fp string) (Check, bool, error) {
	if stored == fp {
		s.repo.Audit(ctx, cmd.Scope, cmd.Actor, "CHECK_IDEMPOTENT_REPLAY", existing.ID,
			map[string]any{"idempotencyKey": cmd.IdempotencyKey})
		return existing, false, nil
	}
	s.repo.Audit(ctx, cmd.Scope, cmd.Actor, "CHECK_IDEMPOTENCY_CONFLICT", existing.ID,
		map[string]any{"idempotencyKey": cmd.IdempotencyKey, "reason": "same idempotencyKey, different request"})
	return Check{}, false, &IdempotencyConflictError{Key: cmd.IdempotencyKey, CheckID: existing.ID}
}

// Void withdraws an open check. changed=false means it was already voided.
func (s *Service) Void(ctx context.Context, cmd VoidCommand) (Check, bool, error) {
	if cmd.ExpectedVersion < 1 {
		return Check{}, false, invalid("version must be a positive integer")
	}
	reason := strings.TrimSpace(cmd.Reason)
	if reason == "" || len([]rune(reason)) > MaxVoidReason {
		return Check{}, false, invalid("reason must be a string of 1 to 500 characters")
	}
	cmd.Reason = reason
	if !s.writesEnabled {
		return Check{}, false, ErrWritesDisabled
	}
	return s.repo.Void(ctx, cmd)
}

func validateCreate(cmd CreateCommand) error {
	if n := len([]rune(cmd.IdempotencyKey)); n < MinKeyLength || n > MaxKeyLength {
		return invalid("idempotencyKey must be a string of 16 to 255 characters")
	}
	hasSession := cmd.TableSessionID != nil
	switch {
	case hasSession && len(cmd.OrderIDs) > 0:
		return invalid("Specify either tableSessionId or orderIds, not both")
	case hasSession && strings.TrimSpace(*cmd.TableSessionID) == "":
		return invalid("tableSessionId must not be empty")
	case !hasSession && len(cmd.OrderIDs) == 0:
		return invalid("Specify tableSessionId or orderIds")
	case len(cmd.OrderIDs) > MaxOrders:
		return invalid("orderIds must list at most 50 orders")
	}
	for _, id := range cmd.OrderIDs {
		if strings.TrimSpace(id) == "" {
			return invalid("orderIds must not contain empty ids")
		}
	}
	return nil
}
