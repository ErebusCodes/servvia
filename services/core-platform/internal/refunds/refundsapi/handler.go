// Package refundsapi is the HTTP transport of the refunds domain:
// contracts/openapi/refunds.yaml.
//
// Two trust paths, never mixed:
//   - staff with a refund role request a refund of a payment and read
//     refunds; no staff route can report a card refund's result or declare a
//     reversal;
//   - the venue's payment_adapter device (behind devicesapi.Authenticate)
//     reports a card refund's result, and reports provider reversals.
package refundsapi

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
	"servvia/services/core-platform/internal/refunds"
	"servvia/services/core-platform/internal/venues"
)

// Roles may request refunds and read them: the roles that approve financial
// corrections (Nest reserves manager step-up for refunds). Not cashier.
var Roles = []string{identity.RoleAdmin, identity.RoleManager}

// VenueResolver finds venues (venues.Store).
type VenueResolver interface {
	VenueInOrganization(ctx context.Context, venueID, organizationID string) (venues.Venue, bool, error)
	Venue(ctx context.Context, id string) (venues.Venue, bool, error)
}

type Handler struct {
	svc    *refunds.Service
	venues VenueResolver
	logger *slog.Logger
}

func NewHandler(svc *refunds.Service, v VenueResolver, logger *slog.Logger) *Handler {
	return &Handler{svc: svc, venues: v, logger: logger}
}

func timestamp(t time.Time) string { return t.UTC().Format("2006-01-02T15:04:05.000Z") }

type transitionJSON struct {
	Sequence        int     `json:"sequence"`
	From            *string `json:"fromStatus"`
	To              string  `json:"toStatus"`
	ActorID         string  `json:"actorId"`
	ActorKind       string  `json:"actorKind"`
	ResultReference *string `json:"resultReference"`
	At              string  `json:"at"`
}

type refundJSON struct {
	ID                 string           `json:"id"`
	VenueID            string           `json:"venueId"`
	PaymentID          string           `json:"paymentId"`
	CheckID            string           `json:"checkId"`
	Kind               string           `json:"kind"`
	AmountCents        int64            `json:"amountCents"`
	Currency           string           `json:"currency"`
	TenderType         string           `json:"tenderType"`
	Status             string           `json:"status"`
	Version            int              `json:"version"`
	IdempotencyKey     string           `json:"idempotencyKey"`
	Reason             *string          `json:"reason"`
	RequestedByStaffID *string          `json:"requestedByStaffId"`
	OriginDeviceID     *string          `json:"originDeviceId"`
	ShiftID            *string          `json:"shiftId"`
	ResultReference    *string          `json:"resultReference"`
	ResolvedAt         *string          `json:"resolvedAt"`
	History            []transitionJSON `json:"history"`
	CreatedAt          string           `json:"createdAt"`
	UpdatedAt          string           `json:"updatedAt"`
}

