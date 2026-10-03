// Package config loads the Servvia Core Platform runtime configuration from
// the environment. Shared variables (DATABASE_URL, JWT_ACCESS_SECRET,
// NODE_ENV) keep the names the NestJS API already uses, so both services can
// run from one environment during the strangler migration.
package config

import (
	"errors"
	"fmt"
	"log/slog"
	"os"
	"strconv"
	"strings"
	"time"
)

// insecureDefaultSecrets mirrors apps/api/src/auth/utils/insecure-default-secret.util.ts.
// Production refuses to start with any of these checked-in values.
var insecureDefaultSecrets = map[string]struct{}{
	"verdura-local-dev-only-access-secret-32chars-min":  {},
	"verdura-local-dev-only-refresh-secret-32chars-min": {},
	"local-docker-access-secret-change-me":              {},
	"local-docker-refresh-secret-change-me":             {},
	"local-docker-service-token-change-me":              {},
	"change-me-in-production":                           {},
	"change-me-internal-service-token-32chars":          {},
}

// minSecretLength matches the NestJS Joi rule `JWT_ACCESS_SECRET: Joi.string().min(32)`.
const minSecretLength = 32

type Config struct {
	// Environment is NODE_ENV, shared with the NestJS API ("production" enables
	// the insecure-secret refusal).
	Environment string

	HTTPAddr          string
	ReadHeaderTimeout time.Duration
	ReadTimeout       time.Duration
	WriteTimeout      time.Duration
	IdleTimeout       time.Duration
	ShutdownTimeout   time.Duration

	DatabaseURL      string
	DBMaxConns       int32
	DBReadOnly       bool
	ReadinessTimeout time.Duration

	JWTAccessSecret string

	// Redis backs the rate limiter shared with the NestJS API. Same variables
	// and defaults as apps/api/src/redis/redis.module.ts.
	RedisHost string
	RedisPort int

	// TrustProxyHops is TRUST_PROXY_HOPS: how many loopback proxies' forwarded
	// addresses are believed, as in the NestJS API (config/client-ip.ts). It
	// decides the client IP in rate-limit keys.
	TrustProxyHops int

	// KitchenPollInterval is how often the kitchen projector looks for new
	// order.round_submitted events. It runs only when writes are enabled.
	KitchenPollInterval time.Duration

	// RealtimePollInterval is how often the realtime dispatcher tails the
	// DomainEvent log (Phase D12/D13). EventRetention is how long a
	// delivered event is kept before pruning (writes enabled only).
	RealtimePollInterval time.Duration
	EventRetention       time.Duration

	LogLevel slog.Level
}

func (c Config) IsProduction() bool { return c.Environment == "production" }

// Load reads configuration from the process environment.
func Load() (Config, error) { return load(os.Getenv) }

func load(getenv func(string) string) (Config, error) {
	var errs []error
	get := func(key, fallback string) string {
		if v := strings.TrimSpace(getenv(key)); v != "" {
			return v
		}
		return fallback
	}
	duration := func(key string, fallback time.Duration) time.Duration {
		raw := get(key, "")
		if raw == "" {
			return fallback
		}
		d, err := time.ParseDuration(raw)
		if err != nil || d <= 0 {
			errs = append(errs, fmt.Errorf("%s must be a positive duration such as 15s, got %q", key, raw))
			return fallback
		}
		return d
	}

	cfg := Config{
		Environment:          get("NODE_ENV", "development"),
		HTTPAddr:             get("SERVVIA_CORE_HTTP_ADDR", "127.0.0.1:3100"),
		ReadHeaderTimeout:    duration("SERVVIA_CORE_READ_HEADER_TIMEOUT", 5*time.Second),
		ReadTimeout:          duration("SERVVIA_CORE_READ_TIMEOUT", 15*time.Second),
		WriteTimeout:         duration("SERVVIA_CORE_WRITE_TIMEOUT", 30*time.Second),
		IdleTimeout:          duration("SERVVIA_CORE_IDLE_TIMEOUT", 120*time.Second),
		ShutdownTimeout:      duration("SERVVIA_CORE_SHUTDOWN_TIMEOUT", 20*time.Second),
		ReadinessTimeout:     duration("SERVVIA_CORE_READINESS_TIMEOUT", 2*time.Second),
		KitchenPollInterval:  duration("SERVVIA_CORE_KITCHEN_POLL_INTERVAL", time.Second),
		RealtimePollInterval: duration("SERVVIA_CORE_REALTIME_POLL_INTERVAL", 250*time.Millisecond),
		EventRetention:       duration("SERVVIA_CORE_EVENT_RETENTION", 7*24*time.Hour),
		DatabaseURL:          getenv("DATABASE_URL"),
		JWTAccessSecret:      getenv("JWT_ACCESS_SECRET"),
		DBReadOnly:           true,
		DBMaxConns:           10,
		RedisHost:            get("REDIS_HOST", "127.0.0.1"),
	}

	integer := func(key, fallback string, lo, hi int) int {
		raw := get(key, fallback)
		n, err := strconv.Atoi(raw)
		if err != nil || n < lo || n > hi {
			errs = append(errs, fmt.Errorf("%s must be an integer between %d and %d, got %q", key, lo, hi, raw))
			return 0
		}
		return n
	}
	cfg.RedisPort = integer("REDIS_PORT", "6379", 0, 65535)
	// Nest passes Number(TRUST_PROXY_HOPS ?? 0) to Express. A value that is
	// not a whole number is refused here rather than silently trusting no proxy.
	cfg.TrustProxyHops = integer("TRUST_PROXY_HOPS", "0", 0, 100)

	if raw := get("SERVVIA_CORE_DB_MAX_CONNS", ""); raw != "" {
		n, err := strconv.Atoi(raw)
		if err != nil || n < 1 || n > 200 {
			errs = append(errs, fmt.Errorf("SERVVIA_CORE_DB_MAX_CONNS must be an integer between 1 and 200, got %q", raw))
		} else {
			cfg.DBMaxConns = int32(n)
		}
	}

	// Read-only by default: this service owns no writes yet, and Prisma is the
	// sole schema authority. Turning it off must be an explicit decision.
	if raw := get("SERVVIA_CORE_DB_READ_ONLY", "true"); raw != "true" {
		if raw != "false" {
			errs = append(errs, fmt.Errorf("SERVVIA_CORE_DB_READ_ONLY must be true or false, got %q", raw))
		} else {
			cfg.DBReadOnly = false
		}
	}

	if err := cfg.LogLevel.UnmarshalText([]byte(get("SERVVIA_CORE_LOG_LEVEL", "info"))); err != nil {
		errs = append(errs, fmt.Errorf("SERVVIA_CORE_LOG_LEVEL: %w", err))
	}

	if cfg.DatabaseURL == "" {
		errs = append(errs, errors.New("DATABASE_URL is required"))
	}
	switch {
	case cfg.JWTAccessSecret == "":
		errs = append(errs, errors.New("JWT_ACCESS_SECRET is required"))
	case len(cfg.JWTAccessSecret) < minSecretLength:
		errs = append(errs, fmt.Errorf("JWT_ACCESS_SECRET must be at least %d characters", minSecretLength))
	}
	if cfg.IsProduction() {
		if _, insecure := insecureDefaultSecrets[cfg.JWTAccessSecret]; insecure {
			errs = append(errs, errors.New(
				"JWT_ACCESS_SECRET is still configured with a checked-in default value; refusing to start in production"))
		}
	}

	return cfg, errors.Join(errs...)
}
