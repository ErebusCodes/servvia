import { StaffRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService } from '../audit/audit.service';
import { CredentialSetupService } from './credential-setup.service';

/** The system actor recorded for codes issued by the operator bootstrap command. */
export const CREDENTIAL_BOOTSTRAP_ACTOR = 'staff-credential-bootstrap';

/** The roles the bootstrap may issue a code for: those who can then administer staff. */
const BOOTSTRAP_ROLES: readonly StaffRole[] = [StaffRole.owner, StaffRole.admin];

export class CredentialBootstrapRefused extends Error {}

/**
 * Story 2.4: the governed way into the Admin Console when no administrator
 * can sign in (the shared admin PIN is gone). An operator with database access
 * on the host issues a single-use setup code for an existing, active owner or
 * admin; that person sets their own password at /setup-credential, which
 * revokes their sessions, and then signs in by name.
 *
 * It never creates an account, never changes a role and never sees or sets a
 * password: the existing password keeps working until the code is redeemed.
 * The code and its audit record (a system actor, never a fabricated staff
 * member) commit together. The caller shows the code once and stores it
 * nowhere.
 */
export async function issueBootstrapCredentialSetup(
  prisma: PrismaService,
  credentials: CredentialSetupService,
  audit: AuditLogService,
  email: string,
  now: Date = new Date(),
): Promise<{ staffId: string; email: string; role: StaffRole; code: string; expiresAt: Date }> {
  const normalized = email.trim().toLowerCase();
  const staff = await prisma.staff.findFirst({
    where: {
      email: normalized,
      deletedAt: null,
      isActive: true,
      role: { in: [...BOOTSTRAP_ROLES] },
      organization: { isActive: true },
      NOT: { email: { endsWith: '@verdura.internal' } },
    },
  });
  if (!staff) {
    throw new CredentialBootstrapRefused(
      'No active owner or admin with this email in an active organization',
    );
  }
  const issued = await prisma.$transaction(async (tx) => {
    const setup = await credentials.issue(
      staff.id,
      { system: CREDENTIAL_BOOTSTRAP_ACTOR },
      tx,
      now,
    );
    await audit.logAuthEvent(
      {
        organizationId: staff.organizationId,
        actorType: 'system',
        systemActor: CREDENTIAL_BOOTSTRAP_ACTOR,
        action: 'STAFF_CREDENTIAL_SETUP_ISSUED',
        resource: 'staff',
        resourceId: staff.id,
        after: { expiresAt: setup.expiresAt },
      },
      tx,
    );
    return setup;
  });
  return { staffId: staff.id, email: staff.email, role: staff.role, ...issued };
}
