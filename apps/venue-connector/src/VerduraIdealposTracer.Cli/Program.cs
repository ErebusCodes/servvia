using System.Text.Json;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using VerduraIdealposTracer.Core.Automation;
using VerduraIdealposTracer.Core.Discovery;
using VerduraIdealposTracer.Core.Hosting;
using VerduraIdealposTracer.Core.OrderSubmission;
using VerduraIdealposTracer.Core.Persistence;
using VerduraIdealposTracer.Core.Protocol;
using VerduraIdealposTracer.Windows;

// Story 9-2 / DL-095 real operator-facing entry point. UNVERIFIED against a
// real IdealPOS install — see this project's own .csproj doc comment and
// docs/operator-runbook.md. Must not be run against a real Idealpos
// installation until the operator has completed the runbook's pre-flight
// steps (dry run, profile configuration, explicit approval).
//
// Two independent modes, unchanged in meaning from before DL-095:
//   "local" — one bounded, on-demand discovery-only diagnostic run (the
//             operator runbook's dry-run/real-discovery steps). Exits
//             after a single attempt, exactly as it always has.
//   "cloud" — DL-095: now an always-on host, not a single bounded poll.
//             Runs under the standard .NET Generic Host so it behaves
//             correctly both as an interactive console process (Ctrl+C /
//             SIGTERM for graceful shutdown) and, via
//             Microsoft.Extensions.Hosting.WindowsServices' AddWindowsService,
//             when installed as a real Windows Service (`sc.exe create`) —
//             the operator no longer has to re-launch the Cli by hand or
//             wrap it in an external scheduler to keep it processing
//             durable commands. The actual command-execution semantics
//             (claim/accept/execute/report, fail-closed on an unrecognized
//             type or schema version, never synthesizing an outcome after
//             an unexpected exception) are entirely unchanged — see
//             VerduraIdealposTracer.Core.Hosting.ConnectorPollingLoop,
//             which now owns exactly the dispatch logic this file used to
//             run once per process.

var mode = Environment.GetEnvironmentVariable("TRACER_MODE") ?? "local"; // "local" | "cloud"
var storePath = Environment.GetEnvironmentVariable("TRACER_STORE_PATH")
    ?? throw new InvalidOperationException("TRACER_STORE_PATH is required.");
var profilePath = Environment.GetEnvironmentVariable("TRACER_PROFILE_PATH")
    ?? throw new InvalidOperationException(
        "TRACER_PROFILE_PATH is required — point it at a completed copy of docs/discovery-profile.sample.json. " +
        "Refusing to run with no verified profile (fail closed, not a default guess).");

var expectedProfile = JsonSerializer.Deserialize<IdealposVerifiedProfile>(File.ReadAllText(profilePath))
    ?? throw new InvalidOperationException($"Could not parse profile at {profilePath}.");
// Thread the WHOLE profile through — every Win32 selector and the profile's
// own ProfileVersion. The previous two-argument construction discarded both,
// which made TerminalSelectorReadiness unreachable by configuration.
var windowsSettings = WindowsAutomationSettings.FromProfile(expectedProfile);

var automationClient = new WindowsUiAutomationClient(windowsSettings);
var localLog = new DurableLocalLog(storePath);

