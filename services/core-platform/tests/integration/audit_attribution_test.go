package integration

// Story 15.1: Core's AuditLog rows, written through internal/audit, name
// the actor that really acted, in the shapes PostgreSQL enforces
// (AuditLog_actor_shape_check), and a staff member acting through a
// PIN-elevated tablet is recorded with that tablet as device context.

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/jackc/pgx/v5"

	"servvia/services/core-platform/internal/audit"
	"servvia/services/core-platform/internal/health"
	"servvia/services/core-platform/internal/identity"
	"servvia/services/core-platform/internal/menu"
	"servvia/services/core-platform/internal/ratelimit"
	"servvia/services/core-platform/internal/server"
	"servvia/services/core-platform/internal/tables/tablesapi"
	"servvia/services/core-platform/internal/venues"
	"servvia/services/core-platform/tests/testsupport"
)

// auditActorColumns reads the actor columns of the one AuditLog row of a
// resource, NULL as "<null>".
func auditActorColumns(t *testing.T, h tablesHarness, resource, resourceID string) [7]string {
	t.Helper()
	var actorType string
	var cols [6]*string
	err := h.writer.QueryRow(context.Background(), `SELECT "actorType"::text, "actorId", "actorEmail", "actorRole"::text, "deviceKind", "deviceId", "systemActor"
		FROM "AuditLog" WHERE resource = $1 AND "resourceId" = $2`, resource, resourceID).
		Scan(&actorType, &cols[0], &cols[1], &cols[2], &cols[3], &cols[4], &cols[5])
	if err != nil {
		t.Fatalf("AuditLog row of %s %s: %v", resource, resourceID, err)
	}
	out := [7]string{actorType}
	for i, c := range cols {
		out[i+1] = "<null>"
		if c != nil {
			out[i+1] = *c
		}
	}
	return out
}

func TestAuditActorRowsAgainstPostgres(t *testing.T) {
	h := tablesSetup(t)
	ctx := context.Background()
	t.Cleanup(func() {
		_, _ = h.writer.Exec(context.Background(), `DELETE FROM "AuditLog" WHERE resource = 'audit_actor_test'`)
	})
	tablet := audit.Device{Kind: audit.DeviceKindTablet, ID: testsupport.UUID()}
	write := func(a audit.Actor) (string, error) {
		id := testsupport.UUID()
		return id, pgx.BeginFunc(ctx, h.pool, func(tx pgx.Tx) error {
			return audit.Write(ctx, tx, audit.Entry{OrganizationID: h.f.Org, VenueID: h.f.Venue, Actor: a,
				Action: "AUDIT_ACTOR_TEST", Resource: "audit_actor_test", ResourceID: id, After: map[string]any{"ok": true}})
		})
	}
	for _, c := range []struct {
		name  string
		actor audit.Actor
		want  [7]string
	}{
		{"staff", audit.Staff(h.f.Cashier, "waiter@example.test", "cashier", audit.Device{}),
			[7]string{"staff", h.f.Cashier, "waiter@example.test", "cashier", "<null>", "<null>", "<null>"}},
		{"staff through a tablet", audit.Staff(h.f.Cashier, "waiter@example.test", "cashier", tablet),
			[7]string{"staff", h.f.Cashier, "waiter@example.test", "cashier", audit.DeviceKindTablet, tablet.ID, "<null>"}},
		{"device", audit.ByDevice(audit.Device{Kind: "payment_adapter", ID: "adapter-1"}, ""),
			[7]string{"device", "<null>", "<null>", "<null>", "payment_adapter", "adapter-1", "<null>"}},
		{"system", audit.System("audit-actor-test"),
			[7]string{"system", "<null>", "<null>", "<null>", "<null>", "<null>", "audit-actor-test"}},
	} {
		id, err := write(c.actor)
		if err != nil {
			t.Fatalf("%s: write: %v", c.name, err)
		}
		if got := auditActorColumns(t, h, "audit_actor_test", id); got != c.want {
			t.Errorf("%s: (actorType, actorId, actorEmail, actorRole, deviceKind, deviceId, systemActor) = %v, want %v", c.name, got, c.want)
		}
	}

	// An invalid actor is refused before anything is written.
	id, err := write(audit.Actor{})
	if !errors.Is(err, audit.ErrInvalidActor) {
		t.Fatalf("zero actor: %v, want ErrInvalidActor", err)
	}
	var n int
	if err := h.writer.QueryRow(ctx, `SELECT count(*) FROM "AuditLog" WHERE "resourceId" = $1`, id).Scan(&n); err != nil || n != 0 {
		t.Fatalf("zero actor wrote %d rows (%v)", n, err)
	}

	// The database itself still refuses a device row that names a staff member.
	_, err = h.writer.Exec(ctx, `INSERT INTO "AuditLog" (id, "organizationId", "venueId", "actorType", "actorId", "actorEmail", "actorRole", "deviceKind", action, resource)
		VALUES ($1, $2, $3, 'device', $4, 'waiter@example.test', 'cashier', 'tablet_device', 'AUDIT_ACTOR_TEST', 'audit_actor_test')`,
		testsupport.UUID(), h.f.Org, h.f.Venue, h.f.Cashier)
	if code, constraint := pgCode(err); code != "23514" || constraint != "AuditLog_actor_shape_check" {
		t.Fatalf("device row naming a staff member: %v, want 23514 AuditLog_actor_shape_check", err)
	}
}

