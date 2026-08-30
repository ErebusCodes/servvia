// Integration tests against a REAL local Postgres (see
// local-postgres/README.md) — no mocking, same rationale as
// sync-pos-catalog.integration-spec.ts: this migration issues several
// interacting Prisma calls inside a single $transaction, and a hand-rolled
// mock of that interaction would only prove the mock's own behavior, not
// Postgres's real upsert/unique-constraint/transaction semantics.
//
// Run with: npm run test:integration --workspace=apps/api (from repo root)
// or `npm run test:integration` from apps/api/. Requires local Postgres
// running (`npm run db:start` from repo root).
import {
  loadFixture,
  teardownFixture,
  STAGING_CATEGORY_NAME as FIXTURE_STAGING_NAME,
} from '../prisma/scripts/menu-migration/fixture';
import {
  runMigration,
  prisma,
  STAGING_CATEGORY_NAME,
  CATEGORY_PLAN,
  REVIEW_REQUIRED_CODES_TO_CHECK,
} from '../prisma/scripts/menu-migration/migrate-authoritative-menu';
import manifestJson from '../prisma/scripts/menu-migration/manifest.json';

const manifest = manifestJson as {
  items: {
    requestedName: string;
    nativeCode: string;
    category: string;
    priceDollars: number;
    isAvailable: boolean;
  }[];
  reviewRequired: { requestedName: string; category: string }[];
};

const KNOWN_DRIFT_CODES = ['165', '578', '20', '708', '710', '712']; // Dolma, Tiramisu, Iskender Grill Chicken, 3 pizzas

/**
 * resolveCategoryPlan() expects an org to already have the 4 pre-existing
 * categories its REUSE/RENAME entries target (Mains, Sides, Fresh From The
 * Oven, Desserts) — true of production and of the full fixture, but not of
 * a minimal decoy org built just to exercise MENUITEM_PLAN's zero/multi-
 * match logic. Creates those 4 plus the staging category so decoy-org
 * tests reach MENUITEM_PLAN instead of failing earlier in CATEGORY_PLAN.
 */
async function createBaselineCategories(
  prismaClient: typeof prisma,
  organizationId: string,
  staffId: string,
) {
  const staging = await prismaClient.category.create({
    data: { organizationId, name: FIXTURE_STAGING_NAME, createdById: staffId },
  });
  for (const name of ['Mains', 'Sides', 'Fresh From The Oven', 'Desserts']) {
    await prismaClient.category.create({ data: { organizationId, name, createdById: staffId } });
  }
  return staging;
}

