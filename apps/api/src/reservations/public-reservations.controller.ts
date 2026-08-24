import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ReservationsService } from './reservations.service';
import { PublicCreateReservationDto } from './dto/public-create-reservation.dto';
import { RateLimitGuard } from '../auth/guards/rate-limit.guard';
import { RateLimit } from '../auth/decorators/rate-limit.decorator';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^\d{2}:\d{2}$/;

/**
 * Public, unauthenticated reservation surface for the customer-facing
 * booking wizard. Deliberately separate from ReservationsController
 * (admin/reservations, staff-only) rather than adding public routes to that
 * controller, so a guard/roles mistake there can never accidentally expose a
 * staff-only operation (list/update/status-transition/delete) publicly —
 * this controller only ever exposes availability lookup and creation, both
 * delegating to the same ReservationsService staff endpoints already use.
 */
@Controller('reservations')
@UseGuards(RateLimitGuard)
export class PublicReservationsController {
  constructor(private readonly reservationsService: ReservationsService) {}

  @Get('venues/:venueId/availability')
  @RateLimit({ limit: 60, windowSeconds: 60 })
  async availability(
    @Param('venueId', ParseUUIDPipe) venueId: string,
    @Query('date') date: string,
    @Query('time') time: string,
    @Query('partySize') partySize?: string,
  ) {
    if (!DATE_PATTERN.test(date ?? '')) {
      throw new BadRequestException('date must be in YYYY-MM-DD format');
    }
    if (!TIME_PATTERN.test(time ?? '')) {
      throw new BadRequestException('time must be in HH:MM (24h) format');
    }
    let parsedPartySize: number | undefined;
    if (partySize !== undefined) {
      parsedPartySize = Number(partySize);
      if (!Number.isInteger(parsedPartySize) || parsedPartySize < 1 || parsedPartySize > 100) {
        throw new BadRequestException('partySize must be an integer between 1 and 100');
      }
    }

    // Resolves the venue itself (404s if missing/inactive) before computing
    // availability, so a bad venueId reads as "not found," not "available".
    await this.reservationsService.resolvePublicVenue(venueId);
    return this.reservationsService.getAvailability(venueId, date, time, parsedPartySize);
  }

  @Post()
  @RateLimit({ limit: 10, windowSeconds: 900 })
  async create(@Body() dto: PublicCreateReservationDto) {
    const venue = await this.reservationsService.resolvePublicVenue(dto.venueId);
    // organizationId is resolved server-side from the venue row above, never
    // trusted from the client — dto has no organizationId field at all.
    return this.reservationsService.create(venue.organizationId, dto);
  }
}
