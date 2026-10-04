---
title: 'Story 12.3a: Core database statement timeout and lock timeout'
type: 'feature'
created: '2026-10-04'
status: 'ready-for-dev'
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
