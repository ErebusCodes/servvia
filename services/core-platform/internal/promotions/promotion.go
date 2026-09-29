// Package promotions is Servvia Core's promotion domain (ADR 0001, Phase
// D11).
//
// A Promotion is a configured offer at one venue: "10 % off", "20 % off
// Mains". It is a business rule, not a money record. What a transaction
// actually received is an Application, frozen into the order when the order
// or round is accepted (orders.AppliedPromotion); nothing reads the live
// promotion afterwards, so editing or disabling one never changes an
// accepted order, a check or a refund.
//
// This package decides whether a promotion is valid for a venue and moment
// and which lines it covers. The money (the discount, its rounding and
// allocation, the GST) is pricing's: Evaluate hands pricing the eligible
// lines and the rate and keeps what pricing returns. No HTTP, SQL, device,
// provider or external-POS dependency. Persistence is behind Repository
// (promotions/pgstore); transport is promotions/promotionsapi.
package promotions

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"slices"
	"strings"
	"time"
)

// Kind is how a promotion discounts. Only percentage has product evidence
// (the Order Tablet's percent-only billing helper); fixed amounts, codes,
// bundles and tiers are deliberately absent until a requirement exists.
type Kind string

const KindPercentage Kind = "percentage"

// Status is a promotion's lifecycle: inactive (the state at creation) and
// active. It is never deleted, and a window that has passed does not
// rewrite it.
type Status string

const (
	StatusInactive Status = "inactive"
	StatusActive   Status = "active"
)

// Target says which lines a promotion covers.
type Target string

const (
	TargetAllItems   Target = "all_items"
	TargetCategories Target = "categories"
	TargetMenuItems  Target = "menu_items"
)

// Bounds, mirrored by CHECKs in migration 20261007000000_promotions.
const (
	MaxNameLength  = 80
	MaxTargetIDs   = 200
	MinKeyLength   = 16
	MaxKeyLength   = 255
	MaxBasisPoints = 10000
)

// Terms are a promotion's configurable part: what it is, what it covers,
// when it may apply.
type Terms struct {
	Name        string
	Kind        Kind
	BasisPoints int64
	Target      Target
	CategoryIDs []string
	MenuItemIDs []string
	// StartsAt and EndsAt bound the window [StartsAt, EndsAt), UTC instants;
	// nil is unbounded on that side. Recurring local-time windows are not
	// supported (deferred: no requirement, and they need venue-local rules).
	StartsAt *time.Time
	EndsAt   *time.Time
}

// Promotion is one configured offer.
type Promotion struct {
	ID      string
	VenueID string
	Terms
	Status           Status
	Version          int
	CreateRequestKey string
	CreatedByStaffID string
	UpdatedByStaffID *string
	CreatedAt        time.Time
	UpdatedAt        time.Time
}

// Normalize validates terms and returns their canonical form: the name
// trimmed, the target ids trimmed, de-duplicated and sorted, instants in UTC
// at the stored millisecond precision.
func (t Terms) Normalize() (Terms, error) {
	n := t
	n.Name = strings.TrimSpace(t.Name)
	if l := len([]rune(n.Name)); l < 1 || l > MaxNameLength {
		return Terms{}, invalid("name must be a string of 1 to 80 characters")
	}
	if n.Kind != KindPercentage {
		return Terms{}, invalid("kind must be percentage")
	}
	if n.BasisPoints < 1 || n.BasisPoints > MaxBasisPoints {
		return Terms{}, invalid("basisPoints must be an integer from 1 to 10000")
	}
	var err error
	if n.CategoryIDs, err = ids("categoryIds", t.CategoryIDs); err != nil {
		return Terms{}, err
	}
	if n.MenuItemIDs, err = ids("menuItemIds", t.MenuItemIDs); err != nil {
		return Terms{}, err
	}
	switch n.Target {
	case TargetAllItems:
		if len(n.CategoryIDs) > 0 || len(n.MenuItemIDs) > 0 {
			return Terms{}, invalid("an all_items promotion lists no categoryIds or menuItemIds")
		}
	case TargetCategories:
		if len(n.CategoryIDs) == 0 || len(n.MenuItemIDs) > 0 {
			return Terms{}, invalid("a categories promotion lists categoryIds, and no menuItemIds")
		}
	case TargetMenuItems:
		if len(n.MenuItemIDs) == 0 || len(n.CategoryIDs) > 0 {
			return Terms{}, invalid("a menu_items promotion lists menuItemIds, and no categoryIds")
		}
	default:
		return Terms{}, invalid("target must be one of all_items, categories, menu_items")
	}
	n.StartsAt, n.EndsAt = instant(t.StartsAt), instant(t.EndsAt)
	if n.StartsAt != nil && n.EndsAt != nil && !n.StartsAt.Before(*n.EndsAt) {
		return Terms{}, invalid("startsAt must be before endsAt")
	}
	return n, nil
}

func ids(field string, in []string) ([]string, error) {
	out := make([]string, 0, len(in))
	for _, id := range in {
		id = strings.TrimSpace(id)
		if id == "" {
			return nil, invalid(field + " must not contain an empty id")
		}
		out = append(out, id)
	}
	slices.Sort(out)
	out = slices.Compact(out)
	if len(out) > MaxTargetIDs {
		return nil, invalid(field + " must list at most 200 ids")
	}
	return out, nil
}

func instant(t *time.Time) *time.Time {
	if t == nil {
		return nil
	}
	u := t.UTC().Truncate(time.Millisecond)
	return &u
}

// Covers reports whether the window contains at: StartsAt <= at < EndsAt.
func (t Terms) Covers(at time.Time) bool {
	return (t.StartsAt == nil || !at.Before(*t.StartsAt)) && (t.EndsAt == nil || at.Before(*t.EndsAt))
}

// Fingerprint identifies a create request semantically: the venue and the
// normalized terms. A replay with the same key and terms returns the
// promotion; the same key with other terms is refused.
func Fingerprint(venueID string, t Terms) string {
	stamp := func(p *time.Time) string {
		if p == nil {
			return ""
		}
		return p.Format(time.RFC3339Nano)
	}
	raw, _ := json.Marshal([]any{"promotion/v1", venueID, t.Name, t.Kind, t.BasisPoints, t.Target,
		t.CategoryIDs, t.MenuItemIDs, stamp(t.StartsAt), stamp(t.EndsAt)})
	sum := sha256.Sum256(raw)
	return hex.EncodeToString(sum[:])
}

// sameTerms reports whether two normalized terms are identical.
func sameTerms(a, b Terms) bool {
	return Fingerprint("", a) == Fingerprint("", b)
}
