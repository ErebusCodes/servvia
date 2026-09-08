using System.Linq;
using System.Net.Http.Headers;
using System.Text.Json;

namespace VerduraIdealposTracer.Core.OrderSubmission;

public sealed record BridgeOrderItem(string ProductCode, int Quantity, int? Seat = null);

/// <summary>
/// Exactly the wire shape IdealposBridge's <c>POST /api/orders</c> expects
/// (verified against IdealposBridge source, not assumed): camelCase
/// <c>externalOrderId</c>/<c>table</c>/<c>items[]</c>/<c>notes</c>. No price,
/// payment, GST, or tender field exists on this type — that is a structural
/// guarantee (mirroring <c>DiscoveryTraceResult.AssertDiscoveryOnlyInvariant</c>'s
/// approach elsewhere in this codebase), not merely a convention: nothing
/// this client sends can ever carry pricing/payment data, because there is
/// nowhere on this record to put it.
/// </summary>
public sealed record BridgeOrderRequest(string ExternalOrderId, string Table, List<BridgeOrderItem> Items, string? Notes);

public enum BridgeSubmitOutcome
{
    /// <summary>IdealposBridge returned 2xx to POST /api/orders (201 first submission, or 200 duplicate replay whose embedded <c>status</c> is not one of Bridge's own terminal-negative values). NOT evidence of native IdealPOS consumption, a KOT, or kitchen receipt.</summary>
    Accepted,

    /// <summary>IdealposBridge returned a definite rejection: either HTTP 400 (unknown table/product or malformed request), or HTTP 200 with <c>duplicate:true</c> whose embedded <c>status</c> is Bridge's own "failed"/"rejected"/"uncertain" (a prior attempt for this externalOrderId already ran to a terminal negative outcome — Bridge's own idempotency store will keep returning this exact same verdict for every future retry, so this is unambiguous and non-retryable). A real response was received and it was negative; never retried automatically by this client.</summary>
    Rejected,

    /// <summary>The connector could not reach the bridge (connection refused/DNS/TLS), or the bridge returned a non-2xx/non-400 response (5xx, 401, unexpected status). A definite response (or definite absence of one) was obtained — safe to retry with the same externalOrderId.</summary>
    UnreachableOrFailed,
}

public sealed record BridgeSubmitResult(BridgeSubmitOutcome Outcome, bool? Duplicate, string? SanitizedDetail, int? HttpStatusCode);

/// <summary>
/// The four distinct things a read of <c>GET /api/orders/{id}</c> can tell
/// us. Kept separate on purpose — see GetOrderStatusAsync's doc comment.
/// None of them is itself a confirmation: the server-side
/// <c>decideConfirmation</c> adjudicates the record.
/// </summary>
public enum BridgeStatusOutcome
{
    /// <summary>2xx with a parseable order-record object. Forwarded verbatim; NOT interpreted here.</summary>
    Ok,

    /// <summary>404 — Bridge genuinely has no record of this externalOrderId. A real answer, never evidence of failure.</summary>
    NotFound,

    /// <summary>2xx whose body was absent or not a JSON object. Bridge spoke, but unintelligibly — refused rather than guessed at.</summary>
    Unreadable,

    /// <summary>Could not reach Bridge, it timed out, or it returned a non-2xx/non-404 status. We learned nothing.</summary>
    UnreachableOrFailed,
}

public sealed record BridgeStatusResult(
    BridgeStatusOutcome Outcome,
    Dictionary<string, object?>? Body,
    string? SanitizedDetail,
    int? HttpStatusCode);

/// <summary>
/// Thrown when the outcome genuinely cannot be determined — specifically,
/// this client's own request timeout fired after the request was already
/// sent to Bridge. Bridge may have already accepted and processed the
/// order; there is no way to know from here. Callers must never convert
/// this into a definite success or failure report — see
/// idealpos-order-dispatch.constants.ts's IDEALPOS_SUBMIT_ORDER_RESULT_TYPE
/// doc comment and Phase 7 of the connector delivery task brief for why a
/// timeout must stay ambiguous rather than becoming a false terminal state.
/// </summary>
public sealed class BridgeSubmissionAmbiguousException(string message) : Exception(message);

