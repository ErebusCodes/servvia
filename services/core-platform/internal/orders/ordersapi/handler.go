// Package ordersapi is the HTTP transport of the canonical order domain:
// contracts/openapi/servvia-orders.yaml. Venue-scoped paths and Nest-shaped
// error bodies, like the table-session API; pricing failures answer exactly
// as the NestJS order path does (same status, same body), so a client sees
// one behaviour whichever service priced its order.
package ordersapi

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"strconv"
	"time"

	"servvia/services/core-platform/internal/audit"
	"servvia/services/core-platform/internal/identity"
	"servvia/services/core-platform/internal/orders"
	"servvia/services/core-platform/internal/platform/httpx"
	"servvia/services/core-platform/internal/pricing"
	"servvia/services/core-platform/internal/promotions"
	"servvia/services/core-platform/internal/venues"
)

// Roles may place and read orders: floor staff. Not kitchen: a KDS screen
// shows orders, it does not take them (the NestJS path allows it; Servvia
// Core deliberately does not).
var Roles = []string{identity.RoleAdmin, identity.RoleManager, identity.RoleCashier}

// VenueResolver finds a venue within an organization (venues.Store).
type VenueResolver interface {
	VenueInOrganization(ctx context.Context, venueID, organizationID string) (venues.Venue, bool, error)
}

type Handler struct {
	svc    *orders.Service
	venues VenueResolver
	logger *slog.Logger
}

func NewHandler(svc *orders.Service, v VenueResolver, logger *slog.Logger) *Handler {
	return &Handler{svc: svc, venues: v, logger: logger}
}

// --- wire shapes -----------------------------------------------------------

type modifierIn struct {
	ModifierGroupID string `json:"modifierGroupId"`
	OptionID        string `json:"optionId"`
}

type itemIn struct {
	MenuItemID             string       `json:"menuItemId"`
	Quantity               *int64       `json:"quantity"`
	SelectedModifiers      []modifierIn `json:"selectedModifiers"`
	Notes                  *string      `json:"notes"`
	Seat                   *int         `json:"seat"`
	ExpectedUnitPriceCents *int64       `json:"expectedUnitPriceCents"`
	// DiscountCents is never accepted: discounts are the server's (D11).
	// Present only so a client that sends one is refused, not ignored.
	DiscountCents json.RawMessage `json:"discountCents"`
}

type roundJSON struct {
	ID                 string  `json:"id"`
	Sequence           int     `json:"sequence"`
	SubmittedByStaffID *string `json:"submittedByStaffId"`
	SubmittedAt        string  `json:"submittedAt"`
}

type lineJSON struct {
	ID                string                   `json:"id"`
	RoundID           *string                  `json:"roundId"`
	MenuItemID        string                   `json:"menuItemId"`
	MenuItemTitle     string                   `json:"menuItemTitle"`
	MenuItemCategory  string                   `json:"menuItemCategory"`
	UnitPriceCents    int64                    `json:"unitPriceCents"`
	Quantity          int64                    `json:"quantity"`
	LineTotalCents    int64                    `json:"lineTotalCents"`
	DiscountCents     int64                    `json:"discountCents"`
	AppliedPromotion  *string                  `json:"appliedPromotionId"`
	SelectedModifiers []pricing.PricedModifier `json:"selectedModifiers"`
	Notes             *string                  `json:"notes"`
	Seat              *int                     `json:"seat"`
}

type orderJSON struct {
	ID                string        `json:"id"`
	VenueID           string        `json:"venueId"`
	TableSessionID    *string       `json:"tableSessionId"`
	TableID           *string       `json:"tableId"`
	TableNumber       *string       `json:"tableNumber"`
	ServiceMode       string        `json:"serviceMode"`
	Source            string        `json:"source"`
	Status            string        `json:"status"`
	Notes             *string       `json:"notes"`
	TakeawayReference *string       `json:"takeawayReference"`
	IdempotencyKey    string        `json:"idempotencyKey"`
	SubtotalCents     int64         `json:"subtotalCents"`
	DiscountCents     int64         `json:"discountCents"`
	TaxCents          int64         `json:"taxCents"`
	TotalCents        int64         `json:"totalCents"`
	Rounds            []roundJSON   `json:"rounds"`
	Items             []lineJSON    `json:"items"`
	Promotions        []appliedJSON `json:"promotions"`
	CreatedAt         string        `json:"createdAt"`
	UpdatedAt         string        `json:"updatedAt"`
}