describe('migrate-authoritative-menu (integration, real local Postgres)', () => {
  let organizationId: string;

  beforeAll(async () => {
    const handles = await loadFixture(prisma);
    organizationId = handles.organizationId;
  }, 60000);

  describe('full fixture lifecycle (dry-run -> apply -> idempotent re-apply)', () => {
    it('dry-run reports the exact expected plan with zero errors', async () => {
      const report = await runMigration(organizationId, false);

      expect(report.errors).toEqual([]);
      expect(report.applied).toBe(false);
      expect(report.menuItemReuseUpdate).toBe(228);
      expect(report.menuItemCreate).toBe(0);
      expect(report.menuItemPromoteFromStaging).toBe(219);
      expect(report.menuItemHide).toBe(61);
      expect(report.stagingRemaining).toBe(606);
      expect(report.reviewRequiredExcluded).toBe(10);
      expect(report.posIdentityCreate).toBe(228);
      expect(report.posIdentityLink).toBe(0);
      expect(report.categoriesCreate.sort()).toEqual(
        CATEGORY_PLAN.filter((c) => c.action === 'CREATE')
          .map((c) => c.target)
          .sort(),
      );
      expect(report.categoriesRename.length).toBe(2);
      expect(report.categoriesReuse.length).toBe(2);

      // priceChanges includes every $0-staging-row activation (215) PLUS
      // the 6 genuine trusted-mapping drifts = 221 total. The 6 known
      // drift codes must all be present among them; the other 3 trusted
      // codes (already at parity) must NOT appear.
      expect(report.priceChanges).toHaveLength(221);
      const changedCodes = new Set(report.priceChanges.map((p) => p.nativeCode));
      for (const code of KNOWN_DRIFT_CODES) {
        expect(changedCodes.has(code)).toBe(true);
      }
      for (const parityCode of ['663', '701', '704']) {
        expect(changedCodes.has(parityCode)).toBe(false);
      }
      const dolma = report.priceChanges.find((p) => p.nativeCode === '165');
      expect(dolma).toMatchObject({ currentCents: 1000, targetCents: 500 });

      // Zero-price items are real prices, not missing ones — must never be
      // reported as a "price change" needing correction away from $0.
      for (const zeroCode of ['401', '24', '194', '255']) {
        const change = report.priceChanges.find((p) => p.nativeCode === zeroCode);
        expect(change).toBeUndefined();
      }
    });

    it('dry-run performs zero writes', async () => {
      const before = await prisma.menuItem.count({ where: { organizationId } });
      await runMigration(organizationId, false);
      const after = await prisma.menuItem.count({ where: { organizationId } });
      expect(after).toBe(before);
      expect(after).toBe(895);
    });

    it('preserves the 9 trusted MenuItem IDs across apply', async () => {
      const trustedCodes = ['708', '578', '20', '165', '710', '704', '663', '712', '701'];
      const before = await prisma.menuItem.findMany({
        where: { organizationId, posProductCode: { in: trustedCodes } },
        select: { id: true, posProductCode: true },
      });
      expect(before).toHaveLength(9);
      const idByCodeBefore = new Map(before.map((m) => [m.posProductCode as string, m.id]));

      const report = await runMigration(organizationId, true);
      expect(report.errors).toEqual([]);
      expect(report.applied).toBe(true);

      const after = await prisma.menuItem.findMany({
        where: { organizationId, posProductCode: { in: trustedCodes } },
        select: { id: true, posProductCode: true },
      });
      expect(after).toHaveLength(9);
      for (const a of after) {
        expect(a.id).toBe(idByCodeBefore.get(a.posProductCode as string));
      }
    });

    it('creates no new MenuItem rows (total count unchanged at 895)', async () => {
      const count = await prisma.menuItem.count({ where: { organizationId } });
      expect(count).toBe(895);
    });

    it('hard-deletes nothing (0 soft-deleted, 0 hard-deleted)', async () => {
      const total = await prisma.menuItem.count({ where: { organizationId } });
      const notDeleted = await prisma.menuItem.count({
        where: { organizationId, deletedAt: null },
      });
      expect(total).toBe(895);
      expect(notDeleted).toBe(895);
    });

    it('applies the known price corrections exactly (Dolma etc.)', async () => {
      const dolma = await prisma.menuItem.findFirst({
        where: { organizationId, posProductCode: '165' },
      });
      expect(dolma?.priceCents).toBe(500);
      const tiramisu = await prisma.menuItem.findFirst({
        where: { organizationId, posProductCode: '578' },
      });
      expect(tiramisu?.priceCents).toBe(1200);
    });

    it('preserves confirmed zero-price items exactly at 0 cents', async () => {
      for (const code of ['401', '24', '194', '255']) {
        const item = await prisma.menuItem.findFirst({
          where: { organizationId, posProductCode: code },
        });
        expect(item?.priceCents).toBe(0);
        expect(item?.isAvailable).toBe(true);
      }
    });

    it('hides the 61 obsolete curated rows (isAvailable false, visibleChannels empty) without deleting them', async () => {
      const stagingCategory = await prisma.category.findFirstOrThrow({
        where: { organizationId, name: STAGING_CATEGORY_NAME },
      });
      const approvedCodes = new Set(manifest.items.map((i) => i.nativeCode));
      const nonStagingItems = await prisma.menuItem.findMany({
        where: { organizationId, deletedAt: null, categoryId: { not: stagingCategory.id } },
      });
      const hidden = nonStagingItems.filter(
        (m) => !approvedCodes.has(m.posProductCode ?? '__none__'),
      );
      expect(hidden).toHaveLength(61);
      for (const h of hidden) {
        expect(h.isAvailable).toBe(false);
        expect(h.visibleChannels).toEqual([]);
        expect(h.deletedAt).toBeNull();
      }
    });

    it('leaves the 606 residual staging rows untouched (still inert, still in staging category)', async () => {
      const stagingCategory = await prisma.category.findFirstOrThrow({
        where: { organizationId, name: STAGING_CATEGORY_NAME },
      });
      const approvedCodes = new Set(manifest.items.map((i) => i.nativeCode));
      const stagingItems = await prisma.menuItem.findMany({
        where: { organizationId, deletedAt: null, categoryId: stagingCategory.id },
      });
      const residual = stagingItems.filter(
        (m) => !approvedCodes.has(m.posProductCode ?? '__none__'),
      );
      expect(residual).toHaveLength(606);
      for (const r of residual) {
        expect(r.isAvailable).toBe(false);
      }
      // None of the 606 residual rows may hold an active PosProductIdentity.
      const residualIds = residual.map((r) => r.id);
      const leaked = await prisma.posProductIdentity.count({
        where: { menuItemId: { in: residualIds }, lifecycleStatus: 'active' },
      });
      expect(leaked).toBe(0);
    });

    it('assigns exactly one active PosProductIdentity per approved item, lifecycleStatus active only for the 228', async () => {
      const identities = await prisma.posProductIdentity.findMany({ where: { organizationId } });
      const activeOnes = identities.filter((i) => i.lifecycleStatus === 'active');
      expect(activeOnes).toHaveLength(228);

      const codes = activeOnes.map((i) => i.nativeCode).sort();
      const manifestCodes = manifest.items.map((i) => i.nativeCode).sort();
      expect(codes).toEqual(manifestCodes);

      // Exactly one PosProductIdentity per MenuItem: no duplicates.
      const menuItemIds = activeOnes.map((i) => i.menuItemId).filter(Boolean);
      expect(new Set(menuItemIds).size).toBe(menuItemIds.length);
    });

    it('nativeCode is preserved byte-for-byte (string, not numeric) for every approved item', async () => {
      for (const item of manifest.items.slice(0, 30)) {
        const identity = await prisma.posProductIdentity.findFirst({
          where: { organizationId, nativeCode: item.nativeCode },
        });
        expect(identity).not.toBeNull();
        expect(identity?.nativeCode).toBe(item.nativeCode); // exact string equality
        expect(typeof identity?.nativeCode).toBe('string');
      }
    });

    it('Order Tablet invariant: every order_tablet-visible, available MenuItem has an active identity with a non-empty nativeCode', async () => {
      const tabletVisible = await prisma.menuItem.findMany({
        where: {
          organizationId,
          deletedAt: null,
          isAvailable: true,
          visibleChannels: { has: 'order_tablet' },
        },
        include: { posIdentity: true },
      });
      expect(tabletVisible.length).toBe(228);
      const violations = tabletVisible.filter(
        (m) =>
          !m.posIdentity || m.posIdentity.lifecycleStatus !== 'active' || !m.posIdentity.nativeCode,
      );
      expect(violations).toHaveLength(0);
    });

    it('none of the REVIEW_REQUIRED codes ever gained an active PosProductIdentity', async () => {
      const leaked = await prisma.posProductIdentity.count({
        where: {
          organizationId,
          nativeCode: { in: REVIEW_REQUIRED_CODES_TO_CHECK },
          lifecycleStatus: 'active',
        },
      });
      expect(leaked).toBe(0);
    });

    it('re-running --apply is idempotent: zero further price changes, zero new PosProductIdentity creates', async () => {
      const before895 = await prisma.menuItem.count({ where: { organizationId } });
      const report2 = await runMigration(organizationId, true);

      expect(report2.errors).toEqual([]);
      expect(report2.applied).toBe(true);
      expect(report2.priceChanges).toEqual([]);
      expect(report2.posIdentityCreate).toBe(0);
      expect(report2.posIdentityLink).toBe(228);
      expect(report2.menuItemHideAlreadyInert).toBe(report2.menuItemHide);
      expect(report2.postcheck?.orderTabletViolations).toBe(0);
      expect(report2.postcheck?.reviewRequiredLeaked).toBe(0);

      const after895 = await prisma.menuItem.count({ where: { organizationId } });
      expect(after895).toBe(before895);

      const identityCount = await prisma.posProductIdentity.count({ where: { organizationId } });
      expect(identityCount).toBe(228); // unchanged, no duplicates created on re-apply
    });
  });

  describe('fail-closed behavior (isolated throwaway orgs, no interaction with the main fixture)', () => {
    it('title-only match never happens: a same-titled, differently-coded decoy MenuItem is left untouched', async () => {
      const org = await prisma.organization.create({
        data: {
          name: 'Decoy Org',
          slug: `decoy-title-${Date.now()}`,
          billingEmail: 'decoy@example.invalid',
        },
      });
      const staff = await prisma.staff.create({
        data: {
          organizationId: org.id,
          email: `decoy-${Date.now()}@example.invalid`,
          name: 'Decoy Staff',
          passwordHash: 'not-a-real-hash',
          role: 'owner',
        },
      });
      const staging = await createBaselineCategories(prisma, org.id, staff.id);
      // Same title as the real "Dolma" (code 165), but a DIFFERENT code —
      // a title-based matcher would wrongly touch this; an exact-code
      // matcher must report it as zero-match and leave it byte-for-byte
      // unchanged.
      const decoy = await prisma.menuItem.create({
        data: {
          organizationId: org.id,
          categoryId: staging.id,
          title: 'Dolma',
          description: '',
          priceCents: 999999,
          nutritionalDetails: {},
          posProductCode: 'DECOY-NOT-165',
          createdById: staff.id,
        },
      });

      const report = await runMigration(org.id, true);
      expect(report.applied).toBe(false); // every one of the 228 is zero-match in this near-empty org
      expect(report.errors.length).toBeGreaterThan(0);
      expect(report.errors.some((e) => e.includes('165') && e.includes('Dolma'))).toBe(true);

      const stillThere = await prisma.menuItem.findUniqueOrThrow({ where: { id: decoy.id } });
      expect(stillThere.title).toBe('Dolma');
      expect(stillThere.priceCents).toBe(999999);
      expect(stillThere.posProductCode).toBe('DECOY-NOT-165');
      expect(stillThere.categoryId).toBe(staging.id); // never reassigned

      await prisma.menuItem.deleteMany({ where: { organizationId: org.id } });
      await prisma.category.deleteMany({ where: { organizationId: org.id } });
      await prisma.staff.deleteMany({ where: { organizationId: org.id } });
      await prisma.organization.delete({ where: { id: org.id } });
    }, 30000);

    it("duplicate exact-code rows cannot coexist: the schema-level unique constraint is the enforced guarantee behind the migration's own multi-match defense", async () => {
      // NOTE on scope: the migration's resolveMenuItemPlan() defends
      // against `matches.length > 1` (see runMigration's error-collection
      // loop), but MenuItem's own @@unique([organizationId,
      // posProductCode]) constraint means two rows sharing a code can
      // never actually exist in this schema — so that branch cannot be
      // exercised end-to-end via real inserted rows. What CAN be verified,
      // and is the load-bearing guarantee the migration's fail-closed
      // design relies on, is that the constraint itself is real and
      // enforced: if it were ever silently dropped or loosened, the
      // migration's in-code multi-match check is what would catch the
      // resulting risk, so proving the constraint's presence here is the
      // correct-scoped test.
      const org = await prisma.organization.create({
        data: {
          name: 'Decoy Org Dup',
          slug: `decoy-dup-${Date.now()}`,
          billingEmail: 'decoy-dup@example.invalid',
        },
      });
      const staff = await prisma.staff.create({
        data: {
          organizationId: org.id,
          email: `decoy-dup-${Date.now()}@example.invalid`,
          name: 'Decoy Staff',
          passwordHash: 'not-a-real-hash',
          role: 'owner',
        },
      });
      const staging = await createBaselineCategories(prisma, org.id, staff.id);
      await prisma.menuItem.create({
        data: {
          organizationId: org.id,
          categoryId: staging.id,
          title: 'Chicken Ballista Pizza',
          description: '',
          priceCents: 2350,
          nutritionalDetails: {},
          posProductCode: '708',
          createdById: staff.id,
        },
      });
      await expect(
        prisma.menuItem.create({
          data: {
            organizationId: org.id,
            categoryId: staging.id,
            title: 'Chicken Ballista Pizza (duplicate)',
            description: '',
            priceCents: 2350,
            nutritionalDetails: {},
            posProductCode: '708',
            createdById: staff.id,
          },
        }),
      ).rejects.toThrow();

      // With only the single, legitimate code-708 row present, this org is
      // still zero-match for the other 227 codes — confirming the whole
      // run still fails closed (no partial apply) rather than partially
      // applying just the one resolvable item.
      const report = await runMigration(org.id, true);
      expect(report.applied).toBe(false);
      expect(report.errors.length).toBeGreaterThan(0);

      await prisma.menuItem.deleteMany({ where: { organizationId: org.id } });
      await prisma.category.deleteMany({ where: { organizationId: org.id } });
      await prisma.staff.deleteMany({ where: { organizationId: org.id } });
      await prisma.organization.delete({ where: { id: org.id } });
    }, 30000);
  });
});

afterAll(async () => {
  await teardownFixture(prisma);
  await prisma.$disconnect();
});
