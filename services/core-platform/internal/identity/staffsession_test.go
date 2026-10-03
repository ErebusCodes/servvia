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

type fakeStaffSessions struct {
	active, revoked     bool
	staffErr, revokeErr error
	staffID, sessionID  string
	staffCalls          int
}

func (f *fakeStaffSessions) StaffActive(_ context.Context, staffID string) (bool, error) {
	f.staffCalls++
	f.staffID = staffID
	return f.active, f.staffErr
}

func (f *fakeStaffSessions) SessionRevoked(_ context.Context, sessionID string) (bool, error) {
	f.sessionID = sessionID
	return f.revoked, f.revokeErr
}

func serveActiveStaff(t *testing.T, f *fakeStaffSessions, p Principal) (*httptest.ResponseRecorder, bool, string) {
	t.Helper()
	var logs bytes.Buffer
	reached := false
	mux := http.NewServeMux()
	mux.Handle("GET /api/things", RequireActiveStaff(StaffSessions{Staff: f, Revocations: f}, slog.New(slog.NewJSONHandler(&logs, nil)))(
		http.HandlerFunc(func(http.ResponseWriter, *http.Request) { reached = true })))
	req := httptest.NewRequest(http.MethodGet, "/api/things", nil)
	req = req.WithContext(context.WithValue(req.Context(), principalKey{}, p))
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	return rec, reached, logs.String()
}

var loginSession = Principal{ID: "staff-1", Role: "owner", OrganizationID: "org-1", SessionID: "session-1"}

func TestRequireActiveStaffAdmitsActiveStaff(t *testing.T) {
	for _, p := range []Principal{loginSession, tabletStaff, tabletMgr} {
		f := &fakeStaffSessions{active: true}
		rec, reached, _ := serveActiveStaff(t, f, p)
		if !reached || rec.Code != http.StatusOK {
			t.Errorf("%s: active staff refused: %d", p.Kind, rec.Code)
		}
		if f.staffID != p.ID {
			t.Errorf("%s: checked staff %q, want %q", p.Kind, f.staffID, p.ID)
		}
	}
}

func TestRequireActiveStaffRefusesDeactivatedStaff(t *testing.T) {
	for _, p := range []Principal{loginSession, tabletStaff, tabletMgr} {
		rec, reached, logs := serveActiveStaff(t, &fakeStaffSessions{active: false}, p)
		if reached || rec.Code != http.StatusUnauthorized || !strings.Contains(rec.Body.String(), StaffSessionEndedMessage) {
			t.Errorf("%s: deactivated staff: reached %v, %d %s", p.Kind, reached, rec.Code, rec.Body.String())
		}
		for _, want := range []string{`"event":"staff_session_refused"`, `"staff_id":"` + p.ID + `"`, `"route":"GET /api/things"`} {
			if !strings.Contains(logs, want) {
				t.Errorf("%s: security event lacks %s: %s", p.Kind, want, logs)
			}
		}
	}
}

func TestRequireActiveStaffRefusesLoggedOutSession(t *testing.T) {
	f := &fakeStaffSessions{active: true, revoked: true}
	rec, reached, _ := serveActiveStaff(t, f, loginSession)
	if reached || rec.Code != http.StatusUnauthorized {
		t.Errorf("revoked session: reached %v, %d", reached, rec.Code)
	}
	if f.sessionID != loginSession.SessionID {
		t.Errorf("checked session %q, want %q", f.sessionID, loginSession.SessionID)
	}
}

// A login session without a session ID cannot be revoked, so it is refused.
func TestRequireActiveStaffRefusesSessionWithoutSessionID(t *testing.T) {
	p := loginSession
	p.SessionID = ""
	rec, reached, _ := serveActiveStaff(t, &fakeStaffSessions{active: true}, p)
	if reached || rec.Code != http.StatusUnauthorized {
		t.Errorf("session without sid: reached %v, %d", reached, rec.Code)
	}
}

func TestRequireActiveStaffFailsClosedOnLookupError(t *testing.T) {
	for name, f := range map[string]*fakeStaffSessions{
		"staff lookup":      {active: true, staffErr: errors.New("connection refused")},
		"revocation lookup": {active: true, revokeErr: errors.New("connection refused")},
	} {
		rec, reached, logs := serveActiveStaff(t, f, loginSession)
		if reached || rec.Code != http.StatusInternalServerError || strings.Contains(rec.Body.String(), "connection refused") {
			t.Errorf("%s: reached %v, %d %s; want 500 without the cause", name, reached, rec.Code, rec.Body.String())
		}
		if !strings.Contains(logs, "staff session check failed") {
			t.Errorf("%s: the failure was not logged: %s", name, logs)
		}
	}
}

// Device identities are not staff: no staff lookup, no session check.
func TestRequireActiveStaffLeavesDevicesAlone(t *testing.T) {
	device := Principal{ID: "tablet-device:d-1", Role: "viewer", OrganizationID: "org-1", Kind: KindTabletDevice, VenueID: "venue-9", DeviceID: "d-1"}
	for _, p := range []Principal{kdsDevice, device} {
		f := &fakeStaffSessions{}
		rec, reached, _ := serveActiveStaff(t, f, p)
		if !reached || rec.Code != http.StatusOK || f.staffCalls != 0 {
			t.Errorf("%s: code %d reached %v staff calls %d; want a pass-through", p.Kind, rec.Code, reached, f.staffCalls)
		}
	}
}

func TestRequireActiveStaffWithoutPrincipalIsUnauthorized(t *testing.T) {
	reached := false
	h := RequireActiveStaff(StaffSessions{Staff: &fakeStaffSessions{}, Revocations: &fakeStaffSessions{}}, slog.Default())(
		http.HandlerFunc(func(http.ResponseWriter, *http.Request) { reached = true }))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/", nil))
	if reached || rec.Code != http.StatusUnauthorized {
		t.Errorf("no principal: reached %v, %d", reached, rec.Code)
	}
}
