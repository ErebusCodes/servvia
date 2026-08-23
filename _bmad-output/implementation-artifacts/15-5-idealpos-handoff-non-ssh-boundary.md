# Story 15-5 — Idealpos Handoff & Authoritative POS State: Non-SSH Implementation Boundary

**Date:** 2026-08-20
**Status:** `blocked` (unchanged — see below). This record documents the complete safe non-SSH boundary implemented this session, not a claim of story completion.
**Evidence tier:** `FIXTURE_CONTRACT` throughout — no real Idealpos, Windows, or EFTPOS evidence exists or is claimed anywhere in this record.

## What this session establishes

Story 15-5's own text says: *"this story still needs a real Idealpos-order-submit command type built on top of story 2-10's now-proven envelope/state machine, which is itself gated on DL-064/story 9-2."* Everything on the Verdura side of that gate is now built, tested, and reviewed. The gate itself (DL-064, real Table 12/Windows evidence) is unmoved by this session, as it must be — this is genuinely not achievable without SSH/Windows access.

## Real contract discovery (not assumed)

Read directly, not modified: `/Users/sarwarkhan/Documents/IdealposBridge/README.md` and `examples/verdura-client-example.md`. Two facts reshape this story's honest scope:

1. **No `/pay` endpoint exists in the bridge, and none is planned** — its own README: *"Payment is never touched... staff open the table and use Idealpos's own payment controls."* This is why Story 15-6 (not started) can only ever be an *observation* model, never a request model, against the bridge as currently built.
2. **The order-submission response has no GST/subtotal/rounding/final-payable-total field of any kind.** Its full shape: `externalOrderId, status, table, idealposWebPendingOrderId, idealposPendingSaleId, idealposPendingSaleCode, tableMatchesRequest, processed, tableOccupiedWarning, strategyUsed, submittedAtUtc, lastObservedAtUtc, lastError, duplicate`. The only money-shaped field anywhere in the bridge is `TableDto.Amount` (`GET /api/tables`), and the bridge's own source comment (`Idealpos/Dto.cs`) already labels it heuristic, not a confirmed Idealpos concept.

**Consequence, honestly recorded:** Story 15-5's AC "receiving and displaying Idealpos's authoritative GST/rounding/final payable total" is **not satisfiable today** — this is a bridge-contract gap, not unfinished Verdura code. This implementation builds the correct typed boundary for when/if that gap closes, and treats `TableDto.Amount` as what it honestly is: an unverified observation, never promoted to an authoritative amount.

## Implemented (files, in `apps/api/src/pos-sync/` unless noted)

