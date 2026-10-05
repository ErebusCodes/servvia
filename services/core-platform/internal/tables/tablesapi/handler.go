// Package tablesapi is the HTTP transport of the table-session domain:
// contracts/openapi/table-sessions.yaml. It is new Servvia-native API with no
// NestJS equivalent. It follows the Nest routes' conventions (venue-scoped
// paths, Nest-shaped error bodies, the same guards) so clients see one API
// style.
package tablesapi

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"time"

	"servvia/services/core-platform/internal/audit"
	"servvia/services/core-platform/internal/identity"
	"servvia/services/core-platform/internal/platform/httpx"
	"servvia/services/core-platform/internal/tables"
	"servvia/services/core-platform/internal/venues"
)

// Roles may read and change table sessions: the staff who run the floor.
// owner always passes (RolesGuard). kitchen and viewer (KDS screens and
// unelevated customer tablets) may not, and identity.RequireStaff refuses
// device tokens whatever their role.
var Roles = []string{identity.RoleAdmin, identity.RoleManager, identity.RoleCashier}

// VenueResolver finds a venue within an organization (venues.Store).
type VenueResolver interface {
	VenueInOrganization(ctx context.Context, venueID, organizationID string) (venues.Venue, bool, error)
}

type Handler struct {
	svc    *tables.Service
	venues VenueResolver
	logger *slog.Logger
}

func NewHandler(svc *tables.Service, v VenueResolver, logger *slog.Logger) *Handler {
	return &Handler{svc: svc, venues: v, logger: logger}
}

// sessionJSON is the TableSession representation.
type sessionJSON struct {
	ID              string  `json:"id"`
	VenueID         string  `json:"venueId"`
	TableID         string  `json:"tableId"`
	TableNumber     string  `json:"tableNumber"`
	Status          string  `json:"status"`
	Covers          int     `json:"covers"`
	OpenedByStaffID *string `json:"openedByStaffId"`
	Version         int     `json:"version"`
	OpenedAt        string  `json:"openedAt"`
	ClosedAt        *string `json:"closedAt"`
	CreatedAt       string  `json:"createdAt"`
	UpdatedAt       string  `json:"updatedAt"`
}

// timestamp matches how the NestJS API serialises a DateTime (JS Date JSON).
func timestamp(t time.Time) string { return t.UTC().Format("2006-01-02T15:04:05.000Z") }

func toJSON(s tables.Session) sessionJSON {
	j := sessionJSON{
		ID: s.ID, VenueID: s.VenueID, TableID: s.TableID, TableNumber: s.TableNumber, Status: string(s.Status),
		Covers: s.Covers, OpenedByStaffID: s.OpenedByStaffID, Version: s.Version,
		OpenedAt: timestamp(s.OpenedAt), CreatedAt: timestamp(s.CreatedAt), UpdatedAt: timestamp(s.UpdatedAt),
	}
	if s.ClosedAt != nil {
		c := timestamp(*s.ClosedAt)
		j.ClosedAt = &c
	}
	return j
}

// scope authorizes the path's venue for the caller: a device-scoped token
// only reaches its own venue (403), and the venue must belong to the
// caller's organization (404). ok=false means a response was written.
func (h *Handler) scope(w http.ResponseWriter, r *http.Request) (tables.Scope, tables.Actor, bool) {
	p, ok := identity.PrincipalFrom(r.Context())
	if !ok {
		httpx.WriteInternalError(w)
		return tables.Scope{}, tables.Actor{}, false
	}
	venueID, err := identity.ResolveVenueScope(p, r.PathValue("venueId"))
	if err != nil {
		httpx.WriteError(w, http.StatusForbidden, err.Error())
		return tables.Scope{}, tables.Actor{}, false
	}
	if _, found, err := h.venues.VenueInOrganization(r.Context(), venueID, p.OrganizationID); err != nil {
		h.fail(w, r, err)
		return tables.Scope{}, tables.Actor{}, false
	} else if !found {
		httpx.WriteError(w, http.StatusNotFound, "Venue not found")
		return tables.Scope{}, tables.Actor{}, false
	}
	return tables.Scope{OrganizationID: p.OrganizationID, VenueID: venueID},
		tables.Actor{StaffID: p.ID, Email: p.Email, Role: p.Role, Device: audit.DeviceOf(p)}, true
}

// ListOpen serves GET /api/venues/{venueId}/table-sessions: the open sessions.
func (h *Handler) ListOpen(w http.ResponseWriter, r *http.Request) {
	sc, _, ok := h.scope(w, r)
	if !ok {
		return
	}
	list, err := h.svc.ListOpen(r.Context(), sc)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	out := make([]sessionJSON, 0, len(list))
	for _, s := range list {
		out = append(out, toJSON(s))
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"sessions": out})
}

