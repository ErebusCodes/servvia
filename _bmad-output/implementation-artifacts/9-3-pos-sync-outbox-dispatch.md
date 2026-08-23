---
baseline_commit: HEAD@2026-08-16
epic: E9
realizes: E9-S1 (dispatch half — the transactional-outbox write half is already done, see orders.service.ts persistOrder)
supersedes_shorthand: "repository-story-audit-2026-08-16.md §17's 'wire the pos-sync and print-jobs enqueue calls' — split per DL-069; this story is the pos-sync half only"
tracer_bullet: false
production_story: true
blocked_on: none
---

# Story 9.3: POS-Sync Outbox Dispatch (Cloud-Internal, No Idealpos, No Connector Required)

Status: done

## Story

As a platform operator,
I want every `POSSyncRecord` created for a configured (but unimplemented) Idealpos adapter to actually reach the existing, already-truthful `PosSyncProcessor`,
so that an order's POS-sync status honestly reflects `not_applicable`/`unsupported` instead of sitting at `not_synced` forever — the same silent-limbo state story 9-1 was built specifically to eliminate, but which the processor cannot fix because nothing ever calls it.

This story is **not** a general "wire up the dormant queues" fix. The repository audit (`_bmad-output/audits/repository-story-audit-2026-08-16.md`) found both `pos-sync` and `print-jobs` dormant and described them as one fix; direct inspection of both consumers proved they are architecturally asymmetric (DL-069). `PosSyncProcessor` makes no network call of any kind and is safe to feed today. `PrintJobsProcessor` opens a direct cloud-to-LAN TCP socket for `tcp`/`network` printers and **must not** be fed until a real venue connector exists (story 2-9 plus a printer-side connector component) or a separate written decision narrows it to network-free connection types. This story implements only the `pos-sync` half.

## Architecture Trace (governing this story)

```text
Verdura order transaction (orders.service.ts:persistOrder, unchanged by this story)
  → POSSyncRecord row created (status: not_synced), IN THE SAME $transaction as Order/OrderItem/PrinterJob
    — source of truth: PostgreSQL; transaction boundary: the existing persistOrder $transaction (already done, story 6-1/E9-S1 write half)
    — idempotency key: POSSyncRecord.orderId is @unique — at most one record per order, already DB-enforced
  → [THIS STORY] outbox claim — a new, separate dispatcher component (NOT orders.service.ts) periodically scans for
    not_synced records not yet dispatch-claimed (or whose claim has gone stale), CAS-claims via a DB updateMany, and
    calls queue.add() on the existing 'pos-sync' BullMQ queue with a deterministic jobId
    — source of truth: PostgreSQL (new nullable dispatch-tracking columns on POSSyncRecord — see Migration)
    — transaction boundary: a single updateMany per claim attempt, no cross-row transaction needed (each row is independent)
    — ordering key: none required — POS-sync records have no cross-order ordering requirement (each is an independent, one-shot
      classification of a single order's own immutable adapterType); FIFO is not a correctness requirement here
    — venue/tenant boundary: each claim/enqueue operates on exactly one record by id; no batch update crosses venues
    — retry owner: the dispatcher's own periodic sweep (self-healing; no BullMQ-level retry/backoff/DLQ needed — see Behavior Matrix)
    — dispatch-confirmation evidence: dispatchedAt set only after queue.add() resolves without throwing — this is evidence the
      record was handed to our own internal queue, nothing more; it carries none of the external-system evidentiary weight that
      PrinterJob's deliveredAt/printedAt do, and must never be read as such
    — timeout behaviour: a claim older than a bounded staleness threshold with the record still not_synced (and dispatchedAt still
      null) is eligible for re-claim (see AC4/AC17 below for the distinct, longer-horizon safety net covering post-enqueue failures)
    — uncertain-outcome behaviour: not applicable in the Idealpos/connector sense — see below, this destination cannot produce a
      POS-facing uncertain outcome. It CAN, however, leave a record dispatched-but-never-resolved if the downstream infra call
      itself fails (see AC17) — that is a dispatch-mechanics concern, not a POS-truthfulness one, and is handled below
    — current test evidence: NONE — no test in this repository exercises a real BullMQ worker consuming a real enqueued job
      (confirmed: every existing pos-sync test calls PosSyncProcessor.process() directly); this story is the first to close that gap
  → connector durable acceptance — DOES NOT APPLY to this destination. pos-sync's outcome never leaves the cloud process; there is
    no connector, no venue-bound identity involved anywhere in this story. (Contrast: this step is mandatory and unbuilt for
    any future print-jobs or real-Idealpos dispatch, which is exactly why those remain blocked on story 2-9.) **Note (independent
    review):** BullMQ-over-Redis is still an internal transport hop within the cloud process boundary and is not exempt from trust
    analysis by virtue of being "internal" — it is explicitly analyzed and accepted in Security and Tenancy Requirements below,
    using the same already-provisioned Redis connection every other in-cloud queue in this process already uses. This is a
    different, lower-stakes trust boundary than a connector/IPC boundary, not the absence of one. **Distinction from
    `docs/architecture.md` §4.8 (independent review):** this dispatcher is not, and must not be confused with, the on-premise
    "IdealPOS Agent" §4.8 describes (a separate, still-unbuilt, venue-side process that would poll or receive commands from
    outside the cloud). This story's dispatcher runs only inside the existing cloud API process.
  → POS submission — DOES NOT APPLY. No real Idealpos adapter exists (DL-064); PosSyncProcessor (unchanged by this story, already
    built and reviewed in story 9-1) deterministically resolves the claimed record to not_applicable or unsupported and stops.
  → KDS release — unaffected by and independent of this story. KDS/KOT release already happens via a direct, synchronous WebSocket
    push from orders.gateway.ts at order-creation time (confirmed in the prior audit session), never gated on POS-sync status.
    This story does not change, and must not be read as changing, that independence.
  → station/KOT dispatch — unaffected; out of scope; see above.
  → acknowledgement and reconciliation — the "acknowledgement" for this story's scope is the terminal POSSyncRecord.status write
    (not_applicable/unsupported) that PosSyncProcessor already performs, transactionally mirrored onto Order.posSyncStatus (already
    built in story 9-1). This story adds no new acknowledgement semantics — it only makes the existing, already-correct terminal
    write reachable.
```

## Intent and Business Value

Close the truthfulness gap the audit's §11.1 named for E9: today a manager or reconciliation process querying an order with `posAdapterType !== 'none'` sees `posSyncStatus: not_synced` indefinitely — a state that, read literally, means "not yet attempted" and invites the false inference that POS sync might still happen. Story 9-1 built the correct terminal answer (`unsupported`) and proved it truthful and duplicate-safe; this story is the smallest, architecturally-safe increment that makes that answer actually reachable, without touching Idealpos, without a connector, and without any change to `orders.service.ts`'s already-reviewed transactional-outbox write path.

## In Scope

