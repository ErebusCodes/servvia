package contract

// Table sessions are new Servvia-native behaviour with no NestJS equivalent,
// so they are tested against the written contract
// (contracts/openapi/table-sessions.yaml), not for Nest parity. The
// repository here is in memory; the database guarantees are tested in
// tests/integration.

import (
	"bytes"
	"encoding/json"
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
	"servvia/services/core-platform/internal/ratelimit"
	"servvia/services/core-platform/internal/server"
	"servvia/services/core-platform/internal/tables"
	"servvia/services/core-platform/internal/tables/tablesapi"
	"servvia/services/core-platform/internal/venues"
	"servvia/services/core-platform/tests/testsupport"
)

const (
	tableA        = "a0000000-0000-4000-8000-00000000000a"
	tableB        = "b0000000-0000-4000-8000-00000000000b"
	inactiveTable = "c0000000-0000-4000-8000-00000000000c"
	busyTable     = "d0000000-0000-4000-8000-00000000000d"
	otherVenue    = "90000000-0000-4000-8000-000000000009"
)

func sessionRoutes(writable bool) http.Handler {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	mem := testsupport.NewMemoryTableSessions(
		testsupport.MemoryTable{ID: tableA, VenueID: venueID, OrganizationID: orgID, Number: "1", Active: true, SortOrder: 1},
		testsupport.MemoryTable{ID: tableB, VenueID: venueID, OrganizationID: orgID, Number: "2", Active: true, SortOrder: 2},
		testsupport.MemoryTable{ID: inactiveTable, VenueID: venueID, OrganizationID: orgID, Number: "3"},
		testsupport.MemoryTable{ID: busyTable, VenueID: venueID, OrganizationID: orgID, Number: "4", Active: true, LegacyActiveOrder: true},
	)
	return server.Routes(server.Deps{
		Logger:        logger,
		Health:        health.New(okPinger{}, time.Second),
		Menu:          menu.NewHandler(staticStore{}, logger),
		Venues:        venues.NewHandler(venueStore{}, logger),
		TableSessions: tablesapi.NewHandler(tables.NewService(mem, writable), venueStore{}, logger),
		Verifier:      identity.NewVerifier(secret),
		TabletDevices: activeDevices{},
		RateLimiter:   ratelimit.New(admit, 0, logger),
	})
}

func signed(t *testing.T, c jwt.MapClaims) string {
	t.Helper()
	s, err := jwt.NewWithClaims(jwt.SigningMethodHS256, c).SignedString([]byte(secret))
	if err != nil {
		t.Fatal(err)
	}
	return s
}

// staffWithRole is a staff login session with the given role.
func staffWithRole(t *testing.T, role string) string {
	c := nestShapedClaims()["staff"]
	c["role"] = role
	return signed(t, c)
}

type exchange struct {
	status int
	body   []byte
	json   map[string]any
}

func do(t *testing.T, h http.Handler, method, path, token string, body any) exchange {
	t.Helper()
	var reader io.Reader
	switch b := body.(type) {
	case nil:
	case string:
		reader = strings.NewReader(b)
	default:
		raw, _ := json.Marshal(b)
		reader = bytes.NewReader(raw)
	}
	req := httptest.NewRequest(method, path, reader)
	req.Header.Set("Content-Type", "application/json")
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	var m map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &m)
	return exchange{rec.Code, rec.Body.Bytes(), m}
}

func sessionSchema(t *testing.T, name string) func([]byte) {
	s := testsupport.Schema(t, "openapi/table-sessions.yaml", "/components/schemas/"+name)
	return func(b []byte) { t.Helper(); testsupport.Validate(t, s, b) }
}

func base(venue string) string { return "/api/venues/" + venue }

