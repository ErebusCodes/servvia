package integration

// Canonical realtime (Phase D12) against real PostgreSQL and real WebSocket
// connections through the production route table: authentication and
// isolation, every domain's facts, least privilege, the same-transaction
// publication boundary, gap-free tailing, backpressure, reconnect/resync
// and shutdown. Numbers refer to the D12 required tests.

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"runtime"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/golang-jwt/jwt/v5"
	"github.com/jackc/pgx/v5"

	"servvia/services/core-platform/internal/checks"
	"servvia/services/core-platform/internal/devices"
	"servvia/services/core-platform/internal/health"
	"servvia/services/core-platform/internal/identity"
	"servvia/services/core-platform/internal/kitchen"
	"servvia/services/core-platform/internal/menu"
	"servvia/services/core-platform/internal/payments"
	"servvia/services/core-platform/internal/platform/postgres"
	"servvia/services/core-platform/internal/promotions"
	"servvia/services/core-platform/internal/ratelimit"
	"servvia/services/core-platform/internal/realtime"
	realtimestore "servvia/services/core-platform/internal/realtime/pgstore"
	"servvia/services/core-platform/internal/realtime/realtimeapi"
	"servvia/services/core-platform/internal/refunds"
	"servvia/services/core-platform/internal/server"
	"servvia/services/core-platform/internal/tables"
	"servvia/services/core-platform/internal/venues"
	"servvia/services/core-platform/tests/testsupport"
)

const rtSecret = "integration-secret-0123456789abcdef"

type realtimeHarness struct {
	promotionsHarness
	hub     *realtime.Hub
	handler *realtimeapi.Handler
	srv     *httptest.Server
	wsURL   string
	stop    context.CancelFunc
	done    chan struct{}
}

func realtimeSetup(t *testing.T, cfg realtimeapi.Config, buffer int) *realtimeHarness {
	h := promotionsSetup(t)
	ctx := context.Background()
	pool, err := postgres.NewPool(ctx, postgres.Options{URL: testsupport.DisposableDatabaseURL(t), MaxConns: 20})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	hub := realtime.NewHub(buffer)
	dispatcher := realtimestore.NewDispatcher(realtimestore.NewLog(pool), hub, logger, 20*time.Millisecond, 24*time.Hour, false)
	if err := dispatcher.Start(ctx); err != nil {
		t.Fatal(err)
	}
	runCtx, stop := context.WithCancel(ctx)
	done := make(chan struct{})
	go func() { defer close(done); dispatcher.Run(runCtx) }()
	venueStore := venues.NewPostgresStore(pool)
	handler := realtimeapi.NewHandler(hub, identity.NewVerifier(rtSecret), identity.NewPostgresTabletDevices(pool), h.devices,
		venueStore, logger, cfg)
	routes := server.Routes(server.Deps{
		Logger: logger, Health: health.New(pool, time.Second),
		Menu:     menu.NewHandler(menu.NewPostgresStore(pool), logger),
		Venues:   venues.NewHandler(venueStore, logger),
		Verifier: identity.NewVerifier(rtSecret), TabletDevices: identity.NewPostgresTabletDevices(pool),
		RateLimiter: ratelimit.New(admitAll{}, 0, logger), DeviceAuth: h.devices, Realtime: handler,
	})
	srv := httptest.NewUnstartedServer(routes)
	// Short server timeouts: a subscription must outlive them (the hijacked
	// connection's deadlines are cleared).
	srv.Config.ReadTimeout, srv.Config.WriteTimeout = 500*time.Millisecond, 500*time.Millisecond
	srv.Start()
	r := &realtimeHarness{promotionsHarness: h, hub: hub, handler: handler, srv: srv,
		wsURL: "ws" + strings.TrimPrefix(srv.URL, "http") + "/api/realtime", stop: stop, done: done}
	t.Cleanup(func() {
		dctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		handler.Drain(dctx)
		srv.Close()
		stop()
		<-done
	})
	return r
}

var fastConfig = realtimeapi.Config{AuthTimeout: 500 * time.Millisecond, PingInterval: time.Second, Revalidate: 200 * time.Millisecond,
	WriteTimeout: 2 * time.Second}

func sign(c jwt.MapClaims) string {
	if _, set := c["exp"]; !set {
		c["exp"] = time.Now().Add(time.Hour).Unix()
	}
	s, _ := jwt.NewWithClaims(jwt.SigningMethodHS256, c).SignedString([]byte(rtSecret))
	return s
}

func (h *realtimeHarness) staffToken(role string) string {
	id := h.f.Owner
	if role == "cashier" {
		id = h.f.Cashier
	}
	return sign(jwt.MapClaims{"sub": id, "email": role + "@example.test", "role": role, "organizationId": h.f.Org})
}

func (h *realtimeHarness) kdsToken(venue string) string {
	return sign(jwt.MapClaims{"sub": "kds-device:" + venue, "role": "kitchen", "organizationId": h.f.Org, "venueId": venue, "kind": "kds_device"})
}

// wsClient reads in the background: coder/websocket closes a connection
// whose Read context expires, so waiting for "nothing arrives" must not be a
// Read with a timeout.
type wsClient struct {
	t      *testing.T
	conn   *websocket.Conn
	msgs   chan []byte
	done   chan struct{}
	err    error
	mu     sync.Mutex
	frames []string // every frame received, for payload audits
}

