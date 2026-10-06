# Story 20.3 evaluator provisioning

> **FREEZE CANDIDATE — NOT YET FROZEN.** Instructions for the orchestrator's evaluation of a Story 20.3 candidate. No authority until the objective is frozen.

- **Runtime:** Node 22 (`.nvmrc`; validated 22.23.3), which also runs the evaluator, plus `git` on `PATH`.
  - `telemetry-contract` builds fixture git repositories in a temporary directory.
  - The evaluator's environment PATH includes `/usr/bin`.
- **Not needed:** no npm dependencies, no `node_modules`, no Go toolchain, no PostgreSQL and no Redis. The objective declares no services and no setup steps. The tool may use Node built-ins only, which `telemetry-boundaries` enforces.
- **Real evaluator state is not read during evaluation.** The backfill expectations are fixed in the objective; the contract test builds its own fixture ledgers.

## Producing the backfill (implementation, not evaluation)

The implementer derives the committed backfill once, from a checkout with full history, reading the real ledgers and records read-only:

```bash
for row in "1.3 story-1-3-venue-connector-ci-job-made-truthful ff3e4d7" \
           "12.3a story-12-3a-core-database-timeouts 8a4d3ab" \
           "12.5 story-12-5-kiosk-off-in-production e575658" \
           "1.7 story-1-7-native-round-recovery-ci-truthfulness 38bea30" \
           "1.8 story-1-8-native-round-recovery-host-override-safety 38bea30" \
           "1.9 story-1-9-test-harness-loopback-binding 963bd4c" \
           "15.1 story-15-1-core-audit-actor-attribution 4747043"; do
  read -r story oid integ <<<"$row"
  node tooling/telemetry/bin/telemetry.mjs derive --repo . --objective-id "$oid" --story "$story" \
    --state-dir ~/.servvia/evaluator-state --evidence-dir ~/.servvia/evaluator-evidence --integration "$integ"
done
```

## Evaluation command (after freeze)

```bash
git -C <repo> archive <anchor> tooling/evaluator | tar -x -C <eval-dir>
node <eval-dir>/tooling/evaluator/bin/loop.mjs advance --repo <repo> --worktree <checkout> \
  --anchor-commit <anchor> --objective _bmad-output/implementation-artifacts/objectives/story-20-3-program-telemetry/v1.objective.json \
  --objective-sha256 <approved sha256> --candidate <candidate>
```
