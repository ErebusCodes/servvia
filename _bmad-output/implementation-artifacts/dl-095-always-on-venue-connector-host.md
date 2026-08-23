# Implementation notes: Always-On Venue Connector Host (DL-095)

Continues the 2026-08-23 Order Tablet → IdealPOS reconciliation (DL-094) on branch
`order-tablet-idealpos-reconciled`, worktree `/private/tmp/verdura-order-tablet-reconcile`.

## Problem

`VerduraIdealposTracer.Cli` (`apps/venue-connector/src/VerduraIdealposTracer.Cli/Program.cs`) —
the real, production-wired entry point for `idealpos.submit_order.v1` delivery — polled the backend
exactly once per process launch, processed only the first command of up to `MAX_POLL_BATCH=5` the
server returns, and exited within a hard 30-second `CancellationTokenSource`. Operationalizing this
required either a human re-launching it by hand or an external scheduler this repo never built.

## Investigation findings

- **Project layout:** `VerduraIdealposTracer.Core` (net8.0, cross-platform, in the default
  `VerduraIdealposTracer.slnx`) owns the discovery state machine, the Story 2-10 protocol client
  (`ConnectorCommandProtocolClient`), local durable persistence, and the order-submission handler
  (`IdealposOrderSubmissionService`). `VerduraIdealposTracer.Cli` (net8.0-windows, intentionally
  excluded from the default solution) is a thin composition root wiring the real Windows automation
  client to Core.
- **Existing lifecycle:** both `DiscoveryTracerService.RunCloudModeAsync` and
  `IdealposOrderSubmissionService.RunCloudModeAsync` already implement the full
  claim/accept/execute/report cycle per command, statelessly (no in-memory state carried between
  calls) — already suitable for calling repeatedly from a loop, unchanged.
- **Concurrency/duplicate-delivery protection already exists server-side**, not client-side:
  `connector-command.service.ts`'s `poll()` claims commands via an atomic, lease-based `updateMany`
  (`CLAIM_LEASE_MS = 2 minutes`), and `accept()` is a CAS `updateMany` scoped to
  `(id, status: claimed, claimedByInstallationId)` — a losing race throws `ConflictException`
  (surfaced to this client as a non-2xx HTTP status). This client only ever consumes that protocol; it
  was never reimplemented here.
- **A real, previously-unaddressed inefficiency:** `poll()` returns (and claims) up to 5 commands, but
  the old single-shot `Program.cs` only ever processed `poll.Commands.FirstOrDefault()` — any
  additional claimed command sat unprocessed until its 2-minute lease expired. Processing every
  command a poll batch returns is a natural, correct consequence of the always-on loop design, not a
  separately-scoped fix.
- **Tests project (`VerduraIdealposTracer.Tests`) already established the fake-`HttpMessageHandler`
  pattern** for both the protocol endpoints and the Bridge contract (`ConnectorCommandProtocolClientTests`,
  `IdealposOrderSubmissionServiceTests`) — reused verbatim for the new loop tests, no new test
  infrastructure invented.
- **Assumption rejected:** that the Cli itself would need a rewrite. It does not — only its
  composition root changes; the entire command-execution surface (`IdealposOrderSubmissionService`,
  `DiscoveryTracerService`, `IdealposBridgeClient`, `ConnectorCommandProtocolClient`) is untouched.

## Design

- **New: `VerduraIdealposTracer.Core.Hosting.ConnectorPollingLoop`** (cross-platform, no new package
  dependency on Core) — `RunAsync(CancellationToken)` loops: poll, process every returned command via
  the existing `RunCloudModeAsync` methods, sleep `pollInterval`, repeat; a poll failure logs and backs
  off `errorBackoff` before retrying; a per-command exception (including a losing accept-claim race) is
  caught, logged, and never stops the loop or affects another command. Logs through a tiny
  `IConnectorHostLog` interface (`Info`/`Warning`/`Error`) so Core stays free of any logging-framework
  dependency.
