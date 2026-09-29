package parity

// Phase D1 parity: the HTTP behaviour a client sees on every route (routing,
// CORS, CSRF cookie, ETag/304, the shared rate-limit budget), the venue
// tax-config read, and server-authoritative pricing. Environment as in
// parity_test.go.

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"reflect"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"servvia/services/core-platform/internal/platform/postgres"
	"servvia/services/core-platform/internal/pricing"
	"servvia/services/core-platform/internal/pricing/pgcatalog"
	"servvia/services/core-platform/internal/venues"
	"servvia/services/core-platform/tests/testsupport"
)

// request is one HTTP exchange sent identically to both services.
type request struct {
	name, method, path string
	headers            []string
}

func send(t *testing.T, base string, r request) response {
	t.Helper()
	req, _ := http.NewRequest(r.method, base+r.path, nil)
	for i := 0; i+1 < len(r.headers); i += 2 {
		req.Header.Add(r.headers[i], r.headers[i+1])
	}
	// Opaque keeps the path exactly as written (case, escapes, slashes).
	req.URL.Opaque = strings.SplitN(r.path, "?", 2)[0]
	res, err := http.DefaultTransport.RoundTrip(req)
	if err != nil {
		t.Fatalf("%s %s: %v", r.method, base+r.path, err)
	}
	defer res.Body.Close()
	var b bytes.Buffer
	_, _ = b.ReadFrom(res.Body)
	return response{res.StatusCode, res.Header, b.Bytes()}
}

// cookieShape is Set-Cookie with the random token removed.
func cookieShape(h http.Header) string {
	c := h.Get("Set-Cookie")
	if name, rest, ok := strings.Cut(c, "="); ok {
		if _, attrs, ok := strings.Cut(rest, ";"); ok {
			return name + "=<token>;" + attrs
		}
	}
	return c
}

var compatHeaders = append([]string{
	"Access-Control-Allow-Origin", "Access-Control-Allow-Credentials", "Access-Control-Allow-Methods",
	"Access-Control-Allow-Headers", "Vary", "Retry-After",
}, comparedHeaders...)

func compare(t *testing.T, name string, nest, goRes response) {
	t.Helper()
	if nest.status != goRes.status {
		t.Errorf("%s: status nest=%d go=%d\nnest=%s\ngo=%s", name, nest.status, goRes.status, nest.body, goRes.body)
		return
	}
	for _, h := range compatHeaders {
		if n, g := nest.header.Get(h), goRes.header.Get(h); n != g {
			t.Errorf("%s: header %s nest=%q go=%q", name, h, n, g)
		}
	}
	if n, g := cookieShape(nest.header), cookieShape(goRes.header); n != g {
		t.Errorf("%s: Set-Cookie nest=%q go=%q", name, n, g)
	}
	sameBytes := bytes.Equal(nest.body, goRes.body)
	if sameBytes {
		// Identical bytes must give identical validators and lengths. A 204
		// is excepted: Nest's `cors` sends Content-Length: 0, and Go's HTTP
		// server never sends Content-Length on a 204 (RFC 9110 §8.6).
		lengthHeaders := []string{"ETag", "Content-Length"}
		if nest.status == http.StatusNoContent {
			lengthHeaders = lengthHeaders[:1]
		}
		for _, h := range lengthHeaders {
			if n, g := nest.header.Get(h), goRes.header.Get(h); n != g {
				t.Errorf("%s: header %s nest=%q go=%q", name, h, n, g)
			}
		}
	} else if n, g := normalize(t, orEmpty(nest.body)), normalize(t, orEmpty(goRes.body)); !reflect.DeepEqual(n, g) {
		t.Errorf("%s: body differs\nnest=%s\ngo=%s", name, nest.body, goRes.body)
	}
	if (nest.header.Get("ETag") == "") != (goRes.header.Get("ETag") == "") {
		t.Errorf("%s: ETag presence nest=%q go=%q", name, nest.header.Get("ETag"), goRes.header.Get("ETag"))
	}
}

func orEmpty(b []byte) []byte {
	if len(b) == 0 {
		return []byte("null")
	}
	return b
}