// appliedJSON is an applied-promotion snapshot (Phase D11).
type appliedJSON struct {
	ID                    string `json:"id"`
	RoundID               string `json:"roundId"`
	PromotionID           string `json:"promotionId"`
	PromotionVersion      int    `json:"promotionVersion"`
	Name                  string `json:"name"`
	Kind                  string `json:"kind"`
	BasisPoints           int64  `json:"basisPoints"`
	Target                string `json:"target"`
	Currency              string `json:"currency"`
	EligibleSubtotalCents int64  `json:"eligibleSubtotalCents"`
	DiscountCents         int64  `json:"discountCents"`
	AppliedAt             string `json:"appliedAt"`
}

func timestamp(t time.Time) string { return t.UTC().Format("2006-01-02T15:04:05.000Z") }

func toJSON(o orders.Order) orderJSON {
	j := orderJSON{ID: o.ID, VenueID: o.VenueID, TableSessionID: o.TableSessionID, TableID: o.TableID,
		TableNumber: o.TableNumber, ServiceMode: string(o.ServiceMode), Source: string(o.Source), Status: string(o.Status),
		Notes: o.Notes, TakeawayReference: o.TakeawayReference, IdempotencyKey: o.IdempotencyKey,
		SubtotalCents: o.SubtotalCents, DiscountCents: o.DiscountCents, TaxCents: o.TaxCents, TotalCents: o.TotalCents,
		Rounds: []roundJSON{}, Items: []lineJSON{}, Promotions: []appliedJSON{},
		CreatedAt: timestamp(o.CreatedAt), UpdatedAt: timestamp(o.UpdatedAt)}
	for _, a := range o.Promotions {
		j.Promotions = append(j.Promotions, appliedJSON{ID: a.ID, RoundID: a.RoundID, PromotionID: a.PromotionID,
			PromotionVersion: a.PromotionVersion, Name: a.Name, Kind: a.Kind, BasisPoints: a.BasisPoints, Target: a.Target,
			Currency: a.Currency, EligibleSubtotalCents: a.EligibleSubtotalCents, DiscountCents: a.DiscountCents,
			AppliedAt: timestamp(a.AppliedAt)})
	}
	for _, r := range o.Rounds {
		j.Rounds = append(j.Rounds, roundJSON{ID: r.ID, Sequence: r.Sequence, SubmittedByStaffID: r.SubmittedByStaffID,
			SubmittedAt: timestamp(r.SubmittedAt)})
	}
	for _, l := range o.Lines {
		mods := l.Modifiers
		if mods == nil {
			mods = []pricing.PricedModifier{}
		}
		j.Items = append(j.Items, lineJSON{ID: l.ID, RoundID: l.RoundID, MenuItemID: l.MenuItemID,
			MenuItemTitle: l.MenuItemTitle, MenuItemCategory: l.MenuItemCategory, UnitPriceCents: l.UnitPriceCents,
			Quantity: l.Quantity, LineTotalCents: l.LineTotalCents, DiscountCents: l.DiscountCents,
			AppliedPromotion: l.AppliedPromotionID, SelectedModifiers: mods, Notes: l.Notes, Seat: l.Seat})
	}
	return j
}

// --- handlers ----------------------------------------------------------------

