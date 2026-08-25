/**
 * Non-destructive, non-guessing importer: mirrors a live IdealPOS
 * `StockItems` export into Verdura `MenuItem` rows for a given organization.
 *
 * Why this exists: populating a real venue's menu by hand-typing names/
 * prices risks getting real business data wrong. This script instead takes
 * an export of the venue's *own* live IdealPOS product catalog (the actual
 * source of truth for what that POS already sells) and mirrors it verbatim
 * — real `Description` as `title`, real `Code`/`StockItemCode` as
 * `posProductCode`. It never invents or guesses a name or price.
 *
 * Every imported item is created with `isAvailable: false` and
 * `priceCents: 0`. This is deliberate, not a bug: the raw StockItems export
 * has no price column, and the export mixes genuine sellable dishes with
 * modifiers/packaging/misc rows (e.g. "Bag", "Lemon slice", "Extra
 * Jalapino"). Deciding which rows are real menu items, and at what price,
 * is a human curation step — a human must review the imported rows and
 * explicitly set `priceCents`/`isAvailable` (or add a `MenuItemVenueOverride`)
 * for each item that should actually go live. Nothing this script creates
 * is orderable until that review happens.
 *
 * Usage (run once per organization, safe to re-run):
 *   ORG_ID=<organization-id> STOCKITEMS_EXPORT_PATH=<path> \
 *     npx ts-node apps/api/scripts/import-idealpos-catalog.ts
 *
 * Input format: the plain-text output of
 *   SELECT Code, StockItemCode, Description, DepartmentCode, Discontinue,
 *          HasVariants, Condiment, Indirect
 *   FROM StockItems WHERE Discontinue = 0 ORDER BY Code;
 * run via sqlcmd's default column-aligned text output (two header lines,
 * then one row per item, whitespace-column-separated, `Description` may
 * itself contain spaces). Only rows with Discontinue = 0 and a clean
 * integer `Code` are imported; anything else (e.g. IdealPOS's own
 * "Deleted Deleted Deleted Stock Items" placeholder row) is skipped and
 * reported, never guessed at.
 */
import { readFileSync } from 'fs';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const IMPORT_CATEGORY_NAME = 'Imported from IdealPOS (pending review)';

interface ParsedRow {
  code: number;
  description: string;
}

interface ParseResult {
  rows: ParsedRow[];
  skipped: { line: string; reason: string }[];
}

export function parseStockItemsExport(raw: string): ParseResult {
  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.trimEnd())
    .filter((l) => l.length > 0);

  const rows: ParsedRow[] = [];
  const skipped: { line: string; reason: string }[] = [];

  for (const line of lines) {
    // Skip the two sqlcmd header lines ("Code StockItemCode ..." and the
    // "---- ---" underline) and any stray PowerShell CLIXML wrapper lines
    // that can appear if the export was captured over a remote session.
    if (line.startsWith('Code ') || line.startsWith('----') || line.startsWith('<Objs') || line.startsWith('#<')) {
      continue;
    }

    const tokens = line.split(/\s+/);
    // Minimum: Code, StockItemCode, >=1 Description word, DepartmentCode,
    // Discontinue, HasVariants, Condiment, Indirect.
    if (tokens.length < 8) {
      skipped.push({ line, reason: 'too few columns' });
      continue;
    }

    // The trailing 5 columns (DepartmentCode, Discontinue, HasVariants,
    // Condiment, Indirect) are always present and numeric/NULL; everything
    // between StockItemCode (index 1) and DepartmentCode is the
    // Description, which may itself contain spaces.
    const discontinue = tokens[tokens.length - 4];
    const codeToken = tokens[0];

    const code = Number(codeToken);
    if (!Number.isInteger(code) || String(code) !== codeToken) {
      // Covers IdealPOS's own "Deleted Deleted Deleted Stock Items ..."
      // placeholder row and any other non-numeric Code — never guessed at.
      skipped.push({ line, reason: `non-integer Code: "${codeToken}"` });
      continue;
    }

    if (discontinue !== '0') {
      skipped.push({ line, reason: `Discontinue=${discontinue}` });
      continue;
    }

    const departmentCodeIndex = tokens.length - 5;
    const description = tokens.slice(2, departmentCodeIndex).join(' ').trim();
    if (!description) {
      skipped.push({ line, reason: 'empty Description' });
      continue;
    }

    rows.push({ code, description });
  }

  return { rows, skipped };
}

async function main() {
  const organizationId = process.env.ORG_ID;
  const exportPath = process.env.STOCKITEMS_EXPORT_PATH;
  if (!organizationId) throw new Error('ORG_ID env var is required');
  if (!exportPath) throw new Error('STOCKITEMS_EXPORT_PATH env var is required');

  const organization = await prisma.organization.findUnique({ where: { id: organizationId } });
  if (!organization) throw new Error(`Organization ${organizationId} not found`);

  const owner = await prisma.staff.findFirst({
    where: { organizationId, deletedAt: null },
    orderBy: { createdAt: 'asc' },
  });
  if (!owner) throw new Error(`No Staff row found for organization ${organizationId} to attribute createdById`);

  const raw = readFileSync(exportPath, 'utf-8');
  const { rows, skipped } = parseStockItemsExport(raw);

  // No unique(organizationId, name) index exists on Category — find-or-create
  // by hand to stay idempotent across re-runs.
  const category =
    (await prisma.category.findFirst({ where: { organizationId, name: IMPORT_CATEGORY_NAME } })) ??
    (await prisma.category.create({
      data: {
        organizationId,
        name: IMPORT_CATEGORY_NAME,
        description:
          'Auto-imported from the live IdealPOS StockItems catalog. Not reviewed — do not enable without checking each item.',
        isActive: true,
        createdById: owner.id,
      },
    }));

  let created = 0;
  let updated = 0;

  for (const row of rows) {
    const posProductCode = String(row.code);
    const existing = await prisma.menuItem.findUnique({
      where: {
        organizationId_posProductCode: { organizationId, posProductCode },
      },
    });

    if (existing) {
      // Idempotent: never overwrite an item a human may have already
      // reviewed/edited. Only the immutable identity fields are re-affirmed.
      if (existing.title !== row.description) {
        // Source description changed upstream in IdealPOS; leave the
        // Verdura-visible title alone (a human may have already curated
        // it) but do not silently drop the discrepancy either — surface it.
        // eslint-disable-next-line no-console
        console.warn(
          `posProductCode=${posProductCode}: IdealPOS description is now "${row.description}" but Verdura MenuItem title is "${existing.title}" — left unchanged, review manually.`,
        );
      }
      updated++;
      continue;
    }

    await prisma.menuItem.create({
      data: {
        organizationId,
        categoryId: category.id,
        title: row.description,
        description: row.description,
        priceCents: 0,
        nutritionalDetails: {},
        isAvailable: false,
        sortOrder: row.code,
        posProductCode,
        createdById: owner.id,
      },
    });
    created++;
  }

  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify(
      {
        organizationId,
        categoryId: category.id,
        parsedRows: rows.length,
        created,
        alreadyPresent: updated,
        skipped: skipped.length,
        skippedSample: skipped.slice(0, 5),
      },
      null,
      2,
    ),
  );
}

if (require.main === module) {
  main()
    .catch((e) => {
      // eslint-disable-next-line no-console
      console.error(e);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
