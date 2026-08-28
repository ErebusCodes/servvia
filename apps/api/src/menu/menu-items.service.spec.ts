import { Test, TestingModule } from '@nestjs/testing';
import { MenuItemsService } from './menu-items.service';
import { PrismaService } from '../prisma/prisma.service';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';

const mockPrisma = {
  category: {
    findFirst: jest.fn(),
  },
  menuItem: {
    create: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    updateMany: jest.fn(),
    deleteMany: jest.fn(),
  },
};

const ORG_ID = 'org-1';
const STAFF_ID = 'staff-1';
const ITEM_ID = 'item-1';

const mockItem = {
  id: ITEM_ID,
  organizationId: ORG_ID,
  createdById: STAFF_ID,
  categoryId: 'cat-1',
  title: 'Falafel Wrap',
  description: 'Crispy falafel in flatbread',
  priceCents: 1500,
  nutritionalDetails: {},
  modifierGroups: [],
  isSpicy: false,
  isAvailable: true,
  sortOrder: 0,
  deletedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('MenuItemsService', () => {
  let service: MenuItemsService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [MenuItemsService, { provide: PrismaService, useValue: mockPrisma }],
    }).compile();
    service = module.get<MenuItemsService>(MenuItemsService);
  });

  it('should be defined', () => expect(service).toBeDefined());

  describe('create', () => {
    it('creates a menu item with defaults', async () => {
      mockPrisma.category.findFirst.mockResolvedValue({ id: 'cat-1' });
      mockPrisma.menuItem.create.mockResolvedValue(mockItem);
      const result = await service.create(ORG_ID, STAFF_ID, {
        title: 'Falafel Wrap',
        description: 'Crispy falafel',
        categoryId: 'cat-1',
        priceCents: 1500,
      });
      expect(result.id).toBe(ITEM_ID);
      expect(mockPrisma.menuItem.create).toHaveBeenCalledWith({
        data: {
          organizationId: ORG_ID,
          createdById: STAFF_ID,
          categoryId: 'cat-1',
          title: 'Falafel Wrap',
          description: 'Crispy falafel',
          priceCents: 1500,
          subCategory: undefined,
          imageUrl: undefined,
          imageThumbnailUrl: undefined,
          nutritionalDetails: {},
          modifierGroups: [],
          isSpicy: false,
          isAvailable: true,
          isFeatured: false,
          sortOrder: 0,
          posProductCode: undefined,
          visibleChannels: [],
        },
      });
    });

    it('throws BadRequestException if categoryId not in org', async () => {
      mockPrisma.category.findFirst.mockResolvedValue(null);
      await expect(
        service.create(ORG_ID, STAFF_ID, {
          title: 'Falafel Wrap',
          description: 'Crispy falafel',
          categoryId: 'other-org-cat',
          priceCents: 1500,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('persists posProductCode when provided and unique', async () => {
      mockPrisma.category.findFirst.mockResolvedValue({ id: 'cat-1' });
      mockPrisma.menuItem.findFirst.mockResolvedValue(null); // posProductCode conflict check: none
      mockPrisma.menuItem.create.mockResolvedValue({ ...mockItem, posProductCode: 'PLU-99' });

      await service.create(ORG_ID, STAFF_ID, {
        title: 'Falafel Wrap',
        description: 'Crispy falafel',
        categoryId: 'cat-1',
        priceCents: 1500,
        posProductCode: 'PLU-99',
      });
      expect(mockPrisma.menuItem.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ posProductCode: 'PLU-99' }) }),
      );
    });

    it('throws ConflictException — not an opaque DB error — when posProductCode is already assigned to another menu item in this organization', async () => {
      mockPrisma.category.findFirst.mockResolvedValue({ id: 'cat-1' });
      mockPrisma.menuItem.findFirst.mockResolvedValue({
        id: 'other-item',
        title: 'Existing Dish',
        posProductCode: 'PLU-99',
      });

      await expect(
        service.create(ORG_ID, STAFF_ID, {
          title: 'Falafel Wrap',
          description: 'Crispy falafel',
          categoryId: 'cat-1',
          priceCents: 1500,
          posProductCode: 'PLU-99',
        }),
      ).rejects.toThrow(ConflictException);
      expect(mockPrisma.menuItem.create).not.toHaveBeenCalled();
    });
  });

  describe('findAll', () => {
    it('returns items excluding soft-deleted', async () => {
      mockPrisma.menuItem.findMany.mockResolvedValue([mockItem]);
      const result = await service.findAll(ORG_ID);
      expect(result).toHaveLength(1);
      expect(mockPrisma.menuItem.findMany).toHaveBeenCalledWith({
        where: { organizationId: ORG_ID, deletedAt: null },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        include: { posIdentity: true },
      });
    });
  });

  describe('findOne', () => {
    it('returns an item by id', async () => {
      mockPrisma.menuItem.findFirst.mockResolvedValue(mockItem);
      const result = await service.findOne(ITEM_ID, ORG_ID);
      expect(result.id).toBe(ITEM_ID);
      expect(mockPrisma.menuItem.findFirst).toHaveBeenCalledWith({
        where: { id: ITEM_ID, organizationId: ORG_ID, deletedAt: null },
        include: { posIdentity: true },
      });
    });

    it('throws NotFoundException when not found', async () => {
      mockPrisma.menuItem.findFirst.mockResolvedValue(null);
      await expect(service.findOne('x', ORG_ID)).rejects.toThrow(NotFoundException);
    });
  });

  describe('update', () => {
    it('updates a menu item', async () => {
      mockPrisma.menuItem.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.menuItem.findFirst.mockResolvedValue({ ...mockItem, title: 'Updated' });
      const result = await service.update(ITEM_ID, ORG_ID, { title: 'Updated' });
      expect(result.title).toBe('Updated');
    });

    it('throws NotFoundException when item not found or wrong org', async () => {
      mockPrisma.menuItem.updateMany.mockResolvedValue({ count: 0 });
      await expect(service.update('x', ORG_ID, { title: 'X' })).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException if categoryId not in org', async () => {
      mockPrisma.category.findFirst.mockResolvedValue(null);
      await expect(
        service.update(ITEM_ID, ORG_ID, { categoryId: 'other-org-cat' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws ConflictException when posProductCode conflicts with another item, excluding itself from the check', async () => {
      mockPrisma.menuItem.findFirst.mockResolvedValue({
        id: 'other-item',
        title: 'Existing Dish',
        posProductCode: 'PLU-99',
      });
      await expect(service.update(ITEM_ID, ORG_ID, { posProductCode: 'PLU-99' })).rejects.toThrow(
        ConflictException,
      );
      expect(mockPrisma.menuItem.updateMany).not.toHaveBeenCalled();
    });

    it('persists posProductCode on a successful update', async () => {
      mockPrisma.menuItem.findFirst
        .mockResolvedValueOnce(null) // posProductCode conflict check: none
        .mockResolvedValueOnce({ ...mockItem, posProductCode: 'PLU-99' }); // post-update refetch
      mockPrisma.menuItem.updateMany.mockResolvedValue({ count: 1 });

      await service.update(ITEM_ID, ORG_ID, { posProductCode: 'PLU-99' });
      expect(mockPrisma.menuItem.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ posProductCode: 'PLU-99' }) }),
      );
    });
  });

  // Story 15-3: real modifier-group authoring — this is the minimal
  // Menu Management authoring path that lets the Order Tablet ever show
  // anything other than an empty catalog.
  describe('modifier group authoring (Story 15-3)', () => {
    it('assigns a stable id to a new group/option that omits one', async () => {
      mockPrisma.category.findFirst.mockResolvedValue({ id: 'cat-1' });
      mockPrisma.menuItem.create.mockResolvedValue(mockItem);

      await service.create(ORG_ID, STAFF_ID, {
        title: 'Falafel Wrap',
        description: 'Crispy falafel',
        categoryId: 'cat-1',
        priceCents: 1500,
        modifierGroups: [
          {
            name: 'Sauce',
            required: true,
            minSelections: 1,
            maxSelections: 1,
            options: [{ name: 'Garlic', priceDeltaCents: 50, isAvailable: true, sortOrder: 0 }],
          },
        ],
      });

      const created = mockPrisma.menuItem.create.mock.calls[0][0].data.modifierGroups;
      expect(created).toHaveLength(1);
      expect(typeof created[0].id).toBe('string');
      expect(created[0].id.length).toBeGreaterThan(0);
      expect(typeof created[0].options[0].id).toBe('string');
    });

    it('preserves a client-supplied id for an existing group/option (an edit, not a new entry)', async () => {
      mockPrisma.category.findFirst.mockResolvedValue({ id: 'cat-1' });
      mockPrisma.menuItem.create.mockResolvedValue(mockItem);

      await service.create(ORG_ID, STAFF_ID, {
        title: 'Falafel Wrap',
        description: 'Crispy falafel',
        categoryId: 'cat-1',
        priceCents: 1500,
        modifierGroups: [
          {
            id: 'existing-group-id',
            name: 'Sauce',
            required: true,
            minSelections: 1,
            maxSelections: 1,
            options: [
              {
                id: 'existing-option-id',
                name: 'Garlic',
                priceDeltaCents: 50,
                isAvailable: true,
                sortOrder: 0,
              },
            ],
          },
        ],
      });

      const created = mockPrisma.menuItem.create.mock.calls[0][0].data.modifierGroups;
      expect(created[0].id).toBe('existing-group-id');
      expect(created[0].options[0].id).toBe('existing-option-id');
    });

    it('rejects a group whose maxSelections is less than minSelections', async () => {
      mockPrisma.category.findFirst.mockResolvedValue({ id: 'cat-1' });

      await expect(
        service.create(ORG_ID, STAFF_ID, {
          title: 'Falafel Wrap',
          description: 'Crispy falafel',
          categoryId: 'cat-1',
          priceCents: 1500,
          modifierGroups: [
            {
              name: 'Sauce',
              required: false,
              minSelections: 2,
              maxSelections: 1,
              options: [{ name: 'Garlic', priceDeltaCents: 50, isAvailable: true, sortOrder: 0 }],
            },
          ],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects a required group with minSelections 0', async () => {
      mockPrisma.category.findFirst.mockResolvedValue({ id: 'cat-1' });

      await expect(
        service.create(ORG_ID, STAFF_ID, {
          title: 'Falafel Wrap',
          description: 'Crispy falafel',
          categoryId: 'cat-1',
          priceCents: 1500,
          modifierGroups: [
            {
              name: 'Sauce',
              required: true,
              minSelections: 0,
              maxSelections: 1,
              options: [{ name: 'Garlic', priceDeltaCents: 50, isAvailable: true, sortOrder: 0 }],
            },
          ],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects duplicate option ids within one group', async () => {
      mockPrisma.category.findFirst.mockResolvedValue({ id: 'cat-1' });

      await expect(
        service.create(ORG_ID, STAFF_ID, {
          title: 'Falafel Wrap',
          description: 'Crispy falafel',
          categoryId: 'cat-1',
          priceCents: 1500,
          modifierGroups: [
            {
              name: 'Sauce',
              required: false,
              minSelections: 0,
              maxSelections: 2,
              options: [
                { id: 'dup', name: 'Garlic', priceDeltaCents: 50, isAvailable: true, sortOrder: 0 },
                { id: 'dup', name: 'Chili', priceDeltaCents: 50, isAvailable: true, sortOrder: 1 },
              ],
            },
          ],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('an update that omits modifierGroups leaves existing groups untouched (not wiped to [])', async () => {
      mockPrisma.menuItem.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.menuItem.findFirst.mockResolvedValue(mockItem);

      await service.update(ITEM_ID, ORG_ID, { title: 'Renamed' });

      const updateCall = mockPrisma.menuItem.updateMany.mock.calls[0][0];
      expect(updateCall.data.modifierGroups).toBeUndefined();
    });
  });

  describe('remove', () => {
    it('deletes a menu item (soft delete)', async () => {
      mockPrisma.menuItem.updateMany.mockResolvedValue({ count: 1 });
      await expect(service.remove(ITEM_ID, ORG_ID)).resolves.toBeUndefined();
      expect(mockPrisma.menuItem.updateMany).toHaveBeenCalledWith({
        where: { id: ITEM_ID, organizationId: ORG_ID, deletedAt: null },

        data: { deletedAt: expect.any(Date) },
      });
    });

    it('throws NotFoundException when item not found or wrong org', async () => {
      mockPrisma.menuItem.updateMany.mockResolvedValue({ count: 0 });
      await expect(service.remove('x', ORG_ID)).rejects.toThrow(NotFoundException);
    });
  });
});
