package parity

// Phase D3 parity: GENERIC restaurant order behaviour, the running NestJS
// order path (POST /api/admin/orders) against Servvia Core's canonical order
// API (POST /api/venues/{venueId}/orders), plus the transitional occupancy
// bridge between Nest table orders and Servvia table sessions.
//
// Compared: priced lines and totals, status, service mode, modifier
// validation, quantity, venue overrides, stale price, invalid and
// unavailable products (status and body), idempotent replay and key reuse,
// organization isolation. Deliberately NOT compared (legacy transport, or
// different by design; see docs/migration/README.md, Phase D3):
// posSyncStatus/posSyncRecord, IdealPOS delivery, connector commands, KDS
// delivery rows, printer jobs; guests (visit covers live on the session);
// source (`staff` is legacy, Go records the surface); ids and timestamps;
// the replay status (Nest 201, Go 200); the extra `code`/`orderId` on Go
// conflicts; KDS rights (Nest lets `kitchen` order, Go does not); and the
// organization-isolation status (Nest 403, Go 404).

import (
	"context"
	"encoding/json"
	"net/http"
	"reflect"
	"regexp"
	"sort"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"servvia/services/core-platform/internal/pricing"
	"servvia/services/core-platform/tests/testsupport"
)

// canonicalOrder is what both implementations must agree on.
type canonicalOrder struct {
	Status        string       `json:"status"`
	ServiceMode   string       `json:"serviceMode"`
	TableID       *string      `json:"tableId"`
	SubtotalCents int64        `json:"subtotalCents"`
	TaxCents      int64        `json:"taxCents"`
	TotalCents    int64        `json:"totalCents"`
	Items         []pricedLine `json:"items"`
}

func canonicalOf(t *testing.T, body []byte) canonicalOrder {
	t.Helper()
	var o canonicalOrder
	if err := json.Unmarshal(body, &o); err != nil {
		t.Fatalf("not an order: %s", body)
	}
	for i := range o.Items {
		if o.Items[i].SelectedModifiers == nil {
			o.Items[i].SelectedModifiers = []pricing.PricedModifier{}
		}
	}
	sort.SliceStable(o.Items, func(i, j int) bool { return o.Items[i].MenuItemID < o.Items[j].MenuItemID })
	return o
}

// orderParity: both services, the seeded owner, a pricing fixture in the
// seeded organization, and fresh tables at its venue.
type orderParity struct {
	e      env
	goURL  string
	tok    tokens
	f      testsupport.PricingFixture
	tables []string
	writer *pgxpool.Pool
}

func setupOrderParity(t *testing.T, tableCount int) orderParity {
	e := loadEnv(t)
	dbURL := testsupport.DisposableDatabaseURL(t)
	ctx := context.Background()
	writer, err := pgxpool.New(ctx, dbURL)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(writer.Close)
	tok := nestTokens(t, e)
	var orgID string
	if err := writer.QueryRow(ctx, `SELECT "organizationId" FROM "Venue" WHERE id = $1`, e.venue).Scan(&orgID); err != nil {
		t.Fatal(err)
	}
	f := testsupport.SeedPricingFixture(t, ctx, writer, orgID, tok.ownerID)
	p := orderParity{e: e, goURL: goServerWith(t, dbURL, e.secret, true).URL, tok: tok, f: f, writer: writer}
	for i := 0; i < tableCount; i++ {
		id := testsupport.UUID()
		if _, err := writer.Exec(ctx, `INSERT INTO "Table"(id,"venueId","tableNumber",capacity,"sortOrder","updatedAt") VALUES($1,$2,$3,4,$4,now())`,
			id, f.Venue, "P"+id[:6], i); err != nil {
			t.Fatal(err)
		}
		p.tables = append(p.tables, id)
	}
	// Runs before the fixture's own cleanup: orders (Nest's and Go's), then
	// sessions and tables, then everything else referencing the venues.
	t.Cleanup(func() {
		venues := []string{f.Venue, f.TaxlessVenue}
		orderIDs := ids(t, writer, `SELECT id FROM "Order" WHERE "venueId" = ANY($1)`, venues)
		itemIDs := ids(t, writer, `SELECT id FROM "OrderItem" WHERE "orderId" = ANY($1)`, orderIDs)
		deleteReferencing(t, writer, "OrderItem", itemIDs)
		deleteReferencing(t, writer, "Order", orderIDs)
		for _, q := range []struct {
			sql string
			ids []string
		}{
			{`DELETE FROM "OrderItem" WHERE "orderId" = ANY($1)`, orderIDs},
			{`DELETE FROM "Order" WHERE id = ANY($1)`, orderIDs},
			{`DELETE FROM "TableSession" WHERE "tableId" = ANY($1)`, p.tables},
			{`DELETE FROM "Table" WHERE id = ANY($1)`, p.tables},
			{`DELETE FROM "RealtimeEvent" WHERE "venueId" = ANY($1)`, venues},
		} {
			if _, err := writer.Exec(ctx, q.sql, q.ids); err != nil {
				t.Errorf("cleanup: %v", err)
			}
		}
		deleteOrdersOf(t, writer, venues...)
	})
	return p
}

