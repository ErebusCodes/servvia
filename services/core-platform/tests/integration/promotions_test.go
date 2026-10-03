package integration

// Promotions (Phase D11) against real PostgreSQL: administration, scoping,
// server-authoritative discounts on orders and rounds, GST, snapshots that
// survive promotion changes, checks and refunds that never reprice,
// idempotency, and the promotion/order races. Numbers refer to the D11
// required tests.

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"

	"servvia/services/core-platform/internal/health"
	"servvia/services/core-platform/internal/identity"
	"servvia/services/core-platform/internal/menu"
	"servvia/services/core-platform/internal/orders"
	"servvia/services/core-platform/internal/orders/ordersapi"
	orderstore "servvia/services/core-platform/internal/orders/pgstore"
	"servvia/services/core-platform/internal/payments"
	"servvia/services/core-platform/internal/platform/postgres"
	"servvia/services/core-platform/internal/pricing"
	"servvia/services/core-platform/internal/pricing/pgcatalog"
	"servvia/services/core-platform/internal/promotions"
	promotionstore "servvia/services/core-platform/internal/promotions/pgstore"
	"servvia/services/core-platform/internal/promotions/promotionsapi"
	"servvia/services/core-platform/internal/ratelimit"
	"servvia/services/core-platform/internal/server"
	"servvia/services/core-platform/internal/venues"
	"servvia/services/core-platform/tests/testsupport"
)

type promotionsHarness struct {
	refundsHarness
	promos *promotions.Service
	// porders is the order service with promotions, evaluated at clock.
	porders *orders.Service
	clock   *clock
}

type clock struct {
	mu  sync.Mutex
	now time.Time
}

func (c *clock) Now() time.Time  { c.mu.Lock(); defer c.mu.Unlock(); return c.now }
func (c *clock) Set(t time.Time) { c.mu.Lock(); c.now = t; c.mu.Unlock() }

func promotionsSetup(t *testing.T) promotionsHarness {
	h := refundsSetup(t)
	pool, err := postgres.NewPool(context.Background(), postgres.Options{URL: testsupport.DisposableDatabaseURL(t), MaxConns: 40})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	c := &clock{now: time.Now().UTC()}
	store := promotionstore.New(pool)
	return promotionsHarness{refundsHarness: h, promos: promotions.NewService(store, true), clock: c,
		porders: orders.NewService(orderstore.New(pool, func(err error) { t.Errorf("audit: %v", err) }), pgcatalog.New(pool), true).
			WithPromotions(store, c.Now)}
}

func (h promotionsHarness) pscope(venue string) promotions.Scope {
	return promotions.Scope{OrganizationID: h.f.Org, VenueID: venue}
}

func (h promotionsHarness) admin() promotions.Actor {
	return promotions.Actor{StaffID: h.f.Owner, Email: "owner@example.test", Role: "owner"}
}

func (h promotionsHarness) change(p promotions.Promotion) promotions.Change {
	return promotions.Change{Scope: h.pscope(p.VenueID), PromotionID: p.ID, ExpectedVersion: p.Version, Actor: h.admin()}
}

func percent(name string, bp int64) promotions.Terms {
	return promotions.Terms{Name: name, Kind: promotions.KindPercentage, BasisPoints: bp, Target: promotions.TargetAllItems}
}

// promotion creates and activates a promotion at venue.
func (h promotionsHarness) promotion(t *testing.T, venue string, terms promotions.Terms) promotions.Promotion {
	t.Helper()
	ctx := context.Background()
	p, created, err := h.promos.Create(ctx, promotions.CreateCommand{Scope: h.pscope(venue), Terms: terms, IdempotencyKey: key(), Actor: h.admin()})
	if err != nil || !created {
		t.Fatalf("create promotion: %v", err)
	}
	p, changed, err := h.promos.Activate(ctx, h.change(p))
	if err != nil || !changed {
		t.Fatalf("activate promotion: %v", err)
	}
	return p
}

func (h promotionsHarness) takeaway(promotionID *string, lines ...orders.LineInput) orders.CreateCommand {
	return orders.CreateCommand{Scope: h.scope(), Source: orders.SourcePOSTerminal, ServiceMode: orders.ServiceTakeaway,
		Lines: lines, PromotionID: promotionID, IdempotencyKey: key(), Actor: orders.Actor{StaffID: h.f.Cashier, Role: "cashier"}}
}

func (h promotionsHarness) place(t *testing.T, cmd orders.CreateCommand) orders.Order {
	t.Helper()
	o, created, err := h.porders.Create(context.Background(), cmd)
	if err != nil || !created {
		t.Fatalf("create order: %v", err)
	}
	return o
}

func money(o orders.Order) [4]int64 {
	return [4]int64{o.SubtotalCents, o.DiscountCents, o.TaxCents, o.TotalCents}
}

func reasonOf(err error) promotions.Reason {
	var na *promotions.NotApplicableError
	if errors.As(err, &na) {
		return na.Reason
	}
	return ""
}

