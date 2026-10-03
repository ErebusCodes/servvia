import { Controller, Get, Post, Patch, Delete, Param, Body, UseGuards, Req } from '@nestjs/common';
import { VenuesService } from './venues.service';
import { CreateVenueDto } from './dto/create-venue.dto';
import { UpdateVenueDto } from './dto/update-venue.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { TabletTokenActiveGuard } from '../auth/guards/tablet-token-active.guard';
import { StaffSessionOnlyGuard } from '../auth/guards/staff-session-only.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { StaffRole, Staff } from '@prisma/client';
import { Request } from 'express';
import { AuthenticatedUser } from '../auth/interfaces/jwt-payload.interface';
import { resolveVenueScope } from '../auth/utils/resolve-venue-scope';

@Controller('venues')
@UseGuards(JwtAuthGuard, RolesGuard)
export class VenuesController {
  constructor(private readonly venuesService: VenuesService) {}

  @Post()
  @UseGuards(StaffSessionOnlyGuard)
  @Roles(StaffRole.admin)
  async create(@Body() dto: CreateVenueDto, @Req() req: Request & { user: Staff }) {
    return this.venuesService.create(req.user.organizationId, dto);
  }

  @Get()
  @UseGuards(StaffSessionOnlyGuard)
  @Roles(StaffRole.admin, StaffRole.manager)
  async findAll(@Req() req: Request & { user: Staff }) {
    return this.venuesService.findAll(req.user.organizationId);
  }

  @Get(':id')
  @UseGuards(StaffSessionOnlyGuard)
  @Roles(StaffRole.admin, StaffRole.manager)
  async findOne(@Param('id') id: string, @Req() req: Request & { user: Staff }) {
    return this.venuesService.findOne(id, req.user.organizationId);
  }

  // Roles include `kitchen` and `viewer` because this is also called by the
  // Order Tablet's billing calculation (story 15-4/15-1), which runs under
  // a kds_device token (role: kitchen) in KDS mode and under an unelevated
  // tablet_device token (role: viewer, story 15-1/DL-081) in standalone
  // restricted/customer mode — as well as under a full staff JWT when
  // embedded in the Admin Console. Only exposes the four low-sensitivity
  // tax/currency fields, never the full Venue record. Device-scoped kinds
  // are venue-pinned via resolveVenueScope — previously this endpoint never
  // called it at all, so any device token (of any kind already permitted
  // here) could read another venue's tax config by changing the path
  // param; found and closed during story 15-1's independent review, not
  // merely a hypothetical risk (staff tokens are unaffected: resolveVenueScope
  // is a no-op for kind `staff`/undefined).
  //
  // TabletTokenActiveGuard re-checks live TabletDevice status for any
  // tablet_* token (a no-op for staff/kds_device) — story 15-1's own
  // independent review found and fixed the identical gap on
  // TablesController.findAll after this route was already blocked on
  // DL-072's schema; applied here from the start now that this route ships,
  // so a revoked device's bare token cannot keep reading tax config until
  // its JWT naturally expires.
  @Get(':id/tax-config')
  @UseGuards(TabletTokenActiveGuard)
  @Roles(StaffRole.admin, StaffRole.manager, StaffRole.kitchen, StaffRole.viewer)
  async getTaxConfig(@Param('id') id: string, @Req() req: Request & { user: AuthenticatedUser }) {
    const scopedVenueId = resolveVenueScope(req.user, id);
    return this.venuesService.getTaxConfig(scopedVenueId!, req.user.organizationId);
  }

  @Patch(':id')
  @UseGuards(StaffSessionOnlyGuard)
  @Roles(StaffRole.admin)
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateVenueDto,
    @Req() req: Request & { user: Staff },
  ) {
    return this.venuesService.update(id, req.user.organizationId, dto);
  }

  @Delete(':id')
  @UseGuards(StaffSessionOnlyGuard)
  @Roles(StaffRole.admin)
  async remove(@Param('id') id: string, @Req() req: Request & { user: Staff }) {
    return this.venuesService.remove(id, req.user.organizationId);
  }
}
