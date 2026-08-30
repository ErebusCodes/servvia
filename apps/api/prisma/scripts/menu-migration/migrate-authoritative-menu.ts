/**
 * Authoritative IdealPOS-confirmed menu migration.
 *
 * Promotes the 228 screenshot-confirmed, human-reviewed entries in
 * `manifest.json` into the active menu, reusing the exact existing
 * MenuItem row for each (matched ONLY by an exact `posProductCode ==
 * nativeCode` lookup — never by title/name). Every one of the 228 already
 * exists as a real MenuItem row today (219 sit inert in the staging
 * category, 9 are already-live curated items) — this migration creates
 * ZERO new MenuItems. It also links exactly one active PosProductIdentity
 * per promoted item, reassigns categories per CATEGORY_PLAN below, and
 * neutralizes (never deletes) the 61 old curated-70 rows this menu leaves
 * behind. The 10 REVIEW_REQUIRED manifest entries (ambiguous/no-match/
 * open-price/structural questions — see manifest.json's own reviewRequired
 * array) are excluded by construction: they are simply never read from
 * `items[]`, so nothing in this file can accidentally promote one.
 *
 * Fail-closed CLI, same convention as the other prisma/scripts/*.ts
 * migrations (dry-run default, --apply required). Transactional,
 * idempotent — re-running --apply after a successful apply reports zero
 * further changes.
 *
 * `runMigration()` is exported separately from the CLI entrypoint so
 * integration tests can call it directly and assert on the returned report
 * rather than scraping stdout.
 *
 * Usage (run from apps/api/):
 *   ORG_ID=<organization-id> npx ts-node -r dotenv/config -r tsconfig-paths/register \
 *     prisma/scripts/menu-migration/migrate-authoritative-menu.ts --dry-run
 *   ... --apply
 */
import { MenuChannel, PosCandidateConfidenceTier, PrismaClient } from '@prisma/client';
import manifestJson from './manifest.json';

interface ManifestItem {
  category: string;
  categorySortOrder: number;
  itemSortOrder: number;
  requestedName: string;
  nativeCode: string;
  nativeDescription: string;
  department: string;
  priceDollars: number;
  visibleChannels: string[];
  isAvailable: boolean;
  matchConfidence: 'HIGH' | 'NOTE';
  notes: string;
}

const manifest = manifestJson as {
  items: ManifestItem[];
  reviewRequired: { requestedName: string; category: string }[];
};

export const prisma = new PrismaClient();

export const STAGING_CATEGORY_NAME = 'Imported from IdealPOS (pending review)';

// Categories this migration deliberately leaves untouched — obsolete-by-
// migration but retirement (hide/archive the category row itself) is a
// separately-gated future step, not this phase. Informational only;
// nothing in the plan logic below reads this array.
export const CATEGORIES_LEFT_ALONE = [
  'To Share',
  'Small Plates',
  'Salads',
  'Traditional Mediterranean Kebabs',
  'Verdura Sharing Feasts',
  'Burgers & Pasta',
];

// The 6 nativeCodes among the 10 REVIEW_REQUIRED manifest entries that
// actually have a candidate code at all (Marag Potato's two candidates,
// Falafel Salad/Plate, Hamsa Kuwaiti, Go Fajita Wrap, On The Plate - No
// Bread, Egg Any Styel, Trio of Icecream). Tradional Kebabs / Sila Pita -
// Falafel / Sila Pita – Mix have no code at all so can't leak by
// construction. Used only by the postcheck leak-detector below.
export const REVIEW_REQUIRED_CODES_TO_CHECK = [
  '572',
  '585',
  '761',
  '677',
  '718',
  '635',
  '396',
  '740',
];

type CategoryAction = 'REUSE' | 'RENAME' | 'CREATE';
interface CategoryPlanEntry {
  target: string;
  sortOrder: number;
  action: CategoryAction;
  sourceName?: string; // only for REUSE/RENAME
}

