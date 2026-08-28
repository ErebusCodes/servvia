import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PosCandidateConfidenceTier, PosSourceLifecycleStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { linkPosCandidate, unlinkPosCandidate } from './sync-pos-catalog';

export interface ListCandidatesQuery {
  status?: PosSourceLifecycleStatus;
  tier?: PosCandidateConfidenceTier;
}

/**
 * Thin service wrapping the pure `sync-pos-catalog.ts` functions with the
 * NestJS exception conventions this codebase's other admin controllers
 * use (`NotFoundException`/`BadRequestException`), and the org-scoped
 * read path for the review queue. The actual sync pass itself stays a CLI
 * operation (`prisma/scripts/sync-pos-catalog.ts`), matching
 * `import-idealpos-catalog.ts`'s and `apply-plu-mapping.ts`'s existing
 * precedent — this service only ever reads already-synced candidates and
 * links/unlinks them, it never talks to IdealPOS.
 */
@Injectable()
export class PosCatalogService {
  constructor(private readonly prisma: PrismaService) {}

  async listCandidates(organizationId: string, query: ListCandidatesQuery) {
    return this.prisma.posProductIdentity.findMany({
      where: {
        organizationId,
        ...(query.status ? { lifecycleStatus: query.status } : {}),
        ...(query.tier ? { confidenceTier: query.tier } : {}),
      },
      orderBy: [{ confidenceTier: 'asc' }, { nativeCode: 'asc' }],
      include: {
        menuItem: {
          select: {
            id: true,
            title: true,
            priceCents: true,
            category: { select: { name: true } },
          },
        },
      },
    });
  }

  async link(organizationId: string, candidateId: string, menuItemId: string) {
    const candidate = await this.prisma.posProductIdentity.findFirst({
      where: { id: candidateId, organizationId },
    });
    if (!candidate) throw new NotFoundException(`Candidate ${candidateId} not found`);

    try {
      return await linkPosCandidate(this.prisma, { posProductIdentityId: candidateId, menuItemId });
    } catch (e) {
      throw new BadRequestException(e instanceof Error ? e.message : 'Failed to link candidate');
    }
  }

  async unlink(organizationId: string, candidateId: string) {
    const candidate = await this.prisma.posProductIdentity.findFirst({
      where: { id: candidateId, organizationId },
    });
    if (!candidate) throw new NotFoundException(`Candidate ${candidateId} not found`);

    try {
      return await unlinkPosCandidate(this.prisma, candidateId);
    } catch (e) {
      throw new BadRequestException(e instanceof Error ? e.message : 'Failed to unlink candidate');
    }
  }
}
