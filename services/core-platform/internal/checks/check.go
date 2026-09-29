// Package checks is Servvia Core's check domain (ADR 0001, Phase D5).
//
// A Check is a financial obligation: what a guest (or a party) owes for
// order lines already accepted. It is not the order (what was requested), a
// kitchen ticket (production work), a payment (money tendered, Phase D6) or
// settlement (the obligation satisfied, D6). Nothing here reads or writes
// order, kitchen, table-session, payment or external-POS state; a check only
// snapshots the priced order lines it bills.
//
// Money comes from the orders' accepted snapshots (OrderItem unit and line
// totals, and since Phase D11 each line's accepted promotion discount), never
// from a client, never re-priced from the menu and never re-evaluated against
// today's promotions. Tax is the D1 pricing rule applied to the check's
// discounted total. Persistence is behind
// Repository (checks/pgstore); transport is checks/checksapi.
package checks

import (
	"time"

	"servvia/services/core-platform/internal/pricing"
)

// Status is the obligation's lifecycle. open: it stands. voided: created in
// error and withdrawn; its lines may be billed again. settled (Phase D6):
// successful payments cover the total, recorded by exactly one settlement,
// which the payments domain writes; a check never becomes settled here.
type Status string

const (
	StatusOpen    Status = "open"
	StatusVoided  Status = "voided"
	StatusSettled Status = "settled"
)

// Check is one financial obligation.
type Check struct {
	ID      string
	VenueID string
	// TableSessionID is the visit the billed orders belong to; nil for
	// orders without a table (takeaway). Several checks may share a visit.
	TableSessionID *string
	Status         Status
	Currency       string
	// Totals of the lines: SubtotalCents is the gross, DiscountCents the
	// lines' accepted discounts, TotalCents what is owed (the gross less the
	// discounts) and TaxCents the GST it contains
	// (pricing.ComputeDiscountedTotals).
	SubtotalCents    int64
	DiscountCents    int64
	TaxCents         int64
	TotalCents       int64
	Version          int
	IdempotencyKey   string
	CreatedByStaffID *string
	VoidedByStaffID  *string
	VoidReason       *string
	VoidedAt         *time.Time
	Lines            []Line
	CreatedAt        time.Time
	UpdatedAt        time.Time
}

// Line is one billed order line: a copy of the order line's accepted
// financial snapshot. An order line is on at most one check that is not
// voided (the database enforces it).
type Line struct {
	ID             string
	OrderID        string
	OrderItemID    string
	Position       int
	Title          string
	Quantity       int64
	UnitPriceCents int64
	LineTotalCents int64
	// DiscountCents is the order line's accepted promotion discount (D11).
	DiscountCents int64
	Modifiers     []pricing.PricedModifier
}

// Bounds shared with orders and table sessions.
const (
	MinKeyLength  = 16
	MaxKeyLength  = 255
	MaxOrders     = 50
	MaxVoidReason = 500
)
