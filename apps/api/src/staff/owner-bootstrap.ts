import { StaffRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService } from '../audit/audit.service';
import { CredentialSetupService, unusablePasswordHash } from './credential-setup.service';

/** The system actor recorded for an owner created by the first-owner bootstrap. */
export const OWNER_BOOTSTRAP_ACTOR = 'staff-owner-bootstrap';

export class OwnerBootstrapRefused extends Error {}

/**
 * The governed initial production bootstrap (Story 2.11): the only way to
 * create an organization's first owner on a real installation. An operator
 * with database access on the host runs it once, for one named person:
 *
 * - it refuses while the organization has any active owner, so it cannot be
 *   re-run as a recurring or shared way in (an owner who cannot sign in is
 *   recovered with `staff:issue-setup-code`, Story 2.4, and everyone else is
 *   administered from the Staff page);
 * - the account gets no usable password: the person sets their own with the
 *   single-use setup code it prints once (Story 8.1), and nobody else, the
 *   operator included, ever knows it;
 * - the owner is granted every venue of the organization (staff act only in
 *   granted venues, Stories 2.2 and 2.10);
 * - the account, its grants, the code and the audit records, attributed to a
 *   system actor rather than a fabricated staff member, commit together,
 *   under the same per-organization lock that guards the last owner.
 *
 * Development and test data come from prisma/seed.ts, which refuses
 * production; the seed never touches a production identity.
 */
export async function bootstrapFirstOwner(
  prisma: PrismaService,
  credentials: CredentialSetupService,
  audit: AuditLogService,
  input: { organizationSlug: string; email: string; name: string },
  now: Date = new Date(),
): Promise<{ staffId: string; email: string; venueIds: string[]; code: string; expiresAt: Date }> {
  const email = input.email.trim().toLowerCase();
  const name = input.name.trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || email.endsWith('@verdura.internal')) {
    throw new OwnerBootstrapRefused('A real email address is required');
  }
  if (!name) throw new OwnerBootstrapRefused('A name is required');
  const organization = await prisma.organization.findUnique({
    where: { slug: input.organizationSlug },
  });
  if (!organization || !organization.isActive) {
    throw new OwnerBootstrapRefused('No active organization with this slug');
  }
  const passwordHash = await unusablePasswordHash();

  return prisma.$transaction(async (tx) => {
    // Serializes with every owner change (StaffAdministrationService), and
    // with a second bootstrap run for the same organization.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`staff-owner-guard:${organization.id}`}, 0))`;
    const owners = await tx.staff.count({
      where: {
        organizationId: organization.id,
        role: StaffRole.owner,
        isActive: true,
        deletedAt: null,
        NOT: { email: { endsWith: '@verdura.internal' } },
      },
    });
    if (owners > 0) {
      throw new OwnerBootstrapRefused(
        'This organization already has an active owner. Recover an owner who cannot sign in ' +
          'with staff:issue-setup-code; create other staff from the Staff page.',
      );
    }
    if (await tx.staff.findUnique({ where: { email } })) {
      throw new OwnerBootstrapRefused('This email address is already used by a staff account');
    }
    const venues = await tx.venue.findMany({
      where: { organizationId: organization.id },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    });
    const venueIds = venues.map((v) => v.id);
    const staff = await tx.staff.create({
      data: { organizationId: organization.id, email, name, role: StaffRole.owner, passwordHash },
    });
    if (venueIds.length > 0) {
      await tx.venueAccess.createMany({
        data: venueIds.map((venueId) => ({ staffId: staff.id, venueId, grantedById: staff.id })),
      });
    }
    const setup = await credentials.issue(staff.id, { system: OWNER_BOOTSTRAP_ACTOR }, tx, now);
    const system = {
      organizationId: organization.id,
      actorType: 'system' as const,
      systemActor: OWNER_BOOTSTRAP_ACTOR,
      resource: 'staff',
      resourceId: staff.id,
    };
    await audit.logAuthEvent(
      {
        ...system,
        action: 'STAFF_CREATED',
        after: { name, email, role: StaffRole.owner, venueIds },
      },
      tx,
    );
    await audit.logAuthEvent(
      { ...system, action: 'STAFF_CREDENTIAL_SETUP_ISSUED', after: { expiresAt: setup.expiresAt } },
      tx,
    );
    return { staffId: staff.id, email, venueIds, ...setup };
  });
}
