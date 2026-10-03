import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Post,
  Body,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { StaffRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { StaffSessionOnlyGuard } from '../auth/guards/staff-session-only.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { AuthenticatedUser } from '../auth/interfaces/jwt-payload.interface';
import { resolveVenueScope } from '../auth/utils/resolve-venue-scope';
import { PaymentObservationService } from './payment-observation.service';
import { VenueAccessGuard } from '../auth/venue-access/venue-access.guard';
import { VenueScope } from '../auth/venue-access/venue-scope.decorator';

type AuthedRequest = Request & { user: AuthenticatedUser };

/**
 * Story 15-6: any Order Tablet identity (bare device/guest, staff-elevated,
 * or manager-elevated) is deliberately EXCLUDED from every route in this
 * controller, regardless of the StaffRole an elevation carries -- the
 * canonical story's own instruction is "prefer no payment UI on the
 * tablet," and a `tablet_staff`/`tablet_manager` token can carry a real
 * `cashier`/`manager` StaffRole after PIN elevation, which a role-only
 * check would otherwise let through (see resolveVenueScope's own doc
 * comment on `kind`). A KDS terminal token is excluded for the same
 * reason: payment observation is a back-office concern, not a kitchen or
 * order-taking concern.
 */
const TABLET_AND_KDS_KINDS = new Set([
  'kds_device',
  'tablet_device',
  'tablet_staff',
  'tablet_manager',
]);

const PAYMENT_OBSERVATION_VIEW_ROLES = [
  StaffRole.admin,
  StaffRole.manager,
  StaffRole.cashier,
] as const;
const PAYMENT_OBSERVATION_ACKNOWLEDGE_ROLES = [StaffRole.admin, StaffRole.manager] as const;

function assertNotTabletOrKdsIdentity(user: AuthenticatedUser): void {
  if (user.kind && TABLET_AND_KDS_KINDS.has(user.kind)) {
    throw new ForbiddenException('Payment-observation records are not available to this identity');
  }
}

@UseGuards(JwtAuthGuard, RolesGuard, StaffSessionOnlyGuard, VenueAccessGuard)
@Controller('admin')
export class PaymentObservationController {
  constructor(private readonly paymentObservationService: PaymentObservationService) {}

  @Roles(...PAYMENT_OBSERVATION_VIEW_ROLES)
  @Get('venues/:id/payment-observations')
  @VenueScope({ param: 'id' })
  async listForVenue(
    @Req() req: AuthedRequest,
    @Param('id') venueId: string,
    @Query('state') state?: string,
  ) {
    assertNotTabletOrKdsIdentity(req.user);
    const resolvedVenueId = resolveVenueScope(req.user, venueId) as string;
    return this.paymentObservationService.listForVenue(
      resolvedVenueId,
      req.user.organizationId,
      state,
    );
  }

  @Roles(...PAYMENT_OBSERVATION_VIEW_ROLES)
  @Get('orders/:id/payment-observation')
  @VenueScope({ resource: 'order' })
  async getForOrder(@Req() req: AuthedRequest, @Param('id') orderId: string) {
    assertNotTabletOrKdsIdentity(req.user);
    const scopedVenueId = resolveVenueScope(req.user, undefined);
    return this.paymentObservationService.getForOrder(
      orderId,
      req.user.organizationId,
      scopedVenueId,
    );
  }

  /**
   * Manager-level acknowledgement of a `conflict` row. Never changes
   * native payment truth -- only records that a human reviewed it. See
   * PaymentObservationService.acknowledge's own doc comment.
   */
  @Roles(...PAYMENT_OBSERVATION_ACKNOWLEDGE_ROLES)
  @Post('payment-observations/:id/acknowledge')
  @VenueScope({ resource: 'paymentObservation' })
  async acknowledge(
    @Req() req: AuthedRequest,
    @Param('id') paymentObservationId: string,
    @Body() body: { note?: string },
  ) {
    assertNotTabletOrKdsIdentity(req.user);
    const note = (body?.note ?? '').trim();
    if (!note) {
      throw new BadRequestException('A review note is required');
    }
    if (note.length > 500) {
      throw new BadRequestException('Review note must be 500 characters or fewer');
    }
    const scopedVenueId = resolveVenueScope(req.user, undefined);
    return this.paymentObservationService.acknowledge(
      paymentObservationId,
      req.user.organizationId,
      scopedVenueId,
      req.user.id,
      note,
    );
  }
}
