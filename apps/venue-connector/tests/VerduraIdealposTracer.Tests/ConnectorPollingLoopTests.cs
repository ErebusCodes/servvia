using System.Net;
using System.Runtime.CompilerServices;
using System.Text.Json;
using VerduraIdealposTracer.Core.Automation;
using VerduraIdealposTracer.Core.Discovery;
using VerduraIdealposTracer.Core.Hosting;
using VerduraIdealposTracer.Core.OrderSubmission;
using VerduraIdealposTracer.Core.Persistence;
using VerduraIdealposTracer.Core.Protocol;
using VerduraIdealposTracer.Fixtures;
using Xunit;

namespace VerduraIdealposTracer.Tests;

/// <summary>
/// DL-095: evidence for the always-on connector host loop. Every test here
/// drives <see cref="ConnectorPollingLoop"/> against fake HTTP handlers for
/// the real Story 2-10 protocol (poll/accept/report) and the real
/// IdealposBridge contract — the same fake-<c>HttpMessageHandler</c>
/// technique <see cref="IdealposOrderSubmissionServiceTests"/> and
/// <see cref="ConnectorCommandProtocolClientTests"/> already established.
/// Nothing here talks to a real network, a real backend, or a real
/// IdealPOS/Bridge — this is UNIT_OR_MOCK evidence for the *hosting/loop*
/// behaviour only, exactly as truthfully scoped as every other test in this
/// project.
///
/// TIMING CONTRACT — read before adding a test here. No test in this class
/// may decide how long to run the loop by wall clock. That approach failed
/// twice: first on a real Windows run (2026-08-24) at 100/150/300ms, and
/// again on 2026-09-02 at the "safe" 1500ms it had been raised to, when
/// TransientFailure_BridgeUnavailable_ReportsFailedAndLoopKeepsRunning threw
/// on <c>Reports[0]</c> under parallel load. Raising the number a third time
/// only buys a longer interval between false failures — the budget is a
/// guess about someone else's machine either way.
///
/// Instead every test states the CONDITION it is waiting for
/// (<see cref="RunUntilObservedAsync"/>): the loop runs until the scripted
/// protocol handler has actually observed that many polls/reports/
/// heartbeats, and is cancelled the moment it has. Assertions therefore run
/// against a state that is known to have been reached, never one that was
/// merely likely to have been reached in time. The 30s
/// <see cref="SafetyNet"/> exists only so a genuinely broken loop fails
/// instead of hanging CI; on a healthy run it is never reached, and a run
/// that does reach it fails with the observed counts rather than an
/// IndexOutOfRangeException.
///
/// Waiting for the NEXT poll (<c>PollCount >= 2</c>) is the idiom for "the
/// previous batch finished" — it is what makes assertions about per-command
/// log side effects deterministic, since a report can be written before the
/// rest of its batch has been handled.
/// </summary>
public sealed class ConnectorPollingLoopTests : IDisposable
{
    private readonly string _tempDir = Directory.CreateTempSubdirectory("connector-polling-loop-tests-").FullName;

    private sealed class InMemoryLog : IConnectorHostLog
    {
        public List<string> Info { get; } = [];
        public List<string> Warnings { get; } = [];
        public List<string> Errors { get; } = [];
        void IConnectorHostLog.Info(string message) => Info.Add(message);
        void IConnectorHostLog.Warning(string message) => Warnings.Add(message);
        void IConnectorHostLog.Error(string message) => Errors.Add(message);
    }

