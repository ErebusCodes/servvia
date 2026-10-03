import {
  BadRequestException,
  CanActivate,
  ExecutionContext,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthenticatedUser } from '../interfaces/jwt-payload.interface';
import { assertVenueAccess, isStaffPrincipal } from './venue-access';
import {
  ORGANIZATION_SCOPE_KEY,
  VENUE_SCOPE_KEY,
  VenueResource,
  VenueScopeSource,
} from './venue-scope.decorator';

type AuthedRequest = Request & { user?: AuthenticatedUser };

/**
 * Story 2.10: applies the staff venue access rule to the venue a route
 * declares with @VenueScope. It runs last in the guard chain, after
 * authentication, roles and the device re-check, the order Go Core applies
 * the same rule in, so both services refuse a request with the same answer.
 *
 * A route with neither @VenueScope nor @OrganizationScope is a programming
 * error and fails closed; venue-scope.architecture.spec.ts keeps every JWT
 * route declared.
 */
@Injectable()
export class VenueAccessGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    const source = this.reflector.getAllAndOverride<VenueScopeSource | undefined>(
      VENUE_SCOPE_KEY,
      targets,
    );
    if (!source) {
      if (this.reflector.getAllAndOverride<string | undefined>(ORGANIZATION_SCOPE_KEY, targets)) {
        return true;
      }
      throw new InternalServerErrorException('Route has no declared venue scope');
    }
    const request = context.switchToHttp().getRequest<AuthedRequest>();
    const user = request.user;
    if (!user || !isStaffPrincipal(user) || 'list' in source) return true;

    const venueId = await this.venueOf(source, request, user);
    if (venueId === undefined) return true;
    await assertVenueAccess(this.prisma, user, venueId, {
      method: request.method,
      route: (request.route as { path?: string } | undefined)?.path,
    });
    return true;
  }

  /** The venue the request acts in; undefined when there is none to check. */
  private async venueOf(
    source: VenueScopeSource,
    request: AuthedRequest,
    user: AuthenticatedUser,
  ): Promise<string | undefined> {
    if ('param' in source) return stringOrUndefined(request.params?.[source.param]);
    if ('query' in source) return stringOrUndefined(request.query?.[source.query]);
    if ('body' in source) {
      return stringOrUndefined(
        (request.body as Record<string, unknown> | undefined)?.[source.body],
      );
    }
    if ('token' in source) return user.venueId;
    if ('list' in source) return undefined;
    const id = stringOrUndefined(request.params?.[source.idParam ?? 'id']);
    return this.resourceVenue(source.resource, id, user.organizationId);
  }

  /**
   * The venue of the named record when it belongs to the caller's
   * organization; otherwise undefined, and the route answers its own 404.
   */
  private async resourceVenue(
    resource: VenueResource,
    id: string | undefined,
    organizationId: string,
  ): Promise<string | undefined> {
    // The Table 19 validation venue is server configuration (orders.service.ts).
    if (resource === 'table19ValidationVenue')
      return process.env.TABLE19_LIVE_TEST_VENUE_ID || undefined;
    if (!id) return undefined;
    const inOrganization = { venue: { organizationId } };
    let row: { venueId: string } | null;
    switch (resource) {
      case 'order':
        row = await this.prisma.order.findFirst({
          where: { id, ...inOrganization },
          select: { venueId: true },
        });
        break;
      case 'printer':
        row = await this.prisma.printer.findFirst({
          where: { id, ...inOrganization },
          select: { venueId: true },
        });
        break;
      case 'paymentObservation':
        row = await this.prisma.paymentObservation.findFirst({
          where: { id, ...inOrganization },
          select: { venueId: true },
        });
        break;
      case 'reservation':
        row = await this.prisma.reservation.findFirst({
          where: { id, ...inOrganization },
          select: { venueId: true },
        });
        break;
      case 'mediaAsset':
        row = await this.prisma.mediaAsset.findFirst({
          where: { id, organizationId },
          select: { venueId: true },
        });
        break;
    }
    return row?.venueId;
  }
}

/**
 * A venue ID from the request: absent or empty is "none"; anything but a
 * single string (a repeated query parameter, an object) is refused rather
 * than read as "none", which would skip the check.
 */
function stringOrUndefined(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string') throw new BadRequestException('venue ID must be a single string');
  return value;
}
