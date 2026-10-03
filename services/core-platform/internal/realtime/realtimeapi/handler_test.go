package realtimeapi

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/golang-jwt/jwt/v5"

	"servvia/services/core-platform/internal/devices"
	"servvia/services/core-platform/internal/identity"
	"servvia/services/core-platform/internal/platform/httpx"
	"servvia/services/core-platform/internal/realtime"
	"servvia/services/core-platform/internal/venues"
)

// These tests pin the fail-closed credential rules of the realtime
// transport (PRD section 16, items 5 and 12):
//   - a revoked or unknown credential closes with 4401 UNAUTHENTICATED;
//   - a credential that cannot be verified (lookup failure) is refused at
//     admission and disconnected at re-check with 1011 INTERNAL, never
//     4401, so a transient server fault is not reported to clients as a
//     revoked credential (which would make tablets discard their enrolment).

const (
	testSecret = "realtime-test-secret-0123456789abcdef"
	testOrg    = "org-1"
	testVenue  = "venue-1"
	testDevice = "tablet-device-1"
)

var errLookup = errors.New("connection refused")

type fakeTablets struct {
	mu     sync.Mutex
	active bool
	err    error
	calls  int
}

func (f *fakeTablets) TabletDeviceActive(context.Context, string) (bool, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.calls++
	return f.active, f.err
}

func (f *fakeTablets) set(active bool, err error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.active, f.err = active, err
}

func (f *fakeTablets) callCount() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.calls
}

type fakeDevices struct {
	mu    sync.Mutex
	err   error
	calls int
}

func (f *fakeDevices) Authenticate(context.Context, string, devices.Kind, string) (devices.Credential, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.calls++
	return devices.Credential{}, f.err
}

func (f *fakeDevices) set(err error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.err = err
}

func (f *fakeDevices) callCount() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.calls
}

type fakeGrants struct {
	mu      sync.Mutex
	granted bool
	err     error
}

func (f *fakeGrants) VenueAccess(context.Context, string, string, string) (identity.VenueAccessDecision, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.granted {
		return identity.VenueAccessGranted, f.err
	}
	return identity.VenueAccessNotGranted, f.err
}

func (f *fakeGrants) set(granted bool, err error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.granted, f.err = granted, err
}

// fakeStaff is both staff stores: whether the staff member is active, and
// whether the login session was revoked.
type fakeStaff struct {
	mu      sync.Mutex
	active  bool
	revoked bool
	err     error
}

func (f *fakeStaff) StaffActive(context.Context, string) (bool, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.active, f.err
}

func (f *fakeStaff) SessionRevoked(context.Context, string) (bool, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.revoked, f.err
}

func (f *fakeStaff) set(active, revoked bool, err error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.active, f.revoked, f.err = active, revoked, err
}

type fakeVenues struct{}

func (fakeVenues) Venue(_ context.Context, id string) (venues.Venue, bool, error) {
	return venues.Venue{ID: id, OrganizationID: testOrg}, id == testVenue, nil
}

func (fakeVenues) VenueInOrganization(_ context.Context, id, org string) (venues.Venue, bool, error) {
	return venues.Venue{ID: id, OrganizationID: org}, id == testVenue && org == testOrg, nil
}

// syncBuffer is a goroutine-safe log sink.
type syncBuffer struct {
	mu  sync.Mutex
	buf bytes.Buffer
}

func (b *syncBuffer) Write(p []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buf.Write(p)
}

func (b *syncBuffer) String() string {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buf.String()
}

type harness struct {
	tablets *fakeTablets
	devices *fakeDevices
	grants  *fakeGrants
	staff   *fakeStaff
	logs    *syncBuffer
	wsURL   string
}

var testConfig = Config{AuthTimeout: 2 * time.Second, PingInterval: time.Minute, Revalidate: 40 * time.Millisecond,
	WriteTimeout: 2 * time.Second}

func newHarness(t *testing.T) *harness {
	t.Helper()
	h := &harness{tablets: &fakeTablets{active: true}, devices: &fakeDevices{}, grants: &fakeGrants{granted: true},
		staff: &fakeStaff{active: true}, logs: &syncBuffer{}}
	hub := realtime.NewHub(16)
	logger := slog.New(slog.NewJSONHandler(h.logs, nil))
	handler := NewHandler(hub, identity.NewVerifier(testSecret), h.tablets, h.devices, fakeVenues{}, h.grants,
		identity.StaffSessions{Staff: h.staff, Revocations: h.staff}, logger, testConfig)
	// The production chain for the realtime route (server.go): request IDs first.
	srv := httptest.NewServer(httpx.Chain(handler, httpx.RequestIDs))
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		handler.Drain(ctx)
		srv.Close()
	})
	h.wsURL = "ws" + strings.TrimPrefix(srv.URL, "http") + "/api/realtime"
	return h
}

