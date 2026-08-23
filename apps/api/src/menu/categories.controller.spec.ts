import { Test, TestingModule } from '@nestjs/testing';
import { CategoriesController } from './categories.controller';
import { CategoriesService } from './categories.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Staff, StaffRole } from '@prisma/client';
import { Request } from 'express';

const mockService = {
  create: jest.fn(),
  findAll: jest.fn(),
  findOne: jest.fn(),
  update: jest.fn(),
  remove: jest.fn(),
};

const mockStaff = {
  id: 'staff-1',
  organizationId: 'org-1',
  role: StaffRole.admin,
} as Staff;

const mockReq = { user: mockStaff } as unknown as Request & { user: Staff };

const mockCategory = {
  id: 'cat-1',
  organizationId: 'org-1',
  name: 'Mains',
  sortOrder: 0,
  isActive: true,
};

describe('CategoriesController', () => {
  let controller: CategoriesController;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [CategoriesController],
      providers: [{ provide: CategoriesService, useValue: mockService }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .compile();
    controller = module.get<CategoriesController>(CategoriesController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('create — delegates to service with org and staff id', async () => {
    mockService.create.mockResolvedValue(mockCategory);
    const result = await controller.create({ name: 'Mains' }, mockReq);
    expect(mockService.create).toHaveBeenCalledWith('org-1', 'staff-1', { name: 'Mains' });
    expect(result).toEqual(mockCategory);
  });

  it('findAll — delegates to service with org id', async () => {
    mockService.findAll.mockResolvedValue([mockCategory]);
    const result = await controller.findAll(mockReq);
    expect(mockService.findAll).toHaveBeenCalledWith('org-1');
    expect(result).toHaveLength(1);
  });

  it('findOne — delegates to service with id and org id', async () => {
    mockService.findOne.mockResolvedValue(mockCategory);
    const result = await controller.findOne('cat-1', mockReq);
    expect(mockService.findOne).toHaveBeenCalledWith('cat-1', 'org-1');
    expect(result).toEqual(mockCategory);
  });

  it('update — delegates to service', async () => {
    const updated = { ...mockCategory, name: 'Starters' };
    mockService.update.mockResolvedValue(updated);
    const result = await controller.update('cat-1', { name: 'Starters' }, mockReq);
    expect(mockService.update).toHaveBeenCalledWith('cat-1', 'org-1', { name: 'Starters' });
    expect(result.name).toBe('Starters');
  });

  it('remove — delegates to service', async () => {
    mockService.remove.mockResolvedValue(mockCategory);
    const result = await controller.remove('cat-1', mockReq);
    expect(mockService.remove).toHaveBeenCalledWith('cat-1', 'org-1');
    expect(result).toEqual(mockCategory);
  });
});
