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
