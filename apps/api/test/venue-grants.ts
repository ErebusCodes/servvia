import { PrismaClient } from '@prisma/client';

/**
 * Story 2.10: staff act only in venues they have been granted, in the Nest
 * API as in Core, so a fixture that creates venues and the staff acting in
 * them grants those venues, as the Go fixtures do (GrantVenueAccess).
 */
export async function grantVenues(
  prisma: Pick<PrismaClient, 'venueAccess'>,
  staffId: string,
  venueIds: string[],
): Promise<void> {
  await prisma.venueAccess.createMany({
    data: venueIds.map((venueId) => ({ staffId, venueId, grantedById: staffId })),
    skipDuplicates: true,
  });
}

/** VenueAccess restricts deleting its staff and venue: remove grants first. */
export async function deleteVenueGrants(
  prisma: Pick<PrismaClient, 'venueAccess'>,
  organizationId: string,
): Promise<void> {
  await prisma.venueAccess.deleteMany({ where: { venue: { organizationId } } });
}
