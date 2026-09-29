// Package health serves liveness (/health) and readiness (/ready).
//
// Liveness never touches dependencies: a slow database must not get a healthy
// process restarted. Readiness reports whether this instance should receive
// traffic: PostgreSQL answers within the timeout, and the process is not
// draining for shutdown.
package health

import (
	"context"
	"net/http"
	"sync/atomic"
	"time"

	"servvia/services/core-platform/internal/platform/httpx"
)

// Pinger is satisfied by *pgxpool.Pool.
type Pinger interface {
	Ping(ctx context.Context) error
}

type Handler struct {
	db       Pinger
	timeout  time.Duration
	draining atomic.Bool
}

func New(db Pinger, timeout time.Duration) *Handler {
	return &Handler{db: db, timeout: timeout}
}

// Drain marks the instance not-ready so load balancers stop routing to it
// before the HTTP server begins shutting down.
func (h *Handler) Drain() { h.draining.Store(true) }

type status struct {
	Status   string `json:"status"`
	Database string `json:"database,omitempty"`
}

func (h *Handler) Live(w http.ResponseWriter, _ *http.Request) {
	httpx.WriteJSON(w, http.StatusOK, status{Status: "ok"})
}

func (h *Handler) Ready(w http.ResponseWriter, r *http.Request) {
	if h.draining.Load() {
		httpx.WriteJSON(w, http.StatusServiceUnavailable, status{Status: "draining"})
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), h.timeout)
	defer cancel()
	if err := h.db.Ping(ctx); err != nil {
		httpx.WriteJSON(w, http.StatusServiceUnavailable, status{Status: "unavailable", Database: "down"})
		return
	}
	httpx.WriteJSON(w, http.StatusOK, status{Status: "ok", Database: "up"})
}