- A new, standalone outbox-dispatch component (module/service — exact placement left to the implementer, but it must depend on `PrismaModule` and `QueueModule` only, **not** on `OrdersModule`, so `orders.service.ts` requires zero changes) that:
  - Periodically scans `POSSyncRecord` rows with `status: not_synced` that are unclaimed or whose claim is stale.
  - Claims each eligible row via a database-enforced compare-and-swap (`updateMany` guarded on the row's own claim state — see Migration).
  - Calls `queue.add()` on the existing `pos-sync` BullMQ queue with a deterministic `jobId` derived from the record's own id (e.g. `pos-sync:{posSyncRecordId}`), so a duplicate enqueue is a BullMQ-level no-op **while the original job is still active/waiting in Redis** (independent review: this qualifier matters — if the original job already completed and was removed per BullMQ's cleanup/TTL settings, a duplicate `jobId` enqueue attempt will succeed as a genuinely new job; this is why `PosSyncProcessor`'s own terminal-state CAS guard, not the `jobId` mechanism, is the actual, unconditional safety net — see AC3).
  - Marks the row `dispatchedAt` only after `queue.add()` resolves without throwing.
- A schema migration adding the minimum nullable, additive columns needed for the claim (see Migration and Compatibility Considerations). No existing column, enum value, or constraint is altered.
- Wiring `PosSyncProcessor` (`backend/src/queue/processors/pos-sync.processor.ts`) to actually run against real, dispatcher-enqueued jobs for the first time — the processor's own code is **not modified** by this story (it was already reviewed, tested, and proven correct in story 9-1); this story only makes it reachable.
- Real-Postgres and real-BullMQ-worker evidence that a `POSSyncRecord` created via a genuine order-creation call reaches `not_applicable`/`unsupported` end-to-end through a real running worker consuming a real enqueued job — the evidence tier the audit's §11.1 named as missing for E9.

## Explicit Exclusions

- Does **not** wire, enqueue, or otherwise make production-reachable the `print-jobs` queue or `PrintJobsProcessor` — remains prohibited per DL-069 until a connector exists or a separate written decision narrows it.
- Does **not** implement, stub, or reference story 2-9's connector identity/transport in any way — this story has no connector dependency (see Architecture Trace above).
- Does **not** implement any real Idealpos adapter (ApiAdapter/SqlAdapter/OdbcAdapter/CsvAdapter/LocalAgentAdapter) — remains `BLOCKED ON: DL-064`.
- Does **not** implement the API-less Idealpos UI Bridge — remains blocked per story 9-2.
- Does **not** modify `orders.service.ts`, `persistOrder`, or any part of the already-reviewed transactional-outbox write path.
- Does **not** change `POSSyncStatus` or add any new status value — `not_applicable`/`unsupported` remain the only reachable terminal outcomes, exactly as story 9-1 established.
- Does **not** build a generic, multi-entity "outbox dispatcher framework" reusable for `PrinterJob` — the dispatcher built here is scoped to `POSSyncRecord` only. A future `print-jobs` dispatcher story may reuse this story's *pattern* but must be scoped, reviewed, and (per DL-069) connector-gated on its own terms, not assumed unlocked by this story.
- Does **not** build any Admin Dashboard or KDS UI change. `GET /admin/venues/:id/pos-sync-records` and `GET /admin/orders/:id/pos-sync` already exist (story 9-1) and are sufficient to observe this story's effect.
- Does **not** implement retry/backoff/dead-letter handling for `PosSyncProcessor` itself — the processor cannot fail in a way that requires it (see Required Behavior Matrix, "poison payload" and "maximum retry exhaustion" rows).

## Dependencies

None blocking. Independent of story 2-9 (no connector involved — see Architecture Trace). Depends only on already-`done` work: story 6-1 (idempotent order transaction), story 9-1 (truthful, tested `PosSyncProcessor` and its terminal-state CAS guard), and the existing `QueueModule`/BullMQ infrastructure (story 1-4).

## Inputs and Expected Outputs

**Input:** a `POSSyncRecord` row created by `persistOrder` (unchanged) with `status: not_synced`, for a venue whose `posAdapterType !== 'none'`.

**Output — normal case:** within one dispatcher sweep interval, the record is claimed, enqueued, consumed by a real `PosSyncProcessor` worker, and resolves to `unsupported` (or `not_applicable`, structurally unreachable here since such venues never get a `POSSyncRecord` row at all — see `persistOrder`'s `if (venue.posAdapterType !== 'none')` guard). `Order.posSyncStatus` mirrors the same value in the same transaction (unchanged, story 9-1 behavior).

**Output — dispatcher unavailable (crashed, not deployed, Redis down):** the record remains `not_synced`, unclaimed or with a stale claim, indefinitely re-eligible for the next sweep once the dispatcher recovers. No data is lost; no fabricated outcome is ever produced by absence of a dispatcher.

## Happy Path

1. Order created for a venue with `posAdapterType !== 'none'` → `POSSyncRecord` row created, `not_synced`, in the same transaction as the order (unchanged).
2. Dispatcher's next sweep finds the row, CAS-claims it, calls `queue.add('pos-sync', { posSyncRecordId }, { jobId: 'pos-sync:{id}' })`, marks `dispatchedAt`.
3. A real BullMQ worker running `PosSyncProcessor` picks up the job, CAS-claims the record from `not_synced`, resolves it to `unsupported`, mirrors `Order.posSyncStatus` in the same DB transaction (all unchanged, story 9-1 behavior).
4. `GET /admin/orders/:id/pos-sync` (existing, story 9-1) now truthfully returns `unsupported` instead of `not_synced` forever.

## Security and Tenancy Requirements

- The dispatcher performs no authentication/authorization of its own — it is an internal, trusted, in-process/in-cluster component operating only on rows it reads from the database, the same trust tier as the existing BullMQ workers (`EmailsProcessor`, `PosSyncProcessor`, `PrintJobsProcessor`).
- No connector identity, venue-bound credential, or IPC boundary is created, referenced, or required by this story.
- No shared cloud Redis credential is exposed to any venue-side process — this story adds no new Redis consumer outside the existing cloud API process's own, already-provisioned Redis connection (`QueueModule`'s existing `BullModule.forRootAsync`). This is explicitly **not** the DL-054-prohibited case (a venue agent receiving cloud Redis credentials) — that prohibition concerns on-premise processes reaching into the cloud, not the cloud API's own internal queue usage.
- No cloud-to-LAN network call is made anywhere in this story's scope — the dispatcher and `PosSyncProcessor` never resolve a venue hostname/IP or open a socket to venue-side infrastructure.

## Observability and Audit Requirements

- The dispatcher's own claim/enqueue activity is logged **per row** (structured log per record, not one aggregate log line summarizing an entire sweep's eligible-row set — independent review: an aggregate multi-venue log line is a specification gap even though `POSSyncRecord` ids/venueIds are not secrets, since it behaves differently under log-system access control than row-level DB access does). Not necessarily a new `AuditLog` row — this is internal job-queue plumbing, not a user- or staff-attributable action, consistent with this codebase's existing actor-vs-system audit distinction (confirmed by independent review against `audit.service.ts`'s existing call-site pattern).
- `PosSyncProcessor`'s existing audit/observability behavior (unchanged) continues to apply once it actually runs against real traffic for the first time.
- **The gap this story closes (`not_synced` forever) becomes measurable via two distinct, correctly-scoped monitoring predicates (corrected per independent review — the original single predicate below was wrong for the stuck-claim case, since a stuck claim has `dispatchedAt IS NULL`, not an old `dispatchedAt`):**
  1. **Stuck claim** (crashed between claim-write and `queue.add()`): `dispatchClaimedAt < now() - staleness_threshold AND dispatchedAt IS NULL AND status = 'not_synced'`.
  2. **Dispatched but never resolved** (queue.add() succeeded but the job never reached a real worker, or the worker's DB write itself failed — see AC17): `dispatchedAt < now() - safety_net_threshold AND status = 'not_synced'`, where `safety_net_threshold` is deliberately longer than the normal claim-staleness threshold, since a legitimately busy worker may take longer than a crashed dispatcher's claim window.

## Migration and Compatibility Considerations

- Add two new **nullable** columns to `POSSyncRecord`: a dispatch-claim timestamp and a dispatch-confirmed timestamp (exact names left to the implementer, e.g. `dispatchClaimedAt`/`dispatchedAt`), consistent with `PrinterJob`'s existing timestamp-column naming style. **Unlike `PrinterJob`'s `deliveredAt`/`printedAt`, neither new column represents evidence of anything reaching an external system — both are purely internal dispatch bookkeeping; do not draw an evidentiary parity between them.** Both default to `NULL`; existing rows are unaffected. All historical `not_synced` rows become eligible for claiming on first sweep after deploy — this is intended, correct behavior, **but see AC13/task list for the required bounded-batch-per-sweep safeguard against an unbounded first-deploy backlog burst (independent review finding).**
- No existing column, enum value, index, or constraint is altered. `POSSyncStatus` is untouched — dispatch-claim state is deliberately **not** modeled as a `POSSyncStatus` value, because conflating "dispatched to our own internal queue" with "an Idealpos-facing truthful outcome" would violate target-operating-model.md's independent-truthful-states requirement (the same reasoning story 9-1 already applied to keep `attemptCount`/`lastAttemptAt` untouched by non-attempts).
- Purely additive migration — safe against both a populated shared dev database and a clean-from-zero `prisma migrate deploy`, following stories 6-1/8-1/9-1's established verification pattern (both must be demonstrated in the release pack).

## Acceptance Criteria

1. **Database-enforced outbox claiming.** Claiming a `POSSyncRecord` for dispatch is a single `updateMany` compare-and-swap guarded on the row's own claim state (unclaimed, or claimed-but-stale beyond a defined threshold) — never an in-memory check-then-write. Two concurrent dispatcher instances racing to claim the same row: exactly one succeeds (count=1), the other observes count=0 and does nothing.
2. **Idempotent dispatch.** Enqueuing uses a deterministic `jobId` derived from the record's id. A duplicate enqueue attempt for a still-active/waiting job is a BullMQ-level no-op (verified by inspecting BullMQ's own job-state, not merely asserted).
3. **Concurrent worker safety.** Running two dispatcher instances (or one instance sweeping twice in overlapping intervals) against the same set of eligible rows produces at most one successful claim per row and at most one meaningful enqueue per row (a benign duplicate enqueue attempt per AC2 is acceptable; a duplicate *processed* outcome is not — verified against `PosSyncProcessor`'s existing terminal-state CAS guard, unchanged).
4. **Crash-window behaviour**, for each of: (a) dispatcher crashes before claiming a row — row remains `not_synced`, unclaimed, picked up by the next sweep, no data lost; (b) dispatcher crashes after claiming but before `queue.add()` resolves — row shows a claim timestamp but no `dispatchedAt`; once the claim exceeds the staleness threshold it becomes re-eligible, and a duplicate resulting enqueue is safe per AC2/AC3; (c) dispatcher crashes after `queue.add()` resolves but before writing `dispatchedAt` — the enqueue already happened, so the record is picked up and resolved regardless of whether `dispatchedAt` was ever written; the DB write is bookkeeping/observability only, never on the critical path for correctness.
5. **Venue isolation.** No claim or enqueue operation ever touches more than one `POSSyncRecord` row identified by its own id; no batch operation groups rows across venues in a way that could cross-contaminate state (verified by test: two records for different venues, one claimed, the other unaffected).
6. **No connector identity dependency.** This story's implementation, tests, and acceptance evidence must not reference, stub, or assume any part of story 2-9 — the dispatcher and `PosSyncProcessor` never leave the cloud process (verified by: zero network calls of any kind observed during the full happy-path test, confirmed via a test-environment network-call assertion or equivalent).
7. **No shared Redis credentials leave the cloud.** No new Redis consumer, connection string, or credential is introduced for any venue-side process; the only Redis client involved is the cloud API's own existing, already-provisioned BullMQ connection. **Verified by:** diffing the dependency-injection graph (`QueueModule`/dispatcher module) confirms no new `BullModule.forRootAsync`/Redis connection provider is added anywhere outside the cloud API's existing single registration, and no new environment variable or config key for a venue-side Redis credential is introduced.
8. **No direct cloud-to-LAN access.** Verified by static assertion (this story's diff introduces no new outbound network call target other than the existing cloud Redis) and is structurally guaranteed by `PosSyncProcessor`'s own code (unchanged, contains no network I/O).
9. **Truthful delivery states.** `POSSyncRecord.status` only ever reaches `unsupported` via `PosSyncProcessor`'s existing, unmodified terminal-state logic; the dispatcher itself never writes to `POSSyncRecord.status` or `Order.posSyncStatus` under any circumstance.
10. **Unsupported-capability handling.** Every dispatched record for a venue with `posAdapterType !== 'none'` resolves to `unsupported` (never `synced`, never a fabricated `posOrderId`) — re-confirms story 9-1's guarantee now holds under real dispatch, not only under direct `process()` invocation.
11. **Audit correlation.** The dispatcher's claim/enqueue activity and the processor's terminal resolution are correlatable by `posSyncRecordId` end-to-end in logs, sufficient to answer "did this order's POS-sync record actually get dispatched, and when."
12. **Ordered processing.** Explicitly not required and not tested as a correctness property — see Architecture Trace's "ordering key: none required" — because each record's outcome depends only on its own immutable `adapterType`, never on any other record's state or arrival order. This is deliberately stated as a non-requirement so no downstream agent assumes FIFO semantics exist or are needed here.
13. **Migration safety.** The migration is additive-only, applies cleanly to both a populated shared dev database and a clean-from-zero container (`prisma migrate deploy`), and is demonstrated in the release pack for both, per stories 6-1/8-1/9-1's established pattern.
14. **Real-Postgres verification.** All claim/CAS/staleness behavior (AC1, AC3, AC4, AC5) is proven against real Postgres under genuine concurrent load (multiple real concurrent dispatcher invocations), not only sequential/mocked tests.
15. **Simulated transport versus real connector evidence — explicitly not applicable and must be stated as such.** This story makes no connector call, so there is no "simulated vs. real connector" distinction to draw; evidence must instead distinguish `UNIT_OR_MOCK` (mocked Prisma/BullMQ), `REAL_POSTGRES` (real DB, mocked queue), and `REAL_REDIS_OR_QUEUE_WORKER` (a real BullMQ `Worker` process actually consuming a real enqueued job end-to-end) — the release pack must include the last tier, which the audit's §11.1 confirmed no existing test in this repository reaches for `pos-sync`.
16. **No claims about real Idealpos or physical printing.** The release pack and this story's own status/change-log entries must not describe any order as "synced to Idealpos," must not use the word "printed" anywhere in this story's evidence, and must explicitly restate that `unsupported` is the ceiling outcome, not a step toward a working Idealpos integration.
17. **Infra-failure safety net (added per independent review — corrects a false premise in the original draft).** `PosSyncProcessor` does not throw on a malformed payload, but it **can** throw on an ordinary infra failure (e.g. a transient database error inside its own `findUnique`/`$transaction` calls) — the original draft's blanket claim that "the processor never throws" was wrong for this case, only correct for well-formed-payload business logic. Because the `pos-sync` BullMQ queue registration has no `defaultJobOptions` today (confirmed: `queue.module.ts` sets none), a job that throws for an infra reason gets BullMQ's default of a single attempt with no retry — and because the dispatcher already marked `dispatchedAt` before the worker ran, the record has no path back into the normal staleness-based re-claim (AC4b), leaving it permanently `not_synced` with no automated recovery. This story must close that gap by one of: (a) configuring explicit, bounded `attempts`/`backoff` on the `pos-sync` queue registration sufficient to absorb a transient infra failure, or (b) implementing the long-horizon "dispatched but never resolved" safety-net re-claim specified in the Observability section above (predicate 2), which re-considers any row still `not_synced` after a deliberately long `safety_net_threshold` as eligible for re-dispatch regardless of its `dispatchedAt`/claim state — safe because re-dispatch of an already-processed record is always a no-op per `PosSyncProcessor`'s own terminal-state CAS guard (story 9-1, unchanged). At least one of (a) or (b) is required; both together is acceptable and is the recommended default.
18. **Bounded sweep batch size.** The dispatcher's eligible-row scan is capped at a fixed maximum batch size per sweep tick (exact value left to the implementer, but must be explicit and configurable) — added per independent review to prevent an unbounded burst of enqueues if a large historical backlog of `not_synced` rows becomes eligible simultaneously on first deploy (e.g. from rows that predate this story). A capped sweep simply processes the backlog over multiple sweep ticks instead of in one burst; no row is ever skipped permanently, only deferred to a later tick.

## Required Behavior Matrix

| Scenario | Prior state | Evidence | Permitted next state | Retry policy | Prohibited claims | Audit record | Expected test |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Normal committed outbox row | `Order`+`POSSyncRecord` committed, `not_synced`, unclaimed | DB row exists | claimed → enqueued → `dispatchedAt` set → processed → `unsupported` | n/a (success path) | none | dispatch log + processor's existing audit trail | end-to-end real-Postgres + real-worker test |
| Transaction rollback | `persistOrder`'s transaction rolled back (e.g. concurrent conflict) | no `POSSyncRecord` row exists | n/a — nothing for the dispatcher to see | n/a | dispatcher never claims a row that was never committed | n/a | existing story 6-1 rollback tests cover this; dispatcher has nothing new to prove here |
| Duplicate dispatcher observation (two sweeps overlap) | row claimed by sweep A, not yet stale | sweep B's CAS finds claim already held | sweep B: no-op (count=0) | none needed | dispatcher must not claim twice while a claim is fresh | dispatch log shows one claim, one skip | concurrency test: two sweeps, one claim, one skip |
| Concurrent dispatchers (two instances) | same as above, two processes | as above | exactly one instance claims per row | none needed | no dual-enqueue for the same still-fresh claim | as above | multi-instance simulation test |
| Dispatcher crash before send | row claim not yet attempted | row still `not_synced`, unclaimed | next sweep claims normally | immediate (next sweep) | none | none needed (nothing happened yet) | kill-and-restart test showing no data loss |
| Dispatcher crash after send (enqueue succeeded, claim-mark not written) | `queue.add()` resolved; `dispatchedAt` write never ran | job exists in BullMQ; DB shows claim without `dispatchedAt` | processed normally regardless of DB bookkeeping state (AC4c) | n/a | must not treat missing `dispatchedAt` as "not dispatched" and re-enqueue in a way that produces a second *meaningfully different* outcome (a benign duplicate enqueue is fine per AC2) | dispatch log + processor log both exist, correlatable | integration test asserting correctness is independent of whether `dispatchedAt` was persisted |
| Connector unavailable | n/a | n/a | n/a | n/a | this scenario does not exist in this story's scope (no connector) — explicitly documented as inapplicable | n/a | none (negative test: assert no connector code path exists) |
| Connector rejects venue or capability | n/a | n/a | n/a | n/a | inapplicable, same reasoning | n/a | none |
| Durable connector acceptance | n/a | n/a | n/a | n/a | inapplicable — this story's "acceptance" is the DB-committed `POSSyncRecord` row itself, already proven durable by story 6-1 | n/a | none new |
| Late acknowledgement | a claimed-but-stale row's original attempt was actually just slow, not lost | re-claim happens, second enqueue is benign (AC2) | processor resolves once (CAS-guarded, story 9-1, unchanged) | staleness threshold governs re-claim timing | must not double-count or double-log as if two independent orders were processed | one terminal resolution, correlatable to one `posSyncRecordId` | staleness/re-claim test |
| Poison payload (malformed business input) | n/a for this destination | `PosSyncProcessor` contains no code path that can throw on a well-formed-but-unresolvable `{ posSyncRecordId }` payload (e.g. an id for a record that doesn't exist) — the `if (!dbJob) return;` guard handles it cleanly | n/a — processor completes normally, never poison-loops, for this class of input | n/a | must not build DLQ/poison handling for *this* class (misleading complexity for a case that structurally cannot poison-loop) | n/a | negative test: malformed/missing/nonexistent `posSyncRecordId` still returns cleanly |
| Poison payload (infra failure — corrected per independent review) | claimed, `dispatchedAt` set, job running | `PosSyncProcessor`'s own DB calls (`findUnique`/`$transaction`) CAN throw on a transient infra error — this is a real, distinct case from the row above, not covered by "never throws" | AC17's safety net (bounded retry/backoff, and/or the long-horizon re-claim) must recover this row; it must not remain permanently stuck at `not_synced` | AC17-defined bounded retry and/or safety-net re-claim | must not claim this queue is retry-exempt or that the processor "never throws" without qualification | dispatch log + eventual re-claim log, correlatable | integration test: force a transient DB error mid-processing, confirm the record is eventually resolved via AC17's mechanism, not stuck forever |
| Maximum retry exhaustion | claimed, `dispatchedAt` set | Per AC17, either BullMQ's own configured `attempts`/`backoff` for this queue is exhausted, or the long-horizon safety net's `safety_net_threshold` is reached | record becomes re-eligible for claim regardless of prior `dispatchedAt` (AC17b), OR — if the implementer chose bounded BullMQ retry alone (AC17a) — a genuinely exhausted job surfaces as a BullMQ `failed`-state job requiring the same safety-net or manual-replay path | AC17-defined | must not silently drop a row that exhausted its configured attempts without it becoming visible/re-claimable | dispatch/re-claim log | test: simulate exhaustion, confirm the row does not remain permanently stuck |
| Manual replay | operator wants to force re-classification (e.g. after a schema/adapter-type correction) | existing story 9-1 admin read endpoints already expose current state | out of this story's scope to build a replay trigger; the periodic sweep itself is the only re-processing mechanism | n/a | must not claim a manual-replay UI/endpoint exists | n/a | none (explicitly deferred; note as a future story if needed) |
| Revoked connector | n/a | n/a | n/a | n/a | inapplicable | n/a | none |
| Wrong-venue connector | n/a | n/a | n/a | n/a | inapplicable | n/a | none |
| Unsupported POS adapter | `posAdapterType` is a real, non-`none` type with no implementation | claimed, enqueued, processed | `unsupported`, `errorMessage` naming the adapter type (story 9-1, unchanged) | none (deterministic, not retryable in a way that would change the outcome) | never `synced`, never a fabricated `posOrderId` | processor's existing audit trail | story 9-1's existing tests, now proven reachable via real dispatch (new in this story) |
| Unsupported printer transport | out of scope — this story does not touch `PrinterJob`/print-jobs | n/a | n/a | n/a | this story must not claim to address print-jobs at all | n/a | none (see Explicit Exclusions) |
| Online-paid order | `Order.source` reflects online/prepaid origin | `POSSyncRecord` created identically regardless of payment origin | identical `unsupported`/`not_applicable` outcome — no tender-based branching exists or is added | none | dispatcher/processor must not differentiate by tender — no real adapter exists to submit either | same as normal case | test: online-paid order's POSSyncRecord dispatches and resolves identically to an in-person order's |
| In-person unpaid order | `Order.source` reflects staff/kiosk in-person origin | as above | as above | as above | as above | as above | as above |
| Independent KDS and printer outcomes | KDS release already happens synchronously at order creation, independent of POS-sync (confirmed, unaffected by this story) | n/a | this story must not introduce any coupling between POS-sync dispatch and KDS/printer state | n/a | must not claim or imply KDS/printer state depends on this story's dispatch outcome | n/a | test: KDS WebSocket push fires identically whether or not a POSSyncRecord has been dispatched yet |
| Stale order version | not applicable — `POSSyncRecord` has no versioning concept of its own; it is 1:1 with an immutable `Order` row already finalized at creation | n/a | n/a | n/a | none | n/a | none |
| Order cancellation before dispatch | order cancelled before the dispatcher's sweep claims its `POSSyncRecord` | row still `not_synced`, unclaimed | dispatcher still claims and dispatches it (no cancellation-awareness exists or is required, since the outcome — `unsupported`/`not_applicable` — is unaffected by order cancellation; no real Idealpos transaction is ever created to need reversing) | none | must not claim a cancelled order's POS-sync record is skipped or specially handled if it isn't | processor's existing audit trail | test: cancelled order's POSSyncRecord still dispatches and resolves truthfully (documents this is correct, not a bug) |
| Cancellation after durable connector acceptance | inapplicable — no connector acceptance exists in this story's scope | n/a | n/a | n/a | inapplicable | n/a | none |

## Definition of Done

Automated tests cover every applicable row of the Required Behavior Matrix above, **including the two infra-failure rows added per independent review (AC17)**. Real-Postgres evidence proves the claim/CAS/staleness mechanics under genuine concurrency (AC14). At least one test runs a real BullMQ `Worker` consuming a real enqueued job end-to-end (AC15, `REAL_REDIS_OR_QUEUE_WORKER` tier) — the first test in this repository to reach that tier for either dormant queue. At least one test proves a row that fails for an infra reason after dispatch does not remain permanently stuck (AC17). At least one test proves a bounded historical backlog does not enqueue in one unbounded burst on first deploy (AC18). The migration is demonstrated against both a populated shared dev database and a clean-from-zero container. `orders.service.ts` is unmodified (confirmed via `git diff`). No test or code path can produce `synced`, a fabricated `posOrderId`, or any claim about real Idealpos or physical printing. Evidence is retained in the release pack before this story's status may become `done`.

## Dev Notes (non-blocking, for the implementing session)

- **Sweep-trigger mechanism is deliberately unspecified here** (independent review flagged this as worth naming, not as a blocker): this repository has no scheduling library (`@nestjs/schedule` or similar) installed today. The implementer must choose between adding one, using a raw interval timer, or another mechanism — and should be aware that `docs/epics.md`'s `E9-S10` ("Automatic retry scheduler — BullMQ repeatable job, every 5 minutes — for failed syncs") is a **different, later, still-unbuilt** story that also wants periodic/scheduled behavior; avoid building infrastructure in this story that silently forecloses or duplicates E9-S10's eventual mechanism without a note in that story when it's picked up.

## Tasks / Subtasks

- [x] Design and land the additive migration (7 nullable/defaulted columns + 1 index on `POSSyncRecord`; see `backend/prisma/migrations/20260816120000_pos_sync_outbox_dispatch/`).
- [x] Implement the dispatcher component (new `PosSyncDispatcherService`, registered only in `PosSyncModule`, which now also imports `QueueModule`; `OrdersModule` untouched).
- [x] Implement the CAS-guarded claim + staleness re-claim logic (AC1, AC4).
- [x] Implement deterministic-`jobId` enqueue against the existing `pos-sync` queue (AC2). **Correction found during implementation**: the original design used `pos-sync:{id}` — BullMQ rejects colons in jobIds. Fixed to `pos-sync-{id}` before any test evidence was gathered.
- [x] Implement the AC17 infra-failure safety net: **both** (a) bounded BullMQ `attempts`/`backoff` and (b) the long-horizon safety-net re-claim, per the story's own "recommended default." (a) was added during the independent-review correction loop after a reviewer proved, against real Redis, that (b) alone was insufficient — see Dev Agent Record — Implementation below.
- [x] Implement the AC18 bounded sweep batch size.
- [x] Implement per-row structured dispatch logging (not aggregate sweep-result logging).
- [x] Unit tests (mocked Prisma/BullMQ) for claim CAS, staleness, concurrent-claim races, infra-failure recovery, crash-after-send (13 tests).
- [x] Real-Postgres integration tests for AC1, AC3, AC4, AC5, AC14, AC17, AC18, plus order-source parity and cancelled-order dispatch (19 tests).
- [x] A real-BullMQ-worker end-to-end test (AC15) — order creation → dispatcher sweep → real worker → `unsupported`.
- [x] A dedicated real-Redis test reproducing and proving the fix for the BullMQ failure-recovery gap found in independent review.
- [x] Confirmed `orders.service.ts` has zero diff to its executable logic (one explanatory comment added at the `POSSyncRecord` creation site; no import, injection, or behavior change — verified by a static structural test, not a bare `git diff`, since a comment-only change is expected and intentional).
- [x] Independent review loop, code phase (outbox correctness, crash/replay, state truthfulness, security/tenancy, verification-gap) — see Dev Agent Record — Implementation below for outcome.

## Dev Agent Record

Not yet started — no implementation has occurred.

### Independent Review — Round 1 (2026-08-16, five parallel fresh-context reviewers during planning: architecture alignment, outbox reliability, state truthfulness, security/tenancy, BMAD readiness)

This review ran against the planning artifact itself (this story, DL-069, and the related `epics.md`/`sprint-status.yaml`/`deferred-work.md` updates), since no code exists yet to review.

**Architecture alignment: no findings requiring correction, one traceability addition made.** Independently re-confirmed `pos-sync.processor.ts` makes zero network calls and `print-jobs.processor.ts` genuinely does open a direct TCP socket (DL-069's factual basis holds). Added an explicit sentence distinguishing this story's dispatcher from `docs/architecture.md` §4.8's separate, still-unbuilt on-premise IdealPOS Agent, to close a traceability gap a downstream reader skimming the stale diagram alone could fall into.

**Outbox reliability: two real correctness gaps found and fixed, two low-severity precision fixes made.** (1) The original draft's Observability section had a broken monitoring predicate (comparing a column that would be `NULL`, not old, for a stuck claim) — fixed with two correctly-scoped predicates. (2) The original draft's premise that "`PosSyncProcessor` never throws" was false for infra failures (as opposed to malformed business input); combined with the queue having no configured retry and the dispatcher marking `dispatchedAt` before the worker ran, this left a real, un-recoverable stuck-row path — fixed by adding AC17 (a mandatory bounded-retry-and/or-long-horizon-safety-net requirement) and correcting the two affected Behavior Matrix rows. (3) Added AC18 (bounded sweep batch size) to prevent an unbounded first-deploy backlog burst. (4) Corrected the BullMQ deterministic-`jobId` claim to note it only holds while the original job is still active/waiting, not after cleanup/TTL removal — noting `PosSyncProcessor`'s own terminal-state CAS guard, not the `jobId` mechanism, is the actual unconditional safety net.

**State truthfulness: no actual overstatement found; three wording-precision fixes made** to reduce future misreading risk — renamed "acknowledgement evidence" to "dispatch-confirmation evidence" to avoid conflating it with the pipeline's real terminal-acknowledgement stage; added an explicit caveat that `dispatchedAt` carries none of `printedAt`/`deliveredAt`'s external-evidence weight; reworded the naming-convention aside to avoid using the word "printed" at all, for clean consistency with AC16.

**Security/tenancy: no vulnerabilities found; two specification gaps closed.** Added an explicit acknowledgment that BullMQ-over-Redis is itself an internal transport hop deserving (and receiving) its own trust analysis, rather than implying "no IPC boundary" means "no boundary at all." Added a requirement for per-row structured dispatch logging (not one aggregate multi-venue sweep-result log line) to the Observability section. Payload-spoofing risk, Redis-credential distribution, and audit-posture-versus-precedent were all independently verified safe as designed, no change needed.

**BMAD readiness: one testability gap fixed, one implementation-mechanism ambiguity noted as a non-blocking Dev Note.** AC7 ("no shared Redis credentials leave the cloud") had no stated verification method unlike its sibling ACs — fixed by adding a concrete "Verified by" clause. The sweep's periodic-trigger mechanism (no scheduling library exists in this repository yet) was flagged as worth naming explicitly for the implementer, including a heads-up about a possible future naming/mechanism overlap with epics.md's still-unbuilt `E9-S10` — added as a Dev Note, not a blocking finding, consistent with story 8-1's own precedent of leaving comparable implementation-placement decisions to the dev-story session.

All fixes applied within this round; no second correction loop was needed (one of the three permitted rounds used).

## Dev Agent Record — Implementation (2026-08-16, this session)

### Pre-implementation trace

```text
Committed order transaction (orders.service.ts:persistOrder, $transaction, UNCHANGED)
  → POSSyncRecord created (status: not_synced) — DB: same transaction as Order/OrderItem/PrinterJob;
    owner: OrdersService; identifier: POSSyncRecord.id (uuid, orderId @unique); idempotency: one
    record per order, DB-enforced; retry: n/a (part of story 6-1's already-proven transaction);
    acknowledgement: the committed row itself; crash-window: covered by story 6-1's own proof;
    test evidence: story 6-1/9-1's existing suites (unchanged, re-passed: 90/90 → 94/94 after this story).
  → outbox eligibility — DB: PosSyncDispatcherService.sweep()'s SELECT (advisory candidate discovery
    only); owner: the dispatcher; identifier: POSSyncRecord.id; idempotency: n/a at this stage (read-only);
    retry: the sweep itself, re-run periodically or on demand; acknowledgement: n/a; crash-window: n/a
    (no write yet); test evidence: unit + integration, both suites, "eligible" counts asserted.
  → database claim — DB: a single guarded updateMany (CAS on status/dispatchExhaustedAt/dispatchClaimId/
    dispatchClaimExpiresAt/dispatchedAt); owner: the dispatcher instance that wins the CAS;
    identifier: a fresh dispatchClaimId (uuid) per claim attempt; idempotency: DB-enforced (count=0 for
    the loser); retry: lease-expiry-governed re-claim (AC4) plus the AC17 safety-net re-claim;
    acknowledgement: the claim write itself (dispatchClaimedAt/dispatchClaimExpiresAt);
    crash-window: covered by AC4 (before publication) — proven real-Postgres, repeated 6x clean;
    test evidence: REAL_POSTGRES (concurrent-claim test, lease-expiry tests, venue-isolation test).
  → deterministic BullMQ publication — DB: none (Redis only); owner: the claim-winning dispatcher
    instance; identifier: jobId `pos-sync-{posSyncRecordId}` (hyphen, not colon — BullMQ rejects
    colons, found and fixed during implementation); idempotency: BullMQ-level while the job is
    active/waiting, PLUS PosSyncProcessor's own unconditional terminal-state CAS as the real backstop;
    retry: BullMQ's own attempts/backoff (added during independent review — see below) plus the
    dispatcher's own re-claim; acknowledgement: dispatchedAt write, itself guarded by dispatchClaimId
    so a superseded claim's late confirmation cannot clobber a fresher one; crash-window: covered by
    AC4(c) — enqueue-then-crash is safe because the enqueue already happened and duplicate re-enqueue
    is a no-op or a safe redundant job; test evidence: REAL_REDIS_OR_QUEUE_WORKER (the "duplicate add()"
    test and the dedicated BullMQ failure-recovery mechanics test, both against real Redis).
  → PosSyncProcessor (story 9-1, UNCHANGED — confirmed byte-identical by this session's own reviewers)
    — DB: its own existing $transaction; owner: story 9-1; identifier: posSyncRecordId from the job
    payload; idempotency: its own existing terminal-state CAS; retry: now genuinely meaningful for the
    first time, since BullMQ's attempts/backoff (added this session) actually re-invokes it on a
    transient throw; acknowledgement: the terminal status write; crash-window: story 9-1's own proof,
    unaffected by this story; test evidence: story 9-1's existing suite (re-passed unchanged) plus this
    story's real-worker end-to-end test.
  → POSSyncRecord classification — unchanged from story 9-1: `unsupported` (real adapter type, no
    implementation) or `not_applicable` (adapter `none`, though such venues never get a row at all —
    see persistOrder's own guard). Never `synced`. Confirmed structurally unreachable by this story's
    truthfulness reviewer.
  → Order.posSyncStatus mirror — unchanged from story 9-1, same transaction as the classification write.
```

### Implementation notes

The dispatcher was built as a single new service (`PosSyncDispatcherService`) with no dependency on `OrdersModule` — it depends only on `PrismaModule` (transitively) and `QueueModule`, matching the story's stated design goal of zero coupling to the already-reviewed order-creation path. `orders.service.ts` required only a comment update (documenting why no direct enqueue call lives there), not a logic change.

Two real bugs were found and fixed during the implementation-and-first-verification pass, before any independent review:

1. **Invalid BullMQ jobId.** The original design used `pos-sync:{id}` (colon-separated); BullMQ's job-ID validator rejects colons outright (`Custom Id cannot contain :`). Found immediately when the first integration test run failed with that exact error on three different tests. Fixed to `pos-sync-{id}` throughout the service, its unit tests, and its integration tests.
2. Nothing else — the rest of the design (claim CAS, safety-net eligibility predicate, exhaustion budget) worked as designed on the first real-Postgres run once the jobId was fixed.

### Independent Review — Round 1, code phase (2026-08-16, five parallel fresh-context reviewers with full tool access, running real tests against the real local Postgres/Redis)

**Outbox correctness reviewer: no correctness gaps found**, other than one **P2** latent-invariant note (if `dispatchClaimId` were ever set without `dispatchClaimExpiresAt` by something other than this service, the row would be unreachable short of exhaustion — not possible through any code path in this codebase today). **Fixed**: documented the invariant directly in the schema. Concurrent-claim, ABA, and expired-lease-race scenarios were all traced and independently re-run against real Postgres (3+ repeated runs of the concurrent-dispatcher test) with no gap found.

**Crash/replay reviewer: one real P0 found and fixed.** The AC17 "safety net" re-claim, as originally implemented, reused a fixed BullMQ jobId to re-enqueue a record whose worker may have thrown (an infra failure). The reviewer proved, by reproducing it directly against real Redis, that with no `defaultJobOptions` configured on the `pos-sync` queue, a job that exhausts BullMQ's default single attempt and fails is **never removed from Redis** — a subsequent `add()` with the same jobId silently overwrites the failed job's data in place without ever re-invoking a worker. The safety net would "succeed" (no thrown error, `dispatchedAt` reconfirmed) while genuinely never reprocessing the record, until the dispatch-attempt budget exhausted and the row was marked `dispatchExhaustedAt` — permanently stuck, with misleading "dispatched" log lines along the way. **Fixed**: added `defaultJobOptions: { attempts: 3, backoff: { type: 'exponential', delay: 2000 }, removeOnComplete: true, removeOnFail: true }` to the `pos-sync` queue's registration in `queue.module.ts` (scoped to that queue only — `print-jobs`/`emails`/`calendar` registrations untouched). A new, dedicated real-Redis test (`AC17 BullMQ failure-recovery mechanics`) reproduces the reviewer's exact scenario against a throwaway queue configured identically to the fix, and proves a job that exhausts its attempts is removed and a same-jobId re-add is genuinely re-processed. All other crash-window claims (before-claim, after-claim-before-publish, after-publish-before-confirm, Redis outage, restart/backlog-drain) were independently traced and/or re-run and confirmed safe.

**State truthfulness reviewer: no fabrication path found.** Confirmed `pos-sync.processor.ts` is byte-identical to its pre-story-9-3 state (file mtime and content both predate this story's changes). Confirmed the dispatcher writes only its own bookkeeping columns, never `status`/`errorMessage`/`posOrderId`/`Order.posSyncStatus`. Flagged the original AC9 integration test as timing-race-prone against the real, concurrently-running `PosSyncProcessor` worker (not falsely-passing — it would fail loudly, not mask a violation — but flake-prone). **Fixed**: rewrote the AC9 test to use a race-free `jest.spyOn` structural assertion, and in doing so discovered and fixed a genuine bug in the test itself (its original id-based filter could misattribute the real worker's legitimate `status` write to the dispatcher during a race) — the fix filters by the presence of dispatcher-only bookkeeping fields instead, which is race-proof by construction.

**Security/tenancy reviewer: no vulnerabilities found; two minor gaps closed.** (1) `POS_SYNC_DISPATCH_CLAIM_LEASE_MS` had no upper bound and no cross-field validation against `POS_SYNC_DISPATCH_SAFETY_NET_MS` — a misconfiguration Joi's per-key bounds couldn't catch (harmless in practice, since downstream idempotency absorbs the resulting redundant re-claim, but silent). **Fixed**: added a Joi `max` plus a startup assertion in the service's own constructor that fails fast if the lease isn't strictly less than the safety-net threshold. (2) A stale comment in `orders.service.ts` (from story 9-1) claimed "no `.add()` call exists anywhere in this codebase," no longer true. **Fixed**: rewrote the comment to describe the real, current architecture and point to the dispatcher.

**Verification-gap reviewer: ran both test suites directly** (13/13 unit, then-15/15 integration before this round's fixes) and named 6 Required Behavior Matrix rows with no dedicated test, plus flagged one near-tautological unit-test assertion. **Addressed**: added real-Postgres tests for "online-paid vs. in-person order" parity and "cancelled order still dispatches," and a unit test for "crash after send" (confirm-write fails after a successful enqueue). Strengthened the near-tautological "never publishes to any other queue" unit test's comment to correctly attribute the real structural proof to the integration suite's print-jobs-count-unchanged test, which it is. **Consciously deferred, not silently dropped** (documented in `deferred-work.md`): an explicit kill-and-restart process simulation for "crash before send" (already covered in effect by the lease-expiry re-claim tests, which simulate the resulting state directly); forcing a genuine mid-transaction Postgres error inside `PosSyncProcessor.process()` itself (the AC17 tests prove the *recovery mechanism*, not a forced *real* infra fault — safely forcing one without fault-injection infrastructure beyond this story's scope was judged disproportionate); a live KDS WebSocket assertion (the static-source check that the dispatcher never references `orders.gateway`, plus the real print-jobs-queue-count-unchanged test, were judged sufficient proof of non-coupling); the periodic `setInterval` timer path itself is untested by design (disabled during tests to prevent cross-test contamination — see the class's own doc comment) — its wrapped logic (`sweep()`) is fully tested, but the timer wiring's own error-handling branch has zero direct execution coverage.

**Net effect of this correction loop**: one real P0 (BullMQ failure-recovery) found and fixed, backed by a new deterministic real-Redis reproduction test; one P2 (schema invariant) documented; several P2/P3 precision and coverage gaps closed; three items consciously deferred with reasoning recorded. One correction loop used of the three permitted — the fixes converged cleanly (all touched tests re-run clean 6+ times, no new finding on re-verification) and a second loop was not required.

### Final verification (after all fixes)

- **Unit**: `npx jest` — 364/364 pass (13 for the new dispatcher spec, up from 12 after the crash-after-send addition; zero regressions across the other 38 suites).
- **Integration**: `npm run test:integration` — 94/94 pass across 6 suites (19 for the new dispatcher spec, up from 15 after the 4 review-driven additions; zero regressions in `orders`/`reservations`/`menu`/`printer-jobs`/`pos-sync.integration-spec.ts`, all pre-existing and unmodified).
- **Repeated runs**: the dispatcher's own integration suite was re-run 6+ consecutive times after the final fix set with zero flakes (19/19 every time); one genuine flake was caught and fixed *during* this process (the AC9 race described above), not hidden.
- **Static checks**: `tsc --noEmit`, `npx nest build`, `npx prisma validate`, and `eslint` (all touched files) all clean.
- **Migration**: applied to the shared local dev Postgres (additive, zero pre-existing rows affected) and separately proven via a full 7-migration clean-from-zero deploy against a disposable, discarded container — see `VERIFY.md`.
- **Stray-data hygiene**: zero leaked rows from this story's own test tag (`phase9-3-integration-test`) confirmed after every run. Two pre-existing, already-documented, unrelated issues were encountered and worked around during verification (not introduced by this story, not fixed by it): the already-tracked `menu.integration-spec.ts` row-leak (deferred-work.md, P2) reproduced again and was manually cleaned per the established precedent; repeated back-to-back test runs during this session's own verification exhausted the shared local auth rate-limit bucket, requiring a local Redis key clear (`rate-limit:*`) between runs — not a defect, an artifact of unusually heavy re-verification in one session.

## File List

- `backend/prisma/schema.prisma` (modified — `POSSyncRecord` gains 7 dispatch-bookkeeping columns + 1 index, with an invariant comment added during review)
- `backend/prisma/migrations/20260816120000_pos_sync_outbox_dispatch/migration.sql` (new)
- `backend/prisma/migrations/20260816120000_pos_sync_outbox_dispatch/VERIFY.md` (new)
- `backend/src/pos-sync/pos-sync-dispatcher.service.ts` (new; review fixes — jobId format, cross-field lease/safety-net validation)
- `backend/src/pos-sync/pos-sync-dispatcher.service.spec.ts` (new; review fixes — jobId format, strengthened print-jobs-isolation assertion, new crash-after-send test)
- `backend/src/pos-sync/pos-sync.module.ts` (modified — imports `QueueModule`, registers `PosSyncDispatcherService`)
- `backend/src/queue/queue.module.ts` (modified — review fix: `defaultJobOptions` added to the `pos-sync` queue registration only)
- `backend/src/app.module.ts` (modified — 5 new optional `POS_SYNC_DISPATCH_*` Joi-validated env vars)
- `backend/src/orders/orders.service.ts` (modified — comment only, at the existing `POSSyncRecord` creation site; no logic change)
- `backend/test/pos-sync-dispatcher.integration-spec.ts` (new; review fixes — jobId format, race-free AC9 rewrite, new BullMQ failure-recovery/order-source-parity/cancelled-order/static-prisma.order tests)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (modified — status tracking)
- `_bmad-output/implementation-artifacts/deferred-work.md` (modified — pos-sync entry marked resolved-with-evidence; new consciously-deferred test-coverage items logged)
- `_bmad-output/implementation-artifacts/9-3-pos-sync-outbox-dispatch.md` (this file)

## Change Log

- 2026-08-16: Story created during the outbox-dispatch planning session, in direct response to the repository audit's dormant-queue finding (`_bmad-output/audits/repository-story-audit-2026-08-16.md` §17). Rejected the audit's shorthand "wire both queues" framing after direct code inspection revealed an architectural asymmetry (DL-069): `pos-sync` is safe to dispatch now (no network I/O); `print-jobs` is not (direct cloud-to-LAN TCP for `tcp`/`network` printers) and remains explicitly out of this story's scope, blocked pending a connector. Status set to `ready-for-dev` — genuinely unblocked, no dependency on story 2-9. Not implemented this session.
- 2026-08-16 (planning independent review, round 1): Five parallel fresh-context reviews run against the planning artifact (architecture alignment, outbox reliability, state truthfulness, security/tenancy, BMAD readiness). Two real correctness gaps found and fixed by the reliability reviewer (a broken monitoring predicate; a false "processor never throws" premise that left infra-failure-triggered stuck rows with no recovery path — closed via new AC17/AC18). Several precision/traceability fixes applied from the other four reviews. Status remained `ready-for-dev`. One correction loop of three permitted.
- 2026-08-16 (implementation session, this session): Implemented the full vertical slice — additive migration (7 columns + 1 index), `PosSyncDispatcherService`, module wiring, unit and real-Postgres/real-Redis integration tests. One bug found and fixed during implementation before any review (invalid colon-containing BullMQ jobId). Five parallel fresh-context code reviewers ran with full tool access against the real implementation and real local Postgres/Redis. One real P0 found and fixed (BullMQ `pos-sync` queue had no `defaultJobOptions`, so the AC17 safety net's reused jobId silently no-op'd against an already-failed-but-never-removed job instead of genuinely re-queuing it — fixed with `attempts`/`backoff`/`removeOnFail`/`removeOnComplete`, proven with a new dedicated real-Redis reproduction test). Several P2 gaps closed (schema invariant documentation, cross-field env-var validation, stale comment, a race-prone test rewritten — which itself caught and fixed a genuine test bug — and 4 new behavior-matrix tests added). Three items consciously deferred with reasoning recorded in `deferred-work.md`. One correction loop of three permitted; fixes converged cleanly, re-verified 6+ consecutive clean runs, no second loop required. Final evidence: 364/364 unit, 94/94 real-Postgres integration (19/19 for this story's own suite, including a `REAL_REDIS_OR_QUEUE_WORKER`-tier end-to-end test — the first in this repository for either previously-dormant queue), zero regressions, zero stray test data, `orders.service.ts` and `pos-sync.processor.ts` both confirmed to carry no logic changes. Status set to `done`.
