import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from './auth.service';
import { safeCompare } from '../common/utils/safe-compare';
import { assertPinNotInsecureDefault } from './utils/insecure-default-pin.util';

interface KdsAuthResult {
  accessToken: string;
  expiresIn: string;
}

/**
 * Exchanges a venue-scoped PIN for a short-lived device token, per the
 * documented KDS trust model (docs/architecture.md §9, docs/ux.md §3.3):
 * "no full staff login... PIN required for venue-scoped token." PINs are
 * operator-configured via KDS_VENUE_PINS (never hard-coded), and a missing
 * or unconfigured PIN always fails closed rather than granting access.
 */
@Injectable()
export class KdsAuthService {
  private readonly logger = new Logger(KdsAuthService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly authService: AuthService,
  ) {}

  private getConfiguredPin(venueId: string): string | undefined {
    const raw = this.config.get<string>('KDS_VENUE_PINS');
    if (!raw) return undefined;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      this.logger.error(
        'KDS_VENUE_PINS is not valid JSON — KDS device auth will reject all requests',
      );
      return undefined;
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return undefined;
    }
    const value = (parsed as Record<string, unknown>)[venueId];
    return typeof value === 'string' && value.length > 0 ? value : undefined;
  }

  async authenticate(venueId: string, pin: string): Promise<KdsAuthResult> {
    const configuredPin = this.getConfiguredPin(venueId);
    if (!configuredPin) {
      // Fail closed: no configured PIN for this venue means no device auth,
      // not "any PIN works."
      throw new UnauthorizedException('Invalid venue or PIN');
    }

    assertPinNotInsecureDefault(configuredPin, 'KDS_VENUE_PINS');

    if (!safeCompare(pin, configuredPin)) {
      throw new UnauthorizedException('Invalid venue or PIN');
    }

    const venue = await this.prisma.venue.findUnique({ where: { id: venueId } });
    if (!venue || !venue.isActive) {
      throw new UnauthorizedException('Invalid venue or PIN');
    }

    const accessToken = this.authService.signKdsDeviceToken(venue.id, venue.organizationId);
    const expiresIn = this.config.get<string>('KDS_TOKEN_EXPIRY', '12h');
    return { accessToken, expiresIn };
  }
}
