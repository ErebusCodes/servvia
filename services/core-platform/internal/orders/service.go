package orders

import (
	"context"
	"errors"
	"strings"
	"time"

	"servvia/services/core-platform/internal/audit"
	"servvia/services/core-platform/internal/pricing"
	"servvia/services/core-platform/internal/promotions"
)

// Scope is the tenancy and pricing context of every operation: the caller's
// organization and one of its venues.
type Scope struct {
	OrganizationID string
	Venue          pricing.Venue
}

// Actor is the staff member placing or extending an order.
type Actor struct {
	StaffID string
	Email   string
	Role    string
	// OnTablet: the caller is a tablet elevated by this staff member.
	OnTablet bool
	// Device is the device the staff member acted through, from the
	// verified credential (audit.DeviceOf); the zero value is none.
	Device audit.Device
}

// CreateCommand places an order. IdempotencyKey makes it safe to retry.
type CreateCommand struct {
	Scope          Scope
	Source         Source
	ServiceMode    ServiceMode
	TableSessionID *string
	Notes          *string
	Lines          []LineInput
	// PromotionID names at most one promotion for this submission (Phase
	// D11). The server decides whether it applies and what it discounts.
	PromotionID    *string
	IdempotencyKey string
	Actor          Actor
}

// RoundCommand submits further lines to a table-service order.
type RoundCommand struct {
	Scope       Scope
	OrderID     string
	Lines       []LineInput
	PromotionID *string
	RequestKey  string
	Actor       Actor
}

// NewOrder is a priced order ready to persist. Promotion, when set, is the
// evaluated promotion: the repository commits it only if the promotion is
// still at the evaluated version (promotions.ErrChanged otherwise), and
// writes its snapshot with the round.
type NewOrder struct {
	Command   CreateCommand
	Quote     pricing.Quote
	Promotion *promotions.Application
}

// NewRound is a priced round ready to persist. The repository adds it under a
// lock on the order and recomputes the order's totals over every line with
// TotalsFor(gross, discount), so concurrent rounds cannot lose each other's
// amounts. Promotion is as for NewOrder.
type NewRound struct {
	Command   RoundCommand
	Lines     []pricing.PricedLine
	Promotion *promotions.Application
	TotalsFor func(subtotalCents, discountCents int64) (pricing.Totals, error)
}

// PromotionSource reads a promotion of a venue (promotions/pgstore).
type PromotionSource interface {
	Get(ctx context.Context, venueID, id string) (promotions.Promotion, error)
}

// errNoPromotions: a promotion was requested of a service built without a
// promotion source (a wiring fault, never a client's).
var errNoPromotions = errors.New("orders: no promotion source configured")

// Sentinels a Repository returns when a unique key was taken concurrently.
var (
	ErrDuplicateKey      = errors.New("idempotency key already used")
	ErrDuplicateRoundKey = errors.New("round key already used")
)

// Repository persists orders. Create and AddRound are single transactions
// that also write the round, its lines, the outbox event and the audit row.
// Create must, for table service, lock the session, require it open, and
// derive the table from it; a taken (venueId, idempotencyKey) is
// ErrDuplicateKey. A session may hold several orders: nothing here limits
// them (occupancy is the session's). AddRound must lock the order, require it
// active and its session open, and number the round; a taken round key is
// ErrDuplicateRoundKey.
type Repository interface {
	FindByKey(ctx context.Context, venueID, key string) (Order, bool, error)
	Get(ctx context.Context, venueID, orderID string) (Order, error)
	Create(ctx context.Context, n NewOrder) (Order, error)
	AddRound(ctx context.Context, n NewRound) (Order, error)
	// Audit records an outcome that changes nothing (a replay or a refused
	// key reuse). Best effort: the outcome never depends on it.
	Audit(ctx context.Context, scope Scope, actor Actor, action, orderID string, detail map[string]any)
}

// Service is the canonical order application service. It coordinates the
// catalog, pricing and promotions: pricing prices the lines, promotions
// decide what a named promotion covers (with pricing's money math), and
// pricing computes the discounted totals. It never computes money itself.
type Service struct {
	repo          Repository
	catalog       pricing.Catalog
	promotions    PromotionSource
	now           func() time.Time
	writesEnabled bool
}

func NewService(repo Repository, catalog pricing.Catalog, writesEnabled bool) *Service {
	return &Service{repo: repo, catalog: catalog, now: time.Now, writesEnabled: writesEnabled}
}

// WithPromotions lets orders apply promotions (Phase D11), evaluated at
// now() (UTC instants).
func (s *Service) WithPromotions(src PromotionSource, now func() time.Time) *Service {
	s.promotions, s.now = src, now
	return s
}