func TestHTTPCompatibilityParity(t *testing.T) {
	e := loadEnv(t)
	goURL := goServer(t, testsupport.DisposableDatabaseURL(t), e.secret).URL
	v := e.venue
	menuPath := "/api/menu/venues/" + v + "/channel/order_tablet"
	allowed, denied := "http://localhost:5177", "https://evil.example"

	requests := []request{
		{"canonical", "GET", menuPath, nil},
		{"literal case ignored", "GET", "/API/MENU/VENUES/" + v + "/CHANNEL/order_tablet", nil},
		{"parameter case kept", "GET", "/api/menu/venues/" + v + "/channel/ORDER_TABLET", nil},
		{"uppercase uuid", "GET", "/api/menu/venues/" + strings.ToUpper(v) + "/channel/window_display", nil},
		{"trailing slash", "GET", menuPath + "/", nil},
		{"two trailing slashes", "GET", menuPath + "//", nil},
		{"empty segment", "GET", "/api/menu/venues/" + v + "//channel/order_tablet", nil},
		{"escaped parameter", "GET", "/api/menu/venues/" + v + "/channel/order%5Ftablet", nil},
		{"escaped literal", "GET", "/api/%6Denu/venues/" + v + "/channel/order_tablet", nil},
		{"escaped slash in parameter", "GET", "/api/menu/venues/a%2Fb/channel/order_tablet", nil},
		{"undecodable segment", "GET", "/api/menu/venues/%E0%A4/channel/order_tablet", nil},
		{"undecodable unmatched", "GET", "/api/nothing/%C0%AF", nil},
		{"query string", "GET", menuPath + "?x=1", nil},
		{"unmatched api route", "GET", "/api/definitely/not/here", nil},
		{"unmatched outside api", "GET", "/definitely-not-here", nil},
		{"HEAD", "HEAD", menuPath, nil},
		{"tax-config without token", "GET", "/api/Venues/" + v + "/tax-config", nil},
		// CSRF on unsafe methods (no Go route accepts them, so each ends 403 or 404).
		{"POST without token", "POST", menuPath, nil},
		{"POST with bearer", "POST", menuPath, []string{"Authorization", "Bearer x"}},
		{"POST with matching csrf", "POST", menuPath, []string{"Cookie", "csrf_token=abc", "X-CSRF-Token", "abc"}},
		{"POST with mismatched csrf", "POST", menuPath, []string{"Cookie", "csrf_token=abc", "X-CSRF-Token", "abd"}},
		{"POST to an auth path", "POST", "/api/nothing/auth", nil},
		{"existing csrf cookie", "GET", menuPath, []string{"Cookie", "csrf_token=kept"}},
		// CORS.
		{"allowed origin", "GET", menuPath, []string{"Origin", allowed}},
		{"allowed origin, error", "GET", "/api/menu/venues/" + v + "/channel/kiosk", []string{"Origin", allowed}},
		{"denied origin", "GET", menuPath, []string{"Origin", denied}},
		{"preflight, allowed origin", "OPTIONS", menuPath, []string{"Origin", allowed, "Access-Control-Request-Method", "GET",
			"Access-Control-Request-Headers", "x-csrf-token, Authorization"}},
		{"preflight, no origin", "OPTIONS", "/api/anything", nil},
		{"preflight, denied origin", "OPTIONS", menuPath, []string{"Origin", denied, "Access-Control-Request-Method", "GET"}},
		{"preflight outside api", "OPTIONS", "/x", []string{"Origin", "https://admin.verdura.co.nz"}},
		// Conditional requests that do not depend on the body's bytes.
		{"If-None-Match star", "GET", menuPath, []string{"If-None-Match", "*"}},
		{"If-None-Match other", "GET", menuPath, []string{"If-None-Match", `W/"nope"`}},
		{"If-None-Match star, no-cache", "GET", menuPath, []string{"If-None-Match", "*", "Cache-Control", "no-cache"}},
		{"If-Modified-Since only", "GET", menuPath, []string{"If-Modified-Since", "Mon, 28 Sep 2099 00:00:00 GMT"}},
		{"If-None-Match star on an error", "GET", "/api/menu/venues/" + v + "/channel/kiosk", []string{"If-None-Match", "*"}},
	}
	for _, r := range requests {
		compare(t, r.name, send(t, e.nest, r), send(t, goURL, r))
	}

	// The seeded menu has no sortOrder ties, so both services serialise it to
	// the same bytes: one ETag, and a validator from either one revalidates
	// against the other (304), which is what a client behind a proxy that
	// moves the route will see.
	nest, goRes := send(t, e.nest, request{"", "GET", menuPath, nil}), send(t, goURL, request{"", "GET", menuPath, nil})
	if !bytes.Equal(nest.body, goRes.body) || nest.header.Get("ETag") != goRes.header.Get("ETag") {
		t.Errorf("seeded menu: bytes equal=%v, ETag nest=%s go=%s", bytes.Equal(nest.body, goRes.body),
			nest.header.Get("ETag"), goRes.header.Get("ETag"))
	}
	cross := send(t, goURL, request{"", "GET", menuPath, []string{"If-None-Match", nest.header.Get("ETag")}})
	if cross.status != http.StatusNotModified {
		t.Errorf("Nest's validator sent to Go: %d, want 304", cross.status)
	}

	// Each service's own validator makes its own response 304; for error
	// bodies, which are byte-identical, the validators are identical too.
	for _, path := range []string{menuPath, "/api/menu/venues/" + v + "/channel/kiosk", "/api/menu/venues/x/channel/y"} {
		for base, label := range map[string]string{e.nest: "nest", goURL: "go"} {
			first := send(t, base, request{"", "GET", path, nil})
			again := send(t, base, request{"", "GET", path, []string{"If-None-Match", first.header.Get("ETag")}})
			want := map[bool]int{true: 304, false: first.status}[first.status == 200]
			if again.status != want || (want == 304 && len(again.body) != 0) {
				t.Errorf("%s %s: revalidation gave %d, want %d", label, path, again.status, want)
			}
		}
	}
	t.Logf("compared %d request shapes", len(requests))
}

