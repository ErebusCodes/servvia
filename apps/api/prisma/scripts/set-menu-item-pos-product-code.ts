/**
 * Sets exactly one existing MenuItem's posProductCode, mirroring
 * MenuItemsService#update's own logic verbatim (see menu-items.service.ts:
 * rejectIfPosProductCodeReused + the updateMany that only ever writes
 * posProductCode when this script is used, since only that field is
 * passed) — including its pre-check for the `@@unique([organizationId,
 * posProductCode])` constraint (schema.prisma), so a collision (e.g. with
 * one of the 825 import-idealpos-catalog.ts staging rows, which already
 * carry real posProductCode values in the same organization) is reported
 * clearly instead of a raw DB constraint error.
 *
 * Why this script exists instead of calling `PATCH /admin/menu/items/:id`
 * directly: that endpoint is the *intended* long-term maintenance path
 * (JwtAuthGuard + RolesGuard, admin/manager only) and should be preferred
 * whenever an authenticated staff session is available. This script exists
 * for exactly the situation where a verified single-item mapping needs to
 * be written from a host with production DB access but no interactive
 * staff login (e.g. this venue's deployment box over SSH) — it performs
 * the identical validation and the identical single-field write, not a
 * shortcut around it.
 *
 * Never touches: title, price, category, availability, modifierGroups, or
 * any other MenuItem field — only posProductCode on the one targeted row.
 *
 * Usage (run from apps/api/):
 *   MENU_ITEM_ID=<id> POS_PRODUCT_CODE=<code> npx ts-node -r tsconfig-paths/register prisma/scripts/set-menu-item-pos-product-code.ts --dry-run
 *   MENU_ITEM_ID=<id> POS_PRODUCT_CODE=<code> npx ts-node -r tsconfig-paths/register prisma/scripts/set-menu-item-pos-product-code.ts --apply
 *
 * Fail-closed CLI: dry-run is the default with NO flags at all (safe by
 * default, not opt-out) — real writes require the explicit --apply flag.
 * Any argument that isn't exactly --dry-run or --apply is treated as a
 * misspelled/unknown mode and aborts immediately with a nonzero exit,
 * rather than silently falling through to either mode.
 */
import { PrismaClient } from '@prisma/client';

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
if (cliArgs.includes('--dry-run') && cliArgs.includes('--apply')) {
  console.error('Both --dry-run and --apply were passed — refusing to run on an ambiguous mode.');
  process.exit(1);
}
const APPLY = cliArgs.includes('--apply');
const DRY_RUN = !APPLY;

const prisma = new PrismaClient();

async function main() {
  const menuItemId = process.env.MENU_ITEM_ID;
  const posProductCode = process.env.POS_PRODUCT_CODE;
  if (!menuItemId) throw new Error('MENU_ITEM_ID env var is required');
  if (!posProductCode) throw new Error('POS_PRODUCT_CODE env var is required');
  if (posProductCode.length > 200) {
    throw new Error(
      'POS_PRODUCT_CODE exceeds 200 characters (matches UpdateMenuItemDto.posProductCode @MaxLength(200))',
    );
  }

  const item = await prisma.menuItem.findFirst({ where: { id: menuItemId, deletedAt: null } });
  if (!item) throw new Error(`MenuItem ${menuItemId} not found`);

  console.log(
    `${DRY_RUN ? '[DRY RUN] ' : ''}Target: "${item.title}" (${item.id}), org ${item.organizationId}, ` +
      `category ${item.categoryId}, current posProductCode=${JSON.stringify(item.posProductCode)}, ` +
      `isAvailable=${item.isAvailable}, priceCents=${item.priceCents}.`,
  );

  // Verbatim mirror of MenuItemsService#rejectIfPosProductCodeReused.
  const conflicting = await prisma.menuItem.findFirst({
    where: {
      organizationId: item.organizationId,
      posProductCode,
      deletedAt: null,
      id: { not: item.id },
    },
  });
  if (conflicting) {
    throw new Error(
      `POS product code "${posProductCode}" is already assigned to another menu item ` +
        `("${conflicting.title}", id ${conflicting.id}, isAvailable=${conflicting.isAvailable}) — refusing to write a duplicate.`,
    );
  }
  console.log(
    `No conflicting MenuItem holds posProductCode "${posProductCode}" in this org — safe to assign.`,
  );

  if (APPLY) {
    const { count } = await prisma.menuItem.updateMany({
      where: { id: item.id, organizationId: item.organizationId, deletedAt: null },
      data: { posProductCode },
    });
    if (count !== 1) throw new Error(`Expected to update exactly 1 row, updated ${count}`);
    const after = await prisma.menuItem.findFirst({ where: { id: item.id } });
    console.log(`Applied. posProductCode is now ${JSON.stringify(after?.posProductCode)}.`);
  } else {
    console.log(`[DRY RUN] Would set posProductCode to "${posProductCode}". No write performed.`);
  }
}

main()
  .catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
