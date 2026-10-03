package integration

// Devices and terminals (Phase D8) against real PostgreSQL: enrollment and
// credential storage, rotation and revocation, isolation, idempotency and
// concurrency, terminals and their bindings, shifts at terminals, the
// database invariants of migration 20261005000000_devices_terminals, and the
// payment adapter's result route authenticated by device.

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"

	"servvia/services/core-platform/internal/devices"
	"servvia/services/core-platform/internal/devices/devicesapi"
	"servvia/services/core-platform/internal/health"
	"servvia/services/core-platform/internal/identity"
	"servvia/services/core-platform/internal/menu"
	"servvia/services/core-platform/internal/payments"
	"servvia/services/core-platform/internal/payments/paymentsapi"
	"servvia/services/core-platform/internal/platform/postgres"
	"servvia/services/core-platform/internal/ratelimit"
	"servvia/services/core-platform/internal/server"
	"servvia/services/core-platform/internal/shifts"
	"servvia/services/core-platform/internal/venues"
	"servvia/services/core-platform/tests/testsupport"
)

func (h shiftsHarness) devScope(venue string) devices.Scope {
	return devices.Scope{OrganizationID: h.f.Org, VenueID: venue}
}

func (h shiftsHarness) manager() devices.Actor {
	return devices.Actor{StaffID: h.f.Owner, Email: "owner@example.test", Role: "owner"}
}

func (h shiftsHarness) change(id string, version int) devices.Change {
	return devices.Change{Scope: h.devScope(h.f.Venue), ID: id, ExpectedVersion: version, Actor: h.manager()}
}

func (h shiftsHarness) terminal(t *testing.T, code string, deviceID *string) devices.Terminal {
	t.Helper()
	term, created, err := h.devices.CreateTerminal(context.Background(), devices.NewTerminal{Scope: h.devScope(h.f.Venue),
		Name: "Terminal " + code, Code: code, DeviceID: deviceID, RequestKey: key(), Actor: h.manager()})
	if err != nil || !created {
		t.Fatalf("terminal %s: %v", code, err)
	}
	return term
}

// 1-3, 9, 10, 25, 26: one device, a verifier only, idempotent enrollment,
// audited without the secret.
func TestDeviceEnrollmentAndCredential(t *testing.T) {
	h := shiftsSetup(t)
	ctx := context.Background()
	k := key()
	enroll := func() (devices.Device, string, bool, error) {
		return h.devices.Enroll(ctx, h.devScope(h.f.Venue), h.manager(), devices.KindPaymentAdapter, "Counter terminal adapter", k)
	}
	// 24 identical enrollments at once, with inserts held so every one has
	// looked up its key before any can insert: one device, one credential
	// shown. Only the (venueId, enrollRequestKey) index can decide this.
	ids, creds, created, errs := make([]string, 24), make([]string, 24), make([]bool, 24), make([]error, 24)
	h.whileTableLocked(t, "Device", func() {
		race(24, func(i int) {
			var d devices.Device
			d, creds[i], created[i], errs[i] = enroll()
			ids[i] = d.ID
		})
	})
	var credential string
	shown := 0
	for i := range ids {
		if errs[i] != nil || ids[i] != ids[0] {
			t.Fatalf("caller %d: %v", i, errs[i])
		}
		if created[i] {
			shown++
			credential = creds[i]
		} else if creds[i] != "" {
			t.Errorf("a replay showed the credential")
		}
	}
	if shown != 1 || h.count(t, `SELECT count(*) FROM "Device" WHERE "venueId" = $1`, h.f.Venue) != 1 {
		t.Fatalf("%d enrollments showed a credential", shown)
	}
	id, secret, ok := devices.ParseCredential(credential)
	if !ok || id != ids[0] {
		t.Fatalf("credential %q", credential)
	}
	// Stored: sha256(secret) only; the plaintext is nowhere in the database
	// row or the audit log.
	var stored string
	if err := h.writer.QueryRow(ctx, `SELECT "credentialHash" FROM "Device" WHERE id = $1`, id).Scan(&stored); err != nil {
		t.Fatal(err)
	}
	if stored != devices.Verifier(secret) || strings.Contains(stored, secret) {
		t.Error("the stored verifier is not sha256 of the secret")
	}
	if n := h.count(t, `SELECT count(*) FROM "Device" d WHERE d.id = $1 AND row_to_json(d)::text LIKE '%' || $2 || '%'`, id, secret); n != 0 {
		t.Error("the secret is stored")
	}
	if n := h.count(t, `SELECT count(*) FROM "AuditLog" WHERE "resourceId" = $1 AND action = 'DEVICE_ENROLLED' AND resource = 'device'`, id); n != 1 {
		t.Errorf("enrollment audit: %d", n)
	}
	if n := h.count(t, `SELECT count(*) FROM "AuditLog" WHERE "organizationId" = $1 AND (coalesce(after::text, '') || coalesce(before::text, '')) LIKE ANY ($2)`,
		h.f.Org, []string{"%" + secret + "%", "%" + stored + "%"}); n != 0 {
		t.Error("a secret or verifier is in the audit log")
	}
	// It authenticates as itself.
	if c, err := h.devices.Authenticate(ctx, credential, devices.KindPaymentAdapter, h.f.Venue); err != nil || c.DeviceID != id {
		t.Errorf("authenticate: %v", err)
	}
	// The same key for another request conflicts.
	var conflict *devices.IdempotencyConflictError
	if _, _, _, err := h.devices.Enroll(ctx, h.devScope(h.f.Venue), h.manager(), devices.KindKDS, "Counter terminal adapter", k); !errors.As(err, &conflict) || conflict.ID != id {
		t.Errorf("key reuse: %v", err)
	}
}