func TestRateLimitBudgetIsShared(t *testing.T) {
	e := loadEnv(t)
	goURL := goServer(t, testsupport.DisposableDatabaseURL(t), e.secret).URL
	// A path no other test touches: a fresh key in the shared Redis.
	path := "/api/menu/venues/" + testsupport.UUID() + "/channel/order_tablet"

	// 120 requests split across the two services exhaust ONE budget.
	for i := 0; i < 120; i++ {
		base := map[bool]string{true: e.nest, false: goURL}[i%2 == 0]
		if r := send(t, base, request{"", "GET", path, nil}); r.status != http.StatusNotFound {
			t.Fatalf("request %d: %d %s", i+1, r.status, r.body)
		}
	}
	nest, goRes := send(t, e.nest, request{"", "GET", path, nil}), send(t, goURL, request{"", "GET", path, nil})
	if nest.status != http.StatusTooManyRequests || goRes.status != http.StatusTooManyRequests {
		t.Fatalf("after 120 shared requests: nest=%d go=%d", nest.status, goRes.status)
	}
	compare(t, "rate limited", nest, goRes)
	if !bytes.Equal(nest.body, goRes.body) {
		t.Errorf("429 bodies differ byte-wise:\nnest=%s\ngo=%s", nest.body, goRes.body)
	}
	// Case and escaping are part of the key in both: a different spelling of
	// the same route has its own budget.
	if r := send(t, goURL, request{"", "GET", strings.Replace(path, "/api/menu", "/API/menu", 1), nil}); r.status != http.StatusNotFound {
		t.Errorf("a different raw path must have its own budget, got %d", r.status)
	}
}

