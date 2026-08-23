import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import { StaffRole } from '@prisma/client';
import { AuthenticatedUser } from '../../auth/interfaces/jwt-payload.interface';
import { PrismaService } from '../../prisma/prisma.service';
import { TabletAuthService } from '../tablet-auth.service';

const MANAGER_ROLES = new Set<StaffRole>([StaffRole.manager, StaffRole.admin, StaffRole.owner]);

/**
 * The gate for high-risk tablet actions (story 15-1, DL-081) — requires a
 * `tablet_manager` token specifically. Later stories (void/refund/discount/
 * payment-override/reprint/manual-recovery) apply this guard to their own
 * endpoints without redesign; this story does not implement any of those
 * operations itself, only the mechanism and one demonstration hook.
 */
@Injectable()
export class ManagerStepUpGuard implements CanActivate {
  constructor(
    private readonly tabletAuthService: TabletAuthService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request & { user?: AuthenticatedUser }>();
    const user = request.user;
    if (!user || !user.deviceId || user.kind !== 'tablet_manager') {
      throw new ForbiddenException('Manager step-up authorization is required for this action');
    }
    await this.tabletAuthService.assertDeviceActive(user.deviceId);

    const manager = await this.prisma.staff.findUnique({ where: { id: user.id } });
    if (!manager || !manager.isActive || manager.deletedAt || !MANAGER_ROLES.has(manager.role)) {
      throw new UnauthorizedException('Manager authorization is no longer valid');
    }
    return true;
  }
}
