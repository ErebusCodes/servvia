import { Test, TestingModule } from '@nestjs/testing';
import { VenuesService } from './venues.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotFoundException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

const mockPrisma = {
  venue: {
    create: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
};

describe('VenuesService', () => {
  let service: VenuesService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [VenuesService, { provide: PrismaService, useValue: mockPrisma }],
    }).compile();

    service = module.get<VenuesService>(VenuesService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    const dto = {
      name: 'Verdura Auckland',
      slug: 'auckland',
      address: { street: '12 Wyndham Street', city: 'Auckland' },
      operatingHours: {},
      seatingCapacity: 80,
    };

    it('should create a venue successfully', async () => {
      mockPrisma.venue.findFirst.mockResolvedValue(null);
      mockPrisma.venue.create.mockResolvedValue({ id: 'venue-1', ...dto });

      const result = await service.create('org-1', dto);
      expect(result.id).toBe('venue-1');
      expect(mockPrisma.venue.create).toHaveBeenCalled();
    });

    it('should throw ConflictException if slug already exists in organization', async () => {
      mockPrisma.venue.findFirst.mockResolvedValue({ id: 'existing-1', slug: 'auckland' });

      await expect(service.create('org-1', dto)).rejects.toThrow(ConflictException);
    });

    it('should default NZ venue tax/locale metadata when not supplied', async () => {
      mockPrisma.venue.findFirst.mockResolvedValue(null);
      mockPrisma.venue.create.mockResolvedValue({ id: 'venue-1', ...dto });

      await service.create('org-1', dto);

      expect(mockPrisma.venue.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            timezone: 'Pacific/Auckland',
            currency: 'NZD',
            locale: 'en-NZ',
            taxJurisdiction: 'NZ_GST',
            pricesIncludeTax: true,
          }),
        }),
      );
    });

    it('should allow explicit tax/locale metadata to override the NZ defaults', async () => {
      mockPrisma.venue.findFirst.mockResolvedValue(null);
      const overrideDto = {
        ...dto,
        locale: 'en-AU',
        taxJurisdiction: 'AU_GST',
        pricesIncludeTax: false,
      };
      mockPrisma.venue.create.mockResolvedValue({ id: 'venue-1', ...overrideDto });

      await service.create('org-1', overrideDto);

      expect(mockPrisma.venue.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            locale: 'en-AU',
            taxJurisdiction: 'AU_GST',
            pricesIncludeTax: false,
          }),
        }),
      );
    });
  });

  describe('findAll', () => {
    it('should return all venues for an organization', async () => {
      const venues = [
        { id: '1', name: 'V1' },
        { id: '2', name: 'V2' },
      ];
      mockPrisma.venue.findMany.mockResolvedValue(venues);

      const result = await service.findAll('org-1');
      expect(result).toEqual(venues);
      expect(mockPrisma.venue.findMany).toHaveBeenCalledWith({
        where: { organizationId: 'org-1' },
        orderBy: { createdAt: 'asc' },
      });
    });
  });

  describe('findOne', () => {
    it('should return a venue if found', async () => {
      const venue = { id: 'venue-1', organizationId: 'org-1' };
      mockPrisma.venue.findFirst.mockResolvedValue(venue);

      const result = await service.findOne('venue-1', 'org-1');
      expect(result).toEqual(venue);
    });

    it('should throw NotFoundException if venue does not exist in org', async () => {
      mockPrisma.venue.findFirst.mockResolvedValue(null);

      await expect(service.findOne('venue-1', 'org-1')).rejects.toThrow(NotFoundException);
    });
  });

  describe('getTaxConfig', () => {
    it('should return only the tax/currency fields, org-scoped', async () => {
      const taxConfig = {
        currency: 'NZD',
        locale: 'en-NZ',
        taxJurisdiction: 'NZ_GST',
        pricesIncludeTax: true,
      };
      mockPrisma.venue.findFirst.mockResolvedValue(taxConfig);

      const result = await service.getTaxConfig('venue-1', 'org-1');

      expect(result).toEqual(taxConfig);
      expect(mockPrisma.venue.findFirst).toHaveBeenCalledWith({
        where: { id: 'venue-1', organizationId: 'org-1' },
        select: { currency: true, locale: true, taxJurisdiction: true, pricesIncludeTax: true },
      });
    });

    it('should throw NotFoundException if venue does not exist in org', async () => {
      mockPrisma.venue.findFirst.mockResolvedValue(null);

      await expect(service.getTaxConfig('venue-1', 'org-1')).rejects.toThrow(NotFoundException);
    });
  });

  describe('update', () => {
    const dto = { name: 'New Name', slug: 'new-slug' };

    it('should throw NotFoundException if venue not found', async () => {
      mockPrisma.venue.findFirst.mockResolvedValue(null);

      await expect(service.update('venue-1', 'org-1', dto)).rejects.toThrow(NotFoundException);
    });

    it('should throw ConflictException if new slug conflicts with another venue in org', async () => {
      mockPrisma.venue.findFirst
        .mockResolvedValueOnce({ id: 'venue-1', organizationId: 'org-1' }) // findOne checks
        .mockResolvedValueOnce({ id: 'venue-2', slug: 'new-slug' }); // slug uniqueness check

      await expect(service.update('venue-1', 'org-1', dto)).rejects.toThrow(ConflictException);
    });

    it('should update successfully', async () => {
      const existingVenue = { id: 'venue-1', organizationId: 'org-1', slug: 'old-slug' };
      mockPrisma.venue.findFirst
        .mockResolvedValueOnce(existingVenue) // findOne check
        .mockResolvedValueOnce(null); // slug uniqueness check
      mockPrisma.venue.update.mockResolvedValue({ ...existingVenue, ...dto });

      const result = await service.update('venue-1', 'org-1', dto);
      expect(result.slug).toBe('new-slug');
      expect(mockPrisma.venue.update).toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('should throw NotFoundException if venue not found', async () => {
      mockPrisma.venue.findFirst.mockResolvedValue(null);

      await expect(service.remove('venue-1', 'org-1')).rejects.toThrow(NotFoundException);
    });

    it('should delete a venue successfully', async () => {
      const venue = { id: 'venue-1', organizationId: 'org-1' };
      mockPrisma.venue.findFirst.mockResolvedValue(venue);
      mockPrisma.venue.delete.mockResolvedValue(venue);

      const result = await service.remove('venue-1', 'org-1');
      expect(result).toEqual(venue);
      expect(mockPrisma.venue.delete).toHaveBeenCalledWith({ where: { id: 'venue-1' } });
    });

    it('answers 409 when the venue has history that restricts deletion (e.g. audit records)', async () => {
      mockPrisma.venue.findFirst.mockResolvedValue({ id: 'venue-1', organizationId: 'org-1' });
      mockPrisma.venue.delete.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Foreign key constraint failed', {
          code: 'P2003',
          clientVersion: 'test',
        }),
      );
      await expect(service.remove('venue-1', 'org-1')).rejects.toThrow(ConflictException);
    });
  });
});