// 1, 2, 3, 7, 8 and audit: administration, scoping, lifecycle, versions.
func TestPromotionAdministration(t *testing.T) {
	h := promotionsSetup(t)
	ctx := context.Background()
	k := key()
	cmd := promotions.CreateCommand{Scope: h.pscope(h.f.Venue), IdempotencyKey: k, Actor: h.admin(),
		Terms: promotions.Terms{Name: " Happy hour ", Kind: promotions.KindPercentage, BasisPoints: 2000,
			Target: promotions.TargetCategories, CategoryIDs: []string{h.f.Drinks}}}
	p, created, err := h.promos.Create(ctx, cmd)
	if err != nil || !created || p.Status != promotions.StatusInactive || p.Version != 1 || p.Name != "Happy hour" || p.VenueID != h.f.Venue {
		t.Fatalf("create: %+v %v", p, err)
	}
	// A replay returns it without a second row or audit; other terms are a conflict.
	if again, created, err := h.promos.Create(ctx, cmd); err != nil || created || again.ID != p.ID {
		t.Errorf("replay: %v %v", created, err)
	}
	other := cmd
	other.Terms.BasisPoints = 2500
	var idem *promotions.IdempotencyConflictError
	if _, _, err := h.promos.Create(ctx, other); !errors.As(err, &idem) || idem.PromotionID != p.ID {
		t.Errorf("key reuse: %v", err)
	}
	// Targets must exist in the organization: another organization's item is unknown.
	bad := promotions.CreateCommand{Scope: h.pscope(h.f.Venue), IdempotencyKey: key(), Actor: h.admin(),
		Terms: promotions.Terms{Name: "x", Kind: promotions.KindPercentage, BasisPoints: 100, Target: promotions.TargetMenuItems,
			MenuItemIDs: []string{h.f.OtherOrgItem}}}
	var v *promotions.ValidationError
	if _, _, err := h.promos.Create(ctx, bad); !errors.As(err, &v) {
		t.Errorf("foreign target: %v", err)
	}
	bad.Terms.MenuItemIDs = []string{h.f.Deleted}
	if _, _, err := h.promos.Create(ctx, bad); !errors.As(err, &v) {
		t.Errorf("deleted item target: %v", err)
	}

	// 2/3: read and list are venue-scoped.
	if got, err := h.promos.Get(ctx, h.pscope(h.f.Venue), p.ID); err != nil || got.ID != p.ID {
		t.Errorf("get: %v", err)
	}
	if _, err := h.promos.Get(ctx, h.pscope(h.f.TaxlessVenue), p.ID); !errors.Is(err, promotions.ErrPromotionNotFound) {
		t.Errorf("cross-venue get: %v", err)
	}
	if list, _ := h.promos.List(ctx, h.pscope(h.f.TaxlessVenue), promotions.Filter{}); len(list) != 0 {
		t.Errorf("cross-venue list: %d", len(list))
	}
	if list, _ := h.promos.List(ctx, h.pscope(h.f.Venue), promotions.Filter{Statuses: []promotions.Status{promotions.StatusActive}}); len(list) != 0 {
		t.Errorf("active list before activation: %d", len(list))
	}

	// 7: activate / deactivate, each once; a repeat is a no-op.
	p, changed, err := h.promos.Activate(ctx, h.change(p))
	if err != nil || !changed || p.Status != promotions.StatusActive || p.Version != 2 {
		t.Fatalf("activate: %+v %v", p, err)
	}
	if again, changed, err := h.promos.Activate(ctx, promotions.Change{Scope: h.pscope(h.f.Venue), PromotionID: p.ID, ExpectedVersion: 1, Actor: h.admin()}); err != nil || changed || again.Version != 2 {
		t.Errorf("repeat activate: %v %v", changed, err)
	}
	// 8: a stale version is refused, never last-write-wins.
	name := "Renamed"
	var vc *promotions.VersionConflictError
	if _, _, err := h.promos.Update(ctx, promotions.Change{Scope: h.pscope(h.f.Venue), PromotionID: p.ID, ExpectedVersion: 1, Actor: h.admin()},
		promotions.Patch{Name: &name}); !errors.As(err, &vc) || vc.Current != 2 {
		t.Errorf("stale update: %v", err)
	}
	if _, _, err := h.promos.Deactivate(ctx, promotions.Change{Scope: h.pscope(h.f.Venue), PromotionID: p.ID, ExpectedVersion: 1, Actor: h.admin()}); !errors.As(err, &vc) {
		t.Errorf("stale deactivate: %v", err)
	}
	p, changed, err = h.promos.Update(ctx, h.change(p), promotions.Patch{Name: &name})
	if err != nil || !changed || p.Name != name || p.Version != 3 {
		t.Fatalf("update: %+v %v", p, err)
	}
	if same, changed, err := h.promos.Update(ctx, h.change(p), promotions.Patch{Name: &name}); err != nil || changed || same.Version != 3 {
		t.Errorf("identical update is a no-op: %v %v", changed, err)
	}
	p, changed, err = h.promos.Deactivate(ctx, h.change(p))
	if err != nil || !changed || p.Status != promotions.StatusInactive || p.Version != 4 {
		t.Fatalf("deactivate: %+v %v", p, err)
	}
	// Audit: one row per change, none for replays and no-ops.
	for action, want := range map[string]int{promotions.ActionCreated: 1, promotions.ActionActivated: 1,
		promotions.ActionUpdated: 1, promotions.ActionDisabled: 1} {
		if n := h.count(t, `SELECT count(*) FROM "AuditLog" WHERE resource = 'promotion' AND "resourceId" = $1 AND action = $2`, p.ID, action); n != want {
			t.Errorf("%s audits: %d", action, n)
		}
	}
	if n := h.count(t, `SELECT count(*) FROM "Promotion" WHERE "venueId" = $1`, h.f.Venue); n != 1 {
		t.Errorf("promotions: %d", n)
	}
	// Nothing is deletable: a used promotion is restricted by its snapshots
	// (see TestAcceptedDiscountSurvivesPromotionChanges); no API deletes.
}

// 9: concurrent writers with the same version: exactly one wins. Duplicate
// concurrent creates make one promotion.
func TestConcurrentPromotionWrites(t *testing.T) {
	h := promotionsSetup(t)
	ctx := context.Background()
	p := h.promotion(t, h.f.Venue, percent("Ten", 1000))
	const n = 16
	errs := make([]error, n)
	changed := make([]bool, n)
	h.whileTableLocked(t, "Promotion", func() {
		race(n, func(i int) {
			bp := int64(1100 + i)
			_, changed[i], errs[i] = h.promos.Update(ctx, h.change(p), promotions.Patch{BasisPoints: &bp})
		})
	})
	wins := 0
	for i := range errs {
		var vc *promotions.VersionConflictError
		switch {
		case errs[i] == nil && changed[i]:
			wins++
		case errors.As(errs[i], &vc) && vc.Current == p.Version+1:
		default:
			t.Errorf("writer %d: %v %v", i, changed[i], errs[i])
		}
	}
	got, _ := h.promos.Get(ctx, h.pscope(h.f.Venue), p.ID)
	if wins != 1 || got.Version != p.Version+1 {
		t.Errorf("%d winners, version %d", wins, got.Version)
	}
	if n := h.count(t, `SELECT count(*) FROM "AuditLog" WHERE "resourceId" = $1 AND action = 'PROMOTION_UPDATED'`, p.ID); n != 1 {
		t.Errorf("update audits: %d", n)
	}

	cmd := promotions.CreateCommand{Scope: h.pscope(h.f.Venue), Terms: percent("Dup", 500), IdempotencyKey: key(), Actor: h.admin()}
	ids := make([]string, n)
	h.whileTableLocked(t, "Promotion", func() {
		race(n, func(i int) {
			created, _, err := h.promos.Create(ctx, cmd)
			ids[i], errs[i] = created.ID, err
		})
	})
	for i := range ids {
		if errs[i] != nil || ids[i] != ids[0] {
			t.Fatalf("creator %d: %v", i, errs[i])
		}
	}
	if n := h.count(t, `SELECT count(*) FROM "Promotion" WHERE "createRequestKey" = $1`, cmd.IdempotencyKey); n != 1 {
		t.Errorf("duplicate creates made %d", n)
	}
}

