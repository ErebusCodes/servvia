import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  NotFoundException,
  UseGuards,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RateLimit } from '../auth/decorators/rate-limit.decorator';
import { RateLimitGuard } from '../auth/guards/rate-limit.guard';

@Controller('kiosk')
@UseGuards(RateLimitGuard)
export class KioskController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('venues/:venueId/tables')
  @RateLimit({ limit: 120, windowSeconds: 60 })
  async getActiveTables(@Param('venueId', ParseUUIDPipe) venueId: string) {
    await this.requireActiveVenue(venueId);
    return this.prisma.table.findMany({
      where: {
        venueId,
        isActive: true,
        orders: {
          none: {
            status: {
              in: ['pending', 'confirmed', 'preparing', 'ready'],
            },
          },
        },
      },
      orderBy: { sortOrder: 'asc' },
      select: { id: true, tableNumber: true, name: true, capacity: true, sortOrder: true },
    });
  }

  /**
   * DEPRECATED (Phase D, Menu Management architecture) — superseded by
   * `GET /api/menu/venues/:venueId/channel/:channel`
   * (`ChannelMenuController`/`resolveChannelMenu`). As of this commit, no
   * application code in this repository calls this endpoint anymore
   * (Order Tablet, Customer Website, and Window Display have all migrated
   * to their respective channel); confirmed by a full-repo grep before
   * writing this comment. Left in place, unchanged, deliberately: the
   * CURRENTLY DEPLOYED production frontend build (pre-Phase-D) still calls
   * this endpoint against the live production API, since Phase B/C/D have
   * not been deployed yet — removing or altering this now would break
   * production before the coordinated Phase E deployment cuts every
   * channel over together. Safe to delete once Phase E's deployment step
   * confirms production is fully running the migrated frontends.
   */
  @Get('venues/:venueId/menu')
  @RateLimit({ limit: 120, windowSeconds: 60 })
  async getVenueMenu(@Param('venueId', ParseUUIDPipe) venueId: string) {
    const venue = await this.requireActiveVenue(venueId);

    const categories = await this.prisma.category.findMany({
      where: { organizationId: venue.organizationId, isActive: true },
      orderBy: { sortOrder: 'asc' },
    });

    const menuItems = await this.prisma.menuItem.findMany({
      where: { organizationId: venue.organizationId, deletedAt: null },
      orderBy: { sortOrder: 'asc' },
    });

    const overrides = await this.prisma.menuItemVenueOverride.findMany({
      where: { venueId },
    });

    const overrideMap = new Map(overrides.map((o) => [o.menuItemId, o]));

    const mergedItems = menuItems.map((item) => {
      const itemOverride = overrideMap.get(item.id);
      return {
        ...item,
        priceCents: itemOverride?.priceCents ?? item.priceCents,
        isAvailable: itemOverride?.isAvailable ?? item.isAvailable,
      };
    });

    return {
      categories,
      menuItems: mergedItems,
    };
  }

  private async requireActiveVenue(venueId: string) {
    const venue = await this.prisma.venue.findFirst({
      where: { id: venueId, isActive: true },
    });
    if (!venue) throw new NotFoundException('Venue not found');
    return venue;
  }
}
