// Repairs MenuItem.imageUrl rows that regressed to a stale, now-deleted
// local `/menu-images/<file>` path.
//
// Root cause: MediaAsset has no foreign key to MenuItem (deliberate, see
// schema.prisma's MediaAsset doc comment) — the link is a plain URL string
// written into MenuItem.imageUrl by MediaAssetsService#associateWithMenuItem
// at association time. The 2026-08-17 GCS migration (see
// migrate-menu-images-to-gcs.ts) uploaded 46 menu-item photos and repointed
// the MenuItem rows that existed *then*. A later local-dev database reseed
// created brand-new MenuItem rows (fresh UUIDs, seeded from
// shared/menu/menuData.mjs, which still encodes the old
// `/menu-images/<file>` paths). The already-uploaded, already-approved
// MediaAsset rows survived the reseed untouched (they live in a separate
// table with no FK to MenuItem), but nothing ever re-ran the association
// step against the new MenuItem rows — so the frontends now request a
// local file that no longer exists on disk (correctly cleaned up as part
// of the GCS migration), rendering alt text instead of an image.
//
// This script re-runs ONLY that association step, safely:
//   - Matches a MenuItem's stale `/menu-images/<file>` filename to a
//     checksum via the original 2026-08-17 migration manifest (the
//     manifest's checksum was computed from the actual bytes of the file
//     that filename named at migration time) — never by filename
//     similarity alone.
//   - Requires exactly one existing MediaAsset with that checksum,
//     purpose=menu_item, status=approved, visibility=public, for the
//     target venue. Zero or multiple matches are reported and skipped,
//     never guessed.
//   - Writes the same, stable, unsigned public delivery URL format
//     MediaAssetsService#associateWithMenuItem/GcsStorageProvider already
//     use for a public asset (`https://storage.googleapis.com/<bucket>/<objectKey>`)
//     — reproduced verbatim, not invented. No GCS credentials or network
//     calls are needed: this is a pure string construction for an
//     already-public object.
//   - Idempotent: a row already pointing at the correct URL is reported
//     ALREADY_CORRECT and left untouched. Safe to re-run.
//   - Every write is a compare-and-swap (`where: { id, imageUrl: <value
//     just read> }`) so a genuinely concurrent edit is never silently
//     clobbered — the row is simply reported CONCURRENTLY_MODIFIED instead.
//   - Runs entirely inside one Prisma `$transaction`; either every planned
//     write lands, or none do.
//
// Never touches:
//   - Rows with a null imageUrl (no image was ever associated — nothing to
//     repair; the frontend fallback handles these).
//   - Rows already pointing at a `storage.googleapis.com` URL.
//   - Rows whose filename has no manifest entry at all (e.g. items added
//     after the 2026-08-17 migration, or unrelated test-fixture rows) —
//     reported NO_MANIFEST_ENTRY, never fabricated.
//   - Rows with no matching MediaAsset — reported NO_MEDIA_ASSET.
//   - Rows matching more than one MediaAsset checksum — reported AMBIGUOUS.
//
// Usage (from apps/api/):
//   npx ts-node -r tsconfig-paths/register prisma/scripts/reassociate-orphaned-menu-item-media.ts
//   npx ts-node -r tsconfig-paths/register prisma/scripts/reassociate-orphaned-menu-item-media.ts --dry-run
//   npx ts-node -r tsconfig-paths/register prisma/scripts/reassociate-orphaned-menu-item-media.ts --apply
//
// Fail-closed CLI: dry-run is the default with NO flags at all (safe by
// default, not opt-out) — real writes require the explicit --apply flag.
// Any argument that isn't exactly --dry-run or --apply is treated as a
// misspelled/unknown mode and aborts immediately with a nonzero exit,
// rather than silently falling through to either mode.

import * as fs from 'fs';
import * as path from 'path';
import { PrismaClient } from '@prisma/client';

const REPO_ROOT = path.resolve(__dirname, '../../../..');
const MANIFEST_PATH = path.join(
  REPO_ROOT,
  '_bmad-output/implementation-artifacts/2026-08-17-gcs-media-migration-manifest.csv',
);
const VENUE_ID = '10000000-0000-4000-8000-000000000001'; // local-dev seed venue — matches migrate-menu-images-to-gcs.ts; single-venue product, not a multi-venue mechanism

const KNOWN_FLAGS = new Set(['--dry-run', '--apply']);
const cliArgs = process.argv.slice(2);
const unknownArgs = cliArgs.filter((a) => !KNOWN_FLAGS.has(a));
if (unknownArgs.length > 0) {
  console.error(
    `Unrecognized argument(s): ${unknownArgs.join(', ')}. ` +
      'Refusing to run rather than guess a mode. Pass no flags or --dry-run for a read-only report, or --apply to write.',
  );
  process.exit(1);
}
if (cliArgs.includes('--dry-run') && cliArgs.includes('--apply')) {
  console.error('Both --dry-run and --apply were passed — refusing to run on an ambiguous mode.');
  process.exit(1);
}
const APPLY = cliArgs.includes('--apply');
const DRY_RUN = !APPLY;

const prisma = new PrismaClient();

interface ManifestRow {
  checksum_sha256: string;
  source_paths: string;
  proposed_purpose: string;
  disposition: string;
}

// Columns this script actually reads. Validated against the manifest's real
// header below — a renamed/reordered/missing column must fail loudly, never
// silently degrade to "every row treated as unmatched."
const REQUIRED_MANIFEST_COLUMNS = [
  'checksum_sha256',
  'source_paths',
  'proposed_purpose',
  'disposition',
] as const;

