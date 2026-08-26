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
KOT). Five real defects were found and fixed, tested, and are on `main`:

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
3. **A dropped submission response could produce a genuine duplicate
   takeaway order/KOT after a reload** (`apps/admin-console/src/pages/
   order-tablet/OrderTabletPage.tsx`). Dine-in already recovers safely from
   a lost response by re-selecting the table (which hydrates from the real
   backend order) — takeaway has no such resource. A network blip/tab
   reload followed by staff re-entering and resubmitting the same cart
   would mint a fresh `orderIdempotencyKey`, creating a genuinely distinct
   `Order` → `POSSyncRecord` → `ConnectorCommand` with a different
   `externalOrderId`, which Bridge's own `externalOrderId`-keyed dedupe
   cannot catch. **Fixed**: a `sessionStorage`-backed pending-submission
   marker, written before the POST and cleared only on a definite HTTP
   response; while set it survives a reload and blocks further submission
   from that device until a human clears it after checking Kitchen
   Display/recent orders.
4. **Cancelling an Order never stopped its POS dispatch**
   (`apps/api/src/orders/orders.service.ts`). `updateStatus` only ever
   wrote `Order.status` — the `POSSyncRecord`/`ConnectorCommand` created
   alongside the order kept dispatching to IdealposBridge on its own
   schedule regardless, so a "cancelled" order could still reach IdealPOS
   and print a real native KOT. **Fixed**: `attemptCancelPosDispatch` now
   runs before the `Order.status` write — cancels a `not_synced`
   `POSSyncRecord` outright, cancels the underlying `ConnectorCommand` when
   still `queued_for_connector` and not yet accepted, and — once dispatch
   has progressed past the point this side can safely halt it — never
   silently claims success: logs loudly and writes a truthful
   `errorMessage` onto the same `POSSyncRecord` staff already watch.
5. **The production static+proxy server's WebSocket path had no connect
   timeout and never cleaned up the upstream socket on client disconnect**
   (`windows-deploy/static-proxy-server.mjs`) — a silently-dropped SYN
   could hang a handshake indefinitely with nothing logged, and a
   disconnected client's upstream socket leaked. Both fixed, with a real-
   handshake regression test now wired into CI (previously zero automated
   execution existed for this file at all, alongside the same gap in
   `scripts/dev-lock.test.mjs`).

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

## 1b. Corrected Windows deployment topology (2026-08-26)

Direct inspection this session found **three** distinct Verdura-related
directories on `DESKTOP-SOKKOQ7` — do not assume the one named in older
documents is the one actually running anything:

- `C:\Users\Posmate\Desktop\verdura_MVP` — a real but **very stale**
  (`9033692`) git clone, with a stray untracked nested `verdura_MVP\`
  directory. **Confirmed not used by any running service.** Leave it alone.
- `C:\Users\Posmate\Documents\VerduraServer` — **the actual deployment
  source.** Confirmed via each service's own NSSM config
  (`AppDirectory`/`AppParameters`) that this backs `VerduraAPI`,
  `VerduraOrderTablet` (serves `apps\admin-console\dist` on 5176), and
  `VerduraAdminConsole` (serves `apps\admin-console\dist-admin` on 5177 —
  a manually-built, non-standard output directory: `cd apps\admin-console
  && npx vite build --outDir dist-admin`, no `VITE_APP_MODE`, same
  `VITE_VENUE_ID` as the tablet build). This is the git repo to update.
- `C:\Users\Posmate\Documents\VerduraOrderTabletConnector` — the
  Connector's deployment. **Not a git repository** — a raw publish-output
  copy. Updating it requires rebuilding
  `apps\venue-connector\src\VerduraIdealposTracer.Cli\
  VerduraIdealposTracer.Cli.csproj` (`dotnet publish -c Release -r win-x64
  --self-contained false`, run from `VerduraServer` once it's current) and
  copying the new `bin\Release\net8.0-windows\win-x64\publish\` output
  into this directory's own matching path — a plain `git pull` here does
  nothing, there is no `.git` to pull.

`VerduraIdealposBridgeSvc` runs from `C:\Users\Posmate\Documents\
IdealposBridge`, matching the canonical Bridge repo's own deployment
expectation — no discrepancy there.

## 1c. §1b correction + Window Display `/menu` outage root cause (2026-08-26, later same day)

**§1b's claim that `Desktop\verdura_MVP` is "confirmed not used by any
running service, leave it alone" is now out of date — correct as of the
original 1b investigation, false by the time of this entry.** Re-verified
directly via SSH (`DESKTOP-SOKKOQ7`, no longer blocked — see below): both
`Documents\VerduraServer` and `Desktop\verdura_MVP` were at `main`
`0a7c286`, clean, in sync with `origin/main`. The Window Display dev server
(port 5174) was actually running from `Desktop\verdura_MVP` (confirmed via
its listening process's full command line and parent chain: `npm run dev
--workspace=apps/window-display` (PID 12008) → `cmd.exe` (51880) → `node
.../Desktop/verdura_MVP/node_modules/vite/bin/vite.js` (44376)) — almost
certainly a leftover terminal from before `Documents\VerduraServer` became
canonical, never migrated.

**Symptom:** `http://localhost:5174/menu` showed "The menu is temporarily
unavailable. Please try again shortly." on Windows only (Mac unaffected).