// promotion evaluates the named promotion, if any, against a submission's
// priced lines. nil, nil when none is named.
func (s *Service) promotion(ctx context.Context, venue pricing.Venue, id *string, lines []pricing.PricedLine) (*promotions.Application, error) {
	if id == nil {
		return nil, nil
	}
	if s.promotions == nil {
		return nil, errNoPromotions
	}
	p, err := s.promotions.Get(ctx, venue.ID, *id)
	if err != nil {
		return nil, err
	}
	app, err := promotions.Evaluate(p, venue, s.now().UTC(), lines)
	if err != nil {
		return nil, err
	}
	return &app, nil
}

// Get returns an order of the scope's venue, including one the NestJS path
// created (its Source is then a legacy value).
func (s *Service) Get(ctx context.Context, scope Scope, orderID string) (Order, error) {
	return s.repo.Get(ctx, scope.Venue.ID, orderID)
}

// Create places an order, or returns the one this idempotency key already
// placed for the same request (created=false). The same key with a
// different request is *IdempotencyConflictError and creates nothing.
func (s *Service) Create(ctx context.Context, cmd CreateCommand) (Order, bool, error) {
	if err := validateCreate(cmd); err != nil {
		return Order{}, false, err
	}
	if !s.writesEnabled {
		return Order{}, false, ErrWritesDisabled
	}
	fp := OrderRequest{VenueID: cmd.Scope.Venue.ID, Source: cmd.Source, ServiceMode: cmd.ServiceMode,
		TableSessionID: cmd.TableSessionID, Notes: NormalizeNotes(cmd.Notes), Lines: cmd.Lines, PromotionID: cmd.PromotionID}.Fingerprint()

	// A replay is decided before pricing and before any promotion is read,
	// so it returns the accepted order, with its accepted discount, even if
	// the menu or the promotion changed since: never a second discount.
	if existing, found, err := s.repo.FindByKey(ctx, cmd.Scope.Venue.ID, cmd.IdempotencyKey); err != nil {
		return Order{}, false, err
	} else if found {
		return s.replayCreate(ctx, cmd, existing, fp)
	}

	catalog, err := s.catalog.Items(ctx, cmd.Scope.Venue.OrganizationID, cmd.Scope.Venue.ID, itemIDs(cmd.Lines))
	if err != nil {
		return Order{}, false, err
	}
	quote, err := pricing.PriceOrder(cmd.Scope.Venue.ID, cmd.Scope.Venue.Tax, catalog, priceRequests(cmd.Lines))
	if err != nil {
		return Order{}, false, err
	}
	app, err := s.promotion(ctx, cmd.Scope.Venue, cmd.PromotionID, quote.Lines)
	if err != nil {
		return Order{}, false, err
	}
	if app != nil {
		if quote.Totals, err = pricing.ComputeDiscountedTotals(cmd.Scope.Venue.ID, cmd.Scope.Venue.Tax,
			quote.SubtotalCents, app.DiscountCents); err != nil {
			return Order{}, false, err
		}
	}
	o, err := s.repo.Create(ctx, NewOrder{Command: cmd, Quote: quote, Promotion: app})
	if errors.Is(err, ErrDuplicateKey) {
		// A concurrent request with this key committed first.
		existing, found, ferr := s.repo.FindByKey(ctx, cmd.Scope.Venue.ID, cmd.IdempotencyKey)
		if ferr != nil || !found {
			return Order{}, false, errors.Join(err, ferr)
		}
		return s.replayCreate(ctx, cmd, existing, fp)
	}
	if err != nil {
		return Order{}, false, err
	}
	return o, true, nil
}

func (s *Service) replayCreate(ctx context.Context, cmd CreateCommand, existing Order, fp string) (Order, bool, error) {
	if CreatedFingerprint(existing) == fp {
		s.repo.Audit(ctx, cmd.Scope, cmd.Actor, "ORDER_IDEMPOTENT_REPLAY", existing.ID,
			map[string]any{"idempotencyKey": cmd.IdempotencyKey})
		return existing, false, nil
	}
	s.repo.Audit(ctx, cmd.Scope, cmd.Actor, "ORDER_IDEMPOTENCY_CONFLICT", existing.ID,
		map[string]any{"idempotencyKey": cmd.IdempotencyKey, "reason": "same idempotencyKey, different request"})
	return Order{}, false, &IdempotencyConflictError{Key: cmd.IdempotencyKey, OrderID: existing.ID}
}

