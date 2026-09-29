// Package promotionsapi is the HTTP transport of the promotion domain
// (contracts/openapi/promotions.yaml): venue-scoped administration of
// promotions. Applying a promotion is not here: it is part of placing an
// order or a round (servvia-orders.yaml), so there is no endpoint a client
// could use to compute or assert a discount on its own.
package promotionsapi

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"servvia/services/core-platform/internal/identity"
	"servvia/services/core-platform/internal/platform/httpx"
	"servvia/services/core-platform/internal/promotions"
	"servvia/services/core-platform/internal/venues"
)

// AdminRoles may create, change, activate and deactivate promotions, from a
// staff login session (owner implied). Financial configuration: not a
// tablet, a KDS or a device.
var AdminRoles = []string{identity.RoleAdmin, identity.RoleManager}

// ReadRoles may read a venue's promotions (a cashier chooses one for an
// order). Owner implied.
var ReadRoles = []string{identity.RoleAdmin, identity.RoleManager, identity.RoleCashier}

// VenueResolver finds a venue within an organization (venues.Store).
type VenueResolver interface {
	VenueInOrganization(ctx context.Context, venueID, organizationID string) (venues.Venue, bool, error)
}

type Handler struct {
	svc    *promotions.Service
	venues VenueResolver
	logger *slog.Logger
}

func NewHandler(svc *promotions.Service, v VenueResolver, logger *slog.Logger) *Handler {
	return &Handler{svc: svc, venues: v, logger: logger}
}

// --- wire shapes -----------------------------------------------------------

type promotionJSON struct {
	ID               string   `json:"id"`
	VenueID          string   `json:"venueId"`
	Name             string   `json:"name"`
	Kind             string   `json:"kind"`
	BasisPoints      int64    `json:"basisPoints"`
	Target           string   `json:"target"`
	CategoryIDs      []string `json:"categoryIds"`
	MenuItemIDs      []string `json:"menuItemIds"`
	Status           string   `json:"status"`
	StartsAt         *string  `json:"startsAt"`
	EndsAt           *string  `json:"endsAt"`
	Version          int      `json:"version"`
	IdempotencyKey   string   `json:"idempotencyKey"`
	CreatedByStaffID string   `json:"createdByStaffId"`
	UpdatedByStaffID *string  `json:"updatedByStaffId"`
	CreatedAt        string   `json:"createdAt"`
	UpdatedAt        string   `json:"updatedAt"`
}

func timestamp(t time.Time) string { return t.UTC().Format("2006-01-02T15:04:05.000Z") }

func optional(t *time.Time) *string {
	if t == nil {
		return nil
	}
	s := timestamp(*t)
	return &s
}

func toJSON(p promotions.Promotion) promotionJSON {
	return promotionJSON{ID: p.ID, VenueID: p.VenueID, Name: p.Name, Kind: string(p.Kind), BasisPoints: p.BasisPoints,
		Target: string(p.Target), CategoryIDs: nonNil(p.CategoryIDs), MenuItemIDs: nonNil(p.MenuItemIDs),
		Status: string(p.Status), StartsAt: optional(p.StartsAt), EndsAt: optional(p.EndsAt), Version: p.Version,
		IdempotencyKey: p.CreateRequestKey, CreatedByStaffID: p.CreatedByStaffID, UpdatedByStaffID: p.UpdatedByStaffID,
		CreatedAt: timestamp(p.CreatedAt), UpdatedAt: timestamp(p.UpdatedAt)}
}

func nonNil(s []string) []string {
	if s == nil {
		return []string{}
	}
	return s
}

// --- handlers ----------------------------------------------------------------

