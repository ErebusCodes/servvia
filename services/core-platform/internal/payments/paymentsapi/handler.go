// Package paymentsapi is the HTTP transport of the payment and settlement
// domain: contracts/openapi/payments.yaml.
//
// Two trust paths, never mixed:
//   - staff (a staff JWT with a financial role) initiate a tender and read
//     payments and the balance; no staff route can report a result;
//   - a payment adapter reports card results on its own route, authenticated
//     as an active Device of kind payment_adapter registered at the path's
//     venue (devicesapi.Authenticate, Phase D8). Each venue's adapter has its
//     own revocable credential; there is no shared secret.
package paymentsapi

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"time"

	"servvia/services/core-platform/internal/audit"
	"servvia/services/core-platform/internal/devices/devicesapi"
	"servvia/services/core-platform/internal/identity"
	"servvia/services/core-platform/internal/payments"
	"servvia/services/core-platform/internal/platform/httpx"
	"servvia/services/core-platform/internal/venues"
)

// Roles may initiate tenders and read payments: the repository's financial
// roles (as checks). Not kitchen, not viewer.
var Roles = []string{identity.RoleAdmin, identity.RoleManager, identity.RoleCashier}

// VenueResolver finds a venue within an organization (venues.Store).
type VenueResolver interface {
	VenueInOrganization(ctx context.Context, venueID, organizationID string) (venues.Venue, bool, error)
	Venue(ctx context.Context, id string) (venues.Venue, bool, error)
}

type Handler struct {
	svc    *payments.Service
	venues VenueResolver
	logger *slog.Logger
}

func NewHandler(svc *payments.Service, v VenueResolver, logger *slog.Logger) *Handler {
	return &Handler{svc: svc, venues: v, logger: logger}
}

// --- wire shapes -----------------------------------------------------------

func timestamp(t time.Time) string { return t.UTC().Format("2006-01-02T15:04:05.000Z") }

func optional(t *time.Time) *string {
	if t == nil {
		return nil
	}
	s := timestamp(*t)
	return &s
}

type transitionJSON struct {
	Sequence        int     `json:"sequence"`
	From            *string `json:"fromStatus"`
	To              string  `json:"toStatus"`
	ActorID         string  `json:"actorId"`
	ActorKind       string  `json:"actorKind"`
	ResultReference *string `json:"resultReference"`
	At              string  `json:"at"`
}

type paymentJSON struct {
	ID                 string           `json:"id"`
	VenueID            string           `json:"venueId"`
	CheckID            string           `json:"checkId"`
	AmountCents        int64            `json:"amountCents"`
	Currency           string           `json:"currency"`
	TenderType         string           `json:"tenderType"`
	Status             string           `json:"status"`
	Version            int              `json:"version"`
	IdempotencyKey     string           `json:"idempotencyKey"`
	RequestedByStaffID *string          `json:"requestedByStaffId"`
	ShiftID            *string          `json:"shiftId"`
	ResultReference    *string          `json:"resultReference"`
	ResolvedAt         *string          `json:"resolvedAt"`
	ReturnedCents      int64            `json:"returnedCents"`
	RefundableCents    int64            `json:"refundableCents"`
	History            []transitionJSON `json:"history"`
	CreatedAt          string           `json:"createdAt"`
	UpdatedAt          string           `json:"updatedAt"`
}

type settlementJSON struct {
	ID                string                `json:"id"`
	Status            string                `json:"status"`
	Cycle             int                   `json:"cycle"`
	AmountCents       int64                 `json:"amountCents"`
	Currency          string                `json:"currency"`
	SettlingPaymentID string                `json:"settlingPaymentId"`
	ActorID           string                `json:"actorId"`
	ActorKind         string                `json:"actorKind"`
	SettledAt         string                `json:"settledAt"`
	RevokedAt         *string               `json:"revokedAt"`
	History           []settlementEventJSON `json:"history"`
}

