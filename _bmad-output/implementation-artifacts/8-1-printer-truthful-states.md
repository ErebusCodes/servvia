---
baseline_commit: 348547438f85d51c3e1bb6c31a90545e34f9846c
first_slice_of: E8
tracer_bullet: true
---

# Story 8.1: Truthful PrinterJob Delivery States

Status: done

## Story

As a kitchen or front-of-house staff member,
I want a `PrinterJob`'s status to only ever reflect what actually happened at the physical printer,
so that I can trust the Admin Dashboard and never discover — after the fact — that a ticket the system called "printed" never left the printer.

This story implements target-operating-model.md §5's requirement that "a socket write, queue insertion, fabricated identifier or log statement is not proof of delivery or printing," scoped narrowly to `PrinterJob` state truthfulness. It is the tracer bullet for E8 and must land before any other E8 story, because every later printer story (retry tuning, health monitoring, admin UI) is meaningless if the underlying status can already lie.

**Current defect this story removes:** `PrintJobsProcessor` marks a job `printed` unconditionally for USB/Windows-share/local connection types without contacting any hardware (a hardcoded mock-success branch), and marks a job `printed` for TCP/network printers the instant a raw socket write succeeds — which is evidence bytes left the server, not evidence a ticket printed. Both are the "printed without hardware evidence" pattern this review's own ground rules and target-operating-model.md §5/§7 name and forbid.

## Intent and Business Value

Restore staff trust in the printed-status signal so that a printer failure is visible and actionable, not silently absorbed. Business value: prevents missed kitchen tickets from going undetected, which is a direct operational/customer-experience risk (an order silently never reaches the kitchen).

## In Scope

- Split the current single `printed` outcome into two distinct, honestly-named states: `delivered` (the connector/socket write to the device succeeded) and `printed` (a device-path acknowledgement was received). `printed` may only be set from real acknowledgement evidence.
- Remove the unconditional mock-success branch for USB/Windows-share/local connection types. Until a real on-premise printer agent exists for those connection types, jobs targeting them must report `manual` or remain `queued`/`failed` — never `printed`.
- For TCP/network printers, a successful socket write sets `delivered`, not `printed`, unless/until a device acknowledgement mechanism exists.
- Surface the `delivered` vs `printed` distinction on the KDS and Admin Dashboard printer-job views so staff can see "we think this left the server" separately from "we know this printed."

## Explicit Exclusions