func newClient(t *testing.T, conn *websocket.Conn, read bool) *wsClient {
	c := &wsClient{t: t, conn: conn, msgs: make(chan []byte, 10000), done: make(chan struct{})}
	if read {
		go func() {
			defer close(c.done)
			for {
				_, raw, err := conn.Read(context.Background())
				if err != nil {
					c.err = err
					return
				}
				c.msgs <- raw
			}
		}()
	}
	return c
}

var errQuiet = errors.New("no message")

type serverMsg struct {
	Type    string          `json:"type"`
	Code    string          `json:"code"`
	Streams []string        `json:"streams"`
	VenueID string          `json:"venueId"`
	OrgID   string          `json:"organizationId"`
	Event   json.RawMessage `json:"event"`
}

type envelope struct {
	EventID        string         `json:"eventId"`
	EventType      string         `json:"eventType"`
	OrganizationID string         `json:"organizationId"`
	VenueID        string         `json:"venueId"`
	AggregateType  string         `json:"aggregateType"`
	AggregateID    string         `json:"aggregateId"`
	Version        *int           `json:"version"`
	Payload        map[string]any `json:"payload"`
}

// connect dials and sends the subscribe message; it returns the client and
// the first server message (subscribed or error).
func (h *realtimeHarness) connect(t *testing.T, headerToken string, subscribe map[string]any) (*wsClient, serverMsg) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	opts := &websocket.DialOptions{HTTPHeader: http.Header{}}
	if headerToken != "" {
		opts.HTTPHeader.Set("Authorization", "Bearer "+headerToken)
	}
	conn, resp, err := websocket.Dial(ctx, h.wsURL, opts)
	if err != nil {
		t.Fatalf("dial: %v %v", err, resp)
	}
	c := newClient(t, conn, true)
	t.Cleanup(func() { _ = conn.CloseNow() })
	if subscribe != nil {
		raw, _ := json.Marshal(subscribe)
		if err := conn.Write(ctx, websocket.MessageText, raw); err != nil {
			t.Fatalf("subscribe: %v", err)
		}
	}
	m, err := c.read(5 * time.Second)
	if err != nil {
		t.Fatalf("first message after %v: %v", subscribe, err)
	}
	return c, m
}

func (h *realtimeHarness) subscribe(t *testing.T, token, venue string) *wsClient {
	t.Helper()
	c, m := h.connect(t, token, map[string]any{"type": "subscribe", "venueId": venue})
	if m.Type != "subscribed" {
		t.Fatalf("subscribe to %s: %+v", venue, m)
	}
	return c
}

func (c *wsClient) read(timeout time.Duration) (serverMsg, error) {
	var raw []byte
	select {
	case raw = <-c.msgs:
	default:
		select {
		case raw = <-c.msgs:
		case <-c.done:
			select { // a message that raced the close
			case raw = <-c.msgs:
			default:
				return serverMsg{}, c.err
			}
		case <-time.After(timeout):
			return serverMsg{}, errQuiet
		}
	}
	c.mu.Lock()
	c.frames = append(c.frames, string(raw))
	c.mu.Unlock()
	var m serverMsg
	return m, json.Unmarshal(raw, &m)
}

// until collects events until pred holds for the collection, or times out.
func (c *wsClient) until(timeout time.Duration, pred func([]envelope) bool) []envelope {
	c.t.Helper()
	var got []envelope
	deadline := time.Now().Add(timeout)
	for !pred(got) {
		left := time.Until(deadline)
		if left <= 0 {
			c.t.Fatalf("timed out; received %s", types(got))
		}
		m, err := c.read(left)
		if err != nil {
			c.t.Fatalf("read: %v; received %s", err, types(got))
		}
		if m.Type != "event" {
			c.t.Fatalf("unexpected %+v", m)
		}
		var e envelope
		_ = json.Unmarshal(m.Event, &e)
		got = append(got, e)
	}
	return got
}

// expect collects until every wanted type has arrived (any order).
func (c *wsClient) expect(wanted ...string) []envelope {
	c.t.Helper()
	return c.until(10*time.Second, func(got []envelope) bool {
		have := types(got)
		for _, w := range wanted {
			if !slices.Contains(have, w) {
				return false
			}
		}
		return true
	})
}

// quiet asserts that nothing arrives for d.
func (c *wsClient) quiet(d time.Duration) {
	c.t.Helper()
	if m, err := c.read(d); !errors.Is(err, errQuiet) {
		c.t.Errorf("unexpected message %+v %s (%v)", m, m.Event, err)
	}
}

func types(es []envelope) []string {
	out := make([]string, len(es))
	for i, e := range es {
		out[i] = e.EventType
	}
	return out
}

// closeStatus reads until the connection closes and returns its close code.
func closeStatus(c *wsClient) websocket.StatusCode {
	for {
		_, err := c.read(5 * time.Second)
		if errors.Is(err, errQuiet) {
			c.t.Error("the connection did not close")
			return -1
		}
		if err != nil {
			return websocket.CloseStatus(err)
		}
	}
}