type settlementEventJSON struct {
	Sequence     int     `json:"sequence"`
	Status       string  `json:"status"`
	Cycle        int     `json:"cycle"`
	AmountCents  int64   `json:"amountCents"`
	PaymentID    *string `json:"paymentId"`
	AdjustmentID *string `json:"refundId"`
	ActorID      string  `json:"actorId"`
	ActorKind    string  `json:"actorKind"`
	At           string  `json:"at"`
}

type summaryJSON struct {
	CheckID        string          `json:"checkId"`
	CheckStatus    string          `json:"checkStatus"`
	Currency       string          `json:"currency"`
	TotalCents     int64           `json:"totalCents"`
	PaidCents      int64           `json:"paidCents"`
	ReturnedCents  int64           `json:"returnedCents"`
	HeldCents      int64           `json:"heldCents"`
	BalanceCents   int64           `json:"balanceCents"`
	AvailableCents int64           `json:"availableCents"`
	Settlement     *settlementJSON `json:"settlement"`
	Payments       []paymentJSON   `json:"payments"`
}

func toJSON(p payments.Payment) paymentJSON {
	j := paymentJSON{ID: p.ID, VenueID: p.VenueID, CheckID: p.CheckID, AmountCents: p.AmountCents, Currency: p.Currency,
		TenderType: string(p.TenderType), Status: string(p.Status), Version: p.Version, IdempotencyKey: p.IdempotencyKey,
		RequestedByStaffID: p.RequestedByStaffID, ShiftID: p.ShiftID, ResultReference: p.ResultReference, ResolvedAt: optional(p.ResolvedAt),
		ReturnedCents: p.ReturnedCents, RefundableCents: max(p.RefundableCents(), 0),
		History: []transitionJSON{}, CreatedAt: timestamp(p.CreatedAt), UpdatedAt: timestamp(p.UpdatedAt)}
	for _, t := range p.Transitions {
		var from *string
		if t.From != nil {
			f := string(*t.From)
			from = &f
		}
		j.History = append(j.History, transitionJSON{Sequence: t.Sequence, From: from, To: string(t.To), ActorID: t.ActorID,
			ActorKind: t.ActorKind, ResultReference: t.ResultReference, At: timestamp(t.At)})
	}
	return j
}

func summaryToJSON(s payments.Summary) summaryJSON {
	b := payments.ComputeBalance(s.TotalCents, s.Payments)
	j := summaryJSON{CheckID: s.CheckID, CheckStatus: s.CheckStatus, Currency: s.Currency, TotalCents: s.TotalCents,
		PaidCents: b.PaidCents, ReturnedCents: b.ReturnedCents, HeldCents: b.HeldCents, BalanceCents: b.BalanceCents, AvailableCents: max(b.AvailableCents, 0),
		Payments: []paymentJSON{}}
	if s.CheckStatus != "open" {
		j.AvailableCents = 0 // a voided or settled check takes no payment
	}
	if st := s.Settlement; st != nil {
		j.Settlement = &settlementJSON{ID: st.ID, Status: string(st.Status), Cycle: st.Cycle, AmountCents: st.AmountCents,
			Currency: st.Currency, SettlingPaymentID: st.SettlingPaymentID, ActorID: st.ActorID, ActorKind: st.ActorKind,
			SettledAt: timestamp(st.SettledAt), RevokedAt: optional(st.RevokedAt), History: []settlementEventJSON{}}
		for _, e := range st.History {
			j.Settlement.History = append(j.Settlement.History, settlementEventJSON{Sequence: e.Sequence, Status: string(e.Status),
				Cycle: e.Cycle, AmountCents: e.AmountCents, PaymentID: e.PaymentID, AdjustmentID: e.AdjustmentID, ActorID: e.ActorID,
				ActorKind: e.ActorKind, At: timestamp(e.At)})
		}
	}
	for _, p := range s.Payments {
		j.Payments = append(j.Payments, toJSON(p))
	}
	return j
}

// --- staff handlers ----------------------------------------------------------

