/**
 * Seeds the canonical curated Verdura menu (shared/menu/menuData.mjs — "the
 * single canonical menu source (transcribed from VERDURA_Final_Menu.docx:
 * 10 categories, 70 items)", per prisma/seed.ts's own comment) into an
 * *existing* organization's Category/MenuItem tables.
 *
 * Why this exists: prisma/seed.ts already contains this exact logic, but
 * it's inseparable from creating a brand-new dev-fixture Organization/
 * Staff/Venue keyed to the hardcoded local-dev LOCAL_ORG_SLUG/LOCAL_VENUE_ID
 * (shared/local-dev.mjs — "production organizations/venues are always
 * created with random UUIDs; nothing in production ever reads these
 * constants"). Running seed.ts itself against a real production database
 * would create a phantom "Verdura Auckland" venue alongside the real one.
 * This script extracts only the Category/MenuItem half (verbatim from
 * seed.ts's own upsert-by-name / find-or-create-by-title logic) and runs it
 * against an org you already have, e.g. a real venue whose menu was
 * populated solely via prisma/scripts/import-idealpos-catalog.ts (which
 * creates a *separate*, differently-named, isAvailable:false staging
 * category — see that script's own doc comment) and therefore never
 * received the curated menu at all.
 *
 * Never touches:
 *   - Organization/Staff/Venue rows — the target org must already exist.
 *   - Any Category/MenuItem not matching a canonical name/title — in
 *     particular, an import-idealpos-catalog.ts staging category (e.g.
 *     "Imported from IdealPOS (pending review)") and its rows are untouched:
 *     no seed category/item shares a name/title with them, so the
 *     find-or-create matching below can't collide with them either way.
 *   - `isAvailable`/`priceCents` on any row this script didn't itself
 *     create/update.
 *
 * Idempotent: re-running is safe — categories match by
 * (organizationId, name), items match by (organizationId, categoryId,
 * title, subCategory), exactly as prisma/seed.ts does.
 *
 * Usage (run from apps/api/):
 *   ORG_ID=<organization-id> npx ts-node -r tsconfig-paths/register prisma/scripts/seed-canonical-menu-into-org.ts --dry-run
 *   ORG_ID=<organization-id> npx ts-node -r tsconfig-paths/register prisma/scripts/seed-canonical-menu-into-org.ts --apply
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

type SharedCategory = {
  id: string;
  name: string;
  description: string | null;
  sortOrder: number;
  isActive: boolean;
};
type SharedMenuItem = {
  categoryId: string;
  subCategory: string | null;
  title: string;
  description: string;
  imageUrl: string | null;
  price: string;
  nutritionalDetails: { tags: string[]; isFeatured: boolean };
  isSpicy: boolean;
  isAvailable: boolean;
  sortOrder: number;
};

const toCents = (p: string | number): number => {
  const n = parseFloat(String(p).replace(/[^0-9.]/g, ''));
  return Math.round((isNaN(n) ? 0 : n) * 100);
};

async function main() {
  const organizationId = process.env.ORG_ID;
  if (!organizationId) throw new Error('ORG_ID env var is required');

  const organization = await prisma.organization.findUnique({ where: { id: organizationId } });
  if (!organization) throw new Error(`Organization ${organizationId} not found`);

  const owner = await prisma.staff.findFirst({ where: { organizationId, deletedAt: null } });
  if (!owner)
    throw new Error(
      `No Staff row found for organization ${organizationId} to attribute createdById`,
    );

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const menuData = require('../../../../shared/menu/menuData.mjs') as {
    SEED_CATEGORIES: SharedCategory[];
    SEED_ITEMS: SharedMenuItem[];
    CANONICAL_MENU_ITEM_COUNT: number;
  };
  const { SEED_CATEGORIES, SEED_ITEMS, CANONICAL_MENU_ITEM_COUNT } = menuData;

  console.log(
    `${DRY_RUN ? '[DRY RUN] ' : ''}Seeding canonical menu (${SEED_CATEGORIES.length} categories, ` +
      `${SEED_ITEMS.length} items, canonical count ${CANONICAL_MENU_ITEM_COUNT}) into org ${organizationId} ` +
      `(${organization.name}), attributed to staff ${owner.id}.`,
  );

  const catMap: Record<string, string> = {};
  let categoriesCreated = 0;
  let categoriesUpdated = 0;

  for (const def of SEED_CATEGORIES) {
    const existing = await prisma.category.findFirst({
      where: { organizationId, name: def.name },
    });

    if (existing) {
      catMap[def.id] = existing.id;
      categoriesUpdated++;
      console.log(
        `  category "${def.name}": ${DRY_RUN ? 'would update' : 'updating'} existing ${existing.id}`,
      );
      if (APPLY) {
        await prisma.category.update({
          where: { id: existing.id },
          data: { description: def.description, sortOrder: def.sortOrder, isActive: def.isActive },
        });
      }
    } else {
      categoriesCreated++;
      console.log(`  category "${def.name}": ${DRY_RUN ? 'would create' : 'creating'}`);
      if (APPLY) {
        const cat = await prisma.category.create({
          data: {
            organizationId,
            name: def.name,
            description: def.description,
            sortOrder: def.sortOrder,
            isActive: def.isActive,
            createdById: owner.id,
          },
        });
        catMap[def.id] = cat.id;
      } else {
        // Dry-run has no real id yet — use the seed's own local id so the
        // item loop below can still resolve category references for
        // reporting purposes.
        catMap[def.id] = def.id;
      }
    }
  }

  let itemsCreated = 0;
  let itemsUpdated = 0;

  for (const item of SEED_ITEMS) {
    const categoryId = catMap[item.categoryId];
    if (!categoryId) {
      throw new Error(`Seed item "${item.title}" references unknown category "${item.categoryId}"`);
    }

    // Read-only lookup — safe to run in dry-run too, so the report reflects
    // real create-vs-update counts instead of assuming everything is new.
    const existing = await prisma.menuItem.findFirst({
      where: {
        organizationId,
        categoryId,
        title: item.title,
        subCategory: item.subCategory ?? null,
        deletedAt: null,
      },
    });

    const data = {
      organizationId,
      categoryId,
      subCategory: item.subCategory ?? undefined,
      title: item.title,
      description: item.description || item.title,
      imageUrl: item.imageUrl ?? undefined,
      priceCents: toCents(item.price),
      isAvailable: item.isAvailable,
      isSpicy: item.isSpicy,
      sortOrder: item.sortOrder,
      nutritionalDetails: {
        tags: item.nutritionalDetails.tags,
        isFeatured: item.nutritionalDetails.isFeatured,
        allergens: [] as string[],
        ingredients: [] as string[],
      },
    };

    if (existing) {
      itemsUpdated++;
      if (APPLY) await prisma.menuItem.update({ where: { id: existing.id }, data });
    } else {
      itemsCreated++;
      if (APPLY) await prisma.menuItem.create({ data: { ...data, createdById: owner.id } });
    }
  }

  console.log(
    `${DRY_RUN ? '[DRY RUN] would apply' : 'Applied'}: ${categoriesCreated} categories created, ` +
      `${categoriesUpdated} updated; ${itemsCreated} items created, ${itemsUpdated} updated.`,
  );

  if (APPLY) {
    const finalCount = await prisma.menuItem.count({
      where: { organizationId, title: { in: SEED_ITEMS.map((i) => i.title) }, deletedAt: null },
    });
    console.log(
      `Canonical menu items now present in DB for this org: ${finalCount} (expected ${CANONICAL_MENU_ITEM_COUNT}).`,
    );
    if (finalCount !== CANONICAL_MENU_ITEM_COUNT) {
      console.warn(
        `WARNING: canonical item count (${finalCount}) does not match the expected count ` +
          `(${CANONICAL_MENU_ITEM_COUNT}) — investigate with a Category/MenuItem query before assuming the menu is correct.`,
      );
    }
  }
}

if (require.main === module) {
  main()
    .catch((e) => {
      console.error(e);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
