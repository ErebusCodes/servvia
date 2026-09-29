// Contract tests: the Go implementation checked against the files in
// contracts/ that were written from the NestJS API's behaviour.
package contract

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/redis/go-redis/v9"

	"servvia/services/core-platform/internal/health"
	"servvia/services/core-platform/internal/identity"
	"servvia/services/core-platform/internal/menu"
	"servvia/services/core-platform/internal/ratelimit"
	"servvia/services/core-platform/internal/server"
	"servvia/services/core-platform/internal/venues"
	"servvia/services/core-platform/tests/testsupport"
)

const (
	secret  = "contract-test-secret-0123456789abcdef"
	orgID   = "20000000-0000-4000-8000-000000000002"
	venueID = "10000000-0000-4000-8000-000000000001"
	staffID = "30000000-0000-4000-8000-000000000003"
	device  = "40000000-0000-4000-8000-000000000004"
)

// nestShapedClaims builds each token kind exactly as the NestJS API signs it
// (auth.service.ts signAccessToken / signKdsDeviceToken, tablet-auth.service.ts).
func nestShapedClaims() map[string]jwt.MapClaims {
	now := time.Now()
	times := func(c jwt.MapClaims) jwt.MapClaims {
		c["iat"], c["exp"] = now.Unix(), now.Add(15*time.Minute).Unix()
		return c
	}
	return map[string]jwt.MapClaims{
		"staff": times(jwt.MapClaims{"sub": staffID, "email": "owner@example.test", "role": "owner", "organizationId": orgID}),
		"kds_device": times(jwt.MapClaims{
			"sub": "kds-device:" + venueID, "email": "kds-device+" + venueID + "@verdura.internal",
			"role": "kitchen", "organizationId": orgID, "venueId": venueID, "kind": "kds_device",
		}),
		"tablet_device": times(jwt.MapClaims{
			"sub": "tablet-device:" + device, "email": "tablet-device+" + device + "@verdura.internal",
			"role": "viewer", "organizationId": orgID, "venueId": venueID, "kind": "tablet_device", "deviceId": device,
		}),
		"tablet_staff": times(jwt.MapClaims{
			"sub": staffID, "email": "waiter@example.test", "role": "cashier",
			"organizationId": orgID, "venueId": venueID, "kind": "tablet_staff", "deviceId": device,
		}),
		"tablet_manager": times(jwt.MapClaims{
			"sub": staffID, "email": "manager@example.test", "role": "manager", "organizationId": orgID,
			"venueId": venueID, "kind": "tablet_manager", "deviceId": device, "actingStaffId": staffID,
		}),
	}
}

func TestAccessTokenClaimsMatchContractAndVerify(t *testing.T) {
	schema := testsupport.Schema(t, "schemas/auth-token-claims.schema.json", "")
	verifier := identity.NewVerifier(secret)

	for kind, claims := range nestShapedClaims() {
		token, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte(secret))
		if err != nil {
			t.Fatal(err)
		}

		// The header Nest emits, and the payload, must both match the contract.
		parts := strings.Split(token, ".")
		header, _ := base64.RawURLEncoding.DecodeString(parts[0])
		if string(header) != `{"alg":"HS256","typ":"JWT"}` {
			t.Errorf("%s: header %s", kind, header)
		}
		payload, _ := base64.RawURLEncoding.DecodeString(parts[1])
		testsupport.Validate(t, schema, payload)

		p, err := verifier.Verify(token)
		if err != nil {
			t.Fatalf("%s: %v", kind, err)
		}
		wantScoped := kind != "staff"
		if p.Kind.DeviceScoped() != wantScoped {
			t.Errorf("%s: device-scoped = %v", kind, p.Kind.DeviceScoped())
		}
		if wantScoped {
			if _, err := identity.ResolveVenueScope(p, "90000000-0000-4000-8000-000000000009"); err == nil {
				t.Errorf("%s: must not reach another venue", kind)
			}
		}
	}
}

type staticStore struct {
	found bool
	snap  menu.Snapshot
}

func (s staticStore) ActiveVenueOrganization(context.Context, string) (string, bool, error) {
	return orgID, s.found, nil
}

