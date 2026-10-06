package contract

// Payments are new Servvia-native behaviour, tested against the written
// contract (contracts/openapi/payments.yaml). These tests cover the two trust
// paths and request validation, which refuse before any repository use;
// every database guarantee is tested against PostgreSQL in
// tests/integration.

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"testing"
	"time"

	"servvia/services/core-platform/internal/devices"
	"servvia/services/core-platform/internal/health"
	"servvia/services/core-platform/internal/identity"
	"servvia/services/core-platform/internal/menu"
	"servvia/services/core-platform/internal/payments"
	"servvia/services/core-platform/internal/payments/paymentsapi"
	"servvia/services/core-platform/internal/ratelimit"
	"servvia/services/core-platform/internal/server"
	"servvia/services/core-platform/internal/venues"
	"servvia/services/core-platform/tests/testsupport"
)

// noPayments answers "not found" everywhere: an authorized request reaches
// it, a refused one never does.
type noPayments struct{}

func (noPayments) FindByKey(context.Context, string, string) (payments.Payment, string, bool, error) {
	return payments.Payment{}, "", false, nil
}
func (noPayments) Get(context.Context, string, string) (payments.Payment, error) {
	return payments.Payment{}, payments.ErrPaymentNotFound
}
func (noPayments) Summary(context.Context, string, string) (payments.Summary, error) {
	return payments.Summary{}, payments.ErrCheckNotFound
}
func (noPayments) Initiate(context.Context, payments.NewPayment) (payments.Payment, error) {
	return payments.Payment{}, payments.ErrCheckNotFound
}
func (noPayments) RecordResult(context.Context, payments.ResultCommand) (payments.Payment, bool, error) {
	return payments.Payment{}, false, payments.ErrPaymentNotFound
}
func (noPayments) Audit(context.Context, payments.Scope, payments.Staff, string, string, map[string]any) {
}

// adapterVenues also resolves a venue by id, as the adapter route does.
type adapterVenues struct{ venueStore }

func (adapterVenues) Venue(_ context.Context, id string) (venues.Venue, bool, error) {
	if id != venueID {
		return venues.Venue{}, false, nil
	}
	return venues.Venue{ID: venueID, OrganizationID: orgID}, true, nil
}

func paymentRoutes(writable bool) http.Handler {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	return server.Routes(server.Deps{
		Logger: logger, Health: health.New(okPinger{}, time.Second),
		Menu:     menu.NewHandler(staticStore{}, logger),
		Venues:   venues.NewHandler(venueStore{}, logger),
		Payments: paymentsapi.NewHandler(payments.NewService(noPayments{}, writable), adapterVenues{}, logger),
		Verifier: identity.NewVerifier(secret), TabletDevices: activeDevices{}, VenueGrants: grantAll{}, StaffSessions: activeStaff,
		RateLimiter: ratelimit.New(admit, 0, logger), DeviceAuth: contractDevices.service(),
	})
}

func paymentSchema(t *testing.T, name string) func([]byte) {
	s := testsupport.Schema(t, "openapi/payments.yaml", "/components/schemas/"+name)
	return func(b []byte) { t.Helper(); testsupport.Validate(t, s, b) }
}

func tender() map[string]any {
	return map[string]any{"amountCents": 500, "currency": "NZD", "tenderType": "card", "idempotencyKey": testsupport.UUID()}
}

func TestPaymentStaffAuthorization(t *testing.T) {
	h := paymentRoutes(true)
	claims := nestShapedClaims()
	nestErr := paymentSchema(t, "NestError")
	initiate := base(venueID) + "/checks/" + testsupport.UUID() + "/payments"
	get := base(venueID) + "/payments/" + testsupport.UUID()
	for name, c := range map[string]struct {
		token, method, path string
		body                any
		status              int
	}{
		// Allowed callers reach the service (here: not found, 404).
		"owner":                   {signed(t, claims["staff"]), "POST", initiate, tender(), 404},
		"cashier":                 {staffWithRole(t, "cashier"), "POST", initiate, tender(), 404},
		"manager reads":           {staffWithRole(t, "manager"), "GET", initiate, nil, 404},
		"tablet elevated (staff)": {signed(t, claims["tablet_staff"]), "GET", get, nil, 404},
		// Never a kitchen or device identity, never without a financial role.
		"KDS initiates":        {signed(t, claims["kds_device"]), "POST", initiate, tender(), 403},
		"KDS reads":            {signed(t, claims["kds_device"]), "GET", get, nil, 403},
		"kitchen staff":        {staffWithRole(t, "kitchen"), "POST", initiate, tender(), 403},
		"viewer":               {staffWithRole(t, "viewer"), "GET", initiate, nil, 403},
		"customer-mode tablet": {signed(t, claims["tablet_device"]), "POST", initiate, tender(), 403},
		"no token":             {"", "GET", get, nil, 401},
		// The adapter secret is not a staff credential.
		"adapter credential on a staff route": {contractDevices.adapter, "POST", initiate, tender(), 401},
		"staff, another org's venue":          {signed(t, claims["staff"]), "GET", base(otherVenue) + "/payments/x", nil, 404},
		"tablet, another venue":               {signed(t, claims["tablet_staff"]), "GET", base(otherVenue) + "/payments/x", nil, 403},
	} {
		res := do(t, h, c.method, c.path, c.token, c.body)
		if res.status != c.status {
			t.Errorf("%s: %d %s", name, res.status, res.body)
			continue
		}
		nestErr(res.body)
	}
}

