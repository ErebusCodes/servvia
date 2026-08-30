using System.Net;
using System.Text.Json;
using VerduraIdealposTracer.Core.Protocol;
using Xunit;

namespace VerduraIdealposTracer.Tests;

/// <summary>
/// Asserts the wire contract stays camelCase, matching Story 2-10's real
/// NestJS DTOs (`outcome`, `resultType`, `idempotencyKey`, etc.).
/// Independent review initially suspected a real serialization-casing bug
/// here; reverting the explicit JsonSerializerOptions in
/// ConnectorCommandProtocolClient and re-running these exact tests proved
/// both still passed — System.Net.Http.Json's JsonContent.Create(T)/
/// ReadFromJsonAsync&lt;T&gt;() already default to JsonSerializerDefaults.Web
/// (camelCase) when no options are supplied. No bug existed; see that
/// class's own doc comment. These tests now guard the contract explicitly
/// rather than relying on that implicit library default.
/// </summary>
public sealed class ConnectorCommandProtocolClientTests
{
    private sealed class CapturingHandler : HttpMessageHandler
    {
        public string? CapturedRequestBody { get; private set; }
        public HttpResponseMessage ResponseToReturn { get; set; } = new(HttpStatusCode.OK)
        {
            Content = new StringContent("{\"commands\":[]}", System.Text.Encoding.UTF8, "application/json"),
        };

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            if (request.Content is not null)
            {
                CapturedRequestBody = await request.Content.ReadAsStringAsync(cancellationToken);
            }
            return ResponseToReturn;
        }
    }

    [Fact]
    public async Task ReportAsync_SerializesTheRequestBodyAsCamelCase_MatchingTheRealBackendDto()
    {
        var handler = new CapturingHandler
        {
            ResponseToReturn = new HttpResponseMessage(HttpStatusCode.OK),
        };
        using var httpClient = new HttpClient(handler) { BaseAddress = new Uri("http://localhost/api/") };
        var client = new ConnectorCommandProtocolClient(httpClient, "installation-1.secret");

        await client.ReportAsync(
            "cmd-1",
            new ReportRequest("succeeded", "IDEALPOS_UI_DISCOVERY_V1", new Dictionary<string, object?> { ["foo"] = "bar" }, "idem-1"),
            CancellationToken.None);

        Assert.NotNull(handler.CapturedRequestBody);
        using var doc = JsonDocument.Parse(handler.CapturedRequestBody!);
        var root = doc.RootElement;

        // Every key must be camelCase, matching ConnectorCommandReportDto's
        // real field names — a PascalCase key here would mean the real
        // backend's whitelist ValidationPipe silently drops the field.
        Assert.True(root.TryGetProperty("outcome", out var outcome));
        Assert.Equal("succeeded", outcome.GetString());
        Assert.True(root.TryGetProperty("resultType", out _));
        Assert.True(root.TryGetProperty("resultPayload", out _));
        Assert.True(root.TryGetProperty("idempotencyKey", out _));
        Assert.False(root.TryGetProperty("Outcome", out _), "PascalCase 'Outcome' must not appear — the real backend would never see it.");
    }

    [Fact]
    public async Task PollAsync_DeserializesARealShapedCamelCaseResponse()
    {
        var handler = new CapturingHandler
        {
            ResponseToReturn = new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent(
                    """{"commands":[{"id":"cmd-1","commandType":"connector.self_test.v1","schemaVersion":1,"payload":{"echoNonce":"abc"},"requiredCapability":"connector.self_test.v1"}]}""",
                    System.Text.Encoding.UTF8,
                    "application/json"),
            },
        };
        using var httpClient = new HttpClient(handler) { BaseAddress = new Uri("http://localhost/api/") };
        var client = new ConnectorCommandProtocolClient(httpClient, "installation-1.secret");

        var result = await client.PollAsync(CancellationToken.None);

        Assert.Single(result.Commands);
        Assert.Equal("cmd-1", result.Commands[0].Id);
        Assert.Equal("connector.self_test.v1", result.Commands[0].CommandType);
        Assert.Equal(1, result.Commands[0].SchemaVersion);
        Assert.Equal("connector.self_test.v1", result.Commands[0].RequiredCapability);
    }

    [Fact]
    public async Task HeartbeatAsync_SerializesCapabilitiesAsCamelCaseObject_MatchingConnectorHeartbeatDto()
    {
        var handler = new CapturingHandler
        {
            ResponseToReturn = new HttpResponseMessage(HttpStatusCode.OK),
        };
        using var httpClient = new HttpClient(handler) { BaseAddress = new Uri("http://localhost/api/") };
        var client = new ConnectorCommandProtocolClient(httpClient, "installation-1.secret");

        await client.HeartbeatAsync(
            new HeartbeatRequest(Version: null, Capabilities: new Dictionary<string, object?> { ["idealpos.submit_order.v1"] = true }),
            CancellationToken.None);

        Assert.NotNull(handler.CapturedRequestBody);
        using var doc = JsonDocument.Parse(handler.CapturedRequestBody!);
        var root = doc.RootElement;

        // apps/api/src/connector/dto/connector-heartbeat.dto.ts expects
        // camelCase `capabilities` as a plain object (@IsObject()) — an
        // array here would fail that DTO's validation and the real
        // reportHealth() call would never persist anything.
        Assert.True(root.TryGetProperty("capabilities", out var capabilities));
        Assert.Equal(JsonValueKind.Object, capabilities.ValueKind);
        Assert.True(capabilities.TryGetProperty("idealpos.submit_order.v1", out _));
        Assert.False(root.TryGetProperty("Capabilities", out _), "PascalCase 'Capabilities' must not appear — the real backend's whitelist ValidationPipe would silently drop it.");
    }
}
