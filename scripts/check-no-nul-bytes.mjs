// Guards against a real corruption bug hit on 2026-08-30: a subagent's Write
// tool call embedded literal 0x00 (NUL) bytes in place of plain ASCII spaces
// inside a template-literal expression in a committed .ts file. `git diff`
// silently classified the file as binary ("Bin 0 -> N bytes") instead of a
// normal text diff, so the corruption was invisible in review until `file
// <path>` reported "data" instead of a text type. A plain `grep -P '\x00'`
// check is NOT a reliable way to catch this on every platform (verified: it
// silently false-negatived on a known-NUL-containing PNG on this machine's
// grep build) -- this script reads every candidate file as raw bytes
// instead, which is the only reliable method.
//
// Scope is deliberately narrow: git-tracked files only (so build output,
// node_modules, and .git itself are never touched -- `git ls-files` already
// excludes them), filtered to text/source extensions (so legitimate binary
// assets -- .jpg/.png/.avif/.svg menu images, etc. -- which routinely contain
// real NUL bytes as normal binary content, are never flagged as a false
// positive).
//
// Usage: `node scripts/check-no-nul-bytes.mjs` (also wired into CI and
// `npm run check:nul-bytes`). Exits 0 if clean, 1 and prints only the
// offending filenames (never file content) if any tracked source file
// contains a NUL byte.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { extname } from 'node:path';

export const SOURCE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.md', '.toml', '.cs', '.json', '.sql', '.csv', '.py',
  '.html', '.css', '.yaml', '.yml', '.txt', '.slnx', '.prisma',
  '.csproj', '.ps1', '.sh', '.conf',
]);

/**
 * Pure scan: given a list of file paths (any paths that exist and are
 * readable -- real files on disk, not necessarily git-tracked), returns the
 * subset that contain at least one 0x00 byte. Kept separate from git/CLI
 * concerns so it can be unit-tested against disposable fixture files without
 * ever needing to stage a corrupt file into this repo's own history.
 */
export function scanFilesForNulBytes(paths) {
  const found = [];
  for (const path of paths) {
    let data;
    try {
      data = readFileSync(path);
    } catch {
      continue; // deleted/renamed between listing and read -- not this script's problem
    }
    if (data.includes(0)) found.push(path);
  }
  return found;
}

export function filterSourceExtensions(paths) {
  return paths.filter((p) => SOURCE_EXTENSIONS.has(extname(p).toLowerCase()));
}

function main() {
  const trackedOutput = execFileSync('git', ['ls-files'], { encoding: 'utf8' });
  const allTracked = trackedOutput.split('\n').filter(Boolean);
  const candidates = filterSourceExtensions(allTracked);
  const offenders = scanFilesForNulBytes(candidates);

  if (offenders.length > 0) {
    console.error(`NUL byte check FAILED: ${offenders.length} tracked source file(s) contain a 0x00 byte:`);
    for (const f of offenders) console.error(`  - ${f}`);
    console.error('\nA NUL byte inside a text/source file usually means write-tool corruption, not intentional content (see this script\'s header comment). Do not try to "fix" it by re-running a fuzzy replace -- open the file, find the exact byte offset, and replace it with the character that was actually intended.');
    process.exitCode = 1;
    return;
  }

  console.log(`NUL byte check passed (${candidates.length} tracked source file(s) scanned, 0 offenders).`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
