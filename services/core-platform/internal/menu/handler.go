package menu

import (
	"log/slog"
	"net/http"
	"regexp"

	"servvia/services/core-platform/internal/platform/httpx"
)

// uuidPattern is ParseUUIDPipe's default ("all" versions) pattern from
// @nestjs/common: any 8-4-4-4-12 hex UUID, case-insensitive.
var uuidPattern = regexp.MustCompile(`(?i)^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$`)

type Handler struct {
	store  Store
	logger *slog.Logger
}

func NewHandler(store Store, logger *slog.Logger) *Handler {
	return &Handler{store: store, logger: logger}
}

// ChannelMenu serves GET /api/menu/venues/{venueId}/channel/{channel}.
// Checks run in Nest's order: UUID pipe (400), channel (404), active venue (404).
// Routing, CORS, CSRF cookie, ETag/304 and the shared Redis rate limit
// (120/60 s) are applied around it in server.Routes.
func (h *Handler) ChannelMenu(w http.ResponseWriter, r *http.Request) {
	venueID := r.PathValue("venueId")
	if !uuidPattern.MatchString(venueID) {
		httpx.WriteError(w, http.StatusBadRequest, "Validation failed (uuid is expected)")
		return
	}
	channel, ok := ParseChannel(r.PathValue("channel"))
	if !ok {
		// Same text as Nest's template literal `Unknown channel "${channel}"`.
		httpx.WriteError(w, http.StatusNotFound, `Unknown channel "`+r.PathValue("channel")+`"`)
		return
	}

	org, found, err := h.store.ActiveVenueOrganization(r.Context(), venueID)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	if !found {
		httpx.WriteError(w, http.StatusNotFound, "Venue not found")
		return
	}

	snap, err := h.store.Snapshot(r.Context(), org, venueID, channel)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, Resolve(snap, channel))
}

func (h *Handler) fail(w http.ResponseWriter, r *http.Request, err error) {
	h.logger.ErrorContext(r.Context(), "channel menu read failed",
		"error", err, "request_id", httpx.RequestIDFrom(r.Context()))
	httpx.WriteInternalError(w)
}
