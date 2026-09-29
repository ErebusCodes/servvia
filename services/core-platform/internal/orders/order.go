// Package orders is Servvia Core's canonical order domain (ADR 0001, Phase
// D3).
//
// An Order is what the guest or staff requested: priced lines, submitted in
// rounds. It is not the visit (tables.Session), what the kitchen prepares
// (KitchenTicket, Phase D4), the financial obligation (Check, D5) or money
// tendered (Payment, D6). None of those states live here.
//
// Prices always come from the pricing package: a client sends identities,
// quantities and notes, never an authoritative amount. Persistence is behind
// Repository (orders/pgstore); transport lives in orders/ordersapi. This
// package has no HTTP, SQL, device or external-POS dependency.
package orders

import (
	"errors"
	"time"

	"servvia/services/core-platform/internal/pricing"
)

// Source is the surface an order was placed on. It may decide who can use a
// command and, later, payment policy; it never changes what an order is.
type Source string

const (
	SourcePOSTerminal  Source = "pos_terminal"
	SourceWaiterTablet Source = "waiter_tablet"
	SourceOrderTablet  Source = "order_tablet"
	SourceKiosk        Source = "kiosk"
	SourceCustomerWeb  Source = "customer_web"
)

// canonicalSources are the sources Servvia Core writes. The database also
// holds `staff` and `online`, written by the NestJS order path; such an
// order reads back with that Source value, which Canonical reports false for.
var canonicalSources = map[Source]bool{
	SourcePOSTerminal: true, SourceWaiterTablet: true, SourceOrderTablet: true,
	SourceKiosk: true, SourceCustomerWeb: true,
}

// Canonical reports whether s is a Servvia source rather than a legacy value.
func (s Source) Canonical() bool { return canonicalSources[s] }

// StaffMaySubmit reports whether a staff member may place an order from
// source: from a staff tablet only as a tablet surface, from any other staff
// session only as the POS terminal. Customer surfaces (kiosk, customer web)
// are not staff sources and have no Servvia Core endpoint yet.
func StaffMaySubmit(source Source, onTablet bool) bool {
	if onTablet {
		return source == SourceWaiterTablet || source == SourceOrderTablet
	}
	return source == SourcePOSTerminal
}

// ServiceMode is how the order is served. Values are the existing
// ServiceMode enum; no new mode is introduced.
type ServiceMode string

const (
	// ServiceDineIn is table service: the order belongs to a table session.
	ServiceDineIn ServiceMode = "dine_in"
	// ServiceTakeaway has no table and no session.
	ServiceTakeaway ServiceMode = "takeaway"
)

// Status is the order's lifecycle as the restaurant sees it. The values are
// the existing OrderStatus enum. Servvia Core creates orders confirmed
// (accepted). preparing and ready are fulfilment progress, which
// KitchenTicket owns from Phase D4; completed and cancelled are terminal.
// There is no transport or external-POS state here.
type Status string

const (
	StatusPending   Status = "pending"
	StatusConfirmed Status = "confirmed"
	StatusPreparing Status = "preparing"
	StatusReady     Status = "ready"
	StatusCompleted Status = "completed"
	StatusCancelled Status = "cancelled"
)

// Active reports whether the order is still being served.
func (s Status) Active() bool {
	return s == StatusPending || s == StatusConfirmed || s == StatusPreparing || s == StatusReady
}

// Order is a requested order with its priced lines and its rounds.
type Order struct {
	ID      string
	VenueID string
	// TableSessionID is set for table service. TableID and TableNumber are
	// then derived from the session's table (and must match it: a database
	// foreign key enforces it).
	TableSessionID    *string
	TableID           *string
	TableNumber       *string
	ServiceMode       ServiceMode
	Source            Source
	Status            Status
	Notes             *string
	TakeawayReference *string
	IdempotencyKey    string
	// Totals of every line of every round: SubtotalCents is the gross,
	// DiscountCents the promotion discounts (Phase D11), TotalCents =
	// SubtotalCents - DiscountCents, and TaxCents the GST contained in it.
	SubtotalCents int64
	DiscountCents int64
	TaxCents      int64
	TotalCents    int64
	Rounds        []Round
	Lines         []Line
	// Promotions are the applied-promotion snapshots, at most one per round,
	// in round order.
	Promotions []AppliedPromotion
	CreatedAt  time.Time
	UpdatedAt  time.Time
}

