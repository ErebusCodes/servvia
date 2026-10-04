// Package postgres owns the Core Platform's PostgreSQL connection pool.
//
// Prisma (apps/api/prisma) is the only schema-migration authority. This
// package never creates or alters schema. By default every session is opened
// read-only (default_transaction_read_only=on), so an accidental write fails at
// the database instead of reaching production data.
package postgres

import (
	"context"
	"fmt"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"servvia/services/core-platform/internal/config"
)

type Options struct {
	URL      string
	MaxConns int32
	ReadOnly bool
	// StatementTimeout and LockTimeout, when positive, are sent as the
	// statement_timeout and lock_timeout of every session (whole
	// milliseconds), overriding the same parameter in URL. Zero sets
	// nothing, so the session keeps the server, role or URL value.
	StatementTimeout time.Duration
	LockTimeout      time.Duration
}

// OptionsFromConfig is the single mapping from Core's configuration to its
// pool options, used by cmd/api and by the tests that check that wiring.
func OptionsFromConfig(cfg config.Config) Options {
	return Options{
		URL:              cfg.DatabaseURL,
		MaxConns:         cfg.DBMaxConns,
		ReadOnly:         cfg.DBReadOnly,
		StatementTimeout: cfg.DBStatementTimeout,
		LockTimeout:      cfg.DBLockTimeout,
	}
}

// NewPool builds the pool without connecting; connectivity is reported by Ping
// (readiness) rather than blocking startup, matching how a strangler service
// should come up while its database is briefly unavailable.
func NewPool(ctx context.Context, opts Options) (*pgxpool.Pool, error) {
	cfg, err := pgxpool.ParseConfig(opts.URL)
	if err != nil {
		return nil, fmt.Errorf("parse DATABASE_URL: %w", err)
	}
	if opts.MaxConns > 0 {
		cfg.MaxConns = opts.MaxConns
	}
	params := cfg.ConnConfig.RuntimeParams
	params["application_name"] = "servvia-core-platform"
	// Prisma stores DateTime as `timestamp without time zone` holding UTC.
	// Pin the session to UTC so any SQL that compares such columns with now()
	// behaves the same on every host (see docs/migration/README.md).
	params["timezone"] = "UTC"
	if opts.ReadOnly {
		params["default_transaction_read_only"] = "on"
	}
	// Startup parameters, so they bound every statement of every session,
	// including the readiness probe. config validates the range.
	if opts.StatementTimeout > 0 {
		params["statement_timeout"] = strconv.FormatInt(opts.StatementTimeout.Milliseconds(), 10)
	}
	if opts.LockTimeout > 0 {
		params["lock_timeout"] = strconv.FormatInt(opts.LockTimeout.Milliseconds(), 10)
	}
	return pgxpool.NewWithConfig(ctx, cfg)
}
