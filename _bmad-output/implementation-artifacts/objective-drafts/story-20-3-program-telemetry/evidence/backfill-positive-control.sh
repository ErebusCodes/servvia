#!/usr/bin/env bash
# Produces the Story 20.3 backfill in a checkout (run from its root) with the telemetry tool.
set -euo pipefail
while read -r story oid integ; do
  node tooling/telemetry/bin/telemetry.mjs derive --repo . --objective-id "$oid" --story "$story" \
    --state-dir "$HOME/.servvia/evaluator-state" --evidence-dir "$HOME/.servvia/evaluator-evidence" --integration "$integ"
done <<'ROWS'
1.3 story-1-3-venue-connector-ci-job-made-truthful ff3e4d7
12.3a story-12-3a-core-database-timeouts 8a4d3ab
12.5 story-12-5-kiosk-off-in-production e575658
1.7 story-1-7-native-round-recovery-ci-truthfulness 38bea30
1.8 story-1-8-native-round-recovery-host-override-safety 38bea30
1.9 story-1-9-test-harness-loopback-binding 963bd4c
15.1 story-15-1-core-audit-actor-attribution 4747043
ROWS