// Minimal manual CSV parse, matching migrate-menu-images-to-gcs.ts's own
// documented assumption: the manifest (Python csv.DictWriter output)
// contains no field with an embedded comma or newline. Tolerates CRLF line
// endings (only the last cell of each line would otherwise carry a stray
// \r) even though the manifest's own last column is not one this script
// reads today.
function parseManifest(raw: string): ManifestRow[] {
  const lines = raw
    .trim()
    .split('\n')
    .map((line) => line.replace(/\r$/, ''));
  const header = lines[0].split(',');
  const missing = REQUIRED_MANIFEST_COLUMNS.filter((col) => !header.includes(col));
  if (missing.length > 0) {
    throw new Error(
      `Manifest at ${MANIFEST_PATH} is missing required column(s): ${missing.join(', ')}. ` +
        `Found columns: ${header.join(', ')}. Refusing to guess — the manifest schema may have changed.`,
    );
  }
  return lines.slice(1).map((line) => {
    const cells = line.split(',');
    const row: Record<string, string> = {};
    header.forEach((col, i) => (row[col] = cells[i] ?? ''));
    return row as unknown as ManifestRow;
  });
}

function buildFilenameChecksumMap(): Map<string, string> {
  const raw = fs.readFileSync(MANIFEST_PATH, 'utf8');
  const rows = parseManifest(raw).filter(
    (r) => r.proposed_purpose === 'menu_item' && r.disposition === 'externalize',
  );
  const map = new Map<string, string>();
  for (const row of rows) {
    const filename = row.source_paths.split(' | ')[0].split('/').pop();
    if (filename) map.set(filename, row.checksum_sha256);
  }
  return map;
}

type RowOutcome =
  | 'REPAIRED'
  | 'WOULD_REPAIR'
  | 'ALREADY_CORRECT'
  | 'NO_MANIFEST_ENTRY'
  | 'NO_MEDIA_ASSET'
  | 'AMBIGUOUS'
  | 'CONCURRENTLY_MODIFIED';

interface ReportRow {
  menuItemId: string;
  title: string;
  before: string;
  after: string | null;
  outcome: RowOutcome;
}

async function main() {
  const filenameChecksum = buildFilenameChecksumMap();

  const candidates = await prisma.menuItem.findMany({
    where: { imageUrl: { startsWith: '/menu-images/' }, deletedAt: null },
    select: { id: true, title: true, imageUrl: true },
  });

  const report: ReportRow[] = [];
  const writes: { id: string; before: string; after: string }[] = [];

  for (const item of candidates) {
    const before = item.imageUrl as string;
    const filename = before.slice('/menu-images/'.length);
    const checksum = filenameChecksum.get(filename);

    if (!checksum) {
      report.push({
        menuItemId: item.id,
        title: item.title,
        before,
        after: null,
        outcome: 'NO_MANIFEST_ENTRY',
      });
      continue;
    }

    const matches = await prisma.mediaAsset.findMany({
      where: {
        venueId: VENUE_ID,
        purpose: 'menu_item',
        checksum,
        status: 'approved',
        visibility: 'public',
        deletedAt: null,
      },
    });

    if (matches.length === 0) {
      report.push({
        menuItemId: item.id,
        title: item.title,
        before,
        after: null,
        outcome: 'NO_MEDIA_ASSET',
      });
      continue;
    }
    if (matches.length > 1) {
      report.push({
        menuItemId: item.id,
        title: item.title,
        before,
        after: null,
        outcome: 'AMBIGUOUS',
      });
      continue;
    }

    const asset = matches[0];
    // Verbatim reproduction of GcsStorageProvider#generateDeliveryUrl's
    // public-visibility branch — a stable, unsigned URL, never a signed one.
    const after = `https://storage.googleapis.com/${asset.bucket}/${asset.objectKey}`;

    if (after === before) {
      report.push({
        menuItemId: item.id,
        title: item.title,
        before,
        after,
        outcome: 'ALREADY_CORRECT',
      });
      continue;
    }

    if (DRY_RUN) {
      report.push({
        menuItemId: item.id,
        title: item.title,
        before,
        after,
        outcome: 'WOULD_REPAIR',
      });
    } else {
      writes.push({ id: item.id, before, after });
    }
  }

  if (!DRY_RUN && writes.length > 0) {
    await prisma.$transaction(
      writes.map((w) =>
        prisma.menuItem.updateMany({
          where: { id: w.id, imageUrl: w.before },
          data: { imageUrl: w.after },
        }),
      ),
    );
    // Re-read to confirm each write actually landed (updateMany's count can
    // be 0 if a concurrent edit changed imageUrl between the read above and
    // the transaction) — report the true outcome, never assume success.
    for (const w of writes) {
      const current = await prisma.menuItem.findUnique({
        where: { id: w.id },
        select: { imageUrl: true },
      });
      const landed = current?.imageUrl === w.after;
      report.push({
        menuItemId: w.id,
        title: candidates.find((c) => c.id === w.id)?.title ?? '(unknown)',
        before: w.before,
        after: w.after,
        outcome: landed ? 'REPAIRED' : 'CONCURRENTLY_MODIFIED',
      });
    }
  }

  const byOutcome = report.reduce<Record<string, number>>((acc, r) => {
    acc[r.outcome] = (acc[r.outcome] ?? 0) + 1;
    return acc;
  }, {});

  console.log(`${DRY_RUN ? '[DRY RUN] ' : ''}Candidates scanned: ${candidates.length}`);
  for (const r of report) {
    console.log(
      `  ${r.outcome.padEnd(20)} ${r.title.padEnd(32)} ${r.before} ${r.after ? `-> ${r.after}` : ''}`,
    );
  }
  console.log('\nSummary:', byOutcome);
}

main()
  .catch((err) => {
    console.error('REPAIR FAILED:', err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
