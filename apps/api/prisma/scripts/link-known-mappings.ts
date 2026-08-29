/**
 * Phase E2 migration script — links exactly the 9 already-verified,
 * production-trusted PLU mappings into the new `PosProductIdentity`
 * model. This does NOT run a full IdealPOS catalog sync (that is
 * `sync-pos-catalog.ts`, a separate, later step) — it deliberately
 * creates only these 9 candidate rows (if `sync-pos-catalog.ts` hasn't
 * run yet) and immediately links each to its known-correct curated
 * MenuItem, using the exact evidence already established and re-verified
 * in this session (DL-107 §1e/§1j/§1l, Phase E1 preflight).
 *
 * Never auto-links anything beyond this fixed, hand-verified list. The
 * remaining 61 curated items stay unmapped/review-required through the
 * normal POS Catalog Review workflow.
 *
 * Fail-closed CLI, dry-run default, --apply required. Idempotent: running
 * twice after a successful apply finds nothing left to link.
 *
 * Usage (run from apps/api/):
 *   ORG_ID=<organization-id> npx ts-node prisma/scripts/link-known-mappings.ts --dry-run
 *   ... --apply
 */
import { PrismaClient } from '@prisma/client';
import { linkPosCandidate } from '../../src/pos-sync/sync-pos-catalog';
import { classifyPosCandidate } from '../../src/pos-sync/classify-pos-candidate';

const prisma = new PrismaClient();
const KNOWN_FLAGS = new Set(['--dry-run', '--apply']);

// Exact evidence re-verified live this session (Phase E1 preflight) and
// previously in DL-107 §1e/§1j/§1l/§1k — nativeDescription is the live
// IdealPOS StockItems.Description at the time each was last confirmed.
const KNOWN_MAPPINGS: {
  curatedTitle: string;
  nativeCode: string;
  nativeDescription: string;
}[] = [
  { curatedTitle: 'Chicken Ballista Pizza', nativeCode: '708', nativeDescription: 'CHICKEN BALLISTA PIZZA' },
  { curatedTitle: 'Tiramisu', nativeCode: '578', nativeDescription: 'TIRAMISU' },
  { curatedTitle: 'Iskender Grill Chicken', nativeCode: '20', nativeDescription: 'Iskender - Grill Chicken' },
  { curatedTitle: 'Dolma', nativeCode: '165', nativeDescription: 'Dolma' },
  { curatedTitle: 'Pesto Chicken Pizza', nativeCode: '710', nativeDescription: 'PESTO CHICKEN PIZZA' },
  { curatedTitle: "Za'atar Loaf", nativeCode: '704', nativeDescription: 'ZAATAR LOAF' },
  { curatedTitle: 'Chicken Avocado Salad', nativeCode: '663', nativeDescription: 'CHICKEN AVOCADO SALAD' },
  { curatedTitle: 'Spicy Mediterranean Pizza', nativeCode: '712', nativeDescription: 'SPICY MEDITERRANEAN PIZZA' },
  { curatedTitle: 'Garlic & Cheese Pide', nativeCode: '701', nativeDescription: 'GARLIC CHEESE PIDE' },
];

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
  const prefix = APPLY ? '' : '[DRY RUN] ';

  const organizationId = process.env.ORG_ID;
  if (!organizationId) throw new Error('ORG_ID env var is required');

  const organization = await prisma.organization.findUnique({ where: { id: organizationId } });
  if (!organization) throw new Error(`Organization ${organizationId} not found`);

  for (const mapping of KNOWN_MAPPINGS) {
    // Exact-match precondition: the curated item must exist, be unlinked
    // (no PosProductIdentity yet), and — if the legacy column is still
    // set — its legacy posProductCode must match exactly. Never guesses
    // from title alone.
    const curated = await prisma.menuItem.findFirst({
      where: { organizationId, title: mapping.curatedTitle, deletedAt: null },
      include: { posIdentity: true },
    });
    if (!curated) {
      console.log(`${prefix}SKIP ${mapping.curatedTitle}: curated MenuItem not found by exact title`);
      continue;
    }
    if (curated.posIdentity) {
      console.log(
        `${prefix}SKIP ${mapping.curatedTitle}: already linked to PosProductIdentity ${curated.posIdentity.id} (${curated.posIdentity.nativeCode}) — idempotent no-op`,
      );
      continue;
    }
    if (curated.posProductCode !== null && curated.posProductCode !== mapping.nativeCode) {
      throw new Error(
        `SAFETY VIOLATION: "${mapping.curatedTitle}" legacy posProductCode is "${curated.posProductCode}", expected "${mapping.nativeCode}" — refusing to link, reconcile manually`,
      );
    }

    let candidate = await prisma.posProductIdentity.findUnique({
      where: {
        organizationId_sourceSystem_nativeCode: {
          organizationId,
          sourceSystem: 'idealpos',
          nativeCode: mapping.nativeCode,
        },
      },
    });

    if (!candidate) {
      const classification = classifyPosCandidate({
        hasAnyGridPlacement: true,
        hasVisibleGridPlacement: true,
        isDepartment41: false,
        hasDepartment41TwinSameDescription: false,
      });
      console.log(
        `${prefix}Would create PosProductIdentity candidate for ${mapping.nativeCode} (${mapping.nativeDescription}), tier=${classification.tier}`,
      );
      if (APPLY) {
        candidate = await prisma.posProductIdentity.create({
          data: {
            organizationId,
            sourceSystem: 'idealpos',
            nativeCode: mapping.nativeCode,
            nativeDescription: mapping.nativeDescription,
            lifecycleStatus: 'pending_review',
            confidenceTier: classification.tier,
            evidence: {
              hasAnyGridPlacement: true,
              hasVisibleGridPlacement: true,
              isDepartment41: false,
              hasDepartment41TwinSameDescription: false,
            },
            lastSyncedAt: new Date(),
          },
        });
      }
    } else if (candidate.menuItemId !== null) {
      console.log(
        `${prefix}SKIP ${mapping.curatedTitle}: candidate ${candidate.id} already linked to a different MenuItem (${candidate.menuItemId})`,
      );
      continue;
    }

    console.log(`${prefix}Would link "${mapping.curatedTitle}" (${curated.id}) -> PosProductIdentity ${mapping.nativeCode}`);
    if (APPLY && candidate) {
      const linked = await linkPosCandidate(prisma, {
        posProductIdentityId: candidate.id,
        menuItemId: curated.id,
      });
      console.log(
        `Applied. "${mapping.curatedTitle}" linked to ${linked.nativeCode}, lifecycleStatus=${linked.lifecycleStatus}.`,
      );
    }
  }

  if (!APPLY) console.log(`${prefix}No write performed.`);
}

main()
  .catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
