package realtime

import (
	"encoding/json"
	"errors"
	"servvia/services/core-platform/internal/events"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestGrantIsLeastPrivilege(t *testing.T) {
	staff := []Audience{Operations, Financial}
	cases := []struct {
		name string
		id   Identity
		want []Audience
	}{
		{"owner login", Identity{Kind: StaffSession, Role: "owner"}, staff},
		{"manager login", Identity{Kind: StaffSession, Role: "manager"}, staff},
		{"cashier on a tablet", Identity{Kind: StaffOnTablet, Role: "cashier"}, staff},
		{"kitchen staff", Identity{Kind: StaffSession, Role: "kitchen"}, []Audience{Kitchen}},
		{"KDS token", Identity{Kind: KDSToken, Role: "kitchen"}, []Audience{Kitchen}},
		{"KDS device", Identity{Kind: Device, DeviceKind: "kds"}, []Audience{Kitchen}},
		{"viewer", Identity{Kind: StaffSession, Role: "viewer"}, nil},
		{"customer tablet", Identity{Kind: CustomerTablet, Role: "viewer"}, nil},
		{"order tablet device", Identity{Kind: Device, DeviceKind: "order_tablet"}, nil},
		{"POS device (no staff authority)", Identity{Kind: Device, DeviceKind: "pos_terminal"}, nil},
		{"payment adapter", Identity{Kind: Device, DeviceKind: "payment_adapter"}, nil},
		{"unknown role", Identity{Kind: StaffSession, Role: "superuser"}, nil},
	}
	for _, c := range cases {
		got, err := Grant(c.id)
		if !slices.Equal(got, c.want) || (c.want == nil) != errors.Is(err, ErrNotPermitted) {
			t.Errorf("%s: %v %v", c.name, got, err)
		}
	}
}

// The kitchen stream never carries a financial or configuration fact.
// Every canonical fact type reaches some stream, and realtime knows no type
// the catalog does not.
func TestAudiencesCoverTheCatalog(t *testing.T) {
	for _, typ := range events.Types() {
		if len(AudiencesOf(typ)) == 0 {
			t.Errorf("%s reaches no stream", typ)
		}
	}
	for _, typ := range Types() {
		if !events.Known(typ) {
			t.Errorf("%s is not a canonical fact", typ)
		}
	}
}

func TestKitchenReceivesOnlyKitchenFacts(t *testing.T) {
	kitchen := []Audience{Kitchen}
	for _, typ := range Types() {
		want := strings.HasPrefix(typ, "kitchen_ticket.")
		if Allowed(kitchen, typ) != want {
			t.Errorf("kitchen and %s: %v", typ, !want)
		}
		financial := strings.HasPrefix(typ, "check.") || strings.HasPrefix(typ, "payment.") || strings.HasPrefix(typ, "refund.") ||
			strings.HasPrefix(typ, "reversal.") || strings.HasPrefix(typ, "shift.")
		if Allowed([]Audience{Operations}, typ) == financial {
			t.Errorf("operations and %s", typ)
		}
		if Allowed([]Audience{Financial}, typ) != financial {
			t.Errorf("financial and %s", typ)
		}
	}
	if Allowed([]Audience{Operations, Financial, Kitchen}, "made.up") {
		t.Error("an unknown type reached someone")
	}
}

func ev(venue, org, typ string) Event {
	return Event{ID: venue + typ, Type: typ, OrganizationID: org, VenueID: venue, Payload: json.RawMessage(`{}`)}
}

func TestHubIsolation(t *testing.T) {
	h := NewHub(16)
	a, _ := h.Subscribe("orgA", "venueA", []Audience{Operations, Financial})
	aKitchen, _ := h.Subscribe("orgA", "venueA", []Audience{Kitchen})
	b, _ := h.Subscribe("orgB", "venueB", []Audience{Operations, Financial})
	for _, e := range []Event{
		ev("venueA", "orgA", "order.created"),
		ev("venueA", "orgA", "check.settled"),
		ev("venueA", "orgA", "kitchen_ticket.created"),
		ev("venueB", "orgB", "order.created"),
		// A venue id shared across organizations never crosses them.
		ev("venueA", "orgB", "order.created"),
	} {
		h.Publish(e)
	}
	drain := func(s *Subscription) []string {
		var got []string
		for {
			select {
			case e := <-s.Events():
				got = append(got, e.OrganizationID+"/"+e.VenueID+"/"+e.Type)
			default:
				return got
			}
		}
	}
	if got := drain(a); !slices.Equal(got, []string{"orgA/venueA/order.created", "orgA/venueA/check.settled", "orgA/venueA/kitchen_ticket.created"}) {
		t.Errorf("staff A: %v", got)
	}
	if got := drain(aKitchen); !slices.Equal(got, []string{"orgA/venueA/kitchen_ticket.created"}) {
		t.Errorf("kitchen A: %v", got)
	}
	if got := drain(b); !slices.Equal(got, []string{"orgB/venueB/order.created"}) {
		t.Errorf("staff B: %v", got)
	}
}

// A slow subscriber is ended, never waited for; the others keep receiving.
func TestHubBackpressure(t *testing.T) {
	h := NewHub(8)
	slow, _ := h.Subscribe("o", "v", []Audience{Operations}) // never reads
	fast, _ := h.Subscribe("o", "v", []Audience{Operations}) // reads after every publish
	received := 0
	start := time.Now()
	for range 100 {
		h.Publish(ev("v", "o", "order.created"))
		select {
		case <-fast.Events():
			received++
		case <-time.After(time.Second):
			t.Fatal("the fast subscriber was starved")
		}
	}
	if time.Since(start) > 5*time.Second {
		t.Error("publishing waited for a subscriber")
	}
	select {
	case <-slow.Done():
	default:
		t.Fatal("the slow subscriber was not ended")
	}
	if slow.Reason() != EndSlow || received != 100 || h.Count() != 1 {
		t.Errorf("reason %s, fast received %d, live %d", slow.Reason(), received, h.Count())
	}
}

func TestHubCloseEndsEverySubscription(t *testing.T) {
	h := NewHub(4)
	var subs []*Subscription
	for i := range 10 {
		s, _ := h.Subscribe("o", "v"+string(rune('0'+i%3)), []Audience{Kitchen})
		subs = append(subs, s)
	}
	h.Close()
	for _, s := range subs {
		select {
		case <-s.Done():
			if s.Reason() != EndShutdown {
				t.Errorf("reason %s", s.Reason())
			}
		default:
			t.Fatal("a subscription survived Close")
		}
	}
	if _, err := h.Subscribe("o", "v", []Audience{Kitchen}); !errors.Is(err, ErrHubClosed) {
		t.Errorf("subscribe after close: %v", err)
	}
	h.Publish(ev("v", "o", "kitchen_ticket.created")) // no panic, nobody receives
}

// Concurrent publish, subscribe and unsubscribe (run with -race).
func TestHubConcurrency(t *testing.T) {
	h := NewHub(8)
	var wg sync.WaitGroup
	for i := range 8 {
		wg.Add(2)
		go func() {
			defer wg.Done()
			for range 200 {
				h.Publish(ev("v", "o", "order.created"))
			}
		}()
		go func() {
			defer wg.Done()
			for range 50 {
				s, err := h.Subscribe("o", "v", []Audience{Operations})
				if err != nil {
					return
				}
				h.Unsubscribe(s)
			}
			_ = i
		}()
	}
	wg.Wait()
	h.Close()
}
