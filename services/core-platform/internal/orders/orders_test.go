package orders

import (
	"context"
	"errors"
	"strings"
	"testing"

	"servvia/services/core-platform/internal/pricing"
)

func ptr[T any](v T) *T { return &v }

func mod(g, o string) pricing.ModifierSelection {
	return pricing.ModifierSelection{ModifierGroupID: g, OptionID: o}
}

func request() OrderRequest {
	return OrderRequest{VenueID: "v", Source: SourceWaiterTablet, ServiceMode: ServiceDineIn, TableSessionID: ptr("s"),
		Lines: []LineInput{
			{MenuItemID: "burger", Quantity: 2, Modifiers: []pricing.ModifierSelection{mod("size", "large"), mod("extras", "cheese")}},
			{MenuItemID: "chips", Quantity: 1, Notes: ptr("no salt"), Seat: ptr(2)},
		}}
}

func TestFingerprintIsSemantic(t *testing.T) {
	base := request().Fingerprint()

	same := request()
	same.Lines[0], same.Lines[1] = same.Lines[1], same.Lines[0]
	same.Lines[1].Modifiers = []pricing.ModifierSelection{mod("extras", "cheese"), mod("size", "large")}
	same.Lines[1].ExpectedUnitPriceCents = ptr[int64](1234) // a displayed price is not part of the request identity
	if same.Fingerprint() != base {
		t.Error("line order, modifier order and displayed prices must not change the fingerprint")
	}
	seatZero := request()
	seatZero.Lines[0].Seat = ptr(0) // normalised to "no seat", as Nest does
	if seatZero.Fingerprint() != base {
		t.Error("a non-positive seat is no seat")
	}

	for name, change := range map[string]func(*OrderRequest){
		"venue":        func(r *OrderRequest) { r.VenueID = "w" },
		"source":       func(r *OrderRequest) { r.Source = SourceOrderTablet },
		"service mode": func(r *OrderRequest) { r.ServiceMode = ServiceTakeaway },
		"session":      func(r *OrderRequest) { r.TableSessionID = ptr("t") },
		"order notes":  func(r *OrderRequest) { r.Notes = ptr("birthday") },
		"product":      func(r *OrderRequest) { r.Lines[1].MenuItemID = "salad" },
		"quantity":     func(r *OrderRequest) { r.Lines[0].Quantity = 3 },
		"modifier":     func(r *OrderRequest) { r.Lines[0].Modifiers[0] = mod("size", "small") },
		"extra line":   func(r *OrderRequest) { r.Lines = append(r.Lines, LineInput{MenuItemID: "tea", Quantity: 1}) },
		"line notes":   func(r *OrderRequest) { r.Lines[1].Notes = ptr("extra salt") },
		"seat":         func(r *OrderRequest) { r.Lines[1].Seat = ptr(3) },
	} {
		r := request()
		change(&r)
		if r.Fingerprint() == base {
			t.Errorf("changing the %s must change the fingerprint", name)
		}
	}
}

// What was persisted fingerprints like the request that created it.
func TestCreatedFingerprintMatchesTheRequest(t *testing.T) {
	req := request()
	round1, round2 := "r1", "r2"
	o := Order{VenueID: "v", Source: req.Source, ServiceMode: req.ServiceMode, TableSessionID: req.TableSessionID,
		Rounds: []Round{{ID: round1, Sequence: 1}, {ID: round2, Sequence: 2}},
		Lines: []Line{
			{RoundID: &round1, MenuItemID: "chips", Quantity: 1, Notes: ptr("no salt"), Seat: ptr(2)},
			{RoundID: &round1, MenuItemID: "burger", Quantity: 2, Modifiers: []pricing.PricedModifier{
				{ModifierGroupID: "extras", OptionID: "cheese", PriceDeltaCents: 150},
				{ModifierGroupID: "size", OptionID: "large", PriceDeltaCents: 250}}},
			// A later round does not belong to the creating request.
			{RoundID: &round2, MenuItemID: "tea", Quantity: 1},
		}}
	if CreatedFingerprint(o) != req.Fingerprint() {
		t.Error("the persisted order must fingerprint like its creating request")
	}
	if SubmittedRoundFingerprint(o, o.Rounds[1]) != RoundFingerprint([]LineInput{{MenuItemID: "tea", Quantity: 1}}, nil) {
		t.Error("round 2 must fingerprint like its own lines")
	}
}

