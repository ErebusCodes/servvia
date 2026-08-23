import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import { AuthenticatedUser } from '../../auth/interfaces/jwt-payload.interface';
import { PrismaService } from '../../prisma/prisma.service';
import { TabletAuthService } from '../tablet-auth.service';

/**
 * Requires a named-staff-or-above elevated tablet session (`tablet_staff`
 * or `tablet_manager`) — a bare `tablet_device` token never satisfies
 * this. Re-checks BOTH the device and the staff member are still active on
 * every request; ordinary staff elevation alone never implies manager
 * authority (see ManagerStepUpGuard for that, separately).
 */
@Injectable()
export class TabletStaffGuard implements CanActivate {
  constructor(
    private readonly tabletAuthService: TabletAuthService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request & { user?: AuthenticatedUser }>();
    const user = request.user;
    if (
      !user ||
      !user.deviceId ||
      (user.kind !== 'tablet_staff' && user.kind !== 'tablet_manager')
    ) {
      throw new ForbiddenException('Named staff elevation is required for this action');
    }
    await this.tabletAuthService.assertDeviceActive(user.deviceId);

    const staff = await this.prisma.staff.findUnique({ where: { id: user.id } });
    if (!staff || !staff.isActive || staff.deletedAt) {
      throw new UnauthorizedException('This staff member is no longer active');
    }
    return true;
  }
}
