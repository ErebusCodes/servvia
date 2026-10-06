# Servvia engineering-program telemetry

Story 20.3 (AIL-5): program measurements for forecasting and epic retrospectives. The authoritative contract is the intent contract of `_bmad-output/implementation-artifacts/spec-20-3-program-telemetry.md`.

## Model

The log `_bmad-output/implementation-artifacts/telemetry/events.jsonl` holds one JSON event per line. It is append-only and hash-chained: each `prev` is the SHA-256 of the previous line. Every summary value states how it is known:

| Provenance | Meaning |
|---|---|
| `measured` | recorded live from the clock (`SERVVIA_TELEMETRY_CLOCK` overrides it, for tests) |
| `derived` | re-computable from git and the evaluator's ledger and records (`derive`) |
| `recorded` | an explicit statement: a back-dated event (`--at`) or stated effort |
| `unknown` | never measured or stated. Its value is `null`, never 0 or an estimate |

Lifecycle: `preparation` → `frozen` → `implementation` → `evaluated` → `correction` and re-evaluation → `review` (`review-decision`) → `accepted`. Waiting is a separate `blocked-start`/`blocked-end` interval, with one of the reasons `owner-decision`, `external`, `authorization`, `infrastructure` or `other`. Effective time excludes it.

## Use

```bash
T=tooling/telemetry/bin/telemetry.mjs
node $T record --story 15.3 --type phase-start --phase preparation        # measured, live
node $T record --story 15.3 --type blocked-start --reason owner-decision
node $T record --story 15.3 --type blocked-end
node $T record --story 15.3 --type phase-end --phase preparation
node $T derive --repo . --objective-id <objectiveId> --story 15.3 \
  --state-dir ~/.servvia/evaluator-state --evidence-dir ~/.servvia/evaluator-evidence \
  --integration <merge commit>                                              # after evaluation and integration
node $T record --story 15.3 --type review-decision --reason accept
node $T record --story 15.3 --type accepted
node $T verify
node $T summary --epic 15 --format text                                    # retrospective input
```

- **Corrections:** `record --type retract --corrects <seq> --note <reason>`. The original line stays in the log.
- **Back-dating:** `--at <time>` labels the event `recorded`, never `measured`.

## Boundaries

- **Read-only towards the evaluator.** `derive` refuses a ledger that the evaluator's `verifyChain` rejects, and a record whose SHA-256 differs from the ledger. It writes only to this log.
- **Privacy.** The log holds story and objective ids, lifecycle events, times, evaluator outcomes, test growth and defect counts. There is no person field and no activity, screen, clipboard, history, browser, host or message data. The tool uses Node built-ins only, has no network access, and its only child process is `git`.
- **Backfill.** The seven governed stories before 20.3 (1.3, 12.3a, 12.5, 1.7, 1.8, 1.9, 15.1) hold derived events only. Freeze-to-candidate is wall-clock time, not effort. Their preparation, review, effort, waiting and defects are unknown.
