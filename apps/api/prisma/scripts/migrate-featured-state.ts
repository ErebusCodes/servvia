/**
 * Phase E2 migration script — migrates the legacy
 * `nutritionalDetails.isFeatured` JSON convention onto the real
 * `MenuItem.isFeatured` column. Deliberately does NOT remove the old JSON
 * property (per instruction, not proven safe/authorized to delete yet) —
 * this is purely additive at the data level: only ever flips
 * `isFeatured` from false to true, never touches `nutritionalDetails`.
 *
 * Fail-closed CLI, dry-run default, --apply required.
 *
 * Usage (run from apps/api/):
 *   ORG_ID=<organization-id> npx ts-node prisma/scripts/migrate-featured-state.ts --dry-run
 *   ... --apply
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const KNOWN_FLAGS = new Set(['--dry-run', '--apply']);

async function main() {
  const cliArgs = process.argv.slice(2);
  const unknownArgs = cliArgs.filter((a) => !KNOWN_FLAGS.has(a));
  if (unknownArgs.length > 0) {
    console.error(`Unrecognized argument(s): ${unknownArgs.join(', ')}. Refusing to run.`);
    process.exit(1);
  }
  if (cliArgs.includes('--dry-run') && cliArgs.includes('--apply')) {
    console.error('Both --dry-run and --apply passed -- refusing an ambiguous mode.');
    process.exit(1);
  }
  const APPLY = cliArgs.includes('--apply');

  const organizationId = process.env.ORG_ID;
  if (!organizationId) throw new Error('ORG_ID env var is required');

  const organization = await prisma.organization.findUnique({ where: { id: organizationId } });
  if (!organization) throw new Error(`Organization ${organizationId} not found`);

  const candidates = await prisma.$queryRawUnsafe<{ id: string; title: string }[]>(
    `SELECT id, title FROM "MenuItem"
     WHERE "organizationId" = $1
       AND "deletedAt" IS NULL
       AND "isFeatured" = false
       AND "nutritionalDetails"->>'isFeatured' = 'true'`,
    organizationId,
  );

  const prefix = APPLY ? '' : '[DRY RUN] ';
  console.log(`${prefix}Found ${candidates.length} item(s) with legacy isFeatured=true not yet migrated:`);
  for (const c of candidates) console.log(`${prefix}  - ${c.title} (${c.id})`);

  if (!APPLY) {
    console.log(`${prefix}No write performed.`);
    return;
  }

  if (candidates.length === 0) {
    console.log('Nothing to migrate.');
    return;
  }

  const { count } = await prisma.menuItem.updateMany({
    where: { id: { in: candidates.map((c) => c.id) }, isFeatured: false },
    data: { isFeatured: true },
  });
  console.log(`Applied. Set isFeatured=true on ${count} item(s). nutritionalDetails left untouched.`);
}

main()
  .catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
