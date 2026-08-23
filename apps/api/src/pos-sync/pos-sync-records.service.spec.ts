/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-call */

import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PosSyncRecordsService } from './pos-sync-records.service';
import { PrismaService } from '../prisma/prisma.service';
import { POSSyncStatus } from '@prisma/client';

const mockPrisma: any = {
  venue: { findFirst: jest.fn() },
  order: { findFirst: jest.fn() },
  pOSSyncRecord: { findMany: jest.fn(), findUnique: jest.fn() },
};

describe('PosSyncRecordsService', () => {
  let service: PosSyncRecordsService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [PosSyncRecordsService, { provide: PrismaService, useValue: mockPrisma }],
    }).compile();
    service = module.get<PosSyncRecordsService>(PosSyncRecordsService);
  });

  describe('listForVenue', () => {
    it('throws NotFoundException when the venue does not belong to the caller organization', async () => {
      mockPrisma.venue.findFirst.mockResolvedValue(null);
      await expect(service.listForVenue('venue-1', 'org-1')).rejects.toThrow(NotFoundException);
      expect(mockPrisma.pOSSyncRecord.findMany).not.toHaveBeenCalled();
    });

    it('returns records ordered by createdAt desc, scoped to the venue', async () => {
      mockPrisma.venue.findFirst.mockResolvedValue({ id: 'venue-1', organizationId: 'org-1' });
      mockPrisma.pOSSyncRecord.findMany.mockResolvedValue([{ id: 'r1' }]);

      const result = await service.listForVenue('venue-1', 'org-1');

      expect(mockPrisma.pOSSyncRecord.findMany).toHaveBeenCalledWith({
        where: { venueId: 'venue-1' },
        orderBy: { createdAt: 'desc' },
        take: 100,
      });
      expect(result).toEqual([{ id: 'r1' }]);
    });

    it('rejects an invalid status filter', async () => {
      mockPrisma.venue.findFirst.mockResolvedValue({ id: 'venue-1', organizationId: 'org-1' });
      await expect(service.listForVenue('venue-1', 'org-1', 'bogus_status')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('applies a valid status filter', async () => {
      mockPrisma.venue.findFirst.mockResolvedValue({ id: 'venue-1', organizationId: 'org-1' });
      mockPrisma.pOSSyncRecord.findMany.mockResolvedValue([]);

      await service.listForVenue('venue-1', 'org-1', POSSyncStatus.unsupported);

      expect(mockPrisma.pOSSyncRecord.findMany).toHaveBeenCalledWith({
        where: { venueId: 'venue-1', status: POSSyncStatus.unsupported },
        orderBy: { createdAt: 'desc' },
        take: 100,
      });
    });
  });

  describe('getForOrder', () => {
    it('throws NotFoundException when the order does not belong to the caller organization/venue scope', async () => {
      mockPrisma.order.findFirst.mockResolvedValue(null);
      await expect(service.getForOrder('order-1', 'org-1', undefined)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('returns the real POSSyncRecord when one exists', async () => {
      mockPrisma.order.findFirst.mockResolvedValue({ id: 'order-1', posSyncStatus: 'unsupported' });
      mockPrisma.pOSSyncRecord.findUnique.mockResolvedValue({
        id: 'r1',
        orderId: 'order-1',
        status: POSSyncStatus.unsupported,
      });

      const result = await service.getForOrder('order-1', 'org-1', undefined);

      expect(result).toEqual({ id: 'r1', orderId: 'order-1', status: POSSyncStatus.unsupported });
    });

    it('falls back to the Order.posSyncStatus mirror (not_applicable) when no record row exists', async () => {
      mockPrisma.order.findFirst.mockResolvedValue({
        id: 'order-1',
        posSyncStatus: POSSyncStatus.not_applicable,
      });
      mockPrisma.pOSSyncRecord.findUnique.mockResolvedValue(null);

      const result = await service.getForOrder('order-1', 'org-1', undefined);

      expect(result).toEqual({ orderId: 'order-1', status: POSSyncStatus.not_applicable });
    });

    it('scopes the lookup to a venue when provided (KDS device token case)', async () => {
      mockPrisma.order.findFirst.mockResolvedValue({ id: 'order-1', posSyncStatus: 'unsupported' });
      mockPrisma.pOSSyncRecord.findUnique.mockResolvedValue(null);

      await service.getForOrder('order-1', 'org-1', 'venue-1');

      expect(mockPrisma.order.findFirst).toHaveBeenCalledWith({
        where: { id: 'order-1', venue: { organizationId: 'org-1' }, venueId: 'venue-1' },
      });
    });
  });
});
