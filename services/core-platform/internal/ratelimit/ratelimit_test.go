package ratelimit

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/redis/go-redis/v9"
)

type call struct {
	key  string
	args []any
}

// fakeRedis answers Eval with a scripted sequence of results or errors.
type fakeRedis struct {
	replies []any // []any result or error
	calls   []call
}

func (f *fakeRedis) Eval(ctx context.Context, script string, keys []string, args ...any) *redis.Cmd {
	cmd := redis.NewCmd(ctx)
	if script != Script {
		cmd.SetErr(errors.New("unexpected script"))
		return cmd
	}
	f.calls = append(f.calls, call{keys[0], args})
	reply := f.replies[0]
	if len(f.replies) > 1 {
		f.replies = f.replies[1:]
	}
	if err, ok := reply.(error); ok {
		cmd.SetErr(err)
	} else {
		cmd.SetVal(reply)
	}
	return cmd
}

func limiter(f *fakeRedis, hops int) *Limiter {
	l := New(f, hops, slog.New(slog.NewTextHandler(io.Discard, nil)))
	l.now = func() time.Time { return time.UnixMilli(1_000_000) }
	l.sleep = func(time.Duration) {}
	return l
}

func serve(l *Limiter, rule Rule, req *http.Request) *httptest.ResponseRecorder {
	rec := httptest.NewRecorder()
	l.Middleware(rule)(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	})).ServeHTTP(rec, req)
	return rec
}

func TestKeyAndArgumentsMatchNest(t *testing.T) {
	f := &fakeRedis{replies: []any{[]any{int64(0), int64(1)}}}
	req := httptest.NewRequest("GET", "/API/Menu/venues/X/channel/order%5Ftablet?q=1", nil)
	req.RemoteAddr = "203.0.113.9:5555"
	if rec := serve(limiter(f, 0), Rule{120, 60}, req); rec.Code != 200 {
		t.Fatalf("status %d", rec.Code)
	}
	c := f.calls[0]
	// The raw path, case and escapes preserved, no query: Express's req.path.
	if want := "rate-limit:203.0.113.9:GET:/API/Menu/venues/X/channel/order%5Ftablet"; c.key != want {
		t.Errorf("key = %s, want %s", c.key, want)
	}
	if c.args[0] != "1000000" || c.args[1] != "60000" || c.args[2] != "120" || c.args[4] != "60" {
		t.Errorf("args = %v", c.args)
	}
	if m := c.args[3].(string); !strings.HasPrefix(m, "1000000-") || len(m) != len("1000000-")+7 {
		t.Errorf("member = %q", m)
	}
}

func TestRejectionMatchesNest(t *testing.T) {
	// Oldest entry 20.5 s into a 60 s window: retry after ceil(39.5) = 40 s.
	f := &fakeRedis{replies: []any{[]any{int64(1), int64(120), int64(1_000_000 - 20_500)}}}
	rec := serve(limiter(f, 0), Rule{120, 60}, httptest.NewRequest("GET", "/x", nil))
	if rec.Code != 429 || rec.Header().Get("Retry-After") != "40" ||
		rec.Body.String() != `{"statusCode":429,"message":"Too many requests, please try again later.","error":"Too Many Requests"}` {
		t.Errorf("%d %v %s", rec.Code, rec.Header(), rec.Body)
	}
	// No oldest score: the whole window. An already expired one: 1 s.
	for oldest, want := range map[int64]string{0: "60", 1_000_000 - 70_000: "1"} {
		f := &fakeRedis{replies: []any{[]any{int64(1), int64(120), oldest}}}
		if got := serve(limiter(f, 0), Rule{120, 60}, httptest.NewRequest("GET", "/x", nil)).Header().Get("Retry-After"); got != want {
			t.Errorf("oldest %d: Retry-After %s, want %s", oldest, got, want)
		}
	}
}

func TestBackendFailuresFailClosed(t *testing.T) {
	unavailable := `{"statusCode":503,"message":"Authentication is temporarily unavailable.","error":"Service Unavailable"}`
	timeout := context.DeadlineExceeded
	cases := []struct {
		name    string
		replies []any
		status  int
		calls   int
	}{
		{"one timeout, then a verdict: retried once", []any{timeout, []any{int64(0), int64(1)}}, 200, 2},
		{"two timeouts: 503", []any{timeout, timeout}, 503, 2},
		{"connection refused is transient", []any{&net.OpError{Op: "dial", Err: errors.New("connection refused")}, []any{int64(0), int64(1)}}, 200, 2},
		{"script error is not retried", []any{redis.Error(proto("ERR script failed"))}, 503, 1},
		{"malformed reply", []any{[]any{int64(0)}}, 503, 1},
	}
	for _, c := range cases {
		f := &fakeRedis{replies: c.replies}
		rec := serve(limiter(f, 0), Rule{120, 60}, httptest.NewRequest("GET", "/x", nil))
		if rec.Code != c.status || len(f.calls) != c.calls || (c.status == 503 && rec.Body.String() != unavailable) {
			t.Errorf("%s: %d after %d calls: %s", c.name, rec.Code, len(f.calls), rec.Body)
		}
		if c.calls == 2 && (f.calls[0].key != f.calls[1].key || f.calls[0].args[3] != f.calls[1].args[3]) {
			t.Errorf("%s: the retry must reuse the key, time and member", c.name)
		}
	}
}

type proto string

func (p proto) Error() string { return string(p) }
func (p proto) RedisError()   {}

func TestDefaultsForMissingMetadata(t *testing.T) {
	f := &fakeRedis{replies: []any{[]any{int64(0), int64(1)}}}
	serve(limiter(f, 0), Rule{}, httptest.NewRequest("GET", "/x", nil))
	if a := f.calls[0].args; a[1] != "900000" || a[2] != "10" || a[4] != "900" {
		t.Errorf("args = %v", a)
	}
}

func TestClientIPBelievesOnlyLoopbackProxies(t *testing.T) {
	req := httptest.NewRequest("GET", "/", nil)
	req.Header.Add("X-Forwarded-For", "198.51.100.1, 198.51.100.2")
	req.Header.Add("X-Forwarded-For", "127.0.0.2")
	// Behind loopback proxies: walk back while the hop is loopback and in budget.
	req.RemoteAddr = "127.0.0.1:1234"
	for hops, want := range map[int]string{0: "127.0.0.1", 1: "127.0.0.2", 2: "198.51.100.2", 3: "198.51.100.2", 9: "198.51.100.2"} {
		if got := ClientIP(req, hops); got != want {
			t.Errorf("loopback peer, hops %d: %s, want %s", hops, got, want)
		}
	}
	// A client that connects directly is named by its socket, whatever it sends.
	req.RemoteAddr = "10.0.0.1:1234"
	for _, hops := range []int{0, 1, 5} {
		if got := ClientIP(req, hops); got != "10.0.0.1" {
			t.Errorf("direct client, hops %d: %s", hops, got)
		}
	}
	req.RemoteAddr = "[::ffff:127.0.0.1]:80"
	if got := ClientIP(req, 1); got != "127.0.0.2" {
		t.Errorf("ipv4-mapped loopback: %s", got)
	}
	req.RemoteAddr = "[::1]:80"
	if got := ClientIP(req, 0); got != "::1" {
		t.Errorf("ipv6: %s", got)
	}
}
