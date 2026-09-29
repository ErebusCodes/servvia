package integration

// TableSession against real PostgreSQL: the migration's invariants
// (20260929000000_table_sessions), the repository, and concurrency. These
// guarantees live in the database, so they are not tested with mocks.

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"servvia/services/core-platform/internal/health"
	"servvia/services/core-platform/internal/identity"
	"servvia/services/core-platform/internal/menu"
	"servvia/services/core-platform/internal/platform/postgres"
	"servvia/services/core-platform/internal/ratelimit"
	"servvia/services/core-platform/internal/server"
	"servvia/services/core-platform/internal/tables"
	"servvia/services/core-platform/internal/tables/pgstore"
	"servvia/services/core-platform/internal/tables/tablesapi"
	"servvia/services/core-platform/internal/venues"
	"servvia/services/core-platform/tests/testsupport"
)

type tablesHarness struct {
	f      testsupport.TablesFixture
	writer *pgxpool.Pool // fixtures and raw invariant checks
	pool   *pgxpool.Pool // the service's own read-write pool (UTC, as cmd/api opens it)
	svc    *tables.Service
}

func tablesSetup(t *testing.T) tablesHarness {
	url := testsupport.DisposableDatabaseURL(t)
	ctx := context.Background()
	writer, err := pgxpool.New(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(writer.Close)
	f := testsupport.SeedTablesFixture(t, ctx, writer)
	pool, err := postgres.NewPool(ctx, postgres.Options{URL: url, MaxConns: 32, ReadOnly: false})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	return tablesHarness{f: f, writer: writer, pool: pool, svc: tables.NewService(pgstore.New(pool), true)}
}

func (h tablesHarness) scope() tables.Scope {
	return tables.Scope{OrganizationID: h.f.Org, VenueID: h.f.Venue}
}

func (h tablesHarness) actor() tables.Actor {
	return tables.Actor{StaffID: h.f.Cashier, Email: "waiter@example.test", Role: "cashier"}
}

func key() string { return "key-" + testsupport.UUID() }

func pgCode(err error) (code, constraint string) {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		return pgErr.Code, pgErr.ConstraintName
	}
	return "", ""
}

func TestTableSessionSchemaInvariants(t *testing.T) {
	h := tablesSetup(t)
	ctx := context.Background()
	insert := func(table, status, closedAt string, covers, version int, k string) error {
		_, err := h.writer.Exec(ctx, `INSERT INTO "TableSession"(id,"tableId",status,covers,version,"openRequestKey","closedAt","updatedAt")
			VALUES($1,$2,$3::"TableSessionStatus",$4,$5,$6,`+closedAt+`,now())`, testsupport.UUID(), table, status, covers, version, k)
		return err
	}
	const open, ended = "NULL", "now()"

	if err := insert(h.f.TableA, "open", open, 2, 1, key()); err != nil {
		t.Fatalf("first open session: %v", err)
	}
	cases := []struct {
		name                     string
		err                      error
		wantCode, wantConstraint string
	}{
		{"second open session on a table", insert(h.f.TableA, "open", open, 2, 1, key()), "23505", "TableSession_one_open_per_table"},
		{"covers 0", insert(h.f.TableB, "open", open, 0, 1, key()), "23514", "TableSession_covers_range"},
		{"covers 100", insert(h.f.TableB, "open", open, 100, 1, key()), "23514", "TableSession_covers_range"},
		{"version 0", insert(h.f.TableB, "open", open, 2, 0, key()), "23514", "TableSession_version_positive"},
		{"closed without closedAt", insert(h.f.TableB, "closed", open, 2, 1, key()), "23514", "TableSession_closed_at_matches_status"},
		{"cancelled without closedAt", insert(h.f.TableB, "cancelled", open, 2, 1, key()), "23514", "TableSession_closed_at_matches_status"},
		{"open with closedAt", insert(h.f.TableB, "open", ended, 2, 1, key()), "23514", "TableSession_closed_at_matches_status"},
		{"key shorter than 16", insert(h.f.TableB, "open", open, 2, 1, "fifteen-chars-x"), "23514", "TableSession_open_request_key_length"},
		{"unknown table", insert(testsupport.UUID(), "open", open, 2, 1, key()), "23503", "TableSession_tableId_fkey"},
	}
	for _, c := range cases {
		if code, constraint := pgCode(c.err); code != c.wantCode || constraint != c.wantConstraint {
			t.Errorf("%s: got %s %s (%v), want %s %s", c.name, code, constraint, c.err, c.wantCode, c.wantConstraint)
		}
	}

	// Ended sessions do not count: a table keeps its history and one open visit.
	for i := 0; i < 3; i++ {
		if err := insert(h.f.TableA, "closed", ended, 2, 2, key()); err != nil {
			t.Errorf("closed history row %d: %v", i, err)
		}
	}
	if err := insert(h.f.TableA, "cancelled", ended, 2, 2, key()); err != nil {
		t.Errorf("cancelled history row: %v", err)
	}
	// The same key twice on one table is refused even for ended sessions.
	k := key()
	_ = insert(h.f.TableB, "closed", ended, 2, 2, k)
	if code, constraint := pgCode(insert(h.f.TableB, "closed", ended, 2, 2, k)); code != "23505" || constraint != "TableSession_tableId_openRequestKey_key" {
		t.Errorf("duplicate request key: %s %s", code, constraint)
	}
	// A table with sessions cannot be deleted from under them: the foreign
	// key is ON DELETE RESTRICT, which PostgreSQL reports as 23001.
	if code, constraint := pgCode(func() error {
		_, err := h.writer.Exec(ctx, `DELETE FROM "Table" WHERE id = $1`, h.f.TableA)
		return err
	}()); code != "23001" || constraint != "TableSession_tableId_fkey" {
		t.Errorf("deleting a table with sessions: %s %s", code, constraint)
	}
}

