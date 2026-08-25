# DL-107 — DUNEDIN controlled live-order/KOT certification runbook

**Status: prepared, NOT executed.** Written to close out the error-path/
silent-failure audit performed this session (§0) and to give the
physical-presence session a single, complete, evidence-based procedure —
superseding `table19-live-test-checklist.md` and reusing `dl-099-windows-
validation-package.md`'s evidence templates where they still apply. It does
not authorise the live session by itself: the preconditions in §2 must all
be independently true, and separate explicit human sign-off (§1) is
required before step 1 may run.

This is written for the **real DUNEDIN venue on `DESKTOP-SOKKOQ7`**, not a
hypothetical "Table 19" venue — DUNEDIN's own real, disposable table should
be chosen at the time (§4 step 1), not assumed in advance.

---

## 0. What this session's audit found and fixed (context for the operator)

A full error-path/silent-failure audit was run across the production chain
(Order Tablet → proxy/WebSocket → Verdura API → PostgreSQL → POSSyncRecord/
ConnectorCommand → Venue Connector → IdealposBridge → IdealPOS → native
KOT). Two real defects were found and fixed, tested, and are on `main`:

1. **False-success on a Bridge duplicate-replay of a terminal-negative
   record** (`apps/venue-connector/src/VerduraIdealposTracer.Core/
   OrderSubmission/IdealposBridgeClient.cs`). Reachable sequence: a first
   delivery attempt fails at Bridge (e.g. `InsertOrders()` throws) → Bridge
   records `status=failed`, HTTP 502 → the connector correctly classifies
   this as transient/retryable → `IdealposOrderDispatcherService` schedules
   a retry with the same `externalOrderId` → Bridge's own idempotency store
   short-circuits and replays the ORIGINAL terminal-negative record as HTTP
   200 (`duplicate:true`) → the connector previously classified **any**
   200/201 as `Accepted` (succeeded), without reading the response body's
   `status` field — so Verdura would have marked the order
   `submitted_awaiting_confirmation` even though IdealPOS never processed
   it and never will for that `externalOrderId`. This is exactly the
   "staff believe the order reached IdealPOS when it did not" failure mode.
   **Fixed**: the client now also parses the response body's `status`
   field on a 200/201; `failed`/`rejected`/`uncertain` (Bridge's own
   terminal-negative `OrderStatus` values) are classified as `Rejected`
   (definite, non-retryable, matches Bridge's own idempotent-replay
   semantics) instead of `Accepted`. 9 new regression tests added; full
   connector suite 84/84 green.
2. **Fabricated "Kitchen open · avg 14 min" status on the Order Tablet's
   standalone header** (`apps/admin-console/src/pages/order-tablet/
   OrderTabletPage.tsx`, `apps/admin-console/src/shared/orders.ts`) — a
   hardcoded green dot shown regardless of real WebSocket state. Fixed to
   reflect `useLiveOrders()`'s real `isRealtimeConnected` signal ("Live" /
   "Reconnecting — status may be stale"), plus a 15s REST polling fallback
   while disconnected so a client whose socket never connects or stalls
   silently is never stuck showing confidently-wrong state with no path
   back to fresh data short of a manual reload. Full admin-console suite
   129/129 green, `tsc --noEmit` clean.

Everything else independently reviewed this session (see the session
transcript for full file:line detail) was already correctly hardened and
is cited as evidence, not re-litigated here:

- `ConnectorCommandService` (`apps/api/src/connector/connector-command.
  service.ts`): lease/CAS claim (`poll`), idempotent `accept`/`report`,
  conflicting-report rejection (never silently overwritten), and the
  `unknown` (accepted-but-never-reported) reconciliation sweep are all
  correct and covered by integration tests.
- `IdealposOrderDispatcherService` (`apps/api/src/pos-sync/idealpos-order-
  dispatcher.service.ts`): DL-092 (deterministic vs. transient failure
  classification, bounded exponential-backoff retry) and DL-093 (stale-
  `unknown` recovery, reusing the ORIGINAL payload byte-for-byte, bounded
  by the same attempt ceiling, relying on Bridge's own externalOrderId
  dedupe — confirmed real in `OrderService.SubmitOrder`/`OrderStateStore`,
  a durable SQLite-backed store, survives Bridge restarts) are both sound.
