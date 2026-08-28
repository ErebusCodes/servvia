import { PosProductIdentity, Prisma, PrismaClient } from '@prisma/client';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';
import { classifyPosCandidate, PosCandidateEvidence } from './classify-pos-candidate';

const SOURCE_SYSTEM = 'idealpos' as const;

/**
 * One candidate row from a live IdealPOS export, already evidence-bearing.
 * Department-based exclusion (Sila-branded, TA-*, third-party-delivery,
 * drinks departments — see the Menu Management architecture decisions)
 * and Department-41-twin cross-referencing happen upstream of this module,
 * in whatever produces this row set (the CLI wrapper's SQL export query),
 * not here — this module's job is strictly upsert + classify + drift/
 * missing detection, never department policy.
 */
export interface PosCatalogSourceRow {
  nativeCode: string;
  nativeDescription: string;
  priceCentsFromPos: number | null;
  evidence: PosCandidateEvidence;
}

export type PosCatalogRowAction =
  | { type: 'create'; nativeCode: string }
  | { type: 'update'; nativeCode: string; descriptionDrifted: boolean }
  | { type: 'unchanged'; nativeCode: string }
  | { type: 'mark_source_missing'; nativeCode: string; existingId: string };

export interface PosCatalogSyncPlan {
  actions: PosCatalogRowAction[];
  summary: {
    toCreate: number;
    toUpdate: number;
    unchanged: number;
    toMarkSourceMissing: number;
  };
}

function evidenceToJson(evidence: PosCandidateEvidence): Prisma.InputJsonValue {
  return { ...evidence };
}

/**
 * Field-by-field equality, not a JSON.stringify string comparison — a
 * JSONB round-trip through Postgres does not guarantee the same key
 * order the value was written with, so a naive string comparison of
 * `current.evidence` (read back from the database) against a freshly
 * constructed evidence object would spuriously report a change on every
 * single sync pass, defeating idempotency. Every `PosCandidateEvidence`
 * field is a boolean, so this stays a flat, explicit comparison rather
 * than a generic (and easy-to-get-subtly-wrong) deep-equal utility.
 */
function evidenceUnchanged(stored: unknown, incoming: PosCandidateEvidence): boolean {
  if (typeof stored !== 'object' || stored === null) return false;
  const s = stored as Partial<Record<keyof PosCandidateEvidence, unknown>>;
  return (
    s.hasAnyGridPlacement === incoming.hasAnyGridPlacement &&
    s.hasVisibleGridPlacement === incoming.hasVisibleGridPlacement &&
    s.isDepartment41 === incoming.isDepartment41 &&
    s.hasDepartment41TwinSameDescription === incoming.hasDepartment41TwinSameDescription
  );
}

/**
 * Read-only: computes what a sync pass would do, without writing anything.
 * Same convention as `apply-plu-mapping.ts`'s `planPluMapping` — both the
 * dry-run and apply paths call this so they can never silently diverge on
 * what counts as a change.
 */
export async function planPosCatalogSync(
  prisma: PrismaClient,
  organizationId: string,
  rows: PosCatalogSourceRow[],
): Promise<PosCatalogSyncPlan> {
  const existing = await prisma.posProductIdentity.findMany({
    where: { organizationId, sourceSystem: SOURCE_SYSTEM },
  });
  const existingByCode = new Map(existing.map((row) => [row.nativeCode, row]));
  const incomingCodes = new Set(rows.map((row) => row.nativeCode));

  const actions: PosCatalogRowAction[] = [];

  for (const row of rows) {
    const current = existingByCode.get(row.nativeCode);
    if (!current) {
      actions.push({ type: 'create', nativeCode: row.nativeCode });
      continue;
    }
    const descriptionDrifted = current.nativeDescription !== row.nativeDescription;
    const isNoOp =
      !descriptionDrifted &&
      current.priceCentsFromPos === row.priceCentsFromPos &&
      current.lifecycleStatus !== 'source_missing' &&
      evidenceUnchanged(current.evidence, row.evidence);
    actions.push(
      isNoOp
        ? { type: 'unchanged', nativeCode: row.nativeCode }
        : { type: 'update', nativeCode: row.nativeCode, descriptionDrifted },
    );
  }

  for (const current of existing) {
    if (!incomingCodes.has(current.nativeCode) && current.lifecycleStatus !== 'source_missing') {
      actions.push({
        type: 'mark_source_missing',
        nativeCode: current.nativeCode,
        existingId: current.id,
      });
    }
  }

  return {
    actions,
    summary: {
      toCreate: actions.filter((a) => a.type === 'create').length,
      toUpdate: actions.filter((a) => a.type === 'update').length,
      unchanged: actions.filter((a) => a.type === 'unchanged').length,
      toMarkSourceMissing: actions.filter((a) => a.type === 'mark_source_missing').length,
    },
  };
}

