// Package shiftsapi is the HTTP transport of the shift domain:
// contracts/openapi/shifts.yaml. Venue-scoped paths and Nest-shaped error
// bodies, like the other Servvia Core APIs. There is no hardware here.
package shiftsapi

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"time"

	"servvia/services/core-platform/internal/identity"
	"servvia/services/core-platform/internal/platform/httpx"
	"servvia/services/core-platform/internal/shifts"
	"servvia/services/core-platform/internal/venues"
)

// Roles may open their own shift and read or close shifts they may access
// (their own; supervisors any at the venue): the repository's financial
// roles. Not kitchen, not viewer.
var Roles = []string{identity.RoleAdmin, identity.RoleManager, identity.RoleCashier}

// VenueResolver finds a venue within an organization (venues.Store).
type VenueResolver interface {
	VenueInOrganization(ctx context.Context, venueID, organizationID string) (venues.Venue, bool, error)
}

type Handler struct {
	svc    *shifts.Service
	venues VenueResolver
	logger *slog.Logger
}

func NewHandler(svc *shifts.Service, v VenueResolver, logger *slog.Logger) *Handler {
	return &Handler{svc: svc, venues: v, logger: logger}
}

type shiftJSON struct {
	ID                string  `json:"id"`
	VenueID           string  `json:"venueId"`
	StaffID           string  `json:"staffId"`
	Status            string  `json:"status"`
	Currency          string  `json:"currency"`
	OpeningFloatCents int64   `json:"openingFloatCents"`
	TerminalID        *string `json:"terminalId"`
	CashSalesCents    int64   `json:"cashSalesCents"`
	CashRefundsCents  int64   `json:"cashRefundsCents"`
	MovementCount     int     `json:"movementCount"`
	ExpectedCashCents int64   `json:"expectedCashCents"`
	CountedCashCents  *int64  `json:"countedCashCents"`
	VarianceCents     *int64  `json:"varianceCents"`
	Version           int     `json:"version"`
	IdempotencyKey    string  `json:"idempotencyKey"`
	OpenedAt          string  `json:"openedAt"`
	ClosedAt          *string `json:"closedAt"`
	ClosedByStaffID   *string `json:"closedByStaffId"`
	UpdatedAt         string  `json:"updatedAt"`
}

func timestamp(t time.Time) string { return t.UTC().Format("2006-01-02T15:04:05.000Z") }

func toJSON(s shifts.Shift) shiftJSON {
	j := shiftJSON{ID: s.ID, VenueID: s.VenueID, StaffID: s.StaffID, Status: string(s.Status), Currency: s.Currency,
		OpeningFloatCents: s.OpeningFloatCents, TerminalID: s.TerminalID, CashSalesCents: s.CashSalesCents, CashRefundsCents: s.CashRefundsCents, MovementCount: s.MovementCount,
		ExpectedCashCents: s.Expected(), CountedCashCents: s.CountedCashCents, VarianceCents: s.VarianceCents,
		Version: s.Version, IdempotencyKey: s.OpenRequestKey, OpenedAt: timestamp(s.OpenedAt),
		ClosedByStaffID: s.ClosedByStaffID, UpdatedAt: timestamp(s.UpdatedAt)}
	if s.ClosedAt != nil {
		c := timestamp(*s.ClosedAt)
		j.ClosedAt = &c
	}
	return j
}

// Open serves POST /api/venues/{venueId}/shifts: the caller's own shift. 201
// when this request opened it, 200 for a replay.
func (h *Handler) Open(w http.ResponseWriter, r *http.Request) {
	sc, actor, ok := h.scope(w, r)
	if !ok {
		return
	}
	var body struct {
		OpeningFloatCents *int64  `json:"openingFloatCents"`
		TerminalID        *string `json:"terminalId"`
		IdempotencyKey    string  `json:"idempotencyKey"`
	}
	if !decode(w, r, &body) {
		return
	}
	if body.OpeningFloatCents == nil {
		httpx.WriteError(w, http.StatusBadRequest, "openingFloatCents must be an integer from 0 to 2147483647")
		return
	}
	s, created, err := h.svc.Open(r.Context(), shifts.OpenCommand{Scope: sc, OpeningFloatCents: *body.OpeningFloatCents,
		TerminalID: body.TerminalID, RequestKey: body.IdempotencyKey, Actor: actor})
	if err != nil {
		h.respondError(w, r, err)
		return
	}
	status := http.StatusOK
	if created {
		status = http.StatusCreated
	}
	httpx.WriteJSON(w, status, toJSON(s))
}

// List serves GET /api/venues/{venueId}/shifts[?status=&staffId=].
func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
	sc, actor, ok := h.scope(w, r)
	if !ok {
		return
	}
	found, err := h.svc.List(r.Context(), sc, actor, shifts.Filter{Status: shifts.Status(r.URL.Query().Get("status")),
		StaffID: r.URL.Query().Get("staffId")})
	if err != nil {
		h.respondError(w, r, err)
		return
	}
	out := make([]shiftJSON, 0, len(found))
	for _, s := range found {
		out = append(out, toJSON(s))
	}
	httpx.WriteJSON(w, http.StatusOK, out)
}