func TestStaffSources(t *testing.T) {
	for _, c := range []struct {
		source   Source
		onTablet bool
		ok       bool
	}{
		{SourcePOSTerminal, false, true}, {SourceWaiterTablet, false, false}, {SourceOrderTablet, false, false},
		{SourceWaiterTablet, true, true}, {SourceOrderTablet, true, true}, {SourcePOSTerminal, true, false},
		{SourceKiosk, false, false}, {SourceKiosk, true, false}, {SourceCustomerWeb, false, false},
	} {
		if got := StaffMaySubmit(c.source, c.onTablet); got != c.ok {
			t.Errorf("%s on tablet=%v: %v", c.source, c.onTablet, got)
		}
	}
	for _, legacy := range []Source{"staff", "online", "SQL"} {
		if legacy.Canonical() {
			t.Errorf("%q must not be canonical", legacy)
		}
	}
}

// memRepo is a minimal Repository for service-level rules; the database
// guarantees are tested against PostgreSQL in tests/integration.
type memRepo struct {
	byKey   map[string]Order
	created int
	audits  []string
	// raceWith, if set, is committed by "another request" the first time
	// Create runs, so Create reports ErrDuplicateKey.
	raceWith *Order
}

func (m *memRepo) FindByKey(_ context.Context, _, key string) (Order, bool, error) {
	o, ok := m.byKey[key]
	return o, ok, nil
}
func (m *memRepo) Get(_ context.Context, _, id string) (Order, error) {
	for _, o := range m.byKey {
		if o.ID == id {
			return o, nil
		}
	}
	return Order{}, ErrOrderNotFound
}
func (m *memRepo) Create(_ context.Context, n NewOrder) (Order, error) {
	if m.raceWith != nil {
		m.byKey[n.Command.IdempotencyKey], m.raceWith = *m.raceWith, nil
		return Order{}, ErrDuplicateKey
	}
	m.created++
	o := Order{ID: "ORD-1", VenueID: n.Command.Scope.Venue.ID, Source: n.Command.Source, ServiceMode: n.Command.ServiceMode,
		TableSessionID: n.Command.TableSessionID, IdempotencyKey: n.Command.IdempotencyKey, Rounds: []Round{{ID: "r1"}}}
	for i, l := range n.Quote.Lines {
		o.Lines = append(o.Lines, Line{RoundID: ptr("r1"), MenuItemID: l.MenuItemID, Quantity: l.Quantity,
			Modifiers: l.Modifiers, Notes: n.Command.Lines[i].Notes, Seat: n.Command.Lines[i].Seat})
	}
	m.byKey[o.IdempotencyKey] = o
	return o, nil
}
func (m *memRepo) AddRound(context.Context, NewRound) (Order, error) {
	return Order{}, errors.New("unused")
}
func (m *memRepo) Audit(_ context.Context, _ Scope, _ Actor, action, _ string, _ map[string]any) {
	m.audits = append(m.audits, action)
}

type catalog map[string]pricing.CatalogItem

func (c catalog) Items(context.Context, string, string, []string) (map[string]pricing.CatalogItem, error) {
	return c, nil
}

var testCatalog = catalog{
	"burger": {ID: "burger", Title: "Burger", PriceCents: 1800, IsAvailable: true},
	"chips":  {ID: "chips", Title: "Chips", PriceCents: 700, IsAvailable: true},
}

