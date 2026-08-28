/**
 * CLI wrapper for `src/pos-sync/sync-pos-catalog.ts` (see that module for
 * the actual plan/apply logic and its tests). Fail-closed CLI: dry-run is
 * the default with NO flags at all, matching `apply-plu-mapping.ts`'s and
 * `set-menu-item-pos-product-code.ts`'s established convention in this
 * directory.
 *
 * Supersedes `import-idealpos-catalog.ts` as the way new IdealPOS
 * candidates enter Verdura: that script mirrored the ENTIRE non-discontinued
 * StockItems catalog into "Imported from IdealPOS (pending review)"
 * `MenuItem` rows, which then competed with curated items for
 * `MenuItem.posProductCode`'s uniqueness constraint (the manual
 * "clear-staging-then-set-curated" dance `apply-plu-mapping.ts` exists to
 * resolve). This script instead upserts into `PosProductIdentity` — never
 * a `MenuItem` row — so a candidate can be synced, reclassified, and
 * reviewed indefinitely without ever touching that constraint. It also
 * excludes several department categories at the SQL level (see the export
 * query below) that were found, this session, to be out of scope for
 * Verdura's own food menu: modifier/addon departments, other/legacy
 * takeaway schemes, third-party delivery platforms, a legacy pre-rebrand
 * brand ("Sila"), and drinks (deferred to a separate future pass).
 *
 * Usage (run from apps/api/):
 *   ORG_ID=<organization-id> STOCKITEMS_EXPORT_PATH=<path> \
 *     npx ts-node prisma/scripts/sync-pos-catalog.ts --dry-run
 *   ... --apply
 *
 * Input format: the plain-text output of the query below, run via
 * sqlcmd's default column-aligned text output (two header lines, then one
 * row per item). `Description` may itself contain spaces; the 5 trailing
 * columns are always present and numeric (or the literal `NULL` for
 * PriceCentsFromPos when IdealPOS has no live price row for this item).
 *
 *   SELECT
 *     s.Code,
 *     s.Description,
 *     CAST(siv.Value * 100 AS INT) AS PriceCentsFromPos,
 *     CASE WHEN EXISTS (
 *       SELECT 1 FROM TouchscreenGridDetails g WHERE g.StockItemID = s.ID
 *     ) THEN 1 ELSE 0 END AS HasAnyGridPlacement,
 *     CASE WHEN EXISTS (
 *       SELECT 1 FROM TouchscreenGridDetails g
 *       WHERE g.StockItemID = s.ID AND g.Visible = 1
 *     ) THEN 1 ELSE 0 END AS HasVisibleGridPlacement,
 *     CASE WHEN s.DepartmentCode = 41 THEN 1 ELSE 0 END AS IsDepartment41,
 *     CASE WHEN s.DepartmentCode = 41 AND EXISTS (
 *       SELECT 1 FROM StockItems t
 *       WHERE t.DepartmentCode <> 41 AND t.Description = s.Description AND t.ID <> s.ID
 *     ) THEN 1 ELSE 0 END AS HasDept41TwinSameDescription
 *   FROM StockItems s
 *   LEFT JOIN StockItemsValue siv
 *     ON siv.StockItemID = s.ID AND siv.Type = 1 AND siv.Level = 1
 *   WHERE s.DepartmentCode NOT IN (
 *     2, 5, 7, 36, 40, 42, 100, 10000,   -- operational/junk/misc departments
 *     17, 18, 20, 24, 27,                -- modifier/addon departments
 *     19, 21, 22, 23, 25,                -- other/legacy takeaway-scheme departments (not "Verdura Takeaway")
 *     26, 29,                            -- third-party delivery platforms (DoorDash, Uber Eats)
 *     4, 37,                             -- legacy pre-rebrand brand departments ("Sila")
 *     9, 10, 11, 12, 13, 14, 15, 16, 35, 38 -- drinks departments, deferred to a later pass
 *   )
 *   ORDER BY s.Code;
 *
 * This exact department-code list is a decision recorded for this venue
 * only (DL-107 continuity, Menu Management architecture) — re-verify
 * against a fresh `Departments` export before reusing it for any other
 * venue.
 */
import { readFileSync } from 'fs';
import { PrismaClient } from '@prisma/client';
import {
  applyPosCatalogSync,
  planPosCatalogSync,
  PosCatalogSourceRow,
} from '../../src/pos-sync/sync-pos-catalog';

const prisma = new PrismaClient();

interface ParseResult {
  rows: PosCatalogSourceRow[];
  skipped: { line: string; reason: string }[];
}

