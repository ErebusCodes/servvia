// Parity tests: the running NestJS API and the Go Core, pointed at the same
// disposable PostgreSQL database, must answer identically.
//
// Required environment (the suite skips when SERVVIA_CORE_PARITY_NEST_URL is unset):
//
//	SERVVIA_CORE_TEST_DATABASE_URL         disposable database both services use
//	SERVVIA_CORE_PARITY_NEST_URL           e.g. http://127.0.0.1:3999 (local only)
//	SERVVIA_CORE_PARITY_JWT_ACCESS_SECRET  the JWT_ACCESS_SECRET the Nest API runs with
//	SERVVIA_CORE_PARITY_OWNER_EMAIL / _OWNER_PASSWORD   a seeded owner login
//	SERVVIA_CORE_PARITY_VENUE_ID / _KDS_PIN             a venue in KDS_VENUE_PINS
//	SERVVIA_CORE_TEST_REDIS_ADDR           the Redis the Nest API uses (REDIS_HOST:REDIS_PORT);
//	                                       Go shares it so both see one rate-limit budget
//
// The suite writes through Nest (a tablet enrollment and staff PIN) and seeds
// its own menu fixture, all in the disposable database.
package parity

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"reflect"
	"sort"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"servvia/services/core-platform/internal/health"
	"servvia/services/core-platform/internal/identity"
	"servvia/services/core-platform/internal/menu"
	"servvia/services/core-platform/internal/orders"
	"servvia/services/core-platform/internal/orders/ordersapi"
	orderstore "servvia/services/core-platform/internal/orders/pgstore"
	"servvia/services/core-platform/internal/platform/postgres"
	"servvia/services/core-platform/internal/pricing/pgcatalog"
	"servvia/services/core-platform/internal/ratelimit"
	"servvia/services/core-platform/internal/server"
	"servvia/services/core-platform/internal/tables"
	tablestore "servvia/services/core-platform/internal/tables/pgstore"
	"servvia/services/core-platform/internal/tables/tablesapi"
	"servvia/services/core-platform/internal/venues"
	"servvia/services/core-platform/tests/testsupport"
)

type env struct {
	nest, secret, ownerEmail, ownerPassword, venue, kdsPin string
}

func loadEnv(t *testing.T) env {
	t.Helper()
	e := env{
		nest:          os.Getenv("SERVVIA_CORE_PARITY_NEST_URL"),
		secret:        os.Getenv("SERVVIA_CORE_PARITY_JWT_ACCESS_SECRET"),
		ownerEmail:    os.Getenv("SERVVIA_CORE_PARITY_OWNER_EMAIL"),
		ownerPassword: os.Getenv("SERVVIA_CORE_PARITY_OWNER_PASSWORD"),
		venue:         os.Getenv("SERVVIA_CORE_PARITY_VENUE_ID"),
		kdsPin:        os.Getenv("SERVVIA_CORE_PARITY_KDS_PIN"),
	}
	if e.nest == "" {
		t.Skip("SERVVIA_CORE_PARITY_NEST_URL is not set; skipping Nest/Go parity suite")
	}
	if u, err := url.Parse(e.nest); err != nil || (u.Hostname() != "127.0.0.1" && u.Hostname() != "localhost") {
		t.Fatalf("refusing Nest URL %q: parity only runs against a local API", e.nest)
	}
	for name, v := range map[string]string{"JWT secret": e.secret, "owner email": e.ownerEmail,
		"owner password": e.ownerPassword, "venue": e.venue, "KDS PIN": e.kdsPin} {
		if v == "" {
			t.Fatalf("parity %s is not set", name)
		}
	}
	return e
}

type response struct {
	status int
	header http.Header
	body   []byte
}

func call(t *testing.T, method, target, token string, body any) response {
	t.Helper()
	var reader io.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		reader = bytes.NewReader(b)
	}
	req, _ := http.NewRequest(method, target, reader)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("%s %s: %v", method, target, err)
	}
	defer res.Body.Close()
	b, _ := io.ReadAll(res.Body)
	return response{res.StatusCode, res.Header, b}
}

func field(t *testing.T, r response, name string) string {
	t.Helper()
	var m map[string]any
	if err := json.Unmarshal(r.body, &m); err != nil {
		t.Fatalf("not JSON (%d): %s", r.status, r.body)
	}
	v, _ := m[name].(string)
	if v == "" {
		t.Fatalf("response has no %q (%d): %s", name, r.status, r.body)
	}
	return v
}

// goServer runs the Go routes exactly as cmd/api wires them, on the same
// database and the same Redis as the Nest API, with the same JWT secret, and
// a read-only database (the default).
func goServer(t *testing.T, dbURL, secret string) *httptest.Server {
	t.Helper()
	return goServerWith(t, dbURL, secret, false)
}

