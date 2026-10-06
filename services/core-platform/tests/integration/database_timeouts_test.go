package integration

import (
	"context"
	"errors"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"servvia/services/core-platform/internal/config"
	"servvia/services/core-platform/internal/platform/postgres"
	"servvia/services/core-platform/tests/testsupport"
)

const timeoutTestSecret = "0123456789abcdef0123456789abcdef"

// withURLParams returns the database URL with extra query parameters, the way
// an operator might put them in DATABASE_URL.
func withURLParams(t *testing.T, raw string, params map[string]string) string {
	t.Helper()
	u, err := url.Parse(raw)
	if err != nil {
		t.Fatal(err)
	}
	q := u.Query()
	for k, v := range params {
		q.Set(k, v)
	}
	u.RawQuery = q.Encode()
	return u.String()
}

// corePoolFromEnv loads Core's configuration from the process environment and
// builds the pool exactly as cmd/api does.
func corePoolFromEnv(t *testing.T, ctx context.Context) *pgxpool.Pool {
	t.Helper()
	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("config.Load: %v", err)
	}
	pool, err := postgres.NewPool(ctx, postgres.OptionsFromConfig(cfg))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	return pool
}

func showSetting(t *testing.T, ctx context.Context, q interface {
	QueryRow(context.Context, string, ...any) pgx.Row
}, name string) string {
	t.Helper()
	var v string
	if err := q.QueryRow(ctx, "SHOW "+name).Scan(&v); err != nil {
		t.Fatalf("SHOW %s: %v", name, err)
	}
	return v
}

func sqlState(err error) string {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		return pgErr.Code
	}
	return ""
}

