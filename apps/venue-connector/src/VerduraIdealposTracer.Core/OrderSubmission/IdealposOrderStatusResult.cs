namespace VerduraIdealposTracer.Core.OrderSubmission;

/// <summary>
/// The complete, truthful result of one <c>idealpos.order_status.v1</c>
/// probe execution. Mirrors <see cref="IdealposOrderSubmissionResult"/>'s
/// contract: <see cref="Reported"/> is false exactly when this run
/// deliberately did not call <c>ReportAsync</c> at all (an unrecognized
/// schema version left the command unaccepted) — never when a report was
/// attempted and merely carried a failure outcome.
///
/// Note what is deliberately ABSENT: there is no field here for the table,
/// for a match verdict, or for any notion of "confirmed". This type
/// describes whether the READ succeeded, not what the read means. The
/// meaning is decided server-side by `decideConfirmation`.
/// </summary>
public sealed record IdealposOrderStatusResult
{
    public required string CommandId { get; init; }
    public string? ExternalOrderId { get; init; }
    public required DateTimeOffset StartedAtUtc { get; init; }
    public DateTimeOffset? CompletedAtUtc { get; init; }

    public bool Accepted { get; init; }
    public bool Reported { get; init; }
    public string? ReportedOutcome { get; init; } // "succeeded" | "failed" — mirrors ConnectorCommandReportDto.outcome
    public string? ReportedResultType { get; init; }

    /// <summary>The HTTP status Bridge returned to the read, when one was received at all.</summary>
    public int? BridgeHttpStatusCode { get; init; }

    /// <summary>Non-null exactly when this run did not, or could not, produce a usable answer — never treated as evidence about the order itself.</summary>
    public string? FailClosedReason { get; init; }
    public IReadOnlyList<string> Diagnostics { get; init; } = [];
}
