package httpx

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func echoParams(w http.ResponseWriter, r *http.Request) {
	WriteJSON(w, http.StatusOK, map[string]string{"a": r.PathValue("a"), "b": r.PathValue("b"), "raw": RawPathFrom(r)})
}

func testRouter() http.Handler {
	marker := func(h http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("X-Nest-Middleware", "1")
			h.ServeHTTP(w, r)
		})
	}
	rt := NewRouter(marker)
	rt.Nest(http.MethodGet, "/api/Things/{a}/sub/{b}", http.HandlerFunc(echoParams))
	rt.Handle("/health", http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(204) }))
	return rt
}

func get(h http.Handler, method, target string, headers ...string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, target, nil)
	for i := 0; i+1 < len(headers); i += 2 {
		req.Header.Add(headers[i], headers[i+1])
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

func TestRouterMatchesLikeExpress(t *testing.T) {
	h := testRouter()
	cases := []struct {
		method, path string
		status       int
		body         string
		middleware   bool
	}{
		{"GET", "/api/things/X/sub/Y", 200, `{"a":"X","b":"Y","raw":"/api/things/X/sub/Y"}`, true},
		// Literals ignore case; parameters keep it.
		{"GET", "/API/THINGS/Mixed/SUB/Case", 200, `{"a":"Mixed","b":"Case","raw":"/API/THINGS/Mixed/SUB/Case"}`, true},
		// One optional trailing slash.
		{"GET", "/api/things/x/sub/y/", 200, `{"a":"x","b":"y","raw":"/api/things/x/sub/y/"}`, true},
		{"GET", "/api/things/x/sub/y//", 404, `{"message":"Cannot GET /api/things/x/sub/y//","error":"Not Found","statusCode":404}`, true},
		{"GET", "/api/things//sub/y", 404, `{"message":"Cannot GET /api/things//sub/y","error":"Not Found","statusCode":404}`, true},
		// Parameters are decoded; literals are compared raw.
		{"GET", "/api/things/order%5Ftablet/sub/a%2Fb", 200, `{"a":"order_tablet","b":"a/b","raw":"/api/things/order%5Ftablet/sub/a%2Fb"}`, true},
		{"GET", "/api/%74hings/x/sub/y", 404, `{"message":"Cannot GET /api/%74hings/x/sub/y","error":"Not Found","statusCode":404}`, true},
		// HEAD uses the GET route; other methods do not.
		{"HEAD", "/api/things/x/sub/y", 200, "", true},
		{"POST", "/api/things/x/sub/y", 404, `{"message":"Cannot POST /api/things/x/sub/y","error":"Not Found","statusCode":404}`, true},
		// A segment decodeURIComponent rejects: 400 before Nest's middleware.
		{"GET", "/api/things/%E0%A4/sub/y", 400, `{"message":"Failed to decode param '%E0%A4'","error":"Bad Request","statusCode":400}`, false},
		{"GET", "/api/nothing/%C0%AF", 400, `{"message":"Failed to decode param '%C0%AF'","error":"Bad Request","statusCode":400}`, false},
		// Outside /api/ Nest's middleware does not run.
		{"GET", "/elsewhere", 404, `{"message":"Cannot GET /elsewhere","error":"Not Found","statusCode":404}`, false},
		{"GET", "/api/", 404, `{"message":"Cannot GET /api/","error":"Not Found","statusCode":404}`, false},
		{"GET", "/health", 204, "", false},
		{"GET", "/HEALTH", 404, `{"message":"Cannot GET /HEALTH","error":"Not Found","statusCode":404}`, false},
	}
	for _, c := range cases {
		rec := get(h, c.method, c.path)
		if rec.Code != c.status || (c.method != "HEAD" && rec.Body.String() != c.body) {
			t.Errorf("%s %s = %d %s, want %d %s", c.method, c.path, rec.Code, rec.Body, c.status, c.body)
		}
		if got := rec.Header().Get("X-Nest-Middleware") == "1"; got != c.middleware {
			t.Errorf("%s %s: nest middleware ran = %v, want %v", c.method, c.path, got, c.middleware)
		}
	}
}

func TestDecodeURIComponent(t *testing.T) {
	for in, want := range map[string]string{"abc": "abc", "%41": "A", "%e2%82%ac": "€", "a%20b": "a b", "%2F": "/"} {
		if got, ok := decodeURIComponent(in); !ok || got != want {
			t.Errorf("decode(%q) = %q %v", in, got, ok)
		}
	}
	// Truncated, non-hex, invalid UTF-8, overlong, surrogate.
	for _, in := range []string{"%", "%4", "%zz", "%E0%A4", "%C0%AF", "%ED%A0%80", "%FF"} {
		if _, ok := decodeURIComponent(in); ok {
			t.Errorf("decode(%q) should fail", in)
		}
	}
}

func TestCORSMatchesNest(t *testing.T) {
	h := CORS(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(299) }))

	rec := get(h, "GET", "/x", "Origin", "http://localhost:5177")
	if rec.Code != 299 || rec.Header().Get("Access-Control-Allow-Origin") != "http://localhost:5177" ||
		rec.Header().Get("Access-Control-Allow-Credentials") != "true" || rec.Header().Get("Vary") != "Origin" {
		t.Errorf("allowed origin: %d %v", rec.Code, rec.Header())
	}
	rec = get(h, "GET", "/x")
	if rec.Header().Get("Access-Control-Allow-Origin") != "" || rec.Header().Get("Access-Control-Allow-Credentials") != "true" {
		t.Errorf("no origin: %v", rec.Header())
	}
	for _, origin := range []string{"https://evil.example", "http://localhost:5178", "HTTPS://VERDURA.CO.NZ", "https://verdura.co.nz.evil.example"} {
		rec = get(h, "OPTIONS", "/x", "Origin", origin, "Access-Control-Request-Method", "POST")
		if rec.Code != 299 || len(rec.Header()) != 0 {
			t.Errorf("disallowed %s: must pass through with no CORS headers, got %d %v", origin, rec.Code, rec.Header())
		}
	}
	rec = get(h, "OPTIONS", "/anything", "Origin", "https://admin.verdura.co.nz", "Access-Control-Request-Headers", "x-csrf-token, Authorization")
	want := map[string]string{
		"Access-Control-Allow-Origin":      "https://admin.verdura.co.nz",
		"Access-Control-Allow-Credentials": "true",
		"Access-Control-Allow-Methods":     "GET,HEAD,PUT,PATCH,POST,DELETE",
		"Access-Control-Allow-Headers":     "x-csrf-token, Authorization",
		"Vary":                             "Origin, Access-Control-Request-Headers",
		"Content-Length":                   "0",
	}
	if rec.Code != 204 {
		t.Errorf("preflight status %d", rec.Code)
	}
	for k, v := range want {
		if rec.Header().Get(k) != v {
			t.Errorf("preflight %s = %q, want %q", k, rec.Header().Get(k), v)
		}
	}
}

