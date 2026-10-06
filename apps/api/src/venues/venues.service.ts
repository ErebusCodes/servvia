import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateVenueDto } from './dto/create-venue.dto';
import { UpdateVenueDto } from './dto/update-venue.dto';
import { Prisma, Venue } from '@prisma/client';

@Injectable()
export class VenuesService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Story 2.10: staff act only in venues they have been granted, so the
   * creator is granted the new venue in the same transaction; otherwise
   * nobody could administer it.
   */
  async create(organizationId: string, dto: CreateVenueDto, creatorId: string): Promise<Venue> {
    // Check if a venue with the same slug already exists in this organization
    const existing = await this.prisma.venue.findFirst({
      where: { organizationId, slug: dto.slug },
    });
    if (existing) {
      throw new ConflictException(
        `Venue with slug "${dto.slug}" already exists in this organization`,
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const venue = await tx.venue.create({
        data: {
          organizationId,
          name: dto.name,
          slug: dto.slug,
          address: dto.address,
          phone: dto.phone,
          email: dto.email,
          timezone: dto.timezone || 'Pacific/Auckland',
          currency: dto.currency || 'NZD',
          locale: dto.locale || 'en-NZ',
          taxJurisdiction: dto.taxJurisdiction || 'NZ_GST',
          pricesIncludeTax: dto.pricesIncludeTax ?? true,
          operatingHours: dto.operatingHours,
          seatingCapacity: dto.seatingCapacity,
          coversPerSlot: dto.coversPerSlot ?? 20,
          reservationSlotMinutes: dto.reservationSlotMinutes ?? 30,
          posAdapterType: dto.posAdapterType || 'none',
          posConfig: dto.posConfig || {},
        },
      });
      await tx.venueAccess.create({
        data: { staffId: creatorId, venueId: venue.id, grantedById: creatorId },
      });
      return venue;
    });
  }

  /** `venueIds` narrows the list to a staff member's granted venues (Story 2.10). */
  async findAll(organizationId: string, venueIds?: string[]): Promise<Venue[]> {
    return this.prisma.venue.findMany({
      where: { organizationId, ...(venueIds ? { id: { in: venueIds } } : {}) },
      orderBy: { createdAt: 'asc' },
    });
  }

  async findOne(id: string, organizationId: string): Promise<Venue> {
    const venue = await this.prisma.venue.findFirst({
      where: { id, organizationId },
    });
    if (!venue) {
      throw new NotFoundException('Venue not found');
    }
    return venue;
  }

  /**
   * Narrow, low-sensitivity read used by billing-calculation surfaces (Order
   * Tablet — story 15-4) that need the venue's tax/currency configuration but
   * must not receive the full Venue record (posConfig, address, etc.) or
   * require admin/manager-only access. Org-scoped like findOne, matching the
   * existing tenancy-isolation pattern.
   */
  async getTaxConfig(
    id: string,
    organizationId: string,
  ): Promise<Pick<Venue, 'currency' | 'locale' | 'taxJurisdiction' | 'pricesIncludeTax'>> {
    const venue = await this.prisma.venue.findFirst({
      where: { id, organizationId },
      select: { currency: true, locale: true, taxJurisdiction: true, pricesIncludeTax: true },
    });
    if (!venue) {
      throw new NotFoundException('Venue not found');
    }
    return venue;
  }

  async update(id: string, organizationId: string, dto: UpdateVenueDto): Promise<Venue> {
    // Check if venue exists
    await this.findOne(id, organizationId);

    // If updating slug, check uniqueness in organization
    if (dto.slug) {
      const existing = await this.prisma.venue.findFirst({
        where: {
          organizationId,
          slug: dto.slug,
          id: { not: id },
        },
      });
      if (existing) {
        throw new ConflictException(
          `Venue with slug "${dto.slug}" already exists in this organization`,
        );
      }
    }

    return this.prisma.venue.update({
      where: { id },
      data: {
        name: dto.name,
        slug: dto.slug,
        address: dto.address,
        phone: dto.phone,
        email: dto.email,
        timezone: dto.timezone,
        currency: dto.currency,
        locale: dto.locale,
        taxJurisdiction: dto.taxJurisdiction,
        pricesIncludeTax: dto.pricesIncludeTax,
        operatingHours: dto.operatingHours,
        seatingCapacity: dto.seatingCapacity,
        coversPerSlot: dto.coversPerSlot,
        reservationSlotMinutes: dto.reservationSlotMinutes,
        posAdapterType: dto.posAdapterType,
        posConfig: dto.posConfig,
      },
    });
  }

  async remove(id: string, organizationId: string): Promise<Venue> {
    // Check if venue exists
    await this.findOne(id, organizationId);

    try {
      return await this.prisma.venue.delete({
        where: { id },
      });
    } catch (error) {
      // A venue with history (orders, audit records, ...) is kept: every
      // foreign key to Venue restricts deletion. Answer 409, not a 500.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') {
        throw new ConflictException('This venue has recorded history and cannot be deleted');
      }
      throw error;
    }
  }
}
