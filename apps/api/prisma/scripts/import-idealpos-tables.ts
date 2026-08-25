/**
 * Non-destructive, non-guessing importer: mirrors a live IdealPOS
 * `TableMapSetups` export into Verdura `Table` rows for a given venue.
 *
 * Why this exists: `Table.posTableCode` is what the Bridge's
 * `OrderValidator`/`FindTableByCaption` actually matches an outgoing order
 * against (`IdealposReadRepository.GetTables()` in the separate
 * `IdealposBridge` project). Guessing this value risks a real order landing
 * on the wrong physical table, or being rejected outright. This script
 * instead takes a read-only export of the venue's *own* live IdealPOS table
 * map (the actual source of truth for how tables are identified there) and
 * mirrors it verbatim — the real `Caption` as both `tableNumber` and
 * `posTableCode`, the real `Seats` as `capacity`.
 *
 * IMPORTANT: `TableMapSetups` can exist in more than one database on the
 * same IdealPOS SQL Server instance (confirmed 2026-08-26: a POSServer copy
 * and an IPSTransaction copy existed simultaneously for the same venue, with
 * different column names AND different Caption population). Always export
 * from the exact database the Bridge's own `IpsConnection` connection string
 * points at (its `Database=` value), never a different copy that happens to
 * share the table name — confirm this before trusting any export.
 *
 * Usage (run once per venue, safe to re-run):
 *   VENUE_ID=<venue-id> TABLES_EXPORT_PATH=<path> \
 *     npx ts-node apps/api/prisma/scripts/import-idealpos-tables.ts
 *
 * Input format: the plain-text output of
 *   SELECT Code, Type, [Index], Caption, Seats
 *   FROM TableMapSetups WHERE Code = <the real venue floor-plan area code>
 *     AND Type = <the real dine-in table Type value> AND LEN(Caption) > 0
 *   ORDER BY [Index];
 * run via sqlcmd's default column-aligned text output (two header lines,
 * then one row per table). Rows with Seats = 0 are skipped (not a real
 * seatable dine-in table) and reported, never silently included.
 */
import { readFileSync } from 'fs';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface ParsedTableRow {
  code: number;
  type: number;
  index: number;
  caption: string;
  seats: number;
}

function parseTablesExport(raw: string): { rows: ParsedTableRow[]; skipped: { line: string; reason: string }[] } {
  const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const rows: ParsedTableRow[] = [];
  const skipped: { line: string; reason: string }[] = [];

  for (const line of lines) {
    if (/^-+\s/.test(line) || /^Code\s+Type\s+Index\s+Caption\s+Seats/i.test(line)) continue; // header/separator
    const tokens = line.trim().split(/\s+/);
    if (tokens.length < 5) {
      skipped.push({ line, reason: 'fewer than 5 columns' });
      continue;
    }
    // Fixed columns from the right: Seats is last, Caption is the token(s)
    // before it (may itself be numeric-looking but is still Caption, not a
    // count), Index/Type/Code are the first three tokens.
    const code = Number(tokens[0]);
    const type = Number(tokens[1]);
    const index = Number(tokens[2]);
    const seats = Number(tokens[tokens.length - 1]);
    const caption = tokens.slice(3, tokens.length - 1).join(' ');

    if (!Number.isInteger(code) || !Number.isInteger(type) || !Number.isInteger(index) || !Number.isInteger(seats)) {
      skipped.push({ line, reason: 'non-integer Code/Type/Index/Seats' });
      continue;
    }
    if (caption.trim().length === 0) {
      skipped.push({ line, reason: 'blank Caption - cannot map without a real identifier' });
      continue;
    }
    if (seats === 0) {
      skipped.push({ line, reason: 'Seats = 0 - not a real seatable dine-in table' });
      continue;
    }
    rows.push({ code, type, index, caption: caption.trim(), seats });
  }
  return { rows, skipped };
}

async function main() {
  const venueId = process.env['VENUE_ID'];
  const exportPath = process.env['TABLES_EXPORT_PATH'];
  if (!venueId) throw new Error('VENUE_ID env var is required');
  if (!exportPath) throw new Error('TABLES_EXPORT_PATH env var is required');

  const venue = await prisma.venue.findUniqueOrThrow({ where: { id: venueId } });
  const raw = readFileSync(exportPath, 'utf-8');
  const { rows, skipped } = parseTablesExport(raw);

  const results: { tableNumber: string; capacity: number; posTableCode: string }[] = [];
  for (const row of rows) {
    const table = await prisma.table.upsert({
      where: { venueId_tableNumber: { venueId: venue.id, tableNumber: row.caption } },
      create: {
        venueId: venue.id,
        tableNumber: row.caption,
        capacity: row.seats,
        posTableCode: row.caption,
        sortOrder: row.index,
      },
      update: { posTableCode: row.caption, capacity: row.seats },
    });
    results.push({ tableNumber: table.tableNumber, capacity: table.capacity, posTableCode: table.posTableCode ?? '' });
  }

  console.log(
    JSON.stringify(
      {
        venueId: venue.id,
        parsedRows: rows.length,
        createdOrUpdated: results.length,
        skipped: skipped.length,
        skippedSample: skipped.slice(0, 5),
        tables: results,
      },
      null,
      2,
    ),
  );
}

main().finally(() => prisma.$disconnect());