func TestStaffViaTabletAuditRowAgainstPostgres(t *testing.T) {
	h := tablesSetup(t)
	ctx := context.Background()
	const secret = "integration-secret-0123456789abcdef"
	enrollment, device := testsupport.UUID(), testsupport.UUID()
	if _, err := h.writer.Exec(ctx, `INSERT INTO "TabletEnrollment" (id, "organizationId", "venueId", "codeHash", "createdByStaffId", "expiresAt", "usedAt")
		VALUES ($1, $2, $3, 'unused', $4, now() + interval '1 hour', now())`, enrollment, h.f.Org, h.f.Venue, h.f.Owner); err != nil {
		t.Fatal(err)
	}
	if _, err := h.writer.Exec(ctx, `INSERT INTO "TabletDevice" (id, "organizationId", "venueId", "enrollmentId", label, "secretHash", status, "updatedAt")
		VALUES ($1, $2, $3, $4, 'Floor tablet', 'unused', 'active', now())`, device, h.f.Org, h.f.Venue, enrollment); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		ctx := context.Background()
		_, _ = h.writer.Exec(ctx, `DELETE FROM "TabletDevice" WHERE id = $1`, device)
		_, _ = h.writer.Exec(ctx, `DELETE FROM "TabletEnrollment" WHERE id = $1`, enrollment)
	})

	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	venueStore := venues.NewPostgresStore(h.pool)
	routes := server.Routes(server.Deps{
		Logger: logger, Health: health.New(h.pool, time.Second),
		Menu:          menu.NewHandler(menu.NewPostgresStore(h.pool), logger),
		Venues:        venues.NewHandler(venueStore, logger),
		TableSessions: tablesapi.NewHandler(h.svc, venueStore, logger),
		Verifier:      identity.NewVerifier(secret), TabletDevices: identity.NewPostgresTabletDevices(h.pool), VenueGrants: identity.NewPostgresVenueGrants(h.pool), StaffSessions: admitStaff,
		RateLimiter: ratelimit.New(admitAll{}, 0, logger),
	})
	open := func(claims jwt.MapClaims, table string) string {
		t.Helper()
		claims["exp"] = time.Now().Add(time.Minute).Unix()
		token, _ := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte(secret))
		req := httptest.NewRequest(http.MethodPost, "/api/venues/"+h.f.Venue+"/tables/"+table+"/sessions",
			strings.NewReader(`{"covers":2,"idempotencyKey":"`+key()+`"}`))
		req.Header.Set("Authorization", "Bearer "+token)
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("X-Device-Id", testsupport.UUID()) // never trusted
		rec := httptest.NewRecorder()
		routes.ServeHTTP(rec, req)
		if rec.Code != http.StatusCreated {
			t.Fatalf("open %s: %d %s", table, rec.Code, rec.Body)
		}
		var id string
		if err := h.writer.QueryRow(ctx, `SELECT id FROM "TableSession" WHERE "tableId" = $1 AND status = 'open'`, table).Scan(&id); err != nil {
			t.Fatal(err)
		}
		return id
	}

	onTablet := open(jwt.MapClaims{"sub": h.f.Cashier, "email": "waiter@example.test", "role": "cashier", "organizationId": h.f.Org,
		"venueId": h.f.Venue, "kind": "tablet_staff", "deviceId": device}, h.f.TableA)
	want := [7]string{"staff", h.f.Cashier, "waiter@example.test", "cashier", audit.DeviceKindTablet, device, "<null>"}
	if got := auditActorColumns(t, h, "table_session", onTablet); got != want {
		t.Errorf("staff through a tablet: %v, want %v", got, want)
	}

	session := open(jwt.MapClaims{"sub": h.f.Cashier, "email": "waiter@example.test", "role": "cashier", "organizationId": h.f.Org,
		"sid": testsupport.UUID()}, h.f.TableB)
	want = [7]string{"staff", h.f.Cashier, "waiter@example.test", "cashier", "<null>", "<null>", "<null>"}
	if got := auditActorColumns(t, h, "table_session", session); got != want {
		t.Errorf("staff session: %v, want %v", got, want)
	}
}