func TestVenueTaxConfigParity(t *testing.T) {
	e := loadEnv(t)
	dbURL := testsupport.DisposableDatabaseURL(t)
	goURL := goServer(t, dbURL, e.secret).URL
	writer, err := pgxpool.New(context.Background(), dbURL)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(writer.Close)
	tok := nestTokens(t, e)

	// Another venue of the seeded organization with a different tax profile,
	// and a venue of another organization.
	var orgID string
	if err := writer.QueryRow(context.Background(), `SELECT "organizationId" FROM "Venue" WHERE id = $1`, e.venue).Scan(&orgID); err != nil {
		t.Fatal(err)
	}
	pf := testsupport.SeedPricingFixture(t, context.Background(), writer, orgID, tok.ownerID)
	mf := testsupport.SeedMenuFixture(t, context.Background(), writer)

	staffClaims := jwt.MapClaims{}
	_ = json.Unmarshal(claimsOf(t, tok.staff), &staffClaims)
	withRole := func(role string) string {
		c := jwt.MapClaims{}
		for k, v := range staffClaims {
			c[k] = v
		}
		c["role"], c["exp"] = role, time.Now().Add(10*time.Minute).Unix()
		return mint(t, e.secret, jwt.SigningMethodHS256, c)
	}
	callers := map[string]string{
		"owner session": tok.staff, "kds device": tok.kds, "tablet device": tok.device,
		"tablet staff": tok.tabletStaff, "tablet manager": tok.manager, "admin": withRole("admin"),
		"manager": withRole("manager"), "kitchen": withRole("kitchen"), "viewer": withRole("viewer"),
		"unknown role": withRole("cashier"), "no token": "",
		"malformed payload": mint(t, e.secret, jwt.SigningMethodHS256, jwt.MapClaims{"sub": "x", "exp": time.Now().Add(time.Minute).Unix()}),
	}
	venueIDs := map[string]string{
		"own venue": e.venue, "same org, taxless": pf.TaxlessVenue, "other org": mf.Venue,
		"unknown uuid": testsupport.UUID(), "not a uuid": "not-a-uuid",
	}
	compared, ok := 0, 0
	for caller, token := range callers {
		for label, id := range venueIDs {
			path := "/api/venues/" + id + "/tax-config"
			nest, goRes := call(t, http.MethodGet, e.nest+path, token, nil), call(t, http.MethodGet, goURL+path, token, nil)
			compare(t, caller+" / "+label, nest, goRes)
			if !bytes.Equal(nest.body, goRes.body) {
				t.Errorf("%s / %s: bodies differ byte-wise\nnest=%s\ngo=%s", caller, label, nest.body, goRes.body)
			}
			if nest.status == 200 {
				testsupport.Validate(t, testsupport.Schema(t, "openapi/venues-read.yaml", "/components/schemas/VenueTaxConfig"), nest.body)
				ok++
			}
			compared++
		}
	}

	// Revoking the tablet makes all three tablet tokens fail in both services.
	var deviceClaims struct {
		DeviceID string `json:"deviceId"`
	}
	_ = json.Unmarshal(claimsOf(t, tok.device), &deviceClaims)
	revoke := call(t, http.MethodPost, e.nest+"/api/venues/"+e.venue+"/tablet-devices/devices/"+deviceClaims.DeviceID+"/revoke", tok.staff, map[string]string{})
	if revoke.status >= 300 {
		t.Fatalf("revoke: %d %s", revoke.status, revoke.body)
	}
	for _, token := range []string{tok.device, tok.tabletStaff, tok.manager} {
		path := "/api/venues/" + e.venue + "/tax-config"
		nest, goRes := call(t, http.MethodGet, e.nest+path, token, nil), call(t, http.MethodGet, goURL+path, token, nil)
		if nest.status != http.StatusUnauthorized {
			t.Errorf("nest accepted a revoked tablet: %d", nest.status)
		}
		compare(t, "revoked tablet", nest, goRes)
		compared++
	}
	t.Logf("compared %d tax-config requests (%d successful reads)", compared, ok)
	if ok < 10 {
		t.Errorf("expected at least 10 successful reads, got %d", ok)
	}
}

// pricingCase is one staff order submitted to Nest (POST /api/admin/orders,
// takeaway, so no table is involved) and priced by Go from the same database.
type pricingCase struct {
	name  string
	venue string
	lines []line
	// goOnly marks a documented difference (docs/migration/README.md, Phase
	// D1): Go refuses the request with this kind, and Nest answers nestStatus.
	goOnly     pricing.Kind
	nestStatus int
}

type line struct {
	item     string
	qty      int64
	mods     [][2]string
	expected *int64
}

func cents(v int64) *int64 { return &v }