// goServerWith optionally enables writes (SERVVIA_CORE_DB_READ_ONLY=false):
// table sessions and orders.
func goServerWith(t *testing.T, dbURL, secret string, writable bool) *httptest.Server {
	t.Helper()
	pool, err := postgres.NewPool(context.Background(), postgres.Options{URL: dbURL, MaxConns: 16, ReadOnly: !writable})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	host, port := testsupport.DisposableRedisAddr(t)
	rdb := ratelimit.NewRedisClient(host, port)
	t.Cleanup(func() { _ = rdb.Close() })
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	venueStore := venues.NewPostgresStore(pool)
	srv := httptest.NewServer(server.Routes(server.Deps{
		Logger:        logger,
		Health:        health.New(pool, 2*time.Second),
		Menu:          menu.NewHandler(menu.NewPostgresStore(pool), logger),
		Venues:        venues.NewHandler(venueStore, logger),
		TableSessions: tablesapi.NewHandler(tables.NewService(tablestore.New(pool), writable), venueStore, logger),
		Orders: ordersapi.NewHandler(orders.NewService(orderstore.New(pool, nil), pgcatalog.New(pool), writable),
			venueStore, logger),
		Verifier:      identity.NewVerifier(secret),
		TabletDevices: identity.NewPostgresTabletDevices(pool),
		RateLimiter:   ratelimit.New(rdb, 0, logger),
	}))
	t.Cleanup(srv.Close)
	return srv
}

// normalize returns the decoded body with categories and menu items sorted by
// (sortOrder, id). Nest orders by sortOrder only, so equal-sortOrder rows may
// come back in any order; Go breaks ties by id.
func normalize(t *testing.T, raw []byte) any {
	t.Helper()
	var v any
	if err := json.Unmarshal(raw, &v); err != nil {
		t.Fatalf("not JSON: %s", raw)
	}
	obj, ok := v.(map[string]any)
	if !ok {
		return v
	}
	for _, key := range []string{"categories", "menuItems"} {
		list, ok := obj[key].([]any)
		if !ok {
			continue
		}
		sort.SliceStable(list, func(i, j int) bool {
			a, b := list[i].(map[string]any), list[j].(map[string]any)
			if a["sortOrder"] != b["sortOrder"] {
				return a["sortOrder"].(float64) < b["sortOrder"].(float64)
			}
			return a["id"].(string) < b["id"].(string)
		})
	}
	return obj
}

func assertSortOrderAscending(t *testing.T, label string, raw []byte) {
	t.Helper()
	var body map[string][]map[string]any
	if json.Unmarshal(raw, &body) != nil {
		return
	}
	for key, list := range body {
		for i := 1; i < len(list); i++ {
			if list[i]["sortOrder"].(float64) < list[i-1]["sortOrder"].(float64) {
				t.Errorf("%s: %s not ascending by sortOrder", label, key)
			}
		}
	}
}

var comparedHeaders = []string{
	"Content-Type", "Content-Security-Policy", "X-Frame-Options", "Frame-Options",
	"Strict-Transport-Security", "X-Content-Type-Options", "Referrer-Policy", "X-XSS-Protection",
	"X-DNS-Prefetch-Control", "X-Download-Options", "Origin-Agent-Cluster", "X-Permitted-Cross-Domain-Policies",
}

func TestChannelMenuParity(t *testing.T) {
	e := loadEnv(t)
	dbURL := testsupport.DisposableDatabaseURL(t)
	writer, err := pgxpool.New(context.Background(), dbURL)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(writer.Close)
	f := testsupport.SeedMenuFixture(t, context.Background(), writer)
	goURL := goServer(t, dbURL, e.secret).URL
	schema := testsupport.Schema(t, "openapi/menu-read.yaml", "/components/schemas/ChannelMenuResponse")

	venues := []string{e.venue, f.Venue, f.InactiveVenue, testsupport.UUID(), "not-a-uuid", strings.ToUpper(f.Venue)}
	channels := []string{"order_tablet", "customer_website", "window_display", "kiosk"}
	compared, withItems := 0, 0
	for _, venue := range venues {
		for _, channel := range channels {
			for _, suffix := range []string{"", "/"} {
				path := "/api/menu/venues/" + venue + "/channel/" + channel + suffix
				nest, goRes := call(t, http.MethodGet, e.nest+path, "", nil), call(t, http.MethodGet, goURL+path, "", nil)
				compared++

				if nest.status != goRes.status {
					t.Errorf("%s: status nest=%d go=%d\nnest=%s\ngo=%s", path, nest.status, goRes.status, nest.body, goRes.body)
					continue
				}
				for _, h := range comparedHeaders {
					if nest.header.Get(h) != goRes.header.Get(h) {
						t.Errorf("%s: header %s nest=%q go=%q", path, h, nest.header.Get(h), goRes.header.Get(h))
					}
				}
				if nest.status == http.StatusOK {
					testsupport.Validate(t, schema, nest.body)
					assertSortOrderAscending(t, "nest "+path, nest.body)
					if strings.Contains(string(nest.body), `"menuItems":[{`) {
						withItems++
					}
				}
				if n, g := normalize(t, nest.body), normalize(t, goRes.body); !reflect.DeepEqual(n, g) {
					t.Errorf("%s: body differs\nnest=%s\ngo=%s", path, nest.body, goRes.body)
				}
			}
		}
	}
	t.Logf("compared %d requests (%d non-empty menus) across %d venues and %d channels", compared, withItems, len(venues), len(channels))
	// Both active venues x 3 channels x 2 URL forms. Fewer means the comparison
	// ran against empty menus and proved little: publish the seeded menu first
	// (prisma/scripts/backfill-channel-visibility.ts --apply, see the README).
	if withItems < 12 {
		t.Errorf("expected 12 non-empty menu comparisons, got %d", withItems)
	}
}

