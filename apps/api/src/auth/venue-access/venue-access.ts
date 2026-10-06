import { ForbiddenException, InternalServerErrorException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthenticatedUser } from '../interfaces/jwt-payload.interface';
import { logSecurityEvent } from '../../observability/security-events';

/**
 * Staff venue access (Story 2.2 in Core; Story 2.10 in the Nest API): a staff
 * member may act only in venues they have been explicitly granted (a
 * VenueAccess row). PRD section 16 item 3 records no exception, so the rule
 * applies to every staff role, owner and admin included.
 *
 * The decision is Go Core's, so both services answer the same request the
 * same way (internal/identity/venueaccess.go):
 * - staff principals are a staff login session and a PIN-elevated tablet
 *   (`tablet_staff`, `tablet_manager`, acting as the staff member in `sub`);
 * - a venue of another organization, or an unknown one, is not this check's
 *   to answer: the route's own tenancy check answers 404, as it always has,
 *   so venues of other organizations cannot be enumerated;
 * - an own-organization venue without a grant is refused with 403;
 * - a lookup that cannot be made fails closed (500), never access.
 * Device identities (a KDS screen, an unelevated tablet) are not staff; they
 * stay pinned to their token's venue by resolveVenueScope.
 */
export const VENUE_ACCESS_DENIED_MESSAGE = 'Staff access to this venue has not been granted';

const STAFF_KINDS = new Set<AuthenticatedUser['kind']>([
  undefined,
  'staff',
  'tablet_staff',
  'tablet_manager',
]);

export function isStaffPrincipal(user: Pick<AuthenticatedUser, 'kind'>): boolean {
  return STAFF_KINDS.has(user.kind);
}

export enum VenueAccessDecision {
  NotInOrganization = 'not_in_organization',
  NotGranted = 'not_granted',
  Granted = 'granted',
}

type Db = Pick<PrismaService, '$queryRaw'>;

export async function decideVenueAccess(
  db: Db,
  staffId: string,
  organizationId: string,
  venueId: string,
): Promise<VenueAccessDecision> {
  const [row] = await db.$queryRaw<{ in_organization: boolean; granted: boolean }[]>`
    SELECT
      EXISTS (SELECT 1 FROM "Venue" WHERE id = ${venueId} AND "organizationId" = ${organizationId}) AS in_organization,
      EXISTS (SELECT 1 FROM "VenueAccess" WHERE "staffId" = ${staffId} AND "venueId" = ${venueId}) AS granted`;
  if (!row?.in_organization) return VenueAccessDecision.NotInOrganization;
  return row.granted ? VenueAccessDecision.Granted : VenueAccessDecision.NotGranted;
}

/** The venues of their own organization a staff member has been granted. */
export async function grantedVenueIds(
  db: Pick<PrismaService, 'venueAccess'>,
  staffId: string,
  organizationId: string,
): Promise<string[]> {
  const grants = await db.venueAccess.findMany({
    where: { staffId, venue: { organizationId } },
    select: { venueId: true },
  });
  return grants.map((g) => g.venueId);
}

/**
 * Refuses a staff principal without a grant for an own-organization venue
 * (403) and records the refusal as a `venue_access_denied` security event
 * (Core's name and fields; never the credential). Other identities and
 * other organizations' venues pass through, as described above.
 */
export async function assertVenueAccess(
  db: Db,
  user: AuthenticatedUser,
  venueId: string,
  context: Record<string, string | undefined> = {},
): Promise<void> {
  if (!isStaffPrincipal(user)) return;
  let decision: VenueAccessDecision;
  try {
    decision = await decideVenueAccess(db, user.id, user.organizationId, venueId);
  } catch (err) {
    logSecurityEvent('venue_access_check_failed', 'venue access check failed', {
      staff_id: user.id,
      venue_id: venueId,
      error: (err as Error).message,
      ...context,
    });
    throw new InternalServerErrorException();
  }
  if (decision === VenueAccessDecision.NotGranted) {
    logSecurityEvent('venue_access_denied', 'staff venue access denied', {
      staff_id: user.id,
      kind: user.kind ?? 'staff_session',
      role: user.role,
      organization_id: user.organizationId,
      venue_id: venueId,
      ...context,
    });
    throw new ForbiddenException(VENUE_ACCESS_DENIED_MESSAGE);
  }
}