// 4, 5 and the security matrix: rotation invalidates the old credential,
// revocation every credential, at once.
func TestDeviceRotationAndRevocation(t *testing.T) {
	h := shiftsSetup(t)
	ctx := context.Background()
	id, old := h.enrollDevice(t, devices.KindPaymentAdapter, h.f.Venue)
	auth := func(c string) error {
		_, err := h.devices.Authenticate(ctx, c, devices.KindPaymentAdapter, h.f.Venue)
		return err
	}
	var conflict *devices.VersionConflictError
	if _, _, err := h.devices.Rotate(ctx, h.change(id, 5)); !errors.As(err, &conflict) {
		t.Errorf("stale rotation: %v", err)
	}
	d, fresh, err := h.devices.Rotate(ctx, h.change(id, 1))
	if err != nil || d.Version != 2 || d.CredentialRotatedAt == nil || fresh == old {
		t.Fatalf("rotate: %+v %v", d, err)
	}
	if !errors.Is(auth(old), devices.ErrUnauthenticated) || auth(fresh) != nil {
		t.Error("rotation must retire the old credential and enable the new one")
	}
	if n := h.count(t, `SELECT count(*) FROM "AuditLog" WHERE "resourceId" = $1 AND action = 'DEVICE_CREDENTIAL_ROTATED'`, id); n != 1 {
		t.Errorf("rotation audit: %d", n)
	}
	d, changed, err := h.devices.Revoke(ctx, h.change(id, 2))
	if err != nil || !changed || d.Status != devices.StatusRevoked || d.RevokedAt == nil || *d.RevokedByStaffID != h.f.Owner {
		t.Fatalf("revoke: %+v %v", d, err)
	}
	if !errors.Is(auth(fresh), devices.ErrUnauthenticated) {
		t.Error("a revoked device authenticates")
	}
	if _, changed, err := h.devices.Revoke(ctx, h.change(id, 2)); changed || err != nil {
		t.Errorf("repeated revoke: %v %v", changed, err)
	}
	var notActive *devices.NotActiveError
	if _, _, err := h.devices.Rotate(ctx, h.change(id, 3)); !errors.As(err, &notActive) {
		t.Errorf("rotating a revoked device: %v", err)
	}
	if n := h.count(t, `SELECT count(*) FROM "AuditLog" WHERE "resourceId" = $1 AND action = 'DEVICE_REVOKED'`, id); n != 1 {
		t.Errorf("revocation audit: %d", n)
	}
}