// Create serves POST /api/venues/{venueId}/orders. 201 when this request
// placed the order, 200 when it is a replay of one that already did.
func (h *Handler) Create(w http.ResponseWriter, r *http.Request) {
	sc, actor, ok := h.scope(w, r)
	if !ok {
		return
	}
	var body struct {
		Source         string   `json:"source"`
		ServiceMode    string   `json:"serviceMode"`
		TableSessionID *string  `json:"tableSessionId"`
		Notes          *string  `json:"notes"`
		IdempotencyKey string   `json:"idempotencyKey"`
		Items          []itemIn `json:"items"`
		promotionIn
	}
	if !decode(w, r, &body) {
		return
	}
	lines, ok := linesOf(w, body.Items)
	if !ok || !body.valid(w) {
		return
	}
	o, created, err := h.svc.Create(r.Context(), orders.CreateCommand{
		Scope: sc, Source: orders.Source(body.Source), ServiceMode: orders.ServiceMode(body.ServiceMode),
		TableSessionID: body.TableSessionID, Notes: body.Notes, Lines: lines, PromotionID: body.PromotionID,
		IdempotencyKey: body.IdempotencyKey, Actor: actor,
	})
	h.respond(w, r, o, created, err)
}

// SubmitRound serves POST /api/venues/{venueId}/orders/{orderId}/rounds.
func (h *Handler) SubmitRound(w http.ResponseWriter, r *http.Request) {
	sc, actor, ok := h.scope(w, r)
	if !ok {
		return
	}
	var body struct {
		IdempotencyKey string   `json:"idempotencyKey"`
		Items          []itemIn `json:"items"`
		promotionIn
	}
	if !decode(w, r, &body) {
		return
	}
	lines, ok := linesOf(w, body.Items)
	if !ok || !body.valid(w) {
		return
	}
	o, created, err := h.svc.SubmitRound(r.Context(), orders.RoundCommand{
		Scope: sc, OrderID: r.PathValue("orderId"), Lines: lines, PromotionID: body.PromotionID,
		RequestKey: body.IdempotencyKey, Actor: actor,
	})
	h.respond(w, r, o, created, err)
}

// Get serves GET /api/venues/{venueId}/orders/{orderId}.
func (h *Handler) Get(w http.ResponseWriter, r *http.Request) {
	sc, _, ok := h.scope(w, r)
	if !ok {
		return
	}
	o, err := h.svc.Get(r.Context(), sc, r.PathValue("orderId"))
	h.respond(w, r, o, false, err)
}

// scope authorizes the path's venue like the table-session API, and carries
// its tax configuration into pricing.
func (h *Handler) scope(w http.ResponseWriter, r *http.Request) (orders.Scope, orders.Actor, bool) {
	p, ok := identity.PrincipalFrom(r.Context())
	if !ok {
		httpx.WriteInternalError(w)
		return orders.Scope{}, orders.Actor{}, false
	}
	venueID, err := identity.ResolveVenueScope(p, r.PathValue("venueId"))
	if err != nil {
		httpx.WriteError(w, http.StatusForbidden, err.Error())
		return orders.Scope{}, orders.Actor{}, false
	}
	v, found, err := h.venues.VenueInOrganization(r.Context(), venueID, p.OrganizationID)
	if err != nil {
		h.fail(w, r, err)
		return orders.Scope{}, orders.Actor{}, false
	}
	if !found {
		httpx.WriteError(w, http.StatusNotFound, "Venue not found")
		return orders.Scope{}, orders.Actor{}, false
	}
	return orders.Scope{OrganizationID: p.OrganizationID, Venue: pricing.Venue{ID: v.ID, OrganizationID: v.OrganizationID,
			Tax: pricing.TaxProfile{Currency: v.Tax.Currency, TaxJurisdiction: v.Tax.TaxJurisdiction, PricesIncludeTax: v.Tax.PricesIncludeTax}}},
		orders.Actor{StaffID: p.ID, Email: p.Email, Role: p.Role,
			OnTablet: p.Kind == identity.KindTabletStaff || p.Kind == identity.KindTabletManager,
			Device:   audit.DeviceOf(p)}, true
}

