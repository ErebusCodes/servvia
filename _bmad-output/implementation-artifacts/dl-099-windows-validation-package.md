# DL-099 — Controlled Windows + IdealPOS Validation Package

Prepared 2026-08-23, Sunday 16:39 NZT. Branch `order-tablet-idealpos-reconciled`, commit `48fada0`.
This document is planning/documentation only — no hardware was accessed, no code was changed, no
order was submitted to prepare it. It composes existing, already-validated material (cited by exact
path throughout) into one executable package; nothing here is invented where the underlying material
doesn't already say it.

**Audience:** the operator/engineer who will actually be at the Windows/IdealPOS machine. Written so
it needs no oral context from this session.

---

## 1. Validation Scope

**This validation proves:**
- The Venue Connector software can be built and deployed on a real Windows machine.
- The always-on Connector host (DL-095) can run continuously against a real Windows Service Control
  Manager.
- The Bridge (external `IdealposBridge` project) can communicate with a real IdealPOS installation.
- One controlled test order can traverse the full chain: Order Tablet → API → `ConnectorCommand` →
  Venue Connector → Bridge → IdealPOS, with evidence captured at every hop.

**This validation does NOT prove:**
- All production menu items or the full menu catalogue.
- Modifiers (deliberately fail-closed — see §8; no modifier-bearing order is part of this test).
- Payment, EFTPOS, or GST — none of this software touches any of them, by design (DL-094 and earlier).
- The full KOT workflow end-to-end (KOT generation and physical printing are separately gated, §9).
- Physical printer reliability, load, or concurrency behaviour.
- Any behaviour under real multi-terminal/multi-order concurrency at the venue.

A pass here narrows exactly one thing: whether the already-proven software path can reach real
IdealPOS at all. It does not retire DL-064.

---

## 2. Preflight Checklist

Do not proceed past this section until every item is checked, exactly as the existing Bridge
preflight's own Phase 0 already requires (`docs/table12-preflight/operator-runbook.md` in
`/Users/sarwarkhan/Documents/IdealposBridge`, "Phase 0 — Environment gate").

### Hardware
- [ ] A Windows machine is available and **confirmed disposable/test-tier**, not a production venue
  terminal — the Bridge runbook's own Phase 0 step 1 requires this same confirmation independently;
  do not skip it here just because it's already required there.
- [ ] The correct venue machine/instance is identified and its identity recorded (hostname, OS version
  — `docs/table12-preflight/operator-runbook.md` Phase 0 step 2 gives the exact PowerShell commands).
- [ ] Backup/rollback access to this machine is available (someone who can revert or rebuild it if
  needed).
- [ ] IdealPOS is confirmed installed, running, and licensed on this machine (`Get-Process IPS`,
  `Get-Service IdealposService, IdealposUpgradeService` — same runbook, Phase 0 step 5).

### Software
- [ ] Venue Connector build artifact — **not yet produced anywhere**; see §3 and §4. No prior
  successful Windows build of `VerduraIdealposTracer.Cli` exists in this project's history (confirmed:
  the only environment this project has been developed in is non-Windows — see
  `apps/venue-connector/README.md`'s own solution-layout table).
- [ ] Version identifier recorded: git commit SHA the build was produced from (§3).
- [ ] Checksums recorded for the built output (no existing script produces these for the Connector —
  flagged as a real gap in §3, unlike the Bridge which already has
  `windows-package/source-manifest-sha256.txt`/`build-output-manifest-sha256.txt`).
- [ ] .NET 8 runtime (or SDK, if building on-machine) confirmed present — `dotnet --version`.
- [ ] Vendor DLL dependencies for the **Bridge** (`IdealPos.Webit.Core.dll`, `IdealPos.Data.dll`,
  `IdealPos.Common.dll`, `Newtonsoft.Json.dll`, `System.Data.SQLite.dll` — see
  `lib/PUT_DLLS_HERE.txt` in the Bridge repo) confirmed present in the live Idealpos install directory.
  The Connector itself has no vendor DLL dependency at all — it only ever calls the Bridge over HTTP.