// 10, 14, 15, 16, 29 and money vectors A, B, D: the server prices the
// discount; GST is contained in the discounted total.
func TestPromotionPricesOrders(t *testing.T) {
	h := promotionsSetup(t)
	ctx := context.Background()
	ten := h.promotion(t, h.f.Venue, percent("Ten", 1000))
	drinks := h.promotion(t, h.f.Venue, promotions.Terms{Name: "Drinks", Kind: promotions.KindPercentage, BasisPoints: 2000,
		Target: promotions.TargetCategories, CategoryIDs: []string{h.f.Drinks}})

	for _, c := range []struct {
		name      string
		promotion *string
		lines     []orders.LineInput
		want      [4]int64 // subtotal, discount, tax, total
		lineDisc  []int64
	}{
		// 29: no promotion, unchanged: 1800 + 550; GST in 2350 = 306.52 -> 307.
		{"no promotion", nil, []orders.LineInput{line(h.f.Burger, 1, [2]string{h.f.Size, h.f.Small}), line(h.f.Plain, 1)},
			[4]int64{2350, 0, 307, 2350}, []int64{0, 0}},
		// 10/A/15: 10 % of 2350 = 235 (180 + 55); GST in 2115 = 275.87 -> 276.
		{"10% of everything", &ten.ID, []orders.LineInput{line(h.f.Burger, 1, [2]string{h.f.Size, h.f.Small}), line(h.f.Plain, 1)},
			[4]int64{2350, 235, 276, 2115}, []int64{180, 55}},
		// 14/B: 10 % of 1999 = 199.9 -> 200 (half up, not truncated); GST in 1799 = 234.65 -> 235.
		{"rounding", &ten.ID, []orders.LineInput{line(h.f.Odd, 1)}, [4]int64{1999, 200, 235, 1799}, []int64{200}},
		// 16/D: category Drinks only: the Soda (400) gets 80, the Burger and Chips nothing.
		// 1800 + 400 + 700 = 2900 - 80 = 2820; GST 367.83 -> 368.
		{"category only", &drinks.ID, []orders.LineInput{line(h.f.Burger, 1, [2]string{h.f.Size, h.f.Small}), line(h.f.Soda, 1), line(h.f.NoGroups, 1)},
			[4]int64{2900, 80, 368, 2820}, []int64{0, 80, 0}},
	} {
		o := h.place(t, h.takeaway(c.promotion, c.lines...))
		if money(o) != c.want {
			t.Errorf("%s: money %v, want %v", c.name, money(o), c.want)
		}
		for i, l := range o.Lines {
			if l.DiscountCents != c.lineDisc[i] || l.LineTotalCents != l.UnitPriceCents*l.Quantity {
				t.Errorf("%s: line %d %+v", c.name, i, l)
			}
			if (l.AppliedPromotionID != nil) != (c.promotion != nil && c.lineDisc[i] > 0) {
				t.Errorf("%s: line %d applied %v", c.name, i, l.AppliedPromotionID)
			}
		}
		stored, _ := h.porders.Get(ctx, h.scope(), o.ID)
		if money(stored) != c.want {
			t.Errorf("%s: stored %v", c.name, money(stored))
		}
		if c.promotion == nil {
			if len(o.Promotions) != 0 {
				t.Errorf("%s: snapshots %+v", c.name, o.Promotions)
			}
			continue
		}
		a := o.Promotions[0]
		if len(o.Promotions) != 1 || a.PromotionID != *c.promotion || a.RoundID != o.Rounds[0].ID || a.DiscountCents != c.want[1] ||
			a.Currency != "NZD" || a.Kind != "percentage" || a.PromotionVersion != 2 {
			t.Errorf("%s: snapshot %+v", c.name, o.Promotions)
		}
	}
	// The database agrees with every stored total: gross - discount = total.
	if n := h.count(t, `SELECT count(*) FROM "Order" WHERE "venueId" = $1 AND "totalCents" <> "subtotalCents" - "discountCents"`, h.f.Venue); n != 0 {
		t.Errorf("%d orders with total != gross - discount", n)
	}
	if n := h.count(t, `SELECT count(*) FROM "Order" o WHERE "venueId" = $1 AND "discountCents" <>
		(SELECT COALESCE(sum("discountCents"), 0) FROM "OrderItem" WHERE "orderId" = o.id)`, h.f.Venue); n != 0 {
		t.Errorf("%d orders whose discount is not their lines'", n)
	}
}

// 13, 17, 18, 19, 20: a promotion that cannot apply is refused and writes
// nothing.
func TestPromotionRefusals(t *testing.T) {
	h := promotionsSetup(t)
	ctx := context.Background()
	now := time.Date(2026, 10, 1, 3, 0, 0, 0, time.UTC)
	h.clock.Set(now)
	elsewhere := h.promotion(t, h.f.TaxlessVenue, percent("Elsewhere", 1000))
	window := percent("Window", 1000)
	window.StartsAt, window.EndsAt = ptrTime(now.Add(time.Hour)), ptrTime(now.Add(2*time.Hour))
	windowed := h.promotion(t, h.f.Venue, window)
	disabled := h.promotion(t, h.f.Venue, percent("Disabled", 1000))
	if _, _, err := h.promos.Deactivate(ctx, h.change(disabled)); err != nil {
		t.Fatal(err)
	}
	full := h.promotion(t, h.f.Venue, percent("Everything free", 10000))
	drinks := h.promotion(t, h.f.Venue, promotions.Terms{Name: "Drinks", Kind: promotions.KindPercentage, BasisPoints: 10000,
		Target: promotions.TargetCategories, CategoryIDs: []string{h.f.Drinks}})
	missing := testsupport.UUID()

	plain := line(h.f.Plain, 1)
	try := func(id string, at time.Time, lines ...orders.LineInput) error {
		h.clock.Set(at)
		_, _, err := h.porders.Create(ctx, h.takeaway(&id, lines...))
		return err
	}
	// 17: another venue's promotion is indistinguishable from none.
	if err := try(elsewhere.ID, now, plain); !errors.Is(err, promotions.ErrPromotionNotFound) {
		t.Errorf("other venue: %v", err)
	}
	if err := try(missing, now, plain); !errors.Is(err, promotions.ErrPromotionNotFound) {
		t.Errorf("unknown: %v", err)
	}
	for _, c := range []struct {
		name  string
		id    string
		at    time.Time
		lines []orders.LineInput
		want  promotions.Reason
	}{
		{"18 disabled", disabled.ID, now, []orders.LineInput{plain}, promotions.ReasonInactive},
		{"19 not yet started", windowed.ID, now.Add(time.Hour - time.Millisecond), []orders.LineInput{plain}, promotions.ReasonNotStarted},
		{"20 ended (end is exclusive)", windowed.ID, now.Add(2 * time.Hour), []orders.LineInput{plain}, promotions.ReasonEnded},
		{"16 nothing eligible", drinks.ID, now, []orders.LineInput{plain}, promotions.ReasonNoEligibleItems},
		// 13/C: 100 % of everything would leave nothing to pay: refused.
		{"13 total would be zero", full.ID, now, []orders.LineInput{plain, line(h.f.Soda, 1)}, promotions.ReasonZeroTotal},
	} {
		if err := try(c.id, c.at, c.lines...); reasonOf(err) != c.want {
			t.Errorf("%s: %v", c.name, err)
		}
	}
	if n := h.count(t, `SELECT count(*) FROM "Order" WHERE "venueId" = ANY($1)`, []string{h.f.Venue, h.f.TaxlessVenue}); n != 0 {
		t.Errorf("refusals wrote %d orders", n)
	}
	// Inside the window it applies; 100 % of the Drinks alone leaves the
	// coffee to pay (never negative): 550 + 400 - 400 = 550.
	if err := try(windowed.ID, now.Add(time.Hour), plain); err != nil {
		t.Errorf("in window: %v", err)
	}
	o := h.place(t, h.takeaway(&drinks.ID, plain, line(h.f.Soda, 1)))
	if money(o) != [4]int64{950, 400, 72, 550} || o.Lines[1].DiscountCents != 400 {
		t.Errorf("100%% of drinks: %v", money(o))
	}
	if n := h.count(t, `SELECT count(*) FROM "Order" WHERE "venueId" = $1 AND ("totalCents" < 0 OR "discountCents" > "subtotalCents")`, h.f.Venue); n != 0 {
		t.Error("a negative total exists")
	}
}

