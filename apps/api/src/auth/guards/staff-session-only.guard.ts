import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Request } from 'express';
import { AuthenticatedUser } from '../interfaces/jwt-payload.interface';

/**
 * Rejects any device-issued token kind (`kds_device`, `tablet_device`,
 * `tablet_staff`, `tablet_manager`) even when its `role` claim would
 * otherwise satisfy a `@Roles(...)` check — defense in depth so a manager
 * who happens to be elevated on a tablet cannot use that elevation token
 * as a back door into full Admin Console administrative capability (e.g.
 * creating tablet enrollment codes, revoking devices, setting other staff
 * members' PINs). Only a genuine staff login session (`kind` undefined or
 * `'staff'`) passes. Applied narrowly to the specific admin-only endpoints
 * this story adds — not a change to any existing guard's behaviour.
 */
@Injectable()
export class StaffSessionOnlyGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request & { user?: AuthenticatedUser }>();
    const kind = request.user?.kind;
    if (kind && kind !== 'staff') {
      throw new ForbiddenException('This action requires a genuine staff login session');
    }
    return true;
  }
}
