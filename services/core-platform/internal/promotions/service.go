package promotions

import (
	"context"
	"errors"
	"strings"
	"time"
)

// Scope is the tenancy of every operation: the caller's organization and one
// of its venues. Promotions belong to exactly one venue.
type Scope struct {
	OrganizationID string
	VenueID        string
}

// Actor is the staff member administering promotions.
type Actor struct {
	StaffID string
	Email   string
	Role    string
}

// CreateCommand configures a new promotion, inactive. IdempotencyKey makes
// it safe to retry.
type CreateCommand struct {
	Scope          Scope
	Terms          Terms
	IdempotencyKey string
	Actor          Actor
}

// Patch is a partial change to the terms; a nil field is left as it is.
// ClearStartsAt / ClearEndsAt remove a bound (JSON null).
type Patch struct {
	Name          *string
	BasisPoints   *int64
	Target        *Target
	CategoryIDs   *[]string
	MenuItemIDs   *[]string
	StartsAt      *time.Time
	ClearStartsAt bool
	EndsAt        *time.Time
	ClearEndsAt   bool
}

// Apply returns the terms t with the patch applied (not yet normalized).
func (p Patch) Apply(t Terms) Terms {
	n := t
	if p.Name != nil {
		n.Name = *p.Name
	}
	if p.BasisPoints != nil {
		n.BasisPoints = *p.BasisPoints
	}
	if p.Target != nil && *p.Target != t.Target {
		// A new target starts with empty lists; the patch gives the one it needs.
		n.Target = *p.Target
		n.CategoryIDs, n.MenuItemIDs = nil, nil
	}
	if p.CategoryIDs != nil {
		n.CategoryIDs = *p.CategoryIDs
	}
	if p.MenuItemIDs != nil {
		n.MenuItemIDs = *p.MenuItemIDs
	}
	if p.ClearStartsAt {
		n.StartsAt = nil
	} else if p.StartsAt != nil {
		n.StartsAt = p.StartsAt
	}
	if p.ClearEndsAt {
		n.EndsAt = nil
	} else if p.EndsAt != nil {
		n.EndsAt = p.EndsAt
	}
	return n
}

// Change is a version-checked change to one promotion.
type Change struct {
	Scope           Scope
	PromotionID     string
	ExpectedVersion int
	Actor           Actor
}

// Filter selects promotions of one venue.
type Filter struct {
	// Statuses to include; empty means all.
	Statuses []Status
}

// NewPromotion is a validated create ready to persist.
type NewPromotion struct {
	Scope       Scope
	Terms       Terms
	Key         string
	Fingerprint string
	Actor       Actor
}

// Decision is what a change does to the locked promotion: Next (its new
// terms and status) and the audit action, or Changed=false for a no-op.
type Decision struct {
	Next    Promotion
	Action  string
	Changed bool
}

// Audit actions (AuditLog.action, resource "promotion").
const (
	ActionCreated   = "PROMOTION_CREATED"
	ActionUpdated   = "PROMOTION_UPDATED"
	ActionActivated = "PROMOTION_ACTIVATED"
	ActionDisabled  = "PROMOTION_DISABLED"
)

// Repository persists promotions.
//
// Create writes the promotion and a PROMOTION_CREATED AuditLog row in one
// transaction; a taken (venueId, createRequestKey) is ErrDuplicateKey.
//
// Change locks the promotion (FOR UPDATE), calls decide with it, and when
// the decision changes something writes it with version+1 and the decision's
// AuditLog row in the same transaction. An order committing this promotion
// holds it FOR SHARE, so a change and an order serialize.
//
// MissingTargets returns the ids that are not categories, or not live menu
// items, of the organization.
type Repository interface {
	FindByKey(ctx context.Context, venueID, key string) (Promotion, string, bool, error)
	Get(ctx context.Context, venueID, id string) (Promotion, error)
	List(ctx context.Context, venueID string, f Filter) ([]Promotion, error)
	Create(ctx context.Context, n NewPromotion) (Promotion, error)
	Change(ctx context.Context, c Change, decide func(Promotion) (Decision, error)) (Promotion, bool, error)
	MissingTargets(ctx context.Context, organizationID string, categoryIDs, menuItemIDs []string) ([]string, error)
}

// Service administers promotions.
type Service struct {
	repo          Repository
	writesEnabled bool
}

func NewService(repo Repository, writesEnabled bool) *Service {
	return &Service{repo: repo, writesEnabled: writesEnabled}
}

func (s *Service) Get(ctx context.Context, scope Scope, id string) (Promotion, error) {
	return s.repo.Get(ctx, scope.VenueID, id)
}

func (s *Service) List(ctx context.Context, scope Scope, f Filter) ([]Promotion, error) {
	for _, st := range f.Statuses {
		if st != StatusActive && st != StatusInactive {
			return nil, invalid("status must be one of active, inactive")
		}
	}
	return s.repo.List(ctx, scope.VenueID, f)
}

