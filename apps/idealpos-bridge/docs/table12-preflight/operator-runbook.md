# Table 12 controlled experiment — Windows operator runbook

Prepared 2026-08-19 during a macOS preflight (no SSH/Windows access this
session). Everything in this runbook that could be verified without a real
Windows machine has been; everything below marked **[ON WINDOWS]** is a
step this runbook could not execute and must be run for real tomorrow.

Companion documents in this folder:
- `request-fixture.md` — the exact controlled request template
- `evidence-queries.sql` — read-only, parameterized SQL evidence queries
- `table-assignment-review.md` — the open table-Code-vs-Caption question
- `windows-package/` — build script, checksum manifest, sample config,
  install locations

---

## Phase 0 — Environment gate [ON WINDOWS]

Do not proceed past this section until every check passes.

1. **Confirm this is the approved disposable Windows 11 host** — not a
   production machine. Confirm with whoever granted SSH access if there is
   any doubt.
2. `hostname`, `[System.Environment]::OSVersion`, `[System.Environment]::Is64BitOperatingSystem`
   — record these for the final evidence report.
3. Confirm the Idealpos installation and version:
   ```powershell
   Get-Content "C:\Program Files (x86)\Idealpos Solutions\Idealpos\FrameworkVersion.txt"
   ```
   The local reference copy checked during this preflight
   (`/Users/sarwarkhan/Documents/Idealpos Solutions/Idealpos` on the
   preflight machine) was **v6.05.0001**. Record whatever the real
   disposable machine reports — if it differs meaningfully, re-read
   `table-assignment-review.md`'s note on version-specific behaviour before
   assuming any finding transfers across versions.
4. Confirm the SQL Server target: which instance/database `App.config`'s
   `IpsConnection` will point at, and that it is the disposable test
   instance, not anything live. **Stop if this cannot be confirmed with
   certainty.**
5. Confirm Idealpos services/processes:
   ```powershell
   Get-Process IPS -ErrorAction SilentlyContinue
   Get-Service IdealposService, IdealposUpgradeService -ErrorAction SilentlyContinue
   ```
6. Run `evidence-queries.sql` section `0a` — confirm the intended test
   table exists, note its `Caption` vs `Code` (see
   `table-assignment-review.md`), and confirm it is currently
   empty/inactive (`LikelyOccupied_Heuristic = 0`). **Stop if the table is
   occupied** — pick a different table or wait.
7. Run `GET /api/products` (once the bridge is up, see Phase 1) or query
   the stock-item source directly to confirm your intended test PLU(s)
   exist, and record their expected name/price for later comparison.
8. Confirm you personally can observe the result (SSMS/sqlcmd access to
   the DB, and either physical/remote-desktop access to the real Idealpos
   client UI or someone who does) and can clean up afterward (void/cancel
   via the Idealpos UI — see Phase 4 below). **Stop if either is not
   available.**

**Additional stop conditions** (from the governing task, restated here for
a single checklist):
- Listener would be unauthenticated or publicly exposed — not possible
  with this codebase as reviewed (every route requires the API key,
  `Bridge:AllowLan` defaults false and requires an explicit second flag —
  see the Phase 2 findings below) unless you deliberately misconfigure it;
  confirm `App.config` matches `sample.App.config`'s loopback defaults.
- Vendor files could be overwritten — will not happen if you follow
  `windows-package/install-locations.md` exactly (install directory is
  `C:\Program Files\Verdura\IdealposBridge`, never inside the Idealpos
  tree).
- Schema changes would be required — none are; this bridge is read-only
  except for `LocalDataHelper.InsertOrders()`, confirmed by full source
  review (see "Independent review summary" below).
- Logs would expose credentials — confirmed not to happen by source review
  of `Logging/Logger.cs` and every call site (see below); still worth a
  spot-check of the first log file produced tomorrow.

---

## Phase 1 — Safe installation [ON WINDOWS]

1. Copy this repository to the Windows machine (however SSH/file transfer
   is provided). Verify `windows-package/source-manifest-sha256.txt`
   against the copied source — see that file's own header for the exact
   command. **Stop if any hash mismatches** and investigate before
   proceeding.
2. Run `windows-package/build-and-package.ps1 -IdealposInstallDir "C:\Program Files (x86)\Idealpos Solutions\Idealpos"`
   (adjust the path to the real install). This verifies the source
   manifest again, copies the real vendor DLLs, builds, **runs
   `--selftest` automatically** (the first real execution of this
   project's pure-logic test suite — could not happen in the macOS
   preflight), and produces a checksummed build-output manifest. **Stop if
   `--selftest` reports any failure.**
