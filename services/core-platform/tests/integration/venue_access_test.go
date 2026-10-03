package integration

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"

	"servvia/services/core-platform/internal/health"
	"servvia/services/core-platform/internal/identity"
	"servvia/services/core-platform/internal/menu"
	"servvia/services/core-platform/internal/platform/postgres"
	"servvia/services/core-platform/internal/ratelimit"
	"servvia/services/core-platform/internal/realtime/realtimeapi"
	"servvia/services/core-platform/internal/server"
	"servvia/services/core-platform/internal/venues"
	"servvia/services/core-platform/tests/testsupport"
)

// Staff venue access against PostgreSQL (PRD section 16 item 3; MVP 9.6): a
// staff member granted one venue of their organization is refused another
// venue of the same organization on REST (403, every financial route) and
// on realtime (4403), while the granted venue is admitted and venues of
// other organizations keep their 404 answer.
func TestStaffVenueAccessAgainstPostgres(t *testing.T) {
	h := realtimeSetup(t, fastConfig, 64)
	ctx := context.Background()
	pool, err := postgres.NewPool(ctx, postgres.Options{URL: testsupport.DisposableDatabaseURL(t), MaxConns: 4})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)

	limited := testsupport.UUID()
	if _, err := pool.Exec(ctx, `INSERT INTO "Staff"(id,"organizationId",email,name,"passwordHash",role,"updatedAt")
		VALUES($1,$2,$1||'@example.test','Limited','x','manager',now())`, limited, h.f.Org); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if _, err := pool.Exec(context.Background(), `DELETE FROM "Staff" WHERE id = $1`, limited); err != nil {
			t.Errorf("cleanup: %v", err)
		}
	})
	// Registered after the staff row, so its cleanup runs first.
	testsupport.GrantVenueAccess(t, ctx, pool, h.f.Owner, []string{limited}, []string{h.f.Venue})
	// A manager passes every financial role guard, so only venue access can refuse.
	token := sign(jwt.MapClaims{"sub": limited, "email": "limited@example.test", "role": "manager", "organizationId": h.f.Org})

	grants := identity.NewPostgresVenueGrants(pool)
	for name, c := range map[string]struct {
		org, venue string
		want       identity.VenueAccessDecision
	}{
		"granted venue":                    {h.f.Org, h.f.Venue, identity.VenueAccessGranted},
		"own-organization venue, no grant": {h.f.Org, h.f.TaxlessVenue, identity.VenueAccessNotGranted},
		"unknown venue":                    {h.f.Org, testsupport.UUID(), identity.VenueNotInOrganization},
		"venue of another organization":    {h.f.OtherOrg, h.f.Venue, identity.VenueNotInOrganization},
	} {
		got, err := grants.VenueAccess(ctx, limited, c.org, c.venue)
		if err != nil || got != c.want {
			t.Errorf("%s: decision %d err %v, want %d", name, got, err, c.want)
		}
	}

	// REST: every financial route refuses the ungranted venue before any
	// domain work (the handlers are not wired; the guard must answer).
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	venueStore := venues.NewPostgresStore(pool)
	routes := server.Routes(server.Deps{
		Logger: logger, Health: health.New(pool, time.Second),
		Menu:     menu.NewHandler(menu.NewPostgresStore(pool), logger),
		Venues:   venues.NewHandler(venueStore, logger),
		Verifier: identity.NewVerifier(rtSecret), TabletDevices: identity.NewPostgresTabletDevices(pool),
		VenueGrants: grants, StaffSessions: admitStaff, RateLimiter: ratelimit.New(admitAll{}, 0, logger),
	})
	id := testsupport.UUID()
	for _, r := range []struct{ method, path string }{
		{"POST", "/checks"}, {"GET", "/checks"}, {"GET", "/checks/" + id}, {"POST", "/checks/" + id + "/void"},
		{"POST", "/checks/" + id + "/payments"}, {"GET", "/checks/" + id + "/payments"}, {"GET", "/payments/" + id},
		{"POST", "/shifts"}, {"GET", "/shifts"}, {"GET", "/shifts/" + id}, {"POST", "/shifts/" + id + "/close"},
		{"POST", "/payments/" + id + "/refunds"}, {"GET", "/payments/" + id + "/refunds"}, {"GET", "/refunds/" + id},
	} {
		req := httptest.NewRequest(r.method, "/api/venues/"+h.f.TaxlessVenue+r.path, strings.NewReader(`{}`))
		req.Header.Set("Authorization", "Bearer "+token)
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		routes.ServeHTTP(rec, req)
		if rec.Code != http.StatusForbidden || !strings.Contains(rec.Body.String(), identity.VenueAccessDeniedMessage) {
			t.Errorf("%s %s on the ungranted venue: %d %s", r.method, r.path, rec.Code, rec.Body.String())
		}
	}

	// Realtime: the ungranted venue is refused with 4403; the granted one is admitted.
	c, m := h.connect(t, token, map[string]any{"type": "subscribe", "venueId": h.f.TaxlessVenue})
	if m.Type != "error" || m.Code != "FORBIDDEN" {
		t.Errorf("ungranted venue subscription: %+v", m)
	}
	if st := closeStatus(c); st != realtimeapi.CloseForbidden {
		t.Errorf("ungranted venue subscription closed with %d", st)
	}
	h.subscribe(t, token, h.f.Venue)
}
