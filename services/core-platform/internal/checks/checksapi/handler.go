// Package checksapi is the HTTP transport of the check domain:
// contracts/openapi/checks.yaml. Venue-scoped paths and Nest-shaped error
// bodies, like the order and table-session APIs.
package checksapi

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"servvia/services/core-platform/internal/checks"
	"servvia/services/core-platform/internal/identity"
	"servvia/services/core-platform/internal/platform/httpx"
	"servvia/services/core-platform/internal/pricing"
	"servvia/services/core-platform/internal/venues"
)

// Roles may create and read checks: the repository's financial roles (as
// payment observation). Not kitchen, not viewer.
var Roles = []string{identity.RoleAdmin, identity.RoleManager, identity.RoleCashier}

// VoidRoles may void a check: the roles that approve financial corrections
// (manager step-up is reserved for voids).
var VoidRoles = []string{identity.RoleAdmin, identity.RoleManager}

// VenueResolver finds a venue within an organization (venues.Store).
type VenueResolver interface {
	VenueInOrganization(ctx context.Context, venueID, organizationID string) (venues.Venue, bool, error)
}

type Handler struct {
	svc    *checks.Service
	venues VenueResolver
	logger *slog.Logger
}

func NewHandler(svc *checks.Service, v VenueResolver, logger *slog.Logger) *Handler {
	return &Handler{svc: svc, venues: v, logger: logger}
}

// --- wire shapes -----------------------------------------------------------

type lineJSON struct {
	ID             string                   `json:"id"`
	OrderID        string                   `json:"orderId"`
	OrderItemID    string                   `json:"orderItemId"`
	Position       int                      `json:"position"`
	Title          string                   `json:"title"`
	Quantity       int64                    `json:"quantity"`
	UnitPriceCents int64                    `json:"unitPriceCents"`
	LineTotalCents int64                    `json:"lineTotalCents"`
	DiscountCents  int64                    `json:"discountCents"`
	Modifiers      []pricing.PricedModifier `json:"modifiers"`
}

type checkJSON struct {
	ID               string     `json:"id"`
	VenueID          string     `json:"venueId"`
	TableSessionID   *string    `json:"tableSessionId"`
	Status           string     `json:"status"`
	Currency         string     `json:"currency"`
	SubtotalCents    int64      `json:"subtotalCents"`
	DiscountCents    int64      `json:"discountCents"`
	TaxCents         int64      `json:"taxCents"`
	TotalCents       int64      `json:"totalCents"`
	Version          int        `json:"version"`
	IdempotencyKey   string     `json:"idempotencyKey"`
	CreatedByStaffID *string    `json:"createdByStaffId"`
	VoidedByStaffID  *string    `json:"voidedByStaffId"`
	VoidReason       *string    `json:"voidReason"`
	VoidedAt         *string    `json:"voidedAt"`
	Lines            []lineJSON `json:"lines"`
	CreatedAt        string     `json:"createdAt"`
	UpdatedAt        string     `json:"updatedAt"`
}

func timestamp(t time.Time) string { return t.UTC().Format("2006-01-02T15:04:05.000Z") }

func toJSON(c checks.Check) checkJSON {
	j := checkJSON{ID: c.ID, VenueID: c.VenueID, TableSessionID: c.TableSessionID, Status: string(c.Status),
		Currency: c.Currency, SubtotalCents: c.SubtotalCents, DiscountCents: c.DiscountCents, TaxCents: c.TaxCents, TotalCents: c.TotalCents,
		Version: c.Version, IdempotencyKey: c.IdempotencyKey, CreatedByStaffID: c.CreatedByStaffID,
		VoidedByStaffID: c.VoidedByStaffID, VoidReason: c.VoidReason, Lines: []lineJSON{},
		CreatedAt: timestamp(c.CreatedAt), UpdatedAt: timestamp(c.UpdatedAt)}
	if c.VoidedAt != nil {
		v := timestamp(*c.VoidedAt)
		j.VoidedAt = &v
	}
	for _, l := range c.Lines {
		mods := l.Modifiers
		if mods == nil {
			mods = []pricing.PricedModifier{}
		}
		j.Lines = append(j.Lines, lineJSON{ID: l.ID, OrderID: l.OrderID, OrderItemID: l.OrderItemID, Position: l.Position,
			Title: l.Title, Quantity: l.Quantity, UnitPriceCents: l.UnitPriceCents, LineTotalCents: l.LineTotalCents, DiscountCents: l.DiscountCents, Modifiers: mods})
	}
	return j
}