func ids(t *testing.T, db *pgxpool.Pool, sql string, arg []string) []string {
	rows, err := db.Query(context.Background(), sql, arg)
	if err != nil {
		t.Errorf("cleanup: %v", err)
		return nil
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var id string
		_ = rows.Scan(&id)
		out = append(out, id)
	}
	return out
}

func (p orderParity) nest(t *testing.T, token string, body map[string]any) response {
	return call(t, http.MethodPost, p.e.nest+"/api/admin/orders", token, body)
}

func (p orderParity) goCreate(t *testing.T, token, venue string, body map[string]any) response {
	return call(t, http.MethodPost, p.goURL+"/api/venues/"+venue+"/orders", token, body)
}

func items(lines ...map[string]any) []map[string]any {
	if lines == nil {
		return []map[string]any{}
	}
	return lines
}

func item(id string, qty int, mods ...[2]string) map[string]any {
	it := map[string]any{"menuItemId": id, "quantity": qty}
	var sel []map[string]string
	for _, m := range mods {
		sel = append(sel, map[string]string{"modifierGroupId": m[0], "optionId": m[1]})
	}
	if sel != nil {
		it["selectedModifiers"] = sel
	}
	return it
}

// takeaway builds one request for each API, each with its OWN idempotency
// key: Nest and Go share one (venueId, idempotencyKey) namespace, so reusing
// a key across them is a key reuse (TestIdempotencyNamespaceIsShared).
func (p orderParity) takeaway(lines []map[string]any) (nest, goBody map[string]any) {
	return map[string]any{"venueId": p.f.Venue, "serviceMode": "takeaway", "idempotencyKey": freshKey(), "items": lines},
		map[string]any{"source": "pos_terminal", "serviceMode": "takeaway", "idempotencyKey": freshKey(), "items": lines}
}

func freshKey() string { return "d3-parity-" + testsupport.UUID() }

var takeawayRef = regexp.MustCompile(`^TA-\d{6,}$`)

func keyReuseMessage(key string) string {
	return `idempotencyKey "` + key + `" was already used to create a different order`
}