if (string.Equals(mode, "capture", StringComparison.OrdinalIgnoreCase))
{
    // Passive Session-1 control-tree capture. Read-only: no click, no
    // keystroke, no mutation — see WindowsUiAutomationClient.CaptureControlTreeAsync.
    // Must run inside the interactive Session-1 desktop; from a service
    // (Session 0) context it correctly returns an empty, fail-closed
    // snapshot rather than inventing controls.
    using var captureCts = new CancellationTokenSource(TimeSpan.FromSeconds(20));
    var snapshot = await automationClient.CaptureControlTreeAsync(ControlTreeCaptureOptions.Default, captureCts.Token);
    var json = JsonSerializer.Serialize(snapshot, new JsonSerializerOptions { WriteIndented = true });
    var capturePath = Environment.GetEnvironmentVariable("TRACER_CAPTURE_OUT");
    if (!string.IsNullOrWhiteSpace(capturePath))
    {
        File.WriteAllText(capturePath, json);
        Console.WriteLine(
            $"Capture written to {capturePath} (root present: {snapshot.HasRoot}, nodes: {snapshot.NodeCount}, "
            + $"CLIENT nodes: {snapshot.ClientNodeCount}, WIN32 controls: {snapshot.Win32Controls.Count}, "
            + $"mechanism: {snapshot.Mechanism}, truncated: {snapshot.Truncated}).");
    }
    else
    {
        Console.WriteLine(json);
    }

    // Binding a window frame is NOT a successful discovery capture. Exit 0
    // only when the walk reached client-area content a selector could be
    // derived from; otherwise surface every diagnostic and fail, so a
    // chrome-only walk can never be recorded as a passing run.
    if (!snapshot.HasClientContent)
    {
        Console.Error.WriteLine(
            $"CAPTURE FAILED: bound a window (root present: {snapshot.HasRoot}) but reached ZERO client-area "
            + "controls, so no selector can be derived from it.");
        foreach (var diagnostic in snapshot.Diagnostics) Console.Error.WriteLine($"  - {diagnostic}");
        return 1;
    }

    // Client content alone is NOT enough on this application. The 14:10:32
    // POS Screen capture passed the check above with a single empty
    // ThunderRT6PictureBoxDC pane and exited 0, yet carried nothing a
    // selector could be built from. Selectors for this VB6 target come from
    // the Win32 child tree, so that is what the gate must require.
    if (snapshot.Win32Controls.Count == 0)
    {
        Console.Error.WriteLine(
            $"CAPTURE INCOMPLETE: bound '{snapshot.RootWindowTitle}' and found {snapshot.ClientNodeCount} UIA "
            + "client node(s), but ZERO Win32 child controls. Selectors for this VB6 application are derived from "
            + "the Win32 tree, so this capture cannot populate a profile.");
        foreach (var diagnostic in snapshot.Diagnostics) Console.Error.WriteLine($"  - {diagnostic}");
        return 1;
    }

    return 0;
}

if (string.Equals(mode, "cloud", StringComparison.OrdinalIgnoreCase))
{
    return await RunAlwaysOnHostAsync(args, automationClient, expectedProfile, localLog);
}
else
{
    using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(30));
    try
    {
        var service = new DiscoveryTracerService(automationClient, expectedProfile, localLog);
        var commandId = Environment.GetEnvironmentVariable("TRACER_COMMAND_ID") ?? Guid.NewGuid().ToString();
        var result = await service.RunLocalModeAsync(commandId, cts.Token);
        Console.WriteLine(JsonSerializer.Serialize(result, new JsonSerializerOptions { WriteIndented = true }));
        return result.FailClosedReason is null ? 0 : 1;
    }
    catch (OperationCanceledException)
    {
        Console.Error.WriteLine("Run cancelled/timed out before completion.");
        return 3;
    }
    catch (Exception ex)
    {
        Console.Error.WriteLine($"Unexpected error — outcome undetermined, nothing was reported as succeeded or failed: {ex.GetType().Name}: {ex.Message}");
        return 4;
    }
}

