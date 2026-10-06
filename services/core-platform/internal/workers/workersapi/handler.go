// Package workersapi exposes the worker backlog (Phase D13): per consumer,
// how many deliveries are pending, retrying, leased and failed, and the age
// of the oldest pending one, for the caller's organization only. Never
// payloads, event contents, ids or errors.
package workersapi

import (
	"log/slog"
	"net/http"

	"github.com/jackc/pgx/v5/pgxpool"

	"servvia/services/core-platform/internal/identity"
	"servvia/services/core-platform/internal/platform/httpx"
	"servvia/services/core-platform/internal/workers"
)

// Roles may read the backlog (owner implied), from a staff login session.
var Roles = []string{identity.RoleAdmin}

type Handler struct {
	pool   *pgxpool.Pool
	logger *slog.Logger
}

func NewHandler(pool *pgxpool.Pool, logger *slog.Logger) *Handler {
	return &Handler{pool: pool, logger: logger}
}

// Backlog serves GET /api/admin/workers. The route admits a staff login
// session only, which is organization-wide, so the scope is the verified
// token's organization; no request parameter can widen or change it.
func (h *Handler) Backlog(w http.ResponseWriter, r *http.Request) {
	p, ok := identity.PrincipalFrom(r.Context())
	if !ok || p.OrganizationID == "" {
		httpx.WriteError(w, http.StatusUnauthorized, "Unauthorized")
		return
	}
	b, err := workers.Backlogs(r.Context(), h.pool, p.OrganizationID)
	if err != nil {
		h.logger.ErrorContext(r.Context(), "worker backlog failed", "error", err, "request_id", httpx.RequestIDFrom(r.Context()))
		httpx.WriteInternalError(w)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"consumers": b})
}
