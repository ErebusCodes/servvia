import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Request } from 'express';
import { AuthenticatedUser } from '../../auth/interfaces/jwt-payload.interface';
import { TabletAuthService } from '../tablet-auth.service';

const TABLET_KINDS = new Set(['tablet_device', 'tablet_staff', 'tablet_manager']);

/**
 * Minimum bar for any tablet-facing endpoint (story 15-1, DL-081):
 * requires a `tablet_*` kind token AND re-checks the underlying device is
 * still `active` on every request (not just at JWT-issue time) — a
 * revoked device fails closed immediately, including for an
 * already-elevated staff/manager session riding on it. Must run after
 * JwtAuthGuard (reads `req.user`, already populated).
 */
@Injectable()
export class TabletDeviceGuard implements CanActivate {
  constructor(private readonly tabletAuthService: TabletAuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request & { user?: AuthenticatedUser }>();
    const user = request.user;
    if (!user || !user.kind || !TABLET_KINDS.has(user.kind) || !user.deviceId) {
      throw new ForbiddenException('A valid tablet device identity is required');
    }
    // Throws UnauthorizedException if revoked/unknown — propagates as-is.
    await this.tabletAuthService.assertDeviceActive(user.deviceId);
    return true;
  }
}