// Initiate serves POST /api/venues/{venueId}/checks/{checkId}/payments: 201
// when this request initiated the payment, 200 for a replay of one that did.
// A card payment is pending and only the adapter reports its result; a cash
// payment is succeeded at once, accounted to the caller's open shift.
func (h *Handler) Initiate(w http.ResponseWriter, r *http.Request) {
	sc, staff, ok := h.staffScope(w, r)
	if !ok {
		return
	}
	var body struct {
		AmountCents    *int64 `json:"amountCents"`
		Currency       string `json:"currency"`
		TenderType     string `json:"tenderType"`
		IdempotencyKey string `json:"idempotencyKey"`
	}
	if !decode(w, r, &body) {
		return
	}
	if body.AmountCents == nil {
		httpx.WriteError(w, http.StatusBadRequest, "amountCents must be a positive integer")
		return
	}
	p, created, err := h.svc.Initiate(r.Context(), payments.InitiateCommand{Scope: sc, CheckID: r.PathValue("checkId"),
		AmountCents: *body.AmountCents, Currency: body.Currency, TenderType: payments.TenderType(body.TenderType),
		IdempotencyKey: body.IdempotencyKey, Actor: staff})
	if err != nil {
		h.respondError(w, r, err)
		return
	}
	status := http.StatusOK
	if created {
		status = http.StatusCreated
	}
	httpx.WriteJSON(w, status, toJSON(p))
}

