using System.Net;
using System.Text;
using System.Text.Json;
using VerduraIdealposTracer.Core.OrderSubmission;
using VerduraIdealposTracer.Core.Persistence;
using VerduraIdealposTracer.Core.Protocol;
using Xunit;

namespace VerduraIdealposTracer.Tests;

/// <summary>
/// Command-level evidence for the idealpos.order_status.v1 probe handler,
/// using the same fake-HttpMessageHandler technique as
/// <see cref="IdealposOrderSubmissionServiceTests"/>.
///
/// The central property these tests defend: this handler classifies only
/// the TRANSPORT outcome and forwards Bridge's record verbatim. It must
/// never interpret a table, and must never report anything resembling a
/// confirmation — that decision belongs exclusively to the server-side
/// decideConfirmation.
/// </summary>
public sealed class IdealposOrderStatusServiceTests : IDisposable
{
    private readonly string _tempDir = Directory.CreateTempSubdirectory("order-status-tests-").FullName;

    private sealed class BridgeHandler(Func<HttpRequestMessage, CancellationToken, Task<HttpResponseMessage>> respond) : HttpMessageHandler
    {
        public int Calls { get; private set; }
        public string? LastPath { get; private set; }
        public string? LastMethod { get; private set; }

        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            Calls++;
            LastPath = request.RequestUri!.AbsolutePath;
            LastMethod = request.Method.Method;
            return respond(request, cancellationToken);
        }
    }

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

    private static ClaimedCommand StatusCommand(
        string commandId = "cmd-1",
        int schemaVersion = 1,
        Dictionary<string, object?>? payload = null) => new(
        Id: commandId,
        CommandType: IdealposOrderStatusService.CommandType,
        SchemaVersion: schemaVersion,
        Payload: payload ?? new Dictionary<string, object?> { ["externalOrderId"] = "order-123" },
        RequiredCapability: IdealposOrderStatusService.CommandType);

    private (IdealposOrderStatusService Service, RoutingProtocolHandler Protocol, BridgeHandler Bridge) BuildService(
        Func<HttpRequestMessage, CancellationToken, Task<HttpResponseMessage>> bridgeRespond,
        TimeSpan? timeout = null)
    {
        var bridgeHandler = new BridgeHandler(bridgeRespond);
        var bridgeHttpClient = new HttpClient(bridgeHandler) { BaseAddress = new Uri("http://127.0.0.1:5588/") };
        var bridgeClient = new IdealposBridgeClient(bridgeHttpClient, "test-key", timeout ?? TimeSpan.FromSeconds(2));

        var protocolHandler = new RoutingProtocolHandler();
        var protocolHttpClient = new HttpClient(protocolHandler) { BaseAddress = new Uri("http://localhost/api/") };
        var protocolClient = new ConnectorCommandProtocolClient(protocolHttpClient, "installation-1.secret");

        var log = new DurableLocalLog(Path.Combine(_tempDir, $"{Guid.NewGuid()}.ndjson"));
        return (new IdealposOrderStatusService(bridgeClient, log, protocolClient), protocolHandler, bridgeHandler);
    }

    private static HttpResponseMessage Json(HttpStatusCode code, string body) =>
        new(code) { Content = new StringContent(body, Encoding.UTF8, "application/json") };

    private const string AssignedBody = """
        {"externalOrderId":"order-123","status":"assigned_to_table","table":"12",
         "posServerPendingSaleCode":"12","tableMatchesRequest":true,"tableAssignedNatively":false}
        """;

    private static JsonElement ParseReport(string? body) => JsonDocument.Parse(body!).RootElement;

    [Fact]
    public async Task Reads_the_order_status_endpoint_with_a_GET_and_reports_the_body_verbatim()
    {
        var (service, protocol, bridge) = BuildService((_, _) => Task.FromResult(Json(HttpStatusCode.OK, AssignedBody)));

        var result = await service.RunCloudModeAsync(StatusCommand(), CancellationToken.None);

        Assert.Equal("GET", bridge.LastMethod);
        Assert.Equal("/api/orders/order-123", bridge.LastPath);
        Assert.Equal(1, protocol.AcceptCalls);
        Assert.Equal(1, protocol.ReportCalls);
        Assert.Equal("succeeded", result.ReportedOutcome);
        Assert.Equal("bridge_order_status", result.ReportedResultType);

        var report = ParseReport(protocol.LastReportBody);
        var body = report.GetProperty("resultPayload").GetProperty("body");
        Assert.Equal("assigned_to_table", body.GetProperty("status").GetString());
        // Forwarded untouched — the connector does not pre-judge the table.
        Assert.Equal("12", body.GetProperty("posServerPendingSaleCode").GetString());
        Assert.True(body.GetProperty("tableMatchesRequest").GetBoolean());
    }

    [Fact]
    public async Task A_404_is_a_real_answer_reported_as_not_found_never_as_failure()
    {
        var (service, protocol, _) = BuildService((_, _) =>
            Task.FromResult(Json(HttpStatusCode.NotFound, """{"error":"not_found"}""")));

        var result = await service.RunCloudModeAsync(StatusCommand(), CancellationToken.None);

        Assert.Equal("succeeded", result.ReportedOutcome);
        Assert.Equal("bridge_order_not_found", result.ReportedResultType);
        var report = ParseReport(protocol.LastReportBody);
        // No body key at all — the server must not read an absent record as
        // "nothing observed on the table".
        Assert.False(report.GetProperty("resultPayload").TryGetProperty("body", out _));
    }

    [Fact]
    public async Task An_unreachable_bridge_is_reported_as_unreachable_not_as_evidence()
    {
        var (service, _, _) = BuildService((_, _) => throw new HttpRequestException("connection refused"));

        var result = await service.RunCloudModeAsync(StatusCommand(), CancellationToken.None);

        Assert.Equal("failed", result.ReportedOutcome);
        Assert.Equal("bridge_unreachable_or_failed", result.ReportedResultType);
    }

    [Fact]
    public async Task A_bridge_timeout_is_reported_as_unreachable_and_never_as_an_answer()
    {
        var (service, _, _) = BuildService(async (_, ct) =>
        {
            await Task.Delay(TimeSpan.FromSeconds(5), ct);
            return Json(HttpStatusCode.OK, AssignedBody);
        }, TimeSpan.FromMilliseconds(50));

        var result = await service.RunCloudModeAsync(StatusCommand(), CancellationToken.None);

        Assert.Equal("failed", result.ReportedOutcome);
        Assert.Equal("bridge_unreachable_or_failed", result.ReportedResultType);
    }

    [Theory]
    [InlineData("not json at all")]
    [InlineData("[1,2,3]")]
    [InlineData("\"a bare string\"")]
    [InlineData("")]
    public async Task A_2xx_whose_body_is_not_an_object_is_reported_unreadable_never_as_an_empty_record(string body)
    {
        var (service, protocol, _) = BuildService((_, _) => Task.FromResult(Json(HttpStatusCode.OK, body)));

        var result = await service.RunCloudModeAsync(StatusCommand(), CancellationToken.None);

        Assert.Equal("failed", result.ReportedOutcome);
        Assert.Equal("bridge_status_unreadable", result.ReportedResultType);
        var report = ParseReport(protocol.LastReportBody);
        Assert.False(report.GetProperty("resultPayload").TryGetProperty("body", out _));
    }

    [Theory]
    [InlineData(HttpStatusCode.Unauthorized)]
    [InlineData(HttpStatusCode.InternalServerError)]
    [InlineData(HttpStatusCode.BadGateway)]
    public async Task A_non_2xx_non_404_response_yields_no_evidence(HttpStatusCode code)
    {
        var (service, _, _) = BuildService((_, _) => Task.FromResult(Json(code, "{}")));

        var result = await service.RunCloudModeAsync(StatusCommand(), CancellationToken.None);

        Assert.Equal("failed", result.ReportedOutcome);
        Assert.Equal("bridge_unreachable_or_failed", result.ReportedResultType);
    }

    [Fact]
    public async Task An_unsupported_schema_version_is_left_unclaimed_and_never_reported()
    {
        var (service, protocol, bridge) = BuildService((_, _) => Task.FromResult(Json(HttpStatusCode.OK, AssignedBody)));

        var result = await service.RunCloudModeAsync(StatusCommand(schemaVersion: 99), CancellationToken.None);

        Assert.False(result.Accepted);
        Assert.False(result.Reported);
        Assert.Equal(0, protocol.AcceptCalls);
        Assert.Equal(0, protocol.ReportCalls);
        Assert.Equal(0, bridge.Calls); // Bridge is never contacted
    }

    [Fact]
    public async Task A_malformed_payload_fails_deterministically_without_contacting_bridge()
    {
        var (service, protocol, bridge) = BuildService((_, _) => Task.FromResult(Json(HttpStatusCode.OK, AssignedBody)));

        var result = await service.RunCloudModeAsync(
            StatusCommand(payload: new Dictionary<string, object?> { ["externalOrderId"] = "  " }),
            CancellationToken.None);

        Assert.Equal("failed", result.ReportedOutcome);
        Assert.Equal("connector_payload_invalid", result.ReportedResultType);
        Assert.Equal(0, bridge.Calls);
        Assert.Equal(1, protocol.ReportCalls);
    }

    [Fact]
    public async Task The_report_idempotency_key_is_stable_per_command_so_a_replay_is_never_a_second_report()
    {
        var (service, protocol, _) = BuildService((_, _) => Task.FromResult(Json(HttpStatusCode.OK, AssignedBody)));

        await service.RunCloudModeAsync(StatusCommand("cmd-42"), CancellationToken.None);
        var first = ParseReport(protocol.LastReportBody).GetProperty("idempotencyKey").GetString();

        // Duplicate delivery of the very same command — the probe is a pure
        // read, so re-running it is side-effect free and must key identically.
        await service.RunCloudModeAsync(StatusCommand("cmd-42"), CancellationToken.None);
        var second = ParseReport(protocol.LastReportBody).GetProperty("idempotencyKey").GetString();

        Assert.Equal(first, second);
        Assert.Equal("idealpos-order-status-report:cmd-42", first);
    }

    [Fact]
    public async Task Repeated_probes_of_the_same_order_are_side_effect_free_reads()
    {
        var (service, protocol, bridge) = BuildService((_, _) => Task.FromResult(Json(HttpStatusCode.OK, AssignedBody)));

        for (var i = 0; i < 3; i++)
        {
            await service.RunCloudModeAsync(StatusCommand($"cmd-{i}"), CancellationToken.None);
        }

        Assert.Equal(3, bridge.Calls);
        Assert.Equal(3, protocol.ReportCalls);
        Assert.Equal("GET", bridge.LastMethod); // never anything but a read
    }

    [Fact]
    public async Task The_external_order_id_is_escaped_and_cannot_traverse_to_another_endpoint()
    {
        var (service, _, bridge) = BuildService((_, _) => Task.FromResult(Json(HttpStatusCode.OK, AssignedBody)));

        await service.RunCloudModeAsync(
            StatusCommand(payload: new Dictionary<string, object?> { ["externalOrderId"] = "../../api/health" }),
            CancellationToken.None);

        Assert.Equal("/api/orders/..%2F..%2Fapi%2Fhealth", bridge.LastPath);
    }

    [Fact]
    public async Task The_result_never_carries_a_table_verdict_of_its_own()
    {
        var (service, protocol, _) = BuildService((_, _) => Task.FromResult(Json(HttpStatusCode.OK, AssignedBody)));

        await service.RunCloudModeAsync(StatusCommand(), CancellationToken.None);

        var payload = ParseReport(protocol.LastReportBody).GetProperty("resultPayload");
        // Only transport facts plus the verbatim body live at the top level.
        var keys = payload.EnumerateObject().Select(p => p.Name).OrderBy(n => n).ToArray();
        Assert.Equal(new[] { "body", "externalOrderId", "httpStatusCode" }, keys);
    }

    public void Dispose()
    {
        try { Directory.Delete(_tempDir, recursive: true); } catch { /* best effort */ }
    }
}
