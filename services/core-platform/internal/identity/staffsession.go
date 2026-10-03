package identity

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"

	"servvia/services/core-platform/internal/platform/httpx"
)

// Active staff and session revocation (Story 2.5; SEC-16.4, SEC-16.5). A
// valid signature is not enough: the staff member a token names must still
// be active (not deactivated, not deleted, in an active organization), and a
// staff login session must not have been ended by logout. Both are checked
// again on every request and fail closed: a check that cannot be made is a
// 500, never access. Device identities (KDS, an unelevated tablet) are not
// staff and are not checked here; tablet tokens keep their device re-check.

// StaffSessionEndedMessage is the 401 message for a deactivated staff member
// or a revoked session; it is the message Nest's refresh strategy uses.
const StaffSessionEndedMessage = "Session expired or account deactivated"

// RevokedSessionKeyPrefix is the Redis key prefix of a revoked staff login
// session, shared with the NestJS API (apps/api/src/auth/session-revocation.service.ts),
// which writes the key on logout.
const RevokedSessionKeyPrefix = "auth:revoked-session:"

// StaffStatus reports whether a staff member may still act.
type StaffStatus interface {
	StaffActive(ctx context.Context, staffID string) (bool, error)
}

// SessionRevocations reports whether a staff login session was revoked.
type SessionRevocations interface {
	SessionRevoked(ctx context.Context, sessionID string) (bool, error)
}

// StaffSessions checks staff principals against both stores.
type StaffSessions struct {
	Staff       StaffStatus
	Revocations SessionRevocations
}

// Admit reports whether the principal may still act. Device identities are
// admitted unchanged. A staff login session without a session ID is refused:
// it cannot be revoked, so only a token from before session IDs (or a
// misbuilt one) lacks it. A non-nil error means the check could not be made.
func (s StaffSessions) Admit(ctx context.Context, p Principal) (bool, error) {
	if !p.IsStaff() {
		return true, nil
	}
	if p.Kind == KindStaffSession {
		if p.SessionID == "" {
			return false, nil
		}
		revoked, err := s.Revocations.SessionRevoked(ctx, p.SessionID)
		if err != nil {
			return false, fmt.Errorf("check session revocation: %w", err)
		}
		if revoked {
			return false, nil
		}
	}
	active, err := s.Staff.StaffActive(ctx, p.ID)
	if err != nil {
		return false, fmt.Errorf("check staff status: %w", err)
	}
	return active, nil
}

// RequireActiveStaff refuses a deactivated staff member or a revoked session
// (401) and fails closed (500) when either cannot be checked. It must run
// directly after Authenticate, before any other guard.
func RequireActiveStaff(s StaffSessions, logger *slog.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			p, ok := PrincipalFrom(r.Context())
			if !ok {
				writeUnauthorized(w)
				return
			}
			admitted, err := s.Admit(r.Context(), p)
			if err != nil {
				logger.ErrorContext(r.Context(), "staff session check failed",
					"error", err, "request_id", httpx.RequestIDFrom(r.Context()))
				httpx.WriteInternalError(w)
				return
			}
			if !admitted {
				LogStaffSessionRefused(r.Context(), logger, p, "method", r.Method, "route", r.Pattern)
				httpx.WriteError(w, http.StatusUnauthorized, StaffSessionEndedMessage)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// LogStaffSessionRefused records a refused staff token as a security event
// (actor, kind, role, request ID; never the credential).
func LogStaffSessionRefused(ctx context.Context, logger *slog.Logger, p Principal, extra ...any) {
	attrs := append([]any{"event", "staff_session_refused", "staff_id", p.ID, "kind", string(p.Kind), "role", p.Role,
		"organization_id", p.OrganizationID, "request_id", httpx.RequestIDFrom(ctx)}, extra...)
	logger.WarnContext(ctx, "staff token refused: deactivated, logged out or without a session", attrs...)
}

// PostgresStaffStatus reads "Staff" and its "Organization", as Nest's
// StaffService.findById: active, not deleted, in an active organization.
type PostgresStaffStatus struct{ pool *pgxpool.Pool }

func NewPostgresStaffStatus(pool *pgxpool.Pool) *PostgresStaffStatus {
	return &PostgresStaffStatus{pool: pool}
}

func (s *PostgresStaffStatus) StaffActive(ctx context.Context, staffID string) (bool, error) {
	var active bool
	if err := s.pool.QueryRow(ctx, `SELECT EXISTS (
		  SELECT 1 FROM "Staff" s JOIN "Organization" o ON o.id = s."organizationId"
		  WHERE s.id = $1 AND s."isActive" AND s."deletedAt" IS NULL AND o."isActive")`,
		staffID).Scan(&active); err != nil {
		return false, fmt.Errorf("load staff status: %w", err)
	}
	return active, nil
}

// RedisSessionRevocations reads the revoked-session keys Nest writes on
// logout. Each key expires with the longest-lived token of its session.
type RedisSessionRevocations struct{ rdb redis.Cmdable }

func NewRedisSessionRevocations(rdb redis.Cmdable) *RedisSessionRevocations {
	return &RedisSessionRevocations{rdb: rdb}
}

func (s *RedisSessionRevocations) SessionRevoked(ctx context.Context, sessionID string) (bool, error) {
	n, err := s.rdb.Exists(ctx, RevokedSessionKeyPrefix+sessionID).Result()
	if err != nil {
		return false, fmt.Errorf("load session revocation: %w", err)
	}
	return n > 0, nil
}
