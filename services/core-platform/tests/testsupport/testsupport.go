// Package testsupport holds helpers shared by the contract, integration and
// parity suites: loading contracts/ as JSON Schema, and guarding access to a
// disposable PostgreSQL database.
package testsupport

import (
	"bytes"
	"encoding/json"
	"net"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"strconv"
	"strings"
	"testing"

	"github.com/santhosh-tekuri/jsonschema/v6"
	"gopkg.in/yaml.v3"
)

// RepoRoot is the servvia repository root.
func RepoRoot() string {
	_, file, _, _ := runtime.Caller(0)
	return filepath.Join(filepath.Dir(file), "..", "..", "..", "..")
}

// ContractPath resolves a path under contracts/.
func ContractPath(rel string) string { return filepath.Join(RepoRoot(), "contracts", rel) }

// Schema compiles the JSON Schema at `pointer` inside a contracts/ file
// (YAML OpenAPI 3.1 or JSON Schema). OpenAPI 3.1 component schemas are JSON
// Schema 2020-12, so one validator serves both. `format` is asserted.
func Schema(t *testing.T, rel, pointer string) *jsonschema.Schema {
	t.Helper()
	raw, err := os.ReadFile(ContractPath(rel))
	if err != nil {
		t.Fatalf("read contract %s: %v", rel, err)
	}
	var doc any
	if strings.HasSuffix(rel, ".json") {
		doc, err = jsonschema.UnmarshalJSON(bytes.NewReader(raw))
	} else {
		var parsed any
		if err = yaml.Unmarshal(raw, &parsed); err == nil {
			var asJSON []byte
			if asJSON, err = json.Marshal(parsed); err == nil {
				doc, err = jsonschema.UnmarshalJSON(bytes.NewReader(asJSON))
			}
		}
	}
	if err != nil {
		t.Fatalf("parse contract %s: %v", rel, err)
	}
	id := "https://contracts.servvia.test/" + rel
	c := jsonschema.NewCompiler()
	c.DefaultDraft(jsonschema.Draft2020)
	c.AssertFormat()
	if err := c.AddResource(id, doc); err != nil {
		t.Fatalf("add contract %s: %v", rel, err)
	}
	s, err := c.Compile(id + "#" + pointer)
	if err != nil {
		t.Fatalf("compile %s#%s: %v", rel, pointer, err)
	}
	return s
}

// Validate checks a JSON document (bytes) against a compiled schema.
func Validate(t *testing.T, s *jsonschema.Schema, body []byte) {
	t.Helper()
	inst, err := jsonschema.UnmarshalJSON(bytes.NewReader(body))
	if err != nil {
		t.Fatalf("response is not JSON: %v\n%s", err, body)
	}
	if err := s.Validate(inst); err != nil {
		t.Fatalf("contract violation: %v\n%s", err, body)
	}
}

// Same rule as apps/api/test/integration-setup.ts: a name that looks like
// production is refused, with no override.
var forbiddenDatabaseName = regexp.MustCompile(`(?i)(^|[_-])(prod|production|live)([_-]|$)|production`)

// DisposableDatabaseURL returns SERVVIA_CORE_TEST_DATABASE_URL, skipping the
// test when it is unset and failing when it does not point at a disposable
// local database. These suites write fixtures.
//
// The URL it returns pins the session to UTC (pgx sends an unknown URL
// parameter as a runtime parameter), so a fixture written through a plain
// pgxpool agrees with the code under test, whose pools pin UTC themselves
// (internal/platform/postgres/pool.go), on a cluster of any TimeZone.
func DisposableDatabaseURL(t *testing.T) string {
	t.Helper()
	raw := os.Getenv("SERVVIA_CORE_TEST_DATABASE_URL")
	if raw == "" {
		t.Skip("SERVVIA_CORE_TEST_DATABASE_URL is not set; skipping PostgreSQL suite")
	}
	u, err := url.Parse(raw)
	if err != nil {
		t.Fatalf("SERVVIA_CORE_TEST_DATABASE_URL is not a URL: %v", err)
	}
	name := strings.TrimPrefix(u.Path, "/")
	host := u.Hostname()
	if name == "" || forbiddenDatabaseName.MatchString(name) {
		t.Fatalf("refusing database %q: it looks like production", name)
	}
	if host != "127.0.0.1" && host != "localhost" && host != "::1" {
		t.Fatalf("refusing database host %q: tests only run against a local disposable database", host)
	}
	q := u.Query()
	if q.Get("timezone") == "" {
		q.Set("timezone", "UTC")
		u.RawQuery = q.Encode()
	}
	return u.String()
}

// DisposableRedisAddr returns SERVVIA_CORE_TEST_REDIS_ADDR (host:port),
// skipping the test when it is unset and failing when it is not local. The
// suites that use it write rate-limit keys.
func DisposableRedisAddr(t *testing.T) (host string, port int) {
	t.Helper()
	raw := os.Getenv("SERVVIA_CORE_TEST_REDIS_ADDR")
	if raw == "" {
		t.Skip("SERVVIA_CORE_TEST_REDIS_ADDR is not set; skipping Redis suite")
	}
	h, p, err := net.SplitHostPort(raw)
	if err != nil {
		t.Fatalf("SERVVIA_CORE_TEST_REDIS_ADDR must be host:port: %v", err)
	}
	if h != "127.0.0.1" && h != "localhost" && h != "::1" {
		t.Fatalf("refusing Redis host %q: tests only run against a local disposable Redis", h)
	}
	port, err = strconv.Atoi(p)
	if err != nil {
		t.Fatalf("bad Redis port %q", p)
	}
	return h, port
}
