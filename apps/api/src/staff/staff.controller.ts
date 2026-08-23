import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { Staff, StaffRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { RateLimitGuard } from '../auth/guards/rate-limit.guard';
import { StaffSessionOnlyGuard } from '../auth/guards/staff-session-only.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { RateLimit } from '../auth/decorators/rate-limit.decorator';
import { StaffService } from './staff.service';
import { SetStaffPinDto } from './dto/set-staff-pin.dto';

/**
 * Minimal, narrowly-scoped Staff HTTP surface — story 15-1 (DL-081) needs
 * an authorized way to list staff and set/reset tablet PINs; a full Staff
 * CRUD API is out of this story's scope (StaffPage in Admin Console
 * remains its own, separately-owned surface). Only a genuine staff login
 * session may reach this controller (StaffSessionOnlyGuard).
 */
@Controller('admin/staff')
@UseGuards(JwtAuthGuard, RolesGuard, StaffSessionOnlyGuard, RateLimitGuard)
export class StaffController {
  constructor(private readonly staffService: StaffService) {}

  @Get()
  @Roles(StaffRole.admin, StaffRole.manager)
  async list(@Req() req: Request & { user: Staff }) {
    return this.staffService.listForOrganization(req.user.organizationId);
  }

  @Post(':id/tablet-pin')
  @Roles(StaffRole.admin, StaffRole.manager)
  @RateLimit({ limit: 10, windowSeconds: 900 })
  async setTabletPin(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetStaffPinDto,
    @Req() req: Request & { user: Staff },
  ): Promise<{ set: true }> {
    await this.staffService.setTabletPin(id, req.user.organizationId, dto.pin, req.user);
    return { set: true };
  }
}
