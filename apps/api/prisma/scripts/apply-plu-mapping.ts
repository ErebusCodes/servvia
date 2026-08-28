/**
 * CLI wrapper for src/pos-sync/apply-plu-mapping.ts (see that module for
 * the actual logic and its tests). Fail-closed CLI: dry-run is the
 * default with NO flags at all (safe by default, not opt-out) — same
 * convention as set-menu-item-pos-product-code.ts.
 *
 * Usage (run from apps/api/):
 *   CURATED_MENU_ITEM_ID=<id> STAGING_MENU_ITEM_ID=<id> POS_PRODUCT_CODE=<code> \
 *     EXPECTED_STAGING_TITLE=<title> npx ts-node prisma/scripts/apply-plu-mapping.ts --dry-run
 *   ... --apply
 */
import { PrismaClient } from '@prisma/client';
import {
  planPluMapping,
  applyPluMapping,
  ApplyPluMappingInput,
} from '../../src/pos-sync/apply-plu-mapping';

const KNOWN_FLAGS = new Set(['--dry-run', '--apply']);
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

const input: ApplyPluMappingInput = {
  curatedMenuItemId: process.env.CURATED_MENU_ITEM_ID ?? '',
  stagingMenuItemId: process.env.STAGING_MENU_ITEM_ID ?? '',
  posProductCode: process.env.POS_PRODUCT_CODE ?? '',
  expectedStagingTitle: process.env.EXPECTED_STAGING_TITLE ?? '',
};
if (!input.curatedMenuItemId) throw new Error('CURATED_MENU_ITEM_ID env var is required');
if (!input.stagingMenuItemId) throw new Error('STAGING_MENU_ITEM_ID env var is required');
if (!input.posProductCode) throw new Error('POS_PRODUCT_CODE env var is required');
if (!input.expectedStagingTitle) throw new Error('EXPECTED_STAGING_TITLE env var is required');

const prisma = new PrismaClient();

planPluMapping(prisma, input)
  .then(async (plan) => {
    const prefix = APPLY ? '' : '[DRY RUN] ';
    console.log(
      `${prefix}Curated target: "${plan.curatedTitle}", category "${plan.curatedCategory}".`,
    );
    console.log(
      `${prefix}Staging owner: "${plan.stagingTitle}", category "${plan.stagingCategory}".`,
    );
    if (plan.failures.length > 0) {
      console.error('Preconditions failed -- refusing to write:');
      for (const f of plan.failures) console.error(`  - ${f}`);
      process.exitCode = 1;
      return;
    }
    console.log('All preconditions satisfied.');
    if (!APPLY) {
      console.log(
        `[DRY RUN] Would clear staging posProductCode "${input.posProductCode}" -> null.`,
      );
      console.log(`[DRY RUN] Would set curated posProductCode null -> "${input.posProductCode}".`);
      console.log('[DRY RUN] No write performed.');
      return;
    }
    await applyPluMapping(prisma, input);
    const afterCurated = await prisma.menuItem.findUnique({
      where: { id: input.curatedMenuItemId },
    });
    const afterStaging = await prisma.menuItem.findUnique({
      where: { id: input.stagingMenuItemId },
    });
    console.log(
      `Applied. Curated posProductCode is now ${JSON.stringify(afterCurated?.posProductCode)}.`,
    );
    console.log(
      `Applied. Staging posProductCode is now ${JSON.stringify(afterStaging?.posProductCode)}.`,
    );
  })
  .catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