// Open serves POST /api/venues/{venueId}/tables/{tableId}/sessions.
// 201 when this request opened the session, 200 when it is a retry of one
// that already did (same idempotencyKey on the same table).
func (h *Handler) Open(w http.ResponseWriter, r *http.Request) {
	sc, actor, ok := h.scope(w, r)
	if !ok {
		return
	}
	var body struct {
		Covers         *int    `json:"covers"`
		IdempotencyKey *string `json:"idempotencyKey"`
	}
	if !decode(w, r, &body) {
		return
	}
	if body.Covers == nil {
		h.write(w, r, tables.ValidateCovers(0), tables.Session{})
		return
	}
	key := ""
	if body.IdempotencyKey != nil {
		key = *body.IdempotencyKey
	}
	s, created, err := h.svc.Open(r.Context(), tables.OpenCommand{
		Scope: sc, TableID: r.PathValue("tableId"), Covers: *body.Covers, RequestKey: key, Actor: actor,
	})
	if err == nil && created {
		httpx.WriteJSON(w, http.StatusCreated, toJSON(s))
		return
	}
	h.write(w, r, err, s)
}

// ActiveForTable serves GET /api/venues/{venueId}/tables/{tableId}/active-session.
func (h *Handler) ActiveForTable(w http.ResponseWriter, r *http.Request) {
	sc, _, ok := h.scope(w, r)
	if !ok {
		return
	}
	s, err := h.svc.OpenForTable(r.Context(), sc, r.PathValue("tableId"))
	h.write(w, r, err, s)
}

// Get serves GET /api/venues/{venueId}/table-sessions/{sessionId}.
func (h *Handler) Get(w http.ResponseWriter, r *http.Request) {
	sc, _, ok := h.scope(w, r)
	if !ok {
		return
	}
	s, err := h.svc.Get(r.Context(), sc, r.PathValue("sessionId"))
	h.write(w, r, err, s)
}

// Update serves PATCH /api/venues/{venueId}/table-sessions/{sessionId}.
// covers is the only field that can change.
func (h *Handler) Update(w http.ResponseWriter, r *http.Request) {
	sc, actor, ok := h.scope(w, r)
	if !ok {
		return
	}
	var body struct {
		Covers  *int `json:"covers"`
		Version *int `json:"version"`
	}
	if !decode(w, r, &body) {
		return
	}
	if body.Version == nil {
		h.write(w, r, tables.ValidateVersion(0), tables.Session{})
		return
	}
	if body.Covers == nil {
		h.write(w, r, tables.ValidateCovers(0), tables.Session{})
		return
	}
	s, err := h.svc.UpdateCovers(r.Context(), sc, r.PathValue("sessionId"), *body.Version, *body.Covers, actor)
	h.write(w, r, err, s)
}

// Close serves POST /api/venues/{venueId}/table-sessions/{sessionId}/close.
func (h *Handler) Close(w http.ResponseWriter, r *http.Request) { h.end(w, r, h.svc.Close) }

// Cancel serves POST /api/venues/{venueId}/table-sessions/{sessionId}/cancel.
func (h *Handler) Cancel(w http.ResponseWriter, r *http.Request) { h.end(w, r, h.svc.Cancel) }

type endFunc func(context.Context, tables.Scope, string, int, tables.Actor) (tables.Session, error)

func (h *Handler) end(w http.ResponseWriter, r *http.Request, do endFunc) {
	sc, actor, ok := h.scope(w, r)
	if !ok {
		return
	}
	var body struct {
		Version *int `json:"version"`
	}
	if !decode(w, r, &body) {
		return
	}
	if body.Version == nil {
		h.write(w, r, tables.ValidateVersion(0), tables.Session{})
		return
	}
	s, err := do(r.Context(), sc, r.PathValue("sessionId"), *body.Version, actor)
	h.write(w, r, err, s)
}

// decode reads a JSON object body. Unknown fields are ignored, as Nest's
// ValidationPipe({whitelist: true}) strips them; a value of the wrong type is
// a 400.
func decode(w http.ResponseWriter, r *http.Request, into any) bool {
	raw, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 16<<10))
	if err == nil {
		err = json.Unmarshal(raw, into)
	}
	if err != nil {
		var typeErr *json.UnmarshalTypeError
		msg := "Request body must be a JSON object"
		if errors.As(err, &typeErr) && typeErr.Field != "" {
			msg = typeMessage(typeErr.Field)
		}
		httpx.WriteError(w, http.StatusBadRequest, msg)
		return false
	}
	return true
}

