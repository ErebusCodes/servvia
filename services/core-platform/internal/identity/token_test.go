package identity

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

const secret = "0123456789abcdef0123456789abcdef"

func sign(t *testing.T, method jwt.SigningMethod, key any, claims jwt.MapClaims) string {
	t.Helper()
	token, err := jwt.NewWithClaims(method, claims).SignedString(key)
	if err != nil {
		t.Fatal(err)
	}
	return token
}

func staffClaims() jwt.MapClaims {
	now := time.Now()
	return jwt.MapClaims{
		"sub": "11111111-1111-4111-8111-111111111111", "email": "owner@example.test",
		"role": "owner", "organizationId": "22222222-2222-4222-8222-222222222222",
		"sid": "44444444-4444-4444-8444-444444444444", "iat": now.Unix(), "exp": now.Add(15 * time.Minute).Unix(),
	}
}

func TestVerifyStaffSession(t *testing.T) {
	p, err := NewVerifier(secret).Verify(sign(t, jwt.SigningMethodHS256, []byte(secret), staffClaims()))
	if err != nil {
		t.Fatal(err)
	}
	if p.Kind != KindStaffSession || p.Kind.DeviceScoped() || p.Role != "owner" || p.VenueID != "" ||
		p.SessionID != "44444444-4444-4444-8444-444444444444" {
		t.Fatalf("unexpected principal %+v", p)
	}
}

func TestVerifyDeviceTokens(t *testing.T) {
	for _, kind := range []Kind{KindKDSDevice, KindTabletDevice, KindTabletStaff, KindTabletManager} {
		c := staffClaims()
		c["kind"], c["venueId"], c["deviceId"] = string(kind), "33333333-3333-4333-8333-333333333333", "dev-1"
		p, err := NewVerifier(secret).Verify(sign(t, jwt.SigningMethodHS256, []byte(secret), c))
		if err != nil {
			t.Fatalf("%s: %v", kind, err)
		}
		if !p.Kind.DeviceScoped() || p.VenueID == "" || p.DeviceID != "dev-1" {
			t.Fatalf("%s: unexpected principal %+v", kind, p)
		}
	}
}

func TestVerifyRejects(t *testing.T) {
	expired := staffClaims()
	expired["exp"] = time.Now().Add(-time.Second).Unix()
	noExp := staffClaims()
	delete(noExp, "exp")

	cases := map[string]string{
		"wrong secret":   sign(t, jwt.SigningMethodHS256, []byte("another-secret-another-secret-00"), staffClaims()),
		"HS512":          sign(t, jwt.SigningMethodHS512, []byte(secret), staffClaims()),
		"alg none":       sign(t, jwt.SigningMethodNone, jwt.UnsafeAllowNoneSignatureType, staffClaims()),
		"expired":        sign(t, jwt.SigningMethodHS256, []byte(secret), expired),
		"no exp":         sign(t, jwt.SigningMethodHS256, []byte(secret), noExp),
		"garbage":        "not.a.token",
		"refresh-shaped": sign(t, jwt.SigningMethodHS256, []byte("refresh-secret-refresh-secret-00"), jwt.MapClaims{"sub": "x", "exp": time.Now().Add(time.Hour).Unix()}),
	}
	for name, token := range cases {
		if _, err := NewVerifier(secret).Verify(token); !errors.Is(err, ErrUnauthorized) {
			t.Errorf("%s: expected ErrUnauthorized, got %v", name, err)
		}
	}
}

func TestVerifyMalformedPayload(t *testing.T) {
	for _, missing := range []string{"sub", "role", "organizationId"} {
		c := staffClaims()
		delete(c, missing)
		if _, err := NewVerifier(secret).Verify(sign(t, jwt.SigningMethodHS256, []byte(secret), c)); !errors.Is(err, ErrMalformedPayload) {
			t.Errorf("missing %s: expected ErrMalformedPayload, got %v", missing, err)
		}
	}
}

func TestBearerTokenMatchesPassport(t *testing.T) {
	for header, want := range map[string]string{
		"Bearer abc":     "abc",
		"bearer abc":     "abc",
		"BEARER   abc  ": "abc",
	} {
		if got, ok := BearerToken(header); !ok || got != want {
			t.Errorf("%q -> %q %v", header, got, ok)
		}
	}
	for _, header := range []string{"", "Bearer", "Basic abc", "abc"} {
		if _, ok := BearerToken(header); ok {
			t.Errorf("%q must not yield a token", header)
		}
	}
}

func TestResolveVenueScope(t *testing.T) {
	staff := Principal{Kind: KindStaffSession}
	if v, err := ResolveVenueScope(staff, "venue-a"); err != nil || v != "venue-a" {
		t.Fatalf("staff: %q %v", v, err)
	}
	if v, err := ResolveVenueScope(staff, ""); err != nil || v != "" {
		t.Fatalf("staff, no venue: %q %v", v, err)
	}
	device := Principal{Kind: KindTabletStaff, VenueID: "venue-a"}
	if v, err := ResolveVenueScope(device, ""); err != nil || v != "venue-a" {
		t.Fatalf("device, no venue: %q %v", v, err)
	}
	if v, err := ResolveVenueScope(device, "venue-a"); err != nil || v != "venue-a" {
		t.Fatalf("device, own venue: %q %v", v, err)
	}
	if _, err := ResolveVenueScope(device, "venue-b"); !errors.Is(err, ErrVenueForbidden) {
		t.Fatalf("device, other venue: %v", err)
	}
}

func TestAuthenticateWritesNestBodies(t *testing.T) {
	v := NewVerifier(secret)
	var got Principal
	h := Authenticate(v)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		got, _ = PrincipalFrom(r.Context())
	}))

	serve := func(auth string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodGet, "/", nil)
		if auth != "" {
			req.Header.Set("Authorization", auth)
		}
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		return rec
	}

	rec := serve("")
	if rec.Code != 401 || rec.Body.String() != `{"message":"Unauthorized","statusCode":401}` {
		t.Fatalf("missing token: %d %s", rec.Code, rec.Body.String())
	}

	c := staffClaims()
	delete(c, "role")
	rec = serve("Bearer " + sign(t, jwt.SigningMethodHS256, []byte(secret), c))
	var body map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &body)
	if rec.Code != 401 || body["message"] != "Malformed token payload" || body["error"] != "Unauthorized" {
		t.Fatalf("malformed: %d %s", rec.Code, rec.Body.String())
	}

	rec = serve("Bearer " + sign(t, jwt.SigningMethodHS256, []byte(secret), staffClaims()))
	if rec.Code != 200 || got.Role != "owner" {
		t.Fatalf("valid: %d %+v", rec.Code, got)
	}
}
