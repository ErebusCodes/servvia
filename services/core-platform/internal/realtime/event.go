// Package realtime is Servvia Core's canonical realtime domain (ADR 0001,
// Phase D12): which streams each canonical fact belongs to, who may receive
// which streams, and the in-process fan-out hub.
//
// PostgreSQL is the truth. An event tells a subscriber what changed and
// what to refetch over HTTP; it is never a resource representation, a
// command or replayable history. Facts, their envelope and their catalog
// are the events package's (Phase D13): realtime is a broadcast reader of
// that log (realtime/pgstore), delivering over WebSocket
// (realtime/realtimeapi). Nothing here depends on HTTP, SQL, WebSocket code,
// a device or an external POS.
package realtime

import "servvia/services/core-platform/internal/events"

// Event is the canonical event envelope.
type Event = events.Event

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

var (
	kitchenOps = []Audience{Kitchen, Operations}
	ops        = []Audience{Operations}
	financial  = []Audience{Financial}
)

// audiences maps every canonical fact type (events catalog) to its streams.
// A type missing here reaches nobody; a test keeps the two in step.
var audiences = map[string][]Audience{
	"table_session.opened":        ops,
	"table_session.closed":        ops,
	"table_session.cancelled":     ops,
	"order.created":               ops,
	"order.round_submitted":       ops,
	"kitchen_ticket.created":      kitchenOps,
	"kitchen_ticket.transitioned": kitchenOps,
	"check.created":               financial,
	"check.voided":                financial,
	"check.settled":               financial,
	"check.settlement_revoked":    financial,
	"payment.created":             financial,
	"payment.status_changed":      financial,
	"refund.created":              financial,
	"refund.status_changed":       financial,
	"reversal.recorded":           financial,
	"shift.opened":                financial,
	"shift.closed":                financial,
	"promotion.created":           ops,
	"promotion.updated":           ops,
	"promotion.activated":         ops,
	"promotion.disabled":          ops,
}

// Types lists every event type realtime delivers.
func Types() []string {
	out := make([]string, 0, len(audiences))
	for t := range audiences {
		out = append(out, t)
	}
	return out
}

// AudiencesOf returns the streams an event type belongs to; nil for an
// unknown type (which nobody receives).
func AudiencesOf(eventType string) []Audience { return audiences[eventType] }
