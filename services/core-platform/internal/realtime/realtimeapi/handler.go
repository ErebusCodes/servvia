// Package realtimeapi is the WebSocket transport of Servvia Core's realtime
// domain (contracts/realtime/servvia-realtime.md): GET /api/realtime.
//
// One connection is one venue subscription. The subscriber authenticates
// BEFORE anything is subscribed (the Authorization header of the upgrade, or
// the first `subscribe` message), the venue is resolved server-side from the
// identity, and the streams are granted by realtime.Grant, never chosen by
// the client. After `subscribed`, a client message of any kind closes the
// connection: a subscription cannot be widened or re-pointed.
//
// Delivery is at most once per connection; a subscriber that falls behind is
// disconnected and resynchronises over HTTP. Nothing here writes canonical
// state.
package realtimeapi

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/coder/websocket"

	"servvia/services/core-platform/internal/devices"
	"servvia/services/core-platform/internal/identity"
	"servvia/services/core-platform/internal/platform/httpx"
	"servvia/services/core-platform/internal/realtime"
	"servvia/services/core-platform/internal/venues"
)

// Close codes (RFC 6455 private range) and error codes of the contract.
const (
	CloseBadRequest      websocket.StatusCode = 4400
	CloseUnauthenticated websocket.StatusCode = 4401
	CloseForbidden       websocket.StatusCode = 4403
	CloseVenueNotFound   websocket.StatusCode = 4404
	CloseSlowConsumer    websocket.StatusCode = 4008
)

// VenueResolver finds venues (venues.PostgresStore).
type VenueResolver interface {
	Venue(ctx context.Context, venueID string) (venues.Venue, bool, error)
	VenueInOrganization(ctx context.Context, venueID, organizationID string) (venues.Venue, bool, error)
}

// DeviceAuth authenticates a D8 device credential (devices.Service).
type DeviceAuth interface {
	Authenticate(ctx context.Context, raw string, kind devices.Kind, venueID string) (devices.Credential, error)
}

// Config tunes the transport.
type Config struct {
	// AuthTimeout bounds the wait for the `subscribe` message.
	AuthTimeout time.Duration
	// PingInterval keeps idle connections alive and detects dead peers.
	PingInterval time.Duration
	// Revalidate re-checks tablet and device credentials (revocation).
	Revalidate time.Duration
	// WriteTimeout bounds one frame write.
	WriteTimeout time.Duration
}

// DefaultConfig is the production tuning.
var DefaultConfig = Config{AuthTimeout: 10 * time.Second, PingInterval: 30 * time.Second,
	Revalidate: 60 * time.Second, WriteTimeout: 10 * time.Second}

type Handler struct {
	hub      *realtime.Hub
	verifier *identity.Verifier
	tablets  identity.TabletDevices
	devices  DeviceAuth
	venues   VenueResolver
	logger   *slog.Logger
	cfg      Config
	origins  []string
	draining atomic.Bool
	conns    sync.WaitGroup
}

func NewHandler(hub *realtime.Hub, v *identity.Verifier, tablets identity.TabletDevices, dev DeviceAuth, venueStore VenueResolver,
	logger *slog.Logger, cfg Config) *Handler {
	// The same origins as the HTTP API's CORS allow-list. A native client
	// (Kotlin, C#) sends no Origin and is not affected.
	var origins []string
	for _, o := range httpx.AllowedOrigins {
		if u, err := url.Parse(o); err == nil && u.Host != "" {
			origins = append(origins, u.Host)
		}
	}
	return &Handler{hub: hub, verifier: v, tablets: tablets, devices: dev, venues: venueStore, logger: logger, cfg: cfg, origins: origins}
}

// Drain refuses new connections, ends every subscription (clients receive
// 1001 "going away") and waits, up to ctx, for the connections to close.
func (h *Handler) Drain(ctx context.Context) {
	h.draining.Store(true)
	h.hub.Close()
	done := make(chan struct{})
	go func() { h.conns.Wait(); close(done) }()
	select {
	case <-done:
	case <-ctx.Done():
	}
}

// --- wire shapes -------------------------------------------------------------

type subscribeMsg struct {
	Type    string `json:"type"`
	VenueID string `json:"venueId"`
	Token   string `json:"token,omitempty"`
}

type subscribedMsg struct {
	Type           string              `json:"type"`
	VenueID        string              `json:"venueId"`
	OrganizationID string              `json:"organizationId"`
	Streams        []realtime.Audience `json:"streams"`
	ServerTime     string              `json:"serverTime"`
}

