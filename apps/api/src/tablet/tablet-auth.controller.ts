import { Body, Controller, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { StaffRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RateLimitGuard } from '../auth/guards/rate-limit.guard';
import { RateLimit } from '../auth/decorators/rate-limit.decorator';
import { AuthenticatedUser } from '../auth/interfaces/jwt-payload.interface';
import { TabletAuthService } from './tablet-auth.service';
import { TabletDeviceGuard } from './guards/tablet-device.guard';
import { EnrollTabletDeviceDto } from './dto/enroll-tablet-device.dto';
import { TabletUnlockDto } from './dto/tablet-unlock.dto';
import { TabletStaffElevateDto } from './dto/tablet-staff-elevate.dto';
import { TabletManagerStepUpDto } from './dto/tablet-manager-step-up.dto';
import { VenueAccessGuard } from '../auth/venue-access/venue-access.guard';
import { VenueScope, OrganizationScope } from '../auth/venue-access/venue-scope.decorator';

type TabletRequest = Request & { user: AuthenticatedUser };

/**
 * Device-facing endpoints for story 15-1's Order Tablet auth model
 * (DL-081): enroll (public, single-use bootstrap token), unlock (device
 * token + venue PIN), elevate (device token + staff PIN), manager
 * step-up (device or staff token + manager PIN), and lock (ends
 * elevation, audited).
 */
@Controller('tablet')
export class TabletAuthController {
  constructor(private readonly tabletAuthService: TabletAuthService) {}

  @Post('enroll')
  @UseGuards(RateLimitGuard)
  @RateLimit({ limit: 10, windowSeconds: 900 })
  @HttpCode(200)
  async enroll(
    @Body() dto: EnrollTabletDeviceDto,
  ): Promise<{ deviceId: string; deviceToken: string; venueId: string; label: string }> {
    return this.tabletAuthService.enrollDevice(dto.bootstrapToken);
  }

  @Post('unlock')
  @UseGuards(JwtAuthGuard, TabletDeviceGuard, RateLimitGuard, VenueAccessGuard)
  @VenueScope({ token: true })
  @RateLimit({ limit: 10, windowSeconds: 900 })
  @HttpCode(200)
  async unlock(
    @Req() req: TabletRequest,
    @Body() dto: TabletUnlockDto,
  ): Promise<{ unlocked: true }> {
    await this.tabletAuthService.unlockDevice(
      {
        deviceId: req.user.deviceId!,
        organizationId: req.user.organizationId,
        venueId: req.user.venueId!,
        label: '',
      },
      dto.pin,
    );
    return { unlocked: true };
  }

  @Post('elevate')
  @UseGuards(JwtAuthGuard, TabletDeviceGuard, RateLimitGuard, VenueAccessGuard)
  @VenueScope({ token: true })
  @RateLimit({ limit: 8, windowSeconds: 900 })
  @HttpCode(200)
  async elevate(
    @Req() req: TabletRequest,
    @Body() dto: TabletStaffElevateDto,
  ): Promise<{ token: string; staff: { id: string; name: string; role: StaffRole } }> {
    return this.tabletAuthService.elevateStaff(
      {
        deviceId: req.user.deviceId!,
        organizationId: req.user.organizationId,
        venueId: req.user.venueId!,
        label: '',
      },
      dto.staffPin,
    );
  }

  @Post('manager-step-up')
  @UseGuards(JwtAuthGuard, TabletDeviceGuard, RateLimitGuard, VenueAccessGuard)
  @VenueScope({ token: true })
  @RateLimit({ limit: 8, windowSeconds: 900 })
  @HttpCode(200)
  async managerStepUp(
    @Req() req: TabletRequest,
    @Body() dto: TabletManagerStepUpDto,
  ): Promise<{ token: string; manager: { id: string; name: string; role: StaffRole } }> {
    // A caller already elevated as tablet_staff carries their own staffId
    // in `sub` — recorded on the resulting manager token as actingStaffId
    // so privileged-action audit records carry both identities together.
    const actingStaffId = req.user.kind === 'tablet_staff' ? req.user.id : undefined;
    return this.tabletAuthService.managerStepUp(
      {
        deviceId: req.user.deviceId!,
        organizationId: req.user.organizationId,
        venueId: req.user.venueId!,
        label: '',
      },
      dto.managerPin,
      actingStaffId,
    );
  }

  @Post('lock')
  @UseGuards(JwtAuthGuard, TabletDeviceGuard, VenueAccessGuard)
  // Locking only drops privilege, so it stays possible after a grant is revoked.
  @OrganizationScope('locking a tablet only drops privilege')
  @HttpCode(204)
  async lock(@Req() req: TabletRequest): Promise<void> {
    const staffId =
      req.user.kind === 'tablet_staff' || req.user.kind === 'tablet_manager'
        ? req.user.id
        : undefined;
    await this.tabletAuthService.logLockEvent(
      {
        deviceId: req.user.deviceId!,
        organizationId: req.user.organizationId,
        venueId: req.user.venueId!,
        label: '',
      },
      staffId,
    );
  }
}
