// Package kitchenapi is the HTTP transport of the kitchen-ticket domain:
// contracts/openapi/kitchen-tickets.yaml. Venue-scoped paths and Nest-shaped
// error bodies, like the table-session and order APIs.
package kitchenapi

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"servvia/services/core-platform/internal/identity"
	"servvia/services/core-platform/internal/kitchen"
	"servvia/services/core-platform/internal/platform/httpx"
	"servvia/services/core-platform/internal/venues"
)

// Roles may read and move kitchen tickets: the kitchen (a KDS device token
// carries role kitchen) and floor staff who run the pass. Not viewer.
var Roles = []string{identity.RoleAdmin, identity.RoleManager, identity.RoleCashier, identity.RoleKitchen}

// VenueResolver finds a venue within an organization (venues.Store).
type VenueResolver interface {
	VenueInOrganization(ctx context.Context, venueID, organizationID string) (venues.Venue, bool, error)
}

type Handler struct {
	svc    *kitchen.Service
	venues VenueResolver
	logger *slog.Logger
}

func NewHandler(svc *kitchen.Service, v VenueResolver, logger *slog.Logger) *Handler {
	return &Handler{svc: svc, venues: v, logger: logger}
}

// --- wire shapes -----------------------------------------------------------

type lineJSON struct {
	ID          string             `json:"id"`
	OrderItemID string             `json:"orderItemId"`
	Position    int                `json:"position"`
	Title       string             `json:"title"`
	Quantity    int64              `json:"quantity"`
	Modifiers   []kitchen.Modifier `json:"modifiers"`
	Notes       *string            `json:"notes"`
	Seat        *int               `json:"seat"`
}

type ticketJSON struct {
	ID                string     `json:"id"`
	VenueID           string     `json:"venueId"`
	OrderID           string     `json:"orderId"`
	RoundID           string     `json:"roundId"`
	RoundSequence     int        `json:"roundSequence"`
	Station           string     `json:"station"`
	Status            string     `json:"status"`
	Version           int        `json:"version"`
	TableNumber       *string    `json:"tableNumber"`
	TakeawayReference *string    `json:"takeawayReference"`
	OrderSource       string     `json:"orderSource"`
	Lines             []lineJSON `json:"lines"`
	AcknowledgedAt    *string    `json:"acknowledgedAt"`
	PreparingAt       *string    `json:"preparingAt"`
	ReadyAt           *string    `json:"readyAt"`
	CompletedAt       *string    `json:"completedAt"`
	RecalledAt        *string    `json:"recalledAt"`
	CreatedAt         string     `json:"createdAt"`
	UpdatedAt         string     `json:"updatedAt"`
}

func timestamp(t time.Time) string { return t.UTC().Format("2006-01-02T15:04:05.000Z") }

func optional(t *time.Time) *string {
	if t == nil {
		return nil
	}
	s := timestamp(*t)
	return &s
}

func toJSON(t kitchen.Ticket) ticketJSON {
	j := ticketJSON{ID: t.ID, VenueID: t.VenueID, OrderID: t.OrderID, RoundID: t.RoundID, RoundSequence: t.RoundSequence,
		Station: t.Station, Status: string(t.Status), Version: t.Version, TableNumber: t.TableNumber,
		TakeawayReference: t.TakeawayReference, OrderSource: t.OrderSource, Lines: []lineJSON{},
		AcknowledgedAt: optional(t.AcknowledgedAt), PreparingAt: optional(t.PreparingAt), ReadyAt: optional(t.ReadyAt),
		CompletedAt: optional(t.CompletedAt), RecalledAt: optional(t.RecalledAt),
		CreatedAt: timestamp(t.CreatedAt), UpdatedAt: timestamp(t.UpdatedAt)}
	for _, l := range t.Lines {
		mods := l.Modifiers
		if mods == nil {
			mods = []kitchen.Modifier{}
		}
		j.Lines = append(j.Lines, lineJSON{ID: l.ID, OrderItemID: l.OrderItemID, Position: l.Position, Title: l.Title,
			Quantity: l.Quantity, Modifiers: mods, Notes: l.Notes, Seat: l.Seat})
	}
	return j
}

// --- handlers ----------------------------------------------------------------

// List serves GET /api/venues/{venueId}/kitchen-tickets[?station=&status=a,b].
func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
	venueID, _, ok := h.scope(w, r)
	if !ok {
		return
	}
	f := kitchen.Filter{Station: r.URL.Query().Get("station")}
	if raw := r.URL.Query().Get("status"); raw != "" {
		for _, s := range strings.Split(raw, ",") {
			f.Statuses = append(f.Statuses, kitchen.Status(strings.TrimSpace(s)))
		}
	}
	tickets, err := h.svc.List(r.Context(), venueID, f)
	if err != nil {
		h.respondError(w, r, err)
		return
	}
	out := make([]ticketJSON, 0, len(tickets))
	for _, t := range tickets {
		out = append(out, toJSON(t))
	}
	httpx.WriteJSON(w, http.StatusOK, out)
}