func TestOrderParity(t *testing.T) {
	p := setupOrderParity(t, 0)
	f, staff := p.f, p.tok.staff
	withExpected := func(it map[string]any, cents int) map[string]any { it["expectedUnitPriceCents"] = cents; return it }

	cases := []struct {
		name  string
		lines []map[string]any
	}{
		{"normal item", items(item(f.Plain, 1))},
		{"venue price override", items(item(f.Override, 1))},
		{"quantity and modifiers", items(item(f.Burger, 3, [2]string{f.Size, f.Large}, [2]string{f.Extras, f.Cheese}), item(f.Plain, 2))},
		{"negative and zero deltas", items(item(f.Burger, 1, [2]string{f.Size, f.Small}, [2]string{f.Extras, f.Sauce}, [2]string{f.Extras, f.Pickles}))},
		{"GST rounding", items(item(f.Odd, 1), item(f.Four, 2))},
		{"expected price matches", items(withExpected(item(f.Burger, 1, [2]string{f.Size, f.Large}), 2050))},
		{"stale price", items(withExpected(item(f.Burger, 1, [2]string{f.Size, f.Large}), 1800))},
		{"stale: the override wins over the item price", items(withExpected(item(f.Override, 1), 1000))},
		{"invalid product", items(item(testsupport.UUID(), 1))},
		{"another organization's product", items(item(f.OtherOrgItem, 1))},
		{"deleted product", items(item(f.Deleted, 1))},
		{"unavailable product", items(item(f.Off, 1))},
		{"unavailable at this venue", items(item(f.OffHere, 1))},
		{"option of another group", items(item(f.Burger, 1, [2]string{f.Size, f.Cheese}))},
		{"unknown modifier group", items(item(f.Burger, 1, [2]string{testsupport.UUID(), f.Large}))},
		{"missing required modifier", items(item(f.Burger, 1))},
		{"too many in a group", items(item(f.Burger, 1, [2]string{f.Size, f.Small}, [2]string{f.Size, f.Large}))},
		{"duplicate option", items(item(f.Burger, 1, [2]string{f.Size, f.Small}, [2]string{f.Size, f.Small}))},
		{"unavailable modifier", items(item(f.Burger, 1, [2]string{f.Size, f.Small}, [2]string{f.Extras, f.Truffle}))},
		{"modifier on an item without groups", items(item(f.NoGroups, 1, [2]string{f.Size, f.Large}))},
		{"no lines", items()},
	}
	accepted, rejected := 0, 0
	for _, c := range cases {
		nestBody, goBody := p.takeaway(c.lines)
		nest, goRes := p.nest(t, staff, nestBody), p.goCreate(t, staff, f.Venue, goBody)
		if nest.status == http.StatusCreated {
			if goRes.status != http.StatusCreated {
				t.Errorf("%s: nest created, go %d %s", c.name, goRes.status, goRes.body)
				continue
			}
			if n, g := canonicalOf(t, nest.body), canonicalOf(t, goRes.body); !reflect.DeepEqual(n, g) {
				t.Errorf("%s: orders differ\nnest=%+v\ngo=  %+v", c.name, n, g)
			}
			if ref := field(t, goRes, "takeawayReference"); !takeawayRef.MatchString(ref) {
				t.Errorf("%s: takeaway reference %q", c.name, ref)
			}
			accepted++
			continue
		}
		var n, g map[string]any
		_ = json.Unmarshal(nest.body, &n)
		_ = json.Unmarshal(goRes.body, &g)
		if nest.status != goRes.status || !reflect.DeepEqual(n, g) {
			t.Errorf("%s: nest=%d %s\n          go=%d %s", c.name, nest.status, nest.body, goRes.status, goRes.body)
		}
		rejected++
	}

	// Idempotency: the same request replays the original order; a different
	// request with the key is refused with the same message, creating nothing.
	nestBody, goBody := p.takeaway(items(item(f.Plain, 1)))
	nestFirst, goFirst := p.nest(t, staff, nestBody), p.goCreate(t, staff, f.Venue, goBody)
	nestAgain, goAgain := p.nest(t, staff, nestBody), p.goCreate(t, staff, f.Venue, goBody)
	if field(t, nestAgain, "id") != field(t, nestFirst, "id") || field(t, goAgain, "id") != field(t, goFirst, "id") ||
		nestAgain.status != http.StatusCreated || goAgain.status != http.StatusOK {
		t.Errorf("replay: nest %d %s, go %d %s", nestAgain.status, nestAgain.body, goAgain.status, goAgain.body)
	}
	nestBody["items"], goBody["items"] = items(item(f.Plain, 2)), items(item(f.Plain, 2))
	nestConflict, goConflict := p.nest(t, staff, nestBody), p.goCreate(t, staff, f.Venue, goBody)
	if nestConflict.status != http.StatusConflict || goConflict.status != http.StatusConflict ||
		field(t, nestConflict, "message") != keyReuseMessage(nestBody["idempotencyKey"].(string)) ||
		field(t, goConflict, "message") != keyReuseMessage(goBody["idempotencyKey"].(string)) {
		t.Errorf("key reuse: nest %d %s, go %d %s", nestConflict.status, nestConflict.body, goConflict.status, goConflict.body)
	}
	for _, b := range []map[string]any{nestBody, goBody} {
		var n int
		_ = p.writer.QueryRow(context.Background(), `SELECT count(*) FROM "Order" WHERE "idempotencyKey" = $1`, b["idempotencyKey"]).Scan(&n)
		if n != 1 {
			t.Errorf("%d orders hold key %s", n, b["idempotencyKey"])
		}
	}

	// Organization isolation: both refuse a venue of another organization,
	// and create nothing there.
	mf := testsupport.SeedMenuFixture(t, context.Background(), p.writer)
	otherNest, otherGo := p.takeaway(items(item(f.Plain, 1)))
	otherNest["venueId"] = mf.Venue
	if nr, gr := p.nest(t, staff, otherNest), p.goCreate(t, staff, mf.Venue, otherGo); nr.status != http.StatusForbidden || gr.status != http.StatusNotFound {
		t.Errorf("another org's venue: nest %d, go %d", nr.status, gr.status)
	}
	// Venue isolation for device tokens: a KDS token is pinned to its venue in
	// both, and Servvia Core additionally does not let a KDS order at all.
	kdsNest, kdsGo := p.takeaway(items(item(f.Plain, 1)))
	if nr, gr := p.nest(t, p.tok.kds, kdsNest), p.goCreate(t, p.tok.kds, f.Venue, kdsGo); nr.status != http.StatusForbidden || gr.status != http.StatusForbidden {
		t.Errorf("KDS token at another venue: nest %d %s, go %d %s", nr.status, nr.body, gr.status, gr.body)
	}
	t.Logf("%d requests priced identically, %d refused identically", accepted, rejected)
}