func (s staticStore) Snapshot(context.Context, string, string, menu.Channel) (menu.Snapshot, error) {
	return s.snap, nil
}

type okPinger struct{}

func (okPinger) Ping(context.Context) error { return nil }

// limiterReply is what the fake Redis answers every rate-limit script with.
type limiterReply struct {
	result []any
	err    error
}

func (l limiterReply) Eval(ctx context.Context, _ string, _ []string, _ ...any) *redis.Cmd {
	cmd := redis.NewCmd(ctx)
	if l.err != nil {
		cmd.SetErr(l.err)
	} else {
		cmd.SetVal(l.result)
	}
	return cmd
}

var admit = limiterReply{result: []any{int64(0), int64(1)}}

type venueStore struct{}

func (venueStore) Venue(context.Context, string) (venues.Venue, bool, error) {
	return venues.Venue{}, false, nil
}
func (venueStore) Organization(context.Context, string) (venues.Organization, bool, error) {
	return venues.Organization{}, false, nil
}
func (venueStore) VenueInOrganization(_ context.Context, id, org string) (venues.Venue, bool, error) {
	if id != venueID || org != orgID {
		return venues.Venue{}, false, nil
	}
	return venues.Venue{ID: venueID, OrganizationID: orgID,
		Tax: venues.TaxConfig{Currency: "NZD", Locale: "en-NZ", TaxJurisdiction: "NZ_GST", PricesIncludeTax: true}}, true, nil
}

type activeDevices struct{}

func (activeDevices) TabletDeviceActive(context.Context, string) (bool, error) { return true, nil }

func routesWith(store menu.Store, limiter ratelimit.Evaluator) http.Handler {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	return server.Routes(server.Deps{
		Logger:        logger,
		Health:        health.New(okPinger{}, time.Second),
		Menu:          menu.NewHandler(store, logger),
		Venues:        venues.NewHandler(venueStore{}, logger),
		Verifier:      identity.NewVerifier(secret),
		TabletDevices: activeDevices{},
		RateLimiter:   ratelimit.New(limiter, 0, logger),
	})
}

func routes(store menu.Store) http.Handler { return routesWith(store, admit) }

func get(h http.Handler, path string) *httptest.ResponseRecorder {
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, path, nil))
	return rec
}

func TestChannelMenuResponseMatchesContract(t *testing.T) {
	desc := "Hand-made"
	store := staticStore{found: true, snap: menu.Snapshot{
		Categories: []menu.Category{{
			ID: "50000000-0000-4000-8000-000000000005", Name: "Mains", Description: &desc,
			SortOrder: 1, IsActive: true, VisibleChannels: []string{"order_tablet", "window_display"},
		}},
		Items: []menu.Item{{
			ID: "60000000-0000-4000-8000-000000000006", CategoryID: "50000000-0000-4000-8000-000000000005",
			Title: "Burger", Description: "Beef", PriceCents: 2400, IsAvailable: true,
			NutritionalDetails: json.RawMessage(`{"calories":650,"allergens":["gluten"]}`),
			ModifierGroups: json.RawMessage(`[{"id":"70000000-0000-4000-8000-000000000007","name":"Size",` +
				`"required":true,"minSelections":1,"maxSelections":1,"options":[{"id":"80000000-0000-4000-8000-000000000008",` +
				`"name":"Regular","priceDeltaCents":0,"isAvailable":true,"sortOrder":0}]}]`),
			VisibleChannels: []string{"order_tablet", "window_display"},
		}},
	}}
	schema := testsupport.Schema(t, "openapi/menu-read.yaml", "/components/schemas/ChannelMenuResponse")
	for _, channel := range []string{"order_tablet", "customer_website", "window_display"} {
		rec := get(routes(store), "/api/menu/venues/"+venueID+"/channel/"+channel)
		if rec.Code != http.StatusOK {
			t.Fatalf("%s: status %d", channel, rec.Code)
		}
		testsupport.Validate(t, schema, rec.Body.Bytes())
	}
}