// SubmitRound adds lines to a table-service order as its next round, or
// returns the order unchanged if this round key already submitted the same
// lines (created=false).
func (s *Service) SubmitRound(ctx context.Context, cmd RoundCommand) (Order, bool, error) {
	if err := validateKey(cmd.RequestKey); err != nil {
		return Order{}, false, err
	}
	if !s.writesEnabled {
		return Order{}, false, ErrWritesDisabled
	}
	o, err := s.repo.Get(ctx, cmd.Scope.Venue.ID, cmd.OrderID)
	if err != nil {
		return Order{}, false, err
	}
	if replayed, done, err := s.replayRound(ctx, cmd, o); done {
		return replayed, false, err
	}
	// Fast checks; AddRound re-checks under the order's lock.
	if o.ServiceMode != ServiceDineIn || o.TableSessionID == nil {
		return Order{}, false, ErrNotTableService
	}
	if !o.Status.Active() {
		return Order{}, false, &OrderNotActiveError{Status: o.Status}
	}

	catalog, err := s.catalog.Items(ctx, cmd.Scope.Venue.OrganizationID, cmd.Scope.Venue.ID, itemIDs(cmd.Lines))
	if err != nil {
		return Order{}, false, err
	}
	requests := priceRequests(cmd.Lines)
	priced, _, err := pricing.PriceLines(catalog, requests)
	if err != nil {
		return Order{}, false, err
	}
	if err := pricing.CheckExpectedPrices(requests, priced); err != nil {
		return Order{}, false, err
	}
	venue := cmd.Scope.Venue
	app, err := s.promotion(ctx, venue, cmd.PromotionID, priced)
	if err != nil {
		return Order{}, false, err
	}
	updated, err := s.repo.AddRound(ctx, NewRound{Command: cmd, Lines: priced, Promotion: app,
		TotalsFor: func(subtotal, discount int64) (pricing.Totals, error) {
			if !pricing.Persistable(subtotal) {
				return pricing.Totals{}, pricing.ErrAmountOutOfRange()
			}
			return pricing.ComputeDiscountedTotals(venue.ID, venue.Tax, subtotal, discount)
		}})
	if errors.Is(err, ErrDuplicateRoundKey) {
		o, gerr := s.repo.Get(ctx, cmd.Scope.Venue.ID, cmd.OrderID)
		if gerr != nil {
			return Order{}, false, gerr
		}
		if replayed, done, rerr := s.replayRound(ctx, cmd, o); done {
			return replayed, false, rerr
		}
		return Order{}, false, err
	}
	if err != nil {
		return Order{}, false, err
	}
	return updated, true, nil
}

// replayRound handles a round key the order already has: done=true with the
// order for the same lines, or with *RoundConflictError for different ones.
func (s *Service) replayRound(ctx context.Context, cmd RoundCommand, o Order) (Order, bool, error) {
	for _, r := range o.Rounds {
		if r.RequestKey != cmd.RequestKey {
			continue
		}
		if SubmittedRoundFingerprint(o, r) == RoundFingerprint(cmd.Lines, cmd.PromotionID) {
			s.repo.Audit(ctx, cmd.Scope, cmd.Actor, "ORDER_ROUND_IDEMPOTENT_REPLAY", o.ID,
				map[string]any{"idempotencyKey": cmd.RequestKey, "roundId": r.ID})
			return o, true, nil
		}
		s.repo.Audit(ctx, cmd.Scope, cmd.Actor, "ORDER_ROUND_IDEMPOTENCY_CONFLICT", o.ID,
			map[string]any{"idempotencyKey": cmd.RequestKey, "roundId": r.ID})
		return Order{}, true, &RoundConflictError{Key: cmd.RequestKey}
	}
	return Order{}, false, nil
}

func validateKey(key string) error {
	if n := len([]rune(key)); n < MinKeyLength || n > MaxKeyLength {
		return invalid("idempotencyKey must be a string of 16 to 255 characters")
	}
	return nil
}

func validateCreate(cmd CreateCommand) error {
	if err := validateKey(cmd.IdempotencyKey); err != nil {
		return err
	}
	if !cmd.Source.Canonical() {
		return invalid("source must be one of pos_terminal, waiter_tablet, order_tablet, kiosk, customer_web")
	}
	if !StaffMaySubmit(cmd.Source, cmd.Actor.OnTablet) {
		return ErrSourceNotPermitted
	}
	switch cmd.ServiceMode {
	case ServiceDineIn:
		if cmd.TableSessionID == nil || strings.TrimSpace(*cmd.TableSessionID) == "" {
			return invalid("A dine-in order requires tableSessionId")
		}
	case ServiceTakeaway:
		if cmd.TableSessionID != nil {
			return invalid("A takeaway order must not specify a table session")
		}
	default:
		return invalid("serviceMode must be one of dine_in, takeaway")
	}
	return nil
}

func itemIDs(lines []LineInput) []string {
	seen := map[string]bool{}
	var ids []string
	for _, l := range lines {
		if !seen[l.MenuItemID] {
			seen[l.MenuItemID] = true
			ids = append(ids, l.MenuItemID)
		}
	}
	return ids
}

func priceRequests(lines []LineInput) []pricing.LineRequest {
	out := make([]pricing.LineRequest, 0, len(lines))
	for _, l := range lines {
		out = append(out, pricing.LineRequest{MenuItemID: l.MenuItemID, Quantity: l.Quantity,
			Modifiers: l.Modifiers, ExpectedUnitPriceCents: l.ExpectedUnitPriceCents})
	}
	return out
}