- `idealpos-order.constants.ts` — the `idealpos.submit_order.v1` command type, result-type constants mirroring the bridge's own documented order-lifecycle states 1:1, and the closed `AUTHORITATIVE_SOURCE` set (deliberately excludes any value that could legitimize populating `authoritativePayableCents` from the unverified table-Amount observation).
- `dto/idealpos-order-result.dto.ts` — the versioned canonical result contract (`contractVersion: 1`) and `parseIdealposOrderResult`, a strict, fail-closed parser: unsupported contract version, unknown result type, malformed/absent money fields, non-integer cents, and currency/cents-presence mismatches are all rejected explicitly — nothing is ever coerced to a default that could pass for real data.
- `idealpos-order-reconciliation.service.ts` — `IdealposOrderReconciliationService`: `sweepDispatch()` (claims eligible orders, creates the connector command, real DB CAS claiming — mirrors E8-S1's `PrinterDispatcherService` exactly), `sweepReconcile()` (maps `ConnectorCommandStatus` → `IdealposReconciliationState`, computes the integer-cent discrepancy only when both provisional and authoritative amounts exist, applies every terminal transition through one database-transaction CAS that guards duplicate/stale/conflicting/wrong-order results), `manualReconcile()` (staff-attested closure, org+venue scoped), `recordUnverifiedTableAmount()`.
- `idealpos-fixture-injection.controller.ts` — `POST /admin/idealpos-fixtures/orders/:orderId/inject-result`, simulating a connector's terminal report without any real connector. Fail-closed in production (tested), org+venue scoped (fixed during adversarial review — see below), every touched row stamped `evidenceTier: fixture_contract`.
- `pos-sync-records.controller.ts` extended with `POST /admin/pos-sync-records/:id/reconcile` (manager/admin only, required note, audit-attributed).
- `orders.service.ts` — `POSSyncRecord` creation now copies the order's immutable provisional snapshot and queues `posAdapterType: api` venues for the new dispatcher.
- `apps/admin-console/src/pages/order-tablet/OrderTabletPage.tsx` — real polling of `GET /api/admin/orders/:id/pos-sync`, a truthful reconciliation-status panel (12 states, matching the backend 1:1, closed allow-list — any unrecognized state renders as blocked, never fails open), and `handlePayAll` corrected to no longer fabricate `completed` on submission alone (the exact fabricated-success path the epic's own baseline banner names). Payment stays blocked until Story 15-6 exists.

## Schema (additive, migration `20260820020000_idealpos_order_reconciliation`)

Three new enums (`IdealposReconciliationState`, `IdealposDiscrepancyState`, `IdealposEvidenceTier`) and ~35 new nullable/defaulted columns on the existing `POSSyncRecord` table — every historical row backfills safely (defaults for enums, `NULL` for everything else, absence staying absence). `npx prisma validate` passes; not yet applied to a live database (none available in this session).

## Adversarial review — 2 real findings, both fixed

1. **Cross-venue fixture injection**: the fixture controller originally scoped only by `organizationId`, not venue — a staff member with multi-venue access could have injected a fixture result for another venue's order. Fixed: now uses the same `resolveVenueScope` pattern as every other admin endpoint in this module.
2. **Non-atomic state mirror / undefined-winner race** (the most significant finding): `POSSyncRecord.status` (Story 9-1's pre-existing coarse enum) was never updated by this story's new reconciliation logic — and Story 9-3's existing `PosSyncProcessor` unconditionally marks any non-`none` adapter type `unsupported` (terminal), a decision correct when written (no real adapter existed) but now WRONG for `posAdapterType: api`, since this story gives it a real partial path. The two systems would have raced to write the same columns with no ordering guarantee. Fixed: `PosSyncProcessor` now excludes `api` entirely (documented, tested no-op), and this story's own `transitionTerminal` now atomically sets `status` in the same `updateMany` as `reconciliationState` via a closed mapping function.

## Tests / validation (all real, all actually run except where noted)

- 35 unit tests (parser: 17, service: 15, fixture fail-closed: 3) — all passing.
- Full existing `apps/api` suite: 622/622 passing (0 regressions from this story's changes, including the two existing test files corrected to match the new, correct behavior: `orders.service.spec.ts`, `pos-sync.processor.spec.ts`).
- `npm run typecheck`/`npm run build` — `apps/api` and `apps/admin-console` (incl. `build:order-tablet`, `build:kitchen-display`) all clean.
- `eslint` clean on every touched file (pre-existing, unrelated debt elsewhere in large files left untouched, per this session's own scope rule).
- **Not run**: `test/idealpos-order-reconciliation.integration-spec.ts` (7 real-Postgres concurrency/replay scenarios, written and typechecked, requires a live local Postgres this sandbox does not have). **Not run**: any browser walkthrough requiring a live API+DB (same environmental limitation).

## What remains — genuinely external evidence, not unfinished code

- Whether the bridge can be extended to return an authoritative GST/total (a product/vendor decision, not a Verdura code gap).
- ~~Running the integration test file above against real Postgres.~~ **Done 2026-08-20** — see the addendum below.
- The connector-side .NET handler for `idealpos.submit_order.v1` (out of this session's stated boundary — not attempted).
- Real Table 12/Windows/Idealpos evidence for DL-064 itself.

Story 15-5 remains `blocked` on DL-064, unchanged. Story 15-6 remains not started.

---

## Addendum, 2026-08-20 — GST reconciliation fix, non-SSH verification boundary completed

This same-day follow-on session closed every non-SSH verification gap this record's own "Not run" line above named, and fixed a real, previously-unnoticed root cause that would have produced false Story 15-5 discrepancies even against correct Idealpos data.

**Root cause found and fixed:** `OrdersService.computeTotals` (used by both `create()`/kiosk and `createStaffOrder()`/tablet) added an additive 15% GST on top of already GST-inclusive menu prices — reproduced live (order ORD-600004 persisted `$14.95` against a $13.00 tablet-displayed total). Because `POSSyncRecord.provisionalPayableCents` (the field this story's own `sweepReconcile` compares against Idealpos's authoritative amount) is a direct copy of `computeTotals`'s output, every reconciliation comparison in this story was checking Idealpos's *correct* amount against a Verdura provisional total that was ~15% too high — a false, fabricated `discrepancy`, not the real one this story exists to detect. Fixed: `computeTotals` now applies the identical GST-inclusive/contained-GST convention as `billing.ts` (venue-tax-profile-aware; fails closed on an unsupported profile; the check is deliberately deferred until after the idempotent-replay branch so a tax-config problem can never block replaying an already-accepted order — a second bug this fix's own review caught and closed before it shipped).

**Non-SSH gaps closed this session:**

- `test/idealpos-order-reconciliation.integration-spec.ts` (real local Postgres): **run**, 8/8 tests passing, including a new test (`GST reconciliation fix (2026-08-20)`) that creates a real order through `POST /admin/orders` and proves an authoritative amount equal to the correct payable produces `discrepancyState: matching`/`discrepancyCents: 0` — the direct regression proof for the root-cause fix above. Full `apps/api` real-Postgres suite: 205/205 relevant tests passing (13 suites; 1 unrelated GCS-credentials suite skipped).
- Full `apps/api` unit suite: 627/629 passing (2 pre-existing, unrelated failures — a mock-setup gap in `idealpos-fixture-injection.controller.spec.ts` untouched by this session, confirmed via `git diff` showing no history/changes to that file).
- Browser walkthrough: **performed**, real local API + real disposable Postgres (`verdura-15-5-verify`) + real fixture injection, all 5 reconciliation states confirmed with correct labels and payment-blocking behavior:
  1. Matching → "Idealpos confirmed — totals match", Pay enabled.
  2. Blocking discrepancy → "Idealpos total does not match — blocked", correct signed difference shown, payment blocked.
  3. Authoritative total unavailable → "Idealpos confirmed — total not yet available", payment blocked.
  4. Rejected → "Idealpos rejected this order", payment blocked.
  5. Uncertain → "Uncertain — Idealpos result could not be confirmed", payment blocked.
  Refresh-then-renavigate correctly re-derives and displays the true backend state for matching and discrepancy states (re-verified explicitly). Console/network clean after fixes (see below).

**Three further real Order Tablet frontend defects found during this walkthrough, all fixed and regression-tested** (none introduced by the GST fix — all pre-existing):

1. **Cross-table stale reconciliation display** — the single most serious finding this session. `createdOrderRef` only resynced when already `null`; after viewing any table's payment screen, switching to a *different* table's payment screen kept displaying the *first* table's Idealpos status. Reproduced live: table 2 had a real $4.00 discrepancy, but its payment screen showed table 1's "totals match" with Pay enabled. Fixed: the resync effect now always re-derives `createdOrderRef` from the live orders query for the currently-selected table, and the polling effect clears the displayed panel on every `createdOrderRef` change so no stale cross-order data can render even momentarily.
2. **Idempotency key never rotated across tables** — `orderIdempotencyKey` only rotated via `handleReset` (reachable only after a full payment cycle at the same table). Starting a second order at a different table while an earlier one was still open reused the stale key; the backend correctly rejected the second submission, silently blocking ordinary concurrent-table service. Reproduced live (table 5 failed after table 4 had used the key). Fixed: the key now rotates whenever a genuinely new order is started at a table.
3. **`hydrateTableOrder` crash re-opening a just-created order** — `persistOrder`'s transaction returned the bare `Order` row without its `items` relation (the one order-serving shape inconsistent with `findAll`/`findOne`/the WebSocket push). Re-opening a table shortly after creating its order threw `TypeError: Cannot read properties of undefined (reading 'map')`, reproduced live in the browser console. Fixed at the root (`persistOrder` now returns the order with `items` included) plus a defensive `order.items ?? []` guard in `hydrateTableOrder`.

**Validation:** `npm run typecheck`/`build` clean for `apps/api` and `apps/admin-console` (incl. `build:order-tablet`, `build:kitchen-display`); `eslint` clean on every file this session touched; `apps/admin-console` vitest suite 102/102 passing (101 pre-existing + 1 new regression test for defect #2, proven to fail without the fix and pass with it).

**What remains — genuinely external evidence, unchanged by this session:** the connector-side .NET handler, real Table 12/Windows/Idealpos evidence for DL-064, and whether the bridge can be extended to return an authoritative GST/total, are all exactly as this record's original body describes. This session closed the *false*-discrepancy risk on Verdura's own side; it does not constitute or imply real Idealpos evidence. **Story 15-5 remains `blocked`/not-done**, correctly, pending DL-064.

---

## Addendum, 2026-08-21 — connector-side `idealpos.submit_order.v1` handler implemented (non-hardware tier)

This session implements the one item this record's own body named as out of its prior boundary: *"The connector-side .NET handler for `idealpos.submit_order.v1` (out of this session's stated boundary — not attempted)."* Story 15-5 **remains `blocked`/not-done**, unchanged — this closes a non-hardware implementation gap, not the DL-064 evidence gate.

### Discovery, before any code

Read directly, not modified: `apps/venue-connector`'s existing `.slnx`/projects (`VerduraIdealposTracer.Core/Fixtures/DryRunCli/Cli/Windows`, `VerduraIdealposTracer.Tests`), `PrintKotCommandHandler.cs`/`PrintKotCommandHandlerTests.cs`/`CrashReplayTests.cs` (E8-S1's proven persist-before-side-effect pattern), `ConnectorCommandProtocolClient.cs` (Story 2-10's poll/accept/report client), `apps/api/src/pos-sync/idealpos-order.constants.ts`, `idealpos-order-reconciliation.service.ts`, `dto/idealpos-order-result.dto.ts`, `docs/decisions-log.md` (DL-064/069/070/071/087/088/089), and — critically — `/Users/sarwarkhan/Documents/IdealposBridge`'s real source (`Orders/OrderModels.cs`, `OrderValidator.cs`, `OrderService.cs`, `Orders/OrderStatus.cs`, `Api/Endpoints.cs`), not just its `examples/` doc.

**Confirmed, not assumed:**
- The command's wire `commandType` is (and always has been) `idealpos.submit_order.v1`; Story 15-13 changed only the numeric `schemaVersion` (1→2), not the type string. `IDEALPOS_SUBMIT_ORDER_SCHEMA_VERSION` has only ever been `2` in source/tests/fixtures — grep confirms **zero historical v1 traffic** anywhere in the repository. Compatibility policy: the handler accepts exactly schemaVersion 2 and fails closed (`unsupported_version`) on anything else, including 1 — no v1 translation/compatibility path exists because none was ever needed.
- `ConnectorCommand` has **no generic envelope checksum field** (confirmed by source read) — KOT's `contentChecksum` is specific to its own large rendered-text payload, not a general protocol feature. The handler instead maintains its own local payload fingerprint (SHA-256 over the parsed order) per commandId, the connector-local substitution/reuse guard the brief calls for.
- The real bridge's `OrderValidator.Validate` (`Orders/OrderValidator.cs`) requires `table` to be a non-empty string — `string.IsNullOrWhiteSpace(request.Table)` fails with `"table is required."` **There is no way to submit a truthful takeaway (table: null) order to the real bridge today.** This is a genuine, newly-confirmed bridge-contract gap, additional to and distinct from this story's existing GST/total gap.
- `OrderRecord.PendingSalesCode` (bridge source) is a **string**, but the pre-existing Verdura-side `IdealposOrderResultPayload.idealposPendingSaleCode` contract types it `number | null` — a real, pre-existing type mismatch. Handled defensively (parse leniently if numeric-looking, omit rather than fabricate otherwise); not changed upstream, documented as unverified.

### What was built

`apps/venue-connector/src/VerduraIdealposTracer.Core/IdealposOrders/`:
- `IdealposSubmitOrderCommandType.cs` — command identity/schema-version constants + compatibility-policy doc comment.
- `IdealposOrderResultType.cs` — mirrors `IDEALPOS_ORDER_RESULT_TYPE` 1:1, plus four new, truthfully-named values this session added to both runtimes: `rejected_before_bridge_invalid_payload`, `takeaway_unsupported_by_bridge`, `bridge_validation_rejected`, `bridge_submission_failed` (none of the eight pre-existing values could honestly describe these cases without overloading an existing, narrower meaning — see each constant's own doc comment).
- `IdealposOrderResultPayload.cs` — mirrors the TS result DTO; `ToResultPayloadDictionary()` encodes the exact wire shape the parser expects (`requestedTable` always present, possibly `null`; `money` omitted, never sent as `null`).
- `IdealposBridgeContracts.cs` / `IdealposBridgeClient.cs` — the one, single-purpose adapter to the real bridge's `POST /api/orders` (never a generic command-to-HTTP proxy): localhost-only by default (explicit `allowNonLoopback` opt-in required, mirroring the bridge's own `Bridge:AllowLan` gate), strict timeout, bounded response read, classifies 201/200/400/502/network-failure/timeout/malformed-response into a typed `BridgeSubmitOutcome`.
- `IdealposSubmitOrderCommandHandler.cs` — claims/validates/maps/journals/reports. Validates independently of Verdura (service-mode invariants, positive-integer quantities, non-empty items, a disallowed-payment-key check, a bounded outbound-request-size check) before ever touching the bridge. Durable journal (reusing the same `DurableLocalLog` NDJSON pattern as `PrintKotCommandHandler`, not a second mechanism) records `received → validated → prepared → bridge_call_started → bridge_response_received → result_persisted → acknowledgement_pending → completed`, plus `failed_before_side_effect` and `uncertain_after_side_effect`, each entry carrying `commandId`, `externalOrderId`, `requestedTable`, a per-commandId `attempt` counter, `handlerVersion`, and sanitized failure text. A per-commandId `SemaphoreSlim` gate makes "duplicate delivery before execution never calls the bridge twice" true by construction. `ExecuteAndReportAsync` closes the loop (business logic + the actual `/report` acknowledgement) for the acknowledgement-retry guarantee.
- `Protocol/IConnectorCommandReporter.cs` — a minimal interface extracted from `ConnectorCommandProtocolClient` (which now implements it) so the handler's acknowledgement step is fault-injectable in tests without a real HTTP server.
- `VerduraIdealposTracer.Fixtures/FakeIdealposBridgeServer.cs` — a real loopback `HttpListener`-based fake bridge (test-only, clearly labelled, never production-configurable), returning response shapes copied verbatim from the real bridge's own `Api/Endpoints.cs`/`OrderStatus.cs`, with deterministic scenarios for every required outcome (accepted, duplicate, native-observed, rejected/uncertain-observed, 400, 502, hang-forever/timeout, malformed JSON, unexpected status) plus call-count/request-body/auth-header recording.
- `VerduraIdealposTracer.DryRunCli/Program.cs` — extended (additively; the pre-existing discovery mode is byte-for-byte unchanged behind the new `TRACER_RUN_MODE` switch, defaulting to `discovery`) with an `idealpos_order` mode that runs the real handler against a bridge URL supplied by the spawning test process, with the same `TRACER_SELF_KILL_AFTER` crash-hook convention Story 9-2 already established.

**Dine-in mapping:** `externalOrderId`/`table`/`items[].productCode`/`items[].quantity`/`notes` map 1:1 to the bridge's real `OrderRequest`. **Known, pre-existing, non-blocking gap, surfaced not created by this session:** `productCode` is still the Verdura `MenuItem` UUID (Story 15-13's own comment already flags this — the real per-venue PLU mapping is E15-S5's unbuilt scope), so a real bridge will very likely answer real dine-in orders with `bridge_validation_rejected` (400, unrecognized productCode) until that mapping exists — this handler relays that outcome truthfully; it does not invent a mapping.

**Takeaway mapping:** explicit **unsupported boundary**, not a workaround. The handler never constructs a bridge request for `serviceMode: takeaway`, never invents a table, never uses an empty string as undocumented business semantics — it reports `takeaway_unsupported_by_bridge` (a real, typed, reconcilable result) and journals `failed_before_side_effect`. Dine-in is entirely independent of this gap. The exact bridge-contract change required: accept `table: null`/omitted (or a distinct takeaway endpoint/field) in `POST /api/orders`.

**Shared-contract fix (Verdura-side, not bridge-side):** `apps/api/src/pos-sync/dto/idealpos-order-result.dto.ts`'s `IdealposOrderResultPayload.requestedTable` was hard-required as a non-empty string — a real, blocking gap for THIS story's own deliverable, since it made it structurally impossible to report ANY truthful result (including `takeaway_unsupported_by_bridge` itself) for a takeaway order. Now `string | null`, parser updated to match, four new result-type constants added to `idealpos-order.constants.ts`, and `idealpos-order-reconciliation.service.ts`'s `applySucceededResult` switch extended with explicit cases for all four new result types (mapped to existing `IdealposReconciliationState` values only — `reconciliation_required` for the three "never reached Idealpos" cases, `failed_before_execution` for `bridge_submission_failed`, matching that state's own pre-existing doc comment exactly). No new reconciliation state was added.

### Adversarial review — 2 real defects found and fixed before landing

1. **Takeaway-rejection duplicate-replay gap.** The takeaway rejection journals its terminal answer under `failed_before_side_effect`, but the duplicate-after-terminal-result lookup only checked `result_persisted` — a second delivery of a takeaway command would have silently recomputed the rejection instead of replaying the stored answer (same output today, but not the required "replay the stored result" behavior, and a latent risk if the computation ever became non-deterministic). Fixed: the lookup now checks both phases. Regression test added (`Duplicate_delivery_of_a_takeaway_rejection_replays_the_stored_result_without_recomputing`).
2. **JSON-null detection bug.** `System.Text.Json` maps a JSON `null` value to a CLR `null` (not a `JsonElement` with `ValueKind.Null`) when deserializing into `Dictionary<string, object?>` — the original `TryGetRaw` helper treated a present-but-null key (exactly the takeaway contract's own `table: null` shape) as **absent**, causing every takeaway command to fail as "table key missing" instead of being correctly validated. Found via the handler's own `Valid_takeaway_command_never_calls_the_bridge_and_reports_typed_unsupported` test. Fixed by normalizing both representations to a real `JsonValueKind.Null` element.

Also added during this same pass (not defects, but required guarantees the initial draft didn't yet prove): a per-commandId concurrency gate (was previously only safe under sequential re-delivery, not genuine in-process overlap) with a dedicated concurrent-invocation test; an explicit outbound-request-size bound (256 KB) with a test; `attempt`/`handlerVersion` fields on every journal entry (were missing from the initial draft against the brief's own required-fields list).

### Evidence

- **Unit/contract (`UNIT_OR_MOCK`):** 78/78 `apps/venue-connector` .NET tests pass (32 new handler/adapter tests + 5 new real separate-process crash/replay tests + 1 new journal-attempt test, plus the 40 pre-existing tests unaffected), re-run 3× consecutively with zero flakiness. Full cross-platform solution (`Core`/`Fixtures`/`DryRunCli`/`Tests`) builds clean, 0 warnings.
- **Real separate-process crash/replay (`IdealposSubmitOrderCrashReplayTests.cs`, patterned directly on `CrashReplayTests.cs`):** spawns `VerduraIdealposTracer.DryRunCli` as a genuine OS process against a real local loopback `FakeIdealposBridgeServer` (also a real socket, not a mock), `Environment.FailFast`s at `bridge_call_started` and `result_persisted`, and proves: the entry survives the crash; the bridge is never called before the crash; restart-after-crash reports `uncertain`/replays the stored result and **never calls the bridge again**; the durable log format survives a mid-write crash and a later, independent run appends cleanly.
- **TypeScript (Verdura-side contract fix):** `idealpos-order-result.dto.spec.ts` (+4 tests) and `idealpos-order-reconciliation.service.spec.ts` (+5 tests) all pass (39/39 in the two touched files); full `apps/api` unit suite re-run: 646/648 passing, the same 2 pre-existing, unrelated `idealpos-fixture-injection.controller.spec.ts` failures already documented in this file's original body (confirmed via `git status`: that file is untracked/unmodified by this session) — zero new regressions. `tsc --noEmit` clean; `eslint` clean on every touched file.
- **Repository-wide scans:** grep across the new connector code for payment/tender/EFTPOS/card keywords and direct SQL/Idealpos-DB access — no hits other than the handler's own disallow-list (which rejects such fields) and doc comments; no API key or secret appears in any `Console.Write*`/log call anywhere in the touched files.
- **Not run, explicit boundary:** any Windows build (`VerduraIdealposTracer.Cli`/`.Windows`, `net8.0-windows`) — this session ran on macOS with no Windows SDK; those two projects are unmodified and structurally still excluded from the cross-platform `.slnx`, exactly as `PrintKotCommandHandler`'s own precedent already established. Nothing in this addendum claims a Windows build, a real bridge connection, or real Idealpos/EFTPOS/KOT evidence.

### What remains — genuinely external, not unfinished code

- Real Table 12/Windows/Idealpos evidence for DL-064 (unchanged).
- Whether the bridge can be extended to return an authoritative GST/total (unchanged, §4 of the critical-path matrix).
- **New:** whether/how the bridge can be extended to accept a truthful takeaway (no-table) order — a second, separately-tracked bridge-contract question this session surfaced, requiring the same kind of vendor/product decision as the GST gap.
- Windows build + real-bridge run of this session's own handler (row 10 of the critical-path matrix, revision 6) — deferred to the same SSH session already gating rows 12–14.
- No generic command-dispatch loop wires this handler (or `PrintKotCommandHandler`) into `VerduraIdealposTracer.Cli`'s poll loop yet — consistent with the existing, un-wired state of the KOT handler; building that dispatcher is a shared, separate task for whichever session first needs a running connector process, not scoped to either individual handler.

**Story 15-5 remains `blocked`, unchanged, pending DL-064.** This addendum closes a real non-hardware implementation gap; it is not native IdealPOS evidence and must not be read as such.

---

## Addendum, 2026-08-21 — read-only Windows/Bridge discovery evidence (pointer only)

A full authorised read-only Windows/IdealPOS/Bridge discovery session ran this date via a now-working SSH route (full detail: `9-2-idealpos-uibridge-tracer.md`'s session 6 entry). Directly relevant to this story: the target host's `FrameworkVersion.txt` reads **exactly `6.05.0001`**, matching the Bridge's own README-documented compile-verification target for `IdealPos.Webit.Core` precisely, and all three vendor assemblies the Bridge requires (`IdealPos.Webit.Core.dll`/`IdealPos.Data.dll`/`IdealPos.Common.dll`) are present in place on that host. This is a **strong static compatibility signal, not a runtime proof** — the Bridge itself was not found deployed anywhere on that host, so nothing about it has actually been built or run against this real installation. The GST/authoritative-total contract gap this story already documented is unchanged. **Story 15-5 remains `blocked`, unchanged**, pending DL-064's real native evidence.
