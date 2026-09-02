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

## 1e. First physical-presence attempt (2026-08-26/27): PLU-mapping gate found + resolved for one baseline item

A full onsite preflight was run and came back completely clean — API/DB/
Redis healthy, Bridge `sqlConnected`/`orderProcessingPathAvailable=true`,
`IPS.exe` running, Connector heartbeat 4s fresh (via
`ConnectorInstallation.lastSeenAt`, cross-checked against the DB's own
`NOW()`), `TableAssignmentStrategy=NoHint`/`Confirmed=false`,
`Printer rows=0`, `POS_SYNC_DISPATCH_ENABLED` unset, `posAdapterType=
local_agent` — matching §1d exactly, still inert. Table 19 was reconfirmed
free both by read-only SQL (zero `PendingSales` for `Code='19'`, zero
active Verdura orders) and the operator's own live floor-plan screenshot.

**The certification correctly stopped at the MenuItem/PLU gate — none of
the 70 curated MenuItems had a `posProductCode`.** `buildIdealposOrderPayload`
(`idealpos-order-payload-mapper.ts`) throws `unmapped_item` rather than
guess one; that behavior is correct and was not weakened. Automated
discovery (name matching, department analysis, `Condiment` flag,
touchscreen-grid wiring) was attempted and explicitly abandoned as unsafe
— the live POS's own data is not clean enough to infer a mapping from:
even a *proven*, actually-sold-that-night standalone $35 item ("Grill
Salmon", reconstructed from real `PendingSaleLines` rows) carries
`Condiment=1`, so that flag alone is not diagnostic in this venue's data at
all. Department/grid *names* also don't fully disambiguate on their own
(e.g. a grid literally named "TRADITIONAL KEBABS" contains only unrelated
"Sila..." wrap items).

**Resolution:** rather than continue automated matching, the operator
directly configured a real StockItem for this purpose and identified it
live: **"Chicken Ballista Pizza"**, IdealPOS `StockItems.Code = "708"`
(description `CHICKEN BALLISTA PIZZA`, department "Fresh From Oven" —
matches the curated category name closely — `Discontinue=0`,
`HasVariants=0`, `Indirect=0`, single clean "Fresh From Oven" touchscreen
grid, `Visible=1`). Read-only DB confirmation matched the operator's report
exactly. Verdura curated `MenuItem` id `6579ec87-6ae7-4205-ad0a-b02229e58ebc`
(category "Fresh From The Oven", `isAvailable=true`) already existed with
this exact title at `priceCents=2350` ($23.50) — the operator separately
confirmed $23.50 is the intended Verdura display price (native price
$23.00; per the established boundary, Verdura owns display price and
IdealPOS owns final billing price — these are not required to match).

**A structural gotcha, not a one-off:** Code 708 was already held by one of
the 825 `import-idealpos-catalog.ts` staging rows (a duplicate, also
titled "CHICKEN BALLISTA PIZZA", `isAvailable=false`) — expected, since
that bulk import swept in essentially the whole live, non-discontinued
catalog, so **any** real dish a curated item maps to will very likely
already have an imported duplicate holding the same code. The
`@@unique([organizationId, posProductCode])` constraint means only one row
can hold it. With explicit operator authorization, the duplicate's
`posProductCode` was cleared to `null` (verified before/after: title,
category, `isAvailable=false`, `priceCents=0` all unchanged — only that one
field touched), then the curated item's `posProductCode` was set to
`"708"` via the new `apps/api/prisma/scripts/set-menu-item-pos-product-code.ts`
(mirrors `MenuItemsService#update`'s own conflict-check + write, since no
interactive staff JWT was available in this SSH session — prefer the real
`PATCH /admin/menu/items/:id` endpoint when a staff session exists).
**Expect this exact collision again for the next mapping** — resolve it
the same way (clear the redundant import row's code first) rather than
treating it as a surprise.

**Validated without submitting anything:** `buildIdealposOrderPayload()`
called directly (pure function, no HTTP/Bridge/IdealPOS interaction) with
a synthetic dine-in order for this item on Table 19 → produced
`{table:"19", items:[{productCode:"708", quantity:1}]}` — proves the
mapper no longer rejects this item. Public menu re-verified via
`normalizePublicMenu()` against the live API: still 10 categories/70
items, "Chicken Ballista Pizza" present, no pending-review leak. Org
totals unchanged (895 MenuItems; 825 with a `posProductCode`, net
unchanged since one was cleared and one was set; imported staging category
still exactly 825 rows, still all `isAvailable=false`).

**This is one baseline-certification item, not proof the other 69 curated
items are mapped.** No order was submitted and no KOT was triggered this
session.

## 1f. Deployment source relocated to `verduraBridge` (2026-08-27) — supersedes §1b/§1c paths

**All application deployment directories named by path in §1b/§1c above
have moved.** The deployment source is no longer directly under
`C:\Users\Posmate\Documents\`; it is now under one root,
`C:\Users\Posmate\Documents\verduraBridge\`:

| Old path (§1b/§1c, historical) | Current verified path (2026-08-27) |
| --- | --- |
| `Documents\VerduraServer` | `Documents\verduraBridge\VerduraServer` |
| `Documents\VerduraOrderTabletConnector` | `Documents\verduraBridge\VerduraOrderTabletConnector` |
| `Documents\IdealposBridge` | `Documents\verduraBridge\verduraIdealposBridge` |
| *(new)* | `Documents\verduraBridge\VerduraServerOps` |
| *(new)* | `Documents\verduraBridge\verduradb-backups` |

Verified 2026-08-27: `Documents\verduraBridge\VerduraServer` is a clean
tracked working tree at `5383b23`, matching both `origin/main` and this
Mac's own `HEAD` at the time — no drift. Full current layout, the
deployment verification gate, and the Window Display persistent-launch
workaround are documented in
[`docs/windows-production-deployment.md`](../../docs/windows-production-deployment.md);
treat that document, not §1b/§1c above, as the current authoritative
layout reference. §1b/§1c are left unchanged as historical record of the
investigation that found and fixed the Window Display outage — do not
apply their paths to a fresh session.

**`Desktop\verdura_MVP` (§1b/§1c's third directory) has since been
relocated (2026-08-27) to `C:\Users\Posmate\Documents\verdura_MVP`.** The
first move attempt failed with `Access is denied`; a fresh diagnostic
round found no reparse point, no ACL/DENY entry, and no
process/service/scheduled task referencing the path, and a same-object
in-place rename succeeded cleanly — a subsequent retry of the identical,
non-forceful `Move-Item` then succeeded outright, with recursive item
count, byte size, `.git`, `HEAD`, branch, `git status --short`, the
nested untracked `verdura_MVP\verdura_MVP\` subtree, and the GitHub
remote all confirmed unchanged.

**Superseded later the same day (2026-08-27) — see §1h below.** At the
time of the relocation above, this clone remained legacy/non-authoritative
and `verduraBridge\VerduraServer` (§1f) was the active deployment source.
That has since reversed: `verdura_MVP` was reconciled to current `main`
and is now the sole active application checkout; `VerduraServer` was
retired. Do not apply this paragraph's now-superseded "legacy, do not use"
characterization — see §1h.

## 1h. Application checkout consolidated onto `verdura_MVP`, `VerduraServer` retired (2026-08-27)

Operator-directed consolidation, not a health-driven decision (both
checkouts were fully synchronized with `origin/main` at the time). Full
sequence: `verdura_MVP` fast-forward-merged from its stale `0a7c2865` to
current `main` (no discarded work — tracked tree was already clean; the
nested `verdura_MVP\verdura_MVP\local-postgres\` subtree preserved
untouched throughout); `apps/api/.env` (which had been left pointing at
the local dev database) and `apps/admin-console`/`apps/customer-website`
`.env` (which had the dev-seed `VITE_VENUE_ID`) corrected from
`VerduraServer`'s real production config; `prisma generate` run (the one
missing step — the resulting build was clean, not a source regression);
API/Admin-Console(`dist-admin`)/Order-Tablet(`dist`) builds green;
108/108 targeted tests green. Only then were live services cut over:
`VerduraAPI`, `VerduraOrderTablet`, and `VerduraAdminConsole` NSSM
`AppDirectory`/`AppParameters` repointed to `verdura_MVP` (`VerduraAPI`
required `Stop-Service -Force` first, since `VerduraOrderTablet`/
`VerduraAdminConsole`/`VerduraConnector` are registered SCM dependents of
it — all three were then started back up in order and verified). Window
Display's Scheduled Task was recreated to launch from `verdura_MVP`
(§4 note below) after an unmanaged process was found serving it directly
from `verdura_MVP` mid-consolidation (harmless by that point, since
`verdura_MVP` was already reconciled, but not a managed launch path).
`VerduraServerOps`'s operational scripts (`build-admin*.ps1`,
`register-*-service.ps1`, `write-api-env*.ps1`, etc. — 13 files) had
their hardcoded `VerduraServer` path references updated to `verdura_MVP`
so a future re-run of any of them doesn't reintroduce the old wiring.
`VerduraServer` itself was audited (zero unique required content beyond
what's now in `verdura_MVP\_preserved-from-VerduraServer\`) and renamed
to `verduraBridge\VerduraServer.retired-<timestamp>\` rather than
deleted, preserving a full rollback path. Full current status:
[`docs/windows-production-deployment.md` §5](../../docs/windows-production-deployment.md#5-application-checkout-consolidation-2026-08-27).

## 1i. Read-only discovery session (2026-08-28): Bridge restored, PLU-mapping architecture traced, first safe batch drafted

Two-phase, strictly read-only session (no PLU/StockItem/table/product write,
no order, no KOT, no harness run against live DUNEDIN). Confirmed Mac/
GitHub/Windows all at `91cf1ec764bea0a40b76bc6c5d94591773cf550c`, CI green.

**Phase 1 — Bridge restore.** `VerduraIdealposBridgeSvc` was `Stopped`/
`Manual`; executable path confirmed correct (not stale); started, health
verified (`sqlConnected=true`, `assembliesLoaded=true`, `ipsExeRunning=true`,
`orderProcessingPathAvailable=true`), `StartMode` set to `Automatic` only
after health was proven. Live-verified via `GET /api/products` (825
StockItems) and `GET /api/tables` (29 tables) — no `POST /api/orders` call
made. Re-derived the menu-mapping baseline directly against Postgres (not
via `report-missing-pos-mappings.ts` — see below): 70 curated items, 1
mapped (Chicken Ballista Pizza → 708), 69 unmapped, all 69 candidate codes
collision-blocked by an `import-idealpos-catalog.ts` staging row already
holding them.

**Phase 2 — Architecture trace + mapping-contract trace.**

- **Adapter type.** Confirmed §1d's finding still holds and traced both
  code paths named there to their exact lines:
  `orders.service.ts`'s `venue.posAdapterType === POSAdapterType.api`
  PrinterJob-suppression check, and `pos-sync-dispatcher.service.ts`'s
  `adapterType: { not: POSAdapterType.api }` exclusion filter. **New
  finding:** `IdealposOrderDispatcherService.sweepDispatch()` — the
  dispatcher that actually reaches the real Bridge — has **no
  adapterType filter at all** in its candidate query; it claims any
  `POSSyncRecord` with `status: not_synced` regardless of adapter type,
  and its periodic timer runs unconditionally (no enable flag, unlike
  `PosSyncDispatcherService`). So `local_agent` vs `api` currently makes
  **no difference to whether an order actually reaches IdealPOS** — only
  to the two `=== 'api'`-only checks above, both still confirmed inert
  for DUNEDIN (`Printer` rows = 0, `POS_SYNC_DISPATCH_ENABLED` unset,
  re-verified this session). `report-missing-pos-mappings.ts`'s
  `posAdapterType: 'api'` filter is consistent with the codebase's own
  stated convention (`api` = "the real Idealpos Bridge integration", per
  `orders.service.ts`'s own comments) — **not proven stale**, so left
  unmodified. The open question from §1d — widen the two `'api'`-only
  checks to also cover `local_agent`, or correct DUNEDIN's
  `posAdapterType` to `api` — is still unresolved and still requires a
  human decision; do not change `posAdapterType` or those checks without
  that decision.
- **Payment observation.** `payment-observation.service.ts#getForOrder`'s
  `observation_unsupported` default is unconditional — no
  `posAdapterType` check anywhere in that file. It is the honest default
  for **every** venue today (no ingestion path exists for any adapter
  type yet), not an `api`-specific gate. The `schema.prisma` comment
  implying `posAdapterType != api` is the trigger is stale/aspirational.
- **Mapping contract.** `MenuItem.posProductCode` is the literal
  `StockItems.Code` value (confirmed via `IdealposBridge/Orders/
  OrderService.cs` and `OrderValidator.cs`: payload `productCode` is
  validated against `p.Code`, no ID/PLU indirection). Fail-closed by
  construction: `buildIdealposOrderPayload()` throws a typed
  `IdealposMappingError('unmapped_item', …)` before any HTTP call for a
  null `posProductCode`; `OrderValidator.cs` independently rejects any
  `productCode` absent from IdealPOS's own current product list. No
  fallback name-based lookup exists anywhere (`menuItemTitle` is used
  only in human-readable error text). **Residual risk, not mitigated by
  any validator:** a *wrong-but-existent* code is accepted and submitted
  successfully — nothing catches a semantically incorrect mapping. This
  is exactly why every mapping needs human confirmation before
  assignment, not just "does this code exist."
- **Staging collisions.** All 825 `import-idealpos-catalog.ts` staging
  rows carry a real `posProductCode` (`@@unique([organizationId,
  posProductCode])`, organization-scoped, not venue-scoped) by design —
  a verbatim mirror of live StockItems, deliberately `isAvailable: false`
  pending human curation (see that script's own header comment). No code
  path reads a staging row's `posProductCode` for anything at runtime,
  and neither Admin Console nor Order Tablet reference `posProductCode`
  at all (`grep` returned zero hits in both) — clearing it is
  functionally inert except freeing the unique constraint. **This is
  the same precedent §1e already established for 708**, now confirmed
  general: staging row `3b822e87-23fd-49d5-ae11-53f2b3596904` ("CHICKEN
  BALLISTA PIZZA") still exists, `isAvailable: false`, with
  `posProductCode: null` — proof the clear-not-delete pattern was used
  and is durable.
- **Deeper candidate validation surfaced real near-duplicate risk** that
  fuzzy name-matching alone missed, directly bearing out §1e's warning
  that automated matching against this venue's live data is unsafe
  without a human check. Read-only `dbo.StockItems` queries (via
  `sqlcmd`, no write) found sibling/near-duplicate active StockItems for
  half of the six highest fuzzy-score candidates:
  - `ZA'ATAR LOAF` (787) has a near-duplicate `ZAATAR LOAF` (704,
    apostrophe-only difference) — **cannot tell apart from names alone**.
  - `FALAFEL SALAD/ PLATE` (761) has a near-duplicate `FALAFEL SALAD`
    (667, differs only by "/ PLATE") among 12 similarly-named Falafel
    items.
  - `SILA LOADED ON - CHIPS` (22) is one of 8 similarly-named "Sila
    Loaded…" chips/pasta items differentiated by protein (beef steak,
    beyond meat) — the curated item's generic name doesn't specify
    protein, so the correct code can't be determined from naming alone.
  - `TIRAMISU` (578), `Dolma` (165), and `Iskender - Grill Chicken` (20)
    had no exact-name duplicates (`Iskender` has 3 sibling codes for
    other proteins — Lamb/Chicken/Mix — but the match to 20 itself is an
    exact literal match, not inferred). `Condiment=1` on all six is
    confirmed non-diagnostic in this venue's data, exactly as §1e found
    for "Grill Salmon" — do not treat it as a red flag on its own.
  - Department names (`Departments` table) partially corroborate two of
    the three surviving candidates (Tiramisu→"Desserts",
    Iskender→"MAINS", both matching their curated category) but not the
    third (Dolma→"Sides" vs curated "Small Plates") — consistent with
    §1e's finding that department/grid names don't reliably disambiguate
    on their own; treated as weak corroborating signal only, never
    sufficient alone.
  - `buildIdealposOrderPayload()` called directly (pure function, no
    HTTP/DB) for Tiramisu/578, Iskender Grill Chicken/20, and Dolma/165
    against a synthetic dine-in order on table "19" — all three produced
    a valid payload with no error, matching §1e's own validation method.

**First safe batch drafted from the above (not yet applied — needs human
sign-off):**

| # | Verdura item | MenuItem ID | PLU | Staging collision owner (id) |
|---|---|---|---|---|
| 1 | Tiramisu | `1f3ff9cf-26bc-44db-b63c-33da1a4be9cd` | 578 | `1b077e42-52d5-46f9-bbda-ef0ad4777450` |
| 2 | Iskender Grill Chicken | `3b887430-13e0-45de-812f-2fab067a3834` | 20 | `3bc57433-d1c3-4186-a459-3f5ed56723eb` |
| 3 | Dolma | `4c2688a9-ca8e-474b-8a04-58c316473af0` | 165 | `4fd722e8-8a9b-4a9b-9040-082fa244b555` |

`Za'atar Loaf`/787, `Falafel Plate`/761, and `Loaded On Chips`/22 —
despite scoring highest on fuzzy name similarity in the read-only Phase 1
discovery pass — are **not** in this batch: each has a live near-duplicate
or protein-variant sibling that makes the correct code genuinely
ambiguous without a physical-presence check, per the pattern above.

### Generalized per-mapping procedure (supersedes doing this ad hoc; applies to this batch and every future one)

1. Read live StockItem via `GET /api/products` (or direct `dbo.StockItems`
   read-only SQL) — confirm it still exists, is not discontinued, and
   check for near-duplicate/sibling descriptions before trusting a name
   match (§1i's Za'atar/Falafel/Sila findings above).
2. Confirm the curated target `MenuItem` — id, current
   `posProductCode` (must be null), category.
3. Confirm the staging collision owner — id, title, confirm
   `isAvailable: false` (never touch a row that isn't the staging
   category).
4. **Human confirms product identity** — this is the step nothing in
   code can substitute for; §1e and §1i both found the live data alone
   insufficient.
5. Capture before-state (both rows' full field values) for rollback.
6. Clear only the staging row's `posProductCode` (`null`) — via
   `apps/api/prisma/scripts/set-menu-item-pos-product-code.ts` (extend
   it or use an equivalent narrow, dry-run-by-default write) or the
   admin `PATCH /admin/menu/items/:id` endpoint when a staff session
   exists. Title/price/category/availability untouched.
7. Assign the same code to the curated row via
   `set-menu-item-pos-product-code.ts --apply` (dry-run first) or the
   same admin endpoint.
8. Leave the staging row preserved, still `isAvailable: false` — never
   delete it.
9. Re-verify: no other `MenuItem` in the org holds that code
   (`@@unique([organizationId, posProductCode])` already enforces this;
   confirm the write didn't error), and re-run the mapping count.
10. Re-verify the public menu (`normalizePublicMenu()` against the live
    API) still shows only the 70 curated items — no staging-row leak.
11. Validate with `buildIdealposOrderPayload()` directly against a
    synthetic order (no HTTP call) — do **not** submit a live order or
    trigger a KOT unless that step is separately, explicitly authorized.
12. Rollback: restore both rows' `posProductCode` to their captured
    before-state values via the same script — reverses cleanly, no
    schema change, no cascading effect (§1i confirmed no other runtime
    path reads a staging row's `posProductCode`).

## 1j. First controlled PLU mapping batch applied (2026-08-28) — 4/70 curated items now mapped

Executed the §1i first-safe-batch (Tiramisu/578, Iskender Grill
Chicken/20, Dolma/165) under explicit human authorization, one mapping at
a time, using the new `apps/api/prisma/scripts/apply-plu-mapping.ts` /
`src/pos-sync/apply-plu-mapping.ts` (§1i's 12-step procedure realized as
code — see "New utility script" below). No IdealPOS StockItem, PLU,
product, or table was modified; no order submitted; no KOT triggered; no
harness run; `posAdapterType` left at `local_agent`, `Printer` rows still
0, `POS_SYNC_DISPATCH_ENABLED` still unset.

Source-of-truth re-verified before any write: Mac/GitHub/Windows all at
`a911c97fffec161b31d75faa50696e308b1c5799`, CI green, Windows tracked tree
clean. Services re-verified healthy without restarting anything:
`VerduraAPI`/`VerduraConnector`/`VerduraPostgreSQL` Running/Automatic,
`VerduraIdealposBridgeSvc` Running/Automatic (same PID as §1i, no
crash/restart since), Redis (Docker) healthy, Bridge `/api/health`
unchanged (`sqlConnected`/`orderProcessingPathAvailable=true`,
`tableAssignmentStrategy=NoHint`/`Confirmed=false`, untouched). Each
target code re-verified live via `GET /api/products` immediately before
writing: 578→`TIRAMISU`, 20→`Iskender - Grill Chicken`,
165→`Dolma` — all three still present, `available=true`, identical to
§1i's evidence.

**Per-mapping before/after (all three, applied in this order):**

| Item | PLU | Curated MenuItem id | Staging owner id | Before (curated → staging) | After (curated → staging) |
|---|---|---|---|---|---|
| Tiramisu | 578 | `1f3ff9cf-26bc-44db-b63c-33da1a4be9cd` | `1b077e42-52d5-46f9-bbda-ef0ad4777450` | `null` → `"578"` | `"578"` → `null` |
| Iskender Grill Chicken | 20 | `3b887430-13e0-45de-812f-2fab067a3834` | `3bc57433-d1c3-4186-a459-3f5ed56723eb` | `null` → `"20"` | `"20"` → `null` |
| Dolma | 165 | `4c2688a9-ca8e-474b-8a04-58c316473af0` | `4fd722e8-8a9b-4a9b-9040-082fa244b555` | `null` → `"165"` | `"165"` → `null` |

For every mapping: dry-run first (printed the exact intended
before→after, no write), then `--apply` in one DB transaction, then
immediately re-read both rows to confirm — title/price/category/
availability unchanged on both rows in every case, only `posProductCode`
moved. All three staging rows remain present, still in the "Imported from
IdealPOS (pending review)" category, still `isAvailable: false` — never
deleted. No third `MenuItem` in the org ever held any of the three codes
during or after the change (`@@unique([organizationId, posProductCode])`
re-checked healthy for each).

**Validated per mapping** with a direct `buildIdealposOrderPayload()` call
(pure function, no HTTP/DB) against a synthetic dine-in order on table
"19" — all three produced a valid `{table, items:[{productCode, quantity}]}`
payload with no error.

**Public menu re-verified** via the raw `GET /api/kiosk/venues/{id}/menu`
data `normalizePublicMenu()` filters (same endpoint Order Tablet/Admin
Console use, unfiltered): `menuItems` total still 895, staging category
still exactly 825 rows with **0** `isAvailable: true` (so
`normalizePublicMenu()`'s `isAvailable !== false` filter still excludes
every one of them), staging rows with a null `posProductCode` now **4**
(the pre-existing Ballista Pizza one plus these three), curated count
still exactly 70 with **4** now mapped.

**Final mapping count (re-run via the same read-only inventory query as
§1i):** 70 curated total, **4 mapped**, 66 unmapped. Mapped set: Chicken
Ballista Pizza→708 (§1e), Tiramisu→578, Iskender Grill Chicken→20,
Dolma→165.

**Rollback (not needed — all three succeeded cleanly):** for any one
mapping, re-run `apply-plu-mapping.ts --apply` with `CURATED_MENU_ITEM_ID`
and `STAGING_MENU_ITEM_ID` swapped and `POS_PRODUCT_CODE` unchanged would
NOT work directly (the script assumes curated-null→staging-owns-code); the
literal rollback is a one-line `prisma.menuItem.update` per row restoring
the exact before-state values in the table above, guarded the same way
(id + expected-current-value in the `where`, never a blind write).

**New utility script — `apps/api/prisma/scripts/apply-plu-mapping.ts`,
logic in `apps/api/src/pos-sync/apply-plu-mapping.ts`:** clears a staging
row's `posProductCode` and assigns it to a curated row in one transaction
(the missing half `set-menu-item-pos-product-code.ts` doesn't cover, since
that script can only ever *set* a non-empty code, never clear one).
Dry-run by default, explicit `--apply` required, fail-closed on any of six
preconditions (same org, curated currently unmapped, staging currently
holds the exact code, staging is genuinely the import-staging category,
staging is `isAvailable: false`, staging title matches an
operator-supplied expected value, and no third row already holds the
code) — refuses with a clear message rather than guessing on any
mismatch. Unlike the sibling scripts in `prisma/scripts/` (none of which
have tests, since Jest's `rootDir` is `src/` and structurally cannot see
that directory), the actual precondition/transaction logic lives in
`src/pos-sync/apply-plu-mapping.ts` specifically so it's covered by
`apply-plu-mapping.spec.ts` (10 cases: every precondition failure path,
the happy path, and "never writes when preconditions fail") —
`prisma/scripts/apply-plu-mapping.ts` is a thin CLI wrapper around it.
Lint and `tsc --noEmit` clean.

## 1k. Second-batch approval review (2026-08-28, read-only) — dine-in/takeaway rule proven, 9 candidates evaluated, 5 recommended

Strictly read-only session: no DB write, no IdealPOS mutation, no order, no
KOT, no harness run. Re-verified before starting: Mac/GitHub/Windows all
matched (one unrelated concurrent docs commit landed mid-review from a
separate session sharing this checkout — merged in cleanly, no file
overlap with anything here), CI green, all services and Bridge health
unchanged from §1j.

**Dine-in/takeaway rule — now proven on 25 pairs, not the 1 (§1i) or 8
(§1j) previously cited.** Department 41 is named "Verdura Takeaway"
(`dbo.Departments`). Beyond the 9 second-batch candidate pairs themselves,
15 independently-sampled pairs (Fries, White Rice, Flavoured Rice, Grilled
Halloumi Cheese, Bread and Dips ×3, Hummus ×3, Arabic Tabbouleh, Hummus
Beiruty — spanning departments 17/18/19/20/24/25/28/30/34/39 on the
non-41 side) all show the same shape: identical description, one row in a
normal department, one in 41. **Nuance, not an exception to the
direction:** the mapping is sometimes many-to-one, not strictly 1:1 — e.g.
three different non-41 "Fries" rows (departments 20/25/39, presumably one
per dine-in menu section) all pair to the single takeaway code 811. This
doesn't weaken the rule (41 = takeaway is still unbroken across all 25
pairs) but means "the" dine-in code isn't always uniquely determined in
general — only checked safe here because each of the 9 candidates below
has exactly one non-41 twin, not several.

**One real exception found, not a false positive but a content
mismatch:** 8 of the 9 candidate pairs have a dept-41 twin with an
**identical** description (department is the only difference). The 9th,
Falafel Plate, does not: 667 "FALAFEL SALAD" (dept 31) vs. 761 "FALAFEL
SALAD/ PLATE" (dept 41) — the takeaway row's description adds real content
("/PLATE") the dine-in row's doesn't have. Since the curated item is
titled "Falafel Plate", the takeaway-side name is arguably the closer
textual match, inverting the usual rule. Do not resolve this from names
alone — see the per-item table below.

**Rule verdict: PROVEN for the "41 = takeaway duplicate" direction (zero
counterexamples across 25 pairs); PARTIALLY reliable as a mapping
shortcut specifically because of the many-to-one nuance and the Falafel
content-mismatch case — always independently check for description
differences beyond department before trusting "pick the non-41 code."**

**Per-candidate re-verification (fresh, this session) — all 9 passed DB
preconditions (curated unmapped, staging owns exact code, staging in the
import-staging category and unavailable, same org, no third owner), a
`--dry-run` (exact expected A/B change only), and a direct
`buildIdealposOrderPayload()` call (`productCode` matched the proposed PLU
exactly, no error):**

| Item | PLU | Live description | Department | Takeaway twin | Sibling risk | Classification |
|---|---|---|---|---|---|---|
| Chicken Avocado Salad | 663 | CHICKEN AVOCADO SALAD | 31 Salad | 757, identical | 1 distinct sibling (Avocado Halloumi) | APPROVABLE |
| Garlic & Cheese Pide | 701 | GARLIC CHEESE PIDE | 33 Fresh From Oven | 784, identical | 2 distinct siblings (Garlic Pide, Cheese Pide — different dishes, disambiguating names) | APPROVABLE |
| Halloumi Loaf | 705 | HALLOUMI LOAF | 33 Fresh From Oven | 788, identical | ~15 "Halloumi"-named rows in the catalog, none sharing "LOAF" | APPROVABLE |
| Pesto Chicken Pizza | 710 | PESTO CHICKEN PIZZA | 33 Fresh From Oven | 793, identical | none | APPROVABLE |
| Spicy Mediterranean Pizza | 712 | SPICY MEDITERRANEAN PIZZA | 33 Fresh From Oven | 795, identical | 3 distinct siblings (Spicy Aioli ×2, Spicy Wings, Spicy Muhammara Loaf) | APPROVABLE |
| Greek Eggplant & Lamb Moussaka | 673 | GREEK EGGPLANT LAMB MOUSSAKA | 30 Large Appetite | 767, identical | none | APPROVABLE |
| Mighty Angus Beef Burger | 679 | MIGHTY ANGUS BEEF BURGER | 30 Large Appetite | 772, identical | 1 unrelated sibling (Beef Burger - kids) | APPROVABLE |
| Za'atar Loaf | 704 | ZAATAR LOAF | 33 Fresh From Oven | 787 "ZA'ATAR LOAF" (apostrophe only), identical in substance | none | APPROVABLE |
| Falafel Plate | 667 | FALAFEL SALAD | 31 Salad | 761 "FALAFEL SALAD/ PLATE", **content differs** | large Falafel family (12 rows), but 667/761 are the only exact-ish name matches | PROBABLE — HUMAN CONFIRMATION REQUIRED |

**Recommended second batch (5 of the 8 APPROVABLE, capped per instruction
— not all 8):** Pesto Chicken Pizza/710, Za'atar Loaf/704, Chicken Avocado
Salad/663, Spicy Mediterranean Pizza/712, Garlic & Cheese Pide/701 — the
five with an exact department-name-to-curated-category echo ("Fresh From
Oven"/"Salad" vs. curated "Fresh From The Oven"/"Salads") and the least
surrounding-family noise. Deferred to a later batch, not rejected:
Halloumi Loaf/705 (busiest surrounding family, though the exact-name match
itself is clean), Greek Eggplant & Lamb Moussaka/673 and Mighty Angus Beef
Burger/679 (department name only approximately, not exactly, echoes the
curated category). Excluded: Falafel Plate/667 (PROBABLE, not APPROVABLE
— needs a human to confirm 667 vs. 761 against the real dish, not just the
department rule) and Kebab Skewer/16 (out of scope for this batch per
instruction).

**Utility review:** no safety defect found in `apply-plu-mapping.ts`/
`src/pos-sync/apply-plu-mapping.ts` — every precondition in §1j's list is
still enforced, the transaction is atomic (Prisma's interactive
`$transaction` callback rolls back entirely on any thrown error, including
either guarded `updateMany`'s count-!==-1 check), and no partial-write
path exists. Minor, non-blocking observation: the concurrent-modification
guard (the count-!==-1 throw inside the transaction) has no dedicated unit
test — the mock `updateMany` always returns `count: 1`, so that branch is
exercised only by code inspection, not a test. Not a defect; the guard
itself is sound and doesn't warrant a redesign. Rollback is still not a
first-class operation on the utility itself (confirmed again this
session, not just carried over from §1j) — `planPluMapping`'s own
preconditions assume the "curated null, staging owns code" starting
orientation and will refuse to run in reverse. This remains **acceptable**
for the next batch: before-state is fully captured per item above, and a
rollback is a simple two-row guarded `updateMany` (id + expected-current-
value in the `where`, same pattern the utility already uses), not an
untested or unsafe operation — just not push-button. No change made to
the utility this session.

Nothing in this section has been applied. All 9 curated items above still
have `posProductCode: null`.

## 1l. Second controlled PLU mapping batch applied (2026-08-29) — 9/70 curated items now mapped

Executed the §1k recommended five (Pesto Chicken Pizza/710, Za'atar
Loaf/704, Chicken Avocado Salad/663, Spicy Mediterranean Pizza/712,
Garlic & Cheese Pide/701) under explicit human authorization, one mapping
at a time, using the same `apps/api/prisma/scripts/apply-plu-mapping.ts`.
No IdealPOS StockItem, PLU, product, or table was modified; no order
submitted; no KOT triggered; no harness run; `posAdapterType` left at
`local_agent`; `TableAssignmentStrategy`/`TableAssignmentConfirmed`
untouched.

Source-of-truth re-verified before any write: Mac/GitHub/Windows all at
`59cbe228b7564e86e60524434fe3e701696a2415`, CI green, Windows tracked tree
clean (same pre-existing untracked build/legacy artifacts as prior
sessions — `_preserved-from-VerduraServer/`, `apps/admin-console/
dist-admin/`, a stray nested `verdura_MVP/`). Services re-verified without
restarting anything: `VerduraAPI`/`VerduraConnector`/
`VerduraIdealposBridgeSvc`/`VerduraPostgreSQL` all `SERVICE_RUNNING`,
Redis (Docker) healthy, `VerduraAPI`'s own `/api/health` returned
`{status:ok, db:ok, redis:ok}`.

**Two preconditions could not be independently re-confirmed with a fresh
live authenticated call this session:** the session's tool-permission
classifier blocked any action that read or transmitted the Bridge's
configured `Bridge:ApiKey` (needed for an authenticated `GET /api/health`
or `GET /api/products` against the Bridge directly) and blocked the same
class of action for the IdealPOS SQL vault credential. Per explicit
operator direction, both preconditions were instead satisfied from
same-day secondary evidence rather than left unresolved:
- **Bridge health:** `VerduraIdealposBridgeSvc` `SERVICE_RUNNING`; today's
  `logs\bridge-2026-08-28.log` shows `bridge_started_idealpos_available`
  at startup and a successful authenticated `GET /api/health status=200`
  at `04:07:59Z`, with no crash/restart since.
- **Live IdealPOS product identity:** §1k's own fresh, same-day
  verification of these exact 5 PLUs against live IdealPOS (710=PESTO
  CHICKEN PIZZA dept33, 704=ZAATAR LOAF dept33, 663=CHICKEN AVOCADO SALAD
  dept31, 712=SPICY MEDITERRANEAN PIZZA dept33, 701=GARLIC CHEESE PIDE
  dept33), corroborated by the staging `MenuItem` rows read fresh this
  session — a verbatim mirror of live StockItems per §1i's architecture
  trace — showing identical titles at write time (below).

**Per-mapping before/after (all five, applied in this exact order):**

| Item | PLU | Curated MenuItem id | Staging collision owner id | Before (curated → staging) | After (curated → staging) |
|---|---|---|---|---|---|
| Pesto Chicken Pizza | 710 | `9dc0031f-9885-4aa7-9f8d-4a7a45efe40a` | `69981bab-8e63-4c69-a675-dc734a5cf579` | `null` → `"710"` | `"710"` → `null` |
| Za'atar Loaf | 704 | `ecc9d141-b0c8-47c1-a4bf-36dbf416a3da` | `0ef3ac20-a380-464e-a3c6-889ee53b3637` | `null` → `"704"` | `"704"` → `null` |
| Chicken Avocado Salad | 663 | `a4e2591f-2614-4862-9a19-414f4343bdd2` | `2498a7bf-0f2f-48dd-b6ab-5e246838e5dc` | `null` → `"663"` | `"663"` → `null` |
| Spicy Mediterranean Pizza | 712 | `a7456e16-7f4c-48e8-b736-e62592913010` | `0d77239b-1cca-4ce8-b8da-e12abf1cce64` | `null` → `"712"` | `"712"` → `null` |
| Garlic & Cheese Pide | 701 | `bcfe0fee-fdb3-45c6-bb86-90880e644c82` | `6e08e4d2-1ef1-48dc-9524-2f9a0b8710a0` | `null` → `"701"` | `"701"` → `null` |

For every mapping: dry-run first (printed the exact intended
before→after, no write), then `--apply` in one DB transaction, then
immediately re-read both rows independently to confirm — title/price/
category/availability unchanged on both rows in every case, only
`posProductCode` moved. All five staging rows remain present, still in
the "Imported from IdealPOS (pending review)" category, still
`isAvailable: false` — never deleted. No third `MenuItem` in the org ever
held any of the five codes during or after the change.

**Validated per mapping** with a direct `buildIdealposOrderPayload()` call
(pure function, no HTTP/DB) against a synthetic dine-in order on table
"19" — all five produced a valid `{table, items:[{productCode, quantity}]}`
payload, `productCode` matching the assigned PLU exactly, no error.

**Public menu re-verified** via the raw `GET /api/kiosk/venues/
04841b10-1474-4f8c-962f-1ccea7eb3b81/menu` (`200`, same endpoint Order
Tablet/Admin Console use, unfiltered): `menuItems` total still 895
(70 curated + 825 staging), staging category still exactly 825 rows with
**0** `isAvailable: true` (none of them surface as available on the public
menu), staging rows with a null `posProductCode` now **9** (§1j's four
plus these five), curated count still exactly 70.

**Final mapping count (re-run via the same read-only inventory query as
§1j/§1k):** 70 curated total, **9 mapped**, 61 unmapped. Mapped set:
Chicken Ballista Pizza→708, Tiramisu→578, Iskender Grill Chicken→20,
Dolma→165, Pesto Chicken Pizza→710, Za'atar Loaf→704, Chicken Avocado
Salad→663, Spicy Mediterranean Pizza→712, Garlic & Cheese Pide→701.

**Rollback (not needed — all five succeeded cleanly):** as with §1j, the
literal rollback per row is a guarded `prisma.menuItem.update` (id +
expected-current-value in the `where`) restoring the exact before-state
values in the table above — never a blind write.

**Utility review:** no defect found; same conclusion as §1j/§1k — all six
preconditions enforced, transaction atomic, no partial-write path. Two
throwaway diagnostic scripts (`_tmp-before-state-batch2.ts`,
`_tmp-verify-one.ts`, `_tmp-validate-payloads-batch2.ts`,
`_tmp-public-menu-check.ts`) were used read-only, against the Windows
checkout only, to capture before/after state and run the payload/coverage
checks above, then deleted — never committed, tracked tree confirmed
clean afterward.

**Next batch (read-only candidates, none applied):** the three deferred
APPROVABLE items — Halloumi Loaf/705, Greek Eggplant & Lamb Moussaka/673,
Mighty Angus Beef Burger/679 — remain the front of the queue per §1k.
Falafel Plate/667 remains excluded pending human resolution of the
667-vs-761 content-mismatch noted in §1k. No further mapping applied this
session.

## 1m. Menu Management architecture (2026-08-28/29) — supersedes the manual PLU-mapping workflow above; Phase E1 production-migration preflight complete, read-only

The manual, one-mapping-at-a-time workflow in §1e–§1l (`apply-plu-mapping.ts`,
staging-`MenuItem` collision transfer) was always intended as a stopgap —
§1i's own "New utility script" note flagged that every future mapping
would repeat the same clear-staging-then-set-curated dance. A separate,
larger initiative (tracked in Git history, not narrated line-by-line
here — see commits `c2617d9` "Phase B backend/domain + Phase C Admin
Console UI" and `c7c28f2` "Phase D — migrate all customer-facing
channels") replaced that architecture entirely:

- **`PosProductIdentity`** — a new model that is never a `MenuItem` row,
  eliminating the staging-collision problem structurally (a candidate can
  hold a native code indefinitely without competing with
  `MenuItem.posProductCode`'s uniqueness constraint).
- **`MenuChannel`/`visibleChannels`** on `Category`/`MenuItem` — explicit,
  deny-by-default channel visibility, replacing the implicit
  "staging category name string match" convention.
- **`resolveChannelMenu()`** — the single shared backend resolver every
  channel (`order_tablet`/`customer_website`/`window_display`) now calls,
  closing the confirmed pre-existing leak where window-display's `/order`
  route rendered all ~825 unreviewed staging rows, dimmed but visible.
- **`resolve-native-product-code.ts`** — the dual-read precedence for the
  migration window: an active linked `PosProductIdentity` wins; any other
  linked lifecycle status fails closed (never falls back); the legacy
  `MenuItem.posProductCode` (this section's own 9 mappings) is used only
  when nothing is linked yet.

All of this landed on `main`/`origin/main` as **additive-only, code +
local/test-DB-migration only** — production was never touched by Phases
B/C/D. Windows remains, deliberately, at `733c40b` (2 commits behind
`origin/main`) until the migration below is explicitly approved and run.

### Phase E1 preflight findings (2026-08-29, strictly read-only against production)

Re-verified fresh, not assumed:

- **Schema state**: none of the new schema objects exist in production yet
  (`MenuChannel`/`PosSourceLifecycleStatus`/`PosCandidateConfidenceTier`/
  `PosSourceSystem` enums absent; `MenuItem.visibleChannels`/`isFeatured`
  absent; `Category.visibleChannels` absent; `PosProductIdentity` table
  absent) — exactly the expected pre-migration state, no discrepancy.
- **Data counts**: 1 organization, 1 venue, 11 categories (10 curated + 1
  staging), 895 `MenuItem` rows (70 curated + 825 staging), 9/70 curated
  items mapped via the legacy column, 0 `OrderItem` rows reference any
  staging `MenuItem` (the critical FK-safety precondition for a future,
  separately-authorized staging cleanup), 0 items use the legacy
  `nutritionalDetails.isFeatured` JSON convention (nothing to migrate for
  Featured).
- **All 9 trusted mappings re-verified by exact ID** (not fuzzy title
  match — several staging titles differ in wording from their curated
  counterpart, e.g. staging `"Iskender - Grill Chicken"` vs curated
  `"Iskender Grill Chicken"`, staging `"GARLIC CHEESE PIDE"` vs curated
  `"Garlic & Cheese Pide"`): every staging collision-owner row confirmed
  still present, in the staging category, `isAvailable: false`,
  `posProductCode: null`, exactly as left by §1j/§1l. Zero drift.
- **Migration SQL classified statement-by-statement**: 4 `CREATE TYPE`, 2
  `ALTER TABLE ... ADD COLUMN` (constant defaults, both tables tiny —
  11/895 rows — so no meaningful lock risk even at production scale), 1
  `CREATE TABLE`, 3 `CREATE INDEX` (on a brand-new empty table, so no
  concurrent-index concern), 2 `ADD CONSTRAINT` (FK, on the same empty
  table). **Zero destructive or data-changing statements.**
  Old-app/new-schema compatibility confirmed by source inspection: the
  currently-deployed `733c40b` `KioskController` (and every other
  production query path) uses only typed Prisma Client calls, never
  `SELECT *`/raw introspection — Prisma Client always issues an explicit,
  generation-time column list, so the old, un-regenerated client cannot
  see or be affected by new columns/tables appearing in Postgres. This is
  the standard basis on which additive Prisma migrations are considered
  safe to apply ahead of an application deploy, not a repo-specific
  workaround.
- **IdealPOS catalog sync preflight** (read-only against the live SQL
  Server, respecting the confirmed exclusion scope — Sila legacy/pre-
  rebrand departments, TA-* other-takeaway departments, DoorDash/Uber Eats,
  drinks, plus the standard modifier/operational departments): 826 total
  `StockItems`, 485 excluded by department scope, **341 candidates** would
  enter `PosProductIdentity` as `pending_review` — none auto-published,
  none auto-linked beyond the 9 already-trusted mappings. Tier breakdown:
  159 `high_confidence_active` (on a visible grid button), 104 `ambiguous`
  (no visible grid placement — not treated as exclusion evidence, per the
  Chicken-Avocado-Salad/Iskender precedent), 58 `takeaway_duplicate`
  (department 41 with an identical-description twin), 20 `ambiguous`
  (department 41, no matching twin — the Falafel-667/761 shape).
- **Price drift** (live IdealPOS price vs current Verdura price, all 9
  trusted mappings): **6 of 9 drift**. Largest: Dolma — Verdura $10.00 vs
  IdealPOS $5.00 (100% over). Others: Chicken Ballista Pizza, Pesto
  Chicken Pizza, Spicy Mediterranean Pizza all $0.50 over; Tiramisu and
  Iskender Grill Chicken both $1.00 over. Za'atar Loaf, Chicken Avocado
  Salad, and Garlic & Cheese Pide match exactly. Per the approved policy
  (IdealPOS transaction price authoritative, Verdura shows a drift
  warning), **no price was changed** — this is launch-risk evidence for
  the operator to review, not a migration action.
- **Backup**: an existing automated daily job
  (`verduraBridge\VerduraServerOps\pg-backup.ps1`, via `pg_dump -F c`)
  already produces dated dumps into
  `verduraBridge\verduradb-backups\`, 14-day retention, freshest at
  preflight time ~9 hours old (`verdura_production_20260829-030002.dump`).
  A proven restore-verification script already exists in the same
  directory (`test-restore4.ps1` — restores into a scratch
  `verdura_restore_test` database, diffs row counts against
  `count-check.sql`, drops the scratch DB) but was **not executed** this
  session (creating/dropping even a scratch database is a write action,
  out of scope for a read-only preflight) — Phase E2 should re-run it
  immediately before migrating, plus take one fresh on-demand dump rather
  than relying solely on the nightly one.
- **Dry-run proof, against local/test Postgres** (never production; no
  PGDATA copied — production's own read-only counts above were used to
  shape the scope, local dev's own real 70-curated-item structure was
  used as the production-shaped execution target): all three new
  migration scripts (`backfill-channel-visibility.ts`,
  `migrate-featured-state.ts`, `link-known-mappings.ts`) dry-run and
  applied cleanly, proven idempotent (a second run finds nothing left to
  change), and proven to never touch a synthetic staging fixture planted
  specifically to test the exclusion boundary. `resolveNativeProductCode`
  confirmed to resolve the exact expected native code for all 9 newly
  self-linked items post-migration.

**No production write occurred during Phase E1.** Full findings, exact
commands, and the executable Phase E2 sequence are in the new section
below.

---

## 2. Preconditions (verify ALL before step 1)

Re-verify every item below against the live host at session start — do
not trust this document's own dates.

1. **Code state — RECONCILED 2026-08-26, path migrated to `verduraBridge\
   VerduraServer` 2026-08-27 (§1f), then consolidated onto `verdura_MVP`
   the same day (§1h).** The deployment source's history: fast-forwarded
   from `06199e7` to `4b9d2d5` at its then-current path
   (`Documents\VerduraServer`), the `possync_cancelled_status` migration
   applied via `prisma migrate deploy`, then migrated to `verduraBridge\
   VerduraServer`, then — per §1h — the *application checkout itself* was
   consolidated onto `C:\Users\Posmate\Documents\verdura_MVP`, which is
   now the deployment source `VerduraAPI`/`VerduraOrderTablet`/
   `VerduraAdminConsole`/`VerduraConnector` run from. **Re-verify with the
   [deployment verification gate](../../docs/windows-production-deployment.md#3-deployment-verification-gate)
   from `C:\Users\Posmate\Documents\verdura_MVP` before trusting this
   line — it will drift the moment `main` moves again.**
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

   > **Re-verified read-only 2026-09-03.** All nine Verdura services are
   > `Running` on `DESKTOP-SOKKOQ7`, each service wrapper holding exactly one
   > correct child process, no orphans and no duplicate listeners:
   > `:3000` API · `:5173` CustomerWebsite · `:5174` WindowDisplay ·
   > `:5175` KitchenDisplay · `:5176` OrderTablet · `:5177` AdminConsole ·
   > `:5432` PostgreSQL · `:5588` Bridge. Two corrections to this item as
   > written:
   >
   > - **The Bridge health probe requires `Authorization: Bearer <key>`.**
   >   `X-Api-Key` returns `401` on this build. A preflight using the wrong
   >   scheme will read a healthy Bridge as unauthorised.
   > - **The API health route is `/api/health`**, not `/health` — the app
   >   sets a global `api` prefix, so bare `/health` returns 404. Verified
   >   response: `{"status":"ok","db":"ok","redis":"ok"}`.
   >
   > **`Idealpos:TableAssignmentConfirmed=false` is confirmed still false,
   > and the predicted failure has now actually occurred.** The Bridge
   > self-reports `tableAssignmentConfirmed:false` with
   > `tableAssignmentStrategy:"NoHint"`, and every order ever submitted
   > through this chain is stuck exactly as its `reasons` string warns:
   > `ORD-600001`, `ORD-600002` and `ORD-600003` all sit at POSSyncRecord
   > status `submitted_awaiting_confirmation` with `attemptCount=1` and
   > `dispatchedAt`, `syncedAt` and `failedAt` all `NULL` — while their
   > `ConnectorCommand` rows all report `succeeded` / `bridge_accepted`.
   > The Bridge accepts the order and the order never advances to table
   > assignment. `ORD-600001` additionally carries: *"Order was cancelled in
   > Verdura, but POS dispatch (status was `submitted_awaiting_confirmation`)
   > could not be stopped in time — verify directly with IdealPOS/kitchen"* —
   > whether a corresponding sale exists in IdealPOS has never been
   > established. **This item's "do not run §4 without resolving this first"
   > stands, and is now evidence-backed rather than precautionary.**
3. **Connector enrolled and polling.** `GET /venues/{venueId}/connector/
   installations` (bearer staff/admin token) shows `status: "active"` and
   `lastSeenAt` advancing within the last poll interval.

   > **Correction — compare `lastSeenAt` on a common time base, or this
   > precondition will read false.** `ConnectorInstallation.lastSeenAt` is
   > `timestamp without time zone` holding **UTC**, while `now()` is
   > `timestamptz` in **Pacific/Auckland**. A naive `now() - "lastSeenAt"`
   > therefore overstates the age by 12 h (13 h during NZDT) and will make a
   > perfectly healthy connector look half a day dead. Compare against
   > `now() AT TIME ZONE 'UTC'`. Verified on that basis read-only
   > 2026-09-03: `status: "active"`, heartbeat age **1.2 s** — polling
   > normally. The same UTC/local mismatch applies to `Order.createdAt` and
   > its sibling columns when reading evidence in §4.
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
5. **Menu/PLU curation done for at least the test items — SATISFIED as of
   §1j (2026-08-28) for four items.** `MenuItem` id
   `6579ec87-6ae7-4205-ad0a-b02229e58ebc` ("Chicken Ballista Pizza",
   category "Fresh From The Oven", `isAvailable=true`, `priceCents=2350`)
   has `posProductCode="708"`, human-verified against live IdealPOS
   `StockItems` (`CHICKEN BALLISTA PIZZA`, department "Fresh From Oven",
   `Discontinue=0`) — re-verify this is still true (a reseed or reimport
   could theoretically clear it) before relying on it in §4 step 2. §1j
   added three more via explicit human authorization: Tiramisu→578,
   Iskender Grill Chicken→20, Dolma→165 — see §1j for each one's evidence.
   Every *other* curated item (66 of 70) still has no `posProductCode` —
   do not assume any other menu item is ready without repeating §1i's
   12-step process.

   > **SUPERSEDED — the "66 of 70" figure is stale.** It predates the Menu
   > Management import (§1m). Verified read-only 2026-09-03 by exact
   > `COUNT(*)`: **895 `MenuItem` rows, 825 with a non-empty
   > `posProductCode`, 228 `isAvailable` — and all 228 available items carry
   > a `posProductCode`.** The precondition as written (hand-curate the test
   > items first) is therefore satisfied for every item a live order can
   > currently select, and the count no longer blocks §4.
   >
   > **The per-item evidence requirement still applies.** Only the mappings
   > from §1j/§1l were individually human-verified against live IdealPOS
   > `StockItems`; the remaining bulk mappings came from the import and have
   > not been individually re-verified. Re-verify the specific item chosen
   > for §4 step 2 before relying on it.
   >
   > Note when gathering evidence: read row counts with exact `COUNT(*)`.
   > `pg_stat_user_tables.n_live_tup` is unusable on this instance — 25 of
   > 30 user tables have never been analyzed, so it reports 0 rows for
   > `Organization`, `Venue` and `Table`, all of which hold rows.
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

---

## 5. PHASE E2 — MENU MANAGEMENT PRODUCTION MIGRATION (NOT YET AUTHORIZED — DO NOT RUN)

Prepared by the Phase E1 preflight (§1m). This section is a **runbook**,
not an authorization — every WRITE/DESTRUCTIVE step below requires
explicit, separate operator approval at the point marked, in the session
that actually executes it. Re-verify §1m's evidence is still current
before running any of this — do not trust dates.

Legend: **[READ-ONLY]** no state change. **[WRITE, ADDITIVE]** changes
state but adds/updates only, nothing deleted, fully reversible.
**[DESTRUCTIVE]** — none in this section; see §5.11.

### 5.1 Precheck **[READ-ONLY]**

1. Mac: `git fetch origin main && git rev-parse HEAD origin/main` — must match. If concurrent work landed, inspect and preserve it; use the real current `main`, never reset it.
2. Windows: `cd C:\Users\Posmate\Documents\verdura_MVP && git fetch origin main && git rev-parse HEAD origin/main && git status --short` — confirm exactly how far behind and that the tracked tree is clean (the 3 known untracked artifacts are expected and harmless).
3. Health baseline: repeat §1m's health checks (API `/api/health`, all 4 core NSSM services, Redis, ports 5174/5176/5177) — must all be healthy before proceeding. Do not restart anything that is already healthy.
4. CI green on the exact commit about to be deployed.

**STOP if:** Mac HEAD ≠ origin/main, Windows tracked tree is dirty, any service is unhealthy, or CI is not green.

### 5.2 Fresh backup **[READ-ONLY invocation, WRITE result — a new file only, nothing existing is modified]**

```
powershell -File "C:\Users\Posmate\Documents\verduraBridge\VerduraServerOps\pg-backup.ps1"
```
Expected output: a new `verdura_production_<timestamp>.dump` in `verduraBridge\verduradb-backups\`. Then verify restorability using the existing proven pattern (`test-restore4.ps1`'s approach — restore into a scratch `verdura_restore_test` DB, diff counts via `count-check.sql` against production, drop the scratch DB). Record the exact dump filename used as this migration's rollback point.

**STOP if:** the dump command fails, the dump file is implausibly small (< 100KB given current data volume), or the restore-verification counts don't match production.

### 5.3 Additive schema migration **[WRITE, ADDITIVE]**

On Windows, from `C:\Users\Posmate\Documents\verdura_MVP\apps\api`:
```
npx prisma migrate deploy
```
This applies exactly the migration classified in §1m (4 `CREATE TYPE`, 2 additive `ALTER TABLE ADD COLUMN`, 1 `CREATE TABLE`, 3 `CREATE INDEX`, 2 `ADD CONSTRAINT`). The currently-running `733c40b` API process may keep running through this step — it never queries the new columns/tables (see §1m's old-app-compatibility finding) — but do not rely on that as a reason to skip health-checking afterward.

Verify: re-run §1m's schema-state check script — all objects should now report present. Confirm the still-running old API's `/api/health` is unaffected.

**STOP if:** the migration errors, or the old API starts erroring/degrading after the migration lands.

### 5.4 Guarded curated-channel backfill **[WRITE, ADDITIVE]**

```
ORG_ID=<production-org-id> npx ts-node prisma/scripts/backfill-channel-visibility.ts --dry-run
```
Expected: exactly 10 categories and 70 items in scope, staging (825 items, 1 category) confirmed excluded from the target set in the output. Compare this dry-run's exact numbers against §1m's recorded counts before proceeding — if they differ, STOP and reconcile (data may have changed since preflight).

If the dry-run matches expectations:
```
ORG_ID=<production-org-id> npx ts-node prisma/scripts/backfill-channel-visibility.ts --apply
```
Then re-run the same script with `--dry-run` again — it must report 0 categories/0 items needing update (idempotency proof), and a direct query must show the staging category/items still at `visibleChannels: []`.

**STOP if:** the dry-run's before-counts don't match §1m, the script's own internal safety check trips (`SAFETY VIOLATION: staging category/item present in target set`), or the post-apply staging check shows anything other than `[]`.

### 5.5 Featured-state migration **[WRITE, ADDITIVE]**

```
ORG_ID=<production-org-id> npx ts-node prisma/scripts/migrate-featured-state.ts --dry-run
```
§1m found 0 legacy-featured items in production — expect "Found 0 item(s)". If a genuinely different (larger) number appears, STOP and investigate before applying; do not assume the preflight number is still accurate without re-checking. Otherwise this step is a no-op and may be skipped or run for completeness (`--apply` is harmless either way when 0 candidates exist).

### 5.6 PosProductIdentity sync **[WRITE, ADDITIVE]**

Run the read-only SQL export (§1m's documented query, in `sync-pos-catalog.ts`'s own doc comment) against the live IdealPOS DB, save the output, then:
```
ORG_ID=<production-org-id> STOCKITEMS_EXPORT_PATH=<path> npx ts-node prisma/scripts/sync-pos-catalog.ts --dry-run
```
Expect ~341 candidates (re-verify against a fresh export — §1m's count is a point-in-time snapshot), all landing as `pending_review`. Confirm the dry-run summary shows 0 unexpected creates beyond the candidate count, then:
```
ORG_ID=<production-org-id> STOCKITEMS_EXPORT_PATH=<path> npx ts-node prisma/scripts/sync-pos-catalog.ts --apply
```
Verify: `PosProductIdentity` row count matches the dry-run; every row's `lifecycleStatus = 'pending_review'` and `menuItemId IS NULL` (nothing published/linked yet, per this script's own design). **No IdealPOS write occurs at any point in this step** — the SQL export itself is a separate, already-authorized read-only step, not part of this script's own execution.

**STOP if:** the candidate count is wildly different from ~341 (investigate before trusting either number), or any newly-created row has a non-`pending_review` status or a non-null `menuItemId`.

### 5.7 Link the 9 trusted mappings **[WRITE, ADDITIVE]**

```
ORG_ID=<production-org-id> npx ts-node prisma/scripts/link-known-mappings.ts --dry-run
```
Expect exactly 9 "would link" lines, one per §1m's trusted list, each candidate either freshly created by §5.6's sync or found already-existing with a matching `nativeCode`. If any line reads `SAFETY VIOLATION` or `SKIP ... already linked to a different MenuItem`, STOP — do not proceed with `--apply` until reconciled.
```
ORG_ID=<production-org-id> npx ts-node prisma/scripts/link-known-mappings.ts --apply
```
Verify: all 9 curated `MenuItem` rows now have a linked `PosProductIdentity` with `lifecycleStatus: 'active'`; re-run with `--dry-run` — must report all 9 as `SKIP ... already linked` (idempotency proof); confirm `resolveNativeProductCode` (or a direct call, as done in §1m's dry-run proof) returns the exact same 9 native codes as the legacy column did.

### 5.8 Data assertions **[READ-ONLY]**

Re-run §1m's data-count script. Expected deltas from the §1m baseline: `PosProductIdentity` count ≈ 341 + 9 = 350 (9 active, ~341 pending_review); curated categories/items now carry `visibleChannels` = all three; staging category/items still `visibleChannels: []`, still `isAvailable: false`, still present (825 rows, 0 deleted); `OrderItem` count referencing staging still 0 (nothing should have changed this). Any other delta is unexpected — STOP and investigate.

### 5.9 Fast-forward Windows, build, deploy **[WRITE — application code, no data]**

Only after §5.3–§5.8 are all verified:
```
cd C:\Users\Posmate\Documents\verdura_MVP
git fetch origin main
git merge --ff-only origin/main
npm run build --workspace=apps/api
```
Restart **only** `VerduraAPI` (the service whose code actually changed) — leave `VerduraConnector`/`VerduraIdealposBridgeSvc`/`VerduraPostgreSQL` untouched, they don't need it. Rebuild and redeploy Admin Console/Order Tablet/Customer Website/Window Display per the existing documented build scripts (`build-admin.ps1`/`build-tablet.ps1`, and whichever equivalent exists for customer-website/window-display — confirm before assuming one does).

**STOP if:** any build fails, or `VerduraAPI` fails to restart cleanly.

### 5.10 Post-deploy verification **[READ-ONLY]**

1. `GET /api/health` — healthy.
2. `GET /api/menu/venues/:venueId/channel/order_tablet` — exactly 70 items, matching §5.4's backfill (not empty — the exact failure mode this whole sequencing avoids).
3. Same for `channel/customer_website` and `channel/window_display`.
4. Confirm zero staging titles appear in any of the three responses.
5. Browser check: Order Tablet, Admin Console, Customer Website, Window Display (including `/order`) all load and show the correct 70-item menu.
6. Confirm the Admin Console POS Catalog Review page loads and shows the ~341 pending_review candidates plus the 9 already-linked/active items.
7. Synthetic-only order-handoff check (`buildIdealposOrderPayload`/`resolveNativeProductCode` called directly, no HTTP, no live order) for at least the 9 trusted mappings — confirm codes match §1m exactly.

**Do not submit a real order or trigger a KOT as part of this verification** — that remains gated behind §4's separate, already-documented authorization requirement, unrelated to this migration.

### 5.11 Stability observation, then stop

Observe for a full service cycle (at minimum a few hours spanning normal traffic) before considering this migration complete. Do not proceed to any destructive cleanup (§5.12) in the same session as the migration itself, regardless of how clean things look.

### 5.12 Destructive cleanup — NOT AUTHORIZED, FUTURE GATE ONLY

The following require their own, separate, explicit authorization, only after the migration above has been stable in production for a meaningful period:

- Deleting the 825 staging `MenuItem` rows.
- Deleting the staging `Category` row.
- Dropping `MenuItem.posProductCode`.
- Removing the now-superseded legacy scripts (`apply-plu-mapping.ts`, `set-menu-item-pos-product-code.ts`, `import-idealpos-catalog.ts`, `report-missing-pos-mappings.ts`) — keep in history with a "superseded" note, per this repo's existing convention (see `AUDIT_REPORT.md`'s precedent), not silently deleted even once authorized.

None of this is authorized by this section. Do not perform it as part of Phase E2.

### Rollback reference (see §5's own step numbers for exact reverse actions)

- **After §5.2 (backup) only**: nothing to roll back, no write occurred.
- **After §5.3 (additive schema)**: `DROP TABLE "PosProductIdentity"`, `ALTER TABLE "MenuItem" DROP COLUMN "isFeatured", DROP COLUMN "visibleChannels"`, `ALTER TABLE "Category" DROP COLUMN "visibleChannels"`, `DROP TYPE` the 4 new enums — or simply restore the §5.2 backup, which is simpler and equally safe given no real data has been layered in yet.
- **After §5.4/§5.5 (backfill)**: re-run either script's logic in reverse (`visibleChannels: []`, `isFeatured: false` for the affected rows) or restore the §5.2 backup.
- **After §5.6/§5.7 (PosProductIdentity sync/link)**: `DELETE FROM "PosProductIdentity"` (empty table otherwise, safe) or restore the §5.2 backup.
- **After §5.9 (app deployment)**: `git checkout 733c40b` (or whatever the pre-migration Windows HEAD was) on Windows, rebuild, restart `VerduraAPI` — the additive schema remains compatible with the old code either way (§1m), so this alone un-does the deployment without needing a data rollback too.
- At every stage, the freshest §5.2 backup remains the unconditional fallback: restore it, and every one of the additive changes above is undone in one step.
