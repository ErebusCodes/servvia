import { Controller, Get, Param, ParseUUIDPipe, Post, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { Staff, StaffRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { RateLimitGuard } from '../auth/guards/rate-limit.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { RateLimit } from '../auth/decorators/rate-limit.decorator';
import { ConnectorService, ConnectorStatusView } from './connector.service';

/**
 * Admin-facing surface for Story 2-9's connector identity tracer: an
 * authorised admin creates enrolments and can view/revoke installations
 * for a venue. Nothing here contacts Idealpos, EFTPOS, a printer, or a
 * Windows host — see connector.service.ts's class doc comment.
 */
@Controller('venues/:venueId/connector')
@UseGuards(JwtAuthGuard, RolesGuard, RateLimitGuard)
export class ConnectorAdminController {
  constructor(private readonly connectorService: ConnectorService) {}

  @Post('enrollments')
  @Roles(StaffRole.admin)
  @RateLimit({ limit: 10, windowSeconds: 900 })
  async createEnrollment(
    @Param('venueId', ParseUUIDPipe) venueId: string,
    @Req() req: Request & { user: Staff },
  ): Promise<{ enrollmentId: string; bootstrapToken: string; expiresAt: Date }> {
    return this.connectorService.createEnrollment(
      req.user.organizationId,
      venueId,
      req.user.id,
      req.user.email,
      req.user.role,
    );
  }

  @Get('installations')
  @Roles(StaffRole.admin, StaffRole.manager)
  async getStatus(
    @Param('venueId', ParseUUIDPipe) venueId: string,
    @Req() req: Request & { user: Staff },
  ): Promise<ConnectorStatusView[]> {
    return this.connectorService.getStatus(req.user.organizationId, venueId);
  }

  @Post('installations/:installationId/revoke')
  @Roles(StaffRole.admin)
  async revoke(
    @Param('venueId', ParseUUIDPipe) venueId: string,
    @Param('installationId', ParseUUIDPipe) installationId: string,
    @Req() req: Request & { user: Staff },
  ): Promise<{ revoked: true }> {
    await this.connectorService.revoke(
      installationId,
      req.user.organizationId,
      venueId,
      req.user.id,
    );
    return { revoked: true };
  }
}