type eventMsg struct {
	Type  string         `json:"type"`
	Event realtime.Event `json:"event"`
}

type errorMsg struct {
	Type    string `json:"type"`
	Code    string `json:"code"`
	Message string `json:"message"`
}

// refusal is a subscription refused before it existed.
type refusal struct {
	close websocket.StatusCode
	code  string
	msg   string
}

func (r *refusal) Error() string { return r.msg }

func refuse(close websocket.StatusCode, code, msg string) *refusal {
	return &refusal{close: close, code: code, msg: msg}
}

// errCredentialRevoked: a re-check found the credential revoked, unknown or
// no longer valid for this venue. It is the only re-check outcome that
// closes with 4401; any other error is a verification failure (1011).
var errCredentialRevoked = errors.New("this device has been revoked or is unknown")

// subscriber is an authenticated, authorized identity at one venue.
type subscriber struct {
	organizationID, venueID string
	granted                 []realtime.Audience
	expiresAt               time.Time // zero: no expiry (device credential)
	// recheck verifies the credential again (revocation); nil when there is
	// nothing to re-check. It returns nil when the credential is still
	// valid, errCredentialRevoked when it is not, and any other error when
	// it could not be verified. Verification failure fails closed: the
	// subscription is refused or ended (PRD section 16, items 5 and 12).
	recheck func(context.Context) error
}

// ServeHTTP serves GET /api/realtime.
func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if h.draining.Load() {
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.WriteHeader(http.StatusServiceUnavailable)
		_, _ = w.Write([]byte(`{"message":"Realtime is shutting down; reconnect shortly","statusCode":503,"code":"SHUTTING_DOWN"}`))
		return
	}
	headerToken, _ := identity.BearerToken(r.Header.Get("Authorization"))
	// The server's read and write timeouts are deadlines on the connection,
	// and a hijacked connection keeps them: clear them, or every subscription
	// would die after ReadTimeout. Liveness is the ping and per-write timeouts.
	rc := http.NewResponseController(w)
	if rc.SetReadDeadline(time.Time{}) != nil || rc.SetWriteDeadline(time.Time{}) != nil {
		h.logger.WarnContext(r.Context(), "realtime: cannot clear connection deadlines")
	}
	conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{OriginPatterns: h.origins})
	if err != nil {
		return // Accept has answered the HTTP request
	}
	h.conns.Add(1)
	defer h.conns.Done()
	conn.SetReadLimit(4096)
	ctx := r.Context()

	sub, err := h.authenticate(ctx, conn, headerToken)
	var ref *refusal
	switch {
	case errors.As(err, &ref):
		h.closeWith(ctx, conn, ref.close, ref.code, ref.msg)
		return
	case err != nil:
		h.logger.WarnContext(ctx, "realtime subscribe failed", "error", err)
		h.closeWith(ctx, conn, websocket.StatusInternalError, "INTERNAL", "Internal server error")
		return
	}
	s, err := h.hub.Subscribe(sub.organizationID, sub.venueID, sub.granted)
	if err != nil {
		h.closeWith(ctx, conn, websocket.StatusGoingAway, "SHUTTING_DOWN", "Realtime is shutting down; reconnect shortly")
		return
	}
	defer h.hub.Unsubscribe(s)
	if err := h.write(ctx, conn, subscribedMsg{Type: "subscribed", VenueID: sub.venueID, OrganizationID: sub.organizationID,
		Streams: sub.granted, ServerTime: time.Now().UTC().Format("2006-01-02T15:04:05.000Z")}); err != nil {
		return
	}
	h.stream(ctx, conn, s, sub)
}

