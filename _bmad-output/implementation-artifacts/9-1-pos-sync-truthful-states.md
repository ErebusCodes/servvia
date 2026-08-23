---
baseline_commit: HEAD@2026-08-15
first_slice_of: E9
tracer_bullet: true
blocked_on_for_real_adapter_work: DL-064
---

# Story 9.1: Truthful POSSyncRecord States (No Fabricated Idealpos Success)

Status: done

## Story

As a platform operator and as venue staff relying on the Admin Dashboard,
I want `POSSyncRecord.status` to only ever reflect what actually happened at Idealpos,
so that an order is never silently misrepresented as recorded in the POS when no real Idealpos system was ever contacted.

This story implements target-operating-model.md §7's "no fabricated provider... success is permitted" and mvp.md's Non-Negotiable Principle #1 ("never fake success") for the one piece of POS-sync code that currently exists. It is the tracer bullet for E9 and must land before any other E9 story. Real adapter implementation (E9-S3–S7) remains separately `BLOCKED ON: Q1` per decision record DL-064 — this story does not unblock that; it only stops the current code from lying while Q1 remains unresolved.

**Current defect this story removes:** `pos-sync.processor.ts` fabricates a plausible-looking transaction ID (`IDEAL-${orderId...}`) and marks the sync record `synced` for any `posAdapterType` other than `none`, without ever contacting a real Idealpos system. Separately, nothing in order creation currently enqueues a job onto the `pos-sync` queue at all, so this processor is not even reachable today — but it must not be allowed to run as currently written if it is ever wired up.

## Intent and Business Value

Ensure that "synced to Idealpos" can never appear on an order that was never actually sent to Idealpos. Business value: prevents a scenario where staff and management believe every kitchen sale is reconciled in the POS when, in fact, none are — which would be discovered only during an accounting/reconciliation failure, at which point the damage (lost sales records, tax reporting gaps) is already done.

## In Scope

- Remove the `IDEAL-*` fabrication in `pos-sync.processor.ts`: no code path may synthesize a transaction ID and present it as an Idealpos-issued reference.
- Explicitly special-case `posAdapterType: 'none'` (NullAdapter) to report `POSSyncStatus.not_applicable`, never `synced` — consistent with the corrected worker logic in `docs/integrations/idealpos.md` §8 and decision DL-064.
- For any configured non-`none` adapter type where no real adapter implementation exists yet, report `unsupported` (or `failed` with a clear "no adapter implemented" reason) rather than attempting the current simulated-delay-then-fabricate path.
- Confirm and, if needed, correct the enqueue gap: order creation must either genuinely enqueue a `POSSyncRecord` processing job when a non-`none` adapter is configured, or the queue subscription must remain dormant — either is acceptable, but the two must be consistent (a queue that's wired up but does nothing safe on trigger, or a queue that's honestly not wired up yet, are both fine; a queue that fabricates success if it ever fires is not).

## Explicit Exclusions