func TestChannelMenuErrorsMatchContract(t *testing.T) {
	schema := testsupport.Schema(t, "openapi/menu-read.yaml", "/components/schemas/NestError")
	for path, status := range map[string]int{
		"/api/menu/venues/not-a-uuid/channel/order_tablet":      400,
		"/api/menu/venues/" + venueID + "/channel/kiosk":        404,
		"/api/menu/venues/" + venueID + "/channel/order_table":  404,
		"/api/menu/venues/" + venueID + "/channel/order_tablet": 404, // venue not found
		"/api/not-a-route": 404,
	} {
		rec := get(routes(staticStore{found: false}), path)
		if rec.Code != status {
			t.Errorf("%s: status %d, want %d", path, rec.Code, status)
		}
		testsupport.Validate(t, schema, rec.Body.Bytes())
	}
}

func TestEveryResponseCarriesRequestIDsAndNestSecurityHeaders(t *testing.T) {
	rec := get(routes(staticStore{}), "/health")
	for _, h := range []string{"X-Request-Id", "X-Correlation-Id", "Content-Security-Policy", "X-Frame-Options", "Strict-Transport-Security"} {
		if rec.Header().Get(h) == "" {
			t.Errorf("missing %s", h)
		}
	}
}

func TestRateLimitResponsesMatchContract(t *testing.T) {
	path := "/api/menu/venues/" + venueID + "/channel/order_tablet"
	for status, limiter := range map[int]limiterReply{
		429: {result: []any{int64(1), int64(120), time.Now().UnixMilli()}},
		503: {err: context.DeadlineExceeded},
	} {
		rec := get(routesWith(staticStore{found: true}, limiter), path)
		if rec.Code != status {
			t.Fatalf("status %d, want %d", rec.Code, status)
		}
		testsupport.Validate(t, testsupport.Schema(t, "openapi/menu-read.yaml", "/components/schemas/NestError"), rec.Body.Bytes())
		if status == 429 && rec.Header().Get("Retry-After") != "60" {
			t.Errorf("Retry-After %q", rec.Header().Get("Retry-After"))
		}
	}
}

func TestVenueTaxConfigMatchesContract(t *testing.T) {
	claims := nestShapedClaims()
	path := "/api/venues/" + venueID + "/tax-config"
	ok := testsupport.Schema(t, "openapi/venues-read.yaml", "/components/schemas/VenueTaxConfig")
	nestErr := testsupport.Schema(t, "openapi/venues-read.yaml", "/components/schemas/NestError")
	passport := testsupport.Schema(t, "openapi/venues-read.yaml", "/components/schemas/PassportUnauthorized")

	for kind, c := range claims {
		token, _ := jwt.NewWithClaims(jwt.SigningMethodHS256, c).SignedString([]byte(secret))
		req := httptest.NewRequest(http.MethodGet, path, nil)
		req.Header.Set("Authorization", "Bearer "+token)
		rec := httptest.NewRecorder()
		routes(staticStore{}).ServeHTTP(rec, req)
		// tablet_staff carries the role "cashier", which is not allowed.
		want := map[bool]int{true: 403, false: 200}[kind == "tablet_staff"]
		if rec.Code != want {
			t.Errorf("%s: status %d, want %d: %s", kind, rec.Code, want, rec.Body)
			continue
		}
		if want == 200 {
			testsupport.Validate(t, ok, rec.Body.Bytes())
		} else {
			testsupport.Validate(t, nestErr, rec.Body.Bytes())
		}
	}

	rec := get(routes(staticStore{}), path)
	if rec.Code != 401 {
		t.Fatalf("no token: %d", rec.Code)
	}
	testsupport.Validate(t, passport, rec.Body.Bytes())

	staff, _ := jwt.NewWithClaims(jwt.SigningMethodHS256, claims["staff"]).SignedString([]byte(secret))
	req := httptest.NewRequest(http.MethodGet, "/api/venues/90000000-0000-4000-8000-000000000009/tax-config", nil)
	req.Header.Set("Authorization", "Bearer "+staff)
	rec = httptest.NewRecorder()
	routes(staticStore{}).ServeHTTP(rec, req)
	if rec.Code != 404 {
		t.Fatalf("unknown venue: %d", rec.Code)
	}
	testsupport.Validate(t, nestErr, rec.Body.Bytes())
}
