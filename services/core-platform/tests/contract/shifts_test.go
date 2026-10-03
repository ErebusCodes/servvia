package contract

// Shifts are new Servvia-native behaviour, tested against the written
// contract (contracts/openapi/shifts.yaml). These tests cover authorization
// and request validation, which refuse before any repository use; the cash
// and concurrency guarantees are tested against PostgreSQL in
// tests/integration.

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"testing"
	"time"

	"servvia/services/core-platform/internal/health"
	"servvia/services/core-platform/internal/identity"
	"servvia/services/core-platform/internal/menu"
	"servvia/services/core-platform/internal/ratelimit"
	"servvia/services/core-platform/internal/server"
	"servvia/services/core-platform/internal/shifts"
	"servvia/services/core-platform/internal/shifts/shiftsapi"
	"servvia/services/core-platform/internal/venues"
	"servvia/services/core-platform/tests/testsupport"
)

// noShifts: nothing exists and opening reports an open shift, so an
// authorized request gets a coded 409 and a refused one never gets here.
type noShifts struct{}

func (noShifts) FindByKey(context.Context, string, string) (shifts.Shift, bool, error) {
	return shifts.Shift{}, false, nil
}
func (noShifts) Get(context.Context, string, string) (shifts.Shift, error) {
	return shifts.Shift{}, shifts.ErrShiftNotFound
}
func (noShifts) List(context.Context, string, shifts.Filter) ([]shifts.Shift, error) { return nil, nil }
func (noShifts) Open(context.Context, shifts.OpenCommand) (shifts.Shift, error) {
	return shifts.Shift{}, &shifts.AlreadyOpenError{ShiftID: "s"}
}
func (noShifts) Close(context.Context, shifts.CloseCommand) (shifts.Shift, bool, error) {
	return shifts.Shift{}, false, shifts.ErrShiftNotFound
}

func shiftRoutes(writable bool) http.Handler {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	return server.Routes(server.Deps{
		Logger: logger, Health: health.New(okPinger{}, time.Second),
		Menu:     menu.NewHandler(staticStore{}, logger),
		Venues:   venues.NewHandler(venueStore{}, logger),
		Shifts:   shiftsapi.NewHandler(shifts.NewService(noShifts{}, writable), venueStore{}, logger),
		Verifier: identity.NewVerifier(secret), TabletDevices: activeDevices{}, VenueGrants: grantAll{},
		RateLimiter: ratelimit.New(admit, 0, logger),
	})
}

func TestShiftAuthorization(t *testing.T) {
	h := shiftRoutes(true)
	claims := nestShapedClaims()
	nestErr := testsupport.Schema(t, "openapi/shifts.yaml", "/components/schemas/NestError")
	open := base(venueID) + "/shifts"
	openBody := func() map[string]any {
		return map[string]any{"openingFloatCents": 20000, "idempotencyKey": testsupport.UUID()}
	}
	closeShift := open + "/s/close"
	for name, c := range map[string]struct {
		token, method, path string
		body                any
		status              int
	}{
		// Allowed callers reach the service.
		"cashier opens":           {staffWithRole(t, "cashier"), "POST", open, openBody(), 409},
		"manager opens":           {staffWithRole(t, "manager"), "POST", open, openBody(), 409},
		"owner lists":             {signed(t, claims["staff"]), "GET", open, nil, 200},
		"tablet elevated (staff)": {signed(t, claims["tablet_staff"]), "GET", open, nil, 200},
		"cashier closes":          {staffWithRole(t, "cashier"), "POST", closeShift, map[string]any{"version": 1, "countedCashCents": 0}, 404},
		// Never kitchen, a device or a role without financial permission.
		"KDS opens":                  {signed(t, claims["kds_device"]), "POST", open, openBody(), 403},
		"KDS reads":                  {signed(t, claims["kds_device"]), "GET", open, nil, 403},
		"KDS closes":                 {signed(t, claims["kds_device"]), "POST", closeShift, map[string]any{"version": 1, "countedCashCents": 0}, 403},
		"kitchen staff opens":        {staffWithRole(t, "kitchen"), "POST", open, openBody(), 403},
		"viewer reads":               {staffWithRole(t, "viewer"), "GET", open, nil, 403},
		"customer-mode tablet":       {signed(t, claims["tablet_device"]), "POST", open, openBody(), 403},
		"no token":                   {"", "GET", open, nil, 401},
		"staff, another org's venue": {signed(t, claims["staff"]), "GET", base(otherVenue) + "/shifts", nil, 404},
		"tablet, another venue":      {signed(t, claims["tablet_staff"]), "GET", base(otherVenue) + "/shifts", nil, 403},
	} {
		res := do(t, h, c.method, c.path, c.token, c.body)
		if res.status != c.status {
			t.Errorf("%s: %d %s", name, res.status, res.body)
			continue
		}
		switch {
		case c.status == 409:
			testsupport.Validate(t, testsupport.Schema(t, "openapi/shifts.yaml", "/components/schemas/CodedError"), res.body)
		case c.status != 200:
			testsupport.Validate(t, nestErr, res.body)
		}
	}
}

func TestShiftRequestValidation(t *testing.T) {
	h := shiftRoutes(true)
	cashier := staffWithRole(t, "cashier")
	open := base(venueID) + "/shifts"
	for name, c := range map[string]struct {
		method, path string
		body         any
		msg          string
	}{
		"no float":       {"POST", open, map[string]any{"idempotencyKey": testsupport.UUID()}, "openingFloatCents must be an integer from 0 to 2147483647"},
		"negative float": {"POST", open, map[string]any{"openingFloatCents": -1, "idempotencyKey": testsupport.UUID()}, "openingFloatCents must be an integer from 0 to 2147483647"},
		"fractional":     {"POST", open, map[string]any{"openingFloatCents": 1.5, "idempotencyKey": testsupport.UUID()}, "openingFloatCents has the wrong type"},
		"short key":      {"POST", open, map[string]any{"openingFloatCents": 0, "idempotencyKey": "short"}, "idempotencyKey must be a string of 16 to 255 characters"},
		"bad status":     {"GET", open + "?status=settled", nil, "status must be one of open, closed"},
		"no count":       {"POST", open + "/s/close", map[string]any{"version": 1}, "countedCashCents must be an integer from 0 to 2147483647"},
		"no version":     {"POST", open + "/s/close", map[string]any{"countedCashCents": 5}, "version must be a positive integer"},
		"negative count": {"POST", open + "/s/close", map[string]any{"version": 1, "countedCashCents": -5}, "countedCashCents must be an integer from 0 to 2147483647"},
	} {
		res := do(t, h, c.method, c.path, cashier, c.body)
		if res.status != 400 || res.json["message"] != c.msg {
			t.Errorf("%s: %d %s", name, res.status, res.body)
		}
	}
	res := do(t, shiftRoutes(false), "POST", open, cashier, map[string]any{"openingFloatCents": 0, "idempotencyKey": testsupport.UUID()})
	if res.status != 503 || res.json["code"] != "SHIFT_WRITES_DISABLED" {
		t.Errorf("read-only: %d %s", res.status, res.body)
	}
}