func command(key string) CreateCommand {
	return CreateCommand{Scope: Scope{OrganizationID: "o", Venue: pricing.Venue{ID: "v", OrganizationID: "o", Tax: pricing.NZGSTInclusive}},
		Source: SourcePOSTerminal, ServiceMode: ServiceTakeaway, IdempotencyKey: key,
		Lines: []LineInput{{MenuItemID: "burger", Quantity: 1}}, Actor: Actor{StaffID: "staff"}}
}

func TestCreateReplayAndConflict(t *testing.T) {
	ctx := context.Background()
	key := strings.Repeat("k", 16)
	repo := &memRepo{byKey: map[string]Order{}}
	svc := NewService(repo, testCatalog, true)

	first, created, err := svc.Create(ctx, command(key))
	if err != nil || !created || repo.created != 1 {
		t.Fatalf("create: %v %v", created, err)
	}
	again, created, err := svc.Create(ctx, command(key))
	if err != nil || created || again.ID != first.ID || repo.created != 1 {
		t.Fatalf("replay: %+v %v %v", again, created, err)
	}
	different := command(key)
	different.Lines[0].Quantity = 2
	var conflict *IdempotencyConflictError
	if _, _, err := svc.Create(ctx, different); !errors.As(err, &conflict) || conflict.OrderID != first.ID || repo.created != 1 {
		t.Fatalf("conflict: %v", err)
	}
	if strings.Join(repo.audits, ",") != "ORDER_IDEMPOTENT_REPLAY,ORDER_IDEMPOTENCY_CONFLICT" {
		t.Errorf("audits %v", repo.audits)
	}
	if conflict.Error() != `idempotencyKey "`+key+`" was already used to create a different order` {
		t.Errorf("message %q must be the NestJS one", conflict.Error())
	}
}

// Losing the unique-index race resolves like a sequential replay.
func TestCreateRecoversFromAConcurrentWinner(t *testing.T) {
	ctx := context.Background()
	key := strings.Repeat("r", 16)
	winner := Order{ID: "ORD-WIN", VenueID: "v", Source: SourcePOSTerminal, ServiceMode: ServiceTakeaway,
		IdempotencyKey: key, Rounds: []Round{{ID: "r1"}}, Lines: []Line{{RoundID: ptr("r1"), MenuItemID: "burger", Quantity: 1}}}
	repo := &memRepo{byKey: map[string]Order{}, raceWith: &winner}
	o, created, err := NewService(repo, testCatalog, true).Create(ctx, command(key))
	if err != nil || created || o.ID != "ORD-WIN" {
		t.Fatalf("same request lost the race: %+v %v %v", o, created, err)
	}

	loser := winner
	loser.Lines = []Line{{RoundID: ptr("r1"), MenuItemID: "chips", Quantity: 1}}
	repo = &memRepo{byKey: map[string]Order{}, raceWith: &loser}
	var conflict *IdempotencyConflictError
	if _, _, err := NewService(repo, testCatalog, true).Create(ctx, command(key)); !errors.As(err, &conflict) {
		t.Fatalf("different request lost the race: %v", err)
	}
}

func TestCreateValidation(t *testing.T) {
	ctx := context.Background()
	for name, c := range map[string]struct {
		change func(*CreateCommand)
		want   string
	}{
		"short key":           {func(c *CreateCommand) { c.IdempotencyKey = "short" }, "idempotencyKey must be a string of 16 to 255 characters"},
		"legacy source":       {func(c *CreateCommand) { c.Source = "staff" }, "source must be one of pos_terminal, waiter_tablet, order_tablet, kiosk, customer_web"},
		"dine-in, no session": {func(c *CreateCommand) { c.ServiceMode = ServiceDineIn }, "A dine-in order requires tableSessionId"},
		"takeaway, session":   {func(c *CreateCommand) { c.TableSessionID = ptr("s") }, "A takeaway order must not specify a table session"},
		"unknown mode":        {func(c *CreateCommand) { c.ServiceMode = "delivery" }, "serviceMode must be one of dine_in, takeaway"},
	} {
		cmd := command(strings.Repeat("v", 16))
		c.change(&cmd)
		repo := &memRepo{byKey: map[string]Order{}}
		var v *ValidationError
		if _, _, err := NewService(repo, testCatalog, true).Create(ctx, cmd); !errors.As(err, &v) || v.Message != c.want || repo.created != 0 {
			t.Errorf("%s: %v", name, err)
		}
	}
	cmd := command(strings.Repeat("v", 16))
	cmd.Actor.OnTablet = true // a tablet cannot claim to be the POS terminal
	if _, _, err := NewService(&memRepo{byKey: map[string]Order{}}, testCatalog, true).Create(ctx, cmd); !errors.Is(err, ErrSourceNotPermitted) {
		t.Errorf("source not permitted: %v", err)
	}
	if _, _, err := NewService(&memRepo{byKey: map[string]Order{}}, testCatalog, false).Create(ctx, command(strings.Repeat("v", 16))); !errors.Is(err, ErrWritesDisabled) {
		t.Errorf("read-only instance: %v", err)
	}
}

