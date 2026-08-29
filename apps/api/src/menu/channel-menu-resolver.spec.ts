import { PrismaClient } from '@prisma/client';
import { resolveChannelMenu } from './channel-menu-resolver';

// This suite is the positive analogue of kiosk.controller.spec.ts's
// "intentionally unfiltered" test — the opposite guarantee, for the same
// reason: this resolver's whole purpose is to make the staging-leak
// hazard structurally impossible (a pending_review PosProductIdentity
// candidate is never a MenuItem row, and visibleChannels defaults to
// empty) rather than dependent on any one frontend remembering to filter.

const org = 'org-1';
const venue = 'venue-1';

function makeCategory(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'cat-1',
    organizationId: org,
    name: 'Mains',
    isActive: true,
    sortOrder: 0,
    visibleChannels: ['order_tablet', 'customer_website', 'window_display'],
    ...overrides,
  };
}

function makeItem(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'item-1',
    organizationId: org,
    categoryId: 'cat-1',
    title: 'Pesto Chicken Pizza',
    priceCents: 2350,
    isAvailable: true,
    deletedAt: null,
    sortOrder: 0,
    visibleChannels: ['order_tablet', 'customer_website', 'window_display'],
    ...overrides,
  };
}

type Row = Record<string, unknown>;

// A real Prisma call filters `visibleChannels: { has: channel }` (and
// `isActive`/`deletedAt`) at the database level — a mock that ignores the
// `where` argument and always returns the full fixture array would let
// every test in this file pass even if the resolver never actually built
// that filter. This mock replays just enough of Prisma's semantics
// (`has`, plain equality, `null`) to make these tests fail if the
// resolver's query construction regresses, not just its post-processing.
function applyWhere(rows: Row[], where: Record<string, unknown> | undefined): Row[] {
  if (!where) return rows;
  return rows.filter((row) =>
    Object.entries(where).every(([key, condition]) => {
      if (condition && typeof condition === 'object' && 'has' in condition) {
        const arr = row[key];
        return Array.isArray(arr) && arr.includes(condition.has);
      }
      return row[key] === condition;
    }),
  );
}

function mockPrisma(fixtures: { categories?: Row[]; menuItems?: Row[]; overrides?: Row[] }) {
  const categories = fixtures.categories ?? [];
  const menuItems = fixtures.menuItems ?? [];
  const venueOverrides = fixtures.overrides ?? [];
  return {
    category: {
      findMany: jest
        .fn()
        .mockImplementation(({ where }: { where?: Record<string, unknown> }) =>
          Promise.resolve(applyWhere(categories, where)),
        ),
    },
    menuItem: {
      findMany: jest
        .fn()
        .mockImplementation(({ where }: { where?: Record<string, unknown> }) =>
          Promise.resolve(applyWhere(menuItems, where)),
        ),
    },
    menuItemVenueOverride: {
      findMany: jest.fn().mockResolvedValue(venueOverrides),
    },
  } as unknown as PrismaClient;
}