func pricingCases(f testsupport.PricingFixture) []pricingCase {
	v, taxless := f.Venue, f.TaxlessVenue
	return []pricingCase{
		{name: "normal product", venue: v, lines: []line{{item: f.Plain, qty: 1}}},
		{name: "venue price override", venue: v, lines: []line{{item: f.Override, qty: 1}}},
		{name: "override re-enables an item", venue: v, lines: []line{{item: f.OnHere, qty: 1}}},
		{name: "one modifier", venue: v, lines: []line{{item: f.Burger, qty: 1, mods: [][2]string{{f.Size, f.Large}}}}},
		{name: "multiple modifiers, interleaved groups", venue: v, lines: []line{{item: f.Burger, qty: 1,
			mods: [][2]string{{f.Extras, f.Bacon}, {f.Size, f.Large}, {f.Extras, f.Cheese}}}}},
		{name: "zero modifier delta", venue: v, lines: []line{{item: f.Burger, qty: 1, mods: [][2]string{{f.Size, f.Small}, {f.Extras, f.Pickles}}}}},
		{name: "negative modifier delta", venue: v, lines: []line{{item: f.Burger, qty: 1, mods: [][2]string{{f.Size, f.Small}, {f.Extras, f.Sauce}}}}},
		{name: "quantity > 1, several lines", venue: v, lines: []line{
			{item: f.Burger, qty: 3, mods: [][2]string{{f.Size, f.Large}}}, {item: f.Plain, qty: 2}, {item: f.Override, qty: 4}}},
		{name: "tolerated malformed modifier data", venue: v, lines: []line{{item: f.Messy, qty: 1, mods: [][2]string{{f.MessyGroup, f.MessyOption}}}}},
		{name: "GST rounds 0.13 down", venue: v, lines: []line{{item: f.Penny, qty: 1}}},
		{name: "GST rounds 0.52 up", venue: v, lines: []line{{item: f.Four, qty: 1}}},
		{name: "GST 1.57", venue: v, lines: []line{{item: f.Twelve, qty: 1}}},
		{name: "GST 260.74", venue: v, lines: []line{{item: f.Odd, qty: 1}}},
		{name: "GST 13043.35", venue: v, lines: []line{{item: f.Big, qty: 1}}},
		{name: "GST on a mixed 11c subtotal", venue: v, lines: []line{{item: f.Penny, qty: 3}, {item: f.Four, qty: 2}}},
		{name: "GST on 23c exactly", venue: v, lines: []line{{item: f.Penny, qty: 11}, {item: f.Twelve, qty: 1}}},
		{name: "expected price matches", venue: v, lines: []line{{item: f.Burger, qty: 2, mods: [][2]string{{f.Size, f.Large}}, expected: cents(2050)}}},
		{name: "stale expected price", venue: v, lines: []line{{item: f.Burger, qty: 1, mods: [][2]string{{f.Size, f.Large}}, expected: cents(1800)}}},
		{name: "stale: client used the item price, override wins", venue: v, lines: []line{{item: f.Override, qty: 1, expected: cents(1000)}}},
		{name: "stale on some lines only", venue: v, lines: []line{
			{item: f.Plain, qty: 1, expected: cents(550)}, {item: f.Odd, qty: 1, expected: cents(1), mods: nil}, {item: f.Override, qty: 1, expected: cents(0)}}},
		{name: "stale is reported before the tax profile", venue: taxless, lines: []line{{item: f.Plain, qty: 1, expected: cents(1)}}},
		{name: "unknown modifier group", venue: v, lines: []line{{item: f.Burger, qty: 1, mods: [][2]string{{testsupport.UUID(), f.Large}}}}},
		{name: "option of another group", venue: v, lines: []line{{item: f.Burger, qty: 1, mods: [][2]string{{f.Size, f.Cheese}}}}},
		{name: "unknown option", venue: v, lines: []line{{item: f.Burger, qty: 1, mods: [][2]string{{f.Size, testsupport.UUID()}}}}},
		{name: "missing option id", venue: v, lines: []line{{item: f.Burger, qty: 1, mods: [][2]string{{f.Size, ""}}}}},
		{name: "unavailable option", venue: v, lines: []line{{item: f.Burger, qty: 1, mods: [][2]string{{f.Size, f.Small}, {f.Extras, f.Truffle}}}}},
		{name: "duplicate option", venue: v, lines: []line{{item: f.Burger, qty: 1, mods: [][2]string{{f.Size, f.Small}, {f.Size, f.Small}}}}},
		{name: "missing required group", venue: v, lines: []line{{item: f.Burger, qty: 1, mods: [][2]string{{f.Extras, f.Cheese}}}}},
		{name: "too many options in a group", venue: v, lines: []line{{item: f.Burger, qty: 1, mods: [][2]string{{f.Size, f.Small}, {f.Size, f.Large}}}}},
		{name: "too many extras", venue: v, lines: []line{{item: f.Burger, qty: 1,
			mods: [][2]string{{f.Size, f.Small}, {f.Extras, f.Cheese}, {f.Extras, f.Bacon}, {f.Extras, f.Pickles}}}}},
		{name: "modifier on an item without groups", venue: v, lines: []line{{item: f.NoGroups, qty: 1, mods: [][2]string{{f.Size, f.Large}}}}},
		{name: "unavailable item", venue: v, lines: []line{{item: f.Off, qty: 1}}},
		{name: "unavailable at this venue", venue: v, lines: []line{{item: f.OffHere, qty: 1}}},
		{name: "override belongs to another venue", venue: taxless, lines: []line{{item: f.OnHere, qty: 1}}},
		{name: "unknown item", venue: v, lines: []line{{item: testsupport.UUID(), qty: 1}}},
		{name: "deleted item", venue: v, lines: []line{{item: f.Deleted, qty: 1}}},
		{name: "another organization's item", venue: v, lines: []line{{item: f.OtherOrgItem, qty: 1}}},
		{name: "first failing line wins", venue: v, lines: []line{{item: f.Plain, qty: 1}, {item: f.Off, qty: 1}, {item: testsupport.UUID(), qty: 1}}},
		{name: "no lines", venue: v, lines: []line{}},
		{name: "unsupported tax profile", venue: taxless, lines: []line{{item: f.Plain, qty: 1}}},
		{name: "amount beyond the integer columns", venue: v, lines: []line{{item: f.Big, qty: 30000}},
			goOnly: pricing.KindAmountOutOfRange, nestStatus: 500},
		{name: "fractional stored modifier delta", venue: v, lines: []line{{item: f.Fraction, qty: 1, mods: [][2]string{{f.FractionGroup, f.HalfCent}}}},
			goOnly: pricing.KindCatalogInvalid, nestStatus: 201},
	}
}