// Nest and Servvia Core write the same "Order" table under one
// (venueId, idempotencyKey) unique index: a key is used once per venue,
// whichever implementation used it first. Reusing it from the other side is a
// key reuse, answered with the NestJS message, and never a second order.
func TestIdempotencyNamespaceIsShared(t *testing.T) {
	p := setupOrderParity(t, 0)
	f, staff := p.f, p.tok.staff
	key := freshKey()

	nestFirst := p.nest(t, staff, map[string]any{"venueId": f.Venue, "serviceMode": "takeaway", "idempotencyKey": key,
		"items": items(item(f.Plain, 1))})
	if nestFirst.status != http.StatusCreated {
		t.Fatalf("nest create: %d %s", nestFirst.status, nestFirst.body)
	}
	// Go, same key, same cart: still a different request (source differs:
	// Nest recorded the legacy `staff`), so a conflict naming Nest's order.
	goSame := p.goCreate(t, staff, f.Venue, map[string]any{"source": "pos_terminal", "serviceMode": "takeaway",
		"idempotencyKey": key, "items": items(item(f.Plain, 1))})
	if goSame.status != http.StatusConflict || field(t, goSame, "message") != keyReuseMessage(key) ||
		field(t, goSame, "orderId") != field(t, nestFirst, "id") || field(t, goSame, "code") != "IDEMPOTENCY_CONFLICT" {
		t.Errorf("go reusing nest's key: %d %s", goSame.status, goSame.body)
	}

	// And the other way: a key Go used first is refused by Nest.
	goKey := freshKey()
	goFirst := p.goCreate(t, staff, f.Venue, map[string]any{"source": "pos_terminal", "serviceMode": "takeaway",
		"idempotencyKey": goKey, "items": items(item(f.Plain, 1))})
	if goFirst.status != http.StatusCreated {
		t.Fatalf("go create: %d %s", goFirst.status, goFirst.body)
	}
	nestSame := p.nest(t, staff, map[string]any{"venueId": f.Venue, "serviceMode": "takeaway", "idempotencyKey": goKey,
		"items": items(item(f.Plain, 1))})
	if nestSame.status != http.StatusConflict || field(t, nestSame, "message") != keyReuseMessage(goKey) {
		t.Errorf("nest reusing go's key: %d %s", nestSame.status, nestSame.body)
	}

	// The key is venue-scoped: the same key at another venue is a new order.
	elsewhere := p.goCreate(t, staff, f.TaxlessVenue, map[string]any{"source": "pos_terminal", "serviceMode": "takeaway",
		"idempotencyKey": goKey, "items": items(item(f.Plain, 1))})
	if elsewhere.status != http.StatusUnprocessableEntity { // the taxless venue refuses to price, but not as a key reuse
		t.Errorf("same key at another venue: %d %s", elsewhere.status, elsewhere.body)
	}

	for _, k := range []string{key, goKey} {
		var n int
		_ = p.writer.QueryRow(context.Background(), `SELECT count(*) FROM "Order" WHERE "idempotencyKey" = $1`, k).Scan(&n)
		if n != 1 {
			t.Errorf("%d orders hold key %s, want 1", n, k)
		}
	}
}

