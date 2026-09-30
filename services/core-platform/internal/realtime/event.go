// Package realtime is Servvia Core's canonical realtime domain (ADR 0001,
// Phase D12): the event envelope, the catalog of canonical facts, who may
// receive which facts, and the in-process fan-out hub.
//
// PostgreSQL is the truth. An event tells a subscriber what changed and
// what to refetch over HTTP; it is never a resource representation, a
// command or replayable history. Facts are recorded in the same transaction
// as the change they announce (realtime/pgstore) and delivered after commit
// (realtime/realtimeapi). Nothing here depends on HTTP, SQL, WebSocket code,
// a device or an external POS.
package realtime

import (
	"encoding/json"
	"errors"
	"time"
)

// Audience is a server-assigned stream. A subscriber never chooses one: its
// identity decides (Grant).
type Audience string

const (
	// Kitchen: what a kitchen screen needs to run tickets. Nothing financial.
	Kitchen Audience = "kitchen"
	// Operations: visits, orders, kitchen tickets, promotion status.
	Operations Audience = "operations"
	// Financial: checks, payments, returns of money, shifts.
	Financial Audience = "financial"
)

// Fact is one canonical change, as a domain store records it inside its
// transaction. The store names the aggregate and the post-change version;
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
// (contracts/realtime/envelope.schema.json).
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

type entry struct {
	aggregate string
	audiences []Audience
}

var (
	kitchenOps = []Audience{Kitchen, Operations}
	ops        = []Audience{Operations}
	financial  = []Audience{Financial}
)

// catalog is every canonical fact (contracts/events/catalog.md). A type not
// listed here cannot be recorded.
var catalog = map[string]entry{
	"table_session.opened":        {"table_session", ops},
	"table_session.closed":        {"table_session", ops},
	"table_session.cancelled":     {"table_session", ops},
	"order.created":               {"order", ops},
	"order.round_submitted":       {"order", ops},
	"kitchen_ticket.created":      {"kitchen_ticket", kitchenOps},
	"kitchen_ticket.transitioned": {"kitchen_ticket", kitchenOps},
	"check.created":               {"check", financial},
	"check.voided":                {"check", financial},
	"check.settled":               {"check", financial},
	"check.settlement_revoked":    {"check", financial},
	"payment.created":             {"payment", financial},
	"payment.status_changed":      {"payment", financial},
	"refund.created":              {"refund", financial},
	"refund.status_changed":       {"refund", financial},
	"reversal.recorded":           {"reversal", financial},
	"shift.opened":                {"shift", financial},
	"shift.closed":                {"shift", financial},
	"promotion.created":           {"promotion", ops},
	"promotion.updated":           {"promotion", ops},
	"promotion.activated":         {"promotion", ops},
	"promotion.disabled":          {"promotion", ops},
}

// Types lists every canonical event type.
func Types() []string {
	out := make([]string, 0, len(catalog))
	for t := range catalog {
		out = append(out, t)
	}
	return out
}

// AudiencesOf returns the streams an event type belongs to; nil for an
// unknown type (which nobody receives).
func AudiencesOf(eventType string) []Audience { return catalog[eventType].audiences }

// MaxPayloadBytes bounds a payload (a CHECK in the migration mirrors it).
const MaxPayloadBytes = 8192

// ErrInvalidFact is a recording bug: an unknown type, a mismatched
// aggregate, or an oversized payload. It fails the canonical transaction,
// so no change is committed without its announcement.
var ErrInvalidFact = errors.New("realtime: invalid fact")

// Encode validates a fact and returns its payload JSON.
func (f Fact) Encode() ([]byte, error) {
	e, known := catalog[f.Type]
	if !known || e.aggregate != f.AggregateType || f.AggregateID == "" || (f.Version != nil && *f.Version < 1) {
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
