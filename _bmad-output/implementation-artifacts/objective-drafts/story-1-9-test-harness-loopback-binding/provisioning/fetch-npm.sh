#!/usr/bin/env bash
# Story 1.9 pinned package manager (FREEZE CANDIDATE — NOT YET FROZEN).
#
#   fetch-npm.sh <out-dir>
#
# Downloads exactly npm 11.17.0 from the npm registry into <out-dir> (which must not exist), verifies the
# tarball against its published sha512 integrity, extracts it and proves it runs under Node 22. Nothing is
# installed globally. It writes <out-dir>/bin/npm, a wrapper that runs the verified npm-cli.js with the
# `node` found on PATH. Put <out-dir>/bin FIRST on PATH, before the Node 22 bin directory (Node 22's own
# bin directory carries its bundled npm 10, which must not win):
#   PATH=<out-dir>/bin:<node22>/bin:$PATH   # npm is 11.17.0, running on Node 22
# Fails closed (non-zero exit) on any mismatch.
set -euo pipefail
[ $# -eq 1 ] || { echo "usage: fetch-npm.sh <out-dir>" >&2; exit 2; }
OUT=$1
VERSION=11.17.0
TARBALL=https://registry.npmjs.org/npm/-/npm-11.17.0.tgz
INTEGRITY=sha512-PurxiZexEHDTE4SSaLI3ZrnbAGiZfeyUcQcxcP5D+hfytNAze/D1IzDuInTn9XVLIbAQUnQuSPXJx02LHjLvQw==
[ -e "$OUT" ] && { echo "REFUSED: $OUT already exists" >&2; exit 2; }
MAJOR=$(node -p 'process.versions.node.split(".")[0]')
[ "$MAJOR" = "22" ] || { echo "REFUSED: node $(node --version); Story 1.9 requires Node 22" >&2; exit 2; }
mkdir -p "$OUT"
curl -fsSL -o "$OUT/npm-$VERSION.tgz" "$TARBALL"
GOT="sha512-$(openssl dgst -sha512 -binary "$OUT/npm-$VERSION.tgz" | base64 | tr -d '\n')"
[ "$GOT" = "$INTEGRITY" ] || { echo "integrity mismatch" > "$OUT/REFUSED"; echo "REFUSED: tarball integrity $GOT is not $INTEGRITY" >&2; exit 1; }
tar -xzf "$OUT/npm-$VERSION.tgz" -C "$OUT"
RUNS=$(node "$OUT/package/bin/npm-cli.js" --version)
[ "$RUNS" = "$VERSION" ] || { echo "version mismatch" > "$OUT/REFUSED"; echo "REFUSED: extracted npm reports $RUNS" >&2; exit 1; }
mkdir -p "$OUT/bin"
CLI=$(cd "$OUT/package/bin" && pwd)/npm-cli.js
printf '#!/bin/sh\nexec node "%s" "$@"\n' "$CLI" > "$OUT/bin/npm"
chmod +x "$OUT/bin/npm"
WRAPPED=$(PATH="$OUT/bin:$PATH" npm --version)
[ "$WRAPPED" = "$VERSION" ] || { echo "wrapper mismatch" > "$OUT/REFUSED"; echo "REFUSED: wrapper reports $WRAPPED" >&2; exit 1; }
echo "npm $RUNS verified ($INTEGRITY) and running on node $(node --version)"
echo "NPM_BIN=$OUT/bin"
