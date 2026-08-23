import { Test, TestingModule } from '@nestjs/testing';
import { Request } from 'express';
import { ReservationStatus, Staff, StaffRole } from '@prisma/client';
import { ReservationsController } from './reservations.controller';
import { ReservationsService } from './reservations.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';

const mockService = {
  create: jest.fn(),
  findAll: jest.fn(),
  findOne: jest.fn(),
  update: jest.fn(),
  remove: jest.fn(),
  transition: jest.fn(),
};

const mockStaff = { id: 'staff-uuid', organizationId: 'org-uuid', role: StaffRole.admin } as Staff;
const mockReq = { user: mockStaff } as unknown as Request & { user: Staff };

describe('ReservationsController', () => {
  let controller: ReservationsController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ReservationsController],
      providers: [{ provide: ReservationsService, useValue: mockService }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<ReservationsController>(ReservationsController);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('create', () => {
    it('delegates to service.create with organizationId', async () => {
      const dto = {
        venueId: 'v1',
        guestName: 'Alice',
        guestEmail: 'a@b.com',
        partySize: 2,
        reservationDate: '2026-07-01',
        reservationTime: '19:00',
      };
      const expected = { id: 'r1', bookingRef: 'VR-1234' };
      mockService.create.mockResolvedValue(expected);

      const result = await controller.create(mockReq, dto);

      expect(mockService.create).toHaveBeenCalledWith('org-uuid', dto);
      expect(result).toEqual(expected);
    });
  });

  describe('findAll', () => {
    it('delegates to service.findAll with filters object containing query params', async () => {
      mockService.findAll.mockResolvedValue([]);

      await controller.findAll(
        mockReq,
        'venue-uuid',
        '2026-07-01',
        ReservationStatus.confirmed,
        'Alice',
      );

      expect(mockService.findAll).toHaveBeenCalledWith('org-uuid', {
        venueId: 'venue-uuid',
        date: '2026-07-01',
        status: ReservationStatus.confirmed,
        search: 'Alice',
      });
    });
  });

  describe('findOne', () => {
    it('delegates to service.findOne with id and organizationId', async () => {
      const expected = { id: 'r1', bookingRef: 'VR-1001' };
      mockService.findOne.mockResolvedValue(expected);

      const result = await controller.findOne(mockReq, 'r1');

      expect(mockService.findOne).toHaveBeenCalledWith('r1', 'org-uuid');
      expect(result).toEqual(expected);
    });
  });

  describe('update', () => {
    it('delegates to service.update with id, organizationId, and dto', async () => {
      const dto = { guestName: 'Bob' };
      const expected = { id: 'r1', guestName: 'Bob' };
      mockService.update.mockResolvedValue(expected);

      const result = await controller.update(mockReq, 'r1', dto);

      expect(mockService.update).toHaveBeenCalledWith('r1', 'org-uuid', dto);
      expect(result).toEqual(expected);
    });
  });

  describe('remove', () => {
    it('delegates to service.remove with id and organizationId', async () => {
      mockService.remove.mockResolvedValue(undefined);

      await controller.remove(mockReq, 'r1');

      expect(mockService.remove).toHaveBeenCalledWith('r1', 'org-uuid');
    });
  });

  describe('transitionStatus', () => {
    it('delegates to service.transition with id, organizationId, status, and staffId', async () => {
      const dto = { status: ReservationStatus.confirmed };
      const expected = { id: 'r1', status: 'confirmed' };
      mockService.transition.mockResolvedValue(expected);

      const result = await controller.transitionStatus(mockReq, 'r1', dto);

      expect(mockService.transition).toHaveBeenCalledWith(
        'r1',
        'org-uuid',
        ReservationStatus.confirmed,
        mockStaff.id,
      );
      expect(result).toEqual(expected);
    });
  });
});
