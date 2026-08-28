import { NotFoundException } from '@nestjs/common';
import { PosCatalogService } from './pos-catalog.service';
import * as syncPosCatalog from './sync-pos-catalog';

jest.mock('./sync-pos-catalog', () => ({
  linkPosCandidate: jest.fn(),
  unlinkPosCandidate: jest.fn(),
}));

const mockPrisma = {
  posProductIdentity: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
  },
};

describe('PosCatalogService', () => {
  let service: PosCatalogService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new PosCatalogService(mockPrisma as never);
  });

  describe('listCandidates', () => {
    it('scopes to organizationId and applies optional status/tier filters', async () => {
      mockPrisma.posProductIdentity.findMany.mockResolvedValue([]);
      await service.listCandidates('org-1', { status: 'pending_review', tier: 'ambiguous' });
      expect(mockPrisma.posProductIdentity.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            organizationId: 'org-1',
            lifecycleStatus: 'pending_review',
            confidenceTier: 'ambiguous',
          },
        }),
      );
    });

    it('omits status/tier from the where clause when not provided', async () => {
      mockPrisma.posProductIdentity.findMany.mockResolvedValue([]);
      await service.listCandidates('org-1', {});
      expect(mockPrisma.posProductIdentity.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { organizationId: 'org-1' } }),
      );
    });
  });

  describe('link', () => {
    it('throws NotFoundException when the candidate does not belong to the requesting organization', async () => {
      mockPrisma.posProductIdentity.findFirst.mockResolvedValue(null);
      await expect(service.link('org-1', 'candidate-1', 'item-1')).rejects.toThrow(
        NotFoundException,
      );
      expect(syncPosCatalog.linkPosCandidate).not.toHaveBeenCalled();
    });

    it('delegates to linkPosCandidate when the candidate exists in-org', async () => {
      mockPrisma.posProductIdentity.findFirst.mockResolvedValue({
        id: 'candidate-1',
        organizationId: 'org-1',
      });
      (syncPosCatalog.linkPosCandidate as jest.Mock).mockResolvedValue({
        id: 'candidate-1',
        menuItemId: 'item-1',
      });
      const result = await service.link('org-1', 'candidate-1', 'item-1');
      expect(syncPosCatalog.linkPosCandidate).toHaveBeenCalledWith(mockPrisma, {
        posProductIdentityId: 'candidate-1',
        menuItemId: 'item-1',
      });
      expect(result).toEqual({ id: 'candidate-1', menuItemId: 'item-1' });
    });

    it('translates a thrown precondition error into BadRequestException rather than a raw 500', async () => {
      mockPrisma.posProductIdentity.findFirst.mockResolvedValue({
        id: 'candidate-1',
        organizationId: 'org-1',
      });
      (syncPosCatalog.linkPosCandidate as jest.Mock).mockRejectedValue(new Error('already linked'));
      await expect(service.link('org-1', 'candidate-1', 'item-1')).rejects.toThrow(
        'already linked',
      );
    });
  });

  describe('unlink', () => {
    it('throws NotFoundException when the candidate does not belong to the requesting organization', async () => {
      mockPrisma.posProductIdentity.findFirst.mockResolvedValue(null);
      await expect(service.unlink('org-1', 'candidate-1')).rejects.toThrow(NotFoundException);
      expect(syncPosCatalog.unlinkPosCandidate).not.toHaveBeenCalled();
    });

    it('delegates to unlinkPosCandidate when the candidate exists in-org', async () => {
      mockPrisma.posProductIdentity.findFirst.mockResolvedValue({
        id: 'candidate-1',
        organizationId: 'org-1',
      });
      (syncPosCatalog.unlinkPosCandidate as jest.Mock).mockResolvedValue({
        id: 'candidate-1',
        menuItemId: null,
      });
      const result = await service.unlink('org-1', 'candidate-1');
      expect(syncPosCatalog.unlinkPosCandidate).toHaveBeenCalledWith(mockPrisma, 'candidate-1');
      expect(result).toEqual({ id: 'candidate-1', menuItemId: null });
    });
  });
});
