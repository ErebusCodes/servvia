import { MenuChannel, PrismaClient } from '@prisma/client';

/**
 * Per-channel policy for the two orthogonal presentation concepts this
 * resolver composes:
 *
 * - VISIBLE (`visibleChannels` on Category/MenuItem): should this ever
 *   render on this surface at all, regardless of stock. Applied for every
 *   channel, unconditionally.
 * - AVAILABLE (`MenuItem.isAvailable` / `MenuItemVenueOverride.isAvailable`):
 *   can this be ordered right now (86'd state). Order Tablet deliberately
 *   does NOT filter on this — staff need to see 86'd items dimmed, not
 *   missing (existing UX, preserved). Customer Website and Window Display
 *   DO filter on this — an unavailable item must disappear entirely for a
 *   customer, not merely dim (this is the server-side fix for the
 *   previously-unenforced window-display `/order` leak, where every item
 *   — including all unreviewed staging rows — was returned and only
 *   visually dimmed client-side).
 */
const CHANNEL_POLICY: Record<MenuChannel, { filterByAvailability: boolean }> = {
  order_tablet: { filterByAvailability: false },
  customer_website: { filterByAvailability: true },
  window_display: { filterByAvailability: true },
};

export interface ResolveChannelMenuInput {
  organizationId: string;
  venueId: string;
  channel: MenuChannel;
}

/**
 * The single shared domain resolver every channel-facing menu endpoint
 * must call. Because a `PosProductIdentity` candidate (Menu Management
 * architecture) is never a `MenuItem` row, and `visibleChannels` defaults
 * to an empty array (deny-by-default), a channel view returned from here
 * structurally cannot include an unreviewed/unpublished item — this is a
 * property of the data, not a filter a future caller could forget to add.
 *
 * Deliberately mirrors `KioskController#getVenueMenu`'s existing
 * category/item/override query shape so behavior stays recognizable during
 * the Phase D migration where callers cut over one at a time.
 */
export async function resolveChannelMenu(
  prisma: PrismaClient,
  { organizationId, venueId, channel }: ResolveChannelMenuInput,
) {
  const policy = CHANNEL_POLICY[channel];

  const [categories, menuItems, overrides] = await Promise.all([
    prisma.category.findMany({
      where: { organizationId, isActive: true, visibleChannels: { has: channel } },
      orderBy: { sortOrder: 'asc' },
    }),
    // Availability is deliberately NOT filtered at this query level: a
    // MenuItemVenueOverride can re-enable an item this venue wants
    // available even when the org-level default is unavailable (or vice
    // versa) — the same reason the pre-existing kiosk endpoint fetches
    // unfiltered and merges overrides before ever applying an availability
    // decision. Filtering here first would silently exclude an
    // override-re-enabled item before the override ever gets a chance to
    // apply.
    prisma.menuItem.findMany({
      where: {
        organizationId,
        deletedAt: null,
        visibleChannels: { has: channel },
      },
      orderBy: { sortOrder: 'asc' },
    }),
    prisma.menuItemVenueOverride.findMany({ where: { venueId } }),
  ]);

  const overrideMap = new Map(overrides.map((o) => [o.menuItemId, o]));

  const mergedItems = menuItems
    .map((item) => {
      const itemOverride = overrideMap.get(item.id);
      return {
        ...item,
        priceCents: itemOverride?.priceCents ?? item.priceCents,
        isAvailable: itemOverride?.isAvailable ?? item.isAvailable,
      };
    })
    .filter((item) => (policy.filterByAvailability ? item.isAvailable !== false : true));

  const nonEmptyCategoryIds = new Set(mergedItems.map((item) => item.categoryId));
  const visibleCategories = categories.filter((category) => nonEmptyCategoryIds.has(category.id));

  return {
    categories: visibleCategories,
    menuItems: mergedItems,
  };
}
