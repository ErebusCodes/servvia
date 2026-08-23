import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { Staff, StaffRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { RateLimitGuard } from '../auth/guards/rate-limit.guard';
import { StaffSessionOnlyGuard } from '../auth/guards/staff-session-only.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { RateLimit } from '../auth/decorators/rate-limit.decorator';
import { TabletAuthService, TabletDeviceView } from './tablet-auth.service';
import { CreateTabletEnrollmentDto } from './dto/create-tablet-enrollment.dto';

/**
 * Admin-facing surface for story 15-1's Order Tablet device identity:
 * an authorized admin/manager creates enrollment codes and can view/revoke
 * devices for a venue. Only a genuine staff login session may reach this
 * controller (StaffSessionOnlyGuard) — a tablet-elevated manager session
 * cannot use itself as a back door into device administration.
 */
@Controller('venues/:venueId/tablet-devices')
@UseGuards(JwtAuthGuard, RolesGuard, StaffSessionOnlyGuard, RateLimitGuard)
export class TabletDevicesAdminController {
  constructor(private readonly tabletAuthService: TabletAuthService) {}

  @Post('enrollments')
  @Roles(StaffRole.admin, StaffRole.manager)
  @RateLimit({ limit: 10, windowSeconds: 900 })
  async createEnrollment(
    @Param('venueId', ParseUUIDPipe) venueId: string,
    @Body() dto: CreateTabletEnrollmentDto,
    @Req() req: Request & { user: Staff },
  ): Promise<{ enrollmentId: string; bootstrapToken: string; expiresAt: Date }> {
    return this.tabletAuthService.createEnrollment(req.user.organizationId, venueId, dto.label, {
      id: req.user.id,
      email: req.user.email,
      role: req.user.role,
    });
  }

  @Get('devices')
  @Roles(StaffRole.admin, StaffRole.manager)
  async listDevices(
    @Param('venueId', ParseUUIDPipe) venueId: string,
    @Req() req: Request & { user: Staff },
  ): Promise<TabletDeviceView[]> {
    return this.tabletAuthService.listDevices(req.user.organizationId, venueId);
  }

  @Post('devices/:deviceId/revoke')
  @Roles(StaffRole.admin, StaffRole.manager)
  async revokeDevice(
    @Param('venueId', ParseUUIDPipe) venueId: string,
    @Param('deviceId', ParseUUIDPipe) deviceId: string,
    @Req() req: Request & { user: Staff },
  ): Promise<{ revoked: true }> {
    await this.tabletAuthService.revokeDevice(deviceId, req.user.organizationId, venueId, {
      id: req.user.id,
      email: req.user.email,
      role: req.user.role,
    });
    return { revoked: true };
  }
}