func tabletStaffToken(t *testing.T) string {
	t.Helper()
	raw, err := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"sub": "staff-1", "role": "cashier", "organizationId": testOrg, "venueId": testVenue,
		"kind": string(identity.KindTabletStaff), "deviceId": testDevice, "exp": time.Now().Add(time.Hour).Unix(),
	}).SignedString([]byte(testSecret))
	if err != nil {
		t.Fatal(err)
	}
	return raw
}

// kdsCredential is a well-formed D8 device credential (sdv1.<id>.<43 chars>).
const kdsCredential = "sdv1.kds-device-1.abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ"

// result is how one connection ended, as the client observed it.
type result struct {
	subscribed bool
	codes      []string // error codes received before the close
	status     websocket.StatusCode
	closed     bool
}

// client reads in the background: coder/websocket closes a connection whose
// Read context expires, so "nothing arrives" must not be a timed Read.
type client struct {
	conn   *websocket.Conn
	mu     sync.Mutex
	res    result
	frames chan struct{}
	done   chan struct{}
}

func (h *harness) dial(t *testing.T, token string) *client {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	conn, _, err := websocket.Dial(ctx, h.wsURL, &websocket.DialOptions{HTTPHeader: http.Header{"Authorization": {"Bearer " + token}}})
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	t.Cleanup(func() { _ = conn.CloseNow() })
	if err := conn.Write(ctx, websocket.MessageText, []byte(`{"type":"subscribe","venueId":"`+testVenue+`"}`)); err != nil {
		t.Fatalf("subscribe: %v", err)
	}
	c := &client{conn: conn, frames: make(chan struct{}, 64), done: make(chan struct{})}
	go func() {
		defer close(c.done)
		for {
			_, raw, err := conn.Read(context.Background())
			if err != nil {
				c.mu.Lock()
				c.res.closed, c.res.status = true, websocket.CloseStatus(err)
				c.mu.Unlock()
				return
			}
			var msg struct{ Type, Code string }
			_ = json.Unmarshal(raw, &msg)
			c.mu.Lock()
			switch msg.Type {
			case "subscribed":
				c.res.subscribed = true
			case "error":
				c.res.codes = append(c.res.codes, msg.Code)
			}
			c.mu.Unlock()
			c.frames <- struct{}{}
		}
	}()
	return c
}

// waitClosed waits for the server to close the connection.
func (c *client) waitClosed(t *testing.T) result {
	t.Helper()
	select {
	case <-c.done:
	case <-time.After(5 * time.Second):
		t.Fatal("connection was not closed")
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.res
}

// waitSubscribed waits for the `subscribed` frame.
func (c *client) waitSubscribed(t *testing.T) {
	t.Helper()
	deadline := time.After(5 * time.Second)
	for {
		c.mu.Lock()
		ok, closed := c.res.subscribed, c.res.closed
		c.mu.Unlock()
		if ok {
			return
		}
		if closed {
			t.Fatalf("closed before subscribing: %+v", c.snapshot())
		}
		select {
		case <-c.frames:
		case <-c.done:
		case <-deadline:
			t.Fatal("no subscribed frame")
		}
	}
}

func (c *client) snapshot() result {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.res
}

func assertClosed(t *testing.T, got result, status websocket.StatusCode, code string) {
	t.Helper()
	if got.status != status {
		t.Errorf("close status = %d, want %d (result %+v)", got.status, status, got)
	}
	if len(got.codes) == 0 || got.codes[len(got.codes)-1] != code {
		t.Errorf("error code = %v, want %s", got.codes, code)
	}
}

func TestTabletAdmission(t *testing.T) {
	cases := map[string]struct {
		active bool
		err    error
		status websocket.StatusCode
		code   string
	}{
		"revoked or unknown device is refused with 4401":    {active: false, status: CloseUnauthenticated, code: "UNAUTHENTICATED"},
		"lookup failure is refused with 1011, not admitted": {err: errLookup, status: websocket.StatusInternalError, code: "INTERNAL"},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			h := newHarness(t)
			h.tablets.set(tc.active, tc.err)
			got := h.dial(t, tabletStaffToken(t)).waitClosed(t)
			if got.subscribed {
				t.Fatal("subscription was admitted")
			}
			assertClosed(t, got, tc.status, tc.code)
		})
	}
}

