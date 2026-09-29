package httpx

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"log/slog"
	"net/http"
	"regexp"
	"runtime/debug"
	"time"
)

const (
	RequestIDHeader     = "X-Request-Id"
	CorrelationIDHeader = "X-Correlation-Id"
)

type ctxKey int

const (
	requestIDKey ctxKey = iota
	correlationIDKey
)

// Caller-supplied IDs are accepted only when they are short and made of safe
// characters, so they can be logged and echoed without injection risk.
var safeID = regexp.MustCompile(`^[A-Za-z0-9._:-]{1,128}$`)

func newID() string {
	var b [16]byte
	_, _ = rand.Read(b[:])
	return hex.EncodeToString(b[:])
}

// RequestIDFrom returns the request ID assigned by RequestIDs.
func RequestIDFrom(ctx context.Context) string {
	id, _ := ctx.Value(requestIDKey).(string)
	return id
}

// CorrelationIDFrom returns the correlation ID assigned by RequestIDs.
func CorrelationIDFrom(ctx context.Context) string {
	id, _ := ctx.Value(correlationIDKey).(string)
	return id
}

// RequestIDs assigns every request a request ID (reusing a valid inbound
// X-Request-Id, e.g. from the proxy) and a correlation ID that follows a
// business flow across services (inbound X-Correlation-Id, else the request
// ID). Both are echoed on the response.
func RequestIDs(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requestID := r.Header.Get(RequestIDHeader)
		if !safeID.MatchString(requestID) {
			requestID = newID()
		}
		correlationID := r.Header.Get(CorrelationIDHeader)
		if !safeID.MatchString(correlationID) {
			correlationID = requestID
		}
		w.Header().Set(RequestIDHeader, requestID)
		w.Header().Set(CorrelationIDHeader, correlationID)
		ctx := context.WithValue(r.Context(), requestIDKey, requestID)
		ctx = context.WithValue(ctx, correlationIDKey, correlationID)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// SecurityHeaders sets the same response headers as the NestJS API's
// SecurityHeadersMiddleware (apps/api/src/common/middleware/security-headers.middleware.ts).
func SecurityHeaders(next http.Handler) http.Handler {
	headers := [][2]string{
		{"Content-Security-Policy", "default-src 'self'; base-uri 'self'; block-all-mixed-content; font-src 'self' https: data:; frame-ancestors 'none'; img-src 'self' data: https:; object-src 'none'; script-src 'self'; script-src-attr 'none'; style-src 'self' https: 'unsafe-inline'; upgrade-insecure-requests"},
		{"X-DNS-Prefetch-Control", "off"},
		{"Frame-Options", "DENY"},
		{"X-Frame-Options", "DENY"},
		{"Strict-Transport-Security", "max-age=15552000; includeSubDomains"},
		{"X-Download-Options", "noopen"},
		{"X-Content-Type-Options", "nosniff"},
		{"Origin-Agent-Cluster", "?1"},
		{"X-Permitted-Cross-Domain-Policies", "none"},
		{"Referrer-Policy", "no-referrer"},
		{"X-XSS-Protection", "0"},
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		for _, h := range headers {
			w.Header().Set(h[0], h[1])
		}
		next.ServeHTTP(w, r)
	})
}

type statusRecorder struct {
	http.ResponseWriter
	status int
	bytes  int
}

func (s *statusRecorder) WriteHeader(code int) {
	if s.status == 0 {
		s.status = code
	}
	s.ResponseWriter.WriteHeader(code)
}

func (s *statusRecorder) Write(b []byte) (int, error) {
	if s.status == 0 {
		s.status = http.StatusOK
	}
	n, err := s.ResponseWriter.Write(b)
	s.bytes += n
	return n, err
}

// AccessLog writes one structured log line per request and converts a panic
// into a logged 500 without leaking its cause to the client.
func AccessLog(logger *slog.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			start := time.Now()
			rec := &statusRecorder{ResponseWriter: w}
			defer func() {
				if p := recover(); p != nil {
					if p == http.ErrAbortHandler {
						panic(p)
					}
					logger.ErrorContext(r.Context(), "panic serving request",
						"panic", p, "stack", string(debug.Stack()),
						"request_id", RequestIDFrom(r.Context()))
					if rec.status == 0 {
						WriteInternalError(rec)
					}
				}
				logger.InfoContext(r.Context(), "http request",
					"method", r.Method,
					"path", r.URL.Path,
					"status", rec.status,
					"bytes", rec.bytes,
					"duration_ms", time.Since(start).Milliseconds(),
					"request_id", RequestIDFrom(r.Context()),
					"correlation_id", CorrelationIDFrom(r.Context()),
					"remote_addr", r.RemoteAddr,
				)
			}()
			next.ServeHTTP(rec, r)
		})
	}
}

// Chain applies middleware so the first argument is the outermost.
func Chain(h http.Handler, middleware ...func(http.Handler) http.Handler) http.Handler {
	for i := len(middleware) - 1; i >= 0; i-- {
		h = middleware[i](h)
	}
	return h
}