func ptrTime(t time.Time) *time.Time { return &t }

// 21, 22: an idempotent replay returns the accepted order and its one
// snapshot, even after the promotion changed; concurrent identical creates
// make one order and one snapshot.
func TestPromotionReplayNeverDiscountsTwice(t *testing.T) {
	h := promotionsSetup(t)
	ctx := context.Background()
	p := h.promotion(t, h.f.Venue, percent("Ten", 1000))
	cmd := h.takeaway(&p.ID, line(h.f.Plain, 2))
	o := h.place(t, cmd)
	if money(o) != [4]int64{1100, 110, 129, 990} {
		t.Fatalf("money %v", money(o))
	}
	// The promotion changes and is disabled; the replay still returns the
	// accepted order, without reading the promotion.
	bp := int64(5000)
	p, _, _ = h.promos.Update(ctx, h.change(p), promotions.Patch{BasisPoints: &bp})
	if _, _, err := h.promos.Deactivate(ctx, h.change(p)); err != nil {
		t.Fatal(err)
	}
	again, created, err := h.porders.Create(ctx, cmd)
	if err != nil || created || again.ID != o.ID || money(again) != money(o) || len(again.Promotions) != 1 {
		t.Fatalf("replay: %v %v %v", created, err, money(again))
	}
	// The same key with another promotion (or none) is a different request.
	none := cmd
	none.PromotionID = nil
	var idem *orders.IdempotencyConflictError
	if _, _, err := h.porders.Create(ctx, none); !errors.As(err, &idem) {
		t.Errorf("same key without the promotion: %v", err)
	}
	if n := h.count(t, `SELECT count(*) FROM "AppliedPromotion" WHERE "orderId" = $1`, o.ID); n != 1 {
		t.Errorf("snapshots: %d", n)
	}

	// 22: 24 identical creates at once.
	q := h.promotion(t, h.f.Venue, percent("Twelve and a half", 1250))
	race24 := h.takeaway(&q.ID, line(h.f.Odd, 1))
	const n = 24
	ids, errs := make([]string, n), make([]error, n)
	h.whileTableLocked(t, "Order", func() {
		race(n, func(i int) {
			got, _, err := h.porders.Create(ctx, race24)
			ids[i], errs[i] = got.ID, err
		})
	})
	for i := range ids {
		if errs[i] != nil || ids[i] != ids[0] {
			t.Fatalf("caller %d: %v", i, errs[i])
		}
	}
	// 12.5 % of 1999 = 249.875 -> 250, once.
	if n := h.count(t, `SELECT count(*) FROM "Order" WHERE "idempotencyKey" = $1`, race24.IdempotencyKey); n != 1 {
		t.Errorf("orders: %d", n)
	}
	if n := h.count(t, `SELECT count(*) FROM "AppliedPromotion" WHERE "orderId" = $1 AND "discountCents" = 250`, ids[0]); n != 1 {
		t.Errorf("snapshots: %d", n)
	}
}