// Create serves POST /api/venues/{venueId}/promotions: 201 created
// (inactive), 200 a replay of the same request.
func (h *Handler) Create(w http.ResponseWriter, r *http.Request) {
	sc, actor, ok := h.scope(w, r)
	if !ok {
		return
	}
	var body struct {
		Name           string    `json:"name"`
		Kind           string    `json:"kind"`
		BasisPoints    *int64    `json:"basisPoints"`
		Target         string    `json:"target"`
		CategoryIDs    []string  `json:"categoryIds"`
		MenuItemIDs    []string  `json:"menuItemIds"`
		StartsAt       *timeJSON `json:"startsAt"`
		EndsAt         *timeJSON `json:"endsAt"`
		IdempotencyKey string    `json:"idempotencyKey"`
	}
	if !decodeStrict(w, r, &body) {
		return
	}
	if body.BasisPoints == nil {
		httpx.WriteError(w, http.StatusBadRequest, "basisPoints is required")
		return
	}
	p, created, err := h.svc.Create(r.Context(), promotions.CreateCommand{Scope: sc, IdempotencyKey: body.IdempotencyKey, Actor: actor,
		Terms: promotions.Terms{Name: body.Name, Kind: promotions.Kind(body.Kind), BasisPoints: *body.BasisPoints,
			Target: promotions.Target(body.Target), CategoryIDs: body.CategoryIDs, MenuItemIDs: body.MenuItemIDs,
			StartsAt: body.StartsAt.time(), EndsAt: body.EndsAt.time()}})
	switch {
	case err != nil:
		h.respondError(w, r, err)
	case created:
		httpx.WriteJSON(w, http.StatusCreated, toJSON(p))
	default:
		httpx.WriteJSON(w, http.StatusOK, toJSON(p))
	}
}

// List serves GET /api/venues/{venueId}/promotions[?status=active].
func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
	sc, _, ok := h.scope(w, r)
	if !ok {
		return
	}
	var f promotions.Filter
	for _, s := range r.URL.Query()["status"] {
		f.Statuses = append(f.Statuses, promotions.Status(s))
	}
	found, err := h.svc.List(r.Context(), sc, f)
	if err != nil {
		h.respondError(w, r, err)
		return
	}
	out := make([]promotionJSON, 0, len(found))
	for _, p := range found {
		out = append(out, toJSON(p))
	}
	httpx.WriteJSON(w, http.StatusOK, out)
}

// Get serves GET /api/venues/{venueId}/promotions/{promotionId}.
func (h *Handler) Get(w http.ResponseWriter, r *http.Request) {
	sc, _, ok := h.scope(w, r)
	if !ok {
		return
	}
	p, err := h.svc.Get(r.Context(), sc, r.PathValue("promotionId"))
	h.respond(w, r, p, err)
}

// Update serves PATCH /api/venues/{venueId}/promotions/{promotionId}: a
// version-checked change of the terms. Absent fields are kept; startsAt or
// endsAt null removes that bound.
func (h *Handler) Update(w http.ResponseWriter, r *http.Request) {
	sc, actor, ok := h.scope(w, r)
	if !ok {
		return
	}
	raw := map[string]json.RawMessage{}
	if !decode(w, r, &raw) {
		return
	}
	var version int
	var patch promotions.Patch
	fields := map[string]func(json.RawMessage) error{
		"version":     func(v json.RawMessage) error { return json.Unmarshal(v, &version) },
		"name":        func(v json.RawMessage) error { return nonNull(v, &patch.Name) },
		"basisPoints": func(v json.RawMessage) error { return nonNull(v, &patch.BasisPoints) },
		"target":      func(v json.RawMessage) error { return nonNull(v, &patch.Target) },
		"categoryIds": func(v json.RawMessage) error { return nonNull(v, &patch.CategoryIDs) },
		"menuItemIds": func(v json.RawMessage) error { return nonNull(v, &patch.MenuItemIDs) },
		"startsAt":    func(v json.RawMessage) error { return bound(v, &patch.StartsAt, &patch.ClearStartsAt) },
		"endsAt":      func(v json.RawMessage) error { return bound(v, &patch.EndsAt, &patch.ClearEndsAt) },
	}
	for name, v := range raw {
		set, known := fields[name]
		if !known {
			httpx.WriteError(w, http.StatusBadRequest, "property "+name+" should not exist")
			return
		}
		if err := set(v); err != nil {
			httpx.WriteError(w, http.StatusBadRequest, name+" has the wrong type")
			return
		}
	}
	p, _, err := h.svc.Update(r.Context(), promotions.Change{Scope: sc, PromotionID: r.PathValue("promotionId"),
		ExpectedVersion: version, Actor: actor}, patch)
	h.respond(w, r, p, err)
}