func TestCSRFMatchesNest(t *testing.T) {
	ok := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(200) })
	h := CSRF(false)(ok)

	rec := get(h, "GET", "/api/x")
	cookie := rec.Header().Get("Set-Cookie")
	if rec.Code != 200 || !strings.HasPrefix(cookie, "csrf_token=") || !strings.HasSuffix(cookie, "; Path=/; SameSite=Strict") ||
		len(strings.TrimSuffix(strings.TrimPrefix(cookie, "csrf_token="), "; Path=/; SameSite=Strict")) != 64 {
		t.Errorf("GET without cookie: %d %q", rec.Code, cookie)
	}
	if c := get(CSRF(true)(ok), "GET", "/api/x").Header().Get("Set-Cookie"); !strings.HasSuffix(c, "; Path=/; Secure; SameSite=Strict") {
		t.Errorf("production cookie %q", c)
	}
	if c := get(h, "GET", "/api/x", "Cookie", "a=1; csrf_token=abc").Header().Get("Set-Cookie"); c != "" {
		t.Errorf("existing cookie must not be replaced, got %q", c)
	}

	forbidden := `{"message":"Invalid or missing CSRF token","error":"Forbidden","statusCode":403}`
	for _, c := range []struct {
		name    string
		path    string
		headers []string
		status  int
	}{
		{"no token", "/api/x", nil, 403},
		{"cookie without header", "/api/x", []string{"Cookie", "csrf_token=abc"}, 403},
		{"mismatch", "/api/x", []string{"Cookie", "csrf_token=abc", "X-CSRF-Token", "abd"}, 403},
		{"match", "/api/x", []string{"Cookie", "csrf_token=abc", "X-CSRF-Token", "abc"}, 200},
		{"bearer", "/api/x", []string{"Authorization", "Bearer x"}, 200},
		{"lowercase bearer is not exempt", "/api/x", []string{"Authorization", "bearer x"}, 403},
		{"auth path", "/api/auth/login", nil, 200},
		{"auth suffix", "/api/kiosk/kds/auth", nil, 200},
		{"tablet enroll", "/api/tablet/enroll", nil, 200},
		{"tablet enroll other case", "/api/Tablet/enroll", nil, 403},
		{"media upload", "/api/media-assets/local-dev-upload/x", nil, 200},
	} {
		rec := get(h, "POST", c.path, c.headers...)
		if rec.Code != c.status || (c.status == 403 && rec.Body.String() != forbidden) {
			t.Errorf("%s: %d %s", c.name, rec.Code, rec.Body)
		}
	}
}