func TestTableSessionRepository(t *testing.T) {
	h := tablesSetup(t)
	ctx := context.Background()
	sc, actor := h.scope(), h.actor()
	k := key()

	s, created, err := h.svc.Open(ctx, tables.OpenCommand{Scope: sc, TableID: h.f.TableA, Covers: 4, RequestKey: k, Actor: actor})
	if err != nil || !created {
		t.Fatalf("open: %v %v", created, err)
	}
	if s.Status != tables.StatusOpen || s.Covers != 4 || s.Version != 1 || s.ClosedAt != nil || s.TableNumber != "1" ||
		s.VenueID != h.f.Venue || s.OpenedByStaffID == nil || *s.OpenedByStaffID != h.f.Cashier {
		t.Errorf("opened %+v", s)
	}
	if age := time.Since(s.OpenedAt); age < -time.Minute || age > time.Minute || s.OpenedAt.Location() != time.UTC {
		t.Errorf("openedAt %v must be now, in UTC", s.OpenedAt)
	}

	replay, created, err := h.svc.Open(ctx, tables.OpenCommand{Scope: sc, TableID: h.f.TableA, Covers: 9, RequestKey: k, Actor: actor})
	if err != nil || created || replay.ID != s.ID || replay.Covers != 4 {
		t.Errorf("replay: %+v %v %v", replay, created, err)
	}
	var already *tables.AlreadyOpenError
	if _, _, err := h.svc.Open(ctx, tables.OpenCommand{Scope: sc, TableID: h.f.TableA, Covers: 2, RequestKey: key(), Actor: actor}); !errors.As(err, &already) || already.SessionID != s.ID {
		t.Errorf("second open: %v", err)
	}

	for name, c := range map[string]struct {
		scope tables.Scope
		table string
		want  error
	}{
		"inactive table":         {sc, h.f.Inactive, tables.ErrTableInactive},
		"legacy active order":    {sc, h.f.Busy, tables.ErrTableHasActiveOrder},
		"table of another venue": {sc, h.f.OtherVenueTable, tables.ErrTableNotFound},
		"another org's table":    {sc, h.f.OtherOrgTable, tables.ErrTableNotFound},
		"venue of another org":   {tables.Scope{OrganizationID: h.f.Org, VenueID: h.f.OtherOrgVenue}, h.f.OtherOrgTable, tables.ErrTableNotFound},
		"unknown table":          {sc, testsupport.UUID(), tables.ErrTableNotFound},
	} {
		if _, _, err := h.svc.Open(ctx, tables.OpenCommand{Scope: c.scope, TableID: c.table, Covers: 2, RequestKey: key(), Actor: actor}); !errors.Is(err, c.want) {
			t.Errorf("%s: %v, want %v", name, err, c.want)
		}
	}
	if _, _, err := h.svc.Open(ctx, tables.OpenCommand{Scope: sc, TableID: h.f.TableB, Covers: 2, RequestKey: key(),
		Actor: tables.Actor{StaffID: testsupport.UUID(), Role: "cashier"}}); !errors.Is(err, tables.ErrUnknownActor) {
		t.Errorf("unknown staff: %v", err)
	}

	// The legacy guard lifts once the order is finished.
	if _, err := h.writer.Exec(ctx, `UPDATE "Order" SET status = 'completed' WHERE id = $1`, h.f.BusyOrder); err != nil {
		t.Fatal(err)
	}
	if _, _, err := h.svc.Open(ctx, tables.OpenCommand{Scope: sc, TableID: h.f.Busy, Covers: 2, RequestKey: key(), Actor: actor}); err != nil {
		t.Errorf("after the legacy order completed: %v", err)
	}

	// Reads are scoped.
	if got, err := h.svc.OpenForTable(ctx, sc, h.f.TableA); err != nil || got.ID != s.ID {
		t.Errorf("active: %v %v", got.ID, err)
	}
	if _, err := h.svc.OpenForTable(ctx, sc, h.f.TableB); !errors.Is(err, tables.ErrNoOpenSession) {
		t.Errorf("free table: %v", err)
	}
	if _, err := h.svc.Get(ctx, tables.Scope{OrganizationID: h.f.Org, VenueID: h.f.OtherVenue}, s.ID); !errors.Is(err, tables.ErrSessionNotFound) {
		t.Errorf("session read through another venue: %v", err)
	}
	if _, err := h.svc.Get(ctx, tables.Scope{OrganizationID: h.f.OtherOrg, VenueID: h.f.Venue}, s.ID); !errors.Is(err, tables.ErrSessionNotFound) {
		t.Errorf("session read by another org: %v", err)
	}
	if list, err := h.svc.ListOpen(ctx, sc); err != nil || len(list) != 2 || list[0].TableNumber != "1" || list[1].TableNumber != "4" {
		t.Errorf("open list: %+v %v", list, err)
	}

	// Changes: compare-and-swap on version, terminal states are terminal.
	upd, err := h.svc.UpdateCovers(ctx, sc, s.ID, 1, 6, actor)
	if err != nil || upd.Covers != 6 || upd.Version != 2 || !upd.UpdatedAt.After(s.UpdatedAt) && !upd.UpdatedAt.Equal(s.UpdatedAt) {
		t.Fatalf("update covers: %+v %v", upd, err)
	}
	var stale *tables.VersionConflictError
	if _, err := h.svc.UpdateCovers(ctx, sc, s.ID, 1, 3, actor); !errors.As(err, &stale) || stale.Current != 2 {
		t.Errorf("stale update: %v", err)
	}
	if _, err := h.svc.Close(ctx, sc, s.ID, 1, actor); !errors.As(err, &stale) {
		t.Errorf("stale close: %v", err)
	}
	if _, err := h.svc.Close(ctx, tables.Scope{OrganizationID: h.f.OtherOrg, VenueID: h.f.OtherOrgVenue}, s.ID, 2, actor); !errors.Is(err, tables.ErrSessionNotFound) {
		t.Errorf("close through another org: %v", err)
	}
	closed, err := h.svc.Close(ctx, sc, s.ID, 2, actor)
	if err != nil || closed.Status != tables.StatusClosed || closed.ClosedAt == nil || closed.Version != 3 || closed.Covers != 6 {
		t.Fatalf("close: %+v %v", closed, err)
	}
	// A retried close succeeds with no effect (Phase D10), whatever version.
	for _, v := range []int{2, 3} {
		if again, err := h.svc.Close(ctx, sc, s.ID, v, actor); err != nil || again.Version != 3 || again.Status != tables.StatusClosed {
			t.Errorf("close again (version %d): %+v %v", v, again, err)
		}
	}
	var notOpen *tables.NotOpenError
	for name, err := range map[string]error{
		"cancel closed": func() error { _, err := h.svc.Cancel(ctx, sc, s.ID, 3, actor); return err }(),
		"covers closed": func() error { _, err := h.svc.UpdateCovers(ctx, sc, s.ID, 3, 2, actor); return err }(),
	} {
		if !errors.As(err, &notOpen) || notOpen.Status != tables.StatusClosed {
			t.Errorf("%s: %v", name, err)
		}
	}
	// A replay of the original open still returns that (now closed) session.
	if again, created, err := h.svc.Open(ctx, tables.OpenCommand{Scope: sc, TableID: h.f.TableA, Covers: 4, RequestKey: k, Actor: actor}); err != nil || created || again.ID != s.ID || again.Status != tables.StatusClosed {
		t.Errorf("replay after close: %+v %v %v", again, created, err)
	}
	next, created, err := h.svc.Open(ctx, tables.OpenCommand{Scope: sc, TableID: h.f.TableA, Covers: 2, RequestKey: key(), Actor: actor})
	if err != nil || !created || next.ID == s.ID {
		t.Fatalf("reseat: %v", err)
	}
	cancelled, err := h.svc.Cancel(ctx, sc, next.ID, 1, actor)
	if err != nil || cancelled.Status != tables.StatusCancelled || cancelled.ClosedAt == nil {
		t.Errorf("cancel: %+v %v", cancelled, err)
	}

	// Every change is in the audit log, by the acting staff member.
	rows, err := h.writer.Query(ctx, `SELECT action FROM "AuditLog" WHERE resource = 'table_session' AND "resourceId" = $1
		AND "actorId" = $2 AND "venueId" = $3 ORDER BY timestamp, action`, s.ID, h.f.Cashier, h.f.Venue)
	if err != nil {
		t.Fatal(err)
	}
	var actions []string
	for rows.Next() {
		var a string
		_ = rows.Scan(&a)
		actions = append(actions, a)
	}
	rows.Close()
	if strings.Join(actions, ",") != "TABLE_SESSION_OPENED,TABLE_SESSION_COVERS_UPDATED,TABLE_SESSION_CLOSED" {
		t.Errorf("audit trail %v", actions)
	}
}

