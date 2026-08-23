using System.Net.Http.Json;
using System.Text.Json;

namespace VerduraIdealposTracer.Core.Protocol;

public sealed record ClaimedCommand(
    string Id,
    string CommandType,
    int SchemaVersion,
    Dictionary<string, object?> Payload,
    string? RequiredCapability);

public sealed record PollResponse(List<ClaimedCommand> Commands);

public sealed record ReportRequest(
    string Outcome,
    string ResultType,
    Dictionary<string, object?>? ResultPayload,
    string IdempotencyKey,
    string? FailureReason = null);

/// <summary>
/// A thin, cross-platform client for Story 2-10's authenticated HTTPS
/// command protocol (docs/decisions-log.md DL-070) — poll, accept, report.
/// Every call carries the same Story 2-9 durable connector credential
/// (`Authorization: Bearer {installationId}.{secret}`) Story 2-10 already
/// established; this class adds no new authentication mechanism. Used by
/// the discovery tracer's "cloud mode" — see <c>LocalTracerMode</c> for the
/// isolated mode that does not use this class at all.
/// </summary>
public sealed class ConnectorCommandProtocolClient(HttpClient httpClient, string credential)
{
    // Story 2-10's NestJS backend serializes and expects camelCase JSON
    // (its DTO fields are `outcome`, `resultType`, `idempotencyKey`, etc.).
    // Independent review initially suspected a real bug here — plain
    // System.Text.Json defaults to case-sensitive PascalCase matching — but
    // reverting this options block and re-running
    // ConnectorCommandProtocolClientTests proved both tests still passed:
    // System.Net.Http.Json's JsonContent.Create(T)/ReadFromJsonAsync<T>()
    // convenience methods default to JsonSerializerDefaults.Web (camelCase,
    // case-insensitive) when no options are supplied, which this class
    // already relied on implicitly. No bug existed. This explicit options
    // block is kept anyway — not as a fix, but so the camelCase contract is
    // asserted rather than inherited silently from a library default a
    // future change (e.g. swapping to a raw JsonSerializer.Serialize call)
    // could easily lose.
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = true,
    };

    private void AddAuthHeader(HttpRequestMessage request)
    {
        request.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", credential);
    }

    public async Task<PollResponse> PollAsync(CancellationToken cancellationToken)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, "connector/commands/poll");
        AddAuthHeader(request);
        using var response = await httpClient.SendAsync(request, cancellationToken);
        response.EnsureSuccessStatusCode();
        var result = await response.Content.ReadFromJsonAsync<PollResponse>(JsonOptions, cancellationToken);
        return result ?? new PollResponse([]);
    }

    public async Task AcceptAsync(string commandId, CancellationToken cancellationToken)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, $"connector/commands/{commandId}/accept");
        AddAuthHeader(request);
        using var response = await httpClient.SendAsync(request, cancellationToken);
        response.EnsureSuccessStatusCode();
    }

    public async Task ReportAsync(string commandId, ReportRequest report, CancellationToken cancellationToken)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, $"connector/commands/{commandId}/report")
        {
            Content = JsonContent.Create(report, options: JsonOptions),
        };
        AddAuthHeader(request);
        using var response = await httpClient.SendAsync(request, cancellationToken);
        response.EnsureSuccessStatusCode();
    }
}
