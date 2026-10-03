package contract

// Kitchen tickets are new Servvia-native behaviour, tested against the
// written contract (contracts/openapi/kitchen-tickets.yaml). The repository
// here is in memory and applies kitchen.Decide as the real store does; the
// database guarantees (projection, idempotency, locking) are tested in
// tests/integration.

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"sync"
	"testing"
	"time"

	"servvia/services/core-platform/internal/health"
	"servvia/services/core-platform/internal/identity"
	"servvia/services/core-platform/internal/kitchen"
	"servvia/services/core-platform/internal/kitchen/kitchenapi"
	"servvia/services/core-platform/internal/menu"
	"servvia/services/core-platform/internal/ratelimit"
	"servvia/services/core-platform/internal/server"
	"servvia/services/core-platform/internal/venues"
	"servvia/services/core-platform/tests/testsupport"
)

const ticketID = "e0000000-0000-4000-8000-00000000000e"

type memoryTickets struct {
	mu      sync.Mutex
	tickets map[string]kitchen.Ticket
}

func newMemoryTickets() *memoryTickets {
	now := time.Date(2026, 9, 29, 1, 2, 3, 4e6, time.UTC)
	table, notes, seat := "4", "no nuts", 2
	return &memoryTickets{tickets: map[string]kitchen.Ticket{ticketID: {
		ID: ticketID, VenueID: venueID, OrderID: "ORD-1", RoundID: testsupport.UUID(), Station: "kitchen",
		Status: kitchen.StatusNew, Version: 1, SourceEventID: testsupport.UUID(), RoundSequence: 1,
		TableNumber: &table, OrderSource: "waiter_tablet", CreatedAt: now, UpdatedAt: now,
		Lines: []kitchen.Line{{ID: testsupport.UUID(), OrderItemID: testsupport.UUID(), Position: 1, Title: "Burger", Quantity: 2,
			Modifiers: []kitchen.Modifier{{GroupName: "Size", OptionName: "Large"}}, Notes: &notes, Seat: &seat}},
	}}}
}

func (m *memoryTickets) List(_ context.Context, venue string, f kitchen.Filter) ([]kitchen.Ticket, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	var out []kitchen.Ticket
	for _, t := range m.tickets {
		for _, s := range f.Statuses {
			if t.VenueID == venue && t.Status == s && (f.Station == "" || f.Station == t.Station) {
				out = append(out, t)
			}
		}
	}
	return out, nil
}

func (m *memoryTickets) Get(_ context.Context, venue, id string) (kitchen.Ticket, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	t, ok := m.tickets[id]
	if !ok || t.VenueID != venue {
		return kitchen.Ticket{}, kitchen.ErrTicketNotFound
	}
	return t, nil
}

func (m *memoryTickets) Transition(_ context.Context, cmd kitchen.TransitionCommand) (kitchen.Ticket, bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	t, ok := m.tickets[cmd.TicketID]
	if !ok || t.VenueID != cmd.VenueID {
		return kitchen.Ticket{}, false, kitchen.ErrTicketNotFound
	}
	changed, err := kitchen.Decide(t, cmd)
	if err != nil || !changed {
		return t, false, err
	}
	now := time.Date(2026, 9, 29, 1, 5, 0, 0, time.UTC)
	t.Status, t.Version, t.UpdatedAt = cmd.To, t.Version+1, now
	switch cmd.To {
	case kitchen.StatusPreparing:
		t.PreparingAt = &now
	case kitchen.StatusReady:
		t.ReadyAt = &now
	}
	m.tickets[t.ID] = t
	return t, true, nil
}

func kitchenRoutes(writable bool) http.Handler {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	return server.Routes(server.Deps{
		Logger: logger, Health: health.New(okPinger{}, time.Second),
		Menu:     menu.NewHandler(staticStore{}, logger),
		Venues:   venues.NewHandler(venueStore{}, logger),
		Kitchen:  kitchenapi.NewHandler(kitchen.NewService(newMemoryTickets(), writable), venueStore{}, logger),
		Verifier: identity.NewVerifier(secret), TabletDevices: activeDevices{}, VenueGrants: grantAll{},
		RateLimiter: ratelimit.New(admit, 0, logger),
	})
}

func kitchenSchema(t *testing.T, name string) func([]byte) {
	s := testsupport.Schema(t, "openapi/kitchen-tickets.yaml", "/components/schemas/"+name)
	return func(b []byte) { t.Helper(); testsupport.Validate(t, s, b) }
}

