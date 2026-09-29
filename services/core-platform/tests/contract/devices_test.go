package contract

// Devices and terminals are new Servvia-native behaviour, tested against the
// written contract (contracts/openapi/devices.yaml). The registry here is in
// memory and holds real credentials (NewCredential); credential storage,
// uniqueness and concurrency are tested against PostgreSQL in
// tests/integration.

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"sync"
	"testing"
	"time"

	"servvia/services/core-platform/internal/devices"
	"servvia/services/core-platform/internal/devices/devicesapi"
	"servvia/services/core-platform/internal/health"
	"servvia/services/core-platform/internal/identity"
	"servvia/services/core-platform/internal/menu"
	"servvia/services/core-platform/internal/ratelimit"
	"servvia/services/core-platform/internal/server"
	"servvia/services/core-platform/internal/venues"
	"servvia/services/core-platform/tests/testsupport"
)

// memDevices is an in-memory device registry for the contract tests.
type memDevices struct {
	mu    sync.Mutex
	creds map[string]devices.Credential
	// Plaintext credentials of fixture devices.
	adapter, kds, revoked string
}

func (m *memDevices) add(kind devices.Kind, venue string, status devices.Status) string {
	id := testsupport.UUID()
	plaintext, verifier := devices.NewCredential(id)
	m.creds[id] = devices.Credential{DeviceID: id, VenueID: venue, Kind: kind, Status: status, Verifier: verifier}
	return plaintext
}

var contractDevices = func() *memDevices {
	m := &memDevices{creds: map[string]devices.Credential{}}
	m.adapter = m.add(devices.KindPaymentAdapter, venueID, devices.StatusActive)
	m.kds = m.add(devices.KindKDS, venueID, devices.StatusActive)
	m.revoked = m.add(devices.KindPaymentAdapter, venueID, devices.StatusRevoked)
	return m
}()

func (m *memDevices) service() *devices.Service { return devices.NewService(m, true, testsupport.UUID) }

func (m *memDevices) Credential(_ context.Context, id string) (devices.Credential, bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	c, ok := m.creds[id]
	return c, ok, nil
}
func (m *memDevices) FindDeviceByKey(context.Context, string, string) (devices.Device, bool, error) {
	return devices.Device{}, false, nil
}
func (m *memDevices) GetDevice(context.Context, string, string) (devices.Device, error) {
	return devices.Device{}, devices.ErrDeviceNotFound
}
func (m *memDevices) ListDevices(context.Context, string, devices.DeviceFilter) ([]devices.Device, error) {
	return nil, nil
}
func (m *memDevices) Enroll(_ context.Context, n devices.NewDevice) (devices.Device, error) {
	now := time.Now()
	return devices.Device{ID: n.ID, VenueID: n.Scope.VenueID, Kind: n.Kind, DisplayName: n.DisplayName, Status: devices.StatusActive,
		EnrollRequestKey: n.RequestKey, Version: 1, CreatedByStaffID: n.Actor.StaffID, CreatedAt: now, UpdatedAt: now}, nil
}
func (m *memDevices) Rotate(context.Context, devices.Change, string) (devices.Device, error) {
	return devices.Device{}, devices.ErrDeviceNotFound
}
func (m *memDevices) Revoke(context.Context, devices.Change) (devices.Device, bool, error) {
	return devices.Device{}, false, devices.ErrDeviceNotFound
}
func (m *memDevices) FindTerminalByKey(context.Context, string, string) (devices.Terminal, bool, error) {
	return devices.Terminal{}, false, nil
}
func (m *memDevices) GetTerminal(context.Context, string, string) (devices.Terminal, error) {
	return devices.Terminal{}, devices.ErrTerminalNotFound
}
func (m *memDevices) ListTerminals(context.Context, string, devices.TerminalFilter) ([]devices.Terminal, error) {
	return nil, nil
}
func (m *memDevices) CreateTerminal(context.Context, devices.NewTerminal) (devices.Terminal, error) {
	return devices.Terminal{}, &devices.CodeTakenError{Code: "X"}
}
func (m *memDevices) DisableTerminal(context.Context, devices.Change) (devices.Terminal, bool, error) {
	return devices.Terminal{}, false, devices.ErrTerminalNotFound
}
func (m *memDevices) BindDevice(context.Context, devices.Change, *string) (devices.Terminal, error) {
	return devices.Terminal{}, devices.ErrTerminalNotFound
}

func deviceRoutes() http.Handler {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	svc := contractDevices.service()
	return server.Routes(server.Deps{
		Logger: logger, Health: health.New(okPinger{}, time.Second),
		Menu:     menu.NewHandler(staticStore{}, logger),
		Venues:   venues.NewHandler(venueStore{}, logger),
		Devices:  devicesapi.NewHandler(svc, venueStore{}, logger),
		Verifier: identity.NewVerifier(secret), TabletDevices: activeDevices{},
		RateLimiter: ratelimit.New(admit, 0, logger), DeviceAuth: svc,
	})
}