describe('resolveChannelMenu', () => {
  it('never returns an item whose visibleChannels does not include the requested channel', async () => {
    const prisma = mockPrisma({
      categories: [makeCategory()],
      menuItems: [
        makeItem({ id: 'visible', visibleChannels: ['customer_website'] }),
        makeItem({ id: 'not-visible', visibleChannels: ['order_tablet'] }),
      ],
    });

    const result = await resolveChannelMenu(prisma, {
      organizationId: org,
      venueId: venue,
      channel: 'customer_website',
    });

    expect(result.menuItems.map((i) => i.id)).toEqual(['visible']);
  });

  it('a pending-review-style item (visibleChannels: []) can never appear on any channel, even seeded adjacent to a linked/published item', async () => {
    const prisma = mockPrisma({
      categories: [makeCategory()],
      menuItems: [
        makeItem({ id: 'published' }),
        makeItem({ id: 'unpublished-candidate', visibleChannels: [] }),
      ],
    });

    for (const channel of ['order_tablet', 'customer_website', 'window_display'] as const) {
      const result = await resolveChannelMenu(prisma, {
        organizationId: org,
        venueId: venue,
        channel,
      });
      expect(result.menuItems.map((i) => i.id)).not.toContain('unpublished-candidate');
    }
  });

  it('order_tablet includes unavailable items (dimmed 86d UX), customer_website and window_display exclude them', async () => {
    const prisma = mockPrisma({
      categories: [makeCategory()],
      menuItems: [makeItem({ id: 'sold-out', isAvailable: false })],
    });

    const tabletResult = await resolveChannelMenu(prisma, {
      organizationId: org,
      venueId: venue,
      channel: 'order_tablet',
    });
    expect(tabletResult.menuItems.map((i) => i.id)).toEqual(['sold-out']);

    const websiteResult = await resolveChannelMenu(prisma, {
      organizationId: org,
      venueId: venue,
      channel: 'customer_website',
    });
    expect(websiteResult.menuItems).toEqual([]);

    const windowResult = await resolveChannelMenu(prisma, {
      organizationId: org,
      venueId: venue,
      channel: 'window_display',
    });
    expect(windowResult.menuItems).toEqual([]);
  });

  it('a venue override can re-enable an item the org default marks unavailable, and the resolver still applies the channel availability policy after merging', async () => {
    const prisma = mockPrisma({
      categories: [makeCategory()],
      menuItems: [makeItem({ id: 'reenabled', isAvailable: false })],
      overrides: [{ menuItemId: 'reenabled', venueId: venue, isAvailable: true, priceCents: null }],
    });

    const websiteResult = await resolveChannelMenu(prisma, {
      organizationId: org,
      venueId: venue,
      channel: 'customer_website',
    });
    expect(websiteResult.menuItems.map((i) => i.id)).toEqual(['reenabled']);
  });

  it('drops a category once it has nothing visible left in it for the requested channel', async () => {
    const prisma = mockPrisma({
      categories: [makeCategory({ id: 'empty-cat' })],
      menuItems: [makeItem({ categoryId: 'empty-cat', visibleChannels: ['order_tablet'] })],
    });

    const result = await resolveChannelMenu(prisma, {
      organizationId: org,
      venueId: venue,
      channel: 'customer_website',
    });
    expect(result.categories).toEqual([]);
  });

  it('a category itself invisible on a channel excludes its items from that channel, even when the item itself is marked visible on that channel (category visibility and item visibility are independent gates — both must pass)', async () => {
    const prisma = mockPrisma({
      // Category hidden from customer_website (only visible on order_tablet)...
      categories: [makeCategory({ visibleChannels: ['order_tablet'] })],
      // ...but the item itself is marked visible on ALL three channels,
      // including customer_website.
      menuItems: [
        makeItem({ visibleChannels: ['order_tablet', 'customer_website', 'window_display'] }),
      ],
    });

    const result = await resolveChannelMenu(prisma, {
      organizationId: org,
      venueId: venue,
      channel: 'customer_website',
    });

    expect(result.categories).toEqual([]);
    // The item must be absent too — a category-level hide must not be
    // bypassable by an item's own, independently-permissive
    // visibleChannels setting.
    expect(result.menuItems).toEqual([]);
  });

  it('an item remains visible when both it and its category include the requested channel (the positive case for the same gate)', async () => {
    const prisma = mockPrisma({
      categories: [makeCategory({ visibleChannels: ['customer_website'] })],
      menuItems: [makeItem({ visibleChannels: ['customer_website'] })],
    });

    const result = await resolveChannelMenu(prisma, {
      organizationId: org,
      venueId: venue,
      channel: 'customer_website',
    });

    expect(result.categories.map((c) => c.id)).toEqual(['cat-1']);
    expect(result.menuItems.map((i) => i.id)).toEqual(['item-1']);
  });

  it('merges venue-level price overrides unchanged from the existing kiosk endpoint behavior', async () => {
    const prisma = mockPrisma({
      categories: [makeCategory()],
      menuItems: [makeItem({ priceCents: 2350 })],
      overrides: [{ menuItemId: 'item-1', venueId: venue, priceCents: 1999, isAvailable: null }],
    });

    const result = await resolveChannelMenu(prisma, {
      organizationId: org,
      venueId: venue,
      channel: 'order_tablet',
    });
    expect(result.menuItems[0].priceCents).toBe(1999);
  });
});