// --- handlers ----------------------------------------------------------------

// Create serves POST /api/venues/{venueId}/checks. 201 when this request
// created the check, 200 when it replays one that already did.
func (h *Handler) Create(w http.ResponseWriter, r *http.Request) {
	sc, actor, ok := h.scope(w, r)
	if !ok {
		return
	}
	var body struct {
		TableSessionID *string  `json:"tableSessionId"`
		OrderIDs       []string `json:"orderIds"`
		IdempotencyKey string   `json:"idempotencyKey"`
	}
	if !decode(w, r, &body) {
		return
	}
	c, created, err := h.svc.Create(r.Context(), checks.CreateCommand{Scope: sc, TableSessionID: body.TableSessionID,
		OrderIDs: body.OrderIDs, IdempotencyKey: body.IdempotencyKey, Actor: actor})
	if err != nil {
		h.respondError(w, r, err)
		return
	}
	status := http.StatusOK
	if created {
		status = http.StatusCreated
	}
	httpx.WriteJSON(w, status, toJSON(c))
}

// List serves GET /api/venues/{venueId}/checks[?tableSessionId=&status=a,b].
func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
	sc, _, ok := h.scope(w, r)
	if !ok {
		return
	}
	f := checks.Filter{TableSessionID: r.URL.Query().Get("tableSessionId")}
	if raw := r.URL.Query().Get("status"); raw != "" {
		for _, s := range strings.Split(raw, ",") {
			f.Statuses = append(f.Statuses, checks.Status(strings.TrimSpace(s)))
		}
	}
	found, err := h.svc.List(r.Context(), sc, f)
	if err != nil {
		h.respondError(w, r, err)
		return
	}
	out := make([]checkJSON, 0, len(found))
	for _, c := range found {
		out = append(out, toJSON(c))
	}
	httpx.WriteJSON(w, http.StatusOK, out)
}