// 23, 24: a promotion changed or disabled while an order is being placed.
// The order evaluates version V, then holds the promotion FOR SHARE and
// requires V: it commits V's configuration or is refused, never a mixture.
func TestPromotionChangeDuringOrderPlacement(t *testing.T) {
	h := promotionsSetup(t)
	ctx := context.Background()

	// Hold the promotion as an in-flight admin change would (FOR UPDATE),
	// let the order evaluate and block, then commit or roll back the change.
	during := func(p promotions.Promotion, change string, commit bool) (orders.Order, error) {
		tx, err := h.writer.Begin(ctx)
		if err != nil {
			t.Fatal(err)
		}
		defer tx.Rollback(ctx)
		if _, err := tx.Exec(ctx, `SELECT 1 FROM "Promotion" WHERE id = $1 FOR UPDATE`, p.ID); err != nil {
			t.Fatal(err)
		}
		type result struct {
			o   orders.Order
			err error
		}
		done := make(chan result, 1)
		go func() {
			o, _, err := h.porders.Create(ctx, h.takeaway(&p.ID, line(h.f.Plain, 1)))
			done <- result{o, err}
		}()
		time.Sleep(300 * time.Millisecond)
		select {
		case r := <-done:
			t.Fatalf("the order did not wait for the promotion lock: %v", r.err)
		default:
		}
		if _, err := tx.Exec(ctx, change, p.ID); err != nil {
			t.Fatal(err)
		}
		if commit {
			err = tx.Commit(ctx)
		} else {
			err = tx.Rollback(ctx)
		}
		if err != nil {
			t.Fatal(err)
		}
		r := <-done
		return r.o, r.err
	}
	orderCount := func() int { return h.count(t, `SELECT count(*) FROM "Order" WHERE "venueId" = $1`, h.f.Venue) }

	// 24: updated (10 % -> 50 %) while the order waits: refused.
	p := h.promotion(t, h.f.Venue, percent("Ten", 1000))
	if _, err := during(p, `UPDATE "Promotion" SET "basisPoints" = 5000, version = version + 1 WHERE id = $1`, true); !errors.Is(err, promotions.ErrChanged) {
		t.Errorf("updated concurrently: %v", err)
	}
	// 23: disabled while the order waits: refused.
	q := h.promotion(t, h.f.Venue, percent("Soon off", 1000))
	if _, err := during(q, `UPDATE "Promotion" SET status = 'inactive', version = version + 1 WHERE id = $1`, true); !errors.Is(err, promotions.ErrChanged) {
		t.Errorf("disabled concurrently: %v", err)
	}
	if n := orderCount(); n != 0 {
		t.Fatalf("refused orders wrote %d", n)
	}
	// The change rolled back: the order commits the configuration it evaluated.
	r := h.promotion(t, h.f.Venue, percent("Kept", 1000))
	o, err := during(r, `UPDATE "Promotion" SET "basisPoints" = 5000, version = version + 1 WHERE id = $1`, false)
	if err != nil || o.Promotions[0].BasisPoints != 1000 || o.Promotions[0].PromotionVersion != r.Version || o.DiscountCents != 55 {
		t.Fatalf("after rollback: %v %+v", err, o.Promotions)
	}

	// Through the real services, at scale: orders race a stream of updates.
	// Every committed order's snapshot is exactly one version's
	// configuration (from the audit history), and its discount is that
	// configuration's; every other order is refused with ErrChanged.
	s := h.promotion(t, h.f.Venue, percent("Flipping", 1000))
	const n = 30
	errs := make([]error, n)
	var wg sync.WaitGroup
	wg.Add(1)
	go func() {
		defer wg.Done()
		for i := 0; i < 6; i++ {
			cur, _ := h.promos.Get(ctx, h.pscope(h.f.Venue), s.ID)
			bp := int64(1000 + 1000*((i+1)%2))
			if _, _, err := h.promos.Update(ctx, h.change(cur), promotions.Patch{BasisPoints: &bp}); err != nil {
				t.Errorf("update: %v", err)
			}
			time.Sleep(15 * time.Millisecond)
		}
	}()
	race(n, func(i int) {
		time.Sleep(time.Duration(i*3) * time.Millisecond)
		_, _, errs[i] = h.porders.Create(ctx, h.takeaway(&s.ID, line(h.f.Odd, 1), line(h.f.Plain, 1)))
	})
	wg.Wait()
	bpAt := map[int]int64{}
	rows, _ := h.writer.Query(ctx, `SELECT after FROM "AuditLog" WHERE "resourceId" = $1`, s.ID)
	for rows.Next() {
		var raw []byte
		var after struct {
			Version     int   `json:"version"`
			BasisPoints int64 `json:"basisPoints"`
		}
		_ = rows.Scan(&raw)
		_ = json.Unmarshal(raw, &after)
		bpAt[after.Version] = after.BasisPoints
	}
	rows.Close()
	committed, refused := 0, 0
	for _, err := range errs {
		switch {
		case err == nil:
			committed++
		case errors.Is(err, promotions.ErrChanged):
			refused++
		default:
			t.Errorf("order: %v", err)
		}
	}
	mixed := h.count(t, `SELECT count(*) FROM "AppliedPromotion" WHERE "promotionId" = $1`, s.ID)
	if committed == 0 || mixed != committed {
		t.Fatalf("committed %d, snapshots %d", committed, mixed)
	}
	rows, _ = h.writer.Query(ctx, `SELECT "promotionVersion", "basisPoints", "eligibleSubtotalCents", "discountCents" FROM "AppliedPromotion" WHERE "promotionId" = $1`, s.ID)
	for rows.Next() {
		var version int
		var bp, eligible, discount int64
		_ = rows.Scan(&version, &bp, &eligible, &discount)
		want, _ := pricing.PercentOf(eligible, bpAt[version])
		if bp != bpAt[version] || discount != want || eligible != 2549 {
			t.Errorf("mixed configuration: version %d bp %d (history %d) discount %d (want %d)", version, bp, bpAt[version], discount, want)
		}
	}
	rows.Close()
	t.Logf("racing orders: %d committed, %d refused with PROMOTION_CHANGED", committed, refused)
}