func TestETagAndConditionalGet(t *testing.T) {
	body := `{"hello":"world"}`
	h := ETag(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		status := 200
		if r.URL.Path == "/missing" {
			status = 404
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.WriteHeader(status)
		_, _ = w.Write([]byte(body))
	}))
	// From the `etag` package Express uses: etag(body, {weak: true}).
	tag := `W/"11-` + "IkjuL6CqqtmReFMfkkvwC0sKj04" + `"`
	if got := WeakETag([]byte(body)); got != tag {
		t.Fatalf("WeakETag = %s, want %s", got, tag)
	}
	if got := WeakETag(nil); got != `W/"0-2jmj7l5rSw0yVb/vlWAYkK/YBwk"` {
		t.Errorf("empty body tag %s", got)
	}

	rec := get(h, "GET", "/")
	if rec.Code != 200 || rec.Header().Get("ETag") != tag || rec.Body.String() != body || rec.Header().Get("Content-Length") != "17" {
		t.Fatalf("plain GET: %d %v %s", rec.Code, rec.Header(), rec.Body)
	}
	for _, c := range []struct {
		name    string
		method  string
		path    string
		headers []string
		status  int
	}{
		{"exact weak tag", "GET", "/", []string{"If-None-Match", tag}, 304},
		{"strong form of the tag", "GET", "/", []string{"If-None-Match", strings.TrimPrefix(tag, "W/")}, 304},
		{"star", "GET", "/", []string{"If-None-Match", "*"}, 304},
		{"in a list", "GET", "/", []string{"If-None-Match", `"x", ` + tag}, 304},
		{"HEAD", "HEAD", "/", []string{"If-None-Match", tag}, 304},
		{"other tag", "GET", "/", []string{"If-None-Match", `W/"nope"`}, 200},
		{"no-cache", "GET", "/", []string{"If-None-Match", tag, "Cache-Control", "no-cache"}, 200},
		{"If-Modified-Since alone", "GET", "/", []string{"If-Modified-Since", "Mon, 28 Sep 2099 00:00:00 GMT"}, 200},
		{"error responses are never 304", "GET", "/missing", []string{"If-None-Match", tag}, 404},
		{"POST is never 304", "POST", "/", []string{"If-None-Match", tag}, 200},
	} {
		rec := get(h, c.method, c.path, c.headers...)
		if rec.Code != c.status {
			t.Errorf("%s: %d, want %d", c.name, rec.Code, c.status)
		}
		if rec.Header().Get("ETag") != tag {
			t.Errorf("%s: every body carries the ETag, got %q", c.name, rec.Header().Get("ETag"))
		}
		if c.status == 304 && (rec.Body.Len() != 0 || rec.Header().Get("Content-Type") != "" || rec.Header().Get("Content-Length") != "") {
			t.Errorf("%s: 304 must drop body, Content-Type and Content-Length: %v", c.name, rec.Header())
		}
	}
}