/// <summary>
/// A narrowly-scoped HTTP client for IdealposBridge's <c>POST /api/orders</c>
/// contract (verified against IdealposBridge source: <c>Api/Endpoints.cs</c>,
/// <c>Orders/OrderService.cs</c>, <c>Orders/OrderModels.cs</c>,
/// <c>Http/JsonUtil.cs</c>). Makes exactly one attempt per call — retry
/// ownership belongs to the connector command protocol's re-poll cycle
/// (see <c>ConnectorCommandProtocolClient</c>'s own single-attempt style),
/// never multiplied here.
///
/// The base URL and API key are supplied by the caller from trusted
/// connector configuration (environment variables read once at process
/// startup) — this class has no way to accept a URL or credential from a
/// command payload, so a command can never redirect this client anywhere
/// else (no SSRF surface).
/// </summary>
public sealed class IdealposBridgeClient(HttpClient httpClient, string apiKey, TimeSpan timeout)
{
    // Matches IdealposBridge's Newtonsoft CamelCasePropertyNamesContractResolver
    // (Http/JsonUtil.cs) — verified, not assumed.
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
    };

    // Response-size sanity (Phase 6): never buffer an unbounded body just to
    // extract a `duplicate` flag or an error message.
    private const int MaxResponseChars = 64 * 1024;

    /// <summary>
    /// Reads <c>GET /api/orders/{externalOrderId}</c> — a pure read that
    /// creates, modifies and assigns nothing. One attempt per call, exactly
    /// like <see cref="SubmitOrderAsync"/>; retry ownership belongs to the
    /// command protocol's re-poll cycle.
    ///
    /// The four outcomes are deliberately NOT collapsed. A 404 is a real
    /// answer ("Bridge has no record") and must stay distinguishable from an
    /// unreachable Bridge ("we learned nothing"), because the server-side
    /// decision logic must never turn an outage into evidence about an
    /// order, nor a 404 into a failed order — Bridge's SQLite state can be
    /// lost and rebuilt.
    ///
    /// The <paramref name="externalOrderId"/> is URL-escaped before it is
    /// placed in the path, so an id can never traverse to a different
    /// endpoint.
    /// </summary>
    public async Task<BridgeStatusResult> GetOrderStatusAsync(string externalOrderId, CancellationToken cancellationToken)
    {
        using var timeoutCts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeoutCts.CancelAfter(timeout);

        using var request = new HttpRequestMessage(HttpMethod.Get, $"api/orders/{Uri.EscapeDataString(externalOrderId)}");
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", apiKey);

        HttpResponseMessage response;
        try
        {
            response = await httpClient.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, timeoutCts.Token);
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            // A read timing out is not ambiguous the way a submission is —
            // nothing was created — so it is simply "no answer".
            return new BridgeStatusResult(BridgeStatusOutcome.UnreachableOrFailed, null,
                Sanitize($"IdealposBridge did not respond within {timeout.TotalSeconds:0}s to the status read."), null);
        }
        catch (HttpRequestException ex)
        {
            return new BridgeStatusResult(BridgeStatusOutcome.UnreachableOrFailed, null,
                Sanitize($"Could not connect to IdealposBridge: {ex.GetType().Name}"), null);
        }

        using (response)
        {
            var status = (int)response.StatusCode;
            var body = await ReadBoundedBodyAsync(response, cancellationToken);

            if (status == 404)
            {
                return new BridgeStatusResult(BridgeStatusOutcome.NotFound, null, null, status);
            }

            if (status is >= 200 and <= 299)
            {
                // A 2xx whose body we cannot parse into an object is NOT a
                // success we can act on. Reported as unreadable rather than
                // silently degraded into an empty record, which the server
                // would then reason about as though Bridge had spoken.
                var parsed = TryParseObject(body);
                return parsed is null
                    ? new BridgeStatusResult(BridgeStatusOutcome.Unreadable, null,
                        Sanitize($"Bridge returned HTTP {status} with an unparseable or non-object body."), status)
                    : new BridgeStatusResult(BridgeStatusOutcome.Ok, parsed, null, status);
            }

            return new BridgeStatusResult(BridgeStatusOutcome.UnreachableOrFailed, null,
                Sanitize($"Bridge returned HTTP {status} to the status read."), status);
        }
    }

    /// <summary>
    /// Parses the body into a plain dictionary for verbatim forwarding. The
    /// connector deliberately does NOT interpret the record — every
    /// confirmation rule lives server-side in <c>decideConfirmation</c>, so
    /// this client must not pre-judge, normalise or drop fields.
    /// </summary>
    private static Dictionary<string, object?>? TryParseObject(string? body)
    {
        if (string.IsNullOrWhiteSpace(body)) return null;
        try
        {
            using var doc = JsonDocument.Parse(body);
            if (doc.RootElement.ValueKind != JsonValueKind.Object) return null;
            var result = new Dictionary<string, object?>();
            foreach (var prop in doc.RootElement.EnumerateObject())
            {
                result[prop.Name] = ToClrValue(prop.Value);
            }
            return result;
        }
        catch (JsonException)
        {
            return null;
        }
    }

    private static object? ToClrValue(JsonElement element) => element.ValueKind switch
    {
        JsonValueKind.String => element.GetString(),
        JsonValueKind.True => true,
        JsonValueKind.False => false,
        JsonValueKind.Null or JsonValueKind.Undefined => null,
        JsonValueKind.Number => element.TryGetInt64(out var l) ? l : element.GetDouble(),
        JsonValueKind.Array => element.EnumerateArray().Select(ToClrValue).ToList(),
        JsonValueKind.Object => element.EnumerateObject().ToDictionary(p => p.Name, p => ToClrValue(p.Value)),
        _ => null,
    };

    public async Task<BridgeSubmitResult> SubmitOrderAsync(BridgeOrderRequest orderRequest, CancellationToken cancellationToken)
    {
        using var timeoutCts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeoutCts.CancelAfter(timeout);

        using var request = new HttpRequestMessage(HttpMethod.Post, "api/orders")
        {
            Content = System.Net.Http.Json.JsonContent.Create(orderRequest, options: JsonOptions),
        };
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", apiKey);

        HttpResponseMessage response;
        try
        {
            response = await httpClient.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, timeoutCts.Token);
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            // Our own timeout fired (the caller's token was not itself
            // cancelled) — the request may already have reached Bridge.
            // Never a definite outcome.
            throw new BridgeSubmissionAmbiguousException(
                $"IdealposBridge did not respond within {timeout.TotalSeconds:0}s — outcome unknown, not a definite failure.");
        }
        catch (HttpRequestException ex)
        {
            // Connection-level failure (refused/DNS/TLS handshake) — no
            // request body was ever received by a listening Bridge. Definite
            // and safe to report: a retry with the same externalOrderId can
            // never create a second logical order.
            return new BridgeSubmitResult(BridgeSubmitOutcome.UnreachableOrFailed, null,
                Sanitize($"Could not connect to IdealposBridge: {ex.GetType().Name}"), null);
        }

        using (response)
        {
            var status = (int)response.StatusCode;
            var body = await ReadBoundedBodyAsync(response, cancellationToken);

            if (status is 200 or 201)
            {
                // A 200/201 alone is NOT proof Bridge is handing this order
                // to IdealPOS: a 200 "duplicate" replay echoes whatever
                // OrderRecord.Status Bridge already had on file for this
                // externalOrderId (see IdealposBridge's OrderService.SubmitOrder
                // idempotency fast path and OrdersEndpoint's ToResponseBody) —
                // and Bridge's own idempotency store means that status can
                // legitimately be "failed" (InsertOrders() threw on the
                // original attempt), "rejected", or "uncertain" (the
                // lifecycle watcher gave up). Every future retry with the
                // same externalOrderId will keep replaying that identical
                // terminal record — IdealPOS will never actually process it.
                // Blindly treating any 2xx as Accepted here would report a
                // false "succeeded" back to Verdura for an order that in
                // truth never reached IdealPOS. Only a status this bridge
                // considers a genuine terminal-negative outcome changes the
                // classification; an absent/unrecognized status (e.g. a
                // fresh 201, or an older Bridge build not yet sending
                // `status`) keeps the prior status-code-only behaviour.
                var bridgeStatus = TryParseStatus(body);
                if (bridgeStatus is "failed" or "rejected" or "uncertain")
                {
                    var lastError = TryParseLastError(body);
                    return new BridgeSubmitResult(BridgeSubmitOutcome.Rejected, TryParseDuplicateFlag(body),
                        Sanitize($"Bridge's own record for this order is already terminal (status={bridgeStatus})" +
                                 (string.IsNullOrWhiteSpace(lastError) ? "; IdealPOS never processed it." : $": {lastError}")),
                        status);
                }
                return new BridgeSubmitResult(BridgeSubmitOutcome.Accepted, TryParseDuplicateFlag(body), null, status);
            }

            if (status == 400)
            {
                return new BridgeSubmitResult(BridgeSubmitOutcome.Rejected, null,
                    Sanitize(TryExtractErrorSummary(body) ?? "Bridge rejected the order (validation failed)."), status);
            }

            // 401 (misconfigured API key), 502 (idealpos_submission_failed —
            // InsertOrders() threw), any other 5xx, or an unexpected status:
            // a definite HTTP response was received and it was not a
            // success. Never the raw body — only a bounded, generic,
            // secret-free summary.
            return new BridgeSubmitResult(BridgeSubmitOutcome.UnreachableOrFailed, null,
                Sanitize($"Bridge returned HTTP {status}."), status);
        }
    }

    private static async Task<string?> ReadBoundedBodyAsync(HttpResponseMessage response, CancellationToken cancellationToken)
    {
        try
        {
            await using var stream = await response.Content.ReadAsStreamAsync(cancellationToken);
            using var reader = new StreamReader(stream);
            var buffer = new char[MaxResponseChars];
            var read = await reader.ReadBlockAsync(buffer, 0, buffer.Length);
            return read == 0 ? null : new string(buffer, 0, read);
        }
        catch
        {
            // Empty/unreadable body — every caller treats a null body as
            // "no extra evidence available", never as a parse failure that
            // changes the outcome (the HTTP status code alone is the
            // evidence for Accepted/Rejected/UnreachableOrFailed).
            return null;
        }
    }

    /// <summary>The order-record <c>status</c> field Bridge's OrdersEndpoint.ToResponseBody
    /// always includes (IdealposBridge's OrderStatusExtensions.ToWireString — snake_case,
    /// e.g. "failed", "submitted_to_idealpos"). Null if absent/unparsable — callers must
    /// treat that as "no evidence of a terminal-negative status", never as a failure.</summary>
    private static string? TryParseStatus(string? body)
    {
        if (string.IsNullOrWhiteSpace(body)) return null;
        try
        {
            using var doc = JsonDocument.Parse(body);
            return doc.RootElement.TryGetProperty("status", out var status) && status.ValueKind == JsonValueKind.String
                ? status.GetString()
                : null;
        }
        catch (JsonException)
        {
            return null;
        }
    }

    /// <summary>Bridge's order-record shape carries the native failure detail in
    /// <c>lastError</c> (OrderRecord.LastError) — distinct from the validation-failure
    /// shape's <c>errors</c>/<c>detail</c> fields parsed by TryExtractErrorSummary below.</summary>
    private static string? TryParseLastError(string? body)
    {
        if (string.IsNullOrWhiteSpace(body)) return null;
        try
        {
            using var doc = JsonDocument.Parse(body);
            return doc.RootElement.TryGetProperty("lastError", out var lastError) && lastError.ValueKind == JsonValueKind.String
                ? lastError.GetString()
                : null;
        }
        catch (JsonException)
        {
            return null;
        }
    }

    private static bool? TryParseDuplicateFlag(string? body)
    {
        if (string.IsNullOrWhiteSpace(body)) return null;
        try
        {
            using var doc = JsonDocument.Parse(body);
            return doc.RootElement.TryGetProperty("duplicate", out var dup) && dup.ValueKind is JsonValueKind.True or JsonValueKind.False
                ? dup.GetBoolean()
                : null;
        }
        catch (JsonException)
        {
            return null; // malformed body on a 2xx — status code alone still proves acceptance
        }
    }

    /// <summary>
    /// Bridge's validation-failure shape is <c>{ error: "validation_failed",
    /// errors: [...] }</c> for a rejected order, or <c>{ error:
    /// "invalid_json", detail }</c> for an unparseable request body
    /// (verified against IdealposBridge's <c>OrdersEndpoint.cs</c>) — the
    /// human-readable detail lives in <c>errors</c>/<c>detail</c>, not in
    /// <c>error</c> itself, which is only a fixed category string.
    /// </summary>
    private static string? TryExtractErrorSummary(string? body)
    {
        if (string.IsNullOrWhiteSpace(body)) return null;
        try
        {
            using var doc = JsonDocument.Parse(body);
            var root = doc.RootElement;
            var category = root.TryGetProperty("error", out var error) && error.ValueKind == JsonValueKind.String
                ? error.GetString()
                : null;

            string? detail = null;
            if (root.TryGetProperty("errors", out var errors) && errors.ValueKind == JsonValueKind.Array)
            {
                detail = string.Join("; ", errors.EnumerateArray()
                    .Where(e => e.ValueKind == JsonValueKind.String)
                    .Select(e => e.GetString()));
            }
            else if (root.TryGetProperty("detail", out var detailProp) && detailProp.ValueKind == JsonValueKind.String)
            {
                detail = detailProp.GetString();
            }

            return (category, detail) switch
            {
                (not null, not null and not "") => $"{category}: {detail}",
                (not null, _) => category,
                (null, not null and not "") => detail,
                _ => null,
            };
        }
        catch (JsonException)
        {
            return null;
        }
    }

    private static string Sanitize(string message) => message.Length > 300 ? message[..300] + "..." : message;
}