// Activate serves POST .../promotions/{promotionId}/activate.
func (h *Handler) Activate(w http.ResponseWriter, r *http.Request) {
	if c, ok := h.change(w, r); ok {
		p, _, err := h.svc.Activate(r.Context(), c)
		h.respond(w, r, p, err)
	}
}

// Deactivate serves POST .../promotions/{promotionId}/deactivate.
func (h *Handler) Deactivate(w http.ResponseWriter, r *http.Request) {
	if c, ok := h.change(w, r); ok {
		p, _, err := h.svc.Deactivate(r.Context(), c)
		h.respond(w, r, p, err)
	}
}

func (h *Handler) change(w http.ResponseWriter, r *http.Request) (promotions.Change, bool) {
	sc, actor, ok := h.scope(w, r)
	if !ok {
		return promotions.Change{}, false
	}
	var body struct {
		Version int `json:"version"`
	}
	if !decodeStrict(w, r, &body) {
		return promotions.Change{}, false
	}
	return promotions.Change{Scope: sc, PromotionID: r.PathValue("promotionId"), ExpectedVersion: body.Version, Actor: actor}, true
}

// scope authorizes the path's venue like every venue-scoped API: the venue
// must be in the caller's scope and of the caller's organization (404
// otherwise, telling nothing about other organizations).
func (h *Handler) scope(w http.ResponseWriter, r *http.Request) (promotions.Scope, promotions.Actor, bool) {
	p, ok := identity.PrincipalFrom(r.Context())
	if !ok {
		httpx.WriteInternalError(w)
		return promotions.Scope{}, promotions.Actor{}, false
	}
	venueID, err := identity.ResolveVenueScope(p, r.PathValue("venueId"))
	if err != nil {
		httpx.WriteError(w, http.StatusForbidden, err.Error())
		return promotions.Scope{}, promotions.Actor{}, false
	}
	v, found, err := h.venues.VenueInOrganization(r.Context(), venueID, p.OrganizationID)
	if err != nil {
		h.fail(w, r, err)
		return promotions.Scope{}, promotions.Actor{}, false
	}
	if !found {
		httpx.WriteError(w, http.StatusNotFound, "Venue not found")
		return promotions.Scope{}, promotions.Actor{}, false
	}
	return promotions.Scope{OrganizationID: p.OrganizationID, VenueID: v.ID},
		promotions.Actor{StaffID: p.ID, Email: p.Email, Role: p.Role}, true
}

// --- decoding ----------------------------------------------------------------

// timeJSON is an RFC 3339 instant with an explicit offset.
type timeJSON struct{ t time.Time }

func (j *timeJSON) UnmarshalJSON(b []byte) error {
	var s string
	if err := json.Unmarshal(b, &s); err != nil {
		return err
	}
	t, err := time.Parse(time.RFC3339Nano, s)
	j.t = t
	return err
}

func (j *timeJSON) time() *time.Time {
	if j == nil {
		return nil
	}
	return &j.t
}

func nonNull[T any](v json.RawMessage, into **T) error {
	if bytes.Equal(bytes.TrimSpace(v), []byte("null")) {
		return errors.New("null")
	}
	var t T
	if err := json.Unmarshal(v, &t); err != nil {
		return err
	}
	*into = &t
	return nil
}

func bound(v json.RawMessage, into **time.Time, clear *bool) error {
	if bytes.Equal(bytes.TrimSpace(v), []byte("null")) {
		*clear = true
		return nil
	}
	var t timeJSON
	if err := json.Unmarshal(v, &t); err != nil {
		return err
	}
	*into = &t.t
	return nil
}

