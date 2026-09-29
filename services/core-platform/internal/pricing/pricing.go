package pricing

import (
	"context"
	"strconv"
)

// CatalogItem is what pricing needs to know about one menu item at one venue:
// the item as authored for the organization, plus the venue's override if
// any. A catalog only contains items that exist for the organization and are
// not deleted; channel visibility is not a pricing rule (Nest does not apply
// it to orders either).
type CatalogItem struct {
	ID           string
	Title        string
	CategoryID   string
	CategoryName string
	PriceCents   int64
	IsAvailable  bool
	// ModifierGroups is the raw MenuItem.modifierGroups JSON.
	ModifierGroups []byte
	Override       *VenueOverride
}

// VenueOverride is a MenuItemVenueOverride row. A nil field means "not
// overridden": the item's own value applies.
type VenueOverride struct {
	PriceCents  *int64
	IsAvailable *bool
}

// LineRequest is one requested line. It carries identities and a quantity,
// never an authoritative price. ExpectedUnitPriceCents, when present, is the
// unit price the client displayed; it is only compared (CheckExpectedPrices).
type LineRequest struct {
	MenuItemID             string
	Quantity               int64
	Modifiers              []ModifierSelection
	ExpectedUnitPriceCents *int64
}

// PricedLine is the authoritative price of one line.
type PricedLine struct {
	MenuItemID       string
	MenuItemTitle    string
	MenuItemCategory string
	// CategoryID identifies the item's category (promotion eligibility);
	// MenuItemCategory is its display-name snapshot.
	CategoryID string
	// BasePriceCents is the venue override price, else the item price.
	BasePriceCents int64
	// ModifiersCents is the sum of the selected options' deltas.
	ModifiersCents int64
	// UnitPriceCents = BasePriceCents + ModifiersCents.
	UnitPriceCents int64
	Quantity       int64
	// LineTotalCents = UnitPriceCents × Quantity.
	LineTotalCents int64
	Modifiers      []PricedModifier
}

// PriceLines prices every line against the catalog, in request order, and
// returns the lines and their subtotal. The first failing line decides the
// error, and within a line the checks run in Nest's order: the item exists
// (400), it is available at this venue (409), its modifiers resolve.
// Zero lines is an error (400).
func PriceLines(catalog map[string]CatalogItem, lines []LineRequest) ([]PricedLine, int64, error) {
	priced := make([]PricedLine, 0, len(lines))
	var subtotal int64
	for _, line := range lines {
		item, found := catalog[line.MenuItemID]
		if !found {
			return nil, 0, invalid("MenuItem with ID " + line.MenuItemID + " not found")
		}
		available, base := item.IsAvailable, item.PriceCents
		if o := item.Override; o != nil {
			if o.IsAvailable != nil {
				available = *o.IsAvailable
			}
			if o.PriceCents != nil {
				base = *o.PriceCents
			}
		}
		if !available {
			return nil, 0, unavailable(`Menu item "` + item.Title + `" is currently unavailable`)
		}
		modifiers, modifiersCents, err := resolveModifiers(ParseModifierGroups(item.ModifierGroups), line.Modifiers)
		if err != nil {
			return nil, 0, err
		}
		if line.Quantity < 1 {
			return nil, 0, invalid("Quantity must be at least 1")
		}
		unit, ok1 := addCents(base, modifiersCents)
		lineTotal, ok2 := mulCents(unit, line.Quantity)
		next, ok3 := addCents(subtotal, lineTotal)
		if !ok1 || !ok2 || !ok3 {
			return nil, 0, errOutOfRange
		}
		subtotal = next
		priced = append(priced, PricedLine{
			MenuItemID: item.ID, MenuItemTitle: item.Title, MenuItemCategory: item.CategoryName, CategoryID: item.CategoryID,
			BasePriceCents: base, ModifiersCents: modifiersCents, UnitPriceCents: unit,
			Quantity: line.Quantity, LineTotalCents: lineTotal, Modifiers: modifiers,
		})
	}
	if len(priced) == 0 {
		return nil, 0, invalid("An order must contain at least one item")
	}
	return priced, subtotal, nil
}

