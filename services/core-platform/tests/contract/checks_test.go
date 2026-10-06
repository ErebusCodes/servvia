package contract

// Checks are new Servvia-native behaviour, tested against the written
// contract (contracts/openapi/checks.yaml). These tests cover authorization
// and request validation, which refuse before any repository use; full
// response shapes and every database guarantee are tested against
// PostgreSQL in tests/integration.

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"testing"
	"time"

	"servvia/services/core-platform/internal/checks"
	"servvia/services/core-platform/internal/checks/checksapi"
	"servvia/services/core-platform/internal/health"
	"servvia/services/core-platform/internal/identity"
	"servvia/services/core-platform/internal/menu"
	"servvia/services/core-platform/internal/ratelimit"
	"servvia/services/core-platform/internal/server"
	"servvia/services/core-platform/internal/venues"
	"servvia/services/core-platform/tests/testsupport"
)

// noChecks answers every read with "not found" and refuses writes: an
// authorized request reaches it, a refused one never does.
type noChecks struct{}

func (noChecks) FindByKey(context.Context, string, string) (checks.Check, string, bool, error) {
	return checks.Check{}, "", false, nil
}
func (noChecks) Get(context.Context, string, string) (checks.Check, error) {
	return checks.Check{}, checks.ErrCheckNotFound
}
func (noChecks) List(context.Context, string, checks.Filter) ([]checks.Check, error) { return nil, nil }
func (noChecks) Create(context.Context, checks.NewCheck) (checks.Check, error) {
	return checks.Check{}, checks.ErrNothingToBill
}
func (noChecks) Void(context.Context, checks.VoidCommand) (checks.Check, bool, error) {
	return checks.Check{}, false, checks.ErrCheckNotFound
}
func (noChecks) Audit(context.Context, checks.Scope, checks.Actor, string, string, map[string]any) {}

func checkRoutes(writable bool) http.Handler {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	return server.Routes(server.Deps{
		Logger: logger, Health: health.New(okPinger{}, time.Second),
		Menu:     menu.NewHandler(staticStore{}, logger),
		Venues:   venues.NewHandler(venueStore{}, logger),
		Checks:   checksapi.NewHandler(checks.NewService(noChecks{}, writable), venueStore{}, logger),
		Verifier: identity.NewVerifier(secret), TabletDevices: activeDevices{}, VenueGrants: grantAll{}, StaffSessions: activeStaff,
		RateLimiter: ratelimit.New(admit, 0, logger),
	})
}

func checkSchema(t *testing.T, name string) func([]byte) {
	s := testsupport.Schema(t, "openapi/checks.yaml", "/components/schemas/"+name)
	return func(b []byte) { t.Helper(); testsupport.Validate(t, s, b) }
}