// 7, 8: a device belongs to one venue.
func TestDeviceIsolation(t *testing.T) {
	h := shiftsSetup(t)
	ctx := context.Background()
	id, credential := h.enrollDevice(t, devices.KindPaymentAdapter, h.f.Venue)
	if _, err := h.devices.Authenticate(ctx, credential, devices.KindPaymentAdapter, h.f.TaxlessVenue); !errors.Is(err, devices.ErrWrongVenue) {
		t.Errorf("another venue: %v", err)
	}
	if _, err := h.devices.Authenticate(ctx, credential, devices.KindKDS, h.f.Venue); !errors.Is(err, devices.ErrWrongKind) {
		t.Errorf("another kind: %v", err)
	}
	if _, err := h.devices.GetDevice(ctx, h.devScope(h.f.TaxlessVenue), id); !errors.Is(err, devices.ErrDeviceNotFound) {
		t.Errorf("read from another venue: %v", err)
	}
	other := h.change(id, 1)
	other.Scope.VenueID = h.f.TaxlessVenue
	if _, _, err := h.devices.Revoke(ctx, other); !errors.Is(err, devices.ErrDeviceNotFound) {
		t.Errorf("revoke from another venue: %v", err)
	}
	if list, _ := h.devices.ListDevices(ctx, h.devScope(h.f.TaxlessVenue), devices.DeviceFilter{}); len(list) != 0 {
		t.Error("another venue lists the device")
	}
}

