// Package pricing is Servvia Core's canonical price authority: given a
// venue's tax configuration, the current menu catalog and what the client
// asked for (product, modifiers, quantity), it computes every amount the
// customer is charged. Clients never supply an authoritative price; at most
// they supply the price they displayed, which is checked, never used.
//
// The package is pure: no HTTP, no SQL, no clock, no external POS concept.
// Catalog loading lives in pricing/pgcatalog; transport mapping lives with the
// endpoint that eventually calls it (canonical order creation, a later phase).
//
// Behaviour is ported from the NestJS API, the current reference
// implementation (apps/api/src/orders/orders.service.ts: resolveOrderItems,
// parseModifierGroups, resolveModifiers strict branch, checkExpectedPrices,
// computeTotals) and pinned in contracts/openapi/orders.yaml
// (x-pricing, x-modifier-resolution). tests/parity proves Go and Nest agree
// to the cent.
//
// Not ported, deliberately: the name-based ("non-strict") modifier matching of
// the public kiosk path, which prices a modifier by its display name and
// silently zero-prices unknown names. See docs/migration/README.md (Phase D1).
package pricing

import "math"

// All amounts are integer minor units (cents). There is no floating-point
// money anywhere in this package.

// MaxAmountCents is the largest amount that can be persisted: every money
// column on Order and OrderItem is a PostgreSQL integer. A quote with any
// larger amount is refused (KindAmountOutOfRange) instead of failing later
// at persistence.
const MaxAmountCents = math.MaxInt32

func addCents(a, b int64) (int64, bool) {
	s := a + b
	if (s > a) != (b > 0) {
		return 0, false
	}
	return s, true
}

func mulCents(a, b int64) (int64, bool) {
	if a == 0 || b == 0 {
		return 0, true
	}
	p := a * b
	if p/b != a || (a == -1 && b == math.MinInt64) || (b == -1 && a == math.MinInt64) {
		return 0, false
	}
	return p, true
}

func persistable(c int64) bool { return c >= -MaxAmountCents && c <= MaxAmountCents }

// Persistable reports whether an amount fits the persisted integer columns.
// Callers that combine priced amounts (an order's rounds) check their sums.
func Persistable(c int64) bool { return persistable(c) }

// ErrAmountOutOfRange is the error for an amount that is not Persistable.
func ErrAmountOutOfRange() error { return errOutOfRange }

// floorDiv is division rounding toward negative infinity.
func floorDiv(a, b int64) int64 {
	q := a / b
	if (a%b != 0) && ((a < 0) != (b < 0)) {
		q--
	}
	return q
}
