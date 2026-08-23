import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { POSSyncRecord, POSSyncStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Story 9-1 AC6: read-only admin visibility into POSSyncRecord's truthful
 * states. Org/venue-scoped identically to PrinterJobsService (Story 8-1) —
 * a 404, not a bare-metal Prisma error or a 200 with someone else's data,
 * for a record outside the caller's scope.
 */
@Injectable()
export class PosSyncRecordsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * `venueId` must already be the fully resolved/validated venue to query —
   * the caller (controller) is responsible for passing it through
   * `resolveVenueScope(user, requestedVenueId)` first, so a KDS device
   * token requesting a venue outside its own scope is rejected there
   * (ForbiddenException) rather than silently substituted here.
   */
  async listForVenue(
    venueId: string,
    organizationId: string,
    status?: string,
  ): Promise<POSSyncRecord[]> {
    const venue = await this.prisma.venue.findFirst({
      where: { id: venueId, organizationId },
    });
    if (!venue) {
      throw new NotFoundException('Venue not found');
    }

    const statusFilter = this.parseStatusFilter(status);
    return this.prisma.pOSSyncRecord.findMany({
      where: { venueId, ...(statusFilter ? { status: statusFilter } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  async getForOrder(
    orderId: string,
    organizationId: string,
    scopedVenueId: string | undefined,
  ): Promise<POSSyncRecord | { orderId: string; status: POSSyncStatus }> {
    const order = await this.prisma.order.findFirst({
      where: {
        id: orderId,
        venue: { organizationId },
        ...(scopedVenueId ? { venueId: scopedVenueId } : {}),
      },
    });
    if (!order) {
      throw new NotFoundException('Order not found');
    }

    const record = await this.prisma.pOSSyncRecord.findUnique({ where: { orderId } });
    if (record) return record;

    // A `none`-adapter venue's order never gets a POSSyncRecord row (see
    // OrdersService.persistOrder) — Order.posSyncStatus is the sole,
    // already-truthful source for that case, not an omission to paper over
    // with a fabricated record.
    return { orderId, status: order.posSyncStatus };
  }

  private parseStatusFilter(status?: string): POSSyncStatus | undefined {
    if (status === undefined) return undefined;
    if (!Object.values(POSSyncStatus).includes(status as POSSyncStatus)) {
      throw new BadRequestException(`Invalid status filter: ${status}`);
    }
    return status as POSSyncStatus;
  }
}
