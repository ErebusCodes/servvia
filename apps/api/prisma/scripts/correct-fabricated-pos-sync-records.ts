import { PrismaClient } from '@prisma/client';

/**
 * Story 9-1 AC5: corrects historical rows produced by the pre-fix
 * fabrication bug in `PosSyncProcessor`. No real Idealpos adapter has ever
 * existed in this codebase (blocked on decision record DL-064 — see
 * docs/decisions-log.md), so `POSSyncRecord.status = 'synced'` has no
 * legitimate historical occurrence: every such row was produced exclusively
 * by the removed code path that synthesized a plausible-looking `IDEAL-*`
 * transaction ID without ever contacting a real Idealpos system.
 *
 * This is the exact SQL embedded in migration
 * `20260815150100_pos_sync_correct_fabricated_records` — kept here,
 * runnable standalone, so the same logic can be (a) proven directly against
 * real Postgres in an integration test, and (b) re-run on demand in any
 * environment (idempotent — each statement's own WHERE clause excludes rows
 * it has already corrected).
 */
export async function correctFabricatedPosSyncRecords(
  prisma: PrismaClient,
): Promise<{ recordsCorrected: number; ordersCorrected: number }> {
  const recordsCorrected = await prisma.$executeRaw`
    UPDATE "POSSyncRecord"
    SET
      status = CASE
        WHEN "adapterType" = 'none' THEN 'not_applicable'::"POSSyncStatus"
        ELSE 'unsupported'::"POSSyncStatus"
      END,
      "posOrderId" = NULL,
      "responsePayload" = NULL,
      "syncedAt" = NULL,
      "errorMessage" = 'Corrected 2026-08-15 (Story 9-1): this record''s previous ''synced'' status and posOrderId were fabricated by a bug that synthesized a plausible-looking transaction ID without ever contacting Idealpos. No real Idealpos adapter has ever existed in this codebase; this order was never actually submitted to or confirmed by Idealpos.'
    WHERE status = 'synced'
  `;

  const ordersCorrected = await prisma.$executeRaw`
    UPDATE "Order" o
    SET "posSyncStatus" = CASE
        WHEN COALESCE(
          (SELECT p."adapterType"::text FROM "POSSyncRecord" p WHERE p."orderId" = o.id),
          v."posAdapterType"::text
        ) = 'none'
          THEN 'not_applicable'::"POSSyncStatus"
        ELSE 'unsupported'::"POSSyncStatus"
      END
    FROM "Venue" v
    WHERE o."venueId" = v.id
      AND o."posSyncStatus" = 'synced'
  `;

  return { recordsCorrected, ordersCorrected };
}

/* istanbul ignore next -- exercised by integration test; this guard only
 * prevents accidental execution as a side effect of a plain module import
 * (e.g. from a test file that imports the function above). */
if (require.main === module) {
  const prisma = new PrismaClient();
  correctFabricatedPosSyncRecords(prisma)
    .then((result) => {
      console.log(JSON.stringify(result));
    })
    .catch((e: unknown) => {
      console.error(e);
      process.exit(1);
    })
    .finally(() => prisma.$disconnect());
}
