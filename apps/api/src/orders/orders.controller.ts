import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { OrderStatus, StaffRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { TabletTokenActiveGuard } from '../auth/guards/tablet-token-active.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { AuthenticatedUser } from '../auth/interfaces/jwt-payload.interface';
import { resolveVenueScope } from '../auth/utils/resolve-venue-scope';
import { OrdersService } from './orders.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { CreateStaffOrderDto } from './dto/create-staff-order.dto';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto';
import { CreatePaymentIntentDto } from './dto/create-payment-intent.dto';
import { RateLimit } from '../auth/decorators/rate-limit.decorator';
import { RateLimitGuard } from '../auth/guards/rate-limit.guard';
import { auditActorFromUser } from '../audit/audit-actor';
import { VenueAccessService } from '../auth/venue-access/venue-access.service';
import { VenueAccessGuard } from '../auth/venue-access/venue-access.guard';
import { VenueScope } from '../auth/venue-access/venue-scope.decorator';

type AuthedRequest = Request & { user: AuthenticatedUser };

const STAFF_ORDER_ROLES = [
  StaffRole.admin,
  StaffRole.manager,
  StaffRole.cashier,
  StaffRole.kitchen,
] as const;

// Least privilege (Story 2.7, audit section 4.6): the kitchen role (the KDS
// venue-PIN token) reads orders and advances kitchen preparation only. It
// cannot create an order, and cannot cancel or otherwise change one.
const ORDER_ENTRY_ROLES = [StaffRole.admin, StaffRole.manager, StaffRole.cashier] as const;
export const KITCHEN_STATUS_TRANSITIONS: ReadonlySet<OrderStatus> = new Set<OrderStatus>([
  OrderStatus.preparing,
  OrderStatus.ready,
  OrderStatus.completed,
]);

@Controller()
export class OrdersController {
  constructor(
    private readonly ordersService: OrdersService,
    private readonly venueAccess: VenueAccessService,
  ) {}

  // 1. Kiosk public order creation
  @Post('kiosk/orders')
  @UseGuards(RateLimitGuard)
  @RateLimit({ limit: 30, windowSeconds: 60 })
  create(@Body() dto: CreateOrderDto) {
    return this.ordersService.create(dto);
  }

  @Post('kiosk/stripe/connection-token')
  @UseGuards(RateLimitGuard)
  @RateLimit({ limit: 20, windowSeconds: 60 })
  createConnectionToken() {
    return this.ordersService.createConnectionToken();
  }

  @Post('kiosk/stripe/create-payment-intent')
  @UseGuards(RateLimitGuard)
  @RateLimit({ limit: 20, windowSeconds: 60 })
  createPaymentIntent(@Body() body: CreatePaymentIntentDto) {
    return this.ordersService.createPaymentIntent(body.amountCents);
  }

  // 2. Admin / staff-device endpoints (Jwt-protected)
  @UseGuards(JwtAuthGuard, RolesGuard, TabletTokenActiveGuard, VenueAccessGuard)
  @Roles(...STAFF_ORDER_ROLES)
  @Get('admin/orders')
  @VenueScope({ query: 'venueId', optional: true })
  async findAll(
    @Req() req: AuthedRequest,
    @Query('venueId') venueId?: string,
    @Query('activeOnly') activeOnly?: string,
  ) {
    const isActiveOnly = activeOnly === 'true';
    const scopedVenueId = resolveVenueScope(req.user, venueId);
    const venues = scopedVenueId ?? (await this.venueAccess.listableVenueIds(req.user));
    return this.ordersService.findAll(req.user.organizationId, venues, isActiveOnly);
  }

  @UseGuards(JwtAuthGuard, RolesGuard, TabletTokenActiveGuard, VenueAccessGuard)
  @Roles(...STAFF_ORDER_ROLES)
  // Order ids are ORD-<sequence> strings (see OrdersService.persistOrder),
  // not UUIDs, so this deliberately takes a plain string param.
  @Get('admin/orders/:id')
  @VenueScope({ resource: 'order' })
  findOne(@Req() req: AuthedRequest, @Param('id') id: string) {
    const scopedVenueId = resolveVenueScope(req.user, undefined);
    return this.ordersService.findOne(id, req.user.organizationId, scopedVenueId);
  }

  /**
   * Order Tablet (and any other staff-operated surface) order creation.
   * Distinct from the public `kiosk/orders` path: authenticated, no
   * payment-intent requirement, always dine-in against a real Table.
   * A kds_device token may only create orders for its own venue.
   */
  @UseGuards(JwtAuthGuard, RolesGuard, TabletTokenActiveGuard, VenueAccessGuard)
  @Roles(...ORDER_ENTRY_ROLES)
  @Post('admin/orders')
  @VenueScope({ body: 'venueId' })
  createStaffOrder(@Req() req: AuthedRequest, @Body() dto: CreateStaffOrderDto) {
    resolveVenueScope(req.user, dto.venueId);
    const actor = { id: req.user.id, email: req.user.email, role: req.user.role };
    return this.ordersService.createStaffOrder(dto, req.user.organizationId, actor);
  }

  @UseGuards(JwtAuthGuard, RolesGuard, TabletTokenActiveGuard, VenueAccessGuard)
  @Roles(...STAFF_ORDER_ROLES)
  @Patch('admin/orders/:id/status')
  @VenueScope({ resource: 'order' })
  updateStatus(
    @Req() req: AuthedRequest,
    @Param('id') id: string,
    @Body() dto: UpdateOrderStatusDto,
  ) {
    if (req.user.role === StaffRole.kitchen && !KITCHEN_STATUS_TRANSITIONS.has(dto.status)) {
      throw new ForbiddenException('The kitchen role may only advance kitchen preparation');
    }
    const scopedVenueId = resolveVenueScope(req.user, undefined);
    return this.ordersService.updateStatus(
      id,
      req.user.organizationId,
      dto,
      auditActorFromUser(req.user),
      scopedVenueId,
    );
  }

  /**
   * Authorised-operator reset for the Table 19 controlled-validation guard
   * (see OrdersService.assertTable19ValidationModeAllows) — clears the
   * "one controlled logical order only" gate so another may be submitted.
   * Admin/manager only, same as every other operator-only action in this
   * controller family.
   */
  @UseGuards(JwtAuthGuard, RolesGuard, TabletTokenActiveGuard, VenueAccessGuard)
  @Roles(StaffRole.admin, StaffRole.manager)
  @Post('admin/table19-validation/reset')
  @VenueScope({ resource: 'table19ValidationVenue' })
  resetTable19Validation(@Req() req: AuthedRequest) {
    const scopedVenueId = resolveVenueScope(req.user, undefined);
    const actor = { id: req.user.id, email: req.user.email, role: req.user.role };
    return this.ordersService.resetTable19ValidationRun(
      req.user.organizationId,
      actor,
      scopedVenueId,
    );
  }
}
