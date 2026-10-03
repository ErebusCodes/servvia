import {
  Controller,
  ForbiddenException,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { StaffRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { TabletTokenActiveGuard } from '../auth/guards/tablet-token-active.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { AuthenticatedUser } from '../auth/interfaces/jwt-payload.interface';
import { resolveVenueScope } from '../auth/utils/resolve-venue-scope';
import { auditActorFromUser } from '../audit/audit-actor';
import { PrinterJobsService, ReprintActor } from './printer-jobs.service';

type AuthedRequest = Request & { user: AuthenticatedUser };

/**
 * The staff member behind a reprint or retry, with the tablet they acted
 * through (Story 12.15). Both actions record the requesting Staff row, so a
 * credential that names no staff member is refused before anything changes.
 */
function reprintActorOf(user: AuthenticatedUser): ReprintActor {
  const actor = auditActorFromUser(user);
  if (actor.actorType === 'device' || actor.actorType === 'system') {
    throw new ForbiddenException('Only a staff member may request this');
  }
  return {
    id: actor.actorId,
    email: actor.actorEmail,
    role: actor.actorRole,
    deviceKind: actor.deviceKind,
    deviceId: actor.deviceId,
  };
}

const PRINTER_JOB_VIEW_ROLES = [
  StaffRole.admin,
  StaffRole.manager,
  StaffRole.cashier,
  StaffRole.kitchen,
] as const;

// DL-087: mirrors POS_SYNC_ORDER_VIEW_ROLES's identical fix and rationale
// (pos-sync-records.controller.ts) -- the Order Tablet's Order Status
// screen polls this order's own KOT status for customer/guest identities
// too (restricted device token, role `viewer`), found 403ing via real-
// browser validation. Narrower than PRINTER_JOB_VIEW_ROLES (a single
// order's own jobs only, not a printer's full job list).
const PRINTER_JOB_ORDER_VIEW_ROLES = [...PRINTER_JOB_VIEW_ROLES, StaffRole.viewer] as const;

// Reprinting is a more consequential, lower-frequency action than viewing
// job status, so it is restricted to roles with a real staff login rather
// than a shared kitchen/KDS device PIN token.
const PRINTER_JOB_REPRINT_ROLES = [StaffRole.admin, StaffRole.manager, StaffRole.cashier] as const;

@UseGuards(JwtAuthGuard, RolesGuard, TabletTokenActiveGuard)
@Controller('admin')
export class PrinterJobsController {
  constructor(private readonly printerJobsService: PrinterJobsService) {}

  @Roles(...PRINTER_JOB_VIEW_ROLES)
  @Get('printers/:id/jobs')
  listForPrinter(
    @Req() req: AuthedRequest,
    @Param('id') printerId: string,
    @Query('status') status?: string,
  ) {
    const scopedVenueId = resolveVenueScope(req.user, undefined);
    return this.printerJobsService.listForPrinter(
      printerId,
      req.user.organizationId,
      scopedVenueId,
      status,
    );
  }

  @Roles(...PRINTER_JOB_ORDER_VIEW_ROLES)
  @Get('orders/:id/print-jobs')
  listForOrder(@Req() req: AuthedRequest, @Param('id') orderId: string) {
    const scopedVenueId = resolveVenueScope(req.user, undefined);
    return this.printerJobsService.listForOrder(orderId, req.user.organizationId, scopedVenueId);
  }

  @Roles(...PRINTER_JOB_REPRINT_ROLES)
  @Post('printers/:printerId/jobs/:jobId/reprint')
  requestReprint(
    @Req() req: AuthedRequest,
    @Param('printerId') printerId: string,
    @Param('jobId') jobId: string,
  ) {
    const scopedVenueId = resolveVenueScope(req.user, undefined);
    const actor = reprintActorOf(req.user);
    return this.printerJobsService.requestReprint(
      printerId,
      jobId,
      req.user.organizationId,
      scopedVenueId,
      actor,
    );
  }

  // E8-S1 (expanded): distinct from reprint — retries a `manual` job in
  // place (no new row) because nothing was ever transmitted for it. Same
  // role restriction as reprint: a more consequential action than viewing
  // status.
  @Roles(...PRINTER_JOB_REPRINT_ROLES)
  @Post('printers/:printerId/jobs/:jobId/retry-dispatch')
  retryDispatch(
    @Req() req: AuthedRequest,
    @Param('printerId') printerId: string,
    @Param('jobId') jobId: string,
  ) {
    const scopedVenueId = resolveVenueScope(req.user, undefined);
    const actor = reprintActorOf(req.user);
    return this.printerJobsService.retryDispatch(
      printerId,
      jobId,
      req.user.organizationId,
      scopedVenueId,
      actor,
    );
  }
}
