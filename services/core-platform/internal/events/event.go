// Package events is Servvia Core's canonical domain-event model (Phase D13,
// building on the D12 catalog): the fact every canonical change records in
// its own transaction, the envelope consumers receive, the catalog of fact
// types, and the registry of work consumers and what they subscribe to.
//
// A domain event is not canonical state: the domain tables are. It is the
// durable, transactional guarantee that a committed change can be observed
// asynchronously. Progress belongs to consumers (EventDelivery rows for
// work consumers; an in-memory cursor for broadcast readers), never to the
// event. Persistence is events/pgstore; the worker runtime is
// internal/workers. No HTTP, WebSocket or device dependency.
package events

import (
	"encoding/json"
	"errors"
	"time"
)

// Fact is one canonical change, as a domain store records it inside its
// transaction. The store names the aggregate and its post-change version;
// the organization, venue, id and time are the recorder's.
type Fact struct {
	Type          string
	AggregateType string
	AggregateID   string
	// Version is the aggregate's version after the change, when it has one.
	Version *int
	// Payload is small: identifiers, statuses and summary amounts. Never
	// credentials, provider references, card data or whole rows.
	Payload map[string]any
}

// Event is a recorded fact: the language-neutral envelope
// (contracts/realtime/servvia-realtime.schema.json, $defs.Event).
type Event struct {
	ID             string          `json:"eventId"`
	Type           string          `json:"eventType"`
	OccurredAt     time.Time       `json:"-"`
	OrganizationID string          `json:"organizationId"`
	VenueID        string          `json:"venueId"`
	AggregateType  string          `json:"aggregateType"`
	AggregateID    string          `json:"aggregateId"`
	Version        *int            `json:"version"`
	Payload        json.RawMessage `json:"payload"`
}

// MarshalJSON renders occurredAt in the contracts' millisecond UTC form.
func (e Event) MarshalJSON() ([]byte, error) {
	type plain Event
	return json.Marshal(struct {
		plain
		OccurredAt string `json:"occurredAt"`
	}{plain(e), e.OccurredAt.UTC().Format("2006-01-02T15:04:05.000Z")})
}

// catalog maps every canonical fact type to its aggregate type
// (contracts/events/catalog.md). A type not listed here cannot be recorded.
var catalog = map[string]string{
	"table_session.opened":        "table_session",
	"table_session.closed":        "table_session",
	"table_session.cancelled":     "table_session",
	"order.created":               "order",
	"order.round_submitted":       "order",
	"kitchen_ticket.created":      "kitchen_ticket",
	"kitchen_ticket.transitioned": "kitchen_ticket",
	"check.created":               "check",
	"check.voided":                "check",
	"check.settled":               "check",
	"check.settlement_revoked":    "check",
	"payment.created":             "payment",
	"payment.status_changed":      "payment",
	"refund.created":              "refund",
	"refund.status_changed":       "refund",
	"reversal.recorded":           "reversal",
	"shift.opened":                "shift",
	"shift.closed":                "shift",
	"promotion.created":           "promotion",
	"promotion.updated":           "promotion",
	"promotion.activated":         "promotion",
	"promotion.disabled":          "promotion",
}

// Types lists every canonical fact type.
func Types() []string {
	out := make([]string, 0, len(catalog))
	for t := range catalog {
		out = append(out, t)
	}
	return out
}

// Known reports whether t is a canonical fact type.
func Known(t string) bool { _, ok := catalog[t]; return ok }

// MaxPayloadBytes bounds a payload (a CHECK in the migration mirrors it).
const MaxPayloadBytes = 8192

// ErrInvalidFact is a recording bug: an unknown type, a mismatched
// aggregate, or an oversized payload. It fails the canonical transaction,
// so no change is committed without its fact.
var ErrInvalidFact = errors.New("events: invalid fact")

// Encode validates a fact and returns its payload JSON.
func (f Fact) Encode() ([]byte, error) {
	aggregate, known := catalog[f.Type]
	if !known || aggregate != f.AggregateType || f.AggregateID == "" || (f.Version != nil && *f.Version < 1) {
		return nil, ErrInvalidFact
	}
	payload := f.Payload
	if payload == nil {
		payload = map[string]any{}
	}
	raw, err := json.Marshal(payload)
	if err != nil || len(raw) > MaxPayloadBytes {
		return nil, ErrInvalidFact
	}
	return raw, nil
}

// V is a version pointer, for Fact literals.
func V(n int) *int { return &n }