func TestTabletActiveStaysConnectedAcrossRechecks(t *testing.T) {
	h := newHarness(t)
	c := h.dial(t, tabletStaffToken(t))
	c.waitSubscribed(t)
	deadline := time.Now().Add(5 * time.Second)
	for h.tablets.callCount() < 4 { // admission + at least three re-checks
		if time.Now().After(deadline) {
			t.Fatalf("re-checks did not run: %d calls", h.tablets.callCount())
		}
		time.Sleep(10 * time.Millisecond)
	}
	if got := c.snapshot(); got.closed {
		t.Fatalf("an active credential was disconnected: %+v", got)
	}
}

func TestTabletRecheck(t *testing.T) {
	cases := map[string]struct {
		active bool
		err    error
		status websocket.StatusCode
		code   string
	}{
		"revocation disconnects with 4401":                 {active: false, status: CloseUnauthenticated, code: "UNAUTHENTICATED"},
		"lookup failure disconnects with 1011, never 4401": {err: errLookup, status: websocket.StatusInternalError, code: "INTERNAL"},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			h := newHarness(t)
			token := tabletStaffToken(t)
			c := h.dial(t, token)
			c.waitSubscribed(t)
			h.tablets.set(tc.active, tc.err)
			assertClosed(t, c.waitClosed(t), tc.status, tc.code)
			if tc.err != nil {
				logs := h.logs.String()
				if !strings.Contains(logs, "realtime credential re-check failed") || !strings.Contains(logs, `"request_id":"`) {
					t.Errorf("verification failure was not logged with a request id: %s", logs)
				}
				if strings.Contains(logs, `"request_id":""`) {
					t.Errorf("empty request id logged: %s", logs)
				}
				if strings.Contains(logs, token) {
					t.Error("the credential was written to the log")
				}
			}
		})
	}
}

func TestKDSAdmission(t *testing.T) {
	cases := map[string]struct {
		err    error
		status websocket.StatusCode
		code   string
	}{
		"revoked or unknown device is refused with 4401": {err: devices.ErrUnauthenticated, status: CloseUnauthenticated, code: "UNAUTHENTICATED"},
		"lookup failure is refused with 1011":            {err: errLookup, status: websocket.StatusInternalError, code: "INTERNAL"},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			h := newHarness(t)
			h.devices.set(tc.err)
			got := h.dial(t, kdsCredential).waitClosed(t)
			if got.subscribed {
				t.Fatal("subscription was admitted")
			}
			assertClosed(t, got, tc.status, tc.code)
		})
	}
}

func TestKDSActiveStaysConnectedAcrossRechecks(t *testing.T) {
	h := newHarness(t)
	c := h.dial(t, kdsCredential)
	c.waitSubscribed(t)
	deadline := time.Now().Add(5 * time.Second)
	for h.devices.callCount() < 4 {
		if time.Now().After(deadline) {
			t.Fatalf("re-checks did not run: %d calls", h.devices.callCount())
		}
		time.Sleep(10 * time.Millisecond)
	}
	if got := c.snapshot(); got.closed {
		t.Fatalf("an active device was disconnected: %+v", got)
	}
}

func TestKDSRecheck(t *testing.T) {
	cases := map[string]struct {
		err    error
		status websocket.StatusCode
		code   string
	}{
		"revocation disconnects with 4401":                      {err: devices.ErrUnauthenticated, status: CloseUnauthenticated, code: "UNAUTHENTICATED"},
		"a device moved to another venue disconnects with 4401": {err: devices.ErrWrongVenue, status: CloseUnauthenticated, code: "UNAUTHENTICATED"},
		"lookup failure disconnects with 1011, never 4401":      {err: errLookup, status: websocket.StatusInternalError, code: "INTERNAL"},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			h := newHarness(t)
			c := h.dial(t, kdsCredential)
			c.waitSubscribed(t)
			h.devices.set(tc.err)
			assertClosed(t, c.waitClosed(t), tc.status, tc.code)
			if strings.Contains(h.logs.String(), kdsCredential) {
				t.Error("the credential was written to the log")
			}
		})
	}
}

func staffSessionToken(t *testing.T) string {
	t.Helper()
	raw, err := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"sub": "staff-2", "role": "owner", "organizationId": testOrg, "sid": "session-2", "exp": time.Now().Add(time.Hour).Unix(),
	}).SignedString([]byte(testSecret))
	if err != nil {
		t.Fatal(err)
	}
	return raw
}