func decode(w http.ResponseWriter, r *http.Request, into any) bool {
	raw, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 256<<10))
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

// promotionIn is the promotion part of a create or round request: the
// promotion's identity only. A discount amount is refused, never ignored:
// a client that believes it sets one must learn it does not.
type promotionIn struct {
	PromotionID   *string         `json:"promotionId"`
	DiscountCents json.RawMessage `json:"discountCents"`
}

func (p promotionIn) valid(w http.ResponseWriter) bool {
	switch {
	case p.DiscountCents != nil:
		httpx.WriteError(w, http.StatusBadRequest, discountRefused)
		return false
	case p.PromotionID != nil && *p.PromotionID == "":
		httpx.WriteError(w, http.StatusBadRequest, "promotionId must be a non-empty string")
		return false
	}
	return true
}

const discountRefused = "discountCents is not accepted: the server computes discounts from promotionId"

func linesOf(w http.ResponseWriter, items []itemIn) ([]orders.LineInput, bool) {
	lines := make([]orders.LineInput, 0, len(items))
	for i, it := range items {
		field := "items." + strconv.Itoa(i) + "."
		switch {
		case it.MenuItemID == "":
			httpx.WriteError(w, http.StatusBadRequest, field+"menuItemId is required")
			return nil, false
		case it.Quantity == nil || *it.Quantity < 1:
			httpx.WriteError(w, http.StatusBadRequest, field+"quantity must be a positive integer")
			return nil, false
		case it.ExpectedUnitPriceCents != nil && *it.ExpectedUnitPriceCents < 0:
			httpx.WriteError(w, http.StatusBadRequest, field+"expectedUnitPriceCents must not be negative")
			return nil, false
		case it.DiscountCents != nil:
			httpx.WriteError(w, http.StatusBadRequest, field+discountRefused)
			return nil, false
		}
		l := orders.LineInput{MenuItemID: it.MenuItemID, Quantity: *it.Quantity, Notes: it.Notes, Seat: it.Seat,
			ExpectedUnitPriceCents: it.ExpectedUnitPriceCents}
		for _, m := range it.SelectedModifiers {
			l.Modifiers = append(l.Modifiers, pricing.ModifierSelection{ModifierGroupID: m.ModifierGroupID, OptionID: m.OptionID})
		}
		lines = append(lines, l)
	}
	return lines, true
}

// coded is a Nest-shaped error with a machine-readable code.
type coded struct {
	Message       string `json:"message"`
	Error         string `json:"error"`
	StatusCode    int    `json:"statusCode"`
	Code          string `json:"code"`
	OrderID       string `json:"orderId,omitempty"`
	SessionStatus string `json:"sessionStatus,omitempty"`
	OrderStatus   string `json:"orderStatus,omitempty"`
	Reason        string `json:"reason,omitempty"`
}

func writeCoded(w http.ResponseWriter, status int, c coded) {
	c.Error, c.StatusCode = http.StatusText(status), status
	httpx.WriteJSON(w, status, c)
}

