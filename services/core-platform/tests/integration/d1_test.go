package integration

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"

	"servvia/services/core-platform/internal/identity"
	"servvia/services/core-platform/internal/platform/postgres"
	"servvia/services/core-platform/internal/pricing"
	"servvia/services/core-platform/internal/pricing/pgcatalog"
	"servvia/services/core-platform/internal/ratelimit"
	"servvia/services/core-platform/internal/venues"
	"servvia/services/core-platform/tests/testsupport"
)

// admitStaff admits every staff token that carries a session ID. The
// PostgreSQL and Redis stores are tested in staff_session_test.go.
var admitStaff = identity.StaffSessions{Staff: activeStaffStore{}, Sessions: activeStaffStore{}}

type activeStaffStore struct{}

func (activeStaffStore) StaffActive(context.Context, string, string) (bool, error) { return true, nil }

func (activeStaffStore) SessionLive(context.Context, string, string) (bool, error) { return true, nil }

type admitAll struct{}

func (admitAll) Eval(ctx context.Context, _ string, _ []string, _ ...any) *redis.Cmd {
	cmd := redis.NewCmd(ctx)
	cmd.SetVal([]any{int64(0), int64(1)})
	return cmd
}

// pricingSetup seeds a pricing fixture in its own organization and returns a
// read-only pool, the code under test's only connection.
func pricingSetup(t *testing.T) (testsupport.PricingFixture, *pgxpool.Pool) {
	url := testsupport.DisposableDatabaseURL(t)
	ctx := context.Background()
	writer, err := pgxpool.New(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(writer.Close)
	f := testsupport.SeedPricingFixture(t, ctx, writer, "", "")
	reader, err := postgres.NewPool(ctx, postgres.Options{URL: url, MaxConns: 4, ReadOnly: true})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(reader.Close)
	return f, reader
}

func TestVenueStoreAgainstPostgres(t *testing.T) {
	f, reader := pricingSetup(t)
	ctx := context.Background()
	store := venues.NewPostgresStore(reader)

	v, found, err := store.VenueInOrganization(ctx, f.Venue, f.Org)
	if err != nil || !found {
		t.Fatalf("venue: %v %v", found, err)
	}
	want := venues.Venue{ID: f.Venue, OrganizationID: f.Org, Name: "Pricing Fixture", Slug: f.Venue,
		Timezone: "Pacific/Auckland", IsActive: true,
		Tax: venues.TaxConfig{Currency: "NZD", Locale: "en-NZ", TaxJurisdiction: "NZ_GST", PricesIncludeTax: true}}
	if v != want {
		t.Errorf("venue = %+v\nwant   %+v", v, want)
	}
	if _, found, err := store.VenueInOrganization(ctx, f.Venue, f.OtherOrg); found || err != nil {
		t.Errorf("a venue must not be found through another organization: %v %v", found, err)
	}
	if v, found, err := store.Venue(ctx, f.TaxlessVenue); !found || err != nil || v.Tax.PricesIncludeTax {
		t.Errorf("taxless venue: %+v %v %v", v, found, err)
	}
	if _, found, err := store.Venue(ctx, "not-a-uuid"); found || err != nil {
		t.Errorf("unknown id: %v %v", found, err)
	}
	if o, found, err := store.Organization(ctx, f.Org); !found || err != nil || o.ID != f.Org || !o.IsActive {
		t.Errorf("organization: %+v %v %v", o, found, err)
	}
}

func TestPricingServiceAgainstPostgres(t *testing.T) {
	f, reader := pricingSetup(t)
	ctx := context.Background()
	store := venues.NewPostgresStore(reader)
	svc := pricing.NewService(pgcatalog.New(reader))
	venueCtx := func(id string) pricing.Venue {
		v, _, err := store.Venue(ctx, id)
		if err != nil {
			t.Fatal(err)
		}
		return pricing.Venue{ID: v.ID, OrganizationID: v.OrganizationID, Tax: pricing.TaxProfile{
			Currency: v.Tax.Currency, TaxJurisdiction: v.Tax.TaxJurisdiction, PricesIncludeTax: v.Tax.PricesIncludeTax}}
	}
	mods := func(pairs ...string) []pricing.ModifierSelection {
		var out []pricing.ModifierSelection
		for i := 0; i+1 < len(pairs); i += 2 {
			out = append(out, pricing.ModifierSelection{ModifierGroupID: pairs[i], OptionID: pairs[i+1]})
		}
		return out
	}

	q, err := svc.Quote(ctx, venueCtx(f.Venue), []pricing.LineRequest{
		{MenuItemID: f.Override, Quantity: 2},
		{MenuItemID: f.Burger, Quantity: 1, Modifiers: mods(f.Extras, f.Bacon, f.Size, f.Large)},
		{MenuItemID: f.OnHere, Quantity: 1},
		{MenuItemID: f.Messy, Quantity: 1, Modifiers: mods(f.MessyGroup, f.MessyOption)},
	})
	if err != nil {
		t.Fatal(err)
	}
	// 2 x 1250 (override) + 2350 (1800 + 300 + 250) + 2200 (re-enabled) + 1120.
	if q.SubtotalCents != 8170 || q.TaxCents != 1066 || q.TotalCents != 8170 || q.NetCents != 7104 {
		t.Errorf("totals %+v", q.Totals)
	}
	if l := q.Lines[1]; l.MenuItemTitle != "Burger" || l.MenuItemCategory != "Pricing Mains" || l.UnitPriceCents != 2350 {
		t.Errorf("burger line %+v", l)
	}

	for name, c := range map[string]struct {
		venue string
		lines []pricing.LineRequest
		kind  pricing.Kind
	}{
		"deleted item":           {f.Venue, []pricing.LineRequest{{MenuItemID: f.Deleted, Quantity: 1}}, pricing.KindInvalidRequest},
		"another org's item":     {f.Venue, []pricing.LineRequest{{MenuItemID: f.OtherOrgItem, Quantity: 1}}, pricing.KindInvalidRequest},
		"disabled at this venue": {f.Venue, []pricing.LineRequest{{MenuItemID: f.OffHere, Quantity: 1}}, pricing.KindUnavailable},
		// Overrides belong to one venue: elsewhere the item is unavailable again.
		"override of another venue": {f.TaxlessVenue, []pricing.LineRequest{{MenuItemID: f.OnHere, Quantity: 1}}, pricing.KindUnavailable},
		"unsupported tax profile":   {f.TaxlessVenue, []pricing.LineRequest{{MenuItemID: f.Plain, Quantity: 1}}, pricing.KindUnsupportedTax},
	} {
		_, err := svc.Quote(ctx, venueCtx(c.venue), c.lines)
		var pe *pricing.Error
		if !errors.As(err, &pe) || pe.Kind != c.kind {
			t.Errorf("%s: err = %v", name, err)
		}
	}
}

func TestRateLimiterAgainstRedis(t *testing.T) {
	host, port := testsupport.DisposableRedisAddr(t)
	rdb := ratelimit.NewRedisClient(host, port)
	t.Cleanup(func() { _ = rdb.Close() })
	path := "/api/integration/" + testsupport.UUID()
	key := "rate-limit:192.0.2.1:GET:" + path
	t.Cleanup(func() { rdb.Del(context.Background(), key) })

	h := ratelimit.New(rdb, 0, slog.New(slog.NewTextHandler(io.Discard, nil))).
		Middleware(ratelimit.Rule{Limit: 3, WindowSeconds: 30})(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	for i := 1; i <= 4; i++ {
		req := httptest.NewRequest("GET", path, nil)
		req.RemoteAddr = "192.0.2.1:1000"
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		want := map[bool]int{true: 200, false: 429}[i <= 3]
		if rec.Code != want {
			t.Fatalf("request %d: %d, want %d", i, rec.Code, want)
		}
		if i == 4 {
			if ra := rec.Header().Get("Retry-After"); ra != "30" && ra != "29" {
				t.Errorf("Retry-After %q", ra)
			}
		}
	}
	ctx := context.Background()
	if n, err := rdb.ZCard(ctx, key).Result(); err != nil || n != 3 {
		t.Errorf("ZCARD = %d %v: a rejected request must not consume a slot", n, err)
	}
	if ttl, err := rdb.TTL(ctx, key).Result(); err != nil || ttl <= 0 || ttl > 30*time.Second {
		t.Errorf("TTL = %v %v", ttl, err)
	}
	members, _ := rdb.ZRange(ctx, key, 0, -1).Result()
	if len(members) != 3 || !strings.Contains(members[0], "-") {
		t.Errorf("members %v", members)
	}
}

// Decision A (docs/migration/README.md): fractional modifier prices are
// invalid data, found by a read-only query, never repaired silently. The
// query must find exactly the fixture's half-cent option and nothing else of
// the fixture's catalog.
func TestFractionalModifierPriceCheck(t *testing.T) {
	f, reader := pricingSetup(t)
	raw, err := os.ReadFile(filepath.Join(testsupport.RepoRoot(), "docs", "migration", "checks", "fractional-modifier-prices.sql"))
	if err != nil {
		t.Fatal(err)
	}
	query := `SELECT "menuItemId", "optionId", "priceDeltaCents"::text FROM (` + string(raw) + `) q WHERE "organizationId" = $1`
	rows, err := reader.Query(context.Background(), query, f.Org)
	if err != nil {
		t.Fatalf("the check must run on a read-only connection: %v", err)
	}
	defer rows.Close()
	var found []string
	for rows.Next() {
		var item, option, delta string
		if err := rows.Scan(&item, &option, &delta); err != nil {
			t.Fatal(err)
		}
		found = append(found, item+"/"+option+"="+delta)
	}
	if want := f.Fraction + "/" + f.HalfCent + "=12.5"; len(found) != 1 || found[0] != want {
		t.Errorf("found %v, want [%s]", found, want)
	}
}