// Many devices seat the same table at the same moment: exactly one wins.
func TestConcurrentOpensLetExactlyOneWin(t *testing.T) {
	h := tablesSetup(t)
	ctx := context.Background()
	const racers = 24
	for round := 0; round < 5; round++ {
		var wg sync.WaitGroup
		start := make(chan struct{})
		results := make([]struct {
			s       tables.Session
			created bool
			err     error
		}, racers)
		for i := range results {
			wg.Add(1)
			go func(i int) {
				defer wg.Done()
				<-start
				r := &results[i]
				r.s, r.created, r.err = h.svc.Open(ctx, tables.OpenCommand{Scope: h.scope(), TableID: h.f.TableB,
					Covers: 2, RequestKey: key(), Actor: h.actor()})
			}(i)
		}
		close(start)
		wg.Wait()

		var winner string
		wins := 0
		for _, r := range results {
			if r.err == nil && r.created {
				wins++
				winner = r.s.ID
			}
		}
		if wins != 1 {
			t.Fatalf("round %d: %d opens succeeded, want exactly 1", round, wins)
		}
		for i, r := range results {
			var already *tables.AlreadyOpenError
			if r.err != nil && (!errors.As(r.err, &already) || already.SessionID != winner) {
				t.Errorf("round %d racer %d: %v", round, i, r.err)
			}
		}
		var open int
		_ = h.writer.QueryRow(ctx, `SELECT count(*) FROM "TableSession" WHERE "tableId" = $1 AND status = 'open'`, h.f.TableB).Scan(&open)
		if open != 1 {
			t.Fatalf("round %d: %d open sessions in the database", round, open)
		}
		if _, err := h.svc.Close(ctx, h.scope(), winner, 1, h.actor()); err != nil {
			t.Fatal(err)
		}
	}
}

