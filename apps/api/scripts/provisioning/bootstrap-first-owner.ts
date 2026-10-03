// Story 2.11: create an organization's FIRST owner on a real installation,
// the governed way. Run once by an operator with database access on the host:
//
//   npm run staff:bootstrap-owner --workspace=apps/api -- <organization-slug> <email> "<name>"
//
// It refuses while the organization has any active owner. The account has no
// usable password: the single-use setup code printed once, to this terminal
// only, lets that person set their own at /setup-credential within 24 hours.
// The account, its venue grants, the code and the audit records (system actor
// staff-owner-bootstrap) commit together. See src/staff/owner-bootstrap.ts.
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../src/prisma/prisma.service';
import { AuditLogService } from '../../src/audit/audit.service';
import { StaffSessionService } from '../../src/auth/staff-session.service';
import { CredentialSetupService } from '../../src/staff/credential-setup.service';
import { OwnerBootstrapRefused, bootstrapFirstOwner } from '../../src/staff/owner-bootstrap';

async function main(): Promise<number> {
  const [organizationSlug, email, name] = process.argv.slice(2);
  if (!organizationSlug || !email || !name || process.argv.length > 5) {
    console.error('Usage: bootstrap-first-owner <organization-slug> <email> "<name>"');
    return 2;
  }
  const prisma = new PrismaService();
  try {
    const audit = new AuditLogService(prisma);
    const sessions = new StaffSessionService(prisma, new ConfigService());
    const credentials = new CredentialSetupService(prisma, audit, sessions);
    const owner = await bootstrapFirstOwner(prisma, credentials, audit, {
      organizationSlug,
      email,
      name,
    });
    console.log(`Owner ${owner.email} created, granted ${owner.venueIds.length} venue(s).`);
    console.log('Setup code (give it to them in person):');
    console.log('');
    console.log(`  ${owner.code}`);
    console.log('');
    console.log(
      `Valid once, until ${owner.expiresAt.toISOString()}. Redeem it at /setup-credential.`,
    );
    return 0;
  } catch (err) {
    if (err instanceof OwnerBootstrapRefused) {
      console.error(err.message);
      return 1;
    }
    throw err;
  } finally {
    await prisma.$disconnect();
  }
}

main().then(
  (code) => process.exit(code),
  (err: unknown) => {
    console.error(`Failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  },
);