// 11-14: many terminals, codes unique per venue under a race, and bindings
// the database enforces.
func TestTerminalsAndBindings(t *testing.T) {
	h := shiftsSetup(t)
	ctx := context.Background()
	pos, _ := h.enrollDevice(t, devices.KindPOSTerminal, h.f.Venue)
	front := h.terminal(t, "FRONT-1", &pos)
	bar := h.terminal(t, "BAR", nil)
	if front.DeviceID == nil || *front.DeviceID != pos || bar.DeviceID != nil {
		t.Fatalf("terminals %+v %+v", front, bar)
	}
	if list, err := h.devices.ListTerminals(ctx, h.devScope(h.f.Venue), devices.TerminalFilter{}); err != nil || len(list) != 2 || list[0].Code != "BAR" {
		t.Errorf("list: %+v %v", list, err)
	}
	if d, _ := h.devices.GetDevice(ctx, h.devScope(h.f.Venue), pos); d.TerminalID == nil || *d.TerminalID != front.ID {
		t.Error("the device does not report its terminal")
	}
	// The same code at another venue is fine.
	if _, _, err := h.devices.CreateTerminal(ctx, devices.NewTerminal{Scope: h.devScope(h.f.TaxlessVenue), Name: "Bar", Code: "BAR",
		RequestKey: key(), Actor: h.manager()}); err != nil {
		t.Errorf("same code at another venue: %v", err)
	}
	// 16 creates of one code at once, each with its own key, inserts held:
	// one wins, the rest see the code taken.
	errs := make([]error, 16)
	h.whileTableLocked(t, "Terminal", func() {
		race(16, func(i int) {
			_, _, errs[i] = h.devices.CreateTerminal(ctx, devices.NewTerminal{Scope: h.devScope(h.f.Venue), Name: "Patio",
				Code: "PATIO", RequestKey: key(), Actor: h.manager()})
		})
	})
	won := 0
	for i, err := range errs {
		var taken *devices.CodeTakenError
		switch {
		case err == nil:
			won++
		case !errors.As(err, &taken):
			t.Fatalf("create %d: %v", i, err)
		}
	}
	if won != 1 {
		t.Errorf("%d terminals got code PATIO", won)
	}

	kds, _ := h.enrollDevice(t, devices.KindKDS, h.f.Venue)
	otherVenuePOS, _ := h.enrollDevice(t, devices.KindPOSTerminal, h.f.TaxlessVenue)
	revokedPOS, _ := h.enrollDevice(t, devices.KindPOSTerminal, h.f.Venue)
	if _, _, err := h.devices.Revoke(ctx, h.change(revokedPOS, 1)); err != nil {
		t.Fatal(err)
	}
	for name, dev := range map[string]string{"KDS": kds, "another venue's POS": otherVenuePOS, "revoked POS": revokedPOS, "unknown": testsupport.UUID()} {
		if _, err := h.devices.BindDevice(ctx, h.change(bar.ID, 1), &dev); !errors.Is(err, devices.ErrDeviceNotBindable) {
			t.Errorf("bind %s: %v", name, err)
		}
	}
	var bound *devices.DeviceBoundError
	if _, err := h.devices.BindDevice(ctx, h.change(bar.ID, 1), &pos); !errors.As(err, &bound) {
		t.Errorf("one device on two terminals: %v", err)
	}
	// Unbind from FRONT-1, bind to BAR.
	if _, err := h.devices.BindDevice(ctx, h.change(front.ID, 1), nil); err != nil {
		t.Fatal(err)
	}
	if b, err := h.devices.BindDevice(ctx, h.change(bar.ID, 1), &pos); err != nil || *b.DeviceID != pos || b.Version != 2 {
		t.Errorf("rebind: %+v %v", b, err)
	}
	if n := h.count(t, `SELECT count(*) FROM "AuditLog" WHERE action IN ('TERMINAL_CREATED', 'TERMINAL_DEVICE_BOUND', 'TERMINAL_DEVICE_UNBOUND')
		AND "resourceId" = ANY($1)`, []string{front.ID, bar.ID}); n != 4 {
		t.Errorf("terminal audits: %d", n)
	}

	// The database refuses what the service would: a KDS through the
	// composite key, a device id without its kind, a non-POS kind.
	insert := func(deviceID, kind any) error {
		_, err := h.writer.Exec(ctx, `INSERT INTO "Terminal" (id, "venueId", name, code, "deviceId", "deviceKind", "createRequestKey", "updatedAt")
			VALUES ($1, $2, 'X', $3, $4, $5::"DeviceKind", $6, now())`, testsupport.UUID(), h.f.Venue,
			"DB-"+strings.ToUpper(testsupport.UUID()[:8]), deviceID, kind, key())
		return err
	}
	for _, x := range []struct {
		name, code, constraint string
		err                    error
	}{
		{"a KDS claimed as POS", "23503", "Terminal_deviceId_deviceKind_venueId_fkey", insert(kds, "pos_terminal")},
		{"another venue's POS", "23503", "Terminal_deviceId_deviceKind_venueId_fkey", insert(otherVenuePOS, "pos_terminal")},
		{"a device without its kind", "23514", "Terminal_device_is_pos", insert(kds, nil)},
		{"a non-POS kind", "23514", "Terminal_device_is_pos", insert(kds, "kds")},
		{"one device on two terminals", "23505", "Terminal_deviceId_key", insert(pos, "pos_terminal")},
	} {
		if code, constraint := pgCode(x.err); code != x.code || constraint != x.constraint {
			t.Errorf("%s: %s %s (%v)", x.name, code, constraint, x.err)
		}
	}
	_, badHash := h.writer.Exec(ctx, `INSERT INTO "Device" (id, "venueId", kind, "displayName", "credentialHash", "enrollRequestKey",
		"createdByStaffId", "updatedAt") VALUES ($1, $2, 'kds', 'X', 'plaintext-secret', $3, $4, now())`, testsupport.UUID(), h.f.Venue, key(), h.f.Owner)
	if code, constraint := pgCode(badHash); code != "23514" || constraint != "Device_credential_hash_format" {
		t.Errorf("a non-verifier credential column: %s %s", code, constraint)
	}
}

