// Integration test against a REAL local Postgres (see
// local-postgres/README.md) — no mocking. `sync-pos-catalog.ts`'s
// plan/apply functions issue several interacting Prisma calls inside a
// `$transaction` callback (findMany, create, update, findFirstOrThrow) —
// a hand-rolled mock of that interaction risks asserting the mock's own
// behavior rather than Postgres's real upsert/transaction semantics, so
// this suite runs against the real database instead, the same choice
// `menu.integration-spec.ts` already makes for this module's neighbors.
//
// Run with: npm run test:integration --workspace=api (from repo root) or
// `npm run test:integration` from apps/api/.
// Requires: local Postgres running (docker compose up postgres) with the
// existing seed applied.
import { PrismaClient } from '@prisma/client';
import {
  applyPosCatalogSync,
  linkPosCandidate,
  planPosCatalogSync,
  PosCatalogSourceRow,
  unlinkPosCandidate,
} from '../src/pos-sync/sync-pos-catalog';

const prisma = new PrismaClient();

const GRID_VISIBLE_EVIDENCE = {
  hasAnyGridPlacement: true,
  hasVisibleGridPlacement: true,
  isDepartment41: false,
  hasDepartment41TwinSameDescription: false,
};

function makeRow(overrides: Partial<PosCatalogSourceRow> = {}): PosCatalogSourceRow {
  return {
    nativeCode: 'TEST-710',
    nativeDescription: 'PESTO CHICKEN PIZZA',
    priceCentsFromPos: 2300,
    evidence: GRID_VISIBLE_EVIDENCE,
    ...overrides,
  };
}

