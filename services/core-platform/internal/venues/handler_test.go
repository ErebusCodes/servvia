package venues

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"

	"servvia/services/core-platform/internal/identity"
)

const (
	org      = "org-1"
	venue    = "venue-1"
	other    = "venue-2"
	otherOrg = "venue-of-another-org"
)

type fakeStore struct{ fail bool }

func (f fakeStore) Venue(context.Context, string) (Venue, bool, error) { return Venue{}, false, nil }
func (f fakeStore) Organization(context.Context, string) (Organization, bool, error) {
	return Organization{}, false, nil
}

func (f fakeStore) VenueInOrganization(_ context.Context, id, organizationID string) (Venue, bool, error) {
	if f.fail {
		return Venue{}, false, errors.New("db down")
	}
	venues := map[string]Venue{
		venue:    {ID: venue, OrganizationID: org, Tax: TaxConfig{"NZD", "en-NZ", "NZ_GST", true}},
		other:    {ID: other, OrganizationID: org, Tax: TaxConfig{"AUD", "en-AU", "AU_GST", false}},
		otherOrg: {ID: otherOrg, OrganizationID: "org-2", Tax: TaxConfig{"NZD", "en-NZ", "NZ_GST", true}},
	}
	v, ok := venues[id]
	if !ok || v.OrganizationID != organizationID {
		return Venue{}, false, nil
	}
	return v, true, nil
}

const secret = "unit-test-secret-at-least-32-characters-long"

func token(t *testing.T, claims jwt.MapClaims) string {
	t.Helper()
	claims["sub"], claims["organizationId"], claims["exp"] = "staff-1", org, time.Now().Add(time.Minute).Unix()
	s, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte(secret))
	if err != nil {
		t.Fatal(err)
	}
	return s
}

// route wires the handler with the same guards as server.Routes.
func route(store Store) http.Handler {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	mux := http.NewServeMux()
	var h http.Handler = http.HandlerFunc(NewHandler(store, logger).TaxConfig)
	h = identity.RequireRoles(TaxConfigRoles...)(h)
	h = identity.Authenticate(identity.NewVerifier(secret))(h)
	mux.Handle("GET /api/venues/{id}/tax-config", h)
	return mux
}

func TestTaxConfig(t *testing.T) {
	cases := []struct {
		name   string
		claims jwt.MapClaims
		venue  string
		status int
		body   string
	}{
		{"manager", jwt.MapClaims{"role": "manager"}, venue, 200,
			`{"currency":"NZD","locale":"en-NZ","taxJurisdiction":"NZ_GST","pricesIncludeTax":true}`},
		{"owner bypasses roles", jwt.MapClaims{"role": "owner"}, other, 200,
			`{"currency":"AUD","locale":"en-AU","taxJurisdiction":"AU_GST","pricesIncludeTax":false}`},
		{"staff role not allowed", jwt.MapClaims{"role": "staff"}, venue, 403,
			`{"message":"Insufficient permissions","error":"Forbidden","statusCode":403}`},
		{"another organization's venue", jwt.MapClaims{"role": "admin"}, otherOrg, 404,
			`{"message":"Venue not found","error":"Not Found","statusCode":404}`},
		{"unknown id, not a uuid", jwt.MapClaims{"role": "admin"}, "whatever", 404,
			`{"message":"Venue not found","error":"Not Found","statusCode":404}`},
		{"kds device, own venue", jwt.MapClaims{"role": "kitchen", "kind": "kds_device", "venueId": venue}, venue, 200,
			`{"currency":"NZD","locale":"en-NZ","taxJurisdiction":"NZ_GST","pricesIncludeTax":true}`},
		{"kds device, other venue", jwt.MapClaims{"role": "kitchen", "kind": "kds_device", "venueId": venue}, other, 403,
			`{"message":"This device is not authorized for the requested venue","error":"Forbidden","statusCode":403}`},
		{"device token without a venue claim", jwt.MapClaims{"role": "viewer", "kind": "tablet_device"}, venue, 403,
			`{"message":"This device is not authorized for the requested venue","error":"Forbidden","statusCode":403}`},
	}
	for _, c := range cases {
		req := httptest.NewRequest("GET", "/api/venues/"+c.venue+"/tax-config", nil)
		req.Header.Set("Authorization", "Bearer "+token(t, c.claims))
		rec := httptest.NewRecorder()
		route(fakeStore{}).ServeHTTP(rec, req)
		if rec.Code != c.status || rec.Body.String() != c.body {
			t.Errorf("%s: %d %s", c.name, rec.Code, rec.Body)
		}
	}

	rec := httptest.NewRecorder()
	route(fakeStore{}).ServeHTTP(rec, httptest.NewRequest("GET", "/api/venues/"+venue+"/tax-config", nil))
	if rec.Code != 401 || rec.Body.String() != `{"message":"Unauthorized","statusCode":401}` {
		t.Errorf("no token: %d %s", rec.Code, rec.Body)
	}

	req := httptest.NewRequest("GET", "/api/venues/"+venue+"/tax-config", nil)
	req.Header.Set("Authorization", "Bearer "+token(t, jwt.MapClaims{"role": "admin"}))
	rec = httptest.NewRecorder()
	route(fakeStore{fail: true}).ServeHTTP(rec, req)
	if rec.Code != 500 || rec.Body.String() != `{"message":"Internal server error","statusCode":500}` {
		t.Errorf("store failure: %d %s", rec.Code, rec.Body)
	}
}