// One device retries the same open many times at once (a flaky network):
// one session, and every attempt gets it.
func TestConcurrentRetriesOfOneOpenReturnOneSession(t *testing.T) {
	h := tablesSetup(t)
	ctx := context.Background()
	k := key()
	const racers = 24
	ids := make([]string, racers)
	created := make([]bool, racers)
	errs := make([]error, racers)
	var wg sync.WaitGroup
	start := make(chan struct{})
	for i := 0; i < racers; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			<-start
			var s tables.Session
			s, created[i], errs[i] = h.svc.Open(ctx, tables.OpenCommand{Scope: h.scope(), TableID: h.f.TableA,
				Covers: 3, RequestKey: k, Actor: h.actor()})
			ids[i] = s.ID
		}(i)
	}
	close(start)
	wg.Wait()
	creators := 0
	for i := range ids {
		if errs[i] != nil || ids[i] != ids[0] {
			t.Fatalf("attempt %d: %q %v (first %q)", i, ids[i], errs[i], ids[0])
		}
		if created[i] {
			creators++
		}
	}
	if creators != 1 {
		t.Errorf("%d attempts report creating the session, want 1", creators)
	}
	var n int
	_ = h.writer.QueryRow(ctx, `SELECT count(*) FROM "TableSession" WHERE "tableId" = $1`, h.f.TableA).Scan(&n)
	if n != 1 {
		t.Errorf("%d sessions exist, want 1", n)
	}
}

