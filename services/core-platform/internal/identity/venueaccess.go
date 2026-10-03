package identity

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"

	"github.com/jackc/pgx/v5/pgxpool"

	"servvia/services/core-platform/internal/platform/httpx"
)

// Staff venue access (PRD section 16 item 3; MVP 9.6 via the PRD section 11
// pilot acceptance): a staff member may act only in venues they have been
// explicitly granted (a VenueAccess row). The rule applies to every staff
// role, owner and admin included, because the PRD records no exception.
// Device identities (KDS, an unelevated tablet) are not staff; they stay
// pinned to their token's venue by ResolveVenueScope.

// VenueAccessDecision is the outcome of a staff venue access check.
type VenueAccessDecision int

const (
	// VenueNotInOrganization: the venue does not exist in the staff member's
	// organization. Venue access does not answer this; the route's own
	// tenancy check does (404, the same answer as an unknown venue).
	VenueNotInOrganization VenueAccessDecision = iota
	// VenueAccessNotGranted: an own-organization venue without a grant (403).
	VenueAccessNotGranted
	// VenueAccessGranted: the staff member holds a grant for the venue.
	VenueAccessGranted
)

// VenueGrants decides staff venue access from VenueAccess grants.
type VenueGrants interface {
	VenueAccess(ctx context.Context, staffID, organizationID, venueID string) (VenueAccessDecision, error)
}

// PostgresVenueGrants reads "VenueAccess" (Prisma model VenueAccess).
type PostgresVenueGrants struct {
	pool *pgxpool.Pool
}

func NewPostgresVenueGrants(pool *pgxpool.Pool) *PostgresVenueGrants {
	return &PostgresVenueGrants{pool: pool}
}

func (s *PostgresVenueGrants) VenueAccess(ctx context.Context, staffID, organizationID, venueID string) (VenueAccessDecision, error) {
	var inOrganization, granted bool
	if err := s.pool.QueryRow(ctx, `SELECT
		  EXISTS (SELECT 1 FROM "Venue" WHERE id = $3 AND "organizationId" = $2),
		  EXISTS (SELECT 1 FROM "VenueAccess" WHERE "staffId" = $1 AND "venueId" = $3)`,
		staffID, organizationID, venueID).Scan(&inOrganization, &granted); err != nil {
		return VenueNotInOrganization, fmt.Errorf("load venue access: %w", err)
	}
	switch {
	case !inOrganization:
		return VenueNotInOrganization, nil
	case !granted:
		return VenueAccessNotGranted, nil
	}
	return VenueAccessGranted, nil
}

// VenueAccessDeniedMessage is the 403 message for a staff member without a
// grant for the requested venue.
const VenueAccessDeniedMessage = "Staff access to this venue has not been granted"

// RequireVenueAccess refuses a staff principal without a VenueAccess grant
// for an own-organization venue named by the route's path parameter (403),
// before any domain work. A check that fails fails closed (500), never
// access. A venue outside the staff member's organization (or unknown)
// passes through to the route's own tenancy check, which answers 404 as it
// always has, so the cross-tenant answer is unchanged and venues cannot be
// enumerated. Non-staff identities pass through: their venue is pinned by
// ResolveVenueScope in the handler. It must run after Authenticate.
//
// Every refusal is recorded as a structured security event (actor, kind,
// role, venue, method, route, request ID; never the credential).
func RequireVenueAccess(grants VenueGrants, param string, logger *slog.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			p, ok := PrincipalFrom(r.Context())
			if !ok || !p.IsStaff() {
				next.ServeHTTP(w, r)
				return
			}
			venueID := r.PathValue(param)
			decision, err := grants.VenueAccess(r.Context(), p.ID, p.OrganizationID, venueID)
			if err != nil {
				logger.ErrorContext(r.Context(), "venue access check failed",
					"error", err, "request_id", httpx.RequestIDFrom(r.Context()))
				httpx.WriteInternalError(w)
				return
			}
			if decision == VenueAccessNotGranted {
				LogVenueAccessDenied(r.Context(), logger, p, venueID, "method", r.Method, "route", r.Pattern)
				httpx.WriteError(w, http.StatusForbidden, VenueAccessDeniedMessage)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// LogVenueAccessDenied records a refused staff venue access as a security
// event. Extra attributes describe the transport (HTTP route, realtime).
func LogVenueAccessDenied(ctx context.Context, logger *slog.Logger, p Principal, venueID string, extra ...any) {
	attrs := append([]any{"event", "venue_access_denied", "staff_id", p.ID, "kind", string(p.Kind), "role", p.Role,
		"organization_id", p.OrganizationID, "venue_id", venueID, "request_id", httpx.RequestIDFrom(ctx)}, extra...)
	logger.WarnContext(ctx, "staff venue access denied", attrs...)
}
