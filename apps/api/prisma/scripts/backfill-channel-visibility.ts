/**
 * Phase E2 migration script — backfills `visibleChannels` on the existing
 * curated Category/MenuItem rows only. Never touches the staging
 * ("Imported from IdealPOS (pending review)") category or any MenuItem
 * inside it — those must remain `visibleChannels: []` forever (deny-by-
 * default is the whole point of the Menu Management architecture).
 *
 * Fail-closed CLI, same convention as apply-plu-mapping.ts /
 * sync-pos-catalog.ts: dry-run is the default with no flags, --apply
 * required to write. Idempotent — re-running after a successful apply
 * finds nothing left to change.
 *
 * Usage (run from apps/api/):
 *   ORG_ID=<organization-id> npx ts-node prisma/scripts/backfill-channel-visibility.ts --dry-run
 *   ... --apply
 */
import { MenuChannel, PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const STAGING_CATEGORY_NAME = 'Imported from IdealPOS (pending review)';
const TARGET_CHANNELS: MenuChannel[] = ['order_tablet', 'customer_website', 'window_display'];

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

  // Explicit target sets, never a blanket "every row" update — the
  // staging category/items are excluded by construction (name filter),
  // not by hoping a later step doesn't touch them.
  const targetCategories = await prisma.category.findMany({
    where: { organizationId, name: { not: STAGING_CATEGORY_NAME } },
  });
  const targetItems = await prisma.menuItem.findMany({
    where: {
      organizationId,
      deletedAt: null,
      category: { name: { not: STAGING_CATEGORY_NAME } },
    },
  });

  const categoriesNeedingUpdate = targetCategories.filter(
    (c) => c.visibleChannels.length !== TARGET_CHANNELS.length,
  );
  const itemsNeedingUpdate = targetItems.filter(
    (i) => i.visibleChannels.length !== TARGET_CHANNELS.length,
  );

  // Verification, not an assumption: prove the staging category/items are
  // excluded from both target sets before proposing/making any write.
  const stagingItems = await prisma.menuItem.findMany({
    where: { organizationId, deletedAt: null, category: { name: STAGING_CATEGORY_NAME } },
    select: { id: true },
  });
  const stagingItemIds = new Set(stagingItems.map((i) => i.id));
  const targetIncludesStagingCategory = targetCategories.some((c) => c.name === STAGING_CATEGORY_NAME);
  const targetIncludesStagingItem = targetItems.some((i) => stagingItemIds.has(i.id));
  if (targetIncludesStagingCategory || targetIncludesStagingItem) {
    throw new Error('SAFETY VIOLATION: staging category/item present in target set — refusing to run');
  }

  const prefix = APPLY ? '' : '[DRY RUN] ';
  console.log(
    `${prefix}Organization ${organizationId}: ${targetCategories.length} curated categories, ` +
      `${targetItems.length} curated items in scope. ` +
      `${categoriesNeedingUpdate.length} categories and ${itemsNeedingUpdate.length} items need updating.`,
  );
  console.log(
    `${prefix}Staging items in org: ${stagingItemIds.size} — confirmed excluded from target set.`,
  );

  if (!APPLY) {
    console.log(`${prefix}No write performed.`);
    return;
  }

  await prisma.$transaction(async (tx) => {
    for (const category of categoriesNeedingUpdate) {
      await tx.category.update({
        where: { id: category.id },
        data: { visibleChannels: TARGET_CHANNELS },
      });
    }
    for (const item of itemsNeedingUpdate) {
      await tx.menuItem.update({
        where: { id: item.id },
        data: { visibleChannels: TARGET_CHANNELS },
      });
    }
  });

  console.log(
    `Applied. Updated ${categoriesNeedingUpdate.length} categories and ${itemsNeedingUpdate.length} items.`,
  );
}

main()
  .catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