// 1-5, 10, 29 and credential handling.
func TestRealtimeSubscriptionAuthorization(t *testing.T) {
	h := realtimeSetup(t, fastConfig, 64)
	venue, other := h.f.Venue, h.f.TaxlessVenue
	_, payAdapter := h.enrollDevice(t, devices.KindPaymentAdapter, venue)
	_, orderTablet := h.enrollDevice(t, devices.KindOrderTablet, venue)
	_, posDevice := h.enrollDevice(t, devices.KindPOSTerminal, venue)
	_, kdsDevice := h.enrollDevice(t, devices.KindKDS, venue)
	sub := func(v string) map[string]any { return map[string]any{"type": "subscribe", "venueId": v} }

	// 1, 9: allowed subscriptions and their server-granted streams.
	for name, c := range map[string]struct {
		header  string
		msg     map[string]any
		streams []string
	}{
		"owner login":               {h.staffToken("owner"), sub(venue), []string{"operations", "financial"}},
		"cashier, token in message": {"", map[string]any{"type": "subscribe", "venueId": venue, "token": h.staffToken("cashier")}, []string{"operations", "financial"}},
		"KDS token, own venue":      {h.kdsToken(venue), sub(venue), []string{"kitchen"}},
		"KDS token, venue omitted":  {h.kdsToken(venue), sub(""), []string{"kitchen"}},
		"D8 kds device":             {kdsDevice, sub(venue), []string{"kitchen"}},
		"kitchen staff":             {h.staffToken("kitchen"), sub(venue), []string{"kitchen"}},
	} {
		_, m := h.connect(t, c.header, c.msg)
		if m.Type != "subscribed" || !slices.Equal(m.Streams, c.streams) || m.VenueID != venue || m.OrgID != h.f.Org {
			t.Errorf("%s: %+v", name, m)
		}
	}

	expired := sign(jwt.MapClaims{"sub": h.f.Owner, "role": "owner", "organizationId": h.f.Org, "exp": time.Now().Add(-time.Minute).Unix()})
	otherOrg := sign(jwt.MapClaims{"sub": testsupport.UUID(), "role": "owner", "organizationId": h.f.OtherOrg})
	tabletManager := sign(jwt.MapClaims{"sub": h.f.Owner, "role": "manager", "organizationId": h.f.Org, "venueId": venue,
		"kind": "tablet_manager", "deviceId": testsupport.UUID()})
	customer := sign(jwt.MapClaims{"sub": "tablet:" + venue, "role": "viewer", "organizationId": h.f.Org, "venueId": venue,
		"kind": "tablet_device", "deviceId": testsupport.UUID()})
	for name, c := range map[string]struct {
		header string
		msg    map[string]any
		code   string
		status websocket.StatusCode
	}{
		"2 no credential":                     {"", sub(venue), "UNAUTHENTICATED", 4401},
		"2 garbage token":                     {"not-a-jwt", sub(venue), "UNAUTHENTICATED", 4401},
		"2 expired token":                     {expired, sub(venue), "UNAUTHENTICATED", 4401},
		"2 revoked or unknown device":         {"sdv1." + testsupport.UUID() + ".secret", sub(venue), "UNAUTHENTICATED", 4401},
		"3 other organization":                {otherOrg, sub(venue), "VENUE_NOT_FOUND", 4404},
		"4 KDS token at another venue":        {h.kdsToken(venue), sub(other), "FORBIDDEN", 4403},
		"4 D8 kds device at another venue":    {kdsDevice, sub(other), "FORBIDDEN", 4403},
		"5 pinned tablet names another venue": {tabletManager, sub(other), "FORBIDDEN", 4403},
		"5 forged organizationId":             {h.staffToken("owner"), map[string]any{"type": "subscribe", "venueId": venue, "organizationId": h.f.OtherOrg}, "BAD_REQUEST", 4400},
		"malformed venue id":                  {h.staffToken("owner"), sub("../../" + venue), "VENUE_NOT_FOUND", 4404},
		"missing venue":                       {h.staffToken("owner"), sub(""), "BAD_REQUEST", 4400},
		"wrong message type":                  {h.staffToken("owner"), map[string]any{"type": "joinVenue", "venueId": venue}, "BAD_REQUEST", 4400},
		"10 customer tablet":                  {customer, sub(venue), "FORBIDDEN", 4403},
		"10 viewer":                           {h.staffToken("viewer"), sub(venue), "FORBIDDEN", 4403},
		"10 D8 order tablet":                  {orderTablet, sub(venue), "FORBIDDEN", 4403},
		"D8 POS device (no staff authority)":  {posDevice, sub(venue), "FORBIDDEN", 4403},
		"29 payment adapter":                  {payAdapter, sub(venue), "FORBIDDEN", 4403},
	} {
		c2, m := h.connect(t, c.header, c.msg)
		if m.Type != "error" || m.Code != c.code {
			t.Errorf("%s: %+v", name, m)
			continue
		}
		if st := closeStatus(c2); st != c.status {
			t.Errorf("%s: closed %d, want %d", name, st, c.status)
		}
	}
	// No subscribe message at all: refused after the auth timeout.
	c3, m := h.connect(t, h.staffToken("owner"), nil)
	if m.Type != "error" || m.Code != "BAD_REQUEST" || closeStatus(c3) != 4400 {
		t.Errorf("silent client: %+v", m)
	}
	// 5: after subscribed, any client message closes the connection.
	c4 := h.subscribe(t, h.staffToken("owner"), venue)
	_ = c4.conn.Write(context.Background(), websocket.MessageText, []byte(`{"type":"subscribe","venueId":"`+other+`"}`))
	if st := closeStatus(c4); st != websocket.StatusPolicyViolation {
		t.Errorf("re-subscribe closed with %d", st)
	}
	// Only the six allowed subscriptions above remain: no refused or closed
	// connection is left registered.
	deadline := time.Now().Add(2 * time.Second)
	for h.hub.Count() != 6 && time.Now().Before(deadline) {
		time.Sleep(20 * time.Millisecond)
	}
	if n := h.hub.Count(); n != 6 {
		t.Errorf("%d subscriptions registered, want the 6 allowed ones", n)
	}
}

