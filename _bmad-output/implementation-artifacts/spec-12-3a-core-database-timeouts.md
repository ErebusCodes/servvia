---
title: 'Story 12.3a: Core database statement timeout and lock timeout'
type: 'feature'
created: '2026-10-04'
status: 'done'
baseline_revision: 'ac8c6a76b64317056349415763571c8a130b711f'
review_loop_iteration: 0
followup_review_recommended: false
context: []
warnings: [oversized]
deferred: []
---

<intent-contract>

## Intent

**Problem:** Servvia Core opens every PostgreSQL session with no statement timeout and no lock timeout, so a slow query or a lock held by another transaction can block a request, worker or realtime read indefinitely (audit section 5: "no statement or lock timeout in Core"; Story 12.3, audit P1-03). Operators have no way to bound that wait.

**Approach:** Add two operator-configured settings, `SERVVIA_CORE_DB_STATEMENT_TIMEOUT` and `SERVVIA_CORE_DB_LOCK_TIMEOUT`, validated at startup like Core's other durations and applied to every session Core's pool opens. When a setting is unset, Core behaves exactly as today for that bound. No timeout value is chosen by Core.

## Boundaries & Constraints

**Always:**
- Values come only from Core's environment. Each variable is independent; either, both or neither may be set.
- Unset (missing or blank) means Core sets nothing for that bound: sessions keep whatever they get today (server or role default, or a parameter already present in `DATABASE_URL`).
- A set value is a Go duration (`5s`, `750ms`) that is a whole number of milliseconds between 1ms and 2147483647ms (PostgreSQL's range). Anything else (unparseable, zero, negative, sub-millisecond or fractional milliseconds, too large) refuses startup with an error naming the variable, in every environment, joined with Core's other configuration errors.
- A set value applies to every session of Core's pool (requests, workers, realtime dispatcher, readiness probe) and overrides the same parameter in `DATABASE_URL`.
- Existing session settings are kept: `application_name`, `timezone=UTC`, and `default_transaction_read_only=on` when read-only.
- The README configuration table documents both variables: no default, unset means unbounded, the accepted range, and that the value is an operator decision.

**Never:**
- No default or production timeout value, and no production requirement that the variables be set (the target value is an open owner decision).
- No device-route rate limits, dead-letter replay, metrics, idle-in-transaction or connection timeouts, or any other Story 12.3 work.
- No change to `DATABASE_URL` handling beyond overriding these two parameters when configured, to Prisma, migrations, `contracts/`, Nest, or client-facing error contracts; no new dependency; no retry added for timed-out statements.
- No `t.Skip`, focus, or lint/type suppression in tests; no existing test removed or weakened.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Both unset | variables absent or blank | Core starts; its sessions report the server's own `statement_timeout`/`lock_timeout` (0 on a default server) | No error |
| Both set | `…STATEMENT_TIMEOUT=200ms`, `…LOCK_TIMEOUT=100ms` | Every Core session reports `200ms` / `100ms` | No error |
| Statement exceeds bound | statement timeout set; a statement runs longer | That statement fails with SQLSTATE `57014`; its transaction commits nothing | Existing Core error handling |
| Lock wait exceeds bound | lock timeout set; another transaction holds the needed row lock | The waiting statement fails with SQLSTATE `55P03` within roughly the bound; nothing of its transaction is committed | Existing Core error handling |
| URL parameter present, variable unset | `DATABASE_URL` carries `statement_timeout` | Unchanged: the URL value applies | No error |
| URL parameter present, variable set | both | The variable's value applies | No error |
| Invalid value | `soon`, `0`, `-1s`, `500us`, `1500us`, `600h` | Startup refused; the error names the variable | Configuration error |

</intent-contract>

## Code Map

- `services/core-platform/internal/config/config.go` -- `Config` struct and `load(getenv)`; `duration` helper (L87-98) refuses `<=0`; errors collected in `errs` and joined. Add the two settings here with the stricter millisecond validation; unset must stay distinguishable from set (e.g. zero value = unset).
- `services/core-platform/internal/config/config_test.go` -- existing table of `load` tests (6 top-level); do not modify; add new tests in a new file.
- `services/core-platform/internal/platform/postgres/pool.go` -- `Options{URL, MaxConns, ReadOnly}`, `NewPool` sets `ConnConfig.RuntimeParams` (`application_name`, `timezone`, `default_transaction_read_only`). pgx sends RuntimeParams as startup parameters, and URL query parameters already land in the same map, so writing the key overrides a URL value and not writing it leaves the URL value. No test files today.
- `services/core-platform/cmd/api/main.go` -- L78-80 builds `postgres.Options` from `cfg`; the single pool every store, worker, the realtime dispatcher and `health` use.
- `services/core-platform/tests/testsupport/testsupport.go` -- `DisposableDatabaseURL(t)` (skips when `SERVVIA_CORE_TEST_DATABASE_URL` is unset; refuses non-local or production-looking databases). Use it; never call `t.Skip` directly.
- `services/core-platform/tests/integration/staff_session_test.go` -- example of an integration test opening its own pool via `postgres.NewPool` with `DisposableDatabaseURL`.
- `services/core-platform/tests/architecture/guard_test.go` -- code tokens in `cmd/` and `internal/` must not contain legacy fragments such as `posconfig`; pick names accordingly.
- `services/core-platform/README.md` -- "Configuration" table (L68-86).
- Read-only: `internal/workers/worker.go` and `internal/kitchen/pgstore/projector.go` claim with `FOR UPDATE SKIP LOCKED` (they do not wait on locks); a timed-out delivery rolls back and is retried by existing lease logic.

## Tasks & Acceptance

**Execution:**
- `services/core-platform/internal/config/config.go` -- add statement and lock timeout settings read from `SERVVIA_CORE_DB_STATEMENT_TIMEOUT` and `SERVVIA_CORE_DB_LOCK_TIMEOUT`, validated per the Always rules -- operator-configured bounds, fail closed on bad input.
- `services/core-platform/internal/platform/postgres/pool.go` -- accept optional statement and lock timeouts and set `statement_timeout`/`lock_timeout` runtime parameters (whole milliseconds) only when set -- bounds every Core session; unset changes nothing.
- `services/core-platform/cmd/api/main.go` -- pass the configured timeouts into the pool options -- the API process applies them.
- `services/core-platform/internal/config/database_timeouts_test.go` (new) -- `TestLoadDatabaseTimeouts` (unset and blank mean unset; valid values parsed for each variable independently) and `TestLoadRejectsInvalidDatabaseTimeouts` (each invalid row of the matrix refused, error names the variable).
- `services/core-platform/tests/integration/database_timeouts_test.go` (new) -- `TestDatabaseTimeoutsBoundCoreSessions` (configuration loaded from Core's environment variables, pool built the way `cmd/api` builds it: `SHOW` reports both values; a sleep past the statement bound fails `57014`; a lock wait on a row locked by a second plain connection fails `55P03` and a write made earlier in the same transaction is absent afterwards; a `DATABASE_URL` parameter is overridden) and `TestDatabaseTimeoutsUnsetLeaveSessionsUnbounded` (unset: sessions report the server defaults and a URL parameter still applies). Clean up any fixture it creates.
- `services/core-platform/README.md` -- document both variables in the Configuration table.

**Acceptance Criteria:**
- Given neither variable is set, when Core starts and opens database sessions, then startup succeeds and every session's `statement_timeout` and `lock_timeout` are exactly what they were before this change.
- Given an operator sets either or both variables to valid values, when Core opens any database session, then that session reports the configured value for each set variable, and a statement exceeding a configured bound fails instead of waiting, leaving no partial state.
- Given an operator sets either variable to an invalid value, when Core starts, then it refuses to start with an error naming that variable, in every environment.
- Given the README configuration table, when an operator reads it, then both variables are documented with no default, unset meaning unbounded, and the accepted range.

## Spec Change Log

## Review Triage Log

### 2026-10-04 — Review pass
- verdicts: 17 findings — high 0, medium 1, low 7, false 9, maybe-false 0
- findings:
  - `[false]` `[reject]` (blind) Nothing maps 57014/55P03 to a specific HTTP status or log — the intent's matrix prescribes "Existing Core error handling" and its Never list forbids changes to client-facing error contracts; nothing is broken by leaving the mapping unchanged.
  - `[false]` `[reject]` (blind) One pool-wide bound also covers workers and the realtime dispatcher, with no per-role opt-out — the intent requires the bound on every session of the pool (requests, workers, realtime dispatcher, readiness probe), and the README states it.
  - `[low]` `[patch]` (blind) Startup parameters behind a connection pooler (PgBouncer) can be refused or silently dropped, with no README caveat — no pooler exists anywhere in the repository; patched by adding one README sentence that the values are sent as connection startup parameters, so any pooler in front of PostgreSQL must pass them through (grouped with the edge-case pooler finding).
  - `[false]` `[reject]` (blind) `idle_in_transaction_session_timeout` is not covered — the intent's Never list explicitly excludes idle-in-transaction and connection timeouts.
  - `[low]` `[reject]` (blind) `internal/platform/postgres` now imports `internal/config` for `OptionsFromConfig` — `internal/config` imports no internal package, so no cycle exists today and the architecture guard passes. Moving the mapping would undo the spec's single shared mapping, and the fix is more than a direct correction.
  - `[low]` `[patch]` (blind) A bare integer such as `5000` and a millisecond overflow have no invalid-value test — `config.go` already refused both; patched by adding `"5000"` and `"9223372036855ms"` to the invalid table in `internal/config/database_timeouts_test.go`.
  - `[low]` `[reject]` (blind) The `pg_sleep(0.3)` check in the unset test runs only when the server's `statement_timeout` is 0 — the assertion the intent requires (the session equals the server's own value) always runs. CI and the evaluator use default servers, where the sleep check runs too. The fix would add a branch for no gain.
  - `[low]` `[patch]` (blind) Fixed timing windows can flake under `-race` on a loaded runner — patched by loosening the lock-wait upper bound from 1s to 1.5s. The 90ms lower bound and the SQLSTATE assertions are unchanged.
  - `[false]` `[reject]` (blind) The spec has only a status change, and `baseline_revision` differs from HEAD `a005642` — in this worktree HEAD is the anchor `ac8c6a76b64317056349415763571c8a130b711f`, which is exactly `baseline_revision`; the reviewer compared against another checkout. Spec results are written at finalize.
  - `[false]` `[reject]` (blind) No deploy or env templates record the new variables or starting values — no `SERVVIA_CORE_*` env template or deploy manifest exists to update. Recording starting values would invent a timeout value, which PRD section 19 (OWNER TARGET REQUIRED) and the intent forbid.
  - `[low]` `[patch]` (edge) PgBouncer rejects unknown startup parameters, so connections fail once a timeout is set — same root cause and fix as the blind pooler finding: the README caveat. No pooler exists in the repository, so an AfterConnect `SET` fallback would add complexity for a deployment that does not exist.
  - `[low]` `[reject]` (edge) A mixed-case key in `DATABASE_URL` (for example `Statement_Timeout`) and the variable are both sent, and map order decides the winner — this needs an operator to write a non-canonical key in the URL and also set the variable, which is unlikely. The fix adds a case-folding loop, so per the rule it is not worth the complexity.
  - `[medium]` `[patch]` (verification-gap) The `cmd/api` pool wiring is untested: reverting `main.go` to an `Options` literal without the timeouts, or dropping `MaxConns` from `OptionsFromConfig`, would pass the suite — patched by extracting the unexported `newPool(ctx, cfg)` that `run()` calls, and adding `cmd/api/main_test.go` (`TestNewPoolAppliesConfiguredDatabaseTimeouts`, `TestNewPoolLeavesUnsetDatabaseTimeoutsAlone`). The tests assert the built pool's runtime parameters in whole milliseconds and `MaxConns`, and that neither key is present when unset.
  - `[false]` `[reject]` (intent-alignment) The startup refusal is shown at config load, not at process level — `run()` returns the `config.Load` error and `main` exits 1 (`cmd/api/main.go`, existing code), so a config refusal is a startup refusal.
  - `[false]` `[reject]` (intent-alignment) The named consumers (requests, workers, dispatcher, readiness) are not exercised one by one — `cmd/api` has a single pool construction, and every store, worker, the dispatcher and `health` get that pool. That construction is now covered by the `cmd/api` tests, and the integration test shows every pooled session carries the bounds.
  - `[false]` `[reject]` (intent-alignment) A timed-out statement inside a real Core store or handler path is not exercised — the intent requires existing error handling and only that nothing commits; the integration tests prove the SQLSTATE and that nothing is committed at the session level every Core path uses.
  - `[false]` `[reject]` (intent-alignment) The integration evidence depends on `DisposableDatabaseURL`, which skips without a database — the skip is pre-existing helper behaviour that the diff did not add. The verification run and the evaluator both supply the database, and the run showed 0 skips.

## Design Notes

Prefer one mapping from `config.Config` to `postgres.Options` that both `cmd/api` and the integration test use, so the test exercises the same wiring the process runs. PostgreSQL accepts `statement_timeout` and `lock_timeout` as startup parameters; send integer milliseconds (e.g. `"200"`), and expect `SHOW` to print `200ms`. For the lock test, a second plain `pgx` connection holds `SELECT … FOR UPDATE` on a row the test inserted (or a scratch table it creates and drops) while the Core-pool transaction requests the same lock; keep bounds small (tens to hundreds of milliseconds) so the suite stays fast.

## Verification

**Commands:**
- `cd services/core-platform && test -z "$(gofmt -l .)"` -- expected: no output, exit 0
- `cd services/core-platform && go vet ./...` -- expected: exit 0
- `cd services/core-platform && go test -race -count=1 ./internal/... ./tests/architecture/... ./tests/contract/...` -- expected: all pass
- `cd services/core-platform && go test -race -count=1 ./tests/integration/...`, with `SERVVIA_CORE_TEST_DATABASE_URL` pointing at a disposable local database migrated by `prisma migrate deploy` and `SERVVIA_CORE_TEST_REDIS_ADDR` at a disposable local Redis -- expected: all pass, none skipped

## Auto Run Result

Status: ready-for-dev
Blocking condition: waiting-for-objective-approval: draft _bmad-output/implementation-artifacts/objective-drafts/story-12-3a-core-database-timeouts/v1.objective.json sha256 66edb9912c96729ba4b9fabfd332e036bc8205e32b68f9c2c442c1ab8e7c4345

Planning-only run (no objective_anchor): OBJECTIVE READY FOR FREEZE on baseline 00e64adf9bd9c40501a817bf9831225a389c7725. Nothing implemented or committed.

### Anchored run 2026-10-04 (objective_anchor ac8c6a76b64317056349415763571c8a130b711f, objective sha256 66edb9912c96729ba4b9fabfd332e036bc8205e32b68f9c2c442c1ab8e7c4345)

Status: done (candidate produced; technical completion is the evaluator's decision)

**Summary.** Core now reads two optional, operator-configured settings, `SERVVIA_CORE_DB_STATEMENT_TIMEOUT` and `SERVVIA_CORE_DB_LOCK_TIMEOUT`.
- Unset or blank means Core sets nothing for that bound.
- A set value must be a Go duration that is a whole number of milliseconds from 1ms to 2147483647ms; anything else refuses startup in every environment, with an error naming the variable, joined with the other config errors.
- A set value is sent as the `statement_timeout` / `lock_timeout` startup parameter (whole milliseconds) on every session of Core's single pool, overriding the same `DATABASE_URL` parameter.
- No default or production value exists anywhere.

**Files changed:**
- `services/core-platform/internal/config/config.go`: the `DBStatementTimeout` and `DBLockTimeout` settings, with their strict millisecond validation.
- `services/core-platform/internal/platform/postgres/pool.go`: the `StatementTimeout` and `LockTimeout` options, sent only when set, and `OptionsFromConfig`, the single mapping from config to pool options.
- `services/core-platform/cmd/api/main.go`: the unexported `newPool(ctx, cfg)`, which `run()` uses to build its pool through `OptionsFromConfig`.
- `services/core-platform/cmd/api/main_test.go` (new): wiring tests showing the process's pool carries the configured runtime parameters, and none when unset.
- `services/core-platform/internal/config/database_timeouts_test.go` (new): `TestLoadDatabaseTimeouts` and `TestLoadRejectsInvalidDatabaseTimeouts`.
- `services/core-platform/tests/integration/database_timeouts_test.go` (new): `TestDatabaseTimeoutsBoundCoreSessions` (`SHOW` values, `57014`, `55P03`, nothing committed, URL override, every pooled session) and `TestDatabaseTimeoutsUnsetLeaveSessionsUnbounded`.
- `services/core-platform/README.md`: the Configuration table row for both variables.

**Review findings:** 17 in total.
- **Patches applied:** 1 medium and 3 low entries.
  - medium: the `cmd/api` wiring test.
  - low: the README pooler caveat (blind and edge findings grouped), the invalid-value rows `5000` and `9223372036855ms`, and the looser lock-wait upper bound.
- **Deferred:** none.
- **Rejected:** 3 low and 9 false. Each reason is recorded in the Review Triage Log above.
  - low: the postgres-imports-config layering, the conditional sleep check, and the mixed-case URL key.
  - false: the HTTP mapping for timeouts, worker opt-out, idle-in-transaction, the spec baseline, env templates, process-level startup, per-consumer exercise, Core-path error handling, and the pre-existing DB skip helper.

**Follow-up review recommendation:** false. This first pass patched 0 high entries and 1 medium entry (fewer than 2), plus 3 low entries.

**Verification** (disposable PostgreSQL 18 on 127.0.0.1:55433, UTC, migrated by `prisma migrate deploy`; disposable Redis on 127.0.0.1:56380):
- `gofmt -l .`: empty.
- `go vet ./...`: exit 0.
- `go test -race -count=1 -v ./cmd/... ./internal/... ./tests/architecture/... ./tests/contract/... ./tests/integration/...`: exit 0, 306 top-level tests passed, 0 skipped, 0 failed.
- The new tests passed. In the integration run, the 57014 subtest took 0.20s and the 55P03 subtest took 0.11s.
- The matrix test audit passed: every I/O matrix row is covered by a test that ran and passed.

**Residual risks:**
- The lock-wait test asserts a 90ms–1.5s window, which could still flake on an extremely loaded runner.
- Timed-out statements surface through Core's existing error mapping (typically a 500), as the intent requires.
- A connection pooler in front of PostgreSQL must pass startup parameters through; this is now documented.
- The production timeout values remain an open owner decision (PRD section 19).