const TRAILING_COLUMN_COUNT = 5; // PriceCentsFromPos, HasAnyGridPlacement, HasVisibleGridPlacement, IsDepartment41, HasDept41TwinSameDescription

export function parsePosCatalogExport(raw: string): ParseResult {
  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.trimEnd())
    .filter((l) => l.length > 0);

  const rows: PosCatalogSourceRow[] = [];
  const skipped: { line: string; reason: string }[] = [];

  for (const line of lines) {
    if (line.startsWith('Code ') || line.startsWith('----') || line.startsWith('<Objs') || line.startsWith('#<')) {
      continue;
    }

    const tokens = line.split(/\s+/);
    if (tokens.length < 2 + TRAILING_COLUMN_COUNT) {
      skipped.push({ line, reason: 'too few columns' });
      continue;
    }

    const codeToken = tokens[0];
    const code = Number(codeToken);
    if (!Number.isInteger(code) || String(code) !== codeToken) {
      skipped.push({ line, reason: `non-integer Code: "${codeToken}"` });
      continue;
    }

    const trailing = tokens.slice(tokens.length - TRAILING_COLUMN_COUNT);
    const [priceToken, hasAnyToken, hasVisibleToken, isDept41Token, hasTwinToken] = trailing;

    const parseBit = (token: string, label: string): boolean | null => {
      if (token === '1') return true;
      if (token === '0') return false;
      skipped.push({ line, reason: `non-boolean ${label}: "${token}"` });
      return null;
    };
    const hasAnyGridPlacement = parseBit(hasAnyToken, 'HasAnyGridPlacement');
    const hasVisibleGridPlacement = parseBit(hasVisibleToken, 'HasVisibleGridPlacement');
    const isDepartment41 = parseBit(isDept41Token, 'IsDepartment41');
    const hasDepartment41TwinSameDescription = parseBit(hasTwinToken, 'HasDept41TwinSameDescription');
    if (
      hasAnyGridPlacement === null ||
      hasVisibleGridPlacement === null ||
      isDepartment41 === null ||
      hasDepartment41TwinSameDescription === null
    ) {
      continue;
    }

    const priceCentsFromPos = priceToken === 'NULL' ? null : Number(priceToken);
    if (priceCentsFromPos !== null && !Number.isFinite(priceCentsFromPos)) {
      skipped.push({ line, reason: `non-numeric PriceCentsFromPos: "${priceToken}"` });
      continue;
    }

    const descriptionEnd = tokens.length - TRAILING_COLUMN_COUNT;
    const description = tokens.slice(1, descriptionEnd).join(' ').trim();
    if (!description) {
      skipped.push({ line, reason: 'empty Description' });
      continue;
    }

    rows.push({
      nativeCode: codeToken,
      nativeDescription: description,
      priceCentsFromPos,
      evidence: {
        hasAnyGridPlacement,
        hasVisibleGridPlacement,
        isDepartment41,
        hasDepartment41TwinSameDescription,
      },
    });
  }

  return { rows, skipped };
}

const KNOWN_FLAGS = new Set(['--dry-run', '--apply']);

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

  const organizationId = process.env.ORG_ID;
  const exportPath = process.env.STOCKITEMS_EXPORT_PATH;
  if (!organizationId) throw new Error('ORG_ID env var is required');
  if (!exportPath) throw new Error('STOCKITEMS_EXPORT_PATH env var is required');

  const organization = await prisma.organization.findUnique({ where: { id: organizationId } });
  if (!organization) throw new Error(`Organization ${organizationId} not found`);

  const raw = readFileSync(exportPath, 'utf-8');
  const { rows, skipped } = parsePosCatalogExport(raw);

  console.log(`Parsed ${rows.length} candidate row(s), skipped ${skipped.length}.`);
  for (const s of skipped) console.log(`  skipped: ${s.reason} — "${s.line}"`);

  const prefix = APPLY ? '' : '[DRY RUN] ';
  if (!APPLY) {
    const plan = await planPosCatalogSync(prisma, organizationId, rows);
    console.log(
      `${prefix}Would create ${plan.summary.toCreate}, update ${plan.summary.toUpdate}, ` +
        `leave ${plan.summary.unchanged} unchanged, mark ${plan.summary.toMarkSourceMissing} source_missing.`,
    );
    console.log(`${prefix}No write performed.`);
    return;
  }

  const applied = await applyPosCatalogSync(prisma, organizationId, rows);
  console.log(
    `Applied. Created ${applied.summary.toCreate}, updated ${applied.summary.toUpdate}, ` +
      `left ${applied.summary.unchanged} unchanged, marked ${applied.summary.toMarkSourceMissing} source_missing.`,
  );
}

main()
  .catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