// AppliedPromotion is the frozen financial effect of one promotion on one
// round (Phase D11): what the order received, whatever the promotion
// becomes later. The discounted lines carry their shares.
type AppliedPromotion struct {
	ID                    string
	RoundID               string
	PromotionID           string
	PromotionVersion      int
	Name                  string
	Kind                  string
	BasisPoints           int64
	Target                string
	Currency              string
	EligibleSubtotalCents int64
	DiscountCents         int64
	AppliedAt             time.Time
}

// Round is one submission of lines. Round 1 is the order's creation.
type Round struct {
	ID                 string
	Sequence           int
	RequestKey         string
	SubmittedByStaffID *string
	SubmittedAt        time.Time
}

// Line is one priced order line, a snapshot that survives menu changes: the
// title, category, unit price and resolved modifiers as they were ordered.
type Line struct {
	ID               string
	RoundID          *string
	MenuItemID       string
	MenuItemTitle    string
	MenuItemCategory string
	UnitPriceCents   int64
	Quantity         int64
	LineTotalCents   int64
	// DiscountCents is the line's share of its round's promotion discount
	// (0..LineTotalCents); AppliedPromotionID the promotion snapshot, when
	// the line was eligible.
	DiscountCents      int64
	AppliedPromotionID *string
	Modifiers          []pricing.PricedModifier
	Notes              *string
	Seat               *int
}

// LineInput is what a client may request for one line.
type LineInput struct {
	MenuItemID string
	Quantity   int64
	Modifiers  []pricing.ModifierSelection
	Notes      *string
	Seat       *int
	// ExpectedUnitPriceCents is the price the client displayed, compared by
	// pricing.CheckExpectedPrices for a new request; never used as a price.
	ExpectedUnitPriceCents *int64
}

// Bounds shared with the legacy order path.
const (
	MinKeyLength = 16
	MaxKeyLength = 255
)

// Errors. The transport maps each to its contract response
// (contracts/openapi/servvia-orders.yaml).
var (
	ErrOrderNotFound        = errors.New("Order not found")
	ErrTableSessionNotFound = errors.New("Table session not found")
	// ErrNotTableService: rounds are submitted to table-service orders.
	ErrNotTableService    = errors.New("Only a table-service order takes further rounds")
	ErrSourceNotPermitted = errors.New("This order source is not permitted for this caller")
	ErrUnknownActor       = errors.New("Unknown staff identity")
	ErrWritesDisabled     = errors.New("Order changes are disabled on this instance")
)

// ValidationError is a malformed request.
type ValidationError struct{ Message string }

func (e *ValidationError) Error() string { return e.Message }

func invalid(msg string) error { return &ValidationError{Message: msg} }

// IdempotencyConflictError: the key was already used for a different request.
// The message is the NestJS order path's, verbatim.
type IdempotencyConflictError struct {
	Key     string
	OrderID string
}

func (e *IdempotencyConflictError) Error() string {
	return `idempotencyKey "` + e.Key + `" was already used to create a different order`
}

// RoundConflictError: a round key was already used for different lines.
type RoundConflictError struct{ Key string }

func (e *RoundConflictError) Error() string {
	return `idempotencyKey "` + e.Key + `" was already used to submit a different round`
}

// SessionNotOpenError: the table session has ended; no new table-service
// orders or rounds.
type SessionNotOpenError struct{ Status string }

func (e *SessionNotOpenError) Error() string { return "Table session is " + e.Status + ", not open" }

// OrderNotActiveError: the order has ended and takes no further rounds.
type OrderNotActiveError struct{ Status Status }

func (e *OrderNotActiveError) Error() string { return "Order is " + string(e.Status) + ", not active" }