func TestCheckAuthorization(t *testing.T) {
	h := checkRoutes(true)
	claims := nestShapedClaims()
	nestErr, coded := checkSchema(t, "NestError"), checkSchema(t, "CodedError")
	create := base(venueID) + "/checks"
	body := func() map[string]any {
		return map[string]any{"orderIds": []string{"ORD-1"}, "idempotencyKey": testsupport.UUID()}
	}
	void := create + "/" + testsupport.UUID() + "/void"
	voidBody := map[string]any{"version": 1, "reason": "wrong table"}

	for name, c := range map[string]struct {
		token, method, path string
		body                any
		status              int
	}{
		// Allowed callers reach the service (here: nothing to bill, 409).
		"owner session":           {signed(t, claims["staff"]), "POST", create, body(), 409},
		"admin":                   {staffWithRole(t, "admin"), "POST", create, body(), 409},
		"manager":                 {staffWithRole(t, "manager"), "POST", create, body(), 409},
		"cashier":                 {staffWithRole(t, "cashier"), "POST", create, body(), 409},
		"tablet elevated (staff)": {signed(t, claims["tablet_staff"]), "POST", create, body(), 409},
		"cashier lists":           {staffWithRole(t, "cashier"), "GET", create, nil, 200},
		// Never a kitchen or device identity, never without a financial role.
		"KDS device creates":         {signed(t, claims["kds_device"]), "POST", create, body(), 403},
		"KDS device reads":           {signed(t, claims["kds_device"]), "GET", create, nil, 403},
		"KDS device voids":           {signed(t, claims["kds_device"]), "POST", void, voidBody, 403},
		"kitchen staff creates":      {staffWithRole(t, "kitchen"), "POST", create, body(), 403},
		"kitchen staff reads":        {staffWithRole(t, "kitchen"), "GET", create, nil, 403},
		"viewer creates":             {staffWithRole(t, "viewer"), "POST", create, body(), 403},
		"customer-mode tablet":       {signed(t, claims["tablet_device"]), "POST", create, body(), 403},
		"no token":                   {"", "GET", create, nil, 401},
		"cashier voids":              {staffWithRole(t, "cashier"), "POST", void, voidBody, 403},
		"tablet staff voids":         {signed(t, claims["tablet_staff"]), "POST", void, voidBody, 403},
		"manager voids":              {staffWithRole(t, "manager"), "POST", void, voidBody, 404},
		"tablet manager voids":       {signed(t, claims["tablet_manager"]), "POST", void, voidBody, 404},
		"tablet, another venue":      {signed(t, claims["tablet_staff"]), "POST", base(otherVenue) + "/checks", body(), 403},
		"staff, another org's venue": {signed(t, claims["staff"]), "POST", base(otherVenue) + "/checks", body(), 404},
	} {
		res := do(t, h, c.method, c.path, c.token, c.body)
		if res.status != c.status {
			t.Errorf("%s: %d %s", name, res.status, res.body)
			continue
		}
		switch {
		case c.status == 409:
			coded(res.body)
			if res.json["code"] != "NOTHING_TO_BILL" {
				t.Errorf("%s: %s", name, res.body)
			}
		case c.status != 200:
			nestErr(res.body)
		}
	}
}

func TestCheckRequestValidation(t *testing.T) {
	h := checkRoutes(true)
	cashier := staffWithRole(t, "cashier")
	nestErr := checkSchema(t, "NestError")
	create := base(venueID) + "/checks"
	key := testsupport.UUID()
	for name, c := range map[string]struct {
		body any
		msg  string
	}{
		"not an object": {"[1]", "Request body must be a JSON object"},
		"amount given":  {map[string]any{"orderIds": "ORD-1", "idempotencyKey": key}, "orderIds has the wrong type"},
		"short key":     {map[string]any{"orderIds": []string{"ORD-1"}, "idempotencyKey": "short"}, "idempotencyKey must be a string of 16 to 255 characters"},
		"neither":       {map[string]any{"idempotencyKey": key}, "Specify tableSessionId or orderIds"},
		"both":          {map[string]any{"tableSessionId": "s", "orderIds": []string{"ORD-1"}, "idempotencyKey": key}, "Specify either tableSessionId or orderIds, not both"},
		"bad status":    {nil, "status must be one of open, voided, settled"},
	} {
		method, path := "POST", create
		if c.body == nil {
			method, path = "GET", create+"?status=paid"
		}
		res := do(t, h, method, path, cashier, c.body)
		if res.status != 400 || res.json["message"] != c.msg {
			t.Errorf("%s: %d %s", name, res.status, res.body)
			continue
		}
		nestErr(res.body)
	}
	// Client money is not part of the contract: extra fields are ignored,
	// never used (the server decides every amount; see integration tests).
	manager := staffWithRole(t, "manager")
	if res := do(t, h, "POST", create+"/x/void", manager, map[string]any{"reason": "x"}); res.status != 400 {
		t.Errorf("void without version: %d", res.status)
	}
	if res := do(t, h, "POST", create+"/x/void", manager, map[string]any{"version": 1, "reason": ""}); res.status != 400 {
		t.Errorf("void without reason: %d", res.status)
	}
}

func TestCheckWritesDisabled(t *testing.T) {
	h := checkRoutes(false)
	cashier := staffWithRole(t, "cashier")
	res := do(t, h, "POST", base(venueID)+"/checks", cashier, map[string]any{"orderIds": []string{"ORD-1"}, "idempotencyKey": testsupport.UUID()})
	if res.status != 503 || res.json["code"] != "CHECK_WRITES_DISABLED" {
		t.Errorf("read-only create: %d %s", res.status, res.body)
	}
	checkSchema(t, "CodedError")(res.body)
	if res := do(t, h, "GET", base(venueID)+"/checks", cashier, nil); res.status != 200 {
		t.Errorf("reads still work: %d", res.status)
	}
}
