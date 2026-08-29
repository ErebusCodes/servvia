// Integration test against a REAL local Postgres — no mocking. Proves the
// two structural guarantees Phase D §10/§15/§22 require against the real
// Prisma `select` projection and real MenuChannel[]/PosProductIdentity
// rows, not a hand-rolled mock of Prisma's query semantics:
//
// 1. A channel response never exposes internal/POS-source fields
//    (posProductCode, organizationId, createdById, deletedAt) — the
//    explicit `select` in channel-menu-resolver.ts, not a filter a
//    frontend could forget.
// 2. A PosProductIdentity candidate (pending_review, ambiguous,
//    takeaway_duplicate, source_missing — any status) is NEVER returned
//    as a menu item by any channel, because it is never a MenuItem row at
//    all — planting one in the same organization as real published items
//    must not affect the response in any way.
import { PrismaClient } from '@prisma/client';
import { resolveChannelMenu } from '../src/menu/channel-menu-resolver';

const prisma = new PrismaClient();

describe('resolveChannelMenu (integration, real local Postgres)', () => {
  let organizationId: string;
  let venueId: string;
  let categoryId: string;
  let staffId: string;
  const createdMenuItemIds: string[] = [];
  const createdPosIdentityIds: string[] = [];
  const testTag = `RESOLVER-TEST-${Date.now()}`;

  beforeAll(async () => {
    const venue = await prisma.venue.findFirstOrThrow({ where: { slug: 'auckland' } });
    venueId = venue.id;
    organizationId = venue.organizationId;
    const staff = await prisma.staff.findFirstOrThrow({ where: { organizationId } });
    staffId = staff.id;
    // A dedicated, all-channels-visible test category — real seeded
    // categories default to visibleChannels: [] (deny-by-default, no
    // Phase E backfill run yet), so reusing one directly would make every
    // "published item" fixture below fail the (correct, Phase D-fixed)
    // category-visibility intersection in resolveChannelMenu.
    const category = await prisma.category.create({
      data: {
        organizationId,
        name: `${testTag} Visible Test Category`,
        sortOrder: 999,
        isActive: true,
        createdById: staffId,
        visibleChannels: ['order_tablet', 'customer_website', 'window_display'],
      },
    });
    categoryId = category.id;
  });

  afterEach(async () => {
    if (createdPosIdentityIds.length > 0) {
      await prisma.posProductIdentity.deleteMany({ where: { id: { in: createdPosIdentityIds } } });
      createdPosIdentityIds.length = 0;
    }
    if (createdMenuItemIds.length > 0) {
      await prisma.menuItem.deleteMany({ where: { id: { in: createdMenuItemIds } } });
      createdMenuItemIds.length = 0;
    }
  });

  afterAll(async () => {
    await prisma.category.delete({ where: { id: categoryId } });
    await prisma.$disconnect();
  });

  it('never includes posProductCode or internal bookkeeping fields on any returned menu item, for any channel', async () => {
    const item = await prisma.menuItem.create({
      data: {
        organizationId,
        categoryId,
        title: `${testTag} Published Item`,
        description: 'test fixture',
        priceCents: 1000,
        nutritionalDetails: {},
        createdById: staffId,
        isAvailable: true,
        posProductCode: '999-SHOULD-NOT-LEAK',
        visibleChannels: ['order_tablet', 'customer_website', 'window_display'],
      },
    });
    createdMenuItemIds.push(item.id);

    for (const channel of ['order_tablet', 'customer_website', 'window_display'] as const) {
      const result = await resolveChannelMenu(prisma, { organizationId, venueId, channel });
      const returned = result.menuItems.find((i) => i.id === item.id);
      expect(returned).toBeDefined();
      expect(returned).not.toHaveProperty('posProductCode');
      expect(returned).not.toHaveProperty('organizationId');
      expect(returned).not.toHaveProperty('createdById');
      expect(returned).not.toHaveProperty('deletedAt');
    }
  });

  it('a PosProductIdentity candidate never appears as a menu item on any channel, planted alongside a real published item', async () => {
    const published = await prisma.menuItem.create({
      data: {
        organizationId,
        categoryId,
        title: `${testTag} Real Published Item`,
        description: 'test fixture',
        priceCents: 1000,
        nutritionalDetails: {},
        createdById: staffId,
        isAvailable: true,
        visibleChannels: ['order_tablet', 'customer_website', 'window_display'],
      },
    });
    createdMenuItemIds.push(published.id);

    const candidate = await prisma.posProductIdentity.create({
      data: {
        organizationId,
        nativeCode: `${testTag}-CANDIDATE`,
        nativeDescription: 'A raw IdealPOS candidate, never reviewed',
        lifecycleStatus: 'pending_review',
        confidenceTier: 'ambiguous',
      },
    });
    createdPosIdentityIds.push(candidate.id);

    for (const channel of ['order_tablet', 'customer_website', 'window_display'] as const) {
      const result = await resolveChannelMenu(prisma, { organizationId, venueId, channel });
      expect(result.menuItems.some((i) => i.id === candidate.id)).toBe(false);
      expect(
        result.menuItems.some(
          (i) => (i as { title?: string }).title === candidate.nativeDescription,
        ),
      ).toBe(false);
      expect(result.menuItems.some((i) => i.id === published.id)).toBe(true);
    }
  });

  it('a channel-hidden category cannot leak its items, even when an item inside it is independently marked visible on that channel', async () => {
    const hiddenCategory = await prisma.category.create({
      data: {
        organizationId,
        name: `${testTag} Hidden Category`,
        sortOrder: 999,
        isActive: true,
        createdById: staffId,
        visibleChannels: ['order_tablet'], // NOT customer_website
      },
    });
    const item = await prisma.menuItem.create({
      data: {
        organizationId,
        categoryId: hiddenCategory.id,
        title: `${testTag} Item In Hidden Category`,
        description: 'test fixture',
        priceCents: 1000,
        nutritionalDetails: {},
        createdById: staffId,
        isAvailable: true,
        // Independently marked visible on customer_website too — this is
        // exactly the case that must still be excluded.
        visibleChannels: ['order_tablet', 'customer_website', 'window_display'],
      },
    });
    const result = await resolveChannelMenu(prisma, {
      organizationId,
      venueId,
      channel: 'customer_website',
    });

    expect(result.categories.some((c) => c.id === hiddenCategory.id)).toBe(false);
    expect(result.menuItems.some((i) => i.id === item.id)).toBe(false);

    // Cleanup: the item must be deleted before its category (FK), and this
    // category is a throwaway fixture the shared afterEach doesn't track —
    // both are cleaned up here directly instead.
    await prisma.menuItem.delete({ where: { id: item.id } });
    await prisma.category.delete({ where: { id: hiddenCategory.id } });
  });

  it('a takeaway_duplicate / source_missing candidate also never appears, regardless of confidence tier or lifecycle status', async () => {
    const takeawayDup = await prisma.posProductIdentity.create({
      data: {
        organizationId,
        nativeCode: `${testTag}-TAKEAWAY`,
        nativeDescription: 'Takeaway duplicate candidate',
        lifecycleStatus: 'pending_review',
        confidenceTier: 'takeaway_duplicate',
      },
    });
    const sourceMissing = await prisma.posProductIdentity.create({
      data: {
        organizationId,
        nativeCode: `${testTag}-MISSING`,
        nativeDescription: 'Source-missing candidate',
        lifecycleStatus: 'source_missing',
      },
    });
    createdPosIdentityIds.push(takeawayDup.id, sourceMissing.id);

    for (const channel of ['order_tablet', 'customer_website', 'window_display'] as const) {
      const result = await resolveChannelMenu(prisma, { organizationId, venueId, channel });
      expect(
        result.menuItems.some((i) => i.id === takeawayDup.id || i.id === sourceMissing.id),
      ).toBe(false);
    }
  });
});