// stream delivers events until the subscription or the connection ends.
func (h *Handler) stream(ctx context.Context, conn *websocket.Conn, s *realtime.Subscription, sub subscriber) {
	// Any client message after `subscribed` closes the connection (policy
	// violation): subscriptions are fixed. CloseRead also answers pings.
	ctx = conn.CloseRead(ctx)
	ping := time.NewTicker(h.cfg.PingInterval)
	defer ping.Stop()
	revalidate := time.NewTicker(h.cfg.Revalidate)
	defer revalidate.Stop()
	var expiry <-chan time.Time
	if !sub.expiresAt.IsZero() {
		t := time.NewTimer(time.Until(sub.expiresAt))
		defer t.Stop()
		expiry = t.C
	}
	for {
		select {
		case e := <-s.Events():
			if err := h.write(ctx, conn, eventMsg{Type: "event", Event: e}); err != nil {
				return
			}
		case <-s.Done():
			if s.Reason() == realtime.EndSlow {
				h.closeWith(ctx, conn, CloseSlowConsumer, string(realtime.EndSlow),
					"Events were dropped because this connection fell behind; reconnect and refetch")
			} else {
				h.closeWith(ctx, conn, websocket.StatusGoingAway, string(realtime.EndShutdown), "Realtime is shutting down; reconnect shortly")
			}
			return
		case <-expiry:
			h.closeWith(ctx, conn, CloseUnauthenticated, "TOKEN_EXPIRED", "The credential expired; reconnect with a fresh one")
			return
		case <-revalidate.C:
			if sub.recheck == nil {
				continue
			}
			switch err := sub.recheck(ctx); {
			case err == nil:
			case errors.Is(err, errCredentialRevoked):
				h.closeWith(ctx, conn, CloseUnauthenticated, "UNAUTHENTICATED", "This device has been revoked or is unknown")
				return
			default:
				// Not a revocation: the credential could not be verified. Fail
				// closed with 1011 (reconnect), never 4401, so a transient
				// server fault is not reported as a revoked credential.
				h.logger.WarnContext(ctx, "realtime credential re-check failed",
					"error", err, "request_id", httpx.RequestIDFrom(ctx))
				h.closeWith(ctx, conn, websocket.StatusInternalError, "INTERNAL", "Internal server error")
				return
			}
		case <-ping.C:
			pctx, cancel := context.WithTimeout(ctx, h.cfg.WriteTimeout)
			err := conn.Ping(pctx)
			cancel()
			if err != nil {
				return
			}
		case <-ctx.Done():
			_ = conn.CloseNow()
			return
		}
	}
}

// authenticate reads the subscribe message and resolves the subscriber.
func (h *Handler) authenticate(ctx context.Context, conn *websocket.Conn, headerToken string) (subscriber, error) {
	// Not a Read with a deadline: cancelling a Read's context closes the
	// connection before the refusal could be sent. Read in the background
	// and stop waiting after AuthTimeout.
	type first struct {
		typ websocket.MessageType
		raw []byte
		err error
	}
	got := make(chan first, 1)
	go func() {
		typ, raw, err := conn.Read(ctx)
		got <- first{typ, raw, err}
	}()
	var typ websocket.MessageType
	var raw []byte
	select {
	case f := <-got:
		if f.err != nil {
			return subscriber{}, refuse(CloseBadRequest, "BAD_REQUEST", "Expected a subscribe message")
		}
		typ, raw = f.typ, f.raw
	case <-time.After(h.cfg.AuthTimeout):
		return subscriber{}, refuse(CloseBadRequest, "BAD_REQUEST", "No subscribe message within the time allowed")
	}
	var msg subscribeMsg
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.DisallowUnknownFields()
	if typ != websocket.MessageText || dec.Decode(&msg) != nil || msg.Type != "subscribe" {
		return subscriber{}, refuse(CloseBadRequest, "BAD_REQUEST",
			`The first message must be {"type":"subscribe","venueId":...} with no other properties`)
	}
	token := headerToken
	if token == "" {
		token = msg.Token
	}
	if token == "" {
		return subscriber{}, refuse(CloseUnauthenticated, "UNAUTHENTICATED", "Unauthorized")
	}
	if _, _, isDevice := devices.ParseCredential(token); isDevice {
		return h.deviceSubscriber(ctx, token, msg.VenueID)
	}
	return h.tokenSubscriber(ctx, token, msg.VenueID)
}

