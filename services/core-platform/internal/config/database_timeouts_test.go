package config

import (
	"strings"
	"testing"
	"time"
)

const (
	statementTimeoutKey = "SERVVIA_CORE_DB_STATEMENT_TIMEOUT"
	lockTimeoutKey      = "SERVVIA_CORE_DB_LOCK_TIMEOUT"
)

func timeoutEnv(extra map[string]string) map[string]string {
	values := map[string]string{
		"DATABASE_URL":      "postgresql://u@127.0.0.1:5432/db",
		"JWT_ACCESS_SECRET": goodSecret,
	}
	for k, v := range extra {
		values[k] = v
	}
	return values
}

func TestLoadDatabaseTimeouts(t *testing.T) {
	cases := []struct {
		name         string
		values       map[string]string
		statement    time.Duration
		lock         time.Duration
		inProduction bool
	}{
		{name: "both unset", values: map[string]string{}},
		{name: "both blank", values: map[string]string{statementTimeoutKey: "", lockTimeoutKey: "   "}},
		{name: "statement only", values: map[string]string{statementTimeoutKey: "5s"}, statement: 5 * time.Second},
		{name: "lock only", values: map[string]string{lockTimeoutKey: "750ms"}, lock: 750 * time.Millisecond},
		{name: "both set", values: map[string]string{statementTimeoutKey: "200ms", lockTimeoutKey: "100ms"},
			statement: 200 * time.Millisecond, lock: 100 * time.Millisecond},
		{name: "statement set, lock blank", values: map[string]string{statementTimeoutKey: " 1m ", lockTimeoutKey: ""},
			statement: time.Minute},
		{name: "bounds of the range", values: map[string]string{statementTimeoutKey: "1ms", lockTimeoutKey: "2147483647ms"},
			statement: time.Millisecond, lock: 2147483647 * time.Millisecond},
		{name: "unset in production", values: map[string]string{"NODE_ENV": "production"}, inProduction: true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			cfg, err := load(env(timeoutEnv(tc.values)))
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if cfg.IsProduction() != tc.inProduction {
				t.Fatalf("IsProduction = %v", cfg.IsProduction())
			}
			if cfg.DBStatementTimeout != tc.statement {
				t.Errorf("DBStatementTimeout = %v, want %v", cfg.DBStatementTimeout, tc.statement)
			}
			if cfg.DBLockTimeout != tc.lock {
				t.Errorf("DBLockTimeout = %v, want %v", cfg.DBLockTimeout, tc.lock)
			}
		})
	}
}

func TestLoadRejectsInvalidDatabaseTimeouts(t *testing.T) {
	invalid := []string{"soon", "0", "0s", "-1s", "500us", "1500us", "1.5ms", "600h", "2147483648ms", "5000", "9223372036855ms"}
	for _, key := range []string{statementTimeoutKey, lockTimeoutKey} {
		other := lockTimeoutKey
		if key == lockTimeoutKey {
			other = statementTimeoutKey
		}
		for _, raw := range invalid {
			for _, environment := range []string{"development", "production"} {
				t.Run(key+"="+raw+"/"+environment, func(t *testing.T) {
					_, err := load(env(timeoutEnv(map[string]string{key: raw, "NODE_ENV": environment})))
					if err == nil {
						t.Fatalf("%s=%q must refuse startup", key, raw)
					}
					if !strings.Contains(err.Error(), key) || !strings.Contains(err.Error(), raw) {
						t.Errorf("error must name %s and the value %q: %v", key, raw, err)
					}
					if strings.Contains(err.Error(), other) {
						t.Errorf("error must not blame %s: %v", other, err)
					}
				})
			}
		}
	}

	// Joined with Core's other configuration errors.
	_, err := load(env(map[string]string{statementTimeoutKey: "soon", lockTimeoutKey: "0"}))
	if err == nil {
		t.Fatal("expected configuration errors")
	}
	for _, want := range []string{statementTimeoutKey, lockTimeoutKey, "DATABASE_URL is required", "JWT_ACCESS_SECRET is required"} {
		if !strings.Contains(err.Error(), want) {
			t.Errorf("joined error must contain %q: %v", want, err)
		}
	}
}
