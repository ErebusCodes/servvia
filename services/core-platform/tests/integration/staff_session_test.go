package integration

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"

	"servvia/services/core-platform/internal/health"
	"servvia/services/core-platform/internal/identity"
	"servvia/services/core-platform/internal/menu"
	"servvia/services/core-platform/internal/platform/postgres"
	"servvia/services/core-platform/internal/ratelimit"
	"servvia/services/core-platform/internal/server"
	"servvia/services/core-platform/internal/venues"
	"servvia/services/core-platform/tests/testsupport"
)

// Active staff and session revocation against PostgreSQL and Redis (Story
// 2.5): a deactivated or deleted staff member, and a session revoked by
// logout (the key Nest writes), are refused; a store that cannot be reached
// fails closed.
func TestStaffSessionsAgainstPostgresAndRedis(t *testing.T) {
	h := promotionsSetup(t)
	ctx := context.Background()
	pool, err := postgres.NewPool(ctx, postgres.Options{URL: testsupport.DisposableDatabaseURL(t), MaxConns: 4})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	host, port := testsupport.DisposableRedisAddr(t)
	rdb := ratelimit.NewRedisClient(host, port)
	t.Cleanup(func() { _ = rdb.Close() })

	staffID := testsupport.UUID()
	if _, err := pool.Exec(ctx, `INSERT INTO "Staff"(id,"organizationId",email,name,"passwordHash",role,"updatedAt")
		VALUES($1,$2,$1||'@example.test','Session','x','manager',now())`, staffID, h.f.Org); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if _, err := pool.Exec(context.Background(), `DELETE FROM "Staff" WHERE id = $1`, staffID); err != nil {
			t.Errorf("cleanup: %v", err)
		}
	})
	testsupport.GrantVenueAccess(t, ctx, pool, h.f.Owner, []string{staffID}, []string{h.f.Venue})

	sessions := identity.StaffSessions{Staff: identity.NewPostgresStaffStatus(pool), Revocations: identity.NewRedisSessionRevocations(rdb)}
	sid := testsupport.UUID()
	session := identity.Principal{ID: staffID, Role: "manager", OrganizationID: h.f.Org, SessionID: sid}
	tablet := identity.Principal{ID: staffID, Role: "manager", OrganizationID: h.f.Org, Kind: identity.KindTabletManager,
		VenueID: h.f.Venue, DeviceID: testsupport.UUID()}
	admit := func(name string, p identity.Principal, want bool) {
		t.Helper()
		got, err := sessions.Admit(ctx, p)
		if err != nil || got != want {
			t.Errorf("%s: admitted %v err %v, want %v", name, got, err, want)
		}
	}
	admit("active staff, live session", session, true)
	admit("active staff on a tablet", tablet, true)
	admit("unknown staff", identity.Principal{ID: testsupport.UUID(), Role: "owner", OrganizationID: h.f.Org, SessionID: sid}, false)

	// The token the HTTP check uses; the refusals below must reach it.
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	routes := server.Routes(server.Deps{
		Logger: logger, Health: health.New(pool, time.Second),
		Menu:     menu.NewHandler(menu.NewPostgresStore(pool), logger),
		Venues:   venues.NewHandler(venues.NewPostgresStore(pool), logger),
		Verifier: identity.NewVerifier(rtSecret), TabletDevices: identity.NewPostgresTabletDevices(pool),
		VenueGrants: identity.NewPostgresVenueGrants(pool), StaffSessions: sessions,
		RateLimiter: ratelimit.New(admitAll{}, 0, logger),
	})
	token, _ := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{"sub": staffID, "email": "s@example.test", "role": "manager",
		"organizationId": h.f.Org, "sid": sid, "exp": time.Now().Add(time.Minute).Unix()}).SignedString([]byte(rtSecret))
	refused := func(name string) {
		t.Helper()
		req := httptest.NewRequest(http.MethodGet, "/api/venues/"+h.f.Venue+"/checks", nil)
		req.Header.Set("Authorization", "Bearer "+token)
		rec := httptest.NewRecorder()
		routes.ServeHTTP(rec, req)
		if rec.Code != http.StatusUnauthorized || !strings.Contains(rec.Body.String(), identity.StaffSessionEndedMessage) {
			t.Errorf("%s: GET checks answered %d %s, want 401", name, rec.Code, rec.Body.String())
		}
	}

	// Logout: Nest writes the revoked-session key; the session ends.
	if err := rdb.Set(ctx, identity.RevokedSessionKeyPrefix+sid, "1", time.Minute).Err(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { rdb.Del(context.Background(), identity.RevokedSessionKeyPrefix+sid) })
	admit("logged-out session", session, false)
	admit("another session of the same staff member", identity.Principal{ID: staffID, Role: "manager",
		OrganizationID: h.f.Org, SessionID: testsupport.UUID()}, true)
	refused("logged-out session")
	if err := rdb.Del(ctx, identity.RevokedSessionKeyPrefix+sid).Err(); err != nil {
		t.Fatal(err)
	}

	// Deactivation ends every token of the staff member.
	if _, err := pool.Exec(ctx, `UPDATE "Staff" SET "isActive" = false WHERE id = $1`, staffID); err != nil {
		t.Fatal(err)
	}
	admit("deactivated staff, live session", session, false)
	admit("deactivated staff on a tablet", tablet, false)
	refused("deactivated staff")

	// Soft deletion ends them too.
	if _, err := pool.Exec(ctx, `UPDATE "Staff" SET "isActive" = true, "deletedAt" = now() WHERE id = $1`, staffID); err != nil {
		t.Fatal(err)
	}
	admit("deleted staff", session, false)

	// Stores that cannot be reached fail closed.
	closedRedis := ratelimit.NewRedisClient("127.0.0.1", 1)
	t.Cleanup(func() { _ = closedRedis.Close() })
	if ok, err := (identity.StaffSessions{Staff: identity.NewPostgresStaffStatus(pool),
		Revocations: identity.NewRedisSessionRevocations(closedRedis)}).Admit(ctx, session); ok || err == nil {
		t.Errorf("unreachable Redis: admitted %v err %v, want an error", ok, err)
	}
	closedPool, err := postgres.NewPool(ctx, postgres.Options{URL: testsupport.DisposableDatabaseURL(t), MaxConns: 1})
	if err != nil {
		t.Fatal(err)
	}
	closedPool.Close()
	if ok, err := (identity.StaffSessions{Staff: identity.NewPostgresStaffStatus(closedPool),
		Revocations: identity.NewRedisSessionRevocations(rdb)}).Admit(ctx, session); ok || err == nil {
		t.Errorf("unreachable PostgreSQL: admitted %v err %v, want an error", ok, err)
	}
}
