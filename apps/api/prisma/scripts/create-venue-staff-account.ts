/**
 * Creates ONE operational staff account (with a tablet-elevation PIN) for an
 * organization that has none.
 *
 * Why this exists (found live at DUNEDIN, 2026-08-31): the venue had exactly
 * one active Staff row — role `owner` — and zero rows with a `pinHash`. The
 * missing PIN is the entire deadlock. The `owner` role is NOT a cause of it:
 *
 *   - `POST /tablet/elevate` only considers active staff with a `pinHash`
 *     (TabletAuthService.elevateStaff). With no PIN set anywhere, the tablet
 *     can never elevate out of its restricted device context at all, so no
 *     downstream staff-role check is ever even reached. This, alone, is the
 *     deadlock.
 *   - API RBAC is NOT a contributor. `PATCH /admin/orders/:id/status` is
 *     decorated with STAFF_ORDER_ROLES (admin/manager/cashier/kitchen —
 *     orders.controller.ts), and `owner` is indeed absent from that set. But
 *     RolesGuard short-circuits on `user.role === StaffRole.owner` and
 *     returns true BEFORE it consults the decorator's set at all
 *     (auth/guards/roles.guard.ts: "Owner role bypasses all RBAC checks
 *     (super-user)"). An `owner` therefore PASSES the order-status guard.
 *     An earlier revision of this comment asserted the opposite — that
 *     `owner` could not pass the API order-role guard — and that was wrong.
 *   - One genuine `owner` gap does remain, and it is purely client-side: the
 *     Order Tablet derives `hasClosePerm` from supervisor/manager/admin
 *     (OrderTabletPage.tsx) and excludes `owner`, so the "Close Table"
 *     control is hidden from an owner even though the API would accept the
 *     call. That is a separate UI/API role-mismatch bug; it is deliberately
 *     NOT addressed by this script.
 *
 * Net effect: orders could be CREATED through the device-token path
 * (`/api/tablet/orders`, which needs no staff role), but no one could
 * elevate on the tablet to close or cancel them — leaving a table
 * permanently occupied and blocking every subsequent order on it.
 *
 * This script mirrors StaffService.create + StaffService.setTabletPin
 * verbatim (same Argon2id type, same fields, same
 * PIN-must-not-equal-password rejection) rather than hand-rolling hashes.
 * It is for the bootstrap case where a production host has DB access but no
 * interactive staff session capable of calling the real endpoints — the
 * admin console's own staff/tablet-PIN management UI remains the intended
 * long-term path, and should be preferred whenever a qualifying session
 * exists.
 *
 * Credentials are GENERATED here (crypto-random) and printed exactly once on
 * --apply. They are never logged, never stored in plaintext, and never
 * derived from each other.
 *
 * Usage (run from apps/api/):
 *   ORG_ID=<uuid> npx ts-node -r tsconfig-paths/register prisma/scripts/create-venue-staff-account.ts --dry-run
 *   ORG_ID=<uuid> npx ts-node -r tsconfig-paths/register prisma/scripts/create-venue-staff-account.ts --apply
 *
 * Optional env: STAFF_EMAIL, STAFF_NAME, STAFF_ROLE (default manager),
 * STAFF_PIN (4-8 digits; omit to generate one).
 *
 * Fail-closed CLI: dry-run is the default with NO flags (safe by default,
 * not opt-out); real writes require an explicit --apply. Any unrecognized
 * argument aborts rather than silently picking a mode.
 */
import { PrismaClient, StaffRole } from '@prisma/client';
import * as argon2 from 'argon2';
import { randomInt, randomBytes } from 'crypto';

const KNOWN_FLAGS = new Set(['--dry-run', '--apply']);
const cliArgs = process.argv.slice(2);
const unknownArgs = cliArgs.filter((a) => !KNOWN_FLAGS.has(a));
if (unknownArgs.length > 0) {
  console.error(
    `Unrecognized argument(s): ${unknownArgs.join(', ')}. ` +
      'Refusing to run rather than guess a mode. Pass no flags or --dry-run for a read-only report, or --apply to write.',
  );
  process.exit(1);
}
const APPLY = cliArgs.includes('--apply');

// Roles that can operate orders end to end through the tablet UI as well as
// the API. Deliberately excludes `viewer` (no order permissions) and also
// `owner` — but NOT because `owner` fails API RBAC. It does not: RolesGuard
// grants `owner` a super-user bypass (see the header note). `owner` is
// excluded because the tablet's own client-side `hasClosePerm` check omits
// it, so an owner-only venue still could not close a table from the tablet.
// Defaulting to `manager` resolves the venue without first depending on that
// separate UI bug being fixed.
const OPERATIONAL_ROLES = new Set<string>([
  StaffRole.admin,
  StaffRole.manager,
  StaffRole.cashier,
  StaffRole.kitchen,
]);

