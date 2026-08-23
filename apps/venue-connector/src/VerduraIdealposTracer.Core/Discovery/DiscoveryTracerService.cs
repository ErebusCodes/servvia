using VerduraIdealposTracer.Core.Automation;
using VerduraIdealposTracer.Core.Persistence;
using VerduraIdealposTracer.Core.Protocol;

namespace VerduraIdealposTracer.Core.Discovery;

/// <summary>Optional hook a caller can use to force process termination at an exact, named point — used only by crash-window tests/tooling, never by production code (default is a no-op).</summary>
public delegate void CrashHook(string phase);

/// <summary>
/// Orchestrates one discovery-only tracer run. This class never contacts
/// Idealpos for anything beyond process detection, UI-profile matching,
/// safe-state checking, and ONE harmless, reversible navigation — it never
/// selects a table, enters an item, or saves anything. See
/// <see cref="DiscoveryTraceResult.AssertDiscoveryOnlyInvariant"/> for the
/// structural backstop against ever claiming otherwise.
/// </summary>
public sealed class DiscoveryTracerService(
    IIdealposUiAutomationClient automationClient,
    IdealposVerifiedProfile expectedProfile,
    DurableLocalLog localLog,
    ConnectorCommandProtocolClient? cloudClient = null,
    CrashHook? crashHook = null)
{
    private readonly CrashHook _crashHook = crashHook ?? (_ => { });

    /// <summary>
    /// The command type this service handles, following the existing
    /// dotted/versioned convention (Story 9-2's Dev Agent Record explains
    /// why discovery reuses this command type rather than a dedicated one).
    /// Story 15-5 introduced the first real command-type dispatch point in
    /// <c>Program.cs</c> — poll once, then route by this constant vs
    /// <c>IdealposOrderSubmissionService.CommandType</c> — so this class no
    /// longer polls for itself.
    /// </summary>
    public const string CommandType = "connector.self_test.v1";

    /// <summary>
    /// Cloud mode: given a command already claimed by the caller's single
    /// poll this tick (see the class doc comment on the dispatch point),
    /// authenticates as the real Story 2-9 connector identity, accepts it
    /// via Story 2-10's real command protocol, and reports a truthful
    /// discovery-only result back. The caller is responsible for verifying
    /// <paramref name="command"/>.CommandType equals <see cref="CommandType"/>
    /// before calling this — this method does not re-check it.
    /// </summary>
    public async Task<DiscoveryTraceResult> RunCloudModeAsync(ClaimedCommand command, CancellationToken cancellationToken)
    {
        if (cloudClient is null)
        {
            throw new InvalidOperationException(
                "Cloud mode requires a ConnectorCommandProtocolClient — use RunLocalModeAsync for the isolated tracer mode.");
        }

        var startedAt = DateTimeOffset.UtcNow;

        // Persist BEFORE reporting acceptance — the same persist-before-ack
        // ordering Story 2-10's own harness proves for the self-test
        // command, applied here to the discovery envelope too.
        localLog.AppendDurable(new { type = "claimed", commandId = command.Id, ts = startedAt });
        _crashHook("local_persist");

        await cloudClient.AcceptAsync(command.Id, cancellationToken);
        _crashHook("accept_sent");

        var result = await RunDiscoveryAsync(command.Id, startedAt, cancellationToken);

        localLog.AppendDurable(new { type = "terminal", commandId = command.Id, result, ts = DateTimeOffset.UtcNow });
        _crashHook("terminal_persist");

        await cloudClient.ReportAsync(
            command.Id,
            new ReportRequest(
                Outcome: result.FailClosedReason is null ? "succeeded" : "failed",
                ResultType: "IDEALPOS_UI_DISCOVERY_V1",
                ResultPayload: ToSanitizedPayload(result),
                IdempotencyKey: $"discovery-report-{command.Id}",
                FailureReason: result.FailClosedReason),
            cancellationToken);

        return result;
    }

    /// <summary>
    /// Isolated local mode: no cloud credential, no network call at all.
    /// For on-machine validation before wiring cloud connectivity, and for
    /// this story's own cross-platform crash/replay tests.
    /// </summary>
    public async Task<DiscoveryTraceResult> RunLocalModeAsync(string localCommandId, CancellationToken cancellationToken)
    {
        var startedAt = DateTimeOffset.UtcNow;
        localLog.AppendDurable(new { type = "claimed", commandId = localCommandId, ts = startedAt });
        _crashHook("local_persist");

        var result = await RunDiscoveryAsync(localCommandId, startedAt, cancellationToken);

        localLog.AppendDurable(new { type = "terminal", commandId = localCommandId, result, ts = DateTimeOffset.UtcNow });
        _crashHook("terminal_persist");

        return result;
    }

    private async Task<DiscoveryTraceResult> RunDiscoveryAsync(
        string commandId, DateTimeOffset startedAt, CancellationToken cancellationToken)
    {
        var diagnostics = new List<string>();

        // ── Step 1: process detection ──
        IdealposProcessSnapshot? process;
        try
        {
            process = await automationClient.DetectIdealposProcessAsync(cancellationToken);
        }
        catch (Exception ex)
        {
            diagnostics.Add($"Process detection threw: {ex.GetType().Name}");
            return Finish(commandId, startedAt, diagnostics,
                processDetected: TracerOutcomeState.FailedClosed,
                failReason: "Process detection failed (insufficient permissions or automation error) — see diagnostics.");
        }

        if (process is null)
        {
            diagnostics.Add("Idealpos process not detected.");
            return Finish(commandId, startedAt, diagnostics,
                processDetected: TracerOutcomeState.FailedClosed,
                failReason: "Idealpos process not running.");
        }
        diagnostics.Add($"Idealpos process detected: {process.ProcessName} (interactive session: {process.IsInteractiveSession}).");

        // ── Step 2: UI profile match (still before any mutating action — failures here are retryable/fail-closed, never Uncertain) ──
        IdealposUiProfileMatchResult profileMatch;
        try
        {
            profileMatch = await automationClient.MatchUiProfileAsync(process, expectedProfile, cancellationToken);
        }
        catch (IdealposControlNotFoundException ex)
        {
            diagnostics.Add(ex.Message);
            return Finish(commandId, startedAt, diagnostics,
                processDetected: TracerOutcomeState.Detected,
                profileMatched: TracerOutcomeState.FailedClosed,
                failReason: "Expected control not found while matching UI profile — refusing to proceed.");
        }
        catch (IdealposControlAmbiguousException ex)
        {
            diagnostics.Add(ex.Message);
            return Finish(commandId, startedAt, diagnostics,
                processDetected: TracerOutcomeState.Detected,
                profileMatched: TracerOutcomeState.FailedClosed,
                failReason: "Ambiguous control match while matching UI profile — refusing to proceed.");
        }

        if (!profileMatch.Matched)
        {
            diagnostics.Add($"UI profile mismatch: {profileMatch.MismatchReason}");
            return Finish(commandId, startedAt, diagnostics,
                processDetected: TracerOutcomeState.Detected,
                profileMatched: TracerOutcomeState.FailedClosed,
                failReason: $"UI profile did not match the verified profile: {profileMatch.MismatchReason}");
        }
        diagnostics.Add("UI profile matched the verified, versioned profile.");

        // ── Step 3: safe-state check — modal dialogs, locked session, busy state ──
        IdealposUiState uiState;
        try
        {
            uiState = await automationClient.ReadCurrentUiStateAsync(cancellationToken);
        }
        catch (Exception ex)
        {
            diagnostics.Add($"UI state read threw: {ex.GetType().Name}");
            return Finish(commandId, startedAt, diagnostics,
                processDetected: TracerOutcomeState.Detected,
                profileMatched: TracerOutcomeState.Matched,
                failReason: "Could not safely read UI state before proceeding — refusing to interact.");
        }

        if (uiState.IsSessionLocked)
        {
            diagnostics.Add("Windows session is locked.");
            return Finish(commandId, startedAt, diagnostics,
                processDetected: TracerOutcomeState.Detected,
                profileMatched: TracerOutcomeState.Matched,
                failReason: "Windows session is locked — refusing to interact.");
        }
        if (uiState.HasModalDialogOpen)
        {
            diagnostics.Add("An unexpected modal dialog is open.");
            return Finish(commandId, startedAt, diagnostics,
                processDetected: TracerOutcomeState.Detected,
                profileMatched: TracerOutcomeState.Matched,
                failReason: "An unexpected modal dialog is open — refusing to interact.");
        }
        if (uiState.IsBusy)
        {
            diagnostics.Add("Idealpos reports a busy state.");
            return Finish(commandId, startedAt, diagnostics,
                processDetected: TracerOutcomeState.Detected,
                profileMatched: TracerOutcomeState.Matched,
                failReason: "Idealpos is busy — refusing to interact this run.");
        }
        diagnostics.Add($"UI state clear (window title: \"{uiState.MainWindowTitle}\").");

        // ── Step 4: exactly one harmless, reversible navigation — the ONLY
        // point in this tracer that touches the live UI at all. Everything
        // at or after this point that fails becomes Uncertain, never
        // FailedClosed and never silently retried — mirroring idealpos.md
        // §16's crash-window boundary exactly. ──
        try
        {
            var navResult = await automationClient.PerformHarmlessNavigationAsync(cancellationToken);
            if (!navResult.Completed)
            {
                diagnostics.Add($"Harmless navigation did not complete: {navResult.Description}");
                return Finish(commandId, startedAt, diagnostics,
                    processDetected: TracerOutcomeState.Detected,
                    profileMatched: TracerOutcomeState.Matched,
                    interactionAttempted: TracerOutcomeState.Uncertain,
                    failReason: "Harmless navigation did not complete — outcome uncertain, not retried automatically.");
            }
            if (!navResult.Verified)
            {
                diagnostics.Add($"Harmless navigation completed but could not be verified: {navResult.Description}");
                return Finish(commandId, startedAt, diagnostics,
                    processDetected: TracerOutcomeState.Detected,
                    profileMatched: TracerOutcomeState.Matched,
                    interactionAttempted: TracerOutcomeState.Uncertain,
                    failReason: "Harmless navigation completed but could not be verified — outcome uncertain.");
            }

            diagnostics.Add($"Harmless navigation confirmed: {navResult.Description}");
            return Finish(commandId, startedAt, diagnostics,
                processDetected: TracerOutcomeState.Detected,
                profileMatched: TracerOutcomeState.Matched,
                interactionAttempted: TracerOutcomeState.Confirmed,
                failReason: null);
        }
        catch (OperationCanceledException)
        {
            diagnostics.Add("Harmless navigation timed out.");
            return Finish(commandId, startedAt, diagnostics,
                processDetected: TracerOutcomeState.Detected,
                profileMatched: TracerOutcomeState.Matched,
                interactionAttempted: TracerOutcomeState.Uncertain,
                failReason: "Harmless navigation timed out — outcome uncertain, not retried automatically.");
        }
        catch (Exception ex)
        {
            diagnostics.Add($"Harmless navigation threw: {ex.GetType().Name}: {ex.Message}");
            return Finish(commandId, startedAt, diagnostics,
                processDetected: TracerOutcomeState.Detected,
                profileMatched: TracerOutcomeState.Matched,
                interactionAttempted: TracerOutcomeState.Uncertain,
                failReason: "Harmless navigation raised an unexpected error — outcome uncertain, not retried automatically.");
        }
    }

    private static DiscoveryTraceResult Finish(
        string commandId,
        DateTimeOffset startedAt,
        List<string> diagnostics,
        TracerOutcomeState processDetected = TracerOutcomeState.NotAttempted,
        TracerOutcomeState profileMatched = TracerOutcomeState.NotAttempted,
        TracerOutcomeState interactionAttempted = TracerOutcomeState.NotAttempted,
        string? failReason = null)
    {
        var result = new DiscoveryTraceResult
        {
            CommandId = commandId,
            StartedAtUtc = startedAt,
            CompletedAtUtc = DateTimeOffset.UtcNow,
            ConnectorCommandDelivery = TracerOutcomeState.Confirmed,
            ConnectorDurableAcceptance = TracerOutcomeState.Confirmed,
            IdealposProcessDetected = processDetected,
            IdealposUiProfileMatched = profileMatched,
            IdealposInteractionAttempted = interactionAttempted,
            FailClosedReason = failReason,
            Diagnostics = diagnostics,
        };
        result.AssertDiscoveryOnlyInvariant();
        return result;
    }

    private static Dictionary<string, object?> ToSanitizedPayload(DiscoveryTraceResult result) => new()
    {
        ["idealposProcessDetected"] = result.IdealposProcessDetected.ToString(),
        ["idealposUiProfileMatched"] = result.IdealposUiProfileMatched.ToString(),
        ["idealposInteractionAttempted"] = result.IdealposInteractionAttempted.ToString(),
        ["failClosedReason"] = result.FailClosedReason,
        // Diagnostics are operator-facing free text describing UI state
        // (window titles, control descriptions) — never secrets, never
        // payment data, by construction of every diagnostic message above.
        ["diagnostics"] = result.Diagnostics,
    };
}
