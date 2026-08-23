namespace VerduraIdealposTracer.Core.OrderSubmission;

/// <summary>
/// The complete, truthful result of one <c>idealpos.submit_order.v1</c>
/// command execution. <see cref="Reported"/> is false exactly when this run
/// deliberately did not call <c>ReportAsync</c> at all (the command was
/// left unaccepted for an unrecognized schema version, or the Bridge
/// interaction was ambiguous) — never when a report was attempted and
/// merely carried a failure outcome.
/// </summary>
public sealed record IdealposOrderSubmissionResult
{
    public required string CommandId { get; init; }
    public string? ExternalOrderId { get; init; }
    public required DateTimeOffset StartedAtUtc { get; init; }
    public DateTimeOffset? CompletedAtUtc { get; init; }

    public bool Accepted { get; init; }
    public bool Reported { get; init; }
    public string? ReportedOutcome { get; init; } // "succeeded" | "failed" — mirrors ConnectorCommandReportDto.outcome
    public string? ReportedResultType { get; init; }
    public bool? Duplicate { get; init; }

    /// <summary>Non-null exactly when this run did not, or could not, produce a truthful terminal report — never treated as evidence the order failed at IdealPOS.</summary>
    public string? FailClosedReason { get; init; }
    public IReadOnlyList<string> Diagnostics { get; init; } = [];
}
