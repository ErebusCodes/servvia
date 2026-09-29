package config

import (
	"fmt"
	"strings"
	"testing"
	"time"
)

const goodSecret = "0123456789abcdef0123456789abcdef"

func env(values map[string]string) func(string) string {
	return func(key string) string { return values[key] }
}

func TestLoadDefaults(t *testing.T) {
	cfg, err := load(env(map[string]string{
		"DATABASE_URL":      "postgresql://u@127.0.0.1:5432/db",
		"JWT_ACCESS_SECRET": goodSecret,
	}))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if cfg.HTTPAddr != "127.0.0.1:3100" {
		t.Errorf("HTTPAddr = %q", cfg.HTTPAddr)
	}
	if !cfg.DBReadOnly {
		t.Error("database must default to read-only")
	}
	if cfg.ReadHeaderTimeout != 5*time.Second || cfg.ShutdownTimeout != 20*time.Second {
		t.Errorf("unexpected timeouts: %+v", cfg)
	}
	if cfg.IsProduction() {
		t.Error("default environment must not be production")
	}
}

func TestLoadRejectsMissingAndShortSecrets(t *testing.T) {
	_, err := load(env(map[string]string{}))
	if err == nil || !strings.Contains(err.Error(), "DATABASE_URL is required") ||
		!strings.Contains(err.Error(), "JWT_ACCESS_SECRET is required") {
		t.Fatalf("expected both required-variable errors, got %v", err)
	}

	_, err = load(env(map[string]string{"DATABASE_URL": "x", "JWT_ACCESS_SECRET": "short"}))
	if err == nil || !strings.Contains(err.Error(), "at least 32") {
		t.Fatalf("expected minimum-length error, got %v", err)
	}
}

func TestLoadRefusesInsecureDefaultSecretOnlyInProduction(t *testing.T) {
	values := map[string]string{
		"DATABASE_URL":      "x",
		"JWT_ACCESS_SECRET": "verdura-local-dev-only-access-secret-32chars-min",
	}
	if _, err := load(env(values)); err != nil {
		t.Fatalf("development must accept the dev default: %v", err)
	}
	values["NODE_ENV"] = "production"
	if _, err := load(env(values)); err == nil || !strings.Contains(err.Error(), "checked-in default") {
		t.Fatalf("production must refuse the dev default, got %v", err)
	}
}

func TestLoadRejectsInvalidValues(t *testing.T) {
	_, err := load(env(map[string]string{
		"DATABASE_URL":                  "x",
		"JWT_ACCESS_SECRET":             goodSecret,
		"SERVVIA_CORE_READ_TIMEOUT":     "soon",
		"SERVVIA_CORE_DB_MAX_CONNS":     "0",
		"SERVVIA_CORE_DB_READ_ONLY":     "maybe",
		"SERVVIA_CORE_LOG_LEVEL":        "loud",
		"SERVVIA_CORE_SHUTDOWN_TIMEOUT": "-1s",
	}))
	if err == nil {
		t.Fatal("expected validation errors")
	}
	for _, want := range []string{"SERVVIA_CORE_READ_TIMEOUT", "SERVVIA_CORE_DB_MAX_CONNS", "SERVVIA_CORE_DB_READ_ONLY", "SERVVIA_CORE_LOG_LEVEL", "SERVVIA_CORE_SHUTDOWN_TIMEOUT"} {
		if !strings.Contains(err.Error(), want) {
			t.Errorf("missing error for %s in %v", want, err)
		}
	}
}

func TestRedisAndProxySettings(t *testing.T) {
	base := map[string]string{"DATABASE_URL": "postgres://x", "JWT_ACCESS_SECRET": strings.Repeat("s", 32)}
	env := func(extra map[string]string) func(string) string {
		return func(k string) string {
			if v, ok := extra[k]; ok {
				return v
			}
			return base[k]
		}
	}
	cfg, err := load(env(nil))
	if err != nil || cfg.RedisHost != "127.0.0.1" || cfg.RedisPort != 6379 || cfg.TrustProxyHops != 0 {
		t.Fatalf("defaults: %+v %v", cfg, err)
	}
	cfg, err = load(env(map[string]string{"REDIS_HOST": "redis", "REDIS_PORT": "6380", "TRUST_PROXY_HOPS": "1"}))
	if err != nil || cfg.RedisHost != "redis" || cfg.RedisPort != 6380 || cfg.TrustProxyHops != 1 {
		t.Fatalf("explicit: %+v %v", cfg, err)
	}
	for k, v := range map[string]string{"REDIS_PORT": "70000", "TRUST_PROXY_HOPS": "one"} {
		if _, err := load(env(map[string]string{k: v})); err == nil || !strings.Contains(err.Error(), k) {
			t.Errorf("%s=%s: err = %v", k, v, err)
		}
	}
}

// The D6 global payment-adapter secret is gone (Phase D8): adapters are
// devices with their own credentials. Setting the old variable changes
// nothing and enables nothing.
func TestNoGlobalPaymentAdapterSecret(t *testing.T) {
	cfg, err := load(env(map[string]string{"DATABASE_URL": "x", "JWT_ACCESS_SECRET": goodSecret,
		"SERVVIA_CORE_PAYMENT_ADAPTER_TOKEN": "adapter-secret-0123456789abcdef-xyz"}))
	if err != nil {
		t.Fatalf("the retired variable must be ignored: %v", err)
	}
	if strings.Contains(fmt.Sprintf("%+v", cfg), "adapter-secret") {
		t.Error("the retired adapter secret was read into the configuration")
	}
}
