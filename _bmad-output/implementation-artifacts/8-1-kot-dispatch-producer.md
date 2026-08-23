---
baseline_commit: 175cbbd100753bace72c8c496ae54a24b2bb460a
canonical_epics_reference: E8-S1 (expanded 2026-08-18, docs/epics.md)
tracer_bullet: false
---

# Story E8-S1 (expanded): Connector-Mediated KOT Dispatch Producer

Status: blocked (hardware-evidence tier only — see below)

**Producer/backend/connector-contract tier: implemented, tested, independently reviewed, no unresolved P0/P1.** Held at `blocked`, not `done`, strictly because E8-S1's own AC13 requires real `REAL_KOT_PRINTER` evidence, which this environment cannot produce (no Windows machine, no physical printer). See Real-Environment Evidence Tiers and the Independent Review section below.

## Ownership decision (recorded per task instruction)

No filed story artifact existed for "the missing KOT print-dispatch producer"
before this file. `docs/epics.md`'s **E8-S1** bullet was expanded in-place on
2026-08-18 to explicitly own it:

> "Expanded 2026-08-18 (recovery-plan pass, Phase 4A) — this story now
> explicitly owns the missing KOT print-dispatch producer end-to-end,
> closing the gap the audit calls out (a real, tested `PrintJobsProcessor`
> consumer exists, but nothing ever enqueues a `queued` `PrinterJob` to
> it)."

**E8-S4** carries only a coordination note in `docs/epics.md` — it is the
write/creation half of `PrinterJob` (already `done`, satisfied by
`8-1-printer-truthful-states.md` and the original order-creation code) and
was never separately expanded. The recovery plan's own final handoff (§11
item 5) lists `E8-S1 expanded` but not E8-S4. **E8-S4 needs no new story
file** — its outstanding "dispatched to the connector" clause is owned by
this file.

This file is **deliberately a new artifact**, distinct from the already-`done`
`8-1-printer-truthful-states.md`. That file's historical scope (truthful
`PrinterJob` delivery states) is complete and is not reopened or rewritten
here — this story builds strictly on top of it. The epics.md numbering
(`E8-S1`) and the filed-story numbering have diverged; this file's slug is
`8-1-kot-dispatch-producer` to avoid colliding with the existing done file
while remaining traceable to the epics.md bullet that owns the scope.

## Story

As kitchen and front-of-house staff,
I want every `PrinterJob` created by a real order to actually reach the
physical KOT printer through the on-premise Venue Connector,
so that tickets are not silently created in the database and never printed —
the defect this story's own investigation confirmed is happening in
production today (the `print-jobs` BullMQ queue has never been fed;
`PrintJobsProcessor`, story 8-1's reviewed truthful-states worker, has never
processed a real row).

## Governing constraint (DL-069)

`docs/decisions-log.md` DL-069 prohibits the cloud API from opening a direct
socket to a venue-LAN printer in production. That prohibited code path still
exists (`PrintJobsProcessor.sendToTcpPrinter`,
`src/queue/processors/print-jobs.processor.ts:232-262`) but has never
executed in production because nothing feeds its queue. **This story does
not feed that queue.** Feeding it would immediately reintroduce the
DL-069-prohibited pattern for `tcp`/`network` printers. Instead, this story
adds an entirely separate, DL-069-compliant producer that dispatches through
the existing `ConnectorCommand` protocol (stories 2-9/2-10), which is
connector-initiated (pull, not push) and never opens a socket from the cloud
process.