// CheckExpectedPrices compares each line's ExpectedUnitPriceCents, when
// given, with the authoritative unit price at the same position. Any
// mismatch fails the whole request with KindStalePrice and every conflict
// listed; the client's number is never used as the price.
//
// For an idempotent replay of an order that was already accepted, the
// order-creation caller must skip this check, as Nest does.
func CheckExpectedPrices(lines []LineRequest, priced []PricedLine) error {
	var conflicts []PriceConflict
	for i, line := range lines {
		if line.ExpectedUnitPriceCents == nil || i >= len(priced) {
			continue
		}
		if got := priced[i].UnitPriceCents; got != *line.ExpectedUnitPriceCents {
			conflicts = append(conflicts, PriceConflict{
				MenuItemID: priced[i].MenuItemID, MenuItemTitle: priced[i].MenuItemTitle,
				ExpectedUnitPriceCents: *line.ExpectedUnitPriceCents, AuthoritativeUnitPriceCents: got,
			})
		}
	}
	if len(conflicts) > 0 {
		return &Error{Kind: KindStalePrice, Message: StalePriceMessage, Conflicts: conflicts}
	}
	return nil
}

// Quote is the authoritative price of a new order.
type Quote struct {
	Lines []PricedLine
	Totals
}

// PriceOrder prices a new (non-replay) order the way Nest's order creation
// does, in its order: price the lines, check the client's expected prices,
// then apply the venue's tax profile. Finally every amount must fit the
// persisted integer columns.
func PriceOrder(venueID string, tax TaxProfile, catalog map[string]CatalogItem, lines []LineRequest) (Quote, error) {
	priced, subtotal, err := PriceLines(catalog, lines)
	if err != nil {
		return Quote{}, err
	}
	if err := CheckExpectedPrices(lines, priced); err != nil {
		return Quote{}, err
	}
	totals, err := ComputeTotals(venueID, tax, subtotal)
	if err != nil {
		return Quote{}, err
	}
	for _, l := range priced {
		if !persistable(l.UnitPriceCents) || !persistable(l.LineTotalCents) {
			return Quote{}, errOutOfRange
		}
	}
	if !persistable(totals.SubtotalCents) {
		return Quote{}, errOutOfRange
	}
	return Quote{Lines: priced, Totals: totals}, nil
}

// Venue is the pricing context of one venue.
type Venue struct {
	ID             string
	OrganizationID string
	Tax            TaxProfile
}

// Catalog loads the catalog entries for the requested items. Items that do not
// exist for the organization, or are deleted, are simply absent.
type Catalog interface {
	Items(ctx context.Context, organizationID, venueID string, menuItemIDs []string) (map[string]CatalogItem, error)
}

// Service prices orders against a live catalog. It is the entry point the
// canonical Go order creation will call.
type Service struct{ catalog Catalog }

func NewService(c Catalog) *Service { return &Service{catalog: c} }

// Quote loads the catalog for the requested items and prices a new order.
func (s *Service) Quote(ctx context.Context, v Venue, lines []LineRequest) (Quote, error) {
	ids := make([]string, 0, len(lines))
	seen := map[string]bool{}
	for _, l := range lines {
		if !seen[l.MenuItemID] {
			seen[l.MenuItemID] = true
			ids = append(ids, l.MenuItemID)
		}
	}
	catalog, err := s.catalog.Items(ctx, v.OrganizationID, v.ID, ids)
	if err != nil {
		return Quote{}, err
	}
	return PriceOrder(v.ID, v.Tax, catalog, lines)
}

// String renders a line for logs and test failures.
func (l PricedLine) String() string {
	return l.MenuItemID + " " + strconv.FormatInt(l.UnitPriceCents, 10) + "x" + strconv.FormatInt(l.Quantity, 10) +
		"=" + strconv.FormatInt(l.LineTotalCents, 10)
}
