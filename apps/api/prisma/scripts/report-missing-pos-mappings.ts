import { PrismaClient } from '@prisma/client';

/**
 * Operator-facing readiness report for the real IdealPOS PLU/table mapping
 * this integration branch's chosen IdealposOrderDispatcherService requires
 * before a venue's `posAdapterType: 'api'` orders can actually reach the
 * real Bridge (`MenuItem.posProductCode` / `Table.posTableCode` — see
 * their own schema doc comments). Read-only: never fabricates, guesses, or
 * writes a mapping — it only reports what is missing, so an operator can
 * populate the real values from a live IdealPOS discovery session before
 * attempting a real submission. Scoped to venues actually configured for
 * the `api` adapter — a venue on any other adapter type has no mapping
 * requirement and is intentionally excluded from the report.
 */
export interface MissingPosMappingsReport {
  venueId: string;
  venueName: string;
  missingTableMappings: { id: string; tableNumber: string; name: string | null }[];
  missingMenuItemMappings: { id: string; title: string; category: string }[];
}

export async function reportMissingPosMappings(
  prisma: PrismaClient,
  venueId?: string,
): Promise<MissingPosMappingsReport[]> {
  const venues = await prisma.venue.findMany({
    where: { posAdapterType: 'api', ...(venueId ? { id: venueId } : {}) },
    select: { id: true, name: true },
  });

  const reports: MissingPosMappingsReport[] = [];
  for (const venue of venues) {
    const [missingTables, missingMenuItems] = await Promise.all([
      prisma.table.findMany({
        where: { venueId: venue.id, isActive: true, posTableCode: null },
        select: { id: true, tableNumber: true, name: true },
        orderBy: { sortOrder: 'asc' },
      }),
      prisma.menuItem.findMany({
        where: {
          organizationId: (await prisma.venue.findUniqueOrThrow({ where: { id: venue.id } })).organizationId,
          deletedAt: null,
          isAvailable: true,
          posProductCode: null,
        },
        select: { id: true, title: true, category: { select: { name: true } } },
      }),
    ]);

    reports.push({
      venueId: venue.id,
      venueName: venue.name,
      missingTableMappings: missingTables.map((t) => ({ id: t.id, tableNumber: t.tableNumber, name: t.name })),
      missingMenuItemMappings: missingMenuItems.map((m) => ({
        id: m.id,
        title: m.title,
        category: m.category?.name ?? 'Uncategorized',
      })),
    });
  }

  return reports;
}

/** Human-readable rendering matching the "Missing POS mappings" format operators asked for. */
export function formatMissingPosMappingsReport(reports: MissingPosMappingsReport[]): string {
  if (reports.length === 0) return 'No venues are configured for posAdapterType "api" — nothing to report.';

  const lines: string[] = [];
  for (const report of reports) {
    lines.push(`Venue: ${report.venueName} (${report.venueId})`);
    if (report.missingTableMappings.length === 0 && report.missingMenuItemMappings.length === 0) {
      lines.push('  All active tables and available menu items have a configured POS mapping.');
      continue;
    }
    lines.push('  Missing POS mappings:');
    for (const t of report.missingTableMappings) {
      lines.push(`  - Table ${t.tableNumber}${t.name ? ` (${t.name})` : ''} → no posTableCode`);
    }
    for (const m of report.missingMenuItemMappings) {
      lines.push(`  - ${m.title} [${m.category}] → no posProductCode`);
    }
  }
  return lines.join('\n');
}

/* istanbul ignore next -- exercised by unit/integration test; this guard
 * only prevents accidental execution as a side effect of a plain module
 * import (e.g. from a test file that imports the functions above). */
if (require.main === module) {
  const prisma = new PrismaClient();
  const venueIdArg = process.argv[2];
  reportMissingPosMappings(prisma, venueIdArg)
    .then((reports) => {
      console.log(formatMissingPosMappingsReport(reports));
    })
    .catch((e: unknown) => {
      console.error(e);
      process.exit(1);
    })
    .finally(() => prisma.$disconnect());
}
