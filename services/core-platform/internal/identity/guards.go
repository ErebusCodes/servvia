package identity

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"slices"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"servvia/services/core-platform/internal/platform/httpx"
)

// Staff roles (Prisma StaffRole).
const (
	RoleOwner   = "owner"
	RoleAdmin   = "admin"
	RoleManager = "manager"
	RoleCashier = "cashier"
	RoleKitchen = "kitchen"
	RoleViewer  = "viewer"
)

// RequireRoles ports RolesGuard (apps/api/src/auth/guards/roles.guard.ts):
// the owner role passes every check, any other role must be listed.
// It must run after Authenticate.
func RequireRoles(roles ...string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			p, ok := PrincipalFrom(r.Context())
			if !ok || p.Role == "" {
				httpx.WriteError(w, http.StatusUnauthorized, "Session expired or account deactivated")
				return
			}
			if p.Role != RoleOwner && !slices.Contains(roles, p.Role) {
				httpx.WriteError(w, http.StatusForbidden, "Insufficient permissions")
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// TabletDevices reports whether an enrolled tablet device is still active.
type TabletDevices interface {
	TabletDeviceActive(ctx context.Context, deviceID string) (bool, error)
}

// tabletKinds are the token kinds TabletTokenActiveGuard re-checks.
var tabletKinds = map[Kind]struct{}{KindTabletDevice: {}, KindTabletStaff: {}, KindTabletManager: {}}

// RequireActiveTabletDevice ports TabletTokenActiveGuard
// (apps/api/src/auth/guards/tablet-token-active.guard.ts): a tablet_* token
// is refused once its device is revoked or deleted, even though its
// signature is still valid. Every other caller passes untouched.
func RequireActiveTabletDevice(devices TabletDevices, logger *slog.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			p, ok := PrincipalFrom(r.Context())
			if _, tablet := tabletKinds[p.Kind]; !ok || !tablet || p.DeviceID == "" {
				next.ServeHTTP(w, r)
				return
			}
			active, err := devices.TabletDeviceActive(r.Context(), p.DeviceID)
			if err != nil {
				logger.ErrorContext(r.Context(), "tablet device check failed",
					"error", err, "request_id", httpx.RequestIDFrom(r.Context()))
				httpx.WriteInternalError(w)
				return
			}
			if !active {
				httpx.WriteError(w, http.StatusUnauthorized, "This device has been revoked or is unknown")
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// PostgresTabletDevices reads "TabletDevice".status.
type PostgresTabletDevices struct{ pool *pgxpool.Pool }

func NewPostgresTabletDevices(pool *pgxpool.Pool) *PostgresTabletDevices {
	return &PostgresTabletDevices{pool: pool}
}

func (s *PostgresTabletDevices) TabletDeviceActive(ctx context.Context, deviceID string) (bool, error) {
	var status string
	err := s.pool.QueryRow(ctx, `SELECT status::text FROM "TabletDevice" WHERE id = $1`, deviceID).Scan(&status)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("load tablet device: %w", err)
	}
	return status == "active", nil
}

// staffKinds are the token kinds whose subject is a staff member: a staff
// login session, and a tablet elevated by a staff or manager PIN.
var staffKinds = map[Kind]struct{}{KindStaffSession: {}, KindTabletStaff: {}, KindTabletManager: {}}

// IsStaff reports whether the principal is a named staff member rather than
// a device (a KDS screen or an unelevated tablet).
func (p Principal) IsStaff() bool {
	_, ok := staffKinds[p.Kind]
	return ok
}

// RequireStaff refuses device identities with Nest's RolesGuard 403, whatever
// role the device token carries. Staff operations (opening and changing a
// table session) are performed by a person, never by a KDS or an unelevated
// customer tablet. It must run after Authenticate.
func RequireStaff(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if p, ok := PrincipalFrom(r.Context()); !ok || !p.IsStaff() {
			httpx.WriteError(w, http.StatusForbidden, "Insufficient permissions")
			return
		}
		next.ServeHTTP(w, r)
	})
}

// RequireStaffOrKDS admits a named staff member or a KDS device, and refuses
// every other device identity (an unelevated customer tablet) with Nest's
// RolesGuard 403. Kitchen work is done at a KDS screen or by staff. It must
// run after Authenticate.
func RequireStaffOrKDS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if p, ok := PrincipalFrom(r.Context()); !ok || !(p.IsStaff() || p.Kind == KindKDSDevice) {
			httpx.WriteError(w, http.StatusForbidden, "Insufficient permissions")
			return
		}
		next.ServeHTTP(w, r)
	})
}

// RequireStaffSession admits only a staff login session: no tablet, even one
// elevated by a staff or manager PIN, and no device. Device and terminal
// administration issues credentials, so it is done from a staff login only
// (as Nest's StaffSessionOnlyGuard on tablet administration). It must run
// after Authenticate.
func RequireStaffSession(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if p, ok := PrincipalFrom(r.Context()); !ok || p.Kind != KindStaffSession {
			httpx.WriteError(w, http.StatusForbidden, "Insufficient permissions")
			return
		}
		next.ServeHTTP(w, r)
	})
}
