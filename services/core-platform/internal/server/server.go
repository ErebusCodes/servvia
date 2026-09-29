// Package server wires the Core Platform's HTTP routes and middleware.
package server

import (
	"log/slog"
	"net/http"

	"servvia/services/core-platform/internal/checks/checksapi"
	"servvia/services/core-platform/internal/devices"
	"servvia/services/core-platform/internal/devices/devicesapi"
	"servvia/services/core-platform/internal/health"
	"servvia/services/core-platform/internal/identity"
	"servvia/services/core-platform/internal/kitchen/kitchenapi"
	"servvia/services/core-platform/internal/menu"
	"servvia/services/core-platform/internal/orders/ordersapi"
	"servvia/services/core-platform/internal/payments/paymentsapi"
	"servvia/services/core-platform/internal/platform/httpx"
	"servvia/services/core-platform/internal/promotions/promotionsapi"
	"servvia/services/core-platform/internal/ratelimit"
	"servvia/services/core-platform/internal/refunds/refundsapi"
	"servvia/services/core-platform/internal/shifts/shiftsapi"
	"servvia/services/core-platform/internal/tables/tablesapi"
	"servvia/services/core-platform/internal/venues"
)

type Deps struct {
	Logger        *slog.Logger
	Health        *health.Handler
	Menu          *menu.Handler
	Venues        *venues.Handler
	TableSessions *tablesapi.Handler
	Orders        *ordersapi.Handler
	Kitchen       *kitchenapi.Handler
	Checks        *checksapi.Handler
	Payments      *paymentsapi.Handler
	Shifts        *shiftsapi.Handler
	Devices       *devicesapi.Handler
	Refunds       *refundsapi.Handler
	Promotions    *promotionsapi.Handler
	// DeviceAuth authenticates device credentials (Phase D8), e.g. the
	// payment adapter on its result route.
	DeviceAuth    *devices.Service
	Verifier      *identity.Verifier
	TabletDevices identity.TabletDevices
	RateLimiter   *ratelimit.Limiter
	// SecureCookies is NODE_ENV=production: the csrf_token cookie gets Secure.
	SecureCookies bool
}

