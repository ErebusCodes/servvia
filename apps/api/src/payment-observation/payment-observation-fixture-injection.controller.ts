import { Body, Controller, ForbiddenException, Param, Post, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { ConfigService } from '@nestjs/config';
import { StaffRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { AuthenticatedUser } from '../auth/interfaces/jwt-payload.interface';
import { resolveVenueScope } from '../auth/utils/resolve-venue-scope';
import { PaymentObservationService } from './payment-observation.service';

type AuthedRequest = Request & { user: AuthenticatedUser };

/**
 * Story 15-6 fixture/contract-test injection surface. Simulates a future
 * connector-reported payment observation WITHOUT any real connector,
 * Windows machine, EFTPOS terminal, or Idealpos instance -- exists so
 * PaymentObservationService's real state-machine logic (not a mock of it)
 * can be exercised end-to-end, including from a real local browser
 * session, before any real observation contract exists.
 *
 * Fail-closed, defense in depth (two independent gates, matching
 * IdealposFixtureInjectionController's identical precedent):
 *  1. NODE_ENV !== 'production' -- checked first, before any other work.
 *  2. Staff auth + admin/manager role, and never a tablet/KDS identity.
 *
 * Every event this endpoint creates is stamped `evidenceTier:
 * fixture_contract` (the column default) -- this endpoint never sets
 * `real_windows_table12`/`real_production`, and nothing in this file could
 * even if it tried (the evidence tier is fixed at the call site below, not
 * caller-supplied).
 */
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('admin/payment-observation-fixtures')
export class PaymentObservationFixtureInjectionController {
  constructor(
    private readonly paymentObservationService: PaymentObservationService,
    private readonly config: ConfigService,
  ) {}

  private assertNonProduction(): void {
    if (this.config.get<string>('NODE_ENV') === 'production') {
      throw new ForbiddenException(
        'Payment-observation fixture injection is not available in production',
      );
    }
  }

  @Roles(StaffRole.admin, StaffRole.manager)
  @Post('orders/:orderId/inject-observation')
  async injectObservation(
    @Req() req: AuthedRequest,
    @Param('orderId') orderId: string,
    @Body() body: unknown,
  ) {
    this.assertNonProduction();
    if (req.user.kind) {
      // A tablet/KDS device identity should never reach this endpoint at
      // all (RolesGuard requires a real StaffRole a device token could,
      // in principle, carry after PIN elevation) -- fail closed anyway.
      throw new ForbiddenException('Fixture injection requires a genuine staff session');
    }
    const scopedVenueId = resolveVenueScope(req.user, undefined);
    return this.paymentObservationService.recordObservation(
      orderId,
      req.user.organizationId,
      scopedVenueId,
      body,
      'fixture',
      'fixture_contract',
    );
  }
}