// tokenSubscriber: a staff, tablet or KDS access token (identity.Verifier).
func (h *Handler) tokenSubscriber(ctx context.Context, token, requestedVenue string) (subscriber, error) {
	p, err := h.verifier.Verify(token)
	if err != nil {
		return subscriber{}, refuse(CloseUnauthenticated, "UNAUTHENTICATED", err.Error())
	}
	var id realtime.Identity
	switch p.Kind {
	case identity.KindStaffSession:
		id = realtime.Identity{Kind: realtime.StaffSession, Role: p.Role}
	case identity.KindTabletStaff, identity.KindTabletManager:
		id = realtime.Identity{Kind: realtime.StaffOnTablet, Role: p.Role}
	case identity.KindTabletDevice:
		id = realtime.Identity{Kind: realtime.CustomerTablet}
	case identity.KindKDSDevice:
		id = realtime.Identity{Kind: realtime.KDSToken}
	default:
		return subscriber{}, refuse(CloseForbidden, "FORBIDDEN", realtime.ErrNotPermitted.Error())
	}
	granted, err := realtime.Grant(id)
	if err != nil {
		return subscriber{}, refuse(CloseForbidden, "FORBIDDEN", err.Error())
	}
	// A venue-pinned token names its own venue or none; never another.
	venueID, err := identity.ResolveVenueScope(p, requestedVenue)
	if err != nil {
		return subscriber{}, refuse(CloseForbidden, "FORBIDDEN", err.Error())
	}
	if strings.TrimSpace(venueID) == "" {
		return subscriber{}, refuse(CloseBadRequest, "BAD_REQUEST", "venueId is required")
	}
	v, found, err := h.venues.VenueInOrganization(ctx, venueID, p.OrganizationID)
	if err != nil {
		return subscriber{}, err
	}
	if !found {
		return subscriber{}, refuse(CloseVenueNotFound, "VENUE_NOT_FOUND", "Venue not found")
	}
	sub := subscriber{organizationID: v.OrganizationID, venueID: v.ID, granted: granted, expiresAt: p.ExpiresAt}
	if p.DeviceID != "" && (p.Kind == identity.KindTabletStaff || p.Kind == identity.KindTabletManager ||
		p.Kind == identity.KindTabletDevice) {
		deviceID := p.DeviceID
		sub.recheck = func(ctx context.Context) error {
			active, err := h.tablets.TabletDeviceActive(ctx, deviceID)
			switch {
			case err != nil:
				return fmt.Errorf("check tablet device: %w", err)
			case !active:
				return errCredentialRevoked
			}
			return nil
		}
		// Admission fails closed too: a lookup error is returned as an error
		// (1011 INTERNAL), and a revoked or unknown device is refused (4401).
		switch err := sub.recheck(ctx); {
		case errors.Is(err, errCredentialRevoked):
			return subscriber{}, refuse(CloseUnauthenticated, "UNAUTHENTICATED", "This device has been revoked or is unknown")
		case err != nil:
			return subscriber{}, err
		}
	}
	return sub, nil
}

// deviceSubscriber: a D8 device credential. Only a kds device has a realtime
// need; every other kind (pos_terminal, order_tablet, payment_adapter) is
// refused, and no device kind ever carries staff authority.
func (h *Handler) deviceSubscriber(ctx context.Context, token, requestedVenue string) (subscriber, error) {
	if strings.TrimSpace(requestedVenue) == "" {
		return subscriber{}, refuse(CloseBadRequest, "BAD_REQUEST", "venueId is required")
	}
	_, err := h.devices.Authenticate(ctx, token, devices.KindKDS, requestedVenue)
	switch {
	case errors.Is(err, devices.ErrUnauthenticated):
		return subscriber{}, refuse(CloseUnauthenticated, "UNAUTHENTICATED", err.Error())
	case errors.Is(err, devices.ErrWrongKind), errors.Is(err, devices.ErrWrongVenue):
		return subscriber{}, refuse(CloseForbidden, "FORBIDDEN", err.Error())
	case err != nil:
		return subscriber{}, err
	}
	v, found, err := h.venues.Venue(ctx, requestedVenue)
	if err != nil {
		return subscriber{}, err
	}
	if !found {
		return subscriber{}, refuse(CloseVenueNotFound, "VENUE_NOT_FOUND", "Venue not found")
	}
	granted, _ := realtime.Grant(realtime.Identity{Kind: realtime.Device, DeviceKind: string(devices.KindKDS)})
	return subscriber{organizationID: v.OrganizationID, venueID: v.ID, granted: granted,
		recheck: func(ctx context.Context) error {
			_, err := h.devices.Authenticate(ctx, token, devices.KindKDS, v.ID)
			switch {
			case err == nil:
				return nil
			case errors.Is(err, devices.ErrUnauthenticated), errors.Is(err, devices.ErrWrongKind), errors.Is(err, devices.ErrWrongVenue):
				return errCredentialRevoked
			}
			return fmt.Errorf("check kds device: %w", err)
		}}, nil
}

func (h *Handler) write(ctx context.Context, conn *websocket.Conn, v any) error {
	raw, err := json.Marshal(v)
	if err != nil {
		return err
	}
	wctx, cancel := context.WithTimeout(ctx, h.cfg.WriteTimeout)
	defer cancel()
	return conn.Write(wctx, websocket.MessageText, raw)
}

// closeWith sends an error message, then the close frame.
func (h *Handler) closeWith(ctx context.Context, conn *websocket.Conn, status websocket.StatusCode, code, msg string) {
	_ = h.write(ctx, conn, errorMsg{Type: "error", Code: code, Message: msg})
	_ = conn.Close(status, code)
}
