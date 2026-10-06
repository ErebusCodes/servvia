import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthenticatedUser } from '../interfaces/jwt-payload.interface';
import { grantedVenueIds, isStaffPrincipal } from './venue-access';

@Injectable()
export class VenueAccessService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * The venues a route that lists across venues may show this caller
   * (@VenueScope({ list: true }), or an optional venue filter left empty):
   * a staff principal's granted venues of their organization. Undefined for
   * a device identity, whose venue resolveVenueScope already pins.
   */
  async listableVenueIds(user: AuthenticatedUser): Promise<string[] | undefined> {
    if (!isStaffPrincipal(user)) return undefined;
    return grantedVenueIds(this.prisma, user.id, user.organizationId);
  }
}
