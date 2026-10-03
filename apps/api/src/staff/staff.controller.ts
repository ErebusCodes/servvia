import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { StaffRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { RateLimitGuard } from '../auth/guards/rate-limit.guard';
import { StaffSessionOnlyGuard } from '../auth/guards/staff-session-only.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { RateLimit } from '../auth/decorators/rate-limit.decorator';
import { AuthenticatedUser } from '../auth/interfaces/jwt-payload.interface';
import { StaffService } from './staff.service';
import { SetStaffPinDto } from './dto/set-staff-pin.dto';
import { CreateStaffAccountDto, UpdateStaffAccountDto } from './dto/staff-account.dto';
import {
  IssuedCredentialSetup,
  StaffAccountView,
  StaffActor,
  StaffAdministrationService,
} from './staff-administration.service';

type StaffRequest = Request & { user: AuthenticatedUser };

function actorOf(req: StaffRequest): StaffActor {
  return {
    id: req.user.id,
    email: req.user.email,
    role: req.user.role,
    organizationId: req.user.organizationId,
  };
}

/**
 * Staff administration (Story 8.1, STF-1). Only a genuine staff login
 * session reaches this controller (StaffSessionOnlyGuard): never a tablet,
 * even elevated, and never a device. Owners and admins administer accounts;
 * the finer rules (whom, which roles, which venues) are enforced by
 * StaffAdministrationService. Managers keep the list and tablet-PIN
 * operations they had (story 15-1).
 */
@Controller('admin/staff')
@UseGuards(JwtAuthGuard, RolesGuard, StaffSessionOnlyGuard, RateLimitGuard)
export class StaffController {
  constructor(
    private readonly staffService: StaffService,
    private readonly administration: StaffAdministrationService,
  ) {}

  @Get()
  @Roles(StaffRole.admin, StaffRole.manager)
  list(@Req() req: StaffRequest): Promise<StaffAccountView[]> {
    return this.administration.list(req.user.organizationId);
  }

  @Post()
  @Roles(StaffRole.admin)
  @RateLimit({ limit: 30, windowSeconds: 900 })
  create(
    @Body() dto: CreateStaffAccountDto,
    @Req() req: StaffRequest,
  ): Promise<{ staff: StaffAccountView; credentialSetup: IssuedCredentialSetup }> {
    return this.administration.create(actorOf(req), dto);
  }

  @Patch(':id')
  @Roles(StaffRole.admin)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateStaffAccountDto,
    @Req() req: StaffRequest,
  ): Promise<StaffAccountView> {
    return this.administration.update(actorOf(req), id, dto);
  }

  @Post(':id/deactivate')
  @Roles(StaffRole.admin)
  @HttpCode(200)
  deactivate(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: StaffRequest,
  ): Promise<StaffAccountView> {
    return this.administration.setActive(actorOf(req), id, false);
  }

  @Post(':id/activate')
  @Roles(StaffRole.admin)
  @HttpCode(200)
  activate(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: StaffRequest,
  ): Promise<StaffAccountView> {
    return this.administration.setActive(actorOf(req), id, true);
  }

  @Delete(':id')
  @Roles(StaffRole.admin)
  @HttpCode(204)
  async remove(@Param('id', ParseUUIDPipe) id: string, @Req() req: StaffRequest): Promise<void> {
    await this.administration.remove(actorOf(req), id);
  }

  @Put(':id/venues/:venueId')
  @Roles(StaffRole.admin)
  grantVenue(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('venueId', ParseUUIDPipe) venueId: string,
    @Req() req: StaffRequest,
  ): Promise<StaffAccountView> {
    return this.administration.grantVenue(actorOf(req), id, venueId);
  }

  @Delete(':id/venues/:venueId')
  @Roles(StaffRole.admin)
  revokeVenue(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('venueId', ParseUUIDPipe) venueId: string,
    @Req() req: StaffRequest,
  ): Promise<StaffAccountView> {
    return this.administration.revokeVenue(actorOf(req), id, venueId);
  }

  @Post(':id/credential-reset')
  @Roles(StaffRole.admin)
  @RateLimit({ limit: 30, windowSeconds: 900 })
  @HttpCode(200)
  resetCredential(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: StaffRequest,
  ): Promise<IssuedCredentialSetup> {
    return this.administration.resetCredential(actorOf(req), id);
  }

  @Post(':id/tablet-pin')
  @Roles(StaffRole.admin, StaffRole.manager)
  @RateLimit({ limit: 10, windowSeconds: 900 })
  async setTabletPin(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetStaffPinDto,
    @Req() req: StaffRequest,
  ): Promise<{ set: true }> {
    await this.staffService.setTabletPin(id, req.user.organizationId, dto.pin, actorOf(req));
    return { set: true };
  }
}
