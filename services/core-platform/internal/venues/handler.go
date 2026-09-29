package venues

import (
	"errors"
	"log/slog"
	"net/http"

	"servvia/services/core-platform/internal/identity"
	"servvia/services/core-platform/internal/platform/httpx"
)

// TaxConfigRoles are the roles of GET /api/venues/{id}/tax-config. kitchen and
// viewer are included because KDS-mode and unelevated Order Tablet devices
// read it for their provisional bill (venues.controller.ts).
var TaxConfigRoles = []string{identity.RoleAdmin, identity.RoleManager, identity.RoleKitchen, identity.RoleViewer}

type Handler struct {
	store  Store
	logger *slog.Logger
}

func NewHandler(store Store, logger *slog.Logger) *Handler {
	return &Handler{store: store, logger: logger}
}

// TaxConfig serves GET /api/venues/{id}/tax-config, ported from
// VenuesController.getTaxConfig. Authentication, roles and the tablet
// revocation check are middleware (see server.Routes). Here: device tokens
// are pinned to their own venue (403), then the venue must belong to the
// caller's organization (404). The id is not validated as a UUID, as in Nest;
// an unknown id is simply not found.
func (h *Handler) TaxConfig(w http.ResponseWriter, r *http.Request) {
	p, ok := identity.PrincipalFrom(r.Context())
	if !ok {
		httpx.WriteInternalError(w)
		return
	}
	venueID, err := identity.ResolveVenueScope(p, r.PathValue("id"))
	if errors.Is(err, identity.ErrVenueForbidden) {
		httpx.WriteError(w, http.StatusForbidden, err.Error())
		return
	}
	v, found, err := h.store.VenueInOrganization(r.Context(), venueID, p.OrganizationID)
	if err != nil {
		h.logger.ErrorContext(r.Context(), "venue tax config read failed",
			"error", err, "request_id", httpx.RequestIDFrom(r.Context()))
		httpx.WriteInternalError(w)
		return
	}
	if !found {
		httpx.WriteError(w, http.StatusNotFound, "Venue not found")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, v.Tax)
}
