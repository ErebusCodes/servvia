#!/usr/bin/env bash
# Story 15.1 evaluator provisioning (FREEZE CANDIDATE — NOT YET FROZEN).
#
# Produces, in a disposable directory and without touching any repository checkout, the node_modules
# root the evaluator links (--node-modules; used by the prisma migrate deploy setup step) and verifies
# the Go toolchain and module cache the evaluator is given (--go-root, --go-modcache).
#
#   provision.sh <repo> <anchor-commit> <objective-path> <candidate-commit> <go-root> <go-modcache> <out-dir>
#
# Fails closed (non-zero exit and an <out-dir>/REFUSED marker; never use that directory) unless:
#   1. node is major 22 and npm is exactly 11.17.0 running on it (the repository tooling decision of
#      2026-10-05; obtain npm with ../../story-1-9-test-harness-loopback-binding/provisioning/fetch-npm.sh);
#   2. <go-root>/bin/go reports go1.27.1 (services/core-platform/go.mod) and, offline
#      (GOFLAGS=-mod=readonly GOPROXY=off GOTOOLCHAIN=local GOSUMDB=off), go mod verify passes on the
#      candidate's module against <go-modcache>;
#   3. the candidate's package-lock.json, go.mod and go.sum are byte-identical to the baseline's
#      (Story 15.1 changes no dependency; the objective forbids those files);
#   4. npm ci --ignore-scripts succeeds and leaves package-lock.json byte-identical.
set -euo pipefail
[ $# -eq 7 ] || { echo "usage: provision.sh <repo> <anchor-commit> <objective-path> <candidate-commit> <go-root> <go-modcache> <out-dir>" >&2; exit 2; }
REPO=$1; ANCHOR=$2; OBJ=$3; CAND=$4; GOROOT_IN=$5; MODCACHE=$6; OUT=$7
[ -e "$OUT" ] && { echo "REFUSED: $OUT already exists" >&2; exit 2; }
refuse() { mkdir -p "$OUT"; echo "$1" > "$OUT/REFUSED"; echo "REFUSED: $1" >&2; exit 1; }
MAJOR=$(node -p 'process.versions.node.split(".")[0]')
[ "$MAJOR" = "22" ] || { echo "REFUSED: node $(node --version); the repository pins Node 22" >&2; exit 2; }
NPM_GOT=$(npm --version)
[ "$NPM_GOT" = "11.17.0" ] || { echo "REFUSED: npm $NPM_GOT; provisioning requires exactly npm 11.17.0" >&2; exit 2; }
GO_GOT=$("$GOROOT_IN/bin/go" env GOVERSION)
[ "$GO_GOT" = "go1.27.1" ] || { echo "REFUSED: $GOROOT_IN is $GO_GOT; services/core-platform/go.mod requires go1.27.1" >&2; exit 2; }
BASE=$(git -C "$REPO" show "$ANCHOR:$OBJ" | node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(0,"utf8")).baseline)')
mkdir -p "$OUT/tree"
git -C "$REPO" archive "$CAND" | tar -x -C "$OUT/tree"
for f in package-lock.json services/core-platform/go.mod services/core-platform/go.sum; do
  git -C "$REPO" show "$BASE:$f" | cmp -s - "$OUT/tree/$f" || refuse "$f differs from the baseline $BASE"
done
echo "package-lock.json, go.mod, go.sum: byte-identical to the baseline $BASE"
(cd "$OUT/tree/services/core-platform" && env -i PATH="$GOROOT_IN/bin:/usr/bin:/bin" HOME="$OUT" GOROOT="$GOROOT_IN" GOMODCACHE="$MODCACHE" \
  GOCACHE="$OUT/gocache" GOPATH="$OUT/gopath" GOFLAGS=-mod=readonly GOPROXY=off GOTOOLCHAIN=local GOSUMDB=off GOTELEMETRY=off \
  go mod verify) > "$OUT/go-mod-verify.log" 2>&1 || refuse "go mod verify failed offline against $MODCACHE (see $OUT/go-mod-verify.log)"
echo "go mod verify (offline): $(tail -1 "$OUT/go-mod-verify.log")"
BEFORE=$(shasum -a 256 "$OUT/tree/package-lock.json" | cut -d' ' -f1)
(cd "$OUT/tree" && npm ci --ignore-scripts --no-audit --no-fund) > "$OUT/npm-ci.log" 2>&1 || refuse "npm ci failed (see $OUT/npm-ci.log)"
AFTER=$(shasum -a 256 "$OUT/tree/package-lock.json" | cut -d' ' -f1)
[ "$BEFORE" = "$AFTER" ] || refuse "npm ci changed package-lock.json"
echo "node $(node --version), npm $(npm --version), $GO_GOT; lockfile sha256 $AFTER"
echo "NODE_MODULES=$OUT/tree/node_modules"