func typeMessage(field string) string {
	switch field {
	case "covers":
		return tables.ValidateCovers(0).Error()
	case "idempotencyKey":
		return tables.ValidateRequestKey("").Error()
	case "version":
		return tables.ValidateVersion(0).Error()
	}
	return "Request body must be a JSON object"
}

// conflict is the 409 body: Nest's shape plus a machine-readable code.
type conflict struct {
	Message         string `json:"message"`
	Error           string `json:"error"`
	StatusCode      int    `json:"statusCode"`
	Code            string `json:"code"`
	ActiveSessionID string `json:"activeSessionId,omitempty"`
	CurrentVersion  int    `json:"currentVersion,omitempty"`
	Status          string `json:"status,omitempty"`
	// Readiness says why a visit cannot close (VISIT_NOT_FINANCIALLY_COMPLETE).
	Readiness *readinessJSON `json:"readiness,omitempty"`
}

// readinessJSON is the server's close-readiness verdict: four counts that
// must all be zero. No payment or provider detail.
type readinessJSON struct {
	OpenChecks            int `json:"openChecks"`
	UnbilledLines         int `json:"unbilledLines"`
	UnresolvedPayments    int `json:"unresolvedPayments"`
	UnresolvedAdjustments int `json:"unresolvedAdjustments"`
}

// write sends the session, or maps the error to its contract response.
func (h *Handler) write(w http.ResponseWriter, r *http.Request, err error, s tables.Session) {
	var (
		validation *tables.ValidationError
		open       *tables.AlreadyOpenError
		notOpen    *tables.NotOpenError
		stale      *tables.VersionConflictError
		incomplete *tables.NotCompleteError
	)
	c := conflict{Error: "Conflict", StatusCode: http.StatusConflict}
	switch {
	case err == nil:
		httpx.WriteJSON(w, http.StatusOK, toJSON(s))
		return
	case errors.As(err, &validation):
		httpx.WriteError(w, http.StatusBadRequest, validation.Message)
		return
	case errors.Is(err, tables.ErrTableNotFound), errors.Is(err, tables.ErrSessionNotFound):
		httpx.WriteError(w, http.StatusNotFound, err.Error())
		return
	case errors.Is(err, tables.ErrNoOpenSession):
		httpx.WriteJSON(w, http.StatusNotFound, conflict{Message: err.Error(), Error: "Not Found",
			StatusCode: http.StatusNotFound, Code: "NO_OPEN_SESSION"})
		return
	case errors.Is(err, tables.ErrUnknownActor):
		httpx.WriteError(w, http.StatusForbidden, err.Error())
		return
	case errors.Is(err, tables.ErrWritesDisabled):
		httpx.WriteJSON(w, http.StatusServiceUnavailable, conflict{Message: err.Error(), Error: "Service Unavailable",
			StatusCode: http.StatusServiceUnavailable, Code: "TABLE_SESSION_WRITES_DISABLED"})
		return
	case errors.Is(err, tables.ErrTableInactive):
		c.Message, c.Code = err.Error(), "TABLE_INACTIVE"
	case errors.Is(err, tables.ErrTableHasActiveOrder):
		c.Message, c.Code = err.Error(), "TABLE_HAS_ACTIVE_ORDER"
	case errors.Is(err, tables.ErrSessionHasOrders):
		c.Message, c.Code = err.Error(), "TABLE_SESSION_HAS_ORDERS"
	case errors.As(err, &open):
		c.Message, c.Code, c.ActiveSessionID = open.Error(), "TABLE_SESSION_ALREADY_OPEN", open.SessionID
	case errors.As(err, &notOpen):
		c.Message, c.Code, c.Status = notOpen.Error(), "TABLE_SESSION_NOT_OPEN", string(notOpen.Status)
	case errors.As(err, &stale):
		c.Message, c.Code, c.CurrentVersion = stale.Error(), "VERSION_CONFLICT", stale.Current
	case errors.As(err, &incomplete):
		r := incomplete.Readiness
		c.Message, c.Code = incomplete.Error(), "VISIT_NOT_FINANCIALLY_COMPLETE"
		c.Readiness = &readinessJSON{OpenChecks: r.OpenChecks, UnbilledLines: r.UnbilledLines,
			UnresolvedPayments: r.UnresolvedPayments, UnresolvedAdjustments: r.UnresolvedAdjustments}
	default:
		h.fail(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusConflict, c)
}

func (h *Handler) fail(w http.ResponseWriter, r *http.Request, err error) {
	h.logger.ErrorContext(r.Context(), "table session request failed",
		"error", err, "request_id", httpx.RequestIDFrom(r.Context()))
	httpx.WriteInternalError(w)
}