- Does not implement any real Idealpos adapter (ApiAdapter, SqlAdapter, OdbcAdapter, CsvAdapter, LocalAgentAdapter) — those remain `BLOCKED ON: Q1` per DL-064.
- Does not implement the venue connector, mutual TLS, or durable local queue (story 2-9's scope).
- Does not implement reconciliation workflows for uncertain outcomes (later E9/enterprise work).
- Does not change table/PLU/modifier/tax/tender mapping — none of that exists yet and remains blocked on vendor discovery.

## Dependencies

None blocking. Independent of stories 6-1 and 8-1; can be implemented in parallel. Does not depend on DL-064 resolving — this story is specifically what must be true *while* DL-064 remains blocked.

## Inputs and Expected Outputs

**Input:** an order for a venue with `posAdapterType: 'none'` (development/no-POS venue).

**Output:** `POSSyncRecord.status = 'not_applicable'`. No transaction ID is stored. No code path represents this as `synced`.

**Input:** an order for a venue with `posAdapterType` set to any real adapter type, where no adapter implementation exists yet.

**Output:** `POSSyncRecord.status = 'unsupported'` (or `failed` with an explicit "adapter not implemented" reason), never `synced`, and never a fabricated `posOrderId`.

## Happy Path

For a `none`-adapter venue (the only configuration this story needs to make production-honest today): order is created, `POSSyncRecord` is created with `status: not_applicable`, and the Admin Dashboard shows this state honestly rather than hiding it or showing `synced`.

## Failure and Recovery Paths

- **Adapter type misconfigured to a real type with no implementation:** system reports `unsupported`, visible to staff, rather than silently pretending success — this is itself the "recovery path": the failure is visible, not masked.
- **Processor is (re-)wired to the queue in the future:** the special-casing in this story ensures that even an accidental re-enable cannot reintroduce fabricated `synced` states, because the mapping from adapter type/result to status is explicit rather than inferred from a generic success boolean.

## Security and Tenancy Requirements

No change to authentication/authorization surfaces. `POSSyncRecord` remains venue-scoped as today.

## Observability and Audit Requirements

- Every `not_applicable` and `unsupported` status is visible on the Admin Dashboard's order/POS-sync view (per the existing E9-S9 widget scope) so staff always know the true POS-sync posture of a venue, not just failures.
- Removal of the fabrication path is itself an auditable change — the release evidence pack must show a test proving no code path can produce a fabricated `posOrderId`.

## Migration and Compatibility Considerations

- Any existing `POSSyncRecord` rows with a `synced` status and an `IDEAL-*`-pattern `posOrderId` (from the current fabrication bug, if it was ever triggered in any environment) must be identified and corrected to `not_applicable`/`unsupported` as part of rollout — do not leave fabricated historical rows presented as real Idealpos confirmations.
- **Correction (2026-08-15 implementation session):** the line originally here claimed `POSAdapterType` and `POSSyncStatus` enums were unchanged, citing `docs/domain-model.md`. Verified against the actual Prisma schema (`backend/prisma/schema.prisma`) before implementing: `POSSyncStatus` had only `not_synced`/`synced`/`failed`/`not_applicable` — **no `unsupported` value existed**. `docs/domain-model.md`'s `POSSyncStatus` union is a materially different, aspirational future-connector lifecycle (`queued`/`connector_accepted`/`pos_submitted`/`pos_confirmed`/`failed`/`uncertain`/`manual`/`not_applicable`) that belongs to the later E9 connector stories, not this one, and does not match the schema either. This is exactly the "story materially inconsistent with the current codebase" case — corrected here rather than silently worked around: `POSSyncStatus` gains one additive enum value, `unsupported`, via migration `20260815150000_pos_sync_unsupported_status`, chosen over the AC3 fallback (`failed` with a reason) because conflating "no adapter implementation exists" with "a real adapter attempted and Idealpos rejected it" would itself violate this story's own truthfulness standard once a real adapter lands and `failed` becomes a genuinely reachable, different claim.

## Acceptance Criteria

1. No code path can set `POSSyncRecord.status = 'synced'` without a real adapter's confirmed, externally-verifiable Idealpos response.
2. `posAdapterType: 'none'` always and only produces `status: not_applicable`.
3. A configured-but-unimplemented adapter type always and only produces `status: unsupported` (or `failed` with an explicit reason), never `synced`, and never a fabricated `posOrderId`.
4. The `IDEAL-*` ID-fabrication code is fully removed, verified by a test asserting no `posOrderId` matching that pattern (or any synthesized pattern) can be produced by the processor.
5. Any historical rows produced by the fabrication bug are identified and corrected as part of this story's rollout, with the count and correction logged.
6. Admin Dashboard POS-sync visibility (existing or minimal-scope new) shows `not_applicable`/`unsupported` states honestly rather than omitting them.

## Definition of Done

Automated tests cover: `none`-adapter path produces `not_applicable`; unimplemented-real-adapter path produces `unsupported`/`failed` with no fabricated ID; no test or code path can produce a `synced` status without a real adapter confirmation (which does not exist yet, so `synced` should be unreachable in the current codebase entirely until a real adapter lands). Evidence (test output, historical-data correction log) is retained in the release pack before this story's status may become `done`.

## Tasks / Subtasks

- [x] Add `unsupported` to `POSSyncStatus` (migration `20260815150000_pos_sync_unsupported_status`, additive, split from the data-correction migration because Postgres forbids using a value added by `ALTER TYPE ... ADD VALUE` within the same transaction — confirmed directly against real Postgres 16, not assumed).
- [x] Rewrite `PosSyncProcessor`: remove the `IDEAL-*` fabrication and simulated-delay code entirely; `none` adapter → `not_applicable`; any other configured adapter type → `unsupported` with an explicit, adapter-type-naming reason; both transitions are a single database-level compare-and-swap (`updateMany` guarded on `status: not_synced`) so a duplicate/concurrent queue delivery of the same record resolves to exactly one write and can never overwrite an already-terminal result; `attemptCount`/`lastAttemptAt` deliberately left untouched (no real submission attempt is ever made by this processor); `synced` and `failed` are structurally unreachable from this processor (AC1, AC2, AC3, AC4).
- [x] Correct historical fabricated rows: migration `20260815150100_pos_sync_correct_fabricated_records` (idempotent `UPDATE`, keyed on the record's own `adapterType`, not the venue's current config) plus a standalone, separately-testable, re-runnable script (`prisma/scripts/correct-fabricated-pos-sync-records.ts`, also wired to `npm run correct-pos-sync-records`) proven against seeded representative rows in real Postgres (AC5).
- [x] Document and verify the enqueue-gap decision: `orders.service.ts` already creates a `not_synced` `POSSyncRecord` for any non-`none`-adapter venue but never enqueues it onto the `pos-sync` BullMQ queue; added an explanatory comment at the creation site and a real-Postgres integration test asserting a real order creation (through `OrdersService.createStaffOrder`) leaves the queue's job counts unchanged — consistent and honestly dormant, not fabricating-if-fired (In Scope item 4).
- [x] Add read-only admin visibility: `PosSyncRecordsController`/`PosSyncRecordsService` (`GET /admin/venues/:id/pos-sync-records`, `GET /admin/orders/:id/pos-sync`), JWT + role (`admin`/`manager`/`cashier`/`kitchen`) + org/venue-scoped identically to Story 8-1's `PrinterJobsController` precedent (AC6).
- [x] Unit tests (mocked Prisma): `pos-sync.processor.spec.ts` (16 tests), `pos-sync-records.service.spec.ts` (8 tests), plus one new case in `orders.service.spec.ts` covering the non-`none`-adapter `POSSyncRecord` creation path.
- [x] Real-Postgres integration tests: `test/pos-sync.integration-spec.ts` (19 tests) — state-transition matrix, real database compare-and-swap concurrency, real JWT/KDS-token-scoped org/venue isolation, historical-row correction against seeded representative data, order-creation-through-the-real-service queue-dormancy proof, and a static-source regression guard against the removed fabrication pattern.
- [x] Typecheck, `nest build`, `prisma validate`, focused ESLint (autofixed) all pass.
- [x] Migration executed and verified against real Postgres (populated shared dev DB, additive/no-op-confirmed) and a disposable container (clean-from-zero via `prisma migrate deploy`) — `VERIFY.md`.
- [x] **Independent review loop** (state-machine, replay/failure, security/tenancy, verification-gap) — see Dev Agent Record below for outcome.

## Dev Agent Record

### Implementation Plan

This story's honest ceiling is narrow and was kept narrow: with zero real
Idealpos adapters implemented (blocked on DL-064), the processor has
exactly two reachable, deterministic outcomes — `not_applicable` for
`none`, `unsupported` for everything else — both computed from the
record's own immutable `adapterType`, never from any external system
response. That determinism is what makes the duplicate/concurrent-delivery
story simpler than Story 8-1's printer processor: there is no real
transport step to race against, so a single compare-and-swap
(`updateMany` guarded on `status: not_synced`) is sufficient to make
duplicate delivery, concurrent processing, and replay all resolve to at
most one write, with no intermediate `accepted`/`dispatching`-style states
needed — introducing them would imply a transport attempt this story does
not make. `attemptCount`/`lastAttemptAt` are deliberately left untouched by
both outcomes: incrementing them would misrepresent "the processor
classified this record" as "a submission attempt was made," which is
exactly the class of overstatement this story exists to remove. The
historical-row correction is keyed on the record's own `adapterType`
column (not a join to the venue's current configuration) after a
dedicated integration test caught the venue-join version silently
misclassifying a record whose venue's adapter type had since changed — see
`VERIFY.md` §3 for the full reproduction. The admin visibility endpoints
mirror Story 8-1's `PrinterJobsController` pattern exactly (same guard
stack, same role set, same org/venue-scoping idiom via
`resolveVenueScope`) rather than inventing a new authorization pattern for
what is, functionally, the same kind of read.

### Independent Review — Round 1 (4 parallel fresh-context reviewers: state-machine, replay/failure/concurrency, security/tenancy, verification-gap)

**State-machine review: no P0/P1.** Traced every write to `POSSyncRecord.status`/`Order.posSyncStatus`/`posOrderId` across the whole backend and confirmed exactly two production write sites (order creation, the processor's own guarded CAS), both exhaustive and mutually consistent; confirmed `posOrderId` is never set to anything synthesized anywhere in production code; confirmed `not_applicable`/`unsupported` are cleanly, consistently distinct. One benign note: a pre-existing, untouched stub (`pos-sync.controller.ts`'s `GET /pos-sync/records`) has a confusingly similar route name to the new admin API — flagged for a future cleanup, not a defect.

**Security/tenancy review: no P0/P1.** Confirmed cross-org isolation, KDS-token venue scoping (byte-for-byte the same pattern as the reviewed Story 8-1 sibling), RBAC enforcement, non-disclosing 404s, no sensitive data in `errorMessage`, no SQL-injection risk in the correction script/migrations (all static SQL, no interpolation of untrusted input), and no missing audit logging (both new endpoints are genuinely read-only). One note: the standalone correction script has no authorization of its own (expected — it's an ops script, not an HTTP endpoint, matching the existing `prisma/scripts/*` convention).

**Replay/failure/concurrency review — one real P0, confirmed and fixed.** Duplicate delivery, TOCTOU, replay, and the correction script's concurrency-safety were all found sound (the CAS guard and the deterministic, side-effect-free outcome make this simpler than Story 8-1's real-transport case). **P0**: the `POSSyncRecord` write and its `Order.posSyncStatus` mirror write were two independent, non-transactional round-trips (`pos-sync.processor.ts:73-87`, prior to fix). A worker crash between them would leave the record terminal while the order stayed permanently stuck at `not_synced` — and since an already-terminal record is unconditionally a no-op on reprocessing, nothing would ever revisit and heal the stranded order. **Fixed**: both writes are now issued inside a single `prisma.$transaction([...])` array call — atomic all-or-nothing, not two separate awaits. The reviewer also confirmed the "genuinely concurrent duplicate delivery" integration test is real (two truly concurrent `process()` calls via `Promise.allSettled` against real Postgres, not sequential awaits dressed up as concurrent).

**Verification-gap review** answered the mandated question plainly: **nothing currently detects "Idealpos silently recorded a transaction but Verdura lost the ack" or "Verdura submitted the same order twice"** — both require a real Idealpos submission to have occurred, and no code path in this codebase ever contacts one. This is an accurately-disclosed scope boundary (`deferred-work.md`, the processor's own header comment), not a gap this story could have closed. Spot-checked several VERIFY.md claims against the real files/tests and confirmed them true. Two real, previously-unnamed findings: **(P1, fixed)** the migration's SQL and the standalone correction script had no automated check keeping them in sync — a future edit to one without the other would silently drift undetected; **fixed** by adding a normalized-text-equality test (`test/pos-sync.integration-spec.ts`, "migration/script SQL parity"). **(P2, disclosed not fixed)** the static fabrication-regex regression guard is scoped to one file and provides no forward protection once a real adapter file exists; and no test exercises the processor via a real running BullMQ worker (consistent with the queue being genuinely dormant, but not previously named as its own angle). Both restated in `deferred-work.md` with concrete owners for whichever future story is positioned to close them.

All fixes re-verified: full unit suite (351/351), full real-Postgres integration suite (75/75, reproduced clean across 2 full-suite runs and 3 additional standalone runs of `pos-sync.integration-spec.ts` specifically — 20/20 every time), `tsc --noEmit`, `nest build`, `prisma validate`, focused ESLint (only the same pre-existing, already-accepted untyped-supertest/BullMQ-mock category remains, matching Story 8-1's established convention) all clean.

### Independent Review — Round 2 (one fresh-context reviewer, verifying round 1's atomicity fix)

Confirmed **RESOLVED**, not cosmetic: both writes are literal array elements of one `await this.prisma.$transaction([...])` call (`pos-sync.processor.ts:85-94`). Verified Prisma's array-form `$transaction` genuinely compiles to one `BEGIN…COMMIT/ROLLBACK` batch (traced into `@prisma/client`'s own runtime types, not taken on faith). Re-ran both suites against real Postgres independently: 15/15 unit, 20/20 integration. Hand-traced the new SQL-parity test's regex/normalization logic against the real files and confirmed it is a genuine diff check, not tautological (a real divergence would fail it). Investigated one theoretical residual — an `Order` deleted between the initial read and the transaction reverting an otherwise-correct classification — and confirmed it's structurally impossible: `POSSyncRecord_orderId_fkey` is `ON DELETE RESTRICT`, so Postgres refuses to delete an `Order` while a `POSSyncRecord` still references it. **One minor, non-blocking note**: the SQL-parity test's whitespace-normalization is global, so a whitespace-only difference *inside* the quoted `errorMessage` string literal (which Postgres preserves verbatim and would therefore actually matter) would be masked by the test. Not exploitable today — both files' string literals are currently identical — and any structural drift (a different WHERE clause, a reordered column, a changed CASE branch) is still caught. Left as a disclosed, low-priority residual rather than a third correction loop, since it is a meta-concern about one regression test's precision, not about any POS-sync truthfulness claim this story makes.

**No unresolved P0/P1 finding remains after two correction loops** (one of the three permitted was not needed).

## File List

- `backend/prisma/schema.prisma` (modified — `POSSyncStatus` gains `unsupported`, with a doc comment explaining each value's evidence semantics)
- `backend/prisma/migrations/20260815150000_pos_sync_unsupported_status/migration.sql` (new)
- `backend/prisma/migrations/20260815150100_pos_sync_correct_fabricated_records/migration.sql` (new)
- `backend/prisma/migrations/20260815150100_pos_sync_correct_fabricated_records/VERIFY.md` (new)
- `backend/prisma/scripts/correct-fabricated-pos-sync-records.ts` (new; standalone, re-runnable, kept textually in sync with the migration and proven so by an automated test)
- `backend/package.json` (modified — adds `correct-pos-sync-records` script)
- `backend/src/queue/processors/pos-sync.processor.ts` (rewritten — fabrication removed; round-1 review fix — both the record write and its Order mirror now issued inside a single `$transaction`)
- `backend/src/queue/processors/pos-sync.processor.spec.ts` (new; round-1 review — updated mock/assertions for the transaction fix)
- `backend/src/pos-sync/pos-sync-records.service.ts` (new)
- `backend/src/pos-sync/pos-sync-records.service.spec.ts` (new)
- `backend/src/pos-sync/pos-sync-records.controller.ts` (new)
- `backend/src/pos-sync/pos-sync.module.ts` (modified — registers the new controller/service)
- `backend/src/orders/orders.service.ts` (modified — explanatory comment at the `POSSyncRecord` creation site documenting the deliberate dormant-queue decision; no behavior change)
- `backend/src/orders/orders.service.spec.ts` (modified — new test for the non-`none`-adapter `POSSyncRecord` creation path)
- `backend/test/pos-sync.integration-spec.ts` (new; round-1 review — added the "migration/script SQL parity" drift-detection test)
- `_bmad-output/implementation-artifacts/deferred-work.md` (modified — new "Deferred from: Story 9-1" section, including two findings surfaced by independent review)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (modified — status tracking)
- `_bmad-output/implementation-artifacts/9-1-pos-sync-truthful-states.md` (this file)

## Change Log

- 2026-08-15 (round 1): Initial implementation. Corrected a material inconsistency in this story's own "Migration and Compatibility Considerations" section (it claimed `POSSyncStatus` enums were unchanged; the actual schema lacked the `unsupported` value it depended on) before implementing. Schema + two migrations (split because Postgres forbids using a newly-added enum value within the same transaction that added it, confirmed directly against real Postgres) + processor rewrite (fabrication removed entirely; `none` → `not_applicable`, any other adapter type → `unsupported`, both via a single guarded compare-and-swap) + historical-row correction (migration + standalone script, keyed on the record's own `adapterType`, not a venue join — a bug in the first version was caught by a dedicated integration test before landing) + new read-only admin visibility API (mirroring Story 8-1's `PrinterJobsController` pattern) + unit and real-Postgres integration tests delivered as one vertical slice. Migrations executed and verified against both the populated shared dev database (confirmed genuine no-op: 0 pre-existing fabricated rows) and a disposable clean container. Status set to `review` pending the independent review loop.
- 2026-08-15 (round 1, continued — independent review): Four parallel fresh-context reviews run (state-machine, replay/failure/concurrency, security/tenancy, verification-gap). State-machine and security/tenancy: no findings. Replay/concurrency review found one real P0 (the `POSSyncRecord` write and its `Order.posSyncStatus` mirror were non-transactional, risking permanent divergence on a crash between them) — fixed by batching both into a single `$transaction`. Verification-gap review answered its mandated question (nothing currently detects a lost Idealpos acknowledgment or a duplicate submission — an accurately-disclosed scope boundary, not a gap this story could close) and surfaced one real, previously-undisclosed P1 (the correction migration and its standalone script had no automated drift check) — fixed by adding a normalized-SQL-equality test. Two lower-priority, disclosed-not-fixed findings (the fabrication-regex guard's file-scoping; no real-BullMQ-worker test) restated in `deferred-work.md` with concrete future owners. Full validation re-run clean: 351/351 unit, 75/75 real-Postgres integration (reproduced across 2+ full-suite runs and 3+ standalone runs of the new file), `tsc`/`build`/`prisma validate`/lint all clean. One correction loop used of the three permitted.
- 2026-08-15 (round 2 — fresh-context verification of round 1's fix): Confirmed the atomicity fix is genuine (not cosmetic) and that Prisma's array-transaction API provides real Postgres-level atomicity; re-ran both suites independently (15/15 unit, 20/20 integration); hand-verified the new drift-detection test is a real diff check, not tautological; investigated and ruled out one theoretical residual divergence path (structurally prevented by an existing `ON DELETE RESTRICT` foreign key). One minor, non-blocking note (the drift test's whitespace-normalization could theoretically mask an in-string-literal-only difference) left as a disclosed residual rather than triggering a third correction loop. No unresolved P0/P1 finding remains. Status set to `done`.