// The 17 authoritative target categories, in the exact order given in the
// reviewed migration spec. REUSE keeps the existing row's id/name, only
// updating sortOrder/visibleChannels. RENAME keeps the existing row's id,
// updates name too. CREATE makes a brand-new Category row. This table is
// the single source of truth for category resolution — never inferred
// from string similarity at runtime.
export const CATEGORY_PLAN: CategoryPlanEntry[] = [
  { target: 'COLD APPETITE', sortOrder: 1, action: 'CREATE' },
  { target: 'HOT APPETITE', sortOrder: 2, action: 'CREATE' },
  { target: 'SALAD', sortOrder: 3, action: 'CREATE' },
  { target: 'KITCHEN', sortOrder: 4, action: 'CREATE' },
  { target: 'BURGERS & SANDWICHES', sortOrder: 5, action: 'CREATE' },
  { target: 'CHAR GRILL', sortOrder: 6, action: 'CREATE' },
  { target: 'FRESH FROM OVEN', sortOrder: 7, action: 'RENAME', sourceName: 'Fresh From The Oven' },
  { target: 'FUSION WRAP', sortOrder: 8, action: 'CREATE' },
  { target: 'PLATTER', sortOrder: 9, action: 'CREATE' },
  { target: 'MAINS', sortOrder: 10, action: 'REUSE', sourceName: 'Mains' },
  { target: 'SILA', sortOrder: 11, action: 'CREATE' },
  { target: 'SPECIAL MENU', sortOrder: 12, action: 'CREATE' },
  { target: 'SPECIAL ORDER', sortOrder: 13, action: 'CREATE' },
  { target: 'DESSERT', sortOrder: 14, action: 'RENAME', sourceName: 'Desserts' },
  { target: 'KIDS MENU', sortOrder: 15, action: 'CREATE' },
  { target: 'SIDES', sortOrder: 16, action: 'REUSE', sourceName: 'Sides' },
  { target: 'ADD ON / SIDE', sortOrder: 17, action: 'CREATE' },
];

const ALL_CHANNELS: MenuChannel[] = ['order_tablet', 'customer_website', 'window_display'];

const CONFIDENCE_MAP: Record<string, PosCandidateConfidenceTier> = {
  HIGH: 'high_confidence_active',
  NOTE: 'likely_active',
};

interface CategoryResolution {
  target: string;
  sortOrder: number;
  action: CategoryAction | 'REUSE_IDEMPOTENT';
  existingId?: string;
  currentName?: string;
}

interface MenuItemResolution {
  manifestItem: ManifestItem;
  matches: {
    id: string;
    title: string;
    priceCents: number;
    categoryId: string;
    isAvailable: boolean;
  }[];
}

export interface MigrationReport {
  organizationId: string;
  categoriesCreate: string[];
  categoriesReuse: string[];
  categoriesRename: string[];
  menuItemReuseUpdate: number;
  menuItemPromoteFromStaging: number;
  menuItemCreate: 0;
  priceChanges: { title: string; nativeCode: string; currentCents: number; targetCents: number }[];
  posIdentityCreate: number;
  posIdentityLink: number;
  menuItemHide: number;
  menuItemHideAlreadyInert: number;
  stagingRemaining: number;
  reviewRequiredExcluded: number;
  errors: string[];
  applied: boolean;
  postcheck?: {
    activeIdentitiesForManifestCodes: number;
    orderTabletVisibleCount: number;
    orderTabletViolations: number;
    reviewRequiredLeaked: number;
  };
}

