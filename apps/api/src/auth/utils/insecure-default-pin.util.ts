import { InternalServerErrorException } from '@nestjs/common';
import { isProductionRuntime } from '../../config/runtime-environment';

/**
 * The single value checked into `.env.example`/`docker-compose.yml` as the
 * default for every PIN-based auth surface in this repository
 * (`KDS_VENUE_PINS`, `ADMIN_CONSOLE_PIN`) — see docs/decisions-log.md DL-081
 * and the separate Admin Console `AdminPinGate` security finding. A
 * deployment that silently keeps this value in production grants
 * whoever-guesses-it real access, so every PIN-verification call site must
 * refuse to compare against it once `NODE_ENV=production`, rather than
 * silently accepting a guessable default. This never fires in local
 * development (`NODE_ENV !== 'production'`), so it changes no existing
 * dev/test behaviour — only a genuinely misconfigured production deploy.
 */
export const INSECURE_DEFAULT_PIN = '108';

export function assertPinNotInsecureDefault(configuredPin: string, surface: string): void {
  // Fail closed: only an explicit development/test environment may use it.
  if (isProductionRuntime() && configuredPin === INSECURE_DEFAULT_PIN) {
    throw new InternalServerErrorException(
      `${surface} is still configured with the checked-in default PIN — refusing to serve production auth requests until this is changed.`,
    );
  }
}