- `ConnectorPollingLoop`/`IdealposOrderSubmissionService`/
  `IdealposBridgeClient` (Connector side): ambiguous-timeout handling
  (`BridgeSubmissionAmbiguousException`, never converted to a false
  terminal outcome), per-command exception isolation, stable per-outcome
  idempotency keys on `ReportAsync` — all correct.
- `OrderStateStore`/`OrderValidator`/`OrderLifecycleWatcher` (Bridge side,
  separate `IdealposBridge` repo): SQLite-backed durable idempotency
  keyed on `ExternalOrderId` (survives Bridge restarts); malformed/unknown
  PLU and invalid-table requests are definite, immediate 400s; the
  lifecycle watcher's `Uncertain` state (distinct from `Failed`) correctly
  avoids ever claiming a confirmed negative outcome it can't prove, and is
  itself durably restart-safe (re-derived from SQLite's `FindActive()`
  every tick, not in-memory).
- Table-identifier matching: `TableMapSetups.Caption` was confirmed blank
  in the wrong database (`POSServer`) during an earlier session and
  populated ("1".."19") in the correct one (`IPSTransaction`, which is
  what the Bridge's own `IpsConnection` string actually targets) — cross-
  verified consistent with `import-idealpos-tables.ts`, which imported
  DUNEDIN's real 18 Table rows from the same `IPSTransaction` source. The
  Bridge additionally now falls back to `{Code}-{Index}` if `Caption` is
  ever blank for a given row, so this is not a single point of failure.
- Order-creation idempotency (`apps/api/src/orders/orders.service.ts`):
  a real `@@unique([venueId, idempotencyKey])` DB constraint, a pre-check,
  and a P2002-race handler that re-fetches the winning row — a dropped-
  response client retry can never create two orders.
- KOT-duplication across paths: `persistOrder` explicitly creates **zero**
  `PrinterJob` rows for `posAdapterType === 'api'` venues (DUNEDIN) — only
  the IdealPOS-native KOT path can ever fire for this venue; Verdura's own
  paper-printer KOT pipeline is structurally unreachable for it.
- `PosSyncDispatcherService`'s own claim query explicitly excludes
  `adapterType: 'api'` rows — the old NullAdapter/BullMQ pipeline can never
  double-process a DUNEDIN order alongside `IdealposOrderDispatcherService`.

Full regression baseline after the fixes above, all green: 764/764 API
unit tests, 266/271 API integration tests (5 legitimately-skipped GCS
tests, unrelated), 129/129 admin-console tests, `tsc --noEmit` clean, 84/84
venue-connector .NET tests.

**External blocker hit this session, not resolved:** this session had no
working SSH path to `DESKTOP-SOKKOQ7` (no key loaded in the local SSH
agent — `ssh-add -l` reports "The agent has no identities" — and the
hostname does not resolve from this Mac without a working `~/.ssh/config`
entry or `/etc/hosts` mapping, both currently absent). No live DUNEDIN
verification, deployment, or SQL check was possible this session as a
result — everything in §0 above is code-level (local unit/integration
tests, cross-repo static verification), not live-stack-verified. **To
unblock:** either load the passphrase-protected key into the agent and
confirm a resolvable host/IP for `DESKTOP-SOKKOQ7` (a human must type the
passphrase — it cannot be supplied non-interactively), or accept that
deployment/live-SQL verification of these fixes waits for the physical-
presence session itself, where the operator has direct machine access.

---

## 1. Required approval

Executing §4 below requires **separate, explicit** written sign-off,
beyond what authorised this audit session, that:

(a) DUNEDIN's chosen table (§4 step 1) may be used for one real,
    disposable order that will be voided afterward through IdealPOS's own
    UI;
(b) the operator has physical or remote-hands access to `DESKTOP-SOKKOQ7`
    sufficient to observe the IdealPOS UI, the physical kitchen printer,
    and to run the recovery drills in §4 steps 10–11;
(c) one real physical KOT print is authorised.

This document does not grant that approval, and no step in §4 may be
executed until it exists.

---

## 2. Preconditions (verify ALL before step 1)

Re-verify every item below against the live host at session start — do
not trust this document's own dates.

1. **Code state.** `main` includes this session's two fixes (commit
   messages: "Fix Connector misreporting Bridge's terminal-negative
   duplicate replay as success", "Order Tablet: replace fabricated
   'Kitchen open' status with real socket state") and everything back
   through DL-106's checkpoint. `git log --oneline -5` on the deployment
   machine should show these; if it doesn't, deploy them first (see §3).
2. **Services running on `DESKTOP-SOKKOQ7`** (`nssm status <name>` or
   Services.msc): `VerduraPostgreSQL`, `VerduraAPI`, `VerduraConnector`
   all `Running`. `VerduraOrderTablet` `Running` and reachable from the
   venue LAN (DL-106 §3/§7 left this registered-but-not-started — start it
   and confirm before proceeding). IdealposBridge running as its own
   process/service, with `Bridge:ApiKey` set to a real, non-empty value
   and `Idealpos:TableAssignmentStrategy` set to a real, harness-confirmed
   value (`Idealpos:TableAssignmentConfirmed=true`) in its `App.config` —
   DL-106 §7 left both blocked; **do not run §4 with either unset or
   unconfirmed.**
3. **Connector enrolled and polling.** `GET /venues/{venueId}/connector/
   installations` (bearer staff/admin token) shows `status: "active"` and
   `lastSeenAt` advancing within the last poll interval.
4. **`TABLE19_LIVE_TEST_ENABLED`/`TABLE19_LIVE_TEST_VENUE_ID` — read this
   carefully, the flag name is legacy.** The only implemented controlled-
   validation guard in `orders.service.ts`
   (`assertTable19ValidationModeAllows`) is literally hardcoded to
   `resolvedTableNumber === '19'` — it does not generalise to an
   arbitrary chosen table despite this runbook's own "DUNEDIN's own real
   table, chosen at the time" framing above. Two options, pick one and
   record which before proceeding:
   - **(a)** DUNEDIN has a real, disposable Table 19 (confirm via
     `GET /venues/{venueId}/tables` that a `Table` row exists with
     `tableNumber = '19'`, seats > 0, and is actually free/disposable on
     the day) — set `TABLE19_LIVE_TEST_ENABLED=true` and
     `TABLE19_LIVE_TEST_VENUE_ID=<DUNEDIN venue id>` in the real API
     environment, confirm `NODE_ENV` is not `production` there (if it is,
     the guard is unconditionally inert — escalate, do not bypass), and
     use Table 19 for §4.
   - **(b)** Table 19 is unsuitable (occupied, doesn't exist, wrong
     seat count) — the guard must be extended to accept the actually-
     chosen table number before this runbook can safely proceed with a
     different table, or the double-submission protection in step 5
     of §4 must be performed with extra manual care (a human confirms the
     table is free immediately before and does not click twice) with the
     guard left disabled. Record explicitly which was chosen; do not
     silently fall back to (b) without recording it.
5. **Menu/PLU curation done for at least the test items.** At least one
   real, human-verified `MenuItem` has a real, human-verified
   `posProductCode` matching a real DUNEDIN StockItems code — confirm via
   `GET /api/venues/{venueId}/menu` (or a direct read query) before
   choosing test items in §4 step 2. Per DL-106 §6, the bulk 825-item
   import left everything `isAvailable=false` with no curated
   `posProductCode` — do not assume any arbitrary menu item is ready.
6. **Backups exist** for `C:\Users\Posmate\Documents\verduradb` (Postgres)
   and the Bridge's `state\bridge-state.sqlite`, taken immediately before
   this session, per the standing safety constraint.
7. **IdealPOS itself is healthy.** `GET /api/health` on the Bridge (or the
   equivalent through the Connector) shows `OrderProcessingPathAvailable:
   true`. If it does not, stop before step 1 of §4 — do not attempt the
   live test against a known-unavailable IdealPOS.

---

## 3. Deploying this session's fixes (only if §2.1 is not already true)

From a machine with working SSH/RDP access to `DESKTOP-SOKKOQ7`:

```
git -C <path-to-repo-on-DESKTOP-SOKKOQ7> fetch origin
git -C <path-to-repo-on-DESKTOP-SOKKOQ7> log --oneline -1 origin/main
git -C <path-to-repo-on-DESKTOP-SOKKOQ7> merge --ff-only origin/main
```

Then, for the venue-connector change specifically (it is a compiled .NET
binary, not interpreted — a `git pull` alone does not update the running
service):

```
cd apps\venue-connector
dotnet build -c Release
```

Restart `VerduraConnector` (NSSM: `nssm restart VerduraConnector` or
Services.msc) and re-confirm §2.3 (still `active`, `lastSeenAt`
advancing) before proceeding — a restart is itself a real-world instance
of the "Connector process restart" scenario §4 step 10 drills
deliberately, so this is also your first, low-stakes proof that restart
recovery works before the live order depends on it.

No Bridge-side code changed this session (the earlier Caption-fallback/
table-import fixes predate this audit and were already deployed per
DL-106) — no Bridge rebuild is required for §0's fixes specifically, only
for App.config's still-open `ApiKey`/`TableAssignmentStrategy` values
(§2.2).

---

## 4. The certification procedure

Follow in order. **Any unexpected IdealPOS behaviour — wrong table, a
second physical KOT, a payment/EFTPOS trace, or any state not explicitly
predicted by a step below — stops the test immediately.** Do not attempt
to interpret or work around it live; make the venue safe (tell kitchen
staff to disregard an unexpected ticket if one appears) and escalate
before any further action, live or via SQL.

### Step 1 — Safe table selection

Operator physically confirms the chosen table (§2.4) is free and will
remain disposable for the duration of the test. Record who confirmed,
when, and the table number/`posTableCode` used.

### Step 2 — Verified MenuItem/PLU

From §2.5's curated set, record the exact `menuItemId`(s), quantity, and
any modifiers you will order — write down `posProductCode` for each,
copied directly from the `MenuItem` row, never retyped from memory. This
is your fixed target for step 8's line-by-line IdealPOS comparison.

### Step 3 — Tablet submission

From the real, running Order Tablet (§2.2), select the chosen table,
add exactly the items from step 2, and press **Send to Kitchen once**.
Record the `orderIdempotencyKey` visible in the outgoing request (browser
devtools network tab, or the Order Tablet's own request log if present)
before pressing — do not fabricate one by hand.

**Do not press a second time if the UI appears to hang or errors** — see
the unsafe-retry note at the end of this section; that scenario is step 9,
performed deliberately and safely, not by accident here.

### Step 4 — DB persistence (Verdura order)

Query the real API/DB for the order created against the chosen table
around the submission timestamp:

```sql
SELECT id, "tableNumber", status, "posSyncStatus", "idempotencyKey",
       "createdAt"
FROM "Order"
WHERE "venueId" = '<venueId>' AND "tableNumber" = '<table>'
ORDER BY "createdAt" DESC LIMIT 5;
```

Confirm **exactly one** row, `idempotencyKey` matches step 3's recorded
value, and `posSyncStatus = 'not_synced'` or `'queued_for_connector'`
(depending on sweep timing — either is expected immediately after
submission).

### Step 5 — Connector delivery (ConnectorCommand)

```sql
SELECT id, status, "commandType", "claimedByInstallationId",
       "acceptedAt", "reportedAt", "resultType", "failureReason"
FROM "ConnectorCommand"
WHERE "sourceAggregateType" = 'Order' AND "sourceRecordId" = '<orderId from step 4>'
ORDER BY "createdAt" ASC;
```

Confirm **exactly one** row on the first attempt (more than one is
expected and correct only if step 9's replay test runs later, or if a
transient retry genuinely occurred — cross-check `resultType` against
DL-092's classification if so). Inspect `payload` against step 2's
recorded items and `posProductCode`s.

### Step 6 — Bridge acceptance

On the Bridge (via its logs, `logs/*.log`, or `GET /api/orders/
{externalOrderId}` where `externalOrderId` is the order id from step 4):
confirm `order_validated` and `order_submitted` log entries, and that the
response/status is `submitted_to_idealpos` — **not** `failed` or
`rejected`. If it is either of those, stop and treat this as a definite
Bridge-side rejection, not a "try again" situation — read `lastError`
before doing anything else.

### Step 7 — Actual IdealPOS processing → exactly one native KOT

Adapt `evidence-queries.sql`/`operator-runbook.md` from
`/Users/sarwarkhan/Documents/IdealposBridge/docs/table12-preflight/` for
this order's real `externalOrderId`/`WebReference` (from step 5's command
payload / step 6's Bridge status response):

1. **`WebPendingOrder`**: exactly one row, `Processed` flips `0 → 1` with
   a real `DateProcessed`.
2. **`PendingSales`**: exactly one row correlated by `Reference`, `Code`
   matches the chosen table's real IdealPOS identifier (confirm which
   representation applies — do not assume a bare integer).
3. **Visual confirmation on the real IdealPOS terminal**: the table
   activates, items/quantities/modifiers match step 2 exactly.
4. **Physical printer**: exactly **one** KOT prints at the configured
   kitchen printer. If zero print, or more than one prints, stop — this
   is the single most safety-critical check in this entire runbook.

### Step 8 — KOT content verification

Cross-check the printed ticket against `kot-renderer.ts`'s structural
guarantee and IdealPOS's own native template: correct table number,
every item/modifier/prep-note from step 2, and confirm the ticket
contains **no** price, subtotal, GST, total, tender, or payment-status
text (native IdealPOS KOTs should already satisfy this by IdealPOS's own
design — confirm it holds in practice, since this is the first live
exercise of the full chain).

### Step 9 — Retry/timeout/duplicate tests (controlled, API-level only)

**Do not** re-trigger any of this by pressing the live Tablet UI a second
time. Perform each of the following via a direct, controlled API call
(e.g. `curl`/Postman with the exact same `idempotencyKey` from step 3),
re-running step 5/7's row-count queries after each to confirm they are
still exactly 1:

1. **Idempotent replay**: resubmit `POST /api/admin/orders` (or
   `/api/tablet/orders`) with the identical `idempotencyKey`. Expect: the
   API returns the ORIGINAL order (same `id`), no new `Order` row, no new
   `ConnectorCommand` row, no second Bridge submission, no second KOT.
2. **Simulated Bridge-side duplicate replay** (exercises this session's
   §0.1 fix specifically): if feasible without touching production
   IdealPOS state, confirm via Bridge logs/state DB that a repeat
   `POST /api/orders` to the Bridge with the same `externalOrderId`
   (e.g. triggered by forcing one connector retry, if the setup allows a
   safe way to do so) returns the ORIGINAL record's status, and that the
   Connector's `ConnectorCommand.report` reflects that TRUE status — not
   a fabricated "succeeded" — check `ConnectorCommand.resultType`
   directly. If this cannot be safely triggered live without risking a
   second real Bridge call, rely on this session's C# regression tests
   (`IdealposBridgeClientTests.cs`, `Response200Duplicate_
   WithTerminalNegativeStatus_ClassifiedAsRejected_NeverFalseAccepted`)
   as the proof for this specific defect instead of forcing it live.

### Step 10 — Connector interruption/recovery drill

With the live order from steps 3–8 already fully resolved (do this
*after* step 8, on a **separate**, disposable follow-up order — never
interrupt the connector mid-flight on the order you are still verifying):

1. Place one more small, disposable order (repeat steps 1–3 on the same
   or another free table).
2. Immediately (before the connector's poll cycle claims/reports it, i.e.
   within a few seconds of submission) restart `VerduraConnector`
   (`nssm restart VerduraConnector`).
3. Confirm: the connector re-enrolls/resumes polling (`lastSeenAt`
   advancing again within one poll interval), the order's
   `ConnectorCommand` is still delivered exactly once (query per step 5 —
   a stale claim reclaimed after lease expiry is expected and safe; two
   independent `succeeded` deliveries to Bridge for the same
   `externalOrderId` is not), and exactly one KOT prints for this
   follow-up order (step 7.4). Void it through IdealPOS's own UI
   afterward, same as the primary test order.

### Step 11 — IdealPOS interruption/recovery drill

Only if IdealPOS itself can be safely restarted without disrupting live
service at DUNEDIN (confirm with the venue operator — this may need to
happen outside service hours, as its own separate authorised step, not
folded into the same live window as steps 1–10 by default):

1. Place one more small, disposable order.
2. Stop the `IdealposServer`/`IdealposService` process, wait, restart it.
3. Confirm: the order's `POSSyncRecord` correctly reflects the outage
   (does not silently show `submitted_awaiting_confirmation` while
   IdealPOS was down), the Bridge's own `AvailabilityChecker`/`/api/
   health` correctly reported `OrderProcessingPathAvailable: false`
   during the outage, and once IdealPOS is back, either the order's
   existing in-flight attempt resolves correctly (native KOT eventually
   prints, `WebPendingOrder.Processed` flips) or, if it had already
   exhausted its dispatch/retry budget, the order surfaces as `failed`/
   `uncertain` with a clear, actionable `errorMessage` on the Tablet's
   own status panel (never silent). Void the resulting real order through
   IdealPOS's UI regardless of outcome.

### Step 12 — Final DB integrity check

Across every order created during this entire session (primary + steps
9–11's disposable follow-ups):

```sql
-- No order should have more than one non-cancelled/non-expired
-- ConnectorCommand that reached `succeeded` for idealpos.submit_order.v1.
SELECT cc."sourceRecordId" AS "orderId", count(*) AS succeeded_count
FROM "ConnectorCommand" cc
WHERE cc."commandType" = 'idealpos.submit_order.v1'
  AND cc.status = 'succeeded'
  AND cc."sourceRecordId" IN (<all orderIds from this session>)
GROUP BY cc."sourceRecordId"
HAVING count(*) > 1;
-- Expect: zero rows.

-- No POSSyncRecord should be stuck genuinely indeterminate with no
-- explanation.
SELECT "orderId", status, "errorMessage", "nextRetryAt", "retryExhaustedAt"
FROM "POSSyncRecord"
WHERE "orderId" IN (<all orderIds from this session>)
  AND status NOT IN ('synced', 'submitted_awaiting_confirmation', 'failed', 'not_applicable', 'unsupported');
-- Expect: zero rows, OR rows only for orders still genuinely in-flight
-- at query time (re-run after the sweep interval elapses to confirm they
-- resolve).
```

Confirm every test order was voided through IdealPOS's own UI (never a
direct DB write — same discipline `evidence-queries.sql` follows
throughout) and the chosen table(s) are free again.

---

## Unsafe-retry note

If `Send to Kitchen` appears to hang or errors after pressing it once, do
**not** press it again live. The Order Tablet's own `orderIdempotencyKey`
and the backend's transactional creation make a same-request retry safe,
but a second, separate live button-press is exactly the "uncertain
IdealPOS submission or KOT print" scenario this runbook exists to avoid.
Treat an apparently-hung submission as uncertain, check status via the
Order Tablet's own status panel or a direct API/DB query (§4 step 4), and
only then decide whether a genuinely-safe replay (step 9's controlled
method, not a live re-click) is warranted.

---

## Abort conditions (stop immediately, at any step)

- More than one row anywhere exactly one was expected (`Order`,
  `ConnectorCommand`, `WebPendingOrder`, `PendingSales`).
- A second physical KOT print, for any reason.
- Any payment/EFTPOS trace anywhere in the chain.
- The wrong table activated in IdealPOS.
- Any status the Tablet/API surfaces as success that this runbook's own
  evidence queries do not independently confirm.
- Any Bridge/Connector/IdealPOS log line, error, or behaviour not
  explicitly predicted by a step above.

On abort: make the venue safe first (inform kitchen staff to disregard an
unexpected ticket if one exists), capture full evidence (logs, query
results, screenshots) before any cleanup, then escalate. Do not attempt
further live steps until the cause is understood.

## Rollback/recovery

- Every test order is voided through IdealPOS's own native UI only —
  never a direct database write, on either the Verdura or IdealPOS side.
- If a `ConnectorCommand`/`POSSyncRecord` is left in a non-terminal state
  after this session (e.g. a deliberately-interrupted step 10/11 drill
  order), use the existing operator tooling
  (`POST /venues/:venueId/connector/commands/:commandId/cancel`,
  documented in `connector-command-admin.controller.ts`) rather than a
  direct DB mutation.
- Restore Postgres/`bridge-state.sqlite` from the §2.6 backups only if a
  genuine corruption/incident occurs — not as a routine step.