async function resolveCategoryPlan(organizationId: string): Promise<CategoryResolution[]> {
  const existing = await prisma.category.findMany({ where: { organizationId } });
  const byName = new Map(existing.map((c) => [c.name, c]));
  const resolutions: CategoryResolution[] = [];

  for (const plan of CATEGORY_PLAN) {
    if (plan.action === 'CREATE') {
      const already = byName.get(plan.target);
      resolutions.push(
        already
          ? {
              target: plan.target,
              sortOrder: plan.sortOrder,
              action: 'REUSE_IDEMPOTENT',
              existingId: already.id,
              currentName: already.name,
            }
          : { target: plan.target, sortOrder: plan.sortOrder, action: 'CREATE' },
      );
      continue;
    }
    const source = byName.get(plan.sourceName as string);
    if (source) {
      resolutions.push({
        target: plan.target,
        sortOrder: plan.sortOrder,
        action: plan.action,
        existingId: source.id,
        currentName: source.name,
      });
      continue;
    }
    const already = byName.get(plan.target);
    if (already) {
      resolutions.push({
        target: plan.target,
        sortOrder: plan.sortOrder,
        action: 'REUSE_IDEMPOTENT',
        existingId: already.id,
        currentName: already.name,
      });
      continue;
    }
    throw new Error(
      `CATEGORY_PLAN: expected existing category "${plan.sourceName}" not found, and target "${plan.target}" doesn't exist either — cannot resolve "${plan.action}" for "${plan.target}"`,
    );
  }
  return resolutions;
}

async function resolveMenuItemPlan(organizationId: string): Promise<MenuItemResolution[]> {
  const resolutions: MenuItemResolution[] = [];
  for (const item of manifest.items) {
    const matches = await prisma.menuItem.findMany({
      where: { organizationId, posProductCode: item.nativeCode, deletedAt: null },
      select: { id: true, title: true, priceCents: true, categoryId: true, isAvailable: true },
    });
    resolutions.push({ manifestItem: item, matches });
  }
  return resolutions;
}

/**
 * Runs the full PRECHECK -> CATEGORY_PLAN -> MENUITEM_PLAN -> PRICE_PLAN ->
 * POSIDENTITY_PLAN -> OBSOLETE_MENU_PLAN -> VALIDATION -> [APPLY ->
 * POSTCHECK] pipeline for one organization and returns a structured report.
 * Never reads process.argv/process.env/console — safe to call from a test.
 * If `apply` is false, this is a pure read-only dry-run: no writes occur.
 * If `report.errors.length > 0`, no writes occur regardless of `apply`.
 */