// Story 12.3a: operator-configured statement and lock timeouts bound every
// session of Core's pool, override DATABASE_URL, and a statement that exceeds
// a bound fails without committing anything.
func TestDatabaseTimeoutsBoundCoreSessions(t *testing.T) {
	baseURL := testsupport.DisposableDatabaseURL(t)
	ctx := context.Background()

	// A scratch table this test owns, created and dropped through a plain
	// connection (Core's pool never changes schema).
	admin, err := pgx.Connect(ctx, baseURL)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = admin.Close(context.Background()) })
	table := pgx.Identifier{"core_timeout_probe_" + strings.ReplaceAll(testsupport.UUID(), "-", "")}.Sanitize()
	if _, err := admin.Exec(ctx, `CREATE TABLE `+table+` (id int PRIMARY KEY, note text NOT NULL)`); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if _, err := admin.Exec(context.Background(), `DROP TABLE IF EXISTS `+table); err != nil {
			t.Errorf("cleanup: %v", err)
		}
	})
	if _, err := admin.Exec(ctx, `INSERT INTO `+table+` (id, note) VALUES (1, 'locked row')`); err != nil {
		t.Fatal(err)
	}

	// DATABASE_URL carries its own values; the variables must win.
	t.Setenv("DATABASE_URL", withURLParams(t, baseURL, map[string]string{
		"statement_timeout": "987654",
		"lock_timeout":      "876543",
	}))
	t.Setenv("JWT_ACCESS_SECRET", timeoutTestSecret)
	t.Setenv("SERVVIA_CORE_DB_READ_ONLY", "false")
	t.Setenv("SERVVIA_CORE_DB_STATEMENT_TIMEOUT", "200ms")
	t.Setenv("SERVVIA_CORE_DB_LOCK_TIMEOUT", "100ms")
	pool := corePoolFromEnv(t, ctx)

	if got := showSetting(t, ctx, pool, "statement_timeout"); got != "200ms" {
		t.Errorf("statement_timeout = %q, want 200ms", got)
	}
	if got := showSetting(t, ctx, pool, "lock_timeout"); got != "100ms" {
		t.Errorf("lock_timeout = %q, want 100ms", got)
	}
	// Existing session settings are kept.
	if got := showSetting(t, ctx, pool, "application_name"); got != "servvia-core-platform" {
		t.Errorf("application_name = %q", got)
	}
	if got := showSetting(t, ctx, pool, "TimeZone"); got != "UTC" {
		t.Errorf("TimeZone = %q", got)
	}

	noteExists := func(id int) bool {
		t.Helper()
		var n int
		if err := admin.QueryRow(ctx, `SELECT count(*) FROM `+table+` WHERE id = $1`, id).Scan(&n); err != nil {
			t.Fatal(err)
		}
		return n > 0
	}

	t.Run("statement past the bound fails with 57014 and commits nothing", func(t *testing.T) {
		tx, err := pool.Begin(ctx)
		if err != nil {
			t.Fatal(err)
		}
		defer func() { _ = tx.Rollback(context.Background()) }()
		if _, err := tx.Exec(ctx, `INSERT INTO `+table+` (id, note) VALUES (3, 'before sleep')`); err != nil {
			t.Fatal(err)
		}
		start := time.Now()
		_, err = tx.Exec(ctx, `SELECT pg_sleep(2)`)
		if code := sqlState(err); code != "57014" {
			t.Fatalf("sleep past the bound: want SQLSTATE 57014, got %v", err)
		}
		if elapsed := time.Since(start); elapsed > 1500*time.Millisecond {
			t.Errorf("statement was not cut short: %v", elapsed)
		}
		if err := tx.Commit(ctx); err == nil {
			t.Error("commit of an aborted transaction must not succeed")
		}
		if noteExists(3) {
			t.Error("a write from the timed-out transaction was committed")
		}
	})

	t.Run("lock wait past the bound fails with 55P03 and commits nothing", func(t *testing.T) {
		holder, err := pgx.Connect(ctx, baseURL)
		if err != nil {
			t.Fatal(err)
		}
		defer func() { _ = holder.Close(context.Background()) }()
		held, err := holder.Begin(ctx)
		if err != nil {
			t.Fatal(err)
		}
		defer func() { _ = held.Rollback(context.Background()) }()
		var id int
		if err := held.QueryRow(ctx, `SELECT id FROM `+table+` WHERE id = 1 FOR UPDATE`).Scan(&id); err != nil {
			t.Fatal(err)
		}

		tx, err := pool.Begin(ctx)
		if err != nil {
			t.Fatal(err)
		}
		defer func() { _ = tx.Rollback(context.Background()) }()
		if _, err := tx.Exec(ctx, `INSERT INTO `+table+` (id, note) VALUES (2, 'before lock wait')`); err != nil {
			t.Fatal(err)
		}
		start := time.Now()
		_, err = tx.Exec(ctx, `UPDATE `+table+` SET note = 'changed' WHERE id = 1`)
		elapsed := time.Since(start)
		if code := sqlState(err); code != "55P03" {
			t.Fatalf("lock wait past the bound: want SQLSTATE 55P03, got %v", err)
		}
		if elapsed < 90*time.Millisecond || elapsed > 1500*time.Millisecond {
			t.Errorf("lock wait lasted %v, want roughly the 100ms bound", elapsed)
		}
		if err := tx.Commit(ctx); err == nil {
			t.Error("commit of an aborted transaction must not succeed")
		}
		if err := held.Rollback(ctx); err != nil {
			t.Fatal(err)
		}
		if noteExists(2) {
			t.Error("a write from the timed-out transaction was committed")
		}
		var note string
		if err := admin.QueryRow(ctx, `SELECT note FROM `+table+` WHERE id = 1`).Scan(&note); err != nil {
			t.Fatal(err)
		}
		if note != "locked row" {
			t.Errorf("locked row changed to %q", note)
		}
	})

	// Every session of the pool carries the bounds, not just the first.
	t.Run("every pooled session is bounded", func(t *testing.T) {
		conns := make([]*pgxpool.Conn, 0, 3)
		defer func() {
			for _, c := range conns {
				c.Release()
			}
		}()
		pids := map[uint32]bool{}
		for i := 0; i < 3; i++ {
			c, err := pool.Acquire(ctx)
			if err != nil {
				t.Fatal(err)
			}
			conns = append(conns, c)
			pids[c.Conn().PgConn().PID()] = true
			if got := showSetting(t, ctx, c, "statement_timeout"); got != "200ms" {
				t.Errorf("session %d statement_timeout = %q", i, got)
			}
			if got := showSetting(t, ctx, c, "lock_timeout"); got != "100ms" {
				t.Errorf("session %d lock_timeout = %q", i, got)
			}
		}
		if len(pids) != 3 {
			t.Errorf("expected 3 distinct sessions, got %d", len(pids))
		}
	})
}

