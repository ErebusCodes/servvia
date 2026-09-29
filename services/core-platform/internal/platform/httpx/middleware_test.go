package httpx

import (
	"bytes"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestRequestIDsGeneratesAndEchoes(t *testing.T) {
	var seenRequest, seenCorrelation string
	h := RequestIDs(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		seenRequest, seenCorrelation = RequestIDFrom(r.Context()), CorrelationIDFrom(r.Context())
	}))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/", nil))

	if len(seenRequest) != 32 || seenCorrelation != seenRequest {
		t.Fatalf("request=%q correlation=%q", seenRequest, seenCorrelation)
	}
	if rec.Header().Get(RequestIDHeader) != seenRequest || rec.Header().Get(CorrelationIDHeader) != seenRequest {
		t.Fatal("IDs must be echoed on the response")
	}
}

func TestRequestIDsAcceptsSafeInboundAndRejectsUnsafe(t *testing.T) {
	h := RequestIDs(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set(RequestIDHeader, "proxy-123")
	req.Header.Set(CorrelationIDHeader, "order:ORD-600001")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Header().Get(RequestIDHeader) != "proxy-123" || rec.Header().Get(CorrelationIDHeader) != "order:ORD-600001" {
		t.Fatalf("safe inbound IDs must be reused: %v", rec.Header())
	}

	req = httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set(RequestIDHeader, "bad\nvalue")
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if got := rec.Header().Get(RequestIDHeader); got == "bad\nvalue" || len(got) != 32 {
		t.Fatalf("unsafe inbound ID must be replaced, got %q", got)
	}
}

func TestSecurityHeadersMatchNest(t *testing.T) {
	rec := httptest.NewRecorder()
	SecurityHeaders(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {})).
		ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/", nil))
	for header, want := range map[string]string{
		"X-Frame-Options":           "DENY",
		"X-Content-Type-Options":    "nosniff",
		"Strict-Transport-Security": "max-age=15552000; includeSubDomains",
		"Referrer-Policy":           "no-referrer",
	} {
		if got := rec.Header().Get(header); got != want {
			t.Errorf("%s = %q, want %q", header, got, want)
		}
	}
}

func TestAccessLogRecoversPanicAsNestInternalError(t *testing.T) {
	var logs bytes.Buffer
	logger := slog.New(slog.NewJSONHandler(&logs, nil))
	h := Chain(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { panic("boom") }),
		RequestIDs, AccessLog(logger))

	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/x", nil))

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d", rec.Code)
	}
	var body NestError
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil || body.Message != "Internal server error" || body.Error != "" {
		t.Fatalf("body = %s", rec.Body.String())
	}
	if strings.Contains(rec.Body.String(), "boom") {
		t.Fatal("panic cause must not leak to the client")
	}
	if !strings.Contains(logs.String(), `"status":500`) || !strings.Contains(logs.String(), "panic serving request") {
		t.Fatalf("expected panic and access log lines, got %s", logs.String())
	}
}
