package realtime

import (
	"errors"
	"sync"
)

// DefaultBuffer is the per-subscriber event buffer.
const DefaultBuffer = 256

// EndReason says why a subscription ended from the server side.
type EndReason string

const (
	// EndSlow: the subscriber's buffer was full; it missed events and must
	// resynchronise over HTTP.
	EndSlow EndReason = "SLOW_CONSUMER"
	// EndShutdown: the hub is closing (the process is draining).
	EndShutdown EndReason = "SHUTTING_DOWN"
)

// ErrHubClosed: the hub no longer accepts subscribers.
var ErrHubClosed = errors.New("realtime: hub closed")

// Subscription is one subscriber's stream of events for one venue of one
// organization, filtered to its granted audiences.
type Subscription struct {
	organizationID string
	venueID        string
	granted        []Audience
	events         chan Event
	done           chan struct{}
	once           sync.Once
	reason         EndReason
}

// Events delivers the subscriber's events in the order the hub published
// them.
func (s *Subscription) Events() <-chan Event { return s.events }

// Done is closed when the server ends the subscription; Reason says why.
func (s *Subscription) Done() <-chan struct{} { return s.done }

// Reason is valid once Done is closed.
func (s *Subscription) Reason() EndReason { return s.reason }

// Granted returns the subscription's audiences.
func (s *Subscription) Granted() []Audience { return s.granted }

func (s *Subscription) end(r EndReason) {
	s.once.Do(func() { s.reason = r; close(s.done) })
}

// Hub fans events out to subscriptions. Publish never blocks: a subscriber
// whose buffer is full is ended (EndSlow) rather than slowing the dispatcher
// or anyone else, and canonical writes never touch the hub at all.
//
// Isolation is by construction: subscriptions are indexed by venue, and an
// event reaches a subscription only if its venue AND organization match and
// its type is in the subscription's audiences.
type Hub struct {
	mu      sync.RWMutex
	byVenue map[string]map[*Subscription]struct{}
	closed  bool
	buffer  int
}

func NewHub(buffer int) *Hub {
	if buffer < 1 {
		buffer = DefaultBuffer
	}
	return &Hub{byVenue: map[string]map[*Subscription]struct{}{}, buffer: buffer}
}

// Subscribe registers a subscription. The caller has already authenticated
// the identity and resolved the venue and organization server-side.
func (h *Hub) Subscribe(organizationID, venueID string, granted []Audience) (*Subscription, error) {
	s := &Subscription{organizationID: organizationID, venueID: venueID, granted: granted,
		events: make(chan Event, h.buffer), done: make(chan struct{})}
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.closed {
		return nil, ErrHubClosed
	}
	if h.byVenue[venueID] == nil {
		h.byVenue[venueID] = map[*Subscription]struct{}{}
	}
	h.byVenue[venueID][s] = struct{}{}
	return s, nil
}

// Unsubscribe removes a subscription (idempotent).
func (h *Hub) Unsubscribe(s *Subscription) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if subs := h.byVenue[s.venueID]; subs != nil {
		delete(subs, s)
		if len(subs) == 0 {
			delete(h.byVenue, s.venueID)
		}
	}
}

// Publish delivers e to every matching subscription without blocking.
func (h *Hub) Publish(e Event) {
	h.mu.RLock()
	var slow []*Subscription
	for s := range h.byVenue[e.VenueID] {
		if s.organizationID != e.OrganizationID || !Allowed(s.granted, e.Type) {
			continue
		}
		select {
		case <-s.done:
		case s.events <- e:
		default:
			slow = append(slow, s)
		}
	}
	h.mu.RUnlock()
	for _, s := range slow {
		s.end(EndSlow)
		h.Unsubscribe(s)
	}
}

// Count is the number of live subscriptions (for tests and readiness).
func (h *Hub) Count() int {
	h.mu.RLock()
	defer h.mu.RUnlock()
	n := 0
	for _, subs := range h.byVenue {
		n += len(subs)
	}
	return n
}

// Close ends every subscription (EndShutdown) and refuses new ones.
func (h *Hub) Close() {
	h.mu.Lock()
	h.closed = true
	all := h.byVenue
	h.byVenue = map[string]map[*Subscription]struct{}{}
	h.mu.Unlock()
	for _, subs := range all {
		for s := range subs {
			s.end(EndShutdown)
		}
	}
}