describe('sync-pos-catalog (integration, real local Postgres)', () => {
  let organizationId: string;
  const createdPosIdentityIds: string[] = [];
  const createdMenuItemIds: string[] = [];
  const testNativeCode = `TEST-SYNC-${Date.now()}`;

  beforeAll(async () => {
    const venue = await prisma.venue.findFirstOrThrow({ where: { slug: 'auckland' } });
    organizationId = venue.organizationId;
  });

  afterEach(async () => {
    if (createdPosIdentityIds.length > 0) {
      await prisma.posProductIdentity.deleteMany({ where: { id: { in: createdPosIdentityIds } } });
      createdPosIdentityIds.length = 0;
    }
    if (createdMenuItemIds.length > 0) {
      await prisma.menuItem.deleteMany({ where: { id: { in: createdMenuItemIds } } });
      createdMenuItemIds.length = 0;
    }
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('create then re-sync with identical data is idempotent (second pass is a no-op)', async () => {
    const row = makeRow({ nativeCode: testNativeCode });

    const firstPlan = await planPosCatalogSync(prisma, organizationId, [row]);
    expect(firstPlan.summary.toCreate).toBe(1);

    await applyPosCatalogSync(prisma, organizationId, [row]);
    const created = await prisma.posProductIdentity.findFirstOrThrow({
      where: { organizationId, nativeCode: testNativeCode },
    });
    createdPosIdentityIds.push(created.id);
    expect(created.lifecycleStatus).toBe('pending_review');
    expect(created.confidenceTier).toBe('high_confidence_active');

    const secondPlan = await planPosCatalogSync(prisma, organizationId, [row]);
    expect(secondPlan.summary.toCreate).toBe(0);
    expect(secondPlan.summary.toUpdate).toBe(0);
    expect(secondPlan.summary.unchanged).toBe(1);
  });

  it('detects description drift and records descriptionDriftDetectedAt without touching lifecycleStatus/menuItemId', async () => {
    const original = makeRow({ nativeCode: testNativeCode, nativeDescription: 'ORIGINAL NAME' });
    await applyPosCatalogSync(prisma, organizationId, [original]);
    const created = await prisma.posProductIdentity.findFirstOrThrow({
      where: { organizationId, nativeCode: testNativeCode },
    });
    createdPosIdentityIds.push(created.id);
    expect(created.descriptionDriftDetectedAt).toBeNull();

    const renamed = makeRow({ nativeCode: testNativeCode, nativeDescription: 'RENAMED PRODUCT' });
    await applyPosCatalogSync(prisma, organizationId, [renamed]);
    const updated = await prisma.posProductIdentity.findFirstOrThrow({ where: { id: created.id } });
    expect(updated.nativeDescription).toBe('RENAMED PRODUCT');
    expect(updated.descriptionDriftDetectedAt).not.toBeNull();
    expect(updated.lifecycleStatus).toBe('pending_review');
  });

  it('marks a previously-synced candidate source_missing when it disappears from a later sync pass, and never deletes it', async () => {
    const row = makeRow({ nativeCode: testNativeCode });
    await applyPosCatalogSync(prisma, organizationId, [row]);
    const created = await prisma.posProductIdentity.findFirstOrThrow({
      where: { organizationId, nativeCode: testNativeCode },
    });
    createdPosIdentityIds.push(created.id);

    await applyPosCatalogSync(prisma, organizationId, []); // this candidate no longer appears

    const afterMissing = await prisma.posProductIdentity.findFirstOrThrow({
      where: { id: created.id },
    });
    expect(afterMissing.lifecycleStatus).toBe('source_missing');
  });

  it('a source_missing candidate that reappears resumes as pending_review if unlinked, or active if already linked', async () => {
    const row = makeRow({ nativeCode: testNativeCode });
    await applyPosCatalogSync(prisma, organizationId, [row]);
    const created = await prisma.posProductIdentity.findFirstOrThrow({
      where: { organizationId, nativeCode: testNativeCode },
    });
    createdPosIdentityIds.push(created.id);
    await applyPosCatalogSync(prisma, organizationId, []);

    await applyPosCatalogSync(prisma, organizationId, [row]);
    const reappeared = await prisma.posProductIdentity.findFirstOrThrow({
      where: { id: created.id },
    });
    expect(reappeared.lifecycleStatus).toBe('pending_review');
  });

  it('dry-run (planPosCatalogSync) never writes anything to the database', async () => {
    const row = makeRow({ nativeCode: testNativeCode });
    await planPosCatalogSync(prisma, organizationId, [row]);
    const found = await prisma.posProductIdentity.findFirst({
      where: { organizationId, nativeCode: testNativeCode },
    });
    expect(found).toBeNull();
  });

  it('linkPosCandidate atomically links an unlinked candidate to an unmapped MenuItem and sets lifecycleStatus to active', async () => {
    const category = await prisma.category.findFirstOrThrow({ where: { organizationId } });
    const staff = await prisma.staff.findFirstOrThrow({ where: { organizationId } });
    const menuItem = await prisma.menuItem.create({
      data: {
        organizationId,
        categoryId: category.id,
        title: `Sync Test Item ${testNativeCode}`,
        description: 'test fixture',
        priceCents: 2300,
        nutritionalDetails: {},
        createdById: staff.id,
      },
    });
    createdMenuItemIds.push(menuItem.id);

    const row = makeRow({ nativeCode: testNativeCode });
    await applyPosCatalogSync(prisma, organizationId, [row]);
    const candidate = await prisma.posProductIdentity.findFirstOrThrow({
      where: { organizationId, nativeCode: testNativeCode },
    });
    createdPosIdentityIds.push(candidate.id);

    const linked = await linkPosCandidate(prisma, {
      posProductIdentityId: candidate.id,
      menuItemId: menuItem.id,
    });
    expect(linked.menuItemId).toBe(menuItem.id);
    expect(linked.lifecycleStatus).toBe('active');

    await expect(
      linkPosCandidate(prisma, { posProductIdentityId: candidate.id, menuItemId: menuItem.id }),
    ).rejects.toThrow(/already linked/);
  });

  it('rejects linking a SECOND, different candidate to a MenuItem that already has a linked PosProductIdentity, with a clear error rather than a raw DB constraint failure', async () => {
    const category = await prisma.category.findFirstOrThrow({ where: { organizationId } });
    const staff = await prisma.staff.findFirstOrThrow({ where: { organizationId } });
    const menuItem = await prisma.menuItem.create({
      data: {
        organizationId,
        categoryId: category.id,
        title: `Sync Test Double-Link Target ${testNativeCode}`,
        description: 'test fixture',
        priceCents: 2300,
        nutritionalDetails: {},
        createdById: staff.id,
      },
    });
    createdMenuItemIds.push(menuItem.id);

    const firstRow = makeRow({ nativeCode: `${testNativeCode}-A` });
    const secondRow = makeRow({
      nativeCode: `${testNativeCode}-B`,
      nativeDescription: 'A DIFFERENT PRODUCT',
    });
    await applyPosCatalogSync(prisma, organizationId, [firstRow, secondRow]);
    const firstCandidate = await prisma.posProductIdentity.findFirstOrThrow({
      where: { organizationId, nativeCode: `${testNativeCode}-A` },
    });
    const secondCandidate = await prisma.posProductIdentity.findFirstOrThrow({
      where: { organizationId, nativeCode: `${testNativeCode}-B` },
    });
    createdPosIdentityIds.push(firstCandidate.id, secondCandidate.id);

    await linkPosCandidate(prisma, {
      posProductIdentityId: firstCandidate.id,
      menuItemId: menuItem.id,
    });

    await expect(
      linkPosCandidate(prisma, {
        posProductIdentityId: secondCandidate.id,
        menuItemId: menuItem.id,
      }),
    ).rejects.toThrow(/already linked to a different PosProductIdentity/);

    // The original link must be completely unaffected by the rejected attempt.
    const stillLinked = await prisma.posProductIdentity.findFirstOrThrow({
      where: { id: firstCandidate.id },
    });
    expect(stillLinked.menuItemId).toBe(menuItem.id);
    const secondStillUnlinked = await prisma.posProductIdentity.findFirstOrThrow({
      where: { id: secondCandidate.id },
    });
    expect(secondStillUnlinked.menuItemId).toBeNull();
  });

  it('unlinkPosCandidate returns a linked candidate to pending_review without deleting it', async () => {
    const category = await prisma.category.findFirstOrThrow({ where: { organizationId } });
    const staff = await prisma.staff.findFirstOrThrow({ where: { organizationId } });
    const menuItem = await prisma.menuItem.create({
      data: {
        organizationId,
        categoryId: category.id,
        title: `Sync Test Unlink ${testNativeCode}`,
        description: 'test fixture',
        priceCents: 2300,
        nutritionalDetails: {},
        createdById: staff.id,
      },
    });
    createdMenuItemIds.push(menuItem.id);

    const row = makeRow({ nativeCode: testNativeCode });
    await applyPosCatalogSync(prisma, organizationId, [row]);
    const candidate = await prisma.posProductIdentity.findFirstOrThrow({
      where: { organizationId, nativeCode: testNativeCode },
    });
    createdPosIdentityIds.push(candidate.id);
    await linkPosCandidate(prisma, { posProductIdentityId: candidate.id, menuItemId: menuItem.id });

    const unlinked = await unlinkPosCandidate(prisma, candidate.id);
    expect(unlinked.menuItemId).toBeNull();
    expect(unlinked.lifecycleStatus).toBe('pending_review');

    const stillExists = await prisma.posProductIdentity.findUnique({ where: { id: candidate.id } });
    expect(stillExists).not.toBeNull();
  });
});
