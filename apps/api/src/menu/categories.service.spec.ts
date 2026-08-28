import { Test, TestingModule } from '@nestjs/testing';
import { CategoriesService } from './categories.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotFoundException } from '@nestjs/common';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';

const mockPrisma = {
  category: {
    create: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
};

const ORG_ID = 'org-1';
const STAFF_ID = 'staff-1';
const CAT_ID = 'cat-1';

const mockCategory = {
  id: CAT_ID,
  organizationId: ORG_ID,
  createdById: STAFF_ID,
  name: 'Mains',
  description: null,
  imageUrl: null,
  sortOrder: 0,
  isActive: true,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('CategoriesService', () => {
  let service: CategoriesService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [CategoriesService, { provide: PrismaService, useValue: mockPrisma }],
    }).compile();
    service = module.get<CategoriesService>(CategoriesService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    it('should create a category and call prisma with correct data', async () => {
      mockPrisma.category.create.mockResolvedValue(mockCategory);
      const result = await service.create(ORG_ID, STAFF_ID, { name: 'Mains' });
      expect(result.id).toBe(CAT_ID);
      expect(mockPrisma.category.create).toHaveBeenCalledWith({
        data: {
          organizationId: ORG_ID,
          createdById: STAFF_ID,
          name: 'Mains',
          description: undefined,
          imageUrl: undefined,
          sortOrder: 0,
          isActive: true,
          visibleChannels: [],
        },
      });
    });
  });

  describe('findAll', () => {
    it('should return all categories for the organisation', async () => {
      mockPrisma.category.findMany.mockResolvedValue([mockCategory]);
      const result = await service.findAll(ORG_ID);
      expect(result).toHaveLength(1);
      expect(mockPrisma.category.findMany).toHaveBeenCalledWith({
        where: { organizationId: ORG_ID },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      });
    });
  });

  describe('findOne', () => {
    it('should return a category by id', async () => {
      mockPrisma.category.findFirst.mockResolvedValue(mockCategory);
      const result = await service.findOne(CAT_ID, ORG_ID);
      expect(result.id).toBe(CAT_ID);
    });

    it('should throw NotFoundException if not found', async () => {
      mockPrisma.category.findFirst.mockResolvedValue(null);
      await expect(service.findOne('unknown', ORG_ID)).rejects.toThrow(NotFoundException);
    });
  });

  describe('update', () => {
    it('should update a category', async () => {
      mockPrisma.category.findFirst.mockResolvedValue(mockCategory);
      const updated = { ...mockCategory, name: 'Starters' };
      mockPrisma.category.update.mockResolvedValue(updated);
      const result = await service.update(CAT_ID, ORG_ID, { name: 'Starters' });
      expect(result.name).toBe('Starters');
    });

    it('should throw NotFoundException if category does not exist (findOne)', async () => {
      mockPrisma.category.findFirst.mockResolvedValue(null);
      await expect(service.update('unknown', ORG_ID, { name: 'X' })).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw NotFoundException if record deleted between check and write (P2025)', async () => {
      mockPrisma.category.findFirst.mockResolvedValue(mockCategory);
      mockPrisma.category.update.mockRejectedValue(
        new PrismaClientKnownRequestError('Record not found', {
          code: 'P2025',
          clientVersion: '5',
        }),
      );
      await expect(service.update(CAT_ID, ORG_ID, { name: 'X' })).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('remove', () => {
    it('should delete a category', async () => {
      mockPrisma.category.findFirst.mockResolvedValue(mockCategory);
      mockPrisma.category.delete.mockResolvedValue(mockCategory);
      const result = await service.remove(CAT_ID, ORG_ID);
      expect(result.id).toBe(CAT_ID);
      expect(mockPrisma.category.delete).toHaveBeenCalledWith({ where: { id: CAT_ID } });
    });

    it('should throw NotFoundException if category does not exist (findOne)', async () => {
      mockPrisma.category.findFirst.mockResolvedValue(null);
      await expect(service.remove('unknown', ORG_ID)).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException if record deleted between check and write (P2025)', async () => {
      mockPrisma.category.findFirst.mockResolvedValue(mockCategory);
      mockPrisma.category.delete.mockRejectedValue(
        new PrismaClientKnownRequestError('Record not found', {
          code: 'P2025',
          clientVersion: '5',
        }),
      );
      await expect(service.remove(CAT_ID, ORG_ID)).rejects.toThrow(NotFoundException);
    });
  });
});