func read(w http.ResponseWriter, r *http.Request) ([]byte, bool) {
	raw, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 64<<10))
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "Request body must be a JSON object")
		return nil, false
	}
	return raw, true
}

func badBody(w http.ResponseWriter, err error) {
	var typeErr *json.UnmarshalTypeError
	msg := "Request body must be a JSON object"
	switch {
	case errors.As(err, &typeErr) && typeErr.Field != "":
		msg = typeErr.Field + " has the wrong type"
	case strings.HasPrefix(err.Error(), "json: unknown field "):
		msg = "property " + strings.Trim(strings.TrimPrefix(err.Error(), "json: unknown field "), `"`) + " should not exist"
	case strings.HasPrefix(err.Error(), "parsing time"):
		msg = "startsAt and endsAt must be RFC 3339 instants"
	}
	httpx.WriteError(w, http.StatusBadRequest, msg)
}

func decode(w http.ResponseWriter, r *http.Request, into any) bool {
	raw, ok := read(w, r)
	if !ok {
		return false
	}
	if err := json.Unmarshal(raw, into); err != nil {
		badBody(w, err)
		return false
	}
	return true
}

// decodeStrict refuses unknown properties: a promotion takes no field this
// API does not define (no amounts, codes or stacking rules).
func decodeStrict(w http.ResponseWriter, r *http.Request, into any) bool {
	raw, ok := read(w, r)
	if !ok {
		return false
	}
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.DisallowUnknownFields()
	if err := dec.Decode(into); err != nil {
		badBody(w, err)
		return false
	}
	return true
}

// --- responses ---------------------------------------------------------------

type coded struct {
	Message        string `json:"message"`
	Error          string `json:"error"`
	StatusCode     int    `json:"statusCode"`
	Code           string `json:"code"`
	PromotionID    string `json:"promotionId,omitempty"`
	CurrentVersion int    `json:"currentVersion,omitempty"`
}

func writeCoded(w http.ResponseWriter, status int, c coded) {
	c.Error, c.StatusCode = http.StatusText(status), status
	httpx.WriteJSON(w, status, c)
}

func (h *Handler) respond(w http.ResponseWriter, r *http.Request, p promotions.Promotion, err error) {
	if err != nil {
		h.respondError(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, toJSON(p))
}

func (h *Handler) respondError(w http.ResponseWriter, r *http.Request, err error) {
	var (
		validation *promotions.ValidationError
		idem       *promotions.IdempotencyConflictError
		version    *promotions.VersionConflictError
	)
	switch {
	case errors.As(err, &validation):
		httpx.WriteError(w, http.StatusBadRequest, validation.Message)
	case errors.As(err, &idem):
		writeCoded(w, http.StatusConflict, coded{Message: idem.Error(), Code: "IDEMPOTENCY_CONFLICT", PromotionID: idem.PromotionID})
	case errors.As(err, &version):
		writeCoded(w, http.StatusConflict, coded{Message: version.Error(), Code: "VERSION_CONFLICT", CurrentVersion: version.Current})
	case errors.Is(err, promotions.ErrPromotionNotFound):
		httpx.WriteError(w, http.StatusNotFound, err.Error())
	case errors.Is(err, promotions.ErrUnknownActor):
		httpx.WriteError(w, http.StatusForbidden, err.Error())
	case errors.Is(err, promotions.ErrWritesDisabled):
		writeCoded(w, http.StatusServiceUnavailable, coded{Message: err.Error(), Code: "PROMOTION_WRITES_DISABLED"})
	default:
		h.fail(w, r, err)
	}
}

func (h *Handler) fail(w http.ResponseWriter, r *http.Request, err error) {
	h.logger.ErrorContext(r.Context(), "promotion request failed", "error", err, "request_id", httpx.RequestIDFrom(r.Context()))
	httpx.WriteInternalError(w)
}
