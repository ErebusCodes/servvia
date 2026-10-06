import { Test, TestingModule } from '@nestjs/testing';
import { PosCatalogController } from './pos-catalog.controller';
import { PosCatalogService } from './pos-catalog.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Staff, StaffRole } from '@prisma/client';
import { Request } from 'express';
import { VenueAccessGuard } from '../auth/venue-access/venue-access.guard';

const mockService = {
  listCandidates: jest.fn(),
  link: jest.fn(),
  unlink: jest.fn(),
};

const mockStaff = {
  id: 'staff-1',
  organizationId: 'org-1',
  role: StaffRole.admin,
} as Staff;

const mockReq = { user: mockStaff } as unknown as Request & { user: Staff };

describe('PosCatalogController', () => {
  let controller: PosCatalogController;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [PosCatalogController],
      providers: [{ provide: PosCatalogService, useValue: mockService }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(VenueAccessGuard)
      .useValue({ canActivate: () => true })
      .compile();
    controller = module.get<PosCatalogController>(PosCatalogController);
  });

  it("listCandidates scopes to the requesting staff member's organization and forwards status/tier filters", async () => {
    mockService.listCandidates.mockResolvedValue([{ id: 'candidate-1' }]);
    const result = await controller.listCandidates(
      mockReq,
      'pending_review',
      'high_confidence_active',
    );
    expect(mockService.listCandidates).toHaveBeenCalledWith('org-1', {
      status: 'pending_review',
      tier: 'high_confidence_active',
    });
    expect(result).toEqual([{ id: 'candidate-1' }]);
  });

  it('link forwards the candidate id, menuItemId, and organization to the service', async () => {
    mockService.link.mockResolvedValue({ id: 'candidate-1', menuItemId: 'item-1' });
    const result = await controller.link('candidate-1', { menuItemId: 'item-1' }, mockReq);
    expect(mockService.link).toHaveBeenCalledWith('org-1', 'candidate-1', 'item-1');
    expect(result).toEqual({ id: 'candidate-1', menuItemId: 'item-1' });
  });

  it('unlink forwards the candidate id and organization to the service', async () => {
    mockService.unlink.mockResolvedValue({ id: 'candidate-1', menuItemId: null });
    const result = await controller.unlink('candidate-1', mockReq);
    expect(mockService.unlink).toHaveBeenCalledWith('org-1', 'candidate-1');
    expect(result).toEqual({ id: 'candidate-1', menuItemId: null });
  });
});