**Root cause (proven via `curl` against both the direct API and the Vite
proxy, and via `KioskController.getVenueMenu`'s source):**
`apps/window-display/.env`'s `VITE_VENUE_ID` — in both Windows copies — was
still the **local-dev seed default** (`10000000-0000-4000-8000-000000000001`),
which does not exist in Windows' production `verdura_production` database.
`GET /api/kiosk/venues/10000000-0000-4000-8000-000000000001/menu` →
`404 {"message":"Venue not found"}` (via `requireActiveVenue`'s
`prisma.venue.findFirst`) → `menuClient.js`'s `getAuthoritativeMenu()`
throws → `Menu.jsx`'s catch block renders the generic unavailable message.
Not Prisma, not Postgres connectivity, not Vite proxy/CORS, not stale
build, not menu-availability filtering — the direct-API and proxied
requests returned byte-identical 404s, ruling out a proxy-layer cause.

The real DUNEDIN venue is **`Verdura Dunedin`**, id
`04841b10-1474-4f8c-962f-1ccea7eb3b81` (org `63cc2d26-7dbd-46b5-b55d-
c414a1fe3cd4`). Confirmed via read-only Prisma query: 825 `MenuItem` rows,
all under 1 `Category` ("Imported from IdealPOS (pending review)" —
`isActive: true`), **0 currently `isAvailable: true`** — this is the
category's own stated pending-review curation state, not a bug, and was
deliberately left untouched.

**Fix applied (runtime/environment only, no application source changed):**
1. Corrected `VITE_VENUE_ID` to `04841b10-1474-4f8c-962f-1ccea7eb3b81` in
   `apps/window-display/.env` in **both** Windows copies (`Documents\
   VerduraServer`, which had no `.env` at all — created one — and
   `Desktop\verdura_MVP`, whose wrong value was corrected in place, so it
   can't silently reintroduce this if reused by accident again).
2. Killed the Window Display dev server that was running from
   `Desktop\verdura_MVP` (PIDs 12008/51880/44376) and restarted it from the
   canonical `Documents\VerduraServer` (`npm run dev
   --workspace=apps/window-display -- --host 0.0.0.0 --port 5174`, detached
   via `Win32_Process.Create` so it survives the SSH session, not tied to
   any of the four NSSM-managed production services in §1b).
3. Verified: `GET /api/kiosk/venues/04841b10.../menu` → `200` with
   `categories: 1, menuItems: 825`, identical via direct API (`:3000`) and
   the Vite proxy (`:5174`); the old seed venue id still correctly 404s
   (confirms the fix is specific, not accidentally permissive);
   `http://localhost:5174/menu` → `200`. No IdealPOS catalog data, PLUs, or
   `isAvailable` flags were modified; no order or KOT was submitted.
4. **Not independently re-verified with a live Windows browser session**
   (no interactive browser access from this session) — the HTTP-level proof
   above covers the exact request `getAuthoritativeMenu()` issues and its
   full response shape, which is sufficient to confirm the error path is no
   longer reachable, but actual on-screen rendering (categories/items
   painting correctly, no other console errors) should still get a quick
   human eyeball pass.

Windows SSH access (`DESKTOP-SOKKOQ7`, port 49222, key
`~/.ssh/verdura_windows_ed25519`) is now working, superseding the "no
working SSH/RDP path" blocker recorded earlier this session — future
sessions should re-verify it's still authorized rather than assuming it's
permanently open.

## 1d. Known latent defect — NOT fixed this session, tracked separately

Live DUNEDIN's `Venue.posAdapterType = 'local_agent'`, not `'api'`. Two
code paths key specifically off `=== 'api'`:
`orders.service.ts`'s PrinterJob-suppression check (meant to stop Verdura
printing its own KOT alongside IdealPOS's), and the legacy
`PosSyncDispatcherService`'s exclusion filter (meant to stop it competing
with `IdealposOrderDispatcherService` for the same `POSSyncRecord` rows —
see that file's own doc comment for the exact hijack mechanism this
guards against). Confirmed **currently inert** for DUNEDIN specifically:
zero `Printer` rows exist for this venue, and `POS_SYNC_DISPATCH_ENABLED`
is unset in production — re-confirm both are still true before relying on
this. This is a real defect (the `'api'`-only checks should almost
certainly also cover `'local_agent'`, or the venue was seeded with the
wrong adapter type) that should be fixed in a dedicated follow-up task —
not attempted here to avoid scope creep on a live venue mid-deployment.

---

## 2. Preconditions (verify ALL before step 1)

Re-verify every item below against the live host at session start — do
not trust this document's own dates.

1. **Code state — RECONCILED 2026-08-26.** `C:\Users\Posmate\Documents\
   VerduraServer` (the real deployment source — see the corrected topology
   note below) was fast-forwarded from `06199e7` to `4b9d2d5` (all nine
   commits back through the `isPortFree` CI fix), the `possync_cancelled_
   status` migration was applied via `prisma migrate deploy`, and
   `VerduraAPI`/`VerduraOrderTablet`/`VerduraAdminConsole`/`VerduraConnector`
   were all rebuilt and restarted from this source — verified healthy
   post-restart (§0.1 below). **Re-verify `git -C
   C:\Users\Posmate\Documents\VerduraServer rev-parse HEAD` still shows
   `4b9d2d5` (or a later commit with its own verified CI+deployment
   evidence) before trusting this line — it will drift the moment
   `main` moves again.**
2. **Services running on `DESKTOP-SOKKOQ7`** (`nssm status <name>` or
   Services.msc): `VerduraPostgreSQL`, `VerduraAPI`, `VerduraConnector`,
   `VerduraOrderTablet`, `VerduraAdminConsole` all `Running` — confirmed
   2026-08-26, including LAN reachability (Windows Firewall rules for
   5176/5177 both present and enabled) and a real WebSocket-upgrade
   handshake (101 Switching Protocols) through both proxies, not just a
   plain HTTP check. IdealposBridge running as its own service, with
   `Bridge:ApiKey` set to a real, non-empty value (confirmed to match the
   Connector's configured key) and `Idealpos:TableAssignmentStrategy=
   NoHint` set in its `App.config` — DL-106 §7's "blocked" status for these
   two is **superseded**; both are populated. `Idealpos:
   TableAssignmentConfirmed=false` **remains genuinely unresolved** — the
   Bridge's own `/api/health` self-reports this every time
   (`tableAssignmentConfirmed: false`, with a `reasons` entry warning
   orders may get stuck at `processed` without advancing to
   `assigned_to_table`) — **do not run §4 without resolving this first.**
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
   record which before proceeding — **RESOLVED 2026-08-26: option (a) is
   confirmed structurally unreachable for DUNEDIN, use (b).**
   - ~~(a) Set `TABLE19_LIVE_TEST_ENABLED=true`...~~ **Dead for this venue,
     not just "escalate and reconsider."** `assertTable19ValidationModeAllows`/
     `isTable19ValidationModeActiveForVenue` (`orders.service.ts`) hard-
     disable whenever `NODE_ENV === 'production'`, checked *before* the
     enable flag, deliberately mirroring
     `PaymentObservationFixtureInjectionController.assertNonProduction()`'s
     identical, established, codebase-wide pattern: any fixture/synthetic-
     validation surface must be categorically unreachable in production,
     no override. DUNEDIN's API runs `NODE_ENV=production` (confirmed live).
     **Do not weaken this gate** — it is not a bug, it is the same
     deliberate defense-in-depth principle this project already applies
     everywhere else a test-only code path exists next to a real one.
   - **(b) — the actual path.** Perform the live order with ordinary
     extra manual care instead of the automated guard: a human confirms
     the chosen table is genuinely free immediately before submitting,
     does not click Send twice, and step 9's retry/duplicate drills are
     run as documented. No source change is required or appropriate.

   **Related, resolved the same day: `VerduraIdealposHarness`
   (`/Users/sarwarkhan/Documents/Idealpos Solutions/VerduraIdealposHarness`)
   must NEVER be run against DUNEDIN, under any authorization, physical
   presence included.** It calls Idealpos's own `LocalDataHelper.
   InsertOrders()` directly — the identical native front door a real order
   uses — bypassing every Verdura-side safety layer (API, POSSyncRecord,
   Connector, Bridge) entirely, and its own README states this in its own
   words: "Everything in this harness targets a disposable test database.
   Nothing here is safe to point at a live restaurant's POS Server" / "Do
   not point `App.config` at the live restaurant's SQL Server under any
   circumstances." Its only documented cleanup is a direct `DELETE` against
   `WebPendingOrder`/`PendingSales`/`PendingSaleLines`, explicitly captioned
   "Only ever run this against the test database, never production" — there
   is no safe way to undo a harness-created order against a live database.
   The evidence this runbook actually needs (`PendingSales.Code` equals the
   requested table) is already captured, safely, as part of the real test
   itself: **§4 Step 7 item 2, below** — a real order through the real
   production chain, verified with the same read-only SQL the harness's own
   README documents (`docs/table12-preflight/evidence-queries.sql`), just
   applied to a genuine order instead of a disposable-environment injection.
   Set `Idealpos:TableAssignmentConfirmed=true` only after that step
   succeeds — never from a harness run, and never before.
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
8. **Re-confirm the Bridge repo's live-data claims independently — do not
   take commits `9639d14`/`a97bcfd` (`IdealposBridge` repo:
   `ResolveTableIdentifier` Caption-blank fallback, and the `GetProducts()`/
   `ProductExists()` direct-SQL rewrite) on faith.** Both commit messages
   assert specific live findings (all 19 tables' `Caption` blank; 826
   `dbo.StockItems` rows with `SentOnline=0`/`Availability=0`; 825 real
   active products) as if freshly confirmed against `DESKTOP-SOKKOQ7`. A
   same-session review (2026-08-26) could not establish that the agent
   session which wrote them actually had live SSH/DB access at the time —
   `ssh-add -l` showed no loaded identity and the hostname did not resolve,
   both before and after that work, on the same machine. The *code* (both
   are read-only `SELECT`s, parameterized where user input is involved,
   and match the class of fix already independently verified for the
   sibling `import-idealpos-tables.ts`/`c76ba9e` finding) is safe to run
   either way — nothing here writes to IdealPOS. But do not skip re-running
   the equivalent read-only queries (`SELECT DB_NAME()` alongside a fresh
   `TableMapSetups`/`StockItems` check) at the start of this session purely
   because these commit messages say it was already done.

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

### Step 9b — Cancellation-stops-dispatch drill (exercises §0.4's fix)

On a **separate**, disposable follow-up order (repeat steps 1–3 on the
same or another free table) — never cancel the order you are still
verifying in steps 4–8:

1. Place the order, and the instant it shows `POSSyncRecord` status
   `not_synced` or `queued_for_connector` (before it reaches
   `submitted_awaiting_confirmation`), cancel it from the Order Tablet/
   Admin Console.
2. If cancelled while still `not_synced`: confirm `POSSyncRecord.status`
   becomes `cancelled` and no `ConnectorCommand` is ever created for it
   (query per step 5 — expect zero rows).
3. If cancelled while `queued_for_connector` and the underlying
   `ConnectorCommand` had not yet reached `accepted`: confirm the command
   is cancelled and `POSSyncRecord.status` becomes `cancelled` — no Bridge
   submission, no KOT.
4. If the cancellation lands too late (the command already reached
   `accepted` by the time it was attempted): confirm the API response/
   Order Tablet panel truthfully reports dispatch could **not** be
   stopped (`POSSyncRecord.errorMessage` set, staff-visible) rather than
   silently claiming the cancellation fully stopped it — and if a native
   KOT does print in this case, that is expected, not a defect (the order
   had already committed to delivery); void it through IdealPOS's own UI
   like any other test order.

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