### Network
- [ ] Connector → Bridge connectivity: both run on the **same machine**, loopback only
  (`http://127.0.0.1:5588` — Bridge's own documented default,
  `sample.App.config`'s `Bridge:BindAddress`/`Bridge:Port`). No cross-machine network path is needed
  or should be opened for this test.
- [ ] Bridge → IdealPOS connectivity: in-process (the Bridge links `IdealPos.Webit.Core.dll` directly)
  plus a SQL Server connection (`IpsConnection` in `App.config`) — confirm the disposable test SQL
  Server instance is reachable from this machine.
- [ ] Connector → Verdura backend (`TRACER_BASE_URL`) connectivity: **this is the one real network
  decision this package cannot make for you** — it depends on where the disposable backend the test
  order is created against actually runs (a local dev instance on this same machine, a tunnel to a
  developer's machine, or a staging deployment). Record whatever is chosen; see §4's "Missing Inputs"
  discipline — do not silently assume localhost if the backend is not actually on this machine.
- [ ] Firewall: no inbound port needs to be opened on the Windows machine for this test — the
  Connector only makes outbound calls (to the Bridge locally, and to `TRACER_BASE_URL`); the Bridge
  only listens on loopback (`AllowLan: false`, confirmed default in `sample.App.config`).

### Safety
- [ ] A genuinely disposable/test venue+table+item context is used — never a real seeded production
  venue's live table.
- [ ] No live customer impact is possible from this venue/table/time selection.
- [ ] No payment or EFTPOS action will be attempted at any point (nothing in this software path can
  initiate one — confirmed by source review in DL-094–096, and independently by the Bridge's own
  README: "There is no `/pay` endpoint anywhere in this project").
- [ ] Rollback is available and understood before starting (§10).

---

## 3. Venue Connector Build Artifact

- **Project path:** `apps/venue-connector/src/VerduraIdealposTracer.Cli/VerduraIdealposTracer.Cli.csproj`
  (`net8.0-windows`, references `VerduraIdealposTracer.Core` and `VerduraIdealposTracer.Windows`).
- **Build command:** no packaging script exists for the Connector (unlike the Bridge's
  `build-and-package.ps1`) — this is a real, flagged gap, not an oversight to paper over. The standard
  .NET command is:
  ```powershell
  dotnet publish apps\venue-connector\src\VerduraIdealposTracer.Cli\VerduraIdealposTracer.Cli.csproj `
    -c Release -r win-x64 --self-contained false
  ```
  **This exact command has never been run successfully anywhere in this project's history** — it has
  only been attempted on non-Windows machines, where it fails before even reaching this project's own
  code (`System.Windows.Automation` is unavailable outside Windows — see
  `VerduraIdealposTracer.Windows.csproj`'s own doc comment, and DL-095's completion report for the
  exact, reproduced error). **The first real build of this artifact is itself part of what this
  validation proves — do not assume it will simply succeed.**
- **Output artifact location:** `apps\venue-connector\src\VerduraIdealposTracer.Cli\bin\Release\net8.0-windows\win-x64\publish\` (standard `dotnet publish` layout for this TFM/RID; not independently confirmed since the command has never run).
- **Version identifier:** git commit SHA of the worktree the build was produced from — record it
  exactly (see §12 template). This package itself was prepared at `48fada0`.
- **Runtime requirements:** Windows (the `net8.0-windows` TFM and its `VerduraIdealposTracer.Windows`
  dependency require it); .NET 8 runtime if `--self-contained false` is used, or none if built
  self-contained instead.
- **Configuration requirements — environment variables** (from `Program.cs`, all read via
  `Environment.GetEnvironmentVariable`, all fail-fast with an explicit message if a required one is
  missing):

  | Variable | Required | Purpose |
  |---|---|---|
  | `TRACER_MODE` | No (defaults `local`) | Must be `cloud` for this test — `local` is the unrelated Story 9-2 discovery diagnostic. |
  | `TRACER_STORE_PATH` | Yes | Local durable log file path (`DurableLocalLog`). |
  | `TRACER_PROFILE_PATH` | Yes | Path to a completed `discovery-profile.local.json` (see `apps/venue-connector/docs/discovery-profile.sample.json` and its own operator-runbook Step 2) — required even in cloud mode, since `Program.cs` constructs the Windows automation client unconditionally before branching on mode. |
  | `TRACER_BASE_URL` | Yes (cloud mode) | The Verdura backend's base URL — see Network §2's flagged open decision. |
  | `TRACER_CONNECTOR_CREDENTIAL` | Yes (cloud mode) | The real Story 2-9 `installationId.secret` — see below for how to obtain one. **Never hard-code.** |
  | `IDEALPOS_BRIDGE_BASE_URL` | Yes (cloud mode) | The Bridge's own base URL — `http://127.0.0.1:5588` per its documented default. |
  | `IDEALPOS_BRIDGE_API_KEY` | Yes (cloud mode) | Must equal the Bridge's own `Bridge:ApiKey` (`App.config`). **Never hard-code.** |
  | `IDEALPOS_BRIDGE_TIMEOUT_MS` | No (default 10000) | Per-request Bridge HTTP timeout. |
  | `TRACER_POLL_INTERVAL_MS` | No (default 5000) | DL-095's inter-poll delay. |
  | `TRACER_POLL_ERROR_BACKOFF_MS` | No (default 15000) | DL-095's backoff after a poll failure. |

- **Secrets/config handling:** `TRACER_CONNECTOR_CREDENTIAL` and `IDEALPOS_BRIDGE_API_KEY` are the only
  two secrets. Neither has a default; both fail-fast if unset. Set them as real Windows Service
  environment variables (via the service manager or `Environment.SetEnvironmentVariable` at the
  `Machine` scope before installing the service) — never checked into any file this package produces.
  **This package intentionally contains no real secret value anywhere.**
- **Obtaining `TRACER_CONNECTOR_CREDENTIAL`:** mirrors the tablet-enrollment pattern exactly
  (`apps/api/src/connector/connector-admin.controller.ts`/`connector.service.ts`):
  1. An authenticated Staff account with the `admin` role calls
     `POST /api/venues/{venueId}/connector/enrollments` (requires a valid session/JWT — use the
     disposable backend's own real admin login, not a hard-coded value).
  2. That returns `{ enrollmentId, bootstrapToken, expiresAt }` — the bootstrap token is short-lived
     (15 minutes, same TTL pattern as tablet enrollment) and single-use.
  3. Redeem it: `POST /api/connector/enroll` with `{ "bootstrapToken": "<value>" }` (no auth header —
     this is the device-facing endpoint). Returns `{ installationId, credential }`.
  4. `TRACER_CONNECTOR_CREDENTIAL` = the returned `credential` value verbatim (already formatted as
     `{installationId}.{secret}` — do not reformat it).
  5. Enrolling replaces any prior active installation for that venue (confirmed in
     `connector.service.ts`'s `redeemEnrollment` — one active installation per venue).
- **Logging location:** console only today (`AddSimpleConsole`, DL-095) — **no file or Windows Event
  Log provider exists yet**. As a real installed Windows Service (no attached console), this means
  **there is currently no durable log to inspect after the fact** unless the operator redirects
  console output manually or runs the service in foreground (`--console`-equivalent, i.e. just run the
  built `.exe` directly in a terminal) for this first controlled test. This is a real, flagged gap —
  do not assume logs exist; run in foreground for this test.
- **Service identity requirements:** `AddWindowsService(options => options.ServiceName =
  "VerduraIdealposTracer")` is wired (DL-095) but **has never been installed against a real Windows
  Service Control Manager**. No service-account guidance exists for the Connector (unlike the Bridge's
  own detailed "Which Windows account" section in its README) — for this first controlled test, run
  the built `.exe` interactively in a console window under whatever account is already logged in,
  **do not install it as a Windows Service yet**. Installing as a service is explicitly a later,
  separately-decided step (mirrors the Bridge's own precedent in `install-locations.md`: "Leave the
  Windows Service not installed unless Outcome A... AND a separate, explicit decision is made").

---

## 4. Windows Installation Procedure

### Install
1. Copy `apps/venue-connector` (this repo's own subfolder — self-contained, per its own README) to
   the Windows machine.
2. Confirm the .NET 8 SDK is installed (`dotnet --version`).
3. Build/publish per §3's command. **Record the exact result** (success or the first real compile
   error) — this has never been observed before.
4. Do **not** install as a Windows Service for this first test (see §3's Service identity note).
5. Set the required environment variables (§3's table) for the current console session only
   (`$env:TRACER_MODE = "cloud"`, etc. in PowerShell) — never persist secrets to a file.
6. Configure `discovery-profile.local.json` per the existing Story 9-2 operator runbook
   (`apps/venue-connector/docs/operator-runbook.md` Step 2) — required even though this test's actual
   goal is order submission, not discovery, because `Program.cs` still constructs that dependency
   unconditionally.
7. Start the Connector in the foreground: run the published `.exe` directly in the console (not as a
   service — see §3).

### Verify
- Console output should show the DL-095 startup sequence: `ConnectorPollingLoop[0] Connector polling
  loop starting.`, then `Microsoft.Hosting.Lifetime[0] Application started.` (exact log lines confirmed
  in DL-095's own cross-platform smoke test against the real `Microsoft.Extensions.Hosting` console
  provider — first real confirmation on Windows itself is part of this test).
- No dedicated health-check endpoint exists on the Connector itself (unlike the Bridge's
  `GET /api/health`) — "is it running" is answered by: (a) the console output above, (b) whether it
  successfully polls (visible in its own log lines once a command exists to poll for — §6), and (c)
  `Get-Process` showing the process alive.
- Logs: console only (§3) — keep the window open and visible for the duration of the test.

### Stop
- `Ctrl+C` in the console window — the Generic Host's own `Microsoft.Hosting.Lifetime` shutdown
  sequence handles this (confirmed in DL-095's real-process smoke test: clean shutdown, no hang, exit
  code 0).

### Upgrade
- No safe-replacement procedure exists yet for a real Windows Service install (none is installed for
  this test). For this foreground-only test: `Ctrl+C`, replace the published output directory, restart.
  A real service-upgrade procedure is out of scope until the service is actually installed — do not
  invent one here.

---

## 5. Bridge Preflight Procedure

**Use the existing package as-is** — `docs/table12-preflight/` in `/Users/sarwarkhan/Documents/IdealposBridge`. Do not re-derive it.

### Before execution
- Follow `operator-runbook.md` Phase 0 (Environment gate) and Phase 1 (Safe installation) exactly, in
  order. Key checks: correct disposable Windows host confirmed; the intended test table exists, is
  currently `LikelyOccupied_Heuristic = 0` (`evidence-queries.sql` §0a); the intended test PLU exists
  (`GET /api/products` once the Bridge is up, or `evidence-queries.sql`'s own note on where product
  data actually lives).

### Execution
- Exact script: `windows-package/build-and-package.ps1 -IdealposInstallDir "C:\Program Files
  (x86)\Idealpos Solutions\Idealpos"` (adjust the path to the real install). This copies the real
  vendor DLLs, builds, **runs `--selftest` automatically** (expected: `20 passed, 0 failed` — see
  `README.md`'s "Validation status"), and produces a checksummed build-output manifest. Stop if
  `--selftest` reports any failure.
- Copy `windows-package/sample.App.config` to the install location as `App.config` and fill in every
  `CHANGE_ME`: the disposable SQL Server, a freshly-generated `Bridge:ApiKey` (this is the value
  `IDEALPOS_BRIDGE_API_KEY` must match on the Connector side — §3), and
  `Idealpos:TableAssignmentStrategy` (genuinely unproven — see `table-assignment-review.md`; pick one
  of the five documented strategies for this first attempt, expect to learn from the result, not to
  necessarily get it right the first time).
- Start manually in the foreground (`.\VerduraIdealposBridge.exe --console`) — not as a service, per
  the runbook's own Phase 1 step 8.
- Expected output: `GET /api/health` with `orderProcessingPathAvailable: true` and `reasons: []`
  before proceeding (Phase 1 step 9). If `false`, `reasons` names the exact cause.

**Operator-substitution values** (explicitly marked in the source material itself, not invented here):
the SQL Server target, the `Bridge:ApiKey`, the table Caption/PLU to test against, and the
`TableAssignmentStrategy` choice — all four are `CHANGE_ME`/`<<VERIFY-ON-WINDOWS>>` placeholders in the
existing package, resolved live on the machine, never guessed in advance.

---

## 6. Table 12 End-to-End Validation

Evidence path:

```
Order Tablet → API (Order + POSSyncRecord) → ConnectorCommand (idealpos.submit_order.v1)
  → Venue Connector (poll/claim/execute) → Bridge (POST /api/orders) → IdealPOS
```

### Verdura evidence (capture all of these)
- Order ID (`orders.id`).
- `externalOrderId` sent to the Bridge — **must equal the order ID** (DL-091/094's stable-identity
  invariant; `idealpos-order-payload-mapper.ts`).
- `ConnectorCommand.id`, `commandType` (`idealpos.submit_order.v1`), `schemaVersion` (currently `1` —
  confirmed in `idealpos-order-dispatch.constants.ts`; DL-097 established this predates the dirty
  tree's takeaway-driven schema-version-2 work, which is not part of this reconciled lineage).
- Timestamps: order created, `ConnectorCommand` created, claimed, accepted, terminal report.
- Retry state: `POSSyncRecord.attemptCount`, whether DL-092 (transient retry) or DL-093 (stale-unknown
  recovery) paths were exercised.
- Final `POSSyncRecord.status` and `ConnectorCommand.status`.

### Connector evidence
- Startup log line (§4's "Verify").
- Poll: the console should show activity once a command exists — DL-095's `ConnectorPollingLoop`
  logs `commandId=... type=idealpos.submit_order.v1 ...` per command processed.
- Claim/execution/result: the same log line includes `externalOrderId=`, `reportedOutcome=`, and
  `failClosedReason=` (see `ConnectorPollingLoop.ProcessOneCommandAsync`'s exact log format).

### Bridge evidence
- Request received: Bridge's own `bridge-YYYY-MM-DD.log`, event `order_state_transition`
  (`request-fixture.md`'s own documented expectation).
- Validation result: HTTP status from `POST /api/orders` (`201`/`200 duplicate`/`400`/`502` — see
  `request-fixture.md`'s "Possible non-happy-path outcomes").
- Native write result: `evidence-queries.sql` §1 (`WebPendingOrder` row exists).

### IdealPOS evidence
See §7 — kept separate deliberately.

---

## 7. Native IdealPOS Evidence Requirements

**Do not infer native success from anything in §6.** A Bridge HTTP `201`/`200` proves only that
`LocalDataHelper.InsertOrders()` did not throw — the Bridge's own README states this explicitly, and
DL-094/096/097 have each independently reaffirmed it.

**Native consumption — required evidence, in order of strength:**
1. `evidence-queries.sql` §2: `WebPendingOrder.Processed = 1`, with a real, recent `DateProcessed`
   timestamp set by native Idealpos itself (not the Bridge). The Bridge's own README calls this "the
   only real evidence of native consumption" at the database level.
2. `evidence-queries.sql` §3/§5: a `PendingSales` row correlates (via `Reference`), and its `Code`
   value is compared against the requested table's Caption/Code (the open question DL-097 formalized
   as Bridge-internal, not a Verdura contract question).
3. **Native UI confirmation** (`request-fixture.md`'s own explicit rule): open the real Idealpos
   client, confirm the test table is now active with the submitted item, and have this independently
   confirmed by a second person or a screenshot. Database-level evidence alone is **not** sufficient —
   this is stated as non-optional in the existing material, not added here.

A vendor-confirmed processing state (e.g. Idealpos support/documentation explicitly describing what a
given native state means) would also count as accepted evidence if obtained — none is available today.

---

## 8. Modifier Verification Requirements

**Current status (do not weaken):** `idealpos-order-payload-mapper.ts` fails closed
(`unsupported_modifiers`) on any order carrying a non-empty modifier selection — confirmed in DL-094's
independent review and unchanged since. **This controlled test's order must be modifier-free by
construction.** If a modifier-bearing order is accidentally used, the expected result is that no
`ConnectorCommand` is ever created at all (the mapping fails before that point) — not a Bridge-side
error, not a native rejection.

**What would be required before this can change** (not attempted in this test):
- A modifier-bearing test item, submitted only after the above passes with a plain item.
- A documented expectation of what native Idealpos *should* do with a modifier (currently unknown —
  no vendor documentation or prior evidence exists for this).
- Observed IdealPOS behaviour compared against that expectation, captured with the same rigor as §7
  (native UI confirmation, not database inference).
- Only once that comparison is made and understood should the fail-closed mapper be reconsidered — and
  only as a separate, explicitly-scoped follow-up story, never as a byproduct of this test.

---

## 9. KOT Verification Requirements

Kept strictly separate, per DL-096's own finding that **zero KOT instrumentation exists anywhere** in
either the Connector or the Bridge today (no endpoint, no query, no log event for kitchen-ticket
state).

### KOT generation
- Required evidence: a native Idealpos KOT/kitchen-ticket record actually created. **No mechanism
  currently exists to observe this** via either project's own API or logs — this would require either
  a native database table this investigation has not identified, or direct observation via the
  Idealpos UI at the kitchen-display/print-queue screen, if one exists.

### Physical printing
- Required evidence: the printer physically received the job **and** produced paper output. Purely
  human observation at the physical printer — no software evidence is possible for this today.

**Do not treat any of the following as equivalent to physical printing:** order acceptance (§6/§7),
a `WebPendingOrder`/`PendingSales` database row (§7), or KOT generation itself (a generated KOT is not
proof it printed). Each is its own evidence tier, exactly as this section's own boundary requires.

---

## 10. Rollback Procedure

### Before the test
- Capture current state: `evidence-queries.sql` §0a/§0b (table/PLU state before submission), Bridge
  `/api/health` output, Connector console log start.

### If failure
1. Stop the Connector (Ctrl+C in its console — §4).
2. Stop the Bridge (Ctrl+C in its console — Bridge runbook Phase 4 step 4).
3. Revert artifact: delete the Connector's published output directory; delete
   `C:\Program Files\Verdura\IdealposBridge\` (Bridge's own `install-locations.md` "Uninstall /
   rollback" — safe, contains only this build's own binaries and copied vendor DLLs, never touches the
   real Idealpos installation).
4. Restore configuration: no persistent Windows config was created for the Connector (env vars were
   session-scoped only, §4); optionally delete the Bridge's `C:\ProgramData\Verdura\IdealposBridge\`
   only after extracting needed evidence (same source's own stated default: leave it unless you're
   done with it).
5. Confirm no stuck commands: `ConnectorCommand` status via the disposable backend's own admin surface
   should reach a terminal state, or be left `unknown` for DL-093's own bounded recovery to handle
   later — never manually forced.
6. Confirm no duplicate orders: `evidence-queries.sql` §6 (`WebPendingOrderRowCount`/
   `PendingSalesRowCount` both `= 1`) — matches the existing package's own Phase 3 replay-safety check.
7. Confirm the venue returns to normal: void/cancel the test order through the **real Idealpos UI**
   (never via SQL — Bridge runbook Phase 4 step 1), confirm the test table returns to
   inactive/empty (`evidence-queries.sql` §0a again).

---

## 11. Failure Classification

| Observation | Classification | Do not... |
|---|---|---|
| Connector process won't start (crash, missing env var) | Connector/deployment issue | ...touch the Bridge or IdealPOS. |
| Connector starts but never polls | Connector/deployment issue (check `TRACER_BASE_URL`/`TRACER_CONNECTOR_CREDENTIAL`) | ...assume the backend or Bridge is at fault without checking Connector logs first. |
| Connector polls/claims but Bridge call fails to connect | Network/Bridge-availability issue | ...assume IdealPOS itself is unreachable — Bridge may simply not be running yet. |
| Bridge rejects the request (`400`) | Bridge contract/config issue (wrong table Caption or PLU — see `request-fixture.md`) | ...retry blindly; fix the fixture value first. |
| Bridge accepts (`201`/`200`) but `WebPendingOrder.Processed` never reaches `1` | Native consumption issue | ...treat the Bridge's `201` as proof of anything past its own boundary. |
| `WebPendingOrder.Processed = 1` but `PendingSales.Code` doesn't match the requested table | Table-assignment/native translation issue (the DL-097-flagged Bridge-internal question) | ...conclude Verdura's own `Table.posTableCode` contract is wrong — DL-097 already closed that question. |
| IdealPOS receives the order but a modifier is wrong | Not reachable in this test — modifiers are fail-closed (§8); if this is somehow observed, treat it as a Bridge/mapper defect requiring its own investigation, not a native-compatibility footnote. |
| KOT missing | Native/KOT issue — but note §9: no instrumentation exists to even confirm this was attempted; do not classify without first confirming what evidence is actually available. |

**Do not debug across a boundary without evidence from that exact boundary.** Each row above stops at
the first unproven layer.

---

## 12. Evidence Capture Template

```text
Date:
Venue (disposable/test only):
Operator:
Connector version (git SHA):
Bridge version (git SHA / build manifest checksum):
IdealPOS version/build (Help → About, typed by hand):

Test order ID:
externalOrderId:
ConnectorCommand ID:
Table Caption tested:
PLU(s) tested:
TableAssignmentStrategy used:

Result (Connector evidence — §6):
Result (Bridge evidence — §6):
Result (Native consumption — §7):
Result (Table-assignment match — §7):
Result (Modifier test — §8, expect: not attempted, fail-closed):
Result (KOT generation — §9):
Result (Physical print — §9):

Evidence links/files (screenshots, log excerpts, query output — never a full-desktop screenshot,
never a credential/connection-string/API-key value):

Failures:

Classification (per §11):

Resolution / next step:

Rollback performed (Y/N, and confirmation per §10 steps 5-7):
```

---

## 13. Production Readiness Update

| Item | Status |
|---|---|
| Validation package prepared | **YES** |
| Native proof | **NOT YET VERIFIED** |
| Hardware access | **REQUIRED** |

No other production-readiness ledger entries are changed by this task. This is a planning artifact,
not new evidence.
