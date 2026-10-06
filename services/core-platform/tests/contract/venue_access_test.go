package contract

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"os"
	"regexp"
	"sort"
	"strings"
	"testing"
	"time"

	"servvia/services/core-platform/internal/health"
	"servvia/services/core-platform/internal/identity"
	"servvia/services/core-platform/internal/menu"
	"servvia/services/core-platform/internal/ratelimit"
	"servvia/services/core-platform/internal/server"
	"servvia/services/core-platform/internal/venues"
)

// Staff venue access (PRD section 16 item 3; MVP 9.6): every venue-scoped
// staff route refuses a staff member without a VenueAccess grant (403)
// before any domain work, and fails closed (500) when the grant cannot be
// checked. The routes here are listed explicitly; the completeness test
// below fails when a venue-scoped route is registered without being listed.

type denyGrants struct{}

func (denyGrants) VenueAccess(context.Context, string, string, string) (identity.VenueAccessDecision, error) {
	return identity.VenueAccessNotGranted, nil
}

type brokenGrants struct{}

func (brokenGrants) VenueAccess(context.Context, string, string, string) (identity.VenueAccessDecision, error) {
	return identity.VenueNotInOrganization, errors.New("connection refused")
}

// venueScopedStaffRoutes is every route under /api/venues/ that a staff
// principal can call. The handlers are nil: the guard must refuse first.
var venueScopedStaffRoutes = []struct{ method, path string }{
	{"GET", "/api/venues/{id}/tax-config"},
	{"GET", "/api/venues/{venueId}/table-sessions"},
	{"GET", "/api/venues/{venueId}/table-sessions/{sessionId}"},
	{"PATCH", "/api/venues/{venueId}/table-sessions/{sessionId}"},
	{"POST", "/api/venues/{venueId}/table-sessions/{sessionId}/close"},
	{"POST", "/api/venues/{venueId}/table-sessions/{sessionId}/cancel"},
	{"POST", "/api/venues/{venueId}/tables/{tableId}/sessions"},
	{"GET", "/api/venues/{venueId}/tables/{tableId}/active-session"},
	{"POST", "/api/venues/{venueId}/orders"},
	{"GET", "/api/venues/{venueId}/orders/{orderId}"},
	{"POST", "/api/venues/{venueId}/orders/{orderId}/rounds"},
	{"GET", "/api/venues/{venueId}/kitchen-tickets"},
	{"GET", "/api/venues/{venueId}/kitchen-tickets/{ticketId}"},
	{"POST", "/api/venues/{venueId}/kitchen-tickets/{ticketId}/transitions"},
	// Financial routes: checks, payments, shifts, refunds.
	{"POST", "/api/venues/{venueId}/checks"},
	{"GET", "/api/venues/{venueId}/checks"},
	{"GET", "/api/venues/{venueId}/checks/{checkId}"},
	{"POST", "/api/venues/{venueId}/checks/{checkId}/void"},
	{"POST", "/api/venues/{venueId}/checks/{checkId}/payments"},
	{"GET", "/api/venues/{venueId}/checks/{checkId}/payments"},
	{"GET", "/api/venues/{venueId}/payments/{paymentId}"},
	{"POST", "/api/venues/{venueId}/shifts"},
	{"GET", "/api/venues/{venueId}/shifts"},
	{"GET", "/api/venues/{venueId}/shifts/{shiftId}"},
	{"POST", "/api/venues/{venueId}/shifts/{shiftId}/close"},
	{"POST", "/api/venues/{venueId}/payments/{paymentId}/refunds"},
	{"GET", "/api/venues/{venueId}/payments/{paymentId}/refunds"},
	{"GET", "/api/venues/{venueId}/refunds/{refundId}"},
	// Devices, terminals and promotions.
	{"POST", "/api/venues/{venueId}/devices"},
	{"GET", "/api/venues/{venueId}/devices"},
	{"GET", "/api/venues/{venueId}/devices/{deviceId}"},
	{"POST", "/api/venues/{venueId}/devices/{deviceId}/rotate-credential"},
	{"POST", "/api/venues/{venueId}/devices/{deviceId}/revoke"},
	{"POST", "/api/venues/{venueId}/terminals"},
	{"GET", "/api/venues/{venueId}/terminals"},
	{"GET", "/api/venues/{venueId}/terminals/{terminalId}"},
	{"POST", "/api/venues/{venueId}/terminals/{terminalId}/disable"},
	{"POST", "/api/venues/{venueId}/terminals/{terminalId}/bind-device"},
	{"POST", "/api/venues/{venueId}/terminals/{terminalId}/unbind-device"},
	{"POST", "/api/venues/{venueId}/promotions"},
	{"GET", "/api/venues/{venueId}/promotions"},
	{"GET", "/api/venues/{venueId}/promotions/{promotionId}"},
	{"PATCH", "/api/venues/{venueId}/promotions/{promotionId}"},
	{"POST", "/api/venues/{venueId}/promotions/{promotionId}/activate"},
	{"POST", "/api/venues/{venueId}/promotions/{promotionId}/deactivate"},
}