// 25, 26, 28 and vector E: a promotion change never touches an accepted
// order; a check bills the accepted discounts; each order and round keeps
// its own snapshot.
func TestAcceptedDiscountSurvivesPromotionChanges(t *testing.T) {
	h := promotionsSetup(t)
	ctx := context.Background()
	ten := h.promotion(t, h.f.Venue, percent("Ten", 1000))
	twenty := h.promotion(t, h.f.Venue, percent("Twenty", 2000))
	s := h.openSession(t, h.f.TableA)
	dine := func(id *string, lines ...orders.LineInput) orders.Order {
		cmd := h.dineIn(s.ID, lines...)
		cmd.PromotionID = id
		return h.place(t, cmd)
	}
	// 28: two orders at one visit, each with its own promotion.
	o1 := dine(&ten.ID, line(h.f.Plain, 2))  // 1100 - 110 = 990
	o2 := dine(&twenty.ID, line(h.f.Odd, 1)) // 1999 - 400 = 1599 (399.8 -> 400)
	before1, before2 := money(o1), money(o2)
	if before1 != [4]int64{1100, 110, 129, 990} || before2 != [4]int64{1999, 400, 209, 1599} {
		t.Fatalf("placed: %v %v", before1, before2)
	}
	// E/25: the promotions change and are disabled afterwards.
	bp := int64(9000)
	upd, _, err := h.promos.Update(ctx, h.change(ten), promotions.Patch{BasisPoints: &bp})
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err := h.promos.Deactivate(ctx, h.change(twenty)); err != nil {
		t.Fatal(err)
	}
	for _, o := range []orders.Order{o1, o2} {
		got, _ := h.porders.Get(ctx, h.scope(), o.ID)
		if money(got) != money(o) || got.Promotions[0].BasisPoints != o.Promotions[0].BasisPoints {
			t.Errorf("order %s changed: %v -> %v", o.ID, money(o), money(got))
		}
	}
	// A round names the changed promotion: its own snapshot at the new
	// terms; round 1 keeps 10 %. A round without one is undiscounted.
	r2 := h.round(t, o1.ID, line(h.f.Plain, 1)) // no promotion: +550
	rc := orders.RoundCommand{Scope: h.scope(), OrderID: o1.ID, Lines: []orders.LineInput{line(h.f.Plain, 1)}, PromotionID: &upd.ID,
		RequestKey: key(), Actor: h.waiter()}
	r3, created, err := h.porders.SubmitRound(ctx, rc)
	if err != nil || !created {
		t.Fatalf("round with promotion: %v", err)
	}
	// 1100 + 550 + 550 = 2200; 110 + 0 + 495 (90 % of 550) = 605; 1595; GST 208.04 -> 208.
	if money(r3) != [4]int64{2200, 605, 208, 1595} || len(r3.Promotions) != 2 ||
		r3.Promotions[0].BasisPoints != 1000 || r3.Promotions[1].BasisPoints != 9000 || r3.Promotions[1].RoundID != r3.Rounds[2].ID {
		t.Fatalf("rounds: %v %+v", money(r3), r3.Promotions)
	}
	if len(r2.Rounds) != 2 || r2.DiscountCents != 110 {
		t.Errorf("undiscounted round: %v", money(r2))
	}
	// A round replay does not discount twice; the same key with no promotion conflicts.
	if again, created, err := h.porders.SubmitRound(ctx, rc); err != nil || created || money(again) != money(r3) {
		t.Errorf("round replay: %v %v", created, err)
	}
	rc.PromotionID = nil
	var rconf *orders.RoundConflictError
	if _, _, err := h.porders.SubmitRound(ctx, rc); !errors.As(err, &rconf) {
		t.Errorf("round key reuse without the promotion: %v", err)
	}

	// 26: the check bills the accepted amounts, including a disabled
	// promotion's, without looking up any promotion.
	c, created, err := h.checks.Create(ctx, h.forSession(s.ID))
	if err != nil || !created {
		t.Fatalf("check: %v", err)
	}
	// Gross 2200 + 1999 = 4199; discounts 605 + 400 = 1005; total 3194; GST 416.61 -> 417.
	if c.SubtotalCents != 4199 || c.DiscountCents != 1005 || c.TotalCents != 3194 || c.TaxCents != 417 {
		t.Errorf("check %d/%d/%d/%d", c.SubtotalCents, c.DiscountCents, c.TaxCents, c.TotalCents)
	}
	var lineDiscounts int64
	for _, l := range c.Lines {
		lineDiscounts += l.DiscountCents
	}
	if lineDiscounts != 1005 || h.count(t, `SELECT count(*) FROM "CheckLine" cl JOIN "OrderItem" i ON i.id = cl."orderItemId"
		WHERE cl."checkId" = $1 AND cl."discountCents" <> i."discountCents"`, c.ID) != 0 {
		t.Error("check lines are not the order lines' accepted discounts")
	}
	// A used promotion cannot be deleted: history restricts it.
	if _, err := h.writer.Exec(ctx, `DELETE FROM "Promotion" WHERE id = $1`, ten.ID); err == nil || !strings.Contains(err.Error(), "AppliedPromotion") {
		t.Errorf("deleting a used promotion: %v", err)
	}
}

// 27: a refund returns money from a payment; it never re-evaluates the
// promotion, and the check's discounted obligation stays what it was.
func TestRefundDoesNotReprice(t *testing.T) {
	h := promotionsSetup(t)
	ctx := context.Background()
	p := h.promotion(t, h.f.Venue, percent("Ten", 1000))
	s := h.openSession(t, h.f.TableB)
	cmd := h.dineIn(s.ID, line(h.f.Burger, 1, [2]string{h.f.Size, h.f.Small}), line(h.f.Plain, 1))
	cmd.PromotionID = &p.ID
	o := h.place(t, cmd)
	c, _, err := h.checks.Create(ctx, h.forOrders(o.ID))
	if err != nil || c.TotalCents != 2115 || c.DiscountCents != 235 {
		t.Fatalf("check: %v %d", err, c.TotalCents)
	}
	pay := h.pay(t, c.ID, c.TotalCents)
	h.mustReport(t, pay.ID, payments.StatusSucceeded)
	// The promotion is changed and disabled after payment.
	bp := int64(5000)
	p, _, _ = h.promos.Update(ctx, h.change(p), promotions.Patch{BasisPoints: &bp})
	if _, _, err := h.promos.Deactivate(ctx, h.change(p)); err != nil {
		t.Fatal(err)
	}
	r := h.refund(t, pay.ID, 500)
	h.mustRefundResult(t, r.ID, payments.StatusSucceeded)
	after, err := h.checks.Get(ctx, h.checkScope(), c.ID)
	if err != nil || after.SubtotalCents != 2350 || after.DiscountCents != 235 || after.TotalCents != 2115 || after.TaxCents != 276 {
		t.Errorf("check after refund: %+v %v", after, err)
	}
	if sum, b := h.summary(t, c.ID); sum.CheckStatus != "open" || b.PaidCents != 1615 || b.BalanceCents != 500 {
		t.Errorf("after a 500 refund: %s paid %d balance %d", sum.CheckStatus, b.PaidCents, b.BalanceCents)
	}
	got, _ := h.porders.Get(ctx, h.scope(), o.ID)
	if money(got) != money(o) {
		t.Errorf("order repriced: %v", money(got))
	}
	// The settled check was not re-billed: one standing check line per order line.
	if n := h.count(t, `SELECT count(*) FROM "Check" WHERE "venueId" = $1`, h.f.Venue); n != 1 {
		t.Errorf("checks: %d", n)
	}
}

// 30, 31: an order the NestJS path writes (no discount column, no round)
// reads back with discount 0 and bills unchanged; promotion orders create
// no external-POS state.
func TestNestOrdersAndNoExternalPOSState(t *testing.T) {
	h := promotionsSetup(t)
	ctx := context.Background()
	nest := "ORD-NEST-" + testsupport.UUID()[:8]
	// The NestJS insert names no discount column: the default applies.
	if _, err := h.writer.Exec(ctx, `INSERT INTO "Order"(id,"venueId","subtotalCents","taxCents","totalCents",source,"idempotencyKey",status,"posSyncStatus","updatedAt")
		VALUES($1,$2,1750,228,1750,'staff',$3,'confirmed','queued_for_connector',now())`, nest, h.f.Venue, key()); err != nil {
		t.Fatal(err)
	}
	if _, err := h.writer.Exec(ctx, `INSERT INTO "OrderItem"(id,"orderId","menuItemId","menuItemTitle","menuItemCategory","unitPriceCents",quantity,"lineTotalCents")
		VALUES($1,$2,$3,'Burger','Mains',1800,1,1800),($4,$2,$3,'Credit','Mains',-50,1,-50)`, testsupport.UUID(), nest, h.f.Burger, testsupport.UUID()); err != nil {
		t.Fatal(err)
	}
	o, err := h.porders.Get(ctx, h.scope(), nest)
	if err != nil || money(o) != [4]int64{1750, 0, 228, 1750} || len(o.Promotions) != 0 || o.Lines[1].DiscountCents != 0 || o.Lines[1].AppliedPromotionID != nil {
		t.Fatalf("nest order: %v %+v", err, o)
	}
	// An order without a promotion is exactly what D3 wrote.
	plain := h.place(t, h.takeaway(nil, line(h.f.Plain, 1)))
	if money(plain) != [4]int64{550, 0, 72, 550} {
		t.Errorf("plain order %v", money(plain))
	}
	p := h.promotion(t, h.f.Venue, percent("Ten", 1000))
	promoted := h.place(t, h.takeaway(&p.ID, line(h.f.Plain, 1)))
	for _, q := range []string{
		`SELECT count(*) FROM "POSSyncRecord" WHERE "orderId" = $1`,
		`SELECT count(*) FROM "NativeTableRound" WHERE "orderId" = $1`,
		`SELECT count(*) FROM "KdsDeliveryRecord" WHERE "orderId" = $1`,
		`SELECT count(*) FROM "PrinterJob" WHERE "orderId" = $1`,
		`SELECT count(*) FROM "ConnectorCommand" WHERE payload::text LIKE '%' || $1 || '%'`,
		`SELECT count(*) FROM "Order" WHERE id = $1 AND "posSyncStatus" <> 'not_applicable'`,
	} {
		if n := h.count(t, q, promoted.ID); n != 0 {
			t.Errorf("%s: %d", q, n)
		}
	}
}

