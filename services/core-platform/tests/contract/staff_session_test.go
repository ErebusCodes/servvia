package contract

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"os"
	"regexp"
	"strings"
	"testing"
	"time"

	"servvia/services/core-platform/internal/health"
	"servvia/services/core-platform/internal/identity"
	"servvia/services/core-platform/internal/menu"
	"servvia/services/core-platform/internal/ratelimit"
	"servvia/services/core-platform/internal/server"
	"servvia/services/core-platform/internal/venues"
	"servvia/services/core-platform/internal/workers/workersapi"
)

// Active staff and session revocation (Story 2.5): every authenticated
// route refuses a deactivated staff member or a logged-out session (401)
// before any other guard, and fails closed (500) when either cannot be
// checked.

func staffSessionRoutes(s identity.StaffSessions) http.Handler {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	return server.Routes(server.Deps{
		Logger: logger, Health: health.New(okPinger{}, time.Second),
		Menu:     menu.NewHandler(staticStore{}, logger),
		Venues:   venues.NewHandler(venueStore{}, logger),
		Verifier: identity.NewVerifier(secret), TabletDevices: activeDevices{}, VenueGrants: grantAll{}, StaffSessions: s,
		RateLimiter: ratelimit.New(admit, 0, logger),
		// No pool: every request here is refused before the handler runs.
		Workers: workersapi.NewHandler(nil, logger),
	})
}

// authenticatedRoutes is every venue-scoped staff route plus the worker
// backlog, the one authenticated route outside /api/venues/.
var authenticatedRoutes = append([]struct{ method, path string }{{"GET", "/api/admin/workers"}},
	venueScopedStaffRoutes...)

func TestAuthenticatedRoutesRefuseDeactivatedStaffAndLoggedOutSessions(t *testing.T) {
	noSID := nestShapedClaims()["staff"]
	delete(noSID, "sid")
	for name, c := range map[string]struct {
		store staffSessionStub
		token string
	}{
		"deactivated staff":       {staffSessionStub{active: false}, staffWithRole(t, "owner")},
		"logged-out session":      {staffSessionStub{active: true, revoked: true}, staffWithRole(t, "owner")},
		"session without a sid":   {staffSessionStub{active: true}, signed(t, noSID)},
		"deactivated tablet user": {staffSessionStub{active: false}, signed(t, nestShapedClaims()["tablet_manager"])},
	} {
		h := staffSessionRoutes(staffSessionsOf(c.store))
		for _, r := range authenticatedRoutes {
			got := do(t, h, r.method, concrete(r.path), c.token, map[string]any{})
			if got.status != http.StatusUnauthorized || got.json["message"] != identity.StaffSessionEndedMessage {
				t.Errorf("%s: %s %s: got %d %s, want 401", name, r.method, r.path, got.status, got.body)
			}
		}
	}
}

func TestAuthenticatedRoutesFailClosedWhenStaffCannotBeChecked(t *testing.T) {
	h := staffSessionRoutes(staffSessionsOf(staffSessionStub{active: true, err: errors.New("connection refused")}))
	owner := staffWithRole(t, "owner")
	for _, r := range authenticatedRoutes {
		got := do(t, h, r.method, concrete(r.path), owner, map[string]any{})
		if got.status != http.StatusInternalServerError || strings.Contains(string(got.body), "connection refused") {
			t.Errorf("%s %s: got %d %s, want 500 without the cause", r.method, r.path, got.status, got.body)
		}
	}
}

// unexpectedStaffCheck fails the test when a staff store is consulted.
type unexpectedStaffCheck struct{ t *testing.T }

func (u unexpectedStaffCheck) StaffActive(context.Context, string, string) (bool, error) {
	u.t.Error("staff status checked for a device")
	return false, nil
}

func (u unexpectedStaffCheck) SessionLive(context.Context, string, string) (bool, error) {
	u.t.Error("session checked for a device")
	return false, nil
}

// A KDS device is not staff: no staff check consults the stores.
func TestStaffSessionCheckLeavesDevicesAlone(t *testing.T) {
	u := unexpectedStaffCheck{t}
	h := staffSessionRoutes(identity.StaffSessions{Staff: u, Sessions: u})
	kds := signed(t, nestShapedClaims()["kds_device"])
	got := do(t, h, http.MethodGet, "/api/venues/"+venueID+"/kitchen-tickets", kds, nil)
	if got.status == http.StatusUnauthorized {
		t.Errorf("KDS device: got %d %s", got.status, got.body)
	}
}

// Every Authenticate in server.go is directly followed by the staff check,
// so a new route cannot skip it.
func TestEveryAuthenticatedRouteRechecksStaff(t *testing.T) {
	src, err := os.ReadFile("../../internal/server/server.go")
	if err != nil {
		t.Fatal(err)
	}
	all := regexp.MustCompile(`identity\.Authenticate\(`).FindAllIndex(src, -1)
	checked := regexp.MustCompile(`identity\.Authenticate\(d\.Verifier\),\s*activeStaff,`).FindAllIndex(src, -1)
	if len(all) == 0 || len(all) != len(checked) {
		t.Errorf("server.go authenticates %d times, re-checks staff %d times", len(all), len(checked))
	}
}
