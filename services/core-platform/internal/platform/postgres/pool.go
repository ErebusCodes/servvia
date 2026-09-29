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

	"github.com/jackc/pgx/v5/pgxpool"
)

type Options struct {
	URL      string
	MaxConns int32
	ReadOnly bool
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
	return pgxpool.NewWithConfig(ctx, cfg)
}