// 15, 16: shifts at terminals; disabled terminals are refused for new shifts
// and kept by old ones.
func TestShiftsAtTerminals(t *testing.T) {
	h := shiftsSetup(t)
	ctx := context.Background()
	front := h.terminal(t, "FRONT-1", nil)
	s, _, err := h.shifts.Open(ctx, shifts.OpenCommand{Scope: h.shiftScope(), OpeningFloatCents: 1000, TerminalID: &front.ID,
		RequestKey: key(), Actor: h.cashierActor()})
	if err != nil || s.TerminalID == nil || *s.TerminalID != front.ID {
		t.Fatalf("open at terminal: %+v %v", s, err)
	}
	// Staff accountability is unchanged: the owner may open a shift at the
	// same terminal (no one-open-shift-per-terminal rule).
	ownerShift, _, err := h.shifts.Open(ctx, shifts.OpenCommand{Scope: h.shiftScope(), TerminalID: &front.ID, RequestKey: key(),
		Actor: shifts.Actor{StaffID: h.f.Owner, Role: "owner"}})
	if err != nil {
		t.Errorf("a second staff member at the terminal: %v", err)
	}
	if _, _, err := h.devices.DisableTerminal(ctx, h.change(front.ID, 1)); err != nil {
		t.Fatal(err)
	}
	if _, _, err := h.closeShift(s, 1000); err != nil {
		t.Fatal(err)
	}
	if _, _, err := h.shifts.Open(ctx, shifts.OpenCommand{Scope: h.shiftScope(), TerminalID: &front.ID, RequestKey: key(),
		Actor: h.cashierActor()}); !errors.Is(err, shifts.ErrTerminalDisabled) {
		t.Errorf("a disabled terminal: %v", err)
	}
	unknown := testsupport.UUID()
	if _, _, err := h.shifts.Open(ctx, shifts.OpenCommand{Scope: h.shiftScope(), TerminalID: &unknown, RequestKey: key(),
		Actor: h.cashierActor()}); !errors.Is(err, shifts.ErrTerminalNotFound) {
		t.Errorf("an unknown terminal: %v", err)
	}
	// History keeps its terminal; a shift without one still opens.
	if got := h.shift(t, ownerShift.ID); got.TerminalID == nil || *got.TerminalID != front.ID {
		t.Error("disabling rewrote a shift's terminal")
	}
	if plain, _, err := h.shifts.Open(ctx, shifts.OpenCommand{Scope: h.shiftScope(), RequestKey: key(), Actor: h.cashierActor()}); err != nil || plain.TerminalID != nil {
		t.Errorf("a shift without a terminal: %v", err)
	}
	if n := h.count(t, `SELECT count(*) FROM "AuditLog" WHERE "resourceId" = $1 AND action = 'TERMINAL_DISABLED'`, front.ID); n != 1 {
		t.Errorf("disable audit: %d", n)
	}
	// Another venue's terminal cannot be named, by the service or the
	// database (composite foreign key).
	elsewhere, _, err := h.devices.CreateTerminal(ctx, devices.NewTerminal{Scope: h.devScope(h.f.TaxlessVenue), Name: "Else", Code: "ELSE",
		RequestKey: key(), Actor: h.manager()})
	if err != nil {
		t.Fatal(err)
	}
	_, crossVenue := h.writer.Exec(ctx, `UPDATE "Shift" SET "terminalId" = $2 WHERE id = $1`, ownerShift.ID, elsewhere.ID)
	if code, constraint := pgCode(crossVenue); code != "23503" || constraint != "Shift_terminalId_venueId_fkey" {
		t.Errorf("a terminal of another venue: %s %s", code, constraint)
	}
}

