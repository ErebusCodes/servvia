import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';
import { Prisma, Reservation, ReservationStatus } from '@prisma/client';
import { Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { CreateReservationDto } from './dto/create-reservation.dto';
import { UpdateReservationDto } from './dto/update-reservation.dto';
import { QUEUE_NAMES } from '../queue/queue.module';
import { EmailJobPayload } from '../queue/processors/email-job.types';

@Injectable()
export class ReservationsService {
  private readonly logger = new Logger(ReservationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(QUEUE_NAMES.EMAILS) private readonly emailQueue: Queue,
  ) {}

  private async generateBookingRef(): Promise<string> {
    for (let attempt = 0; attempt < 10; attempt++) {
      const n = Math.floor(Math.random() * 9000) + 1000;
      const ref = `VR-${n}`;
      const exists = await this.prisma.reservation.findFirst({
        where: { bookingRef: ref },
      });
      if (!exists) return ref;
    }
    throw new ConflictException('Unable to generate unique booking reference');
  }

  private static readonly ACTIVE_STATUSES: ReservationStatus[] = [
    ReservationStatus.pending,
    ReservationStatus.confirmed,
    ReservationStatus.seated,
  ];

  /**
   * Real-time capacity for a venue/date/time slot, computed from actual
   * Reservation rows (not cached/estimated) — the single implementation of
   * this math, used by both the public availability endpoint and create()'s
   * own enforcement below, so the two can never drift apart.
   */
  async getAvailability(
    venueId: string,
    date: string,
    time: string,
    partySize?: number,
  ): Promise<{
    coversPerSlot: number;
    bookedCovers: number;
    remainingCovers: number;
    available: boolean;
  }> {
    const venue = await this.prisma.venue.findFirst({ where: { id: venueId, isActive: true } });
    if (!venue) throw new NotFoundException('Venue not found');

    const currentReservations = await this.prisma.reservation.findMany({
      where: {
        venueId,
        reservationDate: date,
        reservationTime: time,
        status: { in: ReservationsService.ACTIVE_STATUSES },
      },
      select: { partySize: true },
    });

    const bookedCovers = currentReservations.reduce((sum, r) => sum + r.partySize, 0);
    const remainingCovers = Math.max(0, venue.coversPerSlot - bookedCovers);
    const available = partySize != null ? remainingCovers >= partySize : remainingCovers > 0;

    return { coversPerSlot: venue.coversPerSlot, bookedCovers, remainingCovers, available };
  }

  /**
   * Looks up a venue for the public booking flow: no organizationId is
   * trusted from the client (there isn't one — the caller is unauthenticated)
   * — the venue's own organizationId is resolved server-side from its id and
   * returned for the caller to pass into create()/getAvailability().
   */
  async resolvePublicVenue(
    venueId: string,
  ): Promise<{ id: string; organizationId: string; name: string }> {
    const venue = await this.prisma.venue.findFirst({
      where: { id: venueId, isActive: true },
      select: { id: true, organizationId: true, name: true },
    });
    if (!venue) throw new NotFoundException('Venue not found');
    return venue;
  }

  async create(organizationId: string, dto: CreateReservationDto): Promise<Reservation> {
    const venue = await this.prisma.venue.findFirst({
      where: { id: dto.venueId, organizationId },
    });
    if (!venue) throw new NotFoundException('Venue not found');

    if (dto.tableId) {
      const table = await this.prisma.table.findFirst({
        where: { id: dto.tableId, venueId: dto.venueId, isActive: true },
        select: { id: true },
      });
      if (!table) throw new NotFoundException('Table not found for this venue');
    }

    const availability = await this.getAvailability(
      dto.venueId,
      dto.reservationDate,
      dto.reservationTime,
      dto.partySize,
    );
    if (!availability.available) {
      throw new ConflictException('Seating capacity exceeded for this time slot');
    }

    const bookingRef = await this.generateBookingRef();

    return this.prisma.reservation.create({
      data: {
        venueId: dto.venueId,
        bookingRef,
        guestName: dto.guestName,
        guestEmail: dto.guestEmail,
        guestPhone: dto.guestPhone,
        partySize: dto.partySize,
        reservationDate: dto.reservationDate,
        reservationTime: dto.reservationTime,
        tableId: dto.tableId,
        occasion: dto.occasion,
        specialRequests: dto.specialRequests,
        ...(dto.paymentMethod !== undefined ? { paymentMethod: dto.paymentMethod } : {}),
        ...(dto.menuSelections !== undefined
          ? { menuSelections: dto.menuSelections as Prisma.InputJsonValue }
          : {}),
        ...(dto.menuTotal !== undefined ? { menuTotal: dto.menuTotal } : {}),
        ...(dto.guests && dto.guests.length > 0
          ? {
              guests: {
                create: dto.guests.map((g) => ({
                  name: g.name,
                  dietaryPreferences: g.dietaryPreferences ?? [],
                })),
              },
            }
          : {}),
      },
    });
  }

  async findAll(
    organizationId: string,
    filtersOrVenueId?:
      | string
      | {
          venueId?: string;
          date?: string;
          status?: ReservationStatus;
          search?: string;
        },
  ): Promise<Reservation[]> {
    const where: Prisma.ReservationWhereInput = {
      venue: { organizationId },
    };

    if (typeof filtersOrVenueId === 'string') {
      where.venueId = filtersOrVenueId;
    } else if (filtersOrVenueId && typeof filtersOrVenueId === 'object') {
      if (filtersOrVenueId.venueId) {
        where.venueId = filtersOrVenueId.venueId;
      }
      if (filtersOrVenueId.date) {
        where.reservationDate = filtersOrVenueId.date;
      }
      if (filtersOrVenueId.status) {
        where.status = filtersOrVenueId.status;
      }
      if (filtersOrVenueId.search) {
        const searchLower = filtersOrVenueId.search.trim();
        if (searchLower) {
          where.OR = [
            { guestName: { contains: searchLower, mode: 'insensitive' } },
            { guestEmail: { contains: searchLower, mode: 'insensitive' } },
            { bookingRef: { contains: searchLower, mode: 'insensitive' } },
          ];
        }
      }
    }

    return this.prisma.reservation.findMany({
      where,
      orderBy: [{ reservationDate: 'asc' }, { reservationTime: 'asc' }],
    });
  }

  async findOne(id: string, organizationId: string): Promise<Reservation> {
    const reservation = await this.prisma.reservation.findFirst({
      where: { id, venue: { organizationId } },
    });
    if (!reservation) throw new NotFoundException('Reservation not found');
    return reservation;
  }

  async update(
    id: string,
    organizationId: string,
    dto: UpdateReservationDto,
  ): Promise<Reservation> {
    await this.findOne(id, organizationId);

    try {
      return await this.prisma.reservation.update({
        where: { id },
        data: { ...dto },
      });
    } catch (e) {
      if (e instanceof PrismaClientKnownRequestError && e.code === 'P2025') {
        throw new NotFoundException('Reservation not found');
      }
      throw e;
    }
  }

  async remove(id: string, organizationId: string): Promise<void> {
    await this.findOne(id, organizationId);
    try {
      await this.prisma.reservation.delete({ where: { id } });
    } catch (e) {
      if (e instanceof PrismaClientKnownRequestError && e.code === 'P2025') {
        throw new NotFoundException('Reservation not found');
      }
      throw e;
    }
  }

  private validateStatusTransition(
    oldStatus: ReservationStatus,
    newStatus: ReservationStatus,
  ): boolean {
    const allowedTransitions: Record<ReservationStatus, ReservationStatus[]> = {
      [ReservationStatus.pending]: [ReservationStatus.confirmed, ReservationStatus.cancelled],
      [ReservationStatus.confirmed]: [
        ReservationStatus.seated,
        ReservationStatus.cancelled,
        ReservationStatus.no_show,
      ],
      [ReservationStatus.seated]: [ReservationStatus.completed],
      [ReservationStatus.completed]: [],
      [ReservationStatus.cancelled]: [],
      [ReservationStatus.no_show]: [],
    };
    return (allowedTransitions[oldStatus] ?? []).includes(newStatus);
  }

  async transition(
    id: string,
    organizationId: string,
    newStatus: ReservationStatus,
    staffId: string,
  ): Promise<Reservation> {
    const reservation = await this.findOne(id, organizationId);

    if (!this.validateStatusTransition(reservation.status, newStatus)) {
      throw new ConflictException(
        `Invalid status transition from ${reservation.status} to ${newStatus}`,
      );
    }

    const updateData: {
      status: ReservationStatus;
      confirmedAt?: Date;
      cancelledAt?: Date;
      cancelledBy?: string;
    } = { status: newStatus };

    if (newStatus === ReservationStatus.confirmed) {
      updateData.confirmedAt = new Date();
    } else if (newStatus === ReservationStatus.cancelled) {
      updateData.cancelledAt = new Date();
      updateData.cancelledBy = staffId;
    }

    const updated = await this.prisma.reservation.update({
      where: { id },
      data: updateData,
    });

    if (newStatus === ReservationStatus.confirmed || newStatus === ReservationStatus.cancelled) {
      const venue = await this.prisma.venue.findFirst({ where: { id: reservation.venueId } });
      const payload: EmailJobPayload = {
        type:
          newStatus === ReservationStatus.confirmed
            ? 'reservation-confirmed'
            : 'reservation-cancelled',
        guestName: reservation.guestName,
        guestEmail: reservation.guestEmail,
        bookingRef: reservation.bookingRef,
        reservationDate: reservation.reservationDate,
        reservationTime: reservation.reservationTime,
        partySize: reservation.partySize,
        venueName: venue?.name ?? 'Verdura',
      };
      try {
        await this.emailQueue.add('send-email', payload, {
          attempts: 3,
          backoff: { type: 'exponential', delay: 2000 },
        });
      } catch (err) {
        this.logger.error('Failed to enqueue email job — transition still succeeds', err);
      }
    }

    return updated;
  }
}