func TestDeviceAdministrationAuthorization(t *testing.T) {
	h := deviceRoutes()
	claims := nestShapedClaims()
	nestErr := testsupport.Schema(t, "openapi/devices.yaml", "/components/schemas/NestError")
	enroll := base(venueID) + "/devices"
	enrollBody := func() map[string]any {
		return map[string]any{"kind": "payment_adapter", "displayName": "Adapter", "idempotencyKey": testsupport.UUID()}
	}
	terminals := base(venueID) + "/terminals"
	for name, c := range map[string]struct {
		token, method, path string
		body                any
		status              int
	}{
		"owner session enrolls":   {signed(t, claims["staff"]), "POST", enroll, enrollBody(), 201},
		"manager lists devices":   {staffWithRole(t, "manager"), "GET", enroll, nil, 200},
		"cashier reads terminals": {staffWithRole(t, "cashier"), "GET", terminals, nil, 200},
		// Issuing credentials: never a cashier, a tablet (even elevated), a
		// KDS, kitchen, or a device credential.
		"cashier enrolls":               {staffWithRole(t, "cashier"), "POST", enroll, enrollBody(), 403},
		"cashier lists devices":         {staffWithRole(t, "cashier"), "GET", enroll, nil, 403},
		"cashier creates a terminal":    {staffWithRole(t, "cashier"), "POST", terminals, map[string]any{"name": "Bar", "code": "BAR", "idempotencyKey": testsupport.UUID()}, 403},
		"tablet manager step-up":        {signed(t, claims["tablet_manager"]), "POST", enroll, enrollBody(), 403},
		"KDS JWT":                       {signed(t, claims["kds_device"]), "GET", enroll, nil, 403},
		"kitchen staff":                 {staffWithRole(t, "kitchen"), "GET", terminals, nil, 403},
		"device credential on admin":    {contractDevices.adapter, "GET", enroll, nil, 401},
		"device credential on terminal": {contractDevices.adapter, "GET", terminals, nil, 401},
		"staff, another org's venue":    {signed(t, claims["staff"]), "GET", base(otherVenue) + "/devices", nil, 404},
	} {
		res := do(t, h, c.method, c.path, c.token, c.body)
		if res.status != c.status {
			t.Errorf("%s: %d %s", name, res.status, res.body)
			continue
		}
		if c.status >= 400 {
			testsupport.Validate(t, nestErr, res.body)
		}
	}
}

func TestDeviceEnrollmentShowsCredentialOnce(t *testing.T) {
	h := deviceRoutes()
	owner := signed(t, nestShapedClaims()["staff"])
	res := do(t, h, "POST", base(venueID)+"/devices", owner, map[string]any{"kind": "kds", "displayName": "Pass KDS", "idempotencyKey": testsupport.UUID()})
	if res.status != 201 {
		t.Fatalf("enroll: %d %s", res.status, res.body)
	}
	testsupport.Validate(t, testsupport.Schema(t, "openapi/devices.yaml", "/components/schemas/DeviceWithCredential"), res.body)
	cred, _ := res.json["credential"].(string)
	device := res.json["device"].(map[string]any)
	if id, _, ok := devices.ParseCredential(cred); !ok || id != device["id"] {
		t.Errorf("credential %q does not name device %v", cred, device["id"])
	}
	for _, forbidden := range []string{"credentialHash", "secret", "verifier"} {
		if strings.Contains(string(res.body), forbidden) {
			t.Errorf("enrollment response mentions %s", forbidden)
		}
	}
}

func TestDeviceRequestValidation(t *testing.T) {
	h := deviceRoutes()
	owner := signed(t, nestShapedClaims()["staff"])
	for name, c := range map[string]struct {
		path string
		body map[string]any
		msg  string
	}{
		"kind":           {"/devices", map[string]any{"kind": "printer", "displayName": "P", "idempotencyKey": testsupport.UUID()}, "kind must be one of pos_terminal, order_tablet, kds, payment_adapter"},
		"empty name":     {"/devices", map[string]any{"kind": "kds", "displayName": " ", "idempotencyKey": testsupport.UUID()}, "displayName must be 1 to 80 characters, without leading or trailing spaces"},
		"short key":      {"/devices", map[string]any{"kind": "kds", "displayName": "K", "idempotencyKey": "short"}, "idempotencyKey must be a string of 16 to 255 characters"},
		"terminal code":  {"/terminals", map[string]any{"name": "Bar", "code": "bar 1", "idempotencyKey": testsupport.UUID()}, "code must be 1 to 20 characters of A-Z, 0-9 and -, not starting with -"},
		"rotate version": {"/devices/x/rotate-credential", map[string]any{}, "version must be a positive integer"},
		"bind device":    {"/terminals/x/bind-device", map[string]any{"version": 1}, "deviceId is required"},
	} {
		res := do(t, h, "POST", base(venueID)+c.path, owner, c.body)
		if res.status != 400 || res.json["message"] != c.msg {
			t.Errorf("%s: %d %s", name, res.status, res.body)
		}
	}
}
