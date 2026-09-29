package httpx

import (
	"bytes"
	"crypto/rand"
	"crypto/sha1"
	"encoding/base64"
	"encoding/hex"
	"net/http"
	"slices"
	"strconv"
	"strings"
)

// This file reproduces three pieces of NestJS/Express behaviour that clients
// can observe on every route: CORS (apps/api/src/main.ts), the csrf_token
// cookie (apps/api/src/common/middleware/csrf.middleware.ts) and Express's
// weak ETag with If-None-Match / 304.

// AllowedOrigins is the NestJS API's CORS allow-list, exactly as written in
// apps/api/src/main.ts. It is deliberately not configurable: widening it is an
// API change that must be made in both services at once.
var AllowedOrigins = []string{
	"https://verdura.co.nz",
	"https://admin.verdura.co.nz",
	"https://kiosk.verdura.co.nz",
	"http://localhost:5173",
	"http://localhost:5174",
	"http://localhost:5175",
	"http://localhost:5176",
	"http://localhost:5177",
}

// corsAllowMethods is the `cors` package's default `methods`.
const corsAllowMethods = "GET,HEAD,PUT,PATCH,POST,DELETE"

// CORS mirrors app.enableCors with Nest's per-request delegate and the `cors`
// package defaults. A request with no Origin, or an allowed Origin, is
// answered with credentials allowed and the Origin reflected; any other Origin
// gets no CORS headers at all and continues as a normal request. Every OPTIONS
// request from an allowed (or absent) Origin is treated as a preflight and
// answered with 204 before routing, as `cors` does, so it carries none of
// Nest's middleware headers.
func CORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if origin != "" && !slices.Contains(AllowedOrigins, origin) {
			next.ServeHTTP(w, r)
			return
		}
		h := w.Header()
		if origin != "" {
			h.Set("Access-Control-Allow-Origin", origin)
		}
		if r.Method != http.MethodOptions {
			h.Set("Vary", "Origin")
			h.Set("Access-Control-Allow-Credentials", "true")
			next.ServeHTTP(w, r)
			return
		}
		h.Set("Vary", "Origin, Access-Control-Request-Headers")
		h.Set("Access-Control-Allow-Credentials", "true")
		h.Set("Access-Control-Allow-Methods", corsAllowMethods)
		if requested := r.Header.Get("Access-Control-Request-Headers"); requested != "" {
			h.Set("Access-Control-Allow-Headers", requested)
		}
		h.Set("Content-Length", "0")
		w.WriteHeader(http.StatusNoContent)
	})
}