func (h *Handler) respond(w http.ResponseWriter, r *http.Request, o orders.Order, created bool, err error) {
	var (
		validation    *orders.ValidationError
		idemConflict  *orders.IdempotencyConflictError
		roundConflict *orders.RoundConflictError
		notOpen       *orders.SessionNotOpenError
		notActive     *orders.OrderNotActiveError
		priceErr      *pricing.Error
		notApplicable *promotions.NotApplicableError
	)
	switch {
	case err == nil && created:
		httpx.WriteJSON(w, http.StatusCreated, toJSON(o))
	case err == nil:
		httpx.WriteJSON(w, http.StatusOK, toJSON(o))
	case errors.As(err, &validation):
		httpx.WriteError(w, http.StatusBadRequest, validation.Message)
	case errors.As(err, &priceErr):
		writePricingError(w, priceErr)
	case errors.As(err, &idemConflict):
		// The NestJS message, with a code and the order already holding the key.
		writeCoded(w, http.StatusConflict, coded{Message: idemConflict.Error(), Code: "IDEMPOTENCY_CONFLICT", OrderID: idemConflict.OrderID})
	case errors.As(err, &roundConflict):
		writeCoded(w, http.StatusConflict, coded{Message: roundConflict.Error(), Code: "IDEMPOTENCY_CONFLICT"})
	case errors.As(err, &notOpen):
		writeCoded(w, http.StatusConflict, coded{Message: notOpen.Error(), Code: "TABLE_SESSION_NOT_OPEN", SessionStatus: notOpen.Status})
	case errors.As(err, &notActive):
		writeCoded(w, http.StatusConflict, coded{Message: notActive.Error(), Code: "ORDER_NOT_ACTIVE", OrderStatus: string(notActive.Status)})
	case errors.Is(err, orders.ErrNotTableService):
		writeCoded(w, http.StatusConflict, coded{Message: err.Error(), Code: "ORDER_NOT_TABLE_SERVICE"})
	case errors.As(err, &notApplicable):
		writeCoded(w, http.StatusUnprocessableEntity, coded{Message: err.Error(), Code: "PROMOTION_NOT_APPLICABLE", Reason: string(notApplicable.Reason)})
	case errors.Is(err, promotions.ErrChanged):
		writeCoded(w, http.StatusConflict, coded{Message: err.Error(), Code: "PROMOTION_CHANGED"})
	case errors.Is(err, promotions.ErrPromotionNotFound):
		writeCoded(w, http.StatusNotFound, coded{Message: err.Error(), Code: "PROMOTION_NOT_FOUND"})
	case errors.Is(err, orders.ErrOrderNotFound), errors.Is(err, orders.ErrTableSessionNotFound):
		httpx.WriteError(w, http.StatusNotFound, err.Error())
	case errors.Is(err, orders.ErrSourceNotPermitted), errors.Is(err, orders.ErrUnknownActor):
		httpx.WriteError(w, http.StatusForbidden, err.Error())
	case errors.Is(err, orders.ErrWritesDisabled):
		writeCoded(w, http.StatusServiceUnavailable, coded{Message: err.Error(), Code: "ORDER_WRITES_DISABLED"})
	default:
		h.fail(w, r, err)
	}
}

// writePricingError answers a pricing failure as the NestJS order path does:
// 400, 409, 409 STALE_PRICE (its own body) or 422. The two Go-only kinds
// (Phase D1) get explicit codes instead of Nest's persistence-time 500 or
// silent truncation.
func writePricingError(w http.ResponseWriter, e *pricing.Error) {
	switch e.Kind {
	case pricing.KindInvalidRequest:
		httpx.WriteError(w, http.StatusBadRequest, e.Message)
	case pricing.KindUnavailable:
		httpx.WriteError(w, http.StatusConflict, e.Message)
	case pricing.KindUnsupportedTax:
		httpx.WriteError(w, http.StatusUnprocessableEntity, e.Message)
	case pricing.KindStalePrice:
		httpx.WriteJSON(w, http.StatusConflict, struct {
			Message   string                  `json:"message"`
			Code      string                  `json:"code"`
			Conflicts []pricing.PriceConflict `json:"conflicts"`
		}{e.Message, pricing.StalePriceCode, e.Conflicts})
	case pricing.KindAmountOutOfRange:
		writeCoded(w, http.StatusBadRequest, coded{Message: e.Message, Code: "AMOUNT_OUT_OF_RANGE"})
	default:
		writeCoded(w, http.StatusUnprocessableEntity, coded{Message: e.Message, Code: "CATALOG_INVALID"})
	}
}

func (h *Handler) fail(w http.ResponseWriter, r *http.Request, err error) {
	h.logger.ErrorContext(r.Context(), "order request failed", "error", err, "request_id", httpx.RequestIDFrom(r.Context()))
	httpx.WriteInternalError(w)
}