// Concurrent edits of one version: exactly one applies, the rest are refused.
func TestConcurrentChangesNeverOverwrite(t *testing.T) {
	h := tablesSetup(t)
	ctx := context.Background()
	s, _, err := h.svc.Open(ctx, tables.OpenCommand{Scope: h.scope(), TableID: h.f.TableA, Covers: 2, RequestKey: key(), Actor: h.actor()})
	if err != nil {
		t.Fatal(err)
	}
	const racers = 24
	errs := make([]error, racers)
	var wg sync.WaitGroup
	start := make(chan struct{})
	for i := 0; i < racers; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			<-start
			if i%4 == 0 {
				_, errs[i] = h.svc.Close(ctx, h.scope(), s.ID, 1, h.actor())
			} else {
				_, errs[i] = h.svc.UpdateCovers(ctx, h.scope(), s.ID, 1, 10+i, h.actor())
			}
		}(i)
	}
	close(start)
	wg.Wait()
	final, err := h.svc.Get(ctx, h.scope(), s.ID)
	if err != nil || final.Version != 2 {
		t.Fatalf("final %+v %v: version must have moved exactly once", final, err)
	}
	// Exactly one change took effect. If a close won, the other closes are
	// no-op retries of its end state (Phase D10) and every covers update was
	// refused; if a covers update won, every other change was refused.
	coversApplied, closesOK := 0, 0
	for i, err := range errs {
		var stale *tables.VersionConflictError
		var ended *tables.NotOpenError
		switch {
		case err == nil && i%4 == 0:
			closesOK++
		case err == nil:
			coversApplied++
		case errors.As(err, &stale), errors.As(err, &ended):
		default:
			t.Errorf("racer %d: %v", i, err)
		}
	}
	if final.Status == tables.StatusClosed && (coversApplied != 0 || closesOK == 0) ||
		final.Status == tables.StatusOpen && (coversApplied != 1 || closesOK != 0) {
		t.Errorf("final %s: %d covers updates and %d closes succeeded", final.Status, coversApplied, closesOK)
	}
}

// The HTTP API end to end on the real database, with a real token.
func TestTableSessionAPIAgainstPostgres(t *testing.T) {
	h := tablesSetup(t)
	const secret = "integration-secret-0123456789abcdef"
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	venueStore := venues.NewPostgresStore(h.pool)
	routes := server.Routes(server.Deps{
		Logger: logger, Health: health.New(h.pool, time.Second),
		Menu:          menu.NewHandler(menu.NewPostgresStore(h.pool), logger),
		Venues:        venues.NewHandler(venueStore, logger),
		TableSessions: tablesapi.NewHandler(h.svc, venueStore, logger),
		Verifier:      identity.NewVerifier(secret), TabletDevices: identity.NewPostgresTabletDevices(h.pool),
		RateLimiter: ratelimit.New(admitAll{}, 0, logger),
	})
	token, _ := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"sub": h.f.Cashier, "email": "waiter@example.test", "role": "cashier", "organizationId": h.f.Org,
		"exp": time.Now().Add(time.Minute).Unix(),
	}).SignedString([]byte(secret))
	req := httptest.NewRequest(http.MethodPost, "/api/venues/"+h.f.Venue+"/tables/"+h.f.TableA+"/sessions",
		strings.NewReader(`{"covers":5,"idempotencyKey":"`+key()+`"}`))
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	routes.ServeHTTP(rec, req)
	if rec.Code != http.StatusCreated {
		t.Fatalf("open: %d %s", rec.Code, rec.Body)
	}
	testsupport.Validate(t, testsupport.Schema(t, "openapi/table-sessions.yaml", "/components/schemas/TableSession"), rec.Body.Bytes())
}
