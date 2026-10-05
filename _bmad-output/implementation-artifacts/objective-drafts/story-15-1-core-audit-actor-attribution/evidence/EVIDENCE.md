# Story 15.1 freeze-candidate evidence

> **FREEZE CANDIDATE — NOT YET FROZEN.** Prepared 2026-10-06. Evidence classes are kept apart: **code** (read at a commit), **test** (executed here, with its environment), **prior validation** (earlier accepted records) and **documentation** (PRD and planning text). Nothing here is live or production evidence.

## 1. Preflight (code)

- `integration/normative-prd-baseline` and PR #1 head were at `6526159916ea6d7ee843a20e1ab1d83dbbcf46cf`; `main` at `a005642`.
- The integration worktree was clean. The original checkout's fingerprint was identical before and after this preparation.
- Story 15.1 baseline: `5d5772d8ad172a6374beb5892a22a389ac34c8af`. It is the planning correction plus the Epic 15 context; `git diff --quiet 6526159 5d5772d -- services apps contracts tooling package.json package-lock.json` holds. The generator enforces this.

## 2. Core AuditLog writer matrix (code, at `6526159` = baseline)

`git grep 'INSERT INTO "AuditLog"'` over Core production Go finds exactly eight files, one helper each:

| Writer (`services/core-platform/internal/…`) | Resource | Route guard (`internal/server/server.go`) | Tablet-reachable | Story 15.1 |
|---|---|---|---|---|
| `tables/pgstore/store.go` `audit` | `table_session` | `staffOnly` (RequireStaff) | yes (`tablet_staff`, `tablet_manager`) | delegate + device context |
| `orders/pgstore/store.go` `audit` | `order` | `staffOnly` | yes | delegate + device context |
| `checks/pgstore/store.go` `audit` | `check` | `financial` (RequireStaff) | yes | delegate + device context |
| `payments/pgstore/store.go` `audit` | `payment` | `financial` | yes | delegate + device context |
| `payments/pgstore/adjustments.go` `staffAudit` | `refund` | `financial` | yes | delegate + device context |
| `shifts/pgstore/store.go` `audit` | `shift` | `financial` | yes | delegate + device context |
| `devices/pgstore/store.go` `audit` | `device`, `terminal` | `admin` (RequireStaffSession) | no | delegate, staff only |
| `promotions/pgstore/store.go` `audit` | `promotion` | `promotionAdmin` (RequireStaffSession) | no | delegate, staff only |

All eight write only `actorId`, `actorEmail` and `actorRole`, so `actorType` defaults to `staff`. For a `tablet_staff` or `tablet_manager` principal the TabletDevice (`Principal.DeviceID`) is dropped. `orders.Actor.OnTablet` exists but is never persisted.

**No Core AuditLog writer is device- or system-initiated:**

- The kitchen (`kds_device`, KDS) writes `KitchenTicketTransition`.
- Workers and projectors write no audit rows.
- Payment-adapter results write transitions (see section 4).

Story 15.1 therefore adds the device and system shapes to the model and proves them against PostgreSQL. It manufactures no production use.

## 3. Schema (code; no migration)

`apps/api/prisma/migrations/20261010000000_audit_actor_types/migration.sql` (Story 12.15):

- `AuditActorType` (`staff`, `device`, `system`);
- the columns `actorType` (default `staff`), `deviceKind`, `deviceId` and `systemActor`; `actorId`, `actorEmail` and `actorRole` are nullable;
- `AuditLog_actor_shape_check`:
  - staff: id, email and role NOT NULL, no system actor (a device may be named);
  - device: no id or email, kind NOT NULL, no system actor;
  - system: only `systemActor`;
- `AuditLog_immutable` (BEFORE UPDATE, raises `restrict_violation`);
- the venue FK is RESTRICT.

This already expresses everything Story 15.1 needs, so no migration is required. The generator fails closed if the migration no longer contains the enum, the CHECK or the trigger. `apps/**` is forbidden. The evaluator-owned test re-proves the CHECK and the trigger on the evaluation database.

Nest already records truthful actors through `apps/api/src/audit/audit-actor.ts`:

- `tablet_staff` and `tablet_manager` record staff plus `deviceKind 'tablet_device'` and the device id;
- `tablet_device` records a device with its id;
- `kds_device` records a device with no id.

Core adopts the same `tablet_device` value.

## 4. Payment-adapter boundary (code + documentation)

FIN-36 (`PRD/07-finance.md`) says: "adapter results are recorded in the append-only transition histories with the device identity, never as an invented staff actor." Core does exactly this:

