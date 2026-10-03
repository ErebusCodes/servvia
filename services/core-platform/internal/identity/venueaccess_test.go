package identity

import (
	"bytes"
	"context"
	"errors"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

type recordingGrants struct {
	granted, foreign        bool
	err                     error
	calls                   int
	staffID, orgID, venueID string
}

func (g *recordingGrants) VenueAccess(_ context.Context, staffID, orgID, venueID string) (VenueAccessDecision, error) {
	g.calls++
	g.staffID, g.orgID, g.venueID = staffID, orgID, venueID
	switch {
	case g.foreign:
		return VenueNotInOrganization, g.err
	case g.granted:
		return VenueAccessGranted, g.err
	}
	return VenueAccessNotGranted, g.err
}

// serveVenueRoute runs one request through RequireVenueAccess on a real
// ServeMux pattern (so the path value is set), with p as the principal.
func serveVenueRoute(t *testing.T, grants VenueGrants, p Principal) (*httptest.ResponseRecorder, bool, string) {
	t.Helper()
	var logs bytes.Buffer
	reached := false
	mux := http.NewServeMux()
	mux.Handle("GET /api/venues/{venueId}/things", RequireVenueAccess(grants, "venueId", slog.New(slog.NewJSONHandler(&logs, nil)))(
		http.HandlerFunc(func(http.ResponseWriter, *http.Request) { reached = true })))
	req := httptest.NewRequest(http.MethodGet, "/api/venues/venue-9/things", nil)
	req = req.WithContext(context.WithValue(req.Context(), principalKey{}, p))
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	return rec, reached, logs.String()
}

var (
	ownerSession = Principal{ID: "staff-1", Role: "owner", OrganizationID: "org-1"}
	tabletStaff  = Principal{ID: "staff-2", Role: "cashier", OrganizationID: "org-1", Kind: KindTabletStaff, VenueID: "venue-9", DeviceID: "d-1"}
	tabletMgr    = Principal{ID: "staff-3", Role: "manager", OrganizationID: "org-1", Kind: KindTabletManager, VenueID: "venue-9", DeviceID: "d-1"}
	kdsDevice    = Principal{ID: "kds-device:venue-9", Role: "kitchen", OrganizationID: "org-1", Kind: KindKDSDevice, VenueID: "venue-9"}
)

func TestRequireVenueAccessGrantedStaffProceeds(t *testing.T) {
	for _, p := range []Principal{ownerSession, tabletStaff, tabletMgr} {
		g := &recordingGrants{granted: true}
		rec, reached, _ := serveVenueRoute(t, g, p)
		if !reached || rec.Code != http.StatusOK {
			t.Errorf("%s: granted staff refused: %d", p.Kind, rec.Code)
		}
		if g.staffID != p.ID || g.orgID != p.OrganizationID || g.venueID != "venue-9" {
			t.Errorf("%s: checked (%q, %q, %q), want (%q, %q, venue-9)", p.Kind, g.staffID, g.orgID, g.venueID, p.ID, p.OrganizationID)
		}
	}
}

func TestRequireVenueAccessRefusesStaffWithoutGrant(t *testing.T) {
	// Every staff role and staff kind, owner included: the PRD records no exception.
	for _, p := range []Principal{ownerSession, tabletStaff, tabletMgr} {
		rec, reached, logs := serveVenueRoute(t, &recordingGrants{granted: false}, p)
		if reached {
			t.Fatalf("%s: handler ran without a grant", p.Kind)
		}
		if rec.Code != http.StatusForbidden || !strings.Contains(rec.Body.String(), VenueAccessDeniedMessage) {
			t.Errorf("%s: got %d %s", p.Kind, rec.Code, rec.Body.String())
		}
		for _, want := range []string{`"event":"venue_access_denied"`, `"staff_id":"` + p.ID + `"`, `"venue_id":"venue-9"`,
			`"route":"GET /api/venues/{venueId}/things"`} {
			if !strings.Contains(logs, want) {
				t.Errorf("%s: security event lacks %s: %s", p.Kind, want, logs)
			}
		}
	}
}

func TestRequireVenueAccessFailsClosedOnLookupError(t *testing.T) {
	rec, reached, logs := serveVenueRoute(t, &recordingGrants{err: errors.New("connection refused")}, ownerSession)
	if reached {
		t.Fatal("handler ran although the grant could not be checked")
	}
	if rec.Code != http.StatusInternalServerError || strings.Contains(rec.Body.String(), "connection refused") {
		t.Errorf("got %d %s; want 500 without the cause", rec.Code, rec.Body.String())
	}
	if !strings.Contains(logs, "venue access check failed") {
		t.Errorf("the failure was not logged: %s", logs)
	}
}

func TestRequireVenueAccessLeavesDevicesToTheirPinnedVenue(t *testing.T) {
	g := &recordingGrants{granted: false}
	rec, reached, _ := serveVenueRoute(t, g, kdsDevice)
	if !reached || rec.Code != http.StatusOK || g.calls != 0 {
		t.Errorf("device identity: code %d reached %v grant calls %d; want a pass-through", rec.Code, reached, g.calls)
	}
}

// A venue outside the staff member's organization is not answered here: the
// route's own tenancy check answers 404, as for an unknown venue, so the
// cross-tenant answer is unchanged.
func TestRequireVenueAccessLeavesForeignVenuesToTheTenancyCheck(t *testing.T) {
	rec, reached, logs := serveVenueRoute(t, &recordingGrants{foreign: true}, ownerSession)
	if !reached || rec.Code != http.StatusOK || strings.Contains(logs, "venue_access_denied") {
		t.Errorf("foreign venue: code %d reached %v logs %s; want a pass-through to the tenancy check", rec.Code, reached, logs)
	}
}