// TestOccupancyBridge: a table is occupied by a Servvia session or by a Nest
// order, never by both. Temporary, like the bridge: remove with it when table
// order creation has moved to Servvia Core.
func TestOccupancyBridge(t *testing.T) {
	const races = 20
	p := setupOrderParity(t, races+2)
	f, staff := p.f, p.tok.staff
	sessionOpen := func(table string) response {
		return call(t, http.MethodPost, p.goURL+"/api/venues/"+f.Venue+"/tables/"+table+"/sessions", staff,
			map[string]any{"covers": 2, "idempotencyKey": freshKey()})
	}
	nestDineIn := func(table string) response {
		return p.nest(t, staff, map[string]any{"venueId": f.Venue, "serviceMode": "dine_in", "tableId": table,
			"idempotencyKey": freshKey(), "items": items(item(f.Plain, 1))})
	}

	// Session first: Nest refuses the table, before and after Go orders exist.
	opened := sessionOpen(p.tables[0])
	if opened.status != http.StatusCreated {
		t.Fatalf("open: %d %s", opened.status, opened.body)
	}
	bridge := regexp.MustCompile(`has an open table session in Servvia Core`)
	if r := nestDineIn(p.tables[0]); r.status != http.StatusConflict || !bridge.Match(r.body) {
		t.Errorf("nest order on a session's table: %d %s", r.status, r.body)
	}
	sessionID := field(t, opened, "id")
	goOrder := func() response {
		return p.goCreate(t, staff, f.Venue, map[string]any{"source": "pos_terminal", "serviceMode": "dine_in",
			"tableSessionId": sessionID, "idempotencyKey": freshKey(), "items": items(item(f.Plain, 1))})
	}
	// The visit may hold several canonical orders.
	for i := 0; i < 2; i++ {
		if r := goOrder(); r.status != http.StatusCreated {
			t.Fatalf("go order %d on the session: %d %s", i+1, r.status, r.body)
		}
	}
	if r := nestDineIn(p.tables[0]); r.status != http.StatusConflict || !bridge.Match(r.body) {
		t.Errorf("nest order on a table with session orders: %d %s", r.status, r.body)
	}
	// Nest order first: Servvia refuses to open a session on the table.
	if r := nestDineIn(p.tables[1]); r.status != http.StatusCreated {
		t.Fatalf("nest order: %d %s", r.status, r.body)
	}
	if r := sessionOpen(p.tables[1]); r.status != http.StatusConflict || field(t, r, "code") != "TABLE_HAS_ACTIVE_ORDER" {
		t.Errorf("session on a Nest-occupied table: %d %s", r.status, r.body)
	}

	// Both at once, on fresh tables: exactly one side establishes occupancy,
	// every time, and the database agrees.
	sessionsWon, ordersWon := 0, 0
	for i := 0; i < races; i++ {
		table := p.tables[2+i]
		var s, o response
		var wg sync.WaitGroup
		wg.Add(2)
		start := make(chan struct{})
		// Go's open is faster than Nest's order path: stagger it so that both
		// orders of arrival happen across the runs.
		delay := time.Duration(i%5) * 5 * time.Millisecond
		go func() { defer wg.Done(); <-start; time.Sleep(delay); s = sessionOpen(table) }()
		go func() { defer wg.Done(); <-start; o = nestDineIn(table) }()
		close(start)
		wg.Wait()
		sessionOK, orderOK := s.status == http.StatusCreated, o.status == http.StatusCreated
		var sessions, legacyOrders int
		_ = p.writer.QueryRow(context.Background(), `SELECT
			(SELECT count(*) FROM "TableSession" WHERE "tableId" = $1 AND status = 'open'),
			(SELECT count(*) FROM "Order" WHERE "tableId" = $1 AND "tableSessionId" IS NULL)`, table).Scan(&sessions, &legacyOrders)
		if sessionOK == orderOK || sessions+legacyOrders != 1 {
			t.Errorf("race %d: session %d %s / nest order %d %s (db: %d sessions, %d legacy orders)",
				i, s.status, s.body, o.status, o.body, sessions, legacyOrders)
		}
		if sessionOK {
			sessionsWon++
		} else {
			ordersWon++
		}
	}
	t.Logf("occupancy races: session won %d, nest order won %d", sessionsWon, ordersWon)
	if sessionsWon == 0 || ordersWon == 0 {
		t.Errorf("only one ordering occurred in %d races: both must be exercised", races)
	}
}
