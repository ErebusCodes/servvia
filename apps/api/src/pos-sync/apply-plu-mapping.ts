import { PrismaClient } from '@prisma/client';

const STAGING_CATEGORY_NAME = 'Imported from IdealPOS (pending review)';

/**
 * Applies exactly one PLU mapping: clears a staging (`import-idealpos-
 * catalog.ts`) `MenuItem` row's `posProductCode` and assigns that same
 * code to one curated `MenuItem` row, in a single DB transaction. Mirrors
 * `set-menu-item-pos-product-code.ts`'s safety pattern (fail-closed
 * pre-checks; the CLI wrapper in `prisma/scripts/apply-plu-mapping.ts` is
 * dry-run by default) and adds the missing "clear the staging owner
 * first" half needed to resolve the `@@unique([organizationId,
 * posProductCode])` collision documented in DL-107 §1e/§1i — every real
 * dish a curated item maps to is very likely already held by an imported
 * staging duplicate.
 *
 * Never touches: title, price, category, availability, modifierGroups on
 * either row. Only `posProductCode` on the two named rows, and only if
 * every precondition below matches exactly. Single mapping per call by
 * design — not a bulk tool.
 */
export interface ApplyPluMappingInput {
  curatedMenuItemId: string;
  stagingMenuItemId: string;
  posProductCode: string;
  expectedStagingTitle: string;
}

export interface ApplyPluMappingPlan {
  curatedTitle: string;
  curatedCategory: string | null;
  stagingTitle: string;
  stagingCategory: string | null;
  failures: string[];
}

/**
 * Read-only: loads both rows and evaluates every precondition, but never
 * writes. Used by both the dry-run and apply paths so the two modes can
 * never silently diverge on what counts as "safe".
 */
export async function planPluMapping(
  prisma: PrismaClient,
  input: ApplyPluMappingInput,
): Promise<ApplyPluMappingPlan> {
  const { curatedMenuItemId, stagingMenuItemId, posProductCode, expectedStagingTitle } = input;

  const curated = await prisma.menuItem.findFirst({
    where: { id: curatedMenuItemId, deletedAt: null },
    include: { category: true },
  });
  if (!curated) throw new Error(`Curated MenuItem ${curatedMenuItemId} not found`);

  const staging = await prisma.menuItem.findFirst({
    where: { id: stagingMenuItemId, deletedAt: null },
    include: { category: true },
  });
  if (!staging) throw new Error(`Staging MenuItem ${stagingMenuItemId} not found`);

  const failures: string[] = [];
  if (curated.organizationId !== staging.organizationId) {
    failures.push('curated and staging rows are in different organizations');
  }
  if (curated.posProductCode !== null) {
    failures.push(
      `curated row already has posProductCode=${JSON.stringify(curated.posProductCode)} (expected null)`,
    );
  }
  if (staging.posProductCode !== posProductCode) {
    failures.push(
      `staging row posProductCode=${JSON.stringify(staging.posProductCode)}, expected "${posProductCode}"`,
    );
  }
  if (staging.category?.name !== STAGING_CATEGORY_NAME) {
    failures.push(
      `staging row category is "${staging.category?.name}", expected "${STAGING_CATEGORY_NAME}"`,
    );
  }
  if (staging.isAvailable !== false) {
    failures.push(`staging row isAvailable=${staging.isAvailable}, expected false`);
  }
  if (staging.title !== expectedStagingTitle) {
    failures.push(`staging row title="${staging.title}", expected "${expectedStagingTitle}"`);
  }

  const thirdOwner = await prisma.menuItem.findFirst({
    where: {
      organizationId: curated.organizationId,
      posProductCode,
      deletedAt: null,
      id: { notIn: [curatedMenuItemId, stagingMenuItemId] },
    },
  });
  if (thirdOwner) {
    failures.push(
      `a third MenuItem ("${thirdOwner.title}", ${thirdOwner.id}) already holds posProductCode "${posProductCode}"`,
    );
  }

  return {
    curatedTitle: curated.title,
    curatedCategory: curated.category?.name ?? null,
    stagingTitle: staging.title,
    stagingCategory: staging.category?.name ?? null,
    failures,
  };
}

/**
 * Re-validates (never trusts a caller-supplied plan) and then writes both
 * halves of the mapping in one transaction. Throws — never partially
 * applies — if the plan has any failure, or if either guarded update
 * doesn't affect exactly one row (a concurrent modification between the
 * plan and the write).
 */
export async function applyPluMapping(
  prisma: PrismaClient,
  input: ApplyPluMappingInput,
): Promise<void> {
  const plan = await planPluMapping(prisma, input);
  if (plan.failures.length > 0) {
    throw new Error(`Preconditions failed:\n${plan.failures.map((f) => `  - ${f}`).join('\n')}`);
  }

  await prisma.$transaction(async (tx) => {
    const clearedStaging = await tx.menuItem.updateMany({
      where: { id: input.stagingMenuItemId, posProductCode: input.posProductCode, deletedAt: null },
      data: { posProductCode: null },
    });
    if (clearedStaging.count !== 1) {
      throw new Error(`Expected to clear exactly 1 staging row, affected ${clearedStaging.count}`);
    }
    const setCurated = await tx.menuItem.updateMany({
      where: { id: input.curatedMenuItemId, posProductCode: null, deletedAt: null },
      data: { posProductCode: input.posProductCode },
    });
    if (setCurated.count !== 1) {
      throw new Error(`Expected to set exactly 1 curated row, affected ${setCurated.count}`);
    }
  });
}