static async Task<int> RunAlwaysOnHostAsync(
    string[] args,
    IIdealposUiAutomationClient automationClient,
    IdealposVerifiedProfile expectedProfile,
    DurableLocalLog localLog)
{
    var baseUrl = Environment.GetEnvironmentVariable("TRACER_BASE_URL")
        ?? throw new InvalidOperationException("TRACER_BASE_URL is required in cloud mode.");
    var credential = Environment.GetEnvironmentVariable("TRACER_CONNECTOR_CREDENTIAL")
        ?? throw new InvalidOperationException(
            "TRACER_CONNECTOR_CREDENTIAL is required in cloud mode — the real Story 2-9 " +
            "installationId.secret issued to this machine. Never hard-code this value.");

    // Story 15-5: IdealposBridge is local-only by documented design
    // (App.config default: 127.0.0.1:5588, loopback unless AllowLan is
    // explicitly set) — required, never defaulted/guessed here, so a
    // misconfigured deployment fails fast at startup rather than
    // silently never delivering orders.
    var bridgeBaseUrl = Environment.GetEnvironmentVariable("IDEALPOS_BRIDGE_BASE_URL")
        ?? throw new InvalidOperationException(
            "IDEALPOS_BRIDGE_BASE_URL is required in cloud mode — the local IdealposBridge endpoint " +
            "this machine submits orders to (documented default: http://127.0.0.1:5588). Never guessed.");
    var bridgeApiKey = Environment.GetEnvironmentVariable("IDEALPOS_BRIDGE_API_KEY")
        ?? throw new InvalidOperationException(
            "IDEALPOS_BRIDGE_API_KEY is required in cloud mode — IdealposBridge rejects every request " +
            "without a Bearer token (Bridge:ApiKey). Never hard-code this value.");
    var bridgeTimeout = TimeSpan.FromMilliseconds(
        int.TryParse(Environment.GetEnvironmentVariable("IDEALPOS_BRIDGE_TIMEOUT_MS"), out var parsedBridgeTimeoutMs)
            ? parsedBridgeTimeoutMs
            : 10_000);

    // DL-095: the previous single-shot Cli polled exactly once per process
    // launch. An always-on host instead loops, waiting this long between
    // poll cycles when there was nothing (or nothing left) to do, and
    // backing off this long after a poll call itself fails (network down,
    // backend unreachable) before trying again — same
    // optional-env-var-with-a-documented-service-default convention as
    // every IDEALPOS_RETRY_*/IDEALPOS_UNKNOWN_RECOVERY_GRACE_MS knob in
    // apps/api/src/app.module.ts.
    var pollIntervalMs = int.TryParse(Environment.GetEnvironmentVariable("TRACER_POLL_INTERVAL_MS"), out var parsedPollIntervalMs)
        ? parsedPollIntervalMs
        : 5_000;
    var pollErrorBackoffMs = int.TryParse(Environment.GetEnvironmentVariable("TRACER_POLL_ERROR_BACKOFF_MS"), out var parsedBackoffMs)
        ? parsedBackoffMs
        : 15_000;

    var builder = Host.CreateApplicationBuilder(args);
    builder.Logging.AddSimpleConsole(options =>
    {
        options.SingleLine = true;
        options.TimestampFormat = "yyyy-MM-ddTHH:mm:ss.fffZ ";
    });
    // Runs correctly both interactively (dotnet run / a console window) and
    // when installed as a real Windows Service — a no-op outside that
    // context, never required.
    builder.Services.AddWindowsService(options => options.ServiceName = "VerduraIdealposTracer");

    builder.Services.AddSingleton(sp =>
    {
        var httpClient = new HttpClient { BaseAddress = new Uri(baseUrl) };
        return new ConnectorCommandProtocolClient(httpClient, credential);
    });
    builder.Services.AddSingleton(sp =>
    {
        var bridgeHttpClient = new HttpClient { BaseAddress = new Uri(bridgeBaseUrl) };
        return new IdealposBridgeClient(bridgeHttpClient, bridgeApiKey, bridgeTimeout);
    });
    builder.Services.AddSingleton(sp => new DiscoveryTracerService(
        automationClient, expectedProfile, localLog, sp.GetRequiredService<ConnectorCommandProtocolClient>()));
    builder.Services.AddSingleton(sp => new IdealposOrderSubmissionService(
        sp.GetRequiredService<IdealposBridgeClient>(), localLog, sp.GetRequiredService<ConnectorCommandProtocolClient>()));
    builder.Services.AddSingleton<IConnectorHostLog>(sp => new LoggerConnectorHostLog(
        sp.GetRequiredService<ILogger<ConnectorPollingLoop>>()));
    builder.Services.AddSingleton(sp => new ConnectorPollingLoop(
        sp.GetRequiredService<ConnectorCommandProtocolClient>(),
        sp.GetRequiredService<DiscoveryTracerService>(),
        sp.GetRequiredService<IdealposOrderSubmissionService>(),
        sp.GetRequiredService<IConnectorHostLog>(),
        TimeSpan.FromMilliseconds(pollIntervalMs),
        TimeSpan.FromMilliseconds(pollErrorBackoffMs)));
    builder.Services.AddHostedService<ConnectorBackgroundService>();

    using var host = builder.Build();
    await host.RunAsync();
    return 0;
}

/// <summary>Thin adapter so ConnectorPollingLoop (Core, no logging-framework dependency) can log through the host's real ILogger — structured, leveled, and routed wherever this host's logging providers point.</summary>
sealed class LoggerConnectorHostLog(ILogger<ConnectorPollingLoop> logger) : IConnectorHostLog
{
    public void Info(string message) => logger.LogInformation("{Message}", message);
    public void Warning(string message) => logger.LogWarning("{Message}", message);
    public void Error(string message) => logger.LogError("{Message}", message);
}

/// <summary>Bridges ConnectorPollingLoop into the Generic Host lifecycle — start on host start, request cooperative shutdown on host stop. Contains no logic of its own beyond that handoff.</summary>
sealed class ConnectorBackgroundService(ConnectorPollingLoop loop, ILogger<ConnectorBackgroundService> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        logger.LogInformation("VerduraIdealposTracer always-on connector host starting (DL-095).");
        try
        {
            await loop.RunAsync(stoppingToken);
        }
        finally
        {
            logger.LogInformation("VerduraIdealposTracer always-on connector host stopped.");
        }
    }
}