export async function runMigration(
  organizationId: string,
  apply: boolean,
): Promise<MigrationReport> {
  const organization = await prisma.organization.findUnique({ where: { id: organizationId } });
  if (!organization) throw new Error(`Organization ${organizationId} not found`);

  const manifestCodes = manifest.items.map((i) => i.nativeCode);
  const dupManifestCodes = manifestCodes.filter((c, i) => manifestCodes.indexOf(c) !== i);
  if (dupManifestCodes.length > 0) {
    throw new Error(
      `Manifest contains duplicate nativeCode(s): ${dupManifestCodes.join(', ')} — refusing to run`,
    );
  }

  const categoryPlan = await resolveCategoryPlan(organizationId);
  const catCreate = categoryPlan.filter((c) => c.action === 'CREATE');
  const catReuse = categoryPlan.filter(
    (c) => c.action === 'REUSE' || c.action === 'REUSE_IDEMPOTENT',
  );
  const catRename = categoryPlan.filter((c) => c.action === 'RENAME');

  const stagingCategory = await prisma.category.findFirst({
    where: { organizationId, name: STAGING_CATEGORY_NAME },
  });
  if (!stagingCategory)
    throw new Error(`Staging category "${STAGING_CATEGORY_NAME}" not found — refusing to run`);

  const menuItemResolutions = await resolveMenuItemPlan(organizationId);
  const zeroMatch = menuItemResolutions.filter((r) => r.matches.length === 0);
  const multiMatch = menuItemResolutions.filter((r) => r.matches.length > 1);
  const okMatch = menuItemResolutions.filter((r) => r.matches.length === 1);
  const promotedFromStaging = okMatch.filter((r) => r.matches[0].categoryId === stagingCategory.id);

  const priceChanges = okMatch
    .map((r) => ({
      title: r.manifestItem.requestedName,
      nativeCode: r.manifestItem.nativeCode,
      currentCents: r.matches[0].priceCents,
      targetCents: Math.round(r.manifestItem.priceDollars * 100),
    }))
    .filter((p) => p.currentCents !== p.targetCents);

  const existingIdentities = await prisma.posProductIdentity.findMany({
    where: { organizationId, sourceSystem: 'idealpos', nativeCode: { in: manifestCodes } },
  });
  const identityByCode = new Map(existingIdentities.map((i) => [i.nativeCode, i]));
  const posIdentityCreate = manifest.items.filter((i) => !identityByCode.has(i.nativeCode)).length;
  const posIdentityLink = manifest.items.length - posIdentityCreate;

  const approvedMenuItemIds = new Set(okMatch.map((r) => r.matches[0].id));
  const allCuratedNonStaging = await prisma.menuItem.findMany({
    where: { organizationId, deletedAt: null, categoryId: { not: stagingCategory.id } },
    select: { id: true, title: true, isAvailable: true, visibleChannels: true },
  });
  const toHide = allCuratedNonStaging.filter((m) => !approvedMenuItemIds.has(m.id));
  const alreadyHidden = toHide.filter((m) => !m.isAvailable && m.visibleChannels.length === 0);

  const stagingResidual = await prisma.menuItem.findMany({
    where: {
      organizationId,
      deletedAt: null,
      categoryId: stagingCategory.id,
      id: { notIn: Array.from(approvedMenuItemIds) },
    },
    select: { id: true },
  });

  const errors: string[] = [];
  for (const r of zeroMatch) {
    errors.push(
      `CONFLICT: 0 MenuItem rows found for nativeCode ${r.manifestItem.nativeCode} ("${r.manifestItem.requestedName}") — expected exactly 1`,
    );
  }
  for (const r of multiMatch) {
    errors.push(
      `CONFLICT: ${r.matches.length} MenuItem rows found for nativeCode ${r.manifestItem.nativeCode} ("${r.manifestItem.requestedName}") — expected exactly 1 (ids: ${r.matches.map((m) => m.id).join(', ')})`,
    );
  }
  const approvedNames = new Set(manifest.items.map((i) => i.requestedName));
  for (const r of manifest.reviewRequired) {
    if (approvedNames.has(r.requestedName)) {
      errors.push(
        `CONFLICT: REVIEW_REQUIRED entry "${r.requestedName}" also appears in approved items[] — refusing to run`,
      );
    }
  }

  const report: MigrationReport = {
    organizationId,
    categoriesCreate: catCreate.map((c) => c.target),
    categoriesReuse: catReuse.map((c) => `${c.currentName ?? c.target}->${c.target}`),
    categoriesRename: catRename.map((c) => `${c.currentName}->${c.target}`),
    menuItemReuseUpdate: okMatch.length,
    menuItemPromoteFromStaging: promotedFromStaging.length,
    menuItemCreate: 0,
    priceChanges,
    posIdentityCreate,
    posIdentityLink,
    menuItemHide: toHide.length,
    menuItemHideAlreadyInert: alreadyHidden.length,
    stagingRemaining: stagingResidual.length,
    reviewRequiredExcluded: manifest.reviewRequired.length,
    errors,
    applied: false,
  };

  if (errors.length > 0 || !apply) {
    return report;
  }

  await prisma.$transaction(async (tx) => {
    const categoryIdByTarget = new Map<string, string>();

    for (const plan of categoryPlan) {
      if (plan.action === 'CREATE') {
        const staff = await tx.staff.findFirstOrThrow({ where: { organizationId } });
        const created = await tx.category.create({
          data: {
            organizationId,
            name: plan.target,
            sortOrder: plan.sortOrder,
            visibleChannels: ALL_CHANNELS,
            createdById: staff.id,
          },
        });
        categoryIdByTarget.set(plan.target, created.id);
      } else if (plan.action === 'RENAME') {
        await tx.category.update({
          where: { id: plan.existingId },
          data: { name: plan.target, sortOrder: plan.sortOrder, visibleChannels: ALL_CHANNELS },
        });
        categoryIdByTarget.set(plan.target, plan.existingId as string);
      } else {
        await tx.category.update({
          where: { id: plan.existingId },
          data: { sortOrder: plan.sortOrder, visibleChannels: ALL_CHANNELS },
        });
        categoryIdByTarget.set(plan.target, plan.existingId as string);
      }
    }

    for (const r of okMatch) {
      const item = r.manifestItem;
      const targetCategoryId = categoryIdByTarget.get(item.category);
      if (!targetCategoryId)
        throw new Error(`No resolved category id for target "${item.category}"`);
      const priceCents = Math.round(item.priceDollars * 100);
      const menuItem = await tx.menuItem.update({
        where: { id: r.matches[0].id },
        data: {
          categoryId: targetCategoryId,
          title: item.requestedName,
          priceCents,
          isAvailable: item.isAvailable,
          visibleChannels: item.visibleChannels as MenuChannel[],
          sortOrder: item.itemSortOrder,
        },
      });

      await tx.posProductIdentity.upsert({
        where: {
          organizationId_sourceSystem_nativeCode: {
            organizationId,
            sourceSystem: 'idealpos',
            nativeCode: item.nativeCode,
          },
        },
        create: {
          organizationId,
          sourceSystem: 'idealpos',
          nativeCode: item.nativeCode,
          nativeDescription: item.nativeDescription,
          priceCentsFromPos: priceCents,
          priceLastSyncedAt: new Date(),
          evidence: {
            matchConfidence: item.matchConfidence,
            notes: item.notes,
            department: item.department,
          },
          confidenceTier: CONFIDENCE_MAP[item.matchConfidence],
          lifecycleStatus: 'active',
          lastSyncedAt: new Date(),
          menuItemId: menuItem.id,
        },
        update: {
          nativeDescription: item.nativeDescription,
          priceCentsFromPos: priceCents,
          priceLastSyncedAt: new Date(),
          evidence: {
            matchConfidence: item.matchConfidence,
            notes: item.notes,
            department: item.department,
          },
          confidenceTier: CONFIDENCE_MAP[item.matchConfidence],
          lifecycleStatus: 'active',
          lastSyncedAt: new Date(),
          menuItemId: menuItem.id,
        },
      });
    }

    for (const m of toHide) {
      if (!m.isAvailable && m.visibleChannels.length === 0) continue;
      await tx.menuItem.update({
        where: { id: m.id },
        data: { isAvailable: false, visibleChannels: [] },
      });
    }
  });

  report.applied = true;

  const activeIdentitiesForManifestCodes = await prisma.posProductIdentity.count({
    where: {
      organizationId,
      sourceSystem: 'idealpos',
      nativeCode: { in: manifestCodes },
      lifecycleStatus: 'active',
    },
  });

  const tabletVisible = await prisma.menuItem.findMany({
    where: {
      organizationId,
      deletedAt: null,
      isAvailable: true,
      visibleChannels: { has: 'order_tablet' },
    },
    include: { posIdentity: true },
  });
  const orderTabletViolations = tabletVisible.filter(
    (m) =>
      !m.posIdentity || m.posIdentity.lifecycleStatus !== 'active' || !m.posIdentity.nativeCode,
  ).length;

  const leaked = await prisma.posProductIdentity.count({
    where: {
      organizationId,
      nativeCode: { in: REVIEW_REQUIRED_CODES_TO_CHECK },
      lifecycleStatus: 'active',
    },
  });

  report.postcheck = {
    activeIdentitiesForManifestCodes,
    orderTabletVisibleCount: tabletVisible.length,
    orderTabletViolations,
    reviewRequiredLeaked: leaked,
  };

  return report;
}

