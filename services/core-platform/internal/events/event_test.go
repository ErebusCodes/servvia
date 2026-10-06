package events

import (
	"encoding/json"
	"errors"
	"slices"
	"strings"
	"testing"
	"time"
)

func TestFactValidation(t *testing.T) {
	good := Fact{Type: "check.created", AggregateType: "check", AggregateID: "c1", Version: V(1), Payload: map[string]any{"checkId": "c1"}}
	if raw, err := good.Encode(); err != nil || string(raw) != `{"checkId":"c1"}` {
		t.Fatalf("%s %v", raw, err)
	}
	for name, f := range map[string]Fact{
		"unknown type":        {Type: "check.exploded", AggregateType: "check", AggregateID: "c1"},
		"wrong aggregate":     {Type: "check.created", AggregateType: "order", AggregateID: "c1"},
		"no aggregate id":     {Type: "check.created", AggregateType: "check"},
		"version 0":           {Type: "check.created", AggregateType: "check", AggregateID: "c1", Version: V(0)},
		"oversized payload":   {Type: "check.created", AggregateType: "check", AggregateID: "c1", Payload: map[string]any{"x": strings.Repeat("a", MaxPayloadBytes)}},
		"unencodable payload": {Type: "check.created", AggregateType: "check", AggregateID: "c1", Payload: map[string]any{"f": func() {}}},
	} {
		if _, err := f.Encode(); !errors.Is(err, ErrInvalidFact) {
			t.Errorf("%s: %v", name, err)
		}
	}
}

func TestEnvelopeJSON(t *testing.T) {
	e := Event{ID: "e1", Type: "order.created", OccurredAt: time.Date(2026, 9, 30, 1, 2, 3, 4e6, time.FixedZone("NZ", 13*3600)),
		OrganizationID: "o1", VenueID: "v1", AggregateType: "order", AggregateID: "ORD-1", Payload: json.RawMessage(`{"orderId":"ORD-1"}`)}
	raw, _ := json.Marshal(e)
	var m map[string]any
	_ = json.Unmarshal(raw, &m)
	if m["occurredAt"] != "2026-09-29T12:02:03.004Z" || m["eventId"] != "e1" || m["version"] != nil || len(m) != 9 {
		t.Errorf("%s", raw)
	}
}

// Work consumers are registered identities with real subscriptions; only
// the kitchen projector exists today (D13 invents no future workers).
func TestConsumerRegistry(t *testing.T) {
	if cs := Consumers(); len(cs) != 1 || cs[0] != KitchenProjector || !KitchenProjector.Valid() {
		t.Fatalf("consumers %v", cs)
	}
	if got := ConsumersOf("order.round_submitted"); !slices.Equal(got, []Consumer{KitchenProjector}) {
		t.Errorf("round consumers %v", got)
	}
	for _, typ := range Types() {
		if typ != "order.round_submitted" && len(ConsumersOf(typ)) != 0 {
			t.Errorf("%s has consumers", typ)
		}
	}
	for _, c := range Consumers() {
		for _, typ := range Subscriptions(c) {
			if !Known(typ) {
				t.Errorf("%s subscribes to unknown %s", c, typ)
			}
		}
	}
	if Consumer("Bad Name").Valid() || Consumer("").Valid() || !Consumer(strings.Repeat("a", 63)).Valid() {
		t.Error("consumer identity shape")
	}
}