// Get serves GET /api/venues/{venueId}/checks/{checkId}.
func (h *Handler) Get(w http.ResponseWriter, r *http.Request) {
	sc, _, ok := h.scope(w, r)
	if !ok {
		return
	}
	c, err := h.svc.Get(r.Context(), sc, r.PathValue("checkId"))
	if err != nil {
		h.respondError(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, toJSON(c))
}

// Void serves POST /api/venues/{venueId}/checks/{checkId}/void. 200 with the
// check, whether this request voided it or it was already voided.
func (h *Handler) Void(w http.ResponseWriter, r *http.Request) {
	sc, actor, ok := h.scope(w, r)
	if !ok {
		return
	}
	var body struct {
		Version *int   `json:"version"`
		Reason  string `json:"reason"`
	}
	if !decode(w, r, &body) {
		return
	}
	if body.Version == nil {
		httpx.WriteError(w, http.StatusBadRequest, "version must be a positive integer")
		return
	}
	c, _, err := h.svc.Void(r.Context(), checks.VoidCommand{Scope: sc, CheckID: r.PathValue("checkId"),
		ExpectedVersion: *body.Version, Reason: body.Reason, Actor: actor})
	if err != nil {
		h.respondError(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, toJSON(c))
}

// scope authorizes the path's venue like the order API, and carries its tax
// configuration.
func (h *Handler) scope(w http.ResponseWriter, r *http.Request) (checks.Scope, checks.Actor, bool) {
	p, ok := identity.PrincipalFrom(r.Context())
	if !ok {
		httpx.WriteInternalError(w)
		return checks.Scope{}, checks.Actor{}, false
	}
	venueID, err := identity.ResolveVenueScope(p, r.PathValue("venueId"))
	if err != nil {
		httpx.WriteError(w, http.StatusForbidden, err.Error())
		return checks.Scope{}, checks.Actor{}, false
	}
	v, found, err := h.venues.VenueInOrganization(r.Context(), venueID, p.OrganizationID)
	if err != nil {
		h.fail(w, r, err)
		return checks.Scope{}, checks.Actor{}, false
	}
	if !found {
		httpx.WriteError(w, http.StatusNotFound, "Venue not found")
		return checks.Scope{}, checks.Actor{}, false
	}
	return checks.Scope{OrganizationID: p.OrganizationID, Venue: pricing.Venue{ID: v.ID, OrganizationID: v.OrganizationID,
			Tax: pricing.TaxProfile{Currency: v.Tax.Currency, TaxJurisdiction: v.Tax.TaxJurisdiction, PricesIncludeTax: v.Tax.PricesIncludeTax}}},
		checks.Actor{StaffID: p.ID, Email: p.Email, Role: p.Role}, true
}

func decode(w http.ResponseWriter, r *http.Request, into any) bool {
	raw, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 64<<10))
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

// coded is a Nest-shaped error with a machine-readable code.
type coded struct {
	Message        string `json:"message"`
	Error          string `json:"error"`
	StatusCode     int    `json:"statusCode"`
	Code           string `json:"code"`
	CheckID        string `json:"checkId,omitempty"`
	OrderID        string `json:"orderId,omitempty"`
	CurrentVersion int    `json:"currentVersion,omitempty"`
}

func writeCoded(w http.ResponseWriter, status int, c coded) {
	c.Error, c.StatusCode = http.StatusText(status), status
	httpx.WriteJSON(w, status, c)
}

func (h *Handler) respondError(w http.ResponseWriter, r *http.Request, err error) {
	var (
		validation    *checks.ValidationError
		idem          *checks.IdempotencyConflictError
		notBillable   *checks.OrderNotBillableError
		version       *checks.VersionConflictError
		notOpen       *checks.NotOpenError
		sessionClosed *checks.SessionNotOpenError
		priceErr      *pricing.Error
	)
	switch {
	case errors.As(err, &validation):
		httpx.WriteError(w, http.StatusBadRequest, validation.Message)
	case errors.As(err, &idem):
		writeCoded(w, http.StatusConflict, coded{Message: idem.Error(), Code: "IDEMPOTENCY_CONFLICT", CheckID: idem.CheckID})
	case errors.As(err, &notBillable):
		writeCoded(w, http.StatusConflict, coded{Message: notBillable.Error(), Code: "ORDER_NOT_BILLABLE", OrderID: notBillable.OrderID})
	case errors.As(err, &version):
		writeCoded(w, http.StatusConflict, coded{Message: version.Error(), Code: "VERSION_CONFLICT", CurrentVersion: version.Current})
	case errors.As(err, &sessionClosed):
		writeCoded(w, http.StatusConflict, coded{Message: sessionClosed.Error(), Code: "TABLE_SESSION_NOT_OPEN"})
	case errors.As(err, &notOpen):
		writeCoded(w, http.StatusConflict, coded{Message: notOpen.Error(), Code: "CHECK_NOT_OPEN"})
	case errors.Is(err, checks.ErrCheckHasPayments):
		writeCoded(w, http.StatusConflict, coded{Message: err.Error(), Code: "CHECK_HAS_PAYMENTS"})
	case errors.Is(err, checks.ErrNothingToBill):
		writeCoded(w, http.StatusConflict, coded{Message: err.Error(), Code: "NOTHING_TO_BILL"})
	case errors.Is(err, checks.ErrMixedVisits):
		writeCoded(w, http.StatusConflict, coded{Message: err.Error(), Code: "MIXED_VISITS"})
	case errors.Is(err, checks.ErrLegacyOrder):
		writeCoded(w, http.StatusConflict, coded{Message: err.Error(), Code: "ORDER_NOT_CANONICAL"})
	case errors.As(err, &priceErr) && priceErr.Kind == pricing.KindUnsupportedTax:
		httpx.WriteError(w, http.StatusUnprocessableEntity, priceErr.Message)
	case errors.As(err, &priceErr) && priceErr.Kind == pricing.KindAmountOutOfRange:
		writeCoded(w, http.StatusBadRequest, coded{Message: priceErr.Message, Code: "AMOUNT_OUT_OF_RANGE"})
	case errors.Is(err, checks.ErrCheckNotFound), errors.Is(err, checks.ErrOrderNotFound), errors.Is(err, checks.ErrTableSessionNotFound):
		httpx.WriteError(w, http.StatusNotFound, err.Error())
	case errors.Is(err, checks.ErrUnknownActor):
		httpx.WriteError(w, http.StatusForbidden, err.Error())
	case errors.Is(err, checks.ErrWritesDisabled):
		writeCoded(w, http.StatusServiceUnavailable, coded{Message: err.Error(), Code: "CHECK_WRITES_DISABLED"})
	default:
		h.fail(w, r, err)
	}
}

func (h *Handler) fail(w http.ResponseWriter, r *http.Request, err error) {
	h.logger.ErrorContext(r.Context(), "check request failed", "error", err, "request_id", httpx.RequestIDFrom(r.Context()))
	httpx.WriteInternalError(w)
}