func TestTableSessionAuthorization(t *testing.T) {
	h := sessionRoutes(true)
	claims := nestShapedClaims()
	nestErr := sessionSchema(t, "NestError")
	list := base(venueID) + "/table-sessions"

	cases := map[string]struct {
		token  string
		path   string
		status int
	}{
		"owner session":              {signed(t, claims["staff"]), list, 200},
		"admin":                      {staffWithRole(t, "admin"), list, 200},
		"manager":                    {staffWithRole(t, "manager"), list, 200},
		"cashier (waiter)":           {staffWithRole(t, "cashier"), list, 200},
		"tablet elevated (staff)":    {signed(t, claims["tablet_staff"]), list, 200},
		"tablet manager step-up":     {signed(t, claims["tablet_manager"]), list, 200},
		"kitchen staff":              {staffWithRole(t, "kitchen"), list, 403},
		"viewer staff":               {staffWithRole(t, "viewer"), list, 403},
		"KDS device":                 {signed(t, claims["kds_device"]), list, 403},
		"customer-mode tablet":       {signed(t, claims["tablet_device"]), list, 403},
		"no token (kiosk)":           {"", list, 401},
		"tablet, another venue":      {signed(t, claims["tablet_staff"]), base(otherVenue) + "/table-sessions", 403},
		"staff, another org's venue": {signed(t, claims["staff"]), base(otherVenue) + "/table-sessions", 404},
	}
	for name, c := range cases {
		res := do(t, h, "GET", c.path, c.token, nil)
		if res.status != c.status {
			t.Errorf("%s: %d %s", name, res.status, res.body)
			continue
		}
		if c.status != 200 {
			nestErr(res.body)
		}
	}
	// Device tokens are refused on every operation, including writes.
	kds := signed(t, claims["kds_device"])
	if res := do(t, h, "POST", base(venueID)+"/tables/"+tableA+"/sessions", kds,
		map[string]any{"covers": 2, "idempotencyKey": testsupport.UUID()}); res.status != 403 {
		t.Errorf("KDS open: %d", res.status)
	}
}