/**
 * Applies a sync pass in one transaction. Re-plans internally (never
 * trusts a caller-supplied plan, same discipline as
 * `apply-plu-mapping.ts`'s `applyPluMapping`). Never touches
 * `menuItemId`/`lifecycleStatus` for an already-linked row beyond the
 * source_missing/reappearance transitions below — a sync pass can update a
 * linked candidate's source-side data (nativeDescription, price, grid
 * evidence) but can never unlink it or change what it's linked to.
 */
export async function applyPosCatalogSync(
  prisma: PrismaClient,
  organizationId: string,
  rows: PosCatalogSourceRow[],
): Promise<PosCatalogSyncPlan> {
  const plan = await planPosCatalogSync(prisma, organizationId, rows);
  const rowsByCode = new Map(rows.map((row) => [row.nativeCode, row]));
  const now = new Date();

  await prisma.$transaction(async (tx) => {
    for (const action of plan.actions) {
      if (action.type === 'unchanged') continue;

      if (action.type === 'mark_source_missing') {
        await tx.posProductIdentity.update({
          where: { id: action.existingId },
          data: { lifecycleStatus: 'source_missing', lastSyncedAt: now },
        });
        continue;
      }

      const row = rowsByCode.get(action.nativeCode);
      if (!row) continue; // unreachable: create/update actions always originate from `rows`
      const classification = classifyPosCandidate(row.evidence);

      if (action.type === 'create') {
        await tx.posProductIdentity.create({
          data: {
            organizationId,
            sourceSystem: SOURCE_SYSTEM,
            nativeCode: row.nativeCode,
            nativeDescription: row.nativeDescription,
            lifecycleStatus: 'pending_review',
            confidenceTier: classification.tier,
            evidence: evidenceToJson(row.evidence),
            priceCentsFromPos: row.priceCentsFromPos,
            priceLastSyncedAt: row.priceCentsFromPos !== null ? now : null,
            lastSyncedAt: now,
          },
        });
        continue;
      }

      // action.type === 'update'
      const current = await tx.posProductIdentity.findFirstOrThrow({
        where: { organizationId, sourceSystem: SOURCE_SYSTEM, nativeCode: row.nativeCode },
      });
      const reappearedFromMissing = current.lifecycleStatus === 'source_missing';
      await tx.posProductIdentity.update({
        where: { id: current.id },
        data: {
          nativeDescription: row.nativeDescription,
          confidenceTier: classification.tier,
          evidence: evidenceToJson(row.evidence),
          priceCentsFromPos: row.priceCentsFromPos,
          priceLastSyncedAt: row.priceCentsFromPos !== null ? now : current.priceLastSyncedAt,
          lastSyncedAt: now,
          descriptionDriftDetectedAt: action.descriptionDrifted
            ? now
            : current.descriptionDriftDetectedAt,
          // A row that comes back after being source_missing resumes as
          // `active` if it's still linked, otherwise `pending_review` —
          // never silently re-published beyond what it already was.
          ...(reappearedFromMissing
            ? { lifecycleStatus: current.menuItemId ? 'active' : 'pending_review' }
            : {}),
        },
      });
    }
  });

  return plan;
}

/**
 * Links one currently-unlinked candidate to one currently-unmapped
 * MenuItem — the direct successor to `apply-plu-mapping.ts`'s two-row
 * clear-then-set dance, now a single guarded update because a candidate
 * was never a MenuItem row to begin with. Fail-closed: re-validates
 * immediately before writing, requires the candidate to be currently
 * unlinked and the MenuItem to belong to the same organization and not be
 * soft-deleted.
 */
