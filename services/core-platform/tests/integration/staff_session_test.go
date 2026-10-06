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

// Active staff and live sessions against PostgreSQL (Stories 2.5 and 2.8):
// a deactivated or deleted staff member, a role change, and a session that is
// logged out, expired, missing or another staff member's are refused; the
// session row is the source of truth (no cache), so a restart changes
// nothing; a database that cannot be reached fails closed.
func TestStaffSessionsAgainstPostgres(t *testing.T) {
	h := promotionsSetup(t)
	ctx := context.Background()
	pool, err := postgres.NewPool(ctx, postgres.Options{URL: testsupport.DisposableDatabaseURL(t), MaxConns: 4})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)

	staffID := testsupport.UUID()
	if _, err := pool.Exec(ctx, `INSERT INTO "Staff"(id,"organizationId",email,name,"passwordHash",role,"updatedAt")
		VALUES($1,$2,$1||'@example.test','Session','x','manager',now())`, staffID, h.f.Org); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		// StaffSession rows cascade with the staff row.
		if _, err := pool.Exec(context.Background(), `DELETE FROM "Staff" WHERE id = $1`, staffID); err != nil {
			t.Errorf("cleanup: %v", err)
		}
	})
	testsupport.GrantVenueAccess(t, ctx, pool, h.f.Owner, []string{staffID}, []string{h.f.Venue})

	// Sessions as Nest writes them: expiresAt is a UTC timestamp.
	newSession := func(owner string, expiresIn time.Duration, revoked bool) string {
		t.Helper()
		id := testsupport.UUID()
		var revokedAt any
		if revoked {
			revokedAt = time.Now().UTC()
		}
		if _, err := pool.Exec(ctx, `INSERT INTO "StaffSession"(id,"staffId","expiresAt","revokedAt") VALUES($1,$2,$3,$4)`,
			id, owner, time.Now().UTC().Add(expiresIn), revokedAt); err != nil {
			t.Fatal(err)
		}
		return id
	}
	live := newSession(staffID, time.Hour, false)
	loggedOut := newSession(staffID, time.Hour, true)
	expired := newSession(staffID, -time.Minute, false)
	othersSession := newSession(h.f.Owner, time.Hour, false)
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM "StaffSession" WHERE id = $1`, othersSession)
	})

	sessions := identity.StaffSessions{Staff: identity.NewPostgresStaffStatus(pool), Sessions: identity.NewPostgresSessions(pool)}
	principal := func(sid string) identity.Principal {
		return identity.Principal{ID: staffID, Role: "manager", OrganizationID: h.f.Org, SessionID: sid}
	}
	tablet := identity.Principal{ID: staffID, Role: "manager", OrganizationID: h.f.Org, Kind: identity.KindTabletManager,
		VenueID: h.f.Venue, DeviceID: testsupport.UUID()}
	admit := func(name string, p identity.Principal, want bool) {
		t.Helper()
		got, err := sessions.Admit(ctx, p)
		if err != nil || got != want {
			t.Errorf("%s: admitted %v err %v, want %v", name, got, err, want)
		}
	}
	admit("active staff, live session", principal(live), true)
	admit("active staff on a tablet", tablet, true)
	admit("logged-out session", principal(loggedOut), false)
	admit("expired session", principal(expired), false)
	admit("unknown session", principal(testsupport.UUID()), false)
	admit("another staff member's session", principal(othersSession), false)
	admit("unknown staff", identity.Principal{ID: testsupport.UUID(), Role: "owner", OrganizationID: h.f.Org, SessionID: live}, false)

	// Over HTTP, the refusal is the 401 Nest answers.
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	routes := server.Routes(server.Deps{
		Logger: logger, Health: health.New(pool, time.Second),
		Menu:     menu.NewHandler(menu.NewPostgresStore(pool), logger),
		Venues:   venues.NewHandler(venues.NewPostgresStore(pool), logger),
		Verifier: identity.NewVerifier(rtSecret), TabletDevices: identity.NewPostgresTabletDevices(pool),
		VenueGrants: identity.NewPostgresVenueGrants(pool), StaffSessions: sessions,
		RateLimiter: ratelimit.New(admitAll{}, 0, logger),
	})
	refused := func(name, sid string) {
		t.Helper()
		token, _ := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{"sub": staffID, "email": "s@example.test", "role": "manager",
			"organizationId": h.f.Org, "sid": sid, "exp": time.Now().Add(time.Minute).Unix()}).SignedString([]byte(rtSecret))
		req := httptest.NewRequest(http.MethodGet, "/api/venues/"+h.f.Venue+"/checks", nil)
		req.Header.Set("Authorization", "Bearer "+token)
		rec := httptest.NewRecorder()
		routes.ServeHTTP(rec, req)
		if rec.Code != http.StatusUnauthorized || !strings.Contains(rec.Body.String(), identity.StaffSessionEndedMessage) {
			t.Errorf("%s: GET checks answered %d %s, want 401", name, rec.Code, rec.Body.String())
		}
	}
	refused("logged-out session", loggedOut)
	refused("expired session", expired)

	// A restart (a new process: a new pool and store, no carried-over state)
	// sees the same revocation. Nothing is held in memory or in Redis.
	restarted, err := postgres.NewPool(ctx, postgres.Options{URL: testsupport.DisposableDatabaseURL(t), MaxConns: 2})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(restarted.Close)
	afterRestart := identity.StaffSessions{Staff: identity.NewPostgresStaffStatus(restarted), Sessions: identity.NewPostgresSessions(restarted)}
	if ok, err := afterRestart.Admit(ctx, principal(loggedOut)); ok || err != nil {
		t.Errorf("logged-out session after restart: admitted %v err %v", ok, err)
	}
	if ok, err := afterRestart.Admit(ctx, principal(live)); !ok || err != nil {
		t.Errorf("live session after restart: admitted %v err %v", ok, err)
	}

	// A role change ends tokens minted under the old role, sessions or not.
	if _, err := pool.Exec(ctx, `UPDATE "Staff" SET role = 'cashier' WHERE id = $1`, staffID); err != nil {
		t.Fatal(err)
	}
	admit("role changed since the token was minted", principal(live), false)
	admit("tablet token minted before the role change", tablet, false)
	if _, err := pool.Exec(ctx, `UPDATE "Staff" SET role = 'manager' WHERE id = $1`, staffID); err != nil {
		t.Fatal(err)
	}

	// Deactivation ends every token of the staff member.
	if _, err := pool.Exec(ctx, `UPDATE "Staff" SET "isActive" = false WHERE id = $1`, staffID); err != nil {
		t.Fatal(err)
	}
	admit("deactivated staff, live session", principal(live), false)
	admit("deactivated staff on a tablet", tablet, false)
	refused("deactivated staff", live)

	// Soft deletion ends them too.
	if _, err := pool.Exec(ctx, `UPDATE "Staff" SET "isActive" = true, "deletedAt" = now() WHERE id = $1`, staffID); err != nil {
		t.Fatal(err)
	}
	admit("deleted staff", principal(live), false)

	// A database that cannot be reached fails closed.
	closedPool, err := postgres.NewPool(ctx, postgres.Options{URL: testsupport.DisposableDatabaseURL(t), MaxConns: 1})
	if err != nil {
		t.Fatal(err)
	}
	closedPool.Close()
	for name, s := range map[string]identity.StaffSessions{
		"sessions": {Staff: identity.NewPostgresStaffStatus(pool), Sessions: identity.NewPostgresSessions(closedPool)},
		"staff":    {Staff: identity.NewPostgresStaffStatus(closedPool), Sessions: identity.NewPostgresSessions(pool)},
	} {
		if ok, err := s.Admit(ctx, principal(live)); ok || err == nil {
			t.Errorf("unreachable PostgreSQL (%s): admitted %v err %v, want an error", name, ok, err)
		}
	}
}