// Get serves GET /api/venues/{venueId}/shifts/{shiftId}.
func (h *Handler) Get(w http.ResponseWriter, r *http.Request) {
	sc, actor, ok := h.scope(w, r)
	if !ok {
		return
	}
	s, err := h.svc.Get(r.Context(), sc, actor, r.PathValue("shiftId"))
	if err != nil {
		h.respondError(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, toJSON(s))
}

// Close serves POST /api/venues/{venueId}/shifts/{shiftId}/close with the
// counted cash; the server computes expected cash and variance.
func (h *Handler) Close(w http.ResponseWriter, r *http.Request) {
	sc, actor, ok := h.scope(w, r)
	if !ok {
		return
	}
	var body struct {
		Version          *int   `json:"version"`
		CountedCashCents *int64 `json:"countedCashCents"`
	}
	if !decode(w, r, &body) {
		return
	}
	switch {
	case body.Version == nil:
		httpx.WriteError(w, http.StatusBadRequest, "version must be a positive integer")
		return
	case body.CountedCashCents == nil:
		httpx.WriteError(w, http.StatusBadRequest, "countedCashCents must be an integer from 0 to 2147483647")
		return
	}
	s, _, err := h.svc.Close(r.Context(), shifts.CloseCommand{Scope: sc, ShiftID: r.PathValue("shiftId"),
		ExpectedVersion: *body.Version, CountedCashCents: *body.CountedCashCents, Actor: actor})
	if err != nil {
		h.respondError(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, toJSON(s))
}

func (h *Handler) scope(w http.ResponseWriter, r *http.Request) (shifts.Scope, shifts.Actor, bool) {
	p, ok := identity.PrincipalFrom(r.Context())
	if !ok {
		httpx.WriteInternalError(w)
		return shifts.Scope{}, shifts.Actor{}, false
	}
	venueID, err := identity.ResolveVenueScope(p, r.PathValue("venueId"))
	if err != nil {
		httpx.WriteError(w, http.StatusForbidden, err.Error())
		return shifts.Scope{}, shifts.Actor{}, false
	}
	v, found, err := h.venues.VenueInOrganization(r.Context(), venueID, p.OrganizationID)
	if err != nil {
		h.fail(w, r, err)
		return shifts.Scope{}, shifts.Actor{}, false
	}
	if !found {
		httpx.WriteError(w, http.StatusNotFound, "Venue not found")
		return shifts.Scope{}, shifts.Actor{}, false
	}
	return shifts.Scope{OrganizationID: p.OrganizationID, VenueID: v.ID, Currency: v.Tax.Currency},
		shifts.Actor{StaffID: p.ID, Email: p.Email, Role: p.Role}, true
}

func decode(w http.ResponseWriter, r *http.Request, into any) bool {
	raw, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 16<<10))
	if err == nil {
		err = json.Unmarshal(raw, into)
	}
	if err != nil {
		var typeErr *json.UnmarshalTypeError
		msg := "Request body must be a JSON object"
		if errors.As(err, &typeErr) && typeErr.Field != "" {
			msg = typeErr.Field + " has the wrong type"
		}
		httpx.WriteError(w, http.StatusBadRequest, msg)
		return false
	}
	return true
}

type coded struct {
	Message        string `json:"message"`
	Error          string `json:"error"`
	StatusCode     int    `json:"statusCode"`
	Code           string `json:"code"`
	ShiftID        string `json:"shiftId,omitempty"`
	CurrentVersion int    `json:"currentVersion,omitempty"`
}

func writeCoded(w http.ResponseWriter, status int, c coded) {
	c.Error, c.StatusCode = http.StatusText(status), status
	httpx.WriteJSON(w, status, c)
}

func (h *Handler) respondError(w http.ResponseWriter, r *http.Request, err error) {
	var (
		validation *shifts.ValidationError
		already    *shifts.AlreadyOpenError
		idem       *shifts.IdempotencyConflictError
		notOpen    *shifts.NotOpenError
		version    *shifts.VersionConflictError
	)
	switch {
	case errors.As(err, &validation):
		httpx.WriteError(w, http.StatusBadRequest, validation.Message)
	case errors.As(err, &already):
		writeCoded(w, http.StatusConflict, coded{Message: already.Error(), Code: "SHIFT_ALREADY_OPEN", ShiftID: already.ShiftID})
	case errors.As(err, &idem):
		writeCoded(w, http.StatusConflict, coded{Message: idem.Error(), Code: "IDEMPOTENCY_CONFLICT", ShiftID: idem.ShiftID})
	case errors.As(err, &notOpen):
		writeCoded(w, http.StatusConflict, coded{Message: notOpen.Error(), Code: "SHIFT_NOT_OPEN"})
	case errors.As(err, &version):
		writeCoded(w, http.StatusConflict, coded{Message: version.Error(), Code: "VERSION_CONFLICT", CurrentVersion: version.Current})
	case errors.Is(err, shifts.ErrShiftNotFound), errors.Is(err, shifts.ErrTerminalNotFound):
		httpx.WriteError(w, http.StatusNotFound, err.Error())
	case errors.Is(err, shifts.ErrTerminalDisabled):
		writeCoded(w, http.StatusConflict, coded{Message: err.Error(), Code: "TERMINAL_DISABLED"})
	case errors.Is(err, shifts.ErrUnknownActor):
		httpx.WriteError(w, http.StatusForbidden, err.Error())
	case errors.Is(err, shifts.ErrWritesDisabled):
		writeCoded(w, http.StatusServiceUnavailable, coded{Message: err.Error(), Code: "SHIFT_WRITES_DISABLED"})
	default:
		h.fail(w, r, err)
	}
}

func (h *Handler) fail(w http.ResponseWriter, r *http.Request, err error) {
	h.logger.ErrorContext(r.Context(), "shift request failed", "error", err, "request_id", httpx.RequestIDFrom(r.Context()))
	httpx.WriteInternalError(w)
}
