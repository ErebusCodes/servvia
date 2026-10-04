package main

import (
	"context"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	"servvia/services/core-platform/internal/config"
)

// poolFromEnv loads Core's configuration from the environment and builds the
// pool the way run() does. The pool is lazy, so no database is contacted.
func poolFromEnv(t *testing.T, statement, lock string) *pgxpool.Pool {
	t.Helper()
	t.Setenv("DATABASE_URL", "postgresql://core@127.0.0.1:1/core_wiring_test")
	t.Setenv("JWT_ACCESS_SECRET", "0123456789abcdef0123456789abcdef")
	t.Setenv("SERVVIA_CORE_DB_MAX_CONNS", "7")
	t.Setenv("SERVVIA_CORE_DB_STATEMENT_TIMEOUT", statement)
	t.Setenv("SERVVIA_CORE_DB_LOCK_TIMEOUT", lock)
	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("config.Load: %v", err)
	}
	pool, err := newPool(context.Background(), cfg)
	if err != nil {
		t.Fatalf("newPool: %v", err)
	}
	t.Cleanup(pool.Close)
	return pool
}

func TestNewPoolAppliesConfiguredDatabaseTimeouts(t *testing.T) {
	pool := poolFromEnv(t, "1500ms", "2s")
	if got := pool.Config().MaxConns; got != 7 {
		t.Errorf("MaxConns = %d, want 7", got)
	}
	params := pool.Config().ConnConfig.RuntimeParams
	if got := params["statement_timeout"]; got != "1500" {
		t.Errorf("statement_timeout = %q, want 1500", got)
	}
	if got := params["lock_timeout"]; got != "2000" {
		t.Errorf("lock_timeout = %q, want 2000", got)
	}
}

func TestNewPoolLeavesUnsetDatabaseTimeoutsAlone(t *testing.T) {
	pool := poolFromEnv(t, "", "")
	if got := pool.Config().MaxConns; got != 7 {
		t.Errorf("MaxConns = %d, want 7", got)
	}
	params := pool.Config().ConnConfig.RuntimeParams
	for _, key := range []string{"statement_timeout", "lock_timeout"} {
		if v, ok := params[key]; ok {
			t.Errorf("%s must not be set when unconfigured, got %q", key, v)
		}
	}
}