func toJSON(a refunds.Adjustment) refundJSON {
	j := refundJSON{ID: a.ID, VenueID: a.VenueID, PaymentID: a.PaymentID, CheckID: a.CheckID, Kind: string(a.Kind),
		AmountCents: a.AmountCents, Currency: a.Currency, TenderType: string(a.TenderType), Status: string(a.Status), Version: a.Version,
		IdempotencyKey: a.IdempotencyKey, Reason: a.Reason, RequestedByStaffID: a.RequestedByStaffID, OriginDeviceID: a.OriginDeviceID,
		ShiftID: a.ShiftID, ResultReference: a.ResultReference, History: []transitionJSON{},
		CreatedAt: timestamp(a.CreatedAt), UpdatedAt: timestamp(a.UpdatedAt)}
	if a.ResolvedAt != nil {
		r := timestamp(*a.ResolvedAt)
		j.ResolvedAt = &r
	}
	for _, t := range a.Transitions {
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

// --- staff -------------------------------------------------------------------

// Request serves POST /api/venues/{venueId}/payments/{paymentId}/refunds: 201
// when this request created the refund (card: pending; cash: succeeded, paid
// out of the caller's open shift), 200 for a replay.
func (h *Handler) Request(w http.ResponseWriter, r *http.Request) {
	sc, staff, ok := h.staffScope(w, r)
	if !ok {
		return
	}
	var body struct {
		AmountCents    *int64 `json:"amountCents"`
		Currency       string `json:"currency"`
		Reason         string `json:"reason"`
		IdempotencyKey string `json:"idempotencyKey"`
	}
	if !decode(w, r, &body) {
		return
	}
	if body.AmountCents == nil {
		httpx.WriteError(w, http.StatusBadRequest, "amountCents must be a positive integer")
		return
	}
	a, created, err := h.svc.Refund(r.Context(), refunds.RefundCommand{Scope: sc, PaymentID: r.PathValue("paymentId"),
		AmountCents: *body.AmountCents, Currency: body.Currency, Reason: body.Reason, IdempotencyKey: body.IdempotencyKey, Actor: staff})
	h.respondCreated(w, r, a, created, err)
}

// ListForPayment serves GET /api/venues/{venueId}/payments/{paymentId}/refunds.
func (h *Handler) ListForPayment(w http.ResponseWriter, r *http.Request) {
	sc, _, ok := h.staffScope(w, r)
	if !ok {
		return
	}
	found, err := h.svc.ListForPayment(r.Context(), sc, r.PathValue("paymentId"))
	if err != nil {
		h.respondError(w, r, err)
		return
	}
	out := make([]refundJSON, 0, len(found))
	for _, a := range found {
		out = append(out, toJSON(a))
	}
	httpx.WriteJSON(w, http.StatusOK, out)
}

// Get serves GET /api/venues/{venueId}/refunds/{refundId}.
func (h *Handler) Get(w http.ResponseWriter, r *http.Request) {
	sc, _, ok := h.staffScope(w, r)
	if !ok {
		return
	}
	a, err := h.svc.Get(r.Context(), sc, r.PathValue("refundId"))
	if err != nil {
		h.respondError(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, toJSON(a))
}

// --- payment adapter device --------------------------------------------------

// Result serves POST /api/internal/payment-adapter/venues/{venueId}/refunds/{refundId}/result.
func (h *Handler) Result(w http.ResponseWriter, r *http.Request) {
	sc, deviceID, ok := h.adapterScope(w, r)
	if !ok {
		return
	}
	var body struct {
		Outcome   string  `json:"outcome"`
		Reference *string `json:"reference"`
	}
	if !decode(w, r, &body) {
		return
	}
	a, _, err := h.svc.RecordResult(r.Context(), refunds.ResultCommand{Scope: sc, AdjustmentID: r.PathValue("refundId"),
		Outcome: payments.Status(body.Outcome), Reference: body.Reference, DeviceID: deviceID})
	if err != nil {
		h.respondError(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, toJSON(a))
}

// Reverse serves POST /api/internal/payment-adapter/venues/{venueId}/payments/{paymentId}/reversals:
// the provider reversed (part of) a card tender. 201 when recorded now, 200
// for a replay of the same key.
func (h *Handler) Reverse(w http.ResponseWriter, r *http.Request) {
	sc, deviceID, ok := h.adapterScope(w, r)
	if !ok {
		return
	}
	var body struct {
		AmountCents    *int64  `json:"amountCents"`
		Currency       string  `json:"currency"`
		Reference      *string `json:"reference"`
		IdempotencyKey string  `json:"idempotencyKey"`
	}
	if !decode(w, r, &body) {
		return
	}
	if body.AmountCents == nil {
		httpx.WriteError(w, http.StatusBadRequest, "amountCents must be a positive integer")
		return
	}
	a, created, err := h.svc.Reverse(r.Context(), refunds.ReversalCommand{Scope: sc, PaymentID: r.PathValue("paymentId"),
		AmountCents: *body.AmountCents, Currency: body.Currency, Reference: body.Reference, IdempotencyKey: body.IdempotencyKey,
		DeviceID: deviceID})
	h.respondCreated(w, r, a, created, err)
}

func (h *Handler) respondCreated(w http.ResponseWriter, r *http.Request, a refunds.Adjustment, created bool, err error) {
	if err != nil {
		h.respondError(w, r, err)
		return
	}
	status := http.StatusOK
	if created {
		status = http.StatusCreated
	}
	httpx.WriteJSON(w, status, toJSON(a))
}

func (h *Handler) staffScope(w http.ResponseWriter, r *http.Request) (refunds.Scope, refunds.Staff, bool) {
	p, ok := identity.PrincipalFrom(r.Context())
	if !ok {
		httpx.WriteInternalError(w)
		return refunds.Scope{}, refunds.Staff{}, false
	}
	venueID, err := identity.ResolveVenueScope(p, r.PathValue("venueId"))
	if err != nil {
		httpx.WriteError(w, http.StatusForbidden, err.Error())
		return refunds.Scope{}, refunds.Staff{}, false
	}
	v, found, err := h.venues.VenueInOrganization(r.Context(), venueID, p.OrganizationID)
	if err != nil {
		h.fail(w, r, err)
		return refunds.Scope{}, refunds.Staff{}, false
	}
	if !found {
		httpx.WriteError(w, http.StatusNotFound, "Venue not found")
		return refunds.Scope{}, refunds.Staff{}, false
	}
	return refunds.Scope{OrganizationID: p.OrganizationID, VenueID: v.ID}, refunds.Staff{StaffID: p.ID, Email: p.Email, Role: p.Role, Device: audit.DeviceOf(p)}, true
}

// adapterScope is the venue of the authenticated payment adapter device.
func (h *Handler) adapterScope(w http.ResponseWriter, r *http.Request) (refunds.Scope, string, bool) {
	adapter, ok := devicesapi.DeviceFrom(r.Context())
	if !ok {
		httpx.WriteInternalError(w)
		return refunds.Scope{}, "", false
	}
	v, found, err := h.venues.Venue(r.Context(), adapter.VenueID)
	if err != nil {
		h.fail(w, r, err)
		return refunds.Scope{}, "", false
	}
	if !found {
		httpx.WriteError(w, http.StatusNotFound, "Venue not found")
		return refunds.Scope{}, "", false
	}
	return refunds.Scope{OrganizationID: v.OrganizationID, VenueID: v.ID}, adapter.DeviceID, true
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
	Message         string `json:"message"`
	Error           string `json:"error"`
	StatusCode      int    `json:"statusCode"`
	Code            string `json:"code"`
	RefundID        string `json:"refundId,omitempty"`
	PaymentStatus   string `json:"paymentStatus,omitempty"`
	RefundStatus    string `json:"refundStatus,omitempty"`
	RefundableCents *int64 `json:"refundableCents,omitempty"`
}

func writeCoded(w http.ResponseWriter, status int, c coded) {
	c.Error, c.StatusCode = http.StatusText(status), status
	httpx.WriteJSON(w, status, c)
}

func (h *Handler) respondError(w http.ResponseWriter, r *http.Request, err error) {
	var (
		validation    *refunds.ValidationError
		idem          *refunds.IdempotencyConflictError
		notRefundable *refunds.PaymentNotRefundableError
		currency      *refunds.CurrencyMismatchError
		exceeds       *refunds.ExceedsRefundableError
		resolved      *payments.AlreadyResolvedError
		payValidation *payments.ValidationError
	)
	switch {
	case errors.As(err, &validation):
		httpx.WriteError(w, http.StatusBadRequest, validation.Message)
	case errors.As(err, &payValidation):
		httpx.WriteError(w, http.StatusBadRequest, payValidation.Message)
	case errors.As(err, &idem):
		writeCoded(w, http.StatusConflict, coded{Message: idem.Error(), Code: "IDEMPOTENCY_CONFLICT", RefundID: idem.ID})
	case errors.As(err, &notRefundable):
		writeCoded(w, http.StatusConflict, coded{Message: notRefundable.Error(), Code: "PAYMENT_NOT_REFUNDABLE", PaymentStatus: string(notRefundable.Status)})
	case errors.As(err, &currency):
		writeCoded(w, http.StatusConflict, coded{Message: currency.Error(), Code: "CURRENCY_MISMATCH"})
	case errors.As(err, &exceeds):
		refundable := exceeds.RefundableCents
		writeCoded(w, http.StatusConflict, coded{Message: exceeds.Error(), Code: "EXCEEDS_REFUNDABLE", RefundableCents: &refundable})
	case errors.As(err, &resolved):
		writeCoded(w, http.StatusConflict, coded{Message: resolved.Error(), Code: "REFUND_ALREADY_RESOLVED", RefundStatus: string(resolved.Status)})
	case errors.Is(err, refunds.ErrNoOpenShift):
		writeCoded(w, http.StatusConflict, coded{Message: err.Error(), Code: "NO_OPEN_SHIFT"})
	case errors.Is(err, refunds.ErrNotReversible):
		writeCoded(w, http.StatusConflict, coded{Message: err.Error(), Code: "NOT_REVERSIBLE"})
	case errors.Is(err, refunds.ErrNotAwaitingResult):
		writeCoded(w, http.StatusConflict, coded{Message: err.Error(), Code: "NOT_AWAITING_RESULT"})
	case errors.Is(err, refunds.ErrAdjustmentNotFound), errors.Is(err, refunds.ErrPaymentNotFound):
		httpx.WriteError(w, http.StatusNotFound, err.Error())
	case errors.Is(err, refunds.ErrUnknownActor):
		httpx.WriteError(w, http.StatusForbidden, err.Error())
	case errors.Is(err, refunds.ErrWritesDisabled):
		writeCoded(w, http.StatusServiceUnavailable, coded{Message: err.Error(), Code: "REFUND_WRITES_DISABLED"})
	default:
		h.fail(w, r, err)
	}
}

func (h *Handler) fail(w http.ResponseWriter, r *http.Request, err error) {
	h.logger.ErrorContext(r.Context(), "refund request failed", "error", err, "request_id", httpx.RequestIDFrom(r.Context()))
	httpx.WriteInternalError(w)
}