// Summary serves GET /api/venues/{venueId}/checks/{checkId}/payments: the
// check's total, paid, held, balance and available amounts, its settlement
// and its payments, all computed on the server.
func (h *Handler) Summary(w http.ResponseWriter, r *http.Request) {
	sc, _, ok := h.staffScope(w, r)
	if !ok {
		return
	}
	s, err := h.svc.Summary(r.Context(), sc, r.PathValue("checkId"))
	if err != nil {
		h.respondError(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, summaryToJSON(s))
}

// Get serves GET /api/venues/{venueId}/payments/{paymentId}.
func (h *Handler) Get(w http.ResponseWriter, r *http.Request) {
	sc, _, ok := h.staffScope(w, r)
	if !ok {
		return
	}
	p, err := h.svc.Get(r.Context(), sc, r.PathValue("paymentId"))
	if err != nil {
		h.respondError(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, toJSON(p))
}

// --- adapter handler ---------------------------------------------------------

// Result serves POST /api/internal/payment-adapter/venues/{venueId}/payments/{paymentId}/result
// for a payment_adapter device of that venue only (behind
// devicesapi.Authenticate). 200 with the payment, whether this report changed
// it or it already had that outcome. The result's actor is the device.
func (h *Handler) Result(w http.ResponseWriter, r *http.Request) {
	adapter, ok := devicesapi.DeviceFrom(r.Context())
	if !ok {
		httpx.WriteInternalError(w)
		return
	}
	v, found, err := h.venues.Venue(r.Context(), adapter.VenueID)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	if !found {
		httpx.WriteError(w, http.StatusNotFound, "Venue not found")
		return
	}
	var body struct {
		Outcome   string  `json:"outcome"`
		Reference *string `json:"reference"`
	}
	if !decode(w, r, &body) {
		return
	}
	p, _, err := h.svc.RecordResult(r.Context(), payments.ResultCommand{
		Scope: payments.Scope{OrganizationID: v.OrganizationID, VenueID: v.ID}, PaymentID: r.PathValue("paymentId"),
		Outcome: payments.Status(body.Outcome), Reference: body.Reference, Actor: payments.Adapter{ID: adapter.DeviceID}})
	if err != nil {
		h.respondError(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, toJSON(p))
}

// staffScope authorizes the path's venue as the other venue-scoped APIs do.
func (h *Handler) staffScope(w http.ResponseWriter, r *http.Request) (payments.Scope, payments.Staff, bool) {
	p, ok := identity.PrincipalFrom(r.Context())
	if !ok {
		httpx.WriteInternalError(w)
		return payments.Scope{}, payments.Staff{}, false
	}
	venueID, err := identity.ResolveVenueScope(p, r.PathValue("venueId"))
	if err != nil {
		httpx.WriteError(w, http.StatusForbidden, err.Error())
		return payments.Scope{}, payments.Staff{}, false
	}
	v, found, err := h.venues.VenueInOrganization(r.Context(), venueID, p.OrganizationID)
	if err != nil {
		h.fail(w, r, err)
		return payments.Scope{}, payments.Staff{}, false
	}
	if !found {
		httpx.WriteError(w, http.StatusNotFound, "Venue not found")
		return payments.Scope{}, payments.Staff{}, false
	}
	return payments.Scope{OrganizationID: p.OrganizationID, VenueID: v.ID},
		payments.Staff{StaffID: p.ID, Email: p.Email, Role: p.Role, Device: audit.DeviceOf(p)}, true
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

// coded is a Nest-shaped error with a machine-readable code.
type coded struct {
	Message        string `json:"message"`
	Error          string `json:"error"`
	StatusCode     int    `json:"statusCode"`
	Code           string `json:"code"`
	PaymentID      string `json:"paymentId,omitempty"`
	CheckStatus    string `json:"checkStatus,omitempty"`
	PaymentStatus  string `json:"paymentStatus,omitempty"`
	AvailableCents *int64 `json:"availableCents,omitempty"`
}

func writeCoded(w http.ResponseWriter, status int, c coded) {
	c.Error, c.StatusCode = http.StatusText(status), status
	httpx.WriteJSON(w, status, c)
}

func (h *Handler) respondError(w http.ResponseWriter, r *http.Request, err error) {
	var (
		validation *payments.ValidationError
		idem       *payments.IdempotencyConflictError
		notOpen    *payments.CheckNotOpenError
		currency   *payments.CurrencyMismatchError
		exceeds    *payments.AmountExceedsAvailableError
		resolved   *payments.AlreadyResolvedError
	)
	switch {
	case errors.As(err, &validation):
		httpx.WriteError(w, http.StatusBadRequest, validation.Message)
	case errors.As(err, &idem):
		writeCoded(w, http.StatusConflict, coded{Message: idem.Error(), Code: "IDEMPOTENCY_CONFLICT", PaymentID: idem.PaymentID})
	case errors.As(err, &notOpen):
		writeCoded(w, http.StatusConflict, coded{Message: notOpen.Error(), Code: "CHECK_NOT_OPEN", CheckStatus: notOpen.Status})
	case errors.As(err, &currency):
		writeCoded(w, http.StatusConflict, coded{Message: currency.Error(), Code: "CURRENCY_MISMATCH"})
	case errors.As(err, &exceeds):
		available := exceeds.AvailableCents
		writeCoded(w, http.StatusConflict, coded{Message: exceeds.Error(), Code: "AMOUNT_EXCEEDS_AVAILABLE", AvailableCents: &available})
	case errors.As(err, &resolved):
		writeCoded(w, http.StatusConflict, coded{Message: resolved.Error(), Code: "PAYMENT_ALREADY_RESOLVED", PaymentStatus: string(resolved.Status)})
	case errors.Is(err, payments.ErrPaymentNotFound), errors.Is(err, payments.ErrCheckNotFound):
		httpx.WriteError(w, http.StatusNotFound, err.Error())
	case errors.Is(err, payments.ErrNoOpenShift):
		writeCoded(w, http.StatusConflict, coded{Message: err.Error(), Code: "NO_OPEN_SHIFT"})
	case errors.Is(err, payments.ErrUnknownActor):
		httpx.WriteError(w, http.StatusForbidden, err.Error())
	case errors.Is(err, payments.ErrWritesDisabled):
		writeCoded(w, http.StatusServiceUnavailable, coded{Message: err.Error(), Code: "PAYMENT_WRITES_DISABLED"})
	default:
		h.fail(w, r, err)
	}
}

func (h *Handler) fail(w http.ResponseWriter, r *http.Request, err error) {
	h.logger.ErrorContext(r.Context(), "payment request failed", "error", err, "request_id", httpx.RequestIDFrom(r.Context()))
	httpx.WriteInternalError(w)
}
