import { CanActivate, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { isNonProductionRuntime } from '../config/runtime-environment';

/**
 * Story 12.5: the public kiosk order and payment mutations
 * (`POST /api/kiosk/orders`, `POST /api/kiosk/stripe/connection-token`,
 * `POST /api/kiosk/stripe/create-payment-intent`) exist only in an explicit
 * development or test environment. Anywhere else, including an unset or
 * unrecognised NODE_ENV, they answer a plain 404, as for a route that does
 * not exist (the Story 2.3 convention, see local-media-availability.ts).
 *
 * Decided per request from validated configuration. It must be listed
 * before RateLimitGuard so the refusal happens before the rate-limit store,
 * the ValidationPipe and the service are reached. There is deliberately no
 * setting that re-enables these routes in production.
 */
export function kioskPaymentRoutesAvailable(config: ConfigService): boolean {
  return isNonProductionRuntime(config.get<string>('NODE_ENV'));
}

@Injectable()
export class KioskProductionAvailabilityGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(): boolean {
    if (!kioskPaymentRoutesAvailable(this.config)) {
      throw new NotFoundException();
    }
    return true;
  }
}
