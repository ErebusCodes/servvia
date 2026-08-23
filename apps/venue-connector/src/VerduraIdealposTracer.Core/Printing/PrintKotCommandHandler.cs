using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using VerduraIdealposTracer.Core.Persistence;
using VerduraIdealposTracer.Core.Protocol;

namespace VerduraIdealposTracer.Core.Printing;

public static class PrintKotCommandType
{
    /// <summary>Must match PRINT_KOT_COMMAND_TYPE in printer-connector-command.constants.ts.</summary>
    public const string Value = "printer.print_kot.v1";
    public const int SchemaVersion = 1;
}

file sealed record ExecutionIntentEntry(string CommandId, string PrintAttemptId, string Phase, string? ResultType, string TimestampUtc);

/// <summary>
/// E8-S1 (expanded, KOT dispatch producer) — the connector-side handler for
/// <c>printer.print_kot.v1</c>. Mirrors this story's backend-side
/// discipline exactly: verify scope/version/checksum before doing anything
/// irreversible, persist execution intent to a durable local log BEFORE
/// calling the print transport (so a crash between "decided to print" and
/// "actually printed" is detectable on restart, not silently lost or
/// silently re-attempted), and return a structured, truthful result code —
/// never a bare boolean, and never ExecutedAcknowledged unless the
/// transport itself reported it.
///
/// Command scope (organization/venue/installation) is verified upstream by
/// Story 2-9's ConnectorAuthGuard/credential and Story 2-10's poll() —
/// every command this handler ever sees has already been claimed under an
/// authenticated identity for this connector's own venue only. This
/// handler does not re-derive that trust; it only refuses to act on a
/// command whose *content* (type/version/checksum) it cannot verify.
/// </summary>
public sealed class PrintKotCommandHandler(DurableLocalLog executionLog, IKotPrintTransport transport)
{
    private static string ComputeChecksum(string content)
    {
        var bytes = SHA256.HashData(Encoding.UTF8.GetBytes(content));
        // Convert.ToHexStringLower is .NET 9+; this project targets net8.0.
        return Convert.ToHexString(bytes).ToLowerInvariant();
    }

    private static string? GetString(Dictionary<string, object?> payload, string key)
    {
        if (!payload.TryGetValue(key, out var value) || value is null) return null;
        if (value is JsonElement el)
        {
            return el.ValueKind == JsonValueKind.String ? el.GetString() : null;
        }
        return value as string;
    }

    /// <summary>
    /// Replay guard: if a prior invocation persisted execution intent for
    /// this exact commandId but never recorded a result (the crash-after-
    /// print-before-ack window, or a process kill between the two log
    /// writes), this returns true — the caller must report
    /// UncertainLocalResult rather than call the transport a second time.
    /// This is the connector-side half of "duplicate processing must never
    /// knowingly produce duplicate KOTs."
    /// </summary>
    public bool HasUnresolvedIntent(string commandId)
    {
        var entries = executionLog.ReadAll();
        bool sawIntent = false;
        foreach (var doc in entries)
        {
            var root = doc.RootElement;
            if (!root.TryGetProperty("CommandId", out var idProp) || idProp.GetString() != commandId) continue;
            var phase = root.TryGetProperty("Phase", out var p) ? p.GetString() : null;
            if (phase == "intent_persisted") sawIntent = true;
            else if (phase == "result_recorded") sawIntent = false; // resolved
        }
        return sawIntent;
    }

