package contract

// The canonical order API (contracts/openapi/servvia-orders.yaml) is new
// Servvia-native behaviour; its successful responses are validated against
// the contract on real PostgreSQL in tests/integration. Here: every request
// the contract refuses before persistence, with no repository behind it.

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"servvia/services/core-platform/internal/health"
	"servvia/services/core-platform/internal/identity"
	"servvia/services/core-platform/internal/menu"
	"servvia/services/core-platform/internal/orders"
	"servvia/services/core-platform/internal/orders/ordersapi"
	"servvia/services/core-platform/internal/pricing"
	"servvia/services/core-platform/internal/ratelimit"
	"servvia/services/core-platform/internal/server"
	"servvia/services/core-platform/internal/venues"
	"servvia/services/core-platform/tests/testsupport"
)

// unreachable fails the test if a refused request gets to persistence.
type unreachable struct{ t *testing.T }

func (u unreachable) fail() {
	u.t.Helper()
	u.t.Error("a refused request reached the order repository")
}
func (u unreachable) FindByKey(context.Context, string, string) (orders.Order, bool, error) {
	u.fail()
	return orders.Order{}, false, nil
}
func (u unreachable) Get(context.Context, string, string) (orders.Order, error) {
	u.fail()
	return orders.Order{}, orders.ErrOrderNotFound
}
func (u unreachable) Create(context.Context, orders.NewOrder) (orders.Order, error) {
	u.fail()
	return orders.Order{}, nil
}
func (u unreachable) AddRound(context.Context, orders.NewRound) (orders.Order, error) {
	u.fail()
	return orders.Order{}, nil
}
func (u unreachable) Audit(context.Context, orders.Scope, orders.Actor, string, string, map[string]any) {
}

type noCatalog struct{}

func (noCatalog) Items(context.Context, string, string, []string) (map[string]pricing.CatalogItem, error) {
	return nil, nil
}

func orderRoutes(t *testing.T, writable bool) http.Handler {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	return server.Routes(server.Deps{
		Logger: logger, Health: health.New(okPinger{}, time.Second),
		Menu:     menu.NewHandler(staticStore{}, logger),
		Venues:   venues.NewHandler(venueStore{}, logger),
		Orders:   ordersapi.NewHandler(orders.NewService(unreachable{t}, noCatalog{}, writable), venueStore{}, logger),
		Verifier: identity.NewVerifier(secret), TabletDevices: activeDevices{}, VenueGrants: grantAll{},
		RateLimiter: ratelimit.New(admit, 0, logger),
	})
}

func orderBody(source, mode string, extra map[string]any) map[string]any {
	b := map[string]any{"source": source, "serviceMode": mode, "idempotencyKey": testsupport.UUID(),
		"items": []map[string]any{{"menuItemId": testsupport.UUID(), "quantity": 1}}}
	for k, v := range extra {
		b[k] = v
	}
	return b
}

func TestOrderAuthorization(t *testing.T) {
	h := orderRoutes(t, true)
	claims := nestShapedClaims()
	nestErr := testsupport.Schema(t, "openapi/servvia-orders.yaml", "/components/schemas/NestError")
	create := base(venueID) + "/orders"
	for name, c := range map[string]struct {
		token  string
		path   string
		body   map[string]any
		status int
		msg    string
	}{
		// Nest's CSRF middleware runs before authentication on unsafe methods.
		"no token (kiosk)":     {"", create, orderBody("kiosk", "takeaway", nil), 403, "Invalid or missing CSRF token"},
		"KDS device":           {signed(t, claims["kds_device"]), create, orderBody("pos_terminal", "takeaway", nil), 403, "Insufficient permissions"},
		"customer-mode tablet": {signed(t, claims["tablet_device"]), create, orderBody("order_tablet", "takeaway", nil), 403, "Insufficient permissions"},
		"kitchen staff":        {staffWithRole(t, "kitchen"), create, orderBody("pos_terminal", "takeaway", nil), 403, "Insufficient permissions"},
		"viewer staff":         {staffWithRole(t, "viewer"), create, orderBody("pos_terminal", "takeaway", nil), 403, "Insufficient permissions"},
		"tablet, another venue": {signed(t, claims["tablet_staff"]), base(otherVenue) + "/orders",
			orderBody("waiter_tablet", "takeaway", nil), 403, "This device is not authorized for the requested venue"},
		"staff, another org's venue": {signed(t, claims["staff"]), base(otherVenue) + "/orders",
			orderBody("pos_terminal", "takeaway", nil), 404, "Venue not found"},
		// The declared source must fit the caller.
		"staff login as a tablet": {staffWithRole(t, "cashier"), create, orderBody("waiter_tablet", "takeaway", nil), 403,
			"This order source is not permitted for this caller"},
		"tablet as the POS terminal": {signed(t, claims["tablet_staff"]), create, orderBody("pos_terminal", "takeaway", nil), 403,
			"This order source is not permitted for this caller"},
		"staff claiming kiosk": {staffWithRole(t, "manager"), create, orderBody("kiosk", "takeaway", nil), 403,
			"This order source is not permitted for this caller"},
		"KDS reading an order": {signed(t, claims["kds_device"]), create + "/ORD-1", nil, 403, "Insufficient permissions"},
	} {
		method := "POST"
		if c.body == nil {
			method = "GET"
		}
		res := do(t, h, method, c.path, c.token, c.body)
		if res.status != c.status || res.json["message"] != c.msg {
			t.Errorf("%s: %d %s", name, res.status, res.body)
			continue
		}
		testsupport.Validate(t, nestErr, res.body)
	}
}