// Create configures a promotion (inactive), or returns the one this key
// already created with the same terms (created=false). No audit on replay.
func (s *Service) Create(ctx context.Context, cmd CreateCommand) (Promotion, bool, error) {
	if n := len([]rune(cmd.IdempotencyKey)); n < MinKeyLength || n > MaxKeyLength {
		return Promotion{}, false, invalid("idempotencyKey must be a string of 16 to 255 characters")
	}
	terms, err := cmd.Terms.Normalize()
	if err != nil {
		return Promotion{}, false, err
	}
	if !s.writesEnabled {
		return Promotion{}, false, ErrWritesDisabled
	}
	fp := Fingerprint(cmd.Scope.VenueID, terms)
	if p, stored, found, err := s.repo.FindByKey(ctx, cmd.Scope.VenueID, cmd.IdempotencyKey); err != nil {
		return Promotion{}, false, err
	} else if found {
		return replay(cmd, p, stored, fp)
	}
	if err := s.checkTargets(ctx, cmd.Scope, terms); err != nil {
		return Promotion{}, false, err
	}
	p, err := s.repo.Create(ctx, NewPromotion{Scope: cmd.Scope, Terms: terms, Key: cmd.IdempotencyKey, Fingerprint: fp, Actor: cmd.Actor})
	if errors.Is(err, ErrDuplicateKey) {
		existing, stored, found, ferr := s.repo.FindByKey(ctx, cmd.Scope.VenueID, cmd.IdempotencyKey)
		if ferr != nil || !found {
			return Promotion{}, false, errors.Join(err, ferr)
		}
		return replay(cmd, existing, stored, fp)
	}
	if err != nil {
		return Promotion{}, false, err
	}
	return p, true, nil
}

func replay(cmd CreateCommand, p Promotion, stored, fp string) (Promotion, bool, error) {
	if stored == fp {
		return p, false, nil
	}
	return Promotion{}, false, &IdempotencyConflictError{Key: cmd.IdempotencyKey, PromotionID: p.ID}
}

func (s *Service) checkTargets(ctx context.Context, scope Scope, t Terms) error {
	missing, err := s.repo.MissingTargets(ctx, scope.OrganizationID, t.CategoryIDs, t.MenuItemIDs)
	if err != nil {
		return err
	}
	if len(missing) > 0 {
		return invalid("unknown category or menu item: " + strings.Join(missing, ", "))
	}
	return nil
}

func validateChange(c Change) error {
	if c.ExpectedVersion < 1 {
		return invalid("version must be a positive integer")
	}
	return nil
}

// Update changes a promotion's terms at the version the caller read. A
// change to identical terms is a no-op (changed=false). A stale version is
// *VersionConflictError: financial configuration is never last-write-wins.
// Orders already accepted keep their snapshot.
func (s *Service) Update(ctx context.Context, c Change, patch Patch) (Promotion, bool, error) {
	if err := validateChange(c); err != nil {
		return Promotion{}, false, err
	}
	if !s.writesEnabled {
		return Promotion{}, false, ErrWritesDisabled
	}
	// Validate against the current terms first, so a malformed patch is a
	// 400 without a lock; the decision re-applies it to the locked row.
	current, err := s.repo.Get(ctx, c.Scope.VenueID, c.PromotionID)
	if err != nil {
		return Promotion{}, false, err
	}
	if terms, err := patch.Apply(current.Terms).Normalize(); err != nil {
		return Promotion{}, false, err
	} else if err := s.checkTargets(ctx, c.Scope, terms); err != nil {
		return Promotion{}, false, err
	}
	return s.repo.Change(ctx, c, func(p Promotion) (Decision, error) {
		if p.Version != c.ExpectedVersion {
			return Decision{}, &VersionConflictError{Current: p.Version}
		}
		terms, err := patch.Apply(p.Terms).Normalize()
		if err != nil {
			return Decision{}, err
		}
		if sameTerms(terms, p.Terms) {
			return Decision{Next: p}, nil
		}
		next := p
		next.Terms = terms
		return Decision{Next: next, Action: ActionUpdated, Changed: true}, nil
	})
}

// Activate makes a promotion applicable (within its window). Activating an
// active promotion is a no-op whatever version is sent, as a retry must be.
func (s *Service) Activate(ctx context.Context, c Change) (Promotion, bool, error) {
	return s.setStatus(ctx, c, StatusActive, ActionActivated)
}

// Deactivate stops a promotion applying to new orders. Accepted orders keep
// their discount. A no-op on an inactive promotion.
func (s *Service) Deactivate(ctx context.Context, c Change) (Promotion, bool, error) {
	return s.setStatus(ctx, c, StatusInactive, ActionDisabled)
}

func (s *Service) setStatus(ctx context.Context, c Change, to Status, action string) (Promotion, bool, error) {
	if err := validateChange(c); err != nil {
		return Promotion{}, false, err
	}
	if !s.writesEnabled {
		return Promotion{}, false, ErrWritesDisabled
	}
	return s.repo.Change(ctx, c, func(p Promotion) (Decision, error) {
		return DecideStatus(p, c.ExpectedVersion, to, action)
	})
}

// DecideStatus is the activate/deactivate rule on the locked promotion.
func DecideStatus(p Promotion, expectedVersion int, to Status, action string) (Decision, error) {
	if p.Status == to {
		return Decision{Next: p}, nil
	}
	if p.Version != expectedVersion {
		return Decision{}, &VersionConflictError{Current: p.Version}
	}
	next := p
	next.Status = to
	return Decision{Next: next, Action: action, Changed: true}, nil
}
