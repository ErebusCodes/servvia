using System.Text.Json;
using VerduraIdealposTracer.Core.Persistence;
using VerduraIdealposTracer.Core.Protocol;

namespace VerduraIdealposTracer.Core.OrderSubmission;

/// <summary>
/// Executes one <c>idealpos.submit_order.v1</c> connector command: validates
/// it, calls the configured local IdealposBridge, classifies the result
/// truthfully, and reports through the existing Story 2-10 command protocol
/// (poll/accept/report — unchanged, reused exactly as
/// <c>DiscoveryTracerService</c> already does). This class never contacts
/// Idealpos, EFTPOS, or a printer directly — only IdealposBridge's local
/// HTTP endpoint, via <see cref="IdealposBridgeClient"/>.
///
/// The payload it forwards is exactly the server-side dispatcher's own
/// output (<c>buildIdealposOrderPayload</c> /
/// <c>idealpos-order-payload-mapper.ts</c>) — this class performs no
/// second, independently-invented translation, and its payload DTO
/// (<see cref="BridgeOrderRequest"/>) has no price/payment/modifier field to
/// invent one into even by accident.
/// </summary>
public sealed class IdealposOrderSubmissionService(
    IdealposBridgeClient bridgeClient,
    DurableLocalLog localLog,
    ConnectorCommandProtocolClient cloudClient)
{
    /// <summary>The one command type this service handles — must byte-match idealpos-order-dispatch.constants.ts's IDEALPOS_SUBMIT_ORDER_COMMAND_TYPE.</summary>
    public const string CommandType = "idealpos.submit_order.v1";

    public const int SupportedSchemaVersion = 1;

    // Must byte-match idealpos-order-dispatch.constants.ts's
    // IDEALPOS_SUBMIT_ORDER_RESULT_TYPE — these three are the only Bridge
    // outcomes the server-side reconciler vocabulary defines.
    private const string ResultTypeBridgeAccepted = "bridge_accepted";
    private const string ResultTypeBridgeRejected = "bridge_rejected";
    private const string ResultTypeBridgeUnreachableOrFailed = "bridge_unreachable_or_failed";

    // Connector-local only — never a Bridge outcome, so deliberately outside
    // the three-value vocabulary above. Used only when this command's own
    // payload cannot be parsed at all; Bridge is never contacted in that case.
    private const string ResultTypeConnectorPayloadInvalid = "connector_payload_invalid";

    private static readonly JsonSerializerOptions PayloadJsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = true,
    };

    private sealed record SubmitOrderPayloadItem(string? ProductCode, int Quantity, int? Seat = null);
    private sealed record SubmitOrderPayload(string? ExternalOrderId, string? Table, List<SubmitOrderPayloadItem>? Items, string? Notes);

    /// <summary>
    /// Given a command already claimed by the caller's single poll this tick
    /// (see <c>Program.cs</c>'s dispatch point), executes it. The caller is
    /// responsible for verifying <paramref name="command"/>.CommandType
    /// equals <see cref="CommandType"/> before calling this — an unrecognized
    /// *type* should never reach this service at all (left unclaimed by the
    /// caller for a build that does understand it). This method itself only
    /// guards against a recognized type carrying an unsupported *schema
    /// version* or a malformed payload.
    /// </summary>
    public async Task<IdealposOrderSubmissionResult> RunCloudModeAsync(ClaimedCommand command, CancellationToken cancellationToken)
    {
        var startedAt = DateTimeOffset.UtcNow;
        var diagnostics = new List<string>();

        if (command.SchemaVersion != SupportedSchemaVersion)
        {
            // Recognized type, unsupported version: never accept a command
            // we cannot safely execute. Left unclaimed for reclaim — a
            // future connector build (or an operator) can act on it; this
            // build must not fabricate a result for a contract it does not
            // understand.
            diagnostics.Add($"Unsupported schema version {command.SchemaVersion} for {CommandType} — leaving unclaimed.");
            return new IdealposOrderSubmissionResult
            {
                CommandId = command.Id,
                StartedAtUtc = startedAt,
                CompletedAtUtc = DateTimeOffset.UtcNow,
                Accepted = false,
                Reported = false,
                FailClosedReason = $"Unsupported schema version: {command.SchemaVersion}",
                Diagnostics = diagnostics,
            };
        }

        SubmitOrderPayload payload;
        try
        {
            payload = ParseAndValidatePayload(command.Payload);
        }
        catch (FormatException ex)
        {
            // The payload for a version we DO understand failed our own
            // strict validation — a real, reportable failure of Verdura's
            // own command contract. Bridge is never contacted. Persist
            // before ack (same ordering DiscoveryTracerService uses), then
            // accept and report a deterministic, non-retryable failure.
            diagnostics.Add($"Malformed payload: {ex.Message}");
            localLog.AppendDurable(new { type = "claimed", commandId = command.Id, ts = startedAt });
            await cloudClient.AcceptAsync(command.Id, cancellationToken);
            await cloudClient.ReportAsync(
                command.Id,
                new ReportRequest(
                    Outcome: "failed",
                    ResultType: ResultTypeConnectorPayloadInvalid,
                    ResultPayload: new Dictionary<string, object?> { ["reason"] = ex.Message },
                    IdempotencyKey: $"idealpos-submit-order-report:{command.Id}",
                    FailureReason: Sanitize(ex.Message)),
                cancellationToken);
            var malformedResult = new IdealposOrderSubmissionResult
            {
                CommandId = command.Id,
                StartedAtUtc = startedAt,
                CompletedAtUtc = DateTimeOffset.UtcNow,
                Accepted = true,
                Reported = true,
                ReportedOutcome = "failed",
                ReportedResultType = ResultTypeConnectorPayloadInvalid,
                FailClosedReason = ex.Message,
                Diagnostics = diagnostics,
            };
            localLog.AppendDurable(new { type = "terminal", commandId = command.Id, result = malformedResult, ts = DateTimeOffset.UtcNow });
            return malformedResult;
        }

        // Persist BEFORE reporting acceptance — same persist-before-ack
        // ordering as DiscoveryTracerService/Story 2-10's own harness.
        localLog.AppendDurable(new { type = "claimed", commandId = command.Id, externalOrderId = payload.ExternalOrderId, ts = startedAt });
        await cloudClient.AcceptAsync(command.Id, cancellationToken);
        diagnostics.Add($"Accepted command {command.Id} for externalOrderId={payload.ExternalOrderId}.");

        var bridgeRequest = new BridgeOrderRequest(
            payload.ExternalOrderId!,
            payload.Table!,
            payload.Items!.Select(i => new BridgeOrderItem(i.ProductCode!, i.Quantity, i.Seat)).ToList(),
            payload.Notes);

        BridgeSubmitResult bridgeResult;
        try
        {
            bridgeResult = await bridgeClient.SubmitOrderAsync(bridgeRequest, cancellationToken);
        }
        catch (BridgeSubmissionAmbiguousException ex)
        {
            // Timeout after the request was already sent — Bridge may have
            // already accepted the order. Never report a definite outcome:
            // the command stays `accepted` and, per Story 2-10's own
            // reconciliation window, becomes `unknown` (never auto-retried,
            // requires reconciliation) rather than being misreported as a
            // failure that could tempt a human into re-keying a real
            // duplicate order at the counter.
            diagnostics.Add($"Ambiguous Bridge outcome: {ex.Message}");
            var ambiguousResult = new IdealposOrderSubmissionResult
            {
                CommandId = command.Id,
                ExternalOrderId = payload.ExternalOrderId,
                StartedAtUtc = startedAt,
                CompletedAtUtc = DateTimeOffset.UtcNow,
                Accepted = true,
                Reported = false,
                FailClosedReason = ex.Message,
                Diagnostics = diagnostics,
            };
            localLog.AppendDurable(new { type = "ambiguous_unreported", commandId = command.Id, result = ambiguousResult, ts = DateTimeOffset.UtcNow });
            return ambiguousResult;
        }

        var (outcome, resultType, failureReason) = bridgeResult.Outcome switch
        {
            BridgeSubmitOutcome.Accepted => ("succeeded", ResultTypeBridgeAccepted, (string?)null),
            BridgeSubmitOutcome.Rejected => ("failed", ResultTypeBridgeRejected, bridgeResult.SanitizedDetail),
            BridgeSubmitOutcome.UnreachableOrFailed => ("failed", ResultTypeBridgeUnreachableOrFailed, bridgeResult.SanitizedDetail),
            _ => throw new InvalidOperationException($"Unhandled {nameof(BridgeSubmitOutcome)}: {bridgeResult.Outcome}"),
        };
        diagnostics.Add($"Bridge outcome: {bridgeResult.Outcome} (httpStatus={bridgeResult.HttpStatusCode?.ToString() ?? "n/a"}, duplicate={bridgeResult.Duplicate?.ToString() ?? "n/a"}).");

        var resultPayload = new Dictionary<string, object?>
        {
            ["externalOrderId"] = payload.ExternalOrderId,
            ["duplicate"] = bridgeResult.Duplicate,
            ["httpStatusCode"] = bridgeResult.HttpStatusCode,
        };

        await cloudClient.ReportAsync(
            command.Id,
            new ReportRequest(
                Outcome: outcome,
                ResultType: resultType,
                ResultPayload: resultPayload,
                // Stable per (command, outcome) — a repeated report of the
                // identical outcome (e.g. after a dropped HTTP response on
                // ReportAsync itself) is a safe replay, never a conflicting
                // second report. Never derived from a freshly-generated id.
                IdempotencyKey: $"idealpos-submit-order-report:{command.Id}",
                FailureReason: failureReason is null ? null : Sanitize(failureReason)),
            cancellationToken);

        var result = new IdealposOrderSubmissionResult
        {
            CommandId = command.Id,
            ExternalOrderId = payload.ExternalOrderId,
            StartedAtUtc = startedAt,
            CompletedAtUtc = DateTimeOffset.UtcNow,
            Accepted = true,
            Reported = true,
            ReportedOutcome = outcome,
            ReportedResultType = resultType,
            Duplicate = bridgeResult.Duplicate,
            FailClosedReason = outcome == "failed" ? failureReason : null,
            Diagnostics = diagnostics,
        };
        localLog.AppendDurable(new { type = "terminal", commandId = command.Id, result, ts = DateTimeOffset.UtcNow });
        return result;
    }

    private static SubmitOrderPayload ParseAndValidatePayload(Dictionary<string, object?> rawPayload)
    {
        SubmitOrderPayload? payload;
        try
        {
            var json = JsonSerializer.Serialize(rawPayload);
            payload = JsonSerializer.Deserialize<SubmitOrderPayload>(json, PayloadJsonOptions);
        }
        catch (JsonException ex)
        {
            throw new FormatException($"Payload did not match the expected idealpos.submit_order.v1 shape: {ex.Message}");
        }

        if (payload is null) throw new FormatException("Payload deserialized to null.");
        if (string.IsNullOrWhiteSpace(payload.ExternalOrderId)) throw new FormatException("externalOrderId is required.");
        if (string.IsNullOrWhiteSpace(payload.Table)) throw new FormatException("table is required.");
        if (payload.Items is null || payload.Items.Count == 0) throw new FormatException("items must be a non-empty array.");
        foreach (var item in payload.Items)
        {
            if (string.IsNullOrWhiteSpace(item.ProductCode)) throw new FormatException("productCode is required for every item.");
            if (item.Quantity <= 0) throw new FormatException("quantity must be a positive integer for every item.");
        }

        return payload;
    }

    private static string Sanitize(string message) => message.Length > 256 ? message[..256] + "..." : message;
}
