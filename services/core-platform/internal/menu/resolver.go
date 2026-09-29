// Package menu serves the channel menu read
// (GET /api/menu/venues/{venueId}/channel/{channel}), the first capability
// moved from the NestJS API under the strangler migration.
//
// Contract: contracts/openapi/menu-read.yaml. Behaviour is ported from
// apps/api/src/menu/channel-menu.controller.ts and channel-menu-resolver.ts.
package menu

import (
	"encoding/json"
)

// Channel is the Prisma MenuChannel enum.
type Channel string

const (
	ChannelOrderTablet     Channel = "order_tablet"
	ChannelCustomerWebsite Channel = "customer_website"
	ChannelWindowDisplay   Channel = "window_display"
)

// filterByAvailability mirrors CHANNEL_POLICY: staff (order_tablet) see
// unavailable ("86'd") items dimmed; customer-facing channels drop them.
var filterByAvailability = map[Channel]bool{
	ChannelOrderTablet:     false,
	ChannelCustomerWebsite: true,
	ChannelWindowDisplay:   true,
}

// ParseChannel reports whether s is one of the three known channels.
func ParseChannel(s string) (Channel, bool) {
	c := Channel(s)
	_, ok := filterByAvailability[c]
	return c, ok
}

// Category is the CATEGORY_SELECT projection.
type Category struct {
	ID              string   `json:"id"`
	Name            string   `json:"name"`
	Description     *string  `json:"description"`
	ImageURL        *string  `json:"imageUrl"`
	SortOrder       int      `json:"sortOrder"`
	IsActive        bool     `json:"isActive"`
	VisibleChannels []string `json:"visibleChannels"`
}

// Item is the MENU_ITEM_SELECT projection. It never carries posProductCode,
// the posIdentity relation, or bookkeeping columns.
type Item struct {
	ID                 string          `json:"id"`
	CategoryID         string          `json:"categoryId"`
	SubCategory        *string         `json:"subCategory"`
	Title              string          `json:"title"`
	Description        string          `json:"description"`
	ImageURL           *string         `json:"imageUrl"`
	ImageThumbnailURL  *string         `json:"imageThumbnailUrl"`
	PriceCents         int             `json:"priceCents"`
	NutritionalDetails json.RawMessage `json:"nutritionalDetails"`
	ModifierGroups     json.RawMessage `json:"modifierGroups"`
	IsSpicy            bool            `json:"isSpicy"`
	IsAvailable        bool            `json:"isAvailable"`
	IsFeatured         bool            `json:"isFeatured"`
	SortOrder          int             `json:"sortOrder"`
	VisibleChannels    []string        `json:"visibleChannels"`
}

// Override is a MenuItemVenueOverride row; nil fields mean "no override".
type Override struct {
	MenuItemID  string
	PriceCents  *int
	IsAvailable *bool
}

// Snapshot is what the store reads for one request: categories and items
// already restricted to the organization, the channel, active categories and
// non-deleted items, each ordered by sortOrder ascending.
type Snapshot struct {
	Categories []Category
	Items      []Item
	Overrides  []Override
}

// Response is the channel menu body.
type Response struct {
	Categories []Category `json:"categories"`
	MenuItems  []Item     `json:"menuItems"`
}

// Resolve applies resolveChannelMenu's rules to a snapshot:
//  1. an item appears only if its category is visible on the channel;
//  2. venue overrides replace price and availability (override ?? item);
//  3. customer-facing channels then drop unavailable items;
//  4. a category with no remaining items is dropped.
//
// Input order is preserved, so the store's ordering is the response order.
func Resolve(s Snapshot, channel Channel) Response {
	overrides := make(map[string]Override, len(s.Overrides))
	for _, o := range s.Overrides {
		overrides[o.MenuItemID] = o
	}
	visibleCategory := make(map[string]bool, len(s.Categories))
	for _, c := range s.Categories {
		visibleCategory[c.ID] = true
	}

	items := make([]Item, 0, len(s.Items))
	nonEmpty := make(map[string]bool)
	for _, item := range s.Items {
		if !visibleCategory[item.CategoryID] {
			continue
		}
		if o, ok := overrides[item.ID]; ok {
			if o.PriceCents != nil {
				item.PriceCents = *o.PriceCents
			}
			if o.IsAvailable != nil {
				item.IsAvailable = *o.IsAvailable
			}
		}
		if filterByAvailability[channel] && !item.IsAvailable {
			continue
		}
		items = append(items, item)
		nonEmpty[item.CategoryID] = true
	}

	categories := make([]Category, 0, len(s.Categories))
	for _, c := range s.Categories {
		if nonEmpty[c.ID] {
			categories = append(categories, c)
		}
	}
	return Response{Categories: categories, MenuItems: items}
}
