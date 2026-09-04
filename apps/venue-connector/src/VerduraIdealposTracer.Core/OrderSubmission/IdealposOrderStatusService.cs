using System.Text.Json;
using VerduraIdealposTracer.Core.Persistence;
using VerduraIdealposTracer.Core.Protocol;

namespace VerduraIdealposTracer.Core.OrderSubmission;

/// <summary>
/// Executes one <c>idealpos.order_status.v1</c> connector command: a pure
/// read of IdealposBridge's <c>GET /api/orders/{externalOrderId}</c>, whose
/// result is reported back verbatim through the existing Story 2-10 command
/// protocol (poll/accept/report — unchanged, reused exactly as
/// <see cref="IdealposOrderSubmissionService"/> already does).
///
/// WHY THE CONNECTOR AND NOT THE API. Bridge listens on loopback on the
/// venue machine behind a bearer key held in connector-local configuration.
/// This service is the component already trusted with that URL and key, so
/// routing the readback here means the API never acquires a second copy of
/// a Bridge credential or a second network path to it. The command payload
/// carries only an externalOrderId — it cannot redirect this client at a
/// different host, exactly as <see cref="IdealposBridgeClient"/>'s own doc
/// comment describes for submissions.
///
/// THIS SERVICE INTERPRETS NOTHING. It classifies only the transport
/// outcome (answered / 404 / unreadable / unreachable) and forwards the
/// Bridge record untouched. Every rule about what may promote a Verdura
/// order to `synced` lives server-side in `decideConfirmation`, so a
/// connector build can never widen what counts as confirmation. In
/// particular this service never looks at `table`, `tableMatchesRequest` or
/// `posServerPendingSaleCode`, and never reports "confirmed".
///
/// SAFETY. The read creates, modifies and assigns nothing in IdealPOS. It
/// is therefore safe to repeat: duplicate delivery of the same probe, or a
/// retry after a dropped report, cannot have any side effect on a sale.
/// </summary>
public sealed class IdealposOrderStatusService(
    IdealposBridgeClient bridgeClient,
    DurableLocalLog localLog,
    ConnectorCommandProtocolClient cloudClient)
{
    /// <summary>Must byte-match idealpos-order-status.constants.ts's IDEALPOS_ORDER_STATUS_COMMAND_TYPE.</summary>
    public const string CommandType = "idealpos.order_status.v1";

    public const int SupportedSchemaVersion = 1;

    // Must byte-match idealpos-order-status.constants.ts's
    // IDEALPOS_ORDER_STATUS_RESULT_TYPE.
    private const string ResultTypeBridgeOrderStatus = "bridge_order_status";
    private const string ResultTypeBridgeOrderNotFound = "bridge_order_not_found";
    private const string ResultTypeBridgeStatusUnreadable = "bridge_status_unreadable";
    private const string ResultTypeBridgeUnreachableOrFailed = "bridge_unreachable_or_failed";
    private const string ResultTypeConnectorPayloadInvalid = "connector_payload_invalid";

    private static readonly JsonSerializerOptions PayloadJsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = true,
    };

    private sealed record OrderStatusPayload(string? ExternalOrderId);

    public async Task<IdealposOrderStatusResult> RunCloudModeAsync(ClaimedCommand command, CancellationToken cancellationToken)
    {
        var startedAt = DateTimeOffset.UtcNow;
        var diagnostics = new List<string>();

        if (command.SchemaVersion != SupportedSchemaVersion)
        {
            // Recognized type, unsupported version: never accept a command
            // we cannot safely execute. Left unclaimed for reclaim by a
            // build that understands it — same posture as submission.
            diagnostics.Add($"Unsupported schema version {command.SchemaVersion} for {CommandType} — leaving unclaimed.");
            return new IdealposOrderStatusResult
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

        OrderStatusPayload payload;
        try
        {
            payload = ParseAndValidatePayload(command.Payload);
        }
        catch (FormatException ex)
        {
            diagnostics.Add($"Malformed payload: {ex.Message}");
            localLog.AppendDurable(new { type = "claimed", commandId = command.Id, ts = startedAt });
            await cloudClient.AcceptAsync(command.Id, cancellationToken);
            await cloudClient.ReportAsync(
                command.Id,
                new ReportRequest(
                    Outcome: "failed",
                    ResultType: ResultTypeConnectorPayloadInvalid,
                    ResultPayload: new Dictionary<string, object?> { ["reason"] = ex.Message },
                    IdempotencyKey: $"idealpos-order-status-report:{command.Id}",
                    FailureReason: Sanitize(ex.Message)),
                cancellationToken);
            var malformedResult = new IdealposOrderStatusResult
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
        // ordering the submission and discovery services already use.
        localLog.AppendDurable(new { type = "claimed", commandId = command.Id, externalOrderId = payload.ExternalOrderId, ts = startedAt });
        await cloudClient.AcceptAsync(command.Id, cancellationToken);
        diagnostics.Add($"Accepted status probe {command.Id} for externalOrderId={payload.ExternalOrderId}.");

        var statusResult = await bridgeClient.GetOrderStatusAsync(payload.ExternalOrderId!, cancellationToken);
        diagnostics.Add($"Bridge status outcome: {statusResult.Outcome} (httpStatus={statusResult.HttpStatusCode?.ToString() ?? "n/a"}).");

        var (outcome, resultType, failureReason) = statusResult.Outcome switch
        {
            // A read that produced an answer is a SUCCESSFUL probe, whatever
            // the answer says about the order. "The probe worked" and "the
            // order is confirmed" are different claims, and only the server
            // makes the second one.
            BridgeStatusOutcome.Ok => ("succeeded", ResultTypeBridgeOrderStatus, (string?)null),
            BridgeStatusOutcome.NotFound => ("succeeded", ResultTypeBridgeOrderNotFound, (string?)null),
            BridgeStatusOutcome.Unreadable => ("failed", ResultTypeBridgeStatusUnreadable, statusResult.SanitizedDetail),
            BridgeStatusOutcome.UnreachableOrFailed => ("failed", ResultTypeBridgeUnreachableOrFailed, statusResult.SanitizedDetail),
            _ => throw new InvalidOperationException($"Unhandled {nameof(BridgeStatusOutcome)}: {statusResult.Outcome}"),
        };

        var resultPayload = new Dictionary<string, object?>
        {
            ["externalOrderId"] = payload.ExternalOrderId,
            ["httpStatusCode"] = statusResult.HttpStatusCode,
        };
        // Only present for Ok — the server treats a missing body on a
        // `bridge_order_status` report as malformed rather than as an empty
        // record, so an absent body can never be read as "nothing observed".
        if (statusResult.Body is not null) resultPayload["body"] = statusResult.Body;

        await cloudClient.ReportAsync(
            command.Id,
            new ReportRequest(
                Outcome: outcome,
                ResultType: resultType,
                ResultPayload: resultPayload,
                // Stable per command: a repeated report after a dropped HTTP
                // response is a safe replay, never a conflicting second report.
                IdempotencyKey: $"idealpos-order-status-report:{command.Id}",
                FailureReason: failureReason is null ? null : Sanitize(failureReason)),
            cancellationToken);

        var result = new IdealposOrderStatusResult
        {
            CommandId = command.Id,
            ExternalOrderId = payload.ExternalOrderId,
            StartedAtUtc = startedAt,
            CompletedAtUtc = DateTimeOffset.UtcNow,
            Accepted = true,
            Reported = true,
            ReportedOutcome = outcome,
            ReportedResultType = resultType,
            BridgeHttpStatusCode = statusResult.HttpStatusCode,
            FailClosedReason = outcome == "failed" ? failureReason : null,
            Diagnostics = diagnostics,
        };
        localLog.AppendDurable(new { type = "terminal", commandId = command.Id, result, ts = DateTimeOffset.UtcNow });
        return result;
    }

    private static OrderStatusPayload ParseAndValidatePayload(Dictionary<string, object?> rawPayload)
    {
        OrderStatusPayload? payload;
        try
        {
            var json = JsonSerializer.Serialize(rawPayload);
            payload = JsonSerializer.Deserialize<OrderStatusPayload>(json, PayloadJsonOptions);
        }
        catch (JsonException ex)
        {
            throw new FormatException($"Payload did not match the expected {CommandType} shape: {ex.Message}");
        }

        if (payload is null) throw new FormatException("Payload deserialized to null.");
        if (string.IsNullOrWhiteSpace(payload.ExternalOrderId)) throw new FormatException("externalOrderId is required.");

        return payload;
    }

    private static string Sanitize(string message) => message.Length > 256 ? message[..256] + "..." : message;
}