// 6-9, 11-22, 26, 28, 30, 34: every domain's facts, end to end, with least
// privilege and isolation.
func TestRealtimeCanonicalFacts(t *testing.T) {
	h := realtimeSetup(t, fastConfig, 256)
	ctx := context.Background()
	staff := h.subscribe(t, h.staffToken("owner"), h.f.Venue)
	kdsClient := h.subscribe(t, h.kdsToken(h.f.Venue), h.f.Venue)
	otherVenue := h.subscribe(t, h.staffToken("owner"), h.f.TaxlessVenue)
	schema := testsupport.Schema(t, "realtime/servvia-realtime.schema.json", "")

	// Visit, order, rounds, kitchen.
	s := h.openSession(t, h.f.TableA)
	o := h.place(t, h.dineIn(s.ID, line(h.f.Plain, 1)))
	h.drain(t)
	got := staff.expect("table_session.opened", "order.created", "order.round_submitted", "kitchen_ticket.created")
	ticket := h.tickets(t)[0]
	if _, _, err := h.kitchen.Transition(ctx, kitchen.TransitionCommand{VenueID: h.f.Venue, TicketID: ticket.ID,
		To: kitchen.StatusAcknowledged, ExpectedVersion: 1, Actor: kds}); err != nil {
		t.Fatal(err)
	}
	o2 := h.round(t, o.ID, line(h.f.NoGroups, 1))
	h.drain(t)
	got = append(got, staff.expect("kitchen_ticket.transitioned", "order.round_submitted", "kitchen_ticket.created")...)

	// 6, 7, 8: the kitchen screen got exactly the tickets.
	kGot := kdsClient.until(10*time.Second, func(es []envelope) bool { return len(es) >= 3 })
	if !slices.Equal(types(kGot), []string{"kitchen_ticket.created", "kitchen_ticket.transitioned", "kitchen_ticket.created"}) {
		t.Errorf("kds received %v", types(kGot))
	}

	// 13: the realtime order.round_submitted is the D4 fact: same fields
	// and values as the outbox payload, minus the projector's lines.
	var outbox map[string]any
	var raw []byte
	_ = h.writer.QueryRow(ctx, `SELECT payload FROM "OutboxEvent" WHERE "aggregateId" = $1 AND (payload->>'sequence')::int = 2`, o.ID).Scan(&raw)
	_ = json.Unmarshal(raw, &outbox)
	for _, e := range got {
		if e.EventType == "order.round_submitted" && e.Payload["sequence"] == 2.0 {
			for k, v := range e.Payload {
				if !equalJSON(outbox[k], v) {
					t.Errorf("round fact %s: realtime %v, outbox %v", k, v, outbox[k])
				}
			}
			if _, has := e.Payload["lines"]; has || len(e.Payload) != 6 {
				t.Errorf("round fact payload %v", e.Payload)
			}
		}
	}

	// Money: bill, pay, settle, refund (revoke), re-settle, reversal.
	c, created, err := h.checks.Create(ctx, h.forSession(s.ID))
	if err != nil || !created {
		t.Fatal(err)
	}
	p := h.pay(t, c.ID, c.TotalCents)
	ref := "provider-ref-SECRET-" + p.ID[:8]
	if _, _, err := h.payments.RecordResult(ctx, payments.ResultCommand{Scope: h.payScope(), PaymentID: p.ID,
		Outcome: payments.StatusSucceeded, Reference: &ref, Actor: payments.Adapter{ID: serviceAdapterID}}); err != nil {
		t.Fatal(err)
	}
	got = append(got, staff.expect("check.created", "payment.created", "payment.status_changed", "check.settled")...)
	r := h.refund(t, p.ID, 100)
	h.mustRefundResult(t, r.ID, payments.StatusSucceeded)
	got = append(got, staff.expect("refund.created", "refund.status_changed", "check.settlement_revoked")...)
	p2 := h.pay(t, c.ID, 100)
	h.mustReport(t, p2.ID, payments.StatusSucceeded)
	got = append(got, staff.until(10*time.Second, func(es []envelope) bool {
		return slices.Contains(types(es), "check.settled") && len(es) >= 3
	})...)
	adapterID, adapterCredential := h.enrollDevice(t, devices.KindPaymentAdapter, h.f.Venue)
	if _, _, err := h.refunds.Reverse(ctx, refunds.ReversalCommand{Scope: refunds.Scope{OrganizationID: h.f.Org, VenueID: h.f.Venue},
		PaymentID: p2.ID, AmountCents: 100, Currency: "NZD", IdempotencyKey: key(), DeviceID: adapterID}); err != nil {
		t.Fatal(err)
	}
	got = append(got, staff.expect("reversal.recorded", "check.settlement_revoked")...)

	// Shift, promotions, visit close (after the check is settled again).
	shift := h.openShift(t, 5000)
	if _, _, err := h.closeShift(shift, 5000); err != nil {
		t.Fatal(err)
	}
	got = append(got, staff.expect("shift.opened", "shift.closed")...)
	pr := h.promotion(t, h.f.Venue, percent("Ten", 1000))
	bp := int64(2000)
	pr, _, _ = h.promos.Update(ctx, h.change(pr), promotions.Patch{BasisPoints: &bp})
	if _, _, err := h.promos.Deactivate(ctx, h.change(pr)); err != nil {
		t.Fatal(err)
	}
	got = append(got, staff.expect("promotion.created", "promotion.activated", "promotion.updated", "promotion.disabled")...)
	p3 := h.pay(t, c.ID, 100)
	h.mustReport(t, p3.ID, payments.StatusSucceeded)
	cur, _ := h.sessions.Get(ctx, tables.Scope{OrganizationID: h.f.Org, VenueID: h.f.Venue}, s.ID)
	if _, err := h.sessions.Close(ctx, tables.Scope{OrganizationID: h.f.Org, VenueID: h.f.Venue}, s.ID, cur.Version, tables.Actor{StaffID: h.f.Cashier, Role: "cashier"}); err != nil {
		t.Fatal(err)
	}
	got = append(got, staff.expect("table_session.closed")...)

	// 8: none of that reached the kitchen screen; 26: nor the other venue.
	kdsClient.quiet(300 * time.Millisecond)
	otherVenue.quiet(100 * time.Millisecond)
	// The other venue's own fact reaches it, and only it.
	if _, _, err := h.sessions.Open(ctx, tables.OpenCommand{Scope: tables.Scope{OrganizationID: h.f.Org, VenueID: h.f.TaxlessVenue},
		TableID: h.f.TaxlessTable, Covers: 2, RequestKey: key(), Actor: tables.Actor{StaffID: h.f.Cashier, Role: "cashier"}}); err != nil {
		t.Fatal(err)
	}
	if e := otherVenue.expect("table_session.opened"); e[0].VenueID != h.f.TaxlessVenue {
		t.Errorf("other venue got %+v", e[0])
	}
	staff.quiet(300 * time.Millisecond)

	// 19-22: envelopes. Unique ids; server-derived venue and organization;
	// versions equal the database's; every message matches the contract.
	seen := map[string]bool{}
	for _, e := range got {
		if seen[e.EventID] || e.EventID == "" {
			t.Errorf("duplicate or empty eventId %s", e.EventID)
		}
		seen[e.EventID] = true
		if e.VenueID != h.f.Venue || e.OrganizationID != h.f.Org {
			t.Errorf("%s: venue %s org %s", e.EventType, e.VenueID, e.OrganizationID)
		}
	}
	for _, f := range staff.frames {
		testsupport.Validate(t, schema, []byte(f))
	}
	var checkVersion, sessionVersion int
	_ = h.writer.QueryRow(ctx, `SELECT version FROM "Check" WHERE id = $1`, c.ID).Scan(&checkVersion)
	_ = h.writer.QueryRow(ctx, `SELECT version FROM "TableSession" WHERE id = $1`, s.ID).Scan(&sessionVersion)
	lastVersion := map[string]int{}
	for _, e := range got {
		if e.Version == nil {
			continue
		}
		if *e.Version <= lastVersion[e.AggregateID] {
			t.Errorf("%s %s: version %d after %d", e.EventType, e.AggregateID, *e.Version, lastVersion[e.AggregateID])
		}
		lastVersion[e.AggregateID] = *e.Version
	}
	if lastVersion[c.ID] != checkVersion || lastVersion[s.ID] != sessionVersion {
		t.Errorf("versions: check %d/%d session %d/%d", lastVersion[c.ID], checkVersion, lastVersion[s.ID], sessionVersion)
	}
	// Every recorded fact of the venue reached the staff subscriber once.
	if n := h.count(t, `SELECT count(*) FROM "RealtimeEvent" WHERE "venueId" = $1`, h.f.Venue); n != len(got) {
		t.Errorf("recorded %d facts, staff received %d", n, len(got))
	}

	// 28: no secret or provider detail in any frame.
	_, deviceSecret, _ := devices.ParseCredential(adapterCredential)
	for _, f := range append(append([]string{}, staff.frames...), kdsClient.frames...) {
		for _, bad := range []string{ref, "txn-", deviceSecret, adapterCredential, rtSecret, p.IdempotencyKey,
			"resultReference", "passwordHash", "credential", "reference", "Bearer "} {
			if strings.Contains(f, bad) {
				t.Errorf("frame leaks %q: %s", bad, f)
			}
		}
	}
	for _, f := range kdsClient.frames {
		for _, money := range []string{"Cents", "check", "payment", "refund"} {
			if strings.Contains(f, money) {
				t.Errorf("kitchen frame carries %q: %s", money, f)
			}
		}
	}
	// 34: canonical facts need no legacy state.
	for _, q := range []string{`SELECT count(*) FROM "POSSyncRecord" WHERE "orderId" = $1`,
		`SELECT count(*) FROM "ConnectorCommand" WHERE payload::text LIKE '%' || $1 || '%'`,
		`SELECT count(*) FROM "KdsDeliveryRecord" WHERE "orderId" = $1`} {
		if n := h.count(t, q, o2.ID); n != 0 {
			t.Errorf("%s: %d", q, n)
		}
	}
	_ = checks.StatusOpen
}