// 4, 5, 6, 12 over HTTP, with contract validation.
func TestPromotionHTTP(t *testing.T) {
	h := promotionsSetup(t)
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
		Menu:       menu.NewHandler(menu.NewPostgresStore(pool), logger),
		Venues:     venues.NewHandler(venueStore, logger),
		Orders:     ordersapi.NewHandler(h.porders, venueStore, logger),
		Promotions: promotionsapi.NewHandler(h.promos, venueStore, logger),
		Verifier:   identity.NewVerifier(secret), TabletDevices: identity.NewPostgresTabletDevices(pool), VenueGrants: identity.NewPostgresVenueGrants(pool), StaffSessions: admitStaff,
		RateLimiter: ratelimit.New(admitAll{}, 0, logger),
	})
	sign := func(c jwt.MapClaims) string {
		c["exp"], c["sid"] = time.Now().Add(time.Minute).Unix(), testsupport.UUID()
		s, _ := jwt.NewWithClaims(jwt.SigningMethodHS256, c).SignedString([]byte(secret))
		return s
	}
	owner := sign(jwt.MapClaims{"sub": h.f.Owner, "email": "o@example.test", "role": "owner", "organizationId": h.f.Org})
	cashier := sign(jwt.MapClaims{"sub": h.f.Cashier, "email": "c@example.test", "role": "cashier", "organizationId": h.f.Org})
	kds := sign(jwt.MapClaims{"sub": "kds-device:" + h.f.Venue, "role": "kitchen", "organizationId": h.f.Org, "venueId": h.f.Venue, "kind": "kds_device"})
	tabletManager := sign(jwt.MapClaims{"sub": h.f.Owner, "role": "manager", "organizationId": h.f.Org, "venueId": h.f.Venue,
		"kind": "tablet_manager", "deviceId": testsupport.UUID()})
	otherOrg := sign(jwt.MapClaims{"sub": testsupport.UUID(), "role": "owner", "organizationId": h.f.OtherOrg})
	call := func(tok, method, path string, body any) (int, []byte) {
		var reader io.Reader
		if body != nil {
			raw, _ := json.Marshal(body)
			reader = strings.NewReader(string(raw))
		}
		req := httptest.NewRequest(method, "/api/venues/"+h.f.Venue+path, reader)
		req.Header.Set("Authorization", "Bearer "+tok)
		rec := httptest.NewRecorder()
		routes.ServeHTTP(rec, req)
		return rec.Code, rec.Body.Bytes()
	}
	create := map[string]any{"name": "Happy hour", "kind": "percentage", "basisPoints": 1500, "target": "categories",
		"categoryIds": []string{h.f.Drinks}, "startsAt": "2026-01-01T00:00:00+13:00", "idempotencyKey": key()}

	// 5, 6, 4: who may administer.
	for name, c := range map[string]struct {
		tok, method, path string
		want              int
	}{
		"cashier creates":            {cashier, "POST", "/promotions", 403},
		"KDS creates":                {kds, "POST", "/promotions", 403},
		"KDS lists":                  {kds, "GET", "/promotions", 403},
		"elevated tablet creates":    {tabletManager, "POST", "/promotions", 403},
		"other organization lists":   {otherOrg, "GET", "/promotions", 404},
		"other organization creates": {otherOrg, "POST", "/promotions", 404},
		"cashier lists":              {cashier, "GET", "/promotions", 200},
	} {
		if status, body := call(c.tok, c.method, c.path, create); status != c.want {
			t.Errorf("%s: %d %s", name, status, body)
		}
	}
	promotionSchema := testsupport.Schema(t, "openapi/promotions.yaml", "/components/schemas/Promotion")
	status, body := call(owner, "POST", "/promotions", create)
	if status != 201 {
		t.Fatalf("create: %d %s", status, body)
	}
	testsupport.Validate(t, promotionSchema, body)
	var p struct {
		ID       string `json:"id"`
		Version  int    `json:"version"`
		StartsAt string `json:"startsAt"`
		Status   string `json:"status"`
	}
	_ = json.Unmarshal(body, &p)
	if p.StartsAt != "2025-12-31T11:00:00.000Z" || p.Status != "inactive" {
		t.Errorf("created %s", body)
	}
	if status, _ := call(owner, "POST", "/promotions", create); status != 200 {
		t.Errorf("replay: %d", status)
	}
	for name, bad := range map[string]map[string]any{
		"fixed amount":      {"name": "x", "kind": "fixed_amount", "basisPoints": 100, "target": "all_items", "idempotencyKey": key()},
		"a code":            {"name": "x", "kind": "percentage", "basisPoints": 100, "target": "all_items", "code": "VERDURA10", "idempotencyKey": key()},
		"stacking":          {"name": "x", "kind": "percentage", "basisPoints": 100, "target": "all_items", "stackable": true, "idempotencyKey": key()},
		"a local timestamp": {"name": "x", "kind": "percentage", "basisPoints": 100, "target": "all_items", "startsAt": "2026-01-01T10:00:00", "idempotencyKey": key()},
		"fractional rate":   {"name": "x", "kind": "percentage", "basisPoints": 12.5, "target": "all_items", "idempotencyKey": key()},
	} {
		if status, body := call(owner, "POST", "/promotions", bad); status != 400 {
			t.Errorf("%s: %d %s", name, status, body)
		}
	}
	if status, body := call(owner, "POST", "/promotions/"+p.ID+"/activate", map[string]any{"version": 1}); status != 200 {
		t.Fatalf("activate: %d %s", status, body)
	}
	status, body = call(owner, "PATCH", "/promotions/"+p.ID, map[string]any{"version": 1, "basisPoints": 2000})
	var conflict struct {
		Code           string `json:"code"`
		CurrentVersion int    `json:"currentVersion"`
	}
	_ = json.Unmarshal(body, &conflict)
	if status != 409 || conflict.Code != "VERSION_CONFLICT" || conflict.CurrentVersion != 2 {
		t.Errorf("stale patch: %d %s", status, body)
	}
	if status, body := call(owner, "PATCH", "/promotions/"+p.ID, map[string]any{"version": 2, "startsAt": nil, "basisPoints": 2000}); status != 200 {
		t.Errorf("patch: %d %s", status, body)
	} else {
		testsupport.Validate(t, promotionSchema, body)
	}
	if status, _ := call(cashier, "PATCH", "/promotions/"+p.ID, map[string]any{"version": 3, "name": "x"}); status != 403 {
		t.Errorf("cashier patch: %d", status)
	}
	status, body = call(cashier, "GET", "/promotions?status=active", nil)
	var list []map[string]any
	if _ = json.Unmarshal(body, &list); status != 200 || len(list) != 1 {
		t.Errorf("cashier reads active: %d %s", status, body)
	}

	// 12: the order API refuses a client discount, at order and line level.
	order := func(extra map[string]any, item map[string]any) (int, []byte) {
		it := map[string]any{"menuItemId": h.f.Soda, "quantity": 1}
		for k, v := range item {
			it[k] = v
		}
		b := map[string]any{"source": "pos_terminal", "serviceMode": "takeaway", "idempotencyKey": key(), "items": []any{it}}
		for k, v := range extra {
			b[k] = v
		}
		return call(cashier, "POST", "/orders", b)
	}
	for name, c := range map[string][2]map[string]any{
		"order discountCents": {{"promotionId": p.ID, "discountCents": 400}, nil},
		"line discountCents":  {{"promotionId": p.ID}, {"discountCents": 1}},
		"empty promotionId":   {{"promotionId": ""}, nil},
	} {
		if status, body := order(c[0], c[1]); status != 400 {
			t.Errorf("%s: %d %s", name, status, body)
		}
	}
	status, body = order(map[string]any{"promotionId": p.ID}, map[string]any{"expectedUnitPriceCents": 400})
	if status != 201 {
		t.Fatalf("order with promotion: %d %s", status, body)
	}
	testsupport.Validate(t, testsupport.Schema(t, "openapi/servvia-orders.yaml", "/components/schemas/Order"), body)
	var placed struct {
		DiscountCents int64 `json:"discountCents"`
		TotalCents    int64 `json:"totalCents"`
		Promotions    []struct {
			PromotionID string `json:"promotionId"`
		} `json:"promotions"`
	}
	_ = json.Unmarshal(body, &placed)
	// 20 % of 400 = 80 by the server.
	if placed.DiscountCents != 80 || placed.TotalCents != 320 || len(placed.Promotions) != 1 || placed.Promotions[0].PromotionID != p.ID {
		t.Errorf("placed %s", body)
	}
	// Refusals carry their code and reason.
	for name, c := range map[string]struct {
		extra     map[string]any
		status    int
		code, why string
	}{
		"unknown promotion": {map[string]any{"promotionId": testsupport.UUID()}, 404, "PROMOTION_NOT_FOUND", ""},
		"not eligible":      {map[string]any{"promotionId": p.ID}, 422, "PROMOTION_NOT_APPLICABLE", "no_eligible_items"},
	} {
		b := map[string]any{"source": "pos_terminal", "serviceMode": "takeaway", "idempotencyKey": key(),
			"items": []any{map[string]any{"menuItemId": h.f.Plain, "quantity": 1}}}
		for k, v := range c.extra {
			b[k] = v
		}
		status, body := call(cashier, "POST", "/orders", b)
		var e struct {
			Code   string `json:"code"`
			Reason string `json:"reason"`
		}
		_ = json.Unmarshal(body, &e)
		if status != c.status || e.Code != c.code || e.Reason != c.why {
			t.Errorf("%s: %d %s", name, status, body)
		}
	}
}