func (c pricingCase) nestBody(venue string) map[string]any {
	items := []map[string]any{}
	for _, l := range c.lines {
		item := map[string]any{"menuItemId": l.item, "quantity": l.qty}
		if l.mods != nil {
			mods := []map[string]string{}
			for _, m := range l.mods {
				sel := map[string]string{"modifierGroupId": m[0]}
				if m[1] != "" {
					sel["optionId"] = m[1]
				}
				mods = append(mods, sel)
			}
			item["selectedModifiers"] = mods
		}
		if l.expected != nil {
			item["expectedUnitPriceCents"] = *l.expected
		}
		items = append(items, item)
	}
	return map[string]any{"venueId": venue, "serviceMode": "takeaway", "items": items,
		"idempotencyKey": "d1-parity-" + testsupport.UUID()}
}

func (c pricingCase) goLines() []pricing.LineRequest {
	var out []pricing.LineRequest
	for _, l := range c.lines {
		lr := pricing.LineRequest{MenuItemID: l.item, Quantity: l.qty, ExpectedUnitPriceCents: l.expected}
		for _, m := range l.mods {
			lr.Modifiers = append(lr.Modifiers, pricing.ModifierSelection{ModifierGroupID: m[0], OptionID: m[1]})
		}
		out = append(out, lr)
	}
	return out
}

// nestShape is the response the NestJS API gives for a Go pricing error: the
// transport mapping the canonical Go order endpoint will use.
func nestShape(err error) (int, any) {
	var pe *pricing.Error
	if !errors.As(err, &pe) {
		return 500, map[string]any{"message": "Internal server error", "statusCode": float64(500)}
	}
	body := func(status int, text string) (int, any) {
		return status, map[string]any{"message": pe.Message, "error": text, "statusCode": float64(status)}
	}
	switch pe.Kind {
	case pricing.KindInvalidRequest:
		return body(400, "Bad Request")
	case pricing.KindUnavailable:
		return body(409, "Conflict")
	case pricing.KindUnsupportedTax:
		return body(422, "Unprocessable Entity")
	case pricing.KindStalePrice:
		conflicts := []any{}
		for _, c := range pe.Conflicts {
			var m map[string]any
			b, _ := json.Marshal(c)
			_ = json.Unmarshal(b, &m)
			conflicts = append(conflicts, m)
		}
		return 409, map[string]any{"message": pe.Message, "code": pricing.StalePriceCode, "conflicts": conflicts}
	}
	return 500, map[string]any{"message": "Internal server error", "statusCode": float64(500)}
}

