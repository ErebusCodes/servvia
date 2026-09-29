// Package ratelimit is the Redis sliding-window limiter shared with the NestJS
// API's RateLimitGuard (apps/api/src/auth/guards/rate-limit.guard.ts).
//
// While Nest and Go both serve traffic, a client must have ONE budget, not
// one per implementation. So this package runs the byte-identical Lua script
// against the same Redis, with the same key
// `rate-limit:<ip>:<METHOD>:<raw request path>`, the same member format and
// the same window arithmetic. A request admitted by either service consumes
// a slot the other one sees.
//
// Failure semantics also match: one retry after 50 ms, only for a fault
// where Redis gave no verdict (timeout, connection), then fail CLOSED with
// 503. A 429 is never retried.
package ratelimit

import (
	"context"
	"errors"
	"log/slog"
	"math/rand/v2"
	"net"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/redis/go-redis/v9"

	"servvia/services/core-platform/internal/platform/httpx"
)

// Script is RateLimitGuard's LUA_LIMIT_SCRIPT, character for character.
const Script = `
  local key = KEYS[1]
  local now = tonumber(ARGV[1])
  local windowMs = tonumber(ARGV[2])
  local limit = tonumber(ARGV[3])
  local uniqueMember = ARGV[4]
  local windowSeconds = tonumber(ARGV[5])

  local oldestTimestamp = now - windowMs
  redis.call('ZREMRANGEBYSCORE', key, '-inf', oldestTimestamp)
  local count = redis.call('ZCARD', key)

  if count < limit then
    redis.call('ZADD', key, now, uniqueMember)
    redis.call('EXPIRE', key, windowSeconds)
    return {0, count + 1}
  else
    local oldestResult = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
    local oldestTime = 0
    if oldestResult and #oldestResult >= 2 then
      oldestTime = tonumber(oldestResult[2])
    end
    return {1, count, oldestTime}
  end
`

const (
	// CommandTimeout is ioredis's `commandTimeout` in apps/api/src/redis/redis.module.ts.
	CommandTimeout      = 1500 * time.Millisecond
	transientRetryDelay = 50 * time.Millisecond
)

// Evaluator runs the script. *redis.Client satisfies it.
type Evaluator interface {
	Eval(ctx context.Context, script string, keys []string, args ...any) *redis.Cmd
}

// Limiter enforces one route's budget.
type Limiter struct {
	redis     Evaluator
	trustHops int
	logger    *slog.Logger
	now       func() time.Time
	sleep     func(time.Duration)
}

// New returns a limiter. trustProxyHops is TRUST_PROXY_HOPS, the value Nest
// passes to Express's `trust proxy`.
func New(r Evaluator, trustProxyHops int, logger *slog.Logger) *Limiter {
	return &Limiter{redis: r, trustHops: trustProxyHops, logger: logger, now: time.Now, sleep: time.Sleep}
}

// Rule is the @RateLimit metadata of a route.
type Rule struct {
	Limit         int
	WindowSeconds int
}

// Middleware applies the rule. It must run after routing, where Nest's guard
// runs: after the middleware, before parameter validation.
func (l *Limiter) Middleware(rule Rule) func(http.Handler) http.Handler {
	// RateLimitGuard's defaults when metadata is missing or not positive.
	if rule.Limit <= 0 {
		rule.Limit = 10
	}
	if rule.WindowSeconds <= 0 {
		rule.WindowSeconds = 900
	}
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			allowed, retryAfter, err := l.check(r, rule)
			switch {
			case err != nil:
				l.logger.ErrorContext(r.Context(), "rate limit backend failed (failing closed)",
					"error", err, "request_id", httpx.RequestIDFrom(r.Context()))
				writeGuardError(w, http.StatusServiceUnavailable, "Authentication is temporarily unavailable.")
			case !allowed:
				w.Header().Set("Retry-After", strconv.Itoa(retryAfter))
				writeGuardError(w, http.StatusTooManyRequests, "Too many requests, please try again later.")
			default:
				next.ServeHTTP(w, r)
			}
		})
	}
}

