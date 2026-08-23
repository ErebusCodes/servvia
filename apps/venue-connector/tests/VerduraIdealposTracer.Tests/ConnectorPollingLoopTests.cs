using System.Net;
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
            if (path.EndsWith("/poll"))
            {
                PollCount++;
                var factory = _pollResponses.Count > 0 ? _pollResponses.Dequeue() : _lastPollResponse
                    ?? (() => new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent("""{"commands":[]}""", System.Text.Encoding.UTF8, "application/json") });
                return Task.FromResult(factory());
            }
            if (path.EndsWith("/accept"))
            {
                var commandId = path.Split('/')[^2];
                AcceptedCommandIds.Add(commandId);
                var status = AcceptStatusByCommandId.GetValueOrDefault(commandId, HttpStatusCode.OK);
                return Task.FromResult(new HttpResponseMessage(status));
            }
            if (path.EndsWith("/report"))
            {
                var commandId = path.Split('/')[^2];
                var body = request.Content?.ReadAsStringAsync(cancellationToken).GetAwaiter().GetResult() ?? "";
                Reports.Add((commandId, body));
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

    // ── Lifecycle ──────────────────────────────────────────────────────

    [Fact]
    public async Task Lifecycle_StartsAndStopsCleanly_WhenCancelled()
    {
        var (loop, protocol, log) = Build();
        protocol.EnqueuePoll(); // always empty

        using var cts = new CancellationTokenSource(TimeSpan.FromMilliseconds(100));
        await loop.RunAsync(cts.Token); // must return, never throw

        Assert.Contains(log.Info, m => m.Contains("starting", StringComparison.OrdinalIgnoreCase));
        Assert.Contains(log.Info, m => m.Contains("stopped", StringComparison.OrdinalIgnoreCase));
    }

    [Fact]
    public async Task Lifecycle_CancellationDuringInterPollDelay_ReturnsPromptly()
    {
        var (loop, protocol, _) = Build(pollInterval: TimeSpan.FromSeconds(30));
        protocol.EnqueuePoll(); // empty -> loop immediately enters the 30s inter-poll delay

        using var cts = new CancellationTokenSource(TimeSpan.FromMilliseconds(100));
        var sw = System.Diagnostics.Stopwatch.StartNew();
        await loop.RunAsync(cts.Token);
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

        using var cts = new CancellationTokenSource(TimeSpan.FromMilliseconds(150));
        await loop.RunAsync(cts.Token);

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

        using var cts = new CancellationTokenSource(TimeSpan.FromMilliseconds(150));
        await loop.RunAsync(cts.Token);

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

        using var cts = new CancellationTokenSource(TimeSpan.FromMilliseconds(150));
        await loop.RunAsync(cts.Token);

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

        using var cts = new CancellationTokenSource(TimeSpan.FromMilliseconds(300));
        await loop.RunAsync(cts.Token); // must not throw despite two failed polls

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

        using var cts = new CancellationTokenSource(TimeSpan.FromMilliseconds(150));
        await loop.RunAsync(cts.Token);

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

        using var cts = new CancellationTokenSource(TimeSpan.FromMilliseconds(150));
        await loop.RunAsync(cts.Token);

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

        using var cts = new CancellationTokenSource(TimeSpan.FromMilliseconds(150));
        await loop.RunAsync(cts.Token); // must not throw

        Assert.Empty(protocol.Reports); // never reported — the command was never truly ours
        Assert.Contains(log.Errors, m => m.Contains("cmd-1") && m.Contains("unexpected error"));
        Assert.True(protocol.PollCount >= 2, "A losing claim race on one command must not stop the loop from polling again.");
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

        using var cts = new CancellationTokenSource(TimeSpan.FromMilliseconds(150));
        await loop.RunAsync(cts.Token);

        Assert.Single(protocol.Reports);
        using var doc = JsonDocument.Parse(protocol.Reports[0].Body);
        Assert.Equal("order-77", doc.RootElement.GetProperty("resultPayload").GetProperty("externalOrderId").GetString());
    }

    public void Dispose()
    {
        if (Directory.Exists(_tempDir)) Directory.Delete(_tempDir, recursive: true);
    }
}
