#!/usr/bin/env bash
# Story 1.9 evaluator dependency provisioning (FREEZE CANDIDATE — NOT YET FROZEN).
#
# Produces the node_modules root the evaluator links (--node-modules) for ONE candidate commit,
# in a disposable directory, without touching any repository checkout.
#
#   provision.sh <repo> <anchor-commit> <objective-path> <candidate-commit> <out-dir>
#
#   <objective-path> is the objective as committed at <anchor-commit> (the dependency check is taken
#   from there, never from the candidate). <out-dir> must not exist; it is created.
#
# Fails closed (non-zero exit and an <out-dir>/REFUSED marker; never use that directory) unless:
#   1. node is major 22 (the repository-pinned engine: .nvmrc, engines ">=22 <23");
#   2. the candidate's package-lock.json is byte-identical to the baseline's, or passes the anchored
#      objective's supertest-dependency-delta check (no unapproved package is ever installed);
#   3. npm ci --ignore-scripts succeeds and leaves package-lock.json byte-identical;
#   4. the anchored supertest-runtime-resolution check passes on the installed tree.
# Network: npm ci fetches from the registry unless the npm cache already holds every tarball; every
# tarball is verified against the lockfile's integrity. Install scripts never run (--ignore-scripts);
# the evaluator's setup step generates the Prisma client.
set -euo pipefail
[ $# -eq 5 ] || { echo "usage: provision.sh <repo> <anchor-commit> <objective-path> <candidate-commit> <out-dir>" >&2; exit 2; }
REPO=$1; ANCHOR=$2; OBJ=$3; CAND=$4; OUT=$5
[ -e "$OUT" ] && { echo "REFUSED: $OUT already exists" >&2; exit 2; }
MAJOR=$(node -p 'process.versions.node.split(".")[0]')
[ "$MAJOR" = "22" ] || { echo "REFUSED: node $(node --version); the repository pins Node 22" >&2; exit 2; }
BASE=$(node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(0,"utf8")).baseline)' < <(git -C "$REPO" show "$ANCHOR:$OBJ"))
mkdir -p "$OUT/tree"
git -C "$REPO" archive "$CAND" | tar -x -C "$OUT/tree"
check() { # <check-id> <cwd relative to the tree>
  local script; script=$(git -C "$REPO" show "$ANCHOR:$OBJ" | node -e 'const o=JSON.parse(require("fs").readFileSync(0,"utf8")); const c=o.checks.find((x)=>x.id===process.argv[1]); if(!c) process.exit(3); process.stdout.write(c.args[2]);' "$1")
  (cd "$OUT/tree/$2" && node -e "$script")
}
if git -C "$REPO" show "$BASE:package-lock.json" | cmp -s - "$OUT/tree/package-lock.json"; then
  echo "lockfile: byte-identical to the baseline $BASE"
else
  echo "lockfile: differs from the baseline; applying the anchored supertest-dependency-delta check"
  check supertest-dependency-delta . || { echo "unapproved dependency change" > "$OUT/REFUSED"; echo "REFUSED: unapproved dependency change; nothing installed" >&2; exit 1; }
fi
BEFORE=$(shasum -a 256 "$OUT/tree/package-lock.json" | cut -d' ' -f1)
(cd "$OUT/tree" && npm ci --ignore-scripts --no-audit --no-fund) > "$OUT/npm-ci.log" 2>&1 || { echo "npm ci failed" > "$OUT/REFUSED"; echo "REFUSED: npm ci failed (see $OUT/npm-ci.log)" >&2; exit 1; }
AFTER=$(shasum -a 256 "$OUT/tree/package-lock.json" | cut -d' ' -f1)
[ "$BEFORE" = "$AFTER" ] || { echo "npm ci changed package-lock.json" > "$OUT/REFUSED"; echo "REFUSED: npm ci changed package-lock.json" >&2; exit 1; }
check supertest-runtime-resolution apps/api || { echo "runtime resolution mismatch" > "$OUT/REFUSED"; echo "REFUSED: installed versions differ from the candidate lockfile" >&2; exit 1; }
echo "node $(node --version), npm $(npm --version); lockfile sha256 $AFTER"
echo "NODE_MODULES=$OUT/tree/node_modules"
