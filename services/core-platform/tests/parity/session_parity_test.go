package parity

import (
	"encoding/json"
	"net/http"
	"testing"

	"servvia/services/core-platform/tests/testsupport"
)

// TestStaffSessionParity drives one staff member's sessions through the live
// Nest API (sign-in, logout, role change, venue grant and revocation,
// deactivation, credential reset) and checks after each step that Go Core,
// reading the same StaffSession, Staff and VenueAccess rows, answers a
// request carrying the same token exactly as Nest does (Stories 2.2, 2.8,
// 2.10 and 8.1). Nest limits sign-in to 10 per 15 minutes per address; this
// test signs in five times and reuses the suite's owner token.
func TestStaffSessionParity(t *testing.T) {
	e := loadEnv(t)
	dbURL := testsupport.DisposableDatabaseURL(t)
	goURL := goServer(t, dbURL, e.secret).URL
	owner := nestTokens(t, e).staff

	email := "parity-" + testsupport.UUID()[:8] + "@example.com"
	const password = "parity session password 0123"
	created := call(t, http.MethodPost, e.nest+"/api/admin/staff", owner,
		map[string]any{"name": "Parity Manager", "email": email, "role": "manager", "venueIds": []string{e.venue}})
	if created.status != http.StatusCreated {
		t.Fatalf("create staff: %d %s", created.status, created.body)
	}
	var account struct {
		Staff struct {
			ID string `json:"id"`
		} `json:"staff"`
		CredentialSetup struct {
			Code string `json:"code"`
		} `json:"credentialSetup"`
	}
	if err := json.Unmarshal(created.body, &account); err != nil {
		t.Fatalf("create staff: %v", err)
	}
	setup := map[string]string{"code": account.CredentialSetup.Code, "password": password}
	if r := call(t, http.MethodPost, e.nest+"/api/auth/credential-setup", "", setup); r.status != http.StatusNoContent {
		t.Fatalf("credential setup: %d %s", r.status, r.body)
	}
	if r := call(t, http.MethodPost, e.nest+"/api/auth/credential-setup", "", setup); r.status != http.StatusUnauthorized {
		t.Errorf("a used setup code was accepted again: %d", r.status)
	}

	signIn := func(want int) string {
		t.Helper()
		r := call(t, http.MethodPost, e.nest+"/api/auth/login", "", map[string]string{"email": email, "password": password})
		if r.status != want {
			t.Fatalf("sign-in: %d, want %d: %s", r.status, want, r.body)
		}
		if want != http.StatusOK {
			return ""
		}
		return field(t, r, "accessToken")
	}
	path := "/api/venues/" + e.venue + "/tax-config"
	both := func(step, token string, want int) {
		t.Helper()
		nest, goRes := call(t, http.MethodGet, e.nest+path, token, nil), call(t, http.MethodGet, goURL+path, token, nil)
		compare(t, step, nest, goRes)
		if nest.status != want || goRes.status != want {
			t.Errorf("%s: nest=%d go=%d, want %d", step, nest.status, goRes.status, want)
		}
	}
	administer := func(method, suffix string, body any, want int) {
		t.Helper()
		r := call(t, method, e.nest+"/api/admin/staff/"+account.Staff.ID+suffix, owner, body)
		if r.status != want {
			t.Fatalf("%s %s: %d %s", method, suffix, r.status, r.body)
		}
	}

	session := signIn(http.StatusOK)
	both("live session", session, http.StatusOK)
	if r := call(t, http.MethodPost, e.nest+"/api/auth/logout", session, map[string]string{}); r.status != http.StatusNoContent {
		t.Fatalf("logout: %d %s", r.status, r.body)
	}
	both("after logout", session, http.StatusUnauthorized)

	session = signIn(http.StatusOK)
	administer(http.MethodPatch, "", map[string]string{"role": "viewer"}, http.StatusOK)
	both("after a role change", session, http.StatusUnauthorized)

	session = signIn(http.StatusOK)
	both("session under the new role", session, http.StatusOK)
	administer(http.MethodDelete, "/venues/"+e.venue, nil, http.StatusOK)
	both("after the venue grant is revoked", session, http.StatusForbidden)
	administer(http.MethodPut, "/venues/"+e.venue, nil, http.StatusOK)
	both("after the venue is granted again", session, http.StatusOK)

	administer(http.MethodPost, "/deactivate", nil, http.StatusOK)
	both("after deactivation", session, http.StatusUnauthorized)
	signIn(http.StatusUnauthorized)
	administer(http.MethodPost, "/activate", nil, http.StatusOK)
	both("a deactivated session stays ended after reactivation", session, http.StatusUnauthorized)

	session = signIn(http.StatusOK)
	both("session after reactivation", session, http.StatusOK)
	administer(http.MethodPost, "/credential-reset", nil, http.StatusOK)
	both("after a credential reset", session, http.StatusUnauthorized)
}
