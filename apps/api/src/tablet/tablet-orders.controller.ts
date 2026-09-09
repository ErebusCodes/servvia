import { Body, Controller, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { Order } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RateLimitGuard } from '../auth/guards/rate-limit.guard';
import { RateLimit } from '../auth/decorators/rate-limit.decorator';
import { AuthenticatedUser } from '../auth/interfaces/jwt-payload.interface';
import { resolveVenueScope } from '../auth/utils/resolve-venue-scope';
import { OrdersService } from '../orders/orders.service';
import { TabletAuthService } from './tablet-auth.service';
import { TabletDeviceGuard } from './guards/tablet-device.guard';
import { ManagerStepUpGuard } from './guards/manager-step-up.guard';
import { CreateTabletOrderDto } from './dto/create-tablet-order.dto';

type TabletRequest = Request & { user: AuthenticatedUser };

/**
 * The smallest purpose-built tablet API boundary for restricted/customer-
 * context order submission (story 15-1, DL-081) — deliberately NOT
 * `/api/admin/orders`, which requires a staff-tier Roles check that a bare
 * device token must never satisfy (that would silently grant a customer
 * session administrative-adjacent authority). A device-only token here is
 * attributed to a synthetic, per-device, non-loginable system actor —
 * never a fabricated staff identity — via the same established pattern as
 * kiosk orders (`resolveKioskSystemActor`). Staff-elevated ordering
 * continues to use the existing, unmodified `/api/admin/orders` (a
 * `tablet_staff` token's role/email/id are the real staff member's own,
 * so that endpoint's existing RolesGuard and attribution already work
 * correctly with no change).
 */
@Controller('tablet')
@UseGuards(JwtAuthGuard, RateLimitGuard)
export class TabletOrdersController {
  constructor(
    private readonly ordersService: OrdersService,
    private readonly tabletAuthService: TabletAuthService,
  ) {}

  /**
   * Restricted-mode order *viewing* (floor status: does this table already
   * have an active order?) — the read-side counterpart of createRestrictedOrder
   * below. Before this endpoint existed, the restricted-mode floor screen
   * called `GET /api/admin/orders` unconditionally (via useLiveOrders), which
   * 403s for a bare device token (role `viewer`, not in `STAFF_ORDER_ROLES`) —
   * a real defect found during this story's independent review, not merely a
   * gap. Venue-pinned via resolveVenueScope, same as every other tablet-kind
   * endpoint; a staff/manager-elevated token may still use this route (it's a
   * superset of what it's already allowed) but the frontend routes elevated
   * sessions through the existing, unmodified `/api/admin/orders` instead.
   */
  @Get('orders')
  @UseGuards(TabletDeviceGuard)
  @RateLimit({ limit: 60, windowSeconds: 60 })
  async listRestrictedOrders(
    @Req() req: TabletRequest,
    @Query('activeOnly') activeOnly?: string,
  ): Promise<Order[]> {
    const scopedVenueId = resolveVenueScope(req.user, undefined);
    return this.ordersService.findAll(
      req.user.organizationId,
      scopedVenueId,
      activeOnly === 'true',
    );
  }

  @Post('orders')
  @UseGuards(TabletDeviceGuard)
  @RateLimit({ limit: 30, windowSeconds: 60 })
  async createRestrictedOrder(
    @Req() req: TabletRequest,
    @Body() dto: CreateTabletOrderDto,
  ): Promise<Order> {
    const deviceId = req.user.deviceId!;
    const systemActor = await this.tabletAuthService.resolveDeviceSystemActor(
      req.user.organizationId,
      deviceId,
    );
    return this.ordersService.createStaffOrder(
      {
        venueId: req.user.venueId!,
        tableId: dto.tableId,
        serviceMode: dto.serviceMode,
        guests: dto.guests,
        items: dto.items,
        notes: dto.notes,
        idempotencyKey: dto.idempotencyKey,
      },
      req.user.organizationId,
      { id: systemActor.id, email: systemActor.email, role: systemActor.role },
    );
  }

  /**
   * A real, minimal authorization-hook endpoint — not a fabricated void/
   * refund/payment/reprint operation (explicitly out of this story's
   * scope; those remain 15-6/15-8's business logic to implement against
   * this same guard). Proves the full device -> staff -> manager step-up
   * chain end-to-end and produces a real, audited authorization decision
   * a later story's guard usage can be modeled on directly.
   */
  @Post('manager-actions/test-hook')
  @UseGuards(ManagerStepUpGuard)
  managerAuthorizationTestHook(@Req() req: TabletRequest): {
    authorized: true;
    managerId: string;
    actingStaffId?: string;
    deviceId: string;
    venueId: string;
  } {
    return {
      authorized: true,
      managerId: req.user.id,
      actingStaffId: req.user.actingStaffId,
      deviceId: req.user.deviceId!,
      venueId: req.user.venueId!,
    };
  }
}
