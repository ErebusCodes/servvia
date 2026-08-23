import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * Validates the `jwt` passport strategy only. There is intentionally no
 * static-token or magic-string shortcut here — every caller must present a
 * signed, unexpired JWT (staff session token or a venue-scoped KDS device
 * token minted via POST /kiosk/kds/auth).
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {}