func venueAccessRoutes(grants identity.VenueGrants) http.Handler {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	return server.Routes(server.Deps{
		Logger: logger, Health: health.New(okPinger{}, time.Second),
		Menu:     menu.NewHandler(staticStore{}, logger),
		Venues:   venues.NewHandler(venueStore{}, logger),
		Verifier: identity.NewVerifier(secret), TabletDevices: activeDevices{}, VenueGrants: grants, StaffSessions: activeStaff,
		RateLimiter: ratelimit.New(admit, 0, logger),
	})
}

var pathParam = regexp.MustCompile(`\{[^}]+\}`)

func concrete(path string) string {
	return pathParam.ReplaceAllString(path, "00000000-0000-4000-8000-000000000009")
}

func TestVenueScopedStaffRoutesRefuseStaffWithoutGrant(t *testing.T) {
	h := venueAccessRoutes(denyGrants{})
	owner := staffWithRole(t, "owner") // passes every role guard, so only venue access can refuse
	for _, r := range venueScopedStaffRoutes {
		got := do(t, h, r.method, concrete(r.path), owner, map[string]any{})
		if got.status != http.StatusForbidden || got.json["message"] != identity.VenueAccessDeniedMessage {
			t.Errorf("%s %s: got %d %s, want 403 venue access refusal", r.method, r.path, got.status, got.body)
		}
	}
}

func TestVenueScopedStaffRoutesFailClosedWhenGrantCannotBeChecked(t *testing.T) {
	h := venueAccessRoutes(brokenGrants{})
	owner := staffWithRole(t, "owner")
	for _, r := range venueScopedStaffRoutes {
		got := do(t, h, r.method, concrete(r.path), owner, map[string]any{})
		if got.status != http.StatusInternalServerError || strings.Contains(string(got.body), "connection refused") {
			t.Errorf("%s %s: got %d %s, want 500 without the cause", r.method, r.path, got.status, got.body)
		}
	}
}

// Every route registered under /api/venues/ (except the public channel menu
// and the device-authenticated payment adapter, which are not staff routes)
// must be in venueScopedStaffRoutes, so a new route cannot skip the check.
func TestVenueScopedStaffRouteListIsComplete(t *testing.T) {
	src, err := os.ReadFile("../../internal/server/server.go")
	if err != nil {
		t.Fatal(err)
	}
	registered := regexp.MustCompile(`rt\.Nest\(http\.Method(\w+),\s*"(/api/venues/[^"]+)"`).FindAllStringSubmatch(string(src), -1)
	listed := map[string]bool{}
	for _, r := range venueScopedStaffRoutes {
		listed[r.method+" "+r.path] = true
	}
	var missing []string
	for _, m := range registered {
		key := strings.ToUpper(m[1]) + " " + m[2]
		if !listed[key] {
			missing = append(missing, key)
		}
	}
	sort.Strings(missing)
	if len(registered) == 0 || len(missing) > 0 {
		t.Errorf("registered %d venue routes; not covered by the venue access test: %v", len(registered), missing)
	}
	if len(registered) != len(venueScopedStaffRoutes) {
		t.Errorf("registered %d venue routes, listed %d", len(registered), len(venueScopedStaffRoutes))
	}
}