func equalJSON(a, b any) bool {
	x, _ := json.Marshal(a)
	y, _ := json.Marshal(b)
	return string(x) == string(y)
}

// 23, 24, 31 and the publication boundary: a fact commits with its change or
// not at all; delivery failures never touch a change; the D4 outbox's
// progress columns are not realtime state.
func TestRealtimeTransactionBoundary(t *testing.T) {
	h := realtimeSetup(t, fastConfig, 64)
	ctx := context.Background()
	count := func() int { return h.count(t, `SELECT count(*) FROM "RealtimeEvent" WHERE "venueId" = $1`, h.f.Venue) }

	// A fact recorded in a transaction that rolls back never exists.
	tx, err := h.writer.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := realtimestore.Record(ctx, tx, h.f.Venue, realtime.Fact{Type: "shift.opened", AggregateType: "shift", AggregateID: "x",
		Payload: map[string]any{"shiftId": "x", "status": "open"}}); err != nil {
		t.Fatal(err)
	}
	_ = tx.Rollback(ctx)
	// A refused domain change records nothing (a promotion that cannot apply).
	inactive, _, _ := h.promos.Create(ctx, promotions.CreateCommand{Scope: h.pscope(h.f.Venue), Terms: percent("Off", 1000),
		IdempotencyKey: key(), Actor: h.admin()})
	before := count()
	if _, _, err := h.porders.Create(ctx, h.takeaway(&inactive.ID, line(h.f.Plain, 1))); reasonOf(err) != promotions.ReasonInactive {
		t.Fatalf("refusal: %v", err)
	}
	if count() != before {
		t.Error("a refused change recorded a fact")
	}
	// A fact that cannot be recorded fails its transaction: no change
	// without its announcement.
	err = pgx.BeginFunc(ctx, h.writer, func(tx pgx.Tx) error {
		_, err := realtimestore.Record(ctx, tx, testsupport.UUID(), realtime.Fact{Type: "shift.opened", AggregateType: "shift",
			AggregateID: "y", Payload: map[string]any{}})
		return err
	})
	if !errors.Is(err, realtimestore.ErrUnknownVenue) {
		t.Errorf("unknown venue: %v", err)
	}
	if _, err := realtimestore.Record(ctx, nil, h.f.Venue, realtime.Fact{Type: "nope.nope"}); !errors.Is(err, realtime.ErrInvalidFact) {
		t.Errorf("invalid fact: %v", err)
	}

	// 23/24: a subscriber whose transport dies mid-stream, and a hub with no
	// dispatcher at all, change nothing about canonical writes.
	dead := h.subscribe(t, h.staffToken("owner"), h.f.Venue)
	_ = dead.conn.CloseNow()
	h.stop()
	<-h.done
	s := h.openSession(t, h.f.TableB)
	o := h.place(t, h.dineIn(s.ID, line(h.f.Plain, 1)))
	if got, err := h.porders.Get(ctx, h.scope(), o.ID); err != nil || got.ID != o.ID {
		t.Fatalf("write with no delivery: %v", err)
	}
	if n := h.count(t, `SELECT count(*) FROM "RealtimeEvent" WHERE "aggregateId" = ANY($1)`, []string{s.ID, o.ID}); n != 3 {
		t.Errorf("facts of the undelivered writes: %d", n)
	}

	// 31: realtime never reads or writes the outbox's consumer progress.
	var pending int
	_ = h.writer.QueryRow(ctx, `SELECT count(*) FROM "OutboxEvent" WHERE "aggregateId" = $1 AND "processedAt" IS NULL AND attempts = 0`, o.ID).Scan(&pending)
	if pending != 1 {
		t.Errorf("the round's outbox event was touched: %d pending", pending)
	}
	var cols []string
	rows, _ := h.writer.Query(ctx, `SELECT column_name FROM information_schema.columns WHERE table_name = 'RealtimeEvent'`)
	cols, _ = pgx.CollectRows(rows, pgx.RowTo[string])
	for _, c := range cols {
		if slices.Contains([]string{"processedAt", "attempts", "availableAt", "failedAt", "lastError"}, c) {
			t.Errorf("RealtimeEvent has consumer-progress column %s", c)
		}
	}
}

