using System.Net;
using System.Text.Json;
using VerduraIdealposTracer.Core.OrderSubmission;
using Xunit;

namespace VerduraIdealposTracer.Tests;

/// <summary>
/// Verifies IdealposBridgeClient's outgoing request shape and its response
/// classification against IdealposBridge's actual documented contract
/// (POST /api/orders — 201 create, 200 duplicate, 400 validation, 5xx/401
/// as definite failure, connection failure as definite failure, and a
/// withheld response as ambiguous/never-reported). No real Bridge or
/// network is used — a fake HttpMessageHandler stands in, following the
/// same pattern as ConnectorCommandProtocolClientTests.
/// </summary>
public sealed class IdealposBridgeClientTests
{
    private sealed class FakeHandler(Func<HttpRequestMessage, CancellationToken, Task<HttpResponseMessage>> respond) : HttpMessageHandler
    {
        public HttpRequestMessage? LastRequest { get; private set; }
        public string? LastRequestBody { get; private set; }

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            LastRequest = request;
            LastRequestBody = request.Content is null ? null : await request.Content.ReadAsStringAsync(cancellationToken);
            return await respond(request, cancellationToken);
        }
    }

    private static (IdealposBridgeClient Client, FakeHandler Handler) Build(
        Func<HttpRequestMessage, CancellationToken, Task<HttpResponseMessage>> respond,
        TimeSpan? timeout = null)
    {
        var handler = new FakeHandler(respond);
        var httpClient = new HttpClient(handler) { BaseAddress = new Uri("http://127.0.0.1:5588/") };
        var client = new IdealposBridgeClient(httpClient, "test-api-key", timeout ?? TimeSpan.FromSeconds(5));
        return (client, handler);
    }

    private static BridgeOrderRequest SampleRequest() => new(
        ExternalOrderId: "order-123",
        Table: "T4",
        Items: [new BridgeOrderItem("PLU-1", 2), new BridgeOrderItem("PLU-2", 1)],
        Notes: "no onions");

    private static HttpResponseMessage JsonResponse(HttpStatusCode status, string body) =>
        new(status) { Content = new StringContent(body, System.Text.Encoding.UTF8, "application/json") };

    [Fact]
    public async Task SubmitOrderAsync_SendsExactRequestShape_NoPriceOrPaymentFields()
    {
        var (client, handler) = Build((_, _) => Task.FromResult(JsonResponse(HttpStatusCode.Created, """{"duplicate":false}""")));

        await client.SubmitOrderAsync(SampleRequest(), CancellationToken.None);

        Assert.Equal(HttpMethod.Post, handler.LastRequest!.Method);
        Assert.Equal("http://127.0.0.1:5588/api/orders", handler.LastRequest.RequestUri!.ToString());
        Assert.Equal("Bearer", handler.LastRequest.Headers.Authorization!.Scheme);
        Assert.Equal("test-api-key", handler.LastRequest.Headers.Authorization.Parameter);

        using var doc = JsonDocument.Parse(handler.LastRequestBody!);
        var root = doc.RootElement;
        Assert.Equal("order-123", root.GetProperty("externalOrderId").GetString());
        Assert.Equal("T4", root.GetProperty("table").GetString());
        Assert.Equal(2, root.GetProperty("items").GetArrayLength());
        Assert.Equal("PLU-1", root.GetProperty("items")[0].GetProperty("productCode").GetString());
        Assert.Equal(2, root.GetProperty("items")[0].GetProperty("quantity").GetInt32());
        Assert.Equal("no onions", root.GetProperty("notes").GetString());

        // Structural guarantee, not just an assertion: BridgeOrderRequest has
        // no price/payment/tender property to serialize in the first place.
        foreach (var forbidden in new[] { "price", "total", "tender", "payment", "gst", "tax" })
        {
            Assert.False(root.TryGetProperty(forbidden, out _), $"Request must never contain '{forbidden}'.");
        }
    }

    [Fact]
    public async Task Response201Created_ClassifiedAsAccepted()
    {
        var (client, _) = Build((_, _) => Task.FromResult(JsonResponse(HttpStatusCode.Created, """{"duplicate":false,"externalOrderId":"order-123"}""")));

        var result = await client.SubmitOrderAsync(SampleRequest(), CancellationToken.None);

        Assert.Equal(BridgeSubmitOutcome.Accepted, result.Outcome);
        Assert.Equal(false, result.Duplicate);
        Assert.Equal(201, result.HttpStatusCode);
    }

    [Fact]
    public async Task Response200Duplicate_ClassifiedAsAcceptedIdempotentReplay()
    {
        var (client, _) = Build((_, _) => Task.FromResult(JsonResponse(HttpStatusCode.OK, """{"duplicate":true}""")));

        var result = await client.SubmitOrderAsync(SampleRequest(), CancellationToken.None);

        Assert.Equal(BridgeSubmitOutcome.Accepted, result.Outcome);
        Assert.Equal(true, result.Duplicate);
    }

    [Theory]
    [InlineData("failed")]
    [InlineData("rejected")]
    [InlineData("uncertain")]
    public async Task Response200Duplicate_WithTerminalNegativeStatus_ClassifiedAsRejected_NeverFalseAccepted(string bridgeStatus)
    {
        // Reproduces a real defect: a first delivery attempt fails at Bridge
        // (e.g. InsertOrders() throws -> Bridge records status=failed, HTTP
        // 502 -> connector classifies as UnreachableOrFailed -> transient
        // retry). The retry carries the SAME externalOrderId, so Bridge's
        // own idempotency store short-circuits to its idempotent-replay path
        // (200, duplicate:true) and echoes the ORIGINAL terminal-negative
        // status verbatim -- IdealPOS never actually processed this order,
        // and never will via this externalOrderId. Classifying this as
        // Accepted would report a false "succeeded" outcome to Verdura.
        var (client, _) = Build((_, _) => Task.FromResult(JsonResponse(HttpStatusCode.OK,
            $$"""{"duplicate":true,"status":"{{bridgeStatus}}","lastError":"IdealPOS DB timeout"}""")));

        var result = await client.SubmitOrderAsync(SampleRequest(), CancellationToken.None);

        Assert.Equal(BridgeSubmitOutcome.Rejected, result.Outcome);
        Assert.Equal(200, result.HttpStatusCode);
        Assert.Contains(bridgeStatus, result.SanitizedDetail);
        Assert.Contains("IdealPOS DB timeout", result.SanitizedDetail);
    }

    [Theory]
    [InlineData("submitted_to_idealpos")]
    [InlineData("pending_idealpos_processing")]
    [InlineData("processed")]
    [InlineData("assigned_to_table")]
    [InlineData("paid")]
    [InlineData("closed")]
    public async Task Response200Duplicate_WithRealProgressStatus_StillClassifiedAsAccepted(string bridgeStatus)
    {
        var (client, _) = Build((_, _) => Task.FromResult(JsonResponse(HttpStatusCode.OK,
            $$"""{"duplicate":true,"status":"{{bridgeStatus}}"}""")));

        var result = await client.SubmitOrderAsync(SampleRequest(), CancellationToken.None);

        Assert.Equal(BridgeSubmitOutcome.Accepted, result.Outcome);
    }

    [Fact]
    public async Task Response400UnknownTable_ClassifiedAsRejected_NeverAccepted()
    {
        var (client, _) = Build((_, _) => Task.FromResult(
            JsonResponse(HttpStatusCode.BadRequest, """{"error":"validation_failed","errors":["unknown table"]}""")));

        var result = await client.SubmitOrderAsync(SampleRequest(), CancellationToken.None);

        Assert.Equal(BridgeSubmitOutcome.Rejected, result.Outcome);
        Assert.Equal(400, result.HttpStatusCode);
        Assert.Contains("unknown table", result.SanitizedDetail);
    }

    [Theory]
    [InlineData(HttpStatusCode.InternalServerError)]
    [InlineData(HttpStatusCode.ServiceUnavailable)]
    [InlineData(HttpStatusCode.BadGateway)] // Bridge's own idealpos_submission_failed
    [InlineData(HttpStatusCode.Unauthorized)] // misconfigured API key
    public async Task DefiniteNonSuccessStatuses_ClassifiedAsUnreachableOrFailed_SafeToRetry(HttpStatusCode status)
    {
        var (client, _) = Build((_, _) => Task.FromResult(JsonResponse(status, """{"error":"server_error"}""")));

        var result = await client.SubmitOrderAsync(SampleRequest(), CancellationToken.None);

        Assert.Equal(BridgeSubmitOutcome.UnreachableOrFailed, result.Outcome);
        Assert.Equal((int)status, result.HttpStatusCode);
    }

    [Fact]
    public async Task ConnectionRefused_ClassifiedAsUnreachableOrFailed_DefiniteNotAmbiguous()
    {
        var (client, _) = Build((_, _) => throw new HttpRequestException("Connection refused"));

        var result = await client.SubmitOrderAsync(SampleRequest(), CancellationToken.None);

        Assert.Equal(BridgeSubmitOutcome.UnreachableOrFailed, result.Outcome);
        Assert.Null(result.HttpStatusCode);
        Assert.DoesNotContain("test-api-key", result.SanitizedDetail); // never leaks the credential
    }

    [Fact]
    public async Task ResponseWithheldPastTimeout_ThrowsAmbiguousException_NeverADefiniteOutcome()
    {
        var (client, _) = Build(
            async (_, ct) => { await Task.Delay(Timeout.Infinite, ct); return JsonResponse(HttpStatusCode.OK, "{}"); },
            timeout: TimeSpan.FromMilliseconds(50));

        await Assert.ThrowsAsync<BridgeSubmissionAmbiguousException>(
            () => client.SubmitOrderAsync(SampleRequest(), CancellationToken.None));
    }

    [Fact]
    public async Task MalformedJsonBodyOn201_StillClassifiedAsAccepted_StatusCodeIsTheEvidence()
    {
        var (client, _) = Build((_, _) => Task.FromResult(
            new HttpResponseMessage(HttpStatusCode.Created) { Content = new StringContent("not json{{{", System.Text.Encoding.UTF8, "application/json") }));

        var result = await client.SubmitOrderAsync(SampleRequest(), CancellationToken.None);

        Assert.Equal(BridgeSubmitOutcome.Accepted, result.Outcome);
        Assert.Null(result.Duplicate); // could not be determined — but acceptance itself is not in doubt
    }

    [Fact]
    public async Task EmptyBodyOn201_StillClassifiedAsAccepted()
    {
        var (client, _) = Build((_, _) => Task.FromResult(new HttpResponseMessage(HttpStatusCode.Created)));

        var result = await client.SubmitOrderAsync(SampleRequest(), CancellationToken.None);

        Assert.Equal(BridgeSubmitOutcome.Accepted, result.Outcome);
    }

    [Fact]
    public async Task UnexpectedStatusCode_ClassifiedAsUnreachableOrFailed()
    {
        var (client, _) = Build((_, _) => Task.FromResult(new HttpResponseMessage(HttpStatusCode.MovedPermanently)));

        var result = await client.SubmitOrderAsync(SampleRequest(), CancellationToken.None);

        Assert.Equal(BridgeSubmitOutcome.UnreachableOrFailed, result.Outcome);
    }
}
