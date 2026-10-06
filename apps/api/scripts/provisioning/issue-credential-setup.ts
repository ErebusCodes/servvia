// Story 2.4: issue a single-use credential setup code for an existing, active
// owner or admin, so they can set their own password and sign in to the Admin
// Console by name. Run by an operator with database access on the host:
//
//   npm run staff:issue-setup-code --workspace=apps/api -- owner@example.com
//
// The code is printed once, to this terminal only; it is never logged or
// stored in plain text. Hand it to the person in person; they redeem it at
// /setup-credential within 24 hours. Issuing a code ends the person's earlier
// unused codes, changes nothing else, and is audited as a system actor
// (staff-credential-bootstrap). See src/staff/credential-bootstrap.ts.
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../src/prisma/prisma.service';
import { AuditLogService } from '../../src/audit/audit.service';
import { StaffSessionService } from '../../src/auth/staff-session.service';
import { CredentialSetupService } from '../../src/staff/credential-setup.service';
import {
  CredentialBootstrapRefused,
  issueBootstrapCredentialSetup,
} from '../../src/staff/credential-bootstrap';

async function main(): Promise<number> {
  const email = process.argv[2];
  if (!email || process.argv.length > 3) {
    console.error('Usage: issue-credential-setup <owner-or-admin-email>');
    return 2;
  }
  const prisma = new PrismaService();
  try {
    const audit = new AuditLogService(prisma);
    const sessions = new StaffSessionService(prisma, new ConfigService());
    const credentials = new CredentialSetupService(prisma, audit, sessions);
    const issued = await issueBootstrapCredentialSetup(prisma, credentials, audit, email);
    console.log(`Setup code for ${issued.email} (${issued.role}):`);
    console.log('');
    console.log(`  ${issued.code}`);
    console.log('');
    console.log(
      `Valid once, until ${issued.expiresAt.toISOString()}. Redeem it at /setup-credential.`,
    );
    return 0;
  } catch (err) {
    if (err instanceof CredentialBootstrapRefused) {
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