func TestPaymentResultTrustBoundary(t *testing.T) {
	claims := nestShapedClaims()
	result := func(venue string) string {
		return "/api/internal/payment-adapter/venues/" + venue + "/payments/" + testsupport.UUID() + "/result"
	}
	body := map[string]any{"outcome": "succeeded", "reference": "txn-1"}
	h := paymentRoutes(true)
	nestErr := paymentSchema(t, "NestError")
	id, secret, _ := devices.ParseCredential(contractDevices.adapter)
	for name, c := range map[string]struct {
		token  string
		venue  string
		status int
	}{
		// Only this venue's payment adapter device reaches the service
		// (here: no such payment, 404).
		"the venue's payment adapter": {contractDevices.adapter, venueID, 404},
		// Staff identities, however privileged, are not device credentials.
		"owner JWT":   {signed(t, claims["staff"]), venueID, 401},
		"manager JWT": {staffWithRole(t, "manager"), venueID, 401},
		"KDS JWT":     {signed(t, claims["kds_device"]), venueID, 401},
		// Device credentials that are not a live adapter of this venue.
		"malformed credential": {"sdv1.nope", venueID, 401},
		"unknown device":       {"sdv1." + testsupport.UUID() + "." + secret, venueID, 401},
		"wrong secret":         {"sdv1." + id + "." + strings.Repeat("A", 43), venueID, 401},
		"revoked adapter":      {contractDevices.revoked, venueID, 401},
		"KDS device":           {contractDevices.kds, venueID, 403},
		"adapter, other venue": {contractDevices.adapter, otherVenue, 403},
		// Nest's CSRF middleware runs before authentication on unsafe methods.
		"no token": {"", venueID, 403},
	} {
		res := do(t, h, "POST", result(c.venue), c.token, body)
		if res.status != c.status {
			t.Errorf("%s: %d %s", name, res.status, res.body)
			continue
		}
		nestErr(res.body)
	}
	if res := do(t, h, "POST", result(venueID), contractDevices.adapter, map[string]any{"outcome": "pending"}); res.status != 400 {
		t.Errorf("pending is not a result: %d %s", res.status, res.body)
	}
}

func TestPaymentRequestValidation(t *testing.T) {
	h := paymentRoutes(true)
	cashier := staffWithRole(t, "cashier")
	nestErr := paymentSchema(t, "NestError")
	initiate := base(venueID) + "/checks/c/payments"
	for name, c := range map[string]struct {
		body map[string]any
		msg  string
	}{
		"no amount":   {map[string]any{"currency": "NZD", "tenderType": "card", "idempotencyKey": testsupport.UUID()}, "amountCents must be a positive integer"},
		"zero amount": {map[string]any{"amountCents": 0, "currency": "NZD", "tenderType": "card", "idempotencyKey": testsupport.UUID()}, "amountCents must be a positive integer"},
		"fractional":  {map[string]any{"amountCents": 1.5, "currency": "NZD", "tenderType": "card", "idempotencyKey": testsupport.UUID()}, "amountCents has the wrong type"},
		"voucher":     {map[string]any{"amountCents": 5, "currency": "NZD", "tenderType": "voucher", "idempotencyKey": testsupport.UUID()}, "tenderType must be one of card, cash"},
		"currency":    {map[string]any{"amountCents": 5, "currency": "dollars", "tenderType": "card", "idempotencyKey": testsupport.UUID()}, "currency must be an ISO 4217 code such as NZD"},
		"short key":   {map[string]any{"amountCents": 5, "currency": "NZD", "tenderType": "card", "idempotencyKey": "short"}, "idempotencyKey must be a string of 16 to 255 characters"},
	} {
		res := do(t, h, "POST", initiate, cashier, c.body)
		if res.status != 400 || res.json["message"] != c.msg {
			t.Errorf("%s: %d %s", name, res.status, res.body)
			continue
		}
		nestErr(res.body)
	}
	ro := paymentRoutes(false)
	res := do(t, ro, "POST", initiate, cashier, tender())
	if res.status != 503 || res.json["code"] != "PAYMENT_WRITES_DISABLED" {
		t.Errorf("read-only: %d %s", res.status, res.body)
	}
	paymentSchema(t, "CodedError")(res.body)
}
