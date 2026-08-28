import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  NotFoundException,
  UseGuards,
} from '@nestjs/common';
import { MenuChannel } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RateLimit } from '../auth/decorators/rate-limit.decorator';
import { RateLimitGuard } from '../auth/guards/rate-limit.guard';
import { resolveChannelMenu } from './channel-menu-resolver';

const VALID_CHANNELS: readonly string[] = ['order_tablet', 'customer_website', 'window_display'];

/**
 * The canonical Menu Management channel endpoint — every customer/staff
 * facing surface should read from here, not from `GET /api/kiosk/venues/
 * :venueId/menu` (which stays alive during the Phase D migration but is
 * intentionally unfiltered and is being phased out as each frontend cuts
 * over). Unlike the kiosk endpoint, a response from here structurally
 * cannot include an unpublished/pending_review candidate — see
 * `resolveChannelMenu`'s own doc comment for why this is a property of
 * the data (empty `visibleChannels` by default), not a filter this
 * controller applies.
 */
@Controller('menu')
@UseGuards(RateLimitGuard)
export class ChannelMenuController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('venues/:venueId/channel/:channel')
  @RateLimit({ limit: 120, windowSeconds: 60 })
  async getChannelMenu(
    @Param('venueId', ParseUUIDPipe) venueId: string,
    @Param('channel') channel: string,
  ) {
    if (!VALID_CHANNELS.includes(channel)) {
      throw new NotFoundException(`Unknown channel "${channel}"`);
    }

    const venue = await this.prisma.venue.findFirst({ where: { id: venueId, isActive: true } });
    if (!venue) throw new NotFoundException('Venue not found');

    return resolveChannelMenu(this.prisma, {
      organizationId: venue.organizationId,
      venueId,
      channel: channel as MenuChannel,
    });
  }
}