3. Copy the packaged output (`windows-package\dist\`) to
   `C:\Program Files\Verdura\IdealposBridge\` — see
   `windows-package/install-locations.md`.
4. Copy `windows-package/sample.App.config` to
   `C:\Program Files\Verdura\IdealposBridge\App.config` and fill in every
   `CHANGE_ME`: the disposable SQL Server, a freshly-generated `Bridge:ApiKey`,
   and the `Idealpos:TableAssignmentStrategy` you intend to try first (see
   `table-assignment-review.md`).
5. Restrict NTFS permissions on that `App.config` (own account +
   Administrators only, per `install-locations.md`).
6. Create `C:\ProgramData\Verdura\IdealposBridge\state\` and `\logs\`
   (or let the bridge create them on first run — `BridgeConfig`/`Logger`
   both call `Directory.CreateDirectory`).
7. Confirm no other process is already bound to port 5588:
   `Get-NetTCPConnection -LocalPort 5588 -ErrorAction SilentlyContinue`.
8. Start manually in the foreground (NOT the Windows Service — see
   `install-locations.md`):
   ```powershell
   cd "C:\Program Files\Verdura\IdealposBridge"
   .\VerduraIdealposBridge.exe --console
   ```
9. In a second window, verify health:
   ```powershell
   $key = "<the Bridge:ApiKey you set>"
   Invoke-RestMethod -Uri "http://127.0.0.1:5588/api/health" -Headers @{ Authorization = "Bearer $key" } | ConvertTo-Json -Depth 5
   ```
   Require `orderProcessingPathAvailable: true` and `reasons: []` before
   continuing. If `false`, read `reasons` — it will name exactly which of
   SQL/assemblies/`IPS.exe` is the problem (see `AvailabilityChecker.cs`).
10. Confirm the response never contains the connection string, API key, or
    any credential — spot-check by eye. Confirmed by source review that it
    structurally cannot (`HealthEndpoint.Handle` only ever serializes the
    typed `HealthReport` fields), but a live check costs nothing.

---

## Phase 2 — Controlled test [ON WINDOWS]

1. **Before-state**: run `evidence-queries.sql` sections `0a`/`0b` fresh
   (values may have changed since Phase 0), and record bridge
   version/health from step 9 above.
2. Fill in `request-fixture.md`'s template with real, freshly-verified
   values. Do not reuse any example PLU/table from this repository's
   `README.md`/`examples/` without confirming it against the live
   database first.
3. Submit exactly once:
   ```powershell
   $body = Get-Content .\filled-in-request.json -Raw
   Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:5588/api/orders" `
     -Headers @{ Authorization = "Bearer $key" } -ContentType "application/json" -Body $body
   ```
4. Record: sanitized request, HTTP status, full response body, timestamps.
5. Poll `GET /api/orders/{externalOrderId}` (or watch `ws://127.0.0.1:5588/ws/orders?api_key=<key>`)
   until a terminal-ish state is reached (`assigned_to_table`, `rejected`,
   `failed`, or `uncertain` — see `request-fixture.md`'s expected
   progression). Record the timestamp of each transition and the bridge's
   own log line for it (`bridge-YYYY-MM-DD.log`, event
   `order_state_transition`).
6. Run `evidence-queries.sql` sections `1`–`5` in order, recording each
   result. Section 3's `PendingSales.Code` vs the requested table is the
   central fact of this whole experiment.
7. **Native UI confirmation** — open the real Idealpos client, confirm
   Table 12 (or your test table) is now active, open it, confirm the
   submitted item/quantity appear, and take a screenshot or have a second
   person independently confirm. This is NOT optional even if the DB-level
   check in step 6 already passed — see `request-fixture.md`'s explicit
   rule that `PendingSales.Code` matching does not by itself prove UI
   visibility.
8. Compare price/tax as displayed by Idealpos against nothing this bridge
   ever claims (it doesn't return price/tax) — that comparison is
   native-Idealpos-vs-your-own-expectation only, not bridge-vs-Idealpos.

### Outcome handling

Follow `table-assignment-review.md`'s outcome-specific sections exactly.
Do not iterate rapidly — each new order should use a fresh
`externalOrderId`/timestamp and should only happen once the previous one's
outcome is understood.

---

## Phase 3 — Replay / duplicate safety [ON WINDOWS]

Only after Phase 2 fully resolves (do not run this while an order is still
`uncertain`):

1. Resubmit the EXACT SAME request body (same `externalOrderId`) once.
2. Confirm the response has `"duplicate": true` and the SAME `status`/IDs
   as the original — not a fresh `201`.
3. Re-run `evidence-queries.sql` section `6` — both counts must still be
   exactly `1`. **Any count > 1 is a real, serious finding** — stop
   testing immediately and escalate; do not submit anything further until
   understood.

---

## Phase 4 — Cleanup [ON WINDOWS]

1. Void/cancel the test order through the **normal Idealpos UI** — the
   same way staff would void any test/mistaken order. Do not attempt this
   via SQL.
2. Confirm Table 12 (or your test table) returns to inactive/empty in both
   the UI and `evidence-queries.sql` section `0a`.
3. Do not delete any `WebPendingOrder`/`PendingSales`/`PendingSaleLines`
   row directly — those are the audit evidence for this experiment; voiding
   through the UI is expected to leave a normal Idealpos-side trail, which
   is fine and expected.
4. Stop the bridge (`Ctrl+C` in the foreground console).
5. Confirm no EFTPOS/payment action occurred at any point (nothing in this
   bridge can initiate one — confirmed by source review — but this is
   still worth a positive confirmation against the terminal/Idealpos UI).
6. If you changed any temporary Windows Firewall/network config to reach
   the bridge, revert it now (none should have been needed for a loopback
   test).
7. Leave the Windows Service **not installed** unless Outcome A (full
   success, see below) was reached AND a separate, explicit decision is
   made to proceed to persistent operation.

---

## Independent review summary (Phase 2 of the governing task, condensed)

Full source review completed 2026-08-19 (every `.cs`/`.config`/`.ps1`/`.md`
file in the repository read in full). Findings:

| Severity | Finding | Status |
|---|---|---|
| P0 | `.csproj` explicitly globbed `**/*.cs` in an SDK-style project that already does this by default → `dotnet build` failed unconditionally (`NETSDK1022`), on any platform including Windows, before this preflight. | **Fixed** — redundant `<Compile Include>` removed. |
| P0 | `LocalDataHelper.InsertOrders()`'s real signature (confirmed via reflection against the real `IdealPos.Webit.Core.dll`, Idealpos v6.05.0001) returns `void`, not `int` as the bridge's own code assumed — would not compile against the real assembly at all. | **Fixed** — call site corrected, the fabricated `OrderSubmissionResult.RowsInserted` field (which depended on a return value that doesn't exist) removed. |
| P1 | A stale-timeout collapsed an order straight to `failed` even when `WebPendingOrder.Processed=1` had already been confirmed (i.e. native Idealpos definitely consumed the order) — a false claim of confirmed non-execution. | **Fixed** — new `uncertain` terminal status, used for all three timeout branches, carrying an explicit evidence note. |
| P2 | The `table` request field is validated against `TableMapSetups.Caption` (string) but is expected to ultimately need to match `.Code` (int) for `PendingSales.Code` — unproven, venue/version-specific. | **Documented**, not code-changed — see `table-assignment-review.md`; requires live evidence tomorrow. |
| P3 | `IdealposReadRepository.GetPendingSaleLines()` exists but isn't wired into the watcher/API response — line items aren't visible via the bridge's own API today. | **Documented** — `evidence-queries.sql` section 4 is the actual evidence source for tomorrow; not fixed (would be new functionality, out of this preflight's "do not redesign unrelated components" boundary). |
| — (no finding) | Hardcoded Table 12, hardcoded credentials, plaintext secrets in code, unauthenticated endpoints, permissive `0.0.0.0` binding, SQL injection, direct `PendingSales`/`WebPendingOrder` writes, Idealpos schema creation/alteration, swallowed exceptions of consequence, "success" claimed before native consumption beyond the already-documented `submitted_to_idealpos` ≠ `processed` distinction, "latest row" correlation used as sole evidence (the fallback in `evidence-queries.sql` §3b is explicitly labeled non-authoritative), fabricated Idealpos references, production-pointing defaults. | **None found** — every check in the governing task's Phase 2 search list was performed against the actual source; see the full file-by-file read log in this session's transcript. |

No P0/P1 remains unresolved. All fixes verified by a real `dotnet build -c Release`
against the real vendor DLLs (0 errors, 0 warnings) — see
`README.md`'s "Validation status" section for the exact assembly identity
this was checked against.