// Routes returns the full handler. Paths under /api keep the NestJS API's
// external paths and its Express request handling (see httpx.Router), so a
// proxy can move one route at a time; /health and /ready are this service's
// own probes.
//
// Layering, outermost first, in the order Nest applies the same steps:
// request IDs and access log (Go's own), CORS (app.enableCors runs before
// everything), ETag/304 (Express res.send), routing with path decoding, Nest
// middleware (security headers, CSRF), then per-route guards.
func Routes(d Deps) http.Handler {
	nestMiddleware := func(h http.Handler) http.Handler {
		return httpx.Chain(h, httpx.SecurityHeaders, httpx.CSRF(d.SecureCookies))
	}
	rt := httpx.NewRouter(nestMiddleware)
	rt.Handle("/health", httpx.SecurityHeaders(http.HandlerFunc(d.Health.Live)))
	rt.Handle("/ready", httpx.SecurityHeaders(http.HandlerFunc(d.Health.Ready)))

	// ChannelMenuController: @RateLimit({ limit: 120, windowSeconds: 60 }).
	rt.Nest(http.MethodGet, "/api/menu/venues/{venueId}/channel/{channel}", httpx.Chain(
		http.HandlerFunc(d.Menu.ChannelMenu),
		d.RateLimiter.Middleware(ratelimit.Rule{Limit: 120, WindowSeconds: 60}),
	))

	// VenuesController.getTaxConfig: JwtAuthGuard, RolesGuard, then the
	// method's TabletTokenActiveGuard. No rate limit.
	rt.Nest(http.MethodGet, "/api/venues/{id}/tax-config", httpx.Chain(
		http.HandlerFunc(d.Venues.TaxConfig),
		identity.Authenticate(d.Verifier),
		identity.RequireRoles(venues.TaxConfigRoles...),
		identity.RequireActiveTabletDevice(d.TabletDevices, d.Logger),
	))

	// Table sessions (Phase D2): new Servvia-native API, no Nest equivalent
	// (contracts/openapi/table-sessions.yaml). Staff only: a named staff
	// login or a tablet elevated by a staff PIN, with a floor role.
	staffOnly := func(h http.HandlerFunc) http.Handler {
		return httpx.Chain(h,
			identity.Authenticate(d.Verifier),
			identity.RequireStaff,
			identity.RequireRoles(tablesapi.Roles...),
			identity.RequireActiveTabletDevice(d.TabletDevices, d.Logger),
		)
	}
	ts := d.TableSessions
	rt.Nest(http.MethodGet, "/api/venues/{venueId}/table-sessions", staffOnly(ts.ListOpen))
	rt.Nest(http.MethodGet, "/api/venues/{venueId}/table-sessions/{sessionId}", staffOnly(ts.Get))
	rt.Nest(http.MethodPatch, "/api/venues/{venueId}/table-sessions/{sessionId}", staffOnly(ts.Update))
	rt.Nest(http.MethodPost, "/api/venues/{venueId}/table-sessions/{sessionId}/close", staffOnly(ts.Close))
	rt.Nest(http.MethodPost, "/api/venues/{venueId}/table-sessions/{sessionId}/cancel", staffOnly(ts.Cancel))
	rt.Nest(http.MethodPost, "/api/venues/{venueId}/tables/{tableId}/sessions", staffOnly(ts.Open))
	rt.Nest(http.MethodGet, "/api/venues/{venueId}/tables/{tableId}/active-session", staffOnly(ts.ActiveForTable))

	// Canonical orders (Phase D3): new Servvia-native API
	// (contracts/openapi/servvia-orders.yaml). The same staff-only chain as
	// table sessions; kitchen is not an ordering role.
	od := d.Orders
	rt.Nest(http.MethodPost, "/api/venues/{venueId}/orders", staffOnly(od.Create))
	rt.Nest(http.MethodGet, "/api/venues/{venueId}/orders/{orderId}", staffOnly(od.Get))
	rt.Nest(http.MethodPost, "/api/venues/{venueId}/orders/{orderId}/rounds", staffOnly(od.SubmitRound))

	// Kitchen tickets (Phase D4): new Servvia-native API
	// (contracts/openapi/kitchen-tickets.yaml). A KDS device or staff with a
	// kitchen or floor role; never an unelevated customer tablet.
	kitchenCallers := func(h http.HandlerFunc) http.Handler {
		return httpx.Chain(h,
			identity.Authenticate(d.Verifier),
			identity.RequireStaffOrKDS,
			identity.RequireRoles(kitchenapi.Roles...),
			identity.RequireActiveTabletDevice(d.TabletDevices, d.Logger),
		)
	}
	kt := d.Kitchen
	rt.Nest(http.MethodGet, "/api/venues/{venueId}/kitchen-tickets", kitchenCallers(kt.List))
	rt.Nest(http.MethodGet, "/api/venues/{venueId}/kitchen-tickets/{ticketId}", kitchenCallers(kt.Get))
	rt.Nest(http.MethodPost, "/api/venues/{venueId}/kitchen-tickets/{ticketId}/transitions", kitchenCallers(kt.Transition))

	// Checks (Phase D5): new Servvia-native API (contracts/openapi/checks.yaml).
	// Financial operations: staff only, with the repository's financial
	// roles; voiding needs admin or manager. Never a KDS or kitchen identity.
	financial := func(h http.HandlerFunc, roles []string) http.Handler {
		return httpx.Chain(h,
			identity.Authenticate(d.Verifier),
			identity.RequireStaff,
			identity.RequireRoles(roles...),
			identity.RequireActiveTabletDevice(d.TabletDevices, d.Logger),
		)
	}
	ck := d.Checks
	rt.Nest(http.MethodPost, "/api/venues/{venueId}/checks", financial(ck.Create, checksapi.Roles))
	rt.Nest(http.MethodGet, "/api/venues/{venueId}/checks", financial(ck.List, checksapi.Roles))
	rt.Nest(http.MethodGet, "/api/venues/{venueId}/checks/{checkId}", financial(ck.Get, checksapi.Roles))
	rt.Nest(http.MethodPost, "/api/venues/{venueId}/checks/{checkId}/void", financial(ck.Void, checksapi.VoidRoles))

	// Payments and settlement (Phase D6): new Servvia-native API
	// (contracts/openapi/payments.yaml). Staff initiate and read with the
	// check roles; no staff route can report a result.
	pm := d.Payments
	rt.Nest(http.MethodPost, "/api/venues/{venueId}/checks/{checkId}/payments", financial(pm.Initiate, paymentsapi.Roles))
	rt.Nest(http.MethodGet, "/api/venues/{venueId}/checks/{checkId}/payments", financial(pm.Summary, paymentsapi.Roles))
	rt.Nest(http.MethodGet, "/api/venues/{venueId}/payments/{paymentId}", financial(pm.Get, paymentsapi.Roles))
	// Shifts and cash accountability (Phase D7): new Servvia-native API
	// (contracts/openapi/shifts.yaml). Financial roles; a staff member opens
	// their own shift, and reads or closes their own unless they supervise.
	sh := d.Shifts
	rt.Nest(http.MethodPost, "/api/venues/{venueId}/shifts", financial(sh.Open, shiftsapi.Roles))
	rt.Nest(http.MethodGet, "/api/venues/{venueId}/shifts", financial(sh.List, shiftsapi.Roles))
	rt.Nest(http.MethodGet, "/api/venues/{venueId}/shifts/{shiftId}", financial(sh.Get, shiftsapi.Roles))
	rt.Nest(http.MethodPost, "/api/venues/{venueId}/shifts/{shiftId}/close", financial(sh.Close, shiftsapi.Roles))

	// The payment adapter's result route: only an active payment_adapter
	// device registered at the path's venue; never a staff token, never
	// another kind of device.
	rt.Nest(http.MethodPost, "/api/internal/payment-adapter/venues/{venueId}/payments/{paymentId}/result",
		httpx.Chain(http.HandlerFunc(pm.Result), devicesapi.Authenticate(d.DeviceAuth, devices.KindPaymentAdapter, d.Logger)))

	// Refunds and reversals (Phase D9): new Servvia-native API
	// (contracts/openapi/refunds.yaml). Staff with a refund role request and
	// read; only the venue's payment_adapter device reports a card refund's
	// result or a provider reversal.
	rf := d.Refunds
	adapterOnly := func(h http.HandlerFunc) http.Handler {
		return httpx.Chain(h, devicesapi.Authenticate(d.DeviceAuth, devices.KindPaymentAdapter, d.Logger))
	}
	rt.Nest(http.MethodPost, "/api/venues/{venueId}/payments/{paymentId}/refunds", financial(rf.Request, refundsapi.Roles))
	rt.Nest(http.MethodGet, "/api/venues/{venueId}/payments/{paymentId}/refunds", financial(rf.ListForPayment, refundsapi.Roles))
	rt.Nest(http.MethodGet, "/api/venues/{venueId}/refunds/{refundId}", financial(rf.Get, refundsapi.Roles))
	rt.Nest(http.MethodPost, "/api/internal/payment-adapter/venues/{venueId}/refunds/{refundId}/result", adapterOnly(rf.Result))
	rt.Nest(http.MethodPost, "/api/internal/payment-adapter/venues/{venueId}/payments/{paymentId}/reversals", adapterOnly(rf.Reverse))

	// Devices and terminals (Phase D8): new Servvia-native API
	// (contracts/openapi/devices.yaml). Issuing and revoking credentials, and
	// changing terminals, is for owners, admins and managers from a staff
	// login session (no tablet, even elevated); a cashier may read terminals.
	admin := func(h http.HandlerFunc) http.Handler {
		return httpx.Chain(h,
			identity.Authenticate(d.Verifier),
			identity.RequireStaffSession,
			identity.RequireRoles(devicesapi.AdminRoles...),
		)
	}
	dv := d.Devices
	rt.Nest(http.MethodPost, "/api/venues/{venueId}/devices", admin(dv.Enroll))
	rt.Nest(http.MethodGet, "/api/venues/{venueId}/devices", admin(dv.ListDevices))
	rt.Nest(http.MethodGet, "/api/venues/{venueId}/devices/{deviceId}", admin(dv.GetDevice))
	rt.Nest(http.MethodPost, "/api/venues/{venueId}/devices/{deviceId}/rotate-credential", admin(dv.Rotate))
	rt.Nest(http.MethodPost, "/api/venues/{venueId}/devices/{deviceId}/revoke", admin(dv.Revoke))
	rt.Nest(http.MethodPost, "/api/venues/{venueId}/terminals", admin(dv.CreateTerminal))
	rt.Nest(http.MethodGet, "/api/venues/{venueId}/terminals", financial(dv.ListTerminals, devicesapi.TerminalReadRoles))
	rt.Nest(http.MethodGet, "/api/venues/{venueId}/terminals/{terminalId}", financial(dv.GetTerminal, devicesapi.TerminalReadRoles))
	rt.Nest(http.MethodPost, "/api/venues/{venueId}/terminals/{terminalId}/disable", admin(dv.DisableTerminal))
	rt.Nest(http.MethodPost, "/api/venues/{venueId}/terminals/{terminalId}/bind-device", admin(dv.BindDevice))
	rt.Nest(http.MethodPost, "/api/venues/{venueId}/terminals/{terminalId}/unbind-device", admin(dv.UnbindDevice))

	// Promotions (Phase D11): new Servvia-native API
	// (contracts/openapi/promotions.yaml). Configuration is for owners,
	// admins and managers from a staff login session; a cashier may read a
	// venue's promotions to choose one. Never a KDS, device or customer
	// tablet. Applying one is part of placing an order or round.
	promotionAdmin := func(h http.HandlerFunc) http.Handler {
		return httpx.Chain(h,
			identity.Authenticate(d.Verifier),
			identity.RequireStaffSession,
			identity.RequireRoles(promotionsapi.AdminRoles...),
		)
	}
	pr := d.Promotions
	rt.Nest(http.MethodPost, "/api/venues/{venueId}/promotions", promotionAdmin(pr.Create))
	rt.Nest(http.MethodGet, "/api/venues/{venueId}/promotions", financial(pr.List, promotionsapi.ReadRoles))
	rt.Nest(http.MethodGet, "/api/venues/{venueId}/promotions/{promotionId}", financial(pr.Get, promotionsapi.ReadRoles))
	rt.Nest(http.MethodPatch, "/api/venues/{venueId}/promotions/{promotionId}", promotionAdmin(pr.Update))
	rt.Nest(http.MethodPost, "/api/venues/{venueId}/promotions/{promotionId}/activate", promotionAdmin(pr.Activate))
	rt.Nest(http.MethodPost, "/api/venues/{venueId}/promotions/{promotionId}/deactivate", promotionAdmin(pr.Deactivate))

	return httpx.Chain(rt, httpx.RequestIDs, httpx.AccessLog(d.Logger), httpx.CORS, httpx.ETag)
}
