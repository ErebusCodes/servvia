import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ChannelMenuController } from './channel-menu.controller';
import { PrismaService } from '../prisma/prisma.service';
import { RateLimitGuard } from '../auth/guards/rate-limit.guard';

// The positive analogue of kiosk.controller.spec.ts's "intentionally
// unfiltered" test — this endpoint is intentionally FILTERED, the
// opposite guarantee, for the same reason: it is the structural fix for
// the confirmed live leak (window-display's `/order` route showing all
// ~895 items, including all unreviewed staging rows, because the old
// kiosk endpoint has no server-side filter at all).

const mockPrisma = {
  venue: { findFirst: jest.fn() },
  category: { findMany: jest.fn() },
  menuItem: { findMany: jest.fn() },
  menuItemVenueOverride: { findMany: jest.fn() },
};

const venueId = '10000000-0000-4000-8000-000000000001';

describe('ChannelMenuController#getChannelMenu', () => {
  let controller: ChannelMenuController;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ChannelMenuController],
      providers: [{ provide: PrismaService, useValue: mockPrisma }],
    })
      .overrideGuard(RateLimitGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<ChannelMenuController>(ChannelMenuController);

    mockPrisma.venue.findFirst.mockResolvedValue({
      id: venueId,
      organizationId: 'org-1',
      isActive: true,
    });
    mockPrisma.menuItemVenueOverride.findMany.mockResolvedValue([]);
  });

  it('404s for a venue that does not exist or is inactive', async () => {
    mockPrisma.venue.findFirst.mockResolvedValue(null);
    await expect(controller.getChannelMenu(venueId, 'customer_website')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('404s for an unrecognized channel rather than silently returning an empty menu', async () => {
    await expect(controller.getChannelMenu(venueId, 'some_future_typo')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('never returns an item with an empty visibleChannels array (the pending_review candidate shape) on any of the three real channels', async () => {
    mockPrisma.category.findMany.mockImplementation(
      ({ where }: { where: { visibleChannels: { has: string } } }) =>
        Promise.resolve(
          [
            {
              id: 'cat-1',
              organizationId: 'org-1',
              isActive: true,
              visibleChannels: ['order_tablet', 'customer_website', 'window_display'],
            },
          ].filter((c) => c.visibleChannels.includes(where.visibleChannels.has)),
        ),
    );
    mockPrisma.menuItem.findMany.mockImplementation(
      ({ where }: { where: { visibleChannels: { has: string } } }) =>
        Promise.resolve(
          [
            {
              id: 'published',
              categoryId: 'cat-1',
              isAvailable: true,
              visibleChannels: ['order_tablet', 'customer_website', 'window_display'],
            },
            {
              id: 'unpublished-candidate',
              categoryId: 'cat-1',
              isAvailable: true,
              visibleChannels: [],
            },
          ].filter((i) => i.visibleChannels.includes(where.visibleChannels.has)),
        ),
    );

    for (const channel of ['order_tablet', 'customer_website', 'window_display']) {
      const result = await controller.getChannelMenu(venueId, channel);
      expect(result.menuItems.map((i: { id: string }) => i.id)).not.toContain(
        'unpublished-candidate',
      );
    }
  });
});
