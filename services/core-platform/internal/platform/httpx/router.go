package httpx

import (
	"context"
	"net/http"
	"strings"
	"unicode/utf8"
)

// Router matches requests the way the NestJS API's Express 5 router does, so
// a proxy can move a path to Go without clients seeing a different answer.
// Go's http.ServeMux differs from Express in ways a client can observe:
//
//   - Express compares literal path segments case-insensitively
//     (`case sensitive routing` is off) and keeps parameters as sent:
//     /API/Menu/venues/X/channel/order_tablet matches, and the channel
//     parameter stays exactly as the caller wrote it.
//   - Express matches the raw path and then decodes each parameter with
//     decodeURIComponent. `%6denu` does not match the literal `menu`, but
//     `order%5Ftablet` is the parameter `order_tablet`.
//   - Express accepts one optional trailing slash (non-strict routing) and
//     treats an empty segment (`//`) as no match. ServeMux cleans such paths
//     and answers with a 301 redirect instead.
//   - HEAD is served by the GET route.
//
// Nest applies its middleware (SecurityHeadersMiddleware, CsrfMiddleware) only
// to paths under /api/ (forRoutes('*path') behind the global prefix). Before
// that middleware runs, Express decodes every segment of the path; a
// segment decodeURIComponent rejects produces Nest's 400
// `Failed to decode param '<segment>'` without the middleware's headers.
//
// Go's own probes (/health, /ready) are registered with Handle and matched
// exactly.
type Router struct {
	exact          map[string]http.Handler
	routes         []route
	nestMiddleware func(http.Handler) http.Handler
}

type route struct {
	method   string
	segments []string // lowercase literals, or "{name}" for a parameter
	handler  http.Handler
}

// NewRouter returns a router whose /api/ requests pass through
// nestMiddleware (security headers, CSRF) exactly where Nest's do.
func NewRouter(nestMiddleware func(http.Handler) http.Handler) *Router {
	return &Router{exact: map[string]http.Handler{}, nestMiddleware: nestMiddleware}
}

// Handle registers a Go-owned path, matched exactly and outside Nest's scope.
func (rt *Router) Handle(path string, h http.Handler) { rt.exact[path] = h }

// Nest registers a route that reproduces an Express route of the NestJS API.
// pattern uses {name} for parameters, e.g. /api/menu/venues/{venueId}/channel/{channel}.
// The handler reads parameters with r.PathValue.
func (rt *Router) Nest(method, pattern string, h http.Handler) {
	var segments []string
	for _, s := range strings.Split(strings.Trim(pattern, "/"), "/") {
		if !strings.HasPrefix(s, "{") {
			s = strings.ToLower(s)
		}
		segments = append(segments, s)
	}
	rt.routes = append(rt.routes, route{method: method, segments: segments, handler: h})
}

type originalPathKey struct{}

// RawPathFrom returns the request path exactly as the client sent it
// (Express's req.path), which rate-limit keys and CSRF exemptions use.
func RawPathFrom(r *http.Request) string {
	if p, ok := r.Context().Value(originalPathKey{}).(string); ok {
		return p
	}
	return r.URL.EscapedPath()
}

func (rt *Router) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	raw := r.URL.EscapedPath()
	if h, ok := rt.exact[raw]; ok && (r.Method == http.MethodGet || r.Method == http.MethodHead) {
		h.ServeHTTP(w, r)
		return
	}
	if !inNestMiddlewareScope(raw) {
		notFound(w, r)
		return
	}
	for _, seg := range strings.Split(raw[len("/api/"):], "/") {
		if _, ok := decodeURIComponent(seg); !ok {
			WriteError(w, http.StatusBadRequest, "Failed to decode param '"+seg+"'")
			return
		}
	}
	r = r.WithContext(context.WithValue(r.Context(), originalPathKey{}, raw))
	rt.nestMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		rt.dispatch(w, r, raw)
	})).ServeHTTP(w, r)
}

func (rt *Router) dispatch(w http.ResponseWriter, r *http.Request, raw string) {
	path := strings.TrimPrefix(raw, "/")
	// Non-strict routing: one trailing slash is optional.
	path = strings.TrimSuffix(path, "/")
	segments := strings.Split(path, "/")
	method := r.Method
	if method == http.MethodHead {
		method = http.MethodGet
	}
	for _, rte := range rt.routes {
		if rte.method != method || len(rte.segments) != len(segments) {
			continue
		}
		params, ok := rte.match(segments)
		if !ok {
			continue
		}
		for name, value := range params {
			r.SetPathValue(name, value)
		}
		rte.handler.ServeHTTP(w, r)
		return
	}
	notFound(w, r)
}

func (rte route) match(segments []string) (map[string]string, bool) {
	params := map[string]string{}
	for i, want := range rte.segments {
		got := segments[i]
		if got == "" {
			return nil, false
		}
		if strings.HasPrefix(want, "{") {
			// Already proven decodable in ServeHTTP.
			params[strings.Trim(want, "{}")], _ = decodeURIComponent(got)
			continue
		}
		if !strings.EqualFold(got, want) {
			return nil, false
		}
	}
	return params, true
}

// inNestMiddlewareScope reports whether Express would run Nest's middleware:
// the route `/api/*path` matches /api/ followed by at least one character,
// case-insensitively.
func inNestMiddlewareScope(raw string) bool {
	return len(raw) > len("/api/") && strings.EqualFold(raw[:len("/api/")], "/api/")
}

// notFound is Nest's unmatched-route body.
func notFound(w http.ResponseWriter, r *http.Request) {
	WriteError(w, http.StatusNotFound, "Cannot "+r.Method+" "+r.URL.RequestURI())
}

// decodeURIComponent reproduces JavaScript's decodeURIComponent: every `%`
// must start a two-digit hex escape, and the decoded bytes must be valid
// UTF-8, otherwise it fails (URIError).
func decodeURIComponent(s string) (string, bool) {
	if !strings.Contains(s, "%") {
		return s, true
	}
	out := make([]byte, 0, len(s))
	for i := 0; i < len(s); i++ {
		if s[i] != '%' {
			out = append(out, s[i])
			continue
		}
		if i+2 >= len(s) {
			return "", false
		}
		hi, ok1 := unhex(s[i+1])
		lo, ok2 := unhex(s[i+2])
		if !ok1 || !ok2 {
			return "", false
		}
		out = append(out, hi<<4|lo)
		i += 2
	}
	if !utf8.Valid(out) {
		return "", false
	}
	return string(out), true
}

func unhex(c byte) (byte, bool) {
	switch {
	case '0' <= c && c <= '9':
		return c - '0', true
	case 'a' <= c && c <= 'f':
		return c - 'a' + 10, true
	case 'A' <= c && c <= 'F':
		return c - 'A' + 10, true
	}
	return 0, false
}