func (l *Limiter) check(r *http.Request, rule Rule) (allowed bool, retryAfter int, err error) {
	key := "rate-limit:" + ClientIP(r, l.trustHops) + ":" + r.Method + ":" + httpx.RawPathFrom(r)
	now := l.now().UnixMilli()
	windowMs := int64(rule.WindowSeconds) * 1000
	// Same shape as `${now}-${Math.random().toString(36).substring(2, 9)}`.
	member := strconv.FormatInt(now, 10) + "-" + randomBase36(7)
	args := []any{
		strconv.FormatInt(now, 10), strconv.FormatInt(windowMs, 10),
		strconv.Itoa(rule.Limit), member, strconv.Itoa(rule.WindowSeconds),
	}

	var result []any
	for attempt := 0; ; attempt++ {
		ctx, cancel := context.WithTimeout(r.Context(), CommandTimeout)
		// Retrying with the same now and member is idempotent against the
		// sorted set; see the comment above TRANSIENT_RETRY_ATTEMPTS in Nest.
		result, err = l.redis.Eval(ctx, Script, []string{key}, args...).Slice()
		cancel()
		if err == nil {
			break
		}
		if attempt == 1 || !IsTransient(err) {
			return false, 0, err
		}
		l.logger.WarnContext(r.Context(), "rate limit backend timed out, retrying", "error", err)
		l.sleep(transientRetryDelay)
	}
	if len(result) < 2 {
		return false, 0, errors.New("redis returned an invalid rate-limit response")
	}
	if toInt64(result[0]) != 1 {
		return true, 0, nil
	}
	retryAfter = rule.WindowSeconds
	if len(result) > 2 {
		if oldest := toInt64(result[2]); oldest > 0 {
			// max(1, ceil(waitMs / 1000))
			retryAfter = 1
			if waitMs := oldest + windowMs - now; waitMs > 0 {
				retryAfter = max(1, int((waitMs+999)/1000))
			}
		}
	}
	return false, retryAfter, nil
}

// IsTransient reports whether Redis gave no verdict, the only case Nest
// retries (isTransientRedisFault): a timeout or a connection fault. A script
// or reply error is a real failure.
func IsTransient(err error) bool {
	var redisErr redis.Error
	if errors.As(err, &redisErr) {
		return false
	}
	var netErr net.Error
	return errors.Is(err, context.DeadlineExceeded) || errors.Is(err, redis.ErrClosed) ||
		errors.As(err, &netErr) || errors.Is(err, net.ErrClosed) ||
		strings.Contains(err.Error(), "EOF") || strings.Contains(err.Error(), "connection refused")
}

// ClientIP is Express's req.ip with `trust proxy` set to a hop count
// (proxy-addr): the socket address, then X-Forwarded-For from right to left,
// taking the address `hops` steps back, or the furthest one available.
func ClientIP(r *http.Request, hops int) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	addrs := []string{host}
	if hops > 0 {
		var forwarded []string
		for _, header := range r.Header.Values("X-Forwarded-For") {
			for _, part := range strings.Split(header, ",") {
				forwarded = append(forwarded, strings.Trim(part, " "))
			}
		}
		for i := len(forwarded) - 1; i >= 0; i-- {
			addrs = append(addrs, forwarded[i])
		}
	}
	return addrs[min(hops, len(addrs)-1)]
}

func writeGuardError(w http.ResponseWriter, status int, message string) {
	// Nest serialises the guard's HttpException object as given: statusCode first.
	httpx.WriteJSON(w, status, struct {
		StatusCode int    `json:"statusCode"`
		Message    string `json:"message"`
		Error      string `json:"error"`
	}{status, message, http.StatusText(status)})
}

func toInt64(v any) int64 {
	switch n := v.(type) {
	case int64:
		return n
	case string:
		i, _ := strconv.ParseInt(n, 10, 64)
		return i
	}
	return 0
}

func randomBase36(n int) string {
	const digits = "0123456789abcdefghijklmnopqrstuvwxyz"
	b := make([]byte, n)
	for i := range b {
		b[i] = digits[rand.IntN(len(digits))]
	}
	return string(b)
}

// NewRedisClient connects like apps/api/src/redis/redis.module.ts: REDIS_HOST
// and REDIS_PORT, no password, lazy connection. go-redis's own retries are off;
// the limiter's single retry is the only one, as in Nest.
func NewRedisClient(host string, port int) *redis.Client {
	return redis.NewClient(&redis.Options{
		Addr:         net.JoinHostPort(host, strconv.Itoa(port)),
		MaxRetries:   -1,
		DialTimeout:  CommandTimeout,
		ReadTimeout:  CommandTimeout,
		WriteTimeout: CommandTimeout,
	})
}