// CSRF mirrors CsrfMiddleware: issue a csrf_token cookie when the request has
// none, and for unsafe methods require X-CSRF-Token to equal it unless the
// request is exempt (auth paths, enrollment, any `Bearer ` Authorization, the
// local media upload). secureCookie is NODE_ENV=production.
func CSRF(secureCookie bool) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			token := cookieValue(r.Header.Values("Cookie"), "csrf_token")
			if token == "" {
				var b [32]byte
				_, _ = rand.Read(b[:])
				token = hex.EncodeToString(b[:])
				cookie := "csrf_token=" + token + "; Path=/"
				if secureCookie {
					cookie += "; Secure"
				}
				w.Header().Add("Set-Cookie", cookie+"; SameSite=Strict")
			}
			switch r.Method {
			case http.MethodGet, http.MethodHead, http.MethodOptions:
				next.ServeHTTP(w, r)
				return
			}
			path := RawPathFrom(r)
			if strings.Contains(path, "/auth/") || strings.HasSuffix(path, "/auth") ||
				path == "/api/tablet/enroll" || path == "/api/connector/enroll" ||
				strings.HasPrefix(r.Header.Get("Authorization"), "Bearer ") ||
				strings.Contains(path, "/media-assets/local-dev-upload/") {
				next.ServeHTTP(w, r)
				return
			}
			if header := strings.Join(r.Header.Values("X-Csrf-Token"), ", "); header == "" || header != token {
				WriteError(w, http.StatusForbidden, "Invalid or missing CSRF token")
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// cookieValue parses Cookie headers like the `cookie` package behind
// cookie-parser: pairs split on ';', the first occurrence of a name wins,
// surrounding double quotes are removed and %-escapes are decoded when valid.
func cookieValue(headers []string, name string) string {
	for _, header := range headers {
		for _, pair := range strings.Split(header, ";") {
			key, value, ok := strings.Cut(pair, "=")
			if !ok || strings.TrimSpace(key) != name {
				continue
			}
			value = strings.TrimSpace(value)
			if len(value) >= 2 && value[0] == '"' && value[len(value)-1] == '"' {
				value = value[1 : len(value)-1]
			}
			if decoded, ok := decodeURIComponent(value); ok {
				value = decoded
			}
			return value
		}
	}
	return ""
}

// ETag reproduces Express's res.send: every response body gets a weak ETag
// (`W/"<length hex>-<sha1 base64, 27 chars>"`) unless one is already set, and
// a GET or HEAD whose 2xx response is fresh against the request's
// If-None-Match / If-Modified-Since becomes a bodiless 304.
func ETag(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		buf := &bufferedWriter{header: w.Header()}
		next.ServeHTTP(buf, r)
		status := buf.status
		if status == 0 {
			status = http.StatusOK
		}
		if status == http.StatusNoContent || !buf.wrote {
			w.WriteHeader(status)
			return
		}
		h := w.Header()
		if h.Get("ETag") == "" {
			h.Set("ETag", WeakETag(buf.body.Bytes()))
		}
		if (r.Method == http.MethodGet || r.Method == http.MethodHead) &&
			(status >= 200 && status < 300) && fresh(r.Header, h) {
			h.Del("Content-Type")
			h.Del("Content-Length")
			h.Del("Transfer-Encoding")
			w.WriteHeader(http.StatusNotModified)
			return
		}
		h.Set("Content-Length", strconv.Itoa(buf.body.Len()))
		w.WriteHeader(status)
		_, _ = w.Write(buf.body.Bytes())
	})
}

// WeakETag is the `etag` package's weak tag for a body, as Express uses it.
func WeakETag(body []byte) string {
	sum := sha1.Sum(body)
	return `W/"` + strconv.FormatInt(int64(len(body)), 16) + "-" +
		base64.StdEncoding.EncodeToString(sum[:])[:27] + `"`
}

// fresh is the `fresh` package: a request with neither If-None-Match nor
// If-Modified-Since, or with Cache-Control: no-cache, is never fresh.
// If-None-Match `*` matches anything; otherwise one listed tag must equal
// the response ETag, compared weakly. If-Modified-Since needs a
// Last-Modified, which this service never sets, so it alone is never fresh.
func fresh(req http.Header, res http.Header) bool {
	noneMatch := req.Get("If-None-Match")
	modifiedSince := req.Get("If-Modified-Since")
	if noneMatch == "" && modifiedSince == "" {
		return false
	}
	if cc := req.Get("Cache-Control"); cc != "" && noCache(cc) {
		return false
	}
	if noneMatch != "" && noneMatch != "*" {
		etag := res.Get("ETag")
		if etag == "" {
			return false
		}
		matched := false
		for _, tag := range strings.Split(noneMatch, ",") {
			tag = strings.Trim(tag, " ")
			if tag == etag || "W/"+tag == etag || tag == "W/"+etag {
				matched = true
				break
			}
		}
		if !matched {
			return false
		}
	}
	if modifiedSince != "" && res.Get("Last-Modified") == "" {
		return false
	}
	return true
}

// noCache matches `fresh`'s /(?:^|,)\s*?no-cache\s*?(?:,|$)/.
func noCache(cc string) bool {
	for _, part := range strings.Split(cc, ",") {
		if strings.Trim(part, " \t") == "no-cache" {
			return true
		}
	}
	return false
}

type bufferedWriter struct {
	header http.Header
	status int
	wrote  bool
	body   bytes.Buffer
}

func (b *bufferedWriter) Header() http.Header { return b.header }

func (b *bufferedWriter) WriteHeader(code int) {
	if b.status == 0 {
		b.status = code
	}
}

func (b *bufferedWriter) Write(p []byte) (int, error) {
	if b.status == 0 {
		b.status = http.StatusOK
	}
	b.wrote = true
	return b.body.Write(p)
}