// Get serves GET /api/venues/{venueId}/kitchen-tickets/{ticketId}.
func (h *Handler) Get(w http.ResponseWriter, r *http.Request) {
	venueID, _, ok := h.scope(w, r)
	if !ok {
		return
	}
	t, err := h.svc.Get(r.Context(), venueID, r.PathValue("ticketId"))
	if err != nil {
		h.respondError(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, toJSON(t))
}

// Transition serves POST /api/venues/{venueId}/kitchen-tickets/{ticketId}/transitions.
// 200 with the ticket, whether this request moved it or it was already in
// the requested status.
func (h *Handler) Transition(w http.ResponseWriter, r *http.Request) {
	venueID, actor, ok := h.scope(w, r)
	if !ok {
		return
	}
	var body struct {
		To      string `json:"to"`
		Version *int   `json:"version"`
	}
	raw, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 16<<10))
	if err == nil {
		err = json.Unmarshal(raw, &body)
	}
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "Request body must be a JSON object")
		return
	}
	if body.Version == nil {
		httpx.WriteError(w, http.StatusBadRequest, "version must be a positive integer")
		return
	}
	t, _, err := h.svc.Transition(r.Context(), kitchen.TransitionCommand{VenueID: venueID, TicketID: r.PathValue("ticketId"),
		To: kitchen.Status(body.To), ExpectedVersion: *body.Version, Actor: actor})
	if err != nil {
		h.respondError(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, toJSON(t))
}

// scope authorizes the path's venue as the other venue-scoped APIs do: a
// device token is pinned to its venue, and the venue must belong to the
// caller's organization (404 otherwise).
func (h *Handler) scope(w http.ResponseWriter, r *http.Request) (string, kitchen.Actor, bool) {
	p, ok := identity.PrincipalFrom(r.Context())
	if !ok {
		httpx.WriteInternalError(w)
		return "", kitchen.Actor{}, false
	}
	venueID, err := identity.ResolveVenueScope(p, r.PathValue("venueId"))
	if err != nil {
		httpx.WriteError(w, http.StatusForbidden, err.Error())
		return "", kitchen.Actor{}, false
	}
	v, found, err := h.venues.VenueInOrganization(r.Context(), venueID, p.OrganizationID)
	if err != nil {
		h.fail(w, r, err)
		return "", kitchen.Actor{}, false
	}
	if !found {
		httpx.WriteError(w, http.StatusNotFound, "Venue not found")
		return "", kitchen.Actor{}, false
	}
	kind := string(p.Kind)
	if p.Kind == identity.KindStaffSession {
		kind = "staff_session"
	}
	return v.ID, kitchen.Actor{ID: p.ID, Kind: kind, Role: p.Role}, true
}

// coded is a Nest-shaped error with a machine-readable code.
type coded struct {
	Message    string `json:"message"`
	Error      string `json:"error"`
	StatusCode int    `json:"statusCode"`
	Code       string `json:"code"`
	Status     string `json:"ticketStatus,omitempty"`
	Version    int    `json:"currentVersion,omitempty"`
}

func writeCoded(w http.ResponseWriter, status int, c coded) {
	c.Error, c.StatusCode = http.StatusText(status), status
	httpx.WriteJSON(w, status, c)
}

func (h *Handler) respondError(w http.ResponseWriter, r *http.Request, err error) {
	var (
		validation *kitchen.ValidationError
		transition *kitchen.TransitionError
		version    *kitchen.VersionConflictError
	)
	switch {
	case errors.As(err, &validation):
		httpx.WriteError(w, http.StatusBadRequest, validation.Message)
	case errors.As(err, &transition):
		writeCoded(w, http.StatusConflict, coded{Message: transition.Error(), Code: "INVALID_TRANSITION", Status: string(transition.From)})
	case errors.As(err, &version):
		writeCoded(w, http.StatusConflict, coded{Message: version.Error(), Code: "VERSION_CONFLICT", Version: version.Current})
	case errors.Is(err, kitchen.ErrTicketNotFound):
		httpx.WriteError(w, http.StatusNotFound, err.Error())
	case errors.Is(err, kitchen.ErrWritesDisabled):
		writeCoded(w, http.StatusServiceUnavailable, coded{Message: err.Error(), Code: "KITCHEN_WRITES_DISABLED"})
	default:
		h.fail(w, r, err)
	}
}

func (h *Handler) fail(w http.ResponseWriter, r *http.Request, err error) {
	h.logger.ErrorContext(r.Context(), "kitchen request failed", "error", err, "request_id", httpx.RequestIDFrom(r.Context()))
	httpx.WriteInternalError(w)
}