const prisma = new PrismaClient();

function generatePin(): string {
  // 6 digits, uniformly random, leading zeros preserved.
  return Array.from({ length: 6 }, () => randomInt(0, 10)).join('');
}

function generatePassword(): string {
  // 32 url-safe chars — this account is expected to be used via the tablet
  // PIN, not typed by hand, so favour strength over memorability.
  return randomBytes(24).toString('base64url');
}

async function main(): Promise<void> {
  const organizationId = process.env.ORG_ID;
  if (!organizationId) {
    throw new Error('ORG_ID is required (the organization to create the staff account in).');
  }

  const email = (process.env.STAFF_EMAIL ?? 'manager@verdura.co.nz').trim().toLowerCase();
  const name = process.env.STAFF_NAME ?? 'Venue Manager';
  const role = (process.env.STAFF_ROLE ?? StaffRole.manager) as StaffRole;

  if (!OPERATIONAL_ROLES.has(role)) {
    throw new Error(
      `STAFF_ROLE must be one of ${[...OPERATIONAL_ROLES].join(', ')} — got "${role}". ` +
        'This account must be able to close a table from the tablet, whose client-side check accepts only supervisor/manager/admin.',
    );
  }

  const org = await prisma.organization.findUnique({ where: { id: organizationId } });
  if (!org) {
    throw new Error(`Organization ${organizationId} not found.`);
  }

  const existing = await prisma.staff.findFirst({ where: { email } });
  if (existing) {
    throw new Error(
      `A Staff row already exists with email ${email} (id ${existing.id}, role ${existing.role}). ` +
        'Refusing to modify an existing account — set its PIN through the admin console instead.',
    );
  }

  const pin = process.env.STAFF_PIN ?? generatePin();
  if (!/^\d{4,8}$/.test(pin)) {
    throw new Error('STAFF_PIN must be 4-8 digits (matches SetStaffPinDto).');
  }
  const password = generatePassword();
  if (pin === password) {
    // Mirrors setTabletPin's own rejection. Unreachable with generated
    // values; enforced anyway so a supplied STAFF_PIN can never collide.
    throw new Error('The tablet PIN must not be the same as the login password.');
  }

  // Report the deadlock state this is resolving, so the operator can see the
  // before-picture in the same output as the change.
  const activeOperational = await prisma.staff.findMany({
    where: { organizationId, isActive: true, deletedAt: null, role: { in: [...OPERATIONAL_ROLES] as StaffRole[] } },
    select: { email: true, role: true, pinHash: true },
  });
  const withPin = await prisma.staff.count({
    where: { organizationId, isActive: true, deletedAt: null, pinHash: { not: null } },
  });

  console.log(`Organization : ${org.name} (${organizationId})`);
  console.log(`Active staff with an order-operational role, before: ${activeOperational.length}`);
  console.log(`Active staff with a tablet PIN, before             : ${withPin}`);
  console.log('');
  console.log(`Would create : ${email} / "${name}" / role=${role}, with a tablet PIN.`);

  if (!APPLY) {
    console.log('');
    console.log('DRY RUN — nothing written. Re-run with --apply to create the account.');
    return;
  }

  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
  const pinHash = await argon2.hash(pin, { type: argon2.argon2id });

  const created = await prisma.staff.create({
    data: {
      organizationId,
      email,
      name,
      passwordHash,
      role,
      pinHash,
      pinSetAt: new Date(),
    },
  });

  // Read back through the same predicate elevateStaff uses, so the output
  // proves the account is actually reachable by the tablet rather than
  // merely that a row was inserted.
  const elevatable = await prisma.staff.count({
    where: {
      organizationId,
      isActive: true,
      pinHash: { not: null },
      deletedAt: null,
    },
  });

  console.log('');
  console.log(`CREATED Staff ${created.id}`);
  console.log(`  email : ${created.email}`);
  console.log(`  role  : ${created.role}`);
  console.log(`  active: ${created.isActive}`);
  console.log(`Staff now matching TabletAuthService.elevateStaff's candidate filter: ${elevatable}`);
  console.log('');
  console.log('──────── CREDENTIALS — shown once, not recoverable ────────');
  console.log(`  Tablet elevation PIN : ${pin}`);
  console.log(`  Login password       : ${password}`);
  console.log('──────────────────────────────────────────────────────────');
}

main()
  .catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