func TestTableSessionLifecycleMatchesContract(t *testing.T) {
	h := sessionRoutes(true)
	staff := signed(t, nestShapedClaims()["staff"])
	session, coded := sessionSchema(t, "TableSession"), sessionSchema(t, "CodedError")
	open := base(venueID) + "/tables/" + tableA + "/sessions"
	key := testsupport.UUID()

	first := do(t, h, "POST", open, staff, map[string]any{"covers": 4, "idempotencyKey": key})
	if first.status != 201 {
		t.Fatalf("open: %d %s", first.status, first.body)
	}
	session(first.body)
	id := first.json["id"].(string)
	if first.json["status"] != "open" || first.json["covers"] != 4.0 || first.json["version"] != 1.0 ||
		first.json["closedAt"] != nil || first.json["openedByStaffId"] != staffID || first.json["tableNumber"] != "1" {
		t.Errorf("opened session %s", first.body)
	}

	// A retry of the same request returns the same session, 200.
	retry := do(t, h, "POST", open, staff, map[string]any{"covers": 4, "idempotencyKey": key})
	if retry.status != 200 || retry.json["id"] != id {
		t.Errorf("retry: %d %s", retry.status, retry.body)
	}
	// A second, different open is refused, naming the session in the way.
	dup := do(t, h, "POST", open, staff, map[string]any{"covers": 2, "idempotencyKey": testsupport.UUID()})
	if dup.status != 409 || dup.json["code"] != "TABLE_SESSION_ALREADY_OPEN" || dup.json["activeSessionId"] != id {
		t.Errorf("duplicate open: %d %s", dup.status, dup.body)
	}
	coded(dup.body)

	active := do(t, h, "GET", base(venueID)+"/tables/"+tableA+"/active-session", staff, nil)
	if active.status != 200 || active.json["id"] != id {
		t.Errorf("active: %d %s", active.status, active.body)
	}
	session(active.body)

	sessionPath := base(venueID) + "/table-sessions/" + id
	updated := do(t, h, "PATCH", sessionPath, staff, map[string]any{"covers": 6, "version": 1})
	if updated.status != 200 || updated.json["covers"] != 6.0 || updated.json["version"] != 2.0 {
		t.Errorf("update covers: %d %s", updated.status, updated.body)
	}
	session(updated.body)

	stale := do(t, h, "PATCH", sessionPath, staff, map[string]any{"covers": 3, "version": 1})
	if stale.status != 409 || stale.json["code"] != "VERSION_CONFLICT" || stale.json["currentVersion"] != 2.0 {
		t.Errorf("stale update: %d %s", stale.status, stale.body)
	}
	coded(stale.body)
	if got := do(t, h, "GET", sessionPath, staff, nil); got.json["covers"] != 6.0 {
		t.Errorf("a stale update must not overwrite: %s", got.body)
	}

	closed := do(t, h, "POST", sessionPath+"/close", staff, map[string]any{"version": 2})
	if closed.status != 200 || closed.json["status"] != "closed" || closed.json["closedAt"] == nil || closed.json["version"] != 3.0 {
		t.Errorf("close: %d %s", closed.status, closed.body)
	}
	session(closed.body)

	// A retried close (lost response) succeeds with no effect, whatever
	// version it sends (Phase D10: state-based idempotency).
	for _, version := range []int{2, 3} {
		retry := do(t, h, "POST", sessionPath+"/close", staff, map[string]any{"version": version})
		if retry.status != 200 || retry.json["status"] != "closed" || retry.json["version"] != 3.0 {
			t.Errorf("close retry (version %d): %d %s", version, retry.status, retry.body)
		}
		session(retry.body)
	}
	// Anything else on a closed session is refused.
	for _, again := range []struct{ method, path string }{{"POST", sessionPath + "/cancel"}, {"PATCH", sessionPath}} {
		res := do(t, h, again.method, again.path, staff, map[string]any{"version": 3, "covers": 2})
		if res.status != 409 || res.json["code"] != "TABLE_SESSION_NOT_OPEN" || res.json["status"] != "closed" {
			t.Errorf("%s %s after close: %d %s", again.method, again.path, res.status, res.body)
		}
		coded(res.body)
	}

	free := do(t, h, "GET", base(venueID)+"/tables/"+tableA+"/active-session", staff, nil)
	if free.status != 404 || free.json["code"] != "NO_OPEN_SESSION" {
		t.Errorf("free table: %d %s", free.status, free.body)
	}
	coded(free.body)

	// The table can be seated again; a session opened in error is cancelled.
	reopened := do(t, h, "POST", open, staff, map[string]any{"covers": 2, "idempotencyKey": testsupport.UUID()})
	if reopened.status != 201 || reopened.json["id"] == id {
		t.Fatalf("reopen: %d %s", reopened.status, reopened.body)
	}
	do(t, h, "POST", base(venueID)+"/tables/"+tableB+"/sessions", staff, map[string]any{"covers": 3, "idempotencyKey": testsupport.UUID()})
	listed := do(t, h, "GET", base(venueID)+"/table-sessions", staff, nil)
	testsupport.Validate(t, testsupport.Schema(t, "openapi/table-sessions.yaml",
		"/paths/~1venues~1{venueId}~1table-sessions/get/responses/200/content/application~1json/schema"), listed.body)
	if sessions := listed.json["sessions"].([]any); len(sessions) != 2 || sessions[0].(map[string]any)["tableNumber"] != "1" {
		t.Errorf("open sessions in table order: %s", listed.body)
	}
	cancelled := do(t, h, "POST", base(venueID)+"/table-sessions/"+reopened.json["id"].(string)+"/cancel", staff, map[string]any{"version": 1})
	if cancelled.status != 200 || cancelled.json["status"] != "cancelled" || cancelled.json["closedAt"] == nil {
		t.Errorf("cancel: %d %s", cancelled.status, cancelled.body)
	}
	// A cancelled session cannot be closed (a retried cancel is fine).
	cancelledPath := base(venueID) + "/table-sessions/" + reopened.json["id"].(string)
	if res := do(t, h, "POST", cancelledPath+"/close", staff, map[string]any{"version": 2}); res.status != 409 || res.json["code"] != "TABLE_SESSION_NOT_OPEN" {
		t.Errorf("close of a cancelled session: %d %s", res.status, res.body)
	}
	if res := do(t, h, "POST", cancelledPath+"/cancel", staff, map[string]any{"version": 1}); res.status != 200 || res.json["status"] != "cancelled" {
		t.Errorf("cancel retry: %d %s", res.status, res.body)
	}
}