func TestKitchenTicketAuthorization(t *testing.T) {
	h := kitchenRoutes(true)
	claims := nestShapedClaims()
	nestErr := kitchenSchema(t, "NestError")
	list := base(venueID) + "/kitchen-tickets"
	for name, c := range map[string]struct {
		token  string
		path   string
		status int
	}{
		"KDS device":                 {signed(t, claims["kds_device"]), list, 200},
		"kitchen staff":              {staffWithRole(t, "kitchen"), list, 200},
		"owner session":              {signed(t, claims["staff"]), list, 200},
		"manager":                    {staffWithRole(t, "manager"), list, 200},
		"cashier":                    {staffWithRole(t, "cashier"), list, 200},
		"tablet elevated (staff)":    {signed(t, claims["tablet_staff"]), list, 200},
		"viewer staff":               {staffWithRole(t, "viewer"), list, 403},
		"customer-mode tablet":       {signed(t, claims["tablet_device"]), list, 403},
		"no token":                   {"", list, 401},
		"KDS, another venue":         {signed(t, claims["kds_device"]), base(otherVenue) + "/kitchen-tickets", 403},
		"staff, another org's venue": {signed(t, claims["staff"]), base(otherVenue) + "/kitchen-tickets", 404},
	} {
		res := do(t, h, "GET", c.path, c.token, nil)
		if res.status != c.status {
			t.Errorf("%s: %d %s", name, res.status, res.body)
			continue
		}
		if c.status != 200 {
			nestErr(res.body)
		}
	}
	// Refused callers cannot move a ticket either.
	move := list + "/" + ticketID + "/transitions"
	for name, token := range map[string]string{
		"viewer":               staffWithRole(t, "viewer"),
		"customer-mode tablet": signed(t, claims["tablet_device"]),
	} {
		if res := do(t, h, "POST", move, token, map[string]any{"to": "preparing", "version": 1}); res.status != 403 {
			t.Errorf("%s transition: %d", name, res.status)
		}
	}
}

func TestKitchenTicketLifecycleMatchesContract(t *testing.T) {
	h := kitchenRoutes(true)
	kds := signed(t, nestShapedClaims()["kds_device"])
	ticket, coded := kitchenSchema(t, "KitchenTicket"), kitchenSchema(t, "CodedError")
	path := base(venueID) + "/kitchen-tickets"
	move := path + "/" + ticketID + "/transitions"

	res := do(t, h, "GET", path, kds, nil)
	if res.status != 200 {
		t.Fatalf("list: %d %s", res.status, res.body)
	}
	listSchema := testsupport.Schema(t, "openapi/kitchen-tickets.yaml", "/paths/~1venues~1{venueId}~1kitchen-tickets/get/responses/200/content/application~1json/schema")
	testsupport.Validate(t, listSchema, res.body)

	res = do(t, h, "GET", path+"/"+ticketID, kds, nil)
	if res.status != 200 || res.json["status"] != "new" {
		t.Fatalf("get: %d %s", res.status, res.body)
	}
	ticket(res.body)

	res = do(t, h, "POST", move, kds, map[string]any{"to": "preparing", "version": 1})
	if res.status != 200 || res.json["status"] != "preparing" || res.json["version"] != float64(2) {
		t.Fatalf("start: %d %s", res.status, res.body)
	}
	ticket(res.body)

	// A retry of the same transition returns the ticket unchanged.
	res = do(t, h, "POST", move, kds, map[string]any{"to": "preparing", "version": 1})
	if res.status != 200 || res.json["version"] != float64(2) {
		t.Errorf("retry: %d %s", res.status, res.body)
	}

	for name, c := range map[string]struct {
		body   map[string]any
		status int
		code   string
	}{
		"stale version":   {map[string]any{"to": "ready", "version": 1}, 409, "VERSION_CONFLICT"},
		"skipping ready":  {map[string]any{"to": "completed", "version": 2}, 409, "INVALID_TRANSITION"},
		"back to new":     {map[string]any{"to": "new", "version": 2}, 400, ""},
		"unknown status":  {map[string]any{"to": "cooking", "version": 2}, 400, ""},
		"missing version": {map[string]any{"to": "ready"}, 400, ""},
	} {
		res := do(t, h, "POST", move, kds, c.body)
		if res.status != c.status {
			t.Errorf("%s: %d %s", name, res.status, res.body)
			continue
		}
		if c.code != "" {
			coded(res.body)
			if res.json["code"] != c.code {
				t.Errorf("%s: code %v", name, res.json["code"])
			}
		}
	}
	if res := do(t, h, "GET", path+"/"+testsupport.UUID(), kds, nil); res.status != 404 {
		t.Errorf("unknown ticket: %d", res.status)
	}
	if res := do(t, h, "GET", path+"?status=cooking", kds, nil); res.status != 400 {
		t.Errorf("unknown status filter: %d", res.status)
	}
	if res := do(t, h, "GET", path+"?station=Hot%20Line", kds, nil); res.status != 400 {
		t.Errorf("bad station filter: %d", res.status)
	}
}

func TestKitchenTicketWritesDisabled(t *testing.T) {
	h := kitchenRoutes(false)
	kds := signed(t, nestShapedClaims()["kds_device"])
	path := base(venueID) + "/kitchen-tickets"
	if res := do(t, h, "GET", path, kds, nil); res.status != 200 {
		t.Errorf("reads still work: %d", res.status)
	}
	res := do(t, h, "POST", path+"/"+ticketID+"/transitions", kds, map[string]any{"to": "preparing", "version": 1})
	if res.status != 503 || res.json["code"] != "KITCHEN_WRITES_DISABLED" {
		t.Errorf("read-only: %d %s", res.status, res.body)
	}
	kitchenSchema(t, "CodedError")(res.body)
}