- **`VerduraIdealposTracer.Cli/Program.cs`:** local mode (discovery dry-run/real-discovery diagnostic)
  is unchanged. Cloud mode now bootstraps a .NET Generic Host
  (`Host.CreateApplicationBuilder` + `Microsoft.Extensions.Hosting.WindowsServices.AddWindowsService`),
  registers the existing services plus the new `ConnectorPollingLoop` and a thin `BackgroundService`
  wrapper, and runs until the host's own shutdown signal (Ctrl+C, SIGTERM, or a Windows Service Control
  Manager stop) — no bounded 30-second timeout in cloud mode any more. New optional env vars
  `TRACER_POLL_INTERVAL_MS` (default 5000) and `TRACER_POLL_ERROR_BACKOFF_MS` (default 15000), same
  optional-with-service-default convention as the existing `IDEALPOS_RETRY_*` knobs.
- **`IConnectorHostLog` → `ILogger` adapter (`LoggerConnectorHostLog`)** lives in `Program.cs` (Cli
  only) so Core's dependency-free logging interface still reaches the host's real structured logging
  (`Microsoft.Extensions.Logging`, console provider with timestamps in the wired configuration).

## Explicitly out of scope this commit

- No change to `IdealposOrderSubmissionService`, `DiscoveryTracerService`, `IdealposBridgeClient`,
  `ConnectorCommandProtocolClient`, or any server-side connector-command protocol code.
- No new retry/backoff semantics beyond what DL-092/DL-093 already established at the command level —
  this only adds the *loop* around already-correct per-command handling.
- No attempt to reconcile or graft anything from main's dirty-tree `IdealposOrderReconciliationService`
  (DL-094 already excluded it).
- No native modifier, payment, billing, or KOT logic.
- No installation script/NSSM config/Windows Service install documentation — deploying this as an
  actual running Windows Service on the target venue machine is a separate, hardware-access-gated step.

## Verification

- **Unit (cross-platform, `dotnet test` on `VerduraIdealposTracer.slnx`):** 10 new tests in
  `ConnectorPollingLoopTests.cs` — start/stop lifecycle, prompt cancellation mid-inter-poll-delay,
  successful submission (stable `externalOrderId`), deterministic Bridge rejection, transient Bridge
  unavailability, poll-level network failure with backoff-and-recover, duplicate command redelivery
  across two polls (same `externalOrderId` both times), a multi-command poll batch (each command
  processed exactly once, an unrecognized type left unclaimed), a losing accept-claim race (409 →
  caught, logged, loop survives), and restart recovery (a fresh loop instance, no shared state,
  still processes a pre-existing pending command). Full regression: **65/65 passing** (was 55/55
  before this change) — zero failures, zero reduced coverage.
- **Real-process smoke test (not an automated regression test — see limitation below):** a throwaway,
  non-shipped harness outside the repo (`/private/tmp/.../scratchpad/program-verify`), identical to
  the real `Program.cs` except the Windows-only automation client is swapped for the existing
  `FakeIdealposUiAutomationClient` test fixture (the only line that differs), run as a genuinely
  separate OS process. Confirmed: real structured startup logs; real `HttpRequestException` (connection
  refused) handled as repeated, non-fatal, backed-off poll failures; a real `SIGTERM` produces a clean
  Generic Host shutdown sequence and process exit with no hang and no unhandled exception.
- **Environment limitation (pre-existing, confirmed unrelated to this change):** the real
  `VerduraIdealposTracer.Cli` (`net8.0-windows`) cannot be built on this non-Windows machine — MSBuild
  aborts before reaching Cli's own compilation because its `ProjectReference` to
  `VerduraIdealposTracer.Windows` fails first (`System.Windows.Automation` unavailable outside
  Windows). Verified this failure is byte-identical, same file, same lines, before and after this
  change — not introduced by it.

## Evidence tier

UNIT_OR_MOCK for the loop/hosting behaviour itself. This work does **not** touch, and does not change
the truth of: native IdealPOS consumption, native modifier handling, KOT generation, or physical
printing. All four remain **NOT YET VERIFIED**, exactly as DL-094 left them, pending real Table
12/Windows/IdealPOS hardware access (DL-064). An always-on software host is operational readiness, not
hardware evidence.