// Nest's staff-authenticated route used as the reference for the auth layer.
const nestProtected = "/api/venues"

func mint(t *testing.T, secret string, method jwt.SigningMethod, claims jwt.MapClaims) string {
	t.Helper()
	key := any([]byte(secret))
	if method == jwt.SigningMethodNone {
		key = jwt.UnsafeAllowNoneSignatureType
	}
	s, err := jwt.NewWithClaims(method, claims).SignedString(key)
	if err != nil {
		t.Fatal(err)
	}
	return s
}

func claimsOf(t *testing.T, token string) []byte {
	t.Helper()
	b, err := base64.RawURLEncoding.DecodeString(strings.Split(token, ".")[1])
	if err != nil {
		t.Fatal(err)
	}
	return b
}

func TestAccessTokenParity(t *testing.T) {
	e := loadEnv(t)
	verifier := identity.NewVerifier(e.secret)
	claimSchema := testsupport.Schema(t, "schemas/auth-token-claims.schema.json", "")

	tokens := nestTokens(t, e)
	staffToken, kdsToken, deviceToken := tokens.staff, tokens.kds, tokens.device
	tabletStaffToken, managerToken := tokens.tabletStaff, tokens.manager

	// Every real Nest-issued kind verifies in Go with the same identity.
	for kind, token := range map[identity.Kind]string{
		identity.KindStaffSession: staffToken, identity.KindKDSDevice: kdsToken, identity.KindTabletDevice: deviceToken,
		identity.KindTabletStaff: tabletStaffToken, identity.KindTabletManager: managerToken,
	} {
		testsupport.Validate(t, claimSchema, claimsOf(t, token))
		p, err := verifier.Verify(token)
		if err != nil {
			t.Fatalf("%q: Go rejected a Nest-issued token: %v", kind, err)
		}
		if p.Kind != kind {
			t.Errorf("kind = %q, want %q", p.Kind, kind)
		}
		if kind.DeviceScoped() {
			if p.VenueID != e.venue {
				t.Errorf("%q: venueId = %q", kind, p.VenueID)
			}
			if _, err := identity.ResolveVenueScope(p, testsupport.UUID()); err == nil {
				t.Errorf("%q: a device token must not reach another venue", kind)
			}
		}
	}

	// The auth layer answers the same tokens identically: Nest's protected
	// route versus Go's Authenticate middleware.
	staffClaims := jwt.MapClaims{}
	_ = json.Unmarshal(claimsOf(t, staffToken), &staffClaims)
	with := func(changes map[string]any) jwt.MapClaims {
		c := jwt.MapClaims{}
		for k, v := range staffClaims {
			c[k] = v
		}
		c["iat"], c["exp"] = time.Now().Unix(), time.Now().Add(10*time.Minute).Unix()
		for k, v := range changes {
			if v == nil {
				delete(c, k)
			} else {
				c[k] = v
			}
		}
		return c
	}
	tampered := staffToken[:len(staffToken)-2] + map[bool]string{true: "AA", false: "BB"}[!strings.HasSuffix(staffToken, "AA")]
	cases := map[string]string{
		"nest staff token":     staffToken,
		"go-minted staff":      mint(t, e.secret, jwt.SigningMethodHS256, with(nil)),
		"tampered signature":   tampered,
		"expired":              mint(t, e.secret, jwt.SigningMethodHS256, with(map[string]any{"exp": time.Now().Add(-time.Minute).Unix()})),
		"HS512":                mint(t, e.secret, jwt.SigningMethodHS512, with(nil)),
		"alg none":             mint(t, e.secret, jwt.SigningMethodNone, with(nil)),
		"wrong secret":         mint(t, e.secret+"x", jwt.SigningMethodHS256, with(nil)),
		"missing role":         mint(t, e.secret, jwt.SigningMethodHS256, with(map[string]any{"role": nil})),
		"missing organization": mint(t, e.secret, jwt.SigningMethodHS256, with(map[string]any{"organizationId": nil})),
		"no token":             "",
	}
	goAuth := httptest.NewServer(identity.Authenticate(verifier)(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	})))
	defer goAuth.Close()

	for name, token := range cases {
		nest, goRes := call(t, http.MethodGet, e.nest+nestProtected, token, nil), call(t, http.MethodGet, goAuth.URL, token, nil)
		if nest.status != goRes.status {
			t.Errorf("%s: status nest=%d go=%d (nest body %s)", name, nest.status, goRes.status, nest.body)
			continue
		}
		if nest.status == http.StatusUnauthorized {
			var n, g any
			_ = json.Unmarshal(nest.body, &n)
			_ = json.Unmarshal(goRes.body, &g)
			if !reflect.DeepEqual(n, g) {
				t.Errorf("%s: 401 body nest=%s go=%s", name, nest.body, goRes.body)
			}
		}
	}
}

