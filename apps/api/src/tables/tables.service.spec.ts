import { Test, TestingModule } from '@nestjs/testing';
import { TablesService } from './tables.service';
import { PrismaService } from '../prisma/prisma.service';
import { BadRequestException, NotFoundException, ConflictException } from '@nestjs/common';

const mockPrisma = {
  venue: {
    findFirst: jest.fn(),
  },
  table: {
    create: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
};

describe('TablesService', () => {
  let service: TablesService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [TablesService, { provide: PrismaService, useValue: mockPrisma }],
    }).compile();

    service = module.get<TablesService>(TablesService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    const dto = {
      tableNumber: '1',
      capacity: 2,
      isActive: true,
      sortOrder: 1,
    };

    it('should create a table successfully if venue exists and belongs to org', async () => {
      mockPrisma.venue.findFirst.mockResolvedValue({ id: 'venue-1', organizationId: 'org-1' });
      mockPrisma.table.findFirst.mockResolvedValue(null);
      mockPrisma.table.create.mockResolvedValue({ id: 'table-1', venueId: 'venue-1', ...dto });

      const result = await service.create('org-1', 'venue-1', dto);
      expect(result.id).toBe('table-1');
      expect(mockPrisma.table.create).toHaveBeenCalled();
    });

    it('should throw NotFoundException if venue not found in organization', async () => {
      mockPrisma.venue.findFirst.mockResolvedValue(null);

      await expect(service.create('org-1', 'venue-1', dto)).rejects.toThrow(NotFoundException);
    });

    it('should throw ConflictException if tableNumber already exists in venue', async () => {
      mockPrisma.venue.findFirst.mockResolvedValue({ id: 'venue-1', organizationId: 'org-1' });
      mockPrisma.table.findFirst.mockResolvedValue({ id: 'existing-table', tableNumber: '1' });

      await expect(service.create('org-1', 'venue-1', dto)).rejects.toThrow(ConflictException);
    });

    it('persists posTableCode when provided and unique', async () => {
      mockPrisma.venue.findFirst.mockResolvedValue({ id: 'venue-1', organizationId: 'org-1' });
      mockPrisma.table.findFirst.mockResolvedValue(null); // no tableNumber conflict, no posTableCode conflict
      mockPrisma.table.create.mockResolvedValue({
        id: 'table-1',
        venueId: 'venue-1',
        ...dto,
        posTableCode: 'T5',
      });

      await service.create('org-1', 'venue-1', { ...dto, posTableCode: 'T5' });
      expect(mockPrisma.table.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ posTableCode: 'T5' }) }),
      );
    });

    it('throws ConflictException — not an opaque DB error — when posTableCode is already assigned to another table in this venue', async () => {
      mockPrisma.venue.findFirst.mockResolvedValue({ id: 'venue-1', organizationId: 'org-1' });
      mockPrisma.table.findFirst
        .mockResolvedValueOnce(null) // tableNumber conflict check: none
        .mockResolvedValueOnce({ id: 'other-table', posTableCode: 'T5' }); // posTableCode conflict check: found

      await expect(
        service.create('org-1', 'venue-1', { ...dto, posTableCode: 'T5' }),
      ).rejects.toThrow(ConflictException);
      expect(mockPrisma.table.create).not.toHaveBeenCalled();
    });
  });

  describe('findAll', () => {
    it('should return all tables for a venue', async () => {
      mockPrisma.venue.findFirst.mockResolvedValue({ id: 'venue-1', organizationId: 'org-1' });
      const tables = [
        { id: 't1', tableNumber: '1', capacity: 2 },
        { id: 't2', tableNumber: '2', capacity: 2 },
      ];
      mockPrisma.table.findMany.mockResolvedValue(tables);

      const result = await service.findAll('org-1', 'venue-1');
      expect(result).toEqual(tables);
      expect(mockPrisma.table.findMany).toHaveBeenCalledWith({
        where: { venueId: 'venue-1' },
        orderBy: { sortOrder: 'asc' },
      });
    });
  });

  describe('findOne', () => {
    it('should return a table if found', async () => {
      mockPrisma.venue.findFirst.mockResolvedValue({ id: 'venue-1', organizationId: 'org-1' });
      const table = { id: 'table-1', venueId: 'venue-1', tableNumber: '1' };
      mockPrisma.table.findFirst.mockResolvedValue(table);

      const result = await service.findOne('table-1', 'venue-1', 'org-1');
      expect(result).toEqual(table);
    });

    it('should throw NotFoundException if table does not exist', async () => {
      mockPrisma.venue.findFirst.mockResolvedValue({ id: 'venue-1', organizationId: 'org-1' });
      mockPrisma.table.findFirst.mockResolvedValue(null);

      await expect(service.findOne('table-1', 'venue-1', 'org-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('update', () => {
    const dto = { capacity: 4, tableNumber: '4' };

    it('should throw NotFoundException if table not found', async () => {
      mockPrisma.venue.findFirst.mockResolvedValue({ id: 'venue-1', organizationId: 'org-1' });
      mockPrisma.table.findFirst.mockResolvedValue(null);

      await expect(service.update('table-1', 'venue-1', 'org-1', dto)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw ConflictException if new tableNumber conflicts with another table in venue', async () => {
      mockPrisma.venue.findFirst.mockResolvedValue({ id: 'venue-1', organizationId: 'org-1' });
      mockPrisma.table.findFirst
        .mockResolvedValueOnce({ id: 'table-1', venueId: 'venue-1', tableNumber: '1' }) // findOne check
        .mockResolvedValueOnce({ id: 'table-2', tableNumber: '4' }); // duplicate check

      await expect(service.update('table-1', 'venue-1', 'org-1', dto)).rejects.toThrow(
        ConflictException,
      );
    });

    it('should update successfully', async () => {
      mockPrisma.venue.findFirst.mockResolvedValue({ id: 'venue-1', organizationId: 'org-1' });
      const existing = { id: 'table-1', venueId: 'venue-1', tableNumber: '1', capacity: 2 };
      mockPrisma.table.findFirst
        .mockResolvedValueOnce(existing) // findOne check
        .mockResolvedValueOnce(null); // duplicate check
      mockPrisma.table.update.mockResolvedValue({ ...existing, ...dto });

      const result = await service.update('table-1', 'venue-1', 'org-1', dto);
      expect(result.tableNumber).toBe('4');
      expect(result.capacity).toBe(4);
      expect(mockPrisma.table.update).toHaveBeenCalled();
    });

    it('throws ConflictException when posTableCode conflicts with another table, excluding itself from the check', async () => {
      mockPrisma.venue.findFirst.mockResolvedValue({ id: 'venue-1', organizationId: 'org-1' });
      const existing = { id: 'table-1', venueId: 'venue-1', tableNumber: '1', capacity: 2 };
      mockPrisma.table.findFirst
        .mockResolvedValueOnce(existing) // findOne check
        .mockResolvedValueOnce(null) // tableNumber duplicate check
        .mockResolvedValueOnce({ id: 'table-2', posTableCode: 'T9' }); // posTableCode conflict check

      await expect(
        service.update('table-1', 'venue-1', 'org-1', { ...dto, posTableCode: 'T9' }),
      ).rejects.toThrow(ConflictException);
      expect(mockPrisma.table.update).not.toHaveBeenCalled();
    });

    it('persists posTableCode on a successful update', async () => {
      mockPrisma.venue.findFirst.mockResolvedValue({ id: 'venue-1', organizationId: 'org-1' });
      const existing = { id: 'table-1', venueId: 'venue-1', tableNumber: '1', capacity: 2 };
      mockPrisma.table.findFirst
        .mockResolvedValueOnce(existing) // findOne check
        .mockResolvedValueOnce(null) // tableNumber duplicate check
        .mockResolvedValueOnce(null); // posTableCode conflict check: none
      mockPrisma.table.update.mockResolvedValue({ ...existing, ...dto, posTableCode: 'T9' });

      await service.update('table-1', 'venue-1', 'org-1', { ...dto, posTableCode: 'T9' });
      expect(mockPrisma.table.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ posTableCode: 'T9' }) }),
      );
    });
  });

  describe('remove', () => {
    it('should reject deletion of a canonical table', async () => {
      mockPrisma.venue.findFirst.mockResolvedValue({ id: 'venue-1', organizationId: 'org-1' });
      const table = { id: 'table-1', venueId: 'venue-1', tableNumber: '1' };
      mockPrisma.table.findFirst.mockResolvedValue(table);
      await expect(service.remove('table-1', 'venue-1', 'org-1')).rejects.toThrow(
        BadRequestException,
      );
    });
  });
});
