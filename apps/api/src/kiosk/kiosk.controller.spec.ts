import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { KioskController } from './kiosk.controller';
import { PrismaService } from '../prisma/prisma.service';
import { RateLimitGuard } from '../auth/guards/rate-limit.guard';

// Regression coverage for the 2026-08-21 broken-menu-image incident: a
// database reseed reintroduced stale, deleted local `/menu-images/<file>`
// paths on MenuItem rows that already had a matching, approved, public
// GCS MediaAsset. The API layer itself never transforms `imageUrl` — it is
// spread verbatim from the Prisma row into the response (see
// KioskController#getVenueMenu) — so the real fix lives in the data
// (apps/api/prisma/scripts/reassociate-orphaned-menu-item-media.ts), but
// this suite locks in the one guarantee the API layer itself must never
// violate: whatever imageUrl a MenuItem row has, the public menu endpoint
// must return it unchanged — never rewritten, never substituted, never
// dropped.

const mockPrisma = {
  venue: { findFirst: jest.fn<Promise<unknown>, [unknown]>() },
  category: { findMany: jest.fn<Promise<unknown[]>, [unknown]>() },
  menuItem: { findMany: jest.fn<Promise<unknown[]>, [unknown]>() },
  menuItemVenueOverride: { findMany: jest.fn<Promise<unknown[]>, [unknown]>() },
};

describe('KioskController#getVenueMenu — imageUrl pass-through', () => {
  let controller: KioskController;
  const venueId = '10000000-0000-4000-8000-000000000001';

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [KioskController],
      providers: [{ provide: PrismaService, useValue: mockPrisma }],
    })
      .overrideGuard(RateLimitGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<KioskController>(KioskController);

    mockPrisma.venue.findFirst.mockResolvedValue({
      id: venueId,
      organizationId: 'org-1',
      isActive: true,
    });
    mockPrisma.category.findMany.mockResolvedValue([]);
    mockPrisma.menuItemVenueOverride.findMany.mockResolvedValue([]);
  });

  it('passes a real GCS public delivery URL through unchanged', async () => {
    const gcsUrl =
      'https://storage.googleapis.com/verdura-media-public-d3794338b2/venues/10000000-0000-4000-8000-000000000001/menu-items/f93d63c4-9f56-42eb-8870-3458f232d8ad/original/arayes-cheese.jpg';
    mockPrisma.menuItem.findMany.mockResolvedValue([
      {
        id: 'item-1',
        title: 'Arayes & Cheese',
        imageUrl: gcsUrl,
        priceCents: 1500,
        isAvailable: true,
      },
    ]);

    const result = await controller.getVenueMenu(venueId);

    expect(result.menuItems[0].imageUrl).toBe(gcsUrl);
  });

  it('does not rewrite a stale local /menu-images/ path — the API is not the place that fixes this', async () => {
    // Documents the actual root cause: if a MenuItem row regresses to a
    // deleted local path, the API faithfully returns exactly that path. It
    // must never silently substitute a different URL, mask the problem, or
    // 404 the whole endpoint — the frontend fallback (shared/media/
    // menuImageFallback.mjs) is what keeps this from breaking the page, and
    // the data-level fix (reassociate-orphaned-menu-item-media.ts) is what
    // must repair the row itself.
    const staleLocalPath = '/menu-images/arayes-cheese.jpg';
    mockPrisma.menuItem.findMany.mockResolvedValue([
      {
        id: 'item-1',
        title: 'Arayes & Cheese',
        imageUrl: staleLocalPath,
        priceCents: 1500,
        isAvailable: true,
      },
    ]);

    const result = await controller.getVenueMenu(venueId);

    expect(result.menuItems[0].imageUrl).toBe(staleLocalPath);
  });

  it('preserves a null imageUrl (item genuinely has no photo) rather than fabricating one', async () => {
    mockPrisma.menuItem.findMany.mockResolvedValue([
      { id: 'item-1', title: 'Künefe', imageUrl: null, priceCents: 1200, isAvailable: true },
    ]);

    const result = await controller.getVenueMenu(venueId);

    expect(result.menuItems[0].imageUrl).toBeNull();
  });

  it('preserves URLs containing encoded characters and mixed-case object keys byte-for-byte', async () => {
    const encodedUrl =
      'https://storage.googleapis.com/verdura-media-public-d3794338b2/venues/10000000-0000-4000-8000-000000000001/menu-items/00000000-0000-0000-0000-000000000001/original/Grilled%20Halloumi%20%26%20More.JPG';
    mockPrisma.menuItem.findMany.mockResolvedValue([
      {
        id: 'item-1',
        title: 'Grilled Halloumi',
        imageUrl: encodedUrl,
        priceCents: 1800,
        isAvailable: true,
      },
    ]);

    const result = await controller.getVenueMenu(venueId);

    expect(result.menuItems[0].imageUrl).toBe(encodedUrl);
  });

  it('excludes soft-deleted (archived) menu items from the public response', async () => {
    // deletedAt: null is passed as a Prisma where-filter — this asserts the
    // controller actually requests it, so an archived/unpublished item's
    // media is never exposed via this endpoint.
    mockPrisma.menuItem.findMany.mockResolvedValue([]);

    await controller.getVenueMenu(venueId);

    const [callArgs] = mockPrisma.menuItem.findMany.mock.calls[0] as [
      { where: { deletedAt: unknown } },
    ];
    expect(callArgs.where.deletedAt).toBeNull();
  });

  it('throws NotFoundException for an inactive/unknown venue rather than leaking any menu data', async () => {
    mockPrisma.venue.findFirst.mockResolvedValue(null);

    await expect(controller.getVenueMenu(venueId)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('returns isAvailable:false items too — this endpoint is intentionally unfiltered', async () => {
    // Order Tablet/Admin Console (apps/admin-console/src/store/menu.store.ts)
    // reads this same endpoint and needs every item, including unavailable
    // ones, to render staff's grayed-out "86'd" cards. The public/customer
    // surfaces (apps/customer-website/src/shared/menu/menuClient.js) do their
    // own isAvailable filtering client-side instead — see
    // normalizePublicMenu's own regression suite
    // (menuClient.test.mjs) for that half of the contract. If this endpoint
    // is ever changed to filter server-side, Order Tablet's unavailable-item
    // display breaks.
    mockPrisma.menuItem.findMany.mockResolvedValue([
      { id: 'item-1', title: 'Not Yet Reviewed', priceCents: 0, isAvailable: false },
    ]);

    const result = await controller.getVenueMenu(venueId);

    expect(result.menuItems).toHaveLength(1);
    expect(result.menuItems[0].isAvailable).toBe(false);
  });
});