- `payments/pgstore/store.go:345` records the payment result: `transition(…, cmd.Actor.ID, payments.AdapterKind, …)`;
- `payments/pgstore/adjustments.go:197` records the reversal;
- `payments/pgstore/adjustments.go:366` records the refund result;
- `payments.AdapterKind = "payment_adapter"`.

So FIN-36 is already satisfied. An AuditLog row for adapter results is not required and is out of scope. The former Story 15.1 criterion demanding one was corrected in `5d5772d`.

## 5. Story 15.2c dependency (code + documentation)

**15.2c DOES NOT DEPEND ON 15.1.**

- 15.2c changes only the two Nest creation paths (kiosk `orders/orders.service.ts`; restricted tablet `tablet/tablet-auth.service.ts`).
- It records actors through the Nest helper `apps/api/src/audit/audit-actor.ts`, which already supports device and system actors (Story 12.15).
- It touches no Core code.

The edge 15.1 → 15.2c was removed from the Epic 15 order in `5d5772d`; 15.2c already read "Depends on: none". The real 15.1 consumers are 15.5 (kitchen routes accept D8 `kds`, attributed through the 15.1 model) and 16.3.

## 6. The smallest abstraction

One new package, `services/core-platform/internal/audit` (Part C §30.3 names it), with the API fixed in the spec's intent contract:

- `Device` and `DeviceKindTablet`;
- `DeviceOf(identity.Principal)`;
- `Actor`, with the constructors `Staff`, `ByDevice` and `System`;
- `ErrInvalidActor` and `Actor.Validate`;
- `Entry` and `Write`.

The supporting changes are:

- each of the eight writers calls `Write`;
- six domain actor types gain a `Device` field;
- six handlers set it from `audit.DeviceOf(p)`.

There is no new dependency, no schema change and no route or guard change.

**Staff email (found by the positive control, test evidence).** Existing forbidden integration tests build staff actors without an email, for example `tables.Actor{StaffID, Role}`. The baseline writes `''`, which the CHECK accepts (NOT NULL). A model that mapped `''` to NULL broke 52 existing tests. The contract therefore records the staff id, email and role exactly as the verified credential carries them, never NULL. Id and role are required. The Staff FK and the role enum remain the database's checks.

## 7. Baseline measurement (test)