// pricedFromNest is the pricing Nest persisted for an accepted order.
type pricedLine struct {
	MenuItemID        string                   `json:"menuItemId"`
	MenuItemTitle     string                   `json:"menuItemTitle"`
	MenuItemCategory  string                   `json:"menuItemCategory"`
	UnitPriceCents    int64                    `json:"unitPriceCents"`
	Quantity          int64                    `json:"quantity"`
	LineTotalCents    int64                    `json:"lineTotalCents"`
	SelectedModifiers []pricing.PricedModifier `json:"selectedModifiers"`
}

type pricedOrder struct {
	ID            string       `json:"id"`
	SubtotalCents int64        `json:"subtotalCents"`
	TaxCents      int64        `json:"taxCents"`
	TotalCents    int64        `json:"totalCents"`
	Items         []pricedLine `json:"items"`
}

func sortLines(lines []pricedLine) {
	sort.SliceStable(lines, func(i, j int) bool {
		return fmt.Sprint(lines[i]) < fmt.Sprint(lines[j])
	})
}

func TestPricingParity(t *testing.T) {
	e := loadEnv(t)
	dbURL := testsupport.DisposableDatabaseURL(t)
	ctx := context.Background()
	writer, err := pgxpool.New(ctx, dbURL)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(writer.Close)
	tok := nestTokens(t, e)
	var orgID string
	if err := writer.QueryRow(ctx, `SELECT "organizationId" FROM "Venue" WHERE id = $1`, e.venue).Scan(&orgID); err != nil {
		t.Fatal(err)
	}
	f := testsupport.SeedPricingFixture(t, ctx, writer, orgID, tok.ownerID)
	// Registered after the fixture, so it runs first: orders Nest accepted
	// reference the fixture's venues.
	t.Cleanup(func() { deleteOrdersOf(t, writer, f.Venue, f.TaxlessVenue) })

	reader, err := postgres.NewPool(ctx, postgres.Options{URL: dbURL, MaxConns: 4, ReadOnly: true})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(reader.Close)
	store := venues.NewPostgresStore(reader)
	svc := pricing.NewService(pgcatalog.New(reader))

	accepted, rejected := 0, 0
	for _, c := range pricingCases(f) {
		v, found, err := store.Venue(ctx, c.venue)
		if err != nil || !found {
			t.Fatalf("%s: venue: %v", c.name, err)
		}
		quote, goErr := svc.Quote(ctx, pricing.Venue{ID: v.ID, OrganizationID: v.OrganizationID, Tax: pricing.TaxProfile{
			Currency: v.Tax.Currency, TaxJurisdiction: v.Tax.TaxJurisdiction, PricesIncludeTax: v.Tax.PricesIncludeTax}}, c.goLines())
		nest := call(t, http.MethodPost, e.nest+"/api/admin/orders", tok.staff, c.nestBody(c.venue))

		if c.goOnly != 0 {
			var pe *pricing.Error
			if !errors.As(goErr, &pe) || pe.Kind != c.goOnly || nest.status != c.nestStatus {
				t.Errorf("%s: documented difference changed: go=%v nest=%d %s", c.name, goErr, nest.status, nest.body)
			}
			if c.goOnly == pricing.KindCatalogInvalid {
				// Nest's actual behaviour: 1000 + 12.5 persisted as 1012.
				var order pricedOrder
				_ = json.Unmarshal(nest.body, &order)
				if len(order.Items) != 1 || order.Items[0].UnitPriceCents != 1012 || order.TotalCents != 1012 {
					t.Errorf("%s: Nest's truncation changed: %s", c.name, nest.body)
				}
			}
			continue
		}
		if goErr != nil {
			rejected++
			status, want := nestShape(goErr)
			var got any
			_ = json.Unmarshal(nest.body, &got)
			if nest.status != status || !reflect.DeepEqual(got, want) {
				t.Errorf("%s: nest=%d %s\n            go=%d %v", c.name, nest.status, nest.body, status, want)
			}
			continue
		}
		accepted++
		if nest.status != http.StatusCreated {
			t.Errorf("%s: go priced it (%+v) but nest answered %d %s", c.name, quote.Totals, nest.status, nest.body)
			continue
		}
		var order pricedOrder
		if err := json.Unmarshal(nest.body, &order); err != nil {
			t.Fatal(err)
		}
		goLines := []pricedLine{}
		for _, l := range quote.Lines {
			mods := l.Modifiers
			if mods == nil {
				mods = []pricing.PricedModifier{}
			}
			goLines = append(goLines, pricedLine{l.MenuItemID, l.MenuItemTitle, l.MenuItemCategory, l.UnitPriceCents,
				l.Quantity, l.LineTotalCents, mods})
		}
		for i := range order.Items {
			if order.Items[i].SelectedModifiers == nil {
				order.Items[i].SelectedModifiers = []pricing.PricedModifier{}
			}
		}
		sortLines(goLines)
		sortLines(order.Items)
		if !reflect.DeepEqual(order.Items, goLines) {
			t.Errorf("%s: lines differ\nnest=%+v\ngo=  %+v", c.name, order.Items, goLines)
		}
		if order.SubtotalCents != quote.SubtotalCents || order.TaxCents != quote.TaxCents || order.TotalCents != quote.TotalCents {
			t.Errorf("%s: totals nest=%d/%d/%d go=%d/%d/%d", c.name, order.SubtotalCents, order.TaxCents, order.TotalCents,
				quote.SubtotalCents, quote.TaxCents, quote.TotalCents)
		}
		if quote.TotalCents != quote.SubtotalCents || quote.NetCents+quote.TaxCents != quote.TotalCents {
			t.Errorf("%s: GST must be contained, not added: %+v", c.name, quote.Totals)
		}
	}
	t.Logf("%d pricing cases: %d accepted with identical cents, %d rejected identically", accepted+rejected, accepted, rejected)
}