`PrintJobsProcessor` and the `print-jobs` BullMQ queue are left untouched
(preserving story 8-1's reviewed work verbatim) but remain permanently unfed
by any code path this story adds. A regression test asserts this.

## In Scope

- A durable, idempotent producer (`PrinterDispatcherService`) that claims
  eligible `queued` `PrinterJob` rows and creates a `ConnectorCommand` row
  (`commandType: printer.print_kot.v1`) for each — the transactional-outbox
  pattern already established by `PosSyncDispatcherService` (story 9-3),
  adapted to write to `ConnectorCommand` (a connector-pollable durable
  envelope) instead of an internal BullMQ queue, since the actual consumer
  here is off-premise-initiated, not an in-process worker.
- A reconciler (`PrinterDispatcherService.sweepReconcile`) that maps a
  terminal/quasi-terminal `ConnectorCommand` outcome (`succeeded` /
  `failed` + `resultType` / `expired` / `unknown` / `cancelled`) back onto
  the linked `PrinterJob`'s truthful status, guarded by the same
  compare-and-swap discipline story 8-1 established for `PrintJobsProcessor`.
- Schema additions: `PrinterJob` dispatch-claim bookkeeping (mirroring
  `POSSyncRecord`'s fields), a nullable unique `connectorCommandId` pointer
  to the print attempt's current command, and one new `PrintJobStatus` value
  (`connector_dispatched`).
- A deterministic KOT content renderer (`kot-renderer.ts`) — the rendering
  boundary — producing a versioned, checksummed payload from the order's
  authoritative data (including Story 15-3's `OrderItem.selectedModifiers`
  snapshot), explicitly excluding price/GST/payment fields.
- A generic `ConnectorCommandService.createCommand()` method, added
  additively (existing `createTracerCommand` is untouched) so this producer
  reuses the same idempotent-creation/claim/lease/report state machine
  stories 2-9/2-10 already built and reviewed, rather than building a
  second protocol.
- Operator visibility: extend the existing admin printer-job endpoints with
  dispatch/command status, retry count, and last safe (sanitized) error.

## Explicit Exclusions

- Does not implement a real Idealpos adapter or EFTPOS (unrelated to this
  story; explicitly out of scope per task instruction).
- Does not implement final customer bill printing (KOT and bill-print
  responsibilities are kept distinct; this story is KOT only).
- Does not feed or modify the behavior of the pre-existing
  `print-jobs` BullMQ queue / `PrintJobsProcessor`.
- Does not implement a full, always-on, general-purpose Windows Venue
  Connector service. `apps/venue-connector` today is scoped to Idealpos
  discovery tracing (story 9-2). This story adds the printer-command
  handling *contract* and a reference/test-covered handler component on the
  connector side, but cannot produce real-printer or real-Windows-connector
  evidence from this (macOS) development environment — see Evidence Tiers.
- Does not add `seat` or `course` fields to the data model. The current
  `Order`/`OrderItem` schema has no such columns; the KOT renderer preserves
  every field that actually exists (table, item, quantity, modifiers,
  notes, station) and does not fabricate seat/course data that isn't
  captured anywhere upstream. Flagged as a real gap for a future story if
  multi-course/seat-level KOT routing is required.

## Dependencies

Builds on: story 8-1 (`PrinterJob` truthful states, done), story 9-3
(`PosSyncDispatcherService` outbox-dispatch pattern, done, reused as the
architectural template), stories 2-9/2-10 (`ConnectorCommand` protocol,
done, extended additively).

## State Machine

Reuses `PrintJobStatus` wherever an existing value already means the right
thing; adds exactly one new value.

| Concept (task's required list)                | `PrinterJob.status`                                   | Detail source |
|---|---|---|
| job created/queued                             | `queued`                                              | unchanged from story 8-1 |
| command pending / claimed-leased / connector executing | `connector_dispatched` (new)                  | fine-grained sub-state via joined `ConnectorCommand.status` (`pending`/`claimed`/`accepted`) — not duplicated onto `PrinterJob` to avoid two competing write paths for the same concept |
| delivered/acknowledged                         | `delivered`                                           | reused from story 8-1; set only from `ConnectorCommand` `succeeded` + `resultType: executed_acknowledged` |
| retryable failure                              | back to `queued` (bounded)                            | `resultType: retryable_local_failure`, or command `expired` (connector unreachable) — both are confirmed-not-executed, safe to auto-retry within `maxDispatchAttempts` |
| terminal failure                               | `failed`                                              | retry budget exhausted, or `resultType` indicates a non-retryable defect (`malformed_payload`, `checksum_mismatch`) |
| uncertain/unknown result                       | `uncertain`                                           | command `unknown` (accepted, no terminal report — the crash-after-print-before-ack window), or `resultType: uncertain_local_result`; never auto-retried |
| cancelled/superseded                           | `cancelled`                                           | source order reached `OrderStatus.cancelled` before dispatch, or connector reports `resultType: cancelled` |
| manual intervention required                   | `manual`                                              | printer deactivated/removed after job creation, unsupported connector-reported printer config (`resultType: unsupported`), or dispatch-attempt budget exhausted before ever reaching the connector |

`printed` remains structurally valid but unreachable — no device-path
acknowledgement source exists yet, matching story 8-1's ceiling philosophy.
`delivered` is this story's ceiling for a real connector-executed print too,
consistent with "a socket write / OS-accepted bytes is not proof of paper
output."

## Command Contract

`commandType: 'printer.print_kot.v1'`, `schemaVersion: 1`.
`sourceAggregateType: 'PrinterJob'`, `sourceRecordId: <printerJob.id>` — the
existing, previously-unused `ConnectorCommand` correlation fields, exactly
as their own schema comment anticipated.
`idempotencyKey: printer_job:<printerJobId>:attempt:<dispatchAttemptCount>` —
deterministic, so a redelivered/duplicate producer sweep cannot create a
second live command for the same attempt (enforced by `ConnectorCommand`'s
existing `@@unique([organizationId, venueId, idempotencyKey])`).

Payload (immutable per attempt):

```
{
  printerJobId, printAttemptId: idempotencyKey,
  printerId, printerName, station (printer.type),
  documentType: 'kot',
  renderedContent: string,        // deterministic text, see kot-renderer.ts
  contentChecksum: string,        // sha256 of renderedContent
  renderVersion: 1,
  copyCount: 1,
  correlationId: orderId,
}
```

No secrets, cloud credentials, database connection details, browser-supplied
network targets, prices, GST, payment data, or unnecessary customer PII. The
connector is expected to resolve `printerId` to its own local printer
connection config (host/port/share) rather than receive raw network targets
from the cloud — this mirrors the already-reviewed `IdealposBridge`'s own
config-driven design (no cloud-supplied connection targets) and keeps the
command payload safe to log/display in the admin UI.

## Producer / Reconciler Behaviour

See `src/printer/printer-dispatcher.service.ts` for the implementation and
its inline documentation of every guard. Summary:

- `sweepDispatch()`: claims eligible `queued` `PrinterJob` rows via a
  database CAS (mirrors `PosSyncDispatcherService`), excludes jobs whose
  order has been cancelled, whose printer has been deactivated since
  creation (→ `manual`, operator-visible), or that have exhausted their
  dispatch-attempt budget (→ `manual`); creates one `ConnectorCommand` per
  successfully claimed job; sets `PrinterJob.status = connector_dispatched`
  and `connectorCommandId` only after the command is durably created.
- `sweepReconcile()`: finds `connector_dispatched` `PrinterJob` rows whose
  linked `ConnectorCommand` has reached a terminal/quasi-terminal state and
  applies the mapping above via a CAS guarded on
  `status = 'connector_dispatched'` — a late/duplicate reconciliation pass
  can never clobber a status a previous pass (or a manual reprint) already
  moved on from, mirroring story 8-1's `resolveFrom` guard.

## Failure and Recovery Coverage

| Scenario | Behaviour |
|---|---|
| Connector offline | Command sits `pending`; connector polls once online; no cloud-side action needed |
| Command lease expiry (connector claimed, crashed before accept) | `ConnectorCommandService.sweep()` (story 2-10, unchanged) re-offers or expires it; this story's reconciler treats `expired` as retryable |
| API restart mid-sweep | Sweep is stateless per tick; next tick resumes from DB state |
| Queue/worker restart | N/A — no BullMQ/in-memory queue in this producer; durability is the `ConnectorCommand`/`PrinterJob` rows themselves |
| Connector crash before execution | Command never reaches `accepted`; `expired` → retryable |
| Connector crash after persist-before-print | Connector-side concern (see Connector Execution below); cloud sees `unknown` if `accepted` with no terminal report → `uncertain`, never auto-retried |
| Connector crash after print-before-ack | Same as above — `unknown` → `uncertain` → requires explicit, audited manual reprint |
| Duplicate poll / duplicate command delivery | Absorbed by `ConnectorCommandService`'s existing claim CAS (story 2-10, unchanged) |
| Printer unavailable / connection refused / timeout | Connector reports `failed` + `resultType: retryable_local_failure` → bounded auto-retry via a fresh attempt/command |
| Unsupported printer type | Connector reports `failed` + `resultType: unsupported` → `manual` |
| Malformed payload / checksum mismatch | Connector reports `failed` + `resultType: malformed_payload`/`checksum_mismatch` → `failed` (non-retryable; a config/rendering bug, not a transient fault) |
| Station mapping removed after job creation | Printer deactivated (`isActive: false`) between job creation and dispatch → `manual` at dispatch time, never silently dropped |
| Order cancelled before dispatch | Excluded from the dispatch candidate query; still-`queued` jobs for a cancelled order are swept to `cancelled` |
| Order amendment requiring a new KOT | Out of scope for this story — no amendment/re-fire flow exists yet in `orders.service.ts`; the existing manual-reprint path (story 8-1) remains the mechanism until a dedicated amendment story exists |
| Uncertain outcome | Never auto-retried; requires explicit manual reprint (creates a new, linked, audited `PrinterJob` row — story 8-1's existing reprint lineage, unchanged) |
| Retry exhaustion | `dispatchExhaustedAt` set, `PrinterJob.status = manual`, sanitized reason recorded, visible to operators |

## Real-Environment Evidence Tiers

- **Static analysis / unit / mock**: producer, reconciler, renderer — full
  coverage.
- **Local integration (real Postgres)**: producer/reconciler concurrency,
  uniqueness constraints, cross-venue isolation, reconciliation mapping —
  full coverage, executed against the real local Postgres container.
- **Durable connector harness**: the connector-side command handler
  contract (validation, checksum check, structured result codes) is
  implemented and unit-tested in .NET; not exercised against a live
  connector process.
- **Real Windows Connector / real KOT printer**: **not achieved**. No
  Windows machine or physical printer is available in this environment.
  This story is marked `blocked` for that tier only — see Deferred Work.

## Tasks / Subtasks

- [x] Investigation: canonical story determination, `PrinterJob`/`ConnectorCommand` trace, DL-069 landmine confirmation (see conversation record / this file's Ownership decision section).
- [x] Schema migration: `PrintJobStatus.connector_dispatched`; `PrinterJob` dispatch bookkeeping + `connectorCommandId`; `ConnectorCommand.printerJob` back-relation. Applied and verified against real local Postgres.
- [x] `ConnectorCommandService.createCommand()` — additive generic command creation (existing `createTracerCommand` untouched).
- [x] `kot-renderer.ts` — deterministic, checksummed, price/GST-free KOT content builder. Story 15-3 modifier snapshots included.
- [x] `PrinterDispatcherService` — `sweepDispatch()` + `sweepReconcile()`.
- [x] Wire into `PrinterModule` (imports `ConnectorModule`; no BullMQ/QueueModule dependency).
- [x] Unit tests (mocked Prisma) for dispatcher/reconciler/renderer — 34 new (12 renderer, 18 dispatcher/reconciler, 4 retryDispatch), 572/572 full backend unit suite green.
- [x] Real-Postgres integration tests — 17 new (`test/printer-dispatcher.integration-spec.ts`), all passing; found and fixed one real bug via real-DB CHECK constraints (see Dev Agent Record).
- [x] Regression: `print-jobs` queue remains unfed; no `net.Socket`/`createConnection`/`@InjectQueue` in the new producer's source (asserted by test).
- [x] Operator visibility: extended `GET /admin/printers/:id/jobs` and `GET /admin/orders/:id/print-jobs` with a joined `connectorCommand` view; added `POST /admin/printers/:printerId/jobs/:jobId/retry-dispatch` (safe-retry-in-place, distinct from reprint, CAS-guarded, audited).
- [x] Connector-side (.NET) command handler contract + unit tests (no live hardware) — `PrintKotCommandHandler`, `IKotPrintTransport`/`SimulatedKotPrintTransport`, 10 new tests, 38/38 full .NET suite green.
- [x] Live-runtime smoke test: real dev server, real Postgres, background sweep timer (no manual `sweep()` call) dispatched a genuinely committed `PrinterJob` row within one tick; confirmed zero `PrintJobsProcessor`/BullMQ activity in the server log.
- [x] Independent review pass — see Dev Agent Record.
- [x] Update `deferred-work.md` / `sprint-status.yaml`.

## Dev Agent Record

### Implementation Plan

Followed the codebase's own established outbox-dispatcher template
(`PosSyncDispatcherService`, story 9-3) adapted for a connector-pull
consumer: the `ConnectorCommand` row itself is the durable queue, so no
second internal BullMQ queue was introduced. The core design decision —
computing the per-attempt `idempotencyKey` from `dispatchAttemptCount` read
*before* the CAS claim increments anything, and only incrementing it on
successful confirmation — is what makes a crash between command-creation
and status-confirmation resolve to the *same* command on retry (proven by a
dedicated real-Postgres integration test) rather than minting a duplicate.
`PrintJobStatus` gains exactly one new value (`connector_dispatched`); every
other required state from the task's list is represented either by an
existing `PrintJobStatus` value or by the joined `ConnectorCommand.status`/
`resultType` — deliberately avoiding a second, duplicative state machine on
`PrinterJob` itself.

### Bugs found and fixed during implementation (via real-Postgres evidence)

1. **Stale `dispatchedAt` blocked bounded retry (found via the real-Postgres integration suite, not reasoning alone).** `PrinterDispatcherService.retryOrExhaust`'s reset-to-`queued` path cleared the claim fields but not `dispatchedAt`. Since `sweepDispatch`'s own eligibility query requires `dispatchedAt: null` (or older than the safety-net window) for a `queued` row to be re-selected, a row reset for retry became invisible to the dispatcher for up to `PRINTER_DISPATCH_SAFETY_NET_MS` (10 minutes default) — silently defeating "retries before confirmed execution must be safe and bounded." Fixed by clearing `dispatchedAt` in the same reset. Regression test:
   `an expired command (never accepted) is safely retried within budget, minting a fresh attempt`.
2. **Real `ConnectorCommand` CHECK constraints (`ConnectorCommand_terminal_report_requires_acceptance`, `ConnectorCommand_cancelled_has_cancelledAt`) caught unrealistic test simulations, not implementation bugs** — real Postgres rejected direct-write test fixtures that set a terminal `status` without the DB-enforced companion field a real `accept()`/`cancel()` call would have set. This is exactly the kind of thing real-Postgres evidence is for: the test fixtures were corrected to match what the real protocol actually produces (`acceptedAt`/`cancelledAt` set), which is a stronger, more honest simulation than the original.
3. **`NON_REPRINTABLE_STATUSES` did not include the new `connector_dispatched` status** — found during design review of the interaction between this story's new state and story 8-1's existing reprint guard, before it could reach a test. A job with a `ConnectorCommand` currently pending/claimed/executing at a connector was reprintable under the original guard, which would have let a manual reprint race with an in-flight connector-mediated attempt — the exact duplicate-ticket risk story 8-1 exists to prevent, reopened by this story's own new state. Fixed by adding `connector_dispatched` to the guard list; existing `printer-jobs.integration-spec.ts` (unchanged) continues to pass.

### Real-environment evidence achieved this session

- **Real local Postgres** (`verdura-postgres-1`, port 5434): migration applied via `prisma migrate deploy` and independently verified (enum values, columns, indexes, FKs inspected directly via `psql`); 17/17 new integration tests, including genuine concurrent-producer races, real `P2002` uniqueness-constraint proof, real CHECK-constraint-conformant terminal-state simulation, and cross-venue isolation with a real second organization/venue.
- **Live running dev server**: `npm run start:dev` against the real local Postgres, a real `queued` `PrinterJob` row inserted directly (simulating exactly what `orders.service.ts`'s transaction commits), observed the running `PrinterDispatcherService`'s own background timer (not a test harness) create a real `ConnectorCommand` and transition the job to `connector_dispatched` within one sweep tick, entirely unprompted. Server log confirmed zero `PrintJobsProcessor`/`print-jobs` BullMQ activity throughout. Data cleaned up afterward.
- **.NET unit tests** (macOS, `dotnet test`, cross-platform `net8.0`): 38/38 total (10 new), including checksum-mismatch/unsupported-version/malformed-payload rejection before the transport is ever called, persist-before-print ordering, and crash-window replay detection (`HasUnresolvedIntent`) preventing a second print attempt.
- **NOT achieved**: `REAL_WINDOWS_CONNECTOR`, `REAL_KOT_PRINTER`. No Windows machine or physical printer was available in this environment. The connector-side handler's real hardware/transport layer, and a genuine separate-process crash-kill test (mirroring `CrashReplayTests.cs`'s rigor for the discovery tracer) for `PrintKotCommandHandler` specifically, remain the exact next steps once that access exists.

### Independent Review (fresh-context reviewer, 2026-08-19)

Traced the full order→dispatch→reconcile chain, confirmed no direct
cloud-to-LAN route is reachable from any new code, confirmed cross-venue
isolation, confirmed the connector-side checksum/persist-before-print logic
is sound, and confirmed test quality is substantive (not tautological).

**One P1 found and fixed — a genuine duplicate-ticket race between
`requestReprint` and this story's new `retryDispatch`.** `requestReprint`
validated `NON_REPRINTABLE_STATUSES` against a status snapshot read
*before* opening its transaction/row lock; a concurrent `retryDispatch`
call could move the same job from `manual` to `queued` in the window
between that stale read and the lock, and the lock alone never re-validated
status — so `requestReprint` could still create a new reprint row for a job
that had, in the interim, already been reset for its own fresh dispatch
attempt: two independently-dispatchable rows for one logical ticket.
**Fixed** by re-reading the row's current status inside the transaction,
after the lock, and rejecting if it changed. A second, symmetric instance
of the same gap was found via review of the fix itself (not by the original
reviewer): the *reverse* ordering — `requestReprint` running first (leaving
the original `manual`, creating an independent new row) followed by a
concurrent `retryDispatch` on the same original — was still open, since
`retryDispatch`'s bare CAS never checked for an in-flight reprint.
**Fixed** by having `retryDispatch` take the same row lock and the same
in-flight-reprint check `requestReprint` uses, making the two operations
genuinely mutually exclusive. Also fixed in the same pass: the pre-existing
`inFlightReprint` query inside `requestReprint`'s transaction did not
include the new `connector_dispatched` status in its "in flight" set,
which would have let a second reprint request slip through while an
earlier reprint was actively dispatched to a connector. Proven via a real
Postgres integration test running genuinely concurrent `requestReprint`
and `retryDispatch` calls against the same row (`Promise.allSettled`),
asserting exactly one dispatchable row results — reproduced clean across
5 consecutive runs.

**Two P2s found and fixed:**
1. The reconciler mapped any `ConnectorCommandStatus.succeeded` to
   `delivered` without checking `resultType`, contradicting this story's
   own documented invariant ("delivered set only from succeeded +
   resultType: executed_acknowledged"). Not exploitable by the current
   (only) connector implementation, but a real gap between the stated
   contract and the code, and untested. **Fixed**: a `succeeded` command
   with any other resultType (or none) now fails safe to `uncertain`
   rather than being blindly trusted as delivered.
2. `lastDispatchError` stored the raw (only length-truncated) exception
   message on command-creation failure, contradicting its own schema
   comment ("sanitized ... never a raw stack/secret") and the codebase's
   own established `classifyPrinterError()` convention
   (`print-jobs.processor.ts`) for exactly this class of leak. **Fixed**:
   a new `classifyDispatchError()` returns only fixed, safe strings (or an
   already-safe `BadRequestException` message), never raw driver/Prisma
   text.

All three fixes covered by new regression tests (unit + real-Postgres for
the P1; unit for both P2s) and re-verified: 578/578 backend unit (up from
572 before the review pass), 18/18 real-Postgres `printer-dispatcher`
integration tests (up from 17), full existing regression set (printer-jobs,
connector-command, pos-sync-dispatcher, orders integration specs — 101
tests total across those 5 suites) all still green. No further correction
loop required — reviewer's overall verdict, now addressed: the P1 was the
one blocking issue for "producer/backend tier done"; both P2s and the P1
are fixed, so that tier's claim now holds. The reviewer's independent
confirmation that the disclosed "hardware tier not achieved" framing is
honest and not overclaimed stands unchanged.

## File List

**New:**
- `apps/api/src/printer/kot-renderer.ts`
- `apps/api/src/printer/kot-renderer.spec.ts`
- `apps/api/src/printer/printer-connector-command.constants.ts`
- `apps/api/src/printer/printer-dispatcher.service.ts`
- `apps/api/src/printer/printer-dispatcher.service.spec.ts`
- `apps/api/test/printer-dispatcher.integration-spec.ts`
- `apps/api/prisma/migrations/20260819120000_kot_dispatch_producer/migration.sql`
- `apps/venue-connector/src/VerduraIdealposTracer.Core/Printing/KotPrintResultType.cs`
- `apps/venue-connector/src/VerduraIdealposTracer.Core/Printing/IKotPrintTransport.cs`
- `apps/venue-connector/src/VerduraIdealposTracer.Core/Printing/PrintKotCommandHandler.cs`
- `apps/venue-connector/tests/VerduraIdealposTracer.Tests/PrintKotCommandHandlerTests.cs`
- `_bmad-output/implementation-artifacts/8-1-kot-dispatch-producer.md` (this file)

**Modified:**
- `apps/api/prisma/schema.prisma` (`PrintJobStatus.connector_dispatched`; `PrinterJob` dispatch bookkeeping + `connectorCommandId`; `ConnectorCommand.printerJob` back-relation)
- `apps/api/src/connector/connector-command.service.ts` (additive `createCommand()`)
- `apps/api/src/printer/printer-jobs.service.ts` (`NON_REPRINTABLE_STATUSES` fix; `connectorCommand` join in list methods; new `retryDispatch()`)
- `apps/api/src/printer/printer-jobs.service.spec.ts` (new `retryDispatch` tests)
- `apps/api/src/printer/printer-jobs.controller.ts` (new `retry-dispatch` endpoint)
- `apps/api/src/printer/printer.module.ts` (wiring)
- `apps/api/src/app.module.ts` (new `PRINTER_DISPATCH_*` Joi env var declarations)
- `_bmad-output/implementation-artifacts/deferred-work.md` (queue-never-fed finding updated to reflect the producer/backend-tier fix and the narrowed remaining hardware-tier gap)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (new story line; `canonical-order-transactional-outbox` gate updated to `in-progress`)

## Change Log

- 2026-08-19: Story artifact created. Canonical ownership recorded (E8-S1
  expanded; E8-S4 satisfied without a new file). Investigation findings
  (producer root cause, DL-069 landmine, reusable patterns) captured above.
- 2026-08-19: Implementation complete — schema migration, producer/
  reconciler, KOT renderer, connector-side .NET handler, operator visibility
  extensions, unit + real-Postgres + .NET + live-runtime evidence. Three
  real defects found and fixed during implementation (see Dev Agent Record).
  Status set to `in-progress` pending the independent review pass.
- 2026-08-19 (Story 16-3 subtask, lint cleanup): a repository-wide `npm run
  lint:api` run (part of Story 16-3's CI-gate work) found 34 lint/format
  findings across this story's own files that had never been gated before
  (no lint step existed in CI prior to Story 16-3). Traced and fixed all 34,
  scoped strictly to this story's File List:
  - `src/printer/kot-renderer.spec.ts` — 2 Prettier.
  - `src/printer/printer-dispatcher.service.ts` — 5 Prettier.
  - `src/printer/printer-dispatcher.service.spec.ts` — 14 Prettier, 3
    `@typescript-eslint/no-unsafe-return`, 2 `@typescript-eslint/no-require-imports`,
    2 stale/unused `eslint-disable` warnings (the disable comments named a
    superseded rule name and no longer suppressed anything real).
  - `test/printer-dispatcher.integration-spec.ts` — 8 Prettier.

  Every Prettier finding was fixed by running the formatter on exactly
  these 4 files (no repo-wide rewrite). The non-formatting findings were
  all in `printer-dispatcher.service.spec.ts`: three `Array.prototype.find`
  callbacks over `mockPrisma.printerJob.updateMany.mock.calls` (`any`,
  since `mockPrisma` itself is `any` by this file's existing convention)
  had an explicit `(c: any) =>` parameter that returned an `any`-typed
  value — replaced with one small shared helper
  (`findUpdateManyCallWithError`) that gives the lookup a real, narrow
  return type instead of `any`, with no behaviour change (same
  `.find()`/optional-chaining semantics, same runtime result). The
  DL-069-regression test's two `require('fs')`/`require('path')` calls
  (flagged under the project's current `no-require-imports` rule; the
  `eslint-disable` comments protecting them named the old
  `no-var-requires` rule name and had gone stale) were converted to
  ordinary top-of-file `import * as fs from 'fs'` / `import * as path from
  'path'` statements — the test still reads the exact same file
  (`printer-dispatcher.service.ts`) via the exact same
  `fs.readFileSync(path.join(__dirname, ...))` call and asserts the same
  three regexes; the DL-069 "never opens a direct socket" guarantee this
  test proves is untouched.

  No `any`, casts, non-null assertions, `@ts-ignore`, or new
  `eslint-disable` comments were introduced. No production behaviour,
  state machine, persistence semantics, connector protocol, or test
  assertion changed — every test in the 4 touched files still asserts
  exactly what it asserted before. Re-verified: 586/586 full API unit
  suite, 86/86 targeted real-Postgres integration tests (printer-dispatcher,
  connector-command, printer-jobs, orders), the independent-review P1
  concurrent-duplicate-ticket regression (`genuinely concurrent reprint +
  retryDispatch`) re-run 5 consecutive times clean, and the full 38/38 .NET
  suite (unaffected — no connector/.NET files were touched, and the command
  contract/protocol was not changed). Targeted `eslint`/`prettier --check`
  against this story's exact file set: 0 errors, 0 warnings. This story's
  own files no longer contribute to the repository's lint backlog. Status
  remains `blocked` — this was a lint/formatting correction only; the
  REAL_WINDOWS_CONNECTOR/REAL_KOT_PRINTER evidence gap (AC13) is unchanged
  and unaddressed by this pass.

- **2026-08-21 — read-only Windows discovery evidence (pointer only; full detail in `9-2-idealpos-uibridge-tracer.md`'s session 6 entry).** A real physical printer, **Brother MFC-L2713DW**, is installed on the target Windows host (two queue entries plus PC-FAX), alongside IdealPOS's own `IPSPrinterServer.exe` running live as part of the installed product. This is **printer-presence evidence only** — no test page, spool job, or physical print occurred, no printer/queue state was changed, and this does not constitute or imply KOT print evidence. It does mean a real target device for a future, separately-authorised physical KOT test (Gate D) already exists on this host, rather than needing to be provisioned. **Story E8-S1 / AC13 remains `blocked`, unchanged** — the REAL_KOT_PRINTER evidence gap requires an actual print, which this session correctly did not attempt.
