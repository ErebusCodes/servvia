package promotions

import (
	"slices"
	"time"

	"servvia/services/core-platform/internal/pricing"
)

// Application is what one promotion does to one submission (an order's
// creation or a round): the promotion's identity, version and terms as
// evaluated, and pricing's result on the submission's lines. It becomes the
// order's AppliedPromotion snapshot, and the order's transaction commits it
// only while the promotion is still at Version (else ErrChanged).
type Application struct {
	PromotionID string
	Version     int
	VenueID     string
	Name        string
	Kind        Kind
	BasisPoints int64
	Target      Target
	// Currency is the venue's; the discount is in its minor units.
	Currency    string
	EvaluatedAt time.Time
	// Eligible[i] reports whether lines[i] is covered.
	Eligible []bool
	pricing.DiscountResult
}

// eligible reports whether a promotion's target covers a priced line.
func (t Terms) eligible(l pricing.PricedLine) bool {
	switch t.Target {
	case TargetAllItems:
		return true
	case TargetCategories:
		return slices.Contains(t.CategoryIDs, l.CategoryID)
	case TargetMenuItems:
		return slices.Contains(t.MenuItemIDs, l.MenuItemID)
	}
	return false
}

// Evaluate decides, server-side, whether p applies to a submission of
// priced lines at venue v at the instant at, and what it discounts. The
// promotion must be of this venue (else ErrPromotionNotFound, telling a
// caller nothing about other venues), active, in its window, and cover at
// least one line with a positive total. Nothing the client asserts takes
// part: eligibility comes from the lines' catalog identities, the amount
// from pricing.
func Evaluate(p Promotion, v pricing.Venue, at time.Time, lines []pricing.PricedLine) (Application, error) {
	if p.VenueID != v.ID {
		return Application{}, ErrPromotionNotFound
	}
	switch {
	case p.Status != StatusActive:
		return Application{}, &NotApplicableError{Reason: ReasonInactive}
	case p.StartsAt != nil && at.Before(*p.StartsAt):
		return Application{}, &NotApplicableError{Reason: ReasonNotStarted}
	case p.EndsAt != nil && !at.Before(*p.EndsAt):
		return Application{}, &NotApplicableError{Reason: ReasonEnded}
	}
	eligible := make([]bool, len(lines))
	var subtotal int64
	covered := false
	for i, l := range lines {
		eligible[i] = p.eligible(l)
		covered = covered || (eligible[i] && l.LineTotalCents > 0)
		subtotal += l.LineTotalCents // each line is persistable (pricing), so no overflow
	}
	if !covered {
		return Application{}, &NotApplicableError{Reason: ReasonNoEligibleItems}
	}
	res, err := pricing.ApplyPercentage(lines, eligible, p.BasisPoints)
	if err != nil {
		return Application{}, err
	}
	if res.DiscountCents > 0 && subtotal-res.DiscountCents <= 0 {
		return Application{}, &NotApplicableError{Reason: ReasonZeroTotal}
	}
	return Application{PromotionID: p.ID, Version: p.Version, VenueID: p.VenueID, Name: p.Name, Kind: p.Kind,
		BasisPoints: p.BasisPoints, Target: p.Target, Currency: v.Tax.Currency, EvaluatedAt: at,
		Eligible: eligible, DiscountResult: res}, nil
}