export async function linkPosCandidate(
  prisma: PrismaClient,
  input: { posProductIdentityId: string; menuItemId: string },
): Promise<PosProductIdentity> {
  const candidate = await prisma.posProductIdentity.findFirst({
    where: { id: input.posProductIdentityId },
  });
  if (!candidate) throw new Error(`PosProductIdentity ${input.posProductIdentityId} not found`);
  if (candidate.menuItemId !== null) {
    throw new Error(
      `PosProductIdentity ${input.posProductIdentityId} is already linked to MenuItem ${candidate.menuItemId}`,
    );
  }

  const menuItem = await prisma.menuItem.findFirst({
    where: { id: input.menuItemId, organizationId: candidate.organizationId, deletedAt: null },
  });
  if (!menuItem) {
    throw new Error(
      `MenuItem ${input.menuItemId} not found in organization ${candidate.organizationId}`,
    );
  }

  // Explicit precondition, not just relying on PosProductIdentity's own
  // @@unique(menuItemId) DB constraint to catch this: without this check,
  // linking a target MenuItem that another candidate already holds would
  // surface as a raw Prisma P2002 unique-constraint error from inside the
  // transaction below, not a clear domain message — the same
  // fail-closed-with-a-clear-reason discipline `apply-plu-mapping.ts`
  // established for its own third-owner check.
  const existingLinkForTarget = await prisma.posProductIdentity.findFirst({
    where: { menuItemId: input.menuItemId },
  });
  if (existingLinkForTarget) {
    throw new Error(
      `MenuItem ${input.menuItemId} is already linked to a different PosProductIdentity (${existingLinkForTarget.nativeCode}, id ${existingLinkForTarget.id})`,
    );
  }

  try {
    return await prisma.$transaction(async (tx) => {
      const updated = await tx.posProductIdentity.updateMany({
        where: { id: input.posProductIdentityId, menuItemId: null },
        data: { menuItemId: input.menuItemId, lifecycleStatus: 'active' },
      });
      if (updated.count !== 1) {
        throw new Error(
          `Expected to link exactly 1 candidate, affected ${updated.count} — concurrent modification?`,
        );
      }
      // Re-check the target directly inside the transaction: the read-only
      // precondition above cannot close a race where a second, concurrent
      // link call for the same MenuItem interleaves between that check and
      // this write.
      const targetLinkCount = await tx.posProductIdentity.count({
        where: { menuItemId: input.menuItemId, id: { not: input.posProductIdentityId } },
      });
      if (targetLinkCount > 0) {
        throw new Error(
          `MenuItem ${input.menuItemId} was linked to a different PosProductIdentity by a concurrent request`,
        );
      }
      return tx.posProductIdentity.findFirstOrThrow({ where: { id: input.posProductIdentityId } });
    });
  } catch (e) {
    // Last-resort translation: under true concurrent commits, Postgres's
    // own @@unique(menuItemId) constraint (the actual, always-correct
    // safety net — a true double-link is structurally impossible either
    // way) can still be the one that catches a race the two application-
    // level checks above raced past. Never let that surface as a raw
    // P2002 to a caller expecting a clear domain message.
    if (e instanceof PrismaClientKnownRequestError && e.code === 'P2002') {
      throw new Error(
        `MenuItem ${input.menuItemId} is already linked to a different PosProductIdentity`,
      );
    }
    throw e;
  }
}

/** Unlinks a candidate, returning it to `pending_review`. Never deletes the row. */
export async function unlinkPosCandidate(
  prisma: PrismaClient,
  posProductIdentityId: string,
): Promise<PosProductIdentity> {
  const candidate = await prisma.posProductIdentity.findFirst({
    where: { id: posProductIdentityId },
  });
  if (!candidate) throw new Error(`PosProductIdentity ${posProductIdentityId} not found`);
  if (candidate.menuItemId === null) {
    throw new Error(`PosProductIdentity ${posProductIdentityId} is not currently linked`);
  }

  return prisma.$transaction(async (tx) => {
    const updated = await tx.posProductIdentity.updateMany({
      where: { id: posProductIdentityId, menuItemId: candidate.menuItemId },
      data: { menuItemId: null, lifecycleStatus: 'pending_review' },
    });
    if (updated.count !== 1) {
      throw new Error(
        `Expected to unlink exactly 1 candidate, affected ${updated.count} — concurrent modification?`,
      );
    }
    return tx.posProductIdentity.findFirstOrThrow({ where: { id: posProductIdentityId } });
  });
}