// Pricing is D1's: the client's displayed price is checked, never used.
func TestCreateUsesServerPricing(t *testing.T) {
	cmd := command(strings.Repeat("p", 16))
	cmd.Lines[0].ExpectedUnitPriceCents = ptr[int64](100)
	var pe *pricing.Error
	if _, _, err := NewService(&memRepo{byKey: map[string]Order{}}, testCatalog, true).Create(context.Background(), cmd); !errors.As(err, &pe) || pe.Kind != pricing.KindStalePrice {
		t.Fatalf("stale price: %v", err)
	}
}

// Phase D11: the promotion named is part of the request. The same key with
// another promotion, or none, is a different request; a request without one
// keeps the fingerprint it had before D11 (pinned digest).
func TestPromotionIsPartOfTheFingerprint(t *testing.T) {
	plain := request()
	// The pre-D11 formula, verbatim: no "promotion" key at all.
	keys := []lineKey{}
	for _, l := range plain.Lines {
		keys = append(keys, inputKey(l))
	}
	preD11 := digest(map[string]any{"venue": plain.VenueID, "source": plain.Source, "mode": plain.ServiceMode,
		"session": *plain.TableSessionID, "notes": text(plain.Notes), "lines": sortedLines(keys)})
	if plain.Fingerprint() != preD11 {
		t.Fatal("a request without a promotion must keep its pre-D11 fingerprint")
	}
	with, other := request(), request()
	with.PromotionID, other.PromotionID = ptr("p1"), ptr("p2")
	if with.Fingerprint() == plain.Fingerprint() || with.Fingerprint() == other.Fingerprint() {
		t.Error("the promotion must change the fingerprint")
	}
	if RoundFingerprint(plain.Lines, nil) == RoundFingerprint(plain.Lines, ptr("p1")) {
		t.Error("the promotion must change a round's fingerprint")
	}

	// From what was persisted: round 1's applied promotion.
	o := Order{VenueID: "v", Source: SourceWaiterTablet, ServiceMode: ServiceDineIn, TableSessionID: ptr("s"),
		Rounds:     []Round{{ID: "r1"}, {ID: "r2"}},
		Lines:      []Line{{RoundID: ptr("r1"), MenuItemID: "chips", Quantity: 1}, {RoundID: ptr("r2"), MenuItemID: "tea", Quantity: 1}},
		Promotions: []AppliedPromotion{{RoundID: "r2", PromotionID: "p9"}}}
	req := OrderRequest{VenueID: "v", Source: SourceWaiterTablet, ServiceMode: ServiceDineIn, TableSessionID: ptr("s"),
		Lines: []LineInput{{MenuItemID: "chips", Quantity: 1}}}
	if CreatedFingerprint(o) != req.Fingerprint() {
		t.Error("round 1 had no promotion")
	}
	if SubmittedRoundFingerprint(o, o.Rounds[1]) != RoundFingerprint([]LineInput{{MenuItemID: "tea", Quantity: 1}}, ptr("p9")) {
		t.Error("round 2's promotion is part of its fingerprint")
	}
}
