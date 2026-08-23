import { Controller, Get, Param, Query, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { StaffRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { TabletTokenActiveGuard } from '../auth/guards/tablet-token-active.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { AuthenticatedUser } from '../auth/interfaces/jwt-payload.interface';
import { resolveVenueScope } from '../auth/utils/resolve-venue-scope';
import { PosSyncRecordsService } from './pos-sync-records.service';

type AuthedRequest = Request & { user: AuthenticatedUser };

const POS_SYNC_VIEW_ROLES = [
  StaffRole.admin,
  StaffRole.manager,
  StaffRole.cashier,
  StaffRole.kitchen,
] as const;

// DL-087: the Order Tablet's Order Status screen polls this order's own
// reconciliation status for BOTH staff and customer/guest identities (a
// restricted device token carries role `viewer`) -- found via real-browser
// validation that a customer-submitted order 403'd here, leaving the
// status screen unable to show anything for the exact identity the screen
// exists to serve. Narrower than POS_SYNC_VIEW_ROLES above (a single
// order's own status only, not the venue-wide list) -- mirrors DL-081's
// identical fix for GET /venues/:id/tables and /venues/:id/tax-config.
const POS_SYNC_ORDER_VIEW_ROLES = [...POS_SYNC_VIEW_ROLES, StaffRole.viewer] as const;

@UseGuards(JwtAuthGuard, RolesGuard, TabletTokenActiveGuard)
@Controller('admin')
export class PosSyncRecordsController {
  constructor(private readonly posSyncRecordsService: PosSyncRecordsService) {}

  @Roles(...POS_SYNC_VIEW_ROLES)
  @Get('venues/:id/pos-sync-records')
  listForVenue(
    @Req() req: AuthedRequest,
    @Param('id') venueId: string,
    @Query('status') status?: string,
  ) {
    // Always resolves to `venueId` for a staff token, or to `venueId` itself
    // (never undefined) for a matching KDS device — resolveVenueScope
    // throws ForbiddenException on a mismatch rather than returning here.
    const resolvedVenueId = resolveVenueScope(req.user, venueId) as string;
    return this.posSyncRecordsService.listForVenue(
      resolvedVenueId,
      req.user.organizationId,
      status,
    );
  }

  @Roles(...POS_SYNC_ORDER_VIEW_ROLES)
  @Get('orders/:id/pos-sync')
  getForOrder(@Req() req: AuthedRequest, @Param('id') orderId: string) {
    const scopedVenueId = resolveVenueScope(req.user, undefined);
    return this.posSyncRecordsService.getForOrder(orderId, req.user.organizationId, scopedVenueId);
  }
}