    private sealed class BridgeHandler(Func<HttpRequestMessage, CancellationToken, Task<HttpResponseMessage>> respond) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
            => respond(request, cancellationToken);
    }

    /// <summary>
    /// Fakes the real backend's poll/accept/report endpoints. Poll responses
    /// are scripted call-by-call (a queue; the last entry repeats once
    /// exhausted) so tests can simulate "one command, then nothing",
    /// "the same command redelivered twice", transient poll failures, etc.
    /// Accept/report status codes are configurable per command id so tests
    /// can simulate a losing claim race (409) without needing a second real
    /// connector instance.
    /// </summary>
    private sealed class ScriptedProtocolHandler : HttpMessageHandler
    {
        private readonly Queue<Func<HttpResponseMessage>> _pollResponses = new();
        private Func<HttpResponseMessage>? _lastPollResponse;
        public Dictionary<string, HttpStatusCode> AcceptStatusByCommandId { get; } = new();
        public Dictionary<string, HttpStatusCode> ReportStatusByCommandId { get; } = new();
        public List<string> AcceptedCommandIds { get; } = [];
        public List<(string CommandId, string Body)> Reports { get; } = [];
        public int PollCount { get; private set; }
        public List<string> HeartbeatBodies { get; } = [];
        public HttpStatusCode HeartbeatStatus { get; set; } = HttpStatusCode.OK;

        private readonly object _gate = new();
        private readonly List<(Func<ScriptedProtocolHandler, bool> Predicate, TaskCompletionSource Signal)> _observers = [];

        /// <summary>
        /// Returns a task that completes as soon as <paramref name="predicate"/>
        /// holds against this handler's observed traffic. Evaluated once on
        /// registration (so an already-satisfied condition never waits) and
        /// again after every protocol interaction this handler records.
        /// </summary>
        public Task WhenObserved(Func<ScriptedProtocolHandler, bool> predicate)
        {
            var signal = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
            lock (_gate) { _observers.Add((predicate, signal)); }
            EvaluateObservers();
            return signal.Task;
        }

        private void EvaluateObservers()
        {
            lock (_gate)
            {
                foreach (var (predicate, signal) in _observers)
                {
                    if (!signal.Task.IsCompleted && predicate(this)) signal.TrySetResult();
                }
            }
        }

        public void EnqueuePoll(params ClaimedCommand[] commands)
        {
            var body = JsonSerializer.Serialize(new PollResponse(commands.ToList()));
            EnqueuePollRaw(() => new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent(body, System.Text.Encoding.UTF8, "application/json"),
            });
        }

        public void EnqueuePollFailure() => EnqueuePollRaw(() => throw new HttpRequestException("simulated network failure"));

        private void EnqueuePollRaw(Func<HttpResponseMessage> factory)
        {
            _pollResponses.Enqueue(factory);
            _lastPollResponse = factory;
        }

        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            var path = request.RequestUri!.AbsolutePath;
            if (path.EndsWith("/heartbeat"))
            {
                var body = request.Content?.ReadAsStringAsync(cancellationToken).GetAwaiter().GetResult() ?? "";
                lock (_gate) { HeartbeatBodies.Add(body); }
                EvaluateObservers();
                return Task.FromResult(new HttpResponseMessage(HeartbeatStatus));
            }
            if (path.EndsWith("/poll"))
            {
                Func<HttpResponseMessage> factory;
                lock (_gate)
                {
                    PollCount++;
                    factory = _pollResponses.Count > 0 ? _pollResponses.Dequeue() : _lastPollResponse
                        ?? (() => new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent("""{"commands":[]}""", System.Text.Encoding.UTF8, "application/json") });
                }
                EvaluateObservers();
                return Task.FromResult(factory());
            }
            if (path.EndsWith("/accept"))
            {
                var commandId = path.Split('/')[^2];
                lock (_gate) { AcceptedCommandIds.Add(commandId); }
                EvaluateObservers();
                var status = AcceptStatusByCommandId.GetValueOrDefault(commandId, HttpStatusCode.OK);
                return Task.FromResult(new HttpResponseMessage(status));
            }
            if (path.EndsWith("/report"))
            {
                var commandId = path.Split('/')[^2];
                var body = request.Content?.ReadAsStringAsync(cancellationToken).GetAwaiter().GetResult() ?? "";
                lock (_gate) { Reports.Add((commandId, body)); }
                EvaluateObservers();
                var status = ReportStatusByCommandId.GetValueOrDefault(commandId, HttpStatusCode.OK);
                return Task.FromResult(new HttpResponseMessage(status));
            }
            throw new InvalidOperationException($"Unexpected protocol call: {path}");
        }
    }

    private static ClaimedCommand SubmitOrderCommand(string commandId, string externalOrderId = "order-1") => new(
        Id: commandId,
        CommandType: IdealposOrderSubmissionService.CommandType,
        SchemaVersion: 1,
        Payload: new Dictionary<string, object?>
        {
            ["externalOrderId"] = externalOrderId,
            ["table"] = "T4",
            ["items"] = new List<object> { new Dictionary<string, object?> { ["productCode"] = "PLU-1", ["quantity"] = 2 } },
            ["notes"] = null,
        },
        RequiredCapability: IdealposOrderSubmissionService.CommandType);

    private (ConnectorPollingLoop Loop, ScriptedProtocolHandler Protocol, InMemoryLog Log) Build(
        Func<HttpRequestMessage, CancellationToken, Task<HttpResponseMessage>>? bridgeRespond = null,
        TimeSpan? pollInterval = null,
        TimeSpan? errorBackoff = null)
    {
        var protocolHandler = new ScriptedProtocolHandler();
        var protocolHttpClient = new HttpClient(protocolHandler) { BaseAddress = new Uri("http://localhost/api/") };
        var protocolClient = new ConnectorCommandProtocolClient(protocolHttpClient, "installation-1.secret");

        bridgeRespond ??= (_, _) => Task.FromResult(new HttpResponseMessage(HttpStatusCode.Created)
        {
            Content = new StringContent("""{"duplicate":false}""", System.Text.Encoding.UTF8, "application/json"),
        });
        var bridgeHttpClient = new HttpClient(new BridgeHandler(bridgeRespond)) { BaseAddress = new Uri("http://127.0.0.1:5588/") };
        var bridgeClient = new IdealposBridgeClient(bridgeHttpClient, "test-key", TimeSpan.FromSeconds(2));
        var log_ = new DurableLocalLog(Path.Combine(_tempDir, $"{Guid.NewGuid()}.ndjson"));
        var orderSubmissionService = new IdealposOrderSubmissionService(bridgeClient, log_, protocolClient);

        var automationClient = new FakeIdealposUiAutomationClient(FakeScenario.HappyPath);
        var profile = new IdealposVerifiedProfile(ExpectedProcessName: "IPSClient", ExpectedMainWindowTitleContains: "Idealpos", ProfileVersion: "test-v1");
        var discoveryLog = new DurableLocalLog(Path.Combine(_tempDir, $"{Guid.NewGuid()}.ndjson"));
        var discoveryService = new DiscoveryTracerService(automationClient, profile, discoveryLog, protocolClient);

        var inMemoryLog = new InMemoryLog();
        var loop = new ConnectorPollingLoop(
            protocolClient,
            discoveryService,
            orderSubmissionService,
            inMemoryLog,
            pollInterval ?? TimeSpan.FromMilliseconds(20),
            errorBackoff ?? TimeSpan.FromMilliseconds(20));

        return (loop, protocolHandler, inMemoryLog);
    }

    /// <summary>
    /// Upper bound on how long a single test may wait for its condition.
    /// This is a hang-breaker, not a timing budget: a healthy run never
    /// reaches it, and reaching it is reported as a real failure naming the
    /// counts actually observed.
    /// </summary>
    private static readonly TimeSpan SafetyNet = TimeSpan.FromSeconds(30);

    /// <summary>
    /// Runs the loop until the scripted handler has OBSERVED
    /// <paramref name="until"/>, then cancels and awaits a clean shutdown.
    /// The condition - not a stopwatch - decides when assertions may run.
    /// </summary>
    private static async Task RunUntilObservedAsync(
        ConnectorPollingLoop loop,
        ScriptedProtocolHandler protocol,
        Func<ScriptedProtocolHandler, bool> until,
        [CallerArgumentExpression(nameof(until))] string? untilExpression = null)
    {
        using var cts = new CancellationTokenSource(SafetyNet);
        var observed = protocol.WhenObserved(until);
        var run = loop.RunAsync(cts.Token);

        var first = await Task.WhenAny(observed, run);
        cts.Cancel();
        await run; // must return cleanly however it was stopped

        if (first != observed)
        {
            throw new Xunit.Sdk.XunitException(
                $"The loop stopped before the awaited condition was observed: {untilExpression}. "
                + $"Observed polls={protocol.PollCount}, reports={protocol.Reports.Count}, "
                + $"accepts={protocol.AcceptedCommandIds.Count}, heartbeats={protocol.HeartbeatBodies.Count}.");
        }
    }

    // ── Lifecycle ──────────────────────────────────────────────────────

    [Fact]
    public async Task Lifecycle_StartsAndStopsCleanly_WhenCancelled()
    {
        var (loop, protocol, log) = Build();
        protocol.EnqueuePoll(); // always empty

        await RunUntilObservedAsync(loop, protocol, p => p.PollCount >= 1);

        Assert.Contains(log.Info, m => m.Contains("starting", StringComparison.OrdinalIgnoreCase));
        Assert.Contains(log.Info, m => m.Contains("stopped", StringComparison.OrdinalIgnoreCase));
    }

    [Fact]
    public async Task Lifecycle_CancellationDuringInterPollDelay_ReturnsPromptly()
    {
        var (loop, protocol, _) = Build(pollInterval: TimeSpan.FromSeconds(30));
        protocol.EnqueuePoll(); // empty -> loop immediately enters the 30s inter-poll delay

        // Measures the cancel -> return latency directly. The old version
        // timed the whole run against a 5s bound, so it was really asserting
        // that its own 1500ms cancellation timer had fired.
        using var cts = new CancellationTokenSource(SafetyNet);
        var polled = protocol.WhenObserved(p => p.PollCount >= 1);
        var run = loop.RunAsync(cts.Token);
        await polled; // the loop has polled, so it is now in the 30s delay

        var sw = System.Diagnostics.Stopwatch.StartNew();
        cts.Cancel();
        await run;
        sw.Stop();

        Assert.True(sw.Elapsed < TimeSpan.FromSeconds(5), $"Expected cancellation to interrupt the delay promptly, took {sw.Elapsed}.");
    }

    // ── Command processing ─────────────────────────────────────────────

    [Fact]
    public async Task SuccessfulSubmission_ReportsSucceeded_WithStableExternalOrderId()
    {
        var (loop, protocol, _) = Build();
        protocol.EnqueuePoll(SubmitOrderCommand("cmd-1", "order-42"));
        protocol.EnqueuePoll(); // subsequent polls empty

        await RunUntilObservedAsync(loop, protocol, p => p.Reports.Count >= 1);

        Assert.Single(protocol.Reports);
        Assert.Equal("cmd-1", protocol.Reports[0].CommandId);
        using var doc = JsonDocument.Parse(protocol.Reports[0].Body);
        Assert.Equal("succeeded", doc.RootElement.GetProperty("outcome").GetString());
        Assert.Equal("order-42", doc.RootElement.GetProperty("resultPayload").GetProperty("externalOrderId").GetString());
    }

    [Fact]
    public async Task DeterministicFailure_BridgeRejects_ReportsFailedAndLoopKeepsRunning()
    {
        var (loop, protocol, _) = Build(bridgeRespond: (_, _) => Task.FromResult(
            new HttpResponseMessage(HttpStatusCode.BadRequest) { Content = new StringContent("""{"error":"unknown table"}""") }));
        protocol.EnqueuePoll(SubmitOrderCommand("cmd-1"));
        protocol.EnqueuePoll();

        await RunUntilObservedAsync(loop, protocol, p => p.Reports.Count >= 1 && p.PollCount >= 2);

        Assert.Single(protocol.Reports);
        using var doc = JsonDocument.Parse(protocol.Reports[0].Body);
        Assert.Equal("failed", doc.RootElement.GetProperty("outcome").GetString());
        Assert.Equal("bridge_rejected", doc.RootElement.GetProperty("resultType").GetString());
        Assert.True(protocol.PollCount >= 2, "The loop must keep polling after a deterministic per-command failure.");
    }

    [Fact]
    public async Task TransientFailure_BridgeUnavailable_ReportsFailedAndLoopKeepsRunning()
    {
        var (loop, protocol, _) = Build(bridgeRespond: (_, _) => Task.FromResult(new HttpResponseMessage(HttpStatusCode.ServiceUnavailable)));
        protocol.EnqueuePoll(SubmitOrderCommand("cmd-1"));
        protocol.EnqueuePoll();

        // This is the test that failed under load on 2026-09-02: it indexed
        // Reports[0] after a 1500ms wall-clock run. It now waits for the
        // report to actually exist.
        await RunUntilObservedAsync(loop, protocol, p => p.Reports.Count >= 1 && p.PollCount >= 2);

        using var doc = JsonDocument.Parse(protocol.Reports[0].Body);
        Assert.Equal("bridge_unreachable_or_failed", doc.RootElement.GetProperty("resultType").GetString());
        Assert.True(protocol.PollCount >= 2);
    }

    [Fact]
    public async Task NetworkOrTimeoutFailure_PollThrows_LoopBacksOffAndRecoversWithoutCrashing()
    {
        var (loop, protocol, log) = Build(errorBackoff: TimeSpan.FromMilliseconds(10));
        protocol.EnqueuePollFailure();
        protocol.EnqueuePollFailure();
        protocol.EnqueuePoll(SubmitOrderCommand("cmd-1"));
        protocol.EnqueuePoll();

        // must not throw despite two failed polls
        await RunUntilObservedAsync(loop, protocol, p => p.Reports.Count >= 1 && p.PollCount >= 3);

        Assert.True(protocol.PollCount >= 3);
        Assert.Contains(log.Errors, m => m.Contains("Poll failed"));
        Assert.Single(protocol.Reports); // the command after the failures was still processed
    }

    [Fact]
    public async Task DuplicateCommandVisibleAcrossTwoPolls_BothAttemptsReportTheSameExternalOrderId_NeverADifferentOne()
    {
        // Simulates redelivery: the same durable command is still visible on
        // a later poll (e.g. a dropped accept response, or the connector
        // itself restarting mid-command).
        var (loop, protocol, _) = Build();
        protocol.EnqueuePoll(SubmitOrderCommand("cmd-1", "order-99"));
        protocol.EnqueuePoll(SubmitOrderCommand("cmd-1", "order-99"));
        protocol.EnqueuePoll();

        // Waits for all three scripted polls so the redelivery has actually
        // been seen and whatever reports exist are final.
        await RunUntilObservedAsync(loop, protocol, p => p.PollCount >= 3 && p.Reports.Count >= 1);

        Assert.True(protocol.Reports.Count >= 1);
        foreach (var (_, body) in protocol.Reports)
        {
            using var doc = JsonDocument.Parse(body);
            Assert.Equal("order-99", doc.RootElement.GetProperty("resultPayload").GetProperty("externalOrderId").GetString());
        }
    }

    [Fact]
    public async Task MultipleCommandsInOneBatch_EachProcessedExactlyOnce()
    {
        var (loop, protocol, log) = Build();
        protocol.EnqueuePoll(
            SubmitOrderCommand("cmd-1", "order-1"),
            new ClaimedCommand("cmd-2", "some.unrecognized.type.v1", 1, [], null));
        protocol.EnqueuePoll();

        // PollCount >= 2 proves the WHOLE batch was handled: cmd-1's report
        // can land before cmd-2 has been looked at, so waiting on the report
        // alone would race the cmd-2 warning this test asserts on.
        await RunUntilObservedAsync(loop, protocol, p => p.PollCount >= 2 && p.Reports.Count >= 1);

        Assert.Single(protocol.Reports);
        Assert.Equal("cmd-1", protocol.Reports[0].CommandId);
        Assert.DoesNotContain("cmd-2", protocol.AcceptedCommandIds);
        Assert.Contains(log.Warnings, m => m.Contains("cmd-2") && m.Contains("not handled"));
    }

    [Fact]
    public async Task LostAcceptClaimRace_ReturnsConflict_LoopSurvivesAndKeepsRunning()
    {
        // Simulates another connector instance (or installation) having
        // already claimed this exact command — the real server-side CAS
        // protocol this client only ever consumes, never reimplements.
        var (loop, protocol, log) = Build();
        protocol.AcceptStatusByCommandId["cmd-1"] = HttpStatusCode.Conflict;
        protocol.EnqueuePoll(SubmitOrderCommand("cmd-1"));
        protocol.EnqueuePoll();

        // must not throw; PollCount >= 2 proves the losing claim was fully
        // handled and the loop came back for more.
        await RunUntilObservedAsync(loop, protocol, p => p.PollCount >= 2);

        Assert.Empty(protocol.Reports); // never reported — the command was never truly ours
        Assert.Contains(log.Errors, m => m.Contains("cmd-1") && m.Contains("unexpected error"));
        Assert.True(protocol.PollCount >= 2, "A losing claim race on one command must not stop the loop from polling again.");
    }

    // ── Capability reporting ────────────────────────────────────────────

    [Fact]
    public async Task Startup_ReportsSupportedCapabilities_AsCamelCaseObjectBeforeFirstPoll()
    {
        var (loop, protocol, _) = Build();
        protocol.EnqueuePoll(); // always empty

        await RunUntilObservedAsync(loop, protocol, p => p.HeartbeatBodies.Count >= 1 && p.PollCount >= 1);

        Assert.Single(protocol.HeartbeatBodies);
        using var doc = JsonDocument.Parse(protocol.HeartbeatBodies[0]);
        var root = doc.RootElement;
        Assert.True(root.TryGetProperty("capabilities", out var capabilities), "must serialize as camelCase 'capabilities', matching ConnectorHeartbeatDto.");
        Assert.True(capabilities.TryGetProperty(IdealposOrderSubmissionService.CommandType, out _),
            "must report the exact command type this build actually dispatches to IdealposOrderSubmissionService.");
        Assert.True(capabilities.TryGetProperty(DiscoveryTracerService.CommandType, out _),
            "must report the exact command type this build actually dispatches to DiscoveryTracerService.");
        // Never claim a capability this build cannot actually service.
        Assert.False(capabilities.TryGetProperty("some.unimplemented.type.v1", out _));
    }

    [Fact]
    public async Task RestartRecovery_EachFreshLoopInstance_ReReportsCapabilitiesOnItsOwnStartup()
    {
        // Every RunAsync call models one process/service (re)start — proves
        // a Restart-Service cycle actually re-heartbeats, not just the
        // first-ever launch.
        var (loop1, protocol1, _) = Build();
        protocol1.EnqueuePoll();
        await RunUntilObservedAsync(loop1, protocol1, p => p.HeartbeatBodies.Count >= 1 && p.PollCount >= 1);
        Assert.Single(protocol1.HeartbeatBodies);

        var (loop2, protocol2, _) = Build();
        protocol2.EnqueuePoll();
        await RunUntilObservedAsync(loop2, protocol2, p => p.HeartbeatBodies.Count >= 1 && p.PollCount >= 1);
        Assert.Single(protocol2.HeartbeatBodies);
    }

    [Fact]
    public async Task CapabilityReportFailure_IsNonFatal_LoopStillPollsAndProcessesCommands()
    {
        var (loop, protocol, log) = Build();
        protocol.HeartbeatStatus = HttpStatusCode.ServiceUnavailable;
        protocol.EnqueuePoll(SubmitOrderCommand("cmd-1", "order-1"));
        protocol.EnqueuePoll();

        // must not throw despite the failed heartbeat
        await RunUntilObservedAsync(loop, protocol, p => p.Reports.Count >= 1 && p.PollCount >= 2);

        Assert.Contains(log.Errors, m => m.Contains("Capability report failed"));
        Assert.Single(protocol.Reports); // command processing proceeds normally regardless
    }

    // ── Restart recovery ───────────────────────────────────────────────

    [Fact]
    public async Task RestartRecovery_FreshLoopInstance_StillProcessesAPreExistingPendingCommand()
    {
        // A brand-new ConnectorPollingLoop (no shared in-memory state with
        // any prior instance) polling a server that still has a durable
        // command outstanding — exactly what a process/machine restart
        // looks like from this loop's perspective, since it holds no state
        // of its own between commands.
        var (loop, protocol, _) = Build();
        protocol.EnqueuePoll(SubmitOrderCommand("cmd-1", "order-77"));
        protocol.EnqueuePoll();

        await RunUntilObservedAsync(loop, protocol, p => p.Reports.Count >= 1);

        Assert.Single(protocol.Reports);
        using var doc = JsonDocument.Parse(protocol.Reports[0].Body);
        Assert.Equal("order-77", doc.RootElement.GetProperty("resultPayload").GetProperty("externalOrderId").GetString());
    }

    public void Dispose()
    {
        if (Directory.Exists(_tempDir)) Directory.Delete(_tempDir, recursive: true);
    }
}