// Staff act only in venues they have been granted, every role included
// (PRD section 16 item 3; MVP 9.6).
func TestStaffVenueAccessOnSubscription(t *testing.T) {
	cases := map[string]struct {
		token   func(*testing.T) string
		granted bool
		err     error
		status  websocket.StatusCode
		code    string
	}{
		"owner session without a grant is refused with 4403": {token: staffSessionToken, status: CloseForbidden, code: "FORBIDDEN"},
		"elevated tablet without the staff grant is refused": {token: tabletStaffToken, status: CloseForbidden, code: "FORBIDDEN"},
		"grant lookup failure fails closed with 1011":        {token: staffSessionToken, err: errLookup, status: websocket.StatusInternalError, code: "INTERNAL"},
		"tablet grant lookup failure fails closed with 1011": {token: tabletStaffToken, err: errLookup, status: websocket.StatusInternalError, code: "INTERNAL"},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			h := newHarness(t)
			h.grants.set(tc.granted, tc.err)
			got := h.dial(t, tc.token(t)).waitClosed(t)
			if got.subscribed {
				t.Fatal("subscription was admitted")
			}
			assertClosed(t, got, tc.status, tc.code)
			if tc.err == nil && !strings.Contains(h.logs.String(), `"event":"venue_access_denied"`) {
				t.Errorf("the refusal was not recorded as a security event: %s", h.logs.String())
			}
		})
	}
}

func TestStaffWithGrantSubscribes(t *testing.T) {
	for name, token := range map[string]func(*testing.T) string{"staff session": staffSessionToken, "elevated tablet": tabletStaffToken} {
		t.Run(name, func(t *testing.T) {
			h := newHarness(t)
			h.dial(t, token(t)).waitSubscribed(t)
		})
	}
}

// A device credential is not a staff identity: its venue is pinned by the
// credential, and no staff grant is consulted.
func TestKDSDeviceNeedsNoStaffGrant(t *testing.T) {
	h := newHarness(t)
	h.grants.set(false, nil)
	h.dial(t, kdsCredential).waitSubscribed(t)
}

// A deactivated staff member or a logged-out session is refused on
// subscription, and a check that cannot be made fails closed (Story 2.5).
func TestStaffSessionAdmission(t *testing.T) {
	cases := map[string]struct {
		token           func(*testing.T) string
		active, revoked bool
		err             error
		status          websocket.StatusCode
		code            string
	}{
		"deactivated staff session is refused with 4401": {token: staffSessionToken, status: CloseUnauthenticated, code: "UNAUTHENTICATED"},
		"deactivated elevated tablet is refused":         {token: tabletStaffToken, status: CloseUnauthenticated, code: "UNAUTHENTICATED"},
		"logged-out session is refused with 4401":        {token: staffSessionToken, active: true, revoked: true, status: CloseUnauthenticated, code: "UNAUTHENTICATED"},
		"lookup failure fails closed with 1011":          {token: staffSessionToken, err: errLookup, status: websocket.StatusInternalError, code: "INTERNAL"},
		"session without a session id is refused":        {token: staffSessionWithoutSID, active: true, status: CloseUnauthenticated, code: "UNAUTHENTICATED"},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			h := newHarness(t)
			h.staff.set(tc.active, tc.revoked, tc.err)
			got := h.dial(t, tc.token(t)).waitClosed(t)
			if got.subscribed {
				t.Fatal("subscription was admitted")
			}
			assertClosed(t, got, tc.status, tc.code)
			if tc.err == nil && !strings.Contains(h.logs.String(), `"event":"staff_session_refused"`) {
				t.Errorf("the refusal was not recorded as a security event: %s", h.logs.String())
			}
		})
	}
}

// Deactivation and logout end a live staff subscription at the next re-check.
func TestStaffSessionRecheck(t *testing.T) {
	cases := map[string]struct {
		token           func(*testing.T) string
		active, revoked bool
		err             error
		status          websocket.StatusCode
		code            string
	}{
		"deactivation disconnects with 4401":               {token: staffSessionToken, status: CloseUnauthenticated, code: "UNAUTHENTICATED"},
		"deactivation disconnects an elevated tablet":      {token: tabletStaffToken, status: CloseUnauthenticated, code: "UNAUTHENTICATED"},
		"logout disconnects with 4401":                     {token: staffSessionToken, active: true, revoked: true, status: CloseUnauthenticated, code: "UNAUTHENTICATED"},
		"lookup failure disconnects with 1011, never 4401": {token: staffSessionToken, err: errLookup, status: websocket.StatusInternalError, code: "INTERNAL"},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			h := newHarness(t)
			c := h.dial(t, tc.token(t))
			c.waitSubscribed(t)
			h.staff.set(tc.active, tc.revoked, tc.err)
			assertClosed(t, c.waitClosed(t), tc.status, tc.code)
		})
	}
}

func staffSessionWithoutSID(t *testing.T) string {
	t.Helper()
	raw, err := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"sub": "staff-2", "role": "owner", "organizationId": testOrg, "exp": time.Now().Add(time.Hour).Unix(),
	}).SignedString([]byte(testSecret))
	if err != nil {
		t.Fatal(err)
	}
	return raw
}
