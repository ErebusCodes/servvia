import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { Staff, StaffRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { StaffSessionOnlyGuard } from '../auth/guards/staff-session-only.guard';
import { RateLimitGuard } from '../auth/guards/rate-limit.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { RateLimit } from '../auth/decorators/rate-limit.decorator';
import { ConnectorCommandService, ConnectorCommandStatusView } from './connector-command.service';
import { CreateConnectorCommandDto } from './dto/create-connector-command.dto';

/**
 * Admin-facing surface for Story 2-10: an authorised admin can trigger this
 * story's one tracer command type for a venue, view command status, and
 * cancel a not-yet-accepted command. Nothing here contacts Idealpos,
 * EFTPOS, a printer, or a Windows host.
 */
@Controller('venues/:venueId/connector/commands')
@UseGuards(JwtAuthGuard, RolesGuard, StaffSessionOnlyGuard, RateLimitGuard)
export class ConnectorCommandAdminController {
  constructor(private readonly commandService: ConnectorCommandService) {}

  @Post('tracer')
  @Roles(StaffRole.admin)
  @RateLimit({ limit: 30, windowSeconds: 900 })
  async createTracer(
    @Param('venueId', ParseUUIDPipe) venueId: string,
    @Body() dto: CreateConnectorCommandDto,
    @Req() req: Request & { user: Staff },
  ): Promise<ConnectorCommandStatusView> {
    return this.commandService.createTracerCommand(
      req.user.organizationId,
      venueId,
      req.user.id,
      req.user.email,
      req.user.role,
      dto.idempotencyKey,
    );
  }

  @Get()
  @Roles(StaffRole.admin, StaffRole.manager)
  async getStatus(
    @Param('venueId', ParseUUIDPipe) venueId: string,
    @Req() req: Request & { user: Staff },
  ): Promise<ConnectorCommandStatusView[]> {
    return this.commandService.getStatus(req.user.organizationId, venueId);
  }

  @Post(':commandId/cancel')
  @Roles(StaffRole.admin)
  async cancel(
    @Param('venueId', ParseUUIDPipe) venueId: string,
    @Param('commandId', ParseUUIDPipe) commandId: string,
    @Req() req: Request & { user: Staff },
  ): Promise<{ cancelled: true }> {
    await this.commandService.cancel(
      commandId,
      req.user.organizationId,
      venueId,
      req.user.id,
      req.user.email,
      req.user.role,
    );
    return { cancelled: true };
  }
}