`baseline-measure.mjs` (the evaluator's environment, rebuilt for measurement) on an export of `6526159` was run with:

- Node 22.23.3 (darwin-arm64);
- go1.27.1 (copied toolchain; GOFLAGS=-mod=readonly, GOPROXY=off, GOTOOLCHAIN=local, GOSUMDB=off);
- PostgreSQL 18.4 and Redis 8.10.1, disposable, UTC;
- `prisma migrate deploy` (node_modules from the unchanged lockfile, `npm ci` with npm 11.17.0).

Results:

- gofmt: clean. go vet: clean.
- `go test -race -count=1 -json ./cmd/... ./internal/... ./tests/architecture/... ./tests/contract/... ./tests/integration/...`: exit 0.
- 306 top-level tests, **438 including subtests** (the go-test runner's count, so the floor is 438); 0 failed, 0 skipped.

The inherited Story 12.3a floor was 304; the floor is raised to 438.

## 8. Evaluator-owned checks (test)

There are two evaluator-owned Go sources: `generator/checks/attribution_routes_test.go.txt` and `attribution_model_test.go.txt`. The check script writes them into the candidate, runs only their tests and removes them.

- **`audit-attribution-routes`** uses only surfaces that exist at the baseline, so on the baseline it fails *behaviourally*.
- **`audit-actor-model`** uses the audit API pinned in the spec.

During development, the first version (a single file) was run with `-run '^TestEvalStory151'`:

| Tree | Result |
|---|---|
| Positive control (first version, before the model test) | 5/5 pass |
| Unfixed baseline export | `TestEvalStory151StaffThroughTablet`, `ManagerThroughTablet` and `NothingFabricated` fail; every tablet row lacks `tablet_device` and its id. `StaffSession` and `DatabaseShapeIntact` pass, which is correct: the baseline's staff-session rows are already truthful and the schema is intact. |
| Positive control (final, full suite with the black-box file present) | exit 0; 317 top-level, 449 with subtests (438 + 5 required + 6 evaluator-owned), 0 failed, 0 skipped |

## 9. Draft validation (test)

`loop.mjs validate --objective-file <draft> --repo <fresh clone at 5d5772d with the spec on disk>`:

- `ready: true`, status `OBJECTIVE READY FOR FREEZE`;
- sha256 `06db19c272182923b07a7c7816a7554693e962a9855ca70eadd463956ba86934` (final bytes; run again after every byte change);
- baseline `5d5772d8ad172a6374beb5892a22a389ac34c8af`.

## 10. Controls (test)

Both controls ran in a **disposable** clone. It contains:

- the baseline `5d5772d`;
- a *simulated* freeze anchor `27cbb72`, whose parent is the baseline and which contains only the draft objective (byte-identical, sha256 `06db19c2…`) and the spec;
- the disposable positive-control commit `bd6ac25`.

Each control ran `tooling/evaluator/bin/evaluate.mjs` from an export of the anchor's evaluator (never `loop.mjs advance`, so no ledger was written). Environment: Node 22.23.3, go1.27.1, PostgreSQL 18.4, Redis 8.10.1. node_modules came from `provisioning/provision.sh`, which passed: lockfile, go.mod and go.sum identical to the baseline; offline `go mod verify` "all modules verified"; lockfile sha256 unchanged after `npm ci`.

| Control | Candidate | Verdict | Detail |
|---|---|---|---|
| Negative | the anchor itself (unfixed baseline) | **FAIL** | `core-gofmt`, `core-vet` and `core-tests` (438, 0 skipped) pass, so every failure is Story 15.1's. Failing: `audit-writer-single-path` (eight writers name the table; no audit package); `audit-attribution-routes` (StaffThroughTablet, ManagerThroughTablet and NothingFabricated fail because every tablet row has `deviceKind`/`deviceId` NULL; StaffSession and DatabaseShapeIntact pass, correctly); `audit-actor-model` (the `internal/audit` package does not exist); RT-1 to RT-5 missing. See `control-negative.txt`. |
| Positive | `bd6ac25` (anchor + disposable implementation, 23 files) | **PASS** | All six checks pass; `core-tests` 443 (438 + 5 required), 0 skipped. RT-1 to RT-5 pass on the candidate and are `NOT_RUN_BUILD_FAILURE` on the baseline. No integrity finding. See `control-positive.txt`. |

The positive control is not in this packet and was never committed to, pushed to or merged into any published branch. Its byte sequence is irrelevant to the freeze, and only its verdict is recorded.

**Exact-byte history.** The controls first ran on `8ffe6688…` (negative FAIL, positive PASS). The objective then changed three times:

1. The black-box test was split into `audit-attribution-routes` and `audit-actor-model`, so the baseline fails behaviourally rather than by compilation, and build output was surfaced (`57cae788…`: negative FAIL, positive PASS).
2. The diagnostics were made single-line (`16d19946…`).
3. One constraint's wording was corrected (`06db19c2…`).

Both controls and the full adversarial run were repeated on the final bytes `06db19c2…`. Only those results count.

## 11. Adversarial probes (test)

`adversarial-probes.mjs` made 27 variants in the disposable clone, on the positive control or the anchor. Each was judged by the anchored objective's own mechanisms, taken from the anchor:

- static integrity;
- `audit-writer-single-path`;
- `audit-attribution-routes`;
- `audit-actor-model`;
- the five required tests.

The `core-gofmt`, `core-vet` and full `core-tests` runs are not repeated per variant; they can only add rejections.

**Result: 27 caught, MASKED 0.** The unchanged positive control passes every mechanism. Full output: `adversarial-probes.out`.

Variants caught only by one distinct mechanism show that each mechanism is necessary:

- `client-declared-device` (a header overrides the device): routes only;
- `one-store-drops-device`: routes only;
- `always-staff-class-tests-weakened` (device and system written as staff, with the implementer test weakened): model only;
- `staff-email-nulled`: model only;
- `second-write-path`: coverage only;
- `required-test-renamed`: required only;
- forbidden-surface and skip variants: integrity.

`one-route-drops-device` happened to fail to compile (an unused import), so its catch is a build failure. Its behavioural twin, `one-store-drops-device`, is caught by the routes check.

## 12. Determinism (test)

- `generate.mjs --repo <worktree>` followed by `--check`: IDENTICAL for `v1.objective.json` and `manifest.json` after each change and finally. A run in a fresh clone also gives the same sha256 (see the final report).
- No host path (`/private`, `/Users`, `/tmp`, `/opt/homebrew`) in the objective or the manifest; evidence outputs replace the scratch root with `<scratch>`.
- Facts come from git objects at the baseline, inputs from `inputs.json`; no clock, randomness or environment enters the objective.
- Evaluator self-tests (`node --test tooling/evaluator/test/*.test.mjs`, at the baseline, Node 22.23.3): 115/115 pass.
- `~/.servvia` holds no Story 15.1 state (no ledger, no evidence); all control evidence is in disposable scratch directories.

## 13. TAP residual (prior validation)

The Story 1.9 TAP residual stays open, exactly as recorded at Story 1.9 acceptance. Story 15.1 neither touches nor corrects it, and no correction is fabricated here.
