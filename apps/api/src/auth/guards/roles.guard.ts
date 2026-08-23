import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { StaffRole, Staff } from '@prisma/client';
import { ROLES_KEY } from '../decorators/roles.decorator';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') {
      return true;
    }

    const requiredRoles = this.reflector.getAllAndOverride<unknown>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredRoles || !Array.isArray(requiredRoles) || requiredRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<(Request & { user?: Staff }) | undefined>();
    if (!request) {
      throw new UnauthorizedException('Session expired or account deactivated');
    }

    const user = request.user;
    if (!user || !user.role) {
      throw new UnauthorizedException('Session expired or account deactivated');
    }

    // Owner role bypasses all RBAC checks (super-user)
    if (user.role === StaffRole.owner) {
      return true;
    }

    // Cast since we verified it's an array
    const rolesArray = requiredRoles as StaffRole[];
    const hasRole = rolesArray.includes(user.role);
    if (!hasRole) {
      throw new ForbiddenException('Insufficient permissions');
    }

    return true;
  }
}