// Gap-free tailing: a fact whose transaction allocated its position early but
// commits late is delivered after it commits, never skipped.
func TestRealtimeLateCommitIsNotSkipped(t *testing.T) {
	h := realtimeSetup(t, fastConfig, 64)
	ctx := context.Background()
	staff := h.subscribe(t, h.staffToken("owner"), h.f.Venue)
	late, err := h.writer.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := realtimestore.Record(ctx, late, h.f.Venue, realtime.Fact{Type: "shift.opened", AggregateType: "shift",
		AggregateID: "late-shift", Payload: map[string]any{"shiftId": "late-shift", "status": "open", "terminalId": nil}}); err != nil {
		t.Fatal(err)
	}
	// A later transaction commits first; while the early one is open,
	// nothing after it may be delivered out from under it.
	h.openSession(t, h.f.TableC)
	staff.quiet(300 * time.Millisecond)
	if err := late.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	got := staff.until(5*time.Second, func(es []envelope) bool { return len(es) >= 2 })
	if !slices.Equal(types(got), []string{"shift.opened", "table_session.opened"}) {
		t.Errorf("delivered %v", types(got))
	}
}

// 25: a subscriber that stops reading is cut off; canonical writes and the
// subscribers that keep up are unaffected.
func TestRealtimeSlowSubscriber(t *testing.T) {
	h := realtimeSetup(t, fastConfig, 32)
	ctx := context.Background()
	fast := h.subscribe(t, h.staffToken("owner"), h.f.Venue)
	// A subscription nobody drains, next to the live one.
	stalledHub, err := h.hub.Subscribe(h.f.Org, h.f.Venue, []realtime.Audience{realtime.Operations})
	if err != nil {
		t.Fatal(err)
	}
	scope := tables.Scope{OrganizationID: h.f.Org, VenueID: h.f.Venue}
	actor := tables.Actor{StaffID: h.f.Cashier, Role: "cashier"}
	start := time.Now()
	for i := 0; i < 20; i++ { // 40 facts
		s := h.openSession(t, h.f.TableA)
		if _, err := h.sessions.Cancel(ctx, scope, s.ID, s.Version, actor); err != nil {
			t.Fatal(err)
		}
	}
	writes := time.Since(start)
	if got := fast.until(10*time.Second, func(es []envelope) bool { return len(es) >= 40 }); len(got) != 40 {
		t.Errorf("the live subscriber received %d of 40", len(got))
	}
	select {
	case <-stalledHub.Done():
		if stalledHub.Reason() != realtime.EndSlow {
			t.Errorf("reason %s", stalledHub.Reason())
		}
	case <-time.After(5 * time.Second):
		t.Fatal("the stalled subscription was not cut off")
	}
	t.Logf("40 facts written in %s next to a stalled subscription", writes)

	// Over the wire: a client that stops reading, and a burst larger than
	// its socket buffers, is closed with SLOW_CONSUMER; a canonical write
	// during the burst is not slowed by it.
	dctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	conn, _, err := websocket.Dial(dctx, h.wsURL, &websocket.DialOptions{HTTPHeader: http.Header{"Authorization": {"Bearer " + h.staffToken("owner")}}})
	if err != nil {
		t.Fatal(err)
	}
	defer conn.CloseNow()
	_ = conn.Write(dctx, websocket.MessageText, []byte(`{"type":"subscribe","venueId":"`+h.f.Venue+`"}`))
	if _, raw, err := conn.Read(dctx); err != nil || !strings.Contains(string(raw), `"subscribed"`) {
		t.Fatalf("stalled client: %s %v", raw, err)
	}
	err = pgx.BeginFunc(ctx, h.writer, func(tx pgx.Tx) error {
		for i := 0; i < 3000; i++ {
			id := "burst-" + testsupport.UUID()
			if _, err := realtimestore.Record(ctx, tx, h.f.Venue, realtime.Fact{Type: "shift.opened", AggregateType: "shift", AggregateID: id,
				Version: realtime.V(1), Payload: map[string]any{"shiftId": id, "status": "open", "terminalId": strings.Repeat("t", 200)}}); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	wstart := time.Now()
	h.openSession(t, h.f.TableB)
	if w := time.Since(wstart); w > time.Second {
		t.Errorf("a canonical write took %s during the burst", w)
	}
	stalled := newClient(t, conn, false)
	time.Sleep(2 * time.Second) // the burst is published while the client is not reading
	go func() {
		defer close(stalled.done)
		for {
			_, raw, err := conn.Read(context.Background())
			if err != nil {
				stalled.err = err
				return
			}
			stalled.msgs <- raw
		}
	}()
	if st := closeStatus(stalled); st != realtimeapi.CloseSlowConsumer {
		t.Errorf("stalled client closed with %d", st)
	}
	if !strings.Contains(strings.Join(stalled.frames, ""), "SLOW_CONSUMER") {
		t.Error("no SLOW_CONSUMER error was sent")
	}
}

// 27: after a disconnect, a reconnecting client resynchronises over HTTP:
// the missed facts are not replayed, and the database is the truth.
func TestRealtimeReconnectResync(t *testing.T) {
	h := realtimeSetup(t, fastConfig, 64)
	ctx := context.Background()
	first := h.subscribe(t, h.staffToken("owner"), h.f.Venue)
	s := h.openSession(t, h.f.TableA)
	first.expect("table_session.opened")
	_ = first.conn.Close(websocket.StatusNormalClosure, "")

	// While disconnected: an order and a check.
	o := h.place(t, h.dineIn(s.ID, line(h.f.Plain, 2)))
	c, _, err := h.checks.Create(ctx, h.forOrders(o.ID))
	if err != nil {
		t.Fatal(err)
	}
	time.Sleep(200 * time.Millisecond)

	second := h.subscribe(t, h.staffToken("owner"), h.f.Venue)
	second.quiet(300 * time.Millisecond) // no replay of what was missed
	// Refetch (the services the HTTP routes call) and compare with the rows.
	got, _ := h.checks.Get(ctx, h.checkScope(), c.ID)
	var total int64
	var status string
	_ = h.writer.QueryRow(ctx, `SELECT "totalCents", status::text FROM "Check" WHERE id = $1`, c.ID).Scan(&total, &status)
	if got.TotalCents != total || string(got.Status) != status || total != 1100 {
		t.Errorf("refetched %d %s, database %d %s", got.TotalCents, got.Status, total, status)
	}
	// Live again from here on.
	h.openSession(t, h.f.TableB)
	second.expect("table_session.opened")
}

// Connections outlive the server's read/write timeouts; a revoked tablet
// and an expiring token are cut off.
func TestRealtimeConnectionLifetime(t *testing.T) {
	h := realtimeSetup(t, fastConfig, 64)
	ctx := context.Background()
	staff := h.subscribe(t, h.staffToken("owner"), h.f.Venue)
	time.Sleep(1200 * time.Millisecond) // > ReadTimeout and WriteTimeout (500ms)
	h.openSession(t, h.f.TableA)
	staff.expect("table_session.opened")

	short := sign(jwt.MapClaims{"sub": h.f.Owner, "role": "owner", "organizationId": h.f.Org, "exp": time.Now().Add(1500 * time.Millisecond).Unix()})
	expiring := h.subscribe(t, short, h.f.Venue)
	if st := closeStatus(expiring); st != realtimeapi.CloseUnauthenticated || !strings.Contains(strings.Join(expiring.frames, ""), "TOKEN_EXPIRED") {
		t.Errorf("expiry closed with %d", st)
	}

	_, kdsDevice := h.enrollDevice(t, devices.KindKDS, h.f.Venue)
	kds := h.subscribe(t, kdsDevice, h.f.Venue)
	id, _, _ := devices.ParseCredential(kdsDevice)
	d, _ := h.devices.GetDevice(ctx, devices.Scope{OrganizationID: h.f.Org, VenueID: h.f.Venue}, id)
	if _, _, err := h.devices.Revoke(ctx, devices.Change{Scope: devices.Scope{OrganizationID: h.f.Org, VenueID: h.f.Venue},
		ID: id, ExpectedVersion: d.Version, Actor: devices.Actor{StaffID: h.f.Owner, Role: "owner"}}); err != nil {
		t.Fatal(err)
	}
	if st := closeStatus(kds); st != realtimeapi.CloseUnauthenticated {
		t.Errorf("revoked device closed with %d", st)
	}
}

// 33: draining refuses new connections, closes open ones with 1001 and
// leaks no goroutines.
func TestRealtimeShutdown(t *testing.T) {
	h := realtimeSetup(t, fastConfig, 64)
	baseline := runtime.NumGoroutine()
	var clients []*wsClient
	for i := 0; i < 10; i++ {
		clients = append(clients, h.subscribe(t, h.staffToken("owner"), h.f.Venue))
	}
	dctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	h.handler.Drain(dctx)
	for _, c := range clients {
		if st := closeStatus(c); st != websocket.StatusGoingAway {
			t.Errorf("closed with %d", st)
		}
	}
	resp, err := http.Get(h.srv.URL + "/api/realtime")
	if err != nil || resp.StatusCode != http.StatusServiceUnavailable {
		t.Errorf("upgrade while draining: %v %v", err, resp)
	}
	if resp != nil {
		_ = resp.Body.Close()
	}
	http.DefaultClient.CloseIdleConnections()
	if h.hub.Count() != 0 {
		t.Errorf("%d subscriptions after drain", h.hub.Count())
	}
	deadline := time.Now().Add(3 * time.Second)
	for runtime.NumGoroutine() > baseline && time.Now().Before(deadline) {
		time.Sleep(50 * time.Millisecond)
	}
	if n := runtime.NumGoroutine(); n > baseline {
		t.Errorf("goroutines: %d after drain, %d before any connection", n, baseline)
	}
}

// 26: concurrent writes in two organizations (and two venues of one) reach
// only their own subscribers.
func TestRealtimeConcurrentIsolation(t *testing.T) {
	h := realtimeSetup(t, fastConfig, 512)
	ctx := context.Background()
	other := testsupport.SeedOrdersFixture(t, ctx, h.writer) // a second organization
	otherToken := sign(jwt.MapClaims{"sub": other.Owner, "role": "owner", "organizationId": other.Org})
	a := h.subscribe(t, h.staffToken("owner"), h.f.Venue)
	b := h.subscribe(t, h.staffToken("owner"), h.f.TaxlessVenue)
	x := h.subscribe(t, otherToken, other.Venue)
	otherSessions := h.sessions
	var wg sync.WaitGroup
	open := func(org, venue, table, staff string) {
		defer wg.Done()
		for i := 0; i < 10; i++ {
			s, _, err := otherSessions.Open(ctx, tables.OpenCommand{Scope: tables.Scope{OrganizationID: org, VenueID: venue},
				TableID: table, Covers: 2, RequestKey: key(), Actor: tables.Actor{StaffID: staff, Role: "cashier"}})
			if err != nil {
				t.Error(err)
				return
			}
			if _, err := otherSessions.Cancel(ctx, tables.Scope{OrganizationID: org, VenueID: venue}, s.ID, s.Version, tables.Actor{StaffID: staff, Role: "cashier"}); err != nil {
				t.Error(err)
				return
			}
		}
	}
	wg.Add(3)
	go open(h.f.Org, h.f.Venue, h.f.TableA, h.f.Cashier)
	go open(h.f.Org, h.f.TaxlessVenue, h.f.TaxlessTable, h.f.Cashier)
	go open(other.Org, other.Venue, other.TableA, other.Cashier)
	wg.Wait()
	for name, c := range map[string]struct {
		client     *wsClient
		org, venue string
	}{"A": {a, h.f.Org, h.f.Venue}, "B": {b, h.f.Org, h.f.TaxlessVenue}, "X": {x, other.Org, other.Venue}} {
		got := c.client.until(10*time.Second, func(es []envelope) bool { return len(es) >= 20 })
		for _, e := range got {
			if e.VenueID != c.venue || e.OrganizationID != c.org {
				t.Errorf("%s received %s of %s/%s", name, e.EventType, e.OrganizationID, e.VenueID)
			}
		}
		c.client.quiet(200 * time.Millisecond)
	}
}