    public async Task<ReportRequest> HandleAsync(ClaimedCommand command, string printAttemptIdempotencyKey, CancellationToken cancellationToken)
    {
        if (command.CommandType != PrintKotCommandType.Value)
        {
            return new ReportRequest(
                Outcome: "failed",
                ResultType: KotPrintResultType.Unsupported,
                ResultPayload: null,
                IdempotencyKey: printAttemptIdempotencyKey,
                FailureReason: $"Unrecognized command type: {command.CommandType}");
        }

        if (command.SchemaVersion != PrintKotCommandType.SchemaVersion)
        {
            return new ReportRequest(
                Outcome: "failed",
                ResultType: KotPrintResultType.UnsupportedVersion,
                ResultPayload: null,
                IdempotencyKey: printAttemptIdempotencyKey,
                FailureReason: $"Unsupported schemaVersion: {command.SchemaVersion}");
        }

        var renderedContent = GetString(command.Payload, "renderedContent");
        var declaredChecksum = GetString(command.Payload, "contentChecksum");
        var printAttemptId = GetString(command.Payload, "printAttemptId") ?? command.Id;

        if (string.IsNullOrEmpty(renderedContent) || string.IsNullOrEmpty(declaredChecksum))
        {
            return new ReportRequest(
                Outcome: "failed",
                ResultType: KotPrintResultType.MalformedPayload,
                ResultPayload: null,
                IdempotencyKey: printAttemptIdempotencyKey,
                FailureReason: "Payload missing renderedContent or contentChecksum.");
        }

        var actualChecksum = ComputeChecksum(renderedContent);
        if (!string.Equals(actualChecksum, declaredChecksum, StringComparison.OrdinalIgnoreCase))
        {
            // Never printed — a checksum mismatch means the content cannot
            // be trusted to be what the API actually rendered, so nothing
            // is sent to the transport at all.
            return new ReportRequest(
                Outcome: "failed",
                ResultType: KotPrintResultType.ChecksumMismatch,
                ResultPayload: null,
                IdempotencyKey: printAttemptIdempotencyKey,
                FailureReason: "Declared content checksum did not match the received payload.");
        }

        if (HasUnresolvedIntent(command.Id))
        {
            // A prior attempt persisted intent but this process (or a
            // previous one) never recorded a result — the crash-after-
            // print-before-ack window. Never call the transport again:
            // that could produce a second physical ticket.
            return new ReportRequest(
                Outcome: "failed",
                ResultType: KotPrintResultType.UncertainLocalResult,
                ResultPayload: null,
                IdempotencyKey: printAttemptIdempotencyKey,
                FailureReason: "A prior attempt's outcome could not be confirmed after restart; not re-attempted.");
        }

        // Persist-before-print: durable, fsync'd, BEFORE the irreversible
        // transport call. If the process crashes between this line and the
        // result-recording line below, HasUnresolvedIntent() detects it on
        // the next poll/replay and reports Uncertain rather than either
        // silently losing the attempt or silently re-printing.
        executionLog.AppendDurable(new ExecutionIntentEntry(
            command.Id, printAttemptId, "intent_persisted", null, DateTime.UtcNow.ToString("o")));

        KotPrintResult result;
        try
        {
            result = await transport.PrintAsync(renderedContent, cancellationToken);
        }
        catch (Exception ex)
        {
            result = new KotPrintResult(KotPrintOutcome.RetryableLocalFailure, ex.GetType().Name);
        }

        var resultType = result.Outcome switch
        {
            KotPrintOutcome.ExecutedAcknowledged => KotPrintResultType.ExecutedAcknowledged,
            KotPrintOutcome.RetryableLocalFailure => KotPrintResultType.RetryableLocalFailure,
            KotPrintOutcome.UncertainLocalResult => KotPrintResultType.UncertainLocalResult,
            _ => KotPrintResultType.UncertainLocalResult,
        };

        executionLog.AppendDurable(new ExecutionIntentEntry(
            command.Id, printAttemptId, "result_recorded", resultType, DateTime.UtcNow.ToString("o")));

        var outcome = result.Outcome == KotPrintOutcome.ExecutedAcknowledged ? "succeeded" : "failed";
        return new ReportRequest(
            Outcome: outcome,
            ResultType: resultType,
            ResultPayload: null,
            IdempotencyKey: printAttemptIdempotencyKey,
            FailureReason: outcome == "failed" ? result.Detail : null);
    }
}
