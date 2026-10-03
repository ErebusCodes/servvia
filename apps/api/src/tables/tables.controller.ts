import { Controller, Get, Post, Patch, Delete, Param, Body, UseGuards, Req } from '@nestjs/common';
import { TablesService } from './tables.service';
import { CreateTableDto } from './dto/create-table.dto';
import { UpdateTableDto } from './dto/update-table.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { TabletTokenActiveGuard } from '../auth/guards/tablet-token-active.guard';
import { StaffSessionOnlyGuard } from '../auth/guards/staff-session-only.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { StaffRole, Staff } from '@prisma/client';
import { Request } from 'express';
import { AuthenticatedUser } from '../auth/interfaces/jwt-payload.interface';
import { resolveVenueScope } from '../auth/utils/resolve-venue-scope';

@Controller('venues/:venueId/tables')
@UseGuards(JwtAuthGuard, RolesGuard)
export class TablesController {
  constructor(private readonly tablesService: TablesService) {}

  @Post()
  @UseGuards(StaffSessionOnlyGuard)
  @Roles(StaffRole.admin)
  async create(
    @Param('venueId') venueId: string,
    @Body() dto: CreateTableDto,
    @Req() req: Request & { user: Staff },
  ) {
    return this.tablesService.create(req.user.organizationId, venueId, dto);
  }

  // Includes StaffRole.kitchen so a venue-scoped KDS device token (see
  // resolveVenueScope) can read the real table list — it needs every table
  // (occupied and available), not just the public kiosk endpoint's
  // available-only subset. Also includes StaffRole.viewer: an unelevated
  // standalone Order Tablet's bare device token (story 15-1/DL-081) carries
  // that role — without it, this endpoint 403s and the restricted-mode
  // floor screen cannot resolve table numbers to real backend Table ids at
  // all (found via real browser validation, not merely a hypothetical gap).
  // TabletTokenActiveGuard re-checks live TabletDevice status for any
  // tablet_* token (a no-op for staff/kds_device) — found missing here
  // during this story's live-system revocation validation: a revoked
  // device's bare token otherwise kept reading this endpoint until its JWT
  // naturally expired, the same class of gap OrdersController's staff-tier
  // routes were already fixed for.
  @Get()
  @UseGuards(TabletTokenActiveGuard)
  @Roles(StaffRole.admin, StaffRole.manager, StaffRole.kitchen, StaffRole.viewer)
  async findAll(
    @Param('venueId') venueId: string,
    @Req() req: Request & { user: AuthenticatedUser },
  ) {
    resolveVenueScope(req.user, venueId);
    return this.tablesService.findAll(req.user.organizationId, venueId);
  }

  @Get(':id')
  @UseGuards(StaffSessionOnlyGuard)
  @Roles(StaffRole.admin, StaffRole.manager, StaffRole.kitchen)
  async findOne(
    @Param('venueId') venueId: string,
    @Param('id') id: string,
    @Req() req: Request & { user: AuthenticatedUser },
  ) {
    resolveVenueScope(req.user, venueId);
    return this.tablesService.findOne(id, venueId, req.user.organizationId);
  }

  @Patch(':id')
  @UseGuards(StaffSessionOnlyGuard)
  @Roles(StaffRole.admin)
  async update(
    @Param('venueId') venueId: string,
    @Param('id') id: string,
    @Body() dto: UpdateTableDto,
    @Req() req: Request & { user: Staff },
  ) {
    return this.tablesService.update(id, venueId, req.user.organizationId, dto);
  }

  @Delete(':id')
  @UseGuards(StaffSessionOnlyGuard)
  @Roles(StaffRole.admin)
  async remove(
    @Param('venueId') venueId: string,
    @Param('id') id: string,
    @Req() req: Request & { user: Staff },
  ) {
    return this.tablesService.remove(id, venueId, req.user.organizationId);
  }
}
