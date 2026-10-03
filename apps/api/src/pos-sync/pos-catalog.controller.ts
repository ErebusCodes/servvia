import { Controller, Get, Post, Param, Body, Query, UseGuards, Req } from '@nestjs/common';
import { Request } from 'express';
import {
  PosCandidateConfidenceTier,
  PosSourceLifecycleStatus,
  Staff,
  StaffRole,
} from '@prisma/client';
import { PosCatalogService } from './pos-catalog.service';
import { LinkPosCandidateDto } from './dto/link-pos-candidate.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { StaffSessionOnlyGuard } from '../auth/guards/staff-session-only.guard';
import { Roles } from '../auth/decorators/roles.decorator';

/**
 * The POS Catalog Review workflow — the direct successor to running
 * `apply-plu-mapping.ts` by hand for every mapping. Read-only listing is
 * admin/manager (same tier as menu-item/category review); link/unlink are
 * admin-only, matching this codebase's existing convention that a
 * mutating menu-identity change requires the higher role
 * (`CategoriesController#update`/`#remove`).
 */
@Controller('admin/pos-catalog')
@UseGuards(JwtAuthGuard, RolesGuard, StaffSessionOnlyGuard)
export class PosCatalogController {
  constructor(private readonly posCatalogService: PosCatalogService) {}

  @Get('candidates')
  @Roles(StaffRole.admin, StaffRole.manager)
  async listCandidates(
    @Req() req: Request & { user: Staff },
    @Query('status') status?: PosSourceLifecycleStatus,
    @Query('tier') tier?: PosCandidateConfidenceTier,
  ) {
    return this.posCatalogService.listCandidates(req.user.organizationId, { status, tier });
  }

  @Post('candidates/:id/link')
  @Roles(StaffRole.admin)
  async link(
    @Param('id') id: string,
    @Body() dto: LinkPosCandidateDto,
    @Req() req: Request & { user: Staff },
  ) {
    return this.posCatalogService.link(req.user.organizationId, id, dto.menuItemId);
  }

  @Post('candidates/:id/unlink')
  @Roles(StaffRole.admin)
  async unlink(@Param('id') id: string, @Req() req: Request & { user: Staff }) {
    return this.posCatalogService.unlink(req.user.organizationId, id);
  }
}
