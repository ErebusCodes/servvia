import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Request } from 'express';
import { AuthenticatedUser } from '../interfaces/jwt-payload.interface';
import { PrismaService } from '../../prisma/prisma.service';

const TABLET_KINDS = new Set(['tablet_device', 'tablet_staff', 'tablet_manager']);

/**
 * Story 15-1 (DL-081) revocation fail-closed guard for endpoints that
 * predate tablet devices but are now reachable by a `tablet_staff`/
 * `tablet_manager` elevation token (e.g. the existing, unmodified
 * `/api/admin/orders`). Without this, a device revoked mid-shift would
 * still have its already-issued elevation token honoured until natural
 * JWT expiry (up to `TABLET_STAFF_ELEVATION_EXPIRY`) — the token's
 * *signature* stays valid; only a live device-status check catches this.
 *
 * A no-op for every other caller (plain staff JWT, kds_device — neither
 * carries a `deviceId` claim tied to a revocable TabletDevice row), so
 * this changes no existing behaviour for callers this story doesn't own.
 *
 * Deliberately queries Prisma directly rather than depending on
 * TabletAuthService, to avoid a module import cycle (OrdersModule is
 * itself imported by TabletModule) — see TabletDeviceGuard for the
 * canonical version of this same check used on tablet-native endpoints.
 */
@Injectable()
export class TabletTokenActiveGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request & { user?: AuthenticatedUser }>();
    const user = request.user;
    if (!user || !user.kind || !TABLET_KINDS.has(user.kind) || !user.deviceId) {
      return true;
    }
    const device = await this.prisma.tabletDevice.findUnique({ where: { id: user.deviceId } });
    if (!device || device.status !== 'active') {
      throw new UnauthorizedException('This device has been revoked or is unknown');
    }
    return true;
  }
}