function printReport(report: MigrationReport, apply: boolean) {
  const prefix = apply ? '' : '[DRY RUN] ';
  console.log('=== PRECHECK ===');
  console.log(
    `Organization ${report.organizationId}. REVIEW_REQUIRED_EXCLUDED: ${report.reviewRequiredExcluded} (never read from items[]).`,
  );

  console.log('\n=== CATEGORY_PLAN ===');
  console.log(
    `CATEGORIES_CREATE: ${report.categoriesCreate.length} (${report.categoriesCreate.join(', ') || 'none'})`,
  );
  console.log(
    `CATEGORIES_REUSE: ${report.categoriesReuse.length} (${report.categoriesReuse.join(', ') || 'none'})`,
  );
  console.log(
    `CATEGORIES_RENAME: ${report.categoriesRename.length} (${report.categoriesRename.join(', ') || 'none'})`,
  );

  console.log('\n=== MENUITEM_PLAN ===');
  console.log(`MENUITEM_REUSE_UPDATE: ${report.menuItemReuseUpdate}`);
  console.log(`MENUITEM_PROMOTE_FROM_STAGING: ${report.menuItemPromoteFromStaging}`);
  console.log('MENUITEM_CREATE: 0 (by design)');

  console.log('\n=== PRICE_PLAN ===');
  console.log(`PRICE_CHANGE: ${report.priceChanges.length}`);
  for (const p of report.priceChanges.slice(0, 20)) {
    console.log(`  ${p.title} (${p.nativeCode}): ${p.currentCents}c -> ${p.targetCents}c`);
  }
  if (report.priceChanges.length > 20)
    console.log(`  ... and ${report.priceChanges.length - 20} more`);

  console.log('\n=== POSIDENTITY_PLAN ===');
  console.log(`POSIDENTITY_CREATE: ${report.posIdentityCreate}`);
  console.log(`POSIDENTITY_LINK: ${report.posIdentityLink}`);

  console.log('\n=== OBSOLETE_MENU_PLAN ===');
  console.log(
    `MENUITEM_HIDE: ${report.menuItemHide} (${report.menuItemHideAlreadyInert} already inert)`,
  );
  console.log(`STAGING_REMAINING (untouched): ${report.stagingRemaining}`);

  console.log('\n=== VALIDATION ===');
  if (report.errors.length > 0) {
    console.error(`ERROR: ${report.errors.length} validation failure(s):`);
    for (const e of report.errors) console.error(`  - ${e}`);
    console.error('\nAborting. No changes made.');
    return;
  }
  console.log('No conflicts.');

  if (!report.applied) {
    console.log(`\n${prefix}No write performed.`);
    return;
  }

  console.log('\n=== APPLY ===');
  console.log('Applied successfully.');

  console.log('\n=== POSTCHECK ===');
  if (report.postcheck) {
    console.log(
      `Active PosProductIdentity rows for manifest codes: ${report.postcheck.activeIdentitiesForManifestCodes}`,
    );
    console.log(
      `Order Tablet-visible MenuItems: ${report.postcheck.orderTabletVisibleCount}. Without active identity: ${report.postcheck.orderTabletViolations}.`,
    );
    console.log(
      `REVIEW_REQUIRED codes with an active PosProductIdentity (expected 0): ${report.postcheck.reviewRequiredLeaked}`,
    );
  }
}

const KNOWN_FLAGS = new Set(['--dry-run', '--apply']);

async function cli() {
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

  const report = await runMigration(organizationId, APPLY);
  printReport(report, APPLY);
  if (report.errors.length > 0) process.exitCode = 1;
}

if (require.main === module) {
  cli()
    .catch((e: unknown) => {
      console.error(e instanceof Error ? e.message : e);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