func TestTableSessionErrorsMatchContract(t *testing.T) {
	h := sessionRoutes(true)
	staff := signed(t, nestShapedClaims()["staff"])
	nestErr, coded := sessionSchema(t, "NestError"), sessionSchema(t, "CodedError")
	open := base(venueID) + "/tables/" + tableA + "/sessions"
	key := testsupport.UUID()

	for name, c := range map[string]struct {
		method, path string
		body         any
		status       int
		message      string
	}{
		"covers 0":               {"POST", open, map[string]any{"covers": 0, "idempotencyKey": key}, 400, "covers must be an integer between 1 and 99"},
		"covers 100":             {"POST", open, map[string]any{"covers": 100, "idempotencyKey": key}, 400, "covers must be an integer between 1 and 99"},
		"covers 2.5":             {"POST", open, `{"covers":2.5,"idempotencyKey":"` + key + `"}`, 400, "covers must be an integer between 1 and 99"},
		"covers as string":       {"POST", open, `{"covers":"2","idempotencyKey":"` + key + `"}`, 400, "covers must be an integer between 1 and 99"},
		"covers missing":         {"POST", open, map[string]any{"idempotencyKey": key}, 400, "covers must be an integer between 1 and 99"},
		"key missing":            {"POST", open, map[string]any{"covers": 2}, 400, "idempotencyKey must be a string of 16 to 255 characters"},
		"key too short":          {"POST", open, map[string]any{"covers": 2, "idempotencyKey": "short"}, 400, "idempotencyKey must be a string of 16 to 255 characters"},
		"not JSON":               {"POST", open, "covers=2", 400, "Request body must be a JSON object"},
		"version missing":        {"POST", base(venueID) + "/table-sessions/x/close", map[string]any{}, 400, "version must be a positive integer"},
		"version 0":              {"PATCH", base(venueID) + "/table-sessions/x", map[string]any{"covers": 2, "version": 0}, 400, "version must be a positive integer"},
		"unknown table":          {"POST", base(venueID) + "/tables/nope/sessions", map[string]any{"covers": 2, "idempotencyKey": key}, 404, "Table not found"},
		"unknown session":        {"GET", base(venueID) + "/table-sessions/nope", nil, 404, "Table session not found"},
		"unknown session, close": {"POST", base(venueID) + "/table-sessions/nope/close", map[string]any{"version": 1}, 404, "Table session not found"},
		"unknown table, active":  {"GET", base(venueID) + "/tables/nope/active-session", nil, 404, "Table not found"},
	} {
		res := do(t, h, c.method, c.path, staff, c.body)
		if res.status != c.status || res.json["message"] != c.message {
			t.Errorf("%s: %d %s", name, res.status, res.body)
			continue
		}
		nestErr(res.body)
	}

	for name, c := range map[string]struct {
		table, code string
	}{
		"inactive table":            {inactiveTable, "TABLE_INACTIVE"},
		"table with a legacy order": {busyTable, "TABLE_HAS_ACTIVE_ORDER"},
	} {
		res := do(t, h, "POST", base(venueID)+"/tables/"+c.table+"/sessions", staff, map[string]any{"covers": 2, "idempotencyKey": testsupport.UUID()})
		if res.status != 409 || res.json["code"] != c.code {
			t.Errorf("%s: %d %s", name, res.status, res.body)
		}
		coded(res.body)
	}

	readOnly := sessionRoutes(false)
	res := do(t, readOnly, "POST", open, staff, map[string]any{"covers": 2, "idempotencyKey": key})
	if res.status != 503 || res.json["code"] != "TABLE_SESSION_WRITES_DISABLED" {
		t.Errorf("read-only instance: %d %s", res.status, res.body)
	}
	coded(res.body)
	if res := do(t, readOnly, "GET", base(venueID)+"/table-sessions", staff, nil); res.status != 200 {
		t.Errorf("reads must still work on a read-only instance: %d", res.status)
	}
}
