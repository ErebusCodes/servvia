package events

import "regexp"

// Consumer is a registered work consumer: a durable, at-least-once
// subscriber whose progress is tracked per event in EventDelivery. Every
// consumer identity is declared here; none is a string invented at a call
// site.
//
// Broadcast readers are deliberately not consumers: the realtime
// dispatcher tails the event log on every instance and keeps no durable
// progress, so it cannot share progress with any work consumer.
type Consumer string

const (
	// KitchenProjector turns order.round_submitted into kitchen tickets
	// (Phase D4 logic, run by the generic worker runtime since D13).
	KitchenProjector Consumer = "kitchen_projector"
)

// subscriptions is what each work consumer receives. Only consumers that
// exist are registered: printing, notifications and the like arrive with
// their phases, not before.
var subscriptions = map[Consumer][]string{
	KitchenProjector: {"order.round_submitted"},
}

var consumerPattern = regexp.MustCompile(`^[a-z][a-z_]{0,62}$`)

// Valid reports whether c has the shape of a consumer identity (a CHECK
// in the migration mirrors it).
func (c Consumer) Valid() bool { return consumerPattern.MatchString(string(c)) }

// Consumers lists the registered work consumers.
func Consumers() []Consumer {
	out := make([]Consumer, 0, len(subscriptions))
	for c := range subscriptions {
		out = append(out, c)
	}
	return out
}

// ConsumersOf lists the work consumers subscribed to an event type. Every
// one gets its own delivery, created with the event.
func ConsumersOf(eventType string) []Consumer {
	var out []Consumer
	for c, types := range subscriptions {
		for _, t := range types {
			if t == eventType {
				out = append(out, c)
			}
		}
	}
	return out
}

// Subscriptions returns the event types a consumer receives.
func Subscriptions(c Consumer) []string { return append([]string(nil), subscriptions[c]...) }
