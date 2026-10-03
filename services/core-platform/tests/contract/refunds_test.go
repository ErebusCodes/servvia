package contract

// Refunds and reversals are new Servvia-native behaviour, tested against the
// written contract (contracts/openapi/refunds.yaml). These tests cover the
// two trust paths and request validation, which refuse before any repository
// use; capacity, settlement and cash guarantees are tested against
// PostgreSQL in tests/integration.

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"testing"
	"time"

	"servvia/services/core-platform/internal/health"
	"servvia/services/core-platform/internal/identity"
	"servvia/services/core-platform/internal/menu"
	"servvia/services/core-platform/internal/ratelimit"
	"servvia/services/core-platform/internal/refunds"
	"servvia/services/core-platform/internal/refunds/refundsapi"
	"servvia/services/core-platform/internal/server"
	"servvia/services/core-platform/tests/testsupport"
)

// noRefunds: nothing exists, so an authorized request gets 404 and a refused
// one never reaches it.
type noRefunds struct{}

func (noRefunds) FindByKey(context.Context, string, string) (refunds.Adjustment, string, bool, error) {
	return refunds.Adjustment{}, "", false, nil
}
func (noRefunds) Get(context.Context, string, string) (refunds.Adjustment, error) {
	return refunds.Adjustment{}, refunds.ErrAdjustmentNotFound
}
func (noRefunds) ListForPayment(context.Context, string, string) ([]refunds.Adjustment, error) {
	return nil, refunds.ErrPaymentNotFound
}
func (noRefunds) Create(context.Context, refunds.NewAdjustment) (refunds.Adjustment, error) {
	return refunds.Adjustment{}, refunds.ErrPaymentNotFound
}
func (noRefunds) RecordResult(context.Context, refunds.ResultCommand) (refunds.Adjustment, bool, error) {
	return refunds.Adjustment{}, false, refunds.ErrAdjustmentNotFound
}
func (noRefunds) Audit(context.Context, refunds.Scope, refunds.Staff, string, string, map[string]any) {
}

func refundRoutes(writable bool) http.Handler {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	return server.Routes(server.Deps{
		Logger: logger, Health: health.New(okPinger{}, time.Second),
		Menu:     menu.NewHandler(staticStore{}, logger),
		Refunds:  refundsapi.NewHandler(refunds.NewService(noRefunds{}, writable), adapterVenues{}, logger),
		Verifier: identity.NewVerifier(secret), TabletDevices: activeDevices{}, VenueGrants: grantAll{},
		RateLimiter: ratelimit.New(admit, 0, logger), DeviceAuth: contractDevices.service(),
	})
}