func TestOrderRequestValidation(t *testing.T) {
	h := orderRoutes(t, true)
	staff := staffWithRole(t, "cashier")
	create := base(venueID) + "/orders"
	schema := testsupport.Schema(t, "openapi/servvia-orders.yaml", "/components/schemas/NestError")
	for name, c := range map[string]struct {
		body any
		msg  string
	}{
		"not JSON":             {"items=1", "Request body must be a JSON object"},
		"missing product":      {orderBody("pos_terminal", "takeaway", map[string]any{"items": []map[string]any{{"quantity": 1}}}), "items.0.menuItemId is required"},
		"quantity 0":           {orderBody("pos_terminal", "takeaway", map[string]any{"items": []map[string]any{{"menuItemId": "x", "quantity": 0}}}), "items.0.quantity must be a positive integer"},
		"quantity 1.5":         {`{"source":"pos_terminal","serviceMode":"takeaway","idempotencyKey":"` + testsupport.UUID() + `","items":[{"menuItemId":"x","quantity":1.5}]}`, "items.0.quantity has the wrong type"},
		"negative expected":    {orderBody("pos_terminal", "takeaway", map[string]any{"items": []map[string]any{{"menuItemId": "x", "quantity": 1, "expectedUnitPriceCents": -1}}}), "items.0.expectedUnitPriceCents must not be negative"},
		"short key":            {orderBody("pos_terminal", "takeaway", map[string]any{"idempotencyKey": "short"}), "idempotencyKey must be a string of 16 to 255 characters"},
		"legacy source":        {orderBody("staff", "takeaway", nil), "source must be one of pos_terminal, waiter_tablet, order_tablet, kiosk, customer_web"},
		"dine-in, no session":  {orderBody("pos_terminal", "dine_in", nil), "A dine-in order requires tableSessionId"},
		"takeaway, a session":  {orderBody("pos_terminal", "takeaway", map[string]any{"tableSessionId": testsupport.UUID()}), "A takeaway order must not specify a table session"},
		"unknown service mode": {orderBody("pos_terminal", "delivery", nil), "serviceMode must be one of dine_in, takeaway"},
		"round, short key":     {map[string]any{"idempotencyKey": "short", "items": []map[string]any{{"menuItemId": "x", "quantity": 1}}}, "idempotencyKey must be a string of 16 to 255 characters"},
	} {
		path := create
		if name == "round, short key" {
			path = create + "/ORD-1/rounds"
		}
		res := do(t, h, "POST", path, staff, c.body)
		if res.status != 400 || res.json["message"] != c.msg {
			t.Errorf("%s: %d %s", name, res.status, res.body)
			continue
		}
		testsupport.Validate(t, schema, res.body)
	}

	// Past CSRF, a missing token is Passport's 401.
	req := httptest.NewRequest("POST", create, strings.NewReader(`{}`))
	req.Header.Set("Cookie", "csrf_token=abc")
	req.Header.Set("X-CSRF-Token", "abc")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != 401 || rec.Body.String() != `{"message":"Unauthorized","statusCode":401}` {
		t.Errorf("no token past CSRF: %d %s", rec.Code, rec.Body)
	}

	res := do(t, orderRoutes(t, false), "POST", create, staff, orderBody("pos_terminal", "takeaway", nil))
	if res.status != 503 || res.json["code"] != "ORDER_WRITES_DISABLED" {
		t.Errorf("read-only instance: %d %s", res.status, res.body)
	}
	testsupport.Validate(t, testsupport.Schema(t, "openapi/servvia-orders.yaml", "/components/schemas/CodedError"), res.body)
}