// deleteOrdersOf removes every order Nest created at the given venues, and
// the rows that reference them, found through the database's own foreign keys.
func deleteOrdersOf(t *testing.T, db *pgxpool.Pool, venueIDs ...string) {
	ctx := context.Background()
	var orderIDs []string
	rows, err := db.Query(ctx, `SELECT id FROM "Order" WHERE "venueId" = ANY($1)`, venueIDs)
	if err == nil {
		for rows.Next() {
			var id string
			_ = rows.Scan(&id)
			orderIDs = append(orderIDs, id)
		}
		rows.Close()
	}
	var itemIDs []string
	rows, err = db.Query(ctx, `SELECT id FROM "OrderItem" WHERE "orderId" = ANY($1)`, orderIDs)
	if err == nil {
		for rows.Next() {
			var id string
			_ = rows.Scan(&id)
			itemIDs = append(itemIDs, id)
		}
		rows.Close()
	}
	deleteReferencing(t, db, "OrderItem", itemIDs)
	deleteReferencing(t, db, "Order", orderIDs)
	deleteReferencing(t, db, "Venue", venueIDs, "MenuItemVenueOverride", "Order")
	for _, q := range []struct {
		sql string
		ids []string
	}{{`DELETE FROM "OrderItem" WHERE id = ANY($1)`, itemIDs}, {`DELETE FROM "Order" WHERE id = ANY($1)`, orderIDs}} {
		if _, err := db.Exec(ctx, q.sql, q.ids); err != nil {
			t.Errorf("cleanup: %v", err)
		}
	}
}

// deleteReferencing deletes rows of every table with a foreign key to table
// whose value is in ids, except the tables named in skip.
func deleteReferencing(t *testing.T, db *pgxpool.Pool, table string, ids []string, skip ...string) {
	if len(ids) == 0 {
		return
	}
	ctx := context.Background()
	rows, err := db.Query(ctx, `
SELECT c.conrelid::regclass::text, a.attname
FROM pg_constraint c
JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
WHERE c.contype = 'f' AND c.confrelid = format('%I', $1::text)::regclass`, table)
	if err != nil {
		t.Errorf("cleanup: %v", err)
		return
	}
	type ref struct{ table, column string }
	var refs []ref
	for rows.Next() {
		var r ref
		_ = rows.Scan(&r.table, &r.column)
		refs = append(refs, r)
	}
	rows.Close()
	for _, r := range refs {
		name := strings.Trim(r.table, `"`)
		if name == "OrderItem" || slicesContains(skip, name) {
			continue
		}
		if _, err := db.Exec(ctx, fmt.Sprintf(`DELETE FROM %s WHERE %q = ANY($1)`, r.table, r.column), ids); err != nil {
			t.Errorf("cleanup %s.%s: %v", r.table, r.column, err)
		}
	}
}

func slicesContains(s []string, v string) bool {
	for _, x := range s {
		if x == v {
			return true
		}
	}
	return false
}
