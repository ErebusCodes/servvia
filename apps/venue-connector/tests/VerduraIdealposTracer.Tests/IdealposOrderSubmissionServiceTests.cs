using System.Net;
using System.Text.Json;
using VerduraIdealposTracer.Core.OrderSubmission;
using VerduraIdealposTracer.Core.Persistence;
using VerduraIdealposTracer.Core.Protocol;
using Xunit;

namespace VerduraIdealposTracer.Tests;

/// <summary>
/// Command-level evidence for the idealpos.submit_order.v1 handler: command
/// routing/validation, the full accept-then-report lifecycle, and every
/// Bridge outcome's effect on what gets reported back through the real
/// connector command protocol (Story 2-10, unchanged — exercised here via a
/// fake HttpMessageHandler, the same technique
/// ConnectorCommandProtocolClientTests already established for that class).
/// </summary>
public sealed class IdealposOrderSubmissionServiceTests : IDisposable
{
    private readonly string _tempDir = Directory.CreateTempSubdirectory("order-submission-tests-").FullName;

    private sealed class BridgeHandler(Func<HttpRequestMessage, CancellationToken, Task<HttpResponseMessage>> respond) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
            => respond(request, cancellationToken);
    }

    /// <summary>Fakes the real backend's accept/report endpoints so this test observes exactly what the handler would durably tell the server, without a real HTTP server.</summary>
    private sealed class RoutingProtocolHandler : HttpMessageHandler
    {
        public int AcceptCalls { get; private set; }
        public int ReportCalls { get; private set; }
        public string? LastReportBody { get; private set; }

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            var path = request.RequestUri!.AbsolutePath;
            if (path.EndsWith("/accept"))
            {
                AcceptCalls++;
                return new HttpResponseMessage(HttpStatusCode.OK);
            }
            if (path.EndsWith("/report"))
            {
                ReportCalls++;
                LastReportBody = request.Content is null ? null : await request.Content.ReadAsStringAsync(cancellationToken);
                return new HttpResponseMessage(HttpStatusCode.OK);
            }
            throw new InvalidOperationException($"Unexpected protocol call: {path}");
        }
    }

    private static ClaimedCommand SubmitOrderCommand(string commandId = "cmd-1", int schemaVersion = 1, Dictionary<string, object?>? payload = null) => new(
        Id: commandId,
        CommandType: IdealposOrderSubmissionService.CommandType,
        SchemaVersion: schemaVersion,
        Payload: payload ?? SamplePayload(),
        RequiredCapability: IdealposOrderSubmissionService.CommandType);

    private static Dictionary<string, object?> SamplePayload() => new()
    {
        ["externalOrderId"] = "order-123",
        ["table"] = "T4",
        ["items"] = new List<object> { new Dictionary<string, object?> { ["productCode"] = "PLU-1", ["quantity"] = 2 } },
        ["notes"] = null,
    };

    private (IdealposOrderSubmissionService Service, RoutingProtocolHandler Protocol, DurableLocalLog Log) BuildService(
        Func<HttpRequestMessage, CancellationToken, Task<HttpResponseMessage>> bridgeRespond)
    {
        var bridgeHttpClient = new HttpClient(new BridgeHandler(bridgeRespond)) { BaseAddress = new Uri("http://127.0.0.1:5588/") };
        var bridgeClient = new IdealposBridgeClient(bridgeHttpClient, "test-key", TimeSpan.FromSeconds(2));

        var protocolHandler = new RoutingProtocolHandler();
        var protocolHttpClient = new HttpClient(protocolHandler) { BaseAddress = new Uri("http://localhost/api/") };
        var protocolClient = new ConnectorCommandProtocolClient(protocolHttpClient, "installation-1.secret");

        var log = new DurableLocalLog(Path.Combine(_tempDir, $"{Guid.NewGuid()}.ndjson"));
        var service = new IdealposOrderSubmissionService(bridgeClient, log, protocolClient);
        return (service, protocolHandler, log);
    }

    private static HttpResponseMessage JsonResponse(HttpStatusCode status, string body) =>
        new(status) { Content = new StringContent(body, System.Text.Encoding.UTF8, "application/json") };

    [Fact]
    public async Task BridgeCreated201_ReportsSucceeded_WithStableExternalOrderId()
    {
        var (service, protocol, _) = BuildService((_, _) => Task.FromResult(JsonResponse(HttpStatusCode.Created, """{"duplicate":false}""")));

        var result = await service.RunCloudModeAsync(SubmitOrderCommand(), CancellationToken.None);

        Assert.True(result.Accepted);
        Assert.True(result.Reported);
        Assert.Equal("succeeded", result.ReportedOutcome);
        Assert.Equal("bridge_accepted", result.ReportedResultType);
        Assert.Equal("order-123", result.ExternalOrderId);
        Assert.Equal(1, protocol.AcceptCalls);
        Assert.Equal(1, protocol.ReportCalls);

        using var doc = JsonDocument.Parse(protocol.LastReportBody!);
        Assert.Equal("succeeded", doc.RootElement.GetProperty("outcome").GetString());
        Assert.Equal("order-123", doc.RootElement.GetProperty("resultPayload").GetProperty("externalOrderId").GetString());
    }

    [Fact]
    public async Task BridgeDuplicate200_ReportsSucceeded_AsIdempotentReplay_NotAFreshOrder()
    {
        var (service, _, _) = BuildService((_, _) => Task.FromResult(JsonResponse(HttpStatusCode.OK, """{"duplicate":true}""")));

        var result = await service.RunCloudModeAsync(SubmitOrderCommand(), CancellationToken.None);

        Assert.Equal("succeeded", result.ReportedOutcome);
        Assert.Equal(true, result.Duplicate);
    }

    [Fact]
    public async Task BridgeRejects400_ReportsFailed_BridgeRejected_Terminal()
    {
        var (service, _, _) = BuildService((_, _) => Task.FromResult(
            JsonResponse(HttpStatusCode.BadRequest, """{"error":"unknown table"}""")));

        var result = await service.RunCloudModeAsync(SubmitOrderCommand(), CancellationToken.None);

        Assert.Equal("failed", result.ReportedOutcome);
        Assert.Equal("bridge_rejected", result.ReportedResultType);
    }

    [Theory]
    [InlineData(HttpStatusCode.InternalServerError)]
    [InlineData(HttpStatusCode.ServiceUnavailable)]
    public async Task BridgeTransientFailure_ReportsFailed_BridgeUnreachableOrFailed(HttpStatusCode status)
    {
        var (service, _, _) = BuildService((_, _) => Task.FromResult(JsonResponse(status, "{}")));

        var result = await service.RunCloudModeAsync(SubmitOrderCommand(), CancellationToken.None);

        Assert.Equal("failed", result.ReportedOutcome);
        Assert.Equal("bridge_unreachable_or_failed", result.ReportedResultType);
    }

    [Fact]
    public async Task ConnectionRefused_ReportsFailed_BridgeUnreachableOrFailed()
    {
        var (service, _, _) = BuildService((_, _) => throw new HttpRequestException("refused"));

        var result = await service.RunCloudModeAsync(SubmitOrderCommand(), CancellationToken.None);

        Assert.Equal("failed", result.ReportedOutcome);
        Assert.Equal("bridge_unreachable_or_failed", result.ReportedResultType);
    }

    [Fact]
    public async Task BridgeTimeout_AcceptsButNeverReports_StaysAmbiguousForReconciliation()
    {
        // A short bridge timeout is required to keep this test fast — the
        // shared BuildService helper's default timeout is deliberately
        // longer, so this test wires its own IdealposBridgeClient directly.
        var bridgeHttpClient = new HttpClient(new BridgeHandler(async (_, ct) => { await Task.Delay(Timeout.Infinite, ct); return JsonResponse(HttpStatusCode.OK, "{}"); }))
        { BaseAddress = new Uri("http://127.0.0.1:5588/") };
        var fastBridgeClient = new IdealposBridgeClient(bridgeHttpClient, "test-key", TimeSpan.FromMilliseconds(50));
        var log = new DurableLocalLog(Path.Combine(_tempDir, $"{Guid.NewGuid()}.ndjson"));
        var protocolHandler = new RoutingProtocolHandler();
        var protocolClient = new ConnectorCommandProtocolClient(
            new HttpClient(protocolHandler) { BaseAddress = new Uri("http://localhost/api/") }, "installation-1.secret");
        var fastService = new IdealposOrderSubmissionService(fastBridgeClient, log, protocolClient);

        var result = await fastService.RunCloudModeAsync(SubmitOrderCommand(), CancellationToken.None);

        Assert.True(result.Accepted, "The command was durably accepted before the ambiguous Bridge call.");
        Assert.False(result.Reported, "An ambiguous outcome must never be reported as a definite success or failure.");
        Assert.Equal(1, protocolHandler.AcceptCalls);
        Assert.Equal(0, protocolHandler.ReportCalls);
        Assert.NotNull(result.FailClosedReason);
    }

    [Fact]
    public async Task UnsupportedSchemaVersion_NeverAcceptsOrReports_LeftForReclaim()
    {
        var (service, protocol, _) = BuildService((_, _) => throw new InvalidOperationException("Bridge must never be called for an unsupported schema version."));

        var result = await service.RunCloudModeAsync(SubmitOrderCommand(schemaVersion: 99), CancellationToken.None);

        Assert.False(result.Accepted);
        Assert.False(result.Reported);
        Assert.Equal(0, protocol.AcceptCalls);
        Assert.Equal(0, protocol.ReportCalls);
        Assert.NotNull(result.FailClosedReason);
    }

    [Theory]
    [MemberData(nameof(MalformedPayloads))]
    public async Task MalformedPayload_AcceptsAndReportsFailed_NeverCallsBridge(Dictionary<string, object?> payload)
    {
        var (service, protocol, _) = BuildService((_, _) => throw new InvalidOperationException("Bridge must never be called for a malformed payload."));

        var result = await service.RunCloudModeAsync(SubmitOrderCommand(payload: payload), CancellationToken.None);

        Assert.True(result.Accepted);
        Assert.True(result.Reported);
        Assert.Equal("failed", result.ReportedOutcome);
        Assert.Equal("connector_payload_invalid", result.ReportedResultType);
        Assert.Equal(1, protocol.AcceptCalls);
        Assert.Equal(1, protocol.ReportCalls);
    }

    public static IEnumerable<object[]> MalformedPayloads()
    {
        yield return [new Dictionary<string, object?> { ["table"] = "T4", ["items"] = new List<object>() }]; // missing externalOrderId
        yield return [new Dictionary<string, object?> { ["externalOrderId"] = "order-1", ["items"] = new List<object>() }]; // missing table
        yield return [new Dictionary<string, object?> { ["externalOrderId"] = "order-1", ["table"] = "T4", ["items"] = new List<object>() }]; // empty items
        yield return [new Dictionary<string, object?>
        {
            ["externalOrderId"] = "order-1",
            ["table"] = "T4",
            ["items"] = new List<object> { new Dictionary<string, object?> { ["productCode"] = "", ["quantity"] = 1 } },
        }]; // blank productCode
    }

    [Fact]
    public async Task PayloadNeverContainsPriceOrPaymentFields_EvenIfServerSentThem()
    {
        // Defense in depth: even if a future bug on the server side ever
        // added a price field to the payload, BridgeOrderRequest has no
        // property to carry it — it is structurally dropped, never forwarded.
        var payloadWithExtraFields = SamplePayload();
        payloadWithExtraFields["price"] = 42.50m;
        payloadWithExtraFields["gstAmount"] = 4.25m;

        string? capturedBody = null;
        var (service, _, _) = BuildService(async (req, ct) =>
        {
            capturedBody = req.Content is null ? null : await req.Content.ReadAsStringAsync(ct);
            return JsonResponse(HttpStatusCode.Created, """{"duplicate":false}""");
        });

        await service.RunCloudModeAsync(SubmitOrderCommand(payload: payloadWithExtraFields), CancellationToken.None);

        Assert.NotNull(capturedBody);
        using var doc = JsonDocument.Parse(capturedBody!);
        Assert.False(doc.RootElement.TryGetProperty("price", out _));
        Assert.False(doc.RootElement.TryGetProperty("gstAmount", out _));
    }

    [Fact]
    public async Task RetryOfSameCommand_ReusesTheSameExternalOrderId_NeverGeneratesAFreshOne()
    {
        var (service, _, _) = BuildService((_, _) => Task.FromResult(JsonResponse(HttpStatusCode.OK, """{"duplicate":true}""")));

        var first = await service.RunCloudModeAsync(SubmitOrderCommand(), CancellationToken.None);
        // Simulate a connector restart: a brand-new service instance (fresh
        // in-memory state, fresh log) handling a redelivery of the exact
        // same durable command.
        var (serviceAfterRestart, _, _) = BuildService((_, _) => Task.FromResult(JsonResponse(HttpStatusCode.OK, """{"duplicate":true}""")));
        var second = await serviceAfterRestart.RunCloudModeAsync(SubmitOrderCommand(), CancellationToken.None);

        Assert.Equal(first.ExternalOrderId, second.ExternalOrderId);
        Assert.Equal("order-123", second.ExternalOrderId);
    }

    public void Dispose()
    {
        if (Directory.Exists(_tempDir)) Directory.Delete(_tempDir, recursive: true);
    }
}
