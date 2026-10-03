// PostgreSQL integration tests. They run only when
// SERVVIA_CORE_TEST_DATABASE_URL points at a disposable local database that
// already has the Prisma schema applied (npx prisma migrate deploy). They
// insert their own fixtures through a separate writable connection and remove
// them afterwards; the code under test only ever uses the read-only pool.
package integration

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"slices"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"servvia/services/core-platform/internal/health"
	"servvia/services/core-platform/internal/identity"
	"servvia/services/core-platform/internal/menu"
	"servvia/services/core-platform/internal/platform/postgres"
	"servvia/services/core-platform/internal/ratelimit"
	"servvia/services/core-platform/internal/server"
	"servvia/services/core-platform/internal/venues"
	"servvia/services/core-platform/tests/testsupport"
)

type harness struct {
	f      testsupport.MenuFixture
	reader *pgxpool.Pool
	routes http.Handler
}

func setup(t *testing.T) harness {
	url := testsupport.DisposableDatabaseURL(t)
	ctx := context.Background()

	writer, err := pgxpool.New(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(writer.Close)
	f := testsupport.SeedMenuFixture(t, ctx, writer)

	reader, err := postgres.NewPool(ctx, postgres.Options{URL: url, MaxConns: 4, ReadOnly: true})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(reader.Close)

	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	return harness{f: f, reader: reader, routes: server.Routes(server.Deps{
		Logger:        logger,
		Health:        health.New(reader, 2*time.Second),
		Menu:          menu.NewHandler(menu.NewPostgresStore(reader), logger),
		Venues:        venues.NewHandler(venues.NewPostgresStore(reader), logger),
		Verifier:      identity.NewVerifier("integration-secret-0123456789abcdef"),
		TabletDevices: identity.NewPostgresTabletDevices(reader), VenueGrants: identity.NewPostgresVenueGrants(reader),
		// The menu suite is about PostgreSQL; the limiter has its own suite.
		RateLimiter: ratelimit.New(admitAll{}, 0, logger),
	})}
}

func (h harness) get(t *testing.T, path string) *httptest.ResponseRecorder {
	t.Helper()
	rec := httptest.NewRecorder()
	h.routes.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, path, nil))
	return rec
}

func TestPoolIsReadOnlyAndUTC(t *testing.T) {
	h := setup(t)
	ctx := context.Background()

	_, err := h.reader.Exec(ctx, `UPDATE "Venue" SET name = name WHERE id = $1`, h.f.Venue)
	var pgErr *pgconn.PgError
	if !errors.As(err, &pgErr) || pgErr.Code != "25006" {
		t.Fatalf("a write through the Core pool must fail with read_only_sql_transaction (25006), got %v", err)
	}
	var tz string
	if err := h.reader.QueryRow(ctx, `SHOW TimeZone`).Scan(&tz); err != nil || tz != "UTC" {
		t.Fatalf("session timezone = %q, %v", tz, err)
	}
}

func TestReadiness(t *testing.T) {
	h := setup(t)
	if rec := h.get(t, "/ready"); rec.Code != http.StatusOK {
		t.Fatalf("ready = %d %s", rec.Code, rec.Body.String())
	}

	dead, err := postgres.NewPool(context.Background(), postgres.Options{URL: "postgresql://nobody@127.0.0.1:1/none?connect_timeout=1", ReadOnly: true})
	if err != nil {
		t.Fatal(err)
	}
	defer dead.Close()
	rec := httptest.NewRecorder()
	health.New(dead, time.Second).Ready(rec, httptest.NewRequest(http.MethodGet, "/ready", nil))
	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("ready with an unreachable database = %d", rec.Code)
	}
}

type menuBody struct {
	Categories []struct {
		ID string `json:"id"`
	} `json:"categories"`
	MenuItems []map[string]json.RawMessage `json:"menuItems"`
}

func (h harness) menu(t *testing.T, channel string) menuBody {
	t.Helper()
	rec := h.get(t, "/api/menu/venues/"+h.f.Venue+"/channel/"+channel)
	if rec.Code != http.StatusOK {
		t.Fatalf("%s: %d %s", channel, rec.Code, rec.Body.String())
	}
	testsupport.Validate(t, testsupport.Schema(t, "openapi/menu-read.yaml", "/components/schemas/ChannelMenuResponse"), rec.Body.Bytes())
	var b menuBody
	if err := json.Unmarshal(rec.Body.Bytes(), &b); err != nil {
		t.Fatal(err)
	}
	return b
}

func itemIDs(b menuBody) []string {
	var ids []string
	for _, it := range b.MenuItems {
		var id string
		_ = json.Unmarshal(it["id"], &id)
		ids = append(ids, id)
	}
	return ids
}

func TestChannelMenuAgainstPostgres(t *testing.T) {
	h := setup(t)
	f := h.f

	tablet := h.menu(t, "order_tablet")
	if got, want := itemIDs(tablet), []string{f.CatGated, f.Price, f.ReEnabled, f.DisabledByOverride, f.WithPLU}; !slices.Equal(got, want) {
		t.Errorf("order_tablet items (sortOrder, then id):\n got %v\nwant %v", got, want)
	}
	if got := len(tablet.Categories); got != 2 || tablet.Categories[0].ID != f.TabletOnlyCat || tablet.Categories[1].ID != f.VisibleCat {
		t.Errorf("order_tablet categories = %+v", tablet.Categories)
	}

	for _, channel := range []string{"customer_website", "window_display"} {
		b := h.menu(t, channel)
		if got, want := itemIDs(b), []string{f.Price, f.ReEnabled, f.WithPLU}; !slices.Equal(got, want) {
			t.Errorf("%s items:\n got %v\nwant %v", channel, got, want)
		}
		if len(b.Categories) != 1 || b.Categories[0].ID != f.VisibleCat {
			t.Errorf("%s categories = %+v", channel, b.Categories)
		}
	}

	for _, it := range tablet.MenuItems {
		if _, leaked := it["posProductCode"]; leaked {
			t.Error("posProductCode must never appear on the wire")
		}
		var id string
		_ = json.Unmarshal(it["id"], &id)
		switch id {
		case f.Price:
			if string(it["priceCents"]) != "1500" {
				t.Errorf("override price = %s", it["priceCents"])
			}
		case f.DisabledByOverride:
			if string(it["isAvailable"]) != "false" {
				t.Errorf("override availability = %s", it["isAvailable"])
			}
		}
	}
}

func TestChannelMenuVenueErrorsAgainstPostgres(t *testing.T) {
	h := setup(t)
	for path, want := range map[string]string{
		"/api/menu/venues/" + h.f.InactiveVenue + "/channel/order_tablet":  `{"message":"Venue not found","error":"Not Found","statusCode":404}`,
		"/api/menu/venues/" + testsupport.UUID() + "/channel/order_tablet": `{"message":"Venue not found","error":"Not Found","statusCode":404}`,
	} {
		if rec := h.get(t, path); rec.Code != 404 || rec.Body.String() != want {
			t.Errorf("%s: %d %s", path, rec.Code, rec.Body.String())
		}
	}
}