// Story 12.3a: with the variables unset or blank, Core sets nothing: sessions
// report the server's own values and a DATABASE_URL parameter still applies.
func TestDatabaseTimeoutsUnsetLeaveSessionsUnbounded(t *testing.T) {
	baseURL := testsupport.DisposableDatabaseURL(t)
	ctx := context.Background()

	plain, err := pgx.Connect(ctx, baseURL)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = plain.Close(context.Background()) })
	serverStatement := showSetting(t, ctx, plain, "statement_timeout")
	serverLock := showSetting(t, ctx, plain, "lock_timeout")

	t.Setenv("JWT_ACCESS_SECRET", timeoutTestSecret)
	t.Setenv("SERVVIA_CORE_DB_READ_ONLY", "true")

	t.Run("unset reports the server values", func(t *testing.T) {
		t.Setenv("DATABASE_URL", baseURL)
		t.Setenv("SERVVIA_CORE_DB_STATEMENT_TIMEOUT", "")
		t.Setenv("SERVVIA_CORE_DB_LOCK_TIMEOUT", "  ")
		pool := corePoolFromEnv(t, ctx)
		if got := showSetting(t, ctx, pool, "statement_timeout"); got != serverStatement {
			t.Errorf("statement_timeout = %q, want server value %q", got, serverStatement)
		}
		if got := showSetting(t, ctx, pool, "lock_timeout"); got != serverLock {
			t.Errorf("lock_timeout = %q, want server value %q", got, serverLock)
		}
		if got := showSetting(t, ctx, pool, "default_transaction_read_only"); got != "on" {
			t.Errorf("default_transaction_read_only = %q", got)
		}
		// On a default server (no bound) a statement longer than the bounds
		// used above still completes.
		if serverStatement == "0" {
			if _, err := pool.Exec(ctx, `SELECT pg_sleep(0.3)`); err != nil {
				t.Errorf("unbounded session cut a statement short: %v", err)
			}
		}
	})

	t.Run("unset keeps a DATABASE_URL parameter", func(t *testing.T) {
		t.Setenv("DATABASE_URL", withURLParams(t, baseURL, map[string]string{
			"statement_timeout": "4321",
			"lock_timeout":      "1234",
		}))
		t.Setenv("SERVVIA_CORE_DB_STATEMENT_TIMEOUT", "")
		t.Setenv("SERVVIA_CORE_DB_LOCK_TIMEOUT", "")
		pool := corePoolFromEnv(t, ctx)
		if got := showSetting(t, ctx, pool, "statement_timeout"); got != "4321ms" {
			t.Errorf("statement_timeout = %q, want the URL's 4321ms", got)
		}
		if got := showSetting(t, ctx, pool, "lock_timeout"); got != "1234ms" {
			t.Errorf("lock_timeout = %q, want the URL's 1234ms", got)
		}
	})

	t.Run("one variable set leaves the other bound alone", func(t *testing.T) {
		t.Setenv("DATABASE_URL", withURLParams(t, baseURL, map[string]string{"lock_timeout": "1234"}))
		t.Setenv("SERVVIA_CORE_DB_STATEMENT_TIMEOUT", "750ms")
		t.Setenv("SERVVIA_CORE_DB_LOCK_TIMEOUT", "")
		pool := corePoolFromEnv(t, ctx)
		if got := showSetting(t, ctx, pool, "statement_timeout"); got != "750ms" {
			t.Errorf("statement_timeout = %q, want 750ms", got)
		}
		if got := showSetting(t, ctx, pool, "lock_timeout"); got != "1234ms" {
			t.Errorf("lock_timeout = %q, want the URL's 1234ms", got)
		}
	})
}
