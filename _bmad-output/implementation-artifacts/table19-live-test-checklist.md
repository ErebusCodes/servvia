# Table 19 controlled live-validation checklist

**Status: prepared, NOT executed.** This checklist exists so that a
separately-approved session can run the one controlled Table 19 order and
KOT print with a clear, pre-agreed procedure — it does not authorise that
session by itself. See "Required approval" at the end.

**What this validates:** that pressing `Send to Kitchen` once, from a real
Order Tablet, against a real venue, produces exactly one real Verdura
order, one real IdealPOS connector command that a real on-premise Venue
Connector installation could execute, one real KDS appearance, and one
real KOT print — with no payment action anywhere in the chain, and no
duplicate on replay. It requires real Windows/IdealPOS/printer access this
session did not have (SSH to the target Windows machine is currently
**read-only** — see the repository's standing constraint) and is
therefore prepared but not run here.

## What already exists (verified this session, does not need re-proving)

- The Table 19 controlled-validation guard is fully implemented server-side
  (`apps/api/src/orders/orders.service.ts`:
  `isTable19ValidationModeActiveForVenue`, `assertTable19ValidationModeAllows`,
  `resetTable19ValidationRun`) and covered by a real-Postgres integration
  suite (`apps/api/test/table19-validation.integration-spec.ts`, 5/5
  passing): inert unless both `TABLE19_LIVE_TEST_ENABLED=true` and
  `TABLE19_LIVE_TEST_VENUE_ID=<venue-id>` are set; hard-disabled whenever
  `NODE_ENV=production` regardless of the flag; checked only against the
  server-*resolved* table (never the raw client-supplied value, so request
  tampering cannot bypass it); enforces exactly one open
  `Table19ValidationRun` per venue until an authorised admin/manager resets
  it via `POST /api/admin/table19-validation/reset`; every reset is
  audit-logged.
- The IdealPOS (`idealpos.submit_order.v1`) and KOT (`printer.print_kot.v1`)
  connector-command dispatch pipeline is implemented and tested end to end
  against real Postgres (`apps/api/src/pos-sync/idealpos-order-reconciliation.service.ts`,
  `apps/api/src/printer/printer-dispatcher.service.ts`,
  `apps/api/test/idealpos-order-reconciliation.integration-spec.ts`,
  `apps/api/test/printer-dispatcher.integration-spec.ts`) — this checklist's
  job is to observe that pipeline reach a *real* on-premise connector and
  IdealPOS installation, not to re-verify the cloud-side logic.
- `/Users/sarwarkhan/Documents/IdealposBridge/docs/table12-preflight/` is a
  proven, real evidence-capture package for exactly this kind of controlled
  order (built for an earlier Table 12 experiment). Its `evidence-queries.sql`
  and `request-fixture.md` are the right template for steps 6–10 below —
  **adapt them for Table 19, do not write new SQL from scratch.** Its
  `operator-runbook.md` covers Windows-side operator mechanics this checklist
  does not repeat.
- The KDS delivery leg now has a durable outbox row, closing the one gap
  this checklist previously had no query-level evidence for
  (`apps/api/prisma/schema.prisma`'s `KdsDeliveryRecord`/`KdsDeliveryStatus`,
  `apps/api/src/orders/kds-dispatcher.service.ts`, created inside the same
  order-creation transaction as the `POSSyncRecord`/`PrinterJob` rows —
  `apps/api/src/orders/orders.service.ts`'s `persistOrder` — and tested
  against real Postgres, `apps/api/test/kds-dispatcher.integration-spec.ts`,
  6/6 passing). Its `pushed` state is real evidence the server attempted a
  WebSocket delivery to the venue's KDS room — it is **not**, and by design
  cannot be, evidence a Kitchen Display screen actually rendered the ticket
  (no ack channel exists from the Kitchen Display back to the server). Step
  11 below now cites this row *and* keeps the visual confirmation, rather
  than treating the query as a substitute for it.

## Pre-conditions (before this checklist may be run)

1. **Separate, explicit written approval** for one real Table 19 order and
   one real physical KOT print (see "Required approval" below) — this
   checklist's existence does not constitute that approval.
2. Windows access upgraded from read-only to a mode that permits the actual
   order/print (still least-privilege — do not use broader access than the
   single test requires).
3. `TABLE19_LIVE_TEST_ENABLED=true` and `TABLE19_LIVE_TEST_VENUE_ID` set to
   the real target venue's id, in the real API environment that will serve
   the request — confirm `NODE_ENV` is **not** `production` there (if it
   is, the guard is unconditionally inert and the test cannot proceed;
   escalate rather than working around it).
4. A real on-premise Venue Connector installation is running, enrolled, and
   polling the target venue (confirm via `GET` on the connector-admin
   surface that its last-seen heartbeat is recent).
5. Table 19 in the real venue is confirmed **free and disposable** — no
   real guest is seated there, and any order it produces will be voided,
   not served.

## The checklist (per the approved task's 16 steps)

1. **Human confirms Table 19 is free and disposable.** Operator physically
   checks the floor; record who confirmed and when.
2. **Human approves one real order and one KOT print.** Record the
   approver's name/role and the approval timestamp here or in the linked
   decision record.
3. **Record exact test items and modifiers** before submitting — write the
   real `menuItemId`(s), quantity, and any modifier selections you are
   about to use, so step 7's IdealPOS-side line comparison has a fixed
   target (mirrors the IdealposBridge fixture's own item-record-first
   discipline).
4. **Generate one correlation/idempotency key.** Use the Order Tablet UI's
   own generated `orderIdempotencyKey` (visible in the request body sent
   to `POST /api/tablet/orders` or `/api/admin/orders`) — do not fabricate
   a separate key by hand; record its value here.
5. **Press `Send to Kitchen` once**, from the real Order Tablet, against
   Table 19, at the approved venue. Do not click a second time even if the
   UI appears to hang — see "unsafe retry" note below.
6. **Verify one Verdura order.** Query the real API/DB for the order
   created against Table 19 at the approved venue around the submission
   timestamp — confirm exactly one row, `source` correctly attributed
   (staff or the synthetic device actor per DL-081), and `notes` carries
   the `TABLE19-VALIDATION-` prefix (set automatically by
   `assertTable19ValidationModeAllows`'s caller when the guard is active).
7. **Verify one connector command.** Query `ConnectorCommand` for
   `commandType = 'idealpos.submit_order.v1'` correlated to the order from
   step 6 — confirm exactly one row and inspect its payload against the
   items recorded in step 3.
8. **Verify `WebPendingOrder` is created and consumed.** Adapt
   `evidence-queries.sql` §1–2 from the IdealposBridge Table 12 preflight
   package (substitute the real `WebReference`/`externalOrderId` from step
   7's connector command payload) — confirm exactly one row, and that
   `Processed` flips to `1` with a real `DateProcessed` timestamp set by
   native IdealPOS itself.
9. **Verify `PendingSales.Code = 19`.** Adapt `evidence-queries.sql` §3 and
   §5 — confirm exactly one `PendingSales` row correlated by `Reference`,
   and that its `Code` matches Table 19's real `TableMapSetups.Code`/
   `Caption` (confirm which representation applies for this venue's
   configuration — do not assume `19` as a bare integer without checking,
   per the preflight package's own `table-assignment-review.md` caveat).
10. **Verify IdealPOS UI activates Table 19 and shows the correct items.**
    Visual confirmation on the real IdealPOS terminal/POS UI, cross-checked
    against step 3's recorded items — this is the one piece of evidence
    none of the SQL queries substitute for.
11. **Verify the KDS delivery intent was durably recorded and pushed.**
    Query the real `KdsDeliveryRecord` row for this order's id — confirm
    exactly one row, `status = 'pushed'`, `pushedAt` set, and
    `pushAttemptCount >= 1`. This is real, durable evidence the server
    attempted delivery to the venue's KDS room, mirroring steps 8–9's
    `WebPendingOrder`/`PendingSales` evidence queries for the IdealPOS leg —
    it is **not** evidence a Kitchen Display screen actually rendered the
    ticket (no ack channel exists for that), so it does not replace 11a.
11a. **Verify KDS displays the order once.** Confirm on the real Kitchen
    Display screen — one ticket, correct items/modifiers/table, no
    duplicate. This remains the one piece of evidence no query substitutes
    for, same as step 10 for the native IdealPOS UI.
12. **Verify the configured kitchen printer prints exactly one KOT.**
    Physical confirmation at the printer. Cross-check the printed content
    against `kot-renderer.ts`'s guarantees: table number, items, modifiers,
    prep notes — and confirm it contains **no** price, subtotal, GST,
    total, tender, or payment-status text (structurally guaranteed by
    `KotRenderInput` carrying no such fields, but confirm the physical
    output too, since this is the first real-hardware exercise of that
    guarantee).
13. **Replay the same key and prove no duplicate order or KOT.** Resubmit
    with the identical `orderIdempotencyKey` from step 4 (e.g. by retrying
    the same request the way a dropped-response client retry would) —
    confirm the API returns the original order (not a new one), and re-run
    step 8's `WebPendingOrder`/`PendingSales` row-count queries
    (`evidence-queries.sql` §6) to confirm both counts are still exactly 1.
    **Do not press `Send to Kitchen` a second time in the live UI to test
    this** — the backend replay guarantee is what this step verifies;
    forcing a second live UI submission risks a genuinely new order if the
    guard's assumptions are wrong, which is exactly the failure this step
    exists to catch safely via a controlled API-level replay instead.
14. **Verify no payment or EFTPOS action occurs.** Confirm nothing in the
    chain above touched IdealPOS's payment/EFTPOS workflow — no tender was
    selected, no EFTPOS transaction was initiated, the order remains in
    IdealPOS's normal pre-payment state exactly as it would for any other
    dine-in order. This is the direct live-evidence counterpart to DL-087.
15. **Clean up through native IdealPOS UI only.** Void/cancel the test
    order and its `PendingSales` row using IdealPOS's own UI — never a
    direct database write (the read-only discipline `evidence-queries.sql`
    itself follows). Confirm Table 19 is free again afterward.
16. **Stop immediately on the wrong table, duplicate, payment action, or
    unexpected print.** If any of steps 6–14 shows the wrong table, more
    than one row anywhere a single row was expected, any payment/EFTPOS
    trace, or a second physical KOT print, stop, do not attempt cleanup
    beyond making the venue safe (e.g. informing kitchen staff to disregard
    an unexpected ticket), and escalate before any further live action.

## Unsafe-retry note

If `Send to Kitchen` appears to hang or the UI shows an error after
pressing it once, do **not** press it again live. The Order Tablet's own
`orderIdempotencyKey` and the backend's transactional creation make a
same-request retry safe, but a *second, separate* live button-press is
exactly the "uncertain IdealPOS submission or KOT print" scenario the
approved task instructions prohibit retrying live. Treat an apparently-hung
submission as "uncertain," check the order status via the Order Tablet's
own Order Status screen or a direct API query, and only then decide
whether a genuinely-safe replay (step 13's method, not a live re-click) is
warranted.

## Required approval

Executing this checklist requires a **separate, explicit** approval beyond
what authorised this implementation session — specifically: written
sign-off from an authorised operator/owner that (a) Table 19 may be used
for one real, disposable order, (b) Windows access may be upgraded from
read-only for the duration of this one test, and (c) one real physical KOT
print is authorised. This document does not grant that approval and no
step above may be executed until it exists.

---

**Addendum, 2026-08-21:** a read-only SSH discovery attempt via the
approved route was made this date. The trusted host key matched (no
MITM/host-key concern), but public-key authentication to the approved
account failed — no authenticated Windows command executed, and this
checklist's own prerequisite ("real Windows/IdealPOS/printer access")
remains unmet, now for a precise, narrower reason (a suspected, unverified
`authorized_keys`/ACL issue on the host) rather than "no route." This
checklist remains **prepared, NOT executed**; nothing above changes.

**Correction, 2026-08-21 (later same day):** the `authorized_keys`/ACL
suspicion above is **superseded by direct evidence and was incorrect**.
The real cause: the client's ED25519 private key was passphrase-protected
and was not loaded into the macOS SSH agent; the automated attempts used
`BatchMode=yes`, which prohibits the interactive passphrase prompt needed
to unlock it, so no signature could ever be produced to complete
authentication — the server had already correctly recognized the public
key throughout. Once the matching key was loaded into the agent,
public-key authentication succeeded immediately (host key unchanged,
strict verification passed) as `desktop-sokkoq7\posmate` on host
`DESKTOP-SOKKOQ7`. This checklist's own prerequisite is **still unmet**:
only basic host identity (hostname, OS, PowerShell version, timezone) was
observed — no IdealPOS, Bridge, connector, EFTPOS, or printer discovery
occurred, and this checklist remains **prepared, NOT executed**. The
observed host OS is Microsoft Windows 10 Home (`10.0.19045`, 64-bit), not
Windows 11 — recorded here as the directly-observed current fact for any
reader relying on this checklist's own environment assumptions.

**Addendum, 2026-08-21 (full read-only discovery session; full detail in
`9-2-idealpos-uibridge-tracer.md`'s session 6 entry):** IdealPOS is
genuinely installed and running live on the target host (3 services, real
processes including the licensing service and a real physical printer,
Brother MFC-L2713DW). The Verdura IdealposBridge is **not found** deployed
anywhere on the host — it has never been built or run there. A Venue
Connector checkout exists on the Desktop but is ~5 days stale (predates
the 2026-08-17 `apps/` restructure and every Story 15-5/15-6 connector
change) and has never been built (no `.NET` 8 SDK is even installed on
the host today). This checklist's own prerequisites (a real, running,
current Bridge + Venue Connector) remain **entirely unmet** — this
checklist stays **prepared, NOT executed**, and is now further from
"ready" than "blocked purely on SSH access" implied: bringing the
checkout current, installing the .NET 8 SDK, and building/self-testing
the connector (each separately authorised) must all happen before this
checklist's own Gate A-equivalent prerequisites are satisfied, let alone
this controlled test itself.

**Owner-direction addendum, 2026-08-21 (later same day):** the Desktop
checkout named above (`C:\Users\Posmate\Desktop\verdura_MVP`) is now an
**owner-designated protected legacy runtime** — it runs the currently
working Window Display and its supporting local stack, and must remain
untouched (no read, no write, no git operation, no build, no service
interaction of any kind) until the new Order Tablet and its replacement
deployment are ready. The read-only discovery that observed it on
2026-08-21 (`git log -1`/`git status`/`git remote -v`, no fetch/pull/write)
remains valid, historical evidence and is not retracted — but **"bringing
the checkout current" above is corrected: it must never mean this
directory.** Any future Bridge/Venue Connector build or self-test work
must use a separate, isolated Windows working directory, created only
after separate explicit human approval — see the October critical-path
matrix's own corrected Gate A plan for the full requirement.

---

## Revision 2026-08-26 — updated state, expanded procedure (still prepared, NOT executed)

This revision does not retract anything above (the 2026-08-21 addendums
remain valid history of what was true then). It (a) records what has
changed since, (b) adds interruption/recovery and final-integrity steps the
original 16-step procedure did not cover, and (c) states precisely what
still blocks execution today. **This checklist is still prepared, not
executed — no step below has been run against real IdealPOS.**

### What has changed since 2026-08-21

- A separate, isolated working directory now exists on `DESKTOP-SOKKOQ7`
  for the new stack (distinct from the protected legacy Desktop checkout,
  per that addendum's own requirement) — `VerduraPostgreSQL`, `VerduraAPI`,
  and `VerduraConnector` are installed there as Windows services and are
  confirmed running: `VerduraAPI` is stable (root-caused, not
  worked around — see `dl-106-dunedin-session-pause-checkpoint.md` §4),
  and `VerduraConnector` is server-confirmed **active** (enrolled,
  authenticated, `lastSeenAt` advancing on every poll, restart-recovery
  already proven once). `VerduraOrderTablet` is registered but its Windows
  service has not yet been started.
- 18 of the 19 real DUNEDIN dine-in tables (Table 10 excluded — 0 seats in
  the live IdealPOS data) now have real `Table.posTableCode` values in
  Verdura's own database, imported verbatim from IdealPOS's own
  `IPSTransaction..TableMapSetups.Caption` column via
  `apps/api/prisma/scripts/import-idealpos-tables.ts` (commit `c76ba9e`) —
  **never hand-typed**. That commit's own evidence confirms Captions "1"
  through "19" are populated correctly in that table (the *other*,
  wrong-database copy in `POSServer..TableMapSetups` is blank — see that
  script's own doc comment for the two-tables trap). Table 19's
  `posTableCode` is therefore the real, imported, verbatim IdealPOS
  Caption — **re-run `SELECT tableNumber, posTableCode FROM "Table" WHERE
  venueId = '<venue-id>' AND tableNumber = '19'` immediately before the
  live session to confirm the value directly, rather than trusting this
  paragraph** (data can drift between this being written and the session
  running).
- IdealposBridge (`VerduraIdealposBridge`) now exists as a real, buildable
  checkout on the Mac (`/Users/sarwarkhan/Documents/IdealposBridge`), but
  **has still never been deployed, built, or run on `DESKTOP-SOKKOQ7`**.
  Its `App.config` there has a blank `Bridge:ApiKey` and blank
  `Idealpos:TableAssignmentStrategy` — both still need to be set from a
  real, generated API key (matching whatever the Venue Connector is
  configured to send) before the Bridge can start at all.
- `windows-deploy/static-proxy-server.mjs` (the process that serves the
  built Order Tablet frontend and proxies `/api`+WebSocket traffic to
  `VerduraAPI`) has had two real defects found and fixed since this
  checklist was last updated: WebSocket upgrades were never proxied at all
  (commit `cc3f0c9` — silently broke every live-status-update path this
  checklist's steps 6–13 depend on watching), and POS-sync status
  transitions were not broadcast over the existing order-update socket
  (commit `06199e7`). Both are fixed and unit/integration-tested on the
  Mac; **neither fix has been observed running against the real proxy
  process on `DESKTOP-SOKKOQ7` yet** — step 5b below adds that
  observation explicitly, since it was previously implicit and unverified.

### Still blocking execution today (as of 2026-08-26)

1. IdealposBridge is not built or deployed on `DESKTOP-SOKKOQ7` at all —
   Gate A-equivalent prerequisite, unmet.
2. `IdealposBridge\App.config`'s `Bridge:ApiKey` is blank — the Bridge
   cannot authenticate the Connector's requests until a real key is
   generated and set on both sides.
3. `Idealpos:TableAssignmentStrategy` is undetermined — blocked on the
   Bridge's own `OrderValidator`/`GetTables()` Caption-vs-`ItemIndex`
   question recorded in `dl-106-dunedin-session-pause-checkpoint.md` §5.
   Now that real Captions are confirmed populated ("1".."19") in the
   database the Bridge's `IpsConnection` actually targets, the
   Caption-matching path this Bridge already implements should work
   without a code change — **but this has never been observed against
   real IdealPOS and must be confirmed, not assumed, in step 6 below.**
4. `VerduraOrderTablet`'s Windows service is registered but not started.
5. This session has no live SSH/agent access to `DESKTOP-SOKKOQ7` (no key
   loaded in the local agent, no resolvable hostname/IP recorded) — a
   human must either load the key and share a reachable address, or
   perform the remaining Windows-side setup (items 1–4 above) directly at
   the machine.

None of items 1–5 can be resolved by more code changes in this repository
— they are real-world setup/access actions on the target Windows host.

### Explicit PLU/MenuItem verification (expands step 3)

Before step 4, for **every** menu item used in the test:

- Query Verdura for the item's `posProductCode`:
  `SELECT id, title, "posProductCode" FROM "MenuItem" WHERE id = '<menuItemId>'`.
- Confirm that exact `posProductCode` was set by a human via the
  IdealPOS-catalog importer or manual admin edit — **never a guessed or
  inferred value** (grep the admin audit log for who set it and when if
  unsure). If it is null or looks fabricated, stop — do not proceed with
  an unverified PLU; `IdealposMappingError`'s own deterministic-failure
  path exists specifically to keep an order with no verified PLU from
  ever reaching Bridge, and this step is the human-side mirror of that
  guarantee.
- Record the exact `posProductCode` value(s) here alongside the
  `menuItemId`s step 3 already asks for.

### Step 5b — confirm live-status delivery works before relying on it

Immediately after step 5 (and before steps 6–13, which all depend on
watching truthful, real-time status), confirm on the real Order Tablet UI:
the header's connection indicator shows "Live" (not "Reconnecting"), and
the order's PosSyncStatus panel visibly advances through its real states
(queued → dispatched → submitted-awaiting-confirmation, or a truthful
failure) rather than staying frozen on its initial state. If it does not
advance within a few seconds of real backend activity, stop and diagnose
the proxy/WebSocket path (`static-proxy-server.mjs`, commits `cc3f0c9`/
`06199e7` above) before continuing — do not proceed on the assumption that
"no visible update" means "nothing happened."

### New steps 17–20 — interruption/recovery and final integrity (run only after 1–16 succeed cleanly once)

These are additional, separate live tests using the SAME already-validated
Table 19 order flow — each one is its own isolated attempt with its own
fresh `orderIdempotencyKey`, run only after steps 1–16 have already proven
the clean-path end to end at least once. Abort per step 16's rule if any
of these produces more than one native KOT, the wrong table, or a payment
trace.

17. **Connector interruption/recovery — lease reclaim, not duplicate
    delivery.** Start a fresh Table 19 test order. The instant the Order
    Tablet shows the order queued for the connector (POSSyncRecord
    `queued_for_connector`, before it reaches `submitted_awaiting_confirmation`),
    stop the `VerduraConnector` Windows service. Confirm: the
    `ConnectorCommand` row's lease expires and (per
    `apps/api/src/connector/connector-command.service.ts`'s `poll()`)
    becomes reclaimable, never silently abandoned. Restart the service.
    Confirm exactly one `idealpos.submit_order.v1` command is ultimately
    delivered to IdealPOS (query `ConnectorCommand` for this order's
    `sourceRecordId` — if the stop happened before Bridge ever received
    the first attempt, expect exactly one row overall; if it happened
    after Bridge already received it but before the report landed, expect
    the sweep's `unknown` → recovery path from
    `IdealposOrderDispatcherService.processUnknownCandidate`, which relies
    on IdealposBridge's own `externalOrderId`-keyed dedup to guarantee the
    *native* order/KOT is still singular even if two `ConnectorCommand`
    rows exist). Verify exactly one native KOT prints, exactly once.
18. **Bridge/IdealPOS unavailable — clean failure, no false success.**
    Start a fresh Table 19 test order. Before the Connector's HTTP call to
    Bridge can succeed, either stop the `IdealposBridge` process or block
    its port briefly (least invasive: stop the process — do not touch
    IdealPOS's own services). Confirm the Connector reports
    `bridge_unreachable_or_failed` (never a false `bridge_accepted`), the
    `POSSyncRecord` schedules a retry (`not_synced` with a future
    `nextRetryAt`, per `IdealposOrderDispatcherService`'s DL-092 backoff),
    and the Order Tablet UI visibly shows a retrying/failed state — never
    a silent "sent" appearance. Restart Bridge. Confirm the next automatic
    retry succeeds, exactly one `ConnectorCommand` ends `succeeded`, and
    exactly one native KOT prints.
19. **Timeout-ambiguous case, if it can be safely provoked.** If Bridge can
    be made to accept the HTTP request but delay its response past the
    Connector's own client timeout (e.g. a deliberately slow test
    endpoint, not real IdealPOS latency), confirm the Connector reports
    the command as unresolved (never a fabricated terminal outcome — see
    `BridgeSubmissionAmbiguousException`'s own contract), the record
    reaches `unknown` after the protocol's report window, and the later
    automatic recovery (step 17's mechanism) still produces exactly one
    native KOT. Skip this step if it cannot be provoked safely without
    touching real IdealPOS internals — do not simulate it against
    production IdealPOS itself.
20. **Final consolidated DB integrity check.** For every order created
    during this entire session (steps 1–19), confirm a fully consistent
    terminal state across every table before sign-off:
    - Exactly one `Order` row per real submission attempt (never more than
      the number of times `Send to Kitchen` was genuinely pressed or a
      controlled API-level replay was performed).
    - Every `POSSyncRecord` for those orders is in a terminal state
      (`submitted_awaiting_confirmation`, `synced`, or `failed` with a
      truthful `errorMessage`) — none left indefinitely `not_synced` or
      `queued_for_connector` with no `nextRetryAt` and no recent
      `lastAttemptAt`.
    - Every `ConnectorCommand` correlated to those orders
      (`sourceAggregateType = 'Order'`) is terminal (`succeeded`,
      `failed`, `expired`, or `cancelled`) — none left `unknown` or
      `accepted` past its own recovery window.
    - `KdsDeliveryRecord` and (if applicable) `PrinterJob` rows for those
      orders are consistent with what was physically observed (no row
      claiming `pushed`/`delivered` for a ticket that was never actually
      seen on a screen or printer, and vice versa).
    - Void every test order through native IdealPOS UI (step 15) and
      confirm Table 19 shows free in both Verdura and IdealPOS afterward.
    Any row that does not fit these terminal, consistent shapes is itself
    a finding — do not sign off with an unexplained non-terminal row.

### Rollback/recovery instructions (explicit)

- **Wrong table or wrong items on the native IdealPOS ticket:** stop
  immediately (step 16). Do not attempt to correct it via a second live
  submission. Void through IdealPOS UI only (step 15's method), then
  escalate — this indicates a mapping defect (Caption/`ItemIndex` or PLU),
  not a one-off fluke, and must be root-caused before any further live
  attempt.
- **Apparent duplicate KOT:** stop immediately. Do not void anything until
  the duplicate is documented (photograph both tickets if possible) —
  this is exactly the failure class this entire audit exists to prevent,
  and the physical evidence is needed to root-cause it. Escalate before
  any further live action of any kind.
- **Any payment/EFTPOS trace:** stop immediately, escalate to whoever owns
  the EFTPOS terminal/merchant account before doing anything else — this
  is a financial-system concern, not just a software defect.
- **Order stuck non-terminal with no visible recovery path on the Order
  Tablet:** do not resubmit live. Use step 20's DB queries to determine
  the real state, and — if genuinely stuck past every automatic retry/
  recovery window this audit has verified — treat it as a new defect to
  fix in code, not a one-off to work around by hand in this session.