func TestRefundAuthorization(t *testing.T) {
	h := refundRoutes(true)
	claims := nestShapedClaims()
	nestErr := testsupport.Schema(t, "openapi/refunds.yaml", "/components/schemas/NestError")
	request := base(venueID) + "/payments/" + testsupport.UUID() + "/refunds"
	body := func() map[string]any {
		return map[string]any{"amountCents": 100, "currency": "NZD", "reason": "cold", "idempotencyKey": testsupport.UUID()}
	}
	result := "/api/internal/payment-adapter/venues/" + venueID + "/refunds/" + testsupport.UUID() + "/result"
	reversal := "/api/internal/payment-adapter/venues/" + venueID + "/payments/" + testsupport.UUID() + "/reversals"
	reversalBody := map[string]any{"amountCents": 100, "currency": "NZD", "idempotencyKey": testsupport.UUID()}
	for name, c := range map[string]struct {
		token, path string
		body        any
		status      int
	}{
		// Refund authority: owner, admin, manager (reach the service: 404).
		"owner requests":   {signed(t, claims["staff"]), request, body(), 404},
		"manager requests": {staffWithRole(t, "manager"), request, body(), 404},
		"tablet manager":   {signed(t, claims["tablet_manager"]), request, body(), 404},
		// Never cashier, kitchen, viewer, KDS, customer tablet or a device.
		"cashier requests":        {staffWithRole(t, "cashier"), request, body(), 403},
		"tablet staff (cashier)":  {signed(t, claims["tablet_staff"]), request, body(), 403},
		"kitchen":                 {staffWithRole(t, "kitchen"), request, body(), 403},
		"KDS JWT":                 {signed(t, claims["kds_device"]), request, body(), 403},
		"customer-mode tablet":    {signed(t, claims["tablet_device"]), request, body(), 403},
		"adapter device on staff": {contractDevices.adapter, request, body(), 401},
		// Results and reversals: only the venue's live payment adapter.
		"adapter reports":            {contractDevices.adapter, result, map[string]any{"outcome": "succeeded"}, 404},
		"owner JWT reports":          {signed(t, claims["staff"]), result, map[string]any{"outcome": "succeeded"}, 401},
		"KDS device reports":         {contractDevices.kds, result, map[string]any{"outcome": "succeeded"}, 403},
		"revoked adapter reports":    {contractDevices.revoked, result, map[string]any{"outcome": "succeeded"}, 401},
		"adapter reverses":           {contractDevices.adapter, reversal, reversalBody, 404},
		"owner JWT reverses":         {signed(t, claims["staff"]), reversal, reversalBody, 401},
		"KDS device reverses":        {contractDevices.kds, reversal, reversalBody, 403},
		"adapter, another venue":     {contractDevices.adapter, "/api/internal/payment-adapter/venues/" + otherVenue + "/refunds/x/result", map[string]any{"outcome": "failed"}, 403},
		"staff, another org's venue": {signed(t, claims["staff"]), base(otherVenue) + "/payments/x/refunds", body(), 404},
	} {
		res := do(t, h, "POST", c.path, c.token, c.body)
		if res.status != c.status {
			t.Errorf("%s: %d %s", name, res.status, res.body)
			continue
		}
		testsupport.Validate(t, nestErr, res.body)
	}
}

func TestRefundRequestValidation(t *testing.T) {
	h := refundRoutes(true)
	owner := signed(t, nestShapedClaims()["staff"])
	request := base(venueID) + "/payments/p/refunds"
	for name, c := range map[string]struct {
		body map[string]any
		msg  string
	}{
		"no amount":   {map[string]any{"currency": "NZD", "reason": "r", "idempotencyKey": testsupport.UUID()}, "amountCents must be a positive integer"},
		"zero amount": {map[string]any{"amountCents": 0, "currency": "NZD", "reason": "r", "idempotencyKey": testsupport.UUID()}, "amountCents must be a positive integer"},
		"no reason":   {map[string]any{"amountCents": 1, "currency": "NZD", "reason": " ", "idempotencyKey": testsupport.UUID()}, "reason must be a string of 1 to 500 characters"},
		"currency":    {map[string]any{"amountCents": 1, "currency": "dollars", "reason": "r", "idempotencyKey": testsupport.UUID()}, "currency must be an ISO 4217 code such as NZD"},
		"short key":   {map[string]any{"amountCents": 1, "currency": "NZD", "reason": "r", "idempotencyKey": "short"}, "idempotencyKey must be a string of 16 to 255 characters"},
	} {
		res := do(t, h, "POST", request, owner, c.body)
		if res.status != 400 || res.json["message"] != c.msg {
			t.Errorf("%s: %d %s", name, res.status, res.body)
		}
	}
	result := "/api/internal/payment-adapter/venues/" + venueID + "/refunds/r/result"
	if res := do(t, h, "POST", result, contractDevices.adapter, map[string]any{"outcome": "pending"}); res.status != 400 {
		t.Errorf("pending is not a result: %d %s", res.status, res.body)
	}
	res := do(t, refundRoutes(false), "POST", request, owner, map[string]any{"amountCents": 1, "currency": "NZD", "reason": "r", "idempotencyKey": testsupport.UUID()})
	if res.status != 503 || res.json["code"] != "REFUND_WRITES_DISABLED" {
		t.Errorf("read-only: %d %s", res.status, res.body)
	}
}