// tokens holds one real token of every kind the Nest API issues.
type tokens struct {
	staff, kds, device, tabletStaff, manager string
	ownerID                                  string
}

var (
	tokensOnce sync.Once
	tokensSet  tokens
)

// nestTokens returns one token of every kind, obtained once per test run:
// Nest limits login, KDS auth and tablet enrollment to 10 per 15 minutes.
// TestVenueTaxConfigParity revokes the tablet at its end; nothing after it
// sends tablet tokens to Nest.
func nestTokens(t *testing.T, e env) tokens {
	t.Helper()
	tokensOnce.Do(func() { tokensSet = fetchNestTokens(t, e) })
	if tokensSet.staff == "" {
		t.Fatal("Nest tokens unavailable (an earlier test failed to obtain them)")
	}
	return tokensSet
}

// fetchNestTokens logs in as the seeded owner and obtains a token of every
// kind from the running Nest API: a KDS device token, and a freshly enrolled
// tablet with its staff and manager elevations.
func fetchNestTokens(t *testing.T, e env) tokens {
	t.Helper()
	login := call(t, http.MethodPost, e.nest+"/api/auth/login", "", map[string]string{"email": e.ownerEmail, "password": e.ownerPassword})
	if login.status != http.StatusOK && login.status != http.StatusCreated {
		t.Fatalf("login: %d %s", login.status, login.body)
	}
	staffToken := field(t, login, "accessToken")
	var loginBody struct {
		User struct {
			ID string `json:"id"`
		} `json:"user"`
	}
	_ = json.Unmarshal(login.body, &loginBody)

	kds := call(t, http.MethodPost, e.nest+"/api/kiosk/kds/auth", "", map[string]string{"venueId": e.venue, "pin": e.kdsPin})
	kdsToken := field(t, kds, "accessToken")

	pin := "4" + testsupport.UUID()[:3]
	for _, c := range "abcdef" {
		pin = strings.ReplaceAll(pin, string(c), "7")
	}
	if r := call(t, http.MethodPost, e.nest+"/api/admin/staff/"+loginBody.User.ID+"/tablet-pin", staffToken, map[string]string{"pin": pin}); r.status >= 300 {
		t.Fatalf("set tablet PIN: %d %s", r.status, r.body)
	}
	enrollment := call(t, http.MethodPost, e.nest+"/api/venues/"+e.venue+"/tablet-devices/enrollments", staffToken, map[string]string{"label": "parity"})
	enrolled := call(t, http.MethodPost, e.nest+"/api/tablet/enroll", "", map[string]string{"bootstrapToken": field(t, enrollment, "bootstrapToken")})
	deviceToken := field(t, enrolled, "deviceToken")
	tabletStaffToken := field(t, call(t, http.MethodPost, e.nest+"/api/tablet/elevate", deviceToken, map[string]string{"staffPin": pin}), "token")
	stepUp := call(t, http.MethodPost, e.nest+"/api/tablet/manager-step-up", tabletStaffToken, map[string]string{"managerPin": pin})
	if stepUp.status >= 300 {
		stepUp = call(t, http.MethodPost, e.nest+"/api/tablet/manager-step-up", deviceToken, map[string]string{"managerPin": pin})
	}
	managerToken := field(t, stepUp, "token")
	return tokens{staff: staffToken, kds: kdsToken, device: deviceToken, tabletStaff: tabletStaffToken,
		manager: managerToken, ownerID: loginBody.User.ID}
}
