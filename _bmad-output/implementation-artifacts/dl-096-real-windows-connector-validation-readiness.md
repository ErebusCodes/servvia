# DL-096 — Real Windows Connector Validation Readiness Gate

Planning-only pass. No hardware accessed, no real order sent, no code changed in this pass beyond
this document and its decisions-log entry. Worktree `/private/tmp/verdura-order-tablet-reconcile`,
branch `order-tablet-idealpos-reconciled` (currently at `d5b8fe1`, unchanged by this pass).

## Headline finding, established before anything else here matters

A real, already-substantially-validated **IdealposBridge** implementation exists —
`/Users/sarwarkhan/Documents/IdealposBridge` (a newer copy) and `/Users/sarwarkhan/Documents/Idealpos
Solutions/VerduraIdealposBridge` (an older copy) on this machine. **Neither is inside the
`verdura_MVP` git repository, and neither directory is itself a git repository** — this is real,
compile-verified-against-the-real-vendor-DLLs production code with zero version control, zero backup,
and zero code-review trail, sitting only on one laptop. That repository also already contains a
complete, dated **2026-08-19 "Table 12" controlled-experiment preflight package**
(`docs/table12-preflight/`: an operator runbook, a request fixture, evidence SQL, a table-assignment
strategy review, and a Windows packaging/install script) — independently prepared, already
found-and-fixed 2 P0s and 1 P1 by full source review, and ready to execute on the first real Windows
machine made available.

**This changes the shape of this task.** The Bridge is not an unbuilt component the Connector calls
into a vacuum — it is a real, reviewed artifact with its own validation plan already written. What
does **not** yet exist is a plan that validates the **actual production chain** (Order Tablet →
`IdealposOrderDispatcherService` → `idealpos.submit_order.v1` → the always-on Venue Connector host →
Bridge → IdealPOS) end-to-end — the existing table12-preflight package deliberately submits directly
to the Bridge via PowerShell `Invoke-RestMethod`, bypassing the Connector entirely, to isolate Bridge
risk from Connector risk. This document's Real Windows Test Plan (§2) is written as the next phase
*after* that existing Bridge-only preflight succeeds, not a replacement for it.

---

## 1. Current Deployment Model

### Connector (`apps/venue-connector`, this repository)

- **Build artifact:** `VerduraIdealposTracer.Cli` (`net8.0-windows`), `dotnet publish` output —
  `VerduraIdealposTracer.Cli.exe` + its dependencies (`VerduraIdealposTracer.Core.dll`,
  `VerduraIdealposTracer.Windows.dll`, `Microsoft.Extensions.Hosting*.dll`). **Cannot be built on this
  machine** — its `ProjectReference` to `VerduraIdealposTracer.Windows` fails first
  (`System.Windows.Automation` unavailable outside Windows); confirmed pre-existing and unaffected by
  DL-095. First real build of this exact artifact has never happened anywhere yet.
- **Runtime requirements:** Windows (the target machine already has .NET 8 SDK per the existing
  Story 9-2 setup step); no other new runtime dependency introduced by DL-095 beyond the two
  `Microsoft.Extensions.Hosting*` NuGet packages (already restorable — confirmed via a real `dotnet
  restore` this session).
- **Configuration:** environment variables only (`TRACER_MODE=cloud`, `TRACER_STORE_PATH`,
  `TRACER_PROFILE_PATH`, `TRACER_BASE_URL`, `TRACER_CONNECTOR_CREDENTIAL`,
  `IDEALPOS_BRIDGE_BASE_URL`, `IDEALPOS_BRIDGE_API_KEY`, optional `IDEALPOS_BRIDGE_TIMEOUT_MS`,
  `TRACER_POLL_INTERVAL_MS`, `TRACER_POLL_ERROR_BACKOFF_MS`) — no config file, no secrets file.
- **Secrets:** exactly one, `TRACER_CONNECTOR_CREDENTIAL` (the real Story 2-9
  `installationId.secret`) plus `IDEALPOS_BRIDGE_API_KEY` (must equal the Bridge's own
  `Bridge:ApiKey`) — both must come from "trusted connector configuration," never hard-coded (already
  enforced: `Program.cs` throws if either is unset).