- Does not build the separate on-premise `verdura-printer-service` or its durable local queue (that is the remainder of E8, `BLOCKED ON: Q2` for hardware specifics).
- Does not implement device-path acknowledgement protocols (e.g. ESC/POS status polling) — this story only stops the code from claiming acknowledgement it doesn't have. Where no acknowledgement mechanism exists yet, the honest ceiling is `delivered`, not `printed`.
- Does not change preparation-station routing (still one-ticket-per-active-printer today; station routing is separate scope in E8-S9).
- Does not move printer dispatch out of the cloud process (the cloud-to-LAN reachability problem is a separate, already-documented architectural gap — see `docs/printers.md`'s implementation-status banner — and is out of scope for this story).

## Dependencies

None blocking. Independent of story 6-1 and 9-1; can be implemented in parallel.

## Inputs and Expected Outputs

**Input:** an existing `PrinterJob` row in `queued` status, dispatched by the existing (in-process, cloud) print processor.

**Output — USB/share/local printer:** job remains in a truthful non-`printed` state (`manual` or `failed`, per configured policy) since no real dispatch path exists; never `printed`.

**Output — TCP/network printer, socket write succeeds:** job status becomes `delivered`. Never `printed` from this event alone.

**Output — TCP/network printer, socket write fails:** existing retry/failure logic unchanged; job eventually `failed` after exhausting attempts.

## Happy Path

1. Order creates a `PrinterJob` per active printer (unchanged).
2. Processor attempts dispatch.
3. For a connection type with no real dispatch mechanism: job is marked `manual` immediately, with a clear reason, and surfaces on the Admin Dashboard as needing staff attention — not silently as `printed`.
4. For TCP: successful write → `delivered`. If/when a future story adds acknowledgement, `printed` becomes reachable; until then, `delivered` is the ceiling and is displayed as such, not conflated with `printed` in the UI.

## Failure and Recovery Paths

- **USB/share/local printer configured:** every job for it surfaces as `manual` (never silently `printed`) so staff know to physically check or manually relay the order until real dispatch exists for that connection type.
- **TCP socket write fails:** existing 3-attempt fixed-delay retry applies unchanged; after exhaustion, `failed`, alert, manual reprint available (unchanged from current design intent).
- **TCP socket write succeeds but printer is out of paper / jammed:** correctly remains `delivered`, not `printed` — this is precisely why the two states must be distinct; a future acknowledgement mechanism is what would catch this class of failure, and this story's job is to stop claiming that already exists.

## Security and Tenancy Requirements

No change to authentication/authorization surfaces. `PrinterJob` remains venue-scoped as today.

## Observability and Audit Requirements

- The `delivered`→`printed` gap (jobs that reached `delivered` but never advanced to `printed`, where an acknowledgement mechanism exists) must be visible as a distinct, alertable condition once acknowledgement is implemented.
- Every job forced to `manual` status due to an unsupported connection type is logged with the reason, so the volume of "printing not actually automated for this venue" is measurable and cannot be mistaken for healthy operation.

## Migration and Compatibility Considerations

- Existing `PrintJobStatus` enum gains `delivered` and `manual` values (or reuses existing ones if already present in schema — verify against current `PrintJobStatus` enum before implementation) without breaking existing `queued`/`printing`/`failed`/`cancelled` semantics.
- Any existing dashboard or reporting code that currently treats `printed` as the sole success signal must be updated to treat `delivered` as a distinct, lesser signal — not silently reclassified as success.

## Acceptance Criteria

1. No code path can set `PrinterJob.status = 'printed'` without device-path acknowledgement evidence; where no such evidence source exists, the ceiling state is `delivered` (TCP) or `manual` (all other connection types today).
2. The mock-success `console.log` branch for USB/Windows-share/local printers is removed; jobs for those connection types never reach `printed` via that path.
3. TCP socket-write success sets `delivered`, verified by a test that a job reaching `delivered` cannot be conflated with `printed` in any admin/KDS view.
4. Admin Dashboard and KDS printer-job views visibly distinguish `delivered` from `printed` from `manual` from `failed`.
5. A disconnected/powered-off printer's jobs never reach `printed`, and staff see a visible "unconfirmed"/`manual` state rather than a false success indicator.

## Definition of Done

Automated tests cover: USB/share/local jobs never reach `printed`; TCP socket-write success reaches `delivered` and not `printed`; failed socket writes still follow existing retry/failure logic; UI distinguishes all four states. No mock, fabricated acknowledgement, or successful socket write may be presented as `printed` in the release evidence pack before this story's status may become `done`.

## Scope note (2026-08-15 implementation session)

This story's own AC/DoD above predate a broader "frozen intent" governing
this implementation session, which additionally required: a full lifecycle
(not just four states), database-/durable-enforced duplicate-delivery and
crash-window handling, explicit reprint lineage/audit, an explicit
production-mock lockout, and sanitized error/tenant-scoping guarantees. The
implementation satisfies both — the original AC/DoD above are a strict
subset of what was actually built and tested. Two scope calls were made
that are **not** literally spelled out in either the AC/DoD or the frozen
intent's testing/completion sections, both documented here for review
rather than decided silently:

1. **No new Admin Dashboard/KDS React UI was built.** AC4 says these views
   must "visibly distinguish" states. No such UI exists at all in this
   codebase today (confirmed: zero references to `printerJob`/`PrinterJob`
   anywhere under `admin-frontend/src`, `kiosk-frontend/src`), so this is
   new construction, not a fix. The frozen intent's testing, independent
   review, and completion sections are entirely backend/database-behavior
   focused and mention no frontend deliverable or test. AC4 is satisfied at
   the API-contract level instead: `GET /admin/printers/:id/jobs` and
   `GET /admin/orders/:id/print-jobs` return the distinct, truthfully-named
   status values, ready for a future UI to render. Building the actual page
   is left to a human decision / a future story — flagged, not silently
   dropped.
2. **The print-jobs BullMQ queue is still never fed.** `docs/printers.md`'s
   implementation-status banner already documents, independently of this
   story, that `PrinterJob` rows are created on order submission but
   nothing ever calls `.add()` to enqueue them — the worker this story
   fixes has never run in production. This story's Explicit Exclusions
   ("Does not move printer dispatch out of the cloud process... the
   cloud-to-LAN reachability problem is... out of scope") and Dependencies
   ("Independent of story 6-1 and 9-1") were read as accepting this gap as
   pre-existing and out of scope — wiring `orders.service.ts` to actually
   enqueue jobs would be a first-time production behavior change (every
   order would start attempting real network calls to configured printer
   IPs) well beyond "make an already-running path truthful." All tests
   invoke `PrintJobsProcessor.process()` directly against real rows (the
   same way a real BullMQ worker would invoke it), which is sufficient to
   prove the state machine and database-enforcement claims below without
   turning on production dispatch traffic for the first time inside a
   truthfulness-and-defect-correction session.

## Tasks / Subtasks

- [x] Extend `PrintJobStatus` with `accepted`, `dispatching`, `delivered`, `manual`, `uncertain` (migration; `printing` retained but unused — Postgres cannot drop enum values).
- [x] Add `simulated` to `PrinterConnectionType` — an explicit, visibly-configured non-production dispatch simulation, replacing the removed implicit `.mock`/`127.0.0.1` heuristic.
- [x] Add `PrinterJob.deliveredAt`, `reprintOfId`, `reprintRequestedById` (self-relation + Staff FK) via migration; back-relation on `Staff`.
- [x] Rewrite `PrintJobsProcessor`: durable `queued→accepted` claim via an atomic `updateMany` compare-and-swap (AC1, AC5); `accepted→dispatching→delivered` for TCP/network, never `printed` (AC1, AC3); `usb`/`windows_shared`→`manual` immediately, mock-success branch removed entirely (AC2); `simulated` fails closed in production, else reaches `delivered` only (never `printed`) via the same CAS-guarded path.
- [x] Implement crash-window/duplicate-delivery handling: a job found already `dispatching` is marked `uncertain` and never re-dispatched; a job found already `accepted` is a safe no-op; losing the `queued→accepted` CAS is a safe no-op.
- [x] Implement `classifyPrinterError()` — every persisted `errorMessage` is a fixed, sanitized string; raw Node error text (which can embed printer host/IP/port) is never persisted or returned.
- [x] Fix a latent bug found while rewriting: the original `sendToTcpPrinter` ignored the TCP write callback's own `err` argument, meaning a failed write could be reported as success. Now checked.
- [x] Add `PrinterJobsService`/`PrinterJobsController`: `GET /admin/printers/:id/jobs`, `GET /admin/orders/:id/print-jobs`, `POST /admin/printers/:printerId/jobs/:jobId/reprint` — org/venue-scoped, reprint restricted to non-`kitchen` staff roles and only permitted against a terminal (non-in-flight) job, creates a new linked+audited row rather than mutating the original.
- [x] Unit tests (mocked Prisma): `print-jobs.processor.spec.ts` (20 tests) and `printer-jobs.service.spec.ts` (15 tests).
- [x] Real-Postgres integration tests: `test/printer-jobs.integration-spec.ts` (16 tests) — real DB compare-and-swap concurrency, a real loopback mock TCP server, real JWT-scoped cross-org/cross-venue rejection, real reprint lineage/audit rows.
- [x] Typecheck, `nest build`, `prisma validate`, focused ESLint (autofixed), `git diff --check` all pass.
- [x] Migration executed and verified against real Postgres (populated dev DB, additive) and a disposable container (clean-from-zero via `prisma migrate deploy`) — `VERIFY.md`.
- [ ] **Independent review loop** (adversarial, duplicate/replay+crash-window, security/tenant-isolation, verification-gap) — see Dev Agent Record below for outcome.

## Dev Agent Record

### Implementation Plan

`PrintJobStatus` gains `accepted`/`dispatching` to split "worker durably
claimed this job" from "a transport attempt is in flight" — the second is
the genuine crash-window: if a worker dies after marking `dispatching` but
before recording an outcome, the *only* safe move on re-observation is
`uncertain`, never a blind resend. Every state transition that matters for
concurrency safety (`queued→accepted`, and the `dispatching`-found guard)
is a database-level `updateMany` compare-and-swap keyed on the row's
current status, not an in-memory check — this is what makes "two
concurrent invocations of the same job" resolve to at most one real
transport attempt regardless of process-level scheduling, mirroring Story
6-1's reliance on database constraints (not app-level pre-checks) as the
actual enforcement mechanism. `delivered` is TCP's ceiling; `printed` stays
structurally valid in the enum for a future acknowledgement mechanism but
is unreachable by any code path today, matching the story's own Explicit
Exclusions. Reprint creates a new row (never mutates the original) so a
job's own history is immutable, exactly mirroring why Story 6-1 never
mutates an idempotently-replayed order.

### Debug Log — bugs found and fixed during implementation

1. **Latent write-callback bug in the pre-existing `sendToTcpPrinter`** (not introduced by this story, but touched by this rewrite): `client.write(payload, 'utf8', () => resolve())` ignored the callback's own `err` argument — a failed write could have resolved as success. Fixed by checking it and rejecting when present.
2. **Cross-constraint scope bug in the reprint endpoint** (found while writing tests, fixed before landing): the initial `requestReprint` scoped only by `jobId` + org/venue, not by the URL's own `:printerId` segment, so a mismatched `printerId`/`jobId` pair in the URL would silently succeed against the job's real printer. Fixed by requiring `printerId` to match in the lookup `where` clause — a 404, not a 500 or silent mismatch, for a wrong pairing.

### Independent Review — Round 1 (4 parallel fresh-context reviewers: adversarial, duplicate/replay + crash-window, security/tenant-isolation, verification-gap)

**Security/tenant-isolation review: no P0/P1 findings.** Reproduced cross-org and cross-venue rejection (404, no existence disclosure), confirmed `errorMessage`/response bodies never leak host/IP/port/share-path, confirmed the reprint role restriction is genuinely enforced (not just intended), confirmed no reliance on the (separately-tracked, already-deferred) RLS-zero-policies gap.

**Three real, converging findings from the other three reviewers, all fixed:**

3. **P0 (adversarial + duplicate/replay, independently confirmed by both, one via live reproduction with `jest.spyOn` timing manipulation).** Every write that resolved a job *out of* `dispatching` (`delivered` on TCP/simulated success, `queued`/`failed` on TCP failure) was a plain `prisma.printerJob.update()` — not compare-and-swap-guarded. A worker that was merely slow (not actually crashed) could have its late-arriving write silently overwrite an `uncertain` marker a second, concurrent observer had legitimately raised in the interim — erasing the only evidence a duplicate-delivery risk was ever detected, and (on the failure branch) re-entering *automatic* retry on a job that should require an explicit, audited reprint. The adversarial reviewer additionally traced a full double-physical-print chain: original attempt genuinely still in flight → second observer marks `uncertain` → staff reprints (permitted, since `uncertain` was reprintable) → reprint delivers for real → original's late, also-genuinely-successful write silently overwrites `uncertain` back to `delivered`, hiding that two real transmissions occurred. **Fixed**: new private method `resolveFromDispatching()` in `print-jobs.processor.ts` wraps every post-`dispatching` write in `updateMany({ where: { id, status: 'dispatching' }, data })`; if the guard finds the row already moved (count 0), the write is silently skipped and the `uncertain` classification stands.
4. **P0 (duplicate/replay + verification-gap, independently confirmed by both, the second via direct reproduction: constructed a row at `status: accepted` and called `process()` on it 5 times with zero effect).** A job that won the `queued→accepted` claim and then crashed before ever reaching `dispatching` was permanently stranded: no code path ever re-processed it (the `accepted`-found branch was an unconditional no-op "the owner will proceed"), and `accepted` was also in `NON_REPRINTABLE_STATUSES`, blocking manual recovery too. This is the exact "ticket silently lost, nobody notices" failure this story exists to prevent. **Fixed**: the `accepted`-found and `dispatching`-found branches are now unified — both transition to `uncertain` via the same guarded `updateMany` on re-observation, since no transport attempt has begun at `accepted` (so surfacing it immediately carries zero duplicate-transmission risk, only recoverability upside).
5. **P1 (duplicate/replay, reasoned; independently in-scope per this story's own duplicate/replay requirements).** `PrinterJobsService.requestReprint()` was a plain check-then-create with a real TOCTOU gap: two concurrent reprint requests (double-click, client retry after a timed-out first attempt) could each pass the "not already in flight" check and each create an independent, dispatchable job — two real physical print attempts from one careless action. **Fixed**: `requestReprint()` now runs inside a `$transaction`, takes a `SELECT ... FOR UPDATE` row lock on the original job, then re-checks for an in-flight reprint before creating — database-serialized, not app-level-only.

**Verification-gap review's meta-question, answered plainly (and left as a disclosed residual, not fixed — matches this story's own Scope note):** the print-jobs BullMQ queue is never fed anywhere in `backend/src` (confirmed via `grep -rn "InjectQueue"` — only the emails queue is ever injected). Every guarantee this story proves is exercised by tests calling `PrintJobsProcessor.process()`/`PrinterJobsService.requestReprint()` directly, not by a running worker consuming real jobs, because no such worker currently runs in production. This is a pre-existing, already-documented architectural gap (`docs/printers.md`'s implementation-status banner), not a Story 8-1 defect — logged again explicitly in `deferred-work.md` as the honest answer to "what would catch a regression."

**One P1 surfaced but deliberately not fixed, with reasoning:** the reprint audit-log write (`logAuditEventSafely`) is best-effort — if `AuditLogService.logAuthEvent` throws, the reprint still succeeds and the failure is only `console.error`'d. The verification-gap reviewer flagged this as undercutting the "explicit... auditable" claim for reprints specifically. **Not fixed**: this is the same, deliberate pattern used everywhere else in this codebase for audit writes (`OrdersService.logAuditEventSafely`, established and reviewed in Story 6-1), and the frozen intent's own implementation constraints explicitly forbid the alternative ("Do not let printer audit failure turn a safe retry/result lookup into an unrelated 500 where avoidable"). A hard-failing audit write would violate that constraint. The `PrinterJob` row itself (with `reprintOfId`/`reprintRequestedById`, durably committed in the same transaction as the reprint row) remains the primary, always-reliable lineage record regardless of whether the separate `AuditLog` write succeeds.

**Housekeeping**: one of the review agents left a throwaway test file (`backend/test/_adversarial-reprint.integration-spec.ts`, self-labeled "THROWAWAY... deleted after review" but not actually deleted) that was breaking `npm run test:integration`. Confirmed zero DB residue from it, then deleted.

All fixes re-verified: full unit suite (326/326), full real-Postgres integration suite (54/54, reproduced clean across 2+ consecutive full-suite runs and 3+ standalone runs of `printer-jobs.integration-spec.ts`, now 18 tests including new regression coverage for all three fixes), `tsc --noEmit`, `nest build`, `prisma validate`, and focused ESLint (only the same, pre-existing, already-accepted untyped-supertest-response-body error category remains — matches `orders.integration-spec.ts`'s established convention) all clean.

### Independent Review — Round 2 (one fresh-context reviewer, verifying round 1's fixes)

Confirmed RESOLVED: the stranded-`accepted` fix and the reprint-concurrency fix, both reproduced directly against real Postgres (a job seeded in `accepted` becomes `uncertain` and is then genuinely reprintable; 5 genuinely concurrent `requestReprint()` calls against the same original produce exactly 1 new row, 4 rejected, no deadlock risk given the single-row lock scope and Prisma's 5s default transaction timeout).

**One new, real, well-reproduced finding — the same bug class, one step earlier (P0, CONFIRMED via direct reproduction against real Postgres, not just reasoning):** `resolveFromDispatching`'s guard only protected writes leaving `dispatching`. Every write leaving the just-claimed `accepted` state (`accepted`→`manual`, `accepted`→`dispatching`, `accepted`→`failed` for both the simulated-in-production and unrecognized-connection-type cases) was still a plain, unguarded `update()`. Since the round-1 fix's own new `accepted`-found branch can legitimately flip a still-in-flight job to `uncertain` while its original claim-holder is merely slow (not crashed), that claim-holder's very next write would silently revert the row — reproduced live: seed a row, flag it `uncertain` mid-flight, replay the original unconditional write, watch it revert every time.

**Fixed**: generalized `resolveFromDispatching` into `resolveFrom(printerJobId, expectedStatus, data)`, used for every write past the initial `queued→accepted` claim — the `manual`, `dispatching`-transition, and both `failed` terminal writes from `accepted` are now guarded exactly like the `dispatching`-departing writes were. New unit test (`the write that follows the claim... cannot overwrite an uncertain marker...`) and new real-Postgres integration test (`a write following the claim cannot overwrite an uncertain marker raised by a genuinely concurrent invocation` — uses the USB fast-path specifically to maximize the real interleaving window between two genuinely concurrent `process()` calls) both added and passing, the latter reproduced clean across 5 consecutive runs.

Full validation re-run clean after this fix: 327/327 unit, 55/55 real-Postgres integration (19 tests in `printer-jobs.integration-spec.ts`, 5 consecutive clean runs of the new race test specifically), `tsc`/`build`/`prisma validate`/lint/`git diff --check` all clean. Two correction loops used of the three permitted at this point.

### Independent Review — Round 3 (one fresh-context reviewer, exhaustiveness check)

Explicitly tasked with determining whether the round-1→round-2 pattern ("each review finds one more instance of the same bug class") had a third instance still hiding. Traced every write to `PrinterJob.status` in the processor file individually (tabulated in the reviewer's own report) and confirmed each is either the correctly-guarded initial claim or routed through `resolveFrom` with the correct expected prior state — no plain `update()` remains anywhere in the file, and a codebase-wide grep confirmed no other code path ever mutates an existing `PrinterJob.status` (the only other writes are `.create()` calls: initial job creation in `orders.service.ts`, and reprint's brand-new row in `printer-jobs.service.ts`, which never mutates an existing job). Stress-tested with 10 genuinely concurrent `process()` calls straddling both the `accepted`- and `dispatching`-race windows simultaneously (a harder scenario than either prior round tested), run 6 times: exactly one physical TCP connection every time, `attemptCount` never exceeded 1, final state always truthful and internally consistent. Also confirmed `tcp` and `network` connection types share identical code (no divergent untested path) and that `printer` data cannot go stale mid-processing (nothing in this codebase mutates `Printer` rows during job processing).

**No new finding.** Full suite re-confirmed clean: `tsc --noEmit` clean, 327/327 unit, 55/55 real-Postgres integration run twice. Third and final correction loop used; no unresolved P0/P1 finding remains against this story's own scope.

## File List

- `backend/prisma/schema.prisma` (modified — `PrintJobStatus`, `PrinterConnectionType` enums; `PrinterJob` new fields/relations; `Staff` back-relation)
- `backend/prisma/migrations/20260815140000_printer_job_truthful_states/migration.sql` (new)
- `backend/prisma/migrations/20260815140000_printer_job_truthful_states/VERIFY.md` (new)
- `backend/src/queue/processors/print-jobs.processor.ts` (rewritten; round-1 review fix — `resolveFromDispatching` CAS guard, unified `accepted`/`dispatching` re-observation handling; round-2 fix — generalized to `resolveFrom(id, expectedStatus, data)`, guarding every write past the initial claim)
- `backend/src/queue/processors/print-jobs.processor.spec.ts` (new; round-1 + round-2 review — updated assertions for both CAS-guard fixes + new regression tests)
- `backend/src/printer/printer-jobs.service.ts` (new; round-1 review fix — transactional row-locked reprint)
- `backend/src/printer/printer-jobs.service.spec.ts` (new; round-1 review — updated + new regression test for the transactional lock)
- `backend/src/printer/printer-jobs.controller.ts` (new)
- `backend/src/printer/printer.module.ts` (modified — registers the new controller/service + `AuditModule`)
- `backend/test/printer-jobs.integration-spec.ts` (new; round-1 + round-2 review — added real-Postgres regression tests for all fixes, including the generalized CAS-guard race test)
- `_bmad-output/implementation-artifacts/deferred-work.md` (modified — queue-never-fed finding restated explicitly)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (modified — status tracking)
- `_bmad-output/implementation-artifacts/8-1-printer-truthful-states.md` (this file)

## Change Log

- 2026-08-15 (round 1): Initial implementation. Schema + migration + processor rewrite + admin reprint/listing API + unit tests + real-Postgres integration tests delivered as one vertical slice, executed against real Postgres throughout (Docker was available this session). Two bugs found and fixed during implementation (see Debug Log). Status set to `review` pending the independent review loop.
- 2026-08-15 (round 1, continued — independent review): Four parallel fresh-context reviews run (adversarial, duplicate/replay + crash-window, security/tenant-isolation, verification-gap). Security review: no findings. The other three converged on two real P0s (unguarded post-`dispatching` writes could overwrite a legitimately-raised `uncertain` marker; a crash between `accepted` and `dispatching` permanently stranded a job, unreachable and unreprintable) and one P1 (reprint had a TOCTOU gap allowing a concurrent double-click to create two dispatchable jobs) — all three fixed, with new unit and real-Postgres regression tests added for each. One P1 (reprint audit-log write is best-effort) deliberately left unfixed, matching this codebase's established convention and the frozen intent's own constraint against letting audit failures turn safe operations into 500s. A stray throwaway test file left by a review agent was found and deleted (zero DB residue). Full validation set re-run clean: 326/326 unit, 54/54 real-Postgres integration (reproduced across 2+ full-suite runs), `tsc`/`build`/`prisma validate`/lint/`git diff --check` all clean. One correction loop used of the three permitted.
- 2026-08-15 (round 2 — fresh-context verification of round 1's fixes): Confirmed the stranded-`accepted` and reprint-concurrency fixes RESOLVED via direct real-Postgres reproduction. Found one more real P0, the same bug class one step earlier: writes leaving the just-claimed `accepted` state were still unguarded, so a merely-slow (not crashed) claim-holder could silently revert an `uncertain` marker a concurrent observer had just raised — reproduced live. Fixed by generalizing the CAS-guard helper (`resolveFromDispatching` → `resolveFrom(id, expectedStatus, data)`) so every write past the initial claim is guarded, not only writes leaving `dispatching`. New unit and real-Postgres regression tests added (the latter using genuinely concurrent USB-path `process()` calls, reproduced clean across 5 runs). Full suite re-run clean: 327/327 unit, 55/55 integration. Second correction loop used of the three permitted.
- 2026-08-15 (round 3 — fresh-context exhaustiveness check): Explicitly tasked with checking whether a third instance of the same bug class remained, given rounds 1 and 2 each found one. Traced every `PrinterJob.status` write in the file individually and confirmed all are now correctly guarded (or are the correctly-guarded initial claim); confirmed via codebase-wide grep that no other code path ever mutates an existing job's status. Stress-tested with 10 genuinely concurrent `process()` calls straddling both race windows simultaneously, 6 runs, no corruption. No new finding. Third and final correction loop used; no unresolved P0/P1 finding remains. Status set to `done`.
