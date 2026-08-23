import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { ReservationStatus } from '@prisma/client';
import { getQueueToken } from '@nestjs/bullmq';
import { ReservationsService } from './reservations.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateReservationDto } from './dto/create-reservation.dto';
import { UpdateReservationDto } from './dto/update-reservation.dto';
import { QUEUE_NAMES } from '../queue/queue.module';

const mockPrisma = {
  venue: { findFirst: jest.fn() },
  reservation: {
    findFirst: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
};

const mockEmailQueue = { add: jest.fn().mockResolvedValue({ id: 'q-job-1' }) };

const orgId = 'org-uuid';
const dto: CreateReservationDto = {
  venueId: 'venue-uuid',
  guestName: 'Alice Smith',
  guestEmail: 'alice@example.com',
  partySize: 2,
  reservationDate: '2026-07-01',
  reservationTime: '19:00',
};
const mockVenue = { id: 'venue-uuid', organizationId: orgId, coversPerSlot: 20 };
const mockReservation = {
  id: 'res-uuid',
  bookingRef: 'VR-1234',
  status: 'pending',
  createdAt: new Date(),
  updatedAt: new Date(),
  ...dto,
};

describe('ReservationsService', () => {
  let service: ReservationsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReservationsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: getQueueToken(QUEUE_NAMES.EMAILS), useValue: mockEmailQueue },
      ],
    }).compile();

    service = module.get<ReservationsService>(ReservationsService);
    jest.clearAllMocks();
    mockPrisma.reservation.findMany.mockResolvedValue([]);
    mockEmailQueue.add.mockResolvedValue({ id: 'q-job-1' });
  });

  describe('create', () => {
    it('creates a reservation with a unique bookingRef', async () => {
      mockPrisma.venue.findFirst.mockResolvedValue(mockVenue);
      mockPrisma.reservation.findFirst.mockResolvedValue(null);
      mockPrisma.reservation.create.mockResolvedValue(mockReservation);

      const result = await service.create(orgId, dto);

      expect(mockPrisma.venue.findFirst).toHaveBeenCalledWith({
        where: { id: dto.venueId, organizationId: orgId },
      });
      expect(mockPrisma.reservation.create).toHaveBeenCalled();
      expect(result).toEqual(mockReservation);
    });

    it('retries bookingRef generation on collision', async () => {
      mockPrisma.venue.findFirst.mockResolvedValue(mockVenue);
      mockPrisma.reservation.findFirst
        .mockResolvedValueOnce({ bookingRef: 'VR-1234' })
        .mockResolvedValueOnce(null);
      mockPrisma.reservation.create.mockResolvedValue(mockReservation);

      await service.create(orgId, dto);

      expect(mockPrisma.reservation.findFirst).toHaveBeenCalledTimes(2);
    });

    it('throws ConflictException after 10 collision retries', async () => {
      mockPrisma.venue.findFirst.mockResolvedValue(mockVenue);
      mockPrisma.reservation.findFirst.mockResolvedValue({ bookingRef: 'VR-XXXX' });

      await expect(service.create(orgId, dto)).rejects.toThrow(ConflictException);
    });

    it('throws NotFoundException when venueId does not belong to org', async () => {
      mockPrisma.venue.findFirst.mockResolvedValue(null);

      await expect(service.create(orgId, dto)).rejects.toThrow(NotFoundException);
    });

    it('throws ConflictException when covers count exceeds coversPerSlot', async () => {
      mockPrisma.venue.findFirst.mockResolvedValue(mockVenue);
      mockPrisma.reservation.findMany.mockResolvedValue([{ partySize: 15 }, { partySize: 4 }]);

      await expect(service.create(orgId, dto)).rejects.toThrow(ConflictException);
    });

    it('allows booking when partySize exactly fills remaining capacity', async () => {
      mockPrisma.venue.findFirst.mockResolvedValue({ ...mockVenue, coversPerSlot: 10 });
      mockPrisma.reservation.findMany.mockResolvedValue([{ partySize: 8 }]);
      mockPrisma.reservation.findFirst.mockResolvedValue(null);
      mockPrisma.reservation.create.mockResolvedValue(mockReservation);

      await expect(service.create(orgId, dto)).resolves.toBeDefined();
    });

    it('allows booking when slot has remaining capacity', async () => {
      mockPrisma.venue.findFirst.mockResolvedValue(mockVenue);
      mockPrisma.reservation.findMany.mockResolvedValue([{ partySize: 5 }]);
      mockPrisma.reservation.findFirst.mockResolvedValue(null);
      mockPrisma.reservation.create.mockResolvedValue(mockReservation);

      await expect(service.create(orgId, dto)).resolves.toBeDefined();
    });

    it('queries capacity only for matching venue, date, and time with active statuses', async () => {
      mockPrisma.venue.findFirst.mockResolvedValue(mockVenue);
      mockPrisma.reservation.findMany.mockResolvedValue([]);
      mockPrisma.reservation.findFirst.mockResolvedValue(null);
      mockPrisma.reservation.create.mockResolvedValue(mockReservation);

      await service.create(orgId, dto);

      expect(mockPrisma.reservation.findMany).toHaveBeenCalledWith({
        where: {
          venueId: dto.venueId,
          reservationDate: dto.reservationDate,
          reservationTime: dto.reservationTime,
          status: {
            in: [ReservationStatus.pending, ReservationStatus.confirmed, ReservationStatus.seated],
          },
        },
        select: { partySize: true },
      });
    });
  });

  describe('getAvailability', () => {
    it('computes remaining covers from active-status reservations only', async () => {
      mockPrisma.venue.findFirst.mockResolvedValue(mockVenue);
      mockPrisma.reservation.findMany.mockResolvedValue([{ partySize: 3 }, { partySize: 2 }]);

      const result = await service.getAvailability('venue-1', '2026-07-01', '19:00', 4);

      expect(result.bookedCovers).toBe(5);
      expect(result.coversPerSlot).toBe(mockVenue.coversPerSlot);
      expect(result.remainingCovers).toBe(mockVenue.coversPerSlot - 5);
      expect(result.available).toBe(mockVenue.coversPerSlot - 5 >= 4);
    });

    it('throws NotFoundException for a missing/inactive venue', async () => {
      mockPrisma.venue.findFirst.mockResolvedValue(null);
      await expect(service.getAvailability('missing-venue', '2026-07-01', '19:00')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('findAll', () => {
    it('returns reservations scoped to organization', async () => {
      const reservations = [{ id: 'r1' }, { id: 'r2' }];
      mockPrisma.reservation.findMany.mockResolvedValue(reservations);

      const result = await service.findAll(orgId);

      expect(mockPrisma.reservation.findMany).toHaveBeenCalledWith({
        where: { venue: { organizationId: orgId } },
        orderBy: [{ reservationDate: 'asc' }, { reservationTime: 'asc' }],
      });
      expect(result).toEqual(reservations);
    });

    it('filters by venueId when provided', async () => {
      mockPrisma.reservation.findMany.mockResolvedValue([]);

      await service.findAll(orgId, 'venue-uuid');

      expect(mockPrisma.reservation.findMany).toHaveBeenCalledWith({
        where: { venue: { organizationId: orgId }, venueId: 'venue-uuid' },
        orderBy: [{ reservationDate: 'asc' }, { reservationTime: 'asc' }],
      });
    });

    it('filters by date when provided in filters object', async () => {
      mockPrisma.reservation.findMany.mockResolvedValue([]);

      await service.findAll(orgId, { date: '2026-07-01' });

      expect(mockPrisma.reservation.findMany).toHaveBeenCalledWith({
        where: { venue: { organizationId: orgId }, reservationDate: '2026-07-01' },
        orderBy: [{ reservationDate: 'asc' }, { reservationTime: 'asc' }],
      });
    });

    it('filters by status when provided in filters object', async () => {
      mockPrisma.reservation.findMany.mockResolvedValue([]);

      await service.findAll(orgId, { status: ReservationStatus.confirmed });

      expect(mockPrisma.reservation.findMany).toHaveBeenCalledWith({
        where: { venue: { organizationId: orgId }, status: ReservationStatus.confirmed },
        orderBy: [{ reservationDate: 'asc' }, { reservationTime: 'asc' }],
      });
    });

    it('filters by search text when provided in filters object', async () => {
      mockPrisma.reservation.findMany.mockResolvedValue([]);

      await service.findAll(orgId, { search: 'Alice' });

      expect(mockPrisma.reservation.findMany).toHaveBeenCalledWith({
        where: {
          venue: { organizationId: orgId },
          OR: [
            { guestName: { contains: 'Alice', mode: 'insensitive' } },
            { guestEmail: { contains: 'Alice', mode: 'insensitive' } },
            { bookingRef: { contains: 'Alice', mode: 'insensitive' } },
          ],
        },
        orderBy: [{ reservationDate: 'asc' }, { reservationTime: 'asc' }],
      });
    });
  });

  describe('findOne', () => {
    it('returns a reservation that belongs to the org', async () => {
      mockPrisma.reservation.findFirst.mockResolvedValue(mockReservation);

      const result = await service.findOne('res-uuid', orgId);

      expect(mockPrisma.reservation.findFirst).toHaveBeenCalledWith({
        where: { id: 'res-uuid', venue: { organizationId: orgId } },
      });
      expect(result).toEqual(mockReservation);
    });

    it('throws NotFoundException when not found', async () => {
      mockPrisma.reservation.findFirst.mockResolvedValue(null);

      await expect(service.findOne('bad-id', orgId)).rejects.toThrow(NotFoundException);
    });
  });

  describe('update', () => {
    const updateDto: UpdateReservationDto = { guestName: 'Bob Jones', partySize: 3 };

    it('updates a reservation', async () => {
      mockPrisma.reservation.findFirst.mockResolvedValue(mockReservation);
      mockPrisma.reservation.update.mockResolvedValue({ ...mockReservation, ...updateDto });

      const result = await service.update('res-uuid', orgId, updateDto);

      expect(result).toMatchObject({ guestName: 'Bob Jones', partySize: 3 });
    });

    it('throws NotFoundException when reservation not found', async () => {
      mockPrisma.reservation.findFirst.mockResolvedValue(null);

      await expect(service.update('bad-id', orgId, updateDto)).rejects.toThrow(NotFoundException);
    });
  });

  describe('remove', () => {
    it('deletes a reservation', async () => {
      mockPrisma.reservation.findFirst.mockResolvedValue(mockReservation);
      mockPrisma.reservation.delete.mockResolvedValue(undefined);

      await service.remove('res-uuid', orgId);

      expect(mockPrisma.reservation.delete).toHaveBeenCalledWith({ where: { id: 'res-uuid' } });
    });

    it('throws NotFoundException when reservation not found', async () => {
      mockPrisma.reservation.findFirst.mockResolvedValue(null);

      await expect(service.remove('bad-id', orgId)).rejects.toThrow(NotFoundException);
    });
  });

  describe('transition', () => {
    const staffId = 'staff-uuid';
    const mockVenueForTransition = {
      id: 'venue-uuid',
      name: 'Verdura Wellington',
      organizationId: orgId,
    };

    it('transitions from pending to confirmed and sets confirmedAt', async () => {
      mockPrisma.reservation.findFirst.mockResolvedValue({ ...mockReservation, status: 'pending' });
      const updated = { ...mockReservation, status: 'confirmed', confirmedAt: new Date() };
      mockPrisma.reservation.update.mockResolvedValue(updated);
      mockPrisma.venue.findFirst.mockResolvedValue(mockVenueForTransition);

      const result = await service.transition(
        'res-uuid',
        orgId,
        ReservationStatus.confirmed,
        staffId,
      );

      expect(result.status).toBe('confirmed');
      expect(mockPrisma.reservation.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'res-uuid' },
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          data: expect.objectContaining({
            status: 'confirmed',
            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
            confirmedAt: expect.any(Date),
          }),
        }),
      );
    });

    it('transitions to cancelled and sets cancelledAt and cancelledBy', async () => {
      mockPrisma.reservation.findFirst.mockResolvedValue({
        ...mockReservation,
        status: 'confirmed',
      });
      mockPrisma.reservation.update.mockResolvedValue({ ...mockReservation, status: 'cancelled' });
      mockPrisma.venue.findFirst.mockResolvedValue(mockVenueForTransition);

      await service.transition('res-uuid', orgId, ReservationStatus.cancelled, staffId);

      expect(mockPrisma.reservation.update).toHaveBeenCalledWith(
        expect.objectContaining({
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          data: expect.objectContaining({
            status: 'cancelled',
            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
            cancelledAt: expect.any(Date),
            cancelledBy: staffId,
          }),
        }),
      );
    });

    it('transitions from pending to cancelled without setting confirmedAt', async () => {
      mockPrisma.reservation.findFirst.mockResolvedValue({ ...mockReservation, status: 'pending' });
      mockPrisma.reservation.update.mockResolvedValue({ ...mockReservation, status: 'cancelled' });
      mockPrisma.venue.findFirst.mockResolvedValue(mockVenueForTransition);

      await service.transition('res-uuid', orgId, ReservationStatus.cancelled, staffId);

      expect(mockPrisma.reservation.update).toHaveBeenCalledWith(
        expect.objectContaining({
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          data: expect.not.objectContaining({ confirmedAt: expect.anything() }),
        }),
      );
    });

    it('throws ConflictException on invalid transition (completed → pending)', async () => {
      mockPrisma.reservation.findFirst.mockResolvedValue({
        ...mockReservation,
        status: 'completed',
      });

      await expect(
        service.transition('res-uuid', orgId, ReservationStatus.pending, staffId),
      ).rejects.toThrow(ConflictException);
    });

    it('throws ConflictException on terminal state transition (cancelled → confirmed)', async () => {
      mockPrisma.reservation.findFirst.mockResolvedValue({
        ...mockReservation,
        status: 'cancelled',
      });

      await expect(
        service.transition('res-uuid', orgId, ReservationStatus.confirmed, staffId),
      ).rejects.toThrow(ConflictException);
    });

    it('throws NotFoundException when reservation not found', async () => {
      mockPrisma.reservation.findFirst.mockResolvedValue(null);

      await expect(
        service.transition('bad-id', orgId, ReservationStatus.confirmed, staffId),
      ).rejects.toThrow(NotFoundException);
    });

    it('enqueues email job with correct payload on confirmed transition', async () => {
      mockPrisma.reservation.findFirst.mockResolvedValue({ ...mockReservation, status: 'pending' });
      mockPrisma.reservation.update.mockResolvedValue({ ...mockReservation, status: 'confirmed' });
      mockPrisma.venue.findFirst.mockResolvedValue(mockVenueForTransition);

      await service.transition('res-uuid', orgId, ReservationStatus.confirmed, staffId);

      expect(mockEmailQueue.add).toHaveBeenCalledWith(
        'send-email',
        expect.objectContaining({
          type: 'reservation-confirmed',
          guestEmail: 'alice@example.com',
          bookingRef: 'VR-1234',
          venueName: 'Verdura Wellington',
        }),
        expect.objectContaining({ attempts: 3 }),
      );
    });

    it('enqueues email job with correct payload on cancelled transition', async () => {
      mockPrisma.reservation.findFirst.mockResolvedValue({
        ...mockReservation,
        status: 'confirmed',
      });
      mockPrisma.reservation.update.mockResolvedValue({ ...mockReservation, status: 'cancelled' });
      mockPrisma.venue.findFirst.mockResolvedValue(mockVenueForTransition);

      await service.transition('res-uuid', orgId, ReservationStatus.cancelled, staffId);

      expect(mockEmailQueue.add).toHaveBeenCalledWith(
        'send-email',
        expect.objectContaining({ type: 'reservation-cancelled' }),
        expect.objectContaining({ attempts: 3 }),
      );
    });

    it('does NOT enqueue email for non-notifiable transitions (e.g. confirmed → seated)', async () => {
      mockPrisma.reservation.findFirst.mockResolvedValue({
        ...mockReservation,
        status: 'confirmed',
      });
      mockPrisma.reservation.update.mockResolvedValue({ ...mockReservation, status: 'seated' });

      await service.transition('res-uuid', orgId, ReservationStatus.seated, staffId);

      expect(mockEmailQueue.add).not.toHaveBeenCalled();
    });

    it('still resolves and returns updated reservation when emailQueue.add() throws', async () => {
      mockPrisma.reservation.findFirst.mockResolvedValue({ ...mockReservation, status: 'pending' });
      const updated = { ...mockReservation, status: 'confirmed' };
      mockPrisma.reservation.update.mockResolvedValue(updated);
      mockPrisma.venue.findFirst.mockResolvedValue(mockVenueForTransition);
      mockEmailQueue.add.mockRejectedValueOnce(new Error('Redis down'));

      const result = await service.transition(
        'res-uuid',
        orgId,
        ReservationStatus.confirmed,
        staffId,
      );

      expect(result).toEqual(updated);
    });

    it('uses "Verdura" as venueName fallback when venue lookup returns null', async () => {
      mockPrisma.reservation.findFirst.mockResolvedValue({ ...mockReservation, status: 'pending' });
      mockPrisma.reservation.update.mockResolvedValue({ ...mockReservation, status: 'confirmed' });
      mockPrisma.venue.findFirst.mockResolvedValue(null);

      await service.transition('res-uuid', orgId, ReservationStatus.confirmed, staffId);

      expect(mockEmailQueue.add).toHaveBeenCalledWith(
        'send-email',
        expect.objectContaining({ venueName: 'Verdura' }),
        expect.anything(),
      );
    });
  });
});