- **Installation assumption:** none exist yet. DL-095 added `AddWindowsService()` so the built binary
  *can* be installed as a Windows Service, but **no install script, no service-account guidance, and
  no operator runbook for cloud mode exists in this repository** — `apps/venue-connector/docs/
  operator-runbook.md` covers only the unrelated Story 9-2 local-mode discovery diagnostic (confirmed
  by reading it in full: it invokes the Cli with no `TRACER_MODE` set, which defaults to `local`, and
  never mentions `TRACER_BASE_URL`/cloud mode/Windows Service installation at all). **This is a real
  gap, not a hidden one** — the Bridge's own `deploy/install-service.ps1` is a working template for
  what the Connector's equivalent still needs to be written.
- **Windows Service registration:** `builder.Services.AddWindowsService(options => options.ServiceName
  = "VerduraIdealposTracer")` is wired (DL-095) but never installed/started against a real Windows
  Service Control Manager — `sc.exe create` has never been run for this binary.
- **Logging location:** currently console only (`AddSimpleConsole`) — no file sink configured. As a
  real Windows Service (no attached console), **this is a real gap**: without a file/Event Log
  provider, a service-mode run today would produce no durably retrievable logs at all. Needs a
  `Microsoft.Extensions.Logging.EventLog` or file provider added before a genuine Windows Service
  install — flagged here, not fixed (out of this pass's planning-only scope).
- **Upgrade/replacement process:** none exists yet — no versioning scheme, no side-by-side/blue-green
  approach, no documented "stop service, replace binaries, start service" procedure.

### Bridge (external to this repository — see headline finding)

- **Build artifact:** `VerduraIdealposBridge.exe` (`net48`), built via `dotnet build -c Release` /
  `dotnet publish -r win-x64` against the real vendor DLLs
  (`IdealPos.Webit.Core.dll`/`IdealPos.Data.dll`/`IdealPos.Common.dll`, Idealpos v6.05.0001) — **this
  exact build already succeeded once**, on this machine, 2026-08-19 (0 errors, 0 warnings; see that
  repository's own `validation-report.md`).
- **Runtime requirements:** Windows, .NET Framework 4.8 targeting pack (build-time), a reachable SQL
  Server hosting the target Idealpos database, and the five vendor DLLs copied into `lib/` at
  build/publish time (never redistributed — rebuilt fresh on the target machine each time, per that
  repository's own `windows-package/build-and-package.ps1`).
- **Configuration:** `App.config` only — confirmed by full source review there is **no environment
  variable override mechanism anywhere in that codebase**. Required, no-default settings: SQL
  connection string, `Bridge:ApiKey`, `Idealpos:TableAssignmentStrategy` (one of 5, unproven against
  any real Idealpos instance yet — see §2 Prerequisites).
- **Installation assumption:** documented in full (`windows-package/install-locations.md`) —
  binaries at `C:\Program Files\Verdura\IdealposBridge\`, mutable state/logs at
  `C:\ProgramData\Verdura\IdealposBridge\`, a real `deploy/install-service.ps1` for Windows Service
  registration (service account guidance included: reuse `IdealposService`'s own account, or a
  dedicated least-privilege SQL login).
- **Logging location:** `C:\ProgramData\Verdura\IdealposBridge\logs\bridge-YYYY-MM-DD.log`, confirmed
  by source review to never log a secret.

**Cross-artifact contract check performed this pass:** `IdealposBridgeClient.cs` (this repo) was
re-read against the Bridge's actual documented contract (`POST /api/orders`, `Bearer <key>`, default
`127.0.0.1:5588`, camelCase JSON, 201/200/400/5xx semantics) — **matches exactly**, including that a
Bridge `502 idealpos_submission_failed` is correctly classified `UnreachableOrFailed` (retryable with
the same `externalOrderId`, safe per the Bridge's own idempotency-on-`externalOrderId` guarantee,
already covered by that repository's own Phase 3 replay test). No contract drift found.

---

## 2. Real Windows Test Plan

This plan assumes the existing table12-preflight Bridge-only validation (external repository,
`docs/table12-preflight/`) either has already run successfully, or runs immediately before Phase C
below on the same machine — this pass does not repeat or replace that plan, only extends it to include
the actual Connector.

### Prerequisites

- **Hardware/environment access:** an approved **disposable** Windows 11 host (per the existing
  preflight's own Phase 0 gate — not production), with Idealpos installed and a disposable/test SQL
  Server instance, per DL-064's standing requirement.
- **IdealPOS availability:** Idealpos client + services running normally, logged in, no dialogs, no
  order in progress (same gate the existing Story 9-2 runbook and the Bridge preflight both already
  state).
- **Bridge availability:** the Bridge built, configured, and **already independently verified healthy**
  (`GET /api/health` → `orderProcessingPathAvailable: true`) *before* the Connector is pointed at it —
  do not debug two unknowns at once.
- **Table-assignment strategy resolved:** per §1's Bridge section and the external repository's own
  `table-assignment-review.md`, `Idealpos:TableAssignmentStrategy` is unproven against any live
  Idealpos instance, and — critically — **`Table.posTableCode` in this repository's own schema has no
  documented convention for whether it holds Idealpos's `Caption` (string) or `Code` (int)**, and the
  Bridge validates the request's `table` field against `Caption`, not `Code`. **This must be resolved
  and documented before a real Connector-driven submission, not discovered live** — see §6.
- **Test data requirements:** one disposable/test PLU confirmed via `GET /api/products` and one
  disposable/inactive table confirmed via `GET /api/tables` / `evidence-queries.sql` §0a, exactly as
  the existing preflight's `request-fixture.md` already specifies — a Verdura-side `MenuItem` and
  `Table` row must exist with `posProductCode`/`posTableCode` set to those exact, freshly-verified
  values (never a documentation example).
- **Connector build:** the Cli must be built for the first time on the real Windows machine
  (`dotnet publish -r win-x64` or equivalent) — this has never happened anywhere, unlike the Bridge,
  which already has one successful real build behind it.
- **Credentials:** a real Story 2-9 connector installation credential
  (`installationId.secret`) issued for this specific disposable venue/test environment, and a Bridge
  `Bridge:ApiKey` matching what was configured in Phase 1 of the Bridge preflight.

### Execution sequence

**Phase A — Bridge-only preflight (external repository, already written — execute first, unchanged).**
Follow that repository's `docs/table12-preflight/operator-runbook.md` Phases 0–4 in full, including its
own PowerShell-direct `POST /api/orders` test. Do not proceed to Phase B until Phase A's Outcome is
understood and the test order has been cleaned up (that runbook's own Phase 4).

**Phase B — Connector build and standalone startup verification (no Bridge, no backend yet).**
1. Copy `apps/venue-connector` to the Windows machine; `dotnet build VerduraIdealposTracer.slnx` for
   the cross-platform projects (expect this to now pass — it always has); then attempt the **first-ever**
   `dotnet publish src\VerduraIdealposTracer.Cli -c Release` and record the exact result (success or
   the first real compile error against the actual Windows SDK/`System.Windows.Automation`).
2. Run `VerduraIdealposTracer.Cli.exe` interactively with `TRACER_MODE=local` (the existing, already-
   proven discovery diagnostic) to confirm the Windows automation client itself initializes on this
   machine, per the existing Story 9-2 runbook Step 3 — this is unrelated to order submission but is
   the cheapest possible "does this binary even run here" check before layering cloud mode on top.
3. Run interactively with `TRACER_MODE=cloud` pointed at a **backend the operator knows is
   unreachable** (e.g. an intentionally wrong port) — confirm the DL-095 behaviour observed in this
   session's own cross-platform smoke test reproduces for real on Windows: clean startup log, repeated
   backed-off "Poll failed" messages, no crash, clean `Ctrl+C` shutdown.

**Phase C — Full chain, one controlled command.**
1. Point the Connector's `TRACER_BASE_URL` at the real disposable backend and `IDEALPOS_BRIDGE_BASE_URL`
   at the now-healthy Bridge from Phase A (still running, still healthy — re-check `/api/health`).
2. In the disposable backend, create exactly one `Order` (via the same disposable/test `MenuItem`/
   `Table` rows validated in Phase A/Prerequisites) that produces exactly one durable
   `ConnectorCommand` of type `idealpos.submit_order.v1`.
3. Start the Connector (interactively, `--console`-equivalent — **not yet as an installed Windows
   Service**, so it can be stopped instantly by closing the window).
4. Observe: the Connector polls, claims, calls the Bridge, and reports — cross-reference every step
   against §3's Evidence Checklist below, in order.
5. **Stop and roll back:** close the Connector console window (safe at any point, no cleanup required
   client-side — mirrors the existing Story 9-2 runbook's own "Stop" section). Follow the Bridge
   preflight's own Phase 4 cleanup (void the test order via the real Idealpos UI). Do not install the
   Connector as a Windows Service in this same session — that is a separate, later, explicitly-decided
   step (mirrors the Bridge preflight's own Phase 4 step 7 precedent).

---

## 3. Evidence Checklist

### Connector lifecycle (software evidence — this repository's own responsibility)

- [ ] Service/process running: console shows the DL-095 startup log line; process alive in Task
      Manager / `Get-Process`.
- [ ] Command claimed: Connector log shows `commandId=... type=idealpos.submit_order.v1`; backend's
      `ConnectorCommand.status` transitions `pending → claimed → accepted`.
- [ ] Command executed: Connector log shows a Bridge outcome line
      (`Bridge outcome: Accepted/Rejected/UnreachableOrFailed`).
- [ ] Result reported: backend's `ConnectorCommand.status` reaches a terminal value
      (`succeeded`/`failed`/`unknown`), and `POSSyncRecord.status` reflects it truthfully.

**None of the above is evidence of anything past this repository's own boundary.**

### Native IdealPOS (hardware evidence — requires the real Windows/Idealpos machine)

- [ ] Order received: Bridge's own `WebPendingOrder` row exists (`evidence-queries.sql` §1/§2) —
      proves only that the row was inserted, not that Idealpos read it.
- [ ] Order accepted: `WebPendingOrder.Processed = 1` (§3 of the same file) — the Bridge repository's
      own README names this **"the only real evidence of native consumption."**
- [ ] Native processing result: `PendingSales`/`PendingSaleLines` rows correlate to the submitted
      order, **and** `PendingSales.Code` matches the requested table per the resolution of §6's open
      question — plus **independent confirmation in the real Idealpos UI** (a second person or a
      screenshot), never database evidence alone, per the existing preflight's own explicit rule.

**Bridge acceptance (a Connector-observed `succeeded`/`bridge_accepted`) is never sufficient evidence
for any box in this section on its own** — it proves only that `LocalDataHelper.InsertOrders()` did not
throw, which both this repository's own decisions-log entries (DL-094/095) and the Bridge's own README
already state explicitly.

### KOT (hardware evidence — entirely unaddressed by any code in either repository today)

- [ ] KOT generated: **no mechanism exists anywhere in the Bridge or Connector to observe this** — the
      Bridge's own API has no endpoint for kitchen-ticket state, and `evidence-queries.sql` does not
      query for one. This would require either a native Idealpos KOT/print-queue table (undiscovered)
      or direct printer/print-spooler observation.
- [ ] KOT printed: same — no instrumentation exists. The only currently-available evidence is a human
      physically observing (or not observing) a printed ticket at the kitchen printer.

**This entire category remains unaddressed by any planned validation step in either repository — flag
this explicitly in the next-steps recommendation (§6), do not silently leave it implied by the other
sections.**

---

## 4. Failure Handling

| Scenario | Expected outcome |
|---|---|
| Connector cannot start | Fails fast at startup (missing required env var throws `InvalidOperationException` before the host builds — unchanged, pre-DL-095 behaviour, confirmed still in place); Windows Service install shows a failed-start Event Log entry once a logging provider is added (§1 gap). No partial/zombie state possible — nothing is claimed before the host starts. |
| Bridge unavailable (not running / wrong port) | Connector's poll loop keeps running; each command's `SubmitOrderAsync` call throws `HttpRequestException` → classified `UnreachableOrFailed` → reported `failed`/`bridge_unreachable_or_failed`, retried per DL-092's bounded backoff. Never crashes the host (DL-095's per-command isolation). |
| IdealPOS unavailable (Bridge up, `IPS.exe`/SQL down) | Bridge's own `/api/health` reports `orderProcessingPathAvailable: false` with `reasons[]` naming the exact cause — **must be checked before submitting**, per the Bridge preflight's own Phase 1 step 9. If submitted anyway, `InsertOrders()` is expected to throw → Bridge returns 502 → Connector classifies `UnreachableOrFailed` → retried, never silently swallowed. |
| Duplicate command (same `externalOrderId` redelivered) | Two independent idempotency layers already proven this session: the Connector-side `ConnectorPollingLoopTests` (`DuplicateCommandVisibleAcrossTwoPolls...`) and the Bridge's own `externalOrderId`-keyed idempotency (its Phase 3 replay test, `"duplicate": true`, same status/IDs, never a fresh `201`). Both must hold simultaneously in Phase C — this is a real, not yet exercised, combination. |
| Unknown command state (`ConnectorCommandStatus.unknown`) | DL-093's bounded grace-period recovery applies unchanged — reuses the original stored payload byte-for-byte, never re-derives mapping. Not specific to real hardware, but a real ambiguous Bridge timeout on real hardware is the first genuine exercise of this path outside a fake `HttpMessageHandler`. |
| Native modifier mismatch (an order carries modifiers) | **Must never reach this point** — `idealpos-order-payload-mapper.ts` fails closed (`unsupported_modifiers`) before a command is even created. Phase C's test order must be modifier-free by construction; if a modifier-bearing order is accidentally used, expect the `ConnectorCommand` to never be created at all (visible as the `POSSyncRecord` never leaving `not_synced`/failing mapping validation), not a Bridge-side error. |

---

## 5. Production Readiness Update

| Area | Status | Basis |
|---|---|---|
| Connector Execution | PROVEN (software only) | Unit + real-process evidence, DL-095; unchanged by this planning pass. |
| Always-On Hosting | PROVEN (software only) | DL-095, as above. |
| Native IdealPOS Consumption | **NOT YET VERIFIED** | No hardware access occurred in this pass. Bridge-side compile evidence (external repo) narrows the *risk*, but is explicitly not consumption evidence — that repo's own README says so. |
| Native KOT Printing | **NOT YET VERIFIED** | No instrumentation exists anywhere yet to observe this even once real hardware access is granted — see §3. |

No status is promoted based on this pass — it is a planning document, not new execution evidence.

---

## 6. Recommended Next Step

**Resolve the `Table.posTableCode` Caption-vs-Code ambiguity in writing, before any real submission is
attempted** — this is the single highest-risk unresolved item blocking Phase C, discovered by the
external Bridge repository's own investigation but never previously cross-checked against this
repository's own schema/mapping code (done for the first time in this pass, §1/§2). Concretely: confirm
on the real target Idealpos instance whether `TableMapSetups.Caption` and `.Code` coincide for the
intended test table (the Bridge preflight's `evidence-queries.sql` §0a already produces both values),
and only then decide what value population process feeds `Table.posTableCode` — this is a
one-paragraph decision-log entry, not a code change, and it is the one prerequisite in this whole plan
that is neither "get hardware access" (already the standing DL-064 blocker) nor "run the plan that
already exists."

A close second, non-blocking but important: bring the external Bridge repository under version
control (even a private, unpushed local git repo) before it is copied anywhere — real, reviewed,
compile-verified production code currently has no history, no backup, and no diff trail.
