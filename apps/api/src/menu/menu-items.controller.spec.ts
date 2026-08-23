import { Test, TestingModule } from '@nestjs/testing';
import { MenuItemsController } from './menu-items.controller';
import { MenuItemsService } from './menu-items.service';
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

const mockStaff = { id: 'staff-1', organizationId: 'org-1', role: StaffRole.manager } as Staff;
const mockReq = { user: mockStaff } as unknown as Request & { user: Staff };

const mockItem = { id: 'item-1', title: 'Falafel Wrap', organizationId: 'org-1' };

describe('MenuItemsController', () => {
  let controller: MenuItemsController;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [MenuItemsController],
      providers: [{ provide: MenuItemsService, useValue: mockService }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .compile();
    controller = module.get<MenuItemsController>(MenuItemsController);
  });

  it('should be defined', () => expect(controller).toBeDefined());

  it('create delegates with org and staff id', async () => {
    mockService.create.mockResolvedValue(mockItem);
    const dto = {
      title: 'Falafel Wrap',
      description: 'Crispy',
      categoryId: 'cat-1',
      priceCents: 1500,
    };
    await controller.create(dto, mockReq);
    expect(mockService.create).toHaveBeenCalledWith('org-1', 'staff-1', dto);
  });

  it('findAll delegates with org id', async () => {
    mockService.findAll.mockResolvedValue([mockItem]);
    const result = await controller.findAll(mockReq);
    expect(mockService.findAll).toHaveBeenCalledWith('org-1');
    expect(result).toHaveLength(1);
  });

  it('findOne delegates with id and org id', async () => {
    mockService.findOne.mockResolvedValue(mockItem);
    await controller.findOne('item-1', mockReq);
    expect(mockService.findOne).toHaveBeenCalledWith('item-1', 'org-1');
  });

  it('update delegates with id, org id, dto', async () => {
    mockService.update.mockResolvedValue(mockItem);
    await controller.update('item-1', { title: 'Updated' }, mockReq);
    expect(mockService.update).toHaveBeenCalledWith('item-1', 'org-1', { title: 'Updated' });
  });

  it('remove delegates with id and org id', async () => {
    mockService.remove.mockResolvedValue(mockItem);
    await controller.remove('item-1', mockReq);
    expect(mockService.remove).toHaveBeenCalledWith('item-1', 'org-1');
  });
});
