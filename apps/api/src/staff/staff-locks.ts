import { ForbiddenException } from '@nestjs/common';
import { Prisma, Staff } from '@prisma/client';

/**
 * Story 8.3: a security-sensitive staff change decides from the state its own
 * transaction protects, never from a read made before it. These are the
 * locks it takes, always in this order: staff rows (ascending id), then the
 * per-organization owner lock or the per-venue PIN locks (ascending venue).
 */

/** Locks the given Staff rows FOR UPDATE, in id order so two changes cannot deadlock. */
export async function lockStaffRows(tx: Prisma.TransactionClient, ids: string[]): Promise<void> {
  const unique = [...new Set(ids)].sort();
  await tx.$queryRaw`SELECT id FROM "Staff" WHERE id = ANY(${unique}::text[]) ORDER BY id FOR UPDATE`;
}

/**
 * The acting staff member as the database has them now (their row locked by
 * the caller): refused if they were deactivated, removed or their
 * organization was, after their request was authenticated. Their current
 * role, not the token's, is what the caller authorizes with.
 */
export async function liveActor(
  tx: Prisma.TransactionClient,
  actor: { id: string; organizationId: string },
): Promise<Staff> {
  const staff = await tx.staff.findFirst({
    where: {
      id: actor.id,
      organizationId: actor.organizationId,
      deletedAt: null,
      isActive: true,
      organization: { isActive: true },
    },
  });
  if (!staff) {
    throw new ForbiddenException('Your staff account can no longer make this change');
  }
  return staff;
}

/**
 * Serializes every change that can make two people's tablet PINs equal in a
 * venue: setting a PIN locks each venue it is enrolled in, in venue order.
 */
export async function lockTabletPinVenues(
  tx: Prisma.TransactionClient,
  venueIds: string[],
): Promise<void> {
  for (const venueId of [...new Set(venueIds)].sort()) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`tablet-pin:${venueId}`}, 0))`;
  }
}