// 17-24: the payment adapter's result route authenticates devices, and only
// this venue's live payment adapter.
func TestPaymentAdapterDeviceRoute(t *testing.T) {
	h := shiftsSetup(t)
	ctx := context.Background()
	pool, err := postgres.NewPool(ctx, postgres.Options{URL: testsupport.DisposableDatabaseURL(t), MaxConns: 8})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	const secret = "integration-secret-0123456789abcdef"
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	venueStore := venues.NewPostgresStore(pool)
	routes := server.Routes(server.Deps{
		Logger: logger, Health: health.New(pool, time.Second),
		Menu:     menu.NewHandler(menu.NewPostgresStore(pool), logger),
		Venues:   venues.NewHandler(venueStore, logger),
		Payments: paymentsapi.NewHandler(h.payments, venueStore, logger),
		Devices:  devicesapi.NewHandler(h.devices, venueStore, logger),
		Verifier: identity.NewVerifier(secret), TabletDevices: identity.NewPostgresTabletDevices(pool), VenueGrants: identity.NewPostgresVenueGrants(pool),
		RateLimiter: ratelimit.New(admitAll{}, 0, logger), DeviceAuth: h.devices,
	})
	owner, _ := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{"sub": h.f.Owner, "email": "o@example.test", "role": "owner",
		"organizationId": h.f.Org, "exp": time.Now().Add(time.Minute).Unix()}).SignedString([]byte(secret))
	call := func(tok, path string, body any) (int, []byte) {
		raw, _ := json.Marshal(body)
		req := httptest.NewRequest("POST", path, strings.NewReader(string(raw)))
		req.Header.Set("Authorization", "Bearer "+tok)
		rec := httptest.NewRecorder()
		routes.ServeHTTP(rec, req)
		return rec.Code, rec.Body.Bytes()
	}
	c, _ := h.billedCheck(t, h.f.TableA)
	p := h.pay(t, c.ID, c.TotalCents)
	result := func(venue string) string {
		return "/api/internal/payment-adapter/venues/" + venue + "/payments/" + p.ID + "/result"
	}
	adapterA, credA := h.enrollDevice(t, devices.KindPaymentAdapter, h.f.Venue)
	_, credB := h.enrollDevice(t, devices.KindPaymentAdapter, h.f.TaxlessVenue)
	_, kds := h.enrollDevice(t, devices.KindKDS, h.f.Venue)
	_, posDevice := h.enrollDevice(t, devices.KindPOSTerminal, h.f.Venue)
	_, tablet := h.enrollDevice(t, devices.KindOrderTablet, h.f.Venue)
	revokedID, revoked := h.enrollDevice(t, devices.KindPaymentAdapter, h.f.Venue)
	if _, _, err := h.devices.Revoke(ctx, h.change(revokedID, 1)); err != nil {
		t.Fatal(err)
	}
	rotatedID, rotatedOld := h.enrollDevice(t, devices.KindPaymentAdapter, h.f.Venue)
	if _, _, err := h.devices.Rotate(ctx, h.change(rotatedID, 1)); err != nil {
		t.Fatal(err)
	}
	for name, x := range map[string]struct {
		token, venue string
		status       int
	}{
		"staff JWT (owner)":                    {owner, h.f.Venue, 401},
		"revoked adapter":                      {revoked, h.f.Venue, 401},
		"adapter's credential before rotation": {rotatedOld, h.f.Venue, 401},
		"malformed credential":                 {"sdv1.x", h.f.Venue, 401},
		"KDS device":                           {kds, h.f.Venue, 403},
		"POS device":                           {posDevice, h.f.Venue, 403},
		"Order Tablet device":                  {tablet, h.f.Venue, 403},
		"venue A's adapter at venue B":         {credA, h.f.TaxlessVenue, 403},
		"venue B's adapter on its own path":    {credB, h.f.TaxlessVenue, 404}, // the payment is not venue B's
		"venue B's adapter at venue A":         {credB, h.f.Venue, 403},
	} {
		if status, body := call(x.token, result(x.venue), map[string]any{"outcome": "succeeded"}); status != x.status {
			t.Errorf("%s: %d %s", name, status, body)
		}
	}
	if got, _ := h.payments.Get(ctx, h.payScope(), p.ID); got.Status != payments.StatusPending {
		t.Fatalf("a refused caller changed the payment: %s", got.Status)
	}
	// Venue A's adapter reports; the check settles, attributed to the device.
	if status, body := call(credA, result(h.f.Venue), map[string]any{"outcome": "succeeded", "reference": "term-1"}); status != 200 {
		t.Fatalf("adapter A: %d %s", status, body)
	}
	sum, _ := h.summary(t, c.ID)
	if sum.CheckStatus != "settled" || sum.Settlement.ActorID != adapterA || sum.Settlement.ActorKind != payments.AdapterKind {
		t.Errorf("settlement %+v", sum.Settlement)
	}
	got, _ := h.payments.Get(ctx, h.payScope(), p.ID)
	if last := got.Transitions[len(got.Transitions)-1]; last.ActorID != adapterA {
		t.Errorf("result attributed to %s", last.ActorID)
	}
	// A device credential is not a staff credential.
	if status, _ := call(credA, "/api/venues/"+h.f.Venue+"/checks/"+c.ID+"/payments",
		map[string]any{"amountCents": 1, "currency": "NZD", "tenderType": "card", "idempotencyKey": key()}); status != 401 {
		t.Errorf("adapter on a staff route: %d", status)
	}
	if status, _ := call(credA, "/api/venues/"+h.f.Venue+"/devices", map[string]any{"kind": "kds", "displayName": "X", "idempotencyKey": key()}); status != 401 {
		t.Errorf("adapter enrolls a device: %d", status)
	}
	// Enrollment over HTTP: the credential appears once; reads never show it.
	status, body := call(owner, "/api/venues/"+h.f.Venue+"/devices", map[string]any{"kind": "kds", "displayName": "Pass", "idempotencyKey": key()})
	var enrolled struct {
		Device     map[string]any `json:"device"`
		Credential string         `json:"credential"`
	}
	if err := json.Unmarshal(body, &enrolled); status != 201 || err != nil || enrolled.Credential == "" {
		t.Fatalf("enroll: %d %s", status, body)
	}
	testsupport.Validate(t, testsupport.Schema(t, "openapi/devices.yaml", "/components/schemas/DeviceWithCredential"), body)
	_, kdsSecret, _ := devices.ParseCredential(enrolled.Credential)
	for _, path := range []string{"/devices", "/devices/" + enrolled.Device["id"].(string)} {
		req := httptest.NewRequest("GET", "/api/venues/"+h.f.Venue+path, nil)
		req.Header.Set("Authorization", "Bearer "+owner)
		rec := httptest.NewRecorder()
		routes.ServeHTTP(rec, req)
		if rec.Code != 200 || strings.Contains(rec.Body.String(), kdsSecret) || strings.Contains(rec.Body.String(), "credential\"") &&
			!strings.Contains(rec.Body.String(), "credentialRotatedAt") {
			t.Errorf("GET %s exposes a credential: %d %s", path, rec.Code, rec.Body.String())
		}
	}
	// No hardware, no legacy state.
	if n := h.count(t, `SELECT count(*) FROM "ConnectorCommand" WHERE "venueId" = $1`, h.f.Venue); n != 0 {
		t.Errorf("connector commands: %d", n)
	}
	if n := h.count(t, `SELECT count(*) FROM "PrinterJob" WHERE "venueId" = $1`, h.f.Venue); n != 0 {
		t.Errorf("printer jobs: %d", n)
	}
	if n := h.count(t, `SELECT count(*) FROM "TabletDevice" WHERE "venueId" = $1`, h.f.Venue); n != 0 {
		t.Errorf("legacy tablet devices: %d", n)
	}
}