// The database refuses what the D11 migration's CHECKs forbid, whatever
// writes it.
func TestPromotionSchemaInvariants(t *testing.T) {
	h := promotionsSetup(t)
	ctx := context.Background()
	p := h.promotion(t, h.f.Venue, percent("Ten", 1000))
	o := h.place(t, h.takeaway(&p.ID, line(h.f.Plain, 1)))
	for _, c := range []struct {
		name, constraint, sql string
		args                  []any
	}{
		{"rate over 100%", "Promotion_basis_points_range", `UPDATE "Promotion" SET "basisPoints" = 10001 WHERE id = $1`, []any{p.ID}},
		{"empty window", "Promotion_window_order", `UPDATE "Promotion" SET "startsAt" = now(), "endsAt" = now() WHERE id = $1`, []any{p.ID}},
		{"all_items with a list", "Promotion_target_lists", `UPDATE "Promotion" SET "menuItemIds" = ARRAY['x'] WHERE id = $1`, []any{p.ID}},
		{"null list", "Promotion_target_lists", `UPDATE "Promotion" SET "categoryIds" = NULL WHERE id = $1`, []any{p.ID}},
		{"line discount above the line", "OrderItem_discount_bounds", `UPDATE "OrderItem" SET "discountCents" = "lineTotalCents" + 1 WHERE "orderId" = $1`, []any{o.ID}},
		{"line discount without a promotion", "OrderItem_discount_bounds", `UPDATE "OrderItem" SET "appliedPromotionId" = NULL WHERE "orderId" = $1`, []any{o.ID}},
		{"order discount above its gross", "Order_discount_bounds", `UPDATE "Order" SET "discountCents" = "subtotalCents" + 1 WHERE id = $1`, []any{o.ID}},
		{"snapshot discount above eligible", "AppliedPromotion_amounts", `UPDATE "AppliedPromotion" SET "discountCents" = "eligibleSubtotalCents" + 1 WHERE "orderId" = $1`, []any{o.ID}},
		{"snapshot at another venue's promotion", "AppliedPromotion_orderId_venueId_fkey", `UPDATE "AppliedPromotion" SET "venueId" = $2 WHERE "orderId" = $1`, []any{o.ID, h.f.TaxlessVenue}},
	} {
		_, err := h.writer.Exec(ctx, c.sql, c.args...)
		if err == nil || !strings.Contains(err.Error(), c.constraint) {
			t.Errorf("%s: %v", c.name, err)
		}
	}
}
